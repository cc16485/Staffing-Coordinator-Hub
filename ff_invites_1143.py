#!/usr/bin/env python3
# 1143 · STAFFING SERVER · FRIENDS & FAMILY INVITATIONS (Samantha 2026-10-27: "I approve step 4 as recommended: the wording as written,
# owners-only tab, family credit on the connected client's invoice, printed card requests emailed to me. Leave office staff out of
# caregiver invitations. Build it.")
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (fake data only); 1141's list table and
#     schedule are there; the GoHighLevel key is there.
#  2. ff_invites_send_1143.sql (the invitation record ff_invites, the card request record, the pause switch added OFF); deploys
#     ff-invite-check (its gateway setting kept) and ff-card-request (new, public: the gateway check off).
#  3. Proves it: the public can't run the check, read the records or use the owner actions; a made-up card code is refused and
#     nobody is emailed. Then, only while Invitations are OFF, today's list again (sends nothing).
# Texts and emails nobody: invitations stay OFF until Samantha turns them on in the Friends & Family tab after the preview.
import json, os, subprocess, shutil, time, hashlib
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, sql, deploy, start, check_build, lit, MG, API

REF = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
if NODE == "none": NODE = ""
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
JOB = FN = "ff-invite-check"; CARD = "ff-card-request"; VAULT_NAME = "hub_job_secret"; SQLF = "ff_invites_send_1143.sql"
POLL = float(os.environ.get("SB_POLL", "2")); POLL_MAX = float(os.environ.get("SB_POLL_MAX", "40"))
ok = lambda s: say("  ✓ " + s)
def chk(good, msg, badmsg=None): (ok(msg) if good else bad(badmsg or msg))
def run(args, cwd=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)
def keys():
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_publishable_") or v.startswith("sb_secret_")) and "·" not in v and "*" not in v
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys{q}", headers=MG())
        if s != 200: continue
        try: arr = json.loads(b)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        got = {k.get("name"): k.get("api_key", "") for k in arr if isinstance(k, dict) and usable(k.get("api_key", ""))}
        if got.get("anon"): return got
    return {}
def command(url, anon):
    return ("select net.http_post(url := " + lit(url) + ", headers := jsonb_build_object('Content-Type', 'application/json', "
            "'Authorization', " + lit("Bearer " + anon) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")), "
            "body := '{}'::jsonb, timeout_milliseconds := 290000);")

start("STAFFING SERVER · FRIENDS & FAMILY INVITATIONS (installed with Invitations OFF)")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
sqh = hashlib.sha256(open(os.path.join(ROOT, SQLF), "rb").read()).hexdigest()
if sqh != os.environ.get("SB_SQL_SHA", ""): stop("the database change is not the reviewed build")
ok("the database change is the reviewed build")
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = []
for k in sorted(L.need(FNROOT, FN) | L.need(FNROOT, CARD) | {SQLF}):
    c2, b2 = run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"])
    if c2 != 0 or b2 != open(os.path.join(ROOT, k)).read(): drift.append(k)
if drift: stop("this isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(drift)[:240] + ")")
ok("the reviewed build is what is on GitHub's main")
if NODE:
    for t, must in (("ff_invite_check_test.mjs", "121/121"), ("audience_guard_test.mjs", "21/21"), ("campaign_auto_hold_test.mjs", "8/8")):
        c, o = run([NODE, t], cwd=ROOT)
        if c != 0 or must not in o: stop(f"the tests failed ({t}): " + " ".join(l.strip() for l in o.splitlines() if "✗" in l)[:240])
    ok("the invitation, card request and campaign guard tests pass (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
s, b = http("GET", f"{API}/v1/projects/{REF}/secrets", headers=MG())
try: names = {x.get("name") for x in json.loads(b)} if s == 200 else set()
except Exception: names = set()
if "GHL_LOCATION_ID" not in names or not ({"GHL_TOKEN", "GHL_API_KEY"} & names): stop("the GoHighLevel key isn't there", 4)
ok("the GoHighLevel key is there")
okq, r = sql(REF, "select to_regclass('public.ff_invite_runs') is not null as t, (select count(*)::int from cron.job where jobname = " + lit(JOB) + ") as j")
if not okq or not r or not r[0]["t"] or r[0]["j"] != 1: stop("1141's list table or its schedule isn't there (run 1141 first)", 4)
ok("1141's list table and daily schedule are there")
s1, m1 = L.fmeta(REF, FN)
if s1 != 200 or not m1 or "verify_jwt" not in m1: stop(f"couldn't read how {FN} is set up live ({s1})", 3)
gate = bool(m1["verify_jwt"]); say(f"  · {FN} is live as version {m1.get('version', '?')}, gateway sign-in check {'on' if gate else 'off'} (kept)")
K = keys(); ANON, SVC = K.get("anon", ""), K.get("service_role", ""); L.HIDE += [ANON, SVC]
if not ANON or not SVC: stop("couldn't read the Hub's keys", 3)

say(); say("PART 2 · CHANGE")
okq, r = sql(REF, "begin;\n" + open(os.path.join(ROOT, SQLF)).read() + "\ncommit;")
if not okq: bad("the database change didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Tell Claude."); done(6)
okq, r = sql(REF, "select data->>'ff_invites_live' as live, data->>'ff_program_paused' as paused from app_data where key = 'ops_settings'")
live = bool(r and r[0]["live"] == "true")
ok("the invitation record (ff_invites) and card requests are in place · Invitations are " + ("ON" if live else "OFF") + " · paused: " + ("yes" if r and r[0]["paused"] == "true" else "no"))
if not deploy(REF, FNROOT, FN, gate): say(f"  STOP at {FN}. Tell Claude."); done(6)
if not deploy(REF, FNROOT, CARD, False): say(f"  STOP at {CARD}. Tell Claude."); done(6)
URL = f"{FNB}/functions/v1/{JOB}"; CURL = f"{FNB}/functions/v1/{CARD}"

say(); say("PART 3 · PROOF (nothing is sent)")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
a1 = http("POST", URL + "?auth_check=1", {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
chk(a1 == 401, f"the public can't run the check ({a1})")
a2 = http("POST", URL, {"action": "list"}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
chk(a2 in (401, 403), f"the public can't use the owner actions ({a2})")
for t in ("ff_invite_runs", "ff_invites", "ff_card_requests"):
    sC, bC = http("GET", f"{FNB}/rest/v1/{t}?select=*&limit=1", None, {"apikey": ANON, "Authorization": "Bearer " + ANON})
    chk(sC != 200 or bC.strip() in ("[]", ""), f"the public can't read {t} ({sC})")
sR, bR = http("POST", CURL, {"code": "ZZZZ-ZZ", "mail_to": "Proof Run", "address": "1331 N Stewart Ave, Springfield MO"}, {"apikey": ANON, "Content-Type": "application/json"})
chk(sR == 404, f"the card request door refuses a made-up code and emails nobody ({sR})")
if live:
    say("  · Invitations are already ON, so no proof run was made (it would send what is owed).")
else:
    say(); say("  Today's list again (this takes a minute: it reads AxisCare)...")
    sD, bD = http("POST", URL, {}, {"apikey": SVC, "Authorization": "Bearer " + SVC}, 300)
    try: j = json.loads(bD)
    except Exception: j = {}
    chk(sD == 200 and j.get("sent") == 0 and j.get("saved") is True, "it ran with Invitations off, saved today's list, and sent nothing", f"the run answered {sD}: {str(bD)[:200]}")
    for p in j.get("problems") or []: bad("couldn't read: " + str(p))
    rows = j.get("rows") or []; sm = j.get("summary") or {}
    if sm:
        c, f = sm.get("caregivers") or {}, sm.get("families") or {}
        say(); say("  TODAY'S LIST (who would be invited once you turn Invitations on)")
        say(f"  Caregivers: {c.get('ready', 0)} ready · {c.get('waiting', 0)} waiting · {c.get('held', 0)} held")
        say(f"  Family members: {f.get('ready', 0)} ready · {f.get('waiting', 0)} waiting · {f.get('held', 0)} held")
        say(f"  Clients with no family email on file: {sm.get('clients_without_family_email', 0)}")
        ready = [x for x in rows if x.get("status") == "ready"]
        if ready:
            say(); say(f"  READY ({len(ready)})")
            for x in sorted(ready, key=lambda x: (x.get("kind") != "caregiver", x.get("client") or "", x.get("name") or "")):
                say(f"    {'Caregiver' if x.get('kind') == 'caregiver' else 'Family'}: {x.get('name', '')}" + (f" (for {x['client']})" if x.get("kind") == "family" else "") + " · " + " and ".join(x.get("channels") or []))
        say("  The waiting and held lists, with reasons, are on the Friends & Family tab once the Hub part is merged.")
say()
say("  1143: " + ("DONE. Invitations are installed and " + ("ON." if live else "OFF: nobody was texted or emailed. Turn them on in the Friends & Family tab when the preview ends.") if not L.fails else "NOT COMPLETE. See the ✗ lines above."))
say("  Rollback: Invitations off (the tab) stops every send at once.")
done(0 if not L.fails else 1)
