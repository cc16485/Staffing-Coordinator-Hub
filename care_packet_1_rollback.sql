-- care_packet_1_rollback.sql · removes the four caregiver-packet tables (and everything in them). Nothing else is touched.
begin;
drop table if exists public.care_packet_acks;
drop table if exists public.care_packet_recipients;
drop table if exists public.care_packets;
drop table if exists public.care_topics;
commit;
