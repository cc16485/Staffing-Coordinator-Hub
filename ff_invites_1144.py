#!/usr/bin/env python3
# 1144 · STAFFING SERVER · FRIENDS & FAMILY $100 TRACKING (Samantha 2026-10-27: "Yes, start step 5: the $100 credit and bonus tracking,
# live as I decided.")
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (fake data only); 1143's records are there.
#  2. ff_rewards_1144.sql (the $100 lines, ff_rewards); deploys ff-invite-check (its gateway setting kept). The schedule stays.
#  3. Proves it: the public can't run the check or read the lines. Then, only while Invitations are OFF, one run: today's list
#     and the $100 lines it found (sends nothing).
# Texts and emails nobody. Nothing is approved, applied or paid by itself: owners do that in the Friends & Family tab.
import json, os, subprocess, shutil, time, hashlib
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, sql, deploy, start, check_build, lit, MG, API

REF = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
if NODE == "none": NODE = ""
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
JOB = FN = "ff-invite-check"; VAULT_NAME = "hub_job_secret"; SQLF = "ff_rewards_1144.sql"
POLL = float(os.environ.get("SB_POLL", "2")); POLL_MAX = float(os.environ.get("SB_POLL_MAX", "40"))
ok = lambda s: say("  ✓ " + s)
def chk(good, msg, badmsg=None): (ok(msg) if good else bad(badmsg or msg))
def run(args, cwd=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)
def keys():
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_publishable_") or v.startswith("sb_secret_")) and "·" not in v and "*" not in v
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys{q}", headers=MG())
        if s != 200: continue
        try: arr = json.loads(b)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        got = {k.get("name"): k.get("api_key", "") for k in arr if isinstance(k, dict) and usable(k.get("api_key", ""))}
        if got.get("anon"): return got
    return {}
def command(url, anon):
    return ("select net.http_post(url := " + lit(url) + ", headers := jsonb_build_object('Content-Type', 'application/json', "
            "'Authorization', " + lit("Bearer " + anon) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")), "
            "body := '{}'::jsonb, timeout_milliseconds := 290000);")

start("STAFFING SERVER · FRIENDS & FAMILY $100 TRACKING (nothing pays by itself)")
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
    for t, must in (("ff_invite_check_test.mjs", "121/121"), ("audience_guard_test.mjs", "21/21"), ("campaign_auto_hold_test.mjs", "8/8")):
        c, o = run([NODE, t], cwd=ROOT)
        if c != 0 or must not in o: stop(f"the tests failed ({t}): " + " ".join(l.strip() for l in o.splitlines() if "✗" in l)[:240])
    ok("the invitation and $100 tracking tests pass (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
okq, r = sql(REF, "select to_regclass('public.ff_invites') is not null as t, (select count(*)::int from cron.job where jobname = " + lit(JOB) + ") as j, (select data->>'ff_invites_live' from app_data where key = 'ops_settings') as live")
if not okq or not r or not r[0]["t"] or r[0]["j"] != 1: stop("1143's records or the daily schedule aren't there (run 1143 first)", 4)
live = r[0]["live"] == "true"
ok("1143's records and the daily schedule are there · Invitations are " + ("ON" if live else "OFF"))
s1, m1 = L.fmeta(REF, FN)
if s1 != 200 or not m1 or "verify_jwt" not in m1: stop(f"couldn't read how {FN} is set up live ({s1})", 3)
gate = bool(m1["verify_jwt"]); say(f"  · {FN} is live as version {m1.get('version', '?')}, gateway sign-in check {'on' if gate else 'off'} (kept)")
K = keys(); ANON, SVC = K.get("anon", ""), K.get("service_role", ""); L.HIDE += [ANON, SVC]
if not ANON or not SVC: stop("couldn't read the Hub's keys", 3)

say(); say("PART 2 · CHANGE")
okq, r = sql(REF, "begin;\n" + open(os.path.join(ROOT, SQLF)).read() + "\ncommit;")
if not okq: bad("the database change didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Tell Claude."); done(6)
ok("the $100 lines record (ff_rewards) is in place")
if not deploy(REF, FNROOT, FN, gate): say(f"  STOP at {FN}. Tell Claude."); done(6)
URL = f"{FNB}/functions/v1/{JOB}"

say(); say("PART 3 · PROOF (nothing is sent)")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
a1 = http("POST", URL + "?auth_check=1", {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
chk(a1 == 401, f"the public can't run the check ({a1})")
a2 = http("POST", URL, {"action": "list"}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
chk(a2 in (401, 403), f"the public can't use the owner actions ({a2})")
sC, bC = http("GET", f"{FNB}/rest/v1/ff_rewards?select=*&limit=1", None, {"apikey": ANON, "Authorization": "Bearer " + ANON})
chk(sC != 200 or bC.strip() in ("[]", ""), f"the public can't read the $100 lines ({sC})")
if live:
    say("  · Invitations are ON, so no proof run was made (it would send what is owed). Tomorrow morning's run fills the $100 lines.")
else:
    say(); say("  One run now (this takes a minute: it reads AxisCare)...")
    sD, bD = http("POST", URL, {}, {"apikey": SVC, "Authorization": "Bearer " + SVC}, 300)
    try: j = json.loads(bD)
    except Exception: j = {}
    chk(sD == 200 and j.get("sent") == 0 and j.get("saved") is True and isinstance(j.get("rewards"), dict), "it ran with Invitations off, sent nothing, and checked the $100 lines", f"the run answered {sD}: {str(bD)[:200]}")
    for p in j.get("problems") or []: bad("couldn't read: " + str(p))
    rw = j.get("rewards") or {}
    say(f"  $100 lines: {rw.get('lines', 0)} in all ({rw.get('created', 0)} new today), {rw.get('ready', 0)} ready for approval.")
    if not rw.get("lines"): say("  (None yet: a line starts when someone who came through a Friends & Family link has their first visit.)")
say()
say("  1144: " + ("DONE. The $100 lines are tracked every morning. Approve, Not earned, Credit applied and Paid are in the Friends & Family tab once the Hub part is merged. Nobody was texted or emailed." if not L.fails else "NOT COMPLETE. See the ✗ lines above."))
say("  Rollback: Claude redeploys the earlier ff-invite-check; the lines stay saved.")
done(0 if not L.fails else 1)
