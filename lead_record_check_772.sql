-- 772 · the recorder's practice list says who GoHighLevel thinks each call or text was with, and which of the family's
--   numbers it matched (Samantha 2026-10-15: "Confirm that each interaction is attached to the correct family"). Then the
--   practice list starts over, so every row has the new detail. Practice rows only: nothing on any lead, and no live row,
--   is touched. Safe to run again.
alter table public.lead_record_seen add column if not exists contact_name text;
alter table public.lead_record_seen add column if not exists matched_on text check (matched_on is null or matched_on in ('phone', 'client_phone'));
delete from public.lead_record_seen where mode = 'practice';
delete from public.lead_record_state where mode = 'practice';
