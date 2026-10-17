// Release 3 note rules, AI second opinion and office-hours math (_shared/family-review.ts), under Node. Nothing real is touched.
//   node family_review_test.mjs
import path from 'path'
import { pathToFileURL } from 'url'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 600)])
const r = await import(pathToFileURL(path.resolve('supabase/functions/_shared/family-review.ts')).href)
const H = (t) => r.checkNote(t).hold
ck('personal care is held', ['Please help her shower', 'give mom a bath', 'she needs toileting help', 'change her depends', 'get him dressed please', 'help her get dressed'].every((t) => /personal care/.test(H(t))), ['x'].map(H))
ck('medical care is held', ['give her her meds at noon', 'check his blood sugar', 'her insulin shot', 'wound dressing change', 'catheter bag'].every((t) => /medical/.test(H(t))))
ck('lifting and transfers are held', ['help him out of bed', 'she needs a transfer to the chair', 'lift her into the car'].every((t) => /lifting/.test(H(t))))
ck('overnight and her own car are held', /overnight/.test(H('can you stay the night')) && /own car/.test(H('please use her car for errands')))
ck('ordinary companion notes pass', ['Cards and a short walk', 'Make her lunch, she likes soup', 'Errands at Walmart, she will have her list', 'Help her address birthday cards', 'She likes dressing up for church', 'Remind her to take her pills at noon'].every((t) => H(t) === null),
  ['Cards and a short walk', 'Help her address birthday cards', 'She likes dressing up for church', 'Remind her to take her pills at noon'].map(H))
ck('emergency words: held and flagged', r.checkNote('She fell this morning').emergency && H('She fell this morning') && r.checkNote('chest pain since lunch').emergency)
ck('an empty note is fine', H('') === null && !r.checkNote(null).emergency)
const fake = (reply, ok = true, ms = 0) => async (_u, init) => { if (ms) await new Promise((res2, rej) => { const t = setTimeout(res2, ms); init.signal.addEventListener('abort', () => { clearTimeout(t); rej(new Error('aborted')) }) }); return { ok, json: async () => ({ content: [{ text: reply }] }) } }
ck('AI: fine', (await r.reviewNote('cards', [], 'k', fake('{"verdict":"fine","why":""}')))?.verdict === 'fine')
ck('AI: a concern, with its reason', (await r.reviewNote('she wanders at night', [], 'k', fake('{"verdict":"concern","why":"Wandering at night"}')))?.why === 'Wandering at night')
ck('AI: an answer it can\'t sort counts as unsure (held)', (await r.reviewNote('x', [], 'k', fake('{"verdict":"maybe"}')))?.verdict === 'unsure')
ck('AI: an error means unavailable (the rules decide)', (await r.reviewNote('x', [], 'k', fake('', false))) === null && (await r.reviewNote('x', [], '', fake('{}'))) === null)
ck('AI: slower than the limit means unavailable', (await r.reviewNote('x', [], 'k', fake('{"verdict":"fine"}', true, 200), 50)) === null)
ck('AI uses the latest fast model and a 20-second limit', r.AI_MODEL === 'claude-haiku-5-5' && r.AI_TIMEOUT_MS === 20000)
const d = (iso) => new Date(iso)
ck('handoff: one office day before (Wed 6 PM answer-by: Tue 6 PM)', r.handoffAt(d('2026-10-21T23:00:00Z')).toISOString() === '2026-10-20T23:00:00.000Z')
ck('handoff skips the weekend (Mon 6 PM answer-by: Fri 6 PM)', r.handoffAt(d('2026-10-26T23:00:00Z')).toISOString() === '2026-10-23T23:00:00.000Z')
ck('office hours: Monday to Friday 8 to 6 only', r.officeHours(d('2026-10-23T13:00:00Z'), d('2026-10-26T23:00:00Z')) === 20 && !r.inOffice(d('2026-10-24T15:00:00Z')) && r.inOffice(d('2026-10-20T14:00:00Z')))
ck('the flag lasts until its review date', r.helpFillOn({ on: true, review_by: '2026-10-20' }, '2026-10-20') && !r.helpFillOn({ on: true, review_by: '2026-10-19' }, '2026-10-20') && !r.helpFillOn({ on: false, review_by: '2027-01-01' }, '2026-10-20'))
ck('no em dashes in the family words', !/—/.test([r.MSG_FAMILY_DECLINED, r.MSG_FAMILY_COULDNT, r.HELP_ADD, r.HELP_LATE, r.HELD_WORDS('x'), r.EMERGENCY_WORDS('x')].join(' ')))
for (const [n, ok, note] of res) console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note))
const bad = res.filter((x) => !x[1]).length
console.log(`\n  family review: ${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0)
