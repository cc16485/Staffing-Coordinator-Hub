-- caregiver_profile_2b.sql (Desktop 410, 2026-10-01). Caregiver profile, part 2, slice 2b: both family messages use the
-- ONE caregiver profile card (caregiver_profiles, shown at cc.mo-care.com/caregiver.html?id=<id>).
--
-- Samantha: one profile for "introduce your caregiver" and for "caregiver change". Until now the change text linked to
-- the older short intro list (caregiver_intros, meet.html?cg=<id>). This moves that list into caregiver_profiles:
--
--   • Each intro becomes a profile (first name and last name split from its name; about = its about, else its intro
--     line; its photo address kept in the new photo_url column, used only until a proper photo is uploaded).
--   • Those intros were ALREADY shown to families through meet.html, so the moved profiles are published (status
--     approved) and keep being linked. Their permission was never recorded, so consent stays false and the new
--     needs_review flag is on: the Hub panel says "Older profile: check the words, add a proper photo and get their OK".
--   • legacy_intro_id remembers which intro a profile came from, so an old meet.html?cg=<id> link in a family's
--     phone opens the new card (caregiver-card ?legacy=<id>).
--   • If a profile for the same person already exists (exact full name, exactly one), only legacy_intro_id is set on
--     it; no duplicate. If the name matches a WITHDRAWN profile (they took their permission back) or more than one
--     profile, nothing is created: the office decides. meet.html keeps working for those through the old function.
--   • Their AxisCare caregiver id is filled in only where it is certain: exactly one roster entry (app_data
--     'caregivers') with that exact full name, and no other live profile already holds that id. Otherwise the
--     employee page offers "Is this Sarah's profile? Link it".
-- Run as one transaction. Safe to run again (every step only touches intros or profiles not handled yet).

alter table public.caregiver_profiles
  add column if not exists photo_url       text,                            -- an older intro's photo address (https)
  add column if not exists legacy_intro_id text,                            -- caregiver_intros.id it was moved from
  add column if not exists needs_review    boolean not null default false;  -- older profile: words, photo, their OK

create unique index if not exists caregiver_profiles_legacy_intro_uniq
  on public.caregiver_profiles (legacy_intro_id) where legacy_intro_id is not null;

-- ── 1. An intro whose person already has exactly one profile: just remember the link ──
with intro as (
  select i.id::text as intro_id, lower(regexp_replace(btrim(i.name), '\s+', ' ', 'g')) as k
    from public.caregiver_intros i
   where coalesce(btrim(i.name), '') <> ''
     and not exists (select 1 from public.caregiver_profiles x where x.legacy_intro_id = i.id::text)
),
cand as (
  select intro.intro_id, p.id as pid
    from intro
    join public.caregiver_profiles p
      on coalesce(btrim(p.last_name), '') <> ''
     and intro.k in (lower(regexp_replace(btrim(p.first_name) || ' ' || btrim(p.last_name), '\s+', ' ', 'g')),
                     lower(regexp_replace(btrim(coalesce(p.preferred_name, '')) || ' ' || btrim(p.last_name), '\s+', ' ', 'g')))
),
uniq as (
  select intro_id, (array_agg(pid))[1] as pid
    from cand group by intro_id having count(distinct pid) = 1
)
update public.caregiver_profiles p
   set legacy_intro_id = u.intro_id, updated_at = now()
  from uniq u
 where p.id = u.pid
   and p.legacy_intro_id is null
   and p.status <> 'withdrawn'                                   -- a withdrawn profile is never revived
   and (select count(*) from uniq u2 where u2.pid = p.id) = 1;   -- two intros, one person: the office decides

-- ── 2. Every other intro becomes a published profile flagged for review ──
insert into public.caregiver_profiles
  (first_name, last_name, about, photo_url, legacy_intro_id, published, status, consent, needs_review,
   published_at, published_by, updated_at)
select split_part(n.full_name, ' ', 1),
       nullif(btrim(substr(n.full_name, length(split_part(n.full_name, ' ', 1)) + 1)), ''),
       nullif(btrim(regexp_replace(coalesce(nullif(btrim(i.about), ''), i.intro, ''), '\s*[\u2014\u2015]\s*', ', ', 'g')), ''),
       case when btrim(coalesce(i.photo_url, '')) ~* '^https://[^\s"''<>]+$' then btrim(i.photo_url) end,
       i.id::text, true, 'approved', false, true,
       now(), 'moved from the older intro list (2b)', now()
  from public.caregiver_intros i
  cross join lateral (select regexp_replace(btrim(i.name), '\s+', ' ', 'g') as full_name) n
 where coalesce(btrim(i.name), '') <> ''
   and not exists (select 1 from public.caregiver_profiles x where x.legacy_intro_id = i.id::text)
   -- any profile with the same full name (live, withdrawn, or more than one): leave it for the office
   and not exists (
     select 1 from public.caregiver_profiles p
      where coalesce(btrim(p.last_name), '') <> ''
        and lower(n.full_name) in (lower(regexp_replace(btrim(p.first_name) || ' ' || btrim(p.last_name), '\s+', ' ', 'g')),
                                   lower(regexp_replace(btrim(coalesce(p.preferred_name, '')) || ' ' || btrim(p.last_name), '\s+', ' ', 'g'))));

-- ── 3. Their AxisCare caregiver id, only where it is certain ──
with roster as (
  select lower(regexp_replace(btrim(coalesce(e->>'first', '') || ' ' || coalesce(e->>'last', '')), '\s+', ' ', 'g')) as k,
         nullif(btrim(e->>'axiscare_id'), '') as ax
    from public.app_data ad,
         lateral jsonb_array_elements(case when jsonb_typeof(ad.data) = 'array' then ad.data else '[]'::jsonb end) e
   where ad.key = 'caregivers' and jsonb_typeof(e) = 'object'
),
one as (
  select k, min(ax) as ax from roster
   where ax is not null and k like '% %'
   group by k having count(distinct ax) = 1
),
tgt as (
  select p.id, one.ax
    from public.caregiver_profiles p
    join one on one.k = lower(regexp_replace(btrim(p.first_name) || ' ' || btrim(coalesce(p.last_name, '')), '\s+', ' ', 'g'))
   where p.legacy_intro_id is not null and p.needs_review and p.axiscare_id is null and p.status <> 'withdrawn'
)
update public.caregiver_profiles p
   set axiscare_id = t.ax, updated_at = now()
  from tgt t
 where p.id = t.id
   and p.axiscare_id is null
   and (select count(*) from tgt t2 where t2.ax = t.ax) = 1
   and not exists (select 1 from public.caregiver_profiles o
                    where o.axiscare_id = t.ax and o.id <> p.id and o.status <> 'withdrawn');
