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
//
//   RED AND YELLOW FLAGS (2026-10-06, Samantha: "more clear on why they are listed... is it a yellow or red flag", "a
//                   better flow on what to do"; she approved the mockup and every recommendation). With
//                   ops_settings.care_notes_levels_live on, the AI gives a LEVEL instead of yes/no: red (act today: a fall
//                   or injury, safety at home, sudden illness or bad pain, medication, signs of neglect or abuse), yellow
//                   (look within 24 hours: a change in eating, mood, confusion, skin, sleep, mild pain, refused care,
//                   family conflict, a problem with the visit) or none (a normal day: no card; "something else worth a
//                   look" is gone). It also gives the one sentence of why, and the caregiver's own words that caused it
//                   (kept only if they are really in the note, so the Hub can highlight them). 3 yellow flags for one
//                   client in 14 days become one red flag ("pattern"). Red flags also show on the Incidents owner's My
//                   Work (also_for). With ops_settings.care_notes_red_text_live on, a red flag texts the Client Care owner
//                   one short line, 8am to 9pm only. A practice run counts reds and yellows (and the old yes/no, to compare).
//
//   My Desk 6b (2026-10-06, her go on Stage 6): the same run also asks a second, separate question of each note: did
//                   the client or family SAY something kind? A yes, with the words copied exactly from the note (checked
//                   here, word for word), becomes a SUGGESTION in the Kind Words jar: it waits for an owner or
//                   coordinator to say "yes, that's kind" (kind_word_decide), and only then is it in the jar and on
//                   desks. Nothing until ops_settings.kind_words_suggest_live is true; a practice run counts it.
//                   It never contacts anyone, and the caregiver is never told by the Hub.
// -----------------------------------------------------------------------------
import { jobCaller } from '../_shared/job-auth.ts'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { textAdmin, type Admin } from '../_shared/clockin-admins.ts'
import { normalisePhone } from '../_shared/outreach.ts'

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
/* The AI answers one question and nothing else. When it can't answer, the note is raised for a person to read.
   2026-09-29 (Samantha, after 347 showed 2 of 6 flags were failed reads filed as "something else worth a look"):
   one retry first, a larger answer allowance (the family sentence made answers longer), and a note that still can't
   be read gets its OWN label, so it is never mistaken for a concern the AI actually saw. */
export const UNREAD_KIND = 'the AI couldn\'t read this note'
type Concern = { concern: boolean; kind: string; urgent: boolean; why: string; failed: boolean; family_line?: string }
export async function askConcern(text: string, pauseMs = 2000): Promise<Concern> {
  const first = await askConcernOnce(text)
  if (!first.failed) return first
  await new Promise((r) => setTimeout(r, pauseMs))
  return await askConcernOnce(text)
}
// deno-lint-ignore no-explicit-any
async function askConcernOnce(text: string): Promise<Concern> {
  const key = Deno.env.get('ANTHROPIC_API_KEY') || ''
  const raised = { concern: true, kind: UNREAD_KIND, urgent: false, why: 'the AI could not read this note, so a person should', failed: true }
  if (!key) return raised
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 400, temperature: 0,
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
/* Red / yellow / none (see the top). The kinds a flag may name; nothing vague. */
export const LEVEL_KINDS = ['a fall or injury', 'safety at home', 'sudden illness or pain', 'medication', 'signs of neglect or abuse',
  'confusion or a change in behavior', 'mood', 'eating or drinking', 'skin or a wound', 'sleep', 'refused care', 'family conflict',
  'a problem with the caregiver or the visit']
export const RED_KINDS = new Set(['a fall or injury', 'safety at home', 'sudden illness or pain', 'medication', 'signs of neglect or abuse'])
type Level = { level: 'red' | 'yellow' | 'none'; kind: string; why: string; trigger: string; family_line: string; failed: boolean }
export async function askLevel(text: string, pauseMs = 2000): Promise<Level> {
  const first = await askLevelOnce(text)
  if (!first.failed) return first
  await new Promise((r) => setTimeout(r, pauseMs))
  return await askLevelOnce(text)
}
async function askLevelOnce(text: string): Promise<Level> {
  const key = Deno.env.get('ANTHROPIC_API_KEY') || ''
  const failed: Level = { level: 'yellow', kind: '', why: '', trigger: '', family_line: '', failed: true }
  if (!key) return failed
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 450, temperature: 0,
        system: 'You read one home-care caregiver\'s shift notes for a client (the care note, and notes on tasks) and decide how soon '
          + 'the office must look. "red" = act today: a fall or injury, a safety risk at home, sudden illness or bad or new pain, a '
          + 'medication mistake or missed medication, signs of neglect, abuse or exploitation. "yellow" = look within 24 hours: a '
          + 'specific change in eating or drinking, mood, confusion or behavior, skin or a wound, sleep, mild pain or illness, care '
          + 'the client refused, family conflict, or a problem with the visit or the caregiver. "none" = an ordinary day, including '
          + 'anything vague ("a bit tired", "quiet day") with no specific change named. Never flag an ordinary day. Answer ONLY '
          + 'minified JSON: {"level":"red"|"yellow"|"none","kind":one of ' + JSON.stringify(LEVEL_KINDS) + ' (empty when none),'
          + '"why":string (ONE plain sentence, at most 18 words, starting with the client\'s first name, saying what happened; '
          + 'empty when none),"trigger":string (the words in the note that caused this, copied EXACTLY, at most 25 words; empty '
          + 'when none),"family_line":string (when not none, ONE plain sentence a coordinator could send the client\'s family: '
          + 'what happened and how the client is now, the least detail needed, no diagnoses, no medication names, no quotes, '
          + 'first name only; empty when none)}',
        messages: [{ role: 'user', content: text.slice(0, 6000) }] }) })
    if (!r.ok) return failed
    const j = await r.json().catch(() => null)
    const m = String(j?.content?.[0]?.text ?? '').match(/\{[\s\S]*\}/); if (!m) return failed
    const a = JSON.parse(m[0])
    let level = a.level === 'red' || a.level === 'yellow' ? a.level : 'none'
    if (level === 'yellow' && RED_KINDS.has(a.kind)) level = 'red'   /* her list: these are always act-today */
    if (level === 'none') return { level, kind: '', why: '', trigger: '', family_line: '', failed: false }
    const kind = LEVEL_KINDS.includes(a.kind) ? a.kind : (level === 'red' ? 'sudden illness or pain' : 'a problem with the caregiver or the visit')
    const trig = String(a.trigger ?? '').trim()
    return { level, kind, why: String(a.why ?? '').replace(/\s*\u2014\s*/g, ', ').slice(0, 200), trigger: trig && quoteInNote(trig, text) ? trig.slice(0, 300) : '',
      family_line: String(a.family_line ?? '').replace(/\s*\u2014\s*/g, ', ').slice(0, 240), failed: false }
  } catch { return failed }
}
/* How many flags this client has had in 14 days, and how many of them yellow (the pattern rule: a 3rd yellow = red). */
// deno-lint-ignore no-explicit-any
export function recentFlags(items: any[], clientAx: string, nowMs: number) {
  const since = nowMs - 14 * 864e5
  const mine = (items || []).filter((i) => i?.kind === 'care_note' && String(i?.client_ax ?? '') === clientAx && clientAx && Date.parse(String(i?.created_at ?? '')) >= since)
  return { flags: mine.length, yellows: mine.filter((i) => i?.level === 'yellow').length }
}
/* the caregiver's phone, from the Hub's caregiver list (AxisCare id first, then the name) */
// deno-lint-ignore no-explicit-any
function caregiverPhone(cgs: any[], ax: string, name: string): string {
  const n = name.trim().toLowerCase()
  const c = cgs.find((x) => ax && String(x?.axiscare_id ?? '') === ax) || cgs.find((x) => n && `${x?.first ?? ''} ${x?.last ?? ''}`.trim().toLowerCase() === n)
  return String(c?.phone ?? '').trim()
}
// deno-lint-ignore no-explicit-any
async function domainOwnerEmail(db: any, code: string): Promise<string> {
  try {
    const { data: dom } = await db.from('domains').select('owner_person').eq('code', code).eq('entity', 'cc_ihs').maybeSingle()
    if (!dom?.owner_person) return ''
    const { data: pp } = await db.from('persons').select('primary_email').eq('person_id', dom.owner_person).maybeSingle()
    return String(pp?.primary_email ?? '').toLowerCase()
  } catch { return '' }
}
const chiHour = (ms: number) => Number(new Date(ms).toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false })) % 24

/* My Desk 6b: kind words in a shift note. A separate question so the concern answer above is never changed by it.
   The quote must be the note's own words: anything the AI wrote itself is thrown away (kindRead checks it). */
export const KIND_WHO = ['the client', 'a family member', 'someone else']
type Kind = { kind: boolean; quote: string; who: string; failed: boolean }
const squash = (x: string) => String(x ?? '').toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\s+/g, ' ').trim()
export function quoteInNote(quote: string, text: string) {
  const q = squash(quote).replace(/^["'\s]+|["'\s.]+$/g, '')
  return q.length >= 8 && squash(text).includes(q)
}
export async function askKind(text: string): Promise<Kind> {
  const key = Deno.env.get('ANTHROPIC_API_KEY') || ''
  const none = { kind: false, quote: '', who: '', failed: true }
  if (!key) return none
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 300, temperature: 0,
        system: 'You read one home-care caregiver\'s shift notes for a client. Find KIND WORDS: something warm, grateful or '
          + 'loving that the client or a family member SAID about the caregiver, the visit or the company (for example the '
          + 'note says "Ruth told me she loves when I come" or "her daughter thanked us for the help"). The caregiver '
          + 'describing the day or their own work is NOT kind words, and neither is an ordinary good day ("in good spirits", '
          + '"enjoyed lunch"). When unsure, it is NOT. Answer ONLY minified JSON: {"kind":bool,"quote":string (the kind '
          + 'words copied EXACTLY, letter for letter, from the note: one or two sentences, at most 40 words; empty when kind '
          + 'is false),"who":one of ' + JSON.stringify(KIND_WHO) + ' (who said it)}',
        messages: [{ role: 'user', content: text.slice(0, 6000) }] }) })
    if (!r.ok) return none
    const j = await r.json().catch(() => null)
    const m = String(j?.content?.[0]?.text ?? '').match(/\{[\s\S]*\}/); if (!m) return none
    const a = JSON.parse(m[0])
    return { kind: a.kind === true, quote: String(a.quote ?? '').trim().slice(0, 600), who: KIND_WHO.includes(a.who) ? a.who : 'someone else', failed: false }
  } catch { return none }
}

// deno-lint-ignore no-explicit-any
async function readKey(db: any, key: string): Promise<any[]> {
  const { data } = await db.from('app_data').select('data').eq('key', key).maybeSingle()
  return Array.isArray(data?.data) ? data.data : []
}
const whenChi = (iso: unknown) => { try { return new Date(String(iso)).toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) } catch { return '' } }
const dayChi = (iso: unknown) => { try { return new Date(String(iso)).toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric' }) } catch { return '' } }

// deno-lint-ignore no-explicit-any
export async function clientCareOwner(db: any): Promise<{ email: string; name: string }> {
  try {
    const { data: dom } = await db.from('domains').select('owner_person').eq('code', 'client_care').eq('entity', 'cc_ihs').maybeSingle()
    if (!dom?.owner_person) return { email: '', name: '' }
    const { data: pp } = await db.from('persons').select('primary_email,full_name').eq('person_id', dom.owner_person).maybeSingle()
    return { email: String(pp?.primary_email ?? '').toLowerCase(), name: String(pp?.full_name ?? '') }
  } catch { return { email: '', name: '' } }
}
// deno-lint-ignore no-explicit-any
export async function flagRun(db: any, opts: { practice: boolean; hours?: number }) {
  const { token, site } = axisCreds()
  if (!token || !/^\d+$/.test(site)) return { error: 'AxisCare credentials not set on this project' }
  const { data: os } = await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
  const live = os?.data?.care_notes_flag_live === true   /* the switch, like coverage_flag_live */
  const kindLive = os?.data?.kind_words_suggest_live === true   /* My Desk 6b: its own switch (Owners Hub Admin page) */
  const levelsLive = os?.data?.care_notes_levels_live === true   /* red / yellow flags (her switch, Owners Hub Admin page) */
  const redTextLive = levelsLive && os?.data?.care_notes_red_text_live === true
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
    days_with_words: 0, already_flagged: 0, asked: 0, flagged: 0, urgent: 0, ai_could_not_read: 0, by_kind: {} as Record<string, number>, items_made: 0,
    levels_switch: levelsLive, red_text_switch: redTextLive, red: 0, yellow: 0, normal_day: 0, pattern_red: 0, red_texts: 0, by_level_kind: {} as Record<string, number>,
    kind_switch: kindLive, kind_asked: 0, kind_found: 0, kind_not_in_note: 0, kind_ai_failed: 0, kind_already: 0, kind_suggested: 0 }
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
  const items = await readKey(db, 'ops_items')   /* read in practice too (the pattern count); practice writes nothing */
  const useLevels = opts.practice || levelsLive
  const cgs = useLevels && !opts.practice ? await readKey(db, 'caregivers') : []
  const incidents = levelsLive && !opts.practice ? await domainOwnerEmail(db, 'incidents') : ''
  /* 468 (Samantha 2026-10-06, after 467 showed 30 open flags with nobody on them): a new flag lands on whoever owns
     Client Care (Hub Settings > who owns what), not on nobody. No owner set there = unassigned, as before. */
  const cc = opts.practice ? { email:'', name:'' } : await clientCareOwner(db)
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
    const text = (note ? 'Care note: ' + note : 'No care note.') + (tasks.length ? '\nTasks: ' + tasks.join('; ') : '')
    if (opts.practice || kindLive) await kindPass(db, opts.practice, k, text, last, out)
    if (have.has(id) && !opts.practice) { out.already_flagged++; continue }
    if (useLevels) { await levelPass(db, opts, { id, k, text, note, tasks, last, items, cc, cgs, incidents, redTextLive, now, out, have }); if (!opts.practice) continue }
    out.asked++
    const a = await askConcern(text, Number(Deno.env.get('CARE_NOTES_PAUSE_MS') ?? 2000))
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
      title: a.failed ? `Please read: ${clientFirst}'s ${dayChi(last?.startDate ?? last?.scheduledStartDate)} visit note (the AI couldn't read it)`
        : `Possible concern on ${clientFirst}'s ${dayChi(last?.startDate ?? last?.scheduledStartDate)} visit: ${a.kind}`,
      about: clientName, caregiver: cg, client_ax: String(last?.client?.id ?? ''),
      family_line: a.family_line || '',   /* N3: a suggested sentence for the family; the coordinator edits it */
      detail: `${cg} wrote after the ${whenChi(last?.startDate ?? last?.scheduledStartDate)} visit:\n\n`
        + (note ? `"${note}"` : '(no care note)') + (tasks.length ? '\n\n' + tasks.join('\n') : '')
        + (a.failed ? `\n\nThe AI couldn't read this note (twice), so it hasn't judged it either way. A person should read it; close it if it's an ordinary day.`
                    : `\n\nWhy it was flagged: ${a.why || a.kind}.`) + `\nRead it, then decide what happens next. This never contacts anyone by itself.`,
      owner: cc.email, owner_name: cc.name, due: new Date(now + (a.urgent ? 4 : 24) * 3600e3).toISOString(),
      created_at: new Date().toISOString(), created_by: 'care-notes', opened_by: 'care-note-flag' } })
    if (!error) out.items_made++
  }
  if (!opts.practice) {
    if (!out.stopped_early) await db.rpc('upsert_app_data_item', { target_key: 'care_notes_state', item: { id: 'state', last_look: new Date(now).toISOString() } })
    try { await db.rpc('upsert_app_data_item', { target_key: 'automation_heartbeats', item: { id: 'hb_care-notes-flag', automation: 'care-notes-flag',
      at: new Date().toISOString(), ok: !out.stopped_early, note: (levelsLive ? `${out.red} red, ${out.yellow} yellow of ${out.red + out.yellow + out.normal_day} read` : `${out.flagged} flagged of ${out.asked} read`) + (kindLive ? `; ${out.kind_suggested} kind word${out.kind_suggested === 1 ? '' : 's'} suggested` : '') + (out.stopped_early ? '; AxisCare asked us to slow down' : '') } }) } catch { /* a beat must not stop the run */ }
  }
  return out
}

/* One caregiver-client-day's words, read for a level. A red or yellow becomes a card (never in practice). */
// deno-lint-ignore no-explicit-any
async function levelPass(db: any, opts: { practice: boolean }, c: any) {
  const { id, text, note, tasks, last, items, cc, cgs, incidents, redTextLive, now, out } = c
  const a = await askLevel(text, Number(Deno.env.get('CARE_NOTES_PAUSE_MS') ?? 2000))
  if (a.failed) out.ai_could_not_read++
  if (!a.failed && a.level === 'none') { out.normal_day++; return }
  const clientAx = String(last?.client?.id ?? '')
  const past = recentFlags(items, clientAx, now)
  let level: 'red' | 'yellow' | 'unread' = a.failed ? 'unread' : a.level as 'red' | 'yellow'
  let pattern = 0
  if (level === 'yellow' && past.yellows + 1 >= 3) { level = 'red'; pattern = past.yellows + 1; out.pattern_red++ }
  if (level === 'red') out.red++; else if (level === 'yellow') out.yellow++
  if (!a.failed) out.by_level_kind[`${level} · ${a.kind}`] = (out.by_level_kind[`${level} · ${a.kind}`] ?? 0) + 1
  if (opts.practice) return
  const clientFirst = String(last?.client?.firstName ?? '').trim() || 'the client'
  const clientName = [clientFirst, String(last?.client?.lastName ?? '').trim()].filter(Boolean).join(' ')
  const cg = [String(last?.caregiver?.firstName ?? '').trim(), String(last?.caregiver?.lastName ?? '').trim()].filter(Boolean).join(' ') || 'The caregiver'
  const cgAx = String(last?.caregiver?.id ?? '')
  const day = dayChi(last?.startDate ?? last?.scheduledStartDate)
  const why = a.failed ? 'The AI couldn\'t read this note (twice), so a person should.' : (pattern ? `Pattern: ${pattern} concerns for ${clientFirst} in 2 weeks. ` : '') + (a.why || a.kind)
  const also = level === 'red' && incidents && incidents !== cc.email ? [incidents] : []
  const item = {
    id, kind: 'care_note', domain: 'client_care', status: 'open', level, flag_kind: a.kind || '', why, trigger: a.trigger || '',
    pattern_count: pattern || 0, flags_14d: past.flags + 1,
    urgency: level === 'red' ? 'urgent' : 'normal',
    title: level === 'unread' ? `Please read: ${clientFirst}'s ${day} visit note (the AI couldn't read it)`
      : `${level === 'red' ? 'Red' : 'Yellow'} flag: ${clientFirst}'s ${day} visit, ${a.kind}`,
    about: clientName, caregiver: cg, caregiver_ax: cgAx, caregiver_phone: caregiverPhone(cgs, cgAx, cg), client_ax: clientAx, visit_day: day,
    family_line: a.family_line || '',
    detail: `${cg} wrote after the ${whenChi(last?.startDate ?? last?.scheduledStartDate)} visit:\n\n` + (note ? `"${note}"` : '(no care note)')
      + (tasks.length ? '\n\n' + tasks.join('\n') : '') + `\n\nWhy it's here: ${why}\nThis never contacts anyone by itself.`,
    owner: cc.email, owner_name: cc.name, also_for: also,
    due: new Date(now + (level === 'red' ? 4 : 24) * 3600e3).toISOString(),
    created_at: new Date().toISOString(), created_by: 'care-notes', opened_by: 'care-note-flag' }
  const { error } = await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item })
  if (error) return
  out.items_made++; items.push(item)
  /* one short text to the Client Care owner for a red flag, 8am to 9pm only (her rule: no office texts at night) */
  const h = chiHour(Date.now())
  if (level === 'red' && redTextLive && cc.email && h >= 8 && h < 21) {
    try {
      const { data } = await db.from('app_data').select('data').eq('key', 'coordinator_staff').maybeSingle()
      // deno-lint-ignore no-explicit-any
      const p = (Array.isArray(data?.data) ? data.data : []).find((x: any) => String(x?.email ?? '').toLowerCase() === cc.email)
      const name = String(p?.name || cc.name || cc.email.split('@')[0])
      const admin: Admin = { email: cc.email, name, first: name.split(/\s+/)[0], phone: normalisePhone(p?.phone) || null }
      const ghl = { token: Deno.env.get('GHL_TOKEN') || Deno.env.get('GHL_API_KEY') || '', locationId: Deno.env.get('GHL_LOCATION_ID') || '' }
      const msg = `Red flag on ${clientFirst}'s ${day} visit (${a.kind || 'a pattern'}): ${String(why).slice(0, 120)} It's on your My Work: https://cc.mo-care.com/#mywork`
      if (await textAdmin(db, ghl, admin, msg)) { out.red_texts++; await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { ...item, texted_to: cc.email, texted_at: new Date().toISOString() } }) }
    } catch { /* the card is there either way; a failed text raises its own card */ }
  }
}

/* RE-READ (Desktop 472, Samantha 2026-10-06: "make the re-read step"): the shift-note flags that are open and were made
   before red and yellow existed get the same red / yellow / none question, from the caregiver's words already on the card.
   Red or yellow: the card gets its level, why, the words that caused it, and (red) the Incidents owner; its due time only
   ever moves sooner. None (the new rules call it an ordinary day): left open and unchanged, listed for a person to close.
   Sends nothing. Practice: counts only. */
// deno-lint-ignore no-explicit-any
export function textFromCard(it: any): string {
  const d = String(it?.detail ?? '')
  const m = /"([\s\S]*?)"(?:\n|$)/.exec(d)
  const note = m ? m[1].trim() : ''
  const tasks = d.split('\n').filter((l) => /: not done|: "/.test(l) && !l.startsWith('"'))
  if (!note && !tasks.length) return ''
  return (note ? 'Care note: ' + note : 'No care note.') + (tasks.length ? '\nTasks: ' + tasks.join('; ') : '')
}
// deno-lint-ignore no-explicit-any
export async function regradeRun(db: any, opts: { practice: boolean }) {
  const items = await readKey(db, 'ops_items')
  const incidents = opts.practice ? '' : await domainOwnerEmail(db, 'incidents')
  // deno-lint-ignore no-explicit-any
  const olds = items.filter((i: any) => i?.kind === 'care_note' && i?.status === 'open' && !i?.level)
  // deno-lint-ignore no-explicit-any
  const out = { ok: true, practice: opts.practice, looked: olds.length, red: 0, yellow: 0, normal_day: 0, unread: 0, no_words: 0, changed: 0, cards: [] as any[] }
  const now = Date.now()
  for (const it of olds) {
    const text = textFromCard(it)
    const first = String(it?.about ?? '').trim().split(/\s+/)[0] || 'a client'
    if (!text) { out.no_words++; out.cards.push({ client: first, level: 'no words on the card' }); continue }
    const a = await askLevel(text, Number(Deno.env.get('CARE_NOTES_PAUSE_MS') ?? 2000))
    if (!a.failed && a.level === 'none') { out.normal_day++; out.cards.push({ client: first, level: 'ordinary day (left open for you to close)', title: String(it.title ?? '').slice(0, 90) }); continue }
    // deno-lint-ignore no-explicit-any
    const past = recentFlags(items.filter((x: any) => x?.id !== it.id), String(it?.client_ax ?? ''), now)
    let level: 'red' | 'yellow' | 'unread' = a.failed ? 'unread' : a.level as 'red' | 'yellow'
    let pattern = 0
    if (level === 'yellow' && past.yellows + 1 >= 3) { level = 'red'; pattern = past.yellows + 1 }
    if (level === 'red') out.red++; else if (level === 'yellow') out.yellow++; else out.unread++
    out.cards.push({ client: first, level, kind: a.kind || '' })
    if (opts.practice) continue
    const day = String(it?.title ?? '').match(/'s ([A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}) visit/)?.[1] || ''
    const why = a.failed ? 'The AI couldn\'t read this note (twice), so a person should.' : (pattern ? `Pattern: ${pattern} concerns for ${first} in 2 weeks. ` : '') + (a.why || a.kind)
    const soon = new Date(now + (level === 'red' ? 4 : 24) * 3600e3).toISOString()
    const due = it.due && String(it.due) < soon ? it.due : soon
    const owner = String(it.owner ?? '').toLowerCase()
    const item = { ...it, level, flag_kind: a.kind || '', why, trigger: a.trigger || '', pattern_count: pattern || 0, flags_14d: past.flags + 1,
      urgency: level === 'red' ? 'urgent' : (it.urgency === 'high' ? 'normal' : (it.urgency || 'normal')), due, visit_day: it.visit_day || day,
      title: level === 'unread' ? it.title : `${level === 'red' ? 'Red' : 'Yellow'} flag: ${first}'s ${day ? day + ' ' : ''}visit, ${a.kind}`,
      also_for: level === 'red' && incidents && incidents !== owner ? [incidents] : [],
      family_line: it.family_line || a.family_line || '', regraded_at: new Date().toISOString(),
      history: (Array.isArray(it.history) ? it.history : []).concat([{ at: new Date().toISOString(), by: 'Shift-note re-read (Desktop 472)', text: `Re-read with the new rules: ${level === 'unread' ? 'the AI couldn\'t read it' : level + ' flag'}` }]) }
    const { error } = await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item })
    if (!error) out.changed++
  }
  return out
}

/* My Desk 6b: one caregiver-client-day's kind words become a suggestion waiting for a person's yes (never straight into
   the jar). Counted only in practice. Once per day's note: a run that re-reads the same shifts finds it already there. */
// deno-lint-ignore no-explicit-any
async function kindPass(db: any, practice: boolean, k: string, text: string, last: any, out: any) {
  const ref = 'carenote:' + k
  if (!practice) {
    const { data: had } = await db.from('kind_words').select('id').eq('source_ref', ref).limit(1)
    if (Array.isArray(had) && had.length) { out.kind_already++; return }
  }
  out.kind_asked++
  const a = await askKind(text)
  if (a.failed) { out.kind_ai_failed++; return }
  if (!a.kind || !a.quote) return
  if (!quoteInNote(a.quote, text)) { out.kind_not_in_note++; return }   /* only the note's own words, never the AI's */
  out.kind_found++
  if (practice) return
  const clientFirst = String(last?.client?.firstName ?? '').trim()
  const clientName = [clientFirst, String(last?.client?.lastName ?? '').trim()].filter(Boolean).join(' ')
  const cg = [String(last?.caregiver?.firstName ?? '').trim(), String(last?.caregiver?.lastName ?? '').trim()].filter(Boolean).join(' ')
  const who = a.who === 'the client' ? (clientFirst || 'The client') : a.who === 'a family member' ? (clientFirst ? clientFirst + '\'s family' : 'The family')
    : (clientFirst ? 'Someone at ' + clientFirst + '\'s visit' : 'Someone at a visit')
  const { error } = await db.from('kind_words').insert({ quote: a.quote.replace(/^["\u201C]+|["\u201D]+$/g, '').trim(), who: who.slice(0, 200),
    about: cg.slice(0, 200), about_role: cg ? 'caregiver' : '', source: 'shift_note', source_ref: ref,
    said_on: k.split('|')[2] || null, link: last?.client?.id ? { type: 'client', ax: String(last.client.id), name: (clientName || 'the client').slice(0, 80) } : null,
    status: 'suggested', suggested_by: 'care-notes' })
  if (!error) out.kind_suggested++
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
  if (q.get('regrade') === '1') {
    if ((await jobCaller(req, false)) !== 'owner') return json({ error: 'not allowed' }, 401)
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    return json(await regradeRun(db, { practice: q.get('practice') === '1' }))
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
