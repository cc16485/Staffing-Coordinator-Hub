// call-to-lead ("Make this a lead", 2026-10-14): the REAL function and the REAL staff check against a fake database,
// a fake GoHighLevel and a fake AI (fixed tool answer). node call_to_lead_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)])
const ANSWER = { is_new_family: true, not_new_family_reason: '', caller_first_name: 'Lynda', caller_last_name: 'Parker', email_heard: 'linda@x.test',
  relationship: 'Daughter', client_first_name: 'Margaret', client_last_name: '', client_city: 'Nixa', source: 'Referral', referral_source_name: 'Mercy discharge planner',
  referral_subtype: 'hospital', desired_start_kind: 'by_date', desired_start_date: '2026-10-19', needs: ['personalCare', 'housekeeping', 'cds', 'nonsense'],
  safety: ['fallRisk'], mobility: 'walker', personal_care: ['bathing'], medical_conditions: ['dementia'], medical_notes: 'Broke her wrist in the fall',
  schedule_days: ['Fri', 'Mon', 'Mon', 'Funday'], times_needed: 'Mornings, 8 to 12', number_of_hours: 'about 20 hours', funding_source: 'private',
  why_called: 'Daughter looking for morning help for her mom after a fall', summary: 'Linda called about her mom Margaret in Nixa.',
  client_dob: '1941-03-02', client_age: '85', client_gender: 'Female', client_address: '12 Elm St', client_state: 'mo', client_zip: '65714', client_phone: '',
  marital_status: 'Widowed', language: 'English', heard_about_us: 'a friend at church', weight_bearing: 'yes', level_estimate: '2', dementia_follow_up: ['sundowning'],
  physician_name: 'Dr. Lee', physician_phone: '', preferred_hospital: 'Mercy', medicaid_mentioned: false, rate_quoted: '$32 an hour',
  other_details: 'Lives alone with a small dog. Loves gardening and the Cardinals.',
  care_plan: { adl_needs: 'Needs standby help showering.', iadl_needs: 'Meals and light housekeeping.', medical_conditions: 'Broken wrist.', medications: '',
    safety_concerns: 'Fell last week.', client_goals: 'Stay home.', services_recommended: 'Morning personal care.', recommended_frequency: 'Mon to Fri mornings',
    recommended_hours_per_week: '20 hours', narrative: 'Margaret is 85 and lives alone in Nixa. Reported by her daughter on the phone, to confirm at the visit.',
    tasks: [{ adl_id: 11, days: ['Mon', 'Wed', 'Fri'], as_needed: false, when: 'morning', instructions: 'Standby while showering' },
            { adl_id: 22, days: [], as_needed: true, when: 'evening', instructions: 'Meals' },
            { adl_id: 999, days: ['Mon'], as_needed: false, when: 'any', instructions: 'not a real task' },
            { adl_id: 11, days: ['Tue'], as_needed: false, when: 'any', instructions: 'duplicate' }] },
  home_life: { preferred_name: 'Maggie', living_situation: 'facility', facility_name: 'Elfdale assisted living, Apex', why_now: ['fall', 'nonsense'], allergies: 'Penicillin',
    cats: false, dogs: true, smoking: 'no', caregiver_gender: 'female_preferred', spanish: false },
  people: [{ name: 'Her boyfriend', relationship: 'Boyfriend', note: 'Can get in the way during care' }, { name: 'her boyfriend', relationship: 'Boyfriend', note: 'dup' }, { name: '', relationship: 'x', note: '' }] }
let TX = {}, T, CALLS, AI, TRANSCRIPT, MSG, CONTACT, TAG_FAIL, AX_FAIL
const reset = () => { CALLS = []; AI = [{ content: [{ type: 'tool_use', name: 'fill_lead_form', input: { ...ANSWER } }], stop_reason: 'tool_use' }]; TRANSCRIPT = [{ mediaChannel: 1, sentenceIndex: 0, transcript: 'Hi, my mom fell.' }]
  MSG = { id: 'msgAAA111', messageType: 'TYPE_CALL', contactId: 'C1', direction: 'inbound', dateAdded: '2026-10-14T15:14:00Z', meta: { call: { duration: 360 } } }
  CONTACT = { firstName: 'Linda', lastName: 'Parker', phone: '+14175550142', email: '' }; TAG_FAIL = false; AX_FAIL = false
  TX = { callOLD01: [{ mediaChannel: 1, sentenceIndex: 0, transcript: 'First call words' }], callNEW02: [{ mediaChannel: 2, sentenceIndex: 0, transcript: 'Second call words' }] }
  T = { app_data: [{ key: 'leads', data: [{ id: 'L1', ghl_contact_id: 'C1', from_calls: [{ message_id: 'msgAAA111' }] }, { id: 'L2', ghl_contact_id: 'C2', from_calls: [] }, { id: 'L3', first_name: '(phone lead)' }] }],
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
  if (url.includes('.axiscare.com/api/adls')) return AX_FAIL ? new Response('{}', { status: 500 }) : new Response(JSON.stringify({ results: { data: [{ id: 11, name: 'Bathing', adlKey: 'bathing', active: true }, { id: 22, name: 'Meal Preparation', active: true }, { id: 33, name: 'Old task', active: false }] } }), { status: 200 })
  if (url.includes('api.anthropic.com')) { LAST_AI = { body: JSON.parse(o.body), headers: o.headers }; return new Response(JSON.stringify(AI.shift() || {}), { status: 200 }) }
  if (url.includes('/transcription')) { const id = url.split('/messages/')[1].split('/')[0]; return new Response(JSON.stringify(TX[id] || TRANSCRIPT), { status: 200 }) }
  if (url.includes('/conversations/search')) return new Response(JSON.stringify({ conversations: url.includes('contactId=C1') ? [{ id: 'cv1' }] : [] }), { status: 200 })
  if (url.includes('/conversations/cv1/messages')) return new Response(JSON.stringify({ messages: { messages: [
    { id: 'callOLD01', messageType: 'TYPE_CALL', direction: 'inbound', dateAdded: '2026-10-13T15:00:00Z', meta: { call: { duration: 300 } } },
    { id: 'callNEW02', messageType: 'TYPE_CALL', direction: 'outbound', dateAdded: '2026-10-14T15:00:00Z', meta: { call: { duration: 120 } } },
    { id: 'callMISS3', messageType: 'TYPE_CALL', direction: 'inbound', dateAdded: '2026-10-14T16:00:00Z', meta: { call: { duration: 0 } } },
    { id: 'smsXXXX04', messageType: 'TYPE_SMS', direction: 'inbound', dateAdded: '2026-10-14T17:00:00Z' }] } }), { status: 200 })
  if (url.endsWith('/tags')) return new Response('{}', { status: TAG_FAIL ? 500 : 200 })
  if (url.includes('/conversations/messages/')) return MSG ? new Response(JSON.stringify({ message: MSG }), { status: 200 }) : new Response('{}', { status: 404 })
  if (url.includes('/contacts/')) return new Response(JSON.stringify({ contact: CONTACT }), { status: 200 })
  return new Response('{}', { status: 404 }) }
const ENV = { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', ANTHROPIC_API_KEY: 'a', AXISCARE_API_KEY: 'ax', AXISCARE_SITE: '16485' }
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
  ck('776: the reader is told to add up days and times into hours a week (her Laura call: 5:30 to 9:30 pm Mon to Fri plus 8 am to 9:30 pm Sat and Sun = 47)', /ADD THEM UP[\s\S]*47/.test(fs.readFileSync('supabase/functions/_shared/call-lead.ts', 'utf8')), null)
  ck('read: hours as a number, start by date, referral kept', p.number_of_hours === '20' && p.desired_start_kind === 'by_date' && p.desired_start_date === '2026-10-19' && p.source === 'Referral' && p.referral_subtype === 'hospital', p)
  ck('read: the summary leads the notes and why they called is one line', p.interest_notes.startsWith(ANSWER.summary) && p.why_called.length <= 140, p)
  ck('read: every box filled from the call is listed as heard (shown yellow); nothing empty is listed', ['client_first_name', 'client_city', 'needs', 'schedule_days', 'funding_source', 'interest_notes'].every((k) => heard.includes(k)) && !heard.includes('client_last_name'), heard)
  ck('read: writes nothing anywhere', WRITES === 0 && !CALLS.some((u) => u.endsWith('/tags')), { WRITES, CALLS })
  ck('read: the AI is asked with auto tool choice (no forced tool), the form NOT strict (1058: too large for strict mode), the call day in Central, and the refusal fallback', LAST_AI.body.tool_choice.type === 'auto' && !LAST_AI.body.tools[0].strict
     && /2026-10-14 \(Wednesday\)/.test(LAST_AI.body.messages[0].content) && LAST_AI.body.fallbacks === 'default' && /server-side-fallback-2026-07-01/.test(LAST_AI.headers['anthropic-beta']) && !('betas' in LAST_AI.body), LAST_AI.body.tool_choice)

  ck('v2 read: everything the call gave is filled (birth date, address, state upper case, ZIP, marital, language, doctor, hospital, level, weight, dementia, quoted rate)',
     p.client_dob === '1941-03-02' && p.client_address === '12 Elm St' && p.client_state === 'MO' && p.client_zip === '65714' && p.marital_status === 'Widowed' && p.language === 'English'
     && p.physician_name === 'Dr. Lee' && p.preferred_hospital === 'Mercy' && p.level_estimate === '2' && p.weight_bearing === 'yes' && p.dementia_follow_up.join() === 'sundowning'
     && p.price_quoted === true && p.quoted_price_amount === '$32 an hour' && heard.includes('client_dob') && heard.includes('price_quoted'), p)
  ck('v2 read: anything with no box of its own goes into the notes (age, how they heard, home and family)', /Also said on the call: Age: 85\. Heard about us: a friend at church\. Lives alone with a small dog/.test(p.interest_notes), p.interest_notes)
  const cp = r.j.care_plan || {}
  ck('v2 read: the care plan draft: its fields, the hours as a number, the narrative', cp.fields.adl_needs === 'Needs standby help showering.' && cp.fields.recommended_hours_per_week === '20'
     && !('medications' in cp.fields) && /Reported by her daughter/.test(cp.narrative) && cp.heard.includes('narrative'), cp)
  ck('v2 read: care tasks only from AxisCare\'s own active list (unknown and repeated numbers dropped), in AxisCare\'s day letters; as needed is any time',
     cp.axiscare_tasks.length === 2 && cp.axiscare_tasks[0].adl_id === 11 && cp.axiscare_tasks[0].name === 'Bathing' && cp.axiscare_tasks[0].days.join('') === 'MWF' && cp.axiscare_tasks[0].require === 1 && cp.axiscare_tasks[0].when === 1
     && cp.axiscare_tasks[1].adl_id === 22 && cp.axiscare_tasks[1].require === 2 && cp.axiscare_tasks[1].when === 0 && cp.axiscare_tasks[1].days.join('') === 'MF', cp.axiscare_tasks)
  ck('v2 read: the AI is shown AxisCare\'s active tasks (not the inactive one) and asked for the care plan', /11: Bathing\n22: Meal Preparation/.test(LAST_AI.body.messages[0].content) && !/Old task/.test(LAST_AI.body.messages[0].content)
     && LAST_AI.body.tools[0].input_schema.properties.care_plan.properties.narrative, LAST_AI.body.messages[0].content.slice(0, 300))
  ck('v2 read: the payer choices are private, LTC, VA, Medicare GUIDE and CDS; Medicaid is never a payer', LAST_AI.body.tools[0].input_schema.properties.funding_source.enum.join() === ',private,ltc,va,guide,cds', LAST_AI.body.tools[0].input_schema.properties.funding_source.enum)
  reset(); AI = [{ content: [{ type: 'tool_use', name: 'fill_lead_form', input: { ...ANSWER, funding_source: 'medicaid', medicaid_mentioned: true } }] }]; r = await call({ action: 'read', message_id: 'msgAAA111' })
  ck('v2 read: a caller on Medicaid: no payer filled, flagged', !('funding_source' in r.j.prefill) && r.j.medicaid_mentioned === true, r.j.prefill.funding_source)
  reset(); AX_FAIL = true; r = await call({ action: 'read', message_id: 'msgAAA111' })
  ck('v2 read: AxisCare\'s list unreadable: the form and the draft still come back, no tasks, and it says why', r.status === 200 && r.j.prefill.client_city === 'Nixa' && !r.j.care_plan.axiscare_tasks.length && /could not be read/.test(r.j.tasks_note), r.j.tasks_note)
  ck('v2 read: AxisCare is only ever read (one GET of its task list)', CALLS.filter((u) => u.includes('axiscare')).every((u) => u.includes('/api/adls')))
  const pf = r.j.profile || {}
  ck('v3 read: Home & Life held to the Hub\'s choices (facility, preferred name, what changed, allergies), the checklist as yes / preferred', pf.facts.living_situation === 'facility' && pf.facts.facility_name === 'Elfdale assisted living, Apex'
     && pf.facts.preferred_name === 'Maggie' && pf.facts.why_now.join() === 'fall' && pf.facts.allergies === 'Penicillin' && pf.attributes.dogs === 'yes' && !('cats' in pf.attributes)
     && pf.attributes.smoking === 'no' && pf.attributes.female_caregiver === 'preferred' && !('spanish_speaking' in pf.attributes), pf)
  ck('v3 read: the other people named (not the caller), no repeats, no blanks', pf.people.length === 1 && pf.people[0].relationship === 'Boyfriend' && /get in the way/.test(pf.people[0].note), pf.people)

  /* read_lead: a lead that already exists, from all its calls */
  reset(); r = await call({ action: 'read_lead', lead_id: 'L1' }, 'cg'); ck('read_lead: a caregiver sign-in is refused', r.status === 403 && !CALLS.length, r)
  reset(); WRITES = 0; r = await call({ action: 'read_lead', lead_id: 'L1' })
  const both = LAST_AI.body.messages[0].content
  ck('read_lead: every answered call of the lead\'s own GoHighLevel contact, read together, oldest first, newest named', r.status === 200 && /These are every call[\s\S]*=== Call on 2026-10-13[\s\S]*First call words[\s\S]*=== Call on 2026-10-14 \(Wednesday\), we called them, 2 min ===[\s\S]*Second call words/.test(both), both.slice(0, 600))
  ck('read_lead: the calls come back newest first (missed calls and texts left out), the newest as the call', r.j.calls.map((c) => c.message_id).join() === 'callNEW02,callOLD01' && r.j.call.message_id === 'callNEW02' && r.j.prefill.client_city === 'Nixa', r.j.calls)
  ck('read_lead: writes nothing', WRITES === 0 && !CALLS.some((u) => u.endsWith('/tags')))
  reset(); r = await call({ action: 'read_lead', lead_id: 'L3' }); ck('read_lead: a lead with no GoHighLevel contact says so', r.status === 409 && /no GoHighLevel contact/.test(r.j.error), r.j)
  reset(); r = await call({ action: 'read_lead', lead_id: 'nope' }); ck('read_lead: an unknown lead is refused', r.status === 404, r.j)
  reset(); r = await call({ action: 'read_lead', lead_id: 'L2' }); ck('read_lead: no answered call found: says so, AI never asked', r.status === 200 && r.j.transcript === false && /No answered call/.test(r.j.note) && !CALLS.some((u) => u.includes('anthropic')), r.j)
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
  /* 1058: the form is no longer strict, so the code's own checks are the only guard. Junk from the AI never gets through. */
  const CLx = await import(path.join(process.cwd(), 'supabase/functions/_shared/call-lead.ts'))
  const junk = CLx.toPrefill({ needs: 'personalCare', safety: ['fallRisk', 'falls'], schedule_days: ['Mon', 'Funday'], number_of_hours: 'twenty', funding_source: 'medicaid',
    client_state: 'Missouri', client_zip: '657', client_dob: 'March 2', mobility: 'cane', desired_start_kind: 'by_date', desired_start_date: 'soon', relationship: 42, email_heard: 'not an email',
    care_plan: 'nope', home_life: null, people: 'Mark' }, { first_name: '', last_name: '', phone: '', email: '' }, [])
  const jp = junk.prefill
  ck('1058 not strict: wrong types and unknown choices are dropped, never saved', !('needs' in jp) && JSON.stringify(jp.safety) === '["fallRisk"]' && JSON.stringify(jp.schedule_days) === '["Mon"]'
     && !('number_of_hours' in jp) && !('funding_source' in jp) && !('client_state' in jp) && !('client_zip' in jp) && !('client_dob' in jp) && !('mobility' in jp) && jp.desired_start_kind === 'planning' && !('desired_start_date' in jp)
     && jp.relationship === '42' && !('email' in jp && jp.email) && Object.keys(junk.care_plan.fields).length === 0 && junk.profile.people.length === 0, jp)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
