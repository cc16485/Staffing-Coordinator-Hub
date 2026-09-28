#!/usr/bin/env python3
# GATE 4b · PEOPLE GOING INTO CARE · install.
# Part 1 (read only): the SQL and both functions are the reviewed builds; the Family Circle tables, the link door
#   and Gate 4a's people are in; the circle tables hold no required column the door would leave empty; not
#   installed yet. Counts only.
# Part 2: install (one all-or-nothing transaction with its own self-check), then deploy family-circles (adds
#   "carry" and the "sent to AxisCare" notes) and client-convert (no longer writes Responsible Party 1).
# Part 3: live proof inside a transaction that is ALWAYS rolled back: on a real converted inquiry, the client is
#   added to a Family Circle (texts off), the caller without a recorded yes is refused, a made-up "who" is refused;
#   then everything is undone. Nothing is left behind; nothing real is changed; no names are printed.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt

MIG = open(os.environ["SB_MIGFILE"], "rb").read()
EXPECTED_SHA = os.environ["SB_EXPECTED_SHA"]
FNROOT = os.environ.get("SB_FNROOT", "")                     # .../supabase/functions
FN_SHAS = json.loads(os.environ.get("SB_FN_SHAS", "{}"))    # {"family-circles": sha, "client-convert": sha}
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
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "cc-people-into-care/1.0"})
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

say("GATE 4b · PEOPLE GOING INTO CARE · INSTALL")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC") + ("   (DISPOSABLE TEST TARGET)" if LOCAL else ""))
say(); say("PART 1 · READ ONLY")
sha = hashlib.sha256(MIG).hexdigest()
say("  people-into-care.sql sha256 " + sha + ("  ✓ the proven build" if sha == EXPECTED_SHA else "  ✗ NOT the proven build"))
if sha != EXPECTED_SHA: say("  STOP. Nothing was run."); done(2)
if not SKIP_FN:
    for fn, want in FN_SHAS.items():
        got = hashlib.sha256(open(os.path.join(FNROOT, fn, "index.ts"), "rb").read()).hexdigest()
        say(f"  {fn} function sha256 {got}" + ("  ✓ the reviewed source" if got == want else "  ✗ differs"))
        if got != want: say("  STOP. Nothing was run."); done(2)
ok, r = sql("""select to_regclass('public.care_circles') is not null as circles, to_regclass('public.circle_contacts') is not null as members,
  to_regclass('public.journey_person_current') is not null as people, to_regprocedure('public.family_circle_link(text,text,text,text)') is not null as link_door,
  exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='can_access_data_key') as leads_rule,
  exists (select 1 from information_schema.columns where table_schema='public' and table_name='circle_contacts' and column_name='carried_from') as already,
  (select count(*) from information_schema.columns where table_schema='public' and table_name='circle_contacts'
     and column_name in ('circle_id','name','relationship','phone','email','sms_consent','is_primary','source','axiscare_list_number')) as member_cols,
  (select string_agg(column_name, ', ') from information_schema.columns where table_schema='public' and table_name='circle_contacts'
     and is_nullable='NO' and column_default is null and column_name not in ('circle_id','name')) as member_required_extra,
  (select string_agg(column_name, ', ') from information_schema.columns where table_schema='public' and table_name='care_circles'
     and is_nullable='NO' and column_default is null and column_name <> 'client_name') as circle_required_extra""")
if not ok: say("  ✗ STOP: could not read the database: " + str(r)[:300]); done(3)
r = r[0]
checks = [("the Family Circle tables and their link door are installed", r["circles"] and r["members"] and r["link_door"]),
          ("Gate 4a (people on the Journey) is installed", r["people"]), ("the rule for who can read leads exists", r["leads_rule"]),
          ("circle members have the columns the door fills", r["member_cols"] == 9),
          ("no other required column the door would leave empty", not r["member_required_extra"] and not r["circle_required_extra"]),
          ("not installed yet", not r["already"])]
for label, good in checks: say(("  ✓ " if good else "  ✗ ") + label)
if r["member_required_extra"] or r["circle_required_extra"]: say("    required and not filled: " + str(r["member_required_extra"] or "") + " " + str(r["circle_required_extra"] or ""))
ok, n = sql("select (select count(*) from public.care_circles where active is true) circles, (select count(*) from public.circle_contacts) members")
if ok: say(f"  Family Circles today: {n[0]['circles']} · members: {n[0]['members']}")
if not all(g for _, g in checks): say("  STOP. Nothing was changed."); done(4)
say(); say("PART 2 · INSTALL")
ok, res = sql(MIG.decode())
if not ok: say("  ✗ STOPPED: the install did not complete, nothing changed: " + str(res)[:400]); done(5)
say("  ✓ installed in one transaction; its self-check passed (one door, no browser can call it, the log is append-only)")
fn_ok = True
if SKIP_FN: say("  (test target: function deploys skipped)")
else:
    for fn, what, probe in (("family-circles", "adds 'People going into care' and the 'sent to AxisCare' notes", b'{"action":"carry"}'),
                            ("client-convert", "no longer writes Responsible Party 1", b'{"action":"preview"}')):
        p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"],
                           cwd=os.path.dirname(os.path.dirname(FNROOT)), env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
        good = p.returncode == 0
        say(f"  {fn} redeploy ({what}): " + ("✓" if good else "✗ " + (p.stderr or p.stdout)[-400:]))
        if good:
            url = f"https://{REF}.supabase.co/functions/v1/{fn}"
            s1, h1 = http("OPTIONS", url); s2, _ = http("POST", url, probe)
            cors = s1 == 200 and any(k.lower() == "access-control-allow-origin" for k in h1)
            say("    browser check: " + ("✓ OPTIONS answers with CORS headers" if cors else f"✗ OPTIONS answered {s1}") + " · " + ("✓ no sign-in is refused (401)" if s2 == 401 else f"✗ answered {s2}"))
            good = cors and s2 == 401
        fn_ok = fn_ok and good
say(); say("PART 3 · LIVE PROOF (inside a transaction that is always rolled back)")
PROOF = """do $p$ declare lid text; a jsonb; b jsonb; c jsonb; n int; s int; begin
  select e->>'id' into lid from public.app_data d, jsonb_array_elements(d.data) e
   where d.key = 'leads' and coalesce(e->>'axiscare_client_id','') ~ '^\\d+$'
     and exists (select 1 from public.person_source_id x where x.system='axiscare' and x.entity_type='client' and x.source_id = e->>'axiscare_client_id')
   order by (coalesce(e->>'client_phone','') <> '' or lower(coalesce(e->>'relationship','')) = 'self') desc limit 1;
  if lid is null then raise exception 'CARE_PROOF none'; end if;
  a := public.people_into_care_add(lid, 'client', null, 'install-proof');
  b := public.people_into_care_add(lid, 'caller', null, 'install-proof');
  c := public.people_into_care_add(lid, 'cousin', null, 'install-proof');
  select count(*), count(*) filter (where sms_consent is false) into n, s from public.circle_contacts where carried_by = 'install-proof';
  raise exception 'CARE_PROOF client=% caller=% who=% added=% texts_off=%', coalesce(a->>'reason', a->>'outcome'), coalesce(b->>'reason', b->>'outcome'), c->>'reason', n, s;
end $p$;"""
ok, res = sql(PROOF)
m = re.search(r"CARE_PROOF client=(\w+) caller=(\w+) who=(\w+) added=(\d+) texts_off=(\d+)", str(res))
if m:
    cl, ca, wh, n, s = m.groups()
    client_ok = (cl == "added" and n == "1" and s == "1") or (cl in ("no_way_to_reach", "name_required") and n == "0")
    caller_ok = ca in ("permission_needed", "caller_is_the_client", "no_journey")
    proof = client_ok and caller_ok and wh == "invalid_who"
    say("  " + ("✓ " if client_ok else "✗ ") + ("the client was added to their Family Circle with texts off" if cl == "added" else f"the client could not be added ({cl.replace('_', ' ')}), as the rules say") + " (then undone)")
    say("  " + ("✓ " if caller_ok else "✗ ") + f"the caller was refused ({ca.replace('_', ' ')}): family need a recorded yes first")
    say("  " + ("✓ " if wh == "invalid_who" else "✗ ") + "a made-up kind of person was refused")
else:
    proof = False; say("  ✗ " + str(res)[:300])
ok, z = sql("""select (select count(*) from public.circle_contacts where carried_from is not null) carried, (select count(*) from public.people_into_care_audit) log,
  has_function_privilege('authenticated','public.people_into_care_add(text,text,uuid,text)','execute') browser_can_call,
  has_function_privilege('anon','public.people_into_care_add(text,text,uuid,text)','execute') anon_can_call,
  has_table_privilege('anon','public.people_into_care_audit','select') anon_can_read""")
z = z[0] if ok else {}
clean = z.get("carried") == 0 and z.get("log") == 0
safe = z.get("browser_can_call") is False and z.get("anon_can_call") is False and z.get("anon_can_read") is False
say("  " + ("✓ nothing was left behind (no circle member, no log line)" if clean else "✗ something remained: " + json.dumps(z, default=str)))
say("  " + ("✓ security: only family-circles can add people this way; browsers and visitors cannot" if safe else "✗ security: " + json.dumps(z, default=str)))
say()
allok = proof and clean and safe and fn_ok
say("RESULT: " + ("INSTALLED · people can go into care from the profile. The Hub update can go live next." if allok else "CHECK THE ✗ LINES. people-into-care-rollback.sql removes the door (circle notes are kept)."))
done(0 if allok else 6)
