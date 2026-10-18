#!/usr/bin/env python3
# 959 · BONUSES, THE SERVER (Care Coordinator Leads and Bonus, Stage 4; policy approved by Samantha 2026-10-18, her "start
# stage 4"). Pay is private, so the bonus records never reach a browser:
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass on fake data; app_data's row
#     security is in its usual state; saves run as the person saving (so database rules apply to them); no hub can read
#     the bonus slot by its key map.
#  2. Adds four RESTRICTIVE rules: no signed-in page (not even an owner) reads, saves or deletes the 'cc_bonuses' slot.
#     Only the server function cc-bonus does (it runs as the server, which row security does not apply to) and it decides
#     who sees what: each Care Coordinator their own, payroll the approved ones, Samantha and Zachary all.
#     Then deploys cc-bonus (new) and schedules its daily check (7:15 am Central). The bonus program stays OFF until
#     Samantha or Zachary turns it on in the Hub (Settings > Leads > Bonus program); off, the daily check only lists.
#  3. Proof: acting as an owner and a Care Coordinator (always undone), neither can read or save the slot; the function
#     refuses a caller with no key, answers its owner, and a practice run lists what it would do.
# No GRANT or REVOKE. Nothing is texted, emailed or called. Safe to run again. Undo: cc_bonus_959_rollback.sql.
import json, os, re, subprocess, shutil, time
os.environ.setdefault("SB_STEP", "959")
import cc_step_lib as L
from cc_step_lib import say, bad, done, sql, start, lit, http, deploy, fmeta, check_build

REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
KEY = "cc_bonuses"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FN, JOB, SCHEDULE, VAULT = "cc-bonus", "cc-bonus-daily", "15 12 * * *", "hub_job_secret"   # 12:15 UTC = 7:15 am CDT, 6:15 am CST
TESTS = ("cc_bonus_959_test.mjs", "slice3_582_test.mjs")
REHEARSAL = os.environ.get("SB_REHEARSAL_DB_ONLY") == "1"   # the local rehearsal only: no function deploy, no schedule
ok = lambda s: say("  ✓ " + s)
def chk(good, msg, badmsg=None): (ok(msg) if good else bad(badmsg or msg))
def run(args, cwd=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(code)
def keys():
    """the project's anon and service keys, read with the access token (masked values are skipped)"""
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_publishable_") or v.startswith("sb_secret_")) and "·" not in v and "*" not in v
    for q_ in ("?reveal=true", ""):
        s_, b_ = http("GET", f"{L.API}/v1/projects/{REF}/api-keys{q_}", headers=L.MG())
        if s_ != 200: continue
        try: arr = json.loads(b_)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        got = {k.get("name"): k.get("api_key", "") for k in arr if isinstance(k, dict)}
        got = {k: v for k, v in got.items() if usable(v)}
        if got.get("anon"): return got
    return {}
def one(q, what):
    good, rows = sql(REF, q)
    if not good: stop(f"could not read {what}: {rows}")
    v = rows[0]["r"] if rows else None
    return json.loads(v) if isinstance(v, str) else v

start("BONUSES, THE SERVER")
say("PART 1 · READ ONLY (nothing changes)")
if not REHEARSAL:
    check_build(FNROOT, SHAS)
    MAIN = os.environ.get("SB_MAIN_REF", "origin/main")
    if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
    drift = []
    for k in sorted(L.need(FNROOT, FN)):
        c2, b2 = run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"])
        if c2 != 0 or b2 != open(os.path.join(ROOT, k)).read(): drift.append(k)
    if drift: stop("this isn't the same as GitHub's main yet (" + ", ".join(drift)[:240] + "). Tell Claude.")
    ok("the reviewed build is what is on GitHub's main")
    if NODE:
        for t in TESTS:
            c, o = run([NODE, t], cwd=ROOT)
            last = (o.strip().splitlines() or ["(no output)"])[-1]
            if c != 0: stop(f"{t} failed: {last}")
            ok(f"{t}: {last.strip()} (fake data only)")
    else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
X = one(f"""select jsonb_build_object(
  'rls', (select relrowsecurity from pg_class where oid = 'public.app_data'::regclass),
  'forced', (select relforcerowsecurity from pg_class where oid = 'public.app_data'::regclass),
  'upsert_definer', (select bool_or(prosecdef) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'upsert_app_data_item'),
  'map', (select count(*) from public.app_data_key_hub_map where data_key = {lit(KEY)}),
  'n', (select jsonb_array_length(coalesce(data, '[]'::jsonb)) from public.app_data where key = {lit(KEY)}),
  'live', (select data->'bonus_live' from public.app_data where key = 'ops_settings'),
  'payroll', (select data->'bonus'->'payroll' from public.app_data where key = 'ops_settings'),
  'people', (select coalesce(jsonb_agg(jsonb_build_object('name', p.full_name, 'email', lower(coalesce(p.primary_email, '')),
       'uid', (select ai.auth_user_id from public.auth_identities ai join auth.users u on u.id = ai.auth_user_id
                where ai.person_id = p.person_id and u.banned_until is null order by ai.auth_user_id limit 1),
       'roles', coalesce((select jsonb_agg(r.role) from public.staff_roles r where r.person_id = p.person_id and r.entity = 'cc_ihs'), '[]'::jsonb))), '[]'::jsonb)
     from public.persons p where p.active)) as r""", "how app_data is protected")
if not X["rls"] or X["forced"]: stop("row security on app_data is not in its usual state (on, not forced)")
ok("row security is on for app_data (not forced, so the server's own jobs are unaffected)")
if X["upsert_definer"] is None: stop("the save function upsert_app_data_item is missing")
if X["upsert_definer"]: stop("the save function runs as its owner, so database rules would not apply to saves")
ok("saves go through upsert_app_data_item as the person saving, so the new rules apply to them")
if X["map"]: stop(f"a hub's key map lists '{KEY}', so a browser could read it. Tell Claude.")
ok(f"no hub's key map lists '{KEY}'")
say(f"  · bonuses on file now: {X['n'] or 0} (counts only, never names or amounts)")
say(f"  · bonus program switch: {'ON' if X['live'] is True else 'off (the daily check will only list)'}; payroll person: {'set' if X['payroll'] else 'not set yet (Settings > Leads > Bonus program)'}")
PPL = X["people"] or []
OWNERP = next((p for p in PPL if p["uid"] and "owner_admin" in (p["roles"] or [])), None)
COORD = next((p for p in PPL if p["uid"] and "care_coordinator" in (p["roles"] or []) and "owner_admin" not in (p["roles"] or [])), None)
if not OWNERP: stop("there is no owner with a working sign-in to test with")
gate = None
if not REHEARSAL:
    s, m = fmeta(REF, FN)
    if s == 404: say(f"  · {FN} is new (not live yet)")
    elif s == 200 and m: gate = bool(m.get("verify_jwt")); say(f"  · {FN} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if gate else 'off'} (kept)")
    else: stop(f"couldn't read how {FN} is set up live ({s})", 3)
say()

say("PART 2 · THE CHANGE")
CHANGE = f"""
drop policy if exists app_data_cc_bonus_sel on public.app_data;
drop policy if exists app_data_cc_bonus_ins on public.app_data;
drop policy if exists app_data_cc_bonus_upd on public.app_data;
drop policy if exists app_data_cc_bonus_del on public.app_data;
create policy app_data_cc_bonus_sel on public.app_data as restrictive for select to authenticated, anon using (key <> {lit(KEY)});
create policy app_data_cc_bonus_ins on public.app_data as restrictive for insert to authenticated, anon with check (key <> {lit(KEY)});
create policy app_data_cc_bonus_upd on public.app_data as restrictive for update to authenticated, anon using (key <> {lit(KEY)}) with check (key <> {lit(KEY)});
create policy app_data_cc_bonus_del on public.app_data as restrictive for delete to authenticated, anon using (key <> {lit(KEY)});
do $v$ begin
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'app_data' and policyname like 'app_data_cc_bonus_%' and permissive = 'RESTRICTIVE') <> 4 then
    raise exception '959 self-check: the four rules are not all in place'; end if;
end $v$;"""
good, r = sql(REF, CHANGE)
if not good: bad(f"the database change did not go through, so nothing changed: {str(r)[:400]}"); say("  RESULT: STOPPED. Tell Claude."); done(8)
ok(f"the four rules are in place: no signed-in page reads, saves or deletes '{KEY}'")
if REHEARSAL: say("  · (rehearsal: the function deploy and the schedule are skipped)")
else:
    if not deploy(REF, FNROOT, FN, True if gate is None else gate): say("  STOP. Tell Claude. (The database rules above are in; the function is not.)"); done(5)
    K = keys()
    ANON = (K or {}).get("anon", "")
    if not ANON: bad("couldn't read the Hub's public key, so the daily check was not scheduled. Tell Claude."); done(6)
    L.HIDE.append(ANON)
    cmd = ("select net.http_post(url := " + lit(f"{FNB}/functions/v1/{FN}") + ", headers := jsonb_build_object('Content-Type', 'application/json', "
           "'Authorization', " + lit("Bearer " + ANON) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT) + ")), "
           "body := '{}'::jsonb, timeout_milliseconds := 120000);")
    sql(REF, f"select cron.unschedule({lit(JOB)}) where exists (select 1 from cron.job where jobname = {lit(JOB)})")
    okc, _ = sql(REF, f"select cron.schedule({lit(JOB)}, {lit(SCHEDULE)}, {lit(cmd)}) as id")
    okj, jb = sql(REF, f"select schedule, command from cron.job where jobname = {lit(JOB)}")
    chk(okc and okj and jb and jb[0]["schedule"] == SCHEDULE and "x-cron-secret" in jb[0]["command"], "the daily check runs every morning at 7:15 (switched off, it only lists)")
say()

say("PART 3 · PROOF (acting as each person, always undone)")
def probe(P, steps):
    good, r = sql(REF, f"""do $p$ declare uid uuid := {lit(P['uid'])}::uuid; meta jsonb; res text := ''; n int; b boolean; begin
      select coalesce(raw_app_meta_data, '{{}}'::jsonb) into meta from auth.users where id = uid;
      perform set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'role', 'authenticated', 'app_metadata', meta)::text, true);
      perform set_config('request.jwt.claim.sub', uid::text, true);
      set local role authenticated;
      {steps}
      raise exception 'PROBE_RESULT:%', res; end $p$;""")
    m_ = re.search(r"PROBE_RESULT:([a-z0-9_=; ]*)", str(r)) if not good else None
    if not m_: return None, str(r)[:300]
    return dict(kv.split("=") for kv in m_.group(1).split(";") if "=" in kv), None
ITEM = json.dumps({"id": "bonus_959probe", "lead_id": "959probe", "recipient": "959 proof", "amount": 1, "status": "approved"})
STEPS = (f"select count(*) into n from public.app_data where key = {lit(KEY)}; res := res || 'see=' || n || ';';"
         f"begin perform public.upsert_app_data_item({lit(KEY)}, {lit(ITEM)}::jsonb); exception when others then null; end;"
         f"reset role; select exists (select 1 from public.app_data a, jsonb_array_elements(coalesce(a.data, '[]'::jsonb)) x where a.key = {lit(KEY)} and x->>'id' = 'bonus_959probe') into b;"
         f"set local role authenticated; res := res || 'save=' || case when b then 1 else 0 end || ';';")
for P, label in ((OWNERP, "an owner"),) + (((COORD, "a Care Coordinator"),) if COORD else ()):
    got, err = probe(P, STEPS)
    if got is None: bad(f"could not test as {P['name']}: {err}"); continue
    chk(got.get("see") == "0" and got.get("save") == "0", f"acting as {P['name']} ({label}, undone after): can't read the bonus slot; can't save into it",
        f"acting as {P['name']} ({label}): " + ("READS the bonus slot; " if got.get("see") != "0" else "") + ("CAN SAVE into it" if got.get("save") != "0" else ""))
if not COORD: say("  · no Care Coordinator sign-in to test with; the rehearsal covers it")
if not REHEARSAL:
    time.sleep(float(os.environ.get("SB_SETTLE", "8")))
    s, _ = http("POST", f"{FNB}/functions/v1/{FN}", {}, {"Content-Type": "application/json"})
    chk(s is not None and s != 200 and s < 500, f"{FN}: a caller with no key gets nothing ({s})", f"{FN} answered a caller with no key ({s})")
    K = keys()
    SERVICE = (K or {}).get("service_role", "")
    if SERVICE:
        L.HIDE.append(SERVICE); S = {"Authorization": "Bearer " + SERVICE, "Content-Type": "application/json"}
        s, b = http("POST", f"{FNB}/functions/v1/{FN}?auth_check=1", {}, S)
        chk(s == 200 and '"owner"' in str(b), f"{FN}: answers its owner (a who-is-calling check only)")
        s, b = http("POST", f"{FNB}/functions/v1/{FN}?dry=1", {}, S)
        try: j = json.loads(b) if s == 200 else {}
        except Exception: j = {}
        chk(s == 200 and j.get("write") is False, f"{FN}: practice run OK: it would start {len(j.get('new_lines') or [])} bonus(es) and update {j.get('updated', 0)}; nothing written", f"{FN}: the practice run did not answer ({s})")
    else: say("  · couldn't read the server key, so the practice run was skipped (the daily check will run it)")
say()
if L.fails: say("RESULT: CHECK THE ✗ LINES ABOVE. Tell Claude."); done(9)
say("RESULT: DONE · The bonus records are server-only. Turn the program on in the Hub (Settings > Leads > Bonus program) when you're ready. Nothing was sent."); done(0)
