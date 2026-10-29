// PRN STEP 5a (2026-10-29) · the personal link to a PRN member's PRN Team page. One member (their Hub applicant id), one expiry:
// an HMAC of (applicant id, expiry) keyed by the server-only HUB_JOB_SECRET with its own purpose label, the same way the My Hours
// link works (prn-links.ts), so only the server can make one and it can re-check any it made. The link names the member and
// nothing else about them. It lasts 30 days; each text that carries it gets a fresh one.
export const PAGE_BASE = 'https://cc.mo-care.com/prn.html'
const PURPOSE = 'cc-prn-team-page-link-v1'
export const PAGE_LINK_DAYS = 30
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const enc = new TextEncoder()
const b64url = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
async function hmac(secret: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', enc.encode(PURPOSE + ':' + secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64url(await crypto.subtle.sign('HMAC', k, enc.encode(msg)))
}
export function pageExpiry(nowSec = Math.floor(Date.now() / 1000)): number { return nowSec + PAGE_LINK_DAYS * 86400 }
export async function makePageLink(secret: string, applicantId: string, exp: number): Promise<string> {
  if (!UUID.test(applicantId)) throw new Error('bad id')
  const t = await hmac(secret, `${applicantId.toLowerCase()}|${exp}`)
  return `${PAGE_BASE}?p=${applicantId.toLowerCase()}&e=${exp}&t=${t}`
}
/** Constant-time check. False for anything missing, malformed, expired or forged. */
export async function checkPageLink(secret: string, q: { p?: unknown; e?: unknown; t?: unknown }, nowSec = Math.floor(Date.now() / 1000)): Promise<boolean> {
  const p = String(q.p ?? '').toLowerCase(), e = Number(q.e), t = String(q.t ?? '')
  if (!secret || secret.length < 32) return false
  if (!UUID.test(p) || !Number.isInteger(e) || !/^[A-Za-z0-9_-]{43}$/.test(t)) return false
  if (e < nowSec) return false
  const want = await hmac(secret, `${p}|${e}`)
  if (want.length !== t.length) return false
  let d = 0
  for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ t.charCodeAt(i)
  return d === 0
}
