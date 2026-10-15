#!/usr/bin/env python3
# 748 · EVERY INTERVIEW CANCEL AND MOVE, ON THE APPLICANT'S PAGE. Samantha 2026-10-15: "when an applicant cancels and
#   reschedules their interview please record that in their profile so we can see if theyve canceled and rescheduled a bunch
#   of times, that can be a pattern of unreliability."
#   The database: interview_bookings.office_user (who in the office made a change); interview_cancel / interview_reschedule
#   trust the office (signed-in Hub, or the Hub's server) to say who asked, and never hold the office to the applicant's
#   online limits. Fixes: the office Cancel sheet's "We need to cancel" was saved as the APPLICANT cancelling, and once an
#   applicant had used their two online changes the office could not cancel for them at all. The public page is unchanged.
#   The server: applicant-text records who in the office cancelled. Never texts or emails anyone; no booking is changed.
# Part 1 (read only): the reviewed build; the tests pass here; the live rules are 461's (or already this); applicant-text
#   is the build before this one (or already this one); counts. Asks yes. Part 2: the rules (one transaction), then
#   applicant-text. Part 3 (proof): the live rules and server are the reviewed ones; applicant-text refuses the public key.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil, time
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
HUB_REF = "zngsgedlsxinbygwmxwn"
HUB = os.environ["SB_REPO"]; HUB_BASE = os.environ.get("SB_BASE", "")
HUB_SHAS = json.loads(os.environ["SB_SHAS"])
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB_REF}.supabase.co")
POLL = float(os.environ.get("SB_POLL", "2")); POLL_MAX = float(os.environ.get("SB_POLL_MAX", "40"))
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
def http(method, url, body=None, headers=None, timeout=200, raw=False):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-748/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            b = r.read(); return r.status, (b if raw else b.decode(errors="replace"))
    except urllib.error.HTTPError as e: return e.code, (b"" if raw else e.read().decode(errors="replace"))
    except Exception as e: return None, (b"" if raw else type(e).__name__)
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{HUB_REF}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, f"HTTP {s}: {b[:300]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:200]
def fmeta(ref, fn):
    s, b = http("GET", f"{API}/v1/projects/{ref}/functions/{fn}", headers=MG())
    try: return s, (json.loads(b) if s == 200 else None)
    except Exception: return s, None
def secrets(ref):
    s, b = http("GET", f"{API}/v1/projects/{ref}/secrets", headers=MG())
    try: return {x.get("name") for x in json.loads(b)} if s == 200 else set()
    except Exception: return set()
def keys(ref):
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_publishable_") or v.startswith("sb_secret_")) and "·" not in v and "*" not in v
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{ref}/api-keys{q}", headers=MG())
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
def chk(good, msg): (say if good else bad)(("  ✓ " if good else "") + msg)
pinpath = lambda k: f"supabase/functions/{k}.ts" if k.startswith("_shared/") else f"supabase/functions/{k}/index.ts"
def git(root, *a): return subprocess.run(["git", *a], cwd=root, capture_output=True)
def deps(path, seen):
    if path in seen or not os.path.exists(path): return
    seen.add(path)
    for m in re.findall(r"""from\s+['"](\.{1,2}/[^'"]+)['"]|import\s+['"](\.{1,2}/[^'"]+)['"]""", open(path).read()):
        deps(os.path.normpath(os.path.join(os.path.dirname(path), m[0] or m[1])), seen)
def need(root, fn):
    s = set(); deps(os.path.join(root, f"supabase/functions/{fn}/index.ts"), s)
    return {os.path.relpath(x, root).replace(os.sep, "/") for x in s}
def live_files(ref, fn):
    tmp = tempfile.mkdtemp(prefix="cl748-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
    d = subprocess.run([SUPA, "functions", "download", fn, "--project-ref", ref, "--use-api"], cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    live = {}
    for r, _, files in os.walk(tmp):
        for f in files:
            lp = os.path.join(r, f).replace(os.sep, "/")
            if "/functions/" in lp: live["supabase/functions/" + lp.split("/functions/", 1)[1]] = sha(lp)
    shutil.rmtree(tmp, ignore_errors=True)
    return d.returncode == 0, live
def base_sha(root, base, rel):
    b = git(root, "show", f"{base}:{rel}")
    return shab(b.stdout) if b.returncode == 0 else None
def reviewed(root, base, shas, label, extra=()):
    if not base or git(root, "cat-file", "-e", base + "^{commit}").returncode != 0: bad(f"the reviewed starting point isn't in the {label} history"); say("  STOP. Nothing was run."); done(2)
    changed = set(git(root, "diff", "--name-only", base, "HEAD").stdout.decode().split())
    for rel, want in [(pinpath(k), v) for k, v in shas.items()] + list(extra):
        if rel not in changed or not os.path.exists(os.path.join(root, rel)) or sha(os.path.join(root, rel)) != want:
            bad(f"{label}: {rel.split('functions/')[-1]} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
    return changed
def state(ref, root, base, fn, pinned):
    """'new' | 'base' | 'this' | 'other' for one live function, with its gateway setting."""
    s, m = fmeta(ref, fn)
    if s == 404: return "new", None
    vj = (m or {}).get("verify_jwt")
    okd, live = live_files(ref, fn)
    if not okd or not isinstance(vj, bool): return "unreadable", vj
    nd = need(root, fn)
    if all(k in live and live[k] == sha(os.path.join(root, k)) for k in nd): return "this", vj
    if all((k in live and live[k] == base_sha(root, base, k)) or (k not in live and base_sha(root, base, k) is None and k in pinned) for k in nd): return "base", vj
    return "other", vj
def deploy(ref, root, fn, vj, label):
    p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", ref, "--use-api"] + ([] if vj in (True, None) else ["--no-verify-jwt"]), cwd=root, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    okd, live = live_files(ref, fn)
    good = okd and all(k in live and live[k] == sha(os.path.join(root, k)) for k in need(root, fn))
    if not good: bad(f"{label} {fn} didn't deploy: " + (p.stderr or p.stdout)[-200:]); return False
    want = True if vj is None else vj
    sN, mN = fmeta(ref, fn)
    if (mN or {}).get("verify_jwt") != want:
        http("PATCH", f"{API}/v1/projects/{ref}/functions/{fn}", {"verify_jwt": want}, MG()); sN, mN = fmeta(ref, fn)
    chk((mN or {}).get("verify_jwt") == want, f"{label}: {fn} deployed, version {(mN or {}).get('version', '?')} (gateway sign-in check {'on' if want else 'off'})")
    return True
def lit(v): return "'" + str(v).replace("'", "''") + "'"
SQLFILE, RBFILE = "interview_history_748.sql", "interview_history_748_rollback.sql"
RULES = ("interview_cancel", "interview_reschedule")
def body_of(path, name):
    m = re.search(r"create\s+or\s+replace\s+function\s+(?:public\.)?" + name + r"\s*\([^)]*\)[\s\S]*?\bas\s+(\$\w*\$)([\s\S]*?)\1", open(path).read(), re.I)
    return re.sub(r"\s+", " ", m.group(2)).strip() if m else None
def live_rules():
    ok, rows = sql("select p.proname n, p.prosrc src from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('interview_cancel','interview_reschedule')")
    if not ok: return None
    out = {}
    for r in rows:
        if r["n"] in out: return None   # more than one of a name: not what this was built on
        out[r["n"]] = re.sub(r"\s+", " ", r["src"]).strip()
    return out
FNS = {"applicant-text": None}   # keeps its own gateway setting
TESTS = ["applicant_text_test.mjs"]

say("748 · EVERY INTERVIEW CANCEL AND MOVE, ON THE APPLICANT'S PAGE"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
reviewed(HUB, HUB_BASE, HUB_SHAS, "the Hub server", [(SQLFILE, os.environ.get("SB_SQL_SHA", "")), (RBFILE, os.environ.get("SB_RB_SHA", ""))])
pinned = {pinpath(k) for k in HUB_SHAS}
for fn in FNS:
    other = sorted(k for k in need(HUB, fn) if k not in pinned and base_sha(HUB, HUB_BASE, k) != sha(os.path.join(HUB, k)))
    if other: bad(f"other changes merged since the review touch {fn} ({', '.join(other)[:200]}). Ask Claude to refresh 748."); say("  STOP. Nothing was run."); done(2)
say("  ✓ the rules and applicant-text are the reviewed build")
NODE = shutil.which("node") or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.path.exists(p)), "")
if NODE:
    for t in TESTS:
        p = subprocess.run([NODE, t], cwd=HUB, capture_output=True, text=True)
        last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
        if p.returncode != 0: bad(f"{t} failed: {last}"); say("  STOP. Nothing was changed."); done(2)
        say(f"  ✓ {t}: {last.strip()}")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
say("  · the new rules were proved on a real Postgres copy with made-up people when built (interview_history_748_test.mjs, 17 checks)")
OLD = {n: body_of(os.path.join(HUB, RBFILE), n) for n in RULES}; NEW = {n: body_of(os.path.join(HUB, SQLFILE), n) for n in RULES}
if not all(OLD.values()) or not all(NEW.values()): bad("couldn't read the rules from the files. Tell Claude."); done(2)
L = live_rules()
if not L or set(L) != set(RULES): bad("couldn't read the live cancel and move rules (or there is more than one of each). Nothing was changed. Tell Claude."); done(3)
for n in RULES:
    if L[n] not in (OLD[n], NEW[n]): bad(f"the live {n} isn't the one this was built on (461). Nothing was changed. Tell Claude."); done(3)
RULES_DONE = all(L[n] == NEW[n] for n in RULES)
say("  ✓ the live cancel and move rules are " + ("already this build (an earlier run)" if RULES_DONE else "the ones this was built on (461)"))
STATES = {}
for fn in FNS:
    st, vj = state(HUB_REF, HUB, HUB_BASE, fn, pinned)
    # 2026-10-15 first run stopped here ("other"): the live applicant-text is the 712 build (2026-10-14), from before the nurse
    # license reminders added two registry lines to _shared/outreach.ts and _shared/send-problems.ts (it was not redeployed).
    # That exact older build (SB_ALT_BASE) also counts as "the build before this change"; anything else still stops.
    if st == "other" and os.environ.get("SB_ALT_BASE"):
        st2, vj2 = state(HUB_REF, HUB, os.environ["SB_ALT_BASE"], fn, pinned)
        if st2 == "base": st, vj = "base", vj2; say("  · applicant-text is the build from 712 (before the nurse reminder lines in two shared files); this deploy brings them")
    if st not in ("base", "this"): bad(f"{fn} on the server is not what 748 expects ({st}). Nothing was changed. Tell Claude."); done(3)
    STATES[fn] = (st, vj); say(f"  ✓ {fn}: " + {"this": "already this build", "base": "the build before this change"}[st])
ok, cnt = sql("""select count(*) filter (where status = 'cancelled' and (cancelled_by = 'applicant' or (cancelled_by = 'reschedule' and cancel_reason = 'moved by the applicant')))::int asked,
  count(*) filter (where status = 'cancelled' and cancelled_by = 'office')::int office,
  count(*) filter (where status = 'cancelled' and cancelled_by = 'reschedule' and cancel_reason = 'moved by the office')::int office_moves,
  count(*) filter (where status = 'noshow')::int noshow
  from public.interview_bookings""")
if not ok or not cnt: bad("couldn't read the bookings. Nothing was changed."); done(3)
c0 = cnt[0]
say(f"  · already on record: {c0['asked']} cancel(s) and move(s) by applicants, {c0['office']} cancel(s) and {c0['office_moves']} move(s) by the office, {c0['noshow']} no-show(s). All of them show on the applicant pages.")
say("  · older office cancels from the Cancel sheet were saved as the applicant's; that can't be told apart now, so they count as theirs")
K = keys(HUB_REF); ANON = K.get("anon", ""); HIDE += [ANON, K.get("service_role", "")]
if not ANON: bad("couldn't read the Hub's public key. Nothing was changed."); done(3)
say(""); say("THE CHANGE")
say("  · the database keeps who in the office cancelled or moved an interview")
say("  · the office's Cancel and Move say who asked (they did, or we did), and the office is never blocked by the applicant's online limits")
say("  · the apply page is unchanged: two online changes, nothing in the last two hours")
try:
    with open("/dev/tty", "w") as tw: tw.write("\n  Make this change? Type yes and press Enter: "); tw.flush()
    with open("/dev/tty") as tr: a = tr.readline().strip().lower()
except Exception: a = os.environ.get("SB_YES", "")
if a != "yes": say("  · you didn't type yes, so nothing was changed."); done(0)

say(); say("PART 2 · CHANGE")
if RULES_DONE: say("  ✓ the rules already had it")
else:
    q = open(os.path.join(HUB, SQLFILE)).read()
    if q.count("\ncommit;") != 1: bad("the rule file isn't one transaction. Nothing was changed. Tell Claude."); done(5)
    ok, r = sql(q)
    if not ok: bad("the change didn't go in (nothing was changed): " + str(r)[:240]); done(5)
    say("  ✓ saved: the office_user column and the cancel and move rules")
for fn, want in FNS.items():
    st, vj = STATES[fn]
    if st == "this": say(f"  ✓ {fn} already had it"); continue
    if not deploy(HUB_REF, HUB, fn, want if want is not None else vj, "Hub"): say("  STOP. Tell Claude."); done(6)
time.sleep(float(os.environ.get("SB_SETTLE", "8")))

say(); say("PART 3 · PROOF (read only, nothing is cancelled)")
L = live_rules() or {}
chk(all(L.get(n) == NEW[n] for n in RULES), "the live cancel and move rules are the new ones")
ok, col = sql("select count(*)::int n from information_schema.columns where table_schema = 'public' and table_name = 'interview_bookings' and column_name = 'office_user'")
chk(ok and col and col[0]["n"] == 1, "the bookings keep who in the office made a change")
for fn in FNS:
    okd, live = live_files(HUB_REF, fn)
    chk(okd and all(k in live and live[k] == sha(os.path.join(HUB, k)) for k in need(HUB, fn)), f"{fn}: the live copy is exactly the reviewed build")
s1 = http("POST", f"{FNB}/functions/v1/applicant-text", {"action": "cancel_draft", "id": "proof748"}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
chk(s1 in (401, 403), f"applicant-text refuses the public key ({s1})")
say()
say("RESULT: " + ("DONE · the server is ready. Next: Claude merges the Hub change (the Interview history card)." if not fails else "PARTLY DONE · the ✗ lines above need Claude."))
say("Nothing was texted or emailed. No booking was changed.")
say("Rollback: interview_history_748_rollback.sql puts the rules back; Claude redeploys applicant-text from the build before 748.")
done(0 if not fails else 8)
