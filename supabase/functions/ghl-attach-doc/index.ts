// Supabase Edge Function: ghl-attach-doc  (shared hub project)
// -----------------------------------------------------------------------------
// Files a pre-hire background-check document (OIG, EDL, FCSR, fingerprints, a reference PDF) onto the person's
// GoHighLevel contact: the file goes into GHL's media library and the contact gets a note linking it. The GHL token
// stays server-side. This never messages anyone.
//
// PHASE 0 (Samantha approved the eight P0 fixes, 2026-10-10). History: this ran on the Training project behind a
// shared "hub read key". That key was retired from the Hub on 2026-09-28 (T2), and since then the Hub has sent its own
// sign-in instead, which the old copy did not understand, so every filing has quietly failed with "missing key" and
// the Hub swallowed the error. Now it lives beside every other Hub function, answers only a signed-in office member,
// and writes one op_events row per filing (who, which label, whether the file and the note landed). Nothing in the
// request chooses the GoHighLevel account; the contact is found or created from the person's email and phone.
//
// Body: { first, last, email, phone, contact_id?, label, file_url?, file_name?, probe? }
//   file_url = a short-lived signed link to the document in Hub storage.
//   probe    = true uploads a tiny text file instead (owner only): measures what the GHL token may do.
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { opEvent } from '../_shared/events.ts'
import { practicePerson, PRACTICE_WHY } from '../_shared/optout.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const GHL = 'https://services.leadconnectorhq.com'
const V = '2021-07-28'
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '').slice(0, 200)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const who = await requireStaff(admin, req, OFFICE_ROLES)
  if (!who.ok) return json({ error: who.error }, who.status)

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const first = str(body.first), last = str(body.last), email = str(body.email), phone = str(body.phone)
  const label = str(body.label) || 'document', fileName = str(body.file_name) || 'document.pdf'
  const fileUrl = str(body.file_url), givenContact = str(body.contact_id)
  const probe = body.probe === true
  if (probe && !who.roles.includes('owner_admin')) return json({ error: 'The probe is for the owner.' }, 403)
  if (!email && !phone && !givenContact) return json({ error: 'need an email or a phone to find the contact' }, 400)
  if (!probe && !/^https:\/\//i.test(fileUrl)) return json({ error: 'need a signed file link (https)' }, 400)

  /* PRACTICE ADDRESSES (2026-10-11): a person reachable only at practice addresses (555-01xx, example or test email) is never
     added to GoHighLevel. The proof stays in the Hub; this answers that nothing was filed, and why. */
  if (!probe && !givenContact && practicePerson(phone, email)) return json({ ok: true, skipped: 'practice', why: PRACTICE_WHY })
  const token = Deno.env.get('GHL_TOKEN') || Deno.env.get('GHL_API_KEY') || ''
  const loc = Deno.env.get('GHL_LOCATION_ID') || ''
  if (!token || !loc) return json({ error: 'GoHighLevel is not configured on this project' }, 500)
  const H: Record<string, string> = { Authorization: `Bearer ${token}`, Version: V, Accept: 'application/json' }
  const out: Record<string, unknown> = {}

  // 1) the contact: the one given, else found or created from email and phone
  let contactId = givenContact
  if (!contactId) {
    try {
      const up = await fetch(`${GHL}/contacts/upsert`, {
        method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId: loc, email: email || undefined, phone: phone || undefined, firstName: first || undefined, lastName: last || undefined }),
      })
      const ud = await up.json().catch(() => null)
      out.contactUpsert = { ok: up.ok, status: up.status, detail: up.ok ? undefined : ud }
      contactId = String(ud?.contact?.id || ud?.id || '')
    } catch (e) { out.contactUpsert = { ok: false, error: String((e as Error).message || e) } }
  }
  const record = (outcome: string, extra: Record<string, unknown> = {}) => opEvent(admin, {
    verb: 'prehire_doc_filed', area: 'onboarding', actor_name: who.name, actor_email: who.email,
    summary: `${outcome}: ${label} for ${[first, last].filter(Boolean).join(' ') || 'a candidate'} onto the GoHighLevel contact`,
    data: { label, file_name: fileName, contact_id: contactId || '', probe, ...extra },
  })
  if (!contactId) { await record('Not filed (no contact)', { step: 'contact' }); return json({ ok: false, step: 'contact', ...out }, 502) }
  out.contactId = contactId

  // 2) the file into GHL's media library
  let mediaUrl = ''
  try {
    let blob: Blob
    if (probe) blob = new Blob([`ghl-attach-doc probe ${new Date().toISOString()}`], { type: 'text/plain' })
    else { const fr = await fetch(fileUrl); if (!fr.ok) throw new Error('file fetch ' + fr.status); blob = await fr.blob() }
    const fd = new FormData()
    fd.append('file', blob, probe ? 'probe.txt' : fileName)
    fd.append('hosted', 'false')
    const mr = await fetch(`${GHL}/medias/upload-file`, { method: 'POST', headers: { ...H }, body: fd })
    const md = await mr.json().catch(() => null)
    out.mediaUpload = { ok: mr.ok, status: mr.status, detail: mr.ok ? undefined : md }
    if (mr.ok) mediaUrl = String(md?.url || md?.fileUrl || '')
  } catch (e) { out.mediaUpload = { ok: false, error: String((e as Error).message || e) } }

  // 3) a note on the contact so a person can find it
  try {
    const noteBody = mediaUrl
      ? `${label} filed from the Hub: ${mediaUrl}`
      : `${label} is on file in the Hub (Background & References). The file itself could not be uploaded to GoHighLevel.`
    const nr = await fetch(`${GHL}/contacts/${contactId}/notes`, {
      method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: noteBody }),
    })
    const nd = await nr.json().catch(() => null)
    out.note = { ok: nr.ok, status: nr.status, detail: nr.ok ? undefined : nd }
  } catch (e) { out.note = { ok: false, error: String((e as Error).message || e) } }

  const mediaOk = (out.mediaUpload as { ok?: boolean })?.ok === true
  const noteOk = (out.note as { ok?: boolean })?.ok === true
  await record(mediaOk && noteOk ? 'Filed' : noteOk ? 'Noted (file not uploaded)' : 'Not filed', { media_ok: mediaOk, note_ok: noteOk })
  return json({ ok: noteOk, media: mediaOk, ...out })
})
