// 576 · PHASE 0 SECURITY: the eight P0 fixes Samantha approved 2026-10-10, under Node against the REAL function code
// with a stand-in database, a stand-in GoHighLevel and a stand-in LEIE download. Nothing here reaches the internet.
//   node phase0_576_test.mjs
import fs from 'fs'; import path from 'path'; import crypto from 'crypto'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 500)])
const F = process.env.CR_ROOT || 'supabase/functions'
const SERVICE = 'service'.repeat(6), ANON = 'anon'.repeat(10), JOB = 'jobsecret'.repeat(5)
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SERVICE, HUB_JOB_SECRET: JOB, GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', HT_ORDER_TOKEN: 'ht-token', AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }

// ── the stand-in database: who is signed in, and what the staff check reads ──
const USERS = {
  office: { id: 'u1', email: 'krystal@cc.test', app_metadata: { hub_access: ['care_coordinator'] } },
  caregiver: { id: 'u5', email: 'cg@cc.test', app_metadata: { hub_access: ['care_coordinator'] } },
  owner: { id: 'u9', email: 'owner@cc.test', app_metadata: { hub_access: ['care_coordinator'] } },
}
const DB = {
  auth_identities: [{ auth_user_id: 'u1', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p1' }, { auth_user_id: 'u5', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p5' }, { auth_user_id: 'u9', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p9' }],
  persons: [{ person_id: 'p1', full_name: 'Krystal', active: true }, { person_id: 'p5', full_name: 'Cg', active: true }, { person_id: 'p9', full_name: 'Samantha', active: true }],
  entity_memberships: [{ person_id: 'p1', entity: 'cc_ihs', active: true, ended_at: null }, { person_id: 'p5', entity: 'cc_ihs', active: true, ended_at: null }, { person_id: 'p9', entity: 'cc_ihs', active: true, ended_at: null }],
  staff_roles: [{ person_id: 'p1', entity: 'cc_ihs', role: 'care_coordinator' }, { person_id: 'p5', entity: 'cc_ihs', role: 'caregiver' }, { person_id: 'p9', entity: 'cc_ihs', role: 'owner_admin' }],
  app_data: [{ key: 'ops_settings', data: {} }, { key: 'local_caregivers', data: [] }],
  recordings: [], op_events: [], contact_optout_current: [], person_identity: [], person_role: [],
}
const INSERTS = []
globalThis.__fakeCreateClient = (_url, key) => ({
  auth: { getUser: async (jwt) => USERS[jwt] ? { data: { user: USERS[jwt] }, error: null } : { data: null, error: { message: 'bad jwt' } } },
  from: (tb) => {
    const f = []; let single = false, head = false
    const p = {
      select(_c, o) { head = !!(o && o.head); return p }, eq(k, v) { f.push((r) => String(r[k]) === String(v)); return p },
      in() { return p }, not() { return p }, order() { return p }, limit() { return p }, is() { return p }, gte() { return p }, lte() { return p },
      maybeSingle() { single = true; return p },
      insert(row) { INSERTS.push({ tb, row }); return Promise.resolve({ data: null, error: null }) },
      update() { return p }, upsert() { return Promise.resolve({ data: null, error: null }) },
      then(ok, bad) {
        if (tb === 'identity_door_audit') return Promise.resolve(key === SERVICE ? { data: null, error: null, count: 0 } : { data: null, error: { message: 'permission denied' } }).then(ok, bad)
        const rows = (DB[tb] || []).filter((r) => f.every((fn) => fn(r)))
        return Promise.resolve({ data: head ? null : single ? (rows[0] || null) : rows, error: null }).then(ok, bad)
      },
    }
    return p
  },
  rpc: async () => ({ data: null, error: null }),
  storage: { from: () => ({ download: async () => ({ data: null, error: { message: 'no file' } }) }) },
})

// ── the stand-in internet ──
const NET = { ghl: [], leie: '"LASTNAME","FIRSTNAME","MIDNAME","BUSNAME","GENERAL","SPECIALTY","UPIN","NPI","DOB","ADDRESS","CITY","STATE","ZIP","EXCLTYPE","EXCLDATE","REINDATE","WAIVERDATE","WVRSTATE"\n"DOE","JOHN","","","","","","","19600101","","","MO","","1128a1","20200101","","",""\n' }
globalThis.fetch = async (u, o = {}) => {
  const url = String(u); const R = (s, b) => new Response(typeof b === 'string' ? b : JSON.stringify(b), { status: s })
  if (url.includes('oig.hhs.gov')) return R(200, NET.leie)
  if (url.includes('/contacts/upsert')) { NET.ghl.push(['upsert', JSON.parse(o.body)]); return R(200, { contact: { id: 'C9' } }) }
  if (url.includes('/medias/upload-file')) { NET.ghl.push(['media']); return R(200, { url: 'https://ghl.example/file.pdf' }) }
  if (/\/contacts\/C9\/notes$/.test(url)) { NET.ghl.push(['note', JSON.parse(o.body)]); return R(200, { note: { id: 'N1' } }) }
  if (url.startsWith('https://signed.example/')) return new Response(new Blob(['%PDF-1.4 test']), { status: 200 })
  if (url.includes('axiscare.com')) return R(200, { results: [] })
  return R(500, { error: 'unexpected ' + url })
}

// ── load each function from a copy where the Supabase import is the stand-in ──
const tmp = fs.mkdtempSync(path.join(process.cwd(), '_p0_'))
const rewrite = (src) => src.replace(/^import \{ createClient \} from ['"]https:\/\/esm\.sh\/@supabase\/supabase-js@2['"];?$/m, 'const createClient = globalThis.__fakeCreateClient;')
fs.mkdirSync(path.join(tmp, '_shared'))
for (const f of fs.readdirSync(path.join(F, '_shared'))) fs.writeFileSync(path.join(tmp, '_shared', f), rewrite(fs.readFileSync(path.join(F, '_shared', f), 'utf8')))
async function load(fn) {
  fs.mkdirSync(path.join(tmp, fn), { recursive: true })
  const src = rewrite(fs.readFileSync(path.join(F, fn, 'index.ts'), 'utf8'))
  if (/from ['"]https:\/\//.test(src)) throw new Error(fn + ' still imports from the internet')
  fs.writeFileSync(path.join(tmp, fn, 'index.ts'), src); handler = null
  await import(path.join(tmp, fn, 'index.ts')); return handler
}
const call = async (h, { who, headers = {}, body, q = '', method = 'POST', raw }) => {
  const H = { 'Content-Type': 'application/json', ...headers }; if (who) H.Authorization = 'Bearer ' + who
  const r = await h(new Request('https://x.supabase.co/functions/v1/fn' + q, { method, headers: H, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) }))
  let j = {}; try { j = await r.json() } catch { /* empty */ } return [r.status, j]
}
try {
  // 1. transcribe-recording: office only
  let h = await load('transcribe-recording')
  let [s, b] = await call(h, { body: { recording_id: 'r1' } }); ck('transcribe-recording: no sign-in is refused (401)', s === 401, [s, b])
  ;[s, b] = await call(h, { who: ANON, body: { recording_id: 'r1' } }); ck('transcribe-recording: the public key alone is refused (401)', s === 401, [s, b])
  ;[s, b] = await call(h, { who: 'caregiver', body: { recording_id: 'r1' } }); ck('transcribe-recording: a signed-in person without an office role is refused (403)', s === 403, [s, b])
  ;[s, b] = await call(h, { who: 'office', body: { recording_id: 'r1' } }); ck('transcribe-recording: an office member gets past the check (next stop: the transcriber key)', s === 500 && /ELEVENLABS/.test(b.error), [s, b])
  // 2. ai-ltc-policy: office only
  h = await load('ai-ltc-policy')
  ;[s, b] = await call(h, { body: { policy_text: 'x'.repeat(100) } }); ck('ai-ltc-policy: no sign-in is refused (401)', s === 401, [s, b])
  ;[s, b] = await call(h, { who: 'caregiver', body: { policy_text: 'x'.repeat(100) } }); ck('ai-ltc-policy: no office role is refused (403)', s === 403, [s, b])
  ;[s, b] = await call(h, { who: 'office', body: { policy_text: 'x'.repeat(100) } }); ck('ai-ltc-policy: an office member gets past the check (next stop: the model key)', s === 500 && /ANTHROPIC/.test(b.error), [s, b])
  // 3. oig-check: office only, same reader as the nightly audit
  h = await load('oig-check')
  ;[s, b] = await call(h, { body: { first: 'John', last: 'Doe' } }); ck('oig-check: no sign-in is refused (401)', s === 401, [s, b])
  ;[s, b] = await call(h, { who: 'caregiver', body: { first: 'John', last: 'Doe' } }); ck('oig-check: no office role is refused (403)', s === 403, [s, b])
  ;[s, b] = await call(h, { who: 'office', body: { first: 'John', last: 'Doe' } }); ck('oig-check: an office member gets the match, in the shape the Hub expects', s === 200 && b.clear === false && b.matches.length === 1 && b.matches[0].excltype === '1128a1' && /^\d{4}-\d{2}-\d{2}$/.test(b.date), [s, b])
  ;[s, b] = await call(h, { who: 'office', body: { first: 'Jane', last: 'Doe' } }); ck('oig-check: a clear name is clear', s === 200 && b.clear === true && b.matches.length === 0, [s, b])
  ;[s, b] = await call(h, { who: 'office', body: { first: '', last: 'Doe' } }); ck('oig-check: a missing first name is refused, not searched', s === 400, [s, b])
  // 4. ghl-attach-doc: office only, files the document, records who did it
  h = await load('ghl-attach-doc'); NET.ghl.length = 0; INSERTS.length = 0
  ;[s, b] = await call(h, { body: { first: 'A', last: 'B', email: 'a@b.c', label: 'OIG', file_url: 'https://signed.example/x.pdf' } }); ck('ghl-attach-doc: no sign-in is refused (401)', s === 401, [s, b])
  ;[s, b] = await call(h, { who: 'caregiver', body: { first: 'A', last: 'B', email: 'a@b.c', label: 'OIG', file_url: 'https://signed.example/x.pdf' } }); ck('ghl-attach-doc: no office role is refused (403)', s === 403, [s, b])
  ;[s, b] = await call(h, { who: 'office', body: { first: 'A', last: 'B', email: 'a@b.c', label: 'OIG', file_url: 'https://signed.example/x.pdf', file_name: 'oig.pdf' } })
  ck('ghl-attach-doc: an office member files it: contact found, file uploaded, note written', s === 200 && b.ok === true && b.media === true && NET.ghl.map((x) => x[0]).join(',') === 'upsert,media,note', [s, b, NET.ghl])
  const ev = INSERTS.find((x) => x.tb === 'op_events')
  ck('ghl-attach-doc: one op_events row says who filed what, and never carries the email or phone', ev && ev.row.verb === 'prehire_doc_filed' && ev.row.actor_email === 'krystal@cc.test' && /Filed: OIG/.test(ev.row.summary) && !JSON.stringify(ev.row).includes('a@b.c'), ev)
  ;[s, b] = await call(h, { who: 'office', body: { first: 'A', last: 'B', email: 'a@b.c', label: 'OIG', file_url: 'http://not-signed.example/x.pdf' } }); ck('ghl-attach-doc: a plain http link is refused', s === 400, [s, b])
  ;[s, b] = await call(h, { who: 'office', body: { first: 'A', last: 'B', label: 'OIG', probe: true } }); ck('ghl-attach-doc: the probe is for the owner only', s === 403, [s, b])
  // 5. caregiver-intro: the same staff check as the other family senders
  h = await load('caregiver-intro')
  ;[s, b] = await call(h, { body: { profile_id: 'x', client_name: 'Mary' } }); ck('caregiver-intro: no sign-in is refused (401)', s === 401, [s, b])
  ;[s, b] = await call(h, { who: 'caregiver', body: { profile_id: 'x', client_name: 'Mary' } }); ck('caregiver-intro: a signed-in account WITHOUT an office role is now refused (403); it used to get in', s === 403, [s, b])
  ;[s, b] = await call(h, { who: 'office', body: {} }); ck('caregiver-intro: an office member gets past the check (next stop: the body)', s === 400 && /profile/.test(b.error), [s, b])
  // 6. shift-confirm: its schedule (vault secret) or the owner key; nobody else
  h = await load('shift-confirm')
  ;[s, b] = await call(h, { who: ANON, q: '?auth_check=1' }); ck('shift-confirm: the public key is refused (401); it used to be answered', s === 401, [s, b])
  ;[s, b] = await call(h, { who: 'office', q: '?auth_check=1' }); ck('shift-confirm: a signed-in office member is refused too (it is a job, not a button)', s === 401, [s, b])
  ;[s, b] = await call(h, { who: ANON, headers: { 'x-cron-secret': JOB }, q: '?auth_check=1' }); ck('shift-confirm: its own schedule, carrying the vault secret, gets in as cron', s === 200 && b.caller === 'cron', [s, b])
  ;[s, b] = await call(h, { who: ANON, headers: { 'x-cron-secret': 'wrong'.repeat(9) }, q: '?auth_check=1' }); ck('shift-confirm: a wrong secret is refused', s === 401, [s, b])
  ;[s, b] = await call(h, { who: SERVICE, q: '?auth_check=1' }); ck("shift-confirm: the owner's server key gets in as owner", s === 200 && b.caller === 'owner', [s, b])
  // 7. ops-escalate: no more token in the URL
  h = await load('ops-escalate')
  ;[s, b] = await call(h, { who: ANON, q: '?token=anything&auth_check=1' }); ck('ops-escalate: a token in the URL no longer opens it (401)', s === 401, [s, b])
  ;[s, b] = await call(h, { who: ANON, headers: { 'x-cron-secret': JOB }, q: '?auth_check=1' }); ck('ops-escalate: its schedule with the vault secret gets in as cron', s === 200 && b.caller === 'cron', [s, b])
  ;[s, b] = await call(h, { who: SERVICE, q: '?auth_check=1' }); ck("ops-escalate: the owner's server key gets in as owner", s === 200 && b.caller === 'owner', [s, b])
  // 8. ht-local: a Checkr result with no secret configured is refused
  h = await load('ht-local')
  const payload = JSON.stringify({ type: 'report.completed', data: { object: { id: 'rep1', candidate_id: 'cand1', result: 'clear' } } })
  delete ENV.CHECKR_WEBHOOK_SECRET
  ;[s, b] = await call(h, { who: ANON, q: '?token=ht-token&src=checkr', raw: payload, headers: { 'x-checkr-signature': 'deadbeef' } }); ck('ht-local: with NO Checkr secret set, a result is refused (400); it used to be accepted', s === 400 && /signature/.test(b.error), [s, b])
  ENV.CHECKR_WEBHOOK_SECRET = 'checkr-secret'
  const good = crypto.createHmac('sha256', ENV.CHECKR_WEBHOOK_SECRET).update(payload).digest('hex')
  ;[s, b] = await call(h, { who: ANON, q: '?token=ht-token&src=checkr', raw: payload, headers: { 'x-checkr-signature': good } }); ck('ht-local: with the secret set, a correctly signed result is accepted past the signature check', !(s === 400 && /signature/.test(b.error)), [s, b])
  ;[s, b] = await call(h, { who: ANON, q: '?token=ht-token&src=checkr', raw: payload, headers: { 'x-checkr-signature': 'deadbeef' } }); ck('ht-local: with the secret set, a forged signature is refused', s === 400 && /signature/.test(b.error), [s, b])
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '\n     ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
