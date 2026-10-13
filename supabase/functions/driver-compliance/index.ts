// =============================================================================
// driver-compliance · DRIVER COMPLIANCE (Samantha's 7-point ask, 2026-10-13; spec launch/review/driver-compliance-spec.md)
// =============================================================================
// Uploading never authorizes driving. The office verifies; only a person on the Admin page's Approve drivers list (owners
// always) approves; Non-Driver, Pending Verification and Suspended are never eligible for transport shifts; on expiry an
// Approved Driver is suspended until new documents are received AND verified. Every change is a history line.
//
// API REFERENCE (POST JSON; every answer is JSON with ok: true, or { ok: false, error } and an HTTP status)
// ── Office staff (their own Hub sign-in: Authorization: Bearer <session>; owner_admin, care_coordinator, staffing_coordinator)
//   key = the driver compliance record id (uuid) that `get` returns as row.id.
//   get        { offer_id | caregiver_id | axiscare_id | key }
//              -> { row | null, status_label ("Not set up yet" when no row), cleared_to_drive, docs: [{ id, kind, label,
//                 content_type, uploaded_at, uploaded_by, expires, verified_at, verified_by, superseded_at }] (no paths),
//                 events: [{ at, kind, by_name, detail }] newest first, derived: { status_label, cleared_to_drive, missing[],
//                 renewals: [{ what, label, expires, days_left }], approve_blockers[], may_approve, can_approve },
//                 roster_dates: { dl_expires, auto_ins_expires, dl_proof, auto_ins_proof } (office-typed, read only) }
//   report     {}  -> { rows: [{ caregiver_id, name, axiscare_id, dl_expires, auto_ins_expires, has_dl_proof, has_ins_proof,
//                 set_up, status_label }] }  read only: who has driving dates on file in the roster
//   setup      { caregiver_id, as?: 'pending' | 'non_driver', reason? }  -> { row }  the "Set up driver compliance" button for a
//                 roster caregiver with no record (pending by default; the roster's typed dates come along, unverified)
//   open       { doc_id } | { key, what: 'agreement' }  -> { url, expires_in: 300 }  logged in document_access_log with your
//                 name; refused (500, no link) when the log cannot be written
//   upload_url { key, kind: license_front|license_back|insurance|mvr|other, content_type }  -> { path, token, url }  a signed
//                 upload slot in the private bucket driver-docs (dc/<key>/<kind>/...); then call record
//   record     { key, kind, path, content_type, expires? }  -> { doc_id }  the path must be this record's slot for that kind
//   verify     { key, what: 'license'|'insurance'|'coverage'|'mvr', expires?, note?, result? (mvr: acceptable|not_acceptable),
//                 insurer? }  -> { row }  stamps who and when; license/insurance need a current document of that kind and a
//                 future expiry (expires, else the document's, else the record's)
//   approve    { key }  -> { row, mirror }  403 unless on the Approve drivers list (owners always); 409 { blockers[] } unless
//                 the vehicle agreement is signed, license and insurance verified and unexpired, coverage verified, MVR
//                 verified acceptable
//   suspend    { key, reason }  /  non_driver { key, reason }  -> { row, mirror }  immediate; reason at least five characters
//   send_link  { key, why: 'change'|'renewal'|'documents' }  -> { state: 'sent'|'practice'|'failed', texted, emailed, not_sent[],
//                 link (practice only, to paste yourself), text }  a person's press; driver_link_send_live, else practice
// ── Caregiver (their private link https://cc.mo-care.com/driver.html?d=<key>&e=<expiry>&t=<code>, 21 days; body { d, e, t })
//   view       -> { first, status, status_label, cleared_to_drive, needed[], expiries: { license, insurance }, renewals[],
//                 on_file: { license_front, license_back, insurance }, agreement: { form, signed_at, version } | null,
//                 agreement_needed: 'vehicle' | null, forms: { vehicle, non_driver | null } (the words to sign), office_phone }
//   upload_url { kind: license_front|license_back|insurance, content_type }  -> { path, token, url }
//   uploaded   { kind, path, content_type, expires?, insurer? }  -> { status, status_label }  Non-Driver, Suspended or Pending
//                 become Pending Verification; an Approved Driver stays approved until the old expiry; the office verifies
//   sign       { form: 'vehicle'|'non_driver', typed_name, consent: true }  -> { status, copy_url }  the signed PDF is kept;
//                 non_driver is Non-Driver at once; vehicle is Pending Verification
// ── Schedule (x-cron-secret = HUB_JOB_SECRET, every 30 minutes; or the owner's server key)
//   pass       {}  -> counts. License and insurance expiries of approved and pending records: d30 and d14 text + email with
//                 the link, d7 again AND one card for their coordinator (roster coordinator email, else the Caregivers domain
//                 owner); Monday to Saturday 9am to 6pm Central, held (never dropped) outside it; one stamp per reminder;
//                 practice (recorded, not sent) while ops_settings.driver_reminders_live is off, except the Admin test
//                 people; practice addresses never. On expiry (the Central date has passed) an Approved Driver is suspended,
//                 with a card and the mirror.
//   mirror_all {}  -> counts. Copies every record's status onto the roster and the readiness card (once, at install).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { jobCaller } from '../_shared/job-auth.ts'
import { PERM_KEY, normalizePerms, mayApprove } from '../_shared/onboarding-permissions.ts'
import { checkLink, makeDriverLink } from '../_shared/applicant-links.ts'
import { logOpen, ipOf } from '../_shared/doc-log.ts'
import { ghlContactIfAllowed, practicePerson } from '../_shared/optout.ts'
import { ghlSendChecked } from '../_shared/send-problems.ts'
import { latestTextConsent, inTextHours, withStop } from '../_shared/text-consent.ts'
import { inReminderWindow, refusedForGood, REMINDER_TRIES } from '../_shared/step2.ts'
import { testPerson } from '../_shared/test-people.ts'
import { FORMS, formFingerprint, approvedForReal, type FormKey } from '../_shared/step1-documents.ts'
import { step1FormPdf } from '../_shared/step1-pdf.ts'
import { longDateTime } from '../_shared/offer-documents.ts'
import { BUCKET, PDF_BUCKET, DOC_KINDS, CAREGIVER_KINDS, DOC_LABEL, MIME, MVR_RESULTS, STATUS_LABEL, NOT_SET_UP, statusLabel, deriveStatus, missingItems, approveBlockers, renewals, reminderDue,
  currentDocs, todayCentral, isYmd, addEvent, personOf, domainOwner, raiseCard, closeCard, mirror, reminderMessage, linkMessage, LINK_WHY, WHAT_LABEL, longDate, type Who } from '../_shared/driver.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
// deno-lint-ignore no-explicit-any
type Any = any
const S = (v: unknown, n = 160) => String(v ?? '').trim().slice(0, n)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const OFFICE = '(417) 234-8494'
const NOPE = { ok: false, error: 'This link is not valid or has run out. Please ask the office for a new one: ' + OFFICE + '.' }
export const SENDER = 'driver-compliance', CAP = 25, LINK_SECONDS = 300
const agentOf = (req: Request) => S(req.headers.get('user-agent'), 200)
const ipShort = (req: Request) => S(req.headers.get('cf-connecting-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0], 64)

async function settings(db: Any) { const { data } = await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle(); return (data?.data && typeof data.data === 'object') ? data.data : {} }
async function rowById(db: Any, id: unknown) { const k = S(id, 64); if (!UUID.test(k)) return null; const { data } = await db.from('driver_compliance').select('*').eq('id', k).maybeSingle(); return data ?? null }
async function docsOf(db: Any, dcId: string): Promise<Any[]> { const { data } = await db.from('driver_document').select('*').eq('dc_id', dcId); return data ?? [] }
async function save(db: Any, id: string, upd: Record<string, unknown>) {
  const { data, error } = await db.from('driver_compliance').update(upd).eq('id', id).select('*').maybeSingle()
  if (error || !data) throw new Error('could not save the driver record' + (error ? ': ' + S(error.message, 120) : ''))
  return data
}
const publicDoc = (d: Any) => ({ id: d.id, kind: d.kind, label: DOC_LABEL[d.kind] || d.kind, content_type: d.content_type, uploaded_at: d.uploaded_at, uploaded_by: d.uploaded_by, expires: d.expires, verified_at: d.verified_at, verified_by: d.verified_by, superseded_at: d.superseded_at })
const slotFor = (dcId: string, kind: string, ct: string) => `dc/${dcId}/${kind}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${MIME[ct]}`
const slotOk = (dcId: string, kind: string, p: string) => new RegExp(`^dc/${dcId}/${kind}/[A-Za-z0-9._-]{1,80}$`).test(p)
async function fileThere(db: Any, p: string): Promise<boolean> {
  const i = p.lastIndexOf('/'); const { data, error } = await db.storage.from(BUCKET).list(p.slice(0, i), { search: p.slice(i + 1) })
  return !error && Array.isArray(data) && data.some((f: Any) => f?.name === p.slice(i + 1))
}
/** a new document: recorded, the older one of that kind superseded, a history line */
async function addDoc(db: Any, row: Any, kind: string, p: string, ct: string, by: string, expires: string | null, who: Who) {
  const docs = await docsOf(db, row.id)
  if (docs.some((d) => d.path === p)) return { doc: docs.find((d) => d.path === p), again: true }
  const now = new Date().toISOString()
  const { data: nd, error } = await db.from('driver_document').insert({ dc_id: row.id, kind, path: p, content_type: ct, uploaded_by: by, uploaded_at: now, expires }).select('*').maybeSingle()
  if (error || !nd) throw new Error('could not record the document')
  for (const old of currentDocs(docs, kind)) await db.from('driver_document').update({ superseded_at: now }).eq('id', old.id).is('superseded_at', null)
  await addEvent(db, row.id, 'doc_uploaded', who, { kind, doc_id: nd.id, content_type: ct, expires, by })
  return { doc: nd, again: false }
}

/* ── sending: text (8am to 6pm Central, their yes to texts, the opt-out door) and email; a refusal raises a card ── */
async function deliver(db: Any, p: { first: string; last: string; phone: string; email: string }, m: { text: string; subject: string; html: string }) {
  const ghl = { token: Deno.env.get('GHL_TOKEN') ?? '', locationId: Deno.env.get('GHL_LOCATION_ID') ?? '' }
  const H = { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' }
  const notSent: string[] = []; let texted = false, emailed = false
  const name = `${p.first} ${p.last}`.trim()
  if (!ghl.token || !ghl.locationId) return { texted, emailed, not_sent: ['texting is not set up on the server'] }
  if (p.phone) {
    const c = await latestTextConsent(db, p.phone)
    if (!inTextHours()) notSent.push('text: texts go 8am to 6pm Central')
    else if (!c.ok) notSent.push('text: ' + c.why)
    else {
      const id = await ghlContactIfAllowed(db, ghl, SENDER, { channel: 'sms', phone: p.phone, email: p.email, firstName: p.first, lastName: p.last })
      if (!id) notSent.push('text: they opted out, or the number could not be confirmed')
      else if (!(texted = await ghlSendChecked(db, H, SENDER, { channel: 'sms', contactId: id, address: p.phone, who: name }, { message: withStop(m.text) }))) notSent.push('text: GoHighLevel did not accept it (a card is on Needs Attention)')
    }
  }
  if (p.email) {
    const id = await ghlContactIfAllowed(db, ghl, SENDER, { channel: 'email', email: p.email, phone: p.phone, firstName: p.first, lastName: p.last })
    if (!id) notSent.push('email: they opted out, or the address could not be confirmed')
    else if (!(emailed = await ghlSendChecked(db, H, SENDER, { channel: 'email', contactId: id, address: p.email, who: name }, { subject: m.subject, html: m.html }))) notSent.push('email: GoHighLevel did not accept it (a card is on Needs Attention)')
  }
  if (!p.phone && !p.email) notSent.push('no phone number or email on file')
  return { texted, emailed, not_sent: notSent }
}
const linkFor = (dcId: string) => makeDriverLink(Deno.env.get('HUB_JOB_SECRET') ?? '', dcId)
const practiceOf = (p: { phone: string; email: string; first: string; last: string }) => practicePerson(p.phone, p.email) || /\(TRAINING\)/.test(`${p.first} ${p.last}`)

/* ── the 30-minute pass ── */
async function pass(db: Any, st: Any): Promise<Record<string, unknown>> {
  const now = new Date(), nowIso = now.toISOString(), today = todayCentral(now), live = st.driver_reminders_live === true
  const out = { ok: true, live, today, looked_at: 0, sent: 0, practice: 0, held: 0, retry: 0, refused: 0, cards: 0, suspended: 0, expired: 0, capped: 0, not_current: 0, uncleared: 0, errors: 0 }
  const { data: rows } = await db.from('driver_compliance').select('*').in('status', ['approved', 'pending'])
  let sends = 0
  const fallback = await domainOwner(db, 'caregivers')
  for (const row0 of rows ?? []) {
   try {
    let row = row0
    /* the expiry day itself: still approved until the date has passed, but not cleared to drive (both expiries must be in
       the future): the roster learns it now (the door writes nothing when nothing differs) */
    if (row.status === 'approved' && !deriveStatus(row, today).cleared_to_drive) { const m = await mirror(db, row, { who: { name: 'The Hub (driver compliance pass)' }, today }); if (m.roster === 'saved') out.uncleared++ }
    const docs = await docsOf(db, row.id), dues = reminderDue(today, row, docs)
    if (!dues.length) continue
    out.looked_at++
    const stamps: Record<string, Any> = { ...(row.reminders || {}) }
    const p = await personOf(db, row), name = `${p.first} ${p.last}`.trim() || S(row.name, 120) || 'a caregiver'
    const owner = p.coordinator ? { email: p.coordinator, name: '' } : fallback.email ? fallback : { email: S(st.staffing_email, 160).toLowerCase(), name: '' }
    const sys: Who = { name: 'The Hub (driver compliance pass)' }
    /* each stamp is saved as soon as it is made, so a later failure can never send a reminder twice */
    const persist = async () => { if (JSON.stringify(stamps) !== JSON.stringify(row.reminders || {})) row = await save(db, row.id, { reminders: { ...stamps } }) }
    for (const d of dues) {
     try {
      const thing = WHAT_LABEL[d.what]
      if (d.stage === 'expired') {
        stamps[d.key] = { at: nowIso }
        out.expired++
        await addEvent(db, row.id, 'expired', sys, { what: d.what, expires: d.expires })
        if (row.status === 'approved') {
          row = await save(db, row.id, { status: 'suspended', status_reason: `${d.what} expired`, status_at: nowIso, reminders: stamps })
          await addEvent(db, row.id, 'suspended', sys, { reason: `${d.what} expired`, expires: d.expires, automatic: true })
          const m = await mirror(db, row, { who: sys, today })
          if (await raiseCard(db, { id: `dc_exp_${row.id}_${d.what}_${d.expires}`, kind: 'driver_suspended', urgency: 'urgent', who: name, dc_id: row.id, offer_id: row.offer_id, owner: owner.email, owner_name: owner.name,
            title: `Driving paused: ${name}'s ${thing} expired`, detail: `${name}'s ${thing} on file expired ${longDate(d.expires)}, so driver compliance suspended them automatically. They are not eligible for transport shifts until a new ${thing} is uploaded and verified, and they are approved again. Check their upcoming shifts for any driving. Roster: ${m.roster}.` }) === 'raised') out.cards++
          out.suspended++
        }
        continue
      }
      /* a caregiver who has left (inactive on the roster), or an applicant marked not hired, is never reminded (not stamped:
         if they come back the reminder is still owed) */
      if (!p.current) { out.not_current++; continue }
      /* d30 / d14 / d7: Monday to Saturday 9am to 6pm Central; held, never dropped, outside it */
      if (!inReminderWindow(now)) {
        out.held++
        if (!stamps[d.key + ':held']) { stamps[d.key + ':held'] = { at: nowIso }; await addEvent(db, row.id, 'reminder_held', sys, { what: d.what, stage: d.stage, expires: d.expires, why: 'outside Monday to Saturday 9am to 6pm Central' }) }
        continue
      }
      if (d.stage === 'd7' && await raiseCard(db, { id: `dc_d7_${row.id}_${d.what}_${d.expires}`, kind: 'driver_expiring', urgency: 'today', who: name, dc_id: row.id, offer_id: row.offer_id, owner: owner.email, owner_name: owner.name,
        title: (practiceOf(p) ? 'PRACTICE: ' : '') + `${name}'s ${thing} expires in ${d.days_left} days`, detail: `${name}'s ${thing} on file expires ${longDate(d.expires)} and no renewal has been uploaded. They were sent their upload link at 30 and 14 days and again today. If it is not renewed and verified by then, driving pauses automatically. Call them, or press Send link on their Driver Compliance.` }) === 'raised') out.cards++
      if (sends >= CAP) { out.capped++; continue }
      const test = testPerson(st, p)
      if (practiceOf(p) || (!live && !test)) {
        stamps[d.key] = { at: nowIso, practice: true, ...(practiceOf(p) ? { why: 'a practice person' } : {}) }; out.practice++
        await addEvent(db, row.id, 'reminder_sent', sys, { what: d.what, stage: d.stage, expires: d.expires, practice: true, sent: false })
        continue
      }
      sends++
      const r = await deliver(db, p, reminderMessage(p.first, d, await linkFor(row.id)))
      const tries = (Number(stamps[d.key + ':tries']?.n) || 0) + 1
      if (r.texted || r.emailed) {
        stamps[d.key] = { at: nowIso, texted: r.texted, emailed: r.emailed, not_sent: r.not_sent }; out.sent++
        await addEvent(db, row.id, 'reminder_sent', sys, { what: d.what, stage: d.stage, expires: d.expires, texted: r.texted, emailed: r.emailed, not_sent: r.not_sent, test_person: test && !live })
      } else if (refusedForGood(r.not_sent) || tries >= REMINDER_TRIES) {
        const good = refusedForGood(r.not_sent)
        stamps[d.key] = { at: nowIso, texted: false, emailed: false, not_sent: r.not_sent, ...(good ? { refused: true } : { failed: true, tries }) }; out.refused++
        await addEvent(db, row.id, 'reminder_refused', sys, { what: d.what, stage: d.stage, expires: d.expires, not_sent: r.not_sent, refused: good, tries })
        if (await raiseCard(db, { id: `dc_rem_${row.id}_${d.key}`, kind: 'send_problem', urgency: 'today', who: name, dc_id: row.id, offer_id: row.offer_id, owner: owner.email, owner_name: owner.name,
          title: `${thing[0].toUpperCase() + thing.slice(1)} reminder did not reach ${name}`, detail: `The ${d.stage.slice(1)}-day reminder that their ${thing} expires ${longDate(d.expires)} could not go: ${r.not_sent.join('; ') || 'no reason given'}. Call them and press Send link on their Driver Compliance.` }) === 'raised') out.cards++
      } else { stamps[d.key + ':tries'] = { n: tries, last_at: nowIso, not_sent: r.not_sent }; out.retry++ }
     } finally { await persist() }
    }
   } catch (e) {
    /* one record that cannot be worked never stops the others, and never fails silently */
    out.errors++
    await raiseCard(db, { id: 'dc_pass_' + row0.id, kind: 'driver_pass_failed', urgency: 'today', who: S(row0.name, 120), dc_id: row0.id, offer_id: row0.offer_id, owner: fallback.email,
      title: 'Driver compliance could not check ' + (S(row0.name, 120) || 'a caregiver'), detail: `The 30-minute driver compliance pass could not work their record (${S((e as Error)?.message ?? e, 160)}). Their reminders or an automatic suspension may be waiting. Tell Claude.` })
   }
  }
  try { await db.rpc('upsert_app_data_item', { target_key: 'automation_log', item: { id: 'auto_srv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), at: nowIso, automation: 'driver_compliance', ran_by: 'server', ok: out.errors === 0, dry: !live, summary: out } }) } catch { /* the log must not take the pass down */ }
  try { await db.rpc('upsert_app_data_item', { target_key: 'automation_heartbeats', item: { id: 'hb_driver-compliance', automation: 'driver-compliance', at: nowIso, ok: out.errors === 0, note: JSON.stringify(out).slice(0, 300) } }) } catch { /* same */ }
  return out
}

/** the agreement to sign, as the page shows it (the same versioned words as Step 1) */
async function formPayload(k: string): Promise<Any> {
  const f = FORMS[k as FormKey]; if (!f) return null
  return { key: f.key, title: f.title, version: f.version, intro: f.intro || [], sections: f.sections, certification: f.certification, fingerprint: await formFingerprint(k as FormKey) }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false, autoRefreshToken: false } })
  const b: Any = await req.json().catch(() => ({}))
  const action = S(b.action, 20)
  try {
    const st = await settings(db), now = new Date().toISOString(), today = todayCentral()
    /* ═══ the schedule ═══ */
    if (action === 'pass' || action === 'mirror_all') {
      if (!(await jobCaller(req))) return json({ ok: false, error: 'the pass is for the schedule or an owner' }, 401)
      if (action === 'pass') return json(await pass(db, st))
      const { data: rows } = await db.from('driver_compliance').select('*')
      const out: Record<string, number> = { looked_at: 0 }
      for (const r of rows ?? []) { out.looked_at++; const m = await mirror(db, r, { who: { name: 'The Hub (install)' }, today }); out['roster_' + m.roster] = (out['roster_' + m.roster] || 0) + 1; out['journey_' + m.journey] = (out['journey_' + m.journey] || 0) + 1 }
      return json({ ok: true, ...out })
    }
    /* ═══ the caregiver's private link ═══ */
    if (b.t != null) {
      if (!(await checkLink(Deno.env.get('HUB_JOB_SECRET') ?? '', 'driver', b.d, b.e, b.t))) return json(NOPE, 401)
      let row = await rowById(db, b.d); if (!row) return json(NOPE, 404)
      const p = await personOf(db, row), cg: Who = { name: (`${p.first} ${p.last}`.trim() || S(row.name, 120) || 'The caregiver') + ' (driver link)' }
      if (action === 'view') {
        const docs = await docsOf(db, row.id), d = deriveStatus(row, today)
        const exp = (k: string) => { const x = row[k + '_expires']; return x ? { date: String(x).slice(0, 10), label: longDate(String(x).slice(0, 10)) } : null }
        return json({ ok: true, first: p.first, status: row.status, status_label: d.label, cleared_to_drive: d.cleared_to_drive, needed: missingItems(row, docs), expiries: { license: exp('license'), insurance: exp('insurance') }, renewals: renewals(row, today),
          on_file: Object.fromEntries(CAREGIVER_KINDS.map((k) => [k, currentDocs(docs, k).length > 0])), agreement: row.agreement_form ? { form: row.agreement_form, signed_at: row.agreement_signed_at, version: row.agreement_version } : null,
          agreement_needed: row.status !== 'non_driver' && row.agreement_form !== 'vehicle' ? 'vehicle' : null, forms: { vehicle: await formPayload('vehicle'), non_driver: await formPayload('non_driver') }, office_phone: OFFICE })
      }
      if (action === 'upload_url') {
        const kind = S(b.kind, 20), ct = S(b.content_type, 60).toLowerCase()
        if (!CAREGIVER_KINDS.includes(kind)) return json({ ok: false, error: 'Which document: the front of your license, the back, or your insurance?' }, 400)
        if (!MIME[ct]) return json({ ok: false, error: 'Please use a photo (JPG, PNG, HEIC or WebP) or a PDF.' }, 400)
        const path = slotFor(row.id, kind, ct)
        const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path)
        if (error || !data) return json({ ok: false, error: 'Could not prepare the upload. Please try again, or call ' + OFFICE + '.' }, 500)
        return json({ ok: true, path, token: data.token, url: data.signedUrl })
      }
      if (action === 'uploaded') {
        const kind = S(b.kind, 20), path = S(b.path, 500), ct = S(b.content_type, 60).toLowerCase()
        if (!CAREGIVER_KINDS.includes(kind) || !slotOk(row.id, kind, path) || !MIME[ct]) return json({ ok: false, error: 'That upload is not one of yours. Please try again.' }, 403)
        if (!(await fileThere(db, path))) return json({ ok: false, error: 'We did not receive the file. Please upload it again.' }, 409)
        const expires = isYmd(S(b.expires, 10)) ? S(b.expires, 10) : null
        if (kind !== 'license_back' && expires && expires <= today) return json({ ok: false, error: 'That expiration date has already passed. Please upload the current one.' }, 400)
        await addDoc(db, row, kind, path, ct, 'caregiver', kind === 'license_back' ? null : expires, cg)
        const upd: Record<string, unknown> = {}
        if (row.status !== 'approved') {
          if (kind === 'license_front' || kind === 'license_back') { if (kind === 'license_front' && expires) upd.license_expires = expires; Object.assign(upd, { license_verified_at: null, license_verified_by: null }) }
          if (kind === 'insurance') { if (expires) upd.insurance_expires = expires; if (S(b.insurer, 120)) upd.insurer = S(b.insurer, 120); Object.assign(upd, { insurance_verified_at: null, insurance_verified_by: null, coverage_verified_at: null, coverage_verified_by: null }) }
        }
        const was = row.status
        if (['non_driver', 'suspended'].includes(was)) Object.assign(upd, { status: 'pending', status_reason: 'new documents uploaded', status_at: now })
        if (Object.keys(upd).length) row = await save(db, row.id, upd)
        if (was === 'non_driver') await addEvent(db, row.id, 'driver_requested', cg, { via: 'driver link upload' })
        const m = row.status !== was ? await mirror(db, row, { who: cg, today }) : null
        await raiseCard(db, { id: 'dc_verify_' + row.id, kind: 'driver_verify', urgency: 'today', who: `${p.first} ${p.last}`.trim() || S(row.name, 120), dc_id: row.id, offer_id: row.offer_id, owner: (await domainOwner(db, 'caregivers')).email,
          title: 'New driver document to verify: ' + (`${p.first} ${p.last}`.trim() || S(row.name, 120)), detail: `${DOC_LABEL[kind]} uploaded on their private link. Open their Driver Compliance, check it, and press Verify. Until then their driving status stays ${STATUS_LABEL[row.status as 'pending']}.` })
        return json({ ok: true, status: row.status, status_label: statusLabel(row.status), mirror: m })
      }
      if (action === 'sign') {
        const form = S(b.form, 20)
        if (form !== 'vehicle' && form !== 'non_driver') return json({ ok: false, error: 'Which agreement?' }, 400)
        const F = FORMS[form as FormKey]
        if (!F) return json({ ok: false, error: 'The Non-Driver Agreement is not ready to sign online yet. Please call the office: ' + OFFICE + '.', not_ready: true }, 409)
        if (b.consent !== true) return json({ ok: false, error: 'Please tick "I agree to sign this agreement electronically" first.' }, 400)
        const typed = S(b.typed_name, 80)
        if (!/^\S+(\s+\S+)+$/.test(typed) || typed.length < 4) return json({ ok: false, error: 'Please type your full name, first and last.' }, 400)
        if (!practiceOf(p) && !approvedForReal(form as FormKey)) return json({ ok: false, error: 'This agreement is waiting for its final approval, so it cannot be signed yet. The office will let you know: ' + OFFICE + '.', not_approved: true }, 409)
        if (row.agreement_form === form && Number(row.agreement_version) === F.version) return json({ ok: false, error: 'You already signed this agreement. A signed agreement is never changed.', already: true }, 409)
        const at = now, ip = ipShort(req), agent = agentOf(req), fp = await formFingerprint(form as FormKey)
        const docs = await docsOf(db, row.id), ins = (FORMS.vehicle.sections[0].items || []).find((i) => i.id === 'insurance_proof')?.options || []
        const answers: Record<string, unknown> = form === 'vehicle' ? { has_license: 'yes', has_insurance: 'yes', has_transport: 'yes', license_state: row.license_state || null, license_expires: row.license_expires || null, insurer: row.insurer || null, insurance_expires: row.insurance_expires || null,
          insurance_proof: currentDocs(docs, 'insurance').length ? ins[0] : ins[1], driver_ack: (FORMS.vehicle.sections.at(-1)?.items?.[0]?.options || [])[0] } : {}
        const bytes = step1FormPdf(F, answers, { first: p.first, last: p.last, phone: p.phone, email: p.email, position: 'Caregiver' }, { ssn: null, dob: false, license: null },
          { typedName: typed, signedAtCentral: longDateTime(at), signedAtUtc: at, ip, agent, version: F.version, fingerprint: fp, offerId: 'driver record ' + row.id + (row.offer_id ? ' (offer ' + row.offer_id + ')' : ''), docName: F.title }, 1, 1)
        const pdfPath = `driver/${row.id}/${form}-v${F.version}-${at.replace(/[:.]/g, '-')}.pdf`
        const up = await db.storage.from(PDF_BUCKET).upload(pdfPath, bytes, { contentType: 'application/pdf', upsert: false })
        const was = row.status
        const upd: Record<string, unknown> = { agreement_form: form, agreement_signed_at: at, agreement_version: F.version, agreement_pdf: up.error ? null : pdfPath }
        if (form === 'non_driver' && was !== 'non_driver') Object.assign(upd, { status: 'non_driver', status_reason: 'Non-Driver Agreement signed', status_at: at })
        if (form === 'vehicle' && ['non_driver', 'suspended'].includes(was)) Object.assign(upd, { status: 'pending', status_reason: 'Driver/Vehicle agreement signed', status_at: at })
        row = await save(db, row.id, upd)
        await addEvent(db, row.id, 'agreement_signed', cg, { form, typed_name: typed, version: F.version, fingerprint: fp, ip, agent, consent: true, pdf: up.error ? null : pdfPath })
        if (up.error) await raiseCard(db, { id: 'dc_pdf_' + row.id + '_' + form, kind: 'driver_pdf_failed', urgency: 'today', who: `${p.first} ${p.last}`.trim(), dc_id: row.id, offer_id: row.offer_id,
          title: 'A signed driver agreement has no PDF yet: ' + `${p.first} ${p.last}`.trim(), detail: `The signature on ${F.title} is recorded (time, device, wording version) but its PDF could not be saved (${S(up.error.message || up.error, 120)}). Tell Claude so the PDF is made again from the signed record.` })
        if (form === 'non_driver' && was !== 'non_driver') await addEvent(db, row.id, 'non_driver', cg, { reason: 'Non-Driver Agreement signed', via: 'driver link' })
        if (form === 'vehicle' && was === 'non_driver') await addEvent(db, row.id, 'driver_requested', cg, { via: 'driver link agreement' })
        const m = row.status !== was ? await mirror(db, row, { who: cg, today }) : null
        const cp = up.error ? { data: null } : await db.storage.from(PDF_BUCKET).createSignedUrl(pdfPath, 600)
        return json({ ok: true, status: row.status, status_label: statusLabel(row.status), pdf: !up.error, copy_url: cp.data?.signedUrl ?? null, mirror: m })
      }
      return json({ ok: false, error: 'Unknown action.' }, 400)
    }
    /* ═══ the office ═══ */
    const who = await requireStaff(db, req, OFFICE_ROLES)
    if (!who.ok) return json({ ok: false, error: who.error }, who.status)
    const actor: Who = { name: who.name, email: who.email, person_id: who.person_id }
    const { data: permRow } = await db.from('app_data').select('data').eq('key', PERM_KEY).maybeSingle()
    const mayApproveDriver = mayApprove(normalizePerms(permRow?.data), 'driver', { person_id: who.person_id, roles: who.roles, email: who.email })
    if (action === 'get') {
      let row: Any = null
      if (b.key) row = await rowById(db, b.key)
      else if (b.offer_id && UUID.test(S(b.offer_id, 64))) row = (await db.from('driver_compliance').select('*').eq('offer_id', S(b.offer_id, 64)).maybeSingle()).data
      else if (b.caregiver_id) row = (await db.from('driver_compliance').select('*').eq('caregiver_id', S(b.caregiver_id, 40)).maybeSingle()).data
      else if (b.axiscare_id) { const { data } = await db.from('driver_compliance').select('*').eq('axiscare_id', S(b.axiscare_id, 20)); row = (data ?? []).length === 1 ? data![0] : null }
      else return json({ ok: false, error: 'Which person?' }, 400)
      let rosterDates = null
      if (b.caregiver_id || row?.caregiver_id) {
        const { data: cg } = await db.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()
        const r = (Array.isArray(cg?.data) ? cg.data : []).find((x: Any) => String(x?.id) === String(row?.caregiver_id || b.caregiver_id))
        if (r) rosterDates = { dl_expires: r.dl_expires || null, auto_ins_expires: r.auto_ins_expires || null, dl_proof: r.dl_proof || null, auto_ins_proof: r.auto_ins_proof || null }
      }
      if (!row) return json({ ok: true, row: null, status_label: NOT_SET_UP, cleared_to_drive: false, docs: [], events: [], derived: null, roster_dates: rosterDates, may_approve: mayApproveDriver })
      const docs = await docsOf(db, row.id), { data: ev } = await db.from('driver_compliance_event').select('at, kind, by_name, detail').eq('dc_id', row.id).order('at', { ascending: false }).limit(300)
      const d = deriveStatus(row, today), blockers = approveBlockers(row, docs, today)
      const { reminders: _r, ...pub } = row; void _r
      return json({ ok: true, row: pub, status_label: d.label, cleared_to_drive: d.cleared_to_drive, docs: docs.map(publicDoc).sort((a, c) => String(c.uploaded_at).localeCompare(String(a.uploaded_at))), events: ev ?? [],
        derived: { status_label: d.label, cleared_to_drive: d.cleared_to_drive, missing: missingItems(row, docs), renewals: renewals(row, today), approve_blockers: blockers, may_approve: mayApproveDriver, can_approve: mayApproveDriver && !blockers.length }, roster_dates: rosterDates, may_approve: mayApproveDriver })
    }
    if (action === 'report') {
      const { data: cg } = await db.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()
      const { data: dcs } = await db.from('driver_compliance').select('id, caregiver_id, status')
      const by = new Map((dcs ?? []).filter((x: Any) => x.caregiver_id).map((x: Any) => [String(x.caregiver_id), x]))
      const rows = (Array.isArray(cg?.data) ? cg.data : []).filter((r: Any) => r && r.active !== false && (r.dl_expires || r.auto_ins_expires || r.dl_proof || r.auto_ins_proof))
        .map((r: Any) => { const dc: Any = by.get(String(r.id)); return { caregiver_id: String(r.id), name: `${S(r.first, 60)} ${S(r.last, 60)}`.trim(), axiscare_id: r.axiscare_id || null, dl_expires: r.dl_expires || null, auto_ins_expires: r.auto_ins_expires || null, has_dl_proof: !!r.dl_proof, has_ins_proof: !!r.auto_ins_proof, set_up: !!dc, status_label: dc ? statusLabel(dc.status) : NOT_SET_UP } })
        .sort((a: Any, c: Any) => a.name.localeCompare(c.name))
      return json({ ok: true, rows })
    }
    if (action === 'setup') {
      const cid = S(b.caregiver_id, 40); if (!cid) return json({ ok: false, error: 'Which caregiver?' }, 400)
      const as = b.as === 'non_driver' ? 'non_driver' : 'pending', reason = S(b.reason, 300)
      if (as === 'non_driver' && reason.length < 5) return json({ ok: false, error: 'Please give the reason (at least five characters).' }, 400)
      const { data: cg } = await db.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()
      const list = (Array.isArray(cg?.data) ? cg.data : []).filter((x: Any) => x && String(x.id) === cid)
      if (list.length !== 1) return json({ ok: false, error: 'That caregiver is not on the roster (or two records share the number).' }, 404)
      const r = list[0]
      const { data: have } = await db.from('driver_compliance').select('id').eq('caregiver_id', cid).maybeSingle()
      if (have) return json({ ok: false, error: 'Driver compliance is already set up for them.', key: have.id }, 409)
      const typed = { license_expires: isYmd(S(r.dl_expires, 10)) ? S(r.dl_expires, 10) : null, insurance_expires: isYmd(S(r.auto_ins_expires, 10)) ? S(r.auto_ins_expires, 10) : null }
      const { data: row, error } = await db.from('driver_compliance').insert({ caregiver_id: cid, offer_id: UUID.test(S(r.offer_id, 64)) ? S(r.offer_id, 64) : null, axiscare_id: r.axiscare_id ? String(r.axiscare_id) : null, name: `${S(r.first, 60)} ${S(r.last, 60)}`.trim(),
        status: as, status_reason: as === 'non_driver' ? reason : 'set up by the office', status_at: now, ...(as === 'pending' ? typed : {}) }).select('*').maybeSingle()
      if (error || !row) return json({ ok: false, error: 'Could not set it up' + (error ? ': ' + S(error.message, 120) : '') + '.' }, 500)
      await addEvent(db, row.id, 'created', actor, { from: 'office setup', status: as, roster_dates: { dl_expires: r.dl_expires || null, auto_ins_expires: r.auto_ins_expires || null }, note: as === 'pending' ? 'the roster dates were typed by the office and are not verified' : reason })
      if (as === 'non_driver') await addEvent(db, row.id, 'non_driver', actor, { reason })
      const m = await mirror(db, row, { who: actor, today })
      return json({ ok: true, row, mirror: m })
    }
    if (action === 'open') {
      let path = '', doc = '', subject = ''
      if (b.doc_id) {
        const id = S(b.doc_id, 64); if (!UUID.test(id)) return json({ ok: false, error: 'Which document?' }, 400)
        const { data: d } = await db.from('driver_document').select('*').eq('id', id).maybeSingle()
        if (!d) return json({ ok: false, error: 'That document was not found.' }, 404)
        path = d.path; doc = 'driver:' + d.kind; subject = 'driver:' + d.dc_id
      } else {
        const row = await rowById(db, b.key); if (!row) return json({ ok: false, error: 'Which person?' }, 404)
        if (b.what !== 'agreement' || !row.agreement_pdf) return json({ ok: false, error: 'No signed agreement PDF is on file.' }, 404)
        path = row.agreement_pdf; doc = 'driver:agreement:' + row.agreement_form; subject = 'driver:' + row.id
      }
      const bucket = doc.startsWith('driver:agreement') ? PDF_BUCKET : BUCKET
      const { data, error } = await db.storage.from(bucket).createSignedUrl(path, LINK_SECONDS)
      if (error || !data?.signedUrl) return json({ ok: false, error: 'Could not open the document.' }, 500)
      if (!(await logOpen(db, { subject, doc, path, who: actor, reason: S(b.reason, 120) || 'opened on Driver Compliance', ip: ipOf(req) }))) return json({ ok: false, error: 'The open could not be logged, so the document is not shown. Try again.' }, 500)
      return json({ ok: true, url: data.signedUrl, expires_in: LINK_SECONDS })
    }
    let row = await rowById(db, b.key)
    if (!row) return json({ ok: false, error: 'Which person? (Driver compliance is not set up for them.)' }, 404)
    const name = S(row.name, 120) || 'this caregiver'
    if (action === 'upload_url') {
      const kind = S(b.kind, 20), ct = S(b.content_type, 60).toLowerCase()
      if (!(DOC_KINDS as readonly string[]).includes(kind)) return json({ ok: false, error: 'Which kind of document?' }, 400)
      if (!MIME[ct]) return json({ ok: false, error: 'Use a photo (JPG, PNG, HEIC or WebP) or a PDF.' }, 400)
      const path = slotFor(row.id, kind, ct)
      const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path)
      if (error || !data) return json({ ok: false, error: 'Could not prepare the upload.' }, 500)
      return json({ ok: true, path, token: data.token, url: data.signedUrl })
    }
    if (action === 'record') {
      const kind = S(b.kind, 20), path = S(b.path, 500), ct = S(b.content_type, 60).toLowerCase()
      if (!(DOC_KINDS as readonly string[]).includes(kind) || !slotOk(row.id, kind, path) || !MIME[ct]) return json({ ok: false, error: 'That file is not this person\'s upload slot for that kind of document.' }, 403)
      if (!(await fileThere(db, path))) return json({ ok: false, error: 'The file did not arrive. Upload it again.' }, 409)
      const expires = isYmd(S(b.expires, 10)) ? S(b.expires, 10) : null
      const r = await addDoc(db, row, kind, path, ct, who.name || who.email, expires, actor)
      return json({ ok: true, doc_id: r.doc.id, again: r.again })
    }
    if (action === 'verify') {
      const what = S(b.what, 12), note = S(b.note, 300)
      if (row.status === 'non_driver') return json({ ok: false, error: name + ' signed the Non-Driver Agreement. Nothing to verify unless they ask to drive.' }, 409)
      const docs = await docsOf(db, row.id), upd: Record<string, unknown> = {}
      let stampDocs: Any[] = [], expires: string | null = null
      if (what === 'license' || what === 'insurance') {
        const kinds = what === 'license' ? ['license_front', 'license_back'] : ['insurance']
        const cur = kinds.map((k) => currentDocs(docs, k)[0])
        if (cur.some((d) => !d)) return json({ ok: false, error: what === 'license' ? 'A current photo of both the front and the back of the license is needed first.' : 'Current proof of insurance is needed first.' }, 409)
        expires = isYmd(S(b.expires, 10)) ? S(b.expires, 10) : (cur[0].expires ? String(cur[0].expires).slice(0, 10) : (row[what + '_expires'] ? String(row[what + '_expires']).slice(0, 10) : null))
        if (!expires || expires <= today) return json({ ok: false, error: 'The ' + WHAT_LABEL[what] + ' must have an expiration date in the future. Enter the date shown on the document.' }, 400)
        Object.assign(upd, { [what + '_verified_at']: now, [what + '_verified_by']: who.name || who.email, [what + '_expires']: expires })
        if (what === 'insurance' && S(b.insurer, 120)) upd.insurer = S(b.insurer, 120)
        stampDocs = cur
      } else if (what === 'coverage') {
        if (!currentDocs(docs, 'insurance').length) return json({ ok: false, error: 'Current proof of insurance is needed first.' }, 409)
        Object.assign(upd, { coverage_verified_at: now, coverage_verified_by: who.name || who.email, coverage_note: note || null })
      } else if (what === 'mvr') {
        const result = S(b.result, 20)
        if (!MVR_RESULTS.includes(result)) return json({ ok: false, error: 'Is the driving record acceptable or not acceptable?' }, 400)
        Object.assign(upd, { mvr_verified_at: now, mvr_verified_by: who.name || who.email, mvr_result: result })
        stampDocs = currentDocs(docs, 'mvr').slice(0, 1)
      } else return json({ ok: false, error: 'Verify what: license, insurance, coverage or mvr?' }, 400)
      row = await save(db, row.id, upd)
      for (const d of stampDocs) if (!d.verified_at) await db.from('driver_document').update({ verified_at: now, verified_by: who.name || who.email }).eq('id', d.id).is('verified_at', null)
      await addEvent(db, row.id, 'verified', actor, { what, expires, note: note || null, result: upd.mvr_result ?? null, docs: stampDocs.map((d) => d.id) })
      const m = row.status === 'approved' ? await mirror(db, row, { who: actor, today }) : null
      const left = await docsOf(db, row.id)
      if (!['license_front', 'license_back', 'insurance'].some((k) => currentDocs(left, k).some((d) => !d.verified_at))) await closeCard(db, 'dc_verify_' + row.id, 'Verified.')
      return json({ ok: true, row, mirror: m, approve_blockers: approveBlockers(row, left, today) })
    }
    if (action === 'approve') {
      if (!mayApproveDriver) return json({ ok: false, error: 'Only a person on the Admin page\'s Approve drivers list (or an owner) may approve a driver.' }, 403)
      const blockers = approveBlockers(row, await docsOf(db, row.id), today)
      if (blockers.length) return json({ ok: false, error: 'Not yet: ' + blockers.join('; ') + '.', blockers }, 409)
      row = await save(db, row.id, { status: 'approved', status_reason: 'approved by the office', status_at: now, approved_at: now, approved_by: who.name || who.email })
      await addEvent(db, row.id, 'approved', actor, { license_expires: row.license_expires, insurance_expires: row.insurance_expires, mvr_result: row.mvr_result })
      const m = await mirror(db, row, { who: actor, today })
      for (const id of ['dc_verify_' + row.id]) await closeCard(db, id, 'Approved Driver.')
      return json({ ok: true, row, mirror: m })
    }
    if (action === 'suspend' || action === 'non_driver') {
      const reason = S(b.reason, 300)
      if (reason.length < 5) return json({ ok: false, error: 'Please give the reason (at least five characters). Nothing was changed.' }, 400)
      const to = action === 'suspend' ? 'suspended' : 'non_driver'
      if (row.status === to) return json({ ok: false, error: name + ' is already ' + STATUS_LABEL[to as 'suspended'] + '.' }, 409)
      if (to === 'suspended' && row.status === 'non_driver') return json({ ok: false, error: name + ' is a Non-Driver; there is nothing to suspend.' }, 409)
      row = await save(db, row.id, { status: to, status_reason: reason, status_at: now })
      await addEvent(db, row.id, to === 'suspended' ? 'suspended' : 'non_driver', actor, { reason, automatic: false })
      const m = await mirror(db, row, { who: actor, today })
      return json({ ok: true, row, mirror: m })
    }
    if (action === 'send_link') {
      const why = S(b.why, 20); if (!LINK_WHY[why]) return json({ ok: false, error: 'Why: change, renewal or documents?' }, 400)
      const p = await personOf(db, row), link = await linkFor(row.id), m = linkMessage(p.first, why, link)
      let res: Any
      if (practiceOf(p)) res = { state: 'practice', why: 'a practice person: never contacted', link, text: m.text }
      else if (st.driver_link_send_live !== true && !testPerson(st, p)) res = { state: 'practice', why: 'driver_link_send_live is off: nothing was sent; paste the link yourself if you need to', link, text: m.text }
      else { const r = await deliver(db, p, m); res = { state: r.texted || r.emailed ? 'sent' : 'failed', texted: r.texted, emailed: r.emailed, not_sent: r.not_sent, text: m.text } }
      await addEvent(db, row.id, 'note', actor, { link_sent: res.state, why, texted: !!res.texted, emailed: !!res.emailed, not_sent: res.not_sent || null })
      return json({ ok: true, ...res })
    }
    return json({ ok: false, error: 'Unknown action.' }, 400)
  } catch (e) {
    return json({ ok: false, error: 'Something went wrong: ' + ((e as Error).message || 'error') + '.' }, 500)
  }
})
