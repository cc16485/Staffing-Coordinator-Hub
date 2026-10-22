-- 1050 · Learned on this call, step 1 (Samantha 2026-10-22, approved mockup https://claude.ai/artifact/BapTUgrqCvdYjjjvgFRDDR,
--   her yes to all 5 decisions and "Build step 1 in practice"). Safe to run again.
--
-- call_learned: one row per answered call the recorder put on a lead, read once by call-learn. What the call reader heard
-- (the lead form's own boxes, the care plan draft, Home & Life and the people), never the transcript. Office staff read it
-- (the Hub's "Learned on this call" box); only the server writes it, except the one decision below.
-- call_learned_decide(message_id, decided, note): a person says what happened to a call's box: added (after they saved the
-- lead), wrong, or dismissed. It only marks the row; the lead changes only through the Hub's own lead form and save.

create table if not exists public.call_learned (
  message_id text primary key,
  lead_id text not null,
  msg_at timestamptz not null,
  direction text,
  seconds int,
  staff text,
  status text not null check (status in ('read', 'waiting', 'no_transcript', 'skipped', 'error')),
  tries int not null default 0,
  reading jsonb,
  note text,
  read_at timestamptz not null default now(),
  decided text check (decided in ('added', 'wrong', 'dismissed')),
  decided_by text,
  decided_at timestamptz,
  decided_note text
);
create index if not exists call_learned_lead on public.call_learned (lead_id, msg_at desc);
alter table public.call_learned enable row level security;
revoke all on public.call_learned from public, anon, authenticated;
grant select on public.call_learned to authenticated;
grant all on public.call_learned to service_role;
drop policy if exists call_learned_read on public.call_learned;
create policy call_learned_read on public.call_learned for select to authenticated using (public.can_access_data_key('leads'));

create or replace function public.call_learned_decide(p_message_id text, p_decided text, p_note text default null) returns boolean
language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $f$
declare n int;
begin
  if not public.can_access_data_key('leads') then raise exception 'not allowed'; end if;
  if p_decided not in ('added', 'wrong', 'dismissed') then raise exception 'unknown decision'; end if;
  update public.call_learned set decided = p_decided, decided_by = left(coalesce(auth.jwt()->>'email', ''), 120),
         decided_at = now(), decided_note = left(nullif(trim(coalesce(p_note, '')), ''), 500)
   where message_id = p_message_id and status = 'read';
  get diagnostics n = row_count;
  return n = 1;
end $f$;
revoke all on function public.call_learned_decide(text, text, text) from public, anon;
grant execute on function public.call_learned_decide(text, text, text) to authenticated;
