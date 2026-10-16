// Family app sign-in by email on file (her "yes, build it" 2026-10-16). Under Node against the REAL _shared/family-signin.ts
// and family-app.ts with stand-in AxisCare, Hub tables and family logins. Nothing real is touched.
//   node family_signin_test.mjs
//   PGLITE=<path to @electric-sql/pglite/dist/index.js> node family_signin_test.mjs   also runs family_app_signin.sql twice
import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)])
const F = 'supabase/functions'
const si = await import(pathToFileURL(path.resolve(F, '_shared/family-signin.ts')).href)
const fam = await import(pathToFileURL(path.resolve(F, '_shared/family-app.ts')).href)
const NOW = new Date('2026-10-20T14:00:00Z')

let W
const act = (id, first, last, email, active = true) => ({ id, firstName: first, lastName: last, email, status: { active, label: active ? 'Active' : 'Inactive' } })
function reset(m = {}) {
  W = {
    ax: { 501: act(501, 'Dorothy', 'Smith', 'dot@example.com'), 502: act(502, 'Earl', 'Jones', '', false), 290: act(290, 'Test', 'Client 5', '', false), 503: act(503, 'Fay', 'Lee', 'Fay.Lee@Example.com') },
    circles: [{ id: 'K1', client_name: 'Dorothy Smith', active: true, axiscare_client_id: '501' }, { id: 'K2', client_name: 'Earl Jones', active: true, axiscare_client_id: '502' },
              { id: 'K5', client_name: 'Test Client 5', active: true, axiscare_client_id: '290' }],
    contacts: [
      { id: 1, name: 'Ann Smith', email: 'ann@example.com', circle_id: 'K1', source: 'axiscare', app_status: null, app_user_id: null, app_can_book: false, stopped_at: null, axiscare_removed_at: null },
      { id: 2, name: 'Neighbor Ned', email: 'ned@example.com', circle_id: 'K1', source: 'manual', app_status: null, app_user_id: null, app_can_book: false, stopped_at: null, axiscare_removed_at: null },
      { id: 3, name: 'Earl Jr', email: 'junior@example.com', circle_id: 'K2', source: 'axiscare', app_status: null, app_user_id: null, app_can_book: false, stopped_at: null, axiscare_removed_at: null },
      { id: 4, name: 'Cut Off', email: 'cut@example.com', circle_id: 'K1', source: 'axiscare', app_status: 'revoked', app_user_id: 'u-cut', app_can_book: true, stopped_at: null, axiscare_removed_at: null },
      { id: 5, name: 'Gone Gail', email: 'gail@example.com', circle_id: 'K1', source: 'axiscare', app_status: null, app_user_id: null, app_can_book: false, stopped_at: null, axiscare_removed_at: '2026-10-01' },
      { id: 6, name: 'Office Kept', email: 'kept@example.com', circle_id: 'K1', source: 'manual', app_status: 'active', app_user_id: 'u-kept', app_can_book: true, stopped_at: null, axiscare_removed_at: null },
      { id: 7, name: 'Sam Test', email: 'stroutman2011@gmail.com', circle_id: 'K5', source: 'manual', app_status: null, app_user_id: null, app_can_book: false, stopped_at: null, axiscare_removed_at: null },
    ],
    users: { 'u-cut': 'cut@example.com', 'u-kept': 'kept@example.com' }, banned: new Set(['u-cut']),
    attempts: [], events: [], created: [], settings: { family_app_test_clients: ['290'] }, axDown: false, listDown: false, ...m,
  }
}
const deps = () => ({
  now: () => NOW,
  settings: async () => W.settings,
  ax: async (m, p) => { if (W.axDown) return { status: 0, json: {} }; const id = p.split('/').pop(); return W.ax[id] ? { status: 200, json: { results: { client: W.ax[id] } } } : { status: 404, json: {} } },
  axClients: async () => W.listDown ? null : Object.values(W.ax),
  contactsByEmail: async (e) => W.contacts.filter((c) => String(c.email).toLowerCase() === e),
  circles: async (ids) => W.circles.filter((k) => ids.includes(String(k.id))),
  circleForClient: async (ax, name) => W.circles.find((k) => k.axiscare_client_id === ax && k.active !== false) ?? (() => { const k = { id: 'K' + ax, client_name: name, active: true, axiscare_client_id: ax }; W.circles.push(k); W.created.push('circle ' + ax); return k })(),
  contactInCircle: async (cid, e, name) => W.contacts.find((c) => c.circle_id === cid && String(c.email).toLowerCase() === e) ?? (() => {
    const c = { id: 100 + W.contacts.length, name, email: e, circle_id: cid, source: 'app_self', app_status: null, app_user_id: null, app_can_book: false, stopped_at: null, axiscare_removed_at: null }
    W.contacts.push(c); W.created.push('contact ' + e); return c })(),
  updateContact: async (id, vals) => { Object.assign(W.contacts.find((c) => c.id === id), vals); return true },
  login: {
    find: async (e) => Object.entries(W.users).find(([, v]) => v === e)?.[0] ?? null,
    create: async (e) => { const id = 'u-' + e.split('@')[0]; W.users[id] = e; return id },
    unblock: async (id) => { W.banned.delete(id) },
  },
  attempts: async (e, ip, se, sip) => ({ email: W.attempts.filter((a) => a.email === e && a.at >= se).length, ip: W.attempts.filter((a) => a.ip === ip && a.at >= sip).length }),
  recordAttempt: async (email, ip, outcome) => { W.attempts.push({ email, ip, outcome, at: NOW.toISOString() }) },
  event: async (row) => { W.events.push(row) },
})
const start = (email, ip = '1.2.3.4') => si.signinStart(deps(), email, ip)
const ct = (id) => W.contacts.find((c) => c.id === id)

reset(); let o = await start('  ANN@example.com ')
ck('1 responsible party of an active client: in, login made, booking ON', o.status === 200 && o.body.ok === true && ct(1).app_status === 'active' && ct(1).app_can_book === true && W.users[ct(1).app_user_id] === 'ann@example.com' && ct(1).app_invited_by === 'self: email on file', [o, ct(1)])
ck('1b one event, one attempt marked ok', W.events.length === 1 && W.events[0].verb === 'family_app_self_signin' && W.attempts.at(-1).outcome === 'ok', [W.events, W.attempts])
o = await start('ann@example.com')
ck('1c second time: same login, nothing changed, no second event', o.body.ok === true && W.events.length === 1 && Object.keys(W.users).filter((k) => W.users[k] === 'ann@example.com').length === 1, W.events)
reset(); o = await start('ned@example.com')
ck('2 office-typed Family Circle person: in, booking OFF', o.body.ok === true && ct(2).app_status === 'active' && ct(2).app_can_book === false, ct(2))
reset(); o = await start('dot@example.com')
ck('3 the client\'s own AxisCare email: in, a Client row on their circle, booking ON', o.body.ok === true && W.contacts.some((c) => c.email === 'dot@example.com' && c.circle_id === 'K1' && c.source === 'app_self' && c.app_status === 'active' && c.app_can_book === true), W.contacts.slice(-1))
reset(); o = await start('fay.lee@example.com')
ck('3b client with no circle yet (any capitals in AxisCare): circle + Client row made', o.body.ok === true && W.created.includes('circle 503') && W.contacts.at(-1).name === 'Fay Lee', [o, W.created])
reset(); o = await start('junior@example.com')
ck('4 contact of a client who is NOT active: not on file, nothing made, no code', o.body.ok === false && o.body.reason === 'not_on_file' && /junior@example.com/.test(o.body.error) && /\(417\) 234-8494/.test(o.body.error) && !ct(3).app_status && Object.keys(W.users).length === 2, [o, ct(3)])
reset(); o = await start('nobody@example.com')
ck('5 unknown email: plain "not on file" with the office number', o.status === 200 && o.body.ok === false && o.body.error === "We don't have nobody@example.com on file for a current client. Please call us at (417) 234-8494 and we'll add it." && W.attempts.at(-1).outcome === 'not_on_file', o)
reset(); o = await start('cut@example.com')
ck('6 office turned them off: stays off, login stays blocked', o.body.ok === false && ct(4).app_status === 'revoked' && W.banned.has('u-cut') && W.attempts.at(-1).outcome === 'revoked', [o, ct(4)])
reset(); o = await start('gail@example.com')
ck('7 removed from AxisCare\'s contacts: not on file', o.body.ok === false && !ct(5).app_status, o)
reset(); o = await start('kept@example.com')
ck('8 already on (office set booking): kept exactly as the office set it', o.body.ok === true && ct(6).app_user_id === 'u-kept' && ct(6).app_can_book === true && !W.events.length, [o, ct(6)])
reset(); o = await start('stroutman2011@gmail.com')
ck('9 test client 5 (inactive, but in family_app_test_clients): in', o.body.ok === true && ct(7).app_status === 'active', [o, ct(7)])
reset({ settings: {} }); o = await start('stroutman2011@gmail.com')
ck('9b same, without the test list: not on file', o.body.ok === false, o)
reset(); for (let i = 0; i < 5; i++) await start('nobody@example.com'); o = await start('nobody@example.com')
ck('10 more than 5 tries for one email in 15 minutes: wait', o.status === 429 && /wait/.test(o.body.error), o)
reset(); for (let i = 0; i < 30; i++) await start(`n${i}@example.com`, '9.9.9.9'); o = await start('ann@example.com', '9.9.9.9')
ck('10b more than 30 tries from one address in an hour: wait (even for a real email)', o.status === 429 && !ct(1).app_status, o)
reset(); o = await start('not-an-email')
ck('11 not an email: asked to type the whole address, nothing recorded', o.status === 400 && !W.attempts.length, o)
reset({ axDown: true }); o = await start('ann@example.com')
ck('12 AxisCare down: "try again", nobody let in', o.status === 502 && !ct(1).app_status, o)
reset({ listDown: true }); o = await start('ann@example.com')
ck('12b client list down but the contact checks out: still in', o.body.ok === true && ct(1).app_status === 'active', o)
reset({ listDown: true }); o = await start('dot@example.com')
ck('12c client list down and no contact: "try again", not "not on file"', o.status === 502, o)

// the family door: an active client only
ck('13 careActive: active yes, inactive no, test list yes', fam.careActive({ status: { active: true } }, '1', {}) && !fam.careActive({ status: { active: false } }, '1', {}) && fam.careActive({ status: { active: false } }, '290', { family_app_test_clients: ['290'] }) && !fam.careActive({}, '1', {}))
{
  const who = [{ contact_id: 1, name: 'Ann', circle_id: 'K1', axiscare_client_id: '502', client_name: 'Earl Jones', can_book: true }]
  const d = { ax: async () => ({ status: 200, json: { results: { client: { id: 502, firstName: 'Earl', status: { active: false }, residentialAddress: { state: 'MO' } } } } }), now: () => NOW, supabaseUrl: 'x', settings: async () => ({}), whoIs: async () => who,
    profiles: async () => [], bookings: async () => [], insertBooking: async () => null, updateBooking: async () => true, officeItem: async () => true, event: async () => {} }
  const r = await fam.familyAction(d, { id: 'u1' }, { action: 'home' })
  ck('13b a signed-in family whose client\'s care ended: the app is closed for them, with the office number', r.status === 403 && /Earl's care with us has ended/.test(r.body.error) && /\(417\) 234-8494/.test(r.body.error), r)
  const d2 = { ...d, ax: async () => ({ status: 200, json: { results: { client: { id: 502, firstName: 'Earl', status: { active: false } } } } }) }
  const r2 = await fam.familyAction(d2, { id: 'u1', email: 'a@x.test' }, { action: 'home' })
  ck('13c care ended and AxisCare has no state: closed, and NO Missouri number guessed (two-brand rule)', r2.status === 403 && /call the office with any questions/.test(r2.body.error) && !/417/.test(r2.body.error), r2)
  const d3 = { ...d, ax: async () => ({ status: 200, json: { results: { client: { id: 502, firstName: 'Earl', status: { active: false }, residentialAddress: { state: 'OK' } } } } }) }
  const r3 = await fam.familyAction(d3, { id: 'u1', email: 'a@x.test' }, { action: 'home' })
  ck('13d care ended, Oklahoma client: the Oklahoma office number', r3.status === 403 && /\(405\) 500-1758/.test(r3.body.error), r3)
}

// live for listed clients (her live test 2026-10-16)
{
  const R = { family_fee_check_ready: true }
  ck('16 appLive: app switch on = live for everyone', fam.appLive({ ...R, family_app_live: true }, '501') && fam.appLive({ ...R, family_app_live: true }))
  ck('16b live-clients list: only those clients are live while the switch is off', fam.appLive({ ...R, family_app_live_clients: ['290'] }, '290') && fam.appLive({ ...R, family_app_live_clients: [290] }, '290') && !fam.appLive({ ...R, family_app_live_clients: ['290'] }, '501'))
  ck('16c no client given (caregiver offers): the list does not count', !fam.appLive({ ...R, family_app_live_clients: ['290'] }))
  ck('16d the fee check rule still holds for listed clients', !fam.appLive({ family_app_live_clients: ['290'] }, '290') && !fam.appLive({ family_app_live: true }, '290'))
}

// gateway wiring (source checks)
const gw = fs.readFileSync(path.resolve(F, 'family-gateway/index.ts'), 'utf8')
ck('14 gateway: start is answered before the sign-in check, everything else still needs a family sign-in', gw.indexOf("body?.action === 'start'") > 0 && gw.indexOf("body?.action === 'start'") < gw.indexOf('const user = await familyUser(req)') && /if \(!user\) return json\(\{ error: 'Please sign in again.' \}, 401\)/.test(gw))
ck('14b gateway: circles with active null count as active; emails matched without wildcards', gw.includes(".or('active.is.null,active.eq.true')") && gw.includes(".replace(/[\\\\%_]/g, '\\\\$&')"))

// SQL in a real Postgres
const PG = process.env.PGLITE
if (PG) {
  const { PGlite } = await import(pathToFileURL(PG).href)
  const db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create role service_role; create table public.app_data(key text primary key, data jsonb);
    insert into public.app_data values ('ops_settings', '{"family_app_live": false, "x": 1}');`)
  const q = fs.readFileSync('family_app_signin.sql', 'utf8')
  await db.exec(q); await db.exec(q)
  const s1 = (await db.query(`select data from public.app_data where key='ops_settings'`)).rows[0].data
  ck('15 SQL twice: test list added, other settings kept', JSON.stringify(s1.family_app_test_clients) === '["290"]' && s1.x === 1 && s1.family_app_live === false, s1)
  await db.exec(`update public.app_data set data = data || '{"family_app_test_clients": []}' where key='ops_settings'`); await db.exec(q)
  ck('15b SQL again after the office emptied the test list: left empty', JSON.stringify((await db.query(`select data from public.app_data where key='ops_settings'`)).rows[0].data.family_app_test_clients) === '[]')
  const g = (await db.query(`select grantee, privilege_type from information_schema.role_table_grants where table_name='family_signin_attempts' and grantee in ('anon','authenticated')`)).rows
  const rls = (await db.query(`select relrowsecurity from pg_class where relname='family_signin_attempts'`)).rows[0].relrowsecurity
  ck('15c attempts table: RLS on, nothing for anon or signed-in logins', rls === true && g.length === 0, g)
  await db.exec(`insert into public.family_signin_attempts(email, ip, outcome) values ('a@b.co', '1.1.1.1', 'ok')`)
  ck('15d attempts table takes a row', (await db.query(`select count(*)::int n from public.family_signin_attempts`)).rows[0].n === 1)
} else console.log('  (PGLITE not set: SQL checks skipped)')

for (const [n, ok, note] of res) console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note))
console.log(`\n  family app sign-in by email on file: ${res.filter((r) => r[1]).length}/${res.length} passed`)
process.exit(res.every((r) => r[1]) ? 0 : 1)
