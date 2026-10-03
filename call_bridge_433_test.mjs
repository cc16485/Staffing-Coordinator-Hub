// 433 · "Call rings your phone first" (GoHighLevel call bridge) under Node: the REAL ghl-call-link (with the real staff
// check), clockin-alert and late-alert, and the real _shared/ghl-call-bridge.ts, against a stand-in database, a
// controllable clock and a FAKE GoHighLevel that records every request. Nothing real is called or sent.
// node call_bridge_433_test.mjs
import fs from 'fs'; import path from 'path';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)]);
const FN = 'supabase/functions'
let NOW = Date.now(); const realNow = Date.now; Date.now = () => NOW
const tick = (sec) => { NOW += sec * 1000 }
const LOC = 'Recp0AhyMh8lrtKJ9kaj', SVC = 'svc_' + 'k'.repeat(60), JOBSEC = 'j'.repeat(64)

/* ── the stand-in database ── */
let APP, T, FAIL_INSERT = false
const reset = () => {
  APP = { ops_settings: { coverage_alert_admins: ['sam@mo-care.com', 'kry@mo-care.com'] },
    coordinator_staff: [{ email: 'sam@mo-care.com', name: 'Samantha T', phone: '4175550901' }, { email: 'kry@mo-care.com', name: 'Krystal L', phone: '4175550902' },
                        { email: 'kat@cc.test', name: 'Kat W', phone: '4175550903' }],
    caregivers: [{ id: 1, first: 'Maria', last: 'Lopez', phone: '4175550111', axiscare_id: '501', active: true }],
    timekeeper_cases: [{ id: 'tk_9001', visit_id: '9001', caregiver: 'Maria Lopez', caregiver_axiscare_id: '501', client_first: 'Ruth', client_axiscare_id: '701',
      shift_date: new Date(NOW).toISOString().slice(0, 10), shift_time: '09:00', texted_at: null, admin_loop: { sends: [] } }] }
  T = { op_events: [], person_source_id: [],
    auth_identities: [{ auth_user_id: 'u1', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p1' }, { auth_user_id: 'u2', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p2' },
                      { auth_user_id: 'u5', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p5' }],
    persons: [{ person_id: 'p1', full_name: 'Kat W', active: true }, { person_id: 'p2', full_name: 'Krystal L', active: true }, { person_id: 'p5', full_name: 'Cg', active: true }],
    entity_memberships: ['p1', 'p2', 'p5'].map((p) => ({ person_id: p, entity: 'cc_ihs', active: true, ended_at: null })),
    staff_roles: [{ person_id: 'p1', entity: 'cc_ihs', role: 'care_coordinator' }, { person_id: 'p2', entity: 'cc_ihs', role: 'staffing_coordinator' }, { person_id: 'p5', entity: 'cc_ihs', role: 'caregiver' }],
    late_notices: [{ id: 5, visit_id: '9001', caregiver_name: 'Maria Lopez', axiscare_caregiver_id: '501', axiscare_client_id: '701', client_first: 'Ruth',
      shift_start: new Date(NOW).toISOString(), shift_date: new Date(NOW).toISOString().slice(0, 10), status: 'open', kind: 'late', said: [], family: [] }] }
  FAIL_INSERT = false
}
const q = (t) => { const st = { f: [], desc: null, lim: null, single: false }; const b = {
  select() { return b; }, in() { return b; }, is() { return b; }, neq() { return b; }, lte() { return b; }, not() { return b; },
  eq(c, v) { st.f.push((r) => String(r[c]) === String(v)); return b; },
  gte(c, v) { st.f.push((r) => String(r[c]) >= String(v)); return b; },
  order(c, o) { st.desc = o && o.ascending === false ? c : null; return b; }, limit(n) { st.lim = n; return b; },
  maybeSingle() { st.single = true; return b; },
  update() { return { eq: async () => ({ error: null }) }; },
  insert(row) { if (FAIL_INSERT && t === 'op_events') return Promise.resolve({ data: null, error: { message: 'down' } });
    (T[t] ||= []).push({ at: new Date(NOW).toISOString(), ...row }); return Promise.resolve({ data: row, error: null }); },
  then(ok, bad) {
    if (t === 'app_data') { const want = []; const probe = { key: '' }; for (const f of st.f) for (const k of Object.keys(APP)) if (f({ key: k })) want.push(k)
      const k = want[0]; const row = k ? { key: k, data: JSON.parse(JSON.stringify(APP[k])) } : null
      return Promise.resolve({ data: st.single ? row : row ? [row] : [], error: null }).then(ok, bad) }
    let rows = (T[t] ?? []).filter((r) => st.f.every((f) => f(r)))
    if (st.desc) rows = rows.slice().sort((a, b2) => String(b2[st.desc]).localeCompare(String(a[st.desc])))
    if (st.lim != null) rows = rows.slice(0, st.lim)
    return Promise.resolve({ data: st.single ? (rows[0] ?? null) : rows, error: null }).then(ok, bad)
  } }; return b; };
const USERS = { kat: { id: 'u1', email: 'kat@cc.test', app_metadata: { hub_access: ['care_coordinator'] } }, kry: { id: 'u2', email: 'kry@mo-care.com', app_metadata: {} },
                cg: { id: 'u5', email: 'z@cc.test', app_metadata: {} } }
let RPCS = []
globalThis.__db = { from: q, auth: { getUser: async (jwt) => USERS[jwt] ? { data: { user: USERS[jwt] }, error: null } : { data: null, error: { message: 'bad jwt' } } },
  rpc: async (fn, a) => { RPCS.push([fn, a]); if (fn === 'upsert_app_data_item') { const arr = (APP[a.target_key] ||= []); const i = arr.findIndex((x) => x.id === a.item.id); const it = JSON.parse(JSON.stringify(a.item)); if (i >= 0) arr[i] = it; else arr.push(it) } return { data: null, error: null } } }

/* ── fake GoHighLevel ── */
let G, CALLS
const resetGhl = () => {
  G = { usersMode: 'ok', users: [{ id: 'uKat', email: 'Kat@cc.test' }, { id: 'uSam', email: 'sam@mo-care.com' }, { id: 'uGone', email: 'old@cc.test', deleted: true }],
    wf: 'published', putStatus: 200, tagStatus: 200, delStatus: 200, getStatus: 200,
    contacts: [{ id: 'gRuth', firstName: 'Ruth', lastName: 'Adams', phone: '+14175550777', tags: ['client'], assignedTo: 'uOld' },
               { id: 'gMaria', firstName: 'Maria', phone: '+14175550111', tags: [], assignedTo: null }] }
  CALLS = []
}
globalThis.fetch = async (url, o) => { url = String(url); const m = (o && o.method) || 'GET'; const body = o && o.body ? JSON.parse(o.body) : null
  if (url.includes('axiscare.com/api/clients')) return new Response(JSON.stringify({ results: { clients: [{ id: 701, homePhone: '4175550777' }] } }), { status: 200 })
  if (!url.includes('leadconnectorhq.com')) return new Response('{}', { status: 404 })
  CALLS.push({ m, url, body })
  if (/\/users\/\?/.test(url)) return G.usersMode === 'ok' ? new Response(JSON.stringify({ users: G.users }), { status: 200 }) : new Response('{"message":"x"}', { status: G.usersMode === 'no_scope' ? 401 : 500 })
  if (/\/workflows\/\?/.test(url)) {
    if (G.wf === 'forbidden') return new Response('{}', { status: 403 })
    const wf = [{ id: 'w0', name: 'New lead', status: 'published' }]
    if (G.wf === 'published' || G.wf === 'draft') wf.push({ id: 'w1', name: 'Hub call bridge', status: G.wf })
    return new Response(JSON.stringify({ workflows: wf }), { status: 200 }) }
  if (/\/contacts\/\?/.test(url)) { const qq = new URL(url).searchParams.get('query') || ''
    return new Response(JSON.stringify({ contacts: G.contacts.filter((c) => (c.phone && c.phone.replace(/\D/g, '').endsWith(qq)) || (c.email && c.email.toLowerCase() === qq.toLowerCase())) }), { status: 200 }) }
  const tg = url.match(/\/contacts\/([^/?]+)\/tags$/)
  if (tg) { const c = G.contacts.find((x) => x.id === tg[1])
    if (m === 'POST') { if (G.tagStatus !== 200) return new Response('{}', { status: G.tagStatus }); for (const t of body.tags) if (!c.tags.includes(t)) c.tags.push(t); return new Response('{}', { status: 200 }) }
    if (m === 'DELETE') { if (G.delStatus !== 200) return new Response('{}', { status: G.delStatus }); c.tags = c.tags.filter((t) => !body.tags.includes(t)); return new Response('{}', { status: 200 }) } }
  const one = url.match(/\/contacts\/([^/?]+)$/)
  if (one) { const c = G.contacts.find((x) => x.id === one[1])
    if (m === 'GET') return G.getStatus === 200 && c ? new Response(JSON.stringify({ contact: JSON.parse(JSON.stringify(c)) }), { status: 200 }) : new Response('{}', { status: G.getStatus === 200 ? 404 : G.getStatus })
    if (m === 'PUT') { if (G.putStatus !== 200) return new Response('{}', { status: G.putStatus }); Object.assign(c, body); return new Response(JSON.stringify({ contact: c }), { status: 200 }) } }
  return new Response('{}', { status: 404 }) }

/* ── load the real functions ── */
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SVC, GHL_TOKEN: 'g', GHL_LOCATION_ID: LOC, HUB_JOB_SECRET: JOBSEC, AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
let STAFF = null
fs.writeFileSync(`${FN}/_shared/_staff-auth_433.ts`, "export const OFFICE_ROLES = ['owner_admin']\nexport const requireStaff = async () => globalThis.__staff()\nexport const serverSecretOk = () => false\n")
process.on('exit', () => { try { fs.unlinkSync(`${FN}/_shared/_staff-auth_433.ts`) } catch { /* */ } })
globalThis.__staff = () => STAFF ?? { ok: false, status: 401, error: 'Sign in first.' }
const load = async (name, stubStaff) => {
  let src = fs.readFileSync(`${FN}/${name}/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  if (stubStaff) src = src.replace(/(['"])\.\.\/_shared\/staff-auth\.ts\1/, "'../_shared/_staff-auth_433.ts'")
  const tmp = path.join(process.cwd(), FN, name, '_t433.ts'); fs.writeFileSync(tmp, src)
  try { await import(tmp + '?' + Math.random()); return handler } finally { fs.unlinkSync(tmp) }
}
const LINK = await load('ghl-call-link', false), CA = await load('clockin-alert', false), LA = await load('late-alert', true)
const CL = await import(path.join(process.cwd(), FN, '_shared/clockin-links.ts'))
const LL = await import(path.join(process.cwd(), FN, '_shared/late-links.ts'))
const post = async (h, body, auth) => { const r = await h(new Request('https://x/f', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + auth } : {}) }, body: JSON.stringify(body) })); return { s: r.status, j: await r.json().catch(() => null) } }
const writes = () => CALLS.filter((c) => c.m !== 'GET')
const bridged = () => T.op_events.filter((e) => e.verb === 'call_bridge')
const RUTH = { action: 'bridge', phone: '(417) 555-0777' }

/* ── 1 · who may start a call ── */
reset(); resetGhl()
let p = await post(LINK, RUTH); ck('no sign-in: refused, GoHighLevel never asked', p.s === 401 && !CALLS.length, p)
p = await post(LINK, RUTH, 'anon-key'); ck('the public key: refused, GoHighLevel never asked', p.s === 401 && !CALLS.length, p)
p = await post(LINK, RUTH, 'cg'); ck('a signed-in person without an office role: refused, GoHighLevel never asked', p.s === 403 && !CALLS.length, p)
p = await post(LINK, RUTH, SVC); ck('the server key (anything automatic) can NEVER start a call', p.s === 403 && /person tapping Call/.test(p.j.error) && !CALLS.length, p)
ck('nothing was recorded or changed by the refusals', !T.op_events.length && !writes().length)

/* ── 2 · the tap that works ── */
reset(); resetGhl()
p = await post(LINK, RUTH, 'kat')
ck('a tap: ok, ringing "you", the contact, the first name to connect to, and the fallback links', p.s === 200 && p.j.ok === true && p.j.ringing === 'you' && p.j.contact_id === 'gRuth' && p.j.name === 'Ruth'
   && p.j.app_url === `https://app.leadconnectorhq.com/v2/location/${LOC}/contacts/detail/gRuth` && p.j.web_url === `https://app.hirecara.com/v2/location/${LOC}/contacts/detail/gRuth`, p.j)
ck('her GoHighLevel user was found by her email in GoHighLevel\'s user list (case ignored)', CALLS.some((c) => /\/users\/\?locationId=/.test(c.url)) && G.contacts[0].assignedTo === 'uKat', G.contacts[0])
const W1 = writes()
ck('exactly two writes: PUT the contact with ONLY assignedTo, then add the tag hub-call-bridge', W1.length === 2 && W1[0].m === 'PUT' && /\/contacts\/gRuth$/.test(W1[0].url) && JSON.stringify(W1[0].body) === '{"assignedTo":"uKat"}'
   && W1[1].m === 'POST' && /\/contacts\/gRuth\/tags$/.test(W1[1].url) && JSON.stringify(W1[1].body) === '{"tags":["hub-call-bridge"]}', W1)
ck('the contact was found by search only, and the workflow was checked, before any write', CALLS.findIndex((c) => c.m !== 'GET') > CALLS.findIndex((c) => /\/contacts\/\?/.test(c.url)) && CALLS.findIndex((c) => c.m !== 'GET') > CALLS.findIndex((c) => /\/workflows\//.test(c.url)), CALLS.map((c) => c.m + ' ' + c.url.replace(/^https:\/\/services\.leadconnectorhq\.com/, '')))
ck('never a create, upsert or message', !CALLS.some((c) => /upsert|conversations|\/contacts\/?$/.test(c.url) || (c.m === 'POST' && !/\/tags$/.test(c.url))), CALLS)
const E1 = bridged()[0]
ck('op_events: who, which contact, when, the previous owner and how she was linked', bridged().length === 1 && E1.actor_email === 'kat@cc.test' && E1.actor_name === 'Kat W' && E1.item_id === 'ghl:gRuth' && E1.at
   && E1.data.contact_id === 'gRuth' && E1.data.user_id === 'uKat' && E1.data.previous_assigned_to === 'uOld' && E1.data.user_via === 'gohighlevel' && E1.data.from === 'hub', E1)
ck('the user list is kept for next time (app_data ghl_users), deleted users left out', APP.ghl_users?.[0]?.users?.['kat@cc.test'] === 'uKat' && !('old@cc.test' in APP.ghl_users[0].users), APP.ghl_users)

/* ── 3 · one bridge per caller per 30 seconds ── */
CALLS = []; tick(10); p = await post(LINK, RUTH, 'kat')
ck('a second tap 10 seconds later: too_soon, about 20 seconds to wait, GoHighLevel not asked', p.j.ok === false && p.j.why === 'too_soon' && p.j.wait_sec === 20 && !CALLS.length && bridged().length === 1, p.j)
p = await post(LINK, RUTH, 'kry')
ck('another staff member is not held up by Kat\'s call (only no user linked for her yet)', p.j.ok === false && p.j.why === 'no_user', p.j)
CALLS = []; tick(21); G.contacts[0].tags = []; p = await post(LINK, RUTH, 'kat')
ck('31 seconds after the first: it goes again', p.j.ok === true && bridged().length === 2, p.j)
ck('the cached user list is used (no second users request)', !CALLS.some((c) => /\/users\//.test(c.url)), CALLS.map((c) => c.url))
ck('already assigned to her: no PUT, just the tag', !CALLS.some((c) => c.m === 'PUT') && CALLS.some((c) => c.m === 'POST' && /\/tags$/.test(c.url)), writes())

/* ── 4 · the tag trigger: re-adding a tag that is already on does not fire, so it is removed first ── */
CALLS = []; tick(31); G.contacts[0].tags = ['client', 'hub-call-bridge']
p = await post(LINK, RUTH, 'kat'); const W4 = writes()
ck('the tag was still on: DELETE it, then POST it (so "Contact Tag added" fires), tag_was_on reported', p.j.ok && p.j.tag_was_on === true && W4.length === 2 && W4[0].m === 'DELETE' && W4[1].m === 'POST'
   && JSON.stringify(W4[0].body) === '{"tags":["hub-call-bridge"]}' && G.contacts[0].tags.includes('hub-call-bridge'), W4)
CALLS = []; tick(31); G.contacts[0].tags = ['client', 'hub-call-bridge']; G.delStatus = 500; p = await post(LINK, RUTH, 'kat')
ck('the old tag cannot be removed: tag_failed with a visible message, the tag is not re-added blindly', p.j.ok === false && p.j.why === 'tag_failed' && /reset the call tag/.test(p.j.message) && !writes().some((c) => c.m === 'POST'), p.j)
G.delStatus = 200

/* ── 5 · the user mapping ── */
reset(); resetGhl(); CALLS = []; p = await post(LINK, RUTH, 'kry')
ck('her email is not one of GoHighLevel\'s users: no_user, the browser link still offered, nothing changed or recorded', p.j.ok === false && p.j.why === 'no_user' && p.j.web_url && !writes().length && !bridged().length, p.j)
CALLS = []; tick(60); p = await post(LINK, RUTH, 'kry')
ck('asked again within 5 minutes: the list is not fetched again', !CALLS.some((c) => /\/users\//.test(c.url)), CALLS.map((c) => c.url))
reset(); resetGhl(); G.usersMode = 'no_scope'; p = await post(LINK, RUTH, 'kat')
ck('the token may not list users: no_user, and the message says to link it in Settings, Calls', p.j.why === 'no_user' && /Settings, Calls/.test(p.j.message) && !writes().length, p.j)
APP.ops_settings.ghl_user_ids = { 'Kat@CC.test': 'uKatSet' }; CALLS = []; p = await post(LINK, RUTH, 'kat')
ck('the Settings map (ops_settings.ghl_user_ids) links her: it rings, assigned to that user, no users request', p.j.ok && G.contacts[0].assignedTo === 'uKatSet' && !CALLS.some((c) => /\/users\//.test(c.url)) && bridged().at(-1).data.user_via === 'settings', [p.j, CALLS.map((c) => c.url)])
reset(); resetGhl(); APP.ops_settings.ghl_user_ids = { 'kat@cc.test': 'uOverride' }; p = await post(LINK, RUTH, 'kat')
ck('the Settings map wins over GoHighLevel\'s list (her override)', p.j.ok && G.contacts[0].assignedTo === 'uOverride', G.contacts[0])
reset(); resetGhl(); APP.ops_settings.ghl_user_ids = { 'kat@cc.test': 'bad/../id' }; p = await post(LINK, RUTH, 'kat')
ck('a Settings value that is not a plain id is ignored (GoHighLevel\'s list is used)', p.j.ok && G.contacts[0].assignedTo === 'uKat', G.contacts[0])

/* ── 6 · the contact: exactly one, never created ── */
reset(); resetGhl(); G.contacts = []; p = await post(LINK, RUTH, 'kat')
ck('no contact: not_found, nothing created or changed, nothing recorded', p.j.ok === false && p.j.why === 'not_found' && !writes().length && !bridged().length, p.j)
reset(); resetGhl(); G.contacts.push({ id: 'gHus', firstName: 'Ed', phone: '(417) 555-0777', tags: [] }); p = await post(LINK, RUTH, 'kat')
ck('two contacts on the line: several (software never picks), nothing changed', p.j.why === 'several' && !writes().length, p.j)
reset(); resetGhl(); p = await post(LINK, { action: 'bridge', phone: '55' }, 'kat')
ck('no usable number: no_number, GoHighLevel contacts never searched', p.j.why === 'no_number' && !CALLS.some((c) => /\/contacts\//.test(c.url)), p.j)
reset(); resetGhl(); G.getStatus = 500; p = await post(LINK, RUTH, 'kat')
ck('the contact cannot be read: error with a message, nothing changed', p.j.why === 'error' && p.j.message && !writes().length, p.j)

/* ── 7 · the workflow ── */
reset(); resetGhl(); G.wf = 'missing'; p = await post(LINK, RUTH, 'kat')
ck('no "Hub call bridge" workflow in GoHighLevel: no_workflow, nothing changed or recorded', p.j.ok === false && p.j.why === 'no_workflow' && p.j.workflow === 'missing' && !writes().length && !bridged().length, p.j)
reset(); resetGhl(); G.wf = 'draft'; p = await post(LINK, RUTH, 'kat')
ck('the workflow is still a draft: no_workflow (draft)', p.j.why === 'no_workflow' && p.j.workflow === 'draft' && !writes().length, p.j)
reset(); resetGhl(); G.wf = 'forbidden'; p = await post(LINK, RUTH, 'kat')
ck('the token may not read workflows: it carries on (workflow unknown) and rings', p.j.ok === true && p.j.workflow === 'unknown', p.j)

/* ── 8 · errors are visible ── */
reset(); resetGhl(); G.putStatus = 422; p = await post(LINK, RUTH, 'kat')
ck('the assignment is refused: assign_failed with the reason, no tag added, a failure line in op_events', p.j.ok === false && p.j.why === 'assign_failed' && /would not assign Ruth to you \(422\)/.test(p.j.message)
   && !writes().some((c) => /\/tags$/.test(c.url)) && T.op_events.some((e) => e.verb === 'call_bridge_failed'), p.j)
reset(); resetGhl(); G.tagStatus = 400; p = await post(LINK, RUTH, 'kat')
ck('the tag is refused: tag_failed with the reason', p.j.why === 'tag_failed' && /would not start the call to Ruth \(400\)/.test(p.j.message), p.j)
reset(); resetGhl(); FAIL_INSERT = true; p = await post(LINK, RUTH, 'kat')
ck('the call cannot be recorded: refused BEFORE anything changes in GoHighLevel', p.j.why === 'error' && /nothing was changed/.test(p.j.message) && !writes().length, p.j)
reset(); resetGhl(); ENV.GHL_TOKEN = ''; p = await post(LINK, RUTH, 'kat'); ENV.GHL_TOKEN = 'g'
ck('GoHighLevel not set up: not_set_up, nothing asked', p.j.why === 'not_set_up' && !CALLS.length, p.j)

/* ── 9 · the old lookup and the setup check ── */
reset(); resetGhl(); p = await post(LINK, { phone: '4175550777' }, 'kat')
ck('no action: the 431 lookup, unchanged (found, GET only, nothing recorded)', p.j.found === true && p.j.contact_id === 'gRuth' && !writes().length && !bridged().length, p.j)
p = await post(LINK, { action: 'setup' }, 'kat')
ck('setup (staff): workflow published, users listed, who is linked (Samantha and Kat yes, Krystal no)', p.j.workflow === 'published' && p.j.users_api === 'ok' && p.j.users_count === 2
   && p.j.staff.find((s) => s.email === 'kat@cc.test').linked && !p.j.staff.find((s) => s.email === 'kry@mo-care.com').linked && p.j.staff_linked === 2 && p.j.staff_total === 3, p.j)
ck('setup asks GoHighLevel with GETs only', !writes().length, writes())
p = await post(LINK, { action: 'setup' }, SVC)
ck('setup (server key, the installer): counts only, no names or emails', p.s === 200 && p.j.staff_linked === 2 && p.j.staff_total === 3 && !('staff' in p.j) && !/@/.test(JSON.stringify(p.j)), p.j)
G.wf = 'missing'; p = await post(LINK, { action: 'setup' }, SVC); ck('setup shows a missing workflow', p.j.workflow === 'missing', p.j)
p = await post(LINK, { action: 'nope' }, 'kat'); ck('an unknown action is refused', p.s === 400, p)

/* ── 10 · the missed clock-in link page (an admin's sealed link, no sign-in) ── */
reset(); resetGhl()
const cl = async (email) => Object.fromEntries(new URL(await CL.makeLink(JOBSEC, 'tk_9001', email, CL.linkExpiry(APP.timekeeper_cases[0].shift_date))).searchParams)
let L = await cl('sam@mo-care.com')
p = await post(CA, { ...L, action: 'bridge', target: 'client' })
ck('clockin page: "Call Ruth\'s home" rings the admin named in the link (sam -> her GoHighLevel user)', p.s === 200 && p.j.ok && p.j.name === 'Ruth' && G.contacts[0].assignedTo === 'uSam', [p, G.contacts[0]])
ck('clockin page: recorded as Samantha, from the missed clock-in link', bridged().at(-1).actor_email === 'sam@mo-care.com' && bridged().at(-1).data.from === 'clockin-link', bridged().at(-1))
tick(31); p = await post(CA, { ...L, action: 'bridge', target: 'caregiver' })
ck('clockin page: "Call Maria" rings her phone and connects to Maria', p.j.ok && p.j.contact_id === 'gMaria' && p.j.name === 'Maria' && G.contacts[1].assignedTo === 'uSam', p.j)
tick(5); p = await post(CA, { ...L, action: 'bridge', target: 'client' }); ck('clockin page: the same 30-second limit', p.j.why === 'too_soon', p.j)
p = await post(CA, { ...L, action: 'bridge', target: 'family' }); ck('clockin page: only client or caregiver', p.s === 400, p)
CALLS = []; p = await post(CA, { ...L, t: L.t.slice(0, -1) + (L.t.endsWith('A') ? 'B' : 'A'), action: 'bridge', target: 'client' })
ck('clockin page: a forged link is refused and GoHighLevel is never asked', p.s === 401 && !CALLS.length, p)
const LK = await cl('kry@mo-care.com'); tick(31); p = await post(CA, { ...LK, action: 'bridge', target: 'client' })
ck('clockin page: an admin with no GoHighLevel user: no_user (the page shows Settings, Calls)', p.j.why === 'no_user', p.j)
APP.timekeeper_cases[0].resolved_at = new Date(NOW).toISOString(); tick(31); p = await post(CA, { ...L, action: 'bridge', target: 'client' })
ck('clockin page: a resolved alert can still call', p.j.ok === true, p.j)

/* ── 11 · the running-late link page and card ── */
reset(); resetGhl()
const ll = Object.fromEntries(new URL(await LL.makeLink(JOBSEC, 'ln_5', 'sam@mo-care.com', LL.linkExpiry(T.late_notices[0].shift_date))).searchParams)
p = await post(LA, { ...ll, action: 'bridge', target: 'client' })
ck('late page: rings the admin named in the link, connects to Ruth', p.s === 200 && p.j.ok && p.j.name === 'Ruth' && bridged().at(-1).data.from === 'late-link' && G.contacts[0].assignedTo === 'uSam', p)
STAFF = { ok: true, person_id: 'p1', name: 'Kat W', email: 'kat@cc.test', roles: ['owner_admin'] }
p = await post(LA, { id: 5, action: 'bridge', target: 'caregiver' })
ck('late card (signed in): rings the signed-in person (Kat), connects to Maria', p.j.ok && p.j.contact_id === 'gMaria' && G.contacts[1].assignedTo === 'uKat' && bridged().at(-1).data.from === 'hub', p.j)
STAFF = null; CALLS = []; p = await post(LA, { id: 5, action: 'bridge', target: 'client' })
ck('late: no link and no sign-in is refused, GoHighLevel never asked', p.s === 401 && !CALLS.length, p)

/* ── 12 · the source ── */
{ const lib = fs.readFileSync(`${FN}/_shared/ghl-call-bridge.ts`, 'utf8'), look = fs.readFileSync(`${FN}/_shared/ghl-contact-link.ts`, 'utf8').replace(/^\s*\/\/.*$/gm, '')
  const fns = ['ghl-call-link', 'clockin-alert', 'late-alert'].map((f) => fs.readFileSync(`${FN}/${f}/index.ts`, 'utf8')).join('\n')
  ck('source · the only PUT body is { assignedTo }', (lib.match(/method: 'PUT'/g) || []).length === 1 && /JSON\.stringify\(\{ assignedTo: user\.id \}\)/.test(lib))
  ck('source · the bridge never upserts, creates or sends', !/upsert'|contacts\/upsert|conversations|contactForOutbound|\/contacts\/'\s*,\s*\{\s*method: 'POST'/.test(lib.replace(/upsert_app_data_item/g, '')))
  ck('source · the 431 lookup is still read only', !/method: '(POST|PUT|DELETE)'|upsert|conversations\/messages/.test(look))
  ck('source · no em dash', !/\u2014/.test(lib + fns)) }

let pass = 0; for (const [nm, ok, note] of res) { console.log((ok ? 'PASS ' : 'FAIL ') + nm + (ok ? '' : '\n     ' + note)); if (ok) pass++ }
Date.now = realNow
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
