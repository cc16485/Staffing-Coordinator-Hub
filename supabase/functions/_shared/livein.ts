// =============================================================================
// livein.ts · the rules, words and PDF for the Live-In Caregiver Agreement signed on a phone (Samantha 2026-10-29: "have
// Sheryelle and Rhonda sign the live-in packet"; design approved the same day).
// Pure except the PDF bytes (no network, no clock unless given). Her design: the caregiver reads the 12 real pages on a
// private link texted from the office line (an owner sees the words and presses Send), ticks, types their full name and
// signs with a finger. An owner then adds the Caring Companions signature on page 12 in the Hub. The signed PDF is the
// exact master with the signatures written on the page 12 lines, plus one "Electronic signature record" page.
// =============================================================================
import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1'
import { safe } from './agreement-pdf.ts'
// deno-lint-ignore no-explicit-any
type Any = any

export { BUCKET, OFFICE_PHONE, MAX_TEXT, sha256, newToken, tokenOk, firstName, shortName, nameMatches, chicagoYmd } from './hr-ack.ts'
import { OFFICE_PHONE, firstName } from './hr-ack.ts'

/** The one master people sign: her PDF of 2026-10-29, kept in hr-docs. Its sha256 must match before anything is written on it. */
export const MASTER = { sha: 'e35b98102d4664ce79df96168cac354b0d006783f58a78fe33d4939c40fc322c', path: 'master/live-in-caregiver-agreement-rev-2026-10.pdf',
  pages: 12, version: 'Rev. 10/2026', title: 'Live-In Caregiver Assignment Acknowledgment and Reasonable Agreement' }
/** Who it is for (her answer 2026-10-29: Rhonda Blakemore and Sheryelle Dunniehigh). Add a name here to send it to someone else. */
export const PEOPLE = ['Sheryelle Dunniehigh', 'Rhonda Blakemore']
export const PAGE = 'https://cc.mo-care.com/livein.html'
export const LINK_DAYS = 7
export const linkFor = (token: string) => `${PAGE}?t=${encodeURIComponent(token)}`
export const LINK_RE = /livein\.html\?t=([A-Za-z0-9_-]{40,60})/
/** The pay statement from the page 12 acknowledgment, shown again right above the signature (her own words). */
export const STATEMENT = 'I understand and voluntarily agree that the $250.00 live-in assignment rate is based upon a scheduled twenty-four (24) hour assignment consisting of twelve (12) scheduled compensable working hours, one scheduled four (4) hour off-duty relief period, and one scheduled eight (8) hour overnight sleep period. I understand that the off-duty relief period and overnight sleep period are intended to be unpaid periods, provided I am relieved of duties and the requirements of applicable law are satisfied. I further understand that I must immediately report any work performed during those periods so that I may be compensated in accordance with applicable law.'
export const CONSENT = 'I have read all 12 pages of the Live-In Caregiver Agreement, I had the chance to ask questions, and I agree to it. I agree to sign it electronically.'

/** The text an owner sees and can change before pressing Send. */
export function draftText(caregiver: unknown, sender: unknown, link: string): string {
  const f = firstName(caregiver) || 'there', s = firstName(sender)
  return `Hi ${f}, this is ${s ? s + ' at ' : ''}Caring Companions. Here is the Live-In Caregiver Agreement to read and sign on your phone. It is private to you: ${link} Questions? Call the office at ${OFFICE_PHONE}.`
}

/** A finger signature from the page: a PNG data URL, small. Returns its base64, or '' when it is not one. */
export function sigOf(v: unknown): string {
  const m = String(v ?? '').match(/^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/)
  if (!m || m[1].length < 200 || m[1].length > 400000) return ''
  try { const b = atob(m[1].slice(0, 12)); return b.charCodeAt(0) === 0x89 && b.slice(1, 4) === 'PNG' ? m[1] : '' } catch { return '' }
}
const b64bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))

const longDay = (d: Date) => d.toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'long', day: 'numeric', year: 'numeric' })
const longWhen = (d: Date) => `${longDay(d)}, ${d.toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' })} Central`

/* page 12's lines, measured on the master (points from the bottom of the 612 x 792 page): printed name, signature, date */
const COL = { employee: 50, rep: 322 }, COL_W = 238
const LINE = { name: 792 - 617, sig: 792 - 668.5, date: 792 - 720.5 }
const INK = rgb(0.05, 0.2, 0.45), NAVY = rgb(0.051, 0.212, 0.373), MUTED = rgb(0.33, 0.4, 0.48)

export type Signer = { name: string; sig: string; at: Date }
export type SignedPdfIn = { master: Uint8Array; row: Any; employee: Signer & { ip: string; agent: string }; rep?: Signer & { email: string } }
/** The signed agreement: the master untouched except page 12's lines, and the signature record page at the end. */
export async function signedPdf(inp: SignedPdfIn): Promise<Uint8Array> {
  const doc = await PDFDocument.load(inp.master)
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const p12 = doc.getPages()[MASTER.pages - 1]
  const side = async (x: number, s: Signer, label: string) => {
    p12.drawText(safe(s.name), { x: x + 4, y: LINE.name + 6, size: 12, font, color: INK })
    const img = await doc.embedPng(b64bytes(s.sig)), sc = Math.min((COL_W - 8) / img.width, 42 / img.height)
    p12.drawImage(img, { x: x + 4, y: LINE.sig + 3, width: img.width * sc, height: img.height * sc })
    p12.drawText(safe(longDay(s.at)), { x: x + 4, y: LINE.date + 6, size: 11, font, color: INK })
    const note = safe(`Signed electronically ${label}`), nw = font.widthOfTextAtSize(note, 6.5)
    p12.drawText(note, { x: x + COL_W - nw, y: LINE.sig - 11, size: 6.5, font, color: MUTED })
  }
  await side(COL.employee, inp.employee, 'by the employee')
  if (inp.rep) await side(COL.rep, inp.rep, 'for Caring Companions')
  // the record page
  const pg = doc.addPage([612, 792]); let y = 740
  const put = (t: string, o: { size?: number; f?: Any; c?: Any; gap?: number } = {}) => {
    const size = o.size ?? 10, words = safe(t).split(/\s+/), lines: string[] = []; let cur = ''
    for (const w of words) { const n = cur ? cur + ' ' + w : w; if ((o.f ?? font).widthOfTextAtSize(n, size) > 512 && cur) { lines.push(cur); cur = w } else cur = n }
    if (cur) lines.push(cur)
    for (const l of lines) { pg.drawText(l, { x: 50, y, size, font: o.f ?? font, color: o.c ?? rgb(0.1, 0.1, 0.1) }); y -= size * 1.35 }
    y -= o.gap ?? 4
  }
  put('Electronic signature record', { size: 17, f: bold, c: NAVY, gap: 2 })
  put(`${MASTER.title} (${MASTER.version}) · ${inp.row.practice ? 'PRACTICE, not a real agreement' : 'record ' + inp.row.id}`, { size: 8.5, c: MUTED, gap: 14 })
  const e = inp.employee
  put('Employee', { size: 12, f: bold, c: NAVY })
  put(`${e.name}, signed ${longWhen(e.at)} (${e.at.toISOString()} UTC) on their private link, after reading all ${MASTER.pages} pages.`)
  put(`They ticked: "${CONSENT}"`)
  put(`Device address ${e.ip || 'not recorded'}. Browser ${e.agent || 'not recorded'}.`, { size: 8.5, c: MUTED, gap: 12 })
  put('Caring Companions In-Home Senior Care', { size: 12, f: bold, c: NAVY })
  if (inp.rep) put(`${inp.rep.name} (${inp.rep.email}), signed ${longWhen(inp.rep.at)} (${inp.rep.at.toISOString()} UTC) in the Caring Companions Hub.`, { gap: 12 })
  else put('Not countersigned yet.', { c: MUTED, gap: 12 })
  put(`Agreement fingerprint (SHA-256 of the ${MASTER.pages}-page master): ${MASTER.sha}`, { size: 8, c: MUTED })
  pg.drawText('Caring Companions In-Home Senior Care · Confidential', { x: 50, y: 30, size: 7.5, font, color: MUTED })
  doc.setTitle(`Live-In Caregiver Agreement - ${safe(e.name)}`); doc.setAuthor('Caring Companions In-Home Senior Care')
  doc.setCreationDate(e.at); doc.setModificationDate(inp.rep?.at ?? e.at)
  return await doc.save({ useObjectStreams: false })
}
