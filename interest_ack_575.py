#!/usr/bin/env python3
# 575 · NEW-CLIENT ASK: NO AUTO-REPLY. Samantha, 2026-10-10, on the "Dad" new-client text: "turn off the responses that
# say we haven't met the client yet and we will let them know".
#   coverage-reply (updated): the "Thank you! Nothing is set yet. We're meeting the client first..." text back to a
#     caregiver who answers YES to a "New client, ask the team" text now goes ONLY while the switch
#     ops_settings.coverage_ack_interest_live is on (Owners Hub Admin page, "Auto-reply to a new-client ask"). The switch
#     does not exist yet, so after this step nobody is texted back; every yes is still collected on the case.
# Part 1 (read only): the reviewed build (pinned); the live coverage-reply is the build this one was reviewed against
#   (or already this build); the tests pass here. Part 2: the function. Part 3 (proof; nothing is sent): the live copy
#   is the reviewed build; its own token check still stands; the switch is off.
# Prints counts only: no name, number, email, key or secret.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil, time
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
HUB_REF = "zngsgedlsxinbygwmxwn"
HUB = os.environ["SB_REPO"]; HUB_BASE = os.environ.get("SB_BASE", "")
HUB_SHAS = json.loads(os.environ["SB_SHAS"])
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB_REF}.supabase.co")
FN = "coverage-reply"
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
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-575/1.0"}, **(headers or {})))
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
    tmp = tempfile.mkdtemp(prefix="ia575-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
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
    # Not the base. Say exactly which piece differs, and whether it is an OLDER merged version (reviewed code that main has
    # since moved past, as the 498a look found for outreach.ts / send-problems.ts) or something never merged (someone's
    # unreleased change, which must not ship). The first run of 575 stopped here with no detail (2026-10-10).
    older = True
    for k in sorted(nd):
        if k not in live: DETAIL.append(f"{k.split('functions/')[-1]}: not in the live copy"); older = False; continue
        if live[k] == base_sha(root, base, k): continue
        hit = merged_version(root, base, k, live[k])
        if hit: DETAIL.append(f"{k.split('functions/')[-1]}: an OLDER merged version ({hit}); the reviewed current one goes out with this step")
        else: DETAIL.append(f"{k.split('functions/')[-1]}: differs from EVERY merged version (unreleased code). Not shipping over it."); older = False
    return ("older" if older else "other"), vj
DETAIL = []
def merged_version(root, base, rel, want):
    """The merged commit (on or before base) whose version of rel has this sha, or None."""
    log = git(root, "log", "--format=%h %ad %s", "--date=short", base, "--", rel).stdout.decode().splitlines()
    for line in log[:60]:
        h = line.split(" ", 1)[0]
        b = git(root, "show", f"{h}:{rel}")
        if b.returncode == 0 and shab(b.stdout) == want: return line[:90]
    return None
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

say("575 · NEW-CLIENT ASK: NO AUTO-REPLY"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
reviewed(HUB, HUB_BASE, HUB_SHAS, "the Hub server")
pinned = {pinpath(k) for k in HUB_SHAS}
other = sorted(k for k in need(HUB, FN) if k not in pinned and base_sha(HUB, HUB_BASE, k) != sha(os.path.join(HUB, k)))
if other: bad(f"other changes merged since the review touch {FN} ({', '.join(other)[:200]}). Ask Claude to refresh 575."); say("  STOP. Nothing was run."); done(2)
say("  ✓ the updated function is the reviewed build")
st, vj = state(HUB_REF, HUB, HUB_BASE, FN, pinned)
for d in DETAIL: say("      · " + d)
if st not in ("base", "older", "this"): bad(f"the live {FN} is not the build this change was reviewed against ({st}). Nothing was changed. Tell Claude."); done(3)
if not isinstance(vj, bool): bad(f"could not read how {FN} is deployed. Nothing was changed."); done(3)
say(f"  ✓ {FN}: " + ("is the build this was reviewed against" if st == "base" else "carries older merged (reviewed) pieces that move to the current reviewed ones with this step" if st == "older" else "already has this build (an earlier run)") + f" (gateway sign-in check {'on' if vj else 'off'}, kept as is)")
NODE = shutil.which("node") or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.path.exists(p)), "")
if NODE:
    for t in ("coverage_reply_interest_ack_test.mjs", "coverage_reply_picker_test.mjs"):
        p = subprocess.run([NODE, t], cwd=HUB, capture_output=True, text=True)
        last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
        if p.returncode != 0 or re.search(r"^FAIL", p.stdout, re.M): bad(f"{t} failed: {last}"); say("  STOP. Nothing was changed."); done(2)
        say(f"  ✓ {t}: {last.strip()}")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
K = keys(HUB_REF); ANON, SERVICE = K.get("anon", ""), K.get("service_role", ""); HIDE += [ANON, SERVICE]
if not ANON: bad("couldn't read the Hub's keys. Nothing was changed."); done(3)
ok, sw = sql("select coalesce(data->>'coverage_ack_interest_live', '') as live from app_data where key = 'ops_settings'")
if not ok: bad("couldn't read the database. Nothing was changed."); done(3)
say("  ✓ the switch 'Auto-reply to a new-client ask' is " + ("ON (it stays on; turn it off on the Owners Hub Admin page)" if sw and sw[0]["live"] == "true" else "off (not set), so after this step nobody is texted back"))

say(); say("PART 2 · CHANGE")
if st == "this": say(f"  ✓ {FN} already had it")
elif not deploy(HUB_REF, HUB, FN, vj, "Hub"): say("  STOP. Tell Claude."); done(6)

say(); say("PART 3 · PROOF (nothing is sent)")
okd, live = live_files(HUB_REF, FN)
chk(okd and all(k in live and live[k] == sha(os.path.join(HUB, k)) for k in need(HUB, FN)), f"{FN}: the live copy is exactly the reviewed build")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
URL = f"{FNB}/functions/v1/{FN}"
A = {"apikey": ANON, "Authorization": "Bearer " + ANON}
w1 = http("POST", URL + "?token=not-the-token", {"id": "x", "phone": "+14175550100", "message": "yes"}, A)[0]
chk(w1 in (401, 403), f"it still refuses a reply that does not carry its own token ({w1})")
ok, sw2 = sql("select coalesce(data->>'coverage_ack_interest_live', '') as live from app_data where key = 'ops_settings'")
chk(ok and (not sw2 or sw2[0]["live"] != "true"), "the auto-reply switch is off: a caregiver who answers YES is collected on the case and not texted back" if ok and (not sw2 or sw2[0]["live"] != "true") else "the switch is ON, so the auto-reply still goes until you turn it off (Owners Hub Admin page)")
say()
say("RESULT: " + ("DONE · nobody is texted back for answering a new-client ask; every yes still lands on the case. The Admin page switch arrives when Claude merges the Owners Hub side." if not fails else "PARTLY DONE · the ✗ lines above need Claude."))
say("Nothing was texted, and no case or caregiver was changed.")
say("Rollback: turn the switch on (Owners Hub Admin page, Auto-reply to a new-client ask), or Claude redeploys the previous coverage-reply.")
done(0 if not fails else 8)
