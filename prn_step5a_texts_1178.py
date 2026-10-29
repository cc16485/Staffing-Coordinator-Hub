#!/usr/bin/env python3
# 1178 · STAFFING SERVER · PRN STEP 5a: THE TEXTS THAT CARRY THE PRN TEAM PAGE LINK (2026-10-29, Samantha: "Build all three link
# texts as you wrote them, each with its switch off")
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (fake data and a throwaway Postgres
#     only); the page and the three new switches are off; each function's gateway setting is read, so it is kept.
#  2. Lets the PRN records keep "your PRN Team page is ready" (prn_page_texts.sql, one transaction). Deploys prn-welcome (the
#     welcome with the page link, and "your page is ready") and prn-reconfirm (the 60-day check-in opening the page).
#  3. Proof (nothing is sent or saved): both refuse the public key; a practice run lists who would get "your page is ready";
#     the check-in still opens the My Hours page; the switches are still off.
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
FNS = ("prn-welcome", "prn-reconfirm"); SWITCHES = ("prn_page_live", "prn_page_ready_live", "prn_welcome_link_live", "prn_reconfirm_page_live")
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
def switches_on():
    okS, st = sql(REF, "select " + ", ".join(f"data->'{k}' as {k}" for k in SWITCHES) + " from public.app_data where key='ops_settings'")
    return None if not okS or not st else [k for k in SWITCHES if st[0].get(k) is True]

start("STAFFING SERVER · PRN STEP 5a: THE TEXTS THAT CARRY THE PRN TEAM PAGE LINK (switches OFF)")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = [k for k in sorted({k for fn in FNS for k in L.need(FNROOT, fn)} | {"prn_page_texts.sql"})
         if (lambda r: r[0] != 0 or r[1] != open(os.path.join(ROOT, k)).read())(run(["git", "-C", ROOT, "show", f"origin/main:{k}"]))]
if drift: stop("this isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(drift)[:240] + ")")
ok("the reviewed build is what is on GitHub's main")
if NODE and os.path.exists(PGLITE):
    env = dict(os.environ, PGLITE=PGLITE)
    # (the shift-text tests that read the Hub's own folder can't run from this fresh copy; they passed when built)
    for t, must in (("prn_page_texts_test.mjs", "45/45"), ("prn_welcome_test.mjs", "35/35"), ("prn4_server_test.mjs", "22/22"), ("prn_page_test.mjs", "43/43"), ("prn_week_test.mjs", "52/52")):
        c, o = run([NODE, t], cwd=ROOT, env=env)
        if c != 0 or must not in o: stop(f"the tests failed ({t}): " + " ".join(l.strip() for l in o.splitlines() if "FAIL" in l)[:240])
    ok("the link texts, welcome, 60-day check-in, PRN Team page and This week tests pass (fake data and a throwaway Postgres only)")
else: say("  · node or the throwaway Postgres is not on this Mac, so the tests were not re-run here (they passed when built)")
on = switches_on()
if on is None: stop("couldn't read the Hub's switches", 3)
if on: stop("already on: " + ", ".join(on) + ". Turn them off in the Hub first.")
ok("the page and the three new switches are off: " + ", ".join(SWITCHES))
meta = {}
for fn in FNS:
    s_, m_ = fmeta(REF, fn)
    if s_ != 200 or not m_ or "verify_jwt" not in m_: stop(f"couldn't read how {fn} is set up live ({s_})", 3)
    meta[fn] = bool(m_["verify_jwt"])
ok("each function's gateway setting is read, so it is kept: " + ", ".join(f"{k} {'on' if v else 'off'}" for k, v in meta.items()))
K = keys(); ANON, SVC = K.get("anon", ""), K.get("service_role", ""); L.HIDE += [ANON, SVC]
if not (ANON and SVC): stop("couldn't read the Hub's keys", 3)

say(); say("PART 2 · CHANGE")
okQ, r = sql(REF, "begin;\n" + open(os.path.join(ROOT, "prn_page_texts.sql")).read() + "\ncommit;")
if not okQ: bad("the record change didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Tell Claude."); done(6)
ok("the PRN records can keep \"your PRN Team page is ready\"")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, meta[fn]): say(f"  STOP at {fn}. Tell Claude. (The switches are off; nothing new sends.)"); done(6)

say(); say("PART 3 · PROOF (nothing is sent or saved)")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
A = {"apikey": ANON, "Authorization": "Bearer " + ANON}
for fn in FNS:
    a = http("POST", f"{FNB}/functions/v1/{fn}?auth_check=1", {}, A)[0]
    (ok if a == 401 else bad)(f"{fn} refuses the public key ({a})")
sD, bD = http("POST", f"{FNB}/functions/v1/prn-welcome?dry=1", {}, {"apikey": SVC, "Authorization": "Bearer " + SVC}, 120)
try: j = json.loads(bD)
except Exception: j = {}
if sD == 200 and j.get("ok") and j.get("live") is False and j.get("ready_live") is False and not j.get("texted") and not j.get("ready_texted"):
    who = j.get("would_ready") or []
    ok(f"a practice run: {len(who)} PRN member(s) would get \"your PRN Team page is ready\", {j.get('ready_no_phone', 0)} with no phone; "
       f"{len(j.get('would_welcome') or [])} new member(s) would get the welcome (nothing was sent)")
    for w in who[:10]: say(f"      {w}")
else: bad(f"the practice run answered {sD}: {str(bD)[:200]}")
sR, bR = http("POST", f"{FNB}/functions/v1/prn-reconfirm?dry=1", {}, {"apikey": SVC, "Authorization": "Bearer " + SVC}, 120)
try: k = json.loads(bR)
except Exception: k = {}
if sR == 200 and k.get("held"): ok("the 60-day check-in answers (outside its weekday hours right now, so its practice run waits; nothing was sent)")
elif sR == 200 and k.get("ok") and k.get("live") is False and k.get("to_page") is False and not k.get("texted"):
    ok(f"the 60-day check-in practice run: {k.get('would_text', 0)} would be texted, still with the My Hours page (nothing was sent)")
else: bad(f"the check-in practice run answered {sR}: {str(bR)[:200]}")
okC, cc = sql(REF, "select pg_get_constraintdef(oid) d from pg_constraint where conname = 'prn_touches_kind_check'")
(ok if okC and cc and "page_ready_sent" in cc[0]["d"] and "handled" in cc[0]["d"] and "welcome_call" in cc[0]["d"] else bad)("the PRN records allow \"page ready\", and every earlier kind still")
(ok if switches_on() == [] else bad)("the switches are still off")
say()
say("  1178: " + ("DONE. The three link texts are on the server with their switches OFF. Next: Claude merges the Hub pull request, then "
    "you'll see the three switches and their wording in Settings, PRN Teams."
    if not L.fails else "NOT COMPLETE. See the ✗ lines above. Tell Claude."))
done(0 if not L.fails else 1)
