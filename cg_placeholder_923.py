#!/usr/bin/env python3
# 923 · "CANCELED SHIFT" IS NOBODY (2026-10-18, Samantha: "leave the Canceled Shift placeholder out of the no-number list,
# caregiver offers and the readiness checks"). AxisCare's placeholder caregiver for cancelled visits is never on the
# no-number list, never offered a visit, and never counted as a client's recent caregiver.
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass.
#  2. Deploys caregiver-connect and family-offer (gateway settings kept). No database change.
#  3. Proves it: strangers are refused; a dry look names who has no number (without Canceled Shift).
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
FNS = ["caregiver-connect", "family-offer"]
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

start('"CANCELED SHIFT" IS NOBODY')
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = []
for k in sorted(set().union(*[L.need(FNROOT, f) for f in FNS])):
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
    for t in ("cg_placeholder_test.mjs", "cg_connect_test.mjs", "family_app_flex_test.mjs"):
        c, o = run([NODE, t], cwd=ROOT, env=env)
        last = (o.strip().splitlines() or ["(no output)"])[-1]
        if c != 0: stop(f"{t} failed: {last}")
        ok(f"{t}: {last.strip()} (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
gate = {}
for fn in FNS:
    s, m = fmeta(HUB, fn)
    if s != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {fn} is set up live ({s})", 3)
    gate[fn] = bool(m["verify_jwt"]); say(f"  · {fn} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if gate[fn] else 'off'} (kept)")
K = keys(HUB); SERVICE = K.get("service_role", ""); L.HIDE += [SERVICE]
say(); say("PART 2 · CHANGE")
say(); say("THE DOORS")
for fn in FNS:
    if not deploy(HUB, FNROOT, fn, gate[fn]): say("  STOP. Tell Claude. (Anything above this line is in; the rest is unchanged.)"); done(5)

say(); say("PART 3 · PROOF")
for fn in FNS:
    s, b = http("POST", f"{FNB}/functions/v1/{fn}", {})
    chk(s in (401, 403), f"{fn}: a caller with no key gets nothing ({s})", f"{fn} answered a stranger ({s})")
if SERVICE:
    s, d = look(SERVICE)
    good = s == 200 and d.get("ok") is True and isinstance(d.get("no_phone_names"), list)
    chk(good, "a dry look from the new build (nothing recorded):", f"{FN} dry look: {s} {str(d)[:200]}")
    if good:
        say(f"  WILL GET A NUMBER FROM AXISCARE ({len(d['phones_to_fill_names'])}):")
        for n in d["phones_to_fill_names"]: say(f"     · {n}")
        say(f"  NO NUMBER ANYWHERE ({len(d['no_phone_names'])}): add their mobile in AxisCare")
        for n in d["no_phone_names"]: say(f"     · {n}")
        chk(not any("cancel" in n.lower() and "shift" in n.lower() for n in d["no_phone_names"]), "Canceled Shift is not on the list", "Canceled Shift is still on the list")
else: say("  · couldn't read the Hub's server key, so the dry look was skipped (the door above is proven)")
say()
say("  923: " + ("DONE. Canceled Shift is left out of the no-number list (from the next hourly run), caregiver offers and the readiness check." if not L.fails else "NOT COMPLETE. See the ✗ lines above."))
done(0 if not L.fails else 1)
