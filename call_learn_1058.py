#!/usr/bin/env python3
# 1058 · LEARNED ON THIS CALL: THE AI SERVICE'S EXACT WORDS (2026-10-22). 1056b showed the AI service refusing the request
# itself ("400 (invalid_request_error)"), and the server log could not be read (1056c). call-learn now keeps the service's
# own words on the call. This deploys it, gives the calls that ended in an error their tries back, waits for the next run
# and lists every call with why. If the service still refuses, the list says exactly which setting, so it can be fixed.
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; call-learn's tests pass (fake data only).
#  2. Deploys call-learn (gateway setting kept); calls that ended in an error go back to 0 tries. Still PRACTICE.
#  3. Proves it: a stranger is refused; waits for the next 5-minute run and lists every call with why.
# Sends nothing; no lead changes; every GoHighLevel request is a read. Safe to run again.
import json, os, subprocess, shutil, time
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, sql, deploy, start, check_build, fmeta

HUB = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB}.supabase.co")
FN = "call-learn"
WAIT_S = int(os.environ.get("SB_WAIT_S", "420"))
ok = lambda s: say("  ✓ " + s)
def chk(good, msg, badmsg=None): (ok(msg) if good else bad(badmsg or msg))
def run(args, cwd=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)
BEAT = "select x->>'at' as at, x->>'note' as note from app_data, jsonb_array_elements(data) x where key = 'automation_heartbeats' and x->>'id' = 'hb_call-learn'"
ROWS = """select left(message_id, 6) as id, status, tries, seconds, coalesce(note, '') as note, coalesce(jsonb_array_length(reading->'heard'), 0) as heard,
  to_char(msg_at at time zone 'America/Chicago', 'Dy Mon DD HH12:MI am') as call_at from public.call_learned order by msg_at"""

start("LEARNED ON THIS CALL: THE AI SERVICE'S EXACT WORDS")
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
    c, o = run([NODE, "call_learn_test.mjs"], cwd=ROOT)
    if c != 0 or "words instead of the form" not in o: stop("call-learn's tests failed: " + " ".join(l for l in o.splitlines() if "✗" in l)[:240])
    ok("call-learn tests pass, including the AI answering in words (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
s, m = fmeta(HUB, FN)
if s != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {FN} is set up live ({s})", 3)
gate = bool(m["verify_jwt"]); say(f"  · {FN} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if gate else 'off'} (kept)")
okq, b0 = sql(HUB, BEAT); at0 = (b0[0]["at"] if okq and b0 else "") or ""

say(); say("PART 2 · CHANGE")
if not deploy(HUB, FNROOT, FN, gate): say("  STOP. Tell Claude. (Nothing else was changed.)"); done(5)
okq, rs = sql(HUB, "update public.call_learned set tries = 0 where status = 'error' returning left(message_id, 6) as id")
chk(okq, f"{len(rs) if okq else 0} call(s) that ended in an error can be read again", "couldn't give the calls their tries back: " + str(rs)[:200])

say(); say("PART 3 · PROOF")
s, b = http("POST", f"{FNB}/functions/v1/{FN}", {})
chk(s in (401, 403), f"{FN}: a caller with no key gets nothing ({s})", f"{FN} answered a stranger ({s})")
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
elif not note.get("looked_at"): bad("the job ran but looked at no call. Tell Claude.")
else: chk(note.get("errors", 0) == 0, f"the new build ran: looked at {note.get('looked_at', 0)} call(s), read {note.get('read', 0)}, nothing to fill in or too short {note.get('skipped', 0)}, waiting for a transcript {note.get('waiting', 0)}",
          f"the new build ran with {note.get('errors')} error(s); the list below says why")
okq, rows = sql(HUB, ROWS)
say(); say(f"  EVERY CALL IT HAS LOOKED AT ({len(rows) if okq else '?'}):")
for r in (rows if okq else []):
    say(f"  · call {r['id']}… {r['call_at']} ({r['seconds'] or '?'} s): {r['status'].upper()}, try {r['tries']}" + (f", heard {r['heard']} box(es)" if r['heard'] else "") + (f" · {r['note']}" if r['note'] else ""))
if okq and any(r["status"] == "error" for r in rows): bad("a call still ends in an error; its line says exactly why. Tell Claude.")
say()
say("  1058: " + ("DONE. Every call it has looked at is read or says why not; the hub box comes next." if not L.fails else "NOT COMPLETE. See the ✗ lines above."))
done(0 if not L.fails else 1)
