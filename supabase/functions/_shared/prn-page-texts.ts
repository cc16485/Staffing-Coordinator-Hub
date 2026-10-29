// =============================================================================
// PRN STEP 5a · THE TEXTS THAT CARRY THE PRN TEAM PAGE LINK (Samantha 2026-10-29: "Build all three link texts as you wrote
// them, each with its switch off")
// =============================================================================
//   page ready     one text, once, to each PRN member linked in AxisCare, telling them their page is ready. Sent by
//                  prn-welcome (same weekday window), switch ops_settings.prn_page_ready_live. Someone linked in the last
//                  WELCOME_DAYS days is left to the welcome text, and anyone whose welcome already carried the link is skipped.
//   welcome        her approved welcome text with "Here's your own PRN Team page: {link}" before its last sentence.
//                  Switch ops_settings.prn_welcome_link_live; off, the welcome goes out exactly as before.
//   60-day check-in  opens their PRN Team page at My hours instead of the My Hours page. Switch
//                  ops_settings.prn_reconfirm_page_live; off, the check-in goes out exactly as before.
// Each one also needs ops_settings.prn_page_live: a link to a page that isn't open is never sent.
// Each wording is editable in Settings; empty means the standard wording. Only decisions here (no reads or writes).
// =============================================================================
import { WELCOME_DAYS } from './prn-welcome.ts'
import { PAGE_BASE } from './prn-page-links.ts'
// deno-lint-ignore no-explicit-any
type Any = any
const S = (v: unknown, n = 200) => String(v ?? '').trim().slice(0, n)
const DAY = 86_400_000

export const PAGE_READY_DEFAULT = "Hi {first_name}, your Caring Companions PRN Team page is ready: {link} See the shifts we've asked you about, update your hours, or let us know you're looking for hours. It's just for you, so please don't share the link."
export const RECONFIRM_PAGE_DEFAULT = "Hi {first_name}! We're updating our Caring Companions PRN Team availability. Are you still available for the times you gave us? Tap to confirm or update on your PRN Team page: {link}"
export const WELCOME_LINK_LINE = "Here's your own PRN Team page: {link}"
export const READY_CAP = 20
/* A text's record keeps the message with the link taken out (the office makes a fresh one any time with Copy page link). */
export const LINK_KEPT = '(their page link)'
export const keptMessage = (message: string, link: string) => link ? message.replaceAll(link, LINK_KEPT) : message

/** Which link texts may go out right now. A link text needs its own switch and the page open. */
export function linkSwitches(st: Any): { page: boolean; ready: boolean; welcome: boolean; reconfirm: boolean } {
  const page = st?.prn_page_live === true
  return { page, ready: page && st?.prn_page_ready_live === true, welcome: page && st?.prn_welcome_link_live === true, reconfirm: page && st?.prn_reconfirm_page_live === true }
}

const fill = (t: string, first: string, link: string) => t.replaceAll('{first_name}', S(first, 40) || 'there').replaceAll('{link}', link).replace(/\s{2,}/g, ' ').trim()

/** The welcome with the page link. The welcome text is already filled in (welcomeText). If it has {link}, the link goes
    there; otherwise "Here's your own PRN Team page: {link}" goes before its last sentence. */
export function welcomeWithLink(welcome: string, link: string): string {
  const w = S(welcome, 700)
  if (w.includes('{link}')) return w.replaceAll('{link}', link)
  const m = w.match(/^([\s\S]*[.!?])\s+([^.!?]+[.!?])$/)
  const line = WELCOME_LINK_LINE.replace('{link}', link)
  return m ? `${m[1]} ${line} ${m[2]}` : `${w} ${line}`
}

export function pageReadyText(tmpl: string | null | undefined, first: string, link: string): string { return fill(S(tmpl, 700) || PAGE_READY_DEFAULT, first, link) }
export function reconfirmPageText(tmpl: string | null | undefined, first: string, link: string): string { return fill(S(tmpl, 700) || RECONFIRM_PAGE_DEFAULT, first, link) }
/** The check-in opens the page at My hours. */
export const hoursLink = (pageLink: string) => pageLink + '#hours'

const linkedDay = (t: Any) => /^\d{4}-\d\d-\d\d/.test(S(t?.linked_at, 10)) ? new Date(S(t.linked_at, 40)).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }) : ''
const daysSince = (ymd: string, today: string) => Math.round((Date.parse(today + 'T12:00:00Z') - Date.parse(ymd + 'T12:00:00Z')) / DAY)

/** Who gets "your page is ready" this run. tracks: pay_tracks rows (track prn_team); touches: prn_touches rows. Linked in
    AxisCare, not texted it before, their welcome didn't carry the link, and past the welcome's first week (the welcome
    covers new members). Longest on the team first, at most READY_CAP. */
export function dueReady(tracks: Any[], touches: Any[], today: string): Any[] {
  const done = new Set(touches.filter((t) => (t?.kind === 'page_ready_sent' && t?.ref === 'page_ready')
    || (t?.kind === 'welcome_sent' && t?.ref === 'welcome' && (S(t?.message, 900).includes(LINK_KEPT) || S(t?.message, 900).includes(PAGE_BASE)))).map((t) => t.applicant_id))
  return tracks.filter((t) => {
    if (t?.track !== 'prn_team' || !t?.axiscare_caregiver_id || done.has(t.applicant_id)) return false
    const d = linkedDay(t)
    return !d || daysSince(d, today) > WELCOME_DAYS
  }).sort((a, b) => S(a.linked_at, 40).localeCompare(S(b.linked_at, 40))).slice(0, READY_CAP)
}
