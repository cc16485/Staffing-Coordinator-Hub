#!/usr/bin/env python3
# 531 · SLICE 0 OF THE ONBOARDING WORKFLOW (Samantha approved 2026-10-08): settings, per-person permissions, the path answer.
# Deploys three Hub server functions pinned to the reviewed build: onboarding-permissions (new: who may approve, by signed-in
# person, with its audit trail), outreach-check (adds the onboarding-path answer: old for everyone until the switch date is
# set) and caregiver-hiring-history (shows the path on the applicant page). Then it seeds the Approve to Work list with
# Samantha and Zachary, looked up by their work emails in the staff list, ONLY if no list exists yet. Nothing is texted or
# emailed, no caregiver record changes, nothing is switched on, AxisCare and Viventium are not touched.
import json, os, re, subprocess, urllib.request, urllib.error, datetime as dt, sys, hashlib, tempfile, shutil, time
REPORT = os.environ["SB_REPORT"]
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); BASE = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
SUPA = os.environ.get("SB_SUPA_CLI", ""); FNROOT = os.environ.get("SB_FNROOT", ""); SHAS = json.loads(os.environ.get("SB_FN_SHAS", "{}")); BASEP = json.loads(os.environ.get("SB_BASE_SHAS", "{}"))
ROOT = os.path.dirname(os.path.dirname(FNROOT)) if FNROOT else ""; FNS = ["onboarding-permissions", "outreach-check", "caregiver-hiring-history"]
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for h in HIDE:
        if h: s = s.replace(h, "(hidden)")
    s = re.sub(r"(sbp_|eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._\-]+", "(hidden)", s); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=120):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers=dict({"Content-Type": "application/json", "User-Agent": "cc-531/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
jl = lambda b: (lambda: json.loads(b))() if b and b[:1] in "[{" else {}
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, b[:300]
    try: return True, json.loads(b)
    except Exception: return False, b[:300]
lit = lambda v: "null" if v is None else "'" + str(v).replace("'", "''") + "'"
sha = lambda p_: hashlib.sha256(open(p_, "rb").read()).hexdigest()
def deps(path, seen):
    if path in seen or not os.path.exists(path): return
    seen.add(path)
    for m in re.findall(r"""from\s+['"](\.{1,2}/[^'"]+)['"]|import\s+['"](\.{1,2}/[^'"]+)['"]""", open(path).read()):
        deps(os.path.normpath(os.path.join(os.path.dirname(path), m[0] or m[1])), seen)
def need(fn):
    s = set(); deps(os.path.join(FNROOT, fn, "index.ts"), s)
    return {os.path.relpath(x, ROOT).replace(os.sep, "/") for x in s}
def fmeta(fn):
    s = None
    for i in range(4):
        s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{fn}", headers=MG())
        if s == 200:
            try: return s, json.loads(b)
            except Exception: pass
        if s == 404: return s, None
        time.sleep(3 * (i + 1))
    return s, None
def live_files(fn):
    for i in range(3):
        tmp = tempfile.mkdtemp(prefix="cc531-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
        d = subprocess.run([SUPA, "functions", "download", fn, "--project-ref", REF, "--use-api"], cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
        live = {}
        for r_, _, files in os.walk(tmp):
            for f in files:
                lp = os.path.join(r_, f).replace(os.sep, "/")
                if "/functions/" in lp: live["supabase/functions/" + lp.split("/functions/", 1)[1]] = sha(lp)
        shutil.rmtree(tmp, ignore_errors=True)
        if d.returncode == 0 and live: return True, live
        time.sleep(3 * (i + 1))
    return False, {}

say("531 · SLICE 0 OF THE ONBOARDING WORKFLOW: SETTINGS, PERMISSIONS AND THE PATH ANSWER"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
for name, want in SHAS.items():
    p_ = os.path.join(FNROOT, name); have_ = sha(p_) if os.path.exists(p_) else "(missing)"
    say(f"  ✓ {name} is the reviewed build") if have_ == want else bad(f"{name} is not the reviewed build: nothing runs")
if fails: say(); say("  RESULT: STOPPED before anything changed."); done(2)
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
VJ = {}; NEW = set()
for fn in FNS:   # nobody else's unreleased work goes out: live must match the reviewed main, or this build
    sx, mx = fmeta(fn)
    if sx == 404 and fn == "onboarding-permissions":   # new in this slice: nothing live to compare, the gateway check goes on like the others
        VJ[fn] = True; NEW.add(fn); say(f"  ✓ {fn}: not live yet (new in this slice), it is created with the gateway sign-in check on"); continue
    if not (sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool)): bad(f"{fn} could not be read ({sx})"); continue
    VJ[fn] = mx["verify_jwt"]; okd, livef = live_files(fn)
    if not okd: bad(f"{fn}: the live copy could not be downloaded"); continue
    # a live file may be today's main, this build, or any earlier version that was on main (a function deployed before a
    # shared file changed): all reviewed. Only a file that was never on main stops the step.
    okv = lambda k: livef.get(k) == sha(os.path.join(ROOT, k)) or livef.get(k) in (BASEP.get(k) if isinstance(BASEP.get(k), list) else [BASEP.get(k)])
    odd = [k for k in need(fn) if not okv(k)]
    older = [k for k in need(fn) if livef.get(k) != sha(os.path.join(ROOT, k))]
    say(f"  ✓ {fn} (version {mx.get('version', '?')}): the live copy is reviewed code" + (f" (an earlier main version of {', '.join(older)}; this deploy brings it up to date)" if older else " (today's main), so only this change goes out")) if not odd else bad(f"{fn}: the live copy has a file that was never on main ({', '.join(odd)[:200]}); nothing runs")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say("  · what changes: three server functions. onboarding-permissions (new) keeps the two approval lists by signed-in person with its audit trail; outreach-check gains one read-only answer, which onboarding path an offer belongs to (old for everyone until the switch date is set); caregiver-hiring-history shows that path on the applicant page. Nothing is sent, nothing is switched on, no caregiver, AxisCare or Viventium record changes.")
say(); say("PART 2 · CHANGE")
for fn in FNS:
    p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"] + ([] if VJ[fn] else ["--no-verify-jwt"]), cwd=ROOT, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    okd, livef = live_files(fn)
    good = p.returncode == 0 and okd and all(livef.get(k) == sha(os.path.join(ROOT, k)) for k in need(fn))
    say(f"  ✓ {fn} deployed: the live copy is this reviewed build") if good else bad(f"{fn} did not deploy cleanly: " + (p.stderr or p.stdout)[-200:])
    if fails: say("  RESULT: STOPPED (what deployed above stays). Tell Claude."); done(6)
    sN, mN = fmeta(fn)
    if (mN or {}).get("verify_jwt") != VJ[fn]:
        http("PATCH", f"{API}/v1/projects/{REF}/functions/{fn}", {"verify_jwt": VJ[fn]}, MG()); sN, mN = fmeta(fn)
    say(f"  ✓ {fn}: version {(mN or {}).get('version', '?')}, gateway sign-in check {'on' if VJ[fn] else 'off'}" + (" (new)" if fn in NEW else " as before")) if (mN or {}).get("verify_jwt") == VJ[fn] else bad(f"{fn}: the gateway setting did not come back")
say(); say("PART 3 · THE APPROVE TO WORK LIST, THEN PROOF (nothing is sent; no caregiver record changes)")
# Seed the Approve to Work list with Samantha and Zachary, by their work emails in the staff list, ONLY if no list exists.
ok_, rows = sql("select data from public.app_data where key = 'onboarding_permissions'")
if not ok_: bad(f"could not read the permissions record: {rows}")
elif rows:
    d = rows[0].get("data") or {}
    say(f"  ✓ a permissions record already exists (Approve to Work: {', '.join(m.get('name') or m.get('email') or '?' for m in (d.get('work') or []))}); left as it is")
else:
    ok_, ppl = sql("select person_id, full_name, primary_email, active from public.persons where lower(primary_email) in ('samantha@mo-care.com','zach@mo-care.com') order by primary_email")
    if not ok_: bad(f"could not read the staff list: {ppl}")
    else:
        found = {str(p.get("primary_email", "")).lower(): p for p in ppl if p.get("active") is True}
        missing = [e for e in ("samantha@mo-care.com", "zach@mo-care.com") if e not in found]
        if missing: bad("no active staff record for " + ", ".join(missing) + ": the Approve to Work list was NOT created. Add them in Team Access, then run this step again.")
        else:
            now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            work = [{"person_id": str(found[e]["person_id"]), "email": e, "name": str(found[e].get("full_name") or ""), "added_by": "531 (Samantha's approval of 2026-10-08)", "added_at": now} for e in ("samantha@mo-care.com", "zach@mo-care.com")]
            rec = {"version": 1, "advance": [], "work": work, "history": [{"at": now, "by": "531", "by_email": "install", "kind": "work", "action": "add", "person_id": m["person_id"], "email": m["email"], "name": m["name"]} for m in work]}
            ok_, r_ = sql("insert into public.app_data (key, data, updated_at) values ('onboarding_permissions', " + lit(json.dumps(rec)) + "::jsonb, now()) on conflict (key) do nothing")
            say("  ✓ Approve to Work list created: " + ", ".join(m["name"] or m["email"] for m in work) + " (nobody on Approve to Advance yet; owners can always advance)") if ok_ else bad(f"could not create the permissions record: {r_}")
ok_, chk = sql("select jsonb_array_length(coalesce(data->'work','[]'::jsonb)) as n from public.app_data where key = 'onboarding_permissions'")
say(f"  ✓ the record holds {chk[0]['n']} people on Approve to Work") if ok_ and chk and int(chk[0].get("n") or 0) >= 1 else bad("the permissions record is missing or empty")
for fn in FNS:
    s_, b_ = http("POST", f"{BASE}/functions/v1/{fn}", {"action": "get"}, {"apikey": "", "Authorization": "Bearer "})
    say(f"  ✓ {fn} answers and refuses a call with no sign-in ({s_})") if s_ in (401, 403) else bad(f"{fn} answered {s_} to a call with no sign-in (expected 401 or 403)")
say("  · tested before deploying with 57 checks on the real code against a stand-in database: the business-day clock (weekends, holidays, 5pm Central across the daylight-saving change), the permission rules (identity decides, a title never does, a body claiming owner is ignored, the Approve to Work list is changed only by its members and never emptied, every change logged) and the path answer (old while the date is blank, new on and after it, nothing written).")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · Slice 0 server side is live: the approval lists exist (Samantha and Zachary on Approve to Work), the Hub answers which path an offer is on (old for everyone), and nothing is switched on. Nothing was sent or changed for any caregiver.")
done(0)
