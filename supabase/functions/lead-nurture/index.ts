// Supabase Edge Function: lead-nurture (shared hub project)
// The overnight hustle: pre-approved drip sequences for leads, sent through
// GoHighLevel by a daily cron (10 AM Central). Two sequences:
//   not_ready      — gentle 4-touch drip for "not ready yet" families
//   lost_reengage  — one warm check-in 90 days after a lead was lost
// A human explicitly starts every enrollment from the CC Hub. Sends STOP
// automatically when the person replies (any inbound GHL message) or the
// lead converts. Messages appear in the lead's hub timeline like any other.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const OFFICE = '(417) 234-8494'
type Step = { day: number; channel: 'sms' | 'email'; subject?: string; text: string }
const SEQUENCES: Record<string, Step[]> = {
  not_ready: [
    { day: 3, channel: 'sms', text:
      `Hi {first}, it's Caring Companions. No pressure at all — just wanted you to know we're here whenever the timing feels right. Questions big or small, call or text ${OFFICE}. (Reply STOP to opt out.)` },
    { day: 10, channel: 'email', subject: '5 questions to ask any home care agency', text:
      `Hi {first},\n\nWhen you were looking into care, we promised not to pester you — so just one genuinely useful thing. Whoever you end up choosing, these five questions separate great agencies from the rest:\n\n1. Are your caregivers employees (insured, background-checked, trained) — or contractors?\n2. What training do caregivers get before their first shift, and every year after?\n3. How do you match a caregiver to my family — and what if it's not a good fit?\n4. Who do I call at 9 PM on a Saturday if something goes wrong?\n5. How do you keep family in the loop between visits?\n\nWe're proud of our answers to all five, and happy to share them anytime: ${OFFICE}.\n\nWarmly,\nThe Caring Companions team` },
    { day: 21, channel: 'sms', text:
      `Hi {first}, Caring Companions checking in — families often tell us things change quickly. If it would help to talk through options for care at home (even just questions), we're at ${OFFICE}.` },
    { day: 45, channel: 'email', subject: "Still here when your family needs us", text:
      `Hi {first},\n\nJust a note to say we're still here. Whether it's a few hours a week of help with meals and errands, or more hands-on care, we'd be honored to help when the time is right — and if the time is never, that's okay too.\n\nCall or text anytime: ${OFFICE}.\n\nWarmly,\nThe Caring Companions team` },
  ],
  lost_reengage: [
    { day: 90, channel: 'sms', text:
      `Hi {first}, it's Caring Companions — we spoke a while back about care for your family. Circumstances change, so I wanted to check in and see how things are going. If we can help now, we'd love to: call or text ${OFFICE}. (Reply STOP to opt out.)` },
  ],
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const ghlToken = Deno.env.get('GHL_TOKEN')
  const ghlLocation = Deno.env.get('GHL_LOCATION_ID')
  if (!ghlToken || !ghlLocation) return json({ error: 'GHL not configured' }, 500)
  const sendH = { Authorization: `Bearer ${ghlToken}`, Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' }
  const readH = { Authorization: `Bearer ${ghlToken}`, Version: '2021-04-15', Accept: 'application/json' }

  const { data: row } = await supabase.from('app_data').select('data').eq('key', 'leads').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const leads: any[] = Array.isArray(row?.data) ? row!.data : []
  let sent = 0, stopped = 0, completed = 0
  // deno-lint-ignore no-explicit-any
  const save = (l: any) => supabase.rpc('upsert_app_data_item', { target_key: 'leads', item: l })

  for (const l of leads) {
    const seq = SEQUENCES[l.nurture_sequence as string]
    if (!seq || l.nurture_stopped_at || !l.nurture_started_at) continue
    // Converting always stops a drip; a lost lead only continues on lost_reengage.
    if (l.status === 'Converted' || (l.status === 'Lost' && l.nurture_sequence !== 'lost_reengage')) {
      l.nurture_stopped_at = new Date().toISOString(); l.nurture_stop_reason = 'status changed'
      await save(l); stopped++; continue
    }
    const stepIdx = l.nurture_step ?? 0
    if (stepIdx >= seq.length) continue
    const daysIn = (Date.now() - new Date(l.nurture_started_at).getTime()) / 86400000
    const step = seq[stepIdx]
    if (daysIn < step.day) continue

    // Find their GHL contact and STOP if they've messaged us since enrollment.
    if (!l.phone && !l.email) continue
    let contactId: string | null = null
    try {
      const up = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
        method: 'POST', headers: sendH,
        body: JSON.stringify({
          locationId: ghlLocation,
          ...(l.phone ? { phone: l.phone } : {}), ...(l.email ? { email: l.email } : {}),
          firstName: l.first_name, lastName: l.last_name,
        }),
      })
      const upJson = await up.json().catch(() => ({}))
      contactId = upJson?.contact?.id ?? upJson?.id ?? null
    } catch { continue }
    if (!contactId) continue
    try {
      const cr = await fetch(
        `https://services.leadconnectorhq.com/conversations/search?locationId=${ghlLocation}&contactId=${encodeURIComponent(contactId)}&limit=5`,
        { headers: readH },
      )
      const cj = await cr.json().catch(() => ({}))
      // deno-lint-ignore no-explicit-any
      const repliedSince = (cj?.conversations ?? []).some((c: any) =>
        c.lastMessageDirection === 'inbound' &&
        c.lastMessageDate && new Date(c.lastMessageDate).getTime() > new Date(l.nurture_started_at).getTime())
      if (repliedSince) {
        l.nurture_stopped_at = new Date().toISOString(); l.nurture_stop_reason = 'they replied — human takes over'
        await save(l); stopped++; continue
      }
    } catch { /* if the check fails, err on NOT sending */ continue }

    const text = step.text.replace(/{first}/g, l.first_name || 'there')
    let ok = false
    try {
      if (step.channel === 'sms' && l.phone) {
        const r = await fetch('https://services.leadconnectorhq.com/conversations/messages', {
          method: 'POST', headers: sendH,
          body: JSON.stringify({ type: 'SMS', contactId, message: text }),
        })
        ok = r.ok
      } else if (step.channel === 'email' && l.email) {
        const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1f2a36;line-height:1.7;max-width:600px">` +
          text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>') + `</div>`
        const r = await fetch('https://services.leadconnectorhq.com/conversations/messages', {
          method: 'POST', headers: sendH,
          body: JSON.stringify({ type: 'Email', contactId, subject: step.subject ?? 'From Caring Companions', html }),
        })
        ok = r.ok
      } else {
        ok = true // channel missing (no phone or no email) — skip the step but keep the sequence moving
      }
    } catch { /* leave ok=false; retry tomorrow */ }
    if (ok) {
      l.nurture_step = stepIdx + 1
      l.nurture_last_sent_at = new Date().toISOString()
      if (l.nurture_step >= seq.length) { l.nurture_stopped_at = l.nurture_last_sent_at; l.nurture_stop_reason = 'sequence completed'; completed++ }
      await save(l); sent++
    }
  }
  return json({ status: 'done', sent, stopped, completed })
})
