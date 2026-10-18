// =============================================================================
// caregiver-sync — every ACTIVE AxisCare caregiver joins the identity layer, with their phone numbers
// =============================================================================
// Samantha, 2026-10-14 ("1, 2, 3, 4, and 6"; item 2: the AI should know who is calling). The call and text reader
// (call-tasks) asks call_who whose number it is, and call_who reads phone_index. Caregivers only reached phone_index
// through the one-time identity-backfill, which 441 took down on 2026-10-04 (her safe saves decision 3). Caregivers
// hired since (Porcia L., Aimee D., Autumn R., ...) have no person at all, so their calls and texts came up "unknown".
// This is ONLY the caregiver half of that job, built the way client-sync is: it writes person_identity /
// person_source_id / person_role / phone_index rows for caregivers and never touches app_data's caregiver list.
//   Its schedule (every 6 hours, the jobs' secret) or the owner's server key may call it; everyone else is refused.
//   Links the Hub caregiver record holding the same AxisCare id (exactly one) to the same person. Never creates beside
//   a same-name person (left for a person to connect), never makes a former caregiver current, never ends anyone.
//   Counts only in the answer and the heartbeat. ?dry=1 counts without writing; ?auth_check=1 says who is calling.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jobCaller } from '../_shared/job-auth.ts'
import { readCensus, type CensusRow } from '../_shared/axis-census.ts'

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b, null, 2), { status: s, headers: { 'Content-Type': 'application/json' } })

export const e164 = (raw: unknown): string | null => {
  const d = String(raw ?? '').replace(/\D/g, '')
  if (d.length === 10) return '+1' + d
  if (d.length === 11 && d.startsWith('1')) return '+' + d
  return null
}

// deno-lint-ignore no-explicit-any
type Any = any

export async function syncActiveCaregivers(sb: Any, rows: CensusRow[], commit: boolean) {
  const active = rows.filter(r => r.active)
  const out = { axiscare_caregivers_total: rows.length, axiscare_active_caregivers: active.length,
    already_linked: 0, created: 0, roles_added: 0, former_left_for_a_person: 0, hub_records_linked: 0,
    hub_record_ambiguous: 0, phones_indexed: 0, no_phone: 0, skipped_no_name: 0,
    name_coincidences: [] as Any[], errors: [] as string[] }

  const { data: src, error: se } = await sb.from('person_source_id').select('person_id, system, entity_type, source_id')
    .in('entity_type', ['caregiver']).in('system', ['axiscare', 'hub'])
  if (se) return { ...out, error: 'could not read person_source_id: ' + se.message }
  const axLinked = new Map<string, string>(), hubLinked = new Map<string, string>()
  for (const s of src ?? []) (s.system === 'axiscare' ? axLinked : hubLinked).set(String(s.source_id), String(s.person_id))

  const { data: ppl, error: pe } = await sb.from('person_identity').select('id, display_name')
  if (pe) return { ...out, error: 'could not read person_identity: ' + pe.message }
  const nameOwners = new Map<string, string>()
  for (const p of ppl ?? []) { const k = String(p.display_name ?? '').trim().toLowerCase(); if (k) nameOwners.set(k, String(p.id)) }

  const { data: cgRow } = await sb.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()
  const hubCgs: Any[] = Array.isArray(cgRow?.data) ? cgRow.data : []
  const hubByAx = new Map<string, Any[]>()
  for (const c of hubCgs) {
    const ax = String(c?.axiscare_id ?? '').trim()
    if (ax) hubByAx.set(ax, [...(hubByAx.get(ax) ?? []), c])
  }

  for (const c of active) {
    const axId = String(c.id || '')
    const name = [c.first, c.last].map(s => String(s || '').trim()).filter(Boolean).join(' ')
    if (!axId || !name) { out.skipped_no_name++; continue }
    const hubRecs = hubByAx.get(axId) ?? []
    const hub = hubRecs.length === 1 ? hubRecs[0] : null
    if (hubRecs.length > 1) out.hub_record_ambiguous++
    const phones: Array<{ phone: string; kind: string; system: string; rec: string }> = []
    const ax = e164(c.mobile); if (ax) phones.push({ phone: ax, kind: 'mobile', system: 'axiscare', rec: axId })
    const hp = e164(hub?.phone)
    if (hp && hp !== ax) phones.push({ phone: hp, kind: 'mobile', system: 'hub', rec: String(hub.id) })
    if (!phones.length) out.no_phone++

    let personId = axLinked.get(axId) ?? (hub ? hubLinked.get(String(hub.id)) : undefined) ?? null
    if (personId) out.already_linked++
    else {
      const twin = nameOwners.get(name.toLowerCase())
      if (twin) {
        out.name_coincidences.push({ name, axiscare_id: axId,
          note: 'a person with this exact name already exists WITHOUT this AxisCare caregiver id, left unconnected for a person to check' })
        continue
      }
      if (!commit) { out.created++; continue }
      const { data: pi, error: e1 } = await sb.from('person_identity')
        .insert({ display_name: name, primary_phone: phones[0]?.phone ?? null }).select('id').single()
      if (e1 || !pi) { out.errors.push(`${name}: ${e1?.message ?? 'insert failed'}`); continue }
      personId = String(pi.id)
      nameOwners.set(name.toLowerCase(), personId)
      out.created++
    }
    if (!commit) continue

    if (!axLinked.has(axId)) {
      const { error } = await sb.from('person_source_id').insert({ person_id: personId, system: 'axiscare',
        entity_type: 'caregiver', source_id: axId, confidence: 'confirmed', needs_review: false,
        evidence: 'caregiver-sync: active AxisCare caregiver', imported_at: new Date().toISOString() })
      if (error) { out.errors.push(`${name} link: ${error.message}`); continue }
      axLinked.set(axId, personId)
    }
    /* The Hub record is linked only when exactly one Hub caregiver carries this AxisCare id and no other person
       already holds that Hub record (an AxisCare id is the evidence; a name never is). */
    if (hub && !hubLinked.has(String(hub.id))) {
      const { error } = await sb.from('person_source_id').insert({ person_id: personId, system: 'hub',
        entity_type: 'caregiver', source_id: String(hub.id), confidence: 'confirmed', needs_review: false,
        evidence: 'caregiver-sync: Hub caregiver record holds AxisCare id ' + axId, imported_at: new Date().toISOString() })
      if (error) out.errors.push(`${name} hub link: ${error.message}`)
      else { hubLinked.set(String(hub.id), personId); out.hub_records_linked++ }
    }

    const { data: role } = await sb.from('person_role').select('id')
      .eq('person_id', personId).eq('role', 'caregiver').eq('status', 'active').maybeSingle()
    const { data: past } = role ? { data: null } : await sb.from('person_role').select('id')
      .eq('person_id', personId).eq('role', 'caregiver').neq('status', 'active').limit(1).maybeSingle()
    if (!role && past) out.former_left_for_a_person++
    else if (!role) {
      const { error } = await sb.from('person_role').insert({ person_id: personId, role: 'caregiver', status: 'active' })
      if (error) out.errors.push(`${name} role: ${error.message}`)
      else out.roles_added++
    }

    for (const ph of phones) {
      const { data: have } = await sb.from('phone_index').select('id').eq('phone', ph.phone).eq('person_id', personId).maybeSingle()
      if (have) continue
      /* Provenance is stated, never inherited: where the number came from is written on the row. */
      const { error } = await sb.from('phone_index').insert({ phone: ph.phone, person_id: personId, kind: ph.kind,
        source_system: ph.system, source_record_id: ph.rec, confidence: 'confirmed', imported_at: new Date().toISOString() })
      if (error) out.errors.push(`${name} phone: ${error.message}`)
      else out.phones_indexed++
    }
  }
  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200 })
  const q = new URL(req.url).searchParams
  const who = await jobCaller(req)
  if (!who) return json({ error: 'not allowed' }, 401)
  if (q.get('auth_check') === '1') return json({ ok: true, caller: who })
  const commit = q.get('dry') !== '1'
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const census = await readCensus()
  // deno-lint-ignore no-explicit-any
  const res: any = census.ok ? await syncActiveCaregivers(sb, census.rows, commit) : { error: census.error }
  if (census.ok && census.truncated) res.truncated = true
  const errs = Array.isArray(res?.errors) ? res.errors.length : 0
  const ok = !res?.error && errs === 0
  const created = res?.created ?? 0, left = Array.isArray(res?.name_coincidences) ? res.name_coincidences.length : 0
  if (commit) {
    try {
      await sb.rpc('upsert_app_data_item', { target_key: 'automation_heartbeats', item: {
        id: 'hb_caregiver-sync', automation: 'caregiver-sync', at: new Date().toISOString(), ok,
        note: ok ? `${created} new caregiver${created === 1 ? '' : 's'} added, ${left} left to connect by hand`
                 : String(res?.error || (errs + ' error' + (errs === 1 ? '' : 's'))).slice(0, 200) } })
    } catch (e) { console.error('[caregiver-sync] heartbeat failed', e) }
  }
  /* counts only: numbers stay, lists become their length, text is dropped */
  const out: Record<string, unknown> = { ok, mode: commit ? 'commit' : 'dry' }
  for (const [k, v] of Object.entries(res ?? {})) {
    if (typeof v === 'number' || typeof v === 'boolean') out[k] = v
    else if (Array.isArray(v)) out[k] = v.length
    else if (k === 'error') out[k] = v
  }
  return json(out)
})
