#!/usr/bin/env python3
# 582 · PHASE 1, SLICE 3: THE DOOR (Samantha approved the Slice 3 design and its four decisions 2026-10-11; this step is
# the deployment, run by her after she approves the final package). Hub project.
#   PART 1 (read only): the reviewed build (fingerprints), the tests on her Mac, the Slice 1 pieces the door stands on,
#     both functions live (their versions are written down here for a rollback), and the Hub page already sending
#     request ids (it merges first; today's functions ignore the extra field, so that order has no gap).
#   PART 2 (one transaction): action_authority_582.sql: the registry, the authority table, its change log, the owner-only
#     change function, the guards; seeded so nobody gains or loses anything.
#   PART 3: client-fact and call-place deployed through the door, each fingerprint-checked; a mismatch stops the step.
#   PART 4 (proof in production, nothing sent): nobody can change the authority table directly, not even the project
#     owner; pages and the server key may only read it; the owner function refuses a caller with no sign-in; both
#     functions refuse a caller with no sign-in; the seed is exactly as approved.
# Nothing is sent. No switch changes. Nobody gains or loses a permission.
import os, json, re, shutil, subprocess, time
os.environ.setdefault("SB_STEP", "582")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; BASE = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
HUB_URL = os.environ.get("SB_HUB_URL", "https://cc.mo-care.com/")
FNS = ["client-fact", "call-place"]
TESTS = ["slice3_582_test.mjs", "client_fact_fn_test.mjs", "call_place_fn_test.mjs"]
ACTIONS = ["client_fact.record", "client_fact.record_person", "client_fact.care_began", "call_place.place"]
start("PHASE 1, SLICE 3: THE DOOR")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
for f, want in json.loads(os.environ.get("SB_SQL_SHAS", "{}")).items():
    p_ = os.path.join(ROOT, f)
    if os.path.exists(p_) and sha(p_) == want: say(f"  ✓ {f} is the reviewed version")
    else: bad(f"{f} is not the reviewed version: nothing runs")
if fails or not os.environ.get("SB_SQL_SHAS"): say("  RESULT: STOPPED before anything changed."); done(2)
NODE = shutil.which("node") or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.path.exists(p)), "")
if NODE:
    for t in TESTS:
        p = subprocess.run([NODE, t], cwd=ROOT, capture_output=True, text=True)
        last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
        if p.returncode != 0 or re.search(r"^FAIL", p.stdout, re.M): bad(f"{t} failed: {last}"); say("  STOP. Nothing was changed."); done(2)
        say(f"  ✓ {t}: {last.strip()}")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
ok_, pre = sql(REF, "select to_regprocedure('public.desk_is_owner()') is not null as owner_fn, to_regprocedure('public.hub_office_ok()') is not null as office_fn, "
                    "exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'op_events_request_started_uq') as lock_, "
                    "to_regclass('public.action_authority') is not null as already")
pre = pre[0] if ok_ and pre else {}
(say if pre.get("owner_fn") and pre.get("office_fn") else bad)(("  ✓ " if pre.get("owner_fn") and pre.get("office_fn") else "") + "the owner and office tests (My Desk, Slice 1) are present" if pre.get("owner_fn") and pre.get("office_fn") else "desk_is_owner or hub_office_ok is missing")
(say if pre.get("lock_") else bad)(("  ✓ the once-only lock on the record (Slice 1) is present") if pre.get("lock_") else "the once-only lock on the record is missing (Slice 1 not live?)")
if pre.get("already"): say("  · the authority table already exists (582 ran before); running again is safe and never overwrites a row an owner changed")
VJ, BEFORE = {}, {}
for fn in FNS:
    sx, mx = fmeta(REF, fn)
    if sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool):
        VJ[fn] = mx["verify_jwt"]; BEFORE[fn] = mx.get("version", "?")
        say(f"  ✓ {fn} is live at version {BEFORE[fn]} (gateway sign-in check {'on' if VJ[fn] else 'off'}, kept). For a rollback: version {BEFORE[fn]}.")
    else: bad(f"{fn} is not live or unreadable: {sx}")
s_, page = http("GET", HUB_URL + ("&" if "?" in HUB_URL else "?") + "v582=" + str(int(time.time())), None, {"Cache-Control": "no-cache"}, timeout=60)
if s_ == 200 and "CC_DOOR_582" in (page or ""): say("  ✓ the live Hub page sends request ids (callAction is live), so the door can deploy with no gap")
else: bad(f"the live Hub page does not send request ids yet ({s_}): Claude merges the CC Hub pull request first")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say("  · what changes: the authority tables (one transaction), then " + " and ".join(FNS) + ". Nothing is sent; no switch changes; nobody gains or loses a permission.")

say(); say("PART 2 · CHANGE (one transaction)")
okr, r_ = sql(REF, open(os.path.join(ROOT, "action_authority_582.sql")).read())
if not okr: bad(f"the authority tables could not be installed (one transaction, so nothing in it changed): {str(r_)[:300]}"); say("  RESULT: STOPPED. Nothing else was changed. Tell Claude."); done(5)
say("  ✓ who may do what: the registry, the authority table, its change log, the owner-only change function, the guards")

say(); say("PART 3 · THE TWO FUNCTIONS THROUGH THE DOOR")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, VJ[fn]): say(f"  RESULT: STOPPED. Anything above stays. To undo a half-way state Claude redeploys the build before Slice 3 (the versions noted in Part 1). Tell Claude."); done(6)

say(); say("PART 4 · PROOF (nothing is sent; nothing is written)")
time.sleep(float(os.environ.get("SB_SETTLE", "6")))
ok_, seed = sql(REF, "select action, actor_kind, level, roles from public.action_authority where action in (" + ", ".join(lit(a) for a in ACTIONS) + ") order by 1, 2")
rows = seed if ok_ and seed else []
want = all(any(r["action"] == a and r["actor_kind"] == "person" and r["level"] == "allowed" and sorted(r["roles"] or []) == ["care_coordinator", "owner_admin", "staffing_coordinator"] for r in rows) for a in ACTIONS) \
    and all(r["level"] == "never" for r in rows if r["actor_kind"] in ("job", "employee")) and len(rows) == 12
(say if want else bad)(("  ✓ " if want else "") + ("the seed is as approved: the four actions open to the three office roles, as before; jobs and AI employees never" if want else f"the seed is not as approved: {rows}"))
for label, q in (("change a row", "update public.action_authority set level = 'never' where action = 'call_place.place' and actor_kind = 'person'"),
                 ("add a row", "insert into public.action_authority (action, actor_kind, actor_id, level, set_by) values ('call_place.place', 'employee', 'probe-582', 'autonomous', 'probe')"),
                 ("delete a row", "delete from public.action_authority where action = 'call_place.place'"),
                 ("rewrite the change log", "update public.action_authority_log set note = note")):
    okx, ex = sql(REF, q)
    good = (not okx) and ("582" in str(ex))
    (say if good else bad)(("  ✓ " if good else "") + (f"even the project owner cannot {label} directly (the guard refused it)" if good else f"the project owner could {label} directly: {str(ex)[:160]}"))
ok_, gr = sql(REF, "select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as p from information_schema.role_table_grants where table_schema = 'public' "
                   "and table_name in ('action_registry', 'action_authority', 'action_authority_log') and grantee in ('authenticated', 'anon', 'service_role', 'PUBLIC') group by 1, 2 order by 1, 2")
g = [(x["table_name"], x["grantee"], x["p"]) for x in (gr or [])] if ok_ else None
gok = g is not None and all(p == "SELECT" and who in ("authenticated", "service_role") for _, who, p in g) and len(g) == 6
(say if gok else bad)(("  ✓ " if gok else "") + ("pages and the server key may only read the three tables; anon nothing" if gok else f"the grants are not as designed: {g}"))
ok_, ow = sql(REF, "select public.authority_set('call_place.place', 'employee', '', 'autonomous', '{}', 'probe 582') as r")
owok = ok_ and ow and (ow[0].get("r") or {}).get("reason") == "sign in first"
(say if owok else bad)(("  ✓ " if owok else "") + ("the owner change function refuses a caller with no signed-in owner" if owok else f"the owner function answered: {ow}"))
NOAUTH = {"Content-Type": "application/json"}
for fn, body in (("client-fact", {"action": "record"}), ("call-place", {"action": "place"})):
    s_, b_ = http("POST", f"{BASE}/functions/v1/{fn}", body, NOAUTH)
    say(f"  ✓ {fn} refuses a caller with no sign-in ({s_})") if s_ in (401, 403) else bad(f"{fn} answered {s_} without a sign-in")
ok_, n = sql(REF, "select count(*)::int as n from public.op_events where action in (" + ", ".join(lit(a) for a in ACTIONS) + ")")
say(f"  · rows from the door in the record so far: {n[0]['n'] if ok_ and n else '?'} (they start with the office's next fact or call placement)")
say("  · tested before deploying: an undeclared field is refused by name; a repeated request id does nothing twice; two presses at once run once; every change leaves a started and an outcome row with the real person; no value reaches the record; reads record nothing; an AI employee is refused.")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · Slice 3 is live: client facts and call placing go through the door. Next: a week of office use, then the 582b look (read only).")
say("Rollback (only if ever needed): Claude redeploys client-fact and call-place from the build before Slice 3 (live before this step: " + ", ".join(f"{fn} version {BEFORE.get(fn, '?')}" for fn in FNS) + "), then action_authority_582_rollback.sql.")
done(0)
