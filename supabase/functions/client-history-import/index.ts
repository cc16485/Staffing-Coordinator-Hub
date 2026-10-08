// =====================================================================================================================
// CLIENT HISTORY IMPORT (Desktop 501, Samantha 2026-10-08). A TEMPORARY function: Desktop 501 deploys it, runs it once
// (look, or import) and deletes it again, so nothing stays live.
//
// Brings AxisCare's PAST and DECEASED clients the Hub has never had into the Hub as past clients, so the office can see who
// we served and every past-client protection applies to them (no shift alerts, check-ins, campaigns, review requests or
// reactivation prompts; a returning client gets ONE card and Resume care only when an owner confirms).
//
// Her rules, all applied here:
//   · nothing is guessed: no start date in AxisCare = not imported (listed for a person); a name that already belongs to
//     someone in the Hub = not imported (listed; a person decides whether it is the same human)
//   · the end date: AxisCare's effectiveEndDate when it has one (exact); otherwise the import date, marked on_or_before,
//     shown as "Care ended on or before <date> · exact date not recorded in AxisCare"
//   · no reason is invented: deceased says deceased; everyone else's reason stays empty ("not recorded in AxisCare")
//   · no phone or email is copied, so a family calling or a campaign list can never be matched to them by mistake
//   · imported deceased clients get NO sympathy-card task (her answer 2026-10-08); no journey, card or task for anyone
//   · a client already in the Hub is never touched (their status changes are the status review's job)
// Only the owner's Desktop script (the server key) can call it. ?commit=1 imports; anything else only looks.
// =====================================================================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ownerCaller } from '../_shared/job-auth.ts'
import { axState } from '../_shared/audience-guard.ts'

// deno-lint-ignore no-explicit-any
type Any = any
const ymd = (v: unknown) => { const s = String(v ?? '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null }
const norm = (s: unknown) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

/** pure: what happens to each AxisCare client. today = the import date (America/Chicago). */
export function plan(axClients: Any[], links: Any[], people: Any[], today: string) {
  const linked = new Set((links || []).map((l: Any) => String(l.source_id)))
  const names = new Map<string, string>(); for (const p of people || []) names.set(norm(p.display_name), String(p.display_name))
  const out = { total: 0, active: 0, not_clients: 0, on_hold_not_in_hub: [] as Any[], already_in_hub: 0,
    import: [] as Any[], no_start_date: [] as Any[], same_name: [] as Any[], no_name: 0, by_label: {} as Record<string, number> }
  const seenNames = new Map<string, number>()
  for (const c of axClients || []) {
    out.total++
    const label = String((typeof c?.status === 'object' && c?.status ? (c.status.label ?? c.status.name) : c?.status) ?? '').trim() || '(no status)'
    out.by_label[label] = (out.by_label[label] || 0) + 1
    const st = axState(c), ax = String(c?.id ?? '')
    const first = String(c?.firstName ?? '').trim(), last = String(c?.lastName ?? '').trim(), name = [first, last].filter(Boolean).join(' ')
    if (st === 'active') { out.active++; continue }
    if (st === null) { out.not_clients++; continue }
    if (!ax) continue
    if (linked.has(ax)) { out.already_in_hub++; continue }
    if (st === 'paused') { out.on_hold_not_in_hub.push({ ax, name, label }); continue }
    if (!name) { out.no_name++; continue }
    const started = ymd(c?.startDate) ?? ymd(c?.conversionDate)
    const row = { ax, name, first, last, label, state: st }
    if (!started) { out.no_start_date.push(row); continue }
    if (names.has(norm(name))) { out.same_name.push({ ...row, hub_name: names.get(norm(name)) }); continue }
    seenNames.set(norm(name), (seenNames.get(norm(name)) || 0) + 1)
    const end = ymd(c?.effectiveEndDate)
    const exact = !!end && end <= today && end >= started
    out.import.push({ ...row, started_at: started, ended_at: exact ? end : today, ended_date_basis: exact ? 'exact' : 'on_or_before',
      end_reason: st === 'deceased' ? 'deceased' : null })
  }
  /* two AxisCare clients with the same name and no Hub person: still not the same human by assumption, but say so */
  for (const r of out.import) if ((seenNames.get(norm(r.name)) || 0) > 1) r.twin_in_axiscare = true
  return out
}

Deno.serve(async (req) => {
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
  if (!(await ownerCaller(req))) return json({ error: 'owner only' }, 401)
  const commit = new URL(req.url).searchParams.get('commit') === '1'
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const token = Deno.env.get('AXISCARE_API_KEY') ?? Deno.env.get('AXISCARE_TOKEN') ?? ''
  const site = Deno.env.get('AXISCARE_SITE') ?? Deno.env.get('AXISCARE_SITE_NUMBER') ?? ''
  if (!token || !/^\d+$/.test(site)) return json({ error: 'AxisCare is not set up on the server' }, 500)
  const axClients: Any[] = []
  try {
    let url: string | null = `https://${site}.axiscare.com/api/clients`
    for (let page = 0; url && page < 40; page++) {
      const r: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-AxisCare-Api-Version': '2023-10-01' } })
      if (!r.ok) return json({ error: 'AxisCare answered ' + r.status + '; nothing was imported' }, 502)
      const j: Any = await r.json().catch(() => ({}))
      const list = j?.results?.clients ?? j?.clients ?? []
      axClients.push(...(Array.isArray(list) ? list : Object.values(list)))
      url = j?.results?.nextPage ?? j?.nextPage ?? null
    }
  } catch (e) { return json({ error: 'AxisCare could not be read (' + String(e).slice(0, 120) + '); nothing was imported' }, 502) }
  if (!axClients.length) return json({ error: 'AxisCare returned no clients; nothing was imported' }, 502)

  const { data: links, error: e1 } = await db.from('person_source_id').select('source_id').eq('system', 'axiscare').eq('entity_type', 'client')
  const { data: people, error: e2 } = await db.from('person_identity').select('display_name')
  if (e1 || e2) return json({ error: 'the Hub people could not be read; nothing was imported' }, 500)
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
  const p = plan(axClients, links ?? [], people ?? [], today)

  /* the older backfill's mark: an ended role whose end date equals its start date (reported only, never changed here) */
  const { data: oldRoles } = await db.from('person_role').select('started_at, ended_at').eq('role', 'client').eq('status', 'former')
  const oldSameDay = (oldRoles ?? []).filter((r: Any) => r.started_at && r.ended_at && String(r.started_at) === String(r.ended_at)).length

  const done: Any[] = [], errors: string[] = []
  if (commit) {
    for (const r of p.import) {
      const { data: pi, error } = await db.from('person_identity').insert({ display_name: r.name, first_name: r.first || null, last_name: r.last || null }).select('id').single()
      if (error || !pi) { errors.push(r.name + ': ' + (error?.message ?? 'person not added')); continue }
      const { error: es } = await db.from('person_source_id').insert({ person_id: pi.id, system: 'axiscare', entity_type: 'client', source_id: r.ax, confidence: 'confirmed',
        needs_review: false, evidence: 'historical import (Desktop 501, ' + today + '): AxisCare status ' + r.label })
      const { error: er } = es ? { error: es } : await db.from('person_role').insert({ person_id: pi.id, role: 'client', status: 'former', started_at: r.started_at,
        ended_at: r.ended_at, ended_date_basis: r.ended_date_basis, end_reason: r.end_reason })
      if (es || er) {   // all or nothing for this person: take back what was added
        await db.from('person_role').delete().eq('person_id', pi.id); await db.from('person_source_id').delete().eq('person_id', pi.id); await db.from('person_identity').delete().eq('id', pi.id)
        errors.push(r.name + ': ' + (es || er)!.message); continue
      }
      done.push(r.ax)
    }
  }
  const brief = (xs: Any[]) => xs.map((x: Any) => ({ ax: x.ax, name: x.name, label: x.label, ...(x.hub_name ? { hub_name: x.hub_name } : {}) }))
  return json({ mode: commit ? 'import' : 'look', today, axiscare_total: p.total, by_label: p.by_label, active: p.active, not_clients: p.not_clients,
    already_in_hub: p.already_in_hub, to_import: p.import.length,
    to_import_past: p.import.filter((x: Any) => x.state === 'past').length, to_import_deceased: p.import.filter((x: Any) => x.state === 'deceased').length,
    with_axiscare_end_date: p.import.filter((x: Any) => x.ended_date_basis === 'exact').length,
    on_or_before: p.import.filter((x: Any) => x.ended_date_basis === 'on_or_before').length,
    twins_in_axiscare: brief(p.import.filter((x: Any) => x.twin_in_axiscare)),
    not_imported: { no_start_date: brief(p.no_start_date), same_name_as_someone_in_hub: brief(p.same_name), on_hold_in_axiscare: p.on_hold_not_in_hub, no_name: p.no_name },
    older_backfill_same_day_end: oldSameDay,
    imported: commit ? done.length : 0, imported_ax: commit ? done : [], errors })
})
