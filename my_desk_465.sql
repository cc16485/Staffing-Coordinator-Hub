-- =====================================================================================================================
-- 465 · MY DESK, STAGE 6a: KIND WORDS ARRIVE ON THE RIGHT DESKS
-- =====================================================================================================================
-- Samantha approved Stage 6 on 2026-10-06 with the plan's decisions (https://claude.ai/artifact/CC6pJvTp9EzwoRBH5qKdt9):
--   6. anyone with a desk can clip a kind word by hand and it goes straight into the office jar; suggestions the Hub finds
--      wait for an owner or coordinator to say "yes, that's kind" (kind_word_decide, from 463)
--   7. a compliment about a client's care is tucked under the page of the client's coordinator (whoever owns Client Care)
--      and the owners; a review about the whole company is tucked under everyone's page; all of them are in the jar
-- A page can't put things on other people's desks (proven in 463), so tucking happens here, in one checked place.
-- Nothing here texts or emails anyone. Changes only these functions; no table changes.
-- =====================================================================================================================

-- Who a kind word is tucked under. Never the person who clipped it (they have just read it).
create or replace function public.kind_word_deliver(p_id uuid) returns int
language plpgsql security definer set search_path = pg_catalog, public as $$
declare w record; n int := 0; company boolean;
begin
  select id, link, source, about_role, created_by into w from public.kind_words where id = p_id and status = 'kind';
  if w.id is null then return 0; end if;
  company := w.source = 'review' or ((w.link is null or (w.link ->> 'type') is null or (w.link ->> 'type') = 'work') and coalesce(w.about_role, '') = '');
  insert into public.kind_word_drops (kind_word_id, person_id)
  select p_id, x.pid from (
    select r.person_id as pid from public.staff_roles r where r.entity = 'cc_ihs' and r.role = 'owner_admin'
    union
    select d.owner_person from public.domains d where d.entity = 'cc_ihs' and d.code = 'client_care' and d.owner_person is not null and not company
    union
    select r.person_id from public.staff_roles r where r.entity = 'cc_ihs' and r.role in ('owner_admin', 'care_coordinator', 'staffing_coordinator') and company
  ) x
  where x.pid is not null and x.pid is distinct from w.created_by
  on conflict (kind_word_id, person_id) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- Clip a kind word by hand: straight into the jar, then tucked under the right desks.
create or replace function public.kind_word_clip(p_quote text, p_who text, p_about text, p_about_role text, p_source text, p_said_on date, p_link jsonb)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_me uuid := public.desk_me(); v_id uuid; v_n int;
begin
  if not public.desk_hub_ok() or v_me is null then raise exception 'Sign in to the Care Coordinator Hub to clip a kind word.' using errcode = '42501'; end if;
  if coalesce(trim(p_quote), '') = '' or char_length(p_quote) > 1200 then raise exception 'The kind words themselves, up to 1200 letters.' using errcode = '22023'; end if;
  if p_link is not null and (jsonb_typeof(p_link) <> 'object' or pg_column_size(p_link) >= 2000) then raise exception 'That link is not one the Hub made.' using errcode = '22023'; end if;
  insert into public.kind_words (quote, who, about, about_role, source, said_on, link, status, created_by)
  values (trim(p_quote), left(coalesce(trim(p_who), ''), 200), left(coalesce(trim(p_about), ''), 200), left(coalesce(trim(p_about_role), ''), 60),
          case when p_source in ('shift_note', 'text', 'call', 'email', 'review', 'other') then p_source else 'other' end, p_said_on, p_link, 'kind', v_me)
  returning id into v_id;
  v_n := public.kind_word_deliver(v_id);
  return jsonb_build_object('id', v_id, 'tucked', v_n);
end $$;

-- 463's decision, now also tucking a "yes, that's kind" under the right desks.
create or replace function public.kind_word_decide(p_id uuid, p_kind boolean) returns text
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_status text;
begin
  if not public.desk_kind_decider() then raise exception 'Only an owner or coordinator decides about a suggestion.' using errcode = '42501'; end if;
  update public.kind_words set status = case when p_kind then 'kind' else 'not_kind' end, decided_by = public.desk_me(), decided_at = now()
   where id = p_id and status = 'suggested' returning status into v_status;
  if v_status is null then raise exception 'That suggestion is not waiting any more.' using errcode = '22023'; end if;
  if v_status = 'kind' then perform public.kind_word_deliver(p_id); end if;
  return v_status;
end $$;

revoke all on function public.kind_word_deliver(uuid) from public, anon, authenticated;
grant execute on function public.kind_word_deliver(uuid) to service_role;
revoke all on function public.kind_word_clip(text, text, text, text, text, date, jsonb) from public, anon;
grant execute on function public.kind_word_clip(text, text, text, text, text, date, jsonb) to authenticated;
revoke all on function public.kind_word_decide(uuid, boolean) from public, anon;
grant execute on function public.kind_word_decide(uuid, boolean) to authenticated;
