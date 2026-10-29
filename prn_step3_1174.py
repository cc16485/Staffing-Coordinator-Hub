#!/usr/bin/env python3
# 1174 · STAFFING SERVER · PRN STEP 3: FAMILIAR CLIENTS (2026-10-28, Samantha: "Yes, merge the server pull request #677 and
# make Desktop step 1174, same as before"; go-back wording and the 3+ call-offs rule approved the same day)
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (fake data and a throwaway
#     Postgres only); the new switch is off; each function's gateway setting is read, so it is kept.
#  2. Lets the PRN records hold the go-back question and its answers (prn_familiar.sql, one transaction), and deploys
#     prn-week (familiar clients and the two new lines), carematch-watch (the go-back text, off) and coverage-reply (reads
#     a YES or NO to it).
#  3. Proof (nothing is sent or saved): each function still refuses outsiders; a practice run of the first-shift watch shows
#     which texts it would send, PRN members marked; the switch is still off.
# Texts nobody. Safe to run again.
import json, os, subprocess, shutil, time
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, deploy, start, check_build, fmeta, MG, API, sql

REF = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
if NODE == "none": NODE = ""
PGLITE = os.environ.get("SB_PGLITE", "/Users/samantha/Claude/Projects/.pglite/node_modules/@electric-sql/pglite/dist/index.js")
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FNS = ("prn-week", "carematch-watch", "coverage-reply"); SWITCH = "prn_goback_live"
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
def switch_on():
    okS, st = sql(REF, f"select data->'{SWITCH}' as v from public.app_data where key='ops_settings'")
    return None if not okS or not st else st[0].get("v") is True

start("STAFFING SERVER · PRN STEP 3: FAMILIAR CLIENTS (switch OFF)")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = []
for k in sorted({k for fn in FNS for k in L.need(FNROOT, fn)}) + ["prn_familiar.sql"]:
    c2, b2 = run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"])
    if c2 != 0 or b2 != open(os.path.join(ROOT, k)).read(): drift.append(k)
if drift: stop("this isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(drift)[:240] + ")")
ok("the reviewed build is what is on GitHub's main")
if NODE and os.path.exists(PGLITE):
    env = dict(os.environ, PGLITE=PGLITE)
    for t, must in (("prn_familiar_test.mjs", "33/33"), ("prn_week_test.mjs", "52/52")):
        c, o = run([NODE, t], cwd=ROOT, env=env)
        if c != 0 or must not in o: stop(f"the tests failed ({t}): " + " ".join(l.strip() for l in o.splitlines() if "FAIL" in l)[:240])
    ok("the familiar clients and This week tests pass (fake data and a throwaway Postgres only)")
else: say("  · node or the throwaway Postgres is not on this Mac, so the tests were not re-run here (they passed when built)")
sw = switch_on()
if sw is None: stop("couldn't read the Hub's switches", 3)
if sw: stop(f"{SWITCH} is already on. Turn it off in the Hub first.")
ok(f"the new switch is off: {SWITCH}")
meta = {}
for fn in FNS:
    s_, m_ = fmeta(REF, fn)
    if s_ != 200 or not m_ or "verify_jwt" not in m_: stop(f"couldn't read how {fn} is set up live ({s_})", 3)
    meta[fn] = bool(m_["verify_jwt"])
ok("each function's gateway setting is read, so it is kept: " + ", ".join(f"{k} {'on' if v else 'off'}" for k, v in meta.items()))
K = keys(); ANON, SVC = K.get("anon", ""), K.get("service_role", ""); L.HIDE += [ANON, SVC]
if not (ANON and SVC): stop("couldn't read the Hub's keys", 3)

say(); say("PART 2 · CHANGE")
okQ, r = sql(REF, "begin;\n" + open(os.path.join(ROOT, "prn_familiar.sql")).read() + "\ncommit;")
if not okQ: bad("the record change didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Tell Claude."); done(6)
ok("the PRN records can now keep the go-back question and its answers")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, meta[fn]): say(f"  STOP at {fn}. Tell Claude. (The switch is off; nothing new sends.)"); done(6)

say(); say("PART 3 · PROOF (nothing is sent or saved)")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
A = {"apikey": ANON, "Authorization": "Bearer " + ANON}
a1 = http("POST", f"{FNB}/functions/v1/prn-week", {"action": "week"}, A)[0]
(ok if a1 in (401, 403) else bad)(f"prn-week refuses anyone not signed in to the office ({a1})")
a2 = http("POST", f"{FNB}/functions/v1/carematch-watch?auth_check=1", {}, A)[0]
(ok if a2 == 401 else bad)(f"the first-shift watch refuses the public key ({a2})")
a3 = http("POST", f"{FNB}/functions/v1/coverage-reply", {"message": "YES"}, A)[0]
(ok if a3 == 401 else bad)(f"the reply reader refuses anyone without its token ({a3})")
okC, cc = sql(REF, "select pg_get_constraintdef(oid) d from pg_constraint where conname = 'prn_touches_kind_check'")
(ok if okC and cc and "goback_unclear" in cc[0]["d"] else bad)("the go-back kinds are allowed on the PRN records")
sD, bD = http("POST", f"{FNB}/functions/v1/carematch-watch?dry=1", {}, {"apikey": SVC, "Authorization": "Bearer " + SVC}, 200)
try: j = json.loads(bD)
except Exception: j = {}
ws = j.get("would_send") or j.get("wouldSend") or j.get("preview") or []
if sD == 200 and isinstance(ws, list):
    prn = [w for w in ws if isinstance(w, dict) and w.get("prn_member")]
    ok(f"a practice run of the first-shift watch: {len(ws)} first-shift text(s) it would send, {len(prn)} to a PRN member (nothing was sent)")
    for w in prn[:5]: say(f"      {w.get('caregiver')} · {w.get('client')}: {w.get('prn_goback_preview') or w.get('preview')}")
else: bad(f"the practice run answered {sD}: {str(bD)[:200]}")
(ok if switch_on() is False else bad)("the switch is still off")
say()
say("  1174: " + ("DONE. PRN step 3 is on the server with the go-back switch OFF. Next: Claude merges the Hub pull request, then Familiar "
    "clients and the two new This week lines show on Recruit, PRN Teams."
    if not L.fails else "NOT COMPLETE. See the ✗ lines above. Tell Claude."))
done(0 if not L.fails else 1)
