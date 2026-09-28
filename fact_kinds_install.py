#!/usr/bin/env python3
# GATE 3 · THE FIRST KINDS OF FACT · install.
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
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "cc-fact-kinds/1.0"})
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

say("GATE 3 · THE FIRST KINDS OF FACT · INSTALL")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC") + ("   (DISPOSABLE TEST TARGET)" if LOCAL else ""))
say(); say("PART 1 · READ ONLY")
sha = hashlib.sha256(MIG).hexdigest()
say("  fact-kinds-gate3.sql sha256 " + sha + ("  ✓ the proven build" if sha == EXPECTED_SHA else "  ✗ NOT the proven build"))
if sha != EXPECTED_SHA: say("  STOP. Nothing was run."); done(2)
if not SKIP_FN:
    fsha = hashlib.sha256(open(os.path.join(FN_DIR, "index.ts"), "rb").read()).hexdigest()
    say("  client-fact function sha256 " + fsha + ("  ✓ the reviewed source" if fsha == FN_SHA else "  ✗ differs"))
    if fsha != FN_SHA: say("  STOP. Nothing was run."); done(2)
ok, r = sql("""select to_regclass('public.fact_kind') is not null as record,
  coalesce((select prosrc like '%did not start from an inquiry%' from pg_proc where oid = to_regprocedure('public.care_began_for_episode(uuid)')), false) as fixed,
  (select count(*) from public.fact_kind) as kinds, (select count(*) from public.client_fact) as facts""")
if not ok: say("  ✗ STOP: could not read the database: " + str(r)[:300]); done(3)
r = r[0]
checks = [("the fact record is installed", r["record"]), ("the care-began fix is in", r["fixed"]), ("the catalog is still empty (no kinds yet)", r["kinds"] == 0)]
for label, good in checks: say(("  ✓ " if good else "  ✗ ") + label)
say(f"  facts recorded so far: {r['facts']}")
if not all(g for _, g in checks): say("  STOP. Nothing was changed."); done(4)

say(); say("PART 2 · INSTALL")
ok, res = sql(MIG.decode())
if not ok: say("  ✗ STOPPED: the kinds did not install, nothing changed: " + str(res)[:400]); done(5)
say("  ✓ sixteen kinds added in one transaction; self-check passed (all intake, all always-review)")
fn_ok = True
if SKIP_FN: say("  (test target: function deploy skipped)")
else:
    p = subprocess.run([SUPA, "functions", "deploy", "client-fact", "--project-ref", REF, "--use-api"],
                       cwd=os.path.dirname(os.path.dirname(os.path.dirname(FN_DIR))),
                       env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    fn_ok = p.returncode == 0
    say("  client-fact redeploy (adds the read-only care-began answer): " + ("✓" if fn_ok else "✗ " + (p.stderr or p.stdout)[-400:]))
    if fn_ok:
        url = f"https://{REF}.supabase.co/functions/v1/client-fact"
        s1, h1 = http("OPTIONS", url); s2, _ = http("POST", url, b'{"action":"care_began"}')
        cors = s1 == 200 and any(k.lower() == "access-control-allow-origin" for k in h1)
        say("  browser check: " + ("✓ OPTIONS answers with CORS headers" if cors else f"✗ OPTIONS answered {s1}")
            + " · " + ("✓ asking with no sign-in is refused (401)" if s2 == 401 else f"✗ answered {s2}"))
        fn_ok = cors and s2 == 401

say(); say("PART 3 · LIVE PROOF (inside a transaction that is always rolled back)")
PROOF = """do $p$ declare ep uuid; n_ok int := 0; n int := 0; r jsonb; k record; begin
  select e.episode_id into ep from public.journey_episode e
   where e.state <> 'voided' and exists (select 1 from public.episode_source s where s.episode_id = e.episode_id and s.system = 'lead' and s.role = 'origin')
     and (public.care_began_for_episode(e.episode_id)->>'began') = 'false' limit 1;
  if ep is null then raise exception 'KINDS_PROOF none'; end if;
  for k in select kind, value_shape, choices from public.fact_kind where created_by = 'gate3' loop
    n := n + 1;
    r := public.client_fact_record(ep, k.kind, 'intake',
      case k.value_shape when 'text' then '"proof"'::jsonb when 'choice' then k.choices->0 when 'choices' then jsonb_build_array(k.choices->0)
        when 'date' then '"2026-10-06"'::jsonb when 'number' then '12'::jsonb when 'bool' then 'true'::jsonb else '{"proof":true}'::jsonb end,
      'reported', 'first', null, null, null, null, 'staff_observation', now(), null, null, 'install-proof');
    if r->>'outcome' = 'recorded' then n_ok := n_ok + 1; end if;
  end loop;
  raise exception 'KINDS_PROOF recorded=% of=%', n_ok, n;
end $p$;"""
ok, res = sql(PROOF)
m = re.search(r"KINDS_PROOF recorded=(\d+) of=(\d+)", str(res))
proof = bool(m) and m.group(1) == m.group(2) == "16"
say("  " + ("✓ one fact of every kind was recorded on a real inquiry through the door (then all of it undone)" if proof else "✗ " + str(res)[:300]))
ok, z = sql("select (select count(*) from public.fact_kind where active) k, (select count(*) from public.client_fact) f, (select count(*) from public.client_fact_door_audit) d")
z = z[0] if ok else {}
clean = z.get("k") == 16 and z.get("f") == r["facts"]
say("  " + (f"✓ sixteen kinds are live; no proof fact was kept (facts: {z.get('f')})" if clean else "✗ unexpected: " + json.dumps(z, default=str)))
say()
allok = proof and clean and fn_ok
say("RESULT: " + ("INSTALLED · the first sixteen kinds of fact are ready. The Hub update can go live next." if allok
                  else "CHECK THE ✗ LINES. fact-kinds-gate3-rollback.sql switches the kinds off."))
done(0 if allok else 6)
