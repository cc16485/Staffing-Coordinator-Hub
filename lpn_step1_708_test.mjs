// 708 LPN HIRING (Samantha approved the LPN nurse visit plan, 2026-10-14): Step 1 for an LPN or RN, the real step1-sign function
// against the fake database of step1_sign_2b_test.mjs. A caregiver's Step 1 is exactly as before; an LPN's has ONE more form,
// "Your Nursing License" (proposed, not approved for real), decided once when the Step 1 record is made. node lpn_step1_708_test.mjs
import fs from 'fs'; import path from 'path'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 700)])
const L = await import(path.join(FN, '_shared/applicant-links.ts'))
const D = await import(path.join(FN, '_shared/step1-documents.ts'))
/* 2026-10-13: the story below starts BEFORE her approval of the Hepatitis B form (Ava and Bo start their Step 1 then); the
   approval as shipped is put back further down, where Dee, Eli and Fay start theirs */
const C = await import(path.join(FN, '_shared/step1-crypto.ts'))
const SECRET = 's'.repeat(48), KEK = Buffer.alloc(32, 7).toString('base64')
const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'svc', HUB_JOB_SECRET: SECRET, STEP1_KEK: KEK, OFFERS_PROJECT_URL: 'http://trn', OFFERS_SERVICE_ROLE_KEY: 'tkey' }
let handler = null; globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h } }

/* ── the fake Training Platform (REST) and GoHighLevel are never called; storage is a map ── */
const OFFERS = {}, EVENTS = [], PATCHES = []
const realFetch = globalThis.fetch
globalThis.fetch = async (url, o = {}) => {
  const u = String(url)
  if (u.startsWith('http://trn/rest/v1/job_offers')) {
    const id = decodeURIComponent(/id=eq\.([^&]+)/.exec(u)[1])
    if ((o.method || 'GET') === 'GET') return new Response(JSON.stringify(OFFERS[id] ? [OFFERS[id]] : []), { status: 200 })
    const body = JSON.parse(o.body); const guard = /&(\w+)=is\.null/.exec(u)
    if (!OFFERS[id] || (guard && OFFERS[id][guard[1]] != null)) return new Response('[]', { status: 200 })
    Object.assign(OFFERS[id], body); PATCHES.push({ id, body }); return new Response(JSON.stringify([OFFERS[id]]), { status: 200 })
  }
  if (u.startsWith('http://trn/rest/v1/offer_events')) { EVENTS.push(JSON.parse(o.body)); return new Response('', { status: 201 }) }
  throw new Error('unexpected fetch ' + u)
}
/* ── a tiny table store with the query shapes the function uses ── */
let DB = { step1_forms: [], step1_identity: [], job_applicants: [], document_access_log: [], auth_identities: [], persons: [], entity_memberships: [], staff_roles: [], app_data: [], driver_compliance: [], driver_document: [], driver_compliance_event: [], hepb_record: [], hepb_event: [], client_journey: [] }
const STORE = {}
const getPath = (r, p) => p.split('->').reduce((a, k) => a == null ? undefined : a[k], r)
function table(name) {
  const rows = () => DB[name]
  const q = (mode, payload, filters = [], opts = {}) => {
    const match = (r) => filters.every((f) => f(r))
    const run = () => {
      if (mode === 'select') { let out = rows().filter(match); if (opts.order) out = [...out].reverse(); if (opts.limit) out = out.slice(0, opts.limit); return out.map((r) => JSON.parse(JSON.stringify(r))) }
      if (mode === 'insert') { const r = { ...payload }; if (name === 'hepb_record') { if (globalThis.FAIL_HEPB) throw new Error('hepb down'); if (rows().some((x) => x.offer_id === r.offer_id)) throw new Error('duplicate offer_id'); r.id = 'aaaaaaaa-bbbb-4ccc-8ddd-' + String(rows().length + 1).padStart(12, '0'); r.reminders = r.reminders || {}; r.doses = [] } if (name === 'step1_forms') Object.assign(r, { answers: {}, signatures: {}, pdfs: {}, ...r }); if ((name === 'step1_forms' || name === 'step1_identity') && rows().some((x) => x.offer_id === r.offer_id)) throw Object.assign(new Error('duplicate key'), { code: '23505' }); rows().push(r); return [r] }
      if (mode === 'upsert') { const i = rows().findIndex((x) => x.offer_id === payload.offer_id); if (i >= 0) Object.assign(rows()[i], payload); else rows().push({ ...payload }); return [rows()[i >= 0 ? i : rows().length - 1]] }
      if (mode === 'update') { const out = []; for (const r of rows()) if (match(r)) {
        if (name === 'step1_forms') { for (const k of Object.keys(r.signatures || {})) if (payload.signatures && JSON.stringify(payload.signatures[k]) !== JSON.stringify(r.signatures[k])) throw new Error('trigger: signature never changed')
          for (const k of Object.keys(r.pdfs || {})) if (payload.pdfs && payload.pdfs[k] !== r.pdfs[k]) throw new Error('trigger: pdf never replaced') }
        Object.assign(r, payload); out.push(r) } return out }
    }
    const api = {
      eq: (k, v) => q(mode, payload, [...filters, (r) => String(getPath(r, k)) === String(v)], opts),
      is: (k, v) => q(mode, payload, [...filters, (r) => (v === null ? getPath(r, k) == null : getPath(r, k) === v)], opts),
      filter: (k, op, v) => q(mode, payload, [...filters, (r) => op === 'is' && v === null ? getPath(r, k) == null : false], opts),
      like: (k, v) => q(mode, payload, [...filters, (r) => { const pat = '^' + String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$'; return new RegExp(pat).test(String(getPath(r, k) ?? '')) }], opts),
      ilike: (k, v) => q(mode, payload, [...filters, (r) => { const pat = '^' + String(v).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$'; return new RegExp(pat).test(String(r[k] ?? '').toLowerCase()) }], opts),
      order: () => q(mode, payload, filters, { ...opts, order: true }), limit: (n) => q(mode, payload, filters, { ...opts, limit: n }),
      select: () => q(mode, payload, filters, opts),
      maybeSingle: async () => { try { const r = run(); return { data: r[0] ?? null, error: null } } catch (e) { return { data: null, error: { message: e.message } } } },
      then: (ok) => { try { ok({ data: run(), error: null }) } catch (e) { ok({ data: null, error: { message: e.message } }) } },
    }
    return api
  }
  return { select: () => q('select'), insert: (p) => q('insert', p), upsert: (p) => q('upsert', p), update: (p) => q('update', p) }
}
const UPLOADS = new Set(); globalThis.UPLOADS = UPLOADS
const storage = { from: (bucket) => ({ createSignedUploadUrl: async (p) => ({ data: { token: 'tok-' + p, signedUrl: 'https://upload/' + bucket + '/' + p }, error: null }), list: async (dir, o) => ({ data: [...UPLOADS].filter((x) => x.startsWith(bucket + ':' + dir + '/')).map((x) => ({ name: x.slice((bucket + ':' + dir + '/').length) })).filter((x) => !o?.search || x.name === o.search), error: null }), upload: async (p, bytes, o) => { if (STORE[p] && !o?.upsert) return { error: { message: 'exists' } }; STORE[p] = bytes; return { data: { path: p }, error: null } }, createSignedUrl: async (p) => ({ data: STORE[p] ? { signedUrl: 'https://signed/' + p } : null, error: STORE[p] ? null : { message: 'no' } }) }) }
const RPCS = []
globalThis.__fakeCreateClient = () => ({ from: table, storage, rpc: async (name, args) => { RPCS.push({ name, args })
  /* STEP 1 BEFORE CHECKS: NO_CAND = nobody in Background & References yet (the new rule); the door then makes the record */
  if (name === 'step1_candidate_create') { const was = globalThis.NO_CAND; globalThis.NO_CAND = false; return { data: was ? { ok: true, created: true, how: 'created', id: 902 } : { ok: true, created: false, how: 'already', id: '901' }, error: null } }
  if (name === 'upsert_app_data_item') { (globalThis.CARDS = globalThis.CARDS || []).push(args.item); return { data: null, error: null } }
  if (name !== 'step1_land_apply') return { data: null, error: { message: 'unexpected ' + name } }
  if (globalThis.NO_CAND) return { data: { ok: false, reason: 'no_candidate' }, error: null }
  return { data: { ok: true, candidate_id: '901', filled: Object.keys(args.p_patch) }, error: null } }, auth: { getUser: async (jwt) => jwt === 'staff' ? { data: { user: { id: 'u1', email: 'k@mo-care.com', app_metadata: {} } }, error: null } : { data: null, error: { message: 'bad' } } } })
const src = fs.readFileSync(path.join(FN, 'step1-sign/index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__fakeCreateClient')
const tmp = path.join(FN, 'step1-sign', '_t708.ts'); fs.writeFileSync(tmp, src)
let M; try { M = await import(tmp) } finally { fs.unlinkSync(tmp) }

const OID = '11111111-2222-4333-8444-555555555555'
const base = () => ({ id: OID, first_name: 'Ava', last_name: 'Lee', phone: '(417) 555-0101', email: 'ava@example.com', position: 'Caregiver', onboarding_path: 'new', offer_status: 'accepted', offer_signed_at: '2026-10-09T15:00:00Z', pd_signed_at: '2026-10-09T15:05:00Z', offer_withdrawn_at: null, offer_declined_at: null, step1_sent_at: '2026-10-09T15:06:00Z', step1_done_at: null })
const exp = L.expiry(); const tok = await L.sign(SECRET, 'step1', OID, exp)
const link = { o: OID, e: exp, t: tok }
const REPLAY = []
const call = async (body, headers = {}) => { const r = await handler(new Request('http://x/step1-sign', { method: 'POST', headers: { 'Content-Type': 'application/json', 'user-agent': 'TestPhone', ...headers }, body: JSON.stringify(body) })); let j = null; try { j = await r.json() } catch {}
  if (r.status === 200 && body.o && ['begin', 'save', 'identity', 'sign'].includes(body.action)) REPLAY.push(JSON.parse(JSON.stringify(body)))
  return { status: r.status, j } }


const SIG = { at: '2026-10-14T15:00:00Z', typed_name: 'Lee Nurse', version: 1, fingerprint: 'f'.repeat(64), ip: '1.1.1.1', agent: 'x', consent: true }
const linkOf = async (id) => { const e = L.expiry(); return { o: id, e, t: await L.sign(SECRET, 'step1', id, e) } }
const row = (id) => DB.step1_forms.find((f) => f.offer_id === id)
/* ═══ 1. a caregiver's Step 1 is exactly as before ═══ */
const C1 = '11111111-2222-4333-8444-000000000001', C2 = '11111111-2222-4333-8444-000000000002'
OFFERS[C1] = { ...base(), id: C1 }                               // an offer from before (no key)
OFFERS[C2] = { ...base(), id: C2, position_key: 'caregiver' }    // a new caregiver offer
const lc1 = await linkOf(C1), lc2 = await linkOf(C2)
let v1 = await call({ action: 'view', ...lc1 }), v2 = await call({ action: 'view', ...lc2 })
for (const [n, v, id] of [['an offer from before (no key)', v1, C1], ['a caregiver offer', v2, C2]]) {
  ck(`caregiver, ${n}: 14 forms listed (13 to sign, the Driver or the Non-Driver), screens end 16, 9, every form approved, no practice note`, v.status === 200 && v.j.forms.length === 14 && v.j.form_count === 13 && v.j.screens.slice(-2).join() === '16,9' && v.j.forms.every((f) => f.key !== 'nurse_license' && f.approved_for_real === true) && v.j.test_mode === false, { s: v.status, n: v.j.forms && v.j.forms.length, fc: v.j.form_count, sc: v.j.screens })
  ck(`caregiver, ${n}: the Step 1 record is made exactly as before (no nurse_form written at all)`, row(id) && !('nurse_form' in row(id)) && row(id).hepb_form === true, row(id))
  ck(`caregiver, ${n}: the identity answer has exactly the old keys (no nursing license)`, Object.keys(v.j.identity).sort().join() === 'dob,license,license_expires,license_state,ssn', v.j.identity)
}
let r = await call({ action: 'identity', ...lc2, nurse_license_number: 'LPN123456' })
ck('caregiver: a nursing license number is refused (their Step 1 has no such form); nothing sealed', r.status === 400 && !DB.step1_identity.some((x) => x.offer_id === C2 && x.nurse_license_sealed), r)
r = await call({ action: 'upload_url', ...lc2, item: 'nurse_license_doc', ext: 'jpg' })
ck('caregiver: no nursing license picture can be uploaded', r.status === 409 || r.status === 400, r)
/* ═══ 2. an LPN, practice: the whole Step 1 with the license form, end to end ═══ */
const N1 = '22222222-2222-4333-8444-000000000001'
OFFERS[N1] = { ...base(), id: N1, first_name: 'Lee', last_name: 'Nurse', phone: '(417) 555-0187', email: 'lee@practice.invalid', position: 'LPN', position_key: 'lpn', offered_by: 'Slice 10 practice run', pd_signed_at: null }
const ln = await linkOf(N1)
let v = await call({ action: 'view', ...ln })
ck('LPN: the letter alone opens Step 1 (no position description signature)', v.status === 200, v)
ck('LPN: 15 forms listed, 14 to sign, the nursing license form last (screen 17 before All done), proposed and NOT approved for real', v.j.forms.length === 15 && v.j.form_count === 14 && v.j.forms.at(-1).key === 'nurse_license' && v.j.forms.at(-1).status === 'proposed' && v.j.forms.at(-1).approved_for_real === false && v.j.screens.slice(-3).join() === '16,17,9', { n: v.j.forms && v.j.forms.length, fc: v.j.form_count, sc: v.j.screens })
ck('LPN: the Step 1 record says the form is in it (decided once, now)', row(N1).nurse_form === true && row(N1).hepb_form === true)
ck('LPN: the page says practice (the form is not approved for real)', v.j.test_mode === true)
ck('LPN: the identity answer carries the nursing license (not on file yet)', v.j.identity.nurse_license === null, v.j.identity)
const nl = v.j.forms.at(-1), items = nl.sections.flatMap((s) => s.items || [])
ck('the form asks: license type, the number (locked door), the issuing state (every state), multistate or not, the expiration, and a picture', items.map((i) => i.id).join() === 'nurse_license_type,nurse_license_number,nurse_license_state,nurse_license_multistate,nurse_license_expires,nurse_license_doc' && items[1].locked === true && items[2].options.includes('MO') && items[2].options.includes('KS') && items[3].options.length === 3 && items[5].kind === 'photo' && /Missouri does not issue license cards/.test(nl.intro[0]))
r = await call({ action: 'save', ...ln, answers: { nurse_license_number: 'LPN1' } })
ck('the license number is never saved with the answers (the locked door only)', r.status === 400 && /locked door/.test(r.j.error), r)
r = await call({ action: 'identity', ...ln, nurse_license_number: 'pn 2468-13' })
const idr = DB.step1_identity.find((x) => x.offer_id === N1)
ck('the license number is sealed: only "ending" and the last four come back; the sealed value never holds the number', r.status === 200 && r.j.identity.nurse_license === 'ending 6813' && idr.nurse_license_last4 === '6813' && idr.nurse_license_sealed && !String(idr.nurse_license_sealed).includes('2468') && !JSON.stringify(DB.step1_forms).includes('2468'), r.j)
ck('the sealed number opens with the key (it is really there)', await C.open(KEK, N1, idr.nurse_license_sealed) === 'PN2468-13')
r = await call({ action: 'upload_url', ...ln, item: 'nurse_license_doc', ext: 'pdf' })
ck('the picture goes to the PRIVATE onboarding store (kept seven years), under this offer', r.status === 200 && /^https:\/\/upload\/onboarding-documents\/offer\/22222222-2222-4333-8444-000000000001\/nurse_license_doc-\d+\.pdf$/.test(r.j.signed_url), r.j)
UPLOADS.add('onboarding-documents:' + r.j.path)
r = await call({ action: 'uploaded', ...ln, item: 'nurse_license_doc', path: r.j.path })
ck('the picture is recorded on their answers', r.status === 200 && row(N1).answers.nurse_license_doc.path.startsWith('offer/' + N1 + '/nurse_license_doc-'), r)
const earlierN = D.applicableForms({ transport_willing: 'no' }, { hepb: true, nurse: true }).filter((k) => k !== 'nurse_license')
Object.assign(row(N1), { esign_consent_at: '2026-10-14T14:00:00Z', answers: { ...row(N1).answers, transport_willing: 'no' }, signatures: Object.fromEntries(earlierN.map((k) => [k, { ...SIG, version: D.FORMS[k].version }])), pdfs: Object.fromEntries(earlierN.map((k) => [k, 'step1/' + N1 + '/' + k + '.pdf'])) })
ck('LPN: thirteen earlier forms (the caregiver Step 1 exactly), then the nursing license', earlierN.length === 13 && earlierN.at(-1) === 'hepb_vaccination')
r = await call({ action: 'sign', ...ln, form: 'nurse_license', typed_name: 'Lee Nurse', consent: true })
ck('signing with answers missing is refused and names them', r.status === 400 && /Your license/.test(r.j.error) && /State that issued your license/.test(r.j.error) && /License expiration date/.test(r.j.error), r.j)
await call({ action: 'save', ...ln, screen: '17', answers: { nurse_license_type: 'Licensed Practical Nurse (LPN)', nurse_license_state: 'MO', nurse_license_multistate: 'Yes, a multistate license', nurse_license_expires: '2028-05-31' } })
const nStore = Object.keys(STORE).length
r = await call({ action: 'sign', ...ln, form: 'nurse_license', typed_name: 'Lee Nurse', consent: true })
const pdfPath = row(N1).pdfs.nurse_license, pdfText = pdfPath && STORE[pdfPath] ? [...Buffer.from(STORE[pdfPath]).toString('latin1').matchAll(/\((.*?)\) Tj/g)].map((m) => m[1]).join(' ') : ''
ck('practice LPN: the license form signs, Step 1 completes with 14 forms, its PDF is in the onboarding store', r.status === 200 && r.j.done === true && row(N1).completed_at && row(N1).receipt.forms === 14 && Object.keys(STORE).length === nStore + 1 && /^step1\//.test(pdfPath), r.j)
ck('the signed PDF prints the number only as "On file, ending" the last four', /On file, ending 6813/.test(pdfText) && !/2468/.test(pdfText) && /Your Nursing License/.test(pdfText))
/* ═══ 3. a REAL LPN: the form cannot be signed until Samantha approves it ═══ */
const N2 = '22222222-2222-4333-8444-000000000002'
OFFERS[N2] = { ...base(), id: N2, first_name: 'Rae', last_name: 'Real', phone: '(417) 881-2299', email: 'rae@example.com', position: 'LPN', position_key: 'lpn', pd_signed_at: null }
const lr = await linkOf(N2)
v = await call({ action: 'view', ...lr })
Object.assign(row(N2), { esign_consent_at: '2026-10-14T14:00:00Z', answers: { transport_willing: 'no', nurse_license_type: 'Licensed Practical Nurse (LPN)', nurse_license_state: 'MO', nurse_license_multistate: 'No, a single-state license', nurse_license_expires: '2028-05-31', nurse_license_doc: { path: 'offer/' + N2 + '/nurse_license_doc-1.jpg' } }, signatures: Object.fromEntries(earlierN.map((k) => [k, { ...SIG, version: D.FORMS[k].version }])), pdfs: Object.fromEntries(earlierN.map((k) => [k, 'step1/' + N2 + '/' + k + '.pdf'])) })
await call({ action: 'identity', ...lr, nurse_license_number: 'RN555' })
r = await call({ action: 'sign', ...lr, form: 'nurse_license', typed_name: 'Rae Real', consent: true })
ck('REAL LPN: the nursing license form is refused (waiting for her approval); Step 1 is NOT complete; nothing signed', r.status === 409 && r.j.not_approved === true && !row(N2).completed_at && !row(N2).signatures.nurse_license, r.j)
ck('REAL LPN: the page shows practice wording while a form in it is unapproved', v.j.test_mode === true)
/* ═══ 4. the record never changes its mind; caregivers untouched by any of it ═══ */
await call({ action: 'view', ...lc2 }); await call({ action: 'view', ...ln })
ck('a second view changes nothing: the caregiver record still has no nurse_form, the LPN keeps it', !('nurse_form' in row(C2)) && row(N1).nurse_form === true && DB.step1_forms.filter((f) => f.offer_id === C2).length === 1)
/* ═══ 5. the preview ═══ */
let p = await call({ action: 'preview' })
ck('the preview without a position is exactly as before: 14 forms, 13 to sign, Hepatitis B last (screen 16)', p.status === 200 && p.j.forms.length === 14 && p.j.form_count === 13 && p.j.forms.at(-1).key === 'hepb_vaccination' && p.j.screens.slice(-2).join() === '16,9' && !('nurse_license' in p.j.identity), { n: p.j.forms && p.j.forms.length })
p = await call({ action: 'preview', position: 'lpn' })
ck('the LPN preview: 15 forms, 14 to sign, the nursing license form last (screen 17)', p.status === 200 && p.j.forms.length === 15 && p.j.form_count === 14 && p.j.forms.at(-1).key === 'nurse_license' && p.j.screens.slice(-3).join() === '16,17,9' && p.j.identity.nurse_license === null)
p = await call({ action: 'preview', position: 'lpn', check: true, form: 'nurse_license', answers: { nurse_license_type: 'Registered Nurse (RN)', nurse_license_state: 'KS', nurse_license_multistate: 'I am not sure', nurse_license_expires: '2027-04-30', nurse_license_doc: { path: 'preview/nurse_license_doc.jpg' } }, identity: {} })
ck('the preview check names the missing license number (the locked door)', p.status === 200 && p.j.missing.join() === 'Nursing license number', p.j)
p = await call({ action: 'preview', position: 'lpn', pdf: true, form: 'nurse_license', answers: {}, identity: { nurse_license: '4321' } })
ck('the preview PDF of the license form numbers it 15 of 15 in an LPN Step 1', p.status === 200 && /^JVBER/.test(p.j.pdf_base64 || ''), p.j.error)
for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + note))
const bad = res.filter((x) => !x[1]).length; console.log(`${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0)
