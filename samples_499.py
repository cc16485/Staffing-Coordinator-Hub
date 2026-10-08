#!/usr/bin/env python3
# 499 · PAST AND DECEASED PREVIEWS (Samantha 2026-10-07: "show me the actual Past and Deceased previews in the Hub before
# importing the historical clients"). First, her "On or before" decision (2026-10-08): an ended client role must have a date;
# when AxisCare has none, we store the date we first saw them inactive and mark it on_or_before (client-journey/
# ended-date-basis.sql), and client-journey + client-status-review pass that mark on so the Hub never shows it as exact.
# Then TWO sample people, clearly named TEST, shaped exactly like an imported historical client: a person, their AxisCare
# client number and a client role that ended "on or before" today. Nothing else: no journey, no card, no check-in, no family
# contact, no AxisCare change. Their AxisCare numbers (9900001, 9900002) are far outside the real range. No reason is
# recorded (AxisCare has none); the deceased one carries only the word deceased.
#   SB_MODE=add     (Desktop 499) adds them, then proves on the live server how the Hub sees them: Past and Deceased,
#                   no Pause / End buttons, left out of every shift job and every campaign.
#   SB_MODE=remove  (Desktop 499b, after her look) removes exactly these two people and nothing else.
# Nothing is texted or emailed; nobody outside the office can see them.
import json, os, re, subprocess, urllib.request, urllib.error, datetime as dt, sys, hashlib, tempfile, shutil, time
REPORT = os.environ["SB_REPORT"]; MODE = os.environ.get("SB_MODE", "add")
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); BASE = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
PROOF_EMAIL = os.environ.get("SB_PROOF_EMAIL", "samantha@mo-care.com").lower()
SUPA = os.environ.get("SB_SUPA_CLI", ""); FNROOT = os.environ.get("SB_FNROOT", ""); SHAS = json.loads(os.environ.get("SB_FN_SHAS", "{}")); BASEP = json.loads(os.environ.get("SB_BASE_SHAS", "{}"))
ROOT = os.path.dirname(os.path.dirname(FNROOT)) if FNROOT else ""; FNS = ["client-journey", "client-status-review"]
from zoneinfo import ZoneInfo
CHI = dt.datetime.now(ZoneInfo("America/Chicago")).strftime("%Y-%m-%d")   # today in Springfield; stored as "on or before", never shown as exact
SAMPLES = [("9900001", "TEST Past Sample", "Past", None), ("9900002", "TEST Deceased Sample", "Deceased", "deceased")]
EVID = "TEST sample for the 499 Past/Deceased preview; removed by 499b"
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
        headers=dict({"Content-Type": "application/json", "User-Agent": "cc-499/1.0"}, **(headers or {})))
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
AXS = ", ".join(lit(a) for a, *_ in SAMPLES); NAMES = ", ".join(lit(n) for _, n, *_ in SAMPLES)
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
        tmp = tempfile.mkdtemp(prefix="cc499-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
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
STATE_SQL = f"""select s.source_id as ax, p.display_name as name, r.status, r.ended_at::text as ended_at, to_jsonb(r)->>'ended_date_basis' as ended_date_basis, r.end_reason
  from public.person_source_id s join public.person_identity p on p.id = s.person_id
  left join public.person_role r on r.person_id = s.person_id and r.role = 'client'
  where s.system = 'axiscare' and s.entity_type = 'client' and s.source_id in ({AXS}) order by s.source_id"""

title = "499 · PAST AND DECEASED PREVIEWS" if MODE == "add" else "499b · REMOVE THE TWO PREVIEW SAMPLES"
say(title); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
ok, r = sql(STATE_SQL)
if not ok: bad("the people tables could not be read: " + str(r)); done(2)
have = {x["ax"]: x for x in r}
foreign = [x for x in r if not str(x.get("name") or "").startswith("TEST ")]
if foreign: bad("AxisCare number 9900001 or 9900002 belongs to a real person here (" + ", ".join(str(x["name"]) for x in foreign) + "). Nothing changed. Tell Claude."); done(2)

if MODE == "remove":
    if not have: say("  · the two samples are not here (already removed). Nothing to do."); say(); say("RESULT: DONE · nothing to remove."); done(0)
    say(f"  ✓ found {len(have)} sample(s): " + ", ".join(x["name"] for x in have.values()))
    say(); say("PART 2 · CHANGE")
    ok, r = sql(f"""begin;
      create temp table s499 on commit drop as select s.person_id from public.person_source_id s join public.person_identity p on p.id = s.person_id
        where s.system = 'axiscare' and s.entity_type = 'client' and s.source_id in ({AXS}) and p.display_name in ({NAMES});
      delete from public.person_role where person_id in (select person_id from s499);
      delete from public.person_source_id where person_id in (select person_id from s499);
      delete from public.person_identity where id in (select person_id from s499);
      commit;""")
    if not ok: bad("could not remove them: " + str(r)); say("  Nothing was removed (all or nothing)."); done(5)
    ok, r = sql(STATE_SQL)
    chk = ok and not r
    say("  ✓ both samples removed (their role, their AxisCare number, the person)") if chk else bad("something is still there: " + str(r))
    say(); say("RESULT: " + ("DONE · the two preview samples are gone. Nothing else was touched." if chk else "CHECK THE ✗ LINES ABOVE")); done(0 if chk else 6)

# add: every column these three tables require must be one this fills in (else stop, nothing changed)
ok, cols = sql("""select table_name, column_name from information_schema.columns where table_schema = 'public'
  and table_name in ('person_identity','person_source_id','person_role') and is_nullable = 'NO' and column_default is null and is_identity = 'NO'""")
FILLS = {"person_identity": {"display_name", "first_name", "last_name", "id"}, "person_source_id": {"person_id", "system", "entity_type", "source_id", "confidence", "evidence"},
         "person_role": {"person_id", "role", "status", "ended_at", "end_reason"}}
missing = [f"{c['table_name']}.{c['column_name']}" for c in (cols if ok else []) if c["column_name"] not in FILLS[c["table_name"]]]
if not ok or missing: bad("the people tables need something this doesn't fill in (" + (", ".join(missing) or str(cols)) + "). Nothing changed. Tell Claude."); done(2)
say("  ✓ the people tables take exactly what an imported client has")
if len(have) == 2: say("  · the two samples are already here (kept as they are)")
else: say("  ✓ AxisCare numbers 9900001 and 9900002 are free")
for name, want in SHAS.items():
    p_ = os.path.join(ROOT, "client-journey", name.split("/", 1)[1]) if name.endswith(".sql") else os.path.join(FNROOT, name)
    have_ = sha(p_) if os.path.exists(p_) else "(missing)"
    say(f"  ✓ {name} is the reviewed build") if have_ == want else bad(f"{name} is not the reviewed build: nothing runs")
if fails: say(); say("  RESULT: STOPPED before anything changed."); done(2)
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
VJ = {}
for fn in FNS:   # nobody else's unreleased work goes out: live must be exactly what 498 put there, or this build
    sx, mx = fmeta(fn)
    if not (sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool)): bad(f"{fn} could not be read ({sx})"); continue
    VJ[fn] = mx["verify_jwt"]; okd, livef = live_files(fn)
    if not okd: bad(f"{fn}: the live copy could not be downloaded"); continue
    odd = [k for k in need(fn) if livef.get(k) != BASEP.get(k) and livef.get(k) != sha(os.path.join(ROOT, k))]
    say(f"  ✓ {fn} (version {mx.get('version', '?')}): live is what 498 deployed, so only this change goes out") if not odd else bad(f"{fn}: the live copy changed since 498 ({', '.join(odd)[:200]}); nothing runs")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
ok, r = sql(open(os.path.join(ROOT, "client-journey", "ended-date-basis.sql")).read())
if not ok: bad("the on-or-before mark didn't install: " + str(r)); say("  STOP. Nothing else was changed."); done(5)
say("  ✓ an end date can now be marked 'on or before' (when AxisCare had no end date)")
for fn in FNS:
    p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"] + ([] if VJ[fn] else ["--no-verify-jwt"]), cwd=ROOT, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    okd, livef = live_files(fn)
    good = p.returncode == 0 and okd and all(livef.get(k) == sha(os.path.join(ROOT, k)) for k in need(fn))
    say(f"  ✓ {fn} deployed: the live copy is this reviewed build") if good else bad(f"{fn} did not deploy cleanly: " + (p.stderr or p.stdout)[-200:])
    if fails: say("  RESULT: STOPPED (what deployed above stays; the samples were not added). Tell Claude."); done(6)
    sN, mN = fmeta(fn)
    if (mN or {}).get("verify_jwt") != VJ[fn]:
        http("PATCH", f"{API}/v1/projects/{REF}/functions/{fn}", {"verify_jwt": VJ[fn]}, MG()); sN, mN = fmeta(fn)
    say(f"  ✓ {fn}: version {(mN or {}).get('version', '?')}, gateway sign-in check {'on' if VJ[fn] else 'off'} as before") if (mN or {}).get("verify_jwt") == VJ[fn] else bad(f"{fn}: the gateway setting did not come back")
if len(have) < 2:
    q = ["begin;"]
    for ax, name, _, reason in SAMPLES:
        if ax in have: continue
        first, last = name.split(" ", 1)
        q.append(f"""with p as (insert into public.person_identity (display_name, first_name, last_name) values ({lit(name)}, {lit(first)}, {lit(last)}) returning id),
          s as (insert into public.person_source_id (person_id, system, entity_type, source_id, confidence, evidence) select id, 'axiscare', 'client', {lit(ax)}, 'confirmed', {lit(EVID)} from p returning person_id)
          insert into public.person_role (person_id, role, status, ended_at, ended_date_basis, end_reason) select person_id, 'client', 'former', {lit(CHI)}, 'on_or_before', {lit(reason)} from s;""")
    q.append("commit;")
    ok, r = sql("\n".join(q))
    if not ok: bad("could not add them: " + str(r)); say("  Nothing was added (all or nothing)."); done(5)
    say("  ✓ added TEST Past Sample (AxisCare 9900001) and TEST Deceased Sample (AxisCare 9900002): a person, the number, an ended client role")
    say(f"  · both ended 'on or before' {CHI} (the day we first saw them inactive), exact date not recorded; no reason; the deceased one says only deceased")

say(); say("PART 3 · PROOF on the live server (nothing is texted or emailed)")
ok, r = sql(STATE_SQL); rows = {x["ax"]: x for x in (r if ok else [])}
for ax, name, _, reason in SAMPLES:
    x = rows.get(ax) or {}
    good = x.get("status") == "former" and x.get("ended_at") and x.get("ended_date_basis") == "on_or_before" and (x.get("end_reason") or None) == reason
    say(f"  ✓ {name}: client role ended on or before {x.get('ended_at')}, " + ("reason deceased" if reason else "no reason") + " (as imported)") if good else bad(f"{name} is not as expected: {x}")
# the shift jobs' quiet list (_shared/client-quiet.ts, the same query): both must be on it
ok, r = sql(f"""with ended as (select person_id from public.person_role where role = 'client' group by person_id having not bool_or(status = 'active'))
  select count(*)::int as n from public.person_source_id where system = 'axiscare' and entity_type = 'client' and source_id in ({AXS}) and person_id in (select person_id from ended)""")
say("  ✓ both are on the list every shift job skips (missed clock-ins, running late, coverage, missed notes, Care Match)") if ok and r and r[0]["n"] == 2 else bad("the shift jobs' quiet list does not hold both: " + str(r))
# signed in as you for this run only: what the Hub's profile shows (client-journey care_state)
s, kb = http("GET", f"{API}/v1/projects/{REF}/api-keys?reveal=true", headers=MG()); k = jl(kb)
keys = {x.get("name"): x.get("api_key", "") for x in (k if isinstance(k, list) else []) if isinstance(x, dict)}
ANON, SVC = keys.get("anon", ""), keys.get("service_role", ""); HIDE.extend([ANON, SVC]); at = None
if ANON and SVC:
    s, b = http("POST", f"{BASE}/auth/v1/admin/generate_link", {"type": "magiclink", "email": PROOF_EMAIL}, {"apikey": SVC, "Authorization": "Bearer " + SVC})
    th = jl(b).get("hashed_token") or (jl(b).get("properties") or {}).get("hashed_token")
    for typ in ("magiclink", "email"):
        if at or not th: break
        s2, b2 = http("POST", f"{BASE}/auth/v1/verify", {"type": typ, "token_hash": th}, {"apikey": ANON}); at = jl(b2).get("access_token")
SVC = ""
if not at: bad("could not sign in as you to read the profile view; the samples are in, open them in the Hub")
else:
    HIDE.append(at); H = {"apikey": ANON, "Authorization": "Bearer " + at}
    for ax, name, want, reason in SAMPLES:
        s, b = http("POST", f"{BASE}/functions/v1/client-journey", {"action": "care_state", "axiscare_client_id": ax}, H); d = jl(b)
        st, can = d.get("state"), d.get("can") or {}
        rl = [x for x in (d.get("roles") or []) if x.get("status") != "active"]
        good = s == 200 and st == want.lower() and not can.get("pause") and not can.get("end") and not can.get("resume") and rl and rl[-1].get("ended_date_basis") == "on_or_before"
        say(f"  ✓ {name}: the profile reads {want}, ended on or before (never an exact date), with no Pause care or End care button" + ("; Start a new episode only for an owner" if want == "Past" else "; no new episode, ever")) if good else bad(f"{name}: the profile answered {s} {str(b)[:200]}")
    # campaigns: these samples have no email at all (no family contact was added), so no list can hold them
    s, _ = http("POST", f"{BASE}/auth/v1/logout?scope=local", {}, H)
    say("  ✓ that sign-in was signed out" if s in (200, 204) else f"  ○ sign-out answered {s}; the session expires on its own within the hour")
say("  · no family contact or email was added, so no campaign list can include them; family exclusion is proven in the tests (21/21 + 40/40)")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · open the previews in the Hub:")
say("    https://cc.mo-care.com/#p/A9900001/summary   (TEST Past Sample)")
say("    https://cc.mo-care.com/#p/A9900002/summary   (TEST Deceased Sample)")
say("  or Clients → Past. When you've looked, Desktop 499b removes both. Nothing was texted or emailed.")
done(0)
