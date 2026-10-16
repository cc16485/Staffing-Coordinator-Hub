#!/usr/bin/env python3
# 820 · FAMILY APP SIGN-IN EMAILS + MISSOURI RATE. Samantha 2026-10-16: "Yes, start getting the Springfield pilot ready. Start with the
# sign-in email fix." and, asked whether the Missouri rate is $30: "yes".
# The family app's sign-in codes still come from Supabase's built-in sender, which only delivers to Supabase team members and only a
# few an hour, so a real family would never get their code. This points cc-family-app's sign-in email at Resend, the same way 351 did for
# the Hub: from "Caring Companions" <noreply@mo-care.com> (mo-care.com is already verified in Resend), up to 30 an hour.
#  1. Saves the Resend key into cc-family-app's sign-in email settings (the key is never shown).
#  2. Missouri rate $30 an hour in the Hub settings (ops_settings family_app_rate_MO). The estimate still uses a client's own AxisCare
#     rate first when they have one; $30 is for clients with no rate yet. Only that one setting is touched.
#  3. Optional test: if she typed her own address AND it already has a family app login, sends HER one sign-in code. Nobody else.
# Changes nothing else in the Hub, and nothing in AxisCare or GHL. Never contacts a family. Safe to run again (a new key just replaces the old one).
import json, os, re, sys, time, urllib.request, urllib.error
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FAMB = os.environ.get("SB_FAM_BASE", "")
RESEND = os.environ.get("SB_RESEND_KEY", "").strip(); TEST = os.environ.get("SB_TEST_EMAIL", "").strip().lower()
FAM_NAME = "cc-family-app"; HUB = "zngsgedlsxinbygwmxwn"; MO_RATE = 30; SENDER = "noreply@mo-care.com"
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
def http(method, url, body=None, headers=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-820/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def j(b):
    try: return json.loads(b)
    except Exception: return None
def keys(ref):
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{ref}/api-keys{q}", headers=MG())
        arr = j(b) if s == 200 else None
        if isinstance(arr, dict): arr = arr.get("keys") or []
        got = {k.get("name"): k.get("api_key", "") for k in (arr or []) if isinstance(k, dict)}
        if str(got.get("service_role", "")).startswith("eyJ") and str(got.get("anon", "")).startswith("eyJ"): return got
    return {}

def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{HUB}/database/query", {"query": q}, MG())
    return (s in (200, 201)), (j(b) if s in (200, 201) else f"HTTP {s}: {b[:300]}")

say("820 · FAMILY APP SIGN-IN EMAILS + MISSOURI RATE"); say(time.strftime("%Y-%m-%d %H:%M")); say()
if not re.fullmatch(r"re_[A-Za-z0-9_]{10,}", RESEND): bad("that isn't a Resend key (they start with re_)"); say("  STOP. Nothing was changed."); done(2)
if TEST and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[a-z]{2,}", TEST): bad("the test address doesn't look like an email"); say("  STOP. Nothing was changed."); done(2)

# ── 1. Sign-in email settings ───────────────────────────────────────────────────────────────────────────────────────
say("1 · SIGN-IN EMAILS (cc-family-app)")
s, b = http("GET", f"{API}/v1/projects", headers=MG())
if s == 401: bad("Supabase didn't accept that access token"); say("  STOP. Nothing was changed."); done(2)
fam = next((x for x in (j(b) or []) if isinstance(x, dict) and x.get("name") == FAM_NAME), None)
if not fam: bad(f"{FAM_NAME} not found"); say("  STOP. Nothing was changed."); done(2)
FREF = fam.get("id") or fam.get("ref"); FURL = FAMB or f"https://{FREF}.supabase.co"
s, b = http("GET", f"{API}/v1/projects/{FREF}/config/auth", headers=MG()); before = j(b) or {}
say("  · before: " + ("codes came from " + str(before.get("smtp_admin_email")) + " via " + str(before.get("smtp_host")) if before.get("smtp_host") else "codes came from Supabase's built-in sender"))
patch = {"smtp_host": "smtp.resend.com", "smtp_port": "465", "smtp_user": "resend", "smtp_pass": RESEND, "smtp_admin_email": SENDER,
         "smtp_sender_name": "Caring Companions", "rate_limit_email_sent": 30}
s, b = http("PATCH", f"{API}/v1/projects/{FREF}/config/auth", patch, MG())
s2, b2 = http("GET", f"{API}/v1/projects/{FREF}/config/auth", headers=MG()); c = j(b2) or {}
chk(s in (200, 201) and c.get("smtp_host") == "smtp.resend.com" and c.get("smtp_admin_email") == SENDER and c.get("smtp_sender_name") == "Caring Companions",
    "codes now come from Caring Companions <noreply@mo-care.com> through Resend (up to 30 an hour)" if s in (200, 201) else f"settings not saved ({s}: {str(b)[:200]})")
chk(c.get("disable_signup") is True, "sign-up still off: only families the office invites can sign in")
if fails: say("  STOP. Tell Claude."); done(1)

# ── 2. Missouri rate ────────────────────────────────────────────────────────────────────────────────────────────────
say(); say("2 · MISSOURI RATE")
good, rows = sql(f"update public.app_data set data = coalesce(data, '{{}}'::jsonb) || jsonb_build_object('family_app_rate_MO', {MO_RATE}) "
                 "where key = 'ops_settings' returning data->>'family_app_rate_MO' as mo, data->>'family_app_live' as live")
r = (rows or [{}])[0] if good and isinstance(rows, list) else {}
chk(good and str(r.get("mo")) == str(MO_RATE), f"Missouri app estimate: ${MO_RATE} an hour (a client's own AxisCare rate still wins when they have one); live booking: {'ON' if r.get('live') == 'true' else 'OFF (practice)'}"
    if good and r else f"rate not saved ({rows if not good else 'no Hub settings found'})")

# ── 3. Test (her own address only) ──────────────────────────────────────────────────────────────────────────────────
say(); say("3 · TEST")
if not TEST:
    say("  · no test address typed, so nothing was sent.")
    say("  · To test: in the Hub, Invite yourself to the app on a test client's Family Circle, then sign in at family.mo-care.com.")
else:
    fk = keys(FREF); HIDE += list(fk.values())
    if not fk: bad(f"couldn't read {FAM_NAME}'s keys, so no test was sent")
    else:
        s, b = http("GET", f"{FURL}/auth/v1/admin/users?page=1&per_page=1000", headers={"apikey": fk["service_role"], "Authorization": "Bearer " + fk["service_role"]})
        users = (j(b) or {}).get("users") if s == 200 else None
        if users is None: bad(f"couldn't check the app's logins ({s}), so no test was sent")
        elif not any(str(u.get("email", "")).lower() == TEST for u in users):
            say(f"  · {TEST} doesn't have a family app login yet, so nothing was sent.")
            say("  · To test: in the Hub, Invite yourself to the app on a test client's Family Circle, then sign in at family.mo-care.com.")
        else:
            s, b = http("POST", f"{FURL}/auth/v1/otp", {"email": TEST, "create_user": False}, {"apikey": fk["anon"]})
            if s == 200: ok(f"a sign-in code was handed to Resend for {TEST}. Check that inbox (and spam) in the next couple of minutes.")
            elif s == 429: bad("Supabase says too many codes were asked for just now. Wait a minute and sign in at family.mo-care.com to test.")
            else: bad(f"the test code was NOT sent ({s}: {str(b)[:160]}). Most likely the key isn't a Sending key for mo-care.com. Make a new one and run 820 again.")
say()
say("  820: " + ("DONE. Family sign-in codes come from noreply@mo-care.com; Missouri estimate $30 an hour." if not fails else "NOT COMPLETE. See the ✗ lines above."))
done(0 if not fails else 1)
