// =============================================================================
// family-signin — who may sign in to the family app (family.mo-care.com). Samantha 2026-10-16: "the sign in should be that
// if you have an active client email/client contact with this email - not just saying that we emailed a code", and on the
// plan ("yes, build it"): booking only for the client and their AxisCare responsible parties.
//
// An email gets in, with no office invite, when it belongs to an ACTIVE client (AxisCare status active, or a test client in
// ops_settings family_app_test_clients):
//   * a Family Circle contact on that client: AxisCare's responsible parties (the nightly circles-sync brings them in,
//     source 'axiscare') and anyone the office typed in; or
//   * the client's own email in AxisCare (a Family Circle row 'Client' is made for them).
// Someone the office turned off (app_status 'revoked') is never turned back on here. A stopped or AxisCare-removed
// contact doesn't count. Booking: the client and responsible parties yes, other Family Circle people no (the office can
// change it); anyone already on keeps what the office set.
// Not on file: no login is made, no code is sent, and the app says so plainly. Asking is limited per email and per address.
// Never texts or emails anyone itself (the app asks cc-family-app for the code only after an ok here).
// Pure logic + injected dependencies so it runs under Node tests.
// =============================================================================
import { careActive } from './family-app.ts'

export type Contact = { id: number; name: string | null; circle_id: string; source: string | null; app_status: string | null; app_user_id: string | null
  app_can_book: boolean | null; stopped_at: string | null; axiscare_removed_at: string | null }
export type Circle = { id: string; client_name: string | null; active: boolean | null; axiscare_client_id: string | null }
export type SigninDeps = {
  now: () => Date
  // deno-lint-ignore no-explicit-any
  settings: () => Promise<any>
  // deno-lint-ignore no-explicit-any
  ax: (method: string, path: string) => Promise<{ status: number; json: any }>
  /** Every AxisCare client (all pages), or null when AxisCare can't be read. */
  // deno-lint-ignore no-explicit-any
  axClients: () => Promise<any[] | null>
  contactsByEmail: (email: string) => Promise<Contact[]>
  circles: (ids: string[]) => Promise<Circle[]>
  circleForClient: (ax: string, clientName: string) => Promise<Circle | null>   // find the active circle for the client, or make one
  contactInCircle: (circleId: string, email: string, name: string) => Promise<Contact | null>   // find by email, or make 'Client'
  updateContact: (id: number, vals: Record<string, unknown>) => Promise<boolean>
  login: { find: (email: string) => Promise<string | null>; create: (email: string, name: string) => Promise<string | null>; unblock: (id: string) => Promise<void> }
  attempts: (email: string, ip: string, sinceEmail: string, sinceIp: string) => Promise<{ email: number; ip: number }>
  recordAttempt: (email: string, ip: string, outcome: string) => Promise<void>
  // deno-lint-ignore no-explicit-any
  event: (row: any) => Promise<void>
}
type Out = { status: number; body: Record<string, unknown> }
const say = (status: number, body: Record<string, unknown>): Out => ({ status, body })
export const OFFICE = '(417) 234-8494'
export const MAX_PER_EMAIL = 5, EMAIL_WINDOW_MIN = 15, MAX_PER_IP = 30, IP_WINDOW_MIN = 60
export const cleanEmail = (v: unknown) => String(v ?? '').trim().toLowerCase()
export const emailOk = (e: string) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e) && e.length <= 200
// deno-lint-ignore no-explicit-any
export const clientEmails = (c: any): string[] => [c?.email, c?.personalEmail, c?.emailAddress, c?.primaryEmail].map(cleanEmail).filter(Boolean)
// deno-lint-ignore no-explicit-any
const clientName = (c: any) => [c?.goesBy || c?.firstName, c?.lastName].map((x: unknown) => String(x ?? '').trim()).filter(Boolean).join(' ')
export const notOnFile = (email: string) => `We don't have ${email} on file for a current client. Please call us at ${OFFICE} and we'll add it.`

/** POST {action:'start', email} from the sign-in screen, before anyone is signed in. */
export async function signinStart(d: SigninDeps, rawEmail: unknown, ip: string): Promise<Out> {
  const email = cleanEmail(rawEmail)
  if (!emailOk(email)) return say(400, { ok: false, error: 'Please type your whole email address.' })
  const now = d.now()
  const ago = (min: number) => new Date(now.getTime() - min * 60000).toISOString()
  const n = await d.attempts(email, ip, ago(EMAIL_WINDOW_MIN), ago(IP_WINDOW_MIN))
  if (n.email >= MAX_PER_EMAIL || n.ip >= MAX_PER_IP) return say(429, { ok: false, error: 'Please wait a few minutes, then try again.' })

  const st = await d.settings()
  // 1. Family Circle contacts with this email, on circles that point at an AxisCare client
  const mine = (await d.contactsByEmail(email)).filter((c) => !c.stopped_at && !c.axiscare_removed_at)
  const revokedOnly = mine.length > 0 && mine.every((c) => c.app_status === 'revoked')
  const live = mine.filter((c) => c.app_status !== 'revoked')
  const circles = live.length ? await d.circles([...new Set(live.map((c) => String(c.circle_id)))]) : []
  const hits: { c: Contact; ax: string; self: boolean }[] = []
  const activeOf = new Map<string, boolean>()
  for (const c of live) {
    const k = circles.find((x) => String(x.id) === String(c.circle_id) && x.active !== false && x.axiscare_client_id)
    if (!k) continue
    const ax = String(k.axiscare_client_id)
    if (!activeOf.has(ax)) {
      const r = await d.ax('GET', `/api/clients/${encodeURIComponent(ax)}`)
      if (r.status !== 200) { await d.recordAttempt(email, ip, 'axiscare_down'); return say(502, { ok: false, error: "We couldn't check that just now. Please try again in a minute." }) }
      activeOf.set(ax, careActive(r.json?.results?.client ?? r.json?.results, ax, st))
    }
    if (activeOf.get(ax)) hits.push({ c, ax, self: false })
  }
  // 2. The client's own email in AxisCare (active clients only)
  if (!revokedOnly) {
    const all = await d.axClients()
    if (all == null && !hits.length) { await d.recordAttempt(email, ip, 'axiscare_down'); return say(502, { ok: false, error: "We couldn't check that just now. Please try again in a minute." }) }
    for (const cl of all ?? []) {
      const ax = String(cl?.id ?? '')
      if (!ax || !careActive(cl, ax, st) || !clientEmails(cl).includes(email) || hits.some((h) => h.ax === ax)) continue
      const k = await d.circleForClient(ax, clientName(cl))
      const c = k ? await d.contactInCircle(String(k.id), email, clientName(cl)) : null
      if (c && c.app_status !== 'revoked' && !c.stopped_at) hits.push({ c, ax, self: true })
    }
  }
  if (!hits.length) {
    await d.recordAttempt(email, ip, revokedOnly ? 'revoked' : 'not_on_file')
    return say(200, { ok: false, reason: 'not_on_file', error: notOnFile(email) })
  }

  // 3. One login for the email, turned on for each client they belong to
  let uid = hits.map((h) => h.c.app_user_id).find(Boolean) ?? await d.login.find(email)
  if (!uid) uid = await d.login.create(email, String(hits[0].c.name ?? ''))
  if (!uid) { await d.recordAttempt(email, ip, 'login_failed'); return say(502, { ok: false, error: 'Something went wrong on our side. Please try again or call the office.' }) }
  await d.login.unblock(uid)
  const at = now.toISOString(); let turnedOn = 0
  for (const h of hits) {
    if (h.c.app_status === 'active' && h.c.app_user_id === uid) continue
    const wasOn = h.c.app_status === 'active'
    const can = wasOn ? h.c.app_can_book === true : (h.self || h.c.source === 'axiscare')
    if (!(await d.updateContact(h.c.id, { app_user_id: uid, app_status: 'active', app_can_book: can, app_invited_at: at, app_invited_by: 'self: email on file' }))) {
      await d.recordAttempt(email, ip, 'save_failed'); return say(500, { ok: false, error: 'Something went wrong on our side. Please try again or call the office.' })
    }
    turnedOn++
  }
  if (turnedOn) await d.event({ actor_kind: 'person', actor_email: email, actor_name: String(hits[0].c.name ?? ''), via: 'link', verb: 'family_app_self_signin', area: 'family_app',
    summary: `${hits[0].c.name ?? 'A family member'} turned on the family app with their email on file (${hits.length} client${hits.length === 1 ? '' : 's'})`,
    data: { contact_ids: hits.map((h) => h.c.id), clients: hits.map((h) => h.ax) } })
  await d.recordAttempt(email, ip, 'ok')
  return say(200, { ok: true })
}
