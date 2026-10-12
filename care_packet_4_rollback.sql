-- undo care_packet_4.sql: bed-bound topics go back to the groups they started in, then the group is removed.
begin;
update public.care_topics set category = 'conditions' where category = 'bedbound' and key = 'hospice_basics';
update public.care_topics set category = 'moving'     where category = 'bedbound' and key = 'turning';
update public.care_topics set category = 'other'      where category = 'bedbound' and key not in ('hospice_basics', 'turning', 'skin', 'brief_in_bed', 'commode', 'purewick_male');
update public.care_topics set category = 'personal'   where category = 'bedbound';
alter table public.care_topics drop constraint if exists care_topics_category_check;
alter table public.care_topics add constraint care_topics_category_check
  check (category in ('moving', 'personal', 'eating', 'conditions', 'signs', 'other'));
commit;
