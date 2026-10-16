#!/usr/bin/env python3
# 840 · FAMILY APP LIVE TEST ON TEST CLIENT 5. Samantha 2026-10-16: "Yes, build the live test on Test Client 5 only, then the step
# to turn on live booking."
# Does exactly what a family does in the app, as the test login stroutman2011@gmail.com, on Test Client 5 (AxisCare #290) ONLY:
#  1. Puts the reviewed family door live (family-gateway) and makes ONLY #290 live (ops_settings family_app_live_clients).
#     Every other client stays in practice mode. Caregiver offers stay OFF, so no caregiver is texted.
#  2. Signs in as the test login without sending any email (a one-time sign-in made on the server).
#  3. Books a 2-hour visit 8+ days out (far enough that no open-shift alert fires), checks it is on the AxisCare schedule
#     with no caregiver, and that the office got its "Place a caregiver" card.
#  4. Cancels it in the app, checks AxisCare removed it and the card closed itself. (Cancelling also leaves a short
#     cancellation note on Test Client 5's AxisCare record, the same as for a real family.)
#  5. Puts #290 back to practice mode, whatever happened above.
# Never touches a real client, never texts or emails anyone.
import json, os, re, subprocess, sys, time, hashlib, urllib.request, urllib.error
from datetime import datetime, timedelta, timezone
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); SUPA = os.environ.get("SB_SUPA_CLI", "")
REPO = os.environ["SB_REPO"]; PINS = json.loads(os.environ["SB_PINS"])
HUB = "zngsgedlsxinbygwmxwn"; FAM_NAME = "cc-family-app"
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB}.supabase.co"); FAMB = os.environ.get("SB_FAM_BASE", "")
EMAIL = "stroutman2011@gmail.com"; AX = "290"; ORIGIN = "https://family.mo-care.com"
TODAY = os.environ.get("SB_TODAY")   # tests pin the date
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for h in HIDE:
        if h: s = s.replace(h, "(hidden)")
    s = re.sub(r"(sbp_|eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._\-]{8,}", "(hidden)", s)
    print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def ok(s): say("  ✓ " + s)
def chk(good, msg_ok, msg_bad=None): (ok(msg_ok) if good else bad(msg_bad or msg_ok)); return good
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=90):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-840/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def j(b):
    try: return json.loads(b)
    except Exception: return None
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{HUB}/database/query", {"query": q}, MG())
    return (s in (200, 201)), (j(b) if s in (200, 201) else f"HTTP {s}: {str(b)[:300]}")
def keys(ref):
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{ref}/api-keys{q}", headers=MG())
        arr = j(b) if s == 200 else None
        if isinstance(arr, dict): arr = arr.get("keys") or []
        got = {k.get("name"): k.get("api_key", "") for k in (arr or []) if isinstance(k, dict)}
        if str(got.get("service_role", "")).startswith("eyJ") and str(got.get("anon", "")).startswith("eyJ"): return got
    return {}
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
def set_live_clients(ids):
    arr = json.dumps(ids)
    return sql(f"update public.app_data set data = coalesce(data, '{{}}'::jsonb) || jsonb_build_object('family_app_live_clients', '{arr}'::jsonb) where key = 'ops_settings' "
               "returning data->'family_app_live_clients' as lc, data->>'family_app_live' as live, data->>'family_fee_check_ready' as ready, data->>'family_offer_live' as offers")

say("840 · FAMILY APP LIVE TEST (Test Client 5 only)"); say(time.strftime("%Y-%m-%d %H:%M")); say()
for rel, want in PINS.items():
    p = os.path.join(REPO, rel)
    if not os.path.exists(p) or sha(p) != want: bad(f"{rel} is not the reviewed build"); say("  STOP. Nothing was changed."); done(2)
ok("reviewed build")

# ── 1. Make only #290 live ──────────────────────────────────────────────────────────────────────────────────────────
say(); say("1 · LIVE FOR TEST CLIENT 5 ONLY")
s, b = http("GET", f"{API}/v1/projects", headers=MG())
if s == 401: bad("Supabase didn't accept that access token"); say("  STOP. Nothing was changed."); done(2)
fam = next((x for x in (j(b) or []) if isinstance(x, dict) and x.get("name") == FAM_NAME), None)
if not fam: bad(f"{FAM_NAME} not found"); say("  STOP. Nothing was changed."); done(2)
FREF = fam.get("id") or fam.get("ref"); FURL = FAMB or f"https://{FREF}.supabase.co"
fk = keys(FREF)
if not fk: bad(f"couldn't read {FAM_NAME}'s keys"); say("  STOP. Nothing was changed."); done(2)
HIDE += [fk["anon"], fk["service_role"]]
good, rows = sql("select data->>'family_app_live' as live, data->>'family_fee_check_ready' as ready, data->>'family_offer_live' as offers from public.app_data where key = 'ops_settings'")
r = (rows or [{}])[0] if good else {}
if r.get("live") == "true": bad("live booking is already ON for everyone, so this test isn't needed"); say("  STOP. Nothing was changed."); done(2)
if r.get("ready") != "true": bad("the App fee check isn't installed (family_fee_check_ready), so nothing can go live yet"); say("  STOP. Nothing was changed."); done(2)
if r.get("offers") == "true": bad("caregiver offers are ON; turn them off on the Admin page first so the test texts nobody"); say("  STOP. Nothing was changed."); done(2)
p = subprocess.run([SUPA, "functions", "deploy", "family-gateway", "--project-ref", HUB, "--use-api", "--no-verify-jwt"], cwd=REPO, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
if not chk(p.returncode == 0, "family door updated (it knows 'live for listed clients')", f"family door didn't deploy: {(p.stderr or p.stdout)[-200:]}"): say("  STOP. Nothing else was changed."); done(1)
time.sleep(float(os.environ.get("SB_SETTLE", "5")))
good, rows = set_live_clients([AX])
r = (rows or [{}])[0] if good else {}
if not chk(good and r.get("lc") in ([AX], json.dumps([AX])) and r.get("live") != "true", "Test Client 5 is live; every other client is still practice; offers OFF", f"couldn't make Test Client 5 live ({rows})"): done(1)

booking = None; removed_ok = False
try:
    # ── 2. Sign in as the test login (no email) ─────────────────────────────────────────────────────────────────────
    say(); say("2 · SIGN IN AS THE TEST LOGIN (no email sent)")
    SVC = {"apikey": fk["service_role"], "Authorization": "Bearer " + fk["service_role"]}
    s, b = http("POST", f"{FURL}/auth/v1/admin/generate_link", {"type": "magiclink", "email": EMAIL}, SVC)
    gl = j(b) or {}; th = gl.get("hashed_token") or (gl.get("properties") or {}).get("hashed_token")
    tok = None
    if s == 200 and th:
        for typ in ("magiclink", "email"):
            s2, b2 = http("POST", f"{FURL}/auth/v1/verify", {"type": typ, "token_hash": th}, {"apikey": fk["anon"]})
            tok = (j(b2) or {}).get("access_token") if s2 == 200 else None
            if tok: break
    if not chk(bool(tok), "signed in as " + EMAIL, f"couldn't sign in as the test login ({s}: {str(b)[:160]}). Was 821 run?"): raise RuntimeError("no sign-in")
    HIDE.append(tok)
    def gw(body):
        s, b = http("POST", f"{FNB}/functions/v1/family-gateway", body, {"Authorization": "Bearer " + tok, "Origin": ORIGIN})
        return s, (j(b) or {})
    s, me = gw({"action": "me"})
    if not chk(s == 200 and any(str(c.get("id")) == AX for c in me.get("clients", [])), "the login reaches Test Client 5", f"the login doesn't reach Test Client 5 ({s}: {me})"): raise RuntimeError("no client")
    s, home = gw({"action": "home", "client": AX})
    st8 = (home.get("client") or {}).get("state")
    if not chk(s == 200 and st8 == "MO", "Test Client 5 opens in the app (Missouri)",
               f"Test Client 5 didn't open ({s}: {home.get('error') or 'state ' + str(st8)}). If it says the address, set a Missouri residential address on Test Client 5 in AxisCare and run 840 again."): raise RuntimeError("no home")

    # ── 3. Book ─────────────────────────────────────────────────────────────────────────────────────────────────────
    say(); say("3 · BOOK A VISIT")
    d = datetime.fromisoformat(TODAY) if TODAY else datetime.now(timezone.utc) - timedelta(hours=5)
    d = d + timedelta(days=8)
    while d.weekday() > 4: d += timedelta(days=1)
    date = d.strftime("%Y-%m-%d")
    s, bk = gw({"action": "book", "client": AX, "kind": "set", "date": date, "start": "10:00", "end": "12:00", "hours": 2, "tasks": ["Companionship"], "who": "any",
                "note": "Live test by 840. Not a real visit."})
    booking = bk.get("booking_id")
    say(f"  · booked {date} 10:00 AM to 12:00 PM: {bk.get('status') or bk.get('error')}")
    if bk.get("status") == "practice": bad("it was recorded as PRACTICE, so live-for-Test-Client-5 didn't take effect"); raise RuntimeError("practice")
    good, rows = sql(f"select status, axiscare_visit_id, error from public.family_bookings where id = '{booking}'") if booking else (False, [])
    row = (rows or [{}])[0] if good else {}
    if bk.get("status") == "needs_office":
        bad(f"AxisCare didn't take the visit, so it went to the office instead: {row.get('error')}")
    else:
        chk(s == 200 and bk.get("status") == "waiting_for_caregiver" and row.get("axiscare_visit_id"), f"on the AxisCare schedule (visit {row.get('axiscare_visit_id')}), waiting for a caregiver", f"booking didn't go through ({s}: {bk})")
        s, home = gw({"action": "home", "client": AX})
        seen = [v for v in home.get("visits", []) if v.get("date") == date and v.get("start") == "10:00" and v.get("end") == "12:00"]
        chk(len(seen) == 1 and not seen[0].get("caregiver"), "AxisCare shows it: Test Client 5, " + date + ", 10 to 12, no caregiver yet", f"AxisCare doesn't show it as expected ({seen})")
        good, rows = sql(f"select x->>'status' as st, x->>'title' as title from public.app_data, jsonb_array_elements(data) x where key = 'ops_items' and x->>'id' = 'fam_book_{booking}'")
        card = (rows or [{}])[0] if good and rows else {}
        chk(card.get("st") == "open", f"the office got its card: \"{card.get('title')}\"", "the office card wasn't made")

    # ── 4. Cancel ───────────────────────────────────────────────────────────────────────────────────────────────────
    say(); say("4 · CANCEL IT IN THE APP")
    if booking:
        s, cx = gw({"action": "cancel", "client": AX, "booking_id": booking})
        chk(s == 200 and cx.get("ok") is True and cx.get("late") is False, f"cancelled: \"{cx.get('message')}\"", f"cancel didn't go through ({s}: {cx})")
        good, rows = sql(f"select status, error from public.family_bookings where id = '{booking}'")
        row = (rows or [{}])[0] if good else {}
        s, home = gw({"action": "home", "client": AX})
        still = [v for v in home.get("visits", []) if v.get("date") == date and v.get("start") == "10:00"]
        removed_ok = row.get("status") == "cancelled" and not still and not row.get("error")
        chk(removed_ok, "AxisCare removed it; the booking reads cancelled", f"NOT removed cleanly (booking {row}, AxisCare still shows {len(still)}). Please delete Test Client 5's {date} 10:00 visit in AxisCare.")
        good, rows = sql(f"select x->>'id' as id, x->>'status' as st from public.app_data, jsonb_array_elements(data) x where key = 'ops_items' and x->>'id' in ('fam_book_{booking}', 'fam_cancel_{booking}')")
        cards = {r["id"]: r["st"] for r in (rows or [])} if good else {}
        chk(cards.get(f"fam_book_{booking}") in (None, "done") and f"fam_cancel_{booking}" not in cards, "the office card closed itself; no cancel card needed", f"office cards left open: {cards}")
except RuntimeError:
    pass
finally:
    # ── 5. Back to practice ─────────────────────────────────────────────────────────────────────────────────────────
    say(); say("5 · TEST CLIENT 5 BACK TO PRACTICE")
    good, rows = set_live_clients([])
    r = (rows or [{}])[0] if good else {}
    chk(good and r.get("lc") in ([], "[]") and r.get("live") != "true", "nobody is live; the app is back to practice mode", f"COULDN'T put Test Client 5 back to practice ({rows}). Tell Claude.")
say()
say("  840: " + ("PASSED. A family booking went onto the AxisCare schedule and came off again when cancelled. Ready for 841 (turn on live booking)." if not fails
                 else "NOT PASSED. See the ✗ lines above. Live booking was NOT turned on."))
done(0 if not fails else 1)
