#!/usr/bin/env python3
# 1172 · STAFFING SERVER · PRN STEP 2 (2026-10-28, Samantha: "start building PRN step 2 (This week list and on-call calendar)
# with the switches off"; thank-you wording approved the same day)
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (fake data and a throwaway
#     Postgres only); both new switches are off.
#  2. Adds the two records (prn_week.sql: what the office did for a PRN member, and on-call offers and dates) in one
#     transaction, and deploys the new prn-week function (sign-in check on).
#  3. Proof (nothing is sent or saved): the function refuses anyone not signed in to the office; office staff can read the
#     records and nobody else can write them; the switches are still off.
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
FN = "prn-week"; SWITCHES = ("prn_week_live", "prn_thanks_live")
ok = lambda s: say("  ✓ " + s)
def run(args, cwd=None, env=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True, env=env); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)
def anon_key():
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys{q}", headers=MG())
        if s != 200: continue
        try: arr = json.loads(b)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        for k in arr:
            v = k.get("api_key", "") if isinstance(k, dict) else ""
            if k.get("name") == "anon" and isinstance(v, str) and v.startswith("eyJ"): return v
    return ""

start("STAFFING SERVER · PRN STEP 2: THIS WEEK AND ON CALL (switches OFF)")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = []
for k in sorted(L.need(FNROOT, FN)) + ["prn_week.sql"]:
    c2, b2 = run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"])
    if c2 != 0 or b2 != open(os.path.join(ROOT, k)).read(): drift.append(k)
if drift: stop("this isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(drift)[:240] + ")")
ok("the reviewed build is what is on GitHub's main")
if NODE and os.path.exists(PGLITE):
    c, o = run([NODE, "prn_week_test.mjs"], cwd=ROOT, env=dict(os.environ, PGLITE=PGLITE))
    if c != 0 or "52/52" not in o: stop("the tests failed: " + " ".join(l.strip() for l in o.splitlines() if "FAIL" in l)[:240])
    ok("the This week and on-call tests pass, the records in a throwaway Postgres too (fake data only)")
else: say("  · node or the throwaway Postgres is not on this Mac, so the tests were not re-run here (they passed when built)")
okS, st = sql(REF, "select " + ", ".join(f"data->'{k}' as \"{k}\"" for k in SWITCHES) + " from public.app_data where key='ops_settings'")
if not okS or not st: stop("couldn't read the Hub's switches", 3)
on = [k for k in SWITCHES if st[0].get(k) is True]
if on: stop("these switches are already on: " + ", ".join(on) + ". Turn them off in the Hub first.")
ok("both new switches are off: " + ", ".join(SWITCHES))
s_, m_ = fmeta(REF, FN)
ok(f"{FN} is " + ("already there (an earlier run)" if s_ == 200 else "new"))
ANON = anon_key(); L.HIDE += [ANON]
if not ANON: stop("couldn't read the Hub's public key", 3)

say(); say("PART 2 · CHANGE")
okQ, r = sql(REF, "begin;\n" + open(os.path.join(ROOT, "prn_week.sql")).read() + "\ncommit;")
if not okQ: bad("the records didn't go in, and were undone as a whole: " + str(r)[:240]); say("  STOP. Tell Claude."); done(6)
ok("the two records are in place: what the office did for a PRN member, and on-call offers and dates")
if not deploy(REF, FNROOT, FN, True): say(f"  STOP at {FN}. Tell Claude. (The switches are off; nothing sends.)"); done(6)

say(); say("PART 3 · PROOF (nothing is sent or saved)")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
a1, _ = http("POST", f"{FNB}/functions/v1/{FN}", {"action": "week"}, {"apikey": ANON, "Authorization": "Bearer " + ANON})
(ok if a1 in (401, 403) else bad)(f"prn-week refuses anyone not signed in to the office ({a1})")
okG, g = sql(REF, "select has_table_privilege('authenticated','public.prn_touches','select') a, has_table_privilege('authenticated','public.prn_touches','insert') b, "
                  "has_table_privilege('authenticated','public.prn_oncall','select') c, has_table_privilege('authenticated','public.prn_oncall','update') d, "
                  "has_table_privilege('anon','public.prn_oncall','select') e, (select count(*) from pg_trigger where tgname in ('prn_touches_frozen','prn_oncall_guard'))::int t")
gg = g[0] if okG and g else {}
(ok if gg.get("a") and gg.get("c") and not gg.get("b") and not gg.get("d") and not gg.get("e") and gg.get("t") == 2 else bad)(
    "office staff can read both records; only the server writes them; the public gets nothing; the history can't be edited " + ("" if gg else str(g)[:160]))
okS2, st2 = sql(REF, "select " + ", ".join(f"data->'{k}' as \"{k}\"" for k in SWITCHES) + " from public.app_data where key='ops_settings'")
(ok if okS2 and st2 and not any(st2[0].get(k) is True for k in SWITCHES) else bad)("the switches are still off")
say()
say("  1172: " + ("DONE. PRN step 2 is on the server with both switches OFF. Next: Claude merges the Hub pull request, then the This week "
    "list and on-call calendar show on Recruit, PRN Teams (owners only, marked Practice, until you turn them on)."
    if not L.fails else "NOT COMPLETE. See the ✗ lines above. Tell Claude."))
done(0 if not L.fails else 1)
