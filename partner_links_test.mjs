// Partner links (Referral Partner Program, tracking step 1, 2026-10-26): the REAL lead-intake with sample submissions,
// against a fake database, a fake AxisCare and a fake GoHighLevel. Her rule: a link never overwrites a family's source.
// node partner_links_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 1200)])
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_pl_'))
const clone = (x) => JSON.parse(JSON.stringify(x))
let T, SENT, AX, AXDOWN
const ORGS = [
  { id: 'org-jane', name: 'Ozark Senior Moves', type: 'Senior Move Manager', partner_code: 'JANE-K7', program_status: 'active' },
  { id: 'org-ron', name: 'Grace Community Church', type: 'Faith Community', partner_code: 'RON-4Q', program_status: 'paused' },
  { id: 'org-old', name: 'Old Partner', partner_code: 'OLD-11', archived: true },
  { id: 'org-twin1', name: 'Twin One', partner_code: 'TWIN-1' }, { id: 'org-twin2', name: 'Twin Two', partner_code: 'twin-1' },
  { id: 'org-mercy', name: 'Mercy Hospital', type: 'Hospital', phone: '(417) 555-0100', partner_code: 'AMY-M3' },
]
const OLD_LEAD = { id: 'lead-old', first_name: 'Dorothy', last_name: 'Hayes', phone: '4175550777', email: '', source: 'Google', referral_source_name: '', status: 'New', created_at: '2026-10-02T15:00:00Z' }
const reset = (o = {}) => {
  T = { app_data: [{ key: 'leads', data: clone(o.leads || []) }, { key: 'referral_orgs', data: clone(ORGS) }, { key: 'ops_items', data: [] },
    { key: 'ops_settings', data: { inquiry_ack_live: true, lead_response_hours: { open: '00:00', close: '23:59', days: [0, 1, 2, 3, 4, 5, 6] } } }],
    applicant_alerts: [{ name: 'Krystal', phone: '4175550900', email: 'krystal@mo-care.com', active: true, alert_on: ['lead'] }], circle_contacts: [] }
  SENT = []; AX = o.ax || []; AXDOWN = !!o.axDown
}
function q(t) {
  const st = { f: [], op: 'select', row: null, single: false }
  const run = () => {
    const rows = (T[t] || []).filter((r) => st.f.every(([k, v]) => String(r[k]) === String(v)))
    if (st.op !== 'select') { (T['_w_' + t] = T['_w_' + t] || []).push(st.row); return { data: st.single ? st.row : [st.row], error: null } }
    return { data: st.single ? (rows[0] ? clone(rows[0]) : null) : clone(rows), error: null }
  }
  const b = new Proxy({}, { get: (_, k) => {
    if (k === 'then') return (ok, ko) => Promise.resolve(run()).then(ok, ko)
    if (k === 'eq') return (a, v) => { st.f.push([a, v]); return b }
    if (k === 'insert' || k === 'upsert' || k === 'update') return (r) => { st.op = k; st.row = r; return b }
    if (k === 'single' || k === 'maybeSingle') return () => { st.single = true; return Promise.resolve(run()) }
    return () => b } })
  return b
}
globalThis.__db = { from: q, rpc: async (fn, a) => {
  if (fn === 'upsert_app_data_item') { const row = T.app_data.find((r) => r.key === a.target_key) || (T.app_data.push({ key: a.target_key, data: [] }), T.app_data.at(-1)); const i = row.data.findIndex((x) => x.id === a.item.id); if (i >= 0) row.data[i] = clone(a.item); else row.data.push(clone(a.item)) }
  return { data: null, error: null } } }
globalThis.fetch = async (url, o = {}) => { url = String(url); const body = o.body ? JSON.parse(o.body) : {}
  if (/axiscare\.com\/api\/clients/.test(url)) return AXDOWN ? new Response('{}', { status: 429 }) : new Response(JSON.stringify({ results: { clients: AX, nextPage: null } }), { status: 200 })
  if (url === 'https://hook.example/ghl') return new Response('{}', { status: 200 })
  if (/conversations\/messages/.test(url)) { SENT.push(body); return new Response(JSON.stringify({ messageId: 'm1' }), { status: 200 }) }
  if (/\/contacts\/[^/?]+$/.test(url) && (!o.method || o.method === 'GET')) return new Response(JSON.stringify({ contact: { id: decodeURIComponent(url.split('/').pop()), dnd: false } }), { status: 200 })
  return new Response(JSON.stringify({ contacts: [{ id: 'c-any', dnd: false }], contact: { id: 'c-any' } }), { status: 200 }) }
const ENV = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k', LEAD_INTAKE_TOKEN: 'tok', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', GHL_HOOK_CCLEADS: 'https://hook.example/ghl',
  AXISCARE_TOKEN: 'ax', AXISCARE_SITE: '16485' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
try {
  const src = fs.readFileSync(path.join(F, 'lead-intake/index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace(/from '\.\.\/_shared\/([\w-]+)\.ts'/g, (_, m) => "from '" + path.join(process.cwd(), F, '_shared', m + '.ts') + "'")
  fs.writeFileSync(path.join(tmp, 'li.ts'), src); await import(path.join(tmp, 'li.ts'))
  const post = async (body) => { const r = await handler(new Request('http://x/lead-intake?token=tok', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })); return { s: r.status, j: await r.json() } }
  const leads = () => T.app_data.find((r) => r.key === 'leads').data
  const orgsSame = () => JSON.stringify(T.app_data.find((x) => x.key === 'referral_orgs').data) === JSON.stringify(ORGS)
  const FAM = (o) => Object.assign({ name: 'Gary Miller', phone: '4175550142', email: 'gary@example.com', message: 'Help for my mom after a fall' }, o)
  const NEWKEYS = ['referral_org_id', 'referral_via', 'partner_code', 'partner_link_seen', 'heard_from_typed']

  /* 1 · a new family through Jane's link */
  reset(); let r = await post(FAM({ partner_code: 'JANE-K7' })); let L = leads().at(-1)
  ck('a new family through a partner link: saved, source Referral, linked to that partner, marked "from the link"', r.s === 200 && r.j.status === 'lead created' && L.source === 'Referral' && L.referral_org_id === 'org-jane' && L.referral_source_name === 'Ozark Senior Moves' && L.referral_via === 'link' && L.partner_code === 'JANE-K7' && !L.partner_link_seen, L)
  ck('...the notes say so: "Came through Ozark Senior Moves\'s partner link (JANE-K7)."', /Came through Ozark Senior Moves's partner link \(JANE-K7\)\./.test(L.interest_notes) && /Help for my mom/.test(L.interest_notes), L.interest_notes)
  ck('...the office alert names the partner', SENT.some((m) => /Heard about us from:<\/b> Ozark Senior Moves/.test(m.html || '')), SENT.map((m) => m.subject))
  ck('...the family still gets their normal acknowledgment, nothing more, and nothing goes to the partner', r.j.acked === true && !SENT.some((m) => /partner|JANE/i.test(m.message || '')), SENT.map((m) => m.message || m.subject))
  ck('...the partner list is never changed', orgsSame())

  /* 2 · tidy-up of the code */
  reset(); r = await post(FAM({ partner_code: '  jane-k7 ' }))
  ck('the code is read the same in lower case or with spaces', leads().at(-1).referral_org_id === 'org-jane')
  reset(); r = await post(FAM({ ref_code: 'JANE-K7' }))
  ck('"ref_code" works as well as "partner_code"', leads().at(-1).referral_org_id === 'org-jane')

  /* 3 · what they typed is kept */
  reset(); r = await post(FAM({ partner_code: 'JANE-K7', heard_from: 'my neighbor Sue' })); L = leads().at(-1)
  ck('they typed "how did you hear" AND came through a link: the partner is attached and their words are kept', L.referral_org_id === 'org-jane' && L.heard_from_typed === 'my neighbor Sue', L)

  /* 4 · HER RULE: the family is already a lead with a source */
  reset({ leads: [OLD_LEAD] }); r = await post(FAM({ name: 'Dorothy Hayes', phone: '4175550777', email: '', partner_code: 'JANE-K7' }))
  const oldNow = leads().find((x) => x.id === 'lead-old'); L = leads().at(-1)
  ck('a family we already have (Google, Oct 2): the existing inquiry is untouched', JSON.stringify(oldNow) === JSON.stringify(OLD_LEAD), oldNow)
  ck('...the new inquiry is NOT linked to the partner and keeps its normal source', !L.referral_org_id && L.source === 'Website' && !L.referral_via && !L.partner_code, L)
  ck('...it is flagged "is this the same family?" as before, with one My Work item', !!L.possibly_returning && T.app_data.find((x) => x.key === 'ops_items').data.length === 1)
  ck('...it carries the link for the owner to see (code, partner, when)', L.partner_link_seen && L.partner_link_seen.code === 'JANE-K7' && L.partner_link_seen.status === 'linked' && L.partner_link_seen.org_id === 'org-jane' && !!L.partner_link_seen.at, L.partner_link_seen)
  ck('...and the notes say "Also came through..., the referral source was not changed" (the notes go with the inquiry if it is folded in)', /Also came through Ozark Senior Moves's partner link \(JANE-K7\)\. This may be a family we already know, so the referral source was not changed\./.test(L.interest_notes), L.interest_notes)

  /* 5 · already a client in AxisCare */
  reset({ ax: [{ id: 901, firstName: 'Ruth', lastName: 'Hayes', homePhone: '(417) 555-0142', status: { active: true, label: 'Active' } }] })
  r = await post(FAM({ partner_code: 'JANE-K7' })); L = leads().at(-1)
  ck('a number that belongs to an AxisCare client: not linked, flagged, the link noted', !L.referral_org_id && L.source === 'Website' && !!L.possibly_returning && L.partner_link_seen?.status === 'linked', L)

  /* 6 · fail closed */
  reset({ axDown: true }); r = await post(FAM({ partner_code: 'JANE-K7' })); L = leads().at(-1)
  ck('AxisCare can\'t be read: we can\'t know the family is new, so nobody is attached; the link is noted; the inquiry is still saved', r.s === 200 && !L.referral_org_id && L.source === 'Website' && L.partner_link_seen?.status === 'linked', [r, L])

  /* 7 · codes that link nobody */
  reset(); r = await post(FAM({ partner_code: 'RON-4Q' })); L = leads().at(-1)
  ck('a paused partner\'s code: no partner attached; noted as paused', !L.referral_org_id && L.source === 'Website' && L.partner_link_seen?.status === 'paused' && /that partner is paused/.test(L.interest_notes), L)
  reset(); r = await post(FAM({ partner_code: 'BOB-22' })); L = leads().at(-1)
  ck('an unknown code: no partner attached; the code noted for the owner', !L.referral_org_id && L.source === 'Website' && L.partner_link_seen?.status === 'unknown' && L.partner_link_seen.code === 'BOB-22' && !L.partner_link_seen.org_id && /doesn't match a saved partner/.test(L.interest_notes), L)
  reset(); r = await post(FAM({ partner_code: 'OLD-11' })); L = leads().at(-1)
  ck('an archived partner\'s code counts as unknown', !L.referral_org_id && L.partner_link_seen?.status === 'unknown', L)
  reset(); r = await post(FAM({ partner_code: 'TWIN-1' })); L = leads().at(-1)
  ck('a code two partners share: never a guess, nobody attached', !L.referral_org_id && L.partner_link_seen?.status === 'ambiguous', L)
  reset(); r = await post(FAM({ partner_code: 'BOB-22', heard_from: 'Mercy Hospital' })); L = leads().at(-1)
  ck('an unknown code with a typed answer: the typed answer works exactly as before (Referral, by name)', L.source === 'Referral' && L.referral_source_name === 'Mercy Hospital' && !L.referral_org_id && L.partner_link_seen?.status === 'unknown', L)

  /* 8 · not a code at all */
  for (const bad of ['<script>', 'AB', 'X'.repeat(21), 'JANE K7', '']) {
    reset(); r = await post(FAM({ partner_code: bad })); L = leads().at(-1)
    ck(`"${bad.slice(0, 12)}" is not a code: ignored completely, nothing new on the inquiry`, r.s === 200 && NEWKEYS.every((k) => !(k in L)) && !/partner/i.test(L.interest_notes), L)
  }

  /* 9 · no code: the same as before this change */
  reset(); r = await post(FAM()); L = leads().at(-1)
  ck('no code: Website, no new fields, the same notes as before', L.source === 'Website' && NEWKEYS.every((k) => !(k in L)) && L.interest_notes === 'Help for my mom after a fall', L)

  /* 10 · partner referral form */
  const REF = (o) => Object.assign({ kind: 'professional_referral', referrer_name: 'Amy Lutz', referrer_org: 'Mercy', referrer_type: 'hospital', referrer_contact: 'amy@mercy.net',
    client_initials: 'R.A.', urgency: 'Routine', situation: 'Going home Friday.' }, o)
  reset(); r = await post(REF({ partner_code: 'AMY-M3' })); L = leads().at(-1)
  ck('a partner sends a family through the referral form with their code: linked by the code even though they typed "Mercy"', r.j.status === 'referral received' && r.j.linked === true && L.referral_org_id === 'org-mercy' && L.referral_via === 'partner_form' && L.partner_code === 'AMY-M3' && !L.referral_org_suggest, L)
  reset(); r = await post(REF({ referrer_org: 'Mercy Hospital', partner_code: 'BOB-22' })); L = leads().at(-1)
  ck('the referral form with an unknown code: the exact name match still links as before; the code is noted', L.referral_org_id === 'org-mercy' && !L.referral_via && L.partner_link_seen?.status === 'unknown', L)
  reset(); r = await post(REF({ partner_code: 'RON-4Q' })); L = leads().at(-1)
  ck('the referral form with a paused partner\'s code: not linked by it', !L.referral_org_id && L.partner_link_seen?.status === 'paused', L)
  reset(); r = await post(REF()); L = leads().at(-1)
  ck('the referral form with no code: exactly as before (no new fields)', NEWKEYS.every((k) => !(k in L)) && L.referral_org_suggest?.name === 'Mercy', L)

  /* 11 · other doors unchanged */
  reset(); r = await post({ kind: 'course_signup', email: 'x@y.com', partner_code: 'JANE-K7' })
  ck('a course signup with a code is still not a lead', leads().length === 0 && r.j.routed === 'course_signup')
  reset(); r = await post(FAM({ partner_code: 'JANE-K7', website: 'spam' }))
  ck('the honeypot still drops bots with a code', leads().length === 0)
  ck('nothing in this test ever changed the partner list', orgsSame())
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
