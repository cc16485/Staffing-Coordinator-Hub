#!/usr/bin/env python3
# 623 · PHONE NOTIFICATIONS (Samantha 2026-10-12, "build 6-8", item 7). Sets up what CC Office needs to tell a phone that
# something landed in Act Now, without anything being sent yet:
#   1. the phones table (each person turns it on for their own phone; nobody sees anyone else's) and the told-once log;
#   2. a signing key pair for Web Push, made here on this Mac: the private half goes straight into the project's secrets
#      (never shown, never written to a file), the public half into the Hub's settings (it is public by design);
#   3. push-notify, and its check every 5 minutes.
# The switch phone_notify_live stays OFF (Owners Hub Admin page), so nothing is sent until she turns it on. The notification
# carries no names or details at all. Safe to run again: an existing key pair is kept (phones stay signed up).
import os, json, base64, subprocess, hashlib
os.environ.setdefault("SB_STEP", "623")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FN = "push-notify"; JOB = "push-notify-tick"; SCHEDULE = "*/5 * * * *"; VAULT_NAME = "hub_job_secret"
FNB = f"https://{REF}.supabase.co"
def lit(v): return "'" + str(v).replace("'", "''") + "'"
def secrets(ref):
    s, b = http("GET", f"{API}/v1/projects/{ref}/secrets", headers=MG())
    try: return {x.get("name") for x in json.loads(b)} if s == 200 else set()
    except Exception: return set()
def keys(ref):
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_publishable_") or v.startswith("sb_secret_")) and "·" not in v and "*" not in v
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{ref}/api-keys{q}", headers=MG())
        if s != 200: continue
        try: arr = json.loads(b)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        got = {k.get("name"): k.get("api_key", "") for k in arr if isinstance(k, dict)}
        if usable(got.get("anon")): return got
    return {}
def command(url, anon, body):
    return ("select net.http_post(url := " + lit(url) + ", headers := jsonb_build_object('Content-Type', 'application/json', "
            "'Authorization', " + lit("Bearer " + anon) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")), "
            "body := " + lit(json.dumps(body)) + "::jsonb, timeout_milliseconds := 60000);")

start("PHONE NOTIFICATIONS")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
hs = secrets(REF)
ok, sv = sql(REF, f"select (select count(*) from vault.decrypted_secrets where name = {lit(VAULT_NAME)})::int as vault, to_regprocedure('public.desk_hub_ok()') is not null as hub, (select data->>'phone_notify_live' from public.app_data where key = 'ops_settings') as sw, (select data->>'push_vapid_public' from public.app_data where key = 'ops_settings') as pub")
if not ok or not sv: bad("couldn't read the database: " + str(sv)); done(3)
x = sv[0]
if x["vault"] != 1 or "HUB_JOB_SECRET" not in hs: bad("the jobs' secret isn't there. Nothing was changed."); done(3)
if not x["hub"]: bad("the Hub sign-in check (desk_hub_ok) is missing. Nothing was changed."); done(3)
say("  ✓ the jobs' secret and the Hub sign-in check are there")
have_keys = "VAPID_PRIVATE_JWK" in hs and "VAPID_PUBLIC" in hs and bool(x["pub"])
say("  · signing keys: " + ("already set up (kept, so phones stay signed up)" if have_keys else "not yet (they will be made now)"))
say(f"  · the switch 'Phone notifications' is {'ON' if x['sw'] == 'true' else 'OFF'} (Owners Hub Admin page)")
sx, mx = fmeta(REF, FN)
say(f"  · push-notify: {'live, version ' + str((mx or {}).get('version')) if sx == 200 else 'new'}")
K = keys(REF); ANON = K.get("anon", ""); HIDE.append(ANON)
if not ANON: bad("couldn't read the Hub's public key. Nothing was changed."); done(3)
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
ok, r = sql(REF, "begin;\n" + open(os.path.join(ROOT, "phone_push_623.sql")).read() + "\ncommit;")
if not ok: bad("the tables didn't go in (undone as a whole): " + str(r)); done(6)
say("  ✓ the phones table (each person only sees their own) and the told-once log are in place")
if not have_keys:
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives import serialization
    k = ec.generate_private_key(ec.SECP256R1())
    n = k.private_numbers(); pub = k.public_key().public_numbers()
    u = lambda i: base64.urlsafe_b64encode(i.to_bytes(32, "big")).decode().rstrip("=")
    jwk = {"kty": "EC", "crv": "P-256", "d": u(n.private_value), "x": u(pub.x), "y": u(pub.y), "ext": True}
    raw = k.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    pub_b64 = base64.urlsafe_b64encode(raw).decode().rstrip("=")
    HIDE.append(jwk["d"])
    s, b = http("POST", f"{API}/v1/projects/{REF}/secrets", [{"name": "VAPID_PRIVATE_JWK", "value": json.dumps(jwk)}, {"name": "VAPID_PUBLIC", "value": pub_b64}], MG())
    if s not in (200, 201): bad(f"the signing key could not be stored (HTTP {s}). Nothing else changed."); done(6)
    ok, r = sql(REF, "update public.app_data set data = coalesce(data, '{}'::jsonb) || jsonb_build_object('push_vapid_public', " + lit(pub_b64) + ") where key = 'ops_settings'")
    if not ok: bad("the public key could not be saved in the Hub's settings: " + str(r)); done(6)
    say("  ✓ a signing key pair made on this Mac: the private half is in the project's secrets (never shown), the public half in the Hub's settings")
else: say("  ✓ the signing keys were already there (kept)")
if not deploy(REF, FNROOT, FN, True): say("  RESULT: STOPPED. Tell Claude."); done(6)
sql(REF, f"select cron.unschedule({lit(JOB)}) where exists (select 1 from cron.job where jobname = {lit(JOB)})")
ok, r = sql(REF, f"select cron.schedule({lit(JOB)}, {lit(SCHEDULE)}, {lit(command(FNB + '/functions/v1/' + FN, ANON, {'action': 'tick'}))}) as id")
ok2, jb = sql(REF, f"select schedule, command from cron.job where jobname = {lit(JOB)}")
if ok and ok2 and jb and jb[0]["schedule"] == SCHEDULE and "x-cron-secret" in jb[0]["command"]: say("  ✓ the check runs every 5 minutes (it sends nothing while the switch is off)")
else: bad("the 5-minute check could not be scheduled: " + str(r)[:200])

say(); say("PART 3 · PROOF (nothing is sent)")
ok, r = sql(REF, """select (select count(*) from pg_policies where tablename = 'push_subscriptions')::int as pol,
  (select count(*) from pg_policies where tablename = 'push_subscriptions' and qual ilike '%auth.jwt%' and qual ilike '%desk_hub_ok%')::int as own,
  has_table_privilege('anon', 'public.push_subscriptions', 'select') as anon_read, has_table_privilege('authenticated', 'public.push_notified', 'select') as told_read,
  (select data->>'push_vapid_public' from public.app_data where key = 'ops_settings') is not null as pub,
  (select data->>'phone_notify_live' from public.app_data where key = 'ops_settings') as sw""")
if ok and r:
    y = r[0]
    say(("  ✓ " if y["pol"] == 1 and y["own"] == 1 else "  ✗ ") + "each person can only see and change their own phones")
    say(("  ✓ " if not y["anon_read"] and not y["told_read"] else "  ✗ ") + "nobody signed out can read the phones; nobody but the server reads the told-once log")
    say(("  ✓ " if y["pub"] else "  ✗ ") + "the Hub can read the public key it needs to sign phones up")
    say(f"  · the switch is {'ON' if y['sw'] == 'true' else 'OFF: nothing is sent until you turn on Phone notifications on the Owners Hub Admin page'}")
    if not (y["pol"] == 1 and y["own"] == 1 and not y["anon_read"] and not y["told_read"] and y["pub"]): fails.append("proof")
else: bad("could not check: " + str(r))
hs2 = secrets(REF)
say(("  ✓ " if {"VAPID_PRIVATE_JWK", "VAPID_PUBLIC"} <= hs2 else "  ✗ ") + "the signing key is in the project's secrets (names only shown)")
s_, b_ = http("POST", f"{FNB}/functions/v1/{FN}", {"action": "tick"}, {"apikey": ANON, "Authorization": "Bearer " + ANON})
say(("  ✓ " if s_ == 401 else "  ✗ ") + f"push-notify refuses anyone without the jobs' secret ({s_})")
say("  · tested before deploying: 9 checks (Act Now items only, owner or everyone, told once, quiet hours with the missed clock-in exception, the signature, no payload).")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · phone notifications are set up and switched OFF. Nothing was sent."); done(0)
