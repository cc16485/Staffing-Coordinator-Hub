#!/usr/bin/env python3
# GATE 2b · CHANGE HISTORY FOR LEADS · install.
# Part 1 (read only): the SQL is the proven build; the save path updates the leads row in place (so the
#   watcher sees every save); the access rule exists; not installed yet.
# Part 2: install (one all-or-nothing transaction with its own self-check).
# Part 3: live proof inside a transaction that is ALWAYS rolled back: a made-up lead is added and changed,
#   the watcher's rows are counted, then everything is undone. No real lead is touched; only counts and
#   fingerprints are printed.
import json, os, re, hashlib, urllib.request, urllib.error, datetime as dt

MIG = open(os.environ["SB_MIGFILE"], "rb").read()
EXPECTED_SHA = os.environ["SB_EXPECTED_SHA"]
REPORT = os.environ["SB_REPORT"]
LOCAL = os.environ.get("SB_LOCAL_SOCK")
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")

lines = []
def say(s=""): print(s); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)

def sql(q):
    if LOCAL:
        from pg8000.native import Connection, DatabaseError
        c = Connection(user="postgres", database="postgres", unix_sock=LOCAL)
        try:
            rows = c.run(q); cols = [d["name"] for d in (c.columns or [])]
            return True, [dict(zip(cols, r)) for r in (rows or [])]
        except DatabaseError as e:
            d = e.args[0] if e.args and isinstance(e.args[0], dict) else {}
            return False, str(d.get("M", e))
        finally:
            try: c.close()
            except Exception: pass
    req = urllib.request.Request(f"https://api.supabase.com/v1/projects/{REF}/database/query",
        data=json.dumps({"query": q}).encode(), method="POST",
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "cc-lead-change/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return True, json.loads(r.read().decode(errors="replace"))
    except urllib.error.HTTPError as e:
        return False, "HTTP %s: %s" % (e.code, e.read().decode(errors="replace")[:600])
    except Exception as e:
        return False, "%s: %s" % (type(e).__name__, e)

say("GATE 2b · CHANGE HISTORY FOR LEADS · INSTALL")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC") + ("   (DISPOSABLE TEST TARGET)" if LOCAL else ""))
say()
say("PART 1 · READ ONLY")
sha = hashlib.sha256(MIG).hexdigest()
say("  lead-change.sql sha256 " + sha + ("  ✓ the proven build" if sha == EXPECTED_SHA else "  ✗ NOT the proven build"))
if sha != EXPECTED_SHA: say("  STOP. Nothing was run."); done(2)
ok, r = sql("""select to_regclass('public.app_data') is not null as has_app_data,
  (select count(*) from information_schema.columns where table_schema='public' and table_name='app_data'
     and ((column_name='key' and data_type='text') or (column_name='data' and data_type='jsonb'))) as key_data_cols,
  to_regclass('public.lead_change') is not null as already,
  exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='can_access_data_key') as has_rule,
  (select jsonb_array_length(data) from public.app_data where key='leads') as leads,
  (select md5(data::text) from public.app_data where key='leads') as leads_fp,
  (select string_agg(pg_get_functiondef(p.oid), E'\\n-----\\n') from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='upsert_app_data_item') as up_def,
  (select string_agg(pg_get_functiondef(p.oid), E'\\n-----\\n') from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='delete_app_data_item') as del_def,
  (select count(*) from pg_trigger where tgrelid = 'public.app_data'::regclass and not tgisinternal) as app_data_triggers""")
if not ok: say("  ✗ STOP: could not read the database: " + str(r)[:300]); done(3)
r = r[0]
def in_place(d):
    d = re.sub(r"\s+", " ", (d or "").lower())
    touches = "app_data" in d
    updates = bool(re.search(r"update (public\.)?app_data", d)) or ("on conflict" in d and "do update" in d)
    deletes_row = bool(re.search(r"delete from (public\.)?app_data", d))
    return touches and updates and not deletes_row
checks = [
  ("the shared save table is there, with its key and data columns", r["has_app_data"] and r["key_data_cols"] == 2),
  ("the Hub's save changes the leads row in place (so the watcher sees every save)", in_place(r["up_def"])),
  ("the Hub's delete changes the leads row in place too", in_place(r["del_def"])),
  ("the rule for who can read leads exists (the history will use it)", r["has_rule"]),
  ("not installed yet", not r["already"]),
]
for label, good in checks: say(("  ✓ " if good else "  ✗ ") + label)
say(f"  leads today: {r['leads']} · other watchers already on the save table: {r['app_data_triggers']}")
if not all(g for _, g in checks): say("  STOP. Nothing was installed."); done(4)
fp_before = r["leads_fp"]

say(); say("PART 2 · INSTALL")
ok, res = sql(MIG.decode())
if not ok: say("  ✗ STOPPED: the install did not complete, nothing changed: " + str(res)[:400]); done(5)
say("  ✓ installed in one transaction; its own self-check passed (watcher runs as its owner, attached to the save table, row security on, nobody else can write)")

say(); say("PART 3 · LIVE PROOF (inside a transaction that is always rolled back)")
PROOF = """do $p$ declare a int; b int; begin
  update public.app_data set data = data || '[{"id":"__lead_change_proof__","first_name":"proof"}]'::jsonb where key = 'leads';
  update public.app_data set data = (select jsonb_agg(case when e->>'id' = '__lead_change_proof__' then e || '{"client_city":"Proofville"}'::jsonb else e end)
                                       from jsonb_array_elements(data) e) where key = 'leads';
  select count(*) filter (where kind = 'added'), count(*) filter (where kind = 'changed' and field = 'client_city')
    into a, b from public.lead_change where lead_id = '__lead_change_proof__';
  raise exception 'LEAD_CHANGE_PROOF added=% changed=%', a, b;
end $p$;"""
ok, res = sql(PROOF)
m = re.search(r"LEAD_CHANGE_PROOF added=(\d+) changed=(\d+)", str(res))
seen = bool(m) and m.group(1) == "1" and m.group(2) == "1"
say("  " + ("✓ a made-up lead was added and changed: the watcher recorded 1 'added' line and 1 change" if seen
            else "✗ the watcher did not record the made-up lead as expected: " + str(res)[:300]))
ok, a = sql("""select (select md5(data::text) from public.app_data where key='leads') as leads_fp,
  (select count(*) from public.lead_change) as history_rows,
  (select count(*) from public.lead_change where lead_id='__lead_change_proof__') as proof_rows,
  has_table_privilege('authenticated','public.lead_change','select') as staff_can_read,
  has_table_privilege('authenticated','public.lead_change','insert') or has_table_privilege('authenticated','public.lead_change','update')
    or has_table_privilege('authenticated','public.lead_change','delete') as browser_can_write,
  has_table_privilege('anon','public.lead_change','select') as anon_can_read""")
a = a[0] if ok else {}
undone = a.get("leads_fp") == fp_before and a.get("proof_rows") == 0
say("  " + ("✓ everything was rolled back: the leads are byte-for-byte as before, and no proof line was kept" if undone
            else "✗ something from the proof remained: " + json.dumps({k: a.get(k) for k in ('proof_rows',)})))
safe = a.get("staff_can_read") is True and a.get("browser_can_write") is False and a.get("anon_can_read") is False
say("  " + ("✓ security: people who can read leads can read the history; nobody can write it but the watcher; signed-out visitors get nothing"
            if safe else "✗ security: " + json.dumps({k: a.get(k) for k in ('staff_can_read','browser_can_write','anon_can_read')})))
say(f"  history lines so far: {a.get('history_rows')} (it starts empty and fills as leads are saved)")
say()
allok = seen and undone and safe
say("RESULT: " + ("INSTALLED · every change to a lead is recorded from now on. The Hub's Changes list can go live next." if allok
                  else "CHECK THE ✗ LINES. To stop watching at once, run step 1 of lead-change-rollback.sql."))
done(0 if allok else 6)
