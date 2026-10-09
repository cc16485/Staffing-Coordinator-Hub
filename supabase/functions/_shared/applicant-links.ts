// Private applicant links (2026-10-04; Samantha "yes to all" on https://claude.ai/artifact/MQgrEVdZ8Kr65LBLsha1Aq).
// The start-form link and the orientation booking link used to carry the applicant's name, phone and email in the web
// address. Now they carry only a record number, an expiry and a code: an HMAC of (kind, number, expiry) keyed by the
// server-only HUB_JOB_SECRET with its own purpose label (the same design as the call-in and missed clock-in links), so
// only this server can make one and it can re-check any link it made. Links run out after 30 days.
//   start:  https://cc.mo-care.com/start.html?o=<job offer id>&e=<expiry>&t=<code>
//   orient: https://sc.mo-care.com/orientation-booking.html?sessions=<the open sessions>&c=<candidate no.>&e=<expiry>&t=<code>
export const START_BASE = 'https://cc.mo-care.com/start.html'
export const ORIENT_BASE = 'https://sc.mo-care.com/orientation-booking.html'
export const LINK_DAYS = 30
/* SLICE 1a (Samantha approved 2026-10-08): the offer-and-sign link. https://cc.mo-care.com/offer.html?o=<job offer id>&e=<expiry>&t=<code>
   Same code design; the expiry is the OFFER's own expiry (seven business days on the company holiday calendar), passed
   in by the caller, so the link dies with the offer. Nothing sends it yet (Slice 1c). */
export const OFFER_BASE = 'https://cc.mo-care.com/offer.html'
const PURPOSE = 'cc-applicant-link-v1'
export type Kind = 'start' | 'orient' | 'offer'

const enc = new TextEncoder()
const b64url = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
async function hmac(secret: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', enc.encode(PURPOSE + ':' + secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64url(await crypto.subtle.sign('HMAC', k, enc.encode(msg)))
}
export const okId = (kind: Kind, id: unknown) =>
  (kind === 'start' || kind === 'offer') ? /^[0-9a-f-]{8,64}$/i.test(String(id ?? '')) : /^[0-9]{1,12}$/.test(String(id ?? ''))
export function expiry(nowSec = Math.floor(Date.now() / 1000)): number { return nowSec + LINK_DAYS * 86400 }

export async function sign(secret: string, kind: Kind, id: string, exp: number): Promise<string> {
  return hmac(secret, `${kind}|${id}|${exp}`)
}
export async function makeStartLink(secret: string, offerId: string, exp = expiry()): Promise<string> {
  const t = await sign(secret, 'start', offerId, exp)
  return `${START_BASE}?o=${encodeURIComponent(offerId)}&e=${exp}&t=${t}`
}
/** The offer link: exp = the offer's expiry (seconds), never longer than LINK_DAYS from now. */
export async function makeOfferLink(secret: string, offerId: string, exp: number): Promise<string> {
  const cap = expiry()
  const e = Number.isInteger(exp) && exp > 0 && exp <= cap ? exp : cap
  const t = await sign(secret, 'offer', offerId, e)
  return `${OFFER_BASE}?o=${encodeURIComponent(offerId)}&e=${e}&t=${t}`
}
export async function makeOrientLink(secret: string, candidateId: string, sessions: string, exp = expiry()): Promise<string> {
  const t = await sign(secret, 'orient', candidateId, exp)
  return `${ORIENT_BASE}?sessions=${encodeURIComponent(sessions)}&c=${encodeURIComponent(candidateId)}&e=${exp}&t=${t}`
}
/** Constant-time check. at: the moment it must still be valid (now, or when a start form was sent). False for anything
 *  missing, malformed, expired or forged. */
export async function checkLink(secret: string, kind: Kind, id: unknown, exp: unknown, t: unknown, atSec = Math.floor(Date.now() / 1000)): Promise<boolean> {
  const i = String(id ?? ''), e = Number(exp), s = String(t ?? '')
  if (!secret || secret.length < 32) return false
  if (!okId(kind, i) || !Number.isInteger(e) || !/^[A-Za-z0-9_-]{43}$/.test(s)) return false
  if (e < atSec) return false
  const want = await sign(secret, kind, i, e)
  if (want.length !== s.length) return false
  let d = 0
  for (let k = 0; k < want.length; k++) d |= want.charCodeAt(k) ^ s.charCodeAt(k)
  return d === 0
}
