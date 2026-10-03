#!/usr/bin/env python3
# 426 · AFTER-HOURS MISSED CLOCK-INS AND CALL-INS. Samantha 2026-10-03, after 425 made 8pm to 7am quiet for the office:
# "i want the missed clock ins to be live after hours too, that and call ins".
# The Hub project (zngsgedlsxinbygwmxwn) only. What changes (code only, no database change, no setting written):
#   _shared/quiet-hours.ts: afterHoursAllowed(settings, kind). Two exceptions to the office quiet hours, each ON unless
#   she switches it off in the Hub (ops_settings.missed_clockin_after_hours / callin_after_hours set to false):
#     1. missed clock-ins: the timekeeper-watch admin texts (still at most 6 per admin per alert) and their closers
#        ("clocked in", "coverage case opened", clockin-alert "Resolved by X", only to admins who were texted about it);
#     2. call-ins: every coverage-run call-in alert texts the admins at any hour (must-cover was already any hour).
#   _shared/clockin-admins.ts: textAdmin can pass the exception to the staff backstop (contactForOutbound).
#   EVERYTHING ELSE STAYS QUIET 8pm to 7am: the Saturday EVV office nudge, running late, coverage-reply YES, the
#   quiet-callout and ran-out office texts, missed-call escalation, the watchdog, lead texts.
# It does NOT turn the missed clock-in admin texts on: timekeeper_admin_loop_live stays as it is (OFF since 424); no
# setting is written at all. The switches are read before and after.
# Part 1 (read only): the reviewed builds (pinned), the tests pass here, the switches as they are now.
# Part 2: each function that uses a changed file is redeployed, only if its live copy is today's GitHub main (or already
#   this build), keeping its gateway setting. The three that change behaviour go first.
# Part 3 (proof, NOTHING is sent): every live copy is the reviewed build; the public key is refused; the timekeeper's
#   sign-in check; one practice run of the timekeeper (?dry=1: reads today's AxisCare visits, texts nobody and changes no
#   alert) showing the after-hours switch in force; the switches are exactly as they were.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
REF = "zngsgedlsxinbygwmxwn"
ROOT = os.environ["SB_REPO"]; BASE = os.environ.get("SB_BASE", "")
SHAS = json.loads(os.environ["SB_SHAS"])
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FIRST = ["timekeeper-watch", "clockin-alert", "coverage-run", "late-watch", "late-alert"]
SWITCHES = ["timekeeper_admin_loop_live", "timekeeper_watch_live", "timekeeper_text_live", "late_watch_live", "late_admin_live",
            "coverage_send_live", "evv_chase_live", "live", "office_quiet_start", "office_quiet_end", "timekeeper_admin_max_texts",
            "missed_clockin_after_hours", "callin_after_hours"]
TESTS = ["quiet_hours_425_test.mjs", "c1_missed_clockin_test.mjs", "late_l1_test.mjs", "late_watch_test.mjs", "staff_alerts_one_contact_test.mjs",
         "nsf2_families_test.mjs", "nsf2_hiring_test.mjs", "nsf2_scheduling_test.mjs", "j1_job_locks_test.mjs", "retry_test.mjs", "optout_0b3_test.mjs",
         "missed_notes_test.mjs", "callin_plan_harness.mjs"]
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
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-afterhours426/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, f"HTTP {s}: {b[:300]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:200]
def fmeta(fn):
    s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{fn}", headers=MG())
    try: return s, (json.loads(b) if s == 200 else None)
    except Exception: return s, None
def keys():
    """The project's keys. Lesson from 412: ask with ?reveal=true first, then without it. A value that isn't a usable
    key counts as missing."""
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_publishable_") or v.startswith("sb_secret_")) and "·" not in v and "*" not in v
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
    changed = sorted(x for x in git("diff", "--name-only", BASE, "HEAD", "--", "supabase/functions").stdout.decode().split() if x.endswith(".ts") and os.path.exists(os.path.join(ROOT, x)))
    pinned = {pinpath(k): v for k, v in SHAS.items()}
    if not pinned or not set(pinned) <= set(changed): bad(f"the reviewed files aren't all changed here ({', '.join(sorted(set(pinned) - set(changed)))[:200]})"); say("  STOP. Nothing was run."); done(2)
    for rel, want in pinned.items():
        if sha(os.path.join(ROOT, rel)) != want: bad(f"{rel.split('functions/')[1]} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
    fnroot = os.path.join(ROOT, "supabase/functions"); users = []
    for fn in sorted(os.listdir(fnroot)):
        p = os.path.join(fnroot, fn, "index.ts")
        if fn.startswith("_") or not os.path.exists(p): continue
        used = {os.path.relpath(x, ROOT).replace(os.sep, "/") for x in (lambda s: (deps(p, s), s)[1])(set())}
        if used & set(pinned): users.append((fn, used))
    # Another change merged since (another branch): fine only when none of the functions this updates uses it.
    extra = sorted(set(changed) - set(pinned))
    touch = sorted({e for e in extra for fn, used in users if e in used})
    if touch: bad(f"other changes merged since the review touch these functions ({', '.join(touch)[:200]}). Ask Claude to refresh 426."); say("  STOP. Nothing was run."); done(2)
    names = [fn for fn, _ in users]
    say(f"  ✓ the {len(pinned)} changed file(s) are the reviewed build" + (f" (other merged changes don't touch them: {', '.join(e.split('functions/')[1] for e in extra)[:160]})" if extra else ""))
    say(f"  ✓ functions to update ({len(names)}): {', '.join(names)}")
    return [f for f in FIRST if f in names] + [f for f in names if f not in FIRST]

def live_files(fn):
    tmp = tempfile.mkdtemp(prefix="ah426-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
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
        bad(f"{fn}: its live code is not today's GitHub main (was something else deployed?), NOT changed"); return False
    pinned = {pinpath(k) for k in SHAS}
    other = [k.split("supabase/functions/", 1)[1] for k in need if k != mine and k not in pinned and (k not in live or live[k] != sha(os.path.join(ROOT, k)))]
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

say("426 · MISSED CLOCK-INS AND CALL-INS TEXT THE ADMINS AFTER HOURS TOO (EVERYTHING ELSE STAYS QUIET 8PM TO 7AM)"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
order = reviewed()
NODE = shutil.which("node") or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.path.exists(p)), "")
if NODE:
    for t in TESTS:
        p = subprocess.run([NODE, t], cwd=ROOT, capture_output=True, text=True)
        last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
        if p.returncode != 0 or "FAIL" in last or "✗" in p.stdout or re.search(r"^FAIL", p.stdout, re.M): bad(f"{t} failed: {last}"); say("  STOP. Nothing was run."); done(2)
        say(f"  ✓ {t}: {last.strip()} (run here, against fakes; nothing sent)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
BEFORE = switches()
if BEFORE is None: bad("couldn't read the settings (ops_settings). Nothing was changed."); done(3)
say(f"  ✓ missed clock-in admin texts (timekeeper_admin_loop_live): {word(BEFORE.get('timekeeper_admin_loop_live'))}. This installer does not change it.")
qs, qe = BEFORE.get("office_quiet_start"), BEFORE.get("office_quiet_end")
say(f"  · office quiet hours setting: {'not set, so 8pm to 7am Central' if qs is None and qe is None else f'start {qs}, end {qe}'}")
ah = lambda k: "not set, so ON (the default)" if BEFORE.get(k) is None else ("ON" if BEFORE.get(k) not in (False, "false") else "OFF (she switched it off)")
say(f"  · missed clock-ins text admins after hours (missed_clockin_after_hours): {ah('missed_clockin_after_hours')}")
say(f"  · call-ins text admins after hours (callin_after_hours): {ah('callin_after_hours')}")
say("  · other switches now: " + ", ".join(f"{k} {word(BEFORE.get(k))}" for k in ("timekeeper_watch_live", "timekeeper_text_live", "late_admin_live", "coverage_send_live", "evv_chase_live")) + f", missed-call texts (live) {word(BEFORE.get('live'))}")
K = keys(); ANON, SERVICE = K.get("anon", ""), K.get("service_role", "")
HIDE += [ANON, SERVICE]
if not ANON: bad("couldn't read the project's public key. Nothing was changed."); done(3)
say("  ✓ read the project's keys (kept in memory only, never printed)")

say(); say(f"PART 2 · UPDATE {len(order)} FUNCTIONS (the three that change first; each only if its live copy is today's GitHub main)")
went = [fn for fn in order if deploy(fn)]

say(); say("PART 3 · PROOF (nothing is sent)")
for fn in went:
    good, why = is_reviewed_live(fn)
    chk(good, f"{fn}: the live copy is exactly the reviewed build" + ("" if good else f" ({why})"))
TK = f"{FNB}/functions/v1/timekeeper-watch"
s1, _ = http("POST", TK, {}, {"Authorization": "Bearer " + ANON, "apikey": ANON})
chk(s1 == 401, f"the timekeeper with the public key is refused ({s1}); nothing read or sent")
if SERVICE and "timekeeper-watch" in went:
    s2, b2 = http("POST", TK + "?auth_check=1", {}, {"Authorization": "Bearer " + SERVICE, "apikey": ANON})
    chk(s2 == 200 and '"ok":true' in b2.replace(" ", ""), f"the timekeeper's own door answers (auth_check: returns before anything is read or sent) ({s2})")
    s3, b3 = http("POST", TK + "?dry=1", {}, {"Authorization": "Bearer " + SERVICE, "apikey": ANON}, timeout=170)
    try: j3 = json.loads(b3)
    except Exception: j3 = {}
    al = j3.get("admin_loop") or {}; qh = al.get("quiet_hours") or {}
    good = (s3 == 200 and j3.get("mode") == "DRY RUN" and isinstance(qh.get("now"), bool) and qh.get("hours") and al.get("max_texts_each")
            and isinstance(qh.get("missed_clockin_after_hours"), bool) and isinstance(qh.get("loop_quiet"), bool))
    chk(good, f"one practice run of the timekeeper (?dry=1: reads today's visits; texts nobody, changes no alert): office quiet hours {qh.get('hours')}"
        + (f", quiet right now: {'yes' if qh.get('now') else 'no'}; missed clock-in texts after hours: {'ON' if qh.get('missed_clockin_after_hours') else 'off'}; "
           f"at most {al.get('max_texts_each')} admin texts per alert" if good else f" ({s3}: {str(b3)[:160]})"))
    if good: say(f"    (practice run: {j3.get('visits_seen', '?')} visits seen today, {al.get('texts', 0)} admin texts, {j3.get('texts_sent', 0)} caregiver texts; nothing is sent in a practice run)")
else: say("  · the server key wasn't readable (or the timekeeper wasn't updated), so the timekeeper's practice run was skipped (the tests cover it)")
AFTER = switches()
same = AFTER is not None and all(json.dumps(AFTER.get(k)) == json.dumps(BEFORE.get(k)) for k in SWITCHES)
chk(same, f"every switch is exactly as it was; the missed clock-in admin texts are still {word((AFTER or {}).get('timekeeper_admin_loop_live'))}")
say("  · What changed is proved by quiet_hours_425_test.mjs and callin_plan_harness.mjs above (the real timekeeper-watch,")
say("    clockin-alert, coverage-run and ops-escalate against fakes, on a fake clock). With her switches at the default: a")
say("    3am missed clock-in texts each admin (6 at most), \"clocked in\" and \"Resolved by\" go at night only to admins who")
say("    were texted, a 3am call-in texts the admins; the Saturday EVV nudge, running late, missed calls and lead texts stay")
say("    quiet. With a switch set to off in the Hub: exactly the 425 quiet hours again.")
say()
lw = word((AFTER or {}).get("timekeeper_admin_loop_live"))
if fails: say("RESULT: PARTLY DONE · the ✗ lines above need Claude. The functions not updated keep the 425 quiet hours for everything.")
else: say("RESULT: DONE · call-ins now text the admins at any hour. Missed clock-ins will too, once the missed clock-in admin "
          f"texts are switched on (they are {lw} now; that is her call, in daytime). Everything else stays quiet 8pm to 7am. "
          "Merge the Hub branch after-hours-alerts (cc-hub-live) next so Settings shows the two switches.")
say("Nothing was texted or emailed by this installer, and no setting was changed (the admin texts stay as they were).")
say("Rollback: switch either one off in the Hub (Settings), or Claude redeploys the 425 functions from GitHub. No database change to undo.")
done(1 if fails else 0)
