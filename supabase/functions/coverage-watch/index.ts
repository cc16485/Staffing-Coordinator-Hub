// Supabase Edge Function: coverage-watch  (shared hub project)
// -----------------------------------------------------------------------------
// Samantha's trigger: "could it be initiated from us unassigning a shift and
// making the reason for modification caregiver call-in?" (2026-09-12). Yes —
// this watches AxisCare for exactly that gesture, so the scheduler's normal
// workflow IS the trigger. No phone-screen step, no second data entry.
//
//   every few minutes (cron, once live) or on demand:
//     GET /api/visits for the next 72 hours
//     keep visits with NO caregiver and a modification reason that matches
//       the call-in/call-off pattern (or the exact names in
//       ops_settings.coverage_watch_reasons, once she sets them)
//     open a Coverage Help case for each — with the REAL client id, date and
//       times straight from the schedule — unless a case for that visit
//       already exists (any status: once handled, never reopened by a robot)
//
// The ranked-wave engine (coverage-run) then takes over, same as a phone
// call-off. The AxisCare webhook `scheduling.visit.caregiver` can make this
// instant later (needs AxisCare support to enable webhook admin); polling
// makes it real today and stays as the safety net.
//
// KNOWN TRAP (documented in AXISCARE-CAPABILITY.md): a null caregiver means
// unassigned OR assigned-to-an-inactive-caregiver — indistinguishable. The
// modification-reason filter is what keeps that ambiguity from opening junk
// cases: no matching reason, no case.
//
// ⚠ DRY RUN BY DEFAULT. It opens nothing unless app_data 'ops_settings' has
//   coverage_watch_live === true. Dry runs list exactly what WOULD open, plus
//   every modification-reason name seen on unassigned upcoming visits, so
//   Samantha can pick the exact reason names before going live.
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b, null, 2), { status: s, headers: { 'Content-Type': 'application/json' } })

const AC_VERSION = Deno.env.get('AXISCARE_API_VERSION') || '2023-10-01'
const DEFAULT_REASON_RX = /call[\s-]?(in|off)/i
const HORIZON_HOURS = 72

function axisCreds() {
  const order = ['AXISCARE_VISITS_TOKEN', 'AXISCARE_API_KEY', 'AXISCARE_TOKEN']
  let token = ''
  for (const n of order) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  return { token, site: /^\d+$/.test(site) ? site : '' }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200 })
  const t0 = Date.now()

  const { data: setRow } = await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const settings: any = setRow?.data ?? {}
  const forceDry = new URL(req.url).searchParams.get('dry') === '1'
  const live = settings.coverage_watch_live === true && !forceDry
  const configuredReasons: string[] = Array.isArray(settings.coverage_watch_reasons)
    ? settings.coverage_watch_reasons.map((r: unknown) => String(r).toLowerCase().trim()).filter(Boolean)
    : []
  const reasonMatches = (name: string) => configuredReasons.length
    ? configuredReasons.includes(name.toLowerCase().trim())
    : DEFAULT_REASON_RX.test(name)

  const { token, site } = axisCreds()
  if (!token || !site) return json({ error: 'AxisCare credentials not set on this project' }, 502)

  // ── The schedule, next 72 hours. ──
  const startDate = new Date().toISOString().slice(0, 10)
  const endDate = new Date(Date.now() + HORIZON_HOURS * 3600000).toISOString().slice(0, 10)
  // deno-lint-ignore no-explicit-any
  const visits: any[] = []
  let fetchError: string | null = null
  try {
    let url: string | null = `https://${site}.axiscare.com/api/visits?startDate=${startDate}&endDate=${endDate}`
    for (let page = 0; url && page < 12; page++) {
      const r: Response = await fetch(url, { headers: {
        Authorization: `Bearer ${token}`, Accept: 'application/json',
        'X-AxisCare-Api-Version': AC_VERSION } })
      if (!r.ok) { fetchError = `AxisCare responded ${r.status}`; break }
      // deno-lint-ignore no-explicit-any
      const j: any = await r.json().catch(() => ({}))
      for (const v of (j?.results?.visits ?? j?.visits ?? [])) {
        if (v?.removed) continue
        visits.push(v)
      }
      url = j?.results?.nextPage ?? j?.nextPage ?? null
    }
  } catch (err) { fetchError = String(err) }
  if (fetchError && !visits.length) return json({ error: fetchError }, 502)

  // ── Existing cases: one case per visit, ever. ──
  const { data: caseRow } = await sb.from('app_data').select('data').eq('key', 'coverage_cases').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const cases: any[] = Array.isArray(caseRow?.data) ? caseRow!.data : []
  const handled = new Set(cases.map(c => String(c.axiscare_visit_id ?? '')).filter(Boolean))

  const nowIso = new Date().toISOString()
  const reasonNamesSeen = new Map<string, number>()
  const wouldOpen: Record<string, unknown>[] = []
  let unassigned = 0, reasonMatched = 0, alreadyHandled = 0, inPast = 0, created = 0

  for (const v of visits) {
    if (v?.caregiver?.id != null) continue
    unassigned++
    const reason = String(v?.modificationReason?.name ?? '').trim()
    if (reason) reasonNamesSeen.set(reason, (reasonNamesSeen.get(reason) ?? 0) + 1)
    if (!reason || !reasonMatches(reason)) continue
    reasonMatched++
    const start = String(v?.scheduledStartDate ?? v?.startDate ?? '')
    if (start && new Date(start).getTime() < Date.now()) { inPast++; continue }
    const visitId = String(v?.id ?? '')
    if (!visitId || handled.has(visitId)) { alreadyHandled++; continue }

    const clientName = [String(v?.client?.firstName ?? '').trim(), String(v?.client?.lastName ?? '').trim()]
      .filter(Boolean).join(' ') || '(client name missing on the visit)'
    const end = String(v?.scheduledEndDate ?? v?.endDate ?? '')
    const shiftTime = [start, end].map(s => s ? s.slice(11, 16) : '').filter(Boolean).join('-')
    const entry = {
      client: clientName,
      client_axiscare_id: v?.client?.id != null ? String(v.client.id) : null,
      axiscare_visit_id: visitId,
      shift_date: start.slice(0, 10),
      shift_time: shiftTime,
      modification_reason: reason,
    }
    wouldOpen.push(entry)

    if (live) {
      const c = {
        id: 'cw_' + crypto.randomUUID().slice(0, 12),
        ...entry,
        reason: 'call_off',
        note: `Opened automatically: shift unassigned in AxisCare with reason "${reason}".`,
        status: 'open', asked: [],
        opened_at: nowIso, opened_by: 'axiscare-watch',
        caller_phone: '', caller_contact_id: '',
        resolved_at: null, resolved_how: null, covered_by: null,
      }
      const { error } = await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: c })
      if (!error) { created++; handled.add(visitId) }
    }
  }

  const summary = {
    mode: live ? 'LIVE' : 'DRY RUN',
    window: `${startDate} → ${endDate}`,
    fetch_error: fetchError,
    visits_seen: visits.length,
    unassigned_upcoming: unassigned,
    reason_matched: reasonMatched,
    already_handled: alreadyHandled,
    started_in_past: inPast,
    cases_created: created,
    would_open: wouldOpen,
    reason_filter: configuredReasons.length
      ? { mode: 'exact names from ops_settings.coverage_watch_reasons', names: configuredReasons }
      : { mode: 'default pattern', pattern: String(DEFAULT_REASON_RX) },
    /* Every reason name seen on unassigned upcoming visits, so the exact
       trigger names can be chosen from reality instead of guessed. */
    reason_names_seen_on_unassigned: Object.fromEntries(reasonNamesSeen),
  }

  try {
    await sb.rpc('upsert_app_data_item', { target_key: 'automation_log', item: {
      id: 'auto_srv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      at: nowIso, automation: 'coverage-watch', ran_by: 'server',
      ok: !fetchError, dry: !live, duration_ms: Date.now() - t0,
      rows_seen: visits.length, candidates: wouldOpen.length, created,
    } })
  } catch { /* logging must never block the watch */ }

  return json(summary)
})
