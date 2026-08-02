// Supabase Edge Function: circle-send  (shared hub project)
// -----------------------------------------------------------------------------
// Tells a client's family circle one thing, at the same moment.
//
// Not a group SMS thread. Everyone gets the same message at once, which is the
// bit families actually want, and replies come back to the office line, which
// is what "call us if you have questions" means. It also keeps the record here
// under the client's name instead of unlabelled in a Conversations list, which
// was the whole complaint.
//
// Who hears what is per person: a daughter who wants every caregiver change and
// a son who only wants the big news are both normal, so a 'change' message only
// goes to those who asked for changes.
//
// Texts require consent, as everywhere else. Email does not, so anyone with an
// address hears regardless.
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const { circle_id, kind = 'update', body, sent_by, dry } = await req.json().catch(() => ({}))
  if (!circle_id) return json({ error: 'no circle given' }, 400)
  if (!body || !String(body).trim()) return json({ error: 'no message given' }, 400)

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const ghlToken = Deno.env.get('GHL_TOKEN')
  const ghlLocation = Deno.env.get('GHL_LOCATION_ID')

  const { data: circle } = await supabase.from('care_circles').select('*').eq('id', circle_id).maybeSingle()
  if (!circle) return json({ error: 'circle not found' }, 404)

  const { data: contacts, error } = await supabase
    .from('circle_contacts').select('*').eq('circle_id', circle_id)
  if (error) return json({ error: error.message }, 500)

  // A change only reaches the people who asked to hear about changes.
  const wanted = (contacts ?? []).filter((c) =>
    kind === 'change' ? c.wants_changes !== false : c.wants_general !== false)

  const reachable = wanted.filter((c) => (c.phone && c.sms_consent) || c.email)
  const skipped = wanted.length - reachable.length

  if (dry) {
    return json({
      ok: true, dry: true, circle: circle.client_name,
      would_reach: reachable.map((c) => `${c.name}${c.relationship ? ' (' + c.relationship + ')' : ''}`),
      by_text: reachable.filter((c) => c.phone && c.sms_consent).length,
      by_email: reachable.filter((c) => c.email).length,
      no_way_to_reach: wanted.filter((c) => !((c.phone && c.sms_consent) || c.email)).map((c) => c.name),
    })
  }

  const h = {
    Authorization: `Bearer ${ghlToken}`, Version: '2021-07-28',
    'Content-Type': 'application/json', Accept: 'application/json',
  }
  const text = String(body).trim()

  let reached = 0
  for (const c of reachable) {
    if (!ghlToken || !ghlLocation) break
    const first = String(c.name || '').split(' ')[0] || 'there'
    try {
      const up = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
        method: 'POST', headers: h,
        body: JSON.stringify({ locationId: ghlLocation, ...(c.phone ? { phone: c.phone } : {}),
          ...(c.email ? { email: c.email } : {}), firstName: first }),
      })
      const uj = await up.json().catch(() => ({}))
      const contactId = uj?.contact?.id ?? uj?.id
      if (!contactId) continue

      if (c.phone && c.sms_consent) {
        await fetch('https://services.leadconnectorhq.com/conversations/messages', {
          method: 'POST', headers: h,
          body: JSON.stringify({ type: 'SMS', contactId, message: text }),
        })
      }
      if (c.email) {
        await fetch('https://services.leadconnectorhq.com/conversations/messages', {
          method: 'POST', headers: h,
          body: JSON.stringify({ type: 'Email', contactId,
            subject: kind === 'change' ? `A change to ${circle.client_name}'s care`
                                       : `An update about ${circle.client_name}`,
            html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#1f2a36">` +
              `<p>Hi ${first},</p><p>${text.replace(/\n/g, '<br>')}</p>` +
              `<p style="color:#57606a">Caring Companions In-Home Senior Care<br>(417) 234-8494</p></div>` }),
        })
      }
      reached++
    } catch { /* one failure must not stop the rest */ }
  }

  await supabase.from('circle_messages').insert({
    circle_id, kind, body: text, sent_by: sent_by ?? null, reached, skipped,
  })

  return json({ ok: true, reached, skipped, of: wanted.length })
})
