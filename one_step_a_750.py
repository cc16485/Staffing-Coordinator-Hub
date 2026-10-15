#!/usr/bin/env python3
# 750 · ONE NEXT STEP, ONE START DATE, ONE "CARE BEGAN". CRM plan step A (Samantha 2026-10-15, "yes to all 10").
#   client-journey: the target start comes only from the Start Contract (the journey keeps a copy; set_start is refused);
#   the My Work card asks LeadRules.oneNext (a due promise to the family first); a first shift needs a clock-in AND a
#   clock-out. call-disposition: a call closed as Lost gets a reason (Referred to Caring CDS; Not interested = No longer
#   needs care). The shared lead-rules.js changed, so the six functions that carry it are deployed together. In the
#   database: care_began_for_episode stops counting the First shift checkbox. Never texts or emails anyone.
# Part 1 (read only): the reviewed build; the tests pass here; each function is main's own code (only its copy of the
#   shared lead rules may be older); the care-began rule is the one before 750 (or already 750); someone in the office can
#   record a Start Contract. Part 2: the six functions deployed, then the database rule. Part 3 (proof).
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
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-750/1.0"}, **(headers or {})))
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
pinpath = lambda k: (f"supabase/functions/{k}" if re.search(r"\.(js|ts)$", k) else f"supabase/functions/{k}.ts") if k.startswith("_shared/") else f"supabase/functions/{k}/index.ts"
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
    tmp = tempfile.mkdtemp(prefix="cl750-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
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
FNS = {"client-journey": None, "call-disposition": None, "cc-booking": None, "lead-intake": None, "lead-followup": None, "lead-watch": None}   # each keeps its own gateway setting
SHARED = "supabase/functions/_shared/lead-rules.js"
SQLF = "care-began-one-rule-750.sql"
TESTS = ["client_journey_test.mjs", "care_test.mjs", "care_began_750_test.mjs"]
def history(root, rel):
    """every version of a file in git history (sha256 of its bytes)"""
    out = set()
    for c in git(root, "log", "--format=%H", "--", rel).stdout.decode().split():
        b = git(root, "show", f"{c}:{rel}")
        if b.returncode == 0: out.add(shab(b.stdout))
    return out
HIST = None
# 2026-10-15 first run stopped here: call-disposition (and the other lead functions) carry shared helper files from before
# main's latest (an earlier lead-rules.js, the events.ts from before Slice 1, the opt-out guard from before the practice-address
# rule, older sender name lists). Claude downloaded and read each one: every line only they have is older code main replaced.
# These exact files (by fingerprint) count as "the build before this change"; deploying brings main's. Anything else stops.
KNOWN_OLD = {
    "328cf9ed7a3cd83804809b54fe517a8ed0fb4f3b5a9f88c92aa60bfcba8069ad": "the lead rules from before 2026-10-07",
    "9ec24497cddd3fbce4c60d2e114d085aac3f01cb2a908a83190d9a98314bdad6": "an earlier lead rules",
    "4478bb00e752515489f0fda83ad006c5f4b5f566d84896318635764f961bfad8": "an earlier lead rules",
    "ddd8d4a7eb08af0e9c8c3eab8283208856ab8edfbcd8f2a3bde369dc9323ab36": "an earlier lead rules",
    "573379c4abb9a5f44e3bf49274d86713a6bf28a1974833e2478e78c54c8cdffe": "the activity record from before Slice 1 (jobs signed 'Cara')",
    "d027aa1cedd25bf7cfa2e82cbb26f724041a10c403172ebfd02e47ee9a357fee": "the opt-out check from before the practice-address guard",
    "d79537111405b27bf3a424b1ac576fb836a5f276f99f513fdd88d0b3b10b886b": "an earlier list of sender names",
    "36966f986cac011e119873b18b9c3ebe4f76f1f18e07af8e814eaad6a34f56b5": "an earlier list of sender names",
    "6f0fe28bf97b518ae57060bbba67e2154e15ccc89d3d8b41a1247fa07b8d8ba4": "an earlier list of activity words",
    "17bf0e843bf615545fdb6422262cf2fbbd8d19142caabf890f30ad96fd316416": "an earlier list of senders and when they may send",
}
OLD_SEEN = {}
def state750(ref, root, base, fn):
    """'this' | 'base' (main's own code; its shared lead rules may be any earlier version) | 'other' | 'new' | 'unreadable'"""
    s, m = fmeta(ref, fn)
    if s == 404: return "new", None
    vj = (m or {}).get("verify_jwt")
    okd, live = live_files(ref, fn)
    if not okd or not isinstance(vj, bool): return "unreadable", vj
    nd = need(root, fn)
    if all(k in live and live[k] == sha(os.path.join(root, k)) for k in nd): return "this", vj
    for k in nd:
        if k == SHARED and k in live and live[k] in HIST: continue
        if k in live and live[k] == base_sha(root, base, k): continue
        if k.startswith("supabase/functions/_shared/") and k in live and live[k] in KNOWN_OLD:
            OLD_SEEN.setdefault(fn, []).append(KNOWN_OLD[live[k]]); continue
        return "other", vj
    return "base", vj
norm = lambda t: re.sub(r"\s+", " ", t or "").strip()
def fnbody(path):
    t = open(path).read(); a = t.index("$f$", t.index("create or replace function public.care_began_for_episode")) + 3
    return t[a:t.index("end $f$", a)] + "end "

say("750 · ONE NEXT STEP, ONE START DATE, ONE \"CARE BEGAN\""); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
reviewed(HUB, HUB_BASE, HUB_SHAS, "the Hub server", extra=[(SQLF, os.environ.get("SB_SQL_SHA", ""))])
pinned = {pinpath(k) for k in HUB_SHAS}
for fn in FNS:
    other = sorted(k for k in need(HUB, fn) if k not in pinned and base_sha(HUB, HUB_BASE, k) != sha(os.path.join(HUB, k)))
    if other: bad(f"other changes merged since the review touch {fn} ({', '.join(other)[:200]}). Ask Claude to refresh 750."); say("  STOP. Nothing was run."); done(2)
say("  ✓ the six functions and the database rule are the reviewed build")
NODE = shutil.which("node") or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.path.exists(p)), "")
PGL = os.environ.get("PGLITE") or "/Users/samantha/Claude/Projects/.pglite/node_modules/@electric-sql/pglite/dist/index.js"
if NODE:
    env = dict(os.environ)
    if os.path.exists(PGL): env["PGLITE"] = PGL
    for t in TESTS:
        if t == "care_began_750_test.mjs" and "PGLITE" not in env: say(f"  · {t}: the practice database is not on this Mac, so it was not re-run here (it passed when built)"); continue
        p = subprocess.run([NODE, t], cwd=HUB, capture_output=True, text=True, env=env)
        last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
        if p.returncode != 0: bad(f"{t} failed: {last}"); say("  STOP. Nothing was changed."); done(2)
        say(f"  ✓ {t}: {last.strip()}")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
HIST = history(HUB, SHARED)
STATES = {}
for fn in FNS:
    st, vj = state750(HUB_REF, HUB, HUB_BASE, fn)
    if st not in ("base", "this"): bad(f"{fn} on the server is not what 750 expects ({st}). Nothing was changed. Tell Claude."); done(3)
    STATES[fn] = (st, vj); say(f"  ✓ {fn}: " + {"this": "already this build", "base": "main's build (this brings the new shared lead rules)"}[st])
    if OLD_SEEN.get(fn): say("      it also had older shared helpers, now brought up to main's: " + "; ".join(sorted(set(OLD_SEEN[fn]))))
ok, r = sql("select prosrc, prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'care_began_for_episode'")
if not ok or len(r) != 1: bad("couldn't read the care-began rule. Nothing was changed."); done(3)
live_src = norm(r[0]["prosrc"]); OLD = norm(fnbody(os.path.join(HUB, "client-fact-care-began-fix.sql"))); NEW = norm(fnbody(os.path.join(HUB, SQLF)))
SQL_STATE = "this" if live_src == NEW else "base" if live_src == OLD else "other"
if SQL_STATE == "other": bad("the live care-began rule is not the one 750 replaces. Nothing was changed. Tell Claude."); done(3)
say("  ✓ the care-began rule: " + ("already 750" if SQL_STATE == "this" else "the one before 750"))
ok, seats = sql("select count(distinct lower(email))::int as n from public.journey_seat_member where seat in ('client_intake','owner_decision')")
if not ok or not seats: bad("couldn't read who can record a Start Contract. Nothing was changed."); done(3)
if seats[0]["n"] < 1:
    bad("nobody in the office can record a Start Contract (no Journey seat), so nobody could set a start date after this. Nothing was changed. Tell Claude."); done(3)
say(f"  ✓ {seats[0]['n']} office person/people can record a Start Contract (and with it the start date)")
K = keys(HUB_REF); ANON = K.get("anon", ""); HIDE += [ANON, K.get("service_role", "")]
if not ANON: bad("couldn't read the Hub's public key. Nothing was changed."); done(3)

say(); say("PART 2 · CHANGE")
for fn, want in FNS.items():
    st, vj = STATES[fn]
    if st == "this": say(f"  ✓ {fn} already had it"); continue
    if not deploy(HUB_REF, HUB, fn, want if want is not None else vj, "Hub"): say("  STOP. Tell Claude."); done(6)
if SQL_STATE == "this": say("  ✓ the care-began rule already had it")
else:
    ok, r = sql(open(os.path.join(HUB, SQLF)).read())
    if not ok: bad("the care-began rule was not changed (nothing in it was saved): " + str(r)[:200]); say("  STOP. Tell Claude."); done(6)
    say("  ✓ the care-began rule: AxisCare's first completed visit or a hand record (the checkbox no longer counts)")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))

say(); say("PART 3 · PROOF")
for fn in FNS:
    okd, live = live_files(HUB_REF, fn)
    chk(okd and all(k in live and live[k] == sha(os.path.join(HUB, k)) for k in need(HUB, fn)), f"{fn}: the live copy is exactly the reviewed build")
ok, r = sql("select prosrc, has_function_privilege('authenticated', p.oid, 'execute') as browser from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'care_began_for_episode'")
chk(ok and len(r) == 1 and norm(r[0]["prosrc"]) == NEW and r[0]["browser"] is False, "the care-began rule is 750's, and a browser still can't run it")
s1 = http("POST", f"{FNB}/functions/v1/client-journey", {"action": "get", "lead_id": "proof750"}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
chk(s1 in (401, 403), f"client-journey refuses the public key ({s1})")
say()
say("RESULT: " + ("DONE · the server is ready. Next: merge the Hub PR." if not fails else "PARTLY DONE · the ✗ lines above need Claude."))
say("Nothing was texted or emailed. No lead or journey was changed by this step (749 found no start dates or first shifts to move).")
say("Rollback: Claude redeploys the six functions from the build before 750 and re-runs client-fact-care-began-fix.sql.")
done(0 if not fails else 8)
