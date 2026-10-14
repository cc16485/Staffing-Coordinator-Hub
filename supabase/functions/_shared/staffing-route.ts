/**
 * STAFFING CALLS TO THE STAFFING COORDINATOR (Samantha, 2026-10-14).
 *
 *   "I want the staffing coordinator to solely handle applicants calls and employees and previous employees calls during
 *    their scheduled working hours ... roll over to the main office line if they don't answer after 2-3 rings."
 *
 * GoHighLevel answers the main line (417-234-8494). Its call workflow (IVR) checks two things the Hub keeps for it:
 *   · the contact's tag STAFFING_TAG: every applicant, new hire, caregiver and former employee. Never a client, family
 *     member or lead (a contact that is both is left to the office).
 *   · the location custom value ON_DUTY_NAME: "yes" while the Staffing Coordinator (ops_settings.staffing_route_email,
 *     staffing@mo-care.com) holds the Staffing seat on the Hub's duty schedule, otherwise "no".
 * Tag and yes: ring the Staffing Coordinator ~15 seconds, then the office. Anything else: the office, as today.
 * The Hub never touches the call itself and never sends anything to anyone.
 */
// deno-lint-ignore-file no-explicit-any
type Any = any
import { seatHolder } from './duty.ts'

export const STAFFING_TAG = 'staffing-caller'
export const ON_DUTY_NAME = 'Staffing Coordinator on duty'
export const ROUTE_EMAIL = 'staffing@mo-care.com'

/** GoHighLevel tags that already mean applicant or (former) employee. Lower case. Hub-editable: ops_settings.staffing_route_tags. */
export const STAFF_TAGS = [
  'applicant', 'applied', 'inactive applicant', 'qualified applicant', 'applicant qualified', 'applicant dnq',
  'scheduled interview', 'upcoming interview', 'interview confirmed', 'interview cancelled', 'interview within 24 hours',
  'invited to 2nd interview', 'scheduled 2nd interview', 'b-001-wf-1.2 - phone interview', 'b-001-wf-4.1 rejected', 'b-001-wf-3.1 no show',
  'inactive employee', 'employee', 'caregiver', 'new hire',
]
/** Tags that mean client, family or lead: such a contact is never routed to staffing (the office takes it). ops_settings.staffing_route_block_tags. */
export const BLOCK_TAGS = ['client', 'inactive client', 'active client', 'family', 'lead', 'ivr - new lead inquiry', 'va lead']

const lc = (v: unknown) => String(v ?? '').trim().toLowerCase()
export function tagsOf(settings: Any): { staff: Set<string>; block: Set<string> } {
  const list = (v: unknown, d: string[]) => (Array.isArray(v) && v.length ? v : d).map(lc).filter(Boolean)
  return { staff: new Set(list(settings?.staffing_route_tags, STAFF_TAGS)), block: new Set(list(settings?.staffing_route_block_tags, BLOCK_TAGS)) }
}

/** What to do with one GoHighLevel contact, from its tags (and whether the Hub knows them as staff by phone). */
export function decide(tags: unknown, hubStaff: boolean, t: { staff: Set<string>; block: Set<string> }):
  'has' | 'add' | 'blocked' | 'not_staff' {
  const mine = (Array.isArray(tags) ? tags : []).map(lc)
  if (mine.includes(STAFFING_TAG)) return 'has'
  const staff = hubStaff || mine.some((x) => t.staff.has(x))
  if (!staff) return 'not_staff'
  if (mine.some((x) => t.block.has(x))) return 'blocked'
  return 'add'
}

/** Is the Staffing Coordinator on duty now? Only a scheduled window counts, never the seat's "nobody scheduled" fallback. */
export function coordinatorOnDuty(windows: Any[], settings: Any, now: Date, positions: Any[] = []): { on: boolean; holder: string; email: string } {
  const email = lc(settings?.staffing_route_email || ROUTE_EMAIL)
  const s = seatHolder(windows, 'staffing', now, settings, '', positions)
  return { on: s.source === 'schedule' && s.person === email, holder: s.source === 'schedule' ? s.person : '', email }
}

/** Ten digits, or ''. */
export const ten = (v: unknown) => { const d = String(v ?? '').replace(/\D/g, ''); return d.length === 11 && d[0] === '1' ? d.slice(1) : d.length === 10 ? d : '' }
