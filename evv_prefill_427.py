#!/usr/bin/env python3
# 427 · THE PRE-FILLED, VISIT-LINKED EVV CORRECTION FORM. Samantha 2026-10-03 ("go"): the EVV form link in the two texts
# that already carry it (the person-tapped "Text <caregiver> the EVV form" on the missed clock-in page, and the clock-out
# reminder) opens the form already filled in for that visit; the signed form arrives in the Hub already linked to the
# caregiver, the client and the AxisCare visit, and Check AxisCare uses that visit directly.
# Her rule stands: the EVV form is NEVER sent automatically on a missed clock-in. Nothing new is sent at all; only the
# link inside those two existing texts changes (the link carries only a random token, never a name, phone or date).
# The Hub project (zngsgedlsxinbygwmxwn) only. MUST RUN AFTER 426 (it checks).
# Part 1 (READ ONLY): the reviewed builds (SQL, proof and every changed function file pinned), the tests pass here, 426
#   is live, the EVV forms table is ready (422) and who owns it, the clock-out reminder's wording, the switches.
# Part 2 (CHANGE): evv_prefill_427.sql in one transaction (the staff-only evv_prefill table; two public functions that
#   show only the few words the form needs and save a signed form from a link). Then redeploys evv-axiscare-check,
#   clockin-alert and timekeeper-watch, each only if its live copy is the expected build (426 / 422) or already this one,
#   keeping its gateway sign-in setting.
# Part 3 (PROOF, NOTHING STAYS, NOTHING SENT): inside one transaction that is always rolled back: a made-up link, the
#   public can't read the table, the link gives only the allowed words, an unsigned form is refused, a signed one is
#   saved already linked, the used and the expired link are refused. Then over the real web with the public key; the
#   live functions are the reviewed builds; one practice run of the timekeeper (?dry=1, texts nobody, makes no link);
#   every switch is as it was.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil, uuid
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
REF = "zngsgedlsxinbygwmxwn"
ROOT = os.environ["SB_REPO"]
SHAS = json.loads(os.environ.get("SB_SHAS", "{}")); PREV = json.loads(os.environ.get("SB_PREV", "{}"))
SQL_SHA, PROOF_SHA = os.environ.get("SB_SQL_SHA", ""), os.environ.get("SB_PROOF_SHA", "")
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FORM_URL = os.environ.get("SB_FORM_URL", "https://sc.mo-care.com/evv-correction-form.html")
SKIP_TESTS = os.environ.get("SB_SKIP_TESTS") == "1"
SQLFILE, PROOFFILE = "evv_prefill_427.sql", "evv_prefill_427_proof.sql"
ORDER = ["evv-axiscare-check", "clockin-alert", "timekeeper-watch"]
PINNED = {"evv-axiscare-check", "clockin-alert", "timekeeper-watch", "_shared/evv-prefill"}
TESTS = ["evv_prefill_427_test.mjs", "c1_missed_clockin_test.mjs", "evv_forms_422_test.mjs", "quiet_hours_425_test.mjs", "late_l1_test.mjs",
         "missed_notes_test.mjs", "j1_job_locks_test.mjs", "staff_alerts_one_contact_test.mjs"]
SWITCHES = ["timekeeper_watch_live", "timekeeper_text_live", "timekeeper_admin_loop_live", "evv_chase_live", "missed_clockin_after_hours",
            "office_quiet_start", "office_quiet_end", "timekeeper_clockout_grace_min"]
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for h in HIDE:
        if h: s = s.replace(h, "(hidden)")
    s = re.sub(r"(sbp_|eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._\-]+", "(hidden)", s)
    s = re.sub(r"[\w.%+\-]+@(?!invalid\.test)[\w.\-]+\.[A-Za-z]{2,}", "(an email)", s)
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
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-evv427/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def jl(b):
    try: return json.loads(b)
    except Exception: return None
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, f"HTTP {s}: {b[:400]}"
    j = jl(b)
    return (True, j) if j is not None else (False, b[:200])
def fmeta(fn):
    s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{fn}", headers=MG())
    return s, (jl(b) if s == 200 else None)
def keys():
    """The project's keys. Lesson from 412: ask with ?reveal=true first, then without it. A value that isn't a usable key counts as missing."""
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_publishable_") or v.startswith("sb_secret_")) and "·" not in v and "*" not in v
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys{q}", headers=MG())
        if s != 200: continue
        arr = jl(b)
        if isinstance(arr, dict): arr = arr.get("keys") or []
        if not isinstance(arr, list): continue
        got = {k.get("name"): k.get("api_key", "") for k in arr if isinstance(k, dict)}
        got = {k: v for k, v in got.items() if usable(v)}
        if got.get("anon"): return got
    return {}
shab = lambda b: hashlib.sha256(b).hexdigest()
sha = lambda p: shab(open(p, "rb").read())
def chk(good, msg): (say if good else bad)(("  ✓ " if good else "") + msg)
pinpath = lambda k: f"supabase/functions/{k}.ts" if k.startswith("_shared/") else f"supabase/functions/{k}/index.ts"
def deps(path, seen):
    if path in seen or not os.path.exists(path): return
    seen.add(path)
    for m in re.findall(r"""from\s+['"](\.{1,2}/[^'"]+)['"]|import\s+['"](\.{1,2}/[^'"]+)['"]""", open(path).read()):
        deps(os.path.normpath(os.path.join(os.path.dirname(path), m[0] or m[1])), seen)
def deps_of(fn):
    s = set(); deps(os.path.join(ROOT, f"supabase/functions/{fn}/index.ts"), s)
    return {os.path.relpath(x, ROOT).replace(os.sep, "/") for x in s}
def live_files(fn):
    tmp = tempfile.mkdtemp(prefix="evv427-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
    d = subprocess.run([SUPA, "functions", "download", fn, "--project-ref", REF, "--use-api"], cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    live = {}
    for root, _, files in os.walk(tmp):
        for f in files:
            lp = os.path.join(root, f).replace(os.sep, "/")
            if "/functions/" in lp: live["supabase/functions/" + lp.split("/functions/", 1)[1]] = sha(lp)
    shutil.rmtree(tmp, ignore_errors=True)
    return d.returncode == 0, live
def is_reviewed_live(fn):
    okd, live = live_files(fn)
    if not okd: return False, "couldn't read the live copy"
    need = deps_of(fn)
    missing = [k for k in need if k not in live]
    if missing: return False, "live copy is missing " + ", ".join(sorted(k.split("functions/", 1)[1] for k in missing))
    off = [k for k in need if live[k] != sha(os.path.join(ROOT, k))]
    return (not off), ("" if not off else "live differs in " + ", ".join(sorted(k.split("functions/", 1)[1] for k in off)))
def live_state(fn):
    """'mine' (already this build) | 'expected' (the build before this one: 426 / 422) | 'other' | 'unreadable'"""
    okd, live = live_files(fn)
    mine = pinpath(fn)
    if not okd or mine not in live: return "unreadable", live
    if all(k in live and live[k] == sha(os.path.join(ROOT, k)) for k in deps_of(fn)): return "mine", live
    return ("expected" if live[mine] == PREV.get(fn) else "other"), live

def deploy(fn):
    sM, m = fmeta(fn)
    if sM == 404: bad(f"{fn} is not deployed. Tell Claude."); return False
    vj = (m or {}).get("verify_jwt")
    if not isinstance(vj, bool): bad(f"{fn}: couldn't read its gateway setting, NOT changed"); return False
    st, live = live_state(fn)
    if st == "mine": say(f"  ✓ {fn} already had it"); return True
    if st != "expected": bad(f"{fn}: its live code is not the build 427 was made on ({st}), NOT changed. Tell Claude."); return False
    need = deps_of(fn)
    other = [k.split("supabase/functions/", 1)[1] for k in need if k != pinpath(fn) and k != pinpath("_shared/evv-prefill") and (k not in live or live[k] != sha(os.path.join(ROOT, k)))]
    if other: bad(f"{fn}: live shared code differs from GitHub ({', '.join(sorted(other))[:160]}), NOT changed"); return False
    p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"] + ([] if vj else ["--no-verify-jwt"]),
                       cwd=ROOT, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    if p.returncode != 0:
        # Lesson from 394: a deploy can answer 500 'internal error' and still have gone through. Look before calling it failed.
        good, _ = is_reviewed_live(fn)
        if not good: bad(f"{fn} didn't deploy: " + (p.stderr or p.stdout)[-200:]); return False
        say(f"  · {fn}: the deploy answered with an error, but the live copy IS the reviewed build")
    sN, mN = fmeta(fn)
    if (mN or {}).get("verify_jwt") != vj:
        http("PATCH", f"{API}/v1/projects/{REF}/functions/{fn}", {"verify_jwt": vj}, MG()); sN, mN = fmeta(fn)
        if (mN or {}).get("verify_jwt") != vj: bad(f"{fn}: its gateway setting changed and couldn't be put back. Tell Claude."); return False
    say(f"  ✓ {fn} deployed, now version {(mN or {}).get('version', '?')} (was {(m or {}).get('version', '?')}; gateway sign-in check kept {'on' if vj else 'off'})")
    return True

SWQ = "select " + ", ".join(f"data->'{k}' as \"{k}\"" for k in SWITCHES) + ", data->>'timekeeper_msg_out' as msg_out from public.app_data where key = 'ops_settings'"
def switches():
    ok, r = sql(SWQ)
    return (r[0] if ok and r else None)
word = lambda v: "ON" if v is True else ("off" if v in (False, None) else str(v))

say("427 · THE PRE-FILLED, VISIT-LINKED EVV CORRECTION FORM"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
for f, want in ((SQLFILE, SQL_SHA), (PROOFFILE, PROOF_SHA)):
    p = os.path.join(ROOT, f)
    if not want or not os.path.exists(p) or sha(p) != want: bad(f"{f} is not the reviewed version"); say("  STOP. Nothing was run."); done(2)
if set(SHAS) != PINNED or any(not os.path.exists(os.path.join(ROOT, pinpath(k))) or sha(os.path.join(ROOT, pinpath(k))) != v for k, v in SHAS.items()):
    bad("the changed function files are not the reviewed build"); say("  STOP. Nothing was run."); done(2)
if set(PREV) != set(ORDER): bad("the expected live builds are not pinned"); say("  STOP. Nothing was run."); done(2)
users = sorted(fn for fn in os.listdir(os.path.join(ROOT, "supabase/functions")) if not fn.startswith("_") and os.path.exists(os.path.join(ROOT, f"supabase/functions/{fn}/index.ts"))
               and pinpath("_shared/evv-prefill") in deps_of(fn))
if users != ["clockin-alert", "timekeeper-watch"]: bad(f"the new link helper is used by unexpected functions ({', '.join(users)})"); say("  STOP. Nothing was run."); done(2)
SQLTEXT, PROOFTEXT = open(os.path.join(ROOT, SQLFILE)).read(), open(os.path.join(ROOT, PROOFFILE)).read()
say(f"  ✓ {SQLFILE}, {PROOFFILE} and the 4 changed function files are the reviewed builds; functions to update: {', '.join(ORDER)}")
NODE = shutil.which("node") or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.path.exists(p)), "")
if SKIP_TESTS: say("  · (rehearsal) tests not re-run")
elif NODE:
    for t in TESTS:
        p = subprocess.run([NODE, t], cwd=ROOT, capture_output=True, text=True)
        last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
        if p.returncode != 0 or "FAIL" in last or re.search(r"^FAIL", p.stdout, re.M): bad(f"{t} failed: {last}"); say("  STOP. Nothing was run."); done(2)
        say(f"  ✓ {t}: {last.strip()} (run here, against fakes; nothing sent)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
if not SUPA or not os.path.exists(SUPA): bad("the supabase command line tool wasn't found. Nothing was changed."); done(3)

# 426 first: the live missed clock-in functions must be the 426 build (or already this one)
for fn in ("timekeeper-watch", "clockin-alert"):
    st, _ = live_state(fn)
    if st not in ("expected", "mine"):
        bad(f"{fn} live is not the 426 build ({st}). Run Desktop 426 first (after-hours missed clock-ins), then this."); say("  STOP. Nothing was changed."); done(3)
say("  ✓ 426 is live (timekeeper-watch and clockin-alert are its build), so 427 goes on top of it")
st, _ = live_state("evv-axiscare-check")
if st not in ("expected", "mine"): bad(f"evv-axiscare-check live is not the 422 build ({st}). Nothing was changed. Tell Claude."); done(3)

ok, cols = sql("select column_name as c, data_type as t from information_schema.columns where table_schema = 'public' and table_name = 'evv_submissions'")
COLS = {r["c"]: r["t"] for r in cols} if ok else {}
if "axiscare_visit_id" not in COLS: bad("the EVV forms table is not ready (422 has not run): " + str(cols)[:200]); say("  STOP. Nothing was changed."); done(3)
say(f"  · EVV forms table column types: visit date {COLS.get('visitdate')}, times {COLS.get('new_in')}, id {COLS.get('id')} (the save casts to whatever they are)")
if COLS.get("id") != "uuid": bad("evv_submissions.id is not a uuid; the link's form number would not fit. Nothing was changed. Tell Claude."); done(3)
ok, own = sql("select (select tableowner from pg_tables where schemaname = 'public' and tablename = 'evv_submissions') as owner, current_user as me, "
              "(select rolbypassrls from pg_roles where rolname = current_user) as bypass, "
              "(select relforcerowsecurity from pg_class where oid = 'public.evv_submissions'::regclass) as forced")
o = (own or [{}])[0] if ok else {}
if not ok or not ((o.get("owner") == o.get("me") or o.get("bypass")) and not o.get("forced")):
    bad(f"the save function would run as {o.get('me')} but the forms table belongs to {o.get('owner')} (bypass {o.get('bypass')}, forced {o.get('forced')}), so it could not save. Nothing was changed. Tell Claude."); done(3)
say(f"  ✓ the forms table belongs to {o.get('owner')}; the save function (made by {o.get('me')}) can write it")
ok, ex = sql("select to_regclass('public.evv_prefill') is not null as t, (select count(*)::int from pg_proc where proname in ('evv_prefill_get', 'evv_submit_prefilled')) as f")
if ok and ex and (ex[0]["t"] or ex[0]["f"]): say("  · evv_prefill / its functions are already there (running the SQL again is safe)")
ok, trg = sql("select t.tgname, (p.prosrc ~* '(net\\.|http_post|http_get|pg_net|supabase_functions)') as calls_out from pg_trigger t join pg_proc p on p.oid = t.tgfoid "
              "where t.tgrelid = 'public.evv_submissions'::regclass and not t.tgisinternal")
OTHER_CALLERS = [r["tgname"] for r in (trg if ok else []) if r["calls_out"]]
BEFORE = switches()
if BEFORE is None: bad("couldn't read the settings (ops_settings). Nothing was changed."); done(3)
say("  · switches now: " + ", ".join(f"{k} {word(BEFORE.get(k))}" for k in ("timekeeper_watch_live", "timekeeper_text_live", "timekeeper_admin_loop_live", "evv_chase_live")) + ". This installer changes none of them.")
mo = BEFORE.get("msg_out")
if not mo: say("  ✓ the clock-out reminder uses the built-in wording (it has the form link, so it gets the pre-filled one)")
elif re.search(r"sc\.mo-care\.com/evv-correction-form", mo): say("  ✓ the clock-out reminder uses her own wording (timekeeper_msg_out), which has the form link, so it gets the pre-filled one")
else: say("  · ATTENTION: her own clock-out wording (timekeeper_msg_out) has no form link, so that reminder stays as it is (nothing is added)")
say("  · the timekeeper's caregiver texts are " + ("ON, so a clock-out reminder will carry the pre-filled link" if BEFORE.get("timekeeper_text_live") is True and BEFORE.get("timekeeper_watch_live") is True
    else "OFF, so clock-out reminders are not being sent; the person-tapped EVV text still works"))
K = keys(); ANON, SERVICE = K.get("anon", ""), K.get("service_role", "")
HIDE += [ANON, SERVICE]
if not ANON: bad("couldn't read the project's public key. Nothing was changed."); done(3)
say("  ✓ read the project's keys (kept in memory only, never printed)")

say(); say("PART 2 · CHANGE (in order; each step only if the one before it worked)")
ok, r = sql(SQLTEXT)
if not ok: bad("the database change didn't go in (one transaction, so nothing in it changed): " + str(r)[:300]); say("  STOP. Tell Claude."); done(4)
ok, pv = sql("select has_table_privilege('anon', 'public.evv_prefill', 'SELECT') as a_sel, has_table_privilege('anon', 'public.evv_prefill', 'INSERT') as a_ins, "
             "has_table_privilege('authenticated', 'public.evv_prefill', 'SELECT') as s_sel, has_table_privilege('authenticated', 'public.evv_prefill', 'UPDATE') as s_upd, "
             "has_function_privilege('anon', 'public.evv_prefill_get(uuid)', 'EXECUTE') as a_get, has_function_privilege('anon', 'public.evv_submit_prefilled(uuid, jsonb)', 'EXECUTE') as a_sub")
P = (pv or [{}])[0] if ok else {}
chk(ok and not P.get("a_sel") and not P.get("a_ins") and P.get("s_sel") and not P.get("s_upd") and P.get("a_get") and P.get("a_sub"),
    "the database change is in: the public cannot touch the link table, staff can only read it, the public form can use its two functions")
went = []
for fn in ORDER:
    if deploy(fn): went.append(fn)
    else:
        say(f"  STOP. The functions before it are updated; {fn} and after are not (the texts keep the plain form link; nothing breaks). Tell Claude."); break

say(); say("PART 3 · PROOF (nothing stays, nothing is sent)")
if OTHER_CALLERS:
    say(f"  · a trigger on the forms table could call out over the network ({', '.join(OTHER_CALLERS)}), so the in-database proof was NOT run (the test database proved it). Tell Claude.")
else:
    snapq = "select (select count(*) from public.evv_submissions)::int as n, (select count(*) from public.evv_prefill)::int as p"
    ok, b4 = sql(snapq)
    s_, body = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": PROOFTEXT}, MG())
    msg = (jl(body) or {}).get("message", body) if isinstance(jl(body), dict) else body
    J = None
    if "PROBE_RESULT: " in str(msg):
        try: J, _ = json.JSONDecoder().raw_decode(str(msg).split("PROBE_RESULT: ", 1)[1])
        except Exception: J = None
    if J is None: bad(f"the proof didn't give a result ({s_}): {str(msg)[:300]}")
    else:
        g = J.get("get") or {}
        chk(J.get("anon_read_table") == "refused" and J.get("anon_insert_table") == "refused", "the public cannot read or write the link table")
        chk(g.get("status") == "ok" and sorted(J.get("get_keys") or []) == ["actual_in", "actual_out", "caregiver_name", "client_display", "scheduled_in", "scheduled_out", "status", "visit_date", "which_missing"],
            "a link gives the form ONLY: caregiver name, client first name + last initial, date, scheduled times, AxisCare times, which clock is missing")
        chk((J.get("nosig") or {}).get("field") == "sig_consumer" and (J.get("submit") or {}).get("ok") is True, "a form without the client's signature is refused; a signed one is saved")
        sv = J.get("saved") or {}
        chk(sv.get("found") and sv.get("cg") == "proof427-cg" and sv.get("cl") == "proof427-cl" and sv.get("visit") == "proof427-visit" and sv.get("linked_by") == "axiscare-visit"
            and sv.get("processed") is False and sv.get("outcome") is None and sv.get("attendant") == "Proof427 Caregiver",
            "the saved form is linked to the caregiver, client and visit from the office's record (the made-up 'evil' claims were ignored) and waits for the office")
        chk((J.get("again") or {}).get("error") == "used" and (J.get("get_used") or {}).get("status") == "used" and (J.get("submit_expired") or {}).get("error") == "expired"
            and (J.get("get_unknown") or {}).get("status") == "not_found", "one use only; an expired link is refused; an unknown link is not found")
        chk(J.get("plain_wiped") is True, "the plain public form still arrives unlinked whatever it claims (the 422 guard is untouched)")
    ok2, af = sql(snapq)
    ok3, left = sql("select (select count(*) from public.evv_submissions where attendant like 'Proof427%')::int + (select count(*) from public.evv_prefill where created_by = 'proof 427')::int as n")
    chk(ok3 and left and left[0]["n"] == 0, "nothing from the proof was left behind (all rolled back)")
    if ok and ok2 and b4 and af and (af[0]["n"], af[0]["p"]) != (b4[0]["n"], b4[0]["p"]):
        say(f"  · forms / links changed while this ran ({b4[0]['n']}/{b4[0]['p']} -> {af[0]['n']}/{af[0]['p']}): a real caregiver or a real text; not from the proof")
H = {"apikey": ANON, "Authorization": "Bearer " + ANON}
s_, b_ = http("GET", f"{FNB}/rest/v1/evv_prefill?select=id&limit=1", None, H)
chk(s_ in (401, 403) or (s_ == 200 and jl(b_) == []) or "42501" in str(b_), f"over the web, the public key cannot read the link table ({s_})")
rnd = str(uuid.uuid4())
s_, b_ = http("POST", f"{FNB}/rest/v1/rpc/evv_prefill_get", {"p_token": rnd}, H)
chk(s_ == 200 and (jl(b_) or {}).get("status") == "not_found", f"over the web, the form's lookup answers an unknown link with 'not found' only ({s_})")
s_, b_ = http("POST", f"{FNB}/rest/v1/rpc/evv_submit_prefilled", {"p_token": rnd, "p_payload": {}}, H)
chk(s_ == 200 and (jl(b_) or {}).get("error") in ("not_found", "bad_request"), f"over the web, saving with an unknown link saves nothing ({s_})")
for fn in went:
    good, why = is_reviewed_live(fn)
    chk(good, f"{fn}: the live copy is exactly the reviewed build" + ("" if good else f" ({why})"))
s1, _ = http("POST", f"{FNB}/functions/v1/clockin-alert", {"action": "evv"}, H)
chk(s1 in (401, 403), f"the missed clock-in page refuses an EVV send without a real admin link ({s1}); nothing sent")
TK = f"{FNB}/functions/v1/timekeeper-watch"
s2, _ = http("POST", TK, {}, H)
chk(s2 == 401, f"the timekeeper with the public key is refused ({s2}); nothing read or sent")
if SERVICE and "timekeeper-watch" in went:
    ok, p0 = sql("select count(*)::int as n from public.evv_prefill")
    s3, b3 = http("POST", TK + "?dry=1", {}, {"Authorization": "Bearer " + SERVICE, "apikey": ANON}, timeout=170)
    j3 = jl(b3) or {}
    ok, p1 = sql("select count(*)::int as n from public.evv_prefill")
    chk(s3 == 200 and j3.get("mode") == "DRY RUN" and ok and p0 and p1 and p0[0]["n"] == p1[0]["n"],
        f"one practice run of the timekeeper (?dry=1: reads today's visits, texts nobody, makes no link) ({s3}; links before {p0 and p0[0]['n']}, after {p1 and p1[0]['n']})")
else: say("  · the server key wasn't readable (or the timekeeper wasn't updated), so the practice run was skipped (the tests cover it)")
AFTER = switches()
same = AFTER is not None and all(json.dumps(AFTER.get(k)) == json.dumps(BEFORE.get(k)) for k in SWITCHES + ["msg_out"])
chk(same, "every switch and the clock-out wording are exactly as they were")
s_, page = http("GET", FORM_URL + "?v=" + dt.datetime.now().strftime("%H%M%S"), None, {"Cache-Control": "no-cache"}, timeout=60)
if s_ == 200 and "EVVPRE" in (page or ""): say("  ✓ sc.mo-care.com/evv-correction-form.html is the new form (it fills itself in from a link; without one it is the blank form as before)")
else: say(f"  · ATTENTION: sc.mo-care.com/evv-correction-form.html is not the new form yet ({s_}). Merge the Staffing branch evv-prefill first: until then a pre-filled link opens the BLANK form (it still works).")

say()
if fails: say("RESULT: PARTLY DONE · the ✗ lines above need Claude. Anything not updated keeps sending the plain (blank) form link; nothing breaks.")
else: say("RESULT: DONE · \"Text <caregiver> the EVV form\" and the clock-out reminder now send a link that opens the form filled in for that visit "
          "(name, client first name + last initial, date, scheduled times). The signed form arrives in the Hub already linked to the caregiver, client and "
          "AxisCare visit. Merge the Hub branch evv-prefill (cc-hub-live) next so Accept & Log shows \"From the visit (AxisCare)\".")
say("Nothing was texted or emailed by this installer. Nothing was written to AxisCare. No switch was changed. The EVV form is still never sent automatically on a missed clock-in.")
say("Rollback (only if ever needed): Claude redeploys the three functions from the commit before 427 (the texts go back to the plain link); "
    "the table and its two functions can stay (unused), or: drop function public.evv_submit_prefilled(uuid, jsonb); drop function public.evv_prefill_get(uuid); drop table public.evv_prefill;")
done(1 if fails else 0)
