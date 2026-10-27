#!/usr/bin/env python3
# 1150 · STAFFING SERVER · INCIDENTS TO ZACH (HR) (Samantha 2026-10-27: "send work injury cards to Zach instead of Krystal"
#     and "Zach needs to be involved in incident reports as well... it needs to be investigated further").
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass; Stages 1-3 are installed; Zach's
#     sign-in can write findings (owner_admin); which open work injury cards are not Zach's yet.
#  2. Adds "look into it" to the report record (saved once, never changed), redeploys incident-report, and moves any open
#     work injury card to Zach.
#  3. Proof in practice: the public key can't hand anything to Zach or read his list; who asked can't be changed; findings
#     need an ask first. Texts nobody; the switch is left exactly as it is.
import json, os, re, subprocess, shutil, time, hashlib
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, sql, deploy, start, check_build, fmeta, lit, MG, API

REF = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
if NODE == "none": NODE = ""
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
HUB = os.environ.get("SB_HUB_BASE", "https://cc.mo-care.com")
JOB = FN = "incident-report"; SCHEDULE = "17 * * * *"; VAULT_NAME = "hub_job_secret"; SQLF = "incident_investigation.sql"
OFFICE = [e for e in os.environ.get("SB_OFFICE_EMAILS", "krystal@mo-care.com,zach@mo-care.com").split(",") if e]
POLL = float(os.environ.get("SB_POLL", "2")); POLL_MAX = float(os.environ.get("SB_POLL_MAX", "40"))
ok = lambda s: say("  ✓ " + s)
def chk(good, msg, badmsg=None): (ok(msg) if good else bad(badmsg or msg))
def run(args, cwd=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)
def jload(b):
    try: return json.loads(b)
    except Exception: return {}
def keys():
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_publishable_") or v.startswith("sb_secret_")) and "·" not in v and "*" not in v
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys{q}", headers=MG())
        if s != 200: continue
        arr = jload(b)
        if isinstance(arr, dict): arr = arr.get("keys") or []
        got = {k.get("name"): k.get("api_key", "") for k in arr if isinstance(k, dict) and usable(k.get("api_key", ""))}
        if got.get("anon") and got.get("service_role"): return got
    return {}
def command(url, anon):
    return ("select net.http_post(url := " + lit(url) + ", headers := jsonb_build_object('Content-Type', 'application/json', "
            "'Authorization', " + lit("Bearer " + anon) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")), "
            "body := '{}'::jsonb, timeout_milliseconds := 150000);")
SIG = [[[0.1, 0.5], [0.2, 0.3], [0.3, 0.6], [0.4, 0.4], [0.5, 0.5]], [[0.6, 0.3], [0.7, 0.6], [0.8, 0.4], [0.9, 0.5]]]
INJ = {"time": "9:40 am", "where": "At the office", "where_more": "Practice only", "what": "Practice only: the Desktop step checking the work injury report end to end.", "body": "none, practice",
       "injury": "Something else", "finish": "Yes, I finished my shift", "care": "No, I don't need any", "saw": "no one", "told": "I called the office", "told_when": "Practice, the Desktop step"}
ANS = {"time": "2:15 pm", "where": "Bathroom", "what": "Practice only: the Desktop step checking the report works end to end.", "hurt": "No",
       "did": "Practice only, nothing happened.", "help": ["No one"], "saw": "no one", "told": "I called the office", "told_when": "Practice, the Desktop step"}

start("STAFFING SERVER · INCIDENTS TO ZACH (HR)")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
sqh = hashlib.sha256(open(os.path.join(ROOT, SQLF), "rb").read()).hexdigest()
if sqh != os.environ.get("SB_SQL_SHA", ""): stop("the database change is not the reviewed build")
ok("the database change is the reviewed build")
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = []
for k in sorted(L.need(FNROOT, FN) | {SQLF}):
    c2, b2 = run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"])
    if c2 != 0 or b2 != open(os.path.join(ROOT, k)).read(): drift.append(k)
if drift: stop("this isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(drift)[:240] + ")")
ok("the reviewed build is what is on GitHub's main")
if NODE:
    c, o = run([NODE, "incident_report_test.mjs"], cwd=ROOT)
    if c != 0 or not re.search(r"(\d+)/\1 passed", o): stop("the tests failed: " + " ".join(l.strip() for l in o.splitlines() if "✗" in l)[:240])
    ok("the incident report tests pass (" + re.search(r"(\d+/\d+) passed", o).group(1) + ", fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
okd, dm = sql(REF, """select (select count(*) from information_schema.columns where table_name = 'incident_report' and column_name = 'reviewed_at')::int as s2,
  coalesce((select data->>'incident_reports_live' from app_data where key = 'ops_settings'), 'not set') as live,
  (select count(*) from public.incident_report where not practice)::int as real""")
if not okd or not dm or dm[0]["s2"] != 1: stop("Stage 2 isn't installed (run 1147 first)", 3)
x = dm[0]; LIVE_NOW = x["live"]
say(f"  · Stages 1 to 3 are installed · the switch is {x['live']} (left as it is) · real reports so far: {x['real']}")
okz, zr = sql(REF, """select p.full_name as name, p.active, coalesce((select string_agg(r.role, ',') from public.staff_roles r where r.person_id = p.person_id and r.entity = 'cc_ihs'), '') as roles,
  (select count(*) from public.auth_identities a where a.person_id = p.person_id)::int as signin
  from public.persons p where lower(p.primary_email) = 'zach@mo-care.com' limit 1""")
if not okz or not zr: bad("zach@mo-care.com isn't on the staff list, so he can't open his cards")
else:
    z = zr[0]
    chk(z["active"] and "owner_admin" in (z["roles"] or "").split(",") and z["signin"] > 0, f"Zach ({z['name']}) can sign in and write what he found",
        f"Zach can't write findings yet (active {z['active']}, roles '{z['roles']}', sign-ins {z['signin']}): his cards still reach him, but tell Claude")
oka, ar = sql(REF, """select caregiver, coalesce(client_name, '') as client, happened_on::text as day, status from public.incident_report
  where not practice and caregiver ilike 'Ashley%' order by started_at desc limit 3""")
for a in (ar or []): say(f"  · {a['caregiver']}'s report ({a['client'] or 'work injury'}, {a['day']}): {a['status']}")
MOVE = """with items as (select data from public.app_data where key = 'ops_items')
  select count(*)::int as n from items, jsonb_array_elements(items.data) e
  where e->>'id' like 'ops_inc\\_%' and e->>'domain' = 'caregiver_performance' and coalesce(e->>'status', '') = 'open' and coalesce(e->>'owner', '') <> 'zach@mo-care.com'"""
okm, mr = sql(REF, MOVE); NMOVE = (mr or [{"n": 0}])[0]["n"] if okm else 0
say(f"  · open work injury cards not with Zach yet: {NMOVE}")
K = keys(); ANON, SVC = K.get("anon", ""), K.get("service_role", ""); L.HIDE += [ANON, SVC]
if not ANON or not SVC: stop("couldn't read the Hub's keys (the proofs need them)", 3)
if L.fails: say("  RESULT: STOPPED before anything changed."); done(3)

say(); say("PART 2 · CHANGE")
okq, r = sql(REF, "begin;\n" + open(os.path.join(ROOT, SQLF)).read() + "\ncommit;")
if not okq: bad("the database change didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Tell Claude."); done(6)
ok("\"Look into it\" is part of the report record now: who asked, why, and what Zach found, each saved once")
if not deploy(REF, FNROOT, FN, True): say(f"  STOP at {FN}. The new columns are in (harmless, empty). Tell Claude."); done(6)
if NMOVE:
    okq, r = sql(REF, """update public.app_data set data = (select jsonb_agg(case when e->>'id' like 'ops_inc\\_%' and e->>'domain' = 'caregiver_performance' and coalesce(e->>'status', '') = 'open'
        then e || jsonb_build_object('owner', 'zach@mo-care.com', 'link', '#hr/incidents') else e end order by n) from jsonb_array_elements(data) with ordinality t(e, n)) where key = 'ops_items'""")
    chk(okq, f"moved {NMOVE} open work injury card(s) to Zach", "the open work injury cards could not be moved (Claude can move them)")

say(); say("PART 3 · PROOF (practice: nothing texted)")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
URL = f"{FNB}/functions/v1/{JOB}"
VIS = {"apikey": ANON, "Authorization": "Bearer " + ANON}; OWN = {"apikey": SVC, "Authorization": "Bearer " + SVC}
codes = [http("POST", URL, b, VIS)[0] for b in ({"action": "investigate", "id": "00000000-0000-4000-8000-000000000000", "why": ["notes"], "note": "public key probe"},
         {"action": "findings", "id": "00000000-0000-4000-8000-000000000000"}, {"action": "list", "hr": True})]
chk(all(c in (401, 403) for c in codes), f"the public key can't hand a report to Zach, write findings or read his list ({codes})", f"the public key got in ({codes})")
s1, b1 = http("POST", URL, {"action": "sample"}, OWN); j1 = jload(b1); RID = j1.get("id"); L.HIDE.append(j1.get("token", ""))
if s1 != 200 or not RID: bad(f"the practice report could not be made ({s1}): {str(b1)[:200]}")
else:
    okq, pr = sql(REF, f"""do $p$ declare a text; b text; begin
      begin update public.incident_report set inv_findings = '{{"outcome":"other"}}'::jsonb, inv_at = now() where id = {lit(RID)}; a := 'saved'; exception when others then a := 'refused'; end;
      update public.incident_report set inv_ask = '{{"why":["notes"],"note":"Desktop proof"}}'::jsonb, inv_asked_by = 'desktop-step', inv_asked_at = now() where id = {lit(RID)};
      begin update public.incident_report set inv_ask = '{{}}'::jsonb where id = {lit(RID)}; b := 'changed'; exception when others then b := 'kept'; end;
      raise exception 'PROBE_RESULT:%:%', a, b; end $p$;""")
    res = re.search(r"PROBE_RESULT:(\w+):(\w+)", str(pr)) or re.search(r"PROBE_RESULT:(\w+):(\w+)", str(okq))
    chk(res and res.group(1) == "refused", "findings can't be written before someone asks", f"findings went in without an ask ({str(pr)[:160]})")
    chk(res and res.group(2) == "kept", "who asked and why can't be changed after (the proof was undone)", f"the ask could be changed ({str(pr)[:160]})")
okq, r = sql(REF, "select coalesce(data->>'incident_reports_live', 'not set') as live from app_data where key = 'ops_settings'")
chk(okq and r and r[0]["live"] == LIVE_NOW, f"the switch is exactly as before ({LIVE_NOW})")
s4, b4 = http("GET", HUB + "/incidents.js", None, {})
say("  ✓ Ask Zach and his Incidents page are live in the Hub") if s4 == 200 and "hrMount" in str(b4) else say("  · Ask Zach isn't live in the Hub yet: Claude merges the Hub change after this step")
say()
say("RESULT: " + ("DONE. Tell Claude, who merges the Hub change next (Ask Zach to look into it, and his Incidents page)." if not L.fails else "NOT COMPLETE. See the ✗ lines above. Tell Claude."))
say("Undo: Claude redeploys the Stage 3 build. The new columns stay (empty, harmless). Reports are kept by design.")
done(0 if not L.fails else 1)
