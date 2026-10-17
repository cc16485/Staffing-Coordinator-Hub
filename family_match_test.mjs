// Release 3, safe matching for app offers (her "Start Release 3." 2026-10-17, decisions 4 and 5). Under Node against the REAL
// _shared/family-match.ts and family-offer.ts, and the Hub's REAL rulebook (match-rules.js from the care-coordinator-hub
// checkout: HUB_ROOT, default ../r1hub). Nothing real is touched.
//   HUB_ROOT=<care-coordinator-hub checkout> node family_match_test.mjs
import path from 'path'
import fs from 'fs'
import { createRequire } from 'module'
import { pathToFileURL } from 'url'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)])
const imp = (p) => import(pathToFileURL(path.resolve('supabase/functions', p)).href)
const fm = await imp('_shared/family-match.ts'), fo = await imp('_shared/family-offer.ts'), links = await imp('_shared/offer-links.ts')
const HUB = process.env.HUB_ROOT || '../r1hub'
const M = createRequire(import.meta.url)(path.resolve(HUB, 'match-rules.js'))
const TODAY = '2026-10-20'

// ── the rule, one caregiver at a time ─────────────────────────────────────────────────
const plan = (kind, value) => ({ kind, layer: 'plan', value })
const C = (facts = [], extra = {}) => ({ name: 'Dorothy Ray', level: 1, facts, onlyAsk: [], ...extra })
const G = (extra = {}) => ({ axiscare_id: '77', name: 'Sarah Jones', level: 1, gender: 'female', dementia_trained: false, overlay: null, ...extra })
const J = (c, g) => fm.judge(M, c, g, TODAY)
ck('no answers on file: nobody is ruled out (no rule without an answer)', J(C(), G()).cut === null && J(C(null), G({ gender: null })).cut === null)
ck('level: a Level 2 client is not offered to a Level 1 caregiver', /needs Level 2/.test(J(C([], { level: 2 }), G()).cut) && J(C([], { level: 2 }), G({ level: 2 })).cut === null)
ck('level unknown on the caregiver counts as Level 1 (the safe side)', /needs Level 2/.test(J(C([], { level: 2 }), G({ level: null })).cut))
ck('gender REQUIRED: a male caregiver is not asked', /requires a female caregiver/.test(J(C([plan('pref_caregiver_gender', 'female_required')]), G({ gender: 'male' })).cut))
ck('gender PREFERRED: nobody is left out; the match ranks higher', J(C([plan('pref_caregiver_gender', 'female_preferred')]), G({ gender: 'male' })).cut === null &&
  J(C([plan('pref_caregiver_gender', 'female_preferred')]), G()).rank > J(C([plan('pref_caregiver_gender', 'female_preferred')]), G({ gender: 'male' })).rank)
ck('Spanish REQUIRED: only conversational or better', /requires Spanish/.test(J(C([plan('need_spanish', 'required')]), G()).cut) &&
  J(C([plan('need_spanish', 'required')]), G({ overlay: { spanish_ability: 'conversational' } })).cut === null)
ck('dementia care REQUIRED: dementia training needed', /Dementia training/.test(J(C([plan('need_dementia_care', 'required')]), G()).cut) && J(C([plan('need_dementia_care', 'required')]), G({ dementia_trained: true })).cut === null)
const cats = C([plan('home_cats', 'yes'), plan('home_smoking', 'yes')])
ck('cats in the home: asked unless they said "not now" with cats', J(cats, G()).cut === null && /cats/.test(J(cats, G({ overlay: { skills: { ok_cats: { have: 'no' } } } })).cut))
ck('cats and smoking are shown on the offer link instead', fm.homeNotes(M, cats).join('|') === 'Dorothy has cats|Someone smokes in the home', fm.homeNotes(M, cats))
ck('only the care plan counts: an intake answer is not a rule', J(C([{ kind: 'pref_caregiver_gender', layer: 'intake', value: 'female_required' }]), G({ gender: 'male' })).cut === null)
ck('personal-care needs are never used for app visits', J(C([plan('need_bathing', 'required'), plan('need_hoyer_lift', 'required')]), G()).cut === null)
ck('the call-in plan "only ask" list: nobody else is asked', /call-in list \(only Maria\)/.test(J(C([], { onlyAsk: [{ axiscare_id: '88', name: 'Maria Lopez' }] }), G()).cut) &&
  J(C([], { onlyAsk: [{ axiscare_id: '77', name: 'Sarah Jones' }] }), G()).cut === null)

// ── inside the offer run ─────────────────────────────────────────────────────────────
let NOW = new Date('2026-10-20T15:00:00Z'), W
const ROSTER = [{ axiscare_id: '77', name: 'Sarah Jones', first: 'Sarah', phone: '+14175550101', avail: null }, { axiscare_id: '88', name: 'Maria Lopez', first: 'Maria', phone: '+14175550102', avail: null },
  { axiscare_id: '55', name: 'Ann Bee', first: 'Ann', phone: '+14175550103', avail: null }]
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
let n = 0
function world(match) {
  W = { match, bookings: [{ id: uuid(1), status: 'waiting_for_caregiver', state: 'MO', kind: 'set', client_name: 'Dorothy Ray', axiscare_client_id: '501', visit_date: '2026-10-22', start_time: '10:00', end_time: '12:00', hours: 2,
    tasks: ['Companionship'], note: 'She loves cards', who: 'any', preferred_caregiver_ids: [], offer_stage: null, answer_by: '2026-10-21T23:00:00Z' }], offers: [], items: [], texts: [], events: [] }
}
const deps = () => ({
  ax: async (m, p) => p.startsWith('/api/clients/') ? { status: 200, json: { results: { client: { residentialAddress: { city: 'Nixa' } } } } } : { status: 404, json: {} },
  now: () => NOW, supabaseUrl: 'https://h.co',
  settings: async () => ({ family_app_live: true, family_fee_check_ready: true, family_offer_live: true }),
  openBookings: async () => W.bookings.filter((b) => b.status === 'waiting_for_caregiver'),
  booking: async (id) => W.bookings.find((b) => b.id === id) ?? null,
  offers: async (bid) => W.offers.filter((o) => o.booking_id === bid), offer: async (id) => W.offers.find((o) => o.id === id) ?? null,
  insertOffer: async (row) => { const o = { id: uuid(9000 + ++n), ...row }; W.offers.push(o); return { id: o.id } },
  updateOffer: async (id, v) => { Object.assign(W.offers.find((o) => o.id === id), v); return true },
  updateBooking: async (id, v) => { Object.assign(W.bookings.find((b) => b.id === id), v); return true },
  claimBooking: async () => false, roster: async () => ROSTER, askBlock: async () => null,
  sendText: async (c, message) => { W.texts.push({ to: c.axiscare_id, message }); return { ok: true } },
  makeLink: async (id, exp) => links.makeOfferLink('s'.repeat(40), id, exp),
  officeItem: async (it) => { const k = W.items.findIndex((x) => x.id === it.id); if (k >= 0) W.items[k] = it; else W.items.push(it); return true },
  closeItem: async (id) => { const it = W.items.find((x) => x.id === id); if (it) it.status = 'done' },
  event: async (e) => { W.events.push(e) },
  matchFor: async () => W.match,
})
const judgeBy = (cuts, ranks = {}) => ({ ok: true, home: ['Dorothy has cats'], judge: (c) => ({ cut: cuts[c.axiscare_id] ?? null, rank: ranks[c.axiscare_id] ?? 0 }) })
world(judgeBy({ '77': 'The client requires a female caregiver' }, { '55': 1 }))
let o = await fo.runOffers(deps())
const order = W.texts.map((t) => t.to)
ck('a caregiver the rules rule out is never texted, and the reason is recorded', !order.includes('77') && o.skipped.some((s) => s.who === 'Sarah Jones' && /requires a female/.test(s.why)), o.skipped)
ck('a preference ranks: Ann (matches the preference) is asked before Maria', order[0] === '55' && order[1] === '88', order)
ck('what to know is saved for the offer link', JSON.stringify(W.bookings[0].home_notes) === '["Dorothy has cats"]')
const pg = await fo.offerPage(deps(), W.offers[0].id, { action: 'view' })
ck('the caregiver\'s link shows "Dorothy has cats" and the family\'s note', pg.status === 200 && pg.body.home?.[0] === 'Dorothy has cats' && pg.body.note === 'She loves cards', pg.body)
W.bookings[0].note_hidden = true
ck('a note the office took out ("Approve without the note") is not shown', (await fo.offerPage(deps(), W.offers[0].id, { action: 'view' })).body.note === null)

world({ ok: false, why: 'rules file not approved: match-rules.js' })
o = await fo.runOffers(deps())
ck('rulebook unreadable: nobody is texted (fail closed)', W.texts.length === 0 && o.skipped.some((s) => /matching rules unavailable/.test(s.why)), o)
ck('...and the request is NOT treated as "everyone asked" (it carries on next run)', !W.bookings[0].offer_stage && W.bookings[0].status === 'waiting_for_caregiver', W.bookings[0])
ck('...and one office card says offers are paused (no silent failure)', W.items.length === 1 && W.items[0].id === `fam_match_${uuid(1)}` && /offers paused/i.test(W.items[0].title), W.items)
W.match = judgeBy({}); o = await fo.runOffers(deps())
ck('rulebook back: offers go out and the card closes', W.texts.length === 3 && W.items[0].status === 'done', { texts: W.texts.length, items: W.items })
world({ ok: false, why: 'x' }); await fo.runOffers(deps(), { dry: true })
ck('dry run: no card', W.items.length === 0)
world(judgeBy({ '77': 'a', '88': 'b', '55': 'c' })); await fo.runOffers(deps())
ck('everyone ruled out: no texts, the request moves to "everyone asked" (it ends with an answer as usual)', W.texts.length === 0 && W.bookings[0].offer_stage === 'done', W.bookings[0])

const src = fs.readFileSync('supabase/functions/_shared/family-offer-db.ts', 'utf8')
ck('the server runs the rulebook only when its fingerprint is approved', /approvedRules\(db, 'match-rules\.js'\)/.test(src))
ck('only plan/current answers are read', /\.in\('layer', \['plan', 'current'\]\)/.test(src.slice(src.indexOf('const clientFacts'))))

for (const [nm, okk, note] of res) console.log((okk ? '  ✓ ' : '  ✗ ') + nm + (okk ? '' : '\n      ' + note))
const passed = res.filter((r) => r[1]).length
console.log(`\n  family matching: ${passed}/${res.length} passed`)
process.exit(passed === res.length ? 0 : 1)
