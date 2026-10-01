// Supabase Edge Function: applicant-reengage  (shared hub project)
// -----------------------------------------------------------------------------
// Tells past applicants about a new opening.
//
// This is the reason for keeping everyone who ever applied. Somebody who was
// right but early is the cheapest hire the agency will ever make: they already
// know who we are, they already cleared the screen, and reaching them costs a
// message instead of a month of job-board spend.
//
// Called from the hub with an explicit list of ids, so a person chose who gets
// this. It is not a drip and it is not automatic.
//
// Guards, because this is outbound marketing to people who applied for a job:
//   • texts only to those who ticked the consent box, with STOP wording
//   • nobody contacted twice inside 30 days, re-checked here rather than
//     trusting the caller's list
//   • anyone declined, hired, or with a booked interview is skipped
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { outreachGate } from '../_shared/outreach.ts'
import { ghlContactIfAllowed } from '../_shared/optout.ts'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { ghlSendChecked, reportSendProblem } from '../_shared/send-problems.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  /* proactive_external: we start this, so weekdays only, 8am-6pm.
     Policy lives in _shared/outreach.ts. */
  const gate = outreachGate(req, 'proactive_external', json)
  if (gate) return gate
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  /* 0b-3: this texts applicants a message the CALLER writes, so the caller must be a signed-in office staff member
     (it trusted anyone before), checked before anything is read or sent. */
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const who = await requireStaff(supabase, req, OFFICE_ROLES)
  if (!who.ok) return json({ error: who.error }, who.status)

  const { ids, message, slug, dry } = await req.json().catch(() => ({}))
  if (!Array.isArray(ids) || !ids.length) return json({ error: 'no applicants given' }, 400)
  if (!message || !String(message).trim()) return json({ error: 'no message given' }, 400)

  const ghlToken = Deno.env.get('GHL_TOKEN')
  const ghlLocation = Deno.env.get('GHL_LOCATION_ID')

  const { data: st } = await supabase.from('scheduling_settings').select('phone').eq('id', 1).maybeSingle()
  const phone = st?.phone ?? '(417) 234-8494'
  // Link per-recipient below. Everyone here already applied and has no booked
  // interview (booked are filtered out), so the right next step for each is the
  // time-picker for THEIR application, not a fresh /apply form. `slug` is no
  // longer used for the link — the booking page does not need a job.
  void slug

  // Never trust the caller's filtering for something that leaves the building.
  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const { data: people, error } = await supabase
    .from('job_applicants')
    .select('*')
    .in('id', ids.slice(0, 500))
    // 'offer' means they already said yes and may be mid-paperwork — a "new
    // opening" text to them reads as us forgetting we hired them.
    .not('status', 'in', '("declined","hired","offer")')
    .is('decline_reason', null)
    .or(`reengaged_at.is.null,reengaged_at.lt.${cutoff}`)
  if (error) return json({ error: error.message }, 500)

  const { data: booked } = await supabase
    .from('interview_bookings').select('applicant_id').eq('status', 'booked')
  const hasInterview = new Set((booked ?? []).map((b) => b.applicant_id))

  const eligible = (people ?? []).filter((p) =>
    !hasInterview.has(p.id) && p.age_ok !== false && p.work_auth !== false && p.has_transport !== false &&
    (p.phone || p.email))

  if (dry) return json({ ok: true, dry: true, would_reach: eligible.length,
    skipped: (ids.length - eligible.length), by_text: eligible.filter((p) => p.phone && p.sms_consent).length })

  const h = {
    Authorization: `Bearer ${ghlToken}`, Version: '2021-07-28',
    'Content-Type': 'application/json', Accept: 'application/json',
  }

  /* NO SILENT FAILURES (2026-10-01): the Hub used to hear only "sent N". Now every text or email GoHighLevel refuses
     raises a Needs Attention card (ghlSendChecked), a text that failed beside an email that went is no longer hidden
     inside "reached", and the answer lists who was not reached and why. Nothing about who gets it or when changed. */
  if (eligible.length && (!ghlToken || !ghlLocation)) return json({ ok: false, error: 'Sending is not set up on the server. Nothing was sent.', sent: 0 }, 500)
  let sent = 0
  const notSent: string[] = []
  for (const p of eligible) {
    if (!ghlToken || !ghlLocation) break
    const name = [p.first_name, p.last_name].filter(Boolean).join(' ') || 'an applicant'
    const first = p.first_name || 'there'
    const applyUrl = 'https://mo-care.com/apply?book=' + encodeURIComponent(String(p.id))
    const body = `Hi ${first}, ${String(message).trim()}`
    try {
      /* 0b-3: each channel through the universal opt-out door, one GHL contact per channel */
      const ghlDoor = { token: ghlToken, locationId: ghlLocation }
      let reached = false
      if (p.phone && p.sms_consent === true) {
        const cid = await ghlContactIfAllowed(supabase, ghlDoor, 'applicant-reengage', { channel: 'sms', phone: p.phone, email: p.email, firstName: first })
        if (cid) {
          const ok = await ghlSendChecked(supabase, h, 'applicant-reengage', { channel: 'sms', contactId: cid, address: p.phone, who: name },
            { message: `${body} ${applyUrl} Reply STOP to hear no more from us.` })
          if (!ok) notSent.push(name + ': text refused')
          reached = reached || ok
        } else notSent.push(name + ': text held back (opted out, or could not check)')
      }
      const eid = p.email ? await ghlContactIfAllowed(supabase, ghlDoor, 'applicant-reengage', { channel: 'email', email: p.email, phone: p.phone, firstName: first }) : null
      if (eid) {
        const ok = await ghlSendChecked(supabase, h, 'applicant-reengage', { channel: 'email', contactId: eid, address: p.email, who: name }, {
            subject: 'A new opening at Caring Companions',
            html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#1f2a36">` +
              `<p>Hi ${first},</p><p>${String(message).trim()}</p>` +
              `<p><a href="${applyUrl}" style="background:#F0A63A;color:#122F52;text-decoration:none;` +
              `padding:12px 20px;border-radius:8px;font-weight:700;display:inline-block">Pick an interview time</a></p>` +
              `<p style="color:#57606a;font-size:13px">You applied with us before, which is why we thought of you. ` +
              `If you would rather we did not get in touch again, just reply and say so.</p>` +
              `<p style="color:#57606a">Caring Companions In-Home Senior Care<br>${phone}</p></div>` })
        if (!ok) notSent.push(name + ': email refused')
        reached = reached || ok
      } else if (p.email) notSent.push(name + ': email held back (opted out, or could not check)')
      if (!reached) continue
      await supabase.from('job_applicants').update({
        reengaged_at: new Date().toISOString(),
        reengage_count: (p.reengage_count ?? 0) + 1,
      }).eq('id', p.id)
      sent++
    } catch (e) {  /* one failure must not stop the rest, but it is not silent either */
      notSent.push(name + ': something went wrong')
      await reportSendProblem(supabase, { sender: 'applicant-reengage', channel: p.phone && p.sms_consent === true ? 'sms' : 'email',
        address: p.phone && p.sms_consent === true ? p.phone : p.email, who: name,
        reasons: ['error: ' + String((e as Error)?.message ?? e).slice(0, 100)], failed: true })
    }
  }

  return json({ ok: notSent.length === 0, sent, of: ids.length, skipped: ids.length - eligible.length,
    not_reached: eligible.length - sent, not_sent: notSent.slice(0, 50),
    ...(notSent.length ? { error: `${notSent.length} message${notSent.length === 1 ? '' : 's'} did not go out; each one is on Needs Attention.` } : {}) })
})
