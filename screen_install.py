#!/usr/bin/env python3
# Desktop 354 · APPLICATIONS THAT GRADE THEMSELVES AGAIN. Samantha approved 2026-09-29 ("yes to all").
# Part 1 (read only): the reviewed build; the live screen, save step and their triggers are exactly what Desktop 353
#   copied (screen_live_353.sql; stops and keeps a copy otherwise); the counts before.
# Part 2: screen_fix.sql in one transaction (G1 the screen runs, G2 the ungraded get graded with no office texts,
#   G3 the do-not-rehire step runs + catch-up, G4 work history kept).
# Part 3 (proof; practice applications and a practice offboarding in a transaction that is undone; nothing is sent).
# Prints counts only: no name, number, email, key or secret.
import json, os, re, hashlib, urllib.request, urllib.error, datetime as dt, sys, uuid
REPORT = os.environ["SB_REPORT"]; REPO = os.environ["SB_REPO"]; SHAS = json.loads(os.environ["SB_FILE_SHAS"])
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
KEEP = os.environ.get("SB_KEEP_FILE", os.path.expanduser("~/Claude/screen-live-copy-354.sql"))
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for v in HIDE:
        if v: s = s.replace(v, "(hidden)")
    s = re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", s); s = re.sub(r"[\w.%+\-]+@[\w.\-]+\.[A-Za-z]{2,}", "(an email)", s)
    print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Anything done above stays done; nothing after it ran. Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=150):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-354/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql_raw(q): return http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
def sql(q):
    s, b = sql_raw(q)
    if s not in (200, 201): return False, f"HTTP {s}: {b[:300]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:200]
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
norm = lambda s: re.sub(r"\s+$", "", (s or "").replace("\r\n", "\n"))

say("354 · APPLICATIONS THAT GRADE THEMSELVES AGAIN"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
for name, want in SHAS.items():
    p = os.path.join(REPO, name)
    if not os.path.exists(p) or sha(p) != want: bad(f"{name} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
if not {"screen_fix.sql", "screen_live_353.sql"} <= set(SHAS): bad("the reviewed list is incomplete"); done(2)
say("  ✓ the fix and the copy it was written on are the reviewed builds")
LIVE = open(os.path.join(REPO, "screen_live_353.sql")).read()
want_fn = {n: re.search(r"(CREATE OR REPLACE FUNCTION public\." + n + r"\([\s\S]*?\$function\$);", LIVE).group(1) for n in ("applicant_screen", "applicant_screen_trigger", "apply_save")}
want_tg = {n: re.search(r"(CREATE TRIGGER " + n + r" [^\n]*);", LIVE).group(1) for n in ("applicant_screen_after", "offboard_to_dnr_after")}
ok, fx = sql("""select p.proname, pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname in ('applicant_screen','applicant_screen_trigger','apply_save','offboard_to_dnr','digits10')""")
ok2, tx = sql("select tgname, pg_get_triggerdef(t.oid) as def from pg_trigger t where tgrelid = 'public.job_applicants'::regclass and not tgisinternal")
if not ok or not ok2: bad("could not read the live code. Nothing was changed."); done(4)
got_fn = {r["proname"]: r["def"] for r in fx}; got_tg = {r["tgname"]: r["def"] for r in tx}
diff = [n for n, d in want_fn.items() if norm(got_fn.get(n)) != norm(d)] + [n for n, d in want_tg.items() if norm(got_tg.get(n)) != norm(d)]
if "offboard_to_dnr" not in got_fn or "insert into public.do_not_rehire" not in (got_fn.get("offboard_to_dnr") or "") or "digits10" not in got_fn: diff.append("offboard_to_dnr / digits10")
if diff:
    open(KEEP, "w").write("\n\n".join([f"-- {k}\n{v};" for k, v in list(got_fn.items()) + list(got_tg.items())]))
    bad("the live code is NOT what 353 copied (" + ", ".join(diff) + f"). Nothing was changed; the live code is kept at {KEEP} for Claude."); done(5)
say("  ✓ the live screen, save step and both triggers are exactly what 353 copied")
COUNTS = """select
  (select count(*) from public.job_applicants where completed_at is not null and screen_grade is null)::int as ungraded,
  (select count(*) from public.job_applicants a where rehire_ok = false and left_at is not null
     and (public.digits10(a.phone) is not null or a.email is not null)
     and not exists (select 1 from public.do_not_rehire d where (public.digits10(a.phone) is not null and public.digits10(d.phone_digits) = public.digits10(a.phone))
                                                      or (a.email is not null and d.email is not null and lower(d.email) = lower(a.email))))::int as dnr_missing,
  (select count(*) from public.job_applicants where completed_at >= '2026-08-03' and work_history is null)::int as no_history,
  (select count(*) from public.do_not_rehire where added_by like 'catch-up 354:%')::int as caught_up,
  (select count(*) from public.job_applicants where completed_at is not null and screen_grade is null and office_alerted_at is null
     and created_at >= now() - interval '3 days')::int as would_alert"""
ok, c0 = sql(COUNTS)
if not ok or not c0: bad("could not count. Nothing was changed."); done(4)
C0 = c0[0]
say(f"  · before: {C0['ungraded']} finished applications with no grade · {C0['dnr_missing']} {'person' if C0['dnr_missing'] == 1 else 'people'} marked \"would not have back\" who aren't on the do-not-rehire list"
    + f" · {C0['no_history']} finished since Aug 3 with no work history")

say(); say("PART 2 · CHANGE")
ok, r = sql("begin;\n" + open(os.path.join(REPO, "screen_fix.sql")).read() + "\ncommit;")
if not ok: bad("the fix didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Tell Claude."); done(6)
ok, tx = sql("select tgname, pg_get_triggerdef(t.oid) as def from pg_trigger t where tgrelid = 'public.job_applicants'::regclass and not tgisinternal")
tg = {x["tgname"]: x["def"] for x in (tx or [])} if ok else {}
g = all("pg_trigger_depth() < 1" in tg.get(n, "") for n in ("applicant_screen_after", "offboard_to_dnr_after"))
(say if g else bad)(("  ✓ " if g else "") + "the screen and the do-not-rehire step now run when an application is sent or someone is offboarded")
ok, c1 = sql(COUNTS); C1 = c1[0] if ok and c1 else {}
g = C1.get("ungraded") == 0
(say if g else bad)(("  ✓ " if g else "") + f"graded now: {C0['ungraded']} → {C1.get('ungraded')} left with no grade · none of them announced to the office (as you chose)")
ok, gr = sql("""select coalesce(screen_grade, 'none') as grade, count(*)::int as n from public.job_applicants
                where completed_at is not null and created_at >= '2026-08-03' group by 1 order by 1""")
if ok and gr: say("  · applications since Aug 3 by grade: " + " · ".join(f"{ {'qualified': 'cleared', 'review': 'needs a look', 'duplicate': 'applied before'}.get(x['grade'], x['grade'])} {x['n']}" for x in gr))
g = C1.get("dnr_missing") == 0 and C1.get("caught_up") == C0["dnr_missing"]
(say if g else bad)(("  ✓ " if g else "") + f"do-not-rehire: {C1.get('caught_up')} added (the people the Hub already said were added) · {C1.get('dnr_missing')} still missing")
say("  ✓ the save step keeps \"Where have you worked?\" again (the proof below checks it)")

say(); say("PART 3 · PROOF (practice applications and a practice offboarding, all undone; nothing is sent)")
tag = uuid.uuid4().hex[:10]; E = {k: f"p354-{k}-{tag}@example.invalid" for k in ("a", "b", "c", "d")}; HIDE += list(E.values())
PROOF = """do $proof$
declare a uuid; a2 uuid; b1 uuid; b2 uuid; c1 uuid; c2 uuid; d1 uuid; d2 uuid; e uuid; outv jsonb;
  shared jsonb := '{"age_ok":true,"work_auth":true,"has_transport":true,"has_license":true,"has_insurance":true,"can_pass_background":true,"lived_outside_mo":false}'::jsonb;
  start jsonb := '{"first_name":"354 practice","last_name":"(undone)","zip":"65802","sms_consent":false,"experience_kinds":["I have worked for a home care agency"]}'::jsonb;
  earlier constant interval := interval '1 day';
begin
  -- a: a new application, with two jobs, is graded when sent and keeps its jobs
  a := public.apply_save(null, start || jsonb_build_object('email', %(ea)s), false);
  perform public.apply_save(a, shared || '{"position":"caregiver"}'::jsonb, false);
  perform public.apply_save(a, '{"availability":"practice","work_history":[{"employer":"A","role":"CNA"},{"employer":"B","role":"Aide"}]}'::jsonb, true);
  update public.job_applicants set created_at = created_at - earlier where id = a;
  -- b: applied before
  b1 := public.apply_save(null, start || jsonb_build_object('email', %(eb)s), false);
  perform public.apply_save(b1, shared, false); perform public.apply_save(b1, '{"availability":"practice"}'::jsonb, true);
  update public.job_applicants set created_at = created_at - earlier where id = b1;
  b2 := public.apply_save(null, start || jsonb_build_object('email', %(eb)s), false);
  perform public.apply_save(b2, shared, false); perform public.apply_save(b2, '{"availability":"practice"}'::jsonb, true);
  -- c: their own unfinished start first
  c1 := public.apply_save(null, start || jsonb_build_object('email', %(ec)s), false);
  update public.job_applicants set created_at = created_at - earlier where id = c1;
  c2 := public.apply_save(null, start || jsonb_build_object('email', %(ec)s), false);
  perform public.apply_save(c2, shared, false); perform public.apply_save(c2, '{"availability":"practice"}'::jsonb, true);
  -- d: declined before
  d1 := public.apply_save(null, start || jsonb_build_object('email', %(ed)s), false);
  perform public.apply_save(d1, shared || '{"decline_reason":"practice"}'::jsonb, false);
  update public.job_applicants set created_at = created_at - earlier where id = d1;
  d2 := public.apply_save(null, start || jsonb_build_object('email', %(ed)s), false);
  perform public.apply_save(d2, shared, false); perform public.apply_save(d2, '{"availability":"practice"}'::jsonb, true);
  -- the offboarding: a leaves, would not have back; then applies again
  update public.job_applicants set status = 'left', left_at = current_date, rehire_ok = false, offboarded_by = '354 practice' where id = a;
  a2 := public.apply_save(null, start || jsonb_build_object('email', %(ea)s), false);
  perform public.apply_save(a2, shared, false); perform public.apply_save(a2, '{"availability":"practice"}'::jsonb, true);
  -- e: PRN, under a year
  e := public.apply_save(null, start, false);
  perform public.apply_prn_save(e, 'prn_cna', '{"cna":true,"one_year":false,"days":["tue"],"times":["morning"],"notice":"24h"}'::jsonb, true);
  perform public.apply_save(e, shared || '{"position":"prn_cna"}'::jsonb, false);
  perform public.apply_save(e, '{"availability":"practice"}'::jsonb, true);
  select jsonb_build_object(
    'a', (select jsonb_build_object('grade', screen_grade, 'jobs', jsonb_array_length(coalesce(work_history, '[]'::jsonb))) from public.job_applicants where id = a),
    'b', (select jsonb_build_object('grade', screen_grade, 'warned', exists (select 1 from unnest(screen_flags) f where f ~* 'applied before')) from public.job_applicants where id = b2),
    'c', (select jsonb_build_object('grade', screen_grade) from public.job_applicants where id = c2),
    'd', (select jsonb_build_object('grade', screen_grade, 'warned', exists (select 1 from unnest(screen_flags) f where f ~* 'previously declined')) from public.job_applicants where id = d2),
    'dnr', (select count(*) from public.do_not_rehire where lower(email) = lower(%(ea)s)),
    'a2', (select jsonb_build_object('grade', screen_grade, 'rehire', 'not eligible for rehire' = any(screen_flags)) from public.job_applicants where id = a2),
    'e', (select jsonb_build_object('grade', screen_grade, 'under', 'under a year of caregiving experience' = any(screen_flags)) from public.job_applicants where id = e)) into outv;
  raise exception 'SCREEN_PROOF:%%', outv::text;
end $proof$;""" % {k: "'" + v + "'" for k, v in (("ea", E["a"]), ("eb", E["b"]), ("ec", E["c"]), ("ed", E["d"]))}
s, b = sql_raw(PROOF)
try: msg = json.loads(b).get("message", "")
except Exception: msg = b or ""
P = None
if "SCREEN_PROOF:" in msg:
    try: P = json.JSONDecoder().raw_decode(msg[msg.index("SCREEN_PROOF:") + 13:])[0]
    except Exception: P = None
if not P: bad("the practice applications didn't run: " + re.sub(r"\s+", " ", msg)[:300])
else:
    def chk(good, text, detail): (say if good else bad)(("  ✓ " if good else "") + text + ("" if good else " · " + json.dumps(detail)[:200]))
    chk((P.get("a") or {}).get("grade") == "qualified", "a new application is graded the moment it's sent (cleared the screen)", P.get("a"))
    chk((P.get("a") or {}).get("jobs") == 2, "its two jobs are kept", P.get("a"))
    chk((P.get("b") or {}).get("grade") == "duplicate" and (P.get("b") or {}).get("warned"), "applying again: \"applied before\", with the warning kept", P.get("b"))
    chk((P.get("c") or {}).get("grade") == "qualified", "their own unfinished first try doesn't make them a repeat", P.get("c"))
    chk((P.get("d") or {}).get("grade") == "duplicate" and (P.get("d") or {}).get("warned"), "declined before: the \"Previously DECLINED\" warning is kept", P.get("d"))
    chk(P.get("dnr") == 1, "offboarding with \"would not have back\" adds them to the do-not-rehire list", P.get("dnr"))
    chk((P.get("a2") or {}).get("rehire"), "... and when they apply again, the screen flags \"not eligible for rehire\"", P.get("a2"))
    chk((P.get("e") or {}).get("grade") == "review" and (P.get("e") or {}).get("under"), "a PRN application under a year: graded, then needs a look (the PRN checks still work beside it)", P.get("e"))
ok, left = sql("""select (select count(*) from public.job_applicants where first_name = '354 practice')::int as apps,
                         (select count(*) from public.do_not_rehire where added_by = '354 practice' or email like 'p354-%')::int as dnr""")
g = ok and left and left[0]["apps"] == 0 and left[0]["dnr"] == 0
(say if g else bad)(("  ✓ " if g else "") + "nothing from the practice was kept")
s, kb = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers=MG())
try: keys = {k.get("name"): k.get("api_key", "") for k in json.loads(kb)}
except Exception: keys = {}
SVC = keys.get("service_role", ""); HIDE.append(SVC)
sD, bD = http("POST", f"{FNB}/functions/v1/interview-messages?dry=1", {}, {"apikey": SVC, "Authorization": "Bearer " + SVC}, 300)
try: j = json.loads(bD)
except Exception: j = {}
w = j.get("would") or {}
g = sD == 200 and j.get("dry") is True
(say if g else bad)(("  ✓ " if g else "") + (f"a practice run of the interview texts: {len(w.get('alerted', []))} office alert(s) would go now (the caught-up ones are marked as announced)" if g else f"practice run of the interview texts: HTTP {sD}"))
say()
say("RESULT: " + ("DONE · applications grade themselves again. Next: run 352 again to publish the PRN CNA ad." if not fails else "CHECK THE ✗ LINES."))
say("Rollback: screen_rollback.sql puts back the exact code from before and removes the catch-up rows (Claude can run it).")
done(0 if not fails else 8)
