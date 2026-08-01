// Supabase Edge Function: reference-chase  (shared hub project)
// -----------------------------------------------------------------------------
// A reference who never answers used to look exactly like a reference who was
// never asked. This makes silence visible and then acts on it.
//
//   2 days quiet  → one reminder to the reference, sent once
//   5 days quiet  → stop asking, and tell the office to pick up the phone
//
// Deliberately one reminder, not a drip. These are strangers doing us a favour,
// and a second nag costs more goodwill than it recovers. After that it is a
// person's job, which is what the escalation says.
//
// Runs daily by pg_cron. Supports ?dry=1 to report without sending.
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const NUDGE_AFTER_DAYS = 2
const GIVE_UP_AFTER_DAYS = 5
const daysSince = (iso: string | null) => iso ? (Date.now() - new Date(iso).getTime()) / 86400_000 : 0

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const dry = new URL(req.url).searchParams.get('dry') === '1'

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: open, error } = await supabase
    .from('reference_requests')
    .select('*')
    .is('responded_at', null)
    .not('sent_at', 'is', null)
  if (error) return json({ error: error.message }, 500)
  if (!open?.length) return json({ ok: true, dry, nudged: 0, escalated: 0, note: 'nothing outstanding' })

  const ghlToken = Deno.env.get('GHL_TOKEN')
  const ghlLocation = Deno.env.get('GHL_LOCATION_ID')
  const h = {
    Authorization: `Bearer ${ghlToken}`,
    Version: '2021-07-28',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }

  const contactFor = async (phone: string | null, email: string | null, first: string) => {
    const up = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
      method: 'POST', headers: h,
      body: JSON.stringify({ locationId: ghlLocation, ...(phone ? { phone } : {}), ...(email ? { email } : {}), firstName: first }),
    })
    const uj = await up.json().catch(() => ({}))
    return uj?.contact?.id ?? uj?.id ?? null
  }

  // deno-lint-ignore no-explicit-any
  const toNudge: any[] = [], toEscalate: any[] = []
  for (const r of open) {
    const quiet = daysSince(r.sent_at)
    if (quiet >= GIVE_UP_AFTER_DAYS) toEscalate.push(r)
    else if (quiet >= NUDGE_AFTER_DAYS && !r.reminded_at) toNudge.push(r)
  }

  if (dry) {
    return json({
      ok: true, dry: true,
      would_nudge: toNudge.map((r) => `${r.ref_name} (for ${r.candidate_name})`),
      would_escalate: toEscalate.map((r) => `${r.ref_name} (for ${r.candidate_name})`),
    })
  }

  let nudged = 0
  for (const r of toNudge) {
    if (!ghlToken || !ghlLocation || (!r.ref_phone && !r.ref_email)) continue
    const url = `https://cc.mo-care.com/reference.html?r=${encodeURIComponent(r.id)}` +
      `&c=${encodeURIComponent(r.candidate_name)}&n=${encodeURIComponent(r.ref_name ?? '')}`
    const line = `Hi ${r.ref_name ?? 'there'}, a gentle nudge from Caring Companions. ` +
      `${r.candidate_name} is waiting on one reference to start work, and yours is the last one. ` +
      `Two minutes: ${url} Thank you!`
    try {
      const contactId = await contactFor(r.ref_phone, r.ref_email, r.ref_name ?? 'Reference')
      if (!contactId) continue
      if (r.ref_phone) {
        await fetch('https://services.leadconnectorhq.com/conversations/messages', {
          method: 'POST', headers: h,
          body: JSON.stringify({ type: 'SMS', contactId, message: line }),
        })
      }
      if (r.ref_email) {
        await fetch('https://services.leadconnectorhq.com/conversations/messages', {
          method: 'POST', headers: h,
          body: JSON.stringify({
            type: 'Email', contactId,
            subject: `A quick reference for ${r.candidate_name}`,
            html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#1f2a36">` +
              `<p>Hi ${r.ref_name ?? 'there'},</p><p>A gentle nudge. ${r.candidate_name} is waiting on one ` +
              `reference before they can start, and yours is the last one we need.</p>` +
              `<p><a href="${url}" style="background:#F0A63A;color:#122F52;text-decoration:none;padding:12px 20px;` +
              `border-radius:8px;font-weight:700;display:inline-block">Answer five quick questions</a></p>` +
              `<p style="color:#57606a">Thank you, it genuinely helps.<br>Caring Companions In-Home Senior Care</p></div>`,
          }),
        })
      }
      await supabase.from('reference_requests')
        .update({ reminded_at: new Date().toISOString(), reminder_count: (r.reminder_count ?? 0) + 1 })
        .eq('id', r.id)
      nudged++
    } catch { /* one failure must not stop the rest */ }
  }

  // Escalation lands in the hub's own queue, where late work already lives.
  let escalated = 0
  if (toEscalate.length) {
    const { data: row } = await supabase.from('app_data').select('data').eq('key', 'ops_items').maybeSingle()
    // deno-lint-ignore no-explicit-any
    const items: any[] = Array.isArray(row?.data) ? row!.data : []
    for (const r of toEscalate) {
      const sourceId = 'ref_' + r.id
      if (items.some((i) => i.source_id === sourceId)) continue
      items.push({
        id: 'ops_' + sourceId, kind: 'request', source_id: sourceId,
        title: `Reference has not replied: ${r.ref_name ?? 'reference'} for ${r.candidate_name}`,
        detail: `Asked ${Math.floor(daysSince(r.sent_at))} days ago and reminded once. ` +
          `Time to call them${r.ref_phone ? ' on ' + r.ref_phone : ''}. ` +
          `Their answers can still be recorded by hand on the candidate.`,
        about: r.candidate_name, urgency: 'normal', status: 'open',
        created_at: new Date().toISOString(),
        due: new Date(Date.now() + 24 * 3600_000).toISOString(),
        owner: '', owner_name: '', created_by: 'reference chase', opened_by: 'system',
      })
      escalated++
    }
    if (escalated) {
      await supabase.from('app_data')
        .upsert({ key: 'ops_items', data: items, updated_at: new Date().toISOString() })
    }
  }

  return json({ ok: true, outstanding: open.length, nudged, escalated })
})
