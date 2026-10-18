-- =============================================================================
-- 919 · AI call cards close themselves (Samantha 2026-10-17, "go"; her plan of 2026-10-14, item 1).
-- =============================================================================
-- 1. call_card_check: one row per AI call card, what the last look found: what happened with that person since the
--    card was made, which prepared steps have hard proof, what the AI made of it, and what it would do (close, Looks
--    done, nothing). Practice mode writes only here. Office read; only the call-tasks job writes. No message bodies,
--    phone numbers or emails (the evidence lines are the AI's own words, scrubbed).
-- 2. call_card_patch(id, patch, history): the only way the job changes a card. It touches ONE item in ops_items, only
--    an AI call card (kind call_followup) that is still open, only the close fields and looks_done, and adds one
--    history line, all inside the row lock. A person's edits to anything else on the card are never replaced.
--    Only the service role may call it.
-- One transaction. Safe to run again. Rollback: cards_close_919_rollback.sql.
-- =============================================================================
begin;

create table if not exists public.call_card_check (
  card_id          text primary key check (length(card_id) between 4 and 80),
  message_id       text check (message_id is null or length(message_id) <= 80),
  mode             text not null check (mode in ('practice', 'suggest', 'close')),
  created_at       timestamptz not null default now(),
  checked_at       timestamptz not null,
  checks           int not null default 1,
  sig              text check (sig is null or length(sig) <= 2000),
  verdict          text check (verdict is null or verdict in ('none', 'done', 'partly', 'not_yet', 'unclear')),
  why              text check (why is null or length(why) <= 300),
  evidence         jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) <= 5),
  proofs           jsonb not null default '[]'::jsonb check (jsonb_typeof(proofs) = 'array'),
  would            text check (would is null or would in ('close', 'suggest', 'none')),
  done             text check (done is null or done in ('close', 'suggest', 'none')),
  last_activity_at timestamptz,
  error            text check (error is null or length(error) <= 300),
  history          jsonb not null default '[]'::jsonb check (jsonb_typeof(history) = 'array')
);
comment on table public.call_card_check is '919 · what the last look at each AI call card found: activity since the card, hard proof per step, the AI''s verdict, and what it would do or did (close, Looks done, nothing). Office read; only call-tasks writes.';
create index if not exists call_card_check_checked_ix on public.call_card_check (checked_at);

alter table public.call_card_check enable row level security;
revoke all on public.call_card_check from public, anon, authenticated, service_role;
grant select on public.call_card_check to authenticated;
grant select, insert, update on public.call_card_check to service_role;
drop policy if exists call_card_check_office on public.call_card_check;
create policy call_card_check_office on public.call_card_check for select to authenticated using (public.hub_office_ok());

create or replace function public.call_card_patch(p_id text, p_patch jsonb, p_history jsonb)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $f$
declare
  allowed constant text[] := array['status', 'closed_at', 'closed_by', 'resolution_code', 'close_reason', 'last_activity_at', 'looks_done'];
  k text;
  idx int;
  cur jsonb;
  hist jsonb;
begin
  if p_id is null or p_id = '' or jsonb_typeof(p_patch) is distinct from 'object' then
    raise exception 'call_card_patch: an id and a patch object are needed';
  end if;
  for k in select jsonb_object_keys(p_patch) loop
    if not (k = any(allowed)) then raise exception 'call_card_patch: % cannot be changed this way', k; end if;
  end loop;
  if p_patch ? 'status' and p_patch->>'status' <> 'done' then
    raise exception 'call_card_patch: it can only close a card';
  end if;
  if p_history is not null and jsonb_typeof(p_history) <> 'object' then
    raise exception 'call_card_patch: the history line must be an object';
  end if;

  perform 1 from app_data where key = 'ops_items' for update;
  select ord - 1, elem into idx, cur
    from app_data, jsonb_array_elements(data) with ordinality as e(elem, ord)
   where key = 'ops_items' and elem->>'id' = p_id
   limit 1;
  if idx is null then return false; end if;
  if cur->>'kind' is distinct from 'call_followup' or cur->>'status' is distinct from 'open' then return false; end if;

  hist := case when jsonb_typeof(cur->'history') = 'array' then cur->'history' else '[]'::jsonb end;
  if p_history is not null then hist := hist || jsonb_build_array(p_history); end if;
  update app_data
     set data = jsonb_set(data, array[idx::text], (cur || p_patch) || jsonb_build_object('history', hist))
   where key = 'ops_items';
  return true;
end
$f$;
revoke all on function public.call_card_patch(text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.call_card_patch(text, jsonb, jsonb) to service_role;

do $v$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.call_card_check'::regclass) then
    raise exception '919 self-check: row security is off on call_card_check'; end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'call_card_check'
              and (grantee in ('anon', 'PUBLIC') or (grantee = 'authenticated' and privilege_type <> 'SELECT')
                   or (grantee = 'service_role' and privilege_type not in ('SELECT', 'INSERT', 'UPDATE')))) then
    raise exception '919 self-check: someone could change card checks, or anon could read them'; end if;
  if has_function_privilege('authenticated', 'public.call_card_patch(text, jsonb, jsonb)', 'execute')
     or has_function_privilege('anon', 'public.call_card_patch(text, jsonb, jsonb)', 'execute') then
    raise exception '919 self-check: a signed-in page could change cards through call_card_patch'; end if;
  raise notice '919: card checks are kept, and only the job can close a card or say it looks done';
end $v$;
commit;
