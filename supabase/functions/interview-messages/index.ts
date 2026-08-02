// Supabase Edge Function: interview-messages  (shared hub project)
// -----------------------------------------------------------------------------
// The apply page tells people we have sent a confirmation and will remind them.
// This is the thing that makes that true.
//
//   on booking      → confirmation, text and email, with the address
//   day before      → reminder, text and email
//   hour before     → short text only, address and nothing else
//   applied, never booked → three nudges, then we stop and it becomes a call
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
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
  const place = [st?.location_line1, st?.location_line2].filter(Boolean).join(', ')
  const note = st?.note ?? ''
  const phone = st?.phone ?? '(417) 234-8494'
  const mapUrl = 'https://maps.google.com/?q=' + encodeURIComponent([st?.location_name, place].filter(Boolean).join(', '))

  const contactFor = async (p: string | null, e: string | null, first: string) => {
    const r = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
      method: 'POST', headers: h,
      body: JSON.stringify({ locationId: ghlLocation, ...(p ? { phone: p } : {}), ...(e ? { email: e } : {}), firstName: first }),
    })
    const j = await r.json().catch(() => ({}))
    return j?.contact?.id ?? j?.id ?? null
  }
  const sms = (contactId: string, message: string) =>
    fetch('https://services.leadconnectorhq.com/conversations/messages', {
      method: 'POST', headers: h, body: JSON.stringify({ type: 'SMS', contactId, message }),
    })
  const email = (contactId: string, subject: string, html: string) =>
    fetch('https://services.leadconnectorhq.com/conversations/messages', {
      method: 'POST', headers: h, body: JSON.stringify({ type: 'Email', contactId, subject, html }),
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

  const out = { confirmed: 0, reminded_day: 0, reminded_hour: 0, nudged: 0, gave_up: 0 }
  const plan: Record<string, string[]> = { confirm: [], day: [], hour: [], nudge: [], give_up: [] }

  /* ---------------- interviews that are booked ---------------- */
  const { data: bookings, error } = await supabase
    .from('interview_bookings')
    .select('*, job_applicants(first_name,last_name,phone,email,sms_consent)')
    .eq('status', 'booked')
    .gte('starts_at', new Date(Date.now() - 3 * 3_600_000).toISOString())
  if (error) return json({ error: error.message }, 500)

  for (const b of bookings ?? []) {
    // deno-lint-ignore no-explicit-any
    const a: any = b.job_applicants
    if (!a) continue
    const first = a.first_name || 'there'
    const when = new Date(b.starts_at)
    const untilHours = (when.getTime() - Date.now()) / 3_600_000
    const day = fmtDay(when), time = fmtTime(when)
    const canText = !!a.phone && a.sms_consent === true

    const send = async (kind: 'confirm' | 'day' | 'hour') => {
      if (!ghlToken || !ghlLocation) return false
      const contactId = await contactFor(a.phone, a.email, first)
      if (!contactId) return false

      if (kind === 'hour') {
        if (canText) await sms(contactId,
          `Hi ${first}, your interview with Caring Companions is at ${time} today. ` +
          `We are at ${place}. ${note} See you shortly!`)
        return true
      }
      const opener = kind === 'confirm'
        ? `Your interview is booked for <b>${day} at ${time}</b>.`
        : `A reminder that your interview is <b>tomorrow, ${day} at ${time}</b>.`
      if (canText) await sms(contactId,
        `Hi ${first}, ${kind === 'confirm' ? 'your interview with Caring Companions is booked for' : 'reminder: your interview is'} ` +
        `${day} at ${time}, at ${place}. ${note} Questions? Call ${phone}.`)
      if (a.email) await email(contactId,
        kind === 'confirm' ? `Your interview: ${day} at ${time}` : `Tomorrow: your interview at ${time}`,
        shell(`<p>Hi ${first},</p><p>${opener}</p>${whereBlock()}` +
          `<p>It takes about 30 minutes. If anything changes, just call or text us on ${phone} and we will move it.</p>` +
          `<p>We are looking forward to meeting you.</p>`))
      return true
    }

    if (!b.confirmed_at) {
      plan.confirm.push(`${first} — ${day} ${time}`)
      if (!dry && await send('confirm')) {
        await supabase.from('interview_bookings').update({ confirmed_at: new Date().toISOString() }).eq('id', b.id)
        out.confirmed++
      }
    } else if (!b.reminded_day_at && untilHours <= 30 && untilHours > 2) {
      plan.day.push(`${first} — ${day} ${time}`)
      if (!dry && await send('day')) {
        await supabase.from('interview_bookings').update({ reminded_day_at: new Date().toISOString() }).eq('id', b.id)
        out.reminded_day++
      }
    } else if (!b.reminded_hour_at && untilHours <= 1.5 && untilHours > 0) {
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
  const { data: waiting } = await supabase
    .from('job_applicants')
    .select('*')
    .in('status', ['partial', 'new'])
    .is('gave_up_at', null)
    .gte('created_at', new Date(Date.now() - 14 * 86_400_000).toISOString())

  for (const p of waiting ?? []) {
    if (booked.has(p.id)) continue
    if (p.decline_reason) continue                     // we already told them no
    const age = hoursSince(p.created_at)
    const first = p.first_name || 'there'
    const bookUrl = 'https://mo-care.com/apply'

    const step =
      !p.nudge_1_at && age >= 2   ? 1 :
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

    plan.nudge.push(`${first} (try ${step})`)
    if (dry) continue
    if (!ghlToken || !ghlLocation) continue
    const contactId = await contactFor(p.phone, p.email, first)
    if (!contactId) continue

    const line = step === 1
      ? `Hi ${first}, thanks for applying to Caring Companions. You are one step from an interview, and you can pick a time that suits you here: ${bookUrl}`
      : step === 2
      ? `Hi ${first}, we still have interview times open this week if you would like one: ${bookUrl} Or call us on ${phone} and we will book it with you.`
      : `Hi ${first}, last note from us so we are not a nuisance. If you would still like to talk about caregiving work, pick a time here: ${bookUrl} or call ${phone}. We would be glad to hear from you.`

    if (p.phone && p.sms_consent === true) await sms(contactId, line)
    if (p.email) await email(contactId,
      step === 3 ? 'One last note from Caring Companions' : 'Pick a time to come and meet us',
      shell(`<p>Hi ${first},</p><p>${line.replace(bookUrl, `<a href="${bookUrl}">${bookUrl}</a>`)}</p>` +
        (step === 1 ? whereBlock() : '')))

    const col = step === 1 ? 'nudge_1_at' : step === 2 ? 'nudge_2_at' : 'nudge_3_at'
    await supabase.from('job_applicants').update({ [col]: new Date().toISOString() }).eq('id', p.id)
    out.nudged++
  }

  return json(dry ? { ok: true, dry: true, would: plan } : { ok: true, ...out })
})
