// =============================================================================
// THE CLIENT PROFILE IN THE BOOKING APP (Samantha, 2026-10-25: "Ideally the app works like the client profiles we are building
// to use for call ins/new client shifts....telling a bit about the client...and the family who is using the booking app can see
// what the caregiver sees in a preview as well"; her yes to the picks the same day).
//  - Caregivers: a Booking App visit offer shows the same approved Caregiver Preview as the call-in shift page (About, What
//    they enjoy, the picture, Good to know, and the care summary only when the office approved sharing it). One record, read
//    the same way (cara-skills clientInfoFor), so the office keeps it current in one place.
//  - Families: the app shows "What caregivers see about <client>": exactly that profile, on the home screen and on the request
//    screen before Send. No approved profile yet = the basics (name, town, the request) and the app says so. Requests are never
//    held for a missing profile.
//  - Suggest a change: a family member can send a short suggestion. It waits on the client's Caregiver Preview tab for an
//    approver (the usual approval rules). Nothing a family writes reaches caregivers until the office approves it.
//  - One switch, ops_settings.app_profile_live, off until she tries it. Off = everything exactly as before.
// Pure functions only; the readers and the store are wired in family-gateway, family-offer-db and caregiver-preview.
// =============================================================================

// deno-lint-ignore no-explicit-any
type Any = any
export const APP_PROFILE_SWITCH = 'app_profile_live'
export const appProfileOn = (st: Any) => st?.[APP_PROFILE_SWITCH] === true
export const SUGGEST_MAX = 500, SUGGEST_OPEN_MAX = 3
const S = (v: unknown, n = 400) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const arr = (v: unknown, n = 12): string[] => (Array.isArray(v) ? v : []).map((x) => S(x, 60)).filter(Boolean).slice(0, n)

/** The profile as a caregiver sees it on an app offer (and as the family sees it in the preview). info = clientInfoFor's
    answer (the approved Caregiver Preview, care items only when approved for sharing); scene = shift-offer's sceneFor. */
export function appProfile(info: Any | null, scene: string) {
  const about = S(info?.about) || null, enjoys = arr(info?.enjoys, 6)
  const help = arr(info?.help), needs = arr(info?.needs), home = arr(info?.home, 6)
  const level = Number(info?.level) > 0 ? Number(info.level) : null
  return { about, enjoys, help, needs, home, level, scene: scene || 'porch', basics: !about && !enjoys.length }
}

/** A family's suggestion: one short message, no links. */
export function cleanSuggestion(v: unknown): { ok: true; text: string } | { ok: false; error: string } {
  const text = String(v ?? '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  if (!text) return { ok: false, error: 'Please write what you\'d like changed.' }
  if (text.length > SUGGEST_MAX) return { ok: false, error: `Please keep it under ${SUGGEST_MAX} characters.` }
  if (/https?:\/\/|www\./i.test(text)) return { ok: false, error: 'Please leave out links.' }
  return { ok: true, text }
}

export const SUGGEST_THANKS = (client: string) =>
  `Thank you. We'll look at your suggestion before anything changes. Until then, caregivers see ${client}'s profile as it is now.`
