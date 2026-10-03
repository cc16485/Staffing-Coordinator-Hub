#!/usr/bin/env python3
# 433 · CALL RINGS YOUR PHONE FIRST (GoHighLevel call bridge). Samantha 2026-10-03, option 1: no GoHighLevel web link
# opens the LeadConnector app (431 opened the browser on her phone), so each Call tap assigns the GoHighLevel contact to
# the staff member who tapped and tags it hub-call-bridge; her GoHighLevel workflow "Hub call bridge" rings that
# person's phone and connects them from the business number on a key press ("assignment changes with each call",
# accepted).
# The Hub project (zngsgedlsxinbygwmxwn) only. What changes (code only, no database change, no setting written):
#   _shared/ghl-call-bridge.ts (new): the bridge (30-second limit per caller, the caller's GoHighLevel user, the contact
#     found exactly as 431, workflow check, record in op_events, then PUT assignedTo only, then the tag).
#   ghl-call-link: action 'bridge' (signed-in office staff only; the server key can never bridge) and 'setup' (GET only).
#   clockin-alert, late-alert: action 'bridge' {target}, the admin named in the sealed link.
# Part 1 (read only): the reviewed builds (pinned), the tests pass here, the GHL location is set.
# Part 2: each of the three redeployed only if its live copy is today's GitHub main (or already this build), keeping its
#   gateway setting.
# Part 3 (proof, NOTHING is sent and NO call is started): every live copy is the reviewed build; ghl-call-link refuses
#   the public key, a made-up sign-in, and the server key asking for a bridge; clockin-alert and late-alert refuse a
#   bridge with no link and with a made-up link. Then ghl-call-link 'setup' with the server key (GoHighLevel GETs only):
#   is the "Hub call bridge" workflow published, can the token list GoHighLevel's users, how many office staff map.
#   (That check keeps GoHighLevel's user list, email to user id, in app_data ghl_users, as every call does.)
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
REF = "zngsgedlsxinbygwmxwn"
ROOT = os.environ["SB_REPO"]; BASE = os.environ.get("SB_BASE", "")
SHAS = json.loads(os.environ["SB_SHAS"])
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FIRST = ["ghl-call-link", "clockin-alert", "late-alert"]
NEW = set()                                # all three exist since 431
TESTS = ["call_bridge_433_test.mjs", "ghl_call_link_431_test.mjs", "c1_missed_clockin_test.mjs", "late_l1_test.mjs", "late_watch_test.mjs",
         "call_late_432_test.mjs", "quiet_hours_425_test.mjs", "evv_prefill_427_test.mjs", "evv_signature_429_test.mjs"]
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
def http(method, url, body=None, headers=None, timeout=150):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-callbridge433/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, f"HTTP {s}: {b[:300]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:200]
def fmeta(fn):
    s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{fn}", headers=MG())
    try: return s, (json.loads(b) if s == 200 else None)
    except Exception: return s, None
def keys():
    """The project's keys. Lesson from 412: ask with ?reveal=true first, then without it. A value that isn't a usable
    key counts as missing."""
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_publishable_") or v.startswith("sb_secret_")) and "·" not in v and "*" not in v
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
shab = lambda b: hashlib.sha256(b).hexdigest()
sha = lambda p: shab(open(p, "rb").read())
def git(*a): return subprocess.run(["git", *a], cwd=ROOT, capture_output=True)
def chk(good, msg): (say if good else bad)(("  ✓ " if good else "") + msg)

def deps(path, seen):
    if path in seen or not os.path.exists(path): return
    seen.add(path)
    for m in re.findall(r"""from\s+['"](\.{1,2}/[^'"]+)['"]|import\s+['"](\.{1,2}/[^'"]+)['"]""", open(path).read()):
        deps(os.path.normpath(os.path.join(os.path.dirname(path), m[0] or m[1])), seen)
pinpath = lambda k: f"supabase/functions/{k}.ts" if k.startswith("_shared/") else f"supabase/functions/{k}/index.ts"
def deps_of(fn):
    s = set(); deps(os.path.join(ROOT, f"supabase/functions/{fn}/index.ts"), s)
    return {os.path.relpath(x, ROOT).replace(os.sep, "/") for x in s}

def reviewed():
    if not BASE or git("cat-file", "-e", BASE + "^{commit}").returncode != 0: bad("the reviewed starting point isn't in this folder's history"); say("  STOP. Nothing was run."); done(2)
    changed = sorted(x for x in git("diff", "--name-only", BASE, "HEAD", "--", "supabase/functions").stdout.decode().split() if x.endswith(".ts") and os.path.exists(os.path.join(ROOT, x)))
    pinned = {pinpath(k): v for k, v in SHAS.items()}
    if not pinned or not set(pinned) <= set(changed): bad(f"the reviewed files aren't all changed here ({', '.join(sorted(set(pinned) - set(changed)))[:200]})"); say("  STOP. Nothing was run."); done(2)
    for rel, want in pinned.items():
        if sha(os.path.join(ROOT, rel)) != want: bad(f"{rel.split('functions/')[1]} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
    fnroot = os.path.join(ROOT, "supabase/functions"); users = []
    for fn in sorted(os.listdir(fnroot)):
        p = os.path.join(fnroot, fn, "index.ts")
        if fn.startswith("_") or not os.path.exists(p): continue
        used = {os.path.relpath(x, ROOT).replace(os.sep, "/") for x in (lambda s: (deps(p, s), s)[1])(set())}
        if used & set(pinned): users.append((fn, used))
    # Another change merged since (another branch): fine only when none of the functions this updates uses it.
    extra = sorted(set(changed) - set(pinned))
    touch = sorted({e for e in extra for fn, used in users if e in used})
    if touch: bad(f"other changes merged since the review touch these functions ({', '.join(touch)[:200]}). Ask Claude to refresh 433."); say("  STOP. Nothing was run."); done(2)
    names = [fn for fn, _ in users]
    say(f"  ✓ the {len(pinned)} changed file(s) are the reviewed build" + (f" (other merged changes don't touch them: {', '.join(e.split('functions/')[1] for e in extra)[:160]})" if extra else ""))
    say(f"  ✓ functions to update ({len(names)}): {', '.join(names)}")
    return [f for f in FIRST if f in names] + [f for f in names if f not in FIRST]

def live_files(fn):
    tmp = tempfile.mkdtemp(prefix="cb433-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
    d = subprocess.run([SUPA, "functions", "download", fn, "--project-ref", REF, "--use-api"], cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    live = {}
    for root, _, files in os.walk(tmp):
        for f in files:
            lp = os.path.join(root, f).replace(os.sep, "/")
            if "/functions/" in lp: live["supabase/functions/" + lp.split("/functions/", 1)[1]] = sha(lp)
    shutil.rmtree(tmp, ignore_errors=True)
    return d.returncode == 0, live

def base_sha(rel):
    b = git("show", f"{BASE}:{rel}")
    return shab(b.stdout) if b.returncode == 0 else None

def is_reviewed_live(fn):
    okd, live = live_files(fn)
    if not okd: return False, "couldn't read the live copy"
    need = deps_of(fn)
    missing = [k for k in need if k not in live]
    if missing: return False, "live copy is missing " + ", ".join(sorted(k.split("functions/", 1)[1] for k in missing))
    off = [k for k in need if live[k] != sha(os.path.join(ROOT, k))]
    return (not off), ("" if not off else "live differs in " + ", ".join(sorted(k.split("functions/", 1)[1] for k in off)))

def deploy(fn):
    sM, m = fmeta(fn)
    if sM == 404 and fn in NEW:
        p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"], cwd=ROOT, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
        good, _ = is_reviewed_live(fn)
        if not good: bad(f"{fn} didn't deploy: " + (p.stderr or p.stdout)[-200:]); return False
        sN, mN = fmeta(fn)
        if (mN or {}).get("verify_jwt") is not True:
            http("PATCH", f"{API}/v1/projects/{REF}/functions/{fn}", {"verify_jwt": True}, MG()); sN, mN = fmeta(fn)
            if (mN or {}).get("verify_jwt") is not True: bad(f"{fn}: its gateway sign-in check is not on. Tell Claude."); return False
        say(f"  ✓ {fn} created, version {(mN or {}).get('version', '?')} (gateway sign-in check on; it also checks the staff sign-in itself)")
        return True
    if sM == 404: bad(f"{fn} is not deployed. Tell Claude."); return False
    if fn in NEW and not is_reviewed_live(fn)[0]:
        bad(f"{fn} already exists and is not this build (unexpected), NOT changed. Tell Claude."); return False
    vj = (m or {}).get("verify_jwt")
    if not isinstance(vj, bool): bad(f"{fn}: couldn't read its gateway setting, NOT changed"); return False
    okd, live = live_files(fn)
    mine = f"supabase/functions/{fn}/index.ts"
    if not okd or mine not in live: bad(f"{fn}: couldn't read its live copy, NOT changed"); return False
    need = deps_of(fn)
    if all(k in live and live[k] == sha(os.path.join(ROOT, k)) for k in need):
        say(f"  ✓ {fn} already had it"); return True
    if live[mine] != base_sha(mine) and live[mine] != sha(os.path.join(ROOT, mine)):
        bad(f"{fn}: its live code is not today's GitHub main (was something else deployed?), NOT changed"); return False
    pinned = {pinpath(k) for k in SHAS}
    other = [k.split("supabase/functions/", 1)[1] for k in need if k != mine and k not in pinned and (k not in live or live[k] != sha(os.path.join(ROOT, k)))]
    if other: bad(f"{fn}: live shared code differs from GitHub ({', '.join(sorted(other))[:160]}), NOT changed"); return False
    odd = [k.split("supabase/functions/", 1)[1] for k in need if k != mine and k in pinned and k in live and live[k] not in (base_sha(k), sha(os.path.join(ROOT, k)))]
    if odd: bad(f"{fn}: its live {', '.join(sorted(odd))} is neither today's GitHub main nor this build, NOT changed"); return False
    p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"] + ([] if vj else ["--no-verify-jwt"]),
                       cwd=ROOT, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    if p.returncode != 0:
        # Lesson from 394: a deploy can answer 500 'internal error' and still have gone through. Look before calling it failed.
        good, _ = is_reviewed_live(fn)
        if not good: bad(f"{fn} didn't deploy: " + (p.stderr or p.stdout)[-200:]); return False
        say(f"  · {fn}: the deploy answered with an error, but the live copy IS the reviewed build")
    sN, mN = fmeta(fn)
    if (mN or {}).get("verify_jwt") != vj:
        http("PATCH", f"{API}/v1/projects/{REF}/functions/{fn}", {"verify_jwt": vj}, MG()); sN, mN = fmeta(fn)
        if (mN or {}).get("verify_jwt") != vj: bad(f"{fn}: its gateway setting changed and couldn't be put back. Tell Claude."); return False
    say(f"  ✓ {fn} deployed, now version {(mN or {}).get('version', '?')} (was {(m or {}).get('version', '?')}; gateway sign-in check kept {'on' if vj else 'off'})")
    return True


say("433 · CALL RINGS YOUR PHONE FIRST (GOHIGHLEVEL CALL BRIDGE)"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
order = reviewed()
NODE = shutil.which("node") or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.path.exists(p)), "")
if NODE:
    for t in TESTS:
        p = subprocess.run([NODE, t], cwd=ROOT, capture_output=True, text=True)
        last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
        if p.returncode != 0 or "FAIL" in last or "✗" in p.stdout or re.search(r"^FAIL", p.stdout, re.M): bad(f"{t} failed: {last}"); say("  STOP. Nothing was run."); done(2)
        say(f"  ✓ {t}: {last.strip()} (run here, against fakes; nothing sent)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
s, b = http("GET", f"{API}/v1/projects/{REF}/secrets", headers=MG())
try: sec = {x.get("name"): str(x.get("value") or "") for x in json.loads(b)} if s == 200 else {}
except Exception: sec = {}
if not sec: bad("couldn't read the function secret names. Nothing was changed."); done(3)
if "GHL_LOCATION_ID" not in sec or not ({"GHL_TOKEN", "GHL_API_KEY"} & set(sec)): bad("the GoHighLevel location or token isn't set on this project. Nothing was changed."); done(3)
CC_LOC = "Recp0AhyMh8lrtKJ9kaj"
if sec["GHL_LOCATION_ID"] in (CC_LOC, hashlib.sha256(CC_LOC.encode()).hexdigest()): say("  ✓ the GoHighLevel location is Caring Companions (" + CC_LOC + ")")
else: say("  · the GoHighLevel location is set (Supabase only shows a fingerprint, so which one couldn't be confirmed here)")
K = keys(); ANON, SERVICE = K.get("anon", ""), K.get("service_role", "")
HIDE += [ANON, SERVICE]
if not ANON: bad("couldn't read the project's public key. Nothing was changed."); done(3)
say("  ✓ read the project's keys (kept in memory only, never printed)")

say(); say(f"PART 2 · UPDATE {len(order)} FUNCTIONS (each only if its live copy is today's GitHub main)")
went = [fn for fn in order if deploy(fn)]

say(); say("PART 3 · PROOF (nothing is sent and no call is started; GoHighLevel is only read)")
for fn in went:
    good, why = is_reviewed_live(fn)
    chk(good, f"{fn}: the live copy is exactly the reviewed build" + ("" if good else f" ({why})"))
FN = lambda n: f"{FNB}/functions/v1/{n}"
H = {"Authorization": "Bearer " + ANON, "apikey": ANON}
NOBODY = {"action": "bridge", "phone": "4175550000"}
s1, _ = http("POST", FN("ghl-call-link"), NOBODY, H)
chk(s1 == 401, f"ghl-call-link bridge with the public key (no staff sign-in) is refused ({s1})")
s2, _ = http("POST", FN("ghl-call-link"), NOBODY, {"Authorization": "Bearer not-a-real-sign-in", "apikey": ANON})
chk(s2 == 401, f"ghl-call-link bridge with a made-up sign-in is refused ({s2})")
if SERVICE:
    s3, b3 = http("POST", FN("ghl-call-link"), NOBODY, {"Authorization": "Bearer " + SERVICE, "apikey": ANON})
    chk(s3 == 403 and "person tapping Call" in b3, f"ghl-call-link refuses a bridge from the server key: nothing automatic can start a call ({s3})")
else: bad("couldn't read the server key, so the 'nothing automatic can call' proof and the setup check were skipped")
for fn, made_up in (("clockin-alert", {"c": "tk_made_up", "a": "0" * 16, "e": 4102444800, "t": "x" * 43, "action": "bridge", "target": "client"}),
                    ("late-alert", {"c": "ln_made_up", "a": "0" * 16, "e": 4102444800, "t": "x" * 43, "action": "bridge", "target": "client"})):
    s4, _ = http("POST", FN(fn), {"action": "bridge", "target": "client"}, H)
    s5, _ = http("POST", FN(fn), made_up, H)
    chk(s4 in (401, 403) and s5 in (401, 403), f"{fn}: a bridge with no link ({s4}) and with a made-up link ({s5}) is refused before anything is read")

say(); say("GOHIGHLEVEL SETUP CHECK (GETs only: the workflow list and the user list)")
setup = {}
if SERVICE and "ghl-call-link" in went:
    s6, b6 = http("POST", FN("ghl-call-link"), {"action": "setup"}, {"Authorization": "Bearer " + SERVICE, "apikey": ANON})
    try: setup = json.loads(b6) if s6 == 200 else {}
    except Exception: setup = {}
    if not setup: bad(f"the setup check did not answer ({s6})")
if setup:
    wf = setup.get("workflow")
    say({"published": "  ✓ the GoHighLevel workflow \"Hub call bridge\" is published",
         "draft": "  · the workflow \"Hub call bridge\" is there but still a DRAFT: publish it before anyone taps Call",
         "missing": "  · there is NO workflow named \"Hub call bridge\" in GoHighLevel yet: build it (GHL-CALL-BRIDGE-SETUP.md) before anyone taps Call",
         "unknown": "  · GoHighLevel won't show its workflows to the Hub, so whether \"Hub call bridge\" is published can't be checked here: test one call"}.get(wf, f"  · workflow: {wf}"))
    ua = setup.get("users_api")
    say({"ok": f"  ✓ the GoHighLevel token CAN list users ({setup.get('users_count', 0)} users): staff link automatically by their email",
         "no_scope": "  · the GoHighLevel token can NOT list users: link each person by hand in Hub Settings, Calls (email = GoHighLevel user id)",
         "error": "  · GoHighLevel's user list could not be read just now (try Check the setup in Hub Settings, Calls later)"}.get(ua, f"  · users: {ua}"))
    say(f"  {setup.get('staff_linked', 0)} of {setup.get('staff_total', 0)} office staff (Coordinator staff list) are linked to a GoHighLevel user")
say()
ready = setup.get("workflow") in ("published", "unknown") and setup.get("staff_linked", 0) > 0
if fails: say("RESULT: PARTLY DONE · the ✗ lines above need Claude. A function not updated keeps its 431 behaviour.")
else: say("RESULT: DONE · the server side is live. " + ("GoHighLevel looks ready. " if ready else "BEFORE merging the Hub branch, finish the GoHighLevel setup (GHL-CALL-BRIDGE-SETUP.md) and run Hub Settings, Calls, Check the setup. ")
          + "Then merge the Hub branch ghl-call-bridge (cc-hub-live) and tap Call once on your phone: it should ring you from the office number.")
say("Nothing was texted, emailed or called by this installer, no GoHighLevel contact was created or changed, and no setting was changed.")
say("Rollback: Claude redeploys ghl-call-link, clockin-alert and late-alert from the GitHub commit before this one; no database change to undo.")
done(1 if fails else 0)
