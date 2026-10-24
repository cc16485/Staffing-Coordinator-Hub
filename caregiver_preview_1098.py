#!/usr/bin/env python3
# 1098 · CAREGIVER PREVIEW, SERVER HALF (Samantha, 2026-10-24): the friendly client profile caregivers see on a shift offer,
# kept on its own tab of every client profile, with Draft / Approved, a second person for care details, and the care summary
# held back when the care plan changes.
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (fake data only); the Caregiver
#     Preview switch (caregiver_preview_live) is off. The Cara switches may be on; they are left exactly as they are.
#  2. Database: the new client_caregiver_profile record (no browser access), with what is already on Family Circles copied
#     across (nothing lost; the Family Circle fields are not changed).
#  3. Deploys the NEW caregiver-preview function (office sign-in), and re-deploys the readers: shift-offer and coverage-run
#     (the shift page details and the board note), coverage-assign and callin-alert (they share the same file), family-offer
#     and family-gateway (the Booking App's About), pilot-readiness. With the switch off they behave exactly as before.
#  4. Proves it: no sign-in = nothing; the switch is still off.
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
FNS = ["coverage-run", "coverage-assign", "callin-alert", "shift-offer", "family-offer", "family-gateway", "pilot-readiness"]
OPTIONAL = {"pilot-readiness"}   # a report function that may never have been installed live (1098 first run, 2026-10-24)
NEW = {"caregiver-preview": True}   # new function: office staff only (gateway sign-in check on, and requireStaff)
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
    return {k: d.get(k) for k in SWITCHES + CARA}

start("CAREGIVER PREVIEW (server half)")
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
    hubdir = tempfile.mkdtemp(prefix="cc1098hub-")
    run(["git", "-C", HUB_REPO, "fetch", "-q", "origin", "main"])
    for rf in ("match-rules.js", "eligibility-rules.js"):
        c0, mr = run(["git", "-C", HUB_REPO, "show", f"origin/main:{rf}"])
        if c0 != 0: stop(f"couldn't read the Hub's {rf} from GitHub's main (needed by the tests)")
        open(os.path.join(hubdir, rf), "w").write(mr)
    env = dict(os.environ, HUB=hubdir, HUB_ROOT=hubdir)
    for t, must in (("caregiver_preview_test.mjs", "46/46"), ("cara_p1_test.mjs", "89/89"), ("shift_page_test.mjs", "52/52"), ("family_app_flex_test.mjs", "162/162"), ("pilot_readiness_test.mjs", "12/12"),
                    ("prn3_coverage_test.mjs", "27/27"), ("driver_coverage_test.mjs", "26/26"), ("ci1_test.mjs", "25/25"), ("callin_test.mjs", "31/31")):
        c, o = run([NODE, t], cwd=ROOT, env=env)
        if c != 0 or (must and must not in o) or "\nFAIL" in o: stop(f"the tests failed ({t}): " + " ".join(l.strip() for l in o.splitlines() if "FAIL" in l)[:240])
    ok("the Caregiver Preview, shift page, Booking App and coverage tests pass (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
sw = switches()
if sw is None: stop("couldn't read the settings", 3)
if sw.get("caregiver_preview_live") not in (None, False, "false"): stop("the Caregiver Preview switch is already on; this step expects it off")
ok("the Caregiver Preview switch is off")
cara_on = [k for k in CARA if sw.get(k) not in (None, False, "false")]
say("  · Cara switches on now (left exactly as they are): " + (", ".join(cara_on) if cara_on else "none"))
gates = {}
for fn in list(FNS):
    s_, m = fmeta(HUB, fn)
    if s_ == 404 and fn in OPTIONAL:   # never installed live (pilot-readiness): left alone, nothing to update
        FNS.remove(fn); say(f"  · {fn} is not installed live, so it is left alone"); continue
    if s_ != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {fn} is set up live ({s_})", 3)
    gates[fn] = bool(m["verify_jwt"]); say(f"  · {fn} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if gates[fn] else 'off'} (kept)")
say(); say("PART 2 · CHANGE")
okd, out = sql(HUB, open(os.path.join(ROOT, "caregiver_preview_1098.sql")).read())
if not okd: stop("the database step failed (nothing else was changed): " + str(out)[:200], 4)
okv, chk2 = sql(HUB, "select (select count(*) from public.client_caregiver_profile) as rows, (select count(*) from care_circles c where c.active is not false and coalesce(c.axiscare_client_id, '') ~ '^[0-9]+$' and (nullif(trim(c.caregiver_about), '') is not null or coalesce(cardinality(c.caregiver_enjoys), 0) > 0 or c.caregiver_share_care is true)) as had, (select count(*) from information_schema.role_table_grants where table_name = 'client_caregiver_profile' and grantee in ('anon', 'authenticated')) as open_grants")
r0 = (chk2 or [{}])[0] if okv else {}
chk(okv and int(r0.get("rows") or 0) >= int(r0.get("had") or 0) and int(r0.get("open_grants") or 0) == 0,
    f"database: the Caregiver Preview record is there, no browser access; {int(r0.get('had') or 0)} Family Circle entr{'y' if int(r0.get('had') or 0) == 1 else 'ies'} carried across",
    "database check failed: " + json.dumps(r0)[:200])
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
s_, b_ = http("POST", f"{FNB}/functions/v1/caregiver-preview", {"action": "get", "axiscare_client_id": "1"}, {"Content-Type": "application/json"})
chk(s_ == 401, f"caregiver-preview: needs a Hub sign-in ({s_})", f"caregiver-preview answered without a sign-in ({s_})")
s_, b_ = http("POST", f"{FNB}/functions/v1/shift-offer", {"c": "cv_test", "a": "ask_test", "e": 9999999999, "t": "A" * 43, "action": "view"}, {"Content-Type": "application/json"})
chk(s_ == 403, f"shift-offer: a made-up link is still refused ({s_})", f"shift-offer answered a made-up link ({s_}): {str(b_)[:120]}")
sw2 = switches()
chk(sw2 is not None and sw2.get("caregiver_preview_live") in (None, False, "false") and [k for k in CARA if sw2.get(k) not in (None, False, "false")] == cara_on,
    "the Caregiver Preview switch is still off, and the Cara switches are as they were", "a switch changed during the step: tell Claude")
say()
say("  1098: " + ("DONE. The Caregiver Preview is installed with its switch off (practice). Next: merge the Hub and Owners Hub pull requests, then your preview." if not L.fails else "NOT COMPLETE. See the ✗ lines above."))
done(0 if not L.fails else 1)
