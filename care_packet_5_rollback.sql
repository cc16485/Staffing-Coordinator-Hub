-- undo care_packet_5.sql. Automatic sending stops for every client; carried confirmations stay counted (ack_version is not
-- touched), only the note of who carried them goes.
begin;
alter table public.care_packets drop column if exists auto_send, drop column if exists auto_send_by, drop column if exists auto_send_at;
alter table public.care_packet_acks drop column if exists carried_from, drop column if exists carried_by;
alter table public.care_packet_recipients drop column if exists ack_carried_from, drop column if exists ack_carried_by;
commit;
