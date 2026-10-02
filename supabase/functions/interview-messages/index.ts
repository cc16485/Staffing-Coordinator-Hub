// Supabase Edge Function: interview-messages  (shared hub project)
// -----------------------------------------------------------------------------
// The apply page tells people we have sent a confirmation and will remind them.
// This is the thing that makes that true.
//
//   on booking      → confirmation, text and email, with the address
//   day before      → reminder, text and email
//   hour before     → short text only, address and nothing else
//   applied, never booked → three nudges, then we stop and it becomes a call
//   cancelled       → confirmation to the applicant with the rebook link, and
//                     a heads-up to the office when it was the applicant's call
//
// Confirmations and reminders carry the applicant's own manage link
// (mo-care.com/apply?book=<id>), where moving or cancelling is self-serve.
// interview-cancel-reschedule.sql (care-coordinator-hub repo) installs the
// functions and columns behind that.
//
// Every message carries where to come, because a reminder without an address
// is a reminder to be lost. The hour-before one is almost entirely address.
//
// Texts only go to people who ticked the box on the form. Email has no such
// rule, so anyone who gave an address gets that regardless. A no-show costs
// the agency an hour; a text somebody did not consent to costs more than that.
//
// Runs every 15 minutes by pg_cron. ?dry=1 reports without sending.
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ghlContactIfAllowed } from '../_shared/optout.ts'
import { ghlSendChecked } from '../_shared/send-problems.ts'
import { latestTextConsent, withStop } from '../_shared/text-consent.ts'
import { ghlStaffContact } from '../_shared/staff-contact.ts'
import { jobCaller } from '../_shared/job-auth.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const TZ = 'America/Chicago'
const fmtDay = (d: Date) =>
  d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: TZ })
const fmtTime = (d: Date) =>
  d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ })

// How long an applicant has been left alone, in hours.
const hoursSince = (iso: string | null) => iso ? (Date.now() - new Date(iso).getTime()) / 3_600_000 : 0

/* OUTREACH HOURS: 8am to 6pm, America/Chicago.
   This function is scheduled every 15 minutes, around the clock, and sends SMS
   and email to applicants. It had no hours guard at all, so a confirmation or
   a reminder could land at 3am. Reminders are not more useful for being
   punctual to the minute; they are less useful for waking somebody up. */
const TZ_HOUR = () =>
  Number(new Date().toLocaleString('en-US', { timeZone: TZ, hour: '2-digit', hour12: false }))
const withinOutreachHours = () => { const h = TZ_HOUR(); return h >= 8 && h < 18 }

/* HEARTBEAT. One replaced row per automation under app_data key
   'automation_heartbeats' (fixed item id, so it never grows). A run that
   found nothing to do still beats; a run that never happened has no beat.
   automation-watchdog reads these every morning and tells the office which
   is which — until now a dead cron and a quiet day looked identical.
   Inlined rather than shared so a dashboard paste-deploy stays one file. */
// deno-lint-ignore no-explicit-any
async function beat(supabase: any, ok: boolean, note: string) {
  try {
    await supabase.rpc('upsert_app_data_item', {
      target_key: 'automation_heartbeats',
      item: { id: 'hb_interview-messages', automation: 'interview-messages',
              at: new Date().toISOString(), ok, note: String(note).slice(0, 300) },
    })
  } catch (e) { console.error('[interview-messages] heartbeat failed', e) }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  /* J1 (2026-09-29): only its every-15-minutes schedule or the owner's server key. Everyone else, the public key included, is refused
     before anything is read or sent. */
  const caller = await jobCaller(req)
  if (!caller) return json({ error: 'not allowed' }, 401)
  if (new URL(req.url).searchParams.get('auth_check') === '1') return json({ ok: true, caller })
  const dry = new URL(req.url).searchParams.get('dry') === '1'

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const ghlToken = Deno.env.get('GHL_TOKEN')
  const ghlLocation = Deno.env.get('GHL_LOCATION_ID')
  const h = {
    Authorization: `Bearer ${ghlToken}`,
    Version: '2021-07-28',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }

  const { data: st } = await supabase.from('scheduling_settings').select('*').eq('id', 1).maybeSingle()
  /* WORDING (2026-10-01): the interview length comes from the same setting the apply page shows (it said "about 30
     minutes" here while the page said 45). */
  /* 2026-10-01 (Samantha): "say 20 minutes for the interview, we want a 30 minutes slot". Applicants are told the
     interview length (talk_minutes); minutes is the calendar slot. */
  const { data: ivType } = await supabase.from('activity_types').select('*').eq('key', 'interview').maybeSingle()
  const ivMins = Number(ivType?.talk_minutes) > 0 ? Number(ivType!.talk_minutes) : 20
  const place = [st?.location_line1, st?.location_line2].filter(Boolean).join(', ')
  const note = st?.note ?? ''
  const phone = st?.phone ?? '(417) 234-8494'
  const mapUrl = 'https://maps.google.com/?q=' + encodeURIComponent([st?.location_name, place].filter(Boolean).join(', '))

  /* ONE CONTACT (2026-10-01): an office alert finds the staff member's contact per channel (the text to the contact
     holding the phone, the email to the contact holding the email), so a phone-only contact no longer swallows the
     email. Replaces contactFor, which sent phone and email together in one upsert. */
  // deno-lint-ignore no-explicit-any
  const staffContact = (t: any, channel: 'sms' | 'email') =>
    ghlStaffContact({ token: ghlToken!, locationId: ghlLocation! }, { channel, phone: t.phone, email: t.email, firstName: t.name ?? 'Team' })
  /* office alerts (new applicant, cancelled interview): a refused one raises a Needs Attention card too */
  // deno-lint-ignore no-explicit-any
  const sms = (contactId: string, message: string, t: any = {}) =>
    ghlSendChecked(supabase, h, 'staff-alert', { channel: 'sms', contactId, address: t.phone, who: t.name }, { message })
  // deno-lint-ignore no-explicit-any
  const email = (contactId: string, subject: string, html: string, t: any = {}) =>
    ghlSendChecked(supabase, h, 'staff-alert', { channel: 'email', contactId, address: t.email, who: t.name }, { subject, html })
  /* 0b-3: every message to an APPLICANT goes through the universal opt-out door, one GHL contact per channel
     (the phone alone for a text, the email alone for an email). Staff alerts below use staffContact. */
  const ghlDoor = { token: ghlToken!, locationId: ghlLocation! }
  // deno-lint-ignore no-explicit-any
  const applicantDoor = (who: any, first: string) => ({
    sms: async (message: string) => {
      const id = await ghlContactIfAllowed(supabase, ghlDoor, 'interview-messages', { channel: 'sms', phone: who.phone, email: who.email, firstName: first })
      /* NO SILENT FAILURES (2026-10-01): a message GoHighLevel refuses raises a Needs Attention card */
      if (id) await ghlSendChecked(supabase, h, 'interview-messages', { channel: 'sms', contactId: id, address: who.phone, who: [first, who.last_name].filter(Boolean).join(' ') }, { message })
    },
    email: async (subject: string, html: string) => {
      const id = await ghlContactIfAllowed(supabase, ghlDoor, 'interview-messages', { channel: 'email', email: who.email, phone: who.phone, firstName: first })
      if (id) await ghlSendChecked(supabase, h, 'interview-messages', { channel: 'email', contactId: id, address: who.email, who: [first, who.last_name].filter(Boolean).join(' ') }, { subject, html })
    },
  })

  const shell = (body: string) =>
    `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#1f2a36">${body}` +
    `<p style="color:#57606a">Caring Companions In-Home Senior Care<br>${phone}</p></div>`

  const whereBlock = () =>
    `<div style="background:#f6f4ef;border-radius:10px;padding:14px 16px;margin:14px 0">` +
    `<div style="font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#6E6559">Where to come</div>` +
    `<div style="font-size:15px;font-weight:600;margin-top:5px">${st?.location_name ?? ''}</div>` +
    `<div>${place}</div>` +
    `<div style="margin-top:7px"><a href="${mapUrl}" style="color:#0D365F;font-weight:600">Open in maps</a></div>` +
    (note ? `<div style="font-size:13.5px;color:#57606a;margin-top:9px">${note}</div>` : '') +
    (st?.photo_url ? `<img src="${st.photo_url}" alt="Our entrance" style="width:100%;border-radius:8px;margin-top:10px">` : '') +
    `</div>`

  const out = { confirmed: 0, reminded_day: 0, reminded_hour: 0, nudged: 0, gave_up: 0, alerted: 0, cancel_notified: 0, welcome_confirmed: 0, welcome_reminded: 0 }
  const plan: Record<string, string[]> = { confirm: [], day: [], hour: [], nudge: [], give_up: [], alerted: [], cancelled: [], welcome: [] }

  /* ---------------- interviews that are booked ---------------- */
  const { data: bookings, error } = await supabase
    .from('interview_bookings')
    .select('*, job_applicants(first_name,last_name,phone,email,sms_consent)')
    .eq('status', 'booked')
    .gte('starts_at', new Date(Date.now() - 3 * 3_600_000).toISOString())
  if (error) { await beat(supabase, false, 'bookings query: ' + error.message); return json({ error: error.message }, 500) }

  for (const b of bookings ?? []) {
    // deno-lint-ignore no-explicit-any
    const a: any = b.job_applicants
    if (!a) continue
    const first = a.first_name || 'there'
    const when = new Date(b.starts_at)
    const untilHours = (when.getTime() - Date.now()) / 3_600_000
    const day = fmtDay(when), time = fmtTime(when)
    const canText = !!a.phone && a.sms_consent === true
    /* The same link the nudges use: it opens on THEIR booking, with move and
       cancel one tap away. "Call us and we will move it" was a promise with a
       queue in front of it; this is the promise kept. */
    const manageUrl = 'https://mo-care.com/apply?book=' + encodeURIComponent(String(b.applicant_id))

    const send = async (kind: 'confirm' | 'day' | 'hour') => {
      /* Refuse outside outreach hours rather than at each call site, so a new
         message type added later cannot forget the rule. The item is not
         marked sent, so it goes out on the first run after 8am. */
      if (!withinOutreachHours()) return false
      if (!ghlToken || !ghlLocation) return false
      const to = applicantDoor(a, first)
      if (!to) return false

      /* IN PERSON (2026-10-01, Samantha: "make sure it says in-person interview, we do not do phone interviews
         anymore... we had someone not come to their in-person interview today because they thought it was a phone
         interview"). Every interview message says IN-PERSON, at our office, and that we will not call them. */
      if (kind === 'hour') {
        if (canText) await to.sms(
          `Hi ${first}, your IN-PERSON interview with Caring Companions is at ${time} today. ` +
          `Please come to our office: ${place}. ${note} This is not a phone interview. See you shortly!`)
        return true
      }
      const opener = kind === 'confirm'
        ? `Your <b>in-person</b> interview is booked for <b>${day} at ${time}</b>.`
        : `A reminder that your <b>in-person</b> interview is <b>tomorrow, ${day} at ${time}</b>.`
      if (canText) await to.sms(
        `Hi ${first}, ${kind === 'confirm' ? 'your IN-PERSON interview with Caring Companions is booked for' : 'reminder: your IN-PERSON interview is'} ` +
        `${day} at ${time}. Please come to our office: ${place}. ${note} This is not a phone interview, so we will not call you. ` +
        `Need to move or cancel it? ${manageUrl} — or call ${phone}.`)
      if (a.email) await to.email(
        kind === 'confirm' ? `Your in-person interview: ${day} at ${time}` : `Tomorrow: your in-person interview at ${time}`,
        shell(`<p>Hi ${first},</p><p>${opener}</p>${whereBlock()}` +
          `<p><b>This is an in-person interview at our office, not a phone call</b>, and it takes about ${ivMins} minutes. Need to move or cancel it? <a href="${manageUrl}">You can do that here</a> in a few taps, or call or text us on ${phone}.</p>` +
          `<p>We are looking forward to meeting you.</p>`))
      return true
    }

    if (!b.confirmed_at) {
      plan.confirm.push(`${first} — ${day} ${time}`)
      if (!dry && await send('confirm')) {
        const stamp: Record<string, string> = { confirmed_at: new Date().toISOString() }
        /* Booked inside the day-before window: the confirmation IS the
           day-before notice. Without this, the next run followed it fifteen
           minutes later with "reminder: your interview is tomorrow". */
        if (untilHours <= 30) stamp.reminded_day_at = stamp.confirmed_at
        await supabase.from('interview_bookings').update(stamp).eq('id', b.id)
        out.confirmed++
      }
    } else if (!b.reminded_day_at && untilHours <= 30 && untilHours > 2) {
      plan.day.push(`${first} — ${day} ${time}`)
      if (!dry && await send('day')) {
        await supabase.from('interview_bookings').update({ reminded_day_at: new Date().toISOString() }).eq('id', b.id)
        out.reminded_day++
      }
    /* The lower bound reaches 15 minutes PAST the start on purpose: for an
       8am interview the first run the hours gate permits is 8:00, when
       untilHours is already ≤ 0 — so the earliest interviews of the day,
       the easiest ones to forget, were the only ones never reminded. */
    } else if (!b.reminded_hour_at && untilHours <= 1.5 && untilHours > -0.25) {
      plan.hour.push(`${first} — ${time}`)
      if (!dry && await send('hour')) {
        await supabase.from('interview_bookings').update({ reminded_hour_at: new Date().toISOString() }).eq('id', b.id)
        out.reminded_hour++
      }
    }
  }

  /* ---------------- applied, never booked ----------------
     Three tries over five days, then we stop. Somebody who has ignored three
     messages is not going to answer a fourth; they are a phone call, and
     pretending otherwise just trains people to ignore us. */
  const booked = new Set((bookings ?? []).map((b) => b.applicant_id))
  /* PRN1 (2026-09-29): roles on the PRN track (the PRN CNA Team). A cleared PRN application gets the calendar text
     as soon as it is finished, in the team's own words, instead of two hours later. A PRN application that is not
     finished, needs a look or applied before gets no booking link at all: the office decides. Every other role is
     exactly as before. Before the track column exists this finds nothing, so nothing changes. */
  const { data: prnRoles } = await supabase.from('job_positions').select('key').eq('track', 'prn')
  const PRN = new Set((prnRoles ?? []).map((r: { key: string }) => r.key))
  const { data: waiting } = await supabase
    .from('job_applicants')
    .select('*')
    .in('status', ['partial', 'new'])
    .is('gave_up_at', null)
    .gte('created_at', new Date(Date.now() - 14 * 86_400_000).toISOString())

  for (const p of waiting ?? []) {
    if (booked.has(p.id)) continue
    if (p.decline_reason) continue                     // we already told them no
    const prn = PRN.has(p.position)
    if (prn && p.screen_grade !== 'qualified') continue
    const age = hoursSince(p.created_at)
    /* Ten minutes after they finish, so somebody still choosing a time on the last screen isn't texted mid-choice. */
    const prnReady = prn && !!p.completed_at && hoursSince(p.completed_at) >= 10 / 60
    const first = p.first_name || 'there'
    // Deep-link straight to the interview time-picker for THIS applicant, who
    // already applied but has not booked. Sending them to bare /apply restarted
    // the whole form (the exact "pick a time here" link that went nowhere).
    const bookUrl = 'https://mo-care.com/apply?book=' + encodeURIComponent(String(p.id))

    const step =
      !p.nudge_1_at && (prn ? prnReady : age >= 2) ? 1 :
      !p.nudge_2_at && age >= 48  ? 2 :
      !p.nudge_3_at && age >= 120 ? 3 : 0
    if (!step) {
      if (p.nudge_3_at && age >= 168) {
        plan.give_up.push(first + ' ' + (p.last_name || ''))
        if (!dry) {
          await supabase.from('job_applicants').update({ gave_up_at: new Date().toISOString() }).eq('id', p.id)
          out.gave_up++
        }
      }
      continue
    }

    plan.nudge.push(`${first} (try ${step}${prn ? ', PRN' : ''})`)
    if (dry) continue
    /* The one rule this file's header claims for everything, applied to the
       one block that skipped it: a cron that runs around the clock WILL
       otherwise text an applicant at 3am. Nothing is stamped, so held
       nudges go out on the first run after 8am. */
    if (!withinOutreachHours()) continue
    if (!ghlToken || !ghlLocation) continue
    const to = applicantDoor(p, first)
    if (!to) continue

    const line = prn && step === 1
      ? `Hi ${first}! Thanks for applying for Caring Companions' PRN CNA Team. Based on your Priority Application, we'd like to meet you in person. Choose an in-person interview time at our office here: ${bookUrl}`
      : step === 1
      ? `Hi ${first}, thanks for applying to Caring Companions. You are one step from an in-person interview at our office, and you can pick a time that suits you here: ${bookUrl}`
      : step === 2
      ? `Hi ${first}, we still have in-person interview times open at our office this week if you would like one: ${bookUrl} Or call us on ${phone} and we will book it with you.`
      : `Hi ${first}, last note from us so we are not a nuisance. If you would still like to talk about caregiving work, pick a time here: ${bookUrl} or call ${phone}. We would be glad to hear from you.`

    if (p.phone && p.sms_consent === true) await to.sms(line)
    if (p.email) await to.email(
      step === 3 ? 'One last note from Caring Companions' : prn && step === 1 ? 'Choose your in-person interview time: PRN CNA Team' : 'Pick a time to come and meet us in person',
      shell(`<p>Hi ${first},</p><p>${line.replace(bookUrl, `<a href="${bookUrl}">${bookUrl}</a>`)}</p>` +
        (step === 1 ? whereBlock() : '')))

    const col = step === 1 ? 'nudge_1_at' : step === 2 ? 'nudge_2_at' : 'nudge_3_at'
    await supabase.from('job_applicants').update({ [col]: new Date().toISOString() }).eq('id', p.id)
    out.nudged++
  }

  /* ---------------- somebody good just applied ----------------
     Augusta's own number was 2.6 days from applying to an interview, and speed
     is most of what wins a caregiver. Until now a good application landed in
     the hub and waited for a tab to be opened. This pokes the office instead.

     Only for people who cleared the screen, once each, and never for anybody
     the form already turned away. Who it goes to is a row in the database
     rather than a name in this file, so it can change without a deploy. */
  const { data: alertTo } = await supabase
    .from('applicant_alerts').select('*').eq('active', true)

  if ((alertTo ?? []).length) {
    const { data: fresh } = await supabase
      .from('job_applicants')
      .select('id, first_name, last_name, phone, city, zip, position, channel, screen_grade, miles_out, hours_wanted, created_at')
      .is('office_alerted_at', null)
      .not('completed_at', 'is', null)
      .is('decline_reason', null)
      .in('screen_grade', ['qualified', 'review'])
      .gte('created_at', new Date(Date.now() - 3 * 86_400_000).toISOString())
      .order('created_at')
      .limit(20)

    for (const p of fresh ?? []) {
      const who = `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || 'Someone'
      const bits = [
        p.city || p.zip,
        p.miles_out != null ? `${Math.round(p.miles_out)} miles out` : null,
        p.hours_wanted ? `wants ${p.hours_wanted} hrs` : null,
        p.channel ? `via ${p.channel}` : null,
      ].filter(Boolean).join(', ')
      const grade = p.screen_grade === 'qualified' ? 'cleared the screen' : 'needs a look'
      const team = PRN.has(p.position) ? ' for the PRN CNA Team' : ''
      const line = `${who} just applied${team} and ${grade}${bits ? ` — ${bits}` : ''}. ` +
        `They are in the hub under Applicants.`

      plan.alerted.push(who)
      if (dry) continue
      /* Staff sleep too. A midnight application is announced at 8am, not the
         moment it lands — office_alerted_at stays null until it really sends. */
      if (!withinOutreachHours()) continue

      for (const t of alertTo!) {
        if (t.phone) { const cid = await staffContact(t, 'sms'); if (cid) await sms(cid, line, t) }
        if (t.email) { const cid = await staffContact(t, 'email'); if (cid) await email(cid, `New applicant: ${who}`, shell(`<p>${line}</p>`), t) }
      }
      await supabase.from('job_applicants')
        .update({ office_alerted_at: new Date().toISOString() }).eq('id', p.id)
      out.alerted++
    }
  }

  /* ---------------- cancellations ----------------
     A cancelled interview needs saying out loud twice: to the applicant, so
     they know it is done and how to rebook, and to the office when it was the
     applicant who cancelled, so the seat is not discovered empty on the day.
     Pure reschedules never land here — the move stamps its own
     cancel_notified_at, and the new booking's confirmation says it all. */
  const { data: cx } = await supabase
    .from('interview_bookings')
    .select('*, job_applicants(first_name,last_name,phone,email,sms_consent)')
    .eq('status', 'cancelled')
    .is('cancel_notified_at', null)
    .gte('cancelled_at', new Date(Date.now() - 7 * 86_400_000).toISOString())

  for (const b of cx ?? []) {
    // deno-lint-ignore no-explicit-any
    const a: any = b.job_applicants
    if (!a) continue
    /* They cancelled and then booked a new time before this run — that is a
       reschedule in two steps, not a cancellation. Saying "your interview is
       cancelled" next to "see you Thursday" helps nobody, so the notice is
       swallowed and only the new booking's confirmation goes out. */
    if (booked.has(b.applicant_id)) {
      plan.cancelled.push(`${a.first_name || 'someone'} — rebooked already, staying quiet`)
      if (!dry) {
        await supabase.from('interview_bookings')
          .update({ cancel_notified_at: new Date().toISOString() }).eq('id', b.id)
      }
      continue
    }
    const first = a.first_name || 'there'
    const when = new Date(b.starts_at)
    const day = fmtDay(when), time = fmtTime(when)
    const bookUrl = 'https://mo-care.com/apply?book=' + encodeURIComponent(String(b.applicant_id))

    plan.cancelled.push(`${first} — ${day} ${time}${b.cancelled_by === 'applicant' ? ' (their call)' : ''}`)
    if (dry) continue
    if (!withinOutreachHours()) continue        // not stamped, so it goes out after 8am
    if (!ghlToken || !ghlLocation) continue

    const to = applicantDoor(a, first)
    if (to) {
      if (a.phone && a.sms_consent === true) await to.sms(
        `Hi ${first}, your interview with Caring Companions for ${day} at ${time} is cancelled — nothing more to do. ` +
        `Want a different time? Pick one here: ${bookUrl} or call ${phone}.`)
      if (a.email) await to.email(`Your interview on ${day} is cancelled`,
        shell(`<p>Hi ${first},</p><p>Your interview for <b>${day} at ${time}</b> is cancelled — nothing more to do on your side.</p>` +
          `<p>If you would like a different time, <a href="${bookUrl}">pick one here</a> whenever suits you, or call us on ${phone}.</p>`))
    }

    /* The office hears about it on the same channel that announces a good
       application. An office cancellation needs no telling — they pressed it. */
    if (b.cancelled_by === 'applicant' && (alertTo ?? []).length) {
      const who = `${a.first_name ?? ''} ${a.last_name ?? ''}`.trim() || 'An applicant'
      const line = `${who} cancelled their interview for ${day} at ${time}.` +
        (b.cancel_reason ? ` Reason: ${b.cancel_reason}.` : '') +
        ` They have the link to rebook; they are in the hub under Applicants.`
      for (const t of alertTo!) {
        if (t.phone) { const cid = await staffContact(t, 'sms'); if (cid) await sms(cid, line, t) }
        if (t.email) { const cid = await staffContact(t, 'email'); if (cid) await email(cid, `Interview cancelled: ${who}`, shell(`<p>${line}</p>`), t) }
      }
    }

    await supabase.from('interview_bookings')
      .update({ cancel_notified_at: new Date().toISOString() }).eq('id', b.id)
    out.cancel_notified++
  }

  /* ---------------- no-shows ----------------
     REMOVED 2026-10-01 (Samantha): a no-show is no longer invited back automatically (the old "pick a new
     time") or put back into play. Pressing "Did not show" now marks them a No-Show and sends HER message through
     applicant-noshow; only the office can excuse it and rebook them after they call with a reason. */

  /* ---------------- welcome calls (remote orientation, Desktop 407) ----------------
     A booked 15-minute Google Meet welcome call gets a confirmation (text + email), a day-before reminder (text +
     email) and an hour-before text, each with the shared Meet link. Texts only with their yes to texts and 8am-6pm
     (held, not stamped, until then); every text ends with the STOP line. Sender 'welcome-call' so a refusal raises a
     card that names it. */
  try {
    const { data: wcs } = await supabase.from('welcome_calls').select('*').eq('status', 'booked').not('starts_at', 'is', null)
      .gte('starts_at', new Date(Date.now() - 30 * 60_000).toISOString())
    const meet = String(st?.welcome_meet_url || 'https://meet.google.com/yqj-nzuo-tgp')
    for (const w of wcs ?? []) {
      const first = w.first_name || 'there'
      const when = new Date(w.starts_at); const day = fmtDay(when), time = fmtTime(when)
      const until = (when.getTime() - Date.now()) / 3_600_000
      const manage = 'https://cc.mo-care.com/welcome.html?w=' + encodeURIComponent(w.id)
      const kind = !w.confirmed_at ? 'confirm' : (!w.reminded_day_at && until <= 30 && until > 2) ? 'day'
        : (!w.reminded_hour_at && until <= 1.5 && until > -0.25) ? 'hour' : ''
      if (!kind) continue
      plan.welcome.push(`${first}: ${kind}`)
      if (dry || !withinOutreachHours() || !ghlToken || !ghlLocation) continue
      const name = [w.first_name, w.last_name].filter(Boolean).join(' ')
      const textOk = w.phone ? (await latestTextConsent(supabase, w.phone)).ok : false
      const sendText = async (message: string) => {
        if (!textOk) return
        const id = await ghlContactIfAllowed(supabase, ghlDoor, 'welcome-call', { channel: 'sms', phone: w.phone, email: w.email, firstName: w.first_name, lastName: w.last_name })
        if (id) await ghlSendChecked(supabase, h, 'welcome-call', { channel: 'sms', contactId: id, address: w.phone, who: name }, { message: withStop(message) })
      }
      const sendEmail = async (subject: string, html: string) => {
        if (!w.email) return
        const id = await ghlContactIfAllowed(supabase, ghlDoor, 'welcome-call', { channel: 'email', email: w.email, phone: w.phone, firstName: w.first_name, lastName: w.last_name })
        if (id) await ghlSendChecked(supabase, h, 'welcome-call', { channel: 'email', contactId: id, address: w.email, who: name }, { subject, html })
      }
      const join = `<p><a href="${meet}" style="background:#F0A63A;color:#122F52;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:700;display:inline-block">Join the video call</a></p>`
      if (kind === 'hour') {
        await sendText(`Hi ${first}, your welcome video call with Caring Companions is at ${time} today. At that time, tap here to join: ${meet}`)
        await supabase.from('welcome_calls').update({ reminded_hour_at: new Date().toISOString() }).eq('id', w.id)
      } else {
        const confirm = kind === 'confirm'
        await sendText(`Hi ${first}, ${confirm ? 'your welcome video call with Caring Companions is booked for' : 'reminder: your welcome video call is'} ` +
          `${day} at ${time}. At that time, tap this link to join from your phone: ${meet} Please have the original ID documents ` +
          `you uploaded in Viventium with you. Need a different time? ${manage}`)
        await sendEmail(confirm ? `Your welcome call: ${day} at ${time}` : `Tomorrow: your welcome call at ${time}`,
          shell(`<p>Hi ${first},</p><p>${confirm ? 'Your 15-minute welcome video call is booked for' : 'A reminder that your welcome video call is'} <b>${day} at ${time}</b>.</p>` +
            `<p>At that time, open this link on your phone or computer (no app needed):</p>${join}` +
            `<p>Please have the <b>original ID documents</b> you uploaded in Viventium with you. Need a different time? <a href="${manage}">Pick a new one here</a>, or call us on ${phone}.</p>`))
        const stamp: Record<string, string> = confirm ? { confirmed_at: new Date().toISOString() } : { reminded_day_at: new Date().toISOString() }
        if (confirm && until <= 30) stamp.reminded_day_at = stamp.confirmed_at       // booked inside the day-before window
        await supabase.from('welcome_calls').update(stamp).eq('id', w.id)
      }
      if (kind === 'confirm') out.welcome_confirmed++; else out.welcome_reminded++
    }
  } catch (e) { console.error('[interview-messages] welcome calls', e) }

  /* Dry runs don't beat: a manual ?dry=1 must never make a dead cron look alive. */
  if (!dry) await beat(supabase, true, JSON.stringify(out))
  return json(dry ? { ok: true, dry: true, would: plan } : { ok: true, ...out })
})
