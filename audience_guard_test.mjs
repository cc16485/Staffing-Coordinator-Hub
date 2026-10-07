// The audience guard (2026-10-07 safety fix): the REAL _shared/audience-guard.ts and the REAL campaign-send against fakes.
// node audience_guard_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)])
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_ag_'))
/* the people: AxisCare clients in every state, their families, and inquiries */
const AX = [
  { id: 1, firstName: 'Alice', lastName: 'Active', personalEmail: 'alice@x.com', status: { active: true, label: 'Active' } },
  { id: 2, firstName: 'Dora', lastName: 'Gone', personalEmail: 'dora@x.com', status: { active: false, label: 'Deceased' } },
  { id: 3, firstName: 'Ivan', lastName: 'Past', personalEmail: 'ivan@x.com', status: { active: false, label: 'Inactive' } },
  { id: 4, firstName: 'Hal', lastName: 'Hub-ended', personalEmail: 'hal@x.com', status: { active: true, label: 'Active' } },   // Active in AxisCare, care ended in the Hub
  { id: 5, firstName: 'Pia', lastName: 'Paused', personalEmail: 'pia@x.com', status: { active: true, label: 'Active' } },     // paused in the Hub
  { id: 6, firstName: 'Old', lastName: 'Shape', email: 'oldshape@x.com', status: 'Deceased' } ]                                  // status as a plain word
const DB = {
  person_source_id: [{ person_id: 'p1', source_id: '1' }, { person_id: 'p2', source_id: '2' }, { person_id: 'p4', source_id: '4' }, { person_id: 'p5', source_id: '5' }],
  person_role: [{ person_id: 'p1', role: 'client', status: 'active' }, { person_id: 'p4', role: 'client', status: 'former', end_reason: 'moved away' }, { person_id: 'p5', role: 'client', status: 'paused' }],
  care_circles: [{ id: 'c1', axiscare_client_id: '1' }, { id: 'c2', axiscare_client_id: '2' }],
  circle_contacts: [{ circle_id: 'c1', email: 'alicesdaughter@x.com' }, { circle_id: 'c2', email: 'dorasson@x.com' }, { circle_id: 'c2', email: 'shared@x.com' }, { circle_id: 'c1', email: 'shared@x.com' }],
  client_journey: [{ lead_id: 'L7', axiscare_client_id: '7', status: 'open', is_test: false }, { lead_id: 'L8', status: 'closed', closed_reason: 'The lead was marked Lost', is_test: false }],
  leads: [{ id: 'L2', email: 'dorasson-oldlead@x.com', status: 'Converted', axiscare_client_id: '2' },   // the family who called about Dora, long ago
    { id: 'L7', email: 'starting@x.com', status: 'Converted', said_yes_at: '2026-10-06' },              // said yes, starting care
    { id: 'L8', email: 'lostlead@x.com', status: 'Lost' },                                              // never a client
    { id: 'L9', email: 'newlead@x.com', status: 'Contacted' },
    { id: 'L10', email: 'ancient-won@x.com', status: 'Converted' } ] }                                  // won years ago, nothing ties it to a client
globalThis.__q = (t) => { const st = { f: [] }; const b = { select() { return b }, eq(k, v) { st.f.push([k, v]); return b },
  maybeSingle: async () => ({ data: t === 'app_data' ? { data: DB.leads } : null }),
  then: (ok) => Promise.resolve({ data: (DB[t] || []).filter((r) => st.f.every(([k, v]) => r[k] === undefined || r[k] === v)), error: null }).then(ok) }; return b }
let AXFAIL = false; const SENT = []
globalThis.fetch = async (u, o) => { u = String(u)
  if (u.includes('axiscare.com/api/clients')) return AXFAIL ? new Response('{}', { status: 500 }) : new Response(JSON.stringify({ results: { clients: AX } }))
  if (u.includes('leadconnectorhq.com/conversations/messages')) { SENT.push(JSON.parse(o.body).contactId); return new Response('{}', { status: 200 }) }
  return new Response('{}', { status: 404 }) }
const ENV = { SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 't', GHL_LOCATION_ID: 'l', AXISCARE_API_KEY: 'a', AXISCARE_SITE: '16485' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
try {
  const G = await import(path.resolve(F, '_shared/audience-guard.ts'))
  const g = await G.loadGuard({ from: globalThis.__q })
  const st = (e) => g.stateOf(e)
  ck('AxisCare read', g.axOk)
  ck('an active client and her family are active', st('alice@x.com') === 'active' && st('alicesdaughter@x.com') === 'active')
  ck('a deceased client, her family contact, and the family\'s OLD won inquiry are all deceased', st('dora@x.com') === 'deceased' && st('dorasson@x.com') === 'deceased' && st('dorasson-oldlead@x.com') === 'deceased', [st('dora@x.com'), st('dorasson@x.com'), st('dorasson-oldlead@x.com')])
  ck('a family email on BOTH an active and a deceased client counts as deceased (the strictest wins)', st('shared@x.com') === 'deceased')
  ck('AxisCare status as a plain word ("Deceased") is read too', st('oldshape@x.com') === 'deceased')
  ck('Inactive in AxisCare = past', st('ivan@x.com') === 'past')
  ck('Active in AxisCare but care ended in the Hub = past (the Hub\'s record wins)', st('hal@x.com') === 'past')
  ck('paused in the Hub = paused', st('pia@x.com') === 'paused')
  ck('said yes, journey open = starting', st('starting@x.com') === 'starting')
  ck('a lost inquiry is not a past client (it never started care)', st('lostlead@x.com') === null)
  ck('a won inquiry nothing ties to a client = past (not a current client)', st('ancient-won@x.com') === 'past')
  const v = (e, tag) => G.verdict(st(e), tag).ok
  ck('client campaign: active and starting go; past, paused, deceased and unknown don\'t', v('alice@x.com', 'client') && v('starting@x.com', 'client') && !v('ivan@x.com', 'client') && !v('pia@x.com', 'client') && !v('dora@x.com', 'client') && !v('newlead@x.com', 'client'))
  ck('family-contact campaign: only families of active clients', v('alicesdaughter@x.com', 'client-contact') && !v('dorasson@x.com', 'client-contact') && !v('stranger@x.com', 'client-contact'))
  ck('lead campaign: new leads go; anyone tied to a deceased, past or paused client never does', v('newlead@x.com', 'lead') && !v('dorasson-oldlead@x.com', 'lead') && !v('ivan@x.com', 'lead') && !v('pia@x.com', 'lead'))
  ck('a pasted list with no tag still never reaches a deceased client\'s family', !v('dorasson@x.com', '') && !v('shared@x.com', '') && v('stranger@x.com', ''))
  ck('caregiver news: only a death removes someone', v('ivan@x.com', 'caregiver') && !v('dora@x.com', 'caregiver'))

  /* campaign-send end to end */
  const stub = (n, b) => { const p = path.join(tmp, n + '.ts'); fs.writeFileSync(p, b); return p }
  const src = fs.readFileSync(path.join(F, 'campaign-send/index.ts'), 'utf8')
    .replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => ({ from: globalThis.__q })')
    .replace("'../_shared/staff-auth.ts'", "'" + stub('sa', 'export const OFFICE_ROLES = []; export const requireStaff = async () => ({ ok: true, email: "sam@mo-care.com", roles: ["owner_admin"] })') + "'")
    .replace("'../_shared/optout.ts'", "'" + stub('oo', 'export const ghlContactIfAllowed = async (_a, _b, _c, o) => "cid:" + o.email') + "'")
    .replace("'../_shared/audience-guard.ts'", "'" + path.resolve(F, '_shared/audience-guard.ts') + "'")
  fs.writeFileSync(path.join(tmp, 'cs.ts'), src); await import(path.join(tmp, 'cs.ts'))
  const call = async (b) => { const r = await handler(new Request('https://x', { method: 'POST', body: JSON.stringify(b) })); return r.json() }
  const all = ['alice@x.com', 'alicesdaughter@x.com', 'dora@x.com', 'dorasson@x.com', 'dorasson-oldlead@x.com', 'shared@x.com', 'ivan@x.com', 'pia@x.com', 'starting@x.com', 'newlead@x.com'].map((email) => ({ email, name: 'X' }))
  let r = await call({ screen: true, tag: 'client', recipients: all })
  ck('screen (client campaign): allowed are the active client, her daughter and the starting family; everyone else left out with why', r.ok && r.allowed.map((x) => x.email).sort().join() === 'alice@x.com,alicesdaughter@x.com,starting@x.com' && r.left_out.find((x) => x.email === 'dora@x.com').why === 'tied to a client who has died', r)
  SENT.length = 0; r = await call({ subject: 's', html: '<p>h</p>', tag: 'client', recipients: all.slice(0, 10) })
  ck('send (client campaign): only those three are sent, the rest "left out" and never reach GoHighLevel', r.sent === 3 && SENT.sort().join() === 'cid:alice@x.com,cid:alicesdaughter@x.com,cid:starting@x.com' && r.results.filter((x) => /left out/.test(x.err || '')).length === 7, [r, SENT])
  SENT.length = 0; r = await call({ subject: 's', html: 'h', tag: '', recipients: [{ email: 'dorasson@x.com' }, { email: 'stranger@x.com' }] })
  ck('send (a pasted list, no audience tag): the deceased client\'s son is left out, the stranger goes', r.sent === 1 && SENT.join() === 'cid:stranger@x.com', [r, SENT])
  SENT.length = 0; r = await call({ subject: 's', html: 'h', tag: 'client', recipients: [{ email: 'sam@mo-care.com' }] })
  ck('a test send to yourself is not screened', r.sent === 1)
  AXFAIL = true; SENT.length = 0; r = await call({ subject: 's', html: 'h', tag: 'lead', recipients: [{ email: 'newlead@x.com' }] })
  ck('AxisCare can\'t be read: NOTHING is sent (nobody could be checked), and it says so', r.sent === 0 && !SENT.length && /Nothing was sent/.test(r.error || ''), r)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
