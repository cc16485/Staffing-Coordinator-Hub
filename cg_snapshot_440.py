#!/usr/bin/env python3
# 440 · THE HIRE SNAPSHOT ON A CAREGIVER MOVED OVER BY CAREGIVER CONNECT. Samantha 2026-10-04: "fix the hire snapshot".
# The Move to caregiver button now saves a real hire snapshot (why they were allowed to be hired; it was empty on every
# hire). The hourly caregiver connect check builds the same record when it moves someone over, so it now saves the same
# snapshot, from the same approved eligibility-rules.js the Hub runs.
# Part 1 (read only): the reviewed build (pinned); the live caregiver-connect is exactly 438's build (or already this
#   one); both rules files on cc.mo-care.com are approved; the tests pass here with the live rules files.
# Part 2: caregiver-connect redeployed (gateway setting kept). Part 3 (proof; nothing recorded, nobody connected): the
#   live copy is the reviewed build; a counts-only look (?dry=1) loads both rules and reads AxisCare. Counts only.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil, time
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); REF = "zngsgedlsxinbygwmxwn"
ROOT = os.environ["SB_REPO"]; BASE = os.environ.get("SB_BASE", ""); SHAS = json.loads(os.environ["SB_SHAS"])
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co"); HUB = os.environ.get("SB_HUB_BASE", "https://cc.mo-care.com/")
FN = "caregiver-connect"; FILES = ["caregiver-connect-rules.js", "eligibility-rules.js"]
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
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-440/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            b = r.read(); return r.status, (b if raw else b.decode(errors="replace"))
    except urllib.error.HTTPError as e: return e.code, (b"" if raw else e.read().decode(errors="replace"))
    except Exception as e: return None, (b"" if raw else type(e).__name__)
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, f"HTTP {s}: {b[:300]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:200]
def lit(v): return "'" + str(v).replace("'", "''") + "'"
def fmeta(fn):
    s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{fn}", headers=MG())
    try: return s, (json.loads(b) if s == 200 else None)
    except Exception: return s, None
def keys():
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
pinpath = lambda k: f"supabase/functions/{k}.ts" if k.startswith("_shared/") else f"supabase/functions/{k}/index.ts"
def deps(path, seen):
    if path in seen or not os.path.exists(path): return
    seen.add(path)
    for m in re.findall(r"""from\s+['"](\.{1,2}/[^'"]+)['"]|import\s+['"](\.{1,2}/[^'"]+)['"]""", open(path).read()):
        deps(os.path.normpath(os.path.join(os.path.dirname(path), m[0] or m[1])), seen)
def need():
    s = set(); deps(os.path.join(ROOT, f"supabase/functions/{FN}/index.ts"), s)
    return {os.path.relpath(x, ROOT).replace(os.sep, "/") for x in s}
def live_files():
    tmp = tempfile.mkdtemp(prefix="cg440-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
    d = subprocess.run([SUPA, "functions", "download", FN, "--project-ref", REF, "--use-api"], cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
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

say("440 · THE HIRE SNAPSHOT (caregiver connect)"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
if not BASE or git("cat-file", "-e", BASE + "^{commit}").returncode != 0: bad("the reviewed starting point isn't in this folder's history"); say("  STOP. Nothing was run."); done(2)
changed = set(git("diff", "--name-only", BASE, "HEAD").stdout.decode().split())
pinned = {pinpath(k): v for k, v in SHAS.items()}
for rel, want in pinned.items():
    if rel not in changed or sha(os.path.join(ROOT, rel)) != want: bad(f"{rel.split('functions/')[-1]} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
other = sorted(k for k in need() if k not in pinned and k in changed)
if other: bad(f"other changes merged since the review touch this job ({', '.join(other)[:200]}). Ask Claude to refresh 440."); say("  STOP. Nothing was run."); done(2)
say("  ✓ the job and its shared piece are the reviewed build")
sF, mF = fmeta(FN); vj = (mF or {}).get("verify_jwt")
if sF != 200 or not isinstance(vj, bool): bad("caregiver-connect isn't there or its gateway setting can't be read (438 first). Nothing was changed."); done(3)
okd, live = live_files()
if not okd: bad("couldn't read the live caregiver-connect. Nothing was changed."); done(3)
nd = need()
already = all(k in live and live[k] == sha(os.path.join(ROOT, k)) for k in nd)
is438 = all(k in live and live[k] == base_sha(k) for k in nd)
if not already and not is438:
    off = sorted(k.split("functions/", 1)[1] for k in nd if live.get(k) not in (base_sha(k), sha(os.path.join(ROOT, k))))
    bad(f"the live caregiver-connect is neither 438's build nor this one ({', '.join(off)[:160]}), so it was NOT changed. Tell Claude."); done(3)
say("  ✓ the live caregiver-connect is " + ("already this build" if already else "exactly 438's build"))
tmpd = tempfile.mkdtemp(prefix="cg440r-"); local = {}
for f in FILES:
    s, rb = http("GET", HUB + f + "?v=" + str(int(time.time())), headers={"Accept": "application/javascript"}, raw=True)
    if s != 200: bad(f"couldn't download {f} from cc.mo-care.com ({s}). Nothing was changed."); done(3)
    fp = shab(rb); local[f] = os.path.join(tmpd, f); open(local[f], "wb").write(rb)
    ok, ap = sql(f"select count(*)::int as n from public.rules_approved where file = {lit(f)} and sha256 = {lit(fp)}")
    if not ok or not ap or ap[0]["n"] != 1: bad(f"{f} on cc.mo-care.com ({fp[:12]}) is not an approved version, so the job could not run it. Nothing was changed. Tell Claude."); done(3)
    say(f"  ✓ {f} on cc.mo-care.com is an approved version ({fp[:12]})")
NODE = shutil.which("node") or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.path.exists(p)), "")
if NODE:
    p = subprocess.run([NODE, "cg_connect_test.mjs"], cwd=ROOT, capture_output=True, text=True, env=dict(os.environ, CG_RULES=local[FILES[0]], CG_ELIG=local[FILES[1]]))
    last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
    if p.returncode != 0 or re.search(r"^FAIL", p.stdout, re.M): bad(f"cg_connect_test.mjs failed: {last}"); say("  STOP. Nothing was changed."); done(2)
    say(f"  ✓ cg_connect_test.mjs: {last.strip()} (with the live rules files)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
K = keys(); ANON, SERVICE = K.get("anon", ""), K.get("service_role", ""); HIDE += [ANON, SERVICE]
if not ANON or not SERVICE: bad("couldn't read the project's keys. Nothing was changed."); done(3)

say(); say("PART 2 · CHANGE")
if already: say("  ✓ caregiver-connect already had it")
else:
    p = subprocess.run([SUPA, "functions", "deploy", FN, "--project-ref", REF, "--use-api"] + ([] if vj else ["--no-verify-jwt"]), cwd=ROOT, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    okd, live = live_files()
    good = okd and all(k in live and live[k] == sha(os.path.join(ROOT, k)) for k in nd)
    if not good: bad("caregiver-connect didn't deploy: " + (p.stderr or p.stdout)[-200:]); say("  STOP. Tell Claude."); done(6)
    sN, mN = fmeta(FN)
    if (mN or {}).get("verify_jwt") != vj:
        http("PATCH", f"{API}/v1/projects/{REF}/functions/{FN}", {"verify_jwt": vj}, MG()); sN, mN = fmeta(FN)
    chk((mN or {}).get("verify_jwt") == vj, f"caregiver-connect deployed, now version {(mN or {}).get('version', '?')} (was {(mF or {}).get('version', '?')}; gateway sign-in check kept {'on' if vj else 'off'})")

say(); say("PART 3 · PROOF (nothing recorded; nobody connected)")
okd, live = live_files()
chk(okd and all(k in live and live[k] == sha(os.path.join(ROOT, k)) for k in nd), "caregiver-connect: the live copy is exactly the reviewed build")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
URL = f"{FNB}/functions/v1/{FN}"
a1 = http("POST", URL + "?auth_check=1", {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
chk(a1 == 401, f"it still refuses the public key ({a1})")
sD, bD = http("POST", URL + "?dry=1", {}, {"apikey": SERVICE, "Authorization": "Bearer " + SERVICE}, 300)
try: j = json.loads(bD)
except Exception: j = {}
if sD == 200 and j.get("ok") is True and j.get("dry") is True:
    say(f"  ✓ a counts-only look loads both rules files and reads AxisCare: {j.get('census_active')} active; right now it would connect {j.get('linked')}, move {j.get('moved')}, start {j.get('created')}; {j.get('review')} need a look")
else: bad(f"the counts-only look didn't answer as expected ({sD}): " + str(j.get("error") or bD)[:200])
shutil.rmtree(tmpd, ignore_errors=True)
say()
say("RESULT: " + ("DONE · from the next hourly check, a caregiver moved over by caregiver connect carries the hire snapshot, the same as the Move to caregiver button." if not fails else "PARTLY DONE · the ✗ lines above need Claude."))
say("Nothing was texted or emailed, nothing was written to AxisCare, and no caregiver or candidate record was changed.")
say("Rollback: Claude redeploys caregiver-connect from 438's build.")
done(0 if not fails else 8)
