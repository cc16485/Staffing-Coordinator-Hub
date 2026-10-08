// Web referrals (Step 1 of the Referral Partner Desk, 2026-10-08): the REAL lead-intake with sample submissions, against a
// fake database and a fake GoHighLevel. node referral_intake_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 1200)])
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_ri_'))
const clone = (x) => JSON.parse(JSON.stringify(x))
let T, SENT, GHLHOOK
const ORGS = [{ id: 'org-mercy', name: 'Mercy Hospital', type: 'Hospital', phone: '(417) 555-0100', people: 'Dana Smith (social work)' },
  { id: 'org-cox', name: 'CoxHealth', type: 'Hospital', phone: '' }, { id: 'org-cox2', name: 'Cox Health', type: 'Hospital', phone: '' },
  { id: 'org-fount', name: 'The Fountains', type: 'Assisted Living', phone: '417-555-0199' }]
const reset = (ack = true) => {
  T = { app_data: [{ key: 'leads', data: [] }, { key: 'referral_orgs', data: clone(ORGS) }, { key: 'ops_items', data: [] },
    { key: 'ops_settings', data: { inquiry_ack_live: ack, lead_response_hours: { open: '00:00', close: '23:59', days: [0, 1, 2, 3, 4, 5, 6] } } }],
    applicant_alerts: [{ name: 'Krystal', phone: '4175550900', email: 'krystal@mo-care.com', active: true, alert_on: ['lead'] }] }
  SENT = []; GHLHOOK = []
}
/* a permissive fake: every chain resolves from T[table] with eq filters; writes are recorded */
function q(t) {
  const st = { f: [], op: 'select', row: null, single: false }
  const run = () => {
    const rows = (T[t] || []).filter((r) => st.f.every(([k, v]) => String(r[k]) === String(v)))
    if (st.op !== 'select') { (T['_w_' + t] = T['_w_' + t] || []).push(st.row); return { data: st.single ? st.row : [st.row], error: null } }
    return { data: st.single ? (rows[0] ? clone(rows[0]) : null) : clone(rows), error: null }
  }
  const b = new Proxy({}, { get: (_, k) => {
    if (k === 'then') return (ok, ko) => Promise.resolve(run()).then(ok, ko)
    if (k === 'eq') return (a, v) => { st.f.push([a, v]); return b }
    if (k === 'insert' || k === 'upsert' || k === 'update') return (r) => { st.op = k; st.row = r; return b }
    if (k === 'single' || k === 'maybeSingle') return () => { st.single = true; return Promise.resolve(run()) }
    return () => b } })
  return b
}
globalThis.__db = { from: q, rpc: async (fn, a) => {
  if (fn === 'upsert_app_data_item') { const row = T.app_data.find((r) => r.key === a.target_key) || (T.app_data.push({ key: a.target_key, data: [] }), T.app_data.at(-1)); const i = row.data.findIndex((x) => x.id === a.item.id); if (i >= 0) row.data[i] = clone(a.item); else row.data.push(clone(a.item)) }
  return { data: null, error: null } } }
globalThis.fetch = async (url, o = {}) => { url = String(url); const body = o.body ? JSON.parse(o.body) : {}
  if (url === 'https://hook.example/ghl') { GHLHOOK.push(body); return new Response('{}', { status: 200 }) }
  if (/contacts\/search|contacts\/upsert|duplicate/.test(url)) return new Response(JSON.stringify({ contact: { id: 'c-' + (body.phone || body.email || 'x') }, contacts: [{ id: 'c-' + (body.phone || body.email || 'x'), dnd: false }] }), { status: 200 })
  if (/conversations\/messages/.test(url)) { SENT.push(body); return new Response(JSON.stringify({ messageId: 'm1' }), { status: 200 }) }
  return new Response(JSON.stringify({ contacts: [], contact: { id: 'c-any' } }), { status: 200 }) }
const ENV = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k', LEAD_INTAKE_TOKEN: 'tok', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', GHL_HOOK_CCLEADS: 'https://hook.example/ghl' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
try {
  const src = fs.readFileSync(path.join(F, 'lead-intake/index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace(/from '\.\.\/_shared\/([\w-]+)\.ts'/g, (_, m) => "from '" + path.join(process.cwd(), F, '_shared', m + '.ts') + "'")
  fs.writeFileSync(path.join(tmp, 'li.ts'), src); await import(path.join(tmp, 'li.ts'))
  const post = async (body) => { const r = await handler(new Request('http://x/lead-intake?token=tok', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })); return { s: r.status, j: await r.json() } }
  const leads = () => T.app_data.find((r) => r.key === 'leads').data
  const REF = (o) => Object.assign({ kind: 'professional_referral', referrer_name: 'Lisa Marsh', referrer_org: 'Mercy Hospital', referrer_type: 'hospital', referrer_contact: '417-555-0111',
    client_initials: 'R.A.', urgency: 'Urgent', situation: 'Discharging Friday after a hip replacement, lives alone, needs help mornings.' }, o)

  /* 1 · an urgent hospital referral from a known partner */
  reset(); let r = await post(REF())
  let L = leads()[0]
  ck('urgent hospital referral: saved as a Referral, the client by initials, the family\'s number unknown', r.s === 200 && r.j.status === 'referral received' && L.source === 'Referral' && L.first_name === 'R.A.' && L.phone === '' && L.email === '' && L.family_contact_unknown === true, [r.j, L])
  ck('...the referrer is kept apart (name, organization, type, phone), never as the family', L.referrer.name === 'Lisa Marsh' && L.referrer.org === 'Mercy Hospital' && L.referrer.phone === '417-555-0111' && L.referrer.type_label === 'Hospital / Discharge Planner', L.referrer)
  ck('...linked to the existing partner (one exact name match), subtype hospital, urgency urgent', L.referral_org_id === 'org-mercy' && L.referral_subtype === 'hospital' && L.referral_urgency === 'urgent' && !L.referral_org_suggest, L)
  ck('...the notes carry the situation, who referred, the urgency and how to reach the referrer', /hip replacement/.test(L.interest_notes) && /Referred by Lisa Marsh, Mercy Hospital \(Hospital \/ Discharge Planner\)/.test(L.interest_notes) && /Urgency: Urgent/.test(L.interest_notes) && /Reach the referrer: 417-555-0111/.test(L.interest_notes))
  ck('...NOTHING goes to the referrer: no acknowledgment (even with the switch on), no GoHighLevel lead contact', !SENT.some((m) => /Thank you for reaching out about care/.test(m.message || m.html || '')) && GHLHOOK.length === 0, { SENT, GHLHOOK })
  ck('...the office is told: "URGENT referral from Lisa Marsh, Mercy Hospital", with the referrer\'s number', SENT.some((m) => /URGENT referral from Lisa Marsh, Mercy Hospital/.test(m.subject || m.message || '')) && SENT.some((m) => /417-555-0111/.test(m.html || m.message || '')), SENT.map((m) => m.subject || m.message))
  ck('...no "same family?" check against the referrer (no phone or email on the lead)', !L.possibly_returning && !T.app_data.find((x) => x.key === 'ops_items').data.length)
  ck('...the partner list is untouched', JSON.stringify(T.app_data.find((x) => x.key === 'referral_orgs').data) === JSON.stringify(ORGS))

  /* 2 · the same planner refers again: a new lead, not "the same family" */
  r = await post(REF({ client_initials: 'J.K.', urgency: 'Within a week' }))
  ck('the same planner refers again: a second, separate referral, never "possibly returning"', leads().length === 2 && !leads()[1].possibly_returning && leads()[1].referral_urgency === 'within_week')

  /* 3 · an unknown organization */
  reset(); r = await post(REF({ referrer_org: 'St. Johns Rehab', referrer_type: 'snf', referrer_contact: 'kim@stjohnsrehab.org', referrer_name: 'Kim Lee', urgency: 'Routine' }))
  L = leads()[0]
  ck('unknown organization: not linked, marked "new partner to confirm"; nothing added to Referrers', !L.referral_org_id && L.referral_org_suggest.name === 'St. Johns Rehab' && L.referral_org_suggest.type === 'Skilled Nursing Facility' && T.app_data.find((x) => x.key === 'referral_orgs').data.length === 4, L)
  ck('...an email-only referrer: email kept, subtype rehab, routine', L.referrer.email === 'kim@stjohnsrehab.org' && !L.referrer.phone && L.referral_subtype === 'snf_rehab' && L.referral_urgency === 'routine')
  /* 4 · a name that matches two partner records: never a guess */
  reset(); r = await post(REF({ referrer_org: 'Cox Health', referrer_contact: '4175550222' }))
  ck('a name that matches one record exactly (Cox Health, not CoxHealth) links that one', leads()[0].referral_org_id === 'org-cox2', leads()[0])
  reset(); T.app_data.find((x) => x.key === 'referral_orgs').data.push({ id: 'org-mercy-dup', name: 'Mercy hospital', type: 'Hospital' }); r = await post(REF())
  ck('two partner records with the same name: not linked (a person picks), never a guess', !leads()[0].referral_org_id && leads()[0].referral_org_suggest.name === 'Mercy Hospital', leads()[0])
  /* 5 · matched by phone when the name is written differently */
  reset(); r = await post(REF({ referrer_org: 'Fountains Senior Living', referrer_type: 'case-manager', referrer_contact: '(417) 555-0199' }))
  ck('a different spelling but the partner\'s own phone: linked by phone', leads()[0].referral_org_id === 'org-fount', leads()[0])
  /* 6 · nothing to reach the referrer */
  reset(); r = await post({ kind: 'professional_referral', client_initials: 'A.B.', situation: 'x' })
  ck('a referral with no name, phone or email for the referrer is refused (the form asks again), nothing saved', r.s === 400 && leads().length === 0)
  /* 7 · family forms are unchanged */
  reset(); r = await post({ name: 'Mary Jones', phone: '4175550333', message: 'Help for my dad' })
  L = leads()[0]
  ck('a family\'s own inquiry is unchanged: Website, their name and phone, the GoHighLevel contact', L.source === 'Website' && L.phone === '4175550333' && L.first_name === 'Mary' && GHLHOOK.length === 1 && r.j.status === 'lead created', [L, r.j, GHLHOOK.length])
  reset(); r = await post({ name: 'Ann Lee', phone: '4175550444', message: 'Mom needs help', heard_from: 'Mercy Hospital' })
  ck('a family who says a partner sent them: still Referral by name, as before', leads()[0].source === 'Referral' && leads()[0].referral_source_name === 'Mercy Hospital' && leads()[0].phone === '4175550444')
  reset(); r = await post({ kind: 'course_signup', email: 'x@y.com', course: 'dementia-journey' })
  ck('a course signup is still not a lead', leads().length === 0 && r.j.routed === 'course_signup')
  reset(); r = await post(Object.assign(REF(), { website: 'spam' }))
  ck('the honeypot still drops bots, referral or not', leads().length === 0)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
