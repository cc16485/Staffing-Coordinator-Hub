// Supabase Edge Function: caregiver-availability  (shared hub project)
// -----------------------------------------------------------------------------
// The supply side of the scheduler (Samantha, 2026-09-12): caregivers tell us
// what they WANT — target hours per week and which day/time windows — from a
// phone page, self-maintained. This feeds:
//   - the Hours Watch board (who is not getting the hours they want)
//   - callout wave ranking (hungry-for-hours caregivers asked earlier)
//   - intake confidence ("who could staff Mon/Wed/Fri mornings?")
//
// Identity: the caregiver enters their own phone number; it must match
// exactly ONE active roster caregiver (last-10 digits). Unknown or shared
// numbers are politely refused — never guessed. The data is preferences, not
// PHI; the write is capped and shaped. Public endpoint (deploy with
// --no-verify-jwt) because caregivers have no hub logins, same pattern as
// the EVV and reference forms.
//
// Storage: app_data key `caregiver_availability`, one item per caregiver:
//   { id: <roster id>, name, axiscare_id, phone_digits, target_hours,
//     windows: { mon:[...], ... sun:[...] }  (values from WINDOW_KEYS),
//     updated_at, source: 'self' | 'office' }
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { contactForOutbound } from '../_shared/outreach.ts'
import { checkAvailLink } from '../_shared/prn-links.ts'
import { ghlSendChecked } from '../_shared/send-problems.ts'

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

function callerRole(req: Request): string {
  try {
    const tok = String(req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    const payload = JSON.parse(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return String(payload?.role || '')
  } catch { return '' }
}
function nameKeyOf(n: string) {
  return n.toLowerCase().replace(/[^a-z ]/g, '').split(/\s+/).filter(Boolean).join(' ')
}
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
const WINDOW_KEYS = ['morning', 'afternoon', 'evening', 'overnight'] as const
const digits10 = (p: unknown) => String(p ?? '').replace(/\D/g, '').slice(-10)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  // deno-lint-ignore no-explicit-any
  const b: any = await req.json().catch(() => ({}))

  /* ── ACTION: INVITE (office only) ──────────────────────────────────────
     Texts the availability link to active caregivers who have nothing on
     file. Samantha's rules: ONLY between 10:00 and 17:00 Chicago (server-
     enforced), never nurses, never anyone invited in the last 30 days,
     capped per run, wording editable in Settings (coverage_msg_avail_invite). */
  if (b.action === 'invite') {
    const role = callerRole(req)
    if (role !== 'authenticated' && role !== 'service_role')
      return json({ error: 'a signed-in coordinator session is required' }, 403)
    const chiHour = Number(new Date().toLocaleString('en-US',
      { timeZone: 'America/Chicago', hour: '2-digit', hour12: false }))
    if (chiHour < 10 || chiHour >= 17)
      return json({ held: true, message: 'Availability invites only send between 10am and 5pm. Try again in that window.' })

    const key = async (k: string) => {
      const { data } = await sb.from('app_data').select('data').eq('key', k).maybeSingle()
      // deno-lint-ignore no-explicit-any
      return (Array.isArray(data?.data) ? data!.data : []) as any[]
    }
    const roster = await key('caregivers')
    const av = await key('caregiver_availability')
    const invites = await key('availability_invites')
    const nurses = new Set((await key('nurse_staff')).map((s: any) => nameKeyOf(String(s?.name || ''))))
    /* CURRENT availability only counts if it's fresh (her rule, 2026-09-19:
       caregivers work multiple jobs — a 6-month-old form is fiction). A
       record older than 90 days makes them invitable again, asking for a
       reconfirm. */
    const staleCut = Date.now() - 90 * 864e5
    // deno-lint-ignore no-explicit-any
    const haveAv = new Set(av.filter((a: any) =>
        new Date(String(a.updated_at || 0)).getTime() > staleCut)
      .map((a: any) => String(a.id)))
    const monthAgo = Date.now() - 30 * 864e5
    const recentlyInvited = new Set(invites
      .filter((i: any) => new Date(String(i.at || 0)).getTime() > monthAgo)
      .map((i: any) => String(i.id)))
    const settings = (await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()).data?.data ?? {}
    const tmpl = String(settings.coverage_msg_avail_invite || '') ||
      `Hi {first_name}, it's Caring Companions! Tell us the hours and days you WANT to work so we can offer you shifts first: cc.mo-care.com/availability It takes 30 seconds and you can update it anytime.`
    const ghl = { token: Deno.env.get('GHL_TOKEN') ?? '', locationId: Deno.env.get('GHL_LOCATION_ID') ?? '' }
    if (!ghl.token || !ghl.locationId) return json({ error: 'GHL credentials not set' }, 500)

    const CAP = 20
    let sent = 0, skippedGate = 0
    const sentTo: string[] = [], failedTo: string[] = []
    for (const cg of roster) {
      if (sent >= CAP) break
      if (cg?.active === false) continue
      const name = [String(cg.first || '').trim(), String(cg.last || '').trim()].filter(Boolean).join(' ')
      if (!name || nurses.has(nameKeyOf(name))) continue
      const itemId = String(cg.axiscare_id || ('roster_' + cg.id))
      if (haveAv.has(itemId) || recentlyInvited.has(itemId)) continue
      const contact = await contactForOutbound(sb, ghl,
        { phone: cg.phone, firstName: cg.first || name }, 'routine_internal', { audience: 'caregiver', channel: 'sms', sender: 'caregiver-availability' })
      if (!contact) { skippedGate++; continue }
      /* NO SILENT FAILURES (2026-10-01): one invite in a batch of 20 that GoHighLevel refuses used to vanish (the
         reply only counted the sent ones). It now raises a card, and the reply names it under failed_to. */
      const ok = await ghlSendChecked(sb, { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
        'caregiver-availability', { channel: 'sms', contactId: contact.contactId, address: cg.phone, who: name },
        { message: tmpl.replaceAll('{first_name}', String(cg.first || 'there')) })
      if (!ok) failedTo.push(name)
      if (ok) {
        sent++; sentTo.push(name)
        await sb.rpc('upsert_app_data_item', { target_key: 'availability_invites',
          item: { id: itemId, name, at: new Date().toISOString() } })
      }
    }
    return json({ sent, sent_to: sentTo, skipped_gate: skippedGate, failed: failedTo.length, failed_to: failedTo,
      note: sent >= CAP ? `capped at ${CAP} per run — press the button again for the next batch` : 'everyone eligible was invited' })
  }

  const { data: cgRow } = await sb.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const roster: any[] = Array.isArray(cgRow?.data) ? cgRow!.data : []
  let name = '', itemId = '', axId: string | null = null, phone = ''
  /* PRN4 (2026-09-29): a PRN CNA's 60-day check-in text carries a sealed personal link (their caregiver number and an
     expiry, sealed by the server), so they don't type their phone number. Anything forged or expired is refused. */
  const viaLink = b.c != null || b.t != null
  if (viaLink) {
    if (!(await checkAvailLink(Deno.env.get('HUB_JOB_SECRET') ?? '', b)))
      return json({ unknown: true, message: 'This link has expired or is not valid. Enter your phone number instead, or call the office.' }, 401)
    axId = String(b.c)
    const hit = roster.find(g => g?.active !== false && String(g?.axiscare_id ?? '') === axId)
    if (hit) { name = [String(hit.first || '').trim(), String(hit.last || '').trim()].filter(Boolean).join(' '); phone = digits10(hit.phone) }
    else {
      const { data: tr } = await sb.from('pay_tracks').select('applicant_id').eq('axiscare_caregiver_id', axId).maybeSingle()
      const { data: ap } = tr ? await sb.from('job_applicants').select('first_name, last_name, phone').eq('id', tr.applicant_id).maybeSingle() : { data: null }
      if (ap) { name = [String(ap.first_name || '').trim(), String(ap.last_name || '').trim()].filter(Boolean).join(' '); phone = digits10(ap.phone) }
    }
    if (!name) return json({ unknown: true, message: 'We could not find you from this link. Text or call the office and we will set you up.' })
    itemId = axId
  } else {
    phone = digits10(b.phone)
    if (phone.length !== 10) return json({ error: 'enter your 10-digit phone number' }, 400)
    // Exactly ONE active roster caregiver on this number, or nothing happens.
    const hits = roster.filter(g => g?.active !== false && digits10(g.phone) === phone)
    if (hits.length === 0)
      return json({ unknown: true, message: 'We could not match that number. Text or call the office and we will set you up.' })
    if (hits.length > 1)
      return json({ unknown: true, message: 'That number is on more than one record — call the office and we will sort it out.' })
    const cg = hits[0]
    name = [String(cg.first || '').trim(), String(cg.last || '').trim()].filter(Boolean).join(' ')
    itemId = String(cg.axiscare_id || ('roster_' + cg.id))
    axId = cg.axiscare_id ? String(cg.axiscare_id) : null
  }
  /* PRN4: a PRN CNA's open check-in counts as answered however they confirm (link or phone). Best effort. */
  const answered = async (how: string) => {
    if (!axId) return
    try { await sb.from('prn_checkins').update({ answered_at: new Date().toISOString(), how }).eq('axiscare_caregiver_id', axId).is('answered_at', null) } catch { /* the save itself stands */ }
  }

  const { data: avRow } = await sb.from('app_data').select('data').eq('key', 'caregiver_availability').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const avAll: any[] = Array.isArray(avRow?.data) ? avRow!.data : []
  const existing = avAll.find(a => String(a.id) === itemId)

  if (b.action === 'save') {
    const target = Number(b.target_hours)
    if (!Number.isFinite(target) || target < 0 || target > 80)
      return json({ error: 'hours per week must be a number between 0 and 80' }, 400)
    // deno-lint-ignore no-explicit-any
    const windows: Record<string, string[]> = {}
    for (const d of DAYS) {
      const raw = Array.isArray(b?.windows?.[d]) ? b.windows[d] : []
      windows[d] = raw.map((w: unknown) => String(w)).filter((w: string) => (WINDOW_KEYS as readonly string[]).includes(w))
    }
    const item = {
      id: itemId, name, axiscare_id: axId,
      phone_digits: phone || null, target_hours: target, windows,
      updated_at: new Date().toISOString(), source: 'self',
    }
    const { error } = await sb.rpc('upsert_app_data_item', { target_key: 'caregiver_availability', item })
    if (error) return json({ error: 'could not save — try again: ' + error.message }, 500)
    await answered('updated')
    return json({ saved: true, name, message: `Saved, ${name.split(' ')[0]}! The office sees this right away — update it any time.` })
  }

  /* PRN4: "Still right": what's on file is confirmed as of today, nothing else changes. */
  if (b.action === 'confirm') {
    if (!existing || !existing.windows || !Object.values(existing.windows).some((v) => Array.isArray(v) && v.length))
      return json({ error: 'there is nothing on file to confirm yet: choose your days and times below and save' }, 400)
    const item = { ...existing, updated_at: new Date().toISOString(), source: 'self' }
    const { error } = await sb.rpc('upsert_app_data_item', { target_key: 'caregiver_availability', item })
    if (error) return json({ error: 'could not save — try again: ' + error.message }, 500)
    await answered('still_right')
    return json({ confirmed: true, name, message: `Thank you, ${name.split(' ')[0]}! Your availability is confirmed.` })
  }

  // Default: 'get' — prefill for the form.
  return json({
    name,
    first_name: name.split(' ')[0],
    target_hours: existing?.target_hours ?? null,
    windows: existing?.windows ?? null,
    updated_at: existing?.updated_at ?? null,
    via_link: viaLink,
  })
})
