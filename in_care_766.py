#!/usr/bin/env python3
# 766 · RECEIVING CARE: NO MORE INTAKE CARDS. Samantha 2026-10-15, after report 765 (Dan Probstfield, Edward Anderson,
# Peggy Thomason: receiving care in AxisCare, journeys still at Intake, an urgent card each on Krystal's My Work):
# "Yes, build the fix: mark those three as receiving care, clear their cards, and stop new intake journeys for active clients."
#   client-journey: the sweep marks an open journey "receiving care" (status active) when the AxisCare client role is active,
#   AxisCare has a completed shift in the last 4 weeks, and the journey is still at intake, pre-checks or the assessment. The
#   reason goes in the history, the My Work cards are put away, the steps are kept. A new journey (the sweep for a contacted
#   lead, the move-over, the Start button) is not started for a client receiving care. Never texts or emails anyone.
# Part 1 (read only): the reviewed build; the tests pass here; the live client-journey is main's own code; who could change.
# Part 2: client-journey deployed (its gateway setting kept). Part 3 (proof): the live copy is the build; the sweep runs once;
# what happened to each client receiving care whose journey was open.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
REF = "zngsgedlsxinbygwmxwn"
HUB = os.environ["SB_REPO"]; BASE = os.environ.get("SB_BASE", ""); WANT = os.environ.get("SB_FN_SHA", "")
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FN = "client-journey"; TESTS = ["client_journey_test.mjs", "care_test.mjs"]
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for h in HIDE:
        if h: s = s.replace(h, "(hidden)")
    s = re.sub(r"(sbp_|eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._\-]+", "(hidden)", s)
    print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Anything done above stays done; nothing after it ran. Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=200):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-766/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    if not re.match(r"^\s*(select|with)\b", q, re.I): return False, "refused: not a read"
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, f"HTTP {s}: {b[:300]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:200]
def fmeta(fn):
    s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{fn}", headers=MG())
    try: return s, (json.loads(b) if s == 200 else None)
    except Exception: return s, None
def keys():
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_secret_") or v.startswith("sb_publishable_")) and "·" not in v and "*" not in v
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys{q}", headers=MG())
        if s != 200: continue
        try: arr = json.loads(b)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        got = {k.get("name"): k.get("api_key", "") for k in arr if isinstance(k, dict)}
        got = {k: v for k, v in got.items() if usable(v)}
        if got.get("service_role"): return got
    return {}
shab = lambda b: hashlib.sha256(b).hexdigest()
sha = lambda p: shab(open(p, "rb").read())
def chk(good, msg): (say if good else bad)(("  ✓ " if good else "") + msg)
def git(*a): return subprocess.run(["git", *a], cwd=HUB, capture_output=True)
def deps(path, seen):
    if path in seen or not os.path.exists(path): return
    seen.add(path)
    for m in re.findall(r"""from\s+['"](\.{1,2}/[^'"]+)['"]|import\s+['"](\.{1,2}/[^'"]+)['"]""", open(path).read()):
        deps(os.path.normpath(os.path.join(os.path.dirname(path), m[0] or m[1])), seen)
def need():
    s = set(); deps(os.path.join(HUB, f"supabase/functions/{FN}/index.ts"), s)
    return {os.path.relpath(x, HUB).replace(os.sep, "/") for x in s}
def base_sha(rel):
    b = git("show", f"{BASE}:{rel}")
    return shab(b.stdout) if b.returncode == 0 else None
def live_files():
    tmp = tempfile.mkdtemp(prefix="cl766-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
    d = subprocess.run([SUPA, "functions", "download", FN, "--project-ref", REF, "--use-api"], cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    live = {}
    for r, _, files in os.walk(tmp):
        for f in files:
            lp = os.path.join(r, f).replace(os.sep, "/")
            if "/functions/" in lp: live["supabase/functions/" + lp.split("/functions/", 1)[1]] = sha(lp)
    shutil.rmtree(tmp, ignore_errors=True)
    return d.returncode == 0, live
def state():
    s, m = fmeta(FN)
    if s == 404: return "new", None
    vj = (m or {}).get("verify_jwt")
    okd, live = live_files()
    if not okd or not isinstance(vj, bool): return "unreadable", vj
    nd = need()
    if all(k in live and live[k] == sha(os.path.join(HUB, k)) for k in nd): return "this", vj
    if all(k in live and live[k] == base_sha(k) for k in nd): return "base", vj
    return "other", vj
lit = lambda v: "'" + str(v).replace("'", "''") + "'"
IN_CARE_Q = """select j.journey_id::text as journey_id, j.client_name, j.axiscare_client_id, j.status, j.created_at::text as created_at
  from public.client_journey j
  join public.person_source_id s on s.system = 'axiscare' and s.entity_type = 'client' and s.source_id = j.axiscare_client_id
  join public.person_role r on r.person_id = s.person_id and r.role = 'client' and r.status = 'active'
 where j.subject = 'client' and j.status = 'open' and not coalesce(j.is_test, false) order by j.client_name"""

say("766 · RECEIVING CARE: NO MORE INTAKE CARDS"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
if not BASE or git("cat-file", "-e", BASE + "^{commit}").returncode != 0: bad("the reviewed starting point isn't in the Hub server history"); say("  STOP. Nothing was run."); done(2)
rel = f"supabase/functions/{FN}/index.ts"
if sha(os.path.join(HUB, rel)) != WANT: bad("client-journey is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
other = sorted(k for k in need() if k != rel and base_sha(k) != sha(os.path.join(HUB, k)))
if other: bad("other changes merged since the review touch client-journey (" + ", ".join(other)[:200] + "). Ask Claude to refresh 766."); say("  STOP. Nothing was run."); done(2)
say("  ✓ client-journey is the reviewed build, and nothing else it uses has changed since")
NODE = shutil.which("node") or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.path.exists(p)), "")
if NODE:
    for t in TESTS:
        p = subprocess.run([NODE, t], cwd=HUB, capture_output=True, text=True)
        last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
        if p.returncode != 0: bad(f"{t} failed: {last}"); say("  STOP. Nothing was changed."); done(2)
        say(f"  ✓ {t}: {last.strip()}")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
st, vj = state()
if st not in ("base", "this"): bad(f"client-journey on the server is not what 766 expects ({st}). Nothing was changed. Tell Claude."); say("  STOP."); done(2)
say("  ✓ the live client-journey is " + ("already this build" if st == "this" else "main's own code from before this change"))
ok, before = sql(IN_CARE_Q)
if not ok: bad("could not read the open journeys: " + str(before)); say("  STOP. Nothing was changed."); done(2)
say(f"  · open journeys whose AxisCare client is active: {len(before)}" + ("" if not before else " (" + ", ".join(f"{r['client_name']} #{r['axiscare_client_id']}" for r in before) + ")"))
say("    The sweep changes one only if AxisCare also has a completed shift in the last 4 weeks AND the journey is still at")
say("    intake, pre-checks or the assessment.")
K = keys(); SR = K.get("service_role", ""); HIDE.extend(K.values())
if not SR: bad("could not get the server key for the proof sweep"); say("  STOP. Nothing was changed."); done(2)
say("  ✓ the server key for the proof sweep is in hand")
say()

say("PART 2 · CHANGE")
if st == "this": say("  · client-journey already deployed: nothing to deploy")
else:
    p = subprocess.run([SUPA, "functions", "deploy", FN, "--project-ref", REF, "--use-api"] + ([] if vj in (True, None) else ["--no-verify-jwt"]), cwd=HUB, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    okd, live = live_files()
    if not (okd and all(k in live and live[k] == sha(os.path.join(HUB, k)) for k in need())):
        bad("client-journey didn't deploy: " + (p.stderr or p.stdout)[-200:]); say("  STOP. The old client-journey is still live; nothing else changed."); done(1)
    want = True if vj is None else vj
    sN, mN = fmeta(FN)
    if (mN or {}).get("verify_jwt") != want:
        http("PATCH", f"{API}/v1/projects/{REF}/functions/{FN}", {"verify_jwt": want}, MG()); sN, mN = fmeta(FN)
    chk((mN or {}).get("verify_jwt") == want, f"client-journey deployed, version {(mN or {}).get('version', '?')} (gateway sign-in check {'on' if want else 'off'})")
say()

say("PART 3 · PROOF")
okd, live = live_files()
chk(okd and all(k in live and live[k] == sha(os.path.join(HUB, k)) for k in need()), "client-journey: the live copy is exactly the reviewed build")
s, b = http("POST", f"{FNB}/functions/v1/{FN}", {"action": "sweep"}, {"Authorization": "Bearer " + SR, "apikey": SR}, timeout=300)
try: sw = json.loads(b)
except Exception: sw = {}
if s != 200 or not sw.get("ok"): bad(f"the sweep did not run: HTTP {s} {str(b)[:200]}")
elif sw.get("live") is False: say("  · client journeys are switched off, so the sweep changed nothing (it will when they are on)")
else:
    ic = sw.get("in_care"); say(f"  ✓ the sweep ran: {ic} journey(s) marked receiving care" + (f", {sw.get('in_care_unknown')} not checked (AxisCare didn't answer; the next sweep tries again)" if sw.get("in_care_unknown") else ""))
    if isinstance(sw.get("error"), str): bad("the receiving-care step stopped: " + sw["error"])
ids = [r["journey_id"] for r in before]
if ids:
    inlist = ",".join(lit(x) + "::uuid" for x in ids)
    ok1, js = sql(f"select journey_id::text as journey_id, client_name, axiscare_client_id, status from public.client_journey where journey_id in ({inlist}) order by client_name")
    ok2, ev = sql(f"select journey_id::text as journey_id, reason from public.client_journey_event where kind = 'already_in_care' and journey_id in ({inlist})")
    ok3, oi = sql("select data from public.app_data where key = 'ops_items'")
    if not (ok1 and ok2 and ok3): bad("could not read back the journeys")
    else:
        why = {e["journey_id"]: e.get("reason") or "" for e in ev}
        items = oi[0]["data"] if oi and isinstance(oi[0].get("data"), list) else []
        for j in js:
            cards = [x for x in items if isinstance(x, dict) and x.get("journey_id") == j["journey_id"] and x.get("status") == "open"]
            if j["status"] == "active":
                chk(j["journey_id"] in why and not cards, f"{j['client_name']} #{j['axiscare_client_id']}: receiving care, {len(cards)} open card(s). {why.get(j['journey_id'], '')}")
            else:
                say(f"  · {j['client_name']} #{j['axiscare_client_id']}: left as it was ({j['status']}): no shift in AxisCare in the last 4 weeks, or past the assessment, or AxisCare didn't answer. {len(cards)} open card(s).")
s2, _ = http("POST", f"{FNB}/functions/v1/{FN}", {"action": "sweep"}, {"Authorization": "Bearer " + K.get("anon", "x" * 40), "apikey": K.get("anon", "")})
chk(s2 in (401, 403), f"client-journey still refuses the sweep from a public key ({s2})")
say()
say("RESULT: " + ("DONE" if not fails else "FINISHED WITH PROBLEMS (marked ✗ above). Tell Claude."))
say("Nothing was texted or emailed. Steps and history were kept; nothing was deleted.")
say("Rollback: Claude redeploys client-journey from the build before 766 and sets those journeys back to open.")
done(0 if not fails else 1)
