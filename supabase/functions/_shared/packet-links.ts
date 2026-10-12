// Care packet links (Step 1, 2026-10-12). Each caregiver gets their OWN link to one client's care packet. The link names a
// recipient row (pl_ + 20 random letters, never the caregiver's name or phone), carries an expiry, and an HMAC of both keyed
// by the server-only HUB_JOB_SECRET with its own purpose label, so the server can re-check any link it made and nobody can
// make one. Making a new link for the same caregiver keeps the same row and gives a fresh expiry.
export const LINK_BASE = 'https://cc.mo-care.com/packet.html'
const PURPOSE = 'cc-care-packet-link-v1'
export const LINK_DAYS = 90

const enc = new TextEncoder()
const b64url = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function hmac(secret: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', enc.encode(PURPOSE + ':' + secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64url(await crypto.subtle.sign('HMAC', k, enc.encode(msg)))
}
export const RECIPIENT_ID = /^pl_[A-Za-z0-9]{20}$/
export function newRecipientId(): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789', b = crypto.getRandomValues(new Uint8Array(20))
  return 'pl_' + [...b].map((x) => abc[x % abc.length]).join('')
}
export const linkExpiry = (nowSec = Math.floor(Date.now() / 1000)) => nowSec + LINK_DAYS * 86400
export async function makeLink(secret: string, recipientId: string, exp: number): Promise<string> {
  const t = await hmac(secret, `${recipientId}|${exp}`)
  return `${LINK_BASE}?i=${encodeURIComponent(recipientId)}&e=${exp}&t=${t}`
}
/** Constant-time check of a link's parts. False for anything missing, malformed, expired or forged. */
export async function checkLink(secret: string, p: { i?: unknown; e?: unknown; t?: unknown }, nowSec = Math.floor(Date.now() / 1000)): Promise<boolean> {
  const i = String(p.i ?? ''), e = Number(p.e), t = String(p.t ?? '')
  if (!secret || secret.length < 32) return false
  if (!RECIPIENT_ID.test(i) || !Number.isInteger(e) || !/^[A-Za-z0-9_-]{43}$/.test(t)) return false
  if (e < nowSec) return false
  const want = await hmac(secret, `${i}|${e}`)
  if (want.length !== t.length) return false
  let d = 0
  for (let k = 0; k < want.length; k++) d |= want.charCodeAt(k) ^ t.charCodeAt(k)
  return d === 0
}
