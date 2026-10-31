#!/usr/bin/env python3
# 1221 · STAFFING SERVER · AXISCARE CAREGIVER READ FIXED EVERYWHERE, WITH A SAFETY STOP ON CLASS CHANGES (2026-10-31, Samantha: "fix
# the AxisCare caregiver read everywhere as proposed, with the safety stop on class changes, and make the Desktop step")
#  AxisCare answers one caregiver as results.data; the server looked elsewhere. Fixed in one shared reader, used by the My on-call
#  page, Approved to Work, Level and nurse classes, the hiring hand-off, PRN Team linking and classes, the family app and the
#  AxisCare note step. Classes are never saved from an answer that doesn't carry the class list.
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (fake data only); every function below
#     that is live runs GitHub's main code (so nobody else's live change is overwritten); each gateway setting is read, so it is
#     kept. A function that isn't live is left alone.
#  2. Redeploys those functions. No database change, no switch change.
#  3. Proof (nothing is sent or saved): each refuses outsiders where it should; the My on-call page refuses a forged link.
# Texts nobody. Changes nothing in AxisCare. Safe to run again.
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
FNS = ("oncall-page", "prn-team", "caregiver-journey", "client-audit", "step2-handoff", "team-ask", "axiscare-note",
       "family-gateway", "family-offer", "family-app-office", "family-fee-check", "pilot-readiness"); PUBLIC_NEW = {}
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
SWITCH = "prn_oncall_invite_live"   # read only: proves the token works, and says whether caregivers can open the My on-call page yet
CHANGED = {"supabase/functions/_shared/axiscare-caregiver.ts", "supabase/functions/_shared/axis-setup.ts", "supabase/functions/_shared/family-app.ts",
           "supabase/functions/_shared/nurse-hire.ts", "supabase/functions/oncall-page/index.ts", "supabase/functions/prn-team/index.ts", "supabase/functions/axiscare-note/index.ts"}
start("STAFFING SERVER · AXISCARE CAREGIVER READ FIXED, WITH A SAFETY STOP ON CLASS CHANGES")
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
    for t, must in (("axis_caregiver_read_test.mjs", "12/12"), ("oncall_caregivers_test.mjs", "43/43"), ("prn2_team_test.mjs", "48/48"), ("prn_autolink_test.mjs", "25/25"),
                    ("prn_caregiver_1037_team_test.mjs", "11/11"), ("caregiver_journey_6_test.mjs", "128/128"), ("level_1033_test.mjs", "16/16"), ("lpn_step2_708_test.mjs", "9/9"),
                    ("lpn_journey_708_test.mjs", "37/37"), ("leave_1035_test.mjs", "22/22"), ("in_training_part_b_test.mjs", "15/15"), ("ref_auto_ask_1032_test.mjs", "10/10"),
                    ("step2_handoff_575_test.mjs", "58/58"), ("team_ask_test.mjs", "38/38"), ("team_ask_gate_test.mjs", "29/29"), ("axiscare_note_fn_test.mjs", "12/12"),
                    ("family_app_1a_test.mjs", "142/142"), ("family_app_flex_test.mjs", "182/182"), ("ask_list_test.mjs", "25/25")):
        c, o = run([NODE, t], cwd=ROOT, env=env)
        if c != 0 or must not in o: stop(f"the tests failed ({t}): " + " ".join(l.strip() for l in o.splitlines() if "FAIL" in l)[:240])
    ok("the caregiver read, on-call, PRN Team, Approved to Work, level, nurse, hand-off, team ask, note and family app tests pass (fake data only)")
else: say("  · node or the throwaway Postgres is not on this Mac, so the tests were not re-run here (they passed when built)")
on = switch_on()
if on is None: stop("couldn't read the Hub's settings. " + why_read(), 3)
ok("the Hub's settings read (this step changes no switch). Caregiver on-call invites: " + ("ON" if on else "OFF"))
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
for fn, body in (("oncall-page", {"action": "preview", "caregiver_ax": "1"}), ("prn-team", {"action": "classes", "applicant_id": "00000000-0000-4000-8000-000000000000"}),
                 ("axiscare-note", {"action": "caregiver_note", "axiscare_caregiver_id": "1", "note": "x"})):
    if fn not in FNS: continue
    s1 = http("POST", f"{FNB}/functions/v1/{fn}", body, A)[0]
    (ok if s1 in (401, 403) else bad)(f"{fn} refuses anyone not signed in to the office ({s1})")
say()
say("  1221: " + ("DONE. The AxisCare caregiver read is fixed on the server, with the safety stop on class changes. Next: Claude opens one caregiver's "
    "My on-call page in the office preview to check it now opens."
    if not L.fails else "NOT COMPLETE. See the ✗ lines above. Tell Claude."))
done(0 if not L.fails else 1)
