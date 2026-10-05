#!/usr/bin/env python3
# 458 · THE STEP 1 APPLICATION ON THEIR PROFILE + BEEF IT UP. Samantha, 2026-10-05: "can you pull 'step 1 application' in from
# their GHL account and save it into their profiles" (she approved what to keep: "yes build it"); "I wanted ai to help beef up
# the profiles a bit" (office panel; their words + application).
#   SQL: caregiver_application_facts (office staff read; only the server writes; the public nothing).
#   step1-import (new, owner key only): reads each caregiver's "Upload Step 1 Application Packet" PDF from GoHighLevel and keeps
#     ONLY the approved details (never anything private; the PDF is not copied).
#   caregiver-profile: Beef it up ('enhance', uses their Step 1 details), and the AI draft fixed (it sent a setting this AI model
#     refuses, so every new-hire draft was failing).
# Part 1 read only. Part 2 install. Part 3: a practice read of a few PDFs (counts only, nothing saved); you type yes; then every
# caregiver's Step 1 application is read and saved. Nothing is texted or emailed.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil, time
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
HUB_REF = "zngsgedlsxinbygwmxwn"
HUB = os.environ["SB_REPO"]; HUB_BASE = os.environ.get("SB_BASE", "")
HUB_SHAS = json.loads(os.environ["SB_SHAS"])
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB_REF}.supabase.co")
FNS = ["caregiver-profile", "step1-import"]
SQLFILE = "caregiver_application_facts_458.sql"
ASK = os.environ.get("SB_ASK", "1") == "1"
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
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-458/1.0"}, **(headers or {})))
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
    tmp = tempfile.mkdtemp(prefix="s1458-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
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
def history_shas(root, rel):
    """every version of one file ever committed: {sha: short commit}"""
    out = {}
    for c in git(root, "log", "--format=%h", "--", rel).stdout.decode().split():
        b = git(root, "show", f"{c}:{rel}")
        if b.returncode == 0: out.setdefault(shab(b.stdout), c)
    return out
OLDER = {}
# 452b (2026-10-05): she looked at the live profile-polish. It was an unsaved earlier draft of the instructions for the
# unused "ask a question" mode; nothing worth keeping. SB_LIVE_OK = {fn: fingerprint (sha256 prefix)} accepts exactly
# that copy; any other unknown copy still stops everything.
LIVE_OK = json.loads(os.environ.get("SB_LIVE_OK") or "{}")
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
    # 452 (first run stopped here): live can be an OLDER committed version that was never redeployed. That is still a
    # known build, so it may be replaced; a version that was never committed (a hand edit) still stops everything.
    hits = [history_shas(root, k).get(live.get(k, "")) for k in nd]
    if all(hits): OLDER[fn] = ", ".join(sorted(set(hits))); return "older", vj
    want = str(LIVE_OK.get(fn, ""))
    if len(want) >= 12 and all(live.get(k, "").startswith(want) if k.endswith(f"/{fn}/index.ts") else live.get(k) == base_sha(root, base, k) for k in nd): return "seen", vj
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


say("458 · THE STEP 1 APPLICATION ON THEIR PROFILE + BEEF IT UP"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
reviewed(HUB, HUB_BASE, HUB_SHAS, "the Hub server", extra=[(SQLFILE, os.environ.get("SB_SQL_SHA", ""))])
pinned = {pinpath(k) for k in HUB_SHAS}
for fn in FNS:
    other = sorted(k for k in need(HUB, fn) if k not in pinned and base_sha(HUB, HUB_BASE, k) != sha(os.path.join(HUB, k)))
    if other: bad(f"other changes merged since the review touch {fn} ({', '.join(other)[:200]}). Ask Claude to refresh 458."); say("  STOP. Nothing was run."); done(2)
say("  ✓ the importer, the profile helper and the new table are the reviewed build")
ST = {}
for fn in FNS:
    st, vj = state(HUB_REF, HUB, HUB_BASE, fn, pinned); ST[fn] = (st, vj)
    okst = ("new", "base", "this", "older") if fn == "step1-import" else ("base", "this", "older")
    if st not in okst: bad(f"the live {fn} isn't what this was built on ({st}). Nothing was changed. Tell Claude."); done(3)
    say(f"  ✓ {fn}: " + {"new": "is new", "base": "live matches GitHub", "this": "already has this build (an earlier run)", "older": f"live is an older GitHub version (commit {OLDER.get(fn)})"}[st])
NODE = shutil.which("node") or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.path.exists(p)), "")
if NODE:
    for t in ("step1_import_458_test.mjs", "beef_457_test.mjs", "hide_455_test.mjs", "profile_catchup_452_test.mjs", "caregiver_profile_test.mjs", "caregiver_profile_2b_test.mjs"):
        p = subprocess.run([NODE, t], cwd=HUB, capture_output=True, text=True)
        last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
        if p.returncode != 0 or re.search(r"^FAIL", p.stdout, re.M): bad(f"{t} failed: {last}"); say("  STOP. Nothing was changed."); done(2)
        say(f"  ✓ {t}: {last.strip()} (fake data only)")
have = secrets(HUB_REF)
if not ({"GHL_TOKEN", "GHL_API_KEY"} & have) or "GHL_LOCATION_ID" not in have or "ANTHROPIC_API_KEY" not in have:
    bad("the Hub is missing its GoHighLevel or AI key. Nothing was changed. Tell Claude."); done(3)
say("  ✓ the Hub has its GoHighLevel and AI keys")
K = keys(HUB_REF); ANON, SERVICE = K.get("anon", ""), K.get("service_role", ""); HIDE += [ANON, SERVICE]
if not ANON or not SERVICE: bad("couldn't read the Hub's keys. Nothing was changed."); done(3)

say(); say("PART 2 · CHANGE")
ok, r = sql(open(os.path.join(HUB, SQLFILE)).read())
ok2, g = sql("select grantee, string_agg(privilege_type, ',' order by privilege_type) as p from information_schema.role_table_grants where table_schema = 'public' and table_name = 'caregiver_application_facts' and grantee in ('anon', 'authenticated') group by grantee")
G = {x["grantee"]: x["p"] for x in (g or [])} if ok2 else {}
if not ok: bad(f"the new table didn't go in ({str(r)[:160]})")
else:
    chk(G.get("authenticated") == "SELECT" and "anon" not in G, f"the new table is there: office staff may read it, only the server writes, the public nothing (staff: {G.get('authenticated') or 'nothing'}; public: {G.get('anon') or 'nothing'})")
if fails: say("  STOP. Nothing else was changed. Tell Claude."); done(5)
for fn in FNS:
    st, vj = ST[fn]
    if st == "this": say(f"  ✓ {fn} already had it"); continue
    if not deploy(HUB_REF, HUB, fn, True if st == "new" else vj, "Hub"): say("  STOP. Tell Claude. (Anything above this line is in; the rest is unchanged.)"); done(6)

say(); say("PART 3 · PROOF, THEN READING THE STEP 1 APPLICATIONS")
for fn in FNS:
    okd, live = live_files(HUB_REF, fn)
    chk(okd and all(k in live and live[k] == sha(os.path.join(HUB, k)) for k in need(HUB, fn)), f"{fn}: the live copy is exactly the reviewed build")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
URL = f"{FNB}/functions/v1/step1-import"
A = {"Authorization": "Bearer " + ANON, "apikey": ANON, "Content-Type": "application/json"}
S = {"Authorization": "Bearer " + SERVICE, "apikey": SERVICE, "Content-Type": "application/json"}
s, b = http("POST", URL, {"mode": "live"}, A); chk(s == 401, f"the importer refuses anyone but the owner ({s})")
if fails: say("  STOP. Tell Claude."); done(7)
def batch(mode, offset):
    s, b = http("POST", URL, {"mode": mode, "offset": offset, "limit": 1}, S, timeout=300)
    try: j = json.loads(b) if s == 200 else {}
    except Exception: j = {}
    return s, j
def show(p):
    f = p.get("found") or {}; sh = p.get("shape") or {}
    return (f"{p.get('who')}: {p.get('state')}" + (f" (their words {f.get('own_words',0)}/5 · jobs {f.get('jobs',0)} · matching {f.get('matching',0)} · availability {f.get('availability',0)} · favorites {f.get('favorites',0)})" if f else "")
            + (f" [reply: {sh.get('blocks')} · {sh.get('chars')} characters · {sh.get('out_tokens')} tokens · stopped: {sh.get('stop')} · JSON: {'yes' if sh.get('parsed') else 'no'} · keys: {sh.get('keys') or '-'}]" if sh else ""))
say("  Practice read (nothing saved; counts only):")
off, seen, tries = 0, 0, 0
tried = 0
while off is not None and tried < 2 and tries < 14:
    s, j = batch("practice", off); tries += 1
    if s != 200 or not j.get("ok"): bad(f"the practice read didn't answer ({s}): {str(j.get('error', ''))[:160]}"); break
    for p in j.get("people", []):
        say("    " + show(p))
        if p.get("shape"): tried += 1
        if p.get("state") == "would save": seen += 1      # 458b: only a read that found details counts (the first run counted empty ones)
    off = j.get("next")
if fails or not seen: say("  STOP before saving anything. Tell Claude." if fails else "  ✗ the practice read found no details in the PDFs it read, so nothing will be saved. Tell Claude (the [reply: ...] lines say why)."); done(8)
if ASK:
    try: a = input("  The practice read worked. Read and save every caregiver's Step 1 application now (it takes a while)? Type yes and press Enter: ").strip().lower()
    except EOFError: a = ""
    if a != "yes": say("  · you didn't type yes, so nothing was saved. Run this again any time."); done(0)
say("  Reading every caregiver's Step 1 application (one at a time):")
off, tally = 0, {}
while off is not None:
    s, j = batch("live", off)
    if s != 200 or not j.get("ok"): bad(f"stopped at caregiver {off + 1} ({s}): {str(j.get('error', ''))[:160]}. Run this again to carry on; done ones are skipped."); break
    for p in j.get("people", []):
        st = str(p.get("state", "")); key = "saved" if st == "saved" else "already read" if st == "already read" else st.split(" (")[0]
        if st.startswith("read, but nothing came out"): say("    " + show(p))
        tally[key] = tally.get(key, 0) + 1
        if st == "saved" or st.startswith(("failed", "not saved", "the AI could not", "not read")): say("    " + show(p))
    off = j.get("next")
say("  Summary: " + ", ".join(f"{k} {v}" for k, v in sorted(tally.items(), key=lambda kv: -kv[1])))
ok, c = sql("select count(*)::int as n from public.caregiver_application_facts")
chk(ok and c and c[0]["n"] >= tally.get("saved", 0), f"{c[0]['n'] if ok and c else '?'} caregivers now have their Step 1 application on their profile")
say()
say("RESULT: " + ("DONE · Next: Claude merges the Hub. Then each caregiver's page (Hiring & Experience) shows \"From their Step 1 application\", and their Caregiver profile has \"Beef it up with AI\"." if not fails else "PARTLY DONE · the ✗ lines above need Claude. Running it again carries on where it stopped."))
say("Nothing was texted or emailed. Only the approved details were kept; the PDFs stay in GoHighLevel.")
done(0 if not fails else 8)
