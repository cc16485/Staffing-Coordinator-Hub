#!/usr/bin/env python3
# 1060 · IN TRAINING IS ONBOARDING, PART A (2026-10-22, Samantha: "Go with the In Training way: AxisCare In Training at Step 2
# checked, Hub treats In Training as onboarding (not a caregiver, no shifts), Active after orientation"; plan v2 approved).
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (fake data only); how each of the
#     8 services is set up live.
#  2. Deploys the 8 services that use the one rule (_shared/in-training.ts), gateway settings kept. The switch
#     ops_settings.in_training_lock_live is NOT touched: while it is off, shifts work exactly as before.
#  3. The list for her (read only): everyone AxisCare has as In Training today, with their hire date and whether they have
#     finished the Agency Orientation in the Training Platform. Anyone who already works for us should be Active in AxisCare
#     before she turns the switch on (Owners Hub > Admin > "In Training hires get no shifts").
#  4. Proves it: a stranger gets nothing from each service; the switch is still where she left it.
# Sends nothing. Safe to run again.
import json, os, subprocess, shutil
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, sql, deploy, start, check_build, fmeta, lit, API, MG

HUB = "zngsgedlsxinbygwmxwn"; TRAIN = "rdqujxiycycwhskyvrwa"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB}.supabase.co")
FNS = ["coverage-run", "coverage-shifts", "schedule-push", "availability-checkin", "family-offer", "match-dark", "team-ask", "family-gateway"]
SWITCH = "in_training_lock_live"
ok = lambda s: say("  ✓ " + s)
def chk(good, msg, badmsg=None): (ok(msg) if good else bad(badmsg or msg))
def run(args, cwd=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)
def keys():
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_secret_")) and "·" not in v and "*" not in v
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{HUB}/api-keys{q}", headers=MG())
        if s != 200: continue
        try: arr = json.loads(b)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        got = {k.get("name"): k.get("api_key", "") for k in arr if isinstance(k, dict) and usable(k.get("api_key", ""))}
        if got.get("service_role"): return got
    return {}
def switch_now():
    okq, r = sql(HUB, f"select coalesce((data::jsonb->>'{SWITCH}')::boolean, false) as on from public.app_data where key = 'ops_settings'")
    return (r[0]["on"] if r else False) if okq else None

start("IN TRAINING IS ONBOARDING (PART A)")
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
    for t, must in (("in_training_test.mjs", "21/21 passed"), ("callin_plan_harness.mjs", "ALL 20 CHECKS PASS"), ("schedule_push_harness.mjs", "33/33 passed"),
                    ("team_pool_test.mjs", "5/5 passed"), ("availability_checkin_test.mjs", "14/14"), ("driver_coverage_test.mjs", "26/26 passed")):
        c, o = run([NODE, t], cwd=ROOT)
        if c != 0 or must not in o: stop(f"the tests failed ({t}): " + " ".join(l for l in o.splitlines() if "FAIL" in l or "✗" in l)[:240])
    ok("tests pass: with the switch on, In Training is left out of shift texts, fills, open hours, family offers, schedule push and the 30-day text; with it off nothing changes (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
before = switch_now()
if before is None: stop("couldn't read the Hub settings", 3)
say(f"  · the switch \"In Training hires get no shifts\" is {'ON' if before else 'off'} (this step leaves it as it is)")
metas = {}
for fn in FNS:
    s, m = fmeta(HUB, fn)
    if s != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {fn} is set up live ({s})", 3)
    metas[fn] = bool(m["verify_jwt"]); say(f"  · {fn} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if metas[fn] else 'off'} (kept)")

say(); say("PART 2 · CHANGE")
for fn in FNS:
    if not deploy(HUB, FNROOT, fn, metas[fn]): say("  STOP. Tell Claude. (Services before this one are deployed; the switch was not touched.)"); done(5)

say(); say("PART 3 · WHO IS IN TRAINING IN AXISCARE TODAY (read only)")
K = keys()
if not K.get("service_role"): bad("couldn't get the Hub's server key to read AxisCare, so the list was not made (the change itself is done)")
else:
    s, b = http("POST", f"{FNB}/functions/v1/caregiver-census-report", {}, {"Authorization": "Bearer " + K["service_role"], "apikey": K["service_role"]})
    try: cen = json.loads(b) if s == 200 else {}
    except Exception: cen = {}
    rows = cen.get("caregivers") or []
    if not rows: bad(f"AxisCare could not be read through the Hub ({s}): {str(b)[:160]}")
    else:
        tr = [r for r in rows if r.get("active") is True and str(r.get("status_label") or "").strip().lower().replace(" ", "") == "intraining"]
        say(f"  · AxisCare: {sum(1 for r in rows if r.get('active') is True)} active, and {len(tr)} of them are In Training")
        done_by = {}
        if tr:
            ids = ",".join(lit(str(r.get("id"))) for r in tr)
            okq, er = sql(TRAIN, f"""select c.axiscare_id, e.status, e.completed_at from public.caregivers c
              join public.enrollments e on e.caregiver_id = c.id join public.courses k on k.id = e.course_id
             where k.slug = 'agency-orientation' and c.axiscare_id in ({ids})""")
            if okq:
                for e in er: done_by[str(e["axiscare_id"])] = e
            else: say("  · the Training Platform couldn't be read, so orientation is shown as unknown")
        for r in sorted(tr, key=lambda r: str(r.get("hire_date") or "")):
            e = done_by.get(str(r.get("id")))
            orient = ("FINISHED orientation " + str(e["completed_at"])[:10]) if e and e.get("status") == "complete" else (f"orientation {e['status'].replace('_', ' ')}" if e else "no orientation on file in the Training Platform")
            flag = "  ← finished: should they be Active in AxisCare?" if e and e.get("status") == "complete" else ""
            say(f"  · {r.get('first', '')} {r.get('last', '')} (AxisCare {r.get('id')}), hired {str(r.get('hire_date') or '?')[:10]}: {orient}{flag}")
        if not tr: say("  · nobody is In Training in AxisCare right now")

say(); say("PART 4 · PROOF")
for fn in FNS:
    s, b = http("POST", f"{FNB}/functions/v1/{fn}", {})
    chk(s in (400, 401, 403), f"{fn}: a caller with no key gets nothing ({s})", f"{fn} answered a stranger ({s})")
after = switch_now()
chk(after == before, f"the switch is still {'ON' if after else 'off'}, as it was", f"the switch changed ({before} → {after})")
say()
if not L.fails:
    say("  1060: DONE. The Hub now knows In Training is onboarding. Shifts work exactly as before until you turn on")
    say("  Owners Hub > Admin > \"In Training hires get no shifts\". First make anyone above who already works for you Active in AxisCare.")
else: say("  1060: NOT COMPLETE. See the ✗ lines above.")
done(0 if not L.fails else 1)
