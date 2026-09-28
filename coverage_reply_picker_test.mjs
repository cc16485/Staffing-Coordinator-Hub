// coverage-reply: replies to coordinator-picked asks now reach their callout (2026-09-28).
// The REAL coverage-reply against a fake database and fake GoHighLevel. node coverage_reply_picker_test.mjs
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
const F = process.env.CR_ROOT || 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_crp_'))
try {
  const src = fs.readFileSync(path.join(F, 'coverage-reply/index.ts'), 'utf8')
    .replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace(/from '\.\.\/_shared\/(\w[\w-]*)\.ts'/g, (_, m) => "from '" + path.resolve(F, '_shared', m + '.ts') + "'")
  fs.writeFileSync(path.join(tmp, 'cr.ts'), src); await import(path.join(tmp, 'cr.ts'))
  const reply = async (message, phone = P1) => { const r = await handler(new Request('https://x/functions/v1/coverage-reply?token=' + TOKEN, { method: 'POST',
    body: JSON.stringify({ id: 'C1', phone: '+1' + phone, name: 'Ariel', message }) })); return r.json() }
  const caseNow = (id = 'case1') => T.app_data[0].data.find((c) => c.id === id)

  reset([kase({ asked: [ask({ auto: false, picked_by_coordinator: true })] })]); let r = await reply('Yes I can')
  ck('a YES to a coordinator-picked ask now lands on its callout (it was "nothing to attach to")', r.case_id === 'case1' && caseNow().asked[0].state === 'yes' && caseNow().asked[0].reply === 'Yes I can', r)
  reset([kase({ asked: [ask({ auto: false, picked_by_coordinator: true })] })]); r = await reply("Sorry I can't")
  ck('a NO to a picked ask is recorded as no', caseNow().asked[0].state === 'no', r)
  reset([kase({ asked: [ask({ auto: true, tier: 1 })] })]); r = await reply('yes')
  ck("Cara's automatic asks still match exactly as before", caseNow().asked[0].state === 'yes', r)
  reset([kase({ asked: [ask({ auto: false, channel: 'call' })] })]); r = await reply('yes')
  ck('an ask staff only LOGGED after a phone call is still not matched by a text (unchanged)', /nothing to attach/.test(r.routed) && caseNow().asked[0].state === 'waiting', r)
  reset([kase({ asked: [ask({ auto: false, picked_by_coordinator: true })] }), kase({ id: 'case2', client: 'Other Person', asked: [ask({ auto: true })] })]); r = await reply('yes')
  ck('picked on one open callout + asked on another: still goes to a human, never guessed', /two open callouts/.test(r.routed), r)
  reset([kase({ status: 'closed', asked: [ask({ auto: false, picked_by_coordinator: true })] })]); r = await reply('yes')
  ck('a closed callout never takes a reply', /nothing to attach/.test(r.routed), r)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
