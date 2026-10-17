// Release 2, "stays accurate" (her "Start Release 2." 2026-10-17). Under Node against the REAL _shared/family-sync.ts with a
// stand-in AxisCare, bookings, Coverage Help cases and family messages. Nothing real is touched.
//   node family_sync_test.mjs
import path from 'path'
import { pathToFileURL } from 'url'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)])
const imp = (p) => import(pathToFileURL(path.resolve('supabase/functions', p)).href)
const fs_ = await imp('_shared/family-sync.ts')

const utc = (date, hm) => new Date(`${date}T${hm}:00-05:00`).toISOString()   // October = CDT
let NOW = new Date('2026-10-20T15:00:00Z')   // Tue Oct 20, 10:00 AM Central
const APPROVED = { family_cgchange_text_approved: { by: 'Samantha' }, family_timechange_text_approved: { by: 'Samantha' } }
let W
function world(over = {}) {
  W = { st: { family_app_live: true, family_fee_check_ready: true, ...APPROVED, ...(over.st ?? {}) }, bookings: [], visits: {}, cases: new Map(), items: [], closed: [], events: [], sent: [], axCalls: 0, axStatus: {} }
  return W
}
function booking(id, vals = {}) {
  const b = { id, status: 'placed', state: 'MO', client_name: 'Dorothy Ray', requested_by_name: 'Lisa Ray', contact_id: 9, axiscare_client_id: '501', axiscare_visit_id: `v=${id}`,
    visit_date: '2026-10-21', start_time: '10:00', end_time: '12:00', caregiver_axiscare_id: '77', caregiver_name: 'Sarah J.', family_confirm_pending: false, family_confirmed_at: '2026-10-19T15:00:00Z', ...vals }
  W.bookings.push(b)
  W.visits[b.axiscare_visit_id] = { id: b.axiscare_visit_id, client: { id: 501 }, caregiver: { id: 77, firstName: 'Sarah', lastName: 'Jones' }, timezone: 'US/Central',
    scheduledStartDate: utc(b.visit_date, b.start_time), scheduledEndDate: utc(b.visit_date, b.end_time) }
  return b
}
const B = (id) => W.bookings.find((x) => x.id === id)
const deps = () => ({
  ax: async (m, p) => {
    W.axCalls++
    const id = decodeURIComponent(p.replace('/api/visits/', ''))
    if (W.axStatus[id]) return { status: W.axStatus[id], json: { errors: ['x'] } }
    const v = W.visits[id]; return v ? { status: 200, json: { results: { visit: v } } } : { status: 404, json: { errors: ['Visit not found'] } }
  },
  now: () => NOW,
  settings: async () => W.st,
  placedAhead: async (from, to) => W.bookings.filter((b) => b.status === 'placed' && b.axiscare_visit_id && b.visit_date >= from && b.visit_date <= to).map((b) => ({ ...b })),
  coverage: async () => W.cases,
  updateBooking: async (id, vals) => { Object.assign(B(id), vals); return true },
  officeItem: async (it) => { const i = W.items.findIndex((x) => x.id === it.id); if (i >= 0) W.items[i] = it; else W.items.push(it); return true },
  closeItem: async (id, by, text) => { const it = W.items.find((x) => x.id === id && x.status !== 'done'); if (it) { it.status = 'done'; W.closed.push(id) } },
  event: async (r) => { W.events.push(r) },
  changeDue: async () => W.bookings.filter((b) => b.status === 'placed' && b.family_change_pending === true && !b.family_change_at).map((b) => ({ ...b })),
  tellFamily: async (b, sms, email, key) => { W.sent.push({ id: b.id, sms, subject: email.subject, key }); return W.failSend ? { ok: false, why: W.failSend } : { ok: true, how: 'sms' } },
})
const run = (o) => fs_.syncPlaced(deps(), o)
const at = (iso) => { NOW = new Date(iso) }

// ── nothing changed ──────────────────────────────────────────────────────────────────
world(); booking('a'); at('2026-10-20T15:00:00Z')
let o = await run()
ck('same: nothing changes, nobody hears, the check is stamped', o.checked === 1 && o.same === 1 && !W.sent.length && !W.items.length && B('a').ax_checked_at, o)

// ── another caregiver ────────────────────────────────────────────────────────────────
world(); booking('a'); W.visits['v=a'].caregiver = { id: 88, firstName: 'Maria', lastName: 'Lopez' }
o = await run()
ck('caregiver changed: the app shows Maria L.', B('a').caregiver_axiscare_id === '88' && B('a').caregiver_name === 'Maria L.' && o.changed === 1, B('a'))
ck('caregiver changed: one message owed, from Sarah', B('a').family_change_pending === true && B('a').family_change_kind === 'caregiver' && B('a').family_change_from?.caregiver === 'Sarah J.', B('a'))
ck('not sent in the same run that found it (the next run sends)', !W.sent.length)
o = await run()
ck('caregiver changed: her wording, the caregiver-changed approval', W.sent.length === 1 && W.sent[0].key === 'family_cgchange_text_approved' &&
  W.sent[0].sms === "Hi Lisa, it's Caring Companions. Maria will be with Dorothy on Wednesday, October 21, from 10 to 12, instead of Sarah. You can see the details anytime in the app: family.mo-care.com", W.sent)
ck('sent once: marked done, never again', B('a').family_change_pending === false && B('a').family_change_how === 'sms' && (await run(), W.sent.length === 1), B('a'))
ck('no em dash in the family messages', !/—/.test(fs_.MSG_FAMILY_CG_CHANGED + fs_.MSG_FAMILY_TIME_CHANGED))

// ── Coverage Help owns it ─────────────────────────────────────────────────────────────
world(); booking('a'); W.visits['v=a'].caregiver = { id: 88, firstName: 'Maria', lastName: 'Lopez' }; W.cases.set('v=a', { id: 'cc1', status: 'covered', axiscare_visit_id: 'v=a' })
await run(); await run()
ck('Coverage Help case: the app updates, the app sends nothing (one message source)', B('a').caregiver_name === 'Maria L.' && !B('a').family_change_pending && !W.sent.length, { b: B('a'), sent: W.sent })

// ── time changed ─────────────────────────────────────────────────────────────────────
world(); booking('a'); W.visits['v=a'].scheduledStartDate = utc('2026-10-21', '11:00'); W.visits['v=a'].scheduledEndDate = utc('2026-10-21', '13:00')
await run(); await run()
ck('time changed: the app shows 11 to 1', B('a').start_time === '11:00' && B('a').end_time === '13:00' && B('a').family_change_kind === 'time', B('a'))
ck('time changed: her wording, the time-changed approval', W.sent.length === 1 && W.sent[0].key === 'family_timechange_text_approved' &&
  W.sent[0].sms === "Hi Lisa, it's Caring Companions. Dorothy's visit is now on Wednesday, October 21, from 11 AM to 1 PM, with Sarah. You can see the details anytime in the app: family.mo-care.com", W.sent)

// ── both, and the day moved ──────────────────────────────────────────────────────────
world(); booking('a'); Object.assign(W.visits['v=a'], { caregiver: { id: 88, firstName: 'Maria', lastName: 'Lopez' }, scheduledStartDate: utc('2026-10-22', '14:00'), scheduledEndDate: utc('2026-10-22', '16:00') })
await run(); await run()
ck('both changed: day, time and caregiver follow AxisCare; one message', B('a').visit_date === '2026-10-22' && B('a').caregiver_name === 'Maria L.' && B('a').family_change_kind === 'both' && W.sent.length === 1 &&
  /visit is now on Thursday, October 22, from 2 to 4, with Maria/.test(W.sent[0].sms), { b: B('a'), sent: W.sent })
world({ st: { family_timechange_text_approved: null } }); booking('a'); Object.assign(W.visits['v=a'], { caregiver: { id: 88, firstName: 'Maria' }, scheduledStartDate: utc('2026-10-22', '14:00'), scheduledEndDate: utc('2026-10-22', '16:00') })
await run(); await run()
ck('both changed needs both approvals; without them nothing is sent, and it says why', !W.sent.length && /not sent: the family message is not approved/.test(B('a').family_change_how) && !W.items.length, B('a'))

// ── changes back before we told them ─────────────────────────────────────────────────
world(); booking('a'); at('2026-10-21T02:00:00Z')   // Tue 9 PM: no family messages now
W.visits['v=a'].caregiver = { id: 88, firstName: 'Maria' }; await run()
ck('night: the change is saved but nobody is texted (8 AM to 8 PM)', B('a').family_change_pending === true && !W.sent.length)
W.visits['v=a'].caregiver = { id: 77, firstName: 'Sarah', lastName: 'Jones' }; await run()
at('2026-10-21T13:30:00Z'); await run()   // Wed 8:30 AM
ck('changed back before morning: nothing to say, nothing sent', B('a').family_change_pending === false && !W.sent.length && B('a').caregiver_name === 'Sarah J.', { b: B('a'), sent: W.sent })
at('2026-10-20T15:00:00Z')

// ── the confirmation hasn't gone yet ─────────────────────────────────────────────────
world(); booking('a', { family_confirm_pending: true, family_confirmed_at: null }); W.visits['v=a'].caregiver = { id: 88, firstName: 'Maria' }
await run(); await run()
ck('confirmation still owed: it carries the new caregiver; no second message', B('a').caregiver_axiscare_id === '88' && !B('a').family_change_pending && !W.sent.length, B('a'))

// ── caregiver taken off ──────────────────────────────────────────────────────────────
world(); booking('a'); W.visits['v=a'].caregiver = null
o = await run()
ck('no caregiver, no Coverage Help case: the app is told nobody is on it (no promise); one office card', B('a').sync_state === 'no_caregiver' && B('a').sync_note === 'Sarah J.' && W.items.length === 1 && W.items[0].id === 'fam_nocg_a' && !W.sent.length, { b: B('a'), items: W.items })
await run()
ck('next run: no second card, still no message', W.items.length === 1 && !W.sent.length)
W.visits['v=a'].caregiver = { id: 77, firstName: 'Sarah', lastName: 'Jones' }; await run()
ck('the caregiver is put back: the app is normal again and the card closes', B('a').sync_state === 'ok' && W.closed.includes('fam_nocg_a') && !W.sent.length, { b: B('a'), closed: W.closed })
world(); booking('a'); W.visits['v=a'].caregiver = null; W.cases.set('v=a', { id: 'cc2', status: 'open', axiscare_visit_id: 'v=a' })
await run()
ck('call-off with an open Coverage Help case: no office card (Coverage Help owns it)', B('a').sync_state === 'no_caregiver' && !W.items.length, W.items)
W.visits['v=a'].caregiver = { id: 88, firstName: 'Maria' }; W.cases.set('v=a', { id: 'cc2', status: 'covered', axiscare_visit_id: 'v=a' }); await run(); await run()
ck('covered by Coverage Help: Maria shows, the app sends nothing (Coverage Help texted)', B('a').caregiver_name === 'Maria' && B('a').sync_state === 'ok' && !W.sent.length, B('a'))

// ── removed in AxisCare ──────────────────────────────────────────────────────────────
world(); booking('a'); delete W.visits['v=a']
o = await run()
ck('removed (404): the app shows it cancelled by us; no message; "make sure the family knows why" card', B('a').status === 'cancelled' && B('a').cancel_source === 'office' && !W.sent.length && W.items.some((x) => x.id === 'fam_removed_a' && /knows why/.test(x.title)), { b: B('a'), items: W.items })
world(); booking('a'); W.visits['v=a'].removed = true; await run()
ck('removed (removed: true) is the same', B('a').status === 'cancelled' && B('a').sync_state === 'removed')

// ── safety ───────────────────────────────────────────────────────────────────────────
world(); booking('a'); W.axStatus['v=a'] = 500; await run()
ck('AxisCare unreadable: nothing changes', B('a').status === 'placed' && B('a').sync_state === undefined && !W.items.length)
world(); booking('a'); W.visits['v=a'].clockIn = { time: utc('2026-10-21', '10:01') }; W.visits['v=a'].caregiver = { id: 88 }; await run()
ck('a visit that started is left alone', B('a').caregiver_axiscare_id === '77')
world(); booking('a', { visit_date: '2026-10-20', start_time: '09:00', end_time: '11:00' }); W.visits['v=a'].caregiver = null; o = await run()
ck('today, already past its start: not checked', o.checked === 0 && !W.items.length, o)
world(); booking('a', { visit_date: '2026-11-20' }); await run()
ck('only the next 14 days are checked', W.axCalls === 0)
world({ st: { family_app_live: false, family_app_live_clients: ['999'] } }); booking('a'); await run()
ck('a client not live in the app is not checked', W.axCalls === 0)
world({ st: { family_sync_live: false } }); booking('a'); o = await run()
ck('family_sync_live off: nothing at all', W.axCalls === 0 && o.held)
world(); booking('a'); W.visits['v=a'].caregiver = null; o = await run({ dry: true })
ck('dry run: says what it would do, writes and sends nothing', o.would.length === 1 && !B('a').sync_state && !W.items.length, o)
world(); booking('a'); W.visits['v=a'].caregiver = { id: 88, firstName: 'Maria' }; await run()
at('2026-10-21T15:30:00Z'); await run()   // Wed 10:30, after the 10:00 visit started
ck('the visit started before we could tell them: not sent, no card', !W.sent.length && /already started/.test(B('a').family_change_how) && !W.items.length, B('a'))
at('2026-10-20T15:00:00Z')
world(); W.failSend = 'GoHighLevel refused the text (Needs Attention card raised)'; booking('a'); W.visits['v=a'].caregiver = { id: 88, firstName: 'Maria' }; await run(); await run()
ck('a refused message becomes a "call the family" card (no silent failures)', W.items.some((x) => x.id === 'fam_change_tell_a') && /not sent/.test(B('a').family_change_how), { items: W.items, b: B('a') })
world(); W.failSend = 'no way to reach them (no Texts OK and no email)'; booking('a'); W.visits['v=a'].caregiver = { id: 88, firstName: 'Maria' }; await run(); await run()
ck('no way to reach them: recorded, no card (the app shows it)', !W.items.length && /no way to reach/.test(B('a').family_change_how))

const fam = await imp('_shared/family-app.ts')
const bv1 = fam.bookingView({ id: 'x', visit_date: '2026-10-21', status: 'placed', sync_state: 'no_caregiver', sync_note: 'Sarah J.', caregiver_name: 'Sarah J.' })
const bv2 = fam.bookingView({ id: 'y', visit_date: '2026-10-21', status: 'cancelled', cancel_source: 'office' })
const bv3 = fam.bookingView({ id: 'z', visit_date: '2026-10-21', status: 'cancelled', cancelled_by: 'Lisa' })
const fsync = (await import('fs')).readFileSync('supabase/functions/_shared/family-sync.ts', 'utf8')
ck('office card repeats her wording, no promise of a replacement', /can't promise one, and will contact them either way/.test(fsync) && !/arranging another caregiver/.test(fsync.slice(fsync.indexOf('export async function syncPlaced'))))
ck('the app is told: nobody on it now (Sarah came off); removed by us; a family cancel is not "by us"', bv1.no_caregiver && bv1.off_caregiver === 'Sarah' && bv2.by_office && !bv3.by_office && !bv2.no_caregiver, [bv1, bv2, bv3])
const fsrc = (await import('fs')).readFileSync('supabase/functions/_shared/family-app.ts', 'utf8')
ck('no late charge when AxisCare shows nobody on the visit', /const late = left < FREE_CANCEL_HOURS && b\.sync_state !== 'no_caregiver'/.test(fsrc))
for (const [n, okk, note] of res) console.log((okk ? '  ✓ ' : '  ✗ ') + n + (okk ? '' : '\n      ' + note))
const passed = res.filter((r) => r[1]).length
console.log(`\n  family sync: ${passed}/${res.length} passed`)
process.exit(passed === res.length ? 0 : 1)
