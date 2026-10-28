#!/usr/bin/env python3
# 1163 · STAFFING SERVER · SEND TO FAMILY (Samantha 2026-10-28: "Yes, build it with your picks: Billing owner enters payment
# forms, no 3-digit code unless AxisCare needs it, start with the four pieces").
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (fake data only); the keys and the
#     jobs' secret are there; who owns Billing (gets returned payment forms) and Client Care (circle changes, GUIDE calls).
#  2. Makes the payment lock key FAMILY_PAY_KEK if it isn't there (32 random bytes, a function secret: never printed, never in
#     the database); family_send.sql (3 server-only tables; the switch family_send_live added OFF); deploys family-send (office,
#     sign-in on) and family-form (the family's link, public); schedules the hourly erase.
#  3. Proof in PRACTICE (nothing texted, no card, a made-up client number): the public key gets nothing; a practice payment
#     form signs end to end and is SEALED (the number is nowhere in the clear); the hourly erase wipes it after 7 days; the
#     practice rows are removed; the switch is untouched.
# The switch stays OFF: until it is on, only Samantha and Zach can send from the Hub, to try it.
import json, os, re, subprocess, shutil, time, hashlib, base64, secrets, datetime
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, sql, deploy, start, check_build, lit, MG, API

REF = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
if NODE == "none": NODE = ""
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
JOB = "family-send"; SCHEDULE = "23 * * * *"; VAULT_NAME = "hub_job_secret"; SQLF = "family_send.sql"; KEK = "FAMILY_PAY_KEK"
PRACTICE_AX = "999999999"
ok = lambda s: say("  ✓ " + s)
def chk(good, msg, badmsg=None): (ok(msg) if good else bad(badmsg or msg))
def run(args, cwd=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)
def jload(b):
    try: return json.loads(b)
    except Exception: return {}
def keys():
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_publishable_") or v.startswith("sb_secret_")) and "·" not in v and "*" not in v
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys{q}", headers=MG())
        if s != 200: continue
        arr = jload(b)
        if isinstance(arr, dict): arr = arr.get("keys") or []
        got = {k.get("name"): k.get("api_key", "") for k in arr if isinstance(k, dict) and usable(k.get("api_key", ""))}
        if got.get("anon") and got.get("service_role"): return got
    return {}
def secret_names():
    s, b = http("GET", f"{API}/v1/projects/{REF}/secrets", headers=MG())
    return {x.get("name") for x in jload(b)} if s == 200 and isinstance(jload(b), list) else set()
def command(url, anon):
    return ("select net.http_post(url := " + lit(url) + ", headers := jsonb_build_object('Content-Type', 'application/json', "
            "'Authorization', " + lit("Bearer " + anon) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")), "
            "body := '{}'::jsonb, timeout_milliseconds := 150000);")
h256 = lambda s: hashlib.sha256(s.encode()).hexdigest()

start("STAFFING SERVER · SEND TO FAMILY (the switch stays OFF)")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
if hashlib.sha256(open(os.path.join(ROOT, SQLF), "rb").read()).hexdigest() != os.environ.get("SB_SQL_SHA", ""): stop("the database change is not the reviewed build")
ok("the database change is the reviewed build")
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = []
for k in sorted(L.need(FNROOT, "family-send") | L.need(FNROOT, "family-form") | {SQLF}):
    c2, b2 = run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"])
    if c2 != 0 or b2 != open(os.path.join(ROOT, k)).read(): drift.append(k)
if drift: stop("this isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(drift)[:240] + ")")
ok("the reviewed build is what is on GitHub's main")
if NODE:
    c, o = run([NODE, "family_send_test.mjs"], cwd=ROOT)
    if c != 0 or not re.search(r"(\d+)/\1 passed", o): stop("the tests failed: " + " ".join(l.strip() for l in o.splitlines() if "✗" in l)[:240])
    ok("the Send to family tests pass (" + re.search(r"(\d+/\d+) passed", o).group(1) + ", fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
names = secret_names()
if "HUB_JOB_SECRET" not in names or "GHL_LOCATION_ID" not in names or not ({"GHL_TOKEN", "GHL_API_KEY"} & names): stop("the jobs' secret or the GoHighLevel key isn't there", 4)
okv, v = sql(REF, f"select count(*)::int as n from vault.decrypted_secrets where name = {lit(VAULT_NAME)}")
if not okv or not v or v[0]["n"] != 1: stop("the jobs' secret isn't in the database vault", 4)
ok("the jobs' secret and the GoHighLevel key are there (their values are never read)")
say(f"  · the payment lock key ({KEK}): {'already there' if KEK in names else 'new, made in Part 2'}")
okd, dm = sql(REF, """select
  (select p.primary_email from public.domains d left join public.persons p on p.person_id = d.owner_person where d.code = 'billing' and d.entity = 'cc_ihs' limit 1) as billing,
  (select p.primary_email from public.domains d left join public.persons p on p.person_id = d.owner_person where d.code = 'client_care' and d.entity = 'cc_ihs' limit 1) as care,
  (select count(*)::int from public.care_circles where axiscare_client_id is not null) as circles,
  (to_regclass('public.family_sends') is not null) as tbl""")
if not okd or not dm: stop(f"couldn't read the database: {dm}", 3)
BILL = dm[0]["billing"] or ""
say(f"  · Billing owner (gets returned payment forms, can Show the numbers): {BILL or 'NOT SET: set one in Who Handles What, or only owners can Show them'}")
say(f"  · Client Care owner (gets Family Circle changes and GUIDE calls): {dm[0]['care'] or 'not set'}")
say(f"  · clients with a linked Family Circle: {dm[0]['circles']}")
say(f"  · the tables are {'already there (an earlier run)' if dm[0]['tbl'] else 'new'}")
K = keys(); ANON, SVC = K.get("anon", ""), K.get("service_role", ""); L.HIDE += [ANON, SVC]
if not ANON or not SVC: stop("couldn't read the Hub's keys (the proofs need them)", 3)
say("  · what changes: 1 new server secret (if missing), 3 server-only tables, 2 services, 1 hourly erase, the switch added OFF. Nothing is texted.")

say(); say("PART 2 · CHANGE")
if KEK not in names:
    val = base64.b64encode(secrets.token_bytes(32)).decode(); L.HIDE.append(val)
    s, b = http("POST", f"{API}/v1/projects/{REF}/secrets", [{"name": KEK, "value": val}], MG())
    val = None
    if s not in (200, 201) or KEK not in secret_names(): bad("the payment lock key didn't go in: " + str(s)); say("  STOP. Nothing else was changed. Tell Claude."); done(6)
    ok("the payment lock key is made (32 random bytes, kept only as a server secret, never shown)")
else: ok("the payment lock key is already there (kept as it is: changing it would lock out forms not yet entered)")
CHECK = """
do $v$ begin
  if has_table_privilege('authenticated', 'public.family_sends', 'select') or has_table_privilege('anon', 'public.family_sends', 'select')
     or has_table_privilege('authenticated', 'public.family_payments', 'select') or has_table_privilege('anon', 'public.family_payments', 'select')
     or has_table_privilege('authenticated', 'public.family_payment_reveals', 'select') then
    raise exception '1163 self-check: a browser role can reach the Send to family records'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'family_payment_reveals_keep' and not tgisinternal) then raise exception '1163 self-check: the Show log keep-guard is missing'; end if;
end $v$;"""
okq, r = sql(REF, "begin;\n" + open(os.path.join(ROOT, SQLF)).read().replace("begin;", "", 1).replace("commit;", "") + CHECK + "\ncommit;")
if not okq: bad("the database change didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Tell Claude."); done(6)
okq, r = sql(REF, "select data->>'family_send_live' as live from app_data where key = 'ops_settings'")
LIVE_BEFORE = (r[0]["live"] if okq and r else None)
ok("the 3 tables are in: server only, the Show log can't be changed · the switch is " + ("ON (already)" if LIVE_BEFORE == "true" else "OFF"))
if not deploy(REF, FNROOT, "family-send", True): say("  STOP at family-send. The tables are in (harmless, empty). Tell Claude."); done(6)
if not deploy(REF, FNROOT, "family-form", False): say("  STOP at family-form. Tell Claude."); done(6)
URL = f"{FNB}/functions/v1/family-send"; FORM = f"{FNB}/functions/v1/family-form"
sql(REF, f"select cron.unschedule({lit(JOB)}) where exists (select 1 from cron.job where jobname = {lit(JOB)})")
okq, r = sql(REF, f"select cron.schedule({lit(JOB)}, {lit(SCHEDULE)}, {lit(command(URL, ANON))}) as id")
ok2, jb = sql(REF, f"select schedule, command from cron.job where jobname = {lit(JOB)}")
chk(okq and ok2 and jb and jb[0]["schedule"] == SCHEDULE and "x-cron-secret" in jb[0]["command"], "the hourly erase: payment numbers still held 7 days after signing are wiped", "the schedule didn't go in: " + str(r)[:200])

say(); say("PART 3 · PROOF (practice: nothing texted, no card, made-up client)")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
VIS = {"apikey": ANON, "Authorization": "Bearer " + ANON}; OWN = {"apikey": SVC, "Authorization": "Bearer " + SVC}
a1 = http("POST", URL, {"action": "list", "client_ax": "290"}, VIS)[0]; a2 = http("POST", URL, {"action": "show", "payment_id": "00000000-0000-0000-0000-000000000000"}, VIS)[0]
a3 = http("POST", URL, {"action": "sweep"}, VIS)[0]
chk(a1 in (401, 403) and a2 in (401, 403) and a3 == 401, f"the public key can't list, show numbers or run the erase ({[a1, a2, a3]})")
b1 = http("POST", FORM, {"action": "open", "t": "short"})[0]; b2 = http("POST", FORM, {"action": "open", "t": "Z" * 43})[0]
chk(b1 == 400 and b2 == 404, f"the family's door refuses a broken or unknown link ({[b1, b2]})")
tok = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode().rstrip("="); L.HIDE.append(tok)
okq, r = sql(REF, f"""insert into public.family_sends (client_ax, client_name, piece, contact_id, token_hash, to_name, to_phone, channels, sent_by, expires_at)
  values ({lit(PRACTICE_AX)}, 'Practice Client (1163)', 'payment', gen_random_uuid(), {lit(h256(tok))}, 'Practice Person', '4175550100', array['sms'], 'desktop-proof', now() + interval '1 hour') returning id""")
if not okq or not r: bad("couldn't make the practice link: " + str(r)[:200]); done(7)
SID = r[0]["id"]
sql(REF, f"update public.family_sends set code_hash = {lit(h256(SID + ':123456'))}, code_expires_at = now() + interval '10 minutes' where id = {lit(SID)}")
s1, o1 = http("POST", FORM, {"action": "open", "t": tok}); s2, o2 = http("POST", FORM, {"action": "verify", "t": tok, "code": "123456"})
ses = jload(o2).get("s", "")
chk(s1 == 200 and jload(o1).get("piece") == "payment" and s2 == 200 and ses and "every Thursday" in json.dumps(jload(o2)), "a practice payment link opens with its 6-digit code, with her authorization words")
yy = str(datetime.date.today().year + 2)[2:]
CARD = "4111111111111111"
s3, o3 = http("POST", FORM, {"action": "submit", "t": tok, "s": ses, "method": "card", "holder_name": "Practice Person", "card_number": CARD, "exp": "12/" + yy, "zip": "65802",
                             "all_future": True, "agree": True, "signer_name": "Practice Person"})
okp, pr = sql(REF, f"select id, last4, brand, left(sealed, 3) as v, (row_to_json(p)::jsonb - 'sealed')::text as clear from public.family_payments p where send_id = {lit(SID)}")
chk(s3 == 200 and okp and pr and pr[0]["v"] == "v1." and pr[0]["last4"] == "1111" and CARD not in pr[0]["clear"], "...it signs end to end: the card is SEALED, only \"Visa ending 1111\" is kept in the clear", f"the practice signing didn't go through: {s3} {o3[:200]} {pr}")
okc, cc = sql(REF, f"select count(*)::int as n from public.app_data a, jsonb_array_elements(a.data) x where a.key = 'ops_items' and x->>'id' = {lit('ops_fampay_' + SID.replace('-', '')[:16])}")
chk(okc and cc and cc[0]["n"] == 0, "...practice makes no card on anyone's My Work")
if pr:
    sql(REF, f"update public.family_payments set signed_at = now() - interval '8 days' where id = {lit(pr[0]['id'])}")
    s4, o4 = http("POST", URL, {"action": "sweep"}, OWN)
    oke, er = sql(REF, f"select sealed is null as gone, erased_why from public.family_payments where id = {lit(pr[0]['id'])}")
    chk(s4 == 200 and oke and er and er[0]["gone"] and er[0]["erased_why"] == "seven_days", "the hourly erase wipes numbers held past 7 days", f"the erase didn't run: {s4} {o4[:160]} {er}")
okx, _ = sql(REF, f"delete from public.family_payments where send_id = {lit(SID)}; delete from public.family_sends where id = {lit(SID)}")
okl, left_ = sql(REF, f"select (select count(*) from public.family_sends where client_ax = {lit(PRACTICE_AX)})::int + (select count(*) from public.family_payments where client_ax = {lit(PRACTICE_AX)})::int as n")
chk(okx and okl and left_ and left_[0]["n"] == 0, "the practice rows are removed")
okq, r = sql(REF, "select data->>'family_send_live' as live from app_data where key = 'ops_settings'")
chk(okq and r and r[0]["live"] == (LIVE_BEFORE or "false"), f"the switch is exactly as before ({(r or [{}])[0].get('live') if okq else '?'})")
say("  · Send to family isn't in the Hub yet: Claude merges the Hub change after this step")
say()
say("RESULT: DONE. Tell Claude, who merges the Hub change next (the Send to family card on Start of Care and Payer, and the family's page).")
say("While the switch is OFF, only Samantha and Zach can send, so you can try it on a test client first.")
say("Undo: Claude removes the two services and the schedule. The tables stay (server only). The lock key stays (it never leaves the server).")
done(0)
