#!/usr/bin/env python3
# 442 · SAFE SAVES STEP 5: LOCK THE DOOR. Samantha approved the safe saves plan 2026-10-04 ("yes to all"):
# https://claude.ai/artifact/Y8Kmn4hR7rmWt9keXG6uGd . The database refuses any whole-list save of candidates or
# caregivers from a signed-in page (upsert / update / insert / delete, and the old per-item writer for those two lists),
# so an old page or tool can never do it again. One person at a time (app_data_items_apply), caregiver connect, the
# sweep's fields and the server's own jobs are unaffected; every other list saves exactly as before.
# Part 1 (read only): the reviewed SQL (pinned); the tests pass here; app_data has row security on (not forced) and the
#   safe-save functions run as the table's owner (so they are not locked out). Part 2: people_lock.sql.
# Part 3 (proof, all undone): as a signed-in office user, the four kinds of whole save are refused and the lists are
#   unchanged; the one-person save and another list still work. If the proof is not exactly right, the lock is taken
#   straight back off (people_lock_rollback.sql). Prints results only, nothing about anybody.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil, time
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); REF = "zngsgedlsxinbygwmxwn"
ROOT = os.environ["SB_REPO"]; BASE = os.environ.get("SB_BASE", ""); SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co"); HUB = os.environ.get("SB_HUB_BASE", "https://cc.mo-care.com/")

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
def http(method, url, body=None, headers=None, timeout=200, raw=False):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-442/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            b = r.read(); return r.status, (b if raw else b.decode(errors="replace"))
    except urllib.error.HTTPError as e: return e.code, (b"" if raw else e.read().decode(errors="replace"))
    except Exception as e: return None, (b"" if raw else type(e).__name__)
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, f"HTTP {s}: {b[:300]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:200]
def lit(v): return "'" + str(v).replace("'", "''") + "'"
def fmeta(fn):
    s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{fn}", headers=MG())
    try: return s, (json.loads(b) if s == 200 else None)
    except Exception: return s, None
def keys():
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_publishable_") or v.startswith("sb_secret_")) and "·" not in v and "*" not in v
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys{q}", headers=MG())
        if s != 200: continue
        try: arr = json.loads(b)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        got = {k.get("name"): k.get("api_key", "") for k in arr if isinstance(k, dict)}
        got = {k: v for k, v in got.items() if usable(v)}
        if got.get("anon"): return got
    return {}
shab = lambda b: hashlib.sha256(b).hexdigest()
sha = lambda p: shab(open(p, "rb").read())
def git(*a): return subprocess.run(["git", *a], cwd=ROOT, capture_output=True)
def chk(good, msg): (say if good else bad)(("  ✓ " if good else "") + msg)
pinpath = lambda k: f"supabase/functions/{k}.ts" if k.startswith("_shared/") else f"supabase/functions/{k}/index.ts"
def deps(path, seen):
    if path in seen or not os.path.exists(path): return
    seen.add(path)
    for m in re.findall(r"""from\s+['"](\.{1,2}/[^'"]+)['"]|import\s+['"](\.{1,2}/[^'"]+)['"]""", open(path).read()):
        deps(os.path.normpath(os.path.join(os.path.dirname(path), m[0] or m[1])), seen)
def need():
    s = set(); deps(os.path.join(ROOT, f"supabase/functions/{FN}/index.ts"), s)
    return {os.path.relpath(x, ROOT).replace(os.sep, "/") for x in s}
def live_files():
    tmp = tempfile.mkdtemp(prefix="sw441-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
    d = subprocess.run([SUPA, "functions", "download", FN, "--project-ref", REF, "--use-api"], cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    live = {}
    for root, _, files in os.walk(tmp):
        for f in files:
            lp = os.path.join(root, f).replace(os.sep, "/")
            if "/functions/" in lp: live["supabase/functions/" + lp.split("/functions/", 1)[1]] = sha(lp)
    shutil.rmtree(tmp, ignore_errors=True)
    return d.returncode == 0, live
def base_sha(rel):
    b = git("show", f"{BASE}:{rel}")
    return shab(b.stdout) if b.returncode == 0 else None

def probe(q):
    """The proof always ends by raising PROBE_RESULT: {json}. Read that JSON exactly (the API wraps the error text in its
    own JSON, so the message is taken from it first, then the result is decoded from the marker on)."""
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    texts = []
    try:
        j = json.loads(b); texts.append(j.get("message") if isinstance(j, dict) else str(j))
    except Exception: pass
    texts.append(b.replace('\\"', '"'))
    for t in texts:
        if not t or "PROBE_RESULT: " not in t: continue
        try: return json.JSONDecoder().raw_decode(t[t.index("PROBE_RESULT: ") + len("PROBE_RESULT: "):])[0], None
        except Exception: continue
    return None, f"HTTP {s}: {b[:240]}"

say("442 · SAFE SAVES STEP 5: LOCK THE DOOR"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
for f, want in (("people_lock.sql", os.environ.get("SB_SQL_SHA", "")), ("people_lock_proof.sql", os.environ.get("SB_PROOF_SHA", "")), ("people_lock_rollback.sql", os.environ.get("SB_ROLLBACK_SHA", ""))):
    if not os.path.exists(os.path.join(ROOT, f)) or sha(os.path.join(ROOT, f)) != want: bad(f"{f} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
say("  ✓ the lock, its proof and its undo are the reviewed build")
try:
    if os.environ.get("SB_REHEARSAL_SKIP_SQL_TEST") == "1": raise ImportError
    import pgserver  # noqa: F401
    p = subprocess.run([sys.executable, "people_lock_sql_test.py"], cwd=ROOT, capture_output=True, text=True, timeout=600)
    last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
    if p.returncode != 0 or re.search(r"^FAIL", p.stdout, re.M): bad(f"people_lock_sql_test.py failed: {last}"); say("  STOP. Nothing was changed."); done(2)
    say(f"  ✓ people_lock_sql_test.py: {last.strip()} (on a throwaway database on this Mac, set up like the real one)")
except ImportError: say("  · the database tests were not re-run here (they passed when built)")
ok, st = sql("""select c.relrowsecurity as rls, c.relforcerowsecurity as forced, pg_get_userbyid(c.relowner) as owner,
  (select string_agg(p.proname || '=' || pg_get_userbyid(p.proowner) || (case when p.prosecdef then '' else '(invoker)' end), ',') from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname in ('app_data_items_apply', 'caregiver_connect_apply', 'caregiver_sweep_patch')) as fns,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'app_data' and policyname like 'app_data_people_lock_%')::int as already
  from pg_class c where c.oid = 'public.app_data'::regclass""")
if not ok or not st: bad("couldn't read app_data's set-up. Nothing was changed."); done(3)
s0 = st[0]
if not s0["rls"] or s0["forced"]: bad("app_data's row security isn't in the expected state (on, not forced). Nothing was changed. Tell Claude."); done(3)
fns = dict(x.split("=", 1) for x in (s0["fns"] or "").split(",") if "=" in x)
if set(fns) != {"app_data_items_apply", "caregiver_connect_apply", "caregiver_sweep_patch"} or any(v != s0["owner"] for v in fns.values()):
    bad("the safe-save functions don't all run as the table's owner, so the lock could shut them out too. Nothing was changed. Tell Claude."); done(3)
say("  ✓ row security is on (not forced), and the one-person save, caregiver connect and the sweep's save run as the table's owner")
say("  · " + ("the lock is already on (an earlier run)" if s0["already"] == 3 else "the lock is not on yet"))

say(); say("PART 2 · CHANGE")
ok, r = sql("begin;\n" + open(os.path.join(ROOT, "people_lock.sql")).read() + "\ncommit;")
if not ok: bad("the lock didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Tell Claude."); done(6)
say("  ✓ the lock is on: the database refuses whole-list saves of candidates and caregivers from any page")

say(); say("PART 3 · PROOF (as a signed-in office user; all of it undone)")
res, err = probe(open(os.path.join(ROOT, "people_lock_proof.sql")).read())
if res is None: bad("the proof didn't answer: " + str(err))
else:
    good = (res.get("whole_upsert") == "refused" and res.get("update") == "refused" and res.get("delete") == "refused" and res.get("old_item_save") == "refused"
            and isinstance(res.get("one_person_save"), dict) and res["one_person_save"].get("ok") is True and res.get("other_list") == "allowed"
            and res.get("candidates_same") is True and res.get("caregivers_same") is True)
    chk(res.get("whole_upsert") == "refused" and res.get("update") == "refused" and res.get("delete") == "refused" and res.get("old_item_save") == "refused",
        f"an old-style whole save ({res.get('whole_upsert')}), a plain update ({res.get('update')}), a delete ({res.get('delete')}) and the old per-item writer ({res.get('old_item_save')}) are all refused")
    chk(res.get("candidates_same") is True and res.get("caregivers_same") is True, "both lists are exactly as they were")
    chk(isinstance(res.get("one_person_save"), dict) and res["one_person_save"].get("ok") is True, "the one-person-at-a-time save still works" + ("" if isinstance(res.get("one_person_save"), dict) and res["one_person_save"].get("ok") else f" ({res.get('one_person_save')})"))
    chk(res.get("other_list") == "allowed", f"every other list still saves (Needs Attention: {res.get('other_list')})")
if fails:
    ok, r = sql(open(os.path.join(ROOT, "people_lock_rollback.sql")).read())
    (say if ok else bad)(("  ✓ " if ok else "") + "because the proof wasn't exactly right, the lock was taken back off (nothing else changed)" + ("" if ok else ": " + str(r)[:160]))
say()
say("RESULT: " + ("DONE · an old page or tool can never again save over the candidate or caregiver lists." if not fails else "NOT DONE · the ✗ lines above need Claude; the lock is off again."))
say("Nothing was texted or emailed, and no candidate, caregiver or other record was changed.")
say("Rollback: people_lock_rollback.sql (Claude can run it).")
done(0 if not fails else 8)
