// care-packet-watch (caregiver packets, Step 3, 2026-10-12). The REAL function and the REAL job check, against a fake
// database and a fake AxisCare. Nothing here may text or email: GoHighLevel and Resend are not even faked, so any try fails
// the run. node care_packet_watch_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)])
const CRON = 'c'.repeat(48), SVC = 'svc-key-0123456789abcdefghij'
let T, VISITS, AX_FAIL, CALLS
const soon = (h) => new Date(Date.now() + h * 3600000).toISOString()
const P1 = '11111111-1111-1111-1111-111111111111', P2 = '22222222-2222-2222-2222-222222222222'
const reset = () => { AX_FAIL = new Set(); CALLS = []; VISITS = {
    '900': [{ client: { id: '900' }, caregiver: { id: '11', firstName: 'Ariel', lastName: 'Smith' }, scheduledStartDate: soon(5) },
            { client: { id: '900' }, caregiver: { id: '12', firstName: 'Bea', lastName: 'Jones' }, scheduledStartDate: soon(30) },
            { client: { id: '900' }, caregiver: { id: '15', firstName: 'Far', lastName: 'Away' }, scheduledStartDate: soon(100) }],
    '901': [{ client: { id: '901' }, caregiver: { id: '12', firstName: 'Bea', lastName: 'Jones' }, scheduledStartDate: soon(20) }] }
  T = { app_data: [{ key: 'ops_settings', data: { care_packet_watch_live: true } }, { key: 'ops_items', data: [] }, { key: 'automation_heartbeats', data: [] }],
    care_packets: [{ id: P1, client_first: 'Dan', axiscare_client_id: '900', version: 2, ready: true }, { id: P2, client_first: 'Lee', axiscare_client_id: '901', version: 1, ready: true },
      { id: '33333333-3333-3333-3333-333333333333', client_first: 'Draft', axiscare_client_id: '902', version: 1, ready: false },
      { id: '44444444-4444-4444-4444-444444444444', client_first: 'LeadOnly', axiscare_client_id: null, version: 1, ready: true }],
    care_packet_recipients: [{ packet_id: P1, caregiver_axiscare_id: '11', ack_version: 1, last_sent_at: '2026-10-10T15:00:00Z' }, { packet_id: P2, caregiver_axiscare_id: '12', ack_version: 1 }],
    domains: [{ code: 'client_care', entity: 'cc_ihs', owner_person: 'p-kr' }], persons: [{ person_id: 'p-kr', primary_email: 'Krystal@mo-care.com' }], op_events: [] } }
const clone = (x) => JSON.parse(JSON.stringify(x))
const q = (t) => { const st = { f: [], op: 'select', row: null }; const run = () => { const rows = T[t] ?? (T[t] = []); const m = (r) => st.f.every(([c, v]) => r[c] === v)
    if (st.op === 'insert') { rows.push(...(Array.isArray(st.row) ? st.row : [st.row])); return { data: null, error: null } }
    return { data: clone(rows.filter(m)), error: null } }
  const b = { select() { return b }, eq(c, v) { st.f.push([c, v]); return b }, limit() { return b }, insert(r) { st.op = 'insert'; st.row = r; return b },
    maybeSingle() { const r = run(); return Promise.resolve({ data: r.data ? r.data[0] ?? null : null, error: null }) }, then(ok, no) { return Promise.resolve(run()).then(ok, no) } }; return b }
globalThis.__db = { from: q, rpc: async (fn, a) => { if (fn === 'upsert_app_data_item') { const row = T.app_data.find((r) => r.key === a.target_key); const i = row.data.findIndex((x) => x.id === a.item.id); if (i >= 0) row.data[i] = clone(a.item); else row.data.push(clone(a.item)) } return { data: null, error: null } },
  auth: { getUser: async () => ({ data: { user: null }, error: { message: 'no' } }) } }
globalThis.fetch = async (url) => { url = String(url); CALLS.push(url)
  const m = url.match(/axiscare\.com\/api\/visits\?clientIds=(\d+)/); if (!m) throw new Error('nothing but AxisCare may be called: ' + url)
  if (AX_FAIL.has(m[1])) return new Response('{}', { status: 500 })
  return new Response(JSON.stringify({ results: { visits: VISITS[m[1]] ?? [], nextPage: null } }), { status: 200 }) }
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SVC, HUB_JOB_SECRET: CRON, AXISCARE_TOKEN: 'ax', AXISCARE_SITE: '16485' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_cpw_'))
try {
  const fix = (src) => src.replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace(/from '\.\.\/_shared\/(\w[\w-]*)\.ts'/g, (_, m) => "from '" + path.join(tmp, '_' + m + '.ts') + "'").replace(/from '\.\/(\w[\w-]*)\.ts'/g, (_, m) => "from '" + path.join(tmp, '_' + m + '.ts') + "'")
    .replace(/import '\.\.\/_shared\/verbs\.js'/, "import '" + path.join(process.cwd(), F, '_shared/verbs.js') + "'").replace(/import '\.\/verbs\.js'/, "import '" + path.join(process.cwd(), F, '_shared/verbs.js') + "'")
  for (const f of ['job-auth', 'staff-auth', 'events', 'packet-visits']) fs.writeFileSync(path.join(tmp, '_' + f + '.ts'), fix(fs.readFileSync(path.join(F, '_shared', f + '.ts'), 'utf8')))
  fs.writeFileSync(path.join(tmp, 'w.ts'), fix(fs.readFileSync(path.join(F, 'care-packet-watch/index.ts'), 'utf8')))
  const M = await import(path.join(tmp, 'w.ts'))
  const run = async (headers = { 'x-cron-secret': CRON }, body = {}) => { const r = await handler(new Request('https://x/functions/v1/care-packet-watch', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }))
    let j = null; try { j = await r.json() } catch { /* */ } return { status: r.status, j } }
  const items = () => T.app_data.find((x) => x.key === 'ops_items').data
  const card = (pid) => items().find((x) => x.id === M.cardId(pid))

  reset(); let r = await run({}); ck('no schedule secret: refused (401), AxisCare not asked', r.status === 401 && !CALLS.length, r)
  reset(); r = await run({ 'x-cron-secret': 'wrong'.repeat(10) }); ck('a wrong secret: refused', r.status === 401, r)
  reset(); r = await run()
  const c1 = card(P1)
  ck('reads only READY packets that are in AxisCare (2 of 4), one AxisCare read each', r.j.packets === 2 && r.j.read === 2 && CALLS.length === 2, r.j)
  ck('Dan: ONE card listing Ariel (confirmed an older version) and Bea (nothing sent); Far Away (4 days out) not on it',
    c1 && c1.status === 'open' && /Ariel Smith, next visit .*: confirmed an older version/.test(c1.detail) && /Bea Jones, next visit .*: no packet sent yet/.test(c1.detail) && !/Far Away/.test(c1.detail) && c1.missing_ids.join() === '11,12', c1)
  ck('the card: urgent (a visit within 24 hours), for the Client Care owner, opens their Care tab, says what to do next',
    c1.urgency === 'urgent' && c1.owner === 'krystal@mo-care.com' && c1.client_ax === '900' && c1.link === '#p/A900/care' && /press Text the packet or Remind/.test(c1.detail) && c1.kind === 'care_packet_unconfirmed', c1)
  ck('Lee: Bea confirmed the current version, so no card', !card(P2), items())
  ck('the run is on the record and the heartbeat says what it saw', T.op_events.some((e) => e.verb === 'care_packet_watch_run' && /coming up 3, not confirmed 2, cards opened 1/.test(e.summary)) && T.app_data.find((x) => x.key === 'automation_heartbeats').data[0]?.ok === true, T.op_events)
  ck('no em dash on the card', !/[—―]/.test(c1.title + c1.detail))
  r = await run(); ck('a second run updates the same card (no duplicate)', items().filter((x) => x.kind === 'care_packet_unconfirmed').length === 1 && r.j.updated === 1 && r.j.opened === 0, r.j)
  card(P1).claimed_by = 'krystal@mo-care.com'; T.care_packet_recipients.push({ packet_id: P1, caregiver_axiscare_id: '12', ack_version: 2 })
  r = await run(); ck('Bea confirms: the card drops her and keeps who claimed it', card(P1).missing_ids.join() === '11' && card(P1).claimed_by === 'krystal@mo-care.com' && !/Bea/.test(card(P1).detail), card(P1))
  T.care_packet_recipients[0].ack_version = 2
  r = await run(); ck('everyone coming up confirmed: the card closes itself, saying why', card(P1).status === 'done' && card(P1).closed_by === 'care-packet-watch' && r.j.closed === 1, card(P1))
  r = await run(); ck('nothing to do: nothing changes', r.j.opened === 0 && r.j.closed === 0 && card(P1).status === 'done', r.j)

  // a person closes it; it stays closed for the same people, and comes back for someone new
  reset(); await run(); card(P1).status = 'done'; card(P1).closed_by = 'krystal@mo-care.com'
  r = await run(); ck('a person closed it: the same people keep it closed', card(P1).status === 'done' && card(P1).closed_by === 'krystal@mo-care.com' && r.j.left_closed === 1, r.j)
  VISITS['900'].push({ client: { id: '900' }, caregiver: { id: '16', firstName: 'New', lastName: 'Person' }, scheduledStartDate: soon(40) })
  r = await run(); ck('someone NEW on the schedule: the card comes back, listing them', card(P1).status === 'open' && /New Person/.test(card(P1).detail) && !card(P1).closed_by, card(P1))

  // AxisCare failing never closes or changes a card
  reset(); await run(); const before = JSON.stringify(card(P1)); T.care_packet_recipients[0].ack_version = 2; T.care_packet_recipients.push({ packet_id: P1, caregiver_axiscare_id: '12', ack_version: 2 }); AX_FAIL.add('900')
  r = await run(); ck('AxisCare not answering for Dan: his card is left exactly as it was, and the heartbeat says AxisCare failed', JSON.stringify(card(P1)) === before && r.j.unreadable === 1 && T.app_data.find((x) => x.key === 'automation_heartbeats').data[0].ok === false, r.j)

  // switch off and dry run
  reset(); T.app_data[0].data.care_packet_watch_live = false
  r = await run(); ck('switch off: raises nothing, but records what it WOULD raise', !items().length && r.j.would.length === 1 && r.j.would[0].client === 'Dan' && T.op_events.some((e) => e.verb === 'care_packet_watch_run' && /switch off/.test(e.summary)), r.j)
  reset(); r = await run({ Authorization: 'Bearer ' + SVC }, { dry: true })
  ck('a dry run from the owner key: reports, writes nothing at all (no card, no record, no heartbeat)', r.status === 200 && r.j.dry && r.j.would.length === 1 && !items().length && !T.op_events.length && !T.app_data.find((x) => x.key === 'automation_heartbeats').data.length, r.j)
  reset(); r = await run({ 'x-cron-secret': CRON }, { dry: true }); ck('dry is only for the owner key: the schedule\'s run is a real run', r.j.dry === false && card(P1), r.j)
  ck('decide(): open, update, close, leave closed, back for someone new', M.decide(null, { missing_ids: ['1'] }) === 'open' && M.decide({ status: 'open' }, { missing_ids: ['1'] }) === 'update' && M.decide({ status: 'open' }, null) === 'close' &&
    M.decide({ status: 'done', missing_ids: ['1'] }, { missing_ids: ['1'] }) === 'leave_closed' && M.decide({ status: 'done', missing_ids: ['1'] }, { missing_ids: ['1', '2'] }) === 'open' && M.decide({ status: 'done' }, null) === 'none')
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
const bad = res.filter((x) => !x[1])
for (const [n, okk, note] of res) console.log((okk ? 'PASS ' : 'FAIL ') + n + (note ? '\n     ' + note : ''))
console.log(`\n${res.length - bad.length}/${res.length} passed`); process.exit(bad.length ? 1 : 0)
