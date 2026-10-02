// Hub half of the orientation link (1b, 2026-10-01): outreach-check's report answer understands held: true (the Training
// Platform held the message back itself), so the Needs Attention card says the real reason. node orientation_link_hub_test.mjs
import fs from 'fs'; import path from 'path'
const FN = 'supabase/functions'; const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 600)])
let CARDS = []
const q = (t) => { const b = { select() { return b }, eq() { return b }, ilike() { return b }, order() { return b }, limit() { return b }, neq() { return b },
  maybeSingle: async () => ({ data: t === 'app_data' ? { data: CARDS } : null, error: null }),
  then(ok) { return Promise.resolve({ data: [], error: null }).then(ok) } }; return b }
globalThis.__db = { from: q, rpc: async (fn, a) => { if (fn === 'upsert_app_data_item') { CARDS = CARDS.filter((c) => c.id !== a.item.id); CARDS.push(a.item) } return { data: null, error: null } } }
let handler; globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'k', OUTREACH_SECRET: 's'.repeat(40), GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc' })[k] }, serve: (h) => { handler = h } }
const src = fs.readFileSync(`${FN}/outreach-check/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
const tmp = path.join(process.cwd(), FN, 'outreach-check', '_t1b.ts'); fs.writeFileSync(tmp, src); try { await import(tmp) } finally { fs.unlinkSync(tmp) }
const post = async (body, secret = 's'.repeat(40)) => { const r = await handler(new Request('https://x/f', { method: 'POST', headers: { 'x-outreach-secret': secret }, body: JSON.stringify(body) })); return [r.status, await r.json()] }
const FIX = 'orientation link not sent (not a caregiver in AxisCare yet). Set them to In Training in AxisCare, then press Send orientation link.'
let [s, j] = await post({ report: true, held: true, sender: 'job-offer (welcome)', channel: 'sms', phone: '4175550199', who: 'Ava Applicant', why: FIX }, 'wrong')
ck('a held report without the server secret is refused, no card', s === 401 && !CARDS.length, j)
;[s, j] = await post({ report: true, held: true, sender: 'job-offer (welcome)', channel: 'sms', phone: '4175550199', who: 'Ava Applicant', why: FIX })
const c = CARDS[0] || {}
ck('not in AxisCare as In Training: ONE card, "welcome message" to the person, in the caregivers domain', s === 200 && j.reported && CARDS.length === 1 && /Text didn't go through: welcome message to Ava Applicant/.test(c.title) && c.domain === 'caregivers', CARDS)
ck('the card gives the fix (set In Training, press Send orientation link) and does NOT blame GoHighLevel', /Set them to In Training in AxisCare, then press Send orientation link/.test(c.detail) && !/GoHighLevel did not accept/.test(c.detail) && c.problem !== 'failed', c)
ck('the whole reason fits on the card (not cut before the fix)', c.reasons?.[0] === FIX, c.reasons)
CARDS = []; ;[s, j] = await post({ report: true, held: true, sender: 'sync-axiscare (welcome)', channel: 'sms', phone: '4175550101', who: 'Nia New', why: 'Do Not Disturb is on for them in GoHighLevel (training welcome text)' })
ck('a held Do Not Disturb report reads as Do Not Disturb (call them instead)', CARDS[0]?.problem === 'dnd' && /Call them instead/.test(CARDS[0]?.detail), CARDS[0])
CARDS = []; ;[s, j] = await post({ report: true, held: true, sender: 'sync-axiscare (welcome)', channel: 'email', email: 'nia@x.com', who: 'Nia New', why: 'could not check the opt-out list, so the training welcome email was held back' })
ck('a held "could not check" report reads as unchecked', CARDS[0]?.problem === 'unchecked', CARDS[0])
CARDS = []; ;[s, j] = await post({ report: true, sender: 'send-invite', channel: 'sms', phone: '4175550101', who: 'Dana Doe', why: 'error 422: bad number' })
ck('without held it is still a GoHighLevel refusal (unchanged)', CARDS[0]?.problem === 'failed' && /GoHighLevel did not accept/.test(CARDS[0]?.detail), CARDS[0])
const oc = fs.readFileSync(`${FN}/outreach-check/index.ts`, 'utf8')
ck('no em dash in the new comment', !/—/.test(oc.slice(oc.indexOf('ORIENTATION LINK'), oc.indexOf('ORIENTATION LINK') + 500)))
let all = true; console.log('\nORIENTATION LINK · HUB · TEST\n' + '='.repeat(50)); for (const [n, g, note] of res) { all &&= g; console.log((g ? 'PASS  ' : 'FAIL  ') + n + (note ? '\n   └─ ' + note : '')) }
console.log(all ? `ALL ${res.length} CHECKS PASS` : 'FAILED'); process.exit(all ? 0 : 1)
