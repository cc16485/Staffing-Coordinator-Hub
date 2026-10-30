#!/usr/bin/env python3
# 1200 · STAFFING SERVER · FAMILY CIRCLE SYNC: SLOW DOWN WHEN AXISCARE ASKS (2026-10-29, Samantha: "Yes, find out why the nightly
# Family Circle sync failed on Oct 29 at 4:00 AM and fix it.")
# Found: the 4 AM sync left "18 errors" (27 current clients) and kept no reason. It shares that minute with a dozen other
# AxisCare readers; AxisCare answers "slow down" (429) when asked too fast. circles-sync now leaves a short gap between
# clients, asks again when AxisCare is busy (429 or 5xx, up to 3 more times), and its heartbeat says why a run failed.
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the sync test passes; the gateway setting is read.
#  2. Deploys circles-sync only.
#  3. Proof: it refuses outsiders, then ONE real sync runs now (the same as the nightly one: Family Circle tables only, never
#     texting consent, texts nobody), and the Hub's "sync failed" line clears when it is healthy.
# Safe to run again.
import json, os, subprocess, shutil, time
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, deploy, start, check_build, fmeta, MG, API, sql

REF = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
if NODE == "none": NODE = ""
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FN = "circles-sync"
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
def beat():
    okB, r = sql(REF, "select x->>'at' as at, x->>'ok' as ok, x->>'note' as note from public.app_data, jsonb_array_elements(data) x "
                      "where key='automation_heartbeats' and x->>'id'='hb_circles-sync'")
    return r[0] if okB and r else None

start("STAFFING SERVER · FAMILY CIRCLE SYNC (slow down when AxisCare asks)")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = [k for k in sorted(set(L.need(FNROOT, FN)))
         if (lambda r: r[0] != 0 or r[1] != open(os.path.join(ROOT, k)).read())(run(["git", "-C", ROOT, "show", f"origin/main:{k}"]))]
if drift: stop("this isn't the same as GitHub's main yet (newer work landed since: " + ", ".join(drift)[:240] + ")")
ok("the reviewed build is what is on GitHub's main")
if NODE:
    c, o = run([NODE, "circles_sync_664_test.mjs"], cwd=ROOT)
    if c != 0 or "21/21" not in o: stop("the sync test failed: " + " ".join(l.strip() for l in o.splitlines() if "FAIL" in l)[:240])
    ok("the Family Circle sync test passes (fake data only), including AxisCare saying 'slow down'")
else: say("  · node is not on this Mac, so the test was not re-run here (21/21 when built)")
b0 = beat()
say(f"  · last sync before this step: {(b0 or {}).get('at', '?')[:16]} UTC, {'healthy' if (b0 or {}).get('ok') == 'true' else (b0 or {}).get('note', 'unknown')}")
s_, m_ = fmeta(REF, FN)
if s_ != 200 or not m_ or "verify_jwt" not in m_: stop(f"couldn't read how {FN} is set up live ({s_})", 3)
VJ = bool(m_["verify_jwt"])
ok(f"the gateway setting is read, so it is kept: {'on' if VJ else 'off'}")
K = keys(); ANON = K.get("anon", ""); SR = K.get("service_role", ""); L.HIDE += [ANON, SR]
if not ANON or not SR: stop("couldn't read the Hub's keys", 3)

say(); say("PART 2 · CHANGE")
if not deploy(REF, FNROOT, FN, VJ): say("  STOP. Tell Claude. (The nightly sync works as before.)"); done(6)

say(); say("PART 3 · PROOF")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
s1 = http("POST", f"{FNB}/functions/v1/{FN}?commit=1", {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
(ok if s1 in (401, 403) else bad)(f"circles-sync refuses anyone not signed in to the office ({s1})")
say("  · running one real sync now (about 30 seconds; Family Circle records only, texts nobody)")
s2, b2 = http("POST", f"{FNB}/functions/v1/{FN}?commit=1", {}, {"apikey": ANON, "Authorization": "Bearer " + SR})
try: j = json.loads(b2)
except Exception: j = {}
errs = j.get("errors") if isinstance(j.get("errors"), list) else []
(ok if s2 == 200 and j.get("mode") == "COMMIT" else bad)(f"the sync ran ({s2}): {j.get('clients', '?')} clients, {j.get('contacts_added', 0)} people added, "
    f"{j.get('contacts_updated', 0)} updated, {j.get('contacts_marked_removed', 0)} marked no longer in AxisCare")
b1 = beat()
(ok if b1 and b1.get("ok") == "true" and not errs else bad)("the Hub's sync line is healthy" if b1 and b1.get("ok") == "true" else
    "the sync still had errors: " + str((b1 or {}).get("note", "no heartbeat"))[:200])
say()
say("  1200: " + ("DONE. The Family Circle sync slows down when AxisCare asks, and tonight's 4 AM run uses it. The red line on Family & Contacts is gone."
    if not L.fails else "NOT COMPLETE. See the ✗ lines above. Tell Claude."))
done(0 if not L.fails else 1)
