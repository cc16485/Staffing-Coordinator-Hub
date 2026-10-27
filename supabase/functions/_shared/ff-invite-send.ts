// =============================================================================
// ff-invite-send · THE FRIENDS & FAMILY INVITATIONS (Friends & Family Referral Program, step 4, 2026-10-27).
// Samantha 2026-10-27: "I approve step 4 as recommended: the wording as written, owners-only tab, family credit on the connected
// client's invoice, printed card requests emailed to me. Leave office staff out of caregiver invitations. Build it."
// Pure: the approved words, the personal code, who counts as office staff. ff-invite-check does the sending.
// No em dashes in any words a person reads.
// =============================================================================
// deno-lint-ignore-file no-explicit-any
export const LINK_BASE = 'https://mo-care.com/r/?p='
export const PAGE_BASE = 'https://mo-care.com/refer-a-friend/?p='
export const PHONE = '(417) 234-8494'
/** at most this many people are invited in one morning; the rest go the next morning */
export const DAILY_CAP = 60
const SAFE = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'   // the Hub's own alphabet (partner-links-rules.js): no 0/O, 1/I/L
const S = (v: unknown) => String(v ?? '').trim()
export const normalCode = (raw: unknown) => { const c = S(raw).toUpperCase(); return /^[A-Z0-9-]{3,20}$/.test(c) ? c : '' }
const esc = (s: unknown) => S(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
export const firstOf = (name: unknown) => S(name).split(/\s+/)[0] || 'there'

/** the same code the Hub makes for a partner: the first word of the name (up to 6 letters), a dash, two safe characters */
export function newCode(name: unknown, orgs: any[], rand: () => number = Math.random): string | null {
  const word = (S(name).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').trim().split(/\s+/).find((w) => /^(?!THE$|AND$)[A-Z]/.test(w)) || 'CC').slice(0, 6)
  const used = new Set((orgs || []).map((o) => normalCode(o?.partner_code)).filter(Boolean))
  for (let i = 0; i < 400; i++) {
    const c = word + '-' + SAFE[Math.floor(rand() * SAFE.length)] + SAFE[Math.floor(rand() * SAFE.length)]
    if (!used.has(c)) return c
  }
  return null
}
/** the participant's record on the Referral Partner list (program_track 'friends' keeps it off every coordinator list) */
export function participantOrg(row: { key: string; kind: string; name: string; client?: string; client_ax?: string }, code: string, at: string) {
  return { id: 'ff_' + row.key, name: row.name, type: 'Friends & Family', program_track: 'friends', program_status: 'active', partner_code: code,
    ff_key: row.key, ff_kind: row.kind, ...(row.client ? { ff_client: row.client } : {}), ...(row.client_ax ? { ff_client_ax: row.client_ax } : {}),
    created_at: at, created_by: 'ff-invite-check' }
}

/* ── office staff are not invited (her rule 2026-10-27): an owner or office person who is also in AxisCare as a caregiver ── */
const key = (v: unknown) => S(v).toLowerCase().replace(/[^a-z]/g, '')
export function staffMatcher(staff: Array<{ full_name?: unknown; primary_email?: unknown }>) {
  const emails = new Set(staff.map((p) => S(p.primary_email).toLowerCase()).filter((e) => e.includes('@')))
  const names = new Set(staff.map((p) => key(p.full_name)).filter((n) => n.length > 3))
  return (cg: { first?: unknown; last?: unknown; goes_by?: unknown; email?: unknown }) =>
    emails.has(S(cg.email).toLowerCase()) || names.has(key(`${S(cg.first)} ${S(cg.last)}`)) || (!!S(cg.goes_by) && names.has(key(`${S(cg.goes_by)} ${S(cg.last)}`)))
}

/* ── the approved words (plan page v3, step 4) ── */
const shell = (paras: string[]) => `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#16283a;max-width:560px">`
  + paras.map((p) => `<p style="margin:0 0 14px">${p}</p>`).join('')
  + `<p style="margin:18px 0 0;color:#55677a;font-size:14px">Caring Companions In-Home Senior Care · 1331 N Stewart Ave Ste B, Springfield MO 65802 · ${PHONE}</p></div>`
const a = (href: string, text: string) => `<a href="${esc(href)}" style="color:#1F7A8C">${esc(text)}</a>`

export function caregiverText(first: string, code: string): string {
  return `Hi ${first}! Thank you for being part of the Caring Companions team! 💙 Did you know you can help more families find compassionate care at home? `
    + `Share your personal link with anyone who could use help at home. When a family you refer starts private-pay care and completes 20 hours, you get a $100 bonus on your paycheck. `
    + `Your link: ${LINK_BASE}${code} Reply STOP to opt out.`
}
export function caregiverEmail(first: string, code: string): { subject: string; html: string } {
  return { subject: 'Thank you, and a way to help more families', html: shell([
    `Hi ${esc(first)},`,
    'Thank you for being part of the Caring Companions team. The care you give is the reason families trust us.',
    `If you know someone who could use help at home, share your personal link: ${a(LINK_BASE + code, LINK_BASE + code)}. When a family you refer starts private-pay care with us and completes 20 hours, you get a $100 bonus on your paycheck.`,
    `How it works and the details: ${a(PAGE_BASE + code, 'your Refer a Friend page')}. Questions? Call us at ${PHONE}.`]) }
}
/** whose invoice the credit goes on: the client's own when they are the client, else the client they're connected to */
export function invoiceWords(isClient: boolean, client: string): string {
  return isClient || !S(client) ? 'your next invoice' : `${S(client)}'s next invoice`
}
export function familyEmail(first: string, code: string, invoice: string): { subject: string; html: string } {
  return { subject: 'A thank-you from Caring Companions', html: shell([
    `Hi ${esc(first)},`,
    `We're grateful you've chosen Caring Companions. 💙 If you know a friend or neighbor who could use a little extra help at home, we'd love for you to share our information. Here's your personal link: ${a(LINK_BASE + code, LINK_BASE + code)}`,
    `When someone you refer starts private-pay care with us and completes 20 hours, we'll put a $100 credit on ${esc(invoice)}.`,
    `How it works and the details: ${a(PAGE_BASE + code, 'your Refer a Friend page')}. Questions? Call us at ${PHONE}.`]) }
}
/* the family text (her draft) is kept for when marketing text consent exists; nothing sends it today */
export function familyText(first: string, code: string): string {
  return `Hi ${first}! We're grateful you've chosen Caring Companions. 💙 If you know a friend or neighbor who could use a little extra help at home, we'd love for you to share our information. `
    + `Learn about our Refer-a-Friend Program here: ${PAGE_BASE}${code} Reply STOP to opt out.`
}

/* ── the printed card request (her choice: an email to her) ── */
export const CARD_TO = 'samantha@mo-care.com'
export function cardRequestEmail(o: { name: string; code: string; who: string; kind: string; client?: string; mail_to: string; address: string; how_many: number; note?: string }) {
  const lines = [
    `<b>${esc(o.who)}</b> (${esc(o.kind === 'caregiver' ? 'caregiver' : o.client ? `family of ${o.client}` : 'family')}) asked for printed Refer a Friend cards.`,
    `Their code: <b>${esc(o.code)}</b> (${a(LINK_BASE + o.code, LINK_BASE + o.code)})`,
    `How many: ${o.how_many}`,
    `Mail to: ${esc(o.mail_to)}<br>${esc(o.address).replace(/\n/g, '<br>')}`,
    ...(o.note ? [`Their note: ${esc(o.note)}`] : []),
    'They typed this address on their Refer a Friend page. Nothing else needs doing in the Hub.']
  return { subject: `Printed referral cards for ${o.who}`, html: shell(lines) }
}
