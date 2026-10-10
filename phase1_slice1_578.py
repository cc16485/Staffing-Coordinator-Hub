#!/usr/bin/env python3
# 578 · PHASE 1, SLICE 1: ONE RECORD (Samantha approved the Phase 1 design 2026-10-10; "do not deploy Slice 1 without my
# approval": this step is that deployment, run by her after review). Hub project.
#   1. op_events_harden_578.sql: the event table gets its contract columns and indexes, becomes append-only for everyone
#      (the server key too), gains the record_event door that stamps the actor from the signed-in session, pages lose the
#      right to insert directly, and only office members of Caring Companions may read it.
#   2. The four office feeds (calls-feed, interview-feed, ghl-thread, reports-rollup) answer office members only.
#   3. The functions whose event writes changed (a person on the clock-in page's events; jobs named as jobs): clockin-alert,
#      work-route, timekeeper-watch, coverage-run, coverage-watch, lead-watch, coverage-reply.
# Nothing is sent. No switch changes. No permission is widened; two are narrowed (feeds, record reads). Existing rows untouched.
import os, json, re, shutil, subprocess, time
os.environ.setdefault("SB_STEP", "578")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; BASE = f"https://{REF}.supabase.co"
FEEDS = ["calls-feed", "interview-feed", "ghl-thread", "reports-rollup"]
EMITTERS = ["clockin-alert", "work-route", "timekeeper-watch", "coverage-run", "coverage-watch", "lead-watch", "coverage-reply"]
start("PHASE 1, SLICE 1: ONE RECORD")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
NODE = shutil.which("node") or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.path.exists(p)), "")
if NODE:
    p = subprocess.run([NODE, "slice1_578_test.mjs"], cwd=ROOT, capture_output=True, text=True)
    last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
    if p.returncode != 0 or re.search(r"^FAIL", p.stdout, re.M): bad(f"slice1_578_test.mjs failed: {last}"); say("  STOP. Nothing was changed."); done(2)
    say(f"  ✓ slice1_578_test.mjs: {last.strip()}")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
ok_, n = sql(REF, "select count(*)::int as n, min(at) as first from op_events")
if ok_ and n: say(f"  · the record holds {n[0]['n']} rows (first {str(n[0]['first'])[:10]}); none will change")
else: bad(f"could not read op_events: {n}"); done(3)
ok_, pol = sql(REF, "select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'op_events' order by 1")
say("  · rules on op_events today: " + (", ".join(f"{x['policyname']} ({x['cmd']})" for x in pol) if ok_ and pol else "none readable"))
ok_, gr = sql(REF, "select grantee, string_agg(privilege_type, ',' order by privilege_type) as p from information_schema.role_table_grants where table_schema = 'public' and table_name = 'op_events' group by grantee order by 1")
say("  · grants today: " + ("; ".join(f"{x['grantee']}: {x['p']}" for x in gr) if ok_ and gr else "none readable"))
ok_, fn_ = sql(REF, "select proname from pg_proc where pronamespace = 'public'::regnamespace and proname in ('desk_me', 'desk_hub_ok', 'desk_is_owner') order by 1")
have = {x["proname"] for x in (fn_ or [])} if ok_ else set()
chk = (say if {"desk_me", "desk_hub_ok"} <= have else bad)
chk(("  ✓ " if {"desk_me", "desk_hub_ok"} <= have else "") + "the My Desk helpers the office test builds on are present" if {"desk_me", "desk_hub_ok"} <= have else "desk_me / desk_hub_ok are missing (My Desk 463 was not installed): the office read rule cannot be built")
SQLF = os.path.join(ROOT, "op_events_harden_578.sql")
if not os.path.exists(SQLF): bad("op_events_harden_578.sql is not in the reviewed build")
VJ = {}
for fn in FEEDS + EMITTERS:
    sx, mx = fmeta(REF, fn)
    if sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool): VJ[fn] = mx["verify_jwt"]; say(f"  ✓ {fn} is live at version {mx.get('version', '?')} (gateway sign-in check {'on' if VJ[fn] else 'off'}, kept)")
    else: bad(f"{fn} is not live or unreadable: {sx}")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say("  · what changes: the record's shape and rules (one transaction), then " + ", ".join(FEEDS + EMITTERS) + ". Nothing is sent; no switch changes; no existing row changes.")

say(); say("PART 2 · CHANGE")
okr, r_ = sql(REF, open(SQLF).read())
if not okr: bad(f"the record could not be hardened: {r_}"); say("  RESULT: STOPPED. Nothing else was changed. Tell Claude."); done(5)
say("  ✓ the record is hardened: contract columns, indexes, append-only guards, the record_event door, office-only reads")
for fn in FEEDS + EMITTERS:
    if not deploy(REF, FNROOT, fn, VJ[fn]): say("  RESULT: STOPPED. Tell Claude."); done(6)

say(); say("PART 3 · PROOF (nothing is sent; one probe row is written to the record and stays, marked as a probe)")
time.sleep(float(os.environ.get("SB_SETTLE", "6")))
ok_, t1 = sql(REF, "update op_events set summary = summary where id = (select min(id) from op_events)")
chk_ = (not ok_) and ("append-only" in str(t1))
(say if chk_ else bad)(("  ✓ " if chk_ else "") + ("even the project owner cannot rewrite a row (the guard refused it)" if chk_ else f"a row could be rewritten: {t1}"))
ok_, t2 = sql(REF, "delete from op_events where id = (select min(id) from op_events)")
chk_ = (not ok_) and ("append-only" in str(t2))
(say if chk_ else bad)(("  ✓ " if chk_ else "") + ("a row cannot be deleted" if chk_ else f"a row could be deleted: {t2}"))
ok_, gr = sql(REF, "select grantee, string_agg(privilege_type, ',' order by privilege_type) as p from information_schema.role_table_grants where table_schema = 'public' and table_name = 'op_events' and grantee in ('authenticated', 'anon', 'service_role') group by grantee order by 1")
g = {x["grantee"]: x["p"] for x in (gr or [])} if ok_ else {}
(say if g.get("authenticated") == "SELECT" else bad)(("  ✓ " if g.get("authenticated") == "SELECT" else "") + f"pages hold SELECT only on the record (authenticated: {g.get('authenticated', 'nothing')}); anon: {g.get('anon', 'nothing')}; service role: {g.get('service_role', 'nothing')}")
ok_, pol = sql(REF, "select policyname from pg_policies where schemaname = 'public' and tablename = 'op_events' order by 1")
names = {x["policyname"] for x in (pol or [])} if ok_ else set()
(say if names == {"op_events_select_office"} else bad)(("  ✓ " if names == {"op_events_select_office"} else "") + f"the only rule on the record is the office read rule ({', '.join(sorted(names)) or 'none'})")
ok_, probe = sql(REF, "insert into op_events (actor_email, actor_name, actor_kind, actor_id, via, verb, item_id, area, summary, outcome) values ('', 'phase1-slice1-578', 'system', 'desktop-578', 'owner_key', 'record_started', 'op_events', 'admin', 'Slice 1 (578): the record was hardened by the Desktop step', 'done') returning id")
(say if ok_ and probe else bad)(("  ✓ " if ok_ and probe else "") + ("the server side can still append (probe row written, marked as a diagnostic record_started so it never shows in Since You Left)" if ok_ and probe else f"the server side cannot append: {probe}"))
ok_, cols = sql(REF, "select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'op_events' and column_name in ('actor_kind','actor_id','via','action','request_id','approval','outcome','evidence')")
(say if ok_ and cols and cols[0]["n"] == 8 else bad)(("  ✓ " if ok_ and cols and cols[0]["n"] == 8 else "") + "the eight contract columns are there")
ok_, kinds = sql(REF, "select actor_kind, count(*)::int as n from op_events group by 1 order by 1")
if ok_: say("  · rows by actor kind after the backfill: " + ", ".join(f"{x['actor_kind']} {x['n']}" for x in kinds))
NOAUTH = {"apikey": "", "Authorization": "Bearer "}
for fn in FEEDS:
    s_, _ = http("POST", f"{BASE}/functions/v1/{fn}", {}, NOAUTH)
    say(f"  ✓ {fn} refuses a caller with no sign-in ({s_})") if s_ in (401, 403) else bad(f"{fn} answered {s_} without a sign-in")
say("  · tested before deploying: the events helper never signs a job as a person; a Training-platform sign-in is refused by all four feeds; every verb the code writes is in the vocabulary.")
say("  · the Hub page and the Owners Hub Admin page write through the new door once their pull requests are merged (CC Hub, team-hub). Until then their event writes are refused by the database and noted in the browser console only; the server's records are unaffected.")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · Slice 1 is live on the server. Next: Claude merges the CC Hub and Owners Hub pull requests so the pages write through the door.")
say("Rollback: op_events_harden_578_rollback.sql (the 159 rules return; columns stay, harmless); Claude redeploys the previous build of any function.")
done(0)
