#!/usr/bin/env python3
# L0 · RUNNING LATE · the read-only look (Desktop 362). Nothing is sent; nothing is written in AxisCare, GoHighLevel
# or the Hub. Counts only.
#   Installs the read-only late-watch function (the owner's server key only), then, for the last 14 days: how often
#   caregivers texted or called the office in the 2 hours before a shift, how the AI reads those texts (running late,
#   can't make it, something else), whether the time they gave matched their clock-in, how many late clock-ins had a
#   heads-up, and how many clients have a Family Circle member who could get the text.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, time
REPORT = os.environ["SB_REPORT"]
FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ.get("SB_FN_SHAS", "{}"))
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
BATCH = int(os.environ.get("SB_BATCH", "4"))
FN = "late-watch"
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for v in HIDE: s = s.replace(v, "(hidden)")
    s = re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", s); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Nothing was sent or changed.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=400):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers=dict({"Content-Type": "application/json", "User-Agent": "cc-l0/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def keys():
    s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers=MG())
    try: return {k.get("name"): k.get("api_key", "") for k in json.loads(b)}
    except Exception: return {}
pct = lambda a, b: f"{round(100 * a / b)}%" if b else "n/a"

say("L0 · RUNNING LATE · THE LOOK (read only)"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
k = keys(); ANON, SVC = k.get("anon", ""), k.get("service_role", "")
if not ANON or not SVC: bad("could not read the project's keys. Nothing was changed."); done(4)
HIDE += [ANON, SVC]
H = {"apikey": SVC, "Authorization": "Bearer " + SVC}

say("PART 1 · INSTALL THE READ-ONLY LOOK")
for name, want in SHAS.items():
    p = os.path.join(FNROOT, "_shared", name.split("/", 1)[1] + ".ts") if name.startswith("_shared/") else os.path.join(FNROOT, name, "index.ts")
    if hashlib.sha256(open(p, "rb").read()).hexdigest() != want: bad(f"{name} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
say("  ✓ the look and the shared files it uses are the reviewed builds")
s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{FN}", headers=MG())
say("  " + ("late-watch already exists on the project; it will be replaced by the reviewed build" if s == 200 else "late-watch is new on the project"))
p = subprocess.run([SUPA, "functions", "deploy", FN, "--project-ref", REF, "--use-api"], cwd=os.path.dirname(os.path.dirname(FNROOT)),
                   env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
if p.returncode != 0: bad("deploy failed: " + (p.stderr or p.stdout)[-240:]); done(6)
say("  ✓ late-watch installed (reads only; answers only your server key)")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
r0 = http("POST", f"{FNB}/functions/v1/{FN}?circles=1", {}, {})[0]; r1 = http("POST", f"{FNB}/functions/v1/{FN}?circles=1", {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
(say if r0 == 401 and r1 == 401 else bad)(("  ✓ " if r0 == 401 and r1 == 401 else "") + f"no key {r0}, the public key {r1} → refused")
if fails: say("  STOP before reading anything."); done(3)

say(); say("PART 2 · THE LAST 14 DAYS (counts only)")
say("  reading caregivers a few at a time (their texts, then the AI); this can take several minutes…")
c, off, first, batches = {}, 0, None, 0
while off is not None and batches < 60:
    s, b = http("POST", f"{FNB}/functions/v1/{FN}?l0=1&days=14&offset={off}&limit={BATCH}", {}, H)
    try: j = json.loads(b)
    except Exception: j = None
    if s != 200 or not isinstance(j, dict) or j.get("error"):
        bad(f"a batch did not answer ({s}): " + str((j or {}).get('error') if isinstance(j, dict) else b)[:160]); break
    first = first or j; batches += 1
    for k2, v2 in (j.get("counts") or {}).items(): c[k2] = c.get(k2, 0) + v2
    off = j.get("next_offset"); time.sleep(float(os.environ.get("SB_BATCH_PAUSE", "1")))
    if batches % 5 == 0: say(f"    …{batches} batches read")
if not first: done(7)
g = lambda n: c.get(n, 0)
say(f"  window {first['window']} · caregivers with shifts {first['caregivers_total']} · read in {batches} batches" + ("" if off is None else " · NOT FINISHED, the rest were not read"))
say()
say("  1 · THE SHIFTS")
say(f"    shifts that started: {g('shifts')} · on time (within 5 min): {g('shifts_on_time')} · 6–9 min late: {g('shifts_late_6_9')} · 10–29 min late: {g('shifts_late_10_29')} · 30+ min late: {g('shifts_late_30_plus')} · no clock-in: {g('shifts_no_clock_in')}")
say(f"    couldn't check: no phone on the roster {g('caregivers_no_phone_on_roster')} caregivers ({g('shifts_caregiver_no_phone')} shifts) · not found in GoHighLevel by their number {g('caregivers_not_in_ghl')} ({g('shifts_caregiver_not_in_ghl')} shifts)")
say()
say("  2 · TEXTS AND CALLS BEFORE A SHIFT (2 hours before the start, until they clocked in)")
say(f"    shifts with a text from the caregiver: {g('shifts_with_text')} · with a call: {g('shifts_with_call')} (calls are counted, not read; their words reach the Hub after Desktop 349)")
say(f"    the AI read those texts as: running late {g('ai_late')} · can't make it {g('ai_cant_make_it')} · something else {g('ai_other')} · couldn't read {g('ai_failed')} · unsure {g('ai_unsure')}")
say()
say("  3 · RUNNING LATE, AS THE AI READ IT")
say(f"    gave a time: {g('ai_late_with_time')} · gave no time (the Hub would ask them): {g('ai_late_no_time')}")
say(f"    told us before the start: {g('ai_late_told_before_start')} · after the start: {g('ai_late_told_after_start')}")
say(f"    expected 10+ minutes late (families would hear): {g('ai_late_eta_10_plus')}")
say(f"    then clocked in: on time {g('ai_late_then_on_time')} · 6–9 late {g('ai_late_then_late_6_9')} · 10–29 late {g('ai_late_then_late_10_29')} · 30+ late {g('ai_late_then_late_30_plus')} · never {g('ai_late_then_no_clock_in')}")
eta_n = g('eta_arrived_earlier_than_said') + g('eta_within_5_min') + g('eta_6_15_min_after') + g('eta_16_plus_min_after')
say(f"    the time they gave vs the clock-in ({eta_n} with both): within 5 min {g('eta_within_5_min')} · 6–15 min after {g('eta_6_15_min_after')} · 16+ min after {g('eta_16_plus_min_after')} · earlier than they said {g('eta_arrived_earlier_than_said')}")
say(f"    can't make it, then: never clocked in {g('ai_cant_make_it_then_no_clock_in')} · clocked in anyway {g('ai_cant_make_it') - g('ai_cant_make_it_then_no_clock_in')} (the visit may have been given to someone else)")
say()
say("  4 · LATE CLOCK-INS AND HEADS-UPS")
say(f"    shifts clocked in 10+ minutes late: {g('late10_total')} · with a text or call beforehand: {g('late10_heads_up_text_or_call')} ({pct(g('late10_heads_up_text_or_call'), g('late10_total'))}) · the AI read one as running late: {g('late10_ai_said_late')}")
say(f"    shifts never clocked in, with a text or call: {g('no_clock_in_heads_up_text_or_call')} of {g('shifts_no_clock_in')}")

say(); say("PART 3 · FAMILY CIRCLES (clients with shifts in the same 14 days)")
s, b = http("POST", f"{FNB}/functions/v1/{FN}?circles=1&days=14", {}, H)
try: cj = json.loads(b)
except Exception: cj = None
if s != 200 or not isinstance(cj, dict) or cj.get("error"): bad(f"the circle count did not answer ({s})")
else:
    cc = cj.get("counts") or {}; h2 = lambda n: cc.get(n, 0)
    say(f"  clients: {h2('clients_with_shifts')} · with a linked circle: {h2('one_linked_circle')} · with a member who could get the text: {h2('circle_has_member_who_can_get_it')} ({h2('members_who_can_get_it')} members)")
    say(f"  circle but nobody agreed to texts: {h2('circle_but_nobody_agreed_to_texts')} · no linked circle: {h2('no_linked_circle')} · two linked circles (never texted): {h2('two_linked_circles')}")

say(); say("RESULT")
if fails: say("  ✗ Not complete: " + "; ".join(fails)); say("  Nothing was sent or changed. Tell Claude."); done(1)
say("  ✓ DONE. Read only: nothing was sent, and nothing was changed in AxisCare, GoHighLevel or the Hub.")
say("  Tell Claude \"I ran 362\".")
done(0)
