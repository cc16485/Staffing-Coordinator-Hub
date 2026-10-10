// =============================================================================
// caregiver-journey · SLICE 3b (Samantha approved Migrations A and B, 2026-10-10): the one new-hire readiness view's server
// SLICE 5 (Samantha: "start slice 5", 2026-10-10): Ready for Final Approval, Approve to Work, AxisCare Active with read-back,
// the cleared text, the scheduling lock, and the Training Platform reporting instead of acting (new path only).
// =============================================================================
// The offer-to-Approved-to-Work journey on the same tables and rules file as the client journey (plan section 29).
//   { action: 'get', offer_id | journey_id }   (staff)   the journey, its computed view, every step, the history, the facts the
//                                                          rows were verified from, `may`: which rows THIS person may confirm,
//                                                          and `approve`: ready for final approval, approved by whom and when,
//                                                          the AxisCare read-back, the cleared text, the scheduling lock
//   { action: 'list' }                         (staff)   every open caregiver journey with its next move, owner and lock
//   { action: 'confirm', journey_id, step_key } (staff)  a 'confirmed' row, by the Admin list its catalog row names (advance,
//                                                          screening, office); Approve to Work has its own action below
//   { action: 'record', journey_id, step_key, result, document, expires? } (staff by list)  a 'proof' row the office records
//   { action: 'not_needed', journey_id, step_key, reason } (owners only)
//   { action: 'approve_work', journey_id }     (Approve to Work list ONLY)  refused until every earlier row is complete and no
//                                                          row is blocked; records who and the exact time; sets the caregiver
//                                                          Active in AxisCare (approve_work_axiscare_live, else practice) and
//                                                          reads it back; Approved to Work shows only after the read-back;
//                                                          then the cleared text (approve_work_text_live, else practice)
//   { action: 'retry_axiscare', journey_id }   (staff)   after "Approval recorded, AxisCare update failed": the same update again
//   { action: 'training_report', axiscare_id, courses } (server door: x-outreach-secret, the Training Platform)  the pre-service
//                                                          courses done, verified onto the card; Training sends nothing itself
//   { action: 'nightly' }                      (job)     SLICE 6, once a night: the Training Platform's facts onto the roster
//                                                          (training_sync_live), the monthly OIG re-check with retained results
//                                                          (oig_monthly_live), every open AND approved card re-verified with its
//                                                          expiries written as events and owned tasks (audit_sweep_live);
//                                                          off = practice: counts in the automation log, nothing written
//   { action: 'sweep' }                        (job)     every open caregiver journey: verify the rows the records satisfy,
//                                                          keep the roster's work_lock true until the stamp and the read-back,
//                                                          raise the Ready for Final Approval card, send a held cleared text
// Fictional offers only: a caregiver journey exists only for new-path offers (none real until the switch date).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES, serverSecretOk } from '../_shared/staff-auth.ts'
import { jobCaller } from '../_shared/job-auth.ts'
import { PERM_KEY, normalizePerms, mayApprove } from '../_shared/onboarding-permissions.ts'
import { R, facts, verifyRows, type Facts } from '../_shared/caregiver-journey.ts'
import { setCaregiverActive } from '../_shared/axiscare-caregiver.ts'
import { saveSweepFields } from '../_shared/sweep-patch.ts'
import { ghlContactIfAllowed } from '../_shared/optout.ts'
import { ghlSendChecked } from '../_shared/send-problems.ts'
import { latestTextConsent, inTextHours, withStop } from '../_shared/text-consent.ts'
import { saveAuditFields } from '../_shared/sweep-patch.ts'
import { loadLeie, matchLeie, oigEvidence, oigDue, OIG_INTERVAL_DAYS } from '../_shared/oig-leie.ts'
import { readTraining, certificateRef, syncPatch } from '../_shared/training-sync.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret, x-outreach-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
// deno-lint-ignore no-explicit-any
type Any = any
const S = (v: unknown, n = 160) => String(v ?? '').trim().slice(0, n)
const DONE = ['complete', 'not_needed', 'exception']
const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '')
const WORK_KEY = 'cg.approve.work', AX_KEY = 'cg.axiscare.active'
const TRAINING_ROWS: Record<string, string> = { 'agency-orientation': 'cg.training.orientation', 'dementia-care': 'cg.training.dementia' }

/* THE CLEARED TEXT (her wording, 2026-10-10): not "approved to work"; we were notified the Dementia course is done, and where
   the open shifts are. Goes only after Approve to Work AND the AxisCare read-back, 8am to 6pm Central, yes-to-texts,
   opt-outs; practice (recorded, not sent) while approve_work_text_live is off. No em dashes. */
export const clearedText = (first: string) => withStop(`Hi${first ? ' ' + first : ''}, we've been notified that you completed your Dementia course. Welcome to the team!\n` +
  `Keep an eye out for our texts about open shifts, and check the Open Shifts section of the AxisCare app too.\n` +
  `For anything you need, call or text the office, and save the number in your phone: (417) 234-8494.\nCaring Companions`)

function trn() {
  const url = Deno.env.get('OFFERS_PROJECT_URL') ?? '', key = Deno.env.get('OFFERS_SERVICE_ROLE_KEY') ?? ''
  if (!url || !key) return null
  const H = { apikey: key, Authorization: `Bearer ${key}` }
  return { async get(id: string) { const r = await fetch(`${url}/rest/v1/job_offers?id=eq.${encodeURIComponent(id)}&select=id,first_name,last_name,phone,email,offer_signed_at,pd_signed_at,offer_version,pd_version,offer_status,onboarding_path,step1_done_at`, { headers: H }); if (!r.ok) return null; const rows = await r.json(); return Array.isArray(rows) && rows.length === 1 ? rows[0] : null } }
}
async function defs(db: Any): Promise<Any[]> {
  const { data, error } = await db.from('client_journey_step_def').select('key, def, active, catalog_version').like('key', 'cg.%')
  if (error) throw new Error('could not read the caregiver catalog')
  return (data ?? []).filter((d: Any) => d.active !== false).map((d: Any) => ({ key: d.key, active: d.active, ...(d.def || {}) }))
}
async function load(db: Any, by: { journey_id?: unknown; offer_id?: unknown }) {
  let q = db.from('client_journey').select('*').eq('subject', 'caregiver')
  q = by.journey_id ? q.eq('journey_id', S(by.journey_id, 64)) : q.eq('offer_id', S(by.offer_id, 64))
  const { data: j } = await q.maybeSingle(); if (!j) return null
  const { data: steps } = await db.from('client_journey_step').select('*').eq('journey_id', j.journey_id)
  return { j, steps: steps ?? [] }
}
async function putStep(db: Any, journeyId: string, key: string, patch: Any) {
  const { data: cur } = await db.from('client_journey_step').select('version').eq('journey_id', journeyId).eq('step_key', key).maybeSingle()
  const row = { journey_id: journeyId, step_key: key, ...patch, version: (cur?.version ?? 0) + 1, updated_at: new Date().toISOString() }
  const { error } = await db.from('client_journey_step').upsert(row, { onConflict: 'journey_id,step_key' })
  if (error) throw new Error('could not save the step: ' + error.message)
}
/** add to a step's evidence without losing what is there */
async function mergeEvidence(db: Any, journeyId: string, key: string, add: Any) {
  const { data: cur } = await db.from('client_journey_step').select('evidence').eq('journey_id', journeyId).eq('step_key', key).maybeSingle()
  await putStep(db, journeyId, key, { evidence: { ...(cur?.evidence || {}), ...add } })
}
async function event(db: Any, journeyId: string, step: string | null, who: { email?: string; name?: string }, kind: string, detail: Any = {}, reason: string | null = null) {
  await db.from('client_journey_event').insert({ journey_id: journeyId, step_key: step, actor_email: who.email || 'hub', actor_name: who.name || 'The Hub', kind, detail, reason })
}
async function perms(db: Any) { const { data } = await db.from('app_data').select('data').eq('key', PERM_KEY).maybeSingle(); return normalizePerms(data?.data) }
async function settings(db: Any) { const { data } = await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle(); return (data?.data && typeof data.data === 'object') ? data.data : {} }
/** May this signed-in person complete this row? By the Admin list the catalog row names. */
function mayDo(def: Any, who: Any, P: Any): boolean {
  const p = def?.permission || 'office'
  if (p === 'hub') return false
  if (p === 'office') return true
  if (p === 'advance' || p === 'work' || p === 'screening') return mayApprove(P, p, { person_id: who.person_id, roles: who.roles || [], email: who.email })
  return false
}
const ctxFor = (f: Facts, st: Any) => ({ today: new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10), facts: { lived_outside_mo: f.lived_outside_mo, claims_cna_or_hha: f.claims_cna_or_hha, drives_clients: f.drives_clients, after_first_year: f.after_first_year }, staffing_email: S(st?.staffing_email, 160).toLowerCase() || null, owner_emails: [] })
const dates = (f: Facts) => { const o = f.roster?.orient_date ? String(f.roster.orient_date).slice(0, 10) : null, h = f.roster?.hire_date ? String(f.roster.hire_date).slice(0, 10) : null; return { orientation: o, axiscare_hire: h, differ: !!(o && h && o !== h) } }

/* ── the Needs Attention cards (ops_items), raised and closed by the readiness server; a card a person closed stays closed ── */
async function raiseCard(db: Any, c: { id: string; kind: string; title: string; detail: string; who: string; offer_id: string; urgency: 'urgent' | 'today' | 'normal' }, extra: { owner?: string; owner_name?: string; due?: string } = {}) {
  try {
    const now = new Date().toISOString()
    const { data: row } = await db.from('app_data').select('data').eq('key', 'ops_items').maybeSingle()
    const items: Any[] = Array.isArray(row?.data) ? row.data : []
    const prev = items.find((x) => x && x.id === c.id)
    const isOpen = (x: Any) => x && x.status !== 'done' && x.status !== 'resolved'
    if (prev && !isOpen(prev)) return
    const item = { ...(prev && isOpen(prev) ? prev : { owner: extra.owner || '', owner_name: extra.owner_name || '', created_at: now, first_at: now }), id: c.id, kind: c.kind, domain: c.kind === 'requirement_expired' ? 'training_compliance' : 'caregivers', status: 'open', urgency: c.urgency,
      title: c.title, detail: c.detail, who: c.who, offer_id: c.offer_id, last_at: now, due: (prev && isOpen(prev) && prev.due) || (extra.due ? extra.due + 'T17:00:00Z' : new Date(Date.now() + 24 * 3_600_000).toISOString()),
      closed_at: null, closed_by: null, close_note: null, resolved_at: null, created_by: 'caregiver-journey', opened_by: 'caregiver-journey' }
    await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item })
  } catch (e) { console.warn('[caregiver-journey] could not raise a card: ' + String(e).slice(0, 160)) }
}
async function closeCard(db: Any, id: string, note: string, onClosed?: () => void) {
  try {
    const { data: row } = await db.from('app_data').select('data').eq('key', 'ops_items').maybeSingle()
    const prev = (Array.isArray(row?.data) ? row.data : []).find((x: Any) => x && x.id === id)
    if (!prev || prev.status === 'done' || prev.status === 'resolved') return
    const now = new Date().toISOString()
    await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { ...prev, status: 'done', closed_at: now, closed_by: 'caregiver-journey', close_reason: note, last_activity_at: now } })
    if (onClosed) onClosed()
  } catch (e) { console.warn('[caregiver-journey] could not close a card: ' + String(e).slice(0, 160)) }
}
/** the six roster fields this server owns, saved through the sweep's own door (only those fields, only if unchanged since read) */
async function rosterPatch(db: Any, roster: Any, patch: Any): Promise<'saved' | 'skipped' | 'error'> {
  if (!roster || roster.id == null) return 'skipped'
  return await saveSweepFields(db, { ...roster, ...patch }, (fresh: Any) => Object.assign(fresh, patch))
}

/** Apply the verdicts the facts give: complete or blocked rows, with evidence and events; never un-complete a confirmed row. */
async function applyVerdicts(db: Any, j: Any, steps: Any[], f: Facts, now: string): Promise<number> {
  const by = Object.fromEntries(steps.map((s) => [s.step_key, s])); let changed = 0
  for (const v of verifyRows(f, now)) {
    const st = by[v.key]
    if (v.state === 'complete') {
      const newer = st?.state === 'complete' && st.completed_at && v.at && Date.parse(v.at) > Date.parse(st.completed_at) + 60000
      if (st && DONE.includes(st.state) && !newer) continue
      if (v.key === AX_KEY && st?.state === 'blocked') continue   // the AxisCare row is settled by the approval path, never by a stale roster flag
      await putStep(db, j.journey_id, v.key, { state: 'complete', evidence: { verified: { at: now, by: 'hub' }, ...v.evidence }, completed_by: 'hub', completed_by_name: 'The Hub (verified)', completed_at: v.at, blocked_reason: null })
      await event(db, j.journey_id, v.key, {}, newer ? 'reverified' : 'verified', v.evidence); changed++
    } else if (v.state === 'blocked') {
      if (st && (st.state === 'blocked' || DONE.includes(st.state))) continue
      await putStep(db, j.journey_id, v.key, { state: 'blocked', blocked_reason: v.reason, evidence: { ...(st?.evidence || {}), flagged: v.evidence } })
      await event(db, j.journey_id, v.key, {}, 'blocked', v.evidence, v.reason || null); changed++
    }
  }
  return changed
}

/* ── SLICE 5: the approval state the card and the lists read ── */
function approveState(view: Any, f: Facts, st: Any, who: Any, P: Any) {
  const rows: Any[] = view?.rows || []
  const aw = rows.find((r) => r.key === WORK_KEY), ax = rows.find((r) => r.key === AX_KEY)
  const approved = !!(aw?.st && aw.st.state === 'complete')
  const axDone = !!(ax?.st && DONE.includes(ax.st.state))
  const axEv = ax?.st?.evidence || {}
  const axiscare = axDone ? { state: 'confirmed', label: axEv.label || 'Active', at: ax.st.completed_at || null }
    : ax?.st?.state === 'blocked' ? { state: 'failed', detail: ax.st.blocked_reason || 'AxisCare update failed', at: ax.st.updated_at || null }
    : axEv.practice ? { state: 'practice', at: axEv.practice.at || null }
    : { state: 'pending' }
  const blocked = rows.filter((r) => r.status === 'blocked' && r.key !== AX_KEY).map((r) => r.def.title)
  const ready_for_final = !approved && !!aw && ['ready', 'attention'].includes(aw.status) && !blocked.length
  const lvl = f.candidate?.care_level_approved ?? f.roster?.care_level_approved ?? null
  return {
    ready_for_final, approved, approved_at: approved ? aw.st.completed_at : null, approved_by: approved ? (aw.st.completed_by_name || aw.st.completed_by) : null,
    axiscare, text: aw?.st?.evidence?.text || null, blocked,
    locked: !(approved && axDone), lock_why: !(approved && axDone) ? 'Scheduling stays locked until Approved to Work and AxisCare reads back Active.' : null,
    level_of_care: lvl ? { level: String(lvl), source: 'recorded on the Background and References row' } : { level: 'Level 1', source: 'the default: nothing higher is recorded' },
    may_approve_work: !!who && mayApprove(P, 'work', { person_id: who.person_id, roles: who.roles || [], email: who.email }),
    may_retry: approved && !axDone,
    switches: { axiscare_live: st?.approve_work_axiscare_live === true, text_live: st?.approve_work_text_live === true },
  }
}
const nameOf = (f: Facts, j: Any) => S(f.offer?.first_name || f.roster?.first || f.candidate?.first || String(j?.client_name || '').split(' ')[0], 40)

/** The cleared text, after the read-back: sent in hours with the switch on; held ('due') after hours; recorded ('practice') with the switch off. */
async function clearedTextStep(db: Any, j: Any, f: Facts, st: Any, who: { email?: string; name?: string }, send: typeof fetch = fetch): Promise<Any> {
  const now = new Date().toISOString(), first = nameOf(f, j), words = clearedText(first)
  const phone = S(f.roster?.phone || f.offer?.phone, 40), email = S(f.roster?.email || f.offer?.email, 160)
  let text: Any
  if (st?.approve_work_text_live !== true) { text = { state: 'practice', at: now, words }; await event(db, j.journey_id, WORK_KEY, who, 'cleared_text_practice', { words, phone_on_file: !!phone }) }
  else if (!inTextHours()) { text = { state: 'due', at: now }; await event(db, j.journey_id, WORK_KEY, who, 'cleared_text_due', { why: 'texts go 8am to 6pm Central; the sweep sends it in hours' }) }
  else if (!phone) { text = { state: 'failed', at: now, why: 'no phone number on file' }; await event(db, j.journey_id, WORK_KEY, who, 'cleared_text_failed', {}, 'no phone number on file') }
  else {
    const ghl = { token: Deno.env.get('GHL_TOKEN') ?? '', locationId: Deno.env.get('GHL_LOCATION_ID') ?? '' }
    const H = { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' }
    let why = ''
    if (!ghl.token || !ghl.locationId) why = 'texting is not set up on the server'
    else {
      const c = await latestTextConsent(db, phone)
      if (!c.ok) why = 'text: ' + (c.why || 'they said no to texts')
      else {
        const id = await ghlContactIfAllowed(db, ghl, 'caregiver-journey', { channel: 'sms', phone, email, firstName: first, lastName: S(f.offer?.last_name || f.roster?.last, 60) })
        if (!id) why = 'they opted out, or the number could not be confirmed'
        else if (!(await ghlSendChecked(db, H, 'caregiver-journey', { channel: 'sms', contactId: id, address: phone, who: j.client_name }, { message: words }, send))) why = 'GoHighLevel did not accept it (a card is on Needs Attention)'
      }
    }
    if (why) { text = { state: 'failed', at: now, why }; await event(db, j.journey_id, WORK_KEY, who, 'cleared_text_failed', {}, why) }
    else { text = { state: 'sent', at: now }; await event(db, j.journey_id, WORK_KEY, who, 'cleared_text_sent', { words }) }
  }
  await mergeEvidence(db, j.journey_id, WORK_KEY, { text })
  return text
}

/** AxisCare Active after the stamp: the one update, read back, recorded; then the cleared text. Also the Retry. */
async function activate(db: Any, j: Any, f: Facts, st: Any, who: { email?: string; name?: string }, send: typeof fetch = fetch): Promise<Any> {
  const now = new Date().toISOString(), axId = digits(f.roster?.axiscare_id)
  const fail = async (detail: string) => {
    const reason = 'Approval recorded, AxisCare update failed: ' + detail
    await putStep(db, j.journey_id, AX_KEY, { state: 'blocked', blocked_reason: reason })
    await event(db, j.journey_id, AX_KEY, who, 'axiscare_failed', { detail }, reason)
    await raiseCard(db, { id: 'cj_axfail_' + j.journey_id, kind: 'axiscare_active_failed', urgency: 'urgent', who: j.client_name, offer_id: j.offer_id, title: 'Approval recorded, AxisCare update failed: ' + j.client_name, detail: detail + ' Open their readiness card and press Retry, or set them Active in AxisCare by hand and press Retry to read it back.' })
    return { outcome: 'failed', detail }
  }
  if (!axId) return await fail('no AxisCare caregiver number on their roster record yet. Connect them on the Caregivers list, then press Retry.')
  const r = await setCaregiverActive(db, axId, who.email || 'hub', 'caregiver-journey', st?.approve_work_axiscare_live === true, send)
  if (r.outcome === 'confirmed') {
    await putStep(db, j.journey_id, AX_KEY, { state: 'complete', evidence: { verified: { at: now, by: 'hub' }, axiscare_id: axId, label: r.label, read_back_at: now, by: who.email || 'hub', recorded: r.recorded }, completed_by: 'hub', completed_by_name: 'The Hub (AxisCare read back)', completed_at: now, blocked_reason: null })
    await event(db, j.journey_id, AX_KEY, who, 'verified', { axiscare_id: axId, label: r.label, read_back: true })
    await rosterPatch(db, f.roster, { axiscare_status_active: true, axiscare_status_label: r.label || 'Active', axiscare_status_at: now, work_lock: false })
    await closeCard(db, 'cj_axfail_' + j.journey_id, 'AxisCare read back Active.')
    await closeCard(db, 'cj_final_' + j.journey_id, 'Approved to Work.')
    const d = dates(f)
    if (r.hire_date && d.orientation && r.hire_date !== d.orientation) {
      await event(db, j.journey_id, AX_KEY, who, 'hire_date_differs', { axiscare_hire_date: r.hire_date, orientation: d.orientation })
      await raiseCard(db, { id: 'cj_hiredate_' + j.journey_id, kind: 'hire_date_check', urgency: 'today', who: j.client_name, offer_id: j.offer_id, title: 'Hire date differs from orientation: ' + j.client_name, detail: `AxisCare hire date ${r.hire_date}; orientation completed ${d.orientation} (the employment start date by policy). Reconcile in AxisCare; nothing was written there.` })
    }
    const text = await clearedTextStep(db, j, f, st, who, send)
    return { outcome: 'confirmed', label: r.label, text }
  }
  if (r.outcome === 'practice') {
    await mergeEvidence(db, j.journey_id, AX_KEY, { practice: { at: now, by: who.email || 'hub', recorded: r.recorded } })
    await event(db, j.journey_id, AX_KEY, who, 'axiscare_practice', { axiscare_id: axId, why: 'approve_work_axiscare_live is off: nothing was written to AxisCare' })
    await closeCard(db, 'cj_final_' + j.journey_id, 'Approved to Work (practice).')
    const text = await clearedTextStep(db, j, f, st, who, send)
    return { outcome: 'practice', text }
  }
  return await fail(r.detail || r.outcome)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false, autoRefreshToken: false } })
  const b: Any = await req.json().catch(() => ({}))
  const action = S(b.action, 20)
  try {
    const dfs = await defs(db)
    /* ── SLICE 6: the nightly audit ── */
    if (action === 'nightly') {
      const caller = await jobCaller(req)
      if (!caller) return json({ error: 'the nightly audit is for the schedule or an owner' }, 401)
      const st = await settings(db), now = new Date().toISOString(), today = now.slice(0, 10), t0 = Date.now()
      const live = { training: st.training_sync_live === true, oig: st.oig_monthly_live === true, audit: st.audit_sweep_live === true }
      const out: Any = { ok: true, live, training: { matched: 0, would_update: 0, updated: 0, skipped: 0, why: null }, oig: { due: 0, checked: 0, clear: 0, matches: 0, written: 0, why: null }, cards: { looked_at: 0, changed: 0, expired_new: 0, tasks_raised: 0, tasks_closed: 0 }, errors: [] as string[] }
      const { data: row } = await db.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()
      const roster: Any[] = Array.isArray(row?.data) ? row.data : []
      const active = roster.filter((c) => c && c.active !== false && !c.not_hired)
      /* 1. the Training Platform's facts */
      try {
        const T = await readTraining()
        if (!T.ok) out.training.why = T.why
        else {
          const byAx = new Map<string, Any>(); for (const h of T.rows) if (digits(h.axiscare_id)) byAx.set(digits(h.axiscare_id), h)
          for (const c of active) {
            const h = byAx.get(digits(c.axiscare_id)); if (!h) continue
            out.training.matched++
            const tid = T.ids.get(digits(c.axiscare_id)) || ''
            const certs: Record<string, string | null> = {}
            const cert = (slug: string) => (slug in certs ? certs[slug] : null)
            /* only ask for a certificate when a date or proof would be written (a listing per caregiver, not per night for everyone) */
            const dry = syncPatch(c, h, now, () => null); if (!dry) continue
            if (!live.training) { out.training.would_update++; continue }
            for (const slug of ['agency-orientation', 'dementia-care', 'on-the-job-training']) if (tid) certs[slug] = await certificateRef(tid, slug)
            const patch = syncPatch(c, h, now, cert); if (!patch) continue
            const r = await saveAuditFields(db, { ...c, ...patch }, (fresh: Any) => { const again = syncPatch(fresh, h, now, cert); Object.assign(fresh, again || {}) })
            if (r === 'saved') out.training.updated++; else out.training.skipped++
          }
        }
      } catch (e) { out.errors.push('training: ' + String((e as Error)?.message ?? e).slice(0, 160)) }
      /* 2. the monthly OIG re-check with retained results (never a verdict: a match is a review) */
      try {
        const due = active.filter((c) => c.hire_date && (c.first || c.last) && oigDue(c.oig_date, today))
        out.oig.due = due.length
        if (due.length) {
          const leie = await loadLeie()
          const { data: fresh } = await db.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()
          const latest: Any[] = Array.isArray(fresh?.data) ? fresh.data : []
          for (const c0 of due.slice(0, 80)) {
            const c = latest.find((x) => String(x?.id) === String(c0.id)) || c0
            const r = matchLeie(leie, c.first, c.last); out.oig.checked++
            const ev = oigEvidence(r, now)
            if (!live.oig) { if (r.clear) out.oig.clear++; else out.oig.matches++; continue }
            const path = `bgcheck/cg-${c.id}/oig-${Date.now()}-leie-result.json`
            let proof: string | null = null
            try { const up = await db.storage.from('lead-docs').upload(path, new Blob([JSON.stringify({ ...ev, caregiver_id: c.id }, null, 2)], { type: 'application/json' }), { contentType: 'application/json', upsert: false }); if (!up.error) proof = path } catch { proof = null }
            if (r.clear) {
              out.oig.clear++
              const patch: Any = { oig: 'CLEAR', oig_date: today, oig_evidence: ev, ...(proof ? { oig_proof: proof } : {}) }
              const s_ = await saveAuditFields(db, { ...c, ...patch }, (f: Any) => Object.assign(f, patch)); if (s_ === 'saved') out.oig.written++
              await closeCard(db, 'oig_match_' + c.id, 'A later monthly check was clear.')
            } else {
              out.oig.matches++
              const patch: Any = { oig_evidence: ev, ...(proof ? { oig_proof: proof } : {}) }   // the date is NOT moved: the check is not clear until a person reviews it
              const s_ = await saveAuditFields(db, { ...c, ...patch }, (f: Any) => Object.assign(f, patch)); if (s_ === 'saved') out.oig.written++
              await raiseCard(db, { id: 'oig_match_' + c.id, kind: 'oig_match_review', urgency: 'urgent', who: `${c.first || ''} ${c.last || ''}`.trim(), offer_id: String(c.offer_id || ''), title: 'Possible OIG exclusion match: ' + `${c.first || ''} ${c.last || ''}`.trim(), detail: `The monthly LEIE check found ${r.matches.length} name match(es). Nothing was decided: screening staff review the match against date of birth and state, record the result on the record and keep the evidence. Until then the record is not treated as clear.` })
              if (c.offer_id) { const got = await load(db, { offer_id: c.offer_id }); if (got && ['open', 'active'].includes(got.j.status)) { const cur = got.steps.find((x: Any) => x.step_key === 'cg.check.oig'); if (!cur || cur.state !== 'blocked') { await putStep(db, got.j.journey_id, 'cg.check.oig', { state: 'blocked', blocked_reason: 'Possible OIG match on the monthly check: review before anything else moves.', evidence: { ...(cur?.evidence || {}), flagged: { match_count: r.matches.length, at: now } } }); await event(db, got.j.journey_id, 'cg.check.oig', {}, 'blocked', { match_count: r.matches.length, monthly: true }, 'Possible OIG match on the monthly check') } } }
            }
          }
        }
      } catch (e) { out.oig.why = String((e as Error)?.message ?? e).slice(0, 160); out.errors.push('oig: ' + out.oig.why) }
      /* 3. every open and approved card: re-verify, then the expiries as permanent events and owned tasks */
      try {
        const T = trn()
        const { data: persons } = await db.from('persons').select('person_id, full_name, primary_email')
        const { data: domains } = await db.from('domains').select('code, owner_person, entity').eq('entity', 'cc_ihs')
        const emailOf = (pid: unknown) => String((persons || []).find((p: Any) => p.person_id === pid)?.primary_email || '').toLowerCase()
        const nameOf_ = (email: string) => String((persons || []).find((p: Any) => String(p.primary_email || '').toLowerCase() === email)?.full_name || email)
        const dom = (domains || []).find((d: Any) => d.code === 'training_compliance')
        const ownerEmail = (dom?.owner_person ? emailOf(dom.owner_person) : '') || S(st.staffing_email, 160).toLowerCase() || ''
        const { data: js } = await db.from('client_journey').select('*').eq('subject', 'caregiver').in('status', ['open', 'active']).limit(1000)
        for (const j of js ?? []) {
          out.cards.looked_at++
          const { data: steps } = await db.from('client_journey_step').select('*').eq('journey_id', j.journey_id)
          const f = await facts(db, j, T)
          out.cards.changed += await applyVerdicts(db, j, steps ?? [], f, now)
          const { data: fresh } = await db.from('client_journey_step').select('*').eq('journey_id', j.journey_id)
          const view = R.compute(dfs, j, fresh ?? [], ctxFor(f, st))
          const { data: evs } = await db.from('client_journey_event').select('step_key, kind, detail').eq('journey_id', j.journey_id).eq('kind', 'expired')
          for (const r of view.rows || []) {
            const id = 'cj_exp_' + j.journey_id + '_' + r.key.replace(/\./g, '_')
            if (r.expired) {
              const seen = (evs ?? []).some((e: Any) => e.step_key === r.key && e.detail?.until === r.expired)
              if (!seen) { await event(db, j.journey_id, r.key, {}, 'expired', { until: r.expired, title: r.def.title }); out.cards.expired_new++ }
              if (live.audit) {
                const legal = r.def.required !== false && ['screening', 'training', 'ready'].includes(String(r.def.stage))
                await raiseCard(db, { id, kind: 'requirement_expired', urgency: legal ? 'urgent' : 'today', who: j.client_name, offer_id: j.offer_id, title: 'Expired: ' + r.def.title + ' · ' + j.client_name, detail: `Expired on ${r.expired}. ${r.def.howto || 'Record the new result with its proof on their readiness card.'} Owner: ${ownerEmail ? nameOf_(ownerEmail) : 'unassigned'}.` }, ownerEmail ? { owner: ownerEmail, owner_name: nameOf_(ownerEmail), due: r.expired } : { due: r.expired })
                out.cards.tasks_raised++
              }
            } else if (live.audit) { const before = out.cards.tasks_closed; await closeCard(db, id, 'Current again: ' + r.def.title + '.', () => { out.cards.tasks_closed = before + 1 }) }
          }
        }
      } catch (e) { out.errors.push('cards: ' + String((e as Error)?.message ?? e).slice(0, 160)) }
      out.ms = Date.now() - t0
      try { await db.rpc('upsert_app_data_item', { target_key: 'automation_log', item: { id: 'auto_srv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), at: now, automation: 'caregiver_audit', ran_by: 'server', ok: !out.errors.length, dry: !(live.training || live.oig || live.audit), duration_ms: out.ms, summary: { training: out.training, oig: out.oig, cards: out.cards, live }, errors: out.errors.length, error: out.errors.join(' | ') || null } }) } catch (e) { console.error('[caregiver-journey] could not write the run log', e) }
      return json(out)
    }
    if (action === 'sweep') {
      const caller = await jobCaller(req)
      if (!caller) return json({ error: 'the sweep is for the schedule or an owner' }, 401)
      const T = trn(), st = await settings(db), now = new Date().toISOString()
      const { data: js } = await db.from('client_journey').select('*').eq('subject', 'caregiver').eq('status', 'open').limit(500)
      const out: Record<string, unknown> = { looked_at: (js ?? []).length, changed: 0, completed: 0, locks: 0, texts_sent: 0, cards: 0 }
      for (const j of js ?? []) {
        const { data: steps } = await db.from('client_journey_step').select('*').eq('journey_id', j.journey_id)
        const f = await facts(db, j, T)
        const n = await applyVerdicts(db, j, steps ?? [], f, now); (out.changed as number) += n
        const { data: fresh } = await db.from('client_journey_step').select('*').eq('journey_id', j.journey_id)
        const view = R.compute(dfs, j, fresh ?? [], ctxFor(f, st))
        const a = approveState(view, f, st, null, {})
        /* the journey learns its AxisCare number once the roster has it (the lock and the Training report find it by that) */
        const axId = digits(f.roster?.axiscare_id)
        if (axId && !j.axiscare_caregiver_id) { const { error } = await db.from('client_journey').update({ axiscare_caregiver_id: axId, updated_at: now }).eq('journey_id', j.journey_id); if (error) console.warn('[caregiver-journey] axiscare id not saved: ' + error.message) }
        /* the roster's work_lock: true until the stamp and the read-back (the Hub page and the Staffing Sheet read it) */
        if (f.roster && (f.roster.work_lock === true) !== a.locked) { if ((await rosterPatch(db, f.roster, { work_lock: a.locked })) === 'saved') (out.locks as number)++ }
        /* Ready for Final Approval: one card for the Approve to Work list, closed at the press */
        if (a.ready_for_final) { await raiseCard(db, { id: 'cj_final_' + j.journey_id, kind: 'final_approval', urgency: 'today', who: j.client_name, offer_id: j.offer_id, title: 'Ready for final approval: ' + j.client_name, detail: 'Every requirement on their readiness card is complete. An owner on the Approve to Work list opens the card and presses Approve to Work.' }); (out.cards as number)++ }
        /* a cleared text held after hours goes now, in hours, with the switch on */
        if (a.approved && a.axiscare.state === 'confirmed' && a.text?.state === 'due' && st.approve_work_text_live === true && inTextHours()) { const t = await clearedTextStep(db, j, f, st, {}); if (t.state === 'sent') (out.texts_sent as number)++ }
        if (view.complete && j.status === 'open') { await db.from('client_journey').update({ status: 'active', updated_at: now }).eq('journey_id', j.journey_id); await event(db, j.journey_id, null, {}, 'complete', { all: true }); (out.completed as number)++ }
      }
      return json({ ok: true, ...out })
    }
    /* SLICE 5: the Training Platform's report (server door, the same secret its senders already use with outreach-check) */
    if (action === 'training_report') {
      if (!serverSecretOk(req, 'OUTREACH_SECRET', 'x-outreach-secret')) return json({ error: 'server only' }, 401)
      const axId = digits(b.axiscare_id); if (!axId) return json({ error: 'an AxisCare caregiver number is needed' }, 400)
      const courses: Any[] = Array.isArray(b.courses) ? b.courses.slice(0, 12) : []
      const { data: row } = await db.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()
      const roster = (Array.isArray(row?.data) ? row.data : []).find((c: Any) => digits(c?.axiscare_id) === axId)
      if (!roster?.offer_id) return json({ ok: true, journey: false, why: 'no roster record with that AxisCare number carries an offer' })
      const got = await load(db, { offer_id: roster.offer_id }); if (!got || got.j.status !== 'open') return json({ ok: true, journey: false, why: got ? 'their readiness card is closed' : 'no readiness card for that offer' })
      const now = new Date().toISOString(), applied: string[] = []
      for (const c of courses) {
        const key = TRAINING_ROWS[S(c?.slug, 60)]; if (!key) continue
        if (!['complete', 'waived'].includes(S(c?.status, 20))) continue
        const st = got.steps.find((s: Any) => s.step_key === key); if (st && DONE.includes(st.state)) continue
        const at = /^\d{4}-\d{2}-\d{2}/.test(S(c?.completed_at, 30)) ? new Date(S(c.completed_at, 30)).toISOString() : now
        await putStep(db, got.j.journey_id, key, { state: 'complete', evidence: { verified: { at: now, by: 'training-platform' }, course: S(c?.slug, 60), title: S(c?.title, 120), status: S(c?.status, 20), completed_at: at, source: 'Training Platform report' }, completed_by: 'training-platform', completed_by_name: 'The Training Platform (reported)', completed_at: at, blocked_reason: null })
        await event(db, got.j.journey_id, key, { email: 'training-platform', name: 'The Training Platform' }, 'verified', { course: S(c?.slug, 60), completed_at: at, reported: true }); applied.push(key)
      }
      if (!got.j.axiscare_caregiver_id) await db.from('client_journey').update({ axiscare_caregiver_id: axId, updated_at: now }).eq('journey_id', got.j.journey_id)
      return json({ ok: true, journey: true, applied })
    }
    const who = await requireStaff(db, req, OFFICE_ROLES)
    if (!who.ok) return json({ error: who.error }, who.status)
    const P = await perms(db), st = await settings(db), isOwner = (who.roles || []).includes('owner_admin')
    const mayExport = mayApprove(P, 'audit_export', { person_id: who.person_id, roles: who.roles || [], email: who.email })
    if (action === 'list') {
      const T = trn()
      const { data: js } = await db.from('client_journey').select('*').eq('subject', 'caregiver').in('status', ['open', 'active']).order('created_at', { ascending: false }).limit(200)
      const rows = []
      for (const j of js ?? []) {
        const { data: steps } = await db.from('client_journey_step').select('*').eq('journey_id', j.journey_id)
        const f = await facts(db, j, null); const v = R.compute(dfs, j, steps ?? [], ctxFor(f, st)); const a = approveState(v, f, st, who, P)
        rows.push({ journey_id: j.journey_id, offer_id: j.offer_id, name: j.client_name, status: j.status, stage: v.stageLabel, next: v.next ? { key: v.next.key, title: v.next.def.title, owner: v.next.owner, attention: v.next.attention || null } : null, complete: v.complete,
          approved_to_work: a.approved, ready_for_final: a.ready_for_final, axiscare: a.axiscare.state, locked: a.locked, blocked: (v.rows || []).filter((r: Any) => r.status === 'blocked').map((r: Any) => r.def.title) })
      }
      void T; return json({ ok: true, rows, may_approve_work: mayApprove(P, 'work', { person_id: who.person_id, roles: who.roles || [], email: who.email }) })
    }
    const answerFor = async (jid: string, f: Facts) => { const fresh = await load(db, { journey_id: jid }); const v = R.compute(dfs, fresh!.j, fresh!.steps, ctxFor(f, st)); const { data: ev } = await db.from('client_journey_event').select('*').eq('journey_id', jid).order('at', { ascending: false }).limit(200); const may: Record<string, boolean> = {}; for (const r of v.rows) may[r.key] = mayDo(r.def, who, P); return json({ ok: true, journey: fresh!.j, steps: fresh!.steps, view: v, events: ev ?? [], may, is_owner: isOwner, may_export: mayExport, approve: approveState(v, f, st, who, P), facts: { lived_outside_mo: f.lived_outside_mo ?? null, claims_cna_or_hha: f.claims_cna_or_hha ?? null, drives_clients: f.drives_clients ?? null, dates: dates(f) } }) }
    if (action === 'get') {
      const got = await load(db, b); if (!got) return json({ ok: true, journey: null })
      const f = await facts(db, got.j, trn())
      return await answerFor(got.j.journey_id, f)
    }
    const got = await load(db, b); if (!got) return json({ error: 'That readiness card was not found.' }, 404)
    const f = await facts(db, got.j, trn()); const view = R.compute(dfs, got.j, got.steps, ctxFor(f, st))
    const now = new Date().toISOString(), actor = { email: who.email, name: who.name }
    /* SLICE 5: the owner's press */
    if (action === 'approve_work') {
      if (!mayApprove(P, 'work', { person_id: who.person_id, roles: who.roles || [], email: who.email })) return json({ error: 'Only a person on the Approve to Work list (owners) may approve to work.' }, 403)
      const a = approveState(view, f, st, who, P)
      if (a.approved) return json({ error: 'Already approved to work' + (a.axiscare.state === 'failed' ? '; the AxisCare update failed. Press Retry.' : '.') }, 409)
      if (a.blocked.length) return json({ error: 'Not yet: ' + a.blocked.join('; ') + ' is blocked. Nothing was approved.' }, 409)
      const aw = view.rows.find((r: Any) => r.key === WORK_KEY)
      if (!aw) return json({ error: 'Approve to Work does not apply to this card.' }, 400)
      if (!['ready', 'attention'].includes(aw.status)) return json({ error: 'Not yet: ' + (aw.why || 'earlier requirements first') + '. Nothing was approved.' }, 409)
      await putStep(db, got.j.journey_id, WORK_KEY, { state: 'complete', evidence: { confirmed: { by: who.email, name: who.name, at: now, list: 'work' }, level_of_care: a.level_of_care.level }, completed_by: who.email, completed_by_name: who.name, completed_at: now })
      await event(db, got.j.journey_id, WORK_KEY, actor, 'approved_to_work', { list: 'work', level_of_care: a.level_of_care.level, at: now })
      await rosterPatch(db, f.roster, { approved_to_work_at: now, approved_to_work_by: who.email })
      const r = await activate(db, got.j, f, st, actor)
      const res = await answerFor(got.j.journey_id, f); const body = await res.json()
      return json({ ...body, result: r })
    }
    if (action === 'retry_axiscare') {
      const a = approveState(view, f, st, who, P)
      if (!a.approved) return json({ error: 'Approve to Work first.' }, 409)
      if (a.axiscare.state === 'confirmed') return json({ error: 'AxisCare already reads back Active.' }, 409)
      await event(db, got.j.journey_id, AX_KEY, actor, 'axiscare_retry', {})
      const r = await activate(db, got.j, f, st, actor)
      const res = await answerFor(got.j.journey_id, f); const body = await res.json()
      return json({ ...body, result: r })
    }
    const key = S(b.step_key, 60); const def = dfs.find((d) => d.key === key)
    if (!def) return json({ error: 'Which requirement?' }, 400)
    const row = view.rows.find((r: Any) => r.key === key)
    const answer = () => answerFor(got.j.journey_id, f)
    if (action === 'not_needed') {
      if (!isOwner) return json({ error: 'Only an owner may mark a requirement not needed.' }, 403)
      if (key === WORK_KEY || key === AX_KEY) return json({ error: 'Approve to Work and the AxisCare read-back are never marked not needed.' }, 400)
      const reason = S(b.reason, 300); if (reason.length < 5) return json({ error: 'Please give the reason (at least five characters).' }, 400)
      if (row && DONE.includes(row.status)) return json({ error: 'That requirement is already settled.' }, 409)
      await putStep(db, got.j.journey_id, key, { state: 'not_needed', completed_by: who.email, completed_by_name: who.name, completed_at: now, exception: { kind: 'not_needed', reason, by: who.email, at: now } })
      await event(db, got.j.journey_id, key, actor, 'not_needed', { by: who.email }, reason)
      return await answer()
    }
    if (!row) return json({ error: 'That requirement does not apply to this person.' }, 400)
    if (!mayDo(def, who, P)) return json({ error: def.permission === 'work' ? 'Only a person on the Approve to Work list (owners) may approve to work.' : def.permission === 'advance' ? 'Only a person on the Approve to Advance list may approve this.' : def.permission === 'screening' ? 'Only a person on the Screening staff list may record this.' : 'The Hub verifies this one on its own; nobody confirms it by hand.' }, 403)
    if (action === 'confirm') {
      if (key === WORK_KEY) return json({ error: 'Approve to Work has its own button: it also updates AxisCare and reads it back.' }, 400)
      if (def.proof !== 'confirmed') return json({ error: 'That requirement is verified from the records or needs a document, not a confirmation.' }, 400)
      if (!['ready', 'attention'].includes(row.status)) return json({ error: row.status === 'later' ? 'Not yet: ' + (row.why || 'earlier requirements first') + '.' : DONE.includes(row.status) ? 'Already settled.' : 'This requirement is ' + row.status + '.' }, 409)
      await putStep(db, got.j.journey_id, key, { state: 'complete', evidence: { confirmed: { by: who.email, name: who.name, at: now, list: def.permission } }, completed_by: who.email, completed_by_name: who.name, completed_at: now })
      await event(db, got.j.journey_id, key, actor, 'confirmed', { list: def.permission })
      return await answer()
    }
    if (action === 'record') {
      if (def.proof !== 'proof') return json({ error: 'That requirement is not recorded with a document.' }, 400)
      const result = S(b.result, 80), doc = S(b.document, 400), expires = /^\d{4}-\d{2}-\d{2}$/.test(S(b.expires, 10)) ? S(b.expires, 10) : null
      if (!result || !doc) return json({ error: 'A result and its document are both required. Nothing was saved.' }, 400)
      await putStep(db, got.j.journey_id, key, { state: 'complete', evidence: { ...(row.st?.evidence || {}), result, document: doc, expires: expires, recorded: { by: who.email, name: who.name, at: now } }, completed_by: who.email, completed_by_name: who.name, completed_at: now })
      await event(db, got.j.journey_id, key, actor, 'evidence_added', { result, document: doc, expires })
      return await answer()
    }
    return json({ error: 'Unknown action.' }, 400)
  } catch (e) {
    return json({ error: 'Something went wrong: ' + ((e as Error).message || 'error') + '. Nothing was changed.' }, 500)
  }
})
