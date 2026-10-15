// =============================================================================
// rn-review · RN REVIEW (LPN nurse visit plan, steps 5 to 7; Samantha approved "approve nursing plan" 2026-10-14; build spec
// launch/review/lpn/build-spec.md). Natasha Early (RN, a W-2 employee) reviews her LPNs' work on her own page,
// cc.mo-care.com/rn.html. EVERYTHING that page shows comes from this function; the page never reads app_data itself. Her LPNs
// mark things for her from the Nurse Portal through this function too. She signs ONLY what the rules require: every GHE an
// LPN completes (HCBS 8.00 Appendix 4). She never needs AxisCare: the client's AxisCare nurse visits are read here, by the
// server, and shown on her page.
// Switch: ops_settings.nurse_review_live (Owners Hub Admin page), OFF by default. Off = practice: her queue and every count
// are worked out and shown, but signing, sending back, reviewing a flag and "Mark for Natasha" are refused for real work
// (practice forms, practice clients and the Admin page's test people may rehearse); no card is raised.
//
// API REFERENCE (POST JSON; every answer is JSON with ok: true, or { ok: false, error } and an HTTP status)
// ── Who may call (their own Hub sign-in: Authorization: Bearer <session>)
//   an RN on app_data nurse_staff whose email is the signed-in email (cred RN, our employee, license number and a current
//   expiry, as nurse-rules.js reads it): her own work only; an owner (staff_roles owner_admin): everything, read only;
//   for flag_create and mine: any nurse on nurse_staff by sign-in email (an LPN), or office staff for a nurse (as_nurse).
//   An account whose hub_access list has neither care_coordinator nor rn_review is refused.
// ── RN (and owners, read only)
//   queue       {}  -> { me, live, counts: { ghe, flags, overdue, waiting_over_2 }, ghe: [...], flags: [...], overdue: [...],
//                 recent: [signatures], cards: [her open cards] }
//   open        { ghe_id } -> the form laid out as the state form, its signatures, what may be done | { client_id } -> the
//                 client's nursing history (Hub nurse visits, GHE forms, flags, AxisCare nurse visits) | { signature_id } ->
//                 { url } (5 minutes) for the signed PDF. EVERY open is a document_access_log row (logOpen); refused when
//                 the log cannot be written.
//   sign        { ghe_id, typed_name, consent: true }  -> { signature, form_updated, pdf }  write-once
//   send_back   { ghe_id, note }  -> { form }  status back to draft with her note; the LPN sees it in the Nurse Portal
//   flag_review { flag_id, note }  -> { flag }
// ── LPN (Nurse Portal)
//   flag_create { client_id, service_key, seen, visit_id?, visit_date?, as_nurse? }  -> { flag }
//   mine        { as_nurse? }  -> { flags: their own, newest first }
// ── Schedule (x-cron-secret = HUB_JOB_SECRET; or the owner's server key)
//   pass        {}  -> counts. Cards (only with the switch on): one for the RN on each item waiting on her more than 2 working
//                 days; one for the Payer Programs owner on each signed GHE not uploaded by its upload date (ghe-reminders
//                 only emails a digest, it raises no such card). Closes those cards when the item moves on. Repairs a
//                 signature whose form was not updated.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES, PROJECT_REF, ENTITY } from '../_shared/staff-auth.ts'
import { jobCaller } from '../_shared/job-auth.ts'
import { logOpen, ipOf } from '../_shared/doc-log.ts'
import { practicePerson } from '../_shared/optout.ts'
import { testPerson } from '../_shared/test-people.ts'
import { businessDaysWaiting, centralYmd } from '../_shared/business-days.ts'
import { participantBlocker, readable, uploadDue, servicesOf, visitServices, OTHER_SERVICE, norm, credOf, rnReady, supervisorOf, nurseByName, nurseByEmail, needsRn, mineToReview,
  flagRnName, practiceNurse, practiceClient, sigImage, ESIGN_WORDS, SIGN_VERSION, typedOk, formFingerprint, gheReviewPdf } from '../_shared/rn-review.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
// deno-lint-ignore no-explicit-any
type Any = any
const S = (v: unknown, n = 160) => String(v ?? '').trim().slice(0, n)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const SENDER = 'rn-review', BUCKET = 'nurse-docs', LINK_SECONDS = 300, WAIT_DAYS = 2
const STATUS_LABEL: Record<string, string> = { draft: 'Draft', rn_review: 'Awaiting RN review', ready: 'Ready for Fusion', uploaded: 'Uploaded to Fusion' }
const OFF_WORDS = 'The RN review page is not turned on yet (Owners Hub Admin page, RN review). Until then only practice forms can be signed or sent back.'
const OFF_FLAG = 'Mark for Natasha is not turned on yet. Please call or text Natasha directly about this.'
const longDateTime = (at: string) => new Date(at).toLocaleString('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' Central'
const agentOf = (req: Request) => S(req.headers.get('user-agent'), 200)
const ipShort = (req: Request) => S(req.headers.get('cf-connecting-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0], 64)

async function settings(db: Any) { const { data } = await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle(); return (data?.data && typeof data.data === 'object' && !Array.isArray(data.data)) ? data.data : {} }
async function list(db: Any, key: string): Promise<Any[]> { const { data } = await db.from('app_data').select('data').eq('key', key).maybeSingle(); return Array.isArray(data?.data) ? data.data.filter((x: Any) => x && typeof x === 'object') : [] }
async function event(db: Any, kind: string, who: { name?: string; email?: string; person?: string }, x: { ghe_id?: string; flag_id?: string; client_ref?: string; detail?: Any }) {
  try { const { error } = await db.from('rn_review_event').insert({ kind, ghe_id: x.ghe_id ?? null, flag_id: x.flag_id ?? null, client_ref: x.client_ref ?? null, by_name: who.name || null, by_email: who.email || null, by_person: who.person || null, detail: x.detail ?? {} }); return !error } catch { return false }
}

/* ── cards: one Needs Attention card per problem id; a card a person closed stays closed. Never throws. ── */
export async function raiseCard(db: Any, c: { id: string; kind: string; title: string; detail: string; who: string; owner: string; urgency: 'urgent' | 'today' | 'normal'; client_id?: string }): Promise<'raised' | 'open' | 'closed' | 'failed'> {
  try {
    const prev = (await list(db, 'ops_items')).find((x) => x.id === c.id)
    if (prev && (prev.status === 'done' || prev.status === 'resolved')) return 'closed'
    if (prev) return 'open'
    const now = new Date().toISOString()
    const { error } = await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { id: c.id, kind: c.kind, domain: 'payer_programs', status: 'open', urgency: c.urgency, title: c.title, detail: c.detail, who: c.who, about: c.who,
      owner: c.owner || '', client_id: c.client_id || null, link: '#nursevisits', created_at: now, first_at: now, last_at: now, due: new Date(Date.now() + 24 * 3_600_000).toISOString(), closed_at: null, closed_by: null, created_by: SENDER, opened_by: SENDER } })
    return error ? 'failed' : 'raised'
  } catch { return 'failed' }
}
export async function closeCard(db: Any, id: string, note: string): Promise<boolean> {
  try {
    const prev = (await list(db, 'ops_items')).find((x) => x.id === id)
    if (!prev || prev.status === 'done' || prev.status === 'resolved') return false
    const now = new Date().toISOString()
    const { error } = await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { ...prev, status: 'done', done_at: now, closed_at: now, closed_by: SENDER, close_reason: note, done_by: 'The Hub (' + note + ')', last_activity_at: now } })
    return !error
  } catch { return false }
}
/** the Medicaid coordinator: the owner of Payer Programs (the same reading as ghe-reminders), else Samantha */
async function payerOwner(db: Any): Promise<string> {
  try {
    const { data: d } = await db.from('domains').select('owner_person').eq('entity', ENTITY).eq('code', 'payer_programs').maybeSingle()
    if (d?.owner_person) { const { data: p } = await db.from('persons').select('primary_email').eq('person_id', d.owner_person).maybeSingle(); if (p?.primary_email) return S(p.primary_email).toLowerCase() }
  } catch { /* fall through */ }
  return 'samantha@mo-care.com'
}

/* ── who is calling ── */
type Caller = { email: string; user_id: string; person: string; rn: Any | null; nurse: Any | null; owner: boolean; office: Any | null; name: string }
async function whoCalls(db: Any, req: Request, staff: Any[], today: string): Promise<Caller | { error: string; status: number }> {
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!jwt) return { error: 'Sign in first.', status: 401 }
  let user: Any
  try { const { data, error } = await db.auth.getUser(jwt); if (error || !data?.user) return { error: 'Your session has expired. Sign in again.', status: 401 }; user = data.user } catch { return { error: 'Your session could not be checked. Sign in again.', status: 401 } }
  const hubs = user.app_metadata?.hub_access
  /* 760b: no hub list = no hub */
  if (!Array.isArray(hubs) || (!hubs.includes('care_coordinator') && !hubs.includes('rn_review'))) return { error: 'Your account does not have access to the RN review page.', status: 403 }
  const email = S(user.email, 160).toLowerCase()
  /* a sign-in linked to a staff record that is no longer active is refused, even if the nurse list still has the email */
  let person = ''
  try {
    const { data: ids } = await db.from('auth_identities').select('person_id').eq('auth_user_id', user.id).eq('project_ref', PROJECT_REF)
    if (ids?.length) {
      person = String(ids[0].person_id)
      const { data: p } = await db.from('persons').select('active').eq('person_id', person).maybeSingle()
      if (p && p.active !== true) return { error: 'Your staff record is not active.', status: 403 }
    }
  } catch { return { error: 'Could not check your permissions.', status: 500 } }
  const mine = nurseByEmail(staff, email)
  const rn = mine.length === 1 && rnReady(mine[0], today) ? mine[0] : null
  const nurse = mine.length === 1 && credOf(mine[0]) ? mine[0] : null
  const off = await requireStaff(db, req, OFFICE_ROLES)
  const owner = off.ok && off.roles.includes('owner_admin')
  return { email, user_id: String(user.id), person: person || (off.ok ? off.person_id : ''), rn, nurse, owner, office: off.ok ? off : null, name: S(rn?.name || nurse?.name || (off.ok ? off.name : ''), 120) || email }
}

/* ── when a form went to RN review: the value history (slice 9 evidence) knows; else its last save ── */
async function sinceMap(db: Any, forms: Any[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const ids = forms.map((g) => String(g.id))
  if (ids.length) {
    try {
      const { data } = await db.from('evidence_history').select('record_id, at, field, new_value').eq('source', 'app_data:ghe_forms').eq('field', 'status').in('record_id', ids).order('at', { ascending: true })
      for (const r of data ?? []) if (r && (r.new_value === 'rn_review' || r.new_value === '"rn_review"')) out[String(r.record_id)] = String(r.at)
    } catch { /* the fallback below */ }
  }
  for (const g of forms) if (!out[g.id]) out[g.id] = S(g.updated_at || g.created_at || (g.visit_date ? g.visit_date + 'T12:00:00Z' : ''), 40)
  return out
}

type Ctx = { st: Any; today: string; now: Date; staff: Any[]; clients: Any[]; forms: Any[] }
const clientOf = (cx: Ctx, g: Any) => cx.clients.find((c) => g?.client_id ? String(c.id) === String(g.client_id) : norm(c.name) === norm(g?.client)) || null
const formPractice = (cx: Ctx, g: Any) => practiceClient(clientOf(cx, g) || { name: g?.client }) || practiceNurse(nurseByName(cx.staff, g?.nurse), practicePerson)
const flagPublic = (f: Any) => ({ id: f.id, client_id: f.client_id, client_axiscare_id: f.client_axiscare_id, client_name: f.client_name, visit_id: f.visit_id, visit_date: f.visit_date, service_key: f.service_key, service_name: f.service_name,
  seen: f.seen, by_name: f.by_name, entered_by: f.entered_by, at: f.at, rn_name: f.rn_name, status: f.status, rn_note: f.rn_note, reviewed_at: f.reviewed_at, reviewed_by: f.reviewed_by, practice: !!f.practice })
const sigPublic = (s: Any) => s ? ({ id: s.id, ghe_id: s.ghe_id, client_name: s.client_name, visit_date: s.visit_date, lpn_name: s.lpn_name, rn_name: s.rn_name, typed_name: s.typed_name, signed_at: s.signed_at, signed_at_label: longDateTime(s.signed_at), pdf: !!s.pdf_path, practice: !!s.practice, consent_words: s.consent_words, fingerprint: s.form_fingerprint }) : null
function flagMine(f: Any, rn: Any, cx: Ctx): boolean {
  if (!rn) return false
  if (S(f.rn_name)) return norm(f.rn_name) === norm(rn.name)
  const sup = supervisorOf(cx.staff, cx.today); return !!sup && norm(sup.name) === norm(rn.name)
}
/** may this caller act on this item now: the switch, or a practice item, or a person on the Admin page's test list */
function mayWrite(c: Caller, cx: Ctx, practice: boolean): boolean {
  return cx.st.nurse_review_live === true || practice || testPerson(cx.st, { email: c.email, phone: c.rn?.phone || c.nurse?.phone || '' })
}
function gheSummary(g: Any, cx: Ctx, since: string) {
  const due = uploadDue(g.visit_date), wait = since ? businessDaysWaiting(since, cx.now, cx.st.company_holidays) : 0
  return { id: g.id, client: S(g.client, 120), client_id: S(g.client_id, 60), visit_date: S(g.visit_date, 10), nurse: S(g.nurse, 120), total: g.total ?? null, status: g.status || 'draft', status_label: STATUS_LABEL[g.status || 'draft'] || 'Draft',
    rn_reviewer: S(g.rn_reviewer, 120), since, waiting_days: wait, waiting_over: g.status === 'rn_review' && wait > WAIT_DAYS, upload_due: due, upload_overdue: !!due && cx.today > due && g.status !== 'uploaded',
    sent_back_before: Array.isArray(g.rn_sent_back_log) ? g.rn_sent_back_log.length : 0, practice: formPractice(cx, g) }
}

/* ── the queue ── */
async function queue(db: Any, c: Caller, cx: Ctx) {
  const all = !c.rn && c.owner
  const ghe = cx.forms.filter((g) => !g.superseded_by && g.status === 'rn_review' && needsRn(g, cx.staff) && (all || mineToReview(g, c.rn, cx.staff, cx.today)))
  const since = await sinceMap(db, ghe)
  const gs = ghe.map((g) => gheSummary(g, cx, since[g.id])).sort((a, b) => String(a.since).localeCompare(String(b.since)))
  const { data: fl } = await db.from('nurse_flag').select('*').eq('status', 'open').order('at', { ascending: true }).limit(500)
  const flags = (fl ?? []).filter((f: Any) => all || flagMine(f, c.rn, cx)).map((f: Any) => { const w = businessDaysWaiting(f.at, cx.now, cx.st.company_holidays); return { ...flagPublic(f), waiting_days: w, waiting_over: w > WAIT_DAYS } })
  /* signed and waiting on the office's Fusion upload, past the upload date: hers (she signed them), or all for an owner */
  const late = cx.forms.filter((g) => !g.superseded_by && g.status === 'ready' && (all || (c.rn && norm(g.rn_reviewer) === norm(c.rn.name)))).map((g) => gheSummary(g, cx, '')).filter((x) => x.upload_overdue)
  const overdue = [...gs.filter((x) => x.waiting_over || x.upload_overdue).map((x) => ({ kind: 'ghe', ...x, why: [x.waiting_over ? `waiting on you ${x.waiting_days} working days` : '', x.upload_overdue ? `the upload to Fusion was due ${x.upload_due}` : ''].filter(Boolean).join('; ') })),
    ...flags.filter((f: Any) => f.waiting_over).map((f: Any) => ({ kind: 'flag', ...f, why: `marked ${f.waiting_days} working days ago` })),
    ...late.map((x) => ({ kind: 'upload', ...x, why: `signed, and the upload to Fusion was due ${x.upload_due} (the office uploads it)` }))]
  let recent: Any[] = []
  { let q = db.from('rn_ghe_signature').select('*'); if (!all) q = q.eq('rn_email', c.email); const { data } = await q.order('signed_at', { ascending: false }).limit(20); recent = (data ?? []).map(sigPublic) }
  const cards = (await list(db, 'ops_items')).filter((x) => String(x.created_by) === SENDER && x.status !== 'done' && x.status !== 'resolved' && (all || norm(x.owner) === c.email)).map((x) => ({ id: x.id, kind: x.kind, title: x.title, detail: x.detail, created_at: x.created_at }))
  return { ok: true, me: { name: c.rn?.name || c.name, email: c.email, rn: !!c.rn, owner: c.owner, supervising: !!(c.rn && supervisorOf(cx.staff, cx.today) && norm(supervisorOf(cx.staff, cx.today).name) === norm(c.rn.name)) },
    live: cx.st.nurse_review_live === true, today: cx.today, counts: { ghe: gs.length, flags: flags.length, overdue: overdue.length, waiting_over_2: gs.filter((x) => x.waiting_over).length + flags.filter((f: Any) => f.waiting_over).length },
    ghe: gs, flags, overdue, recent, cards, services: servicesOf(cx.st).map((s) => ({ key: s.key, name: s.name })) }
}

/* ── AxisCare, read only: one client's visits between two dates (paged, one retry on 429) ── */
export function axVisits(fetchImpl: typeof fetch = fetch) {
  let token = ''; for (const n of ['AXISCARE_API_KEY', 'AXISCARE_TOKEN']) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  return async (ax: string, from: string, to: string): Promise<Any[] | null> => {
    if (!token || !/^\d+$/.test(site) || !/^\d{1,12}$/.test(ax)) return null
    const out: Any[] = []
    let path: string | null = `/api/visits?clientIds=${encodeURIComponent(ax)}&startDate=${from}&endDate=${to}`
    for (let page = 0; path && page < 6; page++) {
      let r: Response | null = null
      for (let i = 0; i < 2; i++) {
        try { r = await fetchImpl(`https://${site}.axiscare.com${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-AxisCare-Api-Version': '2023-10-01' } }) } catch { return null }
        if (r.status === 429 && i === 0) { await new Promise((ok) => setTimeout(ok, 1500)); continue }
        break
      }
      if (!r || r.status !== 200) return null
      const j: Any = await r.json().catch(() => ({}))
      const vs = j?.results?.visits ?? j?.visits ?? []
      out.push(...(Array.isArray(vs) ? vs : Object.values(vs)))
      const nx = j?.results?.nextPage ?? j?.nextPage ?? null
      path = nx ? String(nx).replace(/^https?:\/\/[^/]+/, '') : null
    }
    return out
  }
}
const addDaysYmd = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
async function axNursing(ax: string, cx: Ctx) {
  if (!/^\d{1,12}$/.test(ax)) return { ok: false, why: 'This client is not linked to AxisCare yet.', visits: [] }
  const get = axVisits(), services = servicesOf(cx.st), names = Object.fromEntries([...services, OTHER_SERVICE].map((s) => [s.key, s.name]))
  const seen = new Map<string, Any>()
  /* the last six months and the next month, a month at a time */
  for (let i = 0; i < 7; i++) {
    const to = addDaysYmd(cx.today, 30 - i * 31), from = addDaysYmd(to, -30)
    const vs = await get(ax, from, to)
    if (vs === null) return { ok: false, why: 'AxisCare could not be read just now. Try again in a minute.', visits: [...seen.values()] }
    for (const v of vs) {
      if (!v || v.removed) continue
      const keys = visitServices(v, services); if (!keys.length) continue
      const id = String(v.id || ''); if (seen.has(id)) continue
      const cg = v.caregiver || {}
      seen.set(id, { id, date: S(v.scheduledStartDate || v.startDate, 25), service: S(v.service?.description || v.service?.name || v.service?.code || v.serviceCode, 80), services: keys.map((k) => names[k] || k),
        nurse: [cg.firstName, cg.lastName].filter(Boolean).join(' '), clock_in: S(v.clockIn?.time, 25), clock_out: S(v.clockOut?.time, 25), verified: v.verified === true || v.isVerified === true, note: S(v.careNote || v.notes, 1500) })
    }
  }
  return { ok: true, visits: [...seen.values()].sort((a, b) => String(b.date).localeCompare(String(a.date))) }
}

/* ── one GHE form write, read fresh right before (upsert_app_data_item, the same door the Hub's GHE form uses) ── */
async function putGhe(db: Any, id: string, change: (g: Any) => { ok: true; item: Any } | { ok: false; why: string; status?: number }) {
  const forms = await list(db, 'ghe_forms'), g = forms.find((x) => String(x.id) === id)
  if (!g) return { ok: false, why: 'That GHE form was not found.', status: 404 }
  const r = change(g); if (!r.ok) return r
  const { error } = await db.rpc('upsert_app_data_item', { target_key: 'ghe_forms', item: r.item })
  if (error) return { ok: false, why: 'The form could not be saved: ' + S(error.message, 160), status: 500 }
  return { ok: true, item: r.item }
}
/** the patch Natasha's signature makes: exactly what ghe-forms-rules.js transition(form, 'ready') records for an LPN form, plus the
 *  Supervisory Nurse signature and its date (the database's GHE lock lets the RN sign once, after the participant) */
export function signedPatch(g: Any, rn: Any, email: string, at: string, sig: { id: string; typed: string; pdf: boolean; png?: string | null }) {
  const date = centralYmd(at)
  return { ...g, status: 'ready', rn_reviewer: rn.name, rn_reviewed_at: at, rn_reviewed_by: email, ready_at: at, ready_by: email,
    sig_sup: sig.png || sigImage(sig.typed, 'Signed electronically ' + date + ', RN'), f: { ...(g.f || {}), ghe_sig_sup_date: date },
    rn_signature: { id: sig.id, typed_name: sig.typed, at, by: email, pdf: sig.pdf }, updated_at: at, updated_by: email }
}
/** a small PNG data address (her typed name drawn by the page): the PNG signature bytes, under 150 KB */
export function pngOk(v: unknown): boolean {
  const t = String(v || ''); if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(t) || t.length > 200_000) return false
  try { const b = atob(t.slice(22, 22 + 16)); return b.charCodeAt(0) === 0x89 && b.slice(1, 4) === 'PNG' } catch { return false }
}
function signBlockers(g: Any, c: Caller, cx: Ctx): string[] {
  const out: string[] = []
  if (g.superseded_by) out.push('This form was replaced by an amended copy.')
  else if (g.status !== 'rn_review') out.push('This form is not waiting for RN review (it is ' + (STATUS_LABEL[g.status || 'draft'] || g.status) + ').')
  if (!needsRn(g, cx.staff)) out.push('This form is by an RN, so it does not need a second RN.')
  if (c.rn && norm(g.nurse) === norm(c.rn.name)) out.push('The reviewing RN must be someone other than the nurse who wrote it.')
  if (!c.rn || !mineToReview(g, c.rn, cx.staff, cx.today)) out.push(S(g.rn_reviewer) ? `This form is for ${S(g.rn_reviewer)} to review.` : 'Only the supervising RN reviews a form with no reviewing RN picked.')
  if (!S(g.sig_nurse, 40)) out.push('The nurse has not signed the form.')
  if (S(g.sig_sup, 40)) out.push('This form already has a Supervisory Nurse signature.')
  const pb = participantBlocker(g); if (pb) out.push(pb)   /* decision 1, off until she approves (PARTICIPANT_SIGNS_BEFORE_FUSION) */
  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false, autoRefreshToken: false } })
  const b: Any = await req.json().catch(() => ({}))
  const action = S(b.action, 20)
  try {
    const st = await settings(db), now = new Date(), today = centralYmd(now)
    const [staff, clients, forms] = await Promise.all([list(db, 'nurse_staff'), list(db, 'nurse_clients'), list(db, 'ghe_forms')])
    const cx: Ctx = { st, today, now, staff, clients, forms }
    /* ═══ the schedule ═══ */
    if (action === 'pass') {
      if (!(await jobCaller(req))) return json({ ok: false, error: 'the pass is for the schedule or an owner' }, 401)
      return json(await pass(db, cx))
    }
    const c = await whoCalls(db, req, staff, today)
    if ('error' in c) return json({ ok: false, error: c.error }, c.status)
    const who = { name: c.name, email: c.email, person: c.person }

    /* ═══ the LPN (Nurse Portal): mark for Natasha, and their own marks ═══ */
    if (action === 'flag_create' || action === 'mine') {
      let nurse = c.nurse, entered = ''
      if (S(b.as_nurse, 120) && c.office) { nurse = nurseByName(staff, b.as_nurse); entered = c.office.name || c.email }
      if (!nurse) return json({ ok: false, error: 'Only a nurse on the nurse list (signed in with the email on that list) can do this.' }, 403)
      if (action === 'mine') {
        const { data } = await db.from('nurse_flag').select('*').eq('by_name', nurse.name).order('at', { ascending: false }).limit(100)
        return json({ ok: true, live: st.nurse_review_live === true, flags: (data ?? []).map(flagPublic) })
      }
      const cl = clients.find((x) => String(x.id) === S(b.client_id, 60))
      if (!cl) return json({ ok: false, error: 'Which client?' }, 400)
      const mineClient = norm(cl.assigned_nurse) === norm(nurse.name) || forms.some((g) => norm(g.nurse) === norm(nurse.name) && (String(g.client_id) === String(cl.id) || norm(g.client) === norm(cl.name)))
      if (!mineClient && !entered) return json({ ok: false, error: `${cl.name} is not on your caseload.` }, 403)
      const services = [...servicesOf(st), OTHER_SERVICE], sv = services.find((s) => s.key === S(b.service_key, 40))
      if (!sv) return json({ ok: false, error: 'Which nurse service was this about?' }, 400)
      const seen = S(b.seen, 2000)
      if (seen.length < 5) return json({ ok: false, error: 'Say what you saw (a few words at least).' }, 400)
      const vd = /^\d{4}-\d{2}-\d{2}$/.test(S(b.visit_date, 10)) ? S(b.visit_date, 10) : today
      if (vd > today) return json({ ok: false, error: 'The visit date cannot be in the future.' }, 400)
      const practice = practiceClient(cl) || practiceNurse(nurse, practicePerson)
      if (!mayWrite({ ...c, nurse }, cx, practice)) return json({ ok: false, error: OFF_FLAG, not_live: true }, 409)
      /* a double tap is one mark */
      const { data: dup } = await db.from('nurse_flag').select('*').eq('client_id', String(cl.id)).eq('by_name', nurse.name).eq('service_key', sv.key).eq('status', 'open')
      const again = (dup ?? []).find((f: Any) => f.seen === seen && Date.now() - Date.parse(f.at) < 10 * 60_000)
      if (again) return json({ ok: true, flag: flagPublic(again), again: true })
      const { data: row, error } = await db.from('nurse_flag').insert({ client_id: String(cl.id), client_axiscare_id: /^\d{1,12}$/.test(S(cl.axiscare_client_id, 12)) ? S(cl.axiscare_client_id, 12) : null, client_name: S(cl.name, 120),
        visit_id: S(b.visit_id, 60) || null, visit_date: vd, service_key: sv.key, service_name: sv.name, seen, by_name: nurse.name, by_email: S(nurse.email, 160).toLowerCase() || null, by_person: c.person || null,
        entered_by: entered || null, rn_name: flagRnName(staff, today) || null, practice }).select('*').maybeSingle()
      if (error || !row) return json({ ok: false, error: 'It could not be saved. Please try again, or call Natasha directly.' }, 500)
      await event(db, 'flag_created', who, { flag_id: row.id, client_ref: 'client:' + (row.client_axiscare_id || 'N' + row.client_id), detail: { service_key: sv.key, practice, entered_by: entered || null, for_nurse: nurse.name } })
      return json({ ok: true, flag: flagPublic(row) })
    }

    /* ═══ the RN (and owners, read only) ═══ */
    if (!c.rn && !c.owner) return json({ ok: false, error: 'This page is for the supervising RN. Your sign-in is not an RN on the nurse list (with a current license on file).' }, 403)
    if (action === 'queue') return json(await queue(db, c, cx))

    if (action === 'open') {
      const ip = ipOf(req)
      if (b.signature_id) {
        const id = S(b.signature_id, 64); if (!UUID.test(id)) return json({ ok: false, error: 'Which signature?' }, 400)
        const { data: s } = await db.from('rn_ghe_signature').select('*').eq('id', id).maybeSingle()
        if (!s || !(c.owner || s.rn_email === c.email)) return json({ ok: false, error: 'That signed form was not found.' }, 404)
        if (!s.pdf_path) return json({ ok: false, error: 'The signed PDF is not saved yet. The signature itself is recorded.' }, 404)
        const { data, error } = await db.storage.from(BUCKET).createSignedUrl(s.pdf_path, LINK_SECONDS)
        if (error || !data?.signedUrl) return json({ ok: false, error: 'Could not open the signed PDF.' }, 500)
        if (!(await logOpen(db, { subject: 'client:' + (s.client_axiscare_id || 'N' + (s.client_id || '')), doc: 'rn_ghe_signed_pdf', path: s.pdf_path, who: { person_id: c.person, email: c.email, name: c.name }, reason: 'opened on RN review', ip })))
          return json({ ok: false, error: 'The open could not be logged, so the document is not shown. Try again.' }, 500)
        return json({ ok: true, url: data.signedUrl, expires_in: LINK_SECONDS })
      }
      if (b.ghe_id) {
        const g = forms.find((x) => String(x.id) === S(b.ghe_id, 80))
        if (!g || !(c.owner || (c.rn && ((needsRn(g, staff) && mineToReview(g, c.rn, staff, today)) || norm(g.rn_reviewer) === norm(c.rn.name))))) return json({ ok: false, error: 'That GHE form is not one of yours to review.' }, 404)
        const cl = clientOf(cx, g), ax = S(cl?.axiscare_client_id, 12)
        if (!(await logOpen(db, { subject: /^\d+$/.test(ax) ? 'client:' + ax : 'ghe:' + g.id, doc: 'ghe_form', path: 'app_data/ghe_forms/' + g.id, who: { person_id: c.person, email: c.email, name: c.name }, reason: 'opened on RN review', ip })))
          return json({ ok: false, error: 'The open could not be logged, so the form is not shown. Try again.' }, 500)
        const { data: s } = await db.from('rn_ghe_signature').select('*').eq('ghe_id', String(g.id)).maybeSingle()
        const since = (await sinceMap(db, [g]))[g.id]
        const blockers = c.rn ? signBlockers(g, c, cx) : ['Only the RN signs.']
        const backBlock = g.status !== 'rn_review' || g.superseded_by || !c.rn || !mineToReview(g, c.rn, staff, today)
        const img = (v: unknown) => /^data:image\/(png|svg\+xml);base64,/.test(String(v || '')) ? String(v) : null
        return json({ ok: true, live: st.nurse_review_live === true, form: { ...gheSummary(g, cx, g.status === 'rn_review' ? since : ''), superseded: !!g.superseded_by, client_axiscare_id: ax || null }, readable: readable(g),
          images: { nurse: img(g.sig_nurse), participant: img(g.sig_part), supervisor: img(g.sig_sup) }, signature: sigPublic(s), sent_back: Array.isArray(g.rn_sent_back_log) ? g.rn_sent_back_log : [],
          may_sign: !blockers.length && mayWrite(c, cx, formPractice(cx, g)), may_send_back: !backBlock && mayWrite(c, cx, formPractice(cx, g)), why_not: blockers.length ? blockers : (mayWrite(c, cx, formPractice(cx, g)) ? [] : [OFF_WORDS]),
          consent_words: ESIGN_WORDS, participant_signed: !!S(g.sig_part, 40) })
      }
      if (b.client_id) {
        const cl = clients.find((x) => String(x.id) === S(b.client_id, 60))
        const lpnsUnderMe = c.rn && supervisorOf(staff, today) && norm(supervisorOf(staff, today).name) === norm(c.rn.name)
        const { data: fl } = await db.from('nurse_flag').select('*').eq('client_id', S(b.client_id, 60)).order('at', { ascending: false }).limit(200)
        const cf = forms.filter((g) => cl && (String(g.client_id) === String(cl.id) || (!g.client_id && norm(g.client) === norm(cl.name))))
        const ok = cl && (c.owner || (c.rn && (norm(cl.assigned_nurse) === norm(c.rn.name) || (lpnsUnderMe && credOf(nurseByName(staff, cl.assigned_nurse)) === 'LPN')
          || cf.some((g) => (needsRn(g, staff) && mineToReview(g, c.rn, staff, today)) || norm(g.rn_reviewer) === norm(c.rn.name)) || (fl ?? []).some((f: Any) => flagMine(f, c.rn, cx)))))
        if (!ok) return json({ ok: false, error: 'That client is not one of your nursing clients.' }, 404)
        const ax = S(cl.axiscare_client_id, 12)
        if (!(await logOpen(db, { subject: /^\d+$/.test(ax) ? 'client:' + ax : 'nurseclient:' + cl.id, doc: 'nursing_history', path: 'rn-review/client/' + cl.id, who: { person_id: c.person, email: c.email, name: c.name }, reason: 'nursing history on RN review', ip })))
          return json({ ok: false, error: 'The open could not be logged, so the history is not shown. Try again.' }, 500)
        const visits = (await list(db, 'nurse_visits')).filter((v) => String(v.client_id) === String(cl.id))
          .map((v) => ({ id: v.id, type: S(v.type, 30), status: S(v.status, 20), scheduled_for: S(v.scheduled_for, 10), completed_on: S(v.completed_on, 10), by: S(v.completed_by || v.nurse || v.by, 120), note: S(v.note || v.notes, 600) }))
          .sort((a, x) => String(x.completed_on || x.scheduled_for).localeCompare(String(a.completed_on || a.scheduled_for)))
        const ax_ = await axNursing(ax, cx)
        return json({ ok: true, client: { id: cl.id, name: S(cl.name, 120), axiscare_id: ax || null, assigned_nurse: S(cl.assigned_nurse, 120), ghe1: S(cl.ghe1, 10), ghe2: S(cl.ghe2, 10), med_freq: S(cl.med_freq, 20), practice: practiceClient(cl) },
          ghe: cf.map((g) => gheSummary(g, cx, '')).sort((a, x) => x.visit_date.localeCompare(a.visit_date)), hub_visits: visits, flags: (fl ?? []).map(flagPublic), axiscare: ax_ })
      }
      return json({ ok: false, error: 'Open what?' }, 400)
    }

    if (action === 'sign' || action === 'send_back') {
      if (!c.rn) return json({ ok: false, error: 'Only the RN signs or sends back a form.' }, 403)
      const g0 = forms.find((x) => String(x.id) === S(b.ghe_id, 80))
      if (!g0) return json({ ok: false, error: 'That GHE form was not found.' }, 404)
      const practice = formPractice(cx, g0)
      if (!mayWrite(c, cx, practice)) return json({ ok: false, error: OFF_WORDS, not_live: true }, 409)
      const cl = clientOf(cx, g0), ax = S(cl?.axiscare_client_id, 12), ref = /^\d+$/.test(ax) ? 'client:' + ax : 'ghe:' + g0.id
      if (action === 'send_back') {
        const note = S(b.note, 1500)
        if (note.length < 10) return json({ ok: false, error: 'Say what needs correcting (a sentence is enough).' }, 400)
        const at = now.toISOString()
        const r = await putGhe(db, String(g0.id), (g) => {
          if (g.superseded_by || g.status !== 'rn_review' || !mineToReview(g, c.rn, staff, today)) return { ok: false, why: 'This form is no longer waiting for your review.', status: 409 }
          if (!S(g.client) || !/^\d{4}-\d{2}-\d{2}$/.test(S(g.visit_date, 10))) return { ok: false, why: 'The form needs the client and the visit date first.', status: 409 }
          const line = { note, by: c.rn.name, by_email: c.email, at }
          return { ok: true, item: { ...g, status: 'draft', rn_sent_back: line, rn_sent_back_log: [...(Array.isArray(g.rn_sent_back_log) ? g.rn_sent_back_log : []), line], updated_at: at, updated_by: c.email } }
        })
        if (!r.ok) return json({ ok: false, error: r.why }, r.status || 500)
        await event(db, 'sent_back', who, { ghe_id: String(g0.id), client_ref: ref, detail: { note, practice } })
        await closeCard(db, 'rn_wait_ghe_' + g0.id, 'sent back to the LPN')
        return json({ ok: true, form: gheSummary(r.item, cx, '') })
      }
      /* sign: write-once */
      if (b.consent !== true) return json({ ok: false, error: 'Please tick "' + ESIGN_WORDS + '" first.' }, 400)
      const typed = S(b.typed_name, 80)
      if (!typedOk(typed, c.rn.name)) return json({ ok: false, error: `Please type your full name as it is on your nurse record (${c.rn.name}).` }, 400)
      const blockers = signBlockers(g0, c, cx)
      const { data: had } = await db.from('rn_ghe_signature').select('id').eq('ghe_id', String(g0.id)).maybeSingle()
      if (had) return json({ ok: false, error: 'This form is already signed. A signature is never changed; to correct the form, the LPN uses Amend.', already: true }, 409)
      if (blockers.length) return json({ ok: false, error: blockers.join(' '), blockers }, 409)
      const at = now.toISOString(), fp = await formFingerprint(g0), ip = ipShort(req), agent = agentOf(req)
      /* the picture of her typed name the page drew (PNG, so the Hub's GHE form can redraw and print it); only a small PNG is kept */
      const png = pngOk(b.sig_png) ? String(b.sig_png) : null
      const { data: sig, error: se } = await db.from('rn_ghe_signature').insert({ ghe_id: String(g0.id), client_id: S(g0.client_id, 60) || (cl ? String(cl.id) : null), client_axiscare_id: /^\d+$/.test(ax) ? ax : null, client_name: S(g0.client, 120),
        visit_date: S(g0.visit_date, 10), lpn_name: S(g0.nurse, 120), rn_name: c.rn.name, rn_email: c.email, rn_person: c.person || null, typed_name: typed, consent: true, consent_words: ESIGN_WORDS, version: SIGN_VERSION,
        signed_at: at, ip, agent, form_fingerprint: fp, practice }).select('*').maybeSingle()
      if (se || !sig) return /duplicate|unique/i.test(String(se?.message)) ? json({ ok: false, error: 'This form is already signed.', already: true }, 409) : json({ ok: false, error: 'The signature could not be recorded, so nothing changed. Try again.' }, 500)
      await event(db, 'signed', who, { ghe_id: String(g0.id), client_ref: ref, detail: { signature_id: sig.id, typed_name: typed, consent: true, words: ESIGN_WORDS, ip, agent, fingerprint: fp, practice, lpn: g0.nurse } })
      /* the signed PDF in the private bucket (kept seven years); a failure is a card, never a lost signature */
      let pdf = false
      try {
        const bytes = gheReviewPdf(g0, { typedName: typed, signedAtCentral: longDateTime(at), signedAtUtc: at, ip, agent, fingerprint: fp, gheId: String(g0.id), rnEmail: c.email, lpn: S(g0.nurse, 120), version: SIGN_VERSION, practice })
        const path = `${practice ? 'practice/' : ''}ghe/${g0.id}/rn-signed-${at.replace(/[:.]/g, '-')}.pdf`
        const up = await db.storage.from(BUCKET).upload(path, bytes, { contentType: 'application/pdf', upsert: false })
        if (!up.error) { const { error: pe } = await db.from('rn_ghe_signature').update({ pdf_path: path }).eq('id', sig.id).is('pdf_path', null); pdf = !pe }
        if (!pdf) throw new Error(S(up.error?.message || 'the PDF path could not be recorded', 120))
      } catch (e) {
        await event(db, 'pdf_failed', who, { ghe_id: String(g0.id), client_ref: ref, detail: { signature_id: sig.id, error: S((e as Error)?.message ?? e, 160) } })
        if (!practice) await raiseCard(db, { id: 'rn_pdf_' + sig.id, kind: 'rn_pdf_failed', urgency: 'today', who: S(g0.client, 120), owner: await payerOwner(db), client_id: S(g0.client_id, 60),
          title: 'A signed GHE has no PDF yet: ' + S(g0.client, 120), detail: `${c.rn.name}'s signature on the GHE for ${S(g0.client, 120)} (visit ${S(g0.visit_date, 10)}) is recorded, but its signed PDF could not be saved (${S((e as Error)?.message ?? e, 120)}). Tell Claude so the PDF is made again from the signed record.` })
      }
      /* the form moves to Ready for Fusion exactly as the GHE pipeline expects */
      const r = await putGhe(db, String(g0.id), (g) => {
        if (S(g.sig_sup, 40) || g.superseded_by) return { ok: false, why: 'The form changed while you were signing (it already has a Supervisory Nurse signature, or it was amended).', status: 409 }
        if (g.status !== 'rn_review') return { ok: false, why: 'The form was moved out of RN review while you were signing.', status: 409 }
        return { ok: true, item: signedPatch(g, c.rn, c.email, at, { id: sig.id, typed, pdf, png }) }
      })
      if (r.ok) {
        await db.from('rn_ghe_signature').update({ form_updated_at: at }).eq('id', sig.id).is('form_updated_at', null)
        await event(db, 'form_updated', who, { ghe_id: String(g0.id), client_ref: ref, detail: { status: 'ready', signature_id: sig.id } })
        await closeCard(db, 'rn_wait_ghe_' + g0.id, 'signed by the RN')
      } else {
        await event(db, 'form_update_failed', who, { ghe_id: String(g0.id), client_ref: ref, detail: { signature_id: sig.id, why: r.why } })
        if (!practice) await raiseCard(db, { id: 'rn_sigform_' + sig.id, kind: 'rn_sign_not_on_form', urgency: 'today', who: S(g0.client, 120), owner: await payerOwner(db), client_id: S(g0.client_id, 60),
          title: 'RN signature recorded but the GHE form did not move: ' + S(g0.client, 120), detail: `${c.rn.name} signed the GHE for ${S(g0.client, 120)} (visit ${S(g0.visit_date, 10)}) and the signature is kept, but the form could not be marked Ready for Fusion (${r.why}). The hourly check tries again; if this stays, tell Claude.` })
      }
      return json({ ok: true, signature: sigPublic({ ...sig, pdf_path: pdf ? 'yes' : null }), form_updated: r.ok, pdf, practice, ...(r.ok ? {} : { warning: r.why }) })
    }

    if (action === 'flag_review') {
      if (!c.rn) return json({ ok: false, error: 'Only the RN reviews a mark.' }, 403)
      const id = S(b.flag_id, 64); if (!UUID.test(id)) return json({ ok: false, error: 'Which mark?' }, 400)
      const { data: f } = await db.from('nurse_flag').select('*').eq('id', id).maybeSingle()
      if (!f || !flagMine(f, c.rn, cx)) return json({ ok: false, error: 'That mark is not one of yours.' }, 404)
      if (f.status !== 'open') return json({ ok: false, error: 'This mark was already reviewed. A review is never changed.', already: true }, 409)
      const note = S(b.note, 2000); if (note.length < 5) return json({ ok: false, error: 'Write your note for the LPN (what you found or what to do).' }, 400)
      if (!mayWrite(c, cx, !!f.practice)) return json({ ok: false, error: OFF_WORDS, not_live: true }, 409)
      const at = now.toISOString()
      const { data: row, error } = await db.from('nurse_flag').update({ status: 'reviewed', rn_note: note, reviewed_at: at, reviewed_by: c.rn.name, reviewed_by_email: c.email, rn_name: f.rn_name || c.rn.name }).eq('id', id).eq('status', 'open').select('*').maybeSingle()
      if (error || !row) return json({ ok: false, error: 'It could not be saved (it may have been reviewed a moment ago). Reload and look again.' }, 409)
      await event(db, 'flag_reviewed', who, { flag_id: id, client_ref: 'client:' + (f.client_axiscare_id || 'N' + f.client_id), detail: { note, practice: !!f.practice } })
      await closeCard(db, 'rn_wait_flag_' + id, 'reviewed by the RN')
      return json({ ok: true, flag: flagPublic(row) })
    }
    return json({ ok: false, error: 'Unknown action.' }, 400)
  } catch (e) {
    return json({ ok: false, error: 'Something went wrong: ' + S((e as Error)?.message || 'error', 200) + '.' }, 500)
  }
})

/* ── the schedule: cards and repairs ── */
async function pass(db: Any, cx: Ctx): Promise<Record<string, unknown>> {
  const live = cx.st.nurse_review_live === true, nowIso = cx.now.toISOString()
  const out = { ok: true, live, today: cx.today, waiting: 0, upload_late: 0, cards: 0, practice: 0, closed: 0, repaired: 0, errors: 0 }
  const want = new Set<string>()
  try {
    const sup = supervisorOf(cx.staff, cx.today)
    const rnEmail = (name: string) => S(nurseByName(cx.staff, name)?.email || sup?.email, 160).toLowerCase()
    const payer = await payerOwner(db)
    /* 1. waiting on the RN more than 2 working days */
    const ghe = cx.forms.filter((g) => !g.superseded_by && g.status === 'rn_review' && needsRn(g, cx.staff))
    const since = await sinceMap(db, ghe)
    for (const g of ghe) {
      const s = gheSummary(g, cx, since[g.id]); if (!s.waiting_over) continue
      out.waiting++
      if (s.practice || !live) { out.practice++; continue }
      const rn = S(g.rn_reviewer) || S(sup?.name), id = 'rn_wait_ghe_' + g.id; want.add(id)
      if (await raiseCard(db, { id, kind: 'rn_review_waiting', urgency: 'today', who: S(g.client, 120), owner: rnEmail(rn) || payer, client_id: S(g.client_id, 60),
        title: `GHE waiting for RN review: ${S(g.client, 120)}`, detail: `${S(g.nurse, 120) || 'An LPN'}'s GHE for ${S(g.client, 120)} (visit ${s.visit_date}) has waited ${s.waiting_days} working days for ${rn || 'the RN'}'s review. Open the RN review page (cc.mo-care.com/rn.html) to sign it or send it back. Upload to Fusion is due ${s.upload_due}.` }) === 'raised') out.cards++
    }
    const { data: fl } = await db.from('nurse_flag').select('*').eq('status', 'open')
    for (const f of fl ?? []) {
      const w = businessDaysWaiting(f.at, cx.now, cx.st.company_holidays); if (w <= WAIT_DAYS) continue
      out.waiting++
      if (f.practice || !live) { out.practice++; continue }
      const rn = S(f.rn_name) || S(sup?.name), id = 'rn_wait_flag_' + f.id; want.add(id)
      if (await raiseCard(db, { id, kind: 'rn_review_waiting', urgency: 'today', who: S(f.client_name, 120), owner: rnEmail(rn) || payer, client_id: S(f.client_id, 60),
        title: `Marked for RN review: ${S(f.client_name, 120)}`, detail: `${S(f.by_name, 120)} marked ${S(f.service_name, 80).toLowerCase() || 'a nurse visit'} for ${S(f.client_name, 120)} ${w} working days ago and it has not been reviewed: "${S(f.seen, 200)}". Open the RN review page (cc.mo-care.com/rn.html).` }) === 'raised') out.cards++
    }
    /* 2. signed, not uploaded to Fusion by its upload date (ghe-reminders emails a digest only; no card there) */
    for (const g of cx.forms.filter((x) => !x.superseded_by && x.status === 'ready')) {
      const due = uploadDue(g.visit_date); if (!due || cx.today <= due) continue
      out.upload_late++
      if (formPractice(cx, g) || !live) { out.practice++; continue }
      const id = 'rn_upload_late_' + g.id; want.add(id)
      if (await raiseCard(db, { id, kind: 'ghe_upload_late', urgency: 'urgent', who: S(g.client, 120), owner: payer, client_id: S(g.client_id, 60),
        title: `Signed GHE not uploaded to Fusion: ${S(g.client, 120)}`, detail: `The GHE for ${S(g.client, 120)} (visit ${S(g.visit_date, 10)}) is signed and Ready for Fusion, but it was due in Fusion by ${due} (the earlier of 10 working days after the visit or the 15th of the next month). Upload it in Fusion, then mark it Uploaded on Nurse Scheduling.` }) === 'raised') out.cards++
    }
    /* 3. close what moved on (a card a person closed stays closed) */
    for (const it of (await list(db, 'ops_items')).filter((x) => String(x.created_by) === SENDER && ['rn_review_waiting', 'ghe_upload_late'].includes(x.kind) && x.status !== 'done' && x.status !== 'resolved')) {
      if (!want.has(it.id) && live && await closeCard(db, it.id, it.kind === 'ghe_upload_late' ? 'uploaded or no longer Ready for Fusion' : 'reviewed')) out.closed++
    }
    /* 4. repair: a recorded signature whose form was not updated */
    const { data: open } = await db.from('rn_ghe_signature').select('*').is('form_updated_at', null).limit(50)
    for (const s of open ?? []) {
      const r = await putGhe(db, String(s.ghe_id), (g) => {
        if (g.rn_signature?.id === s.id) return { ok: true, item: g }
        if (S(g.sig_sup, 40) || g.superseded_by || g.status !== 'rn_review') return { ok: false, why: 'the form changed after the signature', status: 409 }
        return { ok: true, item: signedPatch(g, nurseByName(cx.staff, s.rn_name) || { name: s.rn_name }, s.rn_email, s.signed_at, { id: s.id, typed: s.typed_name, pdf: !!s.pdf_path }) }
      })
      if (r.ok) { await db.from('rn_ghe_signature').update({ form_updated_at: nowIso }).eq('id', s.id).is('form_updated_at', null); await event(db, 'form_updated', { name: 'The Hub (RN review check)' }, { ghe_id: String(s.ghe_id), detail: { repaired: true, signature_id: s.id } }); out.repaired++ }
    }
  } catch (e) {
    out.errors++
    await raiseCard(db, { id: 'rn_pass_failed_' + cx.today, kind: 'rn_pass_failed', urgency: 'today', who: 'RN review', owner: await payerOwner(db), title: 'The RN review check could not finish', detail: `The hourly RN review check stopped (${S((e as Error)?.message ?? e, 160)}). Waiting items and late uploads may have no card. Tell Claude.` })
  }
  try { await db.rpc('upsert_app_data_item', { target_key: 'automation_log', item: { id: 'auto_srv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), at: nowIso, automation: 'rn_review', ran_by: 'server', ok: out.errors === 0, dry: !live, summary: out } }) } catch { /* the log must not take the pass down */ }
  try { await db.rpc('upsert_app_data_item', { target_key: 'automation_heartbeats', item: { id: 'hb_rn-review', automation: 'rn-review', at: nowIso, ok: out.errors === 0, note: JSON.stringify(out).slice(0, 300) } }) } catch { /* same */ }
  return out
}
