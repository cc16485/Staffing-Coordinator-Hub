#!/usr/bin/env python3
# 1063 · THE NEW BONUS RULES AND THE SCOREBOARD, SERVER HALF (2026-10-22, Samantha: "$75 for every new client no matter the
# hours", to whoever did the home visit, earned at day 30 with 3 completed visits; team goal 8 = team lunch; counts shared,
# dollars private to her and the owners; "build it in practice, switched off, and show me before it goes live").
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the bonus and morning email tests pass (fake data).
#  2. Deploys cc-bonus and lead-digest (gateway settings kept). No database change. Everything new waits behind
#     ops_settings.bonus_v2_live, which stays OFF: the bonus program keeps its current rules until she turns it on.
#  3. Proves it: strangers are refused; a practice run of the daily bonus check answers and writes nothing.
# Sends nothing to anyone (deploying the morning email does not send it). Safe to run again.
import json, os, subprocess, shutil, time
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, sql, deploy, start, check_build, fmeta

REF = HUB = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB}.supabase.co")
FNS = ["cc-bonus", "lead-digest"]
ok = lambda s: say("  ✓ " + s)
def chk(good, msg, badmsg=None): (ok(msg) if good else bad(badmsg or msg))
def run(args, cwd=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)
def keys():
    """the project's anon and service keys, read with the access token (masked values are skipped)"""
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_publishable_") or v.startswith("sb_secret_")) and "·" not in v and "*" not in v
    for q_ in ("?reveal=true", ""):
        s_, b_ = http("GET", f"{L.API}/v1/projects/{REF}/api-keys{q_}", headers=L.MG())
        if s_ != 200: continue
        try: arr = json.loads(b_)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        got = {k.get("name"): k.get("api_key", "") for k in arr if isinstance(k, dict)}
        got = {k: v for k, v in got.items() if usable(v)}
        if got.get("anon"): return got
    return {}

start("THE NEW BONUS RULES AND THE SCOREBOARD (server half)")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = []
for fn in FNS:
    for k in sorted(L.need(FNROOT, fn)):
        c2, b2 = run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"])
        if c2 != 0 or b2 != open(os.path.join(ROOT, k)).read(): drift.append(k)
if drift: stop("this isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(sorted(set(drift)))[:240] + ")")
ok("the reviewed build is what is on GitHub's main")
if NODE:
    for t, must in (("bonus_v2_test.mjs", "ALL GREEN"), ("cc_bonus_959_test.mjs", "passed"), ("morning_email_420_test.mjs", "passed")):
        c, o = run([NODE, t], cwd=ROOT)
        if c != 0 or must not in o: stop(f"the tests failed ({t}): " + " ".join(l for l in o.splitlines() if "FAIL" in l or "✗" in l)[:240])
    ok("bonus and morning email tests pass, including the new rules, the scoreboard and dollars kept private (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
okq, st = sql(HUB, "select data->>'bonus_live' as live, data->>'bonus_v2_live' as v2 from app_data where key = 'ops_settings'")
if okq and st: say(f"  · bonus program on: {st[0]['live']} · new rules on: {st[0]['v2'] or 'false'} (this step does not change either)")
gates = {}
for fn in FNS:
    s_, m = fmeta(HUB, fn)
    if s_ != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {fn} is set up live ({s_})", 3)
    gates[fn] = bool(m["verify_jwt"]); say(f"  · {fn} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if gates[fn] else 'off'} (kept)")

say(); say("PART 2 · CHANGE")
for fn in FNS:
    if not deploy(HUB, FNROOT, fn, gates[fn]): say("  STOP. Tell Claude. (" + ("nothing else was changed" if fn == FNS[0] else "cc-bonus was already updated; the morning email was not") + ")"); done(5)

say(); say("PART 3 · PROOF")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
for fn in FNS:
    s_, _ = http("POST", f"{FNB}/functions/v1/{fn}", {}, {"Content-Type": "application/json"})
    chk(s_ is not None and s_ != 200 and s_ < 500, f"{fn}: a caller with no key gets nothing ({s_})", f"{fn} answered a caller with no key ({s_})")
K = keys(); SERVICE = (K or {}).get("service_role", "")
if SERVICE:
    L.HIDE.append(SERVICE); S = {"Authorization": "Bearer " + SERVICE, "Content-Type": "application/json"}
    s_, b = http("POST", f"{FNB}/functions/v1/cc-bonus?dry=1", {}, S)
    try: j = json.loads(b) if s_ == 200 else {}
    except Exception: j = {}
    chk(s_ == 200 and j.get("write") is False, f"cc-bonus: practice run OK: it would start {len(j.get('new_lines') or [])} bonus(es) and update {j.get('updated', 0)}; nothing written", f"cc-bonus: the practice run did not answer ({s_})")
else: say("  · couldn't read the server key, so the practice run was skipped (the daily check runs it at 7:15)")
say()
say("  1063: " + ("DONE. The new rules and the scoreboard are installed and OFF. Turn them on in the Hub: Settings > Leads > New bonus rules and the scoreboard." if not L.fails else "NOT COMPLETE. See the ✗ lines above."))
done(0 if not L.fails else 1)
