#!/usr/bin/env python3
# 760b · THE HUB ACCESS LOCKDOWN. Hub CRM Build Plan, decision 8, step C part 2. Samantha approved the direction
#   2026-10-15 and said "Yes, build the lockdown: the code PRs and the Desktop step. I'll review them before anything
#   goes live." Her answer on Angiel: both hubs ("I want most to have access to both hubs staffing and care coordinator").
#   The database (lockdown_760b.sql, one transaction): a signed-in login with NO hub list gets NO hub; the caller-
#   recognition records (names, phones, roles, family links) are office only; three summary views over them follow the
#   same rule. The server: hub-access (Team Access: no list = no hub, both hubs in one invite, a failed save is said out
#   loud), rn-review, ai-draft-followup, ai-draft-careplan (no list = no hub). Never texts or emails anyone.
# Part 1 (read only): the reviewed build; the tests pass here; the live rules and the four functions are the ones this was
#   built on (or already this); no staff login has a blank list. Asks yes. Part 2: the rules, then the four functions.
#   Part 3 (proof, read only): acting as a made-up new login and as each office login, inside a transaction that is
#   thrown away; the live functions are exactly the reviewed build; hub-access refuses the public key.
import json, os, re, subprocess, shutil, sys, time
os.environ.setdefault("SB_STEP", "760b")
from cc_step_lib import say, bad, done, http, MG, sql, sha, need, fmeta, live_files, deploy, start, fails, HIDE, API, TOKEN
REF = "zngsgedlsxinbygwmxwn"
FNROOT = os.environ["SB_FNROOT"]; ROOT = os.path.dirname(os.path.dirname(FNROOT))
BASE = os.environ.get("SB_BASE", ""); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
SQLFILE, RBFILE = "lockdown_760b.sql", "lockdown_760b_rollback.sql"
FNS = ["hub-access", "rn-review", "ai-draft-followup", "ai-draft-careplan"]
TESTS = ["hub_access_760b_test.mjs", "hub_access_rn_test.mjs", "ai_draft_careplan_test.mjs"]
TABLES = ["person_identity", "person_source_id", "person_role", "person_relationship", "phone_index",
          "identity_scan_cache", "identity_review", "identity_vocabulary"]
VIEWS = ["identity_completeness", "ghl_contact_collisions", "phone_safe_for_outreach"]
norm = lambda t: re.sub(r"\s+", " ", t or "").strip().rstrip(";").strip()
def fn_body(path):
    m = re.search(r"create\s+or\s+replace\s+function\s+public\.jwt_hub_access\s*\(\)[\s\S]*?\bas\s+(\$\w*\$)([\s\S]*?)\1", open(path).read(), re.I)
    return norm(m.group(2)) if m else None
def probe(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG(), timeout=300)
    for t in (b, b.replace('\\"', '"')):
        if "PROBE_RESULT: " in t:
            try: return json.JSONDecoder().raw_decode(t[t.index("PROBE_RESULT: ") + 14:])[0]
            except Exception: continue
    return None
def git(*a): return subprocess.run(["git", *a], cwd=ROOT, capture_output=True)
def base_sha(rel):
    b = git("show", f"{BASE}:{rel}")
    return __import__("hashlib").sha256(b.stdout).hexdigest() if b.returncode == 0 else None
def fn_state(fn):
    s, m = fmeta(REF, fn)
    if s == 404: return "missing", None
    vj = (m or {}).get("verify_jwt"); okd, live = live_files(REF, fn)
    if not okd or not isinstance(vj, bool): return "unreadable", vj
    nd = need(FNROOT, fn)
    if all(live.get(k) == sha(os.path.join(ROOT, k)) for k in nd): return "this", vj
    if all(live.get(k) == base_sha(k) for k in nd): return "base", vj
    return "other", vj
def chk(good, msg): (say if good else bad)(("  ✓ " if good else "") + msg)

start("THE HUB ACCESS LOCKDOWN")
say("PART 1 · READ ONLY (nothing changes)")
# the reviewed build: the two rule files and every file the four functions are made of
if not BASE or git("cat-file", "-e", BASE + "^{commit}").returncode != 0: bad("the reviewed starting point is not in the history"); done(2)
want = {SQLFILE: os.environ.get("SB_SQL_SHA", ""), RBFILE: os.environ.get("SB_RB_SHA", "")}
want.update({f"supabase/functions/{k}": v for k, v in SHAS.items()})
for fn in FNS:
    for k in need(FNROOT, fn):
        if k not in want and base_sha(k) != sha(os.path.join(ROOT, k)):
            bad(f"{k.split('functions/')[-1]} changed since the review and is not part of 760b. Ask Claude to refresh 760b."); done(2)
for rel, w in want.items():
    p_ = os.path.join(ROOT, rel)
    if not w or not os.path.exists(p_) or sha(p_) != w: bad(f"{rel.split('functions/')[-1]} is not the reviewed build. Nothing was run."); done(2)
say("  ✓ the rules and the four server functions are the reviewed build")
NODE = shutil.which("node") or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.path.exists(p)), "")
if NODE:
    for t in TESTS:
        p = subprocess.run([NODE, t], cwd=ROOT, capture_output=True, text=True)
        last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
        if p.returncode != 0: bad(f"{t} failed: {last}"); say("  STOP. Nothing was changed."); done(2)
        say(f"  ✓ {t}: {last.strip()}")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
say("  · the rules were rehearsed on a real local Postgres with made-up people when built (lockdown_760b_rehearsal.py, 17 checks, the undo included)")

OLD, NEW = fn_body(os.path.join(ROOT, RBFILE)), fn_body(os.path.join(ROOT, SQLFILE))
ok, r = sql(REF, "select prosrc from pg_proc where proname = 'jwt_hub_access' and pronamespace = 'public'::regnamespace")
if not ok or len(r) != 1: bad("couldn't read the live hub-list rule. Nothing was changed. Tell Claude."); done(3)
LIVE = norm(r[0]["prosrc"])
if LIVE not in (OLD, NEW): bad("the live hub-list rule is not the one this was built on (read by 760 on 2026-10-15). Nothing was changed. Tell Claude."); done(3)
ok, pol = sql(REF, "select tablename t, policyname n, cmd, qual from pg_policies where schemaname = 'public' and tablename in ("
              + ",".join("'" + t + "'" for t in TABLES) + ")")
if not ok: bad("couldn't read the caller-recognition rules. Nothing was changed."); done(3)
odd = [f"{p['t']}.{p['n']}" for p in pol if norm(p["qual"]) == "true" and p["cmd"] in ("SELECT", "ALL") and p["n"] != p["t"] + "_read"]
if odd: bad("a read-everything rule has a name the undo would not put back (" + ", ".join(odd) + "). Nothing was changed. Tell Claude."); done(3)
opened = sorted({p["t"] for p in pol if norm(p["qual"]) == "true" and p["cmd"] in ("SELECT", "ALL")})
locked = sorted({p["t"] for p in pol if p["n"] == p["t"] + "_office_read"})
ok, vw = sql(REF, "select c.relname v, coalesce(array_to_string(c.reloptions, ','), '') o from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'v' and c.relname in ("
             + ",".join("'" + v + "'" for v in VIEWS) + ")")
if not ok: bad("couldn't read the summary views. Nothing was changed."); done(3)
DONE = LIVE == NEW and not opened and all("security_invoker=true" in v["o"] for v in vw)
if not DONE and any("security_invoker" in v["o"] for v in vw) and LIVE == OLD:
    bad("a summary view already has a setting the undo would erase. Nothing was changed. Tell Claude."); done(3)
say("  ✓ the live rules are " + ("already this build (an earlier run)" if DONE else f"the ones this was built on: {len(opened)} caller-recognition tables any signed-in login can read"))
ok, blank = sql(REF, f"""select lower(u.email) e, (exists (select 1 from public.auth_identities ai join public.staff_roles s on s.person_id = ai.person_id
    and s.entity = 'cc_ihs' where ai.auth_user_id = u.id and ai.project_ref = '{REF}')) as staff
  from auth.users u where u.raw_app_meta_data -> 'hub_access' is null""")
if not ok: bad("couldn't read the logins. Nothing was changed."); done(3)
if any(b["staff"] for b in blank):
    bad(f"{sum(1 for b in blank if b['staff'])} office login(s) have no hub list and would be locked out. Give each one its hubs in Team Access first. Nothing was changed."); done(3)
say(f"  ✓ no office login has a blank hub list" + (f" ({len(blank)} login(s) with no staff record and no list will open nothing)" if blank else ""))
STATES = {}
for fn in FNS:
    st, vj = fn_state(fn)
    if st not in ("base", "this"): bad(f"{fn} on the server is not what 760b expects ({st}). Nothing was changed. Tell Claude."); done(3)
    STATES[fn] = (st, vj); say(f"  ✓ {fn}: " + {"this": "already this build", "base": "the build before this change"}[st])
s_, b_ = http("GET", f"{API}/v1/projects/{REF}/api-keys?reveal=true", headers=MG())
try: ANON = {k.get("name"): k.get("api_key", "") for k in json.loads(b_)}.get("anon", "")
except Exception: ANON = ""
HIDE.append(ANON)

say(""); say("THE CHANGE")
say("  · a login with no hub list opens nothing (today it opens every hub). Every office login already has its list.")
say("  · names, phones, roles and family links behind caller recognition: office staff on the Care Coordinator Hub only")
say("  · Team Access can give Staffing and Care Coordinator in one invite, and says so out loud if a hub list fails to save")
say("  · undo: lockdown_760b_rollback.sql puts the rules back; Claude redeploys the four functions from the build before 760b")
try:
    with open("/dev/tty", "w") as tw: tw.write("\n  Make this change? Type yes and press Enter: "); tw.flush()
    with open("/dev/tty") as tr: a = tr.readline().strip().lower()
except Exception: a = os.environ.get("SB_YES", "")
if a != "yes": say("  · you didn't type yes, so nothing was changed."); done(0)

say(); say("PART 2 · CHANGE")
if DONE: say("  ✓ the rules already had it")
else:
    q = open(os.path.join(ROOT, SQLFILE)).read()
    if q.count("\ncommit;") != 1 or q.count("\nbegin;") != 1: bad("the rule file isn't one transaction. Nothing was changed. Tell Claude."); done(5)
    ok, r = sql(REF, q)
    if not ok: bad("the rules didn't go in (nothing was changed): " + str(r)[:240]); done(5)
    say("  ✓ saved: no list = no hub; caller recognition office only; the three summary views follow it")
for fn in FNS:
    st, vj = STATES[fn]
    if st == "this": say(f"  ✓ {fn} already had it"); continue
    if not deploy(REF, FNROOT, fn, vj): say("  STOP. Tell Claude."); done(6)
time.sleep(float(os.environ.get("SB_SETTLE", "8")))

say(); say("PART 3 · PROOF (read only, inside a transaction that is thrown away)")
P = probe(f"""do $p$
declare u record; r jsonb := '{{}}'; k int; ph int; vw int; cl int;
begin
  set transaction read only;
  for u in select * from (
      select 'new login, no list' as who, '00000000-0000-0000-0000-00000000760b'::uuid as id, '{{}}'::jsonb as md
      union all
      select 'office: ' || coalesce(p.full_name, 'login'), x.id, coalesce(x.raw_app_meta_data, '{{}}')
        from auth.users x join public.auth_identities ai on ai.auth_user_id = x.id and ai.project_ref = '{REF}'
        join public.persons p on p.person_id = ai.person_id
       where exists (select 1 from public.staff_roles s where s.person_id = p.person_id and s.entity = 'cc_ihs')
         and coalesce(to_jsonb(x) ->> 'banned_until', '') = '') z loop
    perform set_config('request.jwt.claims', jsonb_build_object('sub', u.id, 'role', 'authenticated', 'aud', 'authenticated', 'app_metadata', u.md)::text, true);
    perform set_config('request.jwt.claim.sub', u.id::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    set local role authenticated;
    select count(*) into k from public.app_data;
    select count(*) into ph from public.phone_index;
    select count(*) into cl from public.app_data where key = 'leads';
    begin select count(*) into vw from public.phone_safe_for_outreach; exception when others then vw := -1; end;
    reset role;
    r := r || jsonb_build_object(u.who, jsonb_build_object('keys', k, 'phones', ph, 'leads', cl, 'view', vw,
      'cc', coalesce(u.md -> 'hub_access' ? 'care_coordinator', false)));
  end loop;
  raise exception 'PROBE_RESULT: %', r;
end $p$""")
if not P: bad("couldn't act as the logins to prove it")
else:
    n = P.pop("new login, no list", {})
    chk(n.get("keys") == 0 and n.get("phones") == 0 and n.get("view") in (0, -1), f"a new login with no hub list opens nothing ({n.get('keys')} records, {n.get('phones')} phone links)")
    for who, x in sorted(P.items()):
        if x["cc"]: chk(x["leads"] == 1 and x["phones"] > 0, f"{who}: still opens the leads and caller recognition ({x['keys']} records, {x['phones']} phone links)")
        else: say(f"  · {who}: no Care Coordinator Hub on this login, so no leads or caller recognition ({x['keys']} records)")
ok, r = sql(REF, "select prosrc from pg_proc where proname = 'jwt_hub_access' and pronamespace = 'public'::regnamespace")
chk(ok and len(r) == 1 and norm(r[0]["prosrc"]) == NEW, "the live hub-list rule is the new one")
ok, pol = sql(REF, "select count(*) filter (where qual = 'true' and cmd in ('SELECT','ALL'))::int open, count(*) filter (where policyname like '%_office_read')::int office from pg_policies where schemaname = 'public' and tablename in ("
              + ",".join("'" + t + "'" for t in TABLES) + ")")
chk(ok and pol and pol[0]["open"] == 0 and pol[0]["office"] >= 5, "no caller-recognition table is open to every login" + (f" ({pol[0]['office']} are office only)" if ok and pol else ""))
for fn in FNS:
    okd, live = live_files(REF, fn)
    chk(okd and all(live.get(k) == sha(os.path.join(ROOT, k)) for k in need(FNROOT, fn)), f"{fn}: the live copy is exactly the reviewed build")
if ANON:
    s1 = http("POST", f"{FNB}/functions/v1/hub-access", {"action": "status", "target_email": "proof760b@example.invalid"}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
    chk(s1 in (401, 403), f"hub-access refuses the public key ({s1})")
say()
say("RESULT: " + ("DONE · the lockdown is live. Next: give Angiel both hubs and her care coordinator role when she starts." if not fails else "PARTLY DONE · the ✗ lines above need Claude."))
say("Nothing was texted or emailed. No record was changed.")
say("Undo: lockdown_760b_rollback.sql puts the rules back; Claude redeploys the four functions from the build before 760b.")
done(0 if not fails else 8)
