#!/usr/bin/env python3
# 407 · REMOTE ORIENTATION, SLICE 1A: WELCOME CALLS. Samantha 2026-10-01 ("yes start building 1").
# Once references and checks are clear and Viventium Step 2 is done, the office presses "Invite to welcome call"; the
# new hire books a 15-minute Google Meet call (one shared room) during interview hours, never overlapping an interview;
# confirmations and reminders with the Meet link go out on their own; the office can reschedule (Step 2 not done),
# mark a missed call, "call them now" when an interview no-shows, and mark the call done.
# Part 1 (read only): reviewed builds; coordinator_busy has no rule that would refuse the new 'welcome_call' kind.
# Part 2: welcome_calls.sql in one transaction; the new welcome-call function (sign-in check on); the guarded
#   one-at-a-time redeploy of every function that includes a changed file.
# Part 3 (proof): the new step refuses the public key; the public cannot read the table; a throwaway invitation books
#   the first open time through the public functions, blocks that time for interviews, cancels, and is removed.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil
REPORT = os.environ["SB_REPORT"]; FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPO = os.path.dirname(os.path.dirname(FNROOT))
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
BASE = os.environ.get("SB_BASE", ""); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co"); HELPER = "welcome-call"
FIRST = []
FIRST = ["outreach-check", "interview-messages", "reference-chase", "send-candidate-message", "applicant-invite", "reference-send"]
lines = []; fails = []
def say(s=""):
    s = str(s); s = re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", s); s = re.sub(r"[\w.%+\-]+@[\w.\-]+\.[A-Za-z]{2,}", "(an email)", s)
    print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Anything done above stays done; nothing after it ran. Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=150):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-welcome407/1.0"}, **(headers or {})))
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
def fmeta(fn):
    s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{fn}", headers=MG())
    try: return s, (json.loads(b) if s == 200 else None)
    except Exception: return s, None
shab = lambda b: hashlib.sha256(b).hexdigest()
sha = lambda p: shab(open(p, "rb").read())
def git(*a): return subprocess.run(["git", *a], cwd=REPO, capture_output=True)

def deps(path, seen):
    if path in seen or not os.path.exists(path): return
    seen.add(path)
    for m in re.findall(r"""from\s+['"](\.{1,2}/[^'"]+)['"]|import\s+['"](\.{1,2}/[^'"]+)['"]""", open(path).read()):
        deps(os.path.normpath(os.path.join(os.path.dirname(path), m[0] or m[1])), seen)
HIST = {}
def history(rel):  # every committed version of one file (sha256 of its bytes), so "known code" can be told from unknown
    if rel not in HIST:
        hs = set()
        for c in git("log", "--format=%H", "--", rel).stdout.decode().split():
            b = git("show", f"{c}:{rel}")
            if b.returncode == 0: hs.add(shab(b.stdout))
        if os.path.exists(os.path.join(REPO, rel)): hs.add(sha(os.path.join(REPO, rel)))
        HIST[rel] = hs
    return HIST[rel]

say("407 · REMOTE ORIENTATION: WELCOME CALLS"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not BASE or git("cat-file", "-e", BASE + "^{commit}").returncode != 0: bad("the reviewed starting point isn't in this folder's history"); say("  STOP. Nothing was run."); done(2)
changed = sorted(x for x in git("diff", "--name-only", BASE, "HEAD", "--", "supabase/functions").stdout.decode().split() if x.endswith(".ts") and os.path.exists(os.path.join(REPO, x)))
pinned = {(f"supabase/functions/{k}.ts" if k.startswith("_shared/") else f"supabase/functions/{k}/index.ts"): v for k, v in SHAS.items()}
if set(changed) != set(pinned): bad("the list of changed files isn't the reviewed list"); say("  STOP. Nothing was run."); done(2)
for rel, want in pinned.items():
    if not os.path.exists(os.path.join(REPO, rel)) or sha(os.path.join(REPO, rel)) != want: bad(f"{rel.split('functions/')[1]} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
say(f"  ✓ the {len(changed)} changed files are the reviewed builds")
users = []
for fn in sorted(os.listdir(FNROOT)):
    p = os.path.join(FNROOT, fn, "index.ts")
    if fn.startswith("_") or not os.path.exists(p): continue
    s = set(); deps(p, s)
    if fn != HELPER and any(os.path.normpath(os.path.join(REPO, c)) in s for c in changed): users.append(fn)
users = [f for f in FIRST if f in users] + [f for f in users if f not in FIRST]
ok, before = sql("select coalesce(max(id), 0)::bigint as id from contact_send_refusal")
if not ok: bad("couldn't read the refusal log. Nothing was changed."); done(4)
mark = before[0]["id"]
say(f"  ✓ {len(users)} functions include a changed file; each is redeployed only if its live copy is known code")

ok, cons = sql("select count(*)::int as n from pg_constraint where conrelid = 'public.coordinator_busy'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%source%'")
if not ok or cons[0]["n"] != 0: bad("coordinator_busy has a rule on its kinds that would refuse welcome calls. Nothing was changed. Tell Claude."); done(4)
say("  ✓ the calendar table will accept welcome calls")
SQLF = os.path.join(REPO, "welcome_calls.sql")
if sha(SQLF) != os.environ.get("SB_SQL_SHA", ""): bad("welcome_calls.sql is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
say("  ✓ the database change is the reviewed build")

say(); say("PART 2 · CHANGE")
ok, r = sql("begin;\n" + open(SQLF).read() + "\ncommit;")
if not ok: bad("the database change didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Nothing else was changed. Tell Claude."); done(6)
say("  ✓ welcome calls are in the database (record, open times, booking, the shared Meet link)")
NEWFN = "welcome-call"
p = subprocess.run([SUPA, "functions", "deploy", NEWFN, "--project-ref", REF, "--use-api"], cwd=REPO, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
sN, mN = fmeta(NEWFN)
if p.returncode != 0 and sN != 200: bad("the no-show step didn't deploy: " + (p.stderr or p.stdout)[-200:])
elif (mN or {}).get("verify_jwt") is not True: bad(f"the no-show step's sign-in check isn't on ({(mN or {}).get('verify_jwt')})")
else: say("  ✓ the welcome-call step (invite, reschedule, missed, call them now, done) is up, sign-in check on")
say(); say("PART 2b · THE REST (one function at a time)")
deployed, already, skipped, absent = [], [], [], []
for fn in users:
    sM, m = fmeta(fn)
    if sM == 404: absent.append(fn); continue
    vj = (m or {}).get("verify_jwt")
    if not isinstance(vj, bool): skipped.append((fn, "couldn't read its gateway setting")); continue
    tmp = tempfile.mkdtemp(prefix="dnd383-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
    d = subprocess.run([SUPA, "functions", "download", fn, "--project-ref", REF, "--use-api"], cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    live = {}
    for root, _, files in os.walk(tmp):
        for f in files:
            lp = os.path.join(root, f).replace(os.sep, "/")
            if "/functions/" in lp: live["supabase/functions/" + lp.split("/functions/", 1)[1]] = sha(lp)
    shutil.rmtree(tmp, ignore_errors=True)
    mine = f"supabase/functions/{fn}/index.ts"
    if d.returncode != 0 or mine not in live: skipped.append((fn, "couldn't read its live copy")); continue
    if all(os.path.exists(os.path.join(REPO, k)) and h == sha(os.path.join(REPO, k)) for k, h in live.items()):
        already.append(fn); continue
    b = git("show", f"{BASE}:{mine}")
    if live[mine] not in (sha(os.path.join(REPO, mine)), shab(b.stdout) if b.returncode == 0 else ""): skipped.append((fn, "its live code is not a reviewed GitHub version")); continue
    unknown = [k.split("supabase/functions/", 1)[1] for k, h in live.items() if k != mine and h not in history(k)]
    if unknown: skipped.append((fn, "live code not in GitHub: " + ", ".join(sorted(unknown))[:160])); continue
    newer = sorted(k.split("supabase/functions/", 1)[1] for k, h in live.items() if os.path.exists(os.path.join(REPO, k)) and h != sha(os.path.join(REPO, k))
                   and k not in changed and not k.endswith(f"/{fn}/index.ts"))
    p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"] + ([] if vj else ["--no-verify-jwt"]),
                       cwd=REPO, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    sN, mN = fmeta(fn)
    if p.returncode != 0: bad(f"{fn} didn't deploy: " + (p.stderr or p.stdout)[-200:]); continue
    if (mN or {}).get("verify_jwt") != vj:
        http("PATCH", f"{API}/v1/projects/{REF}/functions/{fn}", {"verify_jwt": vj}, MG()); sN, mN = fmeta(fn)
        if (mN or {}).get("verify_jwt") != vj: bad(f"{fn}: its gateway setting changed and couldn't be put back. Tell Claude."); continue
    deployed.append(fn); say(f"  ✓ {fn}" + (f" (also brought its shared files up to GitHub: {', '.join(newer)})" if newer else ""))
for fn in already: say(f"  ✓ {fn} already had it")
for fn in absent: say(f"  · {fn} is not deployed on the Hub (nothing to do)")
for fn, why in skipped: bad(f"{fn} NOT changed: {why}")

say(); say("PART 3 · PROOF")
s_, kb = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers=MG())
try: keys = {k.get("name"): k.get("api_key", "") for k in json.loads(kb)}
except Exception: keys = {}
ANON = keys.get("anon", "")
s1, _ = http("POST", f"https://{REF}.supabase.co/functions/v1/{NEWFN}", {"action": "preview", "first": "Test"}, {"Authorization": "Bearer " + ANON, "apikey": ANON})
(say if s1 == 401 else bad)(("  ✓ " if s1 == 401 else "") + f"the welcome-call step refuses anyone not signed in as office staff ({s1})")
B = f"https://{REF}.supabase.co/rest/v1"
HA = {"Authorization": "Bearer " + ANON, "apikey": ANON}
s2, b2 = http("GET", f"{B}/welcome_calls?select=id&limit=1", None, HA)
pub = (s2 in (401, 403)) or (s2 == 200 and b2.strip() == "[]")
(say if pub else bad)(("  ✓ " if pub else "") + f"the public cannot read welcome calls ({s2})")
ok, ins = sql("insert into welcome_calls (candidate_id, first_name, last_name, invited_by) values ('proof-407', 'Proof', 'Test', 'Desktop 407 proof') returning id")
if not ok: bad("couldn't make the throwaway invitation: " + str(ins)[:160])
else:
    wid = ins[0]["id"]
    try:
        s3, b3 = http("POST", f"{B}/rpc/welcome_open_slots", {}, HA)
        slots = json.loads(b3) if s3 == 200 else []
        say(f"  · open welcome-call times in the next 14 days: {len(slots)}")
        if slots:
            st = slots[0]["starts_at"]
            s4, b4 = http("POST", f"{B}/rpc/welcome_book", {"p_id": wid, "p_starts": st}, HA)
            ok5, r5 = sql(f"select count(*)::int as n from coordinator_busy where source = 'welcome_call' and source_id = '{wid}' and coordinator_id is null")
            s6, b6 = http("POST", f"{B}/rpc/interview_open_slots", {}, HA)
            iv = [x["starts_at"] for x in (json.loads(b6) if s6 == 200 else [])]
            ok7, r7 = sql(f"select count(*)::int as n from interview_open_slots() i where i.starts_at < '{st}'::timestamptz + interval '15 minutes' and i.ends_at > '{st}'::timestamptz")
            g = s4 == 200 and ok5 and r5[0]["n"] == 1 and ok7 and r7[0]["n"] == 0
            (say if g else bad)(("  ✓ " if g else "") + f"the public page booked the first open time ({s4}); it blocks everyone, and no interview time overlaps it" + ("" if g else f" ({b4[:120]}, {r5}, {r7})"))
            s8, _ = http("POST", f"{B}/rpc/welcome_cancel", {"p_id": wid}, HA)
            ok9, r9 = sql(f"select count(*)::int as n from coordinator_busy where source = 'welcome_call' and source_id = '{wid}'")
            (say if s8 == 200 and ok9 and r9[0]["n"] == 0 else bad)(("  ✓ " if s8 == 200 and ok9 and r9[0]["n"] == 0 else "") + "cancelling gives the time back")
        else: say("  · no open times yet (interview hours are set under Interviews), so the booking proof was skipped")
    finally:
        sql(f"delete from coordinator_busy where source = 'welcome_call' and source_id = '{wid}'")
        sql(f"delete from welcome_calls where id = '{wid}'")
        say("  ✓ the throwaway invitation is removed")
say()
if fails: say(f"RESULT: PARTLY DONE · {len(deployed)} redeployed, {len(already)} already had it; the ✗ lines above were left alone. Tell Claude.")
else: say(f"RESULT: DONE · {len(deployed)} redeployed, {len(already)} already had it. Open Needs Attention to see the cards.")
say("Rollback: Claude can redeploy the previous versions; the cards are ordinary Needs Attention items (close them with Done).")
done(1 if fails else 0)
