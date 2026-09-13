// Supabase Edge Function: coverage-reply  (shared hub project)
// -----------------------------------------------------------------------------
// The other half of the callout loop (replacing CareQB Callouts): a caregiver
// texts back and the answer lands on the coverage case.
//
// A GHL Workflow (trigger: Customer Replied, filtered to contacts tagged
// `coverage-asked`) POSTs here, gated by ?token=COVERAGE_REPLY_TOKEN:
//   { id: contactId, phone, name, message }   (message LAST — GHL substitution)
//
// What happens to a reply:
//   YES     first yes on the case wins: the case records pending_fill, an
//           URGENT ops item tells the office "confirm & assign in AxisCare",
//           and the caregiver gets an instant "got it — the office will
//           confirm with you shortly". A later yes after someone already won
//           gets an honest "someone beat you to it — thank you!".
//   NO      recorded. No reply text (a decline answered feels like pressure).
//   other   recorded as an INQUIRY and raised as an ops item with their exact
//           words, so a human answers the question — never a robot.
//
// NOTHING here assigns a shift. AI proposes, a person disposes: the office
// confirms the fill in the hub and updates AxisCare. asked[] is the one
// record; the hub board reads the same field the manual workflow writes.
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
const norm = (p: string) => String(p || '').replace(/\D/g, '').slice(-10)

async function sms(contactId: string, message: string): Promise<boolean> {
  const token = Deno.env.get('GHL_TOKEN')
  if (!token || !contactId) return false
  try {
    const r = await fetch('https://services.leadconnectorhq.com/conversations/messages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'SMS', contactId, message }),
    })
    return r.ok
  } catch { return false }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200 })
  const url = new URL(req.url)
  const expected = Deno.env.get('COVERAGE_REPLY_TOKEN')
  if (!expected || url.searchParams.get('token') !== expected) return json({ error: 'unauthorized' }, 401)

  // GHL merge-field substitution can break JSON when the message carries
  // quotes/newlines — same defensive parse as the other phone functions.
  const raw = await req.text()
  // deno-lint-ignore no-explicit-any
  let b: Record<string, any> = {}
  try { b = JSON.parse(raw) } catch {
    const grab = (k: string) => (raw.match(new RegExp('"' + k + '"\\s*:\\s*"([^"]*)"')) || [])[1] || ''
    b = { id: grab('id'), phone: grab('phone'), name: grab('name') }
    const m = raw.match(/"message"\s*:\s*([\s\S]*)\}\s*$/)
    if (m) b.message = m[1].trim().replace(/^"/, '').replace(/",?$/, '').trim()
  }
  const field = (k: string) => {
    const v = typeof b[k] === 'string' ? String(b[k]).trim() : ''
    return v.includes('{{') ? '' : v
  }
  const phone = field('phone')
  const contactId = field('id') || field('contactId') || field('contact_id')
  const text = field('message') || field('body') || field('text')
  const digits = norm(phone)
  if (!text) return json({ ok: true, routed: 'no message text — nothing to record' })

  // Which callout is this an answer to? The newest open case where this
  // phone (or contact) was auto-asked and hasn't answered yet — else the
  // newest open case that asked them at all (people change their minds).
  const { data: row } = await sb.from('app_data').select('data').eq('key', 'coverage_cases').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const cases: any[] = Array.isArray(row?.data) ? row!.data : []
  // deno-lint-ignore no-explicit-any
  const matches: Array<{ c: any; a: any }> = []
  for (const c of cases) {
    if (c?.status !== 'open') continue
    for (const a of (Array.isArray(c.asked) ? c.asked : [])) {
      if (a.auto !== true) continue
      const hit = (digits && norm(String(a.phone || '')) === digits) ||
                  (contactId && String(a.ghl_contact_id || '') === contactId)
      if (hit) matches.push({ c, a })
    }
  }
  matches.sort((x, y) => new Date(String(y.a.at || 0)).getTime() - new Date(String(x.a.at || 0)).getTime())
  const m = matches.find(x => x.a.state === 'waiting') ?? matches[0]
  if (!m) return json({ ok: true, routed: 'no open callout asked this number — nothing to attach to' })
  const { c, a } = m

  /* CLASSIFICATION, negation first. "I can't I don't have a baby sitter
     sorry" was read as YES because /i can/ matched the front of "can't"
     (the apostrophe passes a word boundary) — Dixie Kuhn, first live
     callout. Rules now: any negation wording makes it a NO no matter how it
     starts; YES needs a clean affirmative with no negation anywhere; and
     anything unclear goes to a HUMAN as a question — a wrong "inquiry" costs
     a minute, a wrong YES freezes the callout and lies to the caregiver. */
  const t = text.toLowerCase()
  const hasNeg = /(can'?t|cannot|can\s+not|won'?t|unable|not able|no way|i'?m not|don'?t think)/.test(t)
  const isYes = !hasNeg && (
    /^\s*(y|yes|yeah|yep|yea|sure|absolutely|definitely|of course)\b/.test(t) ||
    /\b(i'?ll take|i can take|i can cover|i can do|i'?ll cover|i'?ll do it|count me in|i'?m available|works for me)\b/.test(t))
  const isNo = hasNeg ||
    /^\s*(n|no|nope|nah|sorry)\b/.test(t) ||
    /\b(pass|not this time|next time)\b/.test(t)
  const stamp = new Date().toISOString()
  a.replied_at = stamp
  a.reply = text.slice(0, 500)

  let routed = ''
  if (isYes) {
    const alreadyWon = c.pending_fill && c.pending_fill.name !== a.name
    a.state = 'yes'
    if (alreadyWon) {
      routed = 'yes — but someone already won'
      await sms(contactId || a.ghl_contact_id, `Thank you ${a.name.split(' ')[0]}! Someone grabbed it just before you — we really appreciate you answering. Next one's yours.`)
    } else {
      c.pending_fill = { name: a.name, phone: a.phone, at: stamp }
      routed = 'YES — first in, office prompted to confirm'
      await sms(contactId || a.ghl_contact_id, `Got it, ${a.name.split(' ')[0]} — thank you! The office will confirm with you shortly.`)
      await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: {
        id: `ops_covfill_${c.id}`, kind: 'coverage', coverage_case_id: c.id,
        title: `${a.name} can cover ${c.client || 'the shift'} — confirm & assign in AxisCare`,
        about: c.client || '', detail: `Replied "${text.slice(0, 120)}" at ${stamp.slice(11, 16)}Z. Confirm with them, assign the visit in AxisCare, then mark the case covered.`,
        domain: 'scheduling_coverage', status: 'open', urgency: 'high',
        created_at: stamp, due: new Date(Date.now() + 3600000).toISOString(),
        owner: '', owner_name: '', created_by: 'coverage-reply', opened_by: 'callout',
      } })
    }
  } else if (isNo) {
    a.state = 'no'
    routed = 'no — recorded'
    /* If the person we thought said yes now says no, the callout must
       UN-freeze: clear the pending fill so waves resume next tick. */
    if (c.pending_fill && String(c.pending_fill.name).toLowerCase() === String(a.name).toLowerCase()) {
      delete c.pending_fill
      routed = 'no — pending fill cleared, waves resume'
    }
  } else {
    a.state = 'inquiry'
    routed = 'inquiry — raised for a human to answer'
    await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: {
      id: `ops_covq_${c.id}_${norm(String(a.phone || contactId))}`, kind: 'coverage',
      coverage_case_id: c.id,
      title: `${a.name} has a question about the ${c.client || ''} callout`,
      about: a.name, detail: `They wrote: "${text.slice(0, 300)}" — answer them by text, then update the case.`,
      domain: 'scheduling_coverage', status: 'open', urgency: 'high',
      created_at: stamp, due: new Date(Date.now() + 2 * 3600000).toISOString(),
      owner: '', owner_name: '', created_by: 'coverage-reply', opened_by: 'callout',
    } })
  }

  await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: c })
  return json({ ok: true, routed, case_id: c.id, caregiver: a.name, state: a.state })
})
