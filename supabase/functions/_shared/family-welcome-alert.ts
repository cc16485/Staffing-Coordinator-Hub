// =============================================================================
// family-welcome-alert: the AxisCare Family Portal welcome for every family member, and the reminder when it hasn't gone.
// Samantha 2026-10-17: "should we just make it manual and make note of the date and time it was sent - then have an alert if it
// wasn't sent". 2026-10-25 HER CHANGE: "please seperate the emails, the one to access axiscare should go automatically to
// everyone in the family circle....the booking app should only be sent manually". So this run now SENDS the AxisCare welcome
// email on its own (when ops_settings.family_axis_welcome_auto === true: her explicit switch for this one capability with family
// members). The Booking App email is never sent here; a person sends it (family-app-office.ts, action welcome).
//
// A family member is READY for the AxisCare welcome when: their email came from AxisCare as a responsible party on the client (so
// the portal's Activate account works for them), they have HIPAA permission on file (or they are the client), they haven't opted
// out or been removed, the client's Family Circle is active and the client is active, and the client isn't on the "no welcome"
// list (ops_settings.family_welcome_skip_clients: AxisCare ids).
// Ready and not sent: during office hours (Monday to Friday, 8 AM to 6 PM) the email goes, once per email per client (a couple
// sharing an inbox gets one). It goes through the family-safe door (opt-outs and the hours policy apply; a refusal raises a
// Needs Attention card). If it can't go, the reason is kept on the person and the office gets the card at once (no retry loop).
// Switch off: the old reminder (one card per client after ONE BUSINESS DAY of office hours, fam_welcome_<circle>).
// The card closes itself when nobody is left waiting. Off entirely with ops_settings.family_welcome_alert_live === false.
// =============================================================================
import { inOffice, officeHours } from './family-review.ts'

// deno-lint-ignore no-explicit-any
type Any = any
export type WelcomeAlertDeps = {
  now: () => Date
  settings: () => Promise<Any>
  /** family members with an email on active Family Circles of active clients, with their circle (client_name, axiscare_client_id) */
  candidates: () => Promise<Any[]>
  stampReady: (contactId: number, at: string) => Promise<void>
  openCards: () => Promise<string[]>   // ids of open fam_welcome_* cards
  officeItem: (item: Any) => Promise<boolean>
  closeItem: (id: string, by: string, text: string) => Promise<void>
  /** Send this person the AxisCare welcome email now. Optional (older callers only remind). */
  sendAxis?: (c: Any) => Promise<{ ok: boolean; why?: string }>
  /** Record on the person how it went (axis_welcome_sent_at / axis_welcome_failed_at). */
  markAxis?: (contactId: Any, vals: Any) => Promise<void>
}
export const READY_HOURS = 10   // one business day of office hours

export function isReady(c: Any, skip: string[]): boolean {
  const email = String(c.email ?? '').trim()
  const isClient = String(c.relationship ?? '').toLowerCase() === 'client'
  return !!email && !c.stopped_at && !c.axiscare_removed_at && c.circle_active !== false && !!c.axiscare_client_id && c.client_active === true &&
    (c.source === 'axiscare' || isClient) && (c.hipaa_authorized === true || (c.hipaa_authorized !== false && !!c.hipaa_office_ok_at) || isClient)   /* 2026-10-23: or the office's HIPAA OK in the Hub, unless AxisCare says No */ && !skip.includes(String(c.axiscare_client_id))
}

const mailKey = (c: Any) => `${c.circle_id}|${String(c.email ?? '').trim().toLowerCase()}`

export async function welcomeAlerts(d: WelcomeAlertDeps, opts: { dry?: boolean } = {}) {
  const st = await d.settings(), now = d.now(), nowIso = now.toISOString()
  const out = { ready: 0, waiting: 0, sent: 0, failed: 0, cards: 0, closed: 0, would: [] as Any[], would_send: [] as Any[] }
  if (st?.family_welcome_alert_live === false) return { ...out, held: 'family_welcome_alert_live is off' }
  const auto = st?.family_axis_welcome_auto === true && !!d.sendAxis && !!d.markAxis
  const skip: string[] = Array.isArray(st?.family_welcome_skip_clients) ? st.family_welcome_skip_clients.map(String) : []
  const all = await d.candidates()
  const mailed = new Set(all.filter((c) => c.axis_welcome_sent_at).map(mailKey))   // one email per inbox per client
  const due = new Map<string, Any[]>()   // circle -> people the office must look at
  for (const c of all) {
    if (!isReady(c, skip)) continue
    out.ready++
    if (c.axis_welcome_sent_at || c.welcome_skip_at) continue
    if (mailed.has(mailKey(c))) continue
    if (auto && !c.axis_welcome_failed_at) {
      if (!inOffice(now)) continue   // it goes in the morning
      if (opts.dry) { out.would_send.push({ name: c.name, client: c.client_name }); mailed.add(mailKey(c)); continue }
      let r: { ok: boolean; why?: string }
      try { r = await d.sendAxis!(c) } catch (e) { r = { ok: false, why: String((e as Error)?.message ?? e).slice(0, 160) } }
      if (r.ok) { await d.markAxis!(c.id, { axis_welcome_sent_at: nowIso, axis_welcome_sent_by: 'automatic', axis_welcome_how: 'email (automatic)' }); mailed.add(mailKey(c)); out.sent++; continue }
      await d.markAxis!(c.id, { axis_welcome_failed_at: nowIso, axis_welcome_failed_why: String(r.why ?? 'it did not go through').slice(0, 200) })
      out.failed++
      const k = String(c.circle_id); due.set(k, [...(due.get(k) ?? []), { ...c, axis_welcome_failed_why: r.why ?? 'it did not go through' }])
      continue
    }
    if (c.axis_welcome_failed_at) { out.waiting++; const k = String(c.circle_id); due.set(k, [...(due.get(k) ?? []), c]); continue }   // a failed automatic send: the card at once
    if (!c.welcome_ready_at) { if (!opts.dry) await d.stampReady(c.id, nowIso); continue }
    out.waiting++
    if (officeHours(new Date(c.welcome_ready_at), now) < READY_HOURS) continue
    const k = String(c.circle_id); due.set(k, [...(due.get(k) ?? []), c])
  }
  const open = await d.openCards()
  if (inOffice(now)) for (const [circle, people] of due) {
    if (opts.dry) { out.would.push({ circle, people: people.map((p) => p.name) }); continue }
    const client = String(people[0].client_name ?? 'the client'), first = client.split(' ')[0]
    const who = people.length === 1 ? String(people[0].name) : `${people.length} people`
    const whys = people.filter((p) => p.axis_welcome_failed_why).map((p) => `${p.name}: ${p.axis_welcome_failed_why}.`)
    const detail = `${people.map((p) => p.name).join(', ')} can use the AxisCare Family Portal for ${client}, but the AxisCare welcome email hasn't gone. ` +
      (whys.length ? `The automatic send couldn't go: ${whys.join(' ')} ` : '') +
      `Open ${first}'s profile, Family & Contacts: press Send AxisCare welcome under the person. If someone shouldn't get one, mark "No welcome" with the reason.`
    const id = `fam_welcome_${circle}`
    if (!open.includes(id)) out.cards++
    await d.officeItem({ id, kind: 'family_welcome', domain: 'client_onboarding', status: 'open', urgency: 'today', title: `Send the AxisCare welcome: ${who} (${client})`, about: client, who: people.map((p) => p.name).join(', '),
      detail, next_action: 'Send the AxisCare welcome from the Family & Contacts tab.', created_at: nowIso, first_at: nowIso, last_at: nowIso, last_activity_at: nowIso, created_by: 'family app', opened_by: 'family app',
      source: { kind: 'family_welcome', circle_id: circle, contact_ids: people.map((p) => p.id) }, history: [{ at: nowIso, by: 'family app', text: detail }] })
  }
  for (const id of open) {
    const circle = id.replace('fam_welcome_', '')
    if (due.has(circle)) continue
    if (!opts.dry) await d.closeItem(id, 'family app', 'Nobody is waiting for the AxisCare welcome any more (sent, marked "No welcome", or no longer ready).')
    out.closed++
  }
  return out
}
