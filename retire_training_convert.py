#!/usr/bin/env python3
# C2b · RETIRE the older Training-project route (axiscare-convert-lead): the one function that let whoever held the shared
# Training Hub key create AxisCare clients and write notes on any client or caregiver.
# Part 1 (read only): the live Care Coordinator Hub page, its caregiver engine and the Staffing Hub page no longer mention it;
#   the new note sender (axiscare-note) is deployed; the old function's settings (never called).
# Part 2: delete the old function.   Part 3: confirm it is gone.
import json, os, urllib.request, urllib.error, datetime as dt, random, sys
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn"); TREF = os.environ.get("SB_TRAINING_REF", "rdqujxiycycwhskyvrwa")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
PAGES = json.loads(os.environ.get("SB_PAGES", json.dumps(["https://cc.mo-care.com/index.html", "https://cc.mo-care.com/caregivers-engine.js", "https://sc.mo-care.com/index.html"])))
lines = []
def say(s=""): print(s); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:300]); say("  If this stopped before PART 2, nothing was changed.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def api(method, ref, path):
    req = urllib.request.Request(API + f"/v1/projects/{ref}" + path, method=method, headers={"Authorization": "Bearer " + TOKEN, "User-Agent": "cc-retire/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r: b = r.read().decode(errors="replace"); return r.status, (json.loads(b) if b.strip().startswith(("{", "[")) else None)
    except urllib.error.HTTPError as e: return e.code, None
    except Exception: return None, None
def page(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url + ("&" if "?" in url else "?") + "cb=" + str(random.randint(1, 10**9)), headers={"User-Agent": "cc-retire/1.0", "Cache-Control": "no-cache"}), timeout=60) as r:
            return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, ""
    except Exception: return None, ""
say("C2b · RETIRE THE OLDER TRAINING-PROJECT ROUTE TO AXISCARE")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY")
clean = True
for u in PAGES:
    st, body = page(u); still = "axiscare-convert-lead" in body
    good = st == 200 and not still
    say(("  ✓ " if good else "  ✗ ") + u.split("//")[1] + (" no longer uses it" if good else (" STILL uses it (not live yet?)" if still else f" could not be read ({st})")))
    clean = clean and good
st, meta = api("GET", REF, "/functions/axiscare-note")
newok = st == 200; say(("  ✓" if newok else "  ✗") + " the new note sender (axiscare-note) is deployed")
st, old = api("GET", TREF, "/functions/axiscare-convert-lead")
say("  the old function: " + ("deployed (version %s). Not called." % (old or {}).get("version") if st == 200 else ("already gone" if st == 404 else f"could not read ({st})")))
if st == 404: say(); say("RESULT: RETIRED (it was already gone)."); done(0)
if not (clean and newok and st == 200): say("  STOP. Nothing was changed."); done(4)
say(); say("PART 2 · RETIRE")
st, _ = api("DELETE", TREF, "/functions/axiscare-convert-lead")
say(("  ✓" if st in (200, 204) else "  ✗") + f" deleted the old function ({st})")
say(); say("PART 3 · CONFIRM")
st2, _ = api("GET", TREF, "/functions/axiscare-convert-lead")
gone = st2 == 404; say(("  ✓" if gone else "  ✗") + f" it is gone ({st2}); the shared key can no longer create AxisCare clients or write notes")
say(); say("RESULT: " + ("RETIRED. Anyone with an old Hub page open should reload it once; notes then go the new way." if gone else "CHECK THE ✗ LINES."))
done(0 if gone else 6)
