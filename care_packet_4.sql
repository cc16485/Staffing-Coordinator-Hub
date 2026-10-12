-- care_packet_4.sql · the Care Library's "Bed-bound and hospice care" group (Samantha 2026-10-12: "the bed bound/Hospice
-- support care should be in there", "the ones you made for Dan"). Adds the group and moves the six topics made for Dan into it (hospice
-- basics, turning, skin, bedside commode, brief in bed, PureWick), but only a topic
-- still in the group it started in (a topic she has moved herself is left where she put it). Nothing else changes: no
-- approvals, notes or videos are touched.
begin;
alter table public.care_topics drop constraint if exists care_topics_category_check;
alter table public.care_topics add constraint care_topics_category_check
  check (category in ('bedbound', 'moving', 'personal', 'eating', 'conditions', 'signs', 'other'));
update public.care_topics set category = 'bedbound' where key = 'hospice_basics' and category = 'conditions';
update public.care_topics set category = 'bedbound' where key = 'turning'        and category = 'moving';
update public.care_topics set category = 'bedbound' where key in ('skin', 'brief_in_bed', 'commode', 'purewick_male') and category = 'personal';
commit;
