#!/usr/bin/env python3
# 821 · FAMILY APP TEST LOGIN. Samantha 2026-10-16: "please allow for stroutman2011@gmail.com to sign in" (to see what a family sees).
# Test Client 5 (AxisCare #290) is inactive in AxisCare, so it has no Hub profile and no Invite button. This does what Invite does,
# for that one address on that one test client:
#  1. Checks the Family Circle tables can take the rows (stops if they need something this step doesn't fill in).
#  2. Makes (or finds) the family app login for the address in cc-family-app.
#  3. Finds (or makes) Test Client 5's Family Circle and puts the address on it: app on, booking on (practice mode).
#  4. Reads it back.
# SB_MODE=remove turns that login off again (Family Circle row revoked, login blocked).
# Sends nothing. Changes nothing in AxisCare or GHL. Live booking stays OFF, so test bookings never reach AxisCare. Safe to run again.
import json, os, re, sys, time, urllib.request, urllib.error
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FAMB = os.environ.get("SB_FAM_BASE", "")
MODE = os.environ.get("SB_MODE", "add").strip().lower()
HUB = "zngsgedlsxinbygwmxwn"; FAM_NAME = "cc-family-app"
EMAIL = "stroutman2011@gmail.com"; AX = "290"; CLIENT = "Test Client 5"; WHO = "Samantha (test login)"; BY = "samantha@mo-care.com"
KNOWN = {"care_circles": {"id", "client_name", "active", "axiscare_client_id", "link_how", "linked_by", "linked_at"},
         "circle_contacts": {"id", "circle_id", "name", "email", "app_can_book"}}
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for h in HIDE:
        if h: s = s.replace(h, "(hidden)")
    s = re.sub(r"(sbp_|eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._\-]{8,}", "(hidden)", s)
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
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-821/1.0"}, **(headers or {})))
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
    return (s in (200, 201)), (j(b) if s in (200, 201) else f"HTTP {s}: {b[:300]}")
def keys(ref):
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{ref}/api-keys{q}", headers=MG())
        arr = j(b) if s == 200 else None
        if isinstance(arr, dict): arr = arr.get("keys") or []
        got = {k.get("name"): k.get("api_key", "") for k in (arr or []) if isinstance(k, dict)}
        if str(got.get("service_role", "")).startswith("eyJ"): return got
    return {}
READ = (f"select k.id::text as circle_id, k.client_name, k.active, c.id::text as contact_id, c.app_status, c.app_can_book, c.app_user_id::text as app_user_id "
        f"from public.circle_contacts c join public.care_circles k on k.id = c.circle_id "
        f"where k.axiscare_client_id = '{AX}' and lower(c.email) = '{EMAIL}' order by c.id")

say("821 · FAMILY APP TEST LOGIN" + (" · REMOVE" if MODE == "remove" else "")); say(time.strftime("%Y-%m-%d %H:%M")); say()
s, b = http("GET", f"{API}/v1/projects", headers=MG())
if s == 401: bad("Supabase didn't accept that access token"); say("  STOP. Nothing was changed."); done(2)
fam = next((x for x in (j(b) or []) if isinstance(x, dict) and x.get("name") == FAM_NAME), None)
if not fam: bad(f"{FAM_NAME} not found"); say("  STOP. Nothing was changed."); done(2)
FREF = fam.get("id") or fam.get("ref"); FURL = FAMB or f"https://{FREF}.supabase.co"
fk = keys(FREF)
if not fk: bad(f"couldn't read {FAM_NAME}'s keys"); say("  STOP. Nothing was changed."); done(2)
HIDE += list(fk.values()); SVC = {"apikey": fk["service_role"], "Authorization": "Bearer " + fk["service_role"]}
def find_user():
    s, b = http("GET", f"{FURL}/auth/v1/admin/users?page=1&per_page=1000", headers=SVC)
    if s != 200: return None, s
    return next((u for u in ((j(b) or {}).get("users") or []) if str(u.get("email", "")).lower() == EMAIL), None), s

if MODE == "remove":
    say("1 · TURN THE TEST LOGIN OFF")
    good, out = sql(f"update public.circle_contacts c set app_status = 'revoked' from public.care_circles k where k.id = c.circle_id and k.axiscare_client_id = '{AX}' and lower(c.email) = '{EMAIL}'; {READ}")
    rows = out if good and isinstance(out, list) else []
    chk(good and rows and all(r.get("app_status") == "revoked" for r in rows), f"{EMAIL} is off Test Client 5's app" if good else f"not changed ({out})")
    u, s = find_user()
    if u:
        s, b = http("PUT", f"{FURL}/auth/v1/admin/users/{u['id']}", {"ban_duration": "876000h"}, SVC)
        chk(s == 200, "the login is blocked" if s == 200 else f"blocking the login didn't go through ({s}); the Hub row is off, so it still sees nothing")
    say(); say("  821 REMOVE: " + ("DONE." if not fails else "NOT COMPLETE. See the ✗ lines above.")); done(0 if not fails else 1)

# ── 1. Tables ───────────────────────────────────────────────────────────────────────────────────────────────────────
say("1 · CHECK")
good, cols = sql("select table_name, column_name from information_schema.columns where table_schema = 'public' and table_name in ('care_circles','circle_contacts') "
                 "and is_nullable = 'NO' and column_default is null and coalesce(is_identity,'NO') = 'NO'")
if not good: bad(f"couldn't read the Family Circle tables ({cols})"); say("  STOP. Nothing was changed."); done(1)
need = sorted(f"{r['table_name']}.{r['column_name']}" for r in (cols or []) if r.get("column_name") not in KNOWN.get(r.get("table_name"), set()))
if need: bad("the Family Circle tables need things this step doesn't fill in: " + ", ".join(need)); say("  STOP. Nothing was changed. Tell Claude."); done(1)
good, before = sql(READ)
ok(f"Family Circle tables ready; {EMAIL} " + ("is already on Test Client 5's circle" if good and before else "isn't on Test Client 5's circle yet"))

# ── 2. Login ────────────────────────────────────────────────────────────────────────────────────────────────────────
say(); say("2 · THE APP LOGIN")
u, s = find_user()
if s != 200: bad(f"couldn't read the app's logins ({s})"); say("  STOP. Nothing was changed in the Hub."); done(1)
if u:
    http("PUT", f"{FURL}/auth/v1/admin/users/{u['id']}", {"ban_duration": "none"}, SVC); uid = u["id"]; ok("login already existed (unblocked if it had been turned off)")
else:
    s, b = http("POST", f"{FURL}/auth/v1/admin/users", {"email": EMAIL, "email_confirm": True, "user_metadata": {"name": WHO}}, SVC)
    uid = (j(b) or {}).get("id") if s in (200, 201) else None
    if not uid: bad(f"the login wasn't made ({s}: {str(b)[:160]})"); say("  STOP. Nothing was changed in the Hub."); done(1)
    ok("login made (no email sent)")
if not re.fullmatch(r"[0-9a-f\-]{36}", str(uid)): bad("the login id looks wrong"); say("  STOP. Nothing was changed in the Hub."); done(1)

# ── 3. Family Circle ────────────────────────────────────────────────────────────────────────────────────────────────
say(); say("3 · TEST CLIENT 5'S FAMILY CIRCLE")
good, out = sql(f"""begin;
do $t$
declare k public.care_circles.id%type; c public.circle_contacts.id%type;
begin
  select id into k from public.care_circles where axiscare_client_id = '{AX}' and active is not false order by id limit 1;
  if k is null then
    insert into public.care_circles (client_name, active, axiscare_client_id, link_how, linked_by, linked_at)
    values ('{CLIENT}', true, '{AX}', 'test login (821)', '{BY}', now()) returning id into k;
  end if;
  select id into c from public.circle_contacts where circle_id = k and lower(email) = '{EMAIL}' order by id limit 1;
  if c is null then
    insert into public.circle_contacts (circle_id, name, email) values (k, '{WHO}', '{EMAIL}') returning id into c;
  end if;
  update public.circle_contacts set app_user_id = '{uid}'::uuid, app_status = 'active', app_can_book = true, app_invited_at = now(),
         app_invited_by = '{BY}', stopped_at = null, axiscare_removed_at = null where id = c;
end $t$;
commit;
{READ}""")
rows = out if good and isinstance(out, list) else []
r = next((x for x in rows if x.get("app_status") == "active" and x.get("app_user_id") == uid and x.get("active") is not False), None)
chk(bool(r), f"{EMAIL} is on {CLIENT}'s Family Circle: app on, booking on" if r else f"not saved ({out if not good else rows})")
say()
if not fails:
    say("  821: DONE. Go to family.mo-care.com, type " + EMAIL + ", and enter the 6-digit code from noreply@mo-care.com.")
    say("  Live booking is OFF, so anything you book is practice and never reaches AxisCare.")
else: say("  821: NOT COMPLETE. See the ✗ lines above.")
done(0 if not fails else 1)
