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
import { ldPush } from '../_shared/lead-truth.ts'
import { inquirySwitches } from '../_shared/inquiry-switches.ts'
import { ghlContactIfAllowed, optOutCheck } from '../_shared/optout.ts'
import { jobCaller } from '../_shared/job-auth.ts'
import { ghlSendChecked } from '../_shared/send-problems.ts'
import { ghlStaffContact } from '../_shared/staff-contact.ts'
import { officeQuietNow } from '../_shared/quiet-hours.ts'

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
/* OUTREACH HOURS: 8am to 6pm, America/Chicago.
   Was 8am to 8pm. Samantha's rule is that nothing we send automatically may
   land before 8 or after 6 — these are families and applicants, not a support
   queue, and an 7:40pm text from a care company reads as an emergency. */
function withinCallingHours() {
  const h = Number(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', hour: '2-digit', hour12: false }))
  return h >= 8 && h < 18
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

  /* ONE CONTACT (2026-10-01): the "lead waiting" office alert finds the staff member's contact per channel (the text
     to the contact holding the phone, the email to the contact holding the email), so a phone-only contact no longer
     swallows the email. Replaces contactFor, which sent phone and email together in one upsert. */
  // deno-lint-ignore no-explicit-any
  const staffContact = (t: any, channel: 'sms' | 'email') =>
    ghlStaffContact({ token: ghlToken!, locationId: ghlLocation! }, { channel, phone: t.phone, email: t.email, firstName: t.name ?? 'Team' })
  /* NO SILENT FAILURES (2026-10-01): every send here is automatic (the 15-minute sweep), so a refused send raises a
     Needs Attention card. Family messages are 'lead-followup'; the "lead waiting" office alert is 'staff-alert'.
     Both return true only when GoHighLevel took the message. */
  type To = { sender: string; address?: unknown; who?: unknown }
  const sms = (contactId: string, message: string, to: To) =>
    ghlSendChecked(supabase, h, to.sender, { channel: 'sms', contactId, address: to.address, who: to.who }, { message })
  const email = (contactId: string, subject: string, html: string, to: To) =>
    ghlSendChecked(supabase, h, to.sender, { channel: 'email', contactId, address: to.address, who: to.who }, { subject, html })
  const shell = (body: string) =>
    `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#1f2a36">${body}` +
    `<p style="color:#57606a">Caring Companions In-Home Senior Care<br>${OFFICE}</p></div>`

  /* 0b-2 live proof, server-only: does GoHighLevel's answer carry the Do Not Disturb flag the opt-out check needs?
     Uses the office's own first "lead waiting" alert recipient (a staff contact the office alert already upserts on
     every run) and answers yes/no only: no names, numbers or ids leave, and nothing is sent. */
  if (new URL(req.url).searchParams.get('probe_dnd') === '1') {
    const svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const tok = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    let role: unknown = null
    try { const b = tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'); role = JSON.parse(atob(b + '='.repeat((4 - b.length % 4) % 4))).role } catch { /* not a JWT */ }
    /* The exact server key, or a server-role sign-in. lead-followup runs with the platform's sign-in check ON, so the
       platform has already verified this token's signature before it reaches here: a service_role claim is genuine.
       (Desktop 276's first run was refused because the key it read and this function's copy differ in form.) */
    if (!((svc && tok === svc) || role === 'service_role')) return json({ error: 'server only' }, 401)
    const { data: staff } = await supabase.from('applicant_alerts').select('name, phone').eq('active', true).contains('alert_on', ['lead'])
    // deno-lint-ignore no-explicit-any
    const t = (staff ?? []).find((x: any) => String(x.phone || '').replace(/\D/g, '').length >= 10)
    if (!t) return json({ probe: 'dnd', staff_contact: false })
    const up = await fetch('https://services.leadconnectorhq.com/contacts/upsert', { method: 'POST', headers: h,
      body: JSON.stringify({ locationId: ghlLocation, phone: t.phone, firstName: t.name ?? 'Team' }) })
    const uj = await up.json().catch(() => ({}))
    const id = uj?.contact?.id
    let getHas = false
    if (id) {
      const g = await fetch(`https://services.leadconnectorhq.com/contacts/${encodeURIComponent(id)}`, { headers: h })
      const gj = await g.json().catch(() => ({}))
      getHas = typeof gj?.contact?.dnd === 'boolean'
    }
    /* and every source the check reads is readable here: a made-up number nobody uses must come back allowed, with
       no "could not check" (a permissions gap would otherwise refuse every family message) */
    const reads = await optOutCheck(supabase, { channel: 'sms', phone: '+14170000000', viaGhl: false })
    return json({ probe: 'dnd', staff_contact: true, contact_found: !!id, upsert_has_dnd: typeof uj?.contact?.dnd === 'boolean', get_has_dnd: getHas,
                  check_reads_ok: reads.allowed === true })
  }

  const { data: row } = await supabase.from('app_data').select('data').eq('key', 'leads').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const leads: any[] = Array.isArray(row?.data) ? row!.data : []
  const put = (item: unknown) => supabase.rpc('upsert_app_data_item', { target_key: 'leads', item })

  const { data: alertTo } = await supabase
    .from('applicant_alerts').select('*').eq('active', true).contains('alert_on', ['lead'])

  /* Step 0 · 0a: both family-facing messages are paused unless their switch is explicitly on */
  const sw = await inquirySwitches(supabase)
  const out = { acknowledged: 0, nudged: 0, office_alerted: 0, paused_ack: 0, paused_followups: 0, optout_stopped: 0 }
  const plan: Record<string, string[]> = { acknowledge: [], nudge: [], office: [], paused_ack: [], paused_followups: [] }
  const quiet = !withinCallingHours()

  for (const l of leads) {
    // The moment a human touches it, the robot stops. Everything below is only
    // for leads nobody has picked up yet.
    /* THE HANDOFF. Automation owns a lead only until a human touches it.
       This checked the STATUS alone, but a coordinator who rings the family
       and logs the call normally leaves the status as New — changing it is a
       separate action nobody has to take. So the hub stopped chasing and this
       kept texting, and the family got a "just checking in" message from the
       system after a person had already spoken to them.

       Mirrors opsLeadUntouched() in the hub, which is the definition of
       record:
           !last_contacted_at && !comm_log.length && status === 'New'

       Deliberately duplicated rather than fetched. It is three stable lines,
       and adding a network dependency to a function that sends messages trades
       a small drift risk for a much worse failure mode. If that definition
       changes, it changes in both places. */
    if ((l.status || 'New') !== 'New') continue
    if (l.last_contacted_at) continue
    if (Array.isArray(l.comm_log) && l.comm_log.length) continue
    if (l.do_not_contact) continue
    if (l.auto_msgs_stopped_at) continue            // 0b-2: an authority said stop; people still see the lead
    const first = (l.first_name || '').replace(/\(.*\)/, '').trim() || 'there'
    const age = hoursSince(l.created_at)
    if (age > 14 * 24) continue                      // ancient, not our business

    const reach = async (message: string, subject: string, htmlBody: string) => {
      if (!ghlToken || !ghlLocation) return false
      if (!l.phone && !l.email) return false
      /* Channel-keyed contacts: GHL matches by email first and texts that
         contact's EXISTING phone, which once misdelivered a greeting. The
         SMS contact is found by phone alone, the email contact by email
         alone — a text can only reach the number on the lead. */
      /* 0b-2: each channel through the universal opt-out door. If an authority says no (GHL Do Not Disturb, a
         STOP, a staff opt-out, do-not-contact, a Family Circle stop), automation stops messaging this lead for good
         instead of asking again every 15 minutes; the office alert and the lead itself are untouched. */
      const ghl = { token: ghlToken, locationId: ghlLocation }
      const stopped: string[] = []
      const onOptOut = (reasons: string[]) => { stopped.push(...reasons) }
      let ok = false
      if (l.phone) {
        const cidP = await ghlContactIfAllowed(supabase, ghl, 'lead-followup', { channel: 'sms', phone: l.phone, email: l.email, firstName: first, onOptOut })
        const fam = [l.first_name, l.last_name].filter(Boolean).join(' ')
        if (cidP && (await sms(cidP, message, { sender: 'lead-followup', address: l.phone, who: fam }))) ok = true
      }
      if (l.email) {
        const cidE = await ghlContactIfAllowed(supabase, ghl, 'lead-followup', { channel: 'email', email: l.email, phone: l.phone, firstName: first, onOptOut })
        if (cidE && (await email(cidE, subject, shell(htmlBody), { sender: 'lead-followup', address: l.email,
          who: [l.first_name, l.last_name].filter(Boolean).join(' ') }))) ok = true
      }
      if (!ok && stopped.length) {
        l.auto_msgs_stopped_at = new Date().toISOString()
        l.auto_msgs_stop_reason = 'opt-out: ' + [...new Set(stopped)].join('; ')
        await put(l); out.optout_stopped++
      }
      return ok
    }

    /* ---- and tell the office, once, the moment it is late ---- */
    const overdue = (l.follow_up_due && l.follow_up_due < todayCT()) || age >= 24
    /* RETRY (2026-10-01, Samantha "yes make them retry"): stamped only when at least one person in the office was
       reached; otherwise the next run tries again, at most 3 tries, 10+ minutes apart. */
    const overdueRetryOk = (Number(l.overdue_alert_tries) || 0) < 3
      && (!l.overdue_alert_last_try || Date.now() - Date.parse(String(l.overdue_alert_last_try)) >= 10 * 60_000)
    if (overdue && !l.overdue_alerted_at && overdueRetryOk && (alertTo ?? []).length) {
      const who = `${l.first_name ?? ''} ${l.last_name ?? ''}`.trim() || 'A website lead'
      plan.office.push(who)
      if (!dry) {
        const line = `${who} came in ${Math.round(age)} hours ago and nobody has called them yet. ` +
          `${l.phone || l.email || 'no contact given'}. They are in the hub under Leads.`
        let reached = 0
        /* OFFICE QUIET HOURS (Samantha, 2026-10-03): no text to staff 8pm to 7am Central; the email still goes. With
           nobody reached (no email on file), it is not counted as a try: the first run after 7am texts once. */
        const quietStaff = await officeQuietNow(supabase)
        for (const t of alertTo!) {
          if (t.phone && !quietStaff) {
            const cid = await staffContact(t, 'sms')
            if (cid && await sms(cid, line, { sender: 'staff-alert', address: t.phone, who: t.name })) reached++
          }
          if (t.email) {
            const cid = await staffContact(t, 'email')
            if (cid && await email(cid, `Lead waiting: ${who}`, shell(`<p>${line}</p>`), { sender: 'staff-alert', address: t.email, who: t.name })) reached++
          }
        }
        if (reached) { l.overdue_alerted_at = new Date().toISOString(); out.office_alerted++ }
        else if (quietStaff) { /* waits for 7am, no try used */ }
        else { l.overdue_alert_tries = (Number(l.overdue_alert_tries) || 0) + 1; l.overdue_alert_last_try = new Date().toISOString() }
        await put(l)
      }
    }

    /* ---- we have you ----
       Only while it is still true. "We have your message and a coordinator
       will call you shortly" is a kind thing to hear an hour after writing in
       and an insulting one to hear five days later, when plainly nobody did.
       Past that window the family hears nothing further from a machine and the
       office gets told instead, which is the honest handling of a lead that
       has already been dropped. */
    /* Her rule (2026-09-19): the acknowledgment belongs to the WEBSITE FORM.
       This sweep is only the retry for a form ack that failed to send — a
       lead somebody typed in by hand after a phone call must never get
       "we have your message" from a robot. Form origin = the web-inquiry
       contact event lead-intake records at creation. */
    // deno-lint-ignore no-explicit-any
    const webInquiry = Array.isArray(l.contact_events)
      && l.contact_events.some((e: any) => e?.channel === 'web' && e?.outcome === 'inquiry')
    if (!l.ack_sent_at && age <= 12 && webInquiry) {
      if (!sw.ack) { plan.paused_ack.push(`${first} (${Math.round(age)}h old)`); out.paused_ack++; continue }
      plan.acknowledge.push(`${first} (${Math.round(age)}h old)`)
      if (!dry && !quiet) {
        /* her words (2026-10-07), the same as lead-intake's open-hours acknowledgment (this retry only runs in hours) */
        const line = `Hi ${first}, this is Caring Companions. Thank you for reaching out about care. We received your request, ` +
          `and a Care Coordinator will be calling you shortly to learn more about how we can help. ` +
          `If you need to reach us sooner, please call ${OFFICE}. Reply STOP to opt out.`
        if (await reach(line, 'We received your request',
          `<p>Hi ${first},</p><p>Thank you for reaching out about care. We received your request, and a Care Coordinator ` +
          `will be calling you shortly to learn more about how we can help.</p>` +
          `<p>If you need to reach us sooner, please call <b>${OFFICE}</b>.</p>` +
          `<p>There is nothing you need to do in the meantime.</p>`)) {
          l.ack_sent_at = new Date().toISOString()
          if (l.phone) ldPush(l, { channel: 'sms', direction: 'out', outcome: 'sent', actor: 'automation', note: 'acknowledgment' })
          if (l.email) ldPush(l, { channel: 'email', direction: 'out', outcome: 'sent', actor: 'automation', note: 'acknowledgment' })
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
      if (!sw.followups) { plan.paused_followups.push(`${first} (try ${step})`); out.paused_followups++; continue }
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
          if (l.phone) ldPush(l, { channel: 'sms', direction: 'out', outcome: 'sent', actor: 'automation', note: 'nudge ' + step })
          if (l.email) ldPush(l, { channel: 'email', direction: 'out', outcome: 'sent', actor: 'automation', note: 'nudge ' + step })
          await put(l); out.nudged++
        }
      }
      continue
    }

  }

  const switches = { inquiry_ack_live: sw.ack, inquiry_followups_live: sw.followups, settings_read: sw.read_ok }
  return json(dry
    ? { ok: true, dry: true, quiet_hours: quiet, switches, leads_considered: leads.length, would: plan }
    : { ok: true, quiet_hours: quiet, switches, ...out })
})
