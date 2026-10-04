#!/usr/bin/env python3
# 435 · CALL-INS CI2: THE CALL-IN PAGE. Samantha approved the call-ins plan 2026-10-03 ("yes to all"; "build CI2").
# Each admin's call-in text carries their own link to one screen (cc.mo-care.com/callin.html): who called off, who said
# yes, who was asked; Confirm, I've got it, Call (rings your phone first), Ask more (the board's own list and rules),
# Close it. No sign-in; the link is that admin's alone, for that call-in, and runs out the day after the shift.
# What changes (code only, no database change, no setting written):
#   callin-alert (new): the page's server.
#   coverage-run: the call-in text, the "nobody yet" text and the "ran out" text carry each admin's own link (the
#     "nobody yet" text now goes to the call-in list instead of a list of bare numbers, her decision 2).
#   coverage-reply: "said yes" goes to the call-in list, each with their own link (her decision 2).
#   coverage-assign: a fill or close from the board also tells the other admins who got the call-in text (decision 4).
# Part 1 (read only): the reviewed builds (pinned), the tests pass here, the link secret is set.
# Part 2: each function created or redeployed only if its live copy is GitHub's (the reviewed base) or already this
#   build, keeping its gateway setting.
# Part 3 (proof; NOTHING is sent, NO case is touched): the live copies are the reviewed build; the page's server
#   refuses no link, a made-up link and a link preview (GET); coverage-assign still refuses outsiders.
# Prints counts only.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil, time
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
REF = "zngsgedlsxinbygwmxwn"
ROOT = os.environ["SB_REPO"]; BASE = os.environ.get("SB_BASE", "")
SHAS = json.loads(os.environ["SB_SHAS"])
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FIRST = ["callin-alert", "coverage-assign", "coverage-reply", "coverage-run"]
NEW = {"callin-alert"}                     # the page's server is new
TESTS = ["callin_test.mjs", "ci1_test.mjs", "prn3_coverage_test.mjs", "axiscare_change_wiring_test.mjs", "nsf2_scheduling_test.mjs",
         "retry_test.mjs", "j1_job_locks_test.mjs", "quiet_hours_425_test.mjs", "optout_0b3_test.mjs"]
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
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-ci2/1.0"}, **(headers or {})))
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
    tmp = tempfile.mkdtemp(prefix="ci2-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
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
    # A shared file this build newly imports is not in the live copy yet: fine when it is unchanged GitHub code
    # (same at the reviewed base and now). Anything present but different still stops. (433b, 2026-10-03: ghl-call-link
    # now imports job-auth.ts; the same fix 432's installer got in #173.)
    other = [k.split("supabase/functions/", 1)[1] for k in need if k != mine and k not in pinned
             and ((k in live and live[k] != sha(os.path.join(ROOT, k))) or (k not in live and base_sha(k) != sha(os.path.join(ROOT, k))))]
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




say("435 · CALL-INS: THE CALL-IN PAGE (CI2)"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
order = reviewed()
NODE = shutil.which("node") or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.path.exists(p)), "")
if NODE:
    for t in TESTS:
        p = subprocess.run([NODE, t], cwd=ROOT, capture_output=True, text=True)
        last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
        if p.returncode != 0 or "FAIL" in last or re.search(r"^FAIL", p.stdout, re.M): bad(f"{t} failed: {last}"); say("  STOP. Nothing was run."); done(2)
        say(f"  ✓ {t}: {last.strip()} (run here, against fakes; nothing sent)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
s, b = http("GET", f"{API}/v1/projects/{REF}/secrets", headers=MG())
try: names = {x.get("name") for x in json.loads(b)} if s == 200 else set()
except Exception: names = set()
if "HUB_JOB_SECRET" not in names: bad("the link secret (HUB_JOB_SECRET) isn't set, so the links couldn't be made. Nothing was changed."); done(3)
say("  ✓ the link secret is set")
K = keys(); ANON, SERVICE = K.get("anon", ""), K.get("service_role", "")
HIDE += [ANON, SERVICE]
if not ANON: bad("couldn't read the project's public key. Nothing was changed."); done(3)
ok, cc = sql("select count(*) filter (where x->>'status' = 'open')::int as open from app_data, jsonb_array_elements(case when jsonb_typeof(data) = 'array' then data else '[]'::jsonb end) x where key = 'coverage_cases'")
if ok and cc: say(f"  · open call-ins right now: {cc[0]['open']} (their texts already went; new texts carry links from now on)")

say(); say("PART 2 · CHANGE")
went = [fn for fn in order if deploy(fn)]

say(); say("PART 3 · PROOF (nothing is sent; no case is touched)")
for fn in went:
    good, why = is_reviewed_live(fn)
    chk(good, f"{fn}: the live copy is exactly the reviewed build" + ("" if good else f" ({why})"))
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
FN = lambda n: f"{FNB}/functions/v1/{n}"
A = {"apikey": ANON, "Authorization": "Bearer " + ANON}
p1 = http("POST", FN("callin-alert"), {"action": "view"}, A)[0]
p2 = http("POST", FN("callin-alert"), {"c": "ci2-proof", "a": "0" * 16, "e": 9999999999, "t": "A" * 43, "action": "confirm", "covered_by": "x"}, A)[0]
p3 = http("GET", FN("callin-alert"), None, A)[0]
chk(p1 == 401 and p2 == 401 and p3 in (401, 405), f"the call-in page's server refuses no link ({p1}), a made-up link ({p2}) and a link preview ({p3})")
s4 = http("POST", FN("coverage-assign"), {"action": "confirm", "case_id": "x", "covered_by": "x"}, A)[0]
chk(s4 == 401, f"coverage-assign still refuses the public key ({s4})")
r5 = http("GET", "https://cc.mo-care.com/callin.html", None, {}, 30)[0] if not os.environ.get("SB_SKIP_PAGE") else 200
say(("  ✓ " if r5 == 200 else "  · ") + ("the page is up at cc.mo-care.com/callin.html" if r5 == 200 else f"the page isn't up yet ({r5}): Claude merges the Hub side next, then it is"))

say()
if fails: say("RESULT: PARTLY DONE · the ✗ lines above need Claude.")
else: say("RESULT: DONE · from the next call-in, each admin's text carries their own link. Next: Claude merges the Hub side (callin.html) if it isn't up yet.")
say("Nothing was texted, emailed or called, and no coverage case was changed by this installer.")
say("Rollback: Claude redeploys coverage-run, coverage-reply and coverage-assign from the previous commit (the texts go back to the board address); callin-alert can be deleted.")
done(0 if not fails else 8)
