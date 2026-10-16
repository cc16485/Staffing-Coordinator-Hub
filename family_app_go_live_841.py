#!/usr/bin/env python3
# 841 · TURN ON LIVE FAMILY BOOKING. Samantha 2026-10-16: "...then the step to turn on live booking."
# Only after 840 passed (a live test booking on Test Client 5 went onto AxisCare and was removed on cancel, in the last 7 days).
#  * ops_settings family_app_live = true (the App fee check must already be installed: family_fee_check_ready).
#  * family_app_live_clients emptied (it was only for the test).
# From then on, a visit a family books in the app goes on that client's AxisCare schedule with no caregiver, and the office
# gets a "Place a caregiver" card. Caregiver offers by text stay as they are (the Admin page switch).
# SB_MODE=off turns live booking back OFF (practice mode) at any time.
import json, os, re, sys, time, urllib.request, urllib.error
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); MODE = os.environ.get("SB_MODE", "on").strip().lower()
HUB = "zngsgedlsxinbygwmxwn"
lines = []; fails = []
def say(s=""):
    s = re.sub(r"(sbp_|eyJ|sb_secret_)[A-Za-z0-9._\-]{8,}", "(hidden)", str(s)); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def ok(s): say("  ✓ " + s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def http(method, url, body=None, headers=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-841/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{HUB}/database/query", {"query": q}, {"Authorization": "Bearer " + TOKEN})
    try: out = json.loads(b)
    except Exception: out = None
    return (s in (200, 201)), (out if s in (200, 201) else f"HTTP {s}: {str(b)[:300]}"), s

say("841 · " + ("TURN LIVE FAMILY BOOKING OFF" if MODE == "off" else "TURN ON LIVE FAMILY BOOKING")); say(time.strftime("%Y-%m-%d %H:%M")); say()
good, rows, s = sql("select data->>'family_app_live' as live, data->>'family_fee_check_ready' as ready, data->>'family_offer_live' as offers from public.app_data where key = 'ops_settings'")
if s == 401: bad("Supabase didn't accept that access token"); say("  STOP. Nothing was changed."); done(2)
if not good or not rows: bad(f"couldn't read the Hub settings ({rows})"); say("  STOP. Nothing was changed."); done(1)
r = rows[0]
if MODE == "off":
    good, rows, _ = sql("update public.app_data set data = data || '{\"family_app_live\": false, \"family_app_live_clients\": []}'::jsonb where key = 'ops_settings' returning data->>'family_app_live' as live")
    (ok if good and rows and rows[0].get("live") == "false" else bad)("live booking is OFF: the app is back in practice mode (bookings are recorded, nothing goes on AxisCare)")
    say(); say("  841 OFF: " + ("DONE." if not fails else "NOT COMPLETE.")); done(0 if not fails else 1)
if r.get("live") == "true": ok("live booking was already ON; nothing to change"); say(); say("  841: DONE."); done(0)
if r.get("ready") != "true": bad("the App fee check isn't installed (family_fee_check_ready), and your rule is no live booking without it"); say("  STOP. Nothing was changed."); done(2)
good, rows, _ = sql("select count(*)::int as n from public.family_bookings where axiscare_client_id = '290' and axiscare_visit_id is not null and status = 'cancelled' "
                    "and error is null and note like 'Live test by 840%' and created_at > now() - interval '7 days'")
if not (good and rows and int(rows[0].get("n") or 0) > 0):
    bad("no passed live test in the last 7 days. Run 840 first (it books and cancels a visit on Test Client 5)"); say("  STOP. Nothing was changed."); done(2)
ok("840's live test passed on Test Client 5")
good, rows, _ = sql("update public.app_data set data = data || '{\"family_app_live\": true, \"family_app_live_clients\": []}'::jsonb where key = 'ops_settings' "
                    "returning data->>'family_app_live' as live, data->>'family_fee_check_ready' as ready, data->>'family_offer_live' as offers")
r2 = (rows or [{}])[0] if good else {}
if r2.get("live") == "true" and r2.get("ready") == "true":
    ok("LIVE BOOKING IS ON: a visit a family books goes on that client's AxisCare schedule with no caregiver, and the office gets a \"Place a caregiver\" card")
    say("  · caregiver offers by text: " + ("ON" if r2.get("offers") == "true" else "OFF (the office places the caregiver from the card; turn offers on from the Admin page when you want)"))
    say("  · only clients ACTIVE in AxisCare can sign in; an Oklahoma booking comes to the office as a card until Oklahoma has a service code")
    say("  · to go back to practice at any time: run \"841b Turn off live booking\"")
else: bad(f"not saved ({rows})")
say(); say("  841: " + ("DONE." if not fails else "NOT COMPLETE. Live booking is not on."))
done(0 if not fails else 1)
