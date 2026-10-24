#!/usr/bin/env python3
# 1111 · RUN HER NINE SENTENCES THROUGH CARA'S LIVE RUNNING-LATE READER (Samantha 2026-10-24: "Build a small owner-only
# test so you can run my nine sentences through Cara's live reader, read only. Show me the results before anything else.")
# Puts a small owner-only check in place (late-read-probe), runs it once, writes what the reader said, and removes it.
# Each sentence is read twice: sent 30 minutes before an 8am shift, and as a reply 7 minutes after it started. Nothing in
# the Hub, AxisCare or GoHighLevel is read or changed, and nobody is contacted.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, time
REPORT = os.environ["SB_REPORT"]; FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ.get("SB_FN_SHAS", "{}"))
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FN = "care-notes"
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for v in HIDE: s = s.replace(v, "(hidden)")
    s = re.sub(r"(sbp_|eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._\-]+", "(hidden)", s); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Nothing was sent to anyone. Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=400):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers=dict({"Content-Type": "application/json", "User-Agent": "cc-1111/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, b[:200]
    try: return True, json.loads(b)
    except Exception: return False, b[:200]
def probe(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    texts = []
    try:
        j = json.loads(b); texts.append(j.get("message") if isinstance(j, dict) else str(j))
    except Exception: pass
    texts.append(b.replace('\\"', '"'))
    for t in texts:
        if not t or "PROBE_RESULT: " not in t: continue
        try: return json.JSONDecoder().raw_decode(t[t.index("PROBE_RESULT: ") + len("PROBE_RESULT: "):])[0], None
        except Exception: continue
    return None, f"HTTP {s}: {b[:240]}"
def keys():
    s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys?reveal=true", headers=MG())
    try: return {k.get("name"): k.get("api_key", "") for k in json.loads(b)}
    except Exception: return {}
def chk(good, msg): (say if good else bad)(("  ✓ " if good else "") + msg)

lit = lambda v: "'" + str(v).replace("'", "''") + "'"
FN = "late-read-probe"
SENTENCES = ["I can't make it today.", "I'm sick and can't work.", "My car broke down, I can't get there.", "I won't be coming tonight.",
  "I need to call off.", "I can't cover my shift.", "I'll be 30 minutes late.", "I can't make it by 8, but I'll be there at 8:30.", "I'm not sure I can make it."]
EXPECT = ["can't make it"] * 6 + ["running late (8:30)", "running late (8:30)", "needs clarification"]
WORDS = {"cant_make_it": "can't make it", "late": "running late", "other": "something else"}
say("1111 · CARA'S RUNNING-LATE READER, HER NINE SENTENCES (read only)"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
for name, want in SHAS.items():
    p = os.path.join(FNROOT, name, "index.ts")
    if hashlib.sha256(open(p, "rb").read()).hexdigest() != want: bad(f"{name} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
say("  ✓ the reviewed build of the check and of the live reader")
k = keys(); ANON, SVC = k.get("anon", ""), k.get("service_role", "")
if not ANON or not SVC: bad("could not read the project's keys. Nothing was changed."); done(4)
HIDE += [ANON, SVC]
ROOT = os.path.dirname(os.path.dirname(FNROOT)); ENVX = dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN)

say(); say("PART 2 · PUT THE CHECK IN PLACE")
p = subprocess.run([SUPA, "functions", "deploy", FN, "--project-ref", REF, "--use-api"], cwd=ROOT, env=ENVX, capture_output=True, text=True)
if p.returncode != 0: bad("could not put the check in place: " + (p.stderr or p.stdout)[-240:]); say("  STOP. Nothing was read."); done(6)
say("  ✓ in place (owner key only)")

say(); say("PART 3 · THE LIVE READER (reads your sentences only)")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
s0, _ = http("POST", f"{FNB}/functions/v1/{FN}", {"sentences": ["x"]}, {"apikey": ANON, "Authorization": "Bearer " + ANON})
chk(s0 in (401, 403), f"a page with the public key is refused ({s0})")
s1, b1 = http("POST", f"{FNB}/functions/v1/{FN}", {"sentences": SENTENCES, "shift": "08:00", "before_min": 30, "after_min": 7}, {"apikey": SVC, "Authorization": "Bearer " + SVC})
try: R = json.loads(b1)
except Exception: R = None
if s1 != 200 or not isinstance(R, dict) or not R.get("results"): bad(f"the check didn't answer ({s1}): {str(b1)[:240]}")
else:
    say(f"  · shift {R.get('shift')}; each sentence sent 30 minutes before, and as a reply 7 minutes after the start")
    for i, r in enumerate(R["results"]):
        say(); say(f"  {i+1}. \"{r['sentence']}\"   (you expect: {EXPECT[i] if i < len(EXPECT) else '?'})")
        for lab, nm in (("before", "before the shift"), ("reply", "as a reply")):
            x = r.get(lab) or {}
            if x.get("failed"): say(f"      {nm}: the reader did not answer"); continue
            say(f"      {nm}: {WORDS.get(x.get('kind'), x.get('kind'))}" + (f", arriving {x['eta']}" if x.get("eta") else "") + ("" if x.get("sure") else ", NOT SURE") + (f"  (its quote: \"{x['quote']}\")" if x.get("quote") else ""))
    say(); say("RAW: " + json.dumps(R)[:20000])

say(); say("PART 4 · TAKE THE CHECK AWAY")
p = subprocess.run([SUPA, "functions", "delete", FN, "--project-ref", REF], cwd=ROOT, env=ENVX, capture_output=True, text=True, input="y\n")
chk(p.returncode == 0, "removed (it was only for this look)" if p.returncode == 0 else "couldn't remove it: " + (p.stderr or p.stdout)[-200:] + " (it only answers the owner key; tell Claude)")
say()
say("RESULT: " + ("DONE · Tell Claude it ran: the report shows what Cara's live reader made of each sentence." if not fails else "CHECK THE ✗ LINES."))
say("Nothing in the Hub, AxisCare or GoHighLevel was read or changed. Nobody was contacted.")
done(0 if not fails else 8)
