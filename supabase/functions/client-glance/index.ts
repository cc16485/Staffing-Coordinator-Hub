// =============================================================================
// client-glance — one client's at-a-glance facts for the profile's Overview card, read-only
// =============================================================================
// Samantha, 2026-10-29: "The overview of our caring companions clients should be simple, clear, their name, DOB,
// address, Care Level". She approved reading birth date, address and phone live from AxisCare "when someone opens a
// client". So this answers for ONE client at a time, only when a signed-in office user opens that profile.
// Nothing is copied into the Hub: no table is written, nothing is cached. client-census-report (the whole list) still
// sends no phone, address or birth date.
// SEND-INCAPABLE by construction: its only outbound calls are AxisCare GETs, and it writes nothing anywhere.
// The main contact is the Family Circle's primary (circles-sync keeps it in step with AxisCare's responsible parties),
// else AxisCare's first responsible party.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { OFFICE_ROLES, requireStaff } from '../_shared/staff-auth.ts'

// deno-lint-ignore no-explicit-any
type Any = any
const S = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim())
const listOf = (v: Any): Any[] => Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : [])
// AxisCare sends a blank date as 1969-12-31 or 1970-01-01 (8 of 24 active clients on 2026-10-30), so those mean "not recorded".
const dayOf = (v: unknown) => { const d = S(v).slice(0, 10); return /^\d{4}-\d\d-\d\d$/.test(d) && !/^(1969-12-31|1970-01-01)$/.test(d) ? d : null }

/** "4175550001" or "+1 417-555-0001" -> "(417) 555-0001"; anything else as given. */
export function phoneText(v: unknown): string {
  const s = S(v), d = s.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : s
}

/** The AxisCare client + their people -> the card's facts. Only these fields ever leave. */
export function glanceFrom(c: Any, members: Any[], rps: Any[]) {
  const a = c?.residentialAddress ?? c?.mailingAddress ?? {}
  const street = [S(a.streetAddress1 ?? a.street1 ?? a.line1), S(a.streetAddress2 ?? a.street2 ?? a.line2)].filter(Boolean).join(' ')
  const place = [S(a.city), [S(a.state), S(a.postalCode ?? a.zip).slice(0, 5)].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  let contact: { name: string; relationship: string; phone: string; from: string } | null = null
  const m = [...members].filter((x) => S(x?.name) && !/^(self|client)$/i.test(S(x?.relationship)))
    .sort((x, y) => Number(!!y?.is_primary) - Number(!!x?.is_primary) || Number(x?.axiscare_list_number ?? 99) - Number(y?.axiscare_list_number ?? 99))[0]
  if (m) contact = { name: S(m.name), relationship: S(m.relationship), phone: phoneText(m.phone), from: 'Family Circle' }
  else {
    const r = [...rps].filter((x) => S(x?.name) && !/^(self|client)$/i.test(S(x?.relationship)))
      .sort((x, y) => Number(x?.listNumber ?? 99) - Number(y?.listNumber ?? 99))[0]
    if (r) {
      const ph = listOf(r.phones).filter((x: Any) => S(x?.number))
      contact = { name: S(r.name), relationship: S(r.relationship), phone: phoneText((ph.find((x: Any) => /mobile|cell/i.test(S(x?.type))) ?? ph[0])?.number), from: 'AxisCare' }
    }
  }
  return {
    dob: dayOf(c?.dateOfBirth ?? c?.birthDate),
    address: [street, place].filter(Boolean).join(', ') || null,
    phone: phoneText(c?.homePhone || c?.mobilePhone || c?.otherPhone) || null,
    start_date: dayOf(c?.startDate),
    contact,
  }
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const mins = (t: unknown) => { const m = S(t).match(/^(\d{1,2}):(\d\d)/); return m ? Number(m[1]) * 60 + Number(m[2]) : null }

/** AxisCare's recurring schedule rows (one per weekday) -> the card's "Usual schedule" lines.
 *  Rows with the same times, caregiver and repeat fold into one line. Caregiver is first name + last initial only. */
export function scheduleFrom(rows: Any[], today: string) {
  const groups = new Map<string, { days: string[]; start: string; end: string; caregiver: string | null; every_weeks: number }>()
  let weekly = 0
  for (const r of rows) {
    const day = DAYS.find((d) => d.toLowerCase() === S(r?.day).toLowerCase())
    const a = mins(r?.startTime), b = mins(r?.endTime)
    if (!day || a == null || b == null || r?.removed || r?.deleted) continue
    const end = dayOf(r?.endDate); if (end && end < today) continue
    const every = Math.max(1, Number(r?.frequency) || 1)
    const cg = r?.caregiver?.id == null ? null
      : [S(r.caregiver.firstName), S(r.caregiver.lastName).slice(0, 1)].filter(Boolean).join(' ') + (S(r.caregiver.lastName) ? '.' : '')
    const start = S(r.startTime).slice(0, 5), stop = S(r.endTime).slice(0, 5)
    const k = [start, stop, cg ?? '', every].join('|')
    if (!groups.has(k)) groups.set(k, { days: [], start, end: stop, caregiver: cg || null, every_weeks: every })
    const g = groups.get(k)!
    if (!g.days.includes(day)) { g.days.push(day); weekly += ((b - a + 1440) % 1440 || 1440) / every }
  }
  const lines = [...groups.values()].map((g) => ({ ...g, days: g.days.sort((x, y) => DAYS.indexOf(x) - DAYS.indexOf(y)) }))
    .sort((x, y) => DAYS.indexOf(x.days[0]) - DAYS.indexOf(y.days[0]) || (mins(x.start)! - mins(y.start)!))
  return { lines, weekly_hours: Math.round(weekly / 6) / 10 }
}

const cors = { 'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS' }

if (import.meta.main) Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const who = await requireStaff(admin, req, OFFICE_ROLES)
  if (!who.ok) return json({ error: who.error }, who.status)

  const body = await req.json().catch(() => ({}))
  const ax = S(body?.axiscare_client_id)
  if (!/^\d{1,9}$/.test(ax)) return json({ error: 'axiscare_client_id is required' }, 400)

  let token = ''
  for (const n of ['AXISCARE_API_KEY', 'AXISCARE_TOKEN', 'AXISCARE_VISITS_TOKEN']) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  if (!token || !site) return json({ error: 'AxisCare credentials not set' }, 502)
  const get = async (path: string) => {
    try {
      const r = await fetch(`https://${site}.axiscare.com${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json',
        'X-AxisCare-Api-Version': Deno.env.get('AXISCARE_API_VERSION') || '2023-10-01' } })
      return { status: r.status, json: await r.json().catch(() => ({})) }
    } catch (_e) { return { status: 0, json: {} } }
  }

  const today = new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
  const twoWeeks = new Date(Date.now() + 13 * 864e5).toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
  const [cl, rp, sc] = await Promise.all([get(`/api/clients/${ax}`), get(`/api/clients/${ax}/responsibleParties`),
    get(`/api/schedules?clientIds=${ax}&startDate=${today}&endDate=${twoWeeks}`)])
  if (cl.status < 200 || cl.status >= 300) return json({ error: cl.status ? `AxisCare answered ${cl.status}` : 'AxisCare could not be reached' }, 502)
  const client = cl.json?.results?.client ?? cl.json?.results ?? null
  const rps = rp.status >= 200 && rp.status < 300 ? listOf(rp.json?.results?.responsibleParties ?? rp.json?.results ?? []) : []

  let members: Any[] = []
  const { data: circs } = await admin.from('care_circles').select('id').eq('active', true).eq('axiscare_client_id', ax)
  if ((circs ?? []).length === 1) {
    const { data: m } = await admin.from('circle_contacts').select('name,relationship,phone,is_primary,axiscare_list_number').eq('circle_id', circs![0].id)
    members = m ?? []
  }
  // A schedule failure loses only the schedule line; the card says so instead of "no regular schedule".
  const ok = sc.status >= 200 && sc.status < 300
  const rows = ok ? listOf(sc.json?.results?.schedules ?? sc.json?.results ?? []).filter((r: Any) => S(r?.client?.id ?? ax) === ax) : []
  return json({ ...glanceFrom(client, members, rps), schedule: ok ? scheduleFrom(rows, today) : null })
})
