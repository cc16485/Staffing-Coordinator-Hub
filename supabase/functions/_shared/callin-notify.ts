// =============================================================================
// CI2 (2026-10-03, call-ins) · the admins' texts about a call-in, each with that admin's own link to the call-in page
// (cc.mo-care.com/callin.html, served by callin-alert). Samantha's decisions on the call-ins plan ("yes to all"):
//   2 · "said yes" goes to the admin list (the call-in list), so each person gets their own link;
//   4 · "Filled by ..." goes to the other admins, any hour, but only to admins who got the call-in text.
// Who is on the list: ops_settings.coverage_alert_admins (default Samantha and Krystal), phones from
// coordinator_staff (_shared/clockin-admins.ts). Any hour only when call-ins may text after hours
// (ops_settings.callin_after_hours, her 426 switch, default on); otherwise office quiet hours apply as everywhere.
// Who got a call-in text is kept on the case (admin_links: their emails), so "Filled by" never wakes someone who
// never heard about the call-in.
// =============================================================================
import { adminRecipients, textAdmin, type Admin } from './clockin-admins.ts'
import { makeLink, linkExpiry } from './callin-links.ts'
import { afterHoursAllowed } from './quiet-hours.ts'

const chiDay = () => new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
const clock12 = (t: string): string => {
  const m = String(t || '').trim().match(/^(\d{1,2}):(\d\d)$/)
  if (!m) return String(t || '').trim()
  const h24 = Number(m[1]); const h = h24 % 12 || 12
  return `${h}${m[2] === '00' ? '' : ':' + m[2]}${h24 >= 12 ? 'pm' : 'am'}`
}
/** "Ruth Adams Tue Oct 7 9am-1pm" style: the client and the shift, for an admin's text. */
// deno-lint-ignore no-explicit-any
export function caseWhat(c: any): string {
  const day = c?.shift_date ? new Date(String(c.shift_date) + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : ''
  const time = String(c?.shift_time || '').trim().split('-').filter(Boolean).map(clock12).join('-')
  return [String(c?.client || 'the client'), day, time].filter(Boolean).join(' ')
}
/** This admin's own link to the call-in page. Empty when the server secret isn't set (the text then says "the board"). */
export async function callinLink(caseId: string, email: string, shiftDate?: string): Promise<string> {
  const secret = Deno.env.get('HUB_JOB_SECRET') || ''
  if (!secret || secret.length < 32 || !/^[A-Za-z0-9_-]{1,100}$/.test(caseId)) return ''
  return await makeLink(secret, caseId, email, linkExpiry(/^\d{4}-\d{2}-\d{2}$/.test(String(shiftDate || '')) ? String(shiftDate) : chiDay()))
}
/** Fill a template's {link}; a template without {link} gets it at the end. A missing link reads "cc.mo-care.com". */
export function withLink(template: string, link: string): string {
  const l = link || 'cc.mo-care.com'
  return /\{link\}/.test(template) ? template.replaceAll('{link}', l) : `${template.trim()} ${l}`
}

/** Text the call-in admins about this case, each with their own link. Returns the emails reached. */
export async function textCaseAdmins(
  // deno-lint-ignore no-explicit-any
  sb: any, ghl: { token: string; locationId: string }, settings: any, c: any, message: (link: string, a: Admin) => string,
  opts: { except?: string; onlyAlerted?: boolean; allIfNoneRecorded?: boolean; anyHour?: boolean; emergency?: boolean } = {}, send: typeof fetch = fetch): Promise<string[]> {
  const admins = await adminRecipients(sb, settings)
  const alerted = new Set((Array.isArray(c?.admin_links) ? c.admin_links : []).map((e: unknown) => String(e).toLowerCase()))
  const except = String(opts.except || '').toLowerCase()
  /* emergency: the caller already decided this may go at night (CI3: a MUST BE COVERED reminder) */
  const emergency = opts.emergency === true || (opts.anyHour === true && afterHoursAllowed(settings, 'callin'))
  const reached: string[] = []
  for (const a of admins) {
    if (a.email === except) continue
    if (opts.onlyAlerted && !(opts.allIfNoneRecorded && !alerted.size) && !alerted.has(a.email)) continue
    const link = await callinLink(String(c.id), a.email, c.shift_date)
    if (await textAdmin(sb, ghl, a, message(link, a), send, { emergency })) reached.push(a.email)
  }
  return reached
}
/** Remember who got a call-in text with a link (for "Filled by" later). */
// deno-lint-ignore no-explicit-any
export async function rememberAlerted(sb: any, caseId: string, emails: string[]): Promise<void> {
  if (!emails.length) return
  try {
    const { data } = await sb.from('app_data').select('data').eq('key', 'coverage_cases').maybeSingle()
    // deno-lint-ignore no-explicit-any
    const c = (Array.isArray(data?.data) ? data!.data : []).find((x: any) => x?.id === caseId)
    const had = Array.isArray(c?.admin_links) ? c.admin_links.map((e: unknown) => String(e).toLowerCase()) : []
    const all = [...new Set([...had, ...emails.map((e) => e.toLowerCase())])]
    if (all.length !== had.length) await sb.rpc('coverage_case_patch', { p_id: caseId, p_patch: { admin_links: all }, p_expect: {} })
  } catch { /* the texts went; the record is a convenience */ }
}
/** One line for the other admins after a fill or a close (decision 4: only those who got the call-in text, any hour). */
// deno-lint-ignore no-explicit-any
export function filledLine(c: any, by: string, out: { covered_by?: string | null; how?: string | null }): string {
  const first = String(by || 'Someone').trim().split(/\s+/)[0]
  if (out.covered_by) return `Filled by ${first}: ${out.covered_by} covers ${caseWhat(c)}. No more texts about this call-in.`
  const how: Record<string, string> = { uncovered: 'closed, not covered', covered_other_way: 'covered another way', client_cancelled: 'the client cancelled' }
  return `${first} closed the call-in for ${caseWhat(c)}: ${how[String(out.how || '')] || 'closed'}. No more texts about it.`
}
