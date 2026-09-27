#!/usr/bin/env python3
# Step 0 · 0b-2 (Desktop 276): every family, client, inquiry and public-person sender goes through the universal
# opt-out check (GHL Do Not Disturb, the Hub's opt-out record, inquiry do-not-contact, Family Circle stops).
#   Part 1 READ ONLY: the switches that decide what is sending at all, drips in progress, the opt-out record, and how
#     each function checks callers today.
#   Part 2: sha-checked sources. lead-followup deploys FIRST and runs the live GoHighLevel check (does GHL's answer carry
#     the Do Not Disturb flag, and can every source the check reads be read here). Only if that passes do the other ten
#     deploy, each exactly as it checks callers today; coverage-run last.
#   Part 3 LIVE PROOF, nothing sent: the paused inquiry messages are still paused (dry run), no switch moved, and the
#     security slice's refusals still hold.
# Nothing here turns a switch on or sends a message.
import json, os, hashlib, subprocess, urllib.request, urllib.error, datetime as dt
FNROOT = os.environ["SB_FNROOT"]; FN_SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPORT = os.environ["SB_REPORT"]
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "")
SUPA = os.environ.get("SB_SUPA_CLI", ""); SKIP_FN = os.environ.get("SB_SKIP_FUNCTION") == "1"
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FIRST = "lead-followup"
REST = ["lead-intake", "lead-nurture", "campaign-auto", "campaign-send", "cc-booking", "cc-memories", "cc-corner", "circle-send", "caregiver-intro", "coverage-run"]
ALL = [FIRST] + REST
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for v in HIDE: s = s.replace(v, "(hidden)")
    print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def http(method, url, body=None, headers=None, timeout=240):
    req = urllib.request.Request(url, data=(json.dumps(body).encode() if body is not None else None), method=method,
                                 headers=dict({"Content-Type": "application/json", "User-Agent": "cc-0b2/1.0"}, **(headers or {})))
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
SWITCH_Q = """select (select data->'inquiry_ack_live' from app_data where key = 'ops_settings')::text as ack,
                  (select data->'inquiry_followups_live' from app_data where key = 'ops_settings')::text as fu,
                  (select (data ? 'family_caregiver_change_text_approved')::text from app_data where key = 'ops_settings') as fam,
                  (select x::text from app_data, jsonb_array_elements(case when jsonb_typeof(data) = 'array' then data else '[]'::jsonb end) x
                    where key = 'campaign_settings' and x->>'id' = 'settings') as camp"""
def switches():
    ok, r = sql(SWITCH_Q)
    return r[0] if ok and r else None

say("STEP 0 · 0b-2 · FAMILY, CLIENT AND INQUIRY SENDERS GO THROUGH THE OPT-OUT CHECK")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")); say()
if not TOKEN.startswith("sbp_"): say("✗ That is not a Supabase access token (sbp_...). Nothing was changed."); done(1)

# ── Part 1 ─────────────────────────────────────────────────────────────────────
say("PART 1 · READ ONLY")
sw0 = switches()
if sw0 is None: say("✗ STOP: could not read the switches. Nothing was changed."); done(2)
camp = jl(sw0.get("camp") or "{}")
say(f"  inquiry greeting {sw0.get('ack') or '(absent, off)'} · inquiry follow-ups {sw0.get('fu') or '(absent, off)'} · caregiver-change family text approved: {sw0.get('fam') or 'false'}")
say(f"  campaign autopilot {camp.get('enabled')!r} · open leads {camp.get('aud_monthly')!r} · active clients {camp.get('aud_clients')!r} · client contacts {camp.get('aud_client_contacts')!r} · caregivers {camp.get('aud_caregivers')!r}")
ok, n = sql("""select count(*) filter (where x->>'nurture_started_at' is not null and x->>'nurture_stopped_at' is null)::int as drips,
                      count(*) filter (where x->>'auto_msgs_stopped_at' is not null)::int as stopped
                 from app_data, jsonb_array_elements(case when jsonb_typeof(data) = 'array' then data else '[]'::jsonb end) x where key = 'leads'""")
ok2, o = sql("select (select count(*) from contact_optout)::int as rec, (select count(*) from contact_send_refusal)::int as ref")
if not ok or not ok2: say("✗ STOP: could not read the inquiries or the opt-out record. Nothing was changed."); done(2)
say(f"  inquiries on a drip right now: {n[0]['drips']} · opt-out record entries: {o[0]['rec']} · refusals logged so far: {o[0]['ref']}")
before = {fn: verify_jwt(fn) for fn in ALL}
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
keys = {k.get("name"): k.get("api_key", "") for k in (jl(kb) if isinstance(jl(kb), list) else []) if isinstance(k, dict)}
SVC, ANON = keys.get("service_role", ""), keys.get("anon", ""); HIDE += [SVC, ANON]
if not SVC or not ANON: say("  ✗ STOP: could not read the project keys. Nothing was changed."); done(4)
if not deploy(FIRST, before[FIRST]): say("  STOP. Nothing else was deployed."); done(5)
if before[FIRST] is not True: say("  ✗ STOP: lead-followup must have the platform's sign-in check ON for the server-only check. Nothing else was deployed."); done(6)
s, b = http("POST", f"{FNB}/functions/v1/{FIRST}?probe_dnd=1", {}, {"Authorization": "Bearer " + SVC, "apikey": SVC}, timeout=90)
p = jl(b)
say("  Live GoHighLevel check (a staff alert contact; nothing sent, answers are yes/no only):")
if s != 200 or p.get("probe") != "dnd":
    msg = (p.get("error") or p.get("message") or p.get("msg") or str(b)[:160]) if isinstance(p, dict) else str(b)[:160]
    bad(f"the check did not answer (HTTP {s}: {msg})"); say("  STOP. Only lead-followup was deployed; its family messages are paused anyway."); done(6)
if not p.get("staff_contact"): bad("there is no staff alert phone to check with"); say("  STOP. Only lead-followup was deployed."); done(6)
dnd_ok = bool(p.get("upsert_has_dnd") or p.get("get_has_dnd"))
say(f"    GHL answers with the Do Not Disturb flag: {'yes' if dnd_ok else 'NO'} (on the find-or-create answer: {'yes' if p.get('upsert_has_dnd') else 'no'}; on a direct look-up: {'yes' if p.get('get_has_dnd') else 'no'})")
say(f"    every source the check reads is readable here: {'yes' if p.get('check_reads_ok') else 'NO'}")
if not dnd_ok or not p.get("check_reads_ok"):
    bad("the opt-out check would refuse every family message in production")
    say("  STOP. Only lead-followup was deployed (its family messages are paused). The other ten still run the old code. Tell Claude."); done(6)
say("  ✓ the check can work in production")
for fn in REST:
    if not deploy(fn, before[fn]):
        say("  STOP. The functions above this line run the new code; the rest still run the old code (no opt-out check, as before). Tell Claude today."); done(7)
after = {fn: verify_jwt(fn) for fn in ALL}
if after != before: bad("how a function checks callers changed: " + ", ".join(f for f in ALL if after.get(f) != before.get(f)))
else: say("  ✓ all eleven check callers exactly as before")
say()

# ── Part 3 ─────────────────────────────────────────────────────────────────────
say("PART 3 · LIVE PROOF (nothing is sent)")
s, b = http("POST", f"{FNB}/functions/v1/{FIRST}?dry=1", {}, {"Authorization": "Bearer " + SVC, "apikey": SVC}, timeout=90)
d = jl(b); would = d.get("would") or {}; swd = d.get("switches") or {}
if s == 200 and swd.get("settings_read") is True:
    greet, nudge = len(would.get("acknowledge") or []), len(would.get("nudge") or [])
    paused = swd.get("inquiry_ack_live") is not True and swd.get("inquiry_followups_live") is not True
    say(f"  {'✓' if paused and not greet and not nudge else '○'} follow-up sweep dry run: greeting {'paused' if swd.get('inquiry_ack_live') is not True else 'ON'}, follow-ups {'paused' if swd.get('inquiry_followups_live') is not True else 'ON'}; would greet {greet}, follow up {nudge}")
else: bad(f"the follow-up sweep dry run did not answer (HTTP {s})")
sw1 = switches()
if sw1 == sw0: say("  ✓ no switch moved (inquiry greeting, follow-ups, caregiver-change text, campaign audiences)")
else: bad("a switch changed while this ran")
for fn, body in (("campaign-send", {"auth_check": True, "subject": "", "html": "", "recipients": []}), ("circle-send", {"auth_check": True})):
    s, _ = http("POST", f"{FNB}/functions/v1/{fn}", body, {"apikey": ANON, "Authorization": "Bearer " + ANON}, timeout=60)
    if s == 401: say(f"  ✓ {fn} still refuses a caller who is not signed in (security slice holds): 401")
    else: bad(f"{fn} answered {s} to a caller who is not signed in")
say()
say("RESULT: " + ("DONE · every family, client and inquiry sender now checks every opt-out source before it sends; the paused messages stay paused"
                  if not fails else "CHECK THE ✗ LINES ABOVE"))
done(0 if not fails else 9)
