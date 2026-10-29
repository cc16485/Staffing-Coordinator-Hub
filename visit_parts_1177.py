#!/usr/bin/env python3
# 1177 · LONG HOME VISITS RECORDED IN PARTS (Samantha 2026-10-29: "make the recorder handle a full 90-minute home visit").
#   visit_parts_1177.sql: three columns on recordings (session_id, part, offset_seconds) and an index. Adds only.
# No function changes: each part is an ordinary recording, so transcribe-recording and purge-recordings are untouched.
# Prints counts only: no name, number, email, key or secret. Nothing is deleted and nobody is contacted.
import os, json
os.environ.setdefault("SB_STEP", "1177")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
COLS = ("session_id", "part", "offset_seconds")

start("LONG HOME VISITS RECORDED IN PARTS (Staffing server)")
say("PART 1 · READ ONLY (nothing changes)")
for f, want in json.loads(os.environ.get("SB_SQL_SHAS", "{}")).items():
    (say(f"  ✓ {f} is the reviewed build") if sha(os.path.join(ROOT, f)) == want else bad(f"{f} is not the reviewed build"))
ok, r = sql(REF, "select to_regclass('public.recordings') is not null as t, (select count(*)::int from public.recordings) as n, "
                 "(select count(*)::int from public.recordings where kind = 'assessment') as a, "
                 "(select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'recordings' and column_name in ('session_id','part','offset_seconds')) as have")
if not ok or not r: bad("could not read the project: " + str(r)); done(3)
x = r[0]
(say(f"  ✓ the recordings table is there: {x['n']} recordings, {x['a']} of them home visits") if x["t"] else bad("the recordings table is missing; tell Claude"))
say(f"  · columns already there: {x['have']} of 3" + (" (this step was run before; it will only check)" if x["have"] == 3 else ""))
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
ok, r = sql(REF, open(os.path.join(ROOT, "visit_parts_1177.sql")).read())
if not ok: bad("the columns did not go in (nothing changed): " + str(r)); done(6)
say("  ✓ recordings can now tie a visit's 10-minute parts together")

say(); say("PART 3 · PROOF (read only)")
ok, r = sql(REF, "select column_name as c, data_type as t from information_schema.columns where table_schema = 'public' and table_name = 'recordings' and column_name in ('session_id','part','offset_seconds')")
got = {row["c"]: row["t"] for row in (r or [])} if ok else {}
(say("  ✓ session_id, part and offset_seconds are on recordings") if all(c in got for c in COLS) else bad("a column is missing: " + str(got)))
ok, r = sql(REF, "select to_regclass('public.recordings_session_idx') is not null as i, "
                 "has_column_privilege('authenticated', 'public.recordings', 'session_id', 'INSERT') and has_column_privilege('authenticated', 'public.recordings', 'offset_seconds', 'INSERT') as ins, "
                 "has_column_privilege('authenticated', 'public.recordings', 'part', 'SELECT') as sel, "
                 "(select relrowsecurity from pg_class where oid = 'public.recordings'::regclass) as rls, "
                 "(select count(*)::int from public.recordings) as n")
if ok and r:
    y = r[0]
    (say("  ✓ the index is there") if y["i"] else bad("the index is missing"))
    (say("  ✓ the Hub (signed in) can write and read the new columns") if y["ins"] and y["sel"] else bad("the signed-in Hub cannot use the new columns; tell Claude"))
    (say("  ✓ row security is still on for recordings (the office-only rule from 647 is unchanged)") if y["rls"] else bad("row security is OFF on recordings; tell Claude"))
    say(f"  · recordings: {y['n']} (unchanged by this step)")
else: bad("could not read the proof: " + str(r))
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the server is ready for 90-minute home visits recorded in parts. Now merge the Hub pull request."); done(0)
