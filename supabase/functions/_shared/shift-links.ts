// The personal link to a Cara shift opportunity page (Samantha, 2026-10-24). One ask (one caregiver, one shift), one expiry
// (the end of the shift day, Central): an HMAC of (case id, ask id, expiry) keyed by the server-only HUB_JOB_SECRET with its
// own purpose label, the same way the family app's offer link works (offer-links.ts). The link names only the case and the
// ask; nothing about the client is in it, and opening it shows nothing about the client until the caregiver enters the
// one-time code texted to the phone that got the offer (shift-offer).
export const SHIFT_BASE = 'https://cc.mo-care.com/shift.html'
const PURPOSE = 'cc-cara-shift-page-link-v1'
const enc = new TextEncoder()
const b64url = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const ID = /^[A-Za-z0-9_-]{1,100}$/
async function hmac(secret: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', enc.encode(PURPOSE + ':' + secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64url(await crypto.subtle.sign('HMAC', k, enc.encode(msg)))
}
/** The end of a shift day in Central time, as unix seconds (the link's expiry). */
export function shiftDayEnd(ymd: string): number {
  if (!/^\d{4}-\d\d-\d\d$/.test(String(ymd || ''))) return Math.floor(Date.now() / 1000) + 86400
  /* 05:00 UTC the next day = midnight Central in daylight time, 11pm in standard time: never later than the day's end */
  const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)
  return Math.floor(d.getTime() / 1000) + 5 * 3600
}
export async function makeShiftLink(secret: string, caseId: string, askId: string, exp: number): Promise<string> {
  if (!ID.test(caseId) || !ID.test(askId)) throw new Error('bad ids')
  const t = await hmac(secret, `${caseId}|${askId}|${exp}`)
  return `${SHIFT_BASE}?c=${encodeURIComponent(caseId)}&a=${encodeURIComponent(askId)}&e=${exp}&t=${t}`
}
/** Constant-time check. False for anything missing, malformed, expired or forged. */
export async function checkShiftLink(secret: string, p: { c?: unknown; a?: unknown; e?: unknown; t?: unknown }, nowSec = Math.floor(Date.now() / 1000)): Promise<boolean> {
  const c = String(p.c ?? ''), a = String(p.a ?? ''), e = Number(p.e), t = String(p.t ?? '')
  if (!secret || secret.length < 32) return false
  if (!ID.test(c) || !ID.test(a) || !Number.isInteger(e) || !/^[A-Za-z0-9_-]{43}$/.test(t)) return false
  if (e < nowSec) return false
  const want = await hmac(secret, `${c}|${a}|${e}`)
  if (want.length !== t.length) return false
  let d = 0
  for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ t.charCodeAt(i)
  return d === 0
}
