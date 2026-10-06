#!/usr/bin/env python3
# 468 · NEEDS ATTENTION CLEAN-UP + TWO FIXES. Samantha 2026-10-06, after 467 (99 open, 76 with nobody on them):
#   "build 2 and 3 and clean up training record checks"
#   2 · a new shift-note flag lands on whoever owns Client Care (care-notes), not on nobody
#   3 · a family-call card for a shift that hasn't happened yet says "won't be covered" (coverage-watch)
#   clean-up · everything open and MORE THAN A WEEK past due closes the way the Hub's Fresh start does (resolution
#     'fresh_start', a note, its own batch), so Hub settings > Fresh start > Undo reopens exactly these for 7 days.
#     The training-record checks close too (her answer). Left open: items the Hub reopens by itself while the problem is
#     still there (references, start of care, eligibility, client issues: the Fresh start list leaves them unticked too)
#     and uncovered-shift cards whose case is still open.
#   plus · the shift-note flags open now with nobody on them go to the Client Care owner; the open family-call cards for
#     shifts still ahead get the "won't be covered" wording.
# Part 1 (read only): reviewed builds; who owns Client Care; what would change. Part 2: deploy both functions, then ONE
# database statement that only touches items still open at that moment. Part 3: read back.
# Nothing is texted or emailed. No note's words, phone number or email is printed.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, time
REPORT = os.environ["SB_REPORT"]; FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ.get("SB_FN_SHAS", "{}"))
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
FNS = ["care-notes", "coverage-watch"]
BY, BY_NAME = "samantha@mo-care.com", "Samantha Troutman"
COMES_BACK = re.compile(r"^(ops_ref_|cstart_|elig_|eligsched_|ops_issue_)")   # the Hub's Fresh start list, less the September census card
lines = []; fails = []
def say(s=""):
    s = str(s)
    s = re.sub(r"(sbp_|eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._\-]+", "(hidden)", s); s = re.sub(r"[\w.%+\-]+@[\w.\-]+\.[A-Za-z]{2,}", "(an email)", s)
    print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Anything done above stays done; nothing after it ran. Nothing was texted. Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=200):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers=dict({"Content-Type": "application/json", "User-Agent": "cc-468/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, f"HTTP {s}: {b[:300]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:200]
lit = lambda v: "'" + str(v).replace("'", "''") + "'"
def chk(good, msg): (say if good else bad)(("  ✓ " if good else "") + msg)
def meta(fn):
    s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{fn}", headers=MG())
    try: m = json.loads(b) if s == 200 else None
    except Exception: m = None
    return m if isinstance(m, dict) and isinstance(m.get("verify_jwt"), bool) else None
def t(x):
    if not x: return None
    v = str(x).strip().replace("Z", "+00:00")
    for c in (v, v[:19], v[:10] + "T12:00:00"):
        try:
            d = dt.datetime.fromisoformat(c); return d if d.tzinfo else d.replace(tzinfo=dt.timezone.utc)
        except Exception: pass
    return None
def as_list(x):
    if isinstance(x, str):
        try: x = json.loads(x)
        except Exception: return []
    if isinstance(x, dict): x = list(x.values())
    return [i for i in (x or []) if isinstance(i, dict)]

say("468 · NEEDS ATTENTION CLEAN-UP, SHIFT-NOTE FLAGS TO CLIENT CARE, \"WON'T BE COVERED\""); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
for name, want in SHAS.items():
    p = os.path.join(FNROOT, "_shared", "loops.ts") if name == "_shared/loops" else os.path.join(FNROOT, name, "index.ts")
    if hashlib.sha256(open(p, "rb").read()).hexdigest() != want: bad(f"{name} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
say("  ✓ the reviewed builds")
before = {}
for fn in FNS:
    m = meta(fn)
    if not m: bad(f"could not read {fn}'s setting. Nothing was changed."); done(4)
    before[fn] = m
ok, r = sql("""select p.full_name, lower(p.primary_email) as email from public.domains d join public.persons p on p.person_id = d.owner_person
               where d.entity = 'cc_ihs' and d.code = 'client_care'""")
if not ok: bad("couldn't read who owns Client Care: " + str(r)[:160]); done(3)
CC = r[0] if r else None
if CC and CC.get("email"): say(f"  · Client Care is owned by {CC['full_name']}: new shift-note flags will go to them")
else: say("  · nobody owns Client Care yet (Hub Settings > who owns what): flags stay unassigned until someone does"); CC = None
ok, r = sql("select data, version from public.app_data where key = 'ops_items'")
if not ok or not r: bad("couldn't read Needs Attention. Nothing was changed."); done(3)
items = as_list(r[0]["data"]); ver = r[0].get("version")
ok, r2 = sql("select data from public.app_data where key = 'coverage_cases'")
cases = {str(c.get("id")): c for c in as_list(r2[0]["data"])} if ok and r2 else {}
now = dt.datetime.now(dt.timezone.utc); at = now.isoformat().replace("+00:00", "Z")
chi = (now - dt.timedelta(hours=5)).strftime("%Y-%m-%dT%H:%M")   # Central daylight time (good until Nov 1)
op = [i for i in items if i.get("status") == "open"]
close, kept_back, kept_case = [], [], []
for i in op:
    d = t(i.get("due"))
    if not d or (now - d).total_seconds() <= 7 * 86400: continue
    c = cases.get(str(i.get("coverage_case_id"))) if i.get("coverage_case_id") is not None else None
    if i.get("kind") == "coverage" and c and c.get("status") == "open": kept_case.append(i); continue
    if COMES_BACK.match(str(i.get("id") or "")): kept_back.append(i); continue
    close.append(i)
give = [i for i in op if i.get("kind") == "care_note" and not i.get("owner") and i not in close] if CC else []
def ahead(i):
    c = cases.get(str(i.get("case_id"))) or {}
    d = str(c.get("shift_date") or ""); m = re.match(r"(\d{2}:\d{2})", str(c.get("shift_time") or ""))
    return bool(re.match(r"^\d{4}-\d{2}-\d{2}$", d)) and chi < f"{d}T{m.group(1) if m else '00:00'}"
reword = [i for i in op if i.get("kind") == "family_call" and "wasn't covered" in str(i.get("title") or "") and ahead(i) and i not in close]
say(f"  · {len(op)} open now · more than a week past due: {len(close) + len(kept_back) + len(kept_case)}")
say(f"      to close (Fresh start, Undo for 7 days): {len(close)}" + (" · " + ", ".join(f"{k} {n}" for k, n in sorted(__import__('collections').Counter(str(i.get('kind')) for i in close).items(), key=lambda x: -x[1])) if close else ""))
say(f"      left open, the Hub reopens them by itself while the problem is there: {len(kept_back)}" + (" (fix the problem itself, e.g. add the reference's email)" if kept_back else ""))
if kept_case: say(f"      left open, their shift's case is still open: {len(kept_case)}")
say(f"  · shift-note flags open with nobody on them, to give to Client Care: {len(give)}")
say(f"  · family-call cards for shifts still ahead, to reword: {len(reword)}")

say(); say("PART 2 · CHANGE")
for fn in FNS:
    p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"] + ([] if before[fn]["verify_jwt"] else ["--no-verify-jwt"]),
                       cwd=os.path.dirname(os.path.dirname(FNROOT)), env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    if p.returncode != 0: bad(f"{fn} deploy failed: " + (p.stderr or p.stdout)[-240:]); say("  STOP. Functions above this line run the new code; nothing in Needs Attention was changed."); done(6)
    say(f"  ✓ {fn} deployed")
batch = "fs_468_" + now.strftime("%Y%m%d%H%M")
hist = lambda text: [{"at": at, "by": BY_NAME + " (Desktop 468)", "text": text}]
patches = {}
for i in close:
    s_ = {"status": "done", "closed_at": at, "closed_by": BY, "resolution_code": "fresh_start", "fresh_start": batch,
          "close_note": "Fresh start " + at[:10] + ": more than a week past due, cleared without action", "last_activity_at": at}
    if isinstance(i.get("escalation"), dict) and not i["escalation"].get("cleared_at"): s_["escalation"] = dict(i["escalation"], cleared_at=at, cleared_why="fresh start")
    patches[str(i["id"])] = {"set": s_, "hist": hist("Cleared in the fresh start (more than a week past due)")}
for i in give:
    patches[str(i["id"])] = {"set": {"owner": CC["email"], "owner_name": CC["full_name"], "last_activity_at": at}, "hist": hist("Given to Client Care (" + CC["full_name"] + ")")}
for i in reword:
    patches[str(i["id"])] = {"set": {"title": str(i["title"]).replace("wasn't covered", "won't be covered"),
                                     "detail": str(i.get("detail") or "").replace("Nobody covered this shift.", "Nobody is covering this shift."), "last_activity_at": at}, "hist": []}
changed = 0
if patches:
    pj = json.dumps(patches)
    ok, r = sql(f"""with p as (select {lit(pj)}::jsonb as m),
      upd as (update public.app_data a set data = (
        select coalesce(jsonb_agg(case when (select m from p) ? (x->>'id') and x->>'status' = 'open'
                 then (x || ((select m from p)->(x->>'id')->'set')) || jsonb_build_object('history', coalesce(case when jsonb_typeof(x->'history') = 'array' then x->'history' end, '[]'::jsonb) || ((select m from p)->(x->>'id')->'hist'))
                 else x end order by o), '[]'::jsonb)
        from jsonb_array_elements(a.data) with ordinality e(x, o)), version = coalesce(a.version, 0) + 1
      where a.key = 'ops_items' and jsonb_typeof(a.data) = 'array' returning 1)
      select count(*)::int as n from upd""")
    if not ok or not r or r[0]["n"] != 1: bad("the clean-up didn't save: " + str(r)[:200]); say("  The two functions are deployed; nothing in Needs Attention changed."); done(7)
    changed = len(patches)
    rec = json.dumps({"id": batch, "at": at, "by": BY, "by_name": BY_NAME, "ids": [str(i["id"]) for i in close], "source": "Desktop 468"})
    ok, r = sql(f"""update public.app_data set data = jsonb_set(case when data ? 'fresh_start_last' then data || jsonb_build_object('fresh_start_prev', data->'fresh_start_last') else data end,
                    '{{fresh_start_last}}', {lit(rec)}::jsonb) where key = 'ops_settings' and jsonb_typeof(data) = 'object' returning key""")
    chk(ok and r, "the batch is recorded for Hub settings > Fresh start > Undo (the earlier fresh start's record is kept beside it)")
say(f"  ✓ {len(close)} closed · {len(give)} given to Client Care · {len(reword)} reworded" if patches else "  · nothing in Needs Attention needed changing")

say(); say("PART 3 · READ BACK")
time.sleep(float(os.environ.get("SB_SETTLE", "6")))
for fn in FNS:
    m = meta(fn) or {}
    chk(m.get("verify_jwt") == before[fn]["verify_jwt"] and isinstance(m.get("version"), int) and m["version"] > (before[fn].get("version") or 0),
        f"{fn}: gateway setting kept · now version {m.get('version')} (was {before[fn].get('version')})")
ok, r = sql("select data from public.app_data where key = 'ops_items'")
after = {str(i.get("id")): i for i in as_list(r[0]["data"])} if ok and r else {}
chk(all(after.get(str(i["id"]), {}).get("status") == "done" and after[str(i["id"])].get("fresh_start") == batch for i in close), f"all {len(close)} past-due items read back closed in this batch")
if give: chk(all(after.get(str(i["id"]), {}).get("owner") == CC["email"] or after.get(str(i["id"]), {}).get("status") != "open" for i in give), f"all {len(give)} shift-note flags read back with {CC['full_name']}")
if reword: chk(all("won't be covered" in str(after.get(str(i["id"]), {}).get("title")) for i in reword), "the family-call cards read back \"won't be covered\"")
ok, r = sql("select data->'fresh_start_last'->>'id' as id from public.app_data where key = 'ops_settings'")
if close: chk(ok and r and r[0]["id"] == batch, "Undo is ready (Hub settings > Fresh start > Undo, for 7 days)")
left = [i for i in after.values() if i.get("status") == "open"]
say(f"  · open now: {len(left)} · with nobody on them: {sum(1 for i in left if not i.get('owner'))}")
say()
say("RESULT: " + ("DONE · Needs Attention is cleaned up, new shift-note flags go to Client Care, and family-call cards say \"won't be covered\" for shifts still ahead." if not fails else "CHECK THE ✗ LINES."))
say("Nothing was texted or emailed. To reopen what was closed: Hub settings > Fresh start > Undo (7 days).")
done(0 if not fails else 8)
