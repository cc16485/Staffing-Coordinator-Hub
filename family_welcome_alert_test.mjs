// The welcome reminder (her "have an alert if it wasn't sent", 2026-10-17) against the REAL _shared/family-welcome-alert.ts.
//   node family_welcome_alert_test.mjs
import path from 'path'
import { pathToFileURL } from 'url'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)])
const A = await import(pathToFileURL(path.resolve('supabase/functions/_shared/family-welcome-alert.ts')).href)
let NOW, W
const person = (id, vals = {}) => ({ id, name: 'Lisa Ray', email: 'lisa@x.test', relationship: 'Daughter', source: 'axiscare', hipaa_authorized: true, circle_id: 'c1', client_name: 'Dorothy Ray', axiscare_client_id: '501', circle_active: true, client_active: true, ...vals })
function world(people, st = {}) { W = { people, st, items: [], closed: [] } }
const deps = () => ({ now: () => NOW, settings: async () => W.st, candidates: async () => W.people.map((p) => ({ ...p })),
  stampReady: async (id, at) => { const p = W.people.find((x) => x.id === id); if (!p.welcome_ready_at) p.welcome_ready_at = at },
  openCards: async () => W.items.filter((x) => x.status !== 'done').map((x) => x.id),
  officeItem: async (it) => { const i = W.items.findIndex((x) => x.id === it.id); if (i >= 0) W.items[i] = it; else W.items.push(it); return true },
  closeItem: async (id) => { const it = W.items.find((x) => x.id === id); if (it) { it.status = 'done'; W.closed.push(id) } } })
const run = (o) => A.welcomeAlerts(deps(), o)

NOW = new Date('2026-10-19T15:00:00Z')   // Mon 10 AM
world([person(1)]); await run()
ck('first seen ready: the time is noted, no card yet', W.people[0].welcome_ready_at === NOW.toISOString() && !W.items.length)
NOW = new Date('2026-10-19T21:00:00Z'); await run()
ck('same day: still no card', !W.items.length)
NOW = new Date('2026-10-20T15:30:00Z'); await run()   // Tue 10:30 AM (a full business day later)
ck('one business day later with no welcome: ONE card for the client, saying what to do', W.items.length === 1 && W.items[0].id === 'fam_welcome_c1' && W.items[0].title === 'Send the welcome: Lisa Ray (Dorothy Ray)' && /Invite and send welcome and pick the version/.test(W.items[0].detail), W.items)
await run(); ck('next run: still one card', W.items.length === 1)
W.people[0].welcome_sent_at = '2026-10-20T16:00:00Z'; await run()
ck('welcome sent: the card closes itself', W.closed.includes('fam_welcome_c1'))
world([person(1, { welcome_ready_at: '2026-10-16T21:00:00Z' })]); NOW = new Date('2026-10-17T15:00:00Z'); await run()   // Fri 5 PM ready, Sat
ck('a weekend: no card (Monday to Friday only), and the weekend does not count as a business day', !W.items.length)
NOW = new Date('2026-10-19T13:30:00Z'); await run()   // Mon 8:30 AM: only 1.5 office hours since Fri 4 PM
ck('Monday 8:30 AM after a Friday-afternoon ready: not yet', !W.items.length)
NOW = new Date('2026-10-19T22:30:00Z'); await run()   // Mon 5:30 PM: Fri 4-6 (2) + Mon 8-5:30 (9.5) = 11.5 office hours
ck('Monday late afternoon: card', W.items.length === 1)
world([person(1, { hipaa_authorized: null, welcome_ready_at: '2026-10-01T15:00:00Z' }), person(2, { source: 'manual', welcome_ready_at: '2026-10-01T15:00:00Z' }), person(3, { client_active: false, welcome_ready_at: '2026-10-01T15:00:00Z' }),
  person(4, { stopped_at: '2026-10-01', welcome_ready_at: '2026-10-01T15:00:00Z' }), person(5, { welcome_skip_at: '2026-10-02', welcome_ready_at: '2026-10-01T15:00:00Z' })])
NOW = new Date('2026-10-20T15:00:00Z'); await run()
ck('never a card for: no HIPAA permission, not an AxisCare responsible party, inactive client, opted out, or marked "No welcome"', !W.items.length, W.items)
world([person(1, { hipaa_authorized: null, hipaa_office_ok_at: '2026-10-02T15:00:00Z', welcome_ready_at: '2026-10-01T15:00:00Z' }), person(2, { name: 'Tom Ray', email: 't@x.test', hipaa_authorized: false, hipaa_office_ok_at: '2026-10-02T15:00:00Z', welcome_ready_at: '2026-10-01T15:00:00Z' })]); await run()
ck('HIPAA OK in the Hub counts for the reminder; AxisCare\'s explicit No still wins', W.items.length === 1 && /Lisa Ray/.test(W.items[0].detail) && !/Tom Ray/.test(W.items[0].detail), W.items)
world([person(1, { relationship: 'Client', source: 'app_self', hipaa_authorized: null, welcome_ready_at: '2026-10-01T15:00:00Z' })]); await run()
ck('the client themself counts (no HIPAA needed for their own care)', W.items.length === 1)
world([person(1, { welcome_ready_at: '2026-10-01T15:00:00Z' }), person(2, { name: 'Tom Ray', email: 't@x.test', welcome_ready_at: '2026-10-01T15:00:00Z' })]); await run()
ck('two family members waiting: still one card for the client, naming both', W.items.length === 1 && W.items[0].title === 'Send the welcome: 2 people (Dorothy Ray)' && /Lisa Ray, Tom Ray/.test(W.items[0].detail), W.items)
world([person(1, { axiscare_client_id: '55', welcome_ready_at: '2026-10-01T15:00:00Z' })], { family_welcome_skip_clients: ['55', '220'] }); await run()
ck('a client on the "no welcome" list (live-in, IHS ending): no card', !W.items.length)
world([person(1, { welcome_ready_at: '2026-10-01T15:00:00Z' })], { family_welcome_alert_live: false }); const o = await run()
ck('switched off: nothing', !W.items.length && o.held)
world([person(1, { welcome_ready_at: '2026-10-01T15:00:00Z' })]); const d = await run({ dry: true })
ck('dry run: says who, writes nothing', d.would.length === 1 && !W.items.length)
for (const [n, okk, note] of res) console.log((okk ? '  ✓ ' : '  ✗ ') + n + (okk ? '' : '\n      ' + note))
const bad = res.filter((x) => !x[1]).length
console.log(`\n  welcome reminder: ${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0)
