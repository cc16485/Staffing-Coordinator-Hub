#!/usr/bin/env python3
# 711 · OVERNIGHT SHIFTS AND THE MISSED CARE NOTE TEXT (2026-10-13). Samantha: caregivers on overnight shifts were
# texted for a missing care note they HAD written. AxisCare splits a shift that crosses midnight into two visits, one
# on each day; the note goes on the first half, and missed-notes checked the after-midnight half on its own day, saw
# no note and texted. Redeploys missed-notes so the two halves count as one shift (a note on either half covers it;
# no note on either = one miss, one text). Misses already recorded that way are removed by the function on its own
# runs (a few per run, never counted) and their Needs Attention cards closed saying why. No tables, no switches; the
# texts stay as you set them. Undo: redeploy missed-notes from main before this pull request.
import os, json
os.environ.setdefault("SB_STEP", "711")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co") + "/functions/v1/missed-notes"
def keys():
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_secret_") or v.startswith("sb_publishable_")) and "·" not in v and "*" not in v
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys{q}", headers=MG())
        if s != 200: continue
        try: arr = json.loads(b)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        got = {k.get("name"): k.get("api_key", "") for k in arr if isinstance(k, dict) and usable(k.get("api_key", ""))}
        if got.get("service_role"): return got
    return {}

start("OVERNIGHT SHIFTS: NO MORE MISSED-NOTE TEXTS FOR THE AFTER-MIDNIGHT HALF")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
s1, m1 = fmeta(REF, "missed-notes")
say(f"  ✓ missed-notes is live (version {(m1 or {}).get('version', '?')})") if s1 == 200 else bad(f"missed-notes is not deployed ({s1}). Tell Claude.")
ok, rows = sql(REF, "select status, count(*) as n from public.missed_notes where shift_date >= current_date - 30 group by 1 order by 1")
if ok: say("  · missed notes on record, last 30 days: " + (", ".join(f"{r['status']} {r['n']}" for r in rows) or "none"))
say("  · what changes: missed-notes only. No tables, no switches, nothing texted by this step.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
if not deploy(REF, FNROOT, "missed-notes", True): say("  RESULT: STOPPED. Tell Claude."); done(6)

say(); say("PART 3 · PROOF (a practice look: nothing recorded, nothing sent)")
K = keys(); SVC = K.get("service_role", "")
if SVC: HIDE.append(SVC)
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
sx, _ = http("POST", FNB + "?auth_check=1", {})
say("  ✓ missed-notes still refuses anyone without a key") if sx == 401 else bad(f"without a key it answered {sx}")
if not SVC: bad("could not read the project's server key for the practice look. The fix is deployed; tell Claude.")
else:
    sd, bd = http("POST", FNB + "?dry=1", {}, {"apikey": SVC, "Authorization": "Bearer " + SVC}, 300)
    try: j = json.loads(bd)
    except Exception: j = {}
    if sd == 200 and j.get("dry") is True:
        say(f"  ✓ a practice look answers: {j.get('groups_checked', 0)} finished shifts checked, {j.get('overnight_noted', 0)} overnight half(s) covered by the note on the other half")
    else: bad(f"the practice look answered {sd}: {str(bd)[:160]}")
say("  · tested before deploying: missed-notes 47 checks (7 new for overnight shifts; they fail on the old build).")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · an overnight shift with its note on either half is not texted. Earlier wrong misses clear themselves over the next runs."); done(0)
