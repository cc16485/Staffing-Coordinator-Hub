#!/usr/bin/env python3
# 1224 · STAFFING SERVER · THE CALL-OFF JOB STOPS THE WASTED AXISCARE READS (2026-10-31, Samantha: "remove the call-off job", her
# pick: "Just the wasted reads")
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (no real data); coverage-run live runs
#     GitHub's main code (so nobody else's live change is overwritten); its gateway setting is read, so it is kept.
#  2. Redeploys coverage-run. Every 3 minutes it re-read 14 days of past schedule, the next 7 days, the whole caregiver list and,
#     for each open case, that day's schedule and 180 days of the client's visits (about 29 AxisCare reads a run). They fed only
#     the automatic texting waves, which are retired, so they stop. The ask lists, the Text button, the CRITICAL open shift
#     alerts and the closing texts are unchanged; they read AxisCare themselves. The false "Cara is HOLDING all callouts" card
#     stops too. No database change, no switch.
#  3. Proof (nothing is sent or saved): coverage-run refuses anyone not signed in to the office.
# Texts nobody. Safe to run again.
import json, os, subprocess, shutil, time
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, deploy, start, check_build, fmeta, MG, API, sql, lit

REF = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
BASE = os.environ.get("SB_BASE", "")   # the commit live is expected to match before this step (main after 1223)
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
if NODE == "none": NODE = ""
PGLITE = os.environ.get("SB_PGLITE", "/Users/samantha/Claude/Projects/.pglite/node_modules/@electric-sql/pglite/dist/index.js")
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FNS = ("coverage-run",); PUBLIC_NEW = {}
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
def sha_of(ref, path):
    import hashlib
    c, o = run(["git", "-C", ROOT, "show", f"{ref}:{path}"])
    return hashlib.sha256(o.encode()).hexdigest() if c == 0 else None
def main_versions(path):
    """Every version of a file GitHub's main has had (up to the build this builds on, the last 60 changes): live may run an older one
    when a step deployed it before a later change (1202 put coverage-run live before every week changed prn-oncall.ts)."""
    c, o = run(["git", "-C", ROOT, "log", "-n", "60", "--format=%H", BASE, "--", path]) if BASE else (1, "")
    return {h for h in (sha_of(x, path) for x in (o.split() if c == 0 else [])) if h}

# the code this step changes
CHANGED = {"supabase/functions/coverage-run/index.ts"}
start("STAFFING SERVER · THE CALL-OFF JOB STOPS THE WASTED AXISCARE READS")
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
    for t, must in (("wave_reads_test.mjs", "12/12 passed"), ("replacement_cover_test.mjs", "16/16 passed"), ("covered_outside_harness.mjs", "ALL 18 CHECKS PASS")):
        c, o = run([NODE, t], cwd=ROOT, env=env)
        if c != 0 or must not in o: stop(f"the tests failed ({t}): " + " ".join(l.strip() for l in o.splitlines() if "FAIL" in l)[:240])
    ok("the wasted-reads check and the call-off tests pass (no real data)")
else: say("  · node or the throwaway Postgres is not on this Mac, so the tests were not re-run here (they passed when built)")
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
    if not deploy(REF, FNROOT, fn, meta[fn]): say(f"  STOP at {fn}. Tell Claude. (Run this again to finish.)"); done(6)

say(); say("PART 3 · PROOF (nothing is sent or saved)")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
A = {"apikey": ANON, "Authorization": "Bearer " + ANON}
for fn in FNS:
    s1 = http("POST", f"{FNB}/functions/v1/{fn}", {"dry": True}, A)[0]
    (ok if s1 in (401, 403) else bad)(f"{fn} refuses anyone not signed in to the office ({s1})")
say()
say("  1224: " + ("DONE. The call-off job no longer re-reads AxisCare every 3 minutes for the retired automatic texts. Ask lists, "
    "the Text button, CRITICAL alerts and closing texts are unchanged. Nothing else to do; tell Claude \"ran 1224\"."
    if not L.fails else "NOT COMPLETE. See the ✗ lines above. Tell Claude."))
done(0 if not L.fails else 1)
