#!/usr/bin/env python3
# Stage 3 staffing foundation · production deployment + immediate verification.
# Runs the proven migration ONCE. Stops on any guard/self-check failure; never
# repairs around it. Creates no staffing rows and changes no Journey row. Writes a report.
import json, os, re, hashlib, urllib.request, urllib.error, datetime as dt
from collections import Counter, defaultdict

MIG = open(os.environ["SB_MIGFILE"], "rb").read()
EXP = json.load(open(os.environ["SB_EXPECTED"]))
FPSQL = open(os.environ["SB_FPFILE"]).read()
PARTSQL = open(os.environ["SB_PARTSFILE"]).read()
REPORT = os.environ["SB_REPORT"]
LOCAL = os.environ.get("SB_LOCAL_SOCK")          # test transport: a disposable Postgres
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
REF = os.environ.get("SB_REF", "")

lines = []
def say(s=""): print(s); lines.append(s)

def sql(q):
    """One request, one session (mirrors the Management API query endpoint)."""
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
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "cc-staffing-deploy/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return True, json.loads(r.read().decode(errors="replace"))
    except urllib.error.HTTPError as e:
        return False, "HTTP %s: %s" % (e.code, e.read().decode(errors="replace")[:600])
    except Exception as e:
        return False, "%s: %s" % (type(e).__name__, e)

JOURNEY = ["staffing_need", "staffing_ask", "staffing_reply", "staffing_assignment", "staffing_assignment_sync",
           "staffing_door_audit", "staffing_ask_current", "staffing_need_status",
           "staffing_assignment_sync_id_seq", "staffing_door_audit_id_seq"]
JTABLES = ["journey_episode", "episode_fact", "episode_source", "episode_review", "episode_door_audit"]
JFPSQL = open(os.environ["SB_JFPFILE"]).read()
JLIST = ",".join("'" + n + "'" for n in JOURNEY)
OUTSIDE_DEF = f"""
with j(n) as (select unnest(array[{JLIST}])),
parts(p) as (
  select 'col|'||c.table_name||'|'||c.column_name||'|'||c.data_type||'|'||c.is_nullable||'|'||coalesce(c.column_default,'')
    from information_schema.columns c where c.table_schema='public' and c.table_name not in (select n from j)
  union all
  select 'con|'||con.conrelid::regclass::text||'|'||con.conname||'|'||pg_get_constraintdef(con.oid)
    from pg_constraint con join pg_class c on c.oid=con.conrelid
   where c.relnamespace='public'::regnamespace and c.relname not in (select n from j)
  union all
  select 'fn|'||p.oid::regprocedure::text||'|'||md5(p.prosrc)||'|'||p.prosecdef||'|'||coalesce(p.proacl::text,'')
    from pg_proc p join pg_namespace s on s.oid=p.pronamespace
   where s.nspname='public' and p.proname not like 'staffing\\_%' escape '\\'
  union all
  select 'idx|'||i.tablename||'|'||i.indexname||'|'||i.indexdef
    from pg_indexes i where i.schemaname='public' and i.tablename not in (select n from j)
  union all
  select 'trg|'||t.tgrelid::regclass::text||'|'||t.tgname||'|'||pg_get_triggerdef(t.oid)
    from pg_trigger t join pg_class c on c.oid=t.tgrelid
   where not t.tgisinternal and c.relnamespace='public'::regnamespace and c.relname not in (select n from j)
  union all
  select 'pol|'||pl.tablename||'|'||pl.policyname||'|'||pl.cmd||'|'||pl.roles::text||'|'||coalesce(pl.qual,'')||'|'||coalesce(pl.with_check,'')
    from pg_policies pl where pl.schemaname='public' and pl.tablename not in (select n from j)
  union all
  select 'rel|'||c.relname||'|'||c.relkind::text||'|'||c.relrowsecurity||'|'||coalesce(c.relacl::text,'')
    from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','v','m','S','p')
     and c.relname not in (select n from j)
  union all
  select 'view|'||c.relname||'|'||md5(pg_get_viewdef(c.oid))
    from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('v','m') and c.relname not in (select n from j)
)
select md5(string_agg(p, E'\\n' order by p)) as fp, count(*) as n from parts"""

def outside_rowcounts():
    ok, rows = sql(f"select c.relname from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','p') "
                   f"and c.relname not in ({JLIST}) order by 1")
    if not ok: return None, rows
    names = [r["relname"] for r in rows]
    if not names: return {}, None
    q = " union all ".join(f"select '{n}' as t, count(*) as n from public.\"{n}\"" for n in names)
    ok, rows = sql(q)
    return ({r["t"]: int(r["n"]) for r in rows}, None) if ok else (None, rows)

def journey_parts():
    ok, rows = sql(PARTSQL)
    return (set(f"{r['k']}|{r['p']}" for r in rows), None) if ok else (None, rows)

def journey_counts():
    q = " union all ".join(f"select '{t}' as t, count(*) as n from public.{t}" for t in JOURNEY[:6])
    ok, rows = sql(q)
    return ({r["t"]: int(r["n"]) for r in rows}, None) if ok else (None, rows)

def name_key(part):
    f = part.split("|")
    return "|".join(f[:3]) if f[0] in ("constraint", "index", "trigger", "policy") else "|".join(f[:2])

RENDER_KINDS = {"constraint", "index", "view", "policy", "trigger"}   # server-rendered text

# =============================================================================
say("STAGE 3 STAFFING FOUNDATION · PRODUCTION DEPLOYMENT + VERIFICATION")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC") + ("   (DISPOSABLE TEST TARGET)" if LOCAL else ""))
say()
verdict = {}

# 1. reconfirm the artifact ---------------------------------------------------------------
sha = hashlib.sha256(MIG).hexdigest()
say("== 1. ARTIFACT =====================================================")
say("  migration sha256   " + sha)
say("  expected sha256    " + EXP["migration_sha256"])
say("  expected staffing fingerprint " + EXP["fingerprint"])
if sha != EXP["migration_sha256"]:
    say("  ✗ STOP: this is not the proven migration. Nothing was run.")
    open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(2)
verdict["1 artifact reconfirmed"] = True
say("  ✓ artifact matches the proven build")
say()

# pre-snapshot -----------------------------------------------------------------------------------
say("== 2. BEFORE =======================================================")
ok, v = sql("select version() as v, current_setting('server_version_num') as n")
say("  server   " + (v[0]["v"][:70] if ok else "unknown: " + str(v)))
pre_parts, e1 = journey_parts()
ok, fpre = sql(FPSQL); pre_fp = fpre[0]["staffing_fingerprint"] if ok and fpre else None
okj, jpre = sql(JFPSQL); jfp_pre = jpre[0]["journey_fingerprint"] if okj and jpre else None
okc, jcnt_pre = sql(" union all ".join(f"select '{t}' as t, count(*) as n from public.{t}" for t in JTABLES))
out_pre_ok, out_pre = sql(OUTSIDE_DEF)
rc_pre, e3 = outside_rowcounts()
say("  staffing objects before " + ("none (fresh install)" if not pre_parts else str(len(pre_parts)) + " components"))
say("  Journey fingerprint before " + str(jfp_pre) + ("  ✓ the deployed Stage 2 build" if jfp_pre == EXP["journey_fingerprint"] else "  ✗ unexpected"))
say("  Journey rows before " + (str({r['t']: int(r['n']) for r in jcnt_pre}) if okc else str(jcnt_pre)))
say("  non-Journey definitions   " + (out_pre[0]["fp"] + f"  ({out_pre[0]['n']} parts)" if out_pre_ok else "ERR " + str(out_pre)))
say("  non-Journey tables counted " + (str(len(rc_pre)) if rc_pre is not None else "ERR " + str(e3)))
if pre_parts is None or not out_pre_ok or rc_pre is None:
    say("  ✗ STOP: the before-snapshot could not be taken. Nothing was run.")
    open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(3)
say()

# 2-3. run once ---------------------------------------------------------------------------------------
say("== 3. MIGRATION (run once) =========================================")
ok, res = sql(MIG.decode())
if not ok:
    say("  ✗ STOPPED. The migration did not complete: " + str(res)[:500])
    post_parts, _ = journey_parts()
    ok2, fpost = sql(FPSQL)
    unchanged = post_parts == pre_parts
    say("  staffing objects after the stop: " + ("UNCHANGED" if unchanged else "✗ DIFFER FROM BEFORE, investigate"))
    say("  Nothing was repaired or retried.")
    open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(4)
verdict["2 migration ran once"] = True
verdict["3 guard and self-check passed"] = True
say("  ✓ committed: the empty-foundation guard and the self-check both passed")
say()

# 4-7. verify ------------------------------------------------------------------------------------------------
say("== 4. VERIFICATION =================================================")
post_parts, e = journey_parts()
ok, fpost = sql(FPSQL); post_fp = fpost[0]["staffing_fingerprint"] if ok else None
exp = set(EXP["parts"])
say("  staffing fingerprint deployed " + str(post_fp))
if post_fp == EXP["fingerprint"]:
    say("  ✓ identical to the proven build (all %d components)" % len(exp))
    comp_ok, render_only = True, False
else:
    missing, extra = exp - post_parts, post_parts - exp
    by_kind = Counter(p.split("|")[0] for p in missing | extra)
    subst = [p for p in missing | extra if p.split("|")[0] not in RENDER_KINDS]
    mk = defaultdict(list); ek = defaultdict(list)
    for p in missing: mk[name_key(p)].append(p)
    for p in extra: ek[name_key(p)].append(p)
    unpaired = [k for k in set(mk) | set(ek) if not (mk.get(k) and ek.get(k))]
    render_only = not subst and not unpaired
    comp_ok = False
    say("  aggregate differs; comparing components (differences by kind: %s)" % dict(by_kind))
    if render_only:
        say("  ⚠ every difference is the server's rendering of the SAME named constraint/index/view/trigger/policy.")
        say("    Columns, functions (source md5), privileges, RLS and the version marker match exactly.")
        for k in sorted(mk)[:40]:
            say("    " + k); say("      proven:   " + mk[k][0][:300]); say("      deployed: " + ek[k][0][:300])
    else:
        say("  ✗ SUBSTANTIVE differences (not formatting):")
        for p in sorted(subst)[:40]: say("    " + ("missing " if p in missing else "extra   ") + p[:300])
        for k in sorted(unpaired)[:20]: say("    unpaired " + k)

kinds = Counter(p.split("|")[0] for p in post_parts)
ok, inv = sql("""select
   (select count(*) from pg_class where relnamespace='public'::regnamespace and relkind='r' and relname like 'staffing\\_%' escape '\\') as tables,
   (select count(*) from pg_class where relnamespace='public'::regnamespace and relkind='v' and relname like 'staffing\\_%' escape '\\') as views,
   (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'staffing\\_%' escape '\\') as functions,
   (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in
      ('staffing_need_open','staffing_need_close','staffing_ask_record','staffing_ask_close','staffing_reply_record',
       'staffing_assign','staffing_assignment_release','staffing_assignment_sync_record')) as doors,
   (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'staffing\\_%' escape '\\' and p.prosecdef) as definer_fns,
   obj_description('public.staffing_need'::regclass,'pg_class') as marker,
   (select bool_and(relrowsecurity) from pg_class where relnamespace='public'::regnamespace and relkind='r' and relname like 'staffing\\_%' escape '\\') as rls_all""")
i = inv[0] if ok else {}
say(f"  inventory   tables {i.get('tables')}/6 · views {i.get('views')}/2 · functions {i.get('functions')}/19 · Doors {i.get('doors')}/8 · "
    f"triggers {kinds.get('trigger')}/12 · indexes {kinds.get('index')}/18 · policies {kinds.get('policy')}/5")
inv_ok = (i.get("tables"), i.get("views"), i.get("functions"), i.get("doors"), kinds.get("trigger"), kinds.get("index"), kinds.get("policy")) \
         == (6, 2, 19, 8, 12, 18, 5)
priv_ok = all(p in post_parts for p in exp if p.split("|")[0] in ("table_priv", "function_priv", "rls"))
doors_ok = all(p in post_parts for p in exp if p.startswith("function|staffing_"))
say("  grants / RLS      " + ("✓ every privilege and RLS component matches the proven build" if priv_ok else "✗ privilege/RLS mismatch")
    + ("" if i.get("rls_all") else "  ✗ RLS off somewhere"))
say("  Door definitions  " + ("✓ all Door sources identical to the proven build; no definer functions" if doors_ok and i.get("definer_fns") == 0 else "✗ Door mismatch"))
say("  version marker    " + str(i.get("marker")))
marker_ok = (i.get("marker") or "").startswith("staffing_foundation v1")
active_ok = True

jc, e = journey_counts()
empty_ok = jc is not None and all(v == 0 for v in jc.values())
say("  staffing rows     " + (("✓ all empty " + str(jc)) if empty_ok else "✗ " + str(jc or e)))
okj2, jpost = sql(JFPSQL); jfp_post = jpost[0]["journey_fingerprint"] if okj2 and jpost else None
okc2, jcnt_post = sql(" union all ".join(f"select '{t}' as t, count(*) as n from public.{t}" for t in JTABLES))
journey_ok = jfp_post == jfp_pre == EXP["journey_fingerprint"] and okc and okc2 and jcnt_post == jcnt_pre
say("  Journey foundation " + ("✓ fingerprint and rows unchanged " + str({r['t']: int(r['n']) for r in jcnt_post}) if journey_ok else "✗ Journey changed"))

ok, out_post = sql(OUTSIDE_DEF)
outside_def_ok = ok and out_post[0]["fp"] == out_pre[0]["fp"]
say("  non-staffing definitions " + ("✓ identical before and after (%s parts)" % out_post[0]["n"] if outside_def_ok else "✗ CHANGED"))
rc_post, _ = outside_rowcounts()
deltas = {t: (rc_pre.get(t), rc_post.get(t)) for t in set(rc_pre) | set(rc_post or {}) if rc_pre.get(t) != (rc_post or {}).get(t)}
if not deltas:
    say("  non-staffing row counts  ✓ identical before and after (%d tables)" % len(rc_pre))
else:
    say("  non-staffing row counts  differences (the migration contains no statement that writes these tables;")
    say("                           live hub activity during the run can change counts):")
    for t, (a, b) in sorted(deltas.items()): say(f"    {t}: {a} -> {b}")
say()

# summary ---------------------------------------------------------------------------------------------------
say("== 5. SUMMARY ======================================================")
verdict["4 inventory / grants / RLS / Doors / version"] = inv_ok and priv_ok and doors_ok and marker_ok \
    and i.get("definer_fns") == 0 and bool(i.get("rls_all"))
verdict["4b Journey foundation unchanged"] = journey_ok
verdict["5 staffing tables empty"] = empty_ok
verdict["6 non-staffing definitions unchanged"] = outside_def_ok
verdict["7 fingerprint"] = comp_ok or render_only
verdict["8 no mirror / no staffing rows created"] = empty_ok
for k, v in verdict.items():
    tag = "✓" if v else "✗"
    if k == "7 fingerprint" and render_only: tag = "⚠ rendering-only differences, listed above for review"
    elif k == "7 fingerprint" and comp_ok: tag = "✓ identical"
    say(f"  {tag}  {k}")
allok = all(verdict.values())
say()
say("RESULT: " + ("DEPLOYED AND VERIFIED" if allok and comp_ok else
                  "DEPLOYED · verification needs a look at the rendering differences above" if allok else
                  "DEPLOYED BUT VERIFICATION FAILED · do not use; see the ✗ lines"))
open(REPORT, "w").write("\n".join(lines) + "\n")
raise SystemExit(0 if allok else 5)
