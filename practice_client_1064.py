#!/usr/bin/env python3
# 1064 · THE PRACTICE CLIENT (2026-10-22, Samantha: "Build the Practice client next so test clock-ins never trip the missed
# clock-in checks"). A fake AxisCare client named "Practice" holds the short practice visit for a new hire's test clock-in on the
# check-in call. Nothing about its visits may fire: missed clock-ins, running late, coverage, attendance and EVV records, missed
# notes, shift confirmations, care-note flags, Team Builder, Today board, new-hire hours, match report, client sync, New Clients,
# morning brief, first contact dates, Owners Hub hours and revenue, Client Check-Ins.
#  1. Checks first (nothing changes): both reviewed builds are GitHub's main (Hub server, Training Platform); the tests pass (fake
#     data only); how each service is set up live; the not-client list today.
#  2. Deploys the Training Platform's sync-axiscare and axiscare-open-shifts, then the Hub's 24 services (gateway settings kept;
#     one not on the server is left alone), and copies the not-client numbers to the Training Platform. The client named
#     exactly "Practice" (or "Practice Client") is caught by name everywhere from now on; its number can also be added on the
#     Clients tab ("leave out another AxisCare number"), like Office Staff.
#  3. Proves it: strangers get nothing.
# Sends nothing. Safe to run again.
import json, os, subprocess, shutil, datetime as dt
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, sql, deploy, start, check_build, fmeta, lit

HUB = "zngsgedlsxinbygwmxwn"; TRAIN = "rdqujxiycycwhskyvrwa"
FNROOT = L.FNROOT; ROOT = L.ROOT
TRN_FNROOT = os.environ.get("SB_TRN_FNROOT", ""); TRN_ROOT = os.path.dirname(os.path.dirname(TRN_FNROOT)) if TRN_FNROOT else ""
SHAS = json.loads(os.environ.get("SB_SHAS", "{}")); TRN_SHAS = json.loads(os.environ.get("SB_TRN_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB}.supabase.co")
FNS = ['axiscare-client-webhook', 'campaign-auto', 'campaign-send', 'care-notes', 'carematch-watch', 'circles-sync', 'client-admission-scan', 'client-history-import', 'client-journey', 'client-status-review', 'client-sync', 'coverage-run', 'coverage-shifts', 'coverage-watch', 'eligibility-sweep', 'late-watch', 'lead-digest', 'match-dark', 'missed-notes', 'obligations-run', 'pilot-readiness', 'review-moments', 'shift-confirm', 'timekeeper-watch']
TRN_FNS = ["sync-axiscare", "axiscare-open-shifts"]
ok = lambda s: say("  ✓ " + s)
def chk(good, msg, badmsg=None): (ok(msg) if good else bad(badmsg or msg))
def run(args, cwd=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)
def drift(root, fnroot, fns):
    main = os.environ.get("SB_MAIN_REF", "origin/main")
    if main.startswith("origin/"): run(["git", "-C", root, "fetch", "-q", "origin", "main"])
    out = []
    for k in sorted({k for fn in fns for k in L.need(fnroot, fn)}):
        c2, b2 = run(["git", "-C", root, "show", f"{main}:{k}"])
        if c2 != 0 or b2 != open(os.path.join(root, k)).read(): out.append(k)
    return out
def not_clients():
    okq, cur = sql(HUB, "select data->'not_client_ax' as nc from public.app_data where key = 'ops_settings'")
    if not okq: return None
    nc = cur[0]["nc"] if cur else None
    if isinstance(nc, str):
        try: nc = json.loads(nc)
        except Exception: nc = None
    return nc if isinstance(nc, list) else []

start("THE PRACTICE CLIENT")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
if not TRN_FNROOT or not os.path.isdir(TRN_FNROOT): stop("the Training Platform build is not here")
check_build(TRN_FNROOT, TRN_SHAS)
d = drift(ROOT, FNROOT, FNS) + drift(TRN_ROOT, TRN_FNROOT, TRN_FNS)
if d: stop("this isn't the same as GitHub's main yet (merge both pull requests first, or newer work landed since: " + ", ".join(d)[:260] + ")")
ok("both reviewed builds are what is on GitHub's main (Hub server and Training Platform)")
if NODE:
    for root, t, must in ((ROOT, "practice_client_test.mjs", "21/21 passed"), (ROOT, "not_clients_test.mjs", "25/25 passed"), (ROOT, "c1_missed_clockin_test.mjs", "64/64"),
                          (ROOT, "late_watch_test.mjs", "20/20"), (ROOT, "missed_notes_test.mjs", "52/52"), (ROOT, "callin_plan_harness.mjs", "ALL 20 CHECKS PASS"),
                          (ROOT, "coverage_shifts_range_test.mjs", "10/10 passed"), (ROOT, "team_pool_test.mjs", "5/5 passed"), (ROOT, "client_sync_test.mjs", "14/14 passed"),
                          (TRN_ROOT, "orientation_link_test.mjs", "67/67 passed")):
        c, o = run([NODE, t], cwd=root)
        if c != 0 or must not in o: stop(f"the tests failed ({t}): " + " ".join(l for l in o.splitlines() if "FAIL" in l or "✗" in l)[:240])
    ok("tests pass: a visit for the Practice client (by name or by number) never counts, alerts or texts, and real clients are untouched (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
nc = not_clients()
if nc is None: stop("couldn't read the Hub settings", 3)
say("  · left out today (the not-client list): " + (", ".join(f"{x.get('name', '?')} (#{x.get('ax', '?')})" for x in nc if isinstance(x, dict)) or "the default, Office Staff (#293)"))
metas = {}
for ref, fns in ((TRAIN, TRN_FNS), (HUB, FNS)):
    for fn in fns:
        s, m = fmeta(ref, fn)
        if s == 404: metas[(ref, fn)] = None; say(f"  · {fn} is not on the server, so it is left alone (nothing runs there)"); continue
        if s != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {fn} is set up live ({s})", 3)
        metas[(ref, fn)] = bool(m["verify_jwt"])
say(f"  · {sum(1 for v in metas.values() if v is not None)} services are live; each keeps its gateway sign-in setting")

say(); say("PART 2 · CHANGE")
for ref, fns, root in ((TRAIN, TRN_FNS, TRN_FNROOT), (HUB, FNS, FNROOT)):
    for fn in fns:
        if metas[(ref, fn)] is None: continue
        if not deploy(ref, root, fn, metas[(ref, fn)]): say("  STOP. Tell Claude. (Services before this one are deployed; the not-client list was not touched.)"); done(5)
final = [x for x in (not_clients() or []) if isinstance(x, dict)] or [{"ax": "293", "name": "Office Staff", "by": "default", "at": None}]
okq, r = sql(TRAIN, f"insert into public.app_settings (key, value) values ('not_client_ax', {lit(json.dumps(final))}::jsonb) on conflict (key) do update set value = excluded.value returning 1")
chk(okq and r, "the not-client numbers are copied to the Training Platform (" + ", ".join(f"#{x.get('ax')}" for x in final) + ")", "the Training Platform copy could not be saved: " + str(r)[:200])

say(); say("PART 3 · PROOF")
for fn in ["coverage-run", "coverage-shifts", "coverage-watch", "match-dark", "axiscare-client-webhook"]:
    if metas[(HUB, fn)] is None: continue
    s, b = http("POST", f"{FNB}/functions/v1/{fn}", {})
    chk(s in (400, 401, 403), f"{fn}: a caller with no key gets nothing ({s})", f"{fn} answered a stranger ({s})")
say()
if not L.fails:
    say("  1064: DONE. A visit on the Practice client never counts as care: no missed clock-in, late, coverage, attendance, notes,")
    say("  Team Builder, match or New Clients. Put test clock-ins only on the client named exactly \"Practice\".")
else: say("  1064: NOT COMPLETE. See the ✗ lines above.")
done(0 if not L.fails else 1)
