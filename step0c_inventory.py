#!/usr/bin/env python3
# Step 0 · 0c (Desktop 278) · READ ONLY. What can actually send, in production, across every Supabase project this
# account can see: each project's deployed functions (name, last deployed, platform sign-in check) and scheduled jobs
# (job name, schedule, active, the function it calls). Each function is marked against the reviewed inventory:
#   in the inventory · staff-only · reads/no send · NOT IN THE INVENTORY (needs a look).
# Nothing is changed. No key, token or job command text is printed (only the function a job calls).
import json, os, re, sys, urllib.request, urllib.error, datetime as dt
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REPORT = os.environ["SB_REPORT"]
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); HUB = "zngsgedlsxinbygwmxwn"
KNOWN = json.loads(open(os.environ["SB_INVENTORY"]).read())      # {"slug": "protected" | "staff" | "nosend" | ...}
lines = []
def say(s=""):
    s = re.sub(r"(sbp_|eyJ|sb_secret_|htorder_)[A-Za-z0-9._\-]+", "(hidden)", str(s)); print(s, flush=True); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def crash(t, e, tb):
    say(f"✗ The check stopped unexpectedly ({t.__name__}). Everything above is accurate; nothing was changed."); done(8)
sys.excepthook = crash
def http(method, url, body=None):
    req = urllib.request.Request(url, data=(json.dumps(body).encode() if body is not None else None), method=method,
                                 headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "cc-0c/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return r.status, json.loads(r.read().decode(errors="replace") or "null")
    except urllib.error.HTTPError as e: return e.code, None
    except Exception: return None, None
def sql(ref, q):
    s, b = http("POST", f"{API}/v1/projects/{ref}/database/query", {"query": q})
    return (s in (200, 201)), b

say("STEP 0 · 0c · WHAT CAN SEND, IN PRODUCTION · READ ONLY, nothing is changed")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
if not TOKEN.startswith("sbp_"): say("✗ That is not a Supabase access token (sbp_...). Nothing was read."); done(1)
s, projects = http("GET", f"{API}/v1/projects")
if s != 200 or not isinstance(projects, list): say(f"✗ Could not list the projects (HTTP {s})."); done(2)
say(f"Projects this account can see: {len(projects)}")
for p in projects: say(f"  · {p.get('name')} ({p.get('id')}){'  ← the Hub' if p.get('id') == HUB else ''} · {p.get('status', '')}")
say()
unknown_total = 0
for p in sorted(projects, key=lambda x: (x.get("id") != HUB, str(x.get("name")))):
    ref, name = p.get("id"), p.get("name")
    say(f"── {name} ({ref}) " + "─" * max(0, 60 - len(str(name))))
    s, fns = http("GET", f"{API}/v1/projects/{ref}/functions")
    if s != 200 or not isinstance(fns, list): say(f"  ✗ could not list its functions (HTTP {s})"); say(); continue
    ok, jobs = sql(ref, "select jobname, schedule, active, command from cron.job order by jobname")
    sched = {}
    if ok and isinstance(jobs, list):
        for j in jobs:
            m = re.search(r"/functions/v1/([a-z0-9_-]+)", j.get("command") or "")
            if m: sched.setdefault(m.group(1), []).append(f"{j['jobname']} {j['schedule']}{'' if j.get('active') else ' (PAUSED)'}")
    say(f"  {len(fns)} deployed function(s)" + (f" · {len(jobs)} scheduled job(s)" if ok and isinstance(jobs, list) else " · scheduled jobs not readable"))
    for f in sorted(fns, key=lambda x: str(x.get("slug"))):
        slug = str(f.get("slug")); upd = f.get("updated_at")
        when = dt.datetime.fromtimestamp(upd / 1000, dt.timezone.utc).strftime("%Y-%m-%d") if isinstance(upd, (int, float)) else str(upd or "")[:10]
        key = slug if ref == HUB else f"{ref}:{slug}"
        mark = KNOWN.get(key)
        label = {"protected": "in the inventory · checks opt-outs", "staff": "in the inventory · staff only",
                 "nosend": "reads only · sends nothing", "undeployed": "in the inventory",
                 "ghlworkflow": "in the inventory · starts a GoHighLevel workflow that sends"}.get(mark, "NOT IN THE INVENTORY · needs a look")
        if not mark: unknown_total += 1
        say(f"  {'✓' if mark else '?'} {slug:<30} deployed {when:<10} {'sign-in check ON ' if f.get('verify_jwt') else 'sign-in check off'}  {label}"
            + (f"  · runs: {'; '.join(sched[slug])}" if slug in sched else ""))
    say()
say(f"RESULT: {unknown_total} deployed function(s) are not in the reviewed inventory yet. Claude reads each one's code and classifies it; nothing is assumed.")
done(0)
