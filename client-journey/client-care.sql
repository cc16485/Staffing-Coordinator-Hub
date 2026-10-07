-- =====================================================================================================================
-- CLIENT CARE: Pause care and End care (Samantha approved 2026-10-07). Safe to run more than once. Nothing is removed.
--   client_care_change  the permanent record of every pause, longer pause, resume, end and return: who made it and when,
--                       the effective date, the reason, the explanation, who told us, and the Medicaid checklist (a human
--                       checklist with proof; never an automatic notice). Never deleted; only the checklist is updated.
--   client_pause        an open pause is the system state "Paused": the client stays visible with a follow-up date
--   client_journey      one journey per EPISODE (was one per person): a returning client gets a new journey on the same
--                       person (episode_n, previous_journey_id), only one open at a time; ending never deletes one
--   client_care_end_role / client_care_return_role   the Hub's client role and episode, changed in one transaction
-- =====================================================================================================================
begin;

-- one journey per episode
alter table public.client_journey drop constraint if exists client_journey_lead_id_key;
alter table public.client_journey drop constraint if exists client_journey_axiscare_client_id_key;
create unique index if not exists client_journey_one_open_lead on public.client_journey (lead_id) where status <> 'closed' and lead_id is not null;
create unique index if not exists client_journey_one_open_ax on public.client_journey (axiscare_client_id) where status <> 'closed' and axiscare_client_id is not null;
alter table public.client_journey add column if not exists episode_n int not null default 1;
alter table public.client_journey add column if not exists previous_journey_id uuid references public.client_journey (journey_id);

create table if not exists public.client_care_change (
  change_id          uuid primary key default gen_random_uuid(),
  person_id          uuid,
  axiscare_client_id text not null check (axiscare_client_id ~ '^\d+$'),
  client_name        text,
  journey_id         uuid references public.client_journey (journey_id),
  kind               text not null check (kind in ('pause', 'extend', 'resume', 'end', 'return')),
  reason             text,
  explanation        text,
  effective_date     date not null,
  followup_date      date,
  notified_by        text,
  made_by            text not null,
  made_by_name       text,
  made_at            timestamptz not null default now(),
  source             text not null default 'hub' check (source in ('hub', 'axiscare_review')),
  review_id          uuid,
  payer              text,
  checklist          jsonb not null default '[]'::jsonb,
  updated_at         timestamptz not null default now(),
  is_test            boolean not null default false,
  constraint ccc_end_needs_reason check (kind not in ('pause', 'end') or reason is not null),
  constraint ccc_other_needs_why check (reason is distinct from 'other' or nullif(btrim(coalesce(explanation, '')), '') is not null),
  constraint ccc_pause_needs_followup check (kind not in ('pause', 'extend') or followup_date is not null)
);
create index if not exists client_care_change_ax on public.client_care_change (axiscare_client_id, made_at);

create or replace function public.client_care_change_keep() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.is_test then return old; end if;
    raise exception 'client_care_change is permanent: it cannot be deleted';
  end if;
  if (to_jsonb(new) - 'checklist' - 'updated_at') is distinct from (to_jsonb(old) - 'checklist' - 'updated_at') then
    raise exception 'client_care_change is permanent: only its checklist can be updated';
  end if;
  return new;
end $$;
drop trigger if exists client_care_change_keep on public.client_care_change;
create trigger client_care_change_keep before update or delete on public.client_care_change for each row execute function public.client_care_change_keep();

create table if not exists public.client_pause (
  pause_id           uuid primary key default gen_random_uuid(),
  person_id          uuid,
  axiscare_client_id text not null check (axiscare_client_id ~ '^\d+$'),
  client_name        text,
  journey_id         uuid references public.client_journey (journey_id),
  opened_change      uuid not null references public.client_care_change (change_id),
  paused_from        date not null,
  followup_date      date not null,
  reason             text not null,
  explanation        text,
  owner_email        text,
  status             text not null default 'open' check (status in ('open', 'closed')),
  closed_change      uuid references public.client_care_change (change_id),
  closed_kind        text check (closed_kind in ('resumed', 'ended')),
  closed_at          timestamptz,
  is_test            boolean not null default false
);
create unique index if not exists client_pause_one_open on public.client_pause (axiscare_client_id) where status = 'open';

revoke all on public.client_care_change, public.client_pause from anon, authenticated;
grant all on public.client_care_change, public.client_pause to service_role;
alter table public.client_care_change enable row level security;
alter table public.client_pause enable row level security;

-- End care: the active episode ends on the effective date and the client role becomes 'former' with the reason
create or replace function public.client_care_end_role(p_person uuid, p_date date, p_reason text, p_evidence text, p_staff text, p_seat text)
returns jsonb language plpgsql security invoker as $$
declare v_ep uuid; r jsonb; v_role boolean := false;
begin
  if p_person is null then return jsonb_build_object('outcome', 'no_person'); end if;
  if p_date is null or nullif(btrim(coalesce(p_reason, '')), '') is null then return jsonb_build_object('outcome', 'reason_and_date_required'); end if;
  perform pg_advisory_xact_lock(hashtext('client_status_person'), hashtext(p_person::text));
  select episode_id into v_ep from public.journey_episode where person_id = p_person and public.journey_state_is_active(state) limit 1;
  if v_ep is not null then
    r := public.episode_set_state(v_ep, 'ended', 'documented', p_date, null, null, p_evidence, 'client_care', p_staff, p_seat);
    if r->>'outcome' <> 'state_set' then return jsonb_build_object('outcome', 'refused', 'detail', r); end if;
  end if;
  update public.person_role set status = 'former', ended_at = p_date, end_reason = p_reason, updated_at = now()
   where person_id = p_person and role = 'client' and status = 'active';
  v_role := found;
  return jsonb_build_object('outcome', 'ended', 'episode_ended', v_ep, 'client_role_ended', v_role);
end $$;

-- Return: a person confirmed it; a new episode and an active client role (the old ones stay as they are)
create or replace function public.client_care_return_role(p_person uuid, p_date date, p_evidence text, p_staff text, p_seat text)
returns jsonb language plpgsql security invoker as $$
declare v_ep uuid; v_state text; r jsonb; v_new uuid; v_role bigint;
begin
  if p_person is null then return jsonb_build_object('outcome', 'no_person'); end if;
  perform pg_advisory_xact_lock(hashtext('client_status_person'), hashtext(p_person::text));
  select episode_id, state into v_ep, v_state from public.journey_episode where person_id = p_person and public.journey_state_is_active(state) limit 1;
  if v_ep is not null then v_new := v_ep;
  else
    r := public.episode_open_for_person(p_person, 'established', 'documented', p_evidence, p_date, null, null,
                                        'unobserved', 'returning client confirmed by a person in the Hub', null, 'client_care', p_staff, p_seat);
    if r->>'outcome' <> 'opened' then return jsonb_build_object('outcome', 'refused', 'detail', r); end if;
    v_new := (r->>'episode_id')::uuid;
  end if;
  if not exists (select 1 from public.person_role where person_id = p_person and role = 'client' and status = 'active') then
    insert into public.person_role (person_id, role, status, started_at) values (p_person, 'client', 'active', p_date) returning id into v_role;
  end if;
  return jsonb_build_object('outcome', 'returned', 'episode_id', v_new, 'client_role_started', v_role is not null);
end $$;

revoke all on function public.client_care_end_role(uuid, date, text, text, text, text) from public, anon, authenticated;
revoke all on function public.client_care_return_role(uuid, date, text, text, text) from public, anon, authenticated;
grant execute on function public.client_care_end_role(uuid, date, text, text, text, text) to service_role;
grant execute on function public.client_care_return_role(uuid, date, text, text, text) to service_role;

commit;
