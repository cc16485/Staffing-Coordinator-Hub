// Flexible booking + caregiver offers (her yes 2026-10-16). Under Node against the REAL _shared/family-app.ts,
// family-app-office.ts, family-offer.ts and offer-links.ts with a stand-in AxisCare, Hub database and texting.
// Nothing real is touched.
//   node family_app_flex_test.mjs
//   PGLITE=<path to @electric-sql/pglite/dist/index.js> node family_app_flex_test.mjs   also installs family_app_1a.sql then family_app_flex.sql twice
import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)])
const F = 'supabase/functions'
const imp = (p) => import(pathToFileURL(path.resolve(F, p)).href)
const fam = await imp('_shared/family-app.ts')
const off = await imp('_shared/family-app-office.ts')
const fo = await imp('_shared/family-offer.ts')
const links = await imp('_shared/offer-links.ts')

// A Tuesday, 9:00 AM Central (14:00 UTC in October, CDT).
let NOW = new Date('2026-10-20T14:00:00Z')
const T = fam.tasksFor('MO', {})
const MO = fam.hoursFor('MO', {}), OK = fam.hoursFor('OK', {})

// ── hours per state ──────────────────────────────────────────────────────────────────────────────────────────────────
ck('Missouri: any day, 7 AM to 6 PM, 2 hours minimum', MO.days.join() === '0,1,2,3,4,5,6' && MO.open === '07:00' && MO.close === '18:00' && MO.min_hours === 2, MO)
ck('Oklahoma: Monday to Friday, 8 AM to 6 PM', OK.days.join() === '1,2,3,4,5' && OK.open === '08:00' && OK.close === '18:00', OK)
const MOw = fam.hoursFor('MO', { family_app_days_MO: [1, 2, 3, 4, 5], family_app_open_MO: '08:30', family_app_close_MO: '17:00' })
ck('hours come from the Hub settings when set', MOw.days.join() === '1,2,3,4,5' && MOw.open === '08:30' && MOw.close === '17:00', MOw)
ck('nonsense settings fall back to her rules', fam.hoursFor('MO', { family_app_open_MO: '7am', family_app_close_MO: '07:30', family_app_days_MO: [9, 'x'] }).open === '07:00' && fam.hoursFor('MO', { family_app_days_MO: [9] }).days.length === 0)

// ── set times ────────────────────────────────────────────────────────────────────────────────────────────────────────
const v = (b, h = MO) => fam.validateBooking({ tasks: ['Companionship'], ...b }, NOW, T, h)
ck('set time from/to: Thu 10:00 to 13:00 is 3 hours', (() => { const x = v({ date: '2026-10-22', start: '10:00', end: '13:00' }); return x.ok && x.kind === 'set' && x.hours === 3 && x.end === '13:00' })())
ck('set time: half hours, 7:00 to 9:30', v({ date: '2026-10-22', start: '07:00', end: '09:30' }).hours === 2.5)
ck('Missouri Saturday ok; Oklahoma Saturday refused in words', v({ date: '2026-10-24', start: '10:00', end: '12:00' }).ok && /Monday to Friday/.test(v({ date: '2026-10-24', start: '10:00', end: '12:00' }, OK).error))
ck('Missouri 7 AM ok, 6:30 AM refused; past 6 PM refused', v({ date: '2026-10-22', start: '07:00', end: '09:00' }).ok && /7 AM and 6 PM/.test(v({ date: '2026-10-22', start: '06:30', end: '09:00' }).error) && /6 PM/.test(v({ date: '2026-10-22', start: '16:30', end: '18:30' }).error))
ck('Oklahoma 7 AM refused (8 to 6)', /8 AM and 6 PM/.test(v({ date: '2026-10-22', start: '07:00', end: '09:00' }, OK).error))
ck('under 2 hours refused; end before start refused', /at least 2 hours/.test(v({ date: '2026-10-22', start: '10:00', end: '11:30' }).error) && /at least 2 hours/.test(v({ date: '2026-10-22', start: '10:00', end: '09:00' }).error))
ck('the Step 1b app (start + hours) still works', v({ date: '2026-10-22', start: '10:00', hours: 3, who: 'regular', caregiver_axiscare_id: '77' }).end === '13:00')
ck('2 hours notice and 60 days kept', /2 hours ahead/.test(v({ date: '2026-10-20', start: '10:30', end: '12:30' }).error) && /60 days/.test(v({ date: '2026-12-22', start: '10:00', end: '12:00' }).error))

// ── flexible ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const fx = v({ kind: 'flex', date: '2026-10-22', window_start: '09:00', window_end: '15:00', hours: 3 })
ck('flexible: anytime 9 to 3 for 3 hours, no start until a caregiver picks', fx.ok && fx.kind === 'flex' && fx.start === null && fx.end === null && fx.window_start === '09:00' && fx.window_end === '15:00' && fx.hours === 3, fx)
ck('flexible: a window shorter than the visit is refused in words', /shorter than 3 hours/.test(v({ kind: 'flex', date: '2026-10-22', window_start: '09:00', window_end: '11:00', hours: 3 }).error))
ck('flexible: window inside the state hours', /7 AM and 6 PM/.test(v({ kind: 'flex', date: '2026-10-22', window_start: '06:00', window_end: '12:00', hours: 3 }).error))
ck('flexible: 2 hours minimum', /at least 2 hours/.test(v({ kind: 'flex', date: '2026-10-22', window_start: '09:00', window_end: '15:00', hours: 1.5 }).error))
ck('the starts a caregiver may pick: 9:00 to 12:00 by half hours', fam.startChoices('09:00', '15:00', 3).join() === '09:00,09:30,10:00,10:30,11:00,11:30,12:00')

// ── who would you like ───────────────────────────────────────────────────────────────────────────────────────────────
const p2 = v({ date: '2026-10-22', start: '10:00', end: '12:00', who: 'preferred', preferred: ['77', '88', '77'] })
ck('one or more picks, duplicates dropped', p2.who === 'preferred' && p2.preferred.join() === '77,88', p2)
ck('"preferred" with nobody picked is refused', /Whoever is available/.test(v({ date: '2026-10-22', start: '10:00', end: '12:00', who: 'preferred', preferred: [] }).error))
ck('whoever is available: no picks kept', (() => { const x = v({ date: '2026-10-22', start: '10:00', end: '12:00', who: 'any', preferred: ['77'] }); return x.who === 'any' && x.preferred.length === 0 })())
ck('more than 5 picks refused', /up to 5/.test(v({ date: '2026-10-22', start: '10:00', end: '12:00', who: 'preferred', preferred: ['1', '2', '3', '4', '5', '6'] }).error))

// ── stand-ins ────────────────────────────────────────────────────────────────────────────────────────────────────────
let W
const utc = (date, hhmm) => { const [h, m] = hhmm.split(':').map(Number); return `${date}T${String(h + 5).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z` }
function reset(m = {}) {
  W = { visits: {}, bookings: [], offers: [], items: [], events: [], calls: [], texts: [], blocked: {}, sendFail: {}, postFails: false,
    settings: { family_app_live: true, family_fee_check_ready: true, family_offer_live: false, family_app_service_MO: 'PP - WC', family_app_cancel_reason: 'Schedule Change - Client Cancellation' }, clientState: 'MO', ...m }
  W.visits['v=1:s=5:d=2026-10-21'] = { id: 'v=1:s=5:d=2026-10-21', client: { id: 501 }, caregiver: { id: 77, firstName: 'Sarah' }, timezone: 'US/Central', scheduledStartDate: utc('2026-10-21', '09:00'), scheduledEndDate: utc('2026-10-21', '11:00') }
  W.visits['v=3:s=5:d=2026-09-25'] = { id: 'v=3:s=5:d=2026-09-25', client: { id: 501 }, caregiver: { id: 88, firstName: 'Maria' }, timezone: 'US/Central', scheduledStartDate: utc('2026-09-25', '13:00'), scheduledEndDate: utc('2026-09-25', '15:00') }
  // Maria already works 9 to 11 on the 22nd for someone else
  W.visits['v=9:s=6:d=2026-10-22'] = { id: 'v=9:s=6:d=2026-10-22', client: { id: 999 }, caregiver: { id: 88 }, timezone: 'US/Central', scheduledStartDate: utc('2026-10-22', '09:00'), scheduledEndDate: utc('2026-10-22', '11:00') }
}
const r = (status, json) => ({ status, json })
let vn = 100
const CG = { 77: { id: 77, firstName: 'Sarah', lastName: 'Jones', status: { active: true } }, 88: { id: 88, firstName: 'Maria', lastName: 'Lopez', status: { active: true } }, 55: { id: 55, firstName: 'Ann', lastName: 'Bee', status: { active: true } }, 44: { id: 44, firstName: 'Dee', lastName: 'Cee', status: { active: true } } }
const ax = async (method, p, body) => {
  W.calls.push([method, p, body]); const u = new URL('http://x' + p)
  if (method === 'GET' && u.pathname === '/api/clients/501') return r(200, { results: { client: { id: 501, firstName: 'Dorothy', goesBy: 'Dot', status: { active: true, label: 'Active' }, residentialAddress: { state: W.clientState, city: 'Nixa', street1: '12 Elm St' } } } })
  if (method === 'GET' && u.pathname === '/api/visits/modification-reasons') return r(200, { results: { modificationReasons: [{ id: 11, name: 'Schedule Change - Client Cancellation', disabled: false }] } })
  if (method === 'GET' && u.pathname === '/api/visits') {
    const c = u.searchParams.get('clientIds'), g = u.searchParams.get('caregiverIds'), s = u.searchParams.get('startDate'), e = u.searchParams.get('endDate')
    if (g && W.cgVisitsFail) return r(500, { errors: ['down'] })
    const list = Object.values(W.visits).filter((x) => (c ? String(x.client.id) === c : String(x.caregiver?.id) === g) && x.id.slice(-10) >= s && x.id.slice(-10) <= e)
    return list.length ? r(200, { results: { visits: list, nextPage: null } }) : r(404, { errors: ['No visits found'] })
  }
  if (method === 'POST' && u.pathname === '/api/visits') {
    if (W.postFails) return r(400, { errors: ['Unknown serviceCode'] })
    const id = `v=${++vn}:s=0:d=${body.visitDate}`
    W.visits[id] = { id, client: { id: body.clientId }, caregiver: body.caregiverId ? { id: body.caregiverId, firstName: CG[body.caregiverId]?.firstName } : null, timezone: 'US/Central', scheduledStartDate: utc(body.visitDate, body.startTime), scheduledEndDate: utc(body.visitDate, body.endTime) }
    return r(201, { visit: { ...W.visits[id] } })
  }
  const cm = u.pathname.match(/^\/api\/caregivers\/(\d+)$/)
  if (method === 'GET' && cm) return CG[cm[1]] ? r(200, { results: { caregiver: CG[cm[1]] } }) : r(404, { errors: ['no'] })
  const vm = u.pathname.match(/^\/api\/visits\/(.+)$/)
  if (vm) { const id = decodeURIComponent(vm[1]); const x = W.visits[id]
    if (method === 'GET') return x ? r(200, { results: x }) : r(404, { errors: ['not found'] })
    if (method === 'PATCH') { if (W.patchFails) return r(400, { errors: ['locked'] }); x.caregiver = { id: body.caregiverId, firstName: CG[body.caregiverId]?.firstName }; return r(200, { results: { id } }) }
    if (method === 'DELETE') { delete W.visits[id]; return { status: 204, json: {} } }
  }
  return r(404, { errors: ['unexpected ' + method + ' ' + p] })
}
const WHO = { lisa: [{ contact_id: 9, name: 'Lisa Ray', circle_id: 'c1', axiscare_client_id: '501', client_name: 'Dorothy Ray', can_book: true }] }
let bid = 0, oid = 0
const uuid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const famDeps = () => ({
  ax, now: () => NOW, supabaseUrl: 'https://h.co',
  settings: async () => W.settings,
  whoIs: async () => WHO.lisa,
  circleFlags: async () => W.circle ?? null,
  reviewNote: async () => W.ai === undefined ? null : W.ai,
  profiles: async (ids) => [{ axiscare_id: '77', first_name: 'Sarah', last_name: 'Jones', published: true, consent: true }, { axiscare_id: '88', first_name: 'Maria', last_name: 'Lopez', published: true, consent: true }].filter((p) => ids.includes(p.axiscare_id)),
  bookings: async (cid) => W.bookings.filter((b) => b.axiscare_client_id === cid),
  insertBooking: async (row) => { const b = { id: uuid(++bid), offer_stage: null, offer_next_at: null, unfilled_card_at: null, caregiver_axiscare_id: null, ...row }; W.bookings.push(b); return { id: b.id } },
  updateBooking: async (id, vals) => { Object.assign(W.bookings.find((b) => b.id === id), vals); return true },
  officeItem: async (item) => { const k = W.items.findIndex((x) => x.id === item.id); if (k >= 0) W.items[k] = item; else W.items.push(item); return true },
  event: async (row) => { W.events.push(row) },
})
const go = (body) => fam.familyAction(famDeps(), { id: 'u-lisa', email: 'lisa@x.test' }, { client: '501', ...body })
const ROSTER = [
  { axiscare_id: '77', name: 'Sarah Jones', first: 'Sarah', phone: '+14175550101', avail: null },
  { axiscare_id: '88', name: 'Maria Lopez', first: 'Maria', phone: '+14175550102', avail: { windows: { thu: ['afternoon'] } } },
  { axiscare_id: '55', name: 'Ann Bee', first: 'Ann', phone: '+14175550103', avail: { windows: { thu: ['morning', 'afternoon'] } } },
  { axiscare_id: '44', name: 'Dee Cee', first: 'Dee', phone: '+14175550104', avail: { windows: { mon: ['morning'] } } },
]
const offDeps = () => ({
  ...famDeps(),
  openBookings: async (from) => W.bookings.filter((b) => b.status === 'waiting_for_caregiver' && !b.caregiver_axiscare_id && b.visit_date >= from),
  booking: async (id) => W.bookings.find((b) => b.id === id) ?? null,
  offers: async (bid) => W.offers.filter((o) => o.booking_id === bid),
  offer: async (id) => W.offers.find((o) => o.id === id) ?? null,
  insertOffer: async (row) => { if (W.offers.some((o) => o.booking_id === row.booking_id && o.caregiver_axiscare_id === row.caregiver_axiscare_id)) return null; const o = { id: uuid(9000 + ++oid), ...row }; W.offers.push(o); return { id: o.id } },
  updateOffer: async (id, vals) => { Object.assign(W.offers.find((o) => o.id === id), vals); return true },
  claimBooking: async (id, vals) => { const b = W.bookings.find((x) => x.id === id); if (!b || b.status !== 'waiting_for_caregiver' || b.caregiver_axiscare_id) return false; Object.assign(b, vals); return true },
  roster: async () => ROSTER,
  askBlock: async (c, client, needsTransport) => { (W.drive ??= []).push([c.axiscare_id, needsTransport]); return W.blocked[c.axiscare_id] ?? (needsTransport && !W.drivers?.includes(c.axiscare_id) ? `${c.name} is not cleared to drive clients` : null) },
  sendText: async (c, message) => { if (W.sendFail[c.axiscare_id]) return { ok: false, why: 'refused' }; W.texts.push({ to: c.axiscare_id, message }); return { ok: true } },
  makeLink: async (id, exp) => links.makeOfferLink('s'.repeat(40), id, exp),
  closeItem: async (id, by, text) => { const it = W.items.find((x) => x.id === id); if (it) { it.status = 'done'; it.closed_text = text } },
  // Release 1: requests that ended unfilled, and the family message behind its own approval
  unfilledDue: async () => W.bookings.filter((b) => b.status === 'not_filled' && b.family_unfilled_pending === true && !b.family_unfilled_at),
  reviewNote: async () => W.ai === undefined ? null : W.ai,
  heldDue: async () => W.bookings.filter((b) => b.status === 'held' && b.answer_by && Date.parse(b.answer_by) <= NOW.getTime()),
  declinedDue: async () => W.bookings.filter((b) => b.status === 'declined' && b.family_declined_pending === true && !b.family_declined_at),
  tellFamily: async (b, sms, email, key) => { if (W.tellFail) return { ok: false, why: W.tellFail }; (W.told ??= []).push({ to: b.contact_id, how: 'sms', sms, email, key }); return { ok: true, how: 'sms' } },
})
const run = (o) => fo.runOffers(offDeps(), o)
const page = (offerId, body) => fo.offerPage(offDeps(), offerId, body)
const bk = () => W.bookings[W.bookings.length - 1]

// ── the family door ──────────────────────────────────────────────────────────────────────────────────────────────────
reset()
let o = await go({ action: 'home' })
ck('home: the app gets the state\'s days and hours', o.status === 200 && o.body.hours.open === '07:00' && o.body.hours.days.length === 7, o.body.hours)
W.clientState = 'OK'; o = await go({ action: 'home' })
ck('home: an Oklahoma client gets Monday to Friday 8 to 6', o.body.hours.days.join() === '1,2,3,4,5' && o.body.hours.open === '08:00')
reset()
const FLEX = { action: 'book', kind: 'flex', date: '2026-10-22', window_start: '09:00', window_end: '15:00', hours: 3, tasks: ['Companionship'], who: 'preferred', preferred: ['77', '88'], note: 'Soup' }
o = await go({ ...FLEX, preferred: ['77', '12345'] })
ck('a pick who is not one of her caregivers is refused', o.status === 400 && /Dot's caregivers/.test(o.body.error) && W.bookings.length === 0, o)
W.calls = []
o = await go(FLEX)
let b = bk()
ck('flexible (live, offers off): kept in the Hub only, AxisCare not written', o.status === 200 && b.status === 'waiting_for_caregiver' && !b.axiscare_visit_id && b.start_time === null && !W.calls.some((c) => c[0] !== 'GET'), o)
ck('flexible: saved with the window, length and picks', b.kind === 'flex' && b.window_start === '09:00' && b.window_end === '15:00' && b.hours === 3 && b.preferred_caregiver_ids.join() === '77,88' && b.who === 'preferred')
ck('flexible (offers off): the office gets "Place a caregiver"', W.items.length === 1 && /Place a caregiver/.test(W.items[0].title) && /flexible: 3 hours anytime 09:00 to 15:00/.test(W.items[0].detail) && /2 of Dot's caregivers/.test(W.items[0].detail), W.items)
ck('Release 1: the family is told it is a request, not scheduled, and when they will hear; never "booked"', /^Request sent\./.test(o.body.message) && /isn't a scheduled visit yet/.test(o.body.message) && /You'll hear from us by Wed, Oct 21, 6 PM/.test(o.body.message) && !/booked/i.test(o.body.message), o.body.message)
o = await go({ ...FLEX, kind: 'set', start: '12:00', end: '14:00' })
ck('a visit overlapping one already booked is refused', o.status === 409 && /already have a visit/.test(o.body.error), o)
o = await go({ action: 'bookings' })
ck('bookings: the family sees the window, the length, no start yet', o.body.bookings[0].kind === 'flex' && o.body.bookings[0].start === null && o.body.bookings[0].window_start === '09:00' && o.body.bookings[0].hours === 3, o.body)
o = await go({ action: 'home' })
ck('home: a waiting flexible visit is listed with its window', o.body.waiting.length === 1 && o.body.waiting[0].window_end === '15:00')

reset({ settings: { family_app_live: true, family_fee_check_ready: true, family_offer_live: true, family_app_service_MO: 'PP - WC' } })
o = await go({ action: 'book', date: '2026-10-22', start: '13:00', end: '16:00', tasks: ['Companionship'], who: 'any' })
b = bk()
ck('set time (live, offers on): Release 1 = NOT on AxisCare until a caregiver accepts, and no office card', b.status === 'waiting_for_caregiver' && !b.axiscare_visit_id && !W.calls.some((c) => c[0] === 'POST') && W.items.length === 0, { b, items: W.items })
reset({ settings: { family_app_live: true, family_app_service_MO: 'PP - WC' } }); W.calls = []
o = await go({ action: 'book', date: '2026-10-22', start: '13:00', end: '16:00', tasks: ['Companionship'], who: 'any' })
ck('her go-live rule: the app switch ON but the App fee check not installed = still practice, AxisCare never written', o.body.status === 'practice' && !W.calls.some((c) => c[0] !== 'GET'), o.body)
reset({ settings: { family_app_live: false } })
o = await go(FLEX)
ck('practice mode: flexible saved as practice, nothing else', o.body.status === 'practice' && bk().status === 'practice' && W.items.length === 0)
reset()
o = await go({ ...FLEX, date: '2026-10-23' })
o = await go({ action: 'cancel', booking_id: bk().id })
ck('cancel a waiting flexible visit (no AxisCare visit yet): cancelled, nothing to remove', o.status === 200 && bk().status === 'cancelled' && !W.calls.some((c) => c[0] === 'DELETE'), o)

// ── the office places a flexible visit ───────────────────────────────────────────────────────────────────────────────
const OW = { items: [], events: [] }
const offDepsOffice = () => ({ ...famDeps(), booking: async (id) => W.bookings.find((x) => x.id === id) ?? null, closeItem: async (id) => { const it = W.items.find((x) => x.id === id); if (it) it.status = 'done' }, event: async (e) => OW.events.push(e) })
const office = (body) => off.officeAction(offDepsOffice(), { email: 'k@mo-care.com', name: 'Krystal' }, body)
reset(); await go(FLEX); b = bk()
o = await office({ action: 'place', booking_id: b.id, caregiver_axiscare_id: '77', start: '08:00' })
ck('office place (flexible): a start outside the window is refused, nothing made', o.status === 400 && !b.axiscare_visit_id, o)
o = await office({ action: 'place', booking_id: b.id, caregiver_axiscare_id: '77', start: '10:30' })
ck('office place (flexible): AxisCare visit made 10:30 to 1:30 with Sarah, read back, booking placed', o.status === 200 && b.status === 'placed' && b.start_time === '10:30' && b.end_time === '13:30' && W.visits[b.axiscare_visit_id]?.caregiver?.id === 77 && W.items[0].status === 'done', { o, b })
const post = W.calls.find((c) => c[0] === 'POST')[2]
ck('office place (flexible): AxisCare got the picked time, the caregiver and the service', post.startTime === '10:30' && post.endTime === '13:30' && post.caregiverId === 77 && post.serviceCode === 'PP - WC')
reset(); await go({ action: 'book', date: '2026-10-22', start: '13:00', end: '16:00', tasks: ['Companionship'], who: 'any' }); b = bk()
o = await office({ action: 'place', booking_id: b.id, caregiver_axiscare_id: '88' })
ck('office place (set time): unchanged, Maria PATCHed on, read back', o.status === 200 && b.status === 'placed' && W.visits[b.axiscare_visit_id].caregiver.id === 88, o)

// ── offers ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const OFFERS_ON = { family_app_live: true, family_fee_check_ready: true, family_offer_live: true, family_app_service_MO: 'PP - WC' }
reset({ settings: { ...OFFERS_ON, family_offer_live: false } }); await go(FLEX)
o = await run()
ck('offers switched off: nothing sent', W.texts.length === 0 && W.offers.length === 0 && o.live === false, o)
reset({ settings: { ...OFFERS_ON } }); await go(FLEX); b = bk()
o = await run({ dry: true })
ck('dry run: says who would get it, sends and saves nothing', W.texts.length === 0 && W.offers.length === 0 && o.would.some((x) => x.who === 'Sarah Jones'), o)
o = await run()
ck('picks first: Sarah and Maria are texted, nobody else', W.texts.map((t) => t.to).sort().join() === '77,88' && b.offer_stage === 'picks', { texts: W.texts, o })
const sTxt = W.texts.find((t) => t.to === '77').message
ck('the pick text: her first name, the town, the day, the window, a link; never the client\'s name, address or pay', /^Hi Sarah, it's Caring Companions\. A family you've visited asked for you/.test(sTxt) && /in Nixa: Thu, Oct 22, 3 hours, you pick the start between 9 AM and 12 PM/.test(sTxt) && /https:\/\/cc\.mo-care\.com\/visit-offer\.html\?o=/.test(sTxt) && !/Dorothy|Dot|Elm|\$/.test(sTxt), sTxt)
ck('no em dashes in any text', !W.texts.some((t) => /—/.test(t.message)))
ck('picks get 4 hours to themselves', Math.abs(Date.parse(b.offer_next_at) - NOW.getTime() - 4 * 3600000) < 1000, b.offer_next_at)
await run()
ck('the next run inside the 4 hours sends nothing more', W.texts.length === 2)

// a yes from Maria: the start she can pick leaves out the time she already works
const mo = W.offers.find((x) => x.caregiver_axiscare_id === '88')
o = await page(mo.id, { action: 'view' })
ck('her page: open, client first name, town, tasks, note, and only starts she is free for', o.status === 200 && o.body.state === 'open' && o.body.client === 'Dot' && o.body.town === 'Nixa' && o.body.note === 'Soup' && o.body.choices.join() === '11:00,11:30,12:00', o.body)
o = await page(mo.id, { action: 'answer', yes: true, start: '09:30' })
ck('a start she is busy for is refused, nothing placed', o.status === 409 && b.status === 'waiting_for_caregiver' && !b.caregiver_axiscare_id, o)
o = await page(mo.id, { action: 'answer', yes: true, start: '11:30' })
ck('Maria says yes at 11:30: straight on AxisCare 11:30 to 2:30, read back, booking placed', o.status === 200 && o.body.placed && b.status === 'placed' && b.start_time === '11:30' && b.end_time === '14:30' && W.visits[b.axiscare_visit_id]?.caregiver?.id === 88 && b.placed_by === 'caregiver yes (family app offer)', { o, b })
ck('her answer: confirmed, when, and that changes go through the office like any shift (her approval 2026-10-17)', /^You're confirmed for Thu, Oct 22, 11:30 AM to 2:30 PM with Dot\./.test(o.body.message) && /call the office at \(417\) 234-8494 right away, the same as any shift/.test(o.body.message), o.body.message)
ck('Sarah\'s offer is closed; Sarah gets no text about it', W.offers.find((x) => x.caregiver_axiscare_id === '77').state === 'closed' && W.texts.length === 2)
const so = W.offers.find((x) => x.caregiver_axiscare_id === '77')
o = await page(so.id, { action: 'answer', yes: true, start: '09:00' })
ck('Sarah says yes later: told someone else took it, nothing changes', o.body.taken === true && /Someone else took this one/.test(o.body.message) && b.caregiver_axiscare_id === '88', o)
o = await page(mo.id, { action: 'view' })
ck('Maria opens her link again: "yours" with the start she picked', o.body.state === 'yours' && o.body.picked === '11:30')
o = await go({ action: 'bookings' })
ck('the family sees who and when in the app', o.body.bookings[0].caregiver === 'Maria L.' && o.body.bookings[0].start === '11:30' && o.body.bookings[0].status === 'placed', o.body)
ck('no text or email to the family anywhere (only caregiver texts were sent)', W.texts.every((t) => ['77', '88'].includes(t.to)))
await run()
ck('a placed booking is never offered again', W.texts.length === 2)

// picks time runs out -> the team, worked-with-her and availability first, skipping the busy and blocked
reset({ settings: { ...OFFERS_ON, family_offer_wave_size: 2 } }); await go({ action: 'book', date: '2026-10-22', start: '13:00', end: '16:00', tasks: ['Companionship'], who: 'preferred', preferred: ['77'] }); b = bk()
await run()
ck('set time: Sarah (the pick) is texted the set time', W.texts.length === 1 && /Thu, Oct 22, 1 PM to 4 PM/.test(W.texts[0].message), W.texts)
const so2 = W.offers[0]
await page(so2.id, { action: 'answer', yes: false })
ck('Sarah says no: recorded, thanked, nothing else', so2.state === 'no')
await run()
ck('all picks said no: the team goes at once, Maria first (she has visited Dorothy), then the next by availability', W.texts.length === 3 && W.texts[1].to === '88' && W.texts[2].to === '55' && b.offer_stage === 'team', W.texts.map((t) => t.to))
ck('the team text says the first to accept gets it, and that it is a confirmed shift', /The first caregiver to accept gets it, and it's a confirmed shift on their schedule/.test(W.texts[1].message), W.texts[1]?.message)
ck('the pick text says accepting is a confirmed shift', /If you accept, it's a confirmed shift on your schedule/.test(W.texts[0].message), W.texts[0]?.message)
ck('Dee (outside her availability, no outside box) is never texted', !W.texts.some((t) => t.to === '44'))
const ao = W.offers.find((x) => x.caregiver_axiscare_id === '55')
o = await page(ao.id, { action: 'answer', yes: true })
ck('Ann says yes (set time): PATCHed onto the AxisCare visit, read back, placed', o.body.placed && W.visits[b.axiscare_visit_id].caregiver.id === 55 && b.status === 'placed', o)

// everyone asked -> one office card
reset({ settings: { ...OFFERS_ON, family_offer_wave_size: 5 } }); await go({ action: 'book', date: '2026-10-22', start: '13:00', end: '16:00', tasks: ['Companionship'], who: 'any' }); b = bk()
W.blocked['77'] = 'Sarah Jones is on the No shift texts list'
await run()
ck('whoever is available: straight to the team; blocked people skipped with the reason', W.texts.map((t) => t.to).join() === '88,55' && !W.texts.some((t) => t.to === '77'), W.texts.map((t) => t.to))
for (const x of W.offers) await page(x.id, { action: 'answer', yes: false })
await run()
await run()   // the next 10-minute check
ck('everyone asked said no: NO office card (decision A); at the next check the request ends as not filled and the family is queued to hear', W.items.length === 0 && b.status === 'not_filled' && b.ended_why === 'early' && b.family_unfilled_pending === true, { b, items: W.items })
await run()
ck('...the family hears once ("couldn\'t find a caregiver", nothing scheduled, no charge), only after her approval is recorded', !W.told, W.told)
W.settings.family_unfilled_text_approved = { by: 'Samantha' }
await run(); await run()
ck('...with the approval: told once, behind its own approval key, in her words', W.told?.length === 1 && W.told[0].key === 'family_unfilled_text_approved' && /We couldn't find a caregiver for Dot's extra visit on Thursday, October 22, from 1 to 4\. Nothing was scheduled and there's no charge\./.test(W.told[0].sms) && b.family_unfilled_at, W.told)
ck('...and no caregiver is texted again', W.texts.length === 2)

// Approved Driver (her rule 2026-10-13): rides or an outing = only cleared drivers are asked
reset({ settings: { ...OFFERS_ON } }); W.drivers = ['55']
await go({ action: 'book', date: '2026-10-22', start: '13:00', end: '16:00', tasks: ['Companionship', 'Rides to appointments'], who: 'any' }); b = bk()
await run()
ck('a visit with rides: every caregiver is checked as a driver, only Ann (an Approved Driver) is texted', W.drive.every((x) => x[1] === true) && W.texts.map((t) => t.to).join() === '55', { drive: W.drive, to: W.texts.map((t) => t.to) })
reset({ settings: { ...OFFERS_ON } }); W.drivers = []
await go({ action: 'book', date: '2026-10-22', start: '13:00', end: '16:00', tasks: ['Companionship'], who: 'any' }); b = bk()
await run()
ck('a visit with no driving: nobody is held back for driving', W.drive.every((x) => x[1] === false) && W.texts.length > 0, W.drive)
reset({ settings: { ...OFFERS_ON } }); W.drivers = []
await go({ action: 'book', date: '2026-10-22', start: '13:00', end: '16:00', tasks: ['An outing together'], who: 'any' }); b = bk()
await run()
await run()
ck('an outing with no Approved Driver available: nobody is texted, no office card, the request ends as not filled', W.texts.length === 0 && W.items.length === 0 && b.status === 'not_filled', { t: W.texts, i: W.items, b })
ck('family_offer_driver_check false turns the check off', fo.needsDrive({ tasks: ['An outing together'] }, { family_offer_driver_check: false }) === false && fo.needsDrive({ tasks: ['An outing together'] }, {}) === true)

// 24 hours before
reset({ settings: { ...OFFERS_ON } }); await go({ action: 'book', date: '2026-10-21', start: '13:00', end: '16:00', tasks: ['Companionship'], who: 'preferred', preferred: ['77'] }); b = bk()
await run()
ck('booked 28 hours out: picks texted, no card yet; picks wait capped at half the time left', W.texts.length === 1 && W.items.length === 0)
NOW = new Date('2026-10-20T19:00:00Z')   // 2 PM, 23 hours to go
await run()
ck('24 hours before and nobody has said yes: still no office card (decision A)', W.items.length === 0 && b.status === 'waiting_for_caregiver', W.items)
NOW = new Date('2026-10-20T23:05:00Z')   // 6:05 PM, past its answer-by time (6 PM the day before)
await run()
ck('the answer-by time passes: the request ends as not filled; Sarah\'s unanswered offer is closed; nothing is left on AxisCare', b.status === 'not_filled' && b.ended_why === 'deadline' && W.offers.every((x) => x.state !== 'sent') && !b.axiscare_visit_id, { b, offers: W.offers })
NOW = new Date('2026-10-20T14:00:00Z')

// the night rule
reset({ settings: { ...OFFERS_ON } }); await go(FLEX)
NOW = new Date('2026-10-21T03:00:00Z')   // 10 PM Central
o = await run()
ck('10 PM: nothing is texted (caregiver night rule), the visit is not tomorrow morning within 3 hours', W.texts.length === 0 && o.held_night === 1, o)
NOW = new Date('2026-10-20T14:00:00Z')

// Oklahoma: no team list yet
reset({ settings: { ...OFFERS_ON, family_app_service_OK: 'OK - C' }, clientState: 'OK' })
await go({ action: 'book', date: '2026-10-22', start: '13:00', end: '16:00', tasks: ['Companionship'], who: 'any' })
await run()
await run()
ck('Oklahoma visit: the Missouri team is never texted; no office card; the request ends as not filled', W.texts.length === 0 && W.items.length === 0 && W.bookings[0].status === 'not_filled', { i: W.items, b: W.bookings[0] })

// first yes wins against two at once, and AxisCare trouble
reset({ settings: { ...OFFERS_ON } }); await go(FLEX); b = bk()
await run()
const [x1, x2] = W.offers
const [a1, a2] = await Promise.all([page(x1.id, { action: 'answer', yes: true, start: '12:00' }), page(x2.id, { action: 'answer', yes: true, start: '11:00' })])
ck('two yeses at the same moment: exactly one is placed, the other is told it was taken', [a1, a2].filter((a) => a.body.placed).length === 1 && [a1, a2].filter((a) => a.body.taken).length === 1 && Object.values(W.visits).filter((x) => x.client.id === 501 && x.id.endsWith('2026-10-22')).length === 1, [a1.body, a2.body])
reset({ settings: { ...OFFERS_ON }, postFails: true }); await go(FLEX); b = bk()
await run()
o = await page(W.offers[0].id, { action: 'answer', yes: true, start: '10:00' })
ck('AxisCare refuses: the caregiver is told the office will confirm, the office gets a card, the slot is held for her', /office will confirm/.test(o.body.message) && b.status === 'needs_office' && b.caregiver_axiscare_id === W.offers[0].caregiver_axiscare_id && W.items.some((x) => /said yes/.test(x.title) && /put them on by hand/.test(x.detail)), { o, b, items: W.items })
reset({ settings: { ...OFFERS_ON } }); await go(FLEX); W.sendFail['77'] = true
o = await run()
ck('a refused text is counted as failed (Needs Attention is raised by the checked send), and that offer is marked failed', o.failed === 1 && W.offers.find((x) => x.caregiver_axiscare_id === '77').state === 'failed', o)
reset({ settings: { ...OFFERS_ON } }); await go(FLEX); b = bk(); await run()
await go({ action: 'cancel', booking_id: b.id })
o = await page(W.offers[0].id, { action: 'answer', yes: true, start: '10:00' })
ck('the family cancelled: a yes is thanked, nothing is placed', /cancelled this visit/.test(o.body.message) && !W.offers.some((x) => x.state === 'yes') && b.status === 'cancelled')

// ── the link ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const SEC = 'k'.repeat(40), id = uuid(5), exp = Math.floor(Date.now() / 1000) + 3600
const url = new URL(await links.makeOfferLink(SEC, id, exp))
const q = { o: url.searchParams.get('o'), e: url.searchParams.get('e'), t: url.searchParams.get('t') }
ck('link: checks out as made, on cc.mo-care.com/visit-offer.html', url.origin + url.pathname === 'https://cc.mo-care.com/visit-offer.html' && await links.checkOfferLink(SEC, q))
ck('link: another offer, a changed expiry, an expired one, a short secret all refused', !(await links.checkOfferLink(SEC, { ...q, o: uuid(6) })) && !(await links.checkOfferLink(SEC, { ...q, e: String(exp + 1) })) && !(await links.checkOfferLink(SEC, q, exp + 10)) && !(await links.checkOfferLink('short', q)))

// ── the function files ───────────────────────────────────────────────────────────────────────────────────────────────
const fx2 = fs.readFileSync(path.join(F, 'family-offer/index.ts'), 'utf8')
const shared = fs.readFileSync(path.join(F, '_shared/family-offer.ts'), 'utf8')
ck('family-offer: caregiver audience, checked send, the shift-ask gate, AxisCare-active roster, cron/owner only for the run, CORS', /audience: 'caregiver', channel: 'sms', sender: 'family-offer'/.test(fx2) && /ghlSendChecked\(db/.test(fx2) && /shiftAskBlock\(db/.test(fx2) && /readCensus\(\)/.test(fx2) && /jobCaller\(req\)/.test(fx2) && /req\.method === 'OPTIONS'/.test(fx2))
ck('family-offer: the link is checked before anything is read', fx2.indexOf('checkOfferLink(SECRET, body)') > 0 && fx2.indexOf('checkOfferLink(SECRET, body)') < fx2.indexOf('offerPage(deps'))
ck('first yes wins is one conditional update (still waiting, nobody on it)', /\.eq\('status', 'waiting_for_caregiver'\)\.is\('caregiver_axiscare_id', null\)\.select\('id'\)/.test(fx2))
const outreach = fs.readFileSync(path.join(F, '_shared/outreach.ts'), 'utf8'), sp = fs.readFileSync(path.join(F, '_shared/send-problems.ts'), 'utf8')
ck('the sender is registered (outreach SENDER_REGISTER and Needs Attention words)', /'family-offer':\s+\{ class: 'urgent_internal', scheduled: true/.test(outreach) && /'family-offer': \['family visit offer text'/.test(sp))
// 2026-10-16 her two named family messages (caregivers are interested; a caregiver is confirmed) go ONLY through family-offer-db.ts,
// each behind its own recorded approval; the engine itself never addresses a family
const fdb = fs.readFileSync(path.join(F, '_shared/family-offer-db.ts'), 'utf8')
ck('no family send in the offer engine itself (only through the two approved family messages)', !/audience: 'family'|circle-send/i.test(fx2 + shared))
ck('...each family message checks its own recorded approval first', /family_choose_text_approved/.test(fdb.slice(fdb.indexOf('textFamily:'))) && /family_confirm_text_approved/.test(fdb.slice(fdb.indexOf('tellFamily:'), fdb.indexOf('clientAbout:'))))
ck('no secret or key in any file', ![fx2, shared, fs.readFileSync(path.join(F, '_shared/offer-links.ts'), 'utf8')].some((s) => /sb_secret_|sbp_|eyJhbGci/.test(s)))
const all = [shared, fs.readFileSync(path.join(F, '_shared/family-app.ts'), 'utf8'), fs.readFileSync(path.join(F, '_shared/family-app-office.ts'), 'utf8'), fx2, fs.readFileSync('family_app_flex.sql', 'utf8')]
ck('no her/she in anything a family, caregiver or the office reads (clients can be anyone)', !all.slice(0, 4).some((s) => /'[^'\n]*\b(her|she|She|Her)\b[^'\n]*'|`[^`\n]*\b(her|she|She|Her)\b[^`\n]*`/.test(s)))
ck('no em dashes in anything a family, caregiver or the office reads', !all.some((s) => /'[^'\n]*\u2014[^'\n]*'|`[^`\n]*\u2014[^`\n]*`/.test(s)) && !/\u2014/.test(all[0] + all[3] + all[4]))

// ── the SQL in a real Postgres ───────────────────────────────────────────────────────────────────────────────────────
if (process.env.PGLITE) {
  const { PGlite } = await import(process.env.PGLITE)
  const db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table public.care_circles (id text primary key, client_name text, active boolean default true, axiscare_client_id text);
    create table public.circle_contacts (id bigserial primary key, circle_id text, name text, email text, stopped_at timestamptz, axiscare_removed_at timestamptz);
    create table public.app_data (key text primary key, data jsonb);
    insert into public.app_data values ('ops_settings', '{"family_app_open_MO":"08:00","other":1}');
    create function public.hub_office_ok() returns boolean language sql as 'select true';`)
  const tryQ = async (q) => { try { await db.exec(q); return 'ok' } catch (e) { return 'refused: ' + e.message } }
  ck('PGLITE: 1a installed, with an old booking', (await tryQ(fs.readFileSync('family_app_1a.sql', 'utf8'))) === 'ok' && (await tryQ(`insert into public.family_bookings (axiscare_client_id, visit_date, start_time, end_time, hours, status, who) values ('501','2026-10-21','09:00','11:00',2,'placed','regular')`)) === 'ok')
  const sql = fs.readFileSync('family_app_flex.sql', 'utf8')
  ck('PGLITE: flex installs, and installs again', (await tryQ(sql)) === 'ok' && (await tryQ(sql)) === 'ok', await tryQ(sql))
  const old = (await db.query(`select kind, window_start, window_end, who from public.family_bookings`)).rows[0]
  ck('PGLITE: the old booking is a set time with its window filled in', old.kind === 'set' && old.window_start === '09:00' && old.window_end === '11:00' && old.who === 'regular', old)
  const s = (await db.query(`select data from public.app_data where key='ops_settings'`)).rows[0].data
  ck('PGLITE: settings added only where not set (her 08:00 kept), offers OFF, 4 hours, 24 hours', s.family_app_open_MO === '08:00' && s.other === 1 && s.family_app_close_MO === '18:00' && JSON.stringify(s.family_app_days_OK) === '[1,2,3,4,5]' && s.family_offer_live === false && s.family_offer_pick_wait_hours === 4 && s.family_offer_unfilled_hours === 24, s)
  const flex = (extra = '') => tryQ(`insert into public.family_bookings (axiscare_client_id, visit_date, kind, window_start, window_end, hours, status, who${extra ? ', ' + extra.split('=')[0] : ''}) values ('501','2026-10-22','flex','09:00','15:00',3,'waiting_for_caregiver','preferred'${extra ? ', ' + extra.split('=')[1] : ''})`)
  ck('PGLITE: a flexible booking with no start is allowed, twice on one day too (no start to clash on)', (await flex()) === 'ok' && (await flex()) === 'ok')
  ck('PGLITE: a set booking with no start is refused; a flexible one with no window is refused', (await tryQ(`insert into public.family_bookings (axiscare_client_id, visit_date, kind, hours, status) values ('501','2026-10-23','set',2,'received')`)).startsWith('refused') && (await tryQ(`insert into public.family_bookings (axiscare_client_id, visit_date, kind, hours, status) values ('501','2026-10-23','flex',2,'received')`)).startsWith('refused'))
  ck('PGLITE: who must be preferred/any (old answers kept); stage checked', (await flex("who2='x'")).startsWith('refused') && (await tryQ(`update public.family_bookings set offer_stage='later'`)).startsWith('refused'))
  const bidQ = (await db.query(`select id from public.family_bookings where kind='flex' limit 1`)).rows[0].id
  ck('PGLITE: one offer per caregiver per booking', (await tryQ(`insert into public.family_offers (booking_id, caregiver_axiscare_id, wave, state) values ('${bidQ}','77','picks','sent')`)) === 'ok' && (await tryQ(`insert into public.family_offers (booking_id, caregiver_axiscare_id, wave, state) values ('${bidQ}','77','team','sent')`)).startsWith('refused'))
  const g = (await db.query(`select grantee, privilege_type from information_schema.role_table_grants where table_name='family_offers' and grantee in ('anon','authenticated') order by 1,2`)).rows
  ck('PGLITE: family_offers: anon nothing, office read only', JSON.stringify(g) === JSON.stringify([{ grantee: 'authenticated', privilege_type: 'SELECT' }]), g)
  const csql = fs.readFileSync('family_app_choose.sql', 'utf8')
  ck('PGLITE: Let me choose installs, and installs again', (await tryQ(csql)) === 'ok' && (await tryQ(csql)) === 'ok', await tryQ(csql))
  ck('PGLITE: an interested offer is allowed; a made-up state refused', (await tryQ(`update public.family_offers set state='interested' where caregiver_axiscare_id='77'`)) === 'ok' && (await tryQ(`update public.family_offers set state='maybe'`)).startsWith('refused'))
  ck('PGLITE: method is auto by default, choose allowed, anything else refused', (await db.query(`select method from public.family_bookings limit 1`)).rows[0].method === 'auto' && (await tryQ(`update public.family_bookings set method='choose' where kind='flex'`)) === 'ok' && (await tryQ(`update public.family_bookings set method='x'`)).startsWith('refused'))
  const cs2 = (await db.query(`select data from public.app_data where key='ops_settings'`)).rows[0].data
  ck('PGLITE: Let me choose OFF, 3 interested, 24-hour deadline, 30-hour minimum, her approval of the one family text recorded', cs2.family_choose_live === false && cs2.family_choose_max_interested === 3 && cs2.family_choose_deadline_hours === 24 && cs2.family_choose_min_lead_hours === 30 && /5 recommended answers/.test(cs2.family_choose_text_approved.words), cs2)
  const v2 = fs.readFileSync('family_app_offer_v2.sql', 'utf8')
  await db.exec(`insert into public.care_circles (id, client_name, active, axiscare_client_id) values ('cv2','Dot',true,'501') on conflict do nothing`)
  ck('PGLITE: offer v2 installs, and installs again', (await tryQ(v2)) === 'ok' && (await tryQ(v2)) === 'ok', await tryQ(v2))
  ck('PGLITE: About up to 400 characters, longer refused', (await tryQ(`update public.care_circles set caregiver_about = repeat('a', 400)`)) === 'ok' && (await tryQ(`update public.care_circles set caregiver_about = repeat('a', 401)`)).startsWith('refused'))
  ck('PGLITE: bookings start not waiting to tell the family; her approval of the confirmed message recorded', (await db.query(`select bool_or(family_confirm_pending) as p from public.family_bookings`)).rows[0].p === false && /automatic text to the family when a caregiver is confirmed/.test((await db.query(`select data from public.app_data where key='ops_settings'`)).rows[0].data.family_confirm_text_approved.words))
}


// ── LET ME CHOOSE (her yes 2026-10-16, with the 5 recommended answers) ─────────────────────────────────────────────────
const CHOOSE_ON = { ...OFFERS_ON, family_choose_live: true, family_choose_text_approved: { by: 'Samantha' } }
const chooseDeps = () => ({ ...offDeps(),
  textCaregiver: async (id, message) => { W.texts.push({ to: String(id), message }); return { ok: true } },
  askBlockId: async (id, name, client, nt) => W.blocked[id] ?? null,
  textFamily: async (b, message) => { if (W.famFail) return { ok: false, why: 'refused' }; (W.fam ??= []).push({ to: b.contact_id, message }); return { ok: true } },
  confirmDue: async () => W.bookings.filter((b) => b.status === 'placed' && b.family_confirm_pending === true && !b.family_confirmed_at),
  tellFamily: async (b, sms, email) => { if (W.tellFail) return { ok: false, why: W.tellFail }; const how = W.noConsent ? 'email' : 'sms'; (W.told ??= []).push({ to: b.contact_id, how, sms, email }); return { ok: true, how } },
  clientAbout: async (ax) => W.about ?? null })
const famC = () => ({ ...famDeps(), choose: {
  counts: async (ids) => { const out = {}; for (const x of W.offers) if (ids.includes(x.booking_id) && x.state === 'interested') out[x.booking_id] = (out[x.booking_id] ?? 0) + 1; return out },
  list: (b) => fo.interestedCards(chooseDeps(), b),
  place: async (b, offerId, by) => { if (by === 'switch') { const r = await fo.placeChosen(chooseDeps(), b, null, 'switch'); if (r.ok) return r; W.bookings.find((x) => x.id === b.id).method = 'auto'; return { ok: true, placed: false, message: "Got it. We'll find someone for you." } } return fo.placeChosen(chooseDeps(), b, offerId, 'family') },
  cancelled: (b) => fo.chooseCancelled(chooseDeps(), b) } })
const goC = (body) => fam.familyAction(famC(), { id: 'u-lisa', email: 'lisa@x.test' }, { client: '501', ...body })
const runC = () => fo.runOffers(chooseDeps())
const pageC = (id, body) => fo.offerPage(chooseDeps(), id, body)
const CB = { action: 'book', method: 'choose', date: '2026-10-22', start: '13:00', end: '16:00', tasks: ['Companionship'], who: 'any' }
const offerOf = (cg) => W.offers.find((x) => x.caregiver_axiscare_id === cg && x.booking_id === bk().id)

reset({ settings: { ...OFFERS_ON } })
o = await goC(CB)
ck('choose: refused while Let me choose is off, nothing booked', o.status === 400 && /isn't turned on yet/.test(o.body.error) && W.bookings.length === 0, o)
reset({ settings: { ...CHOOSE_ON } })
o = await goC({ ...CB, date: '2026-10-21', start: '13:00', end: '15:00' })
ck('choose: a visit only 28 hours away is refused (needs 30), says pick Find someone for me', o.status === 400 && /at least 30 hours/.test(o.body.error) && /Find someone for me/.test(o.body.error), o)
o = await goC(CB); b = bk()
ck('choose: booked, method choose, deadline 24 hours before (Wed 1 PM Central), the family is told they choose', o.status === 200 && b.method === 'choose' && b.choose_by === '2026-10-21T18:00:00.000Z' && /you choose/.test(o.body.message), [o.body, b.choose_by])
await runC()
ck('choose: only caregivers with a published profile are asked (Sarah, Maria), with the "family is choosing" text', W.texts.map((t) => t.to).sort().join() === '77,88' && W.texts.every((t) => /A family is choosing/.test(t.message) && /it's Caring Companions\./.test(t.message) && /we'll text you if it's you/.test(t.message)), W.texts)
let oc = await pageC(offerOf('77').id, { action: 'view' })
ck('caregiver page knows it is Let me choose', oc.body.mode === 'choose' && oc.body.state === 'open', oc.body)
oc = await pageC(offerOf('77').id, { action: 'answer', yes: true })
ck('Sarah says yes: INTERESTED, not placed; the booking still waits; she is told the family picks', oc.body.interested && offerOf('77').state === 'interested' && !b.caregiver_axiscare_id && b.status === 'waiting_for_caregiver' && /not on the schedule unless they do/.test(oc.body.message), [oc.body, b.status])
W.texts = []; await runC()
ck('the ONE family text: to the person who booked, once, with the app address', W.fam?.length === 1 && W.fam[0].to === 9 && /^Hi Lisa, it's Caring Companions\. A caregiver is interested in Dot's visit on Thu, Oct 22, 1 PM to 4 PM\. Open the app to see who and choose: family\.mo-care\.com/.test(W.fam[0].message) && !!b.family_told_at, W.fam)
await runC()
ck('...never twice', W.fam.length === 1)
o = await goC({ action: 'bookings' })
ck('the app: the visit shows Choosing with 1 interested, never Confirmed', o.body.bookings.find((x) => x.id === b.id).interested === 1 && o.body.bookings.find((x) => x.id === b.id).method === 'choose' && o.body.choose.live === true, o.body)
o = await goC({ action: 'interested', booking_id: b.id })
ck('the app: who is interested = Sarah\'s profile card', o.status === 200 && o.body.caregivers.length === 1 && o.body.caregivers[0].first_name === 'Sarah' && o.body.caregivers[0].offer_id === offerOf('77').id, o.body)
await pageC(offerOf('88').id, { action: 'answer', yes: true })
o = await goC({ action: 'choose', booking_id: b.id, offer_id: offerOf('88').id })
ck('the family chooses Maria: placed on AxisCare, Confirmed, Maria texted "the family chose you", Sarah thanked', o.status === 200 && o.body.placed && b.status === 'placed' && b.caregiver_axiscare_id === '88' && W.visits[b.axiscare_visit_id].caregiver.id === 88 &&
  W.texts.some((t) => t.to === '88' && /the family chose you/.test(t.message)) && W.texts.some((t) => t.to === '77' && /chose another caregiver/.test(t.message)) && offerOf('88').state === 'chosen' && offerOf('77').state === 'not_chosen', [o.body, W.texts])
o = await goC({ action: 'choose', booking_id: b.id, offer_id: offerOf('77').id })
ck('choosing again after it is placed: refused (no double booking)', o.status === 409 && /already confirmed/.test(o.body.error), o)

// re-check at choosing time
reset({ settings: { ...CHOOSE_ON } }); await goC(CB); b = bk(); await runC()
await pageC(offerOf('77').id, { action: 'answer', yes: true }); W.blocked['77'] = 'Sarah Jones is on the No shift texts list'
o = await goC({ action: 'choose', booking_id: b.id, offer_id: offerOf('77').id })
ck('chosen caregiver no longer allowed: not placed, the family is told plainly, she drops off the list', o.status === 409 && /Sarah is no longer available/.test(o.body.error) && b.status === 'waiting_for_caregiver' && offerOf('77').state === 'withdrawn', o)
delete W.blocked['77']

// withdraw
reset({ settings: { ...CHOOSE_ON } }); await goC(CB); b = bk(); await runC()
await pageC(offerOf('77').id, { action: 'answer', yes: true })
oc = await pageC(offerOf('77').id, { action: 'withdraw' })
o = await goC({ action: 'interested', booking_id: b.id })
ck('a caregiver takes it back: gone from the family\'s list', /won't see you/.test(oc.body.message) && offerOf('77').state === 'withdrawn' && o.body.caregivers.length === 0, o.body)

// Find someone for me instead
reset({ settings: { ...CHOOSE_ON } }); await goC(CB); b = bk(); await runC()
await pageC(offerOf('88').id, { action: 'answer', yes: true })
o = await goC({ action: 'auto', booking_id: b.id })
ck('"Find someone for me instead" with someone interested: the first interested is placed now', o.status === 200 && o.body.placed && b.caregiver_axiscare_id === '88' && /placed_by/.test(Object.keys(b).join()) && /family asked us to pick/.test(b.placed_by), [o.body, b.placed_by])
reset({ settings: { ...CHOOSE_ON } }); await goC(CB); b = bk(); await runC()
o = await goC({ action: 'auto', booking_id: b.id })
ck('"Find someone for me instead" with nobody interested yet: it becomes first-yes-wins', o.status === 200 && !o.body.placed && b.method === 'auto', o.body)
oc = await pageC(offerOf('77').id, { action: 'answer', yes: true })
ck('...and the next yes goes straight on the schedule', oc.body.placed && b.caregiver_axiscare_id === '77', oc.body)

// the deadline
reset({ settings: { ...CHOOSE_ON } }); await goC(CB); b = bk(); await runC()
await pageC(offerOf('77').id, { action: 'answer', yes: true }); NOW = new Date('2026-10-20T14:30:00Z'); await pageC(offerOf('88').id, { action: 'answer', yes: true })
NOW = new Date('2026-10-21T18:30:00Z')   // past the deadline, the family never chose; Sarah said yes first
await runC()
ck('deadline passed without a choice: the FIRST interested (Sarah) is placed and told; Maria thanked', b.status === 'placed' && b.caregiver_axiscare_id === '77' && /choosing deadline/.test(b.placed_by) && W.texts.some((t) => t.to === '88' && /chose another caregiver/.test(t.message)), [b.status, b.placed_by, b.caregiver_axiscare_id, W.texts.map((t) => t.to + ': ' + t.message.slice(0, 60))])
NOW = new Date('2026-10-20T14:00:00Z')
reset({ settings: { ...CHOOSE_ON } }); await goC(CB); b = bk(); await runC()
NOW = new Date('2026-10-21T18:30:00Z')
await runC()
ck('deadline passed with nobody interested: it becomes Find someone for me (no office card in Release 1)', b.method === 'auto' && !W.items.some((i) => /Nobody has taken this yet/.test(i.title)), [b.method, W.items.map((i) => i.title)])
NOW = new Date('2026-10-20T14:00:00Z')

// the family text: 8 AM to 8 PM only, and only with the approval recorded
reset({ settings: { ...CHOOSE_ON } }); await goC(CB); b = bk(); await runC()
await pageC(offerOf('77').id, { action: 'answer', yes: true })
NOW = new Date('2026-10-21T02:00:00Z')   // 9 PM Central
await runC()
ck('family text held at night (9 PM)', !W.fam?.length && !b.family_told_at)
NOW = new Date('2026-10-20T14:00:00Z')
await runC()
ck('...and sent in the morning run', W.fam?.length === 1)

// enough interested: stop asking
reset({ settings: { ...CHOOSE_ON, family_choose_max_interested: 1 } }); await goC(CB); b = bk(); await runC()
await pageC(offerOf('77').id, { action: 'answer', yes: true }); W.texts = []
NOW = new Date('2026-10-20T16:00:00Z'); await runC(); NOW = new Date('2026-10-20T14:00:00Z')
ck('with enough interested, nobody else is asked', W.texts.length === 0, W.texts)

// cancel a Let me choose visit
reset({ settings: { ...CHOOSE_ON } }); await goC(CB); b = bk(); await runC()
await pageC(offerOf('77').id, { action: 'answer', yes: true }); W.texts = []
o = await goC({ action: 'cancel', booking_id: b.id })
ck('the family cancels: interested caregivers hear it is no longer needed', o.status === 200 && W.texts.some((t) => t.to === '77' && /no longer needed/.test(t.message)) && offerOf('77').state === 'closed', W.texts)

// ── her offer-flow rules (2026-10-16): asked-for-you only when picked, the About box, the family hears who's coming ──
const CONF_ON = { ...OFFERS_ON, family_confirm_text_approved: { by: 'Samantha' } }
reset({ settings: { ...CONF_ON } }); W.about = 'Dot loves gardening and old movies, and she makes the best sweet tea.'
await go({ action: 'book', date: '2026-10-22', start: '13:00', end: '16:00', tasks: ['Companionship'], who: 'preferred', preferred: ['77'] }); b = bk(); await runC()
oc = await pageC(offerOf('77').id, { action: 'view' })
ck('page: the family asked for Sarah, so it says so; the office\'s About shows', oc.body.asked_for_you === true && /sweet tea/.test(oc.body.about), oc.body)
NOW = new Date('2026-10-20T19:00:00Z'); await runC(); NOW = new Date('2026-10-20T14:00:00Z')
const team = W.offers.find((x) => x.booking_id === b.id && x.caregiver_axiscare_id !== '77')
if (team) { oc = await pageC(team.id, { action: 'view' }); ck('page: a team caregiver the family did NOT ask for sees nothing about being asked for', oc.body.asked_for_you === false, oc.body) }
W.about = null; oc = await pageC(offerOf('77').id, { action: 'view' })
ck('page: no About written = no About (null)', oc.body.about === null, oc.body.about)
oc = await pageC(offerOf('77').id, { action: 'answer', yes: true })
ck('first yes: placed, and the family is queued to hear who is coming', oc.body.placed && b.status === 'placed' && b.family_confirm_pending === true, b)
await runC()
ck('the family hears it once, her pick (warm and simple): "Hi Lisa, good news from Caring Companions! Sarah will be with Dot on Thursday, October 22, from 1 to 4..."', W.told?.length === 1 && W.told[0].to === 9 && W.told[0].sms === "Hi Lisa, good news from Caring Companions! Sarah will be with Dot on Thursday, October 22, from 1 to 4. You can see the details anytime in the app: family.mo-care.com" && b.family_confirm_how === 'sms' && !!b.family_confirmed_at, W.told)
await runC()
ck('...never twice', W.told.length === 1)
ck('the email version (for no Texts OK) says the same, no em dashes', W.told[0].email.subject === 'Good news: Sarah will be with Dot on Thursday, October 22' && /Good news! <b>Sarah<\/b> will be with Dot on <b>Thursday, October 22, from 1 to 4<\/b>/.test(W.told[0].email.html) && !/—/.test(W.told[0].email.html + W.told[0].sms))
// overnight: held until 8 AM
reset({ settings: { ...CONF_ON } }); await go({ action: 'book', date: '2026-10-22', start: '13:00', end: '16:00', tasks: ['Companionship'], who: 'preferred', preferred: ['77'] }); b = bk(); await runC()
await pageC(offerOf('77').id, { action: 'answer', yes: true })
NOW = new Date('2026-10-21T03:00:00Z'); await runC()   // 10 PM Central
ck('accepted late at night: the family message waits (8 AM to 8 PM only)', !W.told?.length && b.family_confirm_pending === true)
NOW = new Date('2026-10-21T13:10:00Z'); await runC(); NOW = new Date('2026-10-20T14:00:00Z')   // 8:10 AM
ck('...and goes in the first run after 8 AM', W.told?.length === 1)
// no approval recorded = never sent
reset({ settings: { ...OFFERS_ON } }); await go({ action: 'book', date: '2026-10-22', start: '13:00', end: '16:00', tasks: ['Companionship'], who: 'preferred', preferred: ['77'] }); b = bk(); await runC()
await pageC(offerOf('77').id, { action: 'answer', yes: true }); await runC()
ck('without her recorded approval the family message never goes (it just waits)', !W.told?.length && b.family_confirm_pending === true)
// can't reach them: office card
reset({ settings: { ...CONF_ON } }); W.tellFail = 'GoHighLevel refused the text'; await go({ action: 'book', date: '2026-10-22', start: '13:00', end: '16:00', tasks: ['Companionship'], who: 'preferred', preferred: ['77'] }); b = bk(); await runC()
await pageC(offerOf('77').id, { action: 'answer', yes: true }); await runC()
ck('the message fails: never silent, an office card says so', W.items.some((i) => /Tell the family who's coming/.test(i.title) && /refused/.test(i.detail)) && /not sent/.test(b.family_confirm_how), W.items.map((i) => i.title))
// Let me choose: the family's chosen caregiver also queues the family message
reset({ settings: { ...CHOOSE_ON, ...CONF_ON } }); await goC(CB); b = bk(); await runC()
await pageC(offerOf('88').id, { action: 'answer', yes: true }); await goC({ action: 'choose', booking_id: b.id, offer_id: offerOf('88').id })
ck('Let me choose: once the chosen caregiver is placed, the family message is queued too', b.status === 'placed' && b.family_confirm_pending === true)

ck('times read naturally: from 1 to 4, from 10 AM to 1 PM across noon, from 9 to 12', fo.fromTo('13:00', '16:00') === 'from 1 to 4' && fo.fromTo('10:00', '13:00') === 'from 10 AM to 1 PM' && fo.fromTo('09:00', '12:00') === 'from 9 to 12' && fo.fromTo('08:30', '10:30') === 'from 8:30 to 10:30')
ck('no em dashes in any Let me choose wording', ![fo.MSG_CHOOSE, fo.MSG_CHOSEN, fo.MSG_NOT_CHOSEN, fo.MSG_CHOOSE_CANCELLED, fo.MSG_FAMILY_INTERESTED].some((m) => /—/.test(m)))

// ── Release 1 (her approval 2026-10-17): two stages, no night texts, the 9 PM confirmation ───────────────────────
NOW = new Date('2026-10-20T14:00:00Z')   // Tue 9 AM Central
reset({ settings: { ...OFFERS_ON } }); await go({ action: 'book', date: '2026-11-05', start: '10:00', end: '13:00', tasks: ['Companionship'], who: 'preferred', preferred: ['77'] }); b = bk()
ck('R1 two stages: a visit 16 days out is saved with the team from Thu Oct 29 8 AM and the answer by Tue Nov 3 6 PM', b.two_stage === true && b.team_from === '2026-10-29T13:00:00.000Z' && b.answer_by === '2026-11-04T00:00:00.000Z', { team: b.team_from, by: b.answer_by })   // 6 PM CST, after the clock change
await run()
ck('R1 two stages: Sarah (the pick) is asked now', W.texts.length === 1 && W.texts[0].to === '77', W.texts.map((t) => t.to))
await page(W.offers[0].id, { action: 'answer', yes: false }); await run(); await run()
ck('R1 two stages: Sarah said no, but the wider team is NOT asked before Oct 29', W.texts.length === 1 && b.status === 'waiting_for_caregiver', W.texts.map((t) => t.to))
NOW = new Date('2026-10-29T13:05:00Z')   // Thu Oct 29, 8:05 AM
await run()
ck('R1 two stages: from Oct 29 the wider team is asked, once', W.texts.length > 1 && W.texts.slice(1).every((t) => t.to !== '77'), W.texts.map((t) => t.to))
NOW = new Date('2026-10-20T14:00:00Z')
// no night texts for an optional visit, even within 3 hours (the old exception is gone)
reset({ settings: { ...OFFERS_ON } }); W.bookings.push({ id: 'b-night', axiscare_client_id: '501', client_name: 'Dot', state: 'MO', contact_id: 9, kind: 'set', visit_date: '2026-10-21', start_time: '07:00', end_time: '09:00', hours: 2, tasks: ['Companionship'], who: 'any', preferred_caregiver_ids: [], status: 'waiting_for_caregiver', offer_stage: null, caregiver_axiscare_id: null, answer_by: '2026-10-21T11:00:00.000Z' })
NOW = new Date('2026-10-21T10:30:00Z')   // 5:30 AM, the visit at 7 AM is within 3 hours
o = await run()
ck('R1 night: 5:30 AM, a visit within 3 hours: still nobody is texted', W.texts.length === 0 && o.held_night === 1, o)
NOW = new Date('2026-10-20T14:00:00Z')
// the who's-coming confirmation may go until 9 PM; not until 9:05
const conf = () => ({ ...offDeps(), confirmDue: async () => W.bookings.filter((x) => x.status === 'placed' && x.family_confirm_pending === true && !x.family_confirmed_at) })
reset({ settings: { ...OFFERS_ON, family_confirm_text_approved: { by: 'Samantha' } } })
W.bookings.push({ id: 'b-c', axiscare_client_id: '501', client_name: 'Dot', state: 'MO', contact_id: 9, requested_by_name: 'Lisa Ray', kind: 'set', visit_date: '2026-10-22', start_time: '10:00', end_time: '12:00', hours: 2, status: 'placed', caregiver_name: 'Maria L.', family_confirm_pending: true })
NOW = new Date('2026-10-21T01:40:00Z')   // 8:40 PM
await fo.runOffers(conf())
ck('R1 confirmation at 8:40 PM: sent (until 9 PM)', W.told?.length === 1 && W.told[0].key !== 'family_unfilled_text_approved', W.told)
W.told = []; W.bookings[0].family_confirmed_at = null; W.bookings[0].family_confirm_pending = true
NOW = new Date('2026-10-21T02:05:00Z')   // 9:05 PM
await fo.runOffers(conf())
ck('R1 confirmation at 9:05 PM: held until morning', W.told.length === 0, W.told)
NOW = new Date('2026-10-20T14:00:00Z')
// "not filled" waits for 8 AM to 7:30 PM
reset({ settings: { ...OFFERS_ON, family_unfilled_text_approved: { by: 'Samantha' } } })
W.bookings.push({ id: 'b-u', axiscare_client_id: '501', client_name: 'Dot', state: 'MO', contact_id: 9, requested_by_name: 'Lisa Ray', kind: 'set', visit_date: '2026-10-22', start_time: '10:00', end_time: '12:00', hours: 2, status: 'not_filled', family_unfilled_pending: true })
NOW = new Date('2026-10-21T00:45:00Z')   // 7:45 PM
await run()
ck('R1 not filled at 7:45 PM: held', !W.told?.length, W.told)
NOW = new Date('2026-10-21T13:01:00Z')   // 8:01 AM
await run()
ck('R1 not filled at 8:01 AM: sent once, its own approval', W.told?.length === 1 && W.told[0].key === 'family_unfilled_text_approved', W.told)
NOW = new Date('2026-10-20T14:00:00Z')
// a family cancelling a request nobody accepted closes the caregivers' links
reset({ settings: { ...OFFERS_ON } }); await go({ action: 'book', date: '2026-10-22', start: '13:00', end: '16:00', tasks: ['Companionship'], who: 'any' }); b = bk(); await run()
o = await go({ action: 'cancel', booking_id: b.id })
const lo = W.offers[0]
o = await page(lo.id, { action: 'view' })
ck('R1 the family cancels a request: a caregiver opening their link sees it was cancelled', o.body.state === 'cancelled', o.body)
const fdb2 = fs.readFileSync(path.join(F, '_shared/family-offer-db.ts'), 'utf8')
// R2 (2026-10-17): the approved family messages are one list (SENDERS); tellFamily refuses any key not on it or not recorded.
const senders = fdb2.slice(fdb2.indexOf('const SENDERS'), fdb2.indexOf('const PROFILE_COLS'))
ck('R1/R2 guard: each family message only goes behind its own recorded approval', ['family_confirm_text_approved', 'family_unfilled_text_approved', 'family_cgchange_text_approved', 'family_timechange_text_approved'].every((k) => senders.includes(k)) &&
  /Object\.keys\(SENDERS\)\.includes\(approvalKey\) \|\| !st\[approvalKey\]/.test(fdb2), senders)

// ── Release 3 (her "Start Release 3." 2026-10-17): notes, held requests, Help us fill ──────────────────────────────────
const R3 = { ...OFFERS_ON, family_declined_text_approved: { by: 'Samantha' }, family_couldnt_text_approved: { by: 'Samantha' }, family_unfilled_text_approved: { by: 'Samantha' } }
const officeR3 = (body, roles = ['care_coordinator']) => off.officeAction({ ...offDepsOffice(), circle: async () => ({ id: 'c1', client_name: 'Dorothy Ray', help_fill: W.circle?.help_fill ?? null }), setAbout: async (id, v) => { W.circle = { ...(W.circle ?? {}), ...v }; return true } }, { email: 'k@mo-care.com', name: 'Krystal', roles }, body)
const SET = { action: 'book', date: '2026-10-22', start: '10:00', end: '12:00', tasks: ['Companionship'], who: 'any' }
reset({ settings: R3 })
o = await go({ ...SET, note: 'x'.repeat(301) })
ck('R3 the note is 300 characters at most', o.status === 400 && /300 characters/.test(o.body.error), o.body)
// Her choice 2026-10-17 ("Stop it at Send"): nothing is saved or sent, nobody in the office is involved
let n0 = W.bookings.length
o = await go({ ...SET, note: 'Please help her shower before lunch' })
ck('R3 a personal-care note is stopped at Send: nothing saved, no office task, the family told why', o.status === 422 && o.body.blocked === true && W.bookings.length === n0 && !W.items.length &&
  o.body.error === "Your note asks for help with bathing, toileting or dressing, which extra visits through the app don't include. Please change or remove the note, or call us at (417) 234-8494 and we'll help.", o.body)
o = await go({ action: 'when', date: '2026-10-22', start: '10:00', note: 'give her her meds at noon' })
ck('R3 the app is warned before Send too (medication)', /help with medication or medical care/.test(o.body.note_block ?? ''), o.body)
o = await go({ action: 'when', date: '2026-10-22', start: '10:00', note: 'Cards and a walk' })
ck('R3 an ordinary note: no warning', o.body.note_block === null, o.body)
o = await go({ ...SET, note: 'She fell yesterday, please keep her company' })
ck('R3 emergency words: the 911 message, nothing sent', o.status === 422 && o.body.emergency === true && /^If this is an emergency, call 911 now\./.test(o.body.error) && W.bookings.length === n0, o.body)
W.ai = { verdict: 'outside', why: 'asks for nail clipping' }
o = await go({ ...SET, note: 'Clip her toenails please' })
ck('R3 AI says outside companion care: stopped at Send the same way, nothing saved', o.status === 422 && /asks for something extra visits through the app don't include/.test(o.body.error) && W.bookings.length === n0, o.body)
W.ai = { verdict: 'concern', why: 'She may wander at night' }
o = await go({ ...SET, note: 'She loves cards and a short walk' }); b = bk()
ck('R3 AI concern: the request goes on (the caregiver reads the note), recorded, no office task', o.status === 200 && b.status === 'waiting_for_caregiver' && b.note_check === 'ai_concern' && !W.items.length, { o: o.body, b })
await run()
ck('R3 the run asks caregivers straight away; nothing is held', W.texts.length > 0 && b.status === 'waiting_for_caregiver' && !W.items.length, { t: W.texts.length, items: W.items })
reset({ settings: R3 }); W.ai = null; o = await go({ ...SET, note: 'Cards please' })
ck('R3 AI unavailable: the rules decide, the request goes on', o.status === 200 && bk().note_check === 'ai_unavailable')
ck('R3 no request is ever held for the office any more', !W.bookings.some((x) => x.status === 'held'))
reset({ settings: R3 }); W.circle = { app_tasks: ['Companionship'] }
o = await go({ action: 'home' })
ck('R3 layer 1: the app only offers the tasks allowed for this client', o.body.tasks.join() === 'Companionship', o.body.tasks)
o = await go({ ...SET, tasks: ['Meal preparation'] })
ck('R3 layer 1: a task not allowed for this client is refused', o.status === 400, o.body)

// Help us fill
o = await officeR3({ action: 'help_fill', circle_id: 'c1', on: true, reason: 'Respite' }, ['staffing_coordinator'])
ck('R3 Help us fill: only Samantha or Krystal (owner, care coordinator) can set it', o.status === 403)
o = await officeR3({ action: 'help_fill', circle_id: 'c1', on: true }, ['care_coordinator'])
ck('R3 Help us fill: a reason is required', o.status === 400)
reset({ settings: R3 }); o = await officeR3({ action: 'help_fill', circle_id: 'c1', on: true, reason: 'Respite for her daughter' })
ck('R3 Help us fill: on for 90 days', o.status === 200 && W.circle.help_fill.on === true && W.circle.help_fill.review_by === '2027-01-18', W.circle)
o = await go({ ...SET }); b = bk()
ck('R3 Help us fill: the family is told the office will also try, no guarantee', /our office will also try to arrange this visit\. We can't guarantee a caregiver\./.test(o.body.message) && b.help_fill === true, o.body)
o = await go({ action: 'when', date: '2026-10-24', start: '09:00' })
ck('R3 Help us fill, a Saturday visit asked on Tuesday: the office has Thursday and Friday to help', /our office will also try/.test(o.body.help ?? ''), o.body)
NOW = new Date('2026-10-23T20:00:00Z')   // Friday 3 PM, for Saturday 2 PM: the office closes before it could help
o = await go({ action: 'when', date: '2026-10-24', start: '14:00' })
ck('R3 Help us fill, Friday afternoon for Saturday: "our office isn\'t able to help with this one in time"', /isn't able to help with this one in time/.test(o.body.help ?? ''), o.body)
NOW = new Date('2026-10-20T14:00:00Z')
await run()
for (const x of W.offers) x.state = 'declined'
await run(); await run()
ck('R3 everyone said no on a Help us fill client: one office task (a Tuesday morning), no early end', b.offer_stage === 'done' && b.status === 'waiting_for_caregiver' && W.items.filter((x) => x.id === `fam_fill_${b.id}`).length === 1, { b, items: W.items.map((x) => x.id) })
o = await officeR3({ action: 'fill_close', booking_id: b.id, how: 'couldnt' }); await run()
ck("R3 couldn't fill: the family gets the approved wording (our office also tried), its own approval", b.status === 'not_filled' && W.told?.[0]?.key === 'family_couldnt_text_approved' && /our office also tried/.test(W.told[0].sms) && W.items.find((x) => x.id === `fam_fill_${b.id}`).status === 'done', W.told)
reset({ settings: R3 }); W.circle = { help_fill: { on: true, review_by: '2027-01-18' } }; await go({ ...SET }); b = bk(); await run(); for (const x of W.offers) x.state = 'declined'
NOW = new Date('2026-10-24T15:00:00Z')   // Saturday 10 AM
b.visit_date = '2026-10-27'; b.answer_by = '2026-10-26T23:00:00Z'; await run(); await run()
ck('R3 Help us fill on a Saturday: no office task (Monday to Friday only)', !W.items.some((x) => x.id === `fam_fill_${b.id}`), W.items.map((x) => x.id))
NOW = new Date('2026-10-20T14:00:00Z')
reset({ settings: R3 }); W.circle = { help_fill: { on: true, review_by: '2026-10-01' } }; o = await go({ ...SET })
ck('R3 Help us fill past its review date counts as off', !/our office will also try/.test(o.body.message) && bk().help_fill === false)

for (const [n, ok, note] of res) console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note))
const bad = res.filter((x) => !x[1]).length
console.log(`\n  family app flexible booking + offers: ${res.length - bad}/${res.length} passed`)
process.exit(bad ? 1 : 0)
