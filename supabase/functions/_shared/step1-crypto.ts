// step1-crypto.ts · the lock on the three identity fields (section 19). AES-256-GCM in the function, with a key that lives
// only as a function secret (STEP1_KEK, 32 random bytes, base64) and never in the database: the database holds ciphertext
// and the last four digits, nothing else. Decryption happens only in the reveal action, which logs who, when and why.
//
// THE REVEAL RULES (Samantha, 2026-10-09, decision 6; the reveal action itself is built in Slice 2c and must follow these):
//   who     only a person on the Admin page's "Screening staff" list (onboarding-permissions kind 'screening'), checked by
//           person_id on the server; not every office user, and not an owner by title.
//   how long the answer carries the value once, for one screen, and it expires after REVEAL_TTL_MS; nothing is cached.
//   audited every reveal writes document_access_log (doc = 'identity', which field, who, when, the reason typed) and bumps
//           step1_identity.reveals; the value itself is never written anywhere.
//   never   the Hub keeps a revealed value only in the open page's memory: never localStorage, sessionStorage, IndexedDB, a
//           cookie, a URL, a console line or a server log. The function never logs plaintext either (REVEAL_NEVER_LOG).
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
async function key(kek: string): Promise<CryptoKey> {
  const raw = unb64(kek); if (raw.length !== 32) throw new Error('STEP1_KEK must be 32 bytes, base64')
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}
/** "v1." + base64(iv) + "." + base64(ciphertext); the offer id is bound as additional data so a value cannot be moved between people. */
export async function seal(kek: string, offerId: string, plain: string): Promise<string> {
  const k = await key(kek), iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(offerId) }, k, new TextEncoder().encode(plain))
  return `v1.${b64(iv)}.${b64(new Uint8Array(ct))}`
}
export async function open(kek: string, offerId: string, sealed: string): Promise<string> {
  const [v, iv, ct] = String(sealed).split('.'); if (v !== 'v1' || !iv || !ct) throw new Error('not a sealed value')
  const k = await key(kek)
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: new TextEncoder().encode(offerId) }, k, unb64(ct))
  return new TextDecoder().decode(plain)
}
export const last4 = (s: string) => String(s).replace(/\W/g, '').slice(-4)
export const digitsOnly = (s: string) => String(s).replace(/\D/g, '')
/** A Social Security number as typed: nine digits, not all one digit, not the well-known invalid ranges. */
export function ssnLooksValid(s: string): boolean {
  const d = digitsOnly(s); if (d.length !== 9) return false
  if (/^(\d)\1{8}$/.test(d) || d === '123456789' || d.startsWith('000') || d.startsWith('666') || d.startsWith('9') || d.slice(3, 5) === '00' || d.slice(5) === '0000') return false
  return true
}

/** Decision 6: how long a revealed value may stay on a screening staff member's screen. Five minutes. */
export const REVEAL_TTL_MS = 5 * 60 * 1000
/** Which sealed fields may be revealed, each on its own request, never all at once. */
export const REVEAL_FIELDS = ['ssn', 'dob', 'license'] as const
export type RevealField = typeof REVEAL_FIELDS[number]
/** The permission list that gates a reveal (see _shared/onboarding-permissions.ts). */
export const REVEAL_PERMISSION = 'screening' as const
/** Where a revealed value may live in the browser: the open page's memory only. Named so a test can hold 2c to it. */
export const REVEAL_BROWSER_STORAGE_ALLOWED = false
export const REVEAL_NEVER_LOG = true
