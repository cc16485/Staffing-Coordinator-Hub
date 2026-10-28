// The caregiver profile to families before a new caregiver (her approval 2026-10-28) against the REAL _shared/profile-intro.ts.
//   node profile_intro_test.mjs
import path from 'path'
import { pathToFileURL } from 'url'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)])
const P = await import(pathToFileURL(path.resolve('supabase/functions/_shared/profile-intro.ts')).href)
const O = await import(pathToFileURL(path.resolve('supabase/functions/_shared/outreach.ts')).href)

const sarah = { id: '11111111-2222-3333-4444-555555555555', first_name: 'Sarah', last_name: 'Thompson', published: true, axiscare_id: '900' }
const linda = { id: 'c1', name: 'Linda Ray', phone: '4175550123', sms_consent: true, email: 'linda@example.com' }
const visit = (v = {}) => ({ id: 'v1', client: '55', clientName: 'Dorothy Ray', cg: '900', cgName: 'Sarah Thompson', start: '2026-10-30T09:00:00', ...v })
let NOW, S
function world(o = {}) {
  S = { st: { profile_intro_approved: { by: 'Samantha' }, profile_intro_live: true, ...(o.st || {}) },
    visits: o.visits ?? [visit()], pairs: new Set(o.pairs || ['77_123']), clients: new Set(o.clients || []), introduced: new Set(o.introduced || []),
    ledger: new Map((o.ledger || []).map((r) => [r.id, r])), profile: 'profile' in o ? o.profile : sarah,
    circle: 'circle' in o ? o.circle : { id: 'circ1' }, contacts: o.contacts ?? [linda], cc: 'krystal@mo-care.com',
    sends: [], logs: [], items: [], closed: [], saved: [], sendResult: o.sendResult || (() => ({ ok: true })), histOk: o.histOk ?? true, visOk: o.visOk ?? true }
}
const deps = () => ({
  now: () => NOW, settings: async () => S.st,
  visits: async () => S.visOk ? { ok: true, rows: S.visits } : { ok: false, rows: [], error: 'down' },
  history: async () => S.histOk ? { ok: true, pairs: S.pairs, clients: S.clients } : { ok: false, pairs: new Set(), clients: new Set(), error: 'still learning' },
  introduced: async () => S.introduced, ledger: async () => new Map(S.ledger),
  saveLedger: async (r) => { S.saved.push(r); S.ledger.set(r.id, r) },
  profileOf: async () => ({ profile: S.profile, why: S.profile ? '' : 'no published profile' }),
  circleOf: async () => ({ circle: S.circle, contacts: S.circle ? S.contacts : [], why: S.circle ? '' : "their family circle isn't linked to AxisCare" }),
  coordinatorOf: async () => S.cc,
  send: async (c, ch, m) => { S.sends.push({ to: c.name, ch, ...m }); return S.sendResult(c, ch) },
  logIntro: async (r) => { S.logs.push(r) }, officeItem: async (i) => { S.items.push(i) }, closeItem: async (id, note) => { S.closed.push({ id, note }) },
})
const run = (o) => P.profileIntro(deps(), o)
const WED10 = new Date('2026-10-29T15:00:00Z')   // Thu Oct 29, 10:00 AM Central: the day before Fri Oct 30 9 AM

/* ── timing ── */
ck('timing: the day before, 10 AM: due', P.timing('2026-10-30T09:00', '2026-10-29T10:00') === 'due')
ck('timing: two days before: wait', P.timing('2026-10-30T09:00', '2026-10-28T10:00') === 'wait')
ck('timing: the day before, 7 AM: wait for 8', P.timing('2026-10-30T09:00', '2026-10-29T07:00') === 'wait')
ck('timing: the day before, 7 PM, visit 9 AM next day: wait (8 AM still comes first)', P.timing('2026-10-30T09:00', '2026-10-29T19:00') === 'wait')
ck('timing: 7 PM, visit 7 AM next day: no time left', P.timing('2026-10-30T07:00', '2026-10-29T19:00') === 'no_time')
ck('timing: assigned the same day at 11 AM for 3 PM: due now', P.timing('2026-10-29T15:00', '2026-10-29T11:00') === 'due')
ck('timing: 6 AM for a 7 AM visit today: no time', P.timing('2026-10-29T07:00', '2026-10-29T06:00') === 'no_time')
ck('timing: started', P.timing('2026-10-29T09:00', '2026-10-29T10:00') === 'started')
ck('whenWords: "Friday, Oct 30 at 9:00 AM"', P.whenWords('2026-10-30T09:00:00') === 'Friday, Oct 30 at 9:00 AM', P.whenWords('2026-10-30T09:00:00'))
ck('whenWords: afternoon', P.whenWords('2026-10-30T13:30:00') === 'Friday, Oct 30 at 1:30 PM')

/* ── her approved words ── */
NOW = WED10; world(); let r = await run()
const t1 = S.sends.find((x) => x.ch === 'sms'), e1 = S.sends.find((x) => x.ch === 'email')
ck('first visit text: her words, Sarah T., Dorothy, the day and the link', t1 && t1.text === 'Hi Linda, this is Caring Companions. Sarah T. will be with Dorothy for the first visit on Friday, Oct 30 at 9:00 AM. Here is a little about Sarah, so it is never a stranger at the door: https://cc.mo-care.com/caregiver.html?id=11111111-2222-3333-4444-555555555555 Questions? Call us at (417) 234-8494.', t1)
ck('first visit email: subject "Meet Sarah T., coming Friday, Oct 30"', e1 && e1.subject === 'Meet Sarah T., coming Friday, Oct 30', e1)
ck('email body: her paragraphs and the Meet Sarah button', e1 && e1.html.includes('<b>Sarah T.</b> will be with Dorothy on <b>Friday, Oct 30 at 9:00 AM</b>.')
  && e1.html.includes("here is a little about Sarah, in Sarah's own words:") && e1.html.includes('>Meet Sarah</a>') && e1.html.includes('just call us at (417) 234-8494'), e1)
ck('sent once: ledger sent, one log line (first_visit, automatic, AxisCare ids, both channels)', r.sent === 1 && S.ledger.get('55_900').status === 'sent'
  && S.logs.length === 1 && S.logs[0].reason === 'first_visit' && S.logs[0].channel === 'both' && S.logs[0].client_axiscare_id === '55' && S.logs[0].caregiver_axiscare_id === '900' && S.logs[0].auto === true, { r, logs: S.logs })
r = await run()
ck('the next run sends nothing again', S.sends.length === 2 && r.sent === 0)

world({ clients: ['55'] }); r = await run()
const t2 = S.sends.find((x) => x.ch === 'sms')
ck('new caregiver text: her words', t2 && t2.text === 'Hi Linda, this is Caring Companions. Sarah T. will be with Dorothy on Friday, Oct 30 at 9:00 AM. Sarah has not been out to see Dorothy before, so here is a little about Sarah first: https://cc.mo-care.com/caregiver.html?id=11111111-2222-3333-4444-555555555555 Questions? Call us at (417) 234-8494.', t2)
ck('new caregiver: logged as new_caregiver', S.logs[0]?.reason === 'new_caregiver')

world({ contacts: [{ ...linda, name: 'Dorothy Ray' }] }); await run()
ck('the client themself hears "you"', S.sends[0].text.includes('Sarah T. will be with you for the first visit'), S.sends[0])
world({ st: { profile_intro_text_new: 'Hello {first}! {caregiver} is coming {when}: {link}' }, clients: ['55'] }); await run()
ck('Settings wording replaces the new-caregiver text', S.sends[0].text === 'Hello Linda! Sarah T. is coming Friday, Oct 30 at 9:00 AM: https://cc.mo-care.com/caregiver.html?id=11111111-2222-3333-4444-555555555555')
ck('no em dash in either default text', !/—/.test(P.TEXT_FIRST + P.TEXT_NEW))

/* ── who is new ── */
// AxisCare answers 404 for dates with no visits (1164, the weeks before go-live): first page only
ck('404 on the first page is "no visits"', P.emptyVisitAnswer(404, 0) === true)
ck('404 on a later page stays an error, and other answers are not empty', !P.emptyVisitAnswer(404, 1) && !P.emptyVisitAnswer(500, 0) && !P.emptyVisitAnswer(200, 0))
world({ pairs: [], clients: [] }); r = await run()
ck('a year of history that came back empty: nothing goes, said why', S.sends.length === 0 && !r.would.length && r.problems.some((x) => x.includes('came back empty')), r)
world({ visits: [] }); r = await run()
ck('no visits today or tomorrow is said, not silent', r.problems.some((x) => x.includes('no visits today or tomorrow')), r)
world({ pairs: ['55_900'] }); r = await run()
ck('Sarah visited Dorothy in the last year: nothing', S.sends.length === 0 && r.new_pairs === 0)
world({ introduced: ['55_900'] }); await run()
ck('already introduced (the Introduce button, or the call-in text with her link): nothing', S.sends.length === 0)
world({ visits: [visit(), visit({ id: 'v2', start: '2026-10-30T15:00:00' })] }); r = await run()
ck('two visits the same day: one message', r.sent === 1 && S.sends.filter((x) => x.ch === 'sms').length === 1)

/* ── who hears ── */
world({ contacts: [linda, { id: 'c2', name: 'Tom Ray', phone: '4175550999', sms_consent: false, email: '' }, { id: 'c3', name: 'Ann Ray', email: 'ann@example.com' }] }); await run()
ck('text only with texting OK; email to anyone with an email; no way to reach Tom: skipped', S.sends.filter((x) => x.ch === 'sms').map((x) => x.to).join() === 'Linda Ray'
  && S.sends.filter((x) => x.ch === 'email').map((x) => x.to).join() === 'Linda Ray,Ann Ray')
world({ contacts: [linda, { ...linda, id: 'c4', name: 'Stopped Ray', stopped_at: '2026-10-01' }, { ...linda, id: 'c5', name: 'Gone Ray', axiscare_removed_at: '2026-10-01' }] }); await run()
ck('replied STOP or off the AxisCare contacts: never', !S.sends.some((x) => /Stopped|Gone/.test(x.to)))
world({ clients: ['55'], contacts: [{ ...linda, caregiver_intro_pref: 'never' }] }); r = await run()
ck('"does not want these" for a new caregiver: nothing, no card, remembered', S.sends.length === 0 && S.items.length === 0 && r.not_wanted === 1 && S.ledger.get('55_900')?.status === 'not_wanted')
world({ contacts: [{ ...linda, caregiver_intro_pref: 'never' }] }); await run()
ck('first visit: intro_on_start decides (everybody meets the first caregiver)', S.sends.length === 2)

/* ── cards (live) ── */
world({ profile: null }); r = await run()
ck('no published profile: nothing sent; one card to the Care Coordinator', S.sends.length === 0 && S.items.length === 1 && S.items[0].owner === 'krystal@mo-care.com'
  && S.items[0].title === 'Profile not ready: Sarah Thompson for Dorothy Ray' && S.items[0].id === 'ops_pintro_55_900' && S.items[0].kind === 'profile_intro', S.items)
await run()
ck('the same card is not made again', S.items.length === 1)
S.profile = sarah; r = await run()
ck('published later: it goes, and the card closes', r.sent === 1 && S.closed.length === 1 && S.closed[0].id === 'ops_pintro_55_900')
world({ circle: null }); await run()
ck('family not linked: card says so', S.items[0]?.title === 'Family not linked: Dorothy Ray' && S.items[0].detail.includes("isn't linked to AxisCare"), S.items)
world({ contacts: [{ id: 'c9', name: 'Tom Ray', phone: '4175550999', sms_consent: false }] }); await run()
ck('nobody to reach: card', S.items[0]?.title === 'Nobody to send the profile to: Dorothy Ray')
NOW = new Date('2026-10-30T00:00:00Z'); world({ visits: [visit({ start: '2026-10-30T07:00:00' })] }); await run()   // Thu 7 PM for Fri 7 AM
ck('no time left: a "call the family" card, nothing sent', S.sends.length === 0 && S.items[0]?.title === 'Call the family: Sarah Thompson is new to Dorothy Ray', S.items)
NOW = WED10

/* ── failures (no silent failures) ── */
world({ sendResult: () => ({ ok: false, why: 'GoHighLevel did not take it' }) }); r = await run()
ck('a failed send: retry, no card yet', r.failed === 1 && S.items.length === 0 && S.ledger.get('55_900').status === 'retry')
await run(); ck('within 15 minutes: not tried again', S.ledger.get('55_900').tries === 1)
NOW = new Date(WED10.getTime() + 16 * 60000); await run(); NOW = new Date(WED10.getTime() + 32 * 60000); await run()
ck('after 3 tries: a card says to send it by hand', S.items.length === 1 && S.items[0].title === "Profile didn't go through: Dorothy Ray" && S.ledger.get('55_900').status === 'gave_up', S.items)
NOW = WED10
world({ sendResult: () => ({ ok: false, optedOut: true }) }); r = await run()
ck('everybody opted out: an answer, no card from this check', r.opted_out === 1 && S.items.length === 0 && S.ledger.get('55_900').status === 'opted_out')

/* ── practice (switch off) ── */
world({ st: { profile_intro_live: false } }); r = await run()
ck('practice: nothing sent, the would-send line names Linda, text and email, with the words', S.sends.length === 0 && r.live === false && r.would.length === 1
  && r.would[0].to[0].name === 'Linda Ray' && r.would[0].to[0].text && r.would[0].to[0].email && r.would[0].example.startsWith('Hi Linda, this is Caring Companions.'), r)
r = await run()
ck('practice: listed once, not again the next run', r.would.length === 0)
world({ st: { profile_intro_live: false }, profile: null }); r = await run()
ck('practice: the card it WOULD make is listed, none is made', S.items.length === 0 && r.cards.length === 1 && r.cards[0].kind === 'profile')
world({ ledger: [{ id: '55_900', status: 'practice' }] }); r = await run()
ck('switched on: a pair listed in practice still goes for real', r.sent === 1)
world(); r = await run({ dry: true })
ck('?dry=1 never sends, even with the switch on', S.sends.length === 0 && r.live === false)

/* ── off and fail-closed ── */
world({ st: { profile_intro_approved: null } }); r = await run()
ck('no approval on record: off, nothing at all', r.off && S.sends.length === 0)
world({ histOk: false }); r = await run()
ck('history not ready: nothing sent, the run says why', S.sends.length === 0 && r.problems.some((p) => p.includes('still learning')))
world({ visOk: false }); r = await run()
ck('AxisCare unreadable: nothing sent, said', S.sends.length === 0 && r.problems.length === 1)

/* ── the register ── */
ck('the sender is registered as a family message with her approval', O.SENDER_REGISTER['profile-intro']?.class === 'reactive_external'
  && /profile_intro_approved/.test(O.SENDER_REGISTER['profile-intro'].why))
ck('reactive_external sends 8 AM to 6 PM, weekends too', O.maySend('reactive_external', new Date('2026-10-31T15:00:00Z')).allowed === true
  && O.maySend('reactive_external', new Date('2026-10-31T23:30:00Z')).allowed === false)

let pass = 0
for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length}`)
process.exit(pass === res.length ? 0 : 1)
