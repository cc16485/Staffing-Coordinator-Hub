-- care_packet_5.sql · two things Samantha asked for on 2026-10-12, after sending Dan's packet to everyone scheduled with him:
--   1. "have us mark if we want it sent to anyone who is scheduled with him or only send manually ... that option for each
--      client": care_packets.auto_send (OFF for every client to start), who turned it on or off, and when.
--   2. "change ariels smiths back to confirmed ... i just accidently clicked save packet again": when a save makes a new
--      version but it was only a small fix, the office can keep everyone's confirmation. Never silently: the history row
--      and the caregiver's row both say it was carried over, from which version, and by whom.
-- New columns only, nothing existing changes.
begin;
alter table public.care_packets
  add column if not exists auto_send    boolean not null default false,
  add column if not exists auto_send_by text,
  add column if not exists auto_send_at timestamptz;
alter table public.care_packet_acks
  add column if not exists carried_from integer,
  add column if not exists carried_by   text;
alter table public.care_packet_recipients
  add column if not exists ack_carried_from integer,
  add column if not exists ack_carried_by   text;
commit;
