// agreement_lead_test.mjs · 2026-10-30 (Samantha: "we need to have a signed agreement before we would make them active in
// axiscare"): the Client Care Agreement started, signed and countersigned on the LEAD (no AxisCare number), then moving to the
// client by itself once the lead has its number. Fakes as client_agreement_test.mjs; AxisCare is a fake that records every call.
//   PDFLIB=/path/to/pdf-lib/dist/pdf-lib.esm.js node agreement_lead_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)])
const PDFLIB = process.env.PDFLIB
if (!PDFLIB || !fs.existsSync(PDFLIB)) { console.log('Set PDFLIB to pdf-lib 1.17.1 dist/pdf-lib.esm.js (npm i pdf-lib@1.17.1).'); process.exit(2) }
const MASTER = fs.readFileSync('client-agreement/client-care-agreement-rev-2026-10-18b.pdf'), MASTER_THIRD = fs.readFileSync('client-agreement/client-care-agreement-rev-2026-10-18.pdf'), MASTER_SECOND = fs.readFileSync('client-agreement/client-care-agreement-rev-2026-10-17.pdf'), MASTER_FIRST = fs.readFileSync('client-agreement/client-care-agreement-rev-2026-10.pdf')   // 2026-10-18: all three masters are stored
const SIG = 'data:image/png;base64,' + fs.readFileSync('client-agreement/test-signature.png').toString('base64')
let T, FILES, FAIL, FETCHES = []
const reset = () => { FAIL = null; FETCHES = []; FILES = { 'client-agreements/master/client-care-agreement-rev-2026-10-18b.pdf': new Uint8Array(MASTER), 'client-agreements/master/client-care-agreement-rev-2026-10-18.pdf': new Uint8Array(MASTER_THIRD), 'client-agreements/master/client-care-agreement-rev-2026-10-17.pdf': new Uint8Array(MASTER_SECOND), 'client-agreements/master/client-care-agreement-rev-2026-10.pdf': new Uint8Array(MASTER_FIRST) }; T = {
  client_agreements: [], document_access_log: [], client_journey: [], client_journey_step: [], client_journey_event: [], care_circles: [],
  app_data: [{ key: 'leads', data: [
    { id: 'L9', first_name: 'Nancy', last_name: 'Anderson', relationship: 'Wife', phone: '417-863-7309', client_first_name: 'Edward', client_last_name: 'Anderson', client_city: 'Springfield',
      soc: { pathway: 'PP', steps: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }] } },
    { id: 'L10', first_name: 'Ann', last_name: 'Bee', client_first_name: 'Cal', client_last_name: 'Bee', axiscare_client_id: '296' }] },
    { key: 'care_assessments', data: [{ id: 'v-other', lead_id: 'L-someone-else', axiscare_client_id: '', created_at: '2026-10-29T00:00:00Z', visit: { level: 'advanced', rate: '34' } }] }],
  auth_identities: [{ auth_user_id: 'u-kr', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p-kr' }, { auth_user_id: 'u-cg', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p-cg' }],
  persons: [{ person_id: 'p-kr', full_name: 'Krystal Office', active: true }, { person_id: 'p-cg', full_name: 'Cara Giver', active: true }],
  entity_memberships: ['p-kr', 'p-cg'].map((p) => ({ person_id: p, entity: 'cc_ihs', active: true, ended_at: null })),
  staff_roles: [{ person_id: 'p-kr', entity: 'cc_ihs', role: 'care_coordinator' }, { person_id: 'p-cg', entity: 'cc_ihs', role: 'caregiver' }] } }
const clone = (x) => JSON.parse(JSON.stringify(x))
const q = (t) => { const st = { f: [], ins: [], isnull: [], op: 'select', row: null }; const run = () => {
    if (FAIL === t) return { data: null, error: { message: 'down' } }
    const rows = T[t] ?? (T[t] = [])
    const match = (r) => st.f.every(([c, v]) => r[c] === v) && st.ins.every(([c, vs]) => vs.includes(r[c])) && st.isnull.every((c) => r[c] == null)
    if (st.op === 'insert') { const add = (Array.isArray(st.row) ? st.row : [st.row]).map((r) => ({ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...r })); rows.push(...add); return { data: clone(add), error: null } }
    if (st.op === 'update') { const hit = rows.filter(match); hit.forEach((r) => Object.assign(r, clone(st.row))); return { data: clone(hit), error: null } }
    return { data: clone(rows.filter(match)), error: null } }
  const b = { select() { return b }, eq(c, v) { st.f.push([c, v]); return b }, in(c, vs) { st.ins.push([c, vs]); return b }, is(c) { st.isnull.push(c); return b }, limit() { return b }, order() { return b },
    insert(r) { st.op = 'insert'; st.row = r; return b }, update(r) { st.op = 'update'; st.row = r; return b },
    maybeSingle() { const r = run(); return Promise.resolve({ data: r.data ? r.data[0] ?? null : null, error: r.error }) },
    then(ok, no) { return Promise.resolve(run()).then(ok, no) } }; return b }
const storage = { from: (bucket) => ({
  upload: async (p, bytes, o) => { const k = bucket + '/' + p; if (FILES[k] && !o.upsert) return { error: { message: 'exists' } }; FILES[k] = new Uint8Array(bytes); return { data: { path: p }, error: null } },
  download: async (p) => FILES[bucket + '/' + p] ? { data: new Blob([FILES[bucket + '/' + p]]), error: null } : { data: null, error: { message: 'not found' } },
  createSignedUrl: async (p, s) => ({ data: { signedUrl: `https://x/sign/${bucket}/${p}?e=${s}` }, error: null }) }) }
globalThis.__db = { from: q, storage,
  rpc: async (fn, a) => { (T.rpc ?? (T.rpc = [])).push([fn, a]); if (fn === 'lead_put_if_same') { const L = T.app_data.find((x) => x.key === 'leads').data, i = L.findIndex((l) => l.id === a.p_id); if (i < 0 || JSON.stringify(L[i]) !== JSON.stringify(a.p_before)) return { data: false, error: null }; L[i] = clone(a.p_after); return { data: true, error: null } } return { data: null, error: null } },
  auth: { getUser: async (jwt) => ({ kr: 'u-kr', cg: 'u-cg' })[jwt] ? { data: { user: { id: ({ kr: 'u-kr', cg: 'u-cg' })[jwt], email: jwt + '@mo-care.com', app_metadata: {} } }, error: null } : { data: { user: null }, error: { message: 'bad' } } } }
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485' }
globalThis.fetch = async (u) => { FETCHES.push(String(u)); return new Response(JSON.stringify({ results: { client: { firstName: 'Cal', lastName: 'Bee' }, responsibleParties: [] } }), { status: 200 }) }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_cag_'))
const shared = (s) => s.replace(/from '\.\.\/_shared\/([\w-]+)\.ts'/g, (_, m) => "from '" + path.join(tmp, m + '.ts') + "'").replace(/from '\.\/([\w-]+)\.ts'/g, (_, m) => "from '" + path.join(tmp, m + '.ts') + "'")
  .replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db').replace("'https://esm.sh/pdf-lib@1.17.1'", JSON.stringify(PDFLIB))
try {
  fs.writeFileSync(path.join(tmp, 'outreach.ts'), 'export const contactForOutbound = async () => null\nexport const maySend = () => ({ allowed: false })\n')   // 873: no family email in this test
  /* every shared module the functions import (the faked send gate, outreach.ts, is written above and kept) */
  for (const f of fs.readdirSync(path.join(F, '_shared')).filter((f) => f.endsWith('.ts') && f !== 'outreach.ts')) fs.writeFileSync(path.join(tmp, f), shared(fs.readFileSync(path.join(F, '_shared', f), 'utf8')))
  fs.writeFileSync(path.join(tmp, 'fn.ts'), shared(fs.readFileSync(path.join(F, 'client-agreement/index.ts'), 'utf8')))
  await import(path.join(tmp, 'fn.ts'))
  const { PDFDocument } = await import(PDFLIB)
  const call = async (body, jwt = 'kr', method = 'POST') => { const r = await handler(new Request('https://x/functions/v1/client-agreement', { method,
    headers: { 'Content-Type': 'application/json', 'user-agent': 'TabletSafari/1', 'cf-connecting-ip': '203.0.113.9', ...(jwt ? { Authorization: 'Bearer ' + jwt } : {}) }, body: method === 'POST' ? JSON.stringify(body) : undefined }))
    let j = null; try { j = await r.json() } catch { /* */ } return { status: r.status, j, h: r.headers } }
  const OFFICE = { 'level.personal_care': true, 'level.hourly_rate': '32' }
  const FAMILY = { 'client.client_s_name': 'Edward Anderson', 'client.address': '123 Maple St', 'client.city': 'Springfield', 'client.zip': '65804', 'client.phone_number': '417-555-0100',
    'c1.name': 'Nancy Anderson', 'c1.relationship': 'Wife', 'c1.cell_phone': '417-863-7309', 'c1.email': 'nancy@example.com', 'c1.hipaa_yes': true, 'c1.book_yes': true, 'c1.medical_yes': true, 'c1.poa_health': true,
    'c1.text_running_late': true, 'c1.axis_care_notes': true, 'c1.email_invoices': true, 'ci.date_of_birth': '3/4/1941',
    'backup.full_name': 'Tom Anderson', 'backup.relationship_to_client': 'Son', 'backup.primary_phone': '417-555-0111',
    'access.2_lockbox_access_a_ke': true, 'access.lockbox_location': 'Back porch', 'access.lockbox_code': '2468',
    'car.decline': true, 'comm.accept': true, 'photos.share_with_my_family': true }
  const TAPS = Object.fromEntries(['1', '2', '3', '4', '5', '6'].map((n) => [n, '2026-10-16T15:0' + n + ':00Z']))
  const leadOf = (id) => T.app_data.find((x) => x.key === 'leads').data.find((l) => l.id === id)
  let id, r

  // 2026-10-30 (Samantha: a signed agreement before the client is made active in AxisCare): start it from the lead
  reset(); r = await call({ action: 'start', lead_id: 'nope', office: OFFICE }); ck('lead: an unknown lead is refused (Which client?)', r.status === 400 && /Which client/.test(r.j.error) && !T.client_agreements.length, r)
  reset(); r = await call({ action: 'start', lead_id: '', client_ax: '', office: OFFICE }); ck('lead: neither a lead nor an AxisCare number: refused', r.status === 400, r)
  reset(); r = await call({ action: 'prefill', lead_id: 'L9' })
  ck('lead: prefill reads the lead, never AxisCare (no number yet), and never another family\'s home visit', r.status === 200 && r.j.count > 0 && r.j.sources.includes('Lead') && FETCHES.length === 0 && r.j.visit_found === false && !r.j.office['level.hourly_rate'], r.j)
  reset(); r = await call({ action: 'start', lead_id: 'L9', office: OFFICE }); const a = T.client_agreements[0]
  ck('lead: the draft is kept on the lead (lead_id, no AxisCare number), filled from the lead', r.status === 200 && a.lead_id === 'L9' && a.axiscare_client_id === null && a.answers['client.client_s_name'] === 'Edward Anderson' && r.j.agreement.lead_id === 'L9' && r.j.agreement.client_ax === null && FETCHES.length === 0, [r.j, a])
  id = a.id
  r = await call({ action: 'list', lead_id: 'L9' }); ck('lead: list by the lead finds it', r.status === 200 && r.j.agreements.length === 1 && r.j.agreements[0].id === id, r.j)
  r = await call({ action: 'list', client_ax: '296' }); ck('lead: list by an unrelated AxisCare number does not show it', r.status === 200 && r.j.agreements.length === 0, r.j)
  r = await call({ action: 'sign', id, answers: FAMILY, signer: { name: 'Edward Anderson', role: 'client' }, initials: TAPS, signature: SIG, consent: true })
  ck('lead: the family signs on the iPad; the signature is filed under the lead', r.status === 200 && T.client_agreements[0].status === 'signed' && /^sig\/lead-L9\//.test(T.client_agreements[0].client_sign.signature_path), [r, T.client_agreements[0].client_sign])
  r = await call({ action: 'countersign', id, signature: SIG }); const c = T.client_agreements[0]
  ck('lead: countersigned; the signed PDF is filed under the lead', r.status === 200 && c.status === 'countersigned' && /^signed\/lead-L9\//.test(c.signed_pdf_path) && /^sig\/lead-L9\//.test(c.office_sign.signature_path), [r.j, c.signed_pdf_path])
  ck('lead: countersigning ticks Start of Care on the lead (found by its id, no AxisCare number)', r.j.steps.soc === 'ticked' && leadOf('L9').soc.steps.filter((s) => s.done_at).map((s) => s.id).join() === 'p1,p2', [r.j.steps, leadOf('L9').soc])
  {
    const { execFileSync } = await import('child_process'); const f = path.join(tmp, 'lead.pdf'); fs.writeFileSync(f, FILES['client-agreements/' + c.signed_pdf_path])
    const txt = execFileSync('python3', ['-c', 'import sys, fitz; d = fitz.open(sys.argv[1]); sys.stdout.write(d[-1].get_text())', f], { encoding: 'utf8' })
    ck('lead: the signature record page says it was not in AxisCare yet, with the lead', /Not in AxisCare yet when signed \(lead L9\)/.test(txt), txt.slice(0, 600))
  }
  r = await call({ action: 'open', id }); ck('lead: opening it is logged against the lead', r.status === 200 && T.document_access_log[0].offer_id === 'client:LL9', T.document_access_log)
  r = await call({ action: 'contacts', id }); ck('lead: approving the contacts waits for AxisCare (409, needs_axiscare), nothing read from AxisCare', r.status === 409 && r.j.outcome === 'needs_axiscare' && /Start of Care step 4/.test(r.j.error) && FETCHES.length === 0, r)
  r = await call({ action: 'contacts_apply', id, people: [{ n: 1 }] }); ck('lead: contacts_apply waits too', r.status === 409 && r.j.outcome === 'needs_axiscare', r)

  // the lead gets its AxisCare number: the agreement moves to the client by itself
  leadOf('L9').axiscare_client_id = '777'
  r = await call({ action: 'list', client_ax: '777' })
  ck('moves: list by the new AxisCare number finds the agreement signed on the lead, and fills its number in', r.status === 200 && r.j.agreements.length === 1 && r.j.agreements[0].client_ax === '777' && T.client_agreements[0].axiscare_client_id === '777' && T.client_agreements[0].lead_id === 'L9', [r.j, T.client_agreements[0]])
  ck('moves: the files stay where they were saved (nothing moved or lost)', /^signed\/lead-L9\//.test(T.client_agreements[0].signed_pdf_path))
  r = await call({ action: 'list', lead_id: 'L9' }); ck('moves: list by the lead still finds it', r.j.agreements.length === 1)
  r = await call({ action: 'contacts', id }); ck('moves: contacts now go ahead (reads AxisCare #777)', r.status === 200 && r.j.client_ax === '777' && FETCHES.some((u) => /\/api\/clients\/777\/responsibleParties/.test(u)), r)

  reset(); T.client_agreements.push({ id: '11111111-1111-4111-8111-111111111111', lead_id: 'L9', axiscare_client_id: null, status: 'draft', answers: {}, office: {}, created_at: '2026-10-30T00:00:00Z' }); leadOf('L9').axiscare_client_id = '888'
  r = await call({ action: 'get', id: '11111111-1111-4111-8111-111111111111' }); ck('moves: reading one agreement also fills in the number once the lead has it', r.status === 200 && r.j.agreement.client_ax === '888' && T.client_agreements[0].axiscare_client_id === '888', r.j)

  // a lead that already has an AxisCare number: same as starting on the client, the lead kept too
  reset(); r = await call({ action: 'start', lead_id: 'L10', office: OFFICE })
  ck('lead with a number: the draft is on the client (AxisCare #296) and keeps the lead', r.status === 200 && T.client_agreements[0].axiscare_client_id === '296' && T.client_agreements[0].lead_id === 'L10' && FETCHES.some((u) => /\/api\/clients\/296/.test(u)), T.client_agreements[0])
  r = await call({ action: 'list', client_ax: '296' }); ck('lead with a number: list by AxisCare number finds it', r.j.agreements.length === 1)
  reset(); r = await call({ action: 'start', client_ax: '296', office: OFFICE }); ck('by AxisCare number (as before): the lead with that number is remembered on the row', r.status === 200 && T.client_agreements[0].lead_id === 'L10', T.client_agreements[0])
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
const bad = res.filter((x) => !x[1])
for (const [n, okk, note] of res) console.log((okk ? 'PASS ' : 'FAIL ') + n + (note ? '\n     ' + note : ''))
console.log(`\n${res.length - bad.length}/${res.length} passed`); process.exit(bad.length ? 1 : 0)
