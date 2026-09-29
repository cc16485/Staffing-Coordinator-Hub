// PRN4 (2026-09-29) · the personal link in a PRN CNA's 60-day availability check-in text.
// One caregiver, one expiry: an HMAC of (their AxisCare caregiver number, expiry) keyed by the server-only
// HUB_JOB_SECRET with its own purpose label, so only the server can make one and it can re-check any it made.
// The link carries the caregiver number and nothing else about them.
export const AVAIL_BASE = 'https://cc.mo-care.com/availability.html'
const PURPOSE = 'cc-prn-availability-link-v1'
export const LINK_DAYS = 21

const enc = new TextEncoder()
const b64url = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
async function hmac(secret: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', enc.encode(PURPOSE + ':' + secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64url(await crypto.subtle.sign('HMAC', k, enc.encode(msg)))
}
export function availExpiry(nowSec = Math.floor(Date.now() / 1000)): number { return nowSec + LINK_DAYS * 86400 }
export async function makeAvailLink(secret: string, axid: string, exp: number): Promise<string> {
  const t = await hmac(secret, `${axid}|${exp}`)
  return `${AVAIL_BASE}?c=${encodeURIComponent(axid)}&e=${exp}&t=${t}`
}
/** Constant-time check. False for anything missing, malformed, expired or forged. */
export async function checkAvailLink(secret: string, p: { c?: unknown; e?: unknown; t?: unknown }, nowSec = Math.floor(Date.now() / 1000)): Promise<boolean> {
  const c = String(p.c ?? ''), e = Number(p.e), t = String(p.t ?? '')
  if (!secret || secret.length < 32) return false
  if (!/^\d{1,12}$/.test(c) || !Number.isInteger(e) || !/^[A-Za-z0-9_-]{43}$/.test(t)) return false
  if (e < nowSec) return false
  const want = await hmac(secret, `${c}|${e}`)
  if (want.length !== t.length) return false
  let d = 0
  for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ t.charCodeAt(i)
  return d === 0
}
