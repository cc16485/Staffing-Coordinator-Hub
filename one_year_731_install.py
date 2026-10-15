#!/usr/bin/env python3
# 731 · A YEAR OF PAID EXPERIENCE (Samantha, 2026-10-14: "we also need to require a year of paid experience"; unpaid family
# caregiving counts when "a hospice or home health nurse" or "family member can verify" it, "as an office review, not
# automatic"; "Yes, go in that order. Start Part A").
#   one_year_731.sql: the answer (yes / family / family_ok / no), the screening rule, the office's answer screen, the lock,
#     the follow-up stop, apply_save. One all-or-nothing step.
#   one_year_731_wording.sql: the job adverts and saved templates ask for a year of paid experience. One all-or-nothing step.
# SB_MODE=install (default)
#   Part 1, read only: the reviewed files; the live functions are exactly what this was built on (or already 731: a
#     re-run); copies of the live functions and of every job advert and template are saved before anything changes.
#   Part 2: the database change, then the advert wording.
#   Part 3, proof (nothing is sent, nothing is left behind): made-up applicants inside a step that is always undone; the
#     public is refused the office's screen.
# SB_MODE=proof: Part 1 and Part 3 only, on a project where 731 is already in. Changes nothing.
# SB_MODE=undo: puts the functions back (one_year_731_rollback.sql) and the advert wording back from the copy saved by the
#   install, then checks both.
# Prints counts only: no name, number, email, key or secret. Sends nothing.
import json, os, re, hashlib, urllib.request, urllib.error, datetime as dt, sys, glob

MODE = os.environ.get("SB_MODE", "install")
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
LOCAL = os.environ.get("SB_LOCAL_SOCK")          # rehearsal only: a throwaway local Postgres instead of the live project
API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
REF = "zngsgedlsxinbygwmxwn"
REPO = os.environ["SB_REPO"]                      # the reviewed code (pinned worktree)
SAVE_ROOT = os.environ.get("SB_SAVE", os.path.expanduser("~/Claude/checks/731-saved"))
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
SQLF, RBF, WF = "one_year_731.sql", "one_year_731_rollback.sql", "one_year_731_wording.sql"
PINS = json.loads(os.environ.get("SB_PINS", "{}"))   # {path: sha256} of the reviewed files
lines, fails, HIDE = [], [], []

def say(s=""):
    s = str(s)
    for h in HIDE:
        if h: s = s.replace(h, "(hidden)")
    s = re.sub(r"(sbp_|eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._\-]+", "(hidden)", s)
    s = re.sub(r"[\w.%+\-]+@[\w.\-]+\.[A-Za-z]{2,}", "(an email)", s)
    print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def chk(ok, msg): (say if ok else bad)(("  ✓ " if ok else "") + msg); return ok
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:300]); say("  Anything done above stays done; nothing after it ran. Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash

def http(method, url, body=None, headers=None, timeout=200):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-731/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}

def sql(q):
    """One script. Returns (ok, rows | error text)."""
    if LOCAL:
        from pg8000.native import Connection
        c = Connection(user="postgres", database="postgres", unix_sock=LOCAL)
        try:
            rows = c.run(q); names = [x["name"] for x in (c.columns or [])]
            return True, [dict(zip(names, r)) for r in (rows or [])]
        except Exception as e:
            try: c.run("rollback")
            except Exception: pass
            return False, (e.args[0].get("M") if e.args and isinstance(e.args[0], dict) else str(e))[:600]
        finally: c.close()
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, f"HTTP {s}: {b[:6000]}"   # long enough to hold the proof's whole answer
    try: return True, json.loads(b)
    except Exception: return False, b[:300]

sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
rd = lambda rel: open(os.path.join(REPO, rel)).read()
lit = lambda v: "null" if v is None else "'" + str(v).replace("'", "''") + "'"

def body(defn):
    """The function body exactly as stored (Postgres keeps it verbatim between the dollar quotes)."""
    m = re.search(r"AS \$(\w*)\$(.*)\$\1\$", defn or "", re.S)
    return m.group(2).strip() if m else None
def file_body(text, name, nargs=None):
    for m in re.finditer(r"CREATE OR REPLACE FUNCTION public\." + name + r"\((.*?)\)\s*\n?\s*RETURNS.*?AS \$(\w*)\$(.*?)\$\2\$", text, re.S | re.I):
        args = [a for a in m.group(1).split(",") if a.strip()]
        if nargs is None or len(args) == nargs: return m.group(3).strip()
    return None

# The five functions, by signature: what this was built on, and what 731 puts in.
SIGS = {
  "gap":    ("public.applicant_screening_gap(uuid)", "applicant_screening_gap", None),
  "office": ("public.applicant_screen_by_office(uuid,boolean,boolean,boolean,boolean,boolean)", "applicant_screen_by_office", 6),
  "guard":  ("public.job_applicants_screen_guard()", "job_applicants_screen_guard", None),
  "stop":   ("public.applicant_followup_stop(uuid)", "applicant_followup_stop", None),
  "save":   ("public.apply_save(uuid,jsonb,boolean)", "apply_save", None),
}
OFFICE8 = "public.applicant_screen_by_office(uuid,boolean,boolean,boolean,boolean,boolean,text,text)"
def live():
    """{key: body or None} for the five, with the office screen read from whichever version is there."""
    out = {}
    for k, (sig, _, _) in SIGS.items():
        if k == "office":
            ok, r = sql(f"select pg_get_functiondef(p.oid) d, pg_get_function_identity_arguments(p.oid) a from pg_proc p "
                        f"where p.proname = 'applicant_screen_by_office' and p.pronamespace = 'public'::regnamespace")
            out[k] = body(r[0]["d"]) if ok and len(r) == 1 else None
            out["office_args"] = (r[0]["a"].count(",") + 1) if ok and len(r) == 1 else len(r) if ok else None
            continue
        ok, r = sql(f"select pg_get_functiondef('{sig}'::regprocedure) d")
        out[k] = body(r[0]["d"]) if ok and r else None
    return out
def defs_text():
    q = " union all ".join(f"select pg_get_functiondef(p.oid) d from pg_proc p where p.oid = '{sig}'::regprocedure" for k, (sig, _, _) in SIGS.items() if k != "office")
    q += " union all select pg_get_functiondef(p.oid) d from pg_proc p where p.proname = 'applicant_screen_by_office' and p.pronamespace = 'public'::regnamespace"
    ok, r = sql(q)
    return "\n\n".join(x["d"] + ";" for x in r) if ok else None

# ---- the proof: made-up applicants inside one step that always ends by undoing itself ----
PROOF = r"""
do $proof$
declare r jsonb := '{}'::jsonb; a1 uuid; a2 uuid; a3 uuid; t text; office uuid;
begin
  -- a real office member's sign-in, as 647's proof does (the office screen is office staff only since 647)
  select ai.auth_user_id into office from public.auth_identities ai join public.staff_roles s on s.person_id = ai.person_id
   where s.entity = 'cc_ihs' and s.role = 'owner_admin' and ai.auth_user_id is not null limit 1;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  -- the form, as the public: family caregiving / under a year / a year or more
  a1 := public.apply_save(null, '{"first_name":"Proof","last_name":"Sevenone","email":"proof-731-a@example.invalid","position":"caregiver","channel":"self-test"}'::jsonb, false);
  perform public.apply_save(a1, '{"age_ok":true,"work_auth":true,"has_transport":true,"one_year":"family"}'::jsonb, false);
  perform public.apply_save(a1, '{"availability":"weekdays"}'::jsonb, true);
  a2 := public.apply_save(null, '{"first_name":"Proof","last_name":"Sevenoneb","email":"proof-731-b@example.invalid","position":"caregiver","channel":"self-test"}'::jsonb, false);
  perform public.apply_save(a2, '{"age_ok":true,"work_auth":true,"has_transport":true,"one_year":"no","decline_reason":"under one year of paid experience"}'::jsonb, false);
  a3 := public.apply_save(null, '{"first_name":"Proof","last_name":"Sevenonec","email":"proof-731-c@example.invalid","position":"caregiver","channel":"self-test"}'::jsonb, false);
  perform public.apply_save(a3, '{"age_ok":true,"work_auth":true,"has_transport":true,"one_year":"yes"}'::jsonb, false);
  perform public.apply_save(a3, '{"availability":"weekdays"}'::jsonb, true);
  r := r || jsonb_build_object('family_gap', coalesce(public.applicant_screening_gap(a1), 'none'),
                               'family_stop', coalesce(public.applicant_followup_stop(a1), 'none'),
                               'no_gap', coalesce(public.applicant_screening_gap(a2), 'none'),
                               'no_status', (select status from public.job_applicants where id = a2),
                               'yes_gap', coalesce(public.applicant_screening_gap(a3), 'none'));
  begin perform public.applicant_screen_by_office(a1, true, true, true, null, null, 'family_ok', 'Proof nurse'); t := 'saved';
  exception when others then t := sqlerrm; end;
  r := r || jsonb_build_object('public_office_door', t);
  perform set_config('request.jwt.claims', json_build_object('sub', office, 'role', 'authenticated', 'email', 'proof@example.invalid',
    'app_metadata', json_build_object('hub_access', json_build_array('care_coordinator')))::text, true);
  perform set_config('request.jwt.claim.sub', office::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  begin perform public.applicant_screen_by_office(a1, true, true, true, null, null, 'family_ok', null); t := 'saved';
  exception when others then t := sqlerrm; end;
  r := r || jsonb_build_object('verify_without_who', t);
  r := r || jsonb_build_object('office_verify', coalesce(public.applicant_screen_by_office(a1, true, true, true, null, null, 'family_ok', 'Proof nurse'), 'none'));
  begin update public.job_applicants set one_year = 'no' where id = a3; t := 'changed';
  exception when others then t := sqlerrm; end;
  r := r || jsonb_build_object('office_change_answer', t);
  raise exception 'PROOF731 %', r::text;
end $proof$;
"""
def proof_result():
    ok, r = sql(PROOF)
    # The live API returns the error inside a JSON string, so its quotes come back escaped (\"): undo that first. The first
    # real run (2026-10-14 20:30) proved everything but could not read its own answer because of this.
    txt = str(r).replace('\\"', '"'); i = txt.find("PROOF731 {")
    if ok or i < 0: return None, str(r)[:300]
    # raw_decode reads exactly one JSON object and stops, whatever follows it (the API's own closing quote and brace)
    try: return json.JSONDecoder().raw_decode(txt[i + len("PROOF731 "):])[0], None
    except Exception: return None, txt[i:i + 300]

ADVERT_COLS = ["summary", "description", "responsibilities", "qualifications", "benefits"]
def adverts():
    out = {}
    for tbl in ("job_postings", "job_templates"):
        ok, r = sql(f"select to_regclass('public.{tbl}') is not null as there")
        if not ok or not r[0]["there"]: out[tbl] = None; continue
        ok, r = sql(f"select id::text as id, {', '.join(ADVERT_COLS)} from public.{tbl} order by id")
        if not ok: return None
        out[tbl] = r
    return out

say(f"731 · A YEAR OF PAID EXPERIENCE ({'UNDO' if MODE == 'undo' else 'PROOF AGAIN, changes nothing' if MODE == 'proof' else 'install'})")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
if not LOCAL and not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
for rel, want in PINS.items():
    if not os.path.exists(os.path.join(REPO, rel)) or sha(os.path.join(REPO, rel)) != want:
        bad(f"{rel} is not the reviewed version"); say("  STOP. Nothing was run."); done(2)
if PINS: say(f"  ✓ the {len(PINS)} reviewed files are exactly what was tested")

S731, SRB, SW = rd(SQLF), rd(RBF), rd(WF)
S586, SNS = rd("screening_gate_586.sql"), rd("noshow_policy.sql")
BEFORE = {"gap": file_body(SRB, "applicant_screening_gap"), "office": file_body(SRB, "applicant_screen_by_office", 6),
          "guard": file_body(SRB, "job_applicants_screen_guard"), "stop": file_body(SRB, "applicant_followup_stop"),
          "save": file_body(SRB, "apply_save")}
AFTER = {"gap": file_body(S731, "applicant_screening_gap"), "office": file_body(S731, "applicant_screen_by_office", 8),
         "guard": file_body(S731, "job_applicants_screen_guard"), "stop": file_body(S731, "applicant_followup_stop"),
         "save": file_body(S731, "apply_save")}
# The rollback holds the very text this was built on: 586's four (the office screen as 647 left it) and noshow_policy's apply_save.
# 647 (2026-10-13) edited the office screen in place: "sign in first" became "office staff only" (one line).
O586 = "if coalesce(auth.role(),'anon') <> 'authenticated' then raise exception 'sign in first'; end if;"
O647 = "if not public.hub_office_ok() then raise exception 'office staff only'; end if;"
BUILT_ON = {"gap": file_body(S586, "applicant_screening_gap"), "office": (file_body(S586, "applicant_screen_by_office", 6) or "").replace(O586, O647),
            "guard": file_body(S586, "job_applicants_screen_guard"), "stop": file_body(S586, "applicant_followup_stop"),
            "save": file_body(SNS, "apply_save")}
if not all(BEFORE.values()) or not all(AFTER.values()) or BEFORE != BUILT_ON:
    bad("could not read the expected functions from the files (or the undo does not match what this was built on)"); done(2)
same = lambda L, want: all(L.get(k) == want[k] for k in want)

if MODE == "undo":
    say("UNDO · the functions")
    ok, r = sql(SRB)
    if not ok: bad("the undo didn't go in, and was undone as a whole (nothing changed): " + str(r)[:240]); done(6)
    L = live()
    chk(same(L, BEFORE) and L.get("office_args") == 6, "the screening rule, office screen, lock, follow-up stop and apply_save are back exactly as before 731")
    say("  Note: the Hub's applicant screens from 731 call the new office screen. If the Hub change was merged, it needs undoing too. Tell Claude.")
    say(); say("UNDO · the advert wording")
    saved = sorted(glob.glob(os.path.join(SAVE_ROOT, "*", "adverts.json")))
    if not saved: bad("no saved copy of the adverts was found; they were left as they are. Tell Claude.")
    else:
        old = json.load(open(saved[-1])); stmts = []
        for tbl, rows in old.items():
            for row in rows or []:
                stmts.append(f"update public.{tbl} set " + ", ".join(f"{c} = {lit(row[c])}" for c in ADVERT_COLS)
                             + f" where id::text = {lit(row['id'])} and (" + " or ".join(f"{c} is distinct from {lit(row[c])}" for c in ADVERT_COLS) + ");")
        ok, r = sql("begin;\n" + "\n".join(stmts) + "\ncommit;") if stmts else (True, [])
        now_ = adverts()
        same_ads = now_ is not None and all({x["id"]: x for x in (now_.get(t) or [])}.get(row["id"]) == row for t, rows in old.items() for row in rows or [])
        chk(ok and same_ads, "every advert and template is back to the words saved before 731")
    say(); say("UNDO COMPLETE." if not fails else f"{len(fails)} PROBLEM(S) ABOVE. Tell Claude.")
    done(0 if not fails else 4)

say("PART 1 · READ ONLY (nothing changes)")
L = live()
if any(L.get(k) is None for k in BEFORE): bad("couldn't read the live screening functions. Nothing was changed."); done(3)
state = ("before" if same(L, BEFORE) and L.get("office_args") == 6 else
         "after" if same(L, AFTER) and L.get("office_args") == 8 else "other")
if state == "other":
    which = [k for k in BEFORE if L.get(k) not in (BEFORE[k], AFTER[k])]
    bad("the live functions aren't the ones this was built on (someone changed them since): " + ", ".join(which) + ". Nothing was changed. Tell Claude."); done(3)
say("  ✓ the live screening functions are " + ("exactly what this was built on" if state == "before" else "already 731 (an earlier run): it will check and prove again"))
ok, r = sql("""select (select count(*) from public.job_applicants a where a.status in ('partial','new','reviewing') and a.one_year is null
      and not exists (select 1 from public.interview_bookings b where b.applicant_id = a.id and b.status = 'booked'))::int as waiting,
  (select count(*) from public.interview_bookings where status = 'booked' and starts_at > now())::int as upcoming""" if state == "after" else
  """select (select count(*) from public.job_applicants a where a.status in ('partial','new','reviewing')
      and not exists (select 1 from public.interview_bookings b where b.applicant_id = a.id and b.status = 'booked'))::int as waiting,
  (select count(*) from public.interview_bookings where status = 'booked' and starts_at > now())::int as upcoming""")
if not ok: bad("couldn't count the open applications. Nothing was changed. " + str(r)[:200]); done(3)
say(f"  ✓ {r[0]['upcoming']} interview(s) booked ahead now: all left exactly as they are")
say(f"  ·  {r[0]['waiting']} open application(s) with no interview booked: they get the experience question before an interview (the office's Ask these first, or their own link)")

if MODE == "proof" and state != "after": bad("731 isn't in yet, so there is nothing to prove. Nothing was changed."); done(3)
if MODE == "proof": say(); say("(PART 2 skipped: proof only, nothing changes)")
stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S"); save = os.path.join(SAVE_ROOT, stamp)
if MODE != "proof": os.makedirs(save, exist_ok=True)
if MODE != "proof":
    dt_ = defs_text(); ads = adverts()
    if not dt_ or ads is None: bad("couldn't save copies of the live functions and adverts. Nothing was changed."); done(3)
    open(os.path.join(save, "live_functions.sql"), "w").write("-- live before 731, " + stamp + "\n" + dt_ + "\n")
    # The advert copy is the words BEFORE 731, so it is saved only by the first install: a re-run would otherwise save the new
    # words, and the undo (which uses the latest copy) would "restore" those.
    if state == "before":
        json.dump(ads, open(os.path.join(save, "adverts.json"), "w"), indent=1)
        say(f"  ✓ copies of the live functions and of {sum(len(v or []) for v in ads.values())} adverts/templates saved (for the undo)")
    else:
        say("  ✓ a copy of the live functions saved; the adverts' words from before 731 were saved by the first install")

    say(); say("PART 2 · CHANGE")
    ok, r = sql(S731)
    if not ok: bad("the database change didn't go in, and was undone as a whole (nothing changed): " + str(r)[:300]); say("  STOP. Tell Claude."); done(6)
    L2 = live()
    if not chk(same(L2, AFTER) and L2.get("office_args") == 8, "the experience rule is in (the form, the screening rule, the office screen, the lock, the follow-up stop)"): done(6)
    ok, r = sql(SW)
    if not ok: bad("the advert wording didn't go in, and was undone as a whole (the experience rule above is in and fine on its own): " + str(r)[:300]); done(6)
    ads2 = adverts()
    changed = sum(1 for t, rows in (ads or {}).items() for row in rows or [] if {x["id"]: x for x in ((ads2 or {}).get(t) or [])}.get(row["id"]) != row)
    left = sum(1 for t, rows in (ads2 or {}).items() for row in rows or [] if any("Experience helps, but reliability" in (row.get(c) or "") for c in ADVERT_COLS))
    chk(left == 0, f"advert wording: {changed} advert(s)/template(s) now ask for a year of paid experience; none still say \"Experience helps\"")
    say("  ·  the website's job pages rebuild from these within the hour")

say(); say("PART 3 · PROOF (made-up applicants, always undone; nothing is sent)")
P, perr = proof_result()
if not P: bad("the proof couldn't run: " + str(perr)); done(7)
chk(P.get("yes_gap") == "none", "a year or more: they can book an interview")
chk(P.get("no_gap") == "ineligible" and P.get("no_status") == "declined", "under a year: the application ends there (declined) and can't book")
chk(P.get("family_gap") == "questions", "unpaid family caregiving: no interview until the office has verified it")
chk("verify family caregiving" in str(P.get("family_stop")), "...and the \"pick a time\" follow-up texts wait too")
chk("office staff only" in str(P.get("public_office_door")), "the public can't use the office's answer screen")
chk("who confirmed" in str(P.get("verify_without_who")), "the office has to say who confirmed the family caregiving")
chk(P.get("office_verify") == "none", "once the office verifies it, they can book")
chk("SCREENING_LOCKED" in str(P.get("office_change_answer")), "an answer already given can't be changed")
ok, r = sql("select count(*)::int as n from public.job_applicants where email like 'proof-731-%@example.invalid'")
chk(ok and r[0]["n"] == 0, "nothing made-up was left behind")

say(); say("731 COMPLETE. Nothing was sent." if not fails else f"{len(fails)} PROBLEM(S) ABOVE. Tell Claude. (To put everything back: the 731 undo step.)")
done(0 if not fails else 4)
