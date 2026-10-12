-- care_packet_2_rollback.sql · removes the step 2 send columns (the record of who was texted when). Packets, links and
-- confirmations are kept.
begin;
alter table public.care_packet_recipients
  drop column if exists last_sent_at, drop column if exists last_sent_by, drop column if exists last_send_kind,
  drop column if exists last_send_id, drop column if exists send_count;
commit;
