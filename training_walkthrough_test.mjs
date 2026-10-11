// training-walkthrough (Samantha 2026-10-11): office staff try the new-hire journey on their OWN phone and email. Start puts
// them on the test list, makes a "(TRAINING)" new-path offer and sends its real link; End (the starter or an owner) and the
// daily sweep (14 days) withdraw it, close the Hub side and take off only what the walkthrough added. Fakes only.
//   node training_walkthrough_test.mjs
import fs from 'fs'; import path from 'path'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 700)])
const SECRET = 'cron-secret-0123456789abcdef-0123456789'
const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'svc', OFFERS_PROJECT_URL: 'http://trn', OFFERS_SERVICE_ROLE_KEY: 'tkey', HUB_JOB_SECRET: SECRET }
let handler = null; globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h } }
const TRN = { caregivers: [{ id: 'tc1', mobile_phone: '(417) 555-7777', email: 'cg@x.com' }], job_offers: [{ id: 'o-real', phone: '4175556666', email: 'open@x.com', offer_withdrawn_at: null }], offer_events: [] }
const SENDS = [], PATCHES = []
let nextOffer = 1, sendAnswer = { ok: true, offer_sent: { sms: true, email: true, held: false, practice: false }, not_sent: [] }
globalThis.fetch = async (url, init = {}) => { const u = decodeURIComponent(String(url)), m = init.method || 'GET'
  if (u === 'https://rdqujxiycycwhskyvrwa.supabase.co/functions/v1/job-offer') { SENDS.push({ headers: init.headers, body: JSON.parse(init.body) }); return new Response(JSON.stringify(sendAnswer), { status: 200 }) }
  const t = (u.match(/^http:\/\/trn\/rest\/v1\/(\w+)/) || [])[1]
  if (!t) throw new Error('unexpected fetch ' + u)
  if (m === 'POST') { const row = { ...JSON.parse(init.body) }; if (t === 'job_offers') row.id = 'trn-offer-' + nextOffer++; TRN[t].push(row); return new Response(JSON.stringify([row]), { status: 201 }) }
  if (m === 'PATCH') { PATCHES.push(u); const id = (u.match(/id=eq\.([^&]+)/) || [])[1]; const hit = TRN[t].filter((r) => r.id === id && !r.offer_withdrawn_at && r.offered_by === 'Training walkthrough'); hit.forEach((r) => Object.assign(r, JSON.parse(init.body))); return new Response(JSON.stringify(hit), { status: 200 }) }
  if (t === 'caregivers') { const last4 = (u.match(/ilike\.\*(\d{4})\*/) || [])[1], em = (u.match(/email\.eq\.([^,)]+)/) || [])[1], ids = (u.match(/id=in\.\(([^)]*)\)/) || [])[1]
    return new Response(JSON.stringify(ids ? TRN.caregivers.filter((c) => ids.split(',').includes(c.id)) : TRN.caregivers.filter((c) => c.mobile_phone.replace(/\D/g, '').includes(last4) || c.email === em)), { status: 200 }) }
  if (t === 'job_offers') { const open = TRN.job_offers.filter((o) => !o.offer_withdrawn_at), last4 = (u.match(/phone=ilike\.\*(\d{4})\*/) || [])[1], em = (u.match(/email=ilike\.([^&]+)/) || [])[1]
    return new Response(JSON.stringify(last4 ? open.filter((o) => String(o.phone).includes(last4)) : em ? open.filter((o) => String(o.email).toLowerCase() === em) : open), { status: 200 }) }
  throw new Error('unexpected fetch ' + u) }
const DB = {
  app_data: [{ key: 'ops_settings', data: { test_people: { phones: ['4175932789'], emails: ['boss@x.com'] } } }, { key: 'candidates', data: [{ id: 12, first: 'Real', last: 'Person', phone: '4175558888', email: 'real@x.com' }] },
    { key: 'caregivers', data: [] }, { key: 'training_walkthroughs', data: [] }],
  auth_identities: [{ auth_user_id: 'u-sam', person_id: 'p-sam', project_ref: 'zngsgedlsxinbygwmxwn' }, { auth_user_id: 'u-kay', person_id: 'p-kay', project_ref: 'zngsgedlsxinbygwmxwn' }, { auth_user_id: 'u-zed', person_id: 'p-zed', project_ref: 'zngsgedlsxinbygwmxwn' }],
  persons: [{ person_id: 'p-sam', full_name: 'Samantha', active: true }, { person_id: 'p-kay', full_name: 'Kay Office', active: true }, { person_id: 'p-zed', full_name: 'Zed Office', active: true }],
  entity_memberships: ['p-sam', 'p-kay', 'p-zed'].map((p) => ({ person_id: p, entity: 'cc_ihs', active: true, ended_at: null })),
  staff_roles: [{ person_id: 'p-sam', entity: 'cc_ihs', role: 'owner_admin' }, { person_id: 'p-kay', entity: 'cc_ihs', role: 'care_coordinator' }, { person_id: 'p-zed', entity: 'cc_ihs', role: 'staffing_coordinator' }],
}
const ad = (k) => DB.app_data.find((r) => r.key === k)
function table(name) {
  const q = (filters = []) => { const run = () => JSON.parse(JSON.stringify((DB[name] || []).filter((r) => filters.every((f) => f(r)))))
    const api = { eq: (k, v) => q([...filters, (r) => String(r[k]) === String(v)]), select: () => q(filters), limit: () => q(filters),
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }), then: (ok) => ok({ data: run(), error: null }) }
    return api }
  return { select: () => q() }
}
const RPC = []
const rpc = async (fn, a) => { RPC.push([fn, a])
  if (fn === 'upsert_app_data_item') { const row = ad(a.target_key); const i = row.data.findIndex((x) => x.id === a.item.id); if (i >= 0) row.data[i] = a.item; else row.data.push(a.item); return { data: null, error: null } }
  const tp = ad('ops_settings').data.test_people
  if (fn === 'test_people_add') { const ap = !!a.p_phone && !tp.phones.includes(a.p_phone), ae = !!a.p_email && !tp.emails.includes(a.p_email); if (ap) tp.phones.push(a.p_phone); if (ae) tp.emails.push(a.p_email); return { data: { ok: true, added_phone: ap, added_email: ae }, error: null } }
  if (fn === 'test_people_remove') { tp.phones = tp.phones.filter((x) => x !== a.p_phone); tp.emails = tp.emails.filter((x) => x !== a.p_email); return { data: { ok: true }, error: null } }
  if (fn === 'training_walkthrough_close') return { data: { ok: true, records_off_lists: 1, cards_closed: 2, welcome_calls_cancelled: 0 }, error: null }
  return { data: null, error: null } }
const USERS = { sam: ['u-sam', 'samantha@mo-care.com'], kay: ['u-kay', 'kay@mo-care.com'], zed: ['u-zed', 'zed@mo-care.com'] }
globalThis.__fakeCreateClient = () => ({ from: table, rpc, auth: { getUser: async (jwt) => USERS[jwt] ? { data: { user: { id: USERS[jwt][0], email: USERS[jwt][1], app_metadata: {} } }, error: null } : { data: null, error: { message: 'bad' } } } })
const TMP = path.join(ROOT, '.tw_under_test'); fs.rmSync(TMP, { recursive: true, force: true }); fs.cpSync(FN, TMP, { recursive: true })
for (const p of fs.readdirSync(TMP, { recursive: true })) { const f = path.join(TMP, String(p)); if (!f.endsWith('.ts')) continue; fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__fakeCreateClient').replace(/^import .* from ['"]https:[^'"]*['"];?$/mg, '')) }
let mod; try { mod = await import(path.join(TMP, 'training-walkthrough', 'index.ts')) } finally { fs.rmSync(TMP, { recursive: true, force: true }) }
const call = async (b, tok, extra = {}) => { const r = await handler(new Request('http://x/training-walkthrough', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}), ...extra }, body: JSON.stringify(b) })); let j = null; try { j = await r.json() } catch {} return { status: r.status, j } }
const tp = () => ad('ops_settings').data.test_people, W = () => ad('training_walkthroughs').data

const src = fs.readFileSync(path.join(FN, 'training-walkthrough/index.ts'), 'utf8')
ck('no em dash; never writes AxisCare', !/—/.test(src) && !/axiscare\.com/i.test(src))
ck('the label and the 14 days', mod.LABEL === 'Training walkthrough' && mod.DAYS === 14)
let r = await call({ action: 'list' })
ck('no sign-in: refused', r.status === 401, r)
r = await call({ action: 'start', first: 'Kay', phone: '417-555-0100', email: 'kay@home.com' }, 'nobody')
ck('a bad sign-in: refused, nothing made', r.status === 401 && TRN.job_offers.length === 1, r)
for (const [b, re] of [[{ first: 'K' }, /first name/], [{ first: 'Kay', phone: '555-0100' }, /ten digits/], [{ first: 'Kay', phone: '4175550100', email: 'nope' }, /email/],
  [{ first: 'Kay', phone: '4175558888', email: 'k@x.com' }, /applicant or caregiver record/], [{ first: 'Kay', phone: '4175550100', email: 'REAL@x.com' }, /applicant or caregiver record/],
  [{ first: 'Kay', phone: '417 555 7777', email: 'k@x.com' }, /Training Platform caregiver/], [{ first: 'Kay', phone: '4175556666', email: 'k@x.com' }, /open offer/], [{ first: 'Kay', phone: '4175550100', email: 'open@x.com' }, /open offer/]]) {
  r = await call({ action: 'start', ...b }, 'kay')
  ck('start refused: ' + re.source, r.status >= 400 && re.test(r.j?.error || ''), r)
}
ck('nothing was made by the refusals (no offer, nothing on the test list)', TRN.job_offers.length === 1 && tp().phones.length === 1 && W().length === 0 && SENDS.length === 0)
r = await call({ action: 'start', first: 'Kay<script>', phone: '(417) 555-0100', email: ' Kay@Home.com ' }, 'kay')
const o = TRN.job_offers.find((x) => x.id === 'trn-offer-1')
ck('start: ok, a new-path "(TRAINING)" offer labelled Training walkthrough, by Kay, no expiry of its own (the Resend takes the Hub calendar)', r.status === 200 && o && o.first_name === 'Kayscript' && o.last_name === '(TRAINING)' && o.onboarding_path === 'new' && o.offered_by === 'Training walkthrough' && o.offer_sent_by === 'kay@mo-care.com' && !('offer_expires_at' in o) && o.hours_type === 'PART_TIME' && o.classification === 'part_time', [r, o])
ck('start: her phone and email on the test list, the rest kept', tp().phones.join() === '4175932789,4175550100' && tp().emails.join() === 'boss@x.com,kay@home.com', tp())
const w = W()[0]
ck('start: the walkthrough is recorded (open, 14 days, what it added)', w && w.id === 'trn-offer-1' && w.status === 'open' && w.by_email === 'kay@mo-care.com' && w.added_phone && w.added_email && Date.parse(w.ends_at) - Date.parse(w.started_at) === 14 * 86400000, w)
ck('start: the real offer link sent through job-offer resend_offer, with Kay\'s own sign-in as x-hub-token and the Training key', SENDS.length === 1 && SENDS[0].body.action === 'resend_offer' && SENDS[0].body.offer_id === 'trn-offer-1' && SENDS[0].headers['x-hub-token'] === 'kay' && SENDS[0].headers.Authorization === 'Bearer tkey', SENDS)
ck('start: says what was sent', r.j.offer_sent?.sms === true && r.j.offer_sent?.email === true && Array.isArray(r.j.not_sent), r.j)
r = await call({ action: 'start', first: 'Kay', phone: '4175550101', email: 'kay2@home.com' }, 'kay')
ck('one open walkthrough per person', r.status === 409 && /already have a walkthrough open/.test(r.j.error), r)
r = await call({ action: 'start', first: 'Zed', phone: '4175550100', email: 'zed@home.com' }, 'zed')
ck('another person cannot reuse an open walkthrough\'s phone', r.status === 409 && /another open walkthrough/.test(r.j.error), r)
sendAnswer = { error: 'The Hub could not be reached, so nothing was sent.' }
r = await call({ action: 'start', first: 'Zed', phone: '4175550102', email: 'BOSS@x.com' }, 'zed')
ck('a send that fails still opens the walkthrough and says why (Resend is on the offer card)', r.status === 200 && r.j.offer_sent === null && /could not be reached/.test(r.j.not_sent.join()), r.j)
const wz = W().find((x) => x.by_email === 'zed@mo-care.com')
ck('an email already on the test list is not marked as added by the walkthrough', wz.added_phone === true && wz.added_email === false, wz)
r = await call({ action: 'list' }, 'kay')
ck('list (Kay): both open, hers marked mine, she may not end others', r.j.open.length === 2 && r.j.open.find((x) => x.mine).by_email === 'kay@mo-care.com' && r.j.may_end_all === false, r.j)
r = await call({ action: 'end', offer_id: wz.id }, 'kay')
ck('end: Kay cannot end Zed\'s', r.status === 403, r)
r = await call({ action: 'end', offer_id: 'trn-offer-1' }, 'kay')
ck('end: Kay ends hers: offer withdrawn (by label), withdrawn event, the Hub close door called', r.status === 200 && r.j.offer === 'withdrawn' && o.offer_withdrawn_at && o.offer_withdraw_reason === 'Training walkthrough ended by Kay Office' && TRN.offer_events.some((e) => e.offer_id === 'trn-offer-1' && e.kind === 'withdrawn') && RPC.some(([f, a]) => f === 'training_walkthrough_close' && a.p_offer_id === 'trn-offer-1'), [r, o])
ck('end: her phone and email off the test list; the owner\'s entries stay', tp().phones.join() === '4175932789,4175550102' && tp().emails.join() === 'boss@x.com', tp())
ck('end: the walkthrough is marked ended (kept, not deleted)', W().find((x) => x.id === 'trn-offer-1').status === 'ended' && W().length === 2)
r = await call({ action: 'end', offer_id: 'trn-offer-1' }, 'kay')
ck('end again: not open', r.status === 404, r)
r = await call({ action: 'sweep' }, 'kay')
ck('sweep: not for a staff sign-in', r.status === 401, r)
r = await call({ action: 'sweep' }, null, { 'x-cron-secret': SECRET })
ck('sweep inside the 14 days: ends nothing', r.status === 200 && r.j.ended.length === 0, r)
W().find((x) => x.id === wz.id).ends_at = new Date(Date.now() - 1000).toISOString()
r = await call({ action: 'sweep' }, null, { 'x-cron-secret': SECRET })
const z = TRN.job_offers.find((x) => x.id === wz.id)
ck('sweep after 14 days: Zed\'s ends (offer withdrawn, phone off, the owner\'s email that was already listed stays)', r.j?.ended?.length === 1 && z.offer_withdrawn_at && W().find((x) => x.id === wz.id).status === 'ended' && tp().phones.join() === '4175932789' && tp().emails.join() === 'boss@x.com', [r.j, tp()])
ck('sweep: logged in the automation log', RPC.some(([f, a]) => f === 'upsert_app_data_item' && a.target_key === 'automation_log' && a.item.automation === 'training_walkthrough'))
r = await call({ action: 'start', first: 'Sam', phone: '4175550103', email: 'sam@home.com' }, 'sam')
const ws = W().find((x) => x.by_email === 'samantha@mo-care.com')
r = await call({ action: 'list' }, 'sam')
ck('an owner may end any', r.j.may_end_all === true)
r = await call({ action: 'end', offer_id: ws.id }, 'sam')
ck('an owner ends one', r.status === 200 && r.j.offer === 'withdrawn', r)
ck('never touches an offer that is not a training walkthrough', PATCHES.every((u) => /offered_by=eq\.Training walkthrough/.test(u)) && !TRN.job_offers.find((x) => x.id === 'o-real').offer_withdrawn_at)
for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + note))
