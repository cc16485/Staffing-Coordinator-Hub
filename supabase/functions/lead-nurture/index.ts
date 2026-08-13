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
  /* The long game. Home care is rarely decided in a fortnight: families enquire
     in March and buy in September, or after a fall, or after a discharge. The
     not_ready drip ran out at day 45 and then went quiet forever, which is the
     window most of these decisions actually get made in.

     So this is thirteen months at roughly six-week spacing, email only, and
     every one of them sends something genuinely useful from our own library
     rather than asking how they are getting on. Nobody resents a fall
     prevention checklist. Everybody resents a seventh "just checking in".

     If they never come back to us, they still got help. That is the deal. */
  long_term: [
    { day: 60, channel: 'email', subject: 'A room-by-room home safety check', text:
      `Hi {first},\n\nWe said we would not pester you, so this is not a sales note. It is the checklist our own coordinators use on a first visit, room by room, and most families find two or three things on it they had not thought of.\n\nhttps://mo-care.com/guides/home-safety-room-by-room\n\nUse it yourself, share it with a sibling, ignore it entirely. We are on ${OFFICE} if you ever want to talk.\n\nWarmly,\nThe Caring Companions team` },

    { day: 105, channel: 'email', subject: 'What care actually costs around here', text:
      `Hi {first},\n\nOne of the hardest parts of this is that nobody will give you a straight number. So here is ours: a calculator that shows what home care costs in southwest Missouri, next to what a facility costs, with no email required to see it.\n\nhttps://mo-care.com/cost-calculator\n\nAnd if the money is the obstacle, this is worth ten minutes: https://mo-care.com/paying-for-care\n\nWarmly,\nThe Caring Companions team` },

    { day: 150, channel: 'email', subject: 'If you are the one doing the caring', text:
      `Hi {first},\n\nWhen a family looks into care and then does not move forward, it is usually because somebody in the family took it on themselves. Often that is the person reading this.\n\nSo this one is for you rather than for them: the signs of caregiver burnout, and what actually helps.\n\nhttps://mo-care.com/guides/caregiver-burnout\n\nAsking for a few hours of help a week is not giving up. It is how people last.\n\nWarmly,\nThe Caring Companions team` },

    { day: 200, channel: 'email', subject: 'The thing that changes everything is usually a fall', text:
      `Hi {first},\n\nIn our experience the moment families call is rarely a decision. It is a fall.\n\nThis is what we would check to make one less likely, and it costs nothing to do this weekend.\n\nhttps://mo-care.com/guides/fall-prevention-at-home\n\nWarmly,\nThe Caring Companions team` },

    { day: 260, channel: 'email', subject: 'Help paying for care in Missouri', text:
      `Hi {first},\n\nTwo things families routinely do not know they qualify for.\n\nMissouri Medicaid can cover in-home care, and the rules are not as narrow as most people assume: https://mo-care.com/guides/missouri-medicaid-hcbs\n\nAnd if there is a veteran in the family, the VA benefit is real money that very few people claim: https://mo-care.com/guides/va-benefits-for-home-care\n\nWe will help you work out whether either applies, whether or not you ever use us. ${OFFICE}.\n\nWarmly,\nThe Caring Companions team` },

    { day: 320, channel: 'email', subject: 'When the family does not agree', text:
      `Hi {first},\n\nOne sibling thinks it is too soon. Another thinks it is overdue. Nobody wants to be the one who decides.\n\nThis is the planner we give families for that conversation: what to cover, in what order, and how to end it with something written down.\n\nhttps://mo-care.com/family-meeting-planner\n\nWarmly,\nThe Caring Companions team` },

    { day: 400, channel: 'email', subject: 'Still here', text:
      `Hi {first},\n\nIt has been about a year since you first got in touch, so this is the last note you will get from us unless you ask for more.\n\nEverything we have is free to use whether or not you ever call: https://mo-care.com/decision-center\n\nAnd if the time has come, we would be honoured to help. ${OFFICE}.\n\nWarmly,\nThe Caring Companions team` },
  ],

  lost_reengage: [
    { day: 90, channel: 'sms', text:
      `Hi {first}, it's Caring Companions — we spoke a while back about care for your family. Circumstances change, so I wanted to check in and see how things are going. If we can help now, we'd love to: call or text ${OFFICE}. (Reply STOP to opt out.)` },
  ],
}

/* OUTREACH HOURS — 8am to 6pm, America/Chicago.
   Samantha's rule: nothing we send automatically may land before 8 or after 6.
   Enforced at the entry point rather than at each send site, so a message type
   added later cannot forget it. Nothing is marked as sent, so anything skipped
   goes out on the next run inside the window. */
const OUTREACH_TZ = 'America/Chicago'
function withinOutreachHours() {
  const h = Number(new Date().toLocaleString('en-US', { timeZone: OUTREACH_TZ, hour: '2-digit', hour12: false }))
  return h >= 8 && h < 18
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const dryRun = new URL(req.url).searchParams.get('dry') === '1'
  if (!dryRun && !withinOutreachHours())
    return json({ ok: true, skipped: 'outside outreach hours (8am-6pm America/Chicago)' })
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
      if (l.nurture_step >= seq.length) {
        /* The short drip used to stop at day 45 and go quiet forever, which is
           the exact window most of these decisions get made in. It now rolls
           into the long game, keeping the original enrolment date so the day
           numbers carry straight on and the next note lands at day 60. Nobody
           has to remember to move anybody across. */
        if (l.nurture_sequence === 'not_ready') {
          l.nurture_sequence = 'long_term'
          l.nurture_step = 0
          l.nurture_rolled_at = new Date().toISOString()
        } else {
          l.nurture_stopped_at = l.nurture_last_sent_at
          l.nurture_stop_reason = 'sequence completed'
          completed++
        }
      }
      await save(l); sent++
    }
  }
  return json({ status: 'done', sent, stopped, completed })
})
