#!/usr/bin/env python3
# C2-0 · who can reach the keys that write to AxisCare (READ ONLY; yes/no and counts only; no key or value is ever printed).
#  1. The Hub's shared settings (app_data 'cc_hub_config', loaded by every signed-in Hub user): is an AxisCare token filled
#     in? is the Training Hub key filled in? (lengths only)
#  2. Who can read that record: which hubs the leads-style map gives it to, how many sign-ins have NO hub list (they can
#     read every record), and how many sign-ins there are in all.
#  3. The Training project: is its hub read key set, and is it the SAME key as the one in the shared settings (compared as
#     fingerprints inside each database; neither value leaves it)? Is the older axiscare-convert-lead function deployed,
#     and does it still create AxisCare clients and write notes for whoever presents that key (from its source here)?
import json, os, hashlib, urllib.request, urllib.error, datetime as dt
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn"); TREF = os.environ.get("SB_TRAINING_REF", "rdqujxiycycwhskyvrwa")
LOCAL = os.environ.get("SB_LOCAL_SOCK"); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
TRAIN_SRC = os.environ.get("SB_TRAIN_SRC", "/Users/samantha/Claude/Projects/Caring Companions Training Platform/supabase/functions/axiscare-convert-lead/index.ts")
lines = []
def say(s=""): print(s); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
import sys
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  This check changes nothing.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def sql(ref, q):
    if LOCAL:
        from pg8000.native import Connection, DatabaseError
        c = Connection(user="postgres", database="postgres", unix_sock=LOCAL)
        try:
            rows = c.run(q); cols = [d["name"] for d in (c.columns or [])]; return True, [dict(zip(cols, r)) for r in (rows or [])]
        except DatabaseError as e:
            d = e.args[0] if e.args and isinstance(e.args[0], dict) else {}; return False, str(d.get("M", e))
        finally: c.close()
    req = urllib.request.Request(API + f"/v1/projects/{ref}/database/query", data=json.dumps({"query": q}).encode(), method="POST",
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "cc-c2-0/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return True, json.loads(r.read().decode(errors="replace"))
    except urllib.error.HTTPError as e: return False, "HTTP %s" % e.code
    except Exception as e: return False, type(e).__name__
def api_get(ref, path):
    req = urllib.request.Request(API + f"/v1/projects/{ref}" + path, headers={"Authorization": "Bearer " + TOKEN, "User-Agent": "cc-c2-0/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r: return r.status, json.loads(r.read().decode(errors="replace"))
    except urllib.error.HTTPError as e: return e.code, None
    except Exception: return None, None
yn = lambda b: "yes" if b else "no"

say("C2-0 · WHO CAN REACH THE KEYS THAT WRITE TO AXISCARE (read only; yes/no and counts only)")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC") + ("   (DISPOSABLE TEST TARGET)" if LOCAL else "")); say()
say("1 · THE HUB'S SHARED SETTINGS (cc_hub_config)")
ok, r = sql(REF, """select exists (select 1 from public.app_data where key='cc_hub_config') as present,
  coalesce(length(nullif(btrim((select data->>'axiscare_token' from public.app_data where key='cc_hub_config')),'')),0) as token_len,
  coalesce(length(nullif(btrim((select data->>'training_hub_key' from public.app_data where key='cc_hub_config')),'')),0) as key_len,
  md5(coalesce(nullif(btrim((select data->>'training_hub_key' from public.app_data where key='cc_hub_config')),''),'')) as key_fp""")
if not ok: say("  ✗ could not read: " + str(r)[:200]); done(3)
r = r[0]; shared_fp = r["key_fp"] if r["key_len"] else None
say(f"  the record exists: {yn(r['present'])}")
say(f"  an AxisCare token is filled in: {yn(r['token_len'])}" + (f" ({r['token_len']} characters; not shown)" if r["token_len"] else ""))
say(f"  the Training Hub key is filled in: {yn(r['key_len'])}" + (f" ({r['key_len']} characters; not shown)" if r["key_len"] else ""))
say(); say("2 · WHO CAN READ IT")
ok, m = sql(REF, """select (select coalesce(string_agg(hub_slug, ', ' order by hub_slug), '') from public.app_data_key_hub_map where data_key='cc_hub_config') as hubs,
  (select count(*) from auth.users) as users,
  (select count(*) from auth.users where coalesce(raw_app_meta_data->'hub_access', 'null'::jsonb) = 'null'::jsonb) as no_hub_list,
  has_table_privilege('authenticated','public.app_data','select') as signed_in_can_select""")
if ok and m:
    m = m[0]
    say(f"  sign-ins in all: {m['users']} · sign-ins with NO hub list (they can read every settings record): {m['no_hub_list']}")
    if m["hubs"]: say(f"  the record is limited to these hubs: {m['hubs']}")
    else: say("  ✗ the record is NOT in the hub map, so EVERY signed-in user of the shared project can read it (all three hubs)")
else: say("  ✗ could not read who can reach it: " + str(m)[:200])
say(); say("3 · THE OLDER TRAINING-PROJECT ROUTE (axiscare-convert-lead)")
ok, t = sql(TREF, """select exists (select 1 from public.app_settings where key='hub_read_key') as present,
  md5(coalesce(nullif(btrim((select value->>'key' from public.app_settings where key='hub_read_key')),''),'')) as key_fp""")
if ok and t:
    t = t[0]
    say(f"  the Training project's hub read key is set: {yn(t['present'])}")
    same = bool(t["present"] and shared_fp and t["key_fp"] == shared_fp)
    say(f"  the key in the Hub's shared settings is the one it accepts: {yn(same)}" + (" ← anyone who can read the shared settings can use this route" if same else ""))
else: say("  ✗ could not read the Training project: " + str(t)[:200])
if not LOCAL:
    st, meta = api_get(TREF, "/functions/axiscare-convert-lead")
    say("  the function is deployed: " + (f"yes (version {meta.get('version')}, gateway sign-in required: {yn(meta.get('verify_jwt'))})" if st == 200 and isinstance(meta, dict) else ("no" if st == 404 else f"could not read ({st})")) + ". Not called.")
try:
    src = open(TRAIN_SRC).read()
    creates = "api/clients`" in src and "method: 'POST'" in src
    say(f"  from its source here: it creates AxisCare clients: {yn(creates)} · writes client notes: {yn('client_note' in src)} · writes caregiver notes: {yn('caregiver_note' in src)}, for whoever presents that key")
except Exception: say("  (its source is not on this Mac)")
say()
say("Nothing was changed, called or printed beyond yes/no and counts.")
done(0)
