// =============================================================================
// family-app-office — what the office does for the family booking app (Step 1a). Called from the Hub by signed-in
// office staff only (family-app-office/index.ts checks requireStaff). Rules shared with the family door live in
// family-app.ts.
//   list                         app members + recent and upcoming app bookings
//   invite   {contact_id, can_book}   give a Family Circle person an app login (cc-family-app), turn them on
//   revoke   {contact_id}             turn a login off at once (Hub record) and block it at sign-in (ban)
//   can_book {contact_id, on}         booking on/off for one person
//   place    {booking_id, caregiver_axiscare_id}   put a caregiver on the app visit in AxisCare, read back
//   schedule {booking_id}             put a booking that needs the office onto the AxisCare schedule now
// Never texts or emails a family: invite returns the words for a person to send.
// =============================================================================
import { ok2, axErr, putOnSchedule, reasonId, visitOf, type Ax } from './family-app.ts'

export type OfficeDeps = {
  ax: Ax
  now: () => Date
  // deno-lint-ignore no-explicit-any
  settings: () => Promise<any>
  // deno-lint-ignore no-explicit-any
  contact: (id: number) => Promise<any | null>
  // deno-lint-ignore no-explicit-any
  circle: (id: string) => Promise<any | null>
  // deno-lint-ignore no-explicit-any
  updateContact: (id: number, vals: any) => Promise<boolean>
  // deno-lint-ignore no-explicit-any
  members: () => Promise<any[]>
  // deno-lint-ignore no-explicit-any
  recentBookings: (fromDate: string) => Promise<any[]>
  // deno-lint-ignore no-explicit-any
  booking: (id: string) => Promise<any | null>
  // deno-lint-ignore no-explicit-any
  updateBooking: (id: string, vals: any) => Promise<boolean>
  // deno-lint-ignore no-explicit-any
  closeItem: (id: string, by: string, text: string) => Promise<void>
  // deno-lint-ignore no-explicit-any
  event: (row: any) => Promise<void>
  login: {
    create: (email: string, name: string) => Promise<{ id: string } | { error: string; exists?: boolean }>
    find: (email: string) => Promise<string | null>
    block: (userId: string, on: boolean) => Promise<boolean>
  }
}
type Staff = { name: string; email: string }
type Out = { status: number; body: Record<string, unknown> }
const say = (status: number, body: Record<string, unknown>): Out => ({ status, body })
const emailOk = (e: unknown) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e ?? '').trim())

export const inviteWords = (first: string, client: string) =>
  `Hi ${first}, you can now see ${client}'s visits and book extra visits at app.mo-care.com. Sign in with this email address and we'll email you a 6-digit code. Call us anytime with questions.`

// deno-lint-ignore no-explicit-any
export async function officeAction(d: OfficeDeps, staff: Staff, body: any): Promise<Out> {
  const action = String(body?.action ?? '')
  const nowIso = d.now().toISOString()
  const ev = (verb: string, summary: string, data: Record<string, unknown>) => d.event({ actor_kind: 'person', actor_email: staff.email, actor_name: staff.name, via: 'hub', verb, area: 'family_app', summary, data })

  if (action === 'list') {
    const from = new Date(d.now().getTime() - 30 * 86400000).toISOString().slice(0, 10)
    return say(200, { members: await d.members(), bookings: await d.recentBookings(from) })
  }

  if (['invite', 'revoke', 'can_book'].includes(action)) {
    const c = await d.contact(Number(body?.contact_id))
    if (!c) return say(404, { error: 'That person isn\'t in a Family Circle.' })
    if (action === 'can_book') {
      const on = body?.on === true
      if (!(await d.updateContact(c.id, { app_can_book: on }))) return say(500, { error: 'Not saved. Please try again.' })
      await ev('family_app_can_book', `${staff.name} turned booking ${on ? 'on' : 'off'} for ${c.name}`, { contact_id: c.id, on })
      return say(200, { ok: true })
    }
    if (action === 'revoke') {
      if (!(await d.updateContact(c.id, { app_status: 'revoked' }))) return say(500, { error: 'Not saved. Please try again.' })
      const blocked = c.app_user_id ? await d.login.block(c.app_user_id, true) : true
      await ev('family_app_revoked', `${staff.name} turned off the app for ${c.name}`, { contact_id: c.id, blocked })
      return say(200, { ok: true, note: blocked ? 'Turned off.' : 'Turned off in the Hub (they can no longer see anything). Blocking their sign-in did not go through; tell Claude.' })
    }
    // invite
    if (c.stopped_at || c.axiscare_removed_at) return say(409, { error: `${c.name} has been removed from the Family Circle.` })
    if (!emailOk(c.email)) return say(409, { error: `Add an email for ${c.name} first. They sign in with their email.` })
    const k = await d.circle(String(c.circle_id))
    if (!k || k.active === false || !k.axiscare_client_id) return say(409, { error: 'Connect this Family Circle to the client in AxisCare first.' })
    const email = String(c.email).trim().toLowerCase()
    let uid: string | null = c.app_user_id ?? null
    if (uid) await d.login.block(uid, false)
    else {
      const made = await d.login.create(email, String(c.name ?? ''))
      if ('id' in made) uid = made.id
      else if (made.exists) uid = await d.login.find(email)
      if (!uid) return say(502, { error: `The app login wasn't created${'error' in made ? ` (${made.error})` : ''}. Nothing changed.` })
    }
    const can = body?.can_book !== false
    if (!(await d.updateContact(c.id, { app_user_id: uid, app_status: 'active', app_can_book: can, app_invited_at: nowIso, app_invited_by: staff.email }))) return say(500, { error: 'The login exists but the Hub didn\'t save it. Please try again.' })
    const back = await d.contact(c.id)
    if (back?.app_user_id !== uid || back?.app_status !== 'active') return say(500, { error: 'Saved, but it didn\'t read back. Please try again.' })
    await ev('family_app_invited', `${staff.name} gave ${c.name} the family app for ${k.client_name ?? 'their client'}`, { contact_id: c.id, can_book: can })
    return say(200, { ok: true, words: inviteWords(String(c.name ?? '').split(' ')[0] || 'there', String(k.client_name ?? 'your loved one')), email })
  }

  if (action === 'place' || action === 'schedule') {
    const b = await d.booking(String(body?.booking_id ?? ''))
    if (!b) return say(404, { error: 'Booking not found.' })
    const st = await d.settings()
    if (action === 'schedule') {
      if (!['needs_office', 'practice', 'received'].includes(b.status) || b.axiscare_visit_id) return say(409, { error: 'This booking is already on the schedule.' })
      const put = await putOnSchedule(d.ax, b, st)
      if (!put.ok) { await d.updateBooking(b.id, { error: put.why }); return say(502, { error: put.why }) }
      await d.updateBooking(b.id, { status: 'waiting_for_caregiver', axiscare_visit_id: put.vid, error: null })
      await ev('family_booking_scheduled', `${staff.name} put ${b.client_name} ${b.visit_date} on the schedule`, { booking_id: b.id, visit: put.vid })
      return say(200, { ok: true, axiscare_visit_id: put.vid })
    }
    const cg = String(body?.caregiver_axiscare_id ?? '')
    if (!/^\d+$/.test(cg)) return say(400, { error: 'Pick a caregiver.' })
    if (!b.axiscare_visit_id || !['waiting_for_caregiver', 'placed'].includes(b.status)) return say(409, { error: 'Put this booking on the schedule first.' })
    const cr = await d.ax('GET', `/api/caregivers/${cg}`)
    const c = cr.json?.results?.caregiver ?? cr.json?.results
    if (cr.status !== 200 || !c) return say(502, { error: `AxisCare didn't find that caregiver (${cr.status}).` })
    const activeNow = typeof c.status === 'object' ? c.status?.active !== false : !/inactive|terminated/i.test(String(c.status ?? ''))
    if (!activeNow) return say(409, { error: `${c.firstName ?? 'That caregiver'} isn't active in AxisCare.` })
    const patch: Record<string, unknown> = { caregiverId: Number(cg) }
    const rid = await reasonId(d.ax, st?.family_app_place_reason)
    if (rid != null) patch.modificationReason = rid
    const up = await d.ax('PATCH', `/api/visits/${encodeURIComponent(b.axiscare_visit_id)}`, patch)
    if (!ok2(up.status)) return say(502, { error: `AxisCare refused (${up.status} ${axErr(up.json)}). Nothing changed.` })
    const back = await d.ax('GET', `/api/visits/${encodeURIComponent(b.axiscare_visit_id)}`)
    if (String(visitOf(back.json)?.caregiver?.id ?? '') !== cg) return say(502, { error: 'AxisCare said yes but the visit doesn\'t show that caregiver. Please check the schedule.' })
    const name = [c.goesBy || c.firstName, c.lastName ? String(c.lastName)[0] + '.' : ''].filter(Boolean).join(' ')
    await d.updateBooking(b.id, { status: 'placed', caregiver_axiscare_id: cg, caregiver_name: name, placed_at: nowIso, placed_by: staff.email, error: null })
    await d.closeItem(`fam_book_${b.id}`, staff.name, `${name} placed`)
    await ev('family_booking_placed', `${staff.name} placed ${name} with ${b.client_name} ${b.visit_date}`, { booking_id: b.id, caregiver: cg })
    return say(200, { ok: true, caregiver_name: name })
  }
  return say(400, { error: 'unknown action' })
}
