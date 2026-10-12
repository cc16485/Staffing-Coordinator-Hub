-- care_packet_3.sql · the Care Library (Samantha 2026-10-12: "its own tab" + "a large library … common senior issues, such as
-- fall rise, transfers, different diets"). Her rulings: Client Care → Care Library tab; she approves every video in the tab;
-- the whole office can browse it, only an owner changes or approves; caregivers still see only their client's packet.
-- New columns only. Every topic already in the library is ones she approved, so they start approved (pending false) and
-- their videos (no status yet) count as approved. Topics Claude researches arrive pending until she approves them.
begin;
alter table public.care_topics
  add column if not exists category    text not null default 'other'
    check (category in ('moving', 'personal', 'eating', 'conditions', 'signs', 'other')),
  add column if not exists flag        text not null default '' check (length(flag) <= 400),
  add column if not exists pending     boolean not null default false,
  add column if not exists approved_by text,
  add column if not exists approved_at timestamptz,
  add column if not exists review_note text not null default '' check (length(review_note) <= 1000);   -- office only: what to check before approving
-- the six she already approved, in their groups
update public.care_topics set category = 'moving'     where key = 'turning'                                 and category = 'other';
update public.care_topics set category = 'personal'   where key in ('commode', 'brief_in_bed', 'skin', 'purewick_male') and category = 'other';
update public.care_topics set category = 'conditions' where key = 'hospice_basics'                          and category = 'other';
update public.care_topics set flag = 'Private pay: caregivers place and empty it. Medicaid: an external catheter is an advanced personal care task, so the client is flagged for the nurse.'
  where key = 'purewick_male' and flag = '';
commit;
