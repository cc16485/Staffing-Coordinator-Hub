#!/usr/bin/env python3
# 991 · CALLS NOBODY COULD READ BECOME MY WORK CARDS, PRACTICE FIRST (her "yes" 2026-10-18 to the Today clean-up; no
#   silent failures). A real conversation the call reader gave up on (three failed tries, or no transcript on a call of
#   30 seconds or more) becomes one "Couldn't read" card in My Work, but only once the Admin switch call_unread_cards_live
#   is on. Hang-ups make no card. Until the switch is on the reader only lists what it would make.
#   Part 1 (read only): reviewed build, tests, live call-tasks = the 975 build this builds on, the switch state.
#   Part 2: call-tasks deployed (no database change, NO switch changed). Part 3 (proof): live copy is this build,
#   refuses the public key, one reader run, the heartbeat is OK, no such card made while the switch is off, and the
#   list of what it would make. Never texts, emails or calls anyone.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil, time
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
HUB_REF = "zngsgedlsxinbygwmxwn"
HUB = os.environ["SB_REPO"]; HUB_BASE = os.environ.get("SB_BASE", "")
HUB_SHAS = json.loads(os.environ["SB_SHAS"])
PRIOR = json.loads(os.environ.get("SB_PRIOR", "{}")); PRIOR_USED = set()   # a shared file whose earlier copy is what is live now (merged since the last deploy)
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
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-991/1.0"}, **(headers or {})))
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
    tmp = tempfile.mkdtemp(prefix="cl991-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
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
    if all((k in live and (live[k] == base_sha(root, base, k) or live[k] == PRIOR.get(k))) or (k not in live and base_sha(root, base, k) is None and k in pinned) for k in nd):
        PRIOR_USED.update(k for k in nd if k in live and live[k] == PRIOR.get(k) and live[k] != base_sha(root, base, k))
        return "base", vj
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
FN = "call-tasks"; JOB = "call-tasks"
TESTS = [("unread_cards_991_test.mjs", "plain"), ("promise_cards_975_test.mjs", "plain"), ("cards_close_919_test.mjs", "pglite")]
UCARDS = """select count(*) filter (where x->>'id' like 'cfu\\_%')::int as unread_cards
  from public.app_data a, jsonb_array_elements(case when jsonb_typeof(a.data) = 'array' then a.data else '[]'::jsonb end) x where a.key = 'ops_items'"""

say("991 · CALLS NOBODY COULD READ BECOME MY WORK CARDS (PRACTICE FIRST)"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
reviewed(HUB, HUB_BASE, HUB_SHAS, "the Hub server")
pinned = {pinpath(k) for k in HUB_SHAS}
other = sorted(k for k in need(HUB, FN) if k not in pinned and base_sha(HUB, HUB_BASE, k) != sha(os.path.join(HUB, k)))
if other: bad(f"other changes merged since the review touch {FN} ({', '.join(other)[:200]}). Ask Claude to refresh 991."); say("  STOP. Nothing was run."); done(2)
say("  ✓ the call reader is the reviewed build")
NODE = shutil.which("node") or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.path.exists(p)), "")
pg = os.environ.get("PGLITE") or os.path.expanduser("~/Claude/Projects/.pglite/node_modules/@electric-sql/pglite/dist/index.js")
if NODE:
    for t, kind in TESTS:
        env = dict(os.environ); env.pop("PGLITE", None)
        if kind == "pglite" and os.path.exists(pg): env["PGLITE"] = pg
        p = subprocess.run([NODE, t], cwd=HUB, capture_output=True, text=True, env=env)
        last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
        if p.returncode != 0: bad(f"{t} failed: {last}"); say("  STOP. Nothing was changed."); done(2)
        say(f"  ✓ {t}: {last.strip()}")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
st, vj = state(HUB_REF, HUB, HUB_BASE, FN, pinned)
if st not in ("base", "this"): bad(f"{FN} on the server is not the build this builds on ({st}); someone may have deployed a newer one. Nothing was changed. Tell Claude."); done(3)
say(f"  ✓ {FN}: " + {"base": "the live reader is the 975 build this builds on", "this": "already this build"}[st])
ok, s0 = sql("""select data->>'call_unread_cards_live' as live, data->>'call_unread_min_seconds' as min_s from public.app_data where key = 'ops_settings'""")
if not ok or not s0: bad("couldn't read the Hub's settings. Nothing was changed."); done(3)
s0 = s0[0]
LIVE = s0["live"] == "true"
say("  · cards for calls nobody could read: " + ("ON (cards are made from the next run)" if LIVE else "OFF, practice (this step does not change that)"))
say(f"  · a call with no transcript counts when it is {s0['min_s'] or 30} seconds or longer")
ok, u0 = sql(UCARDS); u0 = u0[0]["unread_cards"] if ok and u0 else None
K = keys(HUB_REF); ANON, SVC = K.get("anon", ""), K.get("service_role", ""); HIDE += [ANON, SVC]
if not ANON or not SVC: bad("couldn't read the Hub's keys. Nothing was changed."); done(3)

say(); say("PART 2 · CHANGE")
if st != "this" and not deploy(HUB_REF, HUB, FN, vj, "Hub"): say("  STOP. The current reader keeps running. Tell Claude."); done(6)
if st == "this": say(f"  ✓ {FN} already had it")

say(); say("PART 3 · PROOF (nothing is sent)")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
okd, live = live_files(HUB_REF, FN)
chk(okd and all(k in live and live[k] == sha(os.path.join(HUB, k)) for k in need(HUB, FN)), f"{FN}: the live copy is exactly the reviewed build")
URL = f"{FNB}/functions/v1/{JOB}"
a1 = http("POST", URL + "?auth_check=1", {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
chk(a1 == 401, f"the reader refuses the public key ({a1})")
sR, bR = http("POST", URL, {}, {"apikey": SVC, "Authorization": "Bearer " + SVC}, 300)
try: j = json.loads(bR)
except Exception: j = {}
if sR == 200 and j.get("ok") and j.get("off"): say("  · the reader is switched off, so there was nothing to run")
elif sR == 200 and j.get("ok"):
    say(f"  ✓ one reader run ({j.get('unread_cards_mode', '?')}): {j.get('unread_final', 0)} call(s) or text(s) in the last 7 days could not be read; {j.get('unread_skipped', 0)} were hang-ups (no card); it would make {j.get('unread_cards_would', 0)} card(s)"
        + (f"; made {j.get('unread_cards', 0)}, closed {j.get('unread_closed', 0)}" if j.get("unread_cards_mode") == "live" else ""))
    for x in (j.get("unread_would_list") or [])[:20]:
        say(f"      · {x.get('who')}, {str(x.get('at') or '')[:16].replace('T', ' ')} UTC, {x.get('channel')}" + (f", {x.get('seconds')} sec" if x.get('channel') != 'text' else "") + f", for {x.get('owner') or 'nobody (unassigned)'}")
else: bad(f"the reader run didn't answer as expected ({sR}): " + str(j.get("error") or bR)[:160])
ok, hb = sql("""select e->>'ok' as ok from public.app_data a cross join lateral jsonb_array_elements(case when jsonb_typeof(a.data) = 'array' then a.data else '[]'::jsonb end) e
  where a.key = 'automation_heartbeats' and e->>'automation' = 'call-tasks'""")
chk(ok and hb and hb[0]["ok"] == "true", "the reader's heartbeat is OK after the run")
if not LIVE:
    ok, u1 = sql(UCARDS)
    chk(ok and u1 and u0 is not None and u1[0]["unread_cards"] == u0, "practice: no card for an unreadable call was made in My Work")
say()
say("RESULT: " + ("DONE · the call reader can now turn calls nobody could read into My Work cards. The switch is where you left it" + (" (OFF: practice; read the list above, then turn on Owners Hub > Admin > Calls > Calls nobody could read: cards in My Work)." if not LIVE else " (ON).") if not fails else "PARTLY DONE · see the ✗ lines. Tell Claude."))
say("Nothing was texted, emailed or called.")
done(0 if not fails else 8)
