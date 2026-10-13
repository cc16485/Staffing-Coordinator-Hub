-- 647 · APPLICANT RECORDS, INTERVIEW BOOKINGS, RECORDINGS AND TRANSCRIPTS: OFFICE ONLY (Samantha 2026-10-13, "build",
-- step 1 of the interview notes and AI review; her reviewer's point 4: "Other Hub users should not be able to access
-- interview recordings, transcripts, or observations through direct links or APIs").
-- Until now each of these was open to anyone signed in on any of the three hubs (using (true)). From here only a signed-in
-- office member passes: public.hub_office_ok() = the CC Hub sign-in plus a cc_ihs role of owner_admin, care_coordinator or
-- staffing_coordinator (578). 646 counted 3 sign-ins keep access, 2 unlinked and unused CC Hub sign-ins lose it.
-- Unchanged: the apply page and booking page (signed out, through owner-run functions), every server function (server
-- key), the triggers. All in one transaction: it all goes in or nothing does.
begin;

-- 1 · the four tables: replace the open rule with the office rule ----------------------------------------------------
drop policy if exists job_applicants_auth_all on public.job_applicants;
drop policy if exists job_applicants_office on public.job_applicants;
create policy job_applicants_office on public.job_applicants for all to authenticated
  using (public.hub_office_ok()) with check (public.hub_office_ok());

drop policy if exists interview_bookings_auth on public.interview_bookings;
drop policy if exists interview_bookings_office on public.interview_bookings;
create policy interview_bookings_office on public.interview_bookings for all to authenticated
  using (public.hub_office_ok()) with check (public.hub_office_ok());

drop policy if exists recordings_auth on public.recordings;
drop policy if exists recordings_office on public.recordings;
create policy recordings_office on public.recordings for all to authenticated
  using (public.hub_office_ok()) with check (public.hub_office_ok());

drop policy if exists recordings_settings_read on public.recordings_settings;
drop policy if exists recordings_settings_office_read on public.recordings_settings;
create policy recordings_settings_office_read on public.recordings_settings for select to authenticated
  using (public.hub_office_ok());

-- 2 · the audio files (private 'recordings' bucket): same office rule ------------------------------------------------
drop policy if exists recordings_read on storage.objects;
drop policy if exists recordings_insert on storage.objects;
drop policy if exists recordings_delete on storage.objects;
create policy recordings_read on storage.objects for select to authenticated
  using (bucket_id = 'recordings' and public.hub_office_ok());
create policy recordings_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'recordings' and public.hub_office_ok());
create policy recordings_delete on storage.objects for delete to authenticated
  using (bucket_id = 'recordings' and public.hub_office_ok());

-- 3 · functions that handed these out to any sign-in ------------------------------------------------------------------
-- The purge list (storage paths of old audio) is only read by the purge-recordings server function (server key).
revoke execute on function public.recordings_due_for_purge() from public, anon, authenticated;
-- The office's phone-screen answers: was "anyone signed in", now office only. The live definition is edited in place
-- (one line), so nothing else in it changes; it stops if that line is not exactly there.
do $$
declare d text; o text := 'if coalesce(auth.role(),''anon'') <> ''authenticated'' then raise exception ''sign in first''; end if;';
begin
  d := pg_get_functiondef('public.applicant_screen_by_office(uuid, boolean, boolean, boolean, boolean, boolean)'::regprocedure);
  if position('hub_office_ok' in d) > 0 then return; end if;   -- already done
  if position(o in d) = 0 then raise exception '647: applicant_screen_by_office is not the expected version; nothing changed'; end if;
  execute replace(d, o, 'if not public.hub_office_ok() then raise exception ''office staff only''; end if;');
end $$;

-- 4 · nothing else may stay open (permissive rules add up, so one stray open rule would undo all of this) -------------
do $$
declare n int;
begin
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename in ('job_applicants','interview_bookings','recordings','recordings_settings')
     and position('hub_office_ok' in coalesce(qual, '') || coalesce(with_check, '')) = 0;
  if n > 0 then raise exception '647: % other rule(s) on these tables would keep them open; nothing changed', n; end if;
  select count(*) into n from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and position('''recordings''' in coalesce(qual,'') || coalesce(with_check,'')) > 0
     and position('hub_office_ok' in coalesce(qual, '') || coalesce(with_check, '')) = 0;
  if n > 0 then raise exception '647: % other rule(s) on the audio files would keep them open; nothing changed', n; end if;
end $$;
commit;
