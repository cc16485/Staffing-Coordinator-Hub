#!/usr/bin/env python3
# 540 · SLICE 1b: THE OFFER PAGE'S SERVER, THE PRIVATE BUCKET AND THE OPEN LOG (Samantha approved 2026-10-08, development and
# testing only). Hub project. Runs the database change (private PDF-only bucket onboarding-documents with no rule for anon
# or authenticated; the append-only document_access_log) and deploys the offer-sign function pinned to the reviewed
# build. It serves ONLY offers on the new onboarding path, and no real offer is on it until the switch date; nothing is
# sent by it or by this step. No existing record changes.
import os, json
os.environ.setdefault("SB_STEP", "540")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FN = "offer-sign"
start("SLICE 1b: THE OFFER PAGE'S SERVER, THE PRIVATE BUCKET AND THE OPEN LOG")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
SQLF = os.path.join(ROOT, "supabase", "slice1b-offer-documents.sql")
if not os.path.exists(SQLF): bad("the SQL file is not in the reviewed build"); done(2)
sx, mx = fmeta(REF, FN)
NEW = sx == 404
if NEW: say(f"  ✓ {FN}: not live yet (new in this slice), it is created with the gateway sign-in check on")
elif sx == 200 and mx: say(f"  ✓ {FN} is live at version {mx.get('version', '?')}; it is replaced by this reviewed build")
else: bad(f"{FN} could not be read ({sx})"); done(3)
ok_, s_ = sql(REF, "select count(*) as n from pg_proc where proname = 'offer_events_append_only'")   # just proves SQL works
ok_, bk = sql(REF, "select id, public from storage.buckets where id = 'onboarding-documents'")
say("  · the bucket does not exist yet" if ok_ and not bk else (f"  · the bucket exists (public = {bk[0]['public']}); it is set private again" if ok_ else f"  ✗ could not read buckets: {bk}"))
ok_, sec = http("GET", f"{API}/v1/projects/{REF}/secrets", headers=MG())
names = {x.get("name") for x in (json.loads(sec) if ok_ == 200 and sec.startswith("[") else [])}
for need_ in ("HUB_JOB_SECRET", "OFFERS_PROJECT_URL", "OFFERS_SERVICE_ROLE_KEY"):
    say(f"  ✓ the function secret {need_} is set") if need_ in names else bad(f"the function secret {need_} is not set; offer-sign would refuse every link")
say("  · what changes: a private bucket and an append-only open log appear; the offer-sign function goes live, usable only through a private offer link for an offer on the new path (none real exist). Nothing is sent.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
ok_, r_ = sql(REF, open(SQLF).read())
say("  ✓ the bucket and the open log are in place") if ok_ else bad(f"the database change did not run: {r_}")
if fails: say("  RESULT: STOPPED before any function changed. Tell Claude."); done(5)
if not deploy(REF, FNROOT, FN, True): say("  RESULT: STOPPED. Tell Claude."); done(6)
say(); say("PART 3 · PROOF (nothing is sent or changed)")
ok_, bk = sql(REF, "select public, file_size_limit, array_to_string(allowed_mime_types, ',') as types from storage.buckets where id = 'onboarding-documents'")
say("  ✓ onboarding-documents is private, PDF only, 10 MB") if ok_ and bk and bk[0]["public"] is False and bk[0]["types"] == "application/pdf" else bad(f"bucket: {bk}")
ok_, pol = sql(REF, "select count(*) as n from pg_policies where schemaname = 'storage' and tablename = 'objects' and (qual like '%onboarding-documents%' or with_check like '%onboarding-documents%')")
say("  ✓ no storage rule lets anon or authenticated touch the bucket (server only)") if ok_ and int(pol[0]["n"]) == 0 else bad(f"a storage rule names the bucket: {pol}")
ok_, g_ = sql(REF, "select grantee, string_agg(privilege_type, ',' order by privilege_type) as privs from information_schema.role_table_grants where table_schema='public' and table_name='document_access_log' and grantee in ('anon','authenticated') group by 1")
say("  ✓ the open log: anon and authenticated hold nothing") if ok_ and not g_ else bad(f"grants on document_access_log: {g_}")
ok_, t_ = sql(REF, "do $p$ declare v bigint; u text := 'not tested'; d text := 'not tested'; x text := 'not tested'; begin insert into public.document_access_log (offer_id, doc, path, by_email) values ('540-proof', 'offer', 'proof', 'proof') returning id into v; begin update public.document_access_log set doc = 'x' where id = v; u := 'ALLOWED'; exception when others then u := 'refused'; end; begin delete from public.document_access_log where id = v; d := 'ALLOWED'; exception when others then d := 'refused'; end; begin truncate public.document_access_log; x := 'ALLOWED'; exception when others then x := 'refused'; end; raise exception using message = 'update ' || u || ', delete ' || d || ', truncate ' || x; end $p$")
say("  ✓ the open log can be neither changed, deleted nor emptied, even by the owner (proof row rolled back)") if (not ok_) and "update refused, delete refused, truncate refused" in str(t_) else bad(f"the open log is not append-only: {str(t_)[:160]}")
BASE = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
s_, b_ = http("POST", f"{BASE}/functions/v1/{FN}", {"action": "view", "o": "00000000-0000-0000-0000-000000000000", "e": 4102444800, "t": "A" * 43}, {"apikey": "", "Authorization": "Bearer "})
say(f"  ✓ a forged offer link gets nothing from the signing server ({s_})") if s_ in (401, 403) else bad(f"a forged link answered {s_}")
s_, b_ = http("POST", f"{BASE}/functions/v1/{FN}", {"action": "open", "offer_id": "00000000-0000-0000-0000-000000000000", "doc": "offer"}, {"apikey": "", "Authorization": "Bearer "})
say(f"  ✓ a staff open without a sign-in is refused ({s_})") if s_ in (401, 403) else bad(f"a staff open without a sign-in answered {s_}")
say("  · tested before deploying with 23 checks on the real function (new path only, offer before position description, consent and full name, one signature per document even in a race, PDFs written once, every event recorded, withdrawn/declined/expired dead, no expiry refused, staff opens logged, no text or email path) plus 18 on the texts and the PDF writer.")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the offer page's server is live for fictional new-path offers only. Nothing was sent; no existing record changed."); done(0)
