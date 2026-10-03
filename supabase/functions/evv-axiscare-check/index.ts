// Supabase Edge Function: evv-axiscare-check  (shared hub project)
// -----------------------------------------------------------------------------
// 422 (2026-10-03, Samantha). The office corrects an EVV visit's clock-in / clock-out BY HAND in AxisCare: AxisCare's
// API can move a visit's SCHEDULED times (PATCH /api/visits/{id}) but not the actual clockIn / clockOut, so this
// function NEVER writes to AxisCare. Every AxisCare call here is a GET. It helps and it checks:
//
//   POST { submission_id }                 find the AxisCare visit for a linked EVV correction form (the client and
//                                          caregiver the office confirmed, on the visit date) and compare its clock-in
//                                          and clock-out (America/Chicago) with the corrected times on the form,
//                                          1 minute either way. Exactly one visit: compared and stamped on the form.
//                                          Several: listed for the office to pick. None: said.
//   POST { submission_id, visit_id }       the same, for the visit the office picked
//   POST { submission_ids: [..up to 8] }   the same for several forms (the Hub's lists check the ones waiting)
//
// Stamped on the form (evv_submissions): axiscare_visit_id, axiscare_checked_at, axiscare_seen ("08:02-14:00"),
// axiscare_done_at (set when it matches, cleared when it no longer does). Nothing else is written; nothing is sent.
// Signed-in office staff only (requireStaff). Outcomes: match | mismatch | several | none | not_linked | error.
// -----------------------------------------------------------------------------
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const AC_VERSION = '2023-10-01'
const TZ = 'America/Chicago'
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
function axisCreds() {
  let token = ''
  for (const n of ['AXISCARE_API_KEY', 'AXISCARE_TOKEN', 'AXISCARE_VISITS_TOKEN']) { const v = Deno.env.get(n); if (v) { token = v; break } }
  return { token, site: Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || '' }
}
// deno-lint-ignore no-explicit-any
const rowsOf = (x: any): any[] => Array.isArray(x) ? x : (x && typeof x === 'object' ? Object.values(x) : [])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 'YYYY-MM-DD' of an instant, in Chicago */
export const chiDate = (iso: string) => new Date(iso).toLocaleString('sv-SE', { timeZone: TZ }).slice(0, 10)
/** 'HH:MM' (24h) of an instant, in Chicago */
export const chiHm = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).slice(0, 5)
const toMin = (hm: string) => { const m = String(hm || '').match(/^(\d{1,2}):(\d{2})/); return m ? (+m[1]) * 60 + (+m[2]) : null }
/** minutes apart on the clock face (an overnight shift's 23:59 vs 00:00 is 1 minute) */
export const minutesApart = (a: string, b: string) => { const x = toMin(a), y = toMin(b); if (x == null || y == null) return null; const d = Math.abs(x - y) % 1440; return Math.min(d, 1440 - d) }
const addDay = (d: string, n: number) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10) }
const time12 = (hm: string) => { const m = toMin(hm); if (m == null) return ''; const h = Math.floor(m / 60), mm = String(m % 60).padStart(2, '0'); return `${h % 12 || 12}:${mm} ${h >= 12 ? 'PM' : 'AM'}` }

// deno-lint-ignore no-explicit-any
export function summarize(v: any) {
  const sched = [v?.scheduledStartDate ?? v?.startDate, v?.scheduledEndDate ?? v?.endDate]
  const cin = v?.clockIn?.time ? chiHm(v.clockIn.time) : '', cout = v?.clockOut?.time ? chiHm(v.clockOut.time) : ''
  return {
    id: String(v?.id ?? ''), date: sched[0] ? chiDate(sched[0]) : '',
    caregiver: [v?.caregiver?.firstName, v?.caregiver?.lastName].filter(Boolean).join(' '), caregiver_id: String(v?.caregiver?.id ?? ''),
    scheduled: sched.every(Boolean) ? `${time12(chiHm(sched[0]))} to ${time12(chiHm(sched[1]))}` : '',
    clock_in: cin, clock_out: cout,
  }
}

/** Read (GET only) the client's visits around the visit date and keep the ones on that Chicago date. */
async function visitsFor(clientId: string, caregiverId: string, date: string) {
  const { token, site } = axisCreds()
  if (!token || !/^\d+$/.test(site)) return { error: 'AxisCare is not connected on this project (no API key or site number).' }
  const base = `https://${site}.axiscare.com`
  const head = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-AxisCare-Api-Version': AC_VERSION }
  // deno-lint-ignore no-explicit-any
  const list: any[] = []
  let url: string | null = `${base}/api/visits?clientIds=${encodeURIComponent(clientId)}&startDate=${addDay(date, -1)}&endDate=${addDay(date, 1)}`
  for (let page = 0; url && page < 5; page++) {
    let r: Response
    try { r = await fetch(url, { method: 'GET', headers: head }) } catch { return { error: 'AxisCare could not be reached. Try again in a minute.' } }
    if (r.status === 429) return { error: 'AxisCare asked us to slow down. Try again in a minute.' }
    if (!r.ok) return { error: `AxisCare answered ${r.status}. Try again, or check the visit in AxisCare by hand.` }
    // deno-lint-ignore no-explicit-any
    const j: any = await r.json().catch(() => ({}))
    for (const v of rowsOf(j?.results?.visits)) if (v && !v.removed && String(v?.client?.id ?? '') === clientId) list.push(v)
    url = j?.results?.nextPage ?? j?.nextPage ?? null
  }
  const onDay = list.filter((v) => { const s = v?.scheduledStartDate ?? v?.startDate; return s && chiDate(s) === date })
  const mine = caregiverId ? onDay.filter((v) => String(v?.caregiver?.id ?? '') === caregiverId) : onDay
  return { visits: mine, others: onDay.length - mine.length }
}

// deno-lint-ignore no-explicit-any
export async function checkOne(db: any, submissionId: string, pickedVisit = '') {
  if (!UUID.test(submissionId)) return { outcome: 'error', error: 'That is not a form number.' }
  const { data: s, error } = await db.from('evv_submissions')
    .select('id, visitdate, new_in, new_out, caregiver_axiscare_id, client_axiscare_id, axiscare_visit_id, axiscare_done_at').eq('id', submissionId).maybeSingle()
  if (error) return { outcome: 'error', error: 'The form could not be read: ' + (error.message || 'database error') }
  if (!s) return { outcome: 'error', error: 'That form was not found.' }
  if (!s.client_axiscare_id) return { outcome: 'not_linked', error: 'Link the form to its client (and caregiver) first, so the right AxisCare visit can be found.' }
  const want = { in: String(s.new_in || '').slice(0, 5), out: String(s.new_out || '').slice(0, 5) }
  const got = await visitsFor(String(s.client_axiscare_id), String(s.caregiver_axiscare_id || ''), String(s.visitdate))
  if ('error' in got) return { outcome: 'error', error: got.error }
  const visits = got.visits.map(summarize)
  let v = null
  if (pickedVisit) { v = visits.find((x) => x.id === pickedVisit) || null; if (!v) return { outcome: 'error', error: 'That visit is not one of this form\'s visits on ' + s.visitdate + '.', visits } }
  else if (visits.length === 1) v = visits[0]
  else if (s.axiscare_visit_id) v = visits.find((x) => x.id === String(s.axiscare_visit_id)) || null
  if (!v && visits.length > 1) return { outcome: 'several', visits, want }
  if (!v) return { outcome: 'none', others: got.others, want,
    error: `AxisCare has no visit on ${s.visitdate} for this client` + (s.caregiver_axiscare_id ? ' and caregiver' : '') + (got.others ? ` (it has ${got.others} with another caregiver)` : '') + '.' }
  const dIn = minutesApart(v.clock_in, want.in), dOut = minutesApart(v.clock_out, want.out)
  const match = dIn != null && dOut != null && dIn <= 1 && dOut <= 1
  const now = new Date().toISOString()
  const seen = `${v.clock_in || 'no clock-in'}-${v.clock_out || 'no clock-out'}`
  const stamp = { axiscare_visit_id: v.id, axiscare_checked_at: now, axiscare_seen: seen, axiscare_done_at: match ? (s.axiscare_done_at || now) : null }
  const up = await db.from('evv_submissions').update(stamp).eq('id', s.id)
  return { outcome: match ? 'match' : 'mismatch', visit: v, want, seen, checked_at: now, done_at: stamp.axiscare_done_at,
    stamp_error: up?.error ? ('The check worked, but it could not be saved on the form: ' + (up.error.message || 'database error')) : '' }
}

if (typeof Deno !== 'undefined' && Deno.serve) Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const who = await requireStaff(db, req, OFFICE_ROLES)
  if (!who.ok) return json({ error: who.error }, who.status)
  // deno-lint-ignore no-explicit-any
  let b: any = {}
  try { b = await req.json() } catch { b = {} }
  if (Array.isArray(b?.submission_ids)) {
    const ids = b.submission_ids.map(String).slice(0, 8)
    const results: Record<string, unknown> = {}
    for (const id of ids) {
      const r = await checkOne(db, id)
      results[id] = r
      if (r.outcome === 'error' && /slow down/.test(String((r as { error?: string }).error))) break
    }
    return json({ ok: true, results })
  }
  const id = String(b?.submission_id ?? '').trim()
  if (!id) return json({ error: 'Which form? (submission_id)' }, 400)
  return json({ ok: true, ...(await checkOne(db, id, String(b?.visit_id ?? '').trim())) })
})
