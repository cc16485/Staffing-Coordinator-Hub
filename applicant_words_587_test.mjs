// 587 · The exact applicant words (what she approves is what sends) and how a reply to the reminder is read.
//   node applicant_words_587_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)])
const W = await import(path.resolve('supabase/functions/_shared/applicant-words.ts'))
const c = (o = {}) => ({ first: 'Maria', link: 'https://mo-care.com/apply?book=abc', krystalNamed: false, mins: 20, phone: '(417) 234-8494',
  place: '1331 N Stewart Ave, Suite B, Springfield, MO 65802', note: 'Park out front; it is the first-floor door on the left', mapUrl: 'https://maps.google.com/?q=x', photoUrl: null, ...o })
const T = W.texts
// exact wording (the approved text, with the office's own address and door note from the interview settings)
ck('first invite, exact', T.invite1(c()) === "Hi Maria, it's the Caring Companions Team. Thank you for applying! We'd love to meet you for a relaxed 20-minute interview at our office. Pick a time that works for you: https://mo-care.com/apply?book=abc Reply STOP to opt out.", T.invite1(c()))
ck('first invite once Krystal agrees', T.invite1(c({ krystalNamed: true })).startsWith("Hi Maria, it's Krystal at Caring Companions. Thank you for applying!"))
ck('check-in, exact', T.invite2(c()) === "Hi Maria, the Caring Companions Team again. We'd really like to meet you! Grab any open interview time here: https://mo-care.com/apply?book=abc or text us back and we'll find one together. Reply STOP to opt out.", T.invite2(c()))
ck('day 3, exact', T.invite3(c()) === "Hi Maria, if this week got busy, no worries. Interviews take about 20 minutes, Monday to Friday. Here's your link whenever you're ready: https://mo-care.com/apply?book=abc Reply STOP to opt out.")
ck('last note, exact', T.invite4(c()) === "Hi Maria, this is our last note so we don't crowd your phone. If the timing is better later, your link still works: https://mo-care.com/apply?book=abc Or call us at (417) 234-8494. We'd be glad to hear from you. Reply STOP to opt out.")
ck('finish 1, exact', T.finish1(c()) === "Hi Maria, it's the Caring Companions Team. It looks like your application didn't get finished. You're about a minute from done, and your answers so far are saved: https://mo-care.com/apply?book=abc Reply STOP to opt out.")
ck('finish 2, exact', T.finish2(c()) === "Hi Maria, just a reminder that your Caring Companions application is almost done. Finish it here and you can pick your interview time right after: https://mo-care.com/apply?book=abc Reply STOP to opt out.")
ck('confirmation (days ahead), exact', T.confirm(c(), 'Samantha', 'Thursday, October 16', '10:30 AM', false) === "You're booked, Maria! Your interview with Samantha is Thursday, October 16 at 10:30 AM at our office, 1331 N Stewart Ave, Suite B, Springfield, MO 65802. Park out front; it is the first-floor door on the left. Need a different time? https://mo-care.com/apply?book=abc Reply STOP to opt out.", T.confirm(c(), 'Samantha', 'Thursday, October 16', '10:30 AM', false))
ck('confirmation for tomorrow asks YES / NO', /Reply YES so we know you're coming, or NO if you can't make it and we'll free up the time\. Need a different time\?/.test(T.confirm(c(), 'our team', 'Friday', '9:00 AM', true)))
ck('day before asks YES / NO', T.dayBefore(c(), '10:30 AM') === "Hi Maria, see you tomorrow at 10:30 AM! We're at 1331 N Stewart Ave, Suite B, Springfield, MO 65802. Park out front; it is the first-floor door on the left. Reply YES so we know you're coming, or NO if you can't make it and we'll free up the time. Want a different time instead? https://mo-care.com/apply?book=abc Reply STOP to opt out.")
ck('two days before, exact', T.twoDays(c(), 'Thursday', '10:30 AM') === "Hi Maria, we're looking forward to meeting you Thursday at 10:30 AM! If anything comes up, you can move it here: https://mo-care.com/apply?book=abc Reply STOP to opt out.")
ck('hour before mentions the photo only when there is one', !/Photo/.test(T.hour(c(), '10:30 AM')) && /\(Photo above\.\)/.test(T.hour(c({ photoUrl: 'https://x/door.jpg' }), '10:30 AM')))
ck('cancelled offers a new time', /pick one here: https:\/\/mo-care\.com\/apply\?book=abc/.test(T.cancelled(c(), 'Thursday, October 16', '10:30 AM')))
ck('goodbye does not push to rebook (no link)', !/book=/.test(T.goodbye(c())) && /always welcome to apply again/.test(T.goodbye(c())))
ck('goodbye only for found another job / not interested', W.isGoodbye('found_job') && W.isGoodbye('not_interested') && !W.isGoodbye('schedule') && !W.isGoodbye('replied_no') && !W.isGoodbye(null))
// her rules on every text and email
const all = Object.entries(T).map(([k, f]) => [k, f(c({ photoUrl: 'https://x/door.jpg' }), 'our team', 'Thursday, October 16', '10:30 AM', true)])
ck('every text ends with the STOP line', all.every(([, t]) => t.endsWith('Reply STOP to opt out.')), all.filter(([, t]) => !t.endsWith('Reply STOP to opt out.')))
ck('no em dash anywhere (texts and the words file)', !all.some(([, t]) => t.includes('—')) && !fs.readFileSync('supabase/functions/_shared/applicant-words.ts', 'utf8').includes('—'))
ck('nothing says "we will not call" / "not a phone interview" (her rule 2026-10-11)', !/not (be )?call|phone interview|won't be calling/i.test(all.map(([, t]) => t).join(' ') + fs.readFileSync('supabase/functions/_shared/applicant-words.ts', 'utf8')))
ck('no IN-PERSON shouting', !/IN-PERSON/.test(all.map(([, t]) => t).join(' ')))
ck('interviewer: Samantha by name; Krystal only once she agrees; nobody known = our team',
  W.interviewerLabel('Samantha Troutman', false) === 'Samantha' && W.interviewerLabel('Krystal X', false) === 'our team' && W.interviewerLabel('Krystal X', true) === 'Krystal' && W.interviewerLabel(null, true) === 'our team')
const E = W.emails
const mails = [E.finish(c(), false), E.finish(c(), true), E.invite(c(), 1), E.invite(c(), 1, true), E.invite(c(), 2), E.invite(c(), 3), E.invite(c(), 4), E.confirm(c(), 'Samantha', 'Thursday', '10:30 AM'),
  E.twoDays(c(), 'Thursday', '10:30 AM'), E.dayBefore(c(), 'Thursday', '10:30 AM'), E.hour(c(), '10:30 AM'), E.cancelled(c(), 'Thursday', '10:30 AM'), E.goodbye(c())]
ck('every email has the logo, a subject and no em dash', mails.every((m) => m.subject && m.html.includes('email-assets/cc-logo.png') && !m.html.includes('—') && !m.subject.includes('—')))
ck('the first invite email has the button, what to expect and where to come', /Pick my interview time/.test(E.invite(c(), 1).html) && /What to expect/.test(E.invite(c(), 1).html) && /Where to come/.test(E.invite(c(), 1).html) && /nothing to fill out/.test(E.invite(c(), 1).html))
ck('the confirmation email names the interviewer', /Your interview with <b>Samantha<\/b>/.test(E.confirm(c(), 'Samantha', 'Thursday', '10:30 AM').html))
ck('the goodbye email has no rebook button', !/book=/.test(E.goodbye(c()).html))
ck('names are escaped in emails', !E.invite(c({ first: '<b>x</b>' }), 2).html.includes('<b>x</b>'))

// how a reply is read: only an unmistakable NO cancels
const src = fs.readFileSync('supabase/functions/interview-reply/index.ts', 'utf8')
const fnSrc = fs.readFileSync('supabase/functions/_shared/reply-classify.ts', 'utf8').replace(/^\/\*\*[\s\S]*?\*\/\n/, '')
const classify = new Function(fnSrc.replace('export function classify(message: string): \'no\' | \'yes\' | \'other\'', 'return function classify(message)').replace(/: 'no' \| 'yes' \| 'other'/g, ''))()
const cases = {
  no: ['No', 'no.', 'NO', 'Nope', 'nah', 'No sorry', 'Sorry no', "I can't make it", "I can't make it tomorrow, sorry", 'cannot make it', "No I can't make it", "won't be able to make it".replace("won't be able to make it", "I won't make it"),
       "I'm not coming", 'Not coming tomorrow', "Actually I can't make it", "Sorry, I'm not coming", 'Need to cancel', 'please cancel', 'Cancel', 'I have to cancel my interview', "Unfortunately I can't come"],
  yes: ['Yes', 'yes!', 'Y', 'Yep', 'Okay', 'ok thanks', "I'll be there", 'Yes see you tomorrow', 'confirmed'],
  other: ['No problem, see you then', 'no worries see you tomorrow', "I'm running late", 'Can I move it?', "can't make it, can I reschedule?", 'Can we do another time',
          'Who is this', 'yes but I might be late', 'no, but can I come at 2 instead', '', 'Maybe', 'What do I bring?', 'Yes no', '👍'],
}
for (const [want, list] of Object.entries(cases)) for (const m of list) ck(`reply "${m}" reads as ${want}`, classify(m) === want, classify(m))

let pass = 0; for (const [nm, ok, note] of res) { console.log((ok ? 'PASS  ' : 'FAIL  ') + nm + (ok ? '' : '  ' + note)); if (ok) pass++ }
console.log(pass === res.length ? `ALL ${res.length} CHECKS PASS` : `${res.length - pass} OF ${res.length} FAILED`); process.exit(pass === res.length ? 0 : 1)
