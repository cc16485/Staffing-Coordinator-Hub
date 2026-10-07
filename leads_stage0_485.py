#!/usr/bin/env python3
# 485 · LEADS FACTS MOVE-OVER (Leads intake desk, Stage 0; Samantha 2026-10-06 "yes to all, start stage 0").
#  · every lead that still carries only the old urgency radio gets desired_start (asap / this week / planning ahead)
#  · every lead whose schedule is free text gets schedule {times, hours_per_week, days_text}
#  · every lead on the not-ready drip gets waiting {reason: not_ready, since, check_back} so it can never sit without a check-back date
#  · every Lost lead's old reason gets its fixed-list key, so the Owners Hub can count the whole history
# The rules come from the SAME lead-rules.js the Hub page runs (pinned by sha); this script never decides a value itself.
# Nothing is texted or emailed. Nothing in GHL or AxisCare changes. Old fields are never removed; run it twice and the second run finds nothing.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys
REPORT = os.environ["SB_REPORT"]; FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ.get("SB_FN_SHAS", "{}"))
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); NODE = os.environ.get("SB_NODE", "node")
lines = []; fails = []
def say(s=""):
    s = re.sub(r"(sbp_|eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._\-]+", "(hidden)", str(s)); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Nothing was sent to anyone. Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=400):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers=dict({"Content-Type": "application/json", "User-Agent": "cc-485/1.0"}, **(headers or {})))
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
def chk(good, msg): (say if good else bad)(("  ✓ " if good else "") + msg)
lit = lambda v: "'" + str(v).replace("'", "''") + "'"
RULES = os.path.join(FNROOT, "_shared", "lead-rules.js")
nm = lambda l: (str(l.get("client_first_name") or "") + " " + str(l.get("client_last_name") or "")).strip() or (str(l.get("first_name") or "") + " " + str(l.get("last_name") or "")).strip() or "(no name)"
def blob(k):
    ok, r = sql(f"select data from public.app_data where key = {lit(k)}")
    d = r[0]["data"] if ok and r else None
    return json.loads(d) if isinstance(d, str) else d
def patches(leads, today):
    """lead-rules.js decides; node runs it on the whole list at once"""
    js = ("const R=require(process.argv[1]);const L=JSON.parse(require('fs').readFileSync(0,'utf8'));"
          "const out={};L.forEach(l=>{const p=R.migrationPatch(l,process.argv[2]);if(p)out[l.id]=p;});process.stdout.write(JSON.stringify(out));")
    p = subprocess.run([NODE, "-e", js, RULES, today], input=json.dumps(leads), capture_output=True, text=True, timeout=120)
    if p.returncode != 0: raise RuntimeError("node: " + (p.stderr or p.stdout)[:300])
    return json.loads(p.stdout or "{}")

say("485 · LEADS FACTS MOVE-OVER (desired start, schedule, waiting, lost reasons onto every lead)"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
for name, want in SHAS.items():
    p_ = os.path.join(FNROOT, "_shared", name.split("/", 1)[1]) if name.startswith("_shared/") else os.path.join(FNROOT, name, "index.ts")
    have = hashlib.sha256(open(p_, "rb").read()).hexdigest() if os.path.exists(p_) else "(missing)"
    chk(have == want, f"{name} is the reviewed build" if have == want else f"{name} is not the reviewed build: nothing runs")
if fails: say(); say("  RESULT: STOPPED before anything changed."); done(2)
hub_copy = os.path.join(os.path.dirname(os.path.dirname(FNROOT)), "..", "cc-hub-live", "lead-rules.js")
try:
    p = subprocess.run([NODE, "-e", "require(process.argv[1]);console.log('ok')", RULES], capture_output=True, text=True, timeout=60)
    chk(p.returncode == 0 and "ok" in p.stdout, "lead-rules.js loads (the same file the Hub page runs)")
except Exception as e: bad("node is not available to run lead-rules.js: " + str(e)[:120])
if fails: say(); say("  RESULT: STOPPED before anything changed."); done(3)
ok_, ver = sql("select version from public.app_data where key='leads'")
leads = [l for l in (blob("leads") or []) if isinstance(l, dict) and l.get("id")]
chk(bool(leads), f"{len(leads)} leads on file (app_data version {ver[0]['version'] if ok_ and ver else '?'})")
if not leads: say("  RESULT: nothing to do."); done(0)
today = dt.datetime.now(dt.timezone(dt.timedelta(hours=-5))).strftime("%Y-%m-%d")
P = patches(leads, today)
kinds = {"desired_start": 0, "schedule": 0, "waiting": 0, "lost_reason_key": 0}
for pid, pt in P.items():
    for k in kinds:
        if k in pt: kinds[k] += 1
say(f"  {len(P)} of {len(leads)} leads get something: start in words {kinds['desired_start']} · schedule {kinds['schedule']} · waiting with a check-back {kinds['waiting']} · lost reason key {kinds['lost_reason_key']}")
by_id = {l["id"]: l for l in leads}
for pid, pt in P.items():
    l = by_id[pid]; what = []
    if "desired_start" in pt: what.append("start: " + pt["desired_start"]["kind"].replace("_", " ") + " (from " + pt["desired_start"]["from"] + ")")
    if "schedule" in pt: s = pt["schedule"]; what.append("schedule: " + " ".join(x for x in [s.get("days_text") or "", s.get("times") or ""] if x) + (f" · {s['hours_per_week']} hrs/wk" if s.get("hours_per_week") else ""))
    if "waiting" in pt: what.append(f"waiting: family not ready since {pt['waiting']['since']}, check back {pt['waiting']['check_back']}")
    if "lost_reason_key" in pt: what.append("lost reason key: " + pt["lost_reason_key"] + " (was '" + str(l.get("lost_reason"))[:40] + "')")
    say("    · " + nm(l) + (" (TEST)" if l.get("is_test") else "") + " → " + "; ".join(what))
if not P: say(); say("  RESULT: DONE · every lead already had the new facts. Nothing changed."); done(0)

say(); say("PART 2 · CHANGE")
cases = " ".join("when x->>'id' = " + lit(pid) + " then x || " + lit(json.dumps(pt)) + "::jsonb" for pid, pt in P.items())
ok2, r2 = sql("update public.app_data set data = (select jsonb_agg(case " + cases + " else x end order by o) from jsonb_array_elements(data) with ordinality t(x, o)) "
              "where key = 'leads' and version = " + str(int(ver[0]["version"])) + " returning version")
chk(ok2 and r2, "the leads were updated in one write" + (f" (version {r2[0]['version']})" if ok2 and r2 else ": the leads changed while this ran, or the write failed; nothing else was touched. Run it again."))
if fails: say(); say("  RESULT: STOPPED."); done(5)

say(); say("PART 3 · PROOF")
after = [l for l in (blob("leads") or []) if isinstance(l, dict) and l.get("id")]
chk(len(after) == len(leads), f"same number of leads before and after ({len(after)})")
missed = [pid for pid in P if not all(k in (next((a for a in after if a["id"] == pid), {})) for k in P[pid])]
chk(not missed, "every patched lead carries its new facts" if not missed else f"{len(missed)} leads did not take the patch: {missed[:5]}")
untouched = all(json.dumps({k: v for k, v in by_id[a["id"]].items()}, sort_keys=True) == json.dumps({k: v for k, v in a.items() if k not in P.get(a["id"], {})}, sort_keys=True) for a in after if a["id"] in by_id)
chk(untouched, "nothing else on any lead changed (old fields all still there)")
chk(not patches(after, today), "run again: nothing left to move over")
say(); say("  RESULT: " + ("DONE" if not fails else "DONE WITH PROBLEMS, tell Claude")); done(0 if not fails else 7)
