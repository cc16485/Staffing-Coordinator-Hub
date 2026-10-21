// =============================================================================
// reference-texts.ts · the reference text messages (Samantha 2026-10-21, changing her Oct 1 rule: "the Hub texts each
// reference automatically from the office line (with STOP to opt out), and the office calls when needed").
// =============================================================================
// Two texts, sent with the emails reference-chase already sends: the first ask and the one reminder two days later. Same
// ladder otherwise (day 5 the applicant is asked to help, day 9 a Call card for the office). They go from the office line
// (ghlSendChecked's officeSms), through the opt-out door, weekdays 8am to 6pm (outreachGate), only while
// ops_settings.ref_auto_text_live is true. Off = practice: reference-chase only counts who would have been texted.
// Pure: the words and the choice of who is texted, so the tests run exactly what the server sends. No em dashes.
// deno-lint-ignore-file no-explicit-any
import { withStop } from './text-consent.ts'
export const firstName = (v: unknown) => String(v ?? '').trim().split(/\s+/)[0] || 'there'
const phoneOk = (v: unknown) => { const d = String(v ?? '').replace(/\D/g, ''); return d.length === 10 || (d.length === 11 && d[0] === '1') }
/** Can this reference be texted at all? (a usable number on the row) */
export const textable = (r: any) => phoneOk(r?.ref_phone)
export function firstAskText(refName: unknown, candidate: unknown, url: string): string {
  return withStop(`Hi ${firstName(refName)}, this is Caring Companions In-Home Senior Care. ${String(candidate ?? '').trim() || 'Someone'} listed you as a reference for a caregiving job with us. Would you answer a few quick questions? It takes about two minutes: ${url} Thank you so much! Questions? Call (417) 234-8494.`)
}
export function reminderText(refName: unknown, candidate: unknown, url: string): string {
  return withStop(`Hi ${firstName(refName)}, a gentle reminder from Caring Companions. ${String(candidate ?? '').trim() || 'Your friend'} can't start with us until their references are in, and we would love to hear from you. Two minutes: ${url} Thank you, it truly helps!`)
}
