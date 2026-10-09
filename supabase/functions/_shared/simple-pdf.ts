// =============================================================================
// simple-pdf.ts · a small, dependency-free PDF writer for signed documents (SLICE 1b, 2026-10-08).
// =============================================================================
// Letter pages, Helvetica, wrapped text, headings in bold, bullets indented. Deterministic: the same blocks give the
// same bytes, so a stored PDF can be re-derived and compared. Characters outside WinAnsi are replaced with their
// nearest ASCII so the standard fonts can show them.
export type PdfBlock = { k: 'h' | 'p' | 'li' | 'small' | 'q' | 'title' | 'gap'; t: string }
const PAGE_W = 612, PAGE_H = 792, MARGIN = 54, LINE = 14
const clean = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/–|—/g, '-').replace(/·/g, '-').replace(/…/g, '...').replace(/[^\x20-\x7e]/g, '?')
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
function wrap(text: string, size: number, width: number): string[] {
  const maxChars = Math.max(10, Math.floor(width / (size * 0.52)))
  const out: string[] = []
  for (const para of clean(text).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean); let line = ''
    for (const w of words) {
      if ((line + ' ' + w).trim().length > maxChars) { if (line) out.push(line); line = w }
      else line = (line + ' ' + w).trim()
    }
    out.push(line)
  }
  return out
}
export function makePdf(blocks: PdfBlock[], meta: { title: string }): Uint8Array {
  const pages: string[][] = [[]]; let y = PAGE_H - MARGIN
  const ensure = (need: number) => { if (y - need < MARGIN) { pages.push([]); y = PAGE_H - MARGIN } }
  const put = (font: string, size: number, x: number, line: string) => { pages[pages.length - 1].push(`BT /${font} ${size} Tf ${x} ${y.toFixed(1)} Td (${esc(line)}) Tj ET`); y -= LINE * (size > 11 ? size / 11 : 1) }
  for (const b of blocks) {
    if (b.k === 'gap') { y -= LINE; continue }
    const size = b.k === 'title' ? 16 : b.k === 'h' ? 11.5 : b.k === 'small' ? 8.5 : 10
    const font = b.k === 'h' || b.k === 'title' ? 'F2' : 'F1'
    const indent = b.k === 'li' ? 16 : b.k === 'q' ? 12 : 0
    const lines = wrap(b.t, size, PAGE_W - 2 * MARGIN - indent)
    if (b.k === 'h' || b.k === 'title') { y -= 6; ensure(LINE * (lines.length + 1)) }
    lines.forEach((ln, i) => { ensure(LINE); put(font, size, MARGIN + indent, b.k === 'li' && i === 0 ? '- ' + ln : ln) })
    if (b.k === 'p' || b.k === 'q' || b.k === 'small') y -= 4
  }
  // objects: 1 catalog, 2 pages, 3 F1, 4 F2, then per page: page obj + content obj
  const objs: string[] = []
  const add = (s: string) => { objs.push(s); return objs.length }
  add('<< /Type /Catalog /Pages 2 0 R >>')
  add('PAGES')
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
  const pageIds: number[] = []
  for (const p of pages) {
    const content = p.join('\n')
    const cid = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`)
    pageIds.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${cid} 0 R >>`))
  }
  objs[1] = `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] /Count ${pageIds.length} >>`
  const infoId = add(`<< /Title (${esc(clean(meta.title))}) /Producer (Caring Companions Hub) >>`)
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'; const offsets: number[] = []
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new Uint8Array([...out].map((c) => c.charCodeAt(0) & 0xff))
}
