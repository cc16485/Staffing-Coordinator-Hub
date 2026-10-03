#!/usr/bin/env python3
# 418 · CHANGE HISTORY + OLD HUB LOCK (safe saves, part 1). Samantha 2026-10-02: Aimee Driggers was imported, then
# vanished from the saved candidate list, and nothing could say when or who. This:
# Part 1 (READ ONLY): the Aimee lookback. Which weekly backups (storage bucket "backups", YYYY-MM-DD/app_data.json)
#   had her in candidates (matched by her start form id, email or phone; never by name alone, a name-only hit is shown
#   apart), how many candidates each backup held (a drop of many at once = a page saved an old list over it; only her
#   = she was removed), her reference requests and whether the candidate number they point at existed in each backup,
#   and when candidates was last saved. Plus the facts the next slices need: who owns upsert_app_data_item /
#   delete_app_data_item and whether they run as owner, app_data's read/write rules, grants and triggers.
#   Only names, dates, counts and record numbers are printed: never a phone, email or SSN (ssn is never read).
# Part 2 (CHANGE): app_data_history.sql in one transaction: a record-only history of every save of candidates and
#   caregivers (added / removed / changed per person, field names only). It never blocks a save.
# Part 3 (PROOF, NOTHING STAYS): inside one transaction that is always rolled back, act as a signed-in browser, save
#   the candidate list with one person changed, one added and three removed, read the history lines back (expect
#   changed / added / removed with bulk_removed), then force the watcher to fail and prove the save still goes
#   through. Afterwards: no proof line exists and candidates is exactly as before. Then a read-only look at
#   https://sc.mo-care.com/ to say whether the read-only page is live yet (it goes live when the branch is merged).
# Sends nothing. Writes nothing but the history table and its watcher.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, urllib.parse, datetime as dt, sys, shutil
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
HUB = "zngsgedlsxinbygwmxwn"
ROOT = os.environ["SB_HUB_ROOT"]
SQL_SHA, PROOF_SHA = os.environ.get("SB_SQL_SHA", ""), os.environ.get("SB_PROOF_SHA", "")
FNB = os.environ.get("SB_HUB_FN_BASE", f"https://{HUB}.supabase.co")
SC_URL = os.environ.get("SB_SC_URL", "https://sc.mo-care.com/")
SQLFILE, PROOFFILE = "app_data_history.sql", "app_data_history_proof.sql"
PROOF_ACTOR = "proof-418@invalid.test"
WHO_FIRST, WHO_LAST = "aimee", "driggers"
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for h in HIDE:
        if h: s = s.replace(h, "(hidden)")
    s = re.sub(r"(sbp_|eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._\-]+", "(hidden)", s)
    s = re.sub(r"[\w.%+\-]+@(?!invalid\.test)[\w.\-]+\.[A-Za-z]{2,}", "(an email)", s)
    print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Anything done above stays done; nothing after it ran. Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=150, raw=False):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-safesaves418/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: b = r.read(); return r.status, (b if raw else b.decode(errors="replace"))
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{HUB}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, f"HTTP {s}: {b[:400]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:200]
def keys():
    """The project's keys. Lesson from 412: ask with ?reveal=true first, then without. A value that isn't a usable key counts as missing."""
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_publishable_") or v.startswith("sb_secret_")) and "·" not in v and "*" not in v
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{HUB}/api-keys{q}", headers=MG())
        if s != 200: continue
        try: arr = json.loads(b)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        got = {}
        for k in arr:
            if not isinstance(k, dict) or not usable(k.get("api_key", "")): continue
            got[k.get("name") or ""] = k["api_key"]
            if k["api_key"].startswith("sb_secret_"): got.setdefault("secret", k["api_key"])
        if got.get("service_role") or got.get("secret"): return got
    return {}
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
def chk(good, msg): (say if good else bad)(("  ✓ " if good else "") + msg)
lit = lambda s: "'" + str(s).replace("'", "''") + "'"
digits = lambda v: re.sub(r"\D", "", str(v or ""))[-10:]
low = lambda v: str(v or "").strip().lower()
ppl = lambda n: f"{n} {'person' if n == 1 else 'people'}"

say("418 · CHANGE HISTORY FOR CANDIDATES AND CAREGIVERS + OLD STAFFING HUB LOCK"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
for f, want in ((SQLFILE, SQL_SHA), (PROOFFILE, PROOF_SHA)):
    p = os.path.join(ROOT, f)
    if not want or not os.path.exists(p) or sha(p) != want: bad(f"{f} is not the reviewed version"); say("  STOP. Nothing was run."); done(2)
SQLTEXT, PROOFTEXT = open(os.path.join(ROOT, SQLFILE)).read(), open(os.path.join(ROOT, PROOFFILE)).read()
say(f"  ✓ {SQLFILE} and {PROOFFILE} are the reviewed versions")
NODE = shutil.which("node") or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.path.exists(p)), "")
if NODE:
    p = subprocess.run([NODE, "safe_saves_418_test.mjs"], cwd=ROOT, capture_output=True, text=True)
    last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
    if p.returncode != 0 or "FAIL" in last: bad(f"safe_saves_418_test.mjs failed: {last}"); say("  STOP. Nothing was run."); done(2)
    say(f"  ✓ safe_saves_418_test.mjs: {last} (run here; the page checks and SQL scans)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")

# ── the facts ──
say(); say("  THE FACTS (for the next slices)")
ok, fx = sql("select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef, r.rolname as owner "
             "from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_roles r on r.oid = p.proowner "
             "where n.nspname = 'public' and p.proname in ('upsert_app_data_item', 'delete_app_data_item', 'can_access_data_key') order by 1")
if not ok: bad("couldn't read the save functions: " + str(fx)[:200]); fx = []
for r in fx: say(f"  · {r['proname']}({r['args']}): owner {r['owner']}, runs as {'OWNER (security definer)' if r['prosecdef'] else 'THE CALLER (security invoker)'}")
ok, pol = sql("select policyname, permissive, cmd, roles::text as roles, coalesce(qual, '') as using_, coalesce(with_check, '') as check_ "
              "from pg_policies where schemaname = 'public' and tablename = 'app_data' order by policyname")
if not ok: bad("couldn't read app_data's rules: " + str(pol)[:200]); pol = []
ok, rls = sql("select relrowsecurity as on_, relforcerowsecurity as forced from pg_class where oid = 'public.app_data'::regclass")
if ok and rls: say(f"  · app_data row security: {'ON' if rls[0]['on_'] else 'OFF'}{' (forced for the owner too)' if rls[0]['forced'] else ''}; {len(pol)} rule(s):")
for r in pol: say(f"      {r['policyname']}: {r['permissive'].lower()} {r['cmd']} for {r['roles']} using ({r['using_'][:140]}){(' check (' + r['check_'][:140] + ')') if r['check_'] else ''}")
ok, gr = sql("select grantee, string_agg(privilege_type, ', ' order by privilege_type) as privs from information_schema.role_table_grants "
             "where table_schema = 'public' and table_name = 'app_data' group by grantee order by grantee")
if not ok: bad("couldn't read app_data's grants: " + str(gr)[:200]); gr = []
for r in gr: say(f"  · grant on app_data to {r['grantee']}: {r['privs']}")
ok, trg = sql("select t.tgname, p.proname, pg_get_triggerdef(t.oid) as def, (p.prosrc ~* '(net\\.|http_post|http_get|pg_net)') as calls_out "
              "from pg_trigger t join pg_proc p on p.oid = t.tgfoid where t.tgrelid = 'public.app_data'::regclass and not t.tgisinternal order by 1")
if not ok: bad("couldn't read app_data's triggers: " + str(trg)[:200]); trg = []
for r in trg: say(f"  · trigger on app_data: {r['tgname']} -> {r['proname']}(){'  (CALLS OUT over the network)' if r['calls_out'] else ''}")
if not trg: say("  · no triggers on app_data yet")
ALREADY = any(r["tgname"] == "app_data_item_change_t" for r in trg)
if ALREADY: say("  · the change history is already installed (running the SQL again is safe; it replaces it with the reviewed version)")

# ── the Aimee lookback ──
say(); say("  AIMEE DRIGGERS LOOKBACK (names, dates, counts and record numbers only)")
ok, hi = sql(f"select id::text as id, created_at, candidate_id, seen_at, first_name, last_name, phone, email from public.hire_intake "
             f"where lower(btrim(first_name)) like {lit(WHO_FIRST + '%')} and lower(btrim(last_name)) like {lit(WHO_LAST + '%')} order by created_at")
if not ok: bad("couldn't read her start form (hire_intake): " + str(hi)[:200]); hi = []
INTAKE = {r["id"] for r in hi}
EMAILS = {low(r["email"]) for r in hi if low(r["email"])}
PHONES = {digits(r["phone"]) for r in hi if len(digits(r["phone"])) == 10}
for r in hi: HIDE += [r.get("phone") or "", r.get("email") or ""]
HIDE += list(EMAILS) + list(PHONES)
say(f"  · start forms (hire_intake) for her: {len(hi)}")
for r in hi:
    say(f"      form {r['id'][:8]}… sent {str(r['created_at'])[:16]} UTC; linked candidate number {r['candidate_id'] if r['candidate_id'] is not None else '(none)'}; "
        f"first seen in the Hub {str(r['seen_at'])[:16] if r['seen_at'] else '(never)'}")
if not hi: say("      (none found by her name: the lookback below can only match by name)")
def who(rec):
    """How this record matches her: 'form' / 'email' / 'phone' (strong) or 'name' (weak, shown apart) or ''."""
    if not isinstance(rec, dict): return ""
    if str(rec.get("intake_id") or "") in INTAKE and rec.get("intake_id"): return "form"
    if low(rec.get("email")) and low(rec.get("email")) in EMAILS: return "email"
    if len(digits(rec.get("phone"))) == 10 and digits(rec.get("phone")) in PHONES: return "phone"
    nm = (low(rec.get("first") or rec.get("first_name")), low(rec.get("last") or rec.get("last_name")))
    if nm[0].startswith(WHO_FIRST) and nm[1].startswith(WHO_LAST): return "name"
    return ""
def summarize(rows):
    """rows: list of app_data rows ({key, data, updated_at}). Returns the bits we report."""
    by = {r.get("key"): r for r in rows if isinstance(r, dict)}
    out = {}
    for k in ("candidates", "caregivers"):
        r = by.get(k) or {}; d = r.get("data") if isinstance(r.get("data"), list) else []
        hits = [(str(x.get("id")), who(x)) for x in d if who(x)]
        out[k] = {"n": len(d), "updated": str(r.get("updated_at") or "")[:16], "ids": {str(x.get("id")) for x in d if isinstance(x, dict) and x.get("id") is not None},
                  "strong": [i for i, w in hits if w != "name"], "weak": [i for i, w in hits if w == "name"], "how": sorted({w for _, w in hits if w != "name"})}
    return out
ok, live = sql("select key, data, updated_at from public.app_data where key in ('candidates', 'caregivers')")
if not ok: bad("couldn't read the live lists: " + str(live)[:200]); live = []
L = summarize(live)
say(f"  · NOW: candidates last saved {L['candidates']['updated']} UTC, {ppl(L['candidates']['n'])}; caregivers last saved {L['caregivers']['updated']} UTC, {ppl(L['caregivers']['n'])}")
say(f"    she is in candidates now as number(s) {', '.join(L['candidates']['strong']) or '(not found)'}{' (matched by ' + ', '.join(L['candidates']['how']) + ')' if L['candidates']['how'] else ''}"
    f"{'; by name only: ' + ', '.join(L['candidates']['weak']) if L['candidates']['weak'] else ''}; in caregivers: {', '.join(L['caregivers']['strong']) or 'no'}")
ok, objs = sql("select name, created_at from storage.objects where bucket_id = 'backups' and name ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}/app_data[.]json$' order by name")
if not ok: bad("couldn't list the weekly backups: " + str(objs)[:200]); objs = []
K = keys(); SVC = K.get("service_role") or K.get("secret") or ""
HIDE += [v for v in K.values()]
if objs and not SVC: bad("couldn't read the project's server key, so the backups can't be opened (nothing was changed by this)")
SNAPS = []
for o in objs if SVC else []:
    for hdr in ({"Authorization": "Bearer " + SVC, "apikey": SVC}, {"apikey": SVC}):   # a new-style secret key may only be accepted as apikey
        s_, b_ = http("GET", f"{FNB}/storage/v1/object/backups/{urllib.parse.quote(o['name'])}", None, hdr, timeout=300, raw=True)
        if s_ == 200: break
    if s_ != 200: bad(f"couldn't open backup {o['name']} ({s_})"); continue
    try: rows = json.loads(b_)
    except Exception: bad(f"backup {o['name']} isn't readable JSON"); continue
    if isinstance(rows, dict): rows = rows.get("rows") or [{"key": k, "data": v} for k, v in rows.items()]
    SNAPS.append((o["name"][:10], summarize(rows if isinstance(rows, list) else [])))
say(f"  · weekly backups: {len(objs)} found, {len(SNAPS)} opened (each line: date, candidates count and when that list was last saved, her, caregivers)")
prev = None
for day, S in SNAPS:
    c, g = S["candidates"], S["caregivers"]
    gone = sorted(prev["candidates"]["ids"] - c["ids"], key=lambda x: (len(x), x)) if prev else []
    drop = f"; {len(gone)} candidate(s) gone since the backup before" + (" (MANY AT ONCE: looks like an old list saved over it)" if len(gone) > 2 else "") if prev else ""
    her = (f"HER: yes, number {', '.join(c['strong'])} ({', '.join(c['how'])})" if c["strong"] else "HER: no") + (f" (name only: {', '.join(c['weak'])})" if c["weak"] else "")
    said_gone = [i for i in gone if prev and i in prev["candidates"]["strong"]]
    say(f"      {day}: {c['n']} candidates (last saved {c['updated'] or '?'}); {her}{drop}{' (she was one of them)' if said_gone else ''}; "
        f"caregivers {g['n']}{' (her: ' + ', '.join(g['strong']) + ')' if g['strong'] else ''}")
    prev = S
TODAY = dt.date.today().isoformat()
had = [d for d, S in SNAPS if S["candidates"]["strong"] and d < "2026-10-02"]
lost = [d for d, S in SNAPS if d < "2026-10-02" and had and d > had[-1] and not S["candidates"]["strong"]]
if had: say(f"  · last backup before her re-import (2026-10-02) that still had her: {had[-1]}" + (f"; first backup without her: {lost[0]}, so she was lost between {had[-1]} and {lost[0]}" if lost else "; no later backup is missing her (she was lost after the last backup, or a backup dated 2026-10-02 shows it)"))
elif SNAPS: say("  · no backup before 2026-10-02 had her by form, email or phone (if a name-only hit shows above, that record had none of those)")
HER_IDS = sorted({str(r["candidate_id"]) for r in hi if r["candidate_id"] is not None} | set(L["candidates"]["strong"]) | {i for _, S in SNAPS for i in S["candidates"]["strong"]}, key=lambda x: (len(x), x))
num_ids = [i for i in HER_IDS if i.isdigit()]
ok, rr = sql("select candidate_id, slot, created_at, sent_at, responded_at from public.reference_requests where candidate_name ilike "
             + lit(f"%{WHO_FIRST}%{WHO_LAST}%") + (f" or candidate_id in ({', '.join(num_ids)})" if num_ids else "") + " order by created_at")
if not ok: bad("couldn't read her reference requests: " + str(rr)[:200]); rr = []
say(f"  · her reference requests: {len(rr)}")
for r in rr:
    cid = str(r["candidate_id"])
    inside = [d for d, S in SNAPS if cid in S["candidates"]["ids"]]
    say(f"      slot {r['slot']} for candidate number {cid}: made {str(r['created_at'])[:16]}, sent {str(r['sent_at'])[:16] if r['sent_at'] else '(not sent)'}, "
        f"answered {str(r['responded_at'])[:16] if r['responded_at'] else '(no answer)'}; number {cid} is in candidates NOW: {'yes' if cid in L['candidates']['ids'] else 'NO'}; "
        f"in backups: {', '.join(inside) if inside else 'none'}")

say(); say("PART 2 · CHANGE (one transaction)")
f_before = len(fails)   # a lookback read that failed above does not stop the history (it only protects); it still shows as PARTLY DONE
ok, r = sql(SQLTEXT)
if not ok: bad("the change history didn't install (one transaction, so nothing in it changed): " + str(r)[:300]); say("  STOP. Tell Claude."); done(4)
ok, v = sql("select (select count(*) from pg_trigger where tgrelid = 'public.app_data'::regclass and tgname in ('app_data_item_change_t', 'app_data_item_change_del_t'))::int as t, "
            "(select relrowsecurity from pg_class where oid = 'public.app_data_item_change'::regclass) as rls, "
            "(select prosecdef from pg_proc where proname = 'app_data_item_change_capture' and pronamespace = 'public'::regnamespace) as definer, "
            "(select count(*) from public.app_data_item_change)::int as n")
chk(ok and v and v[0]["t"] == 2 and v[0]["rls"] and v[0]["definer"], "the change history is installed: watching candidates and caregivers, row security on, reads only for signed-in staff"
    + (f" ({v[0]['n']} line(s) so far)" if ok and v else f": {str(v)[:200]}"))
if len(fails) > f_before: say("  STOP. Tell Claude."); done(4)

say(); say("PART 3 · PROOF (inside one transaction that is rolled back; nothing stays)")
callers = [t["tgname"] for t in trg if t["calls_out"] and not t["tgname"].startswith("app_data_item_change")]
if callers:
    bad("another trigger on app_data could call out over the network (" + ", ".join(callers) + "), so the live proof was NOT run. The tests above proved it in a test database. Tell Claude.")
else:
    q = ("select (select coalesce(max(id), 0) from public.app_data_item_change)::bigint as maxid, (select count(*) from public.app_data_item_change)::int as n, "
         "(select updated_at::text from public.app_data where key = 'candidates') as u, (select md5(data::text) from public.app_data where key = 'candidates') as m")
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
    elif J.get("skipped"): say(f"  · proof skipped: {J['skipped']} (the tests above proved it in a test database)")
    else:
        rows = J.get("rows") or []; kinds = sorted(x["change"] for x in rows)
        chk(J.get("saved") == 1, "a signed-in browser's save of the candidate list went through")
        chk(kinds == ["added", "changed", "removed", "removed", "removed"], f"it left exactly: 1 changed, 1 added, 3 removed ({', '.join(kinds) or 'nothing'})")
        ch = next((x for x in rows if x["change"] == "changed"), {}); ad = next((x for x in rows if x["change"] == "added"), {})
        rm = [x for x in rows if x["change"] == "removed"]
        chk(ch.get("fields_changed") == ["_proof_418"] and ch.get("names") == "false", f"changed: the person's record number ({ch.get('record_id')}) and the field name only, no values, no name")
        chk(ad.get("names") == "Proof Added", "added: first + last name only")
        chk(len(rm) == 3 and all(x["bulk_removed"] and x["names"] == "true" for x in rm), f"removed: 3 lines marked bulk_removed (record numbers {', '.join(J.get('removed_ids') or [])}), names kept")
        chk(rows and all(x["actor"] == PROOF_ACTOR and x["role"] == "authenticated" and x["origin"] == "https://proof-418.invalid" for x in rows),
            "each line says who (the signed-in email), the role (authenticated) and the page (site only, never the path or query)")
        chk(J.get("leak") is False, "no phone, email, SSN or address path was copied into the history")
        chk(J.get("error_saved") == 1 and J.get("error_save_kept") is True and len(J.get("error_rows") or []) == 1,
            "with the watcher forced to fail, the save STILL went through, and one 'trigger_error' line was written instead")
    ok, af = sql(q + f", (select count(*) from public.app_data_item_change where actor = {lit(PROOF_ACTOR)})::int as proof_left, "
                 "(select count(*) from pg_constraint where conname = 'proof_418_force_error')::int as rule_left")
    af = af[0] if ok and af else {}
    chk(af.get("proof_left") == 0 and af.get("rule_left") == 0, "afterwards: no proof line and no temporary rule exist (all rolled back)")
    if af.get("u") == b4.get("u") and af.get("m") == b4.get("m") and af.get("n") == b4.get("n"):
        say("  ✓ afterwards: candidates is exactly as before (same contents, same last-saved time) and the history has the same number of lines")
    else:
        ok, real = sql(f"select count(*)::int as n from public.app_data_item_change where id > {int(b4.get('maxid') or 0)} and actor <> {lit(PROOF_ACTOR)}")
        n_real = real[0]["n"] if ok and real else "?"
        say(f"  · candidates or the history changed while this ran: {n_real} new line(s) from a REAL save by the office (expected while people work); none are from the proof")

say(); say("  THE OLD STAFFING HUB (sc.mo-care.com, read only look)")
s_, page = http("GET", SC_URL + ("&" if "?" in SC_URL else "?") + "v418=" + dt.datetime.now().strftime("%H%M%S"), None, {"Cache-Control": "no-cache"}, timeout=60)
if s_ == 200 and 'data-sc-readonly="418"' in (page or ""):
    say("  ✓ sc.mo-care.com now serves the read-only page: candidates and caregivers can't be saved from it any more")
elif s_ == 200:
    say("  · sc.mo-care.com still serves the OLD page (the read-only change is not live yet: merge the Staffing branch safe-saves-1; GitHub Pages takes a minute or two)")
else:
    say(f"  · couldn't load sc.mo-care.com ({s_}); check it in a browser: the Background & References tab should show the yellow \"Read only\" box")

say()
if fails: say("RESULT: PARTLY DONE · the ✗ lines above need Claude.")
else: say("RESULT: DONE · every save of candidates and caregivers is now recorded (who, when, from which page, added / removed / changed). It never blocks a save.")
say("Nothing was texted or emailed. The only change is the history table and its watcher.")
say("Rollback (only if ever needed): drop trigger app_data_item_change_t and app_data_item_change_del_t on public.app_data. The saves are unaffected either way.")
done(1 if fails else 0)
