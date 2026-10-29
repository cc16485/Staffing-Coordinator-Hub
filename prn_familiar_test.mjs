// PRN STEP 3 (Samantha 2026-10-28): familiar clients, the go-back question and the "no PRN backup" line. The rules only
// (_shared/prn-familiar.ts); nothing real is reached. node prn_familiar_test.mjs
import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)])
const P = await import(path.join(process.cwd(), 'supabase/functions/_shared/prn-familiar.ts'))
const W = await import(path.join(process.cwd(), 'supabase/functions/_shared/prn-week.ts'))
const TODAY = '2026-10-28'

/* her wording */
ck('the go-back text is her approved wording, "yesterday" for yesterday\'s shift',
  P.goBackText(null, 'Tasha', 'Mary', '2026-10-27', TODAY) === 'Good morning, Tasha! Thank you for being with Mary yesterday. Would you be glad to go back to Mary another time? Just reply YES or NO. Either answer is perfectly fine.')
ck('a shift two days back says the weekday', /with Mary on Monday\./.test(P.goBackText(null, 'Tasha', 'Mary', '2026-10-26', TODAY)))
ck('no em dash in the wording', !/—/.test(P.GOBACK_DEFAULT))

/* reading the answer */
for (const [t, want] of [['YES', 'yes'], ['Yes!', 'yes'], ['yeah', 'yes'], ['Absolutely', 'yes'], ['yes ma\'am', 'yes'], ['No', 'no'], ['no thank you', 'no'], ['Nope.', 'no'],
  ['Yes but only mornings', null], ['not sure', null], ['she was great, yes I would love to go back if the hours work', null], ['', null], ['no I mean yes', null]])
  ck(`"${t}" reads as ${want ?? 'unclear (the office reads it)'}`, P.readGoBack(t) === want, P.readGoBack(t))

/* familiar clients */
const V = (first, last, d, id) => ({ client: { firstName: first, lastName: last, id }, caregiver: { id: '9' }, date: d })
const visits = [V('Mary', 'Smith', '2026-08-10', 1), V('Mary', 'Smith', '2026-10-01', 1), V('Ruth', 'Lee', '2026-03-01', 2), V('Joan', 'Fox', '2026-09-01', 3), V('Ann', 'Bell', '2026-10-20', 4), V('Lou', 'Day', '2026-10-21', 5)]
const f = P.familiarClients({ name: 'Tasha Brown', visits, today: TODAY,
  dnr: [{ client: 'Joan Fox', caregiver: 'Tasha Brown' }],
  checkins: [{ client: 'Ann Bell', caregiver: 'Tasha Brown', rating: 'concern' }, { client: 'Mary Smith', caregiver: 'Tasha Brown', want_favorite: true }],
  answers: [{ kind: 'goback_no', ref: 'client:louday', at: '2026-10-22' }] })
ck('Mary (cared for in the last 6 months, a favorite): familiar with a star, 2 visits, last Oct 1', f.length === 1 && f[0].client === 'Mary Smith' && f[0].star && f[0].visits === 2 && f[0].last === '2026-10-01', f)
ck('Ruth (last visit over 6 months ago): not familiar', !f.some((x) => x.client === 'Ruth Lee'))
ck('Joan (Do Not Return): not familiar', !f.some((x) => x.client === 'Joan Fox'))
ck('Ann (a concern on the check-in): not familiar', !f.some((x) => x.client === 'Ann Bell'))
ck('Lou (they said NO to going back): not familiar', !f.some((x) => x.client === 'Lou Day'))
const g = P.familiarClients({ name: 'Tasha Brown', visits: [V('Lou', 'Day', '2026-10-21', 5)], today: TODAY, dnr: [], checkins: [], answers: [{ kind: 'goback_no', ref: 'client:louday', at: '2026-10-22' }, { kind: 'goback_yes', ref: 'client:louday', at: '2026-10-23' }] })
ck('a later YES (the office marked it) wins: Lou is familiar and "glad to go back"', g.length === 1 && g[0].glad, g)

/* no PRN backup: 3+ call-offs in 30 days (her pick) */
const C = (client, d, o = {}) => ({ client, shift_date: d, status: 'closed', ...o })
const cases = [C('Mary Smith', '2026-10-01'), C('Mary Smith', '2026-10-10'), C('Mary Smith', '2026-10-20'),
  C('Ruth Lee', '2026-10-02'), C('Ruth Lee', '2026-10-03'), C('Ruth Lee', '2026-10-04'), C('Ruth Lee', '2026-10-05'),
  C('June Kay', '2026-10-02'), C('June Kay', '2026-10-03'), C('June Kay', '2026-09-01'),
  C('Bea Ott', '2026-10-02'), C('Bea Ott', '2026-10-03'), C('Bea Ott', '2026-10-04', { not_a_callin: true })]
const nb = P.noBackup(cases, [f], TODAY)
ck('Ruth (4 call-offs, no PRN member knows her): flagged', nb.length === 1 && nb[0].client === 'Ruth Lee' && nb[0].calloffs === 4, nb)
ck('Mary (3 call-offs, but Tasha knows her): not flagged', !nb.some((x) => x.client === 'Mary Smith'))
ck('June (only 2 in the last 30 days) and Bea (one was not a call-in): not flagged', !nb.some((x) => /June|Bea/.test(x.client)))

/* the This Week lines */
const mem = [{ applicant_id: 'a', name: 'Tasha Brown', first: 'Tasha', team: 'PRN CNA Team' }]
const asked = { applicant_id: 'a', kind: 'goback_asked', ref: 'client:marysmith', at: '2026-10-27T15:00:00Z', message: P.goBackText(null, 'Tasha', 'Mary', '2026-10-26', TODAY) }
let lines = P.weekLines({ members: mem, touches: [asked, { applicant_id: 'a', kind: 'goback_unclear', ref: 'client:marysmith', note: 'Yes but only mornings', at: '2026-10-27T16:00:00Z' }], nobackup: nb, clientMarks: [], today: TODAY })
const gl = lines.find((x) => x.kind === 'goback'), nl = lines.find((x) => x.kind === 'nobackup')
ck('an unclear answer: a line for the office, with their words', gl && gl.title === 'Would Tasha be glad to go back to Mary?' && gl.detail === 'They answered: "Yes but only mornings"', gl)
ck('Ruth: "Ruth Lee has no PRN backup who knows them yet", the intro visit only with the family\'s OK', nl && nl.title === 'Ruth Lee has no PRN backup who knows them yet' && /4 call-offs in 30 days\. An intro visit could help, only with the family's OK\./.test(nl.detail) && nl.ref === 'nobackup:ruthlee:2026-10', nl)
lines = P.weekLines({ members: mem, touches: [asked, { applicant_id: 'a', kind: 'goback_unclear', ref: 'client:marysmith', note: 'x' }, { applicant_id: 'a', kind: 'goback_yes', ref: 'client:marysmith' }], nobackup: nb, clientMarks: [{ id: 'nobackup:ruthlee:2026-10', kind: 'intro_planned' }], today: TODAY })
ck('marked by the office, and an intro visit planned this month: both lines are gone', !lines.length, lines)
ck('...the no-backup line comes back next month if Ruth still has nobody', P.weekLines({ members: mem, touches: [], nobackup: nb, clientMarks: [{ id: 'nobackup:ruthlee:2026-10', kind: 'intro_planned' }], today: '2026-11-03' }).length === 1)

/* waiting question */
const now = new Date('2026-10-28T15:00:00Z')
ck('asked yesterday, no answer yet: the reply is read as the answer', P.waitingQuestion([asked], now)?.ref === 'client:marysmith')
ck('asked 4 days ago: too old, the reply is not taken as an answer', !P.waitingQuestion([{ ...asked, at: '2026-10-24T10:00:00Z' }], now))
ck('already answered: not waiting', !P.waitingQuestion([asked, { applicant_id: 'a', kind: 'goback_yes', ref: 'client:marysmith' }], now))

/* the This Week list: the new lines sit after thank-yous; the automatic go-back text is not personal contact */
const M = { applicant_id: 'a', name: 'Tasha Brown', first: 'Tasha', team: 'cna', since: '2026-09-01', axiscare_id: '9' }
const wk = W.computeWeek({ members: [M], shifts: [], touches: [asked], kindTo: {}, wantsMore: {}, cases: {}, today: TODAY, sender: 'Krystal', extra: [gl, nl] })
ck('go-back and no-backup lines are on the list, before check-ins', wk.items[0].kind === 'goback' && wk.items[1].kind === 'nobackup' && wk.items.some((x) => x.kind === 'checkin'), wk.items.map((x) => x.kind))

const bad = res.filter((r) => !r[1])
for (const [n, okk, note] of res) console.log((okk ? '  ✓ ' : '  ✗ FAIL ') + n + (okk ? '' : '\n      ' + note))
console.log(`\n${res.length - bad.length}/${res.length}`)
process.exit(bad.length ? 1 : 0)
