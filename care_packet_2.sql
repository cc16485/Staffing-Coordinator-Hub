-- care_packet_2.sql · Caregiver packets, Step 2 (Samantha "build step 2", 2026-10-12): the office texts a caregiver their
-- packet link from the card. Each caregiver's row keeps when it was last texted, by whom, which text (first / reminder /
-- updated) and how many times. New columns only, all empty to start; nothing existing changes. The switch
-- ops_settings.care_packet_send_live starts OFF (not set here: it is turned on from the Owners Hub Admin page).
begin;
alter table public.care_packet_recipients
  add column if not exists last_sent_at   timestamptz,
  add column if not exists last_sent_by   text,
  add column if not exists last_send_kind text check (last_send_kind in ('first', 'reminder', 'updated')),
  add column if not exists last_send_id   text,
  add column if not exists send_count     integer not null default 0;
commit;
