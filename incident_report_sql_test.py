#!/usr/bin/env python3
# Rehearsal of incident_report.sql (Stage 1, 2026-10-27) in a throwaway LOCAL Postgres (pgserver): it applies twice, browser
# roles can't reach it, reports and PDFs can't be deleted, who/when can't change, a signed report is locked, the switch is
# added OFF and never turned off once on. Never touches Supabase.   python3 incident_report_sql_test.py
import os, tempfile, glob
import pgserver
from pg8000.native import Connection, DatabaseError
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:600]))
D = tempfile.mkdtemp(prefix="tinc-"); srv = pgserver.get_server(D)
host = [kv[5:] for kv in srv.get_uri().split("?", 1)[1].split("&") if kv.startswith("host=")][0]
SOCK = [p for p in glob.glob(os.path.join(host, ".s.PGSQL.*")) if not p.endswith(".lock")][0]
db = Connection(user="postgres", database="postgres", unix_sock=SOCK)
db.run("drop database if exists inc"); db.run("create database inc"); db = Connection(user="postgres", database="inc", unix_sock=SOCK)
for r in ("anon", "authenticated", "service_role"): db.run(f"do $$ begin create role {r}; exception when duplicate_object then null; end $$")
db.run("create schema storage"); db.run("create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[])")
db.run("create table storage.objects (id serial primary key, bucket_id text, name text)")
db.run("create table public.app_data (key text primary key, data jsonb)"); db.run("insert into public.app_data values ('ops_settings', '{\"x\": 1}'::jsonb)")
SQL = open(os.path.join(HERE, "incident_report.sql")).read()
def tryq(q):
    try: db.run(q); return ""
    except DatabaseError as e: return str(e)
ck("it applies", tryq(SQL) == "")
ck("it applies again (safe to rerun)", tryq(SQL) == "")
ck("the switch is added OFF", db.run("select data->>'incident_reports_live' from app_data where key='ops_settings'")[0][0] == "false")
db.run("update app_data set data = data || '{\"incident_reports_live\": true}' where key='ops_settings'"); tryq(SQL)
ck("...and a switch already ON is never turned off by a rerun", db.run("select data->>'incident_reports_live' from app_data where key='ops_settings'")[0][0] == "true")
ck("browser roles have no access", not any(db.run(f"select has_table_privilege('{r}', 'public.incident_report', 'select') or has_table_privilege('{r}', 'public.incident_event', 'insert')")[0][0] for r in ("anon", "authenticated")))
ck("the PDF store is private", db.run("select public from storage.buckets where id='incident-docs'")[0][0] is False)
rid = db.run("insert into incident_report (client_name, caregiver, happened_on, started_by, practice) values ('Test Client', 'Test Caregiver', '2026-10-26', 'x', false) returning id")[0][0]
ck("a report can't be deleted", "cannot be deleted" in tryq(f"delete from incident_report where id = '{rid}'"))
ck("...or truncated", "cannot be deleted" in tryq("truncate incident_report cascade"))
ck("who and when can't be changed", "cannot be changed" in tryq(f"update incident_report set caregiver = 'Someone Else' where id = '{rid}'") and "cannot be changed" in tryq(f"update incident_report set happened_on = '2026-10-01' where id = '{rid}'"))
ck("practice can't be flipped after the fact", "cannot be changed" in tryq(f"update incident_report set practice = true where id = '{rid}'"))
ck("the office's steps can be recorded while waiting", tryq(f"update incident_report set sent_at = now(), token_hash = 'h' where id = '{rid}'") == "")
ck("signing works", tryq(f"update incident_report set status = 'submitted', answers = '{{\"what\":\"x\"}}', signed_name = 'Test Caregiver', submitted_at = now(), pdf_path = 'p', token_hash = null where id = '{rid}'") == "")
ck("a signed report is locked (answers, status, PDF)", all("cannot be changed" in tryq(q) for q in (f"update incident_report set answers = '{{}}' where id = '{rid}'", f"update incident_report set status = 'cancelled' where id = '{rid}'", f"update incident_report set pdf_path = 'q' where id = '{rid}'")))
ck("...but the card link can still be noted", tryq(f"update incident_report set card_id = 'ops_inc_1' where id = '{rid}'") == "")
r2 = db.run("insert into incident_report (client_name, caregiver, happened_on, started_by) values ('A B', 'C D', '2026-10-26', 'x') returning id")[0][0]
db.run(f"update incident_report set status = 'cancelled' where id = '{r2}'")
ck("a cancelled report stays cancelled", "stays cancelled" in tryq(f"update incident_report set status = 'waiting' where id = '{r2}'"))
db.run(f"insert into incident_event (report_id, kind) values ('{rid}', 'started')")
ck("the history can only be added to", "only be added to" in tryq("update incident_event set kind = 'x'") and "only be added to" in tryq("delete from incident_event"))
db.run("insert into storage.objects (bucket_id, name) values ('incident-docs', 'reports/1/a.pdf'), ('other', 'x')")
ck("a PDF can't be deleted, moved or renamed", "cannot be deleted" in tryq("delete from storage.objects where bucket_id = 'incident-docs'") and "cannot be moved" in tryq("update storage.objects set name = 'y' where bucket_id = 'incident-docs'"))
ck("...other stores are untouched by the guard", tryq("delete from storage.objects where bucket_id = 'other'") == "")
SQL2 = open(os.path.join(HERE, "incident_review.sql")).read()
ck("Stage 2 applies, twice", tryq(SQL2) == "" and tryq(SQL2) == "")
r3 = db.run("insert into incident_report (client_name, caregiver, happened_on, started_by) values ('E F', 'G H', '2026-10-26', 'x') returning id")[0][0]
ck("a report not signed can't be reviewed", "Only a signed" in tryq(f"update incident_report set review = '{{}}', reviewed_at = now() where id = '{r3}'"))
ck("a signed report can be reviewed", tryq(f"update incident_report set review = '{{\"note\":\"x\"}}', reviewed_by = 'k', reviewed_at = now() where id = '{rid}'") == "")
ck("...and the review can't change after", "cannot be changed" in tryq(f"update incident_report set review = '{{}}' where id = '{rid}'"))
ck("Stage 1's guards still hold after Stage 2", "cannot be changed" in tryq(f"update incident_report set answers = '{{}}' where id = '{rid}'") and "cannot be deleted" in tryq(f"delete from incident_report where id = '{rid}'"))
ck("a kind other than client / employee injury is refused", "check" in tryq("insert into incident_report (client_name, caregiver, happened_on, started_by, kind) values ('a','b','2026-10-26','x','other')").lower())
srv.cleanup() if hasattr(srv, "cleanup") else None
for n, okk, note in res: print(("  ✓ " if okk else "  ✗ ") + n + ("" if okk else "\n      " + note))
print(f"\n{sum(1 for r in res if r[1])}/{len(res)} passed"); raise SystemExit(0 if all(r[1] for r in res) else 1)
