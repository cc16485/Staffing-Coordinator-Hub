#!/usr/bin/env python3
# 724 · TEAM BUILDER: ONLY PEOPLE WHO FINISHED STEP 1, WITH HER FOUR LABELS (Samantha, 2026-10-14). Redeploys hire-profile
# only: its read-only "stages" answer now carries Team Builder's label (Step 1 done (checks running) / Orientation scheduled
# for <day> / Orientation done, needs the Alzheimer's/dementia course / Ready, waiting on Approve to Work; Step 1 not
# finished for anyone already on a plan). Part 1 read only (reviewed build; hire-profile live as GitHub main had it).
# Part 2 deploy (gateway kept). Part 3: it still refuses anyone not signed-in office staff. Nothing sent, nothing changed.
import os, json, subprocess
os.environ.setdefault("SB_STEP", "724")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
ROOT = os.path.dirname(os.path.dirname(FNROOT))
BASE = os.environ.get("SB_BASE_COMMIT", "a8976a0")   # main before this change: what each service must be live as now
FN = "hire-profile"
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



start("TEAM BUILDER: ONLY PEOPLE WHO FINISHED STEP 1")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
s_, m_ = fmeta(REF, FN)
if s_ != 200 or not isinstance((m_ or {}).get("verify_jwt"), bool): bad(f"could not read {FN}'s settings")
else:
    VJ = m_["verify_jwt"]; okl, livef = live_files(REF, FN)
    if not okl: bad(f"could not download the live {FN} to compare")
    else:
        off = [k for k, v in livef.items() if v not in on_main(k)]
        if off: bad(f"{FN} is live with changes that are not on GitHub ({len(off)} file(s)): deploying would overwrite them")
        else: say(f"  ✓ {FN} is live as GitHub main had it (version {(m_ or {}).get('version', '?')}, gateway sign-in check {'on' if VJ else 'off'}, kept)")
K = keys(); ANON, SVC = K.get("anon", ""), K.get("service_role", ""); HIDE.extend([ANON, SVC])
if not (ANON and SVC): bad("could not read the project's keys (the proofs need them)")
say("  · what changes: hire-profile only (a read-only answer). Nothing sent, nothing changed.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
if not deploy(REF, FNROOT, FN, VJ): say("  RESULT: STOPPED. Tell Claude."); done(6)
say(); say("PART 3 · PROOF (nothing is sent; no caregiver is changed)")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
sx, _ = http("POST", f"{FNB}/functions/v1/{FN}", {"action": "stages"}, {"apikey": ANON, "Authorization": "Bearer " + ANON})
say(f"  ✓ {FN} still refuses anyone who isn't signed-in office staff ({sx})") if sx in (401, 403) else bad(f"{FN} answered {sx} without a staff sign-in")
say("  · tested before deploying: Team Builder labels 11, hire-profile 21.")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · merge the Hub pull request next; then Team Builder lists only people who finished Step 1, each with where they are.")
say("Undo: redeploy hire-profile from main before this change (Claude can).")
done(0)
