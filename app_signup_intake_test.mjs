// mo-care.com/app sign-ups go into the Leads Intake Desk tagged 'wants the app' (her rule 2026-10-16). The REAL lead-intake
// against a fake database and a fake GoHighLevel. node app_signup_intake_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 1200)])
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_asi_'))
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
  /* a successful read of one contact, Do Not Disturb off: the opt-out door lets a send through (so the family's acknowledgment really can go) */
  if (/\/contacts\/[^/?]+$/.test(url) && (!o.method || o.method === 'GET')) return new Response(JSON.stringify({ contact: { id: decodeURIComponent(url.split('/').pop()), dnd: false } }), { status: 200 })
  return new Response(JSON.stringify({ contacts: [], contact: { id: 'c-any' } }), { status: 200 }) }
const ENV = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k', LEAD_INTAKE_TOKEN: 'tok', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', GHL_HOOK_CCLEADS: 'https://hook.example/ghl' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
try {
  const src = fs.readFileSync(path.join(F, 'lead-intake/index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace(/from '\.\.\/_shared\/([\w-]+)\.ts'/g, (_, m) => "from '" + path.join(process.cwd(), F, '_shared', m + '.ts') + "'")
  fs.writeFileSync(path.join(tmp, 'li.ts'), src); await import(path.join(tmp, 'li.ts'))
  const post = async (body) => { const r = await handler(new Request('http://x/lead-intake?token=tok', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })); return { s: r.status, j: await r.json() } }
  const leads = () => T.app_data.find((r) => r.key === 'leads').data
  const APP = (o) => Object.assign({ kind: 'app_interest', name: 'Lisa Ray', email: 'lisa@example.com', phone: '417-555-0123', zip: '65804',
    for_whom: 'My mother', message: 'Would love to book a few afternoons a month.', may_contact: true, source: '/app' }, o)
  reset(); let r = await post(APP())
  let L = leads()[0]
  ck('1 an /app sign-up becomes a care lead: name, phone, email, source Website, New, follow-up today', r.s === 200 && leads().length === 1 && L.first_name === 'Lisa' && L.last_name === 'Ray' && L.phone === '417-555-0123' && L.email === 'lisa@example.com' && L.source === 'Website' && L.status === 'New' && !!L.follow_up_due, L)
  ck('1b tagged "wants the app"', JSON.stringify(L.intent_tags) === '["wants the app"]', L.intent_tags)
  ck('1c the notes say where it came from, who it is for, the ZIP and their message', /Signed up on mo-care.com\/app/.test(L.interest_notes) && /Care for: My mother/.test(L.interest_notes) && /ZIP: 65804/.test(L.interest_notes) && /few afternoons/.test(L.interest_notes), L.interest_notes)
  ck('1d it gets the same handling as any care inquiry: the family acknowledgment and the GoHighLevel contact', SENT.some((m) => /reaching out about care|We received your request/.test(m.message || m.html || m.subject || '')) && GHLHOOK.length === 1 && /mo-care.com\/app/.test(GHLHOOK[0].message), { SENT, GHLHOOK })
  reset(); r = await post({ name: 'Ann Smith', phone: '417-555-0999', message: 'Need help for dad' })
  ck('2 an ordinary care form is unchanged: no tag', leads().length === 1 && !leads()[0].intent_tags && !/mo-care.com\/app/.test(leads()[0].interest_notes), leads()[0])
  reset(); r = await post(APP({ website: 'http://spam' }))
  ck('3 the honeypot still drops bots from /app', leads().length === 0)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
