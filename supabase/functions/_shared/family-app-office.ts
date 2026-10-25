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
//   Release 3 (her "Start Release 3." 2026-10-17, decisions 3 and 6):
//   review   {booking_id, decision: approve | approve_no_note | decline, reason?}   a request held for the office: caregivers
//            are asked (with or without the family's note), or it is declined (the family gets the approved decline wording)
//   fill_close {booking_id, how: another_time | couldnt}   close a Help us fill task (Placed is the place action);
//            couldnt = the family gets the approved "couldn't fill" wording; another_time = ends quietly (agreed with the family)
//   help_fill {circle_id, on, reason}   the client's "Help us fill extra visits" flag, 90 days; Samantha or Krystal only
//            (owner_admin or care_coordinator)
//   app_tasks {circle_id, tasks: string[] | null}   the companion tasks this client may pick in the app (null = all)
//   welcome  {contact_id, kind?, send?, again?, text?}   the Booking App email (her design 2026-10-17, split 2026-10-25): a person
//            picks the version (Regular / Flexible / Combination, remembered on the client), previews it, presses Send. Recorded with
//            the date, time, who and which version; a second send asks first ("again"). Needs HIPAA permission and an active client,
//            and never for a client whose Booking App is off.
//   axis_welcome {contact_id, send?, again?}   the AxisCare Family Portal email by hand (it also goes on its own:
//            family-welcome-alert.ts). Email only; needs HIPAA, an active client and their email on the AxisCare record.
//   booking_app {circle_id, on, reason?}   the client's Booking App on/off (2026-10-25): off = no invites, no Booking App email
//   scheduling_type {circle_id, kind}   the client's Care Scheduling Type; it also sets the App plan default (Flexible on,
//            Regular and Combination off; the office can still change the App plan)
//   welcome_skip {contact_id, on, reason}   "No AxisCare welcome for this person" (the automatic send and the reminder skip them)
//   hipaa_ok {contact_id, on}   her rule 2026-10-23: the office marks HIPAA OK in the Hub (who and when), so the welcome needn't
//            wait for AxisCare's nightly copy. Kept through the nightly sync. AxisCare's explicit No still wins (refused here).
//   late_billed {booking_id, on}   a late cancel's charge was added to the invoice (the weekly billing list, not a card)
// Never texts or emails a family: invite returns the words for a person to send.
// =============================================================================
import { brand, brandFor, type Brand } from './brands.ts'
import { placeCaregiver, central, tasksFor, testClients, stampWords, type Ax } from './family-app.ts'
import { runFeeCheck, lastMonth, validMonth, type FeeDeps } from './family-fee.ts'

// HIPAA permission for the welcome: AxisCare's yes, or the office's HIPAA OK in the Hub, unless AxisCare says an explicit No.
// deno-lint-ignore no-explicit-any
export const hipaaYes = (c: any): boolean => c?.hipaa_authorized === true || (c?.hipaa_authorized !== false && !!c?.hipaa_office_ok_at)

export type PhoneTrust = 'ok' | 'unconfirmed' | 'rejected' | 'none' | 'error'

export type OfficeDeps = {
  ax: Ax
  now: () => Date
  // deno-lint-ignore no-explicit-any
  settings: () => Promise<any>
  // deno-lint-ignore no-explicit-any
  contact: (id: string) => Promise<any | null>   // circle_contacts.id is a uuid
  // deno-lint-ignore no-explicit-any
  circle: (id: string) => Promise<any | null>
  // deno-lint-ignore no-explicit-any
  updateContact: (id: string, vals: any) => Promise<boolean>
  /** Everyone in one Family Circle (the welcome's "already sent to this email" check). Optional for older callers. */
  // deno-lint-ignore no-explicit-any
  circleContacts?: (circleId: string) => Promise<any[]>
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
  /** Can this number be texted (outreach.ts maySendTo): ok, unconfirmed (probable, from an import), rejected, or none. Optional. */
  phoneTrust?: (phone: unknown) => Promise<PhoneTrust>
  /** Confirm a number for texting (by = who, recorded) or take back a Hub confirmation (by = null). Optional. */
  confirmPhone?: (phone: unknown, by: string | null) => Promise<'ok' | 'none' | 'rejected' | 'error'>
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
type Staff = { name: string; email: string; roles?: string[] }
type Out = { status: number; body: Record<string, unknown> }
const say = (status: number, body: Record<string, unknown>): Out => ({ status, body })
const emailOk = (e: unknown) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e ?? '').trim())

export const inviteWords = (first: string, client: string) =>
  `Hi ${first}, you can now use the Caring Companions Booking App for ${client} at family.mo-care.com. Sign in with this email address and we'll email you a 6-digit code. Call us anytime with questions.`

export const APP_URL = 'https://family.mo-care.com'
export const AXIS_ACTIVATE = 'https://16485.axiscare.com/?user-connect.php&action=activate'
/** THE FAMILY WELCOME (Samantha 2026-10-17, "Family Welcome Email, Text Messages & Scheduling Type"; proposal
 *  https://claude.ai/artifact/8EG7jCEt2LJz1pSmxtZcw9; then "make it manual and make note of the date and time it was sent - then
 *  have an alert if it wasn't sent", "then we can choose the correct email too").
 *  2026-10-25 HER CHANGE: "please seperate the emails, the one to access axiscare should go automatically to everyone in the
 *  family circle....the booking app should only be sent manually to those client who we think would be interested or be able
 *  to turn off the booking app and that means it takes it off the email". So there are now TWO emails:
 *    axisWelcomeEmail = the AxisCare Family Portal only, never a word about the Booking App. It goes on its own
 *                       (family-welcome-alert.ts, behind ops_settings.family_axis_welcome_auto) or by hand (axis_welcome).
 *    welcomeEmail     = the Booking App only, sent by a person (welcome), and never for a client whose Booking App is off
 *                       (care_circles.booking_app_off_at). Three versions, chosen by the person sending (and remembered on the
 *                       client as the Care Scheduling Type):
 *      regular  = Regular Scheduled Care: requesting care outside the regular schedule, clearly optional.
 *      flexible = Flexible Booking Care: the app is how they get care. Never "extra" or "additional visits".
 *      both     = Combination of Both: care on other days, as a benefit.
 *  Email-safe HTML (tables, inline styles), the brand palette and logo. The pilot line (Booking App email only) goes once
 *  ops_settings.family_welcome_pilot_line is false. */
export type CareType = 'regular' | 'flexible' | 'both'
const MO_BRAND = brand('MO') as Brand
/** The app's request hours in words, per state (the same days and hours the app's picker uses). */
const appHours = (key: string | null) => key === 'OK' ? 'Monday to Friday, 8 AM to 6 PM' : '7 AM and 6 PM'
export const CARE_TYPES: CareType[] = ['regular', 'flexible', 'both']
export const CARE_TYPE_LABEL: Record<CareType, string> = { regular: 'Regular Scheduled Care', flexible: 'Flexible Booking Care', both: 'Combination of Both' }
export const isCareType = (x: unknown): x is CareType => CARE_TYPES.includes(x as CareType)
const AXIS_URL = 'https://16485.axiscare.com/'
const h = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const OFFICE_HOURS = 'Monday to Friday, 8 AM to 6 PM'
const TAGLINE = 'We care like family.'

/** The Booking App text message: short, the app's link, "your email has the steps". */
export function welcomeText(first: string, client: string, email: string, phone: string, b: Brand = MO_BRAND, kind: CareType = 'regular') {
  const app = String(b.app_url ?? '')
  if (kind === 'flexible') return `Hi ${first}, welcome to ${b.short}! You can request care for ${client} whenever you need it in our Booking App: ${app} Sign in with ${email} and we'll email you a code. Your email has the full steps. Questions? ${phone}`
  return `Hi ${first}, you can now request care for ${client} on other days or times in the ${b.short} Booking App: ${app} Sign in with ${email} and we'll email you a code. Your email has the full steps. Questions? ${phone}`
}

/** The shared look of both emails (one frame, so they always match). */
function emailKit(b: Brand) {
  const C = { navy: b.colors?.dark || '#0D365F', teal: b.colors?.primary || '#1F7A8C', pale: '#EAF4F6', honey: '#C17A12', honeyPale: '#FBF3E6', cream: '#FAF9F6', ink: '#16283A', muted: '#55677A', line: '#E4E1D8' }
  const font = "font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;", serif = "font-family:Georgia,'Times New Roman',serif;"
  const button = (href: string, label: string, solid = true) =>
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 0"><tr><td style="border-radius:10px;background:${solid ? C.teal : '#ffffff'};${solid ? '' : `border:2px solid ${C.teal};`}">` +
    `<a href="${href}" style="display:inline-block;padding:14px 24px;${font}font-size:17px;font-weight:700;line-height:1;color:${solid ? '#ffffff' : C.teal};text-decoration:none;border-radius:10px">${label}</a></td></tr></table>`
  const bullets = (items: string[]) => items.map((t) =>
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:7px 0 0"><tr><td width="20" valign="top" style="${font}font-size:17px;line-height:1.5;color:${C.teal};font-weight:700">&#10003;</td><td valign="top" style="${font}font-size:16px;line-height:1.5;color:${C.ink}">${t}</td></tr></table>`).join('')
  const steps = (items: string[]) => items.map((t, i) =>
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:8px 0 0"><tr><td width="30" valign="top"><div style="width:22px;height:22px;border-radius:11px;background:${C.pale};color:${C.teal};${font}font-size:13px;font-weight:700;line-height:22px;text-align:center">${i + 1}</div></td><td valign="top" style="${font}font-size:16px;line-height:1.5;color:${C.ink}">${t}</td></tr></table>`).join('')
  const kicker = (t: string, color: string) => `<div style="${font}font-size:12px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${color};margin:0 0 6px">${t}</div>`
  const p = (t: string, top = 10) => `<p style="${font}font-size:16px;line-height:1.6;color:${C.ink};margin:${top}px 0 0">${t}</p>`
  const small = (t: string) => `<p style="${font}font-size:14px;line-height:1.55;color:${C.muted};margin:14px 0 0">${t}</p>`
  const section = (label: string, title: string, body: string) =>
    `<tr><td style="padding:30px 36px 0"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid ${C.line};border-radius:14px"><tr><td style="padding:22px 22px 24px">` +
    kicker(label, C.teal) + `<div style="${serif}font-size:22px;font-weight:bold;color:${C.navy};line-height:1.3;margin:0 0 8px">${title}</div>${body}</td></tr></table></td></tr>`
  const page = (first: string, client: string, phone: string, H: { title: string; intro: string; pre: string }, body: string, pilot: boolean) => {
    const tel = '+1' + phone.replace(/\D/g, '').slice(-10), cl = h(client)
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Welcome to ${h(b.short)}</title></head>` +
    `<body style="margin:0;padding:0;background:${C.cream}"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${h(H.pre)}</div>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${C.cream}"><tr><td align="center" style="padding:28px 12px">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:620px;background:#ffffff;border:1px solid ${C.line};border-radius:18px;overflow:hidden">` +
    `<tr><td style="height:6px;background:${C.teal};font-size:0;line-height:0">&nbsp;</td></tr>` +
    `<tr><td style="padding:28px 36px 0"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td>` +
      (b.logo ? `<img src="${h(b.logo)}" alt="${h(b.short)}" height="50" style="display:block;height:50px;width:auto;border:0">` : `<div style="${serif}font-size:22px;font-weight:bold;color:${C.navy}">${h(b.short)}</div>`) +
      `</td><td align="right" style="${serif}font-size:15px;font-style:italic;color:${C.honey}">${TAGLINE}</td></tr></table></td></tr>` +
    `<tr><td style="padding:26px 36px 0">` + kicker(`Welcome to ${h(b.short)}`, C.honey) +
      `<h1 style="${serif}font-size:30px;line-height:1.22;font-weight:bold;color:${C.navy};margin:4px 0 0">${H.title}</h1>` + p(`Hi ${h(first)},`, 18) + p(H.intro) + `</td></tr>` +
    body +
    (pilot ? `<tr><td style="padding:28px 36px 0"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${C.honeyPale};border-left:4px solid ${C.honey};border-radius:8px"><tr><td style="padding:14px 18px;${font}font-size:15px;line-height:1.55;color:${C.ink}">` +
      `You're one of the first families to use the Booking App. If anything is confusing, tell us; it helps us get it right.</td></tr></table></td></tr>` : '') +
    `<tr><td style="padding:30px 36px 34px"><div style="border-top:1px solid ${C.line};padding-top:22px">` +
      p(`We're here to help. Call us at <a href="tel:${tel}" style="color:${C.teal};font-weight:700;text-decoration:none">${h(phone)}</a>, ${OFFICE_HOURS}. A real person answers.`, 0) +
      p(`Warmly,<br><b>Your team at ${h(b.short)}</b>`, 14) + `</div></td></tr></table>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:620px"><tr><td align="center" style="padding:18px 12px 0;${font}font-size:13px;line-height:1.6;color:${C.muted}">` +
      `${h(b.footer)} &middot; ${h(phone)}${b.website ? ` &middot; <a href="https://${h(b.website)}" style="color:${C.muted}">${h(b.website)}</a>` : ''}<br>You're receiving this because you're part of ${cl}'s care circle.</td></tr></table>` +
    `</td></tr></table></body></html>`
  }
  return { C, font, button, bullets, steps, p, small, section, page }
}

/** The AxisCare Family Portal welcome: AxisCare only (her rule 2026-10-25: no Booking App in it, for every client). Written for
 *  every client, regular schedule or not (app-only clients are real), so it never assumes set days. */
export function axisWelcomeEmail(first: string, client: string, email: string, phone: string, b: Brand = MO_BRAND) {
  const K = emailKit(b), cl = h(client), em = h(email)
  const body = K.section('AxisCare Family Portal', `${cl}'s visits, care notes and invoices`,
    K.p(`Follow ${cl}'s care from anywhere.`, 0) + K.bullets(['View upcoming caregiver visits', 'Read care notes from completed visits', 'View invoices and billing']) +
    `<div style="${K.font}font-size:15px;font-weight:700;color:${K.C.navy};margin:18px 0 0">Set it up once</div>` +
    K.steps(['Tap <b>Activate your account</b> below.', `Enter your email address, <b>${em}</b>.`, 'Follow the steps to create your password.']) +
    K.button(AXIS_ACTIVATE, 'Activate your account') +
    K.small(`After that, sign in anytime at <a href="${AXIS_URL}" style="color:${K.C.teal};font-weight:700;text-decoration:none">16485.axiscare.com</a>.`))
  const H = { title: `Stay connected to ${cl}'s care`, intro: `Your AxisCare Family Portal lets you follow ${cl}'s visits, read care notes and view invoices from home.`, pre: `Follow ${client}'s visits, care notes and invoices online.` }
  return { subject: `Welcome to ${b.short}: follow ${client}'s care online`, html: K.page(first, client, phone, H, body, false) }
}

/** The Booking App email: the app only (her rule 2026-10-25: sent by hand, to the families who'd use it). */
export function welcomeEmail(first: string, client: string, email: string, phone: string, b: Brand = MO_BRAND, pilot = true, kind: CareType = 'regular') {
  const K = emailKit(b), C = K.C, font = K.font, cl = h(client), em = h(email)
  // "How booking works": checked against the app 2026-10-17 (2 hours, 7 to 6, familiar caregivers first, confirmed only on a
  // yes, no charge if nobody, free cancel before confirmation, 24 hours after, then 2 hours). No texts go out while it's checked,
  // so it says the app shows where the request stands.
  // Her rule 2026-10-25: the app gives families direct access to our caregivers, so the email says plainly that it's Wellness
  // Care only, it skips the higher short-visit rate and the 8-hour weekly minimum (Missouri's regular-care rules, so those two
  // lines are Missouri only), the office isn't part of app bookings, and a request isn't guaranteed if no caregiver responds.
  const mo = b.key !== 'OK'
  const howBooking = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:20px 0 0;background:${C.pale};border-radius:12px"><tr><td style="padding:16px 18px 18px">` +
    `<div style="${font}font-size:15px;font-weight:700;color:${C.navy};margin:0 0 2px">How booking works</div>` +
    K.bullets([
      '<b>Wellness Care only:</b> companionship, meals, light housekeeping, errands and other everyday help. Personal care, like bathing or dressing, is scheduled with our office.',
      ...(mo ? ['<b>No weekly minimum.</b> You don\'t need our 8-hour weekly minimum or a set schedule to use the app.', '<b>No short-visit rate.</b> Visits booked in the app avoid our higher rate for short shifts.'] : []),
      (b.key === 'OK' ? `Visits are at least 2 hours, ${h(appHours(b.key))}.` : `Visits are at least 2 hours, any day between ${h(appHours(b.key))}.`),
      `Your request goes straight to our caregivers, starting with those who know ${cl}, then others who are available.`,
      'Cancel a request anytime before it\'s confirmed. Once confirmed, there\'s no fee if you cancel at least 24 hours ahead; later cancellations are charged 2 hours.']) +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:16px 0 0;background:${C.honeyPale};border-left:4px solid ${C.honey};border-radius:8px"><tr><td style="padding:14px 16px;${font}font-size:15px;line-height:1.55;color:${C.ink}">` +
      `<b>Please know before you book</b><br>Our office staff aren't involved in app bookings, so the app is the place to follow your request. A visit isn't guaranteed: it's confirmed only when a caregiver accepts. If no caregiver responds, the visit won't happen, and there's no charge.</td></tr></table>` +
    `</td></tr></table>`
  const appBody = (kind === 'flexible'
      ? K.p(`Request care for ${cl} on the days and times that suit your family.`, 0) + K.bullets(['No recurring weekly schedule required', 'Request a visit whenever care is needed', 'Choose the day and time that work for you', 'Ask for companionship, meals, light housekeeping, errands and other everyday help', 'Follow your request in the app as caregivers respond'])
      : kind === 'both' ? K.p(`Request care on other days or times whenever a little more support would help. It's the easy way to add flexibility around ${cl}'s regular schedule.`, 0)
      : K.p(`Whenever additional care would be helpful, you can request a visit outside ${cl}'s regular schedule. It doesn't change the regular schedule, and using it is entirely up to you.`, 0)) +
    `<div style="${font}font-size:15px;font-weight:700;color:${C.navy};margin:18px 0 0">How to sign in</div>` +
    K.steps(['Open the Booking App.', `Enter your email address, <b>${em}</b>.`, "We'll email you a 6-digit code.", 'Enter the code to sign in. No password needed.']) +
    K.button(String(b.app_url), 'Open the Booking App') + howBooking
  const body = K.section(`${h(b.short)} Booking App`, kind === 'both' ? 'Request care on other days' : 'Request care when you need it', appBody)
  const HERO: Record<CareType, { title: string; intro: string; pre: string; subject: string }> = {
    regular: { title: `Request care for ${cl} when it would help`, intro: `Along with ${cl}'s regular visits, you can request a visit on other days or times with the ${h(b.short)} Booking App, right from your phone.`, pre: `Request care for ${client} from your phone.`, subject: `The ${b.short} Booking App for ${client}` },
    flexible: { title: 'Care when you need it, without a weekly commitment', intro: `You've chosen flexible care for ${cl}. With the ${h(b.short)} Booking App, you can request a visit whenever care would help, with no standing weekly schedule.`, pre: `Request care for ${client} whenever you need it.`, subject: `Welcome to ${b.short}: request care for ${client} anytime` },
    both: { title: 'Regular visits, plus the freedom to request more', intro: `${cl} has the consistency of regular caregiver visits, along with the flexibility to request care on other days whenever it would help.`, pre: `Request care for ${client} on other days.`, subject: `The ${b.short} Booking App for ${client}` },
  }
  const H = HERO[kind]
  return { subject: H.subject, html: K.page(first, client, phone, H, body, pilot) }
}

/** What the AxisCare welcome needs from AxisCare, shared by the office's button (axis_welcome) and the automatic send
 *  (family-welcome-alert.ts via family-offer): the office from the client's state (never a default brand), and that the client
 *  is active (their sign-in wouldn't work otherwise). HIPAA and "their email is on AxisCare" are checked by each caller. */
// deno-lint-ignore no-explicit-any
export async function axisWelcomeFor(d: { ax: Ax }, st: any, c: any, k: any): Promise<{ ok: true; subject: string; html: string; brand: string } | { ok: false; why: string }> {
  const first = String(c.name ?? '').trim().split(/\s+/)[0] || 'there'
  const client = String(k.client_name ?? '').trim().split(/\s+/)[0] || 'your loved one'
  const email = String(c.email ?? '').trim().toLowerCase()
  if (!emailOk(email)) return { ok: false, why: `there's no email for ${c.name}` }
  const cst = await d.ax('GET', `/api/clients/${encodeURIComponent(k.axiscare_client_id)}`)
  if (cst.status !== 200) return { ok: false, why: "AxisCare couldn't be read just now" }
  const axc = cst.json?.results?.client ?? cst.json?.results
  const state = String(axc?.residentialAddress?.state ?? '').toUpperCase()
  const b = brand(brandFor(state), st)
  if (!b) return { ok: false, why: `${client}'s address in AxisCare isn't Missouri or Oklahoma${state ? ` (it says ${state})` : ''}, so we don't know which office this is` }
  const active = axc?.status?.active === true || testClients(st).includes(String(k.axiscare_client_id))
  if (!active) return { ok: false, why: `${client} isn't an active client in AxisCare (the sign-in wouldn't work yet)` }
  const phone = st?.[`family_app_office_phone_${b.key}`] ?? b.phone
  return { ok: true, ...axisWelcomeEmail(first, client, email, phone, b), brand: b.key }
}

// deno-lint-ignore no-explicit-any
export async function officeAction(d: OfficeDeps, staff: Staff, body: any): Promise<Out> {
  const action = String(body?.action ?? '')
  const nowIso = d.now().toISOString()
  const ev = (verb: string, summary: string, data: Record<string, unknown>) => d.event({ actor_kind: 'person', actor_email: staff.email, actor_name: staff.name, via: 'hub', verb, area: 'family_app', summary, data })
  /* The Care Scheduling Type (her decision 2026-10-17): saved on the client's Family Circle; it sets the App plan default
     ("Flexible on, Regular and Combination off (office can still change it)"), only when the type changes. */
  // deno-lint-ignore no-explicit-any
  const saveCareType = async (circleId: string, k: any, kind: CareType) => {
    const plan = kind === 'flexible'
    const vals: Record<string, unknown> = { care_scheduling_type: kind, care_scheduling_type_at: nowIso, care_scheduling_type_by: staff.name,
      app_plan: plan, app_plan_since: plan ? (k.app_plan === true ? k.app_plan_since : central(d.now()).date) : k.app_plan_since ?? null, app_plan_by: `${staff.email} (scheduling type)` }
    await d.setPlan(circleId, vals)
    await ev('family_scheduling_type', `${staff.name} set ${k.client_name ?? 'a client'} to ${CARE_TYPE_LABEL[kind]} (App plan ${plan ? 'on' : 'off'})`, { circle_id: circleId, kind, app_plan: plan })
  }

  if (action === 'list') {
    const from = new Date(d.now().getTime() - 30 * 86400000).toISOString().slice(0, 10)
    const st = await d.settings(), tasks = [...new Set([...tasksFor('MO', st), ...tasksFor('OK', st)])]   // Release 3: the companion tasks a client's app may offer
    return say(200, { members: await d.members(), bookings: await d.recentBookings(from), plans: await d.plans(), tasks })
  }

  if (['invite', 'revoke', 'can_book'].includes(action)) {
    const c = await d.contact(String(body?.contact_id ?? '').trim())
    if (!c) return say(404, { error: 'That person isn\'t in a Family Circle.' })
    if (action === 'can_book') {
      const on = body?.on === true
      if (!(await d.updateContact(c.id, { app_can_book: on, app_book_choice: on }))) return say(500, { error: 'Not saved. Please try again.' })   // 2026-10-18b: the latest choice, which a first sign-in follows
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
    if (k.booking_app_off_at) return say(409, { error: `The Booking App is turned off for ${k.client_name ?? 'this client'}. Turn it on for the client first.` })
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
    await ev('family_app_invited', `${staff.name} gave ${c.name} the Booking App for ${k.client_name ?? 'their client'}`, { contact_id: c.id, can_book: can })
    // (2026-10-17: the App plan default now comes from the Care Scheduling Type, not from the invite)
    return say(200, { ok: true, words: inviteWords(String(c.name ?? '').split(' ')[0] || 'there', String(k.client_name ?? 'your loved one')), email })
  }

  if (action === 'welcome') {
    const c = await d.contact(String(body?.contact_id ?? '').trim())
    if (!c) return say(404, { error: 'That person isn\'t in a Family Circle.' })
    if (c.app_status !== 'active') return say(409, { error: `Invite ${c.name} to the family app first.` })
    if (c.stopped_at || c.axiscare_removed_at) return say(409, { error: `${c.name} has been removed from the Family Circle.` })
    const k = await d.circle(String(c.circle_id))
    if (!k?.axiscare_client_id) return say(409, { error: 'Connect this Family Circle to the client in AxisCare first.' })
    // her rule 2026-10-25: a client whose Booking App is off never gets the Booking App email
    if (k.booking_app_off_at) return say(409, { error: `The Booking App is turned off for ${k.client_name ?? 'this client'}, so its email can't go.` })
    const st = await d.settings()
    const first = String(c.name ?? '').trim().split(/\s+/)[0] || 'there'
    const client = String(k.client_name ?? '').trim().split(/\s+/)[0] || 'your loved one'
    const cst = await d.ax('GET', `/api/clients/${encodeURIComponent(k.axiscare_client_id)}`)
    const axc = cst.json?.results?.client ?? cst.json?.results
    const state = String(axc?.residentialAddress?.state ?? '').toUpperCase()
    // Never a default brand: an address that isn't Missouri or Oklahoma (or AxisCare unreadable) = nothing is sent.
    const bk = cst.status === 200 ? brandFor(state) : null
    const b = brand(bk, st)
    if (!b) {
      // The office pressed the button, so the reason shows right there (no card needed).
      return say(409, { error: cst.status === 200 ? `${client}'s address in AxisCare isn't Missouri or Oklahoma${state ? ` (it says ${state})` : ''}, so we don't know which office this is. Fix the address in AxisCare, then send it.` : "AxisCare couldn't be read just now, so nothing was sent. Please try again in a minute." })
    }
    if (!b.app_url) return say(409, { error: `The family app isn't set up for ${b.name} yet, so nothing was sent.` })
    const active = axc?.status?.active === true || testClients(st).includes(String(k.axiscare_client_id))
    if (!active) return say(409, { error: `${client} isn't an active client in AxisCare, so the welcome can't go yet (their sign-ins wouldn't work).` })
    // HIPAA permission (as for care-note messages): the welcome leads to the client's schedule, notes and invoices
    const isClient = String(c.relationship ?? '').toLowerCase() === 'client'
    const hipaaOk = isClient || hipaaYes(c)
    const phone = st?.[`family_app_office_phone_${b.key}`] ?? b.phone
    const email = String(c.email ?? '').trim().toLowerCase()
    const canText = !!(c.phone && c.sms_consent), canEmail = !!email
    /* her rule 2026-10-23: a number from AxisCare isn't texted until a person confirms it, and the welcome says so plainly */
    const trust: PhoneTrust | null = !canText ? null : d.phoneTrust ? await d.phoneTrust(c.phone) : 'ok'
    const textHeld = canText && trust !== 'ok'
    const heldWhy = !textHeld ? null : trust === 'unconfirmed' ? `${first}'s number (${c.phone}) isn't confirmed yet, so the text was held. Confirm the number to send the text.`
      : trust === 'rejected' ? `${first}'s number (${c.phone}) was reviewed and marked wrong, so the text was held. Check it with the family and fix it in AxisCare.`
      : `The Hub couldn't check ${first}'s number just now, so the text was held.`
    const kind: CareType | null = isCareType(body?.kind) ? body.kind : isCareType(k.care_scheduling_type) ? k.care_scheduling_type : null
    // already sent to this person, or to the same email for this client (a couple sharing an inbox)
    const same = d.circleContacts ? (await d.circleContacts(String(c.circle_id))).filter((x) => x.id !== c.id && String(x.email ?? '').trim().toLowerCase() === email && x.welcome_sent_at) : []
    const prior = c.welcome_sent_at ? c : same[0] ?? null
    const sent = prior ? { at: prior.welcome_sent_at, by: prior.welcome_sent_by ?? null, version: prior.welcome_version ?? null, how: prior.welcome_how ?? null, to: prior.id === c.id ? null : prior.name } : null
    const render = (kk: CareType) => ({ text: welcomeText(first, client, email, phone, b, kk), email: welcomeEmail(first, client, email, phone, b, st?.family_welcome_pilot_line !== false, kk) })
    if (body?.send !== true) {
      const r = kind ? render(kind) : null
      return say(200, { preview: true, name: c.name, client, can_text: canText, can_email: canEmail, hipaa_ok: hipaaOk,
        hipaa_axis: c.hipaa_authorized ?? null, hipaa_office: c.hipaa_office_ok_at ? { at: c.hipaa_office_ok_at, by: c.hipaa_office_ok_by ?? null } : null,
        kinds: CARE_TYPES.map((x) => ({ key: x, label: CARE_TYPE_LABEL[x] })), kind, saved_kind: isCareType(k.care_scheduling_type) ? k.care_scheduling_type : null, sent,
        text: r?.text ?? null,
        email_subject: r?.email.subject ?? null, email_html: r?.email.html ?? null, brand: b.key,
        phone: c.phone ?? null, phone_trust: trust, text_held: heldWhy, phone_confirmed: c.phone_confirmed_at && c.phone_confirmed_number === c.phone ? { at: c.phone_confirmed_at, by: c.phone_confirmed_by ?? null } : null })
    }
    if (!kind) return say(400, { error: 'Pick how this client schedules care (Regular, Flexible or Combination) first.' })
    if (!hipaaOk) return say(409, { error: `${c.name} doesn't have HIPAA permission for ${client} on file, so the welcome (which opens ${client}'s schedule, notes and invoices) can't go. ${c.hipaa_authorized === false ? 'AxisCare says No; change it there if that\'s wrong.' : 'Mark HIPAA OK in the Hub, or check their permission in AxisCare.'}` })
    if (sent && body?.again !== true) return say(409, { already: sent, error: `Already sent${sent.to ? ` to ${sent.to} at the same email` : ''} on ${stampWords(new Date(sent.at))}${sent.by ? ` by ${sent.by}` : ''}. Send it again?` })
    // Family messages go 8 AM to 6 PM Central (the hours policy); after that it would be held, so say so plainly instead
    const hr = Math.floor(central(d.now()).minutes / 60)
    if (hr < 8 || hr >= 18) return say(409, { error: 'Welcomes go out between 8 AM and 6 PM. Nothing was sent; please send it then.' })
    const r = render(kind)
    const text = String(body?.text ?? '').trim() || r.text
    if (!canText && !canEmail) return say(409, { error: `There's no way to reach ${c.name}: no email, and no phone with Texts OK.` })
    if (!canEmail && textHeld) return say(409, { error: `Nothing was sent. ${heldWhy}` })
    if (body?.by_email === false && textHeld) return say(409, { error: `Nothing was sent. ${heldWhy}` })
    // the version is remembered on the client as its Care Scheduling Type (and sets the App plan default when it changes)
    if (k.care_scheduling_type !== kind) await saveCareType(String(k.id), k, kind)
    let byText = false, byEmail = false
    if (canText && !textHeld && body?.by_text !== false) byText = await d.send(c, 'sms', { message: text })
    if (canEmail && body?.by_email !== false) byEmail = await d.send(c, 'email', { subject: r.email.subject, html: r.email.html })
    const how = [byText && 'text', byEmail && 'email'].filter(Boolean).join(' + ')
    // a text sent afterwards (the number was confirmed later) adds to the record instead of replacing how it went
    const howRec = body?.by_email === false && c.welcome_how ? [...new Set([...String(c.welcome_how).split(' + '), ...how.split(' + ')].filter(Boolean))].join(' + ') : how
    await d.logMessage({ circle_id: String(c.circle_id), kind: 'update', body: text, sent_by: staff.name, reached: byText || byEmail ? 1 : 0, skipped: byText || byEmail ? 0 : 1 })
    await ev('family_app_welcome', `${staff.name} sent ${c.name} the ${CARE_TYPE_LABEL[kind]} Booking App email (${how || 'nothing went'})`, { contact_id: c.id, by_text: byText, by_email: byEmail, part: 'booking_app', version: kind, again: !!sent })
    if (!byText && !byEmail) return say(502, { error: 'Neither the text nor the email went through. If GoHighLevel refused it there\'s a Needs Attention card; otherwise they may have opted out.' })
    // the record: date and time, who, which version, how
    await d.updateContact(c.id, { welcome_sent_at: nowIso, welcome_sent_by: staff.name, welcome_version: kind, welcome_how: howRec })
    return say(200, { ok: true, by_text: byText, by_email: byEmail, sent_at: nowIso, version: kind, text_held: heldWhy,
      text_failed: canText && !textHeld && body?.by_text !== false && !byText })
  }

  if (action === 'scheduling_type') {
    const k = await d.circle(String(body?.circle_id ?? ''))
    if (!k) return say(404, { error: 'Family Circle not found.' })
    if (!isCareType(body?.kind)) return say(400, { error: 'Pick Regular Scheduled Care, Flexible Booking Care or Combination of Both.' })
    await saveCareType(String(k.id), k, body.kind)
    return say(200, { ok: true, kind: body.kind })
  }

  if (action === 'welcome_skip') {
    const c = await d.contact(String(body?.contact_id ?? '').trim())
    if (!c) return say(404, { error: 'That person isn\'t in a Family Circle.' })
    const on = body?.on !== false, reason = String(body?.reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
    if (on && !reason) return say(400, { error: 'Say why (for the record).' })
    await d.updateContact(c.id, on ? { welcome_skip_at: nowIso, welcome_skip_by: staff.name, welcome_skip_reason: reason } : { welcome_skip_at: null, welcome_skip_by: null, welcome_skip_reason: null })
    await ev('family_welcome_skip', `${staff.name} ${on ? `marked "no welcome" for ${c.name}: ${reason}` : `cleared "no welcome" for ${c.name}`}`, { contact_id: c.id, on })
    return say(200, { ok: true })
  }

  /* The AxisCare welcome by hand (2026-10-25): the same email the automatic send uses, for a resend, for someone the automatic
     send couldn't reach, or while ops_settings.family_axis_welcome_auto is off. Email only. */
  if (action === 'axis_welcome') {
    const c = await d.contact(String(body?.contact_id ?? '').trim())
    if (!c) return say(404, { error: 'That person isn\'t in a Family Circle.' })
    if (c.stopped_at || c.axiscare_removed_at) return say(409, { error: `${c.name} has been removed from the Family Circle.` })
    const k = await d.circle(String(c.circle_id))
    if (!k?.axiscare_client_id) return say(409, { error: 'Connect this Family Circle to the client in AxisCare first.' })
    const email = String(c.email ?? '').trim().toLowerCase()
    if (!emailOk(email)) return say(409, { error: `Add an email for ${c.name} first.` })
    const st = await d.settings()
    const m = await axisWelcomeFor(d, st, c, k)
    if (!m.ok) return say(409, { error: `Nothing was sent: ${m.why}.` })
    const isClient = String(c.relationship ?? '').toLowerCase() === 'client'
    const hipaaOk = isClient || hipaaYes(c)
    // AxisCare's Activate account works only for an email on the client's AxisCare record (a responsible party)
    const rps = await d.rpEmails(String(k.axiscare_client_id))
    const onAxis = rps === null ? null : rps.includes(email)
    const same = d.circleContacts ? (await d.circleContacts(String(c.circle_id))).filter((x) => x.id !== c.id && String(x.email ?? '').trim().toLowerCase() === email && x.axis_welcome_sent_at) : []
    const prior = c.axis_welcome_sent_at ? c : same[0] ?? null
    const sent = prior ? { at: prior.axis_welcome_sent_at, by: prior.axis_welcome_sent_by ?? null, to: prior.id === c.id ? null : prior.name } : null
    if (body?.send !== true) return say(200, { preview: true, name: c.name, hipaa_ok: hipaaOk, hipaa_axis: c.hipaa_authorized ?? null,
      hipaa_office: c.hipaa_office_ok_at ? { at: c.hipaa_office_ok_at, by: c.hipaa_office_ok_by ?? null } : null, axis_email_on_file: onAxis, sent,
      failed: c.axis_welcome_failed_at ? { at: c.axis_welcome_failed_at, why: c.axis_welcome_failed_why ?? null } : null, email_subject: m.subject, email_html: m.html })
    if (!hipaaOk) return say(409, { error: `${c.name} doesn't have HIPAA permission for ${k.client_name ?? 'the client'} on file, so the AxisCare welcome (which opens their schedule, notes and invoices) can't go.` })
    if (onAxis === false) return say(409, { error: `${c.name}'s email isn't on the client's AxisCare record, so Activate account won't work for them. Add them as a responsible party in AxisCare first.` })
    if (sent && body?.again !== true) return say(409, { already: sent, error: `Already sent${sent.to ? ` to ${sent.to} at the same email` : ''} on ${stampWords(new Date(sent.at))}${sent.by ? ` by ${sent.by}` : ''}. Send it again?` })
    const hr = Math.floor(central(d.now()).minutes / 60)
    if (hr < 8 || hr >= 18) return say(409, { error: 'Welcomes go out between 8 AM and 6 PM. Nothing was sent; please send it then.' })
    const went = await d.send(c, 'email', { subject: m.subject, html: m.html })
    await d.logMessage({ circle_id: String(c.circle_id), kind: 'update', body: m.subject, sent_by: staff.name, reached: went ? 1 : 0, skipped: went ? 0 : 1 })
    await ev('family_axis_welcome', `${staff.name} sent ${c.name} the AxisCare welcome (${went ? 'email' : 'nothing went'})`, { contact_id: c.id, by_email: went, again: !!sent, auto: false })
    if (!went) return say(502, { error: 'The email didn\'t go through. If GoHighLevel refused it there\'s a Needs Attention card; otherwise they may have opted out.' })
    await d.updateContact(c.id, { axis_welcome_sent_at: nowIso, axis_welcome_sent_by: staff.name, axis_welcome_how: 'email', axis_welcome_failed_at: null, axis_welcome_failed_why: null })
    if (d.closeItem) await d.closeItem(`fam_welcome_${c.circle_id}`, staff.name, `AxisCare welcome sent to ${c.name}.`)   // the reminder reopens if someone else is still waiting
    return say(200, { ok: true, by_email: true, sent_at: nowIso })
  }

  /* The client's Booking App on/off (her rule 2026-10-25: "be able to turn off the booking app and that means it takes it off the
     email"). Off = no invites and no Booking App email for anyone in this client's circle; the AxisCare welcome never mentions
     the app anyway. Logins someone already has are left as they are: the answer names them, each has its own Turn app off. */
  if (action === 'booking_app') {
    const k = await d.circle(String(body?.circle_id ?? ''))
    if (!k) return say(404, { error: 'Family Circle not found.' })
    const on = body?.on === true, reason = String(body?.reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
    if (!(await d.setPlan(String(k.id), on ? { booking_app_off_at: null, booking_app_off_by: null, booking_app_off_reason: null } : { booking_app_off_at: nowIso, booking_app_off_by: staff.name, booking_app_off_reason: reason || null })))
      return say(500, { error: 'Not saved. Please try again.' })
    await ev('family_booking_app_client', `${staff.name} turned the Booking App ${on ? 'on' : 'off'} for ${k.client_name ?? 'a client'}${reason ? `: ${reason}` : ''}`, { circle_id: k.id, on })
    const still = !on && d.circleContacts ? (await d.circleContacts(String(k.id))).filter((x) => x.app_status === 'active').map((x) => String(x.name ?? '')) : []
    return say(200, { ok: true, on, still_signed_in: still })
  }

  if (action === 'hipaa_ok') {
    const c = await d.contact(String(body?.contact_id ?? '').trim())
    if (!c) return say(404, { error: 'That person isn\'t in a Family Circle.' })
    const on = body?.on !== false
    if (on && c.hipaa_authorized === false) return say(409, { error: `AxisCare says ${c.name} does NOT have HIPAA permission. If that's wrong, change it in AxisCare (the Hub copies it overnight).` })
    if (!(await d.updateContact(c.id, on ? { hipaa_office_ok_at: nowIso, hipaa_office_ok_by: staff.name } : { hipaa_office_ok_at: null, hipaa_office_ok_by: null }))) return say(500, { error: 'Not saved. Please try again.' })
    await ev('family_hipaa_ok', `${staff.name} ${on ? 'marked HIPAA OK in the Hub' : 'took back the Hub HIPAA OK'} for ${c.name}`, { contact_id: c.id, on })
    return say(200, { ok: true, on, at: on ? nowIso : null, by: on ? staff.name : null })
  }

  if (action === 'confirm_phone') {
    const c = await d.contact(String(body?.contact_id ?? '').trim())
    if (!c) return say(404, { error: 'That person isn\'t in a Family Circle.' })
    if (!c.phone) return say(409, { error: `There's no phone number for ${c.name}.` })
    if (!d.confirmPhone) return say(503, { error: 'Not available yet.' })
    const on = body?.on !== false
    const r = await d.confirmPhone(c.phone, on ? `${staff.name} (Hub)` : null)
    if (r === 'rejected') return say(409, { error: `${c.phone} was reviewed and marked wrong before, so it can't be confirmed here. Check it with the family and fix it in AxisCare.` })
    if (r === 'error') return say(500, { error: 'Not saved. Please try again.' })
    if (!(await d.updateContact(c.id, on ? { phone_confirmed_at: nowIso, phone_confirmed_by: staff.name, phone_confirmed_number: c.phone } : { phone_confirmed_at: null, phone_confirmed_by: null, phone_confirmed_number: null }))) return say(500, { error: 'Not saved. Please try again.' })
    await ev('family_phone_confirmed', `${staff.name} ${on ? 'confirmed' : 'took back the confirmation of'} ${c.name}'s number`, { contact_id: c.id, on, already_ok: r === 'none' })
    return say(200, { ok: true, on })
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

  // 2026-10-24 (Cara's shift page): "What they enjoy", a short office-approved list beside the About (up to 6 items, a few
  // words each). Shown to caregivers on a shift page after they confirm it's them. Empty = nothing shown.
  if (action === 'enjoys') {
    const k = await d.circle(String(body?.circle_id ?? ''))
    if (!k) return say(404, { error: 'Family Circle not found.' })
    if (!d.setAbout) return say(503, { error: 'Not available yet.' })
    const raw = Array.isArray(body?.items) ? body.items : String(body?.items ?? '').split(',')
    const items = [...new Set(raw.map((x: unknown) => String(x ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean))] as string[]
    if (items.length > 6) return say(400, { error: 'Please keep it to 6 things.' })
    if (items.some((x) => x.length > 30)) return say(400, { error: 'Please keep each one short (a few words).' })
    if (items.some((x) => /\d{3}/.test(x))) return say(400, { error: 'Please leave out numbers and addresses.' })
    if (!(await d.setAbout(String(k.id), { caregiver_enjoys: items.length ? items : null, caregiver_enjoys_by: staff.email, caregiver_enjoys_at: d.now().toISOString() }))) return say(500, { error: 'Not saved. Please try again.' })
    await ev('family_app_enjoys', `${staff.name} ${items.length ? 'updated' : 'cleared'} What they enjoy for ${k.client_name ?? 'a client'}`, { circle_id: k.id, items: items.length })
    return say(200, { ok: true, items })
  }

  // 2026-10-24: "Share the care needs on shift pages" (what they'd help with, level, skills, pets and smoking from the care
  // plan). Off = a shift page shows only the shift, the About and What they enjoy. Recorded with who and when.
  if (action === 'share_care') {
    const k = await d.circle(String(body?.circle_id ?? ''))
    if (!k) return say(404, { error: 'Family Circle not found.' })
    if (!d.setAbout) return say(503, { error: 'Not available yet.' })
    const on = body?.on === true
    if (!(await d.setAbout(String(k.id), { caregiver_share_care: on, caregiver_share_care_by: staff.email, caregiver_share_care_at: d.now().toISOString() }))) return say(500, { error: 'Not saved. Please try again.' })
    await ev('family_app_share_care', `${staff.name} ${on ? 'turned on' : 'turned off'} sharing the care needs on shift pages for ${k.client_name ?? 'a client'}`, { circle_id: k.id, on })
    return say(200, { ok: true, on })
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
    for (const k of ['book', 'fill']) await d.closeItem(`fam_${k}_${b.id}`, staff.name, `${name} placed`)
    await ev('family_booking_placed', `${staff.name} placed ${name} with ${b.client_name} ${b.visit_date}`, { booking_id: b.id, caregiver: cg })
    return say(200, { ok: true, caregiver_name: name })
  }
  if (action === 'review') {
    const b = await d.booking(String(body?.booking_id ?? ''))
    if (!b) return say(404, { error: 'Booking not found.' })
    if (b.status !== 'held') return say(409, { error: 'This request is not waiting for a check any more.' })
    const decision = String(body?.decision ?? '')
    if (decision === 'approve' || decision === 'approve_no_note') {
      const hide = decision === 'approve_no_note'
      await d.updateBooking(b.id, { status: 'waiting_for_caregiver', reviewed_at: nowIso, reviewed_by: staff.email, review_decision: decision, note_check: 'office_ok', ...(hide ? { note_hidden: true } : {}) })
      await d.closeItem(`fam_held_${b.id}`, staff.name, hide ? 'Approved without the note: caregivers are asked.' : 'Approved: caregivers are asked.')
      await ev('family_request_approved', `${staff.name} approved ${b.client_name} ${b.visit_date}${hide ? ' without the note' : ''}`, { booking_id: b.id, decision })
      return say(200, { ok: true, status: 'waiting_for_caregiver' })
    }
    if (decision === 'decline') {
      const reason = String(body?.reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)
      if (!reason) return say(400, { error: 'Say why (for the record; the family gets the approved wording).' })
      await d.updateBooking(b.id, { status: 'declined', ended_at: nowIso, ended_why: 'declined', decline_reason: reason, reviewed_at: nowIso, reviewed_by: staff.email, review_decision: 'decline', family_declined_pending: true })
      await d.closeItem(`fam_held_${b.id}`, staff.name, `Declined: ${reason}`)
      await ev('family_request_declined', `${staff.name} declined ${b.client_name} ${b.visit_date}: ${reason}`, { booking_id: b.id })
      return say(200, { ok: true, status: 'declined' })
    }
    return say(400, { error: 'Pick Approve, Approve without the note, or Decline.' })
  }

  if (action === 'fill_close') {
    const b = await d.booking(String(body?.booking_id ?? ''))
    if (!b) return say(404, { error: 'Booking not found.' })
    if (b.status !== 'waiting_for_caregiver' || b.caregiver_axiscare_id) return say(409, { error: 'This request is no longer open.' })
    const how = String(body?.how ?? '')
    if (how === 'couldnt') {
      await d.updateBooking(b.id, { status: 'not_filled', offer_stage: 'done', ended_at: nowIso, ended_why: 'office_couldnt', unfilled_kind: 'couldnt', family_unfilled_pending: true, fill_closed_by: staff.email })
      await d.closeItem(`fam_fill_${b.id}`, staff.name, "Couldn't fill: the family is told.")
      await ev('family_fill_closed', `${staff.name}: couldn't fill ${b.client_name} ${b.visit_date}`, { booking_id: b.id, how })
      return say(200, { ok: true, status: 'not_filled' })
    }
    if (how === 'another_time') {
      await d.updateBooking(b.id, { status: 'cancelled', cancelled_at: nowIso, cancelled_by: staff.name, cancel_source: 'office_agreed', offer_stage: 'done', fill_closed_by: staff.email })
      await d.closeItem(`fam_fill_${b.id}`, staff.name, 'Another time agreed with the family.')
      await ev('family_fill_closed', `${staff.name}: another time agreed for ${b.client_name} (was ${b.visit_date})`, { booking_id: b.id, how })
      return say(200, { ok: true, status: 'cancelled', words: 'Ended. Put the new time on AxisCare (or ask the family to request it in the app).' })
    }
    return say(400, { error: 'Pick Another time agreed or Couldn\'t fill (Placed: use Place).' })
  }

  if (action === 'help_fill') {
    if (!(staff.roles ?? []).some((r) => ['owner_admin', 'care_coordinator'].includes(r))) return say(403, { error: 'Only Samantha or Krystal can set Help us fill.' })
    const k = await d.circle(String(body?.circle_id ?? ''))
    if (!k) return say(404, { error: 'Family Circle not found.' })
    if (!d.setAbout) return say(503, { error: 'Not available yet.' })
    const on = body?.on === true, reason = String(body?.reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)
    if (on && !reason) return say(400, { error: 'Say why this client needs it (for example respite for a worn-out family caregiver).' })
    const review = new Date(d.now().getTime() + 90 * 86400000).toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
    const flag = on ? { on: true, reason, by: staff.email, at: nowIso, review_by: review } : { on: false, by: staff.email, at: nowIso, was: k.help_fill ?? null }
    if (!(await d.setAbout(String(k.id), { help_fill: flag }))) return say(500, { error: 'Not saved. Please try again.' })
    await ev('family_help_fill', `${staff.name} turned Help us fill ${on ? `ON until ${review}` : 'off'} for ${k.client_name ?? 'a client'}${on ? `: ${reason}` : ''}`, { circle_id: k.id, on })
    return say(200, { ok: true, help_fill: flag })
  }

  if (action === 'late_billed') {
    const b = await d.booking(String(body?.booking_id ?? ''))
    if (!b || !b.late_charge_hours) return say(404, { error: 'No late charge on that visit.' })
    const on = body?.on !== false
    await d.updateBooking(b.id, on ? { late_billed_at: nowIso, late_billed_by: staff.email } : { late_billed_at: null, late_billed_by: null })
    await ev('family_late_billed', `${staff.name} ${on ? 'added' : 'took back'} the late-cancel charge (${b.late_charge_hours} hours) for ${b.client_name} ${b.visit_date}`, { booking_id: b.id, on })
    return say(200, { ok: true })
  }

  if (action === 'app_tasks') {
    const k = await d.circle(String(body?.circle_id ?? ''))
    if (!k) return say(404, { error: 'Family Circle not found.' })
    if (!d.setAbout) return say(503, { error: 'Not available yet.' })
    const tasks = Array.isArray(body?.tasks) ? [...new Set(body.tasks.map((t: unknown) => String(t).trim()).filter(Boolean))].slice(0, 40) : null
    if (tasks && !tasks.length) return say(400, { error: 'Pick at least one task, or All companion tasks.' })
    if (!(await d.setAbout(String(k.id), { app_tasks: tasks }))) return say(500, { error: 'Not saved. Please try again.' })
    await ev('family_app_tasks', `${staff.name} set the app tasks for ${k.client_name ?? 'a client'}: ${tasks ? tasks.join(', ') : 'all companion tasks'}`, { circle_id: k.id, tasks })
    return say(200, { ok: true, app_tasks: tasks })
  }
  return say(400, { error: 'unknown action' })
}
