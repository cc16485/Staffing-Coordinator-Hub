#!/usr/bin/env python3
# GATE 4a · PEOPLE ON THE JOURNEY · install.
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
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "cc-journey-people/1.0"})
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

say("GATE 4a · PEOPLE ON THE JOURNEY · INSTALL")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC") + ("   (DISPOSABLE TEST TARGET)" if LOCAL else ""))
say(); say("PART 1 · READ ONLY")
sha = hashlib.sha256(MIG).hexdigest()
say("  journey-people.sql sha256 " + sha + ("  ✓ the proven build" if sha == EXPECTED_SHA else "  ✗ NOT the proven build"))
if sha != EXPECTED_SHA: say("  STOP. Nothing was run."); done(2)
if not SKIP_FN:
    fsha = hashlib.sha256(open(os.path.join(FN_DIR, "index.ts"), "rb").read()).hexdigest()
    say("  client-fact function sha256 " + fsha + ("  ✓ the reviewed source" if fsha == FN_SHA else "  ✗ differs"))
    if fsha != FN_SHA: say("  STOP. Nothing was run."); done(2)
ok, r = sql("""select to_regclass('public.journey_episode') is not null as journey, to_regclass('public.fact_kind') is not null as facts,
  exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='can_access_data_key') as leads_rule,
  to_regclass('public.journey_person') is not null as already, (select count(*) from public.journey_episode) as journeys""")
if not ok: say("  ✗ STOP: could not read the database: " + str(r)[:300]); done(3)
r = r[0]
checks = [("the Journey and the fact record are installed", r["journey"] and r["facts"]), ("the rule for who can read leads exists", r["leads_rule"]), ("not installed yet", not r["already"])]
for label, good in checks: say(("  ✓ " if good else "  ✗ ") + label)
say(f"  Journeys today: {r['journeys']}")
if not all(g for _, g in checks): say("  STOP. Nothing was changed."); done(4)
say(); say("PART 2 · INSTALL")
ok, res = sql(MIG.decode())
if not ok: say("  ✗ STOPPED: the install did not complete, nothing changed: " + str(res)[:400]); done(5)
say("  ✓ installed in one transaction; its self-check passed (one door, no browser can write or call it, visitors can't read)")
fn_ok = True
if SKIP_FN: say("  (test target: function deploy skipped)")
else:
    p = subprocess.run([SUPA, "functions", "deploy", "client-fact", "--project-ref", REF, "--use-api"],
                       cwd=os.path.dirname(os.path.dirname(os.path.dirname(FN_DIR))), env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    fn_ok = p.returncode == 0
    say("  client-fact redeploy (adds 'record a person'): " + ("✓" if fn_ok else "✗ " + (p.stderr or p.stdout)[-400:]))
    if fn_ok:
        url = f"https://{REF}.supabase.co/functions/v1/client-fact"
        s1, h1 = http("OPTIONS", url); s2, _ = http("POST", url, b'{"action":"record_person"}')
        cors = s1 == 200 and any(k.lower() == "access-control-allow-origin" for k in h1)
        say("  browser check: " + ("✓ OPTIONS answers with CORS headers" if cors else f"✗ OPTIONS answered {s1}") + " · " + ("✓ no sign-in is refused (401)" if s2 == 401 else f"✗ answered {s2}"))
        fn_ok = cors and s2 == 401
say(); say("PART 3 · LIVE PROOF (inside a transaction that is always rolled back)")
PROOF = """do $p$ declare ep uuid; a jsonb; b jsonb; c jsonb; d jsonb; n int; begin
  select e.episode_id into ep from public.journey_episode e
   where e.state <> 'voided' and exists (select 1 from public.episode_source s where s.episode_id = e.episode_id and s.system = 'lead' and s.role = 'origin') limit 1;
  if ep is null then raise exception 'PEOPLE_PROOF none'; end if;
  a := public.people_on_journey_record(ep, null, false, 'Install Proof', 'other', null, '{emergency}', null, null, null, null, 'not_asked', null, null, 'first', null, null, 'install-proof');
  b := public.people_on_journey_record(ep, (a->>'person_key')::uuid, false, 'Install Proof', 'other', null, '{emergency,billing}', null, null, null, null, 'yes', 'install-proof', now(), 'update', (a->>'row_id')::uuid, null, 'install-proof');
  c := public.people_on_journey_record(ep, (a->>'person_key')::uuid, false, 'Install Proof', 'other', null, '{primary}', null, null, null, null, 'not_asked', null, null, 'update', (a->>'row_id')::uuid, null, 'install-proof');
  d := public.people_on_journey_record(ep, null, false, 'X', null, null, '{boss}', null, null, null, null, null, null, null, 'first', null, null, 'install-proof');
  select count(*) into n from public.journey_person_current where episode_id = ep and name = 'Install Proof';
  raise exception 'PEOPLE_PROOF add=% update=% stale=% role=% current=%', a->>'outcome', b->>'outcome', c->>'reason', d->>'reason', n;
end $p$;"""
ok, res = sql(PROOF)
m = re.search(r"PEOPLE_PROOF add=(\w+) update=(\w+) stale=(\w+) role=(\w+) current=(\d+)", str(res))
proof = bool(m) and m.groups() == ("recorded", "recorded", "stale", "invalid_role", "1")
say("  " + ("✓ a made-up person was added to a real inquiry, given roles and permission, a stale edit and a made-up role refused (then all undone)" if proof else "✗ " + str(res)[:300]))
ok, z = sql("""select (select count(*) from public.journey_person) p, (select count(*) from public.journey_person_door_audit) d,
  has_function_privilege('authenticated','public.people_on_journey_record(uuid,uuid,boolean,text,text,text,text[],text,text,text,text,text,text,timestamptz,text,uuid,text,text)','execute') browser_can_call,
  has_table_privilege('authenticated','public.journey_person_current','select') staff_can_read, has_table_privilege('anon','public.journey_person','select') anon_can_read""")
z = z[0] if ok else {}
clean = z.get("p") == 0 and z.get("d") == 0
safe = z.get("browser_can_call") is False and z.get("staff_can_read") is True and z.get("anon_can_read") is False
say("  " + ("✓ nothing was left behind (no people, no door log lines)" if clean else "✗ something remained: " + json.dumps(z, default=str)))
say("  " + ("✓ security: people who can read leads can read people; only client-fact can record them; visitors get nothing" if safe else "✗ security: " + json.dumps(z, default=str)))
say()
allok = proof and clean and safe and fn_ok
say("RESULT: " + ("INSTALLED · people can be recorded on a family's Journey. The Hub update can go live next." if allok else "CHECK THE ✗ LINES. journey-people-rollback.sql removes it while nobody is recorded."))
done(0 if allok else 6)
