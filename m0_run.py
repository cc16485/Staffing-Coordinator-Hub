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
BATCH = int(os.environ.get("SB_BATCH", "30"))
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

def read_rows():
    say("  reading every finished shift one at a time, in batches (this can take several minutes)…")
    rows, clock_in, not_out, limited, off, first, batches = [], {}, 0, False, 0, None, 0
    while off is not None and batches < 40:
        s, b = http("POST", f"{FNB}/functions/v1/{FN}?m0=1&days=14&offset={off}&limit={BATCH}", {}, H)
        try: j = json.loads(b)
        except Exception: j = None
        if s != 200 or not isinstance(j, dict) or j.get("error"): bad(f"a batch did not answer ({s}): " + str((j or {}).get('error') if isinstance(j, dict) else b)[:160]); break
        first = first or j; batches += 1
        rows += j.get("rows") or []; not_out += j.get("visits_not_clocked_out") or 0
        for k2, v2 in (j.get("clock_in_methods") or {}).items(): clock_in[k2] = clock_in.get(k2, 0) + v2
        if j.get("stopped_early_slow_down"): limited = True; break
        off = j.get("next_offset"); time.sleep(float(os.environ.get("SB_BATCH_PAUSE", "2")))
    return rows, clock_in, not_out, limited, first, batches

def deploy_checked():
    for name, want in SHAS.items():
        p = os.path.join(FNROOT, "_shared", "job-auth.ts") if name == "_shared/job-auth" else os.path.join(FNROOT, name, "index.ts")
        if hashlib.sha256(open(p, "rb").read()).hexdigest() != want: bad(f"{name} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
    say("  ✓ the read-only function and the shared lock are the reviewed builds")
    p = subprocess.run([SUPA, "functions", "deploy", FN, "--project-ref", REF, "--use-api"], cwd=os.path.dirname(os.path.dirname(FNROOT)),
                       env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    if p.returncode != 0: bad("deploy failed: " + (p.stderr or p.stdout)[-240:]); done(6)
    say("  ✓ notes-audit installed (reads only; answers only your server key)")
    time.sleep(float(os.environ.get("SB_SETTLE", "8")))

say("M0 · MISSED SHIFT NOTES · " + ("FIRST LOOK" if STEP == "1" else "SECOND LOOK")); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
k = keys(); ANON, SVC = k.get("anon", ""), k.get("service_role", "")
if not ANON or not SVC: bad("could not read the project's keys. Nothing was changed."); done(4)
HIDE += [ANON, SVC]
H = {"apikey": SVC, "Authorization": "Bearer " + SVC}

if STEP == "1":
    say("PART 1 · READ ONLY AND INSTALL THE READ-ONLY CHECK")
    deploy_checked()
    r0 = http("POST", f"{FNB}/functions/v1/{FN}?m0=1", {}, {})[0]; r1 = http("POST", f"{FNB}/functions/v1/{FN}?m0=1", {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
    (say if r0 == 401 and r1 == 401 else bad)(("  ✓ " if r0 == 401 and r1 == 401 else "") + f"no key {r0}, the public key {r1} → refused")
    say(); say("PART 3 · WHAT AXISCARE SHOWS (last 14 days; counts only)")
    rows, clock_in, not_out, limited, first, batches = read_rows()
    if not first: done(7)
    groups = {}
    for r in rows: groups.setdefault(f"{r['cg']}|{r['cl']}|{r['d']}", []).append(r)
    multi = [g for g in groups.values() if len(g) > 1]
    same = sum(1 for g in multi if all(x["n"] for x in g) and len({x["f"] for x in g}) == 1)
    some = sum(1 for g in multi if any(x["n"] for x in g) and not all(x["n"] for x in g))
    diff = sum(1 for g in multi if all(x["n"] for x in g) and len({x["f"] for x in g}) > 1)
    miss_by, with_by, per, per_np, snap = {}, {}, {}, {}, []
    for k2, g in groups.items():
        last = sorted(g, key=lambda x: x["e"])[-1]; m = last["o"]
        per.setdefault(last["cg"], 0); per_np.setdefault(last["cg"], 0)
        if any(x["n"] for x in g): with_by[m] = with_by.get(m, 0) + 1
        else:
            miss_by[m] = miss_by.get(m, 0) + 1; per[last["cg"]] += 1
            if m != "phone": per_np[last["cg"]] += 1
            snap.append({"v": last["v"], "k": k2 + "|" + m, "e": last["e"]})
    read_total = len(rows) + not_out
    say(f"  window {first['window']} · visits {first['visits_listed']} · started {first['visits_started']} · read {read_total} in {batches} batches"
        + (" · AxisCare kept asking us to slow down, so the rest were not read" if limited else ""))
    say(f"  finished (clocked out): {len(rows)} · started but not clocked out: {not_out}")
    say(f"  how caregivers clocked in: {fmt(clock_in)}")
    say()
    say("  1 · THE COUNTING RULE")
    say(f"    caregiver + client + day groups: {len(groups)} · with more than one visit: {len(multi)}")
    say(f"      the same note on every visit: {same} · different notes on different visits: {diff} · a note on some visits only: {some}")
    rule_ok = len(multi) > 0 and diff == 0 and some == 0
    say("    → " + ("proven: one note per caregiver, client and day (every multi-visit day returned one shared note)" if rule_ok
                    else "NOT proven yet: " + ("no day had more than one visit, so the rule couldn't be tested" if not multi else "some days carry different notes per visit, or a note on only some visits; tell Claude")))
    say()
    say("  2 · SHIFTS THAT ENDED WITHOUT A NOTE")
    with_n = sum(with_by.values()); miss_n = sum(miss_by.values())
    say(f"    with a note: {with_n} · without: {miss_n}")
    say(f"    without a note, by how they clocked out: {fmt(miss_by)}")
    say(f"    with a note, by how they clocked out: {fmt(with_by)}")
    c1 = sum(1 for n in per.values() if n >= 1); c3 = sum(1 for n in per.values() if n >= 3); c3np = sum(1 for n in per_np.values() if n >= 3)
    say(f"    caregivers: {len(per)} · with at least one missed: {c1} · with three or more in these 14 days: {c3} (not counting phone clock-outs: {c3np}) · most by one caregiver: {max(per.values() or [0])}")
    # (snap was built above from the rows)
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
say("PART 1 · READ ONLY AND UPDATE THE READ-ONLY CHECK")
deploy_checked()
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
say("  (The API can't say WHO wrote a care note or when; the office holding off, or telling Claude what it entered, is what")
say("   makes this proof. AxisCare support can also confirm whether the app lets a caregiver add a note after clock-out.)")
say()
say("PART 3 · WHAT \"WEB\" MEANS (last 14 days; clues only, counts only)")
rows, clock_in, not_out, limited, first, batches = read_rows()
by = {}
for r in rows: by.setdefault(r["o"], []).append(r)
def pct(n, d): return f"{n} of {d}" + (f" ({round(100*n/d)}%)" if d else "")
for m in sorted(by, key=lambda x: -len(by[x])):
    g = by[m]; n = len(g)
    exact = sum(1 for r in g if r.get("sched") == 0); near = sum(1 for r in g if r.get("sched") is not None and abs(r["sched"]) <= 1)
    say(f"  {m} clock-outs: {n}")
    say(f"    carry GPS: {pct(sum(1 for r in g if r.get('gps')), n)} · carry an address: {pct(sum(1 for r in g if r.get('loc')), n)}")
    say(f"    exactly on the scheduled end time: {pct(exact, n)} · within a minute: {pct(near, n)}")
    ci = {}
    for r in g: ci[r["i"]] = ci.get(r["i"], 0) + 1
    say(f"    how those caregivers clocked IN: {fmt(ci)}")
    mr = {}
    for r in g:
        if r.get("mr"): mr[r["mr"]] = mr.get(r["mr"], 0) + 1
    say(f"    the office's modification reasons: {fmt(mr) if mr else 'none recorded'}")
    say(f"    no care note: {pct(sum(1 for r in g if not r['n']), n)}")
w = by.get("web", []); a_ = by.get("app", [])
if w:
    wg = sum(1 for r in w if r.get("gps")) / len(w); ag = (sum(1 for r in a_ if r.get("gps")) / len(a_)) if a_ else 0
    we = sum(1 for r in w if r.get("sched") is not None and abs(r["sched"]) <= 1) / len(w)
    say()
    say("  → " + ("consistent with office-entered clock-outs: web clock-outs rarely carry GPS" + (" and usually land on the scheduled end time" if we >= 0.5 else "") + ", unlike app clock-outs." if wg < 0.2 and ag > 0.5
                  else "not conclusive from the data: tell Claude, and ask AxisCare support what \"Web\" records."))
say()
say("Nothing was sent or changed. When you're done with M0, the notes-audit function can be removed (nothing else uses it).")
done(0 if not fails else 8)
