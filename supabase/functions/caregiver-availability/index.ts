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

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
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
  const phone = digits10(b.phone)
  if (phone.length !== 10) return json({ error: 'enter your 10-digit phone number' }, 400)

  // Exactly ONE active roster caregiver on this number, or nothing happens.
  const { data: cgRow } = await sb.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const roster: any[] = Array.isArray(cgRow?.data) ? cgRow!.data : []
  const hits = roster.filter(g => g?.active !== false && digits10(g.phone) === phone)
  if (hits.length === 0)
    return json({ unknown: true, message: 'We could not match that number. Text or call the office and we will set you up.' })
  if (hits.length > 1)
    return json({ unknown: true, message: 'That number is on more than one record — call the office and we will sort it out.' })
  const cg = hits[0]
  const name = [String(cg.first || '').trim(), String(cg.last || '').trim()].filter(Boolean).join(' ')
  const itemId = String(cg.axiscare_id || ('roster_' + cg.id))

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
      id: itemId, name, axiscare_id: cg.axiscare_id ? String(cg.axiscare_id) : null,
      phone_digits: phone, target_hours: target, windows,
      updated_at: new Date().toISOString(), source: 'self',
    }
    const { error } = await sb.rpc('upsert_app_data_item', { target_key: 'caregiver_availability', item })
    if (error) return json({ error: 'could not save — try again: ' + error.message }, 500)
    return json({ saved: true, name, message: `Saved, ${name.split(' ')[0]}! The office sees this right away — update it any time.` })
  }

  // Default: 'get' — prefill for the form.
  return json({
    name,
    first_name: name.split(' ')[0],
    target_hours: existing?.target_hours ?? null,
    windows: existing?.windows ?? null,
    updated_at: existing?.updated_at ?? null,
  })
})
