// Family booking app, Step 1a (Desktop 801). Under Node against the REAL _shared/family-app.ts and family-app-office.ts
// with a stand-in AxisCare, Hub database and family sign-in. Nothing real is touched.
//   node family_app_1a_test.mjs
//   PGLITE=<path to @electric-sql/pglite/dist/index.js> node family_app_1a_test.mjs   also runs family_app_1a.sql twice in a real Postgres
import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)])
const F = 'supabase/functions'
const fam = await import(pathToFileURL(path.resolve(F, '_shared/family-app.ts')).href)
const off = await import(pathToFileURL(path.resolve(F, '_shared/family-app-office.ts')).href)

// A Tuesday, 9:00 AM Central (14:00 UTC in October, CDT).
const NOW = new Date('2026-10-20T14:00:00Z')

// ── rules ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const T = fam.tasksFor('MO', {})
const v = (b) => fam.validateBooking({ tasks: ['Companionship'], who: 'regular', ...b }, NOW, T)
ck('central(): Tuesday 09:00', JSON.stringify(fam.central(NOW)) === JSON.stringify({ date: '2026-10-20', minutes: 540, dow: 2 }), fam.central(NOW))
ck('valid: Thu 10:00 for 3 hours ends 13:00', v({ date: '2026-10-22', start: '10:00', hours: 3 }).end === '13:00')
ck('half hours ok: 2.5 hours from 09:30 ends 12:00', v({ date: '2026-10-22', start: '09:30', hours: 2.5 }).end === '12:00')
ck('weekends refused', /Monday to Friday/.test(v({ date: '2026-10-24', start: '10:00', hours: 2 }).error))
ck('under 2 hours refused', /at least 2 hours/.test(v({ date: '2026-10-22', start: '10:00', hours: 1.5 }).error))
ck('past 6 PM refused', /8 AM and 6 PM/.test(v({ date: '2026-10-22', start: '16:30', hours: 2 }).error) && v({ date: '2026-10-22', start: '16:00', hours: 2 }).ok)
ck('before 8 AM refused', /8 AM and 6 PM/.test(v({ date: '2026-10-22', start: '07:30', hours: 2 }).error))
ck('2 hours notice: today 11:00 ok, 10:30 refused', v({ date: '2026-10-20', start: '11:00', hours: 2 }).ok && /2 hours ahead/.test(v({ date: '2026-10-20', start: '10:30', hours: 2 }).error))
ck('yesterday refused, 61 days refused', /2 hours ahead/.test(v({ date: '2026-10-19', start: '10:00', hours: 2 }).error) && /60 days/.test(v({ date: '2026-12-22', start: '10:00', hours: 2 }).error))
ck('odd minutes refused', /start time/.test(v({ date: '2026-10-22', start: '10:15', hours: 2 }).error))
ck('a task is required, unknown tasks refused', /what would help/.test(v({ date: '2026-10-22', start: '10:00', hours: 2, tasks: [] }).error) && /isn't something/.test(v({ date: '2026-10-22', start: '10:00', hours: 2, tasks: ['Bathing'] }).error))
ck('Oklahoma: extras hidden until the settings confirm them', !fam.tasksFor('OK', {}).includes('Rides to appointments') && fam.tasksFor('OK', { family_app_extra_tasks_OK: ['Rides to appointments', 'Bathing'] }).join() === [...fam.BASE_TASKS, 'Rides to appointments'].join())
ck('Missouri: extras on by default, and can be narrowed', fam.tasksFor('MO', {}).includes('Medication reminders') && !fam.tasksFor('MO', { family_app_extra_tasks_MO: [] }).includes('Medication reminders'))
ck('state from the AxisCare address', fam.stateOf({ residentialAddress: { state: 'ok' } }) === 'OK' && fam.stateOf({ residentialAddress: { state: 'KS' } }) === null)
ck('caregiver card: first name + last initial, hidden photo stays hidden', JSON.stringify(fam.cardOf({ axiscare_id: 7, first_name: 'Sarah', last_name: 'Jones', photo_path: 'a/p.jpg', photo_hidden: true, video_path: 'a/v.mp4' }, 'https://h.co')) === JSON.stringify({ axiscare_id: '7', name: 'Sarah J.', first_name: 'Sarah', photo: null, video: 'https://h.co/storage/v1/object/public/caregiver-profiles/a/v.mp4', about: null, experience: null, why: null, years: null }))
ck('only published, consented, not withdrawn profiles are shown', fam.shareable({ published: true, consent: true, status: 'active' }) && !fam.shareable({ published: true, consent: false }) && !fam.shareable({ published: true, consent: true, status: 'withdrawn' }))

// ── stand-ins ────────────────────────────────────────────────────────────────────────────────────────────────────────
let W
const utc = (date, hhmm) => { const [h, m] = hhmm.split(':').map(Number); return `${date}T${String(h + 5).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z` } // CDT = UTC-5
function reset(m = {}) {
  W = { visits: {}, bookings: [], items: [], events: [], calls: [], settings: { family_app_live: true, family_fee_check_ready: true, family_app_service_MO: 'PP - WC', family_app_cancel_reason: 'Schedule Change - Client Cancellation' },
    clientState: 'MO', notes: [], texts: [], notesFail: false, textFails: false, postFails: false, delFails: false, readbackWrong: false, insertFails: false, ...m }
  W.visits['v=1:s=5:d=2026-10-21'] = { id: 'v=1:s=5:d=2026-10-21', client: { id: 501 }, caregiver: { id: 77, firstName: 'Sarah' }, timezone: 'US/Central', scheduledStartDate: utc('2026-10-21', '09:00'), scheduledEndDate: utc('2026-10-21', '11:00') }
  W.visits['v=2:s=5:d=2026-09-30'] = { id: 'v=2:s=5:d=2026-09-30', client: { id: 501 }, caregiver: { id: 77, firstName: 'Sarah' }, timezone: 'US/Central', scheduledStartDate: utc('2026-09-30', '09:00'), scheduledEndDate: utc('2026-09-30', '11:00') }
  W.visits['v=3:s=5:d=2026-09-25'] = { id: 'v=3:s=5:d=2026-09-25', client: { id: 501 }, caregiver: { id: 88, firstName: 'Maria' }, timezone: 'US/Central', scheduledStartDate: utc('2026-09-25', '13:00'), scheduledEndDate: utc('2026-09-25', '15:00') }
  W.visits['v=9:s=6:d=2026-10-21'] = { id: 'v=9:s=6:d=2026-10-21', client: { id: 999 }, caregiver: { id: 77 }, timezone: 'US/Central', scheduledStartDate: utc('2026-10-21', '12:00'), scheduledEndDate: utc('2026-10-21', '14:00') }
}
const r = (status, json) => ({ status, json })
let vn = 100
const ax = async (method, p, body) => {
  W.calls.push([method, p, body]); const u = new URL('http://x' + p)
  if (method === 'GET' && u.pathname === '/api/clients/501') return r(200, { results: { client: { id: 501, firstName: 'Dorothy', goesBy: 'Dot', status: { active: true, label: 'Active' }, residentialAddress: { state: W.clientState } } } })
  if (method === 'GET' && u.pathname === '/api/visits/modification-reasons') return r(200, { results: { modificationReasons: [{ id: 3, name: 'Office Issue', disabled: true }, { id: 11, name: 'Schedule Change - Client Cancellation', disabled: false }, { id: 12, name: 'Booked by family in app', disabled: false }] } })
  if (method === 'GET' && u.pathname === '/api/visits') {
    const c = u.searchParams.get('clientIds'), s = u.searchParams.get('startDate'), e = u.searchParams.get('endDate')
    const list = Object.values(W.visits).filter((x) => String(x.client.id) === c && x.id.slice(-10) >= s && x.id.slice(-10) <= e)
    return list.length ? r(200, { results: { visits: list, nextPage: null } }) : r(404, { errors: ['No visits found'] })
  }
  if (method === 'POST' && u.pathname === '/api/visits') {
    if (W.postFails) return r(400, { errors: ['Unknown serviceCode: ' + body.serviceCode] })
    const id = `v=${++vn}:s=0:d=${body.visitDate}`
    W.visits[id] = { id, client: { id: body.clientId }, caregiver: body.caregiverId ? { id: body.caregiverId, firstName: 'Maria' } : null, timezone: 'US/Central', scheduledStartDate: utc(body.visitDate, body.startTime), scheduledEndDate: utc(body.visitDate, W.readbackWrong ? '23:00' : body.endTime) }
    return r(201, { visit: { ...W.visits[id] } })
  }
  const nm = u.pathname.match(/^\/api\/notes\/(client|caregiver)\/(\d+)$/)
  if (method === 'POST' && nm) { if (W.notesFail) return r(500, { errors: ['notes down'] }); W.notes.push({ on: nm[1], id: nm[2], ...body }); return r(201, { results: { id: W.notes.length } }) }
  if (method === 'GET' && u.pathname === '/api/caregivers/88') return r(200, { results: { caregiver: { id: 88, firstName: 'Maria', lastName: 'Lopez', status: { active: true } } } })
  if (method === 'GET' && u.pathname === '/api/caregivers/66') return r(200, { results: { caregiver: { id: 66, firstName: 'Gone', status: { active: false, label: 'Inactive' } } } })
  const vm = u.pathname.match(/^\/api\/visits\/(.+)$/)
  if (vm) { const id = decodeURIComponent(vm[1]); const x = W.visits[id]
    if (method === 'GET') return x ? r(200, { results: x }) : r(404, { errors: ['not found'] })
    if (method === 'PATCH') { if (body.caregiverId != null) x.caregiver = { id: body.caregiverId, firstName: 'Maria' }; return r(200, { results: { id } }) }
    if (method === 'DELETE') { if (W.delFails || !u.searchParams.get('modificationReason')) return r(400, { errors: ['A modification reason is required.'] }); delete W.visits[id]; return { status: 204, json: {} } }
  }
  return r(404, { errors: ['unexpected ' + method + ' ' + p] })
}
const WHO = { lisa: [{ contact_id: '00000009-aaaa-4bbb-8ccc-000000000009', name: 'Lisa Ray', circle_id: 'c1', axiscare_client_id: '501', client_name: 'Dorothy Ray', can_book: true }],
  viewer: [{ contact_id: '00000010-aaaa-4bbb-8ccc-000000000010', name: 'Tom Ray', circle_id: 'c1', axiscare_client_id: '501', client_name: 'Dorothy Ray', can_book: false }], nobody: [] }
let bid = 0
const deps = (who = 'lisa') => ({
  ax, now: () => NOW, supabaseUrl: 'https://h.co',
  settings: async () => W.settings,
  whoIs: async () => WHO[who],
  profiles: async (ids) => [{ axiscare_id: '77', first_name: 'Sarah', last_name: 'Jones', published: true, consent: true, photo_path: 's.jpg' }, { axiscare_id: '88', first_name: 'Maria', last_name: 'Lopez', published: false, consent: true }].filter((p) => ids.includes(p.axiscare_id)),
  bookings: async (cid) => W.bookings.filter((b) => b.axiscare_client_id === cid),
  insertBooking: async (row) => { if (W.insertFails) return null; const b = { id: `00000000-0000-0000-0000-${String(++bid).padStart(12, '0')}`, ...row }; W.bookings.push(b); return { id: b.id } },
  updateBooking: async (id, vals) => { Object.assign(W.bookings.find((b) => b.id === id), vals); return true },
  officeItem: async (item) => { const k = W.items.findIndex((x) => x.id === item.id); if (k >= 0) W.items[k] = item; else W.items.push(item); return true },
  event: async (row) => { W.events.push(row) },
  closeItem: async (id, by, text) => { const it = W.items.find((x) => x.id === id); if (it && it.status !== 'done') { it.status = 'done'; it.history = [...(it.history ?? []), { by, text }] } },
  textCaregiver: async (id, message) => { if (W.textFails) return { ok: false, why: 'opted out' }; W.texts.push({ id, message }); return { ok: true } },
})
const go = (body, who) => fam.familyAction(deps(who), { id: 'u-lisa', email: 'lisa@x.test' }, body)
// Release 1: a booking a caregiver has accepted (placed, with its AxisCare visit)
const confirm = (b, cg = null) => { const id = `v=${++vn}:s=0:d=${b.visit_date}`
  W.visits[id] = { id, client: { id: 501 }, caregiver: cg ? { id: Number(cg), firstName: 'Maria' } : null, timezone: 'US/Central', scheduledStartDate: utc(b.visit_date, b.start_time ?? '10:00'), scheduledEndDate: utc(b.visit_date, b.end_time ?? '13:00') }
  Object.assign(b, { axiscare_visit_id: id, status: cg ? 'placed' : 'waiting_for_caregiver', ...(cg ? { caregiver_axiscare_id: String(cg), caregiver_name: 'Maria L.' } : {}) }); return b }
const BOOK = { action: 'book', client: '501', date: '2026-10-22', start: '10:00', hours: 3, tasks: ['Companionship', 'Meal preparation'], who: 'regular', note: 'Soup please' }

// ── the family door ──────────────────────────────────────────────────────────────────────────────────────────────────
reset()
let o = await go({ action: 'me' }, 'nobody')
ck('a login not on any Family Circle gets nothing', o.status === 403 && W.calls.length === 0, o)
o = await go({ action: 'me' })
ck('me: name and their one client', o.status === 200 && o.body.name === 'Lisa Ray' && o.body.clients[0].id === '501' && o.body.clients[0].can_book === true, o)
o = await go({ action: 'home', client: '999' })
ck('asking for someone else\'s client is refused before AxisCare is asked', o.status === 403 && W.calls.length === 0, o)
o = await go({ action: 'home', client: '501' })
ck('home: upcoming visits in Central time with caregiver first name, nobody else\'s visits', o.status === 200 && o.body.visits.length === 1 && o.body.visits[0].start === '09:00' && o.body.visits[0].end === '11:00' && o.body.visits[0].caregiver.first_name === 'Sarah' && o.body.client.name === 'Dot' && o.body.client.state === 'MO' && o.body.office_phone === '(417) 234-8494', o)
ck('home: no rate when the client has no priced visits and no state rate is set; no short-visit extra in the app (her rule 2026-10-16)', o.body.rate === null && o.body.short_extra === 0 && o.body.short_under_hours === 4, o.body)
W.settings.family_app_rate_MO = 30; o = await go({ action: 'home', client: '501' })
ck('home: falls back to the state rate in the Hub settings', o.body.rate === 30, o.body.rate)
W.visits['v=2:s=5:d=2026-09-30'].chargeRate = 450; W.visits['v=2:s=5:d=2026-09-30'].type = 'Daily'; W.visits['v=2:s=5:d=2026-09-30'].billableRateMode = 'auto'
o = await go({ action: 'home', client: '501' })
ck('home: a visit billed per visit (not hourly) is never shown as an hourly rate (pilot check: a $450 DAILY live-in rate shown as "$450/hr"); the state rate instead', o.body.rate === 30, o.body.rate)
W.visits['v=2:s=5:d=2026-09-30'].chargeRate = 32; W.visits['v=2:s=5:d=2026-09-30'].type = 'Hourly'; W.visits['v=2:s=5:d=2026-09-30'].billableRateMode = 'auto'
W.visits['v=3:s=5:d=2026-09-25'].chargeRate = 29; W.visits['v=3:s=5:d=2026-09-25'].type = 'Hourly'; W.visits['v=3:s=5:d=2026-09-25'].billableRateMode = 'auto'
W.visits['v=1:s=5:d=2026-10-21'].chargeRate = 99; W.visits['v=1:s=5:d=2026-10-21'].type = 'Hourly'; W.visits['v=1:s=5:d=2026-10-21'].billableRateMode = 'custom'
o = await go({ action: 'home', client: '501' })
ck('home: the client\'s OWN rate from their most recent HOURLY visit (a custom one-off rate ignored)', o.body.rate === 32, o.body.rate)
W.settings.family_app_short_extra_MO = 5; o = await go({ action: 'home', client: '501' })
ck('home: the short-visit extra can still be set in the Hub settings', o.body.short_extra === 5, o.body.short_extra)
delete W.settings.family_app_short_extra_MO; delete W.settings.family_app_rate_MO
o = await go({ action: 'caregivers', client: '501' })
ck('caregivers: only published profiles of caregivers who visited, most visits first', o.status === 200 && o.body.caregivers.length === 1 && o.body.caregivers[0].name === 'Sarah J.' && o.body.caregivers[0].visits_together === 2 && o.body.caregivers[0].photo === 'https://h.co/storage/v1/object/public/caregiver-profiles/s.jpg', o)

reset(); W.calls = []
o = await go(BOOK, 'viewer')
ck('a view-only family member can\'t book', o.status === 403 && W.bookings.length === 0, o)
o = await go({ ...BOOK, hours: 1 })
ck('a broken rule comes back in plain words, nothing saved', o.status === 400 && /at least 2 hours/.test(o.body.error) && W.bookings.length === 0, o)
o = await go(BOOK)
const b1 = W.bookings[0]
// Release 1 (her approval 2026-10-17): a request, never "booked"; nothing on AxisCare until a caregiver accepts.
ck('book (live): saved as a request waiting for a caregiver, with its answer-by time; AxisCare NOT written', o.status === 200 && o.body.status === 'waiting_for_caregiver' && b1.status === 'waiting_for_caregiver' &&
  !b1.axiscare_visit_id && !W.calls.some((c) => c[0] === 'POST' || c[0] === 'PATCH') && b1.answer_by === '2026-10-21T23:00:00.000Z' && b1.two_stage === false, { o, b1, calls: W.calls.filter((c) => c[0] !== 'GET') })
ck('book: the family is told it is a request and when they will hear ("Wed, Oct 21, 6 PM"), never "booked"', /^Request sent\. We're asking caregivers now\. This isn't a scheduled visit yet\. You'll hear from us by Wed, Oct 21, 6 PM\.$/.test(o.body.message) && !/booked/i.test(o.body.message) && o.body.answer_by_words === 'Wed, Oct 21, 6 PM', o.body)
ck('book: offers off = the office gets one "Place a caregiver" card (offers on: none, see the offers tests)', W.items.length === 1 && /Place a caregiver/.test(W.items[0].title) && W.items[0].source.booking_id === b1.id && /Soup please/.test(W.items[0].detail) && /goes on AxisCare when a caregiver is placed/.test(W.items[0].detail), W.items)
ck('book: nothing is charged and no one is texted (no such calls exist)', !W.calls.some((c) => /pay|invoice|sms|email/i.test(c[1])))
o = await go(BOOK)
ck('the same slot twice is refused', o.status === 409 && W.bookings.length === 1, o)
// placing a caregiver is when the AxisCare visit is made, with them on it
W.calls = []
let pl = await fam.placeCaregiver(ax, b1, '88', null, W.settings)
const post = W.calls.find((c) => c[0] === 'POST')?.[2] ?? {}
ck('placing: AxisCare visit made now, 10:00 to 13:00, service PP - WC, with the caregiver, read back', pl.ok && post.startTime === '10:00' && post.endTime === '13:00' && post.serviceCode === 'PP - WC' && post.caregiverId === 88 && post.clientId === 501 &&
  pl.vals.axiscare_visit_id && pl.vals.caregiver_axiscare_id === '88', { pl, post })
reset({ settings: { family_app_live: true, family_fee_check_ready: true } })
pl = await fam.placeCaregiver(ax, { ...b1, axiscare_visit_id: null, state: 'MO' }, '88', null, W.settings)
ck('placing with no app service for the state: refused with the reason, nothing written', !pl.ok && /no app service/.test(pl.why) && !W.calls.some((c) => c[0] === 'POST'), pl)
reset({ postFails: true })
pl = await fam.placeCaregiver(ax, { ...b1, axiscare_visit_id: null, state: 'MO' }, '88', null, W.settings)
ck('placing: AxisCare refuses = not placed, with the reason', !pl.ok && /refused/.test(pl.why), pl)
reset({ readbackWrong: true })
pl = await fam.placeCaregiver(ax, { ...b1, axiscare_visit_id: null, state: 'MO' }, '88', null, W.settings)
ck('placing: read-back doesn\'t match = never confirmed', !pl.ok && /didn't read back/.test(pl.why), pl)
reset({ settings: { family_app_live: false, family_app_service_MO: 'PP - WC' } }); W.calls = []
o = await go(BOOK)
ck('practice mode: saved as practice, AxisCare never written', o.body.status === 'practice' && W.bookings[0].status === 'practice' && !W.calls.some((c) => c[0] !== 'GET') && W.items.length === 0 && !/booked/i.test(o.body.message), o)
reset({ insertFails: true })
o = await go(BOOK)
ck('the Hub can\'t save the request: AxisCare untouched, family told nothing was booked', o.status === 500 && /Nothing was booked/.test(o.body.error) && !W.calls.some((c) => c[0] === 'POST'), o)
// too soon (Tue 9 AM): today at 10:00 is too soon (1 hour of texting); the reply names the earliest time
reset()
o = await go({ ...BOOK, date: '2026-10-20', start: '11:30', hours: 2, end: undefined })
ck('too soon to request: refused, says the earliest time that day', o.status === 409 && /too soon to request/.test(o.body.error) && /1 PM/.test(o.body.error) && W.bookings.length === 0, o)
o = await go({ action: 'when', client: '501', date: '2026-10-22', start: '10:00' })
ck('when: before sending, the family sees when they will hear', o.status === 200 && o.body.ok === true && o.body.answer_by_words === 'Wed, Oct 21, 6 PM' && o.body.two_stage === false, o.body)
o = await go({ action: 'when', client: '501', date: '2026-11-05', start: '10:00' })
ck('when: more than 7 days ahead = two stages, the team from 8 AM a week before, final answer 2 days before', o.body.ok && o.body.two_stage === true && o.body.team_from_words === 'Thu, Oct 29, 8 AM' && o.body.answer_by_words === 'Tue, Nov 3, 6 PM', o.body)
o = await go({ action: 'when', client: '501', date: '2026-10-20', start: '10:00' })
ck('when: too soon = not ok, with the earliest time (1 PM)', o.body.ok === false && o.body.earliest === '13:00', o.body)
o = await go({ action: 'home', client: '501' })
ck('home: the earliest start for today, tomorrow and the day after (the picker greys out the rest)', o.body.earliest && o.body.earliest['2026-10-20'] === '13:00' && o.body.earliest['2026-10-21'] === '07:00', o.body.earliest)
reset({ clientState: 'KS' })
o = await go(BOOK)
ck('an address outside MO/OK can\'t book online', o.status === 409 && W.bookings.length === 0, o)
reset({ clientState: 'OK', settings: { family_app_live: true, family_fee_check_ready: true, family_app_service_OK: 'OK - COMP' } })
o = await go({ ...BOOK, tasks: ['Rides to appointments'] })
ck('Oklahoma: rides refused until confirmed in settings', o.status === 400 && /isn't something/.test(o.body.error), o)

// cancel
reset(); await go(BOOK); W.calls = []
const id1 = W.bookings[0].id
o = await go({ action: 'cancel', client: '501', booking_id: id1 })
ck('cancel a request nobody accepted: cancelled, nothing on AxisCare touched, no note, no charge', o.status === 200 && W.bookings[0].status === 'cancelled' && !W.calls.some((c) => c[0] !== 'GET') &&
  W.notes.length === 0 && W.texts.length === 0 && /^Request cancelled\. Nothing was scheduled and there's no charge\.$/.test(o.body.message), { o, calls: W.calls })
ck('the request\'s "Place a caregiver" card is closed with who cancelled', W.items.some((i) => i.id.startsWith('fam_book') && i.status === 'done' && /Lisa Ray cancelled this request in the app/.test(i.history.at(-1).text)), W.items)
reset(); await go(BOOK); confirm(W.bookings[0]); W.calls = []
o = await go({ action: 'cancel', client: '501', booking_id: W.bookings[0].id })
ck('cancel 2 days ahead, on AxisCare: removed with the client-cancellation reason, client note with who and when, nothing charged', o.status === 200 && W.bookings[0].status === 'cancelled' && !W.visits[W.bookings[0].axiscare_visit_id] &&
  W.calls.some((c) => c[0] === 'DELETE' && /modificationReason=11/.test(c[1])) && W.notes.length === 1 && /Cancelled by Lisa Ray on Tue Oct 20, 2026 at 9 AM Central/.test(W.notes[0].note) && /Nothing is charged/.test(o.body.message), { o, notes: W.notes })
// 2 days ahead with a caregiver placed: they're texted, notes on both records, no card
reset(); await go(BOOK); Object.assign(W.bookings[0], { caregiver_axiscare_id: '88', caregiver_name: 'Maria L.', status: 'placed' }); W.items = []
o = await go({ action: 'cancel', client: '501', booking_id: W.bookings[0].id })
ck('caregiver placed: texted at once, note on the client AND the caregiver, no office card', o.status === 200 && W.texts.length === 1 && W.texts[0].id === '88' &&
  /^Hi Maria, the family cancelled Dot's visit on Thu Oct 22, 10 AM to 1 PM\. It's off your schedule/.test(W.texts[0].message) && !/paid/.test(W.texts[0].message) &&
  W.notes.some((n) => n.on === 'caregiver' && n.id === '88' && /Maria L\. was scheduled and has been taken off the visit/.test(n.note)) && W.items.length === 0, { t: W.texts, n: W.notes, i: W.items })
// inside 24 hours: the app must ask first
reset(); W.bookings.push({ id: 'b-soon', axiscare_client_id: '501', client_name: 'Dot', visit_date: '2026-10-21', start_time: '08:30', end_time: '10:30', hours: 2, status: 'placed', axiscare_visit_id: 'v=50:s=0:d=2026-10-21', caregiver_axiscare_id: '88', caregiver_name: 'Maria L.' })
W.visits['v=50:s=0:d=2026-10-21'] = { id: 'v=50:s=0:d=2026-10-21', client: { id: 501 }, caregiver: { id: 88 } }
o = await go({ action: 'cancel', client: '501', booking_id: 'b-soon' })
ck('inside 24 hours without the yes: asks first (2 hours charged), nothing removed, nobody texted', o.status === 409 && o.body.late === true && o.body.late_hours === 2 && /less than 24 hours away, so 2 hours will still be charged/.test(o.body.error) &&
  W.bookings[0].status === 'placed' && W.visits['v=50:s=0:d=2026-10-21'] && W.texts.length === 0 && W.notes.length === 0, o)
o = await go({ action: 'cancel', client: '501', booking_id: 'b-soon', late_ok: true })
ck('inside 24 hours with the yes: removed, caregiver texted that they are paid 2 hours', o.status === 200 && o.body.late === true && W.bookings[0].status === 'cancelled' && !W.visits['v=50:s=0:d=2026-10-21'] &&
  /you'll still be paid for 2 hours/.test(W.texts[0]?.message) && /2 hours will be on your weekly invoice/.test(o.body.message), { o, t: W.texts })
ck('late cancel: important note says charge the family 2 hours and pay the caregiver 2 hours', W.notes.length === 2 && W.notes.every((n) => n.important === true && /Late cancel \(less than 24 hours before\): charge the family 2 hours and pay Maria L\. 2 hours/.test(n.note)), W.notes)
// 2026-10-17 office check ("Check for anytime it's involving office staff when it shouldn't"): the approved model puts late
// charges on a weekly billing list, not an office card, when everything else went through
ck('late cancel: no office card; the charge goes on the billing list (2 hours, pay Maria L.)', W.items.length === 0 && W.bookings[0].late_charge_hours === 2 && W.bookings[0].late_pay_caregiver === 'Maria L.', { items: W.items, b: W.bookings[0] })
ck('late cancel: the event records it', W.events.some((e) => e.verb === 'family_cancelled' && e.data.late === true && e.data.late_hours === 2 && e.data.caregiver_texted === true), W.events)
// the setting can change the 2 hours
reset({ settings: { family_app_live: true, family_fee_check_ready: true, family_app_cancel_reason: 'Schedule Change - Client Cancellation', family_app_late_cancel_hours: 3 } })
W.bookings.push(confirm({ id: 'b-soon', axiscare_client_id: '501', client_name: 'Dot', visit_date: '2026-10-21', start_time: '08:30', end_time: '10:30', hours: 2, status: 'waiting_for_caregiver' }, '88'))
o = await go({ action: 'cancel', client: '501', booking_id: 'b-soon' })
ck('family_app_late_cancel_hours sets the late charge', o.body.late_hours === 3 && /3 hours will still be charged/.test(o.body.error), o)
// text fails / notes fail: never silent
reset(); await go(BOOK); confirm(W.bookings[0], '88'); W.items = []; W.textFails = true; W.notesFail = true
o = await go({ action: 'cancel', client: '501', booking_id: W.bookings[0].id })
ck('text or notes fail: the office card says call the caregiver and add the note', o.status === 200 && W.items.length === 1 && /The text to Maria L\. didn't go \(opted out\)\. Please call them/.test(W.items[0].detail) && /note didn't save on Dot's AxisCare record/.test(W.items[0].detail), W.items)
// started or past: call the office
reset(); W.bookings.push({ id: 'b-now', axiscare_client_id: '501', client_name: 'Dot', visit_date: '2026-10-20', start_time: '08:00', end_time: '10:00', hours: 2, status: 'placed' })
o = await go({ action: 'cancel', client: '501', booking_id: 'b-now', late_ok: true })
ck('a visit that already started: call the office, nothing changed', o.status === 409 && /already started/.test(o.body.error) && /234-8494/.test(o.body.error) && W.bookings[0].status === 'placed', o)
// practice mode: nothing in AxisCare, nobody texted
reset({ settings: { family_app_live: false } }); W.bookings.push({ id: 'b-p', axiscare_client_id: '501', client_name: 'Dot', visit_date: '2026-10-21', start_time: '08:30', end_time: '10:30', hours: 2, status: 'practice', caregiver_axiscare_id: '88', caregiver_name: 'Maria L.' })
o = await go({ action: 'cancel', client: '501', booking_id: 'b-p', late_ok: true })
ck('practice mode: cancelled, no AxisCare calls past the client read, no text, no card', o.status === 200 && /Practice mode/.test(o.body.message) && W.texts.length === 0 && W.notes.length === 0 && W.items.length === 0 && !W.calls.some((c) => c[0] !== 'GET'), o)
reset(); await go(BOOK); confirm(W.bookings[0]); W.delFails = true
o = await go({ action: 'cancel', client: '501', booking_id: W.bookings[0].id })
ck('AxisCare refuses the removal: cancelled for the family, office card to finish it', o.status === 200 && W.items.some((i) => /refused to remove/.test(i.detail)), o)

// ── the office ───────────────────────────────────────────────────────────────────────────────────────────────────────
let OW
function oreset(m = {}) {
  OW = { contacts: { '00000009-aaaa-4bbb-8ccc-000000000009': { id: '00000009-aaaa-4bbb-8ccc-000000000009', name: 'Lisa Ray', email: 'Lisa@X.test', circle_id: 'c1', app_user_id: null, app_status: null }, '00000010-aaaa-4bbb-8ccc-000000000010': { id: '00000010-aaaa-4bbb-8ccc-000000000010', name: 'Tom', email: '', circle_id: 'c1' }, '00000011-aaaa-4bbb-8ccc-000000000011': { id: '00000011-aaaa-4bbb-8ccc-000000000011', name: 'Gone', email: 'g@x.test', circle_id: 'c1', stopped_at: '2026-01-01' } },
    circles: { c1: { id: 'c1', client_name: 'Dorothy Ray', active: true, axiscare_client_id: '501' } }, logins: {}, blocked: {}, closed: [], events: [], createFails: false,
    rps: ['lisa@x.test'], rpFail: false, sent: [], log: [], sendFail: [], ...m }
}
const odeps = () => ({
  ax, now: () => NOW, settings: async () => W.settings,
  contact: async (id) => OW.contacts[id] ? { ...OW.contacts[id] } : null,
  circle: async (id) => OW.circles[id] ?? null,
  updateContact: async (id, vals) => { Object.assign(OW.contacts[id], vals); return true },
  circleContacts: async (cid) => Object.values(OW.contacts).filter((c) => c.circle_id === cid).map((c) => ({ ...c })),
  members: async () => Object.values(OW.contacts).filter((c) => c.app_status),
  recentBookings: async () => W.bookings,
  booking: async (id) => W.bookings.find((b) => b.id === id) ?? null,
  updateBooking: async (id, vals) => { Object.assign(W.bookings.find((b) => b.id === id), vals); return true },
  closeItem: async (id, by, text) => { OW.closed.push([id, by, text]) },
  event: async (row) => { OW.events.push(row) },
  rpEmails: async () => OW.rpFail ? null : OW.rps,
  send: async (c, channel, payload) => { OW.sent.push([c.id, channel, payload]); return !(OW.sendFail || []).includes(channel) },
  logMessage: async (row) => { OW.log.push(row) },
  plans: async () => [], setPlan: async (id, vals) => { OW.plan = { id, ...vals }; return true }, setAbout: async (id, vals) => { OW.about = { id, ...vals }; return true }, markBilled: async () => true, fee: null,
  login: {
    create: async (email) => { if (OW.createFails) return { error: 'boom' }; if (OW.logins[email]) return { error: 'A user with this email address has already been registered', exists: true }; OW.logins[email] = 'uid-' + email; return { id: OW.logins[email] } },
    find: async (email) => OW.logins[email] ?? null,
    block: async (uid, on) => { OW.blocked[uid] = on; return true },
  },
})
const staff = { name: 'Krystal Land', email: 'krystal@cc.test' }
let CLOCK = null
const office = (body) => off.officeAction(CLOCK ? { ...odeps(), now: () => CLOCK } : odeps(), staff, body)
oreset()
o = await office({ action: 'invite', contact_id: '00000009-aaaa-4bbb-8ccc-000000000009', can_book: true })
ck('invite: login made (email lower-cased), turned on, words for a person to send, nothing sent', o.status === 200 && OW.contacts['00000009-aaaa-4bbb-8ccc-000000000009'].app_user_id === 'uid-lisa@x.test' && OW.contacts['00000009-aaaa-4bbb-8ccc-000000000009'].app_status === 'active' && OW.contacts['00000009-aaaa-4bbb-8ccc-000000000009'].app_can_book === true && /family\.mo-care\.com/.test(o.body.words) && /Hi Lisa/.test(o.body.words) && OW.events[0].verb === 'family_app_invited', o)
o = await office({ action: 'invite', contact_id: '00000010-aaaa-4bbb-8ccc-000000000010' })
ck('invite needs an email first', o.status === 409 && /email/.test(o.body.error), o)
o = await office({ action: 'invite', contact_id: '00000011-aaaa-4bbb-8ccc-000000000011' })
ck('invite refused for someone removed from the circle', o.status === 409, o)
oreset(); OW.logins['lisa@x.test'] = 'uid-existing'
o = await office({ action: 'invite', contact_id: '00000009-aaaa-4bbb-8ccc-000000000009' })
ck('invite when the login already exists: reconnects to it', o.status === 200 && OW.contacts['00000009-aaaa-4bbb-8ccc-000000000009'].app_user_id === 'uid-existing', o)
oreset({ createFails: true })
o = await office({ action: 'invite', contact_id: '00000009-aaaa-4bbb-8ccc-000000000009' })
ck('login not created: nothing changed in the Hub', o.status === 502 && OW.contacts['00000009-aaaa-4bbb-8ccc-000000000009'].app_status === null, o)
oreset(); await office({ action: 'invite', contact_id: '00000009-aaaa-4bbb-8ccc-000000000009' })
o = await office({ action: 'revoke', contact_id: '00000009-aaaa-4bbb-8ccc-000000000009' })
ck('revoke: off in the Hub at once and sign-in blocked', o.status === 200 && OW.contacts['00000009-aaaa-4bbb-8ccc-000000000009'].app_status === 'revoked' && OW.blocked['uid-lisa@x.test'] === true, o)
o = await office({ action: 'invite', contact_id: '00000009-aaaa-4bbb-8ccc-000000000009' })
ck('invite again after revoke: unblocked, same login', o.status === 200 && OW.blocked['uid-lisa@x.test'] === false && OW.contacts['00000009-aaaa-4bbb-8ccc-000000000009'].app_status === 'active', o)
o = await office({ action: 'can_book', contact_id: '00000009-aaaa-4bbb-8ccc-000000000009', on: false })
ck('booking can be turned off for one person', o.status === 200 && OW.contacts['00000009-aaaa-4bbb-8ccc-000000000009'].app_can_book === false, o)

// welcome (her design 2026-10-17: a person picks the version, previews, sends; recorded; a second send asks first)
reset(); oreset(); await office({ action: 'invite', contact_id: '00000009-aaaa-4bbb-8ccc-000000000009' }); Object.assign(OW.contacts['00000009-aaaa-4bbb-8ccc-000000000009'], { phone: '4175550100', sms_consent: true, hipaa_authorized: true })
ck('invite no longer turns on the App plan (it follows the Care Scheduling Type now)', !OW.plan, OW.plan)
o = await office({ action: 'welcome', contact_id: '00000009-aaaa-4bbb-8ccc-000000000009' })
ck('preview with no Care Scheduling Type: asks which version, shows no words yet, nothing sent', o.status === 200 && o.body.preview && o.body.kind === null && o.body.text === null && o.body.kinds.map((x) => x.label).join('|') === 'Regular Scheduled Care|Flexible Booking Care|Combination of Both' && OW.sent.length === 0, o.body)
o = await office({ action: 'welcome', contact_id: '00000009-aaaa-4bbb-8ccc-000000000009', kind: 'flexible' })
ck('preview Flexible: the Flexible text and email, both parts, MO phone', o.body.kind === 'flexible' && /request care for Dorothy whenever you need it/.test(o.body.text) && /Care when you need it/.test(o.body.email_html) && o.body.include_axis === true && o.body.axis_email_on_file === true && /234-8494/.test(o.body.text), o.body)
o = await office({ action: 'welcome', contact_id: '00000009-aaaa-4bbb-8ccc-000000000009', send: true })
ck('send without a version: refused (never guessed)', o.status === 400 && /Pick how this client schedules care/.test(o.body.error) && OW.sent.length === 0, o)
OW.rps = ['someone@else.test']; o = await office({ action: 'welcome', contact_id: '00000009-aaaa-4bbb-8ccc-000000000009', kind: 'regular' })
ck('preview: email not on AxisCare -> flagged, AxisCare part left out by default', o.body.axis_email_on_file === false && o.body.include_axis === false && !/16485/.test(o.body.text) && /16485/.test(o.body.text_with_axis), o.body)
OW.rps = ['lisa@x.test']
o = await office({ action: 'welcome', contact_id: '00000009-aaaa-4bbb-8ccc-000000000009', kind: 'flexible', send: true, text: 'Edited words', include_axis: true })
const em = OW.sent.find((x) => x[1] === 'email')
ck('send Flexible: the edited text, the Flexible email with both buttons, logged on the circle', o.status === 200 && o.body.by_text && o.body.by_email && OW.sent.find((x) => x[1] === 'sms')[2].message === 'Edited words'
   && /Open the Booking App/.test(em[2].html) && /Activate your account/.test(em[2].html) && /lisa@x\.test/.test(em[2].html) && OW.log[0].circle_id === 'c1' && OW.log[0].body === 'Edited words', [o.body, OW.log])
ck('the record: date and time, who, which version, how', OW.contacts['00000009-aaaa-4bbb-8ccc-000000000009'].welcome_sent_at === NOW.toISOString() && OW.contacts['00000009-aaaa-4bbb-8ccc-000000000009'].welcome_sent_by === 'Krystal Land' && OW.contacts['00000009-aaaa-4bbb-8ccc-000000000009'].welcome_version === 'flexible' && OW.contacts['00000009-aaaa-4bbb-8ccc-000000000009'].welcome_how === 'text + email', OW.contacts['00000009-aaaa-4bbb-8ccc-000000000009'])
ck('the version is remembered on the client and sets the App plan default: Flexible = on', OW.plan?.care_scheduling_type === 'flexible' && OW.plan?.app_plan === true && OW.plan?.app_plan_since === '2026-10-20', OW.plan)
ck('the reminder card closes once sent', OW.closed.some((x) => x[0] === 'fam_welcome_c1'))
OW.circles.c1.care_scheduling_type = 'flexible'; OW.sent = []
o = await office({ action: 'welcome', contact_id: '00000009-aaaa-4bbb-8ccc-000000000009', send: true })
ck('a second send asks first ("Already sent on ... Send it again?"), sends nothing', o.status === 409 && o.body.already && /Already sent on Tue Oct 20, 2026 at 9 AM Central by Krystal Land\. Send it again\?/.test(o.body.error) && OW.sent.length === 0, o.body)
o = await office({ action: 'welcome', contact_id: '00000009-aaaa-4bbb-8ccc-000000000009', send: true, again: true })
ck('...and "again" sends it (the saved version), recorded again', o.status === 200 && OW.sent.length === 2 && o.body.version === 'flexible')
OW.contacts[12] = { id: 12, name: 'Lisa (2nd row)', email: 'lisa@x.test', circle_id: 'c1', app_status: 'active', hipaa_authorized: true }
o = await office({ action: 'welcome', contact_id: 12, send: true })
ck('the same email for this client already got it (a couple sharing an inbox): asks first', o.status === 409 && /to Lisa Ray at the same email/.test(o.body.error), o.body)
reset(); oreset(); await office({ action: 'invite', contact_id: '00000009-aaaa-4bbb-8ccc-000000000009' }); Object.assign(OW.contacts['00000009-aaaa-4bbb-8ccc-000000000009'], { hipaa_authorized: null })
o = await office({ action: 'welcome', contact_id: '00000009-aaaa-4bbb-8ccc-000000000009', kind: 'regular', send: true })
ck('no HIPAA permission on file: refused, says why, nothing sent', o.status === 409 && /HIPAA permission/.test(o.body.error) && OW.sent.length === 0, o)
Object.assign(OW.contacts['00000009-aaaa-4bbb-8ccc-000000000009'], { hipaa_authorized: true }); CLOCK = new Date('2026-10-21T00:30:00Z')   // 7:30 PM
o = await office({ action: 'welcome', contact_id: '00000009-aaaa-4bbb-8ccc-000000000009', kind: 'regular', send: true })
ck('after 6 PM: says plainly it goes 8 AM to 6 PM, nothing sent (no false "card" message)', o.status === 409 && /between 8 AM and 6 PM/.test(o.body.error) && OW.sent.length === 0, o)
CLOCK = null
o = await office({ action: 'welcome', contact_id: '00000009-aaaa-4bbb-8ccc-000000000009', kind: 'regular', send: true, include_axis: false })
ck('Regular, without the AxisCare part: the email is the Booking App only', o.status === 200 && !/Activate your account/.test(OW.sent.find((x) => x[1] === 'email')[2].html))
ck('Regular sets the App plan default off', OW.plan?.care_scheduling_type === 'regular' && OW.plan?.app_plan === false, OW.plan)
reset(); oreset(); await office({ action: 'invite', contact_id: '00000009-aaaa-4bbb-8ccc-000000000009' }); Object.assign(OW.contacts['00000009-aaaa-4bbb-8ccc-000000000009'], { hipaa_authorized: true, sms_consent: false })
await office({ action: 'welcome', contact_id: '00000009-aaaa-4bbb-8ccc-000000000009', kind: 'both', send: true })
ck('no Texts OK: email only, never a text', OW.sent.length === 1 && OW.sent[0][1] === 'email', OW.sent)
OW.contacts['00000009-aaaa-4bbb-8ccc-000000000009'].welcome_sent_at = null; OW.sendFail = ['email']; OW.sent = []; o = await office({ action: 'welcome', contact_id: '00000009-aaaa-4bbb-8ccc-000000000009', kind: 'both', send: true })
ck('nothing went: said plainly, nothing recorded as sent', o.status === 502 && /Neither/.test(o.body.error) && !OW.contacts['00000009-aaaa-4bbb-8ccc-000000000009'].welcome_sent_at, o)
o = await office({ action: 'scheduling_type', circle_id: 'c1', kind: 'weekly' })
ck('Care Scheduling Type: only the three choices', o.status === 400)
o = await office({ action: 'scheduling_type', circle_id: 'c1', kind: 'flexible' })
ck('Care Scheduling Type can be changed anytime; Flexible turns the App plan on', o.status === 200 && OW.plan.app_plan === true && OW.events.some((e) => e.verb === 'family_scheduling_type'))
o = await office({ action: 'welcome_skip', contact_id: '00000009-aaaa-4bbb-8ccc-000000000009', on: true })
ck('"No welcome" needs a reason', o.status === 400)
o = await office({ action: 'welcome_skip', contact_id: '00000009-aaaa-4bbb-8ccc-000000000009', on: true, reason: 'Live-in client' })
ck('"No welcome" recorded with who and why', o.status === 200 && OW.contacts['00000009-aaaa-4bbb-8ccc-000000000009'].welcome_skip_reason === 'Live-in client' && OW.contacts['00000009-aaaa-4bbb-8ccc-000000000009'].welcome_skip_by === 'Krystal Land')
// the caregiver About (her rule 2026-10-16)
reset(); oreset()
o = await office({ action: 'about', circle_id: 'c1', text: '  Dot loves   gardening and old movies.  ' })
ck('About: saved tidied, with who and when, and recorded', o.status === 200 && OW.about.caregiver_about === 'Dot loves gardening and old movies.' && OW.about.caregiver_about_by && OW.about.caregiver_about_at && OW.events.some((e) => e.verb === 'family_app_about'), [o, OW.about])
o = await office({ action: 'about', circle_id: 'c1', text: 'Lives at 1234 Elm Street, loves cards.' })
ck('About: an address is refused (caregivers get it in AxisCare)', o.status === 400 && /leave out the address/.test(o.body.error), o)
o = await office({ action: 'about', circle_id: 'c1', text: 'x'.repeat(401) })
ck('About: 400 characters at most', o.status === 400, o)
o = await office({ action: 'about', circle_id: 'c1', text: '' })
ck('About: empty clears it (no About row on the link)', o.status === 200 && OW.about.caregiver_about === null, OW.about)
o = await office({ action: 'place', booking_id: 'nope' })
ck('(office place still answers)', o.status >= 400, o)

// two brands (2026-10-16): the welcome is branded by the client's AxisCare state, never guessed
reset({ clientState: 'OK' }); oreset(); await office({ action: 'invite', contact_id: '00000009-aaaa-4bbb-8ccc-000000000009' })
o = await office({ action: 'welcome', contact_id: '00000009-aaaa-4bbb-8ccc-000000000009' })
ck('Oklahoma client: no welcome until the Oklahoma family app exists (never the Missouri one)', o.status === 409 && /isn't set up for Caring Companions Oklahoma yet/.test(o.body.error) && OW.sent.length === 0, o)
reset({ clientState: '' }); oreset(); await office({ action: 'invite', contact_id: '00000009-aaaa-4bbb-8ccc-000000000009' })
o = await office({ action: 'welcome', contact_id: '00000009-aaaa-4bbb-8ccc-000000000009', send: true, text: 'x' })
ck('no state in AxisCare: nothing sent, the reason says fix the address (no Missouri default)', o.status === 409 && /isn't Missouri or Oklahoma/.test(o.body.error) && OW.sent.length === 0, o)
reset({ clientState: 'KS' }); oreset(); await office({ action: 'invite', contact_id: '00000009-aaaa-4bbb-8ccc-000000000009' })
o = await office({ action: 'welcome', contact_id: '00000009-aaaa-4bbb-8ccc-000000000009' })
ck('a Kansas address: refused, says what AxisCare has', o.status === 409 && /it says KS/.test(o.body.error), o)
reset()
oreset(); o = await office({ action: 'welcome', contact_id: '00000009-aaaa-4bbb-8ccc-000000000009' })
ck('welcome before invite: refused', o.status === 409 && /Invite/.test(o.body.error), o)
const ofx = fs.readFileSync(path.join(F, 'family-app-office/index.ts'), 'utf8')
ck('welcome goes through the family-safe door: audience family, humanInitiated, named channel, checked send', /audience: 'family', humanInitiated: true, channel/.test(ofx) && /ghlSendChecked\(db/.test(ofx))

reset(); oreset(); await go(BOOK)
const bk = W.bookings[0]
o = await office({ action: 'place', booking_id: bk.id, caregiver_axiscare_id: '66' })
ck('place: an inactive caregiver is refused, and no AxisCare visit is made', o.status === 409 && !bk.axiscare_visit_id && !W.calls.some((c) => c[0] === 'POST'), o)
o = await office({ action: 'place', booking_id: bk.id, caregiver_axiscare_id: '88' })
ck('place: the AxisCare visit is made now with Maria on it, read back, booking placed, office card closed', o.status === 200 && W.visits[bk.axiscare_visit_id]?.caregiver?.id === 88 && W.calls.some((c) => c[0] === 'POST' && c[2]?.caregiverId === 88) && bk.status === 'placed' && bk.caregiver_name === 'Maria L.' && OW.closed[0][0] === `fam_book_${bk.id}`, o)
ck('place by the office: the family is queued to hear who is coming (her rule 2026-10-16)', bk.family_confirm_pending === true, bk)
reset({ settings: { family_app_live: true, family_fee_check_ready: true } }); oreset(); await go(BOOK)
W.settings.family_app_service_MO = 'PP - WC'
o = await office({ action: 'schedule', booking_id: W.bookings[0].id })
ck('schedule (Release 1): retired; requests go on AxisCare only when a caregiver is placed', o.status === 409 && /when a caregiver is placed/.test(o.body.error) && !W.bookings[0].axiscare_visit_id && !W.calls.some((c) => c[0] === 'POST'), o)
o = await office({ action: 'schedule', booking_id: W.bookings[0].id })
ck('schedule twice is refused (no double visit)', o.status === 409, o)

// ── the function files ───────────────────────────────────────────────────────────────────────────────────────────────
const gw = fs.readFileSync(path.join(F, 'family-gateway/index.ts'), 'utf8')
const of = fs.readFileSync(path.join(F, 'family-app-office/index.ts'), 'utf8')
ck('gateway: checks the token with cc-family-app itself and refuses banned logins', /\/auth\/v1\/user/.test(gw) && /banned_until/.test(gw) && /FAMILY_APP_ANON_KEY/.test(gw))
ck('gateway: CORS for family.mo-care.com from day one (OPTIONS first)', /family\.mo-care\.com/.test(gw) && /req\.method === 'OPTIONS'/.test(gw))
ck('office: staff only (requireStaff with OFFICE_ROLES), CORS', /requireStaff\(db, req, OFFICE_ROLES\)/.test(of) && /req\.method === 'OPTIONS'/.test(of))
ck('no secret or key is written in any file', ![gw, of, fs.readFileSync(path.join(F, '_shared/family-app.ts'), 'utf8')].some((s) => /sb_secret_|sbp_|eyJhbGci/.test(s)))
ck('no em dashes in anything a family or the office reads', ![fs.readFileSync(path.join(F, '_shared/family-app.ts'), 'utf8'), fs.readFileSync(path.join(F, '_shared/family-app-office.ts'), 'utf8')].some((s) => /'[^'\n]*—[^'\n]*'|`[^`\n]*—[^`\n]*`/.test(s)))

// ── the SQL in a real Postgres ───────────────────────────────────────────────────────────────────────────────────────
if (process.env.PGLITE) {
  const { PGlite } = await import(process.env.PGLITE)
  const db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table public.care_circles (id text primary key, client_name text, active boolean default true, axiscare_client_id text);
    create table public.circle_contacts (id bigserial primary key, circle_id text, name text, email text, stopped_at timestamptz, axiscare_removed_at timestamptz);
    create table public.app_data (key text primary key, data jsonb);
    insert into public.app_data values ('ops_settings', '{"family_app_service_MO":"KEEP-MINE","other":1}');
    create function public.hub_office_ok() returns boolean language sql as 'select true';`)
  const sql = fs.readFileSync('family_app_1a.sql', 'utf8')
  const tryQ = async (q) => { try { await db.exec(q); return 'ok' } catch (e) { return 'refused: ' + e.message } }
  ck('PGLITE: 1a installs, and installs again', (await tryQ(sql)) === 'ok' && (await tryQ(sql)) === 'ok')
  const s = (await db.query(`select data from public.app_data where key='ops_settings'`)).rows[0].data
  ck('PGLITE: settings added only where not set (her own values kept), practice mode on', s.family_app_service_MO === 'KEEP-MINE' && s.other === 1 && s.family_app_live === false && s.family_app_cancel_reason === 'Schedule Change - Client Cancellation', s)
  await db.exec(`insert into public.care_circles values ('c1','Dot',true,'501'); insert into public.circle_contacts (circle_id,name) values ('c1','Lisa')`)
  ck('PGLITE: app_status only active or revoked', (await tryQ(`update public.circle_contacts set app_status='maybe'`)).startsWith('refused') && (await tryQ(`update public.circle_contacts set app_status='active'`)) === 'ok')
  const ins = (d, st, h = 2) => tryQ(`insert into public.family_bookings (axiscare_client_id, visit_date, start_time, end_time, hours, status) values ('501','${d}','${st}','12:00',${h},'received')`)
  ck('PGLITE: bookings: under 2 hours refused, one slot once', (await ins('2026-10-22', '10:00', 1)).startsWith('refused') && (await ins('2026-10-22', '10:00')) === 'ok' && (await ins('2026-10-22', '10:00')).startsWith('refused'))
  ck('PGLITE: a cancelled slot can be booked again', (await tryQ(`update public.family_bookings set status='cancelled'`)) === 'ok' && (await ins('2026-10-22', '10:00')) === 'ok')
  const g = (await db.query(`select grantee, privilege_type from information_schema.role_table_grants where table_name='family_bookings' and grantee in ('anon','authenticated') order by 1,2`)).rows
  ck('PGLITE: family_bookings: anon nothing, office read only (writes are the server\'s)', JSON.stringify(g) === JSON.stringify([{ grantee: 'authenticated', privilege_type: 'SELECT' }]), g)
}

for (const [n, ok, note] of res) console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note))
const bad = res.filter((x) => !x[1]).length
console.log(`\n  family app 1a: ${res.length - bad}/${res.length} passed`)
process.exit(bad ? 1 : 0)
