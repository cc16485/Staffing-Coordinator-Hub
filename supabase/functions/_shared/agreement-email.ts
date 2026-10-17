// =============================================================================
// agreement-email · emails the family their copy of the signed Client Care Agreement (873, Samantha 2026-10-16: "the
// client, or primary contact gets emailed a copy right after they sign"; her answer "At countersign").
// Only on an office person's tap (the countersign screen's "Email a copy", or the card's "Email the family's copy"), so it
// is a human-initiated family send through the audience gate (contactForOutbound, audience 'family', channel 'email').
// Sent through GoHighLevel (BAA signed; Resend has none): the PDF is uploaded as a secure email attachment, then sent.
// Outside email hours (8am to 6pm Central) it is held and says so; the card's button sends it later.
// Every refusal or failure is returned plainly and raised in Needs Attention (NO SILENT FAILURES). Never throws.
// =============================================================================
import { contactForOutbound, maySend } from './outreach.ts'
import { ghlSendChecked, reportSendProblem } from './send-problems.ts'

// deno-lint-ignore no-explicit-any
type Any = any
export type CopyResult = { outcome: 'sent' | 'held' | 'refused' | 'failed'; detail: string; to: string }
export const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const esc = (s: string) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const first = (n: string) => String(n || '').trim().split(/\s+/)[0] || ''

/** Her family voice: warm, plain, no sales. */
export function copyEmail(p: { toName: string; clientName: string }) {
  const hi = first(p.toName), client = String(p.clientName || '').trim(), cf = first(client)
  return {
    subject: 'Your signed Client Care Agreement',
    html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#1f2a36">`
      + `<p>Hi ${esc(hi || 'there')},</p>`
      + `<p>Thank you for choosing Caring Companions. Attached is your copy of the Client Care Agreement${client ? ` for ${esc(client)}` : ''}. Please keep it with your Client Handbook.</p>`
      + `<p>If you have any questions, just call us at (417) 234-8494.${cf ? ` We're glad to be part of ${esc(cf)}'s care.` : ''}</p>`
      + `<p style="color:#57606a">Caring Companions In-Home Senior Care<br>(417) 234-8494</p></div>`,
  }
}

export async function emailSignedCopy(db: Any, ghl: { token: string; locationId: string },
  p: { to: string; toName: string; clientName: string; pdf: Uint8Array; filename: string; now?: Date },
  deps: { fetch?: typeof fetch; gate?: typeof contactForOutbound } = {}): Promise<CopyResult> {
  const to = String(p.to || '').trim(), f = deps.fetch ?? fetch, gate = deps.gate ?? contactForOutbound
  const report = async (why: string) => { await reportSendProblem(db, { sender: 'client-agreement', channel: 'email', address: to, who: p.toName, reasons: [why], failed: true }) }
  if (!EMAIL_OK.test(to)) return { outcome: 'refused', detail: 'That email address does not look right.', to }
  if (!ghl.token || !ghl.locationId) { await report('GoHighLevel is not set up for the Hub'); return { outcome: 'failed', detail: 'GoHighLevel is not set up for the Hub, so the email was not sent.', to } }
  const hours = maySend('reactive_external', p.now ?? new Date())
  if (!hours.allowed) return { outcome: 'held', detail: 'Not sent: it is outside email hours (8am to 6pm Central). Use "Email the family\'s copy" on the client\'s card tomorrow.', to }
  if (p.pdf.byteLength > 5 * 1024 * 1024) { await report('the signed PDF is over GoHighLevel\'s 5 MB attachment limit'); return { outcome: 'failed', detail: 'The PDF is too big to attach (over 5 MB). Print their copy instead, and tell Samantha.', to } }
  const dest = await gate(db, ghl, { email: to, firstName: first(p.toName) }, 'reactive_external',
    /* a family send, allowed because an office person tapped Countersign or "Email the family's copy" */
    { audience: 'family', humanInitiated: true, channel: 'email', sender: 'client-agreement', now: p.now })
  if (!dest) return { outcome: 'refused', detail: 'Not sent: this address has opted out of email or could not be used. It is in Needs Attention.', to }
  const headers = { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', Accept: 'application/json' }
  let url = ''
  try {
    const form = new FormData()
    form.append('fileAttachment', new Blob([p.pdf], { type: 'application/pdf' }), p.filename)
    form.append('contactId', dest.contactId); form.append('locationId', ghl.locationId); form.append('isSecureAttachment', 'true')
    const r = await f('https://services.leadconnectorhq.com/conversations/messages/upload', { method: 'POST', headers, body: form })
    const j: Any = await r.json().catch(() => ({}))
    const files = j?.uploadedFiles ?? j?.urls ?? j
    url = String((Array.isArray(files) ? files[0] : files && typeof files === 'object' ? Object.values(files)[0] : '') ?? '')
    if (!r.ok || !/^https:\/\//.test(url)) { const why = `the PDF could not be attached (GoHighLevel answered ${r.status}${j?.message ? ': ' + String(j.message).slice(0, 100) : ''})`; await report(why); return { outcome: 'failed', detail: 'Not sent: ' + why + '. It is in Needs Attention.', to } }
  } catch (e) {
    const why = 'GoHighLevel could not be reached to attach the PDF: ' + String((e as Error)?.message ?? e).slice(0, 80)
    await report(why); return { outcome: 'failed', detail: 'Not sent: ' + why + '.', to }
  }
  const mail = copyEmail({ toName: p.toName, clientName: p.clientName })
  const sent = await ghlSendChecked(db, { ...headers, 'Content-Type': 'application/json' }, 'client-agreement', { channel: 'email', contactId: dest.contactId, address: to, who: p.toName },
    { subject: mail.subject, html: mail.html, attachments: [url] }, f)
  return sent ? { outcome: 'sent', detail: 'Emailed to ' + to + '.', to } : { outcome: 'failed', detail: 'Not sent: GoHighLevel refused the email. It is in Needs Attention.', to }
}
