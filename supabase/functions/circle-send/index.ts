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
import { contactForOutbound } from '../_shared/outreach.ts'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'

/* Security slice (2026-09-27): this used to trust any caller who knew a circle id. It now requires a signed-in
   Caring Companions staff member with an office role (OFFICE_ROLES), checked before the
   circle is read, before a preview is built and before anything is sent. The name recorded as the sender is the
   verified staff member, never a name the request supplies. { auth_check: true } answers and does nothing else. */
export const CIRCLE_ROLES = OFFICE_ROLES

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const who = await requireStaff(supabase, req, CIRCLE_ROLES)
  if (!who.ok) return json({ error: who.error }, who.status)

  const { circle_id, kind = 'update', body, dry, auth_check, contact_ids, purpose, item_id } = await req.json().catch(() => ({}))
  /* N3 (2026-09-29): telling family about a flagged shift note. The coordinator picks who (contact_ids), and only
     people with permission to discuss the client (AxisCare's HIPAA box) can be chosen; anyone else is refused, not
     skipped quietly. The message is the coordinator's own words. Recorded as kind 'care_note'. */
  const careNote = purpose === 'care_note'
  if (careNote && (!Array.isArray(contact_ids) || !contact_ids.length)) return json({ error: 'choose who to tell' }, 400)
  if (auth_check === true) return json({ ok: true, authorized: true, roles: who.roles })
  const sent_by = who.name || who.email
  if (!circle_id) return json({ error: 'no circle given' }, 400)
  if (!body || !String(body).trim()) return json({ error: 'no message given' }, 400)

  const ghlToken = Deno.env.get('GHL_TOKEN')
  const ghlLocation = Deno.env.get('GHL_LOCATION_ID')

  const { data: circle } = await supabase.from('care_circles').select('*').eq('id', circle_id).maybeSingle()
  if (!circle) return json({ error: 'circle not found' }, 404)
  /* Change 6a (2026-09-27): a circle is a client's family only once a person (or
     the AxisCare sync's own exact match) has tied it to the client. Until then it
     is never texted or emailed from here. */
  if (!circle.axiscare_client_id) return json({ error: 'this Family Circle is not linked to a client yet; link it first', outcome: 'not_linked' }, 409)

  const { data: contacts, error } = await supabase
    .from('circle_contacts').select('*').eq('circle_id', circle_id)
  if (error) return json({ error: error.message }, 500)

  // A change only reaches the people who asked to hear about changes.
  /* never someone who replied STOP, or whom AxisCare no longer lists for this client */
  const chosen = careNote ? new Set(contact_ids.map((x: unknown) => String(x))) : null
  const noPermission = careNote ? (contacts ?? []).filter((c) => chosen!.has(String(c.id)) && c.hipaa_authorized !== true).map((c) => c.name) : []
  if (careNote && noPermission.length) return json({ error: 'no permission to discuss on file for: ' + noPermission.join(', '), outcome: 'no_permission' }, 409)
  const wanted = (contacts ?? []).filter((c) => !c.stopped_at && !c.axiscare_removed_at
    && (careNote ? chosen!.has(String(c.id)) : (kind === 'change' ? c.wants_changes !== false : c.wants_general !== false)))

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
  /* When the recipient IS the client (clients sit in their own circles),
     third person reads robotic: "LeeAnn's visit" becomes "your visit" and a
     standalone "LeeAnn" becomes "you" for that one recipient only. Matched
     on the full name so a same-first-name daughter is never rewritten. */
  const nk = (x: unknown) => String(x ?? '').toLowerCase().replace(/[^a-z]/g, '')
  const clientFirst = String(circle.client_name || '').trim().split(/\s+/)[0]
  const textFor = (memberName: unknown) => {
    if (!clientFirst || nk(memberName) !== nk(circle.client_name)) return text
    const esc = clientFirst.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return text
      .replaceAll(clientFirst + "'s", 'your')
      .replace(new RegExp('\\b' + esc + '\\b', 'g'), 'you')
  }

  let reached = 0, optedOut = 0
  const reachedNames: string[] = []
  const ghl = { token: ghlToken!, locationId: ghlLocation! }
  /* 0b-2: each channel gets its own contact, found by that channel's address alone, and the universal opt-out
     check runs on it (GHL Do Not Disturb, the Hub's opt-out record, inquiry do-not-contact, Family Circle stops). */
  const door = (c: Record<string, unknown>, channel: 'sms' | 'email', first: string, stop: { n: number }) =>
    contactForOutbound(supabase, ghl, { phone: c.phone, email: c.email, firstName: first }, 'circle-send',
      /* Family recipients — allowed because a coordinator pressed Send. */
      { audience: 'family', humanInitiated: true, channel, sender: 'circle-send', onOptOut: () => { stop.n++ } })
  for (const c of reachable) {
    if (!ghlToken || !ghlLocation) break
    const first = String(c.name || '').split(' ')[0] || 'there'
    const stop = { n: 0 }
    let any = false
    try {
      if (c.phone && c.sms_consent) {
        const dest = await door(c, 'sms', first, stop)
        if (dest) {
          const r = await fetch('https://services.leadconnectorhq.com/conversations/messages', {
            method: 'POST', headers: h,
            body: JSON.stringify({ type: 'SMS', contactId: dest.contactId, message: textFor(c.name) }),
          })
          any = any || r.ok
        }
      }
      if (c.email) {
        const dest = await door(c, 'email', first, stop)
        if (dest) {
          const r = await fetch('https://services.leadconnectorhq.com/conversations/messages', {
            method: 'POST', headers: h,
            body: JSON.stringify({ type: 'Email', contactId: dest.contactId,
              subject: careNote ? `About ${circle.client_name}'s visit` : kind === 'change' ? `A change to ${circle.client_name}'s care`
                                         : `An update about ${circle.client_name}`,
              html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#1f2a36">` +
                `<p>Hi ${first},</p><p>${text.replace(/\n/g, '<br>')}</p>` +
                `<p style="color:#57606a">Caring Companions In-Home Senior Care<br>(417) 234-8494</p></div>` }),
          })
          any = any || r.ok
        }
      }
    } catch { /* one failure must not stop the rest */ }
    if (any) { reached++; reachedNames.push(String(c.name || '')) }
    if (stop.n) optedOut++
  }

  await supabase.from('circle_messages').insert({
    circle_id, kind: careNote ? 'care_note' : kind, body: text, sent_by: sent_by ?? null, reached, skipped,
  })

  return json({ ok: true, reached, skipped, opted_out: optedOut, of: wanted.length, ...(careNote ? { reached_names: reachedNames, item_id: item_id ?? null } : {}) })
})
