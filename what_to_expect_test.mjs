// The automatic what-to-expect text (her approved exception 2026-10-28) against the REAL _shared/what-to-expect.ts and lead-rules.js.
//   node what_to_expect_test.mjs
import path from 'path'
import { pathToFileURL } from 'url'
import { createRequire } from 'module'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)])
const W = await import(pathToFileURL(path.resolve('supabase/functions/_shared/what-to-expect.ts')).href)
const R = createRequire(import.meta.url)('./supabase/functions/_shared/lead-rules.js')
const O = await import(pathToFileURL(path.resolve('supabase/functions/_shared/outreach.ts')).href)
const SINCE = '2026-10-28T00:00:00Z'
const lead = (id, v = {}) => ({ id, first_name: 'Linda', last_name: 'Ray', client_first_name: 'Dorothy', phone: '4175550123', status: 'Contacted',
  created_at: '2026-10-28T15:00:00Z', filled_from_calls_at: '2026-10-28T15:00:05Z', filled_from_calls_by: 'Krystal Land',
  from_calls: [{ message_id: 'm' + id }], first_human_contact_at: '2026-10-28T14:50:00Z', ...v })
let NOW, S
function world(leads, st = {}, sendResult = () => ({ ok: true })) {
  S = { leads, st: { what_to_expect_text_approved: { by: 'samantha', at: '2026-10-28' }, what_to_expect_text_live: true, what_to_expect_text_live_since: SINCE, ...st },
    ledger: [], marks: [], texts: [], items: [], sendResult }
}
const deps = () => ({ now: () => NOW, settings: async () => S.st, leads: async () => S.leads.map((l) => ({ ...l })), sends: async () => S.ledger.map((x) => ({ ...x })),
  saveSend: async (it) => { const i = S.ledger.findIndex((x) => x.id === it.id); if (i >= 0) S.ledger[i] = it; else S.ledger.push(it) },
  markLead: async (id, vals, sent) => { S.marks.push({ id, vals, sent }); Object.assign(S.leads.find((l) => String(l.id) === id), vals) },
  send: async (l, text) => { S.texts.push({ id: l.id, text }); return S.sendResult(l) },
  officeItem: async (it) => { S.items.push(it) }, rules: R })
const run = (o) => W.whatToExpect(deps(), o)

NOW = new Date('2026-10-28T15:10:00Z')   // Wed 10:10 AM Central
world([lead(1)]); let r = await run()
ck('a lead made from a call we talked on: ONE text, her safer words with Linda, Krystal, Dorothy and the link', S.texts.length === 1
  && S.texts[0].text.startsWith('Hi Linda! This is Krystal with Caring Companions. Thank you for talking with us about care for Dorothy!')
  && S.texts[0].text.includes('mo-care.com/what-to-expect') && !/today|speaking with you|—/.test(S.texts[0].text), S.texts)
ck('...the ledger says sent and the lead is stamped automatic, with a timeline line', S.ledger[0].status === 'sent' && S.leads[0].what_to_expect_sent_by === 'automatic' && S.marks[0].sent && r.sent === 1)
await run(); ck('once per lead: the next run sends nothing', S.texts.length === 1)
S.leads[0].what_to_expect_sent_at = undefined; await run()
ck('...even if a Hub page saved an older copy of the lead without the stamp (the ledger is the truth)', S.texts.length === 1)

world([lead(2, { first_name: '', client_first_name: '', filled_from_calls_by: 'krystal@mo-care.com' })]); await run()
ck('no names known: "Hi there!", "your Care Coordinator", "your loved one" (never a wrong or empty name)', /^Hi there! This is your Care Coordinator with Caring Companions\. Thank you for talking with us about care for your loved one!/.test(S.texts[0]?.text), S.texts)

const skip = [['a call added to an OLDER lead', { created_at: '2026-10-28T13:00:00Z' }], ['no conversation (voicemail only)', { first_human_contact_at: null }],
  ['made before the switch went on', { created_at: '2026-10-27T20:00:00Z', filled_from_calls_at: '2026-10-27T20:00:05Z' }], ['no phone', { phone: '' }],
  ['do not contact', { do_not_contact: true }], ['opted out earlier', { auto_msgs_stopped_at: '2026-10-28T15:01:00Z' }], ['already said yes', { said_yes_at: '2026-10-28T15:02:00Z' }],
  ['Lost', { status: 'Lost' }], ['a coordinator already sent it with the button', { what_to_expect_sent_at: '2026-10-28T15:03:00Z' }], ['a typed-in lead (not from a call)', { from_calls: [] }]]
for (const [n, v] of skip) { world([lead(3, v)]); await run(); ck('never texted: ' + n, S.texts.length === 0, S.texts) }

NOW = new Date('2026-10-29T02:30:00Z')   // Wed 9:30 PM Central
world([lead(4, { created_at: '2026-10-29T02:20:00Z', filled_from_calls_at: '2026-10-29T02:20:05Z' })]); r = await run()
ck('a lead made at 9:20 PM: held, no text, no card', S.texts.length === 0 && r.held === 1 && !S.items.length, r)
NOW = new Date('2026-10-29T11:59:00Z'); await run(); ck('...6:59 AM: still held', S.texts.length === 0)
NOW = new Date('2026-10-29T12:00:00Z'); await run(); ck('...7:00 AM: it goes', S.texts.length === 1)
NOW = new Date('2026-10-29T00:59:00Z'); world([lead(5, { created_at: '2026-10-28T23:00:00Z', filled_from_calls_at: '2026-10-28T23:00:05Z' })]); await run()
ck('7:59 PM: goes; 8:00 PM: held', S.texts.length === 1)
NOW = new Date('2026-10-29T01:00:00Z'); world([lead(6, { created_at: '2026-10-28T23:00:00Z', filled_from_calls_at: '2026-10-28T23:00:05Z' })]); await run()
ck('...8:00 PM held', S.texts.length === 0)

NOW = new Date('2026-10-28T15:10:00Z')
world([lead(7)], { what_to_expect_text_live: false }); r = await run()
ck('practice (switch off): lists the text it would send, sends nothing', S.texts.length === 0 && r.would.length === 1 && r.would[0].text.includes('what-to-expect'), r)
world([lead(8)], { what_to_expect_text_approved: null }); r = await run()
ck('no approval on record: off, nothing', S.texts.length === 0 && r.off, r)
world([lead(9)]); r = await run({ dry: true }); ck('dry run: nothing sent', S.texts.length === 0 && r.would.length === 1)

world([lead(10)], {}, () => ({ ok: false, optedOut: true, why: 'GoHighLevel Do Not Disturb' })); await run()
ck('opted out: stops for good, stamped on the lead, no card', S.ledger[0].status === 'opted_out' && S.leads[0].auto_msgs_stopped_at && !S.items.length)
await run(); ck('...and is never tried again', S.texts.length === 1)

world([lead(11)], {}, () => ({ ok: false, why: 'error 500' })); await run()
ck('a failed send: retry noted, no extra card from here (the send door raised its own)', S.ledger[0].status === 'retry' && S.ledger[0].tries === 1 && !S.items.length)
NOW = new Date('2026-10-28T15:20:00Z'); await run(); ck('...10 minutes later: waits', S.texts.length === 1)
NOW = new Date('2026-10-28T15:26:00Z'); await run(); NOW = new Date('2026-10-28T15:42:00Z'); await run()
ck('...third failure: gives up with ONE office card saying what to do', S.ledger[0].status === 'gave_up' && S.items.length === 1 && /Text Linda what to expect/.test(S.items[0].detail) && S.items[0].domain === 'family_enquiries', S.items)
NOW = new Date('2026-10-28T16:30:00Z'); await run(); ck('...and stops', S.texts.length === 3)

/* the door: her hours for this class */
const at = (iso) => O.maySend('after_call_external', new Date(iso)).allowed
ck('outreach class after_call_external: 7:00 AM yes, 6:59 no, 7:59 PM yes, 8:00 PM no, Saturday yes', at('2026-10-28T12:00:00Z') && !at('2026-10-28T11:59:00Z') && at('2026-10-29T00:59:00Z') && !at('2026-10-29T01:00:00Z') && at('2026-10-31T15:00:00Z'))
ck('registered sender, the family gate unchanged (a lead is still never texted without her approval)', O.SENDER_REGISTER['what-to-expect']?.class === 'after_call_external' && O.AUDIENCE_AUTONOMY.lead === false
  && O.audienceGate('lead', {}).allowed === false && O.audienceGate('lead', { explicitlyEnabled: true }).allowed === true)

for (const [n, ok, note] of res) console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (ok ? '' : '  ' + note))
const f = res.filter((x) => !x[1]).length; console.log(`${res.length - f} passed, ${f} failed`); process.exit(f ? 1 : 0)
