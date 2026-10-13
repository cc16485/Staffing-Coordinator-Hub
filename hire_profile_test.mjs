// hire-profile (Samantha 2026-10-11): the main profile reads every send, receipt and completion and every signed document for
// ONE person; office staff only; a document opens only if it is that person's, and every open is logged. Fakes only.
//   node hire_profile_test.mjs
import fs from 'fs'; import path from 'path'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 700)])
const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'svc', OFFERS_PROJECT_URL: 'http://trn', OFFERS_SERVICE_ROLE_KEY: 'tkey' }
let handler = null; globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h } }
const OID = '11111111-2222-4333-8444-555555555555'
const OFFER = { id: OID, first_name: 'Pat', last_name: 'Practice', phone: '4175550183', email: 'pat.practice@practice.invalid', position: 'Caregiver', onboarding_path: 'new', pay_rate: 17,
  offer_sent_at: '2026-10-11T15:00:00Z', offer_signed_at: '2026-10-11T15:10:00Z', pd_signed_at: '2026-10-11T15:11:00Z', step1_done_at: '2026-10-11T16:00:00Z', offer_pdf_path: `offers/${OID}/offer.pdf`, pd_pdf_path: `offers/${OID}/pd.pdf` }
const OEV = [{ offer_id: OID, at: '2026-10-11T15:00:00Z', kind: 'sent', by_who: 'office', detail: { practice: true } }, { offer_id: OID, at: '2026-10-11T15:05:00Z', kind: 'viewed', by_who: 'caregiver', detail: {} },
  { offer_id: OID, at: '2026-10-11T15:10:00Z', kind: 'signed', by_who: 'caregiver', detail: {} }, { offer_id: OID, at: '2026-10-11T15:11:30Z', kind: 'step1_sent', by_who: 'signature', detail: { practice: true } },
  { offer_id: OID, at: '2026-10-11T15:20:00Z', kind: 'step1_signed', by_who: 'caregiver', detail: { form: 'fcra_disclosure' } }, { offer_id: OID, at: '2026-10-11T16:00:00Z', kind: 'step1_done', by_who: 'caregiver', detail: {} }]
globalThis.fetch = async (url) => { const u = decodeURIComponent(String(url))
  if (u.startsWith('http://trn/rest/v1/job_offers')) return new Response(JSON.stringify(/id=eq\./.test(u) ? (u.includes(OID) ? [OFFER] : []) : /phone=ilike|email=ilike/.test(u) ? [OFFER] : []), { status: 200 })
  if (u.startsWith('http://trn/rest/v1/offer_events')) return new Response(JSON.stringify(OEV.filter((e) => u.includes(e.offer_id))), { status: 200 })
  throw new Error('unexpected fetch ' + u) }
const DB = {
  app_data: [{ key: 'candidates', data: [{ id: 42, first: 'Pat', last: 'Practice', phone: '4175550183', offer_id: OID, oig: 'CLEAR', oig_date: '2026-10-11', oig_proof: 'bgcheck/42/oig.json', edl_proof: 'bgcheck/42/edl.pdf', addedAt: '2026-10-11T16:00:01Z', step2_sent_at: '2026-10-11T17:00:00Z', step2_msg: { state: 'practice' } }, { id: 9, first: 'Real', last: 'Person', offer_id: 'other', edl_proof: 'bgcheck/9/real.pdf' }] },
    { key: 'caregivers', data: [] }, { key: 'ops_items', data: [{ id: 's1done_' + OID, offer_id: OID, title: 'Step 1 complete: start background checks and references for Pat Practice', created_at: '2026-10-11T16:00:02Z', status: 'open' }] }],
  step1_forms: [{ offer_id: OID, started_at: '2026-10-11T15:12:00Z', current_screen: '9', completed_at: '2026-10-11T16:00:00Z', signatures: { fcra_disclosure: { at: '2026-10-11T15:20:00Z' }, vehicle: { at: '2026-10-11T16:00:00Z' } }, pdfs: { fcra_disclosure: `step1/${OID}/fcra.pdf`, vehicle: `step1/${OID}/vehicle.pdf` }, practice: true,
    answers: { jobs: [{ company: 'Home Helpers', role: 'Caregiver', supervisor: 'Jane Boss', did_care: 'yes', tasks: ['bathing', 'ostomy_bag'], refresher: ['ostomy_bag'] }], matching_facts: { 'Homes with cats': 'Not at this time' } } }],
  job_applicants: [{ id: 'app-1', first_name: 'Pat', last_name: 'Practice', email: 'pat.practice@practice.invalid', phone: '4175550183', created_at: '2026-10-10T12:00:00Z', screened_at: '2026-10-10T13:00:00Z', position: 'caregiver' }],
  client_journey: [{ journey_id: 'j1', subject: 'caregiver', offer_id: OID, status: 'open', created_at: '2026-10-11T15:11:00Z' }],
  client_journey_event: [{ journey_id: 'j1', at: '2026-10-11T16:00:01Z', kind: 'step1_complete', actor_name: 'The Hub', reason: 'Step 1 complete: their signed permission is in' }],
  welcome_calls: [], reference_requests: [], contact_send_refusal: [{ at: '2026-10-11T18:00:00Z', sender: 'welcome-call', channel: 'sms', address: '+14175550183', reasons: ['a practice address'] }],
  document_access_log: [], axiscare_change_log: [], evidence_history: [{ id: 1, at: '2026-10-11T16:30:00Z', source: 'app_data:candidates', record_id: '42', change: 'changed', field: 'oig_date', old_value: null, new_value: '2026-10-11', actor: 'samantha@mo-care.com' }],
  auth_identities: [{ auth_user_id: 'u-sam', person_id: 'p-sam', project_ref: 'zngsgedlsxinbygwmxwn' }], persons: [{ person_id: 'p-sam', full_name: 'Samantha', active: true }],
  entity_memberships: [{ person_id: 'p-sam', entity: 'cc_ihs', active: true, ended_at: null }], staff_roles: [{ person_id: 'p-sam', entity: 'cc_ihs', role: 'owner_admin' }],
}
function table(name) {
  const rows = () => DB[name] || []
  const q = (mode, payload, filters = [], opts = {}) => {
    const run = () => { if (mode === 'insert') { const p = Array.isArray(payload) ? payload : [payload]; (DB[name] = DB[name] || []).push(...p); return p }
      let out = rows().filter((r) => filters.every((f) => f(r))); if (opts.order) out = [...out].sort((a, b) => String(a[opts.order]).localeCompare(String(b[opts.order])) * (opts.asc === false ? -1 : 1)); if (opts.limit) out = out.slice(0, opts.limit); return JSON.parse(JSON.stringify(out)) }
    const api = { eq: (k, v) => q(mode, payload, [...filters, (r) => String(r[k]) === String(v)], opts), neq: (k, v) => q(mode, payload, [...filters, (r) => String(r[k]) !== String(v)], opts),
      in: (k, vs) => q(mode, payload, [...filters, (r) => vs.map(String).includes(String(r[k]))], opts), ilike: (k, v) => q(mode, payload, [...filters, (r) => new RegExp('^' + String(v).replace(/[.]/g, '\\.').replace(/%/g, '.*') + '$', 'i').test(String(r[k] ?? ''))], opts),
      is: (k, v) => q(mode, payload, [...filters, (r) => (r[k] ?? null) === v], opts), not: () => q(mode, payload, filters, opts),
      order: (k, o) => q(mode, payload, filters, { ...opts, order: k, asc: o?.ascending !== false }), limit: (n) => q(mode, payload, filters, { ...opts, limit: n }), select: () => q(mode, payload, filters, opts),
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }), single: async () => ({ data: run()[0] ?? null, error: null }), then: (ok) => ok({ data: run(), error: null }) }
    return api }
  return { select: () => q('select'), insert: (p) => q('insert', p) }
}
const STORE = { [`offers/${OID}/offer.pdf`]: 1, [`offers/${OID}/pd.pdf`]: 1, [`step1/${OID}/fcra.pdf`]: 1, [`step1/${OID}/vehicle.pdf`]: 1, 'bgcheck/42/oig.json': 1, 'bgcheck/42/edl.pdf': 1, 'bgcheck/9/real.pdf': 1, [`exports/${OID}/x.pdf`]: 1 }
const storage = { from: (bucket) => ({ list: async (prefix) => ({ data: Object.keys(STORE).filter((k) => k.startsWith(prefix + '/')).map((k) => ({ name: k.slice(prefix.length + 1), created_at: '2026-10-11T19:00:00Z' })), error: null }),
  createSignedUrl: async (p) => ({ data: STORE[p] ? { signedUrl: 'https://signed/' + bucket + '/' + p } : null, error: STORE[p] ? null : { message: 'no' } }) }) }
globalThis.__fakeCreateClient = () => ({ from: table, storage, rpc: async () => ({ data: null, error: null }), auth: { getUser: async (jwt) => jwt === 'sam' ? { data: { user: { id: 'u-sam', email: 'samantha@mo-care.com', app_metadata: {} } }, error: null } : { data: null, error: { message: 'bad' } } } })
const TMP = path.join(ROOT, '.hp_under_test'); fs.rmSync(TMP, { recursive: true, force: true }); fs.cpSync(FN, TMP, { recursive: true })
for (const p of fs.readdirSync(TMP, { recursive: true })) { const f = path.join(TMP, String(p)); if (!f.endsWith('.ts')) continue; fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__fakeCreateClient').replace(/^import .* from ['"]https:[^'"]*['"];?$/mg, '')) }
try { await import(path.join(TMP, 'hire-profile', 'index.ts')) } finally { fs.rmSync(TMP, { recursive: true, force: true }) }
const call = async (b, tok) => { const r = await handler(new Request('http://x/hire-profile', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(b) })); let j = null; try { j = await r.json() } catch {} return { status: r.status, j } }

let r = await call({ action: 'get', offer_id: OID })
ck('no sign-in: refused', r.status === 401, r)
r = await call({ action: 'get', offer_id: OID }, 'sam')
ck('2026-10-11: the profile carries the skills picture from Step 1 (task by task, self-reported until confirmed), restrictions, the practice mark', r.j.experience && r.j.experience.practice === true && r.j.experience.skills.map((l) => l.key + ':' + l.standing).join() === 'bathing:self_reported,ostomy_bag:self_reported' && /refresher before doing again: Emptying an ostomy bag/.test(r.j.experience.restrictions.join()) && /Not at this time: Homes with cats/.test(r.j.experience.restrictions.join()), r.j.experience)
const T = r.j?.timeline || [], txt = T.map((x) => x.type + ' ' + x.what).join('\n')
ck('the profile: name, practice phone, where they are, every id', r.status === 200 && r.j.name === 'Pat Practice' && r.j.where === 'In Background & References: checks and references' && r.j.ids.candidate_id === 42 && r.j.ids.applicant_id === 'app-1' && r.j.ids.journey_id === 'j1', r.j)
ck('timeline: applied, the offer sent (practice), opened, signed, Step 1 sent automatically (practice), a form signed by name, Step 1 complete', /received Applied/.test(txt) && /sent Offer sent \(practice: recorded, not sent\)/.test(txt) && /received They opened the offer/.test(txt) && /done Offer letter signed/.test(txt) && /sent Step 1 sent automatically \(practice/.test(txt) && /done Step 1 form signed: Permission for Background Checks and References/.test(txt) && /done Step 1 complete/.test(txt), txt)
ck('timeline: into Background & References, the OIG check, Step 2 sent (practice), the readiness event, the card, the refused text, the evidence change', /Into Background & References/.test(txt) && /OIG exclusion check recorded/.test(txt) && /Step 2 message \(practice/.test(txt) && /Readiness: Step1 complete/.test(txt) && /card Needs Attention: Step 1 complete/.test(txt) && /refused Not sent \(sms, welcome-call\)/.test(txt) && /changed Evidence: oig_date: from blank to 2026-10-11/.test(txt), txt)
ck('timeline: oldest first', T.every((x, i) => i === 0 || T[i - 1].at <= x.at))
const D = r.j?.documents || [], dl = D.map((d) => d.label).join(' | ')
ck('documents: the signed offer letter and position description, each signed Step 1 form, the check proofs, the personnel export', /Offer letter \(signed\)/.test(dl) && /Position description \(signed\)/.test(dl) && /Step 1: Permission for Background Checks and References \(signed\)/.test(dl) && /Step 1: Personal Vehicle Insurance Responsibility \(signed\)/.test(dl) && /OIG check proof/.test(dl) && /EDL check proof/.test(dl) && /Personnel file export/.test(dl), dl)
ck('documents: nobody else\'s proof', !D.some((d) => /real\.pdf/.test(d.ref)), D)
const fcra = D.find((d) => /Permission for Background Checks and References/.test(d.label))
r = await call({ action: 'doc', offer_id: OID, ref: fcra.ref }, 'sam')
ck('a document opens by a five-minute link, and the open is logged with your name', r.status === 200 && /signed\/onboarding-documents\/step1/.test(r.j.url) && DB.document_access_log.some((l) => l.offer_id === OID && /profile:Step 1: Permission for Background/.test(l.doc) && l.by_name === 'Samantha'), [r, DB.document_access_log])
r = await call({ action: 'doc', offer_id: OID, ref: 'ld:bgcheck/9/real.pdf' }, 'sam')
ck('someone else\'s document cannot be opened through this profile', r.status === 404 && !DB.document_access_log.some((l) => /real/.test(l.path || '')), r)
r = await call({ action: 'get', applicant_id: 'app-1' }, 'sam')
ck('the same profile opens from the application (found by email or phone)', r.status === 200 && r.j.ids.offer_id === OID && r.j.ids.candidate_id === 42, r.j && r.j.ids)
r = await call({ action: 'get', candidate_id: 42 }, 'sam')
ck('and from the Background & References record', r.status === 200 && r.j.ids.offer_id === OID)
r = await call({ action: 'step1_progress', offer_ids: [OID] }, 'sam')
const pr = r.j?.progress?.[OID]
ck('Step 1 progress for the offer card: sent automatically (practice), started, 2 of 11 signed so far, complete', pr && pr.sent_at === '2026-10-11T15:11:30Z' && pr.practice === true && pr.started_at && pr.signed === 2 && pr.forms === 11 && pr.completed_at, pr)
r = await call({ action: 'get', offer_id: '99999999-2222-4333-8444-555555555555' }, 'sam')
ck('nobody: not found', r.status === 404, r)
const src = fs.readFileSync(path.join(FN, 'hire-profile/index.ts'), 'utf8')
ck('reads only (the one write is the open log); CORS from day one; no em dash', !/\.update\(|\.delete\(|\.upsert\(/.test(src) && /OPTIONS/.test(src) && !/—/.test(src))
for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + note))
const bad = res.filter((x) => !x[1]).length; console.log(`${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0)
