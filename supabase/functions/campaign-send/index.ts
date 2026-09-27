// Supabase Edge Function: campaign-send (shared hub project)
// -----------------------------------------------------------------------------
// Sends one designed email (from Samantha's Caring Companions email library)
// to a batch of recipients through GoHighLevel, the same warmed pipe the
// lead-nurture drip already uses. The hub renders the HTML client-side and
// posts it here with the recipient batch (max 25 per call; the hub chunks).
//
// Payload: { subject, html, recipients: [{ email, name }], campaign }
// For each recipient: upsert the GHL contact by email, then send an Email
// message so it lands in their conversation timeline like everything else.
//
// Auth (security slice, 2026-09-27): a signed-in Caring Companions staff member holding owner_admin.
// The public URL token that used to be enough is printed in the public Hub page; it is no longer accepted.
// POST { auth_check: true } only answers whether the caller is authorized; nothing is read or sent.
// -----------------------------------------------------------------------------

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff } from '../_shared/staff-auth.ts'

export const CAMPAIGN_ROLES = ['owner_admin']

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({ ok: true })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  /* Who is asking comes first: before the body is read, before GHL is touched. */
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const who = await requireStaff(admin, req, CAMPAIGN_ROLES)
  if (!who.ok) return json({ error: who.error }, who.status)

  const ghlToken = Deno.env.get('GHL_TOKEN')
  const ghlLocation = Deno.env.get('GHL_LOCATION_ID')
  if (!ghlToken || !ghlLocation) return json({ error: 'GHL not configured' }, 500)
  const sendH = { Authorization: `Bearer ${ghlToken}`, Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' }

  // deno-lint-ignore no-explicit-any
  let body: Record<string, any> = {}
  try { body = await req.json() } catch { return json({ error: 'bad payload' }, 400) }
  if (body.auth_check === true) return json({ ok: true, authorized: true, roles: who.roles })

  const subject = String(body.subject ?? '').slice(0, 300)
  const html = String(body.html ?? '')
  // Contact-type tag (lead / client / client-contact / caregiver / referral-partner):
  // applied on upsert so every GHL profile says what kind of contact it is.
  const tag = String(body.tag ?? '').trim().toLowerCase().replace(/[^a-z0-9 _-]/g, '').slice(0, 60)
  // deno-lint-ignore no-explicit-any
  const recipients: any[] = Array.isArray(body.recipients) ? body.recipients.slice(0, 25) : []
  if (!subject || !html || recipients.length === 0) return json({ error: 'subject, html and recipients are required' }, 400)

  const results: { email: string; ok: boolean; err?: string }[] = []
  for (const r of recipients) {
    const email = String(r.email ?? '').trim()
    if (!email || !email.includes('@')) { results.push({ email, ok: false, err: 'bad email' }); continue }
    const name = String(r.name ?? '').trim()
    const parts = name.split(/\s+/).filter(Boolean)
    try {
      const up = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
        method: 'POST', headers: sendH,
        body: JSON.stringify({
          locationId: ghlLocation, email,
          ...(parts[0] ? { firstName: parts[0] } : {}),
          ...(parts.length > 1 ? { lastName: parts.slice(1).join(' ') } : {}),
          ...(tag ? { tags: [tag] } : {}),
        }),
      })
      const upJson = await up.json().catch(() => ({}))
      const contactId = upJson?.contact?.id ?? upJson?.id ?? null
      if (!contactId) { results.push({ email, ok: false, err: 'no contact id' }); continue }

      const personalHtml = html.replace(/\{first\}/g, parts[0] || 'there')
      const sr = await fetch('https://services.leadconnectorhq.com/conversations/messages', {
        method: 'POST', headers: sendH,
        body: JSON.stringify({ type: 'Email', contactId, subject, html: personalHtml }),
      })
      if (sr.ok) results.push({ email, ok: true })
      else results.push({ email, ok: false, err: 'send ' + sr.status })
    } catch (e) {
      results.push({ email, ok: false, err: String(e).slice(0, 120) })
    }
  }
  const sent = results.filter((x) => x.ok).length
  return json({ ok: true, sent, failed: results.length - sent, results })
})
