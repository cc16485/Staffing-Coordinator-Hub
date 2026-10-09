#!/usr/bin/env python3
# 539 · SLICE 1b TEST APPLICANTS (Samantha approved 2026-10-08: fictional applicants and test data only). Creates two
# FICTIONAL offers on the NEW onboarding path in the Training project (names 'Test Applicant' and 'Test Parttime', a
# 555 phone, no email), each with a seven-business-day expiry on the company holiday calendar, and mints their private
# offer links with the Hub's own link secret (read through the management API with your token; never printed). The
# links go into the report for you to open on a phone. No real applicant is touched; nothing is sent (no phone or
# email is ever messaged by this step, and the offer function is not involved). Safe to run again: it reuses the
# fictional offers if they already exist.
import os, json, hmac, hashlib, base64, time, datetime as dt
os.environ.setdefault("SB_STEP", "539")
from cc_step_lib import *
HUB = "zngsgedlsxinbygwmxwn"; TRN = "rdqujxiycycwhskyvrwa"
PEOPLE = [("Test", "Applicant", "PRN", "prn", 16.00), ("Test", "Parttime", "PART_TIME", "part_time", 17.00)]
start("SLICE 1b TEST APPLICANTS (fictional, new path only)")
say("PART 1 · READ ONLY (nothing changes)")
ok_, sec = http("GET", f"{API}/v1/projects/{HUB}/secrets", headers=MG())
secret = next((x.get("value", "") for x in (json.loads(sec) if ok_ == 200 and sec.startswith("[") else []) if x.get("name") == "HUB_JOB_SECRET"), "")
HIDE.append(secret)
if len(secret) < 32: bad("the Hub's link secret could not be read (HUB_JOB_SECRET); no links can be minted"); done(3)
say("  ✓ the Hub's link secret is available to this step (hidden)")
ok_, hol = sql(HUB, "select coalesce(data->'company_holidays', '[]'::jsonb) as h from public.app_data where key = 'ops_settings'")
holidays = {x.get("date") for x in ((hol[0]["h"] if ok_ and hol else []) or []) if isinstance(x, dict)}
say(f"  ✓ {len(holidays)} company holidays on the calendar")
def next_business_days(d, n):
    while n > 0:
        d += dt.timedelta(days=1)
        if d.weekday() < 5 and d.isoformat() not in holidays: n -= 1
    return d
today = dt.datetime.now(dt.timezone(dt.timedelta(hours=-5))).date()   # Chicago (CDT) is close enough for a test expiry
exp_day = next_business_days(today, 7); exp_dt = dt.datetime(exp_day.year, exp_day.month, exp_day.day, 22, 0, 0, tzinfo=dt.timezone.utc)   # 5pm Central (CDT)
say(f"  · test offers expire {exp_day.isoformat()} at 5pm Central (seven business days)")
ok_, ex = sql(TRN, "select id, first_name, last_name, classification, onboarding_path, offer_status from public.job_offers where first_name = 'Test' and last_name in ('Applicant','Parttime') and onboarding_path = 'new'")
if not ok_: bad(f"could not read offers: {ex}"); done(3)
have = {(r["first_name"], r["last_name"]): r for r in ex}
say("  · fictional offers already on file: " + (", ".join(f"{r['first_name']} {r['last_name']}" for r in ex) or "none"))
if fails: done(3)
say(); say("PART 2 · CHANGE (fictional rows only)")
ids = {}
for first, last, hours, cls, rate in PEOPLE:
    if (first, last) in have: ids[(first, last)] = have[(first, last)]["id"]; say(f"  ✓ {first} {last} reused"); continue
    ok_, r_ = sql(TRN, f"insert into public.job_offers (first_name, last_name, phone, email, position, pay_rate, hours_type, interview_date, offered_by, onboarding_path, classification, offer_status, offer_version, pd_version, offer_sent_at, offer_sent_by, offer_expires_at, notes) values ({lit(first)}, {lit(last)}, '5550100', null, 'Caregiver', {rate}, {lit(hours)}, current_date, 'Slice 1b test', 'new', {lit(cls)}, 'sent', 1, 1, now(), 'Slice 1b test (fictional)', {lit(exp_dt.isoformat())}, 'FICTIONAL test applicant for Slice 1b; never a real person') returning id")
    if ok_ and r_: ids[(first, last)] = r_[0]["id"]; say(f"  ✓ {first} {last} created ({cls}, ${rate:.2f}/h, new path, expires {exp_day.isoformat()})")
    else: bad(f"could not create {first} {last}: {r_}")
if fails: done(5)
say(); say("PART 3 · THE TEST LINKS (open on a phone; each dies with its offer)")
def link(offer_id, exp_sec):
    msg = f"offer|{offer_id}|{exp_sec}".encode(); key = ("cc-applicant-link-v1:" + secret).encode()
    t = base64.urlsafe_b64encode(hmac.new(key, msg, hashlib.sha256).digest()).decode().rstrip("=")
    return f"https://cc.mo-care.com/offer.html?o={offer_id}&e={exp_sec}&t={t}"
exp_sec = int(exp_dt.timestamp())
for (first, last), oid in ids.items():
    say(f"  {first} {last}: {link(oid, exp_sec)}")
say("  · these links carry no name, phone or email; they stop working at the offer's expiry; a withdrawn test offer stops them at once.")
say("  · when you are done testing, tell Claude: the test offers are withdrawn (offer_withdrawn_at set), never deleted.")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · fictional test applicants ready. Nothing was sent to anyone."); done(0)
