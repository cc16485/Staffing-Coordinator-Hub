// Community Ambassador applications (2026-10-26): the REAL lead-intake with sample applications, against a fake database
// and a fake GoHighLevel. Never a lead; one "applied" ambassador record; healthcare flagged, not moved; owners told.
// node ambassador_app_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 1000)])
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_amb_'))
const clone = (x) => JSON.parse(JSON.stringify(x))
let T, SENT
const reset = () => {
  T = { app_data: [{ key: 'leads', data: [] }, { key: 'referral_orgs', data: [{ id: 'org-mercy', name: 'Mercy Hospital', type: 'Hospital' }] }, { key: 'ops_items', data: [] },
      { key: 'ops_settings', data: { inquiry_ack_live: true, lead_response_hours: { open: '00:00', close: '23:59', days: [0, 1, 2, 3, 4, 5, 6] } } }],
    applicant_alerts: [{ name: 'Krystal', phone: '4175550900', email: 'krystal@mo-care.com', active: true, alert_on: ['lead'] }],
    staff_roles: [{ person_id: 'p-sam', entity: 'cc_ihs', role: 'owner_admin' }, { person_id: 'p-zach', entity: 'cc_ihs', role: 'owner_admin' }],
    persons: [{ person_id: 'p-sam', primary_email: 'samantha@mo-care.com', active: true }, { person_id: 'p-zach', primary_email: 'zach@mo-care.com', active: true }] }
  SENT = []
}
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
  if (/conversations\/messages/.test(url)) { SENT.push(body); return new Response(JSON.stringify({ messageId: 'm1' }), { status: 200 }) }
  if (/\/contacts\/[^/?]+$/.test(url) && (!o.method || o.method === 'GET')) return new Response(JSON.stringify({ contact: { id: decodeURIComponent(url.split('/').pop()), dnd: false } }), { status: 200 })
  return new Response(JSON.stringify({ contacts: [{ id: 'c-' + (body.email || body.phone || 'x'), dnd: false }], contact: { id: 'c-' + (body.email || body.phone || 'x') } }), { status: 200 }) }
const ENV = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k', LEAD_INTAKE_TOKEN: 'tok', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', GHL_HOOK_CCLEADS: 'https://hook.example/ghl' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
try {
  const src = fs.readFileSync(path.join(F, 'lead-intake/index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace(/from '\.\.\/_shared\/([\w-]+)\.ts'/g, (_, m) => "from '" + path.join(process.cwd(), F, '_shared', m + '.ts') + "'")
  fs.writeFileSync(path.join(tmp, 'li.ts'), src); await import(path.join(tmp, 'li.ts'))
  const post = async (body) => { const r = await handler(new Request('http://x/lead-intake?token=tok', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })); return { s: r.status, j: await r.json() } }
  const orgs = () => T.app_data.find((r) => r.key === 'referral_orgs').data, leads = () => T.app_data.find((r) => r.key === 'leads').data
  const APP = (o) => Object.assign({ kind: 'ambassador_application', first_name: 'Linda', last_name: 'Ortiz', email: 'Linda@Example.com', phone: '417-555-0123', town: 'Nixa',
    share: ['friends', 'community', 'bogus'], works_in_healthcare: 'no', works_for_us: 'no', agree: { adult: true, guidelines: true, volunteer: true, privacy: true } }, o)

  reset(); let r = await post(APP()); let A = orgs().find((o) => o.program_track === 'ambassador')
  ck('a complete application: saved, answered "application received"', r.s === 200 && r.j.status === 'application received' && A, [r, A])
  ck('...as ONE Referral Partner Desk record: type Community Ambassador, status applied, no code (so nothing can link to it yet)', A.type === 'Community Ambassador' && A.program_status === 'applied' && !A.partner_code && orgs().length === 2, A)
  ck('...the answers kept: name, email (tidied), phone, town, how they\'d share (unknown choices dropped), agreements with the time', A.name === 'Linda Ortiz' && A.email === 'linda@example.com' && A.application.town === 'Nixa'
    && A.application.share.join('|') === 'Friends and family|Church or community group' && A.application.agreed.volunteer_unpaid_not_employment === true && !!A.application.agreed.at, A.application)
  ck('...NEVER a lead: nothing in Leads, no "same family?" item', leads().length === 0 && T.app_data.find((x) => x.key === 'ops_items').data.length === 0, leads())
  ck('...nothing sent to the applicant (no acknowledgment text or email); the page shows the confirmation', !SENT.some((m) => /linda/i.test(JSON.stringify(m)) && /received your request|Hi Linda/.test(m.message || m.html || '')), SENT)
  ck('...the two owners get one email each ("New Community Ambassador application: Linda Ortiz"); Krystal (a Care Coordinator) gets nothing', r.j.alerted === 2 && SENT.filter((m) => /New Community Ambassador application: Linda Ortiz/.test(m.subject || '')).length === 2
    && !SENT.some((m) => /krystal/i.test(JSON.stringify(m))), SENT.map((m) => [m.subject, m.contactId]))
  ck('...no money anywhere in the record or the email', !/\$|reward|commission|pay rate/i.test(JSON.stringify(A) + JSON.stringify(SENT)))
  ck('...no mailing address is asked for or kept', !/address|street|zip/i.test(Object.keys(A.application).join(',')))

  reset(); r = await post(APP({ works_in_healthcare: 'yes', healthcare_where: 'Social worker at Mercy', email: 'dana@x.com', phone: '', first_name: 'Dana', last_name: 'Smith' })); A = orgs().find((o) => o.program_track === 'ambassador')
  ck('works in healthcare: FLAGGED for the owners, not moved anywhere (still an ambassador application, status applied)', r.j.flagged === true && A.program_track === 'ambassador' && A.program_status === 'applied' && A.application.flags.join() === 'healthcare' && A.application.healthcare_where === 'Social worker at Mercy', A)
  ck('...the owners\' email says it needs a look and why', SENT.some((m) => /needs a look/.test(m.subject || '') && /works in healthcare or a regulated field \(Social worker at Mercy\)/.test(m.html || '')), SENT.map((m) => m.subject))
  reset(); r = await post(APP({ works_for_us: 'yes' }))
  ck('works for Caring Companions: flagged "employee"', orgs().find((o) => o.program_track === 'ambassador').application.flags.join() === 'employee')

  reset(); r = await post(APP({ email: 'linda@example.com' })); r = await post(APP({ email: 'LINDA@example.com', phone: '' }))
  ck('the same person applies twice: no second record, a friendly "received"', orgs().filter((o) => o.program_track === 'ambassador').length === 1 && r.j.already === true && r.s === 200)

  for (const [n, o, msg] of [['no last name', { last_name: '' }, 'first and last name'], ['no email or phone', { email: '', phone: '' }, 'email or a mobile'], ['a broken email', { email: 'linda@' }, "doesn't look right"],
      ['no town', { town: '' }, 'your town'], ['a box not checked', { agree: { adult: true, guidelines: true, volunteer: false, privacy: true } }, 'check each box']]) {
    reset(); r = await post(APP(o))
    ck(`${n}: refused with a clear reason, nothing saved, nobody emailed`, r.s === 400 && new RegExp(msg).test(r.j.error) && orgs().length === 1 && !SENT.length, r)
  }
  reset(); r = await post(APP({ website: 'spam' }))
  ck('the spam trap drops bots, application or not', orgs().length === 1 && !SENT.length)
  reset(); r = await post(APP({ mailing_address: '12 Main St', street: 'x' })); A = orgs().find((o) => o.program_track === 'ambassador')
  ck('a mailing address sent anyway is ignored', !JSON.stringify(A).includes('Main St'))
  reset(); r = await post(APP({ partner_code: 'JANE-K7' })); A = orgs().find((o) => o.program_track === 'ambassador')
  ck('came through someone\'s link: noted on the application, nothing linked or credited', A.application.came_through_code === 'JANE-K7' && !A.referral_org_id && leads().length === 0)
  reset(); r = await post({ name: 'Mary Jones', phone: '4175550333', message: 'Help for my dad' })
  ck('a family inquiry is unchanged: still a lead, no ambassador record', leads().length === 1 && leads()[0].source === 'Website' && orgs().length === 1)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
