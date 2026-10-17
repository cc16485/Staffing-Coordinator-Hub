// =============================================================================
// agreement-family-sign · the family's signature on a Client Care Agreement, ONE way for both places it happens
// (874): on the office tablet (client-agreement 'sign', where the office person's session is recorded) and from home
// (agreement-sign 'sign', where the link and the 6-digit code check are recorded). Same answers check, same required
// answers, same six initials, same finger-signature rules, same stale-row guard. Moved here unchanged from
// client-agreement/index.ts.
// =============================================================================
import { BUCKET, ESIGN_WORDS, INITIALS, VERSION, PDF_SHA256, cleanAnswers, readyToSign, initialsOf, signatureOk, initialsComplete, type Answers } from './client-agreement.ts'

// deno-lint-ignore no-explicit-any
type Any = any
const S = (v: unknown, n: number) => String(v ?? '').slice(0, n)
const pngBytes = (dataUrl: string) => Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0))
const stampOf = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')

/** Returns [http status, reply body]. `where` is what the signature record says about how it was signed. */
export async function familySign(db: Any, r: Any, b: Any, meta: { ip: string; agent: string; where: Record<string, unknown> }): Promise<[number, Any]> {
  if (r.status !== 'draft') return [409, { error: 'This agreement is already signed.', outcome: 'stale' }]
  // 2026-10-17: the wording changed (8-hour weekly minimum). A draft started on the earlier wording can't be signed: the
  // pages the family reads are the current ones, so the office starts a new agreement instead.
  if (r.pdf_sha256 !== PDF_SHA256) return [409, { error: 'This agreement was started before the wording was updated. Please ask the office to start a new one.', outcome: 'old_version' }]
  if (b.consent !== true) return [400, { error: 'Please tick the box to agree to sign electronically.', field: 'consent' }]
  const fam = cleanAnswers(b.answers || {}, 'family')
  if (fam.problems.length) return [422, { error: 'Some answers are not right.', problems: fam.problems }]
  const all: Answers = { ...(r.office?.answers || {}), ...fam.answers }
  const signer = { name: S(b.signer?.name, 80).trim().replace(/\s+/g, ' '), role: S(b.signer?.role, 20), relationship: S(b.signer?.relationship, 40).trim() }
  const problems = [...readyToSign(all, signer), ...initialsComplete(b.initials, signer.role === 'representative')]
  if (!signatureOk(b.signature)) problems.push({ field: 'signature', error: 'Please sign with your finger in the box.' })
  if (problems.length) return [422, { error: 'A few things are still needed before signing.', problems }]
  const at = new Date().toISOString()
  const path = `sig/${r.axiscare_client_id}/${r.id}-client-${stampOf(at)}.png`
  const up = await db.storage.from(BUCKET).upload(path, pngBytes(b.signature), { contentType: 'image/png', upsert: false })
  if (up.error) throw up.error
  const taps = Object.fromEntries(Object.entries(b.initials || {}).filter(([k]) => k in INITIALS || k === 'poa').map(([k, v]) => [k, S(v, 40)]))
  const client_sign = { typed_name: signer.name, role: signer.role, relationship: signer.relationship || null, initials_text: initialsOf(signer.name), initials_taps: taps,
    at, ip: meta.ip, agent: meta.agent, consent: true, consent_words: ESIGN_WORDS, signature_path: path, version: VERSION, pdf_sha256: PDF_SHA256, ...meta.where }
  const { data: did, error } = await db.from('client_agreements').update({ answers: fam.answers, client_sign, status: 'signed', signed_at: at, updated_at: at })
    .eq('id', r.id).eq('status', 'draft').select('id')
  if (error) throw error
  if (!did?.length) return [409, { error: 'This agreement changed while you were signing. Open it again.', outcome: 'stale' }]
  return [200, { ok: true, outcome: 'signed', at, signer: signer.name }]
}
