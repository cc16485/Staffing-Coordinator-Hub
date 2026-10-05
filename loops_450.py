#!/usr/bin/env python3
# 450 · TODAY PHASE 2: THE HUB CLOSES ITS OWN LOOPS. Samantha approved the plan 2026-10-05
# (https://claude.ai/artifact/DbCMKyppvK2mRVPnZr9TWN) and said "start phase 2".
#   coverage-watch: a finished shift's case closes from AxisCare or asks "Was it covered?"; case cards close with the
#     case; not covered asks a person to call the family; nightly EVV totals; one weekly Caregiver EVV Review instead
#     of nightly EVV cards; call-in / tardy cards keep a person's handling.
#   timekeeper-watch: a missed clock-in whose shift is over becomes one "EVV fix needed" item; the admin texts stop.
#   coverage-run: never texts caregivers about a shift that is already over.
#   _shared/loops.ts: the shared rules. Everything except the last two lines of PART 2 waits for her switch
#   (ops_settings.loops_close_live, Owners Hub Admin page). Nothing in Phase 2 sends a message.
# Part 1 (read only): the reviewed build (pinned); the live jobs are the GitHub version this was built on; the tests
#   pass here. Part 2: deploy the three jobs (their gateway setting kept). Part 3: the live copies are the reviewed
#   build; they answer their owner and refuse others; one practice run of each (dry: nothing written or sent) prints
#   counts only.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil, time
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
HUB_REF = "zngsgedlsxinbygwmxwn"
HUB = os.environ["SB_REPO"]; HUB_BASE = os.environ.get("SB_BASE", "")
HUB_SHAS = json.loads(os.environ["SB_SHAS"])
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB_REF}.supabase.co")
FNS = ["coverage-watch", "timekeeper-watch", "coverage-run"]
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
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-450/1.0"}, **(headers or {})))
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
    tmp = tempfile.mkdtemp(prefix="lp450-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
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

def jget(b, k):
    try: return json.loads(b).get(k)
    except Exception: return None

say("450 · TODAY PHASE 2: THE HUB CLOSES ITS OWN LOOPS"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
reviewed(HUB, HUB_BASE, HUB_SHAS, "the Hub server")
pinned = {pinpath(k) for k in HUB_SHAS}
for fn in FNS:
    other = sorted(k for k in need(HUB, fn) if k not in pinned and base_sha(HUB, HUB_BASE, k) != sha(os.path.join(HUB, k)))
    if other: bad(f"other changes merged since the review touch {fn} ({', '.join(other)[:200]}). Ask Claude to refresh 450."); say("  STOP. Nothing was run."); done(2)
say("  ✓ the three jobs and the new loop rules are the reviewed build")
ST = {}
for fn in FNS:
    st, vj = state(HUB_REF, HUB, HUB_BASE, fn, pinned); ST[fn] = (st, vj)
    if st not in ("base", "this"): bad(f"the live {fn} isn't the GitHub version this was built on ({st}). Nothing was changed. Tell Claude."); done(3)
    say(f"  ✓ {fn}: " + ("live matches GitHub" if st == "base" else "already has this build (an earlier run)") + f" (gateway sign-in check {'on' if vj else 'off'})")
NODE = shutil.which("node") or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.path.exists(p)), "")
if NODE:
    for t in ("loops_phase2_test.mjs", "c1_missed_clockin_test.mjs", "j1_job_locks_test.mjs", "j2_job_locks_test.mjs"):
        p = subprocess.run([NODE, t], cwd=HUB, capture_output=True, text=True)
        last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
        if p.returncode != 0 or re.search(r"^FAIL", p.stdout, re.M): bad(f"{t} failed: {last}"); say("  STOP. Nothing was changed."); done(2)
        say(f"  ✓ {t}: {last.strip()} (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
ok, sv = sql("select coalesce((select data->>'loops_close_live' from app_data where key = 'ops_settings'), 'not set') as live")
if not ok or not sv: bad("couldn't read the settings. Nothing was changed."); done(3)
say(f"  · the switch \"The Hub closes its own loops\" is {('ON' if sv[0]['live'] == 'true' else 'OFF')} (it stays as it is; you turn it on on the Admin page)")
K = keys(HUB_REF); SERVICE = K.get("service_role", ""); HIDE += [SERVICE, K.get("anon", "")]
if not SERVICE: bad("couldn't read the Hub's server key (needed for the practice run). Nothing was changed."); done(3)

say(); say("PART 2 · CHANGE")
for fn in FNS:
    st, vj = ST[fn]
    if st == "this": say(f"  ✓ {fn} already had it"); continue
    if not deploy(HUB_REF, HUB, fn, vj, "Hub"): say("  STOP. Tell Claude. (Anything above this line is in; the rest is unchanged.)"); done(6)
say("  ✓ with the switch off they behave as before, except: no open-shift texts are ever sent for a shift that is already over, and each night's EVV totals are counted for the weekly review")

say(); say("PART 3 · PROOF AND PRACTICE RUN (practice mode: nothing is written, nothing is sent)")
for fn in FNS:
    okd, live = live_files(HUB_REF, fn)
    chk(okd and all(k in live and live[k] == sha(os.path.join(HUB, k)) for k in need(HUB, fn)), f"{fn}: the live copy is exactly the reviewed build")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
S = {"Authorization": "Bearer " + SERVICE, "Content-Type": "application/json"}
for fn in FNS:
    s, b = http("POST", f"{FNB}/functions/v1/{fn}?auth_check=1", {}, S)
    chk(s == 200 and jget(b, "caller") == "owner", f"{fn}: answers its owner (a who-is-calling check only){'' if s == 200 else f' ({s})'}")
    s2, _ = http("POST", f"{FNB}/functions/v1/{fn}?auth_check=1", {}, {"Content-Type": "application/json"})
    chk(s2 == 401, f"{fn}: still refuses anyone else ({s2})")
s, b = http("POST", f"{FNB}/functions/v1/coverage-watch?dry=1&evv_review=1", {}, S, timeout=280)
try: cw = json.loads(b) if s == 200 else {}
except Exception: cw = {}
lp = cw.get("loops") or {}
if s != 200 or not isinstance(lp, dict) or "cases_closed" not in lp: bad(f"the coverage practice run didn't answer ({s})")
else:
    say(f"  ✓ coverage practice run (nothing written):")
    say(f"      finished shifts AxisCare can settle, would close: {len(lp.get('cases_closed') or [])}")
    say(f"      finished shifts a person would be asked about (\"Was it covered?\"): {len(lp.get('asked') or [])}")
    say(f"      case cards that would close with their case: {lp.get('items_closed', 0)}")
    say(f"      \"call the family\" cards that would open: {len(lp.get('family_calls') or [])} (only for shifts closed as not covered after you switch it on)")
    if lp.get("errors"): say(f"      note: {len(lp['errors'])} part(s) couldn't be checked this time: " + "; ".join(str(x)[:80] for x in lp["errors"][:2]))
    ev = cw.get("evv_review") or {}
    if isinstance(ev, dict) and "below" in ev:
        say(f"      weekly Caregiver EVV Review: {len(ev.get('below') or [])} caregiver(s) under 90% last week, from {ev.get('days_with_data', 0)} day(s) of totals so far (the totals start tonight)")
s, b = http("POST", f"{FNB}/functions/v1/timekeeper-watch?dry=1", {}, S, timeout=280)
try: tk = json.loads(b) if s == 200 else {}
except Exception: tk = {}
fx = (tk.get("evv_fix") or {}).get("became_evv_fix")
if s != 200 or fx is None: bad(f"the missed clock-in practice run didn't answer ({s})")
else: say(f"  ✓ missed clock-in practice run (nothing written, nothing sent): {len(fx)} open alert(s) whose shift is over would become \"EVV fix needed\" items")
ok, sv2 = sql("select coalesce((select data->>'loops_close_live' from app_data where key = 'ops_settings'), 'not set') as live")
chk(ok and sv2 and sv2[0]["live"] == sv[0]["live"], "the switch was not touched")
say()
say("RESULT: " + ("DONE · the server side of Phase 2 is installed, switched off. Next: Claude merges the Hub and Admin page changes, then you turn on \"The Hub closes its own loops\" on the Owners Hub Admin page." if not fails else "PARTLY DONE · the ✗ lines above need Claude."))
say("Nothing was texted or emailed. Practice runs print counts only: no names.")
say("Rollback: turn the switch off (Admin page). Claude can put the three jobs back to the previous version.")
done(0 if not fails else 8)
