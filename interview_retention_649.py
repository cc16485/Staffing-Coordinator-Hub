#!/usr/bin/env python3
# 649 · INTERVIEW RECORDS KEPT 2 YEARS (Samantha 2026-10-14: "2 years").
#   1. interview_retention_649.sql: keep_interview_days = 730 and the legal-hold columns. Adds only.
#   2. Deploys purge-recordings: its daily run now also clears transcripts, deletes AI reviews and removes observations
#      two years after the interview, never for someone on a legal hold. Audio stays at 1 year.
# Replaced only when the live copy is main's build or an older version of it. Nothing is deleted by this step.
# Prints counts only: no name, number, email, key or secret.
import os, json, subprocess, hashlib
os.environ.setdefault("SB_STEP", "649")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FNS = ["purge-recordings"]
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
_HIST = {}
def in_history(rel, live_sha):
    if not live_sha: return False
    if rel not in _HIST:
        shas = set()
        try:
            for c in subprocess.run(["git", "-C", ROOT, "log", "--format=%H", "--", rel], capture_output=True, text=True, timeout=120).stdout.split():
                b = subprocess.run(["git", "-C", ROOT, "show", f"{c}:{rel}"], capture_output=True, timeout=60).stdout
                if b: shas.add(hashlib.sha256(b).hexdigest())
        except Exception: pass
        _HIST[rel] = shas
    return live_sha in _HIST[rel]
def anon_key():
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_publishable_")) and "·" not in v and "*" not in v
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys{q}", headers=MG())
        if s != 200: continue
        try: arr = json.loads(b)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        for k in arr:
            if isinstance(k, dict) and k.get("name") == "anon" and usable(k.get("api_key")): return k["api_key"]
    return ""
def command(url, anon):
    return ("select net.http_post(url := " + lit(url) + ", headers := jsonb_build_object('Content-Type', 'application/json', "
            "'Authorization', " + lit("Bearer " + anon) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT) + ")), "
            "body := '{}'::jsonb, timeout_milliseconds := 120000);")
def jget(b, k):
    try: return json.loads(b).get(k)
    except Exception: return None

start("INTERVIEW RECORDS KEPT 2 YEARS")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
for f, want in json.loads(os.environ.get("SB_SQL_SHAS", "{}")).items():
    (say(f"  ✓ {f} is the reviewed build") if sha(os.path.join(ROOT, f)) == want else bad(f"{f} is not the reviewed build"))
ok, r = sql(REF, "select (select keep_audio_days from public.recordings_settings where id = 1) as audio, to_regclass('public.interview_reviews') is not null as rv, (select count(*)::int from cron.job where command ilike '%purge-recordings%') as cron")
if not ok or not r: bad("could not read the project: " + str(r)); done(3)
x = r[0]
say(f"  · audio kept today: {x['audio']} days (unchanged by this step)")
(say("  ✓ the AI review record is there (648)") if x["rv"] else bad("the AI review record is missing; run 648 first"))
(say("  ✓ the daily clean-up is scheduled") if x["cron"] >= 1 else bad("the daily clean-up (purge-recordings) is not scheduled; tell Claude"))
VJ = {}
for FN in FNS:
    sx, mx = fmeta(REF, FN)
    if sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool):
        VJ[FN] = mx["verify_jwt"]; okl, livef = live_files(REF, FN)
        differ = [k for k in need(FNROOT, FN) if livef.get(k) != sha(os.path.join(ROOT, k))] if okl else []
        unknown = [k for k in differ if livef.get(k) is not None and not in_history(k, livef.get(k))]
        if not okl: bad(f"could not read {FN}'s live files")
        elif unknown: bad(f"{FN}'s live copy holds {', '.join(unknown[:3])} in a version that was never on main (someone's unmerged work). Tell Claude.")
        else: say(f"  ✓ {FN} is live at version {mx.get('version', '?')}" + (": will be brought up to this build" if differ else ": already this build"))
    else: bad(f"{FN} is not live or unreadable: {sx}")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
ok, r = sql(REF, open(os.path.join(ROOT, "interview_retention_649.sql")).read())
if not ok: bad("the setting did not go in (nothing changed): " + str(r)); done(6)
say("  ✓ interview records are kept 730 days (2 years); a legal hold can stop it per person")
for FN in FNS:
    if not deploy(REF, FNROOT, FN, VJ[FN]): say(f"  RESULT: stopped at {FN}. Tell Claude."); done(6)

say(); say("PART 3 · PROOF (a counts-only look; nothing is deleted)")
okl, livef = live_files(REF, "purge-recordings")
say("  ✓ purge-recordings: the live copy is exactly this build") if okl and all(livef.get(k) == sha(os.path.join(ROOT, k)) for k in need(FNROOT, "purge-recordings")) else bad("purge-recordings' live copy is not this build")
ok, r = sql(REF, "select keep_audio_days as a, keep_interview_days as i from public.recordings_settings where id = 1")
(say(f"  ✓ audio {r[0]['a']} days, interview records {r[0]['i']} days") if ok and r and r[0]["i"] == 730 else bad("the 730-day setting is not there"))
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
SK = ""
s_, b_ = http("GET", f"{API}/v1/projects/{REF}/api-keys?reveal=true", headers=MG())
try:
    for k in (json.loads(b_) if s_ == 200 else []):
        if isinstance(k, dict) and k.get("name") == "service_role" and str(k.get("api_key", "")).startswith("eyJ"): SK = k["api_key"]
except Exception: pass
HIDE.append(SK)
if SK:
    s4, b4 = http("POST", f"{FNB}/functions/v1/purge-recordings?dry=1", {}, {"apikey": SK, "Authorization": "Bearer " + SK})
    try: j = json.loads(b4)
    except Exception: j = {}
    ir = j.get("interview_records") or {}
    if s4 == 200 and j.get("dry") and not ir.get("error"):
        say(f"  ✓ counts-only look: audio due {j.get('would_delete', 0)}; interview records 2+ years old: {ir.get('transcripts', 0)} transcripts, {ir.get('reviews', 0)} reviews, {ir.get('observations', 0)} observations; on hold: {ir.get('held', 0)}")
    else: bad(f"the counts-only look failed ({s4}): " + str(ir.get("error") or j.get("error") or "")[:200])
else: bad("could not read the server key for the counts-only look")
ANON = anon_key(); HIDE.append(ANON)
s5 = http("POST", f"{FNB}/functions/v1/purge-recordings?dry=1", {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
(say(f"  ✓ the public key cannot run it ({s5})") if s5 == 401 else bad(f"the public key got an answer ({s5})"))
say("  · tested before deploying (11 checks): 2+ years only, legal hold untouched, the application answers kept, dry changes nothing, 0 turns it off.")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · interview records are kept 2 years, audio 1 year; a legal hold stops it. Nothing was deleted by this step."); done(0)
