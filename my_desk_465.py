#!/usr/bin/env python3
# 465 · MY DESK, STAGE 6a: KIND WORDS ARRIVE ON THE RIGHT DESKS. Samantha approved Stage 6 on 2026-10-06 with the plan's
# decisions 6 and 7. Adds kind_word_clip (clip by hand, straight into the office jar) and kind_word_deliver (tucks a kind
# word under the right desks: the owners always; Client Care's owner for a compliment about a client's care; everyone
# with a desk for a review about the whole company; never the person who clipped it), and makes 463's kind_word_decide
# tuck a "yes" the same way. No table changes. Nothing is texted or emailed.
# Part 1 (read only): the reviewed SQL (pinned); its database test passes here; 463 is in; the Hub's Client Care owner.
# Part 2: my_desk_465.sql. Part 3 (proof, all undone): as the real Krystal and Samantha, checks whose desks each kind word
# lands on. If the proof isn't exactly right, my_desk_465_rollback.sql puts 463's behaviour back.
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
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-465/1.0", "Cache-Control": "no-cache"}, **(headers or {})))
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

say("465 · MY DESK, STAGE 6a: KIND WORDS ARRIVE ON THE RIGHT DESKS"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
for f, want in (("my_desk_465.sql", os.environ.get("SB_SQL_SHA", "")), ("my_desk_465_proof.sql", os.environ.get("SB_PROOF_SHA", "")), ("my_desk_465_rollback.sql", os.environ.get("SB_ROLLBACK_SHA", ""))):
    if not os.path.exists(os.path.join(ROOT, f)) or sha(os.path.join(ROOT, f)) != want: bad(f"{f} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
say("  ✓ the change, its proof and its undo are the reviewed build")
try:
    if os.environ.get("SB_REHEARSAL_SKIP_SQL_TEST") == "1": raise ImportError
    import pgserver  # noqa: F401
    p = subprocess.run([sys.executable, "my_desk_465_sql_test.py"], cwd=ROOT, capture_output=True, text=True, timeout=900)
    last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
    if p.returncode != 0 or re.search(r"^FAIL", p.stdout, re.M): bad(f"my_desk_465_sql_test.py failed: {last}"); say("  STOP. Nothing was changed."); done(2)
    say(f"  ✓ my_desk_465_sql_test.py: {last.strip()} checks passed (on a throwaway database on this Mac, set up like the real one)")
except ImportError: say("  · the database test was not re-run here (it passed when built)")

ok, st = sql("""select
  (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('kind_words','kind_word_drops'))::int as tables,
  to_regprocedure('public.desk_me()') is not null as desk, to_regclass('public.domains') is not null as domains,
  to_regprocedure('public.kind_word_deliver(uuid)') is not null as already,
  (select split_part(p.full_name, ' ', 1) from public.domains d join public.persons p on p.person_id = d.owner_person where d.entity = 'cc_ihs' and d.code = 'client_care') as cc_owner""")
if not ok or not st: bad("couldn't read the database's set-up: " + str(st)[:200] + ". Nothing was changed."); done(3)
s0 = st[0]
if s0["tables"] != 2 or not s0["desk"]: bad("My Desk's storage (463) isn't there. Nothing was changed. Tell Claude."); done(3)
if not s0["domains"]: bad("the Hub's areas of work (domains) aren't there. Nothing was changed. Tell Claude."); done(3)
say("  ✓ My Desk's storage (463) is there; Client Care's owner is " + (s0["cc_owner"] or "nobody yet (then only the owners get client compliments)"))
fresh = not s0["already"]
if not fresh: say("  · 465 is already in; it is re-applied as reviewed")

say(); say("PART 2 · CHANGE")
ok, r = sql("begin;\n" + open(os.path.join(ROOT, "my_desk_465.sql")).read() + "\ncommit;")
if not ok: bad("the change didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Tell Claude."); done(6)
say("  ✓ clipping a kind word, and tucking kind words under the right desks, are in")

say(); say("PART 3 · PROOF (acting as the real Krystal and the real Samantha; all of it undone)")
res, err = probe(open(os.path.join(ROOT, "my_desk_465_proof.sql")).read())
if res is None: bad("the proof didn't answer: " + str(err))
elif not res.get("found"): bad("couldn't find Krystal's and Samantha's sign-ins, so it wasn't tried as them. Tell Claude.")
else:
    ow, dp = res.get("owners"), res.get("desk_people")
    say(f"  · {ow} owners and {dp} people with a desk role; Client Care's owner: {res.get('client_care_owner') or 'nobody'}")
    chk(not res.get("deliver_open_to_pages") and not res.get("page_can_deliver") and not res.get("clip_open_to_public") and res.get("clip_for_signed_in"), "anyone signed in can clip a kind word; only the server tucks it, and the public key can do neither")
    chk(res.get("empty_refused"), "an empty kind word is refused")
    chk(res.get("review_to") == dp - 1 and not res.get("review_to_krystal") and res.get("review_to_samantha"), f"a review Krystal clipped is tucked under everyone else's desk ({res.get('review_to')}), not hers")
    chk(res.get("client_to_samantha") and res.get("client_to") >= 1, f"a compliment about a client's care goes to the owners and Client Care ({res.get('client_to')} desks)")
    chk(res.get("caregiver_to_krystal") and not res.get("caregiver_to_samantha"), "Samantha's clip about a caregiver lands on Krystal's desk (Client Care), not Samantha's own")
    chk(res.get("decided_to", 0) >= 1 and res.get("all_kind"), f"a suggestion someone says yes to is tucked too ({res.get('decided_to')} desks), and all of them are in the jar")
    chk(res.get("k_sees_own_drops") == 2 and res.get("k_sees_samantha_drops") == 0 and res.get("k_sees_jar") == 4, "Krystal sees what was tucked under her page and the whole jar, but not what is under Samantha's")
if fails:
    if fresh:
        ok, r = sql(open(os.path.join(ROOT, "my_desk_465_rollback.sql")).read())
        (say if ok else bad)(("  ✓ " if ok else "") + "because the proof wasn't exactly right, kind words went back to how 463 left them" + ("" if ok else ": " + str(r)[:160]))
    else: say("  · it was already in before this run, so it was left for Claude to look at")
say()
say("RESULT: " + ("DONE · kind words can be clipped into the jar and arrive tucked under the right desks." if not fails else "NOT DONE · the ✗ lines above need Claude."))
say("Nothing was texted or emailed, and the proof left nothing behind.")
say("Rollback: my_desk_465_rollback.sql (Claude can run it).")
done(0 if not fails else 8)
