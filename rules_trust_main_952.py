#!/usr/bin/env python3
# 952 · RULES FILES: GITHUB MAIN IS THE APPROVAL (Samantha 2026-10-18: "we don't need the fingerprint anymore"; her pick:
# auto-trust GitHub main). The server jobs that run a rules file from cc.mo-care.com still check it before a line runs, but
# a version that is exactly GitHub main's copy is now trusted on its own and recorded, so no more "approve the new rules"
# Desktop steps. Still refused: a file GitHub main does not have (a tampered site or domain).
#  Redeploys the twelve jobs that carry _shared/approved-rules.ts (gateway setting kept), each only if its live copy is
#  work that is on GitHub main (nobody's newer work is undone), and removes rules_fingerprint_approved (936), which only
#  the retired PR check used. No other database change. Nothing is sent.
import json, os, subprocess, hashlib
os.environ.setdefault("SB_STEP", "952")
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, sql, deploy, start, check_build, fmeta, live_files, API, MG, HIDE

REF = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FNS = ("caregiver-connect", "client-audit", "client-start-run", "eligibility-sweep", "family-gateway", "family-offer",
       "intake-import", "launch-evidence", "match-dark", "obligations-run", "promise-run", "reference-land")
CHECK = {"client-start-run": {}, "eligibility-sweep": {}, "launch-evidence": {"action": "run"}, "match-dark": {},
         "obligations-run": {}, "promise-run": {}, "reference-land": {}}
ok = lambda s: say("  ✓ " + s)
def run(args): p = subprocess.run(args, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg): bad(msg); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(2)
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")
_HIST = {}
def ever_on_main(rel):
    """every version of this file that was ever on GitHub main (a live copy deployed from an older main is fine)"""
    if rel not in _HIST:
        got = set()
        _, out = run(["git", "-C", ROOT, "log", "--format=%H", "-n", "400", MAIN, "--", rel])
        for c in out.split():
            p = subprocess.run(["git", "-C", ROOT, "show", f"{c}:{rel}"], capture_output=True)
            if p.returncode == 0: got.add(hashlib.sha256(p.stdout).hexdigest())
        _HIST[rel] = got
    return _HIST[rel]

start("RULES FILES: GITHUB MAIN IS THE APPROVAL")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
for fn in FNS:
    drift = []
    for k in sorted(L.need(FNROOT, fn)):
        c2, b2 = run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"])
        if c2 != 0 or b2 != open(os.path.join(ROOT, k)).read(): drift.append(k)
    if drift: stop(f"{fn} isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(drift)[:240] + ")")
ok("all twelve jobs: the reviewed build is what is on GitHub's main")
gate = {}
for fn in FNS:
    s, m = fmeta(REF, fn)
    if s != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {fn} is set up live ({s})")
    gate[fn] = bool(m["verify_jwt"])
    okl, livef = live_files(REF, fn)
    if not okl: stop(f"could not download the live {fn} to compare")
    off = [k for k, v in livef.items() if v not in ever_on_main(k)]
    if off: stop(f"{fn} is live with changes that are not on GitHub ({', '.join(off)[:160]}): deploying would overwrite them")
    say(f"  · {fn}: live version {m.get('version', '?')} is work from GitHub main; gateway sign-in check {'on' if gate[fn] else 'off'} (kept)")
okR, r = sql(REF, "select to_regclass('public.rules_approved') is not null as t, (select count(*)::int from public.rules_approved) as n, to_regprocedure('public.rules_fingerprint_approved(text, text)') is not null as q")
if not okR or not r or not r[0]["t"]: stop(f"the approved rules list is missing: {r}")
say(f"  · the approved rules list has {r[0]['n']} entries (kept; new versions from GitHub main are added to it by themselves)")
say("  · the PR-check question (936) is there and will be removed" if r[0]["q"] else "  · the PR-check question (936) is already gone")
if L.fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, gate[fn]):
        say(f"  RESULT: STOPPED at {fn}. The jobs before it run the new check; the rest still run the old one (both refuse anything unapproved). Tell Claude."); done(7)
okD, rD = sql(REF, open(os.path.join(ROOT, "rules_guard_rpc_rollback.sql")).read())
if okD: ok("removed rules_fingerprint_approved (only the retired PR check asked it)")
else: bad(f"could not remove rules_fingerprint_approved: {rD}")

say(); say("PART 3 · PROOF (nothing is run for real, nothing is sent)")
sK, bK = http("GET", f"{API}/v1/projects/{REF}/api-keys?reveal=true", headers=MG())
SVC = ""
try: SVC = next((k.get("api_key", "") for k in json.loads(bK) if isinstance(k, dict) and k.get("name") == "service_role"), "") if sK == 200 else ""
except Exception: SVC = ""
HIDE.append(SVC)
if not SVC.startswith(("eyJ", "sb_secret_")): bad("couldn't read the server key, so the jobs weren't asked (the deploys above are in)")
else:
    H = {"Authorization": "Bearer " + SVC, "apikey": SVC}
    for fn, body in CHECK.items():
        s, b = http("POST", f"{FNB}/functions/v1/{fn}?rules_check=1", body, H)
        try: d = json.loads(b)
        except Exception: d = {}
        if s == 200 and d.get("all_approved") is True: ok(f"{fn} accepts the rules it runs today")
        else: bad(f"{fn} rules check: {s} {str(d)[:200]}")
okQ, q = sql(REF, "select to_regprocedure('public.rules_fingerprint_approved(text, text)') is null as gone")
ok("the PR-check question is gone") if okQ and q and q[0]["gone"] else bad(f"the PR-check question is still there: {q}")
say("  · tested before deploying: a never-approved file that is exactly GitHub main's copy runs and is recorded once; one changed")
say("    line (not on main) never runs; GitHub not answering refuses and the next run tries again (306 checks across the jobs).")
say()
if L.fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · no more 'approve the new rules' steps. Claude takes the PR check off the Hub next. Nothing was sent.")
say("Undo: Claude redeploys the twelve jobs from the build before 952 and reinstalls rules_guard_rpc.sql."); done(0)
