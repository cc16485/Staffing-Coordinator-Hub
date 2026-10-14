#!/usr/bin/env python3
# 723 · THE NIGHTLY AXISCARE CHECK: A LIST YOU HAVE SEEN GOES THROUGH (2026-10-14). In 722 the first check found 26 of 70
# Hub caregivers not active in AxisCare (real drift) and its safety brake held. The brake now counts only people who were
# NOT on the last list the office could see, so once you have reviewed the list and turn the switch on, it applies; a
# sudden big change (a bad AxisCare read) still holds. A practice run never holds (it changes nobody).
# Part 1 read only (reviewed build; roster-axis-follow live as GitHub main had it). Part 2 deploy roster-axis-follow
# (gateway kept). Part 3: it still refuses outsiders; one practice run refreshes the Caregivers page list.
# Nothing is sent and no caregiver is changed by this step. Prints counts only.
import os, json, subprocess
os.environ.setdefault("SB_STEP", "723")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
ROOT = os.path.dirname(os.path.dirname(FNROOT))
BASE = os.environ.get("SB_BASE_COMMIT", "7efbd65")   # main before this change: what each service must be live as now
FN = "roster-axis-follow"
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



start("THE NIGHTLY AXISCARE CHECK: A LIST YOU HAVE SEEN GOES THROUGH")
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
say("  · what changes: roster-axis-follow only. No caregiver changes, no switch, nothing texted by this step.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
if not deploy(REF, FNROOT, FN, VJ): say("  RESULT: STOPPED. Tell Claude."); done(6)
say(); say("PART 3 · PROOF (nothing is sent; no caregiver is changed)")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
url = f"{FNB}/functions/v1/{FN}"
a1 = http("POST", url + "?auth_check=1", {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
say(f"  ✓ {FN} refuses the public key ({a1})") if a1 == 401 else bad(f"{FN} let the public key in ({a1})")
ok, sw = sql(REF, "select coalesce(data->>'roster_follow_axis_live', 'off') as live from public.app_data where key = 'ops_settings'")
if ok and sw and sw[0]["live"] == "true": say("  · the switch is already on, so the practice run is skipped (tonight's run applies the list)")
else:
    sP, bP = http("POST", url, {}, {"apikey": SVC, "Authorization": "Bearer " + SVC}, 200)
    try: j = json.loads(bP)
    except Exception: j = {}
    if sP == 200 and j.get("mode") == "practice" and "changes" in j:
        say(f"  ✓ practice run (no caregiver changed): {j.get('to_inactive', 0)} active in the Hub but not in AxisCare, {j.get('to_active', 0)} the other way, "
            f"{j.get('not_in_axiscare', 0)} with an AxisCare number AxisCare doesn't know, {j.get('no_number', 0)} active with no AxisCare number. The names are on the Caregivers page.")
    else: bad(f"the practice run answered {sP}: {str(bP)[:200]}")
say("  · tested before deploying: Hub-follows-AxisCare 16 (3 new: a seen list goes through; practice never holds).")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the list is on the Caregivers page (Hub vs AxisCare). When it looks right, turn on \"Caregiver list follows AxisCare\" on the Admin page; that night's run applies it.")
say("Undo: redeploy roster-axis-follow from main before this change (Claude can).")
done(0)
