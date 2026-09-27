#!/usr/bin/env python3
# Step 0 · 0a · pause the automatic inquiry acknowledgment and the day-1/day-3 follow-ups (Desktop 269).
#  1. sha-checks lead-followup, lead-intake and the shared switch file (the reviewed builds only)
#  2. records the two switches OFF in ops_settings, with who decided and when (the code already treats
#     "absent" as off; writing them makes the state visible in the refresh report)
#  3. reads how each function checks callers today and deploys each exactly the same way; reads it back
#  4. proves on the LIVE system, without messaging anyone: the follow-up sweep's dry run reports both
#     switches off and would send nothing to any family; the office "lead waiting" alert is untouched
# The web form is proven by the harness (a live test would create a real inquiry and alert the office).
# Nothing here turns anything ON. Resuming the acknowledgment is a later, separate decision.
import json, os, hashlib, subprocess, urllib.request, urllib.error, datetime as dt
FNROOT = os.environ["SB_FNROOT"]; FN_SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPORT = os.environ["SB_REPORT"]
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "")
SUPA = os.environ.get("SB_SUPA_CLI", ""); SKIP_FN = os.environ.get("SB_SKIP_FUNCTION") == "1"
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
DEPLOY = ["lead-followup", "lead-intake"]
lines = []
def say(s=""): print(s, flush=True); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def http(method, url, body=None, headers=None, timeout=240):
    req = urllib.request.Request(url, data=(json.dumps(body).encode() if body is not None else None), method=method,
                                 headers=dict({"Content-Type": "application/json", "User-Agent": "cc-inquiry-pause/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, "%s: %s" % (type(e).__name__, e)
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, {"Authorization": "Bearer " + TOKEN})
    if s not in (200, 201): return False, f"HTTP {s}: {b[:300]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:300]
def verify_jwt(fn):
    s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{fn}", headers={"Authorization": "Bearer " + TOKEN})
    try: v = json.loads(b).get("verify_jwt") if s == 200 else None
    except Exception: v = None
    return v if isinstance(v, bool) else None
def keys():
    s, kb = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers={"Authorization": "Bearer " + TOKEN})
    try: return {k.get("name"): k.get("api_key", "") for k in json.loads(kb) if isinstance(k, dict)}
    except Exception: return {}

say("STEP 0 · 0a · PAUSE THE AUTOMATIC INQUIRY MESSAGES · INSTALL")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
for fn, want in FN_SHAS.items():
    path = os.path.join(FNROOT, fn) if fn.endswith(".ts") else os.path.join(FNROOT, fn, "index.ts")
    got = hashlib.sha256(open(path, "rb").read()).hexdigest()
    say(f"  {fn} sha256 {got[:16]}…" + ("  ✓ reviewed source" if got == want else "  ✗ differs"))
    if got != want: say("  STOP. Nothing was run."); done(2)
before = {fn: verify_jwt(fn) for fn in DEPLOY}
if any(v is None for v in before.values()): say("  ✗ STOP: could not read how these functions check callers: " + str(before) + ". Nothing was changed."); done(3)
decided = {"by": "Samantha", "decided_on": dt.date.today().isoformat(), "at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "words": "Pause the immediate automatic inquiry acknowledgment along with the day-1 and day-3 follow-ups", "recorded_by": "Desktop 269"}
ok, r = sql("""update public.app_data set data = data || jsonb_build_object('inquiry_ack_live', false, 'inquiry_followups_live', false,
                 'inquiry_paused', '""" + json.dumps(decided).replace("'", "''") + """'::jsonb), updated_at = now()
               where key = 'ops_settings' and jsonb_typeof(data) = 'object'
               returning (data->>'inquiry_ack_live') as ack, (data->>'inquiry_followups_live') as fu""")
if not ok or not r or r[0].get("ack") != "false" or r[0].get("fu") != "false":
    say("  ✗ STOP: the two switches could not be recorded as off: " + str(r)[:300] + ". Nothing was deployed."); done(4)
say("  ✓ switches recorded OFF: inquiry_ack_live, inquiry_followups_live (with your decision noted)")
for fn in DEPLOY:
    if SKIP_FN: say(f"  (test target) would deploy {fn}" + ("" if before[fn] else " --no-verify-jwt")); continue
    p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"] + ([] if before[fn] else ["--no-verify-jwt"]),
                       cwd=os.path.dirname(os.path.dirname(FNROOT)), env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    if p.returncode != 0: say(f"  ✗ {fn} deploy failed: " + (p.stderr or p.stdout)[-400:] + " (the switches are off; the old code still sends until this deploy succeeds)"); done(5)
    say(f"  ✓ {fn} deployed")
if any(verify_jwt(fn) != before[fn] for fn in DEPLOY): say("  ✗ HOW A FUNCTION CHECKS CALLERS CHANGED. Tell Claude today."); done(6)
say("  ✓ both functions check callers exactly as before")
svc = keys().get("service_role", "")
if not svc: say("  ✗ could not read the service key to run the proof"); done(7)
s, b = http("POST", f"{FNB}/functions/v1/lead-followup?dry=1", {}, {"Authorization": "Bearer " + svc, "apikey": svc})
try: d = json.loads(b)
except Exception: d = {}
sw = d.get("switches") or {}; would = d.get("would") or {}
if s != 200 or sw.get("inquiry_ack_live") is not False or sw.get("inquiry_followups_live") is not False or sw.get("settings_read") is not True:
    say(f"  ✗ the live dry run does not show the pause (HTTP {s}: {str(d)[:300]}). Tell Claude."); done(8)
if would.get("acknowledge") or would.get("nudge"):
    say("  ✗ the live dry run would still message families: " + str({"acknowledge": would.get("acknowledge"), "nudge": would.get("nudge")})); done(8)
say(f"  ✓ live dry run: both switches off; would greet 0 and follow up 0 families")
say(f"    held back right now: {len(would.get('paused_ack') or [])} greeting(s), {len(would.get('paused_followups') or [])} follow-up(s)")
say(f"    office \"lead waiting\" alerts still planned: {len(would.get('office') or [])}")
say()
say("RESULT: PAUSED · no automatic greeting or follow-up reaches a family; the office still gets its alerts")
say("Resuming the greeting is your separate decision after 0b (the universal opt-out) is proven.")
done(0)
