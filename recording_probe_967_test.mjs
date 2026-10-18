// recording_probe_967_test.mjs · the READ-ONLY call-recording probe (Desktop 967; Samantha 2026-10-18 "verify that our
// GoHighLevel integration can actually retrieve and associate call recordings before building"): the REAL function
// against a fake GoHighLevel and a fake database. Made-up calls only; nothing leaves this machine. node recording_probe_967_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)])
const NOW = Date.parse('2026-10-18T20:00:00Z')
const RealDate = Date
class FakeDate extends RealDate { constructor(...a) { if (!a.length) super(NOW); else super(...a) } static now() { return NOW } }
globalThis.Date = FakeDate
const ago = (h) => new RealDate(NOW - h * 36e5).toISOString()
/* the fake GoHighLevel: two conversations with calls; one contact reached through the bridge */
const CONV = {
  c1: [{ id: 'm1', messageType: 'TYPE_CALL', direction: 'outbound', dateAdded: ago(2), userId: 'u-kr', meta: { call: { duration: 312, status: 'completed' } } },
       { id: 'm2', messageType: 'TYPE_CALL', direction: 'inbound', dateAdded: ago(5), meta: { call: { duration: 0, status: 'no-answer' } } },
       { id: 'sms1', messageType: 'TYPE_SMS', direction: 'outbound', dateAdded: ago(6), body: 'Private Text 417-555-0199' }],
  c2: [{ id: 'm3', messageType: 'TYPE_CALL', direction: 'inbound', dateAdded: ago(30), meta: { call: { duration: 95, status: 'completed' } } },
       { id: 'm4', messageType: 'TYPE_CALL', direction: 'outbound', dateAdded: ago(24 * 20), meta: { call: { duration: 60, status: 'completed' } } }],
  cb: [{ id: 'mb1', messageType: 'TYPE_CALL', direction: 'outbound', dateAdded: new RealDate(Date.parse(ago(48)) + 90e3).toISOString(), userId: 'u-kr', meta: { call: { duration: 240, status: 'completed' } } }] }
const AUDIO = new Set(['m1', 'mb1'])          /* m3 is answered but GoHighLevel has no recording for it */
const SEEN = { recording: [], nonGet: 0 }
globalThis.fetch = async (url, o = {}) => { const u = String(url)
  if ((o.method || 'GET') !== 'GET') SEEN.nonGet++
  if (u.includes('/conversations/search')) { const cid = new URL(u).searchParams.get('contactId')
    const list = cid === 'ct-bridge' ? [{ id: 'cb', fullName: 'Pat Private', phone: '+14175550100' }] : cid ? [] : [{ id: 'c1', fullName: 'Ann Private', phone: '+14175550111' }, { id: 'c2', fullName: 'Bo Private' }]
    return new Response(JSON.stringify({ conversations: list }), { status: 200 }) }
  const mm = u.match(/\/conversations\/(c1|c2|cb)\/messages/); if (mm) return new Response(JSON.stringify({ messages: { messages: CONV[mm[1]] } }), { status: 200 })
  const rm = u.match(/\/conversations\/messages\/([^/]+)\/locations\/[^/]+\/recording/)
  if (rm) { SEEN.recording.push(rm[1]); return AUDIO.has(rm[1]) ? new Response(new Uint8Array(4096).fill(7), { status: 200, headers: { 'content-type': 'audio/x-wav' } }) : new Response('{"message":"not found"}', { status: 404 }) }
  return new Response('{}', { status: 404 }) }
const T = { op_events: [{ verb: 'call_bridge', at: ago(48), item_id: 'ghl:ct-bridge', actor_email: 'kry@mo-care.com' }, { verb: 'call_bridge', at: ago(24 * 40), item_id: 'ghl:ct-old' },
  { verb: 'call_bridge', at: ago(10), item_id: 'ghl:ct-nocall' }, { verb: 'item_claimed', at: ago(1), item_id: 'x' }] }
const q = (t) => { const st = { f: [], gte: null }; const run = () => { let rows = (T[t] || []).filter((r) => st.f.every(([c, v]) => r[c] === v)); if (st.gte) rows = rows.filter((r) => r[st.gte[0]] >= st.gte[1]); rows = [...rows].sort((a, b) => String(b.at).localeCompare(String(a.at))); return { data: JSON.parse(JSON.stringify(rows)), error: null } }
  const b = { select() { return b }, eq(c, v) { st.f.push([c, v]); return b }, gte(c, v) { st.gte = [c, v]; return b }, order() { return b }, limit() { return b }, then(ok, no) { return Promise.resolve(run()).then(ok, no) } }; return b }
globalThis.__db = { from: q, rpc: async () => ({ data: null, error: null }) }
/* the real database lets only the server key read a server-only table; any other key gets an error (as live) */
const DENY = { from: () => { const b = { select() { return b }, limit() { return Promise.resolve({ data: null, error: { message: 'permission denied' } }) }, then(ok) { return Promise.resolve({ data: null, error: { message: 'permission denied' } }).then(ok) } }; return b } }
globalThis.__dbFor = (key) => key === SVC ? globalThis.__db : DENY
const SVC = 'svc_' + 'k'.repeat(60)
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SVC, GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_crp_'))
const shared = (s) => s.replace(/from '\.\.\/_shared\/([\w-]+)\.ts'/g, (_, m) => "from '" + path.join(tmp, m + '.ts') + "'").replace(/from '\.\/([\w-]+)\.ts'/g, (_, m) => "from '" + path.join(tmp, m + '.ts') + "'")
  .replace(/^import \{ createClient \} from .*$/m, 'const createClient = (u, key) => globalThis.__dbFor(key)')
try {
  for (const f of ['job-auth.ts', 'staff-auth.ts']) fs.writeFileSync(path.join(tmp, f), shared(fs.readFileSync(path.join(F, '_shared', f), 'utf8')))
  fs.writeFileSync(path.join(tmp, 'fn.ts'), shared(fs.readFileSync(path.join(F, 'call-recording-probe/index.ts'), 'utf8')))
  await import(path.join(tmp, 'fn.ts'))
  const ask = async (key) => { const r = await handler(new Request('https://x/fn', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: '{}' })); return { s: r.status, j: await r.json() } }
  let r = await ask('eyJpublicanonkey_' + 'a'.repeat(40))
  ck('refuses anyone but the owner key', r.s === 401, r)
  r = await ask(SVC); const j = r.j
  ck('answers the owner: 4 calls in 14 days, 3 answered, 1 missed', r.s === 200 && j.ok && j.calls === 3 && j.answered === 2 && j.missed === 1, j)
  ck('answered calls: GoHighLevel returned audio for 1 of 2 (the other said 404): never assumed from talk time', j.checked === 2 && j.with_recording === 1 && j.recording_answers['200'] === 1 && j.recording_answers['404'] === 1, j)
  ck('each row: day, in/out, seconds, status, recording yes/no, and whether the call names the user who placed it', j.rows[0].recording === 'yes' && j.rows[0].direction === 'out' && j.rows[0].names_user === true && j.rows[1].recording === 'no', j.rows)
  ck('the missed call: no recording, and the Hub can tell', j.missed_checked === 1 && j.missed_with_recording === 0 && j.missed_rows[0].answered_with === 404, j.missed_rows)
  ck('calls older than 14 days are left out', !SEEN.recording.includes('m4'))
  ck('bridge taps in the last 30 days: 2 (the 40-day-old one left out); the call after one was found 1.5 minutes later, with a recording', j.bridge_taps === 2 && j.bridge_found === 1 && j.bridge_with_recording === 1 && j.bridge_rows.some((b) => b.minutes_after_tap === 1.5 && b.recording === 'yes' && b.names_user === true), j.bridge_rows)
  ck('a tap with no call afterward says so', j.bridge_rows.some((b) => b.found === 'no'), j.bridge_rows)
  ck('it lists the fields GoHighLevel sends and the call statuses, as words only', j.message_fields.includes('userId') && j.call_fields.includes('duration') && j.call_statuses.completed === 2, j)
  const out = JSON.stringify(j)
  ck('the answer never contains names, phone numbers, contact ids, call ids or message text', !/Private|417|555|ct-|u-kr|\bm1\b|\bmb1\b|"c1"|kry@/.test(out), out.slice(0, 600))
  ck('every GoHighLevel request was a read (GET)', SEEN.nonGet === 0, SEEN)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '\n      ' + note))
const bad = res.filter((x) => !x[1]).length
console.log(`${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0)
