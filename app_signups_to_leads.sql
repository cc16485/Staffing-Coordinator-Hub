-- =============================================================================
-- mo-care.com/app sign-ups made BEFORE 2026-10-16's change sat in public.early_interest, not in Leads. Her rule (2026-10-16):
-- "send mo-care.com/app sign-ups into the Leads Intake Desk tagged 'wants the app'". This moves each one, once, into the Hub's
-- leads as a New care lead tagged "wants the app" (the same shape lead-intake makes), and marks the row with the lead's id so
-- it is never moved twice. Contacts nobody: no acknowledgment is sent for these older sign-ups; the office calls them.
-- Oklahoma sign-ups and caregiver/partner rows stay where they are. All-or-nothing. Safe to run again.
-- =============================================================================
begin;
alter table public.early_interest add column if not exists lead_id text;
do $m$
declare r record; lid text; first text; last text; notes text; n int := 0;
begin
  if not exists (select 1 from public.app_data where key = 'leads') then raise exception 'the Hub has no leads list'; end if;
  for r in select * from public.early_interest
           where site = 'missouri' and kind = 'family' and 'app-early-access' = any(coalesce(interests, '{}')) and lead_id is null
           order by created_at loop
    lid := gen_random_uuid()::text;
    first := split_part(trim(r.name), ' ', 1);
    last := nullif(trim(substr(trim(r.name), length(split_part(trim(r.name), ' ', 1)) + 1)), '');
    notes := concat_ws(E'\n', 'Signed up on mo-care.com/app (' || to_char(r.created_at at time zone 'America/Chicago', 'Mon FMDD') || '): wants to use the Caring Companions app.',
                       nullif(r.message, ''), case when r.for_whom is not null then 'Care for: ' || r.for_whom end, case when r.zip is not null then 'ZIP: ' || r.zip end,
                       'Moved from the app early-access list; no acknowledgment was sent.');
    update public.app_data set data = coalesce(data, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'id', lid, 'first_name', coalesce(nullif(first, ''), '(website lead)'), 'last_name', coalesce(last, ''), 'phone', coalesce(r.phone, ''),
        'email', coalesce(r.email, ''), 'source', 'Website', 'referral_source_name', '', 'status', 'New', 'interest_notes', notes,
        'follow_up_due', to_char(now() at time zone 'America/Chicago', 'YYYY-MM-DD'), 'created_at', to_char(r.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'intent_tags', jsonb_build_array('wants the app')))
     where key = 'leads';
    update public.early_interest set lead_id = lid where id = r.id;
    n := n + 1;
  end loop;
  raise notice 'moved %', n;
end $m$;
commit;
