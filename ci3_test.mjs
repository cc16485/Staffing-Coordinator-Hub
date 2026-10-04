// CI3 · reminders until someone has the call-in: the rule (_shared/callin-reminder.ts) and how coverage-run uses it.
// node ci3_test.mjs
import fs from 'fs'; import path from 'path';
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? '').slice(0, 600)])
globalThis.Deno = { env: { get: () => '' } }
const R = await import(path.join(FN, '_shared/callin-reminder.ts'))
const T0 = Date.parse('2026-10-07T15:00:00Z')            // 10:00am Central (CDT)
const at = (min) => new Date(T0 + min * 60e3)
const kase = (x = {}) => ({ id: 'k1', status: 'open', admin_alerted: new Date(T0).toISOString(), asked: [{ state: 'yes' }, { state: 'waiting' }], ...x })
const ON = { callin_reminders_live: true }, P = (x = {}) => ({ must: false, claimedElsewhere: false, startsInMin: 300, ...x })
let d
d = R.reminderDue(kase(), ON, P({ now: at(10) })); ck('10 min after the call-in text: not yet', !d.due && d.why === 'not yet', d)
d = R.reminderDue(kase(), ON, P({ now: at(15) })); ck('15 min after: reminder 1 of 4', d.due && d.n === 1 && d.max === 4 && d.emergency === false, d)
const sent = (k) => Array.from({ length: k }, (_, i) => ({ at: new Date(T0 + (i + 1) * 15 * 60e3).toISOString(), n: i + 1, sent: 2 }))
d = R.reminderDue(kase({ callin_reminders: sent(1) }), ON, P({ now: at(25) })); ck('10 min after reminder 1: not yet', !d.due, d)
d = R.reminderDue(kase({ callin_reminders: sent(1) }), ON, P({ now: at(30) })); ck('15 min after reminder 1: reminder 2', d.due && d.n === 2, d)
d = R.reminderDue(kase({ callin_reminders: sent(4) }), ON, P({ now: at(120) })); ck('after 4: no more', !d.due && d.why === 'all reminders sent', d)
d = R.reminderDue(kase({ claimed_by: 'k@x' }), ON, P({ now: at(60) })); ck('someone tapped "I\'ve got it": no reminders', !d.due && d.why === 'someone has it', d)
d = R.reminderDue(kase(), ON, P({ now: at(60), claimedElsewhere: true })); ck('claimed on the board: no reminders', !d.due, d)
d = R.reminderDue(kase({ status: 'done' }), ON, P({ now: at(60) })); ck('filled or closed: no reminders', !d.due, d)
d = R.reminderDue(kase({ kind: 'interest' }), ON, P({ now: at(60) })); ck('an interest check: never', !d.due, d)
d = R.reminderDue(kase({ admin_alerted: null }), ON, P({ now: at(60) })); ck('the call-in text never went: nothing to remind about', !d.due, d)
d = R.reminderDue(kase(), ON, P({ now: at(60), startsInMin: -150 })); ck('the shift started over 2 hours ago: stop', !d.due, d)
d = R.reminderDue(kase(), { ...ON, callin_reminder_every_min: 30, callin_reminder_max: 2 }, P({ now: at(20) })); ck('her settings: every 30, at most 2', !d.due, d)
d = R.reminderDue(kase(), { ...ON, callin_reminder_every_min: 30, callin_reminder_max: 2 }, P({ now: at(30) })); ck('...at 30 min: reminder 1 of 2', d.due && d.max === 2, d)
d = R.reminderDue(kase(), { ...ON, callin_reminder_every_min: 2 }, P({ now: at(15) })); ck('nonsense settings fall back to 15 / 4', d.due && d.max === 4, d)
/* night (office quiet 8pm to 7am) */
const N = Date.parse('2026-10-08T03:00:00Z')               // 10pm Central
const night = (x = {}) => ({ id: 'k1', status: 'open', admin_alerted: new Date(N - 20 * 60e3).toISOString(), asked: [], ...x })
d = R.reminderDue(night(), ON, P({ now: new Date(N), startsInMin: 600 })); ck('10pm, shift tomorrow morning: held', !d.due && /quiet hours/.test(d.why), d)
d = R.reminderDue(night(), ON, P({ now: new Date(N), must: true, startsInMin: 600 })); ck('10pm, MUST BE COVERED: sent (marked to go at night)', d.due && d.emergency === true, d)
d = R.reminderDue(night(), ON, P({ now: new Date(N), startsInMin: 90 })); ck('10pm, shift within 3 hours: sent', d.due && d.emergency === true, d)
d = R.reminderDue(night(), ON, P({ now: new Date(N), startsInMin: 90, callinAnyHour: false })); ck('...unless call-ins after hours is switched off', !d.due, d)
/* practice */
d = R.reminderDue(kase(), {}, P({ now: at(15) })); ck('switch off: still "due", for the practice record', d.due && d.n === 1, d)
d = R.reminderDue(kase({ callin_reminders: [{ at: new Date(T0 + 15 * 60e3).toISOString(), n: 1, practice: true }] }), ON, P({ now: at(16) }))
ck('turned on mid call-in: practice entries don\'t count; the first real reminder goes', d.due && d.n === 1, d)
/* the wording */
const txt = R.reminderText({ asked: [{ state: 'yes' }, { state: 'no' }, { state: 'waiting' }] }, 'Ruth Adams Wed, Oct 7 9am-1pm', { n: 2, max: 4 }, true)
ck('the text: MUST BE COVERED, which reminder, the counts, and the link', txt === 'MUST BE COVERED. Reminder 2 of 4: nobody has the call-in for Ruth Adams Wed, Oct 7 9am-1pm yet (1 said yes, 3 asked). Tap "I\'ve got it", or confirm someone: {link}' && !/—/.test(txt), txt)
/* coverage-run */
const cr = fs.readFileSync(path.join(FN, 'coverage-run/index.ts'), 'utf8')
ck('coverage-run: only the schedule\'s own run reminds (never a manual check)', /if \(\(caller === 'cron' \|\| commit\) && c\.admin_alerted && c\.kind !== 'interest' && !c\.claimed_by\)/.test(cr))
ck('coverage-run: texts only when her switch is on; otherwise a practice record on the case', /if \(liveR && ghl\.token && ghl\.locationId\)\s*\n\s*reachedR = await textCaseAdmins/.test(cr) && /\{ practice: true \}/.test(cr))
ck('coverage-run: to the admins who got the call-in text, each with their link; at night only when the rule says so', /\{ onlyAlerted: true, allIfNoneRecorded: true, emergency: dR\.emergency \}/.test(cr) && /withLink\(reminderText\(c, caseWhat\(c\), dR, mustR\), link\)/.test(cr))
ck('coverage-run: the record is saved as one field on an open case (never a whole old copy)', /coverage_case_patch', \{ p_id: String\(c\.id\), p_patch: \{ callin_reminders: list \}, p_expect: \{ status: 'open' \} \}/.test(cr))
const nt = fs.readFileSync(path.join(FN, '_shared/callin-notify.ts'), 'utf8')
ck('"Filled by" still only goes to admins who got the call-in text (the all-admins fallback is the reminders\' alone)', /opts\.onlyAlerted && !\(opts\.allIfNoneRecorded && !alerted\.size\) && !alerted\.has\(a\.email\)/.test(nt))
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '\n     ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
