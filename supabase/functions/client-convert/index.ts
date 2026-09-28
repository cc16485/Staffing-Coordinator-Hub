// =============================================================================
// client-convert — Convert a lead into an AxisCare client (Change 2, 2026-09-26)
// =============================================================================
// Replaces the create path of the Training project's axiscare-convert-lead (which
// used a shared key every signed-in user could read). Signed-in staff only.
//
//   preview   what WOULD be sent to AxisCare, built from the lead as saved, plus
//             anything missing. Read only (also looks for a client this lead
//             already created, by externalId).
//   convert   the coordinator's click on "Create in AxisCare":
//               1. reuse the AxisCare client tagged cchub-lead:<lead id>, or create one
//                  (if AxisCare refuses the full record, create the minimum and add
//                  each part separately, so one bad field never blocks the client)
//               2. the referral source, on its own
//               3. the intake note (attributes checklist for hand entry), as before
//               4. read back the client; report what AxisCare holds and what is
//                  still a hand step
//             Gate 4b (2026-09-28): Convert no longer writes anyone as a responsible
//             party. The coordinator picks who goes into the Family Circle and who
//             becomes an AxisCare responsible party in "People going into care"
//             (family-circles carry + rp_add: a click each, read back).
//             The hub stores the report on the lead (axiscare_convert) and connects
//             the Journey, as before.
//   permission_check  (service role only) proves the AxisCare token may change a
//             client by writing Test Client 5's own priority note back unchanged.
//
// Never sent: start date (comes from Actual SOC later), classes (care level and
// payer are mixed there), status (AxisCare makes new clients Active, as today),
// HIPAA / medical-decision flags (nobody asserted them).
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const AC_VERSION = '2023-10-01'
const PERMISSION_TEST_CLIENT = '290'   // "Test Client 5" in AxisCare

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

// ── the mapping: pure, tested in client_convert_test.mjs ─────────────────────
const t = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '')
export const isSelf = (rel: unknown) => /^(self|myself|me|client|the client|patient)$/i.test(t(rel))
const PRO = /case\s*manag|social\s*work|discharge|planner|nurse|\brn\b|\blpn\b|hospital|facility|agency|physician|doctor|\bdr\b|therap|hospice|provider|coordinator|staff|referral|advocate|counsel|chaplain|clinic|rehab|home health|\bpace\b|aaa\b|area agency|\bdhss\b|dsds|guardian ad litem|attorney|lawyer/i
export const isProfessional = (rel: unknown) => PRO.test(t(rel))
export function chicagoYmd(at: unknown): string | null {
  const s = t(at); if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const d = new Date(s); if (!Number.isFinite(d.getTime())) return null
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(d)
}
const ymd = (v: unknown) => { const s = t(v); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null }

export type Plan = {
  ok: boolean; blockers: string[]; missing: string[]; notes: string[]
  client: Record<string, unknown>; referral: { type: string; name: string } | null
  external_id: string; client_name: string; contact_name: string; self: boolean
}
// deno-lint-ignore no-explicit-any
export function planConvert(lead: any, choices: { phone_type?: string } | null, today: string, refOrgName: string | null): Plan {
  const L = lead || {}
  const self = isSelf(L.relationship)
  const contactName = [t(L.first_name), t(L.last_name)].filter(Boolean).join(' ')
  let first = t(L.client_first_name), last = t(L.client_last_name)
  const blockers: string[] = [], missing: string[] = [], notes: string[] = []
  if (!first && !last && self) { first = t(L.first_name); last = t(L.last_name) }
  if (!first || !last) blockers.push(self ? 'The lead needs a first and last name.'
    : 'The client\'s own first and last name are needed (Convert never uses the caller\'s name for the client). Add them on the lead, or set Relationship to "Self" if the caller is the client.')
  const client: Record<string, unknown> = { firstName: first, lastName: last, externalId: 'cchub-lead:' + t(L.id) }
  const dob = ymd(L.client_dob); if (dob) client.dateOfBirth = dob; else missing.push('date of birth')
  const g = t(L.client_gender).toLowerCase()
  if (g === 'male' || g === 'm') client.gender = 'M'; else if (g === 'female' || g === 'f') client.gender = 'F'; else missing.push('gender')
  const addr = { streetAddress1: t(L.client_address), city: t(L.client_city), state: t(L.client_state).toUpperCase(), postalCode: t(L.client_zip) }
  if (addr.streetAddress1 && addr.city && /^[A-Z]{2}$/.test(addr.state) && addr.postalCode) client.residentialAddress = { ...addr, streetAddress2: null }
  else {
    const gaps = [!addr.streetAddress1 && 'street', !addr.city && 'city', !/^[A-Z]{2}$/.test(addr.state) && 'state (2 letters)', !addr.postalCode && 'ZIP'].filter(Boolean)
    missing.push('address (' + gaps.join(', ') + ' missing; AxisCare needs the whole address, so none is sent)')
  }
  const phone = t(L.client_phone) || (self ? t(L.phone) : '')
  const phoneType = choices?.phone_type === 'mobile' ? 'mobile' : 'home'
  if (phone) client[phoneType === 'mobile' ? 'mobilePhone' : 'homePhone'] = phone
  else missing.push(self ? 'phone' : 'the client\'s own phone (the caller\'s phone never goes on the client)')
  if (self && t(L.email)) client.personalEmail = t(L.email)
  const dcn = t(L.dcn); if (dcn) client.medicaidNumber = dcn
  const assessed = chicagoYmd(L.assessment_at); if (assessed) client.assessmentDate = assessed
  client.conversionDate = today
  const refName = refOrgName || t(L.referral_source_name)
  const referral = refName ? { type: 'other', name: refName.slice(0, 120) } : null
  if (!t(L.relationship) && !self) notes.push('No relationship is recorded for the caller.')
  return { ok: blockers.length === 0, blockers, missing, notes, client, referral,
           external_id: String(client.externalId), client_name: [first, last].filter(Boolean).join(' '), contact_name: contactName, self }
}

const ATTR_LABELS: Record<string, string> = {
  alzheimers: "Alzheimer's Disease", bed_bound: 'Bed Bound', cats: 'Cats', dementia: 'Dementia',
  dogs: 'Dogs', female_caregiver: 'Female Caregiver', gait_belt: 'Gait Belt', hospice: 'Hospice',
  hoyer_lift: 'Hoyer Lift', male_caregiver: 'Male Caregiver',
  parkinsons: "Parkinson's Disease Experience", payor_medicaid: 'Payor - Medicaid',
  payor_private_pay: 'Payor - Private Pay', personal_care: 'Personal Care', smoking: 'Smoking',
  spanish_speaking: 'Spanish Speaking', transportation: 'Transportation',
}
// deno-lint-ignore no-explicit-any
export function intakeNote(L: any): string {
  const s = (v: unknown) => t(v)
  const attrs = (L.client_attributes ?? {}) as Record<string, string>
  const attrLines = Object.keys(ATTR_LABELS)
    .map((k) => `${attrs[k] === 'yes' ? 'YES ' : attrs[k] === 'no' ? 'NO  ' : attrs[k] === 'preferred' ? 'PREF' : '-   '} ${ATTR_LABELS[k]}`).join('\n')
  return `CONVERTED LEAD: intake summary (from the Care Coordinator's Hub)\n` +
    `Contact: ${s(L.first_name)} ${s(L.last_name)}${s(L.relationship) ? ` (${s(L.relationship)})` : ''}${s(L.phone) ? ` · ${s(L.phone)}` : ''}${s(L.email) ? ` · ${s(L.email)}` : ''}\n` +
    (s(L.urgency) ? `Urgency at intake: ${s(L.urgency)}\n` : '') +
    (s(L.funding_source) ? `Funding: ${s(L.funding_source)}\n` : '') +
    (s(L.quoted_price_amount) ? `Rate quoted: ${s(L.quoted_price_amount)}\n` : '') +
    (s(L.ai_needs_summary) ? `\nNeeds summary:\n${s(L.ai_needs_summary)}\n` : '') +
    (s(L.interest_notes) ? `\nIntake call notes:\n${s(L.interest_notes).slice(0, 2500)}\n` : '') +
    `\nATTRIBUTES from intake: enter on the client's Attributes screen (the API can't set these):\n${attrLines}`
}

// ── AxisCare ─────────────────────────────────────────────────────────────────
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
  const e = r.json?.errors; const m = Array.isArray(e) ? e.join('; ') : (e && typeof e === 'object' ? Object.values(e).join('; ') : '')
  return (r.status === 403 ? 'AxisCare refused: this connection may not change clients' : 'AxisCare answered ' + r.status) + (m ? ' (' + String(m).slice(0, 200) + ')' : '')
}
// deno-lint-ignore no-explicit-any
async function findByExternalId(ext: string): Promise<{ ids: string[]; error: string | null }> {
  const r = await ax('GET', `/api/clients?externalIds=${encodeURIComponent(ext)}`)
  if (r.status === 404) return { ids: [], error: null }
  if (r.status !== 200) return { ids: [], error: errText(r) }
  // deno-lint-ignore no-explicit-any
  const rows: any[] = r.json?.results?.clients ?? []
  return { ids: rows.filter((c) => String(c?.externalId ?? '') === ext).map((c) => String(c.id)), error: null }
}
// deno-lint-ignore no-explicit-any
const idOf = (j: any) => j?.results?.id ?? j?.results?.client?.id ?? j?.id ?? null
const ok2 = (s: number) => s >= 200 && s < 300

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const { role, email } = jwtClaims(req.headers.get('Authorization'))
  const b = await req.json().catch(() => ({})) as Record<string, unknown>

  if (b.action === 'permission_check') {
    if (role !== 'service_role') return json({ error: 'owner script only' }, 403)
    const g = await ax('GET', `/api/clients/${PERMISSION_TEST_CLIENT}`)
    const c = g.json?.results?.client ?? g.json?.results
    if (g.status !== 200 || !c) return json({ ok: false, step: 'read', detail: errText(g) })
    const name = [c.firstName, c.lastName].filter(Boolean).join(' ')
    if (!/test/i.test(name)) return json({ ok: false, step: 'read', detail: `client #${PERMISSION_TEST_CLIENT} is "${name}", not a test client; nothing was written` })
    const same = c.priorityNote ?? null
    const p = await ax('PATCH', `/api/clients/${PERMISSION_TEST_CLIENT}`, { priorityNote: same })
    const after = await ax('GET', `/api/clients/${PERMISSION_TEST_CLIENT}`)
    const a = after.json?.results?.client ?? after.json?.results
    return json({ ok: ok2(p.status) && (a?.priorityNote ?? null) === same, client: name, write_status: p.status,
                  detail: ok2(p.status) ? 'wrote the same priority note back; unchanged on read-back' : errText(p) })
  }

  if (role !== 'authenticated' || !email) return json({ error: 'sign in to the hub first' }, 401)
  const leadId = t(b.lead_id)
  if (!leadId || leadId.length > 80) return json({ error: 'lead_id is required' }, 400)
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: row, error } = await sb.from('app_data').select('data').eq('key', 'leads').maybeSingle()
  if (error) return json({ error: 'could not read leads: ' + error.message }, 500)
  // deno-lint-ignore no-explicit-any
  const lead = (Array.isArray(row?.data) ? row!.data : []).find((l: any) => l && String(l.id) === leadId)
  if (!lead) return json({ error: 'no such lead (save the lead first)' }, 404)
  let refOrg: string | null = null
  if (lead.referral_org_id) {
    const { data: orgs } = await sb.from('app_data').select('data').eq('key', 'referral_orgs').maybeSingle()
    // deno-lint-ignore no-explicit-any
    const o = (Array.isArray(orgs?.data) ? orgs!.data : []).find((x: any) => x && x.id === lead.referral_org_id)
    refOrg = o?.name ? String(o.name) : null
  }
  const today = chicagoYmd(new Date().toISOString())!
  const choices = { phone_type: t(b.phone_type) }
  const plan = planConvert(lead, choices, today, refOrg)
  const linked = t(lead.axiscare_client_id)

  if (b.action === 'preview') {
    const found = plan.ok ? await findByExternalId(plan.external_id) : { ids: [], error: null }
    return json({ plan, linked: linked || null, existing: found.ids, existing_error: found.error })
  }
  if (b.action !== 'convert') return json({ error: "action must be 'preview' or 'convert'" }, 400)
  if (linked) return json({ outcome: 'already_linked', axiscare_client_id: linked })
  if (!plan.ok) return json({ outcome: 'blocked', blockers: plan.blockers })

  const steps: Record<string, { ok: boolean; detail?: string }> = {}
  // 1. reuse or create
  const found = await findByExternalId(plan.external_id)
  if (found.error) return json({ outcome: 'error', detail: 'could not check for an existing client: ' + found.error })
  if (found.ids.length > 1) return json({ outcome: 'duplicate', ids: found.ids, detail: 'AxisCare already has more than one client from this lead; a person must choose' })
  let clientId = found.ids[0] ?? null, outcome = clientId ? 'reused' : 'created'
  const failedFields: string[] = []
  if (!clientId) {
    const full = await ax('POST', '/api/clients', plan.client)
    clientId = ok2(full.status) ? idOf(full.json) : null
    if (!clientId) {
      if (full.status === 403 || full.status === 0) return json({ outcome: 'error', detail: errText(full) })
      const min = await ax('POST', '/api/clients', { firstName: plan.client.firstName, lastName: plan.client.lastName, externalId: plan.external_id })
      clientId = ok2(min.status) ? idOf(min.json) : null
      if (!clientId) return json({ outcome: 'error', detail: 'AxisCare would not create the client: ' + errText(min) })
      steps.full_record = { ok: false, detail: errText(full) + '; created with the name only, adding the rest one part at a time' }
      const groups: Record<string, string[]> = { 'date of birth': ['dateOfBirth'], gender: ['gender'], address: ['residentialAddress'],
        phone: ['homePhone', 'mobilePhone'], email: ['personalEmail'], 'Medicaid number': ['medicaidNumber'], dates: ['assessmentDate', 'conversionDate'] }
      for (const [label, keys] of Object.entries(groups)) {
        const part: Record<string, unknown> = {}; keys.forEach((k) => { if (k in plan.client) part[k] = plan.client[k] })
        if (!Object.keys(part).length) continue
        const p = await ax('PATCH', `/api/clients/${clientId}`, part)
        if (!ok2(p.status)) failedFields.push(label + ': ' + errText(p))
      }
    }
  }
  clientId = String(clientId)
  const dupe = await findByExternalId(plan.external_id)
  if (dupe.ids.length > 1) steps.duplicate_check = { ok: false, detail: 'AxisCare now shows ' + dupe.ids.length + ' clients from this lead (' + dupe.ids.join(', ') + '); remove the extra one' }
  // 2. referral (responsible parties are the coordinator's pick, in People going into care)
  if (plan.referral) {
    const r = await ax('PATCH', `/api/clients/${clientId}`, { referredBy: plan.referral })
    steps.referral = ok2(r.status) ? { ok: true } : { ok: false, detail: errText(r) }
  }
  // 3. the intake note (only on a fresh create; a reuse already has it)
  if (outcome === 'created') {
    const n = await ax('POST', `/api/notes/client/${encodeURIComponent(clientId)}`, { note: intakeNote(lead).slice(0, 6000), important: true })
    steps.intake_note = ok2(n.status) ? { ok: true } : { ok: false, detail: errText(n) }
  }
  // 4. read back
  const rb = await ax('GET', `/api/clients/${clientId}`)
  const c = rb.json?.results?.client ?? rb.json?.results ?? null
  const has = (v: unknown) => v != null && String(typeof v === 'object' ? JSON.stringify(v) : v).replace(/[{}"\s:,]|null/g, '') !== ''
  const readback = rb.status === 200 && c ? {
    name: [c.firstName, c.lastName].filter(Boolean).join(' '), external_id: c.externalId ?? null,
    date_of_birth: has(c.dateOfBirth), gender: has(c.gender), address: has(c.residentialAddress?.streetAddress1),
    phone: has(c.homePhone) || has(c.mobilePhone), email: has(c.personalEmail), medicaid_number: has(c.medicaidNumber),
    referral: has(c.referredBy),
  } : null
  const hand = ['attributes (checklist in the intake note)', 'documents and the signed agreement', 'billing setup']
  return json({ outcome, axiscare_client_id: clientId, steps, failed_fields: failedFields, readback,
                readback_error: readback ? null : errText(rb), hand_steps: hand,
                record: { at: new Date().toISOString(), by: email, client_id: clientId, outcome,
                          sent: Object.keys(plan.client), phone_type: choices.phone_type === 'mobile' ? 'mobile' : 'home',
                          rp1: false, referral: !!plan.referral, steps, failed_fields: failedFields, readback } })
})
