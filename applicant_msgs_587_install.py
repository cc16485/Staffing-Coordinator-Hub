#!/usr/bin/env python3
# 587 · WARMER APPLICANT MESSAGES, YES / NO REPLIES AND THE CANCEL SCREEN (Samantha, 2026-10-11: "build it").
#   applicant_msgs_587.sql: columns for the new timing, replies and cancel reasons; interview_cancel_with_reason (the
#     cancel screen), interview_cancel_by_reply (a clear NO frees the time), interview_record_reply.
#   interview-messages: the new words and timing, ALL behind the Owners Hub Admin switch "New applicant messages"
#     (ops_settings.applicant_msgs_v2_live), which this step leaves OFF: until she turns it on, applicants get exactly
#     the messages they get today.
#   interview-reply (new): GoHighLevel posts replies to the YES / NO question here (also does nothing while the switch is off).
# SB_MODE=install: Part 1 read only (reviewed files; 586 is in; the live message code is main's; saves copies),
#   Part 2 the change, Part 3 proof (made-up records inside one always-undone step; nothing is sent; a practice run).
#   It sets the reply secret if missing and puts the reply web address on the clipboard for the GoHighLevel workflow
#   (it is never printed). SB_MODE=undo: removes the three functions, puts interview-messages back from the saved copy,
#   removes interview-reply. Prints counts only.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil, time, glob, secrets as pysecrets

MODE = os.environ.get("SB_MODE", "install")
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
LOCAL = os.environ.get("SB_LOCAL_SOCK")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
REF = "zngsgedlsxinbygwmxwn"; FN = "interview-messages"; RFN = "interview-reply"
REPO = os.environ["SB_REPO"]; BASE = os.environ.get("SB_BASE", "")
SAVE_ROOT = os.environ.get("SB_SAVE", os.path.expanduser("~/Claude/checks/587-saved"))
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
SQLF, RBF = "applicant_msgs_587.sql", "applicant_msgs_587_rollback.sql"
PINS = json.loads(os.environ.get("SB_PINS", "{}"))
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
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-587/1.0"}, **(headers or {})))
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
    if s not in (200, 201):
        try: return False, str(json.loads(b).get("message", b))     # 587: the message as text (586 cut it short, escaped)
        except Exception: return False, f"HTTP {s}: {b}"
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
def need(root, fn=None):
    fn = fn or FN; s = set(); deps(os.path.join(root, f"supabase/functions/{fn}/index.ts"), s)
    return {os.path.relpath(x, root).replace(os.sep, "/") for x in s}
def download(into, fn=None):
    fn = fn or FN; os.makedirs(os.path.join(into, "supabase"), exist_ok=True)
    d = subprocess.run([SUPA, "functions", "download", fn, "--project-ref", REF, "--use-api"], cwd=into,
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
def fmeta(fn=None):
    fn = fn or FN; s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{fn}", headers=MG())
    try: return json.loads(b) if s == 200 else None
    except Exception: return None
def deploy(root, vj, fn=None):
    fn = fn or FN
    p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"] + ([] if vj in (True, None) else ["--no-verify-jwt"]),
                       cwd=root, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    m = fmeta(fn) or {}
    if m.get("verify_jwt") != (True if vj is None else vj):
        http("PATCH", f"{API}/v1/projects/{REF}/functions/{fn}", {"verify_jwt": True if vj is None else vj}, MG())
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


PROOF = r"""
do $proof$
declare r jsonb := '{}'::jsonb; a1 uuid; a2 uuid; b2 uuid; t text; j json;
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  insert into public.job_applicants (first_name, last_name, email, status, position, channel, completed_at, age_ok, work_auth, has_transport)
    values ('Proof', 'Fiveeighta', 'proof-587-a@example.invalid', 'new', 'caregiver', 'self-test', now(), true, true, true) returning id into a1;
  perform set_config('cc.screen_checked', a1::text, true);
  insert into public.interview_bookings (applicant_id, starts_at, ends_at) values (a1, now() + interval '3 days', now() + interval '3 days 30 minutes');
  j := public.interview_cancel_with_reason(a1, 'found_job', 'proof note');
  select cancel_kind || '|' || cancel_reason into t from public.interview_bookings where applicant_id = a1 order by created_at desc limit 1;
  r := r || jsonb_build_object('screen_cancel', (j->>'cancelled'), 'screen_kept', t);
  begin perform public.interview_cancel_with_reason(a1, 'hacked', null); t := 'accepted'; exception when others then t := sqlerrm; end;
  r := r || jsonb_build_object('bad_reason', t);
  insert into public.job_applicants (first_name, last_name, email, status, position, channel, completed_at, age_ok, work_auth, has_transport)
    values ('Proof', 'Fiveeightb', 'proof-587-b@example.invalid', 'new', 'caregiver', 'self-test', now(), true, true, true) returning id into a2;
  perform set_config('cc.screen_checked', a2::text, true);
  insert into public.interview_bookings (applicant_id, starts_at, ends_at) values (a2, now() + interval '1 hour', now() + interval '90 minutes') returning id into b2;
  insert into public.coordinator_busy (starts_at, ends_at, source, source_id, label) values (now() + interval '1 hour', now() + interval '90 minutes', 'interview', a2::text, 'proof');
  j := public.interview_cancel_by_reply(b2, 'No sorry');
  select cancel_kind || '|' || reply_kind || '|' || status into t from public.interview_bookings where id = b2;
  r := r || jsonb_build_object('no_cancel', (j->>'cancelled'), 'no_kept', t,
    'no_freed', (select count(*) from public.coordinator_busy where source = 'interview' and source_id = a2::text));
  raise exception 'PROOF587 %', r::text;
end $proof$;
"""

say(f"587 · WARMER APPLICANT MESSAGES ({'UNDO' if MODE == 'undo' else 'install'})")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
if not LOCAL and not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
for rel, want in PINS.items():
    if not os.path.exists(os.path.join(REPO, rel)) or sha(os.path.join(REPO, rel)) != want:
        bad(f"{rel} is not the reviewed version"); say("  STOP. Nothing was run."); done(2)
if PINS: say(f"  ✓ the {len(PINS)} reviewed files are exactly what was tested")
S587, SRB = rd(SQLF), rd(RBF)
FUNCS = "('interview_cancel_with_reason','interview_cancel_by_reply','interview_record_reply')"

if MODE == "undo":
    say("UNDO")
    ok, r = sql(SRB)
    if not ok: bad("the undo didn't go in, and was undone as a whole (nothing changed): " + str(r)[:240]); done(6)
    ok, r = sql(f"select count(*)::int as n from pg_proc where proname in {FUNCS}")
    chk(ok and r[0]["n"] == 0, "the three 587 functions are gone (the cancel screen falls back to the plain cancel)")
    if not LOCAL:
        saved = sorted(glob.glob(os.path.join(SAVE_ROOT, "*", "function")))
        if not saved: bad("no saved copy of the message code was found; it was left as is. Tell Claude.")
        else:
            root = saved[-1]; meta = json.load(open(os.path.join(os.path.dirname(root), "meta.json")))
            okd, err = deploy(root, meta.get("verify_jwt"))
            tmp = tempfile.mkdtemp(prefix="u587-"); okl, live = download(tmp); shutil.rmtree(tmp, ignore_errors=True)
            chk(okd and okl and all(live.get(k) == v for k, v in meta["files"].items()), "interview-messages is back to the copy saved before 587" + ("" if okd else ": " + err))
        s, _ = http("DELETE", f"{API}/v1/projects/{REF}/functions/{RFN}", headers=MG())
        chk(s in (200, 204, 404), f"interview-reply removed ({s})")
    say(); say("UNDO COMPLETE." if not fails else f"{len(fails)} PROBLEM(S) ABOVE. Tell Claude.")
    done(0 if not fails else 4)

say("PART 1 · READ ONLY (nothing changes)")
ok, r = sql("""select (select count(*) from pg_proc where proname in ('applicant_screening_gap','applicant_followup_stop','interview_cancel','interview_book'))::int as base,
  (select count(*) from pg_proc where proname in """ + FUNCS + """)::int as mine,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'interview_bookings' and column_name in ('screen_grandfathered','booked_by'))::int as g586""")
if not ok or r[0]["base"] < 4 or r[0]["g586"] < 2: bad("586 isn't installed (587 builds on it). Nothing was changed. " + str(r)[:200]); done(3)
state = "after" if r[0]["mine"] == 3 else "before" if r[0]["mine"] == 0 else "other"
if state == "other": bad("some 587 functions are there and some aren't (unexpected). Nothing was changed. Tell Claude."); done(3)
say("  ✓ 586 is in" + ("" if state == "before" else "; 587 is already in (an earlier run): it will check and prove again"))
ok, r = sql("select data->>'applicant_msgs_v2_live' as v2 from app_data where key = 'ops_settings'")
v2 = ok and r and r[0]["v2"] == "true"
say(f"  ✓ the 'New applicant messages' switch is {'ON' if v2 else 'OFF'}" + ("" if v2 else ": applicants keep getting today's messages until you turn it on"))
stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S"); save = os.path.join(SAVE_ROOT, stamp); os.makedirs(save, exist_ok=True)
vj = None
if not LOCAL:
    vj = (fmeta() or {}).get("verify_jwt")
    okd, live = download(os.path.join(save, "function"))
    if not okd or not live: bad("couldn't read the live message code. Nothing was changed."); done(3)
    idx = f"supabase/functions/{FN}/index.ts"
    others = sorted(k for k in need(REPO) if k != idx and k != "supabase/functions/_shared/applicant-words.ts" and live.get(k) != sha(os.path.join(REPO, k)))
    if others:
        bad("the live message code is older than main in: " + ", ".join(x.split('functions/')[-1] for x in others)[:300] + ". Nothing was changed. Tell Claude."); done(3)
    if live.get(idx) not in (base_sha(idx), sha(os.path.join(REPO, idx))):
        bad("the live interview-messages isn't main's version (someone changed it since). Nothing was changed. Tell Claude."); done(3)
    json.dump({"verify_jwt": vj, "files": live, "saved": stamp}, open(os.path.join(save, "meta.json"), "w"), indent=1)
    s, b = http("GET", f"{API}/v1/projects/{REF}/secrets", headers=MG())
    names = {x.get("name") for x in json.loads(b)} if s == 200 else set()
    if not {"GHL_TOKEN", "GHL_LOCATION_ID"} <= names: bad("the GoHighLevel connection isn't set. Nothing was changed."); done(3)
    say("  ✓ the live message code is main's; copies saved (for the undo); GoHighLevel connected")

say(); say("PART 2 · CHANGE")
ok, r = sql(S587)
if not ok: bad("the database change didn't go in, and was undone as a whole (nothing changed): " + str(r)[:300]); done(6)
ok, r = sql(f"select count(*)::int as n from pg_proc where proname in {FUNCS}")
chk(ok and r[0]["n"] == 3, "the database part is in (cancel reasons, NO replies, the new timing fields)")
if not LOCAL:
    if "INTERVIEW_REPLY_TOKEN" not in names:
        tok = pysecrets.token_hex(24)
        s, _ = http("POST", f"{API}/v1/projects/{REF}/secrets", [{"name": "INTERVIEW_REPLY_TOKEN", "value": tok}], MG())
        if not chk(s in (200, 201), f"the reply secret is set ({s})"): done(6)
        open(os.path.join(save, "reply_url.txt"), "w").write(f"{FNB}/functions/v1/{RFN}?token={tok}\n"); os.chmod(os.path.join(save, "reply_url.txt"), 0o600)
    else:
        say("  ✓ the reply secret was already set")
    okd, err = deploy(REPO, vj)
    tmp = tempfile.mkdtemp(prefix="c587-"); okl, live = download(tmp); shutil.rmtree(tmp, ignore_errors=True)
    if not chk(okd and okl and all(live.get(k) == sha(os.path.join(REPO, k)) for k in need(REPO)), "interview-messages is the reviewed version (new messages wait for the switch)" + ("" if okd else ": " + err)):
        say("  The database part is in and safe on its own. Tell Claude."); done(6)
    okd, err = deploy(REPO, False, RFN)
    tmp = tempfile.mkdtemp(prefix="r587-"); okl, live = download(tmp, RFN); shutil.rmtree(tmp, ignore_errors=True)
    chk(okd and okl and all(live.get(k) == sha(os.path.join(REPO, k)) for k in need(REPO, RFN)), "interview-reply is in (it does nothing until the switch is on)" + ("" if okd else ": " + err))

say(); say("PART 3 · PROOF (made-up records, always undone; nothing is sent)")
ok, msg = sql(PROOF)
m = re.search(r"PROOF587 (\{.*\})", str(msg), re.S)
P = None
if not ok and m:
    try: P = json.loads(m.group(1))
    except Exception: P = None
if not chk(P is not None, "the proof ran"): say("    " + str(msg)[:400]); done(7)
chk(P.get("screen_cancel") == "true" and str(P.get("screen_kept", "")).startswith("found_job|Found another job: proof note"), "the cancel screen cancels and keeps the reason and their note")
chk("unknown reason" in str(P.get("bad_reason")), "a made-up reason is refused")
chk(P.get("no_cancel") == "true" and P.get("no_kept") == "replied_no|no|cancelled" and P.get("no_freed") == 0, "a NO reply cancels even close to the time, keeps their words and frees the time")
ok, r = sql("select count(*)::int as n from public.job_applicants where email like 'proof-587-%@example.invalid'")
chk(ok and r[0]["n"] == 0, "nothing made-up was left behind")
if not LOCAL:
    s1, _ = http("POST", f"{FNB}/functions/v1/{RFN}?token=wrong", {"phone": "4175550000", "message": "No"})
    chk(s1 == 401, f"interview-reply refuses a caller without the secret ({s1})")
    K = keys(); SERVICE = K.get("service_role", ""); HIDE.append(SERVICE)
    time.sleep(float(os.environ.get("SB_SETTLE", "8")))
    s4, b4 = http("POST", f"{FNB}/functions/v1/{FN}?dry=1", {}, {"Authorization": "Bearer " + SERVICE, "apikey": SERVICE})
    try: would = (json.loads(b4) or {}).get("would") or {}
    except Exception: would = {}
    if chk(s4 == 200, f"a practice run of the message job answered ({s4}); it sent nothing"):
        for k in ("confirm", "day", "hour", "nudge", "cancelled", "held"): say(f"    would {k}: {len(would.get(k) or [])}")
    url = os.path.join(save, "reply_url.txt")
    if os.path.exists(url):
        subprocess.run(["pbcopy"], input=open(url).read().strip(), text=True)
        say(); say("  The reply web address (with its secret) is on your clipboard, for the GoHighLevel workflow. It is never printed.")
        say("  (Saved privately for Claude in ~/Claude/checks/587-saved too.)")

say(); say("587 COMPLETE. Nothing was sent. The new messages are OFF until you turn on 'New applicant messages' on the Owners Hub Admin page." if not fails else f"{len(fails)} PROBLEM(S) ABOVE. Tell Claude.")
done(0 if not fails else 4)
