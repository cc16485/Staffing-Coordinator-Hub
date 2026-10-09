// =============================================================================
// brand-pdf.ts · branded, dependency-free PDFs for the signed onboarding documents (Slice 1b design, Samantha 2026-10-09)
// =============================================================================
// Letter pages in the Caring Companions letterhead: the logo upper left, the company block upper right, the thin gold
// rule, navy and gold throughout, Poppins (embedded; SIL Open Font License), gold bullets, the highlighted at-will box
// with its gold border, the "Warmly" closing with the issuer's name and title (text only, never a signature image), the
// acceptance section with the caregiver's typed electronic signature and its audit record, the branded footer with page
// numbers. Deterministic: the same input gives the same bytes. No colour, font or layout here changes a single word:
// the words come from offer-documents.ts and are fingerprinted there.
import { POPPINS_REGULAR, POPPINS_SEMIBOLD, POPPINS_BOLD, LOGO_JPEG } from './brand-assets.ts'
import type { Block } from './offer-documents.ts'

export const NAVY = [0.051, 0.212, 0.373] as const, NAVY_DARK = [0.035, 0.149, 0.278] as const
export const GOLD = [0.941, 0.651, 0.227] as const, GOLD_TEXT = [0.757, 0.478, 0.071] as const
export const TEXT = [0.086, 0.157, 0.227] as const, MUTED = [0.42, 0.47, 0.54] as const, BEIGE = [0.965, 0.949, 0.918] as const, RULE = [0.894, 0.882, 0.847] as const
type RGB = readonly [number, number, number]
type FontKey = 'R' | 'S' | 'B'
const FONTS: Record<FontKey, { res: string; meta: typeof POPPINS_REGULAR }> = { R: { res: 'F1', meta: POPPINS_REGULAR }, S: { res: 'F2', meta: POPPINS_SEMIBOLD }, B: { res: 'F3', meta: POPPINS_BOLD } }
const PAGE_W = 612, PAGE_H = 792, ML = 60, MR = 60, MT = 44, MB = 64
const CP1252: Record<number, number> = { 0x20ac: 128, 0x201a: 130, 0x192: 131, 0x201e: 132, 0x2026: 133, 0x2020: 134, 0x2021: 135, 0x2c6: 136, 0x2030: 137, 0x160: 138, 0x2039: 139, 0x152: 140, 0x17d: 142, 0x2018: 145, 0x2019: 146, 0x201c: 147, 0x201d: 148, 0x2022: 149, 0x2013: 150, 0x2014: 151, 0x2dc: 152, 0x2122: 153, 0x161: 154, 0x203a: 155, 0x153: 156, 0x17e: 158, 0x178: 159 }
function codes(s: string): number[] { const out: number[] = []; for (const ch of s) { const u = ch.codePointAt(0)!; if (u < 128 || (u >= 160 && u <= 255)) out.push(u); else if (CP1252[u] !== undefined) out.push(CP1252[u]); else out.push(63) } return out }
const pdfStr = (cs: number[]) => '(' + cs.map((c) => c === 40 || c === 41 || c === 92 ? '\\' + String.fromCharCode(c) : c < 32 || c > 126 ? '\\' + c.toString(8).padStart(3, '0') : String.fromCharCode(c)).join('') + ')'
export function textWidth(s: string, font: FontKey, size: number, spacing = 0): number {
  const w = FONTS[font].meta.widths; const cs = codes(s)
  return cs.reduce((a, c) => a + (w[c - 32] ?? 500), 0) * size / 1000 + spacing * Math.max(0, cs.length - 1)
}
function wrap(text: string, font: FontKey, size: number, width: number, spacing = 0): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean); let line = ''
    for (const wd of words) { const cand = line ? line + ' ' + wd : wd; if (textWidth(cand, font, size, spacing) > width && line) { out.push(line); line = wd } else line = cand }
    out.push(line)
  }
  return out
}
const col = (c: RGB) => `${c[0].toFixed(3)} ${c[1].toFixed(3)} ${c[2].toFixed(3)}`
type TextOpts = { font?: FontKey; size?: number; color?: RGB; indent?: number; align?: 'left' | 'right' | 'center'; spacing?: number; lh?: number; after?: number; width?: number; x?: number; keep?: boolean }

export class BrandPdf {
  pages: string[][] = [[]]; y = PAGE_H - MT; usedLogo = false; headerFn: ((p: BrandPdf, first: boolean) => void) | null = null; footerText = ''
  title: string
  constructor(title: string) { this.title = title }
  get cur() { return this.pages[this.pages.length - 1] }
  private op(s: string) { this.cur.push(s) }
  newPage() { this.pages.push([]); this.y = PAGE_H - MT; if (this.headerFn) this.headerFn(this, false) }
  ensure(h: number) { if (this.y - h < MB) this.newPage() }
  /** raw text at a point (baseline), no wrapping */
  textAt(s: string, x: number, y: number, font: FontKey, size: number, color: RGB, spacing = 0, align: 'left' | 'right' | 'center' = 'left') {
    const w = textWidth(s, font, size, spacing); const xx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x
    this.op(`BT ${col(color)} rg /${FONTS[font].res} ${size} Tf ${spacing ? spacing.toFixed(2) + ' Tc ' : '0 Tc '}${xx.toFixed(2)} ${y.toFixed(2)} Td ${pdfStr(codes(s))} Tj ET`)
  }
  rect(x: number, y: number, w: number, h: number, fill?: RGB, stroke?: RGB, lw = 1, r = 0) {
    const k = 0.5523, path = r > 0
      ? `${(x + r).toFixed(2)} ${y.toFixed(2)} m ${(x + w - r).toFixed(2)} ${y.toFixed(2)} l ${(x + w - r + r * k).toFixed(2)} ${y.toFixed(2)} ${(x + w).toFixed(2)} ${(y + r - r * k).toFixed(2)} ${(x + w).toFixed(2)} ${(y + r).toFixed(2)} c ${(x + w).toFixed(2)} ${(y + h - r).toFixed(2)} l ${(x + w).toFixed(2)} ${(y + h - r + r * k).toFixed(2)} ${(x + w - r + r * k).toFixed(2)} ${(y + h).toFixed(2)} ${(x + w - r).toFixed(2)} ${(y + h).toFixed(2)} c ${(x + r).toFixed(2)} ${(y + h).toFixed(2)} l ${(x + r - r * k).toFixed(2)} ${(y + h).toFixed(2)} ${x.toFixed(2)} ${(y + h - r + r * k).toFixed(2)} ${x.toFixed(2)} ${(y + h - r).toFixed(2)} c ${x.toFixed(2)} ${(y + r).toFixed(2)} l ${x.toFixed(2)} ${(y + r - r * k).toFixed(2)} ${(x + r - r * k).toFixed(2)} ${y.toFixed(2)} ${(x + r).toFixed(2)} ${y.toFixed(2)} c h`
      : `${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re`
    const paint = fill && stroke ? 'B' : fill ? 'f' : 'S'
    this.op(`q ${fill ? col(fill) + ' rg ' : ''}${stroke ? col(stroke) + ' RG ' + lw + ' w ' : ''}${path} ${paint} Q`)
  }
  line(x1: number, y1: number, x2: number, y2: number, color: RGB, lw = 1) { this.op(`q ${col(color)} RG ${lw} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S Q`) }
  circle(cx: number, cy: number, r: number, fill: RGB) { const k = 0.5523 * r; this.op(`q ${col(fill)} rg ${(cx + r).toFixed(2)} ${cy.toFixed(2)} m ${(cx + r).toFixed(2)} ${(cy + k).toFixed(2)} ${(cx + k).toFixed(2)} ${(cy + r).toFixed(2)} ${cx.toFixed(2)} ${(cy + r).toFixed(2)} c ${(cx - k).toFixed(2)} ${(cy + r).toFixed(2)} ${(cx - r).toFixed(2)} ${(cy + k).toFixed(2)} ${(cx - r).toFixed(2)} ${cy.toFixed(2)} c ${(cx - r).toFixed(2)} ${(cy - k).toFixed(2)} ${(cx - k).toFixed(2)} ${(cy - r).toFixed(2)} ${cx.toFixed(2)} ${(cy - r).toFixed(2)} c ${(cx + k).toFixed(2)} ${(cy - r).toFixed(2)} ${(cx + r).toFixed(2)} ${(cy - k).toFixed(2)} ${(cx + r).toFixed(2)} ${cy.toFixed(2)} c f Q`) }
  logo(x: number, yTop: number, w: number) { const h = w * LOGO_JPEG.height / LOGO_JPEG.width; this.op(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${(yTop - h).toFixed(2)} cm /Im1 Do Q`); this.usedLogo = true; return h }
  /** a wrapped paragraph; returns the height used */
  para(text: string, o: TextOpts = {}) {
    const font = o.font ?? 'R', size = o.size ?? 10.5, color = o.color ?? TEXT, lh = o.lh ?? size * 1.62, x = (o.x ?? ML) + (o.indent ?? 0), width = o.width ?? (PAGE_W - MR - x), sp = o.spacing ?? 0
    const lines = wrap(text, font, size, width, sp)
    if (o.keep) this.ensure(lines.length * lh + (o.after ?? 0))
    for (const ln of lines) { this.ensure(lh); this.y -= lh * 0.78; const ax = o.align === 'right' ? x + width : o.align === 'center' ? x + width / 2 : x; this.textAt(ln, ax, this.y, font, size, color, sp, o.align ?? 'left'); this.y -= lh * 0.22 }
    this.y -= o.after ?? 0
  }
  /** "Label: value" with the label bold navy */
  labelled(label: string, value: string, o: { size?: number; after?: number; valueFont?: FontKey; valueSize?: number } = {}) {
    const size = o.size ?? 10.5, lh = size * 1.62; this.ensure(lh); this.y -= lh * 0.78
    this.textAt(label, ML, this.y, 'B', size, NAVY); const lw = textWidth(label, 'B', size) + 4
    this.textAt(value, ML + lw, this.y, o.valueFont ?? 'R', o.valueSize ?? size, TEXT); this.y -= lh * 0.22 + (o.after ?? 0)
  }
  heading(text: string, o: { after?: number } = {}) { this.y -= 6; this.para(text, { font: 'S', size: 9.5, color: GOLD_TEXT, spacing: 1.3, lh: 15, after: o.after ?? 5, keep: true }) }
  bullet(text: string) {
    const size = 10.5, lh = size * 1.62, indent = 22, width = PAGE_W - MR - ML - indent; const lines = wrap(text, 'R', size, width); this.ensure(lh * lines.length + 2)
    lines.forEach((ln, i) => { this.y -= lh * 0.78; if (i === 0) this.circle(ML + 7, this.y + size * 0.33, 2.3, GOLD); this.textAt(ln, ML + indent, this.y, 'R', size, TEXT); this.y -= lh * 0.22 })
    this.y -= 3
  }
  /** the highlighted box with a gold left border (the at-will paragraph) */
  box(text: string) {
    const size = 10.5, lh = size * 1.62, pad = 13, width = PAGE_W - MR - ML; const lines = wrap(text, 'R', size, width - pad * 2 - 4); const h = lines.length * lh + pad * 2
    this.ensure(h + 8); const top = this.y
    this.rect(ML, top - h, width, h, BEIGE, RULE, 0.8, 7); this.rect(ML, top - h + 3, 4, h - 6, GOLD)
    this.y -= pad; for (const ln of lines) { this.y -= lh * 0.78; this.textAt(ln, ML + pad + 4, this.y, 'R', size, TEXT); this.y -= lh * 0.22 } this.y = top - h - 10
  }
  hr(color: RGB = RULE, gap = 10) { this.ensure(gap * 2); this.y -= gap; this.line(ML, this.y, PAGE_W - MR, this.y, color, 0.8); this.y -= gap }
  /** the signature area: the typed name over a line with a small caps label, plus date and audit lines */
  signatureArea(typedName: string, signedWhen: string, audit: string[]) {
    const h = 128 + audit.length * 11; this.ensure(h)
    this.y -= 24; this.textAt(typedName, ML + 4, this.y, 'S', 17, NAVY); this.line(ML, this.y - 6, PAGE_W - MR, this.y - 6, MUTED, 0.6)
    this.y -= 17; this.textAt('ELECTRONIC SIGNATURE', ML, this.y, 'S', 7.5, MUTED, 1.2)
    this.y -= 24; this.textAt(typedName, ML + 4, this.y, 'R', 12, TEXT); this.line(ML, this.y - 6, PAGE_W - MR, this.y - 6, MUTED, 0.6)
    this.y -= 17; this.textAt('PRINTED NAME', ML, this.y, 'S', 7.5, MUTED, 1.2)
    this.y -= 24; this.textAt(signedWhen, ML + 4, this.y, 'R', 12, TEXT); this.line(ML, this.y - 6, ML + 300, this.y - 6, MUTED, 0.6)
    this.y -= 17; this.textAt('DATE AND TIME SIGNED', ML, this.y, 'S', 7.5, MUTED, 1.2)
    this.y -= 12; for (const a of audit) { this.y -= 11; this.textAt(a, ML, this.y, 'R', 7.5, MUTED) }
    this.y -= 6
  }
  /** the company letterhead (page 1) or the slim running header (later pages) */
  letterhead(right: string[], first: boolean) {
    if (first) {
      const h = this.logo(ML, PAGE_H - MT + 2, 150); let yy = PAGE_H - MT - 4
      this.textAt(right[0], PAGE_W - MR, yy, 'S', 9.5, NAVY, 0, 'right'); for (const r of right.slice(1)) { yy -= 13; this.textAt(r, PAGE_W - MR, yy, 'R', 8.5, MUTED, 0, 'right') }
      const bottom = Math.min(PAGE_H - MT - h, yy) - 12; this.line(ML, bottom, PAGE_W - MR, bottom, GOLD, 2.5); this.y = bottom - 22
    } else { this.textAt(right[0], PAGE_W - MR, PAGE_H - 30, 'S', 8, MUTED, 0, 'right'); this.line(ML, PAGE_H - 40, PAGE_W - MR, PAGE_H - 40, RULE, 0.8); this.y = PAGE_H - 58 }
  }
  footer(text: string) { this.footerText = text }
  private footerOps(pageNo: number, total: number) {
    const ops: string[] = []; const y = 38
    ops.push(`q ${col(RULE)} RG 0.8 w ${ML} ${y + 14} m ${PAGE_W - MR} ${y + 14} l S Q`)
    const w = textWidth(this.footerText, 'S', 7.8); ops.push(`BT ${col(NAVY)} rg /F2 7.8 Tf 0 Tc ${((PAGE_W - w) / 2).toFixed(2)} ${y} Td ${pdfStr(codes(this.footerText))} Tj ET`)
    const pg = `Page ${pageNo} of ${total}`; ops.push(`BT ${col(MUTED)} rg /F1 7.5 Tf 0 Tc ${(PAGE_W - MR - textWidth(pg, 'R', 7.5)).toFixed(2)} ${y - 13} Td ${pdfStr(codes(pg))} Tj ET`)
    return ops
  }
  build(): Uint8Array {
    const chunks: (string | Uint8Array)[] = []; const offsets: number[] = []; let pos = 0
    const enc = new TextEncoder(); const push = (c: string | Uint8Array) => { chunks.push(c); pos += c.length }   // strings are written byte-per-char (latin1): every string here is ASCII except the header comment
    const objs: (string | Uint8Array)[][] = []; const add = (parts: (string | Uint8Array)[]) => { objs.push(parts); return objs.length }
    add(['<< /Type /Catalog /Pages 2 0 R >>']); add(['PAGES'])
    const fontIds: Record<string, number> = {}
    for (const k of ['R', 'S', 'B'] as FontKey[]) {
      const m = FONTS[k].meta; const bytes = Uint8Array.from(atob(m.data), (c) => c.charCodeAt(0))
      const file = add([`<< /Length ${bytes.length} /Length1 ${bytes.length} >>\nstream\n`, bytes, '\nendstream'])
      const desc = add([`<< /Type /FontDescriptor /FontName /${m.name} /Flags 32 /FontBBox [${m.bbox.join(' ')}] /ItalicAngle ${m.italicAngle} /Ascent ${m.ascent} /Descent ${m.descent} /CapHeight ${m.capHeight} /StemV 80 /FontFile2 ${file} 0 R >>`])
      fontIds[FONTS[k].res] = add([`<< /Type /Font /Subtype /TrueType /BaseFont /${m.name} /FirstChar 32 /LastChar 255 /Widths [${m.widths.join(' ')}] /Encoding /WinAnsiEncoding /FontDescriptor ${desc} 0 R >>`])
    }
    const logoBytes = Uint8Array.from(atob(LOGO_JPEG.data), (c) => c.charCodeAt(0))
    const imgId = add([`<< /Type /XObject /Subtype /Image /Width ${LOGO_JPEG.width} /Height ${LOGO_JPEG.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logoBytes.length} >>\nstream\n`, logoBytes, '\nendstream'])
    const total = this.pages.length; const pageIds: number[] = []
    this.pages.forEach((ops, i) => {
      const content = [...ops, ...(this.footerText ? this.footerOps(i + 1, total) : [])].join('\n')
      const cid = add([`<< /Length ${enc.encode(content).length} >>\nstream\n${content}\nendstream`])
      pageIds.push(add([`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${fontIds.F1} 0 R /F2 ${fontIds.F2} 0 R /F3 ${fontIds.F3} 0 R >> /XObject << /Im1 ${imgId} 0 R >> >> /Contents ${cid} 0 R >>`]))
    })
    objs[1] = [`<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>`]
    const infoId = add([`<< /Title ${pdfStr(codes(this.title))} /Producer (Caring Companions Hub) >>`])
    push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')
    objs.forEach((parts, i) => { offsets.push(pos); push(`${i + 1} 0 obj\n`); for (const p of parts) push(p); push('\nendobj\n') })
    const xref = pos
    push(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join(''))
    push(`trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
    const out = new Uint8Array(pos); let at = 0
    for (const c of chunks) { const b = typeof c === 'string' ? latin1(c) : c; out.set(b, at); at += b.length }
    return out
  }
}
/* the PDF header's binary comment and the text parts: strings are ASCII except that comment, kept byte-for-byte */
function latin1(s: string): Uint8Array { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff; return b }

export const COMPANY_RIGHT = ['Caring Companions In-Home Senior Care', '1331 N. Stewart Ave., Suite B,', 'Springfield, MO 65802', '(417) 234-8494 · mo-care.com']
export const FOOTER = 'Caring Companions In-Home Senior Care · 1331 N. Stewart Ave., Suite B, Springfield, MO 65802 · (417) 234-8494 · mo-care.com'
export type Signature = { typedName: string; signedAtCentral: string; signedAtUtc: string; ip: string; agent: string; version: number; fingerprint: string; offerId: string; docName: string }
const splitLabel = (t: string): [string, string] | null => { const m = /^(Date|Dear|Position|Employment classification|Starting Pay):\s*(.*)$/.exec(t); return m ? [m[1] + ':', m[2]] : null }

/** The offer letter, from the same blocks the page shows (nothing re-worded), in the letterhead. */
export function offerLetterPdf(blocks: Block[], first: string, last: string, sig: Signature | null): Uint8Array {
  const pdf = new BrandPdf(`Offer of employment - ${first} ${last}`); pdf.footer(FOOTER)
  pdf.headerFn = (p, f) => p.letterhead(COMPANY_RIGHT, f); pdf.letterhead(COMPANY_RIGHT, true)
  let afterIssued = false
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    if (i === 0 && b.k === 'small') continue   // the letterhead line is drawn as the letterhead
    if (b.k === 'h') { if (/^ACCEPTANCE/.test(b.t)) { pdf.ensure(sig ? 290 : 160); pdf.hr(RULE, 14) } pdf.heading(b.t); continue }
    if (b.k === 'li') { pdf.bullet(b.t); continue }
    if (b.k === 'q') { pdf.box(b.t); continue }
    if (b.k === 'small') { if (/^Issued by/.test(b.t)) { afterIssued = true; pdf.para(b.t, { size: 8.5, color: MUTED, after: 4 }) } else if (/^Document version/.test(b.t)) { /* printed with the signature audit */ } else pdf.para(b.t, { size: 8.5, color: MUTED, after: 6 }); continue }
    const lab = splitLabel(b.t)
    if (lab) { pdf.labelled(lab[0], lab[1], { after: lab[0] === 'Dear:' ? 8 : 2 }); if (lab[0] === 'Date:') pdf.y -= 4; continue }
    if (b.t === 'Warmly,') { pdf.ensure(100); pdf.para(b.t, { after: 2 }); continue }
    if (/^Samantha Troutman, Co-Founder & CEO/.test(b.t)) {
      pdf.para('Samantha Troutman', { font: 'B', size: 15, color: NAVY, lh: 22, after: 0 }); pdf.para('Co-Founder & CEO', { size: 9.5, color: MUTED, lh: 13, after: 0 }); pdf.para('Caring Companions In-Home Senior Care', { font: 'S', size: 9.5, color: NAVY, lh: 13, after: 8 }); continue
    }
    if (/^Dear /.test(b.t)) { pdf.labelled('Dear', b.t.replace(/^Dear /, ''), { after: 8 }); continue }
    if (/^Your onboarding starts here!$/.test(b.t) || /^The sooner you complete/.test(b.t)) { pdf.para(b.t, { font: 'S', color: NAVY, after: 8 }); continue }
    pdf.para(b.t, { after: 8 })
  }
  if (sig) {
    pdf.signatureArea(sig.typedName, sig.signedAtCentral, [`Signed electronically with consent given on the signing page. ${sig.signedAtUtc} UTC. Device address ${sig.ip || 'not recorded'}. Browser ${sig.agent || 'not recorded'}.`,
      `${sig.docName}, document version ${sig.version}. Fingerprint ${sig.fingerprint}.`, `Offer record ${sig.offerId}.`])
  } else { pdf.ensure(80); pdf.y -= 30; pdf.line(ML, pdf.y, PAGE_W - MR, pdf.y, MUTED, 0.6); pdf.y -= 12; pdf.textAt('ELECTRONIC SIGNATURE', ML, pdf.y, 'S', 7.5, MUTED, 1.2) }
  void afterIssued
  return pdf.build()
}
/** The position description in the same letterhead style. */
export function positionDescriptionPdf(blocks: Block[], first: string, last: string, sig: Signature | null): Uint8Array {
  const pdf = new BrandPdf(`Position description - ${first} ${last}`); pdf.footer(FOOTER)
  const titleLine = blocks[0]?.t || 'Position description'; const title = titleLine.split(' · ')[0]; const edition = (titleLine.split(' · ')[2] || '').replace(/^Version 1 \(from the (.*)\)$/, '$1')
  const right = ['POSITION DESCRIPTION', edition || 'Version 1']
  pdf.headerFn = (p, f) => { if (f) { const h = p.logo(ML, PAGE_H - MT + 2, 150); p.textAt(right[0], PAGE_W - MR, PAGE_H - MT - 4, 'S', 8.5, GOLD_TEXT, 1.5, 'right'); p.textAt(right[1], PAGE_W - MR, PAGE_H - MT - 18, 'R', 8.5, MUTED, 0, 'right'); const bottom = PAGE_H - MT - h - 12; p.line(ML, bottom, PAGE_W - MR, bottom, GOLD, 2.5); p.y = bottom - 30 } else { p.textAt(title + ' · Position description', PAGE_W - MR, PAGE_H - 30, 'S', 8, MUTED, 0, 'right'); p.line(ML, PAGE_H - 40, PAGE_W - MR, PAGE_H - 40, RULE, 0.8); p.y = PAGE_H - 58 } }
  pdf.headerFn(pdf, true)
  pdf.para(title, { font: 'B', size: 26, color: NAVY, lh: 32, after: 2 }); pdf.rect(ML, pdf.y - 2, 60, 3, GOLD); pdf.y -= 16
  // the meta box: Reports to / FLSA / Category / Employment classification
  const meta = blocks[1]?.k === 'small' ? blocks[1].t : ''
  const LABELS = ['Reports to', 'FLSA status', 'Category', 'Employment classification']
  const cells: [string, string][] = []
  for (let i = 0; i < LABELS.length; i++) { const others = LABELS.filter((_, j) => j !== i).join('|'); const re = new RegExp(LABELS[i] + ':\\s*(.*?)(?=\\s*·\\s*(?:' + others + '):|$)'); const m = re.exec(meta); if (m) cells.push([LABELS[i].toUpperCase(), m[1].trim()]) }
  if (cells.length) {
    const w = PAGE_W - MR - ML, pad = 12, cols = 2, cw = (w - pad * 2) / cols, rowH = 44; const rows = Math.ceil(cells.length / cols); const h = pad * 2 + rows * rowH - 8
    pdf.ensure(h); const top = pdf.y; pdf.rect(ML, top - h, w, h, BEIGE, RULE, 0.8, 8)
    cells.forEach((c, i) => { const r = Math.floor(i / cols), ci = i % cols; const x = ML + pad + ci * cw, yy = top - pad - r * rowH; pdf.textAt(c[0], x, yy - 8, 'S', 6.8, MUTED, 1.2); wrap(c[1], 'S', 9.5, cw - 14).slice(0, 2).forEach((ln, k) => pdf.textAt(ln, x, yy - 21 - k * 12, 'S', 9.5, NAVY)) })
    pdf.y = top - h - 14
  }
  for (let i = 2; i < blocks.length; i++) {
    const b = blocks[i]
    if (b.k === 'h') { pdf.heading(b.t); continue }
    if (b.k === 'li') { pdf.bullet(b.t); continue }
    if (b.k === 'small') { if (/^Document version/.test(b.t)) continue; if (/^Caring Companions In-Home Senior Care ·/.test(b.t)) continue; if (/^Issued by/.test(b.t)) pdf.ensure(sig ? 250 : 90); pdf.para(b.t, { size: 8.5, color: MUTED, after: 6 }); continue }
    pdf.para(b.t, { after: 8 })
  }
  if (sig) {
    pdf.signatureArea(sig.typedName, sig.signedAtCentral, [`Signed electronically with consent given on the signing page. ${sig.signedAtUtc} UTC. Device address ${sig.ip || 'not recorded'}. Browser ${sig.agent || 'not recorded'}.`,
      `${sig.docName}, document version ${sig.version}. Fingerprint ${sig.fingerprint}.`, `Offer record ${sig.offerId}.`])
  }
  return pdf.build()
}
