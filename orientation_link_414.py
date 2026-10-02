#!/usr/bin/env python3
# 414 · REMOTE ORIENTATION 1b: "WELCOME CALL DONE – SEND ORIENTATION LINK". Samantha 2026-10-01: on that press the
# Training Platform finds the new hire in AxisCare NOW (read only, by phone or email, never by name, only when exactly
# one active caregiver "In Training" matches), saves them so their courses are assigned, links their offer and sends the
# training welcome. Not found: nothing is sent, the office is told to set In Training in AxisCare, and a card goes on
# Needs Attention. After 6pm the welcome waits for the 9am run. The 9am run uses the same send (same words, same rules,
# now also the application's "no texts" answer) and reports, once per person, what used to stop silently.
# Two projects, one Supabase access token (it is account-wide):
#   THE HUB (zngsgedlsxinbygwmxwn): outreach-check's report answer understands held:true (the Training Platform held a
#     message back itself), so the card gives the real reason instead of "GoHighLevel did not accept it".
#   THE TRAINING PLATFORM (rdqujxiycycwhskyvrwa): job-offer gains action 'orientation_link'; sync-axiscare's welcome is
#     the shared sendWelcome (new file _shared/welcome.ts). No database change.
# Part 1 (read only): reviewed builds (pinned) in both projects, the tests pass, the Training secrets the code needs are
#   there, a count of who the 9am run would welcome today.
# Part 2, in this order (each step only if the one before it worked): Hub outreach-check; Training job-offer +
#   sync-axiscare. Each function only if its live copy is known GitHub code, each keeping its own gateway setting.
# Part 3 (proof, NOTHING is sent and nothing is written): the live copies are now exactly the reviewed builds; the Hub
#   refuses a report without the server secret; job-offer refuses orientation_link without a Hub staff sign-in (no
#   sign-in, and a made-up one), so it never reaches AxisCare or GoHighLevel. The installer has no Hub staff sign-in,
#   so the full path is proved by the tests (fakes), not live.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
HUB, TP = "zngsgedlsxinbygwmxwn", "rdqujxiycycwhskyvrwa"
ROOTS = {HUB: os.environ["SB_HUB_ROOT"], TP: os.environ["SB_TR_ROOT"]}
BASES = {HUB: os.environ.get("SB_HUB_BASE", ""), TP: os.environ.get("SB_TR_BASE", "")}
SHAS = {HUB: json.loads(os.environ["SB_HUB_SHAS"]), TP: json.loads(os.environ["SB_TR_SHAS"])}
NAMES = {HUB: "Hub", TP: "Training"}
FNB = {HUB: os.environ.get("SB_HUB_FN_BASE", f"https://{HUB}.supabase.co"), TP: os.environ.get("SB_TR_FN_BASE", f"https://{TP}.supabase.co")}
WANT = {HUB: ["outreach-check"], TP: ["job-offer", "sync-axiscare"]}
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
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-orient414/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(ref, q):
    s, b = http("POST", f"{API}/v1/projects/{ref}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, f"HTTP {s}: {b[:300]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:200]
def fmeta(ref, fn):
    s, b = http("GET", f"{API}/v1/projects/{ref}/functions/{fn}", headers=MG())
    try: return s, (json.loads(b) if s == 200 else None)
    except Exception: return s, None
def keys(ref):
    """The project's keys. Lesson from 412: newer projects only give the real value with ?reveal=true, and some answer
    that with an error; ask with it first, then without it. A value that isn't a usable key counts as missing."""
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
def git(ref, *a): return subprocess.run(["git", *a], cwd=ROOTS[ref], capture_output=True)
def chk(good, msg): (say if good else bad)(("  ✓ " if good else "") + msg)

def deps(path, seen):
    if path in seen or not os.path.exists(path): return
    seen.add(path)
    for m in re.findall(r"""from\s+['"](\.{1,2}/[^'"]+)['"]|import\s+['"](\.{1,2}/[^'"]+)['"]""", open(path).read()):
        deps(os.path.normpath(os.path.join(os.path.dirname(path), m[0] or m[1])), seen)
HIST = {}
def history(ref, rel):  # every committed version of one file, so "known code" can be told from unknown
    k = (ref, rel)
    if k not in HIST:
        hs = set()
        for c in git(ref, "log", "--format=%H", "--", rel).stdout.decode().split():
            b = git(ref, "show", f"{c}:{rel}")
            if b.returncode == 0: hs.add(shab(b.stdout))
        if os.path.exists(os.path.join(ROOTS[ref], rel)): hs.add(sha(os.path.join(ROOTS[ref], rel)))
        HIST[k] = hs
    return HIST[k]
pinpath = lambda k: f"supabase/functions/{k}.ts" if k.startswith("_shared/") else f"supabase/functions/{k}/index.ts"

def reviewed(ref):
    """The changed function files since the reviewed starting point are exactly the pinned builds. Returns the
    functions that are or include a changed file."""
    R, BASE = ROOTS[ref], BASES[ref]
    if not BASE or git(ref, "cat-file", "-e", BASE + "^{commit}").returncode != 0: bad(f"{NAMES[ref]}: the reviewed starting point isn't in this folder's history"); say("  STOP. Nothing was run."); done(2)
    changed = sorted(x for x in git(ref, "diff", "--name-only", BASE, "HEAD", "--", "supabase/functions").stdout.decode().split() if x.endswith(".ts") and os.path.exists(os.path.join(R, x)))
    pinned = {pinpath(k): v for k, v in SHAS[ref].items()}
    if set(changed) != set(pinned): bad(f"{NAMES[ref]}: the list of changed files isn't the reviewed list ({', '.join(changed)[:200]})"); say("  STOP. Nothing was run."); done(2)
    for rel, want in pinned.items():
        if sha(os.path.join(R, rel)) != want: bad(f"{NAMES[ref]} {rel.split('functions/')[1]} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
    users = []
    fnroot = os.path.join(R, "supabase/functions")
    for fn in sorted(os.listdir(fnroot)):
        p = os.path.join(fnroot, fn, "index.ts")
        if fn.startswith("_") or not os.path.exists(p): continue
        s = set(); deps(p, s)
        if any(os.path.normpath(os.path.join(R, c)) in s for c in changed): users.append(fn)
    say(f"  ✓ {NAMES[ref]}: the {len(changed)} changed files are the reviewed builds; functions to update: {', '.join(users)}")
    return users

def live_files(ref, fn):
    tmp = tempfile.mkdtemp(prefix="ol414-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
    d = subprocess.run([SUPA, "functions", "download", fn, "--project-ref", ref, "--use-api"], cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    live = {}
    for root, _, files in os.walk(tmp):
        for f in files:
            lp = os.path.join(root, f).replace(os.sep, "/")
            if "/functions/" in lp: live["supabase/functions/" + lp.split("/functions/", 1)[1]] = sha(lp)
    shutil.rmtree(tmp, ignore_errors=True)
    return d.returncode == 0, live

def deploy(ref, users):
    """One function at a time; only if its live copy is known code; its gateway setting kept. Returns True if all went."""
    R = ROOTS[ref]; ok_all = True
    for fn in users:
        sM, m = fmeta(ref, fn)
        if sM == 404: bad(f"{NAMES[ref]} {fn} is not deployed there. Tell Claude."); ok_all = False; continue
        vj = (m or {}).get("verify_jwt")
        if not isinstance(vj, bool): bad(f"{NAMES[ref]} {fn}: couldn't read its gateway setting, NOT changed"); ok_all = False; continue
        okd, live = live_files(ref, fn)
        mine = f"supabase/functions/{fn}/index.ts"
        if not okd or mine not in live: bad(f"{NAMES[ref]} {fn}: couldn't read its live copy, NOT changed"); ok_all = False; continue
        if all(k in live and live[k] == sha(os.path.join(R, k)) for k in deps_of(ref, fn)):
            say(f"  ✓ {NAMES[ref]} {fn} already had it"); continue
        if live[mine] not in history(ref, mine): bad(f"{NAMES[ref]} {fn}: its live code is not a reviewed GitHub version, NOT changed"); ok_all = False; continue
        unknown = [k.split("supabase/functions/", 1)[1] for k, h in live.items() if k != mine and h not in history(ref, k)]
        if unknown: bad(f"{NAMES[ref]} {fn}: live code not in GitHub ({', '.join(sorted(unknown))[:160]}), NOT changed"); ok_all = False; continue
        p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", ref, "--use-api"] + ([] if vj else ["--no-verify-jwt"]),
                           cwd=R, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
        if p.returncode != 0: bad(f"{NAMES[ref]} {fn} didn't deploy: " + (p.stderr or p.stdout)[-200:]); ok_all = False; continue
        sN, mN = fmeta(ref, fn)
        if (mN or {}).get("verify_jwt") != vj:
            http("PATCH", f"{API}/v1/projects/{ref}/functions/{fn}", {"verify_jwt": vj}, MG()); sN, mN = fmeta(ref, fn)
            if (mN or {}).get("verify_jwt") != vj: bad(f"{NAMES[ref]} {fn}: its gateway setting changed and couldn't be put back. Tell Claude."); ok_all = False; continue
        say(f"  ✓ {NAMES[ref]} {fn} deployed (gateway setting kept: sign-in check {'on' if vj else 'off'})")
    return ok_all

def deps_of(ref, fn):
    s = set(); deps(os.path.join(ROOTS[ref], f"supabase/functions/{fn}/index.ts"), s)
    return {os.path.relpath(x, ROOTS[ref]).replace(os.sep, "/") for x in s}

def is_reviewed_live(ref, fn):
    """After the deploy: the live copy of fn is exactly the local reviewed build (index + every changed file it uses)."""
    okd, live = live_files(ref, fn)
    if not okd: return False, "couldn't read the live copy"
    need = deps_of(ref, fn)
    missing = [k for k in need if k not in live]
    if missing: return False, "live copy is missing " + ", ".join(sorted(k.split("functions/", 1)[1] for k in missing))
    off = [k for k in need if live[k] != sha(os.path.join(ROOTS[ref], k))]
    return (not off), ("" if not off else "live differs in " + ", ".join(sorted(k.split("functions/", 1)[1] for k in off)))

say("414 · \"WELCOME CALL DONE – SEND ORIENTATION LINK\""); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
hub_users = reviewed(HUB); tr_users = reviewed(TP)
if hub_users != WANT[HUB]: bad("Hub: only outreach-check should change"); say("  STOP. Nothing was run."); done(2)
if sorted(tr_users) != WANT[TP]: bad("Training: only job-offer and sync-axiscare should change"); say("  STOP. Nothing was run."); done(2)
NODE = shutil.which("node") or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.path.exists(p)), "")
if NODE:
    for ref, t in ((HUB, "orientation_link_hub_test.mjs"), (HUB, "training_texts_hub_test.mjs"), (HUB, "profile_cleared_check_hub_test.mjs"),
                   (TP, "orientation_link_test.mjs"), (TP, "training_texts_test.mjs"), (TP, "profile_before_cleared_test.mjs")):
        p = subprocess.run([NODE, t], cwd=ROOTS[ref], capture_output=True, text=True)
        last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
        if p.returncode != 0 or "FAIL" in last: bad(f"{NAMES[ref]} {t} failed: {last}"); say("  STOP. Nothing was run."); done(2)
        say(f"  ✓ {NAMES[ref]} {t}: {last} (run here, against fakes; nothing sent)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
s_, sb = http("GET", f"{API}/v1/projects/{TP}/secrets", headers=MG())
try: names = {x.get("name") for x in json.loads(sb)} if s_ == 200 else set()
except Exception: names = set()
need = {"OUTREACH_SECRET", "HUB_ANON_KEY", "TRAINING_CRON_SECRET", "GHL_TOKEN", "GHL_LOCATION_ID", "AXISCARE_TOKEN", "AXISCARE_SITE_NUMBER"}
if not need <= names: bad("Training is missing a secret the new code needs: " + ", ".join(sorted(need - names)) + ". Nothing was changed. Tell Claude."); done(3)
say("  ✓ Training has the Hub door secret, the Hub's public key, the job secret, GoHighLevel and AxisCare settings (values not read)")
ok, ap = sql(TP, "select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'app_settings' and column_name in ('key', 'value')")
if not ok or not ap or ap[0]["n"] != 2: bad("Training's app_settings table isn't as expected (the once-per-person report list lives there). Nothing was changed. Tell Claude: " + str(ap)[:160]); done(3)
say("  ✓ Training's app_settings table is there (the once-per-person report list goes in it; no database change)")
ok, pv = sql(TP, "select count(*)::int as n, count(*) filter (where mobile_phone is null and email is null)::int as nocontact "
                 "from caregivers where active and status_label = 'In Training' and welcome_sent_at is null and access_token is not null")
if ok and pv: say(f"  · today: {pv[0]['n']} In Training not yet welcomed (the 9am run sends them the new welcome); {pv[0]['nocontact']} of them have no phone and no email (now a card, once)")
ok, jo = sql(TP, "select count(*)::int as n from job_offers where matched_caregiver_id is null")
if ok and jo: say(f"  · {jo[0]['n']} job offers not yet linked to a caregiver (the button links them from now on; nothing changes for these today)")
kt, kh = keys(TP), keys(HUB)
TP_ANON, HUB_ANON = kt.get("anon", ""), kh.get("anon", "")
HIDE += [TP_ANON, HUB_ANON]
if not TP_ANON or not HUB_ANON: bad("couldn't read the projects' public keys. Nothing was changed."); done(3)
say("  ✓ read both projects' public keys (kept in memory only, never printed)")

say(); say("PART 2 · CHANGE (in order; each step only if the one before it worked)")
if not deploy(HUB, hub_users): say("  STOP. The Training Platform was not changed. Tell Claude."); done(4)
s1, b1 = http("POST", f"{FNB[HUB]}/functions/v1/outreach-check", {"report": True, "held": True, "sender": "orientation-link-proof", "channel": "sms", "phone": "0000000000", "why": "proof"},
              {"Authorization": "Bearer " + HUB_ANON, "apikey": HUB_ANON, "x-outreach-secret": "wrong-" + "x" * 40})
chk(s1 == 401 and "reported" not in (b1 or ""), f"the Hub refuses a report without the right server secret, no card made ({s1})")
if fails: say("  STOP. The Training Platform was not changed. Tell Claude."); done(4)
if not deploy(TP, sorted(tr_users)): say("  STOP. Tell Claude."); done(6)

say(); say("PART 3 · PROOF (nothing is sent, nothing is written)")
for ref, fns in ((HUB, hub_users), (TP, sorted(tr_users))):
    for fn in fns:
        good, why = is_reviewed_live(ref, fn)
        chk(good, f"{NAMES[ref]} {fn}: the live copy is now exactly the reviewed build" + ("" if good else f" ({why})"))
JO = f"{FNB[TP]}/functions/v1/job-offer"
probe = {"action": "orientation_link", "phone": "0000000000", "email": "nobody@invalid.test", "first": "Proof", "last": "Only"}
s2, b2 = http("POST", JO, probe, {"Authorization": "Bearer " + TP_ANON, "apikey": TP_ANON})
chk(s2 == 401, f"job-offer refuses orientation_link without a Hub staff sign-in ({s2}); it never reached AxisCare or GoHighLevel")
s3, b3 = http("POST", JO, probe, {"Authorization": "Bearer " + TP_ANON, "apikey": TP_ANON, "x-hub-token": "not-a-real-hub-session"})
chk(s3 in (401, 403), f"job-offer refuses orientation_link with a made-up Hub sign-in ({s3})")
s4, b4 = http("POST", f"{FNB[TP]}/functions/v1/sync-axiscare", {"auth_check": True}, {"Authorization": "Bearer " + TP_ANON, "apikey": TP_ANON})
chk(s4 == 401, f"the nightly sync still refuses a caller without the job secret or a staff sign-in ({s4})")
say("  · The full path (find in AxisCare, save, link the offer, send) needs a real Hub staff sign-in, which this installer")
say("    does not have; it is proved by the tests above (orientation_link_test.mjs, against fakes). The first real press is the live proof.")
say()
if fails: say("RESULT: PARTLY DONE · the ✗ lines above need Claude.")
else: say("RESULT: DONE · the Training Platform now answers \"send orientation link\" and the 9am run sends the new welcome. "
          "Merge the Training Platform branch next, then the Hub page branch (the button) last.")
say("Nothing was texted or emailed, nothing was written to AxisCare or either database by this installer.")
say("Rollback: Claude redeploys the previous outreach-check, job-offer and sync-axiscare from GitHub main. There is no database change to undo.")
done(1 if fails else 0)
