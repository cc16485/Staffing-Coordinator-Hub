#!/usr/bin/env python3
# 890 · FAMILY APP RELEASE 3: SAFE MATCHING, NOTES AND HELP US FILL (2026-10-17, Samantha: "Start Release 3."; decisions 3, 4,
# 5 and 6, https://claude.ai/artifact/AS6GbybmUqC47WKPto44p8).
#  1. Checks first (nothing changes): the Hub's matching rulebook (cc.mo-care.com/match-rules.js) is an approved version, so
#     app offers can read it (if not, it STOPS: offers would pause), and the Hub pages for this release are live.
#  2. Database: the note check, Help us fill, each client's app tasks, the late-cancel billing list, and her approval of the
#     "couldn't fill" family message recorded.
#  3. Deploys family-gateway (a note asking for care extra visits don't include is stopped at Send: rules then AI, nothing
#     sent, no office task; emergency message; app tasks; Help us fill words), family-offer (matching, Help us fill handoff,
#     one card if the rulebook is unreadable, no duplicate cards) and family-app-office (Help us fill, app tasks, late billing).
#  4. Proves it: the doors refuse strangers, a dry run reads everything and sends nothing.
# Sends nothing itself. The app site is published separately right after. Safe to run again.
import json, os, subprocess, shutil, time
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, MG, sql, deploy, start, check_build, fmeta

HUB = "zngsgedlsxinbygwmxwn"; APP = "https://family.mo-care.com"
FNROOT = L.FNROOT; ROOT = L.ROOT; API = L.API
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB}.supabase.co")
FNS = ["family-gateway", "family-offer", "family-app-office"]
SQLF = "family_app_release3.sql"
HUB_SITE = os.environ.get("SB_HUB_SITE", "https://cc.mo-care.com")
ok = lambda s: say("  ✓ " + s)
def chk(good, msg, badmsg=None): (ok(msg) if good else bad(badmsg or msg))
def run(args, cwd=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)
def keys(ref):
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_secret_")) and "·" not in v and "*" not in v
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{ref}/api-keys{q}", headers=MG())
        if s != 200: continue
        try: arr = json.loads(b)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        got = {k.get("name"): k.get("api_key", "") for k in arr if isinstance(k, dict) and usable(k.get("api_key", ""))}
        if got.get("service_role"): return got
    return {}

start("FAMILY APP RELEASE 3: SAFE MATCHING, NOTES AND HELP US FILL")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
# Run only once both pull requests are merged: every file these doors use must match GitHub's main, so nobody's newer work is undone.
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")   # rehearsals point this at the rehearsal copy's own commit
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = []
for k in sorted(set().union(*[L.need(FNROOT, fn) for fn in FNS]) | {SQLF}):
    c2, b2 = run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"])
    if c2 != 0 or b2 != open(os.path.join(ROOT, k)).read(): drift.append(k)
if drift: stop("this isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(drift)[:240] + ")")
ok("the reviewed build is what is on GitHub's main")
# the Hub's rulebook as the server will read it, for the tests and the approval check
import hashlib, tempfile, urllib.request
RULES_DIR = tempfile.mkdtemp(prefix="cc890-")
rs, rb = http("GET", f"{HUB_SITE}/match-rules.js?v={int(time.time())}")
if rs != 200 or "CCMatch" not in (rb or ""): stop(f"couldn't read the Hub's matching rulebook ({rs})", 3)
open(os.path.join(RULES_DIR, "match-rules.js"), "w").write(rb)
RULES_SHA = hashlib.sha256(rb.encode()).hexdigest()
if NODE:
    for t in ("family_match_test.mjs", "family_review_test.mjs", "family_sync_test.mjs", "answer_by_test.mjs", "family_app_1a_test.mjs", "family_app_flex_test.mjs", "family_app_fee_test.mjs", "brands_test.mjs"):
        p = subprocess.run([NODE, t], cwd=ROOT, capture_output=True, text=True, env=dict(os.environ, HUB_ROOT=RULES_DIR))
        last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
        if p.returncode != 0: stop(f"{t} failed: {last}")
        ok(f"{t}: {last.strip()} (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
good, r = sql(HUB, """select to_regclass('public.family_bookings') is not null as tbl,
  coalesce((select data->>'family_app_live' from app_data where key = 'ops_settings'), 'not set') as live,
  coalesce((select data->>'family_offer_live' from app_data where key = 'ops_settings'), 'not set') as offers""")
if not good or not r: stop(f"couldn't read the Hub ({str(r)[:160]})", 3)
r = r[0]
if not r["tbl"]: stop("family_bookings isn't there (801 first)", 3)
say(f"  · the family app is {'LIVE' if r['live'] == 'true' else 'in PRACTICE mode'}; caregiver offers are {'ON' if r['offers'] == 'true' else 'OFF'} (both stay as they are)")
good, ap = sql(HUB, f"select count(*)::int as n from public.rules_approved where file = 'match-rules.js' and sha256 = '{RULES_SHA}'")
if not good or not ap: stop(f"couldn't read the approved rules list ({str(ap)[:120]})", 3)
if ap[0]["n"] < 1: stop(f"the Hub's matching rulebook (fingerprint {RULES_SHA[:12]}) is not an approved version, so app offers couldn't use it and would pause. Tell Claude", 2)
ok(f"the Hub's matching rulebook is an approved version ({RULES_SHA[:12]})")
ps, pb = http("GET", f"{HUB_SITE}/family-app-panel.js?v={int(time.time())}")
os_, ob = http("GET", f"{HUB_SITE}/visit-offer.html?v={int(time.time())}")
if ps != 200 or "lateBilled" not in (pb or ""): stop("the Hub's Family bookings panel for Release 3 isn't live yet (merge the Hub pull request, wait a minute, run again)", 2)
if os_ != 200 or "Good to know" not in (ob or ""): stop("the caregiver offer page for Release 3 isn't live yet (merge the Hub pull request, wait a minute, run again)", 2)
ok("the Hub pages for Release 3 are live (Family bookings panel, caregiver offer page)")
sk, sb = http("GET", f"{API}/v1/projects/{HUB}/secrets", headers=MG())
try: names = [x.get("name") for x in json.loads(sb)] if sk == 200 else []
except Exception: names = []
say("  · AI second opinion on family notes: " + ("the AI key is set" if "ANTHROPIC_API_KEY" in names else "NO AI key on the Hub, so the fixed rules decide alone and notes go on the office's glance list") if sk == 200 else "  · couldn't list the Hub's secret names; the AI check simply falls back to the rules if its key is missing")
gate = {}
for fn in FNS:
    s, m = fmeta(HUB, fn)
    if s != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {fn} is set up live ({s})", 3)
    gate[fn] = bool(m["verify_jwt"]); say(f"  · {fn} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if gate[fn] else 'off'} (kept)")
K = keys(HUB); SERVICE = K.get("service_role", ""); L.HIDE += [SERVICE]

say(); say("PART 2 · CHANGE")
say(); say("1 · THE DATABASE")
good, r2 = sql(HUB, open(os.path.join(ROOT, SQLF)).read())
if not good: stop(f"the database change was refused (nothing in it was kept): {str(r2)[:200]}", 4)
good, c = sql(HUB, """select (select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'family_bookings'
    and column_name in ('home_notes', 'note_check', 'note_hidden', 'hold_reason', 'held_by', 'held_at', 'reviewed_at', 'reviewed_by', 'review_decision', 'decline_reason',
      'family_declined_pending', 'family_declined_at', 'family_declined_how', 'help_fill', 'fill_task_at', 'fill_closed_by', 'unfilled_kind',
      'late_charge_hours', 'late_pay_caregiver', 'late_billed_at', 'late_billed_by')) as cols,
  (select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'care_circles' and column_name in ('app_tasks', 'help_fill')) as ccols,
  (select bool_or(pg_get_constraintdef(oid) ilike '%held%' and pg_get_constraintdef(oid) ilike '%declined%') from pg_constraint where conrelid = 'public.family_bookings'::regclass and contype = 'c') as status_ok,
  (select data->'family_couldnt_text_approved'->>'by' from app_data where key = 'ops_settings') as cf""")
c = (c or [{}])[0] if good else {}
chk(c.get("cols") == 21 and c.get("ccols") == 2 and c.get("status_ok") is True, "the request, note and Help us fill fields are in place", f"the database change didn't land as expected: {c}")
chk(c.get("cf") == "Samantha", "your approval of the couldn't-fill message is recorded", f"approval not recorded: {c}")
if L.fails: say("  STOP. The doors are unchanged. Tell Claude."); done(4)
say(); say("2 · THE DOORS")
for fn in FNS:
    if not deploy(HUB, FNROOT, fn, gate[fn]): say("  STOP. Tell Claude. (Anything above this line is in; the rest is unchanged.)"); done(5)

say(); say("PART 3 · PROOF")
s, b = http("POST", f"{FNB}/functions/v1/family-gateway", {"action": "home"})
chk(s == 401, "family-gateway: a caller with no sign-in gets nothing (401)", f"family-gateway answered a stranger ({s})")
s, b = http("OPTIONS", f"{FNB}/functions/v1/family-gateway", headers={"Origin": APP, "Access-Control-Request-Method": "POST"})
chk(s == 200, "the app's address may still call the family door", f"the app can't reach the family door ({s})")
s, b = http("POST", f"{FNB}/functions/v1/family-app-office", {"action": "list"})
chk(s in (401, 403), f"family-app-office: a caller with no Hub sign-in gets nothing ({s})", f"family-app-office answered a stranger ({s})")
s, b = http("POST", f"{FNB}/functions/v1/family-offer", {})
chk(s == 401, "family-offer: a caller with no key gets nothing (401)", f"family-offer answered a stranger ({s})")
s, b = http("POST", f"{FNB}/functions/v1/family-offer", {"o": "00000000-0000-0000-0000-000000000000", "e": int(time.time()) + 3600, "t": "A" * 43})
chk(s == 403, "family-offer: a forged offer link gets nothing (403)", f"a forged link was not refused ({s})")
if SERVICE:
    s, b = http("POST", f"{FNB}/functions/v1/family-offer?dry=1", {}, {"Authorization": "Bearer " + SERVICE, "apikey": SERVICE})
    try: d = json.loads(b)
    except Exception: d = {}
    sy = d.get("sync") if isinstance(d.get("sync"), dict) else {}
    mskip = [x for x in (d.get("skipped") or []) if "matching rules unavailable" in str(x.get("why", ""))]
    chk(s == 200 and d.get("ok") is True and not sy.get("error") and not mskip, f"dry run: {d.get('bookings', 0)} open request(s) looked at, {len(d.get('would') or [])} thing(s) it would do; nothing changed or sent", f"family-offer dry run: {s} {(b or '')[:200]}")
else: say("  · couldn't read the Hub's server key, so the dry run was skipped (the doors above are proven)")
say()
say("  890: " + ("DONE. App offers now follow the Hub's matching rules for each client (level, required gender, Spanish and dementia care, the call-in list, cats, dogs and smoking), a note asking for care extra visits don't include is stopped at Send (the family changes it or calls; nothing comes to the office), and Help us fill is ready on Family bookings (Samantha or Krystal, with a reason). Next: Claude publishes the matching app screens." if not L.fails else "NOT COMPLETE. See the ✗ lines above."))
done(0 if not L.fails else 1)
