// Community Ambassador applications CLOSED (her decision 5, 2026-10-26): the REAL lead-intake against a fake database and
// a fake GoHighLevel. A late application is refused with words the old page shows; nothing is saved or sent.
// node ambassador_closed_test.mjs
// node ambassador_app_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 1000)])
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_ambc_'))
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

  reset(); let r = await post(APP())
  ck('a complete application: refused (400) with words the old page shows: closed, and our phone number', r.s === 400 && /program has closed/.test(r.j.error) && /\(417\) 234-8494/.test(r.j.error) && r.j.closed === true, r)
  ck('...nothing saved: the Referral Partner Desk is unchanged (no ambassador record)', orgs().length === 1 && orgs()[0].id === 'org-mercy', orgs())
  ck('...NEVER a lead: nothing in Leads, no "same family?" item', leads().length === 0 && T.app_data.find((x) => x.key === 'ops_items').data.length === 0, leads())
  ck('...nobody is emailed or texted (no owner alert, nothing to the applicant)', SENT.length === 0, SENT)
  reset(); r = await post(APP({ works_in_healthcare: 'yes', partner_code: 'JANE-K7' }))
  ck('a late application through someone\'s link: refused the same way, nothing linked', r.s === 400 && orgs().length === 1 && leads().length === 0 && !SENT.length)
  reset(); T.app_data.find((x) => x.key === 'referral_orgs').data.push({ id: 'amb-linda', name: 'Linda Ortiz', type: 'Community Ambassador', program_track: 'ambassador', program_status: 'applied' })
  r = await post(APP())
  ck('an application already on file stays exactly as it was', orgs().length === 2 && orgs()[1].program_status === 'applied', orgs())
  reset(); r = await post({ name: 'Mary Jones', phone: '4175550333', message: 'Help for my dad' })
  ck('a family inquiry is unchanged: still a lead', r.s === 200 && leads().length === 1 && leads()[0].source === 'Website' && orgs().length === 1, r)
  reset(); r = await post({ name: 'Gary Miller', phone: '4175550142', message: 'Help for my mom', partner_code: 'JANE-K7' })
  ck('...and a referral code on a family form is still read (here an unknown code, kept for an owner to check)', leads().length === 1 && (leads()[0].partner_link_seen || {}).code === 'JANE-K7', leads()[0])
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
