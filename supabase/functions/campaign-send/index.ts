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
// Auth (security slice, 2026-09-27): a signed-in Caring Companions staff member holding an office role (OFFICE_ROLES).
// The public URL token that used to be enough is printed in the public Hub page; it is no longer accepted.
// POST { auth_check: true } only answers whether the caller is authorized; nothing is read or sent.
//
// THE AUDIENCE GUARD (2026-10-07, her safety fix): every recipient of every send is checked here, whatever list the
// Hub built (leads, AxisCare clients, family contacts, a pasted list). Never anyone tied to a deceased, past or paused
// client; client and family campaigns only to people tied to an active or starting client (_shared/audience-guard.ts).
// POST { screen: true, tag, recipients } answers who would be left out and why, and sends nothing.
// A test send to the signed-in person's own address is not screened.
// -----------------------------------------------------------------------------

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { ghlContactIfAllowed } from '../_shared/optout.ts'
import { loadGuard, verdict } from '../_shared/audience-guard.ts'

export const CAMPAIGN_ROLES = OFFICE_ROLES

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
  const clientish = tag === 'client' || tag === 'client-contact'
  const me = String(who.email ?? '').trim().toLowerCase()
  if (body.screen === true) {
    // deno-lint-ignore no-explicit-any
    const list: any[] = Array.isArray(body.recipients) ? body.recipients.slice(0, 3000) : []
    const g = await loadGuard(admin)
    if (!g.axOk) return json({ ok: false, error: 'AxisCare could not be read just now, so nobody can be checked. Try again in a minute.', allowed: [], left_out: list.map((r) => ({ email: r.email, why: 'could not be checked' })) })
    // deno-lint-ignore no-explicit-any
    const allowed: any[] = [], left_out: { email: string; why: string }[] = []
    for (const r of list) { const e = String(r?.email ?? '').trim(); if (!e.includes('@')) continue; const v = verdict(g.stateOf(e), tag); if (v.ok) allowed.push(r); else left_out.push({ email: e, why: v.why! }) }
    return json({ ok: true, allowed, left_out })
  }
  // deno-lint-ignore no-explicit-any
  const recipients: any[] = Array.isArray(body.recipients) ? body.recipients.slice(0, 25) : []
  if (!subject || !html || recipients.length === 0) return json({ error: 'subject, html and recipients are required' }, 400)
  const testOnly = recipients.every((r) => String(r?.email ?? '').trim().toLowerCase() === me && me)
  const guard = testOnly ? null : await loadGuard(admin)
  if (guard && !guard.axOk) return json({ ok: false, sent: 0, failed: recipients.length, error: 'AxisCare could not be read just now, so nobody could be checked against past and deceased clients. Nothing was sent. Try again in a minute.',
    results: recipients.map((r) => ({ email: String(r?.email ?? ''), ok: false, err: 'not checked, not sent' })) })

  const results: { email: string; ok: boolean; err?: string }[] = []
  for (const r of recipients) {
    const email = String(r.email ?? '').trim()
    if (!email || !email.includes('@')) { results.push({ email, ok: false, err: 'bad email' }); continue }
    if (guard) { const v = verdict(guard.stateOf(email), tag); if (!v.ok) { results.push({ email, ok: false, err: 'left out: ' + v.why }); continue } }
    const name = String(r.name ?? '').trim()
    const parts = name.split(/\s+/).filter(Boolean)
    try {
      /* 0b-2: the universal opt-out door; the contact-type tag still rides on the upsert */
      let optedOut = false
      const contactId = await ghlContactIfAllowed(admin, { token: ghlToken, locationId: ghlLocation }, 'campaign-send', {
        channel: 'email', email, firstName: parts[0], lastName: parts.slice(1).join(' '),
        extra: tag ? { tags: [tag] } : {}, onOptOut: () => { optedOut = true } })
      if (!contactId) { results.push({ email, ok: false, err: optedOut ? 'opted out (not sent)' : 'could not confirm they may be emailed (not sent)' }); continue }

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
