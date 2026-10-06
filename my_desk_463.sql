-- =====================================================================================================================
-- 463 · MY DESK, STAGE 0: THE PRIVATE STORAGE
-- =====================================================================================================================
-- Samantha approved the plan and Stage 0 on 2026-10-05 (https://claude.ai/artifact/CC6pJvTp9EzwoRBH5qKdt9).
-- My Desk is each person's own paper planner in the CC Hub. This file only creates where desks are kept and who may
-- read or change them. Nothing in the Hub uses it yet (that is Stage 1), and nothing here sends anything to anyone.
--
-- THE RULES, ENFORCED HERE AND NOT ONLY ON SCREEN:
--   · you can read and change your own desk, and only from a CC Hub sign-in
--   · an owner (staff_roles owner_admin, cc_ihs) can READ every desk, and on someone else's desk can only:
--       leave a signed sticky note (and change or take back their own note), give a star to a finished line
--       (desk_star_line), and record that they stopped by (desk_visits)
--   · nobody else can read anyone's desk. Nothing is open to the public key. No bulk delete (no TRUNCATE) from a browser
--   · the desk's owner can move, acknowledge or peel off an owner's note, but not change its words
--   · kind words are shared by the office: anyone signed in to the CC Hub reads the ones marked kind and can clip one;
--     suggestions from the Hub wait for an owner or coordinator (kind_word_decide)
--
-- WHO "YOU" ARE: auth.uid() → auth_identities → persons, the same way set_staff_role reads its caller (009).
-- NEW TABLES ONLY: app_data, its key map and the other hubs are not touched.
-- This project hands extra privileges to new tables by default (see 010), so every table here starts from
-- "revoke all" and gets back only what it needs.
-- =====================================================================================================================

-- ── who is asking ───────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.desk_me() returns uuid
language sql stable security definer set search_path = pg_catalog, public as $$
  select ai.person_id from public.auth_identities ai where ai.auth_user_id = auth.uid() order by ai.person_id limit 1
$$;
create or replace function public.desk_hub_ok() returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select auth.uid() is not null and (public.jwt_hub_access() is null or public.jwt_hub_access() ? 'care_coordinator')
$$;
create or replace function public.desk_is_owner() returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select public.desk_hub_ok() and exists (
    select 1 from public.staff_roles r where r.person_id = public.desk_me() and r.entity = 'cc_ihs' and r.role = 'owner_admin')
$$;
create or replace function public.desk_can_read(p uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select public.desk_hub_ok() and p is not null and (p = public.desk_me() or public.desk_is_owner())
$$;
create or replace function public.desk_can_write(p uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select public.desk_hub_ok() and p is not null and p = public.desk_me()
$$;
create or replace function public.desk_kind_decider() returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select public.desk_hub_ok() and exists (
    select 1 from public.staff_roles r where r.person_id = public.desk_me() and r.entity = 'cc_ihs'
       and r.role in ('owner_admin', 'care_coordinator', 'staffing_coordinator'))
$$;

-- ── the desk ────────────────────────────────────────────────────────────────────────────────────────────────────────
-- One row per line on a page, a line in the Later folder, or a card in the Stand-Up tray.
create table if not exists public.desk_lines (
  id              uuid primary key default gen_random_uuid(),
  person_id       uuid not null references public.persons(person_id) on delete cascade,
  place           text not null check (place in ('day', 'later', 'tray')),
  day             date,
  pos             double precision not null default 0,
  kind            text not null default 'todo' check (kind in ('todo', 'note', 'ghost')),
  body            text not null default '' check (char_length(body) <= 1000),
  done_at         timestamptz,
  origin_day      date,
  moved_to        date,
  ghost_of        uuid,
  star            boolean not null default false,
  circle          boolean not null default false,
  link            jsonb check (link is null or (jsonb_typeof(link) = 'object' and pg_column_size(link) < 2000)),
  time_text       text check (time_text is null or char_length(time_text) <= 20),
  subs            jsonb check (subs is null or (jsonb_typeof(subs) = 'array' and pg_column_size(subs) < 6000)),
  standup_item_id text check (standup_item_id is null or char_length(standup_item_id) <= 80),
  talked_at       timestamptz,
  owner_star_by   uuid references public.persons(person_id) on delete set null,
  owner_star_at   timestamptz,
  erased_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  rev             int not null default 1,
  check (place <> 'day' or day is not null)
);
create index if not exists desk_lines_person_idx on public.desk_lines (person_id, place, day);

create table if not exists public.desk_stickies (
  id             uuid primary key default gen_random_uuid(),
  person_id      uuid not null references public.persons(person_id) on delete cascade,
  color          text not null default 'yellow' check (color in ('yellow', 'pink', 'blue', 'green', 'honey')),
  body           text not null default '' check (char_length(body) <= 600),
  side           text not null default 'L' check (side in ('L', 'R', 'C')),
  x              int not null default 20 check (x between -3000 and 3000),
  y              int not null default 120 check (y between -200 and 5000),
  rot            real not null default 0 check (rot between -15 and 15),
  z              int not null default 1,
  from_person_id uuid references public.persons(person_id) on delete set null,
  seen_at        timestamptz,
  ack_at         timestamptz,
  erased_at      timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  rev            int not null default 1
);
create index if not exists desk_stickies_person_idx on public.desk_stickies (person_id);

create table if not exists public.desk_pages (
  person_id      uuid not null references public.persons(person_id) on delete cascade,
  day            date not null,
  stamp          text check (stamp is null or stamp in ('house', 'sun', 'cup')),
  dogear         boolean not null default false,
  wrapped_at     timestamptz,
  leftovers_done boolean not null default false,
  updated_at     timestamptz not null default now(),
  primary key (person_id, day)
);

create table if not exists public.desk_settings (
  person_id   uuid primary key references public.persons(person_id) on delete cascade,
  mat         text not null default 'teal' check (mat in ('teal', 'navy', 'sage', 'cork')),
  ink         text not null default 'navy' check (ink in ('navy', 'teal', 'plum')),
  neat        boolean not null default false,
  pad_labels  jsonb not null default '{}'::jsonb check (jsonb_typeof(pad_labels) = 'object' and pg_column_size(pad_labels) < 600),
  photo       text check (photo is null or (photo like 'data:image/jpeg;base64,%' and char_length(photo) <= 80000)),
  has_desk    boolean,
  has_desk_by uuid references public.persons(person_id) on delete set null,
  has_desk_at timestamptz,
  updated_at  timestamptz not null default now()
);

create table if not exists public.desk_visits (
  desk_person_id    uuid not null references public.persons(person_id) on delete cascade,
  visitor_person_id uuid not null references public.persons(person_id) on delete cascade,
  day               date not null,
  at                timestamptz not null default now(),
  primary key (desk_person_id, visitor_person_id, day)
);

create table if not exists public.kind_words (
  id           uuid primary key default gen_random_uuid(),
  quote        text not null check (char_length(quote) between 1 and 1200),
  who          text not null default '' check (char_length(who) <= 200),
  about        text not null default '' check (char_length(about) <= 200),
  about_role   text not null default '' check (char_length(about_role) <= 60),
  source       text not null default 'other' check (source in ('shift_note', 'text', 'call', 'email', 'review', 'other')),
  source_ref   text check (source_ref is null or char_length(source_ref) <= 200),
  said_on      date,
  link         jsonb check (link is null or (jsonb_typeof(link) = 'object' and pg_column_size(link) < 2000)),
  status       text not null default 'suggested' check (status in ('suggested', 'kind', 'not_kind')),
  suggested_by text check (suggested_by is null or char_length(suggested_by) <= 80),
  created_by   uuid references public.persons(person_id) on delete set null,
  decided_by   uuid references public.persons(person_id) on delete set null,
  decided_at   timestamptz,
  created_at   timestamptz not null default now()
);

create table if not exists public.kind_word_drops (
  kind_word_id uuid not null references public.kind_words(id) on delete cascade,
  person_id    uuid not null references public.persons(person_id) on delete cascade,
  state        text not null default 'tucked' check (state in ('tucked', 'taped', 'done')),
  dropped_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (kind_word_id, person_id)
);

-- ── guards: what row security can't say on its own ─────────────────────────────────────────────────────────────────
-- current_user is 'authenticated' for a browser and the function owner inside the functions below, so these guards
-- bind the browser only.
create or replace function public.desk_guard_lines() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      if new.owner_star_by is not null or new.owner_star_at is not null then
        raise exception 'Only an owner gives a star, and not on their own desk.' using errcode = '42501';
      end if;
      new.rev := 1;
    else
      if new.person_id <> old.person_id then raise exception 'A line stays on its own desk.' using errcode = '42501'; end if;
      if new.owner_star_by is distinct from old.owner_star_by or new.owner_star_at is distinct from old.owner_star_at then
        raise exception 'Only an owner gives a star, and not on their own desk.' using errcode = '42501';
      end if;
      new.rev := old.rev + 1;
    end if;
    new.updated_at := now();
  end if;
  return new;
end $$;
drop trigger if exists desk_lines_guard on public.desk_lines;
create trigger desk_lines_guard before insert or update on public.desk_lines for each row execute function public.desk_guard_lines();

create or replace function public.desk_guard_stickies() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
declare me uuid := public.desk_me();
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      if new.from_person_id is not null and (new.from_person_id is distinct from me or new.person_id = me or not public.desk_is_owner()) then
        raise exception 'Only an owner leaves a signed note, and only on someone else''s desk.' using errcode = '42501';
      end if;
      if new.from_person_id is not null and (new.seen_at is not null or new.ack_at is not null or new.erased_at is not null) then
        raise exception 'A new note has not been seen yet.' using errcode = '42501';
      end if;
      new.rev := 1;
    else
      if new.person_id <> old.person_id or new.from_person_id is distinct from old.from_person_id then
        raise exception 'A sticky stays on the desk it was left on.' using errcode = '42501';
      end if;
      if old.from_person_id is not null then
        if me = old.person_id and (new.body is distinct from old.body or new.color is distinct from old.color) then
          raise exception 'Only the person who signed a note can change it.' using errcode = '42501';
        end if;
        if me is distinct from old.person_id and (new.seen_at is distinct from old.seen_at or new.ack_at is distinct from old.ack_at
             or new.erased_at is distinct from old.erased_at) then
          raise exception 'Only the desk''s owner marks a note seen, answers it or peels it off.' using errcode = '42501';
        end if;
      end if;
      new.rev := old.rev + 1;
    end if;
    new.updated_at := now();
  end if;
  return new;
end $$;
drop trigger if exists desk_stickies_guard on public.desk_stickies;
create trigger desk_stickies_guard before insert or update on public.desk_stickies for each row execute function public.desk_guard_stickies();

create or replace function public.desk_guard_settings() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' and (new.has_desk is not null or new.has_desk_by is not null or new.has_desk_at is not null) then
      raise exception 'Only an owner turns a desk on or off.' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and (new.has_desk is distinct from old.has_desk or new.has_desk_by is distinct from old.has_desk_by
         or new.has_desk_at is distinct from old.has_desk_at) then
      raise exception 'Only an owner turns a desk on or off.' using errcode = '42501';
    end if;
    new.updated_at := now();
  end if;
  return new;
end $$;
drop trigger if exists desk_settings_guard on public.desk_settings;
create trigger desk_settings_guard before insert or update on public.desk_settings for each row execute function public.desk_guard_settings();

create or replace function public.desk_guard_drops() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.kind_word_id <> old.kind_word_id or new.person_id <> old.person_id or new.dropped_at <> old.dropped_at then
      raise exception 'Only where a kind word sits on your desk can change.' using errcode = '42501';
    end if;
    new.updated_at := now();
  end if;
  return new;
end $$;
drop trigger if exists kind_word_drops_guard on public.kind_word_drops;
create trigger kind_word_drops_guard before update on public.kind_word_drops for each row execute function public.desk_guard_drops();

-- ── row security ────────────────────────────────────────────────────────────────────────────────────────────────────
alter table public.desk_lines enable row level security;
alter table public.desk_stickies enable row level security;
alter table public.desk_pages enable row level security;
alter table public.desk_settings enable row level security;
alter table public.desk_visits enable row level security;
alter table public.kind_words enable row level security;
alter table public.kind_word_drops enable row level security;

do $$
declare t text;
begin
  foreach t in array array['desk_lines', 'desk_pages', 'desk_settings'] loop
    execute format('drop policy if exists %1$s_read on public.%1$s', t);
    execute format('drop policy if exists %1$s_add on public.%1$s', t);
    execute format('drop policy if exists %1$s_change on public.%1$s', t);
    execute format('drop policy if exists %1$s_remove on public.%1$s', t);
    execute format('create policy %1$s_read on public.%1$s for select to authenticated using (public.desk_can_read(person_id))', t);
    execute format('create policy %1$s_add on public.%1$s for insert to authenticated with check (public.desk_can_write(person_id))', t);
    execute format('create policy %1$s_change on public.%1$s for update to authenticated using (public.desk_can_write(person_id)) with check (public.desk_can_write(person_id))', t);
    execute format('create policy %1$s_remove on public.%1$s for delete to authenticated using (public.desk_can_write(person_id))', t);
  end loop;
end $$;

drop policy if exists desk_stickies_read on public.desk_stickies;
drop policy if exists desk_stickies_add on public.desk_stickies;
drop policy if exists desk_stickies_change on public.desk_stickies;
drop policy if exists desk_stickies_remove on public.desk_stickies;
create policy desk_stickies_read on public.desk_stickies for select to authenticated using (public.desk_can_read(person_id));
create policy desk_stickies_add on public.desk_stickies for insert to authenticated
  with check (public.desk_can_write(person_id) or (public.desk_is_owner() and from_person_id = public.desk_me()));
create policy desk_stickies_change on public.desk_stickies for update to authenticated
  using (public.desk_can_write(person_id) or (public.desk_is_owner() and from_person_id = public.desk_me()))
  with check (public.desk_can_write(person_id) or (public.desk_is_owner() and from_person_id = public.desk_me()));
create policy desk_stickies_remove on public.desk_stickies for delete to authenticated
  using (public.desk_can_write(person_id) or (public.desk_is_owner() and from_person_id = public.desk_me()));

drop policy if exists desk_visits_read on public.desk_visits;
drop policy if exists desk_visits_add on public.desk_visits;
drop policy if exists desk_visits_change on public.desk_visits;
create policy desk_visits_read on public.desk_visits for select to authenticated
  using (public.desk_hub_ok() and (desk_person_id = public.desk_me() or public.desk_is_owner()));
create policy desk_visits_add on public.desk_visits for insert to authenticated
  with check (public.desk_is_owner() and visitor_person_id = public.desk_me() and desk_person_id <> public.desk_me());
create policy desk_visits_change on public.desk_visits for update to authenticated
  using (public.desk_is_owner() and visitor_person_id = public.desk_me())
  with check (public.desk_is_owner() and visitor_person_id = public.desk_me() and desk_person_id <> public.desk_me());

drop policy if exists kind_words_read on public.kind_words;
drop policy if exists kind_words_clip on public.kind_words;
create policy kind_words_read on public.kind_words for select to authenticated
  using (public.desk_hub_ok() and public.desk_me() is not null and (status = 'kind' or public.desk_kind_decider()));
create policy kind_words_clip on public.kind_words for insert to authenticated
  with check (public.desk_hub_ok() and public.desk_me() is not null and status = 'kind' and created_by = public.desk_me()
              and decided_by is null and decided_at is null and suggested_by is null);

drop policy if exists kind_word_drops_read on public.kind_word_drops;
drop policy if exists kind_word_drops_change on public.kind_word_drops;
create policy kind_word_drops_read on public.kind_word_drops for select to authenticated using (public.desk_can_read(person_id));
create policy kind_word_drops_change on public.kind_word_drops for update to authenticated
  using (public.desk_can_write(person_id)) with check (public.desk_can_write(person_id));

-- ── what the browser may do at all (starting from nothing) ─────────────────────────────────────────────────────────
revoke all on public.desk_lines, public.desk_stickies, public.desk_pages, public.desk_settings, public.desk_visits,
              public.kind_words, public.kind_word_drops from public, anon, authenticated;
grant select, insert, update, delete on public.desk_lines, public.desk_stickies, public.desk_pages, public.desk_settings to authenticated;
grant select, insert, update on public.desk_visits to authenticated;
grant select, insert on public.kind_words to authenticated;
grant select, update on public.kind_word_drops to authenticated;
grant select, insert, update, delete on public.desk_lines, public.desk_stickies, public.desk_pages, public.desk_settings, public.desk_visits,
              public.kind_words, public.kind_word_drops to service_role;

-- ── the few things done on someone else's behalf, each checking for itself ─────────────────────────────────────────
create or replace function public.desk_star_line(p_line uuid, p_on boolean default true) returns boolean
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_me uuid := public.desk_me(); v_line record;
begin
  if not public.desk_is_owner() then raise exception 'Only an owner gives a star.' using errcode = '42501'; end if;
  select id, person_id, kind, done_at, erased_at into v_line from public.desk_lines where id = p_line;
  if v_line.id is null or v_line.erased_at is not null then raise exception 'That line is not there.' using errcode = '22023'; end if;
  if v_line.person_id = v_me then raise exception 'Stars are for someone else''s desk.' using errcode = '42501'; end if;
  if coalesce(p_on, true) and (v_line.kind <> 'todo' or v_line.done_at is null) then
    raise exception 'Stars go on finished lines.' using errcode = '22023';
  end if;
  update public.desk_lines
     set owner_star_by = case when coalesce(p_on, true) then v_me end,
         owner_star_at = case when coalesce(p_on, true) then now() end,
         updated_at = now(), rev = rev + 1
   where id = p_line;
  return true;
end $$;

create or replace function public.desk_set_has_desk(p_person uuid, p_on boolean) returns boolean
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if not public.desk_is_owner() then raise exception 'Only an owner turns a desk on or off.' using errcode = '42501'; end if;
  if not exists (select 1 from public.persons where person_id = p_person) then raise exception 'No such person.' using errcode = '22023'; end if;
  insert into public.desk_settings (person_id, has_desk, has_desk_by, has_desk_at)
  values (p_person, p_on, public.desk_me(), now())
  on conflict (person_id) do update set has_desk = excluded.has_desk, has_desk_by = excluded.has_desk_by, has_desk_at = excluded.has_desk_at, updated_at = now();
  return true;
end $$;

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

-- Keeping less: erased things are gone after 30 days, pages after 13 months (stamps on desk_pages stay, they hold no
-- words). Scheduled in Stage 1, when desks start holding anything. Server only.
create or replace function public.desk_tidy() returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare a int; b int; c int; d int;
begin
  delete from public.desk_lines where erased_at < now() - interval '30 days'; get diagnostics a = row_count;
  delete from public.desk_stickies where erased_at < now() - interval '30 days'; get diagnostics b = row_count;
  delete from public.desk_lines where place = 'day' and day < (now() at time zone 'America/Chicago')::date - interval '13 months'; get diagnostics c = row_count;
  delete from public.desk_visits where day < (now() at time zone 'America/Chicago')::date - interval '13 months'; get diagnostics d = row_count;
  return jsonb_build_object('erased_lines', a, 'erased_stickies', b, 'old_lines', c, 'old_visits', d);
end $$;

revoke all on function public.desk_me(), public.desk_hub_ok(), public.desk_is_owner(), public.desk_can_read(uuid), public.desk_can_write(uuid),
  public.desk_kind_decider(), public.desk_star_line(uuid, boolean), public.desk_set_has_desk(uuid, boolean), public.kind_word_decide(uuid, boolean),
  public.desk_tidy(), public.desk_guard_lines(), public.desk_guard_stickies(), public.desk_guard_settings(), public.desk_guard_drops() from public, anon;
grant execute on function public.desk_me(), public.desk_hub_ok(), public.desk_is_owner(), public.desk_can_read(uuid), public.desk_can_write(uuid),
  public.desk_kind_decider(), public.desk_star_line(uuid, boolean), public.desk_set_has_desk(uuid, boolean), public.kind_word_decide(uuid, boolean)
  to authenticated;
revoke all on function public.desk_tidy() from authenticated;
grant execute on function public.desk_tidy() to service_role;

comment on table public.desk_lines is 'My Desk (463): lines on a person''s own pages, Later folder and Stand-Up tray. Private: the person, plus owners read-only.';
comment on table public.desk_stickies is 'My Desk (463): sticky notes. Owners may leave signed notes (from_person_id) on someone else''s desk.';
comment on table public.kind_words is 'My Desk (463): the office''s shared Kind Words jar (status kind) and suggestions waiting for a person (suggested).';
