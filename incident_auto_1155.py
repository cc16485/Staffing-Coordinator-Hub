#!/usr/bin/env python3
# 1155 · STAFFING SERVER · EVERY SIGNED INCIDENT REPORT TO ZACH (Samantha 2026-10-27: "Build it so every signed client
#     incident report goes to Zach automatically to look into.")
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass; "look into it" is installed (1150).
#  2. Redeploys incident-report (no database change).
#  3. Proof in practice: a practice report, once signed, is handed to Zach by itself ("Automatic"), with no card (practice).
#     Texts nobody; the switch is left exactly as it is.
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
JOB = FN = "incident-report"; SCHEDULE = "17 * * * *"; VAULT_NAME = "hub_job_secret"; SQLF = None
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

start("STAFFING SERVER · EVERY SIGNED INCIDENT REPORT TO ZACH")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = []
for k in sorted(L.need(FNROOT, FN)):
    c2, b2 = run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"])
    if c2 != 0 or b2 != open(os.path.join(ROOT, k)).read(): drift.append(k)
if drift: stop("this isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(drift)[:240] + ")")
ok("the reviewed build is what is on GitHub's main")
if NODE:
    c, o = run([NODE, "incident_report_test.mjs"], cwd=ROOT)
    if c != 0 or not re.search(r"(\d+)/\1 passed", o): stop("the tests failed: " + " ".join(l.strip() for l in o.splitlines() if "✗" in l)[:240])
    ok("the incident report tests pass (" + re.search(r"(\d+/\d+) passed", o).group(1) + ", fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
okd, dm = sql(REF, """select (select count(*) from information_schema.columns where table_name = 'incident_report' and column_name = 'inv_asked_at')::int as inv,
  coalesce((select data->>'incident_reports_live' from app_data where key = 'ops_settings'), 'not set') as live,
  (select count(*) from public.incident_report where not practice)::int as real, (select count(*) from public.incident_report where not practice and status = 'submitted' and inv_asked_at is null and kind = 'client')::int as signed_not_zach""")
if not okd or not dm or dm[0]["inv"] != 1: stop("\"look into it\" isn't installed (run 1150 first)", 3)
x = dm[0]; LIVE_NOW = x["live"]
say(f"  · the switch is {x['live']} (left as it is) · real reports so far: {x['real']} · signed ones not with Zach yet: {x['signed_not_zach']} (from now on each goes to him as it is signed)")
K = keys(); ANON, SVC = K.get("anon", ""), K.get("service_role", ""); L.HIDE += [ANON, SVC]
if not ANON or not SVC: stop("couldn't read the Hub's keys (the proofs need them)", 3)
if L.fails: say("  RESULT: STOPPED before anything changed."); done(3)

say(); say("PART 2 · CHANGE")
if not deploy(REF, FNROOT, FN, True): say(f"  STOP at {FN}. Tell Claude."); done(6)

say(); say("PART 3 · PROOF (practice: nothing texted)")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
URL = f"{FNB}/functions/v1/{JOB}"
VIS = {"apikey": ANON, "Authorization": "Bearer " + ANON}; OWN = {"apikey": SVC, "Authorization": "Bearer " + SVC}
s1, b1 = http("POST", URL, {"action": "sample"}, OWN); j1 = jload(b1); T1 = j1.get("token", ""); RID = j1.get("id"); L.HIDE.append(T1)
if s1 != 200 or not T1: bad(f"the practice report could not be made ({s1}): {str(b1)[:200]}")
else:
    sg = http("POST", URL, {"action": "submit", "t": T1, "answers": ANS, "typed_name": "Test Caregiver", "strokes": SIG, "consent": True}, VIS)
    chk(sg[0] == 200, "a practice report signs end to end", f"signing did not finish ({sg[0]}): {str(sg[1])[:200]}")
    okq, pr = sql(REF, f"select inv_asked_by, inv_ask->'why' as why from public.incident_report where id = {lit(RID)}")
    chk(okq and pr and pr[0]["inv_asked_by"] == "system", "once signed, it was handed to Zach by itself (\"Automatic\")", f"it was not handed to Zach: {str(pr)[:160]}")
okq, r = sql(REF, "select count(*)::int as n from app_data, jsonb_array_elements(data) e where key = 'ops_items' and e->>'id' like 'ops_incinv\\_%' and e->>'title' like '%Test C.%'")
chk(okq and r and r[0]["n"] == 0, "practice made no card for Zach")
okq, r = sql(REF, "select coalesce(data->>'incident_reports_live', 'not set') as live from app_data where key = 'ops_settings'")
chk(okq and r and r[0]["live"] == LIVE_NOW, f"the switch is exactly as before ({LIVE_NOW})")
s4, b4 = http("GET", HUB + "/incidents.js", None, {})
say("  ✓ the Hub says \"Sent to Zach automatically\"") if s4 == 200 and "Sent to Zach automatically" in str(b4) else say("  · the Hub wording isn't live yet: Claude merges the Hub change after this step")
say()
say("RESULT: " + ("DONE. Tell Claude, who merges the Hub change next (the \"Sent to Zach automatically\" wording)." if not L.fails else "NOT COMPLETE. See the ✗ lines above. Tell Claude."))
say("Undo: Claude redeploys the 1150 build. Nothing in the database changed.")
done(0 if not L.fails else 1)
