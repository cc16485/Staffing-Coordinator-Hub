#!/usr/bin/env python3
# 444 · PRIVATE APPLICANT LINKS. Samantha approved 2026-10-04 ("yes to all"): https://claude.ai/artifact/MQgrEVdZ8Kr65LBLsha1Aq
# The start-form link and the orientation link carry only a record number and a code the Hub's server makes; never the
# person's name, phone or email. One step for both servers:
#   Hub server: applicant_links.sql (the start form records the link it came through); applicant-link (new: makes
#     links for the office and the Training Platform's job offer, tells a page who a link is for, books orientation
#     under the right person); intake-import redeployed (a start form from a valid private link counts as "we sent
#     them a start link").
#   Training Platform: job-offer redeployed (its start link is the Hub's private one; if it can't be made, nothing is
#     sent and it says why).
# Part 1 (read only): the reviewed builds (pinned, both repos); every live function is exactly GitHub's copy before this
#   change (or already this build); the tests pass here; the secrets are there. Part 2: the changes. Part 3 (proof;
#   nothing is sent, nobody is booked): the live copies are the reviewed builds; the link service refuses an outsider
#   making a link and a made-up link; the start form check still runs. Prints counts only.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil, time
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
HUB_REF = "zngsgedlsxinbygwmxwn"; TR_REF = os.environ.get("SB_TRAINING_REF", "rdqujxiycycwhskyvrwa")
HUB = os.environ["SB_REPO"]; TR = os.environ["SB_TRAINING_REPO"]
HUB_BASE = os.environ.get("SB_BASE", ""); TR_BASE = os.environ.get("SB_TRAINING_BASE", "")
HUB_SHAS = json.loads(os.environ["SB_SHAS"]); TR_SHAS = json.loads(os.environ["SB_TRAINING_SHAS"]); SQL_SHA = os.environ.get("SB_SQL_SHA", "")
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB_REF}.supabase.co"); TFNB = os.environ.get("SB_TRAINING_FN_BASE", f"https://{TR_REF}.supabase.co")
RULES_URL = os.environ.get("SB_HUB_BASE", "https://cc.mo-care.com/") + "intake-import-rules.js"
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
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-444/1.0"}, **(headers or {})))
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
    tmp = tempfile.mkdtemp(prefix="al444-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
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

say("444 · PRIVATE APPLICANT LINKS"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
reviewed(HUB, HUB_BASE, HUB_SHAS, "the Hub server", [("applicant_links.sql", SQL_SHA)])
reviewed(TR, TR_BASE, TR_SHAS, "the Training Platform")
say("  ✓ the Hub server's and the Training Platform's changes are the reviewed builds")
hub_pinned = {pinpath(k) for k in HUB_SHAS}; tr_pinned = {pinpath(k) for k in TR_SHAS}
plan = []
for ref, root, base, fn, pinned, label in ((HUB_REF, HUB, HUB_BASE, "applicant-link", hub_pinned, "Hub"), (HUB_REF, HUB, HUB_BASE, "intake-import", hub_pinned, "Hub"),
                                           (TR_REF, TR, TR_BASE, "job-offer", tr_pinned, "Training")):
    st, vj = state(ref, root, base, fn, pinned)
    if st in ("other", "unreadable"): bad(f"{label} {fn}: the live copy is {'unreadable' if st == 'unreadable' else 'neither GitHub''s copy nor this build'}, so NOTHING was changed. Tell Claude."); done(3)
    if fn != "applicant-link" and st == "new": bad(f"{label} {fn} isn't deployed (unexpected). Nothing was changed."); done(3)
    plan.append((ref, root, fn, vj, label, st))
    say(f"  ✓ {label} {fn}: " + {"new": "is new", "base": "is exactly GitHub's copy before this change", "this": "already has this build"}[st])
s, rb = http("GET", RULES_URL + "?v=" + str(int(time.time())), raw=True)
tmpd = tempfile.mkdtemp(prefix="al444r-"); RULES_LOCAL = os.path.join(tmpd, "intake-import-rules.js")
if s == 200: open(RULES_LOCAL, "wb").write(rb)
NODE = shutil.which("node") or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.path.exists(p)), "")
if NODE:
    for root, t, env in ((HUB, "applicant_links_test.mjs", {}), (HUB, "intake_import_test.mjs", {"CG_INTAKE": RULES_LOCAL}), (TR, "training_texts_test.mjs", {})):
        if t == "intake_import_test.mjs" and s != 200: say("  · couldn't download the start form rules, so intake_import_test.mjs was not re-run here"); continue
        p = subprocess.run([NODE, t], cwd=root, capture_output=True, text=True, env=dict(os.environ, **env))
        last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
        if p.returncode != 0 or re.search(r"^FAIL", p.stdout, re.M): bad(f"{t} failed: {last}"); say("  STOP. Nothing was changed."); done(2)
        say(f"  ✓ {t}: {last.strip()}")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
hs = secrets(HUB_REF)
if not ({"HUB_JOB_SECRET", "OFFERS_PROJECT_URL", "OFFERS_SERVICE_ROLE_KEY"} <= hs): bad("the Hub server is missing a secret it needs (HUB_JOB_SECRET / the job offers connection). Nothing was changed."); done(3)
if "HUB_ANON_KEY" not in secrets(TR_REF): bad("the Training Platform is missing HUB_ANON_KEY (it needs it to ask the Hub). Nothing was changed."); done(3)
say("  ✓ the secrets both servers need are there")
K = keys(HUB_REF); ANON, SERVICE = K.get("anon", ""), K.get("service_role", ""); HIDE += [ANON, SERVICE]
if not ANON or not SERVICE: bad("couldn't read the Hub's keys. Nothing was changed."); done(3)

say(); say("PART 2 · CHANGE")
ok, r = sql("begin;\n" + open(os.path.join(HUB, "applicant_links.sql")).read() + "\ncommit;")
if not ok: bad("the database change didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Tell Claude."); done(6)
say("  ✓ the start form can record the private link it came through")
for ref, root, fn, vj, label, st in plan:
    if st == "this": say(f"  ✓ {label} {fn} already had it"); continue
    if not deploy(ref, root, fn, vj, label): say("  STOP. Tell Claude."); done(6)

say(); say("PART 3 · PROOF (nothing is sent; nobody is booked)")
for ref, root, fn, vj, label, st in plan:
    okd, live = live_files(ref, fn)
    chk(okd and all(k in live and live[k] == sha(os.path.join(root, k)) for k in need(root, fn)), f"{label} {fn}: the live copy is exactly the reviewed build")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
A = {"apikey": ANON, "Authorization": "Bearer " + ANON}
URL = f"{FNB}/functions/v1/applicant-link"
m1 = http("POST", URL, {"action": "mint", "kind": "start", "offer_id": "00000000-0000-0000-0000-000000000000"}, A)[0]
o1 = http("POST", URL, {"action": "open", "kind": "start", "o": "00000000-0000-0000-0000-000000000000", "e": 1999999999, "t": "A" * 43}, A)[0]
b1 = http("POST", URL, {"action": "book", "session_id": "0", "c": "1", "e": 1999999999, "t": "A" * 43}, A)[0]
chk(m1 == 401 and o1 == 401 and b1 in (401, 404), f"the link service refuses someone not signed in making a link ({m1}), a made-up start link ({o1}) and a made-up orientation booking ({b1})")
c1 = http("OPTIONS", URL, None, {"Origin": "https://cc.mo-care.com", "Access-Control-Request-Method": "POST"})[0]
chk(c1 == 200, f"the public pages can reach it ({c1})")
j1 = http("POST", f"{TFNB}/functions/v1/job-offer", {"action": "send_start_link", "offer_id": "00000000-0000-0000-0000-000000000000"}, {})[0]
chk(j1 in (401, 403), f"the Training Platform's job offer still refuses anyone without a Hub sign-in ({j1})")
sD, bD = http("POST", f"{FNB}/functions/v1/intake-import?dry=1", {}, {"apikey": SERVICE, "Authorization": "Bearer " + SERVICE}, 300)
try: j = json.loads(bD)
except Exception: j = {}
chk(sD == 200 and j.get("ok") is True, "the start form check still runs (a counts-only look)" + ("" if sD == 200 and j.get("ok") else f" ({sD}: {str(j.get('error') or bD)[:160]})"))
shutil.rmtree(tmpd, ignore_errors=True)
say()
say("RESULT: " + ("DONE · new start and orientation links carry no personal details. Old links keep working until Nov 3." if not fails else "PARTLY DONE · the ✗ lines above need Claude."))
say("Nothing was texted or emailed, nobody was booked, and no applicant or candidate record was changed.")
say("Rollback: Claude redeploys the three functions from GitHub's earlier copies; old links keep working until Nov 3 either way.")
done(0 if not fails else 8)
