-- 422 · proof of the EVV form permissions, run by evv_forms_422.py. NOTHING STAYS.
-- One DO block that always ends by raising 'PROBE_RESULT: {...}', so everything in it is rolled back.
--   1. As the public form (role anon): send a made-up form that CLAIMS to be accepted, linked and checked in AxisCare,
--      then try to read the table.  Expect: the send works, the claims are wiped (waiting, unlinked), the read is refused.
--   2. As a signed-in office member (role authenticated, a made-up proof identity): read that one form by its number,
--      then link it and mark it accepted.  Expect: exactly one row read, one row changed.
--   3. Permissions as they now stand: the public can send only; staff can read and update, not empty the table.
-- The made-up form never holds a real name, phone or signature.
do $proof$
declare
  v_id uuid := gen_random_uuid();
  v_anon_insert text := 'refused'; v_anon_read text := 'refused';
  v_proc boolean; v_outcome text; v_cg text; v_cl text; v_done timestamptz; v_by text;
  v_staff_read int := 0; v_staff_upd int := 0; v_after_outcome text; v_after_cg text;
begin
  -- 1. the public form
  set local role anon;
  begin
    insert into public.evv_submissions (id, attendant, consumer, visitdate, new_in, new_out, reason, notes,
        sig_attendant, sig_consumer, processed, submitted_at,
        processed_by, outcome, caregiver_axiscare_id, client_axiscare_id, linked_by, axiscare_done_at, axiscare_visit_id)
      values (v_id, 'Proof422 Caregiver', 'Proof422 Client', current_date, '08:00', '14:00', 'Other', 'proof 422, never kept',
        'data:image/png;base64,iVBORw0KGgo=', 'data:image/png;base64,iVBORw0KGgo=', true, now(),
        'someone', 'accepted', '999001', '999002', 'someone', now(), 's=1:d=2026-01-01');
    v_anon_insert := 'sent';
  exception when others then v_anon_insert := 'refused: ' || sqlerrm;
  end;
  begin
    perform 1 from public.evv_submissions limit 1;
    v_anon_read := 'READ';
  exception when insufficient_privilege then v_anon_read := 'refused';
  end;
  reset role;
  select processed, outcome, caregiver_axiscare_id, client_axiscare_id, axiscare_done_at, processed_by
    into v_proc, v_outcome, v_cg, v_cl, v_done, v_by from public.evv_submissions where id = v_id;

  -- 2. a signed-in office member
  perform set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000422","email":"proof-422@invalid.test"}', true);
  set local role authenticated;
  select count(*) into v_staff_read from public.evv_submissions where id = v_id;
  update public.evv_submissions set caregiver_axiscare_id = 'proof-cg', caregiver_linked_name = 'Proof Caregiver',
         linked_by = 'proof-422@invalid.test', linked_at = now(), processed = true, outcome = 'accepted',
         processed_by = 'proof-422@invalid.test', processed_at = now()
   where id = v_id;
  get diagnostics v_staff_upd = row_count;
  select outcome, caregiver_axiscare_id into v_after_outcome, v_after_cg from public.evv_submissions where id = v_id;
  reset role;

  raise exception 'PROBE_RESULT: %', jsonb_build_object(
    'anon_insert', v_anon_insert, 'anon_read', v_anon_read,
    'wiped', (v_proc is false and v_outcome is null and v_cg is null and v_cl is null and v_done is null and v_by is null),
    'staff_read', v_staff_read, 'staff_update', v_staff_upd,
    'after', (v_after_outcome = 'accepted' and v_after_cg = 'proof-cg'),
    'anon_can', jsonb_build_object('insert', has_table_privilege('anon', 'public.evv_submissions', 'INSERT'),
                                   'select', has_table_privilege('anon', 'public.evv_submissions', 'SELECT'),
                                   'update', has_table_privilege('anon', 'public.evv_submissions', 'UPDATE'),
                                   'delete', has_table_privilege('anon', 'public.evv_submissions', 'DELETE')),
    'staff_can', jsonb_build_object('select', has_table_privilege('authenticated', 'public.evv_submissions', 'SELECT'),
                                    'update', has_table_privilege('authenticated', 'public.evv_submissions', 'UPDATE'),
                                    'truncate', has_table_privilege('authenticated', 'public.evv_submissions', 'TRUNCATE')));
end
$proof$;
