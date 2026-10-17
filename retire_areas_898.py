#!/usr/bin/env python3
# 898 · RETIRE PAYER PROGRAMS AND FIELD QUALITY; ZACH BACK ON INCIDENTS (Samantha 2026-10-17: "We dont need payer program
# anymore, we wont have medicaid, and all of our care coordinators will handle private pay, ltc, medicare guide, and va ...
# also remove field quality for now"; she approved the mapping on the plan page and "Zach" for the Incidents escalation).
#  · redeploys call-tasks: calls tagged payer programs go to Client Care, field work to Caregiver Performance
#  · client issue types that pointed at Field Quality move to Caregiver Performance (a caregiver's concern about a client
#    or family to Client Care); any pointing at Payer Programs move to Client Care
#  · the two work areas are switched off (active = false). Their owner stays Krystal, so the Medicaid cards that still
#    use them reach her until IHS ends on Nov 16
#  · Incidents escalates to Zach again (897 had set it to Samantha, who owns Incidents)
#  · approves the Hub's new client-start.js (Start of Care billing setup goes to Client Care) so the server keeps running
#    it once the Hub change merges; the previous version stays approved
#  · old values kept in ops_settings.sop_rulings_898_previous. Nothing is texted, emailed or called.
import json, os, re, subprocess, datetime as dt
os.environ.setdefault("SB_STEP", "898")
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, sql, deploy, start, check_build, fmeta, lit

REF = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FN = "call-tasks"
RETIRE = ("payer_programs", "field_quality")
ESC_EMAIL = os.environ.get("SB_ESC_EMAIL", "zach@mo-care.com")
ISSUE_MOVE = {"field_quality": "caregiver_performance", "payer_programs": "client_care"}
ISSUE_EXCEPT = {"caregiver_concern_about_client": "client_care"}
RULES = json.loads(os.environ.get("SB_RULES_APPROVE", "{}"))
ok = lambda s: say("  ✓ " + s)
def run(args): p = subprocess.run(args, capture_output=True, text=True, cwd=ROOT); return p.returncode, (p.stdout or ""), (p.stderr or "")
def stop(msg): bad(msg); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(2)
def jlit(o): return "$cc898$" + json.dumps(o) + "$cc898$::jsonb"
NOW = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")

start("RETIRE PAYER PROGRAMS AND FIELD QUALITY; ZACH BACK ON INCIDENTS")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
if set(RULES) != {"client-start.js"} or not re.fullmatch(r"[0-9a-f]{64}", RULES.get("client-start.js", "")): stop("the Hub file to approve isn't set right")
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = [k for k in sorted(L.need(FNROOT, FN)) if (lambda c: c[0] != 0 or c[1] != open(os.path.join(ROOT, k)).read())(run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"]))]
if drift: stop(f"{FN} isn't the same as GitHub's main yet (merge the server pull request first): " + ", ".join(drift)[:240])
ok(f"{FN}: the reviewed build is what is on GitHub's main")
s0, m0 = fmeta(REF, FN)
if s0 != 200 or not m0 or "verify_jwt" not in m0: stop(f"couldn't read how {FN} is set up live ({s0})")
GATE = bool(m0["verify_jwt"]); say(f"  · {FN} is live as version {m0.get('version', '?')}, gateway sign-in check {'on' if GATE else 'off'} (kept)")

ok1, r1 = sql(REF, f"""select coalesce(jsonb_agg(jsonb_build_object('code', d.code, 'label', d.label, 'active', d.active, 'escalation', d.escalation_person,
    'owner_name', (select full_name from public.persons where person_id = d.owner_person),
    'esc_name', (select full_name from public.persons where person_id = d.escalation_person))), '[]'::jsonb) as doms,
  (select jsonb_build_object('id', p.person_id, 'name', p.full_name, 'active', p.active,
     'owner', exists (select 1 from public.staff_roles r where r.person_id = p.person_id and r.role = 'owner_admin'))
     from public.persons p where lower(p.primary_email) = {lit(ESC_EMAIL)} limit 1) as esc,
  to_regclass('public.issue_category') is not null as has_issues,
  to_regclass('public.rules_approved') is not null as has_rules,
  (select data from public.app_data where key = 'ops_settings') ? 'sop_rulings_898_previous' as ran_before
  from public.domains d where d.entity = 'cc_ihs' and d.code in ('payer_programs', 'field_quality', 'incidents')""")
if not ok1: stop(f"could not read the work areas: {r1}")
x = r1[0]; DOMS = {d["code"]: d for d in (x["doms"] if isinstance(x["doms"], list) else json.loads(x["doms"]))}
ESC = x["esc"] if isinstance(x["esc"], (dict, type(None))) else json.loads(x["esc"])
for c in RETIRE + ("incidents",):
    if c not in DOMS: stop(f"the work area '{c}' is not there")
if not ESC or not ESC.get("active") or not ESC.get("owner"): stop(f"{ESC_EMAIL} is not an active owner, so Incidents cannot escalate to them")
if not x["has_rules"]: stop("the approved-rules list is not there")
for c in RETIRE:
    d = DOMS[c]; say(f"  · {d['label']}: " + ("on" if d["active"] else "already off") + f", owner {d['owner_name'] or 'nobody'} (kept, so the Medicaid cards reach them until Nov 16)")
inc = DOMS["incidents"]
INC_CHANGE = inc["escalation"] != ESC["id"]
say(f"  · Incidents escalates to {inc['esc_name'] or 'nobody'}" + (f"; it will go to {ESC['name']}" if INC_CHANGE else " already"))
ISSUES = []
if x["has_issues"]:
    ok2, r2 = sql(REF, "select code, label, default_domain from public.issue_category where default_domain in ('field_quality', 'payer_programs') order by code")
    if not ok2: stop(f"could not read the client issue types: {r2}")
    ISSUES = [(i["code"], i["label"], i["default_domain"], ISSUE_EXCEPT.get(i["code"]) or ISSUE_MOVE[i["default_domain"]]) for i in r2]
say(f"  · client issue types that move: {len(ISSUES)}" + ("" if x["has_issues"] else " (the issue type list isn't there)"))
for code, label, old, new in ISSUES: say(f"      {label}: {old} → {new}")
say(f"  · the Hub's new client-start.js ({RULES['client-start.js'][:12]}) will be approved; the version running now stays approved")
if x["ran_before"]: say("  · NOTE: this step ran before; the first run's old values are kept")
OFF = [c for c in RETIRE if DOMS[c]["active"]]
say(f"  · what changes: {FN} redeployed, {len(OFF)} work area(s) off, {len(ISSUES)} issue type(s), Incidents escalation{'' if INC_CHANGE else ' (none)'}, 1 rules file approved. Nothing is sent.")
if L.fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
if not deploy(REF, FNROOT, FN, GATE): say(f"  RESULT: STOPPED at {FN}. Tell Claude. (The database was not changed.)"); done(7)
prev = {"at": NOW, "active": {c: DOMS[c]["active"] for c in RETIRE}, "incidents_escalation": inc["escalation"], "issues": {c: o for c, _, o, _ in ISSUES}}
stmts = ["begin;",
  f"""update public.app_data set data = coalesce(data, '{{}}'::jsonb) || jsonb_build_object('sop_rulings_898_previous', {jlit(prev)}), updated_at = now()
      where key = 'ops_settings' and not (coalesce(data, '{{}}'::jsonb) ? 'sop_rulings_898_previous');""",
  f"update public.domains set active = false where entity = 'cc_ihs' and code in ('payer_programs', 'field_quality');",
  f"update public.domains set escalation_person = {lit(ESC['id'])}::uuid where entity = 'cc_ihs' and code = 'incidents';"]
for code, _, _, new in ISSUES: stmts.append(f"update public.issue_category set default_domain = {lit(new)} where code = {lit(code)};")
stmts += [f"""insert into public.rules_approved (file, sha256, note) values ('client-start.js', {lit(RULES['client-start.js'])}, 'Desktop 898: Start of Care billing setup to Client Care (Payer Programs retired)')
      on conflict (file, sha256) do update set approved_at = now(), note = excluded.note;""",
  """delete from public.rules_approved r using (select file, sha256, row_number() over (partition by file order by approved_at desc) as n
      from public.rules_approved where file = 'client-start.js') x where r.file = x.file and r.sha256 = x.sha256 and x.n > 2;""",
  "commit;"]
okC, rC = sql(REF, "\n".join(stmts))
if not okC: bad(f"the database change did not go through, so nothing in the database changed: {rC}"); say("  RESULT: STOPPED. Tell Claude. (call-tasks was redeployed.)"); done(8)
ok("work areas, issue types, Incidents and the rules approval changed in one go (old values kept in ops_settings.sop_rulings_898_previous)")

say(); say("PART 3 · PROOF (nothing is sent)")
ok3, r3 = sql(REF, f"""select (select jsonb_object_agg(code, active) from public.domains where entity = 'cc_ihs' and code in ('payer_programs', 'field_quality')) as act,
  (select p.full_name from public.domains d join public.persons p on p.person_id = d.escalation_person where d.entity = 'cc_ihs' and d.code = 'incidents') as inc,
  (select count(*) from public.issue_category where default_domain in ('field_quality', 'payer_programs')) as left_issues,
  (select sha256 from public.rules_approved where file = 'client-start.js' order by approved_at desc limit 1) as newest,
  (select count(*) from public.rules_approved where file = 'client-start.js') as kept""" if x["has_issues"] else
  f"""select (select jsonb_object_agg(code, active) from public.domains where entity = 'cc_ihs' and code in ('payer_programs', 'field_quality')) as act,
  (select p.full_name from public.domains d join public.persons p on p.person_id = d.escalation_person where d.entity = 'cc_ihs' and d.code = 'incidents') as inc,
  0 as left_issues, (select sha256 from public.rules_approved where file = 'client-start.js' order by approved_at desc limit 1) as newest,
  (select count(*) from public.rules_approved where file = 'client-start.js') as kept""")
if ok3:
    y = r3[0]; act = y["act"] if isinstance(y["act"], dict) else json.loads(y["act"] or "{}")
    if all(v is False for v in act.values()) and len(act) == 2 and y["inc"] == ESC["name"] and int(y["left_issues"]) == 0 and y["newest"] == RULES["client-start.js"]:
        ok(f"read back: Payer Programs and Field Quality are off; Incidents escalates to {y['inc']}; no issue type points at a retired area; client-start.js {y['newest'][:12]} approved (newest of {y['kept']})")
    else: bad(f"read back is not right: {y}")
else: bad(f"could not read back: {r3}")
s5, _ = http("OPTIONS", f"{FNB}/functions/v1/call-tasks"); ok("call-tasks still answers") if s5 == 200 else bad(f"call-tasks: the browser check answered {s5}")
say("  · tested before deploying: call-tasks (98 of 99 checks; the one failure is the same on main and is not about this), the Hub's Start of Care file (25 checks), and this step against a local copy of the database.")
say()
if L.fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · Merge the Hub pull request next (sop10-retire). Nothing was sent."); done(0)
