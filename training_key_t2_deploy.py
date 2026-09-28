#!/usr/bin/env python3
# T2 · THE TRAINING DATA AND THE BACKGROUND-CHECK UPLOAD ON YOUR SIGN-IN · two runs, in this order:
#   SB_PHASE=add   (Desktop 310, after the Training PR is merged): deploy the NEW hub-training-data function. Additive:
#                  nothing calls it yet and nothing else changes. Check: it turns away no sign-in and the old key.
#   SB_PHASE=lock  (Desktop 311, after the Hub PRs are merged and live): the live pages no longer call the Training
#                  database functions directly and send your sign-in to hub-training-data and ghl-attach-doc; then
#                  redeploy ghl-attach-doc on your sign-in (keeping its gateway setting) and install the database lock
#                  (the three functions stop answering browsers). Check: status codes only; the key is never printed.
# Deploys only from the Training repo's main as merged on GitHub (exported by the Desktop command).
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys
PHASE = os.environ["SB_PHASE"]; FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPORT = os.environ["SB_REPORT"]
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); TREF = os.environ.get("SB_TRAINING_REF", "rdqujxiycycwhskyvrwa")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
FNB = os.environ.get("SB_FN_BASE", f"https://{TREF}.supabase.co"); GATE_SHA = os.environ.get("SB_GATE_SHA", "")
LOCK_SQL = os.environ.get("SB_LOCK_SQL", ""); LOCK_SHA = os.environ.get("SB_LOCK_SHA", "")
PAGES = json.loads(os.environ.get("SB_PAGES", json.dumps({
    "Care Coordinator Hub": "https://cc.mo-care.com/index.html", "its caregiver engine": "https://cc.mo-care.com/caregivers-engine.js",
    "Staffing Hub": "https://sc.mo-care.com/index.html", "Team Hub": "https://hub.mo-care.com/index.html", "offer page": "https://hub.mo-care.com/offer.html"})))
TITLE = {"add": "T2 · STEP 1 · ADD THE TRAINING DATA FUNCTION", "lock": "T2 · STEP 2 · UPLOAD ON YOUR SIGN-IN + LOCK THE DATABASE FUNCTIONS"}[PHASE]
lines = []
def say(s=""): print(s); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:300]); say("  Anything done above stays done; nothing after it ran.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def api(path, method="GET", body=None):
    req = urllib.request.Request(API + f"/v1/projects/{TREF}" + path, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "cc-t2/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return r.status, json.loads(r.read().decode(errors="replace") or "null")
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read().decode(errors="replace") or "null")
        except Exception: return e.code, None
    except Exception: return None, None
def call(method, path, body=None, headers=None):
    req = urllib.request.Request(FNB + path, data=body, method=method, headers=dict({"Origin": "https://cc.mo-care.com",
        "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "x-hub-token", "Content-Type": "application/json", "User-Agent": "cc-t2/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=60) as r: r.read(); return r.status, dict(r.headers)
    except urllib.error.HTTPError as e: return e.code, dict(e.headers or {})
    except Exception: return None, {}
def page(url):
    try:
        req = urllib.request.Request(url + ("&" if "?" in url else "?") + "t2=" + dt.datetime.now().strftime("%H%M%S"), headers={"User-Agent": "cc-t2/1.0", "Cache-Control": "no-cache"})
        with urllib.request.urlopen(req, timeout=60) as r: return r.read().decode(errors="replace")
    except Exception: return None
def deploy(fn, keep_jwt):
    args = [SUPA, "functions", "deploy", fn, "--project-ref", TREF, "--use-api"] + ([] if keep_jwt else ["--no-verify-jwt"])
    p = subprocess.run(args, cwd=os.path.dirname(os.path.dirname(FNROOT)), env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    return p.returncode == 0, (p.stderr or p.stdout)[-300:]
def secrets():
    st, keys = api("/api-keys")
    anon = next((k.get("api_key") for k in (keys or []) if k.get("name") == "anon"), "") if st == 200 else ""
    st, rows = api("/database/query", "POST", {"query": "select value->>'key' as k from public.app_settings where key='hub_read_key'"})
    old = (rows[0].get("k") or "") if st in (200, 201) and rows else ""
    return anon, old
DATA_CALL = re.compile(r"await fetch\((TRAINING_DATA_FN\+|TRAINING_HUB_API|TRAIN_API|TRAINING_API|'https://rdqujxiycycwhskyvrwa\.supabase\.co/functions/v1/(hub-training-data|ghl-attach-doc))")

say(TITLE); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY")
bad = False
for fn, want in SHAS.items():
    got = hashlib.sha256(open(os.path.join(FNROOT, fn, "index.ts"), "rb").read()).hexdigest()
    say(("  ✓ " if got == want else "  ✗ ") + f"{fn} is the reviewed build" + ("" if got == want else " (differs)")); bad = bad or got != want
if GATE_SHA:
    got = hashlib.sha256(open(os.path.join(FNROOT, "_shared", "hub-gate.ts"), "rb").read()).hexdigest()
    say(("  ✓ " if got == GATE_SHA else "  ✗ ") + "the shared sign-in check is the reviewed build"); bad = bad or got != GATE_SHA
if PHASE == "lock":
    got = hashlib.sha256(open(LOCK_SQL, "rb").read()).hexdigest() if LOCK_SQL and os.path.exists(LOCK_SQL) else ""
    say(("  ✓ " if got == LOCK_SHA else "  ✗ ") + "the database lock is the reviewed script"); bad = bad or got != LOCK_SHA
if bad: say("  STOP. Nothing was run."); done(2)
anon, old = secrets()
if not anon or not old: say("  ✗ could not read what the checks need (the project's public key and the old key). Nothing was changed."); done(4)

if PHASE == "add":
    st, meta = api("/functions/hub-training-data")
    say("  · hub-training-data " + ("is already deployed; it will be redeployed from the reviewed build" if st == 200 else "is new"))
    say(); say("PART 2 · DEPLOY (new; nothing calls it until the Hub pages are updated)")
    good, err = deploy("hub-training-data", True)
    say(("  ✓ " if good else "  ✗ ") + "hub-training-data" + ("" if good else ": " + err))
    if not good: say("  STOP. Nothing else changed."); done(5)
    say(); say("PART 3 · CHECK (status codes only; the key is never printed)")
    auth = {"apikey": anon, "Authorization": "Bearer " + anon}
    s0, h0 = call("OPTIONS", "/functions/v1/hub-training-data?action=job_offers")
    pre = s0 == 200 and "x-hub-token" in (h0.get("Access-Control-Allow-Headers") or h0.get("access-control-allow-headers") or "")
    res = {a: (call("POST", f"/functions/v1/hub-training-data?action={a}", json.dumps({"p_key": old, "p_id": "00000000-0000-0000-0000-000000000000"}).encode(), auth)[0],
               call("POST", f"/functions/v1/hub-training-data?action={a}", b"{}", dict(auth, **{"x-hub-token": "not-a-real-sign-in"}))[0])
           for a in ("job_offers", "training_status", "offer_update")}
    ok = pre and all(a == 401 and b == 401 for a, b in res.values())
    say(("  ✓ " if pre else "  ✗ ") + "a browser is answered")
    for a, (s1, s2) in res.items():
        say(("  ✓ " if s1 == 401 and s2 == 401 else "  ✗ ") + f"{a}: the old key alone turned away ({s1}) · a false sign-in turned away ({s2})")
    old = None; say()
    say("RESULT: " + ("ADDED · hub-training-data answers only office staff signed in to the Hub. Nothing calls it yet. Next: merge the Hub pull requests, then Desktop 311."
                      if ok else "CHECK THE ✗ LINES. Nothing calls this function yet, so nothing in the Hubs is affected."))
    done(0 if ok else 7)

# ---------------- lock
for label, url in PAGES.items():
    src = page(url)
    if src is None: say(f"  ✗ could not read the live {label}"); bad = True; continue
    direct = len(re.findall(r"rest/v1/rpc/hub_(job_offers|offer_update|training_status)", src))
    calls = [m.start() for m in DATA_CALL.finditer(src)]; good = [c for c in calls if re.search(r"'x-hub-token'\s*:", src[c:c + 320])]
    ok = direct == 0 and len(good) == len(calls) and (bool(calls) or label == "Team Hub" and "hub-training-data" in src)
    say(("  ✓ " if ok else "  ✗ ") + f"the live {label}: calls the database functions directly: {direct} · sends your sign-in on every Training data call ({len(good)} of {len(calls)})")
    bad = bad or not ok
if bad: say("  STOP. The live pages are not all updated yet (GitHub Pages can take a few minutes). Nothing was changed. Run this again shortly."); done(3)
st, meta = api("/functions/ghl-attach-doc")
if not (st == 200 and isinstance(meta, dict) and "verify_jwt" in meta): say(f"  ✗ could not read ghl-attach-doc's setting ({st}). Nothing was changed."); done(4)
keep = bool(meta["verify_jwt"]); say("  ✓ ghl-attach-doc: " + ("gateway sign-in required; kept" if keep else "no gateway sign-in; kept that way"))
st, meta = api("/functions/hub-training-data")
if st != 200: say("  ✗ hub-training-data is not deployed (run Desktop 310 first). Nothing was changed."); done(4)
say("  ✓ hub-training-data is deployed (Desktop 310)")
say(); say("PART 2 · CHANGE")
good, err = deploy("ghl-attach-doc", keep)
say(("  ✓ " if good else "  ✗ ") + "ghl-attach-doc redeployed on your sign-in" + ("" if good else ": " + err))
if not good: say("  STOP. Nothing else changed (the database functions still answer as before)."); done(5)
st, out = api("/database/query", "POST", {"query": open(LOCK_SQL).read()})
locked = st in (200, 201)
say(("  ✓ " if locked else "  ✗ ") + "the database lock is installed (one transaction, self-checked)" + ("" if locked else f": {st} {str(out)[:240]}"))
if not locked: say("  STOP. ghl-attach-doc is on your sign-in; the database functions are unchanged (the lock undid itself)."); done(6)
say(); say("PART 3 · CHECK (status codes only; the key is never printed)")
allok = True
auth = {"apikey": anon, "Authorization": "Bearer " + anon}
for f, body in (("hub_job_offers", {"p_key": old}), ("hub_training_status", {"p_key": old}),
                ("hub_offer_update", {"p_key": old, "p_id": "00000000-0000-0000-0000-000000000000", "p_step1": False})):
    s, _ = call("POST", f"/rest/v1/rpc/{f}", json.dumps(body).encode(), auth)
    ok = s in (401, 403, 404); allok = allok and ok
    say(("  ✓ " if ok else "  ✗ ") + f"{f}: a browser holding the old key is turned away ({s})")
st, rows = api("/database/query", "POST", {"query": """select bool_and(not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute')
   and has_function_privilege('service_role', p.oid, 'execute')) as ok, count(*) as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname in ('hub_job_offers','hub_offer_update','hub_training_status')"""})
g = rows[0] if st in (200, 201) and rows else {}
gok = g.get("ok") is True and int(g.get("n") or 0) == 3; allok = allok and gok
say(("  ✓ " if gok else "  ✗ ") + "the three answer the server only (read back from the database)")
s0, h0 = call("OPTIONS", "/functions/v1/ghl-attach-doc")
pre = s0 == 200 and "x-hub-token" in (h0.get("Access-Control-Allow-Headers") or h0.get("access-control-allow-headers") or "")
# no phone, email, file or probe: even a function that wrongly accepted the key could not create or upload anything
s1, _ = call("POST", "/functions/v1/ghl-attach-doc", json.dumps({"key": old}).encode(), auth)
s2, _ = call("POST", "/functions/v1/ghl-attach-doc", json.dumps({"key": old}).encode(), dict(auth, **{"x-hub-token": "not-a-real-sign-in"}))
st, meta = api("/functions/ghl-attach-doc"); kept = st == 200 and isinstance(meta, dict) and bool(meta.get("verify_jwt")) == keep
ok = pre and kept and s1 == 401 and s2 == 401; allok = allok and ok
say(("  ✓ " if ok else "  ✗ ") + f"ghl-attach-doc: a browser is answered: {'yes' if pre else 'NO'} · gateway setting kept: {'yes' if kept else 'NO'} · the old key alone turned away ({s1}) · a false sign-in turned away ({s2})")
s3, _ = call("POST", "/functions/v1/hub-training-data?action=job_offers", json.dumps({"p_key": old}).encode(), auth)
allok = allok and s3 == 401; say(("  ✓ " if s3 == 401 else "  ✗ ") + f"hub-training-data still turns away the old key alone ({s3})")
old = None; say()
say("RESULT: " + ("LOCKED · offers, offer updates, training status and the background-check upload now work only for office staff signed in to the Hub. The shared key opens none of them."
                  if allok else "CHECK THE ✗ LINES."))
say("Rollback if ever needed: hub-key-functions-lock-rollback.sql (Training repo) puts the database grants back; ghl-attach-doc's previous source is in the Training repo history.")
done(0 if allok else 7)
