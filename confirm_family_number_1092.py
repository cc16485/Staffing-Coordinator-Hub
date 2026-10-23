#!/usr/bin/env python3
# 1092 · CONFIRM A FAMILY NUMBER (2026-10-23, Samantha: "make the welcome say plainly when the text was held, and add a Confirm
# number button in the Hub (who and when recorded). Switch-free."). A number from AxisCare is never texted until a person
# confirms it. Adds three columns on circle_contacts (when, who, which number) and deploys family-app-office (Confirm number;
# the welcome says when the text is held; Send the text now). Run it AFTER merging the Staffing and Hub pull requests.
# Sends nothing. Safe to run again.
import json, os, subprocess, shutil, time
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, MG, sql, deploy, start, check_build, fmeta

HUB = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT; API = L.API
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB}.supabase.co")
HUB_SITE = os.environ.get("SB_HUB_SITE", "https://cc.mo-care.com")
FNS = ["family-app-office"]
SQLF = "confirm_family_number.sql"
ok = lambda s: say("  ✓ " + s)
def chk(good, msg, badmsg=None): (ok(msg) if good else bad(badmsg or msg))
def run(args, cwd=None, env=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True, env=env); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)
def keys(ref):
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_secret_")) and "·" not in v and "*" not in v
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{ref}/api-keys{q}", headers=MG())
        if s != 200: continue
        try: arr = json.loads(b)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        got = {k.get("name"): k.get("api_key", "") for k in arr if isinstance(k, dict) and usable(k.get("api_key", ""))}
        if got.get("service_role"): return got
    return {}

start("CONFIRM A FAMILY NUMBER")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = []
for k in sorted(set().union(*[L.need(FNROOT, fn) for fn in FNS]) | {SQLF}):
    c2, b2 = run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"])
    if c2 != 0 or b2 != open(os.path.join(ROOT, k)).read(): drift.append(k)
if drift: stop("this isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(drift)[:240] + ")")
ok("the reviewed build is what is on GitHub's main")
if NODE:
    for t in ("family_app_1a_test.mjs", "family_welcome_alert_test.mjs", "family_app_fee_test.mjs", "family_app_flex_test.mjs", "family_sync_test.mjs"):
        c, o = run([NODE, t], cwd=ROOT)
        last = (o.strip().splitlines() or ["(no output)"])[-1]
        if c != 0: stop(f"{t} failed: {last}")
        ok(f"{t}: {last.strip()} (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
ps, pb = http("GET", f"{HUB_SITE}/family-app-panel.js?v={int(time.time())}")
if ps != 200 or "confirmPhone" not in (pb or ""): stop("the Hub's Confirm number button isn't live yet (merge the Hub pull request, wait a minute, run again)", 2)
ok("the Hub's Confirm number button is live")
gate = {}
for fn in FNS:
    s, m = fmeta(HUB, fn)
    if s != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {fn} is set up live ({s})", 3)
    gate[fn] = bool(m["verify_jwt"]); say(f"  · {fn} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if gate[fn] else 'off'} (kept)")
K = keys(HUB); SERVICE = K.get("service_role", ""); L.HIDE += [SERVICE]

say(); say("PART 2 · CHANGE")
say(); say("1 · THE DATABASE")
good, r2 = sql(HUB, open(os.path.join(ROOT, SQLF)).read())
if not good: stop(f"the database change was refused (nothing in it was kept): {str(r2)[:200]}", 4)
good, c = sql(HUB, """select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'circle_contacts'
    and column_name in ('phone_confirmed_at', 'phone_confirmed_by', 'phone_confirmed_number')""")
c = (c or [{}])[0] if good else {}
chk(c.get("n") == 3, "the Confirm number record (when, who, which number) is in place", f"the database change didn't land as expected: {c}")
if L.fails: say("  STOP. The doors are unchanged. Tell Claude."); done(4)
say(); say("2 · THE DOORS")
for fn in FNS:
    if not deploy(HUB, FNROOT, fn, gate[fn]): say("  STOP. Tell Claude. (Anything above this line is in; the rest is unchanged.)"); done(5)

say(); say("PART 3 · PROOF")
s, b = http("POST", f"{FNB}/functions/v1/family-app-office", {"action": "list"})
chk(s in (401, 403), f"family-app-office: a caller with no Hub sign-in gets nothing ({s})", f"family-app-office answered a stranger ({s})")
say()
say("  1092: " + ("DONE. Refresh the Hub. On Family & Contacts press Send welcome for Annette: press Confirm 870-350-6164 is Annette's number twice, then Send the text now." if not L.fails else "NOT COMPLETE. See the ✗ lines above."))
done(0 if not L.fails else 1)
