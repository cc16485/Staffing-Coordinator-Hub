#!/usr/bin/env python3
# 740 · MAKE THIS A LEAD. Samantha, 2026-10-14: "our number and phone transcripts need to be used to fill lead and have us
#   easily mark call as a lead and based on the transcript fill the lead info", then on the mockup: "The AI only tags likely
#   new families and we click Make this a lead. Build it as mocked up."
# Part 1 (read only): the reviewed build; the tests pass here; each function is new, the old build or already this one;
#   the secrets it needs are there.
# Part 2: the "Not a lead" list (app_data call_lead_marks) made if missing; call-to-lead deployed (new: reads one call and
#   fills the lead form, writes nothing); call-pull deployed (records calls for the call reader, no longer asks for leads);
#   call-followup deployed (retired: answers, makes nothing).
# Part 3 (proof): the live copies are the reviewed build; call-to-lead refuses no sign-in and the public key; call-followup
#   makes nothing. Prints counts only: no name, number, email, key or secret.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil, time
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
HUB_REF = "zngsgedlsxinbygwmxwn"
HUB = os.environ["SB_REPO"]; HUB_BASE = os.environ.get("SB_BASE", "")
HUB_SHAS = json.loads(os.environ["SB_SHAS"])
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
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-740/1.0"}, **(headers or {})))
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
    tmp = tempfile.mkdtemp(prefix="cl740-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
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
def lit(v): return "'" + str(v).replace("'", "''") + "'"
FNS = {"call-to-lead": True, "call-pull": None, "call-followup": None}   # gateway sign-in check: on for the new one; the others keep theirs
TESTS = ["call_to_lead_test.mjs", "call_followup_guard_test.mjs", "call_record_wiring_test.mjs", "returning_entries_test.mjs"]

say("740 · MAKE THIS A LEAD"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
reviewed(HUB, HUB_BASE, HUB_SHAS, "the Hub server")
pinned = {pinpath(k) for k in HUB_SHAS}
for fn in FNS:
    other = sorted(k for k in need(HUB, fn) if k not in pinned and base_sha(HUB, HUB_BASE, k) != sha(os.path.join(HUB, k)))
    if other: bad(f"other changes merged since the review touch {fn} ({', '.join(other)[:200]}). Ask Claude to refresh 740."); say("  STOP. Nothing was run."); done(2)
say("  ✓ call-to-lead, call-pull and call-followup are the reviewed build")
NODE = shutil.which("node") or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.path.exists(p)), "")
if NODE:
    env = dict(os.environ)
    pg = os.path.expanduser("~/Claude/Projects/.pglite/node_modules/@electric-sql/pglite/dist/index.js")
    if os.path.exists(pg): env["PGLITE"] = pg
    for t in TESTS:
        p = subprocess.run([NODE, t], cwd=HUB, capture_output=True, text=True, env=env)
        last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
        if p.returncode != 0: bad(f"{t} failed: {last}"); say("  STOP. Nothing was changed."); done(2)
        say(f"  ✓ {t}: {last.strip()}")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
STATES = {}
for fn in FNS:
    st, vj = state(HUB_REF, HUB, HUB_BASE, fn, pinned)
    allowed = ("new", "this") if fn == "call-to-lead" else ("base", "this")
    if st not in allowed: bad(f"{fn} on the server is not what 740 expects ({st}). Nothing was changed. Tell Claude."); done(3)
    STATES[fn] = (st, vj); say(f"  ✓ {fn}: " + {"new": "is new", "this": "already this build", "base": "the build before this change"}[st])
hs = secrets(HUB_REF)
miss = [s for s in ("GHL_LOCATION_ID", "ANTHROPIC_API_KEY") if s not in hs] + ([] if ("GHL_TOKEN" in hs or "GHL_API_KEY" in hs) else ["GHL_TOKEN"])
if miss: bad("secrets missing: " + ", ".join(miss) + ". Nothing was changed."); done(3)
say("  ✓ the GoHighLevel and AI keys are set on the server")
K = keys(HUB_REF); ANON, SERVICE = K.get("anon", ""), K.get("service_role", ""); HIDE += [ANON, SERVICE]
if not ANON: bad("couldn't read the Hub's public key. Nothing was changed."); done(3)
ok, mk = sql("select count(*)::int as n from app_data where key = 'call_lead_marks'")
if not ok or not mk: bad("couldn't read the database. Nothing was changed."); done(3)
say("  · the Not a lead list: " + ("already there" if mk[0]["n"] else "will be made"))

say(); say("PART 2 · CHANGE")
ok, r = sql("insert into public.app_data (key, data, updated_at) values ('call_lead_marks', '[]'::jsonb, now()) on conflict (key) do nothing")
ok2, mk2 = sql("select jsonb_typeof(data) as t from app_data where key = 'call_lead_marks'")
chk(ok and ok2 and mk2 and mk2[0]["t"] == "array", "the Not a lead list is there")
for fn, want in FNS.items():
    st, vj = STATES[fn]
    if st == "this": say(f"  ✓ {fn} already had it"); continue
    if not deploy(HUB_REF, HUB, fn, want if want is not None else vj, "Hub"): say("  STOP. Tell Claude."); done(6)
time.sleep(float(os.environ.get("SB_SETTLE", "8")))

say(); say("PART 3 · PROOF")
for fn in FNS:
    okd, live = live_files(HUB_REF, fn)
    chk(okd and all(k in live and live[k] == sha(os.path.join(HUB, k)) for k in need(HUB, fn)), f"{fn}: the live copy is exactly the reviewed build")
URL = f"{FNB}/functions/v1/call-to-lead"
s0 = http("POST", URL, {"action": "read", "message_id": "proof740xx"}, {})[0]
chk(s0 == 401, f"call-to-lead refuses a page that is not signed in ({s0})")
s1 = http("POST", URL, {"action": "read", "message_id": "proof740xx"}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
chk(s1 in (401, 403), f"call-to-lead refuses the public key ({s1})")
sF, bF = http("POST", f"{FNB}/functions/v1/call-followup?token=wrong", {"transcript": "x"}, {"apikey": ANON, "Authorization": "Bearer " + ANON})
chk(sF in (401, 403), f"call-followup still refuses a wrong code ({sF})")
ok, lc = sql("""select count(*)::int as n from app_data, jsonb_array_elements(case when jsonb_typeof(data) = 'array' then data else '[]'::jsonb end) e
  where key = 'leads' and e->>'source' = 'Inbound Call' and coalesce(e->>'created_at', '') > to_char(now() at time zone 'utc' - interval '10 minutes', 'YYYY-MM-DD"T"HH24:MI')""")
chk(ok and lc and lc[0]["n"] == 0, "no lead was made by the AI in the last 10 minutes")
say()
say("RESULT: " + ("DONE · the server is ready. Next: Claude merges the Hub change, then Make this a lead shows on Calls and Call Follow Ups." if not fails else "PARTLY DONE · the ✗ lines above need Claude."))
say("Nothing was texted or emailed. No lead was made or changed.")
say("Rollback: Claude redeploys call-pull and call-followup from the build before 740 (the AI made leads again) and removes call-to-lead.")
done(0 if not fails else 8)
