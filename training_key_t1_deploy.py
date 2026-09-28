#!/usr/bin/env python3
# T1 · THE FOUR TRAINING FUNCTIONS CHECK YOUR SIGN-IN · redeploy ghl-replies, ghl-thread, ghl-nurse-assign and
# axiscare-open-shifts (Training project) so each checks the caller's own Hub sign-in instead of the shared key.
# No database change.
# Part 1 (read only): the source is the reviewed build (exported from the Training repo's main, never the working
#   folder); the LIVE Hub pages already send the sign-in on every call to these four (so nothing breaks when the key
#   stops working here); each function's gateway sign-in setting is read so the redeploy keeps it. The source of the
#   deployed ghl-attach-doc (not in any repo) is downloaded to this Mac for T3; nothing about it changes.
# Part 2: redeploy the four, each keeping its setting.
# Part 3 (status codes only): each still answers a browser; a caller with no Hub sign-in is turned away; a caller
#   holding only the old shared key is turned away. The key is read inside this script and never printed.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, shutil
FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPORT = os.environ["SB_REPORT"]
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); TREF = os.environ.get("SB_TRAINING_REF", "rdqujxiycycwhskyvrwa")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
FNB = os.environ.get("SB_FN_BASE", f"https://{TREF}.supabase.co"); GATE_SHA = os.environ.get("SB_GATE_SHA", "")
ATTACH_OUT = os.environ.get("SB_ATTACH_OUT", "/Users/samantha/Claude/Projects/.training-live-source")
PAGES = json.loads(os.environ.get("SB_PAGES", json.dumps({
    "Care Coordinator Hub": "https://cc.mo-care.com/index.html", "its caregiver engine": "https://cc.mo-care.com/caregivers-engine.js",
    "Staffing Hub": "https://sc.mo-care.com/index.html", "Owners Hub": "https://hub.mo-care.com/owners.html"})))
lines = []
def say(s=""): print(s); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:300]); say("  Functions already redeployed above work with your sign-in; the rest are unchanged.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def api(path, method="GET", body=None):
    req = urllib.request.Request(API + f"/v1/projects/{TREF}" + path, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "cc-t1/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return r.status, json.loads(r.read().decode(errors="replace") or "null")
    except urllib.error.HTTPError as e: return e.code, None
    except Exception: return None, None
def call(method, name, body=None, headers=None):
    req = urllib.request.Request(FNB + "/functions/v1/" + name, data=body, method=method, headers=dict({"Origin": "https://cc.mo-care.com",
        "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "x-hub-token", "Content-Type": "application/json", "User-Agent": "cc-t1/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=60) as r: r.read(); return r.status, dict(r.headers)
    except urllib.error.HTTPError as e: return e.code, dict(e.headers or {})
    except Exception: return None, {}
def page(url):
    try:
        req = urllib.request.Request(url + ("&" if "?" in url else "?") + "t1=" + dt.datetime.now().strftime("%H%M%S"), headers={"User-Agent": "cc-t1/1.0", "Cache-Control": "no-cache"})
        with urllib.request.urlopen(req, timeout=60) as r: return r.read().decode(errors="replace")
    except Exception: return None
CALL = re.compile(r"await fetch\(('https://rdqujxiycycwhskyvrwa\.supabase\.co/functions/v1/(axiscare-open-shifts|ghl-replies|ghl-thread)'|NURSE_ASSIGN_API|HUB_FN),")

say("T1 · THE FOUR TRAINING FUNCTIONS CHECK YOUR SIGN-IN · REDEPLOY")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY")
bad = False
for fn, want in SHAS.items():
    got = hashlib.sha256(open(os.path.join(FNROOT, fn, "index.ts"), "rb").read()).hexdigest()
    say(("  ✓ " if got == want else "  ✗ ") + f"{fn} is the reviewed build" + ("" if got == want else " (differs)")); bad = bad or got != want
if GATE_SHA:
    got = hashlib.sha256(open(os.path.join(FNROOT, "_shared", "hub-gate.ts"), "rb").read()).hexdigest()
    say(("  ✓ " if got == GATE_SHA else "  ✗ ") + "the shared sign-in check is the reviewed build"); bad = bad or got != GATE_SHA
if bad: say("  STOP. Nothing was run."); done(2)
for label, url in PAGES.items():
    src = page(url)
    if src is None: say(f"  ✗ could not read the live {label}"); bad = True; continue
    calls = [m.start() for m in CALL.finditer(src)]; good = [c for c in calls if "'x-hub-token':" in src[c:c + 260]]
    ok = bool(calls) and len(good) == len(calls)
    say(("  ✓ " if ok else "  ✗ ") + f"the live {label} sends your sign-in on every call to these functions ({len(good)} of {len(calls)})"); bad = bad or not ok
if bad: say("  STOP. The live pages are not all updated yet (GitHub Pages can take a few minutes). Nothing was changed. Run this again shortly."); done(3)
setting = {}
for fn in SHAS:
    st, meta = api(f"/functions/{fn}")
    if st == 200 and isinstance(meta, dict) and "verify_jwt" in meta: setting[fn] = bool(meta["verify_jwt"])
    say(("  ✓ " if fn in setting else "  ✗ ") + f"{fn}: " + (("gateway sign-in required; kept" if setting[fn] else "no gateway sign-in; kept that way") if fn in setting else f"could not read its setting ({st})"))
if len(setting) != len(SHAS): say("  STOP. Nothing was changed."); done(4)
# ghl-attach-doc: download its deployed source for T3 (read only; not in any repo)
try:
    tmp = os.path.join(ATTACH_OUT, "_dl"); shutil.rmtree(tmp, ignore_errors=True); os.makedirs(os.path.join(tmp, "supabase", "functions"), exist_ok=True)
    p = subprocess.run([SUPA, "functions", "download", "ghl-attach-doc", "--project-ref", TREF, "--use-api"], cwd=tmp,
                       env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True, timeout=180)
    src_dir = os.path.join(tmp, "supabase", "functions", "ghl-attach-doc")
    if p.returncode == 0 and os.path.isdir(src_dir):
        dest = os.path.join(ATTACH_OUT, "ghl-attach-doc"); shutil.rmtree(dest, ignore_errors=True); shutil.copytree(src_dir, dest)
        n = sum(len(f) for _, _, f in os.walk(dest)); say(f"  ✓ the deployed ghl-attach-doc's source was saved on this Mac for T3 ({n} files). Nothing about it changed.")
    else: say("  · could not download ghl-attach-doc's source (not needed for T1): " + (p.stderr or p.stdout)[-160:].strip())
    shutil.rmtree(tmp, ignore_errors=True)
except Exception as e: say("  · could not download ghl-attach-doc's source (not needed for T1): " + type(e).__name__)

say(); say("PART 2 · REDEPLOY (each keeps its current gateway setting)")
deployed = []
for fn in SHAS:
    args = [SUPA, "functions", "deploy", fn, "--project-ref", TREF, "--use-api"] + ([] if setting[fn] else ["--no-verify-jwt"])
    p = subprocess.run(args, cwd=os.path.dirname(os.path.dirname(FNROOT)), env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    good = p.returncode == 0; say(("  ✓ " if good else "  ✗ ") + fn + ("" if good else ": " + (p.stderr or p.stdout)[-300:]))
    if not good: say("  STOP. The ones above are redeployed; the rest are unchanged and still take the key."); done(5)
    deployed.append(fn)

say(); say("PART 3 · CHECK (status codes only; the key is never printed)")
st, keys = api("/api-keys")
anon = next((k.get("api_key") for k in (keys or []) if k.get("name") == "anon"), "") if st == 200 else ""
st, rows = api("/database/query", "POST", {"query": "select value->>'key' as k from public.app_settings where key='hub_read_key'"})
old = (rows[0].get("k") or "") if st in (200, 201) and rows else ""
if not anon or not old: say("  ✗ could not read what the check needs (the project's public key and the old key)"); done(6)
BODY = {"ghl-replies": {}, "ghl-thread": {"conversation_id": "t1check000"}, "ghl-nurse-assign": {"phone": "0000000000", "dry": True}, "axiscare-open-shifts": {"days": 1}}
allok = True
for fn in deployed:
    s0, h0 = call("OPTIONS", fn)
    pre = s0 == 200 and "x-hub-token" in (h0.get("Access-Control-Allow-Headers") or h0.get("access-control-allow-headers") or "")
    auth = {"apikey": anon, "Authorization": "Bearer " + anon}
    s1, _ = call("POST", fn, json.dumps(BODY[fn]).encode(), auth)
    s2, _ = call("POST", fn, json.dumps(dict(BODY[fn], key=old)).encode(), auth)
    s3, _ = call("POST", fn, json.dumps(dict(BODY[fn], key=old)).encode(), dict(auth, **{"x-hub-token": "not-a-real-sign-in"}))
    st, meta = api(f"/functions/{fn}"); kept = st == 200 and isinstance(meta, dict) and bool(meta.get("verify_jwt")) == setting[fn]
    ok = pre and kept and s1 == 401 and s2 == 401 and s3 == 401
    say(("  ✓ " if ok else "  ✗ ") + f"{fn}: a browser is answered: {'yes' if pre else 'NO'} · gateway setting kept: {'yes' if kept else 'NO'}"
        f" · no sign-in turned away ({s1}) · the old key alone turned away ({s2}) · a false sign-in with the key turned away ({s3})")
    allok = allok and ok
old = None
say()
say("RESULT: " + ("DEPLOYED · these four answer only office staff signed in to the Hub, and the shared key no longer opens them. "
                  "Open Shifts, Replies waiting, the tardy scan, Care Match pairs, nurse claims and the Owners pulse (owners only) now run on your sign-in." if allok else "CHECK THE ✗ LINES."))
say("Rollback if ever needed: redeploy these four from the Training repo's commit before T1 (26b82c6); the key still works until T3.")
done(0 if allok else 7)
