// =============================================================================
// agreement-links · Client Care Agreement, Stage 3: signing from home (874, Samantha 2026-10-17: "start stage 3"; her
// answers "Office picks each time", "6-digit code", "7 days", and "Any time" for the code).
//  * The office sends a link (text, email or both, 8am to 6pm, through GoHighLevel and the family audience gate, on the
//    office person's tap). The link opens ONE agreement and nothing else; it works for 7 days, until it is signed, or
//    until the office cancels it. Only a hash of the link's secret is stored.
//  * Opening it asks for a 6-digit code sent to the same phone or email the link went to (the person taps "Send me a
//    code"; it goes at any hour, her answer). The code works for 10 minutes and 5 tries; at most 6 codes per link.
//    A good code opens a 2-hour signing session. The code check is recorded on the signature record page.
//  * After they sign, Needs Attention gets "signed from home: countersign" for the client care team.
// No timed reminders to the family (her rule): the card shows sent / opened / code checked / signed instead.
// =============================================================================
import { contactForOutbound, maySend } from './outreach.ts'
import { ghlSendChecked, reportSendProblem, ownerFor } from './send-problems.ts'

// deno-lint-ignore no-explicit-any
type Any = any
export const LINK_DAYS = 7, CODE_MINUTES = 10, CODE_TRIES = 5, CODE_SENDS = 6, CODE_GAP_SECONDS = 45, SESSION_HOURS = 2
export const SIGN_PAGE = 'https://cc.mo-care.com/sign.html'
const enc = new TextEncoder()
export async function sha256(s: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', enc.encode(s)); return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
/** 32 random bytes as URL-safe text: the link's secret (and the session's). */
export function secret(): string {
  const b = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export const SECRET_OK = /^[A-Za-z0-9_-]{40,60}$/
export function sixDigits(): string { const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000; return String(n).padStart(6, '0') }
export const codeHash = (linkId: string, code: string) => sha256(linkId + ':' + code)
export const digits = (p: unknown) => String(p ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export function maskPhone(p: unknown): string { const d = digits(p); return d.length === 10 ? `(${d.slice(0, 3)}) ***-${d.slice(6)}` : '***' }
export function maskEmail(e: unknown): string { const [u, h] = String(e ?? '').split('@'); return u && h ? `${u[0]}${'*'.repeat(Math.max(2, Math.min(u.length - 1, 6)))}@${h}` : '***' }
const first = (n: unknown) => String(n ?? '').trim().split(/\s+/)[0] || ''
const esc = (s: string) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** Her family voice: warm, plain. The secret rides after # so it never reaches a server log or a referrer. */
export function linkMessages(p: { toName: string; clientName: string; url: string; expires: string }) {
  const hi = first(p.toName), client = String(p.clientName || '').trim()
  return {
    sms: `Hi ${hi || 'there'}, this is Caring Companions. Here is the Client Care Agreement${client ? ' for ' + client : ''} to look over and sign: ${p.url} The link works until ${p.expires}. Questions? Call us at (417) 234-8494.`,
    subject: 'Your Client Care Agreement to sign',
    html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#1f2a36"><p>Hi ${esc(hi || 'there')},</p>`
      + `<p>Here is the Client Care Agreement${client ? ' for ' + esc(client) : ''} to look over and sign. It takes about 10 minutes, and you can type into any blank.</p>`
      + `<p><a href="${esc(p.url)}" style="display:inline-block;background:#1F7A8C;color:#fff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:10px">Open the agreement</a></p>`
      + `<p>The link works until ${esc(p.expires)}. When you open it, we'll send you a 6-digit code to make sure it's you.</p>`
      + `<p>Questions? Call us at (417) 234-8494.</p><p style="color:#57606a">Caring Companions In-Home Senior Care<br>(417) 234-8494</p></div>`,
  }
}
export const codeMessages = (code: string) => ({
  sms: `Your Caring Companions code is ${code}. It works for ${CODE_MINUTES} minutes. If you didn't ask for it, you can ignore this.`,
  subject: `Your Caring Companions code: ${code}`,
  html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#1f2a36"><p>Your code to open the Client Care Agreement is</p>`
    + `<p style="font-size:28px;font-weight:bold;letter-spacing:4px">${code}</p><p>It works for ${CODE_MINUTES} minutes. If you didn't ask for it, you can ignore this email.</p>`
    + `<p style="color:#57606a">Caring Companions In-Home Senior Care<br>(417) 234-8494</p></div>`,
})

export type SendOne = { channel: 'sms' | 'email'; outcome: 'sent' | 'held' | 'refused' | 'failed'; detail: string }
/** One family message through the audience gate and GoHighLevel. kind decides the hours. Never throws. */
export async function sendFamily(db: Any, ghl: { token: string; locationId: string }, p: {
  channel: 'sms' | 'email'; phone?: string; email?: string; toName: string; sender: string; kind: 'reactive_external' | 'requested_external'
  sms: string; subject: string; html: string; now?: Date }, f: typeof fetch = fetch, gate: typeof contactForOutbound = contactForOutbound): Promise<SendOne> {
  const addr = p.channel === 'sms' ? p.phone : p.email
  if (!ghl.token || !ghl.locationId) { await reportSendProblem(db, { sender: p.sender, channel: p.channel, address: addr, who: p.toName, reasons: ['GoHighLevel is not set up for the Hub'], failed: true }); return { channel: p.channel, outcome: 'failed', detail: 'GoHighLevel is not set up for the Hub.' } }
  const hours = maySend(p.kind, p.now ?? new Date())
  if (!hours.allowed) return { channel: p.channel, outcome: 'held', detail: 'Texts and emails to families go between 8am and 6pm Central. Send it then.' }
  const dest = await gate(db, ghl, p.channel === 'sms' ? { phone: p.phone, firstName: first(p.toName) } : { email: p.email, firstName: first(p.toName) }, p.kind,
    { audience: 'family', humanInitiated: true, channel: p.channel, sender: p.sender, now: p.now })
  if (!dest) return { channel: p.channel, outcome: 'refused', detail: `Not sent by ${p.channel === 'sms' ? 'text' : 'email'}: they opted out, or the ${p.channel === 'sms' ? 'number' : 'address'} could not be used. It is in Needs Attention.` }
  const headers = { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' }
  const ok = await ghlSendChecked(db, headers, p.sender, { channel: p.channel, contactId: dest.contactId, address: addr, who: p.toName },
    p.channel === 'sms' ? { message: p.sms } : { subject: p.subject, html: p.html }, f)
  return ok ? { channel: p.channel, outcome: 'sent', detail: p.channel === 'sms' ? 'Texted.' : 'Emailed.' } : { channel: p.channel, outcome: 'failed', detail: 'GoHighLevel refused it. It is in Needs Attention.' }
}

/** Needs Attention: "<name> signed the Client Care Agreement from home: countersign it." Never throws. */
export async function raiseCountersignCard(db: Any, c: { agreementId: string; clientName: string; signer: string; ax: string; leadId?: string | null }): Promise<void> {
  try {
    const id = 'ops_agreement_countersign_' + c.agreementId.replace(/-/g, '').slice(0, 16)
    const now = new Date().toISOString()
    const { data: row } = await db.from('app_data').select('data').eq('key', 'ops_items').maybeSingle()
    const items: Any[] = Array.isArray(row?.data) ? row.data : []
    const prev = items.find((x) => x && x.id === id)
    if (prev && (prev.status === 'done' || prev.status === 'resolved')) return
    const item = { ...(prev ?? { owner: await ownerFor(db, 'client_care'), owner_name: '', created_at: now, first_at: now }),
      id, kind: 'agreement_countersign', domain: 'client_care', status: 'open', urgency: 'today',
      title: `${c.signer || 'The family'} signed the Client Care Agreement from home`,
      detail: c.ax ? `Countersign it for ${c.clientName || 'the client'} (AxisCare #${c.ax}): open the client in the Hub, Start of Care, Client Care Agreement, Countersign. Their copy can be emailed when you countersign.`
        : `Countersign it for ${c.clientName || 'the client'} (not in AxisCare yet): open their lead in the Hub, Client Care Agreement, Countersign. Their copy can be emailed when you countersign.`,
      who: c.clientName || '', agreement_id: c.agreementId, ...(c.ax ? { client_ax: c.ax } : c.leadId ? { lead_id: c.leadId } : {}), last_at: now,
      due: prev?.due || new Date(Date.now() + 24 * 3_600_000).toISOString(), closed_at: null, closed_by: null, close_note: null, resolved_at: null,
      created_by: 'agreement-sign', opened_by: 'agreement-sign' }
    await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item })
  } catch (e) { console.warn('[agreement-links] could not raise the countersign card: ' + String(e).slice(0, 160)) }
}

/** What the Hub card shows about a link: never the secret, never a code. */
export function linkView(l: Any) {
  if (!l) return null
  return { id: l.id, to_name: l.to_name, to_phone: l.to_phone ? maskPhone(l.to_phone) : null, to_email: l.to_email ? maskEmail(l.to_email) : null,
    channels: l.channels, sent: l.sent, sent_by: l.sent_by, created_at: l.created_at, expires_at: l.expires_at, opened_at: l.opened_at,
    verified_at: l.verified_at, verified_via: l.verified_via, signed_at: l.signed_at, revoked_at: l.revoked_at, revoked_by: l.revoked_by,
    live: !l.revoked_at && !l.signed_at && Date.parse(l.expires_at) > Date.now() }
}
