#!/usr/bin/env python3
# 622 · THE NEW INTERVIEW (Samantha 2026-10-12, "yes to all, build it"). Two things, all or nothing per part:
#   1. Installs the interview questions (interview_v2_622.sql): the six approved open questions, readable with a Hub
#      sign-in, editable by office staff only. Safe to re-run; questions edited in the Hub are never overwritten.
#   2. Deploys interview-messages: the booking confirmation email's "What to expect" now says "We may ask if we can
#      record our conversation so we can listen instead of taking notes." (her approved line). Nothing else changes.
# Replaced only when the live copy is main's build or an older version of it. Nothing is sent; no applicant record changes.
import os, json, subprocess, hashlib
os.environ.setdefault("SB_STEP", "622")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FN = "interview-messages"
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
start("THE NEW INTERVIEW")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
ok, r = sql(REF, "select to_regclass('public.interview_questions') is not null as t, to_regprocedure('public.desk_hub_ok()') is not null as h, to_regprocedure('public.hub_office_ok()') is not null as o")
if not ok: bad("could not read the project: " + str(r)); done(3)
x = r[0]
say(f"  · the interview questions table: {'there already' if x['t'] else 'not there yet (it will be created)'}")
say(f"  {'✓' if x['h'] and x['o'] else '✗'} the Hub sign-in checks it relies on (desk_hub_ok, hub_office_ok)")
if not (x["h"] and x["o"]): bad("a Hub sign-in check is missing; tell Claude")
if x["t"]:
    ok, r = sql(REF, "select count(*)::int as n, count(*) filter (where seeded_as like 'v2-%')::int as v2 from public.interview_questions")
    if ok and r: say(f"  · questions now: {r[0]['n']} ({r[0]['v2']} of the new six)")
sx, mx = fmeta(REF, FN); VJ = None
if sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool):
    VJ = mx["verify_jwt"]; okl, livef = live_files(REF, FN)
    differ = [k for k in need(FNROOT, FN) if livef.get(k) != sha(os.path.join(ROOT, k))] if okl else []
    unknown = [k for k in differ if livef.get(k) is not None and not in_history(k, livef.get(k))]
    if not okl: bad("could not read interview-messages' live files")
    elif unknown: bad(f"interview-messages' live copy holds {', '.join(unknown[:3])} in a version that was never on main (someone's unmerged work). Tell Claude.")
    else: say(f"  ✓ interview-messages is live at version {mx.get('version', '?')}" + (f": brought up to main ({', '.join(k.split('/')[-1] for k in differ[:4])})" if differ else ": already this build"))
else: bad(f"interview-messages is not live or unreadable: {sx}")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
ok, r = sql(REF, open(os.path.join(ROOT, "interview_v2_622.sql")).read())
if not ok: bad("the questions did not go in (undone as a whole, nothing changed): " + str(r)); done(6)
say("  ✓ the interview questions are installed")
if not deploy(REF, FNROOT, FN, VJ): say("  RESULT: the questions are in, but interview-messages did not deploy. Tell Claude."); done(6)

say(); say("PART 3 · PROOF (nothing is sent)")
ok, r = sql(REF, """select count(*) filter (where seeded_as like 'v2-%' and active)::int as v2, count(*) filter (where rubric is not null and seeded_as like 'v2-%')::int as scored,
  (select count(*)::int from pg_policies where tablename = 'interview_questions' and qual ilike '%true%' and qual not ilike '%hub%') as open_pol,
  (select count(*)::int from pg_policies where tablename = 'interview_questions') as pol,
  has_table_privilege('anon', 'public.interview_questions', 'select') as anon_read from public.interview_questions""")
if ok and r:
    y = r[0]
    say(("  ✓ " if y["v2"] == 6 else "  ✗ ") + f"the six new questions are there ({y['v2']}), with no scores ({y['scored']} scored)")
    say(("  ✓ " if y["pol"] == 2 and y["open_pol"] == 0 else "  ✗ ") + f"protected by the Hub sign-in checks ({y['pol']} rules, {y['open_pol']} open to anyone signed in)")
    say(("  ✓ " if not y["anon_read"] else "  ✗ ") + "nobody signed out can read them")
    if y["v2"] != 6 or y["pol"] != 2 or y["open_pol"] or y["anon_read"]: fails.append("proof")
else: bad("could not check: " + str(r))
okl, livef = live_files(REF, FN)
say("  ✓ interview-messages is live with the recording line") if okl and all(livef.get(k) == sha(os.path.join(ROOT, k)) for k in need(FNROOT, FN)) else bad("interview-messages' live copy is not this build")
say("  · tested before deploying: the questions (install twice, 6 rows, no scores, signed-out refused, Hub sign-in reads, only office staff change them) and the applicant words (69 checks).")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the new interview questions are in the Hub, and the confirmation email mentions recording. Nothing was sent."); done(0)
