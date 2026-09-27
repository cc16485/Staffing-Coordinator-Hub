#!/usr/bin/env python3
# Change 7b · held shifts + the "already started" time reading. Install, preview, then ask.
#  1. sha-checks coverage-watch and the shared held-shift rule (the reviewed source)
#  2. deploys coverage-watch with 7b SWITCHED OFF (it only reports what it would do)
#  3. runs one preview (?dry=1: no case, no item, no text) and shows every held shift and every
#     shift whose "already started" reading would change
#  4. asks; only a typed "yes" switches 7b on (ops_settings.coverage_watch_7b_live) and runs Cara's
#     check once so a held shift today is acted on now, not in five minutes
#   SB_MODE=off turns 7b off again (Desktop 256).
import json, os, sys, hashlib, subprocess, urllib.request, urllib.error, datetime as dt
FNROOT = os.environ.get("SB_FNROOT", ""); FN_SHAS = json.loads(os.environ.get("SB_FN_SHAS", "{}"))
REPORT = os.environ["SB_REPORT"]; MODE = os.environ.get("SB_MODE", "install")
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "")
SUPA = os.environ.get("SB_SUPA_CLI", ""); SKIP_FN = os.environ.get("SB_SKIP_FUNCTION") == "1"
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
lines = []
def say(s=""): print(s, flush=True); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def http(method, url, body=None, headers=None, timeout=240):
    req = urllib.request.Request(url, data=(json.dumps(body).encode() if body is not None else None), method=method,
                                 headers=dict({"Content-Type": "application/json", "User-Agent": "cc-held-shift/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, "%s: %s" % (type(e).__name__, e)
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, {"Authorization": "Bearer " + TOKEN}, 300)
    if s not in (200, 201): return False, f"HTTP {s}: {b[:300]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:300]
def settings():
    ok, r = sql("select coalesce((data->>'coverage_watch_live')::boolean, false) as live, coalesce((data->>'coverage_watch_7b_live')::boolean, false) as on7b from app_data where key = 'ops_settings'")
    return (r[0] if ok and r else None), r
def set7b(on, approval=None):
    extra = f", 'coverage_watch_7b_approved', '{json.dumps(approval).replace(chr(39), chr(39) * 2)}'::jsonb" if approval else ""
    ok, r = sql(f"""update public.app_data set data = data || jsonb_build_object('coverage_watch_7b_live', {'true' if on else 'false'}{extra}), updated_at = now()
      where key = 'ops_settings' and jsonb_typeof(data) = 'object' returning (data->>'coverage_watch_7b_live')::boolean as on7b""")
    return ok and r and r[0].get("on7b") in (on, str(on).lower())
def svc_key():
    s, kb = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers={"Authorization": "Bearer " + TOKEN})
    try: return next((k.get("api_key", "") for k in json.loads(kb) if isinstance(k, dict) and k.get("name") == "service_role"), "")
    except Exception: return ""
def watch(dry):
    k = svc_key()
    if not k: return None, "could not read the project's service key"
    s, b = http("POST", f"{FNB}/functions/v1/coverage-watch" + ("?dry=1" if dry else ""), {}, {"Authorization": "Bearer " + k, "apikey": k}, 300)
    try: d = json.loads(b)
    except Exception: d = None
    return (d if s == 200 and isinstance(d, dict) and "held_checks" in d else None), f"HTTP {s} {b[:200]}"
WORDS = {"reopen": "CHANGED in AxisCare since its case closed → a new call-off case",
         "ask_covered": "marked covered, but AxisCare shows no caregiver and nothing changed → a person is asked (My Work)",
         "ask_unreadable": "couldn't ask AxisCare whether it changed → a person is asked (My Work)",
         "hold": "a person closed the last case and nothing changed → stays closed, as your rule says"}
def show(d, heading):
    say(heading)
    h = d["held_checks"]; t = d["time_check"]
    if not h["shifts"]: say("  • no called-off upcoming shift has a closed case right now")
    for x in h["shifts"]:
        by = f" by {x['covered_by']}" if x.get("covered_by") else ""
        say(f"  • {x['client']} · {str(x['when'])[:16].replace('T', ' ')} · last case closed {x.get('closed_how') or ''}{by}")
        say(f"      {WORDS.get(x['decision'], x['decision'])}" + ("  ✓ done" if x.get("acted") else "") + f"  ({x['detail']})")
    say(f"  times from AxisCare {'carry an offset (read correctly already)' if t['has_offset'] else 'have NO offset' if t['has_offset'] is False else 'were not seen'}"
        + (f", e.g. {t['sample_start']}" if t.get("sample_start") else ""))
    if t["differs"]:
        say(f"  shifts the old reading gets wrong right now: {len(t['differs'])}")
        for x in t["differs"]: say(f"    • {x['client']} · {str(x['when'])[:16].replace('T', ' ')}: old reading \"{x['old_reading']}\", correct \"{x['correct_reading']}\"")
    elif t["has_offset"] is False: say("  no shift is misread at this moment, but late call-offs (within about 5 hours of the start) would be")

if MODE == "off":
    say("CHANGE 7b · SWITCH OFF"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
    say("  ✓ 7b is off: held shifts stay held quietly and times are read as before" if set7b(False) else "  ✗ could not switch it off"); done(0)

say("CHANGE 7b · HELD SHIFTS AND SHIFT TIMES · INSTALL")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
for fn, want in FN_SHAS.items():
    path = os.path.join(FNROOT, fn) if fn.endswith(".ts") else os.path.join(FNROOT, fn, "index.ts")
    got = hashlib.sha256(open(path, "rb").read()).hexdigest()
    say(f"  {fn} sha256 {got[:16]}…" + ("  ✓ reviewed source" if got == want else "  ✗ differs"))
    if got != want: say("  STOP. Nothing was run."); done(2)
st, raw = settings()
if st is None: say("  ✗ STOP: could not read Cara's settings: " + str(raw)[:200]); done(3)
if st["on7b"] and not set7b(False): say("  ✗ STOP: 7b was already on and could not be paused for the preview"); done(3)
say(f"  Cara's call-off watcher is {'LIVE' if st['live'] else 'in preview mode'}; 7b starts OFF")
if SKIP_FN: say("  (test target: function deploy skipped)")
else:
    p = subprocess.run([SUPA, "functions", "deploy", "coverage-watch", "--project-ref", REF, "--use-api"], cwd=os.path.dirname(os.path.dirname(FNROOT)),
                       env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    if p.returncode != 0: say("  ✗ deploy failed: " + (p.stderr or p.stdout)[-400:]); done(4)
    say("  ✓ coverage-watch deployed (7b off: it only reports)")
d, why = watch(dry=True)
if not d: say("  ✗ the preview did not complete: " + why); done(5)
say(); show(d, "WHAT 7b WOULD DO RIGHT NOW (preview: nothing was opened, raised or sent)")
say()
say("  Switching on means: the shifts above get the action shown, from now on at every check;")
say("  times with no offset are read as Springfield time. Type yes to switch on, anything else to leave it off.")
try: ans = input("  Switch 7b on now? ").strip().lower()
except EOFError: ans = ""
say(f"  answer: {ans or '(nothing)'}")
if ans != "yes":
    say(); say("RESULT: INSTALLED, LEFT OFF · Cara behaves exactly as before; run 255 again to switch on"); done(0)
approval = {"by": "Samantha", "decided_on": dt.date.today().isoformat(), "words": "yes, build 7b", "confirmed_at_install": "yes", "recorded_by": "Desktop 255"}
if not set7b(True, approval): say("  ✗ could not switch 7b on; it stays off"); done(6)
say("  ✓ 7b switched on, with your approval recorded")
d2, why = watch(dry=False)
say()
if d2: show(d2, "CARA'S CHECK, RUN NOW WITH 7b ON" + ("" if st["live"] else " (the watcher itself is in preview mode, so nothing was opened)"))
else: say("  ○ the immediate check didn't answer (" + why + "); Cara's next check runs within 5 minutes")
say(); say("RESULT: INSTALLED AND ON · a changed held shift reopens; the rest go to a person or stay closed; times read as Springfield time")
done(0)
