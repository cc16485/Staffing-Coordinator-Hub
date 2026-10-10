// 562 · live fixes: score-interview is office-staff only; orientation-booked relays only a real recent booking, once, and
// never while the Hub's own reminder switch is on. Fake database, fake GoHighLevel, fake Anthropic. node live_fix_562_test.mjs
import fs from 'fs'; import path from 'path'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 600)])
const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'svc', ANTHROPIC_API_KEY: 'k', GHL_HOOK_ORIENTATION: 'https://ghl.example/hook' }
let handler = null; globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h } }
const hits = []; const realFetch = globalThis.fetch
globalThis.fetch = async (url, o) => { hits.push({ url: String(url), body: o && o.body ? JSON.parse(o.body) : null }); return new Response('ok', { status: 200 }) }

/* a tiny table store with the query shapes these two functions use */
let DB = {}
const table = (name) => {
  const rows = () => DB[name] || []
  const q = (filters = []) => {
    const api = {
      eq: (k, v) => q([...filters, (r) => String(r[k]) === String(v)]),
      gte: (k, v) => q([...filters, (r) => String(r[k]) >= String(v)]),
      maybeSingle: async () => ({ data: rows().filter((r) => filters.every((f) => f(r)))[0] ?? null, error: null }),
      then: (ok) => ok({ data: rows().filter((r) => filters.every((f) => f(r))), error: null }),
    }
    return api
  }
  return {
    select: () => q(),
    update: (patch) => ({ eq: async (k, v) => { rows().forEach((r) => { if (String(r[k]) === String(v)) Object.assign(r, patch) }); return { error: null } } }),
  }
}
globalThis.__fakeCreateClient = () => ({ from: table, auth: { getUser: async (jwt) => jwt === 'good' ? { data: { user: { id: 'u1', email: 'k@mo-care.com', app_metadata: {} } }, error: null } : { data: null, error: { message: 'bad' } } } })
const load = async (fn, tag) => {
  const src = fs.readFileSync(path.join(FN, fn, 'index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__fakeCreateClient')
  const tmp = path.join(FN, fn, `_t${tag}.ts`); fs.writeFileSync(tmp, src)
  try { handler = null; await import(tmp); } finally { fs.unlinkSync(tmp) }
  return handler
}
const call = async (h, body, headers = {}) => { const r = await h(new Request('http://x/f', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })); let j = null; try { j = await r.json() } catch {} return { status: r.status, j } }

/* ═══ score-interview ═══ */
const score = await load('score-interview', '562a')
let r = await call(score, { recording_id: 'rec-1' })
ck('score-interview: no sign-in is refused before anything is read (401)', r.status === 401 && hits.length === 0, r)
r = await call(score, { recording_id: 'rec-1' }, { Authorization: 'Bearer nope' })
ck('score-interview: a bad token is refused (401)', r.status === 401, r)
DB = { auth_identities: [] }
r = await call(score, { recording_id: 'rec-1' }, { Authorization: 'Bearer good' })
ck('score-interview: a signed-in user with no staff record is refused (403), the recording is never read', r.status === 403, r)

/* ═══ orientation-booked ═══ */
const ob = await load('orientation-booked', '562b')
const now = Date.now(), iso = (ms) => new Date(now + ms).toISOString()
const booking = () => ({ id: 'b1', session_id: 's9', first: 'Ava', last: 'Lee', phone: '(417) 555-0101', booked_at: iso(-60000), ghl_relayed_at: null })
const body = { session_id: 's9', first_name: 'Ava', phone: '417-555-0101', orientation_date: '2026-10-20', orientation_at: '2026-10-20T10:00:00', orientation_when: 'Tue', orientation_where: 'Office', office: 'springfield' }
DB = { app_data: [{ key: 'ops_settings', data: { orient_remind_live: true } }], orient_bookings: [booking()] }
hits.length = 0; r = await call(ob, body)
ck('while the Hub reminder switch is on nothing is relayed, the page still gets ok', r.status === 200 && r.j.relayed === false && hits.length === 0, r)
DB = { app_data: [{ key: 'ops_settings', data: { orient_remind_live: false } }], orient_bookings: [] }
r = await call(ob, body)
ck('switch off, no booking row: refused (404), nothing relayed', r.status === 404 && hits.length === 0, r)
r = await call(ob, { ...body, session_id: '' })
ck('no session id: refused (400)', r.status === 400 && hits.length === 0, r)
DB = { app_data: [{ key: 'ops_settings', data: {} }], orient_bookings: [{ ...booking(), booked_at: iso(-40 * 60000) }] }
r = await call(ob, body)
ck('a booking older than 15 minutes does not count', r.status === 404 && hits.length === 0, r)
DB = { app_data: [{ key: 'ops_settings', data: {} }], orient_bookings: [booking()] }
r = await call(ob, { ...body, first_name: 'Mallory', last_name: 'Evil' })
ck('a real recent booking is relayed once to the GHL hook, with the names from the booking row, not the caller', r.status === 200 && r.j.relayed === true && hits.length === 1 && hits[0].url === env.GHL_HOOK_ORIENTATION && hits[0].body.first_name === 'Ava' && hits[0].body.last_name === 'Lee' && hits[0].body.reminder_date === '2026-10-19', { r, hits })
ck('...and the booking is stamped relayed', !!DB.orient_bookings[0].ghl_relayed_at)
r = await call(ob, body)
ck('a second call for the same booking relays nothing', r.status === 200 && r.j.relayed === false && hits.length === 1, r)
r = await call(ob, { ...body, phone: '417-555-9999' })
ck('a different phone than the booking row: refused (404)', r.status === 404 && hits.length === 1, r)

globalThis.fetch = realFetch
for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + note))
const bad = res.filter((x) => !x[1]).length; console.log(`${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0)
