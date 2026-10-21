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
//   { action: 'approve_work', journey_id }     (Approve to Work list ONLY)  refused until every REQUIRED row is complete (2026-10-13:
//                                                          all of them, re-checked at the press, with the list of what is missing) and no
//                                                          row is blocked; records who and the exact time; sets the caregiver
//                                                          Active in AxisCare (approve_work_axiscare_live, else practice) and
//                                                          reads it back; Approved to Work shows only after the read-back;
//                                                          then the cleared text (approve_work_text_live, else practice)
//   { action: 'retry_axiscare', journey_id }   (staff)   after "Approval recorded, AxisCare update failed": the same update again
//   { action: 'copy_sheet', journey_id, which: 'attributes' | 'availability' }  (staff)  SLICE 7: the Step 1 answers laid out
//                                                          in AxisCare's order, for the office to type in (AxisCare has no door)
//   SLICE 7: after AxisCare reads back Active, the hire date (orientation completion) and the approved Level of Care class are
//   written once each, read back and logged (axiscare_hire_date_live, axiscare_level_live; else practice); retry redoes them.
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
import { R, facts, verifyRows, rightsState, type Facts } from '../_shared/caregiver-journey.ts'
import { setCaregiverActive, setCaregiverHireDate, setCaregiverLevel } from '../_shared/axiscare-caregiver.ts'
import { dueNextBusinessDay } from '../_shared/business-days.ts'
import { saveSweepFields } from '../_shared/sweep-patch.ts'
import { ghlContactIfAllowed } from '../_shared/optout.ts'
import { ghlSendChecked } from '../_shared/send-problems.ts'
import { latestTextConsent, inTextHours, withStop } from '../_shared/text-consent.ts'
import { saveAuditFields } from '../_shared/sweep-patch.ts'
import { loadLeie, matchLeie, oigEvidence, oigDue, OIG_INTERVAL_DAYS } from '../_shared/oig-leie.ts'
import { advanceDue, oigWanted, oigItemId, ADV_KEY } from '../_shared/onboarding-auto.ts'   /* 2026-10-21 onboarding design */
import { autoAskSlots, requestRow } from '../_shared/ref-auto-ask.ts'   /* 2026-10-21 references asked by themselves */
import { DUTIES, validateEvidence, verifiedLevel, claimedFrom, evidenceFromReference } from '../_shared/care-level-verify.ts'   /* 2026-10-21 Level of Care */
import { readTraining, certificateRef, syncPatch } from '../_shared/training-sync.ts'
import { testPerson } from '../_shared/test-people.ts'
/* LPN HIRING (Samantha approved the LPN nurse visit plan, 2026-10-14): the nurse rows, the nurse forms, the nurse setup at Approve to Work */
import { NURSE_SWITCH, NURSE_RECORDED, NURSE_DOC_KINDS, ORIENTATION_TOPICS, SUPERVISING_RN_NAME, WAIVED_COURSES, KEPT_COURSES, licenseVerdict, orientationVerdict, section2Verdict, section2Statement, orientationChecklist, nurseDocPdf, nurseStaffRecord, setCaregiverNurseClass, waiverReason, nurseDocOk, packetLine } from '../_shared/nurse-hire.ts'
import { validKey, POSITION_LABELS } from '../_shared/positions.ts'
import { logOpen } from '../_shared/doc-log.ts'

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
  return { async get(id: string) { const r = await fetch(`${url}/rest/v1/job_offers?id=eq.${encodeURIComponent(id)}&select=id,first_name,last_name,phone,email,offer_signed_at,pd_signed_at,offer_version,pd_version,offer_status,onboarding_path,step1_done_at,step1_sent_at,step1_reminded_at,step1_reminder_count,offer_withdrawn_at,offer_declined_at,position_key`, { headers: H }); if (!r.ok) return null; const rows = await r.json(); return Array.isArray(rows) && rows.length === 1 ? rows[0] : null } }
}
async function defs(db: Any): Promise<Any[]> {
  const { data, error } = await db.from('client_journey_step_def').select('key, def, active, catalog_version').like('key', 'cg.%')
  if (error) throw new Error('could not read the caregiver catalog')
  /* RETIRED ROWS (2026-10-21): fingerprints are gone and the dementia course is optional. The 1031 SQL changes the catalog; the
     code says the same, so a card never waits for either whether or not that SQL has run. */
  return (data ?? []).filter((d: Any) => d.active !== false && !RETIRED.has(d.key)).map((d: Any) => {
    const x = { key: d.key, active: d.active, ...(d.def || {}) }
    if (x.key === 'cg.training.dementia') x.required = false
    if (Array.isArray(x.after)) x.after = x.after.filter((k: string) => !RETIRED.has(k) && !(k === 'cg.training.dementia' && ['cg.approve.work', 'cg.approve.advance'].includes(x.key)))
    return x
  })
}
const RETIRED = new Set(['cg.check.fingerprints'])
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
const ctxFor = (f: Facts, st: Any) => ({ today: new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10), facts: { lived_outside_mo: f.lived_outside_mo, claims_cna_or_hha: f.claims_cna_or_hha, drives_clients: f.drives_clients, after_first_year: f.after_first_year, licensed_nurse: f.licensed_nurse }, staffing_email: S(st?.staffing_email, 160).toLowerCase() || null, owner_emails: [] })
const dates = (f: Facts) => { const o = f.roster?.orient_date ? String(f.roster.orient_date).slice(0, 10) : null, h = f.roster?.hire_date ? String(f.roster.hire_date).slice(0, 10) : null; return { orientation: o, axiscare_hire: h, differ: !!(o && h && o !== h) } }

/* ── the Needs Attention cards (ops_items), raised and closed by the readiness server; a card a person closed stays closed ── */
async function raiseCard(db: Any, c: { id: string; kind: string; title: string; detail: string; who: string; offer_id: string; urgency: 'urgent' | 'today' | 'normal' }, extra: { owner?: string; owner_name?: string; due?: string; domain?: string } = {}) {
  try {
    const now = new Date().toISOString()
    const { data: row } = await db.from('app_data').select('data').eq('key', 'ops_items').maybeSingle()
    const items: Any[] = Array.isArray(row?.data) ? row.data : []
    const prev = items.find((x) => x && x.id === c.id)
    const isOpen = (x: Any) => x && x.status !== 'done' && x.status !== 'resolved'
    if (prev && !isOpen(prev)) return
    const item = { ...(prev && isOpen(prev) ? prev : { owner: extra.owner || '', owner_name: extra.owner_name || '', created_at: now, first_at: now }), id: c.id, kind: c.kind, domain: extra.domain || (c.kind === 'requirement_expired' ? 'training_compliance' : 'caregivers'), status: 'open', urgency: c.urgency,
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

/* GO-LIVE GATE (2026-10-13, her rule "Applicants cannot be approved to work with incomplete required steps"): a row the Hub
   verifies from a record is never written complete before the rows the catalog puts in front of it (def.after) are done
   (orientation from a roster date waits for the Orientation Video Call, a check waits for the signed consents). A row in
   front that does not apply to this person (fingerprints for someone who never lived outside Missouri) does not hold it. */
function waitingFor(key: string, dfs: Any[], state: Record<string, string>, appl: (d: Any) => boolean): string[] {
  const def = dfs.find((d) => d.key === key); if (!def) return []
  return (Array.isArray(def.after) ? def.after : []).filter((k: string) => { const d = dfs.find((x) => x.key === k); return d && appl(d) && !DONE.includes(state[k] || '') })
}
/** Apply the verdicts the facts give: complete or blocked rows, with evidence and events; never un-complete a confirmed row. */
async function applyVerdicts(db: Any, j: Any, steps: Any[], f: Facts, now: string, dfs: Any[] = [], ctx: Any = null): Promise<number> {
  const by = Object.fromEntries(steps.map((s) => [s.step_key, s])); let changed = 0
  const state: Record<string, string> = Object.fromEntries(steps.map((s) => [s.step_key, s.state]))
  const appl = (d: Any) => ctx ? R.applies(d, j, ctx) : !d.applies
  const sortOf = (k: string) => Number(dfs.find((d) => d.key === k)?.sort ?? 0)
  for (const v of verifyRows(f, now).sort((a, b) => sortOf(a.key) - sortOf(b.key))) {
    const st = by[v.key]
    if (v.state === 'complete') {
      const newer = st?.state === 'complete' && st.completed_at && v.at && Date.parse(v.at) > Date.parse(st.completed_at) + 60000
      if (st && DONE.includes(st.state) && !newer) continue
      if (v.key === AX_KEY && st?.state === 'blocked') continue   // the AxisCare row is settled by the approval path, never by a stale roster flag
      if (!(st && DONE.includes(st.state)) && waitingFor(v.key, dfs, state, appl).length) continue   // not before the rows in front of it
      await putStep(db, j.journey_id, v.key, { state: 'complete', evidence: { verified: { at: now, by: 'hub' }, ...v.evidence }, completed_by: 'hub', completed_by_name: 'The Hub (verified)', completed_at: v.at, blocked_reason: null })
      await event(db, j.journey_id, v.key, {}, newer ? 'reverified' : 'verified', v.evidence); changed++; state[v.key] = 'complete'
    } else if (v.state === 'blocked') {
      if (st && (st.state === 'blocked' || DONE.includes(st.state))) continue
      await putStep(db, j.journey_id, v.key, { state: 'blocked', blocked_reason: v.reason, evidence: { ...(st?.evidence || {}), flagged: v.evidence } })
      await event(db, j.journey_id, v.key, {}, 'blocked', v.evidence, v.reason || null); changed++; state[v.key] = 'blocked'
    }
  }
  return changed
}

/* GO-LIVE GATE (2026-10-13, her rule: "Applicants cannot be approved to work with incomplete required steps"): Ready for Final
   Approval and the Approve to Work press need EVERY row the catalog marks required for this person to be settled (complete,
   not needed by an owner, or an owner exception), not only the rows Approve to Work lists as "after". Left out: Approve to
   Work itself and every row that waits on it (AxisCare Active, the hire date, the level class), and the two training rows
   that by her cited rule follow employment: On-the-Job Skills Training (within 30 days of employment, Samantha 2026-10-01)
   and the annual in-service (after year one). A row whose "applies" fact is not yet known (Step 1 not answered) counts as
   missing: it is never assumed not to apply. */
const AFTER_EMPLOYMENT = new Set(['cg.training.ojt', 'cg.training.annual'])
function followsWork(key: string, dfs: Any[], seen = new Set<string>()): boolean {
  if (key === WORK_KEY) return true
  if (seen.has(key)) return false; seen.add(key)
  const d = dfs.find((x) => x.key === key)
  return (Array.isArray(d?.after) ? d.after : []).some((k: string) => followsWork(k, dfs, seen))
}
export function missingForWork(view: Any, dfs: Any[], j: Any, ctx: Any): string[] {
  const out: string[] = []
  const skip = (key: string) => key === WORK_KEY || key === AX_KEY || AFTER_EMPLOYMENT.has(key) || followsWork(key, dfs)
  for (const r of view?.rows || []) {
    if (r.def?.required === false || skip(r.key)) continue
    if (!DONE.includes(r.status)) out.push(r.def.title + (r.status === 'blocked' ? ' (blocked)' : r.expired ? ' (expired ' + r.expired + ')' : ''))
  }
  const facts = (ctx && ctx.facts) || {}
  for (const d of dfs) {
    if (d.required === false || d.active === false || skip(d.key) || (d.subject || 'client') !== 'caregiver' || !d.applies || typeof d.applies !== 'object') continue
    const unknown = Object.keys(d.applies).filter((k) => facts[k] !== true && facts[k] !== false)
    if (unknown.length) out.push(d.title + ' (not known yet whether it applies: their Step 1 answer is missing)')
  }
  return out
}

/* ── Level of Care: what is claimed, verified and approved for this person (her design of 2026-10-08) ── */
async function levelState(db: Any, j: Any, f: Facts): Promise<Any> {
  const { data: ev } = await db.from('caregiver_level_evidence').select('id, level, kind, source, who, duties, date_from, date_to, credential, proof, note, ref_request_id, by_email, by_name, at').eq('offer_id', String(j.offer_id)).order('at', { ascending: true })
  const evidence = (ev ?? []).map((e: Any) => ({ id: e.id, level: e.level, kind: e.kind, source: e.source, who: e.who, duties: e.duties || [], from: e.date_from, to: e.date_to, credential: e.credential || null, proof: e.proof, note: e.note, ref_request_id: e.ref_request_id || null, by: e.by_name || e.by_email, at: e.at,
    date_from: e.date_from, date_to: e.date_to }))
  const rec = f.candidate || f.roster || {}
  const al = Number(String(rec.care_level_approved ?? '').replace(/\D/g, ''))
  const approved = al >= 1 && al <= 3 ? { level: al, by: rec.care_level_by || null, at: rec.care_level_at || null, note: rec.care_level_note || null, default: false }
    : { level: 1, by: null, at: null, note: 'Everyone starts at Level 1 until a higher level is verified and approved.', default: true }
  return { claimed: claimedFrom(f.step1?.answers, f.offer), evidence: evidence.map(({ date_from: _a, date_to: _b, ...x }: Any) => x), verified_level: verifiedLevel(evidence), approved }
}
/** the care_level_* fields only, through the server's own door (level_patch), only if nobody changed the record since it was read */
async function levelPatch(db: Any, key: string, rec: Any, fields: Any, tries = 3): Promise<'saved' | 'skipped' | 'error'> {
  let cur = rec
  for (let i = 0; i < tries; i++) {
    const r = (x: Any) => (/^[0-9]{1,15}$/.test(String(x?._rev ?? '')) ? Number(x._rev) : 0)
    const { data, error } = await db.rpc('level_patch', { p_key: key, p_id: String(cur.id), p_base_rev: r(cur), p_patch: fields })
    if (error) return 'error'
    if (data?.ok) return 'saved'
    if (data?.reason !== 'changed' || !data.current_record) return 'skipped'
    cur = data.current_record
  }
  return 'skipped'
}

/* ── SLICE 5: the approval state the card and the lists read ── */
function approveState(view: Any, f: Facts, st: Any, who: Any, P: Any, dfs: Any[] = [], j: Any = null) {
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
  const missing = approved ? [] : missingForWork(view, dfs, j, ctxFor(f, st))
  const ready_for_final = !approved && !!aw && ['ready', 'attention'].includes(aw.status) && !blocked.length && !missing.length
  const lvl = f.candidate?.care_level_approved ?? f.roster?.care_level_approved ?? null
  const prepOf = (key: string) => { const r = rows.find((x) => x.key === key); if (!r) return { state: 'n/a' }; const e = r.st?.evidence || {}; return r.st && DONE.includes(r.st.state) ? { state: 'confirmed', at: r.st.completed_at, read: e.read ?? null, unchanged: !!e.unchanged } : r.st?.state === 'blocked' ? { state: 'failed', detail: r.st.blocked_reason } : e.practice ? { state: 'practice', at: e.practice.at } : { state: 'pending' } }
  return {
    ready_for_final, approved, approved_at: approved ? aw.st.completed_at : null, approved_by: approved ? (aw.st.completed_by_name || aw.st.completed_by) : null,
    prep: { hire_date: prepOf('cg.axiscare.hire_date'), level: prepOf('cg.axiscare.level') },
    axiscare, text: aw?.st?.evidence?.text || null, blocked, missing,
    locked: !(approved && axDone), lock_why: !(approved && axDone) ? 'Scheduling stays locked until Approved to Work and AxisCare reads back Active.' : null,
    level_of_care: lvl ? { level: String(lvl), source: 'recorded on the Background and References row' } : { level: 'Level 1', source: 'the default: nothing higher is recorded' },
    may_approve_work: !!who && mayApprove(P, 'work', { person_id: who.person_id, roles: who.roles || [], email: who.email }),
    may_retry: approved && !axDone,
    switches: { axiscare_live: st?.approve_work_axiscare_live === true, text_live: st?.approve_work_text_live === true, hire_date_live: st?.axiscare_hire_date_live === true, level_live: st?.axiscare_level_live === true },
  }
}
const nameOf = (f: Facts, j: Any) => S(f.offer?.first_name || f.roster?.first || f.candidate?.first || String(j?.client_name || '').split(' ')[0], 40)

/** The cleared text, after the read-back: sent in hours with the switch on; held ('due') after hours; recorded ('practice') with the switch off. */
async function clearedTextStep(db: Any, j: Any, f: Facts, st: Any, who: { email?: string; name?: string }, send: typeof fetch = fetch): Promise<Any> {
  const now = new Date().toISOString(), first = nameOf(f, j), words = clearedText(first)
  const phone = S(f.roster?.phone || f.offer?.phone, 40), email = S(f.roster?.email || f.offer?.email, 160)
  let text: Any
  if (st?.approve_work_text_live !== true && !testPerson(st, { phone, email })) { text = { state: 'practice', at: now, words }; await event(db, j.journey_id, WORK_KEY, who, 'cleared_text_practice', { words, phone_on_file: !!phone }) }
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

/* ── SLICE 7: after AxisCare reads back Active, the hire date and the approved level class, each written once, read back, logged ── */
const levelNumber = (lvl: unknown) => { const m = String(lvl ?? '').match(/([123])/); return m ? Number(m[1]) : 1 }
async function prepAxis(db: Any, j: Any, f: Facts, st: Any, who: { email?: string; name?: string }, axId: string, send: typeof fetch = fetch): Promise<Any> {
  const now = new Date().toISOString(), out: Any = {}
  const settle = async (key: string, r: Any, evidence: Any, failTitle: string) => {
    if (r.outcome === 'confirmed' || r.outcome === 'unchanged') {
      await putStep(db, j.journey_id, key, { state: 'complete', evidence: { verified: { at: now, by: 'hub' }, ...evidence, read: r.read ?? null, unchanged: r.outcome === 'unchanged', recorded: !!r.recorded }, completed_by: 'hub', completed_by_name: 'The Hub (AxisCare read back)', completed_at: now, blocked_reason: null })
      await event(db, j.journey_id, key, who, 'verified', { ...evidence, read: r.read ?? null, unchanged: r.outcome === 'unchanged' })
      await closeCard(db, 'cj_prep_' + key.replace(/\./g, '_') + '_' + j.journey_id, 'AxisCare read it back.')
    } else if (r.outcome === 'practice') {
      await mergeEvidence(db, j.journey_id, key, { practice: { at: now, by: who.email || 'hub', recorded: !!r.recorded } })
      await event(db, j.journey_id, key, who, 'axiscare_practice', { ...evidence, why: 'the switch is off: nothing was written to AxisCare' })
    } else {
      const reason = failTitle + ': ' + (r.detail || r.outcome)
      await putStep(db, j.journey_id, key, { state: 'blocked', blocked_reason: reason })
      await event(db, j.journey_id, key, who, 'axiscare_failed', { ...evidence, detail: r.detail || r.outcome }, reason)
      await raiseCard(db, { id: 'cj_prep_' + key.replace(/\./g, '_') + '_' + j.journey_id, kind: 'axiscare_prep_failed', urgency: 'today', who: j.client_name, offer_id: j.offer_id, title: failTitle + ': ' + j.client_name, detail: (r.detail || r.outcome) + ' Open their readiness card and press Retry, or set it in AxisCare by hand and press Retry to read it back.' })
    }
    return r.outcome
  }
  /* the hire date = orientation completion (decision 7) */
  const d = dates(f)
  if (d.orientation) {
    const r = await setCaregiverHireDate(db, axId, d.orientation, who.email || 'hub', 'caregiver-journey', st?.axiscare_hire_date_live === true, send)
    out.hire_date = await settle('cg.axiscare.hire_date', r, { axiscare_id: axId, hire_date: d.orientation }, 'AxisCare hire date not set')
    if (r.outcome === 'confirmed' || r.outcome === 'unchanged') { if (f.roster && f.roster.hire_date !== d.orientation) await saveAuditFields(db, { ...f.roster, hire_date: d.orientation }, (fresh: Any) => { fresh.hire_date = d.orientation }); await closeCard(db, 'cj_hiredate_' + j.journey_id, 'AxisCare hire date now matches orientation completion.') }
    else if (r.outcome === 'practice') { const axHire = (r.read as string | null) || f.roster?.hire_date || null; if (axHire && axHire !== d.orientation) { await event(db, j.journey_id, AX_KEY, who, 'hire_date_differs', { axiscare_hire_date: axHire, orientation: d.orientation }); await raiseCard(db, { id: 'cj_hiredate_' + j.journey_id, kind: 'hire_date_check', urgency: 'today', who: j.client_name, offer_id: j.offer_id, title: 'Hire date differs from orientation: ' + j.client_name, detail: `AxisCare hire date ${axHire}; orientation completed ${d.orientation} (the employment start date by policy). The write switch is off, so nothing was written; reconcile in AxisCare or turn the switch on and press Retry.` }) } }
  } else out.hire_date = 'no_orientation_date'
  /* the approved Level of Care class */
  const lvl = levelNumber(f.candidate?.care_level_approved ?? f.roster?.care_level_approved ?? 'Level 1')
  const r2 = await setCaregiverLevel(db, axId, lvl, who.email || 'hub', 'caregiver-journey', st?.axiscare_level_live === true, send)
  out.level = await settle('cg.axiscare.level', r2, { axiscare_id: axId, level: lvl, classes: r2.classes ?? null }, 'AxisCare level class not set')
  return out
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
    const prep = await prepAxis(db, j, f, st, who, axId, send)
    const text = await clearedTextStep(db, j, f, st, who, send)
    return { outcome: 'confirmed', label: r.label, text, prep }
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

/** the person who owns an Admin domain (Admin page, Domains), as an email and a name; empty when unowned */
async function domainOwner(db: Any, code: string): Promise<{ email: string; name: string }> {
  try {
    const { data: d } = await db.from('domains').select('owner_person').eq('entity', 'cc_ihs').eq('code', code).maybeSingle()
    if (!d?.owner_person) return { email: '', name: '' }
    const { data: p } = await db.from('persons').select('full_name, primary_email').eq('person_id', d.owner_person).maybeSingle()
    return { email: S(p?.primary_email, 160).toLowerCase(), name: S(p?.full_name, 80) }
  } catch { return { email: '', name: '' } }
}
/** GO-LIVE GATE (2026-10-13): the stalled Step 1 card (see the sweep). Returns what it did. */
export async function step1Stall(db: Any, j: Any, f: Facts, st: Any, owner: { email: string; name: string }, now: string): Promise<'raised' | 'closed' | 'none'> {
  const id = 'cj_step1stall_' + j.journey_id, o = f.offer
  if (f.step1?.completed_at || o?.step1_done_at) { await closeCard(db, id, 'Step 1 is complete.'); return 'closed' }
  if (!o) return 'none'
  if (o.offer_withdrawn_at || o.offer_declined_at || ['withdrawn', 'declined', 'expired'].includes(String(o.offer_status || ''))) { await closeCard(db, id, 'The offer is closed.'); return 'closed' }
  if ((o.onboarding_path && o.onboarding_path !== 'new') || !o.step1_sent_at) return 'none'
  const second = Number(o.step1_reminder_count || 0) >= 2 && o.step1_reminded_at
  const anchor = second ? String(o.step1_reminded_at) : new Date(Date.parse(String(o.step1_sent_at)) + 4 * 86400000).toISOString()
  if (!Number.isFinite(Date.parse(anchor))) return 'none'
  const due = dueNextBusinessDay(anchor, st?.company_holidays, 17, 2)
  if (due >= now) return 'none'
  await raiseCard(db, { id, kind: 'step1_stalled', urgency: 'today', who: j.client_name, offer_id: j.offer_id, title: 'Step 1 not finished: call ' + j.client_name,
    detail: `Their Step 1 link went ${String(o.step1_sent_at).slice(0, 10)}${second ? ` and the second reminder went ${String(o.step1_reminded_at).slice(0, 10)}` : ' and no second reminder was recorded'}; two business days later Step 1 is still not finished, so background checks and references cannot start. Call them, help them finish, then record what you learn. This card closes on its own when Step 1 is complete.` },
    { owner: owner.email, owner_name: owner.name, due: due.slice(0, 10), domain: 'recruiting_orientation' })
  return 'raised'
}

/* ───── LPN HIRING (Samantha approved the LPN nurse visit plan, 2026-10-14) ─────
   At Approve to Work for an LPN or RN (the offer's position key): the nurse list record (Natasha Early as the supervising RN for
   an LPN), the AxisCare LPN or RN class, the card for the license in AxisCare's Compliance tab (AxisCare has no door for it),
   and the training waiver (the On-the-Job Skills Training only; 19 CSR 15-7.021(22)(A)4). Only with the Admin switch
   nurse_hire_live on; off = practice: what would be done is computed and shown on the card, nothing is written anywhere. Never
   for a caregiver: every step checks the offer's own position key again. Idempotent: "Run nurse setup" redoes what is missing. */
const TRAINING_JOB_OFFER = 'https://rdqujxiycycwhskyvrwa.supabase.co/functions/v1/job-offer'
async function trainingWaive(offerId: string, axId: string, reason: string, send: typeof fetch = fetch): Promise<Any> {
  const secret = Deno.env.get('OUTREACH_SECRET') ?? ''
  if (secret.length < 32) return { ok: false, why: 'the server secret is not set' }
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 10000)
    const r = await send(TRAINING_JOB_OFFER, { method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json', 'x-outreach-secret': secret }, body: JSON.stringify({ action: 'nurse_waive', offer_id: offerId, axiscare_id: axId, reason }) })
    clearTimeout(t); const j = await r.json().catch(() => ({}))
    return r.ok && j?.ok ? { ok: true, waived: j.waived || [], kept: j.kept || [], already: j.already || [] } : { ok: false, why: S(j?.error, 200) || 'the Training Platform answered ' + r.status }
  } catch (e) { return { ok: false, why: S((e as Error)?.message, 120) || 'could not reach the Training Platform' } }
}
export async function nurseSetup(db: Any, j: Any, f: Facts, st: Any, who: { email?: string; name?: string }, send: typeof fetch = fetch): Promise<Any> {
  const now = new Date().toISOString(), live = st?.[NURSE_SWITCH] === true, key = validKey(f.offer?.position_key)
  if (!f.offer || (key !== 'lpn' && key !== 'rn')) return { state: 'not_a_nurse' }
  const cred = key === 'rn' ? 'RN' : 'LPN', axId = digits(f.roster?.axiscare_id)
  const { data: lic } = await db.from('client_journey_step').select('state, evidence').eq('journey_id', j.journey_id).eq('step_key', 'cg.credential.nurse_license').maybeSingle()
  const ev = lic?.state === 'complete' ? (lic.evidence || {}) : null
  const out: Any = { state: live ? 'live' : 'practice', at: now, by: who.email || 'hub', cred }
  if (!ev) { out.state = 'waiting'; out.why = 'the nursing license row is not complete'; await mergeEvidence(db, j.journey_id, WORK_KEY, { nurse_setup: out }); return out }
  const name = S(j.client_name, 80), email = S(f.offer?.email || f.roster?.email, 160)
  /* 1. the nurse list */
  const { data: nsRow } = await db.from('app_data').select('data').eq('key', 'nurse_staff').maybeSingle()
  const staff: Any[] = Array.isArray(nsRow?.data) ? nsRow.data : []
  const ns = nurseStaffRecord(staff, { offerId: String(j.offer_id), name, email, positionKey: key, licenseEvidence: ev, at: now, by: who.email || 'hub' })
  out.nurse_list = { would: ns.existing ? 'update' : 'add', name: ns.record.name, cred, license: ns.record.license, expires: ns.record.expires, supervisor: ns.supervisor ? ns.supervisor.name : null, problems: ns.problems }
  if (live) { const { error } = await db.rpc('upsert_app_data_item', { target_key: 'nurse_staff', item: ns.record }); out.nurse_list.state = error ? 'failed' : 'saved'; if (error) out.nurse_list.why = S(error.message, 160) }
  else out.nurse_list.state = 'practice'
  /* 2. the AxisCare class */
  const cls = await setCaregiverNurseClass(db, axId, cred as 'LPN' | 'RN', who.email || 'hub', 'caregiver-journey', live, send)
  out.axiscare_class = { outcome: cls.outcome, detail: cls.detail || null }
  /* 3. the training waiver (the Hub row and the Training Platform's enrollment) */
  const reason = waiverReason(cred, S(ev.license_last4, 4), S(ev.checked_on, 10), S(ev.by_name || ev.by, 80))
  out.waiver = { courses: [...WAIVED_COURSES], kept: [...KEPT_COURSES], reason }
  if (live) {
    const { data: ojt } = await db.from('client_journey_step').select('state').eq('journey_id', j.journey_id).eq('step_key', 'cg.training.ojt').maybeSingle()
    if (!ojt || !DONE.includes(ojt.state)) { await putStep(db, j.journey_id, 'cg.training.ojt', { state: 'not_needed', completed_by: who.email || 'hub', completed_by_name: who.name || 'The Hub', completed_at: now, exception: { kind: 'waived', rule: '19 CSR 15-7.021(22)(A)4', reason, by: who.email || 'hub', at: now } }); await event(db, j.journey_id, 'cg.training.ojt', who, 'not_needed', { waived: true, rule: '19 CSR 15-7.021(22)(A)4' }, reason) }
    const tw = axId ? await trainingWaive(String(j.offer_id), axId, reason, send) : { ok: false, why: 'no AxisCare caregiver number on their roster record yet' }
    out.waiver.training = tw
  } else out.waiver.training = { practice: true }
  /* 4. the cards: what the office does by hand (AxisCare has no door for the Compliance tab), and anything that did not go */
  if (live) {
    const lines = [`License type ${cred}, number ending ${S(ev.license_last4, 4) || '(see their readiness card)'}, state ${S(ev.state, 2) || '?'}${ev.multistate ? ' (multistate)' : ''}, expires ${S(ev.expires, 10)}.`]
    if (!['confirmed', 'unchanged'].includes(cls.outcome)) lines.push(`Also set the ${cred} class on their AxisCare caregiver record: the Hub could not (${cls.detail || cls.outcome}).`)
    if (ns.problems.length) lines.push('Nurse list: ' + ns.problems.join('; ') + '.')
    if (out.nurse_list.state === 'failed') lines.push('Nurse list: the record could not be saved (' + out.nurse_list.why + '). Add them on the Nurse Scheduling tab.')
    if (out.waiver.training && out.waiver.training.ok === false) lines.push('Training Platform: the On-the-Job Skills Training waiver did not go (' + out.waiver.training.why + '). Record the waiver on their Training record by hand.')
    await raiseCard(db, { id: 'cj_nurse_' + j.journey_id, kind: 'nurse_setup', urgency: 'today', who: j.client_name, offer_id: j.offer_id, title: `Enter ${name}'s nursing license in AxisCare (Compliance tab)`, detail: lines.join('\n') + '\nAxisCare has no door for licenses, so the office types it in. Close this card when it is in.' }, { owner: S(st?.staffing_email, 160).toLowerCase() || '' })
    out.compliance_card = 'cj_nurse_' + j.journey_id
  }
  await mergeEvidence(db, j.journey_id, WORK_KEY, { nurse_setup: out })
  await event(db, j.journey_id, WORK_KEY, who, live ? 'nurse_setup' : 'nurse_setup_practice', out)
  return out
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
          out.cards.changed += await applyVerdicts(db, j, steps ?? [], f, now, dfs, ctxFor(f, st))
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
      const out: Record<string, unknown> = { looked_at: (js ?? []).length, changed: 0, completed: 0, locks: 0, texts_sent: 0, cards: 0, step1_stalled: 0, offers_unread: 0,
        advance: { live: st.approve_advance_auto_live === true, done: 0, would: 0 }, oig_search: { live: st.oig_auto_search_live === true, ran: 0, would: 0, matches: 0, why: null as string | null } }
      const recruit = await domainOwner(db, 'recruiting_orientation')
      /* 2026-10-21 the OIG search on arrival: the LEIE file is read at most once per run, only when someone needs it */
      let leie: Any = null, leieErr: string | null = null
      const { data: oigRow } = await db.from('app_data').select('data').eq('key', 'oig_auto_search').maybeSingle()
      const oigItems: Any[] = Array.isArray(oigRow?.data) ? oigRow.data : []
      for (const j of js ?? []) {
        const { data: steps } = await db.from('client_journey_step').select('*').eq('journey_id', j.journey_id)
        const f = await facts(db, j, T)
        const n = await applyVerdicts(db, j, steps ?? [], f, now, dfs, ctxFor(f, st)); (out.changed as number) += n
        const { data: fresh } = await db.from('client_journey_step').select('*').eq('journey_id', j.journey_id)
        const view = R.compute(dfs, j, fresh ?? [], ctxFor(f, st))
        const a = approveState(view, f, st, null, {}, dfs, j)
        /* the journey learns its AxisCare number once the roster has it (the lock and the Training report find it by that) */
        const axId = digits(f.roster?.axiscare_id)
        if (axId && !j.axiscare_caregiver_id) { const { error } = await db.from('client_journey').update({ axiscare_caregiver_id: axId, updated_at: now }).eq('journey_id', j.journey_id); if (error) console.warn('[caregiver-journey] axiscare id not saved: ' + error.message) }
        /* the roster's work_lock: true until the stamp and the read-back (the Hub page and the Staffing Sheet read it) */
        if (f.roster && (f.roster.work_lock === true) !== a.locked) { if ((await rosterPatch(db, f.roster, { work_lock: a.locked })) === 'saved') (out.locks as number)++ }
        /* SLICE 7: the Orientation Video Call is done but the office has not hired them in AxisCare two business days later */
        const wc = (view.rows || []).find((r: Any) => r.key === 'cg.welcome.call'), inAx = (view.rows || []).find((r: Any) => r.key === 'cg.axiscare.in_training')
        if (wc?.st && DONE.includes(wc.st.state) && wc.st.completed_at && inAx && !DONE.includes(inAx.status)) {
          const due = dueNextBusinessDay(wc.st.completed_at, st.company_holidays, 17, 2)
          if (due < now) { await raiseCard(db, { id: 'cj_axhire_' + j.journey_id, kind: 'axiscare_hire_missing', urgency: 'today', who: j.client_name, offer_id: j.offer_id, title: 'Not hired in AxisCare yet: ' + j.client_name, detail: `Orientation Video Call done ${wc.st.completed_at.slice(0, 10)}; AxisCare still has no caregiver record connected to them. Hire the applicant in AxisCare (In Training); the hourly connect job links the record and this card closes.` }, { owner: S(st.staffing_email, 160).toLowerCase() || '', due }); (out.cards as number)++ }
        } else if (inAx && DONE.includes(inAx.status)) await closeCard(db, 'cj_axhire_' + j.journey_id, 'Connected to their AxisCare record.')
        /* GO-LIVE GATE (2026-10-13, no silent failures): a new-path Step 1 that is never finished. Step 1 not complete two
           business days after the day-4 reminder (the second Step 1 reminder the Training Platform stamps on the offer;
           when no second reminder was stamped, four days after the Step 1 link went) raises ONE card for the Recruiting &
           Orientation owner, closed when Step 1 completes or the offer closes. */
        if (!f.offer && T) (out.offers_unread as number)++
        if ((await step1Stall(db, j, f, st, recruit, now)) === 'raised') (out.step1_stalled as number)++
        /* 2026-10-21 REFERENCES ASKED BY THEMSELVES: the reference rows the office used to make with Ask refs, made here once
           their Step 1 is complete (refs_auto_ask_live; off = what it would make is recorded, see _shared/ref-auto-ask.ts).
           reference-chase is poked once after the sweep, so the email and text go now (in its hours) rather than tomorrow. */
        { const c = f.candidate, A = (out.auto_ask ||= { live: st.refs_auto_ask_live === true, made: 0, would: 0, people: [] as string[], errors: 0 }) as Any
          if (c && c.onboarding_path === 'new' && !!f.step1?.completed_at) {
            const { data: have, error: he } = await db.from('reference_requests').select('slot').eq('candidate_id', c.id)
            const slots = he ? [] : autoAskSlots(c, true, (have ?? []).map((x: Any) => Number(x.slot)))
            if (slots.length) {
              const who = `${S(c.first, 40)} ${S(c.last, 60)}`.trim() + ' (' + slots.length + ' reference' + (slots.length === 1 ? '' : 's') + ')'
              if (!A.live) {
                A.would += slots.length; A.people.push(who)
                await db.rpc('upsert_app_data_item', { target_key: 'refs_auto_ask_practice', item: { id: 'ask_' + c.id, candidate_id: c.id, offer_id: j.offer_id, would_make: slots.map((n) => ({ slot: n, ref_name: S(c['r' + n + 'n'], 80) })), at: now } })
              } else {
                const { error } = await db.from('reference_requests').insert(slots.map((n) => requestRow(c, n)))
                if (error) { A.errors++; await raiseCard(db, { id: 'cj_refask_' + j.journey_id, kind: 'send_problem', urgency: 'today', who: j.client_name, offer_id: j.offer_id, title: 'References were not asked for ' + j.client_name, detail: `The Hub could not set up their reference requests (${S(error.message, 140)}). Press Ask refs on their checklist.` }, { domain: 'recruiting_orientation' }) }
                else { A.made += slots.length; A.people.push(who); await event(db, j.journey_id, 'cg.refs.cleared', {}, 'references_asked', { slots, by: 'the Hub (Step 1 complete)' }) }
              }
            }
          } }
        /* 2026-10-21 THE EMPLOYEE BADGE (stop 6): once their profile photo is in, one card for whoever owns Recruiting &
           Orientation: make and mail their badge. It never holds up Approve to Work. The Hub records badge_mailed_at on
           their record, which closes the card. ops_settings.badge_cards_live (off = counted only). */
        { const rec = f.candidate || f.roster, B = (out.badge ||= { live: st.badge_cards_live === true, raised: 0, would: 0, closed: 0 }) as Any
          if (rec && (rec.badge_mailed_at || rec.badge_not_needed)) { await closeCard(db, 'cj_badge_' + j.journey_id, 'Badge recorded mailed.', () => { B.closed++ }) }
          else if (rec && f.profile_photo && !rec.not_hired) {
            if (B.live) { await raiseCard(db, { id: 'cj_badge_' + j.journey_id, kind: 'badge_to_mail', urgency: 'normal', who: j.client_name, offer_id: j.offer_id, title: "Make and mail " + j.client_name + "'s badge",
              detail: `${j.client_name}'s profile photo is in. Print their Caring Companions employee badge with it, mail it to the address on their Step 1, then press Badge mailed on their onboarding checklist. This never holds up Approve to Work.` }, { owner: recruit?.email, owner_name: recruit?.name, domain: 'recruiting_orientation' }); B.raised++ }
            else B.would++
          } }
        /* 2026-10-21 LEVEL OF CARE from the reference form: a Positive work reference's "Yes, I saw it myself" answers on the
           task list become Level evidence (one row per level, with the employer's dates; "I believe so" never counts). Once
           per request and level (unique index). ops_settings.level_from_refs_live (off = counted only). */
        { const rec = f.candidate || f.roster, L = (out.level_refs ||= { live: st.level_from_refs_live === true, added: 0, would: 0 }) as Any
          const cid = rec ? String(f.candidate ? rec.id : rec.candidate_id ?? '') : ''
          if (cid) {
            const { data: rqs } = await db.from('reference_requests').select('id, slot, ref_type, ref_name, ref_company, responder_name, employer_confirmed, emp_from, emp_to, task_confirm, responded_at').eq('candidate_id', cid).not('task_confirm', 'is', null)
            for (const rq of rqs ?? []) {
              if (!rq.responded_at || String(rq.ref_type || '').toLowerCase() !== 'professional' || rec['r' + rq.slot + 's'] !== 'Positive') continue
              const rows = evidenceFromReference(rq); if (!rows.length) continue
              const { data: have } = await db.from('caregiver_level_evidence').select('level').eq('ref_request_id', String(rq.id))
              const todo = rows.filter((r: Any) => !(have ?? []).some((h: Any) => h.level === r.level)); if (!todo.length) continue
              if (!L.live) { L.would += todo.length; continue }
              for (const r of todo) { const { error } = await db.from('caregiver_level_evidence').insert({ ...r, offer_id: String(j.offer_id), by_email: 'hub', by_name: 'The Hub (from their reference)', at: now }); if (!error) { L.added++; await event(db, j.journey_id, null, {}, 'level_evidence', { level: r.level, kind: 'reference', from_reference: rq.id, duties: r.duties }) } }
            }
          } }
        /* 2026-10-21 decision 3: Approve to Advance by itself once everything in front of it is done and nothing is blocked */
        const ad = advanceDue(view, dfs), O = out.advance as Any
        if (ad.due) {
          if (O.live) {
            await putStep(db, j.journey_id, ADV_KEY, { state: 'complete', evidence: { auto: true, rule: 'every row in front done, nothing blocked (decision 3, 2026-10-21)', rows: ad.evidence }, completed_by: 'hub', completed_by_name: 'The Hub (everything clear)', completed_at: now, blocked_reason: null })
            await event(db, j.journey_id, ADV_KEY, {}, 'confirmed', { auto: true, rows: ad.evidence }); O.done++
          } else {
            const { data: seen } = await db.from('client_journey_event').select('id').eq('journey_id', j.journey_id).eq('step_key', ADV_KEY).eq('kind', 'auto_advance_practice').limit(1)
            if (!seen?.length) await event(db, j.journey_id, ADV_KEY, {}, 'auto_advance_practice', { would: 'complete Approve to Advance', rows: ad.evidence }, 'Practice: the switch approve_advance_auto_live is off')
            O.would++
          }
        }
        /* 2026-10-21 the OIG search the moment they land in Background & References (evidence only, a person presses CLEAR) */
        const c = f.candidate, OS = out.oig_search as Any
        if (c && oigWanted(c, oigItems.find((x) => x && x.id === oigItemId(c.id)), OS.live)) {
          if (!OS.live) {
            await db.rpc('upsert_app_data_item', { target_key: 'oig_auto_search', item: { id: oigItemId(c.id), candidate_id: c.id, offer_id: j.offer_id, practice: true, would_search: { first: S(c.first, 60), last: S(c.last, 60) }, at: now } })
            OS.would++
          } else if (!leieErr) {
            try { if (!leie) leie = await loadLeie() } catch (e) { leieErr = String((e as Error)?.message ?? e).slice(0, 160); OS.why = leieErr }
            if (leie) {
              const r = matchLeie(leie, c.first, c.last), ev = { ...oigEvidence(r, now), by: 'caregiver-journey (on arrival)' }
              const path = `bgcheck/${c.id}/oig-${Date.now()}-leie-auto.json`; let proof: string | null = null
              try { const up = await db.storage.from('lead-docs').upload(path, new Blob([JSON.stringify({ ...ev, candidate: `${S(c.first, 60)} ${S(c.last, 60)}`.trim() }, null, 2)], { type: 'application/json' }), { contentType: 'application/json', upsert: false }); if (!up.error) proof = path } catch { /* the result is still kept below */ }
              await db.rpc('upsert_app_data_item', { target_key: 'oig_auto_search', item: { id: oigItemId(c.id), candidate_id: c.id, offer_id: j.offer_id, practice: false, ran_at: now, evidence: ev, proof, at: now } })
              OS.ran++
              if (!r.clear) { OS.matches++
                await raiseCard(db, { id: 'oig_match_c' + c.id, kind: 'oig_match_review', urgency: 'urgent', who: j.client_name, offer_id: j.offer_id, title: 'Possible OIG exclusion match: ' + j.client_name,
                  detail: `The OIG search found ${r.matches.length} name match${r.matches.length === 1 ? '' : 'es'} for ${j.client_name}. A name match is not a verdict: open their checklist, compare the details, and record CLEAR or FLAGGED.` }, { domain: 'recruiting_orientation' }) }
            }
          }
        }
        /* Ready for Final Approval: one card for the Approve to Work list, closed at the press */
        if (a.ready_for_final) { await raiseCard(db, { id: 'cj_final_' + j.journey_id, kind: 'final_approval', urgency: 'today', who: j.client_name, offer_id: j.offer_id, title: 'Ready for final approval: ' + j.client_name, detail: 'Every required row on their readiness card is complete (checks with their proof, Step 2, the Orientation Video Call, orientation, dementia, the profile, AxisCare entries). An owner on the Approve to Work list opens the card and presses Approve to Work; the server checks every row again at the press.' }); (out.cards as number)++ }
        /* a cleared text held after hours goes now, in hours, with the switch on */
        if (a.approved && a.axiscare.state === 'confirmed' && a.text?.state === 'due' && (st.approve_work_text_live === true || testPerson(st, { phone: f.roster?.phone || f.offer?.phone, email: f.roster?.email || f.offer?.email })) && inTextHours()) { const t = await clearedTextStep(db, j, f, st, {}); if (t.state === 'sent') (out.texts_sent as number)++ }
        if (view.complete && j.status === 'open') { await db.from('client_journey').update({ status: 'active', updated_at: now }).eq('journey_id', j.journey_id); await event(db, j.journey_id, null, {}, 'complete', { all: true }); (out.completed as number)++ }
      }
      /* the rows just made are asked now: reference-chase only touches rows never sent, and keeps its own hours */
      if ((out.auto_ask as Any)?.made) {
        try { const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/reference-chase`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? '', Authorization: 'Bearer ' + (Deno.env.get('SUPABASE_ANON_KEY') ?? ''), 'x-cron-secret': Deno.env.get('HUB_JOB_SECRET') ?? '' }, body: '{}' })
          ;(out.auto_ask as Any).chase = r.ok ? ((await r.json().catch(() => ({})))?.skipped || 'asked') : 'refused ' + r.status }
        catch (e) { (out.auto_ask as Any).chase = 'could not reach reference-chase: ' + String((e as Error)?.message ?? e).slice(0, 100) }
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
      const now = new Date().toISOString(), applied: string[] = [], held: string[] = []
      const state: Record<string, string> = Object.fromEntries(got.steps.map((s: Any) => [s.step_key, s.state]))
      for (const c of courses) {
        const key = TRAINING_ROWS[S(c?.slug, 60)]; if (!key) continue
        if (!['complete', 'waived'].includes(S(c?.status, 20))) continue
        const st = got.steps.find((s: Any) => s.step_key === key); if (st && DONE.includes(st.state)) continue
        /* GO-LIVE GATE (2026-10-13): never done before the rows in front of it (orientation after the Orientation Video Call,
           dementia after orientation). Held, with an event; the nightly Training sync and the sweep verify it once they are done. */
        const wait = waitingFor(key, dfs, state, (d: Any) => !d.applies)
        if (wait.length) { if (!held.includes(key)) { held.push(key); await event(db, got.j.journey_id, key, { email: 'training-platform', name: 'The Training Platform' }, 'verify_held', { course: S(c?.slug, 60), waiting_for: wait }, 'Reported done before ' + wait.map((k) => dfs.find((d) => d.key === k)?.title || k).join(', ')) } continue }
        const at = /^\d{4}-\d{2}-\d{2}/.test(S(c?.completed_at, 30)) ? new Date(S(c.completed_at, 30)).toISOString() : now
        await putStep(db, got.j.journey_id, key, { state: 'complete', evidence: { verified: { at: now, by: 'training-platform' }, course: S(c?.slug, 60), title: S(c?.title, 120), status: S(c?.status, 20), completed_at: at, source: 'Training Platform report' }, completed_by: 'training-platform', completed_by_name: 'The Training Platform (reported)', completed_at: at, blocked_reason: null })
        await event(db, got.j.journey_id, key, { email: 'training-platform', name: 'The Training Platform' }, 'verified', { course: S(c?.slug, 60), completed_at: at, reported: true }); applied.push(key); state[key] = 'complete'
      }
      if (!got.j.axiscare_caregiver_id) await db.from('client_journey').update({ axiscare_caregiver_id: axId, updated_at: now }).eq('journey_id', got.j.journey_id)
      return json({ ok: true, journey: true, applied, held })
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
        const f = await facts(db, j, null); const v = R.compute(dfs, j, steps ?? [], ctxFor(f, st)); const a = approveState(v, f, st, who, P, dfs, j)
        rows.push({ journey_id: j.journey_id, offer_id: j.offer_id, name: j.client_name, status: j.status, stage: v.stageLabel, next: v.next ? { key: v.next.key, title: v.next.def.title, owner: v.next.owner, attention: v.next.attention || null } : null, complete: v.complete,
          approved_to_work: a.approved, ready_for_final: a.ready_for_final, axiscare: a.axiscare.state, locked: a.locked, blocked: (v.rows || []).filter((r: Any) => r.status === 'blocked').map((r: Any) => r.def.title) })
      }
      void T; return json({ ok: true, rows, may_approve_work: mayApprove(P, 'work', { person_id: who.person_id, roles: who.roles || [], email: who.email }) })
    }
    const answerFor = async (jid: string, f: Facts) => { const fresh = await load(db, { journey_id: jid }); const v = R.compute(dfs, fresh!.j, fresh!.steps, ctxFor(f, st)); const { data: ev } = await db.from('client_journey_event').select('*').eq('journey_id', jid).order('at', { ascending: false }).limit(200); const may: Record<string, boolean> = {}; for (const r of v.rows) may[r.key] = mayDo(r.def, who, P); return json({ ok: true, journey: fresh!.j, steps: fresh!.steps, view: v, events: ev ?? [], may, is_owner: isOwner, may_export: mayExport, approve: approveState(v, f, st, who, P, dfs, fresh!.j), facts: { lived_outside_mo: f.lived_outside_mo ?? null, claims_cna_or_hha: f.claims_cna_or_hha ?? null, drives_clients: f.drives_clients ?? null, dates: dates(f), rights: rightsState(f), ...(f.licensed_nurse === true ? { licensed_nurse: true, position_key: f.offer?.position_key ?? null, nurse_switch_live: st?.[NURSE_SWITCH] === true } : {}) } }) }   /* 2026-10-13: participant rights, signed and explained */
    if (action === 'get') {
      const got = await load(db, b); if (!got) return json({ ok: true, journey: null })
      const f = await facts(db, got.j, trn())
      return await answerFor(got.j.journey_id, f)
    }
    const got = await load(db, b); if (!got) return json({ error: 'That readiness card was not found.' }, 404)
    const f = await facts(db, got.j, trn()); const view = R.compute(dfs, got.j, got.steps, ctxFor(f, st))
    const now = new Date().toISOString(), actor = { email: who.email, name: who.name }
    /* ── LEVEL OF CARE (her approved design of 2026-10-08; decision 4, 2026-10-21: the approvers are the Approve to Work list) ── */
    if (action === 'level_get' || action === 'level_evidence' || action === 'level_approve') {
      const mayLvl = mayApprove(P, 'work', { person_id: who.person_id, roles: who.roles || [], email: who.email })
      if (action === 'level_evidence') {
        const v = validateEvidence(b)
        if (!v.ok) return json({ error: v.why }, 400)
        const { error } = await db.from('caregiver_level_evidence').insert({ ...v.row, offer_id: String(got.j.offer_id), by_email: who.email || null, by_name: who.name || null, at: now })
        if (error) return json({ error: 'That proof could not be saved: ' + S(error.message, 160) + '. Nothing was recorded.' }, 500)
        await event(db, got.j.journey_id, null, actor, 'level_evidence', { level: v.row.level, kind: v.row.kind, source: v.row.source, duties: v.row.duties })
      }
      if (action === 'level_approve') {
        if (!mayLvl) return json({ error: 'Only a person on the Approve to Work list (Samantha or Zachary) may approve a Level of Care.' }, 403)
        const want = Number(b.level)
        const lv = await levelState(db, got.j, f)
        if (![1, 2, 3].includes(want)) return json({ error: 'Which level: 1, 2 or 3?' }, 400)
        if (want > lv.verified_level) return json({ error: `Not yet: Level ${want} is not verified (verified: Level ${lv.verified_level}). Record the proof first. There is no override.` }, 409)
        const pr = f.candidate ? { key: 'candidates', rec: f.candidate } : f.roster ? { key: 'caregivers', rec: f.roster } : null
        if (!pr) return json({ error: 'Their Background & References or caregiver record was not found.' }, 404)
        const ids = lv.evidence.filter((e: Any) => e.level <= want).map((e: Any) => e.id)
        const hist = (Array.isArray(pr.rec.care_level_history) ? pr.rec.care_level_history.slice(-49) : []).concat([{ at: now, level: want, by: who.email, name: who.name, note: S(b.note, 500) || null, evidence: ids }])
        const fields = { care_level_approved: want, care_level_by: who.name || who.email, care_level_by_email: who.email, care_level_at: now, care_level_note: S(b.note, 500) || null, care_level_evidence: ids, care_level_history: hist }
        const saved = await levelPatch(db, pr.key, pr.rec, fields)
        if (saved !== 'saved') return json({ error: saved === 'error' ? 'The level could not be saved just now. Nothing changed. Try again.' : 'Their record changed while you were looking. Reload and approve again.' }, 409)
        await event(db, got.j.journey_id, null, actor, 'level_approved', { level: want, evidence: ids, note: S(b.note, 500) || null })
        /* already approved to work: the AxisCare level class follows now (read back; practice while axiscare_level_live is off) */
        const work = got.steps.find((x: Any) => x.step_key === WORK_KEY), axId = digits(f.roster?.axiscare_id)
        let axiscare: Any = { state: 'not_yet', why: 'They are not approved to work yet; Approve to Work writes the level then.' }
        if (work && DONE.includes(work.state) && axId) {
          const r = await setCaregiverLevel(db, axId, want, who.email || 'hub', 'caregiver-journey level', st?.axiscare_level_live === true)
          axiscare = { state: r.outcome, detail: r.detail || null }
          await event(db, got.j.journey_id, 'cg.axiscare.level', actor, r.outcome === 'practice' ? 'axiscare_practice' : r.outcome === 'confirmed' || r.outcome === 'unchanged' ? 'axiscare_confirmed' : 'axiscare_failed', { level: want, outcome: r.outcome, detail: r.detail || null })
          if (!['confirmed', 'unchanged', 'practice'].includes(r.outcome)) await raiseCard(db, { id: 'cj_level_ax_' + got.j.journey_id, kind: 'axiscare_prep_failed', urgency: 'today', who: got.j.client_name, offer_id: got.j.offer_id, title: 'AxisCare level class not set: ' + got.j.client_name, detail: `Level ${want} was approved, but AxisCare did not take the class (${S(r.detail || r.outcome, 160)}). Set it by hand in AxisCare or press Retry.` })
        }
        const f2 = await facts(db, got.j, trn()); const lv2 = await levelState(db, got.j, f2)
        return json({ ok: true, ...lv2, may_approve: mayLvl, duties: DUTIES, axiscare })
      }
      const lv = await levelState(db, got.j, f)
      return json({ ok: true, ...lv, may_approve: mayLvl, duties: DUTIES })
    }
    /* SLICE 5: the owner's press */
    if (action === 'approve_work') {
      if (!mayApprove(P, 'work', { person_id: who.person_id, roles: who.roles || [], email: who.email })) return json({ error: 'Only a person on the Approve to Work list (owners) may approve to work.' }, 403)
      /* GO-LIVE GATE (2026-10-13): the press re-checks at press time, on the server: the records are verified again first
         (a result recorded since the last sweep counts; a row that lost its basis does not), then every required row. */
      await applyVerdicts(db, got.j, got.steps, f, now, dfs, ctxFor(f, st))
      const fresh = await load(db, { journey_id: got.j.journey_id }); const view2 = R.compute(dfs, fresh!.j, fresh!.steps, ctxFor(f, st))
      const a = approveState(view2, f, st, who, P, dfs, got.j)
      if (a.approved) return json({ error: 'Already approved to work' + (a.axiscare.state === 'failed' ? '; the AxisCare update failed. Press Retry.' : '.') }, 409)
      if (a.blocked.length) return json({ error: 'Not yet: ' + a.blocked.join('; ') + ' is blocked. Nothing was approved.', missing: a.missing }, 409)
      if (a.missing.length) return json({ error: 'Not yet. These required steps are not complete: ' + a.missing.join('; ') + '. Nothing was approved.', missing: a.missing }, 409)
      const aw = view2.rows.find((r: Any) => r.key === WORK_KEY)
      if (!aw) return json({ error: 'Approve to Work does not apply to this card.' }, 400)
      if (!['ready', 'attention'].includes(aw.status)) return json({ error: 'Not yet: ' + (aw.why || 'earlier requirements first') + '. Nothing was approved.' }, 409)
      await putStep(db, got.j.journey_id, WORK_KEY, { state: 'complete', evidence: { confirmed: { by: who.email, name: who.name, at: now, list: 'work' }, level_of_care: a.level_of_care.level }, completed_by: who.email, completed_by_name: who.name, completed_at: now })
      await event(db, got.j.journey_id, WORK_KEY, actor, 'approved_to_work', { list: 'work', level_of_care: a.level_of_care.level, at: now })
      await rosterPatch(db, f.roster, { approved_to_work_at: now, approved_to_work_by: who.email })
      const r = await activate(db, got.j, f, st, actor)
      /* LPN HIRING (2026-10-14): an LPN or RN hire's nurse setup (practice while nurse_hire_live is off); never for a caregiver */
      if (f.licensed_nurse === true) { try { r.nurse = await nurseSetup(db, got.j, f, st, actor) } catch (e) { r.nurse = { state: 'failed', why: S((e as Error)?.message, 160) }; await raiseCard(db, { id: 'cj_nurse_' + got.j.journey_id, kind: 'nurse_setup', urgency: 'today', who: got.j.client_name, offer_id: got.j.offer_id, title: 'Nurse setup did not finish: ' + got.j.client_name, detail: 'Approve to Work is recorded. The nurse setup stopped: ' + r.nurse.why + '. Open their readiness card and press Run nurse setup.' }) } }
      const res = await answerFor(got.j.journey_id, f); const body = await res.json()
      return json({ ...body, result: r })
    }
    /* ───── LPN HIRING (2026-10-14): the nurse forms on the readiness card (office staff; only on an LPN or RN card) ───── */
    if (action.startsWith('nurse_')) {
      if (f.licensed_nurse !== true || !['lpn', 'rn'].includes(String(validKey(f.offer?.position_key)))) return json({ error: 'This is not an LPN or RN hire (the nurse forms are only for them).' }, 400)
      const oid = String(got.j.offer_id), today = new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10), pk = validKey(f.offer.position_key)
      if (action === 'nurse_facts') {
        const a: Any = f.step1?.answers || {}
        let last4: string | null = null; try { const { data: nl } = await db.from('step1_identity').select('nurse_license_last4').eq('offer_id', oid).maybeSingle(); last4 = nl?.nurse_license_last4 || null } catch { last4 = null }
        const sig = (f.step1?.signatures || {}).nurse_license || null
        return json({ ok: true, position: pk, position_label: POSITION_LABELS[pk!], step1: { license_type: a.nurse_license_type || null, license_last4: last4, state: a.nurse_license_state || null, multistate: a.nurse_license_multistate || null, expires: a.nurse_license_expires || null,
          picture: a.nurse_license_doc?.path ? { path: S(a.nurse_license_doc.path, 200) } : null, signed_at: sig?.at || null, form_version: sig?.version || null },
          topics: ORIENTATION_TOPICS, packet: packetLine(pk), switch_live: st?.[NURSE_SWITCH] === true, supervising_rn: SUPERVISING_RN_NAME, waived_courses: WAIVED_COURSES, kept_courses: KEPT_COURSES, kinds: NURSE_DOC_KINDS })
      }
      if (action === 'nurse_upload_url') {
        const kind = S(b.kind, 20), ext = S(b.ext, 5).toLowerCase()
        if (!(NURSE_DOC_KINDS as readonly string[]).includes(kind)) return json({ error: 'Which document?' }, 400)
        if (!['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'pdf'].includes(ext)) return json({ error: 'Please use a picture (JPG, PNG, HEIC) or a PDF.' }, 400)
        const path = `nurse/${oid}/${kind}-${Date.now()}.${ext}`
        const { data, error } = await db.storage.from('onboarding-documents').createSignedUploadUrl(path)
        if (error || !data) return json({ error: 'Could not get the upload ready. Please try again.' }, 500)
        return json({ ok: true, path, token: data.token, signed_url: data.signedUrl })
      }
      if (action === 'nurse_open') {
        const path = S(b.path, 200)
        const mine = path.startsWith(`nurse/${oid}/`) || path === S((f.step1?.answers || {}).nurse_license_doc?.path, 200)
        if (!mine || !/^[\w./-]+$/.test(path)) return json({ error: 'That document is not on this card.' }, 400)
        const { data, error } = await db.storage.from('onboarding-documents').createSignedUrl(path, 300)
        if (error || !data?.signedUrl) return json({ error: 'Could not open the document.' }, 500)
        await logOpen(db, { subject: oid, doc: 'nurse:' + (path.split('/').pop() || '').split('-')[0], path, who: { person_id: who.person_id, email: who.email, name: who.name }, reason: 'opened from the readiness card' })
        return json({ ok: true, url: data.signedUrl, expires_in: 300 })
      }
      if (action === 'nurse_doc') {
        const which = S(b.which, 20); let last4 = ''
        try { const { data: nl } = await db.from('step1_identity').select('nurse_license_last4').eq('offer_id', oid).maybeSingle(); last4 = S(nl?.nurse_license_last4, 4) } catch { last4 = '' }
        const lic = `${pk === 'rn' ? 'Registered Nurse (RN)' : 'Licensed Practical Nurse (LPN)'}${last4 ? ', license ending ' + last4 : ''}`
        const blocks = which === 'section2' ? section2Statement(S(got.j.client_name, 80), lic) : which === 'orientation' ? orientationChecklist(S(got.j.client_name, 80)) : null
        if (!blocks) return json({ error: 'Which document?' }, 400)
        const bytes = nurseDocPdf((which === 'section2' ? 'Section 2 acknowledgment' : 'Nurse orientation checklist') + ' - ' + S(got.j.client_name, 80), blocks)
        let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
        return json({ ok: true, which, pdf_base64: btoa(bin) })
      }
      if (action === 'nurse_record') {
        const k = S(b.step_key, 60)
        if (!(NURSE_RECORDED as readonly string[]).includes(k)) return json({ error: 'Which nurse requirement?' }, 400)
        const nrow = view.rows.find((r: Any) => r.key === k); if (!nrow) return json({ error: 'That requirement does not apply to this person.' }, 400)
        if (DONE.includes(nrow.status)) return json({ error: 'Already recorded. A recorded result is permanent history; ask an owner if it must be redone.' }, 409)
        let last4: string | null = null; try { const { data: nl } = await db.from('step1_identity').select('nurse_license_last4').eq('offer_id', oid).maybeSingle(); last4 = nl?.nurse_license_last4 || null } catch { last4 = null }
        const by = { email: who.email, name: who.name }
        const v = k === 'cg.credential.nurse_license' ? licenseVerdict(b, { offerId: oid, positionKey: pk, today, last4, by }) : k === 'cg.nurse.orientation' ? orientationVerdict(b, { offerId: oid, today, by }) : section2Verdict(b, { offerId: oid, today, by })
        if (!v.ok) return json({ error: v.error + ' Nothing was saved.' }, 400)
        const doc = S((v.evidence || {}).document, 200)
        if (doc) { const dir = doc.slice(0, doc.lastIndexOf('/')), nm = doc.slice(doc.lastIndexOf('/') + 1); const { data: found } = await db.storage.from('onboarding-documents').list(dir, { search: nm, limit: 5 }); if (!(found ?? []).some((x: { name: string }) => x.name === nm)) return json({ error: 'The uploaded document did not arrive. Please upload it again. Nothing was saved.' }, 409) }
        if (v.state === 'complete') {
          await putStep(db, got.j.journey_id, k, { state: 'complete', evidence: { ...v.evidence, recorded: { by: who.email, name: who.name, at: now } }, completed_by: who.email, completed_by_name: who.name, completed_at: now, blocked_reason: null })
          await event(db, got.j.journey_id, k, actor, 'evidence_added', v.evidence)
        } else {
          await putStep(db, got.j.journey_id, k, { state: 'blocked', blocked_reason: v.reason, evidence: { ...v.evidence, recorded: { by: who.email, name: who.name, at: now } } })
          await event(db, got.j.journey_id, k, actor, 'blocked', v.evidence, v.reason || null)
          await raiseCard(db, { id: 'cj_nurselic_' + got.j.journey_id, kind: 'nurse_license_problem', urgency: 'urgent', who: got.j.client_name, offer_id: got.j.offer_id, title: 'Nursing license not cleared: ' + got.j.client_name, detail: (v.reason || '') + '. Nothing else moves for them until an owner reviews it.' })
        }
        return await answerFor(got.j.journey_id, f)
      }
      if (action === 'nurse_setup') {
        if (!mayApprove(P, 'work', { person_id: who.person_id, roles: who.roles || [], email: who.email })) return json({ error: 'Only a person on the Approve to Work list may run the nurse setup.' }, 403)
        const a = approveState(view, f, st, who, P, dfs, got.j); if (!a.approved) return json({ error: 'Approve to Work first.' }, 409)
        const r = await nurseSetup(db, got.j, f, st, actor)
        const res = await answerFor(got.j.journey_id, f); const body = await res.json()
        return json({ ...body, result: { nurse: r } })
      }
      return json({ error: 'Unknown action.' }, 400)
    }
    if (action === 'copy_sheet') {
      const which = S(b.which, 20); const a: Any = f.step1?.answers || {}
      const txt = (v: unknown): string => v == null || v === '' ? '' : Array.isArray(v) ? v.map(txt).filter(Boolean).join(', ') : typeof v === 'object' ? Object.entries(v as Record<string, unknown>).map(([k, x]) => { const t = txt(x); return t ? `${k}: ${t}` : '' }).filter(Boolean).join('; ') : String(v)
      const yn = (v: unknown) => v === 'yes' ? 'Yes' : v === 'no' ? 'No' : txt(v)
      let rows: Array<{ label: string; value: string }> = []
      if (which === 'attributes') rows = [
        ['Languages', txt(a.languages)], ['Comfortable with cats', yn(a.cats)], ['Comfortable with dogs', yn(a.dogs)], ['Smoking', txt(a.smoking)], ['Transportation', txt(a.transportation)], ['Drives clients', f.drives_clients === true ? 'Requests approval to transport clients' : f.drives_clients === false ? 'No' : ''],
        ['Hoyer lift', yn(a.hoyer_lift)], ['Gait belt / transfers', yn(a.gait_belt)], ['Bed-bound care', yn(a.bed_bound)], ['Level 1 willing', yn(a.level1)], ['Level 2 willing', yn(a.level2)], ['Level 3 willing', yn(a.level3)], ['Preferred levels', txt(a.preferred_levels)], ['Specialties', txt(a.specialties)],
        ['Prefers a male caregiver client?', yn(a.male_caregiver)], ['Prefers a female caregiver client?', yn(a.female_caregiver)], ['Experience (claimed, not verified)', txt(a.experience)], ['CNA / HHA (claimed)', f.claims_cna_or_hha === true ? 'Yes' : f.claims_cna_or_hha === false ? 'No' : ''], ['Approved Level of Care', String((f.candidate?.care_level_approved ?? f.roster?.care_level_approved) || 'Level 1 (default)')],
      ].map(([label, value]) => ({ label, value })).filter((r) => r.value)
      else if (which === 'availability') {
        const grid = a.windows && typeof a.windows === 'object' && !Array.isArray(a.windows) ? a.windows as Record<string, Record<string, unknown>> : {}
        for (const [day, row] of Object.entries(grid)) { const t = txt(row); if (t) rows.push({ label: day, value: t }) }
        for (const [label, v] of [['Ideal hours a week', a.hours_ideal], ['Minimum hours', a.hours_min], ['Maximum hours', a.hours_max], ['Max miles', a.max_miles], ['Shift preferences', a.shift_prefs]] as Array<[string, unknown]>) { const t = txt(v); if (t) rows.push({ label, value: t }) }
      } else return json({ error: 'Which sheet?' }, 400)
      return json({ ok: true, which, name: got.j.client_name, rows, note: rows.length ? 'From their signed Step 1 answers. Type these on the AxisCare screen in this order, then confirm the row.' : 'Their Step 1 holds no answers for this sheet yet.' })
    }
    if (action === 'retry_axiscare') {
      const a = approveState(view, f, st, who, P, dfs, got.j)
      if (!a.approved) return json({ error: 'Approve to Work first.' }, 409)
      let r: Any
      if (a.axiscare.state === 'confirmed') {
        if (['confirmed', 'n/a'].includes(a.prep.hire_date.state) && ['confirmed', 'n/a'].includes(a.prep.level.state)) return json({ error: 'AxisCare already reads back Active, the hire date and the level class.' }, 409)
        await event(db, got.j.journey_id, AX_KEY, actor, 'axiscare_prep_retry', {})
        r = { outcome: 'prep', prep: await prepAxis(db, got.j, f, st, actor, digits(f.roster?.axiscare_id)) }
      } else {
        await event(db, got.j.journey_id, AX_KEY, actor, 'axiscare_retry', {})
        r = await activate(db, got.j, f, st, actor)
      }
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
      /* LPN HIRING: the nurse rows are recorded through their own forms (every field checked), never the generic prompt */
      if ((NURSE_RECORDED as readonly string[]).includes(key)) return json({ error: 'Record this one with its nurse form on the readiness card.' }, 400)
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
