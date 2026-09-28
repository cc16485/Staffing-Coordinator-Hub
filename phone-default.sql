-- =============================================================================
-- phone-default.sql · a number is never safe to text by default
-- =============================================================================
-- phone_index.confidence still defaults to 'confirmed' on the live database (fix-phone-provenance.sql never ran
-- there; found 2026-09-28 when the 38 family numbers came back 'confirmed'). So any code that saves a number without
-- saying where it came from makes it safe for automatic texting. The default becomes 'probable': trust has to be
-- stated. Existing rows are not touched. identity-backfill (client numbers from AxisCare) now states its source, so
-- nothing that works today changes.
-- =============================================================================
begin;

do $guard$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'phone_index' and column_name = 'confidence') then
    raise exception 'phone default refused: phone_index.confidence not found. Nothing was changed.'; end if;
  if (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'phone_index' and column_name = 'confidence') like '%probable%' then
    raise exception 'phone default refused: already probable. Nothing was changed.'; end if;
end $guard$;

alter table public.phone_index alter column confidence set default 'probable';
comment on column public.phone_index.confidence is
  'confirmed = an authoritative source, or independently corroborated. probable = plausible but resting on one weak '
  'signal. DEFAULTS TO PROBABLE: a writer that does not state its evidence does not get trusted.';

do $verify$ begin
  if (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'phone_index' and column_name = 'confidence') not like '%probable%' then
    raise exception 'phone default self-check: the default did not change'; end if;
  raise notice 'phone default is probable';
end $verify$;
commit;
