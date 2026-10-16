// 808 · the one-time proof text (ok-from-probe) against a fake database and GoHighLevel. node ok_from_probe_808_test.mjs
import fs from 'fs'; import path from 'path'
const FN = 'supabase/functions'; const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 500)])
let OPS = {}, SENT = [], CARDS = []
const q = () => { const b = { select: () => b, eq: () => b, maybeSingle: async () => ({ data: { data: OPS }, error: null }) }; return b }
globalThis.__db = { from: q, rpc: async (fn, a) => { if (fn === 'upsert_app_data_item') CARDS.push(a.item); return { data: null, error: null } } }
globalThis.fetch = async (url, o) => { url = String(url); const body = o?.body ? JSON.parse(o.body) : {}
  if (url.includes('/contacts/search/duplicate')) return new Response('{}', { status: 200 })
  if (url.includes('/contacts/upsert')) return new Response(JSON.stringify({ contact: { id: 'C:' + (body.phone || body.email) } }), { status: 200 })
  if (url.includes('/conversations/messages')) { SENT.push(body); return new Response('{}', { status: 200 }) }
  return new Response('{}', { status: 200 }) }
let handler; globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc' })[k] }, serve: (h) => { handler = h } }
const src = fs.readFileSync(`${FN}/ok-from-probe/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
const tmp = path.join(process.cwd(), FN, 'ok-from-probe', '_t.ts'); fs.writeFileSync(tmp, src); try { await import(tmp) } finally { fs.unlinkSync(tmp) }
const jwt = (role) => 'x.' + Buffer.from(JSON.stringify({ role })).toString('base64url') + '.y'
const call = async (body, role = 'service_role') => { const r = await handler(new Request('https://x/f', { method: 'POST', headers: { Authorization: 'Bearer ' + jwt(role) }, body: JSON.stringify(body) })); return [r.status, await r.json()] }
let [s, j] = await call({ to: '4175550111' }, 'anon'); ck('the public key is refused, nothing sent', s === 403 && !SENT.length, j)
;[s, j] = await call({ to: '4175550111' }, 'authenticated'); ck('a Hub login is refused too', s === 403 && !SENT.length, j)
OPS = {}; ;[s, j] = await call({ to: '4175550111' }); ck('no Oklahoma number set: refused, nothing sent', s === 409 && !SENT.length, j)
OPS = { ok_from_number: '+14055001758' }; ;[s, j] = await call({ to: 'nope' }); ck('no usable cell number: refused', s === 400 && !SENT.length, j)
;[s, j] = await call({ to: '(417) 555-0111' })
ck('one text, FROM the Oklahoma number, to the number typed', s === 200 && j.sent && SENT.length === 1 && SENT[0].fromNumber === '+14055001758' && SENT[0].contactId === 'C:+14175550111' && /\(405\) 500-1758/.test(SENT[0].message), [j, SENT])
ck('no em dash', !SENT[0].message.includes('—'))
let fails = 0; for (const [n, ok, note] of res) { console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + note)); if (!ok) fails++ }
console.log(`\n${res.length - fails}/${res.length} passed`); process.exit(fails ? 1 : 0)
