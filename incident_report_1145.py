#!/usr/bin/env python3
# 1145 · STAFFING SERVER · INCIDENT REPORT, STAGE 1 (Samantha 2026-10-27: "build the incident report as planned with your three
# picks. Start with Stage 1 so Ashley's report can go out").
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (fake data only); the keys and the
#     jobs' secret are there; the Incidents owner; and, read only, whether Carol Fite's fall raised a shift-note flag.
#  2. incident_report.sql (the report record and its history, server only, never deleted; the private PDF store
#     incident-docs; the switch incident_reports_live added OFF); deploys incident-report; schedules its hourly reminder check.
#  3. Proof in PRACTICE (nothing texted, no card): the public key gets nothing, a practice report for "Test Caregiver" opens on
#     its private link, refuses a missing answer and a wrong name, signs end to end into a PDF that can't be deleted, the
#     schedule gets in, the office's own sign-ins can't read the records directly.
#  4. Asks: type YES to turn incident reports on (real texts from the office's Send, the one reminder, the cards). Anything
#     else leaves it in practice.
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
JOB = FN = "incident-report"; SCHEDULE = "17 * * * *"; VAULT_NAME = "hub_job_secret"; SQLF = "incident_report.sql"
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
ANS = {"time": "2:15 pm", "where": "Bathroom", "what": "Practice only: the Desktop step checking the report works end to end.", "hurt": "No",
       "did": "Practice only, nothing happened.", "help": ["No one"], "saw": "no one", "told": "I called the office", "told_when": "Practice, the Desktop step"}

start("STAFFING SERVER · INCIDENT REPORT, STAGE 1 (practice until you type YES)")
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
s, b = http("GET", f"{API}/v1/projects/{REF}/secrets", headers=MG())
names = {x.get("name") for x in jload(b)} if s == 200 and isinstance(jload(b), list) else set()
if "HUB_JOB_SECRET" not in names or "GHL_LOCATION_ID" not in names or not ({"GHL_TOKEN", "GHL_API_KEY"} & names): stop("the jobs' secret or the GoHighLevel key isn't there", 4)
okv, v = sql(REF, f"select count(*)::int as n from vault.decrypted_secrets where name = {lit(VAULT_NAME)}")
if not okv or not v or v[0]["n"] != 1: stop("the jobs' secret isn't in the database vault", 4)
ok("the jobs' secret and the GoHighLevel key are there (their values are never read)")
okd, dm = sql(REF, """select (to_regclass('public.document_access_log') is not null) as openlog, (to_regclass('public.incident_report') is not null) as tbl,
  (select p.primary_email from public.domains d left join public.persons p on p.person_id = d.owner_person where d.code = 'incidents' and d.entity = 'cc_ihs' limit 1) as owner""")
if not okd or not dm: stop(f"couldn't read the database: {dm}", 3)
if not dm[0]["openlog"]: stop("the document open log (document_access_log) is missing", 3)
say(f"  · the Incidents owner (gets the cards): {dm[0]['owner'] or 'not set (the person who starts the report gets the card)'}")
say(f"  · the report records are {'already there (an earlier run)' if dm[0]['tbl'] else 'new'}")
okf, fl = sql(REF, """select coalesce(x->>'level', 'no level') as level, coalesce(x->>'visit_day', '') as day, coalesce(x->>'status', '') as status, coalesce(x->>'created_at', '') as at,
    coalesce(x->>'caregiver', '') as caregiver, coalesce(jsonb_array_length(case when jsonb_typeof(x->'cn_actions') = 'array' then x->'cn_actions' end), 0) as steps
  from public.app_data a, jsonb_array_elements(a.data) x where a.key = 'ops_items' and x->>'kind' = 'care_note' and (x->>'about' ilike '%fite%' or x->>'title' ilike '%fite%')
    and coalesce(x->>'created_at', '') >= to_char(now() - interval '21 days', 'YYYY-MM-DD') order by x->>'created_at' desc limit 5""")
oks, sw = sql(REF, "select coalesce(data->>'care_notes_flag_live', 'not set') as flag, coalesce(data->>'care_notes_levels_live', 'not set') as levels from app_data where key = 'ops_settings'")
say("  · CAROL FITE (read only): shift-note flags in the last 3 weeks: " + (str(len(fl)) if okf else "could not read"))
for f in (fl or []): say(f"      {f['day'] or f['at'][:10]} · {f['level']} · {f['status']} · {f['caregiver']} · {f['steps']} step(s) recorded")
if okf and not fl: say("      none: the shift-note reader did not flag Carol's fall. Tell Claude (that needs a look too). Start Ashley's report from Carol's profile.")
if oks and sw: say(f"  · shift-note flags switch: {sw[0]['flag']} · red and yellow levels: {sw[0]['levels']}")
K = keys(); ANON, SVC = K.get("anon", ""), K.get("service_role", ""); L.HIDE += [ANON, SVC]
if not ANON or not SVC: stop("couldn't read the Hub's keys (the proofs need them)", 3)
say("  · what changes: 2 new server-only tables, 1 private PDF store, 1 new service, 1 hourly check, the switch added OFF. Nothing is texted.")

say(); say("PART 2 · CHANGE")
CHECK = """
do $v$ begin
  if has_table_privilege('authenticated', 'public.incident_report', 'select') or has_table_privilege('anon', 'public.incident_report', 'select')
     or has_table_privilege('authenticated', 'public.incident_event', 'select') or has_table_privilege('authenticated', 'public.incident_report', 'update') then
    raise exception '1145 self-check: a browser role can reach the incident records'; end if;
  if not exists (select 1 from storage.buckets where id = 'incident-docs' and public = false) then raise exception '1145 self-check: the incident-docs store is missing or public'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'incident_docs_keep' and not tgisinternal) then raise exception '1145 self-check: the keep-guard on incident-docs is missing'; end if;
end $v$;"""
okq, r = sql(REF, "begin;\n" + open(os.path.join(ROOT, SQLF)).read() + CHECK + "\ncommit;")
if not okq: bad("the database change didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Tell Claude."); done(6)
okq, r = sql(REF, "select data->>'incident_reports_live' as live from app_data where key = 'ops_settings'")
LIVE_BEFORE = bool(okq and r and r[0]["live"] == "true")
ok("the report records and the private PDF store are in: server only, never deleted · the switch is " + ("ON (already)" if LIVE_BEFORE else "OFF"))
if not deploy(REF, FNROOT, FN, True): say(f"  STOP at {FN}. The records are in (harmless, empty). Tell Claude."); done(6)
URL = f"{FNB}/functions/v1/{JOB}"
sql(REF, f"select cron.unschedule({lit(JOB)}) where exists (select 1 from cron.job where jobname = {lit(JOB)})")
okq, r = sql(REF, f"select cron.schedule({lit(JOB)}, {lit(SCHEDULE)}, {lit(command(URL, ANON))}) as id")
ok2, jb = sql(REF, f"select schedule, command from cron.job where jobname = {lit(JOB)}")
chk(okq and ok2 and jb and jb[0]["schedule"] == SCHEDULE and "x-cron-secret" in jb[0]["command"], "the reminder check: every hour (texts only 8am to 8pm, only when the switch is on)", "the schedule didn't go in: " + str(r)[:200])

say(); say("PART 3 · PROOF (practice: nothing texted, no card)")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
VIS = {"apikey": ANON, "Authorization": "Bearer " + ANON}; OWN = {"apikey": SVC, "Authorization": "Bearer " + SVC}
a1 = http("POST", URL, {"action": "list", "client_ax": "1"}, VIS)[0]; a2 = http("POST", URL, {"action": "start", "client_name": "X Y", "caregiver": "X Y", "happened_on": "2026-01-01"}, VIS)[0]
a3 = http("POST", URL, {"action": "sample"}, VIS)[0]; a4 = http("POST", URL, {}, VIS)[0]
chk(a1 in (401, 403) and a2 in (401, 403) and a3 == 401 and a4 == 401, f"the public key can't list, start, make or run anything ({a1}, {a2}, {a3}, {a4})", f"the public key got in ({a1}, {a2}, {a3}, {a4})")
s1, b1 = http("POST", URL, {"action": "sample"}, OWN); j1 = jload(b1); T1 = j1.get("token", ""); L.HIDE.append(T1)
if s1 != 200 or not T1: bad(f"the practice report could not be made ({s1}): {str(b1)[:200]}")
else:
    v = jload(http("POST", URL, {"action": "view", "t": T1}, VIS)[1])
    chk(v.get("first") == "Test" and v.get("practice") is True and any(q.get("label") == "Was Test hurt?" for q in v.get("questions", [])), "the practice report opens on its private link: the questions, marked practice", f"the private link did not open as it should: {str(v)[:200]}")
    w = http("POST", URL, {"action": "submit", "t": T1, "answers": {**ANS, "what": ""}, "typed_name": "Test Caregiver", "strokes": SIG, "consent": True}, VIS)
    chk(w[0] == 400, "a missing answer is refused")
    w = http("POST", URL, {"action": "submit", "t": T1, "answers": ANS, "typed_name": "Somebody Else", "strokes": SIG, "consent": True}, VIS)
    chk(w[0] == 400, "a name that isn't theirs is refused")
    sg = http("POST", URL, {"action": "submit", "t": T1, "answers": ANS, "typed_name": "Test Caregiver", "strokes": SIG, "consent": True}, VIS); jg = jload(sg[1])
    chk(sg[0] == 200 and jg.get("copy_url"), "it signs end to end into a PDF; their copy link comes back", f"signing did not finish ({sg[0]}): {str(sg[1])[:200]}")
    if jg.get("copy_url"):
        cs, cb = http("GET", jg["copy_url"], None, {})
        chk(cs == 200 and str(cb).startswith("%PDF"), "the signed copy is a real PDF", f"the copy did not open as a PDF ({cs})")
    chk(http("POST", URL, {"action": "view", "t": T1}, VIS)[0] == 404, "once signed, the link stops working")
okq, pc = sql(REF, """select (select count(*) from public.incident_report where source_item_id = 'practice-sample' and status = 'submitted' and pdf_path is not null and practice)::int as done,
  (select count(*) from storage.objects where bucket_id = 'incident-docs' and name like 'practice/%')::int as pdfs,
  (select count(*) from public.app_data a, jsonb_array_elements(a.data) x where a.key = 'ops_items' and x->>'id' like 'ops_inc_%')::int as cards""")
chk(okq and pc and pc[0]["done"] >= 1 and pc[0]["pdfs"] >= 1, f"the practice report is kept with its PDF ({pc[0]['done'] if pc else '?'} on file) and made no card", f"the practice records are not as expected: {pc}")
okq, dl = sql(REF, """do $p$ begin
  delete from storage.objects where bucket_id = 'incident-docs' and name like 'practice/%';
  raise exception 'PROBE_RESULT:deleted';
exception when others then if sqlerrm like 'PROBE_RESULT:deleted%' then raise; else raise exception 'PROBE_RESULT:kept'; end if; end $p$;""")
chk("PROBE_RESULT:kept" in str(dl), "the PDFs can't be deleted", "a PDF in incident-docs could be deleted")
okq, dl = sql(REF, """do $p$ begin
  delete from public.incident_report where source_item_id = 'practice-sample';
  raise exception 'PROBE_RESULT:deleted';
exception when others then if sqlerrm like 'PROBE_RESULT:deleted%' then raise; else raise exception 'PROBE_RESULT:kept'; end if; end $p$;""")
chk("PROBE_RESULT:kept" in str(dl), "the report records can't be deleted", "an incident report could be deleted")
okq, rq = sql(REF, command(URL + "?auth_check=1", ANON).rstrip(";") + " as id")
got = None; waited = 0.0
while okq and rq and waited <= POLL_MAX:
    ok3, rr = sql(REF, f"select status_code, content from net._http_response where id = {int(rq[0]['id'])}")
    if ok3 and rr: got = rr[0]; break
    time.sleep(POLL); waited += POLL
chk(got and got["status_code"] == 200 and jload((got or {}).get("content") or "{}").get("caller") == "cron", "its schedule gets in" + ("" if got else " (no answer)"))
if not LIVE_BEFORE:
    sD, bD = http("POST", URL, {}, OWN, 200)
    chk(sD == 200 and jload(bD).get("live") is False, "one reminder run with the switch off: it sent nothing", f"the proof run answered {sD}: {str(bD)[:160]}")
def probe(email):
    good, r = sql(REF, f"""do $p$ declare uid uuid; meta jsonb; res text := ''; n int; begin
      select u.id, coalesce(u.raw_app_meta_data, '{{}}'::jsonb) into uid, meta from auth.users u where lower(u.email) = {lit(email)} and u.banned_until is null;
      if uid is null then raise exception 'PROBE_RESULT:nouser=1'; end if;
      perform set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'role', 'authenticated', 'app_metadata', meta)::text, true);
      perform set_config('request.jwt.claim.sub', uid::text, true);
      set local role authenticated;
      begin select count(*) into n from public.incident_report; res := res || 'read=1;'; exception when others then res := res || 'read=0;'; end;
      raise exception 'PROBE_RESULT:%', res; end $p$;""")
    m_ = re.search(r"PROBE_RESULT:([a-z0-9_=; ]*)", str(r)) if not good else None
    return dict(kv.split("=") for kv in m_.group(1).split(";") if "=" in kv) if m_ else None
for em in OFFICE:
    p = probe(em)
    if p is None or p.get("nouser"): say(f"  · could not test as {em} (no sign-in found)")
    elif p.get("read") == "0": ok(f"acting as {em} (undone after): can't read the incident records directly (only through the Hub)")
    else: bad(f"acting as {em}, the incident records could be read directly")
s4, b4 = http("GET", HUB + "/incident.html", None, {})
say("  ✓ the caregiver's report page is live at cc.mo-care.com/incident.html") if s4 == 200 and "incident-report" in str(b4) else say("  · the caregiver's page and the office buttons aren't live yet: Claude merges the Hub change after this step")

say()
if L.fails: say("RESULT: CHECK THE ✗ LINES ABOVE. Nothing was turned on. Tell Claude."); done(9)
say("PART 4 · TURN IT ON?")
if LIVE_BEFORE: say("  · incident reports are already ON. Nothing to do.")
else:
    say("  ON means: when the office presses Send, the caregiver really gets the text; if they haven't filled it in after 24 hours")
    say("  the Hub texts them ONE reminder (8am to 8pm) and the Incidents card turns red; the office gets a card for each report.")
    say("  Families are never contacted. Nothing is texted by itself when a flag fires.")
    try: ans = os.environ.get("SB_ANSWER") if "SB_ANSWER" in os.environ else input("  Type YES to turn incident reports on now (anything else keeps practice): ")
    except EOFError: ans = ""
    if str(ans).strip() == "YES":
        okq, r = sql(REF, "update public.app_data set data = data || jsonb_build_object('incident_reports_live', true, 'incident_reports_live_since', now()::text) where key = 'ops_settings' returning data->>'incident_reports_live' as live")
        chk(okq and r and r[0]["live"] == "true", "incident reports are ON (your YES, " + time.strftime("%Y-%m-%d %H:%M") + ")", "the switch did not turn on: " + str(r)[:200])
    else: say("  · left in PRACTICE. Run this step again any time and type YES to turn it on.")
say()
say("RESULT: " + ("DONE. Tell Claude, who merges the Hub change next (the report page and the office buttons)." if not L.fails else "NOT COMPLETE. See the ✗ lines above."))
say("Undo: Claude unschedules incident-report; the switch off stops texts at once. Reports and PDFs are kept by design.")
done(0 if not L.fails else 1)
