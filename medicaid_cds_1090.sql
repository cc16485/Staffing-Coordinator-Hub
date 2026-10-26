-- 1090 · Medicaid points to Caring Companions Consumer Directed Services (her rule and wording, 2026-10-26).
-- The intake payer step's how-to gets her approved staff script. Options stay as 910 set them
-- (no Medicaid IHS for new families). Safe to run twice.
update public.client_journey_step_def
   set def = jsonb_set(def, '{howto}', '["Ask who will pay for care: the family, the VA, a long-term care policy, Medicare GUIDE, or something else.", "We no longer take agency Medicaid (IHS, Aged & Disabled Waiver). If they have active Medicaid, say: \"Our sister company, Caring Companions Consumer Directed Services, can help with that. They can hire someone the family already knows, or help them find caregivers to choose from. I''ll pass you their number: (417) 218-2888, or caringcds.com.\"", "Pick the payer. For Other, write the payer or source; an owner reviews it next."]'::jsonb),
       updated_at = now(), updated_by = '1090 medicaid to CDS'
 where key = 'intake.payer';
do $$ begin
  if not exists (select 1 from public.client_journey_step_def where key = 'intake.payer' and def->'howto'->>1 like '%Caring Companions Consumer Directed Services%') then
    raise exception '1090 self-check: the payer how-to was not updated'; end if;
  if exists (select 1 from public.client_journey_step_def where key = 'intake.payer' and def::text like '%Medicaid IHS / HCBS%') then
    raise exception '1090 self-check: Medicaid IHS is still offered as a payer'; end if;
end $$;

-- Cara's CDS answer (website knowledge, same database): the "short call" now names the sister company's number
-- (the chat's call button dials Cara's own line). Only changes N001 if it still has the old ending.
update public.kb_items
   set answer = 'Sometimes. Missouri Consumer Directed Services can pay a family member as the attendant when the consumer is eligible for the program and directs their own care. A spouse cannot be paid as the attendant. Whether a particular daughter qualifies depends on the consumer''s eligibility, so it is worth a short call to our sister company, Caring Companions Consumer Directed Services: (417) 218-2888 or caringcds.com.'
 where id = 'N001'
   and answer like '%so it is worth a short call to check.';
