// =============================================================================
// reference-send — the office sends a reference their form by email or text (Desktop 377, 2026-10-01)
// =============================================================================
// Samantha approved ("yes to all"): references are often too busy for a call. From Background & References a staff member
// can EMAIL the form right away (no permission needed; asks for the address if missing), or TEXT it from the office
// number, but only after recording that the reference said OK to a text on the phone (who, when, "verbal, by phone").
//   • Signed-in office staff only. Fixed wording; the link is built here from the request row (rel, t, co).
//   • Opt-out door on every send (channel named). Texts carry "Reply STOP to opt out."
//   • 8am to 6pm Central, any day (reactive_external: they just spoke with us).
//   • No automatic follow-up texts, ever (her decision 3). reference-chase's emailed reminders still apply.
//   • Every send is stamped on the row (office_emailed_* / office_texted_*, sent_at if unset so the morning job doesn't
//     send it again) and appended to office_attempts.
// Body: { action: 'permit_text' | 'email' | 'text', id: <reference_requests id>, email?: string, phone?: string }
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { contactForOutbound, maySend } from '../_shared/outreach.ts'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { caregiverGate } from '../_shared/caregiver-journey.ts'   /* SLICE 3b */

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
export const digits10 = (p: unknown) => { let d = String(p ?? '').replace(/\D/g, ''); if (d.length === 11 && d[0] === '1') d = d.slice(1); return d.length === 10 ? d : '' }
const okEmail = (e: string) => /^[^\s@",()<>]+@[^\s@",()<>]+\.[^\s@",()<>]+$/.test(e)
// deno-lint-ignore no-explicit-any
export function formLink(r: any): string {
  return `https://cc.mo-care.com/reference.html?r=${encodeURIComponent(r.id)}` +
    `&c=${encodeURIComponent(r.candidate_name ?? '')}&n=${encodeURIComponent(r.ref_name ?? '')}` +
    (r.ref_relationship ? `&rel=${encodeURIComponent(r.ref_relationship)}` : '') +
    (r.ref_type ? `&t=${encodeURIComponent(r.ref_type)}` : '') + (r.ref_company ? `&co=${encodeURIComponent(r.ref_company)}` : '')
}
// deno-lint-ignore no-explicit-any
export function textBody(r: any, link: string): string {
  const first = String(r.ref_name ?? '').trim().split(/\s+/)[0] || 'there'
  return `Hi ${first}, this is Caring Companions In-Home Senior Care. Thanks for saying we could text you. ` +
    `${r.candidate_name} listed you as a reference. A few quick questions, about two minutes: ${link} Reply STOP to opt out.`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const who = await requireStaff(db, req, OFFICE_ROLES)
  if (!who.ok) return json({ error: who.error }, who.status)
  // deno-lint-ignore no-explicit-any
  const b: any = await req.json().catch(() => ({}))
  const action = String(b.action || '')
  const id = String(b.id || '')
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'Which reference?' }, 400)
  const { data: r } = await db.from('reference_requests').select('*').eq('id', id).maybeSingle()
  if (!r) return json({ error: 'That reference request was not found.' }, 404)
  if (r.responded_at) return json({ error: 'They already answered. Nothing was sent.' }, 409)
  /* SLICE 3b: on the new path nothing reaches a reference before the signed reference consent (the old path is untouched) */
  if (r.candidate_id != null) { const gate = await caregiverGate(db, { candidate_id: r.candidate_id }, 'cg.step1.references'); if (!gate.allowed) return json({ error: gate.why, gate: 'cg.step1.references' }, 409) }
  const now = new Date().toISOString()
  const by = who.name || who.email
  // deno-lint-ignore no-explicit-any
  const log = async (entry: Record<string, unknown>, patch: Record<string, unknown>) => {
    const prev = Array.isArray(r.office_attempts) ? r.office_attempts : []
    await db.from('reference_requests').update({ ...patch, office_attempts: [...prev, { at: now, by: who.email, ...entry }].slice(-50) }).eq('id', id)
  }

  if (action === 'permit_text') {
    await log({ method: 'other', note: 'Said OK to a text, by phone' }, { sms_ok_at: now, sms_ok_by: by, sms_ok_how: 'verbal, by phone' })
    return json({ ok: true, sms_ok_at: now, sms_ok_by: by })
  }
  if (action !== 'email' && action !== 'text') return json({ error: 'unknown action' }, 400)

  const hours = maySend('reactive_external')
  if (!hours.allowed) return json({ ok: false, held: 'The form goes out 8am to 6pm. Send it after 8am.' }, 200)
  const ghl = { token: Deno.env.get('GHL_TOKEN') ?? '', locationId: Deno.env.get('GHL_LOCATION_ID') ?? '' }
  if (!ghl.token || !ghl.locationId) return json({ error: 'Sending is not set up on the server.' }, 500)
  const H = { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' }
  const link = formLink(r)
  const common = { humanInitiated: true, audience: 'reference' as const, sender: 'reference-send' }

  if (action === 'email') {
    const email = String(b.email ?? r.ref_email ?? '').trim().toLowerCase()
    if (!email || !okEmail(email)) return json({ error: email ? 'That email does not look right.' : 'Add their email first.' }, 400)
    let why = ''
    const c = await contactForOutbound(db, ghl, { email, firstName: r.ref_name ?? 'Reference' }, 'reactive_external',
      { ...common, channel: 'email', onOptOut: (x) => { why = 'they opted out of email (' + x.join(', ') + ')' } })
    if (!c) return json({ ok: false, error: 'Not sent: ' + (why || 'the email could not be sent.') }, 200)
    const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#1f2a36">` +
      `<p>Hi ${esc(r.ref_name ?? 'there')},</p>` +
      `<p><b>${esc(r.candidate_name)}</b> listed you as a reference for a caregiving job with us. Thank you for letting us send this by email.</p>` +
      `<p>It is a few quick questions, and there are no wrong answers. An honest middling answer helps us place someone well far more than a glowing one does.</p>` +
      `<p><a href="${link}" style="background:#F0A63A;color:#122F52;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:700;display:inline-block">Answer a few quick questions</a></p>` +
      `<p style="color:#57606a;font-size:13px">Or paste this into your browser: ${link}</p>` +
      `<p style="color:#57606a">Thank you,<br>Caring Companions In-Home Senior Care<br>(417) 234-8494</p></div>`
    const s = await fetch('https://services.leadconnectorhq.com/conversations/messages', { method: 'POST', headers: H,
      body: JSON.stringify({ type: 'Email', contactId: c.contactId, subject: `A quick reference for ${r.candidate_name}`, html }) })
    if (!s.ok) return json({ ok: false, error: `The email service refused it (${s.status}).` }, 200)
    await log({ method: 'email', note: 'Emailed the form' }, { ref_email: email, office_emailed_at: now, office_emailed_by: by, ...(r.sent_at ? {} : { sent_at: now }) })
    return json({ ok: true, sent: 'email', to: email, at: now, by })
  }

  // text
  if (!r.sms_ok_at) return json({ ok: false, error: 'Record that they said OK to a text first.' }, 409)
  const phone = digits10(b.phone ?? r.ref_phone)
  if (!phone) return json({ error: 'Add their mobile number first.' }, 400)
  let why = ''
  const c = await contactForOutbound(db, ghl, { phone, firstName: r.ref_name ?? 'Reference' }, 'reactive_external',
    { ...common, channel: 'sms', selfSupplied: true, onOptOut: (x) => { why = 'they opted out of texts (' + x.join(', ') + ')' } })
  if (!c) return json({ ok: false, error: 'Not sent: ' + (why || 'that number could not be texted.') }, 200)
  const s = await fetch('https://services.leadconnectorhq.com/conversations/messages', { method: 'POST', headers: H,
    body: JSON.stringify({ type: 'SMS', contactId: c.contactId, message: textBody(r, link) }) })
  if (!s.ok) return json({ ok: false, error: `The texting service refused it (${s.status}).` }, 200)
  await log({ method: 'text', note: "Texted the form (OK'd by phone)" }, { ...(b.phone ? { ref_phone: phone } : {}), office_texted_at: now, office_texted_by: by, ...(r.sent_at ? {} : { sent_at: now }) })
  return json({ ok: true, sent: 'text', to: phone, at: now, by })
})
