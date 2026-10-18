#!/usr/bin/env python3
# 968 · WRITE-UP ACKNOWLEDGMENT (HR Agent build step 8; Samantha 2026-10-18: "build step 8").
# Part 1 (read only): the reviewed build; write-ups are owner-only (946); the open log for documents; the GoHighLevel and
#   AxisCare keys are set (their values are never read).
# Part 2: hr_ack.sql (the signing records and their history, server only, never deleted; the private bucket hr-docs whose
#   PDFs can't be deleted, moved or renamed); deploy hr-ack.
# Part 3 (proof; practice only, nothing texted, no write-up touched, nothing to AxisCare): the public key can't list or
#   start anything; a practice notice for "Test Caregiver" opens on its private link, refuses a wrong name, and signs end
#   to end into a PDF; a second practice notice is recorded as refused with a witness; the PDFs can't be deleted; Zach's
#   and Krystal's own sign-ins can't read the records; every write-up is exactly as before.
# Signing stays in PRACTICE until ops_settings.hr_ack_live is true (build step 10). Prints counts only.
import os, json, re, hashlib
os.environ.setdefault("SB_STEP", "968")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
HUB = os.environ.get("SB_HUB_BASE", "https://cc.mo-care.com")
NEW = "hr-ack"
HR_EMAIL = os.environ.get("SB_HR_EMAIL", "zach@mo-care.com"); CC_EMAIL = os.environ.get("SB_CC_EMAIL", "krystal@mo-care.com")
HERE = os.path.dirname(os.path.abspath(__file__))
def keys():
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_secret_") or v.startswith("sb_publishable_")) and "·" not in v and "*" not in v
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys{q}", headers=MG())
        if s != 200: continue
        try: arr = json.loads(b)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        got = {k.get("name"): k.get("api_key", "") for k in arr if isinstance(k, dict) and usable(k.get("api_key", ""))}
        if got.get("service_role") and got.get("anon"): return got
    return {}
def jload(b):
    try: return json.loads(b)
    except Exception: return {}
WU_Q = "select coalesce(md5((select data::text from public.app_data where key = 'discipline_actions')), 'none') as h, (select jsonb_array_length(data) from public.app_data where key = 'discipline_actions')::int as n"

start("WRITE-UP ACKNOWLEDGMENT")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
sN, mN = fmeta(REF, NEW)
ok, st = sql(REF, """select (select count(*) from pg_policies where tablename = 'app_data' and policyname like 'app_data_hr_formal_%')::int as lock946,
  (to_regclass('public.document_access_log') is not null) as openlog, (to_regclass('public.hr_ack') is not null) as tbl""")
if not ok or not st: bad(f"could not read the database: {st}")
else:
    x = st[0]
    if x["lock946"] != 4: bad("write-ups are not owner-only yet (Desktop 946)")
    if not x["openlog"]: bad("the document open log (document_access_log) is missing")
    if not fails: say(f"  ✓ write-ups are owner-only (946) · the document open log is there · the signing records are {'already there (an earlier run)' if x['tbl'] else 'new'} · the service is {'already there' if sN == 200 else 'new'}")
ok, wb = sql(REF, WU_Q); WU_BEFORE = wb[0] if ok and wb else None
if not WU_BEFORE: bad("could not read the write-ups to compare after")
s_, sb_ = http("GET", f"{API}/v1/projects/{REF}/secrets", headers=MG())
names = [y.get("name") for y in jload(sb_)] if s_ == 200 and isinstance(jload(sb_), list) else []
if "GHL_TOKEN" in names or "GHL_API_KEY" in names: say("  ✓ the GoHighLevel key is set on the server (its value is never read here)")
else: bad("the GoHighLevel key is not set on the server")
if ("AXISCARE_TOKEN" in names or "AXISCARE_API_KEY" in names) and ("AXISCARE_SITE" in names or "AXISCARE_SITE_NUMBER" in names): say("  ✓ the AxisCare keys are set (for the short note once it is live)")
else: bad("the AxisCare keys are not set on the server")
K = keys(); ANON, SVC = K.get("anon", ""), K.get("service_role", ""); HIDE.extend([ANON, SVC])
if not (ANON and SVC): bad("could not read the project's keys (the proofs need them)")
say(f"  · {WU_BEFORE['n'] if WU_BEFORE else '?'} write-up(s) on file; none is changed by this step.")
say("  · what changes: 2 new server-only tables, 1 private bucket, 1 new service. No switch is turned on; nothing is texted.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
CHECK = """
do $v$ begin
  if has_table_privilege('authenticated', 'public.hr_ack', 'select') or has_table_privilege('anon', 'public.hr_ack', 'select')
     or has_table_privilege('authenticated', 'public.hr_ack_event', 'select') or has_table_privilege('authenticated', 'public.hr_ack', 'update') then
    raise exception '968 self-check: a browser role can reach the signing records'; end if;
  if not exists (select 1 from storage.buckets where id = 'hr-docs' and public = false) then raise exception '968 self-check: the hr-docs bucket is missing or public'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'hr_docs_keep' and not tgisinternal) then raise exception '968 self-check: the keep-guard on hr-docs is missing'; end if;
end $v$;"""
good, r = sql(REF, "begin;\n" + open(os.path.join(HERE, "hr_ack.sql")).read() + CHECK + "\ncommit;")
if not good: bad(f"the signing records did not go in, so nothing changed: {str(r)[:300]}"); say("  RESULT: STOPPED. Tell Claude."); done(5)
say("  ✓ the signing records and the private PDF store are in: server only, never deleted")
if not deploy(REF, FNROOT, NEW, True): say("  RESULT: STOPPED at the deploy. The tables are in (harmless, empty). Tell Claude."); done(6)

say(); say("PART 3 · PROOF (practice only: nothing texted, no write-up touched, nothing to AxisCare)")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
URL = f"{FNB}/functions/v1/{NEW}"
VIS = {"apikey": ANON, "Authorization": "Bearer " + ANON}
OWN = {"apikey": SVC, "Authorization": "Bearer " + SVC}
a1 = http("POST", URL, {"action": "list"}, VIS)[0]; a2 = http("POST", URL, {"action": "start", "writeup_id": "x", "via": "link"}, VIS)[0]
a3 = http("POST", URL, {"action": "sample"}, VIS)[0]
say(f"  ✓ the public key can't list, start or make anything ({a1}, {a2}, {a3})") if a1 in (401, 403) and a2 in (401, 403) and a3 == 401 else bad(f"the public key got in ({a1}, {a2}, {a3})")
s1, b1 = http("POST", URL, {"action": "sample"}, OWN); j1 = jload(b1); T1 = j1.get("token", ""); HIDE.append(T1)
if s1 != 200 or not T1: bad(f"the practice notice could not be made ({s1}): {str(b1)[:200]}")
else:
    v = jload(http("POST", URL, {"action": "view", "t": T1}, VIS)[1])
    say("  ✓ the practice notice opens on its private link: the notice, the receipt words, marked practice") if v.get("first") == "Test" and v.get("practice") is True and "does not mean I agree" in str(v.get("receipt", "")) else bad(f"the private link did not open as it should: {str(v)[:200]}")
    w = http("POST", URL, {"action": "sign", "t": T1, "typed_name": "Somebody Else", "consent": True, "notice_hash": v.get("notice_hash")}, VIS)
    say("  ✓ a name that isn't theirs is refused") if w[0] == 400 else bad(f"a wrong name was not refused ({w[0]})")
    sg = http("POST", URL, {"action": "sign", "t": T1, "typed_name": "Test Caregiver", "consent": True, "notice_hash": v.get("notice_hash")}, VIS); jg = jload(sg[1])
    say("  ✓ it signs end to end: received, not agreed; their copy link comes back") if sg[0] == 200 and jg.get("copy_url") else bad(f"signing did not finish ({sg[0]}): {str(sg[1])[:200]}")
    again = http("POST", URL, {"action": "view", "t": T1}, VIS)[0]
    say("  ✓ once signed, the link stops working") if again == 404 else bad(f"the link still opened after signing ({again})")
s2, b2 = http("POST", URL, {"action": "sample"}, OWN); j2 = jload(b2); HIDE.append(j2.get("token", ""))
if s2 == 200 and j2.get("ack_id"):
    rr = http("POST", URL, {"action": "record", "ack_id": j2["ack_id"], "outcome": "refused", "date": time.strftime("%Y-%m-%d"), "how": "phone", "witness": "", "witness_reason": ""}, OWN)
    say("  ✓ a refusal with no witness and no reason is refused") if rr[0] == 400 else bad(f"a refusal with no witness was accepted ({rr[0]})")
    rr = http("POST", URL, {"action": "record", "ack_id": j2["ack_id"], "outcome": "refused", "date": time.strftime("%Y-%m-%d"), "how": "phone", "witness": "Desktop proof", "note": "practice"}, OWN)
    say("  ✓ a refusal with a witness is recorded, with its PDF") if rr[0] == 200 else bad(f"the refusal was not recorded ({rr[0]}): {str(rr[1])[:200]}")
else: bad(f"the second practice notice could not be made ({s2})")
ok, ck_ = sql(REF, """select (select count(*) from public.hr_ack where writeup_id = 'practice-sample' and status in ('signed', 'refused') and pdf_path is not null and practice)::int as done,
  (select count(*) from storage.objects where bucket_id = 'hr-docs' and name like 'practice/%')::int as pdfs,
  (select count(*) from public.hr_ack where not practice)::int as real""")
if ok and ck_ and ck_[0]["done"] >= 2 and ck_[0]["pdfs"] >= 2 and ck_[0]["real"] == 0: say(f"  ✓ {ck_[0]['done']} practice notice(s) finished with PDFs kept privately; no real notice exists yet")
else: bad(f"the practice records are not as expected: {ck_}")
ok, dl = sql(REF, """do $p$ begin
  delete from storage.objects where bucket_id = 'hr-docs' and name like 'practice/%';
  raise exception 'PROBE_RESULT:deleted';
exception when others then if sqlerrm like 'PROBE_RESULT:deleted%' then raise; else raise exception 'PROBE_RESULT:kept'; end if; end $p$;""")
say("  ✓ the PDFs can't be deleted") if "PROBE_RESULT:kept" in str(dl) else bad("a PDF in hr-docs could be deleted")
def probe(email):
    good, r = sql(REF, f"""do $p$ declare uid uuid; meta jsonb; res text := ''; n int; begin
      select u.id, coalesce(u.raw_app_meta_data, '{{}}'::jsonb) into uid, meta from auth.users u where lower(u.email) = {lit(email)} and u.banned_until is null;
      if uid is null then raise exception 'PROBE_RESULT:nouser=1'; end if;
      perform set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'role', 'authenticated', 'app_metadata', meta)::text, true);
      perform set_config('request.jwt.claim.sub', uid::text, true);
      set local role authenticated;
      begin select count(*) into n from public.hr_ack; res := res || 'read=1;'; exception when others then res := res || 'read=0;'; end;
      raise exception 'PROBE_RESULT:%', res; end $p$;""")
    m_ = re.search(r"PROBE_RESULT:([a-z0-9_=; ]*)", str(r)) if not good else None
    return dict(kv.split("=") for kv in m_.group(1).split(";") if "=" in kv) if m_ else None
for who, em in (("Zach", HR_EMAIL), ("Krystal", CC_EMAIL)):
    p = probe(em)
    if p is None or p.get("nouser"): say(f"  · could not test as {who} (no sign-in found); the rehearsal covers it")
    elif p.get("read") == "0": say(f"  ✓ acting as {who} (undone after): can't read the signing records directly (only through the HR page)")
    else: bad(f"acting as {who}, the signing records could be read directly")
ok, wa = sql(REF, WU_Q)
say(f"  ✓ every write-up is exactly as before ({wa[0]['n']})") if ok and wa and WU_BEFORE and wa[0]["h"] == WU_BEFORE["h"] else bad("the write-ups changed during this step")
s4, b4 = http("GET", HUB + "/notice.html", None, {})
say("  ✓ the signing page is live at cc.mo-care.com/notice.html") if s4 == 200 and "hr-ack" in b4 else say("  · the signing page is not live yet: Claude merges the Hub change next")
say("  · tested before this ran: the rules and the service (58 checks), the pages at phone size (23), this step against a local copy of the database (see hr_ack_968_test.py).")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE. Tell Claude."); done(9)
say("RESULT: DONE · Signing is ready in practice. Tell Claude, who merges the Hub change next. Nothing was texted and no write-up changed.")
say("Undo: Claude can remove the hr-ack service; the records and PDFs are kept by design.")
done(0)
