#!/usr/bin/env python3
# 825 · FAMILY APP: FLEXIBLE BOOKING + CAREGIVER OFFERS. Samantha 2026-10-16: "Approve the family app flexible booking plan as
# recommended: caregiver yes goes straight on the schedule, picks get 4 hours first, office card if unfilled 24 hours before or
# everyone asked, families see who and when in the app only."
#  1. family_app_flex.sql: flexible bookings (a window + how long), the family's picks, family_offers, the booking days and
#     hours per state (Missouri any day 7-6, Oklahoma Mon-Fri 8-6), the offer settings with family_offer_live OFF, and the
#     app's old $5 short-visit extra removed (her rule 2026-10-16: none in the app).
#  2. Deploys family-gateway (the family door), family-app-office (the office) and the new family-offer (caregiver offers).
#  3. family-offer checks every 10 minutes (cron). With the switch OFF, and while the app is in practice mode, it sends nothing.
#  4. Publishes the reviewed family app (calendar, set time or flexible, who would you like) to family.mo-care.com.
#  5. Proves it: the live doors answer as built, a forged offer link gets nothing, the site serves the new app.
# Turns NOTHING on: family_app_live (practice mode) and family_offer_live stay as they are; you turn offers on on the Admin page.
# Never texts or emails anyone. Safe to run again.
import json, os, re, subprocess, shutil, tempfile, time
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, MG, sql, lit, sha, deploy, start, check_build

HUB = "zngsgedlsxinbygwmxwn"; FAM_NAME = "cc-family-app"; OWNER_REPO = "cc16485/cc-family-app"
DOMAIN = "family.mo-care.com"; APP = f"https://{DOMAIN}"
FNROOT = L.FNROOT; ROOT = L.ROOT; API = L.API
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
SITE = os.environ.get("SB_SITE_REPO", ""); SITE_PIN = os.environ.get("SB_SITE_PIN", "")
GH = os.environ.get("SB_GH", "gh"); NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB}.supabase.co")
LIVE = os.environ.get("SB_LIVE_BASE", APP); OFFER_PAGE = os.environ.get("SB_OFFER_PAGE", "https://cc.mo-care.com/visit-offer.html")
REMOTE = os.environ.get("SB_GIT_REMOTE", f"https://github.com/{OWNER_REPO}.git")
WAIT = float(os.environ.get("SB_WAIT", "600")); POLL = float(os.environ.get("SB_POLL", "15"))
JOB = "family-offer"; SCHEDULE = "*/10 * * * *"; VAULT_NAME = "hub_job_secret"
FNS = [("family-gateway", False), ("family-app-office", True), ("family-offer", False)]
ok = lambda s: say("  ✓ " + s)
def chk(good, msg, badmsg=None): (ok(msg) if good else bad(badmsg or msg))
def run(args, cwd=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def keys(ref):
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_publishable_") or v.startswith("sb_secret_")) and "·" not in v and "*" not in v
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{ref}/api-keys{q}", headers=MG())
        if s != 200: continue
        try: arr = json.loads(b)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        got = {k.get("name"): k.get("api_key", "") for k in arr if isinstance(k, dict) and usable(k.get("api_key", ""))}
        if got.get("anon"): return got
    return {}
def cron_command(url, anon):
    return ("select net.http_post(url := " + lit(url) + ", headers := jsonb_build_object('Content-Type', 'application/json', "
            "'Authorization', " + lit("Bearer " + anon) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")), "
            "body := '{}'::jsonb, timeout_milliseconds := 120000);")

start("FAMILY APP: FLEXIBLE BOOKING + CAREGIVER OFFERS")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
# Run only once it is merged: every file these three doors use must match GitHub's main exactly, so nobody's newer work is undone.
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")   # rehearsals point this at the rehearsal copy's own commit
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = []
for fn, _ in FNS:
    for k in sorted(L.need(FNROOT, fn)):
        c2, b2 = run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"])
        if c2 != 0 or b2 != open(os.path.join(ROOT, k)).read(): drift.append(k)
for k in ("family_app_flex.sql",):
    c2, b2 = run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"])
    if c2 != 0 or b2 != open(os.path.join(ROOT, k)).read(): drift.append(k)
if drift: bad("this isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(sorted(set(drift)))[:240] + ")"); say("  STOP. Nothing was changed."); done(2)
ok("the reviewed build is what is on GitHub's main")
if NODE:
    for t in ("family_app_flex_test.mjs", "family_app_1a_test.mjs"):
        p = subprocess.run([NODE, t], cwd=ROOT, capture_output=True, text=True)
        last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
        if p.returncode != 0: bad(f"{t} failed: {last}"); say("  STOP. Nothing was changed."); done(2)
        ok(f"{t}: {last.strip()} (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
good, r = sql(HUB, f"select to_regclass('public.family_bookings') is not null as tbl, coalesce((select data->>'family_app_live' from app_data where key = 'ops_settings'), 'not set') as live, coalesce((select data->>'family_offer_live' from app_data where key = 'ops_settings'), 'not set') as offers, (select count(*) from vault.decrypted_secrets where name = {lit(VAULT_NAME)})::int as vault")
if not good or not r: bad(f"couldn't read the Hub ({str(r)[:160]}). Nothing was changed."); done(3)
r = r[0]
if not r["tbl"]: bad("family_bookings isn't there (801 first). Nothing was changed."); done(3)
if r["vault"] != 1: bad("the jobs' secret isn't in the vault. Nothing was changed."); done(3)
say(f"  · the family app is {'LIVE' if r['live'] == 'true' else 'in PRACTICE mode'}; caregiver offers are {'ON' if r['offers'] == 'true' else 'OFF'} (both stay as they are)")
K = keys(HUB); ANON, SERVICE = K.get("anon", ""), K.get("service_role", ""); L.HIDE += [ANON, SERVICE]
if not ANON or not SERVICE: bad("couldn't read the Hub's keys. Nothing was changed."); done(3)
c, o = run(["git", "-C", SITE, "cat-file", "-e", SITE_PIN + "^{commit}"])
if c != 0: bad("the reviewed app version isn't on this Mac. Nothing was changed."); done(2)
c, o = run([GH, "auth", "status"])
if c != 0: bad("GitHub isn't signed in on this Mac (gh auth status). Nothing was changed."); done(2)
s, b = http("GET", f"{API}/v1/projects", headers=MG())
fam = next((x for x in (json.loads(b) if s == 200 else []) if x.get("name") == FAM_NAME), None)
if not fam: bad(f"{FAM_NAME} not found. Nothing was changed."); done(2)
FREF = fam.get("id") or fam.get("ref"); FK = keys(FREF); FANON = FK.get("anon", ""); L.HIDE.append(FANON)
if not FANON: bad("couldn't read the family app's public sign-in key. Nothing was changed."); done(2)
ok("the app version, GitHub sign-in and the family app's public key")

say(); say("PART 2 · CHANGE")
say("1 · THE DATABASE")
good, r = sql(HUB, open(os.path.join(ROOT, "family_app_flex.sql")).read())
if not good: bad("the database change was refused: " + str(r)[:300]); say("  STOP. Nothing was changed (it runs as one transaction)."); done(4)
good, r = sql(HUB, "select (select count(*) from information_schema.columns where table_name = 'family_bookings' and column_name in ('kind','window_start','window_end','preferred_caregiver_ids','offer_stage','offer_next_at','unfilled_card_at'))::int as cols, "
    "to_regclass('public.family_offers') is not null as offers, (select data->>'family_app_open_MO' from app_data where key = 'ops_settings') as mo_open, "
    "(select data->>'family_app_days_OK' from app_data where key = 'ops_settings') as ok_days, (select data->>'family_offer_live' from app_data where key = 'ops_settings') as offers_live, "
    "(select data ? 'family_app_short_extra_MO' from app_data where key = 'ops_settings') as extra")
r = (r or [{}])[0] if good else {}
chk(r.get("cols") == 7 and r.get("offers") is True, "flexible bookings, the family's picks and the offers table are in")
chk(r.get("mo_open") is not None and r.get("ok_days") is not None, f"booking hours: Missouri opens {r.get('mo_open')}, Oklahoma days {r.get('ok_days')} (0 = Sunday)")
say(f"  · caregiver offers: {'ON' if r.get('offers_live') == 'true' else 'OFF'} · app short-visit extra: {'still set (you changed it yourself, so it was kept)' if r.get('extra') else 'none'}")
if L.fails: say("  STOP. Tell Claude."); done(4)

say(); say("2 · THE THREE DOORS")
for fn, vj in FNS:
    if not deploy(HUB, FNROOT, fn, vj): say("  STOP. Tell Claude. (Anything above this line is in; the rest is unchanged.)"); done(5)

say(); say("3 · THE 10-MINUTE CHECK")
sql(HUB, f"select cron.unschedule({lit(JOB)}) where exists (select 1 from cron.job where jobname = {lit(JOB)})")
good, r = sql(HUB, f"select cron.schedule({lit(JOB)}, {lit(SCHEDULE)}, {lit(cron_command(FNB + '/functions/v1/family-offer', ANON))}) as id")
good2, jb = sql(HUB, f"select schedule, command from cron.job where jobname = {lit(JOB)}")
chk(good and good2 and jb and jb[0]["schedule"] == SCHEDULE and "x-cron-secret" in jb[0]["command"], "family-offer checks every 10 minutes (switched off, it sends nothing)")

say(); say("4 · THE APP SITE")
tmp = tempfile.mkdtemp(prefix="cc825-"); site = os.path.join(tmp, "site"); os.makedirs(site)
c, o = run(["sh", "-c", f'git -C "{SITE}" archive {SITE_PIN} | tar -x -C "{site}"'])
if c != 0 or not os.path.exists(os.path.join(site, "app.js")): bad("couldn't read the app version"); done(6)
open(os.path.join(site, "config.js"), "w").write("/* Caring Companions family app settings. The sign-in key here is the public one (safe to publish by design). */\n"
    "window.CC_CONFIG = " + json.dumps({"familyUrl": f"https://{FREF}.supabase.co", "familyAnon": FANON, "gateway": f"{FNB}/functions/v1/family-gateway", "billingUrl": None}) + "\n")
open(os.path.join(site, "CNAME"), "w").write(DOMAIN + "\n"); open(os.path.join(site, ".nojekyll"), "w").write("")
pub = os.path.join(tmp, "pub")
c, o = run(["git", "clone", "-q", REMOTE, pub])
if c != 0: bad(f"couldn't read the published app from GitHub: {o[-200:]}"); done(6)
for name in os.listdir(pub):
    if name != ".git": (shutil.rmtree if os.path.isdir(os.path.join(pub, name)) else os.remove)(os.path.join(pub, name))
for name in os.listdir(site):
    src = os.path.join(site, name); (shutil.copytree(src, os.path.join(pub, name)) if os.path.isdir(src) else shutil.copy2(src, os.path.join(pub, name)))
run(["git", "add", "-A"], cwd=pub)
c, o = run(["git", "-c", "user.name=cc16485", "-c", "user.email=samantha@mo-care.com", "commit", "-q", "-m", f"Publish family app {SITE_PIN[:7]} (825)"], cwd=pub)
nothing = "nothing to commit" in o
c, o = run(["git", "push", "-q", "origin", "HEAD:main"], cwd=pub)
chk(c == 0, "app published to GitHub" + (" (no changes since last time)" if nothing else ""), f"push refused: {o[-200:]}")
want_js = sha(os.path.join(site, "app.js"))
shutil.rmtree(tmp, ignore_errors=True)

say(); say("PART 3 · PROOF")
s, b = http("POST", f"{FNB}/functions/v1/family-offer", {})
chk(s == 401, "family-offer: a caller with no key gets nothing (401)", f"family-offer answered a stranger ({s})")
s, b = http("POST", f"{FNB}/functions/v1/family-offer", {"o": "00000000-0000-0000-0000-000000000000", "e": int(time.time()) + 3600, "t": "A" * 43})
chk(s == 403, "family-offer: a forged offer link gets nothing (403)", f"a forged link was not refused ({s})")
s, b = http("POST", f"{FNB}/functions/v1/family-offer?dry=1", {}, {"Authorization": "Bearer " + SERVICE, "apikey": SERVICE})
try: d = json.loads(b)
except Exception: d = {}
chk(s == 200 and d.get("ok") is True and (d.get("live") is False or d.get("held")), "family-offer dry run answers and sends nothing" + (f" ({d.get('held')})" if d.get("held") else f" ({d.get('bookings', 0)} bookings looked at)"), f"family-offer dry run: {s} {b[:200]}")
s, b = http("OPTIONS", f"{FNB}/functions/v1/family-gateway", headers={"Origin": APP, "Access-Control-Request-Method": "POST"})
chk(s == 200, "the app's address may still call the family door")
s, b = http("GET", OFFER_PAGE)
chk(s == 200 and "family-offer" in (b or ""), "cc.mo-care.com/visit-offer.html is up (the caregiver's link)", f"the caregiver's offer page isn't up yet ({s}): merge the Care Coordinator Hub pull request, then run 825 again")
say("  Waiting for GitHub to put the new app up (usually 1 to 5 minutes)…")
t0 = time.time(); live = False
while time.time() - t0 < WAIT:
    s, b = http("GET", f"{LIVE}/app.js?t={int(time.time())}", timeout=20)
    if s == 200 and L.hashlib.sha256((b or "").encode()).hexdigest() == want_js: live = True; break
    time.sleep(POLL)
chk(live, f"{DOMAIN} serves the new booking screens", f"{DOMAIN} doesn't show the new app yet; GitHub can be slow. Run 825 again in a few minutes (it changes nothing twice)")
say()
say("  825: " + ("DONE. Families can pick a date, a set time or a flexible window, and who they'd like. Nothing is switched on: offers stay OFF until you turn on \"Family app bookings: offer to caregivers\" on the Admin page." if not L.fails else "NOT COMPLETE. See the ✗ lines above."))
done(0 if not L.fails else 1)
