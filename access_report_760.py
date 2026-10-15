#!/usr/bin/env python3
# 760 · EVERY HUB LOGIN AND WHAT IT CAN OPEN TODAY (READ ONLY). Step C, part 1, of the Hub CRM Build Plan (decision 8,
# approved 2026-10-15). Changes nothing, sends nothing. Prints names and work emails of logins, key and table NAMES and
# row COUNTS only; never a lead, client, assessment or phone number.
#  1. Every login on the shared hub project: name, role, active, hub list (blank = every hub today).
#  2. What each login can open in app_data, worked out by acting as that login inside a transaction that is then thrown
#     away (the database's own rules decide, nothing is guessed): leads, care_assessments, medicaid_plans, owner money.
#  3. What a brand-new login would see: one with a blank hub list, one with Care Coordinator Hub only, and a visitor who
#     is not signed in.
#  4. Tables and views a signed-in login can read (row counts), the caller-recognition tables marked.
#  5. Server functions that treat a blank hub list as every hub, and those that read the caller-recognition tables.
#  6. The email lists written into page code (Care Coordinator Hub, Owners Hub).
#  7. The live rules themselves, copied from the database, for Claude.
import json, os, re, sys, urllib.request, urllib.error, datetime as dt
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn"); LOCAL = os.environ.get("SB_LOCAL_SOCK"); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
PAGES = [p.split("=", 1) for p in os.environ.get("SB_PAGES", "").split(";") if "=" in p]
lines = []
def say(s=""): print(s); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  This report changes nothing.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash

# Read only, enforced here and in the database: a plain query must be a select; the one acting-as block starts with
# "set transaction read only" (any write inside it fails) and always ends by raising, which throws the transaction away.
def _guard(q):
    s = q.lstrip().lower()
    if s.startswith("select") or s.startswith("with"): return
    if s.startswith("do") and "set transaction read only;" in s and "raise exception 'probe_result: %'" in s: return
    raise SystemExit("760 refuses to send anything that is not read only")
def _run(q):
    _guard(q)
    if LOCAL:
        from pg8000.native import Connection, DatabaseError
        c = Connection(user="postgres", database="postgres", unix_sock=LOCAL)
        try: rows = c.run(q); cols = [d["name"] for d in (c.columns or [])]; return 200, [dict(zip(cols, r)) for r in (rows or [])]
        except DatabaseError as e: return 400, str(e)
        finally: c.close()
    req = urllib.request.Request(API + f"/v1/projects/{REF}/database/query", data=json.dumps({"query": q}).encode(), method="POST",
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "cc-760/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=300) as r: return r.status, json.loads(r.read().decode(errors="replace"))
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
def sql(q):
    s, b = _run(q)
    return (True, b) if s in (200, 201) and isinstance(b, list) else (False, str(b)[:200])
def probe(q):
    s, b = _run(q)
    t = b if isinstance(b, str) else json.dumps(b)
    for cand in (t, t.replace('\\"', '"')):
        if "PROBE_RESULT: " in cand:
            try: return json.JSONDecoder().raw_decode(cand[cand.index("PROBE_RESULT: ") + 14:])[0], None
            except Exception: continue
    return None, f"HTTP {s}: {t[:240]}"

day = lambda v: (str(v)[:10] if v else "never")
IDENTITY = ["person_identity", "person_source_id", "person_role", "person_relationship", "phone_index"]
WATCH = ["leads", "care_assessments", "medicaid_plans"]
OWNER_MONEY = ["finance_snapshots", "owner_settings", "budget_lines", "budget_actuals", "offboardings", "file_audits"]
STRANGER = "00000000-0000-0000-0000-000000000760"

say("760 · EVERY HUB LOGIN AND WHAT IT CAN OPEN TODAY (read only)")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC") + ("   (DISPOSABLE TEST DATABASE)" if LOCAL else ""))
say("Nothing is changed or sent. Only names, work emails, key names, table names and counts are printed.")

# ── 1 ────────────────────────────────────────────────────────────────────────
say(); say("1 · EVERY LOGIN")
ok, users = sql(f"""select u.id::text as id, lower(u.email) as email, u.last_sign_in_at as last_in, u.created_at as made,
    u.email_confirmed_at is not null as confirmed, to_jsonb(u)->>'banned_until' as banned,
    u.raw_app_meta_data->'hub_access' as hubs, p.full_name as name, p.active as person_active,
    m.active as member, m.ended_at as ended, r.roles
  from auth.users u
  left join public.auth_identities ai on ai.auth_user_id = u.id and ai.project_ref = '{REF}'
  left join public.persons p on p.person_id = ai.person_id
  left join public.entity_memberships m on m.person_id = p.person_id and m.entity = 'cc_ihs'
  left join lateral (select string_agg(s.role, ', ' order by s.role) as roles from public.staff_roles s
                     where s.person_id = p.person_id and s.entity = 'cc_ihs') r on true
  order by lower(u.email)""")
if not ok: say("  ✗ could not read the logins: " + users); done(1)
def hubtxt(h):
    if h is None: return "BLANK (today that means every hub)"
    if isinstance(h, str):
        try: h = json.loads(h)
        except Exception: return h
    return ", ".join(h) if isinstance(h, list) and h else "an empty list (no hub)"
for u in users:
    who = u["name"] or "(no staff record linked)"
    state = []
    if not u["confirmed"]: state.append("invite not accepted")
    if u["banned"]: state.append("BLOCKED until " + day(u["banned"]))
    if u["name"] and not u["person_active"]: state.append("staff record INACTIVE")
    if u["name"] and (u["member"] is not True or u["ended"]): state.append("not an active Caring Companions member")
    say(f"  · {who} <{u['email']}>")
    say(f"      role: {u['roles'] or 'none'} · hubs: {hubtxt(u['hubs'])} · last sign-in: {day(u['last_in'])}" + (" · " + "; ".join(state) if state else ""))
ok, orphans = sql(f"""select p.full_name as name, string_agg(s.role, ', ' order by s.role) as roles from public.staff_roles s
  join public.persons p on p.person_id = s.person_id
  where s.entity = 'cc_ihs' and not exists (select 1 from public.auth_identities ai join auth.users u on u.id = ai.auth_user_id
                                            where ai.person_id = s.person_id and ai.project_ref = '{REF}')
  group by p.full_name order by 1""")
if ok and orphans: say("  Staff records with a role but no login on this project: " + "; ".join(f"{o['name']} ({o['roles']})" for o in orphans))

# ── 2-4: one acting-as block, thrown away at the end ─────────────────────────
PROBE = f"""do $p$
declare u record; t record; per record; k jsonb; n bigint; tot bigint; row jsonb;
  r jsonb := jsonb_build_object('users', '{{}}'::jsonb, 'personas', '{{}}'::jsonb, 'tables', '[]'::jsonb);
begin
  set transaction read only;
  select coalesce(jsonb_agg(key order by key), '[]') into k from public.app_data;
  r := r || jsonb_build_object('all_keys', k);
  for u in select id, email, coalesce(raw_app_meta_data, '{{}}'::jsonb) as md from auth.users loop
    perform set_config('request.jwt.claims', jsonb_build_object('sub', u.id, 'role', 'authenticated', 'aud', 'authenticated',
      'email', u.email, 'app_metadata', u.md)::text, true);
    perform set_config('request.jwt.claim.sub', u.id::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    set local role authenticated;
    select coalesce(jsonb_agg(key order by key), '[]') into k from public.app_data;
    reset role;
    r := jsonb_set(r, array['users', u.id::text], k);
  end loop;
  for t in select c.oid, c.relname, c.relkind, c.relrowsecurity as rls from pg_class c
           where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'p')
             and (has_table_privilege('authenticated', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'SELECT'))
           order by c.relname loop
    execute format('select count(*) from %s', t.oid::regclass) into tot;
    row := jsonb_build_object('t', t.relname, 'kind', t.relkind, 'rls', t.rls, 'total', tot);
    for per in select * from (values ('anon', 'anon', '{{}}'::jsonb), ('no_list', 'authenticated', '{{}}'::jsonb),
                                     ('cc_only', 'authenticated', '{{"hub_access": ["care_coordinator"]}}'::jsonb)) v(name, rol, md) loop
      perform set_config('request.jwt.claims', jsonb_build_object('sub', '{STRANGER}', 'role', per.rol, 'aud', per.rol,
        'email', 'stranger760@example.invalid', 'app_metadata', per.md)::text, true);
      perform set_config('request.jwt.claim.sub', case when per.rol = 'anon' then '' else '{STRANGER}' end, true);
      perform set_config('request.jwt.claim.role', per.rol, true);
      if per.rol = 'anon' then
        perform set_config('request.jwt.claims', jsonb_build_object('role', 'anon')::text, true);
        set local role anon;
      else
        set local role authenticated;
      end if;
      begin
        execute format('select count(*) from %s', t.oid::regclass) into n;
      exception when insufficient_privilege then n := -1;
      end;
      if t.relname = 'app_data' then
        begin
          select coalesce(jsonb_agg(key order by key), '[]') into k from public.app_data;
        exception when insufficient_privilege then k := '[]';
        end;
        r := jsonb_set(r, array['personas', per.name], k);
      end if;
      reset role;
      row := row || jsonb_build_object(per.name, n);
    end loop;
    r := jsonb_set(r, '{{tables}}', (r->'tables') || jsonb_build_array(row));
  end loop;
  raise exception 'PROBE_RESULT: %', r;
end $p$"""
res, err = probe(PROBE)
if res is None: say(); say("  ✗ could not act as the logins: " + err); done(1)
allk = res["all_keys"]

say(); say(f"2 · WHAT EACH LOGIN CAN OPEN IN THE SHARED RECORD STORE (app_data, {len(allk)} keys)")
say("   Worked out by acting as each login; the database's own rules decide.")
def keyline(seen):
    marks = [f"{k}: {'YES' if k in seen else 'no'}" for k in WATCH]
    money = sum(1 for k in OWNER_MONEY if k in seen); have = sum(1 for k in OWNER_MONEY if k in allk)
    return " · ".join(marks) + f" · owner money keys: {money} of {have}"
for u in users:
    seen = res["users"].get(u["id"], [])
    say(f"  · {u['name'] or u['email']}: opens {len(seen)} of {len(allk)} keys")
    say("      " + keyline(seen))
    miss = [k for k in allk if k not in seen]
    if miss and len(miss) <= 25: say("      cannot open: " + ", ".join(miss))
    elif miss: say(f"      cannot open: {len(miss)} keys")

say(); say("3 · WHAT A NEW LOGIN WOULD SEE (made up for this report, never saved)")
P = res["personas"]
for name, label in (("no_list", "signed in, no staff record, BLANK hub list"),
                    ("cc_only", "signed in, no staff record, Care Coordinator Hub only"),
                    ("anon", "a visitor who is not signed in")):
    seen = P.get(name, [])
    say(f"  · {label}: opens {len(seen)} of {len(allk)} keys")
    say("      " + keyline(seen))

say(); say("4 · TABLES AND VIEWS A LOGIN CAN READ (row counts only)")
say("   'every row' = the rule lets ANY signed-in login read the whole table, staff record or not.")
tabs = res["tables"]
def frac(n, tot): return "refused" if n == -1 else ("every row" if n == tot and tot > 0 else f"{n} of {tot}")
ident = [t for t in tabs if t["t"] in IDENTITY]
say("  Caller-recognition tables (identity-layer.sql uses a read-everything rule for signed-in logins):")
for t in sorted(ident, key=lambda x: IDENTITY.index(x["t"])):
    say(f"    {t['t']}: {t['total']} rows · new login, blank list: {frac(t['no_list'], t['total'])} · Care Coordinator only: {frac(t['cc_only'], t['total'])} · not signed in: {frac(t['anon'], t['total'])}")
for name in IDENTITY:
    if name not in [t["t"] for t in ident]: say(f"    {name}: not readable by any login (or not present)")
wide = [t for t in tabs if t["t"] not in IDENTITY and t["t"] != "app_data" and t["no_list"] > 0]
say(f"  Other tables and views a brand-new signed-in login (no staff record) can read rows from: {len(wide)}")
for t in wide:
    kind = "view" if t["kind"] in ("v", "m") else ("table, row rules OFF" if not t["rls"] else "table")
    say(f"    {t['t']} ({kind}): {frac(t['no_list'], t['total'])}")
openanon = [t for t in tabs if t["anon"] > 0]
say(f"  Tables and views a visitor who is NOT signed in can read rows from: {len(openanon)}" + (": " + ", ".join(f"{t['t']} ({frac(t['anon'], t['total'])})" for t in openanon) if openanon else ""))

# ── 5 ────────────────────────────────────────────────────────────────────────
say(); say("5 · SERVER FUNCTIONS THAT DECIDE ACCESS")
ok, fns = sql("""select p.proname as fn, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef as definer,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') as signed_in, has_function_privilege('anon', p.oid, 'EXECUTE') as visitor,
    p.prosrc ~* 'jwt_hub_access\\s*\\(\\s*\\)\\s+is\\s+null' as blank_is_all,
    p.prosrc ~* '(person_identity|person_source_id|person_role|person_relationship|phone_index)' as reads_identity
  from pg_proc p where p.pronamespace = 'public'::regnamespace
   and (p.prosrc ~* 'jwt_hub_access\\s*\\(\\s*\\)\\s+is\\s+null' or p.prosrc ~* '(person_identity|person_source_id|person_role|person_relationship|phone_index)')
  order by 1""")
if not ok: say("  ✗ could not read the functions: " + fns)
else:
    who = lambda f: "anyone, signed in or not" if f["visitor"] else ("any signed-in login" if f["signed_in"] else "the server only")
    b = [f for f in fns if f["blank_is_all"]]
    say(f"  Treat a blank hub list as EVERY hub ({len(b)}):")
    for f in b: say(f"    {f['fn']}({f['args']}) · callable by {who(f)}")
    i = [f for f in fns if f["reads_identity"] and (f["signed_in"] or f["visitor"])]
    say(f"  Read the caller-recognition tables and can be called from a page ({len(i)}):")
    for f in i: say(f"    {f['fn']}({f['args']}) · {'runs as owner, ignores row rules' if f['definer'] else 'runs as the caller'} · callable by {who(f)}")

# ── 6 ────────────────────────────────────────────────────────────────────────
say(); say("6 · EMAIL LISTS WRITTEN INTO PAGE CODE (live code from GitHub)")
if not PAGES: say("  (page code not supplied to this run)")
pat = re.compile(r"(?:(?:const|let|var)\s+([A-Za-z_][\w]*)\s*=\s*|return\s+|([\w.]+)\s*:\s*)?\[\s*('[^'\]]*@mo-care\.com'(?:\s*,\s*'[^'\]]*@[\w.-]+')*)\s*\]")
pat2 = re.compile(r"(?:(?:const|let|var)\s+([A-Za-z_]\w*)\s*=\s*)\{\s*('[^']*@mo-care\.com'\s*:[^}]*)\}")
for label, root in PAGES:
    found = 0
    for dp, dn, fn in os.walk(root):
        dn[:] = [d for d in dn if d not in (".git", "node_modules", "tests", "test")]
        for f in sorted(fn):
            if not f.endswith((".html", ".js")): continue
            path = os.path.join(dp, f)
            try: txt = open(path, encoding="utf-8", errors="replace").read().split("\n")
            except Exception: continue
            for no, ln in enumerate(txt, 1):
                for m in list(pat.finditer(ln)) + list(pat2.finditer(ln)):
                    emails = re.findall(r"'([^']+@[\w.-]+)'", m.group(0))
                    name = (m.group(1) or "") if m.re is pat2 else (m.group(1) or m.group(2) or ("returned list" if m.group(0).lstrip().startswith("return") else "list"))
                    say(f"  {label} {os.path.relpath(path, root)}:{no}  {name}: {', '.join(emails)}"); found += 1
    if not found: say(f"  {label}: none found")

# ── 7 ────────────────────────────────────────────────────────────────────────
say(); say("7 · THE LIVE RULES, COPIED FROM THE DATABASE (for Claude)")
for f in ("jwt_hub_access", "can_access_data_key", "desk_hub_ok", "desk_is_owner"):
    ok, r = sql(f"select pg_get_functiondef(p.oid) as d from pg_proc p where p.proname = '{f}' and p.pronamespace = 'public'::regnamespace")
    if ok and r:
        for d in r: say("  " + d["d"].strip().replace("\n", "\n  "))
    else: say(f"  {f}: not present" if ok else f"  ✗ could not read {f}: {r}")
ok, r = sql("""select tablename as t, policyname as name, permissive, cmd, roles::text as roles, qual, with_check from pg_policies
  where schemaname = 'public' and tablename in ('app_data', 'person_identity', 'person_source_id', 'person_role', 'person_relationship', 'phone_index')
  order by tablename, policyname""")
if ok:
    say("  Row rules on app_data and the caller-recognition tables:")
    for p in r: say(f"    {p['t']}.{p['name']} · {p['permissive']} {p['cmd']} to {p['roles']} · using {p['qual']}" + (f" · check {p['with_check']}" if p['with_check'] else ""))
else: say("  ✗ could not read the row rules: " + r)
ok, r = sql("select count(*) as n, count(distinct data_key) as keys from public.app_data_key_hub_map")
if ok and r: say(f"  Key map: {r[0]['n']} rows over {r[0]['keys']} keys.")
say()
say("Nothing was changed or sent. The acting-as checks ran inside a read-only transaction that was thrown away.")
done(0)
