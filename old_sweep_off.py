#!/usr/bin/env python3
# OLD NOTE WATCHER OFF (Desktop 340). coverage-watch carried a note sweep that guessed at a rated notes field AxisCare
# doesn't have (it never matched). N2 (care-notes) replaced it. This switches the old sweep off.
# Because coverage-watch runs call-off detection every few minutes, it is only redeployed if the version running live
# is EXACTLY the version on GitHub before this change (so the redeploy changes nothing but the sweep).
# Part 1 (read only): the change is the reviewed build; the live coverage-watch is downloaded into a temporary folder
#   and compared file by file with GitHub's version before the change. Any difference: STOP, nothing changed, and the
#   live copy is kept at ~/Claude/coverage-watch-live-copy for Claude to look at.
# Part 2: redeploy coverage-watch (gateway setting kept).
# Part 3: newer version; a practice call (?dry=1, reads only) says the old note sweep is off.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, time, tempfile, shutil
REPORT = os.environ["SB_REPORT"]; FNROOT = os.environ["SB_FNROOT"]
NEW_SHA = os.environ["SB_NEW_SHA"]; BASE = json.loads(os.environ["SB_BASE_SHAS"])   # {relative path: sha} of GitHub before the change
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
KEEP = os.environ.get("SB_KEEP_DIR", os.path.expanduser("~/Claude/coverage-watch-live-copy"))
FN = "coverage-watch"
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for v in HIDE: s = s.replace(v, "(hidden)")
    s = re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", s); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def http(method, url, body=None, headers=None, timeout=150):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers=dict({"Content-Type": "application/json", "User-Agent": "cc-sweepoff/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def meta():
    s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{FN}", headers=MG())
    try: m = json.loads(b) if s == 200 else None
    except Exception: m = None
    return m if isinstance(m, dict) and isinstance(m.get("verify_jwt"), bool) else None
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()

say("OLD NOTE WATCHER OFF"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY")
if sha(os.path.join(FNROOT, FN, "index.ts")) != NEW_SHA: bad("the change is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
before = meta()
if not before: bad("could not read coverage-watch. Nothing was changed."); done(4)
say(f"  ✓ the change is the reviewed build · coverage-watch is running version {before.get('version')}")
tmp = tempfile.mkdtemp(prefix="cw-live-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
p = subprocess.run([SUPA, "functions", "download", FN, "--project-ref", REF, "--use-api"], cwd=tmp,
                   env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
if p.returncode != 0: bad("could not download the live version: " + (p.stderr or p.stdout)[-200:]); say("  Nothing was changed."); done(4)
live = {}
for root, _, files in os.walk(tmp):
    for f in files:
        if f.endswith(".ts"): live[os.path.relpath(os.path.join(root, f), tmp)] = os.path.join(root, f)
def find_live(rel):   # match by the last two path parts (e.g. coverage-watch/index.ts, _shared/outreach.ts)
    tail = "/".join(rel.split("/")[-2:])
    hits = [v for k, v in live.items() if k.replace(os.sep, "/").endswith(tail)]
    return hits[0] if len(hits) == 1 else None
diff, missing = [], []
for rel, want in BASE.items():
    lp = find_live(rel)
    if not lp: missing.append(rel); continue
    if sha(lp) != want: diff.append(rel)
say(f"  · the live version has {len(live)} source file(s); compared {len(BASE) - len(missing)} with GitHub")
if diff or missing:
    shutil.rmtree(KEEP, ignore_errors=True); shutil.copytree(tmp, KEEP)
    bad("the live coverage-watch is NOT the version on GitHub: " + (("different: " + ", ".join(diff)) if diff else "") + ((" · not found live: " + ", ".join(missing)) if missing else ""))
    say(f"  STOP. Nothing was changed. The live copy is kept at {KEEP} for Claude to compare.")
    shutil.rmtree(tmp, ignore_errors=True); done(5)
shutil.rmtree(tmp, ignore_errors=True)
say("  ✓ the live coverage-watch is exactly the version on GitHub, so this redeploy changes nothing but the note sweep")

say(); say("PART 2 · CHANGE")
p = subprocess.run([SUPA, "functions", "deploy", FN, "--project-ref", REF, "--use-api"] + ([] if before["verify_jwt"] else ["--no-verify-jwt"]),
                   cwd=os.path.dirname(os.path.dirname(FNROOT)), env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
if p.returncode != 0: bad("deploy failed: " + (p.stderr or p.stdout)[-240:]); say("  The old version is still running."); done(6)
say("  ✓ coverage-watch redeployed")

say(); say("PART 3 · CHECK (a practice call; reads only)")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
m = meta() or {}
kept = m.get("verify_jwt") == before["verify_jwt"]; newer = isinstance(m.get("version"), int) and m["version"] > (before.get("version") or 0)
(say if kept and newer else bad)(("  ✓ " if kept and newer else "") + f"gateway setting kept: {'yes' if kept else 'NO'} · now running version {m.get('version')}")
s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers=MG())
try: anon = {k.get("name"): k.get("api_key", "") for k in json.loads(b)}.get("anon", "")
except Exception: anon = ""
if anon: HIDE.append(anon)
s, b = http("POST", f"{FNB}/functions/v1/{FN}?dry=1", {}, {"apikey": anon, "Authorization": "Bearer " + anon} if anon else {})
try: j = json.loads(b)
except Exception: j = None
off = isinstance(j, dict) and str(j.get("notes_sweep", "")).startswith("off")
(say if off else bad)(("  ✓ " if off else "") + ("the practice call answers normally and says the old note sweep is off" if off else f"the practice call did not confirm it ({s})"))
say()
say("RESULT: " + ("DONE · the old note watcher is off; call-off detection runs exactly as before." if not fails else "CHECK THE ✗ LINES."))
say("Rollback if ever needed: set the LEGACY_NOTE_SWEEP secret to 'on', or redeploy coverage-watch from the commit before this one.")
done(0 if not fails else 7)
