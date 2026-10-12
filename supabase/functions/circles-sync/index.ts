// =============================================================================
// circles-sync: the nightly Family Circle sync from AxisCare, in its own function (Desktop 664)
// =============================================================================
// Samantha, 2026-10-12 ("yes build both"): the nightly Family Circle sync last ran 2026-10-03. It lived inside
// identity-backfill (?circles=1), which 441 deleted on purpose (her safe saves decision 3, 2026-10-04: its default mode
// rewrote the whole caregiver list) and which stays down. This is ONLY the circle sync, moved here unchanged: it reads
// AxisCare's responsible parties and writes care_circles / circle_contacts / family_circle_link_log. It never touches
// app_data, the caregiver list, the identity layer or anyone's texting consent (sms_consent is never set).
//   Who may call: its nightly schedule (the jobs' secret) or the owner's server key (full answer), or signed-in office
//   staff (the Hub's "Sync from AxisCare" button; counts only, never names). Everyone else is refused.
//   ?commit=1 writes; without it, a dry run (counts, and for the owner a sample). ?auth_check=1 says who is calling.
//   A real (committed) run leaves the heartbeat hb_circles-sync, which the Hub shows and the watchdog checks.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jobCaller } from '../_shared/job-auth.ts'
import { OFFICE_ROLES, requireStaff } from '../_shared/staff-auth.ts'

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b, null, 2), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

/* counts only: numbers and yes/no stay, lists become their length, text is dropped */
// deno-lint-ignore no-explicit-any
export function countsOnly(o: any): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o ?? {})) {
    if (typeof v === 'number' || typeof v === 'boolean') out[k] = v
    else if (Array.isArray(v)) out[k] = v.length
    else if (k === 'mode' || k === 'error') out[k] = v
  }
  return out
}

/* ── FAMILY CIRCLES FROM AXISCARE ────────────────────────────────────────────
   AxisCare holds up to three responsible parties per client (Primary/
   Secondary/Tertiary) with relationship, phones, email and two authorisation
   flags. This pulls them into the hub's care_circles / circle_contacts so
   circles fill themselves instead of being typed.

   Rules (from AXISCARE-CAPABILITY.md): keep the tier and both flags as their
   own columns, never collapse to a "family" tag, never read POA into
   canMakeMedicalDecisions. And two of our own: NEVER set sms_consent (texting
   consent is a question a human asks, not a field a sync copies), and never
   overwrite a manually entered contact — matches by name fill blanks only.
   Dry run by default; ?commit=1 writes. */
async function syncCirclesFromAxisCare(commit: boolean) {
  const order = ['AXISCARE_API_KEY', 'AXISCARE_TOKEN', 'AXISCARE_VISITS_TOKEN']
  let token = ''
  for (const n of order) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  if (!token || !/^\d+$/.test(site)) return { error: 'AxisCare credentials not set on this project' }
  const HEAD = { Authorization: `Bearer ${token}`, Accept: 'application/json',
    'X-AxisCare-Api-Version': Deno.env.get('AXISCARE_API_VERSION') || '2023-10-01' }

  // Active clients from the identity layer: axiscare id + display name.
  const { data: links } = await sb.from('person_source_id')
    .select('person_id, source_id').eq('system', 'axiscare').eq('entity_type', 'client')
  const pids = (links ?? []).map(l => String(l.person_id))
  const { data: ppl } = await sb.from('person_identity').select('id, display_name').in('id', pids)
  const nameOf = new Map((ppl ?? []).map(p => [String(p.id), String(p.display_name)]))

  /* Change 6a (2026-09-27): a circle belongs to a client by AxisCare id. The sync
     finds it by id; an unlinked circle is linked here ONLY when the sync itself
     fed it (it has an AxisCare-sourced contact) and its name exactly matches one
     client and one active circle; a circle typed in the office waits for a person
     (and is never fed by name any more). New circles are created already linked. */
  const { data: circles } = await sb.from('care_circles').select('id, client_name, active, axiscare_client_id')
  const activeCircles = (circles ?? []).filter(c => c.active !== false)
  const circleByAx = new Map(activeCircles.filter(c => c.axiscare_client_id).map(c => [String(c.axiscare_client_id), c]))
  const nameCount = new Map<string, number>()
  for (const c of activeCircles) { const k = String(c.client_name ?? '').trim().toLowerCase(); nameCount.set(k, (nameCount.get(k) ?? 0) + 1) }
  const personNameCount = new Map<string, number>()
  for (const l of (links ?? [])) { const k = String(nameOf.get(String(l.person_id)) ?? '').trim().toLowerCase(); if (k) personNameCount.set(k, (personNameCount.get(k) ?? 0) + 1) }
  const { data: contacts } = await sb.from('circle_contacts').select('*')
  const contactsByCircle = new Map<string, any[]>()
  for (const ct of (contacts ?? [])) {
    const arr = contactsByCircle.get(String(ct.circle_id)) ?? []
    arr.push(ct); contactsByCircle.set(String(ct.circle_id), arr)
  }

  // Lists can come back keyed instead of as arrays (the rowsOf lesson).
  // deno-lint-ignore no-explicit-any
  const rowsOf = (x: any): any[] => Array.isArray(x) ? x
    : (x && typeof x === 'object' ? Object.values(x) : [])
  const pickPhone = (p: Record<string, unknown>) => {
    const phones = rowsOf(p?.phones).filter(ph => String((ph as any)?.number ?? (ph as any)?.phone ?? '').trim())
    const mob = phones.find(ph => /mobile/i.test(String((ph as any)?.type ?? '')))
    const first = (mob ?? phones[0]) as Record<string, unknown> | undefined
    return first ? String(first.number ?? first.phone ?? '').trim() : ''
  }
  /* AxisCare boolean-ish fields arrive as '1' / '0' / '' strings.
     True only for a positive answer; '' / missing yields null (unanswered),
     '0' yields false (an actual no). */
  const axYes = (v: unknown): boolean | null =>
    (v === true || v === 1 || v === '1') ? true
    : (v === false || v === 0 || v === '0') ? false
    : null

  const out = { mode: commit ? 'COMMIT' : 'DRY RUN', clients: (links ?? []).length,
    circles_created: 0, circles_linked: 0, waiting_for_person_link: 0, contacts_added: 0, contacts_updated: 0,
    contacts_marked_removed: 0, contacts_back_on_axiscare: 0,
    already_present: 0, clients_with_no_parties: 0, manual_untouched: 0, skipped_past: 0,
    errors: [] as string[],
    sample: [] as Array<Record<string, unknown>> }

  /* PAST AND DECEASED CLIENTS (Samantha 2026-10-07): the sync only keeps Family Circles for CURRENT clients (an active client
     role). A past or deceased client gets no new circle and no new contacts; nothing already there is removed. */
  const { data: curRoles } = await sb.from('person_role').select('person_id').eq('role', 'client').eq('status', 'active')
  const current = new Set((curRoles ?? []).map((r) => String(r.person_id)))
  out.skipped_past = 0
  for (const l of (links ?? [])) {
    const ax = String(l.source_id)
    const clientName = nameOf.get(String(l.person_id)) ?? ''
    if (!clientName) continue
    if (!current.has(String(l.person_id))) { out.skipped_past++; continue }
    // deno-lint-ignore no-explicit-any
    let parties: any[] = []
    try {
      const r = await fetch(`https://${site}.axiscare.com/api/clients/${ax}/responsibleParties`, { headers: HEAD })
      if (!r.ok) { if (r.status !== 404) out.errors.push(`${clientName}: AxisCare ${r.status}`); continue }
      // deno-lint-ignore no-explicit-any
      const j: any = await r.json().catch(() => ({}))
      parties = rowsOf(j?.results?.responsibleParties ?? j?.responsibleParties ?? j?.results ?? j)
        .filter(p => String((p as any)?.name ?? '').trim())
    } catch (err) { out.errors.push(`${clientName}: ${String(err)}`); continue }

    let circle = circleByAx.get(ax)
    if (!circle) {
      const nk = clientName.trim().toLowerCase()
      const byName = activeCircles.find(c => !c.axiscare_client_id && String(c.client_name ?? '').trim().toLowerCase() === nk)
      if (byName) {
        const fedBySync = (contactsByCircle.get(String(byName.id)) ?? []).some(ct => String(ct.source ?? '') === 'axiscare')
        if (!fedBySync || nameCount.get(nk) !== 1 || personNameCount.get(nk) !== 1) { out.waiting_for_person_link++; continue }
        out.circles_linked++
        if (commit) {
          const { data, error } = await sb.rpc('family_circle_link', { p_circle_id: String(byName.id), p_axiscare_client_id: ax,
            p_staff: 'automation:circles-sync', p_how: 'sync_exact' })
          if (error || !['linked', 'already_linked'].includes(data?.outcome)) { out.errors.push(`${clientName} link: ${error?.message ?? data?.outcome}`); continue }
        }
        circle = { ...byName, axiscare_client_id: ax }
        circleByAx.set(ax, circle)
      } else {
        if (!parties.length) { out.clients_with_no_parties++; continue }
        out.circles_created++
        if (commit) {
          const { data, error } = await sb.from('care_circles')
            .insert({ client_name: clientName, axiscare_client_id: ax, linked_by: 'automation:circles-sync', linked_at: new Date().toISOString(), link_how: 'sync_created' })
            .select('id, client_name, active, axiscare_client_id').single()
          if (error || !data) { out.errors.push(`${clientName} circle: ${error?.message}`); continue }
          await sb.from('family_circle_link_log').insert({ circle_id: String(data.id), axiscare_client_id: ax, action: 'link', staff: 'automation:circles-sync', reason: 'created by the nightly AxisCare sync' })
          circle = data
        } else {
          circle = { id: '(new)', client_name: clientName, axiscare_client_id: ax }
        }
        circleByAx.set(ax, circle)
      }
    }
    if (!parties.length) out.clients_with_no_parties++

    const mine = contactsByCircle.get(String(circle.id)) ?? []
    const seen = new Set<string>()
    for (const p of parties) {
      const nm = String(p.name).trim()
      seen.add(nm.toLowerCase())
      const tier = Number(p.listNumber ?? parties.indexOf(p) + 1) || null
      const row = {
        name: nm, relationship: String(p.relationship ?? '').trim() || null,
        phone: pickPhone(p) || null, email: String(p.email ?? '').trim() || null,
        axiscare_list_number: tier,
        /* '1' / '0' / '' strings: '' stays null, because an unanswered question is not a "no" */
        hipaa_authorized: axYes(p.hipaaDisclosureAuthorization),
        can_make_medical_decisions: axYes(p.canMakeMedicalDecisions),
        source: 'axiscare',
      }
      const existing = mine.find(c => String(c.name ?? '').trim().toLowerCase() === nm.toLowerCase())
      if (existing) {
        /* Her ownership rule (2026-09-20): a contact typed in the office is never
           changed by automation. AxisCare-sourced contacts now FOLLOW AxisCare in
           full (Change 6a): AxisCare owns the responsible parties, so its values
           replace ours, including the old wrongly-false HIPAA flags. */
        if (String(existing.source ?? '') !== 'axiscare') { out.manual_untouched++; continue }
        const patch: Record<string, unknown> = {}
        for (const k of ['relationship', 'phone', 'email', 'axiscare_list_number', 'hipaa_authorized', 'can_make_medical_decisions'] as const) {
          if ((existing[k] ?? null) !== (row[k] ?? null)) patch[k] = row[k]
        }
        if (existing.axiscare_removed_at) { patch.axiscare_removed_at = null; out.contacts_back_on_axiscare++ }
        if (Object.keys(patch).length) {
          out.contacts_updated++
          if (commit) {
            const { error } = await sb.from('circle_contacts').update(patch).eq('id', existing.id)
            if (error) out.errors.push(`${clientName}/${nm}: ${error.message}`)
          }
        } else out.already_present++
        continue
      }
      out.contacts_added++
      if (out.sample.length < 15) out.sample.push({ client: clientName, ...row })
      if (commit) {
        const { error } = await sb.from('circle_contacts').insert({
          circle_id: circle.id, ...row, sms_consent: false, is_primary: tier === 1 && !mine.length,
        })
        if (error) out.errors.push(`${clientName}/${nm}: ${error.message}`)
      }
    }
    /* someone AxisCare no longer lists: marked, never deleted (their texting
       consent and history stay; the family senders leave them out) */
    for (const ct of mine) {
      if (String(ct.source ?? '') !== 'axiscare' || ct.axiscare_removed_at) continue
      if (seen.has(String(ct.name ?? '').trim().toLowerCase())) continue
      out.contacts_marked_removed++
      if (commit) {
        const { error } = await sb.from('circle_contacts').update({ axiscare_removed_at: new Date().toISOString() }).eq('id', ct.id)
        if (error) out.errors.push(`${clientName}/${ct.name}: ${error.message}`)
      }
    }
  }
  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })
  const job = await jobCaller(req)
  if (!job) {
    const who = await requireStaff(sb, req, OFFICE_ROLES)
    if (!who.ok) return json({ error: who.error }, who.status)
  }
  const q = new URL(req.url).searchParams
  if (q.get('auth_check') === '1') return json({ ok: true, caller: job || 'office staff' })
  const commit = q.get('commit') === '1'
  const res = await syncCirclesFromAxisCare(commit)
  if (commit) {
    // deno-lint-ignore no-explicit-any
    const r: any = res
    const errs = Array.isArray(r?.errors) ? r.errors.length : 0
    const ok = !r?.error && errs === 0
    try {
      await sb.rpc('upsert_app_data_item', { target_key: 'automation_heartbeats', item: {
        id: 'hb_circles-sync', automation: 'circles-sync', at: new Date().toISOString(), ok,
        note: ok ? 'synced' : String(r?.error || (errs + ' error' + (errs === 1 ? '' : 's'))).slice(0, 200) } })
    } catch (e) { console.error('[circles-sync] heartbeat failed', e) }
  }
  return json(job === 'owner' ? res : countsOnly(res))
})
