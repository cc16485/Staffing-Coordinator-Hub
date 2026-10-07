#!/usr/bin/env python3
# 486 · LEAD RESPONSE HOURS + THE 5-MINUTE CLOCK (Leads intake desk, Stage 1; Samantha 2026-10-06 "yes to all").
#  · deploys lead-intake: the family's acknowledgment goes out at ANY hour (after hours it is worded for after hours and names
#    when we open), the only automatic message a family gets outside lead response hours. Nothing else is deployed.
#  · writes the default lead response hours (Mon–Fri 8:00 to 18:00 Central) into ops_settings.lead_response_hours only if
#    nothing is there; editable on the Hub Settings tab ("Lead response hours", Owners Hub Admin page).
#  · the Hub page (its own release) reads the same lead-rules.js: a new inquiry's card is due 5 minutes after it comes in,
#    or 5 minutes after the hours open.
# The acknowledgment switch (inquiry_ack_live) is NOT touched: whatever it is now, it stays. Nothing is texted or emailed by
# this script. The two ack texts are printed in Part 1 so they are on the record.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil
REPORT = os.environ["SB_REPORT"]; FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ.get("SB_FN_SHAS", "{}"))
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); NODE = os.environ.get("SB_NODE", "node")
ROOT = os.path.dirname(os.path.dirname(FNROOT)); FN = "lead-intake"
lines = []; fails = []
def say(s=""):
    s = re.sub(r"(sbp_|eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._\-]+", "(hidden)", str(s)); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Anything done above stays done; nothing after it ran. Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=400):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers=dict({"Content-Type": "application/json", "User-Agent": "cc-486/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, b[:200]
    try: return True, json.loads(b)
    except Exception: return False, b[:200]
def fmeta(fn):
    s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{fn}", headers=MG())
    try: return s, (json.loads(b) if s == 200 else None)
    except Exception: return s, None
def chk(good, msg): (say if good else bad)(("  ✓ " if good else "") + msg)
sha = lambda p_: hashlib.sha256(open(p_, "rb").read()).hexdigest()
lit = lambda v: "'" + str(v).replace("'", "''") + "'"
def deps(path, seen):
    if path in seen or not os.path.exists(path): return
    seen.add(path)
    for m in re.findall(r"""from\s+['"](\.{1,2}/[^'"]+)['"]|import\s+['"](\.{1,2}/[^'"]+)['"]""", open(path).read()):
        deps(os.path.normpath(os.path.join(os.path.dirname(path), m[0] or m[1])), seen)
def need(fn):
    s = set(); deps(os.path.join(FNROOT, fn, "index.ts"), s)
    return {os.path.relpath(x, ROOT).replace(os.sep, "/") for x in s}
def live_files(fn):
    tmp = tempfile.mkdtemp(prefix="cc486-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
    d = subprocess.run([SUPA, "functions", "download", fn, "--project-ref", REF, "--use-api"], cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    live = {}
    for r, _, files in os.walk(tmp):
        for f in files:
            lp = os.path.join(r, f).replace(os.sep, "/")
            if "/functions/" in lp: live["supabase/functions/" + lp.split("/functions/", 1)[1]] = sha(lp)
    shutil.rmtree(tmp, ignore_errors=True)
    return d.returncode == 0, live
def blob(k):
    ok, r = sql(f"select data from public.app_data where key = {lit(k)}")
    d = r[0]["data"] if ok and r else None
    return json.loads(d) if isinstance(d, str) else d

say("486 · LEAD RESPONSE HOURS AND THE 5-MINUTE CLOCK"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
for name, want in SHAS.items():
    p_ = os.path.join(FNROOT, "_shared", name.split("/", 1)[1]) if name.startswith("_shared/") else os.path.join(FNROOT, name, "index.ts")
    have = sha(p_) if os.path.exists(p_) else "(missing)"
    chk(have == want, f"{name} is the reviewed build" if have == want else f"{name} is not the reviewed build: nothing runs")
if fails: say(); say("  RESULT: STOPPED before anything changed."); done(2)
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); say("  RESULT: STOPPED before anything changed."); done(2)
src = open(os.path.join(FNROOT, FN, "index.ts")).read()
chk("leadHoursNow(" in src and "ack_kind" in src and not re.search(r"chiHour\s*>=\s*8", src), "lead-intake reads the hours from the shared lead-rules.js (no hard-coded 8 to 6) and records which acknowledgment went")
say("  The two acknowledgment texts (open hours · after hours), as the family will read them:")
say("    · Hi {first}, this is Caring Companions. We have your message and a care coordinator will call you shortly. If you would rather not wait, we are on (417) 234-8494. Reply STOP to opt out.")
say("    · Hi {first}, this is Caring Companions. We have your message. Our office is closed right now and we open tomorrow at 8 am; a care coordinator will call you then. If it cannot wait, call us on (417) 234-8494. Reply STOP to opt out.")
say("      (\"we open tomorrow at 8 am\" becomes \"we open at 8 am\" or \"we open Monday at 8 am\" from the hours setting)")
ops = blob("ops_settings") or {}
have_hours = isinstance(ops.get("lead_response_hours"), dict)
say("  " + ("lead response hours already set: " + json.dumps(ops["lead_response_hours"]) if have_hours else "no lead response hours set yet: the default Mon–Fri 8:00 to 18:00 Central will be written"))
say("  the acknowledgment switch (inquiry_ack_live) is " + ("ON" if ops.get("inquiry_ack_live") is True else "OFF") + " and stays that way")
sM, mM = fmeta(FN)
chk(sM == 200 and mM is not None, f"lead-intake is live now (version {(mM or {}).get('version', '?')}, gateway sign-in check {'on' if (mM or {}).get('verify_jwt') else 'off'})")
if fails: say(); say("  RESULT: STOPPED before anything changed."); done(3)

say(); say("PART 2 · CHANGE")
if not have_hours:
    d = {"days": [1, 2, 3, 4, 5], "start": "08:00", "end": "18:00"}
    okw, rw = sql("update public.app_data set data = coalesce(data, '{}'::jsonb) || " + lit(json.dumps({"lead_response_hours": d})) + "::jsonb where key = 'ops_settings' returning 1")
    chk(okw and rw, "default lead response hours written (Mon–Fri 8:00 to 18:00 Central); change them on the Hub Settings tab")
    if fails: say("  RESULT: STOPPED."); done(5)
p = subprocess.run([SUPA, "functions", "deploy", FN, "--project-ref", REF, "--use-api", "--no-verify-jwt"], cwd=ROOT, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
okd, live = live_files(FN)
good = p.returncode == 0 and okd and all(k in live and live[k] == sha(os.path.join(ROOT, k)) for k in need(FN))
chk(good, "lead-intake deployed: the live copy is this reviewed build, every shared file included" if good else "lead-intake did not deploy cleanly: " + (p.stderr or p.stdout)[-200:])
if fails: say("  RESULT: STOPPED."); done(6)
sN, mN = fmeta(FN)
if (mN or {}).get("verify_jwt") is not False:
    http("PATCH", f"{API}/v1/projects/{REF}/functions/{FN}", {"verify_jwt": False}, MG()); sN, mN = fmeta(FN)
chk((mN or {}).get("verify_jwt") is False, f"the website form can still post (gateway sign-in check off), version {(mN or {}).get('version', '?')}")

say(); say("PART 3 · PROOF")
ops2 = blob("ops_settings") or {}
chk(isinstance(ops2.get("lead_response_hours"), dict) and ops2["lead_response_hours"].get("start"), "lead response hours are on record: " + json.dumps(ops2.get("lead_response_hours")))
chk(ops2.get("inquiry_ack_live") == ops.get("inquiry_ack_live"), "the acknowledgment switch is as it was")
js = "const R=require(process.argv[1]);const h=R.responseHours(JSON.parse(process.argv[2]));console.log(JSON.stringify({sat:R.firstAttemptDue({created_at:'2026-10-10T15:00:00Z'},h),night:R.firstAttemptDue({created_at:'2026-10-07T02:02:00Z'},h),open:R.openingWords('2026-10-07T02:02:00Z',h)}))"
pr = subprocess.run([NODE, "-e", js, os.path.join(FNROOT, "_shared", "lead-rules.js"), json.dumps(ops2)], capture_output=True, text=True, timeout=60)
try: out = json.loads(pr.stdout)
except Exception: out = {}
chk(bool(out.get("night")), "the clock reads the saved hours: a 9:02 pm Tuesday inquiry is due " + str(out.get("night", "?")) + "; a Saturday 10 am inquiry is due " + str(out.get("sat", "?")) + "; the after-hours text would say \"" + str(out.get("open", "?")) + "\"")
say(); say("  RESULT: " + ("DONE" if not fails else "DONE WITH PROBLEMS, tell Claude")); done(0 if not fails else 7)
