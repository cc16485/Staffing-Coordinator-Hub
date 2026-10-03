#!/usr/bin/env python3
# 432 · CALLS TELL US "RUNNING LATE". Samantha 2026-10-03, after her call to Mary: "i thought it might have read my
# transcript from my call to mary to see that she said she is running late and will be to Aprils in 8 minutes", then
# "yes build it, if its also possible to text that update to clients or family circles as well?"
# What changes (the Hub project zngsgedlsxinbygwmxwn only):
#   late-watch: calls BOTH ways are read (the office calling the caregiver, not only the caregiver calling in), by the
#     same AI reader as her texts; also a caregiver whose missed clock-in alert is still open. Matched by her phone
#     number on the roster only. No transcript yet: tried again for 30 minutes; never: the run (and a card) say so.
#     While the running-late notices are in practice, a CALL's notice is live by itself (ops_settings.late_call_live,
#     NEW, ON unless she turns it off): a card in Needs Attention and the call noted on the missed clock-in card.
#   timekeeper-watch: a call that said "running late" WITH a time pauses that missed clock-in's admin texts until 5
#     minutes after the time (never past 2 hours after the start); then they carry on (counting toward the cap of 6). No time, or "can't make it": they
#     carry on, with what the call said in the next text.
#   clockin-alert, late-alert (the two link pages): "Mary said on your 4:31pm call: running late, about 8 minutes
#     (around 4:39pm)", her words, the pause; "Tell the family" is a link to the running-late page, where the exact text
#     and who gets it are shown and ONLY a person's tap sends (her rule, permanent). The client is never texted.
#   call_late_432.sql: seven columns on late_notices (what the call was). Nothing deleted, no setting written.
# Part 1 (READ ONLY): the reviewed builds (the SQL and the changed function files pinned), the tests pass here, the
#   running-late table (363) is there, the switches, the late-watch schedule.
# Part 2 (CHANGE): the SQL (one transaction). Then the functions, each only if its live copy is today's GitHub main (or
#   already this build), keeping its gateway setting, in this order: timekeeper-watch first (so a call can never stop
#   the missed clock-in alarm on the old rule), clockin-alert, late-alert, late-watch last. Any failure stops the rest.
# Part 3 (PROOF, NOTHING SENT, NOTHING WRITTEN): the live copies are the reviewed builds; the public key is refused;
#   one practice run each of late-watch and timekeeper-watch (?dry=1: texts nobody, writes nothing; late-watch's practice
#   run does ask the AI about any caregiver texts or calls in the window, as every run does); no notice was written; every
#   switch exactly as it was.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
REF = "zngsgedlsxinbygwmxwn"
ROOT = os.environ["SB_REPO"]; BASE = os.environ.get("SB_BASE", "")
SHAS = json.loads(os.environ.get("SB_SHAS", "{}")); SQL_SHA = os.environ.get("SB_SQL_SHA", "")
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
SKIP_TESTS = os.environ.get("SB_SKIP_TESTS") == "1"
SQLFILE = "call_late_432.sql"
ORDER = ["timekeeper-watch", "clockin-alert", "late-alert", "late-watch"]
PINNED = {"_shared/late-notice", "timekeeper-watch", "clockin-alert", "late-alert", "late-watch"}
TESTS = ["call_late_432_test.mjs", "late_l1_test.mjs", "late_watch_test.mjs", "c1_missed_clockin_test.mjs", "quiet_hours_425_test.mjs",
         "evv_prefill_427_test.mjs", "evv_signature_429_test.mjs", "ghl_call_link_431_test.mjs", "missed_notes_test.mjs", "j1_job_locks_test.mjs"]
SWITCHES = ["late_watch_live", "late_cg_reply_live", "late_admin_live", "late_call_live", "late_family_min", "timekeeper_watch_live", "timekeeper_text_live",
            "timekeeper_admin_loop_live", "timekeeper_admin_max_texts", "missed_clockin_after_hours", "call_pull_live"]
COLS = ["source", "call_at", "call_message_id", "call_direction", "call_by", "call_by_email", "call_quote"]
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for h in HIDE:
        if h: s = s.replace(h, "(hidden)")
    s = re.sub(r"(sbp_|eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._\-]+", "(hidden)", s); s = re.sub(r"[\w.%+\-]+@[\w.\-]+\.[A-Za-z]{2,}", "(an email)", s)
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
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-calllate432/1.0"}, **(headers or {})))
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
    if s not in (200, 201): return False, f"HTTP {s}: {b[:300]}"
    j = jl(b)
    return (True, j) if j is not None else (False, b[:200])
def fmeta(fn):
    s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{fn}", headers=MG())
    return s, (jl(b) if s == 200 else None)
def keys():
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
def git(*a): return subprocess.run(["git", *a], cwd=ROOT, capture_output=True)
def chk(good, msg): (say if good else bad)(("  ✓ " if good else "") + msg)
def deps(path, seen):
    if path in seen or not os.path.exists(path): return
    seen.add(path)
    for m in re.findall(r"""from\s+['"](\.{1,2}/[^'"]+)['"]|import\s+['"](\.{1,2}/[^'"]+)['"]""", open(path).read()):
        deps(os.path.normpath(os.path.join(os.path.dirname(path), m[0] or m[1])), seen)
pinpath = lambda k: f"supabase/functions/{k}.ts" if k.startswith("_shared/") else f"supabase/functions/{k}/index.ts"
def deps_of(fn):
    s = set(); deps(os.path.join(ROOT, f"supabase/functions/{fn}/index.ts"), s)
    return {os.path.relpath(x, ROOT).replace(os.sep, "/") for x in s}

def reviewed():
    if not BASE or git("cat-file", "-e", BASE + "^{commit}").returncode != 0: bad("the reviewed starting point isn't in this folder's history"); say("  STOP. Nothing was run."); done(2)
    p = os.path.join(ROOT, SQLFILE)
    if not SQL_SHA or not os.path.exists(p) or sha(p) != SQL_SHA: bad(f"{SQLFILE} is not the reviewed version"); say("  STOP. Nothing was run."); done(2)
    if set(SHAS) != PINNED: bad("the changed function files pinned are not the five reviewed ones"); say("  STOP. Nothing was run."); done(2)
    changed = sorted(x for x in git("diff", "--name-only", BASE, "HEAD", "--", "supabase/functions").stdout.decode().split() if x.endswith(".ts") and os.path.exists(os.path.join(ROOT, x)))
    pinned = {pinpath(k): v for k, v in SHAS.items()}
    if not set(pinned) <= set(changed): bad(f"the reviewed files aren't all changed here ({', '.join(sorted(set(pinned) - set(changed)))[:200]})"); say("  STOP. Nothing was run."); done(2)
    for rel, want in pinned.items():
        if sha(os.path.join(ROOT, rel)) != want: bad(f"{rel.split('functions/')[1]} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
    fnroot = os.path.join(ROOT, "supabase/functions"); users = []
    for fn in sorted(os.listdir(fnroot)):
        pp = os.path.join(fnroot, fn, "index.ts")
        if fn.startswith("_") or not os.path.exists(pp): continue
        used = deps_of(fn)
        if used & set(pinned): users.append((fn, used))
    names = sorted(fn for fn, _ in users)
    if names != sorted(ORDER): bad(f"the changed files are used by other functions too ({', '.join(names)}). Ask Claude to refresh 432."); say("  STOP. Nothing was run."); done(2)
    extra = sorted(set(changed) - set(pinned))
    touch = sorted({e for e in extra for fn, used in users if e in used})
    if touch: bad(f"other changes merged since the review touch these functions ({', '.join(touch)[:200]}). Ask Claude to refresh 432."); say("  STOP. Nothing was run."); done(2)
    say(f"  ✓ {SQLFILE} and the {len(pinned)} changed function files are the reviewed builds" + (f" (other merged changes don't touch them: {', '.join(e.split('functions/')[1] for e in extra)[:160]})" if extra else ""))
    say(f"  ✓ functions to update, in this order: {', '.join(ORDER)}")

def live_files(fn):
    tmp = tempfile.mkdtemp(prefix="cl432-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
    d = subprocess.run([SUPA, "functions", "download", fn, "--project-ref", REF, "--use-api"], cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    live = {}
    for root, _, files in os.walk(tmp):
        for f in files:
            lp = os.path.join(root, f).replace(os.sep, "/")
            if "/functions/" in lp: live["supabase/functions/" + lp.split("/functions/", 1)[1]] = sha(lp)
    shutil.rmtree(tmp, ignore_errors=True)
    return d.returncode == 0, live
def base_sha(rel):
    b = git("show", f"{BASE}:{rel}")
    return shab(b.stdout) if b.returncode == 0 else None
def is_reviewed_live(fn):
    okd, live = live_files(fn)
    if not okd: return False, "couldn't read the live copy"
    need = deps_of(fn)
    missing = [k for k in need if k not in live]
    if missing: return False, "live copy is missing " + ", ".join(sorted(k.split("functions/", 1)[1] for k in missing))
    off = [k for k in need if live[k] != sha(os.path.join(ROOT, k))]
    return (not off), ("" if not off else "live differs in " + ", ".join(sorted(k.split("functions/", 1)[1] for k in off)))
def deploy(fn):
    sM, m = fmeta(fn)
    if sM == 404: bad(f"{fn} is not deployed. Tell Claude."); return False
    vj = (m or {}).get("verify_jwt")
    if not isinstance(vj, bool): bad(f"{fn}: couldn't read its gateway setting, NOT changed"); return False
    okd, live = live_files(fn)
    mine = f"supabase/functions/{fn}/index.ts"
    if not okd or mine not in live: bad(f"{fn}: couldn't read its live copy, NOT changed"); return False
    need = deps_of(fn)
    if all(k in live and live[k] == sha(os.path.join(ROOT, k)) for k in need):
        say(f"  ✓ {fn} already had it"); return True
    if live[mine] != base_sha(mine) and live[mine] != sha(os.path.join(ROOT, mine)):
        bad(f"{fn}: its live code is not today's GitHub main (was something else deployed, or an earlier Desktop step not run?), NOT changed"); return False
    pinned = {pinpath(k) for k in SHAS}
    # A shared file this build newly imports is not in the live copy yet: fine when it is unchanged GitHub code
    # (same at the reviewed base and now). Anything present but different still stops. (2026-10-03 fix)
    other = [k.split("supabase/functions/", 1)[1] for k in need if k != mine and k not in pinned
             and ((k in live and live[k] != sha(os.path.join(ROOT, k))) or (k not in live and base_sha(k) != sha(os.path.join(ROOT, k))))]
    if other: bad(f"{fn}: live shared code differs from GitHub ({', '.join(sorted(other))[:160]}), NOT changed"); return False
    odd = [k.split("supabase/functions/", 1)[1] for k in need if k != mine and k in pinned and k in live and live[k] not in (base_sha(k), sha(os.path.join(ROOT, k)))]
    if odd: bad(f"{fn}: its live {', '.join(sorted(odd))} is neither today's GitHub main nor this build, NOT changed"); return False
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

SWQ = "select " + ", ".join(f"data->'{k}' as \"{k}\"" for k in SWITCHES) + " from public.app_data where key = 'ops_settings'"
def switches():
    ok, r = sql(SWQ)
    return (r[0] if ok and r else None)
word = lambda v: "ON" if v is True else ("off" if v in (False, None) else str(v))
NQ = "select count(*)::int as n, coalesce(max(updated_at)::text, '') as last from public.late_notices"

say("432 · CALLS TELL US \"RUNNING LATE\" (HER CALL TO MARY)"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
reviewed()
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
s, b = http("GET", f"{API}/v1/projects/{REF}/secrets", headers=MG())
sec = {x.get("name") for x in (jl(b) or []) if isinstance(x, dict)} if s == 200 else set()
if not sec: bad("couldn't read the function secret names. Nothing was changed."); done(3)
need_sec = {"GHL_LOCATION_ID", "ANTHROPIC_API_KEY", "HUB_JOB_SECRET"}
if not need_sec <= sec or not ({"GHL_TOKEN", "GHL_API_KEY"} & sec): bad(f"a secret the call reader needs is missing ({', '.join(sorted(need_sec - sec)) or 'GHL_TOKEN'}). Nothing was changed."); done(3)
say("  ✓ GoHighLevel, the AI key (Anthropic, agreement signed) and the link secret are set")
ok, ex = sql("select to_regclass('public.late_notices') is not null as t, (select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'late_notices' and column_name in ("
             + ", ".join(f"'{c}'" for c in COLS) + ")) as cols")
E = (ex or [{}])[0] if ok else {}
if not E.get("t"): bad("the running-late table (late_notices, Desktop 363) is not there. Nothing was changed. Tell Claude."); done(3)
say("  ✓ the running-late table (363) is there" + (f"; {E.get('cols')} of the 7 new columns already exist (running the SQL again is safe)" if E.get("cols") else ""))
ok, jobs = sql("select jobname, schedule, active from cron.job where command ilike '%late-watch%' or command ilike '%timekeeper-watch%' order by jobname")
J = jobs if ok and isinstance(jobs, list) else []
if any("late" in str(j.get("jobname", "")).lower() for j in J): say("  ✓ the schedule runs late-watch: " + "; ".join(f"{j['jobname']} {j['schedule']}" + ("" if j.get("active") else " (switched off)") for j in J if "late" in str(j.get("jobname", "")).lower()))
elif ok: say("  · ATTENTION: no schedule for late-watch was found by name, so calls would not be read on their own. Tell Claude (363 should have made it).")
else: say("  · couldn't read the schedules (not needed for the install)")
BEFORE = switches()
if BEFORE is None: bad("couldn't read the settings (ops_settings). Nothing was changed."); done(3)
say("  · switches now: " + ", ".join(f"{k} {word(BEFORE.get(k))}" for k in ("late_watch_live", "late_cg_reply_live", "late_admin_live", "timekeeper_admin_loop_live", "call_pull_live")) + ". This installer changes none of them.")
lc = BEFORE.get("late_call_live")
say("  · the NEW switch late_call_live is " + ("not set, which means ON (a caregiver's call is read and can pause the missed clock-in texts). She can turn it off in the Hub: Settings, Running late, \"Turn off calls\"." if lc is None else word(lc) + " (she set it; left as it is)."))
K = keys(); ANON, SERVICE = K.get("anon", ""), K.get("service_role", "")
HIDE += [ANON, SERVICE]
if not ANON: bad("couldn't read the project's public key. Nothing was changed."); done(3)
say("  ✓ read the project's keys (kept in memory only, never printed)")

say(); say("PART 2 · CHANGE (in order; each step only if the one before it worked)")
ok, r = sql(open(os.path.join(ROOT, SQLFILE)).read())
if not ok: bad("the database change didn't go in (one transaction, so nothing in it changed): " + str(r)[:300]); say("  STOP. Tell Claude."); done(4)
ok, cr = sql("select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'late_notices' and column_name in (" + ", ".join(f"'{c}'" for c in COLS) + ")")
chk(ok and cr and cr[0].get("n") == 7, "the database change is in: late_notices has the 7 call columns (staff still only read it)")
if fails: say("  STOP. No function was changed. Tell Claude."); done(4)
went = []
for fn in ORDER:
    if deploy(fn): went.append(fn)
    else:
        say(f"  STOP. {fn} is not updated, so nothing after it was changed" + (" (the missed clock-in texts work exactly as before; calls are not read)." if fn == "timekeeper-watch" else
            " (the missed clock-in pause is in; the rest waits). Tell Claude."))
        break

say(); say("PART 3 · PROOF (nothing is sent, nothing is written)")
for fn in went:
    good, why = is_reviewed_live(fn)
    chk(good, f"{fn}: the live copy is exactly the reviewed build" + ("" if good else f" ({why})"))
FN = lambda n: f"{FNB}/functions/v1/{n}"
H = {"Authorization": "Bearer " + ANON, "apikey": ANON}
for fn in ("late-watch", "timekeeper-watch"):
    s1, _ = http("POST", FN(fn), {}, H)
    chk(s1 == 401, f"{fn} with the public key is refused ({s1}); nothing read or sent")
for fn, made_up in (("clockin-alert", {"c": "tk_made_up", "a": "0" * 16, "e": 4102444800, "t": "x" * 43, "action": "view"}),
                    ("late-alert", {"c": "ln_made_up", "a": "0" * 16, "e": 4102444800, "t": "x" * 43, "action": "view"})):
    s3, _ = http("POST", FN(fn), {"action": "view"}, H); s4, _ = http("POST", FN(fn), made_up, H)
    chk(s3 in (401, 403) and s4 in (401, 403), f"{fn}: no link ({s3}) and a made-up link ({s4}) are refused before anything is read")
if SERVICE and "late-watch" in went and "timekeeper-watch" in went:
    ok, n0 = sql(NQ)
    SH = {"Authorization": "Bearer " + SERVICE, "apikey": ANON}
    s5, b5 = http("POST", FN("late-watch") + "?dry=1", {}, SH, timeout=170); j5 = jl(b5) or {}
    chk(s5 == 200 and j5.get("dry") is True and "calls_live" in j5 and j5.get("cg_texts") == 0 and j5.get("admin_texts") == 0,
        f"one practice run of late-watch (?dry=1: texts nobody, writes nothing): {j5.get('caregivers_watched', '?')} caregiver(s) with a shift in the window, "
        f"{j5.get('calls_read', 0)} call(s) read, {j5.get('notices_new', 0)} notice(s) it WOULD make ({s5})")
    if j5.get("transcripts"): say("  · ATTENTION: " + str(j5["transcripts"]))
    s6, b6 = http("POST", FN("timekeeper-watch") + "?dry=1", {}, SH, timeout=170); j6 = jl(b6) or {}
    chk(s6 == 200 and j6.get("mode") == "DRY RUN", f"one practice run of the missed clock-in watcher (?dry=1: texts nobody, writes nothing; held for running late: {j6.get('held_running_late', '?')}) ({s6})")
    ok2, n1 = sql(NQ)
    chk(ok and ok2 and n0 == n1, "no running-late notice was written by the practice runs")
else: say("  · the server key wasn't readable (or a function wasn't updated), so the practice runs were skipped (the tests cover them)")
AFTER = switches()
same = AFTER is not None and all(json.dumps(AFTER.get(k)) == json.dumps(BEFORE.get(k)) for k in SWITCHES)
chk(same, "every switch is exactly as it was (late_call_live " + ("not set = ON" if (AFTER or {}).get("late_call_live") is None else word((AFTER or {}).get("late_call_live"))) + ", late_watch_live " + word((AFTER or {}).get("late_watch_live")) + ")")

say()
if fails: say("RESULT: PARTLY DONE · the ✗ lines above need Claude. Nothing was texted.")
else: say("RESULT: DONE · a caregiver's call (you calling them, or them calling the office line) that says they're running late is now read "
          "like a text. With a time, the missed clock-in texts pause until 5 minutes after it, and the alert link page says \"Mary said on your "
          "4:31pm call: running late, about 8 minutes (around 4:39pm)\". Next: merge the Hub branch call-transcript-late (cc-hub-live) so the pages "
          "and the Needs Attention cards show it, and Settings has the \"calls\" switch.")
say("Family: only ever by a person's tap on \"Send to the family\" (the exact text and who gets it are shown first; Family Circle members who agreed to texts; "
    "10+ minutes late with a time; 6am to 9pm). The client is never texted. There is no automatic family text.")
say("Nothing was texted, emailed or called by this installer. No setting was changed. Nothing was written to AxisCare or GoHighLevel.")
say("Rollback (only if ever needed): turn calls off in Settings (Running late, \"Turn off calls\"): nothing is paused because of a call and new call notices are practice only. "
    "Full rollback: Claude redeploys the four functions from the commit before 432; the 7 columns can stay unused.")
done(1 if fails else 0)
