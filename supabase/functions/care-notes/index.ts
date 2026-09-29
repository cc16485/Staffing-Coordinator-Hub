// Supabase Edge Function: care-notes  (shared hub project)
// -----------------------------------------------------------------------------
// N0 (2026-09-29, her go): the caregivers' shift notes live in AxisCare. Each visit carries a free-text `careNote`
// (one per client + caregiver + day, no rating) and `adls[]` (each task: completed, status -1/0/1, the caregiver's
// `note`). They come back only on GET /api/visits/{visitId}; the visit list leaves them out.
//
//   POST ?probe=1   the owner's server key only. Reads the last 3 days of visits and returns COUNTS ONLY: how many
//                   visits, how many carry a care note, tasks not done, tasks with a note, which id form AxisCare took.
//                   Never a note's words, a name or a number. READ ONLY: every AxisCare call is a GET; nothing is
//                   written anywhere; nothing is sent.
//
//   POST {axiscare_client_id}   N1: signed-in office staff. The last 14 days of that client's visits, newest first:
//                   date, caregiver, the care note (one per caregiver per day), and tasks not done or carrying a
//                   note. Read live from AxisCare each time; nothing is stored or sent.
//
// A later step (its own go) adds the flagging run (N2).
// -----------------------------------------------------------------------------
import { jobCaller } from '../_shared/job-auth.ts'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const AC_VERSION = '2023-10-01'
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
function axisCreds() {
  let token = ''
  for (const n of ['AXISCARE_API_KEY', 'AXISCARE_TOKEN', 'AXISCARE_VISITS_TOKEN']) { const v = Deno.env.get(n); if (v) { token = v; break } }
  return { token, site: Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || '' }
}
// deno-lint-ignore no-explicit-any
const rowsOf = (x: any): any[] => Array.isArray(x) ? x : (x && typeof x === 'object' ? Object.values(x) : [])
const chiDay = (offsetDays: number) => new Date(Date.now() + offsetDays * 864e5).toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)

// deno-lint-ignore no-explicit-any
async function getVisit(base: string, head: Record<string, string>, id: string): Promise<{ v: any; form: string; status: number | null }> {
  let last: number | null = null
  for (const [form, path] of [['plain', id], ['encoded', encodeURIComponent(id)]] as const) {
    try {
      const r = await fetch(`${base}/api/visits/${path}`, { headers: head })
      last = r.status
      if (r.status === 429) return { v: null, form: 'rate-limited', status: 429 }
      if (!r.ok) continue
      const j = await r.json().catch(() => null)
      const v = j?.results ?? null
      if (v && typeof v === 'object') return { v, form, status: r.status }
    } catch { /* try the other form */ }
  }
  return { v: null, form: '', status: last }
}

export async function probe(fetchImpl?: typeof fetch) {
  if (fetchImpl) globalThis.fetch = fetchImpl
  const { token, site } = axisCreds()
  if (!token || !/^\d+$/.test(site)) return { error: 'AxisCare credentials not set on this project' }
  const base = `https://${site}.axiscare.com`
  const head = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-AxisCare-Api-Version': AC_VERSION }
  // deno-lint-ignore no-explicit-any
  const list: any[] = []
  let url: string | null = `${base}/api/visits?startDate=${chiDay(-3)}&endDate=${chiDay(0)}`
  let listStatus: number | null = null
  for (let page = 0; url && page < 12; page++) {
    const r: Response = await fetch(url, { headers: head })
    listStatus = r.status
    if (!r.ok) break
    // deno-lint-ignore no-explicit-any
    const j: any = await r.json().catch(() => ({}))
    for (const v of rowsOf(j?.results?.visits)) if (v && !v.removed) list.push(v)
    url = j?.results?.nextPage ?? j?.nextPage ?? null
  }
  const now = Date.now()
  const started = list.filter((v) => { const t = new Date(v?.startDate ?? v?.scheduledStartDate ?? 0).getTime(); return t && t < now })
  const sample = started.slice(-60)   // the most recent 60 visits that have started
  const out = { window: `${chiDay(-3)} to ${chiDay(0)}`, list_status: listStatus, visits_listed: list.length, visits_started: started.length,
    visits_read: 0, read_failed: 0, id_form: '', rate_limited: false,
    list_has_care_note_field: list.some((v) => v && 'careNote' in v),
    with_care_note: 0, care_note_avg_chars: 0, visits_with_tasks: 0, tasks: 0, tasks_done: 0, tasks_not_done: 0, tasks_no_response: 0,
    tasks_with_note: 0, not_done_with_note: 0, fields_on_a_visit: [] as string[] }
  let chars = 0
  const seenNote = new Set<string>()
  for (const s of sample) {
    const { v, form, status } = await getVisit(base, head, String(s?.id ?? ''))
    if (form === 'rate-limited') { out.rate_limited = true; break }
    if (!v) { out.read_failed++; if (!out.id_form) out.id_form = 'failed (' + status + ')'; continue }
    out.visits_read++; if (!out.id_form || out.id_form.startsWith('failed')) out.id_form = form
    if (!out.fields_on_a_visit.length) out.fields_on_a_visit = Object.keys(v).sort()
    const note = typeof v.careNote === 'string' ? v.careNote.trim() : ''
    // one care note per client + caregiver + day: count each once
    const st0 = v?.startDate ?? v?.scheduledStartDate
    const k = `${v?.client?.id}|${v?.caregiver?.id}|${st0 ? new Date(st0).toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10) : ''}`
    if (note && !seenNote.has(k)) { seenNote.add(k); out.with_care_note++; chars += note.length }
    const adls = rowsOf(v.adls)
    if (adls.length) out.visits_with_tasks++
    for (const a of adls) {
      out.tasks++
      const st = Number(a?.status)
      if (st === 1 || a?.completed === true) out.tasks_done++
      else if (st === 0) out.tasks_not_done++
      else out.tasks_no_response++
      const n = typeof a?.note === 'string' && a.note.trim()
      if (n) { out.tasks_with_note++; if (st === 0) out.not_done_with_note++ }
    }
  }
  out.care_note_avg_chars = out.with_care_note ? Math.round(chars / out.with_care_note) : 0
  return out
}

/* N1: one client's shifts, newest first. Plain visit ids work (proven by 333). */
export async function clientNotes(ax: string, days = 14) {
  const { token, site } = axisCreds()
  if (!token || !/^\d+$/.test(site)) return { error: 'AxisCare credentials not set on this project' }
  const base = `https://${site}.axiscare.com`
  const head = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-AxisCare-Api-Version': AC_VERSION }
  // deno-lint-ignore no-explicit-any
  const list: any[] = []
  let url: string | null = `${base}/api/visits?clientIds=${encodeURIComponent(ax)}&startDate=${chiDay(-days)}&endDate=${chiDay(0)}`
  for (let page = 0; url && page < 6; page++) {
    const r: Response = await fetch(url, { headers: head })
    if (r.status === 429) return { error: 'AxisCare asked us to slow down; try again in a minute' }
    if (!r.ok) return { error: 'AxisCare answered ' + r.status }
    // deno-lint-ignore no-explicit-any
    const j: any = await r.json().catch(() => ({}))
    for (const v of rowsOf(j?.results?.visits)) if (v && !v.removed && String(v?.client?.id ?? '') === String(ax)) list.push(v)
    url = j?.results?.nextPage ?? j?.nextPage ?? null
  }
  const now = Date.now()
  const started = list.filter((v) => { const t = new Date(v?.startDate ?? v?.scheduledStartDate ?? 0).getTime(); return t && t < now })
    .sort((a, b) => String(b?.startDate ?? b?.scheduledStartDate ?? '').localeCompare(String(a?.startDate ?? a?.scheduledStartDate ?? '')))
    .slice(0, 40)
  const seen = new Set<string>()
  const shifts = []
  let slowed = false
  for (const s of started) {
    const { v, form } = await getVisit(base, head, String(s?.id ?? ''))
    if (form === 'rate-limited') { slowed = true; break }
    if (!v) continue
    const cg = [String(v?.caregiver?.firstName ?? '').trim(), String(v?.caregiver?.lastName ?? '').trim()].filter(Boolean).join(' ')
    /* AxisCare keeps one care note per client, caregiver and (local) visit date */
    const st0 = v?.startDate ?? v?.scheduledStartDate
    const day = st0 ? new Date(st0).toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10) : ''
    const k = `${v?.caregiver?.id}|${day}`
    const note = typeof v.careNote === 'string' ? v.careNote.trim() : ''
    const tasks = rowsOf(v.adls).map((a) => ({ name: String(a?.name ?? a?.adlKey ?? 'Task'), status: Number(a?.status),
      note: typeof a?.note === 'string' ? a.note.trim() : '' })).filter((a) => a.status === 0 || a.note)
    shifts.push({ visit_id: String(v?.id ?? ''), start: v?.startDate ?? v?.scheduledStartDate ?? null, end: v?.endDate ?? v?.scheduledEndDate ?? null,
      caregiver: cg, care_note: note && !seen.has(k) ? note : '', same_note_as_earlier_visit: !!(note && seen.has(k)),
      tasks_not_done: tasks.filter((a) => a.status === 0).map((a) => ({ name: a.name, note: a.note })),
      task_notes: tasks.filter((a) => a.status !== 0 && a.note).map((a) => ({ name: a.name, note: a.note })),
      tasks_total: rowsOf(v.adls).length })
    if (note) seen.add(k)
  }
  return { ok: true, days, shifts, more_than_shown: started.length < list.filter((v) => new Date(v?.startDate ?? v?.scheduledStartDate ?? 0).getTime() < now).length, slowed }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const q = new URL(req.url).searchParams
  if (q.get('probe') === '1') {
    if ((await jobCaller(req, false)) !== 'owner') return json({ error: 'not allowed' }, 401)
    return json(await probe())
  }
  // deno-lint-ignore no-explicit-any
  let b: any = {}
  try { b = await req.json() } catch { b = {} }
  const ax = String(b?.axiscare_client_id ?? '').trim()
  if (ax) {
    const who = await requireStaff(createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!), req, OFFICE_ROLES)
    if (!who.ok) return json({ error: who.error }, who.status)
    if (!/^\d+$/.test(ax)) return json({ error: 'That is not an AxisCare client number.' }, 400)
    return json(await clientNotes(ax))
  }
  return json({ error: 'unknown request' }, 400)
})
