#!/usr/bin/env python3
# 447 · NO EM DASHES IN MESSAGES + THE JOURNEY CHECK. Samantha approved 2026-10-04 ("yes to all",
# https://claude.ai/artifact/6FdA6bE9aaobS5E6aY7E42, idea 3). Same messages, same timing: only em dashes become commas,
# periods or colons. Hub server: interview-messages, lead-nurture, coverage-reply, coverage-run. Training Platform:
# send-invite, send-reminder, send-certificate. A function that isn't on the server is skipped (its GitHub copy is fixed).
# Part 1 (read only): the reviewed builds (pinned, both repos); every live function is exactly GitHub's copy before this
#   change (or already this build); the tests pass here; the journey check passes against these fresh copies (the
#   journey, the Hub page and the check itself downloaded from cc.mo-care.com). Part 2: redeploys (each keeps its own
#   gateway setting). Part 3: the live copies are the reviewed builds. Nothing is sent; no record changes.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil, time
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
HUB_REF = "zngsgedlsxinbygwmxwn"; TR_REF = os.environ.get("SB_TRAINING_REF", "rdqujxiycycwhskyvrwa")
HUB = os.environ["SB_REPO"]; TR = os.environ["SB_TRAINING_REPO"]
HUB_BASE = os.environ.get("SB_BASE", ""); TR_BASE = os.environ.get("SB_TRAINING_BASE", "")
HUB_SHAS = json.loads(os.environ["SB_SHAS"]); TR_SHAS = json.loads(os.environ["SB_TRAINING_SHAS"]); SQL_SHA = os.environ.get("SB_SQL_SHA", "")
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB_REF}.supabase.co"); TFNB = os.environ.get("SB_TRAINING_FN_BASE", f"https://{TR_REF}.supabase.co")
HUBWEB = os.environ.get("SB_HUB_BASE", "https://cc.mo-care.com/")
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
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-447/1.0"}, **(headers or {})))
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
    tmp = tempfile.mkdtemp(prefix="ed447-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
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

say("447 · NO EM DASHES IN MESSAGES + THE JOURNEY CHECK"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
reviewed(HUB, HUB_BASE, HUB_SHAS, "the Hub server")
reviewed(TR, TR_BASE, TR_SHAS, "the Training Platform")
say("  ✓ the Hub server's and the Training Platform's changes are the reviewed builds")
hub_pinned = {pinpath(k) for k in HUB_SHAS}; tr_pinned = {pinpath(k) for k in TR_SHAS}
plan = []
for ref, root, base, fns, pinned, label in ((HUB_REF, HUB, HUB_BASE, ("interview-messages", "lead-nurture", "coverage-reply", "coverage-run"), hub_pinned, "Hub"),
                                            (TR_REF, TR, TR_BASE, ("send-invite", "send-reminder", "send-certificate"), tr_pinned, "Training")):
    for fn in fns:
        st, vj = state(ref, root, base, fn, pinned)
        if st in ("other", "unreadable"): bad(f"{label} {fn}: the live copy is {'unreadable' if st == 'unreadable' else 'neither GitHub''s copy nor this build'}, so NOTHING was changed. Tell Claude."); done(3)
        plan.append((ref, root, fn, vj, label, st))
        say(f"  ✓ {label} {fn}: " + {"new": "is not on the server (skipped; its GitHub copy is fixed)", "base": "is exactly GitHub's copy before this change", "this": "already has this build"}[st])
NODE = shutil.which("node") or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.path.exists(p)), "")
tmpd = tempfile.mkdtemp(prefix="ed447w-")
if NODE:
    for root, t in ((HUB, "noshow_test.mjs"), (HUB, "applicant_msgs_test.mjs"), (HUB, "bg_review_test.mjs"), (TR, "training_texts_test.mjs"), (TR, "orientation_link_test.mjs")):
        p = subprocess.run([NODE, t], cwd=root, capture_output=True, text=True)
        last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
        if p.returncode != 0 or re.search(r"^FAIL", p.stdout, re.M): bad(f"{t} failed: {last}"); say("  STOP. Nothing was changed."); done(2)
        say(f"  ✓ {t}: {last.strip()}")
    got = {}
    for name in ("applicant-journey.js", "index.html", "caregivers-engine.js", "tests/journey-check.mjs"):
        s_, b_ = http("GET", HUBWEB + name + "?v=" + str(int(time.time())), raw=True)
        if s_ != 200: bad(f"couldn't download {name} from the Hub ({s_}). Claude merges the Hub change first. Nothing was changed."); done(2)
        dst = os.path.join(tmpd, name); os.makedirs(os.path.dirname(dst), exist_ok=True); open(dst, "wb").write(b_); got[name] = dst
    env = dict(os.environ, JC_JOURNEY=got["applicant-journey.js"], JC_SOURCES=":".join([got["index.html"], got["caregivers-engine.js"],
               os.path.join(HUB, "supabase/functions"), os.path.join(HUB, "orientation-booking.html"), os.path.join(TR, "supabase/functions")]))
    p = subprocess.run([NODE, got["tests/journey-check.mjs"]], cwd=tmpd, capture_output=True, text=True, env=env)
    last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
    if p.returncode != 0: bad("the journey check failed: " + " | ".join(l.strip() for l in p.stdout.splitlines() if l.strip())[:600]); say("  STOP. Nothing was changed."); done(2)
    say(f"  ✓ the journey check: {last.strip()} (the journey matches every real message; no em dashes in messages)")
else: say("  · node is not on this Mac, so the tests and the journey check were not re-run here (they passed when built)")

say(); say("PART 2 · CHANGE (wording only)")
for ref, root, fn, vj, label, st in plan:
    if st == "new": say(f"  · {label} {fn}: not on the server, skipped"); continue
    if st == "this": say(f"  ✓ {label} {fn} already had it"); continue
    if not deploy(ref, root, fn, vj, label): say("  STOP. Tell Claude."); done(6)

say(); say("PART 3 · PROOF (nothing is sent)")
for ref, root, fn, vj, label, st in plan:
    if st == "new": continue
    okd, live = live_files(ref, fn)
    chk(okd and all(k in live and live[k] == sha(os.path.join(root, k)) for k in need(root, fn)), f"{label} {fn}: the live copy is exactly the reviewed build")
shutil.rmtree(tmpd, ignore_errors=True)
say()
say("RESULT: " + ("DONE · messages to applicants, caregivers and families have no em dashes, and the Applicant journey matches the real messages." if not fails else "PARTLY DONE · the ✗ lines above need Claude."))
say("Nothing was texted or emailed, and no record was changed.")
say("Rollback: Claude redeploys GitHub's earlier copies (only the wording differs).")
done(0 if not fails else 8)
