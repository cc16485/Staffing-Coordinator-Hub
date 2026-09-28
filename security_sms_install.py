#!/usr/bin/env python3
# Security slice (Desktop 278, 2026-09-27): close the open SMS relay in send-candidate-message.
#   Part 1 READ ONLY: the function is deployed and how it checks callers; the booking table; who will be able to send
#     staff texts (first names and roles only).
#   Part 2: sha-checked sources; one additive column on orient_bookings (confirm_sms_at, so each booking gets at most
#     one confirmation); deploy the function from THIS repo exactly as it checks callers today.
#   Part 3 LIVE PROOF, nothing can be texted: every probe uses an impossible phone number or no booking, so even the
#     old code could not send; free text refused without a staff sign-in, the booking confirmation refused without a
#     real booking; a permission check (sends nothing) as you, signed in for under a minute with a one-time link that is
#     never emailed, then signed out; and the live booking page no longer sends its own wording.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt
FNROOT = os.environ["SB_FNROOT"]; FN_SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPORT = os.environ["SB_REPORT"]
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "")
SUPA = os.environ.get("SB_SUPA_CLI", ""); SKIP_FN = os.environ.get("SB_SKIP_FUNCTION") == "1"
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
PAGE_URL = os.environ.get("SB_PAGE_URL", "https://sc.mo-care.com/orientation-booking.html"); PROOF_EMAIL = os.environ.get("SB_PROOF_EMAIL", "").strip().lower()
FN = "send-candidate-message"; IMPOSSIBLE = "0"   # not a phone number: the old code refuses it too, so nothing can be texted
OFFICE = ["owner_admin", "care_coordinator", "staffing_coordinator"]
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for v in HIDE: s = s.replace(v, "(hidden)")
    s = re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", s); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def http(method, url, body=None, headers=None, timeout=120):
    req = urllib.request.Request(url, data=(json.dumps(body).encode() if body is not None else None), method=method,
                                 headers=dict({"Content-Type": "application/json", "User-Agent": "cc-sms-relay/1.0"}, **(headers or {})))
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
def jl(b):
    try: return json.loads(b)
    except Exception: return {}
def verify_jwt():
    s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{FN}", headers=MG())
    if s == 404: return "missing"
    v = jl(b).get("verify_jwt") if s == 200 else None
    return v if isinstance(v, bool) else None

say("SECURITY SLICE · CLOSE THE OPEN TEXT RELAY (send-candidate-message)")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")); say()
if not TOKEN.startswith("sbp_") or not PROOF_EMAIL: say("✗ Missing the Supabase access token or the proof sign-in address. Nothing was changed."); done(1)

say("PART 1 · READ ONLY")
vj = verify_jwt()
if vj is None: say("✗ STOP: could not read how the function checks callers. Nothing was changed."); done(2)
if vj == "missing": say("✗ STOP: send-candidate-message is not deployed here, so there is no relay to close. Nothing was changed. Tell Claude."); done(2)
say(f"  {FN} is deployed · platform sign-in check {'ON' if vj else 'off'} (kept exactly)")
ok, t = sql("select to_regclass('public.orient_bookings') is not null as t, exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orient_bookings' and column_name = 'confirm_sms_at') as c, (select count(*) from public.orient_bookings where booked_at > now() - interval '30 days')::int as recent")
if not ok or not t or not t[0]["t"]: say("✗ STOP: the orient_bookings table was not found. Nothing was changed."); done(2)
say(f"  orient_bookings: {t[0]['recent']} booking(s) in the last 30 days · confirmation column {'already there' if t[0]['c'] else 'to be added'}")
ok, staff = sql("""select split_part(p.full_name, ' ', 1) as first,
    (select string_agg(r.role, ', ' order by r.role) from staff_roles r where r.person_id = p.person_id and r.entity = 'cc_ihs') as roles
  from persons p where exists (select 1 from staff_roles r where r.person_id = p.person_id and r.entity = 'cc_ihs') and p.active order by 1""")
if ok: say("  staff who can send candidate texts after this: " + ", ".join(f"{x['first']} ({x['roles']})" for x in staff if any(o in (x['roles'] or '') for o in OFFICE)))
say()

say("PART 2 · INSTALL")
for f, want in FN_SHAS.items():
    path = os.path.join(FNROOT, f) if f.endswith(".ts") else os.path.join(FNROOT, f, "index.ts")
    if hashlib.sha256(open(path, "rb").read()).hexdigest() != want: say(f"  ✗ {f} is not the reviewed build. STOP. Nothing was changed."); done(3)
say(f"  ✓ all {len(FN_SHAS)} source files are the reviewed builds")
ok, r = sql("alter table public.orient_bookings add column if not exists confirm_sms_at timestamptz")
ok2, c = sql("select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orient_bookings' and column_name = 'confirm_sms_at') as c")
if not ok or not ok2 or not c[0]["c"]: say("  ✗ STOP: the confirmation column could not be added. The function was not deployed."); done(4)
say("  ✓ orient_bookings.confirm_sms_at is in place (additive; nothing else in the table changed)")
if SKIP_FN: say(f"  (test target) would deploy {FN}" + ("" if vj else " --no-verify-jwt"))
else:
    p = subprocess.run([SUPA, "functions", "deploy", FN, "--project-ref", REF, "--use-api"] + ([] if vj else ["--no-verify-jwt"]),
                       cwd=os.path.dirname(os.path.dirname(FNROOT)), env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    if p.returncode != 0: bad("deploy failed: " + (p.stderr or p.stdout)[-300:]); say("  STOP. The old code is still live. Tell Claude today."); done(5)
    say(f"  ✓ {FN} deployed from this repo")
if verify_jwt() != vj: bad("how the function checks callers changed")
else: say("  ✓ it checks callers at the platform exactly as before")
say()

say("PART 3 · LIVE PROOF (every probe uses an impossible number or no booking: nothing can be texted)")
s, kb = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers=MG())
kj = jl(kb); keys = {k.get("name"): k.get("api_key", "") for k in (kj if isinstance(kj, list) else []) if isinstance(k, dict)}
SVC, ANON = keys.get("service_role", ""), keys.get("anon", ""); HIDE += [SVC, ANON]
def call(body, auth=None):
    h = {"apikey": ANON}
    if auth: h["Authorization"] = "Bearer " + auth
    return http("POST", f"{FNB}/functions/v1/{FN}", body, h, timeout=60)
s, b = call({"phone": IMPOSSIBLE, "message": "proof: free text"}, ANON)
if s == 401: say("  ✓ free text with the public key (what the booking page carries): refused, 401 (the old code would have tried to send)")
else: bad(f"free text with the public key answered {s}: the relay may still be open")
s, b = call({"phone": IMPOSSIBLE, "message": "proof: free text"})
if s == 401: say("  ✓ free text with no sign-in at all: refused, 401")
else: bad(f"free text with no sign-in answered {s}")
# no "message" at all: the old code refuses a request without one, so even it could not text this number
s, b = call({"kind": "orientation_confirmation", "phone": "+14170000000", "session_id": "no-such-session"}, ANON)
if s == 404: say("  ✓ a booking confirmation with no real booking behind it: refused, 404")
else: bad(f"a booking confirmation with no booking answered {s}")
s, b = http("POST", f"{FNB}/auth/v1/admin/generate_link", {"type": "magiclink", "email": PROOF_EMAIL}, {"apikey": SVC, "Authorization": "Bearer " + SVC})
th = jl(b).get("hashed_token") or (jl(b).get("properties") or {}).get("hashed_token"); at = None
for typ in ("magiclink", "email"):
    if at or not th: break
    s2, b2 = http("POST", f"{FNB}/auth/v1/verify", {"type": typ, "token_hash": th}, {"apikey": ANON}); at = jl(b2).get("access_token")
if not at: bad("could not sign in as you for the permission check; the refusals above still stand")
else:
    HIDE.append(at)
    s, b = call({"auth_check": True}, at)
    if s == 200 and jl(b).get("authorized") is True: say("  ✓ staff permission check as you (owner/admin): permitted, nothing sent")
    else: bad(f"the staff permission check as you answered {s}")
    s, _ = http("POST", f"{FNB}/auth/v1/logout?scope=local", {}, {"apikey": ANON, "Authorization": "Bearer " + at})
    say("  ✓ that sign-in was signed out" if s in (200, 204) else f"  ○ sign-out answered {s}; the session expires on its own within the hour")
s, page = http("GET", PAGE_URL, headers={"Cache-Control": "no-cache"}, timeout=60)
if s == 200 and "orientation_confirmation" in page and "message: confMsg" not in page: say("  ✓ the live booking page asks for the fixed confirmation and no longer sends its own wording")
elif s == 200: say("  ○ the live booking page still has the old call (the site update has not arrived yet); the server already refuses it, so its confirmation texts pause until it does")
else: say(f"  ○ could not load the live booking page (HTTP {s}); the server-side refusals above are the real boundary")
say("  ○ a real booking's confirmation is proven in the test harness (16/16); proving it live would text a real person")
say()
say("RESULT: " + ("CLOSED · nobody can text arbitrary messages through send-candidate-message; staff texts need an office sign-in; the booking page can only trigger its fixed confirmation" if not fails else "CHECK THE ✗ LINES ABOVE"))
done(0 if not fails else 9)
