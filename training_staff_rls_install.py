#!/usr/bin/env python3
# Desktop 282 · Training Platform: only confirmed @mo-care.com staff accounts can read or change Training data.
#   Part 1 READ ONLY: sign-up must be OFF; which accounts will still have access (nobody locked out by surprise); which
#     access rules get narrowed and which are left alone.
#   Part 2: training-staff-rls.sql, only if it is the proven build. Every rule it changes is saved first (exact rollback).
#   Part 3 LIVE PROOF: signed in as you for under a minute (a one-time link, never emailed) you can still see Training
#     data (a COUNT only; no names printed); the public key still sees nothing; that sign-in is then signed out.
import json, os, re, hashlib, urllib.request, urllib.error, datetime as dt
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REPORT = os.environ["SB_REPORT"]
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); TP = "rdqujxiycycwhskyvrwa"; BASE = os.environ.get("SB_FN_BASE", f"https://{TP}.supabase.co")
MIG = open(os.environ["SB_MIGFILE"], "rb").read(); WANT = os.environ["SB_EXPECTED_SHA"]; PROOF_EMAIL = os.environ.get("SB_PROOF_EMAIL", "").lower()
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for v in HIDE: s = s.replace(v, "(hidden)")
    s = re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", s); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def http(method, url, body=None, headers=None, timeout=120):
    req = urllib.request.Request(url, data=(json.dumps(body).encode() if body is not None else None), method=method,
                                 headers=dict({"Content-Type": "application/json", "User-Agent": "cc-training-rls/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace"), dict(r.headers)
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace"), dict(e.headers)
    except Exception as e: return None, str(e), {}
def jl(b):
    try: return json.loads(b)
    except Exception: return {}
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    s, b, _ = http("POST", f"{API}/v1/projects/{TP}/database/query", {"query": q}, MG())
    return (s in (200, 201)), jl(b) if s in (200, 201) else b[:300]

say("TRAINING PLATFORM · ONLY CONFIRMED STAFF CAN READ OR CHANGE TRAINING DATA")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")); say()
if not TOKEN.startswith("sbp_") or not PROOF_EMAIL: say("✗ Missing the Supabase access token or the proof sign-in address. Nothing was changed."); done(1)
say("PART 1 · READ ONLY")
s, b, _ = http("GET", f"{API}/v1/projects/{TP}/config/auth", headers=MG())
if s != 200 or jl(b).get("disable_signup") is not True: say("✗ STOP: new sign-ups are not OFF on the Training Platform. Nothing was changed."); done(2)
say("  ✓ new sign-ups are off")
ok, users = sql("""select email, email_confirmed_at is not null as confirmed, deleted_at is not null as deleted, coalesce(banned_until > now(), false) as banned from auth.users order by email""")
if not ok: say("✗ STOP: could not read the accounts. Nothing was changed."); done(2)
def qualifies(u): return u["confirmed"] and not u["deleted"] and not u["banned"] and str(u["email"] or "").lower().endswith("@mo-care.com")
for u in users:
    e = str(u["email"] or ""); shown = e if e.lower().endswith("@mo-care.com") else (e[:1] + "…@" + e.split("@", 1)[-1])
    why = "" if qualifies(u) else " · no access after this: " + ", ".join(x for x, v in (("email not confirmed", not u["confirmed"]), ("deleted", u["deleted"]), ("banned", u["banned"]), ("not @mo-care.com", not e.lower().endswith("@mo-care.com"))) if v)
    say(f"  {'✓' if qualifies(u) else '○'} {shown}{why}")
if not any(qualifies(u) and str(u["email"]).lower() == PROOF_EMAIL for u in users): say(f"✗ STOP: your own account would not qualify, so this would lock you out. Nothing was changed."); done(2)
ok, pol = sql("""select schemaname, tablename, policyname, cmd, roles::text[] as roles, coalesce(qual, '') like '%is_training_staff%' or coalesce(with_check, '') like '%is_training_staff%' as done
                  from pg_policies where schemaname in ('public','storage') and 'authenticated' = any(roles) order by 1, 2, 3""")
if not ok: say("✗ STOP: could not read the access rules. Nothing was changed."); done(2)
narrow = [p for p in pol if "anon" not in p["roles"] and "public" not in p["roles"] and not p["done"] and p["tablename"] != "training_policy_backup"]
shared = [p for p in pol if "anon" in p["roles"] or "public" in p["roles"]]
say(f"  access rules to narrow to staff: {len(narrow)} (" + ", ".join(sorted({p['tablename'] for p in narrow})) + ")")
if shared: say(f"  left exactly as they are (also open to the public by design): " + ", ".join(f"{p['tablename']}.{p['policyname']}" for p in shared))
say()
say("PART 2 · INSTALL")
sha = hashlib.sha256(MIG).hexdigest()
if sha != WANT: say("  ✗ training-staff-rls.sql is not the proven build. STOP. Nothing was changed."); done(3)
say("  ✓ training-staff-rls.sql is the proven build")
ok, r = sql(MIG.decode())
if not ok: say("  ✗ STOPPED: the change did not complete (it is all-or-nothing, so nothing changed): " + str(r)[:300]); done(4)
ok, v = sql("""select (select count(*) from pg_policies where schemaname in ('public','storage') and 'authenticated' = any(roles) and not ('anon' = any(roles)) and not ('public' = any(roles))
                  and tablename <> 'training_policy_backup' and not (coalesce(qual,'') like '%is_training_staff%' or coalesce(with_check,'') like '%is_training_staff%'))::int as open_left,
                  (select count(*) from training_policy_backup)::int as saved""")
if ok and v and v[0]["open_left"] == 0: say(f"  ✓ committed: every signed-in rule now requires confirmed staff; {v[0]['saved']} original rule(s) saved for an exact rollback")
else: bad("some signed-in rules still do not require staff: " + str(v)[:200])
say()
say("PART 3 · LIVE PROOF (counts only; no names or records are printed)")
s, kb, _ = http("GET", f"{API}/v1/projects/{TP}/api-keys", headers=MG()); k = jl(kb)
keys = {x.get("name"): x.get("api_key", "") for x in (k if isinstance(k, list) else []) if isinstance(x, dict)}
SVC, ANON = keys.get("service_role", ""), keys.get("anon", ""); HIDE += [SVC, ANON]
def count(auth):
    s, b, h = http("GET", f"{BASE}/rest/v1/caregivers?select=id&limit=1", None, {"apikey": ANON, "Authorization": "Bearer " + auth, "Prefer": "count=exact"})
    m = re.search(r"/(\d+)$", h.get("Content-Range", h.get("content-range", "")) or "")
    return s, int(m.group(1)) if m else None
s, n = count(ANON)
if s in (200, 206) and n == 0: say("  ✓ the public key sees no caregivers: 0")
else: bad(f"the public key: HTTP {s}, {n} caregivers visible")
s, b, _ = http("POST", f"{BASE}/auth/v1/admin/generate_link", {"type": "magiclink", "email": PROOF_EMAIL}, {"apikey": SVC, "Authorization": "Bearer " + SVC})
th = jl(b).get("hashed_token") or (jl(b).get("properties") or {}).get("hashed_token"); at = None
for typ in ("magiclink", "email"):
    if at or not th: break
    s2, b2, _ = http("POST", f"{BASE}/auth/v1/verify", {"type": typ, "token_hash": th}, {"apikey": ANON}); at = jl(b2).get("access_token")
if not at: bad("could not sign in as you for the check; sign in to the Training dashboard and confirm you still see caregivers")
else:
    HIDE.append(at); s, n = count(at)
    if s in (200, 206) and n and n > 0: say(f"  ✓ signed in as you (staff): you still see Training data ({n} caregiver records)")
    else: bad(f"signed in as you: HTTP {s}, {n} caregivers visible. You may be locked out; the rollback file restores the originals")
    s, _, _ = http("POST", f"{BASE}/auth/v1/logout?scope=local", {}, {"apikey": ANON, "Authorization": "Bearer " + at})
    say("  ✓ that sign-in was signed out" if s in (200, 204) else f"  ○ sign-out answered {s}; the session expires on its own within the hour")
say("  ○ an outside, unconfirmed, banned or deleted account seeing nothing is proven in the test copy (14/14); proving it live would need such an account")
say()
say("RESULT: " + ("DONE · only confirmed @mo-care.com staff can read or change Training data; sign-up stays off as a second lock" if not fails else "CHECK THE ✗ LINES ABOVE"))
done(0 if not fails else 9)
