#!/usr/bin/env python3
# 1220 · STAFFING SERVER · FIELD SUPPORT VISITS: A REQUEST TEXTS THE PRN CNAs IT FITS (2026-10-31, Samantha: "make an easy way to
# click yes request, or no remove the suggestions ... manually put in a field Support request that will show up on the PRNs
# little hub and will text them just like an open shift")
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (fake data and a throwaway Postgres
#     only); prn-week live is GitHub's main code (so nobody else's live change is overwritten); its gateway setting is read, so
#     it is kept; the new texting switch is off.
#  2. Adds the texts' record (prn_fsv_texts.sql, one transaction: one text per PRN CNA per visit, kept as sent). Deploys
#     prn-week (a request can text the PRN CNAs it fits, "Text them", and the list for the new Field Support Visits tab).
#  3. Proof (nothing is sent or saved): prn-week refuses outsiders; the record is there and kept; the switch is still off.
# Texts nobody. Safe to run again.
import json, os, subprocess, shutil, time
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, deploy, start, check_build, fmeta, MG, API, sql, lit

REF = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
BASE = os.environ.get("SB_BASE", "")   # the commit live is expected to match before this step (1212's build)
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
if NODE == "none": NODE = ""
PGLITE = os.environ.get("SB_PGLITE", "/Users/samantha/Claude/Projects/.pglite/node_modules/@electric-sql/pglite/dist/index.js")
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FNS = ("prn-week",); PUBLIC_NEW = {}
SWITCH = "prn_mentor_text_live"
ok = lambda s: say("  ✓ " + s)
def run(args, cwd=None, env=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True, env=env); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)
def keys():
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys{q}", headers=MG())
        if s != 200: continue
        try: arr = json.loads(b)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        out = {}
        for k in arr:
            v = k.get("api_key", "") if isinstance(k, dict) else ""
            if isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_")) and "·" not in v and "*" not in v: out[k.get("name")] = v
        if out.get("service_role") and out.get("anon"): return out
    return {}
WHY = {"": ""}
def switch_on():
    for i in range(3):
        okS, st = sql(REF, f"select data->'{SWITCH}' as v from public.app_data where key='ops_settings'")
        if okS and st: return st[0].get("v") is True
        WHY[""] = str(st)[:300] if not okS else "no settings row came back"
        time.sleep(3 * (i + 1) * float(os.environ.get("SB_RETRY_SCALE", "1")))
    return None
def why_read():
    w = WHY[""].lower()
    if "unauthorized" in w or "jwt" in w or ("invalid" in w and "token" in w) or "401" in w: return "Supabase didn't accept the access token (it may have expired or been revoked). Make a new one at supabase.com/dashboard/account/tokens and run this again."
    return "Supabase answered: " + WHY[""]
def sha_of(ref, path):
    import hashlib
    c, o = run(["git", "-C", ROOT, "show", f"{ref}:{path}"])
    return hashlib.sha256(o.encode()).hexdigest() if c == 0 else None
def main_versions(path):
    """Every version of a file GitHub's main has had (up to the build this builds on, the last 60 changes): live may run an older one
    when a step deployed it before a later change (1202 put coverage-run live before every week changed prn-oncall.ts)."""
    c, o = run(["git", "-C", ROOT, "log", "-n", "60", "--format=%H", BASE, "--", path]) if BASE else (1, "")
    return {h for h in (sha_of(x, path) for x in (o.split() if c == 0 else [])) if h}

# the code this step changes in prn-week (outreach.ts and send-problems.ts only gain one registry line each)
CHANGED = {"supabase/functions/prn-week/index.ts", "supabase/functions/_shared/prn-mentor.ts", "supabase/functions/_shared/outreach.ts", "supabase/functions/_shared/send-problems.ts"}
start("STAFFING SERVER · FIELD SUPPORT VISITS TEXT THE PRN CNAs (switch OFF)")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")   # the rehearsal compares with its own commit
if MAIN == "origin/main": run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = [k for k in sorted({k for fn in FNS for k in L.need(FNROOT, fn)} | {"prn_fsv_texts.sql"})
         if (lambda r: r[0] != 0 or r[1] != open(os.path.join(ROOT, k)).read())(run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"]))]
if drift: stop("this isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(drift)[:240] + ")")
ok("the reviewed build is what is on GitHub's main")
if NODE and os.path.exists(PGLITE):
    env = dict(os.environ, PGLITE=PGLITE)
    for t, must in (("prn_fsv_texts_test.mjs", "27/27"), ("prn_mentor_test.mjs", "57/57"), ("prn_week_test.mjs", "52/52"), ("prn_monthly_test.mjs", "39/39"),
                    ("oncall_caregivers_test.mjs", "43/43"), ("office_line_sender_test.mjs", "19/19"), ("oncall_7to7_test.mjs", "16/16")):
        c, o = run([NODE, t], cwd=ROOT, env=env)
        if c != 0 or must not in o: stop(f"the tests failed ({t}): " + " ".join(l.strip() for l in o.splitlines() if "FAIL" in l)[:240])
    ok("the Field Support Visit text, Field Support Visit, This week, monthly update, on-call and office line tests pass (fake data and a throwaway Postgres only)")
else: say("  · node or the throwaway Postgres is not on this Mac, so the tests were not re-run here (they passed when built)")
on = switch_on()
if on is None: stop("couldn't read the Hub's switches. " + why_read(), 3)
if on: stop("Field Support Visit texting is already on (Settings, PRN Teams). Turn it off first, then run this again.")
ok("Field Support Visit texting: OFF (this step does not change that)")
meta = {}
for fn in FNS:
    s_, m_ = fmeta(REF, fn)
    if s_ == 404 and fn in PUBLIC_NEW: meta[fn] = PUBLIC_NEW[fn]; continue
    if s_ != 200 or not m_ or "verify_jwt" not in m_: stop(f"couldn't read how {fn} is set up live ({s_})", 3)
    meta[fn] = bool(m_["verify_jwt"])
ok("each function's gateway setting is read, so it is kept: " + ", ".join(f"{k} {'on' if v else 'off'}" + (" (new)" if k in PUBLIC_NEW and fmeta(REF, k)[0] == 404 else "") for k, v in meta.items()))
for fn in FNS:
    okL, livef = L.live_files(REF, fn)
    if not okL: stop(f"couldn't read the live {fn} to compare", 3)
    files = sorted(k for k in L.need(FNROOT, fn) if k in CHANGED)   # the files this step changes; the rest are main as always
    is_new = all(livef.get(k) == L.sha(os.path.join(ROOT, k)) for k in files)
    older, foreign = [], []
    for k in files:
        have = livef.get(k)
        if have == L.sha(os.path.join(ROOT, k)) or (BASE and have == sha_of(BASE, k)): continue
        (older if have and have in main_versions(k) else foreign).append(k.replace("supabase/functions/", ""))
    if foreign: stop(f"{fn} live has code that was never on GitHub's main ({', '.join(foreign)}): someone else's work may be live. Tell Claude before going on.", 3)
    ok(f"{fn} live is " + ("already this build (an earlier run)" if is_new else "GitHub's main" + (f", with an older main copy of {', '.join(older)} that this step brings up to date" if older else ", the build this one builds on")))
K = keys(); ANON = K.get("anon", ""); L.HIDE += [ANON, K.get("service_role", "")]
if not ANON: stop("couldn't read the Hub's keys", 3)

say(); say("PART 2 · CHANGE")
okQ, r = sql(REF, "begin;\n" + open(os.path.join(ROOT, "prn_fsv_texts.sql")).read() + "\ncommit;")
if not okQ: bad("the record change didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Tell Claude."); done(6)
ok("Field Support Visit texts have their record (once per PRN CNA per visit, kept as sent)")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, meta[fn]): say(f"  STOP at {fn}. Tell Claude. (The switch is off; nothing is texted.)"); done(6)

say(); say("PART 3 · PROOF (nothing is sent or saved)")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
A = {"apikey": ANON, "Authorization": "Bearer " + ANON}
for act in ("mentor_list", "mentor_text"):
    s1 = http("POST", f"{FNB}/functions/v1/prn-week", {"action": act, "id": 1}, A)[0]
    (ok if s1 in (401, 403) else bad)(f"prn-week {act} refuses anyone not signed in to the office ({s1})")
okT, tt = sql(REF, "select (select count(*) from information_schema.tables where table_schema='public' and table_name='prn_mentor_texts')::int t, "
                   "(select count(*) from pg_trigger where tgname = 'prn_mentor_texts_kept')::int g, "
                   "(select count(*) from public.prn_mentor_texts)::int n")
(ok if okT and tt and tt[0]["t"] == 1 and tt[0]["g"] == 1 else bad)(f"the texts' record is there and kept as sent ({tt[0]['n'] if okT and tt else '?'} texts so far)")
(ok if switch_on() is False else bad)("the texting switch is still off")
say()
say("  1220: " + ("DONE. Field Support Visit texts are on the server with the switch OFF. Next: Claude merges the Hub pull request "
    "(the new Field Support Visits tab), then you turn texting on in Settings, PRN Teams when you're ready."
    if not L.fails else "NOT COMPLETE. See the ✗ lines above. Tell Claude."))
done(0 if not L.fails else 1)
