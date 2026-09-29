#!/usr/bin/env python3
# N0 · CARE NOTES FROM THE SHIFTS · prove it with your data (Desktop 333). Installs the new read-only care-notes
# function (it answers only the owner's server key) and runs its probe once: the last 3 days of visits, COUNTS ONLY.
# No note's words, name or number is printed or saved. Every AxisCare call is a read.
# Part 1 (read only): the function and the shared lock are the reviewed builds; the function doesn't exist yet (or is
#   this build from an earlier run).  Part 2: deploy (sign-in check at the gateway ON).
# Part 3: no key and the public key are refused; the probe's counts.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, time
FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPORT = os.environ["SB_REPORT"]
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FN = "care-notes"
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for v in HIDE: s = s.replace(v, "(hidden)")
    s = re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", s); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Anything done above stays done; nothing after it ran.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=150):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers=dict({"Content-Type": "application/json", "User-Agent": "cc-n0/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}

say("N0 · CARE NOTES FROM THE SHIFTS · PROVE IT"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY")
for name, want in SHAS.items():
    p = os.path.join(FNROOT, "_shared", "job-auth.ts") if name == "_shared/job-auth" else os.path.join(FNROOT, name, "index.ts")
    if hashlib.sha256(open(p, "rb").read()).hexdigest() != want: bad(f"{name} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
say("  ✓ the function and the shared lock are the reviewed builds")
s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers=MG())
try: keys = {k.get("name"): k.get("api_key", "") for k in json.loads(b)}
except Exception: keys = {}
ANON, SVC = keys.get("anon", ""), keys.get("service_role", "")
if not ANON or not SVC: bad("could not read the project's keys. Nothing was changed."); done(4)
HIDE += [ANON, SVC]
s, _ = http("GET", f"{API}/v1/projects/{REF}/functions/{FN}", headers=MG())
say("  · the care-notes function " + ("already exists (an earlier run); it will be updated" if s == 200 else "is new"))

say(); say("PART 2 · CHANGE")
p = subprocess.run([SUPA, "functions", "deploy", FN, "--project-ref", REF, "--use-api"], cwd=os.path.dirname(os.path.dirname(FNROOT)),
                   env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
if p.returncode != 0: bad("deploy failed: " + (p.stderr or p.stdout)[-240:]); done(6)
say("  ✓ care-notes deployed (read only; gateway sign-in check on)")

say(); say("PART 3 · CHECK AND THE COUNTS")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
U = f"{FNB}/functions/v1/{FN}?probe=1"
r0 = http("POST", U, {}, {})[0]; r1 = http("POST", U, {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
(say if r0 == 401 and r1 == 401 else bad)(("  ✓ " if r0 == 401 and r1 == 401 else "") + f"no key {r0}, the public key {r1} → refused")
s, b = http("POST", U, {}, {"apikey": SVC, "Authorization": "Bearer " + SVC})
try: j = json.loads(b)
except Exception: j = None
if s != 200 or not isinstance(j, dict) or j.get("error"): bad(f"the probe did not answer ({s}): " + str((j or {}).get("error") if isinstance(j, dict) else b)[:200]); done(7)
say(f"  ✓ the probe answered · window {j.get('window')}")
say(f"    visits in the window: {j.get('visits_listed')} (started so far: {j.get('visits_started')}) · read one at a time: {j.get('visits_read')}"
    + (f" · could not read: {j.get('read_failed')}" if j.get('read_failed') else "") + (" · AxisCare asked us to slow down, so it stopped early" if j.get('rate_limited') else ""))
say(f"    care notes written: {j.get('with_care_note')} (one per client, caregiver and day) · average length {j.get('care_note_avg_chars')} characters")
say(f"    tasks on those visits: {j.get('tasks')} · done {j.get('tasks_done')} · not done {j.get('tasks_not_done')} · no answer {j.get('tasks_no_response')}")
say(f"    tasks with a caregiver's note: {j.get('tasks_with_note')} (on tasks not done: {j.get('not_done_with_note')})")
say(f"    the visit list itself carries care notes: {'yes' if j.get('list_has_care_note_field') else 'no'} · each visit is read by its {j.get('id_form') or '?'} id")
say(f"    fields AxisCare returns on a visit: {', '.join(j.get('fields_on_a_visit') or []) or 'none'}")
ok = (j.get("visits_read") or 0) > 0
if not ok: bad("no visit could be read one at a time; tell Claude before N1")
say()
say("RESULT: " + ("DONE · AxisCare's shift notes can be read. Counts only; nothing was saved or sent." if not fails else "CHECK THE ✗ LINES."))
say("No note's words, name or number was printed. Rollback: delete the care-notes function (nothing else uses it yet).")
done(0 if not fails else 8)
