#!/usr/bin/env python3
# 1051 · SPEED TO LEAD: ONE TEXT PER FAMILY (2026-10-22, Samantha: "maybe just one notification about the lead";
# the Speed to lead design approved, artifact 5vuSNJ9NKGhNiYf9ScEj7M; "Build it, starting with the one notification").
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (fake data only); the LIVE
#     lead-watch and lead-digest are exactly the build this change started from (so nothing anyone else deployed is
#     overwritten; the 969 lesson); reads the speed-to-lead switches.
#  2. Deploys lead-watch and lead-digest (gateway settings kept), then turns on ops_settings.lead_one_text (recorded in
#     op_events like a Hub switch).
#  3. Proves it: a stranger is refused; the next 2-minute lead-watch run reports one text per family.
# Sends nothing itself. Safe to run again.
import json, os, subprocess, shutil, time, calendar
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, sql, deploy, start, check_build, fmeta, live_files, lit, sha

HUB = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
BASE = os.environ.get("SB_BASE", "")           # the main commit this change started from: live must be exactly that
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB}.supabase.co")
FNS = ["lead-watch", "lead-digest"]
ok = lambda s: say("  ✓ " + s)
def chk(good, msg, badmsg=None): (ok(msg) if good else bad(badmsg or msg))
def run(args, cwd=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)
SETTINGS = """select coalesce((data::jsonb->>'lead_rungs_live')::boolean, false) as rungs, coalesce((data::jsonb->>'lead_one_text')::boolean, false) as one_text
  from public.app_data where key = 'ops_settings'"""
BEAT = "select item->>'at' as at, item->>'note' as note from public.app_data, jsonb_array_elements(case when jsonb_typeof(data::jsonb) = 'array' then data::jsonb else '[]'::jsonb end) item where key = 'automation_heartbeats' and item->>'id' = 'hb_lead-watch'"

def sha_text(t):
    tmp = os.path.join(ROOT, ".cmp_1051"); open(tmp, "w").write(t); h = sha(tmp); os.remove(tmp); return h
def past_version(k, h):
    """The date and subject of the main commit where file k had sha h, when that is an earlier version on the starting build's history."""
    if not h: return ""
    c, log = run(["git", "-C", ROOT, "log", "--format=%H %ad %s", "--date=format:%b %d %H:%M", BASE, "--", k])
    if c != 0: return ""
    for line in log.splitlines()[:200]:
        commit, rest = line.split(" ", 1)
        c2, body = run(["git", "-C", ROOT, "show", f"{commit}:{k}"])
        if c2 == 0 and sha_text(body) == h: return rest[:12].strip()
    return ""

start("SPEED TO LEAD: ONE TEXT PER FAMILY")
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
    for t, must in (("one_text_test.mjs", "9/9 passed"), ("lead_watch_494_test.mjs", "26/26 passed"), ("morning_email_420_test.mjs", "34/34 passed"), ("lead_turns_stage1_test.mjs", "17/17 passed"), ("fair_counts_test.mjs", "7/7 passed")):
        c, o = run([NODE, t], cwd=ROOT)
        if c != 0 or must not in o: stop(f"the tests failed ({t}): " + " ".join(l for l in o.splitlines() if "FAIL" in l or "✗" in l)[:240])
    ok("tests pass: one text per family, the 15 and 30 still happen quietly and the miss still counts, the 8am brief line (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
if not BASE: stop("no starting build was given to compare the live functions with", 3)
metas = {}
for fn in FNS:
    okl, live = live_files(HUB, fn)
    if not okl: stop(f"couldn't download the live {fn} to compare it", 3)
    diff = []; older = []
    for k in sorted(L.need(FNROOT, fn)):
        c2, b2 = run(["git", "-C", ROOT, "show", f"{BASE}:{k}"])
        if c2 != 0:
            if k in live: diff.append(k + " (live has it, the starting build does not)")
            continue
        if live.get(k) == sha_text(b2): continue
        # Not the starting build. An OLDER version of the same file from main's history is fine (the function was last
        # deployed before that file moved on; deploying only brings it up to date). Anything else stops: unknown work.
        past = past_version(k, live.get(k))
        if past: older.append(f"{k} (live has the {past} version)")
        else: diff.append(k)
    if diff: stop(f"the live {fn} has something that is not on GitHub's main, so deploying could undo someone else's work: " + ", ".join(diff)[:240])
    if older: say(f"  · the live {fn} has older copies of: " + "; ".join(older)[:300] + ". Deploying brings them up to date; nothing newer is replaced.")
    ok(f"the live {fn} holds nothing that is not already on GitHub's main (nothing of anyone else's would be undone)")
    s, m = fmeta(HUB, fn)
    if s != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {fn} is set up live ({s})", 3)
    metas[fn] = bool(m["verify_jwt"]); say(f"  · {fn} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if metas[fn] else 'off'} (kept)")
okq, st = sql(HUB, SETTINGS)
if not okq or not st: stop("couldn't read the speed-to-lead switches: " + str(st)[:200], 3)
say(f"  · speed to lead is {'ON' if st[0]['rungs'] else 'off (practice)'}; one text per family is {'already on' if st[0]['one_text'] else 'off'}")

say(); say("PART 2 · CHANGE")
for fn in FNS:
    if not deploy(HUB, FNROOT, fn, metas[fn]): say("  STOP. Tell Claude. (Functions before this one are deployed; nothing else was changed.)"); done(5)
started = time.time()
if not st[0]["one_text"]:
    okq, r = sql(HUB, """update public.app_data set data = data::jsonb || jsonb_build_object('lead_one_text', true, 'lead_one_text_since', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
      where key = 'ops_settings' returning (data::jsonb->>'lead_one_text') as v""")
    chk(okq and r and r[0]["v"] == "true", "one text per family is ON (Owners Hub Admin page and Hub Settings show it; turn it off there any time)", "one text per family could not be turned on: " + str(r)[:200])
    if okq:
        sql(HUB, "insert into public.op_events (actor_email, actor_name, verb, item_id, area, summary) values ('samantha@mo-care.com', 'Samantha', 'setting_changed', 'ops_settings', 'growth_leads', "
            + lit("Samantha turned on One text per family (Desktop 1051, her Speed to lead approval 2026-10-22): only the 5-minute text goes out") + ")")
else: ok("one text per family was already on (left as it is)")

say(); say("PART 3 · PROOF")
for fn in FNS:
    s, b = http("POST", f"{FNB}/functions/v1/{fn}", {})
    chk(s in (400, 401, 403), f"{fn}: a caller with no key gets nothing ({s})", f"{fn} answered a stranger ({s})")
say("  · waiting for the next 2-minute lead-watch run (up to 5 minutes)...")
seen = None
for i in range(max(1, int(os.environ.get('SB_WAIT_S', '300')) // 10)):
    okq, hb = sql(HUB, BEAT)
    if okq and hb and hb[0]["at"] and calendar.timegm(time.strptime(hb[0]["at"][:19], "%Y-%m-%dT%H:%M:%S")) >= started - 5:
        seen = hb[0]; break
    time.sleep(10 if not os.environ.get('SB_FAST') else 0.2)
chk(bool(seen), f"lead-watch ran with the new build: {seen['note'] if seen else ''}", "lead-watch has not run since the change (check the Hub's automation status; nothing is broken by waiting)")
okq, st2 = sql(HUB, SETTINGS)
chk(okq and st2 and st2[0]["one_text"], "the switch reads ON", "the switch does not read on")
say()
say("  1051: " + ("DONE. A new family gets one text, at 5 minutes. The 15 and 30 happen on My Work and Leads with no text, and long waits are in the 8am brief." if not L.fails else "NOT COMPLETE. See the ✗ lines above."))
done(0 if not L.fails else 1)
