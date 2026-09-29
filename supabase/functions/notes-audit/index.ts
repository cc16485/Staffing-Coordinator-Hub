// Supabase Edge Function: notes-audit  (shared hub project)
// -----------------------------------------------------------------------------
// M0 (2026-09-29, her go: M0 only, read only, nothing sent). Two facts to prove from real AxisCare data before the
// missed-notes plan (M1–M3) is proposed again:
//   1. The counting rule: is a care note one per caregiver + client + (local) day? For days with more than one visit,
//      does every visit return the same note?
//   2. Can a caregiver add a note after clocking out? The API doesn't say who wrote a note or when, so this takes two
//      looks: ?m0=1 lists finished shifts with no note (ids only); ?recheck=1 a day later reads those same visits
//      again. Missing notes are also split by how the caregiver clocked out (app, phone, web).
// The owner's server key only. COUNTS AND AXISCARE ID NUMBERS ONLY: never a note's words, a name or a phone number.
// READ ONLY: every AxisCare call is a GET; nothing is written anywhere; nothing is sent.
// Removed after M0 (nothing else uses it).
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
const localDay = (iso: unknown) => iso ? new Date(String(iso)).toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10) : ''
// deno-lint-ignore no-explicit-any
const method = (c: any) => { const m = String(c?.method ?? '').trim().toLowerCase(); return m ? (/tele|phone|ivr/.test(m) ? 'phone' : /mobile|app/.test(m) ? 'app' : /web/.test(m) ? 'web' : 'other (' + m.slice(0, 20) + ')') : 'none' }

function ctx() {
  const { token, site } = axisCreds()
  return { ok: !!token && /^\d+$/.test(site), base: `https://${site}.axiscare.com`,
    head: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-AxisCare-Api-Version': AC_VERSION } as Record<string, string> }
}
// deno-lint-ignore no-explicit-any
async function readVisit(base: string, head: Record<string, string>, id: string): Promise<{ v: any; limited: boolean }> {
  try {
    const r = await fetch(`${base}/api/visits/${id}`, { headers: head })
    if (r.status === 429) return { v: null, limited: true }
    if (!r.ok) return { v: null, limited: false }
    const j = await r.json().catch(() => null)
    return { v: j?.results && typeof j.results === 'object' ? j.results : null, limited: false }
  } catch { return { v: null, limited: false } }
}
// four at a time, stopping on the first "slow down"
async function readAll(base: string, head: Record<string, string>, ids: string[]) {
  // deno-lint-ignore no-explicit-any
  const out = new Map<string, any>(); let limited = false, i = 0
  const worker = async () => { while (!limited && i < ids.length) { const id = ids[i++]; const r = await readVisit(base, head, id); if (r.limited) { limited = true; break } if (r.v) out.set(id, r.v) } }
  await Promise.all([worker(), worker(), worker(), worker()])
  return { out, limited }
}

export async function m0(days = 14) {
  const { ok, base, head } = ctx(); if (!ok) return { error: 'AxisCare credentials not set on this project' }
  // deno-lint-ignore no-explicit-any
  const list: any[] = []
  let url: string | null = `${base}/api/visits?startDate=${chiDay(-days)}&endDate=${chiDay(0)}`
  for (let page = 0; url && page < 40; page++) {
    const r: Response = await fetch(url, { headers: head })
    if (!r.ok) return { error: 'the visit list answered ' + r.status }
    // deno-lint-ignore no-explicit-any
    const j: any = await r.json().catch(() => ({}))
    for (const v of rowsOf(j?.results?.visits)) if (v && !v.removed) list.push(v)
    url = j?.results?.nextPage ?? j?.nextPage ?? null
  }
  const now = Date.now()
  const started = list.filter((v) => { const t = new Date(v?.startDate ?? v?.scheduledStartDate ?? 0).getTime(); return t && t < now })
  const { out, limited } = await readAll(base, head, started.slice(0, 400).map((v) => String(v?.id ?? '')))
  // deno-lint-ignore no-explicit-any
  const groups = new Map<string, any[]>()
  let finished = 0, notFinished = 0
  const clockIn: Record<string, number> = {}
  for (const v of out.values()) {
    const outTime = v?.clockOut?.time
    clockIn[method(v?.clockIn)] = (clockIn[method(v?.clockIn)] ?? 0) + 1
    if (!outTime) { notFinished++; continue }
    finished++
    const k = `${v?.caregiver?.id ?? '?'}|${v?.client?.id ?? '?'}|${localDay(v?.startDate ?? v?.scheduledStartDate)}`
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(v)
  }
  const r = { window: `${chiDay(-days)} to ${chiDay(0)}`, visits_listed: list.length, visits_started: started.length, visits_read: out.size,
    stopped_early_slow_down: limited, visits_finished: finished, visits_not_clocked_out: notFinished, clock_in_methods: clockIn,
    groups: groups.size, multi_visit_groups: 0, multi_same_note_on_every_visit: 0, multi_different_notes: 0, multi_note_on_some_visits_only: 0,
    groups_with_note: 0, groups_missing_note: 0,
    missing_by_clock_out: {} as Record<string, number>, with_note_by_clock_out: {} as Record<string, number>,
    caregivers: 0, caregivers_missing_1_plus: 0, caregivers_missing_3_plus: 0, most_missing_one_caregiver: 0,
    /* her rule: a missing note at a PHONE clock-out isn't a miss; these leave those out */
    caregivers_missing_3_plus_not_phone: 0, most_missing_one_caregiver_not_phone: 0,
    snapshot: [] as { v: string; k: string; e: string }[] }
  const perCg = new Map<string, number>(), perCgNP = new Map<string, number>()
  for (const [k, vs] of groups) {
    const notes = vs.map((v) => typeof v?.careNote === 'string' ? v.careNote.trim() : '')
    if (vs.length > 1) {
      r.multi_visit_groups++
      const nonEmpty = notes.filter(Boolean)
      if (nonEmpty.length === notes.length && new Set(nonEmpty).size === 1) r.multi_same_note_on_every_visit++
      else if (nonEmpty.length && nonEmpty.length < notes.length) r.multi_note_on_some_visits_only++
      else if (new Set(nonEmpty).size > 1) r.multi_different_notes++
    }
    const cg = k.split('|')[0]
    if (!perCg.has(cg)) perCg.set(cg, 0)
    // the last visit that day decides how they clocked out for the day
    const last = vs.slice().sort((a, b) => String(a?.clockOut?.time ?? '').localeCompare(String(b?.clockOut?.time ?? ''))).pop()
    const m = method(last?.clockOut)
    if (notes.some(Boolean)) { r.groups_with_note++; r.with_note_by_clock_out[m] = (r.with_note_by_clock_out[m] ?? 0) + 1 }
    else {
      r.groups_missing_note++; r.missing_by_clock_out[m] = (r.missing_by_clock_out[m] ?? 0) + 1
      perCg.set(cg, perCg.get(cg)! + 1)
      if (m !== 'phone') perCgNP.set(cg, (perCgNP.get(cg) ?? 0) + 1)
      r.snapshot.push({ v: String(last?.id ?? ''), k: k + '|' + m, e: String(last?.clockOut?.time ?? '') })
    }
  }
  r.caregivers = perCg.size
  for (const n of perCg.values()) { if (n >= 1) r.caregivers_missing_1_plus++; if (n >= 3) r.caregivers_missing_3_plus++; if (n > r.most_missing_one_caregiver) r.most_missing_one_caregiver = n }
  for (const n of perCgNP.values()) { if (n >= 3) r.caregivers_missing_3_plus_not_phone++; if (n > r.most_missing_one_caregiver_not_phone) r.most_missing_one_caregiver_not_phone = n }
  return r
}

export async function recheck(snapshot: { v: string; k: string; e?: string }[]) {
  const { ok, base, head } = ctx(); if (!ok) return { error: 'AxisCare credentials not set on this project' }
  const ids = snapshot.map((s) => String(s?.v ?? '')).filter((x) => /^[\w=:.\-]+$/.test(x)).slice(0, 400)
  const { out, limited } = await readAll(base, head, ids)
  let nowHasNote = 0, stillMissing = 0, unreadable = 0
  const gained: string[] = []
  for (const id of ids) {
    const v = out.get(id)
    if (!v) { unreadable++; continue }
    if (typeof v?.careNote === 'string' && v.careNote.trim()) { nowHasNote++; gained.push(id) } else stillMissing++
  }
  /* visit ids only (no note, no name), so the Desktop step can tell recent shifts from old ones */
  return { checked: ids.length, now_has_note: nowHasNote, still_missing: stillMissing, unreadable, gained, stopped_early_slow_down: limited }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok')
  if ((await jobCaller(req, false)) !== 'owner') return json({ error: 'not allowed' }, 401)
  const q = new URL(req.url).searchParams
  if (q.get('m0') === '1') return json(await m0(Math.min(Math.max(Number(q.get('days')) || 14, 1), 21)))
  if (q.get('recheck') === '1') {
    // deno-lint-ignore no-explicit-any
    let b: any = {}; try { b = await req.json() } catch { b = {} }
    return json(await recheck(Array.isArray(b?.snapshot) ? b.snapshot : []))
  }
  return json({ error: 'unknown request' }, 400)
})
