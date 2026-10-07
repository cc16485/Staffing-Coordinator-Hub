-- 495 · MY DESK: REPEATING TASKS (Samantha, 2026-10-07, "yes to all, go"). A repeating task is a RULE ("payroll, every
-- 2 weeks from Oct 10") that puts a to-do line on the right day's page by itself when the page is opened. Done is per
-- day; skipping a day leaves the rule alone. Owners may set a repeating task on someone else's desk, signed
-- (from_person_id), the way a signed sticky works; the person can tick it done and skip a day, never stop or change it.
-- Nothing here texts, emails or reminds anyone. Safe to run again.
create table if not exists public.desk_repeats (
  id              uuid primary key default gen_random_uuid(),
  person_id       uuid not null references public.persons(person_id) on delete cascade,
  from_person_id  uuid references public.persons(person_id) on delete set null,
  body            text not null check (char_length(body) between 1 and 1000),
  time_text       text check (time_text is null or char_length(time_text) <= 20),
  rule            jsonb not null check (jsonb_typeof(rule) = 'object' and pg_column_size(rule) < 600),
  start_day       date not null default (now() at time zone 'America/Chicago')::date,
  end_day         date,
  skips           jsonb not null default '[]'::jsonb check (jsonb_typeof(skips) = 'array' and pg_column_size(skips) < 4000),
  link            jsonb check (link is null or (jsonb_typeof(link) = 'object' and pg_column_size(link) < 2000)),
  active          boolean not null default true,
  stopped_at      timestamptz,
  stopped_by      uuid references public.persons(person_id) on delete set null,
  erased_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  rev             int not null default 1
);
create index if not exists desk_repeats_person_idx on public.desk_repeats (person_id);

create or replace function public.desk_guard_repeats() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare me uuid := public.desk_me();
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      if new.from_person_id is not null and not (public.desk_is_owner() and new.from_person_id = me and new.person_id <> me) then
        raise exception 'Only an owner sets a signed repeating task, and only on someone else''s desk.' using errcode = '42501';
      end if;
      if new.from_person_id is null and new.person_id <> me then
        raise exception 'A repeating task on someone else''s desk must be signed.' using errcode = '42501';
      end if;
      if new.stopped_at is not null or new.erased_at is not null or not new.active then
        raise exception 'A new repeating task starts switched on.' using errcode = '42501';
      end if;
      new.rev := 1;
    else
      if new.person_id <> old.person_id or new.from_person_id is distinct from old.from_person_id then
        raise exception 'A repeating task stays on the desk it was set on.' using errcode = '42501';
      end if;
      if old.from_person_id is not null and me = old.person_id
         and (new.body is distinct from old.body or new.time_text is distinct from old.time_text or new.rule is distinct from old.rule
              or new.start_day is distinct from old.start_day or new.end_day is distinct from old.end_day or new.active is distinct from old.active
              or new.stopped_at is distinct from old.stopped_at or new.erased_at is distinct from old.erased_at or new.link is distinct from old.link) then
        raise exception 'Only the owner who set this repeating task can change or stop it; you can skip a day.' using errcode = '42501';
      end if;
      if new.active is distinct from old.active and not new.active then new.stopped_at := now(); new.stopped_by := me; end if;
      new.rev := old.rev + 1;
    end if;
    new.updated_at := now();
  end if;
  return new;
end $$;
drop trigger if exists desk_repeats_guard on public.desk_repeats;
create trigger desk_repeats_guard before insert or update on public.desk_repeats for each row execute function public.desk_guard_repeats();

alter table public.desk_repeats enable row level security;
drop policy if exists desk_repeats_read on public.desk_repeats;
drop policy if exists desk_repeats_add on public.desk_repeats;
drop policy if exists desk_repeats_change on public.desk_repeats;
drop policy if exists desk_repeats_remove on public.desk_repeats;
create policy desk_repeats_read on public.desk_repeats for select to authenticated using (public.desk_can_read(person_id));
create policy desk_repeats_add on public.desk_repeats for insert to authenticated
  with check (public.desk_can_write(person_id) or (public.desk_is_owner() and from_person_id = public.desk_me()));
create policy desk_repeats_change on public.desk_repeats for update to authenticated
  using (public.desk_can_write(person_id) or (public.desk_is_owner() and from_person_id = public.desk_me()))
  with check (public.desk_can_write(person_id) or (public.desk_is_owner() and from_person_id = public.desk_me()));
create policy desk_repeats_remove on public.desk_repeats for delete to authenticated
  using ((public.desk_can_write(person_id) and from_person_id is null) or (public.desk_is_owner() and from_person_id = public.desk_me()));
revoke all on public.desk_repeats from public, anon;
grant select, insert, update, delete on public.desk_repeats to authenticated;
grant select, insert, update, delete on public.desk_repeats to service_role;
comment on table public.desk_repeats is 'My Desk (495): repeating tasks (rules). Private: the person, plus owners read-only; an owner may set a signed one (from_person_id) on someone else''s desk.';
