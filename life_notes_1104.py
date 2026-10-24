#!/usr/bin/env python3
# 1104 · LIFE STORY SUGGESTIONS: THE FOUR TWEAKS (Samantha, 2026-10-24, after the first practice read-back: similar topics
# grouped; caregiver tasks and the caregiver's own life left out; meals only when wanted; exercise and therapy out). The two-hourly
# note check (care-notes) also asks of each note what the client enjoys, and combines what it finds by topic per client in
# a practice store (life_note_suggestion). Nothing is shown on profiles, no cards, nothing sent.
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (fake data only). Every switch is
#     read and left as it is ("life_notes_practice" is turned on separately, at Samantha's word).
#  2. Database: the practice store (no browser access). Re-deploys care-notes with its gateway setting kept.
#  3. Proves it: no key = nothing; the read-back route refuses anyone without the owner's key; every switch as it was.
# Sends nothing to anyone. Safe to run again.
import json, os, subprocess, shutil, tempfile, time
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, sql, deploy, start, check_build, fmeta

REF = HUB = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
if NODE == "none": NODE = ""   # the rehearsal's way to skip the tests
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB}.supabase.co")
FNS = ["care-notes"]
OPTIONAL = set()
NEW = {}
SWITCHES = ["caregiver_preview_live"]
CARA = ["cara_list_live", "cara_visit_match_live", "cara_urgency_live", "cara_reply_ai_practice", "cara_reply_ai_live", "cara_today_live", "cara_board_live", "shift_page_live"]
HUB_REPO = os.environ.get("SB_HUB_REPO", "/Users/samantha/Claude/Projects/cc-hub-live")
ok = lambda s: say("  ✓ " + s)
def chk(good, msg, badmsg=None): (ok(msg) if good else bad(badmsg or msg))
def run(args, cwd=None, env=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True, env=env); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)
def keys():
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_secret_")) and "·" not in v and "*" not in v
    for q_ in ("?reveal=true", ""):
        s_, b_ = http("GET", f"{L.API}/v1/projects/{REF}/api-keys{q_}", headers=L.MG())
        if s_ != 200: continue
        try: arr = json.loads(b_)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        got = {k.get("name"): k.get("api_key", "") for k in arr if isinstance(k, dict) and usable(k.get("api_key", ""))}
        if got.get("service_role"): return got
    return {}
def switches():
    okq, st = sql(HUB, "select data from app_data where key = 'ops_settings'")
    if not okq or not st: return None
    d = st[0].get("data") or {}
    if isinstance(d, str):
        try: d = json.loads(d)
        except Exception: d = {}
    return {k: v for k, v in d.items() if k.endswith('_live') or k.endswith('_practice')}   # every on/off switch

start("LIFE STORY SUGGESTIONS: THE FOUR TWEAKS (practice)")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = []
for fn in FNS + list(NEW):
    for k in sorted(L.need(FNROOT, fn)):
        c2, b2 = run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"])
        if c2 != 0 or b2 != open(os.path.join(ROOT, k)).read(): drift.append(k)
if drift: stop("this isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(sorted(set(drift)))[:240] + ")")
ok("the reviewed build is what is on GitHub's main")
if NODE:
    hubdir = tempfile.mkdtemp(prefix="cc1104hub-")
    run(["git", "-C", HUB_REPO, "fetch", "-q", "origin", "main"])
    for rf in ("match-rules.js", "eligibility-rules.js"):
        c0, mr = run(["git", "-C", HUB_REPO, "show", f"origin/main:{rf}"])
        if c0 != 0: stop(f"couldn't read the Hub's {rf} from GitHub's main (needed by the tests)")
        open(os.path.join(hubdir, rf), "w").write(mr)
    env = dict(os.environ, HUB=hubdir, HUB_ROOT=hubdir)
    for t, must in (("life_notes_test.mjs", "26/26"), ("n2_flag_test.mjs", "18/18"), ("shift_note_levels_test.mjs", "24/24"), ("my_desk_466_test.mjs", "17/17"), ("n1_client_notes_test.mjs", "9/9"), ("not_clients_test.mjs", "24/24")):
        c, o = run([NODE, t], cwd=ROOT, env=env)
        if c != 0 or (must and must not in o) or "\nFAIL" in o: stop(f"the tests failed ({t}): " + " ".join(l.strip() for l in o.splitlines() if "FAIL" in l)[:240])
    ok("the shift-note, Kind Words and suggestion tests pass (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
sw = switches()
if sw is None: stop("couldn't read the settings", 3)
before = dict(sw)
say("  · switches left exactly as they are")
gates = {}
for fn in list(FNS):
    s_, m = fmeta(HUB, fn)
    if s_ == 404 and fn in OPTIONAL:   # never installed live (pilot-readiness): left alone, nothing to update
        FNS.remove(fn); say(f"  · {fn} is not installed live, so it is left alone"); continue
    if s_ != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {fn} is set up live ({s_})", 3)
    gates[fn] = bool(m["verify_jwt"]); say(f"  · {fn} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if gates[fn] else 'off'} (kept)")
say(); say("PART 2 · CHANGE")
okd, out = sql(HUB, open(os.path.join(ROOT, "life_notes_1103.sql")).read())
if not okd: stop("the database step failed (nothing else was changed): " + str(out)[:200], 4)
okv, chk2 = sql(HUB, "select (select count(*) from information_schema.tables where table_name = 'life_note_suggestion') as tbl, (select count(*) from information_schema.role_table_grants where table_name = 'life_note_suggestion' and grantee in ('anon', 'authenticated')) as open_grants")
r0 = (chk2 or [{}])[0] if okv else {}
chk(okv and int(r0.get("tbl") or 0) == 1 and int(r0.get("open_grants") or 0) == 0, "database: the practice store is there, no browser access", "database check failed: " + json.dumps(r0)[:200])
for fn in FNS:
    if not deploy(HUB, FNROOT, fn, gates[fn]): say(f"  STOP at {fn}. Tell Claude. (The functions before it are deployed.)"); done(5)
for fn, gate in NEW.items():
    if not deploy(HUB, FNROOT, fn, gate): say(f"  STOP at {fn}. Tell Claude."); done(5)

say(); say("PART 3 · PROOF")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
K = keys(); SERVICE = (K or {}).get("service_role", "")
if SERVICE: L.HIDE.append(SERVICE)
for fn in FNS:
    s_, _ = http("POST", f"{FNB}/functions/v1/{fn}?auth_check=1", {}, {"Content-Type": "application/json"})
    chk(s_ is not None and s_ != 200 and s_ < 500, f"{fn}: a caller with no key gets nothing ({s_})", f"{fn} answered a caller with no key ({s_})")
s_, b_ = http("POST", f"{FNB}/functions/v1/care-notes?life=1&hours=1", {}, {"Content-Type": "application/json"})
chk(s_ == 401, f"care-notes: the read-back route refuses anyone without the owner's key ({s_})", f"care-notes read-back answered without the owner's key ({s_})")
sw2 = switches()
chk(sw2 is not None and sw2 == before, "every switch is exactly as it was", "a switch changed during the step: tell Claude")
say()
say("  1104: " + ("DONE. The four tweaks are installed; practice keeps collecting and nothing is shown on profiles. Next: Claude clears the practice store and reads back two weeks again to compare." if not L.fails else "NOT COMPLETE. See the ✗ lines above."))
done(0 if not L.fails else 1)
