#!/usr/bin/env python3
# 1050 · THE CALL READER GETS UNSTUCK (2026-10-22, Samantha: "build the call reader fix: no cards for calls older than 2 days,
# and the behind alarm"). 1049 confirmed it read only the OLDEST 80 calls since its start date, so it stopped at Fri Oct 16
# (97 calls unread) while every run said ok. Now it pages past the calls it has read (14 days back at most), a call read more
# than 2 days late makes no promise card and no "Couldn't read" card, and a call nobody has tried 2 hours after it happened
# makes the run report itself not ok ("BEHIND").
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the call reader's tests pass (fake data only).
#  2. Deploys call-tasks (gateway setting kept). No database change.
#  3. Proves it: a stranger is refused; waits for the next 10-minute run and reports how many it read and how many are left.
# Sends nothing to anyone; every GoHighLevel request is a read. Safe to run again.
import json, os, re, subprocess, shutil, time
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, sql, deploy, start, check_build, fmeta

HUB = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB}.supabase.co")
FN = "call-tasks"
WAIT_S = int(os.environ.get("SB_WAIT_S", "720"))
ok = lambda s: say("  ✓ " + s)
def chk(good, msg, badmsg=None): (ok(msg) if good else bad(badmsg or msg))
def run(args, cwd=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)
BEAT = "select x->>'at' as at, x->>'ok' as ok, x->>'note' as note from app_data, jsonb_array_elements(data) x where key = 'automation_heartbeats' and x->>'id' = 'hb_call-tasks'"
UNREAD = """select count(*) as n from call_pull_seen s where s.call_at >= now() - interval '14 days' and s.stage in ('done','practice','error','no_transcript')
 and not exists (select 1 from call_task_reading r where r.message_id = s.message_id and r.version = 'v13-2026-10-12')"""

start("THE CALL READER GETS UNSTUCK")
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
    for t, must in (("call_reader_1049_test.mjs", "ALL GREEN"), ("promise_cards_975_test.mjs", "ALL GREEN"), ("unread_cards_991_test.mjs", "ALL GREEN")):
        c, o = run([NODE, t], cwd=ROOT)
        if c != 0 or must not in o: stop(f"the call reader's tests failed ({t}): " + " ".join(l for l in o.splitlines() if l.startswith("FAIL"))[:240])
    ok("call reader tests pass, including 80 old calls already read and 15 newer ones waiting (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
okq, u0 = sql(HUB, UNREAD)
if okq and u0: say(f"  · calls from the last 14 days not read yet (before): {u0[0]['n']}")
s_, m = fmeta(HUB, FN)
if s_ != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {FN} is set up live ({s_})", 3)
gate = bool(m["verify_jwt"]); say(f"  · {FN} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if gate else 'off'} (kept)")
okq, b0 = sql(HUB, BEAT); at0 = (b0[0]["at"] if okq and b0 else "") or ""

say(); say("PART 2 · CHANGE")
if not deploy(HUB, FNROOT, FN, gate): say("  STOP. Tell Claude. (Nothing else was changed.)"); done(5)

say(); say("PART 3 · PROOF")
s_, b = http("POST", f"{FNB}/functions/v1/{FN}", {})
chk(s_ in (401, 403), f"{FN}: a caller with no key gets nothing ({s_})", f"{FN} answered a stranger ({s_})")
say(f"  · waiting for the next 10-minute run (up to {WAIT_S // 60} minutes)...")
note = None; t0 = time.time()
while time.time() - t0 < WAIT_S:
    time.sleep(20)
    okq, b1 = sql(HUB, BEAT)
    if okq and b1 and (b1[0]["at"] or "") > at0 and '"behind"' in (b1[0]["note"] or ""):
        raw = b1[0]["note"] or ""   # the note is cut at 300 characters, so read the counts out of it, not the whole JSON
        note = {k: int(m_.group(1)) for k in ("read", "unread", "behind") for m_ in [re.search('"' + k + r'":\s*(\d+)', raw)] if m_}
        bs = re.search(r'"behind_since":\s*"([^"]+)"', raw)
        if bs: note["behind_since"] = bs.group(1)
        break
if note is None: bad("the call reader has not run the new build yet; run this again in 15 minutes to see it")
else:
    if "read" not in note or "unread" not in note: bad("the call reader ran, but its run note could not be read: " + json.dumps(note)[:200])
    chk("read" in note and "unread" in note and (note["read"] > 0 or note["unread"] == 0), f"the new build ran: read {note.get('read', 0)} call(s); {note.get('unread', '?')} still to read",
        f"the new build ran but read nothing while {note.get('unread', '?')} call(s) wait: " + json.dumps(note)[:200])
    if int(note.get("behind", 0)) > 0: say(f"  · catching up: {note.get('behind')} call(s) more than 2 hours old still to read (oldest {note.get('behind_since', '?')}). It reads 6 every 10 minutes, so the run says BEHIND (not ok) until it has caught up. That is the new alarm working.")
    else: ok("nothing is behind; the run reports ok")
    okq, u1 = sql(HUB, UNREAD)
    if okq and u1: say(f"  · calls from the last 14 days not read yet (after): {u1[0]['n']}")
say()
say("  1050: " + ("DONE. The call reader reads new calls again and says BEHIND if it ever falls behind." if not L.fails else "NOT COMPLETE. See the ✗ lines above."))
done(0 if not L.fails else 1)
