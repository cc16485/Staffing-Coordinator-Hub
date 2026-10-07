#!/usr/bin/env python3
# 495 · MY DESK: REPEATING TASKS. Samantha, 2026-10-07 ("yes to all, go"): a to-do can repeat (every weekday, every day,
# weekly on chosen days, every 2 weeks from a date, monthly on a date, the last business day) and lands on the day's page
# by itself when the page is opened; an owner may set a signed repeating task on someone else's desk (they can tick it
# done and skip a day, never stop or change it). One new table (desk_repeats) with the desk's own row rules. Nothing is
# texted, emailed or reminded.
# Part 1 (read only): the reviewed SQL (pinned); its database test passes here; 463 is in. Part 2: my_desk_495.sql.
# Part 3 (proof, all undone): as the real Krystal and Samantha, every rule. If the proof isn't exactly right,
# my_desk_495_rollback.sql takes the table back out.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys

REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); REF = "zngsgedlsxinbygwmxwn"; ROOT = os.environ["SB_REPO"]

lines = []; fails = []
def say(s=""):
    s = str(s)
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
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-495/1.0", "Cache-Control": "no-cache"}, **(headers or {})))
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
def probe(q):
    """The proof always ends by raising PROBE_RESULT: {json}; read that JSON exactly."""
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
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
def chk(good, msg): (say if good else bad)(("  ✓ " if good else "") + msg)

say("495 · MY DESK: REPEATING TASKS"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
for f, want in (("my_desk_495.sql", os.environ.get("SB_SQL_SHA", "")), ("my_desk_495_proof.sql", os.environ.get("SB_PROOF_SHA", "")), ("my_desk_495_rollback.sql", os.environ.get("SB_ROLLBACK_SHA", ""))):
    if not os.path.exists(os.path.join(ROOT, f)) or sha(os.path.join(ROOT, f)) != want: bad(f"{f} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
say("  ✓ the change, its proof and its undo are the reviewed build")
try:
    if os.environ.get("SB_REHEARSAL_SKIP_SQL_TEST") == "1": raise ImportError
    import pgserver  # noqa: F401
    p = subprocess.run([sys.executable, "my_desk_495_sql_test.py"], cwd=ROOT, capture_output=True, text=True, timeout=900)
    last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
    if p.returncode != 0 or re.search(r"^FAIL", p.stdout, re.M): bad(f"my_desk_495_sql_test.py failed: {last}"); say("  STOP. Nothing was changed."); done(2)
    say(f"  ✓ my_desk_495_sql_test.py: {last.strip()} checks passed (on a throwaway database on this Mac, set up like the real one)")
except ImportError: say("  · the database test was not re-run here (it passed when built)")

ok, st = sql("""select
  (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('desk_lines','desk_stickies','desk_settings','desk_pages'))::int as tables,
  to_regprocedure('public.desk_me()') is not null as desk, to_regclass('public.desk_repeats') is not null as already""")
if not ok or not st: bad("couldn't read the database's set-up: " + str(st)[:200] + ". Nothing was changed."); done(3)
s0 = st[0]
if s0["tables"] != 4 or not s0["desk"]: bad("My Desk's storage (463) isn't there. Nothing was changed. Tell Claude."); done(3)
say("  ✓ My Desk's storage (463) is there")
fresh = not s0["already"]
if not fresh: say("  · 495 is already in; it is re-applied as reviewed")

say(); say("PART 2 · CHANGE")
ok, r = sql("begin;\n" + open(os.path.join(ROOT, "my_desk_495.sql")).read() + "\ncommit;")
if not ok: bad("the change didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Tell Claude."); done(6)
say("  ✓ repeating tasks (desk_repeats) are in, with the desk's own rules")

say(); say("PART 3 · PROOF (acting as the real Krystal and the real Samantha; all of it undone)")
res, err = probe(open(os.path.join(ROOT, "my_desk_495_proof.sql")).read())
if res is None: bad("the proof didn't answer: " + str(err))
elif not res.get("found"): bad("couldn't find Krystal's and Samantha's sign-ins, so it wasn't tried as them. Tell Claude.")
else:
    chk(res.get("table") and not res.get("anon_can_read"), "the table is there and the public key cannot read it")
    chk(res.get("k_own") and res.get("k_on_samantha_refused"), "Krystal sets her own repeating task, and cannot put one on Samantha's desk")
    chk(res.get("s_signed_on_krystal") and res.get("s_unsigned_refused"), "Samantha sets a SIGNED repeating task on Krystal's desk; an unsigned one there is refused")
    chk(res.get("k_sees_both") == 2 and res.get("s_reads_krystals") == 2, "Krystal sees both on her desk; Samantha (an owner) reads them too")
    chk(res.get("k_skip_signed") and res.get("k_stop_signed_refused") and res.get("k_change_signed_refused") and res.get("k_delete_signed_refused"), "Krystal may skip a day on Samantha's; she cannot stop, change or delete it")
    chk(res.get("k_stopped_own") and res.get("s_stopped_signed"), "each stops her own: who stopped it and when are stamped")
if fails:
    if fresh:
        ok, r = sql(open(os.path.join(ROOT, "my_desk_495_rollback.sql")).read())
        (say if ok else bad)(("  ✓ " if ok else "") + "because the proof wasn't exactly right, the repeating-tasks table was taken back out" + ("" if ok else ": " + str(r)[:160]))
    else: say("  · it was already in before this run, so it was left for Claude to look at")
say()
say("RESULT: " + ("DONE · repeating tasks are in. Next: Claude merges the Hub change, then Make this repeat… appears on every line's menu." if not fails else "NOT DONE · the ✗ lines above need Claude."))
say("Nothing was texted or emailed, and the proof left nothing behind.")
say("Rollback: my_desk_495_rollback.sql (Claude can run it).")
done(0 if not fails else 8)
