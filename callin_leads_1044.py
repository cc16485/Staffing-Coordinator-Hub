#!/usr/bin/env python3
# 1044 · FAMILIES WHO CALLED BEFORE THEY WERE A LEAD (2026-10-22, Samantha: "lead that call into the office are being
# treated as a lead that need followed up immediately like a website lead form ... we are getting alerts to call Greg,
# but he called in as a lead and already spoke to Krystal"). The call recorder (lead-record) now also looks up the
# conversations of every lead nobody has reached yet, so a call from BEFORE they were typed in counts as the first
# real conversation and the first-call clock and its alerts stop.
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the recorder's tests pass (fake data only).
#  2. Deploys lead-record (gateway setting kept). No database change.
#  3. Proves it: a stranger is refused; waits for the next 5-minute run and reports what it found.
# Sends nothing; every GoHighLevel request is a read. Safe to run again.
import json, os, subprocess, shutil, time
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, sql, deploy, start, check_build, fmeta

HUB = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB}.supabase.co")
FN = "lead-record"
WAIT_S = int(os.environ.get("SB_WAIT_S", "420"))
ok = lambda s: say("  ✓ " + s)
def chk(good, msg, badmsg=None): (ok(msg) if good else bad(badmsg or msg))
def run(args, cwd=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)
BEAT = "select x->>'at' as at, x->>'note' as note from app_data, jsonb_array_elements(data) x where key = 'automation_heartbeats' and x->>'id' = 'hb_lead-record'"
UNREACHED = """select coalesce(l->>'first_name','') || ' ' || coalesce(l->>'last_name','') as name from app_data, jsonb_array_elements(case when jsonb_typeof(data) = 'array' then data else '[]'::jsonb end) l
 where key = 'leads' and coalesce((l->>'archived')::boolean, false) = false and coalesce(l->>'first_human_contact_at','') = '' and coalesce(l->>'status','New') <> 'Lost'"""

start("FAMILIES WHO CALLED BEFORE THEY WERE A LEAD")
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
    c, o = run([NODE, "lead_record_test.mjs"], cwd=ROOT)
    if c != 0 or "typed in after the call" not in o: stop("the recorder's tests failed: " + " ".join(l for l in o.splitlines() if "✗" in l)[:240])
    ok("recorder tests pass, including a family typed in after their call (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
okq, before = sql(HUB, UNREACHED)
if okq: say(f"  · leads nobody has reached yet (before): {len(before)}" + (": " + ", ".join(r['name'].strip() or 'no name' for r in before)[:300] if before else ""))
s, m = fmeta(HUB, FN)
if s != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {FN} is set up live ({s})", 3)
gate = bool(m["verify_jwt"]); say(f"  · {FN} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if gate else 'off'} (kept)")
okq, b0 = sql(HUB, BEAT); at0 = (b0[0]["at"] if okq and b0 else "") or ""

say(); say("PART 2 · CHANGE")
if not deploy(HUB, FNROOT, FN, gate): say("  STOP. Tell Claude. (Nothing else was changed.)"); done(5)

say(); say("PART 3 · PROOF")
s, b = http("POST", f"{FNB}/functions/v1/{FN}", {})
chk(s in (401, 403), f"{FN}: a caller with no key gets nothing ({s})", f"{FN} answered a stranger ({s})")
say(f"  · waiting for the next 5-minute run (up to {WAIT_S // 60} minutes)...")
note = None; t0 = time.time()
while time.time() - t0 < WAIT_S:
    time.sleep(20)
    okq, b1 = sql(HUB, BEAT)
    if okq and b1 and (b1[0]["at"] or "") > at0 and "unreached" in (b1[0]["note"] or ""):
        try: note = json.loads(b1[0]["note"])
        except Exception: note = {}
        break
if note is None: bad("the recorder has not run the new build yet; run this again in 10 minutes to see it")
else:
    chk(note.get("errors", 0) == 0, f"the new build ran: looked at {note.get('unreached', 0)} lead(s) nobody had reached, found {note.get('looked_up', 0)} older conversation(s), recorded {note.get('recorded', 0)} call(s)/text(s)",
        f"the new build ran with {note.get('errors')} error(s): {json.dumps(note)[:240]}")
    okq, after = sql(HUB, UNREACHED)
    if okq:
        now_reached = sorted({r['name'].strip() for r in before} - {r['name'].strip() for r in after})
        say(f"  · leads nobody has reached yet (after): {len(after)}" + (": " + ", ".join(r['name'].strip() or 'no name' for r in after)[:300] if after else ""))
        if now_reached: ok("now counted as talked to, from a call already on the office line: " + ", ".join(now_reached)[:300])
say()
say("  1044: " + ("DONE. A family who called before being typed in no longer gets first-call alerts." if not L.fails else "NOT COMPLETE. See the ✗ lines above."))
done(0 if not L.fails else 1)
