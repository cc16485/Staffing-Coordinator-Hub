// care-packet (caregiver packets, Step 1, 2026-10-12). The REAL function, the REAL staff check and the REAL link helper,
// against a fake database. node care_packet_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)])
const SECRET = 'x'.repeat(40)
let T, EVENTS, FAIL
const TOPICS = () => [
  { key: 'turning', title: 'Turning and repositioning', notes: 'Turn every 2 hours.', active: true, videos: [{ title: 'Lie on the side', url: 'https://www.youtube.com/watch?v=6M5_eTPUWpo', publisher: 'The Hospice Care Plan', minutes: 5 }] },
  { key: 'purewick_male', title: 'PureWick (male)', notes: 'Check it every 2 hours.', active: true, videos: [{ title: 'PureWick Male in-service', url: 'https://vimeo.com/968970613', publisher: 'BD', minutes: 6 }, { title: 'IFU', url: 'https://example.com/ifu.pdf' }] },
  { key: 'old', title: 'Retired topic', notes: '', active: false, videos: [] }]
const reset = () => { EVENTS = []; FAIL = null; T = {
  care_topics: TOPICS(), care_packets: [], care_packet_recipients: [], care_packet_acks: [],
  app_data: [{ key: 'caregivers', data: [{ first: 'Ariel', last: 'Smith', axiscare_id: '11' }, { first: 'Twin', last: 'One', axiscare_id: '99' }, { first: 'Twin', last: 'Two', axiscare_id: '99' }] }],
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
  const b = { select() { st.sel = true; return b }, eq(c, v) { st.f.push([c, v]); return b }, limit() { return b }, order() { return b }, in() { return b },
    insert(r) { st.op = 'insert'; st.row = r; return b }, update(r) { st.op = 'update'; st.row = r; return b }, upsert(r) { st.op = 'upsert'; st.row = r; return b },
    maybeSingle() { const r = run(); return Promise.resolve({ data: r.data ? r.data[0] ?? null : null, error: r.error }) },
    then(ok, no) { return Promise.resolve(run()).then(ok, no) } }; return b }
globalThis.__db = { from: q, rpc: async () => ({ data: null, error: null }),
  auth: { getUser: async (jwt) => ({ kr: 'u-kr', sa: 'u-sa', cg: 'u-cg' })[jwt] ? { data: { user: { id: ({ kr: 'u-kr', sa: 'u-sa', cg: 'u-cg' })[jwt], email: jwt + '@mo-care.com', app_metadata: {} } }, error: null } : { data: { user: null }, error: { message: 'bad' } } } }
globalThis.fetch = async () => { throw new Error('nothing here may reach the network') }
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', HUB_JOB_SECRET: SECRET }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_cpk_'))
try {
  const src = fs.readFileSync(path.join(F, 'care-packet/index.ts'), 'utf8')
    .replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace(/from '\.\.\/_shared\/(\w[\w-]*)\.ts'/g, (_, m) => "from '" + path.join(process.cwd(), F, '_shared', m + '.ts') + "'")
  fs.writeFileSync(path.join(tmp, 'care-packet.ts'), src)
  const M = await import(path.join(tmp, 'care-packet.ts'))
  const L = await import(path.join(process.cwd(), F, '_shared/packet-links.ts'))
  const call = async (body, jwt = 'kr', method = 'POST') => { const r = await handler(new Request('https://x/functions/v1/care-packet', { method,
    headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: 'Bearer ' + jwt } : {}) }, body: method === 'POST' ? JSON.stringify(body) : undefined }))
    let j = null; try { j = await r.json() } catch { /* */ } return { status: r.status, j, h: r.headers } }
  const linkParts = (link) => Object.fromEntries(new URL(link).searchParams)
  const save = (x = {}, jwt = 'kr') => call({ action: 'save', ax: '900', client_first: 'Dan', about: 'On hospice. Call hospice first.', items: [{ topic: 'turning', notes: 'Every 2 hours, left, back, right.' }], ready: true, base_version: null, ...x }, jwt)

  reset(); let r = await call(null, null, 'OPTIONS'); ck('browser preflight answered with CORS headers', r.h.get('access-control-allow-origin') === '*')
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

  // helpers
  ck('YouTube ids from watch, youtu.be and shorts links; anything else no player', M.youtubeId('https://youtu.be/6M5_eTPUWpo') === '6M5_eTPUWpo' && M.youtubeId('https://www.youtube.com/shorts/6M5_eTPUWpo') === '6M5_eTPUWpo' && M.youtubeId('https://evil.com/watch?v=6M5_eTPUWpo') === null)
  ck('Vimeo plays on the page; a PDF opens as a link', M.embedOf('https://vimeo.com/968970613') === 'https://player.vimeo.com/video/968970613?dnt=1' && M.embedOf('https://example.com/ifu.pdf') === null)
  reset(); FAIL = 'care_packets'; r = await call({ action: 'get', ax: '900' }); ck('a database failure: a plain error, not a crash', r.status === 500 && /went wrong/.test(r.j.error), r)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
const bad = res.filter((x) => !x[1])
for (const [n, okk, note] of res) console.log((okk ? 'PASS ' : 'FAIL ') + n + (note ? '\n     ' + note : ''))
console.log(`\n${res.length - bad.length}/${res.length} passed`); process.exit(bad.length ? 1 : 0)
