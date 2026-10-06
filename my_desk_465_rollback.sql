-- 465 rollback: kind words go back to 463 (no tucking; decide without delivering). Drops already tucked stay.
begin;
drop function if exists public.kind_word_clip(text, text, text, text, text, date, jsonb);
drop function if exists public.kind_word_deliver(uuid);
create or replace function public.kind_word_decide(p_id uuid, p_kind boolean) returns text
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_status text;
begin
  if not public.desk_kind_decider() then raise exception 'Only an owner or coordinator decides about a suggestion.' using errcode = '42501'; end if;
  update public.kind_words set status = case when p_kind then 'kind' else 'not_kind' end, decided_by = public.desk_me(), decided_at = now()
   where id = p_id and status = 'suggested' returning status into v_status;
  if v_status is null then raise exception 'That suggestion is not waiting any more.' using errcode = '22023'; end if;
  return v_status;
end $$;
revoke all on function public.kind_word_decide(uuid, boolean) from public, anon;
grant execute on function public.kind_word_decide(uuid, boolean) to authenticated;
commit;
