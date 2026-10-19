#!/usr/bin/env python3
# 997 · HR STEP 10, PIECE 1: MISSED NOTES STOP DRAFTING WRITE-UPS (Samantha 2026-10-18: "2. ok").
# Her decision 3 says coaching never becomes discipline automatically, but the missed shift notes job still made a formal
# write-up draft by itself at 3 counted misses in 30 days. From now on it doesn't: the HR agent already reads the same
# counted misses (its rule w05), so Zach sees them and decides. The old drafting stays in the code only behind
# ops_settings.missed_notes_drafts, which is off.
# Part 1 (read only): the reviewed build; the live missed-notes is exactly what Claude reviewed on 2026-10-18 (it holds
#   back a shared file on purpose, so it is NOT redeployed from GitHub).
# Part 2: missed-notes redeployed as exactly the live copy plus this one change (hr10_patches/missed-notes.diff).
# Part 3 (proof): the live copy is that; the job still runs (its schedule and the public key check); write-ups unchanged.
# Nothing is texted or emailed by this step; missed-note texts to caregivers carry on exactly as before.
import os, json, re
os.environ.setdefault("SB_STEP", "997")
from cc_step_lib import *
import subprocess, tempfile, shutil
REF = "zngsgedlsxinbygwmxwn"
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FN = "missed-notes"
HERE = os.path.dirname(os.path.abspath(__file__))
LIVE_SHAS = json.loads(os.environ.get("SB_LIVE_SHAS", "{}"))
WU_Q = "select coalesce(md5((select data::text from public.app_data where key = 'discipline_actions')), 'none') as h, (select jsonb_array_length(data) from public.app_data where key = 'discipline_actions')::int as n"
def deploy_patched(fn, verify_jwt):
    """Deploy exactly the live copy of fn plus its reviewed patch and the new shared rules file; prove the live copy is that."""
    tmp = tempfile.mkdtemp(prefix=f"cc997-{fn}-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
    try:
        d = subprocess.run([SUPA, "functions", "download", fn, "--project-ref", REF, "--use-api"], cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
        if d.returncode != 0: bad(f"{fn}: the live copy could not be downloaded to patch"); return False
        here = {k: v for k, v in {os.path.relpath(os.path.join(r_, f), tmp).replace(os.sep, "/"): sha(os.path.join(r_, f)) for r_, _, fs in os.walk(os.path.join(tmp, "supabase")) for f in fs}.items() if "/functions/" in k}
        if here != LIVE_SHAS.get(fn): bad(f"{fn}: the live copy changed while this ran, so it was not replaced"); return False
        a = subprocess.run(["git", "apply", os.path.join(HERE, "hr10_patches", fn + ".diff")], cwd=tmp, capture_output=True, text=True)
        if a.returncode != 0:
            subprocess.run(["git", "init", "-q"], cwd=tmp); a = subprocess.run(["git", "apply", os.path.join(HERE, "hr10_patches", fn + ".diff")], cwd=tmp, capture_output=True, text=True)
        if a.returncode != 0: bad(f"{fn}: the privacy change did not apply to the live copy: {a.stderr[-160:]}"); return False
        want = {k: v for k, v in {os.path.relpath(os.path.join(r_, f), tmp).replace(os.sep, "/"): sha(os.path.join(r_, f)) for r_, _, fs in os.walk(os.path.join(tmp, "supabase")) for f in fs}.items() if "/functions/" in k}
        p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"] + ([] if verify_jwt else ["--no-verify-jwt"]), cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
        okd, livef = live_files(REF, fn)
        if p.returncode != 0 or not okd or any(livef.get(k) != v for k, v in want.items()): bad(f"{fn} did not deploy cleanly: " + (p.stderr or p.stdout)[-200:]); return False
        sN, mN = fmeta(REF, fn)
        if (mN or {}).get("verify_jwt") != verify_jwt: bad(f"{fn}: the gateway setting changed"); return False
        say(f"  ✓ {fn}: the live copy plus only the privacy check (version {(mN or {}).get('version', '?')}, gateway sign-in check {'on' if verify_jwt else 'off'})"); return True
    finally: shutil.rmtree(tmp, ignore_errors=True)

start("MISSED NOTES STOP DRAFTING WRITE-UPS")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
ok, st = sql(REF, "select coalesce((select data->>'missed_notes_drafts' from public.app_data where key = 'ops_settings'), '') as drafts, coalesce((select data->>'missed_notes_live' from public.app_data where key = 'ops_settings'), '') as live")
if not ok or not st: bad(f"could not read the database: {st}")
elif st[0]["drafts"] == "true": bad("ops_settings.missed_notes_drafts is on; this step expects the drafting to stop. Tell Claude.")
else: say(f"  ✓ missed-note texts are {'live' if st[0]['live'] == 'true' else 'in practice'} (unchanged by this step)")
ok, wb = sql(REF, WU_Q); WU_BEFORE = wb[0] if ok and wb else None
if not WU_BEFORE: bad("could not read the write-ups to compare after")
sF, mF = fmeta(REF, FN); GATE = bool((mF or {}).get("verify_jwt"))
if sF != 200: bad("missed-notes is not live")
else:
    okL, livef = live_files(REF, FN)
    if not okL: bad("could not read the live missed-notes")
    elif livef != LIVE_SHAS: bad(f"the live missed-notes is not what Claude reviewed ({len(set(livef.items()) ^ set(LIVE_SHAS.items()))} difference(s)), so it was not replaced. Tell Claude.")
    else: say(f"  ✓ the live missed-notes is exactly what Claude reviewed (gateway sign-in check {'on' if GATE else 'off'}, kept)")
say("  · what changes: missed-notes stops drafting write-ups. Nothing else in it changes; no switch is turned on.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
if not deploy_patched(FN, GATE): say("  RESULT: STOPPED. Nothing else changed. Tell Claude."); done(6)
say(); say("PART 3 · PROOF")
a1 = http("POST", f"{FNB}/functions/v1/{FN}?auth_check=1", {}, {})[0]
say(f"  ✓ missed-notes still refuses a call with no key ({a1})") if a1 in (401, 403) else bad(f"missed-notes answered a call with no key: {a1}")
ok, jb = sql(REF, "select count(*)::int as n from cron.job where command like '%missed-notes%'")
say("  ✓ its 5-minute schedule is still in place") if ok and jb and jb[0]["n"] >= 1 else bad("its schedule is missing")
ok, wa = sql(REF, WU_Q)
say(f"  ✓ every write-up is exactly as before ({wa[0]['n']})") if ok and wa and WU_BEFORE and wa[0]["h"] == WU_BEFORE["h"] else bad("the write-ups changed during this step")
say("  · tested before this ran: the missed-notes tests (52 checks, both ways), this step against a local copy (see hr10_997_test.py).")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE. Tell Claude."); done(9)
say("RESULT: DONE · Missed notes no longer draft write-ups; the HR agent sees them and Zach decides. Tell Claude.")
say("Undo: set ops_settings.missed_notes_drafts to true (Claude can), or redeploy the copy from before.")
done(0)
