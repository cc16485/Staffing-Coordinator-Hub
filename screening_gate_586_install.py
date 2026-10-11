#!/usr/bin/env python3
# 586 · SCREENING BEFORE BOOKING (Samantha, 2026-10-11: "I approve moving forward with the screening fix, subject to the
# final deployment safeguards" and "approve deployment steps").
#   screening_gate_586.sql: no interview booking until the form's required questions are answered (every route), given
#     answers locked, a booking-table guard, booked_by, interviews already booked left as they are, the follow-up stop rule.
#   interview-messages: follow-ups stop on that rule; every message claimed before it is sent (no duplicates); texts need
#     this AND the latest application's yes to texts. Wording unchanged.
# SB_MODE=install (default)
#   Part 1, read only: the reviewed files; the live booking functions are exactly what this was built on (or already
#     586: a re-run); what it relies on is there; the live message code is main's (nobody else's un-installed work would
#     ride along). Saves copies of the live booking functions and the live message code before anything changes.
#   Part 2: the database change (one all-or-nothing step), then the message code.
#   Part 3, proof (nothing is sent, nothing is left behind): made-up applicants inside a step that is always undone; the
#     public is refused the office door; the live message code is the reviewed one; a practice run of the message job.
# SB_MODE=undo: puts the booking functions back (screening_gate_586_rollback.sql) and the message code back from the
#   copy saved by the install, then checks both.
# Prints counts only: no name, number, email, key or secret.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil, time, glob

MODE = os.environ.get("SB_MODE", "install")
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
LOCAL = os.environ.get("SB_LOCAL_SOCK")          # rehearsal only: a throwaway local Postgres instead of the live project
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
REF = "zngsgedlsxinbygwmxwn"; FN = "interview-messages"
REPO = os.environ["SB_REPO"]                      # the reviewed code (pinned worktree)
BASE = os.environ.get("SB_BASE", "")              # main just before 586 (its message code is what should be live now)
SAVE_ROOT = os.environ.get("SB_SAVE", os.path.expanduser("~/Claude/checks/586-saved"))
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
SQLF, RBF = "screening_gate_586.sql", "screening_gate_586_rollback.sql"
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
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-586/1.0"}, **(headers or {})))
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
    if s not in (200, 201): return False, f"HTTP {s}: {b[:600]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:300]

shab = lambda b: hashlib.sha256(b).hexdigest()
sha = lambda p: shab(open(p, "rb").read())
rd = lambda rel: open(os.path.join(REPO, rel)).read()

def body(defn):
    """The function body exactly as stored (Postgres keeps it verbatim between the $function$ quotes)."""
    m = re.search(r"\$function\$(.*)\$function\$", defn or "", re.S)
    return m.group(1).strip() if m else None
def file_body(text, name):
    m = re.search(r"CREATE OR REPLACE FUNCTION public\." + name + r"\(.*?AS \$function\$(.*?)\$function\$", text, re.S)
    return m.group(1).strip() if m else None
def live_defs():
    ok, r = sql("select pg_get_functiondef('public.interview_book(uuid,timestamptz)'::regprocedure) as book, "
                "pg_get_functiondef('public.interview_mine(uuid)'::regprocedure) as mine")
    return (r[0]["book"], r[0]["mine"]) if ok and r else (None, None)

# ---- message code (live project only) ----
def git(*a): return subprocess.run(["git", *a], cwd=REPO, capture_output=True)
def deps(path, seen):
    if path in seen or not os.path.exists(path): return
    seen.add(path)
    for m in re.findall(r"""from\s+['"](\.{1,2}/[^'"]+)['"]|import\s+['"](\.{1,2}/[^'"]+)['"]""", open(path).read()):
        deps(os.path.normpath(os.path.join(os.path.dirname(path), m[0] or m[1])), seen)
def need(root):
    s = set(); deps(os.path.join(root, f"supabase/functions/{FN}/index.ts"), s)
    return {os.path.relpath(x, root).replace(os.sep, "/") for x in s}
def download(into):
    os.makedirs(os.path.join(into, "supabase"), exist_ok=True)
    d = subprocess.run([SUPA, "functions", "download", FN, "--project-ref", REF, "--use-api"], cwd=into,
                       env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    files = {}
    for r, _, fs in os.walk(into):
        for f in fs:
            lp = os.path.join(r, f).replace(os.sep, "/")
            if "/functions/" in lp: files["supabase/functions/" + lp.split("/functions/", 1)[1]] = sha(lp)
    return d.returncode == 0, files
def base_sha(rel):
    b = git("show", f"{BASE}:{rel}")
    return shab(b.stdout) if b.returncode == 0 else None
def fmeta():
    s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{FN}", headers=MG())
    try: return json.loads(b) if s == 200 else None
    except Exception: return None
def deploy(root, vj):
    p = subprocess.run([SUPA, "functions", "deploy", FN, "--project-ref", REF, "--use-api"] + ([] if vj in (True, None) else ["--no-verify-jwt"]),
                       cwd=root, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    m = fmeta() or {}
    if m.get("verify_jwt") != (True if vj is None else vj):
        http("PATCH", f"{API}/v1/projects/{REF}/functions/{FN}", {"verify_jwt": True if vj is None else vj}, MG())
    return p.returncode == 0, (p.stderr or p.stdout)[-300:]
def keys():
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_")) and "·" not in v and "*" not in v
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys{q}", headers=MG())
        if s != 200: continue
        try: arr = json.loads(b)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        got = {k.get("name"): k.get("api_key", "") for k in arr if isinstance(k, dict)}
        got = {k: v for k, v in got.items() if usable(v)}
        if got.get("anon"): return got
    return {}

# ---- the proof: made-up applicants inside one step that always ends by undoing itself ----
PROOF = r"""
do $proof$
declare r jsonb := '{}'::jsonb; a1 uuid; a2 uuid; a3 uuid; t text;
  try text;
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  insert into public.job_applicants (first_name, last_name, email, status, position, channel)
    values ('Proof', 'Fivethree', 'proof-586-a@example.invalid', 'partial', 'caregiver', 'self-test') returning id into a1;
  r := r || jsonb_build_object('step1_gap', public.applicant_screening_gap(a1));
  begin perform public.interview_book(a1, now() + interval '3 days'); t := 'booked';
  exception when others then t := sqlerrm; end;
  r := r || jsonb_build_object('step1_book', t);
  r := r || jsonb_build_object('step1_link', public.interview_mine(a1)::jsonb->>'status');
  insert into public.job_applicants (first_name, last_name, email, status, position, channel, completed_at, age_ok, work_auth, has_transport)
    values ('Proof', 'Fivethreeb', 'proof-586-b@example.invalid', 'new', 'caregiver', 'self-test', now(), true, true, true) returning id into a2;
  r := r || jsonb_build_object('done_gap', coalesce(public.applicant_screening_gap(a2), 'none'));
  insert into public.job_applicants (first_name, last_name, email, status, position, channel, completed_at, age_ok, work_auth, has_transport)
    values ('Proof', 'Fivethreec', 'proof-586-c@example.invalid', 'new', 'caregiver', 'self-test', now(), true, true, false) returning id into a3;
  begin perform public.interview_book(a3, now() + interval '3 days'); t := 'booked';
  exception when others then t := sqlerrm; end;
  r := r || jsonb_build_object('said_no_book', t);
  begin insert into public.interview_bookings (applicant_id, starts_at, ends_at) values (a2, now() + interval '3 days', now() + interval '3 days 30 minutes'); t := 'inserted';
  exception when others then t := sqlerrm; end;
  r := r || jsonb_build_object('direct_insert', t);
  begin perform public.applicant_screen_by_office(a1, true, true, true); t := 'saved';
  exception when others then t := sqlerrm; end;
  r := r || jsonb_build_object('public_office_door', t);
  perform set_config('request.jwt.claims', '{"role":"authenticated","email":"proof@example.invalid"}', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  begin update public.job_applicants set has_transport = true where id = a3; t := 'changed';
  exception when others then t := sqlerrm; end;
  r := r || jsonb_build_object('office_change_answer', t);
  r := r || jsonb_build_object('office_fill', coalesce(public.applicant_screen_by_office(a1, true, true, true), 'none'));
  r := r || jsonb_build_object('stop_finished', coalesce(public.applicant_followup_stop(a2), 'none'),
                               'stop_said_no', coalesce(public.applicant_followup_stop(a3), 'none'));
  raise exception 'PROOF586 %', r::text;
end $proof$;
"""

def proof_result():
    ok, r = sql(PROOF)
    m = re.search(r"PROOF586 (\{.*\})", str(r), re.S)
    if ok or not m: return None, str(r)[:300]
    try: return json.loads(m.group(1)), None
    except Exception: return None, m.group(1)[:300]

say(f"586 · SCREENING BEFORE BOOKING ({'UNDO' if MODE == 'undo' else 'install'})")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
if not LOCAL and not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
for rel, want in PINS.items():
    if not os.path.exists(os.path.join(REPO, rel)) or sha(os.path.join(REPO, rel)) != want:
        bad(f"{rel} is not the reviewed version"); say("  STOP. Nothing was run."); done(2)
if PINS: say(f"  ✓ the {len(PINS)} reviewed files are exactly what was tested")

S586, SRB = rd(SQLF), rd(RBF)
BEFORE = (file_body(rd("interview_first_choice_512.sql"), "interview_book"), file_body(rd("interview_person_461.sql"), "interview_mine"))
AFTER = (file_body(S586, "interview_book"), file_body(S586, "interview_mine"))
if not all(BEFORE) or not all(AFTER): bad("could not read the expected booking functions from the files"); done(2)

if MODE == "undo":
    say("UNDO · the booking functions")
    ok, r = sql(SRB)
    if not ok: bad("the undo didn't go in, and was undone as a whole (nothing changed): " + str(r)[:240]); done(6)
    b, m = live_defs()
    chk((body(b), body(m)) == BEFORE, "interview_book and interview_mine are back exactly as before 586")
    ok, r = sql("select count(*)::int as n from pg_trigger where tgname in ('job_applicants_screen_guard','interview_bookings_screen_guard')")
    chk(ok and r[0]["n"] == 0, "both 586 guards are gone")
    if not LOCAL:
        say(); say("UNDO · the message code")
        saved = sorted(glob.glob(os.path.join(SAVE_ROOT, "*", "function")))
        if not saved: bad("no saved copy of the message code was found; it was left as is. Tell Claude.")
        else:
            root = saved[-1]; meta = json.load(open(os.path.join(os.path.dirname(root), "meta.json")))
            okd, err = deploy(root, meta.get("verify_jwt"))
            tmp = tempfile.mkdtemp(prefix="u586-"); okl, live = download(tmp); shutil.rmtree(tmp, ignore_errors=True)
            chk(okd and okl and all(live.get(k) == v for k, v in meta["files"].items()), "the message code is back to the copy saved before 586" + ("" if okd else ": " + err))
    say(); say("UNDO COMPLETE." if not fails else f"{len(fails)} PROBLEM(S) ABOVE. Tell Claude.")
    done(0 if not fails else 4)

say("PART 1 · READ ONLY (nothing changes)")
b, m = live_defs()
if not b or not m: bad("couldn't read the live booking functions. Nothing was changed."); done(3)
state = "before" if (body(b), body(m)) == BEFORE else "after" if (body(b), body(m)) == AFTER else "other"
if state == "other":
    bad("the live booking functions aren't the ones this was built on (someone changed them since). Nothing was changed. Tell Claude."); done(3)
say("  ✓ the live booking functions are " + ("exactly what this was built on" if state == "before" else "already 586 (an earlier run): it will check and prove again"))
ok, r = sql("""select (select count(*) from pg_proc where proname in ('applicant_person_ids','applicant_needs_review','applicant_noshow_match','interview_cancel','interview_reschedule'))::int as fns,
  (select count(*) from information_schema.columns where table_schema = 'public' and ((table_name = 'job_positions' and column_name = 'track')
     or (table_name = 'job_applicants' and column_name in ('prn','completed_at','age_ok','work_auth','has_transport','gave_up_at','review_cleared_at'))))::int as cols,
  (select count(*) from public.interview_bookings where status = 'booked' and starts_at > now())::int as upcoming""")
if not ok or r[0]["fns"] < 5 or r[0]["cols"] < 8: bad("something 586 relies on isn't there (unexpected). Nothing was changed. Tell Claude. " + str(r)[:200]); done(3)
say(f"  ✓ everything it relies on is there; {r[0]['upcoming']} interview(s) booked ahead now, all left as they are")

stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S"); save = os.path.join(SAVE_ROOT, stamp); os.makedirs(save, exist_ok=True)
open(os.path.join(save, "live_booking_functions.sql"), "w").write("-- live before 586, " + stamp + "\n" + b + ";\n\n" + m + ";\n")
vj = None
if not LOCAL:
    meta0 = fmeta() or {}; vj = meta0.get("verify_jwt")
    okd, live = download(os.path.join(save, "function"))
    if not okd or not live: bad("couldn't read the live message code. Nothing was changed."); done(3)
    nd = need(REPO); idx = f"supabase/functions/{FN}/index.ts"
    others = sorted(k for k in nd if k != idx and live.get(k) != sha(os.path.join(REPO, k)))
    if others:
        bad("the live message code is older than main in: " + ", ".join(x.split('functions/')[-1] for x in others)[:300] +
            ". Installing now would also put someone else's unfinished work live. Nothing was changed. Tell Claude.")
        done(3)
    if live.get(idx) not in (base_sha(idx), sha(os.path.join(REPO, idx))):
        bad("the live interview-messages isn't main's version (someone changed it since). Nothing was changed. Tell Claude."); done(3)
    json.dump({"verify_jwt": vj, "files": live, "saved": stamp}, open(os.path.join(save, "meta.json"), "w"), indent=1)
    say("  ✓ the live message code is main's; nothing else would ride along")
say(f"  ✓ copies of the live booking functions{'' if LOCAL else ' and message code'} saved (for the undo)")

say(); say("PART 2 · CHANGE")
ok, r = sql(S586)
if not ok: bad("the database change didn't go in, and was undone as a whole (nothing changed): " + str(r)[:300]); say("  STOP. Tell Claude."); done(6)
b2, m2 = live_defs()
if not chk((body(b2), body(m2)) == AFTER, "the screening rule is in (booking, their link, the office screen, the guards, the stop rule)"): done(6)
ok, r = sql("select count(*)::int as n from public.interview_bookings where screen_grandfathered")
say(f"  ✓ interviews booked before today without the screening answers, marked to stay as they are: {r[0]['n'] if ok else '?'}")
if not LOCAL:
    okd, err = deploy(REPO, vj)
    tmp = tempfile.mkdtemp(prefix="c586-"); okl, live = download(tmp); shutil.rmtree(tmp, ignore_errors=True)
    if not chk(okd and okl and all(live.get(k) == sha(os.path.join(REPO, k)) for k in need(REPO)), "the message code is the reviewed version" + ("" if okd else ": " + err)):
        say("  The database part is in and safe on its own (the old message code still works with it). Tell Claude."); done(6)

say(); say("PART 3 · PROOF (made-up applicants, always undone; nothing is sent)")
P, perr = proof_result()
if not P: bad("the proof couldn't run: " + str(perr)); done(7)
chk(P.get("step1_gap") == "questions" and "SCREEN_FIRST" in str(P.get("step1_book")), "someone who stopped after step 1 can't book (their link, the form, the office)")
chk(P.get("step1_link") == "screen_first", "their link takes them back to the questions")
chk(P.get("done_gap") == "none", "someone who finished with three yeses can book")
chk("SCREEN_FIRST: ineligible" in str(P.get("said_no_book")), "someone who said no can't book")
chk("SCREEN_FIRST" in str(P.get("direct_insert")), "a booking written straight into the table is refused")
chk("sign in first" in str(P.get("public_office_door")), "the public can't use the office's answer screen")
chk("SCREENING_LOCKED" in str(P.get("office_change_answer")), "an answer already given can't be changed")
chk(P.get("office_fill") == "none", "the office can fill in missing answers from a phone call")
chk(P.get("stop_finished") == "none" and P.get("stop_said_no") == "ineligible", "follow-ups: still go to someone who finished, stop for someone who said no")
ok, r = sql("select count(*)::int as n from public.job_applicants where email like 'proof-586-%@example.invalid'")
chk(ok and r[0]["n"] == 0, "nothing made-up was left behind")
if not LOCAL:
    K = keys(); ANON, SERVICE = K.get("anon", ""), K.get("service_role", ""); HIDE += [ANON, SERVICE]
    A = {"apikey": ANON, "Authorization": "Bearer " + ANON}
    s1, _ = http("POST", f"{FNB}/rest/v1/rpc/applicant_screen_by_office", {"p": "00000000-0000-0000-0000-000000000000", "p_age_ok": True, "p_work_auth": True, "p_has_transport": True}, A)
    s2, _ = http("POST", f"{FNB}/rest/v1/rpc/applicant_followup_stop", {"p": "00000000-0000-0000-0000-000000000000"}, A)
    s3, b3 = http("POST", f"{FNB}/rest/v1/rpc/interview_mine", {"p_applicant": "00000000-0000-0000-0000-000000000000"}, A)
    chk(s1 in (401, 403, 404) and s2 in (401, 403, 404) and s3 == 200, f"from the public website: office screen refused ({s1}), stop rule refused ({s2}), their link still works ({s3})")
    time.sleep(float(os.environ.get("SB_SETTLE", "8")))
    s4, b4 = http("POST", f"{FNB}/functions/v1/{FN}?dry=1", {}, {"Authorization": "Bearer " + SERVICE, "apikey": SERVICE})
    try: plan = (json.loads(b4) or {}).get("would") or {}
    except Exception: plan = {}
    if chk(s4 == 200, f"a practice run of the message job answered ({s4}); it sent nothing"):
        for k in ("confirm", "day", "hour", "nudge", "cancelled", "held"):
            say(f"    would {k}: {len(plan.get(k) or [])}")
        say(f"    of those held, by the new stop rule: {sum(1 for x in (plan.get('held') or []) if 'no follow-up' in str(x))}")

say(); say("586 COMPLETE. Nothing was sent." if not fails else f"{len(fails)} PROBLEM(S) ABOVE. Tell Claude. (To put everything back: the 586 undo step.)")
done(0 if not fails else 4)
