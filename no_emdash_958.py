#!/usr/bin/env python3
# 958 · NO EM DASHES IN THE SERVER'S WORDS (Samantha, 2026-10-18: "merge PRs 534, 535 and 536, then build the Desktop step
# that deploys the changed functions"). Redeploys every live service that bundles one of the 45 files those PRs reworded, so
# the Hub's lead history, Needs Attention items, office alerts, AxisCare notes and the Step 1 PDF stop showing em dashes.
#
# It only ships the wording. A service is redeployed only when its live copy matches the server's main exactly, apart from
# the reworded files, which must still be the version from just before the change (dac63498). Anything else on a service
# (another change merged but not live yet, a live copy nobody can match) holds that one service back, and the report names
# the file, so this step never ships someone else's work. Each service keeps its gateway sign-in setting. A service that is
# not live is left alone. No SQL, no settings, never texts or emails anyone. Safe to run again (already-live ones are skipped).
#
# Env: SB_TOKEN, SB_REPORT, SB_SUPA_CLI, SB_REPO (a fresh worktree of the reviewed commit), SB_BEFORE (dac63498...),
#      SB_SHAS (JSON {repo path: sha256} of the 45 reviewed files). Optional: SB_API_BASE, SB_POLL (fake runs).
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil, time
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
REF = "zngsgedlsxinbygwmxwn"
REPO = os.environ["SB_REPO"]; BEFORE = os.environ.get("SB_BEFORE", "")
SHAS = json.loads(os.environ["SB_SHAS"])
FNROOT = os.path.join(REPO, "supabase", "functions")
lines = []; fails = []
def say(s=""):
    s = re.sub(r"(sbp_|eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._\-]+", "(hidden)", str(s)); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Anything deployed above stays deployed; nothing after it ran. Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=120):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers=dict({"Content-Type": "application/json", "User-Agent": "cc-958/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
shab = lambda b: hashlib.sha256(b).hexdigest()
sha = lambda p: shab(open(p, "rb").read())
POLL = float(os.environ.get("SB_POLL", "3"))
def git(*a): return subprocess.run(["git", *a], cwd=REPO, capture_output=True)
def deps(path, seen):
    if path in seen or not os.path.exists(path): return
    seen.add(path)
    src = "\n".join(l for l in open(path).read().split("\n") if not re.match(r"\s*import\s+type\b", l))
    for m in re.findall(r"""from\s+['"](\.{1,2}/[^'"]+)['"]|import\s+['"](\.{1,2}/[^'"]+)['"]""", src):
        deps(os.path.normpath(os.path.join(os.path.dirname(path), m[0] or m[1])), seen)
def need(fn):
    s = set(); deps(os.path.join(FNROOT, fn, "index.ts"), s)
    return {os.path.relpath(x, REPO).replace(os.sep, "/") for x in s}
def fmeta(fn):
    s = None
    for i in range(4):
        s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{fn}", headers=MG())
        if s == 200:
            try: return s, json.loads(b)
            except Exception: pass
        if s == 404: return s, None
        time.sleep(POLL * (i + 1))
    return s, None
def live_files(fn):
    for i in range(3):
        tmp = tempfile.mkdtemp(prefix="cc958-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
        d = subprocess.run([SUPA, "functions", "download", fn, "--project-ref", REF, "--use-api"], cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
        live = {}
        for r_, _, files in os.walk(tmp):
            for f in files:
                lp = os.path.join(r_, f).replace(os.sep, "/")
                if "/functions/" in lp: live["supabase/functions/" + lp.split("/functions/", 1)[1]] = sha(lp)
        shutil.rmtree(tmp, ignore_errors=True)
        if d.returncode == 0 and live: return True, live
        time.sleep(POLL * (i + 1))
    return False, {}
HIST = {}
def in_history(rel, h):
    if rel not in HIST:
        out = set()
        for c in git("log", "--format=%H", "HEAD", "--", rel).stdout.decode().split():
            b = git("show", f"{c}:{rel}")
            if b.returncode == 0: out.add(shab(b.stdout))
        HIST[rel] = out
    return h in HIST[rel]
OLD = {}
def old_sha(rel):
    if rel not in OLD:
        b = git("show", f"{BEFORE}:{rel}"); OLD[rel] = shab(b.stdout) if b.returncode == 0 else None
    return OLD[rel]

say("958 · NO EM DASHES IN THE SERVER'S WORDS"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
if not BEFORE or git("cat-file", "-e", BEFORE + "^{commit}").returncode != 0: bad("the starting point (before the wording change) isn't in the server's history"); say("  STOP. Nothing was run."); done(2)
for rel, want in SHAS.items():
    p_ = os.path.join(REPO, rel)
    if not os.path.exists(p_) or sha(p_) != want: bad(f"{rel.split('supabase/functions/')[-1]} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
say(f"  ✓ the {len(SHAS)} reworded files are the reviewed build (PRs #534, #535, #536)")
MINE = set(SHAS)
fns = sorted(d for d in os.listdir(FNROOT) if not d.startswith("_") and os.path.exists(os.path.join(FNROOT, d, "index.ts")) and need(d) & MINE)
say(f"  · {len(fns)} services bundle a reworded file; checking each live copy")
go, live_now, held, absent = [], [], [], []
for fn in fns:
    s, m = fmeta(fn)
    if s == 404: absent.append(fn); continue
    vj = (m or {}).get("verify_jwt")
    okd, live = live_files(fn)
    if not okd or not isinstance(vj, bool): held.append((fn, "could not read its live copy")); continue
    nd = need(fn)
    differ = sorted(k for k in nd if live.get(k) != sha(os.path.join(REPO, k)))
    stray = sorted(k for k in live if k.endswith((".ts", ".js")) and k not in nd and not in_history(k, live[k]))
    if stray: held.append((fn, "its live copy has a file main never had: " + ", ".join(x.split("functions/")[-1] for x in stray)[:160])); continue
    if not differ: live_now.append(fn); continue
    other = [k for k in differ if k not in MINE or live.get(k) != old_sha(k)]
    if other:
        held.append((fn, "deploying it would also ship " + ", ".join(k.split("functions/")[-1] for k in other)[:200] + ", which is not live yet")); continue
    go.append((fn, vj))
say(f"  ✓ ready to redeploy: {len(go)}" + (" (" + ", ".join(f for f, _ in go) + ")" if go else ""))
if live_now: say(f"  ✓ already live with the new wording: {len(live_now)} (" + ", ".join(live_now) + ")")
if absent: say(f"  · not live, left alone: {len(absent)} (" + ", ".join(absent) + ")")
for fn, why in held: say(f"  ⚠ held back: {fn}: {why}")
say()
say("PART 2 · CHANGE (redeploy the wording, nothing else)")
if not go: say("  · nothing to redeploy")
ok_n = 0
for fn, vj in go:
    p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"] + ([] if vj else ["--no-verify-jwt"]), cwd=REPO, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    okd, live = live_files(fn)
    if not (p.returncode == 0 and okd and all(live.get(k) == sha(os.path.join(REPO, k)) for k in need(fn))):
        bad(f"{fn} did not deploy cleanly: " + (p.stderr or p.stdout)[-200:]); continue
    sN, mN = fmeta(fn)
    if (mN or {}).get("verify_jwt") != vj:
        http("PATCH", f"{API}/v1/projects/{REF}/functions/{fn}", {"verify_jwt": vj}, MG()); sN, mN = fmeta(fn)
    if (mN or {}).get("verify_jwt") != vj: bad(f"{fn}: the gateway sign-in setting did not come back"); continue
    ok_n += 1
    say(f"  ✓ {fn} redeployed, version {(mN or {}).get('version', '?')} (gateway sign-in check {'on' if vj else 'off'})")
say()
if fails: say(f"RESULT: {ok_n} of {len(go)} redeployed; the ✗ lines above did not. Tell Claude 'ran 958'."); done(1)
say("RESULT: DONE." + (f" {len(held)} held back (named above); they get the new wording with their own next release." if held else "")
    + " Tell Claude 'ran 958'. Nothing was texted or emailed; no setting or record changed.")
done(0)
