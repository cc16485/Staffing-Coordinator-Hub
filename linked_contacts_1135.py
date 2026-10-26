#!/usr/bin/env python3
# 1135 · STAFFING SERVER · AXISCARE LINKED CONTACTS GET THE AXISCARE WELCOME (2026-10-26, Samantha: "when a family has more than
# 3 contacts axiscare allows us to link contacts, in the case of Dan Probstfield he has 4 family members that need the access emails").
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (fake data only).
#  2. Deploys family-app-office (the Send AxisCare welcome button) and family-offer (the automatic AxisCare send), each keeping
#     its gateway setting. No database change.
#  3. Proof: the doors still refuse strangers, the switch family_axis_welcome_auto is as it was, a dry run of the family job
#     answers (nothing sent), and the family members typed in the office are listed with what they still need.
# Sends nothing. Every switch left as it is. Safe to run again.
import json, os, subprocess, shutil
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, sql, deploy, start, check_build, fmeta, MG, API

HUB = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
FNS = ["family-app-office", "family-offer"]
TESTS = ("family_welcome_alert_test.mjs", "family_app_1a_test.mjs", "family_app_flex_test.mjs", "family_sync_test.mjs", "family_signin_test.mjs")
ok = lambda s: say("  ✓ " + s)
def run(args, cwd=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)
def switch():
    okq, st = sql(HUB, "select data->>'family_axis_welcome_auto' as v from app_data where key = 'ops_settings'")
    return "?" if not okq else (st[0]["v"] if st else None)
def service_key():
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{HUB}/api-keys{q}", headers=MG())
        if s != 200: continue
        try: arr = json.loads(b)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        for k in arr:
            v = k.get("api_key", "") if isinstance(k, dict) else ""
            if k.get("name") == "service_role" and isinstance(v, str) and v.startswith("eyJ") and "·" not in v and "*" not in v: return v
    return ""

start("AXISCARE LINKED CONTACTS GET THE AXISCARE WELCOME")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
files = sorted(set().union(*[L.need(FNROOT, fn) for fn in FNS]))
drift = [k for k in files if run(["git", "-C", ROOT, "show", f"origin/main:{k}"])[1] != open(os.path.join(ROOT, k)).read()]
if drift: say("  · newer work on GitHub's main also touches: " + ", ".join(drift)[:240] + " (this step deploys the reviewed build, not those)")
else: ok("the reviewed build is what is on GitHub's main")
if NODE:
    for t in TESTS:
        c, o = run([NODE, t], cwd=ROOT)
        last = (o.strip().splitlines() or ["(no output)"])[-1]
        if c != 0: stop(f"{t} failed: {last}")
        ok(f"{t}: {last.strip()} (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
sw0 = switch()
say(f"  · the switch family_axis_welcome_auto is {'ON' if sw0 == 'true' else 'OFF' if sw0 in ('false', None) else 'unreadable'} (left as it is)")
gate = {}
for fn in FNS:
    s, m = fmeta(HUB, fn)
    if s != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {fn} is set up live ({s})", 3)
    gate[fn] = bool(m["verify_jwt"]); say(f"  · {fn} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if gate[fn] else 'off'} (kept)")

say(); say("PART 2 · CHANGE (the two server pieces)")
for fn in FNS:
    if not deploy(HUB, FNROOT, fn, gate[fn]): say("  STOP. Tell Claude. (Anything above this line is in; the rest is unchanged.)"); done(5)

say(); say("PART 3 · PROOF")
s, b = http("POST", f"https://{HUB}.supabase.co/functions/v1/family-app-office", {"action": "list"})
(ok if s in (401, 403) else bad)(f"family-app-office: a caller with no sign-in gets nothing ({s})")
s, b = http("POST", f"https://{HUB}.supabase.co/functions/v1/family-offer", {})
(ok if s in (401, 403) else bad)(f"family-offer: a caller with no key gets nothing ({s})")
(ok if switch() == sw0 else bad)("the switch family_axis_welcome_auto is unchanged")
SK = service_key()
if SK:
    L.HIDE.append(SK)
    s, b = http("POST", f"https://{HUB}.supabase.co/functions/v1/family-offer?dry=1", {}, {"Authorization": "Bearer " + SK, "apikey": SK})
    try: w = json.loads(b).get("welcome") or {}
    except Exception: w = {}
    if s == 200 and "ready" in w and not w.get("error"):
        ok(f"a dry run of the family job reads AxisCare's linked contacts without trouble (nothing sent): {w.get('ready')} family members are ready for the AxisCare welcome")
        for x in (w.get("would_send") or [])[:40]: say(f"      would get it: {x.get('name')} ({x.get('client')})")
    else: bad(f"the dry run of the family job didn't answer cleanly ({s}): {str(w.get('error') or b)[:200]}")
else: say("  · couldn't get the server key for the dry run (not a problem for the install)")
okw, rows = sql(HUB, "select c.name, k.client_name, c.hipaa_authorized, c.hipaa_office_ok_at is not null as office_ok, c.axis_welcome_sent_at is not null as sent "
    "from circle_contacts c join care_circles k on k.id::text = c.circle_id::text "
    "where c.email is not null and c.email <> '' and c.stopped_at is null and c.axiscare_removed_at is null and k.active is not false and k.axiscare_client_id is not null "
    "and coalesce(c.source, '') <> 'axiscare' and lower(coalesce(c.relationship, '')) <> 'client' and c.welcome_skip_at is null order by k.client_name, c.name")
if okw:
    say(f"  · Family members typed in the office ({len(rows)}). They get the AxisCare welcome once they are a Contact linked to the client in AxisCare, with the same email, AND have HIPAA permission:")
    for r in rows[:60]:
        h = "HIPAA: AxisCare Yes" if r.get("hipaa_authorized") is True else "HIPAA: AxisCare says No" if r.get("hipaa_authorized") is False else "HIPAA OK in the Hub" if r.get("office_ok") else "HIPAA NOT on file yet"
        say(f"      {r.get('name')} ({r.get('client_name')}) · {h}" + (" · already sent" if r.get("sent") else ""))
say()
say("  1135: " + ("DONE. Linked AxisCare contacts now count for the AxisCare welcome. Next: in the Hub, open Dan Probstfield, Family & Contacts, Damian: HIPAA OK if he has permission, then Send AxisCare welcome (it says whether his email is on AxisCare)." if not L.fails else "NOT COMPLETE. See the ✗ lines above. Tell Claude."))
done(0 if not L.fails else 1)
