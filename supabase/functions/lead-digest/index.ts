// Supabase Edge Function: lead-digest — THE MORNING BRIEF (shared hub project)
// -----------------------------------------------------------------------------
// A personal 8am (Central) email per coordinator, and a FULL-PICTURE edition for
// admins (Samantha, 2026-09-14: "a really full picture that all admin get").
// What makes it get read: only their book, pass-alongs and quick-form leads
// always in full, everything else ranked and capped, every line one tap.
//
// Everyone (2026-10-02, Samantha: "can interviews and booked assessments be on 'Today' and also be in the email"):
// today's interviews (2pm and later marked as Samantha's interviews; ops_settings.afternoon_interviews, Hub Settings)
// and today's booked assessments. If either can't be loaded the email SAYS so (no silent failures).
// Personal sections: pass-alongs · while you were out (after-hours notes and
// leads since 5pm the last workday) · leads to call (tap-to-dial) · top five
// priorities · unowned triage · ticking clocks.
// Admin extras: family-update calls (med/high care notes flagged by the
// watcher) · write-ups needed (call-offs with under 4 hours notice) ·
// yesterday's EVV misses · today's AxisCare schedule with open shifts.
//
// Missing-note detection waits on AxisCare exposing notes at all (the hourly
// sweep still reports NONE FOUND); when that door opens both note sections
// light up without a redesign.
//
// Recipients: ops_settings.morning_brief_recipients [{name,email,admin}]
// (hub Settings card), falling back to LEAD_DIGEST_EMAILS. 8AM ALL YEAR (2026-10-02, was 6:45): cron fires the
// same job twice on weekdays (13:00 and 14:00 UTC). Only the run that lands in Chicago's 8 o'clock hour sends
// (13:00 UTC in daylight time, 14:00 UTC in standard time); the other answers "not 8am in Chicago". The sent-marker
// (morning_brief_state sent_<date>) keeps it to one email per person per day.
// ?to=email&force=1 sends one test brief regardless of time or marker.
//
// SECURITY (2026-09-28): ?to= and ?force= used to work for ANY caller, so anyone
// with the link could have the admin edition (leads with phone numbers, open
// items, today's schedule) emailed to any address. Now both need the caller's
// own Hub sign-in with an office role, ?to= must be that person's OWN email,
// and the admin edition goes only to someone listed as admin in the Settings
// card. The plain scheduled run: configured recipients only, at 8am Chicago, once a day.
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { jobCaller } from '../_shared/job-auth.ts'
import { reportSendProblem } from '../_shared/send-problems.ts'
import { ghlStaffContact } from '../_shared/staff-contact.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
const HUB = 'https://cc.mo-care.com'
/* The brief goes out at 8am Chicago time, weekdays (Samantha, 2026-10-02: "make that email send at 8am not 7am"). */
export const SEND_HOUR = 8
/* Interviews at or after this Chicago time are marked as this person's (Samantha, 2026-10-02: "mark interviews 2pm and
   after as Samantha's interviews"). Business config: Hub Settings writes ops_settings.afternoon_interviews
   {from:'14:00', name:'Samantha'}; these are the defaults until somebody saves it. Same rule as the Hub's Today. */
const AFTERNOON_DEFAULT = { from: '14:00', name: 'Samantha' }
// deno-lint-ignore no-explicit-any
export function afternoonRule(settings: any) {
  const s = (settings && settings.afternoon_interviews) || {}
  const from = /^\d{1,2}:\d{2}$/.test(String(s.from || '')) ? String(s.from) : AFTERNOON_DEFAULT.from
  const name = (s.name === undefined || s.name === null) ? AFTERNOON_DEFAULT.name : String(s.name).trim()
  const [h, m] = from.split(':').map(Number)
  return { from, name, fromMin: h * 60 + m }
}
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
/* A moment as Chicago {date, min (minutes after midnight, or null)}: a timestamp, a date, a zone-less local time, or
   GHL's words ("Monday, September 14, 2026 10:00 AM", already Chicago time). */
export function chiParts(x: unknown): { date: string; min: number | null } | null {
  const s = String(x || '').trim(); if (!s) return null
  if (/^\d{4}-\d\d-\d\d$/.test(s)) return { date: s, min: null }
  let m = s.match(/^(\d{4}-\d\d-\d\d)[T ](\d\d):(\d\d)(:\d\d(\.\d+)?)?$/)
  if (m) return { date: m[1], min: Number(m[2]) * 60 + Number(m[3]) }
  m = s.match(/([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})(?:\D+?(\d{1,2}):(\d{2})\s*([AaPp])\.?[Mm])?/)
  if (m) {
    const mi = MONTHS.findIndex((n) => n.startsWith(m![1].toLowerCase().slice(0, 3)))
    if (mi >= 0) {
      const date = m[3] + '-' + String(mi + 1).padStart(2, '0') + '-' + String(m[2]).padStart(2, '0')
      if (!m[4]) return { date, min: null }
      return { date, min: ((Number(m[4]) % 12) + (/p/i.test(m[6]) ? 12 : 0)) * 60 + Number(m[5]) }
    }
  }
  const t = Date.parse(s); if (isNaN(t)) return null
  const c = new Date(t).toLocaleString('sv-SE', { timeZone: 'America/Chicago' })
  return { date: c.slice(0, 10), min: Number(c.slice(11, 13)) * 60 + Number(c.slice(14, 16)) }
}
export const time12 = (min: number | null) => min === null ? 'time not set'
  : ((Math.floor(min / 60) % 12) || 12) + ':' + String(min % 60).padStart(2, '0') + (min < 720 ? 'am' : 'pm')
type Interview = { name: string; min: number | null; status: string; who: string }
type Assessment = { name: string; min: number | null; status: string; address: string; who: string }
/* Today's interviews (booked, done or no-show; cancelled ones are gone). Throws when the database can't answer. */
// deno-lint-ignore no-explicit-any
export async function interviewsOn(sb: any, day: string, rule: ReturnType<typeof afternoonRule>): Promise<Interview[]> {
  const mid = Date.parse(day + 'T00:00:00Z')
  const { data, error } = await sb.from('interview_bookings').select('id,applicant_id,starts_at,status')
    .in('status', ['booked', 'attended', 'noshow'])
    .gte('starts_at', new Date(mid - 864e5).toISOString()).lt('starts_at', new Date(mid + 2 * 864e5).toISOString())
    .order('starts_at')
  if (error) throw new Error(error.message || 'the interview list did not answer')
  // deno-lint-ignore no-explicit-any
  const rows = (data || []).map((b: any) => ({ b, p: chiParts(b.starts_at) })).filter((x: any) => x.p && x.p.date === day)
  // deno-lint-ignore no-explicit-any
  const ids = [...new Set(rows.map((x: any) => x.b.applicant_id).filter(Boolean))]
  // deno-lint-ignore no-explicit-any
  const names: Record<string, any> = {}
  if (ids.length) {
    const ap = await sb.from('job_applicants').select('id,first_name,last_name').in('id', ids)
    if (ap.error) throw new Error(ap.error.message || 'the applicant list did not answer')
    // deno-lint-ignore no-explicit-any
    for (const a of (ap.data || [])) names[(a as any).id] = a
  }
  // deno-lint-ignore no-explicit-any
  return rows.map(({ b, p }: any) => {
    const a = names[b.applicant_id] || {}
    return { name: [a.first_name, a.last_name].filter(Boolean).join(' ').trim() || 'Applicant', min: p.min,
      status: b.status === 'attended' ? 'done' : b.status === 'noshow' ? 'no-show' : 'booked',
      who: rule.name && p.min !== null && p.min >= rule.fromMin ? rule.name : '' }
  }).sort((x: Interview, y: Interview) => (x.min ?? 9999) - (y.min ?? 9999))
}
/* Today's booked assessments: a visit saved in the Hub (care_assessments) or a booking on the GHL New Client
   Assessment calendar (the inquiry's assessment_at). One family is listed once. Same rule as the Hub's Today. */
// deno-lint-ignore no-explicit-any
export function assessmentsOn(day: string, cas: any[], leads: any[]): Assessment[] {
  // deno-lint-ignore no-explicit-any
  const byId: Record<string, any> = {}; for (const l of leads) if (l) byId[l.id] = l
  // deno-lint-ignore no-explicit-any
  const live = (l: any) => !!l && !l.archived && l.status !== 'Lost'
  // deno-lint-ignore no-explicit-any
  const clientName = (l: any) => { if (!l) return ''
    const c = !l.client_name_not_provided && (l.client_first_name || l.client_last_name) ? [l.client_first_name, l.client_last_name].filter(Boolean).join(' ').trim() : ''
    return c || [l.first_name, l.last_name].filter(Boolean).join(' ').trim() }
  const out: Assessment[] = [], seen = new Set<string>()
  for (const a of cas) {
    if (!a || !a.visit_date || /cancel/i.test(String(a.status || ''))) continue
    const p = chiParts(a.visit_date); if (!p || p.date !== day) continue
    const l = a.lead_id ? byId[a.lead_id] : null; if (a.lead_id && l && !live(l)) continue
    let min = p.min
    const vt = /^(\d{1,2}):(\d{2})/.exec(String(a.visit_time || ''))   // 2026-10-07: the Hub form's visit time (same rule as the Hub's btAssessmentsOn)
    if (vt) min = Number(vt[1]) * 60 + Number(vt[2])
    else if (min === null && l?.assessment_at) { const lp = chiParts(l.assessment_at); if (lp && lp.date === day) min = lp.min }
    if (l) seen.add(l.id)
    out.push({ name: a.client_name || clientName(l) || 'Unnamed', min, status: String(a.status || 'Scheduled') === 'Scheduled' ? 'booked' : 'done',
      address: String(a.address || l?.client_address || '').trim(), who: String(a.coordinator || '').trim() })
  }
  for (const l of leads) {
    if (!live(l) || seen.has(l.id) || !l.assessment_at) continue
    const p = chiParts(l.assessment_at); if (!p || p.date !== day) continue
    out.push({ name: clientName(l) || 'Unnamed', min: p.min, status: 'booked', address: String(l.client_address || '').trim(), who: '' })
  }
  return out.sort((x, y) => (x.min ?? 9999) - (y.min ?? 9999))
}
const AC_VERSION = Deno.env.get('AXISCARE_API_VERSION') || '2023-10-01'
function axisCreds() {
  const order = ['AXISCARE_VISITS_TOKEN', 'AXISCARE_API_KEY', 'AXISCARE_TOKEN']
  let token = ''
  for (const k of order) { const v = Deno.env.get(k); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  return { token, site }
}
const chi = (iso: unknown) => {
  const t = Date.parse(String(iso || '')); if (isNaN(t)) return ''
  return new Date(t).toLocaleString('sv-SE', { timeZone: 'America/Chicago' })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const url = new URL(req.url)
  const testTo = (url.searchParams.get('to') || '').trim().toLowerCase()
  const force = url.searchParams.get('force') === '1' || !!testTo
  if (force) {
    const who = await requireStaff(sb, req, OFFICE_ROLES)
    if (!who.ok) return json({ error: who.error }, who.status)
    if (testTo && testTo !== who.email) return json({ error: 'A test brief can only go to your own email.' }, 403)
  } else {
    /* J1 (2026-09-29): the plain morning run answers only its weekday schedule or the owner's server key. Everyone
       else, the public key included, is refused before anything is read or sent. */
    const caller = await jobCaller(req)
    if (!caller) return json({ error: 'not allowed' }, 401)
    if (url.searchParams.get('auth_check') === '1') return json({ ok: true, caller })
  }

  const chiNow = new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' })
  const today = chiNow.slice(0, 10)
  const chiHour = Number(chiNow.slice(11, 13))
  const yesterday = new Date(Date.parse(today + 'T12:00:00') - 864e5).toISOString().slice(0, 10)

  if (!force) {
    /* J1: weekdays only, matching its schedule (Samantha, 2026-09-29). A staff member's own test brief can go any day. */
    const dow = new Date(Date.parse(today + 'T12:00:00Z')).getUTCDay()
    if (dow === 0 || dow === 6) return json({ status: 'weekend, no brief', date: today })
    if (chiHour !== SEND_HOUR) return json({ status: 'not 8am in Chicago, no brief', chicago: chiNow })
    const { data: st } = await sb.from('app_data').select('data').eq('key', 'morning_brief_state').maybeSingle()
    const stArr: unknown[] = Array.isArray(st?.data) ? st!.data : []
    // deno-lint-ignore no-explicit-any
    if (stArr.some((m: any) => m?.id === 'sent_' + today)) return json({ status: 'already sent today', date: today })
  }

  // ── Load the hub's memory once ──
  const grab = async (key: string) => {
    const { data } = await sb.from('app_data').select('data').eq('key', key).maybeSingle()
    // deno-lint-ignore no-explicit-any
    return (Array.isArray(data?.data) ? data!.data : []) as any[]
  }
  const [leads, ops, checkins, svs, covCases, staff, attEvents] = await Promise.all([
    grab('leads'), grab('ops_items'), grab('client_checkins'),
    grab('supervisory_visits'), grab('coverage_cases'), grab('coordinator_staff'),
    grab('attendance_events'),
  ])
  // deno-lint-ignore no-explicit-any
  let opsSettings: Record<string, any> = {}
  {
    const { data } = await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
    if (data?.data && !Array.isArray(data.data)) opsSettings = data.data
  }

  // ── Booked today: interviews and assessments (everyone's brief). A load that fails is SAID in the email. ──
  let ivToday: Interview[] = [], ivErr = ''
  try { ivToday = await interviewsOn(sb, today, afternoonRule(opsSettings)) } catch (e) { ivErr = String((e as Error)?.message || e).slice(0, 160) }
  let asToday: Assessment[] = [], asErr = ''
  try {
    const { data, error } = await sb.from('app_data').select('data').eq('key', 'care_assessments').maybeSingle()
    if (error) throw new Error(error.message)
    // deno-lint-ignore no-explicit-any
    asToday = assessmentsOn(today, Array.isArray(data?.data) ? data!.data as any[] : [], leads)
  } catch (e) { asErr = String((e as Error)?.message || e).slice(0, 160) }

  // ── Today in AxisCare: total visits and open (unassigned) shifts ──
  let acToday: { total: number; open: { time: string; client: string }[] } | null = null
  try {
    const { token, site } = axisCreds()
    if (token && site) {
      // deno-lint-ignore no-explicit-any
      const visits: any[] = []
      let vurl: string | null = `https://${site}.axiscare.com/api/visits?startDate=${today}&endDate=${today}`
      for (let page = 0; vurl && page < 6; page++) {
        const r: Response = await fetch(vurl, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-AxisCare-Api-Version': AC_VERSION } })
        if (!r.ok) break
        // deno-lint-ignore no-explicit-any
        const j: any = await r.json().catch(() => ({}))
        for (const v of (j?.results?.visits ?? j?.visits ?? [])) { if (!v?.removed) visits.push(v) }
        vurl = j?.results?.nextPage ?? j?.nextPage ?? j?.results?.nextPageUrl ?? j?.nextPageUrl ?? null
      }
      if (visits.length) acToday = {
        total: visits.length,
        open: visits.filter((v) => v?.caregiver?.id == null)
          .map((v) => ({ time: String(v?.scheduledStartDate ?? v?.startDate ?? '').slice(11, 16),
            client: [v?.client?.firstName, v?.client?.lastName].filter(Boolean).join(' ') || '?' }))
          .sort((a, b) => a.time.localeCompare(b.time)),
      }
    }
  } catch { /* the brief never fails because AxisCare is slow at dawn */ }

  // ── Write-ups needed: call-offs with under 4 hours notice (last 3 days) ──
  const shortNotice = covCases.filter((c) => {
    if (!c?.opened_at || !c?.shift_date || !/^\d\d:\d\d/.test(String(c.shift_time || ''))) return false
    if (String(c.shift_date) < new Date(Date.parse(today + 'T12:00:00') - 3 * 864e5).toISOString().slice(0, 10)) return false
    const openedChi = chi(c.opened_at); if (!openedChi) return false
    const noticeMs = Date.parse(`${c.shift_date}T${String(c.shift_time).slice(0, 5)}:00`) - Date.parse(openedChi.replace(' ', 'T'))
    return noticeMs < 4 * 3600000 // includes negative notice: called off after the start
  }).map((c) => {
    const openedChi = chi(c.opened_at)
    const noticeMs = Date.parse(`${c.shift_date}T${String(c.shift_time).slice(0, 5)}:00`) - Date.parse(openedChi.replace(' ', 'T'))
    const hrs = Math.round(noticeMs / 360000) / 10
    return { who: String(c.calling_off || 'Name not captured'), client: String(c.client || '?'),
      when: [c.shift_date, c.shift_time].filter(Boolean).join(' '), hrs }
  })

  // ── Family-update calls: the watcher's med/high care-note reviews ──
  const familyCalls = ops.filter((i) => i?.status === 'open' && String(i.id || '').startsWith('ops_note_'))

  // ── Yesterday's EVV misses ──
  const evvMisses = attEvents.filter((e) => e?.shift_date === yesterday && /^evv_missing/.test(String(e.type || '')))
  const evvIn = evvMisses.filter((e) => e.type === 'evv_missing_in').map((e) => e.caregiver)
  const evvOut = evvMisses.filter((e) => e.type === 'evv_missing_out').map((e) => e.caregiver)

  // ── While you were out: everything born after 5pm the last workday ──
  const dow = new Date(today + 'T12:00:00').getUTCDay() // 1=Mon
  const backDays = dow === 1 ? 3 : 1
  const afterHoursStart = new Date(Date.parse(today + 'T12:00:00') - backDays * 864e5).toISOString().slice(0, 10) + ' 17:00:00'
  const bornAfterHours = (iso: unknown) => { const c = chi(iso); return !!c && c >= afterHoursStart }
  /* Overnight means PEOPLE: a banked note, a caregiver's text, a family's
     booking. The midnight automation sweeps also stamp created_at overnight
     and would drown the human news, so machine-born items stay in My Work. */
  const humanBorn = (i: { created_by?: string; opened_by?: string }) =>
    !/^automation:/.test(String(i.created_by || '')) &&
    !/^(attendance|coverage)-watch$/.test(String(i.opened_by || ''))
  const overnightOps = ops.filter((i) => i?.status === 'open' && bornAfterHours(i.created_at) && humanBorn(i))
  const overnightLeads = leads.filter((l) => l?.status !== 'Converted' && l?.status !== 'Lost' && bornAfterHours(l.created_at))

  // ── Who gets a brief ──
  // deno-lint-ignore no-explicit-any
  let recips: { name: string; email: string; admin: boolean }[] = (Array.isArray(opsSettings.morning_brief_recipients)
    ? opsSettings.morning_brief_recipients : [])
    .map((r: any) => ({ name: String(r?.name || ''), email: String(r?.email || '').toLowerCase(), admin: r?.admin === true }))
    .filter((r: any) => r.email.includes('@'))
  if (!recips.length) {
    recips = (Deno.env.get('LEAD_DIGEST_EMAILS') || 'samantha@mo-care.com,krystal@mo-care.com')
      .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
      .map((email) => {
        // deno-lint-ignore no-explicit-any
        const p = staff.find((s: any) => String(s.email || '').toLowerCase() === email)
        return { name: String(p?.name || email.split('@')[0]), email, admin: email === 'samantha@mo-care.com' }
      })
  }
  if (testTo) {
    // your own brief: the admin edition only if the Settings card lists you as admin
    const hit = recips.find((r) => r.email === testTo)
    // deno-lint-ignore no-explicit-any
    const p = staff.find((x: any) => String(x?.email || '').toLowerCase() === testTo)
    recips = hit ? [hit] : [{ name: String(p?.name || testTo.split('@')[0]), email: testTo, admin: false }]
  }

  // ── Shared helpers ──
  const first = (n: unknown) => String(n || '').trim().split(/\s+/)[0].toLowerCase()
  const nameMatch = (recipName: string, coordinator: unknown) => {
    const c = String(coordinator || '').trim().toLowerCase()
    return !!c && (c === recipName.toLowerCase() || first(c) === first(recipName))
  }
  const now = Date.now()
  const openOps = ops.filter((i) => i?.status === 'open')
  const parked = (i: { sub_state?: string; check_back?: string }) => {
    if (i.sub_state !== 'waiting' || !i.check_back) return i.sub_state === 'waiting'
    return String(i.check_back).slice(0, 10) > today
  }
  const isPassAlong = (i: { opened_by?: string }) => i.opened_by === 'quick-capture'
  const dueMs = (i: { due?: string }) => { const t = Date.parse(String(i.due || '')); return isNaN(t) ? Infinity : t }
  const endOfToday = new Date(today + 'T23:59:59').getTime() + 6 * 3600000
  const openLeads = leads.filter((l) => l?.status !== 'Converted' && l?.status !== 'Lost')
  const quickish = (l: { source?: string }) => /quick capture|assessment booking/i.test(String(l.source || ''))
  const covOpen = covCases.filter((c) => c?.status === 'open')
  const latestCi = new Map<string, { due: string; date: string; coordinator: string }>()
  for (const c of checkins) {
    if (!c?.client_name) continue
    const prev = latestCi.get(c.client_name)
    if (!prev || (c.checkin_date || '') > prev.date)
      latestCi.set(c.client_name, { due: c.next_checkin_due || '', date: c.checkin_date || '', coordinator: c.coordinator || '' })
  }
  const svOverdue = svs.filter((v) => v?.due_date && v.due_date < today && !v.completed_date)

  // ── Email building blocks (table-based, inline styles, email-client safe) ──
  const NAVY = '#0E3860', TEAL = '#54BDB8', HONEY = '#FFC671', RED = '#DC2626', AMBER = '#B45309', GRAY = '#6B7280', BORDER = '#E7EDF4'
  const chip = (n: number, label: string, color: string) =>
    `<td align="center" style="padding:4px 6px;"><div style="background:#ffffff;border:1px solid ${BORDER};border-top:3px solid ${color};border-radius:10px;padding:8px 6px 7px;">` +
    `<div style="font-family:Arial,sans-serif;font-size:20px;font-weight:800;color:${color};line-height:1;">${n}</div>` +
    `<div style="font-family:Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${GRAY};margin-top:3px;">${esc(label)}</div></div></td>`
  const card = (icon: string, title: string, color: string, body: string, note = '') =>
    `<div style="background:#ffffff;border:1px solid ${BORDER};border-left:4px solid ${color};border-radius:10px;padding:12px 16px 10px;margin-top:12px;">` +
    `<div style="font-family:Arial,sans-serif;font-size:13px;font-weight:800;color:${NAVY};margin-bottom:4px;">${icon}&nbsp; ${esc(title)}</div>` +
    body + (note ? `<div style="font-family:Arial,sans-serif;font-size:12px;color:${GRAY};padding-top:6px;">${note}</div>` : '') + `</div>`
  const row = (main: string, sub: string, href: string, act: string) =>
    `<table role="presentation" width="100%" style="border-collapse:collapse;"><tr>` +
    `<td style="padding:7px 0;border-bottom:1px solid ${BORDER};font-family:Arial,sans-serif;">` +
    `<div style="font-size:14px;color:#1f2a36;line-height:1.45;">${main}</div>` +
    (sub ? `<div style="font-size:12px;color:${GRAY};margin-top:1px;line-height:1.45;">${sub}</div>` : '') +
    `</td><td align="right" valign="middle" style="padding:7px 0 7px 10px;border-bottom:1px solid ${BORDER};white-space:nowrap;">` +
    `<a href="${href}" style="font-family:Arial,sans-serif;color:${TEAL};font-weight:700;font-size:12px;text-decoration:none;">${esc(act)} →</a></td></tr></table>`
  const telLink = (p: unknown) => {
    const d = String(p || '').replace(/\D/g, '')
    return d.length >= 10 ? `<a href="tel:1${d.slice(-10)}" style="color:${NAVY};font-weight:700;text-decoration:none;">${esc(p)}</a>` : esc(String(p || ''))
  }
  const badge = (txt: string, bg: string, fg: string) =>
    ` <span style="background:${bg};color:${fg};font-size:10.5px;font-weight:700;padding:1px 7px;border-radius:99px;white-space:nowrap;">${esc(txt)}</span>`

  let sent = 0
  const summaries: Record<string, unknown>[] = []
  const ghlToken = Deno.env.get('GHL_TOKEN')
  const ghlLocation = Deno.env.get('GHL_LOCATION_ID')
  if (!ghlToken || !ghlLocation) return json({ error: 'GHL not configured' }, 500)
  const headers = { Authorization: `Bearer ${ghlToken}`, Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' }

  for (const r of recips) {
    const myFirst = (r.name.split(/\s+/)[0] || 'there')
    const mailLc = r.email

    const myPass = openOps.filter((i) => isPassAlong(i) && String(i.owner || '').toLowerCase() === mailLc)
    const myLeads = openLeads.filter((l) =>
      (nameMatch(r.name, l.assigned_coordinator) || !String(l.assigned_coordinator || '').trim()) &&
      l.follow_up_due && l.follow_up_due <= today)
      .sort((a, b) => String(a.follow_up_due).localeCompare(String(b.follow_up_due)))
    const myOps = openOps.filter((i) => !isPassAlong(i) && String(i.owner || '').toLowerCase() === mailLc && !parked(i))
      .filter((i) => i.sub_state === 'escalated' || (i.escalation_level || 0) > 0 || dueMs(i) <= endOfToday)
      .sort((a, b) => {
        const ea = (a.sub_state === 'escalated' || (a.escalation_level || 0) > 0) ? 0 : 1
        const eb = (b.sub_state === 'escalated' || (b.escalation_level || 0) > 0) ? 0 : 1
        if (ea !== eb) return ea - eb
        const ua = a.urgency === 'high' ? 0 : 1, ub = b.urgency === 'high' ? 0 : 1
        if (ua !== ub) return ua - ub
        return dueMs(a) - dueMs(b)
      })
    const triage = openOps.filter((i) => !String(i.owner || '').trim() && dueMs(i) <= endOfToday)
      .sort((a, b) => dueMs(a) - dueMs(b))
    const myOvernightOps = overnightOps.filter((i) => r.admin ||
      String(i.owner || '').toLowerCase() === mailLc || !String(i.owner || '').trim())
    const myOvernightLeads = overnightLeads.filter((l) => r.admin ||
      nameMatch(r.name, l.assigned_coordinator) || !String(l.assigned_coordinator || '').trim())
    const myCi = [...latestCi.entries()].filter(([, v]) => v.due && v.due < today &&
      (r.admin || nameMatch(r.name, v.coordinator) || !v.coordinator))
    const clearedYesterday = ops.filter((i) => i?.status === 'done' && String(i.closed_by || '').toLowerCase() === mailLc &&
      String(i.closed_at || '').slice(0, 10) === yesterday).length

    const top = myOps.slice(0, 5), moreOps = myOps.length - 5
    const leadTop = myLeads.slice(0, 8), moreLeads = myLeads.length - 8
    const triTop = triage.slice(0, 5)

    let body = ''
    // 🧑‍💼 Interviews today and 🏠 Assessments today: who is coming in and where we are going, first thing.
    const ivChip = (s: string) => s === 'no-show' ? badge('no-show', '#FDE8E8', RED) : s === 'done' ? badge('done', '#E3F4EA', '#1F6D45') : badge('booked', '#E6F4F3', '#1F6F6B')
    if (ivErr) body += card('🧑‍💼', 'Interviews today', RED, `<div style="font-family:Arial,sans-serif;font-size:13.5px;color:${RED};">Could not load today's interviews (${esc(ivErr)}). Check the Interviews tab in the Hub before anyone arrives.</div>`)
    else if (ivToday.length) body += card('🧑‍💼', `Interviews today (${ivToday.length})`, NAVY,
      ivToday.map((i) => row(`<b>${esc(time12(i.min))}</b> · ${esc(i.name)}` + ivChip(i.status) + (i.who ? badge(i.who + "'s interview", '#FFF4DE', AMBER) : ''),
        'In person at the office', `${HUB}/#today`, 'Open')).join(''))
    if (asErr) body += card('🏠', 'Assessments today', RED, `<div style="font-family:Arial,sans-serif;font-size:13.5px;color:${RED};">Could not load today's assessments (${esc(asErr)}). Check Today in the Hub.</div>`)
    else if (asToday.length) body += card('🏠', `Assessments today (${asToday.length})`, TEAL,
      asToday.map((a) => row(`<b>${esc(time12(a.min))}</b> · ${esc(a.name)}` + ivChip(a.status),
        esc([a.address || 'address not on file', a.who ? 'with ' + a.who : 'who is going is not on file'].join(' · ')), `${HUB}/#today`, 'Open')).join(''))
    // 🌙 While you were out: the news.
    if (myOvernightOps.length || myOvernightLeads.length) {
      const when = (iso: unknown) => {
        const c = chi(iso); if (!c) return ''
        const isToday = c.slice(0, 10) === today
        const hm = Number(c.slice(11, 13))
        const t12 = ((hm % 12) || 12) + ':' + c.slice(14, 16) + (hm < 12 ? 'am' : 'pm')
        return isToday ? t12 + ' this morning' : (c.slice(0, 10) === yesterday ? t12 + ' last night' : t12 + ' ' + c.slice(5, 10).replace('-', '/'))
      }
      const onOpsTop = myOvernightOps.slice(0, 8), onLeadsTop = myOvernightLeads.slice(0, 4)
      const onMore = Math.max(0, myOvernightOps.length - 8) + Math.max(0, myOvernightLeads.length - 4)
      body += card('🌙', 'While you were out', NAVY,
        onOpsTop.map((i) => row(`<b>${esc(i.about || i.title || '')}</b>` + (i.urgency === 'high' ? badge('urgent', '#FDE8E8', RED) : ''),
          esc(String(i.detail || '').slice(0, 120)) + ' · ' + esc(when(i.created_at)) + (i.created_by ? ' · ' + esc(String(i.created_by).split('@')[0]) : ''),
          `${HUB}/#mywork`, 'Open')).join('') +
        onLeadsTop.map((l) => row(`<b>New lead: ${esc([l.first_name, l.last_name].filter(Boolean).join(' '))}</b>` + (l.phone ? ' · ' + telLink(l.phone) : '') + (quickish(l) ? badge('quick form', '#FFF4DE', AMBER) : ''),
          esc(String(l.interest_notes || '').slice(0, 110)) + ' · ' + esc(when(l.created_at)),
          `${HUB}/#leadboard`, 'Open')).join('') +
        (onMore > 0 ? `<div style="font-family:Arial,sans-serif;font-size:12px;color:${GRAY};padding-top:6px;">plus ${onMore} more in My Work</div>` : ''),
        'What people sent in after 5pm' + (backDays > 1 ? ' Friday' : ' yesterday') + '.')
    }
    if (myPass.length) body += card('📝', `Passed along to you (${myPass.length})`, AMBER,
      myPass.map((i) => row(`<b>${esc(i.about || i.title || '')}</b>` + (i.urgency === 'high' ? badge('urgent', '#FDE8E8', RED) : ''),
        esc(String(i.detail || '').slice(0, 140)), `${HUB}/#mywork`, 'Open')).join(''))
    if (r.admin && familyCalls.length) body += card('💛', `Keep the family updated (${familyCalls.length})`, '#C2720E',
      familyCalls.map((i) => row(`<b>${esc(i.about || i.title || '')}</b>`,
        esc(String(i.detail || '').slice(0, 140)), `${HUB}/#ops`, 'Open')).join(''),
      'A caregiver rated a note medium or high. Read it, then decide whether the loved ones should hear from us by phone. Never a robot call.')
    if (r.admin && shortNotice.length) body += card('⚠️', `Write-ups needed: short-notice call-offs (${shortNotice.length})`, RED,
      shortNotice.map((c) => row(`<b>${esc(c.who)}</b> called off ${esc(c.client)}'s ${esc(c.when)} shift`,
        c.hrs < 0 ? '<b style="color:' + RED + ';">after the shift had started</b>' : `only <b>${c.hrs} hours</b> before start`,
        `${HUB}/#cgwriteups`, 'Write up')).join(''),
      'Under 4 hours notice per the attendance policy.')
    if (leadTop.length) body += card('📞', `Leads to call (${myLeads.length})`, NAVY,
      leadTop.map((l) => row(
        `<b>${esc([l.first_name, l.last_name].filter(Boolean).join(' '))}</b>${l.phone ? ' · ' + telLink(l.phone) : ''}` + (quickish(l) ? badge('quick form', '#FFF4DE', AMBER) : ''),
        (l.follow_up_due < today ? `<b style="color:${RED};">was due ${esc(l.follow_up_due)}</b>` : 'due today') +
        (l.interest_notes ? ' · ' + esc(String(l.interest_notes).slice(0, 100)) : ''),
        `${HUB}/#leadboard`, 'Open')).join('') +
      (moreLeads > 0 ? `<div style="font-family:Arial,sans-serif;font-size:12px;color:${GRAY};padding-top:6px;">plus ${moreLeads} more on the Leads board</div>` : ''))
    if (top.length) body += card('🎯', `Your top priorities (${myOps.length})`, RED,
      top.map((i) => row(`<b>${esc(i.about || i.title || '')}</b>`,
        ((i.sub_state === 'escalated' || (i.escalation_level || 0) > 0) ? `<b style="color:${RED};">escalated</b> · ` : '') +
        (dueMs(i) < now ? `<b style="color:${RED};">late</b>` : 'due today'),
        `${HUB}/#mywork`, 'Open')).join('') +
      (moreOps > 0 ? `<div style="font-family:Arial,sans-serif;font-size:12px;color:${GRAY};padding-top:6px;">plus ${moreOps} more in My Work</div>` : ''))
    if (triTop.length) body += card('🖐', `Nobody owns these yet (${triage.length})`, GRAY,
      triTop.map((i) => row(esc(i.about || i.title || ''), esc(String(i.detail || '').slice(0, 90)),
        `${HUB}/#ops`, 'Claim')).join(''))
    if (r.admin && (evvIn.length || evvOut.length)) body += card('⏰', 'Yesterday\'s EVV misses', AMBER,
      (evvIn.length ? row(`<b>No clock-in:</b> ${esc([...new Set(evvIn)].join(', '))}`, '', `${HUB}/#cgattendance`, 'Review') : '') +
      (evvOut.length ? row(`<b>No clock-out:</b> ${esc([...new Set(evvOut)].join(', '))}`, '', `${HUB}/#cgattendance`, 'Review') : ''))
    if (r.admin && acToday) body += card('🗓', `Today in AxisCare: ${acToday.total} visits`, TEAL,
      (acToday.open.length
        ? acToday.open.slice(0, 6).map((o) => row(`<b style="color:${RED};">Open shift</b> ${esc(o.time)} · ${esc(o.client)}`, '', `${HUB}/#coverage`, 'Cover')).join('') +
          (acToday.open.length > 6 ? `<div style="font-family:Arial,sans-serif;font-size:12px;color:${GRAY};padding-top:6px;">plus ${acToday.open.length - 6} more open</div>` : '')
        : `<div style="font-family:Arial,sans-serif;font-size:13.5px;color:#1f2a36;">Every visit today has a caregiver assigned. 💪</div>`))
    const clocks: string[] = []
    if (myCi.length) clocks.push(`<a href="${HUB}/#checkins" style="color:${NAVY};">${myCi.length} client check-in${myCi.length > 1 ? 's' : ''} past due</a>`)
    if (svOverdue.length) clocks.push(`<a href="${HUB}/#supervisory" style="color:${NAVY};">${svOverdue.length} supervisory visit${svOverdue.length > 1 ? 's' : ''} past due</a>`)
    if (covOpen.length) clocks.push(`<a href="${HUB}/#coverage" style="color:${NAVY};">${covOpen.length} open coverage case${covOpen.length > 1 ? 's' : ''}</a>`)
    if (clocks.length) body += card('🕰', 'Also ticking', TEAL,
      `<div style="font-family:Arial,sans-serif;font-size:13.5px;color:#1f2a36;line-height:2;">${clocks.join('<br>')}</div>`)

    const nothing = !body
    const good = nothing
      ? 'Nothing overdue, nothing waiting, nothing came in overnight. You are ahead. ☀️'
      : (clearedYesterday > 0 ? `You cleared ${clearedYesterday} item${clearedYesterday > 1 ? 's' : ''} yesterday. Keep going. 💪`
        : 'One at a time, top to bottom, and this list is gone by lunch.')

    // At-a-glance strip
    let glance = ''
    {
      const cells: string[] = []
      if (ivToday.length) cells.push(chip(ivToday.length, 'interviews', NAVY))
      if (asToday.length) cells.push(chip(asToday.length, 'assessments', TEAL))
      if (myPass.length) cells.push(chip(myPass.length, 'pass-alongs', AMBER))
      if (myOvernightOps.length + myOvernightLeads.length) cells.push(chip(myOvernightOps.length + myOvernightLeads.length, 'overnight', NAVY))
      if (myLeads.length) cells.push(chip(myLeads.length, 'leads to call', NAVY))
      if (myOps.length) cells.push(chip(myOps.length, 'priorities', RED))
      if (r.admin && shortNotice.length) cells.push(chip(shortNotice.length, 'write-ups', RED))
      if (r.admin && acToday) cells.push(chip(acToday.open.length, 'open shifts', acToday.open.length ? RED : TEAL))
      if (cells.length) glance = `<table role="presentation" width="100%" style="border-collapse:collapse;margin-top:12px;"><tr>${cells.slice(0, 5).join('')}</tr></table>`
    }

    const counts: string[] = []
    if (ivToday.length) counts.push(`${ivToday.length} interview${ivToday.length > 1 ? 's' : ''}`)
    if (asToday.length) counts.push(`${asToday.length} assessment${asToday.length > 1 ? 's' : ''}`)
    if (myOvernightOps.length + myOvernightLeads.length) counts.push(`${myOvernightOps.length + myOvernightLeads.length} overnight`)
    if (myPass.length) counts.push(`${myPass.length} pass-along${myPass.length > 1 ? 's' : ''}`)
    if (myLeads.length) counts.push(`${myLeads.length} lead${myLeads.length > 1 ? 's' : ''} to call`)
    if (myOps.length) counts.push(`${myOps.length} priorit${myOps.length > 1 ? 'ies' : 'y'}`)
    if (r.admin && acToday && acToday.open.length) counts.push(`${acToday.open.length} open shift${acToday.open.length > 1 ? 's' : ''}`)
    const subject = nothing ? `Your morning, ${myFirst}: all clear ☀️` : `Your morning, ${myFirst}: ${counts.slice(0, 3).join(', ')}`

    const html =
      `<div style="background:#F1F5FA;padding:14px 8px;"><div style="max-width:620px;margin:0 auto;">` +
      `<div style="background:${NAVY};border-radius:14px 14px 0 0;padding:20px 24px;">` +
      `<table role="presentation" width="100%" style="border-collapse:collapse;"><tr><td>` +
      `<div style="font-family:Arial,sans-serif;color:${HONEY};font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;">Caring Companions${r.admin ? ' · Full Picture' : ''}</div>` +
      `<div style="font-family:Arial,sans-serif;color:#ffffff;font-size:22px;font-weight:800;margin-top:3px;">Good morning, ${esc(myFirst)} ☕</div>` +
      `<div style="font-family:Arial,sans-serif;color:#9fb6cc;font-size:13px;margin-top:2px;">${new Date(today + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>` +
      `</td></tr></table></div>` +
      `<div style="background:#F8FAFD;border:1px solid ${BORDER};border-top:none;border-radius:0 0 14px 14px;padding:4px 16px 18px;">` +
      glance +
      (nothing ? `<p style="font-family:Arial,sans-serif;font-size:15px;color:#1f2a36;padding:10px 4px 0;">${good}</p>` : body) +
      `<div style="font-family:Arial,sans-serif;font-size:13px;color:${GRAY};margin-top:14px;padding:0 4px;">${nothing ? '' : good}</div>` +
      `<div style="margin-top:14px;padding:0 4px;"><a href="${HUB}/#mywork" style="display:inline-block;background:${NAVY};color:#ffffff;font-family:Arial,sans-serif;text-decoration:none;font-weight:700;font-size:13.5px;padding:10px 20px;border-radius:9px;">Start my day in the hub →</a></div>` +
      `</div><div style="text-align:center;font-family:Arial,sans-serif;color:#9aa3ad;font-size:11px;padding:12px;">Sent at 8am by your hub · cc.mo-care.com</div></div></div>`

    /* NO SILENT FAILURES (2026-10-01): the 8am scheduled brief has nobody watching, so a brief that doesn't go out
       raises a Needs Attention card (sender 'lead-digest'). A staff member's own test brief already shows its error
       in the Hub, so it raises no card. */
    const briefFailed = (why: string) => testTo ? Promise.resolve()
      : reportSendProblem(sb, { sender: 'lead-digest', channel: 'email', address: r.email, who: r.name, reasons: [why], failed: true })
    try {
      /* ONE CONTACT (2026-10-01): the brief goes to the contact found by the one-contact rule for email. */
      const contactId = await ghlStaffContact({ token: ghlToken, locationId: ghlLocation }, { channel: 'email', email: r.email, firstName: myFirst, lastName: 'CC Staff' })
      if (!contactId) { summaries.push({ to: r.email, error: 'no GHL contact' }); await briefFailed('no GHL contact'); continue }
      const em = await fetch('https://services.leadconnectorhq.com/conversations/messages', {
        method: 'POST', headers,
        body: JSON.stringify({ type: 'Email', contactId, subject, html }),
      })
      if (em.ok) { sent++; summaries.push({ to: r.email, admin: r.admin, interviews: ivErr ? 'not loaded' : ivToday.length, assessments: asErr ? 'not loaded' : asToday.length, overnight: myOvernightOps.length + myOvernightLeads.length, passAlongs: myPass.length, leads: myLeads.length, priorities: myOps.length, writeUps: r.admin ? shortNotice.length : undefined, openShiftsToday: r.admin && acToday ? acToday.open.length : undefined }) }
      else {
        summaries.push({ to: r.email, error: 'GHL email ' + em.status })
        const t = await em.text().catch(() => '')
        await briefFailed('error ' + em.status + (t ? ': ' + t.slice(0, 100) : ''))
      }
    } catch (e) { summaries.push({ to: r.email, error: String(e) }); await briefFailed('GoHighLevel could not be reached: ' + String(e).slice(0, 80)) }
  }

  if (!testTo && sent > 0) {
    await sb.rpc('upsert_app_data_item', { target_key: 'morning_brief_state',
      item: { id: 'sent_' + today, at: new Date().toISOString(), sent } })
  }
  /* J1: the scheduled run's reply carries counts, not the staff's email addresses. A staff test brief (only ever to
     their own address) keeps it, so the Hub can say what happened. */
  // deno-lint-ignore no-explicit-any
  const briefs = testTo ? summaries : summaries.map(({ to: _to, ...rest }: any) => rest)
  return json({ status: 'sent', date: today, recipients: sent, axiscare_reached: !!acToday, briefs })
})
