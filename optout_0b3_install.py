#!/usr/bin/env python3
# Step 0 · 0b-3 (Desktop 277): caregiver, applicant and HomeTogether senders go through the universal opt-out check.
#   Part 1 READ ONLY: the switches that decide which caregiver texts send at all, refusals so far, how each function
#     checks callers today.
#   Part 2: sha-checked sources; the 14 functions deploy, each exactly as it checks callers today; the two that run on
#     a tight schedule (timekeeper-watch every 2 minutes, coverage-run every 3) deploy LAST.
#   Part 3 LIVE PROOF, nothing sent by this script: the GoHighLevel check still answers (Do Not Disturb readable, every
#     source readable); applicant re-engage now refuses a caller who is not signed in; the security slice still holds;
#     no switch moved; and the watcher and coverage each complete a real scheduled run AFTER the deploy.
import json, os, time, hashlib, subprocess, urllib.request, urllib.error, datetime as dt
FNROOT = os.environ["SB_FNROOT"]; FN_SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPORT = os.environ["SB_REPORT"]
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "")
SUPA = os.environ.get("SB_SUPA_CLI", ""); SKIP_FN = os.environ.get("SB_SKIP_FUNCTION") == "1"
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
POLL = float(os.environ.get("SB_POLL_SEC", "20")); POLL_MAX = float(os.environ.get("SB_POLL_MAX", "420"))
DEPLOY = ["applicant-reengage", "interview-messages", "reference-chase", "caregiver-availability", "carematch-watch", "shift-confirm",
          "coverage-reply", "ht-local", "ht-support", "stripe-webhook", "resend-relay", "timekeeper-watch", "coverage-run"]
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for v in HIDE: s = s.replace(v, "(hidden)")
    print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def http(method, url, body=None, headers=None, timeout=240):
    req = urllib.request.Request(url, data=(json.dumps(body).encode() if body is not None else None), method=method,
                                 headers=dict({"Content-Type": "application/json", "User-Agent": "cc-0b3/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, "%s: %s" % (type(e).__name__, e)
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, f"HTTP {s}: {b[:300]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:300]
def verify_jwt(fn):
    s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{fn}", headers=MG())
    try: v = json.loads(b).get("verify_jwt") if s == 200 else None
    except Exception: v = None
    return v if isinstance(v, bool) else None
def jl(b):
    try: return json.loads(b)
    except Exception: return {}
def deploy(fn, vj):
    if SKIP_FN: say(f"  (test target) would deploy {fn}" + ("" if vj else " --no-verify-jwt")); return True
    p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"] + ([] if vj else ["--no-verify-jwt"]),
                       cwd=os.path.dirname(os.path.dirname(FNROOT)), env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    if p.returncode != 0: bad(f"{fn} deploy failed: " + (p.stderr or p.stdout)[-300:]); return False
    say(f"  ✓ {fn} deployed"); return True
SW = ["coverage_send_live", "confirm_live", "carematch_live", "timekeeper_watch_live", "timekeeper_text_live", "evv_chase_live", "inquiry_ack_live", "inquiry_followups_live"]
def switches():
    ok, r = sql("select data from app_data where key = 'ops_settings'")
    if not ok or not r: return None
    d = r[0]["data"]; d = d if isinstance(d, dict) else jl(d)
    return {k: d.get(k, "(absent)") for k in SW}
def now_utc(): return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S") + "+00"

say("STEP 0 · 0b-3 · CAREGIVER, APPLICANT AND HOMETOGETHER SENDERS GO THROUGH THE OPT-OUT CHECK")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")); say()
if not TOKEN.startswith("sbp_"): say("✗ That is not a Supabase access token (sbp_...). Nothing was changed."); done(1)

# ── Part 1 ─────────────────────────────────────────────────────────────────────
say("PART 1 · READ ONLY")
sw0 = switches()
if sw0 is None: say("✗ STOP: could not read the switches. Nothing was changed."); done(2)
say("  caregiver texts: " + " · ".join(f"{k} {sw0[k]}" for k in SW[:6]))
ok, o = sql("select (select count(*) from contact_optout)::int as rec, (select count(*) from contact_send_refusal)::int as ref")
if not ok: say("✗ STOP: could not read the opt-out record. Nothing was changed."); done(2)
say(f"  opt-out record entries: {o[0]['rec']} · refusals logged so far: {o[0]['ref']}")
before = {fn: verify_jwt(fn) for fn in DEPLOY}
if any(v is None for v in before.values()): say("✗ STOP: could not read how these functions check callers: " + ", ".join(f for f, v in before.items() if v is None) + ". Nothing was changed."); done(3)
say("  how each checks callers today (kept exactly): " + ", ".join(f"{fn} {'ON' if v else 'off'}" for fn, v in before.items()))
say()

# ── Part 2 ─────────────────────────────────────────────────────────────────────
say("PART 2 · INSTALL")
for f, want in FN_SHAS.items():
    path = os.path.join(FNROOT, f) if f.endswith(".ts") else os.path.join(FNROOT, f, "index.ts")
    got = hashlib.sha256(open(path, "rb").read()).hexdigest()
    if got != want: say(f"  ✗ {f} is not the reviewed build ({got[:16]}…). STOP. Nothing was changed."); done(4)
say(f"  ✓ all {len(FN_SHAS)} source files are the reviewed builds")
s, kb = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers=MG())
kj = jl(kb); keys = {k.get("name"): k.get("api_key", "") for k in (kj if isinstance(kj, list) else []) if isinstance(k, dict)}
SVC, ANON = keys.get("service_role", ""), keys.get("anon", ""); HIDE += [SVC, ANON]
if not SVC or not ANON: say("  ✗ STOP: could not read the project keys. Nothing was changed."); done(4)
deployed_at = now_utc()
for fn in DEPLOY:
    if not deploy(fn, before[fn]):
        say("  STOP. The functions above this line run the new code; the rest still run the old code (no opt-out check, as before). Tell Claude today."); done(5)
after = {fn: verify_jwt(fn) for fn in DEPLOY}
if after != before: bad("how a function checks callers changed: " + ", ".join(f for f in DEPLOY if after.get(f) != before.get(f)))
else: say(f"  ✓ all {len(DEPLOY)} check callers exactly as before")
say()

# ── Part 3 ─────────────────────────────────────────────────────────────────────
say("PART 3 · LIVE PROOF (this script sends nothing)")
s, b = http("POST", f"{FNB}/functions/v1/lead-followup?probe_dnd=1", {}, {"Authorization": "Bearer " + SVC, "apikey": SVC}, timeout=90)
p = jl(b)
if s == 200 and (p.get("upsert_has_dnd") or p.get("get_has_dnd")) and p.get("get_has_dnd") and p.get("check_reads_ok"):
    say("  ✓ GoHighLevel still answers with Do Not Disturb (including on a direct look-up, which the saved-contact door uses); every source is readable")
else: bad(f"the GoHighLevel check did not pass (HTTP {s}; direct look-up has the flag: {p.get('get_has_dnd')}; sources readable: {p.get('check_reads_ok')})")
for fn, body, label in (("applicant-reengage", {"ids": ["00000000-0000-0000-0000-000000000000"], "message": "x", "dry": True}, "applicant re-engage (new)"),
                        ("campaign-send", {"auth_check": True, "subject": "", "html": "", "recipients": []}, "campaign send"),
                        ("circle-send", {"auth_check": True}, "Family Circle send")):
    s, _ = http("POST", f"{FNB}/functions/v1/{fn}?dry=1", body, {"apikey": ANON, "Authorization": "Bearer " + ANON}, timeout=60)
    # ?dry=1 also skips applicant re-engage's outreach-hours check, so the caller check is reached at any hour
    if s == 401: say(f"  ✓ {label} refuses a caller who is not signed in: 401")
    else: bad(f"{label} answered {s} to a caller who is not signed in")
sw1 = switches()
if sw1 == sw0: say("  ✓ no switch moved")
else: bad("a switch changed while this ran")
say(f"  … waiting for the watcher and coverage to complete a scheduled run on the new code (up to {int(POLL_MAX // 60)} minutes)")
tk = cov = None; waited = 0.0
while waited <= POLL_MAX and (tk is None or cov is None):
    if tk is None:
        ok, r = sql(f"""select status_code from net._http_response where created >= '{deployed_at}'::timestamptz
                        and content like '%settings_in_effect%' and content like '%timekeeper%' order by created desc limit 1""")
        if ok and r: tk = r[0]["status_code"]
    if cov is None:
        ok, r = sql(f"""select x->>'at' as at, x->>'ok' as ok from app_data, jsonb_array_elements(case when jsonb_typeof(data) = 'array' then data else '[]'::jsonb end) x
                        where key = 'automation_heartbeats' and x->>'id' = 'hb_coverage-run' and (x->>'at')::timestamptz >= '{deployed_at}'::timestamptz""")
        if ok and r: cov = r[0]["ok"]
    if tk is None or cov is None: time.sleep(POLL); waited += POLL
if tk == 200: say("  ✓ the clock-in watcher completed a scheduled run on the new code")
else: bad("no completed watcher run seen yet" + (f" (HTTP {tk})" if tk else "") + ". Rerun the combined check (271) to confirm; tell Claude if it stays missing.")
if cov == "true": say("  ✓ coverage completed a scheduled run on the new code (its heartbeat)")
else: bad("no coverage heartbeat since the deploy yet. Tell Claude today; coverage is critical.")
say()
say("RESULT: " + ("DONE · caregiver, applicant and HomeTogether senders now check every opt-out source before they send; staff alerts unchanged"
                  if not fails else "CHECK THE ✗ LINES ABOVE"))
done(0 if not fails else 9)
