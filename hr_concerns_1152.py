#!/usr/bin/env python3
# 1152 · STAFFING SERVER · TELL ZACH + NEW COACHING TALK (Samantha 2026-10-27: "build it: Tell Zach on the caregiver's
#     Performance tab for anyone in the office, and + New coaching talk for owners only. Coordinators ask, Zach decides.")
#  1. Checks first (nothing changes): the reviewed database change is GitHub's main; the HR tables and the coaching
#     tracker it builds on are installed; who Zach's alerts and cards go to.
#  2. Adds hr_case_add (Tell Zach; coaching talks started by owners or Care Coordinators) and hr_case_decide (Zach decides) to the database. No server
#     function changes. Texts nobody.
#  3. Proof: the public key can't call either; a signed-in page still can't add HR cases directly; someone not signed in
#     is refused; nothing was added.
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
SQLF = "hr_concerns.sql"
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
start("STAFFING SERVER · TELL ZACH + NEW COACHING TALK")
say("PART 1 · READ ONLY (nothing changes)")
sqh = hashlib.sha256(open(os.path.join(ROOT, SQLF), "rb").read()).hexdigest()
if sqh != os.environ.get("SB_SQL_SHA", ""): stop("the database change is not the reviewed build")
ok("the database change is the reviewed build")
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
c2, b2 = run(["git", "-C", ROOT, "show", f"{MAIN}:{SQLF}"])
if c2 != 0 or b2 != open(os.path.join(ROOT, SQLF)).read(): stop("this isn't the same as GitHub's main yet (merge the pull request first)")
ok("the reviewed build is what is on GitHub's main")
okd, dm = sql(REF, """select (to_regclass('public.hr_cases') is not null) as cases, (to_regclass('public.hr_coaching') is not null) as coach,
  (select count(*) from pg_proc where proname in ('hr_coaching_act','upsert_app_data_item','hr_lead_email','hr_short_name','desk_hub_ok','desk_me','desk_is_owner'))::int as fns,
  public.hr_lead_email() as lead, coalesce((select data->>'hr_alerts_live' from app_data where key = 'ops_settings'), 'not set') as alerts,
  (select count(*) from public.hr_cases where rule in ('office_concern','owner_coaching'))::int as already""")
if not okd or not dm or not dm[0]["cases"] or not dm[0]["coach"] or dm[0]["fns"] < 7: stop("the HR tables or the coaching tracker aren't installed as expected: " + str(dm)[:200], 3)
x = dm[0]
say(f"  · Tell Zach goes to: {x['lead']} · Zach's text and email alerts are {'on' if x['alerts'] == 'true' else 'off (he sees it on My Work and his Performance page)'}")
if x["already"]: say(f"  · already on file from an earlier run: {x['already']}")
K = keys(); ANON = K.get("anon", ""); L.HIDE += [ANON, K.get("service_role", "")]
if not ANON: stop("couldn't read the Hub's keys (the proofs need them)", 3)
if L.fails: say("  RESULT: STOPPED before anything changed."); done(3)

say(); say("PART 2 · CHANGE")
okq, r = sql(REF, "begin;\n" + open(os.path.join(ROOT, SQLF)).read() + "\ncommit;")
if not okq: bad("the database change didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Tell Claude."); done(6)
ok("Tell Zach and New coaching talk are in the database (who may do what is checked there)")

say(); say("PART 3 · PROOF (nothing is added, nobody is texted)")
REST = f"{FNB}/rest/v1/rpc"
VIS = {"apikey": ANON, "Authorization": "Bearer " + ANON}
a1 = http("POST", REST + "/hr_case_add", {"p": {"type": "concern", "caregiver": "Test Caregiver", "what": "public key probe, nothing real", "happened_on": "2026-10-27"}}, VIS)[0]
a2 = http("POST", REST + "/hr_case_decide", {"p_id": "x", "p": {"decision": "nothing", "note": "probe"}}, VIS)[0]
chk(a1 in (401, 403, 404) and a2 in (401, 403, 404), f"the public key can't tell Zach or decide anything ({a1}, {a2})", f"the public key got in ({a1}, {a2})")
okq, pr = sql(REF, """select has_table_privilege('authenticated', 'public.hr_cases', 'insert') as ins, has_function_privilege('authenticated', 'public.hr_case_add(jsonb)', 'execute') as can""")
chk(okq and pr and not pr[0]["ins"] and pr[0]["can"], "a signed-in page can only go through the door (it can't add HR cases directly)")
okq, pr = sql(REF, """select public.hr_case_add('{"type":"concern","caregiver":"Test Caregiver","what":"probe from the Desktop step","happened_on":"2026-10-27"}'::jsonb)""")
chk(not okq and "Only the office" in str(pr), "someone not signed in is refused", f"it was not refused as expected: {str(pr)[:160]}")
okq, pr = sql(REF, "select count(*)::int as n from public.hr_cases where rule in ('office_concern','owner_coaching')")
chk(okq and pr and pr[0]["n"] == x["already"], "nothing was added by the proof")
s4, b4 = http("GET", HUB + "/hr.js", None, {})
say("  ✓ Tell Zach and New coaching talk are live in the Hub") if s4 == 200 and "hrConcernN" in str(b4) else say("  · the Hub buttons aren't live yet: Claude merges the Hub change after this step")
say()
say("RESULT: " + ("DONE. Tell Claude, who merges the Hub change next (Tell Zach and New coaching talk)." if not L.fails else "NOT COMPLETE. See the ✗ lines above. Tell Claude."))
say("Undo: the two new database doors can be dropped; nothing else changed. Cases are kept by design.")
done(0 if not L.fails else 1)
