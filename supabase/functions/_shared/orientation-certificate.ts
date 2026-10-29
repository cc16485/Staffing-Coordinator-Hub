// =============================================================================
// orientation-certificate.ts · a missing orientation certificate, made from the REAL completion record (Samantha 2026-10-28:
// "If a caregiver completed orientation but the certificate was never saved, automatically generate it from the verified
// completion record when possible. Preserve the original completion date. Do not fabricate certificates or completion
// records.")
// =============================================================================
// The same certificate the Training Platform draws in the browser (src/features/learner/course/certificatePdf.ts): letter
// landscape, gold border, "CERTIFICATE OF COMPLETION", the name, "has successfully completed the required 2.0-hour",
// "Agency Orientation", the completion date and the trainer's name. Two honest differences: the wordmark in place of the
// logo image (the server can't draw the logo file), and one small line at the bottom saying it was made from the Training
// Platform's completion record, and when. The date printed is ALWAYS the original completion date.
// mayGenerate says when that is allowed: only for a course finished ON the Training Platform (status complete, a completion
// date, no after-the-fact document). A completion typed in by hand with an uploaded document already has its proof (the
// document); a certificate is never made for it, and never for anything not complete.
// =============================================================================
import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1'

// deno-lint-ignore no-explicit-any
type Any = any
const S = (v: unknown, n = 200) => String(v ?? '').trim().slice(0, n)
export const ORIENTATION = { slug: 'agency-orientation', title: 'Agency Orientation', hours: 2.0 }

/** May a certificate be made from this Training enrollment row? Never invents anything: the row must already say complete. */
export function mayGenerate(e: Any): { ok: boolean; why: string | null } {
  if (!e) return { ok: false, why: 'no orientation on the Training Platform' }
  if (S(e.status, 20) !== 'complete') return { ok: false, why: 'orientation is not complete on the Training Platform' }
  if (!/^\d{4}-\d\d-\d\d/.test(S(e.completed_at, 30))) return { ok: false, why: 'the completion has no date' }
  if (S(e.completion_doc_path, 300)) return { ok: false, why: 'it was entered after the fact with its own document, which is the proof' }
  return { ok: true, why: null }
}

const longDate = (ymd: string) => new Date(ymd.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })

/** The certificate PDF. completedOn = the ORIGINAL completion date (YYYY-MM-DD); madeOn = today (YYYY-MM-DD). */
export async function certificatePdf(name: string, completedOn: string, madeOn: string): Promise<Uint8Array> {
  const nm = S(name, 80) || 'Caregiver'
  const doc = await PDFDocument.create()
  doc.setTitle(`${ORIENTATION.title} certificate: ${nm}`); doc.setAuthor('Caring Companions'); doc.setSubject(`Completed ${completedOn}`)
  doc.setCreationDate(new Date(madeOn + 'T12:00:00Z')); doc.setModificationDate(new Date(madeOn + 'T12:00:00Z'))
  const W = 792, H = 612, cx = W / 2
  const p = doc.addPage([W, H])
  const helv = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold), times = await doc.embedFont(StandardFonts.TimesRomanBold)
  const NAVY = rgb(14 / 255, 56 / 255, 96 / 255), GOLD = rgb(197 / 255, 142 / 255, 7 / 255), GOLDB = rgb(244 / 255, 181 / 255, 38 / 255)
  const GREY = rgb(138 / 255, 147 / 255, 156 / 255), INK = rgb(68 / 255, 81 / 255, 93 / 255)
  /* pdf-lib's y runs up from the bottom; the browser certificate's y runs down from the top */
  const at = (y: number) => H - y
  const center = (t: string, y: number, f: Any, size: number, color: Any) => p.drawText(t, { x: cx - f.widthOfTextAtSize(t, size) / 2, y: at(y), size, font: f, color })
  const centerAt = (t: string, x: number, y: number, f: Any, size: number, color: Any) => p.drawText(t, { x: x - f.widthOfTextAtSize(t, size) / 2, y: at(y), size, font: f, color })
  p.drawRectangle({ x: 20, y: 20, width: W - 40, height: H - 40, borderColor: GOLD, borderWidth: 3 })
  p.drawRectangle({ x: 30, y: 30, width: W - 60, height: H - 60, borderColor: NAVY, borderWidth: 0.75 })
  center('CARING COMPANIONS', 80, bold, 16, NAVY)
  center('QUALITY CAREGIVERS · 24 · 7 · 365', 94, helv, 8, GREY)
  center('C E R T I F I C A T E   O F   C O M P L E T I O N', 158, bold, 13, GOLD)
  p.drawLine({ start: { x: cx - 30, y: at(170) }, end: { x: cx + 30, y: at(170) }, thickness: 2, color: GOLDB })
  center('This certifies that', 200, helv, 13, INK)
  let size = 42; while (size > 22 && times.widthOfTextAtSize(nm, size) > W - 180) size -= 2
  center(nm, 248, times, size, NAVY)
  const nameW = Math.min(times.widthOfTextAtSize(nm, size) + 60, W - 160)
  p.drawLine({ start: { x: cx - nameW / 2, y: at(260) }, end: { x: cx + nameW / 2, y: at(260) }, thickness: 1, color: GOLD })
  center(`has successfully completed the required ${ORIENTATION.hours.toFixed(1)}-hour`, 292, helv, 13, INK)
  center(ORIENTATION.title, 320, bold, 21, NAVY)
  center('Caring Companions In-Home Senior Care', 340, helv, 11, GREY)
  const footY = H - 96, leftX = W * 0.28, rightX = W * 0.72
  p.drawLine({ start: { x: leftX - 90, y: at(footY) }, end: { x: leftX + 90, y: at(footY) }, thickness: 0.75, color: NAVY })
  p.drawLine({ start: { x: rightX - 90, y: at(footY) }, end: { x: rightX + 90, y: at(footY) }, thickness: 0.75, color: NAVY })
  centerAt(longDate(completedOn), leftX, footY - 8, bold, 15, NAVY)
  centerAt('Samantha Troutman', rightX, footY - 8, times, 17, NAVY)
  centerAt('DATE COMPLETED', leftX, footY + 14, helv, 9, GREY)
  centerAt('DESIGNATED TRAINER · CO-FOUNDER & CEO', rightX, footY + 14, helv, 9, GREY)
  center('*', footY - 6, bold, 22, GOLD)
  center(`Made on ${longDate(madeOn)} from the Training Platform's record of this course, completed ${longDate(completedOn)}.`, H - 44, helv, 7.5, GREY)
  return await doc.save()
}
