#!/usr/bin/env python3
# 1101 · CAREGIVER PREVIEW: DRAFT IT FROM THE LIFE STORY (Samantha, 2026-10-24, Life Story plan step 2). Re-deploys the
# caregiver-preview function with its new "draft" action: the AI writes a draft introduction from the Life Story only
# (checked for health, family and money words and for names not in the Life Story), returned to the tab, never saved;
# and an owner-only test route (?test_draft=1, the owner's server key) so the real AI can be tried before the switch is on.
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (fake data only); the AI key is set.
#     Every switch is read and left exactly as it is ("Caregiver Preview AI draft", cgp_ai_draft_live, stays off).
#  2. Re-deploys caregiver-preview with its gateway setting kept. No database change.
#  3. Proves it: no Hub sign-in = nothing; every switch as it was.
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
FNS = ["caregiver-preview"]
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
    return {k: v for k, v in d.items() if k.endswith('_live') or k.endswith('_practice') or k in SWITCHES + CARA}   # every on/off switch

start("CAREGIVER PREVIEW: DRAFT FROM THE LIFE STORY (switch off)")
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
    hubdir = tempfile.mkdtemp(prefix="cc1101hub-")
    run(["git", "-C", HUB_REPO, "fetch", "-q", "origin", "main"])
    for rf in ("match-rules.js", "eligibility-rules.js"):
        c0, mr = run(["git", "-C", HUB_REPO, "show", f"origin/main:{rf}"])
        if c0 != 0: stop(f"couldn't read the Hub's {rf} from GitHub's main (needed by the tests)")
        open(os.path.join(hubdir, rf), "w").write(mr)
    env = dict(os.environ, HUB=hubdir, HUB_ROOT=hubdir)
    for t, must in (("caregiver_preview_test.mjs", "71/71"), ("shift_page_test.mjs", "58/58")):
        c, o = run([NODE, t], cwd=ROOT, env=env)
        if c != 0 or (must and must not in o) or "\nFAIL" in o: stop(f"the tests failed ({t}): " + " ".join(l.strip() for l in o.splitlines() if "FAIL" in l)[:240])
    ok("the Caregiver Preview and shift page tests pass (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
sw = switches()
if sw is None: stop("couldn't read the settings", 3)
before = dict(sw)
on_now = [k for k, v in sw.items() if v not in (None, False, "false")]
say("  · switches on now (left exactly as they are): " + (", ".join(on_now) if on_now else "none"))
gates = {}
for fn in list(FNS):
    s_, m = fmeta(HUB, fn)
    if s_ == 404 and fn in OPTIONAL:   # never installed live (pilot-readiness): left alone, nothing to update
        FNS.remove(fn); say(f"  · {fn} is not installed live, so it is left alone"); continue
    if s_ != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {fn} is set up live ({s_})", 3)
    gates[fn] = bool(m["verify_jwt"]); say(f"  · {fn} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if gates[fn] else 'off'} (kept)")
oks, sl = run([os.environ.get("SB_SUPA_CLI", "supabase"), "secrets", "list", "--project-ref", REF], env=dict(os.environ, SUPABASE_ACCESS_TOKEN=os.environ.get("SB_TOKEN", "")))
if "ANTHROPIC_API_KEY" not in (sl or ""): stop("the AI key (ANTHROPIC_API_KEY) isn't set on the server, so drafts couldn't be made")
ok("the AI key is set on the server (its value is never read)")
say(); say("PART 2 · CHANGE")
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
s_, b_ = http("POST", f"{FNB}/functions/v1/caregiver-preview", {"action": "draft", "axiscare_client_id": "1"}, {"Content-Type": "application/json"})
chk(s_ == 401, f"caregiver-preview: a draft needs a Hub sign-in ({s_})", f"caregiver-preview answered a draft without a sign-in ({s_})")
s_, b_ = http("POST", f"{FNB}/functions/v1/caregiver-preview?test_draft=1", {"sources": [{"label": "x", "text": "y"}]}, {"Content-Type": "application/json"})
chk(s_ == 401, f"caregiver-preview: the test route refuses anyone without the owner's key ({s_})", f"caregiver-preview's test route answered without the owner's key ({s_})")
sw2 = switches()
chk(sw2 is not None and sw2 == before, "every switch is exactly as it was", "a switch changed during the step: tell Claude")
say()
say("  1101: " + ("DONE. Drafting from the Life Story is installed; its switch is off, so only owners can try it. Next: merge the Hub and Owners Hub pull requests." if not L.fails else "NOT COMPLETE. See the ✗ lines above."))
done(0 if not L.fails else 1)
