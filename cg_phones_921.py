#!/usr/bin/env python3
# 921 · CAREGIVER PHONES FROM AXISCARE (2026-10-18, Samantha: "Build the caregiver phone fix: any AxisCare phone, fill blanks
# hourly without overwriting, and a list of anyone with no number anywhere").
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass; a dry look says, by name, whose Hub
#     record will get a number from AxisCare and who has no number anywhere (from the build that is live now: counts only if
#     the live one is older).
#  2. Database: caregiver_phone_fill (the one writer: fills a blank Hub phone from AxisCare, never replaces a number).
#  3. Deploys caregiver-connect (its gateway setting kept). From its next hourly run (:17): AxisCare's mobile, else other,
#     else home phone; blank Hub phones filled; ONE Needs Attention list of caregivers with no number anywhere.
#  4. Proves it: a stranger is refused; a dry look from the new build names who will be filled and who has no number.
# Sends nothing; never writes to AxisCare. Safe to run again.
import json, os, subprocess, shutil
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, MG, sql, deploy, start, check_build, fmeta

HUB = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT; API = L.API
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB}.supabase.co")
HUB_SITE = os.environ.get("SB_HUB_SITE", "https://cc.mo-care.com")
FN = "caregiver-connect"
SQLF = "cg_phone_fill.sql"
ok = lambda s: say("  ✓ " + s)
def chk(good, msg, badmsg=None): (ok(msg) if good else bad(badmsg or msg))
def run(args, cwd=None, env=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True, env=env); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)
def j(b):
    try: return json.loads(b)
    except Exception: return None
def keys(ref):
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_secret_")) and "·" not in v and "*" not in v
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{ref}/api-keys{q}", headers=MG())
        if s != 200: continue
        arr = j(b) or []
        if isinstance(arr, dict): arr = arr.get("keys") or []
        got = {k.get("name"): k.get("api_key", "") for k in arr if isinstance(k, dict) and usable(k.get("api_key", ""))}
        if got.get("service_role"): return got
    return {}
def look(service):
    s, b = http("POST", f"{FNB}/functions/v1/{FN}?dry=1", {}, {"Authorization": "Bearer " + service, "apikey": service})
    d = j(b) or {}
    return s, d

start("CAREGIVER PHONES FROM AXISCARE")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = []
for k in sorted(L.need(FNROOT, FN) | {SQLF}):
    c2, b2 = run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"])
    if c2 != 0 or b2 != open(os.path.join(ROOT, k)).read(): drift.append(k)
if drift: stop("this isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(drift)[:240] + ")")
ok("the reviewed build is what is on GitHub's main")
if NODE:
    # the tests run with the Hub's live rules files (the ones the job runs), as 438 did
    import tempfile, time
    tmpd = tempfile.mkdtemp(prefix="cg921r-"); env = dict(os.environ)
    for f, var in (("caregiver-connect-rules.js", "CG_RULES"), ("eligibility-rules.js", "CG_ELIG")):
        s1, b1 = http("GET", f"{HUB_SITE}/{f}?v={int(time.time())}")
        if s1 != 200 or not b1: stop(f"couldn't read the Hub's {f} ({s1})")
        open(os.path.join(tmpd, f), "w").write(b1); env[var] = os.path.join(tmpd, f)
    c, o = run([NODE, "cg_connect_test.mjs"], cwd=ROOT, env=env)
    last = (o.strip().splitlines() or ["(no output)"])[-1]
    if c != 0: stop(f"cg_connect_test.mjs failed: {last}")
    ok(f"cg_connect_test.mjs: {last.strip()} (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
s, m = fmeta(HUB, FN)
if s != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {FN} is set up live ({s})", 3)
gate = bool(m["verify_jwt"]); say(f"  · {FN} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if gate else 'off'} (kept)")
K = keys(HUB); SERVICE = K.get("service_role", ""); L.HIDE += [SERVICE]
good, st = sql(HUB, "select data->>'cg_connect_live' as live from public.app_data where key = 'ops_settings'")
live = good and (st or [{}])[0].get("live") == "true"
say(f"  · caregiver connect is {'ON: the hourly run fills phones and keeps the list' if live else 'OFF (practice): the hourly run only counts; turn it on in Hub Settings, Caregiver connect'}")

say(); say("PART 2 · CHANGE")
say(); say("1 · THE DATABASE")
good, r2 = sql(HUB, open(os.path.join(ROOT, SQLF)).read())
if not good: stop(f"the database change was refused (nothing in it was kept): {str(r2)[:200]}", 4)
good, c = sql(HUB, """select (select count(*)::int from pg_proc where proname = 'caregiver_phone_fill' and pronamespace = 'public'::regnamespace and prosecdef) as fn,
  has_function_privilege('authenticated', 'public.caregiver_phone_fill(jsonb)', 'execute') as staff,
  (select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'caregiver_connect_runs' and column_name = 'phones_filled') as col""")
c = (c or [{}])[0] if good else {}
chk(c.get("fn") == 1 and c.get("staff") is False and c.get("col") == 1, "the phone writer is in place (server only; never replaces a number)", f"the database change didn't land as expected: {c}")
if L.fails: say("  STOP. The door is unchanged. Tell Claude."); done(4)
say(); say("2 · THE DOOR")
if not deploy(HUB, FNROOT, FN, gate): say("  STOP. Tell Claude. (The database part is in; caregiver-connect is unchanged.)"); done(5)

say(); say("PART 3 · PROOF")
s, b = http("POST", f"{FNB}/functions/v1/{FN}", {})
chk(s in (401, 403), f"{FN}: a caller with no key gets nothing ({s})", f"{FN} answered a stranger ({s})")
if SERVICE:
    s, d = look(SERVICE)
    good = s == 200 and d.get("ok") is True and isinstance(d.get("no_phone_names"), list)
    chk(good, "a dry look from the new build (nothing recorded):", f"{FN} dry look: {s} {str(d)[:200]}")
    if good:
        say(f"  WILL GET A NUMBER FROM AXISCARE ({len(d['phones_to_fill_names'])}):")
        for n in d["phones_to_fill_names"]: say(f"     · {n}")
        say(f"  NO NUMBER ANYWHERE ({len(d['no_phone_names'])}): add their mobile in AxisCare")
        for n in d["no_phone_names"]: say(f"     · {n}")
else: say("  · couldn't read the Hub's server key, so the dry look was skipped (the door above is proven)")
say()
say("  921: " + (("DONE. From the next hourly run (:17), blank Hub phones get AxisCare's number and Needs Attention has one list of anyone with no number." if live
                  else "DONE. Caregiver connect is OFF, so nothing is filled until you turn it on in Hub Settings.") if not L.fails else "NOT COMPLETE. See the ✗ lines above."))
done(0 if not L.fails else 1)
