-- open_slots_live_510b.sql: the LIVE open-times rules as read by Desktop 510b on 2026-10-08 (they exist only in the database,
-- not in any other file). Kept for tests and as the record of what they were. Not run by any Desktop step.

CREATE OR REPLACE FUNCTION public.open_slots(p_activity text DEFAULT 'interview'::text)
 RETURNS TABLE(starts_at timestamp with time zone, ends_at timestamp with time zone, who_free integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a public.activity_types;
begin
  select * into a from public.activity_types where key = p_activity;
  if not found then return; end if;

  return query
  with days as (
    select (current_date + i) as d from generate_series(0, a.horizon_days) i
  ),
  blocks as (
    select av.coordinator_id,
           ((d.d + av.start_time) at time zone 'America/Chicago') as block_start,
           ((d.d + av.end_time)   at time zone 'America/Chicago') as block_end
    from days d
    join public.coordinator_availability av
      on av.active and av.activity = p_activity
     and av.day_of_week = extract(dow from d.d)::int
    join public.coordinators c on c.id = av.coordinator_id and c.active
  ),
  slots as (
    select b.coordinator_id,
           b.block_start + (n * (a.minutes || ' minutes')::interval) as st
    from blocks b,
         generate_series(0, greatest(0,
           (extract(epoch from (b.block_end - b.block_start)) / 60 / a.minutes)::int - 1)) n
  ),
  free as (
    select s.st, s.coordinator_id
    from slots s
    where s.st > now() + (a.lead_hours || ' hours')::interval
      -- Anything of another kind blocks outright. You cannot be at an
      -- orientation and an interview at once, whatever the dial says.
      and not exists (
        select 1 from public.coordinator_busy cb
        where (cb.coordinator_id is null or cb.coordinator_id = s.coordinator_id)
          and cb.source is distinct from p_activity
          and cb.starts_at < s.st + (a.minutes || ' minutes')::interval
          and cb.ends_at   > s.st)
      -- And of this kind, up to per_slot.
      and (
        select count(*) from public.coordinator_busy cb
        where (cb.coordinator_id is null or cb.coordinator_id = s.coordinator_id)
          and cb.source = p_activity
          and cb.starts_at < s.st + (a.minutes || ' minutes')::interval
          and cb.ends_at   > s.st) < a.per_slot
  )
  select f.st, f.st + (a.minutes || ' minutes')::interval, count(distinct f.coordinator_id)::int
  from free f group by f.st order by f.st;
end $function$;

CREATE OR REPLACE FUNCTION public.interview_open_slots()
 RETURNS TABLE(starts_at timestamp with time zone, ends_at timestamp with time zone, hosts_free integer)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select starts_at, ends_at, who_free from public.open_slots('interview');
$function$;

CREATE OR REPLACE FUNCTION public.welcome_open_slots()
 RETURNS TABLE(starts_at timestamp with time zone, ends_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with days as (select (current_date + i) as d from generate_series(0, 14) i),
  blocks as (
    select distinct ((d.d + av.start_time) at time zone 'America/Chicago') as bs,
                    ((d.d + av.end_time)   at time zone 'America/Chicago') as be
    from days d
    join public.coordinator_availability av on av.active and av.activity = 'interview'
     and av.day_of_week = extract(dow from d.d)::int
    join public.coordinators c on c.id = av.coordinator_id and c.active),
  slots as (
    select distinct b.bs + (n * interval '15 minutes') as st
    from blocks b, generate_series(0, greatest(0, (extract(epoch from (b.be - b.bs)) / 900)::int - 1)) n)
  select s.st, s.st + interval '15 minutes'
  from slots s
  where s.st > now() + interval '2 hours'
    and not exists (
      select 1 from public.coordinator_busy cb
      where (cb.coordinator_id is null or cb.source in ('interview', 'welcome_call'))
        and cb.starts_at < s.st + interval '15 minutes' and cb.ends_at > s.st)
  order by s.st;
$function$;

