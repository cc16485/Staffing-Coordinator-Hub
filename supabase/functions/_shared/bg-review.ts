// =============================================================================
// BACKGROUND REVIEW, the rules and the words (446). Samantha approved the revised plan "Telling an applicant something
// came up on a background check" ("yes to all", 2026-10-04, https://claude.ai/artifact/92p3yq6QqJxHq2dFLiBbY4).
//
// Our own direct checks only (FCSR, EDL, OIG, fingerprints). A finding is NEVER an automatic
// "not hired": an office person reads the result and picks the review result. Two steps, each sent only when a person
// presses OK on the exact words:
//   Step 1 "Something came up": the text never names the check; the email names the check, never any detail. It sets
//     the Applicant response due date: 5 business days (Monday to Friday) after the day it went. This is our own
//     response period, not a federal waiting period.
//   Step 2 the final notice: only after Step 1 (or "told them by phone or in person"), a picked result that allows it,
//     the response due date passed or "spoke with them", and not while waiting on a Good Cause Waiver.
// Pure functions only, so the tests run exactly what the server runs.
// =============================================================================
// deno-lint-ignore-file no-explicit-any
export const TZ = 'America/Chicago'
export const OFFICE = '(417) 234-8494'
export const RESPONSE_DAYS = 5

export type Check = 'fcsr' | 'edl' | 'oig' | 'fp'
export type Result = 'review' | 'waiver_needed' | 'no_waiver' | 'cannot_employ'
export const CHECKS: Record<Check, { label: string; name: string; phrase: string; flagged: string[]; clear: string; results: Result[] }> = {
  fcsr: { label: 'FCSR', name: 'Missouri Family Care Safety Registry', phrase: 'Missouri Family Care Safety Registry screening', flagged: ['Issues Found'], clear: 'Clear', results: ['waiver_needed', 'no_waiver', 'cannot_employ'] },
  edl: { label: 'EDL', name: 'Missouri Employee Disqualification List', phrase: 'Missouri Employee Disqualification List check', flagged: ['Issues Found'], clear: 'Clear', results: ['cannot_employ'] },
  oig: { label: 'OIG', name: 'federal OIG exclusion list', phrase: 'federal OIG exclusion list check', flagged: ['FLAGGED'], clear: 'CLEAR', results: ['cannot_employ'] },
  fp: { label: 'Fingerprints', name: 'fingerprint background check', phrase: 'fingerprint background check', flagged: ['Issues Found'], clear: 'Clear', results: ['waiver_needed', 'no_waiver'] },
}
export const isCheck = (k: unknown): k is Check => typeof k === 'string' && Object.prototype.hasOwnProperty.call(CHECKS, k)
export const RESULT_LABEL: Record<Result, string> = { review: 'Needs review', waiver_needed: 'Waiver needed', no_waiver: 'No waiver needed', cannot_employ: "Can't be employed" }
export const CLEAR_WHY: Record<string, string> = { not_them: 'Not this person', error_fixed: 'An error that was corrected', no_waiver: 'No waiver needed', waiver_approved: 'Good Cause Waiver approved' }

/* ── dates (Central) ── */
export function centralDate(now: Date): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}
export function centralHour(now: Date): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(now)) % 24
}
export function addBusinessDays(ymd: string, n: number): string {
  const d = new Date(ymd + 'T12:00:00Z'); let left = n
  while (left > 0) { d.setUTCDate(d.getUTCDate() + 1); const w = d.getUTCDay(); if (w !== 0 && w !== 6) left-- }
  return d.toISOString().slice(0, 10)
}
export const responseDue = (now: Date) => addBusinessDays(centralDate(now), RESPONSE_DAYS)
export const fmtLong = (ymd: string) => new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })
/** The due date has passed once its whole day is over in Central time. */
export const duePassed = (due: string | null | undefined, now: Date) => !!due && centralDate(now) > String(due).slice(0, 10)

/* ── the words (the plan's, approved 2026-10-04) ── */
const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const html = (paras: string[]) => `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#1f2a36">` + paras.map((p) => `<p>${p}</p>`).join('') + `</div>`
export type Words = { text: string; subject: string; html: string }

export function step1Words(first: string, check: Check, due: string): Words {
  const f = first || 'there'
  return {
    text: `Hi ${f}, this is Caring Companions. Something came up in your background screening that we'd like to go over with you before we continue your application. Please call us at ${OFFICE} within 5 business days. Reply STOP to opt out.`,
    subject: 'About your background screening',
    html: html([`Hi ${esc(f)},`,
      `Thank you for your patience while we completed your background screening. Something came up on your ${esc(CHECKS[check].phrase)} that we need to go over with you.`,
      `No decision has been made. Please call us at ${OFFICE} by ${esc(fmtLong(due))}. If something in the results is wrong, or there is anything you'd like us to know, including a Good Cause Waiver, we want to hear it.`,
      `Thank you,<br>Caring Companions In-Home Senior Care`]),
  }
}

export type Variant = 'waiver' | 'decision' | 'edl' | 'oig'
export function variantFor(check: Check, result: Result | string | null | undefined): Variant | null {
  if (!isCheck(check) || !CHECKS[check].results.includes(result as Result)) return null
  if (result === 'cannot_employ') return check === 'oig' ? 'oig' : (check === 'edl' || check === 'fcsr') ? 'edl' : null
  if (result === 'waiver_needed') return (check === 'fcsr' || check === 'fp') ? 'waiver' : null
  if (result === 'no_waiver') return (check === 'fcsr' || check === 'fp') ? 'decision' : null
  return null
}
export const FINAL_TEXT = (first: string) => `Hi ${first || 'there'}, thank you for your time. After reviewing your background screening, we're not able to move forward with your application for a caregiving position. We've emailed you more information. Reply STOP to opt out.`
export function finalWords(first: string, check: Check, variant: Variant, spoke: boolean): Words {
  const f = first || 'there', name = esc(CHECKS[check].name)
  const middle: Record<Variant, string[]> = {
    waiver: [`After reviewing your ${name} results, we're not able to offer you a caregiving position at this time. Missouri rules don't allow us to employ someone with this kind of result unless the state grants a Good Cause Waiver.`,
      `You can apply for a waiver yourself by calling the Family Care Safety Registry at 1-866-422-6872 (weekdays, 9am to 3pm) or at health.mo.gov/providers/good-cause-waiver. If a waiver is granted, you're welcome to apply with us again.`],
    decision: [`After reviewing your ${name} results${spoke ? ' and talking with you' : ''}, we've decided not to move forward with your application for a caregiving position at this time.`],
    edl: [`After reviewing your background screening, we're not able to offer you a position. Missouri law does not allow in-home care providers to employ anyone listed on the Missouri Employee Disqualification List.`,
      `If you believe this listing is in error, you can contact the Missouri Department of Health and Senior Services.`],
    oig: [`After reviewing your background screening, we're not able to offer you a caregiving position. Federal rules don't allow us to employ someone on the federal OIG exclusion list in a role paid by Medicare or Medicaid.`,
      `Information about the list and about reinstatement is at oig.hhs.gov/exclusions.`],
  }
  return { text: FINAL_TEXT(f), subject: 'Your application with Caring Companions',
    html: html([`Hi ${esc(f)}, thank you for your time.`, ...middle[variant], `We wish you the very best.<br>Caring Companions In-Home Senior Care · ${OFFICE}`]) }
}

/* ── the gates ── */
export function finalGate(rv: any, now: Date): { ok: boolean; why?: string; variant?: Variant } {
  if (!rv) return { ok: false, why: 'no review' }
  if (rv.status === 'waiting_waiver') return { ok: false, why: 'They are waiting on their Good Cause Waiver. Record the waiver decision first.' }
  if (rv.status !== 'open') return { ok: false, why: 'This review is already closed.' }
  if (!rv.step1_at && !rv.step1_told_at) return { ok: false, why: 'Send "Something came up" first (or record that you told them by phone or in person).' }
  const variant = variantFor(rv.check_key, rv.result)
  if (!variant) return { ok: false, why: 'Pick the review result first (Waiver needed, No waiver needed or Can\'t be employed).' }
  if (rv.result === 'no_waiver' && !String(rv.decision_reason || '').trim()) return { ok: false, why: 'No waiver is needed, so write down why we are not hiring them first.' }
  if (!rv.spoke_at && !duePassed(rv.due_date, now)) return { ok: false, why: `Available after ${fmtLong(String(rv.due_date))} (their response due date), or once you record that you spoke with them.` }
  return { ok: true, variant }
}
