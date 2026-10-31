// ON CALL FOR OUR CAREGIVERS (2026-10-30, C3) · the personal link to a caregiver's "My on-call" page. One caregiver (their AxisCare
// id), one expiry: an HMAC of (AxisCare id, expiry) keyed by the server-only HUB_JOB_SECRET with its own purpose label, the same
// way the PRN Team page link works (prn-page-links.ts), so only the server can make one and it can re-check any it made. The link
// names the caregiver and nothing else about them. It lasts 30 days; each invite gets a fresh one.
export const ONCALL_BASE = 'https://cc.mo-care.com/oncall.html'
const PURPOSE = 'cc-oncall-page-link-v1'
export const ONCALL_LINK_DAYS = 30
const AX = /^[0-9]{1,12}$/

const enc = new TextEncoder()
const b64url = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
async function hmac(secret: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', enc.encode(PURPOSE + ':' + secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64url(await crypto.subtle.sign('HMAC', k, enc.encode(msg)))
}
export function oncallExpiry(nowSec = Math.floor(Date.now() / 1000)): number { return nowSec + ONCALL_LINK_DAYS * 86400 }
export async function makeOncallLink(secret: string, ax: string, exp: number): Promise<string> {
  if (!AX.test(ax)) throw new Error('bad id')
  const t = await hmac(secret, `${ax}|${exp}`)
  return `${ONCALL_BASE}?c=${ax}&e=${exp}&t=${t}`
}
/** Constant-time check. False for anything missing, malformed, expired or forged. */
export async function checkOncallLink(secret: string, q: { c?: unknown; e?: unknown; t?: unknown }, nowSec = Math.floor(Date.now() / 1000)): Promise<boolean> {
  const c = String(q.c ?? ''), e = Number(q.e), t = String(q.t ?? '')
  if (!secret || secret.length < 32) return false
  if (!AX.test(c) || !Number.isInteger(e) || !/^[A-Za-z0-9_-]{43}$/.test(t)) return false
  if (e < nowSec) return false
  const want = await hmac(secret, `${c}|${e}`)
  if (want.length !== t.length) return false
  let d = 0
  for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ t.charCodeAt(i)
  return d === 0
}
