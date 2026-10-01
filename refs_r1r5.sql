-- ============================================================================
-- REFERENCES R1–R5, server side (Desktop 375). Samantha approved 2026-10-01 ("yes to all"). SHARED HUB PROJECT.
-- Safe to run again. Spec: ~/Claude/refs-r1r5/SPEC.md
--
-- Each reference is Professional or Personal, with its own questions. Professional verifies the employer, dates of
-- employment, title, hours and rehire eligibility; personal asks how they know them (now saved) and whether they'd
-- trust them with their own family. The Hub makes a PDF of each completed reference (pdf_path).
-- The reference saves through reference_answer() only (see below): its own answers, once.
-- ============================================================================
alter table public.reference_requests
  add column if not exists ref_type           text check (ref_type is null or ref_type in ('professional', 'personal')),
  add column if not exists ref_company        text,
  add column if not exists rel_answer         text,
  add column if not exists employer_confirmed text,
  add column if not exists emp_from           text,
  add column if not exists emp_to             text,
  add column if not exists job_title          text,
  add column if not exists hours_type         text check (hours_type is null or hours_type in ('full', 'part', 'both', 'unsure')),
  add column if not exists rehire             text check (rehire is null or rehire in ('yes', 'no', 'policy')),
  add column if not exists trust_family       text check (trust_family is null or trust_family in ('yes', 'reservations', 'no')),
  add column if not exists responder_title    text,
  add column if not exists pdf_path           text;

-- 375a (2026-10-01) proved the online form NEVER saved: anon could UPDATE the answer columns but had no SELECT, so
-- "update ... where id = <link>" matched 0 rows, silently (0 of 20 requests ever answered). The form now saves through
-- ONE security-definer function: it needs the link's id (unguessable), saves only while unanswered, accepts only the
-- answer fields with checked values and length caps, and stamps responded_at. anon gets no table access at all.
revoke update on public.reference_requests from anon;
revoke all on public.reference_requests from anon;

create or replace function public.reference_answer(p_id uuid, p_answers jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  a jsonb := coalesce(p_answers, '{}'::jsonb);
  t text;
  v_hit int;
  scale text[] := array['Excellent','Good','Fair','Poor'];
begin
  if p_id is null or jsonb_typeof(a) <> 'object' then return 'not_found'; end if;
  if not exists (select 1 from reference_requests where id = p_id) then return 'not_found'; end if;
  if exists (select 1 from reference_requests where id = p_id and responded_at is not null) then return 'already'; end if;
  -- only known keys
  for t in select jsonb_object_keys(a) loop
    if t not in ('recommend','reliability','interpersonal','honesty','concerns','how_long','notes','responder_name','rel_answer',
                 'employer_confirmed','emp_from','emp_to','job_title','hours_type','rehire','trust_family','responder_title') then
      raise exception 'unknown answer: %', t;
    end if;
  end loop;
  if coalesce(a->>'recommend','') not in ('yes','reservations','no') then raise exception 'recommend is required'; end if;
  if nullif(btrim(a->>'responder_name'),'') is null then raise exception 'your name is required'; end if;
  if a ? 'concerns' and a->>'concerns' not in ('none','minor','serious') then raise exception 'bad concerns'; end if;
  if a ? 'reliability' and not (a->>'reliability' = any(scale)) then raise exception 'bad reliability'; end if;
  if a ? 'interpersonal' and not (a->>'interpersonal' = any(scale)) then raise exception 'bad interpersonal'; end if;
  if a ? 'honesty' and not (a->>'honesty' = any(scale)) then raise exception 'bad honesty'; end if;
  if a ? 'hours_type' and a->>'hours_type' not in ('full','part','both','unsure') then raise exception 'bad hours'; end if;
  if a ? 'rehire' and a->>'rehire' not in ('yes','no','policy') then raise exception 'bad rehire'; end if;
  if a ? 'trust_family' and a->>'trust_family' not in ('yes','reservations','no') then raise exception 'bad trust_family'; end if;

  update reference_requests set
    responded_at       = now(),
    recommend          = a->>'recommend',
    reliability        = a->>'reliability',
    interpersonal      = a->>'interpersonal',
    honesty            = a->>'honesty',
    concerns           = a->>'concerns',
    how_long           = left(nullif(btrim(a->>'how_long'),''), 120),
    notes              = left(nullif(btrim(a->>'notes'),''), 4000),
    responder_name     = left(btrim(a->>'responder_name'), 120),
    rel_answer         = left(nullif(btrim(a->>'rel_answer'),''), 200),
    employer_confirmed = left(nullif(btrim(a->>'employer_confirmed'),''), 160),
    emp_from           = left(nullif(btrim(a->>'emp_from'),''), 40),
    emp_to             = left(nullif(btrim(a->>'emp_to'),''), 40),
    job_title          = left(nullif(btrim(a->>'job_title'),''), 120),
    hours_type         = a->>'hours_type',
    rehire             = a->>'rehire',
    trust_family       = a->>'trust_family',
    responder_title    = left(nullif(btrim(a->>'responder_title'),''), 120)
  where id = p_id and responded_at is null;
  get diagnostics v_hit = row_count;
  return case when v_hit = 1 then 'saved' else 'already' end;
end $$;
revoke all on function public.reference_answer(uuid, jsonb) from public;
grant execute on function public.reference_answer(uuid, jsonb) to anon, authenticated;

-- The start form: "I haven't worked for an employer before" (then no professional reference is required).
alter table public.hire_intake add column if not exists no_employer_history boolean;
grant select (no_employer_history) on public.hire_intake to authenticated;
