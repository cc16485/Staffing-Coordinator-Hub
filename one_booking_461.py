#!/usr/bin/env python3
# 461 · ONE PERSON, ONE INTERVIEW; REAPPLY WITH THE OFFICE REVIEWING FIRST; THE DO-NOT-REHIRE LIST STOPS BOOKING.
# Samantha, 2026-10-05: Shakira Sutton applied twice, booked once per application, cancelled one and the other stayed on the
# Interviews list ("both": clean it up AND stop it happening; "reapply with us reviewing first"). Same day, Amanda Peak:
# "she applied multiple times and we have apparently told her over the phone that she isn't rehireable".
#   SQL (interview_person_461.sql, one transaction): bookings are per PERSON (same phone or email), a cancel frees the
#     calendar time, someone the office chose not to move forward with waits for "Approve, let them book", someone on the
#     do-not-rehire list cannot book at all, and leftover holds from old cancellations are freed.
#   interview-messages: no "pick a time" reminders to anyone waiting for the office or already booked under another
#     application; the office is told once, in office hours.
# NOTHING IS SENT by this step. No booking is cancelled or moved (a live booking that belongs to someone who would now wait
# for the office is listed for the office to decide). The proof is a practice run of the reminders that sends nothing.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil, time
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
HUB_REF = "zngsgedlsxinbygwmxwn"
HUB = os.environ["SB_REPO"]; HUB_BASE = os.environ.get("SB_BASE", "")
HUB_SHAS = json.loads(os.environ["SB_SHAS"])
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB_REF}.supabase.co")
FNS = ["interview-messages"]
SQLFILE = "interview_person_461.sql"; RBFILE = "interview_person_461_rollback.sql"
RULES = ["interview_book", "interview_mine", "interview_cancel", "interview_reschedule", "interview_self_changes"]
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for h in HIDE:
        if h: s = s.replace(h, "(hidden)")
    s = re.sub(r"(sbp_|eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._\-]+", "(hidden)", s); s = re.sub(r"[\w.%+\-]+@[\w.\-]+\.[A-Za-z]{2,}", "(an email)", s)
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
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-461/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{HUB_REF}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, f"HTTP {s}: {b[:300]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:200]
def fmeta(ref, fn):
    s, b = http("GET", f"{API}/v1/projects/{ref}/functions/{fn}", headers=MG())
    try: return s, (json.loads(b) if s == 200 else None)
    except Exception: return s, None
def keys(ref):
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_publishable_") or v.startswith("sb_secret_")) and "·" not in v and "*" not in v
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{ref}/api-keys{q}", headers=MG())
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
pinpath = lambda k: f"supabase/functions/{k}.ts" if k.startswith("_shared/") else f"supabase/functions/{k}/index.ts"
def git(root, *a): return subprocess.run(["git", *a], cwd=root, capture_output=True)
def deps(path, seen):
    if path in seen or not os.path.exists(path): return
    seen.add(path)
    for m in re.findall(r"""from\s+['"](\.{1,2}/[^'"]+)['"]|import\s+['"](\.{1,2}/[^'"]+)['"]""", open(path).read()):
        deps(os.path.normpath(os.path.join(os.path.dirname(path), m[0] or m[1])), seen)
def need(root, fn):
    s = set(); deps(os.path.join(root, f"supabase/functions/{fn}/index.ts"), s)
    return {os.path.relpath(x, root).replace(os.sep, "/") for x in s}
def live_files(ref, fn):
    tmp = tempfile.mkdtemp(prefix="ob461-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
    d = subprocess.run([SUPA, "functions", "download", fn, "--project-ref", ref, "--use-api"], cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    live = {}
    for r, _, files in os.walk(tmp):
        for f in files:
            lp = os.path.join(r, f).replace(os.sep, "/")
            if "/functions/" in lp: live["supabase/functions/" + lp.split("/functions/", 1)[1]] = sha(lp)
    shutil.rmtree(tmp, ignore_errors=True)
    return d.returncode == 0, live
def base_sha(root, base, rel):
    b = git(root, "show", f"{base}:{rel}")
    return shab(b.stdout) if b.returncode == 0 else None
def reviewed(root, base, shas, label, extra=()):
    if not base or git(root, "cat-file", "-e", base + "^{commit}").returncode != 0: bad(f"the reviewed starting point isn't in the {label} history"); say("  STOP. Nothing was run."); done(2)
    changed = set(git(root, "diff", "--name-only", base, "HEAD").stdout.decode().split())
    for rel, want in [(pinpath(k), v) for k, v in shas.items()] + list(extra):
        if rel not in changed or not os.path.exists(os.path.join(root, rel)) or sha(os.path.join(root, rel)) != want:
            bad(f"{label}: {rel.split('functions/')[-1]} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
    return changed
def state(ref, root, base, fn, pinned):
    """'new' | 'base' | 'this' | 'other' for one live function, with its gateway setting."""
    s, m = fmeta(ref, fn)
    if s == 404: return "new", None
    vj = (m or {}).get("verify_jwt")
    okd, live = live_files(ref, fn)
    if not okd or not isinstance(vj, bool): return "unreadable", vj
    nd = need(root, fn)
    if all(k in live and live[k] == sha(os.path.join(root, k)) for k in nd): return "this", vj
    if all((k in live and live[k] == base_sha(root, base, k)) or (k not in live and base_sha(root, base, k) is None and k in pinned) for k in nd): return "base", vj
    return "other", vj
def deploy(ref, root, fn, vj, label):
    p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", ref, "--use-api"] + ([] if vj in (True, None) else ["--no-verify-jwt"]), cwd=root, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    okd, live = live_files(ref, fn)
    good = okd and all(k in live and live[k] == sha(os.path.join(root, k)) for k in need(root, fn))
    if not good: bad(f"{label} {fn} didn't deploy: " + (p.stderr or p.stdout)[-200:]); return False
    want = True if vj is None else vj
    sN, mN = fmeta(ref, fn)
    if (mN or {}).get("verify_jwt") != want:
        http("PATCH", f"{API}/v1/projects/{ref}/functions/{fn}", {"verify_jwt": want}, MG()); sN, mN = fmeta(ref, fn)
    chk((mN or {}).get("verify_jwt") == want, f"{label}: {fn} deployed, version {(mN or {}).get('version', '?')} (gateway sign-in check {'on' if want else 'off'})")
    return True
# The five booking rules, as written in a SQL file: {name: body with spacing evened out}
BODY = re.compile(r"create\s+or\s+replace\s+function\s+(?:public\.)?(\w+)\s*\([^)]*\)[\s\S]*?\bas\s+(\$\w*\$)([\s\S]*?)\2", re.I)
norm = lambda b: re.sub(r"\s+", " ", b).strip()
def bodies(path):
    out = {}
    for m in BODY.finditer(open(path).read()):
        if m.group(1) in RULES: out[m.group(1)] = norm(m.group(3))
    return out
HOLDS = """select count(*)::int as n from public.coordinator_busy cb
 where cb.source = 'interview' and cb.starts_at > now()
   and not exists (select 1 from public.interview_bookings b
                    where b.status = 'booked' and b.applicant_id::text = cb.source_id and b.starts_at = cb.starts_at)"""

say("461 · ONE PERSON, ONE INTERVIEW; REAPPLY WITH THE OFFICE REVIEWING FIRST; DO-NOT-REHIRE STOPS BOOKING")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
reviewed(HUB, HUB_BASE, HUB_SHAS, "the Hub server", extra=[(SQLFILE, os.environ.get("SB_SQL_SHA", "")), (RBFILE, os.environ.get("SB_RB_SHA", ""))])
pinned = {pinpath(k) for k in HUB_SHAS}
for fn in FNS:
    other = sorted(k for k in need(HUB, fn) if k not in pinned and base_sha(HUB, HUB_BASE, k) != sha(os.path.join(HUB, k)))
    if other: bad(f"other changes merged since the review touch {fn} ({', '.join(other)[:200]}). Ask Claude to refresh 461."); say("  STOP. Nothing was run."); done(2)
say("  ✓ the booking rules, the way back and the reminders are the reviewed build")
OLD, NEW = bodies(os.path.join(HUB, RBFILE)), bodies(os.path.join(HUB, SQLFILE))
if sorted(OLD) != sorted(RULES) or sorted(NEW) != sorted(RULES): bad("the rules files don't hold all five booking rules. Tell Claude."); done(2)
ok, live = sql("select p.proname as name, p.prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = any(array["
               + ",".join("'" + r + "'" for r in RULES) + "])")
if not ok: bad("couldn't read the live booking rules. Nothing was changed."); done(3)
seen = {}
for row in live:
    b = norm(row["src"]); seen.setdefault(row["name"], []).append("before" if b == OLD[row["name"]] else "this" if b == NEW[row["name"]] else "other")
miss = [r for r in RULES if r not in seen]; odd = [r for r in RULES if "other" in seen.get(r, [])]
if miss or odd:
    bad("the live booking rules aren't what this was built on (" + ", ".join([f"{r}: missing" for r in miss] + [f"{r}: changed by hand or by something else" for r in odd]) + "). Nothing was changed. Tell Claude.")
    done(3)
already = all(set(v) == {"this"} for v in seen.values())
say("  ✓ the five live booking rules are " + ("already this build (an earlier run)" if already else "exactly the ones this was built on"))
ST = {}
for fn in FNS:
    st, vj = state(HUB_REF, HUB, HUB_BASE, fn, pinned); ST[fn] = (st, vj)
    if st not in ("base", "this"): bad(f"the live {fn} isn't what this was built on ({st}). Nothing was changed. Tell Claude."); done(3)
    say(f"  ✓ {fn}: " + {"base": "live matches GitHub", "this": "already has this build (an earlier run)"}[st] + f" (gateway sign-in check {'on' if vj else 'off'})")
NODE = shutil.which("node") or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.path.exists(p)), "")
if NODE:
    for t in ("one_booking_461_messages_test.mjs", "prn1_messages_test.mjs", "noshow_test.mjs", "quiet_hours_425_test.mjs", "staff_alerts_one_contact_test.mjs"):
        p = subprocess.run([NODE, t], cwd=HUB, capture_output=True, text=True)
        last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
        if p.returncode != 0 or re.search(r"^FAIL", p.stdout, re.M): bad(f"{t} failed: {last}"); say("  STOP. Nothing was changed."); done(2)
        say(f"  ✓ {t}: {last.strip()} (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
say("  · the booking rules themselves were proved in a real Postgres copy with made-up people when built (interview_person_461_test.mjs, 25 checks)")
ok, h0 = sql(HOLDS)
if not ok: bad("couldn't count the calendar holds. Nothing was changed."); done(3)
ok, b0 = sql("select count(*)::int as n from public.interview_bookings where status = 'booked'")
if not ok: bad("couldn't count the booked interviews. Nothing was changed."); done(3)
say(f"  · {h0[0]['n']} future interview time(s) still blocked by a booking that was cancelled or moved (these get freed)")
say(f"  · {b0[0]['n']} booked interview(s) now. This step cancels and moves none of them.")
K = keys(HUB_REF); SVC = K.get("service_role", ""); HIDE += [SVC, K.get("anon", "")]
if not SVC: bad("couldn't read the Hub's server key for the practice run. Nothing was changed."); done(3)

say(); say("PART 2 · CHANGE")
ok, r = sql(open(os.path.join(HUB, SQLFILE)).read())
if not ok: bad("the booking rules didn't go in (the whole change was undone, nothing is half in): " + str(r)[:200]); say("  STOP. Nothing else was changed. Tell Claude."); done(5)
ok, live = sql("select p.proname as name, p.prosrc as src from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = any(array["
               + ",".join("'" + r + "'" for r in RULES) + "])")
chk(ok and len(live) == len(RULES) and all(norm(x["src"]) == NEW[x["name"]] for x in live), "the five booking rules are the new ones (per person; a cancel frees the time; review first; do-not-rehire)")
ok, pv = sql("""select has_function_privilege('anon', 'public.applicant_person_ids(uuid)', 'execute') as a1,
  has_function_privilege('anon', 'public.applicant_review_reason(uuid)', 'execute') as a2,
  has_function_privilege('authenticated', 'public.applicant_review_reason(uuid)', 'execute') as s1,
  has_function_privilege('anon', 'public.interview_book(uuid, timestamptz)', 'execute') as a3,
  has_function_privilege('anon', 'public.interview_mine(uuid)', 'execute') as a4""")
chk(ok and pv and not pv[0]["a1"] and not pv[0]["a2"] and pv[0]["s1"] and pv[0]["a3"] and pv[0]["a4"],
    "the public page can still book and see its booking, but cannot ask who someone is or why they wait; the office can")
ok, h1 = sql(HOLDS)
chk(ok and h1[0]["n"] == 0, f"leftover holds freed: {h0[0]['n']} (none left)")
ok, held = sql("""select a.first_name as f, left(coalesce(a.last_name,''), 1) as l, public.applicant_review_reason(a.id) as why,
    exists (select 1 from public.interview_bookings b where b.applicant_id = a.id and b.status = 'booked') as booked
  from public.job_applicants a
 where a.status in ('partial','new','reviewing') and a.created_at > now() - interval '60 days'
   and public.applicant_review_reason(a.id) is not null order by a.created_at""")
if ok:
    say(f"  · open applications from the last 60 days that now wait for the office: {len(held)}")
    for x in held:
        say(f"      {x['f']} {x['l']}. · " + ("on the do-not-rehire list" if x["why"] == "dnr" else "applied again after not moving forward")
            + (" · STILL HAS A BOOKED INTERVIEW (left for you to decide; nothing was cancelled)" if x["booked"] else ""))
else: bad("couldn't list who now waits for the office: " + str(held)[:160])
if fails: say("  STOP before the reminders. Tell Claude."); done(5)
for fn in FNS:
    st, vj = ST[fn]
    if st == "this": say(f"  ✓ {fn} already had it"); continue
    if not deploy(HUB_REF, HUB, fn, vj, "Hub"): say("  STOP. Tell Claude. (The booking rules are in; the reminders are unchanged.)"); done(6)

say(); say("PART 3 · PROOF (nothing is sent, nothing is saved)")
for fn in FNS:
    okd, live = live_files(HUB_REF, fn)
    chk(okd and all(k in live and live[k] == sha(os.path.join(HUB, k)) for k in need(HUB, fn)), f"{fn}: the live copy is exactly the reviewed build")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
ok, b1 = sql("select count(*)::int as n from public.interview_bookings where status = 'booked'")
chk(ok and b1[0]["n"] == b0[0]["n"], f"booked interviews unchanged ({b1[0]['n'] if ok else '?'})")
s, b = http("POST", f"{FNB}/functions/v1/interview-messages?dry=1", {}, {"Authorization": "Bearer " + SVC, "apikey": SVC})
try: j = json.loads(b)
except Exception: j = {}
w = j.get("would") or {}
chk(s == 200 and j.get("dry") is True and isinstance(w.get("held"), list), f"the reminders' practice run answers, sending nothing ({s})")
if isinstance(w.get("held"), list):
    say(f"  · reminders it would now hold back: {len(w['held'])}")
    for x in w["held"][:30]: say("      " + str(x))
say()
say("RESULT: " + ("DONE · the server side is in. Next: Claude merges the Hub and the apply page." if not fails else "PARTLY DONE · the ✗ lines above need Claude."))
say("Nothing was texted or emailed by this step, and no booking was cancelled or moved.")
say("Rollback: interview_person_461_rollback.sql puts the five booking rules back exactly; the reminders can go back to the GitHub version before this.")
done(0 if not fails else 8)
