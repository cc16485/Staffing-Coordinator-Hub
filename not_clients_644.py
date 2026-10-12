#!/usr/bin/env python3
# 644 · NOTHING HAPPENS FOR OFFICE STAFF. Samantha, 2026-10-12: "check on that, nothing should happen for office staff",
# then "yes build it". AxisCare's "Office Staff" client (#293) holds office time. The Hub's setting ops_settings.not_client_ax
# (owners change it on the Clients tab; until anyone does, it holds Office Staff) now reaches every background job:
#   _shared/client-quiet.ts: not-clients join the quiet list the shift jobs already skip (missed clock-ins, running late,
#     missed notes, Care Match, open-shift coverage, check-in obligations, journeys), and isNotClient() for the rest.
#   Changed jobs: shift-confirm (morning shift texts), care-notes (AI note review), eligibility-sweep (upcoming visits),
#     lead-digest (Morning Brief), circles-sync, client-sync, client-status-review, client-admission-scan, review-moments,
#     _shared/audience-guard.ts (client and family campaigns).
# 19 functions use those files and are redeployed. Part 1 (read only) STOPS if any live function isn't exactly main's
# build from before this change (someone else's change would ride along), or a test fails. Each keeps its gateway
# sign-in setting. Nothing is run, texted or emailed by this step; no record is changed. Counts only.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil, time
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
HUB_REF = "zngsgedlsxinbygwmxwn"
HUB = os.environ["SB_REPO"]; HUB_BASE = os.environ.get("SB_BASE", "")
HUB_SHAS = json.loads(os.environ["SB_SHAS"])
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB_REF}.supabase.co")
FNS = ["timekeeper-watch", "late-watch", "missed-notes", "carematch-watch", "coverage-watch", "obligations-run", "client-journey", "shift-confirm", "care-notes", "eligibility-sweep", "lead-digest", "circles-sync", "client-sync", "client-status-review", "client-admission-scan", "review-moments", "campaign-send", "campaign-auto", "client-history-import"]
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
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-644/1.0"}, **(headers or {})))
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
    tmp = tempfile.mkdtemp(prefix="nc644-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
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
def jget(b, k):
    try: return json.loads(b).get(k)
    except Exception: return None
def command(url, anon):
    return ("select net.http_post(url := " + lit(url) + ", headers := jsonb_build_object('Content-Type', 'application/json', "
            "'Authorization', " + lit("Bearer " + anon) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")), "
            "body := '{}'::jsonb, timeout_milliseconds := 120000);")


def live_is_base(fn):
    """'base' when every live file of fn is main's build before this change, 'this' when it already is this build."""
    s, m = None, None
    for i in range(4):
        s, m = fmeta(HUB_REF, fn)
        if s in (200, 404): break
        time.sleep(3 * (i + 1))
    if s == 404: return "missing", None, []
    vj = (m or {}).get("verify_jwt")
    okd, live = live_files(HUB_REF, fn)
    if not okd or not live or not isinstance(vj, bool): return f"unreadable (lookup {s})", vj, []
    if all(k in live and live[k] == sha(os.path.join(HUB, k)) for k in need(HUB, fn)): return "this", vj, []
    diff = sorted(k.split("functions/")[-1] for k, v in live.items() if base_sha(HUB, HUB_BASE, k) != v and not (k in EXTRA and v == sha(os.path.join(HUB, k))))
    return ("base" if not diff else "other"), vj, diff

say("644 · NOTHING HAPPENS FOR OFFICE STAFF"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
# reviewed changes merged by others since the base, which these functions may carry (path -> sha), e.g. #400's one-line
# verbs.js label (2026-10-12): named here, so they go out on purpose and nothing else rides along
EXTRA = json.loads(os.environ.get("SB_EXTRA", "{}"))
reviewed(HUB, HUB_BASE, HUB_SHAS, "the Hub server", list(EXTRA.items()))
pinned = {pinpath(k) for k in HUB_SHAS} | set(EXTRA)
for fn in FNS:
    other = sorted(k for k in need(HUB, fn) if k not in pinned and base_sha(HUB, HUB_BASE, k) != sha(os.path.join(HUB, k)))
    if other: bad(f"other changes merged since the review touch {fn} ({', '.join(other)[:200]}). Ask Claude to refresh 644."); say("  STOP. Nothing was run."); done(2)
say(f"  ✓ the {len(HUB_SHAS)} changed files are the reviewed build" + (f", plus {len(EXTRA)} reviewed change(s) merged by others: " + ", ".join(k.split("functions/")[-1] for k in EXTRA) if EXTRA else ""))
NODE = shutil.which("node") or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.path.exists(p)), "")
if NODE:
    for t in ("not_clients_test.mjs", "client_sync_test.mjs", "circles_sync_664_test.mjs", "status_review_care_test.mjs", "audience_guard_test.mjs", "campaign_auto_hold_test.mjs"):
        p = subprocess.run([NODE, t], cwd=HUB, capture_output=True, text=True)
        last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
        if p.returncode != 0 or re.search(r"^FAIL", p.stdout, re.M): bad(f"{t} failed: {last}"); say("  STOP. Nothing was changed."); done(2)
        say(f"  ✓ {t}: {last.strip()}")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
ST = {}
for fn in FNS:
    st, vj, diff = live_is_base(fn); ST[fn] = (st, vj)
    if st not in ("base", "this"):
        bad(f"{fn} on the server: {st}" + (f" (live files that differ from main: {', '.join(diff)[:200]})" if diff else ""))
if fails: say("  STOP. Nothing was changed. Tell Claude."); done(3)
say(f"  ✓ all {len(FNS)} functions on the server are main's build from before this change" + (f" ({sum(1 for v in ST.values() if v[0] == 'this')} already this build)" if any(v[0] == 'this' for v in ST.values()) else ""))
ok, cur = sql("select data->'not_client_ax' as nc from app_data where key = 'ops_settings'")
nc = cur[0]["nc"] if ok and cur else None
if isinstance(nc, str):
    try: nc = json.loads(nc)
    except Exception: nc = None
if isinstance(nc, list): say("  · left out today (the Hub setting): " + (", ".join(f"{x.get('name', '?')} (#{x.get('ax', '?')})" for x in nc if isinstance(x, dict)) or "nobody"))
else: say("  · the Hub setting has not been changed yet, so the default applies: Office Staff (#293)")

say(); say("PART 2 · CHANGE")
for fn in FNS:
    st, vj = ST[fn]
    if st == "this": say(f"  ✓ {fn}: already had it"); continue
    if not deploy(HUB_REF, HUB, fn, vj, "Hub"): say(f"  STOP. Functions above this line were updated; {fn} and the ones after it were not. Tell Claude."); done(6)

say(); say("PART 3 · PROOF")
for fn in FNS:
    okd, live = live_files(HUB_REF, fn)
    chk(okd and all(k in live and live[k] == sha(os.path.join(HUB, k)) for k in need(HUB, fn)), f"{fn}: the live copy is exactly the reviewed build")
for fn in FNS:
    s, m = fmeta(HUB_REF, fn)
    if (m or {}).get("verify_jwt") != ST[fn][1] and ST[fn][1] is not None: bad(f"{fn}: its gateway sign-in setting changed")
if not any("gateway" in f for f in fails): say("  ✓ every function kept its gateway sign-in setting")
say()
say("RESULT: " + ("DONE · from the next run of each job, nothing happens for Office Staff: no texts, alerts, cards, flags, circles, campaigns or review asks." if not fails else "PARTLY DONE · the ✗ lines above need Claude."))
say("Nothing was run, texted or emailed by this step, and no record was changed.")
say("Rollback: Claude redeploys the 19 functions from main's build before this change.")
done(0 if not fails else 8)
