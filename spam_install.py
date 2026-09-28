#!/usr/bin/env python3
# LEAD NUMBERS S1 · MARK AS SPAM · install.
# Part 1 (read only): the SQL and reports-rollup are the reviewed builds; the lead mirror is the duplicate-folding
#   version and not yet the spam one; no trigger on the tables the proof touches can call outside the database.
#   Also reads (never calls) the settings of the lead-reconcile function, a separate finding.
# Part 2: install the spam rule into the lead mirror (one transaction, own self-check); redeploy reports-rollup
#   (owners' lead totals leave spam out).
# Part 3: live proof inside ONE transaction that is ALWAYS rolled back: a made-up inquiry gets its Journey, is marked
#   spam a week ago and the mirror voids that Journey; a made-up inquiry marked spam today never gets one. Then undone.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt

MIG = open(os.environ["SB_MIGFILE"], "rb").read()
EXPECTED_SHA = os.environ["SB_EXPECTED_SHA"]
FNROOT = os.environ.get("SB_FNROOT", "")
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
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "cc-spam-install/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=300) as r: return True, json.loads(r.read().decode(errors="replace"))
    except urllib.error.HTTPError as e: return False, "HTTP %s: %s" % (e.code, e.read().decode(errors="replace")[:600])
    except Exception as e: return False, "%s: %s" % (type(e).__name__, e)
def api_get(path):
    req = urllib.request.Request(f"https://api.supabase.com/v1/projects/{REF}{path}", headers={"Authorization": "Bearer " + TOKEN, "User-Agent": "cc-spam-install/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r: return r.status, json.loads(r.read().decode(errors="replace"))
    except urllib.error.HTTPError as e: return e.code, None
    except Exception: return None, None
def http(method, url, body=None):
    req = urllib.request.Request(url, data=body, method=method,
        headers={"Origin": "https://hub.mo-care.com", "Access-Control-Request-Method": "POST", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r: return r.status, dict(r.headers)
    except urllib.error.HTTPError as e: return e.code, dict(e.headers)
    except Exception as e: return None, {"error": str(e)}

say("LEAD NUMBERS S1 · MARK AS SPAM · INSTALL")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC") + ("   (DISPOSABLE TEST TARGET)" if LOCAL else ""))
say(); say("PART 1 · READ ONLY")
sha = hashlib.sha256(MIG).hexdigest()
say("  lead-journey-spam.sql sha256 " + sha + ("  ✓ the proven build" if sha == EXPECTED_SHA else "  ✗ NOT the proven build"))
if sha != EXPECTED_SHA: say("  STOP. Nothing was run."); done(2)
if not SKIP_FN:
    got = hashlib.sha256(open(os.path.join(FNROOT, "reports-rollup", "index.ts"), "rb").read()).hexdigest()
    say("  reports-rollup function sha256 " + got + ("  ✓ the reviewed source" if got == FN_SHA else "  ✗ differs"))
    if got != FN_SHA: say("  STOP. Nothing was run."); done(2)
ok, r = sql("""select position('lead_fold_live' in m.prosrc) > 0 as fold_version, position('lead_spam' in m.prosrc) > 0 as already,
  to_regprocedure('public.episode_void(uuid,text,uuid,text,text,text)') is not null as void_door,
  (select count(*) from public.app_data d, jsonb_array_elements(case when jsonb_typeof(d.data)='array' then d.data else '[]' end) e
     where d.key='leads' and jsonb_typeof(e->'spam')='object') as spam_now,
  (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace join pg_proc p on p.oid=t.tgfoid
     where not t.tgisinternal and n.nspname='public' and c.relname in ('app_data','journey_episode','episode_source','episode_door_audit')
       and p.prosrc ~* '(net\\.|http|supabase_functions|pg_notify|dblink)') as outbound_triggers
  from pg_proc m where m.oid = 'public.lead_journey_mirror(boolean)'::regprocedure""")
if not ok: say("  ✗ STOP: could not read the database: " + str(r)[:300]); done(3)
r = r[0]
checks = [("the lead mirror is the duplicate-folding version", r["fold_version"]), ("the Journey's void door exists", r["void_door"]),
          ("no trigger on the tables the proof touches can call outside the database", r["outbound_triggers"] == 0), ("not installed yet", not r["already"])]
for label, good in checks: say(("  ✓ " if good else "  ✗ ") + label)
say(f"  leads marked spam right now: {r['spam_now']}")
if not LOCAL:
    st, meta = api_get("/functions/lead-reconcile")
    if st == 200 and isinstance(meta, dict):
        say(f"  (separate finding) lead-reconcile is deployed · requires a sign-in at the gateway: {'yes' if meta.get('verify_jwt') else 'NO'} · version {meta.get('version')} · updated {str(meta.get('updated_at'))[:10]}. Not called.")
    elif st == 404: say("  (separate finding) lead-reconcile is not deployed.")
    else: say(f"  (separate finding) could not read lead-reconcile's settings (answered {st}). Not called.")
if not all(g for _, g in checks): say("  STOP. Nothing was changed."); done(4)
say(); say("PART 2 · INSTALL")
ok, res = sql(MIG.decode())
if not ok: say("  ✗ STOPPED: the install did not complete, nothing changed: " + str(res)[:400]); done(5)
say("  ✓ the spam rule is in the lead mirror, in one transaction; its self-check passed")
fn_ok = True
if SKIP_FN: say("  (test target: function deploy skipped)")
else:
    p = subprocess.run([SUPA, "functions", "deploy", "reports-rollup", "--project-ref", REF, "--use-api", "--no-verify-jwt"],
                       cwd=os.path.dirname(os.path.dirname(FNROOT)), env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    fn_ok = p.returncode == 0
    say("  reports-rollup redeploy (owners' lead totals leave spam out): " + ("✓" if fn_ok else "✗ " + (p.stderr or p.stdout)[-400:]))
    if fn_ok:
        url = f"https://{REF}.supabase.co/functions/v1/reports-rollup"
        s1, h1 = http("OPTIONS", url); s2, _ = http("POST", url, b"{}")
        cors = s1 == 200 and any(k.lower() == "access-control-allow-origin" for k in h1)
        say("    browser check: " + ("✓ OPTIONS answers with CORS headers" if cors else f"✗ OPTIONS answered {s1}") + " · " + ("✓ no sign-in is refused (" + str(s2) + ")" if s2 in (401, 403) else f"✗ answered {s2}"))
        fn_ok = cors and s2 in (401, 403)
say(); say("PART 3 · LIVE PROOF (inside a transaction that is always rolled back; made-up inquiries only)")
PROOF = """do $p$ declare a text; b text; c text; st text; n int; begin
  update public.app_data set data = data || jsonb_build_array(jsonb_build_object('id','proof-spam-a','status','New','created_at', (now() - interval '2 days')::text))
   where key = 'leads';
  perform count(*) from public.lead_journey_mirror(true);
  select e.state into st from public.episode_source s join public.journey_episode e using (episode_id) where s.system='lead' and s.source_ref='proof-spam-a';
  update public.app_data set data = (select jsonb_agg(case when x->>'id'='proof-spam-a'
        then x || jsonb_build_object('status','Lost','archived',true,'do_not_contact',true,'spam',jsonb_build_object('at',(now()-interval '8 days')::text,'by','install-proof'))
        else x end) from jsonb_array_elements(data) x)
     || jsonb_build_array(jsonb_build_object('id','proof-spam-b','status','Lost','archived',true,'do_not_contact',true,'created_at',now()::text,
                                             'spam',jsonb_build_object('at',now()::text,'by','install-proof')))
   where key = 'leads';
  select outcome into a from public.lead_journey_mirror(true) where lead_id = 'proof-spam-a';
  select outcome into b from public.lead_journey_mirror(false) where lead_id = 'proof-spam-b';
  select e.state into c from public.episode_source s join public.journey_episode e using (episode_id) where s.system='lead' and s.source_ref='proof-spam-a';
  select count(*) into n from public.episode_source where system='lead' and source_ref='proof-spam-b';
  raise exception 'SPAM_PROOF opened=% a=% a_state=% b=% b_journeys=%', coalesce(st,'none'), coalesce(a,'none'), coalesce(c,'none'), coalesce(b,'none'), n;
end $p$;"""
ok, res = sql(PROOF)
m = re.search(r"SPAM_PROOF opened=(\w+) a=(\w+) a_state=(\w+) b=(\w+) b_journeys=(\d+)", str(res))
if m:
    opened, a, ast, b, bj = m.groups()
    p1 = opened == "provisional" and a == "voided" and ast == "voided"; p2 = b == "spam_skipped" and bj == "0"
    say("  " + ("✓" if p1 else "✗") + f" a made-up inquiry got its Journey, was marked spam a week ago, and the mirror voided that Journey ({opened} → {a})")
    say("  " + ("✓" if p2 else "✗") + f" a made-up inquiry marked spam today never gets a Journey ({b})")
    proof = p1 and p2
else:
    proof = False; say("  ✗ " + str(res)[:300])
ok, z = sql("""select (select count(*) from public.episode_source where system='lead' and source_ref like 'proof-spam-%') j,
  (select count(*) from public.app_data d, jsonb_array_elements(d.data) e where d.key='leads' and e->>'id' like 'proof-spam-%') l""")
z = z[0] if ok else {}
clean = z.get("j") == 0 and z.get("l") == 0
say("  " + ("✓ everything was undone: no made-up inquiry or Journey is left" if clean else "✗ something remained: " + json.dumps(z, default=str)))
say()
allok = proof and clean and fn_ok
say("RESULT: " + ("INSTALLED · spam never gets a Journey, and the owners' totals leave it out. The Hub and owners' page updates can go live next." if allok
                 else "CHECK THE ✗ LINES. lead-journey-spam-rollback.sql puts the previous lead mirror back."))
done(0 if allok else 6)
