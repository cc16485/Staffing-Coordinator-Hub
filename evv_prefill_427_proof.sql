-- 427 · proof of the pre-filled EVV form, run by evv_prefill_427.py. NOTHING STAYS.
-- One DO block that always ends by raising 'PROBE_RESULT: {...}', so everything in it is rolled back.
--   1. As the server: make a made-up link for a made-up visit, and one already expired.
--   2. As the public form (anon): the table cannot be read; the link gives ONLY the allowed words; a form without the
--      client's signature is refused (and the link stays unused); a signed form is saved; the same link is then
--      refused ("used"); the expired link is refused; an unknown link says not_found.
--   3. As the server again: the saved form is linked to the caregiver, client and visit FROM THE ROW (whatever the
--      browser claimed), waiting for the office, and the link is marked used with that form's number.
--   4. The plain public form still works and still arrives unlinked whatever it claims.
-- No real name, phone or signature is used.
do $proof$
declare
  v_tok uuid := gen_random_uuid(); v_old uuid := gen_random_uuid(); v_nope uuid := gen_random_uuid();
  v_read text := 'refused'; v_ins text := 'refused';
  v_get jsonb; v_get_used jsonb; v_get_old jsonb; v_get_nope jsonb;
  v_nosig jsonb; v_ok jsonb; v_again jsonb; v_expired jsonb;
  v_sig constant text := 'data:image/png;base64,iVBORw0KGgo=';
  v_pay jsonb;
  s record; p record; v_plain record;
begin
  -- 1. the server makes two links
  insert into public.evv_prefill (token, created_by, axiscare_visit_id, caregiver_axiscare_id, client_axiscare_id, caregiver_name,
      client_display, client_name, visit_date, scheduled_in, scheduled_out, actual_in, which_missing)
    values (v_tok, 'proof 427', 'proof427-visit', 'proof427-cg', 'proof427-cl', 'Proof427 Caregiver', 'Proof C.', 'Proof427 Client',
      '2026-01-02', '09:00', '13:00', '09:12', 'in');
  insert into public.evv_prefill (token, created_by, expires_at, axiscare_visit_id, caregiver_axiscare_id, caregiver_name, client_display, visit_date)
    values (v_old, 'proof 427', now() - interval '1 minute', 'proof427-old', 'proof427-cg', 'Proof427 Caregiver', 'Proof C.', '2026-01-01');
  v_pay := jsonb_build_object('new_in', '09:00', 'new_out', '13:00', 'orig_in', '09:12', 'reason', 'Forgot to clock in or out',
    'notes', 'proof 427, never kept', 'sig_attendant', v_sig, 'sig_consumer', v_sig,
    -- claims the browser must not be able to make:
    'processed', true, 'outcome', 'accepted', 'caregiver_axiscare_id', 'evil', 'client_axiscare_id', 'evil', 'axiscare_visit_id', 'evil',
    'attendant', 'Someone Else', 'consumer', 'Another Client', 'visitdate', '2020-01-01');

  -- 2. the public form
  set local role anon;
  begin perform 1 from public.evv_prefill limit 1; v_read := 'READ'; exception when insufficient_privilege then v_read := 'refused'; end;
  begin insert into public.evv_prefill (axiscare_visit_id, caregiver_axiscare_id, caregiver_name, client_display, visit_date) values ('x', 'x', 'x', 'x', '2026-01-01'); v_ins := 'INSERTED';
  exception when insufficient_privilege then v_ins := 'refused'; end;
  v_get := public.evv_prefill_get(v_tok);
  v_nosig := public.evv_submit_prefilled(v_tok, v_pay - 'sig_consumer');
  v_ok := public.evv_submit_prefilled(v_tok, v_pay);
  v_again := public.evv_submit_prefilled(v_tok, v_pay);
  v_get_used := public.evv_prefill_get(v_tok);
  v_get_old := public.evv_prefill_get(v_old);
  v_expired := public.evv_submit_prefilled(v_old, v_pay);
  v_get_nope := public.evv_prefill_get(v_nope);
  insert into public.evv_submissions (attendant, consumer, visitdate, new_in, new_out, reason, notes, sig_attendant, sig_consumer, processed, submitted_at,
      caregiver_axiscare_id, client_axiscare_id, axiscare_visit_id, linked_by, outcome)
    values ('Proof427 Plain', 'Proof427 Client', '2026-01-03', '08:00', '12:00', 'Other', 'proof 427 plain', v_sig, v_sig, true, now(),
      'evil', 'evil', 'evil', 'axiscare-visit', 'accepted');
  reset role;

  -- 3. what was saved
  select * into s from public.evv_submissions where notes = 'proof 427, never kept';
  select * into p from public.evv_prefill where token = v_tok;
  select processed, outcome, caregiver_axiscare_id, client_axiscare_id, axiscare_visit_id, linked_by into v_plain
    from public.evv_submissions where attendant = 'Proof427 Plain';

  raise exception 'PROBE_RESULT: %', jsonb_build_object(
    'anon_read_table', v_read, 'anon_insert_table', v_ins,
    'get', v_get, 'get_keys', (select jsonb_agg(k order by k) from jsonb_object_keys(v_get) k),
    'nosig', v_nosig, 'submit', v_ok, 'again', v_again, 'get_used', v_get_used, 'get_expired', v_get_old, 'submit_expired', v_expired, 'get_unknown', v_get_nope,
    'saved', jsonb_build_object('found', s.id is not null, 'id_matches', s.id::text = (v_ok->>'id'),
       'attendant', s.attendant, 'consumer', s.consumer, 'visitdate', s.visitdate::text, 'new_in', left(s.new_in::text, 5),
       'processed', s.processed, 'outcome', s.outcome, 'cg', s.caregiver_axiscare_id, 'cl', s.client_axiscare_id, 'visit', s.axiscare_visit_id,
       'linked_by', s.linked_by, 'cl_name', s.client_linked_name, 'both_sigs', (s.sig_attendant = v_sig and s.sig_consumer = v_sig)),
    'link_used', p.used_at is not null, 'link_points_to_form', p.submission_id::text = (v_ok->>'id'),
    'plain_wiped', (v_plain.processed is false and v_plain.outcome is null and v_plain.caregiver_axiscare_id is null and v_plain.client_axiscare_id is null
                    and v_plain.axiscare_visit_id is null and v_plain.linked_by is null),
    'anon_can', jsonb_build_object('prefill_select', has_table_privilege('anon', 'public.evv_prefill', 'SELECT'),
       'get', has_function_privilege('anon', 'public.evv_prefill_get(uuid)', 'EXECUTE'),
       'submit', has_function_privilege('anon', 'public.evv_submit_prefilled(uuid, jsonb)', 'EXECUTE'),
       'forms_insert', has_table_privilege('anon', 'public.evv_submissions', 'INSERT'),
       'forms_select', has_table_privilege('anon', 'public.evv_submissions', 'SELECT')));
end
$proof$;
