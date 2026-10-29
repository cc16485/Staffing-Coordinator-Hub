-- 1177 · LONG HOME VISITS RECORDED IN PARTS (Samantha 2026-10-29: "make the recorder handle a full 90-minute home visit").
-- The Hub now records an in-home assessment in 10-minute parts that upload while the visit is still going (rec-parts.js,
-- Hub PR "Home visit stage 2"). Each part is an ordinary recordings row, so transcribe-recording, the 1-year audio clean-up
-- (purge-recordings) and everything else that reads a recording work on a part unchanged. These three columns tie a visit's
-- parts together so the Hub can show them as one recording, in order, with the right times.
-- Adds only. Nothing is changed or removed. Safe to run again. Interviews never fill these (they stay one recording each).
begin;
alter table public.recordings add column if not exists session_id text;
alter table public.recordings add column if not exists part int check (part is null or part >= 1);
alter table public.recordings add column if not exists offset_seconds int check (offset_seconds is null or offset_seconds >= 0);
create index if not exists recordings_session_idx on public.recordings (session_id, part) where session_id is not null;
comment on column public.recordings.session_id is 'One long recording made in parts (a home visit): the same id on every part (1177).';
comment on column public.recordings.part is 'Which part of the session this is, 1 first (1177).';
comment on column public.recordings.offset_seconds is 'Where this part starts in the whole recording, in seconds, pauses left out (1177).';
commit;
