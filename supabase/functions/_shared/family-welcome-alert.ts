// =============================================================================
// family-welcome-alert: the reminder when a family's welcome hasn't been sent (Samantha 2026-10-17: "should we just make it
// manual and make note of the date and time it was sent - then have an alert if it wasn't sent"; "Build it.").
// The welcome itself is always sent by a person (family-app-office.ts, action welcome). This only reminds.
//
// A family member is READY for a welcome when: their email came from AxisCare as a responsible party on the client (so both
// the AxisCare Family Portal and the Booking App work for them), they have HIPAA permission on file (or they are the client),
// they haven't opted out or been removed, the client's Family Circle is active and the client is active, and the client isn't
// on the "no welcome" list (ops_settings.family_welcome_skip_clients: AxisCare ids).
// The first time someone is seen ready, welcome_ready_at is stamped. After ONE BUSINESS DAY of office hours (10 hours, Monday to
// Friday 8 AM to 6 PM) with no welcome sent and no "No welcome" marked, the office gets ONE card per client
// (fam_welcome_<circle>), only during office hours. The card closes itself when nobody is left waiting.
// Never texts or emails anyone. Off with ops_settings.family_welcome_alert_live === false.
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
}
export const READY_HOURS = 10   // one business day of office hours

export function isReady(c: Any, skip: string[]): boolean {
  const email = String(c.email ?? '').trim()
  const isClient = String(c.relationship ?? '').toLowerCase() === 'client'
  return !!email && !c.stopped_at && !c.axiscare_removed_at && c.circle_active !== false && !!c.axiscare_client_id && c.client_active === true &&
    (c.source === 'axiscare' || isClient) && (c.hipaa_authorized === true || isClient) && !skip.includes(String(c.axiscare_client_id))
}

export async function welcomeAlerts(d: WelcomeAlertDeps, opts: { dry?: boolean } = {}) {
  const st = await d.settings(), now = d.now(), nowIso = now.toISOString()
  const out = { ready: 0, waiting: 0, cards: 0, closed: 0, would: [] as Any[] }
  if (st?.family_welcome_alert_live === false) return { ...out, held: 'family_welcome_alert_live is off' }
  const skip: string[] = Array.isArray(st?.family_welcome_skip_clients) ? st.family_welcome_skip_clients.map(String) : []
  const due = new Map<string, Any[]>()   // circle -> people waiting past a business day
  for (const c of await d.candidates()) {
    if (!isReady(c, skip)) continue
    out.ready++
    if (c.welcome_sent_at || c.welcome_skip_at) continue
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
    const detail = `${people.map((p) => p.name).join(', ')} can use the AxisCare Family Portal and the Booking App for ${client}, but no welcome has been sent yet. ` +
      `Open ${first}'s profile, Care circle card: press Invite and send welcome and pick the version (Regular, Flexible or Combination). If someone shouldn't get one, mark "No welcome" with the reason.`
    const id = `fam_welcome_${circle}`
    if (!open.includes(id)) out.cards++
    await d.officeItem({ id, kind: 'family_welcome', domain: 'client_onboarding', status: 'open', urgency: 'today', title: `Send the welcome: ${who} (${client})`, about: client, who: people.map((p) => p.name).join(', '),
      detail, next_action: 'Send the welcome from the Care circle card.', created_at: nowIso, first_at: nowIso, last_at: nowIso, last_activity_at: nowIso, created_by: 'family app', opened_by: 'family app',
      source: { kind: 'family_welcome', circle_id: circle, contact_ids: people.map((p) => p.id) }, history: [{ at: nowIso, by: 'family app', text: detail }] })
  }
  for (const id of open) {
    const circle = id.replace('fam_welcome_', '')
    if (due.has(circle)) continue
    if (!opts.dry) await d.closeItem(id, 'family app', 'Nobody is waiting for a welcome any more (sent, marked "No welcome", or no longer ready).')
    out.closed++
  }
  return out
}
