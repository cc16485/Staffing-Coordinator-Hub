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

  const { ids, message, slug, dry } = await req.json().catch(() => ({}))
  if (!Array.isArray(ids) || !ids.length) return json({ error: 'no applicants given' }, 400)
  if (!message || !String(message).trim()) return json({ error: 'no message given' }, 400)

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
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
    .not('status', 'in', '("declined","hired")')
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

  let sent = 0
  for (const p of eligible) {
    if (!ghlToken || !ghlLocation) break
    const first = p.first_name || 'there'
    const applyUrl = 'https://mo-care.com/apply?book=' + encodeURIComponent(String(p.id))
    const body = `Hi ${first}, ${String(message).trim()}`
    try {
      const up = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
        method: 'POST', headers: h,
        body: JSON.stringify({ locationId: ghlLocation, ...(p.phone ? { phone: p.phone } : {}),
          ...(p.email ? { email: p.email } : {}), firstName: first }),
      })
      const uj = await up.json().catch(() => ({}))
      const contactId = uj?.contact?.id ?? uj?.id
      if (!contactId) continue

      if (p.phone && p.sms_consent === true) {
        await fetch('https://services.leadconnectorhq.com/conversations/messages', {
          method: 'POST', headers: h,
          body: JSON.stringify({ type: 'SMS', contactId,
            message: `${body} ${applyUrl} Reply STOP to hear no more from us.` }),
        })
      }
      if (p.email) {
        await fetch('https://services.leadconnectorhq.com/conversations/messages', {
          method: 'POST', headers: h,
          body: JSON.stringify({ type: 'Email', contactId,
            subject: 'A new opening at Caring Companions',
            html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#1f2a36">` +
              `<p>Hi ${first},</p><p>${String(message).trim()}</p>` +
              `<p><a href="${applyUrl}" style="background:#F0A63A;color:#122F52;text-decoration:none;` +
              `padding:12px 20px;border-radius:8px;font-weight:700;display:inline-block">Pick an interview time</a></p>` +
              `<p style="color:#57606a;font-size:13px">You applied with us before, which is why we thought of you. ` +
              `If you would rather we did not get in touch again, just reply and say so.</p>` +
              `<p style="color:#57606a">Caring Companions In-Home Senior Care<br>${phone}</p></div>` }),
        })
      }
      await supabase.from('job_applicants').update({
        reengaged_at: new Date().toISOString(),
        reengage_count: (p.reengage_count ?? 0) + 1,
      }).eq('id', p.id)
      sent++
    } catch { /* one failure must not stop the rest */ }
  }

  return json({ ok: true, sent, of: ids.length, skipped: ids.length - eligible.length })
})
