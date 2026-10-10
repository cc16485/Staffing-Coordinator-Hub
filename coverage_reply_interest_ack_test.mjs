// coverage-reply: the new-client (interest) auto-reply is behind a switch (Samantha, 2026-10-10: turn off the
// "we haven't met the client yet" responses). The REAL coverage-reply against a fake database and fake GoHighLevel.
// node coverage_reply_interest_ack_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)])
const TOKEN = 't'.repeat(40), P1 = '4175550101', P2 = '4175550202'
let T, SMS, UPSERTS
const ask = (o) => ({ id: 'a' + Math.random().toString(36).slice(2), name: 'Ariel Smith', phone: P1, channel: 'sms', at: new Date(Date.now() - 3600e3).toISOString(),
  state: 'waiting', replied_at: null, ghl_contact_id: 'C1', ...o })
const kase = (o) => ({ id: 'case1', status: 'open', kind: 'callout', client: 'Mary Example', shift_date: '2099-10-05', shift_time: '09:00-13:00', asked: [], ...o })
const reset = (cases) => { SMS = []; UPSERTS = []; T = { app_data: [{ key: 'coverage_cases', data: cases }, { key: 'ops_settings', data: {} }],
  person_role: [], person_identity: [], contact_optout_current: [], circle_contacts: [], op_events: [] } }
const q = (t) => { const st = { f: [] }; const b = { select() { return b }, in() { return b }, not() { return b }, order() { return b }, limit() { return b },
  eq(c, v) { st.f.push([c, v]); return b }, insert() { return Promise.resolve({ error: null }) },
  maybeSingle() { return b.then((x) => ({ data: x.data[0] ?? null, error: null })) },
  then(ok) { let rows = T[t] ?? []; for (const [c, v] of st.f) rows = rows.filter((r) => r[c] === v); return Promise.resolve({ data: JSON.parse(JSON.stringify(rows)), error: null }).then(ok) } }; return b }
globalThis.__db = { from: q, rpc: async (fn, a) => {
  if (fn === 'upsert_app_data_item') { UPSERTS.push(a); const row = T.app_data.find((r) => r.key === a.target_key) || (T.app_data.push({ key: a.target_key, data: [] }), T.app_data.at(-1))
    const i = row.data.findIndex((x) => x.id === a.item.id); if (i >= 0) row.data[i] = JSON.parse(JSON.stringify(a.item)); else row.data.push(JSON.parse(JSON.stringify(a.item))) }
  return { data: null, error: null } } }
globalThis.fetch = async (url, o) => { url = String(url); const body = o?.body ? JSON.parse(o.body) : {}
  if (url.includes('/conversations/messages')) { SMS.push(body); return new Response('{}', { status: 200 }) }
  if (url.includes('/contacts/')) return new Response(JSON.stringify({ contact: { id: 'C1', phone: '+1' + P1, dnd: false } }), { status: 200 })
  return new Response('{}', { status: 200 }) }
const ENV = { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k', COVERAGE_REPLY_TOKEN: TOKEN, GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const F = process.env.CR_ROOT || 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_cri_'))
try {
  const src = fs.readFileSync(path.join(F, 'coverage-reply/index.ts'), 'utf8')
    .replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace(/from '\.\.\/_shared\/(\w[\w-]*)\.ts'/g, (_, m) => "from '" + path.resolve(F, '_shared', m + '.ts') + "'")
  fs.writeFileSync(path.join(tmp, 'cr.ts'), src); await import(path.join(tmp, 'cr.ts'))
  const reply = async (message, phone = P1) => { const r = await handler(new Request('https://x/functions/v1/coverage-reply?token=' + TOKEN, { method: 'POST',
    body: JSON.stringify({ id: 'C1', phone: '+1' + phone, name: 'Ariel', message }) })); return r.json() }
  const caseNow = (id = 'case1') => T.app_data[0].data.find((c) => c.id === id)

  const settings = (o) => { T.app_data.find((r) => r.key === 'ops_settings').data = o }
  const interest = (asked) => kase({ kind: 'interest', client: 'Dad (new client)', asked: asked.map((a) => ({ ...a, picked_by_coordinator: true })) })

  reset([interest([ask({ auto: false })])]); let r = await reply('Yes I would love those hours')
  ck('switch missing (the default now): a YES to a new-client ask is collected, NOTHING is texted back', r.ok === true && caseNow().asked[0].state === 'yes' && SMS.length === 0, [r, SMS])
  ck('...and the case says why there was no reply (no silent skip)', /no auto-reply: the switch is off/.test(r.routed) && caseNow().asked[0].ack_skipped === 'switch off', [r.routed, caseNow().asked[0]])

  reset([interest([ask({ auto: false })])]); settings({ coverage_ack_interest_live: false }); r = await reply('yes')
  ck('switch off: same, nothing texted back', caseNow().asked[0].state === 'yes' && SMS.length === 0, [r, SMS])

  reset([interest([ask({ auto: false })])]); settings({ coverage_ack_interest_live: true }); r = await reply('yes')
  ck('switch on: the soft acknowledgment goes, as before', SMS.length === 1 && /Nothing is set yet/.test(SMS[0].message) && /Ariel/.test(SMS[0].message) && caseNow().asked[0].state === 'yes' && !caseNow().asked[0].ack_skipped, [r, SMS])

  reset([interest([ask({ auto: false })])]); settings({ coverage_ack_interest_live: true, coverage_msg_ack_interest: 'Thanks {first_name}, noted.' }); r = await reply('yes')
  ck('switch on with custom wording: the custom words go', SMS.length === 1 && SMS[0].message === 'Thanks Ariel, noted.', SMS)

  reset([interest([ask({ auto: false })])]); r = await reply("sorry, can't")
  ck('a NO to a new-client ask: recorded as no, nothing texted (unchanged)', caseNow().asked[0].state === 'no' && SMS.length === 0, [r, SMS])

  const src2 = fs.readFileSync(path.join(F, 'coverage-reply/index.ts'), 'utf8')
  ck('no em dash in the new words', !/\u2014/.test(src2.slice(src2.indexOf('AUTO-REPLY SWITCH'), src2.indexOf('AUTO-REPLY SWITCH') + 1400)))
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
let fails = 0
for (const [n, ok, note] of res) { console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + note)); if (!ok) fails++ }
console.log(`\n${res.length - fails}/${res.length} passed`); process.exit(fails ? 1 : 0)
