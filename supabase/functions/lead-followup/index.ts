// Supabase Edge Function: lead-followup  (shared hub project)
// -----------------------------------------------------------------------------
// A caregiver who applies at 9pm hears from us within two hours. A daughter who
// fills in the contact form at 9pm hears nothing until somebody opens the hub
// the next morning, and by then she has filled in two other agencies' forms.
//
// This is the family's side of the same ladder:
//
//   within minutes  → we have it, here is who will call and when
//   after a day     → one gentle check-in, if nobody has called them yet
//   after three     → one last note, then we stop
//   overdue         → the office is told, at the moment it goes overdue,
//                     rather than in tomorrow's digest
//
// Deliberately gentler than the applicant ladder. Two touches, not three, and
// everything stops the instant somebody in the office moves the lead off New,
// because the worst outcome here is a grieving family being pestered by a robot
// while a human is already talking to them.
//
// Nothing here says a price, promises a visit, or asks a question the family
// has to answer. It says: we have you, a person is coming, here is the number
// if you need us sooner.
//
// Runs every 15 minutes by pg_cron. ?dry=1 reports without sending.
// Deploy: supabase functions deploy lead-followup
//
// Needs lead-followup.sql to have been run first.
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const OFFICE = '(417) 234-8494'
const hoursSince = (iso: string | null) => iso ? (Date.now() - new Date(iso).getTime()) / 3_600_000 : 0
const todayCT = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })

/* Office hours matter here in a way they do not for applicants. A caregiver is
   pleased to get a text at 10pm; a family who has just written "my mother fell
   again" should not get one. Anything outside 8am to 8pm Central waits. */
function withinCallingHours() {
  const h = Number(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', hour: '2-digit', hour12: false }))
  return h >= 8 && h < 20
}

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
    `<p style="color:#57606a">Caring Companions In-Home Senior Care<br>${OFFICE}</p></div>`

  const { data: row } = await supabase.from('app_data').select('data').eq('key', 'leads').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const leads: any[] = Array.isArray(row?.data) ? row!.data : []
  const put = (item: unknown) => supabase.rpc('upsert_app_data_item', { target_key: 'leads', item })

  const { data: alertTo } = await supabase
    .from('applicant_alerts').select('*').eq('active', true).contains('alert_on', ['lead'])

  const out = { acknowledged: 0, nudged: 0, office_alerted: 0 }
  const plan: Record<string, string[]> = { acknowledge: [], nudge: [], office: [] }
  const quiet = !withinCallingHours()

  for (const l of leads) {
    // The moment a human touches it, the robot stops. Everything below is only
    // for leads nobody has picked up yet.
    if ((l.status || 'New') !== 'New') continue
    if (l.do_not_contact) continue
    const first = (l.first_name || '').replace(/\(.*\)/, '').trim() || 'there'
    const age = hoursSince(l.created_at)
    if (age > 14 * 24) continue                      // ancient, not our business

    const reach = async (message: string, subject: string, htmlBody: string) => {
      if (!ghlToken || !ghlLocation) return false
      if (!l.phone && !l.email) return false
      const contactId = await contactFor(l.phone || null, l.email || null, first)
      if (!contactId) return false
      if (l.phone) await sms(contactId, message)
      if (l.email) await email(contactId, subject, shell(htmlBody))
      return true
    }

    /* ---- and tell the office, once, the moment it is late ---- */
    const overdue = (l.follow_up_due && l.follow_up_due < todayCT()) || age >= 24
    if (overdue && !l.overdue_alerted_at && (alertTo ?? []).length) {
      const who = `${l.first_name ?? ''} ${l.last_name ?? ''}`.trim() || 'A website lead'
      plan.office.push(who)
      if (!dry) {
        const line = `${who} came in ${Math.round(age)} hours ago and nobody has called them yet. ` +
          `${l.phone || l.email || 'no contact given'}. They are in the hub under Leads.`
        for (const t of alertTo!) {
          const cid = await contactFor(t.phone ?? null, t.email ?? null, t.name ?? 'Team')
          if (!cid) continue
          if (t.phone) await sms(cid, line)
          if (t.email) await email(cid, `Lead waiting: ${who}`, shell(`<p>${line}</p>`))
        }
        l.overdue_alerted_at = new Date().toISOString()
        await put(l); out.office_alerted++
      }
    }

    /* ---- we have you ----
       Only while it is still true. "We have your message and a coordinator
       will call you shortly" is a kind thing to hear an hour after writing in
       and an insulting one to hear five days later, when plainly nobody did.
       Past that window the family hears nothing further from a machine and the
       office gets told instead, which is the honest handling of a lead that
       has already been dropped. */
    if (!l.ack_sent_at && age <= 12) {
      plan.acknowledge.push(`${first} (${Math.round(age)}h old)`)
      if (!dry && !quiet) {
        const line = `Hi ${first}, this is Caring Companions. We have your message and a care coordinator ` +
          `will call you shortly. If you would rather not wait, we are on ${OFFICE}. Reply STOP to opt out.`
        if (await reach(line, 'We have your message',
          `<p>Hi ${first},</p><p>Thank you for reaching out to Caring Companions. Your message is with our ` +
          `care coordinators and one of them will call you shortly.</p>` +
          `<p>If you would rather talk sooner, call us on <b>${OFFICE}</b> and we will pick up.</p>` +
          `<p>There is nothing you need to do in the meantime.</p>`)) {
          l.ack_sent_at = new Date().toISOString()
          await put(l); out.acknowledged++
        }
      }
      continue                                        // one message per lead per run
    }

    /* ---- still nobody has called them ----
       Only for leads we greeted in time. If we never acknowledged them, the
       ladder has already missed its moment and a machine asking "is there a
       good time to call?" a week later is worse than silence. Those belong to
       a person, and the office has been told. */
    const step = !l.ack_sent_at ? 0
      : !l.nudge_1_at && age >= 24 ? 1
      : !l.nudge_2_at && age >= 72 ? 2 : 0
    if (step) {
      plan.nudge.push(`${first} (try ${step})`)
      if (!dry && !quiet) {
        const line = step === 1
          ? `Hi ${first}, Caring Companions again. We do not want to lose track of you. ` +
            `Is there a good time to call, or would you rather ring us on ${OFFICE}?`
          : `Hi ${first}, last note from us so we are not a nuisance. If you would still like to talk about ` +
            `care for your family, we are on ${OFFICE} any time, and we would be glad to hear from you.`
        if (await reach(line, step === 1 ? 'Is there a good time to call?' : 'One last note from Caring Companions',
          `<p>Hi ${first},</p><p>${line.replace(OFFICE, `<b>${OFFICE}</b>`)}</p>`)) {
          if (step === 1) l.nudge_1_at = new Date().toISOString()
          else l.nudge_2_at = new Date().toISOString()
          await put(l); out.nudged++
        }
      }
      continue
    }

  }

  return json(dry
    ? { ok: true, dry: true, quiet_hours: quiet, leads_considered: leads.length, would: plan }
    : { ok: true, quiet_hours: quiet, ...out })
})
