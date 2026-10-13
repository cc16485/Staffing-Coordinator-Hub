#!/usr/bin/env python3
# 636 · TRAINING RECORDS: WHAT THE TRAINING PLATFORM HAS, AND WHAT REACHED THE HUB (read only). Samantha 2026-10-12, for
# the MMAC audit: caregivers trained on our own Training Platform, one certificate per course; she will review a bulk
# import. Counts only (no names): completions per course, which have a certificate PDF saved, how many caregivers match
# between the two systems by AxisCare number, and what the Hub roster holds today. Changes nothing. Sends nothing.
import os, json
os.environ.setdefault("SB_STEP", "636")
from cc_step_lib import *
HUB = "zngsgedlsxinbygwmxwn"; TRN = "rdqujxiycycwhskyvrwa"
start("TRAINING RECORDS: WHAT EACH SIDE HAS (READ ONLY)")
say("PART 1 · THE TRAINING PLATFORM")
ok, a = sql(TRN, "select count(*) filter (where active) as active, count(*) filter (where active and coalesce(axiscare_id,'') <> '') as active_ax, count(*) as total from public.caregivers")
if ok and a: say(f"  · caregivers: {a[0]['active']} active ({a[0]['active_ax']} with an AxisCare number), {a[0]['total']} in all")
else: bad(f"could not read Training caregivers: {a}")
ok, b = sql(TRN, """select c.slug, c.title, c.hours,
    count(*) filter (where e.status = 'complete') as complete,
    count(*) filter (where e.status = 'complete' and g.active) as complete_active,
    count(*) filter (where e.status = 'complete' and exists (select 1 from storage.objects o where o.bucket_id = 'waiver-docs'
      and o.name = 'certificates/' || e.caregiver_id::text || '/' || c.slug || '.pdf')) as with_cert,
    count(*) filter (where e.status = 'complete' and coalesce(to_jsonb(e)->>'completion_doc_path','') <> '') as with_prior_doc,
    count(*) filter (where e.status = 'complete' and coalesce(to_jsonb(e)->>'signed_form_path','') <> '') as with_signed_form,
    count(*) filter (where e.status = 'complete' and coalesce(to_jsonb(e)->>'completion_note','') <> '') as entered_after,
    count(*) filter (where e.status in ('not_started','in_progress','overdue') and g.active) as not_done_active
  from public.enrollments e join public.courses c on c.id = e.course_id join public.caregivers g on g.id = e.caregiver_id
  group by c.slug, c.title, c.hours order by c.slug""")
if ok:
    for x in b:
        say(f"  · {x['title']} ({x['slug']}, {x['hours']} h): {x['complete']} complete ({x['complete_active']} by active caregivers) · certificate PDF saved: {x['with_cert']} · "
            f"entered after the fact: {x['entered_after']} (with a document: {x['with_prior_doc']}) · signed form: {x['with_signed_form']} · active not finished yet: {x['not_done_active']}")
else: bad(f"could not read Training completions: {b}")
ok, c = sql(TRN, "select count(*) as n, count(*) filter (where coalesce(to_jsonb(r)->>'doc_path','') <> '') as with_doc from public.inservice_records r")
say(f"  · annual in-service records: {c[0]['n']} ({c[0]['with_doc']} with a document)" if ok and c else f"  · annual in-service records: not readable ({str(c)[:80]})")
ok, d = sql(TRN, "select count(*) as n from storage.objects where bucket_id = 'waiver-docs' and name like 'certificates/%'")
if ok and d: say(f"  · certificate files in the store: {d[0]['n']}")
ok, ax = sql(TRN, "select coalesce(json_agg(distinct axiscare_id), '[]'::json) as ids from public.caregivers where active and coalesce(axiscare_id,'') <> ''")
trn_ax = set(str(i) for i in ((ax[0]['ids'] if ok and ax else []) or []))
say(); say("PART 2 · THE HUB")
ok, s = sql(HUB, "select coalesce(data->>'training_sync_live','not set') as live from public.app_data where key = 'ops_settings'")
if ok and s: say(f"  · the nightly Training sync switch (training_sync_live): {s[0]['live']}")
ok, r = sql(HUB, """with g as (select x from public.app_data, jsonb_array_elements(coalesce(data::jsonb,'[]'::jsonb)) x where key = 'caregivers')
  select count(*) as n,
    count(*) filter (where coalesce(x->>'axiscare_id','') <> '') as with_ax,
    count(*) filter (where coalesce(x->>'axiscare_status_active','') <> 'false' and coalesce(x->>'active','') <> 'false') as active,
    count(*) filter (where coalesce(x->>'orient_date','') <> '') as orient, count(*) filter (where coalesce(x->>'alz_date','') <> '') as alz,
    count(*) filter (where coalesce(x->>'ojt_online','') <> '' or coalesce(x->>'ojt_date','') <> '') as ojt, count(*) filter (where coalesce(x->>'annual_date','') <> '') as annual,
    count(*) filter (where coalesce(x->>'th_synced','') <> '') as synced_ever,
    count(*) filter (where (x->>'orient_proof') like 'training:%' or (x->>'alz_proof') like 'training:%') as proof_training,
    count(*) filter (where (x->>'orient_proof') like 'http%' or (x->>'alz_proof') like 'http%') as proof_link,
    count(*) filter (where (x->>'orient_proof') like 'training/%' or (x->>'alz_proof') like 'training/%') as proof_uploaded
  from g""")
if ok and r:
    y = r[0]
    say(f"  · roster: {y['n']} caregivers ({y['with_ax']} with an AxisCare number; {y['active']} not marked inactive)")
    say(f"  · dates on file: orientation {y['orient']}, dementia {y['alz']}, on-the-job {y['ojt']}, annual {y['annual']} · ever synced from Training: {y['synced_ever']}")
    say(f"  · proofs: from the Training Platform {y['proof_training']}, a plain link {y['proof_link']}, uploaded in the Hub {y['proof_uploaded']}")
ok, hx = sql(HUB, "select coalesce(json_agg(distinct x->>'axiscare_id'), '[]'::json) as ids from public.app_data, jsonb_array_elements(coalesce(data::jsonb,'[]'::jsonb)) x where key = 'caregivers' and coalesce(x->>'axiscare_id','') <> ''")
hub_ax = set(str(i) for i in ((hx[0]['ids'] if ok and hx else []) or []))
say(); say("PART 3 · DO THEY MATCH (by AxisCare number)")
say(f"  · active Training caregivers with an AxisCare number: {len(trn_ax)} · Hub roster AxisCare numbers: {len(hub_ax)}")
say(f"  · in both: {len(trn_ax & hub_ax)} · only in Training: {len(trn_ax - hub_ax)} · only in the Hub: {len(hub_ax - trn_ax)}")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · read only; nothing changed, nothing sent. Tell Claude \"ran 636\"."); done(0)
