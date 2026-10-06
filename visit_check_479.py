#!/usr/bin/env python3
# 479 · WHAT AXISCARE LETS US CHANGE ON A VISIT (a look before "click and change shifts" on the Live Schedule calendar).
# Puts a small owner-only check in place (axiscare-visit-check), runs it once, writes what AxisCare said, and removes it.
# It CHANGES NOTHING in AxisCare: it reads the agency's change reasons, reads one of tomorrow's visits (field names only),
# and sends each AxisCare key an EMPTY edit of that visit (AxisCare answers "nothing to change", or "not allowed"), then
# reads the visit back to prove it is unchanged. No names of clients or caregivers are written. Nobody is contacted.
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
        headers=dict({"Content-Type": "application/json", "User-Agent": "cc-479/1.0"}, **(headers or {})))
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
FN = "axiscare-visit-check"
say("479 · WHAT AXISCARE LETS US CHANGE ON A VISIT"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
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
if p.returncode != 0: bad("could not put the check in place: " + (p.stderr or p.stdout)[-240:]); say("  STOP. Nothing was asked of AxisCare."); done(6)
say("  ✓ in place (owner key only)")

say(); say("PART 3 · ASK AXISCARE (changes nothing)")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
s0, _ = http("POST", f"{FNB}/functions/v1/{FN}", {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})
chk(s0 in (401, 403), f"a page with the public key is refused ({s0})")
s1, b1 = http("POST", f"{FNB}/functions/v1/{FN}", {}, {"apikey": SVC, "Authorization": "Bearer " + SVC})
try: R = json.loads(b1)
except Exception: R = None
if s1 != 200 or not isinstance(R, dict): bad(f"the check didn't answer ({s1}): {str(b1)[:200]}")
else:
    rs = R.get("reasons") or {}
    lst = rs.get("list") or []
    say("  · AxisCare's change reasons" + (f" (answered {rs.get('status')})" if rs.get("status") else "") + ":")
    if lst:
        for x in lst: say(f"      {x.get('id')} · {x.get('name')}" + ("  (switched off)" if x.get("disabled") else ""))
    else: say("      none set up" + (f" ({rs.get('errors') or rs.get('error')})" if (rs.get('errors') or rs.get('error')) else ""))
    sm = R.get("sample") or {}
    if sm.get("none_tomorrow"): say("  · no visit tomorrow to test the edit on (run it again on a day before visits)")
    elif sm.get("error"): bad("couldn't read tomorrow's visits: " + str(sm.get("error"))[:160])
    else:
        say(f"  · tested on one of tomorrow's visits (id like {sm.get('id_shape')}), " + ("assigned" if sm.get("has_caregiver") else "unassigned"))
        say("      the fields a visit carries: " + ", ".join(sm.get("field_names") or []))
    for e in R.get("edit") or []:
        say(f"  · {e.get('key')}: AxisCare answered {e.get('status')} → {e.get('meaning') or e.get('error')}" + (f"  [{e.get('errors')}]" if e.get("errors") else ""))
    if R.get("edit"): chk(R.get("unchanged") is True, "the visit reads back exactly as it was (nothing changed)")

say(); say("PART 4 · TAKE THE CHECK AWAY")
p = subprocess.run([SUPA, "functions", "delete", FN, "--project-ref", REF], cwd=ROOT, env=ENVX, capture_output=True, text=True, input="y\n")
chk(p.returncode == 0, "removed (it was only for this look)" if p.returncode == 0 else "couldn't remove it: " + (p.stderr or p.stdout)[-200:] + " (it only answers the owner key; tell Claude)")
say()
say("RESULT: " + ("DONE · Send this report to Claude: it says what click-to-change on the calendar can do." if not fails else "CHECK THE ✗ LINES."))
say("Nothing in AxisCare was changed. Nobody was contacted.")
done(0 if not fails else 8)
