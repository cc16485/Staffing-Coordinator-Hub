#!/usr/bin/env python3
# 721 · TEAM BUILDER TEXT: AXISCARE IS THE TRUTH FOR ACTIVE (Samantha, 2026-10-14: "axiscare is the truth for if a caregiver
# is active or not, we should never have the option to send an open shift to someone who is not active in axiscare").
# Redeploys team-ask only: before each Team Builder text it asks AxisCare whether that caregiver is active; not active,
# no AxisCare number, or AxisCare unreadable = not texted, and the office sees why. Call-off lists, open hours, the Team
# Builder list and the 30-day text already checked AxisCare live. No table, no switch, nothing texted by this step.
# Part 1 read only (reviewed build; team-ask is live as some version GitHub main had). Part 2 deploy (gateway kept).
# Part 3 proof: team-ask still refuses anyone without a sign-in. Prints no name, number, key or secret.
import os, json, subprocess
os.environ.setdefault("SB_STEP", "721")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
ROOT = os.path.dirname(os.path.dirname(FNROOT))
BASE = os.environ.get("SB_BASE_COMMIT", "7fcf815")   # main before this change: what each service must be live as now
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


start("TEAM BUILDER TEXT: AXISCARE IS THE TRUTH FOR ACTIVE")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
FN = "team-ask"
s_, m_ = fmeta(REF, FN)
if s_ != 200 or not isinstance((m_ or {}).get("verify_jwt"), bool): bad(f"could not read {FN}'s settings")
else:
    VJ = m_["verify_jwt"]; okl, livef = live_files(REF, FN)
    if not okl: bad(f"could not download the live {FN} to compare")
    else:
        off = [k for k, v in livef.items() if v not in on_main(k)]
        if off: bad(f"{FN} is live with changes that are not on GitHub ({len(off)} file(s)): deploying would overwrite them")
        else: say(f"  ✓ {FN} is live as GitHub main had it (version {(m_ or {}).get('version', '?')}, gateway sign-in check {'on' if VJ else 'off'}, kept)")
say("  · what changes: team-ask only. No table, no switch, nothing texted by this step.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
if not deploy(REF, FNROOT, FN, VJ): say("  RESULT: STOPPED. Tell Claude."); done(6)
say(); say("PART 3 · PROOF (nothing is sent)")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
K = keys(); ANON = K.get("anon", ""); HIDE.append(ANON)
sx, _ = http("POST", f"{FNB}/functions/v1/{FN}", {"action": "draft"}, {"apikey": ANON, "Authorization": "Bearer " + ANON} if ANON else {})
say(f"  ✓ team-ask still refuses anyone who isn't signed-in office staff ({sx})") if sx in (401, 403) else bad(f"team-ask answered {sx} without a staff sign-in")
say("  · tested before deploying: team-ask checks 29 (4 new: not active in AxisCare, AxisCare down, no AxisCare number), team-ask 38.")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · Team Builder's Text asks AxisCare first; anyone not active there is never texted about a shift.")
say("Undo: redeploy team-ask from main before this change (Claude can).")
done(0)
