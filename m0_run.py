#!/usr/bin/env python3
# M0 · MISSED SHIFT NOTES · the read-only proof (Desktop 335 = first look, Desktop 336 = second look a day later).
# Nothing is sent; nothing is written in AxisCare or the Hub. Counts and AxisCare ID numbers only.
#   Step 1 (335): installs the read-only notes-audit function (owner's server key only), reads the last 14 days of
#     finished shifts, and reports: the counting rule (one note per caregiver + client + day?), how many shifts ended
#     without a note, split by how the caregiver clocked out (app, phone, web), and per-caregiver counts. It saves the
#     list of shifts without a note (AxisCare ID numbers only) to ~/Claude/m0-notes-snapshot.json on this Mac.
#   Step 2 (336, 24 hours or more later): reads those same shifts again and reports how many gained a note since.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, time
REPORT = os.environ["SB_REPORT"]; STEP = os.environ.get("SB_M0_STEP", "1")
FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ.get("SB_FN_SHAS", "{}"))
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
SNAP = os.environ.get("SB_SNAPSHOT", os.path.expanduser("~/Claude/m0-notes-snapshot.json"))
FN = "notes-audit"
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for v in HIDE: s = s.replace(v, "(hidden)")
    s = re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", s); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Nothing was sent or changed in AxisCare.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=300):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers=dict({"Content-Type": "application/json", "User-Agent": "cc-m0/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def keys():
    s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers=MG())
    try: return {k.get("name"): k.get("api_key", "") for k in json.loads(b)}
    except Exception: return {}
fmt = lambda d: ", ".join(f"{k} {v}" for k, v in sorted((d or {}).items(), key=lambda x: -x[1])) or "none"

say("M0 · MISSED SHIFT NOTES · " + ("FIRST LOOK" if STEP == "1" else "SECOND LOOK")); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
k = keys(); ANON, SVC = k.get("anon", ""), k.get("service_role", "")
if not ANON or not SVC: bad("could not read the project's keys. Nothing was changed."); done(4)
HIDE += [ANON, SVC]
H = {"apikey": SVC, "Authorization": "Bearer " + SVC}

if STEP == "1":
    say("PART 1 · READ ONLY")
    for name, want in SHAS.items():
        p = os.path.join(FNROOT, "_shared", "job-auth.ts") if name == "_shared/job-auth" else os.path.join(FNROOT, name, "index.ts")
        if hashlib.sha256(open(p, "rb").read()).hexdigest() != want: bad(f"{name} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
    say("  ✓ the read-only function and the shared lock are the reviewed builds")
    say(); say("PART 2 · INSTALL THE READ-ONLY CHECK")
    p = subprocess.run([SUPA, "functions", "deploy", FN, "--project-ref", REF, "--use-api"], cwd=os.path.dirname(os.path.dirname(FNROOT)),
                       env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    if p.returncode != 0: bad("deploy failed: " + (p.stderr or p.stdout)[-240:]); done(6)
    say("  ✓ notes-audit installed (reads only; answers only your server key)")
    time.sleep(float(os.environ.get("SB_SETTLE", "8")))
    r0 = http("POST", f"{FNB}/functions/v1/{FN}?m0=1", {}, {})[0]; r1 = http("POST", f"{FNB}/functions/v1/{FN}?m0=1", {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
    (say if r0 == 401 and r1 == 401 else bad)(("  ✓ " if r0 == 401 and r1 == 401 else "") + f"no key {r0}, the public key {r1} → refused")
    say(); say("PART 3 · WHAT AXISCARE SHOWS (last 14 days; counts only)")
    s, b = http("POST", f"{FNB}/functions/v1/{FN}?m0=1&days=14", {}, H)
    try: j = json.loads(b)
    except Exception: j = None
    if s != 200 or not isinstance(j, dict) or j.get("error"): bad(f"the check did not answer ({s}): " + str((j or {}).get('error') if isinstance(j, dict) else b)[:160]); done(7)
    say(f"  window {j['window']} · visits {j['visits_listed']} · started {j['visits_started']} · read {j['visits_read']}"
        + (" · AxisCare asked us to slow down, so some were not read" if j.get("stopped_early_slow_down") else ""))
    say(f"  finished (clocked out): {j['visits_finished']} · started but not clocked out: {j['visits_not_clocked_out']}")
    say(f"  how caregivers clocked in: {fmt(j.get('clock_in_methods'))}")
    say()
    say("  1 · THE COUNTING RULE")
    say(f"    caregiver + client + day groups: {j['groups']} · with more than one visit: {j['multi_visit_groups']}")
    say(f"      the same note came back on every visit: {j['multi_same_note_on_every_visit']} · different notes on different visits: {j['multi_different_notes']} · a note on some visits only: {j['multi_note_on_some_visits_only']}")
    rule_ok = j["multi_visit_groups"] > 0 and j["multi_different_notes"] == 0 and j["multi_note_on_some_visits_only"] == 0
    say("    → " + ("proven: one note per caregiver, client and day (every multi-visit day returned one shared note)" if rule_ok
                    else "NOT proven yet: " + ("no day had more than one visit, so the rule couldn't be tested" if not j["multi_visit_groups"] else "some days carry different notes per visit; tell Claude")))
    say()
    say("  2 · SHIFTS THAT ENDED WITHOUT A NOTE")
    say(f"    with a note: {j['groups_with_note']} · without: {j['groups_missing_note']}")
    say(f"    without a note, by how they clocked out: {fmt(j.get('missing_by_clock_out'))}")
    say(f"    with a note, by how they clocked out: {fmt(j.get('with_note_by_clock_out'))}")
    say(f"    caregivers: {j['caregivers']} · with at least one missed: {j['caregivers_missing_1_plus']} · with three or more in these 14 days: {j['caregivers_missing_3_plus']} (not counting phone clock-outs: {j['caregivers_missing_3_plus_not_phone']}) · most by one caregiver: {j['most_missing_one_caregiver']}")
    snap = j.get("snapshot") or []
    os.makedirs(os.path.dirname(SNAP), exist_ok=True)
    json.dump({"at": dt.datetime.now(dt.timezone.utc).isoformat(), "snapshot": snap}, open(SNAP, "w"))
    say()
    say(f"  ✓ the {len(snap)} shifts without a note are saved on this Mac (AxisCare ID numbers only) for the second look")
    say()
    say("RESULT: FIRST LOOK DONE · nothing was sent or changed.")
    say("NEXT: run 336 in 24 hours or more. Between now and then, please ask the office NOT to type any care notes into")
    say("AxisCare, or to tell Claude which ones they did, so any note that appears can only have come from the caregiver.")
    done(0 if not fails else 8)

# ── step 2 · the second look ──
say("PART 1 · READ ONLY")
try: saved = json.load(open(SNAP))
except Exception: saved = None
if not saved or not isinstance(saved.get("snapshot"), list): bad("the first look's list isn't on this Mac (run 335 first)."); done(4)
age_h = (dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(saved["at"])).total_seconds() / 3600
say(f"  ✓ the first look's list: {len(saved['snapshot'])} shifts without a note, saved {age_h:.0f} hours ago")
if age_h < 20: say("  · it's been less than a day; the result is less telling (a note written late may not have had time)")
say(); say("PART 2 · THOSE SAME SHIFTS, AGAIN")
s, b = http("POST", f"{FNB}/functions/v1/{FN}?recheck=1", {"snapshot": saved["snapshot"]}, H)
try: j = json.loads(b)
except Exception: j = None
if s != 200 or not isinstance(j, dict) or j.get("error"): bad(f"the check did not answer ({s})"); done(7)
say(f"  read again: {j['checked']} · now have a note: {j['now_has_note']} · still no note: {j['still_missing']}" + (f" · couldn't be read: {j['unreadable']}" if j.get("unreadable") else ""))
by = {}
for e in saved["snapshot"]:
    m = str(e.get("k", "")).split("|")[-1] if "|" in str(e.get("k", "")) else "?"
    by[m] = by.get(m, 0) + 1
say(f"  (the first look's list, by how they clocked out: {fmt(by)})")
first_at = dt.datetime.fromisoformat(saved["at"])
def recent(e):
    try: return (first_at - dt.datetime.fromisoformat(str(e.get("e", "")).replace("Z", "+00:00"))).total_seconds() <= 24 * 3600
    except Exception: return False
rec = [e for e in saved["snapshot"] if recent(e)]
gained = set(j.get("gained") or [])
rec_gained = [e for e in rec if e.get("v") in gained]
say(f"  the telling ones, shifts that had ended within a day of the first look: {len(rec)} · of those, now have a note: {len(rec_gained)}"
    + (" (by how they clocked out: " + fmt({m: sum(1 for e in rec_gained if str(e.get('k','')).split('|')[-1] == m) for m in {str(e.get('k','')).split('|')[-1] for e in rec_gained}}) + ")" if rec_gained else ""))
say()
if not rec: say("RESULT: no shift had ended recently enough at the first look to tell. Run 335 again soon after an evening of shifts, then 336 a day later.")
elif j["now_has_note"] == 0: say(f"RESULT: none of the {len(rec)} recent shifts gained a note after clock-out. That supports your understanding: caregivers can't add a note once they've clocked out.")
else: say(f"RESULT: {j['now_has_note']} shift(s) gained a note after the first look ({len(rec_gained)} of them recent). If the office didn't type them, caregivers CAN add a late note. Tell Claude what the office entered.")
say("Nothing was sent or changed. When you're done with M0, the notes-audit function can be removed (nothing else uses it).")
done(0 if not fails else 8)
