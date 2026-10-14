// =============================================================================
// positions.ts · LPN HIRING (Samantha approved the LPN nurse visit plan, 2026-10-14). The position on an offer, as a key.
// =============================================================================
// job_offers.position_key (Training Platform project) is set ONCE at Save Offer from the Hub's position choice and never
// changed (a trigger refuses it, like the onboarding path). Offers saved before this have no key (null) and keep today's
// behaviour exactly: a null key is treated as a caregiver offer everywhere.
//   positionKeyOf(text)   the mapping helper for the free-text position ("LPN", "Licensed Practical Nurse", "CNA", ...)
//   letterOnly(o)         an LPN or RN offer signs the offer LETTER ONLY online (their job description, the RN supervision
//                         acknowledgment and the documentation expectations are in the Viventium Step 2 LPN packet)
//   offerSigned(o)        THE ONE "offer signed" rule: the letter, plus the caregiver position description unless the offer
//                         is letter-only. For every offer without an LPN or RN key this is exactly the old rule
//                         (offer_signed_at && pd_signed_at), so every existing caregiver offer reads the same.
//   offerSignedAt(o)      when it became fully signed (the position description's time for a caregiver, the letter's for a nurse)
// The Training Platform keeps a byte-identical copy (supabase/functions/_shared/positions.ts there); a test compares them.
// Care Coordinator: the key is stored, nothing else about a coordinator changes (not approved yet).
export const POSITION_KEYS = ['caregiver', 'cna', 'lpn', 'rn', 'care_coordinator'] as const
export type PositionKey = typeof POSITION_KEYS[number]
export const POSITION_LABELS: Record<PositionKey, string> = { caregiver: 'Caregiver', cna: 'CNA', lpn: 'Licensed Practical Nurse (LPN)', rn: 'Registered Nurse (RN)', care_coordinator: 'Care Coordinator' }
/** a stored key, checked; anything else is null */
export function validKey(v: unknown): PositionKey | null {
  const k = String(v ?? '').trim().toLowerCase()
  return (POSITION_KEYS as readonly string[]).includes(k) ? k as PositionKey : null
}
/** The mapping helper for the free-text position. Unknown text (for example "Office") is null: today's behaviour. */
export function positionKeyOf(text: unknown): PositionKey | null {
  const t = String(text ?? '').trim()
  if (!t) return null
  const k = validKey(t.replace(/[\s-]+/g, '_')); if (k) return k
  if (/\bL\.?P\.?N\.?\b|licensed\s+practical|licensed\s+vocational|\bLVN\b/i.test(t)) return 'lpn'
  if (/\bR\.?N\.?\b|registered\s+nurse/i.test(t)) return 'rn'
  if (/\bC\.?N\.?A\.?\b|certified\s+nurs(e|ing)\s+(assistant|aide)/i.test(t)) return 'cna'
  if (/coordinator/i.test(t)) return 'care_coordinator'
  if (/caregiver|companion|personal\s+care|home\s*care|\bPCA\b|\baide\b/i.test(t)) return 'caregiver'
  return null
}
/** LPN or RN: a licensed nurse */
export const isLicensedNurse = (key: unknown): boolean => { const k = validKey(key); return k === 'lpn' || k === 'rn' }
// deno-lint-ignore no-explicit-any
export const letterOnly = (o: any): boolean => !!o && isLicensedNurse(o.position_key)
/** THE "offer signed" rule (see the header). */
// deno-lint-ignore no-explicit-any
export const offerSigned = (o: any): boolean => !!(o && o.offer_signed_at && (o.pd_signed_at || letterOnly(o)))
// deno-lint-ignore no-explicit-any
export const offerSignedAt = (o: any): string | null => !offerSigned(o) ? null : String(letterOnly(o) && !o.pd_signed_at ? o.offer_signed_at : o.pd_signed_at)
/** The Viventium Step 2 packet tick for a licensed nurse: one line naming the documents (they are signed together in Viventium). */
export const packetLine = (key: unknown): string => validKey(key) === 'rn'
  ? 'RN packet signed in Viventium: RN job description and the nursing documentation expectations'
  : 'LPN packet signed in Viventium: LPN job description, RN supervision acknowledgment and the nursing documentation expectations'
