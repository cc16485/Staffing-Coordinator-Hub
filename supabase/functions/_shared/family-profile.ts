// =============================================================================
// THE FAMILY'S OWN PROFILE IN THE BOOKING APP (Samantha, 2026-10-25: "the family who signs up for the app has access to make
// their profile"; then "if the office makes changes to our profile that we use for shifts, dont make it auto change the
// families profile they made for booking app"; her picks the same day):
//  - The family writes it in the app: a short About, her three Life Story questions, and What they enjoy.
//  - It goes STRAIGHT to caregivers after automatic checks: no address, phone number, money or banking, or health details
//    (fixed rules, then an AI second look). A blocked save says why, so the family can change it. Nothing waits for the office.
//  - TWO SEPARATE PROFILES. The family's shows on Booking App visit offers; the office's Caregiver Preview shows on call-in
//    and new-client shifts (Cara). Neither edit changes the other. The office sees the family's version on the Caregiver
//    Preview tab and can copy it into theirs with "Use the family's words" (that copy is an ordinary office draft).
//  - Until a family writes one, a Booking App offer shows the office's approved profile (as before).
//  - The care summary (what they'd help with, skills, pets, smoking) always comes from the care plan, never from the family.
//  - Switch: ops_settings.family_profile_live. Off = the app shows no editor and offers use the office's profile only.
// Pure functions; the store is wired in family-gateway, family-offer-db, family-app-office and caregiver-preview.
// =============================================================================
import { NOTE_RULES, AI_MODEL, AI_TIMEOUT_MS } from './family-review.ts'

// deno-lint-ignore no-explicit-any
type Any = any
export const FAMILY_PROFILE_SWITCH = 'family_profile_live'
export const familyProfileOn = (st: Any) => st?.[FAMILY_PROFILE_SWITCH] === true
export const ABOUT_MAX = 400, ANSWER_MAX = 300, ENJOYS_MAX = 6, ENJOY_LEN = 30
/** Her three Life Story questions (2026-10-24), worded for the family. */
export const QUESTIONS: { key: 'work' | 'talk' | 'little'; label: string; caregiver: string }[] = [
  { key: 'work', label: 'What work or life did they enjoy?', caregiver: 'Their work and life' },
  { key: 'talk', label: 'What do they enjoy talking about or doing?', caregiver: 'Loves to talk about' },
  { key: 'little', label: 'What little things make their day better?', caregiver: 'Little things that make the day better' },
]
const S = (v: unknown) => String(v ?? '').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim()

// ── the fixed checks ─────────────────────────────────────────────────────────────────
const ADDRESS = /\b\d{2,6}\s+[A-Za-z0-9.\s]{2,30}\b(st|street|ave|avenue|rd|road|dr|drive|ln|lane|ct|court|blvd|way|pl|place|hwy|highway|cir|circle)\b/i
const PHONE = /(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/
const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i
const MONEY = /(\$\s?\d|\b(bank|banking|checking account|savings account|account number|routing|credit card|debit card|pin number|password|social security|ssn|cash in|wallet|checkbook)\b)/i
const HEALTH = /\b(dementia|alzheimer'?s?|parkinson'?s?|diabet\w*|cancer|chemo\w*|stroke|copd|oxygen|dialysis|heart failure|chf|seizures?|epilep\w*|depress\w*|anxiety|schizo\w*|bipolar|psychiatric|hospice|incontinen\w*|catheter|wheelchair bound|bed ?bound|fall risk|falls? a lot|wander\w*|aggressi\w*|combative|medications?|meds|pills?|insulin|prescri\w*|diagnos\w*|surgery|amputat\w*|blind|deaf)\b/i
const BLOCK: Record<string, string> = {
  address: 'Please leave out the address. Caregivers get it in AxisCare once they\'re on the visit.',
  phone: 'Please leave out phone numbers and email addresses.',
  money: 'Please leave out money, banking and passwords.',
  health: 'Please leave out health details like conditions or medicines. Caregivers get what they need from the care plan.',
}
/** The first fixed rule a piece of text trips, or null. */
export function ruleHit(t: string): keyof typeof BLOCK | null {
  if (ADDRESS.test(t)) return 'address'
  if (PHONE.test(t) || EMAIL.test(t)) return 'phone'
  if (MONEY.test(t)) return 'money'
  if (HEALTH.test(t) || NOTE_RULES.slice(0, 3).some((r) => r.re.test(t))) return 'health'
  return null
}

export type FamilyProfile = { about: string | null; work: string | null; talk: string | null; little: string | null; enjoys: string[] }
/** The family's words, cleaned and checked by the fixed rules. field = which box to point at. */
export function cleanFamilyProfile(v: Any): { ok: true; profile: FamilyProfile } | { ok: false; field: string; error: string } {
  const p: FamilyProfile = { about: S(v?.about) || null, work: S(v?.work) || null, talk: S(v?.talk) || null, little: S(v?.little) || null, enjoys: [] }
  const raw = Array.isArray(v?.enjoys) ? v.enjoys : String(v?.enjoys ?? '').split(',')
  p.enjoys = [...new Set(raw.map(S).filter(Boolean))] as string[]
  if ((p.about ?? '').length > ABOUT_MAX) return { ok: false, field: 'about', error: `Please keep About under ${ABOUT_MAX} characters (a few sentences).` }
  for (const q of QUESTIONS) if ((p[q.key] ?? '').length > ANSWER_MAX) return { ok: false, field: q.key, error: `Please keep each answer under ${ANSWER_MAX} characters.` }
  if (p.enjoys.length > ENJOYS_MAX) return { ok: false, field: 'enjoys', error: `Please keep it to ${ENJOYS_MAX} things they enjoy.` }
  if (p.enjoys.some((x) => x.length > ENJOY_LEN)) return { ok: false, field: 'enjoys', error: 'Please keep each thing they enjoy short (a few words).' }
  for (const [field, text] of [['about', p.about], ['work', p.work], ['talk', p.talk], ['little', p.little], ['enjoys', p.enjoys.join(', ')]] as [string, string | null][]) {
    const hit = text ? ruleHit(text) : null
    if (hit) return { ok: false, field, error: BLOCK[hit] }
    if (text && /https?:\/\/|www\./i.test(text)) return { ok: false, field, error: 'Please leave out links.' }
  }
  return { ok: true, profile: p }
}
export const isEmpty = (p: FamilyProfile | null) => !p || (!p.about && !p.work && !p.talk && !p.little && !p.enjoys.length)
/** All the family's words in one piece (for the AI look and for "Use the family's words"). */
export const allText = (p: FamilyProfile) => [p.about, ...QUESTIONS.map((q) => p[q.key] ? `${q.caregiver}: ${p[q.key]}` : null), p.enjoys.length ? `Enjoys: ${p.enjoys.join(', ')}` : null].filter(Boolean).join('\n')

// ── the AI second look ─────────────────────────────────────────────────────────────────
const SYSTEM = 'A family wrote a short, friendly profile of their loved one for the caregivers of a home-care agency. Caregivers ' +
  'read it before visiting. Check it for things that must NOT be in it: health or medical details (conditions, diagnoses, ' +
  'medicines, behaviors such as wandering or aggression), money or banking, addresses, phone numbers, passwords, or anything ' +
  'unkind, embarrassing or inappropriate to show a caregiver. Warm everyday details (hobbies, foods, music, pets, past work, ' +
  'faith, family first names) are fine. Answer ONLY minified JSON: {"ok":true} or {"ok":false,"why":"<one short, kind sentence ' +
  'telling the family what to leave out>"}'
/** null = unavailable (no key, error, timeout): the fixed rules alone decide then. Never throws. */
export async function aiProfileCheck(text: string, key: string, send: typeof fetch = fetch, timeoutMs = AI_TIMEOUT_MS): Promise<{ ok: boolean; why: string } | null> {
  if (!key || !text.trim()) return null
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const r = await send('https://api.anthropic.com/v1/messages', { method: 'POST', signal: ctl.signal,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: AI_MODEL, max_tokens: 120, temperature: 0, system: SYSTEM, messages: [{ role: 'user', content: text.slice(0, 2000) }] }) })
    if (!r.ok) return null
    const j = await r.json().catch(() => null)
    const m = String(j?.content?.[0]?.text ?? '').match(/\{[\s\S]*\}/); if (!m) return null
    const a = JSON.parse(m[0])
    return a.ok === true ? { ok: true, why: '' } : { ok: false, why: String(a.why ?? '').slice(0, 200) || 'Please take out anything private or about health.' }
  } catch { return null } finally { clearTimeout(timer) }
}

// ── the stored row ───────────────────────────────────────────────────────────────────
export function rowToProfile(row: Any | null): FamilyProfile | null {
  if (!row) return null
  const p: FamilyProfile = { about: S(row.about) || null, work: S(row.work) || null, talk: S(row.talk) || null, little: S(row.little) || null,
    enjoys: (Array.isArray(row.enjoys) ? row.enjoys : []).map(S).filter(Boolean).slice(0, ENJOYS_MAX) }
  return isEmpty(p) ? null : p
}
const FIELD_NAMES: Record<string, string> = { about: 'About', work: 'Their work and life', talk: 'Loves to talk about', little: 'Little things', enjoys: 'What they enjoy' }
/** A save: the new row, with what changed (before and after) kept in the history (last 30). */
export function applyFamilySave(row: Any | null, p: FamilyProfile, who: { contact_id: unknown; name: string }, axId: string, now: string, ai: 'checked' | 'unavailable') {
  const before = rowToProfile(row) ?? { about: null, work: null, talk: null, little: null, enjoys: [] }
  const changes: { field: string; before: string | null; after: string | null }[] = []
  for (const k of ['about', 'work', 'talk', 'little'] as const) if ((before[k] ?? null) !== (p[k] ?? null)) changes.push({ field: FIELD_NAMES[k], before: before[k], after: p[k] })
  if (before.enjoys.join('|') !== p.enjoys.join('|')) changes.push({ field: FIELD_NAMES.enjoys, before: before.enjoys.join(', ') || null, after: p.enjoys.join(', ') || null })
  const hist = [...(Array.isArray(row?.history) ? row.history : []), ...(changes.length ? [{ at: now, by: who.name, contact_id: String(who.contact_id), changes, ai }] : [])].slice(-30)
  return { row: { axiscare_client_id: axId, ...p, updated_at: now, updated_by_contact: String(who.contact_id), updated_by_name: who.name, history: hist, ...(row ? {} : { created_at: now }) }, changes }
}
/** "Use the family's words": what goes into the office's About and What they enjoy (an office draft, approved as usual). */
export function familyWordsForOffice(p: FamilyProfile): { about: string; enjoys: string[] } {
  const parts = [p.about, p.work, p.talk, p.little].filter(Boolean) as string[]
  let about = ''
  for (const x of parts) { const next = about ? about + ' ' + x : x; if (next.length > ABOUT_MAX) break; about = next }
  return { about: about || (parts[0] ?? '').slice(0, ABOUT_MAX), enjoys: p.enjoys.slice(0, ENJOYS_MAX) }
}
