#!/usr/bin/env python3
# 584 · SLICE 9, EVIDENCE HARDENING (Samantha "yes to all, go", 2026-10-11). Hub project. Installs the evidence value history
# (its own table, separate from the Phase 1 change history), the earlier versions of every journey and readiness row, the GHE
# lock at the participant's signature, the bg_reviews history guard, and removes the browser's ability to delete or overwrite
# lead-docs / agency-docs files (each removed rule kept for the rollback). Replaces client-journey (a recorded checklist step
# reopens only with a reason), client-audit and caregiver-export (the Evidence changes section; the caregiver export as of a
# date now shows the roster values of that date; the client export's care change columns fixed) and lead-docs-retention
# (PAUSED: it only lists what it would delete until the Admin switch lead_docs_purge_live is turned on). Nothing is sent;
# no existing record changes; nothing is deleted.
import os, json, time
os.environ.setdefault("SB_STEP", "584")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FNS = ["client-journey", "client-audit", "caregiver-export", "lead-docs-retention"]
BUCKETS = "('lead-docs', 'agency-docs')"
BROWSER_RULES = ("select policyname, cmd, array_to_string(roles, ',') as roles from pg_policies where schemaname = 'storage' and tablename = 'objects' "
                 "and cmd in ('DELETE', 'UPDATE', 'ALL') and (roles && array['authenticated', 'public', 'anon']::name[]) "
                 "and (coalesce(qual, '') ~ '''(lead-docs|agency-docs)''' or coalesce(with_check, '') ~ '''(lead-docs|agency-docs)''') order by 1")
start("SLICE 9: EVIDENCE HARDENING")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
VJ = {}
for fn in FNS:
    sx, mx = fmeta(REF, fn)
    if sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool): VJ[fn] = mx["verify_jwt"]; say(f"  ✓ {fn} is live at version {mx.get('version', '?')} (gateway sign-in check {'on' if VJ[fn] else 'off'}); replaced by this build, same setting")
    else: bad(f"{fn} is not live or unreadable: {sx}")
SQLF = os.path.join(ROOT, "supabase", "slice9-evidence.sql")
if not os.path.exists(SQLF): bad("the SQL file is not in the reviewed build")
ok_, t = sql(REF, "select to_regclass('public.client_journey_step') is not null as s, to_regclass('public.client_care_change') is not null as c, to_regclass('public.evv_submissions') is not null as e, "
                   "to_regclass('public.bg_reviews') is not null as b, to_regclass('public.evidence_history') is not null as already")
if ok_ and t and t[0]['s'] and t[0]['c'] and t[0]['e'] and t[0]['b']: say("  ✓ the tables it watches are all there" + (" (evidence history already installed: this run refreshes it)" if t[0]['already'] else ""))
else: bad(f"a table it watches is missing: {t}")
ok_, rules = sql(REF, BROWSER_RULES)
if ok_: say(f"  · {len(rules)} storage rule(s) let a signed-in browser delete or overwrite inquiry or agency documents: " + ", ".join(f"\"{r['policyname']}\" ({r['cmd']})" for r in rules) + ". They are removed and kept for the rollback.")
else: bad(f"could not read the storage rules: {rules}")
COUNTS = ("select (select count(*)::int from storage.objects where bucket_id in " + BUCKETS + ") as files, "
          "(select count(*)::int from public.app_data, jsonb_array_elements(data) x where key = 'ghe_forms' and coalesce(x->>'sig_part', '') <> '') as signed, "
          "(select count(*)::int from public.app_data, jsonb_array_elements(data) x where key = 'ghe_forms') as ghe, "
          "(select count(*)::int from public.bg_reviews) as bg, (select coalesce(sum(jsonb_array_length(history)), 0)::int from public.bg_reviews where jsonb_typeof(history) = 'array') as bgh, "
          "(select count(*)::int from public.client_journey_step) as steps, (select count(*)::int from public.client_care_change) as cc")
ok_, c = sql(REF, COUNTS)
if ok_: say(f"  · {c[0]['files']} inquiry and agency document file(s); {c[0]['ghe']} GHE form(s), {c[0]['signed']} signed by the participant (they lock); {c[0]['bg']} background review(s) with {c[0]['bgh']} history line(s); {c[0]['steps']} journey step row(s); {c[0]['cc']} care change(s)")
else: bad(f"could not count: {c}")
ok_, lt = sql(REF, "select count(*)::int as n from storage.objects where bucket_id = 'lead-docs' and name ~ '/LTC_POLICY-[0-9]+-' "
                   "and to_timestamp(substring(name from '/LTC_POLICY-([0-9]+)-')::bigint / 1000.0) < now() - interval '90 days'")
if ok_: say(f"  · {lt[0]['n']} LTC policy file(s) are older than 90 days: today the daily purge would delete them; after this step it only lists them")
ok_, sw = sql(REF, "select coalesce(data->>'lead_docs_purge_live', 'not set') as p from public.app_data where key = 'ops_settings'")
if ok_ and sw: say(f"  ✓ the purge switch: {sw[0]['p']} (practice, list only, unless true)")
s_, b_ = http("GET", f"{API}/v1/projects/{REF}/api-keys?reveal=true", headers=MG()); ANON = SVC = ""
try:
    arr = json.loads(b_) if s_ == 200 else []
    if isinstance(arr, dict): arr = arr.get("keys") or []
    ANON = next((k.get("api_key") for k in arr if isinstance(k, dict) and k.get("name") == "anon" and str(k.get("api_key", "")).startswith("eyJ")), "")
    SVC = next((k.get("api_key") for k in arr if isinstance(k, dict) and k.get("name") == "service_role" and str(k.get("api_key", "")).startswith("eyJ")), "")
except Exception: pass
HIDE.extend([ANON, SVC])
say("  ✓ the project's keys are readable (for the proof calls)") if ANON and SVC else bad("could not read the project's keys for the proof")
say("  · what changes: three new tables (evidence history, journey row versions, the removed storage rules), eight watchers and guards, the browser delete and overwrite rules on two buckets, four functions. Nothing is sent; no existing record changes; nothing is deleted.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
ok_, r_ = sql(REF, open(SQLF).read())
if not ok_: bad(f"the migration did not run (nothing from it stayed: it is one transaction): {r_}"); done(5)
say("  ✓ evidence history, journey row versions, the GHE lock and the bg_reviews guard are installed")
ok_, rm = sql(REF, "select policyname, cmd from public.evidence_storage_rule_removed where restored_at is null order by id")
if ok_: say(f"  ✓ {len(rm)} storage rule(s) removed and kept for the rollback: " + ", ".join(f"\"{r['policyname']}\" ({r['cmd']})" for r in rm))
for fn in FNS:
    if not deploy(REF, FNROOT, fn, VJ[fn]): say("  RESULT: STOPPED. The database part is in and safe on its own; tell Claude."); done(6)

say(); say("PART 3 · PROOF (nothing is sent; the probes run inside a transaction that is always rolled back)")
FNB = f"https://{REF}.supabase.co"
ok_, tg = sql(REF, "select count(*)::int as n from pg_trigger where not tgisinternal and tgname in ('evidence_app_data_t', 'evidence_app_data_del_t', 'evidence_evv_t', 'evidence_care_change_t', 'journey_row_version_t', 'ghe_forms_lock_t', 'bg_reviews_history_keep_t')")
say("  ✓ all eight watchers and guards are attached") if ok_ and tg[0]['n'] == 8 else bad(f"watchers: {tg}")
ok_, left = sql(REF, BROWSER_RULES)
say("  ✓ no storage rule lets a signed-in browser delete or overwrite inquiry or agency documents") if ok_ and not left else bad(f"still there: {left}")
ok_, keep = sql(REF, "select count(*)::int as n from pg_policies where schemaname = 'storage' and tablename = 'objects' and cmd in ('SELECT', 'INSERT') and (coalesce(qual, '') ~ '''lead-docs''' or coalesce(with_check, '') ~ '''lead-docs''')")
say(f"  ✓ reading and adding inquiry documents still have their rules ({keep[0]['n']})") if ok_ and keep[0]['n'] >= 2 else bad(f"read/add rules for lead-docs: {keep}")
for tbl in ("evidence_history", "journey_row_version"):
    s_, b_ = http("GET", f"{FNB}/rest/v1/{tbl}?select=id&limit=1", None, {"apikey": ANON, "Authorization": "Bearer " + ANON})
    say(f"  ✓ the public key cannot read {tbl} ({s_})") if s_ in (401, 403, 404) else bad(f"{tbl} answered the public key with {s_}: {str(b_)[:120]}")
PROBE = r"""do $probe$
declare t0 timestamptz; ms numeric; n_ev int; lock_msg text := 'not refused'; rm_msg text := 'not refused'; bg_msg text := 'no review to try';
  sig text := 'data:image/png;base64,UFJPQkU1ODQ='; bid uuid;
begin
  /* 1. evidence history: a probe applicant is added and its OIG date changed (both rolled back) */
  t0 := clock_timestamp();
  update public.app_data set data = data || jsonb_build_array(jsonb_build_object('id', 'probe584', 'first', 'Probe', 'last', 'Fiveeightyfour', 'oig_date', '2026-01-01')) where key = 'candidates';
  update public.app_data set data = (select jsonb_agg(case when x->>'id' = 'probe584' then x || '{"oig_date":"2026-02-02"}'::jsonb else x end order by i) from jsonb_array_elements(data) with ordinality e(x, i)) where key = 'candidates';
  ms := round(extract(epoch from clock_timestamp() - t0) * 1000 / 2, 1);
  select count(*) into n_ev from public.evidence_history where source = 'app_data:candidates' and record_id = 'probe584';
  /* 2. the GHE lock: a probe form is signed, then its answers changed, then removed (rolled back) */
  insert into public.app_data (key, data) values ('ghe_forms', '[]'::jsonb) on conflict (key) do nothing;
  update public.app_data set data = data || jsonb_build_array(jsonb_build_object('id', 'probe584', 'client', 'Probe Client', 'visit_date', '2026-10-11', 'f', '{"ghe_notes":"x"}'::jsonb, 'sig_nurse', sig, 'sig_part', sig, 'status', 'draft')) where key = 'ghe_forms';
  begin
    update public.app_data set data = (select jsonb_agg(case when x->>'id' = 'probe584' then x || '{"f":{"ghe_notes":"changed"}}'::jsonb else x end order by i) from jsonb_array_elements(data) with ordinality e(x, i)) where key = 'ghe_forms';
  exception when others then lock_msg := sqlerrm; end;
  begin
    update public.app_data set data = (select coalesce(jsonb_agg(x order by i), '[]'::jsonb) from jsonb_array_elements(data) with ordinality e(x, i) where x->>'id' <> 'probe584') where key = 'ghe_forms';
  exception when others then rm_msg := sqlerrm; end;
  /* 3. bg_reviews: an earlier history line cannot be removed (rolled back) */
  select id into bid from public.bg_reviews where jsonb_typeof(history) = 'array' and jsonb_array_length(history) > 0 limit 1;
  if bid is not null then
    bg_msg := 'not refused';
    begin update public.bg_reviews set history = '[]'::jsonb where id = bid; exception when others then bg_msg := sqlerrm; end;
  end if;
  raise exception 'PROBE_RESULT|%|%|%|%|%', n_ev, ms, lock_msg, rm_msg, bg_msg;
end $probe$;"""
ok_, pr = sql(REF, PROBE)
msg = str(pr)
if "PROBE_RESULT|" in msg:
    parts = msg.split("PROBE_RESULT|", 1)[1].split("|")
    n_ev, ms, lock_m, rm_m, bg_m = parts[0], parts[1], parts[2], parts[3], parts[4].split('"')[0].split("\\")[0]
    say(f"  ✓ a probe applicant's OIG date change is kept with its before and after ({n_ev} history lines: added, then changed)") if n_ev == "2" else bad(f"evidence history probe wrote {n_ev} lines (expected 2)")
    say(f"  · one applicant save took about {ms} ms with both history watchers")
    if float(ms or 0) > 1500: bad(f"a save took {ms} ms; tell Claude before the office notices")
    say("  ✓ a signed GHE form's answers cannot be changed") if "answers cannot change" in lock_m else bad(f"GHE lock: {lock_m}")
    say("  ✓ a signed GHE form cannot be removed") if "cannot be removed" in rm_m else bad(f"GHE removal: {rm_m}")
    if bg_m == "no review to try": say("  · no background review with history yet; the guard was proven in the tests")
    else: say("  ✓ a background review's earlier history lines cannot be removed") if "can only have lines added" in bg_m else bad(f"bg_reviews: {bg_m}")
    say("  ✓ all of the probe was rolled back")
else: bad(f"the probe did not report: {msg[:300]}")
s_, b_ = http("POST", f"{FNB}/functions/v1/lead-docs-retention", {}, {"apikey": SVC, "Authorization": "Bearer " + SVC}, timeout=300)
try: j = json.loads(b_)
except Exception: j = {}
if s_ == 200 and j.get("live") is False and j.get("deleted") == 0: say(f"  ✓ the LTC policy purge is paused: it deleted nothing and listed {j.get('would_delete')} file(s) it would delete (in the automation log)")
else: bad(f"the purge practice run answered {s_}: {str(b_)[:200]}")
for fn in ("client-audit", "caregiver-export"):
    s_, b_ = http("POST", f"{FNB}/functions/v1/{fn}", {"action": "export"}, {"apikey": "", "Authorization": "Bearer "})
    say(f"  ✓ {fn} still refuses a caller with no sign-in ({s_})") if s_ in (401, 403) else bad(f"{fn} without a sign-in answered {s_}")
ok_, c2 = sql(REF, COUNTS)
if ok_:
    same = all(int(c2[0][k]) == int(c[0][k]) for k in ("files", "signed", "ghe", "bg", "bgh", "cc"))
    say(f"  ✓ nothing existing changed: {c2[0]['files']} document file(s), {c2[0]['ghe']} GHE form(s) ({c2[0]['signed']} signed), {c2[0]['bg']} background review(s) with {c2[0]['bgh']} history line(s), {c2[0]['cc']} care change(s)") if same else bad(f"before {c[0]} after {c2[0]}")
say("  · tested before deploying: 58 checks in a real Postgres (every watcher, the GHE lock and Amend, the bg_reviews guard, the storage rules, the rollback putting every rule back), the care tests 66 (reopen with a reason), the client audit 39 (Evidence changes in both exports, the as-of roster), 9 on the paused purge and the evidence reader, and 22 Hub looks.")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · from now on every change to audit evidence keeps what it said before; signed GHE forms are locked (Amend makes a corrected copy); documents can only be hidden, never deleted from the browser; the LTC policy purge only lists until its switch is on. Nothing was sent; nothing was deleted."); done(0)
