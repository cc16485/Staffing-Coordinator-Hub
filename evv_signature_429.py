#!/usr/bin/env python3
# 429 · THE CLIENT SIGNATURE: AT THE SHIFT, AT THE NEXT VISIT, OR VERIFIED BY PHONE. Samantha 2026-10-03: "it really
# needs to be completed at the time of the shift that they are asking for a manual correction, or worst case scenario the
# next time they are with that client --- if client doesnt sign we can call the client and verify over the phone".
#   * the clock-out reminder's built-in wording asks for the form BEFORE THEY LEAVE, signed by the client there
#     (her own wording, ops_settings.timekeeper_msg_out, is kept as it is if she has one; this says whether she does);
#   * the caregiver can send her part with "<client> will sign at my next visit" (the form waits for the client);
#   * at her next visit with that client the CAREGIVER gets one text with the client-signature link (switch
#     evv_next_visit_live, which stays OFF: practice until she turns it on in the Hub); no visit in 14 days = a Needs
#     Attention item to call the client;
#   * the office records "Verified by phone" (or "Client declined to confirm") in the Hub; nothing contacts a client;
#   * the morning EVV chase is retired (evv_chase_live now only drives the Saturday office reminder).
# The Hub project (zngsgedlsxinbygwmxwn) only. MUST RUN AFTER 427 (it checks).
# Part 1 (READ ONLY): the reviewed builds (SQL, proof and the changed function files pinned), the tests pass here, 427 is
#   live, who owns the forms table, her clock-out wording, the switches, forms already waiting without a client signature.
# Part 2 (CHANGE): evv_signature_429.sql in one transaction. Then redeploys timekeeper-watch only if its live copy is the
#   427 build (or already this one), keeping its gateway sign-in setting.
# Part 3 (PROOF, NOTHING STAYS, NOTHING SENT): the rolled-back proof in the database; then over the real web with the
#   public key; the live function is the reviewed build; one practice run of the timekeeper (?dry=1: texts nobody, writes
#   nothing); every switch as it was (evv_next_visit_live and evv_chase_live still off unless she had set them).
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil, uuid
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
REF = "zngsgedlsxinbygwmxwn"
ROOT = os.environ["SB_REPO"]
SHAS = json.loads(os.environ.get("SB_SHAS", "{}")); PREV = json.loads(os.environ.get("SB_PREV", "{}"))
SQL_SHA, PROOF_SHA = os.environ.get("SB_SQL_SHA", ""), os.environ.get("SB_PROOF_SHA", "")
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FORM_URL = os.environ.get("SB_FORM_URL", "https://sc.mo-care.com/evv-correction-form.html")
SIGN_URL = os.environ.get("SB_SIGN_URL", "https://sc.mo-care.com/evv-client-sign.html")
SKIP_TESTS = os.environ.get("SB_SKIP_TESTS") == "1"
SQLFILE, PROOFFILE = "evv_signature_429.sql", "evv_signature_429_proof.sql"
ORDER = ["timekeeper-watch"]
PINNED = {"timekeeper-watch", "_shared/evv-sign"}
TESTS = ["evv_signature_429_test.mjs", "evv_prefill_427_test.mjs", "c1_missed_clockin_test.mjs", "evv_forms_422_test.mjs", "quiet_hours_425_test.mjs",
         "late_l1_test.mjs", "missed_notes_test.mjs", "j1_job_locks_test.mjs", "staff_alerts_one_contact_test.mjs", "retry_test.mjs"]
SWITCHES = ["timekeeper_watch_live", "timekeeper_text_live", "timekeeper_admin_loop_live", "evv_chase_live", "evv_next_visit_live", "missed_clockin_after_hours",
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
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-evv429/1.0"}, **(headers or {})))
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
    tmp = tempfile.mkdtemp(prefix="evv429-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
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
    """'mine' (already this build) | 'expected' (the build before this one: 427) | 'other' | 'unreadable'"""
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
    if st != "expected": bad(f"{fn}: its live code is not the build 429 was made on ({st}), NOT changed. Tell Claude."); return False
    need = deps_of(fn)
    other = [k.split("supabase/functions/", 1)[1] for k in need if k != pinpath(fn) and k != pinpath("_shared/evv-sign") and (k not in live or live[k] != sha(os.path.join(ROOT, k)))]
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

SWQ = "select " + ", ".join(f"data->'{k}' as \"{k}\"" for k in SWITCHES) + ", data->>'timekeeper_msg_out' as msg_out, data->>'evv_next_visit_msg' as next_msg from public.app_data where key = 'ops_settings'"
def switches():
    ok, r = sql(SWQ)
    return (r[0] if ok and r else None)
word = lambda v: "ON" if v is True else ("off" if v in (False, None) else str(v))

say("429 · THE CLIENT SIGNATURE: AT THE SHIFT, AT THE NEXT VISIT, OR VERIFIED BY PHONE"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
for f, want in ((SQLFILE, SQL_SHA), (PROOFFILE, PROOF_SHA)):
    p = os.path.join(ROOT, f)
    if not want or not os.path.exists(p) or sha(p) != want: bad(f"{f} is not the reviewed version"); say("  STOP. Nothing was run."); done(2)
if set(SHAS) != PINNED or any(not os.path.exists(os.path.join(ROOT, pinpath(k))) or sha(os.path.join(ROOT, pinpath(k))) != v for k, v in SHAS.items()):
    bad("the changed function files are not the reviewed build"); say("  STOP. Nothing was run."); done(2)
if set(PREV) != set(ORDER): bad("the expected live build is not pinned"); say("  STOP. Nothing was run."); done(2)
users = sorted(fn for fn in os.listdir(os.path.join(ROOT, "supabase/functions")) if not fn.startswith("_") and os.path.exists(os.path.join(ROOT, f"supabase/functions/{fn}/index.ts"))
               and pinpath("_shared/evv-sign") in deps_of(fn))
if users != ["timekeeper-watch"]: bad(f"the new signature helper is used by unexpected functions ({', '.join(users)})"); say("  STOP. Nothing was run."); done(2)
SQLTEXT, PROOFTEXT = open(os.path.join(ROOT, SQLFILE)).read(), open(os.path.join(ROOT, PROOFFILE)).read()
say(f"  ✓ {SQLFILE}, {PROOFFILE} and the 2 changed function files are the reviewed builds; function to update: {', '.join(ORDER)}")
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

# 427 first: the live timekeeper must be the 427 build (or already this one), and evv_prefill must exist
st, _ = live_state("timekeeper-watch")
if st not in ("expected", "mine"):
    bad(f"timekeeper-watch live is not the 427 build ({st}). Run Desktop 427 first (pre-filled EVV form), then this."); say("  STOP. Nothing was changed."); done(3)
ok, ex = sql("select to_regclass('public.evv_prefill') is not null as pre, to_regclass('public.evv_sign') is not null as sign, "
             "(select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'evv_submissions' and column_name = 'client_sig_status') as col")
E = (ex or [{}])[0] if ok else {}
if not E.get("pre"): bad("the pre-filled form (427) is not in the database. Run Desktop 427 first."); say("  STOP. Nothing was changed."); done(3)
say("  ✓ 427 is live (timekeeper-watch is its build, the pre-fill table is there), so 429 goes on top of it")
if E.get("sign") or E.get("col"): say("  · the 429 table / columns are already there (running the SQL again is safe)")
ok, own = sql("select (select tableowner from pg_tables where schemaname = 'public' and tablename = 'evv_submissions') as owner, current_user as me, "
              "(select rolbypassrls from pg_roles where rolname = current_user) as bypass, "
              "(select relforcerowsecurity from pg_class where oid = 'public.evv_submissions'::regclass) as forced")
o = (own or [{}])[0] if ok else {}
if not ok or not ((o.get("owner") == o.get("me") or o.get("bypass")) and not o.get("forced")):
    bad(f"the signature functions would run as {o.get('me')} but the forms table belongs to {o.get('owner')} (bypass {o.get('bypass')}, forced {o.get('forced')}), so they could not save. Nothing was changed. Tell Claude."); done(3)
say(f"  ✓ the forms table belongs to {o.get('owner')}; the signature functions (made by {o.get('me')}) can write it")
ok, trg = sql("select t.tgname, (p.prosrc ~* '(net\\.|http_post|http_get|pg_net|supabase_functions)') as calls_out from pg_trigger t join pg_proc p on p.oid = t.tgfoid "
              "where t.tgrelid = 'public.evv_submissions'::regclass and not t.tgisinternal")
OTHER_CALLERS = [r["tgname"] for r in (trg if ok else []) if r["calls_out"]]
ok, wt = sql("select count(*)::int as n from public.evv_submissions where processed = false and coalesce(sig_consumer, '') !~ '^data:image/(png|jpeg);base64,'")
WAIT_OLD = (wt or [{}])[0].get("n") if ok else None
if WAIT_OLD: say(f"  · ATTENTION: {WAIT_OLD} form(s) waiting for the office have NO client signature. After this they show \"Waiting for client signature\" and can't be accepted until the client signs or the office verifies by phone (Dismiss still works).")
elif WAIT_OLD == 0: say("  ✓ no form waiting for the office is missing its client signature")
BEFORE = switches()
if BEFORE is None: bad("couldn't read the settings (ops_settings). Nothing was changed."); done(3)
say("  · switches now: " + ", ".join(f"{k} {word(BEFORE.get(k))}" for k in ("timekeeper_watch_live", "timekeeper_text_live", "timekeeper_admin_loop_live", "evv_chase_live", "evv_next_visit_live")) + ". This installer changes none of them.")
mo = BEFORE.get("msg_out")
if not mo: say("  ✓ the clock-out reminder uses the built-in wording, so it now asks for the form before they leave, signed by the client")
else: say("  · ATTENTION: she has her OWN clock-out wording (ops_settings.timekeeper_msg_out), so it stays exactly as it is; the new \"before you leave\" wording is only the built-in one. Hers: \"" + mo[:300] + "\"")
if BEFORE.get("evv_chase_live") is True: say("  · evv_chase_live is ON: from now it only sends the Saturday office reminder; the morning caregiver chase no longer exists")
K = keys(); ANON, SERVICE = K.get("anon", ""), K.get("service_role", "")
HIDE += [ANON, SERVICE]
if not ANON: bad("couldn't read the project's public key. Nothing was changed."); done(3)
say("  ✓ read the project's keys (kept in memory only, never printed)")

say(); say("PART 2 · CHANGE (in order; each step only if the one before it worked)")
ok, r = sql(SQLTEXT)
if not ok: bad("the database change didn't go in (one transaction, so nothing in it changed): " + str(r)[:300]); say("  STOP. Tell Claude."); done(4)
ok, pv = sql("select has_table_privilege('anon', 'public.evv_sign', 'SELECT') as a_sel, has_table_privilege('anon', 'public.evv_sign', 'INSERT') as a_ins, "
             "has_table_privilege('authenticated', 'public.evv_sign', 'SELECT') as s_sel, has_table_privilege('authenticated', 'public.evv_sign', 'UPDATE') as s_upd, "
             "has_function_privilege('anon', 'public.evv_sign_get(uuid)', 'EXECUTE') as a_get, has_function_privilege('anon', 'public.evv_sign_submit(uuid, jsonb)', 'EXECUTE') as a_sub, "
             "has_function_privilege('anon', 'public.evv_client_phone_record(uuid, jsonb)', 'EXECUTE') as a_ph, has_function_privilege('authenticated', 'public.evv_client_phone_record(uuid, jsonb)', 'EXECUTE') as s_ph")
P = (pv or [{}])[0] if ok else {}
chk(ok and not P.get("a_sel") and not P.get("a_ins") and P.get("s_sel") and not P.get("s_upd") and P.get("a_get") and P.get("a_sub") and not P.get("a_ph") and P.get("s_ph"),
    "the database change is in: the public cannot touch the link table, staff can only read it, the client page can use its two functions, only staff can record a phone call")
went = []
for fn in ORDER:
    if deploy(fn): went.append(fn)
    else: say(f"  STOP. {fn} is not updated (the reminder keeps its old wording, no next-visit text; the forms and the Hub still work). Tell Claude."); break

say(); say("PART 3 · PROOF (nothing stays, nothing is sent)")
if OTHER_CALLERS:
    say(f"  · a trigger on the forms table could call out over the network ({', '.join(OTHER_CALLERS)}), so the in-database proof was NOT run (the test database proved it). Tell Claude.")
else:
    snapq = "select (select count(*) from public.evv_submissions)::int as n, (select count(*) from public.evv_sign)::int as s"
    ok, b4 = sql(snapq)
    s_, body = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": PROOFTEXT}, MG())
    msg = (jl(body) or {}).get("message", body) if isinstance(jl(body), dict) else body
    J = None
    if "PROBE_RESULT: " in str(msg):
        try: J, _ = json.JSONDecoder().raw_decode(str(msg).split("PROBE_RESULT: ", 1)[1])
        except Exception: J = None
    if J is None: bad(f"the proof didn't give a result ({s_}): {str(msg)[:300]}")
    else:
        W = J.get("waiting_form") or {}; PH = J.get("phone_row") or {}
        chk((J.get("nolater") or {}).get("field") == "sig_consumer" and (J.get("later") or {}).get("waiting") is True and (J.get("signed_form") or {}).get("status") == "signed",
            "the caregiver can send her part with \"the client signs at my next visit\" (saved as waiting); without that choice an unsigned form is still refused; signed at the shift = signed")
        chk(J.get("anon_read_sign") == "refused" and sorted(J.get("get_keys") or []) == ["caregiver_name", "client_display", "new_in", "new_out", "notes", "orig_in", "orig_out", "reason", "sig_attendant", "status", "submitted_on", "tasks", "visit_date"],
            "the public cannot read the link table; the client page gets only the caregiver's completed part")
        chk((J.get("noconf") or {}).get("field") == "confirm" and (J.get("sign") or {}).get("ok") is True and W.get("status_now") == "signed" and W.get("new_in") == "09:00" and W.get("new_out") == "13:00"
            and W.get("notes") == "proof 429, never kept" and W.get("sig_attendant_kept") is True and W.get("processed") is False,
            "the client's signature is saved (tick required) and the caregiver's answers could not be changed from the page")
        chk((J.get("again") or {}).get("error") == "signed" and (J.get("unknown") or {}).get("status") == "not_found", "one use only; an unknown link is not found")
        chk(J.get("plain_signed") == "signed" and J.get("plain_waiting") == "waiting" and J.get("plain_phone_wiped") is True, "the plain public form: signed = signed, unsigned = waiting, and it can't claim a phone call")
        chk(J.get("staff_direct") == "refused,refused" and J.get("staff_accept_waiting") == "refused", "staff cannot write a signature or status directly, and cannot accept a form the client has not signed")
        chk((J.get("phone") or {}).get("ok") is True and PH.get("by") == "proof-429@invalid.test" and PH.get("confirmed") is True and J.get("accept_after_phone") == 1,
            "\"Verified by phone\" is recorded with the signed-in person as the caller; then the form can be accepted")
        chk(J.get("dismiss") == 1 and J.get("anon_phone") == "refused", "Dismiss still works; the public cannot record a phone call")
    ok2, af = sql(snapq)
    ok3, left = sql("select (select count(*) from public.evv_submissions where attendant like 'Proof429%')::int + (select count(*) from public.evv_prefill where created_by = 'proof 429')::int as n")
    chk(ok3 and left and left[0]["n"] == 0, "nothing from the proof was left behind (all rolled back)")
    if ok and ok2 and b4 and af and (af[0]["n"], af[0]["s"]) != (b4[0]["n"], b4[0]["s"]):
        say(f"  · forms / signature links changed while this ran ({b4[0]['n']}/{b4[0]['s']} -> {af[0]['n']}/{af[0]['s']}): a real caregiver; not from the proof")
H = {"apikey": ANON, "Authorization": "Bearer " + ANON}
s_, b_ = http("GET", f"{FNB}/rest/v1/evv_sign?select=id&limit=1", None, H)
chk(s_ in (401, 403) or (s_ == 200 and jl(b_) == []) or "42501" in str(b_), f"over the web, the public key cannot read the link table ({s_})")
rnd = str(uuid.uuid4())
s_, b_ = http("POST", f"{FNB}/rest/v1/rpc/evv_sign_get", {"p_token": rnd}, H)
chk(s_ == 200 and (jl(b_) or {}).get("status") == "not_found", f"over the web, the client page's lookup answers an unknown link with 'not found' only ({s_})")
s_, b_ = http("POST", f"{FNB}/rest/v1/rpc/evv_sign_submit", {"p_token": rnd, "p_payload": {}}, H)
chk(s_ == 200 and (jl(b_) or {}).get("error") in ("not_found", "bad_request"), f"over the web, signing with an unknown link saves nothing ({s_})")
s_, b_ = http("POST", f"{FNB}/rest/v1/rpc/evv_client_phone_record", {"p_id": rnd, "p_payload": {}}, H)
chk(s_ in (401, 403, 404) or "42501" in str(b_), f"over the web, the public key cannot record a phone verification ({s_})")
for fn in went:
    good, why = is_reviewed_live(fn)
    chk(good, f"{fn}: the live copy is exactly the reviewed build" + ("" if good else f" ({why})"))
TK = f"{FNB}/functions/v1/timekeeper-watch"
s2, _ = http("POST", TK, {}, H)
chk(s2 == 401, f"the timekeeper with the public key is refused ({s2}); nothing read or sent")
if SERVICE and "timekeeper-watch" in went:
    ok, p0 = sql("select count(*)::int as n, count(next_visit_practice_at)::int as pr, count(next_visit_texted_at)::int as tx from public.evv_sign")
    s3, b3 = http("POST", TK + "?dry=1", {}, {"Authorization": "Bearer " + SERVICE, "apikey": ANON}, timeout=170)
    j3 = jl(b3) or {}
    ok, p1 = sql("select count(*)::int as n, count(next_visit_practice_at)::int as pr, count(next_visit_texted_at)::int as tx from public.evv_sign")
    nv = j3.get("evv_next_visit") or {}
    chk(s3 == 200 and j3.get("mode") == "DRY RUN" and isinstance(nv, dict) and "live" in nv and "retired in 429" in str((j3.get("evv_chase") or {}).get("why", "")) and p0 == p1,
        f"one practice run of the timekeeper (?dry=1: texts nobody, writes nothing; next-visit pass ran: {nv.get('open', '?')} open, would text {nv.get('would_text', '?')}; morning chase retired) ({s3})")
else: say("  · the server key wasn't readable (or the timekeeper wasn't updated), so the practice run was skipped (the tests cover it)")
AFTER = switches()
same = AFTER is not None and all(json.dumps(AFTER.get(k)) == json.dumps(BEFORE.get(k)) for k in SWITCHES + ["msg_out", "next_msg"])
chk(same, "every switch and the clock-out wording are exactly as they were (evv_next_visit_live " + word((AFTER or {}).get("evv_next_visit_live")) + ", evv_chase_live " + word((AFTER or {}).get("evv_chase_live")) + ")")
s_, page = http("GET", FORM_URL + "?v=" + dt.datetime.now().strftime("%H%M%S"), None, {"Cache-Control": "no-cache"}, timeout=60)
if s_ == 200 and "later-box" in (page or ""): say("  ✓ sc.mo-care.com/evv-correction-form.html is the new form (it offers \"<client> will sign at my next visit\" while the client box is empty)")
else: say(f"  · ATTENTION: sc.mo-care.com/evv-correction-form.html is not the new form yet ({s_}). Merge the Staffing branch evv-signature-flow first.")
s_, page = http("GET", SIGN_URL + "?v=" + dt.datetime.now().strftime("%H%M%S"), None, {"Cache-Control": "no-cache"}, timeout=60)
if s_ == 200 and "EVVSIGN" in (page or ""): say("  ✓ sc.mo-care.com/evv-client-sign.html (the client-signature page) is live")
else: say(f"  · ATTENTION: the client-signature page is not live yet ({s_}). Merge the Staffing branch evv-signature-flow first; until then a signature link would not open.")

say()
if fails: say("RESULT: PARTLY DONE · the ✗ lines above need Claude. Nothing was texted.")
else: say("RESULT: DONE · the clock-out reminder asks for the form before they leave; a caregiver can send her part with \"<client> will sign at my next visit\"; "
          "the office can record \"Verified by phone\". Merge the Hub branch evv-signature-flow (cc-hub-live) next so the office sees the badges, the phone button and the switch.")
say("The next-visit text is OFF (practice: it only records who WOULD be texted). Turn it on in the Hub (EVV Corrections) when you are happy with what practice shows.")
say("Nothing was texted or emailed by this installer. Nothing was written to AxisCare. No switch was changed. Nothing ever contacts a client or family.")
say("Rollback (only if ever needed): Claude redeploys timekeeper-watch from the commit before 429 (the reminder goes back to the old wording, no next-visit text). "
    "The columns, table and functions can stay unused; the two guards can be removed with: drop trigger evv_submissions_sig_guard_429 on public.evv_submissions; "
    "and 427's evv_submit_prefilled re-run from evv_prefill_427.sql.")
done(1 if fails else 0)
