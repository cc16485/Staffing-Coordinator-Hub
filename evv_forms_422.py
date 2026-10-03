#!/usr/bin/env python3
# 422 · EVV CORRECTION FORMS: THE SIGNED FORM IN THE HUB, ON BOTH PROFILES, AND THE AXISCARE CHECK.
# Samantha 2026-10-03: "the EVV form does not save the completed form, it has a text only completion. We need the real
# form that was completed and signed by caregiver and client to be saved and able to be viewed by office staff...also
# would be nice if it is saved in the client and caregivers profiles as well".
# The Hub project (zngsgedlsxinbygwmxwn) only:
# Part 1 (READ ONLY): the reviewed builds (SQL, proof and the new function pinned), the tests pass here; how many forms
#   there are (total, waiting, processed, with both signatures), the table's permissions and rules as they stand,
#   whether anything ever deletes forms or their signatures (scheduled jobs, database code), whether anyone can sign up
#   to the project (a signed-in account can read forms), and whether the AxisCare secrets the check needs are set.
# Part 2 (CHANGE): evv_forms_422.sql in one transaction (new columns for who the form is for, accepted / dismissed, the
#   AxisCare check; the public form keeps INSERT only and can no longer claim a form is accepted or linked; staff keep
#   read + update, lose TRUNCATE). Then deploys the new evv-axiscare-check function (read only against AxisCare), its
#   sign-in setting copied from care-notes (the other office function that reads AxisCare visits for the Hub).
# Part 3 (PROOF, NOTHING STAYS): inside one transaction that is always rolled back: the public form sends a made-up form
#   claiming to be accepted (the claims are wiped) and cannot read; a signed-in office member reads it by number and
#   links it. Then over the real web: the public key cannot read forms; the new function refuses without a staff
#   sign-in; the live function is the reviewed build; cc.mo-care.com/evv-form.html is live or not yet.
# Sends nothing. Never writes to AxisCare. Changes no retention.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
REF = "zngsgedlsxinbygwmxwn"
ROOT = os.environ["SB_REPO"]
SHAS = json.loads(os.environ.get("SB_SHAS", "{}")); SQL_SHA, PROOF_SHA = os.environ.get("SB_SQL_SHA", ""), os.environ.get("SB_PROOF_SHA", "")
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
HUB_URL = os.environ.get("SB_HUB_URL", "https://cc.mo-care.com/")
SKIP_TESTS = os.environ.get("SB_SKIP_TESTS") == "1"
FN, PATTERN_FN = "evv-axiscare-check", "care-notes"
SQLFILE, PROOFFILE = "evv_forms_422.sql", "evv_forms_422_proof.sql"
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
def http(method, url, body=None, headers=None, timeout=150):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-evv422/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def jl(b):
    try: return json.loads(b)
    except Exception: return None
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, f"HTTP {s}: {b[:400]}"
    j = jl(b)
    return (True, j) if j is not None else (False, b[:200])
def fmeta(fn):
    s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{fn}", headers=MG())
    return s, (jl(b) if s == 200 else None)
def keys():
    """The project's keys. Lesson from 412: ask with ?reveal=true first, then without it. A value that isn't a usable key counts as missing."""
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_publishable_") or v.startswith("sb_secret_")) and "·" not in v and "*" not in v
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys{q}", headers=MG())
        if s != 200: continue
        arr = jl(b)
        if isinstance(arr, dict): arr = arr.get("keys") or []
        if not isinstance(arr, list): continue
        got = {}
        for k in arr:
            if not isinstance(k, dict) or not usable(k.get("api_key", "")): continue
            got[k.get("name") or ""] = k["api_key"]
            if k["api_key"].startswith("sb_publishable_"): got.setdefault("publishable", k["api_key"])
        if got.get("anon") or got.get("publishable"): return got
    return {}
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
def chk(good, msg): (say if good else bad)(("  ✓ " if good else "") + msg)
pin_path = lambda k: os.path.join(ROOT, f"supabase/functions/{k}.ts" if k.startswith("_shared/") else f"supabase/functions/{k}/index.ts")
def live_files(fn):
    tmp = tempfile.mkdtemp(prefix="evv422-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
    d = subprocess.run([SUPA, "functions", "download", fn, "--project-ref", REF, "--use-api"], cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    live = {}
    for root, _, files in os.walk(tmp):
        for f in files:
            lp = os.path.join(root, f).replace(os.sep, "/")
            if "/functions/" in lp: live["supabase/functions/" + lp.split("/functions/", 1)[1]] = sha(lp)
    shutil.rmtree(tmp, ignore_errors=True)
    return d.returncode == 0, live
NEED = [f"supabase/functions/{FN}/index.ts", "supabase/functions/_shared/staff-auth.ts"]
def is_reviewed_live():
    okd, live = live_files(FN)
    if not okd: return None, "couldn't read the live copy"
    off = [k.split("functions/", 1)[1] for k in NEED if live.get(k) != sha(os.path.join(ROOT, k))]
    return (not off), ("" if not off else "live differs in " + ", ".join(off))

say("422 · EVV CORRECTION FORMS: THE SIGNED FORM IN THE HUB, ON BOTH PROFILES, AND THE AXISCARE CHECK"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
for f, want in ((SQLFILE, SQL_SHA), (PROOFFILE, PROOF_SHA)):
    p = os.path.join(ROOT, f)
    if not want or not os.path.exists(p) or sha(p) != want: bad(f"{f} is not the reviewed version"); say("  STOP. Nothing was run."); done(2)
if set(SHAS) != {FN, "_shared/staff-auth"} or any(not os.path.exists(pin_path(k)) or sha(pin_path(k)) != v for k, v in SHAS.items()):
    bad("the AxisCare check function (or the staff sign-in check it uses) is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
SQLTEXT, PROOFTEXT = open(os.path.join(ROOT, SQLFILE)).read(), open(os.path.join(ROOT, PROOFFILE)).read()
say(f"  ✓ {SQLFILE}, {PROOFFILE} and the {FN} function are the reviewed builds")
NODE = shutil.which("node") or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.path.exists(p)), "")
if SKIP_TESTS: say("  · (rehearsal) tests not re-run")
elif NODE:
    p = subprocess.run([NODE, "evv_forms_422_test.mjs"], cwd=ROOT, capture_output=True, text=True)
    last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
    if p.returncode != 0 or "FAIL" in last: bad(f"evv_forms_422_test.mjs failed: {last}"); say("  STOP. Nothing was run."); done(2)
    say(f"  ✓ evv_forms_422_test.mjs: {last} (run here, against a fake AxisCare; nothing sent)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")

ok, cols = sql("select string_agg(column_name, ',' order by column_name) as c from information_schema.columns where table_schema = 'public' and table_name = 'evv_submissions'")
COLS = set(((cols or [{}])[0].get("c") or "").split(",")) if ok else set()
if not ok or "sig_attendant" not in COLS: bad("couldn't read the EVV forms table (evv_submissions): " + str(cols)[:200]); say("  STOP. Nothing was changed."); done(3)
ok, n = sql("select count(*)::int as total, count(*) filter (where not processed)::int as waiting, count(*) filter (where processed)::int as processed, "
            "count(*) filter (where sig_attendant like 'data:image/%' and sig_consumer like 'data:image/%')::int as both_sigs, "
            "count(*) filter (where sig_attendant like 'data:image/%' and coalesce(sig_consumer, '') not like 'data:image/%')::int as caregiver_only, "
            "min(submitted_at)::text as first, max(submitted_at)::text as last from public.evv_submissions")
if ok and n:
    c = n[0]
    say(f"  · forms on file: {c['total']} ({c['waiting']} waiting, {c['processed']} processed); with BOTH signatures: {c['both_sigs']}; caregiver signature only: {c['caregiver_only']}")
    say(f"    first form {str(c['first'] or '(none)')[:16]}, latest {str(c['last'] or '(none)')[:16]} (UTC)")
else: bad("couldn't count the forms: " + str(n)[:200])
if "client_axiscare_id" in COLS: say("  · the new columns are already there (running the SQL again is safe)")
ok, pol = sql("select policyname, cmd, roles::text as roles, coalesce(qual, '') as q from pg_policies where schemaname = 'public' and tablename = 'evv_submissions' order by cmd, policyname")
for r in (pol if ok else []): say(f"  · rule: {r['policyname']}: {r['cmd']} for {r['roles']} using ({r['q'][:80]})")
PRIVQ = ("select r.rolname as role, string_agg(p, ', ' order by p) as privs from (values ('anon'), ('authenticated')) r(rolname) "
         "cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p where has_table_privilege(r.rolname, 'public.evv_submissions', p) group by r.rolname order by 1")
ok, pv = sql(PRIVQ)
for r in (pv if ok else []): say(f"  · before: {'the public form (anon)' if r['role'] == 'anon' else 'signed-in staff (authenticated)'} can {r['privs']}")
ok, trg = sql("select t.tgname, p.proname, (p.prosrc ~* '(net\\.|http_post|http_get|pg_net|supabase_functions)') as calls_out from pg_trigger t join pg_proc p on p.oid = t.tgfoid "
              "where t.tgrelid = 'public.evv_submissions'::regclass and not t.tgisinternal order by 1")
OTHER_CALLERS = [r["tgname"] for r in (trg if ok else []) if r["calls_out"] and not r["tgname"].startswith("evv_submissions_public_insert_guard")]
for r in (trg if ok else []): say(f"  · trigger on the forms table: {r['tgname']} -> {r['proname']}(){'  (CALLS OUT over the network)' if r['calls_out'] else ''}")

say(); say("  WHAT HAPPENS TO OLD FORMS AND SIGNATURES (retention, read only; nothing here changes it)")
ok, hc = sql("select to_regclass('cron.job') is not null as has_cron")
HAS_CRON = bool(ok and hc and hc[0]["has_cron"])
DEL_JOBS = 0 if (ok and hc and not HAS_CRON) else None
if HAS_CRON:
    ok, jobs = sql("select jobname, schedule, active from cron.job where command ilike '%evv_submissions%' or jobname ilike '%evv%' order by jobname")
    if not ok: say("  · couldn't read the scheduled jobs (" + str(jobs)[:120] + ")"); jobs = []
    for j in jobs: say(f"  · scheduled job '{j['jobname']}' ({j['schedule']}, {'on' if j['active'] else 'off'}) mentions EVV")
    ok, dj = sql("select count(*)::int as n from cron.job where command ilike '%evv_submissions%' and command ~* '(delete|truncate|sig_attendant|sig_consumer)'")
    DEL_JOBS = (dj[0]["n"] if ok and dj else None)
ok, fx = sql("select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosrc ilike '%evv_submissions%' "
             "and p.prosrc ~* '(delete\\s+from\\s+(public\\.)?evv_submissions|truncate|sig_attendant\\s*=\\s*null|sig_consumer\\s*=\\s*null)' order by 1")
DEL_FNS = [r["proname"] for r in fx] if ok else None
if DEL_JOBS == 0 and DEL_FNS == []:
    say("  ✓ nothing in the database deletes forms or clears signatures (no scheduled job, no database function). Forms are kept until someone deletes one by hand.")
else:
    say(f"  · ATTENTION: something may delete forms or signatures: jobs {DEL_JOBS if DEL_JOBS is not None else '(unreadable)'}, functions {', '.join(DEL_FNS) if DEL_FNS else '(none)' if DEL_FNS == [] else '(unreadable)'}. Not changed; tell Claude.")
say("  · signed-in staff can still delete a form through the database (that permission is left as it was; no Hub screen does it)")
ok, bk = sql("select count(*)::int as n from storage.objects where bucket_id = 'backups'")
if ok and bk: say(f"  · weekly backups bucket holds {bk[0]['n']} file(s) (they copy the Hub's saved lists; this check does not open them)")

s_, b_ = http("GET", f"{API}/v1/projects/{REF}/config/auth", headers=MG())
ds = (jl(b_) or {}).get("disable_signup") if s_ == 200 else None
if ds is True: say("  ✓ new sign-ups are OFF on this project (only invited office accounts can sign in, so only they can read forms)")
elif ds is False: say("  · ATTENTION: new sign-ups are ON for this project. Anyone who creates an account could read EVV forms (signed-in accounts can read them). Samantha decides; not changed here.")
else: say(f"  · couldn't read the sign-up setting ({s_})")
s_, b_ = http("GET", f"{API}/v1/projects/{REF}/secrets", headers=MG())
names = {x.get("name") for x in (jl(b_) or []) if isinstance(x, dict)} if s_ == 200 else None
if names is None: say(f"  · couldn't list the function secrets ({s_}); the AxisCare check will say so if they are missing")
else:
    has_key = bool(names & {"AXISCARE_API_KEY", "AXISCARE_TOKEN", "AXISCARE_VISITS_TOKEN"}); has_site = bool(names & {"AXISCARE_SITE", "AXISCARE_SITE_NUMBER"})
    chk(has_key and has_site, "the AxisCare key and site number are set for functions (names only, never values)" if has_key and has_site
        else f"the AxisCare {'key' if not has_key else 'site number'} is not set for functions, so the AxisCare check would say 'not connected'")
sP, mP = fmeta(PATTERN_FN)
VJ = (mP or {}).get("verify_jwt")
if not isinstance(VJ, bool): bad(f"couldn't read {PATTERN_FN}'s sign-in setting (the pattern for the new function). Nothing was changed."); done(3)
sF, mF = fmeta(FN)
say(f"  · {FN} is " + ("already deployed (it is replaced only if it isn't the reviewed build)" if sF == 200 else "not deployed yet") + f"; its sign-in check will match {PATTERN_FN} ({'on' if VJ else 'off'})")
K = keys(); PUB = K.get("anon") or K.get("publishable") or ""
HIDE += list(K.values())
if not PUB: bad("couldn't read the project's public key (needed for the proof). Nothing was changed."); done(3)
if not SUPA or not os.path.exists(SUPA): bad("the supabase command line tool wasn't found. Nothing was changed."); done(3)

say(); say("PART 2 · CHANGE (in order; each step only if the one before it worked)")
ok, r = sql(SQLTEXT)
if not ok: bad("the database change didn't go in (one transaction, so nothing in it changed): " + str(r)[:300]); say("  STOP. Tell Claude."); done(4)
ok, pv2 = sql(PRIVQ)
P2 = {r["role"]: r["privs"] for r in (pv2 if ok else [])}
chk(P2.get("anon") == "INSERT" and set(P2.get("authenticated", "").split(", ")) >= {"SELECT", "UPDATE"} and "TRUNCATE" not in P2.get("authenticated", ""),
    f"the database change is in: the public form can only send (anon: {P2.get('anon', 'nothing')}); staff can {P2.get('authenticated', 'nothing')}")
ALREADY = sF == 200 and is_reviewed_live()[0] is True
if ALREADY: say(f"  ✓ {FN} already had the reviewed build")
else:
    p = subprocess.run([SUPA, "functions", "deploy", FN, "--project-ref", REF, "--use-api"] + ([] if VJ else ["--no-verify-jwt"]), cwd=ROOT, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    sN, mN = fmeta(FN)
    if p.returncode != 0 and sN != 200: bad(f"{FN} didn't deploy: " + (p.stderr or p.stdout)[-200:]); say("  STOP. The database change is in (the Hub works without the check; it says the check is not available). Tell Claude."); done(4)
    if (mN or {}).get("verify_jwt") != VJ:
        http("PATCH", f"{API}/v1/projects/{REF}/functions/{FN}", {"verify_jwt": VJ}, MG()); sN, mN = fmeta(FN)
    chk((mN or {}).get("verify_jwt") == VJ, f"{FN} deployed (version {(mN or {}).get('version', '?')}), sign-in check {'on' if VJ else 'off'} like {PATTERN_FN}; the function itself refuses anyone who isn't office staff")

say(); say("PART 3 · PROOF (nothing stays)")
if OTHER_CALLERS:
    say(f"  · another trigger on the forms table could call out over the network ({', '.join(OTHER_CALLERS)}), so the in-database proof was NOT run (the test database proved it). Tell Claude.")
else:
    ok, b4 = sql("select count(*)::int as n, coalesce(md5(string_agg(id::text || coalesce(processed_at::text, ''), ',' order by id)), '') as m from public.evv_submissions")
    s_, body = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": PROOFTEXT}, MG())
    msg = (jl(body) or {}).get("message", body) if isinstance(jl(body), dict) else body
    J = None
    if "PROBE_RESULT: " in str(msg):
        try: J, _ = json.JSONDecoder().raw_decode(str(msg).split("PROBE_RESULT: ", 1)[1])
        except Exception: J = None
    if J is None: bad(f"the proof didn't give a result ({s_}): {str(msg)[:300]}")
    else:
        chk(J.get("anon_insert") == "sent", f"the public form can still send a form ({J.get('anon_insert')})")
        chk(J.get("wiped") is True, "a public send that claims to be accepted, linked and checked arrives waiting and unlinked")
        chk(J.get("anon_read") == "refused", "the public form cannot read any form")
        chk(J.get("staff_read") == 1 and J.get("staff_update") == 1 and J.get("after") is True, "a signed-in office member read that one form by its number and linked it")
        a, st = J.get("anon_can") or {}, J.get("staff_can") or {}
        chk(a.get("insert") and not a.get("select") and not a.get("update") and not a.get("delete") and st.get("select") and st.get("update") and not st.get("truncate"),
            "permissions now: public = send only; staff = read and update, cannot empty the table")
    ok, af = sql("select count(*)::int as n, coalesce(md5(string_agg(id::text || coalesce(processed_at::text, ''), ',' order by id)), '') as m from public.evv_submissions")
    ok2, left = sql("select count(*)::int as n from public.evv_submissions where attendant like 'Proof422%'")
    chk(ok2 and left and left[0]["n"] == 0, "no proof form was left behind (all rolled back)")
    if ok and af and b4 and af[0]["n"] != b4[0]["n"]: say(f"  · the number of forms changed while this ran ({b4[0]['n']} -> {af[0]['n']}): a real caregiver sent one; not from the proof")
s_, b_ = http("GET", f"{FNB}/rest/v1/evv_submissions?select=id&limit=1", None, {"apikey": PUB, "Authorization": "Bearer " + PUB})
chk(s_ in (401, 403) or (s_ == 200 and (jl(b_) == [])) or "42501" in str(b_), f"over the web, the public key cannot read forms ({s_})")
s1, b1 = http("POST", f"{FNB}/functions/v1/{FN}", {"submission_id": "00000000-0000-4000-8000-000000000422"}, {})
s2, b2 = http("POST", f"{FNB}/functions/v1/{FN}", {"submission_id": "00000000-0000-4000-8000-000000000422"}, {"apikey": PUB, "Authorization": "Bearer " + PUB})
chk(s1 == 401 and s2 in (401, 403), f"the AxisCare check refuses without a staff sign-in (no sign-in: {s1}; the public key: {s2}); it never writes to AxisCare")
good, why = is_reviewed_live()
chk(good, f"the live {FN} is the reviewed build" + ("" if good else f" ({why})"))
s_, page = http("GET", HUB_URL.rstrip("/") + "/evv-form.html?v=" + dt.datetime.now().strftime("%H%M%S"), None, {"Cache-Control": "no-cache"}, timeout=60)
if s_ == 200 and "EVVPAGE" in (page or ""): say("  ✓ cc.mo-care.com/evv-form.html is live (the Hub side is merged)")
else: say(f"  · cc.mo-care.com/evv-form.html is not live yet ({s_}): merge the Hub branch evv-completed-form (GitHub Pages takes a minute or two)")

say()
if fails: say("RESULT: PARTLY DONE · the ✗ lines above need Claude.")
else: say("RESULT: DONE · the forms can be linked to the caregiver and client, viewed whole with both signatures, and checked against AxisCare.")
say("Nothing was texted or emailed. Nothing was written to AxisCare. No retention was changed.")
say("Rollback (only if ever needed): the new columns can stay (unused); drop trigger evv_submissions_public_insert_guard_422 on public.evv_submissions; delete the evv-axiscare-check function.")
done(1 if fails else 0)
