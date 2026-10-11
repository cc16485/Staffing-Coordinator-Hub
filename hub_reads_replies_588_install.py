#!/usr/bin/env python3
# 588 · THE HUB READS INTERVIEW REPLIES ITSELF (Samantha, 2026-10-11: "yes build the hub version", after the GoHighLevel
# workflow screen could not be driven). interview-messages now reads each asked applicant's texts since the YES / NO
# question, every 15 minutes: a clear NO cancels that interview and frees the time; YES is kept; anything else goes to
# Needs Attention with their words. No GoHighLevel workflow is needed. Only while 'New applicant messages' is on.
# Message code only (no database change). SB_MODE=install: Part 1 read only (reviewed files; 587 is in; the live message
# code is the 587 build; saves a copy), Part 2 deploy, Part 3 proof (the live copy is the reviewed one; its 15-minute run
# still works; a practice run that sends nothing and changes nothing). SB_MODE=undo: puts back the saved copy.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil, time, glob

MODE = os.environ.get("SB_MODE", "install")
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
LOCAL = None
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
REF = "zngsgedlsxinbygwmxwn"; FN = "interview-messages"
REPO = os.environ["SB_REPO"]; BASE = os.environ.get("SB_BASE", "")
SAVE_ROOT = os.environ.get("SB_SAVE", os.path.expanduser("~/Claude/checks/588-saved"))
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
PINS = json.loads(os.environ.get("SB_PINS", "{}"))
lines, fails, HIDE = [], [], []

def say(s=""):
    s = str(s)
    for h in HIDE:
        if h: s = s.replace(h, "(hidden)")
    s = re.sub(r"(sbp_|eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._\-]+", "(hidden)", s)
    s = re.sub(r"[\w.%+\-]+@[\w.\-]+\.[A-Za-z]{2,}", "(an email)", s)
    print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def chk(ok, msg): (say if ok else bad)(("  ✓ " if ok else "") + msg); return ok
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:300]); say("  Anything done above stays done; nothing after it ran. Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash

def http(method, url, body=None, headers=None, timeout=200):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-587/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}

def sql(q):
    """One script. Returns (ok, rows | error text)."""
    if LOCAL:
        from pg8000.native import Connection
        c = Connection(user="postgres", database="postgres", unix_sock=LOCAL)
        try:
            rows = c.run(q); names = [x["name"] for x in (c.columns or [])]
            return True, [dict(zip(names, r)) for r in (rows or [])]
        except Exception as e:
            try: c.run("rollback")
            except Exception: pass
            return False, (e.args[0].get("M") if e.args and isinstance(e.args[0], dict) else str(e))[:600]
        finally: c.close()
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    if s not in (200, 201):
        try: return False, str(json.loads(b).get("message", b))     # 587: the message as text (586 cut it short, escaped)
        except Exception: return False, f"HTTP {s}: {b}"
    try: return True, json.loads(b)
    except Exception: return False, b[:300]

shab = lambda b: hashlib.sha256(b).hexdigest()
sha = lambda p: shab(open(p, "rb").read())
rd = lambda rel: open(os.path.join(REPO, rel)).read()

def body(defn):
    """The function body exactly as stored (Postgres keeps it verbatim between the $function$ quotes)."""
    m = re.search(r"\$function\$(.*)\$function\$", defn or "", re.S)
    return m.group(1).strip() if m else None
def file_body(text, name):
    m = re.search(r"CREATE OR REPLACE FUNCTION public\." + name + r"\(.*?AS \$function\$(.*?)\$function\$", text, re.S)
    return m.group(1).strip() if m else None
def live_defs():
    ok, r = sql("select pg_get_functiondef('public.interview_book(uuid,timestamptz)'::regprocedure) as book, "
                "pg_get_functiondef('public.interview_mine(uuid)'::regprocedure) as mine")
    return (r[0]["book"], r[0]["mine"]) if ok and r else (None, None)

# ---- message code (live project only) ----
def git(*a): return subprocess.run(["git", *a], cwd=REPO, capture_output=True)
def deps(path, seen):
    if path in seen or not os.path.exists(path): return
    seen.add(path)
    for m in re.findall(r"""from\s+['"](\.{1,2}/[^'"]+)['"]|import\s+['"](\.{1,2}/[^'"]+)['"]""", open(path).read()):
        deps(os.path.normpath(os.path.join(os.path.dirname(path), m[0] or m[1])), seen)
def need(root, fn=None):
    fn = fn or FN; s = set(); deps(os.path.join(root, f"supabase/functions/{fn}/index.ts"), s)
    return {os.path.relpath(x, root).replace(os.sep, "/") for x in s}
def download(into, fn=None):
    fn = fn or FN; os.makedirs(os.path.join(into, "supabase"), exist_ok=True)
    d = subprocess.run([SUPA, "functions", "download", fn, "--project-ref", REF, "--use-api"], cwd=into,
                       env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    files = {}
    for r, _, fs in os.walk(into):
        for f in fs:
            lp = os.path.join(r, f).replace(os.sep, "/")
            if "/functions/" in lp: files["supabase/functions/" + lp.split("/functions/", 1)[1]] = sha(lp)
    return d.returncode == 0, files
def base_sha(rel):
    b = git("show", f"{BASE}:{rel}")
    return shab(b.stdout) if b.returncode == 0 else None
def fmeta(fn=None):
    fn = fn or FN; s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{fn}", headers=MG())
    try: return json.loads(b) if s == 200 else None
    except Exception: return None
def deploy(root, vj, fn=None):
    fn = fn or FN
    p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"] + ([] if vj in (True, None) else ["--no-verify-jwt"]),
                       cwd=root, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    m = fmeta(fn) or {}
    if m.get("verify_jwt") != (True if vj is None else vj):
        http("PATCH", f"{API}/v1/projects/{REF}/functions/{fn}", {"verify_jwt": True if vj is None else vj}, MG())
    return p.returncode == 0, (p.stderr or p.stdout)[-300:]
def keys():
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_")) and "·" not in v and "*" not in v
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



say(f"588 · THE HUB READS INTERVIEW REPLIES ({'UNDO' if MODE == 'undo' else 'install'})")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
for rel, want in PINS.items():
    if not os.path.exists(os.path.join(REPO, rel)) or sha(os.path.join(REPO, rel)) != want:
        bad(f"{rel} is not the reviewed version"); say("  STOP. Nothing was run."); done(2)
if PINS: say(f"  ✓ the {len(PINS)} reviewed files are exactly what was tested")
NEW = {"supabase/functions/_shared/reply-classify.ts", "supabase/functions/_shared/ghl-inbox.ts"}
idx = f"supabase/functions/{FN}/index.ts"

if MODE == "undo":
    saved = sorted(glob.glob(os.path.join(SAVE_ROOT, "*", "function")))
    if not saved: bad("no saved copy was found; nothing was changed. Tell Claude."); done(3)
    root = saved[-1]; meta = json.load(open(os.path.join(os.path.dirname(root), "meta.json")))
    okd, err = deploy(root, meta.get("verify_jwt"))
    tmp = tempfile.mkdtemp(prefix="u588-"); okl, live = download(tmp); shutil.rmtree(tmp, ignore_errors=True)
    chk(okd and okl and all(live.get(k) == v for k, v in meta["files"].items()), "interview-messages is back to the copy saved before 588" + ("" if okd else ": " + err))
    say(); say("UNDO COMPLETE." if not fails else f"{len(fails)} PROBLEM(S) ABOVE. Tell Claude."); done(0 if not fails else 4)

say("PART 1 · READ ONLY (nothing changes)")
ok, r = sql("select count(*)::int as n from pg_proc where proname in ('interview_cancel_by_reply','interview_record_reply','applicant_followup_stop')")
if not ok or r[0]["n"] != 3: bad("587 isn't installed (588 builds on it). Nothing was changed."); done(3)
say("  ✓ 587 is in")
vj = (fmeta() or {}).get("verify_jwt")
stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S"); save = os.path.join(SAVE_ROOT, stamp); os.makedirs(save, exist_ok=True)
okd, live = download(os.path.join(save, "function"))
if not okd or not live: bad("couldn't read the live message code. Nothing was changed."); done(3)
others = sorted(k for k in need(REPO) if k != idx and k not in NEW and live.get(k) != sha(os.path.join(REPO, k)))
if others: bad("the live message code differs from main in: " + ", ".join(x.split('functions/')[-1] for x in others)[:300] + ". Nothing was changed. Tell Claude."); done(3)
if live.get(idx) not in (base_sha(idx), sha(os.path.join(REPO, idx))):
    bad("the live interview-messages isn't the 587 build (someone changed it since). Nothing was changed. Tell Claude."); done(3)
json.dump({"verify_jwt": vj, "files": live, "saved": stamp}, open(os.path.join(save, "meta.json"), "w"), indent=1)
ok, r = sql("select data->>'applicant_msgs_v2_live' as v2 from app_data where key = 'ops_settings'")
say(f"  ✓ the live message code is the 587 build; a copy is saved (for the undo); 'New applicant messages' is {'ON' if ok and r and r[0]['v2'] == 'true' else 'OFF'}")

say(); say("PART 2 · CHANGE")
okd, err = deploy(REPO, vj)
tmp = tempfile.mkdtemp(prefix="c588-"); okl, live = download(tmp); shutil.rmtree(tmp, ignore_errors=True)
if not chk(okd and okl and all(live.get(k) == sha(os.path.join(REPO, k)) for k in need(REPO)), "interview-messages is the reviewed version (it reads replies itself)" + ("" if okd else ": " + err)):
    say("  To put it back: the 588 undo step. Tell Claude."); done(6)

say(); say("PART 3 · PROOF (nothing is sent, nothing changes)")
K = keys(); SERVICE = K.get("service_role", ""); HIDE.append(SERVICE)
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
s4, b4 = http("POST", f"{FNB}/functions/v1/{FN}?dry=1", {}, {"Authorization": "Bearer " + SERVICE, "apikey": SERVICE})
try: would = (json.loads(b4) or {}).get("would") or {}
except Exception: would = {}
if chk(s4 == 200 and "replies" in would, f"a practice run answered ({s4}) and knows about replies; it sent nothing"):
    for k in ("confirm", "day", "hour", "nudge", "cancelled", "replies", "held"): say(f"    would {k}: {len(would.get(k) or [])}")
time.sleep(float(os.environ.get("SB_BEAT_WAIT", "5")))
ok, r = sql("""select x->>'at' as at, (x->>'ok')::boolean as ok from app_data, jsonb_array_elements(case when jsonb_typeof(data) = 'array' then data else '[]'::jsonb end) x
  where key = 'automation_heartbeats' and x->>'id' = 'hb_interview-messages'""")
if ok and r: chk(bool(r[0]["ok"]), f"its 15-minute run reports healthy (last run {str(r[0]['at'])[11:16]} UTC)")
say(); say("588 COMPLETE. Nothing was sent. No GoHighLevel workflow is needed for replies." if not fails else f"{len(fails)} PROBLEM(S) ABOVE. Tell Claude. (To put it back: the 588 undo step.)")
done(0 if not fails else 4)
