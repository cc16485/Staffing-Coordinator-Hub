// =============================================================================
// hepb · HEPATITIS B VACCINATION (OSHA 29 CFR 1910.1030; the owner's ruling 2026-10-13; research launch/review/hepb-osha-research.md)
// =============================================================================
// Positions with reasonably anticipated exposure to blood are offered the vaccine at no cost, after the bloodborne pathogens
// training and within 10 working days of initial assignment. The vaccine is never mandatory. The caregiver answers on a
// private link: (1) the vaccine, arranged by the company at no cost, the office records each dose; (2) the series already
// completed; (3) an antibody test shows immunity; (4) medically contraindicated (only the fact is kept, no medical detail);
// (5) decline, by signing the Appendix A statement word for word. A declining employee can choose the vaccine later on the
// same link ((f)(2)(iii)). Confidential medical records ((h)(1)(iii)): only owners see the answer details, the doses and the
// documents (every open logged); everyone else in the office sees only the status words.
//
// API REFERENCE (POST JSON; every answer is JSON with ok: true, or { ok: false, error } and an HTTP status)
// ── Office staff (their own Hub sign-in; owner_admin, care_coordinator, staffing_coordinator)
//   exposure       {} -> { table: [{ position, exposed, scope, tasks[], why, source }], fallback }  the determination in force
//   get            { offer_id | caregiver_id | axiscare_id | key } -> everyone: { row: { id, position, exposed, status_label,
//                    training_date, assignment_date, due_date, offered_at, late }, owner: false }; an owner also gets
//                    { owner: true, detail: { status, status_label, choice_at, doses[], verified_at, verified_by, declined_at,
//                    declination_pdf: bool, series_complete_at }, docs: [{ id, kind, label, uploaded_at, uploaded_by }] (no paths),
//                    events[] }. No record: { row: null, status_label: 'Not set up yet' }.
//   setup          { caregiver_id, position? } -> { row }  an existing roster caregiver (position from the roster, else the given
//                    one, else Caregiver)
//   confirm_training { key, date }  the bloodborne pathogens training date (any office role; a training record, not medical)
//   set_assignment { key, date }    initial assignment when the roster has no first client visit
//   record_offer   { key, how }     the office offered it in person or pasted the link itself (counts as the offer)
//   send_link      { key } -> { state: sent|practice|failed, ... }  a person's press; hepb_offer_live, else practice
// ── Owners only (medical record)
//   record_choice  { key, choice: vaccine|prior_series|immune|contraindicated }  an answer given on paper or by phone (a
//                    declination is never recorded by the office: only the employee's signature makes one)
//   record_dose    { key, date }    one dose given (numbered in order)
//   series_complete { key }         the vaccine series is done (at least one dose recorded)
//   verify         { key }          an owner checked the series proof, the antibody result, or the contraindication
//   upload_url     { key, kind, content_type } / record { key, kind, path, content_type }  a proof the office holds
//   open           { doc_id } | { key, what: 'declination' } -> { url, expires_in: 300 }  logged; refused if not logged
// ── Caregiver (their private link https://cc.mo-care.com/hepb.html?h=<record>&e=<expiry>&t=<code>, 21 days; body { h, e, t })
//   view           -> { first, status, status_label, answered, can_choose[], declination: { title, version, intro[], statement,
//                    fingerprint }, doses_recorded, proofs_on_file{}, declined_at, office_phone }
//   choose         { choice: vaccine|prior_series|immune|contraindicated }
//   decline        { typed_name, consent: true, fingerprint } -> { copy_url }  signs Appendix A; the PDF is kept privately
//   upload_url     { kind: series_proof|titer_proof, content_type } / uploaded { kind, path, content_type }
// ── Schedule (x-cron-secret = HUB_JOB_SECRET, every 30 minutes; or the owner's server key)
//   pass           {} -> counts. Sets up new-path hires at Approve to Work (position from the offer); fills in the initial
//                    assignment and the deadline; a card when training is not confirmed; sends the offer link once the
//                    training is confirmed (Mon to Sat 9am to 6pm Central, held never dropped; practice while hepb_offer_live
//                    is off, except the Admin test people; practice people never); a card when the deadline passes with no
//                    offer, or with no answer.
//   mirror_all     {} -> counts. The readiness row for every record.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { jobCaller } from '../_shared/job-auth.ts'
import { isOwner } from '../_shared/onboarding-permissions.ts'
import { checkLink, makeHepbLink } from '../_shared/applicant-links.ts'
import { logOpen, ipOf } from '../_shared/doc-log.ts'
import { ghlContactIfAllowed, practicePerson } from '../_shared/optout.ts'
import { ghlSendChecked } from '../_shared/send-problems.ts'
import { latestTextConsent, inTextHours, withStop } from '../_shared/text-consent.ts'
import { inReminderWindow, refusedForGood, REMINDER_TRIES } from '../_shared/step2.ts'
import { testPerson } from '../_shared/test-people.ts'
import { longDateTime } from '../_shared/offer-documents.ts'
import { personOf, domainOwner } from '../_shared/driver.ts'
import { BUCKET, CHOICES, CAREGIVER_DOC_KINDS, DOC_KINDS, DOC_LABEL, MIME, NOT_SET_UP, OWNER_LABEL, DECLINATION, exposureTable, exposureFor, FALLBACK_POSITION,
  declinationFingerprint, declinationPdf, publicStatus, obligationMet, mayChoose, assignmentFrom, dueFrom, offerMessage, todayCentral, isYmd, longDate,
  addEvent, ownerEmails, raiseCard, closeCard, journeyMirror, type Who } from '../_shared/hepb.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
// deno-lint-ignore no-explicit-any
type Any = any
const S = (v: unknown, n = 160) => String(v ?? '').trim().slice(0, n)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const OFFICE = '(417) 234-8494'
const NOPE = { ok: false, error: 'This link is not valid or has run out. Please ask the office for a new one: ' + OFFICE + '.' }
export const SENDER = 'hepb', CAP = 25, LINK_SECONDS = 300
const agentOf = (req: Request) => S(req.headers.get('user-agent'), 200)
const ipShort = (req: Request) => S(req.headers.get('cf-connecting-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0], 64)
const CHOICE_WORD: Record<string, string> = { vaccine: 'I want the vaccine', prior_series: 'I already completed the series', immune: 'An antibody test shows I am immune', contraindicated: 'I cannot receive it for medical reasons' }

async function settings(db: Any) { const { data } = await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle(); return (data?.data && typeof data.data === 'object') ? data.data : {} }
async function rowById(db: Any, id: unknown) { const k = S(id, 64); if (!UUID.test(k)) return null; const { data } = await db.from('hepb_record').select('*').eq('id', k).maybeSingle(); return data ?? null }
async function docsOf(db: Any, id: string): Promise<Any[]> { const { data } = await db.from('hepb_document').select('*').eq('hepb_id', id); return data ?? [] }
async function save(db: Any, id: string, upd: Record<string, unknown>) {
  const { data, error } = await db.from('hepb_record').update(upd).eq('id', id).select('*').maybeSingle()
  if (error || !data) throw new Error('could not save the hepatitis B record' + (error ? ': ' + S(error.message, 120) : ''))
  return data
}
const slotFor = (id: string, kind: string, ct: string) => `hb/${id}/${kind}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${MIME[ct]}`
const slotOk = (id: string, kind: string, p: string) => new RegExp(`^hb/${id}/${kind}/[A-Za-z0-9._-]{1,80}$`).test(p)
async function fileThere(db: Any, p: string): Promise<boolean> {
  const i = p.lastIndexOf('/'); const { data, error } = await db.storage.from(BUCKET).list(p.slice(0, i), { search: p.slice(i + 1) })
  return !error && Array.isArray(data) && data.some((f: Any) => f?.name === p.slice(i + 1))
}
const nameOf = (p: Any, row: Any) => `${p.first} ${p.last}`.trim() || S(row.name, 120) || 'a caregiver'
const practiceOf = (p: { phone: string; email: string; first: string; last: string }) => practicePerson(p.phone, p.email) || /\(TRAINING\)/.test(`${p.first} ${p.last}`)
const linkFor = (id: string) => makeHepbLink(Deno.env.get('HUB_JOB_SECRET') ?? '', id)
/** the declination can be signed once, before anything was checked or recorded */
const canDecline = (row: Any) => !row.declined_at && !row.verified_at && !(Array.isArray(row.doses) && row.doses.length) && ['pending', 'vaccine', 'prior_series', 'immune', 'contraindicated'].includes(row.status)
const late = (row: Any, today: string) => !!row.due_date && String(row.due_date).slice(0, 10) < today && row.status === 'pending'

/* the position on the offer (Training Platform job_offers), read only */
async function offerPosition(offerId: string): Promise<string | null> {
  const url = Deno.env.get('OFFERS_PROJECT_URL') ?? '', key = Deno.env.get('OFFERS_SERVICE_ROLE_KEY') ?? ''
  if (!url || !key || !UUID.test(offerId)) return null
  try {
    const r = await fetch(`${url}/rest/v1/job_offers?id=eq.${encodeURIComponent(offerId)}&select=id,position`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
    if (!r.ok) return null
    const rows = await r.json(); return Array.isArray(rows) && rows.length === 1 ? (S(rows[0].position, 80) || null) : null
  } catch { return null }
}
/** a new record (the pass for a new-path hire, or the office's Set up); exposure decided now from the table in force */
async function create(db: Any, st: Any, base: { offer_id?: string | null; caregiver_id?: string | null; axiscare_id?: string | null; name: string }, position: string | null, source: string, who: Who, roster: Any) {
  const ex = exposureFor(position, st), now = new Date().toISOString()
  const a = assignmentFrom(roster), due = dueFrom(a.date, st.company_holidays)
  const ins = { offer_id: base.offer_id || null, caregiver_id: base.caregiver_id || null, axiscare_id: base.axiscare_id || null, name: base.name, position: position || FALLBACK_POSITION, position_source: position ? source : 'fallback',
    exposed: ex.exposed, exposure_basis: { position: ex.matched, scope: ex.scope, source: ex.source, fallback: ex.fallback }, status: ex.exposed ? 'pending' : 'not_required', status_at: now,
    assignment_date: ex.exposed ? a.date : null, assignment_source: ex.exposed ? a.source : null, due_date: ex.exposed ? due : null }
  const { data: row, error } = await db.from('hepb_record').insert(ins).select('*').maybeSingle()
  if (error || !row) throw new Error('could not set up the hepatitis B record' + (error ? ': ' + S(error.message, 120) : ''))
  await addEvent(db, row.id, 'created', who, { position: row.position, position_source: row.position_source, exposed: row.exposed, basis: row.exposure_basis, assignment: a, due })
  await journeyMirror(db, row, who)
  return row
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

/* ── the 30-minute pass ── */
async function pass(db: Any, st: Any): Promise<Record<string, unknown>> {
  const now = new Date(), nowIso = now.toISOString(), today = todayCentral(now), live = st.hepb_offer_live === true
  const out = { ok: true, live, today, linked: 0, arrange: 0, created: 0, not_required: 0, dated: 0, offered: 0, practice: 0, held: 0, retry: 0, refused: 0, cards: 0, capped: 0, not_current: 0, errors: 0 }
  const sys: Who = { name: 'The Hub (hepatitis B pass)' }
  const fallback = await domainOwner(db, 'caregivers'), office = fallback.email ? fallback : { email: S(st.staffing_email, 160).toLowerCase(), name: '' }
  /* 1. new-path hires: a roster caregiver with an offer and an Approve to Work stamp, no record yet */
  const { data: cgd } = await db.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()
  const roster: Any[] = Array.isArray(cgd?.data) ? cgd.data : []
  const { data: have } = await db.from('hepb_record').select('id, offer_id, caregiver_id, step1_at')
  const haveOffer = new Set((have ?? []).map((x: Any) => String(x.offer_id || ''))), haveCg = new Set((have ?? []).map((x: Any) => String(x.caregiver_id || '')))
  for (const r of roster) {
    if (!r || r.active === false || !UUID.test(S(r.offer_id, 64)) || !r.approved_to_work_at) continue
    /* 2026-10-13 HEPATITIS B IN STEP 1: someone who answered in Step 1 already has their record (by offer). It is never made
       twice and never offered again (only 'pending' records are sent an offer). At Approve to Work it is linked to their
       roster record, its initial assignment and 10-working-day deadline are set, and an accepted vaccine gets the owners'
       Arrange card now that the deadline is known. */
    const s1 = (have ?? []).find((x: Any) => String(x.offer_id || '') === String(r.offer_id) && x.step1_at && !x.caregiver_id)
    if (s1 && !haveCg.has(String(r.id))) {
      try {
        const { data: full } = await db.from('hepb_record').select('*').eq('id', s1.id).maybeSingle()
        if (full) {
          const a = assignmentFrom(r), upd: Record<string, unknown> = { caregiver_id: String(r.id), axiscare_id: r.axiscare_id ? String(r.axiscare_id) : full.axiscare_id }
          if (!full.assignment_date && a.date) Object.assign(upd, { assignment_date: a.date, assignment_source: a.source, due_date: dueFrom(a.date, st.company_holidays) })
          const row = await save(db, full.id, upd); s1.caregiver_id = row.caregiver_id; haveCg.add(String(r.id)); out.linked++
          await addEvent(db, row.id, 'assignment_set', sys, { linked: 'roster at Approve to Work', caregiver_id: row.caregiver_id, date: row.assignment_date, source: row.assignment_source, due: row.due_date })
          await journeyMirror(db, row, sys)
        }
      } catch (e) { out.errors++; await raiseCard(db, { id: 'hepb_link_' + r.id, kind: 'hepb_pass_failed', urgency: 'today', who: `${S(r.first, 60)} ${S(r.last, 60)}`.trim(), offer_id: String(r.offer_id), owner: office.email, owner_name: office.name,
        title: 'Hepatitis B record not linked: ' + `${S(r.first, 60)} ${S(r.last, 60)}`.trim(), detail: `They answered the hepatitis B offer in Step 1, but the pass could not link the record to their caregiver record (${S((e as Error)?.message ?? e, 160)}). Tell Claude.` }) }
      continue
    }
    if (haveOffer.has(String(r.offer_id)) || haveCg.has(String(r.id))) continue
    try {
      let pos = await offerPosition(String(r.offer_id)), src = 'offer'
      if (!pos && S(r.position, 80)) { pos = S(r.position, 80); src = 'roster' }
      const row = await create(db, st, { offer_id: String(r.offer_id), caregiver_id: String(r.id), axiscare_id: r.axiscare_id ? String(r.axiscare_id) : null, name: `${S(r.first, 60)} ${S(r.last, 60)}`.trim() }, pos, src, sys, r)
      out.created++; if (row.status === 'not_required') out.not_required++
    } catch (e) {
      out.errors++
      await raiseCard(db, { id: 'hepb_setup_' + r.id, kind: 'hepb_pass_failed', urgency: 'today', who: `${S(r.first, 60)} ${S(r.last, 60)}`.trim(), offer_id: String(r.offer_id), owner: office.email, owner_name: office.name,
        title: 'Hepatitis B record could not be set up: ' + `${S(r.first, 60)} ${S(r.last, 60)}`.trim(), detail: `The pass could not set up their hepatitis B record (${S((e as Error)?.message ?? e, 160)}). Their vaccine offer is due within 10 working days of their first client visit. Tell Claude.` })
    }
  }
  /* 2. every open record */
  const { data: rows } = await db.from('hepb_record').select('*').eq('status', 'pending')
  let sends = 0
  for (const row0 of rows ?? []) {
    try {
      let row = row0
      const p = await personOf(db, row), name = nameOf(p, row)
      const owner = p.coordinator ? { email: p.coordinator, name: '' } : office
      if (!p.current) { out.not_current++; continue }
      if (!row.assignment_date) {
        const a = assignmentFrom(p.roster)
        if (a.date) { row = await save(db, row.id, { assignment_date: a.date, assignment_source: a.source, due_date: dueFrom(a.date, st.company_holidays) }); await addEvent(db, row.id, 'assignment_set', sys, { date: a.date, source: a.source, due: row.due_date }); await journeyMirror(db, row, sys); out.dated++ }
      }
      const due = row.due_date ? String(row.due_date).slice(0, 10) : null
      if (!row.training_date && !row.offered_at) {
        if (row.assignment_date && await raiseCard(db, { id: 'hepb_training_' + row.id, kind: 'hepb_training', urgency: 'today', who: name, hepb_id: row.id, offer_id: row.offer_id, owner: owner.email, owner_name: owner.name,
          title: `Confirm bloodborne pathogens training: ${name}`, detail: `${name}'s hepatitis B vaccine offer goes out after their bloodborne pathogens training, and is due by ${due ? longDate(due) : 'their deadline'} (10 working days after initial assignment). Open their Hepatitis B card and enter the training date, or record that you offered it in person.` }) === 'raised') out.cards++
      } else if (!row.offered_at) {
        const stamps: Record<string, Any> = { ...(row.reminders || {}) }
        const test = testPerson(st, p)
        if (practiceOf(p) || (!live && !test)) {
          if (!stamps.offer) { stamps.offer = { at: nowIso, practice: true, ...(practiceOf(p) ? { why: 'a practice person' } : { why: 'hepb_offer_live is off' }) }; row = await save(db, row.id, { reminders: stamps }); await addEvent(db, row.id, 'offer_held', sys, { practice: true, why: stamps.offer.why }) }
          out.practice++
        } else if (!inReminderWindow(now)) {
          out.held++
          if (!stamps['offer:held']) { stamps['offer:held'] = { at: nowIso }; row = await save(db, row.id, { reminders: stamps }); await addEvent(db, row.id, 'offer_held', sys, { why: 'outside Monday to Saturday 9am to 6pm Central' }) }
        } else if (sends >= CAP) out.capped++
        else {
          sends++
          const r = await deliver(db, p, offerMessage(p.first, await linkFor(row.id)))
          const tries = (Number(stamps['offer:tries']?.n) || 0) + 1
          if (r.texted || r.emailed) {
            row = await save(db, row.id, { offered_at: nowIso, offered_via: [r.texted ? 'text' : '', r.emailed ? 'email' : ''].filter(Boolean).join(' and '), reminders: { ...stamps, offer: { at: nowIso, texted: r.texted, emailed: r.emailed, not_sent: r.not_sent } } })
            await addEvent(db, row.id, 'offered', sys, { texted: r.texted, emailed: r.emailed, not_sent: r.not_sent, test_person: test && !live })
            await closeCard(db, 'hepb_training_' + row.id, 'Offer sent.'); await journeyMirror(db, row, sys); out.offered++
          } else if (refusedForGood(r.not_sent) || tries >= REMINDER_TRIES) {
            row = await save(db, row.id, { reminders: { ...stamps, offer: { at: nowIso, texted: false, emailed: false, not_sent: r.not_sent, refused: true, tries } } })
            await addEvent(db, row.id, 'offer_refused', sys, { not_sent: r.not_sent, tries }); out.refused++
            if (await raiseCard(db, { id: 'hepb_send_' + row.id, kind: 'send_problem', urgency: 'today', who: name, hepb_id: row.id, offer_id: row.offer_id, owner: owner.email, owner_name: owner.name,
              title: `Hepatitis B vaccine offer did not reach ${name}`, detail: `Their offer link could not go: ${r.not_sent.join('; ') || 'no reason given'}. Offer it in person or by phone and press Record offer on their Hepatitis B card, or press Send link. It is due by ${due ? longDate(due) : 'their deadline'}.` }) === 'raised') out.cards++
          } else { row = await save(db, row.id, { reminders: { ...stamps, 'offer:tries': { n: tries, last_at: nowIso, not_sent: r.not_sent } } }); out.retry++ }
        }
      }
      /* 3. the deadline: no offer, or no answer */
      if (due && due < today) {
        if (!row.offered_at) {
          if (await raiseCard(db, { id: 'hepb_late_' + row.id, kind: 'hepb_late', urgency: 'urgent', who: name, hepb_id: row.id, offer_id: row.offer_id, owner: owner.email, owner_name: owner.name,
            title: `Hepatitis B vaccine not offered by the deadline: ${name}`, detail: `OSHA requires the offer within 10 working days of initial assignment; ${name}'s deadline was ${longDate(due)}. ${row.training_date ? 'Their training is confirmed.' : 'Their bloodborne pathogens training is not confirmed yet.'} Offer it today and record it on their Hepatitis B card.` }) === 'raised') out.cards++
        } else if (await raiseCard(db, { id: 'hepb_noanswer_' + row.id, kind: 'hepb_no_answer', urgency: 'today', who: name, hepb_id: row.id, offer_id: row.offer_id, owner: owner.email, owner_name: owner.name,
          title: `No answer yet to the hepatitis B vaccine offer: ${name}`, detail: `The vaccine was offered ${longDate(todayCentral(row.offered_at))} and ${name} has not answered. Ask them to answer on their link (Send link), or record their answer. If they decline, they must sign the declination themselves.` }) === 'raised') out.cards++
      }
    } catch (e) {
      out.errors++
      await raiseCard(db, { id: 'hepb_pass_' + row0.id, kind: 'hepb_pass_failed', urgency: 'today', who: S(row0.name, 120), hepb_id: row0.id, offer_id: row0.offer_id, owner: office.email,
        title: 'Hepatitis B pass could not check ' + (S(row0.name, 120) || 'a caregiver'), detail: `The 30-minute hepatitis B pass could not work their record (${S((e as Error)?.message ?? e, 160)}). Their offer or a deadline card may be waiting. Tell Claude.` })
    }
  }
  /* 4. 2026-10-13: an accepted vaccine (in Step 1 or on the link) with no dose recorded: the owners arrange it within 10
     working days of initial assignment ((f)(2)(i)); one Arrange card once the deadline is known, one urgent card if the
     deadline passes with no dose recorded. The cards never name the answer beyond "accepted". */
  const { data: acc } = await db.from('hepb_record').select('*').eq('status', 'vaccine')
  const owners = await ownerEmails(db)
  for (const row of acc ?? []) {
    try {
      if ((Array.isArray(row.doses) && row.doses.length) || !row.due_date) continue
      const p = await personOf(db, row), name = nameOf(p, row), due = String(row.due_date).slice(0, 10)
      if (!p.current) { out.not_current++; continue }
      /* the link's own yes already raised its Arrange card (applyChoice); a Step 1 yes gets it here, once the deadline is known */
      if (row.step1_at && await raiseCard(db, { id: 'hepb_arrange_' + row.id, kind: 'hepb_arrange', urgency: 'today', who: name, hepb_id: row.id, offer_id: row.offer_id, owner: owners[0] || '',
        title: `Arrange the hepatitis B vaccine for ${name}`, detail: `${name} accepted the hepatitis B vaccine. Arrange the first shot by ${longDate(due)} (10 working days after initial assignment), at no cost to them, at a reasonable time and place, with a licensed healthcare professional, and record each dose on their Hepatitis B card (owners only).` }) === 'raised') { out.arrange++; out.cards++ }
      if (due < today && await raiseCard(db, { id: 'hepb_dose_late_' + row.id, kind: 'hepb_late', urgency: 'urgent', who: name, hepb_id: row.id, offer_id: row.offer_id, owner: owners[0] || '',
        title: `Hepatitis B vaccine not arranged by the deadline: ${name}`, detail: `${name} accepted the hepatitis B vaccine and no dose is recorded. OSHA requires it to be made available within 10 working days of initial assignment; the deadline was ${longDate(due)}. Arrange it today and record the dose on their Hepatitis B card.` }) === 'raised') out.cards++
    } catch { out.errors++ }
  }
  try { await db.rpc('upsert_app_data_item', { target_key: 'automation_log', item: { id: 'auto_srv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), at: nowIso, automation: 'hepb', ran_by: 'server', ok: out.errors === 0, dry: !live, summary: out } }) } catch { /* never takes the pass down */ }
  try { await db.rpc('upsert_app_data_item', { target_key: 'automation_heartbeats', item: { id: 'hb_hepb', automation: 'hepb', at: nowIso, ok: out.errors === 0, note: JSON.stringify(out).slice(0, 300) } }) } catch { /* same */ }
  return out
}

/** the answer, recorded (the link or an owner): status, stamps, history, the readiness row, the card for the owners */
async function applyChoice(db: Any, row: Any, choice: string, who: Who, via: string) {
  const now = new Date().toISOString(), was = row.status
  row = await save(db, row.id, { status: choice, status_at: now, choice_at: now, choice_by: S(who.name, 120) || via, verified_at: null, verified_by: null })
  await addEvent(db, row.id, 'chose', who, { choice, was, via, ...(was === 'declined' ? { after_declining: true, rule: '1910.1030(f)(2)(iii)' } : {}) })
  await journeyMirror(db, row, who)
  const p = await personOf(db, row), name = nameOf(p, row), owners = await ownerEmails(db)
  for (const id of ['hepb_late_', 'hepb_noanswer_', 'hepb_training_']) await closeCard(db, id + row.id, 'Answered.')
  if (choice === 'vaccine') await raiseCard(db, { id: `hepb_arrange_${row.id}_${now.slice(0, 10)}`, kind: 'hepb_arrange', urgency: 'today', who: name, hepb_id: row.id, offer_id: row.offer_id, owner: owners[0] || '',
    title: `Arrange the hepatitis B vaccine for ${name}`, detail: `${name} accepted the hepatitis B vaccine. Arrange it at no cost to them, at a reasonable time and place, with a licensed healthcare professional, and record each dose on their Hepatitis B card (owners only).` })
  else await raiseCard(db, { id: `hepb_check_${row.id}_${now.slice(0, 10)}`, kind: 'hepb_check', urgency: 'normal', who: name, hepb_id: row.id, offer_id: row.offer_id, owner: owners[0] || '',
    title: `Check a hepatitis B answer: ${name}`, detail: `${name} answered the hepatitis B vaccine offer. An owner opens their Hepatitis B card, checks it, and presses Checked. The answer is a confidential medical record, so it is not written here.` })
  return row
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
      const { data: rows } = await db.from('hepb_record').select('*'); const out: Record<string, number> = { looked_at: 0 }
      for (const r of rows ?? []) { out.looked_at++; const m = await journeyMirror(db, r, { name: 'The Hub (install)' }); out['journey_' + m] = (out['journey_' + m] || 0) + 1 }
      return json({ ok: true, ...out })
    }
    /* ═══ the caregiver's private link ═══ */
    if (b.t != null) {
      if (!(await checkLink(Deno.env.get('HUB_JOB_SECRET') ?? '', 'hepb', b.h, b.e, b.t))) return json(NOPE, 401)
      let row = await rowById(db, b.h); if (!row) return json(NOPE, 404)
      const p = await personOf(db, row), cg: Who = { name: nameOf(p, row) + ' (hepatitis B link)' }
      if (row.status === 'not_required') return json({ ok: false, error: 'The hepatitis B vaccine offer does not apply to your position. Questions: ' + OFFICE + '.', not_required: true }, 409)
      if (action === 'view') {
        const docs = await docsOf(db, row.id)
        return json({ ok: true, first: p.first, status: row.status, status_label: OWNER_LABEL[row.status as 'pending'], answered: row.status !== 'pending', verified: !!row.verified_at,
          can_choose: [...CHOICES.filter((c) => mayChoose(row, c).ok), ...(canDecline(row) ? ['declined'] : [])],
          declination: { title: DECLINATION.title, version: DECLINATION.version, intro: DECLINATION.intro, statement: DECLINATION.statement, fingerprint: await declinationFingerprint() },
          doses_recorded: Array.isArray(row.doses) ? row.doses.length : 0, series_complete: !!row.series_complete_at, declined_at: row.declined_at || null,
          proofs_on_file: Object.fromEntries(CAREGIVER_DOC_KINDS.map((k) => [k, docs.some((d) => d.kind === k)])), office_phone: OFFICE })
      }
      if (action === 'choose') {
        const choice = S(b.choice, 20)
        if (!(CHOICES as readonly string[]).includes(choice)) return json({ ok: false, error: 'Please choose one of the answers.' }, 400)
        const m = mayChoose(row, choice); if (!m.ok) return json({ ok: false, error: m.why }, 409)
        row = await applyChoice(db, row, choice, cg, 'hepatitis B link')
        return json({ ok: true, status: row.status, status_label: OWNER_LABEL[row.status as 'pending'] })
      }
      if (action === 'decline') {
        if (row.declined_at) return json({ ok: false, error: 'You already signed the declination. A signed declination is never changed. You can still choose the vaccine here at any time.', already: true }, 409)
        if (!canDecline(row)) return json({ ok: false, error: 'The office has already recorded your answer. To change it, please call ' + OFFICE + '.' }, 409)
        /* a real person signs only once the owner turned the offer on (or they are on the Admin test list); practice people always */
        if (!practiceOf(p) && st.hepb_offer_live !== true && !testPerson(st, p)) return json({ ok: false, error: 'This form is not open for signing yet. The office will let you know: ' + OFFICE + '.', not_live: true }, 409)
        if (b.consent !== true) return json({ ok: false, error: 'Please tick "I agree to sign this statement electronically" first.' }, 400)
        const typed = S(b.typed_name, 80)
        if (!/^\S+(\s+\S+)+$/.test(typed) || typed.length < 4) return json({ ok: false, error: 'Please type your full name, first and last.' }, 400)
        const fp = await declinationFingerprint()
        if (S(b.fingerprint, 64) !== fp) return json({ ok: false, error: 'The statement on your screen is out of date. Please reload the page and read it again.', stale: true }, 409)
        const at = now, ip = ipShort(req), agent = agentOf(req)
        const bytes = declinationPdf({ first: p.first, last: p.last, position: row.position }, { typedName: typed, signedAtCentral: longDateTime(at), signedAtUtc: at, ip, agent, fingerprint: fp, recordId: row.id })
        const pdfPath = `hb/${row.id}/declination/v${DECLINATION.version}-${at.replace(/[:.]/g, '-')}.pdf`
        const up = await db.storage.from(BUCKET).upload(pdfPath, bytes, { contentType: 'application/pdf', upsert: false })
        const was = row.status
        row = await save(db, row.id, { status: 'declined', status_at: at, choice_at: at, choice_by: cg.name, declined_at: at, declination_version: DECLINATION.version, declination_fingerprint: fp, declination_typed_name: typed, declination_pdf: up.error ? null : pdfPath })
        await addEvent(db, row.id, 'declined', cg, { typed_name: typed, version: DECLINATION.version, fingerprint: fp, ip, agent, consent: true, pdf: up.error ? null : pdfPath, was })
        await journeyMirror(db, row, cg)
        for (const id of ['hepb_late_', 'hepb_noanswer_', 'hepb_training_']) await closeCard(db, id + row.id, 'Answered.')
        if (up.error) await raiseCard(db, { id: 'hepb_pdf_' + row.id, kind: 'hepb_pdf_failed', urgency: 'today', who: nameOf(p, row), hepb_id: row.id, offer_id: row.offer_id, owner: (await ownerEmails(db))[0] || '',
          title: 'A signed hepatitis B form has no PDF yet: ' + nameOf(p, row), detail: `The signature is recorded (time, device, wording fingerprint) but its PDF could not be saved (${S(up.error.message || up.error, 120)}). Tell Claude so the PDF is made again from the signed record.` })
        const cp = up.error ? { data: null } : await db.storage.from(BUCKET).createSignedUrl(pdfPath, 600)
        return json({ ok: true, status: row.status, status_label: OWNER_LABEL.declined, pdf: !up.error, copy_url: cp.data?.signedUrl ?? null })
      }
      if (action === 'upload_url') {
        const kind = S(b.kind, 20), ct = S(b.content_type, 60).toLowerCase()
        if (!CAREGIVER_DOC_KINDS.includes(kind)) return json({ ok: false, error: 'Which proof: your vaccine record or your antibody test result?' }, 400)
        if (!MIME[ct]) return json({ ok: false, error: 'Please use a photo (JPG, PNG, HEIC or WebP) or a PDF.' }, 400)
        const path = slotFor(row.id, kind, ct)
        const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path)
        if (error || !data) return json({ ok: false, error: 'Could not prepare the upload. Please try again, or call ' + OFFICE + '.' }, 500)
        return json({ ok: true, path, token: data.token, url: data.signedUrl })
      }
      if (action === 'uploaded') {
        const kind = S(b.kind, 20), path = S(b.path, 500), ct = S(b.content_type, 60).toLowerCase()
        if (!CAREGIVER_DOC_KINDS.includes(kind) || !slotOk(row.id, kind, path) || !MIME[ct]) return json({ ok: false, error: 'That upload is not one of yours. Please try again.' }, 403)
        if (!(await fileThere(db, path))) return json({ ok: false, error: 'We did not receive the file. Please upload it again.' }, 409)
        const docs = await docsOf(db, row.id)
        if (!docs.some((d) => d.path === path)) {
          const { data: nd, error } = await db.from('hepb_document').insert({ hepb_id: row.id, kind, path, content_type: ct, uploaded_by: 'caregiver', uploaded_at: now }).select('*').maybeSingle()
          if (error || !nd) return json({ ok: false, error: 'Your file arrived but could not be recorded. Please try again.' }, 500)
          await addEvent(db, row.id, 'doc_uploaded', cg, { kind, doc_id: nd.id, content_type: ct })
          await raiseCard(db, { id: 'hepb_proof_' + nd.id, kind: 'hepb_check', urgency: 'normal', who: nameOf(p, row), hepb_id: row.id, offer_id: row.offer_id, owner: (await ownerEmails(db))[0] || '',
            title: 'A hepatitis B document to check: ' + nameOf(p, row), detail: 'A document was added on their private link. An owner opens their Hepatitis B card, checks it, and presses Checked.' })
        }
        return json({ ok: true })
      }
      return json({ ok: false, error: 'Unknown action.' }, 400)
    }
    /* ═══ the office ═══ */
    const who = await requireStaff(db, req, OFFICE_ROLES)
    if (!who.ok) return json({ ok: false, error: who.error }, who.status)
    const actor: Who = { name: who.name, email: who.email, person_id: who.person_id }
    const owner = isOwner({ person_id: who.person_id, roles: who.roles })
    const OWNERS_ONLY = { ok: false, error: 'Hepatitis B answers, doses and documents are confidential medical records: only an owner may see or record them.' }
    if (action === 'exposure') return json({ ok: true, table: exposureTable(st), fallback: FALLBACK_POSITION })
    if (action === 'get') {
      let row: Any = null
      if (b.key) row = await rowById(db, b.key)
      else if (b.offer_id && UUID.test(S(b.offer_id, 64))) row = (await db.from('hepb_record').select('*').eq('offer_id', S(b.offer_id, 64)).maybeSingle()).data
      else if (b.caregiver_id) row = (await db.from('hepb_record').select('*').eq('caregiver_id', S(b.caregiver_id, 40)).maybeSingle()).data
      else if (b.axiscare_id) { const { data } = await db.from('hepb_record').select('*').eq('axiscare_id', S(b.axiscare_id, 20)); row = (data ?? []).length === 1 ? data![0] : null }
      else return json({ ok: false, error: 'Which person?' }, 400)
      if (!row) return json({ ok: true, row: null, status_label: NOT_SET_UP, owner })
      const pub = { id: row.id, name: row.name, position: row.position, exposed: row.exposed, status_label: publicStatus(row), done: obligationMet(row), training_date: row.training_date, training_confirmed_by: row.training_confirmed_by,
        assignment_date: row.assignment_date, assignment_source: row.assignment_source, due_date: row.due_date, offered_at: row.offered_at, offered_via: row.offered_via, late: late(row, today), may_send: row.status === 'pending' || row.status === 'declined' }
      if (!owner) return json({ ok: true, row: pub, owner: false })
      const docs = await docsOf(db, row.id), { data: ev } = await db.from('hepb_event').select('at, kind, by_name, detail').eq('hepb_id', row.id).order('at', { ascending: false }).limit(300)
      await logOpen(db, { subject: 'hepb:' + row.id, doc: 'hepb:record', path: 'hepb_record/' + row.id, who: actor, reason: 'viewed the hepatitis B record', ip: ipOf(req) })
      return json({ ok: true, row: pub, owner: true, detail: { status: row.status, status_label: OWNER_LABEL[row.status as 'pending'], choice_at: row.choice_at, choice_by: row.choice_by, doses: row.doses || [], verified_at: row.verified_at, verified_by: row.verified_by,
        declined_at: row.declined_at, declination_typed_name: row.declination_typed_name, declination_pdf: !!row.declination_pdf, series_complete_at: row.series_complete_at, exposure_basis: row.exposure_basis },
        docs: docs.map((d) => ({ id: d.id, kind: d.kind, label: DOC_LABEL[d.kind] || d.kind, uploaded_at: d.uploaded_at, uploaded_by: d.uploaded_by })).sort((a, c) => String(c.uploaded_at).localeCompare(String(a.uploaded_at))), events: ev ?? [] })
    }
    if (action === 'setup') {
      const cid = S(b.caregiver_id, 40); if (!cid) return json({ ok: false, error: 'Which caregiver?' }, 400)
      const { data: cg } = await db.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()
      const list = (Array.isArray(cg?.data) ? cg.data : []).filter((x: Any) => x && String(x.id) === cid)
      if (list.length !== 1) return json({ ok: false, error: 'That caregiver is not on the roster (or two records share the number).' }, 404)
      const r = list[0]
      const { data: hv } = await db.from('hepb_record').select('id').eq('caregiver_id', cid).maybeSingle()
      if (hv) return json({ ok: false, error: 'Hepatitis B is already set up for them.', key: hv.id }, 409)
      let pos = S(b.position, 80) || null, src = 'office'
      if (!pos && UUID.test(S(r.offer_id, 64))) { pos = await offerPosition(String(r.offer_id)); src = 'offer' }
      if (!pos && S(r.position, 80)) { pos = S(r.position, 80); src = 'roster' }
      const row = await create(db, st, { offer_id: UUID.test(S(r.offer_id, 64)) ? S(r.offer_id, 64) : null, caregiver_id: cid, axiscare_id: r.axiscare_id ? String(r.axiscare_id) : null, name: `${S(r.first, 60)} ${S(r.last, 60)}`.trim() }, pos, src, actor, r)
      return json({ ok: true, row: { id: row.id, position: row.position, exposed: row.exposed, status_label: publicStatus(row), due_date: row.due_date } })
    }
    if (action === 'open') {
      if (!owner) return json(OWNERS_ONLY, 403)
      let path = '', doc = '', subject = ''
      if (b.doc_id) {
        const id = S(b.doc_id, 64); if (!UUID.test(id)) return json({ ok: false, error: 'Which document?' }, 400)
        const { data: d } = await db.from('hepb_document').select('*').eq('id', id).maybeSingle()
        if (!d) return json({ ok: false, error: 'That document was not found.' }, 404)
        path = d.path; doc = 'hepb:' + d.kind; subject = 'hepb:' + d.hepb_id
      } else {
        const row = await rowById(db, b.key); if (!row) return json({ ok: false, error: 'Which person?' }, 404)
        if (b.what !== 'declination' || !row.declination_pdf) return json({ ok: false, error: 'No signed declination PDF is on file.' }, 404)
        path = row.declination_pdf; doc = 'hepb:declination'; subject = 'hepb:' + row.id
      }
      const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, LINK_SECONDS)
      if (error || !data?.signedUrl) return json({ ok: false, error: 'Could not open the document.' }, 500)
      if (!(await logOpen(db, { subject, doc, path, who: actor, reason: S(b.reason, 120) || 'opened on the Hepatitis B card', ip: ipOf(req) }))) return json({ ok: false, error: 'The open could not be logged, so the document is not shown. Try again.' }, 500)
      return json({ ok: true, url: data.signedUrl, expires_in: LINK_SECONDS })
    }
    let row = await rowById(db, b.key)
    if (!row) return json({ ok: false, error: 'Which person? (Hepatitis B is not set up for them.)' }, 404)
    const name = S(row.name, 120) || 'this caregiver'
    const back = async (r: Any) => json({ ok: true, row: { id: r.id, status_label: publicStatus(r), training_date: r.training_date, assignment_date: r.assignment_date, due_date: r.due_date, offered_at: r.offered_at, done: obligationMet(r) } })
    if (action === 'confirm_training' || action === 'set_assignment') {
      const d = S(b.date, 10); if (!isYmd(d) || d > today) return json({ ok: false, error: 'Enter the date (not in the future).' }, 400)
      if (action === 'confirm_training') {
        row = await save(db, row.id, { training_date: d, training_confirmed_by: who.name || who.email, training_confirmed_at: now })
        await addEvent(db, row.id, 'training_confirmed', actor, { date: d }); await closeCard(db, 'hepb_training_' + row.id, 'Training confirmed.')
      } else {
        row = await save(db, row.id, { assignment_date: d, assignment_source: 'office', due_date: dueFrom(d, st.company_holidays) })
        await addEvent(db, row.id, 'assignment_set', actor, { date: d, source: 'office', due: row.due_date })
      }
      await journeyMirror(db, row, actor); return back(row)
    }
    if (action === 'record_offer') {
      const how = S(b.how, 120); if (how.length < 3) return json({ ok: false, error: 'How was it offered (in person, by phone, the link pasted)?' }, 400)
      if (row.offered_at) return json({ ok: false, error: 'The offer is already recorded (' + longDate(todayCentral(row.offered_at)) + ').' }, 409)
      if (!row.exposed) return json({ ok: false, error: name + '\'s position has no reasonably anticipated exposure; nothing to offer.' }, 409)
      row = await save(db, row.id, { offered_at: now, offered_via: 'the office: ' + how })
      await addEvent(db, row.id, 'offered', actor, { how }); await closeCard(db, 'hepb_late_' + row.id, 'Offered.'); await closeCard(db, 'hepb_training_' + row.id, 'Offered.')
      await journeyMirror(db, row, actor); return back(row)
    }
    if (action === 'send_link') {
      if (!['pending', 'declined', 'vaccine', 'prior_series', 'immune', 'contraindicated'].includes(row.status)) return json({ ok: false, error: 'Nothing to send: ' + publicStatus(row) + '.' }, 409)
      const p = await personOf(db, row), link = await linkFor(row.id), m = offerMessage(p.first, link)
      let res: Any
      if (practiceOf(p)) res = { state: 'practice', why: 'a practice person: never contacted', link, text: m.text }
      else if (st.hepb_offer_live !== true && !testPerson(st, p)) res = { state: 'practice', why: 'hepb_offer_live is off: nothing was sent. The link is shown for testing only; a real person cannot sign until the switch is on.', link, text: m.text }
      else { const r = await deliver(db, p, m); res = { state: r.texted || r.emailed ? 'sent' : 'failed', texted: r.texted, emailed: r.emailed, not_sent: r.not_sent, text: m.text } }
      if (res.state === 'sent' && !row.offered_at) { row = await save(db, row.id, { offered_at: now, offered_via: 'Send link by ' + (who.name || who.email) }); await closeCard(db, 'hepb_late_' + row.id, 'Offered.'); await journeyMirror(db, row, actor) }
      await addEvent(db, row.id, res.state === 'sent' ? 'offered' : 'note', actor, { link_sent: res.state, texted: !!res.texted, emailed: !!res.emailed, not_sent: res.not_sent || null })
      return json({ ok: true, ...res })
    }
    /* ── owners only from here: the medical record ── */
    if (!owner) return json(OWNERS_ONLY, 403)
    if (action === 'record_choice') {
      const choice = S(b.choice, 20)
      if (choice === 'declined') return json({ ok: false, error: 'A declination is valid only when the employee signs the Appendix A statement themselves. Send them their link.' }, 400)
      if (!(CHOICES as readonly string[]).includes(choice)) return json({ ok: false, error: 'Which answer: vaccine, prior_series, immune or contraindicated?' }, 400)
      if (row.status === 'not_required') return json({ ok: false, error: name + '\'s position has no reasonably anticipated exposure.' }, 409)
      if (row.status === choice) return json({ ok: false, error: 'That is already their answer.' }, 409)
      row = await applyChoice(db, row, choice, actor, 'recorded by an owner'); return back(row)
    }
    if (action === 'record_dose') {
      const d = S(b.date, 10); if (!isYmd(d) || d > today) return json({ ok: false, error: 'Enter the date the dose was given (not in the future).' }, 400)
      if (row.status !== 'vaccine') return json({ ok: false, error: 'Doses are recorded once they chose the vaccine (record their answer first).' }, 409)
      const doses = [...(Array.isArray(row.doses) ? row.doses : []), { n: (row.doses || []).length + 1, date: d, recorded_by: who.name || who.email, recorded_at: now }]
      row = await save(db, row.id, { doses }); await addEvent(db, row.id, 'dose_recorded', actor, { n: doses.length, date: d }); return back(row)
    }
    if (action === 'series_complete') {
      if (row.status !== 'vaccine' || !(row.doses || []).length) return json({ ok: false, error: 'Record the doses first.' }, 409)
      row = await save(db, row.id, { status: 'complete', status_at: now, series_complete_at: now, series_complete_by: who.name || who.email })
      await addEvent(db, row.id, 'series_complete', actor, { doses: (row.doses || []).length }); await journeyMirror(db, row, actor); return back(row)
    }
    if (action === 'verify') {
      if (!['prior_series', 'immune', 'contraindicated'].includes(row.status)) return json({ ok: false, error: 'There is nothing to check for this answer.' }, 409)
      if (row.verified_at) return json({ ok: false, error: 'Already checked.' }, 409)
      if (row.status !== 'contraindicated' && !(await docsOf(db, row.id)).some((d) => d.kind === (row.status === 'immune' ? 'titer_proof' : 'series_proof'))) return json({ ok: false, error: 'Add the proof first (theirs from the link, or one the office holds).' }, 409)
      row = await save(db, row.id, { verified_at: now, verified_by: who.name || who.email })
      await addEvent(db, row.id, 'verified', actor, { status: row.status }); await journeyMirror(db, row, actor); return back(row)
    }
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
      const { data: nd, error } = await db.from('hepb_document').insert({ hepb_id: row.id, kind, path, content_type: ct, uploaded_by: who.name || who.email, uploaded_at: now }).select('*').maybeSingle()
      if (error || !nd) return json({ ok: false, error: 'Could not record the document.' }, 500)
      await addEvent(db, row.id, 'doc_uploaded', actor, { kind, doc_id: nd.id, content_type: ct }); return json({ ok: true, doc_id: nd.id })
    }
    return json({ ok: false, error: 'Unknown action.' }, 400)
  } catch (e) {
    return json({ ok: false, error: 'Something went wrong: ' + ((e as Error).message || 'error') + '.' }, 500)
  }
})
