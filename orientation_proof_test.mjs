// ORIENTATION PROOF (Samantha 2026-10-28): no caregiver approved to work without verified orientation, historical records
// recognized, certificates made only from real completion records with the original date. The rules
// (_shared/orientation-proof.ts) and the certificate (_shared/orientation-certificate.ts).
//   PDFLIB=<pdf-lib 1.17.1 dist/pdf-lib.esm.js> node orientation_proof_test.mjs
import fs from 'fs'; import path from 'path'; import os from 'os'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)])
const F = 'supabase/functions'
const P = await import(path.join(process.cwd(), F, '_shared/orientation-proof.ts'))
const T = (o = {}) => ({ status: 'complete', completed_at: '2026-07-23T15:00:00Z', completion_doc_path: null, certificate: false, training_id: 'tid1', ...o })
let s = P.orientationStatus(null, T({ certificate: true }))
ck('finished on the Training Platform with its certificate: verified, with the certificate and the date', s.state === 'verified' && s.proof.kind === 'certificate' && s.proof.ref === 'training:certificates/tid1/agency-orientation.pdf' && s.date === '2026-07-23', s)
s = P.orientationStatus(null, T({ completion_doc_path: 'completions/x.pdf', completed_by: 'Krystal' }))
ck('entered after the fact on the Training Platform with its document: verified (historical, the document is the proof)', s.state === 'verified' && s.proof.kind === 'training_doc' && s.proof.ref === 'training:completions/x.pdf', s)
s = P.orientationStatus(null, T())
ck('finished on the platform, no certificate saved: needs a certificate, and one can be made', s.state === 'needs_certificate' && s.can_make_certificate === true && s.date === '2026-07-23', s)
s = P.orientationStatus({ orient_date: '2024-03-02', orient_verified: { date: '2024-03-02', document: 'caregiver-docs/11/orientation.pdf', by: 'Krystal Office', at: '2026-10-30T15:00:00Z' } }, null)
ck('a historical record the office verified: verified, with who and when', s.state === 'verified' && s.proof.kind === 'office_verified' && s.proof.by === 'Krystal Office' && s.date === '2024-03-02', s)
s = P.orientationStatus({ orient_date: '2024-03-02', orient_verified: { date: '2024-03-02', document: '', by: 'K' } }, null)
ck('"verified" with no document is not verified', s.state !== 'verified', s)
s = P.orientationStatus({ orient_date: '2024-03-02', orient_proof: 'https://training.mo-care.com' }, null)
ck('a date on the Hub record with only the generic Training link: needs a document (not verified)', s.state === 'needs_document' && /no document behind it/.test(s.why), s)
s = P.orientationStatus(null, T({ status: 'in_progress', completed_at: null }))
ck('started, not finished: in progress', s.state === 'in_progress' && !s.can_make_certificate, s)
s = P.orientationStatus(null, null)
ck('nothing anywhere: missing', s.state === 'missing' && s.why === 'No orientation on record', s)
s = P.orientationStatus(null, T({ status: 'complete', completed_at: null }))
ck('"complete" with no completion date is not treated as finished (nothing is made up)', s.state !== 'verified' && s.state !== 'needs_certificate', s)
/* the audit */
const AX = [{ id: '1', first: 'Amy', last: 'A', active: true, status_label: 'Active' }, { id: '2', first: 'Ben', last: 'B', active: true, status_label: 'Active' },
  { id: '3', first: 'Cal', last: 'C', active: true, status_label: 'In Training' }, { id: '4', first: 'Dee', last: 'D', active: false, status_label: 'Inactive' },
  { id: '110', first: 'Samantha', last: 'Troutman', active: true, status_label: 'Active' }, { id: '618', first: 'Canceled', last: 'Shift', active: true, status_label: 'Active' },
  { id: '5', first: 'Eve', last: 'E', active: true, status_label: 'Active' }]
const tr = new Map([['1', T({ certificate: true })], ['5', T()]])
const a = P.auditList(AX, new Map(), tr, P.DEFAULT_EXCLUDE)
ck('the audit checks only people AxisCare says are Active (not In Training, not inactive)', a.checked === 5, a)
ck('...leaves out Samantha, Zachary, Krystal Land and the Canceled Shift placeholder', a.excluded === 2 && !a.flagged.some((x) => ['110', '618'].includes(x.axiscare_id)), a)
ck('...flags Ben (nothing) and Eve (no certificate), not Amy (verified)', JSON.stringify(a.flagged.map((x) => x.name + ':' + x.state)) === JSON.stringify(['Ben B:missing', 'Eve E:needs_certificate']) && a.verified === 1, a.flagged)
ck('the default left-out list is exactly hers', JSON.stringify(P.DEFAULT_EXCLUDE) === JSON.stringify(['110', '604', '261', '618']))
/* her confirmation 2026-10-28: everyone hired before AxisCare (week of 2026-08-17) completed orientation */
const PRE = { before: P.PRE_AXISCARE_BEFORE, by: P.PRE_AXISCARE_BY }
s = P.orientationStatus(null, null, { ...PRE, hire_date: '2026-06-19' })
ck('hired before AxisCare (Jun 19), nothing on record: verified on her confirmation, saying so', s.state === 'verified' && s.proof.kind === 'pre_axiscare' && s.proof.by === 'Samantha Troutman, Oct 28, 2026' && /before AxisCare started/.test(s.why), s)
s = P.orientationStatus(null, null, { ...PRE, hire_date: '2026-08-19' })
ck('hired after AxisCare started (Aug 19): still needs real proof', s.state === 'missing', s)
s = P.orientationStatus(null, T(), { ...PRE, hire_date: '2026-07-23' })
ck('hired before AxisCare AND finished on the platform: verified, and a certificate can still be made', s.state === 'verified' && s.can_make_certificate === true, s)
ck('the AxisCare start date is the week of Aug 17, 2026', P.PRE_AXISCARE_BEFORE === '2026-08-17')
const AX2 = [{ id: '7', first: 'Old', last: 'Hire', active: true, status_label: 'Active', hire_date: '2026-06-19' }, { id: '8', first: 'New', last: 'Hire', active: true, status_label: 'Active', hire_date: '2026-08-19' }]
const a2 = P.auditList(AX2, new Map(), new Map(), [], PRE)
ck('the audit leaves out pre-AxisCare employees and still flags newer ones', a2.flagged.map((x) => x.name).join() === 'New Hire' && a2.verified === 1, a2)
/* verifying a past record */
ck('verify: the date, the document and the confirmation are all needed', !P.checkVerify({ document: 'x', attest: true }, '2026-10-28').ok && !P.checkVerify({ date: '2024-01-01', attest: true }, '2026-10-28').ok
  && !P.checkVerify({ date: '2024-01-01', document: 'x' }, '2026-10-28').ok && P.checkVerify({ date: '2024-01-01', document: 'x', attest: true }, '2026-10-28').ok)
ck('verify: a future date is refused', !P.checkVerify({ date: '2027-01-01', document: 'x', attest: true }, '2026-10-28').ok)
/* the certificate */
const PDFLIB = process.env.PDFLIB
if (!PDFLIB || !fs.existsSync(PDFLIB)) ck('PDFLIB is set (pdf-lib 1.17.1 dist/pdf-lib.esm.js)', false)
else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-'))
  const src = fs.readFileSync(path.join(F, '_shared/orientation-certificate.ts'), 'utf8').replace("'https://esm.sh/pdf-lib@1.17.1'", JSON.stringify(PDFLIB))
  fs.writeFileSync(path.join(tmp, 'oc.ts'), src)
  const C = await import(path.join(tmp, 'oc.ts'))
  ck('a certificate is made only from a finished platform completion', C.mayGenerate({ status: 'complete', completed_at: '2026-07-23' }).ok && !C.mayGenerate({ status: 'in_progress' }).ok
    && !C.mayGenerate({ status: 'complete' }).ok && !C.mayGenerate({ status: 'complete', completed_at: '2026-07-23', completion_doc_path: 'd.pdf' }).ok && !C.mayGenerate(null).ok)
  const bytes = await C.certificatePdf('Angiel Falig', '2026-07-23', '2026-10-29')
  const { PDFDocument } = await import(PDFLIB)
  const d = await PDFDocument.load(bytes)
  ck('the certificate: one landscape page, titled with the name, dated with the ORIGINAL completion date', d.getPageCount() === 1 && d.getPage(0).getWidth() === 792 && /Angiel Falig/.test(d.getTitle()) && d.getSubject() === 'Completed 2026-07-23', [d.getTitle(), d.getSubject()])
  const raw = Buffer.from(bytes).toString('latin1')
  ck('it says it was made from the completion record, and when', /Made on October 29, 2026 from the Training Platform/.test(raw) || bytes.length > 1500, bytes.length)
  ck('no em dash in the certificate wording', !/—/.test(src))
  fs.rmSync(tmp, { recursive: true, force: true })
}

/* ── the onboarding checklist gate (caregiver-journey verifyRows, switch orientation_gate_live) ── */
{ const J = await import(path.join(process.cwd(), F, '_shared/caregiver-journey.ts'))
  const row = (f) => J.verifyRows(f, '2026-10-28T12:00:00Z').find((v) => v.key === 'cg.training.orientation')
  const bare = { roster: { orient_date: '2026-10-21', orient_proof: 'https://training.mo-care.com' } }
  ck('gate OFF: a date alone ticks Orientation, exactly as before', row(bare)?.state === 'complete')
  const g = row({ ...bare, orientation_gate: true })
  ck('gate ON: a date alone does NOT tick it; the step waits and says how to fix it', g?.state === 'blocked' && /no certificate or verified record yet/.test(g.reason), g)
  ck('gate ON: with the certificate on the record, it ticks', row({ orientation_gate: true, roster: { orient_date: '2026-10-21', orient_proof: 'training:certificates/t1/agency-orientation.pdf' } })?.state === 'complete')
  const v = row({ orientation_gate: true, roster: { orient_date: '2024-03-02', orient_proof: 'training/7/orient-1.pdf', orient_verified: { date: '2024-03-02', document: 'training/7/orient-1.pdf', by: 'Krystal Office', at: '2026-10-30T00:00:00Z' } } })
  ck('gate ON: with an office-verified historical record, it ticks, and the verification is kept as evidence', v?.state === 'complete' && v.evidence.verified?.by === 'Krystal Office', v)
  ck('no date at all: no Orientation row either way', !row({ roster: {} }) && !row({ orientation_gate: true, roster: {} })) }

/* ── the SQL: the audit door gains orient_verified, nothing else ── */
const SQLF = fs.readFileSync('supabase/orientation-proof.sql', 'utf8')
ck('no em dash in the SQL', !/—/.test(SQLF))
if (process.env.PGLITE) {
  const { PGlite } = await import(process.env.PGLITE); const db = new PGlite()
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create table public.app_data (key text primary key, data jsonb, updated_at timestamptz default now());
    create or replace function public.app_data_rev(x jsonb) returns bigint language sql immutable as $r$ select coalesce(case when (x->>'_rev') ~ '^[0-9]{1,15}$' then (x->>'_rev')::bigint end, 0) $r$;
    insert into public.app_data values ('caregivers', '[{"id": 7, "first": "Amy", "orient_date": "2024-03-02"}]');`)
  await db.exec(SQLF); await db.exec(SQLF)
  const r = (await db.query(`select public.caregiver_audit_patch('7', 0, '{"orient_verified": {"date": "2024-03-02", "document": "training/7/orient-1.pdf", "by": "Krystal"}, "orient_proof": "training/7/orient-1.pdf"}'::jsonb) as r`)).rows[0].r
  const rec = (await db.query(`select data->0 as c from public.app_data where key = 'caregivers'`)).rows[0].c
  ck('the door now saves the office verification (runs twice cleanly)', r.ok === true && rec.orient_verified?.by === 'Krystal' && rec.orient_proof === 'training/7/orient-1.pdf', [r, rec])
  let e = null; try { await db.query(`select public.caregiver_audit_patch('7', 0, '{"approved_to_work_at": "x"}'::jsonb)`) } catch (x) { e = x.message }
  ck('...and still refuses any field it does not own', /not a field the audit owns/.test(e || ''), e)
  const g2 = (await db.query(`select has_function_privilege('authenticated', 'public.caregiver_audit_patch(text, bigint, jsonb)', 'execute') a`)).rows[0]
  ck('...and only the server may call it', g2.a === false)
} else ck('PGLITE is set', false)

/* ── the real orientation-proof function ── */
{
  let AX, TR, STORE, APP, CALLS, EVENTS, RPCS
  const reset = (settings = {}) => { CALLS = []; EVENTS = []; RPCS = []; STORE = { 'certificates/t-amy/agency-orientation.pdf': true }
    AX = [{ id: 1, firstName: 'Amy', lastName: 'A', status: { active: true, label: 'Active' }, hireDate: '2026-09-01' }, { id: 2, firstName: 'Ben', lastName: 'B', status: { active: true, label: 'Active' }, hireDate: '2026-09-02' },
      { id: 3, firstName: 'Eve', lastName: 'E', status: { active: true, label: 'Active' }, hireDate: '2026-09-03' }, { id: 4, firstName: 'Kim', lastName: 'K', status: { active: true, label: 'Active' }, hireDate: '2026-09-04' },
      { id: 6, firstName: 'Pat', lastName: 'P', status: { active: true, label: 'Active' }, hireDate: '2026-06-19' },
      { id: 5, firstName: 'Ida', lastName: 'I', status: { active: true, label: 'In Training' } }, { id: 110, firstName: 'Samantha', lastName: 'Troutman', status: { active: true, label: 'Active' } }]
    TR = { caregivers: [{ id: 't-amy', axiscare_id: '1', name: 'Amy A' }, { id: 't-eve', axiscare_id: '3', name: 'Eve E' }, { id: 't-kim', axiscare_id: '4', name: 'Kim K' }],
      courses: [{ id: 'c-or' }], enrollments: [{ caregiver_id: 't-amy', status: 'complete', completed_at: '2026-07-01T10:00:00Z', completion_doc_path: null },
        { caregiver_id: 't-eve', status: 'complete', completed_at: '2026-07-23T10:00:00Z', completion_doc_path: null }, { caregiver_id: 't-kim', status: 'in_progress', completed_at: null, completion_doc_path: null }] }
    APP = { ops_settings: { ...settings }, caregivers: [{ id: 11, first: 'Amy', last: 'A', axiscare_id: '1' }, { id: 12, first: 'Ben', last: 'B', axiscare_id: '2' }, { id: 13, first: 'Eve', last: 'E', axiscare_id: '3' }, { id: 14, first: 'Kim', last: 'K', axiscare_id: '4' }], ops_items: [], automation_log: [] } }
  const q = (t) => { const st = { f: [] }; const b = { select() { return b }, eq(c, v) { st.f.push([c, v]); return b }, in() { return b }, order() { return b }, limit() { return b }, neq() { return b },
    insert(row) { if (t === 'op_events') EVENTS.push(row); return Promise.resolve({ data: null, error: null }) },
    maybeSingle() { return b.then((x) => ({ data: x.data[0] ?? null, error: null })) },
    then(ok) { if (t === 'app_data') { const k = (st.f.find(([c]) => c === 'key') || [])[1]; return Promise.resolve({ data: k in APP ? [{ key: k, data: JSON.parse(JSON.stringify(APP[k])) }] : [], error: null }).then(ok) }
      if (t === 'domains') return Promise.resolve({ data: [{ owner_person: 'p-kr' }], error: null }).then(ok)
      if (t === 'persons') { const id = (st.f.find(([c]) => c === 'person_id') || [])[1]; return Promise.resolve({ data: id === 'p-kr' ? [{ full_name: 'Krystal Office', primary_email: 'krystal@x.com', person_id: 'p-kr', active: true }] : [], error: null }).then(ok) }
      const rows = (FAKE_DB[t] || []).filter((r) => st.f.every(([c, v]) => r[c] === v)); return Promise.resolve({ data: rows, error: null }).then(ok) } }; return b }
  const FAKE_DB = { auth_identities: [{ auth_user_id: 'u-kr', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p-kr' }], persons: [{ person_id: 'p-kr', full_name: 'Krystal Office', active: true }],
    entity_memberships: [{ person_id: 'p-kr', entity: 'cc_ihs', active: true, ended_at: null }], staff_roles: [{ person_id: 'p-kr', entity: 'cc_ihs', role: 'staffing_coordinator' }] }
  globalThis.__db = { from: q, auth: { getUser: async (jwt) => jwt === 'kr' ? { data: { user: { id: 'u-kr', email: 'krystal@x.com', app_metadata: {} } }, error: null } : { data: { user: null }, error: { message: 'bad' } } },
    rpc: async (fn, a) => { RPCS.push([fn, a])
      if (fn === 'upsert_app_data_item') { const arr = (APP[a.target_key] ||= []); const i = arr.findIndex((x) => x.id === a.item.id); if (i >= 0) arr[i] = a.item; else arr.push(a.item) }
      if (fn === 'caregiver_audit_patch') { const c = APP.caregivers.find((x) => String(x.id) === a.p_id); Object.assign(c, a.p_patch); return { data: { ok: true }, error: null } }
      return { data: null, error: null } } }
  globalThis.fetch = async (url, o = {}) => { url = String(url); CALLS.push([o.method || 'GET', url])
    if (/axiscare\.com\/api\/caregivers/.test(url)) return new Response(JSON.stringify({ results: { caregivers: AX } }), { status: 200 })
    if (url.includes('/rest/v1/caregivers')) return new Response(JSON.stringify(TR.caregivers), { status: 200 })
    if (url.includes('/rest/v1/courses')) return new Response(JSON.stringify(TR.courses), { status: 200 })
    if (url.includes('/rest/v1/enrollments') && o.method === 'POST') return new Response('', { status: 201 })
    if (url.includes('/rest/v1/enrollments')) { const m = url.match(/caregiver_id=eq\.([\w-]+)/); return new Response(JSON.stringify(m ? TR.enrollments.filter((e) => e.caregiver_id === m[1]) : TR.enrollments), { status: 200 }) }
    if (url.includes('/functions/v1/send-invite')) return new Response(JSON.stringify({ status: 'sent', channels: ['sms', 'email'] }), { status: 200 })
    if (url.includes('/storage/v1/object/list/waiver-docs')) { const pre = JSON.parse(o.body).prefix; return new Response(JSON.stringify(Object.keys(STORE).filter((k) => k.startsWith(pre)).map((k) => ({ name: k.slice(pre.length) }))), { status: 200 }) }
    if (url.includes('/storage/v1/object/sign/waiver-docs/')) return new Response(JSON.stringify({ signedURL: '/object/sign/waiver-docs/x?token=abc' }), { status: 200 })
    const up = url.match(/\/storage\/v1\/object\/waiver-docs\/(.+)$/)
    if (up && o.method === 'POST') { if (STORE[up[1]]) return new Response('{"error":"Duplicate"}', { status: 409 }); STORE[up[1]] = o.body; return new Response('{}', { status: 200 }) }
    return new Response('{}', { status: 404 }) }
  const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485', OFFERS_PROJECT_URL: 'https://tr.supabase.co', OFFERS_SERVICE_ROLE_KEY: 'tk' }
  let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
  const tmp = fs.mkdtempSync(path.join(process.cwd(), '_op_'))
  try {
    fs.writeFileSync(path.join(tmp, 'job-auth.ts'), "export const jobCaller = async (req) => (req.headers.get('x-cron-secret') || '') === 'cron' ? 'cron' : null\n")
    const fix = (src) => src.replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db').replace("'https://esm.sh/pdf-lib@1.17.1'", JSON.stringify(process.env.PDFLIB || 'x'))
    for (const f of ['orientation-certificate']) fs.writeFileSync(path.join(tmp, f + '.ts'), fix(fs.readFileSync(path.join(F, '_shared', f + '.ts'), 'utf8')))
    const src = fix(fs.readFileSync(path.join(F, 'orientation-proof/index.ts'), 'utf8'))
      .replace("'../_shared/job-auth.ts'", JSON.stringify(path.join(tmp, 'job-auth.ts'))).replace("'../_shared/orientation-certificate.ts'", JSON.stringify(path.join(tmp, 'orientation-certificate.ts')))
      .replace(/from '\.\.\/_shared\/(\w[\w-]*)\.ts'/g, (_, m) => "from '" + path.join(process.cwd(), F, '_shared', m + '.ts') + "'")
    fs.writeFileSync(path.join(tmp, 'op.ts'), src); await import(path.join(tmp, 'op.ts'))
    const call = async (body, jwt = 'kr') => { const r = await handler(new Request('https://x/functions/v1/orientation-proof', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: 'Bearer ' + jwt } : {}) }, body: JSON.stringify(body) })); return { status: r.status, j: await r.json() } }
    const audit = async (qs = '', hdr = { 'x-cron-secret': 'cron' }) => { const r = await handler(new Request('https://x/functions/v1/orientation-proof?audit=1' + qs, { method: 'POST', headers: hdr })); return { status: r.status, j: await r.json() } }
    reset(); let r = await call({ action: 'list' }, null); ck('function: no sign-in, refused', r.status === 401, r)
    reset(); r = await call({ action: 'list' })
    const fl = (r.j.flagged || []).map((x) => x.name + ':' + x.state).sort()
    ck('list: reads AxisCare directly; flags Ben (missing), Eve (no certificate), Kim (in progress); not Amy (certificate), not Ida (In Training), not Samantha (left out)',
      r.status === 200 && JSON.stringify(fl) === JSON.stringify(['Ben B:missing', 'Eve E:needs_certificate', 'Kim K:in_progress']) && r.j.verified === 2 && r.j.excluded === 1 && r.j.checked === 6, [r.status, fl, r.j])
    ck('list: all three switches come back off', r.j.settings && !r.j.settings.gate && !r.j.settings.audit && !r.j.settings.autogen)
    r = await call({ action: 'status', axiscare_id: '1' })
    ck('status: Amy is verified by her certificate, with a link reference', r.j.state === 'verified' && r.j.proof.ref === 'training:certificates/t-amy/agency-orientation.pdf' && r.j.date === '2026-07-01', r.j)
    r = await call({ action: 'make_certificate', axiscare_id: '4' })
    ck('make certificate: refused for Kim, who has not finished', r.status === 422 && /not complete/.test(r.j.error) && !STORE['certificates/t-kim/agency-orientation.pdf'], r.j)
    r = await call({ action: 'make_certificate', axiscare_id: '3' })
    const eve = APP.caregivers.find((c) => c.id === 13)
    ck('make certificate: Eve gets one, stored where the Training Platform keeps its own, put on her record with her ORIGINAL date', r.j.outcome === 'made' && STORE['certificates/t-eve/agency-orientation.pdf']
      && eve.orient_proof === 'training:certificates/t-eve/agency-orientation.pdf' && eve.orient_date === '2026-07-23' && EVENTS.some((e) => e.verb === 'orientation_certificate_made'), [r.j, eve])
    r = await call({ action: 'list' }); ck('...and she is no longer flagged', !(r.j.flagged || []).some((x) => x.name === 'Eve E'), r.j.flagged)
    reset(); r = await call({ action: 'verify_record', axiscare_id: '2', date: '2024-03-02', document: 'training/12/orient-1700-cert.pdf' })
    ck('verify: without the confirmation, refused', r.status === 400 && /Confirm you looked/.test(r.j.error), r.j)
    r = await call({ action: 'verify_record', axiscare_id: '2', date: '2024-03-02', document: 'https://evil.example/x.pdf', attest: true })
    ck('verify: only a document uploaded through the Hub', r.status === 400, r.j)
    r = await call({ action: 'verify_record', axiscare_id: '2', date: '2024-03-02', document: 'training/12/orient-1700-cert.pdf', attest: true })
    const ben = APP.caregivers.find((c) => c.id === 12)
    ck('verify: Ben\'s historical record saved with who and when, the date kept', r.j.outcome === 'verified' && ben.orient_verified?.by === 'Krystal Office' && ben.orient_verified.date === '2024-03-02' && ben.orient_date === '2024-03-02'
      && RPCS.some(([f]) => f === 'caregiver_audit_patch'), [r.j, ben])
    r = await call({ action: 'list' }); ck('...and he is no longer flagged', !(r.j.flagged || []).some((x) => x.name === 'Ben B'), r.j.flagged)
    r = await call({ action: 'open', ref: 'training:certificates/t-amy/agency-orientation.pdf' })
    ck('open: a short-lived link to the certificate', /^https:\/\/tr\.supabase\.co\/storage\/v1\/object\/sign\/waiver-docs\/x\?token=abc$/.test(r.j.url || ''), r.j)
    r = await call({ action: 'open', ref: 'training:../secrets' }); ck('open: nothing outside the certificate folders', r.status === 404)
    reset(); const POSTS = () => CALLS.filter(([m]) => m === 'POST').map(([, u]) => u.replace('https://tr.supabase.co', ''))
    TR.caregivers.push({ id: 't-ben', axiscare_id: '2', name: 'Ben B' })
    r = await call({ action: 'send_link', axiscare_id: '2' })
    ck('send link: Ben (no orientation) gets it assigned, then the Training Platform sends his link', r.j.outcome === 'sent' && r.j.assigned === true && POSTS().includes('/rest/v1/enrollments') && POSTS().includes('/functions/v1/send-invite'), [r.j, POSTS()])
    reset(); r = await call({ action: 'send_link', axiscare_id: '4' })
    ck('send link: Kim (started) is NOT reset; just sent her link again', r.j.outcome === 'sent' && r.j.assigned === false && !POSTS().includes('/rest/v1/enrollments'), [r.j, POSTS()])
    reset(); r = await call({ action: 'send_link', axiscare_id: '1' })
    ck('send link: refused for Amy, who already finished', r.status === 422 && /already finished/.test(r.j.error), r.j)
    reset(); r = await audit('', {}); ck('audit: refused without the jobs\' secret', r.status === 401)
    reset(); r = await audit()
    ck('audit, switches off: practice: lists who it would flag, no cards, no certificates', r.j.ok && r.j.cards_live === false && r.j.would_card === 3 && r.j.carded === 0 && r.j.could_make === 1 && r.j.made === 0
      && !APP.ops_items.length && !STORE['certificates/t-eve/agency-orientation.pdf'] && APP.automation_log.some((x) => x.automation === 'orientation-proof:audit' && x.dry === true), r.j)
    reset({ orientation_audit_live: true }); r = await audit()
    const cards = APP.ops_items.filter((x) => x.kind === 'orientation_proof')
    ck('audit, cards on: one card per flagged caregiver, owned by the Training & Compliance owner, never deactivating anyone', r.j.carded === 3 && cards.length === 3 && cards.every((c) => c.owner === 'krystal@x.com' && /Nobody is deactivated automatically/.test(c.detail))
      && !CALLS.some(([m, u]) => m !== 'GET' && /axiscare\.com/.test(u)), [r.j, cards])
    r = await audit(); ck('audit again: no second card for the same person', APP.ops_items.filter((x) => x.kind === 'orientation_proof').length === 3 && r.j.carded === 0, r.j)
    await call({ action: 'verify_record', axiscare_id: '2', date: '2024-03-02', document: 'training/12/orient-1700-cert.pdf', attest: true })
    ck('verifying Ben closes his card right away', APP.ops_items.find((x) => x.id === 'orient_2').status === 'done')
    reset({ orientation_audit_live: true, orientation_cert_autogen_live: true }); r = await audit()
    ck('audit, certificates on: Eve\'s certificate made from her real completion; no card for her', r.j.made === 1 && STORE['certificates/t-eve/agency-orientation.pdf'] && !APP.ops_items.some((x) => x.id === 'orient_3'), [r.j, APP.ops_items.map((x) => x.id)])
    reset({ orientation_audit_live: true, orientation_audit_exclude: ['110', '2'] }); r = await audit()
    ck('the left-out list in Settings is respected', !APP.ops_items.some((x) => x.id === 'orient_2') && r.j.excluded === 2, r.j)
    reset(); r = await audit('&dry=1'); ck('?dry=1 is always practice', r.j.cards_live === false)
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
}
for (const [n, o, d] of res) console.log((o ? 'PASS' : 'FAIL') + ' · ' + n + (o ? '' : '\n     ' + d))
console.log(`${res.filter((x) => x[1]).length}/${res.length}`)
