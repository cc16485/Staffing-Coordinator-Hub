// campaign-auto, 2026-10-07 audit: families, clients and leads are NEVER emailed by the schedule. A due family email puts one
// card on Samantha's My Work instead; caregivers (staff) still go out. The REAL function against fakes. node campaign_auto_hold_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 600)])
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }), mmdd = today.slice(5)
let STORE, SENT
const reset = (cfg) => { SENT = []; STORE = {
  campaign_settings: [{ id: 'settings', enabled: true, aud_monthly: true, aud_clients: true, aud_client_contacts: true, aud_caregivers: true, ...(cfg || {}) }],
  campaign_log: [], ops_items: [], leads: [{ id: 'L1', email: 'lead@example.com', first_name: 'Lee', status: 'Contacted' }, { id: 'L2', email: 'won@example.com', first_name: 'Wanda', status: 'Converted' }] } }
const db = { from: (t) => { const st = {}; const b = { select() { return b }, eq(k, v) { st[k] = v; return b },
    maybeSingle: async () => ({ data: t === 'app_data' ? { data: STORE[st.key] ?? [] } : null, error: null }),
    then: (ok) => Promise.resolve(t === 'caregivers' ? { data: [{ email: 'cg@example.com', first_name: 'Cara', last_name: 'Giver', active: true }], error: null } : { data: [], error: null }).then(ok) }; return b },
  rpc: async (fn, a) => { if (fn === 'upsert_app_data_item') { const L = STORE[a.target_key] = STORE[a.target_key] || []; const i = L.findIndex((x) => x.id === a.item.id); if (i >= 0) L[i] = a.item; else L.push(a.item) } return { data: null, error: null } } }
globalThis.__db = db
/* a library where three emails are due today: one for each family audience and one for caregivers */
const WIN = { '10': 'Early–Mid October' }
globalThis.fetch = async (u) => { u = String(u)
  if (u.includes('library.json')) return new Response(JSON.stringify(['monthly', 'clients', 'client_contacts', 'caregivers'].map((aud) => ({ key: 'k_' + aud, aud, subj: 'Hello ' + aud, when: '__TODAY__', head: 'h', ac: '#123456', banner: 'b' }))))
  return new Response('{}', { status: 200 }) }
const ENV = { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 't', GHL_LOCATION_ID: 'l' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_ca_'))
try {
  const stub = (name, body) => { const p = path.join(tmp, name + '.ts'); fs.writeFileSync(p, body); return p }
  let src = fs.readFileSync(path.join(F, 'campaign-auto/index.ts'), 'utf8')
    .replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace("'../_shared/outreach.ts'", "'" + stub('outreach', 'export const outreachGate = () => null') + "'")
    .replace("'../_shared/staff-auth.ts'", "'" + stub('staff-auth', 'export const requireStaff = async () => ({ ok: false, status: 401, error: "no" }); export const serverSecretOk = () => true; export const OFFICE_ROLES = []') + "'")
    .replace("'../_shared/optout.ts'", "'" + stub('optout', 'export const ghlContactIfAllowed = async (_s, _c, _w, o) => "cid-" + o.email') + "'")
    .replace("'../_shared/send-problems.ts'", "'" + stub('send', 'export const ghlSendChecked = async (_s, _h, who, o, m) => { globalThis.__sent.push({ who, to: o.address, subject: m.subject }); return true }') + "'")
    .replace("'../_shared/staff-contact.ts'", "'" + stub('staffc', 'export const ghlStaffContact = async () => "sam"') + "'")
  /* make today's date the window for '__TODAY__' */
  src = src.replace("const WINDOWS: Record<string, [string, string]> = {", "const WINDOWS: Record<string, [string, string]> = { '__TODAY__': ['" + mmdd + "', '" + mmdd + "'],")
  fs.writeFileSync(path.join(tmp, 'ca.ts'), src); globalThis.__sent = []
  await import(path.join(tmp, 'ca.ts'))
  const run = async () => { globalThis.__sent = []; const r = await handler(new Request('https://x/f', { method: 'POST', headers: { 'x-cron-secret': 's' } })); return { s: r.status, j: await r.json(), sent: globalThis.__sent } }
  reset(); let r = await run()
  const fam = r.sent.filter((x) => x.who === 'campaign-auto' && x.to !== 'cg@example.com')
  ck('the schedule emails no lead, client or family contact (not one)', fam.length === 0, r.sent)
  ck('...caregivers (staff) still get theirs', r.sent.some((x) => x.who === 'campaign-auto' && x.to === 'cg@example.com'), r.sent)
  const cards = STORE.ops_items.filter((x) => String(x.id).startsWith('ops_camp_'))
  ck('...each due family email is one card on Samantha\'s My Work: "ready for you to send", linking to Campaigns', cards.length === 3 && cards.every((c) => c.owner === 'samantha@mo-care.com' && c.status === 'open' && /^Campaign ready for you to send/.test(c.title) && c.link === '#campaigns'), cards)
  ck('...her summary email says they are waiting for her', r.sent.some((x) => x.who === 'staff-alert' && /Campaign autopilot/.test(x.subject)) && r.j.held === 3, r.j)
  ck('...nothing is logged as sent to families (so she can still send them herself this year)', !STORE.campaign_log.some((x) => /monthly|clients|client_contacts/.test(x.source)), STORE.campaign_log)
  r = await run()
  ck('the next day: no second card for the same email', STORE.ops_items.filter((x) => String(x.id).startsWith('ops_camp_')).length === 3 && r.sent.filter((x) => x.who === 'campaign-auto' && x.to !== 'cg@example.com').length === 0)
  reset({ aud_caregivers: false }); r = await run()
  ck('only family emails due: still nothing sent to anyone, three cards', r.sent.filter((x) => x.who === 'campaign-auto').length === 0 && STORE.ops_items.length === 3 && r.j.held === 3, [r.j, r.sent])
  reset({ enabled: false }); r = await run()
  ck('autopilot off: nothing at all', r.j.skipped === 'autopilot is off' && !STORE.ops_items.length && !r.sent.length)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
