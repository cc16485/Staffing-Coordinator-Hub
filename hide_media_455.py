#!/usr/bin/env python3
# 455 · HIDE A PHOTO OR VIDEO FROM A CAREGIVER'S PROFILE. Samantha, 2026-10-05: "i want to be able to choose to hide a photo
# or video from a caregivers profile. for example, we dont like Grace's video and want to hide it on her profile".
#   SQL: photo_hidden and video_hidden on caregiver_profiles (false for everyone; the office sets them in the Hub).
#   caregiver-card: a hidden photo or video is left off the family card (the file is kept).
#   caregiver-profile: a hidden video does not hold up publishing a current caregiver; a NEW photo or video they send is
#     shown again (the office can hide it again).
# NOTHING IS SENT and no profile changes: both fields start false for everyone; the office hides from the Hub afterwards.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil, time
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
HUB_REF = "zngsgedlsxinbygwmxwn"
HUB = os.environ["SB_REPO"]; HUB_BASE = os.environ.get("SB_BASE", "")
HUB_SHAS = json.loads(os.environ["SB_SHAS"])
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB_REF}.supabase.co")
FNS = ["caregiver-profile", "caregiver-card"]
SQLFILE = "caregiver_profile_hide_455.sql"
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
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-455/1.0"}, **(headers or {})))
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
    tmp = tempfile.mkdtemp(prefix="hm455-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
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
def history_shas(root, rel):
    """every version of one file ever committed: {sha: short commit}"""
    out = {}
    for c in git(root, "log", "--format=%h", "--", rel).stdout.decode().split():
        b = git(root, "show", f"{c}:{rel}")
        if b.returncode == 0: out.setdefault(shab(b.stdout), c)
    return out
OLDER = {}
# 452b (2026-10-05): she looked at the live profile-polish. It was an unsaved earlier draft of the instructions for the
# unused "ask a question" mode; nothing worth keeping. SB_LIVE_OK = {fn: fingerprint (sha256 prefix)} accepts exactly
# that copy; any other unknown copy still stops everything.
LIVE_OK = json.loads(os.environ.get("SB_LIVE_OK") or "{}")
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
    # 452 (first run stopped here): live can be an OLDER committed version that was never redeployed. That is still a
    # known build, so it may be replaced; a version that was never committed (a hand edit) still stops everything.
    hits = [history_shas(root, k).get(live.get(k, "")) for k in nd]
    if all(hits): OLDER[fn] = ", ".join(sorted(set(hits))); return "older", vj
    want = str(LIVE_OK.get(fn, ""))
    if len(want) >= 12 and all(live.get(k, "").startswith(want) if k.endswith(f"/{fn}/index.ts") else live.get(k) == base_sha(root, base, k) for k in nd): return "seen", vj
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


say("455 · HIDE A PHOTO OR VIDEO FROM A CAREGIVER'S PROFILE"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
reviewed(HUB, HUB_BASE, HUB_SHAS, "the Hub server", extra=[(SQLFILE, os.environ.get("SB_SQL_SHA", ""))])
pinned = {pinpath(k) for k in HUB_SHAS}
for fn in FNS:
    other = sorted(k for k in need(HUB, fn) if k not in pinned and base_sha(HUB, HUB_BASE, k) != sha(os.path.join(HUB, k)))
    if other: bad(f"other changes merged since the review touch {fn} ({', '.join(other)[:200]}). Ask Claude to refresh 455."); say("  STOP. Nothing was run."); done(2)
say("  ✓ the family card, the profile helper and the two new fields are the reviewed build")
ST = {}
for fn in FNS:
    st, vj = state(HUB_REF, HUB, HUB_BASE, fn, pinned); ST[fn] = (st, vj)
    if st not in ("base", "this", "older"): bad(f"the live {fn} isn't what this was built on ({st}). Nothing was changed. Tell Claude."); done(3)
    say(f"  ✓ {fn}: " + {"base": "live matches GitHub", "this": "already has this build (an earlier run)", "older": f"live is an older GitHub version (commit {OLDER.get(fn)}); this replaces it"}[st] + f" (gateway sign-in check {'on' if vj else 'off'})")
NODE = shutil.which("node") or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.path.exists(p)), "")
if NODE:
    for t in ("hide_455_test.mjs", "profile_catchup_452_test.mjs", "caregiver_profile_test.mjs", "caregiver_profile_2b_test.mjs"):
        p = subprocess.run([NODE, t], cwd=HUB, capture_output=True, text=True)
        last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
        if p.returncode != 0 or re.search(r"^FAIL", p.stdout, re.M): bad(f"{t} failed: {last}"); say("  STOP. Nothing was changed."); done(2)
        say(f"  ✓ {t}: {last.strip()} (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
ok, cnt = sql("select count(*)::int as n, count(*) filter (where published)::int as pub from public.caregiver_profiles")
if not ok or not cnt: bad("couldn't read the caregiver profiles. Nothing was changed."); done(3)
say(f"  · caregiver profiles now: {cnt[0]['n']} ({cnt[0]['pub']} published). This step changes none of them.")
K = keys(HUB_REF); ANON = K.get("anon", ""); HIDE += [ANON, K.get("service_role", "")]
if not ANON: bad("couldn't read the Hub's public key. Nothing was changed."); done(3)

say(); say("PART 2 · CHANGE")
ok, r = sql(open(os.path.join(HUB, SQLFILE)).read())
ok2, col = sql("select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'caregiver_profiles' and column_name in ('photo_hidden', 'video_hidden') and data_type = 'boolean' and is_nullable = 'NO'")
chk(ok and ok2 and col and col[0]["n"] == 2, "the two new fields are there (photo hidden, video hidden; false for everyone)" + ("" if ok else f" ({str(r)[:160]})"))
if fails: say("  STOP. Nothing else was changed. Tell Claude."); done(5)
for fn in FNS:
    st, vj = ST[fn]
    if st == "this": say(f"  ✓ {fn} already had it"); continue
    if not deploy(HUB_REF, HUB, fn, vj, "Hub"): say("  STOP. Tell Claude. (Anything above this line is in; the rest is unchanged.)"); done(6)

say(); say("PART 3 · PROOF (nothing is sent, nothing is saved)")
for fn in FNS:
    okd, live = live_files(HUB_REF, fn)
    chk(okd and all(k in live and live[k] == sha(os.path.join(HUB, k)) for k in need(HUB, fn)), f"{fn}: the live copy is exactly the reviewed build")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
A = {"Authorization": "Bearer " + ANON, "apikey": ANON, "Content-Type": "application/json"}
s, b = http("GET", f"{FNB}/functions/v1/caregiver-card?id=00000000-0000-4000-8000-000000000000", None, A)
chk(s == 404, f"a family card that matches nobody: still \"not found\" ({s})")
s, b = http("POST", f"{FNB}/functions/v1/caregiver-profile", {"action": "mine", "t": "00000000-0000-4000-8000-000000000000"}, A)
chk(s == 404, f"a caregiver's page with a link that matches nobody: still \"we could not find your profile\" ({s})")
ok, c2 = sql("select count(*)::int as n, count(*) filter (where photo_hidden or video_hidden)::int as hidden from public.caregiver_profiles")
chk(ok and c2 and c2[0]["hidden"] == 0 and c2[0]["n"] == cnt[0]["n"], f"nothing is hidden yet and no profile changed ({c2[0]['n'] if ok and c2 else '?'} profiles, as before)")
say()
say("RESULT: " + ("DONE · the server side is in. Next: Claude merges the Hub. Then open Grace's profile in the Hub and press Hide from families under her video." if not fails else "PARTLY DONE · the ✗ lines above need Claude."))
say("Nothing was texted or emailed by this step.")
say("Rollback: Claude can put both helpers back as they were; the two fields are harmless left in place.")
done(0 if not fails else 8)
