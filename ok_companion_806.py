#!/usr/bin/env python3
# 806 · OKLAHOMA COMPANION APPLICANTS IN THE SAME HUB. Samantha 2026-10-16: "Approve the Oklahoma Companion pre-screener
#   plan with all six decisions as you recommended. Start building." Plan: https://claude.ai/artifact/KBxEA4jLABRzytSZqwPT9e
# SB_MODE=install (default, Desktop 806)
#   Part 1, read only: the reviewed build; the live screening rules are the ones this was built on (or already 806); every
#     applicant sender on the server is a build from GitHub; how many caregivers wait on the Oklahoma opening list.
#   Part 2: ok_companion_806.sql (all or nothing; a copy of the live rules is saved first), then the 15 applicant senders
#     are redeployed with the Oklahoma hold (each keeps its gateway setting).
#   Part 3, proof (made-up applicants inside a step that is always undone; nothing is sent, nothing is left behind).
# SB_MODE=move (Desktop 807, only after she has seen the count): the opening list's caregivers become Oklahoma Companion
#   applicants in the Hub. Nobody is texted or emailed (they are held, and they gave no text consent on that form).
# SB_MODE=undo: ok_companion_806_rollback.sql (the senders keep the hold; it only ever holds Oklahoma applicants).
# Prints counts only: no name, number, email, key or secret.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil, time
MODE = os.environ.get("SB_MODE", "install")
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
LOCAL = os.environ.get("SB_LOCAL_SOCK")          # rehearsal only: a throwaway local Postgres instead of the live database
REF = "zngsgedlsxinbygwmxwn"
HUB = os.environ["SB_REPO"]; BASE = os.environ.get("SB_BASE", "")
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
SAVE_ROOT = os.environ.get("SB_SAVE", os.path.expanduser("~/Claude/checks/806-saved"))
FNS = ["interview-messages", "applicant-text", "applicant-invite", "applicant-decision-msg", "applicant-noshow", "applicant-reengage",
       "reference-chase", "reference-send", "step2-handoff", "outreach-check", "bg-review", "caregiver-journey", "welcome-call",
       "send-candidate-message", "orientation-remind"]
TESTS = ["optout_check_test.mjs"]
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for h in HIDE:
        if h: s = s.replace(h, "(hidden)")
    s = re.sub(r"(sbp_|eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._\-]+", "(hidden)", s); s = re.sub(r"[\w.%+\-]+@[\w.\-]+\.[A-Za-z]{2,}", "(an email)", s)
    print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def chk(good, msg): (say if good else bad)(("  ✓ " if good else "") + msg); return good
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Anything done above stays done; nothing after it ran. Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=200):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-806/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    """One script. (ok, rows | error text)."""
    if LOCAL:
        from pg8000.native import Connection
        c = Connection(user="postgres", database="postgres", unix_sock=LOCAL)
        try:
            rows = c.run(q); names = [x["name"] for x in (c.columns or [])]
            return True, [dict(zip(names, r)) for r in (rows or [])]
        except Exception as e:
            try: c.run("rollback")
            except Exception: pass
            return False, (e.args[0].get("M") if e.args and isinstance(e.args[0], dict) else str(e))[:6000]
        finally: c.close()
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, f"HTTP {s}: {b[:6000]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:300]
def fmeta(fn):
    s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{fn}", headers=MG())
    try: return s, (json.loads(b) if s == 200 else None)
    except Exception: return s, None
shab = lambda b: hashlib.sha256(b).hexdigest()
sha = lambda p: shab(open(p, "rb").read())
rd = lambda rel: open(os.path.join(HUB, rel)).read()
pinpath = lambda k: k if "." in k.split("/")[-1] and not k.endswith(".ts") or k.endswith(".sql") else (f"supabase/functions/{k}.ts" if k.startswith("_shared/") else f"supabase/functions/{k}/index.ts")
def git(root, *a): return subprocess.run(["git", *a], cwd=root, capture_output=True)
def deps(path, seen):
    if path in seen or not os.path.exists(path): return
    seen.add(path)
    src = "\n".join(l for l in open(path).read().split("\n") if not re.match(r"\s*import\s+type\b", l))
    for m in re.findall(r"""from\s+['"](\.{1,2}/[^'"]+)['"]|import\s+['"](\.{1,2}/[^'"]+)['"]""", src):
        deps(os.path.normpath(os.path.join(os.path.dirname(path), m[0] or m[1])), seen)
def need(fn):
    s = set(); deps(os.path.join(HUB, f"supabase/functions/{fn}/index.ts"), s)
    return {os.path.relpath(x, HUB).replace(os.sep, "/") for x in s}
def live_files(fn):
    for i in range(3):
        tmp = tempfile.mkdtemp(prefix="cc806-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
        d = subprocess.run([SUPA, "functions", "download", fn, "--project-ref", REF, "--use-api"], cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
        live = {}
        for r, _, files in os.walk(tmp):
            for f in files:
                lp = os.path.join(r, f).replace(os.sep, "/")
                if "/functions/" in lp: live["supabase/functions/" + lp.split("/functions/", 1)[1]] = sha(lp)
        shutil.rmtree(tmp, ignore_errors=True)
        if d.returncode == 0 and live: return True, live
        time.sleep(float(os.environ.get("SB_RETRY", "3")) * (i + 1))
    return False, {}
HIST = {}
def history_shas(rel):
    if rel in HIST: return HIST[rel]
    out = set()
    for c in git(HUB, "log", "--format=%H", "origin/main", "--", rel).stdout.decode().split():
        b = git(HUB, "show", f"{c}:{rel}")
        if b.returncode == 0: out.add(shab(b.stdout))
    HIST[rel] = out; return out
def state(fn):
    """'this' | 'older' (every live file is a version once merged to main) | 'other' | 'unreadable', with its gateway setting."""
    s, m = fmeta(fn)
    if s == 404: return "missing", None, []
    vj = (m or {}).get("verify_jwt")
    okd, live = live_files(fn)
    if not okd or not isinstance(vj, bool): return "unreadable", vj, []
    nd = need(fn)
    if all(k in live and live[k] == sha(os.path.join(HUB, k)) for k in nd): return "this", vj, []
    odd = [k for k in nd if k in live and live[k] != sha(os.path.join(HUB, k)) and live[k] not in history_shas(k)]
    odd += [k for k in live if k.endswith((".ts", ".js")) and k not in nd and live[k] not in history_shas(k)]
    return ("older" if not odd else "other"), vj, odd
def deploy(fn, vj):
    p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"] + ([] if vj else ["--no-verify-jwt"]), cwd=HUB, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    okd, live = live_files(fn)
    good = p.returncode == 0 and okd and all(k in live and live[k] == sha(os.path.join(HUB, k)) for k in need(fn))
    if not good: bad(f"{fn} didn't deploy: " + (p.stderr or p.stdout)[-200:]); return False
    sN, mN = fmeta(fn)
    if (mN or {}).get("verify_jwt") != vj:
        http("PATCH", f"{API}/v1/projects/{REF}/functions/{fn}", {"verify_jwt": vj}, MG()); sN, mN = fmeta(fn)
    return chk((mN or {}).get("verify_jwt") == vj, f"{fn} deployed, version {(mN or {}).get('version', '?')} (gateway sign-in check {'on' if vj else 'off'})")

# ---- the three screening rules 806 replaces: what it was built on, and what it puts in ----
def body(defn):
    m = re.search(r"AS \$(\w*)\$(.*)\$\1\$", defn or "", re.S)
    return m.group(2).strip() if m else None
def file_body(text, name):
    m = re.search(r"CREATE OR REPLACE FUNCTION public\." + name + r"\(.*?\)\s*\n?\s*RETURNS.*?AS \$(\w*)\$(.*?)\$\1\$", text, re.S | re.I)
    return m.group(2).strip() if m else None
SIGS = {"screen": "public.applicant_screen(uuid)", "gap": "public.applicant_screening_gap(uuid)", "stop": "public.applicant_followup_stop(uuid)"}
def live_rules():
    out = {}
    for k, sig in SIGS.items():
        ok, r = sql(f"select pg_get_functiondef('{sig}'::regprocedure) d")
        out[k] = body(r[0]["d"]) if ok and r else None
    return out
def defs_text():
    q = " union all ".join(f"select pg_get_functiondef('{sig}'::regprocedure) d" for sig in SIGS.values())
    ok, r = sql(q)
    return "\n\n".join(x["d"] + ";" for x in r) if ok else None

PROOF = r"""
do $proof$
declare r jsonb := '{}'::jsonb; ok1 uuid; mo1 uuid; h1 boolean; h2 boolean;
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  ok1 := public.apply_save(null, '{"first_name":"Proof","last_name":"Eightohsix","phone":"405-555-0189","email":"proof-806-ok@practice.invalid","zip":"73099","position":"companion","channel":"self-test","office":"MO"}'::jsonb, false);
  perform public.apply_save(ok1, '{"age_ok":true,"work_auth":true,"can_pass_background":true,"has_transport":false,"experience_years":"Less than 1 year"}'::jsonb, false);
  perform public.apply_save(ok1, '{}'::jsonb, true);
  mo1 := public.apply_save(null, '{"first_name":"Proof","last_name":"Eightohsixmo","phone":"417-555-0188","email":"proof-806-mo@practice.invalid","zip":"65714","position":"caregiver","channel":"self-test"}'::jsonb, false);
  h1 := public.ok_applicant_hold('+14055550189', null, 'proof-806', 'sms');   -- its own step, so the mark it makes is seen below
  h2 := public.ok_applicant_hold('+14175550188', null, 'proof-806', 'sms');
  r := r || jsonb_build_object(
    'ok_office', (select office from public.job_applicants where id = ok1),
    'ok_grade', (select screen_grade from public.job_applicants where id = ok1),
    'ok_miles', (select miles_out from public.job_applicants where id = ok1),
    'ok_gap', coalesce(public.applicant_screening_gap(ok1), 'none'),
    'ok_stop', coalesce(public.applicant_followup_stop(ok1), 'none'),
    'ok_hold', h1,
    'ok_marked', (select msgs_held_at is not null from public.job_applicants where id = ok1),
    'mo_office', (select office from public.job_applicants where id = mo1),
    'mo_hold', h2,
    'mo_stop_held', coalesce(public.applicant_followup_stop(mo1), 'none') = 'Oklahoma applicant: messages held',
    'anon_hold', has_function_privilege('anon', 'public.ok_applicant_hold(text,text,text,text)', 'execute'),
    'auth_hold', has_function_privilege('authenticated', 'public.ok_applicant_hold(text,text,text,text)', 'execute'),
    'anon_move', has_function_privilege('anon', 'public.ok_companion_move(boolean)', 'execute'),
    'auth_move', has_function_privilege('authenticated', 'public.ok_companion_move(boolean)', 'execute'),
    'anon_okscreen', has_function_privilege('anon', 'public.applicant_screen_by_office_ok(uuid,boolean,boolean,boolean)', 'execute'),
    'companion', (select office || '/' || label || '/' || active from public.job_positions where key = 'companion'),
    'switch_on', coalesce((select (data->>'ok_applicant_msgs_live')::boolean from public.app_data where key = 'ops_settings'), false));
  raise exception 'PROOF806 %', r::text;
end $proof$;
"""
def proof_result():
    ok, r = sql(PROOF)
    txt = str(r).replace('\\"', '"'); i = txt.find("PROOF806 {")
    if ok or i < 0: return None, str(r)[:300]
    try: return json.JSONDecoder().raw_decode(txt[i + len("PROOF806 "):])[0], None
    except Exception: return None, txt[i:i + 300]

title = {"install": "install", "move": "MOVE THE OPENING LIST (Desktop 807)", "undo": "UNDO"}.get(MODE, MODE)
say(f"806 · OKLAHOMA COMPANION APPLICANTS ({title})"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
S806, SRB = rd("ok_companion_806.sql"), rd("ok_companion_806_rollback.sql")
BUILT_ON = {"screen": file_body(rd("screen_fix.sql"), "applicant_screen"),
            "gap": (re.search(r"create or replace function public\.applicant_screening_gap.*?as \$f\$(.*?)\$f\$", rd("one_year_731.sql"), re.S | re.I) or [None, None])[1],
            "stop": (re.search(r"create or replace function public\.applicant_followup_stop.*?as \$f\$(.*?)\$f\$", rd("one_year_731.sql"), re.S | re.I) or [None, None])[1]}
AFTER = {"screen": file_body(S806, "applicant_screen"),
         "gap": (re.search(r"create or replace function public\.applicant_screening_gap.*?as \$f\$(.*?)\$f\$", S806, re.S | re.I) or [None, None])[1],
         "stop": (re.search(r"create or replace function public\.applicant_followup_stop.*?as \$f\$(.*?)\$f\$", S806, re.S | re.I) or [None, None])[1]}
BUILT_ON = {k: (v or "").strip() or None for k, v in BUILT_ON.items()}; AFTER = {k: (v or "").strip() or None for k, v in AFTER.items()}
if not all(BUILT_ON.values()) or not all(AFTER.values()): bad("couldn't read the screening rules from the files. Nothing was run."); done(2)
same = lambda L, want: all(L.get(k) == want[k] for k in want)

say("PART 1 · READ ONLY (nothing changes)")
# the reviewed build: every pinned file changed since the starting point and is exactly what was tested
if MODE == "install":
    if not BASE or git(HUB, "cat-file", "-e", BASE + "^{commit}").returncode != 0: bad("the reviewed starting point isn't in the history"); say("  STOP. Nothing was run."); done(2)
    changed = set(git(HUB, "diff", "--name-only", BASE, "HEAD").stdout.decode().split())
    for k, want in SHAS.items():
        rel = pinpath(k)
        if rel not in changed or not os.path.exists(os.path.join(HUB, rel)) or sha(os.path.join(HUB, rel)) != want:
            bad(f"{rel.split('functions/')[-1]} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
    pinned = {pinpath(k) for k in SHAS}
    for fn in FNS:
        other = sorted(k for k in need(fn) if k not in pinned and k in changed)
        if other: bad(f"other changes merged since the review touch {fn} ({', '.join(other)[:200]}). Ask Claude to refresh 806."); say("  STOP. Nothing was run."); done(2)
    say(f"  ✓ the {len(SHAS)} changed files are exactly the reviewed build; nothing else changed under the 15 senders")
    NODE = shutil.which("node") or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.path.exists(p)), "")
    if NODE:
        for t in TESTS:
            p = subprocess.run([NODE, t], cwd=HUB, capture_output=True, text=True)
            last = [x for x in p.stdout.strip().splitlines() if re.search(r"ALL \d+ CHECKS PASS|\d+/\d+ passed", x)] or (p.stdout.strip().splitlines() or ["(no output)"])
            if p.returncode != 0: bad(f"{t} failed: {last[-1]}"); say("  STOP. Nothing was changed."); done(2)
            say(f"  ✓ {t}: {last[-1].strip()}")
    else: say("  · node is not on this Mac, so the send-door test was not re-run here (it passed when built)")

L = live_rules()
if any(v is None for v in L.values()): bad("couldn't read the live screening rules. Nothing was changed."); done(3)
st_rules = "before" if same(L, BUILT_ON) else "after" if same(L, AFTER) else "other"
if st_rules == "other":
    bad("the live screening rules aren't the ones this was built on (someone changed them since): "
        + ", ".join(k for k in L if L[k] not in (BUILT_ON[k], AFTER[k])) + ". Nothing was changed. Tell Claude."); done(3)
say("  ✓ the live screening rules are " + ("exactly what this was built on" if st_rules == "before" else "already 806 (an earlier run)"))

if MODE == "undo":
    say(); say("UNDO")
    ok, r = sql(SRB)
    if not ok: bad("the undo didn't go in, and was undone as a whole (nothing changed): " + str(r)[:300]); done(6)
    chk(same(live_rules(), BUILT_ON), "the screening rules are back exactly as before 806; Companion is switched off")
    say("  · The applicant senders keep the Oklahoma hold (it only ever holds Oklahoma applicants). The Hub change needs undoing too: tell Claude.")
    say(); say("UNDO COMPLETE. Nothing was sent." if not fails else f"{len(fails)} PROBLEM(S) ABOVE. Tell Claude."); done(0 if not fails else 4)

if MODE == "move":
    if st_rules != "after": bad("806 isn't in yet, so there is nothing to move into. Nothing was changed."); done(3)
    ok, r = sql("select public.ok_companion_move(false) as c")
    if not ok: bad("couldn't count the opening list: " + str(r)[:200]); done(3)
    c = r[0]["c"]; c = json.loads(c) if isinstance(c, str) else c
    say(f"  ✓ {c['to_move']} caregiver(s) on the Oklahoma opening list to move in; {c['already_in_hub']} already in the Hub (linked, not added twice)")
    say(); say("PART 2 · MOVE")
    ok, r = sql("select public.ok_companion_move(true) as c")
    if not ok: bad("the move didn't go in, and was undone as a whole (nothing changed): " + str(r)[:300]); done(6)
    m = r[0]["c"]; m = json.loads(m) if isinstance(m, str) else m
    chk(m["moved"] == c["to_move"], f"{m['moved']} moved in as Oklahoma Companion applicants (New, call only: no text consent on that form)")
    ok, r = sql("""select (select count(*) from public.early_interest where site = 'oklahoma' and kind = 'caregiver' and moved_applicant_id is null)::int as left_,
                          (select count(*) from public.job_applicants where source = 'ok-opening-list' and office = 'OK')::int as in_hub,
                          (select count(*) from public.job_applicants where source = 'ok-opening-list' and office <> 'OK')::int as wrong""")
    chk(ok and r[0]["left_"] == 0 and r[0]["wrong"] == 0, f"none left behind on the list; {r[0]['in_hub'] if ok else '?'} in the Hub from the list, all marked Oklahoma")
    say(); say("MOVE COMPLETE. Nobody was texted or emailed." if not fails else f"{len(fails)} PROBLEM(S) ABOVE. Tell Claude."); done(0 if not fails else 4)

STATES = {}
for fn in FNS:
    st, vj, odd = state(fn)
    if st not in ("older", "this"): bad(f"{fn} on the server is not a build from GitHub ({st}{': ' + ', '.join(odd)[:160] if odd else ''}). Nothing was changed. Tell Claude."); done(3)
    STATES[fn] = (st, vj)
say(f"  ✓ all {len(FNS)} applicant senders on the server are builds from GitHub ({sum(1 for s, _ in STATES.values() if s == 'this')} already this one)")
ok, r = sql("""select (select count(*) from public.job_applicants)::int as apps,
  (select count(*) from public.early_interest where site = 'oklahoma' and kind = 'caregiver')::int as list_cg""")
if not ok: bad("couldn't count applicants. Nothing was changed. " + str(r)[:200]); done(3)
say(f"  ·  {r[0]['apps']} applicant record(s) in the Hub: every one reads Missouri after this")
say(f"  ·  {r[0]['list_cg']} caregiver(s) on the Oklahoma opening list (they are NOT moved by this step)")

say(); say("PART 2 · CHANGE")
stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S"); save = os.path.join(SAVE_ROOT, stamp); os.makedirs(save, exist_ok=True)
d_ = defs_text()
if not d_: bad("couldn't save a copy of the live screening rules. Nothing was changed."); done(3)
open(os.path.join(save, "live_functions.sql"), "w").write("-- live before 806, " + stamp + "\n" + d_ + "\n")
say("  ✓ a copy of the live screening rules saved (for the undo)")
ok, r = sql(S806)
if not ok: bad("the database change didn't go in, and was undone as a whole (nothing changed): " + str(r)[:300]); say("  STOP. Tell Claude."); done(6)
if not chk(same(live_rules(), AFTER), "the database change is in: the office on every applicant, Companion (Oklahoma), miles from Mustang, the Oklahoma questions, the hold"): done(6)
for fn in FNS:
    st, vj = STATES[fn]
    if st == "this": say(f"  ✓ {fn} already had it"); continue
    if not deploy(fn, vj): say("  STOP. The database part is in and safe on its own; the senders not yet redeployed still send as before. Tell Claude."); done(6)
time.sleep(float(os.environ.get("SB_SETTLE", "8")))

say(); say("PART 3 · PROOF (made-up applicants, always undone; nothing is sent)")
for fn in FNS:
    okd, live = live_files(fn)
    if not (okd and all(k in live and live[k] == sha(os.path.join(HUB, k)) for k in need(fn))): bad(f"{fn}: the live copy is not the reviewed build")
chk(not any("live copy" in f for f in fails), f"all {len(FNS)} senders: the live copy is exactly the reviewed build, with the Oklahoma hold")
P, perr = proof_result()
if not P: bad("the proof couldn't run: " + str(perr)); done(7)
chk(P.get("companion") == "OK/Companion/true", "Companion is an Oklahoma position")
chk(P.get("ok_office") == "OK", "an application for Companion is Oklahoma, even when the form says otherwise")
chk(P.get("ok_grade") == "qualified" and P.get("ok_miles") is not None and 5 < float(P["ok_miles"]) < 15, "from Yukon: measured from Mustang (about 10 miles); won't drive and under a year are flags, not a no")
chk(P.get("ok_gap") == "none", "nothing more to ask before an interview (18+, allowed to work, OKSCREEN)")
chk(P.get("ok_stop") == "Oklahoma applicant: messages held", "no automatic follow-ups for an Oklahoma applicant")
chk(P.get("ok_hold") is True and P.get("ok_marked") is True, "the send door holds their phone, and their record says so (the Hub shows it)")
chk(P.get("mo_office") == "MO" and P.get("mo_hold") is False and P.get("mo_stop_held") is False, "a Missouri applicant is exactly as before")
chk(not any(P.get(k) for k in ("anon_hold", "auth_hold", "anon_move", "auth_move", "anon_okscreen")), "the public and Hub logins can't use the hold or the move; the public can't use the office's Oklahoma questions")
chk(P.get("switch_on") is False, "Oklahoma applicant messages are OFF (ops_settings.ok_applicant_msgs_live)")
ok, r = sql("select count(*)::int as n from public.job_applicants where email like 'proof-806-%'")
chk(ok and r[0]["n"] == 0, "nothing made-up was left behind")
ok, r = sql("select public.ok_companion_move(false) as c")
if ok:
    c = r[0]["c"]; c = json.loads(c) if isinstance(c, str) else c
    say(f"  ·  {c['to_move']} caregiver(s) from the opening list are ready to move into the Hub ({c['already_in_hub']} already there). That is Desktop 807, after you say yes.")
say(); say("806 COMPLETE. Nothing was sent." if not fails else f"{len(fails)} PROBLEM(S) ABOVE. Tell Claude. (To put the database back: the 806 undo.)")
done(0 if not fails else 4)
