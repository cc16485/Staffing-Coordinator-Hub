#!/usr/bin/env python3
# Z0 · which Zapier addresses are filled in today (READ ONLY; yes/no and counts only; no address is ever printed).
#  - the Staffing Hub / caregiver engine settings record ('settings'): the five webhook fields
#  - the Team Hub settings record ('team_hub_settings', its hub_config item): the Team Access Automation address
#  - any other shared record that mentions a Zapier address (record names only)
import json, os, sys, urllib.request, urllib.error, datetime as dt
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn"); LOCAL = os.environ.get("SB_LOCAL_SOCK"); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
FIELDS = [("ac_orient_webhook", "AxisCare orientation shift"), ("zapier_orient_webhook", "orientation (unused)"), ("zapier_attend_webhook", "attendance"),
          ("zapier_cand_webhook", "candidate"), ("zapier_not_hired_webhook", "not hired (unused)")]
lines = []
def say(s=""): print(s); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  This check changes nothing.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def sql(q):
    if LOCAL:
        from pg8000.native import Connection, DatabaseError
        c = Connection(user="postgres", database="postgres", unix_sock=LOCAL)
        try: rows = c.run(q); cols = [d["name"] for d in (c.columns or [])]; return True, [dict(zip(cols, r)) for r in (rows or [])]
        except DatabaseError as e: return False, str(e)[:200]
        finally: c.close()
    req = urllib.request.Request(API + f"/v1/projects/{REF}/database/query", data=json.dumps({"query": q}).encode(), method="POST",
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "cc-z0/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return True, json.loads(r.read().decode(errors="replace"))
    except urllib.error.HTTPError as e: return False, "HTTP %s" % e.code
    except Exception as e: return False, type(e).__name__
yn = lambda b: "yes" if b else "no"
say("Z0 · WHICH ZAPIER ADDRESSES ARE FILLED IN (read only; yes/no only)")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC") + ("   (DISPOSABLE TEST TARGET)" if LOCAL else "")); say()
say("1 · STAFFING HUB AND CAREGIVER ENGINE SETTINGS")
cols = ",\n".join(f"coalesce(length(nullif(btrim(data->>'{f}'),'')),0) > 0 as {f}" for f, _ in FIELDS)
ok, r = sql(f"select {cols} from public.app_data where key='settings' and jsonb_typeof(data)='object'")
if not ok: say("  ✗ could not read: " + str(r)[:200]); done(3)
if not r: say("  the record does not exist")
else:
    for f, label in FIELDS: say(f"  {label}: {yn(r[0][f])}")
say(); say("2 · TEAM HUB SETTINGS")
ok, r = sql("""select exists (select 1 from public.app_data a, jsonb_array_elements(a.data) e where a.key='team_hub_settings' and jsonb_typeof(a.data)='array'
  and jsonb_typeof(e)='object' and e->>'id'='hub_config' and coalesce(btrim(e->>'access_webhook_url'),'') <> '') as filled""")
say("  Team Access Automation address: " + (yn(r[0]["filled"]) if ok and r else "could not read"))
say(); say("3 · ANY OTHER SHARED RECORD MENTIONING A ZAPIER ADDRESS")
ok, r = sql("select coalesce(string_agg(key, ', ' order by key), '') as keys from public.app_data where data::text ilike '%hooks.zapier.com%' and key not in ('settings','team_hub_settings')")
say("  " + ((r[0]["keys"] or "none") if ok and r else "could not check"))
say(); say("Nothing was changed. No address was printed.")
done(0)
