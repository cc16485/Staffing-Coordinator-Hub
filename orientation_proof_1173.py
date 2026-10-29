#!/usr/bin/env python3
# 1173 · STAFFING SERVER + TRAINING PLATFORM · ORIENTATION PROOF (2026-10-28, Samantha: "Yes, build it this way with the three
# switches off": no caregiver approved to work without verified orientation, historical records recognized)
#  1. Checks first (nothing changes): both reviewed builds are GitHub's main; the tests pass (fake data and a throwaway
#     Postgres only); the three switches are off; each function's gateway setting is read so it is kept.
#  2. The audit's door onto a caregiver record gains one field (orient_verified: the office's verification of a historical
#     record), in one transaction. Deploys orientation-proof (new) and caregiver-journey (the Orientation step's gate, off),
#     and the Training Platform's send-invite (it also accepts the Hub's server, for "Send orientation link"). Schedules the
#     orientation audit every morning (7:30am CDT), carrying the jobs' secret.
#  3. Proof (nothing is sent, made, saved or carded): the function refuses the public key and lets its schedule in; a practice
#     audit lists who it would flag and which certificates could be made; the switches are still off.
# Nobody is deactivated, texted or emailed. Safe to run again.
import json, os, subprocess, shutil, time
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, deploy, start, check_build, fmeta, MG, API, sql, lit

REF = "zngsgedlsxinbygwmxwn"; TREF = "rdqujxiycycwhskyvrwa"
FNROOT = L.FNROOT; ROOT = L.ROOT
TFNROOT = os.environ.get("SB_TRAINING_FNROOT", ""); TROOT = os.path.dirname(os.path.dirname(TFNROOT)) if TFNROOT else ""
SHAS = json.loads(os.environ.get("SB_SHAS", "{}")); TSHAS = json.loads(os.environ.get("SB_TRAINING_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
if NODE == "none": NODE = ""
PGLITE = os.environ.get("SB_PGLITE", "/Users/samantha/Claude/Projects/.pglite/node_modules/@electric-sql/pglite/dist/index.js")
PDFLIB = os.environ.get("SB_PDFLIB", "/Users/samantha/Claude/Projects/.pdflib/node_modules/pdf-lib/dist/pdf-lib.esm.js")
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FNS = ("orientation-proof", "caregiver-journey")
SWITCHES = ("orientation_audit_live", "orientation_cert_autogen_live", "orientation_gate_live")
JOB = "orientation-audit"; SCHEDULE = os.environ.get("SB_SCHEDULE", "30 12 * * *"); VAULT_NAME = "hub_job_secret"
POLL = float(os.environ.get("SB_POLL", "2")); POLL_MAX = float(os.environ.get("SB_POLL_MAX", "40"))
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
def command(url, anon):
    return ("select net.http_post(url := " + lit(url) + ", headers := jsonb_build_object('Content-Type', 'application/json', "
            "'Authorization', " + lit("Bearer " + anon) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")), "
            "body := '{}'::jsonb, timeout_milliseconds := 150000);")
def jget(b, k):
    try: return json.loads(b).get(k)
    except Exception: return None

start("STAFFING SERVER + TRAINING PLATFORM · ORIENTATION PROOF (all three switches OFF)")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS); check_build(TFNROOT, TSHAS)
for root, files in ((ROOT, sorted({k for fn in FNS for k in L.need(FNROOT, fn)} | {"supabase/orientation-proof.sql"})), (TROOT, sorted(L.need(TFNROOT, "send-invite")))):
    run(["git", "-C", root, "fetch", "-q", "origin", "main"])
    drift = [k for k in files if (lambda r: r[0] != 0 or r[1] != open(os.path.join(root, k)).read())(run(["git", "-C", root, "show", f"origin/main:{k}"]))]
    if drift: stop("this isn't the same as GitHub's main yet (merge the pull requests first, or newer work landed since: " + ", ".join(drift)[:240] + ")")
ok("both reviewed builds are what is on GitHub's main (the Hub's server and the Training Platform)")
if NODE and os.path.exists(PGLITE) and os.path.exists(PDFLIB):
    env = dict(os.environ, PGLITE=PGLITE, PDFLIB=PDFLIB)
    for t, must, root in (("orientation_proof_test.mjs", "57/57", ROOT), ("caregiver_journey_6_test.mjs", "127/127", ROOT), ("training_texts_test.mjs", "68/68", TROOT)):
        c, o = run([NODE, t], cwd=root, env=env)
        if c != 0 or must not in o: stop(f"the tests failed ({t}): " + " ".join(l.strip() for l in o.splitlines() if "FAIL" in l or "✗" in l)[:240])
    ok("the orientation proof, onboarding checklist and Training message tests pass (fake data and a throwaway Postgres only)")
else: say("  · node, the throwaway Postgres or the PDF library is not on this Mac, so the tests were not re-run here (they passed when built)")
okS, st = sql(REF, "select " + ", ".join(f"data->'{k}' as \"{k}\"" for k in SWITCHES) + " from public.app_data where key='ops_settings'")
if not okS or not st: stop("couldn't read the Hub's switches", 3)
on = [k for k in SWITCHES if st[0].get(k) is True]
if on: stop("these switches are already on: " + ", ".join(on) + ". Turn them off in the Hub first.")
ok("the three switches are off: " + ", ".join(SWITCHES))
meta = {}
for ref, fn in ((REF, "orientation-proof"), (REF, "caregiver-journey"), (TREF, "send-invite")):
    s_, m_ = fmeta(ref, fn)
    if s_ == 404 and fn == "orientation-proof": meta[fn] = True; continue
    if s_ != 200 or not m_ or "verify_jwt" not in m_: stop(f"couldn't read how {fn} is set up live ({s_})", 3)
    meta[fn] = bool(m_["verify_jwt"])
ok("each function's gateway setting is read, so it is kept: " + ", ".join(f"{k} {'on' if v else 'off'}" for k, v in meta.items()))
okV, vr = sql(REF, f"select (select count(*) from vault.decrypted_secrets where name = {lit(VAULT_NAME)})::int as vault, (select count(*) from cron.job where jobname = {lit(JOB)})::int as job")
if not okV or not vr or vr[0]["vault"] != 1: stop("the jobs' secret isn't in the vault", 4)
ok("the jobs' secret is there · the morning orientation audit is " + ("already scheduled (an earlier run)" if vr[0]["job"] else "new"))
K = keys(); ANON, SVC = K.get("anon", ""), K.get("service_role", ""); L.HIDE += [ANON, SVC]
if not (ANON and SVC): stop("couldn't read the Hub's keys", 3)

say(); say("PART 2 · CHANGE")
okQ, r = sql(REF, "begin;\n" + open(os.path.join(ROOT, "supabase/orientation-proof.sql")).read() + "\ncommit;")
if not okQ: bad("the record change didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Tell Claude."); done(6)
ok("a caregiver record can now keep the office's verification of a historical orientation record")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, meta[fn]): say(f"  STOP at {fn}. Tell Claude. (The switches are off.)"); done(6)
if not deploy(TREF, TFNROOT, "send-invite", meta["send-invite"]): say("  STOP at the Training Platform's send-invite. Tell Claude."); done(6)
URL = f"{FNB}/functions/v1/orientation-proof?audit=1"
sql(REF, f"select cron.unschedule({lit(JOB)}) where exists (select 1 from cron.job where jobname = {lit(JOB)})")
okC, _ = sql(REF, f"select cron.schedule({lit(JOB)}, {lit(SCHEDULE)}, {lit(command(URL, ANON))}) as id")
okJ, jb = sql(REF, f"select schedule, command from cron.job where jobname = {lit(JOB)}")
g = okC and okJ and jb and jb[0]["schedule"] == SCHEDULE and "x-cron-secret" in jb[0]["command"]
(ok if g else bad)("the orientation audit runs every morning at 7:30am CDT (6:30am in winter) · practice only until you turn it on")

say(); say("PART 3 · PROOF (nothing is sent, made, saved or carded)")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
a1 = http("POST", URL + "&auth_check=1", {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
(ok if a1 == 401 else bad)(f"the audit refuses the public key ({a1})")
okR, rq = sql(REF, command(URL + "&auth_check=1", ANON).rstrip(";") + " as id")
got = None; waited = 0.0
while okR and rq and waited <= POLL_MAX:
    ok3, rr = sql(REF, f"select status_code, content from net._http_response where id = {int(rq[0]['id'])}")
    if ok3 and rr: got = rr[0]; break
    time.sleep(POLL); waited += POLL
(ok if got and got["status_code"] == 200 and jget(got["content"], "caller") == "cron" else bad)("its morning schedule gets in" + ("" if got else " (no answer)"))
sD, bD = http("POST", URL + "&dry=1", {}, {"apikey": SVC, "Authorization": "Bearer " + SVC}, 280)
try: j = json.loads(bD)
except Exception: j = {}
if sD == 200 and j.get("ok") and j.get("cards_live") is False and not j.get("carded") and not j.get("made"):
    ok(f"a practice audit read AxisCare and the Training Platform: {j.get('checked')} Active, {j.get('verified')} verified, {j.get('excluded')} left out, {j.get('flagged')} need proof ({j.get('could_make')} could get a certificate made)")
    for x in j.get("list") or []: say(f"      {x.get('name')}: {x.get('why')}" + (f" (date on record {x.get('date')})" if x.get("date") else ""))
else: bad(f"the practice audit answered {sD}: {str(bD)[:200]}")
okS2, st2 = sql(REF, "select " + ", ".join(f"data->'{k}' as \"{k}\"" for k in SWITCHES) + " from public.app_data where key='ops_settings'")
(ok if okS2 and st2 and not any(st2[0].get(k) is True for k in SWITCHES) else bad)("the three switches are still off")
say()
say("  1173: " + ("DONE. Orientation proof is on the server with all three switches OFF. The list above is who would be flagged. Next: Claude "
    "merges the Hub pull request, then the Orientation & Training section and the Needs orientation proof list show in the Hub."
    if not L.fails else "NOT COMPLETE. See the ✗ lines above. Tell Claude."))
done(0 if not L.fails else 1)
