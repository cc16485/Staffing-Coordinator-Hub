#!/usr/bin/env python3
# 1147 · STAFFING SERVER · INCIDENT REPORT, STAGE 2 (Samantha 2026-10-27, "continue"): the office review checklist on a signed
# report (family told, medical care, care plan change, abuse or neglect with the state hotline) and a caregiver's reports.
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass; Stage 1 (1145) is installed.
#  2. incident_review.sql (4 review columns; a saved review can never change); redeploys incident-report.
#  3. Proof: the public key gets nothing; a practice report signs end to end, can be reviewed once, and the review can't be
#     changed after; the reminder schedule is still there. Texts nobody. The switch is left exactly as it is.
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
JOB = FN = "incident-report"; SCHEDULE = "17 * * * *"; VAULT_NAME = "hub_job_secret"; SQLF = "incident_review.sql"
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

start("STAFFING SERVER · INCIDENT REPORT, STAGE 2 (office review, caregiver list)")
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
okd, dm = sql(REF, """select (to_regclass('public.incident_report') is not null) as tbl, (select count(*) from cron.job where jobname = 'incident-report')::int as job,
  coalesce((select data->>'incident_reports_live' from app_data where key = 'ops_settings'), 'not set') as live,
  (select count(*) from public.incident_report where not practice)::int as real, (select count(*) from public.incident_report where not practice and status = 'submitted')::int as signed""")
if not okd or not dm or not dm[0]["tbl"]: stop("Stage 1 isn't installed (run 1145 first)", 3)
x = dm[0]; LIVE_NOW = x["live"]
say(f"  · Stage 1 is installed · the switch is {x['live']} (left as it is) · real reports so far: {x['real']} ({x['signed']} signed)")
if x["job"] != 1: bad("the hourly reminder check is missing (it should be there from 1145)")
K = keys(); ANON, SVC = K.get("anon", ""), K.get("service_role", ""); L.HIDE += [ANON, SVC]
if not ANON or not SVC: stop("couldn't read the Hub's keys (the proofs need them)", 3)
s0, m0 = fmeta(REF, FN); say(f"  · incident-report is live as version {(m0 or {}).get('version', '?')}")
if L.fails: say("  RESULT: STOPPED before anything changed."); done(3)

say(); say("PART 2 · CHANGE")
okq, r = sql(REF, "begin;\n" + open(os.path.join(ROOT, SQLF)).read() + "\ncommit;")
if not okq: bad("the database change didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Tell Claude."); done(6)
ok("the review is part of the report record now: saved once, never changed")
if not deploy(REF, FNROOT, FN, True): say(f"  STOP at {FN}. The new columns are in (harmless, empty). Tell Claude."); done(6)

say(); say("PART 3 · PROOF (practice: nothing texted)")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
URL = f"{FNB}/functions/v1/{JOB}"
VIS = {"apikey": ANON, "Authorization": "Bearer " + ANON}; OWN = {"apikey": SVC, "Authorization": "Bearer " + SVC}
a1 = http("POST", URL, {"action": "list", "caregiver": "Test Caregiver"}, VIS)[0]; a2 = http("POST", URL, {"action": "review", "id": "00000000-0000-4000-8000-000000000000"}, VIS)[0]
chk(a1 in (401, 403) and a2 in (401, 403), f"the public key can't list or review ({a1}, {a2})", f"the public key got in ({a1}, {a2})")
s1, b1 = http("POST", URL, {"action": "sample"}, OWN); j1 = jload(b1); T1 = j1.get("token", ""); L.HIDE.append(T1)
if s1 != 200 or not T1: bad(f"the practice report could not be made ({s1}): {str(b1)[:200]}")
else:
    sg = http("POST", URL, {"action": "submit", "t": T1, "answers": ANS, "typed_name": "Test Caregiver", "strokes": SIG, "consent": True}, VIS)
    chk(sg[0] == 200, "a practice report signs end to end", f"signing did not finish ({sg[0]}): {str(sg[1])[:200]}")
    RID = j1.get("id")
    okq, rv = sql(REF, f"""do $p$ begin
      update public.incident_report set review = '{{"note":"Desktop proof"}}'::jsonb, reviewed_by = 'desktop-step', reviewed_at = now() where id = {lit(RID)};
      begin update public.incident_report set review = '{{}}'::jsonb where id = {lit(RID)}; raise exception 'PROBE_RESULT:changed';
      exception when others then if sqlerrm like 'PROBE_RESULT%' then raise; end if; end;
      raise exception 'PROBE_RESULT:kept'; end $p$;""")
    chk("PROBE_RESULT:kept" in str(rv), "a practice review saves once and can't be changed after (then undone: the proof leaves no review behind)", f"the review lock did not hold: {str(rv)[:200]}")
okq, jb = sql(REF, "select count(*)::int as n from cron.job where jobname = 'incident-report'")
chk(okq and jb and jb[0]["n"] == 1, "the hourly reminder check is still scheduled")
okq, r = sql(REF, "select coalesce(data->>'incident_reports_live', 'not set') as live from app_data where key = 'ops_settings'")
chk(okq and r and r[0]["live"] == LIVE_NOW, f"the switch is exactly as before ({LIVE_NOW})")
s4, b4 = http("GET", HUB + "/incidents.js", None, {})
say("  ✓ the office review is live in the Hub") if s4 == 200 and "reviewWire" in str(b4) else say("  · the office review screen isn't live yet: Claude merges the Hub change after this step")
say()
say("RESULT: " + ("DONE. Tell Claude, who merges the Hub change next (the review form and the caregiver list)." if not L.fails else "NOT COMPLETE. See the ✗ lines above. Tell Claude."))
say("Undo: Claude redeploys the Stage 1 build; the new review columns are harmless left in place.")
done(0 if not L.fails else 1)
