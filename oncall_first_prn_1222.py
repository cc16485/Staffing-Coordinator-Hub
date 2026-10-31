#!/usr/bin/env python3
# 1222 · STAFFING SERVER · ON CALL FIRST, THEN THE PRN TEAMS (2026-10-31, Samantha: "when there is a call in we need to send it to
# the on-call person if there is on-call signed up for that day ... a clear way to send to PRN CNA team and/or PRN Caregiver team
# if there isn't an on-call ... record if the on-call person is not responsive"; her four picks the same day)
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (fake data only); the four functions
#     live run GitHub's main code (so nobody else's live change is overwritten); each gateway setting is read, so it is kept;
#     the new switch "text the on-call person" (prn_oncall_text_live) is off.
#  2. Redeploys coverage-run, prn-week, prn-page and oncall-page: a shift that runs into someone's on-call time is theirs; the
#     caller is never their own cover; 15 minutes; the text and the 15-minute admin text (only once the new switch is on); the
#     PRN teams by the client's level; "Text the PRN teams". No database change.
#  3. Proof (nothing is sent or saved): each refuses outsiders where it should; the pages refuse a forged link; the switch is
#     still off.
# Texts nobody. Safe to run again.
import json, os, subprocess, shutil, time
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, deploy, start, check_build, fmeta, MG, API, sql, lit

REF = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
BASE = os.environ.get("SB_BASE", "")   # the commit live is expected to match before this step (1212's build)
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
if NODE == "none": NODE = ""
PGLITE = os.environ.get("SB_PGLITE", "/Users/samantha/Claude/Projects/.pglite/node_modules/@electric-sql/pglite/dist/index.js")
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FNS = ("coverage-run", "prn-week", "prn-page", "oncall-page"); PUBLIC_NEW = {}
ok = lambda s: say("  ✓ " + s)
def run(args, cwd=None, env=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True, env=env); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)
def keys():
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys{q}", headers=MG())
        if s != 200: continue
        try: arr = json.loads(b)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        out = {}
        for k in arr:
            v = k.get("api_key", "") if isinstance(k, dict) else ""
            if isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_")) and "·" not in v and "*" not in v: out[k.get("name")] = v
        if out.get("service_role") and out.get("anon"): return out
    return {}
WHY = {"": ""}
def switch_on():
    for i in range(3):
        okS, st = sql(REF, f"select data->'{SWITCH}' as v from public.app_data where key='ops_settings'")
        if okS and st: return st[0].get("v") is True
        WHY[""] = str(st)[:300] if not okS else "no settings row came back"
        time.sleep(3 * (i + 1) * float(os.environ.get("SB_RETRY_SCALE", "1")))
    return None
def why_read():
    w = WHY[""].lower()
    if "unauthorized" in w or "jwt" in w or ("invalid" in w and "token" in w) or "401" in w: return "Supabase didn't accept the access token (it may have expired or been revoked). Make a new one at supabase.com/dashboard/account/tokens and run this again."
    return "Supabase answered: " + WHY[""]
def sha_of(ref, path):
    import hashlib
    c, o = run(["git", "-C", ROOT, "show", f"{ref}:{path}"])
    return hashlib.sha256(o.encode()).hexdigest() if c == 0 else None
def main_versions(path):
    """Every version of a file GitHub's main has had (up to the build this builds on, the last 60 changes): live may run an older one
    when a step deployed it before a later change (1202 put coverage-run live before every week changed prn-oncall.ts)."""
    c, o = run(["git", "-C", ROOT, "log", "-n", "60", "--format=%H", BASE, "--", path]) if BASE else (1, "")
    return {h for h in (sha_of(x, path) for x in (o.split() if c == 0 else [])) if h}

# the code this step changes (the new reader is new, so it is never live before this step)
SWITCH = "prn_oncall_text_live"   # the new switch: must be off before this step
CHANGED = {"supabase/functions/_shared/prn-oncall.ts", "supabase/functions/_shared/cara-waves.ts", "supabase/functions/coverage-run/index.ts", "supabase/functions/prn-week/index.ts"}
start("STAFFING SERVER · ON CALL FIRST, THEN THE PRN TEAMS (new text switch OFF)")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")   # the rehearsal compares with its own commit
if MAIN == "origin/main": run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = [k for k in sorted({k for fn in FNS for k in L.need(FNROOT, fn)})
         if (lambda r: r[0] != 0 or r[1] != open(os.path.join(ROOT, k)).read())(run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"]))]
if drift: stop("this isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(drift)[:240] + ")")
ok("the reviewed build is what is on GitHub's main")
if NODE and os.path.exists(PGLITE):
    env = dict(os.environ, PGLITE=PGLITE)
    env["HUB"] = os.environ.get("SB_HUB", "/Users/samantha/Claude/Projects/cc-hub-cara-p1")   # the Hub's match-rules.js for the coverage tests
    for t, must in (("oncall_dispatch_test.mjs", "30/30"), ("prn_oncall_calendar_test.mjs", "73/73"), ("oncall_caregivers_test.mjs", "43/43"), ("prn_oncall_weekly_test.mjs", "48/48"),
                    ("oncall_7to7_test.mjs", "16/16"), ("prn_week_test.mjs", "52/52"), ("prn3_coverage_test.mjs", "27/27"), ("cara_run_test.mjs", "70/70"), ("cara_p1_test.mjs", "89/89"),
                    ("ci1_test.mjs", "25/25"), ("ci3_test.mjs", "28/28"), ("callin_test.mjs", "31/31"), ("wave_rules_test.mjs", "50/50"), ("prn_step1_test.mjs", "34/34"), ("practice_client_test.mjs", "20/20")):
        c, o = run([NODE, t], cwd=ROOT, env=env)
        if c != 0 or must not in o: stop(f"the tests failed ({t}): " + " ".join(l.strip() for l in o.splitlines() if "FAIL" in l)[:240])
    ok("the on call first, on-call calendar, caregiver on call, every-week, This week, PRN coverage, Cara, call-in and wave tests pass (fake data only)")
else: say("  · node or the throwaway Postgres is not on this Mac, so the tests were not re-run here (they passed when built)")
on = switch_on()
if on is None: stop("couldn't read the Hub's settings. " + why_read(), 3)
if on: stop("the new switch \"text the on-call person\" is already on (Settings, PRN Teams). Turn it off first, then run this again.")
ok("the new switch \"text the on-call person\" is off (this step does not change it)")
meta = {}; SKIP = []
for fn in FNS:
    s_, m_ = fmeta(REF, fn)
    if s_ == 404: SKIP.append(fn); continue   # not live: left alone
    if s_ != 200 or not m_ or "verify_jwt" not in m_: stop(f"couldn't read how {fn} is set up live ({s_})", 3)
    meta[fn] = bool(m_["verify_jwt"])
if SKIP: say("  · not live, so left alone: " + ", ".join(SKIP))
FNS = tuple(f for f in FNS if f not in SKIP)
ok("each function's gateway setting is read, so it is kept: " + ", ".join(f"{k} {'on' if v else 'off'}" + (" (new)" if k in PUBLIC_NEW and fmeta(REF, k)[0] == 404 else "") for k, v in meta.items()))
for fn in FNS:
    okL, livef = L.live_files(REF, fn)
    if not okL: stop(f"couldn't read the live {fn} to compare", 3)
    files = sorted(k for k in L.need(FNROOT, fn) if k in CHANGED)   # the files this step changes; the rest are main as always
    is_new = all(livef.get(k) == L.sha(os.path.join(ROOT, k)) for k in files)
    older, foreign = [], []
    for k in files:
        have = livef.get(k)
        if have == L.sha(os.path.join(ROOT, k)) or (BASE and have == sha_of(BASE, k)): continue
        (older if have and have in main_versions(k) else foreign).append(k.replace("supabase/functions/", ""))
    if foreign: stop(f"{fn} live has code that was never on GitHub's main ({', '.join(foreign)}): someone else's work may be live. Tell Claude before going on.", 3)
    ok(f"{fn} live is " + ("already this build (an earlier run)" if is_new else "GitHub's main" + (f", with an older main copy of {', '.join(older)} that this step brings up to date" if older else ", the build this one builds on")))
K = keys(); ANON = K.get("anon", ""); L.HIDE += [ANON, K.get("service_role", "")]
if not ANON: stop("couldn't read the Hub's keys", 3)

say(); say("PART 2 · CHANGE")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, meta[fn]): say(f"  STOP at {fn}. Tell Claude. (The ones before it have the fix; run this again to finish.)"); done(6)

say(); say("PART 3 · PROOF (nothing is sent or saved)")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
A = {"apikey": ANON, "Authorization": "Bearer " + ANON}
s3, b3 = http("POST", f"{FNB}/functions/v1/oncall-page", {"action": "view", "c": "1", "e": 4102444800, "t": "x" * 43}, A)
(ok if s3 == 401 and '"expired":true' in b3.replace(" ", "") else bad)(f"the My on-call page refuses a forged link ({s3})")
s4, b4 = http("POST", f"{FNB}/functions/v1/prn-page", {"action": "view", "p": "00000000-0000-4000-8000-000000000000", "e": 4102444800, "t": "x" * 43}, A)
(ok if s4 == 401 and '"expired":true' in b4.replace(" ", "") else bad)(f"the PRN Team page refuses a forged link ({s4})")
for fn, body in (("coverage-run", {"action": "send_prn", "case_id": "x", "teams": ["cna"], "send": True}), ("prn-week", {"action": "oncall_now"})):
    s1 = http("POST", f"{FNB}/functions/v1/{fn}", body, A)[0]
    (ok if s1 in (401, 403) else bad)(f"{fn} refuses anyone not signed in to the office ({s1})")
(ok if switch_on() is False else bad)("the new switch \"text the on-call person\" is still off")
say()
say("  1222: " + ("DONE. On call first and the PRN team buttons are on the server; the on-call text waits for its switch. Next: Claude merges the Hub "
    "pull request (the on-call box on every case card and the PRN team buttons), then you turn on \"text the on-call person\" in Settings, PRN Teams."
    if not L.fails else "NOT COMPLETE. See the ✗ lines above. Tell Claude."))
done(0 if not L.fails else 1)
