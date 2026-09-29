#!/usr/bin/env python3
# S4 · HOMETOGETHER EMAILS (Desktop 330). Two public forms could send HomeTogether email to any address, repeatedly,
# with typed-in words. Now:
#   htl-apply (HomeTogether Hire project): no email to the applicant (the page confirms on screen); one application per
#     person per job; at most 10 an hour per job; an exact email match that never attaches a public submission to an
#     existing caregiver's profile.
#   ht-local (Hub project), caregiver and family sign-ups: "Hi there", nothing typed repeated, once a day per address,
#     no typed first name written onto a GoHighLevel contact.
# Part 1 (read only): both functions are the reviewed builds; each gateway setting is read and kept; versions noted.
# Part 2: deploy both.  Part 3 (sends nothing): gateway settings kept; each function now runs a newer version; the
#   public doors still answer as before (a made-up job link is refused; an unknown request is refused).
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, time
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); SUPA = os.environ.get("SB_SUPA_CLI", "")
FNB = os.environ.get("SB_FN_BASE", "")   # tests only: one base for both projects
SHAS = json.loads(os.environ["SB_FN_SHAS"])
P = os.environ.get("SB_PROJECTS_DIR", "/Users/samantha/Claude/Projects")
TARGETS = [  # (label, project ref, function, repo root holding supabase/functions, page holding the public token, token pattern)
    ("HomeTogether Hire", os.environ.get("SB_REF_HT", "lrlczrpehjpncqixubuk"), "htl-apply", os.path.join(P, "HomeTogether"), os.path.join(P, "HomeTogether", "apply.html"), r"htlpub_[A-Za-z0-9]+"),
    ("the Hub", os.environ.get("SB_REF_HUB", "zngsgedlsxinbygwmxwn"), "ht-local", os.path.join(P, "Staffing-Coordinator-Hub"), os.path.join(P, "HomeTogether", "hire.html"), r"htorder_[A-Za-z0-9]+"),
]
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for v in HIDE: s = s.replace(v, "(hidden)")
    print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Anything done above stays done; nothing after it ran.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers=dict({"Content-Type": "application/json", "User-Agent": "cc-s4/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=90) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
def meta(ref, fn):
    s, b = http("GET", f"{API}/v1/projects/{ref}/functions/{fn}", headers={"Authorization": "Bearer " + TOKEN})
    try: m = json.loads(b) if s == 200 else None
    except Exception: m = None
    return m if isinstance(m, dict) and isinstance(m.get("verify_jwt"), bool) else None

say("S4 · HOMETOGETHER EMAILS"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY")
before = {}; pub = {}
for label, ref, fn, root, page, pat in TARGETS:
    got = hashlib.sha256(open(os.path.join(root, "supabase", "functions", fn, "index.ts"), "rb").read()).hexdigest()
    if got != SHAS.get(fn): bad(f"{fn} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
    m = meta(ref, fn)
    if not m: bad(f"could not read {fn} in {label}. Nothing was changed."); done(4)
    before[fn] = m
    try: pub[fn] = (re.findall(pat, open(page).read()) or [""])[0]
    except Exception: pub[fn] = ""
    if pub[fn]: HIDE.append(pub[fn])
    say(f"  ✓ {fn} ({label}) is the reviewed build · gateway setting read and kept · running version {m.get('version')}")

say(); say("PART 2 · CHANGE")
for label, ref, fn, root, page, pat in TARGETS:
    p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", ref, "--use-api"] + ([] if before[fn]["verify_jwt"] else ["--no-verify-jwt"]),
                       cwd=root, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    if p.returncode != 0: bad(f"{fn} deploy failed: " + (p.stderr or p.stdout)[-240:]); say("  STOP. Functions above this line run the new code; the rest are unchanged."); done(6)
    say(f"  ✓ {fn} deployed to {label}")

say(); say("PART 3 · CHECK (sends nothing)")
time.sleep(float(os.environ.get("SB_SETTLE", "6")))
for label, ref, fn, root, page, pat in TARGETS:
    m = meta(ref, fn) or {}
    kept = m.get("verify_jwt") == before[fn]["verify_jwt"]
    newer = isinstance(m.get("version"), int) and isinstance(before[fn].get("version"), int) and m["version"] > before[fn]["version"]
    (say if kept and newer else bad)(("  ✓ " if kept and newer else "") + f"{fn}: gateway setting kept: {'yes' if kept else 'NO'} · now running version {m.get('version')} (was {before[fn].get('version')})")
    base = FNB or f"https://{ref}.supabase.co"
    if not pub[fn]: say(f"  · {fn}: the public page's token was not found on this Mac, so the door check is skipped"); continue
    if fn == "htl-apply":
        s, b = http("POST", f"{base}/functions/v1/htl-apply?token={pub[fn]}", {"job_code": "made-up-" + str(int(time.time())), "applicant_name": "Check", "applicant_email": "nobody@example.invalid"})
        ok = s == 404   # a made-up link: refused before anything is stored or sent
        (say if ok else bad)(("  ✓ " if ok else "") + f"htl-apply: a made-up job link is refused ({s}); nothing stored or sent")
    else:
        s, b = http("POST", f"{base}/functions/v1/ht-local?token={pub[fn]}", {"kind": "nothing-" + str(int(time.time()))})
        ok = s == 400
        (say if ok else bad)(("  ✓ " if ok else "") + f"ht-local: an unknown request is refused ({s}); nothing stored or sent")
say()
say("RESULT: " + ("DONE · HomeTogether's public forms can no longer email any address over and over, or repeat what someone typed." if not fails else "CHECK THE ✗ LINES."))
say("No name, address or token was printed. Rollback if ever needed: redeploy each function from the commit before this one.")
done(0 if not fails else 7)
