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
// Later steps (each with its own go) add the profile read (N1) and the flagging run (N2).
// -----------------------------------------------------------------------------
import { jobCaller } from '../_shared/job-auth.ts'

const AC_VERSION = '2023-10-01'
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
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
    const k = `${v?.client?.id}|${v?.caregiver?.id}|${String(v?.startDate ?? v?.scheduledStartDate ?? '').slice(0, 10)}`
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok')
  const q = new URL(req.url).searchParams
  if (q.get('probe') === '1') {
    if ((await jobCaller(req, false)) !== 'owner') return json({ error: 'not allowed' }, 401)
    return json(await probe())
  }
  return json({ error: 'unknown request' }, 400)
})
