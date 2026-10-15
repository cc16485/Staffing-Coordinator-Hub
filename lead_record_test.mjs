// lead-record (769): the REAL function, the REAL rules file and the REAL lead-truth contract, against a fake database and
// a fake GoHighLevel. Calls and texts with a lead are written on the lead the way Log a call writes them. node lead_record_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)])
const clone = (x) => JSON.parse(JSON.stringify(x))
const NOW = Date.now(), ago = (min) => new Date(NOW - min * 60e3).toISOString()
let T, G, SENT, BUMP
const lead = (id, phone, o = {}) => ({ id, first_name: 'Fam' + id, last_name: 'Ily', phone, status: 'New', created_at: ago(600), ...o })
const reset = (live = false) => {
  T = { app_data: [{ key: 'ops_settings', data: { lead_record_live: live, lead_record_since: ago(7 * 24 * 60) } },
    { key: 'leads', data: [lead('L1', '(417) 555-0101'), lead('L2', '4175550102', { status: 'Contacted', contact_events: [{ at: ago(20), channel: 'sms', direction: 'out', outcome: 'sent', actor: 'human', by: 'krystal@mo-care.com', ref: 'Here is the link' }] }),
      lead('L3', '4175550103'), lead('L4', '4175550199', { client_phone: '417-555-0103' }), lead('L5', '4175550105', { archived: true }),
      lead('L7', '4175550170', { client_phone: '4175550107' }), lead('L6', '4175550106', { contact_events: [{ at: ago(100), channel: 'call', direction: 'out', outcome: 'connected', actor: 'human', by: 'sam@mo-care.com' }], first_human_contact_at: ago(100), first_human_attempt_at: ago(100), status: 'Contacted' })] },
    { key: 'ghl_users', data: [] }, { key: 'automation_heartbeats', data: [] }],
    lead_record_seen: [], lead_record_state: [], call_task_reading: [], op_events: [] }
  const M = (id, type, min, dir, o = {}) => ({ id, messageType: type, dateAdded: ago(min), direction: dir, ...o })
  G = { users: [{ id: 'u-kr', email: 'Krystal@mo-care.com', firstName: 'Krystal' }, { id: 'u-sam', email: 'sam@mo-care.com', firstName: 'Samantha' }],
    convos: [{ id: 'c1', phone: '+14175550101', contactId: 'k1', fullName: 'Carol  Price', lastMessageDate: NOW - 5 * 60e3 }, { id: 'c7', phone: '+14175550107', contactId: 'k7', fullName: 'Ruth Price', lastMessageDate: NOW - 6 * 60e3 }, { id: 'c2', phone: '+14175550102', contactId: 'k2', lastMessageDate: NOW - 19 * 60e3 },
      { id: 'c3', phone: '+14175550103', contactId: 'k3', lastMessageDate: NOW - 30 * 60e3 }, { id: 'c5', phone: '+14175550105', contactId: 'k5', lastMessageDate: NOW - 30 * 60e3 },
      { id: 'c6', phone: '+14175550106', contactId: 'k6', lastMessageDate: NOW - 95 * 60e3 }, { id: 'c9', phone: '+14175550999', contactId: 'k9', lastMessageDate: NOW - 30 * 60e3 }],
    msgs: {
      c1: [M('m1', 'TYPE_CALL', 60, 'outbound', { userId: 'u-kr', meta: { call: { duration: 0, status: 'no-answer' } } }),
        M('m2', 'TYPE_SMS', 50, 'inbound', { body: 'Can you call me after 2?' }),
        M('m3', 'TYPE_CALL', 40, 'outbound', { userId: 'u-kr', meta: { call: { duration: 660, status: 'completed' } } }),
        M('m4', 'TYPE_SMS', 30, 'outbound', { userId: 'u-kr', source: 'app', body: 'Here is the link to pick a time.' }),
        M('m5', 'TYPE_SMS', 29, 'outbound', { source: 'workflow', body: 'Reminder: your visit is Thursday' }),
        M('m6', 'TYPE_CALL', 10, 'outbound', { userId: 'u-sam', meta: { call: { duration: 30, status: 'completed' } } }),
        M('m7', 'TYPE_CALL', 5, 'inbound', { meta: { call: { duration: 0, status: 'no-answer' } } }),
        M('mOld', 'TYPE_SMS', 8 * 24 * 60, 'inbound', { body: 'too old' }),
        M('mEm', 'TYPE_EMAIL', 7, 'outbound', { body: 'email' })],
      c7: [M('m13', 'TYPE_SMS', 6, 'inbound', { body: 'This is Ruth' })],
      c2: [M('m8', 'TYPE_SMS', 19.5, 'outbound', { source: 'api', body: 'Here is the link' })],
      c3: [M('m9', 'TYPE_CALL', 30, 'inbound', { userId: 'u-kr', meta: { call: { duration: 120, status: 'completed' } } })],
      c5: [M('m10', 'TYPE_SMS', 30, 'inbound', { body: 'archived lead' })],
      c6: [M('m11', 'TYPE_CALL', 95, 'outbound', { userId: 'u-sam', meta: { call: { duration: 400, status: 'completed' } } })],
      c9: [M('m12', 'TYPE_SMS', 30, 'inbound', { body: 'nobody we know' })] } }
  SENT = []; BUMP = null
}
const leadOf = (id) => T.app_data.find((r) => r.key === 'leads').data.find((l) => l.id === id)
function q(t) {
  const st = { f: [], op: 'select', row: null, single: false }
  const match = (r) => st.f.every(([k, v, how]) => how === 'gte' ? String(r[k]) >= String(v) : how === 'in' ? v.includes(r[k]) : String(r[k]) === String(v))
  const run = () => {
    T[t] = T[t] || []
    if (st.op === 'upsert') {
      for (const r of (Array.isArray(st.row) ? st.row : [st.row])) {
        const key = t === 'lead_record_seen' ? (x) => x.message_id === r.message_id && x.mode === r.mode : (x) => x.mode === r.mode
        const i = T[t].findIndex(key); if (i >= 0) T[t][i] = { ...T[t][i], ...clone(r) }; else T[t].push(clone(r))
      }
      return { data: null, error: null }
    }
    if (st.op === 'insert') { T[t].push(...clone(Array.isArray(st.row) ? st.row : [st.row])); return { data: null, error: null } }
    let rows = T[t].filter(match)
    if (st.order) rows = rows.slice().sort((a, b) => (st.order.asc ? 1 : -1) * String(a[st.order.k]).localeCompare(String(b[st.order.k])))
    return { data: st.single ? (rows[0] ? clone(rows[0]) : null) : clone(rows), error: null }
  }
  const b = { select() { return b }, eq(k, v) { st.f.push([k, v]); return b }, gte(k, v) { st.f.push([k, v, 'gte']); return b }, in(k, v) { st.f.push([k, v, 'in']); return b },
    order(k, o) { st.order = { k, asc: o?.ascending !== false }; return b }, limit() { return b },
    upsert(row) { st.op = 'upsert'; st.row = row; return b }, insert(row) { st.op = 'insert'; st.row = row; return b },
    maybeSingle() { st.single = true; return Promise.resolve(run()) }, then(ok, ko) { return Promise.resolve(run()).then(ok, ko) } }
  return b
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
globalThis.__db = { from: q, rpc: async (fn, a) => {
  if (fn === 'upsert_app_data_item') { const row = T.app_data.find((r) => r.key === a.target_key); const i = row.data.findIndex((x) => x.id === a.item.id); if (i >= 0) row.data[i] = clone(a.item); else row.data.push(clone(a.item)); return { data: null, error: null } }
  if (fn === 'lead_put_if_same') {
    const list = T.app_data.find((r) => r.key === 'leads').data, i = list.findIndex((l) => l.id === a.p_id)
    if (BUMP && BUMP.id === a.p_id && !BUMP.done) { BUMP.done = true; list[i] = { ...list[i], notes: 'typed in the Hub meanwhile' } }   // someone saves in the Hub just before
    if (i < 0 || !same(list[i], a.p_before)) return { data: false, error: null }
    list[i] = clone(a.p_after); return { data: true, error: null }
  }
  return { data: null, error: { message: 'unknown rpc ' + fn } } } }
globalThis.fetch = async (url, o = {}) => { url = String(url); SENT.push([o.method || 'GET', url])
  const ok = (b) => new Response(JSON.stringify(b), { status: 200 })
  if (url.includes('/users/')) return ok({ users: G.users })
  if (url.includes('/conversations/search')) { const u = new URL(url); const after = u.searchParams.get('startAfterDate')
    return ok({ conversations: after ? [] : clone(G.convos).sort((a, b) => b.lastMessageDate - a.lastMessageDate) }) }
  let m = /\/conversations\/messages\/([\w-]+)/.exec(url)
  if (m) { for (const list of Object.values(G.msgs)) { const x = list.find((y) => y.id === m[1]); if (x) return ok({ message: x }) } return new Response('{}', { status: 404 }) }
  m = /\/conversations\/(\w+)\/messages/.exec(url)
  if (m) return ok({ messages: { messages: clone(G.msgs[m[1]] || []).reverse(), nextPage: false } })
  return new Response('{}', { status: 404 }) }
const ENV = { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k'.repeat(40), GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', HUB_JOB_SECRET: 'j'.repeat(40) }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_lr_'))
try {
  fs.writeFileSync(path.join(tmp, 'job-auth.ts'), fs.readFileSync(path.join(F, '_shared/job-auth.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => ({ from: () => ({ select: () => ({ limit: async () => ({ error: { message: "no" } }) }) }) })')
    .replace("'./staff-auth.ts'", "'" + path.join(process.cwd(), F, '_shared', 'staff-auth.ts') + "'"))
  const src = fs.readFileSync(path.join(F, 'lead-record/index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace("'../_shared/job-auth.ts'", "'" + path.join(tmp, 'job-auth.ts') + "'")
    .replace(/from '\.\.\/_shared\/([\w-]+)\.ts'/g, (_, m) => "from '" + path.join(process.cwd(), F, '_shared', m + '.ts') + "'")
    .replace("import '../_shared/lead-rules.js'", "import '" + path.join(process.cwd(), F, '_shared', 'lead-rules.js') + "'")
  fs.writeFileSync(path.join(tmp, 'f.ts'), src); await import(path.join(tmp, 'f.ts'))
  const L = await import(path.join(process.cwd(), F, '_shared', 'lead-record.ts'))
  const run = async (hdr = { 'x-cron-secret': ENV.HUB_JOB_SECRET }) => { const r = await handler(new Request('https://x/f', { method: 'POST', headers: hdr, body: '{}' })); return { status: r.status, j: await r.json() } }
  const seen = (id, mode) => T.lead_record_seen.find((r) => r.message_id === id && r.mode === mode)

  /* the rules on their own */
  const msg = (o) => ({ id: 'x', kind: 'call', at: ago(200), dir: 'out', seconds: 0, status: '', userId: '', source: '', body: '', contactId: '', ...o })
  const kr = { email: 'krystal@mo-care.com', first: 'Krystal' }
  ck('rules: a text from a GoHighLevel user is a person; from a workflow, bulk or the API with no user it is automatic',
    L.decide(msg({ kind: 'sms', userId: 'u', source: 'app' }), kr, null).ev.actor === 'human' && L.decide(msg({ kind: 'sms', userId: 'u', source: 'workflow' }), kr, null).ev.actor === 'automation'
    && L.decide(msg({ kind: 'sms', source: 'api' }), null, null).ev.actor === 'automation' && L.decide(msg({ kind: 'sms', source: 'bulk_actions', userId: 'u' }), kr, null).ev.actor === 'automation')
  ck('rules: an outgoing call GoHighLevel marks voicemail is a voicemail try; no talk time is no answer',
    L.decide(msg({ status: 'voicemail', seconds: 0 }), kr, null).ev.outcome === 'voicemail' && L.decide(msg({ status: 'completed', seconds: 0 }), kr, null).ev.outcome === 'no_answer')
  ck('rules: 90 seconds or more is a conversation; a short call waits for the call reader, which decides',
    L.decide(msg({ seconds: 95 }), kr, null).ev.outcome === 'connected' && L.decide(msg({ seconds: 30, at: ago(10) }), kr, null).wait === true
    && L.decide(msg({ seconds: 30, at: ago(10) }), kr, { voicemail: true, summary: '' }).ev.outcome === 'voicemail' && L.decide(msg({ seconds: 30, at: ago(10) }), kr, { voicemail: false, summary: 'Talked about Tuesday' }).ev.outcome === 'connected')
  ck('rules: no reading after 3 hours: under 45 seconds is a voicemail, longer is a conversation',
    L.decide(msg({ seconds: 30, at: ago(200) }), kr, null).ev.outcome === 'voicemail' && L.decide(msg({ seconds: 60, at: ago(200) }), kr, null).ev.outcome === 'connected')
  ck('rules: a text asking us to stop is flagged on the line (nothing else is decided for her)', /may be asking us to stop/.test(L.decide(msg({ kind: 'sms', dir: 'in', body: 'STOP' }), null, null).line))
  ck('rules: no em dashes in any history line', ['sms', 'call'].every((k) => ['in', 'out'].every((dir) => [0, 30, 200].every((s) => { const d = L.decide(msg({ kind: k, dir, seconds: s, userId: 'u', body: 'hi' }), kr, { voicemail: false, summary: 'ok' }); return !d.line || !/—/.test(d.line) }))))

  /* refusals */
  reset()
  ck('nobody without the schedule secret or the owner key gets in (401)', (await run({})).status === 401)
  T.app_data[0].data.lead_record_since = ''
  ck('with no start time set it stops and says so (500), changing nothing', (await run()).status === 500 && T.lead_record_seen.length === 0)

  /* PRACTICE */
  reset(false)
  const before = clone(T.app_data.find((r) => r.key === 'leads').data)
  let r = await run()
  ck('practice: the run answers ok, in practice', r.status === 200 && r.j.mode === 'practice', r.j)
  ck('practice: no lead changed at all', same(T.app_data.find((r) => r.key === 'leads').data, before))
  ck('practice: each message gets a "would record" row with the history line', seen('m1', 'practice')?.status === 'would_record' && /Krystal called, no answer/.test(seen('m1', 'practice').line)
    && /Krystal called them, 11 min/.test(seen('m3', 'practice').line) && /They texted: "Can you call me after 2\?"/.test(seen('m2', 'practice').line), T.lead_record_seen.map((x) => [x.message_id, x.status, x.line]))
  ck('practice: the short call with no reading yet is waiting', seen('m6', 'practice')?.status === 'waiting', seen('m6', 'practice'))
  ck('practice: a number on two leads is never guessed (listed with both)', seen('m9', 'practice')?.status === 'several' && same(seen('m9', 'practice').candidates.sort(), ['L3', 'L4']))
  ck('practice: archived leads, unknown numbers, emails and messages before the start are left alone', !seen('m10', 'practice') && !seen('m12', 'practice') && !seen('mEm', 'practice') && !seen('mOld', 'practice'))
  ck('772: each row keeps GoHighLevel\'s name for the contact and which of the family\'s numbers matched', seen('m3', 'practice').contact_name === 'Carol Price' && seen('m3', 'practice').matched_on === 'phone'
    && seen('m13', 'practice').matched_on === 'client_phone' && seen('m13', 'practice').lead_id === 'L7' && seen('m9', 'practice').matched_on === null, [seen('m3', 'practice'), seen('m13', 'practice')])
  ck('only reads: every request to GoHighLevel was a GET', SENT.every(([m]) => m === 'GET'), SENT.filter(([m]) => m !== 'GET'))

  /* LIVE */
  reset(true); BUMP = { id: 'L1' }
  r = await run()
  const l1 = leadOf('L1')
  ck('live: the run answers ok, live', r.status === 200 && r.j.mode === 'live', r.j)
  ck('live: New became Contacted on the first real conversation (the 11-minute call)', l1.status === 'Contacted', l1.status)
  ck('live: first try = the unanswered call, first reached = the 11-minute call', l1.first_human_attempt_at === ago(60) && l1.first_human_contact_at === ago(40), [l1.first_human_attempt_at, l1.first_human_contact_at])
  ck('live: the unanswered call counted as a try', l1.contact_attempts === 1 && l1.last_attempt_kind === 'no answer', [l1.contact_attempts, l1.last_attempt_kind])
  ck('live: their text and their missed call show they are waiting on us', l1.family_last_reply_at === ago(5), l1.family_last_reply_at)
  ck('live: each event carries its GoHighLevel message and the person (by email)', ['m1', 'm2', 'm3', 'm4', 'm5', 'm7'].every((id) => l1.contact_events.some((e) => e.ref === 'ghl:' + id))
    && l1.contact_events.find((e) => e.ref === 'ghl:m3').by === 'krystal@mo-care.com' && l1.contact_events.find((e) => e.ref === 'ghl:m3').duration_s === 660)
  ck('live: the workflow text is automatic; Krystal\'s text is hers', l1.contact_events.find((e) => e.ref === 'ghl:m5').actor === 'automation' && l1.contact_events.find((e) => e.ref === 'ghl:m4').actor === 'human')
  ck('live: the history lines read the way the office talks', ['☎ Krystal called, no answer', '💬 They texted: "Can you call me after 2?"', '☎ Krystal called them, 11 min', '💬 Krystal texted: "Here is the link to pick a time."', '💬 Automatic text: "Reminder: your visit is Thursday"', '☎ They called, nobody answered']
    .every((t) => l1.comm_log.some((c) => c.body === t && c.src === 'auto')), l1.comm_log.map((c) => c.body))
  ck('live: last contacted is the day of the last human contact', l1.last_contacted_at === L.chicagoDay(ago(30)), l1.last_contacted_at)
  ck('live: a save in the Hub at the same moment is kept (read again and redone, nothing lost)', l1.notes === 'typed in the Hub meanwhile' && r.j.retries === 1, [l1.notes, r.j.retries])
  ck('live: one "first real conversation" event', T.op_events.filter((e) => e.verb === 'lead_connected' && e.item_id === 'L1').length === 1, T.op_events)
  ck('live: the Hub\'s own Text-button text is not recorded twice', seen('m8', 'live')?.status === 'already' && leadOf('L2').contact_events.length === 1)
  ck('live: a call someone logged by hand is not recorded twice', seen('m11', 'live')?.status === 'already' && leadOf('L6').contact_events.length === 1)
  ck('live: the shared number stays unguessed, with the event ready for whoever picks', seen('m9', 'live')?.status === 'several' && seen('m9', 'live').ev?.outcome === 'connected' && !leadOf('L3').contact_events && !leadOf('L4').contact_events)
  ck('live: the scan remembers how far it reached (per mode)', T.lead_record_state.some((x) => x.mode === 'live'))

  /* running again changes nothing; the waiting call is fetched by its own id once the reader has read it */
  const snap = clone(leadOf('L1'))
  G.convos = []   // nothing new in GoHighLevel's list
  T.call_task_reading.push({ message_id: 'm6', version: 9, tasks: [{ voicemail: true }], detail: { summary: 'Left a voicemail about Thursday.' } })
  r = await run()
  const l1b = leadOf('L1')
  ck('772: the revisited short call keeps its contact name', seen('m6', 'live')?.contact_name === 'Carol Price', seen('m6', 'live'))
  ck('again: the waiting short call is now a voicemail try (fetched by its id), nothing else changed', seen('m6', 'live')?.status === 'recorded' && l1b.contact_attempts === 2 && l1b.last_attempt_kind === 'voicemail'
    && l1b.contact_events.length === snap.contact_events.length + 1 && l1b.comm_log.some((c) => c.body === '☎ Samantha called, reached voicemail'), [r.j, l1b.contact_attempts])
  r = await run()
  ck('again: a third run records nothing new', r.j.recorded === 0 && same(leadOf('L1'), l1b), r.j)

  /* going live after practice catches up the practice days */
  reset(false); await run(); T.app_data[0].data.lead_record_live = true
  r = await run()
  ck('going live after practice records the practice days too', seen('m3', 'live')?.status === 'recorded' && leadOf('L1').status === 'Contacted', r.j)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
