#!/usr/bin/env python3
# 496 · FOUR AUDIT FIXES (Samantha 2026-10-07: "yes fix those four now", after the lifecycle audit).
#  · client-journey: the 10-minute check closes a client's journey (reason kept), puts away its My Work cards and finishes
#    its First shift launch once a person answered "care ended" on the AxisCare status change (client role 'former').
#  · campaign-auto: the daily autopilot never emails open leads, clients or family contacts by itself (her rule). When one
#    of those emails is due it puts one card on Samantha's My Work to send it herself from Campaigns. Caregivers unchanged.
#  · each function keeps its gateway sign-in setting exactly as it is now (read first, deployed to match, checked after).
#  (The other two fixes, the worded booking date and the "Waiting to be matched" list, are Hub page changes: no step.)
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil
REPORT = os.environ["SB_REPORT"]; FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ.get("SB_FN_SHAS", "{}"))
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
ROOT = os.path.dirname(os.path.dirname(FNROOT)); CJDIR = os.path.join(ROOT, "client-journey"); FNS = ["client-journey", "campaign-auto"]; FN = FNS[0]
lines = []; fails = []
def say(s=""):
    s = re.sub(r"(sbp_|eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._\-]+", "(hidden)", str(s)); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Anything done above stays done; nothing after it ran. Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=400):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers=dict({"Content-Type": "application/json", "User-Agent": "cc-496/1.0"}, **(headers or {})))
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
def fmeta(fn):
    s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{fn}", headers=MG())
    try: return s, (json.loads(b) if s == 200 else None)
    except Exception: return s, None
def chk(good, msg): (say if good else bad)(("  ✓ " if good else "") + msg)
sha = lambda p_: hashlib.sha256(open(p_, "rb").read()).hexdigest()
lit = lambda v: "'" + str(v).replace("'", "''") + "'"
def deps(path, seen):
    if path in seen or not os.path.exists(path): return
    seen.add(path)
    for m in re.findall(r"""from\s+['"](\.{1,2}/[^'"]+)['"]|import\s+['"](\.{1,2}/[^'"]+)['"]""", open(path).read()):
        deps(os.path.normpath(os.path.join(os.path.dirname(path), m[0] or m[1])), seen)
def need(fn):
    s = set(); deps(os.path.join(FNROOT, fn, "index.ts"), s)
    return {os.path.relpath(x, ROOT).replace(os.sep, "/") for x in s}
def live_files(fn):
    tmp = tempfile.mkdtemp(prefix="cc496-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
    d = subprocess.run([SUPA, "functions", "download", fn, "--project-ref", REF, "--use-api"], cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    live = {}
    for r, _, files in os.walk(tmp):
        for f in files:
            lp = os.path.join(r, f).replace(os.sep, "/")
            if "/functions/" in lp: live["supabase/functions/" + lp.split("/functions/", 1)[1]] = sha(lp)
    shutil.rmtree(tmp, ignore_errors=True)
    return d.returncode == 0, live

say("496 · FOUR AUDIT FIXES (care ended closes the journey; families never emailed by the schedule)"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
for name, want in SHAS.items():
    p_ = os.path.join(FNROOT, "_shared", name.split("/", 1)[1]) if name.startswith("_shared/") else os.path.join(FNROOT, name, "index.ts")
    have = sha(p_) if os.path.exists(p_) else "(missing)"
    chk(have == want, f"{name} is the reviewed build" if have == want else f"{name} is not the reviewed build: nothing runs")
if fails: say(); say("  RESULT: STOPPED before anything changed."); done(2)
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); say("  RESULT: STOPPED before anything changed."); done(2)
src_ca = open(os.path.join(FNROOT, "campaign-auto", "index.ts")).read(); src_cj = open(os.path.join(FNROOT, "client-journey", "index.ts")).read()
chk("FAMILY_AUDIENCES" in src_ca and "Campaign ready for you to send" in src_ca, "campaign-auto on disk holds every lead, client and family email for a person")
chk("closeEnded(" in src_cj, "client-journey on disk closes a journey when the client's care has ended")
ok, r = sql("select coalesce(data, '[]'::jsonb) as d from public.app_data where key = 'campaign_settings'")
cs = {}
try:
    d = r[0]["d"] if ok and r else []; d = json.loads(d) if isinstance(d, str) else d
    cs = next((x for x in (d or []) if isinstance(x, dict) and x.get("id") == "settings"), {}) or {}
except Exception: cs = {}
say("  · campaign autopilot master switch: " + ("ON" if cs.get("enabled") else "off") + " · audiences ticked: " + (", ".join(k for k, v in (("open leads", cs.get("aud_monthly")), ("clients", cs.get("aud_clients")), ("client family contacts", cs.get("aud_client_contacts")), ("caregivers", cs.get("aud_caregivers"))) if v) or "none"))
ok, r = sql("""select j.client_name, r.end_reason, r.ended_at from public.client_journey j
  join public.person_source_id s on s.system = 'axiscare' and s.entity_type = 'client' and s.source_id = j.axiscare_client_id
  join public.person_role r on r.person_id = s.person_id and r.role = 'client'
  where j.status in ('open','active') and not j.is_test
    and not exists (select 1 from public.person_role a where a.person_id = s.person_id and a.role = 'client' and a.status = 'active')""")
ended = r if ok else []
if not ok: bad("could not read which journeys' clients have ended care: " + str(r)[:200])
say(f"  · journeys whose client's care has already ended (closed on the next 10-minute check): {len(ended)}" + ("" if not ended else ": " + ", ".join(f"{x['client_name']} ({x.get('end_reason') or 'ended'})" for x in ended)))
ok, r = sql("select count(*)::int as n from public.client_admission_case where status = 'open'")
say(f"  · AxisCare clients waiting to be matched (now shown on Client Care → Starting care): {r[0]['n'] if ok and r else '?'}")
VJ = {}
for fn in FNS:
    sx, mx = fmeta(fn)
    chk(sx == 200 and mx is not None and isinstance(mx.get("verify_jwt"), bool), f"{fn} is live now (version {(mx or {}).get('version', '?')}, gateway sign-in check {'on' if (mx or {}).get('verify_jwt') else 'off'})")
    VJ[fn] = (mx or {}).get("verify_jwt")
if fails: say(); say("  RESULT: STOPPED before anything changed."); done(3)

say(); say("PART 2 · CHANGE")
for fn in FNS:
    p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"] + ([] if VJ[fn] else ["--no-verify-jwt"]), cwd=ROOT, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    okd, livef = live_files(fn)
    good = p.returncode == 0 and okd and all(k in livef and livef[k] == sha(os.path.join(ROOT, k)) for k in need(fn))
    chk(good, fn + " deployed: the live copy is this reviewed build, every shared file included" if good else fn + " did not deploy cleanly: " + (p.stderr or p.stdout)[-200:])
    if fails: say("  RESULT: STOPPED (functions deployed above stay; the rest did not change)."); done(6)
    sN, mN = fmeta(fn)
    if (mN or {}).get("verify_jwt") != VJ[fn]:
        http("PATCH", f"{API}/v1/projects/{REF}/functions/{fn}", {"verify_jwt": VJ[fn]}, MG()); sN, mN = fmeta(fn)
    chk((mN or {}).get("verify_jwt") == VJ[fn], f"{fn}: version {(mN or {}).get('version', '?')}, gateway sign-in check {'on' if VJ[fn] else 'off'} as before")

say(); say("PART 3 · PROOF (nothing is texted or emailed)")
for fn in FNS:
    okd2, live2 = live_files(fn)
    chk(okd2 and live2.get(f"supabase/functions/{fn}/index.ts") == sha(os.path.join(FNROOT, fn, "index.ts")), f"the live {fn} is this build")
say()
say("RESULT: " + ("DONE · The next 10-minute check closes journeys for clients whose care ended. The campaign autopilot now puts any lead, client or family email on your My Work for you to send; it never sends those by itself." if not fails else "CHECK THE ✗ LINES."))
say("Nothing was texted or emailed by this step.")
done(0 if not fails else 8)
