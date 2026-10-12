-- undo care_packet_3.sql: the Care Library columns. Approved topics stay; ones still waiting are retired (never offered without her OK).
begin;
-- a topic still waiting for her OK must never become offered: retire those first
update public.care_topics set active = false where pending;
alter table public.care_topics drop column if exists category, drop column if exists flag, drop column if exists pending,
  drop column if exists approved_by, drop column if exists approved_at, drop column if exists review_note;
commit;
