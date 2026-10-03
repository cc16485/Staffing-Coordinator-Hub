-- 429 · proof of the client-signature steps, run by evv_signature_429.py. NOTHING STAYS.
-- One DO block that always ends by raising 'PROBE_RESULT: {...}', so everything in it is rolled back.
--   1. The caregiver sends her part from a made-up pre-filled link with "the client signs at my next visit": saved as
--      waiting, a client-signature link is made. Without that choice and without a client signature: still refused.
--   2. The public (anon): cannot read the link table; the client page shows only the caregiver's part; a signature
--      without the confirmation tick is refused; extra answers in the request change nothing; the signature is saved;
--      the same link is then refused. An unknown link is not_found.
--   3. The plain public form: with a client signature it arrives "signed", without one "waiting"; whatever it claims
--      about a phone call is wiped.
--   4. A signed-in office member (made-up proof identity): cannot write a signature or a phone record directly, cannot
--      accept a waiting form, can dismiss; records "Verified by phone" through its step (who = the sign-in); the
--      public cannot use that step. Then the verified form can be accepted.
-- No real name, phone or signature is used.
do $proof$
declare
  v_tok uuid := gen_random_uuid(); v_tok2 uuid := gen_random_uuid(); v_nope uuid := gen_random_uuid();
  v_sig constant text := 'data:image/png;base64,iVBORw0KGgo=';
  v_pay jsonb; v_nolater jsonb; v_later jsonb; v_signed_now jsonb;
  v_sign_tok uuid; v_read text := 'refused'; v_get jsonb; v_get_keys jsonb; v_noconf jsonb; v_ok jsonb; v_again jsonb; v_get_after jsonb; v_unknown jsonb;
  s record; s2 record; p1 record; p2 record; v_plain_signed text; v_plain_wait text; v_plain_phone text;
  v_direct text := 'allowed'; v_accept text := 'allowed'; v_dismiss int := 0; v_phone jsonb; v_phone_anon text := 'allowed'; v_after record; v_accept2 int := 0;
  v_sign_closed boolean; v_plain_id uuid := gen_random_uuid(); v_plain2_id uuid := gen_random_uuid();
begin
  insert into public.evv_prefill (token, created_by, axiscare_visit_id, caregiver_axiscare_id, client_axiscare_id, caregiver_name,
      client_display, client_name, visit_date, scheduled_in, scheduled_out, which_missing)
    values (v_tok, 'proof 429', 'proof429-visit', 'proof429-cg', 'proof429-cl', 'Proof429 Caregiver', 'Proof C.', 'Proof429 Client',
      '2026-01-02', '09:00', '13:00', 'out'),
           (v_tok2, 'proof 429', 'proof429-visit2', 'proof429-cg', 'proof429-cl', 'Proof429 Caregiver', 'Proof C.', 'Proof429 Client',
      '2026-01-03', '09:00', '13:00', 'out');
  v_pay := jsonb_build_object('new_in', '09:00', 'new_out', '13:00', 'reason', 'Forgot to clock in or out', 'notes', 'proof 429, never kept', 'sig_attendant', v_sig);

  -- 1 + 2. the caregiver, then the client, as the public
  set local role anon;
  v_nolater := public.evv_submit_prefilled(v_tok, v_pay);
  v_later := public.evv_submit_prefilled(v_tok, v_pay || jsonb_build_object('client_signs_later', true));
  v_signed_now := public.evv_submit_prefilled(v_tok2, v_pay || jsonb_build_object('sig_consumer', v_sig, 'notes', 'proof 429 signed now'));
  begin perform 1 from public.evv_sign limit 1; v_read := 'READ'; exception when insufficient_privilege then v_read := 'refused'; end;
  reset role;
  select token into v_sign_tok from public.evv_sign where submission_id = (v_later->>'id')::uuid;
  set local role anon;
  v_get := public.evv_sign_get(v_sign_tok);
  v_noconf := public.evv_sign_submit(v_sign_tok, jsonb_build_object('sig_consumer', v_sig));
  v_ok := public.evv_sign_submit(v_sign_tok, jsonb_build_object('sig_consumer', v_sig, 'confirm', true,
            'new_in', '05:00', 'new_out', '23:00', 'notes', 'changed by the public', 'processed', true, 'outcome', 'accepted', 'sig_attendant', 'data:image/png;base64,AAAA'));
  v_again := public.evv_sign_submit(v_sign_tok, jsonb_build_object('sig_consumer', v_sig, 'confirm', true));
  v_get_after := public.evv_sign_get(v_sign_tok);
  v_unknown := public.evv_sign_get(v_nope);

  -- 3. the plain public form
  insert into public.evv_submissions (id, attendant, consumer, visitdate, new_in, new_out, reason, notes, sig_attendant, sig_consumer, processed, submitted_at,
      client_sig_status, phone_verified_by, phone_verified_confirmed)
    values (v_plain_id, 'Proof429 Plain', 'Proof429 Client', '2026-01-04', '08:00', '12:00', 'Other', 'proof 429 plain signed', v_sig, v_sig, true, now(), 'phone_verified', 'evil', true);
  insert into public.evv_submissions (id, attendant, consumer, visitdate, new_in, new_out, reason, notes, sig_attendant, processed, submitted_at,
      client_sig_status, phone_verified_by, phone_verified_confirmed, phone_call_at)
    values (v_plain2_id, 'Proof429 Plain', 'Proof429 Client', '2026-01-05', '08:00', '12:00', 'Other', 'proof 429 plain waiting', v_sig, false, now(), 'phone_verified', 'evil', true, now());
  reset role;
  select client_sig_status into v_plain_signed from public.evv_submissions where id = v_plain_id;
  select client_sig_status, coalesce(phone_verified_by, '') || coalesce(phone_verified_confirmed::text, '') || coalesce(phone_call_at::text, '') into v_plain_wait, v_plain_phone
    from public.evv_submissions where id = v_plain2_id;
  select * into s from public.evv_submissions where id = (v_later->>'id')::uuid;
  select * into s2 from public.evv_submissions where id = (v_signed_now->>'id')::uuid;

  -- 4. a signed-in office member
  perform set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000429","email":"proof-429@invalid.test"}', true);
  set local role authenticated;
  begin update public.evv_submissions set sig_consumer = v_sig where id = v_plain2_id; v_direct := 'CHANGED';
  exception when others then v_direct := 'refused'; end;
  begin update public.evv_submissions set client_sig_status = 'phone_verified' where id = v_plain2_id; v_direct := v_direct || ',CHANGED';
  exception when others then v_direct := v_direct || ',refused'; end;
  begin update public.evv_submissions set processed = true, outcome = 'accepted', processed_by = 'proof-429@invalid.test', processed_at = now() where id = v_plain2_id; v_accept := 'ACCEPTED';
  exception when others then v_accept := 'refused'; end;
  v_phone := public.evv_client_phone_record(v_plain2_id, jsonb_build_object('outcome', 'phone_verified', 'spoke_with', 'Proof Daughter', 'relationship', 'daughter',
               'call_at', to_char(now() - interval '5 minutes', 'YYYY-MM-DD"T"HH24:MI:SSOF'), 'confirmed', true, 'notes', 'proof 429 call', 'by', 'someone-else@invalid.test'));
  update public.evv_submissions set processed = true, outcome = 'accepted', processed_by = 'proof-429@invalid.test', processed_at = now() where id = v_plain2_id;
  get diagnostics v_accept2 = row_count;
  update public.evv_submissions set processed = true, outcome = 'dismissed', processed_by = 'proof-429@invalid.test', processed_at = now() where id = (v_signed_now->>'id')::uuid;
  get diagnostics v_dismiss = row_count;
  reset role;
  select * into v_after from public.evv_submissions where id = v_plain2_id;
  set local role anon;
  begin perform public.evv_client_phone_record(v_plain_id, jsonb_build_object('outcome', 'refused')); v_phone_anon := 'ALLOWED';
  exception when insufficient_privilege then v_phone_anon := 'refused'; end;
  reset role;
  select (closed_at is not null or used_at is not null) into v_sign_closed from public.evv_sign where submission_id = (v_later->>'id')::uuid;

  raise exception 'PROBE_RESULT: %', jsonb_build_object(
    'nolater', v_nolater, 'later', v_later - 'id', 'signed_now', v_signed_now - 'id',
    'anon_read_sign', v_read, 'get', v_get - 'sig_attendant' - 'notes', 'get_keys', (select jsonb_agg(k order by k) from jsonb_object_keys(v_get) k),
    'noconf', v_noconf, 'sign', v_ok, 'again', v_again, 'get_after', v_get_after, 'unknown', v_unknown,
    'waiting_form', jsonb_build_object('status_now', s.client_sig_status, 'via', s.client_sign_via, 'signed_at', s.client_signed_at is not null,
       'new_in', left(s.new_in::text, 5), 'new_out', left(s.new_out::text, 5), 'notes', s.notes, 'processed', s.processed, 'outcome', s.outcome,
       'sig_attendant_kept', s.sig_attendant = v_sig, 'sig_consumer', s.sig_consumer = v_sig, 'linked', s.caregiver_axiscare_id = 'proof429-cg' and s.axiscare_visit_id = 'proof429-visit'),
    'signed_form', jsonb_build_object('status', s2.client_sig_status, 'via', s2.client_sign_via),
    'plain_signed', v_plain_signed, 'plain_waiting', v_plain_wait, 'plain_phone_wiped', v_plain_phone = '',
    'staff_direct', v_direct, 'staff_accept_waiting', v_accept, 'phone', v_phone, 'accept_after_phone', v_accept2, 'dismiss', v_dismiss,
    'phone_row', jsonb_build_object('status', v_after.client_sig_status, 'by', v_after.phone_verified_by, 'with', v_after.phone_verified_with,
       'rel', v_after.phone_verified_relationship, 'confirmed', v_after.phone_verified_confirmed, 'call_at', v_after.phone_call_at is not null, 'outcome', v_after.outcome),
    'anon_phone', v_phone_anon, 'sign_link_done', v_sign_closed,
    'anon_can', jsonb_build_object('sign_select', has_table_privilege('anon', 'public.evv_sign', 'SELECT'),
       'get', has_function_privilege('anon', 'public.evv_sign_get(uuid)', 'EXECUTE'), 'submit', has_function_privilege('anon', 'public.evv_sign_submit(uuid, jsonb)', 'EXECUTE'),
       'phone', has_function_privilege('anon', 'public.evv_client_phone_record(uuid, jsonb)', 'EXECUTE'),
       'forms_insert', has_table_privilege('anon', 'public.evv_submissions', 'INSERT'), 'forms_select', has_table_privilege('anon', 'public.evv_submissions', 'SELECT')));
end
$proof$;
