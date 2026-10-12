/**
 * 587 · The words applicants get, in one place (Samantha, 2026-10-11: "make it more friendly! More inviting", then the
 * exact text approved message by message). interview-messages sends these when ops_settings.applicant_msgs_v2_live is
 * on; before that it sends the older wording, unchanged. Every text ends with the STOP line. No em dashes (her rule).
 *
 * Who signs: "the Caring Companions Team" until Krystal agrees to be named (ops_settings.applicant_msgs_krystal_named),
 * then "Krystal at Caring Companions". Confirmations name the person who will actually do the interview; Krystal only
 * once she agrees, "our team" until then.
 */
export type Ctx = {
  first: string            // their first name, or "there"
  link: string             // their own mo-care.com/apply?book=<id> link
  krystalNamed: boolean
  mins: number             // interview length we tell applicants (talk_minutes)
  phone: string            // office phone, e.g. (417) 234-8494
  place: string            // office address line(s)
  note: string             // how to find the door, from the interview settings
  mapUrl: string
  photoUrl?: string | null // entrance photo, if it is loaded
}
export const STOP = 'Reply STOP to opt out.'
const team = (c: Ctx) => c.krystalNamed ? 'Krystal at Caring Companions' : 'the Caring Companions Team'
const again = (c: Ctx) => c.krystalNamed ? 'Krystal again from Caring Companions' : 'the Caring Companions Team again'
const signoff = (c: Ctx) => c.krystalNamed ? 'Krystal, Caring Companions' : 'The Caring Companions Team'
const dot = (s: string) => { const t = String(s || '').trim(); return !t ? '' : /[.!?]$/.test(t) ? t : t + '.' }
/** The person they will meet: a first name, or "our team" (Krystal is named only once she agrees). */
export const interviewerLabel = (name: unknown, krystalNamed: boolean) => {
  const f = String(name || '').trim().split(/\s+/)[0]
  if (!f) return 'our team'
  if (/^krystal$/i.test(f) && !krystalNamed) return 'our team'
  return f
}

/* ---------------- texts ---------------- */
export const texts = {
  // Didn't finish the application (they can't book until they do)
  finish1: (c: Ctx) => `Hi ${c.first}, it's ${team(c)}. It looks like your application didn't get finished. You're about a minute from done, and your answers so far are saved: ${c.link} ${STOP}`,
  finish2: (c: Ctx) => `Hi ${c.first}, just a reminder that your Caring Companions application is almost done. Finish it here and you can pick your interview time right after: ${c.link} ${STOP}`,
  // Finished, didn't pick a time
  invite1: (c: Ctx) => `Hi ${c.first}, it's ${team(c)}. Thank you for applying! We'd love to meet you for a relaxed ${c.mins}-minute interview at our office. Pick a time that works for you: ${c.link} ${STOP}`,
  invite1Prn: (c: Ctx) => `Hi ${c.first}! Thanks for applying for Caring Companions' PRN CNA Team. Based on your Priority Application, we'd like to meet you in person. Choose an in-person interview time at our office here: ${c.link} ${STOP}`,
  invite2: (c: Ctx) => `Hi ${c.first}, ${again(c)}. We'd really like to meet you! Grab any open interview time here: ${c.link} or text us back and we'll find one together. ${STOP}`,
  invite3: (c: Ctx) => `Hi ${c.first}, if this week got busy, no worries. Interviews take about ${c.mins} minutes, Monday to Friday. Here's your link whenever you're ready: ${c.link} ${STOP}`,
  invite4: (c: Ctx) => `Hi ${c.first}, this is our last note so we don't crowd your phone. If the timing is better later, your link still works: ${c.link} Or call us at ${c.phone}. We'd be glad to hear from you. ${STOP}`,
  // Booked
  confirm: (c: Ctx, who: string, day: string, time: string, askYesNo: boolean) =>
    `You're booked, ${c.first}! Your interview with ${who} is ${day} at ${time} at our office, ${c.place}. ${dot(c.note)} ` +
    (askYesNo ? `Reply YES so we know you're coming, or NO if you can't make it and we'll free up the time. Need a different time? ${c.link} `
              : `Need a different time? ${c.link} `) + STOP,
  twoDays: (c: Ctx, weekday: string, time: string) => `Hi ${c.first}, we're looking forward to meeting you ${weekday} at ${time}! If anything comes up, you can move it here: ${c.link} ${STOP}`,
  dayBefore: (c: Ctx, time: string) => `Hi ${c.first}, see you tomorrow at ${time}! We're at ${c.place}. ${dot(c.note)} Reply YES so we know you're coming, or NO if you can't make it and we'll free up the time. Want a different time instead? ${c.link} ${STOP}`,
  hour: (c: Ctx, time: string) => `See you at ${time}, ${c.first}! ${c.place}. ${dot(c.note)}${c.photoUrl ? ' (Photo above.)' : ''} Running late? Just text us back. ${STOP}`,
  // Cancelled
  cancelled: (c: Ctx, day: string, time: string) => `Hi ${c.first}, your interview on ${day} at ${time} is cancelled, so there's nothing more you need to do. If you'd like a different time, pick one here: ${c.link} ${STOP}`,
  goodbye: (c: Ctx) => `Thanks for letting us know, ${c.first}. If things change, you're always welcome to apply again at mo-care.com/apply. We wish you all the best! ${STOP}`,
}
/** A cancellation that is a goodbye (they found another job or aren't interested): no push to rebook. */
export const isGoodbye = (kind: unknown) => kind === 'found_job' || kind === 'not_interested'
/** Texts that ask YES or NO: sending one tags their GoHighLevel contact so a reply reaches interview-reply. */
export const REPLY_TAG = 'interview-asked'

/* ---------------- emails (branded) ---------------- */
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const LOGO = 'https://mo-care.com/email-assets/cc-logo.png'
const NAVY = '#0D365F', TEAL = '#1F7A8C', HONEY = '#9C6410', CREAM = '#f2f0e9'
export function shell(c: Ctx, inner: string) {
  return `<div style="background:#faf9f6;padding:18px 0;font-family:Arial,Helvetica,sans-serif">` +
    `<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e4e1d8;border-radius:12px;overflow:hidden">` +
    `<div style="padding:16px 22px;border-bottom:3px solid ${TEAL}"><img src="${LOGO}" alt="Caring Companions In-Home Senior Care" width="150" style="display:block;height:auto;border:0"></div>` +
    `<div style="padding:20px 22px;font-size:15px;line-height:1.65;color:#1f2a36">${inner}</div>` +
    `<div style="padding:12px 22px;background:#f6f4ef;font-size:12.5px;color:#55677a">Questions? Call or text ${esc(c.phone)} · Caring Companions In-Home Senior Care</div>` +
    `</div></div>`
}
const button = (href: string, label: string) =>
  `<p style="margin:18px 0 6px"><a href="${esc(href)}" style="display:block;text-align:center;background:${TEAL};color:#ffffff;text-decoration:none;font-weight:bold;font-size:16px;padding:14px;border-radius:10px">${esc(label)}</a></p>`
const where = (c: Ctx) =>
  `<div style="background:${CREAM};border-radius:10px;padding:14px 16px;margin:16px 0">` +
  `<div style="font-size:11.5px;font-weight:bold;letter-spacing:.06em;text-transform:uppercase;color:${HONEY}">Where to come</div>` +
  `<div style="margin-top:4px">${esc(c.place)}</div>` + (c.note ? `<div style="font-size:14px;color:#55677a;margin-top:4px">${esc(c.note)}</div>` : '') +
  `<div style="margin-top:6px"><a href="${esc(c.mapUrl)}" style="color:${NAVY};font-weight:bold">Open in maps</a></div>` +
  (c.photoUrl ? `<img src="${esc(c.photoUrl)}" alt="Our entrance" style="width:100%;border-radius:8px;margin-top:10px">` : '') + `</div>`
const expect = (c: Ctx) =>
  `<div style="background:${CREAM};border-radius:10px;padding:14px 16px;margin:16px 0">` +
  `<div style="font-size:11.5px;font-weight:bold;letter-spacing:.06em;text-transform:uppercase;color:${HONEY}">What to expect</div>` +
  `<div style="margin-top:4px">A friendly conversation about you and the work, about ${c.mins} minutes. There's nothing to fill out. If you have a résumé or certifications you're welcome to bring them, but you don't need to. We may ask if we can record our conversation so we can listen instead of taking notes.</div></div>`
const h = (t: string) => `<h1 style="font-family:Georgia,serif;font-size:23px;color:${NAVY};margin:0 0 10px">${esc(t)}</h1>`
const p = (t: string) => `<p style="margin:0 0 10px">${t}</p>`
const sign = (c: Ctx) => p(esc(signoff(c)))

export const emails = {
  finish: (c: Ctx, second: boolean) => ({
    subject: second ? 'A quick reminder about your application' : 'Your Caring Companions application is almost done',
    html: shell(c, h(`Hi ${c.first},`) + p(second ? 'Just a reminder that your Caring Companions application is almost done.' : "It looks like your application didn't get finished. You're about a minute from done, and your answers so far are saved.") +
      button(c.link, 'Finish my application') + p(`Once it's done, you can pick a time for a relaxed ${c.mins}-minute interview at our office.`) + sign(c)),
  }),
  invite: (c: Ctx, step: 1 | 2 | 3 | 4, prn = false) => {
    const subject = step === 1 ? (prn ? 'Choose your in-person interview time: PRN CNA Team' : `${c.first}, we'd love to meet you`)
      : step === 4 ? 'One last note from Caring Companions' : "We'd love to meet you"
    const body = step === 1
      ? (prn ? p(esc(`Thanks for applying for Caring Companions' PRN CNA Team. Based on your Priority Application, we'd like to meet you in person.`))
             : p(`Thank you for applying to Caring Companions! We'd love to meet you. The next step is a relaxed ${c.mins}-minute interview at our office in Springfield, and you can pick any time that works for you.`))
        + button(c.link, 'Pick my interview time') + expect(c) + where(c)
      : step === 2 ? p("We'd really like to meet you! Grab any open interview time, or reply and we'll find one together.") + button(c.link, 'Pick my interview time')
      : step === 3 ? p(`If this week got busy, no worries. Interviews take about ${c.mins} minutes, Monday to Friday. Here's your link whenever you're ready.`) + button(c.link, 'Pick my interview time')
      : p(`This is our last note so we don't crowd your inbox. If the timing is better later, your link still works, or call us at ${esc(c.phone)}. We'd be glad to hear from you.`) + button(c.link, 'Pick my interview time')
    return { subject, html: shell(c, h(`Hi ${c.first},`) + body + sign(c)) }
  },
  confirm: (c: Ctx, who: string, day: string, time: string) => ({
    subject: `You're booked: ${day} at ${time}`,
    html: shell(c, h(`You're booked, ${c.first}!`) + p(`Your interview with <b>${esc(who)}</b> is <b>${esc(day)} at ${esc(time)}</b>.`) +
      expect(c) + where(c) + button(c.link, 'Change my time') + p("We're looking forward to meeting you!") + sign(c)),
  }),
  twoDays: (c: Ctx, weekday: string, time: string) => ({
    subject: `See you ${weekday} at ${time}`,
    html: shell(c, h(`Hi ${c.first},`) + p(`We're looking forward to meeting you <b>${esc(weekday)} at ${esc(time)}</b>! If anything comes up, you can move it here.`) +
      button(c.link, 'Change my time') + where(c) + sign(c)),
  }),
  dayBefore: (c: Ctx, day: string, time: string) => ({
    subject: `See you tomorrow at ${time}`,
    html: shell(c, h(`See you tomorrow, ${c.first}!`) + p(`Your interview is <b>${esc(day)} at ${esc(time)}</b>.`) + where(c) +
      p("Can't make it? Please let us know so we can free up the time.") + button(c.link, 'Change or cancel my time') + sign(c)),
  }),
  hour: (c: Ctx, time: string) => ({
    subject: `See you at ${time} today`,
    html: shell(c, h(`See you at ${time}, ${c.first}!`) + where(c) + p(`Running late? Call or text ${esc(c.phone)}.`) + sign(c)),
  }),
  cancelled: (c: Ctx, day: string, time: string) => ({
    subject: `Your interview on ${day} is cancelled`,
    html: shell(c, h(`Hi ${c.first},`) + p(`Your interview on <b>${esc(day)} at ${esc(time)}</b> is cancelled, so there's nothing more you need to do.`) +
      p("If you'd like a different time, pick one whenever it suits you.") + button(c.link, 'Pick a new time') + sign(c)),
  }),
  goodbye: (c: Ctx) => ({
    subject: 'Thanks for letting us know',
    html: shell(c, h(`Thanks for letting us know, ${c.first}.`) + p("If things change, you're always welcome to apply again at mo-care.com/apply. We wish you all the best!") + sign(c)),
  }),
}
