#!/usr/bin/env python3
# Install the Start Contract: migration (sha-checked), start-contract function (sha-checked), then verify.
import json, os, hashlib, subprocess, urllib.request, urllib.error, datetime as dt

MIG = open(os.environ["SB_MIGFILE"], "rb").read()
EXPECTED_SHA = os.environ["SB_EXPECTED_SHA"]
FN_DIR = os.environ.get("SB_FNDIR", "")
FN_SHA = os.environ.get("SB_FN_SHA", "")
REPORT = os.environ["SB_REPORT"]
LOCAL = os.environ.get("SB_LOCAL_SOCK")
SKIP_FN = os.environ.get("SB_SKIP_FUNCTION") == "1"
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
REF = os.environ.get("SB_REF", "")
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
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "cc-start-contract/1.0"})
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

say("START CONTRACT · INSTALL")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC") + ("   (DISPOSABLE TEST TARGET)" if LOCAL else ""))
say()
sha = hashlib.sha256(MIG).hexdigest()
say("  migration sha256 " + sha + ("  ✓ proven build" if sha == EXPECTED_SHA else "  ✗ NOT the proven build"))
if sha != EXPECTED_SHA: say("  STOP. Nothing was run."); done(2)
if not SKIP_FN:
    fsha = hashlib.sha256(open(os.path.join(FN_DIR, "index.ts"), "rb").read()).hexdigest()
    say("  start-contract sha256 " + fsha + ("  ✓ reviewed source" if fsha == FN_SHA else "  ✗ differs"))
    if fsha != FN_SHA: say("  STOP. Nothing was run."); done(2)
COUNTS = """select (select count(*) from journey_episode) as episodes, (select count(*) from episode_fact) as facts,
                   (select count(*) from staffing_need) as needs, (select count(*) from staffing_ask) as asks,
                   (select count(*) from journey_seat_member) as seats"""
ok, b = sql(COUNTS)
if not ok: say("  ✗ STOP: could not read the Journey tables: " + str(b)[:300]); done(3)
before = b[0]
ok, res = sql(MIG.decode())
if not ok: say("  ✗ STOPPED: the migration did not complete (guard or self-check), nothing changed: " + str(res)[:400]); done(4)
say("  ✓ migration committed: Start Contract versions, family updates, audit, two Doors, current view; guard + self-check passed")

fn_ok = True
if SKIP_FN:
    say("  (test target: function deploy skipped)")
else:
    p = subprocess.run([SUPA, "functions", "deploy", "start-contract", "--project-ref", REF, "--use-api"],
                       cwd=os.path.dirname(os.path.dirname(os.path.dirname(FN_DIR))),
                       env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    fn_ok = p.returncode == 0
    say("  start-contract deploy: " + ("✓" if fn_ok else "✗ " + (p.stderr or p.stdout)[-400:]))
    if fn_ok:
        url = f"https://{REF}.supabase.co/functions/v1/start-contract"
        s1, h1 = http("OPTIONS", url)
        s2, _ = http("POST", url, b"{}")
        cors = s1 == 200 and any(k.lower() == "access-control-allow-origin" for k in h1)
        say("  browser check: " + ("✓ OPTIONS answers with CORS headers" if cors else f"✗ OPTIONS answered {s1}")
            + " · " + ("✓ a call with no sign-in is refused (401)" if s2 == 401 else f"✗ no-sign-in call answered {s2}"))
        fn_ok = cors and s2 == 401

ok, v = sql("""select has_function_privilege('authenticated','public.start_contract_record(uuid,text,date,text,text,text,date,text,date,text,text,text)','execute')
                        or has_function_privilege('authenticated','public.start_contract_update_record(uuid,timestamptz,text,text,text,date,text,text,text)','execute') as browser_can_call,
                      has_table_privilege('authenticated','public.start_contract_version','insert')
                        or has_table_privilege('authenticated','public.start_contract_update','insert') as browser_can_insert,
                      has_table_privilege('authenticated','public.start_contract_current','select') as staff_can_read,
                      has_table_privilege('anon','public.start_contract_current','select')
                        or has_table_privilege('anon','public.start_contract_version','select') as anon_can_read,
                      (select count(*) from public.start_contract_version) as contracts,
                      (select count(*) from public.start_contract_update) as updates""")
v = v[0] if ok else {}
safe = v.get("browser_can_call") is False and v.get("browser_can_insert") is False and v.get("staff_can_read") is True and v.get("anon_can_read") is False
say("  security: " + ("✓ signed-in staff can read; only the function can write; anonymous gets nothing" if safe else "✗ " + json.dumps(v)))
ok, a = sql(COUNTS)
after = a[0] if ok else {}
unchanged = after == before
say("  " + ("✓ no Journey, fact, staffing need, ask or seat was created or changed" if unchanged else "✗ counts changed: " + json.dumps(before) + " -> " + json.dumps(after)))
say(f"  Start Contracts: {v.get('contracts')} · family updates: {v.get('updates')} (none yet; they are recorded in the hub)")
ok, m = sql("select string_agg(distinct email, ', ' order by email) as who from public.journey_seat_member")
say("  who can record them (Journey seat holders): " + ((m[0].get("who") or "nobody yet") if ok and m else "?"))
say()
allok = safe and unchanged and fn_ok and v.get("contracts") == 0
say("RESULT: " + ("INSTALLED · the hub update can go live next" if allok else "CHECK THE ✗ LINES"))
done(0 if allok else 6)
