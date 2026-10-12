// coverage-reply, open hours (2026-10-12): the AI sorts a whole-team answer into green (with squares) / red / yellow,
// a second text is read with the first, a thank-you only to a YES behind its switch, one office item for questions.
// The REAL coverage-reply against a fake database, fake GoHighLevel and a fake AI. node coverage_reply_open_hours_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)])
const TOKEN = 't'.repeat(40), P1 = '4175550101', P2 = '4175550202'
let T, SMS, UPSERTS, AI = null, AICALLS = 0
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
  if (url.includes('api.anthropic.com')) { AICALLS++; return AI ? new Response(JSON.stringify({ content: [{ text: AI(body.messages[0].content) }] }), { status: 200 }) : new Response('{}', { status: 500 }) }
  if (url.includes('/conversations/messages')) { SMS.push(body); return new Response('{}', { status: 200 }) }
  if (url.includes('/contacts/')) return new Response(JSON.stringify({ contact: { id: 'C1', phone: '+1' + P1, dnd: false } }), { status: 200 })
  return new Response('{}', { status: 200 }) }
const ENV = { ANTHROPIC_API_KEY: 'ak', SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k', COVERAGE_REPLY_TOKEN: TOKEN, GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const F = process.env.CR_ROOT || 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_cro_'))
try {
  const src = fs.readFileSync(path.join(F, 'coverage-reply/index.ts'), 'utf8')
    .replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace(/from '\.\.\/_shared\/(\w[\w-]*)\.ts'/g, (_, m) => "from '" + path.resolve(F, '_shared', m + '.ts') + "'")
  fs.writeFileSync(path.join(tmp, 'cr.ts'), src); await import(path.join(tmp, 'cr.ts'))
  const reply = async (message, phone = P1) => { const r = await handler(new Request('https://x/functions/v1/coverage-reply?token=' + TOKEN, { method: 'POST',
    body: JSON.stringify({ id: 'C1', phone: '+1' + phone, name: 'Ariel', message }) })); return r.json() }
  const caseNow = (id = 'case1') => T.app_data[0].data.find((c) => c.id === id)

  const settings = (o) => { T.app_data.find((r) => r.key === 'ops_settings').data = o }
  const slots = [{ k: 'am', start: '08:00', end: '12:00' }, { k: 'pm', start: '12:00', end: '17:00' }]
  const oh = (asked) => kase({ id: 'cwh_p1', kind: 'interest', open_hours: true, plan_id: 'p1', client: 'Open hours, Nixa', client_city: 'Nixa', shift_date: '', shift_time: '',
    interest_days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'], slots, asked: asked.map((a) => ({ ...a, picked_by_coordinator: true, open_hours: true })) })
  const now = () => caseNow('cwh_p1').asked[0]
  const ops = () => (T.app_data.find((r) => r.key === 'ops_items') || { data: [] }).data

  reset([oh([ask({})])]); settings({ open_hours_ai_live: true }); AI = () => '{"answer":"yes","cells":["mon|am","wed|am","wed|pm"],"any":false,"sure":true,"quote":"Monday mornings and all day Wednesday"}'
  let r = await reply('I can do Monday mornings and all day Wednesday')
  ck('green: the AI puts the squares on the answer', now().state === 'yes' && now().yes_cells.join() === 'mon|am,wed|am,wed|pm' && now().read_by === 'ai' && now().ai_quote === 'Monday mornings and all day Wednesday', now())
  ck('...no thank-you while its switch is off, and the case says so', SMS.length === 0 && now().ack_skipped === 'switch off', SMS)
  ck('...no call-off "pick & assign" item, nothing assigned', !ops().some((i) => /ops_covfill/.test(i.id)) && !caseNow('cwh_p1').pending_fill)

  reset([oh([ask({})])]); settings({ open_hours_ai_live: true, open_hours_ack_live: true }); AI = () => '{"answer":"yes","any":true,"cells":[],"sure":true,"quote":"Yes"}'
  r = await reply('Yes')
  ck('a plain yes: every square, and the thank-you goes (switch on, her wording)', now().state === 'yes' && now().yes_cells.length === 12 && now().any_time === true && SMS.length === 1 && SMS[0].message === "Thanks, Ariel! We got your answer and we'll be in touch once the schedule is set.", [now(), SMS])
  AI = () => '{"answer":"yes","cells":["mon|am","mon|pm","tue|am","tue|pm","wed|am","wed|pm","thu|am","thu|pm","fri|am","fri|pm"],"any":false,"sure":true,"quote":"not Saturdays"}'
  r = await reply('actually not Saturdays')
  ck('a second text is read WITH the first: Saturday comes off, no second thank-you', now().yes_cells.length === 10 && !now().yes_cells.some((c) => c.startsWith('sat')) && SMS.length === 1 && /Yes\nactually not Saturdays/.test(now().reply), [now(), SMS])

  reset([oh([ask({})])]); settings({ open_hours_ai_live: true, open_hours_ack_live: true }); AI = () => '{"answer":"no","cells":[],"sure":true,"quote":"No thanks"}'
  r = await reply('No thanks')
  ck('red: no, nothing texted', now().state === 'no' && SMS.length === 0, [now(), SMS])

  reset([oh([ask({}), ask({ id: 'b2', name: 'Bo Bright', phone: P2, ghl_contact_id: 'C2' })])]); settings({ open_hours_ai_live: true, open_hours_ack_live: true })
  AI = () => '{"answer":"yes","cells":["mon|am"],"any":false,"sure":true,"quote":"yes mornings"}'
  r = await reply('yes mornings, where in Nixa?')
  ck('yellow: a question even with a yes, the days kept, no thank-you', now().state === 'inquiry' && now().yes_cells.join() === 'mon|am' && SMS.length === 0, [now(), SMS])
  r = await reply('how many hours a week?', P2)
  const qi = ops().filter((i) => i.id === 'ops_openq_cwh_p1')
  ck('ONE office item for the whole ask, kept up to date (2 questions)', qi.length === 1 && /^2 questions about the open hours in Nixa/.test(qi[0].title) && /Bo Bright/.test(qi[0].detail) && qi[0].plan_id === 'p1', qi)

  reset([oh([ask({})])]); settings({ open_hours_ai_live: false }); AICALLS = 0; AI = () => '{}'
  r = await reply('Yes!')
  ck('AI switch off: words only, a clear yes = all of it, and the AI is never called', now().state === 'yes' && now().yes_cells.length === 12 && /AI switch is off/.test(now().read_by) && AICALLS === 0, now())
  reset([oh([ask({})])]); settings({ open_hours_ai_live: false }); r = await reply('Mondays work for me')
  ck('...days need a person without the AI: yellow', now().state === 'inquiry' && /person/.test(now().read_why), now())

  reset([oh([ask({})])]); settings({ open_hours_ai_live: true }); AI = null; r = await reply('yes')
  ck('AI down: falls back to words, and the answer says so', now().state === 'yes' && /AI did not answer/.test(now().read_by), now())

  reset([kase({ asked: [{ ...ask({}), auto: true }] })]); settings({ open_hours_ai_live: true }); AICALLS = 0; r = await reply('yes')
  ck('a call-off is untouched by any of this (no AI call, old path)', caseNow().asked[0].state === 'yes' && AICALLS === 0 && !caseNow().asked[0].read_by, caseNow().asked[0])
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
let fails = 0
for (const [n, ok, note] of res) { console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + note)); if (!ok) fails++ }
console.log(`${res.length - fails}/${res.length} passed`); process.exit(fails ? 1 : 0)
