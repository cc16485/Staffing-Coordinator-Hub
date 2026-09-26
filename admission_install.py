#!/usr/bin/env python3
# Install the client-admission migration, deploy + run client-admission-scan once,
# and report the open admission cases. Creates NO person and NO identity link.
import json, os, hashlib, subprocess, urllib.request, urllib.error, datetime as dt

MIG = open(os.environ["SB_MIGFILE"], "rb").read()
EXPECTED_SHA = os.environ["SB_EXPECTED_SHA"]
FN_DIR = os.environ.get("SB_FNDIR", "")
FN_EXPECTED_SHA = os.environ.get("SB_FN_SHA", "")
REPORT = os.environ["SB_REPORT"]
LOCAL = os.environ.get("SB_LOCAL_SOCK")
SKIP_FN = os.environ.get("SB_SKIP_FUNCTION") == "1"
SKIP_MIG = os.environ.get("SB_SKIP_MIGRATION") == "1"   # rerun the scan against an already-verified install
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
REF = os.environ.get("SB_REF", "")
SUPA = os.environ.get("SB_SUPA_CLI", "")

lines = []
def say(s=""): print(s); lines.append(s)
def done(code):
    open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)

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
    return api("POST", f"/v1/projects/{REF}/database/query", {"query": q})

def api(method, path, body=None, base="https://api.supabase.com", auth=None):
    req = urllib.request.Request(base + path, method=method,
        data=(json.dumps(body).encode() if body is not None else None),
        headers={"Authorization": "Bearer " + (auth or TOKEN), "Content-Type": "application/json",
                 "User-Agent": "cc-client-admission/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return True, json.loads(r.read().decode(errors="replace") or "null")
    except urllib.error.HTTPError as e:
        return False, "HTTP %s: %s" % (e.code, e.read().decode(errors="replace")[:600])
    except Exception as e:
        return False, "%s: %s" % (type(e).__name__, e)

def one(q):
    ok, r = sql(q)
    return r[0] if ok and r else {"_error": r}

SNAPSHOT = """select (select count(*) from person_identity) as persons,
                     (select count(*) from person_source_id) as links,
                     (select count(*) from person_role) as roles,
                     (select count(*) from journey_episode) as episodes,
                     (select count(*) from episode_fact) as facts"""

say("CLIENT ADMISSION · INSTALL + FIRST SCAN")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC") + ("   (DISPOSABLE TEST TARGET)" if LOCAL else ""))
say("Installs the human-confirmed admission path and opens cases for Active AxisCare clients")
say("with no Hub person. It creates no person and no identity link; a person confirms each case later.")
say()

say("== 1. ARTIFACTS ====================================================")
sha = hashlib.sha256(MIG).hexdigest()
if SKIP_MIG:
    say("  migration already installed and verified; not rerun")
else:
    say("  migration sha256 " + sha + ("  ✓ matches the proven build" if sha == EXPECTED_SHA else "  ✗ NOT the proven build"))
    if sha != EXPECTED_SHA:
        say("  STOP. Nothing was run."); done(2)
if not SKIP_FN:
    fsha = hashlib.sha256(open(os.path.join(FN_DIR, "index.ts"), "rb").read()).hexdigest()
    say("  scan function sha256 " + fsha + ("  ✓ matches the reviewed source" if fsha == FN_EXPECTED_SHA else "  ✗ differs"))
    if fsha != FN_EXPECTED_SHA:
        say("  STOP. Nothing was run."); done(2)
say()

before = one(SNAPSHOT)
say("== 2. BEFORE =======================================================")
say("  " + json.dumps(before, default=str))
if "_error" in before: say("  STOP: could not read the starting state. Nothing was run."); done(3)
say()

say("== 3. MIGRATION ====================================================")
if SKIP_MIG:
    say("  skipped (already installed); checking the install instead")
else:
    ok, res = sql(MIG.decode())
    if not ok:
        say("  ✗ STOPPED. The migration did not complete (guard or self-check): " + str(res)[:500])
        say("  Nothing was repaired or retried."); done(4)
    say("  ✓ committed; guard and self-check passed")
v = one("""select (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                    where n.nspname='public' and p.proname in ('client_admission_open','client_admission_confirm','client_admission_dismiss')) as doors,
                  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                    where n.nspname='public' and p.proname like 'client\\_admission\\_%' escape '\\' and p.prosecdef) as definer,
                  (select relrowsecurity from pg_class where oid='public.client_admission_case'::regclass) as rls,
                  has_table_privilege('anon','public.client_admission_case','select') as anon_read,
                  has_function_privilege('authenticated','public.client_admission_confirm(uuid,text,text,text,uuid,text,text)','execute') as auth_exec,
                  obj_description('public.client_admission_case'::regclass,'pg_class') as marker""")
inst_ok = v.get("doors") == 3 and v.get("definer") == 0 and v.get("rls") is True and v.get("anon_read") is False and v.get("auth_exec") is False
say("  verification: " + ("✓ 3 Doors, caller privileges, RLS on, no anonymous read, browser cannot confirm · " + str(v.get("marker"))
                           if inst_ok else "✗ " + json.dumps(v, default=str)))
say()

say("== 4. FIRST SCAN ===================================================")
scan_ok = True
if SKIP_FN:
    say("  (test target: function deploy and call skipped)")
else:
    p = subprocess.run([SUPA, "functions", "deploy", "client-admission-scan", "--project-ref", REF, "--use-api"],
                       cwd=os.path.dirname(os.path.dirname(os.path.dirname(FN_DIR))),
                       env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    say("  deploy: " + ("✓" if p.returncode == 0 else "✗ " + (p.stderr or p.stdout)[-400:]))
    if p.returncode != 0:
        scan_ok = False
    else:
        ok, keys = api("GET", f"/v1/projects/{REF}/api-keys")
        svc = next((k.get("api_key", "") for k in (keys or []) if isinstance(k, dict) and k.get("name") == "service_role"), "") if ok else ""
        if not svc:
            say("  ✗ could not read the service key: " + str(keys)[:200]); scan_ok = False
        else:
            ok, out = api("POST", "/functions/v1/client-admission-scan", {}, base=f"https://{REF}.supabase.co", auth=svc)
            if not ok:
                say("  ✗ scan failed: " + str(out)[:400]); scan_ok = False
            else:
                say(f"  ✓ scan ran: {out.get('active')} Active in the census, {out.get('unlinked')} with no Hub person")
                for r in out.get("results", []):
                    say(f"    AxisCare {r.get('axiscare_client_id')}: {r.get('outcome')}")
say()

say("== 5. OPEN ADMISSION CASES (for Client Intake to confirm) ==========")
ok, cases = sql("""select case_id::text, axiscare_client_id, coalesce(axiscare_name,'(no name from AxisCare)') as name,
                          observed_label, observed_at::text, needs_owner_decision, suggestions
                     from client_admission_case where status = 'open' order by opened_at""")
if ok:
    if not cases: say("  none")
    for c in cases:
        sug = c["suggestions"] if isinstance(c["suggestions"], list) else json.loads(c["suggestions"] or "[]")
        say(f"  case {c['case_id']}")
        say(f"    AxisCare client {c['axiscare_client_id']} · {c['name']} · {c['observed_label']} (observed {c['observed_at']})")
        say("    suggested matches: " + (", ".join(f"{s.get('display_name')} [{s.get('strength')}, phone …{s.get('phone_last4')}]" for s in sug)
                                         if sug else "none — likely a new person"))
        say("    a suggestion is NOT a match; a person must confirm")
else:
    say("  ✗ " + str(cases)[:300])
say()

after = one(SNAPSHOT)
same = all(after.get(k) == before.get(k) for k in ("persons", "links", "roles", "episodes", "facts"))
say("== 6. NOTHING RESOLVED AUTOMATICALLY ===============================")
say("  after: " + json.dumps(after, default=str))
say("  " + ("✓ no person, link, role or Journey row was created" if same else "✗ identity or Journey counts changed"))
say()
allok = inst_ok and scan_ok and same and ok
say("RESULT: " + ("INSTALLED · cases open for confirmation" if allok else "CHECK THE ✗ LINES"))
done(0 if allok else 5)
