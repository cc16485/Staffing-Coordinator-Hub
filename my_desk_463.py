#!/usr/bin/env python3
# 463 · MY DESK, STAGE 0: THE PRIVATE STORAGE. Samantha approved the plan, its eight decisions and Stage 0 on 2026-10-05
# (https://claude.ai/artifact/CC6pJvTp9EzwoRBH5qKdt9). Creates where desks are kept and the rules for who may read or
# change them. Nothing in the Hub uses it yet (Stage 1), nothing is texted or emailed, and nothing that exists is changed.
# Part 1 (read only): the reviewed SQL (pinned); its database test passes on this Mac; the people, sign-in and role
#   tables it builds on are there; whether desks are already installed.
# Part 2: my_desk_463.sql (new tables, rules and a few checked functions only).
# Part 3 (proof, all undone): acting as the real Krystal and the real Samantha with their own sign-in details, every rule
#   is tried both ways (what must work, and what must be refused). Lists the team as the database sees it (first names).
#   If the proof isn't exactly right and the storage was new, it is taken back out (my_desk_463_rollback.sql).
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
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-463/1.0", "Cache-Control": "no-cache"}, **(headers or {})))
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

say("463 · MY DESK, STAGE 0: THE PRIVATE STORAGE"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
for f, want in (("my_desk_463.sql", os.environ.get("SB_SQL_SHA", "")), ("my_desk_463_proof.sql", os.environ.get("SB_PROOF_SHA", "")), ("my_desk_463_rollback.sql", os.environ.get("SB_ROLLBACK_SHA", ""))):
    if not os.path.exists(os.path.join(ROOT, f)) or sha(os.path.join(ROOT, f)) != want: bad(f"{f} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
say("  ✓ the change, its proof and its undo are the reviewed build")
try:
    if os.environ.get("SB_REHEARSAL_SKIP_SQL_TEST") == "1": raise ImportError
    import pgserver  # noqa: F401
    p = subprocess.run([sys.executable, "my_desk_463_sql_test.py"], cwd=ROOT, capture_output=True, text=True, timeout=900)
    last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
    if p.returncode != 0 or re.search(r"^FAIL", p.stdout, re.M): bad(f"my_desk_463_sql_test.py failed: {last}"); say("  STOP. Nothing was changed."); done(2)
    say(f"  ✓ my_desk_463_sql_test.py: {last.strip()} checks passed (on a throwaway database on this Mac, set up like the real one)")
except ImportError: say("  · the database test was not re-run here (it passed when built)")

ok, st = sql("""select
  to_regclass('public.persons') is not null as persons, to_regclass('public.auth_identities') is not null as identities,
  to_regclass('public.staff_roles') is not null as roles, to_regprocedure('public.jwt_hub_access()') is not null as jwt_fn,
  to_regprocedure('auth.uid()') is not null as uid_fn,
  (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in
     ('desk_lines','desk_stickies','desk_pages','desk_settings','desk_visits','kind_words','kind_word_drops'))::int as tables_there""")
if not ok or not st: bad("couldn't read the database's set-up: " + str(st)[:200] + ". Nothing was changed."); done(3)
s0 = st[0]
if not all(s0[k] for k in ("persons", "identities", "roles", "jwt_fn", "uid_fn")):
    bad("the people, sign-in or role tables (or the sign-in readers) aren't there as expected. Nothing was changed. Tell Claude."); done(3)
say("  ✓ the people, sign-in and Hub role tables are there")
fresh = s0["tables_there"] == 0
if s0["tables_there"] not in (0, 7): bad(f"only {s0['tables_there']} of the 7 desk tables are there (a half-finished earlier try?). Nothing was changed. Tell Claude."); done(3)
if not fresh:
    ok, cnt = sql("select (select count(*) from public.desk_lines) + (select count(*) from public.desk_stickies) + (select count(*) from public.kind_words) as n")
    say("  · My Desk's storage is already there" + (f" ({cnt[0]['n']} things kept on desks)" if ok and cnt else "") + "; it is re-applied as reviewed (nothing kept is changed)")

say(); say("PART 2 · CHANGE")
ok, r = sql("begin;\n" + open(os.path.join(ROOT, "my_desk_463.sql")).read() + "\ncommit;")
if not ok: bad("the change didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Tell Claude."); done(6)
say("  ✓ My Desk's storage and its rules are in (7 new tables, nothing existing changed)")

say(); say("PART 3 · PROOF (acting as the real Krystal and the real Samantha; all of it undone)")
res, err = probe(open(os.path.join(ROOT, "my_desk_463_proof.sql")).read())
if res is None: bad("the proof didn't answer: " + str(err))
else:
    if not (res.get("found_krystal") and res.get("found_samantha")):
        bad("couldn't find Krystal's and Samantha's sign-ins in the people list, so the rules weren't tried as them. Tell Claude.")
    else:
        chk(res.get("samantha_owner") and not res.get("krystal_owner"), "Samantha is an Owner in the Hub's role list and Krystal is not")
        chk(res.get("rls_on") and not res.get("anon_anything") and not res.get("anon_functions"), "the public key can't read, write or call anything on a desk")
        chk(not res.get("signed_in_bulk") and not res.get("tidy_signed_in"), "nobody signed in can bulk-delete, and only the server can tidy old pages")
        chk(res.get("k_is_me") and res.get("k_hub_ok") and res.get("k_add_own") == "went in" and res.get("k_sticky_own") == "went in", "Krystal can write on her own page and stick a note on her own desk")
        chk(res.get("k_add_samantha") == "refused" and res.get("k_reads_samantha") == 0, "Krystal can't read or write on Samantha's desk")
        chk(res.get("s_is_owner") and res.get("s_reads_krystal") == 1, "Samantha (an owner) can read Krystal's desk")
        chk(res.get("s_rewrites_krystal") == 0 and res.get("s_writes_on_krystal") == "refused", "...but can't change Krystal's lines or write on her page")
        chk(res.get("s_leaves_note") == "went in" and res.get("k_sees_note") == 1 and res.get("s_signs_own_desk") == "refused", "Samantha can leave Krystal a signed note, and Krystal sees it")
        chk(res.get("k_rewrites_note") == "refused" and res.get("k_moves_answers_note") == "went in", "Krystal can move the note, mark it seen and say got it, but not change its words")
        chk(res.get("s_edits_own_note") == "went in" and res.get("note_words_kept") and res.get("s_marks_seen") == "refused", "Samantha can edit her own note, but can't mark it seen for Krystal")
        chk(res.get("s_visit") == "went in" and res.get("k_sees_visit") == 1, "Samantha's stop-by is recorded and Krystal can see it")
        chk(res.get("s_star_unfinished") == "refused" and res.get("s_star_finished") == "went in" and res.get("star_landed"), "Samantha can star a finished line on Krystal's desk (not an unfinished one)")
        chk(res.get("k_gives_star") == "refused" and res.get("k_self_star") == "refused" and res.get("k_switch_desk") == "refused", "Krystal can't give stars, star herself, or switch desks on or off")
        chk(res.get("k_clips_kind_word") == "went in" and res.get("k_fakes_suggestion") == "refused", "Krystal can clip a kind word for the jar, but can't fake a Hub suggestion")
        chk(res.get("k_decides_suggestion") == "went in" and res.get("decided") == "kind", "a coordinator can say a suggested kind word is kind")
        chk(res.get("staffing_only_reads") == 0, "from a sign-in with only the old Staffing hub, Krystal's own desk stays closed")
    team = res.get("team") or []
    if team:
        say(); say("  THE TEAM AS THE DATABASE SEES IT (for desks; first names only)")
        for t in team:
            say(f"  · {t.get('name')}: Hub role " + (", ".join(t.get("roles") or []) or "none") + " · " + ("can sign in" if t.get("login") else "no sign-in linked")
                + " · " + ("CC Hub access" if t.get("cc_hub") else "no CC Hub access"))
        say("  (Desks will follow the Hub role or the Team job title, so anyone listed without a role still gets a desk if their title is Care Coordinator.)")
if fails:
    if fresh:
        ok, r = sql(open(os.path.join(ROOT, "my_desk_463_rollback.sql")).read())
        (say if ok else bad)(("  ✓ " if ok else "") + "because the proof wasn't exactly right, the new storage was taken back out (nothing else changed)" + ("" if ok else ": " + str(r)[:160]))
    else: say("  · the storage was already there before this run, so it was left as it is for Claude to look at")
say()
say("RESULT: " + ("DONE · My Desk's private storage is in and every rule was proven as Krystal and as Samantha." if not fails else "NOT DONE · the ✗ lines above need Claude."))
say("Nothing was texted or emailed, nothing that already existed was changed, and the proof left nothing behind.")
say("Rollback: my_desk_463_rollback.sql (only while desks are still empty; Claude can run it).")
done(0 if not fails else 8)
