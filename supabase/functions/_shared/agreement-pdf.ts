// =============================================================================
// agreement-pdf.ts · writes a signed Client Care Agreement (Stage 1, Samantha 2026-10-16).
// Starts from the exact master PDF the family read (its sha256 must match client-agreement-map.ts), writes their answers,
// ticks, initials and finger signatures into the measured boxes, and adds one final "Electronic signature record" page
// with the audit trail. This is the one place in the server that edits an existing PDF, so it uses pdf-lib (the rest of
// the repo writes PDFs from scratch with brand-pdf.ts, which cannot open an existing file or place a PNG).
// Deterministic for the same inputs apart from pdf-lib's own metadata dates, which are set to the signing time.
// =============================================================================
import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1'
import { FIELDS, PAGES, PDF_SHA256, VERSION } from './client-agreement-map.ts'

const INK = rgb(0.05, 0.2, 0.45), NAVY = rgb(0.051, 0.212, 0.373), MUTED = rgb(0.33, 0.4, 0.48)
const H = 792

export type SignInput = {
  master: Uint8Array
  plan: { text: Record<string, string>; checks: string[]; initials: string[]; initialsText: string; sigs: Record<string, 'client' | 'office'> }
  clientSigPng: Uint8Array
  officeSigPng?: Uint8Array
  record: string[][]          // [label, value] rows for the signature record page
  at: string                  // ISO time used for the PDF's own dates
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Helvetica only draws Latin-1: straighten quotes and dashes, drop anything else it cannot draw. */
export function safe(s: string): string {
  return String(s ?? '').normalize('NFKC').replace(/[\u2018\u2019\u201b]/g, "'").replace(/[\u201c\u201d\u201f]/g, '"').replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...').replace(/[^\n\x20-\x7e\u00a0-\u00ff]/g, '')
}

/** Shrink text until it fits the box width (down to 6pt), never wrapping. */
// deno-lint-ignore no-explicit-any
function fitSize(font: any, s: string, width: number, start = 9.5): number {
  let size = start
  while (size > 6 && font.widthOfTextAtSize(s, size) > width) size -= 0.25
  return size
}

export async function signedAgreementPdf(inp: SignInput): Promise<Uint8Array> {
  if ((await sha256Hex(inp.master)) !== PDF_SHA256) throw new Error('master PDF does not match the field map')
  const doc = await PDFDocument.load(inp.master)
  if (doc.getPageCount() !== PAGES) throw new Error('master PDF page count changed')
  const pages = doc.getPages()
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const pt = (k: string) => { const f = FIELDS[k]; if (!f) throw new Error('unknown field ' + k); return { p: pages[f.page - 1], x0: f.box[0], y0: f.box[1], x1: f.box[2], y1: f.box[3] } }

  for (const [k, raw] of Object.entries(inp.plan.text)) {
    const v = safe(raw)
    if (!v) continue
    const { p, x0, x1, y1 } = pt(k)
    const w = x1 - x0 - 4, size = fitSize(font, v, w)
    p.drawText(v, { x: x0 + 2, y: H - y1 + 2.5, size, font, color: INK })
  }
  for (const k of inp.plan.checks) {
    const { p, x0, y0, x1, y1 } = pt(k)
    // a drawn check mark inside the 9pt square
    p.drawLine({ start: { x: x0 + 1.8, y: H - (y0 + 4.8) }, end: { x: x0 + 3.8, y: H - (y1 - 1.6) }, thickness: 1.4, color: INK })
    p.drawLine({ start: { x: x0 + 3.8, y: H - (y1 - 1.6) }, end: { x: x1 - 1.2, y: H - (y0 + 1.4) }, thickness: 1.4, color: INK })
  }
  for (const k of inp.plan.initials) {
    const { p, x0, y0, x1, y1 } = pt(k)
    const s = safe(inp.plan.initialsText), size = fitSize(bold, s, x1 - x0 - 8, 12)
    p.drawText(s, { x: x0 + (x1 - x0 - bold.widthOfTextAtSize(s, size)) / 2, y: H - y1 + (y1 - y0 - size * 0.7) / 2, size, font: bold, color: INK })
  }
  const client = await doc.embedPng(inp.clientSigPng)
  const office = inp.officeSigPng ? await doc.embedPng(inp.officeSigPng) : null
  for (const [k, who] of Object.entries(inp.plan.sigs)) {
    const img = who === 'client' ? client : office
    if (!img) continue
    const { p, x0, y0, x1, y1 } = pt(k)
    const boxH = (y1 - y0) + 10, boxW = x1 - x0 - 4          // let the signature rise a little above the line, as ink would
    const s = Math.min(boxW / img.width, boxH / img.height)
    p.drawImage(img, { x: x0 + 2, y: H - y1 + 1, width: img.width * s, height: img.height * s })
  }

  // the signature record page
  const r = doc.addPage([612, 792])
  let y = 740
  r.drawText('Electronic signature record', { x: 60, y, size: 18, font: bold, color: NAVY }); y -= 18
  r.drawText(`Caring Companions Client Care Agreement · ${VERSION} · this page is part of the signed agreement`, { x: 60, y, size: 9, font, color: MUTED }); y -= 26
  for (const [label, value] of inp.record) {
    const lines = wrapText(font, safe(String(value ?? '')), 330, 9)
    if (y - lines.length * 12 < 60) break
    r.drawText(safe(label), { x: 60, y, size: 9, font: bold, color: NAVY })
    for (const ln of lines) { r.drawText(ln, { x: 222, y, size: 9, font, color: rgb(0.09, 0.16, 0.23) }); y -= 12 }
    y -= 5
  }
  const when = new Date(inp.at)
  doc.setTitle('Caring Companions Client Care Agreement (signed)'); doc.setCreator('Caring Companions Hub'); doc.setProducer('Caring Companions Hub')
  doc.setCreationDate(when); doc.setModificationDate(when)
  return await doc.save({ useObjectStreams: false })
}

// deno-lint-ignore no-explicit-any
function wrapText(font: any, text: string, width: number, size: number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const cand = line ? line + ' ' + w : w
      if (font.widthOfTextAtSize(cand, size) > width && line) { out.push(line); line = w } else line = cand
    }
    out.push(line)
  }
  return out
}
