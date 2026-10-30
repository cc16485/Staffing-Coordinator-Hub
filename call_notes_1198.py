#!/usr/bin/env python3
# 1198 · CALL NOTES FROM RECORDED CALLS (Caring Companions, 2026-10-29). Her ask: "Can you do the same for our leads on the
# Caring Companions sub account" (after the CDS hub's call notes). The call reader (call-learn) already reads every answered
# recorded call on a lead; now each reading also carries a short note, a suggested call back day and the phones of people
# heard, for the Hub's "Call note to check" panel (switch ops_settings.call_notes_live, off until she turns it on).
# call-to-lead gains Read the whole call and Listen, for signed-in office staff, only for calls the reader put a note on.
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; both functions' tests pass (fake data only).
#  2. Deploys call-to-lead and call-learn (gateway settings kept).
#  3. Proves it: strangers are refused; waits for the next 5-minute run; lists the newest readings with whether each has a
#     note and a call back day (never the note's words, never a name).
# Sends nothing; no lead changes; every GoHighLevel request is a read. Safe to run again.
import json, os, subprocess, shutil, time
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, sql, deploy, start, check_build, fmeta

HUB = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB}.supabase.co")
FNS = ["call-to-lead", "call-learn"]
WAIT_S = int(os.environ.get("SB_WAIT_S", "420"))
ok = lambda s: say("  ✓ " + s)
def chk(good, msg, badmsg=None): (ok(msg) if good else bad(badmsg or msg))
def run(args, cwd=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)
BEAT = "select x->>'at' as at, x->>'note' as note from app_data, jsonb_array_elements(data) x where key = 'automation_heartbeats' and x->>'id' = 'hb_call-learn'"
NEWEST = """select left(message_id, 6) as id, status, coalesce(seconds, 0) as seconds,
  (reading->'call_note'->>'note') is not null and (reading->'call_note'->>'note') <> '' as has_note,
  coalesce(reading->'call_note'->'call_back'->>'day', '') as call_back,
  to_char(read_at at time zone 'America/Chicago', 'Dy Mon DD HH12:MI am') as read_at
  from public.call_learned where read_at > now() - interval '30 minutes' order by read_at desc limit 10"""
SWITCH = "select coalesce(data->>'call_notes_live', 'not set') as live from app_data where key = 'ops_settings'"

start("CALL NOTES FROM RECORDED CALLS")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = []
for k in sorted(set().union(*[L.need(FNROOT, f) for f in FNS])):
    c2, b2 = run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"])
    if c2 != 0 or b2 != open(os.path.join(ROOT, k)).read(): drift.append(k)
if drift: stop("this isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(drift)[:240] + ")")
ok("the reviewed build is what is on GitHub's main")
if NODE:
    c, o = run([NODE, "call_learn_test.mjs"], cwd=ROOT)
    if c != 0 or "2026-10-29 call note" not in o: stop("call-learn's tests failed: " + " ".join(l for l in o.splitlines() if "✗" in l)[:240])
    c2, o2 = run([NODE, "call_to_lead_test.mjs"], cwd=ROOT)
    if c2 != 0 or "call notes: Listen" not in o2: stop("call-to-lead's tests failed: " + " ".join(l for l in o2.splitlines() if "✗" in l)[:240])
    ok("both functions' tests pass, including Read the whole call and Listen refusing anything that is not a call note (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
GATE = {}
for f in FNS:
    s, m = fmeta(HUB, f)
    if s != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {f} is set up live ({s})", 3)
    GATE[f] = bool(m["verify_jwt"]); say(f"  · {f} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if GATE[f] else 'off'} (kept)")
okq, b0 = sql(HUB, BEAT); at0 = (b0[0]["at"] if okq and b0 else "") or ""
okq, sw = sql(HUB, SWITCH)
say("  · the Hub's Call notes switch is " + ("ON" if okq and sw and sw[0]["live"] == "true" else "OFF (she turns it on in Settings when she is ready)"))

say(); say("PART 2 · CHANGE")
for f in FNS:
    if not deploy(HUB, FNROOT, f, GATE[f]): say("  STOP. Tell Claude. (Anything above this line is in.)"); done(5)

say(); say("PART 3 · PROOF")
for f in FNS:
    s, b = http("POST", f"{FNB}/functions/v1/{f}", {})
    chk(s in (401, 403), f"{f}: a caller with no key gets nothing ({s})", f"{f} answered a stranger ({s})")
s, b = http("POST", f"{FNB}/functions/v1/call-to-lead", {"action": "recording", "message_id": "abcdef123456"})
chk(s in (401, 403), f"call-to-lead: Listen with no sign-in gets nothing ({s})", f"call-to-lead played a recording to a stranger ({s})")
say(f"  · waiting for the next 5-minute run (up to {WAIT_S // 60} minutes)...")
note = None; t0 = time.time()
while time.time() - t0 < WAIT_S:
    time.sleep(20)
    okq, b1 = sql(HUB, BEAT)
    if okq and b1 and (b1[0]["at"] or "") > at0:
        try: note = json.loads(b1[0]["note"])
        except Exception: note = {}
        break
if note is None: bad("the job has not run since the deploy; run this again in 10 minutes to see it")
else: chk(note.get("errors", 0) == 0, f"the new build ran: looked at {note.get('looked_at', 0)} call(s), read {note.get('read', 0)}, nothing to fill in or too short {note.get('skipped', 0)}, waiting for a transcript {note.get('waiting', 0)}",
          f"the new build ran with {note.get('errors')} error(s). Tell Claude.")
okq, rows = sql(HUB, NEWEST)
say(); say(f"  CALLS READ IN THE LAST 30 MINUTES ({len(rows) if okq else '?'}), without the words:")
for r in (rows if okq else []):
    say(f"  · call {r['id']}… read {r['read_at']} ({r['seconds']} s): {r['status'].upper()}" + (", has a note" if r['has_note'] else ", no note") + (f", call back {r['call_back']}" if r['call_back'] else ""))
if okq and not rows: say("  · no answered call on a lead came in since; the next one gets a note")
say()
say("  1198: " + ("DONE. New answered calls on a lead get a short note and a call back day. Next: merge the Hub pull request, then turn on Call notes in Settings (or preview it first)." if not L.fails else "NOT COMPLETE. See the ✗ lines above."))
done(0 if not L.fails else 1)
