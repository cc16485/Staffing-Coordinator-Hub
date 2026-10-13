// =============================================================================
// drug-test · THE DRUG TEST RECORD (Samantha's ruling, 2026-10-13)
// =============================================================================
// Her words: "Caring Companions does NOT routinely drug test every applicant after an offer. We conduct drug testing only
// under certain circumstances, based on company policy and applicable law. ... Do not make drug testing a standard Step 1
// requirement. Do not automatically trigger drug testing for every new hire. Allow authorized management to initiate and
// document testing when required by our policy. Do not invent testing circumstances or grounds that we have not approved."
//
// So this function only keeps what management types. It sends nothing, raises no card, writes no readiness row, has no
// schedule and is called by nothing but a person's press on the Hub. The reason is management's own words (required, free
// text); there is no list of grounds anywhere. Every line is permanent (drug_test_entry is append-only): a correction is a
// new line that names the line it corrects.
//
// WHO: office staff by their own Hub sign-in (owner_admin, care_coordinator, staffing_coordinator) may ask; only OWNERS
// (staff_roles owner_admin) record. A test's details and result are shown only to owners and to the person who requested
// it; anyone else sees only that a record exists.
//
// API (POST JSON; answers { ok: true, ... } or { ok: false, error } with an HTTP status)
//   get        { offer_id?, caregiver_id?, candidate_id?, applicant_id? }  (any that are known for the person)
//              -> { may_record, tests: [ full test | { id, restricted: true } ] }  full test = { id, date_requested,
//                 requested_by: { name, email }, reason, test_type, notes, result, result_date, has_proof, proof_entry_id,
//                 history: [lines, oldest first] }
//   request    { ...person keys, name?, date_requested (YYYY-MM-DD), reason, test_type?, notes? }  owners  -> { test_id }
//   upload_url { test_id, content_type }  owners  -> { path, token, url }  a signed upload slot in drug-test-docs
//   result     { test_id, result, result_date?, proof_path?, proof_content_type?, notes? }  owners  -> { entry_id }
//              (result_date is needed for negative, positive and refused; the proof path must be this test's slot)
//   correct    { entry_id, correction_reason, ...the corrected fields }  owners  -> { entry_id }  a new line; nothing is
//              overwritten (a request's date, reason, test type, notes; a result's result, date, proof, notes)
//   open       { entry_id }  owners and the requester  -> { url, expires_in: 300 }  logged in document_access_log with your
//              name; refused (no link) when the log cannot be written
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { logOpen, ipOf } from '../_shared/doc-log.ts'
type Any = any
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const S = (v: unknown, n = 200) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').trim().slice(0, n)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const YMD = /^\d{4}-\d{2}-\d{2}$/
export const BUCKET = 'drug-test-docs', LINK_SECONDS = 300
export const RESULTS = ['pending', 'negative', 'positive', 'refused', 'cancelled'] as const
export const MIME: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/webp': 'webp', 'application/pdf': 'pdf' }
const KEYS = ['offer_id', 'caregiver_id', 'candidate_id', 'applicant_id'] as const
const isYmd = (v: unknown) => YMD.test(String(v ?? '')) && !Number.isNaN(Date.parse(String(v) + 'T12:00:00Z'))
const todayCentral = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
const slotFor = (testId: string, ct: string) => `dt/${testId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${MIME[ct]}`
const slotOk = (testId: string, p: string) => new RegExp(`^dt/${testId}/[A-Za-z0-9._-]{1,80}$`).test(p)

/** the person keys the page sent (any of them; each a short id) */
export function personKeys(b: Any): Record<string, string> {
  const o: Record<string, string> = {}
  for (const k of KEYS) { const v = S(b?.[k], 64); if (v && /^[A-Za-z0-9_.:-]+$/.test(v)) o[k] = v }
  return o
}
async function linesFor(db: Any, keys: Record<string, string>): Promise<Any[]> {
  const seen = new Map<string, Any>()
  for (const [k, v] of Object.entries(keys)) {
    const { data, error } = await db.from('drug_test_entry').select('*').eq(k, v)
    if (error) throw new Error('the drug test record could not be read')
    for (const r of data ?? []) seen.set(r.id, r)
  }
  /* the result and correction lines of those tests, even if they were saved under another of the person's keys */
  const ids = [...new Set([...seen.values()].map((r) => r.kind === 'request' ? r.id : r.test_id).filter(Boolean))]
  if (ids.length) { const { data } = await db.from('drug_test_entry').select('*').in('test_id', ids); for (const r of data ?? []) seen.set(r.id, r) }
  return [...seen.values()].sort((a, b) => String(a.at).localeCompare(String(b.at)) || String(a.id).localeCompare(String(b.id)))
}
/** a line as it stands now: the line itself with its newest correction applied (a correction never changes the line) */
function effective(line: Any, all: Any[]): Any {
  const fixes = all.filter((x) => x.kind === 'correction' && x.corrects === line.id)
  if (!fixes.length) return line
  const last = fixes[fixes.length - 1]
  const F = line.kind === 'request' ? ['date_requested', 'reason', 'test_type', 'notes'] : ['result', 'result_date', 'proof_path', 'proof_content_type', 'notes']
  const out = { ...line, corrected_by: last.id, corrected_at: last.at }
  for (const f of F) out[f] = last[f]
  return out
}
const pub = (x: Any) => ({ id: x.id, at: x.at, kind: x.kind, corrects: x.corrects ?? null, entered_by: x.entered_by_name || x.entered_by_email, date_requested: x.date_requested ?? null, reason: x.reason ?? null, test_type: x.test_type ?? null,
  result: x.result ?? null, result_date: x.result_date ?? null, has_proof: !!x.proof_path, notes: x.notes ?? null, correction_reason: x.correction_reason ?? null })
/** every test for the person, oldest first, with what this person may see */
export function testsView(all: Any[], who: { person_id?: string; email?: string }, owner: boolean): Any[] {
  return all.filter((x) => x.kind === 'request').map((req) => {
    const mine = owner || (!!who.person_id && req.requested_by_person === who.person_id) || (!!who.email && String(req.requested_by_email || '').toLowerCase() === String(who.email).toLowerCase())
    if (!mine) return { id: req.id, restricted: true }
    const r = effective(req, all), lines = all.filter((x) => x.id === req.id || x.test_id === req.id)
    const results = lines.filter((x) => x.kind === 'result').map((x) => effective(x, all))
    const last = results[results.length - 1] || null
    const proof = [...results].reverse().find((x) => x.proof_path) || null
    return { id: req.id, name: req.name || null, date_requested: r.date_requested, requested_by: { name: req.requested_by_name, email: req.requested_by_email }, reason: r.reason, test_type: r.test_type, notes: r.notes,
      result: last ? last.result : 'pending', result_date: last ? last.result_date : null, result_notes: last ? last.notes : null, result_entry_id: last ? last.id : null,
      has_proof: !!proof, proof_entry_id: proof ? proof.id : null,
      corrected: !!(r.corrected_by || results.some((x) => x.corrected_by)), history: lines.map(pub) }
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false, autoRefreshToken: false } })
  const b: Any = await req.json().catch(() => ({}))
  const action = S(b.action, 20)
  try {
    const who = await requireStaff(db, req, OFFICE_ROLES)
    if (!who.ok) return json({ ok: false, error: who.error }, who.status)
    const owner = (who.roles || []).includes('owner_admin')
    const by = { entered_by_name: who.name || null, entered_by_email: who.email, entered_by_person: who.person_id }
    const ownersOnly = () => json({ ok: false, error: 'Only an owner may record a drug test. Nothing was saved.' }, 403)
    if (action === 'get') {
      const keys = personKeys(b); if (!Object.keys(keys).length) return json({ ok: false, error: 'Which person?' }, 400)
      const all = await linesFor(db, keys)
      return json({ ok: true, may_record: owner, tests: testsView(all, who, owner) })
    }
    if (action === 'request') {
      if (!owner) return ownersOnly()
      const keys = personKeys(b); if (!Object.keys(keys).length) return json({ ok: false, error: 'Which person?' }, 400)
      const reason = S(b.reason, 2000), date = S(b.date_requested, 10)
      if (reason.length < 5) return json({ ok: false, error: 'Please write the reason in your own words (at least five characters). Nothing was saved.' }, 400)
      if (!isYmd(date) || date > todayCentral()) return json({ ok: false, error: 'Please give the date the test was requested (today or earlier). Nothing was saved.' }, 400)
      const { data, error } = await db.from('drug_test_entry').insert({ kind: 'request', ...keys, name: S(b.name, 120) || null, date_requested: date, requested_by_name: who.name || null, requested_by_email: who.email, requested_by_person: who.person_id,
        reason, test_type: S(b.test_type, 200) || null, notes: S(b.notes, 2000) || null, ...by }).select('id').maybeSingle()
      if (error || !data) return json({ ok: false, error: 'The record could not be saved' + (error ? ': ' + S(error.message, 120) : '') + '. Nothing was saved.' }, 500)
      return json({ ok: true, test_id: data.id })
    }
    /* everything below is about one test */
    const lineId = S(b.entry_id || b.test_id, 64); if (!UUID.test(lineId)) return json({ ok: false, error: 'Which record?' }, 400)
    const { data: line } = await db.from('drug_test_entry').select('*').eq('id', lineId).maybeSingle()
    if (!line) return json({ ok: false, error: 'That record was not found.' }, 404)
    const testId = line.kind === 'request' ? line.id : line.test_id
    const { data: reqRow } = await db.from('drug_test_entry').select('*').eq('id', testId).maybeSingle()
    if (!reqRow) return json({ ok: false, error: 'That record was not found.' }, 404)
    const keysOf = Object.fromEntries(KEYS.filter((k) => reqRow[k]).map((k) => [k, reqRow[k]]))
    if (action === 'open') {
      const mine = owner || reqRow.requested_by_person === who.person_id || String(reqRow.requested_by_email || '').toLowerCase() === who.email
      if (!mine) return json({ ok: false, error: 'Only an owner or the person who requested this test may open its documents.' }, 403)
      const all = await linesFor(db, keysOf), cur = effective(line, all)
      if (!cur.proof_path || !slotOk(testId, cur.proof_path)) return json({ ok: false, error: 'No document is on this line.' }, 404)
      const { data, error } = await db.storage.from(BUCKET).createSignedUrl(cur.proof_path, LINK_SECONDS)
      if (error || !data?.signedUrl) return json({ ok: false, error: 'Could not open the document.' }, 500)
      if (!(await logOpen(db, { subject: 'drugtest:' + testId, doc: 'drug test proof', path: cur.proof_path, who: { person_id: who.person_id, email: who.email, name: who.name }, reason: S(b.reason, 120) || 'opened on the drug test record', ip: ipOf(req) })))
        return json({ ok: false, error: 'The open could not be logged, so the document is not shown. Try again.' }, 500)
      return json({ ok: true, url: data.signedUrl, expires_in: LINK_SECONDS })
    }
    if (!owner) return ownersOnly()
    if (action === 'upload_url') {
      const ct = S(b.content_type, 60).toLowerCase()
      if (!MIME[ct]) return json({ ok: false, error: 'Use a photo (JPG, PNG, HEIC or WebP) or a PDF.' }, 400)
      const path = slotFor(testId, ct)
      const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path)
      if (error || !data) return json({ ok: false, error: 'Could not prepare the upload.' }, 500)
      return json({ ok: true, path, token: data.token, url: data.signedUrl })
    }
    /* the result fields, checked the same way for a result and for a result's correction */
    const resultFields = async (base: Any = {}) => {
      const result = b.result !== undefined ? S(b.result, 20) : base.result
      if (!(RESULTS as readonly string[]).includes(result)) return { error: 'Which result: pending, negative, positive, refused or cancelled?' }
      const date = b.result_date !== undefined ? S(b.result_date, 10) : (base.result_date || '')
      if (date && (!isYmd(date) || date > todayCentral())) return { error: 'The result date must be a real date, today or earlier.' }
      if (!date && ['negative', 'positive', 'refused'].includes(result)) return { error: 'Please give the result date.' }
      let proof_path = base.proof_path || null, proof_content_type = base.proof_content_type || null
      if (b.proof_path) {
        proof_path = S(b.proof_path, 500); proof_content_type = S(b.proof_content_type, 60).toLowerCase()
        if (!slotOk(testId, proof_path) || !MIME[proof_content_type]) return { error: 'That file is not this test\'s upload.' }
        const i = proof_path.lastIndexOf('/'); const { data: f, error: fe } = await db.storage.from(BUCKET).list(proof_path.slice(0, i), { search: proof_path.slice(i + 1) })
        if (fe || !Array.isArray(f) || !f.some((x: Any) => x?.name === proof_path!.slice(i + 1))) return { error: 'The file did not arrive. Upload it again.' }
      }
      return { result, result_date: date || null, proof_path, proof_content_type, notes: b.notes !== undefined ? (S(b.notes, 2000) || null) : (base.notes ?? null) }
    }
    if (action === 'result') {
      if (line.kind !== 'request') return json({ ok: false, error: 'Record a result on the test itself.' }, 400)
      const f: Any = await resultFields(); if (f.error) return json({ ok: false, error: f.error + ' Nothing was saved.' }, 400)
      const { data, error } = await db.from('drug_test_entry').insert({ kind: 'result', test_id: testId, ...keysOf, name: reqRow.name, ...f, ...by }).select('id').maybeSingle()
      if (error || !data) return json({ ok: false, error: 'The result could not be saved. Nothing was saved.' }, 500)
      return json({ ok: true, entry_id: data.id })
    }
    if (action === 'correct') {
      const why = S(b.correction_reason, 1000)
      if (why.length < 5) return json({ ok: false, error: 'Please say what is being corrected and why (at least five characters). Nothing was saved.' }, 400)
      /* a correction of a correction corrects the same original line */
      const origId = line.kind === 'correction' ? line.corrects : line.id
      const { data: orig } = await db.from('drug_test_entry').select('*').eq('id', origId).maybeSingle()
      if (!orig) return json({ ok: false, error: 'That record was not found.' }, 404)
      const all = await linesFor(db, keysOf), cur = effective(orig, all)
      let fields: Any
      if (orig.kind === 'request') {
        const reason = b.reason !== undefined ? S(b.reason, 2000) : cur.reason, date = b.date_requested !== undefined ? S(b.date_requested, 10) : cur.date_requested
        if (reason.length < 5) return json({ ok: false, error: 'The reason stays required (at least five characters). Nothing was saved.' }, 400)
        if (!isYmd(date) || date > todayCentral()) return json({ ok: false, error: 'Please give the date the test was requested (today or earlier). Nothing was saved.' }, 400)
        fields = { date_requested: date, reason, test_type: b.test_type !== undefined ? (S(b.test_type, 200) || null) : cur.test_type, notes: b.notes !== undefined ? (S(b.notes, 2000) || null) : cur.notes }
      } else {
        fields = await resultFields(cur); if (fields.error) return json({ ok: false, error: fields.error + ' Nothing was saved.' }, 400)
      }
      const { data, error } = await db.from('drug_test_entry').insert({ kind: 'correction', test_id: testId, corrects: orig.id, ...keysOf, name: reqRow.name, ...fields, correction_reason: why, ...by }).select('id').maybeSingle()
      if (error || !data) return json({ ok: false, error: 'The correction could not be saved. Nothing was saved.' }, 500)
      return json({ ok: true, entry_id: data.id })
    }
    return json({ ok: false, error: 'Unknown action.' }, 400)
  } catch (e) {
    return json({ ok: false, error: 'Something went wrong: ' + S((e as Error)?.message ?? e, 160) + '. Nothing was saved.' }, 500)
  }
})
