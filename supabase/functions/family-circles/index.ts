// =============================================================================
// family-circles — Family Circles belong to a client; AxisCare owns the responsible parties (Change 6a)
// =============================================================================
// Signed-in staff only. Writes to AxisCare ONLY on "rp_write" / "rp_add", each sent
// from a coordinator's click after a side-by-side confirm, and always read back.
//
//   link     {circle_id, axiscare_client_id}      ties a circle to a client (door)
//   unlink   {circle_id, reason}                  undoes a wrong link (door; reason required)
//   rp_view  {contact_id}                         AxisCare's slot for an AxisCare-linked member
//   rp_write {contact_id, name, relationship, phone, email}
//            writes AxisCare's slot (keeping everything else AxisCare holds, including the
//            HIPAA and medical-decision answers), reads it back, and updates the member
//   rp_add   {contact_id}                          an office-typed member into a FREE slot (1-3)
//   carry    {lead_id, who, person_key}            Gate 4b: "People going into care". The client, the caller
//            or a person on the Journey joins the client's Family Circle (door people_into_care_add;
//            family need a recorded yes to permission to discuss care; texts stay off). Office roles only.
// rp_add / rp_write note who sent the member to AxisCare and when (axiscare_sent_by / _at), so the
// profile can say "Sent to AxisCare" apart from "From AxisCare" (the nightly sync).
// HIPAA / medical-decision authorizations are never set from here: they are legal answers
// recorded in AxisCare.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'

/* C2a (2026-09-28): every change in AxisCare adds one line to axiscare_change_log (who, when, which client or caregiver,
   the kind, how it went, a short summary; never note text). Best effort: recording never blocks the change itself. */
// deno-lint-ignore no-explicit-any
async function recordAxisChange(db: any, c: { kind: string; subject: 'client' | 'caregiver'; client?: string | null; caregiver?: string | null;
  outcome: 'sent_confirmed' | 'sent' | 'refused' | 'practice'; summary: string; detail?: string | null; by: string; via: string }): Promise<boolean> {
  try {
    const { data, error } = await db.rpc('axiscare_change_record', { p_kind: c.kind, p_subject: c.subject, p_client: c.client ?? null,
      p_caregiver: c.caregiver ?? null, p_outcome: c.outcome, p_summary: String(c.summary).slice(0, 200), p_detail: c.detail ? String(c.detail).slice(0, 300) : null,
      p_by: c.by || 'unknown', p_via: c.via })
    return !error && data?.outcome === 'recorded'
  } catch { return false }
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const AC_VERSION = '2023-10-01'
const t = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim())

export function jwtClaims(authHeader: string | null): { role: string | null; email: string | null } {
  const m = /^Bearer\s+(.+)$/.exec(authHeader ?? '')
  if (!m) return { role: null, email: null }
  const parts = m[1].split('.')
  if (parts.length !== 3) return { role: null, email: null }
  try {
    const p = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    return { role: typeof p.role === 'string' ? p.role : null,
             email: typeof p.email === 'string' ? p.email.trim().toLowerCase() : null }
  } catch { return { role: null, email: null } }
}
export const axYes = (v: unknown): boolean | null => (v === true || v === 1 || v === '1') ? true : (v === false || v === 0 || v === '0') ? false : null
// deno-lint-ignore no-explicit-any
export function slotView(p: any) {
  const phones = (Array.isArray(p?.phones) ? p.phones : []).filter((x: { number?: string }) => t(x?.number))
  const mob = phones.find((x: { type?: string }) => /mobile/i.test(String(x?.type ?? ''))) ?? phones[0]
  return { list_number: Number(p?.listNumber) || null, name: t(p?.name), relationship: t(p?.relationship) || null,
    phone: mob ? t(mob.number) : null, email: t(p?.email) || null,
    hipaa_authorized: axYes(p?.hipaaDisclosureAuthorization), can_make_medical_decisions: axYes(p?.canMakeMedicalDecisions) }
}
/* Everything AxisCare holds for the slot, with our four fields laid over it. */
// deno-lint-ignore no-explicit-any
export function putBody(current: any, change: { name: string; relationship: string | null; phone: string | null; email: string | null }) {
  const phones = (Array.isArray(current?.phones) ? current.phones : []).map((x: { type?: string; number?: string }, i: number) => ({ listNumber: String(i + 1), type: x?.type ?? null, number: x?.number ?? null }))
  const iMob = phones.findIndex((x: { type?: string | null }) => /mobile/i.test(String(x.type ?? '')))
  if (change.phone) { if (iMob >= 0) phones[iMob].number = change.phone; else if (phones.length < 2) phones.push({ listNumber: String(phones.length + 1), type: 'Mobile', number: change.phone }); else phones[0] = { listNumber: '1', type: 'Mobile', number: change.phone } }
  return { name: change.name, relationship: change.relationship, email: change.email,
    ...(current?.address ? { address: current.address } : {}), ...(current?.dateOfBirth ? { dateOfBirth: current.dateOfBirth } : {}),
    phones, hipaaDisclosureAuthorization: axYes(current?.hipaaDisclosureAuthorization), canMakeMedicalDecisions: axYes(current?.canMakeMedicalDecisions) }
}

function axisCreds() {
  let token = ''
  for (const n of ['AXISCARE_API_KEY', 'AXISCARE_TOKEN']) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  return { token, site: /^\d+$/.test(site) ? site : '' }
}
// deno-lint-ignore no-explicit-any
async function ax(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const { token, site } = axisCreds()
  if (!token || !site) return { status: 0, json: { errors: ['AxisCare credentials not set'] } }
  try {
    const r = await fetch(`https://${site}.axiscare.com${path}`, { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json',
      'Content-Type': 'application/json', 'X-AxisCare-Api-Version': AC_VERSION }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: r.status, json: await r.json().catch(() => ({})) }
  } catch (e) { return { status: 0, json: { errors: [String((e as Error).message ?? e)] } } }
}
// deno-lint-ignore no-explicit-any
const errText = (r: { status: number; json: any }) => {
  const e = r.json?.errors; const m = Array.isArray(e) ? e.filter(Boolean).join('; ') : (e && typeof e === 'object' ? Object.values(e).join('; ') : '')
  return (r.status === 403 ? 'AxisCare refused: this connection may not change responsible parties' : 'AxisCare answered ' + r.status) + (m ? ' (' + String(m).slice(0, 240) + ')' : '')
}
const ok2 = (s: number) => s >= 200 && s < 300
// deno-lint-ignore no-explicit-any
const rows = (v: any): any[] => Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : [])

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const { role, email } = jwtClaims(req.headers.get('Authorization'))
  if (role !== 'authenticated' || !email) return json({ error: 'sign in to the hub first' }, 401)
  const b = await req.json().catch(() => ({})) as Record<string, unknown>
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const action = String(b.action ?? '')

  if (action === 'carry') {
    const staff = await requireStaff(sb, req, OFFICE_ROLES)
    if (!staff.ok) return json({ error: staff.error }, staff.status)
    const leadId = t(b.lead_id), who = t(b.who)
    const key = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t(b.person_key)) ? t(b.person_key).toLowerCase() : null
    if (!leadId || leadId.length > 80) return json({ error: 'lead_id is required' }, 400)
    if (!['client', 'caller', 'person'].includes(who)) return json({ error: "who must be 'client', 'caller' or 'person'" }, 400)
    if (who === 'person' && !key) return json({ error: 'person_key is required' }, 400)
    const { data, error } = await sb.rpc('people_into_care_add', { p_lead_id: leadId, p_who: who, p_person_key: who === 'person' ? key : null, p_staff: staff.email })
    return error ? json({ error: 'not added: ' + error.message }, 500) : json(data)
  }

  if (action === 'link') {
    const { data, error } = await sb.rpc('family_circle_link', { p_circle_id: t(b.circle_id), p_axiscare_client_id: t(b.axiscare_client_id), p_staff: email, p_how: 'person' })
    return error ? json({ error: 'not linked: ' + error.message }, 500) : json(data)
  }
  if (action === 'unlink') {
    const { data, error } = await sb.rpc('family_circle_unlink', { p_circle_id: t(b.circle_id), p_staff: email, p_reason: t(b.reason) })
    return error ? json({ error: 'not unlinked: ' + error.message }, 500) : json(data)
  }
  if (!['rp_view', 'rp_write', 'rp_add'].includes(action)) return json({ error: 'unknown action' }, 400)

  const { data: m } = await sb.from('circle_contacts').select('*').eq('id', b.contact_id as never).maybeSingle()
  if (!m) return json({ error: 'no such family member' }, 404)
  const { data: circle } = await sb.from('care_circles').select('id, client_name, axiscare_client_id, active').eq('id', m.circle_id).maybeSingle()
  const cax = t(circle?.axiscare_client_id)
  if (!circle || circle.active === false || !/^\d+$/.test(cax)) return json({ outcome: 'circle_not_linked', detail: 'link this Family Circle to its client first' })
  const all = await ax('GET', `/api/clients/${cax}/responsibleParties`)
  if (!ok2(all.status) && all.status !== 404) return json({ error: 'could not read AxisCare: ' + errText(all) }, 502)
  const list = rows(all.json?.results?.responsibleParties ?? all.json?.results ?? []).filter((p) => t(p?.name))
  const slotOf = (n: number) => list.find((p) => Number(p?.listNumber) === n) ?? null

  if (action === 'rp_view' || action === 'rp_write') {
    if (t(m.source) !== 'axiscare' || !m.axiscare_list_number) return json({ outcome: 'not_axiscare_member', detail: 'this person was typed in the office; use "Add to AxisCare"' })
    const current = slotOf(Number(m.axiscare_list_number))
    if (!current) return json({ outcome: 'slot_gone', detail: 'AxisCare no longer lists this person; the nightly sync will mark them' })
    if (action === 'rp_view') return json({ outcome: 'ok', axiscare: slotView(current), hub: { name: m.name, relationship: m.relationship, phone: m.phone, email: m.email } })
    const change = { name: t(b.name) || t(current.name), relationship: t(b.relationship) || null, phone: t(b.phone) || null, email: t(b.email) || null }
    if (!change.name) return json({ outcome: 'name_required' })
    const w = await ax('PUT', `/api/clients/${cax}/responsibleParties/${Number(m.axiscare_list_number)}`, putBody(current, change))
    const rpWhat = 'responsible party ' + Number(m.axiscare_list_number) + ' updated'
    if (!ok2(w.status)) {
      await recordAxisChange(sb, { kind: 'responsible_party', subject: 'client', client: cax, outcome: 'refused', summary: rpWhat, detail: errText(w), by: email, via: 'family-circles' })
      return json({ outcome: 'refused', detail: errText(w) })
    }
    const back = await ax('GET', `/api/clients/${cax}/responsibleParties/${Number(m.axiscare_list_number)}`)
    const v = ok2(back.status) ? slotView(back.json?.results ?? back.json) : null
    if (!v) {
      await recordAxisChange(sb, { kind: 'responsible_party', subject: 'client', client: cax, outcome: 'sent', summary: rpWhat, detail: 'accepted, but could not be read back', by: email, via: 'family-circles' })
      return json({ outcome: 'written_unconfirmed', detail: 'AxisCare accepted it but could not be read back: ' + errText(back) })
    }
    await sb.from('circle_contacts').update({ name: v.name, relationship: v.relationship, phone: v.phone, email: v.email,
      hipaa_authorized: v.hipaa_authorized, can_make_medical_decisions: v.can_make_medical_decisions, axiscare_removed_at: null,
      axiscare_sent_by: email, axiscare_sent_at: new Date().toISOString() }).eq('id', m.id)
    const matches = v.name === change.name && (change.phone ? v.phone === change.phone : true) && (v.email ?? null) === (change.email ?? null)
    await recordAxisChange(sb, { kind: 'responsible_party', subject: 'client', client: cax, outcome: matches ? 'sent_confirmed' : 'sent', summary: rpWhat,
      detail: matches ? null : 'AxisCare holds it slightly differently', by: email, via: 'family-circles' })
    return json({ outcome: matches ? 'saved' : 'saved_differently', axiscare: v, by: email })
  }

  // rp_add: an office-typed member into a free AxisCare slot
  if (t(m.source) === 'axiscare') return json({ outcome: 'already_in_axiscare' })
  const free = [1, 2, 3].find((n) => !slotOf(n))
  if (!free) return json({ outcome: 'no_free_slot', detail: 'AxisCare already has three responsible parties for this client' })
  if (list.some((p) => t(p?.name).toLowerCase() === t(m.name).toLowerCase())) return json({ outcome: 'already_listed', detail: 'AxisCare already lists someone with this name' })
  const body = { name: t(m.name), relationship: t(m.relationship) || null, email: t(m.email) || null,
    phones: t(m.phone) ? [{ listNumber: '1', type: 'Mobile', number: t(m.phone) }] : [] }
  const w = await ax('PUT', `/api/clients/${cax}/responsibleParties/${free}`, body)
  const addWhat = 'responsible party ' + free + ' added'
  if (!ok2(w.status)) {
    await recordAxisChange(sb, { kind: 'responsible_party', subject: 'client', client: cax, outcome: 'refused', summary: addWhat, detail: errText(w), by: email, via: 'family-circles' })
    return json({ outcome: 'refused', detail: errText(w) })
  }
  const back = await ax('GET', `/api/clients/${cax}/responsibleParties/${free}`)
  const v = ok2(back.status) ? slotView(back.json?.results ?? back.json) : null
  if (!v || v.name.toLowerCase() !== t(m.name).toLowerCase()) {
    await recordAxisChange(sb, { kind: 'responsible_party', subject: 'client', client: cax, outcome: 'sent', summary: addWhat, detail: 'accepted, but the read-back did not show them yet', by: email, via: 'family-circles' })
    return json({ outcome: 'written_unconfirmed', detail: 'AxisCare accepted it but the read-back did not show them yet' })
  }
  await sb.from('circle_contacts').update({ source: 'axiscare', axiscare_list_number: free, axiscare_removed_at: null,
    axiscare_sent_by: email, axiscare_sent_at: new Date().toISOString() }).eq('id', m.id)
  await recordAxisChange(sb, { kind: 'responsible_party', subject: 'client', client: cax, outcome: 'sent_confirmed', summary: addWhat, by: email, via: 'family-circles' })
  return json({ outcome: 'added', list_number: free, axiscare: v, by: email })
})
