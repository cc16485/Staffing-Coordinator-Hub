// =============================================================================
// client-sync — every ACTIVE AxisCare client the Hub doesn't have yet joins the identity layer
// =============================================================================
// Samantha, 2026-10-12: "dan has not been pulled over from Axiscare!". Clients only reached the Hub through Convert or the
// one-time identity-backfill ?clients=1 run (Desktop 122). identity-backfill was taken down on purpose by 441 (her safe
// saves decision 3, 2026-10-04: its default mode rewrote the whole caregiver list) and stays down. This is ONLY its client
// part, moved here: it writes person_identity / person_source_id / person_role / phone_index rows for clients and never
// touches app_data's caregiver or candidate lists.
//   Its schedule (every 6 hours, the jobs' secret) or the owner's server key may call it; everyone else is refused.
//   Never makes a past client current again, never creates beside a same-name person (left for a person to connect; the
//   Clients directory shows them as "Not connected yet"), never ends anyone. Counts only in the answer and the heartbeat.
//   ?dry=1 counts without writing; ?auth_check=1 says who is calling.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jobCaller } from '../_shared/job-auth.ts'
import { loadNotClients, isNotClient } from '../_shared/client-quiet.ts'   // Office Staff and other not-clients (2026-10-12)

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b, null, 2), { status: s, headers: { 'Content-Type': 'application/json' } })

/* ── CLIENT BACKFILL FROM AXISCARE ───────────────────────────────────────────
   The August rebuild covered caregivers only, because AxisCare was blocked and
   caregivers were the population with a reconciled roster. Clients therefore
   have NO identity rows, which surfaced 2026-09-12 when coverage-run's ranked
   waves found zero clients to resolve ("worked with this client first" needs
   the client to exist).

   AxisCare is the authoritative system for clients, so unlike the GHL-era
   phone recovery above this creates CONFIRMED links: /api/clients?active=true
   → person_identity + person_source_id(axiscare/client, confirmed) +
   person_role(client, active) + phone_index rows. Idempotent: an existing
   axiscare client link means the person is reused, never duplicated. Name
   coincidences with existing people are REPORTED, never merged — merging on
   name alone is exactly what this layer forbids.

   Dry run by default; ?commit=1 writes. Never retires anyone: a hub person
   missing from the active pull is reported, not ended. */
const acPhone = (raw: unknown): string | null => {
  const d = String(raw ?? '').replace(/\D/g, '')
  if (d.length === 10) return '+1' + d
  if (d.length === 11 && d.startsWith('1')) return '+' + d
  return null
}

/* skipTwins (the 6-hourly sync, 2026-10-12): a new AxisCare client whose exact name a Hub person already holds is
   LEFT for a person to connect, never created alongside. The Clients directory shows them as "not connected yet". */
export async function syncActiveClients(commit: boolean, skipTwins = true) {
  const order = ['AXISCARE_API_KEY', 'AXISCARE_TOKEN', 'AXISCARE_VISITS_TOKEN']
  let token = ''
  for (const n of order) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  if (!token || !/^\d+$/.test(site)) return { error: 'AxisCare credentials not set on this project' }

  /* Pull the client census, paginated, then keep ONLY the active ones.
     Caught by Samantha on the first dry run: `?active=true` is not a real
     filter on this endpoint (the spec's filter is `statuses`, by label), so
     AxisCare ignored it and returned all 293 clients ever — discharged and
     deceased included. Status labels can be customised per agency, so the
     robust check is the boolean AxisCare puts on every row: status.active. */
  const clients: any[] = []
  let totalSeen = 0
  let url: string | null = `https://${site}.axiscare.com/api/clients`
  await loadNotClients(sb)
  try {
    for (let page = 0; url && page < 12; page++) {
      const r: Response = await fetch(url, { headers: {
        Authorization: `Bearer ${token}`, Accept: 'application/json',
        'X-AxisCare-Api-Version': Deno.env.get('AXISCARE_API_VERSION') || '2023-10-01' } })
      if (!r.ok) return { error: `AxisCare responded ${r.status}`, fetched_so_far: clients.length }
      const j: any = await r.json().catch(() => ({}))
      for (const c of (j?.results?.clients ?? j?.clients ?? [])) {
        totalSeen++
        if (c?.status?.active === true && !isNotClient(c?.id)) clients.push(c)   // never (re)creates a not-client (Office Staff)
      }
      url = j?.results?.nextPage ?? j?.nextPage ?? null
    }
  } catch (err) { return { error: String(err), fetched_so_far: clients.length } }

  // Existing axiscare client links, so reruns create nothing.
  const { data: links } = await sb.from('person_source_id')
    .select('person_id, source_id').eq('system', 'axiscare').eq('entity_type', 'client')
  const linked = new Map((links ?? []).map((l: any) => [String(l.source_id), String(l.person_id)]))

  // Existing names, only to REPORT possible duplicates — never to merge.
  const { data: ppl } = await sb.from('person_identity').select('id, display_name')
  const nameOwners = new Map<string, string>()
  for (const p of (ppl ?? [])) nameOwners.set(String(p.display_name).trim().toLowerCase(), String(p.id))

  const out = { mode: commit ? 'COMMIT' : 'DRY RUN',
    axiscare_clients_total: totalSeen, axiscare_active_clients: clients.length,
    already_linked: 0, created: 0, roles_added: 0, past_left_for_a_person: 0, phones_indexed: 0, no_phone: 0,
    skipped_no_name: 0, name_coincidences: [] as any[], errors: [] as string[] }

  for (const c of clients) {
    const axId = String(c?.id ?? '')
    const name = [String(c?.firstName ?? '').trim(), String(c?.lastName ?? '').trim()]
      .filter(Boolean).join(' ')
    if (!axId || !name) { out.skipped_no_name++; continue }
    const phones = [
      { phone: acPhone(c?.mobilePhone), kind: 'mobile' },
      { phone: acPhone(c?.homePhone), kind: 'home' },
    ].filter(p => p.phone) as Array<{ phone: string; kind: string }>
    if (!phones.length) out.no_phone++

    let personId = linked.get(axId) ?? null
    if (personId) out.already_linked++
    else {
      const twin = nameOwners.get(name.toLowerCase())
      if (twin) out.name_coincidences.push({ name, axiscare_id: axId,
        note: skipTwins ? 'a person with this exact name already exists WITHOUT this AxisCare client id, left unconnected for a person to check'
          : 'a person with this exact name already exists WITHOUT this AxisCare client id, created separately, review and merge by hand if they are the same human' })
      if (twin && skipTwins) continue
      if (!commit) { out.created++; continue }
      const { data: pi, error: e1 } = await sb.from('person_identity')
        .insert({ display_name: name, primary_phone: phones[0]?.phone ?? null })
        .select('id').single()
      if (e1 || !pi) { out.errors.push(`${name}: ${e1?.message ?? 'insert failed'}`); continue }
      personId = String(pi.id)
      const { error: e2 } = await sb.from('person_source_id').insert({
        person_id: personId, system: 'axiscare', entity_type: 'client',
        source_id: axId, confidence: 'confirmed', needs_review: false })
      if (e2) { out.errors.push(`${name} link: ${e2.message}`); continue }
      out.created++
    }
    if (!commit) continue

    const { data: role } = await sb.from('person_role').select('id')
      .eq('person_id', personId).eq('role', 'client').eq('status', 'active').maybeSingle()
    /* A PAST CLIENT IS NEVER MADE ACTIVE AGAIN HERE (Samantha 2026-10-07): if AxisCare shows a past client Active again,
       the status review opens one card and a person decides whether to start a new episode. */
    const { data: pastRole } = role ? { data: null } : await sb.from('person_role').select('id')
      .eq('person_id', personId).eq('role', 'client').neq('status', 'active').limit(1).maybeSingle()
    if (!role && pastRole) { out.past_left_for_a_person++ }
    else if (!role) {
      const { error: e3 } = await sb.from('person_role')
        .insert({ person_id: personId, role: 'client', status: 'active' })
      if (e3) out.errors.push(`${name} role: ${e3.message}`)
      else out.roles_added++
    }
    for (const ph of phones) {
      const { data: have } = await sb.from('phone_index').select('id')
        .eq('phone', ph.phone).eq('person_id', personId).maybeSingle()
      if (have) continue
      /* Provenance is stated, never inherited: this number is on the client's
         AxisCare record, so it says so (the table's default is 'probable'). */
      const { error: e4 } = await sb.from('phone_index')
        .insert({ phone: ph.phone, person_id: personId, kind: ph.kind,
                  source_system: 'axiscare', source_record_id: axId, confidence: 'confirmed',
                  imported_at: new Date().toISOString() })
      if (e4) out.errors.push(`${name} phone: ${e4.message}`)
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
  // deno-lint-ignore no-explicit-any
  const res: any = await syncActiveClients(commit, true)
  const errs = Array.isArray(res?.errors) ? res.errors.length : 0
  const ok = !res?.error && errs === 0
  const created = res?.created ?? 0, left = Array.isArray(res?.name_coincidences) ? res.name_coincidences.length : 0
  if (commit) {
    try {
      await sb.rpc('upsert_app_data_item', { target_key: 'automation_heartbeats', item: {
        id: 'hb_client-sync', automation: 'client-sync', at: new Date().toISOString(), ok,
        note: ok ? `${created} new client${created === 1 ? '' : 's'} added, ${left} left to connect by hand`
                 : String(res?.error || (errs + ' error' + (errs === 1 ? '' : 's'))).slice(0, 200) } })
    } catch (e) { console.error('[client-sync] heartbeat failed', e) }
  }
  /* counts only: numbers stay, lists become their length, text is dropped */
  const out: Record<string, unknown> = { ok }
  for (const [k, v] of Object.entries(res ?? {})) {
    if (typeof v === 'number' || typeof v === 'boolean') out[k] = v
    else if (Array.isArray(v)) out[k] = v.length
    else if (k === 'mode' || k === 'error') out[k] = v
  }
  return json(out)
})
