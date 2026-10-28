#!/usr/bin/env python3
# Rehearsal of family_send.sql (Send to family, 2026-10-28) in a throwaway LOCAL Postgres (pgserver): it applies twice, browser
# roles can't reach it, one live link per piece per client, numbers and an erase date never sit together, the Show log can't
# be changed or deleted, the switch is added OFF and never turned off by a rerun, the 1163 self-check passes. Never touches
# Supabase.   python3 family_send_sql_test.py
import os, tempfile, glob
import pgserver
from pg8000.native import Connection, DatabaseError
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:600]))
D = tempfile.mkdtemp(prefix="tfs-"); srv = pgserver.get_server(D)
host = [kv[5:] for kv in srv.get_uri().split("?", 1)[1].split("&") if kv.startswith("host=")][0]
SOCK = [p for p in glob.glob(os.path.join(host, ".s.PGSQL.*")) if not p.endswith(".lock")][0]
db = Connection(user="postgres", database="postgres", unix_sock=SOCK)
db.run("drop database if exists fs"); db.run("create database fs"); db = Connection(user="postgres", database="fs", unix_sock=SOCK)
for r in ("anon", "authenticated", "service_role"): db.run(f"do $$ begin create role {r}; exception when duplicate_object then null; end $$")
db.run("create table public.app_data (key text primary key, data jsonb)"); db.run("insert into public.app_data values ('ops_settings', '{\"x\": 1}'::jsonb)")
db.run("grant all on all tables in schema public to authenticated")   # the worst case: a blanket grant made earlier
SQL = open(os.path.join(HERE, "family_send.sql")).read()
def tryq(q):
    try: db.run(q); return ""
    except DatabaseError as e: return str(e)
ck("it applies", tryq(SQL) == "", tryq(SQL))
ck("it applies again (safe to rerun)", tryq(SQL) == "")
ck("the switch is added OFF", db.run("select data->>'family_send_live' from app_data where key='ops_settings'")[0][0] == "false")
db.run("update app_data set data = data || '{\"family_send_live\": true}' where key='ops_settings'"); tryq(SQL)
ck("...and a switch already ON is left ON by a rerun", db.run("select data->>'family_send_live' from app_data where key='ops_settings'")[0][0] == "true")
ck("browser roles have no access (even after a blanket grant)", not any(db.run(f"select has_table_privilege('{r}', 'public.{t}', 'select') or has_table_privilege('{r}', 'public.{t}', 'insert')")[0][0]
   for r in ("anon", "authenticated") for t in ("family_sends", "family_payments", "family_payment_reveals")))
SELF = open(os.path.join(HERE, "family_send_1163.py")).read().split('CHECK = """', 1)[1].split('"""', 1)[0]
ck("the Desktop step's self-check passes", tryq(SELF) == "", tryq(SELF))
row = lambda tok, piece="payment", ax="290": f"insert into family_sends (client_ax, piece, contact_id, token_hash, to_name, to_phone, channels, sent_by, expires_at) values ('{ax}', '{piece}', gen_random_uuid(), '{tok * 64}', 'Linda Sample', '4175550142', array['sms'], 'x', now() + interval '7 days') returning id"
s1 = db.run(row("a"))[0][0]
ck("one live link per piece per client", "duplicate" in tryq(row("b")) and tryq(row("c", "circle")) == "" and tryq(row("d", "payment", "291")) == "")
db.run(f"update family_sends set revoked_at = now() where id = '{s1}'")
ck("...a cancelled one doesn't count", tryq(row("e")) == "")
ck("a link needs a phone or an email, a 10-digit phone, a real piece", all(tryq(q) for q in (
  "insert into family_sends (client_ax, piece, contact_id, token_hash, to_name, channels, sent_by, expires_at) values ('1', 'guide', gen_random_uuid(), '" + "f" * 64 + "', 'A B', array['sms'], 'x', now())",
  "insert into family_sends (client_ax, piece, contact_id, token_hash, to_name, to_phone, channels, sent_by, expires_at) values ('1', 'guide', gen_random_uuid(), '" + "9" * 64 + "', 'A B', '555', array['sms'], 'x', now())",
  "insert into family_sends (client_ax, piece, contact_id, token_hash, to_name, to_phone, channels, sent_by, expires_at) values ('1', 'agreement', gen_random_uuid(), '" + "8" * 64 + "', 'A B', '4175550142', array['sms'], 'x', now())")))
ins = lambda sid, extra="": f"insert into family_payments (send_id, client_ax, method, holder_name, brand, exp, zip, all_future, last4, sealed, signer_name, words{extra and ', erased_at'}) values ('{sid}', '290', 'card', 'Linda Sample', 'Visa', '08/29', '65804', true, '1111', {'null' if extra else chr(39) + 'v1.x.y' + chr(39)}, 'Linda Sample', 'I authorize'{extra and ', now()'}) returning id"
p1 = db.run(ins(s1))[0][0]
ck("a payment form saves with the sealed numbers", bool(p1))
ck("one payment form per link", "duplicate" in tryq(ins(s1)))
ck("numbers and an erase date can't sit together", "check" in tryq(f"update family_payments set erased_at = now() where id = '{p1}'").lower())
ck("...erasing means both at once", tryq(f"update family_payments set sealed = null, erased_at = now(), erased_why = 'entered' where id = '{p1}'") == "")
ck("no card code column exists", not db.run("select count(*) from information_schema.columns where table_name in ('family_payments','family_sends') and column_name ~* 'cvv|cvc|security|csc'")[0][0])
db.run(f"insert into family_payment_reveals (payment_id, by_email) values ('{p1}', 'billie@mo-care.com')")
ck("the Show log can't be changed or deleted", "append-only" in tryq("update family_payment_reveals set by_email = 'x'") and "append-only" in tryq("delete from family_payment_reveals"))
for n, c, note in res: print(("✓ " if c else "✗ ") + n + ("" if c else "\n     " + note))
print(f"{sum(1 for r in res if r[1])}/{len(res)} passed")
srv.cleanup() if hasattr(srv, "cleanup") else None
raise SystemExit(0 if all(r[1] for r in res) else 1)
