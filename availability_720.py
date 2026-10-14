#!/usr/bin/env python3
# 720 · AVAILABILITY: THE OUTSIDE-HOURS BOX, CALL-OFFS CHECK AVAILABILITY, THE 30-DAY TEXT (Samantha, 2026-10-14).
# Her asks: caregivers set availability in Step 1 and tick a box to still get texts about shifts outside it (Step 1
# availability v3, approved "approve availability v3"); "we need them to check availability" (call-off lists); and every
# active caregiver gets an availability text every 30 days with their own link: keep it the same or update it, and the
# outside-hours box every time.
# Part 1 (read only): the reviewed build; every service this step deploys is live as some version GitHub main had (if
#   one holds a change that was never on main, it STOPS and nothing changes: it would be overwritten); the jobs' secret.
# Part 2: deploy step1-sign, caregiver-connect, caregiver-availability, coverage-shifts, coverage-run (gateway settings
#   kept) and the new availability-checkin (sign-in check on); its weekday schedule (noon CDT / 11am CST).
#   The 30-day texts stay in PRACTICE until she turns on "30-day availability texts" on the Admin page.
# Part 3 (proof; nothing is sent): each service is live as tested; the Step 1 preview has availability v3 with the new
#   question, accepted for real applicants; the 30-day job refuses outsiders, lets its schedule in, and a practice run
#   counts who is due; the availability page still refuses a forged link and answers by phone.
# Prints counts only: no name, number, email, key or secret.
import os, json, subprocess
os.environ.setdefault("SB_STEP", "720")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
ROOT = os.path.dirname(os.path.dirname(FNROOT))
BASE = os.environ.get("SB_BASE_COMMIT", "7fcf815")   # main before this change: what each service must be live as now
CHANGED = ["step1-sign", "caregiver-connect", "caregiver-availability", "coverage-shifts", "coverage-run"]
NEW = "availability-checkin"; VAULT_NAME = "hub_job_secret"; SCHEDULE = "0 17 * * 1-5"
def keys():
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_secret_") or v.startswith("sb_publishable_")) and "·" not in v and "*" not in v
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys{q}", headers=MG())
        if s != 200: continue
        try: arr = json.loads(b)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        got = {k.get("name"): k.get("api_key", "") for k in arr if isinstance(k, dict) and usable(k.get("api_key", ""))}
        if got.get("service_role") and got.get("anon"): return got
    return {}
def lit(v): return "'" + str(v).replace("'", "''") + "'"
def jget(b, k):
    try: return json.loads(b).get(k)
    except Exception: return None
_ON_MAIN = {}
def on_main(rel):
    """every version of this file that was ever on GitHub main up to BASE (a live copy deployed from an older main is fine)"""
    if rel not in _ON_MAIN:
        got = set()
        cs = subprocess.run(["git", "-C", ROOT, "log", "--format=%H", "-n", "300", BASE, "--", rel], capture_output=True, text=True).stdout.split()
        for c in cs:
            p = subprocess.run(["git", "-C", ROOT, "show", f"{c}:{rel}"], capture_output=True)
            if p.returncode == 0: got.add(hashlib.sha256(p.stdout).hexdigest())
        _ON_MAIN[rel] = got
    return _ON_MAIN[rel]
def command(url, anon):
    return ("select net.http_post(url := " + lit(url) + ", headers := jsonb_build_object('Content-Type', 'application/json', "
            "'Authorization', " + lit("Bearer " + anon) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")), "
            "body := '{}'::jsonb, timeout_milliseconds := 120000);")

start("AVAILABILITY: OUTSIDE-HOURS BOX, CALL-OFFS CHECK AVAILABILITY, 30-DAY TEXT")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
VJ = {}
for fn in CHANGED:
    s_, m_ = fmeta(REF, fn)
    if s_ != 200 or not isinstance((m_ or {}).get("verify_jwt"), bool): bad(f"could not read {fn}'s settings"); continue
    VJ[fn] = m_["verify_jwt"]
    okl, livef = live_files(REF, fn)
    if not okl: bad(f"could not download the live {fn} to compare"); continue
    off = [k for k, v in livef.items() if v not in on_main(k)]
    if off: bad(f"{fn} is live with changes that are not on GitHub ({len(off)} file(s)): deploying would overwrite them")
    else: say(f"  ✓ {fn} is live as GitHub main had it (version {(m_ or {}).get('version', '?')}, gateway sign-in check {'on' if VJ[fn] else 'off'}, kept)")
sN, _ = fmeta(REF, NEW)
ok, st = sql(REF, "select (select count(*) from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")::int as vault, "
                  "(select count(*) from cron.job where jobname = " + lit(NEW) + ")::int as job")
if not ok or not st or st[0]["vault"] != 1: bad("the jobs' secret (which also seals the links) is not in the vault")
else: say(f"  ✓ the jobs' secret is there · the 30-day job is {'already there (an earlier run)' if sN == 200 else 'new'}")
K = keys(); ANON, SVC = K.get("anon", ""), K.get("service_role", ""); HIDE.extend([ANON, SVC])
if not (ANON and SVC): bad("could not read the project's keys (the schedule and the proofs need them)")
say("  · what changes: 5 services redeployed + 1 new (the 30-day text, in practice). No table, no switch, nothing texted by this step.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
for fn in CHANGED + [NEW]:
    if not deploy(REF, FNROOT, fn, VJ.get(fn, True)): say(f"  RESULT: STOPPED at {fn}. Services above it are deployed. Tell Claude."); done(6)
URL = f"{FNB}/functions/v1/{NEW}"
sql(REF, f"select cron.unschedule({lit(NEW)}) where exists (select 1 from cron.job where jobname = {lit(NEW)})")
ok, r = sql(REF, f"select cron.schedule({lit(NEW)}, {lit(SCHEDULE)}, {lit(command(URL, ANON))}) as id")
ok2, jb = sql(REF, f"select schedule, command from cron.job where jobname = {lit(NEW)}")
g = ok and ok2 and jb and jb[0]["schedule"] == SCHEDULE and "x-cron-secret" in jb[0]["command"] and "vault.decrypted_secrets" in jb[0]["command"]
say("  ✓ its schedule: weekdays at noon CDT (11am in winter), carrying the jobs' secret from the vault · texts stay in PRACTICE until you turn them on (Admin page)") if g else bad("the 30-day job's schedule did not go in")

say(); say("PART 3 · PROOF (nothing is sent)")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
VIS = {"apikey": ANON, "Authorization": "Bearer " + ANON}
s1, b1 = http("POST", f"{FNB}/functions/v1/step1-sign", {"action": "preview"}, VIS)
try: forms = [f for f in (json.loads(b1).get("forms") or []) if isinstance(f, dict)]
except Exception: forms = []
av = next((f for f in forms if f.get("key") == "availability"), {})
items = [i.get("id") for s in (av.get("sections") or []) for i in (s.get("items") or [])]
if s1 == 200 and av.get("version") == 3 and av.get("approved_for_real") is True and "outside_shift_texts" in items:
    say("  ✓ the Step 1 preview has the availability form at version 3 with the outside-hours question, approved for real applicants")
else: bad(f"the Step 1 preview answered {s1}: availability version {av.get('version')}, approved {av.get('approved_for_real')}")
s2, b2 = http("POST", f"{FNB}/functions/v1/step1-sign", {"action": "preview", "approval_check": [{"form": "availability", "version": 3}, {"form": "availability", "version": 2}]}, VIS)
try: ac = json.loads(b2).get("approval_check") or []
except Exception: ac = []
g = s2 == 200 and len(ac) == 2 and ac[0].get("accepted") is True
say("  ✓ the server's approval check accepts availability v3 for a real applicant") if g else bad(f"the approval check answered {s2}: {ac}")
a1 = http("POST", URL + "?auth_check=1", {}, VIS)[0]
say(f"  ✓ the 30-day job refuses the public key ({a1})") if a1 == 401 else bad(f"the 30-day job let the public key in ({a1})")
ok, rq = sql(REF, command(URL + "?auth_check=1", ANON).rstrip(";") + " as id")
got = None; waited = 0.0
while ok and rq and waited <= 40:
    ok3, rr = sql(REF, f"select status_code, content from net._http_response where id = {int(rq[0]['id'])}")
    if ok3 and rr: got = rr[0]; break
    time.sleep(2); waited += 2
g = got and got["status_code"] == 200 and jget(got["content"], "caller") == "cron"
say("  ✓ its schedule gets in") if g else bad(f"its schedule was not let in ({got['status_code'] if got else 'no answer'})")
sD, bD = http("POST", URL + "?dry=1", {}, {"apikey": SVC, "Authorization": "Bearer " + SVC}, 200)
try: j = json.loads(bD)
except Exception: j = {}
if sD == 200 and j.get("held"): say(f"  ✓ a practice run answered (it held: {j['held']})")
elif sD == 200 and j.get("live") is False:
    sk = j.get("skipped") or {}
    say(f"  ✓ a practice run (nothing sent): {j.get('due', 0)} caregivers due, {j.get('this_run', 0)} would be texted today "
        f"({j.get('on_file', 0)} keep-or-update, {j.get('nothing_on_file', 0)} fill-it-in) · left out: {sk.get('nurse', 0)} nurses, "
        f"{sk.get('prn_team', 0)} PRN Team, {sk.get('not_in_axiscare', 0)} not active in AxisCare, {sk.get('no_phone', 0)} no phone")
else: bad(f"the practice run answered {sD}: {str(bD)[:160]}")
AV = f"{FNB}/functions/v1/caregiver-availability"
f1, fb = http("POST", AV, {"c": "1", "e": 9999999999, "t": "A" * 43}, VIS)
f2, pb = http("POST", AV, {"phone": "0000000000"}, VIS)
g = f1 == 401 and "phone number instead" in fb and f2 == 200 and jget(pb, "unknown") is True
say(f"  ✓ the availability page: a forged link is refused ({f1}); a phone number still answers ({f2})") if g else bad(f"the availability page answered {f1}/{f2}")
say("  · tested before deploying: 30-day job 14, outside-hours page 9, Team Builder 6, call-offs 27, Step 1 documents 45, Step 1 sign 164, practice runs 48, landing 14; message check 4/4.")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · Step 1 asks the outside-hours question, call-off lists check availability, and the 30-day text runs in practice until you turn it on (Admin page, 30-day availability texts).")
say("Undo: unschedule availability-checkin and redeploy the five services from main before this change (Claude can).")
done(0)
