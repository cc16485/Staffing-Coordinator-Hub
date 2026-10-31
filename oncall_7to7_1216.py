#!/usr/bin/env python3
# 1216 · STAFFING SERVER · ON CALL 7AM TO 7PM, AND WHICH SHIFTS ARE OFFERED (2026-10-30, Samantha: "can we build it set for 7am-7pm
# and 7pm-7am on call, and just show the open shifts being Friday, Saturday, and Sunday 7am-7pm. Allow owners to click to open
# on-call shifts right on the on-call tab")
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (fake data and a throwaway Postgres
#     only); the four functions live are GitHub's main code (so nobody else's live change is overwritten); each function's
#     gateway setting is read, so it is kept.
#  2. Deploys prn-week, prn-page, oncall-page and coverage-run: on call is daytime 7am to 7pm and overnight 7pm to 7am; only the
#     offered shifts are open for sign-up (nothing set = Friday, Saturday and Sunday 7am to 7pm); Rule 1 of the expectations names
#     the new times (so anyone who signed signs once more). No database change.
#  3. Proof (nothing is sent or saved): each refuses outsiders and forged links; the switches are as they were.
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
FNS = ("prn-week", "prn-page", "oncall-page", "coverage-run"); PUBLIC_NEW = {}
SWITCH = "prn_oncall_signup_live"
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

# the code this step changes in the two live functions (outreach.ts and send-problems.ts only gain one registry line each)
CHANGED = {"supabase/functions/prn-week/index.ts", "supabase/functions/prn-page/index.ts", "supabase/functions/oncall-page/index.ts", "supabase/functions/coverage-run/index.ts",
           "supabase/functions/_shared/prn-oncall.ts", "supabase/functions/_shared/prn-recognition.ts", "supabase/functions/_shared/prn-week.ts"}
start("STAFFING SERVER · ON CALL 7AM TO 7PM, AND WHICH SHIFTS ARE OFFERED")
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
    for t, must in (("oncall_7to7_test.mjs", "16/16"), ("oncall_caregivers_test.mjs", "43/43"), ("prn_oncall_weekly_test.mjs", "48/48"), ("prn_oncall_calendar_test.mjs", "73/73"),
                    ("prn_oncall_shift_test.mjs", "12/12"), ("prn_recognition_test.mjs", "47/47"), ("prn_week_test.mjs", "52/52"), ("prn_page_test.mjs", "43/43"), ("prn3_coverage_test.mjs", "27/27")):
        c, o = run([NODE, t], cwd=ROOT, env=env)
        if c != 0 or must not in o: stop(f"the tests failed ({t}): " + " ".join(l.strip() for l in o.splitlines() if "FAIL" in l)[:240])
    ok("the 7am-to-7pm, caregiver on-call, every-week, on-call calendar, shift, recognition, This week, PRN Team page and coverage tests pass (fake data and a throwaway Postgres only)")
else: say("  · node or the throwaway Postgres is not on this Mac, so the tests were not re-run here (they passed when built)")
on = switch_on()
if on is None: stop("couldn't read the Hub's switches. " + why_read(), 3)
ok("On-call sign-up: " + ("ON (members see the new times and the offered shifts as soon as this finishes, and sign the expectations once more)" if on else "OFF") + " (this step does not change that)")
meta = {}
for fn in FNS:
    s_, m_ = fmeta(REF, fn)
    if s_ == 404 and fn in PUBLIC_NEW: meta[fn] = PUBLIC_NEW[fn]; continue
    if s_ != 200 or not m_ or "verify_jwt" not in m_: stop(f"couldn't read how {fn} is set up live ({s_})", 3)
    meta[fn] = bool(m_["verify_jwt"])
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
    if not deploy(REF, FNROOT, fn, meta[fn]): say(f"  STOP at {fn}. Tell Claude. (Some functions may have the new times and some the old; run this again.)"); done(6)

say(); say("PART 3 · PROOF (nothing is sent or saved)")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
A = {"apikey": ANON, "Authorization": "Bearer " + ANON}
s1 = http("POST", f"{FNB}/functions/v1/prn-week", {"action": "week"}, A)[0]
(ok if s1 in (401, 403) else bad)(f"prn-week refuses anyone not signed in to the office ({s1})")
s2, b2 = http("POST", f"{FNB}/functions/v1/prn-page", {"action": "view", "p": "00000000-0000-4000-8000-000000000000", "e": 4102444800, "t": "x" * 43}, A)
(ok if s2 == 401 and '"expired":true' in b2.replace(" ", "") else bad)(f"the PRN Team page refuses a forged link ({s2})")
s3, b3 = http("POST", f"{FNB}/functions/v1/oncall-page", {"action": "view", "c": "1", "e": 4102444800, "t": "x" * 43}, A)
(ok if s3 == 401 and '"expired":true' in b3.replace(" ", "") else bad)(f"the My on-call page refuses a forged link ({s3})")
s4 = http("POST", f"{FNB}/functions/v1/coverage-run", {"action": "board", "case_id": "x"}, A)[0]
(ok if s4 in (401, 403) else bad)(f"coverage-run refuses anyone not signed in to the office ({s4})")
okO, oo = sql(REF, "select data->'prn_oncall_offered' as v from public.app_data where key='ops_settings'")
(ok if okO else bad)("on-call shifts offered: " + ("Friday, Saturday and Sunday 7am to 7pm (nothing set yet; owners change it on the On call tab)" if okO and oo and oo[0].get("v") is None else "as owners set them on the On call tab" if okO else "couldn't read"))
(ok if switch_on() == on else bad)("the sign-up switch is as it was")
say()
say("  1216: " + ("DONE. On call is 7am to 7pm and 7pm to 7am on the server, with only the offered shifts open for sign-up. Next: Claude merges the Hub and website "
    "pull requests, then owners see the open/close grid on the On call tab."
    if not L.fails else "NOT COMPLETE. See the ✗ lines above. Tell Claude."))
done(0 if not L.fails else 1)
