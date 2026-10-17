// =============================================================================
// CONFIRM THE TIMES WITH THE CLIENT (Samantha, 2026-10-17: "just have the policy that we call the client to confirm a
// caregivers time or arrival departure if they didnt clock out"). The EVV correction form is retired. A visit missing
// its clock-in or clock-out becomes ONE office card in Needs Attention: "Call <client> to confirm <caregiver>'s times".
// A person makes the call from the Hub (the card's Call button rings them and connects from the office line), records
// who they spoke with and the times the client gave, fixes the visit in AxisCare and ticks "Fixed in AxisCare".
// Nothing here contacts a client or family: the card is office work only.
//
// One card per AxisCare visit, ever: the id comes from the visit, and a card that already exists (open or done) is
// never made again. The SOP is Procedures > "Missed clock-in or clock-out: confirm the times with the client".
// =============================================================================

export type Missing = 'in' | 'out' | 'both'

/** The card's id. Same visit, same card, whichever step finds it first (the live watch or the overnight check). */
export const cftId = (visitId: string) => `ops_cft_${String(visitId).replace(/[^A-Za-z0-9]/g, '_')}`
/** The old "EVV fix needed" card for the same visit: if one exists, the visit already has its card. */
export const evvFixId = (visitId: string) => `ops_evvfix_${String(visitId).replace(/[^A-Za-z0-9]/g, '_')}`

/** Minutes after the scheduled end with still no clock-out before the office card opens (Hub Settings, Missed clock-outs). */
export const CFT_OUT_AFTER_MIN_DEFAULT = 30
export const outAfterMin = (settings: Record<string, unknown>) =>
  Number(settings?.confirm_times_out_after_min) > 0 ? Math.floor(Number(settings.confirm_times_out_after_min)) : CFT_OUT_AFTER_MIN_DEFAULT

export const SOP_TITLE = 'Missed clock-in or clock-out: confirm the times with the client'

const hm12 = (t: string) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); if (!m) return String(t || '')
  const h = Number(m[1]), mm = m[2]
  return `${(h + 11) % 12 + 1}${mm === '00' ? '' : ':' + mm} ${h < 12 ? 'AM' : 'PM'}`
}
const dayWords = (d: string) => {
  const t = Date.parse(String(d || '').slice(0, 10) + 'T12:00:00Z')
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' }) : String(d || '')
}

export interface CftVisit {
  visit_id: string
  caregiver: string                    // full name
  caregiver_axiscare_id?: string | null
  client_first: string
  client_name?: string | null          // first + last when known
  client_axiscare_id?: string | null
  shift_date: string                   // YYYY-MM-DD
  start: string                        // HH:MM scheduled
  end: string                          // HH:MM scheduled
  clock_in?: string | null             // HH:MM when AxisCare has one
  clock_out?: string | null
  missing: Missing
  times_label?: string               // what start/end are: 'scheduled' (default), or e.g. 'asked for on the form'
}

export function cftWhat(m: Missing) {
  return m === 'in' ? 'arrival time' : m === 'out' ? 'departure time' : 'arrival and departure times'
}

/** The Needs Attention card. `source` says which step made it (live watch, overnight check, a waiting form, an old EVV fix card). */
export function confirmTimesItem(v: CftVisit, o: { owner: string; now: string; source: string; extra?: Record<string, unknown> }) {
  const cgFirst = String(v.caregiver || '').split(/\s+/)[0] || 'the caregiver'
  const sched = `${hm12(v.start)} to ${hm12(v.end)}`
  const had = v.missing === 'out' && v.clock_in ? ` AxisCare shows a clock-in at ${hm12(v.clock_in)} and no clock-out.`
    : v.missing === 'in' && v.clock_out ? ` AxisCare shows a clock-out at ${hm12(v.clock_out)} and no clock-in.`
    : v.missing === 'both' ? ' AxisCare shows no clock-in and no clock-out.' : ''
  return {
    id: cftId(v.visit_id), kind: 'confirm_times', status: 'open', domain: 'scheduling_coverage', urgency: 'today',
    title: `Call ${v.client_first} to confirm ${cgFirst}'s ${cftWhat(v.missing)} (${dayWords(v.shift_date)}, ${sched})`,
    about: v.caregiver, caregiver: v.caregiver, caregiver_axiscare_id: v.caregiver_axiscare_id ?? null,
    client_first: v.client_first, client_name: v.client_name || v.client_first, client_axiscare_id: v.client_axiscare_id ?? null,
    visit_id: String(v.visit_id), shift_date: v.shift_date, shift_time: v.start, shift_end: v.end,
    clock_in: v.clock_in ?? null, clock_out: v.clock_out ?? null, missing: v.missing,
    detail: `${v.caregiver}'s visit with ${v.client_first} on ${dayWords(v.shift_date)} (${v.times_label || 'scheduled'} ${sched}) is missing its ${v.missing === 'both' ? 'clock-in and clock-out' : v.missing === 'in' ? 'clock-in' : 'clock-out'}.${had} `
      + `Call ${v.client_first} (or the family member who handles the care) and ask what time ${cgFirst} got there and what time ${cgFirst} left. Let them tell you the times. `
      + `Record the call on this card, correct the visit in AxisCare, then tick "Fixed in AxisCare". `
      + `If ${v.client_first} says ${cgFirst} was not there, do not change the times: record a call-off or no-show on ${cgFirst}'s attendance and tell Samantha. `
      + `SOP: Procedures > ${SOP_TITLE}.`,
    owner: o.owner, owner_name: String(o.owner || '').split('@')[0],
    due: new Date(Date.parse(o.now) + 4 * 3600000).toISOString(),
    created_at: o.now, created_by: o.source, opened_by: 'confirm_times', source: o.source,
    ...(o.extra || {}),
  }
}

/** True when the visit already has its card (this one, or an old "EVV fix needed" card for it). */
// deno-lint-ignore no-explicit-any
export function hasCard(opsById: Map<string, any>, visitId: string) {
  return opsById.has(cftId(visitId)) || opsById.has(evvFixId(visitId))
}
