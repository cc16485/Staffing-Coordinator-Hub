// =============================================================================
// family-app-office — what the office does for the family booking app (Step 1a). Called from the Hub by signed-in
// office staff only (family-app-office/index.ts checks requireStaff). Rules shared with the family door live in
// family-app.ts.
//   list                         app members + recent and upcoming app bookings
//   invite   {contact_id, can_book}   give a Family Circle person an app login (cc-family-app), turn them on
//   revoke   {contact_id}             turn a login off at once (Hub record) and block it at sign-in (ban)
//   can_book {contact_id, on}         booking on/off for one person
//   place    {booking_id, caregiver_axiscare_id, start?}   put a caregiver on the app visit in AxisCare, read back
//                                    (a flexible visit: start = the time picked inside the window; the visit is made then)
//   schedule {booking_id}             put a booking that needs the office onto the AxisCare schedule now
//   app_plan {circle_id, on}          the client's App plan tick (the $15 no-visit month fee applies); on by default at the
//                                     first family login invite
//   fee_check {month?}                run the App fee check for a month (default: last month) and list it
//   fee_list {month?}                 the saved check for a month, nothing re-checked
//   fee_billed {month, axiscare_client_id, on}   the office added (or un-added) the fee on the AxisCare invoice
// Never texts or emails a family: invite returns the words for a person to send.
// =============================================================================
import { brand, brandFor, type Brand } from './brands.ts'
import { placeCaregiver, central, type Ax } from './family-app.ts'
import { runFeeCheck, lastMonth, validMonth, type FeeDeps } from './family-fee.ts'

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
  /** AxisCare responsible-party emails for a client (lower-cased), or null if AxisCare couldn't be read. */
  rpEmails: (axiscareClientId: string) => Promise<string[] | null>
  /** One send through the family-safe door (a person pressed Send). True when it went. */
  // deno-lint-ignore no-explicit-any
  send: (c: any, channel: 'sms' | 'email', payload: { message?: string; subject?: string; html?: string }) => Promise<boolean>
  // deno-lint-ignore no-explicit-any
  logMessage: (row: any) => Promise<void>
  /** The month-end App fee check (family-fee.ts) and the App plan tick on a client's Family Circle. */
  fee: FeeDeps
  // deno-lint-ignore no-explicit-any
  plans: () => Promise<any[]>
  // deno-lint-ignore no-explicit-any
  setPlan: (circleId: string, vals: any) => Promise<boolean>
  /** The office's short About for caregivers (care_circles.caregiver_about). Optional (older callers). */
  // deno-lint-ignore no-explicit-any
  setAbout?: (circleId: string, vals: any) => Promise<boolean>
  // deno-lint-ignore no-explicit-any
  markBilled: (month: string, axiscareClientId: string, vals: any) => Promise<boolean>
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
  `Hi ${first}, you can now see ${client}'s visits and book extra visits at family.mo-care.com. Sign in with this email address and we'll email you a 6-digit code. Call us anytime with questions.`

export const APP_URL = 'https://family.mo-care.com'
export const AXIS_ACTIVATE = 'https://16485.axiscare.com/?user-connect.php&action=activate'
/** The welcome text she approved 2026-10-15 (editable in the Hub before sending). */
// Branded by the client's state (her two-brand plan 2026-10-16). Missouri reads exactly as she approved it on 2026-10-15.
const MO_BRAND = brand('MO') as Brand
export function welcomeText(first: string, client: string, phone: string, withAxis: boolean, b: Brand = MO_BRAND) {
  return `Hi ${first}, it's ${b.short}. You're set up to follow ${client}'s care online. To see visits and book extra ones, go to ${b.app_host} and sign in with this email (we'll email you a code).` +
    (withAxis ? ` For ${client}'s calendar, care notes and invoices, go to 16485.axiscare.com, tap Activate account and use this same email.` : '') +
    ` Questions? Call ${phone}.`
}
const h = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
export function welcomeEmail(first: string, client: string, email: string, phone: string, withAxis: boolean, b: Brand = MO_BRAND) {
  const btn = (href: string, label: string) => `<a href="${href}" style="display:inline-block;background:#1F7A8C;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px;margin:6px 0 2px">${label}</a>`
  const step = (n: number, title: string, body: string) => `<div style="margin:18px 0 0"><div style="font-weight:700;color:#0D365F;font-size:17px">${n}. ${title}</div>${body}</div>`
  const html = `<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.6;color:#16283a;max-width:520px">` +
    `<p>Hi ${h(first)},</p><p>You're set up to follow ${h(client)}'s care online.</p>` +
    step(1, 'See visits and book extra ones', `<p style="margin:4px 0">Go to ${h(String(b.app_host))} and type <b>${h(email)}</b>. We'll email you a 6-digit code. No password needed.</p>${btn(String(b.app_url), 'Open the family app')}`) +
    (withAxis ? step(2, `${h(client)}'s calendar, care notes and invoices`, `<p style="margin:4px 0">Go to 16485.axiscare.com and tap <b>Activate account</b>. Use this same email, <b>${h(email)}</b>, and follow the short steps to set a password.</p>${btn(AXIS_ACTIVATE, 'Activate your AxisCare account')}`) : '') +
    `<p style="margin-top:22px">Questions? Call us at ${h(phone)}. A real person answers, weekdays 8 AM to 6 PM.</p>` +
    `<p style="color:#55677a">${h(b.footer)}</p></div>`
  return { subject: `Your ${b.short} family access for ${client}`, html }
}

// deno-lint-ignore no-explicit-any
export async function officeAction(d: OfficeDeps, staff: Staff, body: any): Promise<Out> {
  const action = String(body?.action ?? '')
  const nowIso = d.now().toISOString()
  const ev = (verb: string, summary: string, data: Record<string, unknown>) => d.event({ actor_kind: 'person', actor_email: staff.email, actor_name: staff.name, via: 'hub', verb, area: 'family_app', summary, data })

  if (action === 'list') {
    const from = new Date(d.now().getTime() - 30 * 86400000).toISOString().slice(0, 10)
    return say(200, { members: await d.members(), bookings: await d.recentBookings(from), plans: await d.plans() })
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
    // App plan on by default at the first invite (never over the office's own choice)
    if (k.app_plan == null) await d.setPlan(String(k.id), { app_plan: true, app_plan_since: central(d.now()).date, app_plan_by: staff.email })
    return say(200, { ok: true, words: inviteWords(String(c.name ?? '').split(' ')[0] || 'there', String(k.client_name ?? 'your loved one')), email })
  }

  if (action === 'welcome') {
    const c = await d.contact(Number(body?.contact_id))
    if (!c) return say(404, { error: 'That person isn\'t in a Family Circle.' })
    if (c.app_status !== 'active') return say(409, { error: `Invite ${c.name} to the family app first.` })
    if (c.stopped_at || c.axiscare_removed_at) return say(409, { error: `${c.name} has been removed from the Family Circle.` })
    const k = await d.circle(String(c.circle_id))
    if (!k?.axiscare_client_id) return say(409, { error: 'Connect this Family Circle to the client in AxisCare first.' })
    const st = await d.settings()
    const first = String(c.name ?? '').trim().split(/\s+/)[0] || 'there'
    const client = String(k.client_name ?? '').trim().split(/\s+/)[0] || 'your loved one'
    const cst = await d.ax('GET', `/api/clients/${encodeURIComponent(k.axiscare_client_id)}`)
    const state = String((cst.json?.results?.client ?? cst.json?.results)?.residentialAddress?.state ?? '').toUpperCase()
    // Never a default brand: an address that isn't Missouri or Oklahoma (or AxisCare unreadable) = nothing is sent.
    const bk = cst.status === 200 ? brandFor(state) : null
    const b = brand(bk, st)
    if (!b) {
      // The office pressed the button, so the reason shows right there (no card needed).
      return say(409, { error: cst.status === 200 ? `${client}'s address in AxisCare isn't Missouri or Oklahoma${state ? ` (it says ${state})` : ''}, so we don't know which office this is. Fix the address in AxisCare, then send it.` : "AxisCare couldn't be read just now, so nothing was sent. Please try again in a minute." })
    }
    if (!b.app_url) return say(409, { error: `The family app isn't set up for ${b.name} yet, so nothing was sent.` })
    const phone = st?.[`family_app_office_phone_${b.key}`] ?? b.phone
    const rps = await d.rpEmails(String(k.axiscare_client_id))
    const email = String(c.email ?? '').trim().toLowerCase()
    const onAxis = rps === null ? null : (!!email && rps.includes(email))
    const canText = !!(c.phone && c.sms_consent), canEmail = !!email
    if (body?.send !== true) {
      const withAxis = onAxis !== false
      return say(200, { preview: true, name: c.name, can_text: canText, can_email: canEmail, axis_email_on_file: onAxis, include_axis: withAxis,
        text: welcomeText(first, client, phone, withAxis, b), text_without_axis: welcomeText(first, client, phone, false, b), text_with_axis: welcomeText(first, client, phone, true, b),
        email_subject: welcomeEmail(first, client, email, phone, withAxis, b).subject, brand: b.key })
    }
    const withAxis = body?.include_axis !== false
    const text = String(body?.text ?? '').trim()
    if (!text) return say(400, { error: 'The text is empty.' })
    if (!canText && !canEmail) return say(409, { error: `There's no way to reach ${c.name}: no email, and no phone with Texts OK.` })
    let byText = false, byEmail = false
    if (canText && body?.by_text !== false) byText = await d.send(c, 'sms', { message: text })
    if (canEmail && body?.by_email !== false) { const em = welcomeEmail(first, client, email, phone, withAxis, b); byEmail = await d.send(c, 'email', { subject: em.subject, html: em.html }) }
    await d.logMessage({ circle_id: String(c.circle_id), kind: 'update', body: text, sent_by: staff.name, reached: byText || byEmail ? 1 : 0, skipped: byText || byEmail ? 0 : 1 })
    await ev('family_app_welcome', `${staff.name} sent ${c.name} the family app welcome (${[byText && 'text', byEmail && 'email'].filter(Boolean).join(' + ') || 'nothing went'})`, { contact_id: c.id, by_text: byText, by_email: byEmail, include_axis: withAxis })
    if (!byText && !byEmail) return say(502, { error: 'Neither the text nor the email went through. The office has a Needs Attention card with the reason.' })
    return say(200, { ok: true, by_text: byText, by_email: byEmail })
  }

  // Her rule 2026-10-16: a short "About <client>" the office writes once, shown on the caregiver's offer link. First name only,
  // no address or medical detail (the box says so; an address is refused). Empty = no About row on the link.
  if (action === 'about') {
    const k = await d.circle(String(body?.circle_id ?? ''))
    if (!k) return say(404, { error: 'Family Circle not found.' })
    if (!d.setAbout) return say(503, { error: 'Not available yet.' })
    const text = String(body?.text ?? '').replace(/\s+/g, ' ').trim()
    if (text.length > 400) return say(400, { error: 'Please keep it under 400 characters (a few sentences).' })
    if (/\b\d{2,6}\s+[A-Za-z0-9.\s]{2,30}\b(st|street|ave|avenue|rd|road|dr|drive|ln|lane|ct|court|blvd|way|pl|place|hwy)\b/i.test(text)) return say(400, { error: 'Please leave out the address. Caregivers see it in AxisCare once they have the visit.' })
    if (!(await d.setAbout(String(k.id), { caregiver_about: text || null, caregiver_about_by: staff.email, caregiver_about_at: d.now().toISOString() }))) return say(500, { error: 'Not saved. Please try again.' })
    await ev('family_app_about', `${staff.name} ${text ? 'updated' : 'cleared'} the caregiver About for ${k.client_name ?? 'a client'}`, { circle_id: k.id, chars: text.length })
    return say(200, { ok: true, text })
  }

  if (action === 'app_plan') {
    const k = await d.circle(String(body?.circle_id ?? ''))
    if (!k) return say(404, { error: 'Family Circle not found.' })
    const on = body?.on === true
    const vals = on ? { app_plan: true, app_plan_since: k.app_plan === true ? k.app_plan_since : central(d.now()).date, app_plan_by: staff.email } : { app_plan: false, app_plan_by: staff.email }
    if (!(await d.setPlan(String(k.id), vals))) return say(500, { error: 'Not saved. Please try again.' })
    await ev('family_app_plan', `${staff.name} turned the App plan ${on ? 'on' : 'off'} for ${k.client_name ?? 'a client'}`, { circle_id: k.id, on })
    return say(200, { ok: true })
  }
  if (action === 'fee_check' || action === 'fee_list') {
    const month = body?.month == null ? lastMonth(d.now()) : String(body.month)
    if (!validMonth(month)) return say(400, { error: 'Pick a month.' })
    if (action === 'fee_list') return say(200, { month, rows: await d.fee.checks(month) })
    const out = await runFeeCheck(d.fee, month, staff.email)
    await ev('family_app_fee_check', `${staff.name} ran the App fee check for ${month}`, { month, owe: out.rows.filter((x) => x.result === 'fee').length })
    return say(200, out)
  }
  if (action === 'fee_billed') {
    const month = String(body?.month ?? ''), cid = String(body?.axiscare_client_id ?? '')
    if (!validMonth(month) || !/^\d+$/.test(cid)) return say(400, { error: 'Pick the client and month.' })
    const row = (await d.fee.checks(month)).find((x) => String(x.axiscare_client_id) === cid)
    if (!row || row.result !== 'fee') return say(409, { error: 'That client has no app fee for that month.' })
    const on = body?.on !== false
    if (!(await d.markBilled(month, cid, on ? { billed_at: nowIso, billed_by: staff.email } : { billed_at: null, billed_by: null }))) return say(500, { error: 'Not saved. Please try again.' })
    await ev('family_app_fee_billed', `${staff.name} ${on ? 'added' : 'took off'} the app fee for ${row.client_name} (${month})`, { month, axiscare_client_id: cid, on })
    return say(200, { ok: true })
  }

  if (action === 'place' || action === 'schedule') {
    const b = await d.booking(String(body?.booking_id ?? ''))
    if (!b) return say(404, { error: 'Booking not found.' })
    const st = await d.settings()
    // Release 1 (her approval 2026-10-17): no empty AxisCare visits; a request goes on AxisCare when a caregiver is placed.
    if (action === 'schedule') return say(409, { error: 'Requests go on the AxisCare schedule when a caregiver is placed. Use Place.' })
    const cg = String(body?.caregiver_axiscare_id ?? '')
    if (!/^\d+$/.test(cg)) return say(400, { error: 'Pick a caregiver.' })
    if (b.kind === 'flex' ? !['waiting_for_caregiver', 'needs_office'].includes(b.status) : !['waiting_for_caregiver', 'placed', 'needs_office'].includes(b.status)) return say(409, { error: b.kind === 'flex' ? 'This visit already has its caregiver and time.' : 'This request is no longer open.' })
    const put = await placeCaregiver(d.ax, b, cg, body?.start ? String(body.start) : null, st)
    if (!put.ok) return say(put.status, { error: put.why })
    const name = put.name
    // her rule 2026-10-16: the family hears who's coming (one text 8 AM to 8 PM, or an email); the 10-minute run sends it
    await d.updateBooking(b.id, { ...put.vals, status: 'placed', placed_at: nowIso, placed_by: staff.email, error: null, family_confirm_pending: true })
    await d.closeItem(`fam_book_${b.id}`, staff.name, `${name} placed`)
    await ev('family_booking_placed', `${staff.name} placed ${name} with ${b.client_name} ${b.visit_date}`, { booking_id: b.id, caregiver: cg })
    return say(200, { ok: true, caregiver_name: name })
  }
  return say(400, { error: 'unknown action' })
}
