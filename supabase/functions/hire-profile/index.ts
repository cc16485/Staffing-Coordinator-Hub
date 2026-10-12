// =============================================================================
// hire-profile · THE MAIN PROFILE OF A HIRE (Samantha 2026-10-11: "make sure every send, receive, completed time stamp is
// recorded in their main profile and make it easy for us to access the applicant's main profile from anywhere, and the PDF
// of all signed documents should be saved in the main profile... we need to be able to look at the profile and see it all").
//
// Nothing is copied: every time and every document already lives in its own permanent record (the offer trail, Step 1,
// Background & References, the readiness card and its history, Step 2, the Orientation Video Call, references, training, AxisCare,
// refused sends, logged opens, the evidence value history). This reads them all, for ONE person, into one profile:
//   { action: 'get', offer_id | candidate_id | caregiver_id | applicant_id }   who they are, where they are, the timeline
//        (every send, receipt and completion, oldest first, with who), and every signed document and proof
//   { action: 'doc', offer_id | candidate_id | caregiver_id, ref }              a five-minute link to one of THEIR documents;
//        every open is logged (document_access_log) with your name
//   { action: 'step1_progress', offer_ids: [...] }                             for the offer cards: Step 1 sent, started,
//        how many of the seven forms are signed, done
// Office staff only, by their own sign-in. Sends nothing; changes nothing (the only write is the open log).
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { logOpen, ipOf } from '../_shared/doc-log.ts'
import { evidenceLine } from '../_shared/evidence.ts'
import { experienceSummary } from '../_shared/step1-experience.ts'
import { applicantStatus } from '../_shared/applicant-status.ts'
type Any = any
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const S = (v: unknown, n = 200) => String(v ?? '').trim().slice(0, n)
const d10 = (v: unknown) => String(v ?? '').replace(/\D/g, '').slice(-10)
const OD = 'onboarding-documents', LD = 'lead-docs'
const FORM_TITLES: Record<string, string> = { employee_application: 'Employee Application', reference_consent: 'Reference Check and Authorization Consent', fcra_disclosure: 'Background Check Disclosure',
  edl_fcsr_consent: 'EDL and FCSR Screening Consent', availability: 'Availability and Scheduling Commitment', experience: 'Experience and Client Matching Profile', vehicle: 'Personal Vehicle Insurance Responsibility' }
const OFFER_EVENTS: Record<string, [string, string]> = {
  sent: ['sent', 'Offer sent'], resent: ['sent', 'Offer link sent again'], viewed: ['received', 'They opened the offer'], signed: ['done', 'Offer letter signed'], pd_signed: ['done', 'Position description signed'],
  declined: ['received', 'They declined the offer'], withdrawn: ['done', 'Offer withdrawn'], expired: ['done', 'Offer expired unsigned'], reminder_1: ['sent', 'Offer reminder 1'], reminder_2: ['sent', 'Offer reminder 2'],
  step1_sent: ['sent', 'Step 1 sent automatically'], step1_resent: ['sent', 'Step 1 sent again'], step1_started: ['received', 'They opened Step 1'], step1_signed: ['done', 'Step 1 form signed'],
  step1_done: ['done', 'Step 1 complete'], step1_reminder: ['sent', 'Step 1 reminder'], step1_receipt: ['sent', 'Step 1 receipt'], welcome_sent: ['sent', 'Welcome message sent'] }
const STAMPS: Record<string, [string, string]> = {
  addedAt: ['done', 'Into Background & References'], step1_done_at: ['done', 'Step 1 complete (on their record)'], oig_date: ['done', 'OIG exclusion check recorded'], edl_date: ['done', 'EDL check recorded'],
  fcsr_date: ['done', 'FCSR check recorded'], casenet_date: ['done', 'Case.net court records search recorded'], fp_date: ['done', 'Fingerprint check recorded'], fcsr_reg_date: ['done', 'FCSR registration recorded'], step2_sent_at: ['sent', 'Step 2 (Viventium) sent'],
  step2_resent_at: ['sent', 'Step 2 sent again'], step2_done_at: ['received', 'They said Step 2 is done'], step2_verified_at: ['done', 'Step 2 verified in Viventium'], step2_still_open_at: ['sent', 'Step 2 still-open message'],
  welcome_invited_at: ['sent', 'Invited to the Orientation Video Call'], approved_to_work_at: ['done', 'Approved to Work'], hire_date: ['done', 'Hire date'], orient_date: ['done', 'Orientation completed'],
  alz_date: ['done', 'Dementia course completed'], ojt_date: ['done', 'On-the-job training completed'], annual_date: ['done', 'Annual training'], first_contact: ['done', 'First client visit'] }
const PROOFS: Array<[string, string]> = [['oig_proof', 'OIG check proof'], ['edl_proof', 'EDL check proof'], ['fcsr_proof', 'FCSR check proof'], ['casenet_proof', 'Case.net search result'], ['fp_proof', 'Fingerprint check proof'], ['dl_proof', "Driver's license"],
  ['cna_proof', 'CNA credential'], ['auto_ins_proof', 'Auto insurance'], ['orient_proof', 'Orientation certificate'], ['alz_proof', 'Dementia course certificate'], ['ojt_online_proof', 'On-the-job training (online)'], ['annual_proof', 'Annual training'],
  ['r1_proof', 'Reference 1'], ['r2_proof', 'Reference 2'], ['r3_proof', 'Reference 3'], ['r4_proof', 'Reference 4'], ['r1_pdf', 'Reference 1 (form)'], ['r2_pdf', 'Reference 2 (form)'], ['r3_pdf', 'Reference 3 (form)'], ['r4_pdf', 'Reference 4 (form)']]
const words = (k: string) => k.replace(/_at$/, '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

function trn() {
  const url = Deno.env.get('OFFERS_PROJECT_URL') ?? '', key = Deno.env.get('OFFERS_SERVICE_ROLE_KEY') ?? ''
  const H = { apikey: key, Authorization: `Bearer ${key}` }
  const get = async (path: string) => { if (!url || !key) return []; try { const r = await fetch(`${url}/rest/v1/${path}`, { headers: H }); return r.ok ? await r.json() : [] } catch { return [] } }
  return { get }
}
async function list(db: Any, key: string): Promise<Any[]> { const { data } = await db.from('app_data').select('data').eq('key', key).maybeSingle(); return Array.isArray(data?.data) ? data.data : [] }

/** who this is: the offer, their Background & References record, their roster record, their application, their readiness card */
export async function resolve(db: Any, T: Any, b: Any) {
  const [cands, roster] = await Promise.all([list(db, 'candidates'), list(db, 'caregivers')])
  let offerId = S(b.offer_id, 64)
  let cand = b.candidate_id != null && b.candidate_id !== '' ? cands.find((c) => String(c?.id) === String(b.candidate_id)) : null
  let rec = b.caregiver_id != null && b.caregiver_id !== '' ? roster.find((c) => String(c?.id) === String(b.caregiver_id)) : null
  let app: Any = null
  if (b.applicant_id) { const { data } = await db.from('job_applicants').select('*').eq('id', S(b.applicant_id, 64)).maybeSingle(); app = data }
  if (!offerId) offerId = S(rec?.offer_id || cand?.offer_id, 64)
  let offer: Any = null
  if (offerId && /^[0-9a-f-]{36}$/i.test(offerId)) offer = (await T.get(`job_offers?id=eq.${offerId}&select=*`))[0] || null
  if (!offer && app) {
    const byEmail = app.email ? await T.get(`job_offers?email=ilike.${encodeURIComponent(String(app.email))}&select=*&order=created_at.desc&limit=5`) : []
    const tail = d10(app.phone), byPhone = tail.length === 10 ? await T.get(`job_offers?phone=ilike.*${tail.slice(-4)}*&select=*&order=created_at.desc&limit=20`) : []
    offer = [...byEmail, ...byPhone.filter((o: Any) => d10(o.phone) === tail)].sort((a: Any, z: Any) => String(z.created_at).localeCompare(String(a.created_at)))[0] || null
    if (offer) offerId = String(offer.id)
  }
  if (offerId) { cand = cand || cands.find((c) => String(c?.offer_id || '') === offerId) || null; rec = rec || roster.find((c) => String(c?.offer_id || '') === offerId) || null }
  if (!cand && rec?.candidate_id != null) cand = cands.find((c) => String(c?.id) === String(rec.candidate_id)) || null
  const phone = offer?.phone || rec?.phone || cand?.phone || app?.phone || '', email = offer?.email || rec?.email || cand?.email || app?.email || ''
  if (!app && (email || d10(phone).length === 10)) {
    try {
      if (email) { const r = await db.from('job_applicants').select('*').ilike('email', String(email)).order('created_at', { ascending: false }).limit(1); app = r.data?.[0] ?? null }
      if (!app && d10(phone).length === 10) { const r = await db.from('job_applicants').select('*').ilike('phone', '%' + d10(phone).slice(-4)).order('created_at', { ascending: false }).limit(10); app = (r.data ?? []).find((x: Any) => d10(x.phone) === d10(phone)) ?? null }
    } catch { app = null }
  }
  let journey: Any = null
  if (offerId) { const { data } = await db.from('client_journey').select('*').eq('subject', 'caregiver').eq('offer_id', offerId).order('created_at', { ascending: false }).limit(1); journey = data?.[0] ?? null }
  const name = offer ? `${offer.first_name || ''} ${offer.last_name || ''}`.trim() : rec ? `${rec.first || ''} ${rec.last || ''}`.trim() : cand ? `${cand.first || ''} ${cand.last || ''}`.trim() : app ? `${app.first_name || ''} ${app.last_name || ''}`.trim() : ''
  return { offerId, offer, cand, rec, app, journey, name, phone, email }
}

/** every signed document and proof of this person, each with a ref only this person's profile can open */
export async function documents(db: Any, p: Any) {
  const out: Array<{ ref: string; label: string; at: string | null; kind: string }> = []
  const add = (bucket: string, path: unknown, label: string, at: unknown, kind: string) => {
    const s = S(path, 500); if (!s) return
    const ref = /^https?:\/\//i.test(s) ? 'url:' + s : (bucket === OD ? 'od:' : 'ld:') + s
    if (!out.some((d) => d.ref === ref)) out.push({ ref, label, at: at ? String(at) : null, kind })
  }
  if (p.offer) { add(OD, p.offer.offer_pdf_path, 'Offer letter (signed)', p.offer.offer_signed_at, 'signed'); add(OD, p.offer.pd_pdf_path, 'Position description (signed)', p.offer.pd_signed_at, 'signed') }
  if (p.offerId) {
    const { data: f } = await db.from('step1_forms').select('pdfs, signatures').eq('offer_id', p.offerId).maybeSingle()
    for (const [k, v] of Object.entries((f?.pdfs || {}) as Record<string, Any>)) add(OD, typeof v === 'string' ? v : v?.path, 'Step 1: ' + (FORM_TITLES[k] || k) + ' (signed)', (f?.signatures || {})[k]?.at, 'signed')
  }
  for (const r of [p.cand, p.rec]) { if (!r) continue; for (const [k, label] of PROOFS) add(LD, r[k], label, r[k.replace(/_(proof|pdf)$/, '_date')] || null, 'proof') }
  if (p.offerId) {
    const subj = [p.offerId, ...(p.rec ? ['caregiver:' + p.rec.id] : [])]
    for (const s of subj) {
      const { data: ex } = await db.storage.from(OD).list('exports/' + s, { limit: 50 })
      for (const e of ex ?? []) add(OD, 'exports/' + s + '/' + e.name, 'Personnel file export', e.created_at || null, 'export')
    }
  }
  return out.sort((a, z) => String(a.at || '').localeCompare(String(z.at || '')))
}

/** every send, receipt and completion, oldest first */
export async function timeline(db: Any, T: Any, p: Any) {
  const t: Array<{ at: string; type: string; what: string; by?: string }> = []
  const push = (at: unknown, type: string, what: string, by?: unknown) => { if (at) t.push({ at: String(at), type, what, by: by ? S(by, 80) : undefined }) }
  if (p.app) { push(p.app.created_at, 'received', 'Applied' + (p.app.position ? ' (' + S(p.app.position, 60) + ')' : '')); for (const [k, v] of Object.entries(p.app)) if (/_at$/.test(k) && k !== 'created_at' && k !== 'updated_at' && v) push(v, /sent|msg|invite/.test(k) ? 'sent' : 'done', 'Application: ' + words(k)) }
  if (p.offerId) {
    const ev = await T.get(`offer_events?offer_id=eq.${p.offerId}&select=at,kind,by_who,channel,result,detail&order=at.asc`)
    for (const e of ev) {
      const [type, label] = OFFER_EVENTS[e.kind] || ['done', words(String(e.kind))]
      const d = e.detail || {}, prac = d.practice ? ' (practice: recorded, not sent)' : ''
      const form = d.form ? ': ' + (FORM_TITLES[d.form] || d.form) : ''
      push(e.at, e.result && /fail|refus/.test(String(e.result)) ? 'refused' : type, label + form + (type === 'sent' ? prac : '') + (e.result && e.result !== 'ok' ? ' · ' + e.result : '') + (d.note ? ' · "' + S(d.note, 120) + '"' : ''), e.by_who === 'caregiver' ? (p.name || 'them') : e.by_who)
    }
  }
  for (const [r, where] of [[p.cand, 'Background & References'], [p.rec, 'their caregiver record']] as Array<[Any, string]>) {
    if (!r) continue
    for (const [k, [type, label]] of Object.entries(STAMPS)) if (r[k]) push(r[k], type, label, r[k.replace(/_(at|date)$/, '_by')] || null)
    const m = r.step2_msg; if (m && (m.at || r.step2_sent_at)) push(m.at || r.step2_sent_at, 'sent', 'Step 2 message' + (m.state === 'practice' ? ' (practice: recorded, not sent)' : m.state ? ' (' + m.state + ')' : ''))
    for (const [d, v] of Object.entries(r.step2_reminders || {})) push((v as Any)?.at, 'sent', 'Step 2 reminder ' + d + ((v as Any)?.practice ? ' (practice: recorded, not sent)' : ''))
    void where
  }
  if (p.journey) {
    const { data: je } = await db.from('client_journey_event').select('at, kind, step_key, actor_name, reason, detail').eq('journey_id', p.journey.journey_id).order('at', { ascending: true }).limit(1000)
    for (const e of je ?? []) push(e.at, /sent|invite|text/.test(e.kind) ? 'sent' : /practice/.test(e.kind) ? 'sent' : 'done', 'Readiness: ' + words(String(e.kind)) + (e.step_key ? ' · ' + e.step_key.replace(/^cg\./, '') : '') + (e.reason ? ' · "' + S(e.reason, 120) + '"' : ''), e.actor_name)
  }
  const candId = p.cand?.id ?? p.rec?.candidate_id
  if (candId != null) {
    const { data: wc } = await db.from('welcome_calls').select('*').eq('candidate_id', String(candId)).order('invited_at', { ascending: true })
    for (const w of wc ?? []) { push(w.invited_at, 'sent', 'Orientation Video Call invitation', w.invited_by); push(w.booked_at, 'received', 'They booked the Orientation Video Call' + (w.starts_at ? ' for ' + w.starts_at : '')); push(w.confirmed_at, 'sent', 'Orientation Video Call confirmation'); push(w.reminded_day_at, 'sent', 'Orientation Video Call reminder (day before)'); push(w.reminded_hour_at, 'sent', 'Orientation Video Call reminder (hour before)'); push(w.done_at, 'done', 'Orientation Video Call done', w.done_by) }
    const { data: rr } = await db.from('reference_requests').select('*').eq('candidate_id', String(candId))
    for (const r of rr ?? []) for (const [k, v] of Object.entries(r)) if (/_at$/.test(k) && v && k !== 'updated_at') push(v, /responded|answer|received/.test(k) ? 'received' : /sent|emailed|texted/.test(k) ? 'sent' : 'done', 'Reference ' + (r.slot ?? '') + (r.ref_name ? ' (' + S(r.ref_name, 60) + ')' : '') + ': ' + words(k))
  }
  const addrs = [p.phone ? '+1' + d10(p.phone) : '', String(p.email || '').toLowerCase()].filter((a) => a && a.length > 2)
  if (addrs.length) { const { data: rf } = await db.from('contact_send_refusal').select('at, sender, channel, reasons').in('address', addrs).order('at', { ascending: true }).limit(200); for (const r of rf ?? []) push(r.at, 'refused', `Not sent (${r.channel}, ${r.sender}): ${(r.reasons || []).join('; ')}`) }
  const subj = [p.offerId, p.rec ? 'caregiver:' + p.rec.id : ''].filter(Boolean)
  if (subj.length) { const { data: op } = await db.from('document_access_log').select('at, doc, by_name, reason').in('offer_id', subj).order('at', { ascending: true }).limit(300); for (const o of op ?? []) push(o.at, 'opened', 'Opened: ' + o.doc + (o.reason ? ' · ' + S(o.reason, 80) : ''), o.by_name) }
  const ax = p.rec?.axiscare_id
  if (ax) { const { data: al } = await db.from('axiscare_change_log').select('at, kind, outcome, summary').eq('axiscare_caregiver_id', String(ax)).order('at', { ascending: true }); for (const a of al ?? []) push(a.at, a.outcome === 'practice' ? 'sent' : a.outcome === 'refused' ? 'refused' : 'done', 'AxisCare: ' + a.summary + (a.outcome === 'practice' ? ' (practice: recorded, nothing written)' : ' · ' + a.outcome)) }
  for (const [src, r] of [['app_data:candidates', p.cand], ['app_data:caregivers', p.rec]] as Array<[string, Any]>) {
    if (!r) continue
    const { data: eh } = await db.from('evidence_history').select('*').eq('source', src).eq('record_id', String(r.id)).neq('change', 'trigger_error').order('at', { ascending: true }).limit(300)
    for (const h of eh ?? []) push(h.at, 'changed', 'Evidence: ' + evidenceLine(h), h.actor)
  }
  const cards = await list(db, 'ops_items')
  for (const c of cards.filter((x) => x && ((p.offerId && String(x.offer_id || '') === p.offerId) || (candId != null && String(x.candidate_id ?? '') === String(candId))))) { push(c.created_at || c.first_at, 'card', 'Needs Attention: ' + S(c.title, 140)); if (c.closed_at) push(c.closed_at, 'done', 'Card closed: ' + S(c.title, 100) + (c.close_note || c.close_reason ? ' · ' + S(c.close_note || c.close_reason, 100) : ''), c.closed_by) }
  return t.sort((a, z) => a.at.localeCompare(z.at))
}

/** where they are now, in one line */
export function whereNow(p: Any): string {
  const o = p.offer || {}
  if (o.offer_withdrawn_at) return 'Offer withdrawn'
  if (p.rec?.approved_to_work_at) return 'Approved to Work'
  if (p.rec) return 'On the caregiver roster: training and approval'
  if (p.cand) return 'In Background & References: checks and references'
  if (o.step1_done_at) return 'Step 1 complete'
  if (o.offer_signed_at && o.pd_signed_at) return 'Signed their offer: Step 1 next'
  if (o.offer_sent_at) return 'Offer sent: waiting for their signature'
  if (p.app) return 'Applicant'
  return 'Not found'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false, autoRefreshToken: false } })
  const b: Any = await req.json().catch(() => ({}))
  try {
    const who = await requireStaff(db, req, OFFICE_ROLES)
    if (!who.ok) return json({ error: who.error }, who.status)
    const T = trn(), action = S(b.action, 20) || 'get'
    if (action === 'step1_progress') {
      const ids = (Array.isArray(b.offer_ids) ? b.offer_ids : []).map((x: unknown) => S(x, 64)).filter((x: string) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 100)
      if (!ids.length) return json({ ok: true, progress: {} })
      const { data: rows } = await db.from('step1_forms').select('offer_id, started_at, current_screen, signatures, completed_at').in('offer_id', ids)
      const ev = await T.get(`offer_events?offer_id=in.(${ids.join(',')})&kind=in.(step1_sent,step1_resent)&select=offer_id,at,kind,detail&order=at.asc`)
      const out: Record<string, Any> = {}
      for (const id of ids) {
        const f = (rows ?? []).find((r: Any) => r.offer_id === id), sent = ev.filter((e: Any) => e.offer_id === id && (e.kind === 'step1_sent' || e.kind === 'step1_resent'))
        out[id] = { sent_at: sent[0]?.at ?? null, practice: !!sent[0]?.detail?.practice, sends: sent.length, started_at: f?.started_at ?? null, screen: f?.current_screen ?? null,
          signed: Object.keys(f?.signatures || {}).length, forms: 7, completed_at: f?.completed_at ?? null }
      }
      return json({ ok: true, progress: out })
    }
    const p = await resolve(db, T, b)
    if (!p.offer && !p.cand && !p.rec && !p.app) return json({ error: 'That person was not found.' }, 404)
    if (action === 'doc') {
      const ref = S(b.ref, 600), docs = await documents(db, p), d = docs.find((x) => x.ref === ref)
      if (!d) return json({ error: 'That document is not on this profile.' }, 404)
      if (d.ref.startsWith('url:')) return json({ ok: true, url: d.ref.slice(4) })
      const bucket = d.ref.startsWith('od:') ? OD : LD, path = d.ref.slice(3)
      const { data, error } = await db.storage.from(bucket).createSignedUrl(path, 300)
      if (error || !data?.signedUrl) return json({ error: 'Could not open the document.' }, 500)
      await logOpen(db, { subject: p.offerId || (p.rec ? 'caregiver:' + p.rec.id : 'candidate:' + (p.cand?.id ?? '')), doc: 'profile:' + d.label.slice(0, 40), path, who: { person_id: who.person_id, email: who.email, name: who.name }, reason: 'opened from the profile', ip: ipOf(req) })
      return json({ ok: true, url: data.signedUrl, expires_in: 300 })
    }
    const [tl, docs] = await Promise.all([timeline(db, T, p), documents(db, p)])
    /* 2026-10-11 (Samantha: everything collected must feed the matching profile, not a document to search): the skills
       picture from their Step 1 answers and their references' task-by-task answers. Read only; nothing is decided here. */
    let experience: Any = null, status: Any = null
    try {
      const candId = p.cand?.id ?? p.rec?.candidate_id
      const [{ data: f }, { data: rr }, { data: bk }] = await Promise.all([
        p.offerId ? db.from('step1_forms').select('answers, practice, signatures, started_at, completed_at').eq('offer_id', p.offerId).maybeSingle() : Promise.resolve({ data: null }),
        candId != null ? db.from('reference_requests').select('*').eq('candidate_id', String(candId)).order('slot') : Promise.resolve({ data: [] }),
        p.app?.id ? db.from('interview_bookings').select('id, starts_at, status, created_at').eq('applicant_id', p.app.id) : Promise.resolve({ data: [] })])
      if (f?.answers) experience = { ...experienceSummary(f.answers, rr ?? []), practice: !!f.practice }
      /* 2026-10-11 (Samantha: done, current, submitted, signed or outstanding, missing, next and who): read only */
      let owner: Any = null
      try { const { data: d } = await db.from('domains').select('owner_person').eq('entity', 'cc_ihs').eq('code', 'recruiting_orientation').maybeSingle()
        if (d?.owner_person) { const { data: pp } = await db.from('persons').select('full_name').eq('person_id', d.owner_person).maybeSingle(); owner = { name: S(pp?.full_name, 80) } } } catch { owner = null }
      status = applicantStatus({ app: p.app, bookings: bk ?? [], offer: p.offer, step1: f, cand: p.cand, rec: p.rec, journey: p.journey, refs: rr ?? [], experience, owner })
    } catch { experience = experience || null }
    const o = p.offer || {}
    return json({ ok: true, name: p.name || '(no name)', phone: p.phone, email: p.email, where: whereNow(p),
      ids: { offer_id: p.offerId || null, candidate_id: p.cand?.id ?? p.rec?.candidate_id ?? null, caregiver_id: p.rec?.id ?? null, applicant_id: p.app?.id ?? null, journey_id: p.journey?.journey_id ?? null, axiscare_id: p.rec?.axiscare_id ?? null },
      path: o.onboarding_path || p.cand?.onboarding_path || null, position: o.position || p.app?.position || null, pay_rate: o.pay_rate ?? null,
      timeline: tl, documents: docs, experience, status })
  } catch (e) {
    return json({ error: 'Something went wrong: ' + ((e as Error).message || 'error') + '. Nothing was changed.' }, 500)
  }
})
