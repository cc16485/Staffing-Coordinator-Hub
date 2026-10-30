/**
 * OVERNIGHT HANDOFF (Samantha 2026-10-29; mockup https://claude.ai/artifact/MsZAJoGKZqufHWzhw7QNU2, "Yes to all four
 * recommendations ... Build it switched off"). Her words: My Work is so busy that a note she makes overnight may be
 * buried, and "I also want to have a clear directive where the morning office admin see clearly if anything happened
 * overnight that they need to know."
 *
 * The top of the 8am Morning Brief (lead-digest), in this order:
 *   · Note from Samantha: what an owner typed in the Hub for this morning (app_data overnight_handoff, note_<date>)
 *   · Needs you this morning: call-ins still open, missed clock-ins not yet confirmed, caregiver notes rated medium or
 *     high, texts and emails that did not go out, and anything a person sent in marked urgent
 *   · Handled overnight: call-ins that were covered, missed clock-ins already confirmed
 *   · Came in overnight: new leads, new applicants, calls to the office line, and what people sent in
 * Overnight is ops_settings.overnight_handoff_hours {from:'20:00', to:'07:00'} (Central), from the last workday's
 * evening, so Monday's covers Friday evening through Monday morning. A quiet night says so, and a list that could not
 * be read says that too (no silent failures).
 * lead-digest saves what it sent as report_<date> in the same key, so My Work shows exactly what the email said.
 * Only while ops_settings.overnight_handoff_live is on. Pure: no database, no clock (node tests import this file).
 */

// deno-lint-ignore-file no-explicit-any
export const KEY = 'overnight_handoff'
export const DEFAULT_HOURS = { from: '20:00', to: '07:00' }
export const liveOn = (settings: any) => !!(settings && settings.overnight_handoff_live === true)

const hm = (s: unknown, d: string) => /^\d{1,2}:\d{2}$/.test(String(s || '')) ? String(s).padStart(5, '0') : d
export function hoursOf(settings: any) {
  const h = (settings && settings.overnight_handoff_hours) || {}
  return { from: hm(h.from, DEFAULT_HOURS.from), to: hm(h.to, DEFAULT_HOURS.to) }
}
/* the last workday before `today` (YYYY-MM-DD, Central): Monday looks back to Friday */
export function lastWorkday(today: string) {
  const t = Date.parse(today + 'T12:00:00Z'), dow = new Date(t).getUTCDay()
  const back = dow === 1 ? 3 : dow === 0 ? 2 : 1
  return new Date(t - back * 864e5).toISOString().slice(0, 10)
}
/* the overnight window as Central wall-clock strings 'YYYY-MM-DD HH:MM:SS', comparable with chi() below */
export function windowFor(today: string, settings: any) {
  const h = hoursOf(settings)
  return { from: lastWorkday(today) + ' ' + h.from + ':00', to: today + ' ' + h.to + ':00', hours: h }
}
/* a moment as Central 'YYYY-MM-DD HH:MM:SS' ('' when it is not a time) */
export const chi = (iso: unknown) => {
  const t = Date.parse(String(iso || '')); if (isNaN(t)) return ''
  return new Date(t).toLocaleString('sv-SE', { timeZone: 'America/Chicago' })
}
const inWin = (iso: unknown, w: { from: string; to: string }) => { const c = chi(iso); return !!c && c >= w.from && c < w.to }
/* which morning a note written at `nowChi` is for: before 8am on a weekday it is this morning's, otherwise the next
   weekday's (a note typed Friday night or Saturday is for Monday) */
export function noteDateFor(nowChi: string, sendHour = 8) {
  const day = nowChi.slice(0, 10), hour = Number(nowChi.slice(11, 13))
  const t = Date.parse(day + 'T12:00:00Z'), dow = new Date(t).getUTCDay()
  if (dow >= 1 && dow <= 5 && hour < sendHour) return day
  let n = t + 864e5
  while ([0, 6].includes(new Date(n).getUTCDay())) n += 864e5
  return new Date(n).toISOString().slice(0, 10)
}

export type Line = { at: string; text: string; key?: string; id?: string }
export type Handoff = {
  date: string; from: string; to: string
  note: { text: string; by_name: string; at: string } | null
  needs: Line[]; handled: Line[]; came_in: Line[]; errors: string[]
}
const fullName = (x: any) => [x?.first_name, x?.last_name].filter(Boolean).join(' ').trim()
const clip = (s: unknown, n = 110) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t }
/* a shift as 'Thu 9:00am' (or just the day, or '') */
export function shiftWords(date: unknown, time: unknown) {
  const d = String(date || ''), m = /^(\d{1,2}):(\d{2})/.exec(String(time || ''))
  const day = /^\d{4}-\d\d-\d\d$/.test(d) ? new Date(Date.parse(d + 'T12:00:00Z')).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }) : ''
  const t = m ? ((Number(m[1]) % 12) || 12) + ':' + m[2] + (Number(m[1]) < 12 ? 'am' : 'pm') : ''
  return [day, t].filter(Boolean).join(' ')
}
const byAt = (a: Line, b: Line) => a.at.localeCompare(b.at)
/* machine-made sweeps stamp created_at overnight too; only what people sent goes under "came in" (same rule as the
   brief's While you were out) */
const humanBorn = (i: any) => !/^automation:/.test(String(i?.created_by || '')) && !/^(attendance|coverage)-watch$/.test(String(i?.opened_by || ''))

/**
 * Build the handoff. `src` is what lead-digest already loaded (ops_items, leads, coverage_cases, notes) plus the
 * applicants it read (null when that read failed, with applicantsErr) and `isCallIn(case)` (not-a-callin rule).
 */
export function build(src: {
  today: string; settings: any; ops: any[]; leads: any[]; covCases: any[]; notes: any[]
  applicants: any[] | null; applicantsErr?: string; isCallIn?: (c: any) => boolean
}): Handoff {
  const w = windowFor(src.today, src.settings)
  const out: Handoff = { date: src.today, from: w.from, to: w.to, note: null, needs: [], handled: [], came_in: [], errors: [] }
  const ops = Array.isArray(src.ops) ? src.ops : [], isCallIn = src.isCallIn || (() => true)

  const n = (src.notes || []).find((x) => x && x.id === 'note_' + src.today && String(x.text || '').trim())
  if (n) out.note = { text: String(n.text).trim(), by_name: String(n.by_name || 'Samantha'), at: String(n.at || '') }

  /* call-ins opened overnight: still open = needs you; covered = handled */
  for (const c of (src.covCases || [])) {
    if (!c || !inWin(c.opened_at, w) || !isCallIn(c)) continue
    const who = String(c.calling_off || c.caregiver_name || 'A caregiver'), client = String(c.client || 'a client')
    const when = shiftWords(c.shift_date, c.shift_time)
    if (c.status === 'open') out.needs.push({ at: chi(c.opened_at), key: 'coverage_cases', id: c.id, text: `Call-in, not covered yet: ${who} called off ${client}${when ? ' (' + when + ')' : ''}.` })
    else if (c.status === 'resolved' && c.resolved_how === 'covered') out.handled.push({ at: chi(c.resolved_at || c.opened_at), key: 'coverage_cases', id: c.id, text: `Call-in covered: ${c.covered_by ? c.covered_by + ' took' : 'someone took'} ${client}${when ? ' (' + when + ')' : ''} for ${who}.` })
    else out.handled.push({ at: chi(c.resolved_at || c.opened_at), key: 'coverage_cases', id: c.id, text: `Call-in closed: ${who}, ${client}${when ? ' (' + when + ')' : ''}${c.resolved_how ? ' · ' + String(c.resolved_how).replace(/_/g, ' ') : ''}.` })
  }
  for (const i of ops) {
    const id = String(i?.id || ''), kind = String(i?.kind || '')
    /* a send problem is one card per address that a new failure bumps, so it counts by when it last failed */
    if (!i || !inWin(kind === 'send_problem' ? (i.last_at || i.created_at) : i.created_at, w)) continue
    const about = clip(i.about || i.title || '', 90)
    if (kind === 'confirm_times') {
      const what = i.missing === 'out' ? 'no clock-out' : i.missing === 'in' ? 'no clock-in' : 'no clock-in or clock-out'
      const line = `${i.caregiver || 'A caregiver'} at ${i.client_first || 'a client'}'s visit: ${what}`
      if (i.status === 'open') out.needs.push({ at: chi(i.created_at), key: 'ops_items', id, text: `Missed clock-in to confirm: ${line}.` })
      else out.handled.push({ at: chi(i.closed_at || i.created_at), key: 'ops_items', id, text: `Missed clock-in cleared: ${line}.` })
    } else if (id.startsWith('ops_note_') && i.status === 'open') {
      out.needs.push({ at: chi(i.created_at), key: 'ops_items', id, text: `Caregiver note rated ${i.urgency === 'high' ? 'high' : 'medium or high'}: ${about}. Decide whether the family should hear from us.` })
    } else if (kind === 'send_problem' && i.status === 'open') {
      out.needs.push({ at: chi(i.last_at || i.created_at), key: 'ops_items', id, text: `A text or email did not go out: ${about}.` })
    } else if (kind === 'call_followup') {
      out.came_in.push({ at: chi(i.created_at), key: 'ops_items', id, text: `Call to the office line: ${about}.` })
    } else if (i.status === 'open' && humanBorn(i) && !id.startsWith('ops_lead_')) {
      const line = { at: chi(i.created_at), key: 'ops_items', id, text: `${about}${i.created_by ? ' (from ' + String(i.created_by).split('@')[0] + ')' : ''}.` }
      if (i.urgency === 'high') out.needs.push({ ...line, text: 'Marked urgent: ' + line.text }); else out.came_in.push(line)
    }
  }
  for (const l of (src.leads || [])) {
    if (!l || !inWin(l.created_at, w) || ['Converted', 'Lost', 'Saved'].includes(l.status)) continue
    out.came_in.push({ at: chi(l.created_at), key: 'leads', id: l.id, text: `New lead: ${fullName(l) || 'name not given'}${l.interest_notes ? ', ' + clip(l.interest_notes, 80) : ''}.` })
  }
  if (src.applicants === null) out.errors.push('new applicants (' + (src.applicantsErr || 'the list did not answer') + ')')
  else for (const a of src.applicants) {
    if (!a || !inWin(a.created_at, w)) continue
    out.came_in.push({ at: chi(a.created_at), id: String(a.id || ''), text: `New applicant: ${fullName(a) || 'name not given'}${a.position ? ', ' + clip(a.position, 40) : ''}.` })
  }
  out.needs.sort(byAt); out.handled.sort(byAt); out.came_in.sort(byAt)
  return out
}
/* the applicants who applied overnight (lead-digest reads them; it says so in the email when this throws) */
export async function applicantsIn(sb: any, w: { from: string; to: string }) {
  const lo = new Date(Date.parse(w.from.replace(' ', 'T') + 'Z') - 864e5).toISOString()   /* a day early: Central is behind UTC */
  const { data, error } = await sb.from('job_applicants').select('id,first_name,last_name,position,created_at').gte('created_at', lo).order('created_at').limit(200)
  if (error) throw new Error(error.message || 'the applicant list did not answer')
  return (data || []) as any[]
}

export const quiet = (h: Handoff) => !h.note && !h.needs.length && !h.handled.length && !h.came_in.length
/* '9:15pm Thu' style time for a line */
export function when(chiStr: string, today: string) {
  if (!chiStr) return ''
  const h = Number(chiStr.slice(11, 13)), t = ((h % 12) || 12) + ':' + chiStr.slice(14, 16) + (h < 12 ? 'am' : 'pm')
  if (chiStr.slice(0, 10) === today) return t
  const d = new Date(Date.parse(chiStr.slice(0, 10) + 'T12:00:00Z')).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
  return t + ' ' + d
}
