// call-to-lead ("Make this a lead", 2026-10-14): the REAL function and the REAL staff check against a fake database,
// a fake GoHighLevel and a fake AI (fixed tool answer). node call_to_lead_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)])
const ANSWER = { is_new_family: true, not_new_family_reason: '', caller_first_name: 'Lynda', caller_last_name: 'Parker', email_heard: 'linda@x.test',
  relationship: 'Daughter', client_first_name: 'Margaret', client_last_name: '', client_city: 'Nixa', source: 'Referral', referral_source_name: 'Mercy discharge planner',
  referral_subtype: 'hospital', desired_start_kind: 'by_date', desired_start_date: '2026-10-19', needs: ['personalCare', 'housekeeping', 'cds', 'nonsense'],
  safety: ['fallRisk'], mobility: 'walker', personal_care: ['bathing'], medical_conditions: ['dementia'], medical_notes: 'Broke her wrist in the fall',
  schedule_days: ['Fri', 'Mon', 'Mon', 'Funday'], times_needed: 'Mornings, 8 to 12', number_of_hours: 'about 20 hours', funding_source: 'private',
  why_called: 'Daughter looking for morning help for her mom after a fall', summary: 'Linda called about her mom Margaret in Nixa.' }
let T, CALLS, AI, TRANSCRIPT, MSG, CONTACT, TAG_FAIL
const reset = () => { CALLS = []; AI = [{ content: [{ type: 'tool_use', name: 'fill_lead_form', input: { ...ANSWER } }], stop_reason: 'tool_use' }]; TRANSCRIPT = [{ mediaChannel: 1, sentenceIndex: 0, transcript: 'Hi, my mom fell.' }]
  MSG = { id: 'msgAAA111', messageType: 'TYPE_CALL', contactId: 'C1', direction: 'inbound', dateAdded: '2026-10-14T15:14:00Z', meta: { call: { duration: 360 } } }
  CONTACT = { firstName: 'Linda', lastName: 'Parker', phone: '+14175550142', email: '' }; TAG_FAIL = false
  T = { app_data: [{ key: 'leads', data: [{ id: 'L1', ghl_contact_id: 'C1', from_calls: [{ message_id: 'msgAAA111' }] }, { id: 'L2', ghl_contact_id: 'C2', from_calls: [] }] }],
    auth_identities: [{ auth_user_id: 'u-kr', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p-kr' }, { auth_user_id: 'u-cg', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p-cg' }],
    persons: [{ person_id: 'p-kr', full_name: 'Krystal Office', active: true }, { person_id: 'p-cg', full_name: 'Cara Giver', active: true }],
    entity_memberships: [{ person_id: 'p-kr', entity: 'cc_ihs', active: true, ended_at: null }, { person_id: 'p-cg', entity: 'cc_ihs', active: true, ended_at: null }],
    staff_roles: [{ person_id: 'p-kr', entity: 'cc_ihs', role: 'care_coordinator' }, { person_id: 'p-cg', entity: 'cc_ihs', role: 'caregiver' }] } }
let WRITES = 0
const q = (t) => { const st = { f: [] }; const b = { select() { return b }, limit() { return b }, eq(c, v) { st.f.push([c, v]); return b },
  upsert() { WRITES++; return Promise.resolve({ error: null }) }, insert() { WRITES++; return Promise.resolve({ error: null }) }, update() { WRITES++; return b },
  maybeSingle() { return b.then((x) => ({ data: x.data[0] ?? null, error: null })) },
  then(ok) { let rows = T[t] ?? []; for (const [c, v] of st.f) rows = rows.filter((r) => r[c] === v); return Promise.resolve({ data: JSON.parse(JSON.stringify(rows)), error: null }).then(ok) } }; return b }
globalThis.__db = { from: q, rpc: async () => { WRITES++; return { data: null, error: null } },
  auth: { getUser: async (jwt) => ({ data: { user: jwt === 'kr' ? { id: 'u-kr', email: 'k@x', app_metadata: {} } : jwt === 'cg' ? { id: 'u-cg', email: 'c@x', app_metadata: {} } : null }, error: jwt === 'kr' || jwt === 'cg' ? null : { message: 'bad' } }) } }
let LAST_AI
globalThis.fetch = async (url, o) => { url = String(url); CALLS.push(url)
  if (url.includes('api.anthropic.com')) { LAST_AI = { body: JSON.parse(o.body), headers: o.headers }; return new Response(JSON.stringify(AI.shift() || {}), { status: 200 }) }
  if (url.includes('/transcription')) return new Response(JSON.stringify(TRANSCRIPT), { status: 200 })
  if (url.endsWith('/tags')) return new Response('{}', { status: TAG_FAIL ? 500 : 200 })
  if (url.includes('/conversations/messages/')) return MSG ? new Response(JSON.stringify({ message: MSG }), { status: 200 }) : new Response('{}', { status: 404 })
  if (url.includes('/contacts/')) return new Response(JSON.stringify({ contact: CONTACT }), { status: 200 })
  return new Response('{}', { status: 404 }) }
const ENV = { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', ANTHROPIC_API_KEY: 'a' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_ctl_'))
try {
  const src = fs.readFileSync(path.join(F, 'call-to-lead/index.ts'), 'utf8')
    .replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace(/from '\.\.\/_shared\/(\w[\w-]*)\.ts'/g, (_, m) => "from '" + path.resolve(F, '_shared', m + '.ts') + "'")
  fs.writeFileSync(path.join(tmp, 'ctl.ts'), src); await import(path.join(tmp, 'ctl.ts'))
  const call = async (body, jwt = 'kr', method = 'POST') => { const r = await handler(new Request('https://x/functions/v1/call-to-lead', { method,
    headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: 'Bearer ' + jwt } : {}) }, body: method === 'POST' ? JSON.stringify(body) : undefined }))
    let j = null; try { j = await r.json() } catch { /* */ } return { status: r.status, j, h: r.headers } }

  reset(); let r = await call(null, null, 'OPTIONS'); ck('browser preflight answered with CORS headers', r.h.get('access-control-allow-origin') === '*')
  reset(); r = await call({ action: 'read', message_id: 'msgAAA111' }, null); ck('no sign-in: refused, GoHighLevel never asked', r.status === 401 && !CALLS.length, r)
  reset(); r = await call({ action: 'read', message_id: 'msgAAA111' }, 'cg'); ck('a caregiver sign-in (not office): refused', r.status === 403 && !CALLS.length, r)
  reset(); r = await call({ action: 'read', message_id: '../x' }); ck('a bad call id is refused before GoHighLevel', r.status === 400 && !CALLS.length, r)

  reset(); WRITES = 0; r = await call({ action: 'read', message_id: 'msgAAA111' }); const p = r.j.prefill || {}, heard = r.j.heard || []
  ck('read: the form is filled from the call', r.status === 200 && r.j.ok && r.j.transcript === true && p.client_first_name === 'Margaret' && p.client_city === 'Nixa' && p.relationship === 'Daughter', r.j)
  ck('read: the caller name and phone come from GoHighLevel, never from what the AI heard (Lynda heard, Linda kept)', p.first_name === 'Linda' && p.phone === '+14175550142' && !heard.includes('first_name') && !heard.includes('phone'), { p, heard })
  ck('read: an email heard fills only the empty GoHighLevel email, and is marked heard', p.email === 'linda@x.test' && heard.includes('email'), { p, heard })
  ck('read: choices are held to the form (unknown and CDS needs dropped, days de-duplicated and in week order)', p.needs.join() === 'personalCare,housekeeping' && p.schedule_days.join() === 'Mon,Fri', p)
  ck('read: hours as a number, start by date, referral kept', p.number_of_hours === '20' && p.desired_start_kind === 'by_date' && p.desired_start_date === '2026-10-19' && p.source === 'Referral' && p.referral_subtype === 'hospital', p)
  ck('read: the summary goes to the notes and why they called is one line', p.interest_notes === ANSWER.summary && p.why_called.length <= 140, p)
  ck('read: every box filled from the call is listed as heard (shown yellow); nothing empty is listed', ['client_first_name', 'client_city', 'needs', 'schedule_days', 'funding_source', 'interest_notes'].every((k) => heard.includes(k)) && !heard.includes('client_last_name'), heard)
  ck('read: writes nothing anywhere', WRITES === 0 && !CALLS.some((u) => u.endsWith('/tags')), { WRITES, CALLS })
  ck('read: the AI is asked with auto tool choice (no forced tool), the strict tool, the call day in Central, and the refusal fallback', LAST_AI.body.tool_choice.type === 'auto' && LAST_AI.body.tools[0].strict === true
     && /2026-10-14 \(Wednesday\)/.test(LAST_AI.body.messages[0].content) && LAST_AI.body.fallbacks === 'default' && /server-side-fallback-2026-07-01/.test(LAST_AI.headers['anthropic-beta']) && !('betas' in LAST_AI.body), LAST_AI.body.tool_choice)

  reset(); AI = [{ content: [{ type: 'text', text: 'hm' }] }, { content: [{ type: 'tool_use', name: 'fill_lead_form', input: { ...ANSWER, desired_start_kind: 'by_date', desired_start_date: 'next week' } }] }]
  r = await call({ action: 'read', message_id: 'msgAAA111' })
  ck('read: an answer in text is asked once more; a by-date start with no real date becomes "planning ahead"', r.j.prefill.desired_start_kind === 'planning' && !r.j.prefill.desired_start_date, r.j.prefill)
  reset(); AI = [{ stop_reason: 'refusal', content: [] }, { stop_reason: 'refusal', content: [] }]; r = await call({ action: 'read', message_id: 'msgAAA111' })
  ck('read: if the AI cannot read it, the form still opens with the contact and says so', r.status === 200 && r.j.prefill.first_name === 'Linda' && !r.j.heard.length && /could not read/.test(r.j.note), r.j)
  reset(); TRANSCRIPT = []; r = await call({ action: 'read', message_id: 'msgAAA111' })
  ck('read: no transcript yet: contact only, the AI is never asked, and it says to listen to the recording', r.status === 200 && r.j.transcript === false && !CALLS.some((u) => u.includes('anthropic')) && /no transcript/.test(r.j.note), r.j)
  reset(); MSG = null; r = await call({ action: 'read', message_id: 'msgAAA111' }); ck('read: a call GoHighLevel cannot find says so', r.status === 502 && /could not find/.test(r.j.error), r.j)
  reset(); MSG.messageType = 'TYPE_SMS'; r = await call({ action: 'read', message_id: 'msgAAA111' }); ck('read: a text message is refused (calls only)', r.status === 502 && /not a call/.test(r.j.error), r.j)

  reset(); r = await call({ action: 'made', message_id: 'msgAAA111', lead_id: 'L1' })
  ck('made: the lead carrying this call gets its GoHighLevel contact tagged "lead"', r.j.tagged === true && CALLS.some((u) => u.endsWith('/contacts/C1/tags')), r.j)
  reset(); r = await call({ action: 'made', message_id: 'msgAAA111', lead_id: 'L2' })
  ck('made: a lead that was not saved with this call is refused, nothing tagged', r.status === 409 && !CALLS.some((u) => u.endsWith('/tags')), r.j)
  reset(); TAG_FAIL = true; r = await call({ action: 'made', message_id: 'msgAAA111', lead_id: 'L1' })
  ck('made: a failed tag says so (never quietly)', r.status === 502 && r.j.tagged === false && /lead/.test(r.j.error), r.j)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
