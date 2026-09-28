#!/usr/bin/env python3
# GATE 2a FIX · "has care begun" no longer reads an inquiry's date as care.
# Part 1 (read only): proven build; the rule is installed; counts before (by where each Journey came from).
# Part 2: replace the one function (one transaction, self-check). No table, fact or Journey changes.
# Part 3: counts after, and a rolled-back proof that an intake fact can be recorded on an inquiry that has
#   not started care. Only counts are printed.
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
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "cc-care-began-fix/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=300) as r: return True, json.loads(r.read().decode(errors="replace"))
    except urllib.error.HTTPError as e: return False, "HTTP %s: %s" % (e.code, e.read().decode(errors="replace")[:600])
    except Exception as e: return False, "%s: %s" % (type(e).__name__, e)

COUNTS = """select count(*) filter (where o and (r->>'began')::boolean) as inquiry_began, count(*) filter (where o and (r->>'began') = 'false') as inquiry_not,
  count(*) filter (where not o and (r->>'began')::boolean) as other_began, count(*) filter (where not o and (r->>'began') = 'false') as other_not,
  count(*) filter (where (r->>'began') is null) as could_not
  from (select public.care_began_for_episode(e.episode_id) r,
               exists (select 1 from public.episode_source s where s.episode_id = e.episode_id and s.system = 'lead' and s.role = 'origin') o
          from public.journey_episode e where e.state <> 'voided') x"""
say("GATE 2a FIX · HAS CARE BEGUN · INSTALL")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC") + ("   (DISPOSABLE TEST TARGET)" if LOCAL else ""))
say(); say("PART 1 · READ ONLY")
sha = hashlib.sha256(MIG).hexdigest()
say("  client-fact-care-began-fix.sql sha256 " + sha + ("  ✓ the proven build" if sha == EXPECTED_SHA else "  ✗ NOT the proven build"))
if sha != EXPECTED_SHA: say("  STOP. Nothing was run."); done(2)
ok, r = sql("""select to_regprocedure('public.care_began_for_episode(uuid)') is not null as has_rule,
  (select prosrc like '%did not start from an inquiry%' from pg_proc where oid = to_regprocedure('public.care_began_for_episode(uuid)')) as already,
  (select count(*) from public.client_fact) as facts""")
if not ok: say("  ✗ STOP: could not read the database: " + str(r)[:300]); done(3)
r = r[0]
checks = [("the fact record and its care-began rule are installed", r["has_rule"]), ("the fix isn't in yet", not r["already"])]
for label, good in checks: say(("  ✓ " if good else "  ✗ ") + label)
if not all(g for _, g in checks): say("  STOP. Nothing was changed."); done(4)
ok, b = sql(COUNTS); b = b[0] if ok else {}
say(f"  before: Journeys from an inquiry: {b.get('inquiry_began')} 'care began', {b.get('inquiry_not')} not · other Journeys: {b.get('other_began')} began, {b.get('other_not')} not")

say(); say("PART 2 · INSTALL")
ok, res = sql(MIG.decode())
if not ok: say("  ✗ STOPPED: the fix did not install, nothing changed: " + str(res)[:400]); done(5)
say("  ✓ the rule was replaced in one transaction; its self-check passed (still unreachable from a browser)")

say(); say("PART 3 · LIVE PROOF")
ok, a = sql(COUNTS); a = a[0] if ok else {}
counted = ok and a.get("could_not") == 0 and a.get("other_began") == b.get("other_began") and a.get("inquiry_began", 99) <= b.get("inquiry_began", 0)
say("  " + (f"✓ after: Journeys from an inquiry: {a.get('inquiry_began')} have begun care (a real first shift), {a.get('inquiry_not')} have not · other Journeys unchanged ({a.get('other_began')} began) · 0 could not be checked"
            if counted else "✗ unexpected counts: " + json.dumps(a, default=str)))
PROOF = """do $p$ declare ep uuid; r1 jsonb; begin
  select e.episode_id into ep from public.journey_episode e
   where e.state <> 'voided' and exists (select 1 from public.episode_source s where s.episode_id = e.episode_id and s.system = 'lead' and s.role = 'origin')
     and (public.care_began_for_episode(e.episode_id)->>'began') = 'false' limit 1;
  if ep is null then raise exception 'CARE_FIX_PROOF none'; end if;
  insert into public.fact_kind (kind, label, fact_group, value_shape, layers) values ('install_proof', 'Install proof', 'proof', 'text', '{intake}');
  r1 := public.client_fact_record(ep, 'install_proof', 'intake', '"one"'::jsonb, 'reported', 'first', null, null, null, null, 'staff_observation', now(), null, null, 'install-proof');
  raise exception 'CARE_FIX_PROOF %', coalesce(r1->>'outcome','?') || ':' || coalesce(r1->>'reason','');
end $p$;"""
ok, res = sql(PROOF)
m = re.search(r"CARE_FIX_PROOF (\S+)", str(res))
proof = bool(m) and m.group(1).startswith("recorded")
none = bool(m) and m.group(1) == "none"
say("  " + ("✓ an intake fact can be recorded on an inquiry that hasn't started care (then undone)" if proof
            else "○ no inquiry without a first shift exists to try it on" if none else "✗ " + str(res)[:300]))
ok, z = sql("select (select count(*) from public.fact_kind) k, (select count(*) from public.client_fact) f, (select count(*) from public.client_fact_door_audit) d")
z = z[0] if ok else {}
clean = z.get("k") == 0 and z.get("f") == 0 and z.get("d") == 0
say("  " + ("✓ nothing was left behind (no kinds, facts or door log lines)" if clean else "✗ something remained: " + json.dumps(z, default=str)))
say()
allok = counted and (proof or none) and clean
say("RESULT: " + ("FIXED · an inquiry's own date no longer counts as care; only a real first shift, or a client already in care, does." if allok else "CHECK THE ✗ LINES"))
done(0 if allok else 6)
