// C1 (2026-09-29) · the per-admin link in a missed clock-in text.
// Each admin's text carries a link that works for ONE missed clock-in, for THAT admin, until it expires (the end of
// the next day, Central). Nothing is stored in plain form: the link's code is an HMAC of (alert, admin, expiry) keyed
// by the server-only HUB_JOB_SECRET with its own purpose label, so the server can re-check any link it made and
// nobody can make one. The admin is named in the link by a short one-way code of their email, never the email.
export const LINK_BASE = 'https://cc.mo-care.com/clockin.html'
const PURPOSE = 'cc-missed-clockin-link-v1'

const enc = new TextEncoder()
const b64url = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')

async function hmac(secret: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', enc.encode(PURPOSE + ':' + secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64url(await crypto.subtle.sign('HMAC', k, enc.encode(msg)))
}
/** A short one-way code for an admin's email (so the link never carries the email). */
export async function adminKey(email: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(PURPOSE + ':' + String(email).trim().toLowerCase()))).slice(0, 16)
}
/** Link expiry: the end of the day after the shift, Central (as epoch seconds). */
export function linkExpiry(shiftDate: string): number {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(shiftDate) ? shiftDate : new Date().toISOString().slice(0, 10)
  return Math.floor(Date.parse(d + 'T00:00:00Z') / 1000) + 2 * 86400 + 6 * 3600   // 23:59:59 next day CDT/CST, give or take an hour
}
export async function makeLink(secret: string, alertId: string, email: string, exp: number): Promise<string> {
  const a = await adminKey(email)
  const t = await hmac(secret, `${alertId}|${a}|${exp}`)
  return `${LINK_BASE}?c=${encodeURIComponent(alertId)}&a=${a}&e=${exp}&t=${t}`
}
/** Constant-time check of a link's parts. Returns false for anything missing, malformed, expired or forged. */
export async function checkLink(secret: string, p: { c?: unknown; a?: unknown; e?: unknown; t?: unknown }, nowSec = Math.floor(Date.now() / 1000)): Promise<boolean> {
  const c = String(p.c ?? ''), a = String(p.a ?? ''), e = Number(p.e), t = String(p.t ?? '')
  if (!secret || secret.length < 32) return false
  if (!/^tk_[A-Za-z0-9_]{1,80}$/.test(c) || !/^[0-9a-f]{16}$/.test(a) || !Number.isInteger(e) || !/^[A-Za-z0-9_-]{43}$/.test(t)) return false
  if (e < nowSec) return false
  const want = await hmac(secret, `${c}|${a}|${e}`)
  if (want.length !== t.length) return false
  let d = 0
  for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ t.charCodeAt(i)
  return d === 0
}
