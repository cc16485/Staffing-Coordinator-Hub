#!/usr/bin/env python3
# 1114 · CAN GOHIGHLEVEL VOICE AI CALL FROM THE OFFICE NUMBER? READ ONLY (Samantha 2026-10-24: "Check whether GoHighLevel
# Voice AI can call from our office number, read only. No test call yet.")
# Puts a small owner-only check in place (ghl-voice-probe), runs it once, writes what GoHighLevel said, and removes it.
# Three GET requests with the Hub's own GoHighLevel token: the location, its phone numbers, its Voice AI agents. No call is
# placed, no text is sent, nothing is created or changed in GoHighLevel, the Hub or AxisCare.
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
        headers=dict({"Content-Type": "application/json", "User-Agent": "cc-1114/1.0"}, **(headers or {})))
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

FN = "ghl-voice-probe"
yn = lambda v: "yes" if v is True else "no" if v is False else "unknown"
say("1114 · GOHIGHLEVEL VOICE AI AND THE OFFICE NUMBER (read only)"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
for name, want in SHAS.items():
    p = os.path.join(FNROOT, name, "index.ts")
    if hashlib.sha256(open(p, "rb").read()).hexdigest() != want: bad(f"{name} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
say("  ✓ the reviewed build of the check")
k = keys(); ANON, SVC = k.get("anon", ""), k.get("service_role", "")
if not ANON or not SVC: bad("could not read the project's keys. Nothing was changed."); done(4)
HIDE += [ANON, SVC]
ROOT = os.path.dirname(os.path.dirname(FNROOT)); ENVX = dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN)

say(); say("PART 2 · PUT THE CHECK IN PLACE")
p = subprocess.run([SUPA, "functions", "deploy", FN, "--project-ref", REF, "--use-api"], cwd=ROOT, env=ENVX, capture_output=True, text=True)
if p.returncode != 0: bad("could not put the check in place: " + (p.stderr or p.stdout)[-240:]); say("  STOP. Nothing was read."); done(6)
say("  ✓ in place (owner key only)")

say(); say("PART 3 · WHAT GOHIGHLEVEL SAYS (three reads, nothing else)")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
s0, _ = http("POST", f"{FNB}/functions/v1/{FN}", {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})
chk(s0 in (401, 403), f"a page with the public key is refused ({s0})")
s1, b1 = http("POST", f"{FNB}/functions/v1/{FN}", {"office": "4172348494"}, {"apikey": SVC, "Authorization": "Bearer " + SVC})
try: R = json.loads(b1)
except Exception: R = None
if s1 != 200 or not isinstance(R, dict) or "numbers" not in R: bad(f"the check didn't answer ({s1}): {str(b1)[:240]}")
else:
    Lc, Nm, Ag = R.get("location") or {}, R.get("numbers") or {}, R.get("agents") or {}
    say(); say("  THE LOCATION")
    if Lc.get("status") != 200: say(f"      not readable ({Lc.get('status')}): {Lc.get('error')}")
    else: say(f"      {Lc.get('name')}; business phone {Lc.get('business_phone')} (the office number: {yn(Lc.get('business_phone_is_office'))}); time zone {Lc.get('timezone')}")
    say(); say("  PHONE NUMBERS ON THE LOCATION")
    if Nm.get("status") != 200: say(f"      not readable ({Nm.get('status')}): {Nm.get('error')}  (the token may need the phone numbers permission)")
    else:
        say(f"      {Nm.get('count')} number(s); the office number (417) 234-8494 is " + ("ON this location" if Nm.get("office_found") else "NOT among them"))
        for n in Nm.get("list") or []:
            say(f"      · {n.get('phone')}" + (" (OFFICE)" if n.get("is_office") else "") + f"  name: {n.get('name')}  capabilities: {json.dumps(n.get('capabilities'))}  type: {n.get('type')}  default: {n.get('default')}")
    say(); say("  VOICE AI AGENTS")
    if Ag.get("status") != 200: say(f"      not readable ({Ag.get('status')}): {Ag.get('error')}  (the token may need the Voice AI permission, or Voice AI isn't turned on)")
    else:
        say(f"      {Ag.get('count')} agent(s)" + ("" if Ag.get("count") else ": none set up yet"))
        for a_ in Ag.get("list") or []:
            say(f"      · {a_.get('name')}  numbers: {', '.join(a_.get('numbers') or []) or 'none shown'}" + ("  (on the office number)" if a_.get("on_office_number") else "") + f"  language: {a_.get('language')}")
    say(); say("RAW: " + json.dumps(R)[:20000])

say(); say("PART 4 · TAKE THE CHECK AWAY")
p = subprocess.run([SUPA, "functions", "delete", FN, "--project-ref", REF], cwd=ROOT, env=ENVX, capture_output=True, text=True, input="y\n")
chk(p.returncode == 0, "removed (it was only for this look)" if p.returncode == 0 else "couldn't remove it: " + (p.stderr or p.stdout)[-200:] + " (it only answers the owner key; tell Claude)")
say()
say("RESULT: " + ("DONE · Tell Claude it ran: the report shows what GoHighLevel says about the office number and Voice AI." if not fails else "CHECK THE ✗ LINES."))
say("Three reads from GoHighLevel only. No call was placed, no text sent, and nothing was created or changed anywhere.")
done(0 if not fails else 8)
