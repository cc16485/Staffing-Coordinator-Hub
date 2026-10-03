#!/usr/bin/env python3
# 421 · SAFE SAVES PART 2 (one person at a time, numbers given by the database). Samantha 2026-10-02: Aimee Driggers
# was lost because her Import got a candidate number another candidate already had, and the Hub saved the whole list.
# Part 1 (READ ONLY): how many people each list holds, the highest number, any number two people share today (number
#   and how many share it, never names), whether the new pieces exist yet, app_data's triggers.
# Part 2 (CHANGE): safe_saves_2.sql in one transaction: app_data.version, a per-person _rev the database keeps,
#   app_data_items_apply (the Hub's new save for candidates and caregivers), app_data_save (for other keys, used later),
#   a number counter that never gives a number twice, and a refusal log.
# Part 3 (PROOF, NOTHING STAYS): inside one transaction that is always rolled back, act as a signed-in browser: add a
#   made-up person (fresh number), change a person from what was read (saved) then again from an old copy (refused),
#   two pages change two people (both saved), remove three at once (refused), anon (refused), and read the history and
#   refusal lines. Afterwards nothing it did exists. Then a read-only look at cc.mo-care.com for the new Hub code.
# Sends nothing. Only record numbers, counts and yes/no answers are printed: never a name, phone, email or SSN.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, shutil
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
HUB = "zngsgedlsxinbygwmxwn"
ROOT = os.environ["SB_HUB_ROOT"]
SQL_SHA, PROOF_SHA = os.environ.get("SB_SQL_SHA", ""), os.environ.get("SB_PROOF_SHA", "")
CC_ENGINE = os.environ.get("SB_CC_ENGINE_URL", "https://cc.mo-care.com/caregivers-engine.js")
SQLFILE, PROOFFILE = "safe_saves_2.sql", "safe_saves_2_proof.sql"
PROOF_ACTOR = "proof-421@invalid.test"
lines = []; fails = []; notes = []
def say(s=""):
    s = re.sub(r"(sbp_|eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._\-]+", "(hidden)", str(s))
    s = re.sub(r"[\w.%+\-]+@(?!invalid\.test)[\w.\-]+\.[A-Za-z]{2,}", "(an email)", s)
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
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-safesaves421/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{HUB}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, f"HTTP {s}: {b[:400]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:200]
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
def chk(good, msg): (say if good else bad)(("  ✓ " if good else "") + msg)
lit = lambda s: "'" + str(s).replace("'", "''") + "'"
ppl = lambda n: f"{n} {'person' if n == 1 else 'people'}"

say("421 · SAFE SAVES PART 2: ONE PERSON AT A TIME, NUMBERS GIVEN BY THE DATABASE"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
for f, want in ((SQLFILE, SQL_SHA), (PROOFFILE, PROOF_SHA)):
    p = os.path.join(ROOT, f)
    if not want or not os.path.exists(p) or sha(p) != want: bad(f"{f} is not the reviewed version"); say("  STOP. Nothing was run."); done(2)
SQLTEXT, PROOFTEXT = open(os.path.join(ROOT, SQLFILE)).read(), open(os.path.join(ROOT, PROOFFILE)).read()
say(f"  ✓ {SQLFILE} and {PROOFFILE} are the reviewed versions")
NODE = shutil.which("node") or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.path.exists(p)), "")
if NODE:
    p = subprocess.run([NODE, "safe_saves_421_test.mjs"], cwd=ROOT, capture_output=True, text=True)
    last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
    if p.returncode != 0 or "FAIL" in last: bad(f"safe_saves_421_test.mjs failed: {last}"); say("  STOP. Nothing was run."); done(2)
    say(f"  ✓ safe_saves_421_test.mjs: {last} (run here; the SQL scans)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")

ok, col = sql("select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'app_data' and column_name = 'version') as v, "
              "exists (select 1 from pg_proc where proname = 'app_data_items_apply' and pronamespace = 'public'::regnamespace) as f")
HAS_VERSION = bool(ok and col and col[0]["v"]); ALREADY = bool(ok and col and col[0]["f"])
if not ok: bad("couldn't check what is installed: " + str(col)[:200])
say(f"  · app_data.version: {'already there' if HAS_VERSION else 'not there yet'}; app_data_items_apply: {'already there (running the SQL again is safe)' if ALREADY else 'not there yet'}")
ok, lst = sql("select key, " + ("version, " if HAS_VERSION else "") + "jsonb_array_length(case when jsonb_typeof(data) = 'array' then data else '[]'::jsonb end) as n, updated_at::text as u, "
              "(select coalesce(max((x->>'id')::bigint), 0) from jsonb_array_elements(case when jsonb_typeof(data) = 'array' then data else '[]'::jsonb end) x "
              "  where jsonb_typeof(x) = 'object' and (x->>'id') ~ '^[0-9]{1,15}$') as maxid, "
              "(select count(*) from jsonb_array_elements(case when jsonb_typeof(data) = 'array' then data else '[]'::jsonb end) x "
              "  where jsonb_typeof(x) <> 'object' or not ((x->>'id') ~ '^[0-9]{1,15}$'))::int as odd, "
              "(select count(*) from jsonb_array_elements(case when jsonb_typeof(data) = 'array' then data else '[]'::jsonb end) x where x ? '_rev')::int as revd "
              "from public.app_data where key in ('candidates', 'caregivers') order by key")
if not ok: bad("couldn't read the two lists: " + str(lst)[:200]); lst = []
for r in lst:
    say(f"  · {r['key']}: {ppl(r['n'])}, highest number {r['maxid']}, last saved {str(r['u'])[:16]} UTC"
        + (f", version {r['version']}" if HAS_VERSION else "") + (f"; {r['odd']} record(s) without a plain number" if r["odd"] else "")
        + (f"; {r['revd']} already carry _rev" if r["revd"] else ""))
ok, dup = sql("select a.key, x->>'id' as id, count(*)::int as n from public.app_data a, "
              "jsonb_array_elements(case when jsonb_typeof(a.data) = 'array' then a.data else '[]'::jsonb end) x "
              "where a.key in ('candidates', 'caregivers') and jsonb_typeof(x) = 'object' and coalesce(x->>'id', '') <> '' "
              "group by a.key, x->>'id' having count(*) > 1 order by 1, 2")
if not ok: bad("couldn't look for shared numbers: " + str(dup)[:200]); dup = []
if dup:
    for r in dup: say(f"  ⚠ {r['key']}: number {r['id']} is shared by {r['n']} records")
    notes.append(f"{len(dup)} number(s) shared by more than one record: the Hub will not save changes to those people until it is fixed (tell Claude)")
else: say("  ✓ no number is shared by two people in either list today")
ok, trg = sql("select t.tgname, p.proname, (p.prosrc ~* '(net\\.|http_post|http_get|pg_net)') as calls_out "
              "from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgrelid = 'public.app_data'::regclass and not t.tgisinternal order by 1")
if not ok: bad("couldn't read app_data's triggers: " + str(trg)[:200]); trg = []
say("  · triggers on app_data: " + (", ".join(r["tgname"] + (" (CALLS OUT over the network)" if r["calls_out"] else "") for r in trg) or "none"))
if not any(r["tgname"] == "app_data_item_change_t" for r in trg): notes.append("the 418 change history is not installed, so these saves will not show in it (run 418)")
if len(fails): say("  STOP. Nothing was changed. Tell Claude."); done(3)

say(); say("PART 2 · CHANGE (one transaction)")
ok, r = sql(SQLTEXT)
if not ok: bad("the safe saves didn't install (one transaction, so nothing in it changed): " + str(r)[:300]); say("  STOP. Tell Claude."); done(4)
ok, v = sql("select (select count(*) from pg_trigger where tgrelid = 'public.app_data'::regclass and tgname = 'app_data_version_t')::int as t, "
            "(select prosecdef from pg_proc where proname = 'app_data_items_apply' and pronamespace = 'public'::regnamespace) as definer, "
            "(select prosecdef from pg_proc where proname = 'app_data_save' and pronamespace = 'public'::regnamespace) as save_definer, "
            "has_function_privilege('anon', 'public.app_data_items_apply(text, jsonb, jsonb)', 'execute') as anon_can, "
            "has_function_privilege('authenticated', 'public.app_data_items_apply(text, jsonb, jsonb)', 'execute') as staff_can, "
            "(select jsonb_object_agg(key, last_id) from public.app_data_id_counter) as counters")
v = v[0] if ok and v else {}
chk(v.get("t") == 1 and v.get("definer") is True and v.get("save_definer") is False and v.get("anon_can") is False and v.get("staff_can") is True,
    "installed: the version counter, per-person _rev, app_data_items_apply (signed-in staff only, anon refused) and app_data_save" + ("" if v else f": {str(v)[:200]}"))
ctr = v.get("counters") or {}
if isinstance(ctr, str):
    try: ctr = json.loads(ctr)
    except Exception: ctr = {}
chk(set(ctr) >= {"candidates", "caregivers"}, f"the number counters start at: candidates {ctr.get('candidates', '?')}, caregivers {ctr.get('caregivers', '?')} "
    "(above every number in the lists, the change history, reference requests, welcome calls and caregiver profiles; a new person gets the next one)")

say(); say("PART 3 · PROOF (inside one transaction that is rolled back; nothing stays)")
callers = [t["tgname"] for t in trg if t["calls_out"]]
if callers:
    bad("a trigger on app_data could call out over the network (" + ", ".join(callers) + "), so the live proof was NOT run. The tests proved it in a test database. Tell Claude.")
else:
    q = ("select (select md5(data::text) from public.app_data where key = 'candidates') as m, (select version from public.app_data where key = 'candidates')::bigint as v, "
         "(select updated_at::text from public.app_data where key = 'candidates') as u, (select count(*) from public.app_data_item_change)::int as h, "
         "(select count(*) from public.app_data_conflict_log)::int as l, (select last_id from public.app_data_id_counter where key = 'candidates')::bigint as c, "
         "(select coalesce(max(id), 0) from public.app_data_item_change)::bigint as hmax")
    ok, b4 = sql(q); b4 = b4[0] if ok and b4 else {}
    s_, body = http("POST", f"{API}/v1/projects/{HUB}/database/query", {"query": PROOFTEXT}, MG())
    msg = body
    try: msg = json.loads(body).get("message", body)
    except Exception: pass
    J = None
    if "PROBE_RESULT: " in str(msg):
        try: J, _ = json.JSONDecoder().raw_decode(str(msg).split("PROBE_RESULT: ", 1)[1])
        except Exception: J = None
    if J is None: bad(f"the proof didn't give a result ({s_}): {str(msg)[:300]}")
    elif J.get("skipped"): say(f"  · proof skipped: {J['skipped']} (the tests proved it in a test database)")
    else:
        chk(J.get("add_ok") is True and J.get("added_present") is True and (J.get("new_id") or 0) > max(int(J.get("max_before") or 0), int(J.get("counter_before") or 0)),
            f"a new person got a fresh number from the database ({J.get('new_id')}; highest before {J.get('max_before')}, counter {J.get('counter_before')})")
        chk(J.get("put1_ok") is True and J.get("rev_after") == (J.get("rev_before") or 0) + 1,
            f"a change to number {J.get('a')} based on what the page read: saved (its _rev went {J.get('rev_before')} to {J.get('rev_after')})")
        chk(J.get("stale_ok") is False and J.get("stale_reason") == "conflict" and J.get("stale_nothing_saved") is True and J.get("stale_current_rev") == J.get("rev_after"),
            "the same change from a page that opened earlier (old _rev): REFUSED, nothing saved, the current record handed back")
        chk(J.get("b_ok") is True and J.get("c_ok") is True, f"two pages changing two different people ({J.get('b')} and {J.get('c')}): both saved")
        chk(J.get("bulk_ok") is False and J.get("bulk_reason") == "bulk_remove" and J.get("bulk_nothing_saved") is True, "removing 3 people in one save: REFUSED, nothing saved")
        chk(J.get("anon_refused") is True, "anon (the public key): refused")
        chk(J.get("version_after") == (J.get("version_before") or 0) + 4, "the list's version moved once per saved change (4), not for the refused ones")
        hk = [f"{x.get('change')}:{x.get('record_id')}" for x in (J.get("history") or [])]
        chk(hk == [f"added:{J.get('new_id')}", f"changed:{J.get('a')}", f"changed:{J.get('b')}", f"changed:{J.get('c')}"] and all(x.get("actor") == PROOF_ACTOR for x in J.get("history") or []),
            "the 418 change history recorded the added person and the 3 changes, with who saved")
        chk([x.get("reason") for x in J.get("refusals") or []] == ["conflict", "bulk_remove_refused"], "the refusal log recorded the stale change and the bulk removal")
    ok, af = sql(q + f", (select count(*) from public.app_data_item_change where actor = {lit(PROOF_ACTOR)})::int as proof_left, "
                 f"(select count(*) from public.app_data_conflict_log where actor = {lit(PROOF_ACTOR)})::int as proof_log_left")
    af = af[0] if ok and af else {}
    chk(af.get("proof_left") == 0 and af.get("proof_log_left") == 0, "afterwards: no proof line in the history or the refusal log (all rolled back)")
    if all(af.get(k) == b4.get(k) for k in ("m", "v", "u", "h", "l", "c")):
        say("  ✓ afterwards: candidates, its version, the number counter, the history and the refusal log are exactly as before")
    else:
        ok, real = sql(f"select count(*)::int as n from public.app_data_item_change where id > {int(b4.get('hmax') or 0)} and actor <> {lit(PROOF_ACTOR)}")
        n_real = real[0]["n"] if ok and real else "?"
        say(f"  · candidates changed while this ran: {n_real} new history line(s) from a REAL save by the office (expected while people work); none are from the proof")

say(); say("  THE HUB (cc.mo-care.com, read only look)")
s_, page = http("GET", CC_ENGINE + ("&" if "?" in CC_ENGINE else "?") + "v421=" + dt.datetime.now().strftime("%H%M%S"), None, {"Cache-Control": "no-cache"}, timeout=60)
if s_ == 200 and "app_data_items_apply" in (page or ""):
    say("  ✓ cc.mo-care.com now saves candidates and caregivers one person at a time")
elif s_ == 200:
    say("  · cc.mo-care.com still saves whole lists: NEXT, merge the Hub branch safe-saves-2 (cc-hub-live). GitHub Pages takes a minute or two, then everyone refreshes.")
else:
    say(f"  · couldn't load the Hub code ({s_}); after merging safe-saves-2, refresh cc.mo-care.com")

say()
for n in notes: say("  NOTE: " + n)
if fails: say("RESULT: PARTLY DONE · the ✗ lines above need Claude.")
else: say("RESULT: DONE · the database now gives new people their numbers (never twice) and refuses a save made from an out-of-date copy of a person.")
say("Nothing was texted or emailed. Old whole-list saves still work until the Hub branch is merged (and an old page can't wind a person's _rev back).")
say("Rollback (only if ever needed): drop trigger app_data_version_t on public.app_data; the Hub branch must then be reverted too (it needs app_data_items_apply).")
done(1 if fails else 0)
