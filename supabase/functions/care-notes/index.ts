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
//   POST ?flag=1    N2: every two hours (its schedule, or the owner's key). Reads the shifts that finished since the
//                   last look; for each caregiver + client + day with words in it (the care note and any task
//                   notes), the AI answers only: is this a concern, and which kind. A yes becomes a Needs Attention
//                   item showing the caregiver's words (her ruling, 2026-09-29) and a link to the profile. It
//                   never contacts anyone. It does nothing until ops_settings.care_notes_flag_live is true.
//   POST ?flag=1&practice=1&hours=48   the owner's key: the same reading and asking, COUNTS ONLY, nothing saved.
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

/* ── N2: flag the concerning notes ─────────────────────────────────────────── */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
// deno-lint-ignore no-explicit-any
async function readPaced(base: string, head: Record<string, string>, id: string): Promise<{ v: any; limited: boolean }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const r = await fetch(`${base}/api/visits/${id}`, { headers: head })
      if (r.status === 429) { if (attempt === 4) return { v: null, limited: true }
        await sleep(Math.min(Math.max(Number(r.headers.get('retry-after')) || 3, 1), 20) * 1000); continue }
      if (!r.ok) return { v: null, limited: false }
      const j = await r.json().catch(() => null)
      return { v: j?.results && typeof j.results === 'object' ? j.results : null, limited: false }
    } catch { return { v: null, limited: false } }
  }
  return { v: null, limited: true }
}
export const CONCERN_KINDS = ['a fall or injury', 'confusion or a change in behavior', 'medication', 'eating or drinking',
  'skin or a wound', 'pain or illness', 'safety at home', 'a problem with the caregiver or the visit', 'family conflict', 'something else worth a look']
const URGENT = new Set(['a fall or injury', 'safety at home', 'pain or illness'])
/* The AI answers one question and nothing else. When it can't answer, the note is raised for a person to read. */
// deno-lint-ignore no-explicit-any
export async function askConcern(text: string): Promise<{ concern: boolean; kind: string; urgent: boolean; why: string; failed: boolean; family_line?: string }> {
  const key = Deno.env.get('ANTHROPIC_API_KEY') || ''
  const raised = { concern: true, kind: 'something else worth a look', urgent: false, why: 'the AI could not read this note, so a person should', failed: true }
  if (!key) return raised
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 200, temperature: 0,
        system: 'You read one home-care caregiver\'s shift notes for a client (the care note, and notes on tasks). Decide whether '
          + 'anything in them should be read by the office today: a possible change in the client\'s health, safety, mood, '
          + 'behavior, eating, medication, skin, pain, a fall or injury, a problem with the visit or caregiver, or family '
          + 'conflict. A normal day ("good spirits", "completed all tasks", "ate lunch") is NOT a concern. When unsure, it IS '
          + 'a concern. Answer ONLY minified JSON: {"concern":bool,"kind":one of ' + JSON.stringify(CONCERN_KINDS)
          + ',"urgent":bool (true only for a fall, injury, safety risk or sudden illness),"why":string (at most 20 words, plain)'
          + ',"family_line":string (N3: when concern is true, ONE plain sentence a coordinator could send the client\'s family: '
          + 'what happened and how the client is now, the least detail needed, no diagnoses, no medication names, no quotes '
          + 'from the note, first name only, e.g. "Ruth had a small fall in the bathroom this morning; she says she is okay." '
          + 'Empty string when concern is false)}',
        messages: [{ role: 'user', content: text.slice(0, 6000) }] }) })
    if (!r.ok) return raised
    const j = await r.json().catch(() => null)
    const t = String(j?.content?.[0]?.text ?? '')
    const m = t.match(/\{[\s\S]*\}/); if (!m) return raised
    const a = JSON.parse(m[0])
    const kind = CONCERN_KINDS.includes(a.kind) ? a.kind : 'something else worth a look'
    return { concern: a.concern === true, kind, urgent: a.urgent === true || URGENT.has(kind) && a.urgent !== false, why: String(a.why ?? '').slice(0, 200), failed: false,
      family_line: a.concern === true ? String(a.family_line ?? '').replace(/\s*\u2014\s*/g, ', ').slice(0, 240) : '' }
  } catch { return raised }
}
// deno-lint-ignore no-explicit-any
async function readKey(db: any, key: string): Promise<any[]> {
  const { data } = await db.from('app_data').select('data').eq('key', key).maybeSingle()
  return Array.isArray(data?.data) ? data.data : []
}
const whenChi = (iso: unknown) => { try { return new Date(String(iso)).toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) } catch { return '' } }
const dayChi = (iso: unknown) => { try { return new Date(String(iso)).toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric' }) } catch { return '' } }

// deno-lint-ignore no-explicit-any
export async function flagRun(db: any, opts: { practice: boolean; hours?: number }) {
  const { token, site } = axisCreds()
  if (!token || !/^\d+$/.test(site)) return { error: 'AxisCare credentials not set on this project' }
  const { data: os } = await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
  const live = os?.data?.care_notes_flag_live === true   /* the switch, like coverage_flag_live */
  if (!opts.practice && !live) return { ok: true, off: true, note: 'switched off (ops_settings.care_notes_flag_live is not true)' }
  const state = (await readKey(db, 'care_notes_state')).find((x) => x?.id === 'state') ?? { id: 'state', last_look: '' }
  const now = Date.now()
  const since = opts.practice ? now - (opts.hours ?? 48) * 3600e3
    : (state.last_look ? new Date(state.last_look).getTime() : now - 24 * 3600e3)
  const base = `https://${site}.axiscare.com`
  const head = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-AxisCare-Api-Version': AC_VERSION }
  const startDay = new Date(since - 864e5).toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
  // deno-lint-ignore no-explicit-any
  const list: any[] = []
  let url: string | null = `${base}/api/visits?startDate=${startDay}&endDate=${chiDay(0)}`
  for (let page = 0; url && page < 20; page++) {
    const r: Response = await fetch(url, { headers: head })
    if (!r.ok) return { error: 'the visit list answered ' + r.status }
    // deno-lint-ignore no-explicit-any
    const j: any = await r.json().catch(() => ({}))
    for (const v of rowsOf(j?.results?.visits)) if (v && !v.removed) list.push(v)
    url = j?.results?.nextPage ?? j?.nextPage ?? null
  }
  const out = { ok: true, practice: opts.practice, window_hours: Math.round((now - since) / 3600e3), visits_finished: 0, read: 0, stopped_early: false,
    days_with_words: 0, already_flagged: 0, asked: 0, flagged: 0, urgent: 0, ai_could_not_read: 0, by_kind: {} as Record<string, number>, items_made: 0 }
  // deno-lint-ignore no-explicit-any
  const groups = new Map<string, any[]>()
  /* read only the visits that could have finished since the last look: the list carries clock-out times when it has
     them; a visit it doesn't carry one for is read if it started within a day of the window */
  const started = list.filter((v) => {
    const st = new Date(v?.startDate ?? v?.scheduledStartDate ?? 0).getTime(); if (!st || st >= now) return false
    const out = v?.clockOut?.time ? new Date(v.clockOut.time).getTime() : 0
    return out ? (out > since && out <= now) : st > since - 864e5 })
  for (const s0 of started) {
    const { v, limited } = await readPaced(base, head, String(s0?.id ?? ''))
    if (limited) { out.stopped_early = true; break }
    await sleep(Number(Deno.env.get('CARE_NOTES_PAUSE_MS') ?? '250'))
    if (!v) continue
    out.read++
    const t = new Date(v?.clockOut?.time ?? 0).getTime()
    if (!t || t <= since || t > now) continue
    out.visits_finished++
    const k = `${v?.caregiver?.id ?? '?'}|${v?.client?.id ?? '?'}|${new Date(v?.startDate ?? v?.scheduledStartDate).toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)}`
    if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(v)
  }
  const items = opts.practice ? [] : await readKey(db, 'ops_items')
  const have = new Set(items.map((i) => String(i?.id ?? '')))
  for (const [k, vs] of groups) {
    const last = vs.slice().sort((a, b) => String(a?.clockOut?.time ?? '').localeCompare(String(b?.clockOut?.time ?? ''))).pop()
    const note = vs.map((v) => typeof v?.careNote === 'string' ? v.careNote.trim() : '').find(Boolean) || ''
    const tasks: string[] = []
    for (const v of vs) for (const a of rowsOf(v?.adls)) {
      const n = typeof a?.note === 'string' ? a.note.trim() : ''
      if (Number(a?.status) === 0) tasks.push(`${a?.name ?? 'Task'}: not done${n ? ' ("' + n + '")' : ''}`)
      else if (n) tasks.push(`${a?.name ?? 'Task'}: "${n}"`)
    }
    if (!note && !tasks.length) continue      // no words to read (a missing note is the missed-notes work, not this)
    out.days_with_words++
    const id = 'ops_carenote_' + k.replace(/[^A-Za-z0-9]/g, '_')
    if (have.has(id)) { out.already_flagged++; continue }
    const text = (note ? 'Care note: ' + note : 'No care note.') + (tasks.length ? '\nTasks: ' + tasks.join('; ') : '')
    out.asked++
    const a = await askConcern(text)
    if (a.failed) out.ai_could_not_read++
    if (!a.concern) continue
    out.flagged++; if (a.urgent) out.urgent++
    out.by_kind[a.kind] = (out.by_kind[a.kind] ?? 0) + 1
    if (opts.practice) continue
    const clientName = [String(last?.client?.firstName ?? '').trim(), String(last?.client?.lastName ?? '').trim()].filter(Boolean).join(' ') || 'the client'
    const clientFirst = String(last?.client?.firstName ?? '').trim() || 'the client'
    const cg = [String(last?.caregiver?.firstName ?? '').trim(), String(last?.caregiver?.lastName ?? '').trim()].filter(Boolean).join(' ') || 'The caregiver'
    const { error } = await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item: {
      id, kind: 'care_note', domain: 'client_care', status: 'open', urgency: a.urgent ? 'high' : 'normal',
      title: `Possible concern on ${clientFirst}'s ${dayChi(last?.startDate ?? last?.scheduledStartDate)} visit: ${a.kind}`,
      about: clientName, caregiver: cg, client_ax: String(last?.client?.id ?? ''),
      family_line: a.family_line || '',   /* N3: a suggested sentence for the family; the coordinator edits it */
      detail: `${cg} wrote after the ${whenChi(last?.startDate ?? last?.scheduledStartDate)} visit:\n\n`
        + (note ? `"${note}"` : '(no care note)') + (tasks.length ? '\n\n' + tasks.join('\n') : '')
        + `\n\nWhy it was flagged: ${a.why || a.kind}.\nRead it, then decide what happens next. This never contacts anyone by itself.`,
      owner: '', owner_name: '', due: new Date(now + (a.urgent ? 4 : 24) * 3600e3).toISOString(),
      created_at: new Date().toISOString(), created_by: 'care-notes', opened_by: 'care-note-flag' } })
    if (!error) out.items_made++
  }
  if (!opts.practice) {
    if (!out.stopped_early) await db.rpc('upsert_app_data_item', { target_key: 'care_notes_state', item: { id: 'state', last_look: new Date(now).toISOString() } })
    try { await db.rpc('upsert_app_data_item', { target_key: 'automation_heartbeats', item: { id: 'hb_care-notes-flag', automation: 'care-notes-flag',
      at: new Date().toISOString(), ok: !out.stopped_early, note: `${out.flagged} flagged of ${out.asked} read` + (out.stopped_early ? '; AxisCare asked us to slow down' : '') } }) } catch { /* a beat must not stop the run */ }
  }
  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const q = new URL(req.url).searchParams
  if (q.get('flag') === '1') {
    const practice = q.get('practice') === '1'
    const caller = await jobCaller(req, !practice)
    if (!caller || (practice && caller !== 'owner')) return json({ error: 'not allowed' }, 401)
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    return json(await flagRun(db, { practice, hours: Math.min(Math.max(Number(q.get('hours')) || 48, 1), 96) }))
  }
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
