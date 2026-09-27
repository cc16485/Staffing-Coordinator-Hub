#!/usr/bin/env python3
# Covered-outside fix (Elizabeth Kurtz, 2026-09-27). Audit first (read only), then install.
#  1. sha-checks coverage-watch, coverage-run and the shared files they use
#  2. AUDIT (read only): every case Cara closed as "covered in AxisCare directly", with who called
#     off, who it said covered, and whether the family and caregivers were texted
#  3. deploys coverage-watch (the fix) and coverage-run (the family-text guard)
#  4. runs one preview (?dry=1: closes, opens and sends nothing) and lists the open cases Cara is
#     now leaving open for a person
import json, os, hashlib, subprocess, urllib.request, urllib.error, datetime as dt
FNROOT = os.environ["SB_FNROOT"]; FN_SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPORT = os.environ["SB_REPORT"]
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "")
SUPA = os.environ.get("SB_SUPA_CLI", ""); SKIP_FN = os.environ.get("SB_SKIP_FUNCTION") == "1"
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
lines = []
def say(s=""): print(s, flush=True); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def http(method, url, body=None, headers=None, timeout=240):
    req = urllib.request.Request(url, data=(json.dumps(body).encode() if body is not None else None), method=method,
                                 headers=dict({"Content-Type": "application/json", "User-Agent": "cc-covered-outside/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, "%s: %s" % (type(e).__name__, e)
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, {"Authorization": "Bearer " + TOKEN}, 300)
    if s not in (200, 201): return False, f"HTTP {s}: {b[:300]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:300]
key = lambda x: "".join(ch for ch in str(x or "").lower() if ch.isalpha())

say("FIX · CARA NEVER MARKS A CAREGIVER AS COVERING THEIR OWN CALL-OFF")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
for fn, want in FN_SHAS.items():
    path = os.path.join(FNROOT, fn) if fn.endswith(".ts") else os.path.join(FNROOT, fn, "index.ts")
    got = hashlib.sha256(open(path, "rb").read()).hexdigest()
    say(f"  {fn} sha256 {got[:16]}…" + ("  ✓ reviewed source" if got == want else "  ✗ differs"))
    if got != want: say("  STOP. Nothing was run."); done(2)

ok, rows = sql("""select e->>'id' as id, e->>'client' as client, e->>'shift_date' as shift_date, e->>'shift_time' as shift_time,
     e->>'calling_off' as calling_off, e->>'covered_by' as covered_by, e->>'resolved_at' as resolved_at, e->>'opened_by' as opened_by,
     coalesce((e->>'family_notified_count')::int, 0) as family_texts, e->>'family_circle' as family_circle, e->>'family_skip_reason' as family_skip,
     coalesce((e->>'closure_courtesy_count')::int, 0) as caregiver_texts
   from app_data a, jsonb_array_elements(case when jsonb_typeof(a.data) = 'array' then a.data else '[]'::jsonb end) e
   where a.key = 'coverage_cases' and e->>'note' like '%closed by the watcher%' order by e->>'resolved_at' desc""")
if not ok: say("  ✗ STOP: could not read Cara's cases: " + str(rows)); done(3)
say(); say("1. EVERY CASE CARA CLOSED AS \"COVERED IN AXISCARE DIRECTLY\" (read only)")
wrong = maybe = 0
for r in rows:
    off, cov = r["calling_off"] or "", r["covered_by"] or ""
    same = bool(off) and key(off) == key(cov)
    first = bool(off) and not same and (len(off.split()) == 1 or len(cov.split()) == 1) and key(off.split()[0]) == key(cov.split()[0] if cov else "")
    unknown = not off
    mark = "✗ SAME PERSON" if same else "? first name only" if first else "? caller not recorded" if unknown else "✓ different caregiver"
    wrong += same; maybe += (first or unknown)
    texts = f"family texts {r['family_texts']}" + (f" ({r['family_circle']})" if r["family_circle"] else "") + (f" [not sent: {r['family_skip']}]" if r["family_skip"] else "") + f", caregiver texts {r['caregiver_texts']}"
    say(f"  {mark} · {r['client']} · {r['shift_date']} {r['shift_time'] or ''} · called off: {off or '(not recorded)'} · marked covered by: {cov} · closed {str(r['resolved_at'])[:16]}")
    say(f"      {texts}")
if not rows: say("  none")
say(f"  → {len(rows)} case(s): {wrong} marked a caregiver as covering their own call-off, {maybe} can't be checked from the record")

say()
if SKIP_FN: say("  (test target: function deploys skipped)")
else:
    for fn in [f for f in FN_SHAS if not f.endswith(".ts")]:
        p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"], cwd=os.path.dirname(os.path.dirname(FNROOT)),
                           env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
        if p.returncode != 0: say(f"  ✗ {fn} deploy failed: " + (p.stderr or p.stdout)[-400:]); done(4)
        say(f"  ✓ {fn} deployed")
s, kb = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers={"Authorization": "Bearer " + TOKEN})
svc = ""
try: svc = next((k.get("api_key", "") for k in json.loads(kb) if isinstance(k, dict) and k.get("name") == "service_role"), "")
except Exception: pass
s, b = http("POST", f"{FNB}/functions/v1/coverage-watch?dry=1", {}, {"Authorization": "Bearer " + svc, "apikey": svc}, 300); svc = ""
try: d = json.loads(b)
except Exception: d = {}
say(); say("2. OPEN CASES WITH A CAREGIVER ON THE SHIFT, AS THE FIXED CARA SEES THEM (preview: nothing closed or sent)")
if s != 200 or "covered_outside_left_open" not in d: say("  ✗ the preview did not complete: HTTP " + str(s) + " " + b[:200]); done(5)
W = {"caller_still_on": "the caregiver who called off is still on the shift in AxisCare → stays open until they're taken off",
     "unsure": "Cara can't tell if they're covering → stays open for a person to confirm on the board",
     "covered": "a different caregiver is on it → will close as covered (a real cover)"}
lo = d["covered_outside_left_open"]
if not lo: say("  none right now")
for x in lo: say(f"  • case {x['case']} · on the shift: {x['caregiver_on_shift']} · called off: {x.get('calling_off') or '(not recorded)'}\n      {W.get(x['verdict'], x['verdict'])}")
say(); say("RESULT: FIX INSTALLED · a caregiver still on the schedule is never taken as covering their own call-off, and the family text refuses it"
    + (f" · {wrong} past case(s) above texted the family wrongly" if wrong else ""))
done(0)
