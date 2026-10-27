#!/usr/bin/env python3
# 1142 · STAFFING SERVER · FRIENDS & FAMILY INVITE CHECK FIX (2026-10-27). 1141 installed the daily check, but its first run
# couldn't read the client issues (it asked for a column that table doesn't have), so every family was held, and it listed
# AxisCare's "Canceled Shift" placeholder as a caregiver. This puts the fixed ff-invite-check live and runs today's list again.
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (fake data only); 1141's list table
#     and schedule are there.
#  2. Deploys ff-invite-check (its gateway setting kept). No database change, the schedule stays as 1141 set it.
#  3. Proves it: the public key gets nothing, the public can't read the list. Then today's real list again.
# Texts and emails nobody. Nothing is sent even with the switch on (sending comes with step 4). Safe to run again.
import json, os, subprocess, shutil, time, hashlib
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, sql, deploy, start, check_build, lit, MG, API

REF = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
if NODE == "none": NODE = ""
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
JOB = FN = "ff-invite-check"; SCHEDULE = "20 15 * * *"; VAULT_NAME = "hub_job_secret"; SQLF = "ff_invites_1141.sql"   # not run again: 1141 put it in
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

start("STAFFING SERVER · FRIENDS & FAMILY INVITE CHECK FIX (lists only, switch OFF)")
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
    for t, must in (("ff_invite_check_test.mjs", "93/93"), ("audience_guard_test.mjs", "21/21"), ("campaign_auto_hold_test.mjs", "8/8")):
        c, o = run([NODE, t], cwd=ROOT)
        if c != 0 or must not in o: stop(f"the tests failed ({t}): " + " ".join(l.strip() for l in o.splitlines() if "✗" in l)[:240])
    ok("the invite check and campaign guard tests pass (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
okq, r = sql(REF, "select to_regclass('public.ff_invite_runs') is not null as t, (select count(*)::int from cron.job where jobname = " + lit(JOB) + ") as j, (select data->>'ff_invites_live' from app_data where key = 'ops_settings') as live")
if not okq or not r or not r[0]["t"] or r[0]["j"] != 1: stop("1141's list table or its schedule isn't there (run 1141 first)", 4)
live = r[0]["live"] == "true"
ok("1141's list table and daily schedule are there · the switch is " + ("ON" if live else "OFF"))
s1, m1 = L.fmeta(REF, FN)
if s1 != 200 or not m1 or "verify_jwt" not in m1: stop(f"couldn't read how {FN} is set up live ({s1})", 3)
gate = bool(m1["verify_jwt"]); say(f"  · {FN} is live as version {m1.get('version', '?')}, gateway sign-in check {'on' if gate else 'off'} (kept)")
K = keys(); ANON, SVC = K.get("anon", ""), K.get("service_role", ""); L.HIDE += [ANON, SVC]
if not ANON or not SVC: stop("couldn't read the Hub's keys", 3)

say(); say("PART 2 · CHANGE")
if not deploy(REF, FNROOT, FN, gate): say(f"  STOP at {FN}. Tell Claude."); done(6)
URL = f"{FNB}/functions/v1/{JOB}"

say(); say("PART 3 · PROOF (nothing is sent)")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
a1 = http("POST", URL + "?auth_check=1", {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
chk(a1 == 401, f"it refuses the public key ({a1})")
sC, bC = http("GET", f"{FNB}/rest/v1/ff_invite_runs?select=run_day&limit=1", None, {"apikey": ANON, "Authorization": "Bearer " + ANON})
chk(sC != 200 or bC.strip() in ("[]", ""), f"the public can't read the list ({sC})")
say(); say("  Today's list again (this takes a minute: it reads AxisCare)...")
sD, bD = http("POST", URL, {}, {"apikey": SVC, "Authorization": "Bearer " + SVC}, 300)
try: j = json.loads(bD)
except Exception: j = {}
chk(sD == 200 and j.get("sent") == 0 and j.get("saved") is True, "it ran, saved today's list, and sent nothing", f"the first run answered {sD}: {str(bD)[:200]}")
for p in j.get("problems") or []: bad("couldn't read: " + str(p))
rows = j.get("rows") or []; sm = j.get("summary") or {}
if sm:
    c, f = sm.get("caregivers") or {}, sm.get("families") or {}
    say(); say("  TODAY'S LIST (who would get an invitation if it were on)")
    say(f"  Caregivers: {c.get('ready', 0)} ready · {c.get('waiting', 0)} waiting · {c.get('held', 0)} held")
    say(f"  Family members: {f.get('ready', 0)} ready · {f.get('waiting', 0)} waiting · {f.get('held', 0)} held")
    say(f"  Clients with no family email on file: {sm.get('clients_without_family_email', 0)}")
    ni = sm.get("not_invited_by_payer") or {}
    if ni: say("  Clients never invited because of their payer: " + ", ".join(f"{k} {n}" for k, n in sorted(ni.items())))
    def block(title, pick):
        sel = [x for x in rows if pick(x)]
        if not sel: return
        say(); say(f"  {title} ({len(sel)})")
        for x in sorted(sel, key=lambda x: (x.get("kind") != "caregiver", x.get("client") or "", x.get("name") or "")):
            who = x.get("name", "") + (f" (for {x['client']})" if x.get("kind") == "family" else "")
            how = (" · " + " and ".join(x.get("channels") or [])) if x.get("status") == "ready" else ""
            why = ("; ".join(x.get("why") or []))
            say(f"    {'Caregiver' if x.get('kind') == 'caregiver' else 'Family' if x.get('kind') == 'family' else 'Client'}: {who}{how}" + (f" · {why}" if why else "") + (f" · {x['note']}" if x.get("note") else ""))
    block("READY", lambda x: x.get("status") == "ready")
    block("HELD", lambda x: x.get("status") == "held")
    block("WAITING", lambda x: x.get("status") == "waiting")
say()
say("  1142: " + ("DONE. The fixed check is live and today's list is saved. Nobody was texted or emailed, and the switch is " + ("ON (still nothing is sent until step 4)." if live else "OFF.") if not L.fails else "NOT COMPLETE. See the ✗ lines above."))
say("  Rollback: Claude unschedules ff-invite-check. It only ever makes a list.")
done(0 if not L.fails else 1)
