// care-packet (caregiver packets, Step 1, 2026-10-12). The REAL function, the REAL staff check and the REAL link helper,
// against a fake database. node care_packet_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)])
const SECRET = 'x'.repeat(40)
let T, EVENTS, FAIL, SENT, GHL_FAIL, CALLS, VISITS = [], AX_FAIL = false, AI_ANSWER = null, AI_SEEN = []
const TOPICS = () => [
  { key: 'turning', title: 'Turning and repositioning', notes: 'Turn every 2 hours.', active: true, videos: [{ title: 'Lie on the side', url: 'https://www.youtube.com/watch?v=6M5_eTPUWpo', publisher: 'The Hospice Care Plan', minutes: 5 }] },
  { key: 'purewick_male', title: 'PureWick (male)', notes: 'Check it every 2 hours.', active: true, videos: [{ title: 'PureWick Male in-service', url: 'https://vimeo.com/968970613', publisher: 'BD', minutes: 6 }, { title: 'IFU', url: 'https://example.com/ifu.pdf' }] },
  { key: 'old', title: 'Retired topic', notes: '', active: false, videos: [] }]
const reset = () => { EVENTS = []; FAIL = null; SENT = []; GHL_FAIL = false; CALLS = []; T = {
  care_topics: TOPICS(), care_packets: [], care_packet_recipients: [], care_packet_acks: [],
  app_data: [{ key: 'caregivers', data: [{ first: 'Ariel', last: 'Smith', axiscare_id: '11', phone: '4175550101' }, { first: 'Opal', last: 'Out', axiscare_id: '22', phone: '4175550202' }, { first: 'Nora', last: 'Nophone', axiscare_id: '33' }, { first: 'Twin', last: 'One', axiscare_id: '99' }, { first: 'Twin', last: 'Two', axiscare_id: '99' }] },
    { key: 'ops_settings', data: { care_packet_send_live: true } }, { key: 'ops_items', data: [] }],
  contact_optout_current: [{ address: '+14175550202', channel: 'sms', opted_out: true, source: 'stop_text' }], phone_index: [], circle_contacts: [],
  auth_identities: [{ auth_user_id: 'u-kr', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p-kr' }, { auth_user_id: 'u-sa', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p-sa' }, { auth_user_id: 'u-cg', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p-cg' }],
  persons: [{ person_id: 'p-kr', full_name: 'Krystal Office', active: true }, { person_id: 'p-sa', full_name: 'Samantha Owner', active: true }, { person_id: 'p-cg', full_name: 'Cara Giver', active: true }],
  entity_memberships: ['p-kr', 'p-sa', 'p-cg'].map((p) => ({ person_id: p, entity: 'cc_ihs', active: true, ended_at: null })),
  staff_roles: [{ person_id: 'p-kr', entity: 'cc_ihs', role: 'care_coordinator' }, { person_id: 'p-sa', entity: 'cc_ihs', role: 'owner_admin' }, { person_id: 'p-cg', entity: 'cc_ihs', role: 'caregiver' }],
  op_events: [] } }
const clone = (x) => JSON.parse(JSON.stringify(x))
const q = (t) => { const st = { f: [], op: 'select', row: null, sel: false }; const run = () => {
    if (FAIL === t) return { data: null, error: { message: 'down' } }
    const rows = T[t] ?? (T[t] = []); const match = (r) => st.f.every(([c, v]) => r[c] === v)
    if (st.op === 'insert') { const add = (Array.isArray(st.row) ? st.row : [st.row]).map((r) => ({ id: r.id ?? (t === 'care_packets' ? crypto.randomUUID() : rows.length + 1), ...r }))
      if (t === 'op_events') EVENTS.push(...add); rows.push(...add); return { data: clone(add), error: null } }
    if (st.op === 'update') { const hit = rows.filter(match); hit.forEach((r) => Object.assign(r, st.row)); return { data: clone(hit), error: null } }
    if (st.op === 'upsert') { const r = rows.find((x) => x.key === st.row.key); if (r) Object.assign(r, st.row); else rows.push({ ...st.row }); return { data: null, error: null } }
    return { data: clone(rows.filter(match)), error: null } }
  const b = { select() { st.sel = true; return b }, eq(c, v) { st.f.push([c, v]); return b }, limit() { return b }, order() { return b }, in() { return b }, not() { return b }, or() { return b }, gte() { return b }, is() { return b }, neq() { return b },
    insert(r) { st.op = 'insert'; st.row = r; return b }, update(r) { st.op = 'update'; st.row = r; return b }, upsert(r) { st.op = 'upsert'; st.row = r; return b },
    maybeSingle() { const r = run(); return Promise.resolve({ data: r.data ? r.data[0] ?? null : null, error: r.error }) },
    then(ok, no) { return Promise.resolve(run()).then(ok, no) } }; return b }
globalThis.__db = { from: q, rpc: async (fn, a) => { if (fn === 'upsert_app_data_item') { const row = T.app_data.find((r) => r.key === a.target_key); const i = row.data.findIndex((x) => x.id === a.item.id); if (i >= 0) row.data[i] = a.item; else row.data.push(a.item) } return { data: null, error: null } },
  auth: { getUser: async (jwt) => ({ kr: 'u-kr', sa: 'u-sa', cg: 'u-cg' })[jwt] ? { data: { user: { id: ({ kr: 'u-kr', sa: 'u-sa', cg: 'u-cg' })[jwt], email: jwt + '@mo-care.com', app_metadata: {} } }, error: null } : { data: { user: null }, error: { message: 'bad' } } } }
globalThis.fetch = async (url, o) => { url = String(url); CALLS.push(url); const body = o && o.body ? JSON.parse(o.body) : {}
  if (url.includes('api.anthropic.com')) { AI_SEEN.push(body); return AI_ANSWER == null ? new Response('{}', { status: 500 }) : new Response(JSON.stringify({ content: [{ type: 'text', text: AI_ANSWER }] }), { status: 200 }) }
  if (url.includes('axiscare.com/api/visits')) return AX_FAIL ? new Response('{}', { status: 500 }) : new Response(JSON.stringify({ results: { visits: VISITS, nextPage: null } }), { status: 200 })
  if (url.includes('/contacts/upsert')) return new Response(JSON.stringify({ contact: { id: 'C:' + body.phone, dnd: false } }), { status: 200 })
  if (url.includes('/conversations/messages')) { if (GHL_FAIL) return new Response('{"message":"nope"}', { status: 500 }); SENT.push({ to: body.contactId, text: body.message }); return new Response('{}', { status: 200 }) }
  return new Response('{}', { status: 404 }) }
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', HUB_JOB_SECRET: SECRET, GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', AXISCARE_TOKEN: 'ax', AXISCARE_SITE: '16485', ANTHROPIC_API_KEY: 'ak' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_cpk_'))
try {
  const src = fs.readFileSync(path.join(F, 'care-packet/index.ts'), 'utf8')
    .replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace(/from '\.\.\/_shared\/(\w[\w-]*)\.ts'/g, (_, m) => "from '" + (m === 'job-auth' ? path.join(tmp, '_job-auth.ts') : path.join(process.cwd(), F, '_shared', m + '.ts')) + "'")
  /* job-auth (the check's secret) loads a web library; a local copy uses the fake database instead, like the watch test */
  fs.writeFileSync(path.join(tmp, '_job-auth.ts'), fs.readFileSync(path.join(F, '_shared/job-auth.ts'), 'utf8')
    .replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace(/from '\.\/(\w[\w-]*)\.ts'/g, (_, m) => "from '" + path.join(process.cwd(), F, '_shared', m + '.ts') + "'"))
  fs.writeFileSync(path.join(tmp, 'care-packet.ts'), src)
  const M = await import(path.join(tmp, 'care-packet.ts'))
  const L = await import(path.join(process.cwd(), F, '_shared/packet-links.ts'))
  const call = async (body, jwt = 'kr', method = 'POST') => { const r = await handler(new Request('https://x/functions/v1/care-packet', { method,
    headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: 'Bearer ' + jwt } : {}) }, body: method === 'POST' ? JSON.stringify(body) : undefined }))
    let j = null; try { j = await r.json() } catch { /* */ } return { status: r.status, j, h: r.headers } }
  const linkParts = (link) => Object.fromEntries(new URL(link).searchParams)
  const save = (x = {}, jwt = 'kr') => call({ action: 'save', ax: '900', client_first: 'Dan', about: 'On hospice. Call hospice first.', items: [{ topic: 'turning', notes: 'Every 2 hours, left, back, right.' }], ready: true, base_version: null, ...x }, jwt)

  reset(); let r = await call(null, null, 'OPTIONS'); ck('browser preflight answered with CORS headers', r.h.get('access-control-allow-origin') === '*')
  ck('preflight allows the headers the Hub\'s callAction sends (x-cc-via), or every Hub call fails to fetch', /\bx-cc-via\b/.test(r.h.get('access-control-allow-headers') || '') && /\bauthorization\b/.test(r.h.get('access-control-allow-headers') || ''))
  reset(); r = await call({ action: 'get', ax: '900' }, null); ck('office action with no sign-in: refused (401)', r.status === 401, r)
  reset(); r = await call({ action: 'get', ax: '900' }, 'cg'); ck('a caregiver account (no office role): refused (403)', r.status === 403, r)
  reset(); r = await call({ action: 'get' }); ck('no client named: refused', r.status === 400, r)
  reset(); r = await call({ action: 'get', ax: '900' }); ck('get, no packet yet: null, active topics only (sorted), no recipients', r.status === 200 && r.j.packet === null && r.j.topics.map((t) => t.key).join() === 'purewick_male,turning' && r.j.recipients.length === 0, r.j)

  reset(); r = await save({ items: [{ topic: 'nope' }] }); ck('a topic not in the library: refused, nothing saved', r.status === 400 && !T.care_packets.length, r)
  reset(); r = await save({ items: [{ topic: 'old' }] }); ck('a retired topic: refused', r.status === 400, r)
  reset(); r = await save({ items: [] }); ck('ready with no topics: refused', r.status === 400 && !T.care_packets.length, r)
  reset(); r = await save({ about: 'Bed bound — turn him.<script>' })
  const p1 = T.care_packets[0]
  ck('first save: one packet, version 1, ready, keyed by AxisCare id, by the person signed in', r.status === 200 && p1 && p1.version === 1 && p1.ready && p1.client_key === 'ax:900' && p1.updated_by === 'kr@mo-care.com', r.j)
  ck('no em dash and no markup survive in what caregivers read', !/[—<>]/.test(p1.about) && p1.about.startsWith('Bed bound, turn him.'), p1.about)
  ck('the save is on the record (care_packet_saved, by a person)', EVENTS.some((e) => e.verb === 'care_packet_saved' && e.actor_email === 'kr@mo-care.com'), EVENTS)
  r = await save({ items: [{ topic: 'turning', notes: 'x' }, { topic: 'turning', notes: 'y' }], base_version: 1 })
  ck('a topic listed twice is kept once', T.care_packets[0].items.length === 1, T.care_packets[0].items)
  ck('changed notes: a new version (2)', T.care_packets[0].version === 2 && r.j.changed === true, r.j)
  r = await save({ items: [{ topic: 'turning', notes: 'x' }], base_version: 1 }); ck('saving over someone else\'s newer save: refused as stale, nothing changes', r.status === 409 && r.j.outcome === 'stale' && T.care_packets[0].version === 2, r)
  r = await save({ items: [{ topic: 'turning', notes: 'x' }], base_version: 2, about: T.care_packets[0].about }); ck('saving with nothing changed for caregivers: the version stays', T.care_packets[0].version === 2 && r.j.changed === false, r.j)

  // a lead becomes a client: the same packet is found, and keeps both ids
  reset(); await call({ action: 'save', lead_id: 'L7', client_first: 'Dan', about: '', items: [{ topic: 'turning', notes: '' }], ready: false, base_version: null })
  r = await call({ action: 'get', ax: '901', lead_id: 'L7' }); ck('a lead\'s packet is found once they have an AxisCare id', r.j.packet && r.j.packet.client_key === 'lead:L7', r.j)
  await call({ action: 'save', ax: '901', lead_id: 'L7', client_first: 'Dan', about: '', items: [{ topic: 'turning', notes: '' }], ready: false, base_version: 1 })
  ck('...and saving there fills in the AxisCare id', T.care_packets[0].axiscare_client_id === '901' && T.care_packets.length === 1, T.care_packets)

  // links
  reset(); await save({ ready: false }); const pid = T.care_packets[0].id
  r = await call({ action: 'link', packet_id: pid, caregiver_axiscare_id: '11' }); ck('no links while the packet is a draft', r.status === 409 && !T.care_packet_recipients.length, r)
  await save({ ready: true, base_version: 1 })
  r = await call({ action: 'link', packet_id: pid, caregiver_axiscare_id: '55' }); ck('a caregiver not on the roster by AxisCare id: refused', r.status === 422 && !T.care_packet_recipients.length, r)
  r = await call({ action: 'link', packet_id: pid, caregiver_axiscare_id: '99' }); ck('two roster entries with one AxisCare id: refused', r.status === 422, r)
  r = await call({ action: 'link', packet_id: pid, caregiver_axiscare_id: '11' })
  const L1 = r.j.link, rec = T.care_packet_recipients[0]
  ck('a link for Ariel: on cc.mo-care.com/packet.html, names a recipient row (not her name or phone), first name back for the copy text',
    r.status === 200 && L1.startsWith('https://cc.mo-care.com/packet.html?i=pl_') && !/ariel|smith|11&/i.test(L1.split('?')[1].replace(/&e=.*/, '')) && r.j.caregiver_first === 'Ariel' && rec.caregiver_name === 'Ariel Smith', r.j)
  ck('the link is on the record (care_packet_link)', EVENTS.some((e) => e.verb === 'care_packet_link'), EVENTS)
  r = await call({ action: 'link', packet_id: pid, caregiver_axiscare_id: '11' }); ck('a second link for Ariel reuses her row (one row per caregiver)', T.care_packet_recipients.length === 1 && linkParts(r.j.link).i === rec.id, T.care_packet_recipients)
  ENV.HUB_JOB_SECRET = 'short'; r = await call({ action: 'link', packet_id: pid, caregiver_axiscare_id: '11' }); ENV.HUB_JOB_SECRET = SECRET
  ck('no server secret: no link is made', r.status === 500, r)

  // the caregiver's page
  const P = linkParts(L1)
  r = await call({ action: 'view', ...P }, null); const v1 = r.j
  ck('view with her link, no sign-in: her first name, Dan, the notes and the videos', r.status === 200 && v1.caregiver_first === 'Ariel' && v1.client_first === 'Dan' && v1.items[0].title === 'Turning and repositioning' && v1.items[0].videos.length === 1 && !v1.acknowledged, v1)
  ck('a YouTube video plays on the page through the privacy-enhanced player', v1.items[0].videos[0].embed === 'https://www.youtube-nocookie.com/embed/6M5_eTPUWpo?rel=0', v1.items[0].videos[0])
  ck('opening the page records nothing', T.care_packet_acks.length === 0 && !T.care_packet_recipients[0].ack_at)
  r = await call({ action: 'view', ...P, t: P.t.slice(0, -1) + (P.t.endsWith('A') ? 'B' : 'A') }, null); ck('a changed link code: refused', r.status === 403, r)
  r = await call({ action: 'view', ...P, i: 'pl_' + 'A'.repeat(20) }, null); ck('another recipient id with her code: refused', r.status === 403, r)
  const old = { i: rec.id, e: 1000, t: (await L.makeLink(SECRET, rec.id, 1000)).split('t=')[1] }
  r = await call({ action: 'view', ...old }, null); ck('an expired link: refused', r.status === 403, r)
  r = await call({ action: 'ack', ...P, version: 99 }, null); ck('confirming a version that is not the current one: refused as changed', r.status === 409 && r.j.outcome === 'changed' && !T.care_packet_acks.length, r)
  r = await call({ action: 'ack', ...P, version: v1.version }, null)
  ck('"I watched it and understand": recorded once, on her row and the append-only list, on the record as her (employee, via link)',
    r.j.outcome === 'done' && T.care_packet_acks.length === 1 && T.care_packet_recipients[0].ack_version === v1.version &&
    EVENTS.some((e) => e.verb === 'care_packet_understood' && e.actor_kind === 'employee' && e.via === 'link' && e.actor_name === 'Ariel Smith'), { r, EVENTS })
  r = await call({ action: 'ack', ...P, version: v1.version }, null); ck('tapping again: "already", nothing added', r.j.outcome === 'already' && T.care_packet_acks.length === 1, r)
  r = await call({ action: 'view', ...P }, null); ck('her page now shows she confirmed', r.j.acknowledged === true && !!r.j.ack_at, r.j)
  // the office edits the packet: she is asked again
  await save({ about: 'Now changed in bed.', base_version: T.care_packets[0].version })
  r = await call({ action: 'view', ...P }, null); ck('after an edit: not confirmed for the new version, and told it was updated', r.j.acknowledged === false && r.j.earlier_ack === true, r.j)
  r = await call({ action: 'get', ax: '900' }); ck('the office sees she confirmed an older version only', r.j.recipients[0].ack_version !== r.j.packet.version && r.j.recipients[0].ack_version != null, r.j)
  await save({ about: 'Now changed in bed.', ready: false, base_version: T.care_packets[0].version })
  r = await call({ action: 'view', ...P }, null); ck('a packet marked not ready: her page says it is being updated', r.status === 409, r)

  // the library: owner only
  reset(); r = await call({ action: 'topic_save', key: 'commode', title: 'Bedside commode', videos: [] }); ck('a care coordinator cannot change the library', r.status === 403, r)
  r = await call({ action: 'topic_save', key: 'commode', title: 'Bedside commode', videos: [{ title: 'x', url: 'http://insecure.example/v' }] }, 'sa'); ck('an http (not https) video: refused', r.status === 400, r)
  r = await call({ action: 'topic_save', key: 'Bad Key', title: 'x' }, 'sa'); ck('a bad topic key: refused', r.status === 400, r)
  r = await call({ action: 'topic_save', key: 'commode', title: 'Bedside commode', notes: 'Lock the wheels — always.', videos: [{ title: 'Pivot to commode', url: 'https://www.youtube.com/watch?v=FpAHPstotL0', publisher: 'Hospice of the Piedmont', minutes: '4' }] }, 'sa')
  const tc = T.care_topics.find((t) => t.key === 'commode')
  ck('the owner adds a topic: saved, no em dash, minutes a number', r.status === 200 && tc && !/—/.test(tc.notes) && tc.videos[0].minutes === 4, { r, tc })


  // ---------------- Step 2: texting the packet ----------------
  const ready = async () => { reset(); await save(); return T.care_packets[0].id }
  const sendTo = (pid, ax = '11', id = 'send-0001-abcd', jwt = 'kr') => call({ action: 'send', packet_id: pid, caregiver_axiscare_id: ax, send_id: id }, jwt)
  let pid2 = await ready()
  r = await call({ action: 'send_draft', packet_id: pid2, caregiver_axiscare_id: '11' })
  ck('draft: the exact first text with "(their link)", phone last 4, not opted out, nothing sent and no row made',
    r.status === 200 && r.j.kind === 'first' && r.j.text.startsWith("Hi Ariel, it's Caring Companions. Before you work with Dan, please watch this short care packet and tap I understand: (their link)") && /Reply STOP to opt out\.$/.test(r.j.text) && r.j.phone_last4 === '0101' && r.j.opted_out === false && !SENT.length && !T.care_packet_recipients.length, r.j)
  ck('the texts carry no health words (only the first name and the link)', !/hospice|catheter|purewick|cancer|bed ?sore|commode|brief/i.test(['first', 'reminder', 'updated'].map((k) => M.packetText(k, 'Ariel', 'Dan', 'L')).join(' ')))
  ck('no em dash in any of the three texts', !/[—―]/.test(['first', 'reminder', 'updated'].map((k) => M.packetText(k, 'Ariel', 'Dan', 'L')).join(' ')))
  r = await call({ action: 'send_draft', packet_id: pid2, caregiver_axiscare_id: '22' }); ck('draft for an opted-out caregiver says so', r.j.opted_out === true, r.j)
  r = await sendTo(pid2, '11', 'send-0001-abcd', null); ck('send with no sign-in: refused (401), nothing sent', r.status === 401 && !SENT.length, r)
  r = await sendTo(pid2, '11', 'send-0001-abcd', 'cg'); ck('send from a caregiver account: refused (403), nothing sent', r.status === 403 && !SENT.length, r)
  T.app_data.find((x) => x.key === 'ops_settings').data.care_packet_send_live = false
  r = await sendTo(pid2); ck('switch off: refused (409) with "use Get their link", nothing sent', r.status === 409 && r.j.outcome === 'off' && /Get their link/.test(r.j.error) && !SENT.length && !CALLS.length, r)
  T.app_data.find((x) => x.key === 'ops_settings').data.care_packet_send_live = true
  r = await sendTo(pid2, '11', 'bad id'); ck('a malformed send id: refused', r.status === 400 && !SENT.length, r)
  r = await sendTo(pid2)
  const rc = T.care_packet_recipients[0]
  ck('send: ONE text to Ariel\'s roster number with her own link, recorded on her row (first, by who, count 1), on the record',
    r.j.outcome === 'sent' && SENT.length === 1 && SENT[0].to === 'C:+14175550101' && SENT[0].text.includes('https://cc.mo-care.com/packet.html?i=' + rc.id) &&
    rc.last_send_kind === 'first' && rc.last_sent_by === 'kr@mo-care.com' && rc.send_count === 1 && EVENTS.some((e) => e.verb === 'care_packet_sent'), { r: r.j, rc, SENT })
  const lk = Object.fromEntries(new URL(SENT[0].text.match(/https:\S+/)[0]).searchParams)
  r = await call({ action: 'view', ...lk }, null); ck('the link in the text opens her packet', r.status === 200 && r.j.caregiver_first === 'Ariel', r)
  r = await sendTo(pid2); ck('the same send pressed twice: "already_sent", one text only', r.j.outcome === 'already_sent' && SENT.length === 1, r.j)
  r = await call({ action: 'send_draft', packet_id: pid2, caregiver_axiscare_id: '11' }); ck('after the first text, the next one is a reminder', r.j.kind === 'reminder' && r.j.text.includes('a reminder from Caring Companions'), r.j)
  r = await sendTo(pid2, '11', 'send-0002-abcd'); ck('remind: a second text (reminder), count 2', r.j.outcome === 'sent' && SENT.length === 2 && T.care_packet_recipients[0].send_count === 2 && T.care_packet_recipients[0].last_send_kind === 'reminder', r.j)
  await call({ action: 'ack', ...lk, version: T.care_packets[0].version }, null)
  r = await sendTo(pid2, '11', 'send-0003-abcd'); ck('she confirmed this version: nothing to send (409), no text', r.status === 409 && r.j.outcome === 'confirmed' && SENT.length === 2, r)
  await save({ about: 'Changed', base_version: T.care_packets[0].version })
  r = await call({ action: 'send_draft', packet_id: pid2, caregiver_axiscare_id: '11' }); ck('after an edit, her text is the "updated" one', r.j.kind === 'updated' && /was updated/.test(r.j.text), r.j)
  r = await sendTo(pid2, '22', 'send-0004-abcd')
  ck('an opted-out caregiver: refused with the reason, nothing sent, on the record', r.status === 422 && r.j.outcome === 'refused' && /asked not to get texts/.test(r.j.error) && SENT.length === 2 && EVENTS.some((e) => e.verb === 'care_packet_send_refused'), r)
  r = await sendTo(pid2, '33', 'send-0005-abcd'); ck('no phone on the roster: refused, nothing sent', r.status === 422 && r.j.outcome === 'no_phone' && SENT.length === 2, r)
  pid2 = await ready(); GHL_FAIL = true
  r = await sendTo(pid2, '11', 'send-0006-abcd')
  const card = T.app_data.find((x) => x.key === 'ops_items').data.find((x) => x.kind === 'send_problem')
  ck('GoHighLevel refuses: "not sent", a Needs Attention card names the packet text and Ariel, her row not marked as texted',
    r.j.outcome === 'failed' && card && /caregiver packet text/.test(card.title) && /Ariel Smith/.test(card.title) && !T.care_packet_recipients[0].last_sent_at, { r: r.j, card, rec: T.care_packet_recipients[0] })
  ck('the office evening line: 8am to 8pm Central', M.inOfficeTextHours(new Date('2026-10-12T14:00:00Z')) && !M.inOfficeTextHours(new Date('2026-10-13T02:30:00Z')) && !M.inOfficeTextHours(new Date('2026-10-12T12:30:00Z')))


  // ---------------- Step 3: who is coming up ----------------
  const soon = (h) => new Date(Date.now() + h * 3600000).toISOString()
  let pid3 = await ready()
  VISITS = [{ id: 1, client: { id: '900' }, caregiver: { id: '11', firstName: 'Ariel', lastName: 'Smith' }, scheduledStartDate: soon(30) },
            { id: 2, client: { id: '900' }, caregiver: { id: '11', firstName: 'Ariel', lastName: 'Smith' }, scheduledStartDate: soon(6) },
            { id: 3, client: { id: '900' }, caregiver: { id: '12', firstName: 'Bea', lastName: 'Jones' }, scheduledStartDate: soon(50) },
            { id: 4, client: { id: '900' }, caregiver: { id: '13', firstName: 'Past', lastName: 'Visit' }, scheduledStartDate: soon(-2) },
            { id: 5, client: { id: '900' }, caregiver: null, scheduledStartDate: soon(10) },
            { id: 6, client: { id: '900' }, caregiver: { id: '14', firstName: 'Gone', lastName: 'Removed' }, scheduledStartDate: soon(12), removed: true }]
  r = await call({ action: 'upcoming', packet_id: pid3 }, null); ck('upcoming without sign-in: refused', r.status === 401, r)
  r = await call({ action: 'upcoming', packet_id: pid3 })
  ck('upcoming: each caregiver once with their NEXT visit, soonest first; past, removed and open shifts left out; nobody sent anything yet',
    r.j.outcome === 'ok' && r.j.upcoming.map((u) => u.caregiver_name).join() === 'Ariel Smith,Bea Jones' && r.j.upcoming[0].next_start === new Date(Date.parse(VISITS[1].scheduledStartDate)).toISOString() && r.j.upcoming.every((u) => u.standing === 'none'), r.j)
  await sendTo(pid3, '11', 'send-0101-abcd')
  r = await call({ action: 'upcoming', packet_id: pid3 }); ck('after the text: Ariel shows "texted"', r.j.upcoming[0].standing === 'texted', r.j)
  AX_FAIL = true; r = await call({ action: 'upcoming', packet_id: pid3 }); AX_FAIL = false
  ck('AxisCare not answering: says so (never "nobody is coming")', r.j.outcome === 'unreadable' && /AxisCare did not answer/.test(r.j.error), r.j)
  reset(); await call({ action: 'save', lead_id: 'L9', client_first: 'Lee', about: '', items: [{ topic: 'turning', notes: '' }], ready: true, base_version: null })
  r = await call({ action: 'upcoming', packet_id: T.care_packets[0].id }); ck('a lead not yet in AxisCare: "not in AxisCare", AxisCare never asked', r.j.outcome === 'not_in_axiscare' && !CALLS.some((u) => u.includes('axiscare')), r.j)


  // ---------------- the library editor and suggestions ----------------
  reset(); r = await call({ action: 'library' }); ck('library: the whole office can read it (Care Library tab), only an owner can edit', r.status === 200 && r.j.can_edit === false && r.j.library.length === 3 && r.j.categories.includes('eating'), r)
  r = await call({ action: 'library' }, 'sa'); ck('library (owner): every topic, the retired one too', r.status === 200 && r.j.can_edit === true && r.j.library.length === 3 && r.j.library.some((t) => t.key === 'old' && t.active === false), r.j)
  r = await call({ action: 'get', ax: '900' }); ck('get says a care coordinator cannot edit the library', r.j.can_edit_library === false, r.j)
  r = await call({ action: 'get', ax: '900' }, 'sa'); ck('...and the owner can', r.j.can_edit_library === true, r.j)
  r = await call({ action: 'topic_save', key: 'turning', title: 'Turning again', is_new: true, videos: [] }, 'sa'); ck('a new topic whose name is taken: refused, the old one untouched', r.status === 409 && T.care_topics.find((t) => t.key === 'turning').title === 'Turning and repositioning', r)
  r = await call({ action: 'topic_save', key: 'oxygen', title: 'Oxygen safety', notes: 'No open flame.', is_new: true, videos: [{ title: 'Oxygen at home', url: 'https://youtu.be/6M5_eTPUWpo' }] }, 'sa')
  ck('a new topic: saved, and the answer carries both the offered list and the whole library', r.status === 200 && r.j.topics.some((t) => t.key === 'oxygen') && r.j.library.length === 4 && EVENTS.some((e) => /added the how-to topic "Oxygen safety"/.test(e.summary)), r.j)
  // retiring keeps it in packets that have it
  await save({ items: [{ topic: 'turning', notes: 'n' }, { topic: 'oxygen', notes: 'o' }] })
  r = await call({ action: 'topic_save', key: 'oxygen', title: 'Oxygen safety', notes: 'No open flame.', active: false, videos: [] }, 'sa')
  ck('retiring: no longer offered for new packets', !r.j.topics.some((t) => t.key === 'oxygen') && EVENTS.some((e) => /retired/.test(e.summary)), r.j)
  r = await call({ action: 'get', ax: '900' }); ck('...the packet that has it lists it as retired-in-packet', r.j.retired_in_packet.map((t) => t.key).join() === 'oxygen', r.j)
  r = await save({ about: 'still has oxygen', items: [{ topic: 'turning', notes: 'n' }, { topic: 'oxygen', notes: 'o' }], base_version: T.care_packets[0].version }); ck('...and that packet can still be saved with it', r.status === 200, r)
  r = await call({ action: 'save', ax: '777', client_first: 'New', about: '', items: [{ topic: 'oxygen' }], ready: false, base_version: null }); ck('...but a new packet cannot pick it', r.status === 400, r)
  const rid = await (async () => { await call({ action: 'link', packet_id: T.care_packets[0].id, caregiver_axiscare_id: '11' }); return T.care_packet_recipients[0] })()
  const L3 = Object.fromEntries(new URL(await L.makeLink(SECRET, rid.id, 9999999999)).searchParams)
  r = await call({ action: 'view', ...L3 }, null); ck('...and the caregiver still sees it in that packet', r.j.items.some((i) => i.title === 'Oxygen safety'), r.j)

  // suggestions
  reset()
  T.app_data.push({ key: 'care_assessments', data: [{ id: 'as1', axiscare_client_id: '900', lead_id: 'L1' }, { id: 'as2', axiscare_client_id: '901' }] },
    { key: 'care_plans', data: [{ id: 'cp0', assessment_id: 'as1', created_at: '2026-09-01', adl_needs: 'old plan' }, { id: 'cp1', assessment_id: 'as1', created_at: '2026-10-10', adl_needs: 'Bed bound, turn every 2 hours', medical_conditions: 'Hospice', medications: 'MORPHINE 5mg', axiscare_tasks: [{ name: 'Reposition', instructions: 'every 2 hours' }] },
      { id: 'cp9', assessment_id: 'as2', adl_needs: 'someone else' }] },
    { key: 'leads', data: [{ id: 'L1', needs: ['personalCare'], safety: ['fallRisk'], client_attributes: { bed_bound: 'yes', hoyer_lift: 'no' }, ai_needs_summary: 'Uses a PureWick' }] })
  AI_ANSWER = '{"topics":[{"key":"turning","why":"Bed bound — needs turning every 2 hours"},{"key":"made_up","why":"x"},{"key":"turning","why":"dup"},{"key":"purewick_male","why":"Uses a <b>PureWick</b>"}]}'
  r = await call({ action: 'suggest', ax: '900', lead_id: 'L1', about: 'Call hospice first.' }, 'cg'); ck('suggest from a caregiver account: refused', r.status === 403, r)
  r = await call({ action: 'suggest', ax: '900', lead_id: 'L1', about: 'Call hospice first.' })
  const sent = AI_SEEN[AI_SEEN.length - 1]?.messages?.[0]?.content || ''
  ck('suggest: library topics only, each once, with why (no em dash, no markup)', r.j.outcome === 'ok' && r.j.suggestions.map((x) => x.topic).join() === 'turning,purewick_male' && !/[—<>]/.test(r.j.suggestions.map((x) => x.why).join(' ')), r.j)
  ck('suggest reads the NEWEST care plan for this client, their intake and the About notes, and says so', /Bed bound, turn every 2 hours/.test(sent) && !/old plan|someone else/.test(sent) && /bed bound: yes/.test(sent) && !/hoyer/.test(sent) && /Uses a PureWick/.test(sent) && /Call hospice first/.test(sent) && r.j.used.join('|') === 'their care plan (2026-10-10)|their intake answers|the About notes on this card', { sent, used: r.j.used })
  ck('medications are never sent to the AI', !/MORPHINE/i.test(sent), sent)
  ck('the AI is given only the active library to choose from', /"key":"turning"/.test(AI_SEEN[AI_SEEN.length - 1].system) && !/"key":"old"/.test(AI_SEEN[AI_SEEN.length - 1].system))
  ck('nothing is saved by suggesting', !T.care_packets.length)
  AI_ANSWER = null; r = await call({ action: 'suggest', ax: '900', lead_id: 'L1', about: '' }); ck('the AI not answering: says so, no suggestions', r.j.outcome === 'ai_failed' && !r.j.suggestions.length, r.j)
  AI_ANSWER = '{"topics":[]}'; r = await call({ action: 'suggest', ax: '555', about: '' }); ck('nothing known about the client: "nothing to read", the AI never asked', r.j.outcome === 'nothing_to_read' && AI_SEEN.length === 2, r.j)

  // helpers
  ck('YouTube ids from watch, youtu.be and shorts links; anything else no player', M.youtubeId('https://youtu.be/6M5_eTPUWpo') === '6M5_eTPUWpo' && M.youtubeId('https://www.youtube.com/shorts/6M5_eTPUWpo') === '6M5_eTPUWpo' && M.youtubeId('https://evil.com/watch?v=6M5_eTPUWpo') === null)
  ck('Vimeo plays on the page; a PDF opens as a link', M.embedOf('https://vimeo.com/968970613') === 'https://player.vimeo.com/video/968970613?dnt=1' && M.embedOf('https://example.com/ifu.pdf') === null)
  // preview (2026-10-12): what the caregiver page shows, for the office, draft or ready; records nothing
  reset(); await save({ ready: false }); { const pid = T.care_packets[0].id, before = JSON.stringify([T.care_packet_recipients, T.care_packet_acks || [], EVENTS.length])
    let pv = await call({ action: 'preview', packet_id: pid })
    ck('preview: a draft shows exactly what caregivers will see (notes, topic with its videos), marked as a preview and not ready', pv.status === 200 && pv.j.preview === true && pv.j.ready === false && pv.j.client_first === 'Dan' && /hospice/.test(pv.j.about) && pv.j.items.length === 1 && pv.j.items[0].notes === 'Every 2 hours, left, back, right.' && Array.isArray(pv.j.items[0].videos) && pv.j.items[0].videos.length > 0 && pv.j.acknowledged === false, pv)
    ck('preview: makes no link, records no confirmation, no event, texts nobody', JSON.stringify([T.care_packet_recipients, T.care_packet_acks || [], EVENTS.length]) === before && !SENT.length)
    await save({ ready: true, base_version: 1 }); pv = await call({ action: 'preview', packet_id: pid }); ck('preview: a ready packet says ready', pv.status === 200 && pv.j.ready === true, pv)
    pv = await call({ action: 'preview', packet_id: pid }, 'cg'); ck('preview from a caregiver account: refused (403)', pv.status === 403, pv)
    pv = await call({ action: 'preview', packet_id: pid }, null); ck('preview without signing in: refused (401)', pv.status === 401, pv)
    pv = await call({ action: 'preview', packet_id: 'nope' }); ck('preview with no packet id: asks which', pv.status === 400, pv)
    pv = await call({ action: 'preview', packet_id: '00000000-0000-0000-0000-000000000000' }); ck('preview of a packet that is gone: says so', pv.status === 404, pv) }
  // ---- the Care Library (2026-10-12): her OK on every topic and video before any caregiver sees it ----
  reset(); T.care_topics.push({ key: 'gait_belt', title: 'Using a gait belt', notes: 'Hold the belt, not their arm.', active: true, pending: true, category: 'moving', flag: '',
    videos: [{ title: 'Gait belt basics', url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA', status: 'pending', why: 'clear' }, { title: 'Walking with a gait belt', url: 'https://www.youtube.com/watch?v=BBBBBBBBBBB', status: 'pending' }] })
  T.care_topics.find((t) => t.key === 'turning').videos.push({ title: 'Researched, waiting', url: 'https://www.youtube.com/watch?v=CCCCCCCCCCC', status: 'pending' })
  r = await call({ action: 'get', ax: '900' })
  ck('a topic waiting for her OK is never offered for a packet', r.status === 200 && !r.j.topics.some((t) => t.key === 'gait_belt'), r.j.topics.map((t) => t.key))
  ck('a waiting video on an approved topic is not offered; videos with no status (approved before statuses) still are', (() => { const t = r.j.topics.find((x) => x.key === 'turning'); return t && t.videos.length >= 1 && !t.videos.some((v) => v.url.includes('CCCCCCCCCCC')) })(), r.j.topics)
  r = await save({ items: [{ topic: 'turning', notes: '' }, { topic: 'gait_belt', notes: '' }] })
  ck('a packet cannot pick up a waiting topic (the save is refused, nothing saved)', r.status >= 400 && !T.care_packets.length, r)
  await save({ items: [{ topic: 'turning', notes: '' }] })
  { const pid = T.care_packets[0].id; const pv = await call({ action: 'preview', packet_id: pid })
    ck('the caregiver page never shows a waiting video', pv.status === 200 && !JSON.stringify(pv.j).includes('CCCCCCCCCCC'), pv.j) }
  T.care_topics.find((t) => t.key === 'turning').videos[0] = { ...T.care_topics.find((t) => t.key === 'turning').videos[0], approved_by: 'sa@mo-care.com', approved_at: '2026-10-12', why: 'office research note' }
  T.care_topics.find((t) => t.key === 'turning').review_note = 'check the accent'
  { const pv = await call({ action: 'preview', packet_id: T.care_packets[0].id }); const j = JSON.stringify(pv.j)
    ck('the caregiver page never gets who approved a video, the research note or the office note', pv.status === 200 && !j.includes('sa@mo-care.com') && !j.includes('office research note') && !j.includes('check the accent'), pv.j) }
  r = await call({ action: 'review', key: 'gait_belt', url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA', decision: 'approve' }); ck('review: a care coordinator cannot approve', r.status === 403, r)
  r = await call({ action: 'review', key: 'gait_belt', url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA', decision: 'approve' }, 'sa')
  { const v = T.care_topics.find((t) => t.key === 'gait_belt').videos[0]
    ck('review: she approves one video, stamped with her and the time by the server', r.status === 200 && v.status === 'approved' && v.approved_by === 'sa@mo-care.com' && !!v.approved_at && EVENTS.some((e) => e.verb === 'care_topic_reviewed'), v) }
  r = await call({ action: 'review', key: 'gait_belt', url: 'https://www.youtube.com/watch?v=BBBBBBBBBBB', decision: 'remove' }, 'sa')
  ck('review: she removes one video', T.care_topics.find((t) => t.key === 'gait_belt').videos.length === 1, T.care_topics.find((t) => t.key === 'gait_belt').videos)
  r = await call({ action: 'get', ax: '900' }); ck('approving a video does not approve the topic', !r.j.topics.some((t) => t.key === 'gait_belt'))
  r = await call({ action: 'review', key: 'gait_belt', decision: 'approve' }, 'sa')
  { const t = T.care_topics.find((x) => x.key === 'gait_belt'); ck('review: she approves the topic, stamped', t.pending === false && t.approved_by === 'sa@mo-care.com', t) }
  r = await call({ action: 'get', ax: '900' }); ck('an approved topic is offered, with only its approved video', (() => { const t = r.j.topics.find((x) => x.key === 'gait_belt'); return t && t.videos.length === 1 && t.videos[0].url.includes('AAAAAAAAAAA') })(), r.j.topics)
  r = await call({ action: 'review', key: 'gait_belt', decision: 'remove' }, 'sa'); r = await call({ action: 'get', ax: '900' }); ck('review: removing a topic takes it out of the library offer', !r.j.topics.some((t) => t.key === 'gait_belt'))
  r = await call({ action: 'review', key: 'nope', decision: 'approve' }, 'sa'); ck('review: a topic that is gone says so', r.status === 404, r)
  r = await call({ action: 'review', key: 'turning', url: 'https://x/none', decision: 'approve' }, 'sa'); ck('review: a video no longer there says so', r.status === 404, r)
  r = await call({ action: 'review', key: 'turning', decision: 'maybe' }, 'sa'); ck('review: only approve or remove', r.status === 400, r)
  // the browser cannot forge an approval stamp; saving keeps the earlier stamp; a waiting one stays waiting
  r = await call({ action: 'topic_save', key: 'turning', title: 'Turning and repositioning', category: 'moving', videos: [
    { title: 'Researched, waiting', url: 'https://www.youtube.com/watch?v=CCCCCCCCCCC', status: 'pending', approved_by: 'forged@x.com' },
    { title: 'Mine', url: 'https://www.youtube.com/watch?v=DDDDDDDDDDD', approved_by: 'forged@x.com', approved_at: '2000-01-01' }] }, 'sa')
  { const vs = T.care_topics.find((t) => t.key === 'turning').videos
    ck('topic_save: a waiting video stays waiting with no stamp; a video she adds herself is approved with HER stamp, never one from the browser', r.status === 200 && vs[0].status === 'pending' && !vs[0].approved_by && vs[1].status === 'approved' && vs[1].approved_by === 'sa@mo-care.com' && vs[1].approved_at !== '2000-01-01', vs) }
  r = await call({ action: 'topic_save', key: 'turning', title: 'Turning and repositioning', category: 'nonsense', videos: [] }, 'sa'); ck('topic_save: an unknown group is refused', r.status === 400, r)
  r = await call({ action: 'topic_save', key: 'turning', title: 'Turning and repositioning', category: 'bedbound', videos: [] }, 'sa'); ck('topic_save: the Bed-bound and hospice care group is accepted (2026-10-12)', r.status === 200 && T.care_topics.find((t) => t.key === 'turning').category === 'bedbound', r)
  r = await call({ action: 'library' }); ck('library: lists Bed-bound and hospice care first among the groups', r.j.categories[0] === 'bedbound', r.j.categories)
  r = await call({ action: 'topic_save', key: 'diet_x', title: 'A diet', category: 'eating', flag: 'Follow the care plan.', is_new: true, videos: [] }, 'sa')
  { const t = T.care_topics.find((x) => x.key === 'diet_x'); ck('topic_save: a new topic she writes is in its group, has its warning line, and is approved by her', t && t.category === 'eating' && t.flag === 'Follow the care plan.' && t.pending === false && t.approved_by === 'sa@mo-care.com', t) }
  ck('M.stampVideos keeps an older approval, stamps a new one, clears a waiting one', (() => { const out = M.stampVideos([{ url: 'a', status: 'approved' }, { url: 'b', status: 'approved' }, { url: 'c', status: 'pending' }], [{ url: 'a', status: 'approved', approved_by: 'x', approved_at: '2026-01-01' }], 'sa', 'NOW'); return out[0].approved_by === 'x' && out[1].approved_by === 'sa' && out[1].approved_at === 'NOW' && out[2].approved_by === null })())
  // ---- per client: send automatically, or by hand (2026-10-12) ----
  const cron = async (body, secret = SECRET) => { const r = await handler(new Request('https://x/functions/v1/care-packet', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-cron-secret': secret }, body: JSON.stringify(body) })); let j = null; try { j = await r.json() } catch { /* */ } return { status: r.status, j } }
  const realNow = Date.now, at = (iso) => { Date.now = () => Date.parse(iso) }
  reset(); await save({ ready: true }); { const pid = T.care_packets[0].id
    ck('every client starts set to send by hand', T.care_packets[0].auto_send !== true)
    at('2026-10-13T15:00:00Z')   // 10am Central
    let a = await cron({ action: 'auto_send', packet_id: pid, caregiver_axiscare_id: '11' })
    ck('auto_send: refused while the client is set to send by hand, nothing sent', a.status === 409 && a.j.outcome === 'not_auto' && !SENT.length, a)
    a = await call({ action: 'auto_set', packet_id: pid, on: true }, 'cg'); ck('auto_set: a caregiver account cannot change it', a.status === 403, a)
    a = await call({ action: 'auto_set', packet_id: pid, on: true })
    ck('auto_set: the office turns it on for this client, recorded with who and when', a.status === 200 && T.care_packets[0].auto_send === true && T.care_packets[0].auto_send_by === 'kr@mo-care.com' && EVENTS.some((e) => e.verb === 'care_packet_auto_set'), T.care_packets[0])
    a = await cron({ action: 'auto_send', packet_id: pid, caregiver_axiscare_id: '11' }, 'y'.repeat(40)); ck('auto_send: a wrong secret is refused', a.status === 401 && !SENT.length, a)
    a = await call({ action: 'auto_send', packet_id: pid, caregiver_axiscare_id: '11' }); ck('auto_send: a signed-in office person cannot call it (only the check)', a.status === 401 && !SENT.length, a)
    at('2026-10-13T03:00:00Z')   // 10pm Central
    a = await cron({ action: 'auto_send', packet_id: pid, caregiver_axiscare_id: '11' }); ck('auto_send: never outside 8am to 8pm Central', a.status === 409 && a.j.outcome === 'late' && !SENT.length, a)
    at('2026-10-13T15:00:00Z')
    a = await cron({ action: 'auto_send', packet_id: pid, caregiver_axiscare_id: '11' })
    ck('auto_send: texts the first text through the same send path, recorded as automatic', a.status === 200 && a.j.outcome === 'sent' && SENT.length === 1 && /Before you work with Dan/.test(SENT[0].text) && EVENTS.some((e) => e.verb === 'care_packet_sent' && e.data.auto === true && /automatically/.test(e.summary)), [a, SENT, EVENTS.map((e) => e.verb)])
    a = await cron({ action: 'auto_send', packet_id: pid, caregiver_axiscare_id: '11' }); ck('auto_send: never a reminder (already texted this version: nothing sent)', a.status === 409 && a.j.outcome === 'no_reminders' && SENT.length === 1, a)
    a = await cron({ action: 'auto_send', packet_id: pid, caregiver_axiscare_id: '22' }); ck('auto_send: the opt-out gate still applies (opted-out caregiver not texted)', a.status === 422 && SENT.length === 1, a)
    // ---- small fix: keep their confirmations ----
    const rec = T.care_packet_recipients.find((x) => x.caregiver_axiscare_id === '11')
    Object.assign(rec, { ack_version: 1, ack_at: '2026-10-13T15:05:00Z' })
    await save({ about: 'On hospice. Call hospice first. Small fix.', base_version: 1 })
    ck('a real change makes version 2; Ariel now shows an older version', T.care_packets[0].version === 2 && rec.ack_version === 1)
    a = await call({ action: 'carry_acks', packet_id: pid, from_version: 0 }); ck('carry_acks: only from the version just before', a.status === 409 && rec.ack_version === 1, a)
    a = await call({ action: 'carry_acks', packet_id: pid, from_version: 1 })
    const row = (T.care_packet_acks || []).find((x) => x.version === 2)
    ck('carry_acks: Ariel is confirmed on version 2, marked carried over from 1 by the office person, never silently', a.status === 200 && a.j.carried === 1 && rec.ack_version === 2 && rec.ack_carried_from === 1 && rec.ack_carried_by === 'kr@mo-care.com' && rec.ack_at === '2026-10-13T15:05:00Z'
      && row && row.carried_from === 1 && row.carried_by === 'kr@mo-care.com' && EVENTS.some((e) => e.verb === 'care_packet_acks_carried' && /small fix/.test(e.summary)), [rec, row])
    ck('carry_acks: what the card reads says carried over', a.j.recipients.some((x) => x.caregiver_axiscare_id === '11' && x.ack_carried_from === 1))
    a = await cron({ action: 'auto_send', packet_id: pid, caregiver_axiscare_id: '11' }); ck('after the small fix, no updated text goes to Ariel', a.status === 409 && SENT.length === 1, a)
    const L2 = linkParts((await call({ action: 'link', packet_id: pid, caregiver_axiscare_id: '11' })).j.link)
    const v2 = await call({ ...L2, action: 'view' }, null)
    ck('the caregiver page counts a carried-over confirmation as confirmed (no new ask)', v2.status === 200 && v2.j.acknowledged === true, v2.j)
    const a2 = await call({ ...L2, action: 'ack', version: 2 }, null)
    ck('tapping again keeps the record honest: already confirmed, still marked carried over', a2.j.outcome === 'already' && rec.ack_carried_from === 1, [a2.j, rec])
    a = await call({ action: 'auto_set', packet_id: pid, on: false }); ck('auto_set: back to by hand', T.care_packets[0].auto_send === false)
  }
  Date.now = realNow
  reset(); FAIL = 'care_packets'; r = await call({ action: 'get', ax: '900' }); ck('a database failure: a plain error, not a crash', r.status === 500 && /went wrong/.test(r.j.error), r)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
const bad = res.filter((x) => !x[1])
for (const [n, okk, note] of res) console.log((okk ? 'PASS ' : 'FAIL ') + n + (note ? '\n     ' + note : ''))
console.log(`\n${res.length - bad.length}/${res.length} passed`); process.exit(bad.length ? 1 : 0)
