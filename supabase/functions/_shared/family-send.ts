// =============================================================================
// family-send · SEND TO FAMILY (Samantha 2026-10-28: "Yes, build it with your picks: Billing owner enters payment forms, no
// 3-digit code unless AxisCare needs it, start with the four pieces").
// The rules both functions share (family-send for the office, family-form for the family's link):
//  * Pieces: payment (the card or bank authorization that replaces the GHL "Credit Card & ACH Authorization Form"), circle
//    (the family confirms who gets what), guide (Medicare GUIDE respite, "Yes, call me about it"). The whole Client Care
//    Agreement keeps its own link (client-agreement link_send); the Hub card starts that one there.
//  * Only a person in THIS client's Family Circle can be sent to; anyone who can't be, says why (her rule: no silent failures).
//  * The link works 7 days and opens with a 6-digit code to the same phone or email, like the agreement (agreement-links.ts).
//  * Payment numbers are checked here (card: the Luhn check and a known brand; bank: the routing number's own check digit),
//    then sealed in the function. The 3-digit card code is never asked for (her pick).
// =============================================================================
import { digits, EMAIL_RE, maskPhone, maskEmail } from './agreement-links.ts'

// deno-lint-ignore no-explicit-any
type Any = any
export const PIECES = ['payment', 'circle', 'guide'] as const
export type Piece = typeof PIECES[number]
export const PIECE_NAME: Record<Piece, string> = { payment: 'Payment authorization', circle: 'Family Circle check', guide: 'GUIDE program' }
export const FORM_PAGE = 'https://cc.mo-care.com/family-form.html'
export const ERASE_DAYS = 7
export const PAY_WORDS = 'I authorize Troutman Enterprises, LLC DBA Caring Companions In-Home Senior Care to charge my credit card or bank account for the invoice every Thursday. This authorization stays in effect until I cancel it, and it ends automatically when services stop.'
export const CARD_FEE = 'Cards have a 3% admin fee on each charge. Bank accounts don\'t.'
const first = (n: unknown) => String(n ?? '').trim().split(/\s+/)[0] || ''
const esc = (s: string) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const clean = (v: unknown, n: number) => String(v ?? '').replace(/[–—]/g, ',').replace(/\s+/g, ' ').trim().slice(0, n)

/* ── who in the circle can get it, and how ── */
export type Reach = { id: string; name: string; relationship: string; main: boolean; sms: boolean; email: boolean; phone: string; mail: string; why: string }
/** One Family Circle person: can they get a link, and by which way. People AxisCare dropped are left out entirely. */
export function reachOf(c: Any): Reach | null {
  if (!c || c.axiscare_removed_at) return null
  const phone = digits(c.phone), mail = String(c.email ?? '').trim()
  const sms = phone.length === 10 && c.sms_consent === true && !c.stopped_at
  const email = EMAIL_RE.test(mail) && !c.stopped_at
  const why = c.stopped_at ? 'Replied STOP, so nothing can be sent.'
    : (!sms && !email) ? (phone.length === 10 ? 'Said no to texts and has no email. Add an email on Family & Contacts.' : 'No phone or email on file. Add one on Family & Contacts.') : ''
  return { id: String(c.id), name: clean(c.name, 80), relationship: clean(c.relationship, 40), main: c.is_primary === true, sms, email, phone, mail, why }
}
/** What the Hub sees: masked, never the full number or address. */
export const reachView = (r: Reach) => ({ id: r.id, name: r.name, relationship: r.relationship, main: r.main, sms: r.sms, email: r.email,
  phone: r.phone ? maskPhone(r.phone) : '', mail: r.mail ? maskEmail(r.mail) : '', why: r.why })

/* ── the messages (her family voice) ── */
const ASK: Record<Piece, (client: string) => string> = {
  payment: (c) => `the payment form for ${c ? c + '\'s' : 'your'} care. It takes about 3 minutes`,
  circle: (c) => `a quick check of who we keep in touch with about ${c || 'your loved one'}'s care. It takes about 2 minutes`,
  guide: () => 'information on Medicare\'s GUIDE program, which can cover respite visits for families living with dementia',
}
export function linkMessages(p: { piece: Piece; toName: string; clientName: string; url: string; expires: string }) {
  const hi = first(p.toName) || 'there', what = ASK[p.piece](first(p.clientName))
  return {
    sms: `Hi ${hi}, this is Caring Companions. Here is ${what}: ${p.url} The link works until ${p.expires}. Questions? Call us at (417) 234-8494.`,
    subject: p.piece === 'payment' ? 'Your payment form from Caring Companions' : p.piece === 'circle' ? 'Who should we keep in touch with?' : 'Medicare GUIDE: respite for families living with dementia',
    html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#1f2a36"><p>Hi ${esc(hi)},</p><p>Here is ${esc(what)}.</p>`
      + `<p><a href="${esc(p.url)}" style="display:inline-block;background:#1F7A8C;color:#fff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:10px">Open it</a></p>`
      + `<p>The link works until ${esc(p.expires)}. When you open it, we'll send you a 6-digit code to make sure it's you.</p>`
      + `<p>Questions? Call us at (417) 234-8494.</p><p style="color:#57606a">Caring Companions In-Home Senior Care<br>(417) 234-8494</p></div>`,
  }
}
export const codeMessages = (code: string) => ({
  sms: `Your Caring Companions code is ${code}. It works for 10 minutes. If you didn't ask for it, you can ignore this.`,
  subject: `Your Caring Companions code: ${code}`,
  html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#1f2a36"><p>Your Caring Companions code is</p>`
    + `<p style="font-size:28px;font-weight:bold;letter-spacing:4px">${code}</p><p>It works for 10 minutes. If you didn't ask for it, you can ignore this email.</p>`
    + `<p style="color:#57606a">Caring Companions In-Home Senior Care<br>(417) 234-8494</p></div>`,
})

/* ── the payment form ── */
export function luhnOk(n: string): boolean {
  let s = 0, alt = false
  for (let i = n.length - 1; i >= 0; i--) { let d = n.charCodeAt(i) - 48; if (alt) { d *= 2; if (d > 9) d -= 9 } s += d; alt = !alt }
  return n.length > 0 && s % 10 === 0
}
export function brandOf(n: string): string {
  if (/^4\d{12}(\d{3}){0,2}$/.test(n)) return 'Visa'
  if (/^(5[1-5]\d{14}|2(2[2-9][1-9]|2[3-9]\d|[3-6]\d\d|7[01]\d|720)\d{12})$/.test(n)) return 'Mastercard'
  if (/^3[47]\d{13}$/.test(n)) return 'Amex'
  if (/^(6011\d{12}|65\d{14}|64[4-9]\d{13})$/.test(n)) return 'Discover'
  return ''
}
/** The ABA routing number's own check: 3, 7, 1 weights. */
export function routingOk(r: string): boolean {
  if (!/^\d{9}$/.test(r) || /^0{9}$/.test(r)) return false
  const d = [...r].map(Number)
  return (3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8])) % 10 === 0
}
export function expOk(mmyy: string, now = new Date()): boolean {
  const m = /^(0[1-9]|1[0-2])\/(\d{2})$/.exec(mmyy); if (!m) return false
  const y = 2000 + Number(m[2]), mo = Number(m[1])
  const ct = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }))
  return y > ct.getFullYear() ? y <= ct.getFullYear() + 20 : y === ct.getFullYear() && mo >= ct.getMonth() + 1
}
export type PayClean = { ok: true; row: Any; secret: Any } | { ok: false; problems: string[] }
/** Checks what the family typed. row = what is kept in the clear; secret = what is sealed (and later erased). */
export function cleanPayment(b: Any, now = new Date()): PayClean {
  const p: string[] = []
  const method = b?.method === 'bank' ? 'bank' : b?.method === 'card' ? 'card' : ''
  if (!method) return { ok: false, problems: ['Pick a card or a bank account.'] }
  const holder = clean(b.holder_name, 80)
  if (holder.length < 3) p.push(method === 'card' ? 'Type the name on the card.' : 'Type the name on the account.')
  const zip = digits(b.zip).slice(0, 5)
  const mail = clean(b.invoice_email, 120)
  if (mail && !EMAIL_RE.test(mail)) p.push('The email for invoices doesn\'t look right.')
  if (b.all_future !== true) p.push('Check the box to use this for future invoices.')
  const signer = clean(b.signer_name, 80)
  if (!/^\S+(\s+\S+)+$/.test(signer)) p.push('Type your first and last name to sign.')
  if (b.agree !== true) p.push('Check the box that you authorize the weekly charge.')
  const row: Any = { method, holder_name: holder, zip: zip.length === 5 ? zip : null, invoice_email: mail || null, all_future: b.all_future === true, signer_name: signer, words: PAY_WORDS }
  let secret: Any = null
  if (method === 'card') {
    const num = String(b.card_number ?? '').replace(/\D/g, '')
    const brand = brandOf(num)
    if (!brand || !luhnOk(num)) p.push('That card number doesn\'t look right. Check it and try again.')
    const exp = String(b.exp ?? '').replace(/\s/g, '').replace(/^(\d{2})(\d{2})$/, '$1/$2')
    if (!expOk(exp, now)) p.push('Type the expiration as mm/yy, for a card that hasn\'t expired.')
    if (zip.length !== 5) p.push('Type the 5-digit billing ZIP code.')
    Object.assign(row, { brand: brand || null, exp: /^\d{2}\/\d{2}$/.test(exp) ? exp : null, last4: num.slice(-4) })
    secret = { number: num }
  } else {
    const routing = String(b.routing ?? '').replace(/\D/g, ''), account = String(b.account ?? '').replace(/\D/g, '')
    if (!routingOk(routing)) p.push('That routing number doesn\'t look right. It is the 9 digits at the bottom left of a check.')
    if (!/^\d{4,17}$/.test(account)) p.push('Type the account number (4 to 17 digits).')
    const bt = b.bank_type === 'savings' ? 'savings' : b.bank_type === 'checking' ? 'checking' : ''
    if (!bt) p.push('Pick checking or savings.')
    const ph = digits(b.phone)
    if (ph && ph.length !== 10) p.push('The phone number needs 10 digits.')
    Object.assign(row, { bank_type: bt || null, phone: ph.length === 10 ? ph : null, last4: account.slice(-4) })
    secret = { routing, account }
  }
  if (b.cvv || b.code || b.security_code) p.push('Please don\'t send the 3-digit code on the back of the card. We don\'t need it.')
  return p.length ? { ok: false, problems: p } : { ok: true, row, secret }
}
/** What anyone in the office sees about a payment form: never a full number. */
export const payView = (r: Any) => r && ({ id: r.id, method: r.method, brand: r.brand, last4: r.last4, exp: r.exp, zip: r.zip, bank_type: r.bank_type,
  holder_name: r.holder_name, invoice_email: r.invoice_email, all_future: r.all_future, signer_name: r.signer_name, signed_at: r.signed_at, words: r.words,
  reveals: r.reveals, entered_at: r.entered_at, entered_by: r.entered_by, erased_at: r.erased_at, erased_why: r.erased_why, locked: !!r.sealed,
  erase_by: r.sealed ? new Date(Date.parse(r.signed_at) + ERASE_DAYS * 86400e3).toISOString() : null })
export const payLabel = (r: Any) => r.method === 'card' ? `${r.brand || 'Card'} ending ${r.last4}` : `${r.bank_type === 'savings' ? 'Savings' : 'Checking'} account ending ${r.last4}`

/* ── the Family Circle check ── */
/** What the family sends back: each person kept, changed or removed, plus anyone new. Nothing changes the circle by itself:
 *  the office reads it and updates Family & Contacts (a person decides, same as agreement contact changes). */
export function cleanCircle(b: Any, known: string[]): { ok: true; result: Any } | { ok: false; problems: string[] } {
  const p: string[] = [], out: Any[] = [], add: Any[] = []
  const ids = new Set(known)
  for (const x of Array.isArray(b?.people) ? b.people.slice(0, 20) : []) {
    const id = String(x?.id ?? ''); if (!ids.has(id)) continue
    const what = x.what === 'remove' ? 'remove' : x.what === 'change' ? 'change' : 'keep'
    const ph = digits(x.phone), em = clean(x.email, 120)
    if (what === 'change' && ph && ph.length !== 10) p.push(`The phone number for ${clean(x.name, 40) || 'someone'} needs 10 digits.`)
    if (what === 'change' && em && !EMAIL_RE.test(em)) p.push(`The email for ${clean(x.name, 40) || 'someone'} doesn't look right.`)
    out.push({ id, name: clean(x.name, 80), what, ...(what === 'change' ? { phone: ph || null, email: em || null, note: clean(x.note, 200) || null } : {}) })
  }
  for (const x of Array.isArray(b?.add) ? b.add.slice(0, 6) : []) {
    const name = clean(x?.name, 80); if (!name) continue
    const ph = digits(x.phone), em = clean(x.email, 120)
    if (!/^\S+(\s+\S+)+$/.test(name)) p.push(`Add a last name for ${name}.`)
    if (ph && ph.length !== 10) p.push(`The phone number for ${name} needs 10 digits.`)
    if (em && !EMAIL_RE.test(em)) p.push(`The email for ${name} doesn't look right.`)
    add.push({ name, relationship: clean(x.relationship, 40), phone: ph || null, email: em || null })
  }
  const note = clean(b?.note, 600)
  if (p.length) return { ok: false, problems: p }
  return { ok: true, result: { people: out, add, note, changes: out.filter((x) => x.what !== 'keep').length + add.length + (note ? 1 : 0) } }
}
export function circleSummary(r: Any): string {
  const parts: string[] = []
  for (const x of r.people || []) if (x.what === 'remove') parts.push(`remove ${x.name}`); else if (x.what === 'change') parts.push(`${x.name}: ${[x.phone ? 'phone ' + x.phone : '', x.email ? 'email ' + x.email : '', x.note || ''].filter(Boolean).join(', ') || 'a change'}`)
  for (const x of r.add || []) parts.push(`add ${x.name}${x.relationship ? ' (' + x.relationship + ')' : ''}${x.phone ? ', ' + x.phone : ''}${x.email ? ', ' + x.email : ''}`)
  if (r.note) parts.push(`note: "${r.note}"`)
  return parts.join('; ')
}

/* ── GUIDE ── */
export const GUIDE_ANSWERS = ['call_me', 'not_now'] as const
export function cleanGuide(b: Any) { const a = String(b?.answer ?? ''); return (GUIDE_ANSWERS as readonly string[]).includes(a) ? { answer: a, best_time: clean(b?.best_time, 80) || null } : null }

/** What the Hub card shows about a send: never the secret or a code. */
export function sendView(s: Any) {
  return { id: s.id, piece: s.piece, piece_name: PIECE_NAME[s.piece as Piece] || s.piece, to_name: s.to_name, channels: s.channels, sent: s.sent,
    sent_by_name: s.sent_by_name || s.sent_by, created_at: s.created_at, expires_at: s.expires_at, opened_at: s.opened_at, verified_at: s.verified_at,
    done_at: s.done_at, revoked_at: s.revoked_at, revoked_by: s.revoked_by, result: s.piece === 'payment' ? null : s.result,
    live: !s.revoked_at && !s.done_at && Date.parse(s.expires_at) > Date.now() }
}

/* ── My Work cards (the office's side of what came back) ── */
export const cardId = (kind: 'pay' | 'circle' | 'guide', sendId: string) => `ops_fam${kind}_` + String(sendId).replace(/-/g, '').slice(0, 16)
/** Opens (or refreshes) a card on My Work. Never throws: what came back is already saved either way. */
export async function raiseCard(db: Any, owner: string, c: { id: string; kind: string; domain: string; title: string; detail: string; next: string; ax: string; who: string; urgency?: string; sensitive?: boolean }): Promise<void> {
  try {
    const now = new Date().toISOString()
    await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { id: c.id, kind: c.kind, domain: c.domain, status: 'open', urgency: c.urgency || 'today',
      owner, owner_name: '', title: c.title, detail: c.detail, next_action: c.next, about: c.who, who: c.who, client_ax: c.ax, sensitive: c.sensitive === true,
      created_at: now, first_at: now, last_at: now, last_activity_at: now, due: new Date(Date.now() + 24 * 3600e3).toISOString(),
      closed_at: null, closed_by: null, opened_by: 'family-form', created_by: 'family-form' } })
  } catch (e) { console.warn('[family-send] card ' + c.id + ': ' + String(e).slice(0, 160)) }
}
export async function closeCard(db: Any, id: string, by: string, note: string): Promise<void> {
  try {
    const { data: row } = await db.from('app_data').select('data').eq('key', 'ops_items').maybeSingle()
    const prev = (Array.isArray(row?.data) ? row.data : []).find((x: Any) => x && x.id === id)
    if (!prev || prev.status === 'done') return
    const now = new Date().toISOString()
    await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { ...prev, status: 'done', closed_at: now, closed_by: by, close_note: note, last_at: now, last_activity_at: now } })
  } catch (e) { console.warn('[family-send] close ' + id + ': ' + String(e).slice(0, 160)) }
}
