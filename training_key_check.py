#!/usr/bin/env python3
# T0 · the Training key: where it is kept, what checks it, who the sign-in check lets in (READ ONLY; yes/no and counts only).
#  1. Shared project: is the Training Hub key in cc_hub_config / team_hub_settings, is it the one the Training project
#     accepts (compared as fingerprints inside each database; no value leaves either), which hubs can read each record,
#     and does any other shared record hold the same value (record names only).
#  2. Training database: every function whose code reads the hub read key or takes p_key: security definer? can anyone
#     (anon) or any signed-in user run it? Their live definitions are saved to a local file with the key blanked out,
#     because they are not in any file here (T2 rewrites them from this and restores them from it on rollback).
#  3. Training edge functions: deployed or not, version, gateway sign-in, and from the source here what each checks.
#  4. Shared project: how many sign-ins the Hub's own-sign-in check lets in, and how many office staff it turns away
#     because their hub list lacks the Care Coordinator Hub (the Staffing-only question).
# Changes nothing, calls no function, prints no key, name, email or phone.
import json, os, sys, urllib.request, urllib.error, datetime as dt
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn"); TREF = os.environ.get("SB_TRAINING_REF", "rdqujxiycycwhskyvrwa")
LOCAL = os.environ.get("SB_LOCAL_SOCK"); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
TRAIN = os.environ.get("SB_TRAIN_DIR", "/Users/samantha/Claude/Projects/Caring Companions Training Platform")
DEFS = os.environ.get("SB_DEFS_OUT", os.path.join(TRAIN, "supabase", "hub-key-functions-live.sql"))
OFFICE = ("owner_admin", "care_coordinator", "staffing_coordinator")
lines = []
def say(s=""): print(s); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  This check changes nothing.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def sql(ref, q):
    if LOCAL:
        from pg8000.native import Connection, DatabaseError
        c = Connection(user="postgres", database="postgres", unix_sock=LOCAL)
        try:
            rows = c.run(q); cols = [d["name"] for d in (c.columns or [])]; return True, [dict(zip(cols, r)) for r in (rows or [])]
        except DatabaseError as e:
            d = e.args[0] if e.args and isinstance(e.args[0], dict) else {}; return False, str(d.get("M", e))
        finally: c.close()
    req = urllib.request.Request(API + f"/v1/projects/{ref}/database/query", data=json.dumps({"query": q}).encode(), method="POST",
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "cc-t0/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return True, json.loads(r.read().decode(errors="replace"))
    except urllib.error.HTTPError as e: return False, "HTTP %s" % e.code
    except Exception as e: return False, type(e).__name__
def api_get(ref, path):
    req = urllib.request.Request(API + f"/v1/projects/{ref}" + path, headers={"Authorization": "Bearer " + TOKEN, "User-Agent": "cc-t0/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r: return r.status, json.loads(r.read().decode(errors="replace"))
    except urllib.error.HTTPError as e: return e.code, None
    except Exception: return None, None
yn = lambda b: "yes" if b else "no"

say("T0 · THE TRAINING KEY: WHERE IT IS, WHAT CHECKS IT, WHO GETS IN (read only; yes/no and counts only)")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC") + ("   (DISPOSABLE TEST TARGET)" if LOCAL else "")); say()

say("1 · WHERE THE KEY IS KEPT")
ok, t = sql(TREF, """select exists (select 1 from public.app_settings where key='hub_read_key') as present,
  coalesce(length(nullif(btrim((select value->>'key' from public.app_settings where key='hub_read_key')),'')),0) as len,
  md5(coalesce(nullif(btrim((select value->>'key' from public.app_settings where key='hub_read_key')),''),'')) as fp""")
if not ok or not t: say("  ✗ could not read the Training project: " + str(t)[:200]); done(3)
t = t[0]; tfp = t["fp"] if t["len"] else None
say(f"  the Training project's key is set: {yn(t['len'])}" + (f" ({t['len']} characters; not shown)" if t["len"] else ""))
for rec in ("cc_hub_config", "team_hub_settings"):
    ok, r = sql(REF, f"""select exists (select 1 from public.app_data where key='{rec}') as present,
      coalesce(length(nullif(btrim((select data->>'training_hub_key' from public.app_data where key='{rec}')),'')),0) as len,
      md5(coalesce(nullif(btrim((select data->>'training_hub_key' from public.app_data where key='{rec}')),''),'')) as fp,
      (select coalesce(string_agg(hub_slug, ', ' order by hub_slug), '') from public.app_data_key_hub_map where data_key='{rec}') as hubs""")
    if not ok or not r: say(f"  ✗ could not read {rec}: " + str(r)[:200]); continue
    r = r[0]
    if not r["present"]: say(f"  {rec}: the record does not exist"); continue
    same = bool(r["len"] and tfp and r["fp"] == tfp)
    say(f"  {rec}: the key is filled in: {yn(r['len'])}" + (f" · it is the one the Training project accepts: {yn(same)}" if r["len"] else "")
        + " · readable by: " + (r["hubs"] or "EVERY signed-in user (not in the hub map)"))
ok, o = sql(REF, """select a.key from public.app_data a,
  (select nullif(btrim(data->>'training_hub_key'),'') k from public.app_data where key='cc_hub_config') s
  where s.k is not null and a.key not in ('cc_hub_config','team_hub_settings') and position(s.k in a.data::text) > 0 order by a.key""")
if ok: say("  other shared records holding the same value: " + (", ".join(x["key"] for x in o) if o else "none"))
else: say("  ✗ could not search the other shared records: " + str(o)[:200])
say("  (browsers also keep copies: the Hubs' saved settings and the Owners Hub's own saved key. Those cannot be seen from here.)")

say(); say("2 · WHAT CHECKS IT IN THE TRAINING DATABASE")
ok, fns = sql(TREF, """select p.oid::int as oid, p.proname as name, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef as definer,
  has_function_privilege('anon', p.oid, 'execute') as anon_run, has_function_privilege('authenticated', p.oid, 'execute') as auth_run,
  p.prosrc ilike '%hub_read_key%' as reads_key,
  coalesce(position(nullif(btrim((select value->>'key' from public.app_settings where key='hub_read_key')),'') in p.prosrc) > 0, false) as literal
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and (p.prosrc ilike '%hub_read_key%' or pg_get_function_identity_arguments(p.oid) ilike '%p_key %'
    or p.proname in ('hub_job_offers','hub_offer_update','hub_training_status'))
  order by p.proname, p.oid""")
if not ok: say("  ✗ could not read the functions: " + str(fns)[:200])
else:
    names = {f["name"] for f in fns}
    for want in ("hub_job_offers", "hub_offer_update", "hub_training_status"):
        say(f"  {want} exists: {yn(want in names)}")
    say(f"  every function that reads the key or takes a key ({len(fns)}):")
    for f in fns:
        say(f"    {f['name']}({f['args']}) · runs as its owner: {yn(f['definer'])} · anyone can run it: {yn(f['anon_run'])}"
            f" · any signed-in user: {yn(f['auth_run'])} · checks the key: " + ("reads it from settings" if f["reads_key"] else "")
            + (" and " if f["reads_key"] and f["literal"] else "") + ("HAS THE KEY WRITTEN INTO ITS CODE" if f["literal"] else "")
            + ("" if f["reads_key"] or f["literal"] else "no key check found"))
    if fns:
        ids = ",".join(str(f["oid"]) for f in fns)
        ok, d = sql(TREF, f"""select p.proname as name, replace(pg_get_functiondef(p.oid),
            coalesce(nullif(btrim((select value->>'key' from public.app_settings where key='hub_read_key')),''), chr(1)), '<<the hub read key>>') as def
            from pg_proc p where p.oid in ({ids}) order by p.proname, p.oid""")
        ok2, g = sql(TREF, f"""select p.proname as name, pg_get_function_identity_arguments(p.oid) as args,
            array_to_string(array(select r from unnest(array['anon','authenticated','service_role']) r where has_function_privilege(r, p.oid, 'execute')), ', ') as roles
            from pg_proc p where p.oid in ({ids}) order by p.proname, p.oid""")
        if ok:
            body = ["-- Live definitions from the Training project, read by T0 on " + dt.date.today().isoformat() + " (the key is blanked out).",
                    "-- This is the rollback baseline for T2. Grants at the time:"]
            if ok2: body += [f"--   {x['name']}({x['args']}): {x['roles'] or 'nobody'}" for x in g]
            body += ["", *[x["def"].rstrip() + ";\n" for x in d]]
            try:
                os.makedirs(os.path.dirname(DEFS), exist_ok=True); open(DEFS, "w").write("\n".join(body) + "\n")
                say(f"  their live definitions were saved on this Mac (key blanked): {DEFS}")
            except Exception as e: say("  ✗ could not save the definitions: " + type(e).__name__)
        else: say("  ✗ could not read the definitions: " + str(d)[:200])

say(); say("3 · THE TRAINING FUNCTIONS THE HUBS CALL")
want = ["ghl-replies", "ghl-thread", "ghl-nurse-assign", "axiscare-open-shifts", "ghl-lead-comms", "ghl-reply", "job-offer",
        "ghl-attach-doc", "axiscare-config", "axiscare-convert-lead"]
deployed = {}
if not LOCAL:
    st, lst = api_get(TREF, "/functions")
    if st == 200 and isinstance(lst, list): deployed = {f.get("slug"): f for f in lst}
    else: say(f"  ✗ could not list the deployed functions ({st})")
def checks(slug):
    try: src = open(os.path.join(TRAIN, "supabase", "functions", slug, "index.ts")).read()
    except Exception: return "no source here"
    k, s = "hub_read_key" in src, ("hubStaff(" in src or "hubContact(" in src)
    return "the key AND your Hub sign-in" if k and s else "your Hub sign-in" if s else "the key only" if k else "NO check found"
for slug in want:
    f = deployed.get(slug)
    dep = (f"deployed (version {f.get('version')}, gateway sign-in required: {yn(f.get('verify_jwt'))})" if f else ("not checked" if LOCAL else "NOT deployed"))
    say(f"  {slug}: {dep} · from its source here it checks: {checks(slug)}")
others = sorted(s for s in deployed if s not in want)
if others: say("  other deployed Training functions (not part of this): " + ", ".join(others))

say(); say("4 · WHO THE HUB'S OWN-SIGN-IN CHECK LETS IN (shared project)")
roles = ",".join("'" + r + "'" for r in OFFICE)
ok, w = sql(REF, f"""with u as (
  select au.id, au.raw_app_meta_data->'hub_access' as hubs,
    exists (select 1 from public.auth_identities ai join public.persons p on p.person_id = ai.person_id
      join public.entity_memberships m on m.person_id = ai.person_id and m.entity = 'cc_ihs'
      join public.staff_roles sr on sr.person_id = ai.person_id and sr.entity = 'cc_ihs'
      where ai.auth_user_id = au.id and ai.project_ref = '{REF}' and p.active is true and m.active is true and m.ended_at is null
        and sr.role in ({roles})) as office
  from auth.users au)
select count(*) as users,
  count(*) filter (where office and (jsonb_typeof(hubs) is distinct from 'array' or hubs ? 'care_coordinator')) as let_in,
  count(*) filter (where office and jsonb_typeof(hubs) = 'array' and not hubs ? 'care_coordinator') as office_turned_away,
  count(*) filter (where office and jsonb_typeof(hubs) = 'array' and not hubs ? 'care_coordinator' and hubs ? 'staffing') as staffing_only,
  count(*) filter (where not office) as not_office
from u""")
if ok and w:
    w = w[0]
    say(f"  sign-ins in all: {w['users']} · let in (office role, active): {w['let_in']} · not office staff or not active: {w['not_office']}")
    say(f"  office staff turned away because their hub list lacks the Care Coordinator Hub: {w['office_turned_away']}"
        + (f" (with Staffing Hub access: {w['staffing_only']})" if w["office_turned_away"] else ""))
else: say("  ✗ could not count: " + str(w)[:200])
ok, c = sql(REF, """select coalesce((select string_agg(x, ', ' order by x) from jsonb_array_elements_text(raw_app_meta_data->'hub_access') x), '(no hub list)') as combo,
  count(*) as n from auth.users group by 1 order by 2 desc, 1""")
if ok and c: say("  hub lists in use: " + " · ".join(f"{x['combo']}: {x['n']}" for x in c))
say()
say("Nothing was changed or called. No key, name, email or phone was printed.")
done(0)
