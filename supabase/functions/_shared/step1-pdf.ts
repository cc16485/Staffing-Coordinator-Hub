// =============================================================================
// step1-pdf.ts · the signed Step 1 forms as branded PDFs (SLICE 2b, Samantha "start slice 2b", 2026-10-10)
// =============================================================================
// One PDF per form, in the company letterhead, built from the SAME versioned words as the screen (step1-documents.ts,
// fingerprinted there) with the caregiver's answers merged in, then the typed electronic signature and its audit record.
// Not a word here changes the form: this file only lays out. Locked identity values are never printed: the Social
// Security number, the date of birth and the driver's license number appear as "on file" with the last four characters
// at most, exactly as the record shows them to the office.
import { BrandPdf, COMPANY_RIGHT, FOOTER, MUTED, NAVY, RULE, type Signature } from './brand-pdf.ts'
import { SKILLS, type Form, type Item } from './step1-documents.ts'

export type Who = { first: string; last: string; phone: string; email: string; position: string }
export type IdentityState = { ssn: string | null; dob: boolean; license: string | null; nurse_license?: string | null }   // "ending 1234" | null (nurse_license: LPN HIRING 2026-10-14, only on a nurse's Step 1)
const S = (v: unknown) => String(v ?? '').trim()

/** An answer as the words that go on paper. */
export function answerText(item: Item, v: unknown, ident: IdentityState): string {
  if (item.locked) {
    if (item.id === 'ssn') return ident.ssn ? `On file, ${ident.ssn} (encrypted; never printed)` : 'Not provided'
    if (item.id === 'dob') return ident.dob ? 'On file (encrypted; never printed)' : 'Not provided'
    if (item.id === 'license_number') return ident.license ? `On file, ${ident.license} (encrypted; never printed)` : 'Not provided'
    if (item.id === 'nurse_license_number') return ident.nurse_license ? `On file, ${ident.nurse_license} (encrypted; never printed)` : 'Not provided'
  }
  if (v == null || v === '') return 'Not provided'
  switch (item.kind) {
    case 'yesno': return v === true || v === 'yes' ? 'Yes' : v === false || v === 'no' ? 'No' : S(v)
    case 'multi': return Array.isArray(v) ? v.map(S).filter(Boolean).join(', ') || 'Not provided' : S(v)
    case 'photo': return v ? 'Provided' : 'Not provided'
    case 'table': {
      /* the weekly grid, the specialties and the matching facts are maps (option -> answer); the rest are rows */
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const lines = Object.entries(v as Record<string, unknown>).map(([k, c]) => {
          if (c && typeof c === 'object' && !Array.isArray(c)) { const on = Object.entries(c as Record<string, unknown>).filter(([, x]) => x === true || (typeof x === 'string' && x.trim())).map(([kk, x]) => x === true ? kk : `${kk} ${S(x)}`); return `${k}: ${on.join(', ') || 'Not provided'}` }
          return `${k}: ${S(c) || 'Not provided'}`
        })
        return lines.join('\n') || 'Not provided'
      }
      if (!Array.isArray(v) || !v.length) return 'Not provided'
      const cols = item.options || []
      return v.map((row: unknown, i: number) => {
        if (Array.isArray(row)) return `${i + 1}. ` + row.map((c, j) => `${cols[j] ?? 'Column ' + (j + 1)}: ${S(c) || 'Not provided'}`).join('; ')
        if (row && typeof row === 'object') return `${i + 1}. ` + Object.entries(row as Record<string, unknown>).map(([k, c]) => `${k}: ${S(c) || 'Not provided'}`).join('; ')
        return `${i + 1}. ${S(row)}`
      }).join('\n')
    }
    case 'cards': {
      /* 2026-10-11: one numbered block per job, family-care entry or reference; tasks by their names */
      if (!Array.isArray(v) || !v.length) return 'Not provided'
      const yn = (x: unknown) => x === 'yes' ? 'Yes' : x === 'no' ? 'No' : S(x)
      return v.map((row: unknown, i: number) => {
        const r = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>
        const parts = (item.fields || []).filter((f) => r[f.k] != null && r[f.k] !== '' && !(Array.isArray(r[f.k]) && !(r[f.k] as unknown[]).length)).map((f) => {
          const x = r[f.k]
          const val = f.kind === 'skills' || f.kind === 'refresher' ? (x as string[]).map((k) => k === 'none' ? 'None, ready for all of these' : SKILLS[k] || k).join(', ') : Array.isArray(x) ? x.map(S).join(', ') : f.kind === 'yesno' ? yn(x) : S(x)
          return `${f.label.replace(/\s*\((optional|month and year[^)]*)\)/g, '').replace(/\?$/, '')}: ${val}`
        })
        return `${i + 1}. ` + (parts.join('; ') || 'Not provided')
      }).join('\n')
    }
    default: return S(v)
  }
}

/** The form, its answers and (when signed) the signature, in the letterhead. */
/** company: the signature for Caring Companions (countersigned forms), printed under the employee's */
export function step1FormPdf(form: Form, answers: Record<string, unknown>, who: Who, ident: IdentityState, sig: Signature | null, formNo: number, formCount: number, company?: Signature & { byEmail?: string }): Uint8Array {
  const pdf = new BrandPdf(`${form.title} - ${who.first} ${who.last}`); pdf.footer(FOOTER)
  pdf.headerFn = (p, f) => p.letterhead(COMPANY_RIGHT, f); pdf.letterhead(COMPANY_RIGHT, true)
  pdf.para(form.title, { font: 'B', size: 18, color: NAVY, lh: 23, after: 2 })
  pdf.para(`Step 1 new-hire paperwork · form ${formNo} of ${formCount} · version ${form.version} · ${who.position || 'Caregiver'}`, { size: 8.5, color: MUTED, after: 4 })
  pdf.labelled('Employee:', `${who.first} ${who.last}`.trim(), { after: 1 })
  pdf.labelled('Phone / email:', [who.phone, who.email].filter(Boolean).join(' · ') || 'Not provided', { after: 8 })
  for (const p of form.intro || []) pdf.para(p, { after: 8 })
  for (const sec of form.sections) {
    pdf.heading(sec.h)
    for (const p of sec.p || []) pdf.para(p, { after: 6 })
    if (sec.tip) pdf.para(sec.tip, { font: 'B', after: 6 })
    for (const it of sec.items || []) {
      if (it.kind === 'statement') { pdf.para(it.label, { after: 6 }); continue }
      const val = answerText(it, answers[it.id], ident)
      if (val.includes('\n') || val.length > 70) { pdf.para(it.label, { font: 'S', size: 9.5, color: MUTED, lh: 13, after: 1 }); pdf.para(val, { after: 6 }) }
      else pdf.labelled(it.label + ':', val, { after: 3 })
    }
  }
  /* 2026-10-13: a form with ONE deciding choice (the Hepatitis B form). The choice is passed in as answers.__choice for the
     PDF only (it is never a stored Step 1 answer); every option is printed, the chosen one marked. For a declination the
     Appendix A statement is printed word for word. With no choice (a reading copy) nothing is marked. */
  if (form.choices) {
    const ch = S(answers.__choice)
    pdf.hr(RULE, 10); pdf.heading(form.choices.label)
    for (const o of form.choices.options) pdf.para((ch === o.id ? '[X] ' : '[  ] ') + o.label, { font: ch === o.id ? 'B' : undefined, after: 4 })
    if (form.decline && ch === form.decline.choice) {
      pdf.heading(form.decline.title); pdf.para(form.decline.intro, { size: 9.5, color: MUTED, after: 6 })
      pdf.para(form.decline.statement, { after: 6 }); pdf.para(form.decline.consent + ' Agreed.', { font: 'B', after: 6 })
    }
  }
  pdf.hr(RULE, 10); pdf.heading('Certification')
  for (const c of form.certification) pdf.para(c, { after: 8 })
  if (form.signature === 'typed+initials' && answers.initials) pdf.labelled('Initials (AxisCare scheduling line):', S(answers.initials), { after: 6 })
  if (sig) {
    pdf.ensure(290)
    pdf.signatureArea(sig.typedName, sig.signedAtCentral, [
      `Signed electronically with consent given on the Step 1 page. ${sig.signedAtUtc} UTC. Device address ${sig.ip || 'not recorded'}. Browser ${sig.agent || 'not recorded'}.`,
      `${sig.docName}, form version ${sig.version}. Wording fingerprint ${sig.fingerprint}.`, `Offer record ${sig.offerId}.`])
  } else { pdf.ensure(80); pdf.y -= 30; pdf.line(60, pdf.y, 552, pdf.y, MUTED, 0.6); pdf.y -= 12; pdf.textAt('ELECTRONIC SIGNATURE', 60, pdf.y, 'S', 7.5, MUTED, 1.2) }
  if (company) {
    pdf.heading('For Caring Companions'); pdf.ensure(290)
    pdf.signatureArea(company.typedName, company.signedAtCentral, [
      `Signed electronically for Troutman Enterprises, LLC DBA Caring Companions In-Home Senior Care by ${company.typedName}${company.byEmail ? ' (' + company.byEmail + ')' : ''}, a person authorized to sign for the Company. ${company.signedAtUtc} UTC. Device address ${company.ip || 'not recorded'}.`,
      `${company.docName}, form version ${company.version}. Wording fingerprint ${company.fingerprint}.`, `Offer record ${company.offerId}.`])
  }
  return pdf.build()
}
