// open-hours: the wording, the squares, the send window and the reply reader (AI faked; the real prompt rules are
// enforced by settle()). node open_hours_test.mjs
import * as O from './supabase/functions/_shared/open-hours.ts'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 500)])
const slots = [{ k: 'am', start: '08:00', end: '12:00' }, { k: 'pm', start: '12:00', end: '17:00' }]
const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat']
ck('Mon to Sat reads as a run', O.daysWords(days) === 'Monday to Saturday', O.daysWords(days))
ck('Mon, Wed, Fri reads as a list', O.daysWords(['fri', 'mon', 'wed']) === 'Monday, Wednesday and Friday')
ck('the two halves read naturally', O.timesWords(slots) === '8am to noon and noon to 5pm', O.timesWords(slots))
const t = O.openHoursText('', { town: 'Nixa', days, slots })
ck('her text: town, days, both halves, no client, no pay, no em dash, only {first_name} left',
  t === "Hi {first_name}, it's Caring Companions. We have regular hours open in Nixa: Monday to Saturday, 8am to noon and noon to 5pm. You can take some of the days, or just some of the hours. Interested? Reply with the days and times that work for you, or NO if not. Questions welcome."
  && !/\$|pay|client|—/.test(t) && O.checkWording(t) === null, t)
ck('one shift: "some of the days"', /You can take some of the days\. Interested/.test(O.openHoursText('', { town: 'Ozark', days: ['mon'], slots: [slots[0]] })))
ck('wording check: em dash, leftover blank, too long, empty', O.checkWording('Hi — there') && O.checkWording('Hi {town}') && O.checkWording('x'.repeat(601)) && O.checkWording(' '))
const cells = O.offeredCells(days, slots)
ck('12 squares offered, keyed like the plan (day|slot)', cells.length === 12 && cells[0].key === 'mon|am' && cells[0].words === 'Monday 8am to noon' && cells[11].key === 'sat|pm', cells.slice(0, 2))
const at = (h) => new Date(Date.UTC(2026, 9, 13, h + 5, 0))   // Central = UTC-5 in October
ck('send window: 9am yes, 5:59pm yes, 6pm no, 8:59am no', O.inSendWindow(at(9)) && O.inSendWindow(new Date(Date.UTC(2026, 9, 13, 22, 59))) && !O.inSendWindow(at(18)) && !O.inSendWindow(new Date(Date.UTC(2026, 9, 13, 13, 59))))
/* settle: the AI's answer made safe */
const S = (raw, said) => O.settle(raw, said, cells)
let r = S({ answer: 'yes', cells: ['mon|am', 'wed|am', 'wed|pm', 'sun|am', 'bogus'], sure: true, quote: 'Mondays mornings and all day Wednesday' }, 'I can do Mondays mornings and all day Wednesday')
ck('green with the squares they named; squares not offered are dropped; quote kept', r.answer === 'yes' && r.cells.join() === 'mon|am,wed|am,wed|pm' && r.quote === 'Mondays mornings and all day Wednesday', r)
r = S({ answer: 'yes', any: true, cells: [], sure: true, quote: 'Yes' }, 'Yes!')
ck('a plain yes = any of it, every square', r.answer === 'yes' && r.any && r.cells.length === 12, r)
r = S({ answer: 'yes', cells: ['mon|am'], sure: true, quote: 'yes mornings' }, 'yes mornings, where in Nixa?')
ck('a question mark is yellow even next to a yes, and the days they named are kept', r.answer === 'question' && r.cells.join() === 'mon|am' && r.why === 'they asked something', r)
r = S({ answer: 'no', cells: ['mon|am'], sure: true, quote: 'no thank you' }, 'No thank you')
ck('red: no squares', r.answer === 'no' && !r.cells.length, r)
r = S({ answer: 'yes', cells: ['mon|am'], sure: false, quote: 'maybe' }, 'maybe mondays')
ck('the AI unsure = yellow for a person', r.answer === 'question' && r.why === 'the AI was not sure', r)
r = S({ answer: 'yes', cells: [], sure: true, quote: 'they said yes to everything' }, 'yes')
ck('a quote the caregiver never wrote is dropped (the AI never puts words in a mouth)', r.quote === null, r)
r = S({ answer: 'maybe' }, 'hmm'); ck('an unknown answer = yellow', r.answer === 'question')
/* the AI call itself (faked fetch) */
globalThis.Deno = { env: { get: (k) => k === 'ANTHROPIC_API_KEY' ? 'k' : '' } }
let sentBody = null
const fakeAI = (out, ok = true) => async (_u, o) => { sentBody = JSON.parse(o.body); return new Response(JSON.stringify({ content: [{ text: out }] }), { status: ok ? 200 : 500 }) }
r = await O.readOpenHoursReply('I can do Tuesdays and Thursdays all day but not Saturday', cells, fakeAI('{"answer":"yes","cells":["tue|am","tue|pm","thu|am","thu|pm"],"any":false,"sure":true,"quote":"Tuesdays and Thursdays all day"}'))
ck('the AI reads days: Tue + Thu both halves', r.answer === 'yes' && r.cells.join() === 'tue|am,tue|pm,thu|am,thu|pm' && !r.failed, r)
ck('...the AI gets every offered square and the reply, with Haiku at temperature 0', sentBody.model === 'claude-haiku-4-5-20251001' && sentBody.temperature === 0 && /sat\|pm = Saturday noon to 5pm/.test(sentBody.messages[0].content) && /not Saturday/.test(sentBody.messages[0].content))
r = await O.readOpenHoursReply('yes', cells, fakeAI('', false)); ck('the AI down = failed (the caller falls back to words)', r.failed === true)
r = await O.readOpenHoursReply('yes', cells, fakeAI('not json')); ck('the AI talking instead of JSON = failed', r.failed === true)
globalThis.Deno = { env: { get: () => '' } }
r = await O.readOpenHoursReply('yes', cells, fakeAI('{}')); ck('no AI key = failed, nothing sent anywhere', r.failed === true)
/* words only */
const W = (s) => O.readByWords(s, cells)
ck('words: "Yes" = green, all of it', W('Yes').answer === 'yes' && W('Yes').cells.length === 12)
ck('words: "I can\'t, sorry" = red', W("I can't, sorry").answer === 'no')
ck('words: "Mondays work" = yellow (days need a person without the AI)', W('Mondays work').answer === 'question')
ck('words: "yes, how many hours?" = yellow', W('yes, how many hours?').answer === 'question')
ck('words: "I\'ll take any of it" = green all', W("I'll take any of it").answer === 'yes')
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
