#!/usr/bin/env python3
# GATE 2a · THE FACT RECORD · install.
# Part 1 (read only): the SQL and the function are the proven builds; everything the fact record leans on
#   exists with the shapes it expects; not installed yet.
# Part 2: install (one all-or-nothing transaction with its own self-check), then deploy client-fact.
# Part 3: live proof. The "has care begun" rule runs for every Journey without failing (counts only). The door
#   is exercised inside a transaction that is ALWAYS rolled back: a made-up kind of fact is recorded, replaced,
#   and a stale save refused, then everything is undone. Nothing is left behind; nothing real is changed.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt

MIG = open(os.environ["SB_MIGFILE"], "rb").read()
EXPECTED_SHA = os.environ["SB_EXPECTED_SHA"]
FN_DIR = os.environ.get("SB_FNDIR", "")
FN_SHA = os.environ.get("SB_FN_SHA", "")
REPORT = os.environ["SB_REPORT"]
LOCAL = os.environ.get("SB_LOCAL_SOCK")
SKIP_FN = os.environ.get("SB_SKIP_FUNCTION") == "1"
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", "")

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
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "cc-client-fact/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return True, json.loads(r.read().decode(errors="replace"))
    except urllib.error.HTTPError as e:
        return False, "HTTP %s: %s" % (e.code, e.read().decode(errors="replace")[:600])
    except Exception as e:
        return False, "%s: %s" % (type(e).__name__, e)

def http(method, url, body=None):
    req = urllib.request.Request(url, data=body, method=method,
        headers={"Origin": "https://cc.mo-care.com", "Access-Control-Request-Method": "POST", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r: return r.status, dict(r.headers)
    except urllib.error.HTTPError as e: return e.code, dict(e.headers)
    except Exception as e: return None, {"error": str(e)}

say("GATE 2a · THE FACT RECORD · INSTALL")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC") + ("   (DISPOSABLE TEST TARGET)" if LOCAL else ""))
say(); say("PART 1 · READ ONLY")
sha = hashlib.sha256(MIG).hexdigest()
say("  client-fact.sql sha256 " + sha + ("  ✓ the proven build" if sha == EXPECTED_SHA else "  ✗ NOT the proven build"))
if sha != EXPECTED_SHA: say("  STOP. Nothing was run."); done(2)
if not SKIP_FN:
    fsha = hashlib.sha256(open(os.path.join(FN_DIR, "index.ts"), "rb").read()).hexdigest()
    say("  client-fact function sha256 " + fsha + ("  ✓ the reviewed source" if fsha == FN_SHA else "  ✗ differs"))
    if fsha != FN_SHA: say("  STOP. Nothing was run."); done(2)
COL = lambda t, c: f"(select data_type from information_schema.columns where table_schema='public' and table_name='{t}' and column_name='{c}')"
ok, r = sql(f"""select to_regclass('public.journey_episode') is not null as journey, to_regclass('public.episode_range') is not null as ranges,
  to_regclass('public.episode_source') is not null as sources, to_regclass('public.person_source_id') is not null as person_ids,
  to_regclass('public.app_data') is not null as app_data, to_regclass('public.fact_kind') is not null or to_regclass('public.client_fact') is not null as already,
  exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='lead_inquiry_date') as inquiry_date,
  exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='can_access_data_key') as leads_rule,
  {COL('client_queue','id')} as q_id, {COL('client_queue','axiscare_client_id')} as q_ax, {COL('client_queue','added_at')} as q_added,
  {COL('client_queue','first_shift_done')} as q_done, {COL('client_queue','first_shift_done_at')} as q_done_at,
  {COL('launch_evidence','launch_id')} as le_launch, {COL('launch_evidence','fact')} as le_fact, {COL('launch_evidence','source')} as le_source,
  {COL('launch_evidence','evidence')} as le_evidence, {COL('person_source_id','source_id')} as ps_source,
  (select count(*) from public.journey_episode) as journeys, (select count(*) from public.episode_fact) as journey_facts""")
if not ok: say("  ✗ STOP: could not read the database: " + str(r)[:300]); done(3)
r = r[0]
checks = [
  ("the Journey is there (episodes, their dates, their sources) with the person ids", r["journey"] and r["ranges"] and r["sources"] and r["person_ids"] and r["app_data"]),
  ("the inquiry-date helper and the rule for who can read leads exist", r["inquiry_date"] and r["leads_rule"]),
  ("the First shift checklist has what the care-began rule reads (added, first shift done, and when)",
     r["q_added"] is not None and r["q_done"] == "boolean" and r["q_done_at"] is not None and r["q_ax"] == "text"),
  ("its evidence table matches (checklist id, fact, source, evidence)",
     r["le_launch"] is not None and r["le_launch"] == r["q_id"] and r["le_fact"] == "text" and r["le_source"] == "text" and r["le_evidence"] == "jsonb"),
  ("AxisCare ids are text on both sides of the match", r["ps_source"] == "text"),
  ("not installed yet", not r["already"]),
]
for label, good in checks: say(("  ✓ " if good else "  ✗ ") + label)
say(f"  Journeys today: {r['journeys']} · Journey facts: {r['journey_facts']}")
if not all(g for _, g in checks): say("  STOP. Nothing was installed."); done(4)
before = (r["journeys"], r["journey_facts"])

say(); say("PART 2 · INSTALL")
ok, res = sql(MIG.decode())
if not ok: say("  ✗ STOPPED: the install did not complete, nothing changed: " + str(res)[:400]); done(5)
say("  ✓ installed in one transaction; its self-check passed (empty catalog, one door, no browser can write or call it, visitors can't read)")
fn_ok = True
if SKIP_FN: say("  (test target: function deploy skipped)")
else:
    p = subprocess.run([SUPA, "functions", "deploy", "client-fact", "--project-ref", REF, "--use-api"],
                       cwd=os.path.dirname(os.path.dirname(os.path.dirname(FN_DIR))),
                       env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    fn_ok = p.returncode == 0
    say("  client-fact deploy: " + ("✓" if fn_ok else "✗ " + (p.stderr or p.stdout)[-400:]))
    if fn_ok:
        url = f"https://{REF}.supabase.co/functions/v1/client-fact"
        s1, h1 = http("OPTIONS", url); s2, _ = http("POST", url, b"{}")
        cors = s1 == 200 and any(k.lower() == "access-control-allow-origin" for k in h1)
        say("  browser check: " + ("✓ OPTIONS answers with CORS headers" if cors else f"✗ OPTIONS answered {s1}")
            + " · " + ("✓ a call with no sign-in is refused (401)" if s2 == 401 else f"✗ no-sign-in call answered {s2}"))
        fn_ok = cors and s2 == 401

say(); say("PART 3 · LIVE PROOF")
ok, b = sql("""select count(*) filter (where (x.r->>'began') is null) as could_not, count(*) filter (where (x.r->>'began')::boolean) as began,
                      count(*) filter (where (x.r->>'began') = 'false') as not_began
                 from (select public.care_began_for_episode(episode_id) as r from public.journey_episode where state <> 'voided') x""")
b = b[0] if ok else {}
rule_ok = ok and b.get("could_not") == 0
say("  " + (f"✓ the care-began rule ran for every Journey: {b.get('began')} have begun care, {b.get('not_began')} have not, 0 could not be checked" if rule_ok
            else "✗ the care-began rule could not check some Journeys: " + str(b)[:200]))
PROOF = """do $p$ declare ep uuid; r1 jsonb; r2 jsonb; r3 jsonb; r4 jsonb; n int; begin
  select episode_id into ep from public.journey_episode where state <> 'voided' order by created_at limit 1;
  if ep is null then raise exception 'CLIENT_FACT_PROOF no_journey'; end if;
  insert into public.fact_kind (kind, label, fact_group, value_shape, layers) values ('install_proof', 'Install proof', 'proof', 'text', '{current}');
  r1 := public.client_fact_record(ep, 'install_proof', 'current', '"one"'::jsonb, 'reported', 'first', null, null, null, null, 'staff_observation', now(), null, null, 'install-proof');
  r2 := public.client_fact_record(ep, 'install_proof', 'current', '"two"'::jsonb, 'confirmed', 'update', (r1->>'fact_id')::uuid, null, null, null, 'staff_observation', now(), null, null, 'install-proof');
  r3 := public.client_fact_record(ep, 'install_proof', 'current', '"three"'::jsonb, 'confirmed', 'update', (r1->>'fact_id')::uuid, null, null, null, 'staff_observation', now(), null, null, 'install-proof');
  r4 := public.client_fact_record(ep, 'no_such_kind', 'current', '"x"'::jsonb, 'reported', 'first', null, null, null, null, 'staff_observation', now(), null, null, 'install-proof');
  select count(*) into n from public.client_fact_current where kind = 'install_proof' and value = '"two"'::jsonb;
  raise exception 'CLIENT_FACT_PROOF first=% update=% stale=% unknown=% current=%', r1->>'outcome', r2->>'outcome', r3->>'reason', r4->>'reason', n;
end $p$;"""
ok, res = sql(PROOF)
m = re.search(r"CLIENT_FACT_PROOF first=(\w+) update=(\w+) stale=(\w+) unknown=(\w+) current=(\d+)", str(res))
door_ok = bool(m) and m.groups() == ("recorded", "recorded", "stale", "unknown_kind", "1")
say("  " + ("✓ the door recorded a made-up fact, replaced it, refused a stale save and an unknown kind (then all of it was undone)" if door_ok
            else "✗ the door did not behave as proven: " + str(res)[:300]))
ok, a = sql("""select (select count(*) from public.fact_kind) as kinds, (select count(*) from public.client_fact) as facts,
  (select count(*) from public.client_fact_door_audit) as audit, (select count(*) from public.journey_episode) as journeys,
  (select count(*) from public.episode_fact) as journey_facts,
  has_function_privilege('authenticated','public.client_fact_record(uuid,text,text,jsonb,text,text,uuid,text,text,text,text,timestamptz,text,text,text)','execute') as browser_can_call,
  has_table_privilege('authenticated','public.client_fact','insert') as browser_can_insert,
  has_table_privilege('authenticated','public.client_fact_current','select') as staff_can_read,
  has_table_privilege('anon','public.client_fact','select') as anon_can_read""")
a = a[0] if ok else {}
undone = a.get("kinds") == 0 and a.get("facts") == 0 and a.get("audit") == 0 and (a.get("journeys"), a.get("journey_facts")) == before
say("  " + ("✓ nothing was left behind: no kinds, no facts, no door log lines; every Journey untouched" if undone else "✗ something remained: " + json.dumps(a, default=str)))
safe = a.get("browser_can_call") is False and a.get("browser_can_insert") is False and a.get("staff_can_read") is True and a.get("anon_can_read") is False
say("  " + ("✓ security: people who can read leads can read facts; only client-fact can record them; visitors get nothing" if safe else "✗ security: " + json.dumps(a, default=str)))
say()
allok = rule_ok and door_ok and undone and safe and fn_ok
say("RESULT: " + ("INSTALLED · the fact record is ready and empty. Nothing uses it until Gate 3 adds the first kinds of fact." if allok
                  else "CHECK THE ✗ LINES. client-fact-rollback.sql removes it all while no fact exists."))
done(0 if allok else 6)
