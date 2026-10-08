#!/usr/bin/env python3
# 521a · LOOK ONLY (the 498a look, for ghe-reminders; 2026-10-08). 521 stopped because the live ghe-reminders did not match the
# reviewed main. This reads ghe-reminders, downloads its live copy, and compares every file against every version
# ever merged into main: "same as main", "an older merged version (date, change)", or "never merged". Nothing is deployed,
# nothing in the database is read or written, nothing is sent. The LIVE SHAS block at the end is what 521 gets pinned to.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil, time
REPORT = os.environ["SB_REPORT"]; FNROOT = os.environ["SB_FNROOT"]
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
ROOT = os.path.dirname(os.path.dirname(FNROOT))
FNS = ["ghe-reminders"]
lines = []
def say(s=""):
    s = re.sub(r"(sbp_|eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._\-]+", "(hidden)", str(s)); print(s, flush=True); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  This was a look only; nothing changed. Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, headers=None, timeout=120):
    req = urllib.request.Request(url, method=method, headers=dict({"User-Agent": "cc-521a/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
sha = lambda b: hashlib.sha256(b).hexdigest()
def fmeta(fn):
    s = None
    for i in range(4):   # try again on a hiccup or a rate limit before calling it unreadable
        s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{fn}", {"Authorization": "Bearer " + TOKEN})
        if s == 200:
            try: return s, json.loads(b)
            except Exception: pass
        if s == 404: return s, None
        time.sleep(3 * (i + 1))
    return s, None
def live_files(fn):
    for i in range(3):
        tmp = tempfile.mkdtemp(prefix="cc521a-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
        d = subprocess.run([SUPA, "functions", "download", fn, "--project-ref", REF, "--use-api"], cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
        live = {}
        for r, _, files in os.walk(tmp):
            for f in files:
                lp = os.path.join(r, f).replace(os.sep, "/")
                if "/functions/" in lp: live["supabase/functions/" + lp.split("/functions/", 1)[1]] = sha(open(lp, "rb").read())
        shutil.rmtree(tmp, ignore_errors=True)
        if d.returncode == 0 and live: return True, live
        time.sleep(3 * (i + 1))
    return False, {}
HIST = {}
def merged(k):
    """sha256 -> (date, short commit, change title) for every version of file k ever merged into main, newest first."""
    if k not in HIST:
        HIST[k] = {}
        g = subprocess.run(["git", "log", "--format=%H\t%ad\t%s", "--date=short", "HEAD", "--", k], cwd=ROOT, capture_output=True, text=True).stdout
        for line in filter(None, g.split("\n")):
            c, d, s_ = line.split("\t", 2)
            b = subprocess.run(["git", "show", f"{c}:{k}"], cwd=ROOT, capture_output=True).stdout
            if b: HIST[k].setdefault(sha(b), (d, c[:7], s_[:70]))
    return HIST[k]
def main_sha(k):
    p = os.path.join(ROOT, k)
    return sha(open(p, "rb").read()) if os.path.exists(p) else None

say("521a · LOOK ONLY: what is live in ghe-reminders"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"))
say("Nothing is deployed, nothing in the database is touched, nothing is sent."); say()
if not TOKEN.startswith("sbp_"): say("  ✗ no Supabase access token"); done(2)
if not (SUPA and os.path.exists(SUPA)): say("  ✗ supabase CLI not found"); done(2)
LIVE = {}; never = []; unread = []; older_n = 0
for fn in FNS:
    s, m = fmeta(fn)
    if not m: say(f"  ✗ {fn}: could not be read (the Management API answered {s}, after 4 tries)"); unread.append(fn); continue
    ok, live = live_files(fn)
    if not ok: say(f"  ✗ {fn} (version {m.get('version', '?')}): the live copy could not be downloaded"); unread.append(fn); continue
    same, older, odd = [], [], []
    for k, h in sorted(live.items()):
        LIVE[k] = h
        if h == main_sha(k): same.append(k)
        elif h in merged(k): older.append((k, merged(k)[h]))
        else: odd.append((k, h))
    head = f"  {'✓' if not odd else '✗'} {fn} (version {m.get('version', '?')}, gateway sign-in check {'on' if m.get('verify_jwt') else 'off'}): {len(same)} file(s) same as the reviewed main"
    say(head + ("" if older or odd else ", nothing else"))
    for k, (d, c, s_) in older:
        older_n += 1; say(f"      · {k.split('supabase/functions/', 1)[1]}: an OLDER merged version, from {d} ({c} {s_}); never redeployed since")
    for k, h in odd:
        never.append(f"{fn}: {k}"); say(f"      ✗ {k.split('supabase/functions/', 1)[1]}: NOT any version ever merged into main (live {h[:12]}). Unreleased or hand-made.")
say()
if never or unread:
    say("RESULT: LOOK DONE. Something live is " + ("not any merged version" if never else "") + (" and " if never and unread else "") + ("unreadable" if unread else "") + ". 521 stays stopped. Tell Claude.")
else:
    say(f"RESULT: LOOK DONE. Every live file is reviewed, merged code: the same as main, or an older merged version ({older_n} file(s)) that was never redeployed. Nothing unreleased is live. Tell Claude \"ran 521a\".")
say(); say("LIVE SHAS (for Claude, to pin 521 to exactly what is live now):"); say(json.dumps(LIVE, sort_keys=True))
done(0)
