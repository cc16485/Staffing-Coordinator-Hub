#!/usr/bin/env python3
# 411 · CAREGIVER PROFILE, PART 2 SLICE 2C: A NEW HIRE ISN'T CLEARED FOR THEIR FIRST SHIFT UNTIL THEIR PROFILE IS PUBLISHED.
# Samantha 2026-10-01: "must have profile before can start work. The video is encouraged, the photo is required."
# The change itself is all in the Hub (cc-hub-live, branch caregiver-profile-2c). One of the Hub files it edits is
# eligibility-rules.js, which the server's eligibility sweep and obligations runner also download and run, but ONLY a
# version Samantha approved (G2: its fingerprint must be in public.rules_approved). So this step approves the new
# version BEFORE the Hub change merges; otherwise those two jobs would refuse the new file from the moment it is live.
# The previous version stays approved (newest two kept), so the server keeps running the file that is live today, and
# undoing the Hub change never stops the server.
# No function is deployed. No setting is changed (the sweep stays DRY: eligibility_sweep_live is only READ and
# reported). Nothing is sent. The new rule needs a field only the Hub fills (profile_published), so the server jobs,
# which never fill it, decide exactly as before.
# Part 1 (read only): the pinned fingerprint is the reviewed build (and, if the Hub file is given, it matches); the
#   approved list exists; what cc.mo-care.com serves today and whether that is approved.
# Part 2: add the new fingerprint (keeping the newest two per file, never trimming the version that is live today).
# Part 3 (proof): new version approved and newest; today's live version still approved; the Hub and public keys still
#   cannot see the list; the sweep is still DRY.
import json, os, re, hashlib, urllib.request, urllib.error, datetime as dt, sys
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn"); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
FILE = "eligibility-rules.js"
RULES_SHA = "080fd19874165eaee812189efbb5cb909acf8912684afa6b2e3bf95e0ff505e5"   # the reviewed 2c build of eligibility-rules.js
PIN = os.environ.get("SB_RULES_SHA", "")
HUB_FILE = os.environ.get("SB_HUB_FILE", "")                                     # optional: the Hub's file at the reviewed commit
SERVED = os.environ.get("SB_SERVED_URL", "https://cc.mo-care.com/" + FILE)
NOTE = "411 caregiver profile 2c: profile needed before first shift (new hires)"
lines = []; fails = []
def say(s=""):
    s = str(s); s = re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", s); s = re.sub(r"[\w.%+\-]+@[\w.\-]+\.[A-Za-z]{2,}", "(an email)", s)
    print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Anything done above stays done; nothing after it ran. Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=60, raw=False):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-profile411/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: b = r.read(); return r.status, (b if raw else b.decode(errors="replace"))
    except urllib.error.HTTPError as e: return e.code, (e.read() if raw else e.read().decode(errors="replace"))
    except Exception as e: return None, type(e).__name__
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, {"Authorization": "Bearer " + TOKEN})
    if s not in (200, 201): return False, f"HTTP {s}: {str(b)[:300]}"
    try: return True, json.loads(b)
    except Exception: return False, str(b)[:200]
lit = lambda v: "'" + str(v).replace("'", "''") + "'"
short = lambda h: (h or "?")[:12]

say("411 · CAREGIVER PROFILE 2C (PROFILE NEEDED BEFORE FIRST SHIFT): APPROVE THE NEW ELIGIBILITY RULES")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if PIN != RULES_SHA: bad("the fingerprint in this step is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
if HUB_FILE:
    if not os.path.exists(HUB_FILE) or hashlib.sha256(open(HUB_FILE, "rb").read()).hexdigest() != RULES_SHA:
        bad("the Hub's eligibility-rules.js is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
    say(f"  ✓ the Hub's eligibility-rules.js is the reviewed build ({short(RULES_SHA)})")
else: say(f"  ✓ the fingerprint is the reviewed build ({short(RULES_SHA)})")
ok, r = sql("select to_regclass('public.rules_approved') is not null as t")
if not ok or not r or not r[0]["t"]: bad("the approved-rules list doesn't exist (G2, Desktop 345, first). Nothing was changed."); done(3)
ok, before = sql(f"select sha256, approved_at from public.rules_approved where file = {lit(FILE)} order by approved_at desc")
if not ok: bad("couldn't read the approved-rules list. Nothing was changed. Tell Claude: " + str(before)[:160]); done(3)
say(f"  ✓ {len(before)} approved version(s) of {FILE} today: " + (", ".join(short(x["sha256"]) for x in before) or "none"))
s_, body = http("GET", SERVED + "?v=411" + str(int(dt.datetime.now().timestamp())), headers={"Accept": "application/javascript"}, raw=True)
live = hashlib.sha256(body).hexdigest() if s_ == 200 and isinstance(body, (bytes, bytearray)) else None
if not live: bad(f"couldn't download what cc.mo-care.com serves today ({s_}). Nothing was changed. Try again later."); done(3)
live_ok = any(x["sha256"] == live for x in before)
if live == RULES_SHA: say(f"  · cc.mo-care.com already serves the 2c build ({short(live)}), so the Hub change is already merged")
else: say(f"  ✓ cc.mo-care.com serves {short(live)} today" + (" (approved, so the server runs it)" if live_ok else ""))
if not live_ok and live != RULES_SHA:
    say(f"  · today's live version is NOT on the approved list, so the sweep is already refusing it; this step does not change that")
ok, st = sql("select coalesce((select (data->>'eligibility_sweep_live') from app_data where key = 'ops_settings'), 'not set') as v")
sweep_before = (st[0]["v"] if ok and st else "?")
say(f"  ✓ eligibility sweep live switch reads: {sweep_before} (only read; this step never changes it)")
if str(sweep_before).lower() == "true": bad("the eligibility sweep switch reads ON. It is meant to stay OFF. Nothing was changed. Tell Claude."); done(4)

say(); say("PART 2 · CHANGE (one row added to the approved list)")
ok, _ = sql(f"insert into public.rules_approved (file, sha256, note) values ({lit(FILE)}, {lit(RULES_SHA)}, {lit(NOTE)}) "
            f"on conflict (file, sha256) do update set approved_at = now(), note = excluded.note")
if not ok: bad("the new version could not be approved. Don't merge the Hub change. Tell Claude."); done(6)
say(f"  ✓ {FILE} {short(RULES_SHA)} approved")
ok, rows = sql(f"select sha256, approved_at from public.rules_approved where file = {lit(FILE)} order by approved_at desc")
keep = [x["sha256"] for x in (rows or [])[:2]] if ok else []
if ok and len(rows) > 2:
    if live and live != RULES_SHA and live not in keep:
        say("  · older versions left on the list, because trimming to two would have dropped the version live today")
    else:
        ok2, _ = sql(f"delete from public.rules_approved where file = {lit(FILE)} and sha256 not in ({', '.join(lit(h) for h in keep)})")
        if ok2: say(f"  ✓ the list keeps the newest two ({', '.join(short(h) for h in keep)}), as every rules approval does")
        else: say("  · the older versions could not be trimmed (harmless: they simply stay approved)")

say(); say("PART 3 · PROOF (nothing is sent)")
def chk(good, msg): (say if good else bad)(("  ✓ " if good else "") + msg)
ok, rows = sql(f"select sha256 from public.rules_approved where file = {lit(FILE)} order by approved_at desc")
hs = [x["sha256"] for x in rows] if ok else []
chk(bool(hs) and hs[0] == RULES_SHA, f"the 2c build ({short(RULES_SHA)}) is approved and newest")
if live and live != RULES_SHA and live_ok: chk(live in hs, f"today's live version ({short(live)}) is still approved, so the server keeps running until the Hub change merges")
ok, pv = sql("""select has_table_privilege('anon', 'public.rules_approved', 'SELECT') or has_table_privilege('anon', 'public.rules_approved', 'INSERT')
                 or has_table_privilege('anon', 'public.rules_approved', 'UPDATE') or has_table_privilege('anon', 'public.rules_approved', 'DELETE') as anon_any,
                 has_table_privilege('authenticated', 'public.rules_approved', 'SELECT') or has_table_privilege('authenticated', 'public.rules_approved', 'INSERT')
                 or has_table_privilege('authenticated', 'public.rules_approved', 'UPDATE') or has_table_privilege('authenticated', 'public.rules_approved', 'DELETE') as auth_any""")
chk(ok and pv and not pv[0]["anon_any"] and not pv[0]["auth_any"], "the public key and Hub sign-ins still cannot see or change the approved list")
ok, st = sql("select coalesce((select (data->>'eligibility_sweep_live') from app_data where key = 'ops_settings'), 'not set') as v")
sweep_after = (st[0]["v"] if ok and st else "?")
chk(str(sweep_after).lower() != "true" and sweep_after == sweep_before, f"the eligibility sweep is still DRY (switch reads {sweep_after}, unchanged)")
say()
if fails: say("RESULT: CHECK THE ✗ LINES. Don't merge the Hub change yet. Tell Claude.")
else: say("RESULT: DONE · now merge the Hub change (cc-hub-live, caregiver-profile-2c). The server will run the new rules from its next run; they decide exactly as before for it.")
done(0 if not fails else 8)
