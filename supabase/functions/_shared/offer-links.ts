// The personal link in a family-visit offer text (family-offer, 2026-10-16). One offer, one expiry (the end of the visit
// day): an HMAC of (offer id, expiry) keyed by the server-only HUB_JOB_SECRET with its own purpose label, the same way
// the PRN availability link works (prn-links.ts). The link names only the offer.
export const OFFER_BASE = 'https://cc.mo-care.com/visit-offer.html'
const PURPOSE = 'cc-family-visit-offer-link-v1'
const enc = new TextEncoder()
const b64url = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
async function hmac(secret: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', enc.encode(PURPOSE + ':' + secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64url(await crypto.subtle.sign('HMAC', k, enc.encode(msg)))
}
export async function makeOfferLink(secret: string, offerId: string, exp: number): Promise<string> {
  const t = await hmac(secret, `${offerId}|${exp}`)
  return `${OFFER_BASE}?o=${encodeURIComponent(offerId)}&e=${exp}&t=${t}`
}
/** Constant-time check. False for anything missing, malformed, expired or forged. */
export async function checkOfferLink(secret: string, p: { o?: unknown; e?: unknown; t?: unknown }, nowSec = Math.floor(Date.now() / 1000)): Promise<boolean> {
  const o = String(p.o ?? ''), e = Number(p.e), t = String(p.t ?? '')
  if (!secret || secret.length < 32) return false
  if (!/^[0-9a-f-]{36}$/i.test(o) || !Number.isInteger(e) || !/^[A-Za-z0-9_-]{43}$/.test(t)) return false
  if (e < nowSec) return false
  const want = await hmac(secret, `${o}|${e}`)
  if (want.length !== t.length) return false
  let d = 0
  for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ t.charCodeAt(i)
  return d === 0
}
