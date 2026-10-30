#!/usr/bin/env python3
# 1207 · LEAVE WITH, SERVER PART (Staffing server; her go 2026-10-30 on the simpler Escalated to you, plan
#   2C6NzZXYUMVdzeQrR12BH4: "Yes to all three ... Build it behind a switch, off.").
#   Part 1 (read only): the reviewed build, the routing tests, work-route live is the build this builds on, the switches.
#   Part 2: work-route deployed (keeps its gateway setting). No database change. NO switch changed. Until someone presses
#     Leave with in the Hub (only there once Settings > Escalated to you, made simple is on), nothing behaves differently.
#   Part 3 (proof): the live copy is this build, it refuses the public key, its next scheduled run reports OK, every
#     switch exactly as before. Never texts, emails or calls anyone. Safe to run again.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil, time
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
HUB_REF = "zngsgedlsxinbygwmxwn"
HUB = os.environ["SB_REPO"]; HUB_BASE = os.environ.get("SB_BASE", "")
HUB_SHAS = json.loads(os.environ["SB_SHAS"]); SQL_SHAS = json.loads(os.environ.get("SB_SQL_SHAS", "{}"))
PRIOR = json.loads(os.environ.get("SB_PRIOR", "{}")); PRIOR_USED = set()
PRIOR = {k: (v if isinstance(v, list) else [v]) for k, v in PRIOR.items()}   # each job may hold its own earlier copy of a shared file   # a shared file whose earlier copy is what is live now (merged on main since these jobs were last deployed)
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB_REF}.supabase.co")
POLL = float(os.environ.get("SB_POLL", "15")); POLL_MAX = float(os.environ.get("SB_POLL_MAX", "420"))
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
def http(method, url, body=None, headers=None, timeout=200):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-1207/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql_raw(q): return http("POST", f"{API}/v1/projects/{HUB_REF}/database/query", {"query": q}, MG())
def sql(q):
    s, b = sql_raw(q)
    if s not in (200, 201): return False, f"HTTP {s}: {b[:300]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:200]
def selftest(tag, q):
    """a self-test ends by raising AXISTEST_<tag> {result}, which undoes all it did; the result rides in the error message"""
    s, b = sql_raw(q)
    try: msg = json.loads(b).get("message", b)
    except Exception: msg = b
    i = str(msg).find("AXISTEST_" + tag + " ")
    if i < 0: return {"ok": False, "why": f"HTTP {s}: " + str(b)[:240]}
    try: return json.JSONDecoder().raw_decode(str(msg)[i + len(tag) + 10:])[0]
    except Exception: return {"ok": False, "why": str(msg)[i:i + 240]}
def fmeta(ref, fn):
    s, b = http("GET", f"{API}/v1/projects/{ref}/functions/{fn}", headers=MG())
    try: return s, (json.loads(b) if s == 200 else None)
    except Exception: return s, None
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
    src = "\n".join(l for l in open(path).read().split("\n") if not re.match(r"\s*import\s+type\b", l))
    for m in re.findall(r"""from\s+['"](\.{1,2}/[^'"]+)['"]|import\s+['"](\.{1,2}/[^'"]+)['"]""", src):
        deps(os.path.normpath(os.path.join(os.path.dirname(path), m[0] or m[1])), seen)
def need(root, fn):
    s = set(); deps(os.path.join(root, f"supabase/functions/{fn}/index.ts"), s)
    return {os.path.relpath(x, root).replace(os.sep, "/") for x in s}
def live_files(ref, fn):
    for i in range(3):
        tmp = tempfile.mkdtemp(prefix="cl1207-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
        d = subprocess.run([SUPA, "functions", "download", fn, "--project-ref", ref, "--use-api"], cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
        live = {}
        for r, _, files in os.walk(tmp):
            for f in files:
                lp = os.path.join(r, f).replace(os.sep, "/")
                if "/functions/" in lp: live["supabase/functions/" + lp.split("/functions/", 1)[1]] = sha(lp)
        shutil.rmtree(tmp, ignore_errors=True)
        if d.returncode == 0 and live: return True, live
        time.sleep(float(os.environ.get("SB_SETTLE", "3")))
    return False, {}
def base_sha(root, base, rel):
    b = git(root, "show", f"{base}:{rel}")
    return shab(b.stdout) if b.returncode == 0 else None
def state(ref, root, base, fn, pinned):
    """'new' | 'base' | 'this' | 'other' | 'unreadable' for one live function, with its gateway setting."""
    s, m = fmeta(ref, fn)
    if s == 404: return "new", None
    vj = (m or {}).get("verify_jwt")
    okd, live = live_files(ref, fn)
    if not okd or not isinstance(vj, bool): return "unreadable", vj
    nd = need(root, fn)
    if all(k in live and live[k] == sha(os.path.join(root, k)) for k in nd): return "this", vj
    if all((k in live and (live[k] == base_sha(root, base, k) or live[k] in PRIOR.get(k, []))) or (k not in live and base_sha(root, base, k) is None and k in pinned) for k in nd):
        PRIOR_USED.update(k for k in nd if k in live and live[k] in PRIOR.get(k, []) and live[k] != base_sha(root, base, k))
        return "base", vj
    return "other", vj
def deploy(ref, root, fn, vj):
    p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", ref, "--use-api"] + ([] if vj else ["--no-verify-jwt"]), cwd=root, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    okd, live = live_files(ref, fn)
    good = okd and all(k in live and live[k] == sha(os.path.join(root, k)) for k in need(root, fn))
    if not good: bad(f"{fn} didn't deploy: " + (p.stderr or p.stdout)[-200:]); return False
    sN, mN = fmeta(ref, fn)
    if (mN or {}).get("verify_jwt") != vj:
        http("PATCH", f"{API}/v1/projects/{ref}/functions/{fn}", {"verify_jwt": vj}, MG()); sN, mN = fmeta(ref, fn)
    chk((mN or {}).get("verify_jwt") == vj, f"{fn} deployed, version {(mN or {}).get('version', '?')} (gateway sign-in check {'on' if vj else 'off'})")
    return (mN or {}).get("verify_jwt") == vj
def switches():
    ok, st = sql("select data from public.app_data where key = 'ops_settings'")
    if not ok or not st: return None
    d = st[0].get("data") or {}
    if isinstance(d, str):
        try: d = json.loads(d)
        except Exception: d = {}
    return {k: v for k, v in d.items() if k.endswith("_live") or k.endswith("_practice")}

FN = "work-route"
TESTS = ["duty_phase3_test.mjs", "slice2_581_test.mjs"]

say("1207 · STAFFING SERVER · LEAVE WITH FOR ESCALATED CARDS (SWITCH OFF)"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
if not HUB_BASE or git(HUB, "cat-file", "-e", HUB_BASE + "^{commit}").returncode != 0: bad("the reviewed starting point isn't in the server's history"); say("  STOP. Nothing was run."); done(2)
changed = set(git(HUB, "diff", "--name-only", HUB_BASE, "HEAD").stdout.decode().split())
for rel, want in [(pinpath(k), v) for k, v in HUB_SHAS.items()]:
    if rel not in changed or not os.path.exists(os.path.join(HUB, rel)) or sha(os.path.join(HUB, rel)) != want:
        bad(f"{rel.split('functions/')[-1]} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
pinned = {pinpath(k) for k in HUB_SHAS}
other = sorted(k for k in need(HUB, FN) if k not in pinned and base_sha(HUB, HUB_BASE, k) != sha(os.path.join(HUB, k)))
if other: bad("other changes merged since the review touch work-route (" + ", ".join(other)[:200] + "). Ask Claude to refresh 1207."); say("  STOP. Nothing was run."); done(2)
say("  ✓ work-route is the reviewed build")
NODE = shutil.which("node") or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.path.exists(p)), "")
if os.environ.get("SB_NODE") == "none": NODE = ""
if NODE:
    for t in TESTS:
        p = subprocess.run([NODE, t], cwd=HUB, capture_output=True, text=True)
        last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
        if p.returncode != 0 or "\nFAIL" in p.stdout: bad(f"{t} failed: {last}"); say("  STOP. Nothing was changed."); done(2)
        say(f"  ✓ {t}: {last.strip()}")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
st, vj = state(HUB_REF, HUB, HUB_BASE, FN, pinned)
if st not in ("base", "this"): bad(f"{FN} on the server is not the build this builds on ({st}); someone may have deployed a newer one. Nothing was changed. Tell Claude."); done(3)
say(f"  ✓ {FN}: " + {"base": "live is the build this builds on", "this": "already this build"}[st] + f", gateway sign-in check {'on' if vj else 'off'} (kept)")
if PRIOR_USED: say("  · it also picks up the newer copy on GitHub's main of: " + ", ".join(sorted(k.split("functions/")[-1] for k in PRIOR_USED)))
before = switches()
if before is None: bad("couldn't read the Hub's settings. Nothing was changed."); done(3)
say("  · Escalated to you, made simple: " + ("ON" if before.get("escalated_simple_live") is True else "OFF") + " · routing: " + ("ON" if before.get("routing_live") is True else "OFF") + " (this step changes neither)")
K = keys(HUB_REF); ANON, SVC = K.get("anon", ""), K.get("service_role", ""); HIDE += [ANON, SVC]
if not ANON: bad("couldn't read the Hub's keys. Nothing was changed."); done(3)

say(); say("PART 2 · CHANGE")
t_deploy = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
if st != "this" and not deploy(HUB_REF, HUB, FN, vj): say("  STOP. The current work-route keeps running. Tell Claude."); done(5)
if st == "this": say(f"  ✓ {FN} already had it")

say(); say("PART 3 · PROOF (nothing is sent)")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
okd, live = live_files(HUB_REF, FN)
chk(okd and all(k in live and live[k] == sha(os.path.join(HUB, k)) for k in need(HUB, FN)), f"{FN}: the live copy is exactly the reviewed build")
a1 = http("POST", f"{FNB}/functions/v1/{FN}?auth_check=1", {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
chk(a1 in (401, 403), f"{FN} refuses the public key ({a1})")
say("  · waiting for its next scheduled run (every 2 minutes) ...")
hb, waited = None, 0.0
while waited <= POLL_MAX:
    ok, rows = sql("""select e->>'ok' as ok, e->>'at' as at from public.app_data a cross join lateral jsonb_array_elements(case when jsonb_typeof(a.data) = 'array' then a.data else '[]'::jsonb end) e
      where a.key = 'automation_heartbeats' and e->>'automation' = 'work-route'""")
    hb = rows[0] if ok and rows else None
    if hb and str(hb.get("at") or "") >= t_deploy: break
    time.sleep(POLL); waited += POLL
chk(bool(hb) and str(hb.get("at") or "") >= t_deploy and hb.get("ok") == "true", "work-route ran on its own after the deploy and reports OK" + (f" ({hb.get('at')})" if hb else ""))
after = switches()
chk(after is not None and after == before, "every switch is exactly as it was")
say()
say("RESULT: " + ("DONE · work-route now keeps a card left with its owner from being escalated again for 3 days (urgent ones still escalate). Nothing changes until Leave with is pressed in the Hub. Next: Claude checks the Hub part live." if not fails else "CHECK THE ✗ LINES ABOVE and tell Claude."))
say("Nothing was texted, emailed or called.")
done(0 if not fails else 8)
