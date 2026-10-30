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
  const dob = S(c?.dateOfBirth ?? c?.birthDate).match(/^\d{4}-\d\d-\d\d/)
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
    dob: dob ? dob[0] : null,
    address: [street, place].filter(Boolean).join(', ') || null,
    phone: phoneText(c?.homePhone || c?.mobilePhone || c?.otherPhone) || null,
    start_date: /^\d{4}-\d\d-\d\d/.test(S(c?.startDate)) ? S(c?.startDate).slice(0, 10) : null,
    contact,
  }
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

  const [cl, rp] = await Promise.all([get(`/api/clients/${ax}`), get(`/api/clients/${ax}/responsibleParties`)])
  if (cl.status < 200 || cl.status >= 300) return json({ error: cl.status ? `AxisCare answered ${cl.status}` : 'AxisCare could not be reached' }, 502)
  const client = cl.json?.results?.client ?? cl.json?.results ?? null
  const rps = rp.status >= 200 && rp.status < 300 ? listOf(rp.json?.results?.responsibleParties ?? rp.json?.results ?? []) : []

  let members: Any[] = []
  const { data: circs } = await admin.from('care_circles').select('id').eq('active', true).eq('axiscare_client_id', ax)
  if ((circs ?? []).length === 1) {
    const { data: m } = await admin.from('circle_contacts').select('name,relationship,phone,is_primary,axiscare_list_number').eq('circle_id', circs![0].id)
    members = m ?? []
  }
  return json(glanceFrom(client, members, rps))
})
