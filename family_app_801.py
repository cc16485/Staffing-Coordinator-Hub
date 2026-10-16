#!/usr/bin/env python3
# 801 · FAMILY APP STEP 1a. Samantha 2026-10-15: "Yes, start building Step 1, the family app and booking, while we wait on AxisCare."
#  1. cc-family-app sign-in: no public sign-up; sign in with a 6-digit code emailed to them; the app's address.
#     With a Resend key typed at the prompt, codes come from noreply@mo-care.com (else Supabase's built-in sender, a few an hour).
#  2. Connects the Hub to cc-family-app (3 Hub secrets; values never shown).
#  3. family_app_1a.sql: app columns on circle_contacts, family_bookings, app settings (practice mode).
#  4. Deploys family-gateway (the family door; checks the family token itself) and family-app-office (office staff only).
#  5. Proves: CORS, a missing or Hub token is refused at the family door, the office door refuses non-staff, sign-up is off.
# Never texts or emails a family. Live booking stays OFF (family_app_live false) until she turns it on.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, sys, time
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
HUB = "zngsgedlsxinbygwmxwn"; FAM_NAME = "cc-family-app"
REPO = os.environ["SB_REPO"]; PINS = json.loads(os.environ["SB_PINS"])
RESEND = os.environ.get("SB_RESEND_KEY", "").strip()
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB}.supabase.co")
FAMB = os.environ.get("SB_FAM_BASE", "")           # tests point this at the fake; else https://<ref>.supabase.co
APP = "https://family.mo-care.com"
lines = []; fails = []; HIDE = [RESEND] if RESEND else []
def say(s=""):
    s = str(s)
    for h in HIDE:
        if h: s = s.replace(h, "(hidden)")
    s = re.sub(r"(sbp_|eyJ|sb_secret_|sb_publishable_|re_)[A-Za-z0-9._\-]{8,}", "(hidden)", s)
    print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def ok(s): say("  ✓ " + s)
def chk(good, msg): (ok if good else bad)(msg)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Anything done above stays done; nothing after it ran. Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=200):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-801/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace"), dict(r.headers)
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace"), dict(e.headers or {})
    except Exception as e: return None, type(e).__name__, {}
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def j(b):
    try: return json.loads(b)
    except Exception: return None
def keys(ref):
    for q in ("?reveal=true", ""):
        s, b, _ = http("GET", f"{API}/v1/projects/{ref}/api-keys{q}", headers=MG())
        arr = j(b) if s == 200 else None
        if isinstance(arr, dict): arr = arr.get("keys") or []
        got = {k.get("name"): k.get("api_key", "") for k in (arr or []) if isinstance(k, dict)}
        if str(got.get("service_role", "")).startswith("eyJ") and str(got.get("anon", "")).startswith("eyJ"): return got
    return {}
def sql(q):
    s, b, _ = http("POST", f"{API}/v1/projects/{HUB}/database/query", {"query": q}, MG())
    return (s in (200, 201)), (j(b) if s in (200, 201) else f"HTTP {s}: {b[:300]}")
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()

say("801 · FAMILY APP STEP 1a"); say(time.strftime("%Y-%m-%d %H:%M")); say()
for rel, want in PINS.items():
    p = os.path.join(REPO, rel)
    if not os.path.exists(p) or sha(p) != want: bad(f"{rel} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
ok("reviewed build")

# ── 1. cc-family-app sign-in ────────────────────────────────────────────────────────────────────────────────────────
say(); say("1 · FAMILY SIGN-IN (cc-family-app)")
s, b, _ = http("GET", f"{API}/v1/projects", headers=MG())
if s == 401: bad("Supabase didn't accept that access token"); say("  STOP. Nothing was run."); done(2)
fam = next((x for x in (j(b) or []) if x.get("name") == FAM_NAME), None)
if not fam: bad(f"{FAM_NAME} not found (step 800 makes it)"); say("  STOP. Nothing was run."); done(2)
FREF = fam.get("id") or fam.get("ref"); FURL = FAMB or f"https://{FREF}.supabase.co"
fk = keys(FREF)
if not fk: bad(f"couldn't read {FAM_NAME}'s keys"); say("  STOP. Nothing was run."); done(2)
HIDE += [fk["anon"], fk["service_role"]]
tpl = open(os.path.join(REPO, "family-app/email/code.html")).read()
patch = {"disable_signup": True, "site_url": APP, "uri_allow_list": f"{APP}/**,http://localhost:8787/**", "external_email_enabled": True,
         "external_phone_enabled": False, "mailer_otp_exp": 900, "mailer_otp_length": 6,
         "mailer_subjects_magic_link": "Your Caring Companions sign-in code", "mailer_templates_magic_link_content": tpl}
if RESEND:
    patch.update({"smtp_host": "smtp.resend.com", "smtp_port": "465", "smtp_user": "resend", "smtp_pass": RESEND, "smtp_admin_email": "noreply@mo-care.com",
                  "smtp_sender_name": "Caring Companions", "rate_limit_email_sent": 30})
s, b, _ = http("PATCH", f"{API}/v1/projects/{FREF}/config/auth", patch, MG())
s2, b2, _ = http("GET", f"{API}/v1/projects/{FREF}/config/auth", headers=MG()); c = j(b2) or {}
chk(s in (200, 201) and c.get("disable_signup") is True and c.get("site_url") == APP and "{{ .Token }}" in str(c.get("mailer_templates_magic_link_content")) and int(c.get("mailer_otp_length") or 6) == 6,
    "sign-up off, 6-digit code by email, address family.mo-care.com" if s in (200, 201) else f"sign-in settings not saved ({s}: {str(b)[:200]})")
if RESEND: chk(c.get("smtp_host") == "smtp.resend.com" and c.get("smtp_admin_email") == "noreply@mo-care.com", "codes come from noreply@mo-care.com (Resend)")
else: say("  · codes come from Supabase's built-in sender for now (a few an hour). Fine for testing; add your Resend key before families use it.")

# ── 2. Connect the Hub ──────────────────────────────────────────────────────────────────────────────────────────────
say(); say("2 · CONNECT THE HUB")
want = {"FAMILY_APP_URL": f"https://{FREF}.supabase.co", "FAMILY_APP_ANON_KEY": fk["anon"], "FAMILY_APP_SERVICE_KEY": fk["service_role"]}
s, b, _ = http("POST", f"{API}/v1/projects/{HUB}/secrets", [{"name": k, "value": v} for k, v in want.items()], MG())
s2, b2, _ = http("GET", f"{API}/v1/projects/{HUB}/secrets", headers=MG())
names = {x.get("name") for x in (j(b2) or []) if isinstance(x, dict)}
chk(s in (200, 201) and set(want) <= names, "the Hub knows the family app (3 secrets, values not shown)" if s in (200, 201) else f"secrets not saved ({s})")
if fails: say("  STOP before the database. Tell Claude."); done(1)

# ── 3. Records ──────────────────────────────────────────────────────────────────────────────────────────────────────
say(); say("3 · RECORDS")
good, out = sql(open(os.path.join(REPO, "family_app_1a.sql")).read())
if not good: bad(f"database change refused: {out}"); say("  Nothing was changed in the database (it runs all-or-nothing)."); done(1)
good, rows = sql("select (select count(*) from information_schema.columns where table_name='circle_contacts' and column_name in ('app_user_id','app_status','app_can_book','app_invited_at','app_invited_by')) as cols, "
                 "(to_regclass('public.family_bookings') is not null) as tbl, (select data->>'family_app_live' from public.app_data where key='ops_settings') as live, "
                 "(select data->>'family_app_service_MO' from public.app_data where key='ops_settings') as mo")
r = (rows or [{}])[0] if good else {}
chk(str(r.get("cols")) == "5" and r.get("tbl") in (True, "true") and r.get("live") == "false", f"Family Circle app columns + booking records in place; live booking OFF (practice); Missouri app service: {r.get('mo')}")

# ── 4. Functions ────────────────────────────────────────────────────────────────────────────────────────────────────
say(); say("4 · THE TWO DOORS")
for fn, extra in (("family-gateway", ["--no-verify-jwt"]), ("family-app-office", [])):
    p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", HUB, "--use-api"] + extra, cwd=REPO, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    s, b, _ = http("GET", f"{API}/v1/projects/{HUB}/functions/{fn}", headers=MG()); m = j(b) or {}
    chk(p.returncode == 0 and s == 200 and m.get("verify_jwt") is (fn != "family-gateway"), f"{fn} in place" + (" (checks the family's own sign-in)" if fn == "family-gateway" else " (office staff only)") if p.returncode == 0 else f"{fn} didn't deploy: {(p.stderr or p.stdout)[-200:]}")
time.sleep(float(os.environ.get("SB_SETTLE", "4")))

# ── 5. Proofs ───────────────────────────────────────────────────────────────────────────────────────────────────────
say(); say("5 · PROOF")
hk = keys(HUB); HIDE += list(hk.values())
s, b, h = http("OPTIONS", f"{FNB}/functions/v1/family-gateway", headers={"Origin": APP, "Access-Control-Request-Method": "POST"})
chk(s == 200 and {k.lower(): v for k, v in h.items()}.get("access-control-allow-origin") == APP, "the app's address may call the family door (CORS)")
s, b, _ = http("POST", f"{FNB}/functions/v1/family-gateway", {"action": "me"})
chk(s == 401, f"no sign-in: refused ({s})")
s, b, _ = http("POST", f"{FNB}/functions/v1/family-gateway", {"action": "me"}, {"Authorization": "Bearer " + hk.get("anon", ""), "apikey": hk.get("anon", "")})
chk(s == 401, f"a Hub key is not a family sign-in: refused ({s})")
s, b, _ = http("POST", f"{FNB}/functions/v1/family-app-office", {"action": "list"}, {"Authorization": "Bearer " + hk.get("anon", ""), "apikey": hk.get("anon", "")})
chk(s in (401, 403), f"the office door refuses anyone who isn't office staff ({s})")
s, b, _ = http("POST", f"{FURL}/auth/v1/signup", {"email": "nobody-801@example.com", "password": "x" * 20}, {"apikey": fk["anon"]})
chk(s in (400, 403, 422) and re.search(r"(?i)signup|sign.?ups? (are )?(not allowed|disabled)", b or ""), f"nobody can sign themselves up ({s})")
say()
say("  STEP 1a: " + ("DONE. Practice mode: nothing is written to AxisCare until you turn on live booking." if not fails else "NOT COMPLETE. See the ✗ lines above."))
done(0 if not fails else 1)
