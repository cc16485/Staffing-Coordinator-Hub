// =============================================================================
// coverage-run — the unblocked half of chain 1
// =============================================================================
// WHAT ALREADY EXISTS, and is not being rebuilt
//   `call-disposition` recognises a call-off and writes a `coverage_cases`
//   record. The Hub has a complete MANUAL workflow over it: covAsk() records
//   who was asked and how, covAskState() records their answer, and a caregiver
//   saying yes already asks a human before the shift is marked covered.
//
//   `asked[]` is real state with a real shape:
//       { id, name, channel, at, state: waiting|yes|no, replied_at }
//
//   So this does NOT invent a second coverage workflow. It fills the three
//   gaps the manual flow leaves:
//     1. the case has no owner — it routes to a queue, not a person
//     2. nothing prompts anybody, so the case is written and nobody is told
//     3. nothing automates candidate selection or outreach
//
// WHAT THIS WILL NOT DO
//   It will not message a caregiver whose phone is not trusted for autonomous
//   outbound. After the 13 August rollback the roster has no defensible phone
//   numbers at all, so the dry run is expected to refuse every candidate. That
//   is the gate working, not the gate failing.
//
// DRY RUN BY DEFAULT. ?commit=1 writes state. Sending is a THIRD switch that
// does not exist yet on purpose.
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ghlStoredContactIfAllowed } from '../_shared/optout.ts'
import { maySendTo, normalisePhone, contactForOutbound } from '../_shared/outreach.ts'
import { ZIP_LL } from '../_shared/zip-centroids.ts'
import { shadowRoute } from '../_shared/routing.ts'
import { opEvent } from '../_shared/events.ts'
import { ghlSendChecked, reportSendProblem } from '../_shared/send-problems.ts'
import { ghlStaffContact } from '../_shared/staff-contact.ts'
import { officeQuiet, afterHoursAllowed } from '../_shared/quiet-hours.ts'
import { jobCaller, ownerCaller } from '../_shared/job-auth.ts'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { notifyFamilyOfChange } from '../_shared/family-change-text.ts'
import { careLevelOf } from '../_shared/care-level.ts'
import { holdsAutoTexts, isMustCover, onlyAskCut, planLine, readPlan } from '../_shared/callin-plan.ts'
import { callinLink, withLink, rememberAlerted, textCaseAdmins, caseWhat } from '../_shared/callin-notify.ts'
import { reminderDue, reminderText } from '../_shared/callin-reminder.ts'
import { adminRecipients, textAdmin } from '../_shared/clockin-admins.ts'
import { urgencyOf, confirmed, criticalText, criticalRecipients, minsToStart } from '../_shared/cara-urgency.ts'   // CARA PHASE 1 step 2
import { onDuty } from '../_shared/duty.ts'
import { caseEnded, chiNowNaive } from '../_shared/loops.ts'
/* SLICE 5 (2026-10-10): a new hire with a readiness card is never offered a shift until Approved to Work and AxisCare read back Active */
import { workLock, LOCK_WHY } from '../_shared/work-lock.ts'
import { loadNotClients, isNotClient } from '../_shared/client-quiet.ts'   // 2026-10-22: the Practice client (and Office Staff) are never a visit here
import { isInTraining, inTrainingLive, IN_TRAINING_WHY } from '../_shared/in-training.ts'   // 2026-10-22 In Training is onboarding
import { OPEN_HOURS_DEFAULT, checkWording, inSendWindow, offeredCells, openHoursText } from '../_shared/open-hours.ts'
import { newHireNeed } from '../_shared/new-hire.ts'
import { readTransportNeed, readDriveGate, transportDecision } from '../_shared/driver-eligibility.ts'
import { MO_FROM } from '../_shared/office-from.ts'   // every text goes out from (417) 234-8494
import { fallbackList } from '../_shared/notice-to.ts'
import { takenOffNotCalledIn, offWords } from '../_shared/not-a-callin.ts'
/* CARA PHASE 1 (2026-10-23): the better list, behind ops_settings.cara_list_live (off = the list is exactly as before) */
import { availStatus, availRank, UNKNOWN_WHY, weekOf, weekHoursBy, shiftHours, hoursFlag, overlapsFor, skillsNote, recommend, boardOf } from '../_shared/cara-list.ts'
import { loadSkillJudge, careNow } from '../_shared/cara-skills.ts'
import { previewRecords, stateOf } from '../_shared/caregiver-preview.ts'
import { linkFor, partWelcome, patLineOf, linkTemplate as shiftLinkTemplate, fillLinked } from '../_shared/shift-link-texts.ts'
import { makeShiftLink, shiftDayEnd } from '../_shared/shift-links.ts'
import { isPlaceholderCaregiver } from '../_shared/cg-placeholder.ts'   // 2026-10-24: never a cover
import { LIVE_STATES, runRules, nextStep, pickWave, waveOrder, combosOf, partsWithoutHours, nextMorning, needsLine } from '../_shared/cara-run.ts'   // CARA PHASE 2 PART A
import { judgeForWaves, pickWaveV2, bandsOfTimes, caseBands, sameTimeOfDay } from '../_shared/cara-waves.ts'
import { skillCode, threeGroups, checkApproval } from '../_shared/ask-list.ts'   // the three-group ask list (2026-10-24), switch ask_list_live   // her wave rules (2026-10-24), switch cara_wave_rules_live

/* Straight-line miles between two zips' Census centroids — an honest
   estimate for "who lives closest", never a route. Null when either zip
   is unknown; the UI then shows the city alone. */
function zipMiles(a: string, b: string): number | null {
  const p = ZIP_LL[String(a || '').slice(0, 5)], q = ZIP_LL[String(b || '').slice(0, 5)]
  if (!p || !q) return null
  const R = 3958.8, rad = (x: number) => x * Math.PI / 180
  const dLat = rad(q[0] - p[0]), dLon = rad(q[1] - p[1])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(p[0])) * Math.cos(rad(q[0])) * Math.sin(dLon / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(h)))
}

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const clean = (v: unknown) => String(v ?? '').trim()
const nowIso = () => new Date().toISOString()
/* Used when recording an ask. Its ABSENCE was a production 500: the engine
   sent wave-1's first text, then crashed on the undefined call before
   persisting asked[] — so every tick re-sent the same first text. */
const uid = () => 'ask_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
/* Texts carry clock time the way people say it: "17:00-21:00" → "5pm-9pm",
   minutes kept only when they matter ("7:30am"). Her call, live 2026-09-16,
   after reading the first real wave. Anything that isn't HH:MM passes through. */
const clock12 = (t: string): string => {
  const m = String(t || '').trim().match(/^(\d{1,2}):(\d\d)$/)
  if (!m) return String(t || '').trim()
  const h24 = Number(m[1]); const h = h24 % 12 || 12
  return `${h}${m[2] === '00' ? '' : ':' + m[2]}${h24 >= 12 ? 'pm' : 'am'}`
}
const span12 = (span: string): string =>
  String(span || '').trim().split('-').map(clock12).join('-')
/* "Joel & Carol Wolverton" → "Joel & Carol"; "Patsy Smith" → "Patsy". A couple
   shares one visit, so BOTH first names belong in a text about it — dropping
   the trailing surname is the rule, not keeping the first word. */
const firstNamesOf = (full: string): string => {
  const w = String(full || '').trim().split(/\s+/).filter(Boolean)
  return (w.length > 1 ? w.slice(0, -1) : w).join(' ')
}
/* Shift date the way a text should say it: today / tomorrow / "Thu, Sep 18". */
const friendlyDay = (ymd: string): string => {
  if (!/^\d{4}-\d\d-\d\d$/.test(String(ymd || ''))) return String(ymd || '')
  const chiToday = new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
  if (ymd === chiToday) return 'today'
  const d = new Date(ymd + 'T12:00:00')
  if (d.getTime() - new Date(chiToday + 'T12:00:00').getTime() === 86400000) return 'tomorrow'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

/** How many caregivers a single wave asks. Controlled waves, not a blast: a
 *  broadcast to the whole roster costs goodwill every time it is used and
 *  stops working. */
const WAVE_SIZE = Number(Deno.env.get('COVERAGE_WAVE_SIZE') || '5')

/* ── PRN3 (2026-09-29): THE PRN CNA TEAM IS ASKED FIRST ───────────────────
   ONE PAY TRACK AT A TIME (her rule): a PRN Team member is always $20 and an
   ongoing caregiver is $18. Nothing here reads, writes or changes pay; it only
   decides who is shown and asked first.
   A PRN member FITS a call-off or one-time shift when its weekday is one of
   their days, its start falls in one of their times of day, the time until it
   starts is at least the notice they asked for, and they are free then. A
   regular (ongoing) opening is not a PRN shift: taking it means moving to
   ongoing, so PRN members are listed apart, unticked, and never in a wave. */
/* Her positioning: accept or decline, no pressure. No pay in it: a PRN member's rate is always $20 and never changes by shift. */
export const PRN_DEFAULT_MSG = `Hi {first_name}, it's Caring Companions. PRN opportunity: {client} at {address}, {when}. {care}Can you take it? Reply YES or NO. No pressure either way.`
export const PRN_NOTICE_H: Record<string, number> = { same_day: 0, few_hours: 3, '24h': 24, '48h': 48 }
const PRN_NOTICE_WORD: Record<string, string> = { few_hours: 'a few hours', '24h': '24 hours', '48h': '48 hours' }
const DAY_WORD: Record<string, string> = { mon: 'Mondays', tue: 'Tuesdays', wed: 'Wednesdays', thu: 'Thursdays', fri: 'Fridays', sat: 'Saturdays', sun: 'Sundays' }
const BAND_WORD: Record<string, string> = { morning: 'mornings', afternoon: 'daytimes', evening: 'evenings', overnight: 'overnights' }
type PrnMember = { notice: string | null; windows: Record<string, string[]> | null; confirmed_at: string | null; outside_ok?: boolean
  /* her wave rules (2026-10-24, _shared/cara-waves.ts): the rest of their PRN answers */
  days?: string[] | null; times?: string[] | null; interests?: string[] | null; short_notice_ok?: boolean }
// deno-lint-ignore no-explicit-any
export function isOngoingCase(c: any): boolean {
  return String(c?.kind) === 'interest' || c?.shift_pattern?.kind === 'open_ongoing' || String(c?.reason) === 'open'
}
/* Same bands as the availability page: morning 6-12, daytime (stored 'afternoon') 12-5, evening 5-10, overnight 10-6. */
export function bandOf(hhmm: string): string {
  const h = Number(String(hhmm).slice(0, 2))
  return h >= 6 && h < 12 ? 'morning' : h >= 12 && h < 17 ? 'afternoon' : h >= 17 && h < 22 ? 'evening' : 'overnight'
}
/* outside: the only reason it doesn't fit is their stated days and times (2026-10-14: those who ticked "also text me about
   shifts outside my availability" can still be asked; notice and already working still rule them out) */
// deno-lint-ignore no-explicit-any
export function prnFit(c: any, p: PrnMember, busy: boolean, nowChicago?: Date): { fit: boolean; why: string | null; outside?: boolean } {
  const date = String(c?.shift_date || ''), time = String(c?.shift_time || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d\d:\d\d-\d\d:\d\d$/.test(time)) return { fit: false, why: 'the shift has no date and time yet' }
  const start = time.slice(0, 5)
  const wd = new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }).toLowerCase().slice(0, 3)
  const band = bandOf(start)
  const w = p.windows ?? {}
  const onDay = Array.isArray(w[wd]) ? w[wd] : []
  const outsideWhy = !onDay.length ? 'not available ' + (DAY_WORD[wd] || wd) : !onDay.includes(band) ? 'not available ' + (DAY_WORD[wd] || wd) + ' ' + (BAND_WORD[band] || band) : null
  if (outsideWhy) {
    if (!p.outside_ok) return { fit: false, why: outsideWhy }
    const later = prnFit(c, { ...p, windows: { ...w, [wd]: [...onDay, band] } }, busy, nowChicago)
    return later.fit ? { fit: false, why: outsideWhy + ' (said OK to texts outside their times)', outside: true } : later
  }
  const need = PRN_NOTICE_H[String(p.notice ?? '')] ?? 0
  if (need > 0) {
    const now = nowChicago ?? new Date(new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).replace(' ', 'T'))
    const hrs = (new Date(date + 'T' + start + ':00').getTime() - now.getTime()) / 3_600_000
    if (hrs < need) return { fit: false, why: 'needs ' + (PRN_NOTICE_WORD[String(p.notice)] || need + ' hours') + "' notice" }
  }
  if (busy) return { fit: false, why: 'already working then' }
  return { fit: true, why: null }
}
/* AVAILABILITY FOR EVERYONE (Samantha, 2026-10-14: "we need them to check availability"). The shift's day and time of day
   (its start, same bands as the availability page) against the times the caregiver gave us. A dated shift is one slot; an
   interest check or regular opening is each asked day at its start time, and counts as outside only when NONE of those days
   fit. No availability on file = no answer here; with Cara Phase 1 on (cara_list_live) that is "Unknown", never a fit
   (her rule 2026-10-17, _shared/cara-list.ts availStatus); no date or time on the case = nothing to check.
   outside + ok: they ticked "also text me about open shifts outside my availability". */
// deno-lint-ignore no-explicit-any
export function availCheck(c: any, a: { windows?: Record<string, string[]> | null; outside_ok?: boolean | null } | null | undefined): { outside: boolean; ok: boolean; why: string | null } {
  const w = a?.windows
  if (!w || !Object.values(w).some((v) => Array.isArray(v) && v.length)) return { outside: false, ok: false, why: null }
  const slots: [string, string][] = []
  const date = String(c?.shift_date || ''), time = String(c?.shift_time || '')
  if (/^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d\d:\d\d-\d\d:\d\d$/.test(time)) {
    slots.push([new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }).toLowerCase().slice(0, 3), bandOf(time.slice(0, 5))])
  } else if (Array.isArray(c?.interest_days) && /^\d\d:\d\d$/.test(String(c?.interest_start || '').slice(0, 5))) {
    for (const d of c.interest_days) slots.push([String(d).toLowerCase().slice(0, 3), bandOf(String(c.interest_start).slice(0, 5))])
  }
  if (!slots.length) return { outside: false, ok: false, why: null }
  if (slots.some(([d, b]) => Array.isArray(w[d]) && w[d].includes(b))) return { outside: false, ok: false, why: null }
  const [d0, b0] = slots[0]
  const why = slots.length === 1 ? 'outside their availability (' + (Array.isArray(w[d0]) && w[d0].length ? 'not ' + (DAY_WORD[d0] || d0) + ' ' + (BAND_WORD[b0] || b0) : 'not ' + (DAY_WORD[d0] || d0)) + ')'
    : 'outside their availability (none of the asked days at that time)'
  return { outside: true, ok: a?.outside_ok === true, why }
}
/* every availability record by AxisCare id (and record id), read once; unreadable = empty = everyone available */
async function availLoad(): Promise<Map<string, { windows?: Record<string, string[]> | null; outside_ok?: boolean | null; target_hours?: unknown }>> {
  const out = new Map()
  try {
    const { data } = await sb.from('app_data').select('data').eq('key', 'caregiver_availability').maybeSingle()
    // deno-lint-ignore no-explicit-any
    for (const a of (Array.isArray(data?.data) ? data!.data : []) as any[]) { if (a?.axiscare_id != null && a.axiscare_id !== '') out.set(String(a.axiscare_id), a); else if (a?.id != null) out.set(String(a.id), a) }
  } catch { /* nothing read = nobody is left out for availability */ }
  return out
}
/* Active PRN Team members linked to their AxisCare caregiver record, with their notice and availability. */
async function prnTeamLoad(): Promise<Map<string, PrnMember>> {
  const out = new Map<string, PrnMember>()
  try {
    const { data: tr } = await sb.from('pay_tracks').select('applicant_id, axiscare_caregiver_id').eq('track', 'prn_team').not('axiscare_caregiver_id', 'is', null)
    if (!tr?.length) return out
    const { data: apps } = await sb.from('job_applicants').select('id, prn').in('id', tr.map((t: { applicant_id: string }) => t.applicant_id))
    const { data: avRow } = await sb.from('app_data').select('data').eq('key', 'caregiver_availability').maybeSingle()
    // deno-lint-ignore no-explicit-any
    const av: any[] = Array.isArray(avRow?.data) ? avRow!.data : []
    for (const t of tr) {
      const id = String(t.axiscare_caregiver_id)
      const a = (apps ?? []).find((x: { id: string }) => x.id === t.applicant_id)
      const item = av.find((x) => String(x?.axiscare_id ?? '') === id || String(x?.id ?? '') === id)
      out.set(id, { notice: a?.prn?.notice ?? null, windows: item?.windows ?? null, confirmed_at: item?.updated_at ?? null, outside_ok: item?.outside_ok === true,
        days: a?.prn?.days ?? null, times: a?.prn?.times ?? null, interests: a?.prn?.interests ?? null, short_notice_ok: a?.prn?.short_notice_ok === true })
    }
  } catch { /* no PRN data = nobody is treated as PRN; everything else unchanged */ }
  return out
}

/* The domain that owns coverage. Resolved through the canonical record, the
   same hop Chain 4 uses — never inferred from responsibility counts. */
async function coverageOwner(): Promise<{ owner: string | null; why: string }> {
  const { data: dom } = await sb.from('domains')
    .select('code, label, owner_person, escalation_person')
    .eq('code', 'scheduling_coverage').eq('entity', 'cc_ihs').maybeSingle()
  if (!dom?.owner_person) return { owner: null, why: 'scheduling_coverage has no owner_person' }
  const { data: p } = await sb.from('persons')
    .select('person_id, primary_email').eq('person_id', dom.owner_person).maybeSingle()
  if (!p?.primary_email) return { owner: null, why: 'owner_person has no email' }

  /* DUTY WINDOWS decide who is actively covering today. Accountability stays
     with the domain owner; the duty holder is who the work goes to now. That
     separation is what lets the Staffing Coordinator become accountable owner
     later without rewriting any of this. */
  const { data: dw } = await sb.from('app_data').select('data').eq('key', 'duty_windows').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const windows = (Array.isArray(dw?.data) ? dw!.data : []) as any[]
  const today = new Date().toISOString().slice(0, 10)
  const active = windows.find(w => w?.active !== false && w?.domain === 'scheduling_coverage'
    && (!w.starts_at || String(w.starts_at).slice(0, 10) <= today)
    && (!w.ends_at || String(w.ends_at).slice(0, 10) >= today))
  if (active?.person) {
    return { owner: String(active.person),
             why: `duty window: covering today (accountable owner remains ${p.primary_email})` }
  }
  return { owner: p.primary_email, why: 'scheduling_coverage owner' }
}

/* CANDIDATES.
   Only fields that genuinely exist today. Availability, schedule conflict,
   service area, client requirements, overtime risk and existing relationship
   all need AxisCare and are reported as blocked rather than faked. */
// deno-lint-ignore no-explicit-any
function nameKeyOf(n: string) {
  return n.toLowerCase().replace(/[^a-z ]/g, '').split(/\s+/).filter(Boolean).join(' ')
}

// deno-lint-ignore no-explicit-any
async function candidatesFor(_c: any) {
  /* FOUR ELIGIBILITY STATES, not two.
       ordinary               a field caregiver
       office_not_eligible    holds an office domain, no coverage capability
       office_but_capable     holds an office domain AND an explicit capability
                              row saying they cover shifts
       (backup/field-response is expressed the same way)

     A blanket "holds an office domain" exclusion is too broad and was about to
     remove Cierra and Angiel, who carry explicit capability rows reading
     "Provide direct-care coverage when needed for call-offs". They have said
     they cover shifts. The system should not overrule them.

     This uses the capability model that already exists rather than inventing
     another flag. Identity says who you are; capability says what work you may
     perform; they stay independent. */
  const officeDomain = new Set<string>()
  const coverageCapable = new Set<string>()
  {
    const { data: doms } = await sb.from('domains')
      .select('owner_person, escalation_person').eq('entity', 'cc_ihs')
    const ids = [...new Set((doms ?? []).flatMap(d =>
      [d.owner_person, d.escalation_person].filter(Boolean)))]
    if (ids.length) {
      const { data: ppl } = await sb.from('persons')
        .select('primary_email, full_name').in('person_id', ids)
      for (const p of (ppl ?? [])) {
        if (p.primary_email) officeDomain.add(String(p.primary_email).toLowerCase())
        if (p.full_name) officeDomain.add(nameKeyOf(String(p.full_name)))
      }
    }
    /* Who has explicitly said they cover shifts? */
    const { data: resp } = await sb.from('app_data').select('data')
      .eq('key', 'responsibilities').maybeSingle()
    // deno-lint-ignore no-explicit-any
    for (const r of (Array.isArray(resp?.data) ? resp!.data : []) as any[]) {
      if (r?.active === false) continue
      if (!['capability', 'backup'].includes(String(r?.kind))) continue
      const t = String(r?.text ?? '').toLowerCase()
      if (!/cover|coverage|call-off|call off|open shift|direct-care|direct care/.test(t)) continue
      if (r?.person) coverageCapable.add(String(r.person).toLowerCase())
    }
  }

  /* NURSES ARE NEVER COVERAGE CANDIDATES (Natasha Early got the first live
     callout text, 2026-09-12). The nursing roster is authoritative; a nurse
     appearing on the caregiver roster changes nothing. */
  const nurseNames = new Set<string>()
  {
    const { data: ns } = await sb.from('app_data').select('data').eq('key', 'nurse_staff').maybeSingle()
    // deno-lint-ignore no-explicit-any
    for (const s of (Array.isArray(ns?.data) ? ns!.data : []) as any[])
      if (s?.name) nurseNames.add(nameKeyOf(String(s.name)))
  }

  /* DO-NOT-OFFER LIST (her request, 2026-09-16): caregivers who have told
     the office they can't take on more shifts — an SSI earnings cap is the
     canonical case — are never texted about open shifts, whatever tier they
     would rank. Managed in the hub's Cara tab (app_data key
     coverage_do_not_offer). An entry may carry an `until` date: the block
     holds THROUGH that date and expires on its own the day after (Chicago
     calendar). Matching tries AxisCare id, then phone, then normalised
     name — whichever the entry carries. Empty list = nothing changes.
     A coordinator recording an ask BY HAND is not gated here: this list
     stops Cara's automatic texting, not a human's judgment. */
  const { data: dnoRow } = await sb.from('app_data').select('data').eq('key', 'coverage_do_not_offer').maybeSingle()
  const dnoToday = new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
  const dnoIds = new Set<string>(), dnoPhones = new Set<string>(), dnoNames = new Set<string>()
  // deno-lint-ignore no-explicit-any
  for (const d of (Array.isArray(dnoRow?.data) ? dnoRow!.data : []) as any[]) {
    const until = String(d?.until || '').trim()
    if (/^\d{4}-\d\d-\d\d$/.test(until) && until < dnoToday) continue   // block ended — offerable again
    const id = clean(d?.axiscare_id); if (id) dnoIds.add(id)
    const ph = normalisePhone(d?.phone); if (ph) dnoPhones.add(ph)
    if (d?.name) dnoNames.add(nameKeyOf(String(d.name)))
  }

  const { data } = await sb.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const roster = (Array.isArray(data?.data) ? data!.data : []) as any[]

  const out: Array<Record<string, unknown>> = []
  for (const cg of roster) {
    const name = [clean(cg.first), clean(cg.last)].filter(Boolean).join(' ').trim()
    if (!name) continue
    /* the AxisCare id rides along on every skip (2026-10-24), so the three-group list can hide anyone AxisCare has inactive */
    const axId = clean(cg.axiscare_id) || null
    if (cg.active === false) { out.push({ name, axiscare_id: axId, skipped: 'no longer active' }); continue }
    if (nurseNames.has(nameKeyOf(name))) {
      out.push({ name, axiscare_id: axId, skipped: 'nurse: nursing staff are never coverage candidates' }); continue }
    if ((clean(cg.axiscare_id) && dnoIds.has(clean(cg.axiscare_id)))
        || dnoPhones.has(normalisePhone(cg.phone) ?? '')
        || dnoNames.has(nameKeyOf(name))) {
      out.push({ name, axiscare_id: axId, eligibility: 'do_not_offer',
                 skipped: 'asked not to be offered extra shifts (do-not-offer list)' }); continue }
    /* THE ROSTER MIXES OFFICE STAFF WITH FIELD CAREGIVERS. The dry run named
       Samantha and Krystal in wave 1 — ringing the CEO and the supervisor to
       cover a shift. Nobody who holds an active office domain is a coverage
       candidate, whatever the roster says. Their own capability rows can put
       them back in deliberately; being on the roster is not consent. */
    const key = String(cg.email || '').toLowerCase()
    const isOffice = officeDomain.has(key) || officeDomain.has(nameKeyOf(name))
    const isCapable = coverageCapable.has(key)
    if (isOffice && !isCapable) {
      out.push({ name, axiscare_id: axId, eligibility: 'office_not_eligible',
                 skipped: 'holds an office domain and no coverage capability is recorded' })
      continue
    }
    const eligibility = isOffice ? 'office_but_capable' : 'ordinary'
    const phone = normalisePhone(cg.phone)
    if (!phone) { out.push({ name, axiscare_id: axId, skipped: 'no phone on file' }); continue }

    /* THE GATE. A probable identity may be shown to a human; it may never
       authorise an automatic message. */
    const verdict = await maySendTo(sb, phone)
    out.push({
      name,
      first: clean(cg.first),
      eligibility,
      axiscare_id: clean(cg.axiscare_id) || null,
      phone,                        // full number, for the send stage only —
      phone_last4: phone.slice(-4), // responses expose only the last 4
      confidence: verdict.confidence,
      may_autosend: verdict.allowed,
      skipped: verdict.allowed ? null : verdict.reason,
      /* Driver Compliance (2026-10-13): the roster fields the driver-compliance mirror keeps, for transportEligible */
      dl_status: cg.dl_status ?? null, cleared_to_drive: cg.cleared_to_drive ?? null,
      dl_expires: cg.dl_expires ?? null, auto_ins_expires: cg.auto_ins_expires ?? null,
    })
  }
  return out
}

/* ── WAVE RANKING: worked-with-this-client first, then recently active, then
      everyone else. This is the ordering Samantha described for a call-off
      blast, computed from AxisCare's own visit history now that API access is
      back. (When this engine was first written AxisCare was blocked and waves
      were unranked roster order.)

        tier 1  has visits with THIS client (most recent/most visits first)
        tier 2  worked any shift in the last 14 days (a live field caregiver)
        tier 3  everyone else who passes the gate

      All of it read-only. If the client cannot be resolved to one AxisCare
      id, or AxisCare cannot be reached, the run says so and falls back to
      unranked — degraded and honest beats clever and silent. ─────────────── */

const AC_VERSION = Deno.env.get('AXISCARE_API_VERSION') || '2023-10-01'
function axisCreds() {
  const order = ['AXISCARE_VISITS_TOKEN', 'AXISCARE_API_KEY', 'AXISCARE_TOKEN']
  let token = '', tokenName = ''
  for (const n of order) { const v = Deno.env.get(n); if (v) { token = v; tokenName = n; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  return { token, tokenName, site: /^\d+$/.test(site) ? site : '' }
}

/** Paginated visit fetch; returns rows or an error string, never throws. */
async function fetchVisits(params: string): Promise<{ rows: any[]; error: string | null }> {
  const { token, site } = axisCreds()
  if (!token || !site) return { rows: [], error: 'AxisCare credentials not set on this project' }
  const rows: any[] = []
  await loadNotClients(sb)   /* the not-client list (Office Staff, the Practice client): their visits never count here */
  try {
    let url: string | null = `https://${site}.axiscare.com/api/visits?${params}`
    for (let page = 0; url && page < 12; page++) {
      const r: Response = await fetch(url, { headers: {
        Authorization: `Bearer ${token}`, Accept: 'application/json',
        'X-AxisCare-Api-Version': AC_VERSION } })
      if (!r.ok) return { rows, error: `AxisCare responded ${r.status}` }
      const j: any = await r.json().catch(() => ({}))
      for (const v of (j?.results?.visits ?? j?.visits ?? [])) {
        if (v?.removed || isNotClient(v)) continue
        rows.push(v)
      }
      url = j?.results?.nextPage ?? j?.nextPage ?? j?.results?.nextPageUrl ?? j?.nextPageUrl ?? null
    }
    return { rows, error: null }
  } catch (err) { return { rows, error: String(err) } }
}

const dISO = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10)

/* The care-level rule lives in _shared/care-level.ts (Change 6b): one copy for
   every function and the hub, highest level class held, reports the class read. */

/** The case's client is free text off a phone call. Resolve it to ONE
 *  confirmed AxisCare client id through the identity layer, or say why not. */
async function resolveClientAxisId(clientText: string):
  Promise<{ status: string; id: string | null; detail: string }> {
  const name = clean(clientText)
  if (!name || /not identified|from call|confirm the client|unknown/i.test(name))
    return { status: 'placeholder', id: null,
             detail: 'the case does not name a real client yet. Confirm the client on the case first' }
  const { data: people } = await sb.from('person_identity')
    .select('id, display_name').ilike('display_name', name)
  let ids = [...new Set((people ?? []).map((p: any) => String(p.id)))]
  /* a namesake who is a PAST client never makes a current client "ambiguous" (2026-10-07: historical clients) */
  if (ids.length > 1) {
    const { data: cur } = await sb.from('person_role').select('person_id').eq('role', 'client').eq('status', 'active').in('person_id', ids)
    const curIds = [...new Set((cur ?? []).map((r: any) => String(r.person_id)))]
    if (curIds.length) ids = curIds
  }
  if (ids.length === 0) return { status: 'not_found', id: null,
    detail: `no person named "${name}" in the identity layer` }
  if (ids.length > 1) return { status: 'ambiguous', id: null,
    detail: `${ids.length} people named "${name}"; a human must pick` }
  const { data: src } = await sb.from('person_source_id')
    .select('source_id').eq('person_id', ids[0]).eq('system', 'axiscare')
    .eq('entity_type', 'client').eq('confidence', 'confirmed').eq('needs_review', false)
    .maybeSingle()
  if (!src?.source_id) return { status: 'no_axiscare_id', id: null,
    detail: `"${name}" is known but holds no confirmed AxisCare client id` }
  return { status: 'resolved', id: String(src.source_id), detail: `AxisCare client ${src.source_id}` }
}

/* ── CONCURRENCY GUARDS (review findings 1-3, 2026-09-12 night review) ──────
   The engine can be invoked by cron AND by hand at once, and a run spends
   many seconds on AxisCare/GHL I/O. Guards:
     - a soft lock key so overlapping runs exit instead of double-texting
     - every case write re-reads the CURRENT row and merges, so a caregiver's
       YES landing mid-run (via coverage-reply) is never clobbered by our
       stale snapshot. upsert_app_data_item replaces the whole item; the only
       safe write is fresh-read → merge → write. */
/* ── OPEN HOURS (her ask + "yes to all", 2026-10-12) ─────────────────────────────────────────────────────────────
   One message to the whole team about a Team Builder plan's recurring hours. The plan's days and slots are the grid;
   the ask lives on ONE coverage case per plan (id cwh_<planId>, kind 'interest', open_hours: true), so every reply
   comes back through coverage-reply like any other ask and lands on the plan's squares.
   mode 'preview' (read only): the wording, who would get it and who wouldn't (and why).
   mode 'send': switch ops_settings.open_hours_live; 9am to 6pm Central; up to 20 people per press, everyone eligible
   who hasn't been asked yet (her decision 1: busy people too). Same gates as every Cara ask: active in AxisCare,
   not a nurse, not on No shift texts, not Do Not Return for a named client, the work lock, opt-outs (contactForOutbound),
   and the ask recorded under the case lock BEFORE the text goes (coverage_case_add_ask: never texted twice). */
const OPEN_HOURS_BATCH = 20
// deno-lint-ignore no-explicit-any
async function openHours(body: any, whoName: string, jr: (b: unknown, s?: number) => Response): Promise<Response> {
  const planId = String(body.plan_id || '')
  const { data: pr } = await sb.from('app_data').select('data').eq('key', 'staffing_plans').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const plan: any = (Array.isArray(pr?.data) ? pr!.data : []).find((p: any) => p && String(p.id) === planId)
  if (!plan) return jr({ error: 'no such Team Builder plan' }, 404)
  const days: string[] = (Array.isArray(plan.days) ? plan.days : []).map((d: unknown) => String(d).toLowerCase().slice(0, 3))
  // deno-lint-ignore no-explicit-any
  const slots = (Array.isArray(plan.slots) ? plan.slots : []).filter((x: any) => x && x.k && /^\d\d:\d\d$/.test(String(x.start)) && /^\d\d:\d\d$/.test(String(x.end)))
  const cells = offeredCells(days, slots)
  if (!cells.length) return jr({ error: 'the plan needs at least one day and one shift with a start and end time' }, 400)
  const town = String(plan.city || '').trim()
  if (!town) return jr({ error: 'add the town to the plan first (the text names the town, never the address)' }, 400)
  const { data: setR } = await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const st: any = setR?.data ?? {}
  /* the plan's ask: cwh_<plan>, or an older Cara new-client check the office turned into this plan (linked by plan_id) */
  const { data: allC } = await sb.from('app_data').select('data').eq('key', 'coverage_cases').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const linked = (Array.isArray(allC?.data) ? allC!.data : []).find((x: any) => x && x.open_hours === true && String(x.plan_id) === planId && x.status === 'open')
  const caseId = linked ? String(linked.id) : 'cwh_' + planId.replace(/[^A-Za-z0-9_-]/g, '_')
  const existing = await readCaseFresh(caseId)
  if (existing && existing.status !== 'open') return jr({ error: 'this plan\'s open-hours ask is closed' }, 409)
  const starts = slots.map((x: { start: string }) => x.start).sort(), ends = slots.map((x: { end: string }) => x.end).sort()
  const named = String(plan.client || '').trim()
  const kase = existing ?? {
    id: caseId, kind: 'interest', open_hours: true, plan_id: planId, reason: 'new', status: 'open', asked: [],
    client: named || `Open hours, ${town}`, no_client: !named || !!plan.open_hours, client_city: town, client_zip: String(plan.zip || '') || null,
    interest_days: days, interest_start: starts[0], interest_end: ends[ends.length - 1], slots, offered: cells,
    shift_date: '', shift_time: '', opened_at: nowIso(), opened_by: whoName, admin_alerted: nowIso(),
  }
  /* named clients only: their Do Not Return list applies (decision 1); an open-hours plan with no client has none */
  const pool = await buildCandidatesForCase(kase.no_client ? { ...kase, client: '' } : kase)
  // deno-lint-ignore no-explicit-any
  const everyone: any[] = [...pool.group0, ...pool.prn_other, ...pool.group1, ...pool.group2, ...pool.prn_ongoing]
  const askedKeys = new Set((Array.isArray(kase.asked) ? kase.asked : []).flatMap((a: { phone?: string; axiscare_id?: string; name?: string }) =>
    [a.axiscare_id ? 'ax:' + a.axiscare_id : '', a.name ? 'nm:' + String(a.name).toLowerCase() : ''].filter(Boolean)))
  const notYet = everyone.filter((x) => !(x.axiscare_id && askedKeys.has('ax:' + x.axiscare_id)) && !askedKeys.has('nm:' + String(x.name).toLowerCase()))
  const tmpl = String(kase.msg_broadcast || '') || openHoursText(String(st.open_hours_msg || '') || OPEN_HOURS_DEFAULT, { town, days, slots })
  const whyCount: Record<string, number> = {}
  for (const x of pool.excluded) { const k = String(x.why || 'other').replace(/\s*\(.*$/, '').slice(0, 80); whyCount[k] = (whyCount[k] || 0) + 1 }
  if (body.mode !== 'send') {
    return jr({ ok: true, live: st.open_hours_live === true, window_ok: inSendWindow(), case_id: caseId, exists: !!existing,
      text: tmpl, offered: cells, will_get: notYet.length, already_asked: everyone.length - notYet.length,
      people: notYet.map((x) => ({ name: x.name, busy: x.working_then || (x.conflicts_then ? `${x.conflicts_then} visit${x.conflicts_then === 1 ? '' : 's'} in those hours over the next 2 weeks` : null), town: x.city || null, miles: x.miles ?? null })),
      not_sent: pool.excluded.length, not_sent_why: whyCount })
  }
  if (st.open_hours_live !== true) return jr({ error: 'Texting the whole team is switched off (Owners Hub Admin page, "Open hours: text the whole team"). Nothing was sent.' }, 409)
  if (!inSendWindow()) return jr({ error: 'Texts to the whole team go 9am to 6pm. Nothing was sent; press again in the morning.', held_window: true }, 409)
  const message = String(body.message ?? tmpl).replace(/\s+/g, ' ').trim()
  const bad = checkWording(message); if (bad) return jr({ error: bad + '. Nothing was sent.' }, 400)
  const ghl2 = { token: Deno.env.get('GHL_TOKEN') ?? '', locationId: Deno.env.get('GHL_LOCATION_ID') ?? '' }
  if (!ghl2.token || !ghl2.locationId) return jr({ error: 'GHL credentials not set' }, 502)
  if (!existing) {
    const { error } = await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: { ...kase, msg_broadcast: message } })
    if (error) return jr({ error: 'could not save the ask, so nothing was sent: ' + error.message }, 500)
  } else if (kase.msg_broadcast !== message) {
    await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: { ...(await readCaseFresh(caseId)), msg_broadcast: message } })
  }
  const { data: rosterRow } = await sb.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const roster = (Array.isArray(rosterRow?.data) ? rosterRow!.data : []) as any[]
  const phoneOf = (nm: string) => normalisePhone(roster.find((cg) => nameKeyOf([clean(cg.first), clean(cg.last)].filter(Boolean).join(' ')) === nameKeyOf(nm))?.phone)
  const sent: string[] = [], failed: string[] = [], already: string[] = []
  for (const x of notYet.slice(0, OPEN_HOURS_BATCH)) {
    const phone = phoneOf(String(x.name))
    if (!phone) { failed.push(`${x.name} (no phone on the roster)`); continue }
    const contact = await contactForOutbound(sb, ghl2, { phone, firstName: x.first || x.name }, 'urgent_internal', { audience: 'caregiver', channel: 'sms', sender: 'coverage-run' })
    if (!contact) { failed.push(`${x.name} (refused by the outbound gate or opted out of texts)`); continue }
    const ask = { id: uid(), name: x.name, phone, channel: 'sms', at: nowIso(), state: 'waiting', replied_at: null, tier: 3, auto: false,
      picked_by_coordinator: true, open_hours: true, asked_by: whoName.slice(0, 80), ghl_contact_id: contact.contactId, axiscare_id: x.axiscare_id ?? null }
    const { data: held, error: holdErr } = await sb.rpc('coverage_case_add_ask', { p_id: caseId, p_ask: ask })
    if (holdErr || held !== 'added') { if (held === 'already_asked') already.push(String(x.name)); else failed.push(`${x.name} (could not record the ask, so it was not sent)`); continue }
    let ok = false
    try {
      const r = await fetch('https://services.leadconnectorhq.com/conversations/messages', { method: 'POST',
        headers: { Authorization: `Bearer ${ghl2.token}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'SMS', fromNumber: MO_FROM, contactId: contact.contactId, message: message.replaceAll('{first_name}', x.first || String(x.name).split(' ')[0] || 'there') }) })
      ok = r.ok; if (!r.ok) failed.push(`${x.name} (SMS ${r.status})`)
    } catch { failed.push(`${x.name} (send error)`) }
    if (!ok) { await sb.rpc('coverage_case_remove_ask', { p_id: caseId, p_ask_id: ask.id }); continue }
    sent.push(String(x.name))
    try {
      await fetch(`https://services.leadconnectorhq.com/contacts/${contact.contactId}/tags`, { method: 'POST',
        headers: { Authorization: `Bearer ${ghl2.token}`, Version: '2021-07-28', 'Content-Type': 'application/json' }, body: JSON.stringify({ tags: ['coverage-asked'] }) })
    } catch { /* a missing tag only costs reply routing */ }
  }
  await opEvent(sb, { job: 'coverage-run', verb: 'open_hours_sent', item_id: caseId, area: 'coverage', actor_name: whoName,
    summary: `${whoName} texted ${sent.length} caregiver${sent.length === 1 ? '' : 's'} about open hours in ${town}` + (failed.length ? ` (${failed.length} not sent)` : '') })
  return jr({ ok: true, case_id: caseId, sent, failed, already_asked: already, remaining: Math.max(0, notYet.length - sent.length - already.length - failed.length) })
}

async function readCaseFresh(caseId: string): Promise<any | null> {
  const { data } = await sb.from('app_data').select('data').eq('key', 'coverage_cases').maybeSingle()
  const arr: any[] = Array.isArray(data?.data) ? data!.data : []
  return arr.find(x => x?.id === caseId) ?? null
}
async function appendAskFresh(caseId: string, entry: any): Promise<any | null> {
  const fresh = await readCaseFresh(caseId)
  if (!fresh) return null
  fresh.asked = Array.isArray(fresh.asked) ? fresh.asked : []
  if (!fresh.asked.some((a: any) => a.id === entry.id)) fresh.asked.push(entry)
  fresh.callout_started_at = fresh.callout_started_at || nowIso()
  await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: fresh })
  return fresh
}
/* CI2 (2026-10-03): an office text's board address becomes the admin's own call-in link. A template that already
   says {link} keeps it; one that ends with the board's address (cc.mo-care.com...) has it swapped for {link}. */
const linkTemplate = (t: string) => /\{link\}/.test(t) ? t : (/(https?:\/\/)?cc\.mo-care\.com\S*\s*$/.test(t) ? t.replace(/(https?:\/\/)?cc\.mo-care\.com\S*\s*$/, '{link}') : t)
/* CI1 (2026-10-03): the caregiver night rule, the same one the automatic waves use (9pm to 8am Chicago, from
   ops_settings.coverage_quiet_from/until), now applied on the server to a coordinator's send too: held at night unless
   the shift starts within 3 hours. Interest checks have no shift, so they wait for morning. */
// deno-lint-ignore no-explicit-any
export function caregiverNightHold(c: any, settings: any, now = new Date()): boolean {
  const chiHour = Number(now.toLocaleString('en-US', { timeZone: 'America/Chicago', hour: '2-digit', hour12: false }))
  const qFrom = Number.isFinite(Number(settings?.coverage_quiet_from)) ? Number(settings.coverage_quiet_from) : 21
  const qUntil = Number.isFinite(Number(settings?.coverage_quiet_until)) ? Number(settings.coverage_quiet_until) : 8
  const inQuiet = qFrom > qUntil ? (chiHour >= qFrom || chiHour < qUntil) : (chiHour >= qFrom && chiHour < qUntil)
  if (!inQuiet) return false
  if (!c?.shift_date) return true
  const startHH = String(c.shift_time || '').split('-')[0] || ''
  const chiNow = now.toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).replace(' ', 'T')
  const diffMs = new Date(`${c.shift_date}T${/^\d\d:\d\d$/.test(startHH) ? startHH : '23:59'}:00`).getTime() - new Date(chiNow).getTime()
  return !(diffMs > 0 && diffMs < 3 * 3600000)
}
async function acquireRunLock(): Promise<boolean> {
  try {
    const { data } = await sb.from('app_data').select('data, updated_at').eq('key', 'coverage_run_lock').maybeSingle()
    const at = data?.data?.at ? new Date(String(data.data.at)).getTime() : 0
    if (at && Date.now() - at < 4 * 60000) return false
    await sb.from('app_data').upsert({ key: 'coverage_run_lock',
      data: { at: nowIso() }, updated_at: nowIso() }, { onConflict: 'key' })
    return true
  } catch { return true }   // a broken lock store must not stop callouts
}
async function releaseRunLock() {
  try { await sb.from('app_data').upsert({ key: 'coverage_run_lock',
    data: { at: null }, updated_at: nowIso() }, { onConflict: 'key' }) } catch { /* noop */ }
}

/* ── DO-NOT-RETURN (her rule, 2026-09-19: "be sure to take note of caregivers
   who are marked to not send back … and never suggest them"). AxisCare's API
   exposes NO exclusion field, so the hub's dnr_log is the enforcement point.
   Matching is by normalised names on both sides — the log stores names, not
   ids. Returns the set of caregiver name-keys barred from THIS client. */
async function dnrSetFor(clientName: string): Promise<Set<string>> {
  const barred = new Set<string>()
  const ck = nameKeyOf(String(clientName || ''))
  if (!ck) return barred
  try {
    const { data } = await sb.from('app_data').select('data').eq('key', 'dnr_log').maybeSingle()
    // deno-lint-ignore no-explicit-any
    for (const e of (Array.isArray(data?.data) ? data!.data : []) as any[]) {
      if (!e?.caregiver || !e?.client) continue
      if (nameKeyOf(String(e.client)) === ck) barred.add(nameKeyOf(String(e.caregiver)))
    }
  } catch { /* an unreadable log bars nobody — the wave filter logs it */ }
  return barred
}

/* ── THE COORDINATOR'S PICKER (the 2026-09-19 redesign: "we want Cara to
   flag the potential call-in, then we will go and choose who to send it
   to"). One implementation of the whole eligibility pipeline for ONE case,
   returning it as the two groups the coordinators asked for:

     group1  worked with this client (AxisCare visits, 180 days)
     group2  a good match, never worked with this client
     excluded  everyone else, each with the reason — Do-Not-Return names
               are excluded here and NEVER appear in either group.

   Used by action=candidates (build the list) and action=send_selected
   (re-derived server-side before sending, so a stale or tampered browser
   list can never text somebody the rules exclude). */
// deno-lint-ignore no-explicit-any
async function buildCandidatesForCase(c: any, opts: { v2?: boolean; includeAsked?: boolean } = {}):
  // deno-lint-ignore no-explicit-any
  // deno-lint-ignore no-explicit-any
  Promise<{ group0: any[]; group1: any[]; group2: any[]; prn_other: any[]; prn_ongoing: any[]; excluded: any[]; needs_verification?: any[]; meta: Record<string, unknown> }> {
  // deno-lint-ignore no-explicit-any
  const excluded: any[] = []
  /* THE THREE-GROUP ASK LIST (2026-10-24): each cut carries a code, so the list can tell a non-negotiable limit from a
     care gap a coordinator may review (her rule: Cara never waives a care requirement herself) */
  /* ax_active (2026-10-24, her report "it's putting inactive caregivers in AxisCare in the 3 list"): whether AxisCare's census
     has them active, so a person cut for another reason first (no phone, do-not-offer, the roster) who is inactive in
     AxisCare is only counted on the three-group list, never listed. Read when the cut happens (the census is read by then). */
  const cut = (x: Record<string, unknown>, why: string, code = 'other', extra: Record<string, unknown> = {}) =>
    excluded.push({ name: x.name, why, code, axiscare_id: x.axiscare_id ?? null,
      ax_active: censusUsable ? !!(x.axiscare_id && axisActive.has(String(x.axiscare_id))) : null, ...extra })

  const cands = await candidatesFor(c)
  /* CARA PHASE 1: on when the switch cara_list_live is on, or for the office's side-by-side preview (action candidates_v2) */
  let v2 = opts.v2 === true
  if (!v2) { try { const { data: s0 } = await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle(); v2 = s0?.data?.cara_list_live === true } catch { /* off */ } }

  const clientRes = c.client_axiscare_id
    ? { status: 'resolved', id: String(c.client_axiscare_id), detail: 'from the AxisCare visit' }
    : await resolveClientAxisId(String(c.client ?? ''))

  /* Client care level + address context (cached on the case when possible).
     For an interest check the client may not exist in AxisCare at all — the
     form's town/zip fields are the location then. */
  let clientLv: number | null = typeof c.client_care_level === 'number' ? c.client_care_level : null
  let clientCity = String(c.client_city || '').trim()
  let clientZip = String(c.client_zip || '').trim()
  // deno-lint-ignore no-explicit-any
  let axClientRaw: any = null
  if ((clientLv == null || !clientZip || v2) && clientRes.id) {
    try {
      const { token: t2, site: s2 } = axisCreds()
      if (t2 && s2) {
        const r = await fetch(`https://${s2}.axiscare.com/api/clients/${encodeURIComponent(clientRes.id)}`, {
          headers: { Authorization: `Bearer ${t2}`, Accept: 'application/json',
                     'X-AxisCare-Api-Version': AC_VERSION } })
        // deno-lint-ignore no-explicit-any
        const j: any = await r.json().catch(() => ({}))
        const cl = j?.results?.client ?? j?.results ?? {}
        if (r.ok) axClientRaw = cl
        if (clientLv == null) clientLv = careLevelOf(cl?.classes).level
        if (!clientCity) clientCity = String(cl?.residentialAddress?.city ?? '').trim()
        if (!clientZip) clientZip = String(cl?.residentialAddress?.postalCode ?? cl?.residentialAddress?.zip ?? '').trim()
      }
    } catch { /* no level = filter off, same as the wave */ }
  }

  /* WHO'S ALREADY WORKING DURING THE PROPOSED HOURS (her ask, 2026-09-18,
     for interest checks): when the case carries structured recurring hours
     (interest_days + interest_start/end), count each caregiver's scheduled
     visits over the next 14 days that overlap those weekday windows. A
     caregiver with zero overlaps is genuinely free for the pattern; one
     with several is already committed then. */
  const busyPattern = new Map<string, { count: number; samples: string[] }>()
  const chainPattern = new Map<string, { count: number; sample: string }>()
  const wantDays: string[] = Array.isArray(c.interest_days) ? c.interest_days.map((d: unknown) => String(d).toLowerCase().slice(0, 3)) : []
  const wStart = String(c.interest_start || '').slice(0, 5), wEnd = String(c.interest_end || '').slice(0, 5)
  let patternCheck = ''
  if (wantDays.length && /^\d\d:\d\d$/.test(wStart) && /^\d\d:\d\d$/.test(wEnd) && wEnd > wStart) {
    const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
    const fwd14 = await fetchVisits(`startDate=${dISO(0)}&endDate=${dISO(-14)}`)
    for (const v of fwd14.rows) {
      const id = v?.caregiver?.id; if (id == null) continue
      const s = String(v?.scheduledStartDate ?? v?.startDate ?? '')
      const e = String(v?.scheduledEndDate ?? v?.endDate ?? '')
      const day = s.slice(0, 10); if (!day) continue
      const wd = new Date(day + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase()
      if (!wantDays.includes(wd)) continue
      const vs = s.slice(11, 16), ve = e.slice(11, 16)
      if (!vs || !ve || ve <= vs) continue
      const withWho = firstNamesOf([v?.client?.firstName, v?.client?.lastName]
        .filter(Boolean).join(' ')) || 'another client'
      if (vs < wEnd && ve > wStart) {
        const rec = busyPattern.get(String(id)) ?? { count: 0, samples: [] }
        rec.count++
        if (rec.samples.length < 2)
          rec.samples.push(`${wd[0].toUpperCase() + wd.slice(1)} ${span12(vs + '-' + ve)} with ${withWho}`)
        busyPattern.set(String(id), rec)
      } else {
        /* Drive-chaining, recurring form: already working those weekdays
           right before or after the proposed hours = a natural add-on. */
        const gap = ve <= wStart ? mins(wStart) - mins(ve)
          : vs >= wEnd ? mins(vs) - mins(wEnd) : null
        if (gap != null && gap <= 180) {
          const rec = chainPattern.get(String(id)) ?? { count: 0, sample: '' }
          rec.count++
          if (!rec.sample) rec.sample = ve <= wStart
            ? `${wd[0].toUpperCase() + wd.slice(1)}s they finish ${clock12(ve)} with ${withWho}, right before these hours`
            : `${wd[0].toUpperCase() + wd.slice(1)}s they start ${clock12(vs)} with ${withWho}, right after these hours`
          chainPattern.set(String(id), rec)
        }
      }
    }
    patternCheck = `checked ${wantDays.join('/')} ${wStart}-${wEnd} against the next 14 days${fwd14.error ? ` (schedule read failed: ${fwd14.error})` : ''}`
  }

  /* Census (fail closed, same as the waves), level map, nurse classes —
     and each caregiver's town + zip, for the who-lives-closest sort. */
  const axisActive = new Set<string>(), nurseAxis = new Set<string>()
  const inTrainingAx = new Set<string>()   // 2026-10-22: active in AxisCare but In Training = onboarding, cut once the switch is on
  const caregiverLevel = new Map<string, number>()
  const cgCity = new Map<string, string>(), cgZip = new Map<string, string>(), cgHire = new Map<string, string>()
  // deno-lint-ignore no-explicit-any
  const axCgRaw: any[] = []   // CARA PHASE 1: the census rows, for the skills rules
  let censusError: string | null = null
  {
    const { token, site } = axisCreds()
    if (!token || !site) censusError = 'AxisCare credentials not set'
    else try {
      let url: string | null = `https://${site}.axiscare.com/api/caregivers`
      for (let page = 0; url && page < 12; page++) {
        const r: Response = await fetch(url, { headers: {
          Authorization: `Bearer ${token}`, Accept: 'application/json',
          'X-AxisCare-Api-Version': AC_VERSION } })
        if (!r.ok) { censusError = `AxisCare responded ${r.status}`; break }
        // deno-lint-ignore no-explicit-any
        const j: any = await r.json().catch(() => ({}))
        // deno-lint-ignore no-explicit-any
        const gRows: any[] = Array.isArray(j?.results?.caregivers ?? j?.caregivers)
          ? (j?.results?.caregivers ?? j?.caregivers)
          : Object.values(j?.results?.caregivers ?? j?.caregivers ?? {})
        for (const g of gRows)
          if (g?.status?.active === true && g?.id != null) {
            axisActive.add(String(g.id)); axCgRaw.push(g)
            if (isInTraining(g?.status?.label)) inTrainingAx.add(String(g.id))
            const lv = careLevelOf(g?.classes)
            if (lv.level != null) caregiverLevel.set(String(g.id), lv.level)
            /* Caregivers carry mailingAddress, never residentialAddress —
               the wrong key left proximity ranking blind (2026-09-20 audit). */
            const city = String(g?.mailingAddress?.city ?? g?.residentialAddress?.city ?? '').trim()
            const zip = String(g?.mailingAddress?.postalCode ?? g?.residentialAddress?.postalCode ?? '').trim()
            if (city) cgCity.set(String(g.id), city)
            const hd = String(g?.hireDate ?? g?.hire_date ?? '').slice(0, 10); if (hd) cgHire.set(String(g.id), hd)
            if (zip) cgZip.set(String(g.id), zip)
            const clsArr = Array.isArray(g?.classes) ? g.classes
              : (g?.classes && typeof g.classes === 'object') ? Object.values(g.classes) : []
            // deno-lint-ignore no-explicit-any
            if (clsArr.some((k: any) => /nurse|\bRN\b|\bLPN\b/i.test(String(k?.label ?? k?.code ?? ''))))
              nurseAxis.add(String(g.id))
          }
        url = j?.results?.nextPage ?? j?.nextPage ?? j?.results?.nextPageUrl ?? j?.nextPageUrl ?? null
      }
    } catch (err) { censusError = String(err) }
  }
  const censusUsable = !censusError && axisActive.size > 0

  /* Busy during the shift window — WITH the detail (her call, 2026-09-18:
     "say what they are working during that time"). Busy caregivers stay in
     the list, marked and default-unchecked, instead of vanishing into the
     excluded pile: a coordinator may still ask someone whose nearby shift
     ends right before. */
  const busyThen = new Map<string, { detail: string }>()
  /* DRIVE-CHAINING (her pick #2, 2026-09-18): in rural Missouri the winner
     is often whoever is ALREADY OUT THAT DAY. A non-overlapping visit ending
     within 3 hours before this shift (or starting within 3 after) chains —
     the caregiver is dressed, driving, and nearby. */
  const chainThen = new Map<string, { detail: string; gap: number }>()
  if (c.shift_date && /^\d\d:\d\d-\d\d:\d\d$/.test(String(c.shift_time || ''))) {
    const [shStart, shEnd] = String(c.shift_time).split('-')
    if (shEnd > shStart) {
      const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
      const day = await fetchVisits(`startDate=${c.shift_date}&endDate=${c.shift_date}`)
      for (const v of day.rows) {
        const cg = v?.caregiver?.id; if (cg == null) continue
        const vs = String(v?.scheduledStartDate ?? v?.startDate ?? '').slice(11, 16)
        const ve = String(v?.scheduledEndDate ?? v?.endDate ?? '').slice(11, 16)
        if (!vs || !ve || ve <= vs) continue
        const withWho = firstNamesOf([v?.client?.firstName, v?.client?.lastName]
          .filter(Boolean).join(' ')) || 'another client'
        if (vs < shEnd && ve > shStart) {
          const prev = busyThen.get(String(cg))
          const line = `${span12(vs + '-' + ve)} with ${withWho}`
          busyThen.set(String(cg), { detail: prev ? prev.detail + '; ' + line : line })
        } else {
          const before = ve <= shStart ? mins(shStart) - mins(ve) : null
          const after = vs >= shEnd ? mins(vs) - mins(shEnd) : null
          const gap = before != null ? before : after
          if (gap != null && gap <= 180) {
            const detail = before != null
              ? `finishes ${clock12(ve)} with ${withWho}, ${gap ? gap + ' min' : 'right'} before this shift`
              : `starts ${clock12(vs)} with ${withWho}, ${gap ? gap + ' min' : 'right'} after this shift`
            const prev = chainThen.get(String(cg))
            if (!prev || gap < prev.gap) chainThen.set(String(cg), { detail, gap })
          }
        }
      }
    }
  }

  /* MATCH REPUTATION (her pick #1): the Care Match record already knows who
     clients love. Aggregated per caregiver — favorites, love/concern calls —
     and matched to THIS client when the names line up. Reset/skip records
     never count as opinions. */
  const rep = new Map<string, { favorites: number; loves: number; concerns: number; total: number }>()
  const thisClientRep = new Map<string, { rating: string; favorite: boolean }>()
  try {
    const { data: ciRow } = await sb.from('app_data').select('data').eq('key', 'client_checkins').maybeSingle()
    const caseClientKey = nameKeyOf(String(c.client || ''))
    // deno-lint-ignore no-explicit-any
    for (const e of (Array.isArray(ciRow?.data) ? ciRow!.data : []) as any[]) {
      if (!e?.caregiver || !e?.client || e.skip === true) continue
      const k = nameKeyOf(String(e.caregiver))
      const r = rep.get(k) ?? { favorites: 0, loves: 0, concerns: 0, total: 0 }
      r.total++
      if (e.rating === 'love') r.loves++
      if (e.rating === 'concern' || e.cg_rating === 'concern') r.concerns++
      if (e.want_favorite === true) r.favorites++
      rep.set(k, r)
      if (caseClientKey && nameKeyOf(String(e.client)) === caseClientKey) {
        const cur = thisClientRep.get(k)
        thisClientRep.set(k, { rating: String(e.rating || cur?.rating || ''),
          favorite: e.want_favorite === true || cur?.favorite === true })
      }
    }
  } catch { /* no reputation = no boost, never a block */ }

  /* Worked-with-this-client history (group 1) + recent activity + hunger. SAME TIME OF DAY (her ask 2026-10-24, Dan's
     overnight): each visit's part of the day is kept too, so someone who works this client's overnights is told apart from
     someone who covered a daytime visit (used only with ops_settings.cara_same_time_live on). */
  const history = new Map<string, { visits: number; last: string; same_time: number; same_time_last: string }>()
  const cBands = caseBands(c)
  let sameTimeLive = false
  try { const { data: stS } = await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle(); sameTimeLive = stS?.data?.cara_same_time_live === true } catch { /* off */ }
  if (clientRes.id) {
    const h = await fetchVisits(
      `startDate=${dISO(180)}&endDate=${dISO(0)}&clientIds=${encodeURIComponent(clientRes.id)}`)
    for (const v of h.rows) {
      const cg = v?.caregiver?.id; if (cg == null) continue
      const k = String(cg)
      const day = String(v?.date ?? v?.startDate ?? v?.start ?? '')
      const vb = bandsOfTimes(String(v?.scheduledStartDate ?? v?.startDate ?? '').slice(11, 16), String(v?.scheduledEndDate ?? v?.endDate ?? '').slice(11, 16))
      const same = sameTimeOfDay(cBands, vb)
      const cur = history.get(k) ?? { visits: 0, last: '', same_time: 0, same_time_last: '' }
      history.set(k, { visits: cur.visits + 1, last: day > cur.last ? day : cur.last,
        same_time: cur.same_time + (same ? 1 : 0), same_time_last: same && day > cur.same_time_last ? day : cur.same_time_last })
    }
  }
  const bandWord = cBands.includes('overnight') ? 'overnight' : cBands.length === 1 ? ({ morning: 'morning', afternoon: 'daytime', evening: 'evening' } as Record<string, string>)[cBands[0]] : 'at this time of day'
  const recent = await fetchVisits(`startDate=${dISO(14)}&endDate=${dISO(0)}`)
  const recentlyActive = new Set(recent.rows.map(v => String(v?.caregiver?.id ?? '')).filter(Boolean))
  const wantGap = new Map<string, number>()
  try {
    const { data: avRow } = await sb.from('app_data').select('data').eq('key', 'caregiver_availability').maybeSingle()
    // deno-lint-ignore no-explicit-any
    const av: any[] = Array.isArray(avRow?.data) ? avRow!.data : []
    if (av.length) {
      const fwd = await fetchVisits(`startDate=${dISO(0)}&endDate=${dISO(-7)}`)
      const sched = new Map<string, number>()
      for (const v of fwd.rows) {
        const id = v?.caregiver?.id; if (id == null) continue
        const s = new Date(String(v?.scheduledStartDate ?? v?.startDate ?? '')).getTime()
        const e = new Date(String(v?.scheduledEndDate ?? v?.endDate ?? '')).getTime()
        if (Number.isFinite(s) && Number.isFinite(e) && e > s)
          sched.set(String(id), (sched.get(String(id)) ?? 0) + (e - s) / 3600000)
      }
      for (const a of av) {
        const id = String(a?.axiscare_id ?? ''); if (!id) continue
        const target = Number(a?.target_hours)
        if (Number.isFinite(target)) wantGap.set(id, target - (sched.get(id) ?? 0))
      }
    }
  } catch { /* hunger boost only */ }

  /* NEW HIRES WHO NEED HOURS (her ask and her "B", 2026-10-12): hired in AxisCare in the last 60 days with nothing (or less
     than their weekly target) scheduled in the next 14 days. Tagged on the row and put first among people who fit equally
     well; never a reason to list or leave out anyone. One extra schedule read, only when someone was hired recently. */
  // deno-lint-ignore no-explicit-any
  const newHire = new Map<string, any>()
  try {
    const todayC = new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
    const recent = [...cgHire.entries()].filter(([, d]) => newHireNeed(d, todayC, 0, null))
    if (recent.length) {
      const f14 = await fetchVisits(`startDate=${dISO(0)}&endDate=${dISO(-13)}`)
      const h14 = new Map<string, number>()
      for (const v of f14.rows) {
        const id = v?.caregiver?.id; if (id == null || v?.removed) continue
        const s0 = new Date(String(v?.scheduledStartDate ?? v?.startDate ?? '')).getTime()
        const e0 = new Date(String(v?.scheduledEndDate ?? v?.endDate ?? '')).getTime()
        if (Number.isFinite(s0) && Number.isFinite(e0) && e0 > s0) h14.set(String(id), (h14.get(String(id)) ?? 0) + (e0 - s0) / 3600000)
      }
      const { data: avN } = await sb.from('app_data').select('data').eq('key', 'caregiver_availability').maybeSingle()
      // deno-lint-ignore no-explicit-any
      const tgt = new Map<string, unknown>((Array.isArray(avN?.data) ? avN!.data : []).map((a: any) => [String(a?.axiscare_id ?? ''), a?.target_hours]))
      for (const [id, d] of recent) { const n = newHireNeed(d, todayC, f14.error ? 0 : (h14.get(id) ?? 0), tgt.get(id)); if (n && !f14.error) newHire.set(id, n) }
    }
  } catch { /* the tag is a help, never a gate: no tag rather than a wrong one */ }

  const prnTeam = await prnTeamLoad()
  const ongoingCase = isOngoingCase(c)

  const dnr = await dnrSetFor(String(c.client || ''))
  /* The client's call-in plan (2026-09-27): an only-ask list is followed exactly; a plan
     that can't be read holds everyone rather than guess (fail closed). */
  const planR = await readPlan(sb, clientRes.id, new Map())
  const alreadyAsked = new Set((c.asked ?? []).map((a: { name: string }) =>
    String(a.name || '').toLowerCase()))
  const callerOff = String(c.calling_off || '').toLowerCase()
  const callerOffId = String(c.calling_off_id || '')
  /* SLICE 5: the scheduling lock from the readiness cards (new path only); an unreadable lock holds everyone (fail closed) */
  const lock = await workLock(sb)
  /* IN TRAINING IS ONBOARDING (2026-10-22): ops_settings.in_training_lock_live; off = nobody is cut for it (today's rule) */
  const trainLive = await inTrainingLive(sb)
  /* DRIVER COMPLIANCE (2026-10-13). Her rule: Non-Driver, Pending Verification, Suspended (and no driver record yet) are
     never eligible for a shift that needs transporting the client; only Approved Drivers with a current license and
     insurance. Needs transportation = the client's care needs (need_transportation, latest layer), the lead checklist
     (transportation), or the Team Builder plan's needs (an open-hours ask; the only source when it names no client).
     'Preferred' only ranks those not cleared lower, never cuts. Unknown = not required, and meta says what was unknown.
     All of it only while the Admin switch driver_schedule_gate_live is on; off, nothing is cut or moved (notes only). */
  let planNeeds: unknown = null, planWhy: string | null = null
  if (c.plan_id) {
    try { const { data: pr } = await sb.from('app_data').select('data').eq('key', 'staffing_plans').maybeSingle()
      // deno-lint-ignore no-explicit-any
      const pl = (Array.isArray(pr?.data) ? pr!.data : []).find((p: any) => p && String(p.id) === String(c.plan_id)); planNeeds = pl?.needs ?? null
      if (!pl) planWhy = 'the Team Builder plan was not found' } catch { planWhy = 'the Team Builder plan could not be read' }
  }
  const drive = await readTransportNeed(sb, { clientAxId: clientRes.id, planNeeds })
  const driveUnknown = [planWhy, drive.unknown, !clientRes.id && !c.plan_id ? `the client is not identified (${clientRes.detail}), so their care needs could not be read` : null].filter(Boolean).join('; ') || null
  const driveToday = new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
  /* the rollout switch (Admin page, ops_settings.driver_schedule_gate_live, off by default): off, nobody is cut or moved,
     the check is only noted on the person and in meta */
  const driveLive = await readDriveGate(sb)
  const driveNotes: { name: string; note: string }[] = []

  // deno-lint-ignore no-explicit-any
  const group1: any[] = [], group2: any[] = []
  // deno-lint-ignore no-explicit-any
  const group0: any[] = [], prnOther: any[] = [], prnOngoing: any[] = []   // PRN3
  // deno-lint-ignore no-explicit-any
  const needsVer: any[] = []   // CARA (2026-10-23): expired or missing clearances, listed, never offerable
  const availAll = await availLoad()   // 2026-10-14: availability checked for everyone
  /* CARA PHASE 1 context (only when v2): the week's hours, other open cases and plans (overlapping yeses), the skills rule */
  let weekHrs = new Map<string, number>(), weekNote: string | null = null, shiftLen = 0
  // deno-lint-ignore no-explicit-any
  let otherCases: any[] = [], plans: any[] = []
  let skills: Awaited<ReturnType<typeof loadSkillJudge>> | null = null
  if (v2) {
    shiftLen = shiftHours(String(c.shift_time || ''))
    if (/^\d{4}-\d\d-\d\d$/.test(String(c.shift_date || ''))) {
      let wkStart = 'mon'   // her payroll week: Monday to Sunday (2026-10-23)
      try { const { data: s1 } = await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle(); if (/^(sun|mon|tue|wed|thu|fri|sat)$/.test(String(s1?.data?.payroll_week_start || ''))) wkStart = String(s1!.data.payroll_week_start) } catch { /* mon */ }
      const [a, z] = weekOf(String(c.shift_date), wkStart)
      const wk = await fetchVisits(`startDate=${a}&endDate=${z}`)
      if (wk.error) weekNote = 'weekly hours not checked: ' + wk.error
      else { weekHrs = weekHoursBy(wk.rows); weekNote = `weekly hours counted ${a} to ${z} from the AxisCare schedule` }
    }
    try {
      const [{ data: kc }, { data: kp }] = await Promise.all([sb.from('app_data').select('data').eq('key', 'coverage_cases').maybeSingle(), sb.from('app_data').select('data').eq('key', 'staffing_plans').maybeSingle()])
      otherCases = Array.isArray(kc?.data) ? kc!.data : []; plans = Array.isArray(kp?.data) ? kp!.data : []
    } catch { /* no overlap flags rather than wrong ones */ }
    const { data: rosterRow2 } = await sb.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()
    skills = await loadSkillJudge(sb, { clientAxId: clientRes.id, axClient: axClientRaw, axCaregivers: axCgRaw, roster: Array.isArray(rosterRow2?.data) ? rosterRow2!.data : [], lock, driveGate: driveLive, today: driveToday })
  }
  for (const x of cands) {
    if (x.skipped && !x.may_autosend) { const sk = String(x.skipped); cut(x, sk, /no phone/i.test(sk) ? 'no_phone' : /no longer active/i.test(sk) ? 'inactive' : /^nurse/i.test(sk) ? 'nurse' : /office domain/i.test(sk) ? 'office' : /do-not-offer/i.test(sk) ? 'do_not_offer' : 'skipped'); continue }
    if (dnr.has(nameKeyOf(String(x.name)))) { cut(x, 'Do-Not-Return for this client, never suggested', 'dnr'); continue }
    if (planR.error) { cut(x, "held: the client's call-in plan could not be read (fail closed)", 'held'); continue }
    const planCut = onlyAskCut(planR.plan, x, String(c.client || planR.plan?.client_name || ''))
    if (planCut) { cut(x, planCut, 'plan_only'); continue }
    if (!opts.includeAsked && alreadyAsked.has(String(x.name).toLowerCase())) { cut(x, 'already asked on this case', 'asked'); continue }   // includeAsked: only for Cara recommends, which judges the people who said yes
    if ((callerOff && String(x.name).toLowerCase() === callerOff)
        || (callerOffId && String(x.axiscare_id || '') === callerOffId)) { cut(x, 'the person who called off', 'caller'); continue }
    if (!censusUsable) { cut(x, 'held: AxisCare census unreachable (fail closed)', 'held'); continue }
    if (!x.axiscare_id || !axisActive.has(String(x.axiscare_id))) { cut(x, 'not active in the AxisCare census', 'inactive'); continue }
    if (!lock.ok) { cut(x, 'held: ' + lock.why + ' (fail closed)', 'held'); continue }
    if (lock.axis.has(String(x.axiscare_id)) || (x.offer_id && lock.offers.has(String(x.offer_id)))) { cut(x, LOCK_WHY, 'lock'); continue }
    if (trainLive && inTrainingAx.has(String(x.axiscare_id))) { cut(x, IN_TRAINING_WHY, 'in_training'); continue }
    if (nurseAxis.has(String(x.axiscare_id))) { cut(x, 'nurse-classed in AxisCare', 'nurse'); continue }
    if (clientLv != null) {
      const cgLv = caregiverLevel.get(String(x.axiscare_id))
      if (cgLv != null && cgLv < clientLv) { cut(x, `Level ${cgLv} caregiver; client needs Level ${clientLv}`, 'level', { cg_level: cgLv, client_level: clientLv, care: skills?.detail ? skills.detail(String(x.axiscare_id)) : null }); continue }
    }
    const drv = transportDecision(x, drive.level, driveLive, driveToday)
    if (drv.exclude) { cut(x, `not cleared to drive clients, and this shift needs transportation (${drv.why})`, 'drive', { care: skills?.detail ? skills.detail(String(x.axiscare_id)) : null }); continue }
    if (drv.note) driveNotes.push({ name: String(x.name), note: drv.note })
    /* CARA PHASE 1: the verified-skills rules (match-rules.js): "not for this visit" leaves the list with the rule's reason */
    let skillsLine: string | null = null, clearedLine: string | null = null
    if (v2 && skills?.judge) {
      const sn = skillsNote(skills.judge(String(x.axiscare_id)))
      if (sn.cut) { cut(x, 'Skills rules: ' + sn.cut, skillCode(sn.cut), { care: skills.detail ? skills.detail(String(x.axiscare_id)) : null }); continue }
      skillsLine = sn.note; clearedLine = sn.cleared_note ?? null   /* an expired or missing clearance: Needs Verification (below) */
    }
    const h = history.get(String(x.axiscare_id))
    const gap = wantGap.get(String(x.axiscare_id))
    const gid = String(x.axiscare_id)
    const city = cgCity.get(gid) || null
    const miles = clientZip && cgZip.get(gid) ? zipMiles(clientZip, cgZip.get(gid)!) : null
    const sameTown = !!(city && clientCity && city.toLowerCase() === clientCity.toLowerCase())
    const pat = wantDays.length ? busyPattern.get(gid) : undefined
    const conflicts = wantDays.length ? (pat?.count ?? 0) : null
    /* Already scheduled during the proposed time? They STAY on the list,
       default-unchecked, with the red calendar saying exactly what they're
       working — never silently hidden (her call, 2026-09-18). */
    const single = busyThen.get(gid)
    const working_then = single ? { count: 1, detail: single.detail }
      : (pat && pat.count ? { count: pat.count,
          detail: pat.samples.join('; ') + (pat.count > pat.samples.length ? ` +${pat.count - pat.samples.length} more` : '') }
        : null)
    const chainRec = chainThen.get(gid)
      ?? (chainPattern.get(gid) ? { detail: chainPattern.get(gid)!.sample
            + (chainPattern.get(gid)!.count > 1 ? ` (${chainPattern.get(gid)!.count} days like this)` : ''),
          gap: 0 } : undefined)
    const nameK = nameKeyOf(String(x.name))
    const repRec = rep.get(nameK)
    const mine = thisClientRep.get(nameK)
    const row = {
      name: x.name, first: x.first, axiscare_id: x.axiscare_id,
      phone_last4: x.phone_last4,
      level: caregiverLevel.get(gid) ?? null,
      wants_more_hours: gap != null && gap > 0 ? Math.round(gap) : null,
      new_hire: newHire.get(gid) ?? null,   // a new hire who still needs hours (2026-10-12)
      recently_active: recentlyActive.has(gid),
      history: h ? { visits: h.visits, last: h.last, same_time: h.same_time, same_time_last: h.same_time_last } : null,
      city, miles, same_town: sameTown,
      free_then: conflicts == null ? null : conflicts === 0,
      conflicts_then: conflicts,
      working_then,
      chain: (!working_then && chainRec) ? { detail: chainRec.detail } : null,
      rep: repRec ? { favorites: repRec.favorites, loves: repRec.loves,
        concerns: repRec.concerns, total: repRec.total } : null,
      this_client: mine ? { rating: mine.rating, favorite: mine.favorite } : null,
      drive_note: drv.note, drive_lower: drv.rankLower,
      why: h ? `${h.visits} visit${h.visits === 1 ? '' : 's'} with this client` + (sameTimeLive && cBands.length ? `, ${h.same_time} ${bandWord}` : '') + `, last ${dayWord(h.last)}`
        : recentlyActive.has(gid) ? 'worked a shift in the last 14 days'
        : 'active caregiver, no recent history',
    }
    /* 2026-10-14: outside the times they gave us = listed, unticked, with the reason (a person can still ask them on
       purpose); outside but they said OK to texts about those = ticked as usual, with the note. PRN keep their own rule. */
    const av = availCheck(c, availAll.get(gid))
    if (av.outside) Object.assign(row, av.ok ? { outside_ok_note: av.why + ', said OK to texts about those' } : { outside_avail: av.why })
    /* CARA PHASE 1: Unknown is its own state (her rule 2026-10-17), plus the week's hours, overlapping yeses and the skills note */
    if (v2) {
      const st2 = availStatus(c, availAll.get(gid))
      Object.assign(row, { avail_state: st2.state, avail_unknown: st2.state === 'unknown' ? UNKNOWN_WHY : null,
        hours: weekNote && !/not checked/.test(weekNote) ? hoursFlag(weekHrs.get(gid) ?? 0, shiftLen, availAll.get(gid)?.target_hours as number | null) : null,
        overlaps: overlapsFor(c, { axiscare_id: gid, name: String(x.name) }, otherCases, plans), skills_note: skillsLine, cleared_note: clearedLine })
      /* her wave rules (_shared/cara-waves.ts): their availability for the whole shift, and a PRN member's own answers */
      const avw = availAll.get(gid), pmw = prnTeam.get(gid)
      Object.assign(row, { windows: avw?.windows ?? null, outside_ok: avw?.outside_ok === true,
        prn_pref: pmw ? { notice: pmw.notice, days: pmw.days ?? null, times: pmw.times ?? null, interests: pmw.interests ?? null, short_notice_ok: pmw.short_notice_ok === true } : null })
    }
    /* NEEDS VERIFICATION (Samantha, 2026-10-23): "caregivers with expired or missing required clearances cannot receive shift
       offers until they're verified as eligible. They can appear in the list marked Needs Verification so our office knows
       why they aren't eligible." Listed apart with the reason, never in a group: send_selected and Send Cara's list only
       send from the groups, so nobody here can be texted from this list. */
    if (v2 && clearedLine) { needsVer.push({ ...row, needs_verification: 'Needs Verification: ' + clearedLine.replace(/^Not cleared to work: /, '') }); continue }
    /* PRN3: the PRN CNA Team gets its own place, never mixed into the groups everyone else is ticked from. */
    const pm = prnTeam.get(gid)
    if (pm) {
      const f = prnFit(c, pm, !!working_then)
      const withPrn = { ...row, prn: { fit: f.fit, why: f.why, notice: pm.notice, confirmed_at: pm.confirmed_at } }
      if (ongoingCase) prnOngoing.push(withPrn)
      else if (f.fit) group0.push(withPrn)
      else prnOther.push(withPrn)
      continue
    }
    if (h) group1.push(row); else group2.push(row)
  }
  /* PRN who fit: somebody who knows the client first, then the most recently confirmed availability, then distance. */
  group0.sort((a, b) => ((b.history?.visits ?? 0) - (a.history?.visits ?? 0))
    || String(b.prn?.confirmed_at || '').localeCompare(String(a.prn?.confirmed_at || ''))
    || ((a.miles ?? 9999) - (b.miles ?? 9999)))
  /* Busy sinks; the client's own favorite leads their group; a chained
     schedule beats raw distance; then the old ranking. "Who could actually
     take this and delight the client" reads top-down. */
  group1.sort((a, b) => ((a.outside_avail ? 1 : 0) - (b.outside_avail ? 1 : 0))   // outside their availability sinks (2026-10-14)
    || ((a.working_then ? 1 : 0) - (b.working_then ? 1 : 0))
    || (sameTimeLive ? ((b.history?.same_time ? 1 : 0) - (a.history?.same_time ? 1 : 0)) : 0)   /* her ask: same time of day first */
    || ((b.new_hire ? 1 : 0) - (a.new_hire ? 1 : 0))   /* her "B": a new hire who needs hours first among equal fits */
    || ((b.this_client?.favorite ? 1 : 0) - (a.this_client?.favorite ? 1 : 0))
    || (sameTimeLive ? (b.history?.same_time ?? 0) - (a.history?.same_time ?? 0) : 0)
    || (b.history?.visits ?? 0) - (a.history?.visits ?? 0))
  group2.sort((a, b) =>
    ((a.outside_avail ? 1 : 0) - (b.outside_avail ? 1 : 0))   // outside their availability sinks (2026-10-14)
    || ((a.working_then ? 1 : 0) - (b.working_then ? 1 : 0))
    || ((b.free_then === true ? 1 : 0) - (a.free_then === true ? 1 : 0))
    || ((b.new_hire ? 1 : 0) - (a.new_hire ? 1 : 0))   /* her "B": among people who fit equally well, the new hire who needs hours first */
    || ((b.chain ? 1 : 0) - (a.chain ? 1 : 0))
    || ((b.rep?.favorites ?? 0) - (a.rep?.favorites ?? 0))
    || ((a.miles ?? 9999) - (b.miles ?? 9999))
    || (Number(b.recently_active) - Number(a.recently_active))
    || ((b.wants_more_hours ?? -999) - (a.wants_more_hours ?? -999)))

  /* CARA PHASE 1 order (v2 only): a stated fit, then Unknown, then outside; then nobody already working, overlapping a
     yes, or into overtime; inside that the order above is kept (Array.sort is stable) */
  if (v2) {
    // deno-lint-ignore no-explicit-any
    const k2 = (r: any) => availRank(r.avail_state) * 8 + (r.working_then ? 4 : 0) + ((r.overlaps || []).length ? 2 : 0) + (r.hours?.level === 'ot' ? 1 : 0)
    for (const g of [group0, group1, group2]) g.sort((a, b) => k2(a) - k2(b))
  }
  /* driving only preferred: the same order, with everyone not cleared to drive moved after everyone who is (stable) */
  if (drive.level === 'preferred' && driveLive) for (const g of [group0, group1, group2, prnOther, prnOngoing]) {
    const yes = g.filter((r) => !r.drive_lower), no = g.filter((r) => r.drive_lower); g.splice(0, g.length, ...yes, ...no) }
  return { group0, group1, group2, prn_other: prnOther, prn_ongoing: prnOngoing, excluded, needs_verification: needsVer, meta: {
    transport: { level: drive.level, from: drive.from, unknown: driveUnknown, enforced: driveLive, notes: driveNotes,
      rule: drive.level && !driveLive ? 'Driver check (not enforced yet): the Admin switch "Only Approved Drivers get shifts that need transportation" is off, so nobody is left out or moved; each person not cleared carries the note'
        : drive.level === 'required' ? 'needs transportation: only Approved Drivers with a current license and insurance are listed'
        : drive.level === 'preferred' ? 'transportation preferred: people not cleared to drive are listed after the rest, never left out'
        : 'no transportation need on record' + (driveUnknown ? ' (not determined: ' + driveUnknown + ')' : '') },
    prn_case: ongoingCase ? 'regular opening: PRN members listed apart (taking it would mean moving to ongoing at $18)' : 'call-off or one-time: PRN members who fit are asked first',
    client_resolution: `${clientRes.status}: ${clientRes.detail}`,
    client_level: clientLv,
    client_city: clientCity || null, client_zip: clientZip || null,
    hours_check: patternCheck || null,
    census: censusUsable ? `${axisActive.size} active caregivers` : `UNREACHABLE (${censusError || 'empty'}), everyone held, fail closed`,
    dnr_barred: dnr.size,
    callin_plan: planR.plan ? planLine(planR.plan) : null,
    callin_plan_note: planR.plan?.note ?? null,
    callin_plan_unreadable: planR.error,
    cara_list: v2 ? { on: true, skills: skills?.why ?? ('checked with match-rules ' + (skills?.rule_version || '')), client_state: skills?.client_state ?? null, hours: weekNote, availability_rule: 'no availability on file = Unknown, listed after a stated fit, never counted as a fit' } : { on: false },
  } }
}

/* ── CARA PHASE 2 PART A · "LET CARA RUN IT" (Samantha, 2026-10-24) ────────────────────────────────────────────────
   A coordinator hands one case to Cara (cara_run, one row per case). Every 3 minutes, and right after an office tap,
   caraAdvance() takes the case for 90 seconds (the lease), decides with _shared/cara-run.ts and acts: a wave (claimed
   before any text goes, then sendAsksTo: the coordinator's own gates and wording), a pause on the first full-shift yes
   that can be confirmed (the office is told; nothing is assigned), resuming when the office says "Not this one" or doesn't
   answer in time, or stopping and handing it to the office. Every write names the version it read.
   Switch ops_settings.cara_run_live (off): only owners can start one, and it's a PRACTICE run: the waves are worked out
   and recorded as "would text", nobody is texted and no office item or text is made. Part B (after hours, by itself) is
   not here. */
// deno-lint-ignore no-explicit-any
type Run = any
const CARA_ITEM = (caseId: string) => `ops_cararun_${caseId}`
async function caraRunRead(caseId: string): Promise<Run | null> {
  const { data } = await sb.from('cara_run').select('*').eq('case_id', caseId).maybeSingle()
  return data ?? null
}
/** One write, only if nobody else wrote since this copy was read. null = someone did (read again and decide again). */
async function caraRunWrite(run: Run, patch: Record<string, unknown>): Promise<Run | null> {
  const { data, error } = await sb.from('cara_run').update({ ...patch, version: Number(run.version) + 1, updated_at: nowIso() })
    .eq('case_id', run.case_id).eq('version', run.version).select().maybeSingle()
  return error ? null : (data ?? null)
}
async function caraEvent(run: Run, kind: string, actor: string, summary: string, detail: Record<string, unknown> = {}) {
  try { await sb.from('cara_run_event').insert({ case_id: run.case_id, run_no: run.run_no ?? 1, kind, actor, summary: summary.slice(0, 500), detail }) }
  catch { /* the history is an observer; the run itself is already saved */ }
}
// deno-lint-ignore no-explicit-any
async function caraItem(c: any, run: Run, title: string, detail: string, urgency: 'high' | 'urgent' = 'high') {
  const id = CARA_ITEM(String(c.id))
  const { data: oi } = await sb.from('app_data').select('data').eq('key', 'ops_items').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const prev = (Array.isArray(oi?.data) ? oi!.data : []).find((x: any) => String(x?.id) === id)
  const item: Record<string, unknown> = { ...(prev || {}), id, kind: 'coverage', coverage_case_id: c.id, title, about: c.client || '', detail,
    domain: 'scheduling_coverage', status: 'open', urgency, created_at: prev?.status === 'open' ? prev.created_at : nowIso(),
    due: new Date(Date.now() + 15 * 60000).toISOString(), created_by: 'coverage-run', opened_by: 'cara_run', cara_run_status: run.status }
  if (!prev || prev.status !== 'open') { item.owner = ''; item.owner_name = '' }
  await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item })
}
async function caraItemDone(caseId: string, why: string) {
  try {
    const id = CARA_ITEM(caseId)
    const { data: oi } = await sb.from('app_data').select('data').eq('key', 'ops_items').maybeSingle()
    // deno-lint-ignore no-explicit-any
    const prev = (Array.isArray(oi?.data) ? oi!.data : []).find((x: any) => String(x?.id) === id)
    if (prev && prev.status === 'open') await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { ...prev, status: 'done', closed_at: nowIso(), closed_by: 'Cara', close_note: why.slice(0, 200) } })
  } catch { /* a card left open is visible; the run is already saved */ }
}
// deno-lint-ignore no-explicit-any
async function caraTellOffice(c: any, line: string, anyHour = false): Promise<string[]> {
  try {
    const { data: stR } = await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
    const ghlT = { token: Deno.env.get('GHL_TOKEN') ?? '', locationId: Deno.env.get('GHL_LOCATION_ID') ?? '' }
    if (!ghlT.token || !ghlT.locationId) return []
    return await textCaseAdmins(sb, ghlT, stR?.data ?? {}, c, (link) => withLink(line, link), { anyHour })
  } catch { return [] }
}
const caraWhen = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }).replace(' ', '').toLowerCase()

/** Move one run forward. Safe to call from anywhere at any time: the lease and the version checks make a second caller a no-op. */
// deno-lint-ignore no-explicit-any
async function caraAdvance(caseId: string, st: any): Promise<string> {
  const run0 = await caraRunRead(caseId)
  if (!run0 || !LIVE_STATES.includes(run0.status)) return 'not_running'
  const lease = uid()
  const { data: claimed } = await sb.from('cara_run').update({ lease_id: lease, lease_until: new Date(Date.now() + 90000).toISOString(), version: Number(run0.version) + 1, updated_at: nowIso() })
    .eq('case_id', caseId).eq('version', run0.version).or(`lease_until.is.null,lease_until.lt.${nowIso()}`).select().maybeSingle()
  if (!claimed) return 'busy'
  let cur: Run = claimed
  const save = async (patch: Record<string, unknown>, keepLease = false) => {
    const w = await caraRunWrite(cur, keepLease ? patch : { ...patch, lease_id: null, lease_until: null }); if (w) cur = w; return w
  }
  let outcome = 'waited'
  try {
    for (let pass = 0; pass < 3; pass++) {
      const c = await readCaseFresh(caseId)
      const caseOpen = !!c && c.status === 'open'
      const live = cur.practice !== true
      if (caseOpen && live && (st.cara_run_live !== true || st.coverage_send_live !== true)) {
        const why = st.cara_run_live !== true ? 'the "Let Cara run it" switch was turned off' : 'caregiver texting (coverage_send_live) was turned off'
        if (await save({ status: 'stopped', ended_by: 'Cara', ended_at: nowIso(), end_why: `Stopped: ${why}` })) {
          await caraEvent(cur, 'stopped', 'Cara', `Cara stopped: ${why}. Nothing more will be sent.`)
          await caraItemDone(caseId, 'Cara stopped (switch off)')
        }
        return 'stopped_switch'
      }
      const m = c ? minsToStart(c, chiNowNaive()) : null
      const rules = runRules(st, m)
      let fullYes: { ask_id: string; name: string }[] = []
      if (caseOpen && Array.isArray(c.asked) && c.asked.some((a: { state?: string }) => a?.state === 'yes')) {
        const pool = await buildCandidatesForCase(c, { v2: true, includeAsked: true })
        const rows = [...pool.group0, ...pool.prn_other, ...pool.group1, ...pool.group2, ...pool.prn_ongoing]
        const b = boardOf(c, rows, pool.excluded, pool.needs_verification || [])
        // deno-lint-ignore no-explicit-any
        fullYes = b.people.filter((p: any) => p.can_confirm && p.ask_id).sort((x: any, y: any) => String(x.replied_at || '').localeCompare(String(y.replied_at || '')))
          // deno-lint-ignore no-explicit-any
          .map((p: any) => ({ ask_id: String(p.ask_id), name: String(p.name) }))
      }
      const what = c ? caseWhat(c) : 'the shift'
      const mEnd = c && m != null ? m + shiftLenMin(c) : null
      let step = nextStep(cur, { now: new Date(), caseOpen, minsToStart: m, minsToEnd: mEnd, fullYes, night: !!c && caregiverNightHold(c, st), rules })
      /* THE LAST 2 HOURS (her rule 2026-10-24): tell the office once that Cara keeps going, faster and wider; then carry on */
      if (step.do === 'urgent') {
        const at = nowIso()
        if (!(await save({ urgent_at: at }))) return 'conflict'
        await caraEvent(cur, 'urgent', 'Cara', `Under ${Math.round(rules.stopBefore / 6) / 10} hours to the shift: Cara keeps asking, ${rules.size} at a time every ${rules.gap} minutes, until someone says yes, the list runs out or the shift ends.`)
        if (live && c) {
          await caraItem(c, cur, `Under 2 hours: Cara is still asking for ${c.client || 'this shift'} (faster now)`, `Cara keeps asking ${rules.size} at a time every ${rules.gap} minutes. "Ask everyone now" texts everyone eligible at once. Call people too.`, 'urgent')
          await caraTellOffice(c, `Cara: ${what} starts in under 2 hours and nobody has said yes. Cara keeps asking, faster now. Call people too: {link}`, true)
        }
        step = nextStep({ ...cur, urgent_at: at }, { now: new Date(), caseOpen, minsToStart: m, minsToEnd: mEnd, fullYes, night: !!c && caregiverNightHold(c, st), rules })
      }
      if (step.do === 'finish') {
        const why = !c ? 'The case is no longer on the board' : c.resolved_how === 'covered' ? `Covered: ${c.covered_by || 'confirmed'} (confirmed by ${c.confirmed_by || 'the office'})`
          : `Closed by ${c.confirmed_by || 'the office'}: ${String(c.resolved_how || 'closed').replaceAll('_', ' ')}`
        if (await save({ status: 'done', ended_by: c?.confirmed_by || 'the office', ended_at: nowIso(), end_why: why, needs: null })) {
          const ax = c?.axiscare_assignment
          await caraEvent(cur, 'finished', String(c?.confirmed_by || 'the office'), why + (c?.resolved_how === 'covered'
            ? (['assigned', 'already'].includes(String(ax?.status)) ? '. On the AxisCare visit (checked).' : `. Not checked on AxisCare: ${ax?.detail || 'put them on the visit by hand'}.`) : '.'))
          await caraItemDone(caseId, why)
        }
        return 'finished'
      }
      if (step.do === 'wait') { await save({}); return 'waited' }
      if (step.do === 'pause') {
        const by = new Date(Date.now() + rules.confirmWait * 60000).toISOString()
        if (!(await save({ status: 'paused', paused_ask_id: step.ask_id, paused_name: step.name, paused_at: nowIso(), confirm_by: by,
          seen_yes: [...(Array.isArray(cur.seen_yes) ? cur.seen_yes : []), step.ask_id] }))) return 'conflict'
        if (live) {
          await caraItem(c, cur, `Cara paused: ${step.name} said yes to the whole shift for ${c.client || 'the client'}. Confirm, or "Not this one"`,
            `Cara stopped asking. Confirm ${step.name} on the board (it puts them on the AxisCare visit and checks it), or tap "Not this one" and Cara keeps asking. No answer by ${caraWhen(by)} and Cara keeps asking; ${step.name}'s yes stays on the board.`)
          const to = await caraTellOffice(c, `Cara: ${step.name} said yes to the whole shift for ${what}. Cara stopped asking. Confirm or tap Not this one: {link}`)
          await caraEvent(cur, 'paused', 'Cara', `${step.name} said yes to the whole shift. Cara stopped asking and told the office${to.length ? ` (texted ${to.length})` : ''}. Waiting for a confirm until ${caraWhen(by)}.`, { ask_id: step.ask_id, texted: to })
          await opEvent(sb, { job: 'coverage-run', verb: 'cara_run_paused', item_id: caseId, area: 'coverage', summary: `Cara paused on ${what}: ${step.name} said yes to the whole shift` })
        } else await caraEvent(cur, 'paused', 'Cara', `Practice: ${step.name} said yes to the whole shift. Cara would stop asking and tell the office (nobody was told). Waiting until ${caraWhen(by)}.`, { ask_id: step.ask_id })
        return 'paused'
      }
      if (step.do === 'resume') {
        if (!(await save({ status: 'running', paused_ask_id: null, paused_name: null, paused_at: null, confirm_by: null, next_wave_at: nowIso() }, true))) return 'conflict'
        await caraEvent(cur, 'resumed', 'Cara', `${step.why}. Cara is asking again${step.escalate ? '; the yes stays on the board' : ''}.`, { escalate: step.escalate })
        if (live && step.escalate && c) {
          await caraItem(c, cur, `No answer on ${c.client || 'the client'}'s yes: Cara is asking more caregivers`, `${step.why}. Their yes is still on the board and can be confirmed. Cara has gone back to asking.`, 'urgent')
          await caraTellOffice(c, `Cara: nobody confirmed the yes for ${what}, so Cara is asking more caregivers. The yes is still on the board: {link}`)
        }
        outcome = 'resumed'
        continue   // the next wave can go in this same pass
      }
      if (step.do === 'needs_office') {
        if (!(await save({ status: 'needs_office', needs: step.why }))) return 'conflict'
        await caraEvent(cur, 'needs_office', 'Cara', `Cara stopped asking: ${step.why}. The office needs to take it from here.`)
        if (live && c) {
          await caraItem(c, cur, `Cara stopped on ${c.client || 'a shift'}: the office needs to take it`, `${step.why}. Everyone Cara asked, and every answer, is on the board.`, 'urgent')
          await caraTellOffice(c, `Cara stopped on ${what}: ${step.why}. Please take it from here: {link}`, (m ?? 9999) < 180)
          await opEvent(sb, { job: 'coverage-run', verb: 'cara_run_needs_office', item_id: caseId, area: 'coverage', summary: `Cara stopped on ${what}: ${step.why}` })
        }
        return 'needs_office'
      }
      if (step.do === 'hold_night') {
        const until = nextMorning(new Date(), Number.isFinite(Number(st.coverage_quiet_until)) ? Number(st.coverage_quiet_until) : 8)
        if (!(await save({ held_until: until, next_wave_at: until }))) return 'conflict'
        await caraEvent(cur, 'night', 'Cara', `Quiet hours: wave ${(Number(cur.wave) || 0) + 1} waits until ${caraWhen(until)}.`)
        return 'held_night'
      }
      if (step.do === 'wave') {
        /* HER WAVE RULES (2026-10-24, _shared/cara-waves.ts): hard exclusions, whole-shift availability, PRN notice, the
           familiar-first order and urgent same-day parts. Switch cara_wave_rules_live off: the waves work as before and each
           records who these rules would have asked instead. */
        const rulesLive = st.cara_wave_rules_live === true
        const asked0 = Array.isArray(c.asked) ? c.asked : []
        const p2 = await buildCandidatesForCase(c, { v2: true })
        const all2 = [...p2.group0, ...p2.prn_other, ...p2.group1, ...p2.group2, ...p2.prn_ongoing]
        const judged = judgeForWaves(all2, c, { minsToStart: m, ongoing: isOngoingCase(c), sameTime: st.cara_same_time_live === true })
        const since0 = (Number(cur.wave) || 0) - (Number(cur.wave_base) || 0)
        const v2pick = pickWaveV2(judged.ordered, asked0, { size: rules.size, wavesLeft: Math.max(1, rules.maxWaves - since0), urgent: m != null && m <= 1440,
          partSlots: Number.isFinite(Number(st.cara_wave_part_slots)) ? Math.max(0, Math.min(rules.size, Number(st.cara_wave_part_slots))) : 2 })
        // deno-lint-ignore no-explicit-any
        let who: any[]
        if (rulesLive) {
          // deno-lint-ignore no-explicit-any
          const byName = new Map(sendableOf(p2).map((x: any) => [String(x.name).toLowerCase(), x]))
          who = v2pick.map((j) => byName.get(String(j.row.name).toLowerCase())).filter(Boolean)
            // deno-lint-ignore no-explicit-any
            .map((x: any) => ({ ...x, prn_ask: !!x.prn_pref && !isOngoingCase(c) }))
        } else {
          const pool1 = await buildCandidatesForCase(c)
          const pref = st.cara_list_live === true ? all2 : null
          who = pickWave(waveOrder(sendableOf(pool1), pref as never), asked0, rules.size)
        }
        const rulesNote = { rules: rulesLive ? 'her wave rules' : 'before her wave rules (switch off)',
          rules_would: rulesLive ? null : v2pick.map((j) => String(j.row.name) + (j.avail.state === 'partial' ? ' (part of it)' : '')),
          left_out: judged.excluded.slice(0, 40), to_clarify: judged.conflicts.slice(0, 20) }
        if (!who.length) {
          const why = 'Nobody left on Cara\'s list who hasn\'t been asked'
          if (!(await save({ status: 'needs_office', needs: why }))) return 'conflict'
          await caraEvent(cur, 'needs_office', 'Cara', `Cara stopped asking: ${why}. The office needs to take it from here.`)
          if (live) { await caraItem(c, cur, `Cara stopped on ${c.client || 'a shift'}: nobody left to ask`, `${why}. Everyone Cara asked, and every answer, is on the board.`, 'urgent')
            await caraTellOffice(c, `Cara stopped on ${what}: ${why}. Please take it from here: {link}`, (m ?? 9999) < 180) }
          return 'needs_office'
        }
        /* THE WAVE IS CLAIMED BEFORE ANY TEXT: if this run dies halfway, the wave is not sent again; the people it didn't
           reach are simply in the next wave (they were never asked) */
        const next = new Date(Date.now() + rules.gap * 60000).toISOString()
        if (!(await save({ wave: step.n, next_wave_at: next, held_until: null }, true))) return 'conflict'
        // deno-lint-ignore no-explicit-any
        const names = who.map((x: any) => String(x.name) + (x.prn_ask ? ' (PRN)' : ''))
        if (!live) {
          await caraEvent(cur, 'wave', 'Cara', `Practice: wave ${step.n} would text ${names.length}: ${names.join(', ')}. Nobody was texted. Next wave not before ${caraWhen(next)}.`
            + (rulesNote.rules_would ? ` Her wave rules would ask: ${rulesNote.rules_would.join(', ') || 'nobody'}.` : ''), { would_text: names, ...rulesNote })
        } else {
          const res = await sendAsksTo(c, st, who, { askedBy: `Cara (started by ${cur.started_by})`, caraWave: step.n, caraRunNo: cur.run_no ?? 1 })
          await caraEvent(cur, 'wave', 'Cara', `Wave ${step.n} sent to ${res.sent.length}: ${res.sent.join(', ') || 'nobody'}`
            + (res.failed.length ? `. Not sent: ${res.failed.join('; ')}` : '') + (res.already.length ? `. Already asked: ${res.already.join(', ')}` : '')
            + `. Next wave not before ${caraWhen(next)}.`, { sent: res.sent, failed: res.failed, already: res.already, ...rulesNote })
          await opEvent(sb, { job: 'coverage-run', verb: 'cara_run_wave', item_id: caseId, area: 'coverage', summary: `Cara wave ${step.n} on ${what}: texted ${res.sent.length}` })
        }
        await save({})
        return 'wave'
      }
    }
    return outcome
  } finally {
    /* the lease is let go however this ended (a failed write leaves it to run out in 90 seconds) */
    if (cur.lease_id === lease) await caraRunWrite(cur, { lease_id: null, lease_until: null })
  }
}

/** The three groups for one case (her ask-list rules): the list with everyone already asked kept, judged by her wave rules. */
// deno-lint-ignore no-explicit-any
async function askListFor(kase: any, st: any): Promise<{ groups: any; meta: any }> {
  const p = await buildCandidatesForCase(kase, { v2: true, includeAsked: true })
  const judged = judgeForWaves([...p.group0, ...p.prn_other, ...p.group1, ...p.group2, ...p.prn_ongoing, ...(p.needs_verification || [])], kase,
    { minsToStart: minsToStart(kase, chiNowNaive()), ongoing: isOngoingCase(kase), sameTime: st?.cara_same_time_live === true })
  return { groups: threeGroups(kase, judged.ordered, judged.excluded, p.excluded), meta: p.meta }
}
/** A visit's date as the office reads it ("Oct 24"), from AxisCare's "2026-10-24T07:45:00-05:00" (2026-10-24, her screenshots). */
export function dayWord(iso: unknown): string {
  const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(String(iso || '')); if (!m) return '?'
  return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1] + ' ' + Number(m[3])
}
/** The bonus the office set on this case, in whole dollars (0 = none). */
// deno-lint-ignore no-explicit-any
export function bonusOf(c: any): number { const n = Math.round(Number(c?.bonus?.amount)); return Number.isFinite(n) && n > 0 && n <= 500 ? n : 0 }
/** The ask with the bonus said plainly, before "Reply YES" when the text has it, else at the end. */
export function withBonus(message: string, amount: number): string {
  const line = `$${amount} bonus for taking this shift.`
  if (message.includes(line)) return message
  const i = message.search(/\s*(Can you take it\?|Reply YES)/)
  return i > 0 ? message.slice(0, i) + ' ' + line + message.slice(i) : message.trimEnd() + ' ' + line
}
/** The shift's length in minutes (an overnight wraps), 0 when it has no time. */
// deno-lint-ignore no-explicit-any
export function shiftLenMin(c: any): number {
  const mm = /^(\d\d):(\d\d)-(\d\d):(\d\d)$/.exec(String(c?.shift_time || ''))
  if (!mm) return 0
  const a = Number(mm[1]) * 60 + Number(mm[2]), z = Number(mm[3]) * 60 + Number(mm[4])
  return z > a ? z - a : z + 1440 - a
}
/** Why Cara can't take this case, or null. */
// deno-lint-ignore no-explicit-any
function caraStartRefusal(kase: any, m: number | null, rules: { stopBefore: number }): string | null {
  if (kase.status !== 'open') return 'This case is closed.'
  if (String(kase.kind) === 'interest' || kase.open_hours === true) return 'Cara runs open shifts only, not interest checks or open hours.'
  if (m == null) return 'This case has no date and start time yet.'
  /* her rule (2026-10-24): never refused for being close to the shift; only once it has ended */
  if (m + shiftLenMin(kase) <= 0) return 'This shift has already ended.'
  return null
}

/* Everyone the send gate allows for this case, in the list's order, with the tier their wording comes from. */
// deno-lint-ignore no-explicit-any
function sendableOf(pool: any): any[] {
  return [...pool.group0.map((x: any) => ({ ...x, tier: 0, prn_ask: true })),
          ...pool.prn_other.map((x: any) => ({ ...x, tier: 0, prn_ask: true })),
          ...pool.group1.map((x: any) => ({ ...x, tier: 1 })),
          ...pool.group2.map((x: any) => ({ ...x, tier: 3 })),
          /* a regular opening asked of a PRN member is the ordinary ongoing ask, not a PRN one */
          ...pool.prn_ongoing.map((x: any) => ({ ...x, tier: 3 }))]
}

/* THE ONE WAY A CAREGIVER IS ASKED ABOUT A SHIFT BY TEXT (moved here 2026-10-24 so "Let Cara run it" uses exactly the
   coordinator's send): the caller passes only people the send gate allows (buildCandidatesForCase, re-derived on the server).
   Per person: phone from the roster, the opt-out and identity gate (contactForOutbound), the case's own wording or the
   standard one, the shift page link where it applies, the ask recorded under the case lock BEFORE the text (a person already
   asked on this case is never texted again), and the ask taken back if the text fails. Cara's asks are marked auto and with
   their wave; a coordinator's are picked_by_coordinator, as before. */
// deno-lint-ignore no-explicit-any
async function sendAsksTo(kase: any, st: any, sendable: any[], extra: { askedBy?: string | null; caraWave?: number; caraRunNo?: number } = {}):
  Promise<{ sent: string[]; failed: string[]; already: string[] }> {
  const ghl2 = { token: Deno.env.get('GHL_TOKEN') ?? '', locationId: Deno.env.get('GHL_LOCATION_ID') ?? '' }
  if (!ghl2.token || !ghl2.locationId) return { sent: [], failed: sendable.map((x) => `${x.name} (GHL credentials not set)`), already: [] }
  /* Phones come from the roster again (buildCandidates exposes last4
     only); the identity + hours gates run inside contactForOutbound. */
  const { data: rosterRow } = await sb.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const roster = (Array.isArray(rosterRow?.data) ? rosterRow!.data : []) as any[]
  const phoneOf = (nm: string) => {
    const hit = roster.find(cg =>
      nameKeyOf([clean(cg.first), clean(cg.last)].filter(Boolean).join(' ')) === nameKeyOf(nm))
    return normalisePhone(hit?.phone)
  }

  const chiToday = new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
  const clientShort = firstNamesOf(String(kase.client || '')) || 'a client'
  const when = [kase.shift_date ? friendlyDay(kase.shift_date) : '', span12(kase.shift_time)]
    .filter(Boolean).join(' ') || 'as soon as possible (the office has details)'
  const careLine = String(kase.care_note || '').trim()
  const streetName = String(kase.client_street || '').trim()
    .replace(/^\d+[A-Za-z]?(?:-\w+)?\s+/, '').replace(/^\d+$/, '').trim()
  const addr = [streetName, String(kase.client_city || '').trim()].filter(Boolean).join(', ')
  const isSameDay = kase.shift_date === chiToday
  /* Interest checks (new-client broadcasts) speak differently: nobody is
     "covering" anything yet — we're finding out who WANTS the hours
     before the client meeting. One template for everyone. */
  const tmplInt = String(kase.msg_interest || '') || String(st.coverage_msg_interest || '') ||
    `Hi {first_name}, it's Caring Companions. We're meeting a potential new client{where}: {when}. {care}Would you be interested in these hours? Nothing is set yet - reply YES if you'd like to be considered, or NO. Questions welcome.`
  const tmpl1 = String(kase.msg_tier1 || '') || String(st.coverage_msg_tier1 || '') ||
    `Hi {first_name}, can you cover {client} {when}? It's Caring Companions. Reply YES or NO.`
  const tmplO = String(kase.msg_other || '') ||
    (isSameDay
      ? (String(st.coverage_msg_other_sameday || '') || String(st.coverage_msg_other || '') ||
         `Hi {first_name}, it's Caring Companions. Last-minute fill-in for {client} at {address}: {when}. {care}Can you take it? Reply YES or NO. Questions welcome.`)
      : (String(st.coverage_msg_other_advance || '') || String(st.coverage_msg_other || '') ||
         `Hi {first_name}, it's Caring Companions. We have an open shift for {client} at {address}: {when}. {care}Can you take it? Reply YES or NO. Questions welcome.`))
  const tmplP = String(st.coverage_msg_prn || '') || PRN_DEFAULT_MSG
  // deno-lint-ignore no-explicit-any
  const fillMsg = (tmpl: string, x: any) => tmpl
    .replaceAll(' at {address}', addr ? ` at ${addr}` : '')
    .replaceAll('{first_name}', x.first || 'there')
    .replaceAll('{pattern}', '')
    .replaceAll('{client}', clientShort)
    .replaceAll('{where}', kase.client_city ? ` in ${kase.client_city}` : '')
    .replaceAll('{address}', addr || 'the office has the address')
    .replaceAll('{when}', when)
    .replaceAll('{care}', careLine ? careLine + ' ' : '')
    .replaceAll('{link}', '')
    .replace(/\s{2,}/g, ' ').trim()
  /* THE SHIFT PAGE LINK (2026-10-24, her approval): each person's own link, for everyone once
     shift_link_texts_live is on, before that only the owners' pilot caregivers. The standard wording then says
     "all or part of it" or "one caregiver for the whole shift", the town only, no care line. A case's own edited
     wording gets a link only where someone typed {link}. Interest checks never get one. */
  const LINK_SECRET = Deno.env.get('HUB_JOB_SECRET') ?? ''
  const linkEnd = shiftDayEnd(String(kase.shift_date || ''))
  const townL = String(kase.client_city || '').trim()
  const customFor = (k: string): string => k === 'tier1' ? (String(kase.msg_tier1 || '') || String(st.coverage_msg_tier1 || ''))
    : k === 'prn' ? String(st.coverage_msg_prn || '')
    : (String(kase.msg_other || '') || (isSameDay ? (String(st.coverage_msg_other_sameday || '') || String(st.coverage_msg_other || '')) : (String(st.coverage_msg_other_advance || '') || String(st.coverage_msg_other || ''))))

  const sent: string[] = [], failed: string[] = [], already: string[] = []
  for (const x of sendable) {
    const phone = phoneOf(String(x.name))
    if (!phone) { failed.push(`${x.name} (no phone on the roster)`); continue }
    const contact = await contactForOutbound(sb, ghl2,
      { phone, firstName: x.first || x.name }, 'urgent_internal', { audience: 'caregiver', channel: 'sms', sender: 'coverage-run' })
    if (!contact) { failed.push(`${x.name} (refused by the outbound gate or opted out of texts)`); continue }
    const askId = uid()
    let message = fillMsg(String(kase.kind) === 'interest' ? tmplInt
      : x.prn_ask ? tmplP : (x.tier === 1 ? tmpl1 : tmplO), x)
    const lk = linkFor(st, kase, x.axiscare_id, x.name)
    let linked: 'live' | 'pilot' | null = null
    if (lk && LINK_SECRET.length >= 32 && linkEnd) {
      const kindT = x.prn_ask ? 'prn' : x.tier === 1 ? 'tier1' : isSameDay ? 'sameday' : 'other'
      const custom = customFor(kindT)
      const tmplL = custom ? (custom.includes('{link}') ? custom : null) : shiftLinkTemplate(kindT, partWelcome(kase))
      if (tmplL) {
        try {
          const link = await makeShiftLink(LINK_SECRET, String(kase.id), askId, linkEnd)
          message = fillLinked(tmplL, { first: x.first || 'there', client: clientShort, when, town: townL, pattern: patLineOf(kase), link })
          linked = lk
        } catch { /* no link could be made: today's text goes, unchanged */ }
      }
    }
    /* LAST-MINUTE BONUS (Samantha 2026-10-24: "also give the option of adding a bonus for last minute shifts"): an amount the
       office set on this case goes into every ask from then on (never on an interest check), and is kept on the ask */
    const bonusAmt = String(kase.kind) !== 'interest' ? bonusOf(kase) : 0
    if (bonusAmt) message = withBonus(message, bonusAmt)
    /* CI1: the ask is recorded BEFORE the text goes, under the case's lock, only if this person (same number or
       AxisCare id) hasn't been asked on this case: two coordinators sending at once text them once. */
    const ask = { id: askId, name: x.name, phone, channel: 'sms', at: nowIso(),
      ...(linked ? { link_sent: linked, ...(linked === 'pilot' ? { pilot_link: true } : {}) } : {}),
      state: 'waiting', replied_at: null, tier: x.tier, auto: false, ...(x.prn_ask ? { prn: true } : {}),
      ...(extra.caraWave ? { auto: true, picked_by_coordinator: false, cara_wave: extra.caraWave, cara_run_no: extra.caraRunNo ?? 1 } : { picked_by_coordinator: true }),
      ghl_contact_id: contact.contactId, axiscare_id: x.axiscare_id ?? null,
      offered_for: `${String(kase.shift_date || '')}|${String(kase.shift_time || '')}`,   /* the hours this ask was sent for (2026-10-24) */
      ...(bonusAmt ? { bonus: bonusAmt } : {}),
      /* CI2: who asked, when the call-in page sent it (server to server, with the owner key) */
      ...(extra.askedBy ? { asked_by: extra.askedBy } : {}) }
    const { data: held, error: holdErr } = await sb.rpc('coverage_case_add_ask', { p_id: String(kase.id), p_ask: ask })
    if (holdErr || held !== 'added') {
      if (held === 'already_asked') already.push(String(x.name))
      else failed.push(`${x.name} (${held === 'not_open' ? 'the case closed meanwhile' : 'could not record the ask, so it was not sent'})`)
      continue
    }
    let ok = false
    try {
      const r = await fetch('https://services.leadconnectorhq.com/conversations/messages', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ghl2.token}`, Version: '2021-07-28',
                   'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'SMS', fromNumber: MO_FROM, contactId: contact.contactId, message }),
      })
      ok = r.ok
      if (!r.ok) failed.push(`${x.name} (SMS ${r.status})`)
    } catch { failed.push(`${x.name} (send error)`) }
    if (!ok) { await sb.rpc('coverage_case_remove_ask', { p_id: String(kase.id), p_ask_id: ask.id }); continue }
    sent.push(String(x.name))
    try {
      await fetch(`https://services.leadconnectorhq.com/contacts/${contact.contactId}/tags`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ghl2.token}`, Version: '2021-07-28',
                   'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: ['coverage-asked'] }),
      })
    } catch { /* a missing tag only costs reply routing */ }
  }
  return { sent, failed, already }
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

Deno.serve(async (req) => {
  /* The bare-'ok' OPTIONS reply broke the hub picker on day one: the browser
     preflights the coordinator's POST and refuses it without these headers. */
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: CORS_HEADERS })
  const q = new URL(req.url).searchParams
  const commit = q.get('commit') === '1'

  /* ── COORDINATOR ACTIONS (2026-09-19 redesign) ─────────────────────────
     POST {action:'candidates'|'send_selected', ...} from the hub, carrying
     the signed-in coordinator's session JWT. The public anon key (which the
     cron uses for plain ticks) may not drive these. */
  // deno-lint-ignore no-explicit-any
  let body: any = null
  try { body = await req.clone().json() } catch { body = null }
  if (body && typeof body.action === 'string') {
    const jr = (b: unknown, s = 200) => new Response(JSON.stringify(b, null, 2),
      { status: s, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } })
    /* J1 (2026-09-29): an active office staff member (the sign-in is checked with Supabase Auth and against their
       staff record, role and hub access), or the owner's server key. It used to read "signed in" from the token
       without checking who: any account on the shared project could text caregivers from here. */
    const ownerCall = await ownerCaller(req)
    let whoName = 'the owner', whoEmail = '', whoOwner = !!ownerCall
    if (!ownerCall) {
      const who = await requireStaff(sb, req, OFFICE_ROLES)
      if (!who.ok) return jr({ error: who.error }, who.status)
      whoName = String((who as { name?: string }).name || 'the office')
      whoEmail = String((who as { email?: string }).email || '').toLowerCase()
      whoOwner = Array.isArray((who as { roles?: string[] }).roles) && (who as { roles: string[] }).roles.includes('owner_admin')
    }
    if (body.action === 'open_hours') return await openHours(body, whoName, jr)
    const kase = await readCaseFresh(String(body.case_id || ''))
    if (!kase) return jr({ error: 'no such coverage case' }, 404)
    /* CARA PHASE 2 PART A: the run on this case, its history and what still needs the office. Read only; also for a closed case. */
    if (body.action === 'cara_run_get') {
      const { data: stG } = await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
      const stg = stG?.data ?? {}
      const run = await caraRunRead(String(kase.id))
      const { data: ev } = await sb.from('cara_run_event').select('at, run_no, kind, actor, summary, detail').eq('case_id', String(kase.id)).order('at', { ascending: true }).limit(200)
      const m = minsToStart(kase, chiNowNaive())
      const rules = runRules(stg, m)
      const live = stg.cara_run_live === true && stg.coverage_send_live === true
      const canStart = kase.status === 'open' && (!run || ['stopped', 'needs_office'].includes(run.status)) && (live || whoOwner)
      return jr({ run: run ? { ...run, lease_id: undefined } : null, events: ev ?? [], needs: needsLine(run, kase), switch_on: stg.cara_run_live === true, live,
        practice_only: !live, can_start: canStart, start_refused: caraStartRefusal(kase, m, rules), rules,
        asks: (Array.isArray(kase.asked) ? kase.asked : []).filter((a: { cara_wave?: number }) => a?.cara_wave).map((a: { id?: string; name?: string; cara_wave?: number; state?: string; at?: string; replied_at?: string }) =>
          ({ id: a.id, name: a.name, wave: a.cara_wave, state: a.state, at: a.at, replied_at: a.replied_at ?? null })) })
    }
    /* J1: only a shift that is still open (the Hub only shows the picker for open cases). */
    if (kase.status !== 'open') return jr({ error: 'this coverage case is no longer open, so nobody can be asked from it' }, 409)

    if (body.action === 'candidates') {
      const out = await buildCandidatesForCase(kase)
      return jr(out)
    }
    /* CARA PHASE 1 (2026-10-23), both read only and allowed while cara_list_live is off, so the office can compare:
       candidates_v2  the better list (Unknown availability, skills rules, week hours, overlapping yeses)
       recommend      of the people who said YES, the one to confirm, with reasons and concerns. Interest only: nothing is
                      assigned, texted or saved; the confirm stays the office's (coverage-assign, AxisCare read-back). */
    if (body.action === 'candidates_v2') return jr(await buildCandidatesForCase(kase, { v2: true }))
    if (body.action === 'recommend') {
      const pool = await buildCandidatesForCase(kase, { v2: true, includeAsked: true })
      const rows = [...pool.group0, ...pool.prn_other, ...pool.group1, ...pool.group2, ...pool.prn_ongoing]
      const blocked = [...pool.excluded, ...(pool.needs_verification || []).map((x) => ({ name: x.name, why: x.needs_verification }))]
      return jr({ ...recommend(kase, rows, blocked), meta: pool.meta.cara_list })
    }
    /* TIME RULES FOR THIS SHIFT (Samantha, 2026-10-24: "treat time flexibility and permission to split coverage as separate
       settings. Exact Time should be the default"). time_flex: 'exact' | 'flexible_start' (how far the start may move, in
       minutes, 30 to 180); handoff_ok: two caregivers may split it. These only describe what the office allows; nothing is
       changed in AxisCare and no client or family is asked here. Recorded with who and when. */
    if (body.action === 'set_time_rules') {
      const tf = body.time_flex === 'flexible_start' ? 'flexible_start' : 'exact'
      const fm = tf === 'flexible_start' ? Math.min(180, Math.max(30, Math.round(Number(body.flex_minutes) || 60))) : null
      const patch = { time_flex: tf, flex_minutes: fm, handoff_ok: body.handoff_ok === true, time_rules_by: whoName.slice(0, 80), time_rules_at: nowIso() }
      const { error } = await sb.rpc('coverage_case_patch', { p_id: String(kase.id), p_patch: patch, p_expect: { status: 'open' } })
      if (error) return jr({ error: 'not saved: ' + error.message }, 500)
      await opEvent(sb, { job: 'coverage-run', verb: 'time_rules_set', item_id: String(kase.id), area: 'coverage', actor_name: whoName,
        summary: `${whoName} set ${kase.client || 'the shift'}: ${tf === 'exact' ? 'exact time' : 'flexible start, up to ' + fm + ' minutes'}; hand-off ${patch.handoff_ok ? 'allowed' : 'not allowed'}` })
      return jr({ ok: true, ...patch })
    }
    /* CARA PHASE 2 PART A · start ("Let Cara run it", or "Keep searching" after she stopped), take it back, not this one. */
    if (body.action === 'cara_run_start') {
      const { data: stS } = await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
      const sts = stS?.data ?? {}
      const live = sts.cara_run_live === true && sts.coverage_send_live === true
      if (!live && !whoOwner) return jr({ error: 'Let Cara run it is switched off. Only owners can try it, as practice.' }, 403)
      const m = minsToStart(kase, chiNowNaive())
      const refused = caraStartRefusal(kase, m, runRules(sts, m))
      if (refused) return jr({ error: refused }, 409)
      const prev = await caraRunRead(String(kase.id))
      if (prev && LIVE_STATES.includes(prev.status)) return jr({ error: `Cara is already running this (started by ${prev.started_by}).`, run: prev }, 409)
      const base = { status: 'running', practice: !live, started_by: whoName.slice(0, 80), started_email: whoEmail || null, started_at: nowIso(),
        next_wave_at: nowIso(), held_until: null, paused_ask_id: null, paused_name: null, paused_at: null, confirm_by: null, needs: null,
        lease_id: null, lease_until: null, ended_by: null, ended_at: null, end_why: null }
      let run: Run | null = null
      if (!prev) {
        const { data, error } = await sb.from('cara_run').insert({ case_id: String(kase.id), run_no: 1, wave: 0, wave_base: 0, ...base }).select().maybeSingle()
        if (error || !data) return jr({ error: 'Someone else just started Cara on this case. Refresh to see it.' }, 409)
        run = data
      } else {
        run = await caraRunWrite(prev, { ...base, run_no: (Number(prev.run_no) || 1) + 1, wave_base: Number(prev.wave) || 0 })
        if (!run) return jr({ error: 'Someone else just changed this run. Refresh to see it.' }, 409)
      }
      const again = prev ? (prev.status === 'needs_office' ? ' (keep searching)' : ' (again)') : ''
      await caraEvent(run, 'started', whoName, `${whoName} let Cara run it${again}${run.practice ? ', as PRACTICE: nobody will be texted' : ''}. Waves of ${runRules(sts, m).size}, ${runRules(sts, m).gap} minutes apart, ${runRules(sts, m).maxWaves} at most.`)
      await opEvent(sb, { job: 'coverage-run', verb: 'cara_run_started', item_id: String(kase.id), area: 'coverage', actor_name: whoName, actor_email: whoEmail || undefined,
        summary: `${whoName} let Cara run ${caseWhat(kase)}${run.practice ? ' (practice)' : ''}` })
      const did = await caraAdvance(String(kase.id), sts)
      return jr({ ok: true, practice: run.practice, did, run: await caraRunRead(String(kase.id)) })
    }
    if (body.action === 'cara_run_stop' || body.action === 'cara_run_not_this_one') {
      const isStop = body.action === 'cara_run_stop'
      const askId = String(body.ask_id || '').slice(0, 80)
      const why = String(body.why || '').trim().slice(0, 200)
      // deno-lint-ignore no-explicit-any
      const ask = (Array.isArray(kase.asked) ? kase.asked : []).find((a: any) => String(a?.id) === askId)
      if (!isStop && !ask) return jr({ error: 'that answer is not on this case' }, 404)
      for (let tries = 0; tries < 4; tries++) {
        const run = await caraRunRead(String(kase.id))
        if (!run) return jr({ error: 'Cara is not running this case' }, 404)
        if (isStop) {
          if (!LIVE_STATES.includes(run.status) && run.status !== 'needs_office') return jr({ error: `Cara is not running this case (${run.status}).` }, 409)
          const w = await caraRunWrite(run, { status: 'stopped', ended_by: whoName.slice(0, 80), ended_at: nowIso(), end_why: `Taken back by ${whoName}${why ? ': ' + why : ''}`, needs: null, lease_id: null, lease_until: null })
          if (!w) continue
          await caraEvent(w, 'stopped', whoName, `${whoName} took it back${why ? ': ' + why : ''}. Cara won't send anything more. Answers still land on the board.`)
          await caraItemDone(String(kase.id), `Taken back by ${whoName}`)
          await opEvent(sb, { job: 'coverage-run', verb: 'cara_run_stopped', item_id: String(kase.id), area: 'coverage', actor_name: whoName, actor_email: whoEmail || undefined, summary: `${whoName} took ${caseWhat(kase)} back from Cara` })
          return jr({ ok: true, run: w })
        }
        const declined = [...(Array.isArray(run.declined) ? run.declined : []).filter((d: { ask_id?: string }) => d?.ask_id !== askId),
          { ask_id: askId, name: String(ask.name || ''), by: whoName.slice(0, 80), at: nowIso(), why: why || null }]
        const wasPaused = run.status === 'paused' && run.paused_ask_id === askId
        const patch: Record<string, unknown> = { declined }
        if (wasPaused) Object.assign(patch, { status: 'running', paused_ask_id: null, paused_name: null, paused_at: null, confirm_by: null, next_wave_at: nowIso() })
        const w = await caraRunWrite(run, patch)
        if (!w) continue
        await caraEvent(w, 'not_this_one', whoName, `${whoName}: not ${ask.name} for this shift${why ? ' (' + why + ')' : ''}.${wasPaused ? ' Cara is asking again.' : ''} ${ask.name} is not texted about it now; they hear "covered" when the case closes.`, { ask_id: askId })
        await opEvent(sb, { job: 'coverage-run', verb: 'cara_run_not_this_one', item_id: String(kase.id), area: 'coverage', actor_name: whoName, actor_email: whoEmail || undefined, summary: `${whoName}: not ${ask.name} for ${caseWhat(kase)}` })
        let did = 'not_running'
        if (wasPaused) {
          await caraItemDone(String(kase.id), `Not ${ask.name}: Cara is asking again`)
          const { data: stN } = await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
          did = await caraAdvance(String(kase.id), stN?.data ?? {})
        }
        return jr({ ok: true, did, run: await caraRunRead(String(kase.id)) })
      }
      return jr({ error: 'The run kept changing while saving. Refresh and try again.' }, 409)
    }
    /* THE RESPONSE BOARD (2026-10-24): everyone asked, in their column, with their exact answer and Cara's reasons. Read only. */
    if (body.action === 'board') {
      const pool = await buildCandidatesForCase(kase, { v2: true, includeAsked: true })
      const rows = [...pool.group0, ...pool.prn_other, ...pool.group1, ...pool.group2, ...pool.prn_ongoing]
      /* CAREGIVER PREVIEW (2026-10-24): the client's approved profile state, so the board can say when a shift page will show
         only the shift (nothing approved yet) or the care summary is hidden because the care plan changed. Only while the
         Caregiver Preview switch is on (off, shift pages don't read it). */
      let profile = null
      try {
        const { data: stP } = await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
        const axId = String(kase.client_axiscare_id || '').trim()
        if (stP?.data?.caregiver_preview_live === true && /^\d+$/.test(axId)) {
          const { row, circle } = await previewRecords(sb, axId)
          let cur: unknown[] | null = []
          if (row?.approved_share_care === true) {
            const { token: t3, site: s3 } = axisCreds(); let cl3 = null
            if (t3 && s3) { const r3 = await fetch(`https://${s3}.axiscare.com/api/clients/${encodeURIComponent(axId)}`, { headers: { Authorization: `Bearer ${t3}`, Accept: 'application/json', 'X-AxisCare-Api-Version': AC_VERSION } }); if (r3.ok) { const j3 = await r3.json().catch(() => ({})); cl3 = j3?.results?.client ?? j3?.results ?? null } }
            cur = await careNow(sb, axId, cl3)
          }
          // deno-lint-ignore no-explicit-any
          const ps = stateOf(row, circle, cur as any)
          profile = { label: ps.label, tone: ps.tone, has_intro: ps.has_intro, care_review: ps.care_review, axiscare_client_id: axId }
        }
      } catch { profile = null }
      const bd = boardOf(kase, rows, pool.excluded, pool.needs_verification || [])
      /* CARA PHASE 2 PART A: part-shift offers that fit together, part offers with no hours, and who the office said "Not this one" to */
      let declined: unknown[] = []
      try { const r = await caraRunRead(String(kase.id)); declined = Array.isArray(r?.declined) ? r.declined : [] } catch { declined = [] }
      return jr({ ...bd, combos: combosOf(kase, bd.people), parts_without_hours: partsWithoutHours(bd.people), declined, meta: pool.meta.cara_list, profile })
    }

    if (body.action === 'send_selected') {
      const wanted = new Set((Array.isArray(body.recipients) ? body.recipients : [])
        .map((n: unknown) => String(n).toLowerCase()))
      if (!wanted.size) return jr({ error: 'no recipients selected' }, 400)
      const { data: setR } = await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
      // deno-lint-ignore no-explicit-any
      const st: any = setR?.data ?? {}
      if (st.coverage_send_live !== true)
        return jr({ error: 'sending is switched off (ops_settings.coverage_send_live), nothing sent' }, 409)
      const ghl2 = { token: Deno.env.get('GHL_TOKEN') ?? '', locationId: Deno.env.get('GHL_LOCATION_ID') ?? '' }
      if (!ghl2.token || !ghl2.locationId) return jr({ error: 'GHL credentials not set' }, 502)
      /* CI1: the caregiver night rule, on the server (it used to be only a browser warning) */
      if (caregiverNightHold(kase, st))
        return jr({ error: 'held: caregivers are not texted 9pm to 8am unless the shift starts within 3 hours. Nothing was sent; try again from 8am, or call them.', held_night: true }, 409)

      /* Eligibility is re-derived HERE, not trusted from the browser: a name
         that is not in group1/group2 right now cannot be texted, whatever
         the request says. The coordinator chooses WITHIN the safe set. */
      const pool = await buildCandidatesForCase(kase)
      const sendable = sendableOf(pool).filter(x => wanted.has(String(x.name).toLowerCase()))
      const refusedNames = [...wanted].filter(w =>
        !sendable.some(x => String(x.name).toLowerCase() === w))

      const askedBy = ownerCall && typeof body.asked_by === 'string' && body.asked_by.trim() ? body.asked_by.trim().slice(0, 80) : null
      const { sent, failed, already } = await sendAsksTo(kase, st, sendable, { askedBy })
      try {
        await sb.rpc('upsert_app_data_item', { target_key: 'automation_log', item: {
          id: 'auto_srv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
          at: nowIso(), automation: 'coverage-run:send_selected', ran_by: 'coordinator',
          ok: failed.length === 0, dry: false, rows_seen: sendable.length,
          candidates: wanted.size, created: sent.length,
        } })
      } catch { /* logging must never block */ }
      return jr({ sent, failed, already_asked: already, refused_not_eligible: refusedNames,
        note: 'Replies land on the case like any other ask. Watch the board.' })
    }

    /* THE THREE-GROUP ASK LIST (Samantha 2026-10-24, mockup PtLEzsAjvGybxXsTtXk926): every caregiver for this shift in
       Ready to ask / Possible with your review / Do not ask, with whether they were contacted and exactly why. Read only. */
    if (body.action === 'ask_list') {
      const { data: setA } = await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
      // deno-lint-ignore no-explicit-any
      const stA: any = setA?.data ?? {}
      const lists = await askListFor(kase, stA)
      return jr({ ...lists.groups, live: stA.ask_list_live === true, meta: lists.meta })
    }
    /* A CARE REVIEW, APPROVED FOR THIS SHIFT ONLY (her rule: "Cara should NEVER independently waive care-level requirements
       or change a client's care plan"). The office person moves or drops the tasks that stand in the way, confirms what is
       left is within the caregiver's verified skills and allowed by policy and the payer, and says who agreed and why. It
       is recorded on the shift (never on the caregiver or the plan), a card is made for any moved task, and then the offer
       goes to that one caregiver. The switch ask_list_live must be on. */
    if (body.action === 'review_approve') {
      const { data: setR2 } = await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
      // deno-lint-ignore no-explicit-any
      const stR: any = setR2?.data ?? {}
      if (stR.ask_list_live !== true) return jr({ error: 'The three-group ask list is switched off (ops_settings.ask_list_live). Nothing was recorded or sent.' }, 409)
      const lists = await askListFor(kase, stR)
      const id = String(body.axiscare_id || ''), nm = String(body.name || '').toLowerCase()
      // deno-lint-ignore no-explicit-any
      const row = lists.groups.review.find((x: any) => (id && x.axiscare_id === id) || (!id && x.name.toLowerCase() === nm))
      const chk = checkApproval(row, body)
      if (!chk.ok) return jr({ error: chk.why, still: chk.still }, 409)
      if (body.send !== false) {
        if (stR.coverage_send_live !== true) return jr({ error: 'sending is switched off (ops_settings.coverage_send_live). Nothing was recorded or sent.' }, 409)
        if (caregiverNightHold(kase, stR)) return jr({ error: 'held: caregivers are not texted 9pm to 8am unless the shift starts within 3 hours. Nothing was recorded or sent; call them.', held_night: true }, 409)
      }
      const rec = { id: 'rv_' + Date.now().toString(36), at: nowIso(), by: whoName, by_email: whoEmail, for: `${String(kase.shift_date || '')}|${String(kase.shift_time || '')}`,
        name: row.name, axiscare_id: row.axiscare_id, cg_level: row.cg_level, client_level: row.client_level, gap: row.why,
        adjusted: chk.adjusted, moved_to: String(body.moved_to || '').trim().slice(0, 120) || null,
        agreed_by: String(body.agreed_by || '').trim().slice(0, 200) || null, why: String(body.why || '').trim().slice(0, 300),
        checks: { skills: true, payer: true } }
      const prev = Array.isArray(kase.review_approvals) ? kase.review_approvals : []
      const { error: pe } = await sb.rpc('coverage_case_patch', { p_id: String(kase.id), p_patch: { review_approvals: [...prev, rec].slice(-30) }, p_expect: { status: 'open' } })
      if (pe) return jr({ error: 'could not record the approval, so nothing was sent: ' + pe.message }, 500)
      const moved = chk.adjusted.filter((a: { change: string }) => a.change === 'moved')
      if (moved.length) {
        await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { id: `ops_rvmove_${kase.id}_${rec.id}`, kind: 'coverage', coverage_case_id: kase.id, status: 'open', urgency: 'high',
          domain: 'scheduling_coverage', about: kase.client || '', created_at: nowIso(), created_by: 'coverage-run', opened_by: 'review_approve',
          title: `Put ${moved.map((a: { label: string }) => a.label.toLowerCase()).join(' and ')} for ${String(kase.client || 'the client').split(' ')[0]} on ${rec.moved_to} in AxisCare`,
          detail: `${whoName} moved it off ${caseWhat(kase)} so ${row.name} could cover (care review, ${rec.agreed_by || 'agreed'}).` } })
      }
      await opEvent(sb, { actor_email: whoEmail, actor_name: whoName, via: 'hub', verb: 'review_approved', item_id: String(kase.id), area: 'coverage',
        summary: `${whoName} approved ${row.name} for ${caseWhat(kase)} after a care review` + (chk.adjusted.length ? ` (${chk.adjusted.map((a: { label: string; change: string }) => a.label + ': ' + (a.change === 'moved' ? 'moved' : 'not needed')).join('; ')})` : '') })
      let sent: string[] = [], failed: string[] = [], already: string[] = []
      if (body.send !== false) {
        const fresh = (await readCaseFresh(String(kase.id))) || kase
        const r2 = await sendAsksTo(fresh, stR, [{ name: row.name, first: String(row.name).split(' ')[0], axiscare_id: row.axiscare_id, tier: 3 }])
        sent = r2.sent; failed = r2.failed; already = r2.already
      }
      return jr({ ok: true, approval: rec, sent, failed, already_asked: already })
    }

    /* LAST-MINUTE BONUS (her ask 2026-10-24): the office sets (or clears, 0) a dollar bonus on this shift. Every ask texted
       after that says it; who set it and when is kept (payroll is told by the card; the Hub never changes pay). */
    if (body.action === 'set_bonus') {
      const amt = Math.round(Number(body.amount))
      if (!Number.isFinite(amt) || amt < 0 || amt > 500) return jr({ error: 'the bonus must be a whole dollar amount from 0 to 500' }, 400)
      const rec = { amount: amt, by: whoName, at: nowIso(), note: typeof body.note === 'string' ? body.note.trim().slice(0, 200) : null }
      const hist = Array.isArray(kase.bonus_history) ? kase.bonus_history : []
      const { error } = await sb.rpc('coverage_case_patch', { p_id: String(kase.id), p_patch: { bonus: amt ? rec : null, bonus_history: [...hist, rec].slice(-20) }, p_expect: { status: 'open' } })
      if (error) return jr({ error: 'could not save the bonus: ' + error.message }, 500)
      await opEvent(sb, { actor_email: whoEmail, actor_name: whoName, via: 'hub', verb: amt ? 'bonus_set' : 'bonus_cleared', item_id: String(kase.id), area: 'coverage',
        summary: amt ? `${whoName} added a $${amt} bonus to ${caseWhat(kase)}` : `${whoName} took the bonus off ${caseWhat(kase)}` })
      return jr({ ok: true, bonus: amt ? rec : null })
    }

    /* ASK EVERYONE NOW (Samantha 2026-10-24, Dan's overnight: "I need this shift to go out to everyone when we are this last
       minute!!"). Everyone eligible for this shift who hasn't been asked, at once: the same hard rules as Cara's waves
       (never anyone already working then, with a yes elsewhere then, over 40 hours, outside their availability, a PRN member
       short of their notice, Needs Verification, In Training, Do-Not-Return...), the familiar first. preview: the names and
       who is left out and why, nothing sent. send: only the names the office saw and confirmed, re-checked here. */
    if (body.action === 'ask_everyone') {
      const { data: setR } = await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
      // deno-lint-ignore no-explicit-any
      const st: any = setR?.data ?? {}
      const mE = minsToStart(kase, chiNowNaive())
      const p2 = await buildCandidatesForCase(kase, { v2: true })
      const judged = judgeForWaves([...p2.group0, ...p2.prn_other, ...p2.group1, ...p2.group2, ...p2.prn_ongoing, ...(p2.needs_verification || [])], kase,
        { minsToStart: mE, ongoing: isOngoingCase(kase), sameTime: st.cara_same_time_live === true })
      const asked0 = Array.isArray(kase.asked) ? kase.asked : []
      const everyone = pickWaveV2(judged.ordered, asked0, { size: 500, wavesLeft: 1, urgent: false })
      const night = caregiverNightHold(kase, st)
      const leftOut = [...judged.excluded, ...(p2.excluded || []).map((x: { name?: string; why?: string }) => ({ name: String(x.name || ''), axiscare_id: null, why: String(x.why || '') }))]
        .filter((x) => !/no longer active|office domain/i.test(x.why))
      if (body.preview === true || body.send !== true)
        return jr({ names: everyone.map((j) => String(j.row.name)), notes: everyone.map((j) => ({ name: String(j.row.name), note: j.note, why: j.row.why })),
          already_asked: asked0.length, left_out: leftOut.slice(0, 80), held_night: night, send_live: st.coverage_send_live === true })
      if (st.coverage_send_live !== true) return jr({ error: 'sending is switched off (ops_settings.coverage_send_live), nothing sent' }, 409)
      if (night) return jr({ error: 'held: caregivers are not texted 9pm to 8am unless the shift starts within 3 hours. Nothing was sent; call them.', held_night: true }, 409)
      const ok = new Set(everyone.map((j) => String(j.row.name).toLowerCase()))
      const wanted = (Array.isArray(body.names) ? body.names : []).map((n: unknown) => String(n).toLowerCase()).filter((n: string) => ok.has(n))
      if (!wanted.length) return jr({ error: 'nobody to send to (the list changed: look again)' }, 409)
      // deno-lint-ignore no-explicit-any
      const byName = new Map(sendableOf(p2).map((x: any) => [String(x.name).toLowerCase(), x]))
      // deno-lint-ignore no-explicit-any
      const rows = wanted.map((n: string) => byName.get(n)).filter(Boolean).map((x: any) => ({ ...x, prn_ask: !!x.prn_pref && !isOngoingCase(kase) }))
      const { sent, failed, already } = await sendAsksTo(kase, st, rows)
      await opEvent(sb, { actor_email: whoEmail, actor_name: whoName, via: 'hub', verb: 'ask_everyone', item_id: String(kase.id), area: 'coverage',
        summary: `${whoName} asked everyone eligible (${sent.length}) for ${caseWhat(kase)}` })
      return jr({ sent, failed, already_asked: already, refused: (Array.isArray(body.names) ? body.names.length : 0) - wanted.length })
    }

    if (body.action === 'follow_up') {
      /* FOLLOW UP WITH THE PEOPLE ALREADY ASKED (her ask 2026-10-09: "a way to send a follow up text just to the
         people we have already sent to, so we don't have to remember who we asked", a nudge or a bonus). Recipients
         come from this case's own asked[] and nowhere else: a person this case TEXTED (a Cara wave or the picker)
         who has not said yes. One text in the office's words, {first_name} filled per person, through the same
         outbound gate (identity + opt-out) and the same send check (a refused text raises a card, never silent).
         Recorded on the case as followups[] so asked[], which replies write, is never overwritten. The night hold
         applies like any other caregiver text. */
      const wantedIds = new Set((Array.isArray(body.ask_ids) ? body.ask_ids : []).map((x: unknown) => String(x)))
      if (!wantedIds.size) return jr({ error: 'nobody selected' }, 400)
      const text = String(body.message || '').replace(/\s+/g, ' ').trim()
      if (!text) return jr({ error: 'the text is empty' }, 400)
      if (text.length > 600) return jr({ error: 'the text is too long (600 characters is already a 4-part text)' }, 400)
      if (text.includes('—')) return jr({ error: 'caregiver texts never carry an em dash (use a comma or a period)' }, 400)
      const { data: setF } = await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
      // deno-lint-ignore no-explicit-any
      const stF: any = setF?.data ?? {}
      if (stF.coverage_send_live !== true)
        return jr({ error: 'sending is switched off (ops_settings.coverage_send_live), nothing sent' }, 409)
      const ghlF = { token: Deno.env.get('GHL_TOKEN') ?? '', locationId: Deno.env.get('GHL_LOCATION_ID') ?? '' }
      if (!ghlF.token || !ghlF.locationId) return jr({ error: 'GHL credentials not set' }, 502)
      if (caregiverNightHold(kase, stF))
        return jr({ error: 'held: caregivers are not texted 9pm to 8am unless the shift starts within 3 hours. Nothing was sent; try again from 8am, or call them.', held_night: true }, 409)
      // deno-lint-ignore no-explicit-any
      const askedF: any[] = Array.isArray(kase.asked) ? kase.asked : []
      const skipped: string[] = []
      const unknown = [...wantedIds].filter((id) => !askedF.some((a) => String(a?.id) === id))
      const sendableF = askedF.filter((a) => wantedIds.has(String(a?.id))).filter((a) => {
        if (a.state === 'yes') { skipped.push(`${a.name} (said yes: confirm them instead)`); return false }
        if (a.auto !== true && a.picked_by_coordinator !== true) { skipped.push(`${a.name} (asked by phone, not by text)`); return false }
        if (!normalisePhone(a.phone)) { skipped.push(`${a.name} (no number on the ask)`); return false }
        return true
      })
      /* {link} in a follow-up (2026-10-24): each person's own shift page link. Only for people who may get one (the switch
         on, or the owners' pilot); anyone else means nothing is sent and the office is told who. */
      const LINK_SECRET_F = Deno.env.get('HUB_JOB_SECRET') ?? ''
      const wantsLink = text.includes('{link}')
      if (wantsLink) {
        const noLink = sendableF.filter((a) => !linkFor(stF, kase, a.axiscare_id, a.name)).map((a) => String(a.name))
        if (noLink.length) return jr({ error: `Shift page links aren't on for ${noLink.join(', ')} yet. Take {link} out, or send only to the pilot caregivers. Nothing was sent.` }, 409)
        if (LINK_SECRET_F.length < 32 || !shiftDayEnd(String(kase.shift_date || ''))) return jr({ error: 'A shift page link can\'t be made for this case (no shift date). Take {link} out. Nothing was sent.' }, 409)
      }
      const by = typeof body.by === 'string' ? body.by.trim().slice(0, 80) : ''
      const headersF = { Authorization: `Bearer ${ghlF.token}`, Version: '2021-07-28', 'Content-Type': 'application/json' }
      const sentF: string[] = [], sentIds: string[] = [], failedF: string[] = []
      for (const a of sendableF) {
        const phone = normalisePhone(a.phone)
        const first = clean(a.name).split(/\s+/)[0] || 'there'
        const contact = await contactForOutbound(sb, ghlF,
          { phone, firstName: first }, 'urgent_internal', { audience: 'caregiver', channel: 'sms', sender: 'coverage-run' })
        if (!contact) { failedF.push(`${a.name} (refused by the outbound gate or opted out of texts)`); continue }
        let message = text.replaceAll('{first_name}', first)
        if (wantsLink) {
          try { message = message.replaceAll('{link}', await makeShiftLink(LINK_SECRET_F, String(kase.id), String(a.id), shiftDayEnd(String(kase.shift_date || '')))) }
          catch { failedF.push(`${a.name} (no link could be made, so nothing was sent)`); continue }
        }
        const ok = await ghlSendChecked(sb, headersF, 'coverage-run',
          { channel: 'sms', contactId: contact.contactId, address: phone, who: a.name }, { message })
        if (!ok) { failedF.push(`${a.name} (the text was refused; see Send problems)`); continue }
        sentF.push(String(a.name)); sentIds.push(String(a.id))
      }
      if (sentIds.length) {
        /* Recorded even if the case closed while the texts went: they were sent. */
        const fresh = await readCaseFresh(String(kase.id))
        const list = [...(Array.isArray(fresh?.followups) ? fresh.followups : []),
          { id: 'fu_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: nowIso(), by, text,
            ask_ids: sentIds, names: sentF }]
        const { error: patchErr } = await sb.rpc('coverage_case_patch', { p_id: String(kase.id), p_patch: { followups: list }, p_expect: {} })
        if (patchErr) console.warn(`[coverage-run] follow_up sent but not recorded on ${kase.id}: ${String(patchErr.message || patchErr).slice(0, 160)}`)
      }
      try {
        await sb.rpc('upsert_app_data_item', { target_key: 'automation_log', item: {
          id: 'auto_srv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
          at: nowIso(), automation: 'coverage-run:follow_up', ran_by: 'coordinator',
          ok: failedF.length === 0, dry: false, rows_seen: sendableF.length,
          candidates: wantedIds.size, created: sentF.length,
        } })
      } catch { /* logging must never block */ }
      return jr({ sent: sentF, failed: failedF, skipped, unknown,
        note: 'Replies land on the case like any other ask. Watch the board.' })
    }

    return jr({ error: `unknown action "${body.action}"` }, 400)
  }

  /* J1 (2026-09-29): the plain run answers only its every-3-minutes schedule or the owner's server key. Everyone
     else, the public key included, is refused before anything is read or sent. */
  const caller = await jobCaller(req)
  if (!caller) return new Response(JSON.stringify({ error: 'not allowed' }), { status: 401, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } })
  if (q.get('auth_check') === '1') return new Response(JSON.stringify({ ok: true, caller }), { headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } })

  const { data: row } = await sb.from('app_data').select('data').eq('key', 'coverage_cases').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const cases = (Array.isArray(row?.data) ? row!.data : []) as any[]
  const open = cases.filter(c => c?.status === 'open')

  if (open.length && !(await acquireRunLock())) {
    return new Response(JSON.stringify({
      mode: 'SKIPPED', reason: 'another coverage-run is in progress (soft lock under 4 minutes old)' },
      null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  /* The callout switch. Everything else in this function stays read-only
     reporting regardless; only this flag lets a text leave the building. */
  const { data: setRow } = await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const settings: any = setRow?.data ?? {}
  const sendLive = settings.coverage_send_live === true
  /* MANUAL SELECTION MODE (the 2026-09-19 redesign): Cara detects and flags,
     admins are alerted, candidates are ranked — but no caregiver is texted
     until a coordinator builds the list in the picker and presses send.
     "There are so many nuances that we know why someone shouldn't be sent
     to that client sometimes." */
  /* AUTOMATIC WAVES RETIRED (2026-10-12, her decision 6 + Desktop 631: "you choose who gets asked" on since the
     09-19 redesign; the last automatic text went Sep 16 at 22:27 UTC, 66 in all, 82 picked by a person since). Cara
     never texts a caregiver about a shift unless a person picked them, whatever the switch says. The ranking, the
     ready-made list, the alerts and every closing text stay. */
  const AUTO_WAVES_RETIRED = true
  const manualSelect = AUTO_WAVES_RETIRED || settings.coverage_manual_select === true
  const fuseMin = Number(settings.coverage_wave_fuse_min) > 0 ? Number(settings.coverage_wave_fuse_min) : 10
  const ghl = { token: Deno.env.get('GHL_TOKEN') ?? '', locationId: Deno.env.get('GHL_LOCATION_ID') ?? '' }

  const own = await coverageOwner()
  const { data: itemRow } = await sb.from('app_data').select('data').eq('key', 'ops_items').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const items = (Array.isArray(itemRow?.data) ? itemRow!.data : []) as any[]
  const haveItem = new Set(items.map(i => String(i.id)))

  /* THE GATE MUST BE TESTED EVEN WITH NO OPEN CASE.
     The first version only evaluated candidates inside a case, so with zero
     cases it reported "nobody passed the gate" having asked nobody. A check
     that cannot fail is not a check. This evaluates the whole roster against
     maySendTo() independently, so the safety result is real either way. */
  const rosterCheck = await candidatesFor(null)
  const gate = {
    roster_size: rosterCheck.length,
    would_pass: rosterCheck.filter(x => x.may_autosend).length,
    no_phone: rosterCheck.filter(x => x.skipped === 'no phone on file').length,
    inactive: rosterCheck.filter(x => x.skipped === 'no longer active').length,
    /* Keyed off the structured `eligibility` field, never the message text.
       Three counters previously matched on the skip STRING; when the wording
       changed they all silently stopped matching, and the report said
       "office staff: 0" directly above "holds an office domain: 2". A label
       is for humans; a field is for code. */
    office_not_eligible: rosterCheck.filter(x => x.eligibility === 'office_not_eligible').length,
    office_but_capable: rosterCheck.filter(x => x.eligibility === 'office_but_capable').length,
    do_not_offer: rosterCheck.filter(x => x.eligibility === 'do_not_offer').length,
    /* Untrusted means a phone EXISTS and failed the gate. Lumping the
       office-staff exclusion in here reported "2 phones present but
       untrusted" when those two never reached the phone check at all. */
    /* Untrusted means a phone EXISTS and failed the gate — not that the
       person was excluded before the phone was ever checked. */
    untrusted: rosterCheck.filter(x => x.skipped && x.phone_last4
                                        && x.eligibility !== 'office_not_eligible').length,
    /* Anyone who passes gets named, with where the number came from, because
       a caregiver becoming messageable is the thing to investigate. */
    passed: rosterCheck.filter(x => x.may_autosend)
                       .map(x => ({ name: x.name, confidence: x.confidence,
                                    phone_last4: x.phone_last4 })),
    reasons: Object.entries(rosterCheck.reduce((m: Record<string, number>, x) => {
      const k = String(x.skipped ?? 'eligible'); m[k] = (m[k] ?? 0) + 1; return m
    }, {})).sort((a, b) => b[1] - a[1]),
    /* Who WOULD be wave 1 if trusted numbers existed. Names the prize. */
    /* Only people who would ACTUALLY be asked. The previous version filtered
       out inactive staff and nothing else, so it went on naming Samantha and
       Krystal in wave 1 after the office-staff exclusion was added — the same
       misleading output the exclusion existed to prevent. */
    /* Only people who would ACTUALLY be asked. */
    wave_1: rosterCheck
      .filter(x => x.may_autosend && x.eligibility !== 'office_not_eligible')
      .slice(0, WAVE_SIZE).map(x => ({ name: x.name, eligibility: x.eligibility })),
    /* Every non-ordinary candidate, named, so the split is visible rather
       than inferred from a count. */
    eligibility_breakdown: rosterCheck
      .filter(x => x.eligibility && x.eligibility !== 'ordinary')
      .map(x => ({ name: x.name, eligibility: x.eligibility })),
  }

  const detail: Array<Record<string, unknown>> = []
  // deno-lint-ignore no-explicit-any
  const stats: any = { open_cases: open.length, owner_set: 0, prompts_created: 0,
                  candidates_total: 0, may_autosend: 0, blocked_no_phone: 0,
                  blocked_do_not_offer: 0, held_census_down: 0,
                  blocked_untrusted: 0, would_ask: 0, sent: 0, held_quiet_hours: 0,
                  closure_notified: 0, escalated: 0, admin_alerts: 0 }

  /* Recently-active caregivers (tier 2), fetched ONCE for the whole run. */
  const recent = open.length ? await fetchVisits(`startDate=${dISO(14)}&endDate=${dISO(0)}`)
                             : { rows: [], error: null }
  const recentlyActive = new Set(recent.rows.map(v => String(v?.caregiver?.id ?? '')).filter(Boolean))

  /* AxisCare's ACTIVE caregiver census, once per run. The hub roster's own
     active flag drifts (Samantha caught inactive caregivers in the picker),
     and a coverage text to somebody who no longer works here is worse than
     noise. Filtered on the per-row status.active boolean.
     FAIL CLOSED (her order, 2026-09-16, after inactive caregivers were
     texted on the first live case): "only send to caregivers who are
     active in axiscare." A census that cannot be read now HOLDS every
     wave — nothing sends on roster data alone — and raises a loud ops
     item instead, because blocked-and-told beats texted-an-ex-employee.
     The old roster-only fallback is withdrawn. */
  const axisActive = new Set<string>()
  const caregiverLevel = new Map<string, number>()   // axiscare id → care level 1-3
  const trainLiveW = await inTrainingLive(settings)
  const nurseAxis = new Set<string>()                // nurse-classed in AxisCare
  let censusError: string | null = null
  if (open.length) {
    const { token, site } = axisCreds()
    if (!token || !site) censusError = 'AxisCare credentials not set'
    else try {
      let url: string | null = `https://${site}.axiscare.com/api/caregivers`
      for (let page = 0; url && page < 12; page++) {
        const r: Response = await fetch(url, { headers: {
          Authorization: `Bearer ${token}`, Accept: 'application/json',
          'X-AxisCare-Api-Version': AC_VERSION } })
        if (!r.ok) { censusError = `AxisCare responded ${r.status}`; break }
        const j: any = await r.json().catch(() => ({}))
        /* Lists can come back keyed by id instead of as arrays — normalise
           (the caregivers census threw "not iterable" in production). */
        const gRows: any[] = Array.isArray(j?.results?.caregivers ?? j?.caregivers)
          ? (j?.results?.caregivers ?? j?.caregivers)
          : Object.values(j?.results?.caregivers ?? j?.caregivers ?? {})
        for (const g of gRows)
          /* 2026-10-22: In Training (onboarding) is not in the wave census once in_training_lock_live is on */
          if (g?.status?.active === true && g?.id != null && !(trainLiveW && isInTraining(g?.status?.label))) {
            axisActive.add(String(g.id))
            const lv = careLevelOf(g?.classes)
            if (lv.level != null) caregiverLevel.set(String(g.id), lv.level)
            /* Second lock on the nurse exclusion: class wording. */
            const clsArr = Array.isArray(g?.classes) ? g.classes
              : (g?.classes && typeof g.classes === 'object') ? Object.values(g.classes) : []
            if (clsArr.some((k: any) => /nurse|\bRN\b|\bLPN\b/i.test(String(k?.label ?? k?.code ?? ''))))
              nurseAxis.add(String(g.id))
          }
        url = j?.results?.nextPage ?? j?.nextPage ?? j?.results?.nextPageUrl ?? j?.nextPageUrl ?? null
      }
    } catch (err) { censusError = String(err) }
  }
  const censusUsable = !censusError && axisActive.size > 0
  /* Fail closed LOUDLY: with open cases and no readable census, every wave
     holds — and a person is told, because a silent hold is a lost shift.
     One item per Chicago day, so an hours-long outage nags once. */
  if (open.length && !censusUsable && commit) {
    const chiDayC = new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
    try {
      await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: {
        id: `ops_cov_censusdown_${chiDayC}`, kind: 'coverage',
        title: 'Cara is HOLDING all callouts: AxisCare caregiver census unreachable',
        about: 'coverage callouts',
        detail: `${open.length} open coverage case(s) are waiting. No caregiver texts go out until the active-caregiver census reads again (${censusError || 'census came back empty'}). If a shift is soon, work it by hand.`,
        domain: 'scheduling_coverage', status: 'open', urgency: 'high',
        owner: '', owner_name: '', created_at: nowIso(), created_by: 'coverage-run',
        due: new Date(Date.now() + 3600000).toISOString(),
      } })
    } catch { /* the hold itself never depends on the alert */ }
  }

  /* Nurse-list names, once per run, for the asked_nurse_flagged diagnostic
     (candidatesFor loads its own copy for the actual gate). */
  const nurseNamesGlobal = new Set<string>()
  if (open.length) {
    try {
      const { data: nsR } = await sb.from('app_data').select('data').eq('key', 'nurse_staff').maybeSingle()
      // deno-lint-ignore no-explicit-any
      for (const s of (Array.isArray(nsR?.data) ? nsR!.data : []) as any[])
        if (s?.name) nurseNamesGlobal.add(nameKeyOf(String(s.name)))
    } catch { /* diagnostic only */ }
  }

  /* SUPPLY SIGNAL: what each caregiver says they want (self-maintained via
     the availability page) versus what they are scheduled for in the next 7
     days. Within a tier, hungrier caregivers are asked first — the person
     wanting 15 more hours hears about the shift before the person already
     at target. Missing data means no boost, never a penalty. */
  /* PRN3: the PRN CNA Team, once per run. */
  const prnTeamW = open.length ? await prnTeamLoad() : new Map<string, PrnMember>()
  const wantGap = new Map<string, number>()   // axiscare id → wanted-minus-scheduled
  if (open.length) {
    try {
      const { data: avRow } = await sb.from('app_data').select('data').eq('key', 'caregiver_availability').maybeSingle()
      const av: any[] = Array.isArray(avRow?.data) ? avRow!.data : []
      if (av.length) {
        const fwd = await fetchVisits(`startDate=${dISO(0)}&endDate=${dISO(-7)}`)
        const sched = new Map<string, number>()
        for (const v of fwd.rows) {
          const id = v?.caregiver?.id; if (id == null) continue
          const s = new Date(String(v?.scheduledStartDate ?? v?.startDate ?? '')).getTime()
          const e = new Date(String(v?.scheduledEndDate ?? v?.endDate ?? '')).getTime()
          if (Number.isFinite(s) && Number.isFinite(e) && e > s)
            sched.set(String(id), (sched.get(String(id)) ?? 0) + (e - s) / 3600000)
        }
        for (const a of av) {
          const id = String(a?.axiscare_id ?? ''); if (!id) continue
          const target = Number(a?.target_hours)
          if (Number.isFinite(target)) wantGap.set(id, target - (sched.get(id) ?? 0))
        }
      }
    } catch { /* no boost is a fine fallback */ }
  }

  /* CI3: the board's own claim on a call-in's Needs Attention item counts as "someone has it" (read once per run) */
  // deno-lint-ignore no-explicit-any
  let boardClaims: Set<string> | null = null
  const boardClaimFor = async (id: string): Promise<boolean> => {
    if (!boardClaims) {
      boardClaims = new Set()
      try { const { data: oi } = await sb.from('app_data').select('data').eq('key', 'ops_items').maybeSingle()
        // deno-lint-ignore no-explicit-any
        for (const x of (Array.isArray(oi?.data) ? oi!.data : []) as any[]) if (x?.status === 'open' && x?.claimed_by && x?.coverage_case_id) boardClaims.add(String(x.coverage_case_id)) } catch { /* unknown = no claim */ }
    }
    return boardClaims.has(id)
  }
  const remPlans = new Map()
  for (const c of open) {
    /* Open hours (2026-10-12): only a person sends that ask, from Team Builder. The tick never texts, reminds or
       closes it. */
    if (c?.open_hours === true) continue
    const cands = await candidatesFor(c)

    /* ── CI3 (2026-10-04, her decision 1): REMINDERS UNTIL SOMEONE HAS IT. Nobody tapped "I've got it", confirmed or
       closed it: every admin who got the call-in text gets a reminder with their link, every 15 minutes, at most 4. At
       night only for a MUST BE COVERED shift (or one within 3 hours while call-ins may text after hours). OFF until
       ops_settings.callin_reminders_live; while off, what WOULD have gone is recorded on the case (practice). */
    try {
      /* only the schedule's own run (or a committed run) reminds; an owner's manual check never texts or records */
      if ((caller === 'cron' || commit) && c.admin_alerted && c.kind !== 'interest' && !c.claimed_by) {
        const planR = await readPlan(sb, c.client_axiscare_id, remPlans)
        const mustR = isMustCover(planR.plan)
        let startsInR: number | null = null
        if (c.shift_date && /^\d\d:\d\d/.test(String(c.shift_time || ''))) {
          const chiNowR = new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).replace(' ', 'T')
          startsInR = Math.round((new Date(`${c.shift_date}T${String(c.shift_time).slice(0, 5)}:00`).getTime() - new Date(chiNowR).getTime()) / 60000)
        }
        const dR = reminderDue(c, settings, { must: mustR, claimedElsewhere: await boardClaimFor(String(c.id)), startsInMin: startsInR, callinAnyHour: afterHoursAllowed(settings, 'callin') })
        if (dR.due) {
          const liveR = settings.callin_reminders_live === true
          let reachedR: string[] = []
          if (liveR && ghl.token && ghl.locationId)
            reachedR = await textCaseAdmins(sb, ghl, settings, c, (link) => withLink(reminderText(c, caseWhat(c), dR, mustR), link),
              { onlyAlerted: true, allIfNoneRecorded: true, emergency: dR.emergency })
          const freshR = await readCaseFresh(c.id)
          if (freshR && freshR.status === 'open') {
            const list = [...(Array.isArray(freshR.callin_reminders) ? freshR.callin_reminders : []), { at: nowIso(), n: dR.n, ...(liveR ? { sent: reachedR.length } : { practice: true }) }]
            await sb.rpc('coverage_case_patch', { p_id: String(c.id), p_patch: { callin_reminders: list }, p_expect: { status: 'open' } })
            c.callin_reminders = list
          }
          if (liveR) stats.callin_reminders = (Number(stats.callin_reminders) || 0) + reachedR.length
          else stats.callin_reminders_practice = (Number(stats.callin_reminders_practice) || 0) + 1
        }
      }
    } catch (e) { console.error('[coverage-run] call-in reminder failed', e) }

    /* ── CARA PHASE 1, step 2 (2026-10-23): URGENCY ON EVERY CASE, AND CRITICAL REACHES THE PEOPLE ON DUTY AT ONCE.
       Her words: "Urgent alerts to the person on duty should happen immediately." The level is kept on the case only when
       it changes. A case that turns Critical while nobody is confirmed texts the Staffing seat and In charge now (at any
       hour: a shift within 3 hours, or a must-be-covered client), once per case. A case that is already Critical when it is
       first seen goes with the call-in alert below (same run): the people on duty who are not on that alert list get the
       Critical text, and nobody gets two texts. Switch
       ops_settings.cara_urgency_live; off, the level and what WOULD have gone are kept as practice (urgency_practice). */
    try {
      if ((caller === 'cron' || commit) && c.kind !== 'interest') {
        const urgLive = settings.cara_urgency_live === true
        const plU = await readPlan(sb, c.client_axiscare_id, remPlans)
        const u = urgencyOf(c, chiNowNaive(), { must: isMustCover(plU.plan) })
        const fieldU = urgLive ? 'urgency' : 'urgency_practice'
        const prevU = c[fieldU]
        const patchU: Record<string, unknown> = {}
        if (!prevU || prevU.level !== u.level) patchU[fieldU] = { level: u.level, why: u.why, at: nowIso() }
        const doneKey = urgLive ? 'critical_alerted' : 'critical_alerted_practice'
        if (u.level === 'critical' && !confirmed(c) && !c[doneKey]) {
          {
            const rd = async (k: string) => { const { data } = await sb.from('app_data').select('data').eq('key', k).maybeSingle(); return Array.isArray(data?.data) ? data!.data : [] }
            const [dw, pos, cs] = await Promise.all([rd('duty_windows'), rd('positions'), rd('coordinator_staff')])
            const admins = await adminRecipients(sb, settings)
            const seats = onDuty(dw, settings, new Date(), pos, admins[0]?.email || '')
            // deno-lint-ignore no-explicit-any
            const staffFor = (email: string) => { const p = cs.find((x: any) => String(x?.email || '').trim().toLowerCase() === email); if (!p) return null
              const name = String(p.name || email.split('@')[0]); return { email, name, first: name.split(/\s+/)[0], phone: normalisePhone(p.phone) || null } }
            const who0 = criticalRecipients(seats, admins, staffFor)
            /* first seen already Critical: the call-in alert goes to its list in this same run, so only the people on duty
               who are NOT on that list get the Critical text (nobody gets two texts for one shift) */
            const firstSeen = !c.admin_alerted
            const who = firstSeen ? { ...who0, to: who0.to.filter((a) => !admins.some((x) => x.email === a.email)) } : who0
            const when = [c.shift_date, span12(c.shift_time)].filter(Boolean).join(' ')
            const reached: string[] = []
            if (urgLive && ghl.token && ghl.locationId) {
              for (const a of who.to) {
                const link = await callinLink(String(c.id), a.email, c.shift_date)
                // deno-lint-ignore no-explicit-any
                if (await textAdmin(sb, ghl, a as any, withLink(criticalText(c, u, when), link), fetch, { emergency: true })) reached.push(a.email)
              }
              if (reached.length) await rememberAlerted(sb, String(c.id), reached)
            }
            patchU[doneKey] = { at: nowIso(), to: who.to.map((a) => a.email), why: who.why, ...(firstSeen ? { with_callin_alert: true } : {}), ...(urgLive ? { reached } : { practice: true, text: criticalText(c, u, when) }) }
            if (urgLive) await opEvent(sb, { job: 'coverage-run', verb: 'coverage_critical', item_id: String(c.id), area: 'coverage',
              summary: `Critical open shift: ${c.client || 'a client'} ${when} (${u.why}); texted ${reached.length} on duty` })
          }
        }
        if (Object.keys(patchU).length) {
          await sb.rpc('coverage_case_patch', { p_id: String(c.id), p_patch: patchU, p_expect: { status: 'open' } })
          Object.assign(c, patchU)
        }
      }
    } catch (e) { console.error('[coverage-run] urgency failed', e) }

    /* ── ADMIN ALERT ON DETECTION (her ask: are all admin alerted by text
       and email when a call-in is detected? They are now.) Every NEW case,
       from any entry point, pushes to every admin: SMS (held 21:00-08:00
       unless the shift starts within 3 hours) and email (always — email is
       silent). Once per case. Admin list: ops_settings.coverage_alert_admins
       (array of emails), default the Scheduling and coverage owner + the Springfield lead (SOP ruling 8). */
    /* RETRY (2026-10-01, Samantha "yes make them retry"): the call-in alert is stamped sent only when at least one
       admin was reached (email or text). If nobody was, the next run tries again: at most 3 tries, 10+ minutes apart. */
    const alertRetryOk = (Number(c.admin_alert_tries) || 0) < 3
      && (!c.admin_alert_last_try || Date.now() - Date.parse(String(c.admin_alert_last_try)) >= 10 * 60_000)
    if (!c.admin_alerted && alertRetryOk && c.kind !== 'interest' && ghl.token && ghl.locationId) {
      const admins: string[] = (Array.isArray(settings.coverage_alert_admins)
        && settings.coverage_alert_admins.length)
        ? settings.coverage_alert_admins.map((e: unknown) => String(e).toLowerCase())
        : await fallbackList(sb, 'scheduling_coverage')   // SOP ruling 8 (2026-10-17): owner + Springfield lead, never a name in code
      const whenTxt = [c.shift_date, span12(c.shift_time)].filter(Boolean).join(' ') || 'time on the case'
      const chiHrA = Number(new Date().toLocaleString('en-US',
        { timeZone: 'America/Chicago', hour: '2-digit', hour12: false }))
      let soonA = false
      if (c.shift_date && /^\d\d:\d\d/.test(String(c.shift_time || ''))) {
        const chiNowA = new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).replace(' ', 'T')
        const dMs = new Date(`${c.shift_date}T${String(c.shift_time).slice(0, 5)}:00`).getTime() - new Date(chiNowA).getTime()
        soonA = dMs > 0 && dMs < 3 * 3600000
      }
      /* "Must be covered, no matter what" (the client's call-in plan): the admin text goes at any hour */
      const planA = await readPlan(sb, c.client_axiscare_id, new Map())
      const mustA = isMustCover(planA.plan)
      /* OFFICE QUIET HOURS (Samantha, 2026-10-03): no admin text 8pm to 7am Central, even for a shift starting soon.
         The email still goes (it wakes nobody) and the case is on the board. The one exception is her own: a client
         whose call-in plan says "must be covered, no matter what" (CALLIN-PLAN.md, "the admin text goes at any hour"). */
      /* AFTER HOURS (Samantha, 2026-10-03, Desktop 426: "i want the missed clock ins to be live after hours too, that
         and call ins"): every call-in texts the admins at any hour unless she switches ops_settings.callin_after_hours
         off in the Hub; then the 425 rule above applies again. */
      const callinAnyHour = afterHoursAllowed(settings, 'callin')
      const smsOk = mustA || callinAnyHour || (!officeQuiet(new Date(), settings) && (soonA || (chiHrA >= 8 && chiHrA < 21)))
      const calledAt = new Date(String(c.opened_at || Date.now()))
        .toLocaleString('en-US', { timeZone: 'America/Chicago',
          month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      /* CI2 (2026-10-03): each admin's text carries their OWN link to the call-in page (confirm, call, ask more, I've got
         it), instead of the board's address that needed a sign-in. */
      /* Taken off in AxisCare is not a call-in (2026-10-22): the client may have cancelled, or the office approved the
         time off, so the text never says the caregiver called off (_shared/not-a-callin.ts). */
      const takenOff = takenOffNotCalledIn(c)
      const smsMsg = linkTemplate((takenOff ? '' : String(settings.coverage_msg_admin_alert || '')) ||
        (takenOff
          ? `Shift with no caregiver: {client} {when}.{who} Seen at {called_at}. If the client cancelled, close it from your link. Otherwise choose who to ask: {link}`
          : manualSelect
          ? `New call-in: {client} {when}.{who} Called in at {called_at}. Choose who to ask, confirm, or call from your link: {link}`
          : `New call-in: {client} {when}.{who} Called in at {called_at}. The callout engine is texting caregivers. Your link: {link}`))
        .replaceAll('{client}', String(c.client || 'client on the case'))
        .replaceAll('{when}', whenTxt)
        .replaceAll('{who}', c.calling_off ? ` ${c.calling_off} ${offWords(c)}.` : '')
        .replaceAll('{called_at}', calledAt)
        .replace(/\s{2,}/g, ' ').trim()
        .replace(/^/, mustA ? 'MUST BE COVERED (call-in plan). ' : '')
      const planTxtA = planA.plan ? planLine(planA.plan) : ''
      const { data: stRowA } = await sb.from('app_data').select('data').eq('key', 'coordinator_staff').maybeSingle()
      const staffA: any[] = Array.isArray(stRowA?.data) ? stRowA!.data : []
      let alerted = 0, reachedA = 0
      const textedA: string[] = []
      for (const adm of admins) {
        const person = staffA.find((s: any) => String(s.email || '').toLowerCase() === adm)
        const linkA = await callinLink(String(c.id), adm, c.shift_date)
        // Email always (silent), through the same GHL pipe as the 7am digest.
        try {
          /* ONE CONTACT (2026-10-01): the email goes to the contact found by the one-contact rule for email (the
             text below already finds its own through contactForOutbound). */
          const cid = await ghlStaffContact(ghl, { channel: 'email', email: adm, phone: person?.phone, firstName: person?.name || 'CC', lastName: 'Admin' })
          /* NO SILENT FAILURES (2026-10-01): the call-in alert to an admin is automatic, so an email or text
             GoHighLevel refuses (or a contact it can't make) raises a card on Needs Attention. When it was stamped
             (admin_alerted) is unchanged. */
          if (!cid) await reportSendProblem(sb, { sender: 'staff-alert', channel: 'email', address: adm, who: person?.name || adm,
            reasons: ['GHL returned no contact id'], failed: true })
          if (cid) {
            const wentA = await ghlSendChecked(sb, { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
              'staff-alert', { channel: 'email', contactId: cid, address: adm, who: person?.name || adm }, {
                subject: `${mustA ? 'MUST COVER · ' : ''}${takenOff ? 'Shift with no caregiver' : 'Call-in'}: ${c.client || 'coverage case'} ${whenTxt}`,
                html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#1f2a36;">`
                  + (takenOff ? `<p><b>A shift has no caregiver in AxisCare.</b> This is not counted as a call-in: AxisCare does not say why the caregiver came off (the client may have cancelled, or the time off was approved). If it really was a call-in, log it on the Attendance page.</p>`
                    : `<p><b>New call-in detected.</b></p>`)
                  + `<p>Client: <b>${String(c.client || '?')}</b><br>Shift: <b>${whenTxt}</b>`
                  + (c.calling_off ? `<br>${takenOff ? 'Was on the shift' : 'Called off'}: <b>${String(c.calling_off)}</b>` : takenOff ? '' : '<br>Called off: (unknown)')
                  + `<br>${takenOff ? 'Seen' : 'Called in'} at: <b>${calledAt}</b> (Chicago)`
                  + (c.modification_reason ? `<br>Reason: ${String(c.modification_reason)}` : '')
                  + (planTxtA ? `<br>Call-in plan: <b>${planTxtA}</b>` : '')
                  + (planA.plan?.note ? `<br>Plan note: ${String(planA.plan.note).replace(/[<>&]/g, '')}` : '')
                  + `</p><p>` + (manualSelect
                    ? `Cara has ranked the candidates. Open the case and choose who to ask (worked-with-this-client first). Nothing is texted until you press send. `
                    : `The callout engine is texting qualified caregivers in waves. `)
                  + `Watch replies and confirm the fill on the board: <a href="https://cc.mo-care.com">cc.mo-care.com</a> (Scheduling, Coverage Help).</p>`
                  + (linkA ? `<p>Or from your phone, no sign-in: <a href="${linkA}">open this call-in</a> (your own link).</p>` : '') + `</div>` })
            if (wentA) { alerted++; reachedA++ }
            // SMS too, when the hour allows and we have a number.
            if (smsOk) {
              const ph = normalisePhone(person?.phone)
              if (ph) {
                const contact = await contactForOutbound(sb, ghl,
                  { phone: ph, email: adm, firstName: person?.name || adm.split('@')[0] },
                  'urgent_internal', { selfSupplied: true, audience: 'staff', emergency: mustA || callinAnyHour })
                if (contact && await ghlSendChecked(sb, { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
                  'staff-alert', { channel: 'sms', contactId: contact.contactId, address: ph, who: person?.name || adm }, { message: withLink(smsMsg, linkA) })) { reachedA++; textedA.push(adm) }
              }
            }
          }
        } catch (e) { /* an unreachable admin must not block the callout */
          await reportSendProblem(sb, { sender: 'staff-alert', channel: 'email', address: adm, who: person?.name || adm,
            reasons: ['could not send: ' + String((e as Error)?.message ?? e).slice(0, 80)], failed: true })
        }
      }
      await rememberAlerted(sb, String(c.id), textedA)   /* CI2: who got the call-in text (for "Filled by" later) */
      const freshA = await readCaseFresh(c.id)
      if (freshA) {
        if (reachedA > 0) freshA.admin_alerted = nowIso()
        else { freshA.admin_alert_tries = (Number(freshA.admin_alert_tries) || 0) + 1; freshA.admin_alert_last_try = nowIso() }
        await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: freshA })
        c.admin_alerted = freshA.admin_alerted; c.admin_alert_tries = freshA.admin_alert_tries; c.admin_alert_last_try = freshA.admin_alert_last_try
      }
      stats.admin_alerts = (Number(stats.admin_alerts) || 0) + alerted

      /* AUTO ATTENDANCE (her ask): the call-in lands on the Performance →
         Attendance record automatically, same shape the manual "Log it"
         button writes — reported_at + notice_hours feed the existing
         write-up triggers (short notice, too many in the window). Only when
         we KNOW who called off; deterministic id = once per case. Never for a shift taken off in AxisCare
         (2026-10-22): that is not a call-in and must not mark against the caregiver. */
      /* CARA PHASE 3 (2026-10-24, her rule): a case Cara opened from the caregiver's own words ("can't come") never logs
         attendance by itself. One card asks a person to confirm it, then log it on Attendance. */
      if (c.calling_off && !takenOff && c.attendance_confirm === true) {
        const aid = `ops_attc_${String(c.id).replace(/[^A-Za-z0-9]/g, '_').slice(-80)}`
        if (!haveItem.has(aid)) {
          await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { id: aid, kind: 'staffing', domain: 'scheduling_coverage', status: 'open', urgency: 'today',
            coverage_case_id: c.id, about: String(c.calling_off), title: `Confirm: did ${c.calling_off} call off ${c.client || 'the client'} ${[c.shift_date, c.shift_time].filter(Boolean).join(' ')}?`,
            detail: `Cara opened this call-off case from ${c.calling_off}'s own words${c.said ? `: "${String(c.said).slice(0, 200)}"` : ''}. It is not on their attendance yet. If it was a call-off, log it on Performance > Attendance; if not, close this card.`,
            owner: '', owner_name: '', created_at: nowIso(), due: new Date(Date.now() + 24 * 3600e3).toISOString(), created_by: 'coverage-run', opened_by: 'caregiver-words' } })
          haveItem.add(aid)
        }
      }
      if (c.calling_off && !takenOff && c.attendance_confirm !== true) {
        let noticeHours: number | null = null
        if (c.shift_date && /^\d\d:\d\d/.test(String(c.shift_time || '')) && c.opened_at) {
          const chiOpened = new Date(String(c.opened_at))
          const startNaive = new Date(`${c.shift_date}T${String(c.shift_time).slice(0, 5)}:00-05:00`)
          const h = (startNaive.getTime() - chiOpened.getTime()) / 3600000
          if (Number.isFinite(h)) noticeHours = Math.round(h * 10) / 10
        }
        await sb.rpc('upsert_app_data_item', { target_key: 'attendance_events', item: {
          id: 'att_cov_' + c.id, caregiver: String(c.calling_off), type: 'callin',
          ...(c.calling_off_id ? { axiscare_caregiver_id: String(c.calling_off_id) } : {}),
          shift_date: c.shift_date || nowIso().slice(0, 10), shift_time: String(c.shift_time || ''),
          note: `Auto-logged from the coverage case for ${c.client || 'a client'}.`,
          logged_by: 'coverage-engine', created_at: nowIso(), action_id: null,
          reported_at: c.opened_at || nowIso(), notice_hours: noticeHours,
        } })
      }
    }

    /* ── PRE-BUILT ASK LIST (her pick #1, 2026-09-19): in manual mode the
       cron builds each fresh case's candidate list AHEAD of the coordinator,
       so opening the case shows a ranked, sensibly-checked list instantly —
       the 6am decision becomes review-and-send, not build-and-wait. Only
       while the case has no asks yet, refreshed when older than 30 minutes;
       once texting starts the picker's live rebuild takes over. */
    if (commit && manualSelect && !(Array.isArray(c.asked) && c.asked.length)
        && c.kind !== 'interest'
        && (!c.prebuilt_at || (Date.now() - new Date(String(c.prebuilt_at)).getTime()) > 30 * 60000)) {
      try {
        const pb = await buildCandidatesForCase(c)
        const fresh = await readCaseFresh(c.id)
        if (fresh && !(Array.isArray(fresh.asked) && fresh.asked.length)) {
          fresh.prebuilt = { group1: pb.group1, group2: pb.group2,
            excluded: pb.excluded, meta: pb.meta }
          fresh.prebuilt_at = nowIso()
          await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: fresh })
          c.prebuilt = fresh.prebuilt; c.prebuilt_at = fresh.prebuilt_at
        }
      } catch { /* a failed prebuild costs nothing — the picker still builds on click */ }
    }

    /* ── THE QUIET-CALLOUT NUDGE (2026-09-19): in manual mode a sent ask
       with no yes must never die silently. 30 minutes after the newest ask
       with zero yeses, a person gets tapped — ops item always, office SMS
       only when the shift starts within 3 hours. A new send re-arms it. */
    if (commit && manualSelect && Array.isArray(c.asked) && c.asked.length
        // deno-lint-ignore no-explicit-any
        && !c.asked.some((a: any) => a.state === 'yes') && c.kind !== 'interest') {
      // deno-lint-ignore no-explicit-any
      const newestQ = c.asked.map((a: any) => new Date(String(a.at || 0)).getTime())
        .filter(Number.isFinite).sort((x: number, y: number) => y - x)[0] ?? 0
      const quietMin = Number(settings.coverage_quiet_callout_min) > 0
        ? Number(settings.coverage_quiet_callout_min) : 30
      if (newestQ && Date.now() - newestQ > quietMin * 60000
          && String(c.quiet_nudged_for || '') !== String(newestQ)) {
        /* First look at THIS quiet wave? The ops item and the shadow row are
           written once per wave — a re-upsert on later ticks would resurrect
           an item somebody already closed. */
        const firstLookQ = String(c.quiet_suppressed_for || '') !== String(newestQ)
        // deno-lint-ignore no-explicit-any
        const noes = c.asked.filter((a: any) => a.state === 'no').length
        const whenQ = [c.shift_date, span12(c.shift_time)].filter(Boolean).join(' ') || 'the shift'
        if (firstLookQ) await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: {
          id: `ops_covquiet_${c.id}_${newestQ}`, kind: 'coverage', coverage_case_id: c.id,
          title: `Nobody's answered: ${c.client || 'shift'} ${whenQ}, ${c.asked.length} asked`,
          about: c.client || '',
          detail: `${Math.round((Date.now() - newestQ) / 60000)} min since the last ask: ${noes} no, ${c.asked.length - noes} silent, zero yes. Widen to Group 2 on the case, or start calling.`,
          domain: 'scheduling_coverage', status: 'open', urgency: 'high',
          owner: '', owner_name: '', created_at: nowIso(),
          due: new Date(Date.now() + 3600000).toISOString(),
          created_by: 'coverage-run', opened_by: 'quiet-callout',
        } })
        if (firstLookQ) await opEvent(sb, { job: 'coverage-run', verb: 'item_created', item_id: String(c.id), area: 'coverage',
          summary: `Cara raised: nobody's answered: ${c.client || 'shift'} ${whenQ}, ${c.asked.length} asked, zero yes` })
        let soonQ = false, minsToShiftQ = 0
        if (c.shift_date) {
          const sH = String(c.shift_time || '').split('-')[0] || '23:59'
          const chiNowQ = new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).replace(' ', 'T')
          const dMs = new Date(`${c.shift_date}T${/^\d\d:\d\d$/.test(sH) ? sH : '23:59'}:00`).getTime() - new Date(chiNowQ).getTime()
          soonQ = dMs > 0 && dMs < 3 * 3600000
          minsToShiftQ = Math.max(0, Math.round(dMs / 60000))
        }
        /* CLAIM-AWARE SUPPRESSION WITH A CLOCK. A claim means somebody is
           handling this — while it stays TRUE the office phones stay quiet.
           Truth is measured, not assumed: meaningful movement is the claim
           itself, activity logged on the item, new asks going out, or
           replies coming in. When a claimed case sits without movement for
           the same window that defines "too quiet" (quietMin, the number
           the office already runs), and the shift is inside the existing
           under-3-hour danger window, the claim stops protecting it.

           Shaped so the Playbook can take over later: staleness threshold
           and time-to-shift are inputs here, and the sched_calloffs row's
           escalation rule can replace quietMin once routing goes live. */
        let claimedByQ = '', lastMoveQ = 0
        try {
          const { data: oiQ } = await sb.from('app_data').select('data').eq('key', 'ops_items').maybeSingle()
          // deno-lint-ignore no-explicit-any
          const rowsQ: any[] = Array.isArray(oiQ?.data) ? oiQ.data : []
          // deno-lint-ignore no-explicit-any
          const clQ = rowsQ.find((x: any) => x?.status === 'open' && x?.claimed_by
            && String(x?.coverage_case_id || '') === String(c.id))
          if (clQ) {
            claimedByQ = String(clQ.claimed_by_name || clQ.claimed_by)
            lastMoveQ = [clQ.claimed_at, clQ.last_activity_at,
              // deno-lint-ignore no-explicit-any
              ...c.asked.map((a: any) => a.at), ...c.asked.map((a: any) => a.replied_at)]
              .filter(Boolean).map((t: unknown) => new Date(String(t)).getTime())
              .filter(Number.isFinite).sort((x: number, y: number) => y - x)[0] ?? 0
          }
        } catch { /* unknown = behave as before (no suppression) */ }
        /* CI2: "I've got it" on the call-in page is a claim too */
        if (!claimedByQ && c.claimed_by_name) {
          claimedByQ = String(c.claimed_by_name)
          lastMoveQ = [c.claimed_at, ...c.asked.map((a: any) => a.at), ...c.asked.map((a: any) => a.replied_at)]
            .filter(Boolean).map((t: unknown) => new Date(String(t)).getTime()).filter(Number.isFinite).sort((x: number, y: number) => y - x)[0] ?? 0
        }
        const staleMinQ = claimedByQ && lastMoveQ ? Math.round((Date.now() - lastMoveQ) / 60000) : 0
        const claimActiveQ = !!claimedByQ && staleMinQ < quietMin
        /* CI2 (her decision 2): the call-in list, each with their own link (it was a list of bare phone numbers) */
        const adminsQ = (await adminRecipients(sb, settings)).filter((a) => a.phone)
        const phonesQ: string[] = adminsQ.map((a) => String(a.phone))
        const resumingQ = !!claimedByQ && !claimActiveQ
        /* office quiet hours (2026-10-03): the office text never goes 8pm to 7am; the Needs Attention item above is
           where it waits (this wave is still marked nudged, so nothing goes out at 7am for it) */
        const quietQ = officeQuiet(new Date(), settings)
        if (soonQ && (firstLookQ || resumingQ)) {
          await shadowRoute(sb, { area: 'sched_calloffs', channel: 'quiet-callout office SMS',
            production: (sendLive && !claimActiveQ && !quietQ) ? phonesQ : [], case_id: String(c.id),
            note: quietQ ? 'office quiet hours: no office text, the item waits in Needs Attention' : claimActiveQ ? `SMS suppressed: ${claimedByQ} has it (moved ${staleMinQ} min ago)`
              : resumingQ ? `claim stale: ${claimedByQ} has it but nothing moved for ${staleMinQ} min; alert resumed`
              : (sendLive ? '' : 'text sending is off') })
        }
        if (soonQ && sendLive && !claimActiveQ && !quietQ && ghl.token && ghl.locationId) {
          if (resumingQ) await opEvent(sb, { job: 'coverage-run', verb: 'claim_stale', item_id: String(c.id), area: 'coverage',
            summary: `Office alert resumed: ${claimedByQ} has ${c.client || 'the shift'} but nothing has moved for ${staleMinQ} min and it starts in ${minsToShiftQ} min` })
          const msgQ = resumingQ
            ? `Cara: ${claimedByQ} took the ${c.client || 'open-shift'} callout (${whenQ}) but nothing has moved for ${staleMinQ} min and it starts in ${minsToShiftQ} min. Check in or jump in: {link}`
            : `Cara: nobody has answered the ask for ${c.client || 'a shift'} ${whenQ} (${c.asked.length} asked, 0 yes) and it starts soon. Ask more or start calling: {link}`
          const textedQ: string[] = []
          for (const a of adminsQ) {
            const p = String(a.phone)
            try {
              const contact = await contactForOutbound(sb, ghl,
                { phone: p, email: a.email, firstName: a.first || 'Scheduling' }, 'urgent_internal', { selfSupplied: true, audience: 'staff' })
              if (contact && await ghlSendChecked(sb, { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
                'staff-alert', { channel: 'sms', contactId: contact.contactId, address: p, who: a.name || 'the office (nobody answered the ask)' },
                { message: withLink(msgQ, await callinLink(String(c.id), a.email, c.shift_date)) })) textedQ.push(a.email)
            } catch (e) { /* the item is the guarantee */
              await reportSendProblem(sb, { sender: 'staff-alert', channel: 'sms', address: p, who: a.name || 'the office (nobody answered the ask)',
                reasons: ['could not send: ' + String((e as Error)?.message ?? e).slice(0, 80)], failed: true })
            }
          }
          await rememberAlerted(sb, String(c.id), textedQ)
        }
        if (claimActiveQ) {
          /* Held, not consumed: quiet_nudged_for stays unset so every run
             re-measures the claim. The wave's item/shadow stay once-only via
             quiet_suppressed_for. */
          if (firstLookQ) {
            const freshQ = await readCaseFresh(c.id)
            if (freshQ) {
              freshQ.quiet_suppressed_for = String(newestQ)
              freshQ.quiet_suppressed_at = nowIso()
              await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: freshQ })
              c.quiet_suppressed_for = freshQ.quiet_suppressed_for
            }
          }
        } else {
          const freshQ = await readCaseFresh(c.id)
          if (freshQ) {
            freshQ.quiet_nudged_for = String(newestQ)
            freshQ.quiet_nudged_at = nowIso()
            await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: freshQ })
            c.quiet_nudged_for = freshQ.quiet_nudged_for; c.quiet_nudged_at = freshQ.quiet_nudged_at
          }
        }
      }
    }

    /* Tier 1: visit history with THIS client, if the client resolves. A case
       opened by coverage-watch carries the client's AxisCare id straight off
       the visit — exact, no name matching needed. Phone-opened cases still
       resolve their free-text name through the identity layer. */
    const clientRes = c.client_axiscare_id
      ? { status: 'resolved', id: String(c.client_axiscare_id),
          detail: `AxisCare client ${c.client_axiscare_id} (from the AxisCare visit)` }
      : await resolveClientAxisId(String(c.client ?? ''))
    /* The client's city (for anonymous wording) and CARE LEVEL (for the
       qualification filter) — one cached fetch, done here because the level
       must be known BEFORE the wave is built. */
    /* Change 6b: an unknown level (null) is re-read at most hourly, instead of never */
    const levelStale = c.client_care_level === undefined
      || (c.client_care_level === null && (!c.client_care_level_checked_at || Date.now() - Date.parse(c.client_care_level_checked_at) > 3600000))
    if ((!c.client_city || levelStale) && clientRes.id) {
      try {
        const { token: acTok, site: acSite } = axisCreds()
        if (acTok && acSite) {
          const r = await fetch(`https://${acSite}.axiscare.com/api/clients/${encodeURIComponent(String(clientRes.id))}`, {
            headers: { Authorization: `Bearer ${acTok}`, Accept: 'application/json',
                       'X-AxisCare-Api-Version': AC_VERSION } })
          const j: any = await r.json().catch(() => ({}))
          const cl = j?.results?.client ?? j?.results ?? {}
          c.client_city = c.client_city || (String(cl?.residentialAddress?.city ?? '') || null)
          c.client_street = String(cl?.residentialAddress?.streetAddress1 ?? '') || null
          const lv = careLevelOf(cl?.classes)
          c.client_care_level = lv.level          // null = no level class on the client
          c.client_care_level_from = lv.from
          c.client_care_level_checked_at = new Date().toISOString()
        }
      } catch { /* no city/level = plainer wording, no level filter */ }
    }
    /* WHO'S ALREADY WORKING during this shift: texting a caregiver who is on
       another visit at that exact time wastes the wave's best minutes. One
       same-day visits fetch; overlap on the naive HH:MM window. Overnight
       windows (end before start) skip the check rather than guess. */
    const busyThen = new Set<string>()
    let busyCheck = 'no shift date/time on the case, busy check off'
    if (c.shift_date && /^\d\d:\d\d-\d\d:\d\d$/.test(String(c.shift_time || ''))) {
      const [shStart, shEnd] = String(c.shift_time).split('-')
      if (shEnd <= shStart) busyCheck = 'overnight window, busy check off (cannot compare across midnight safely)'
      else {
        const day = await fetchVisits(`startDate=${c.shift_date}&endDate=${c.shift_date}`)
        if (day.error) busyCheck = `could not read the day's schedule (${day.error}), busy check off`
        else {
          for (const v of day.rows) {
            const cg = v?.caregiver?.id
            if (cg == null) continue
            const vs = String(v?.scheduledStartDate ?? v?.startDate ?? '').slice(11, 16)
            const ve = String(v?.scheduledEndDate ?? v?.endDate ?? '').slice(11, 16)
            if (!vs || !ve || ve <= vs) continue
            if (vs < shEnd && ve > shStart) busyThen.add(String(cg))
          }
          busyCheck = `${busyThen.size} caregiver(s) already on a visit during this window`
        }
      }
    }
    const history = new Map<string, { visits: number; last: string; same_time: number }>()
    let historyError: string | null = null
    const cBandsW = caseBands(c)   /* her ask (2026-10-24): same time of day first, with cara_same_time_live on */
    if (clientRes.id) {
      const h = await fetchVisits(
        `startDate=${dISO(180)}&endDate=${dISO(0)}&clientIds=${encodeURIComponent(clientRes.id)}`)
      historyError = h.error
      for (const v of h.rows) {
        const cg = v?.caregiver?.id
        if (cg == null) continue
        const k = String(cg)
        const day = String(v?.date ?? v?.startDate ?? v?.start ?? '')
        const same = sameTimeOfDay(cBandsW, bandsOfTimes(String(v?.scheduledStartDate ?? v?.startDate ?? '').slice(11, 16), String(v?.scheduledEndDate ?? v?.endDate ?? '').slice(11, 16)))
        const cur = history.get(k) ?? { visits: 0, last: '', same_time: 0 }
        history.set(k, { visits: cur.visits + 1, last: day > cur.last ? day : cur.last, same_time: cur.same_time + (same ? 1 : 0) })
      }
    }
    const tierOf = (x: any): { tier: number; why: string } => {
      const id = x.axiscare_id ? String(x.axiscare_id) : ''
      const h = id ? history.get(id) : undefined
      if (h) return { tier: 1, why: `${h.visits} visit${h.visits === 1 ? '' : 's'} with this client, last ${h.last || 'date unknown'}` }
      if (id && recentlyActive.has(id)) return { tier: 2, why: 'worked a shift in the last 14 days' }
      return { tier: 3, why: x.axiscare_id ? 'no recent or client history found' : 'no AxisCare id on the roster record' }
    }
    for (const x of cands) {
      if (!x.may_autosend) continue
      const t = tierOf(x); x.tier = t.tier; x.tier_why = t.why
    }
    /* PRN3: for a call-off or one-time shift, PRN members who fit go first (tier 0); a PRN member who doesn't fit, or
       any PRN member for a regular opening, is left out of the automatic waves (a person can still ask them). */
    const ongoingW = isOngoingCase(c)
    for (const x of cands) {
      const pm = x.axiscare_id ? prnTeamW.get(String(x.axiscare_id)) : undefined
      if (!pm || !x.may_autosend) continue
      const f = prnFit(c, pm, busyThen.has(String(x.axiscare_id)))
      if (!ongoingW && f.fit) { x.tier = 0; x.tier_why = 'PRN CNA Team, fits this shift'; x.prn_ask = true }
      /* 2026-10-14: outside their stated times but they asked to hear about those shifts: asked in their normal place, not first */
      else if (!ongoingW && f.outside) { x.outside_ask = true; x.tier_why = (x.tier_why ? x.tier_why + '; ' : '') + 'outside their stated times, said OK to texts about those' }
      else x.prn_skip = ongoingW ? 'PRN Team: a regular opening' : 'PRN Team: ' + f.why
    }
    /* 2026-10-14 (her rule: "we need them to check availability"): anyone else whose availability says no to this shift is
       left out of the automatic waves, unless they ticked "also text me about open shifts outside my availability".
       No availability on file = available any time. */
    const availW = await availLoad()
    for (const x of cands) {
      if (!x.may_autosend || x.prn_ask || x.prn_skip || x.outside_ask) continue
      const pmW = x.axiscare_id ? prnTeamW.get(String(x.axiscare_id)) : undefined
      if (pmW) continue
      const av = availCheck(c, x.axiscare_id ? availW.get(String(x.axiscare_id)) : undefined)
      if (!av.outside) continue
      if (av.ok) { x.outside_ask = true; x.tier_why = (x.tier_why ? x.tier_why + '; ' : '') + 'outside their stated times, said OK to texts about those' }
      else x.avail_skip = av.why
    }
    stats.avail_left_out = (Number(stats.avail_left_out) || 0) + cands.filter((x: any) => x.avail_skip).length
    stats.prn_first = (Number(stats.prn_first) || 0) + cands.filter((x: any) => x.prn_ask).length
    stats.prn_left_out = (Number(stats.prn_left_out) || 0) + cands.filter((x: any) => x.prn_skip).length
    const sendable = cands.filter(x => x.may_autosend && !x.prn_skip && !x.avail_skip).sort((a: any, b: any) =>
      (a.tier - b.tier) ||
      ((a.outside_ask ? 1 : 0) - (b.outside_ask ? 1 : 0)) ||
      (settings.cara_same_time_live === true ? ((history.get(String(b.axiscare_id ?? ''))?.same_time ?? 0) > 0 ? 1 : 0) - ((history.get(String(a.axiscare_id ?? ''))?.same_time ?? 0) > 0 ? 1 : 0) : 0) ||
      ((history.get(String(b.axiscare_id ?? ''))?.visits ?? 0) -
       (history.get(String(a.axiscare_id ?? ''))?.visits ?? 0)) ||
      ((wantGap.get(String(b.axiscare_id ?? '')) ?? -999) -
       (wantGap.get(String(a.axiscare_id ?? '')) ?? -999)))
    stats.candidates_total += cands.length
    stats.may_autosend += sendable.length
    stats.blocked_no_phone += cands.filter(x => x.skipped === 'no phone on file').length
    stats.blocked_do_not_offer += cands.filter(x => x.eligibility === 'do_not_offer').length
    stats.blocked_untrusted += cands.filter(x => x.skipped && x.skipped !== 'no phone on file'
                                                 && x.skipped !== 'no longer active'
                                                 && x.eligibility !== 'do_not_offer').length

    /* Never ask the same person twice in the same case unless a retry is
       deliberate. asked[] is the memory. */
    const alreadyAsked = new Set((c.asked ?? []).map((a: { name: string }) =>
      String(a.name || '').toLowerCase()))
    /* Never ask the person who called off to cover their own shift — they
       are usually tier 1 for exactly the wrong reason. And only caregivers
       AxisCare says are ACTIVE get asked at all (when the census is up). */
    const callerOff = String(c.calling_off || '').toLowerCase()
    const callerOffId = String(c.calling_off_id || '')
    /* Do-Not-Return for THIS client (her rule): barred from every wave,
       automatic or manual, whatever tier they would rank. */
    const dnrBarred = await dnrSetFor(String(c.client || ''))
    const planW = await readPlan(sb, clientRes.id, new Map())
    let planSkipped = 0
    let dnrSkipped = 0
    let inactiveSkipped = 0
    let censusHeld = 0
    let underLevelSkipped = 0
    let busySkipped = 0
    let nurseSkipped = 0
    /* THE CARE-LEVEL LADDER (her rule): Level 1 wellness, 2 personal care,
       3 complex. A caregiver covers clients at or below their own level. A
       caregiver with NO level class is allowed through (a human still
       confirms every fill) but a KNOWN lower level is a hard skip. */
    const clientLv: number | null = typeof c.client_care_level === 'number' ? c.client_care_level : null
    const wave = sendable.filter(x => !alreadyAsked.has(String(x.name).toLowerCase()))
                         .filter(x => {
                           if (!dnrBarred.has(nameKeyOf(String(x.name)))) return true
                           dnrSkipped++; return false
                         })
                         .filter(x => !(callerOff && String(x.name).toLowerCase() === callerOff)
                                   && !(callerOffId && String(x.axiscare_id || '') === callerOffId))
                         .filter((x: any) => {
                           /* Census down = nobody sends. Not a fallback. */
                           if (!censusUsable) { censusHeld++; return false }
                           const okAx = x.axiscare_id && axisActive.has(String(x.axiscare_id))
                           if (!okAx) inactiveSkipped++
                           return okAx
                         })
                         .filter((x: any) => {
                           if (clientLv == null || !x.axiscare_id) return true
                           const cgLv = caregiverLevel.get(String(x.axiscare_id))
                           if (cgLv != null && cgLv < clientLv) { underLevelSkipped++; return false }
                           return true
                         })
                         .filter((x: any) => {
                           if (!x.axiscare_id || !busyThen.has(String(x.axiscare_id))) return true
                           busySkipped++; return false
                         })
                         .filter((x: any) => {
                           if (!x.axiscare_id || !nurseAxis.has(String(x.axiscare_id))) return true
                           nurseSkipped++; return false
                         })
                         .filter((x: any) => {
                           /* the call-in plan: only-ask list, and an unreadable plan holds everyone */
                           if (!planW.error && !onlyAskCut(planW.plan, x, String(c.client || ''))) return true
                           planSkipped++; return false
                         })
                         .slice(0, WAVE_SIZE)
    stats.would_ask += wave.length
    stats.skipped_callin_plan = (Number(stats.skipped_callin_plan) || 0) + planSkipped
    /* family covers / flexible: a person calls the family first, so no automatic texts */
    const planHold = holdsAutoTexts(planW.plan)
    if (planHold && wave.length) stats.held_callin_plan = (Number(stats.held_callin_plan) || 0) + wave.length
    stats.held_census_down += censusHeld

    /* ── SEND STAGE — the callout engine (replacing CareQB Callouts).
       One wave per run per case. The first wave goes as soon as the case is
       seen; the next only after the fuse has burned with no YES. Every ask
       lands in asked[] — the same record the manual workflow and the hub
       read — as {name, phone, channel:'sms', at, state:'waiting', tier, auto}.
       A YES anywhere on the case stops all further waves. */
    let sentThisRun = 0
    const askedArr: any[] = Array.isArray(c.asked) ? c.asked : (c.asked = [])
    /* Waves stop while an accepted offer is pending OR any collected yes is
       waiting on the coordinator's pick (2026-09-19: yeses are collected,
       not first-wins — texting more people while the office is choosing
       wastes goodwill). A yes-then-no clears the state and waves resume. */
    const hasYes = !!c.pending_fill || askedArr.some((a: any) => a.state === 'yes')
    const newestAsk = askedArr.map((a: any) => new Date(String(a.at || 0)).getTime())
      .filter((t: number) => Number.isFinite(t))
      .sort((a: number, b: number) => b - a)[0] ?? 0
    const fuseBurned = !newestAsk || (Date.now() - newestAsk) > fuseMin * 60000
    /* QUIET HOURS (idea adopted from CareQB): the case opens and is
       acknowledged at any hour, but fill-in texts hold overnight — unless the
       shift itself starts within 3 hours, when waking people IS the job.
       Defaults 21:00-06:00 Chicago; ops_settings.coverage_quiet_from/until. */
    const chiHour = Number(new Date().toLocaleString('en-US',
      { timeZone: 'America/Chicago', hour: '2-digit', hour12: false }))
    const qFrom = Number.isFinite(Number(settings.coverage_quiet_from)) ? Number(settings.coverage_quiet_from) : 21
    /* Her rule (final form, 2026-09-12): quiet is 9pm to 8am for EVERYONE.
       The only texts allowed before 8am are for a shift starting within 3
       hours — the shiftSoon override below. No 6am texts for later shifts,
       same-day or not. */
    const qUntil = Number.isFinite(Number(settings.coverage_quiet_until)) ? Number(settings.coverage_quiet_until) : 8
    const inQuiet = qFrom > qUntil ? (chiHour >= qFrom || chiHour < qUntil) : (chiHour >= qFrom && chiHour < qUntil)
    let shiftSoon = false
    if (c.shift_date) {
      const startHH = String(c.shift_time || '').split('-')[0] || ''
      const chiNow = new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).replace(' ', 'T')
      const startNaive = `${c.shift_date}T${/^\d\d:\d\d$/.test(startHH) ? startHH : '23:59'}:00`
      const diffMs = new Date(startNaive).getTime() - new Date(chiNow).getTime()
      shiftSoon = diffMs > 0 && diffMs < 3 * 3600000
    }
    const quietHold = inQuiet && !shiftSoon
    /* Phase 2 (2026-10-05): never ask caregivers to cover a shift that is already over. */
    const shiftOver = caseEnded(c, chiNowNaive(), 0)
    if (shiftOver && sendLive && !hasYes && wave.length) stats.held_shift_over = (Number(stats.held_shift_over) || 0) + wave.length
    if (quietHold && sendLive && !hasYes && wave.length) {
      stats.held_quiet_hours = (Number(stats.held_quiet_hours) || 0) + wave.length
    }
    if (sendLive && !manualSelect && !planHold && !hasYes && fuseBurned && !quietHold && !shiftOver && wave.length && ghl.token && ghl.locationId) {
      /* MESSAGE DESIGN (CareQB's template split, revised live 2026-09-16):
         EVERY caregiver's text names the client by FIRST NAME(S) — her call,
         reading the first real wave, reversing the 09-12 stranger rule. First
         names only, no surname: "Joel & Carol", never "Joel & Carol Wolverton".
         Wording is editable without a deploy: ops_settings.coverage_msg_tier1 /
         coverage_msg_other*, placeholders {first_name} {client} {when}. */
      const clientShort = firstNamesOf(String(c.client || '')) || 'a client'
      /* City and care level were fetched before the wave was built. The
         client's AxisCare NOTE text is deliberately never pulled at send
         time: note boxes can hold DOOR CODES, and {care} only ever carries
         what a person left in the form's care box. */
      /* "today 5pm-9pm" reads better than a bare date and a 24-hour clock. */
      const chiToday = new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
      const relDay = c.shift_date ? friendlyDay(c.shift_date) : ''
      const when = [relDay, span12(c.shift_time)].filter(Boolean).join(' ')
        || 'as soon as possible (the office has details)'
      /* {care}: a one-line client synopsis for caregivers who DON'T know the
         client (CareQB's pattern, requested by Samantha) — carried on the
         case (care_note, set/edited in the hub confirm step). Tier 1 knows
         the client, so their default stays short and synopsis-free. */
      /* {care} comes ONLY from the case's care_note — text a person put (or
         approved after a prefill) in the form's care box. Never straight
         from an AxisCare note field: those can carry door codes. */
      const careLine = String(c.care_note || '').trim()
      /* {address}: street + city (her call, 2026-09-12 — distance decides
         whether a caregiver takes a shift, and CareQB showed the street too). */
      /* Street NAME and city only, never the house number (her call,
         2026-09-16): "1331 N Stewart Ave" texts as "N Stewart Ave". A
         caregiver deciding on distance needs the street and the town, not
         the client's front door. Streets that START with a number ("5th
         Ave", "21st St") keep it — only a house-number token is dropped. */
      const streetName = String(c.client_street || '').trim()
        .replace(/^\d+[A-Za-z]?(?:-\w+)?\s+/, '').replace(/^\d+$/, '').trim()
      const addr = [streetName, String(c.client_city || '').trim()]
        .filter(Boolean).join(', ')
      /* No address on the case? The " at {address}" clause disappears whole —
         "open shift for Joel & Carol at the address is with the office" is
         what the old fallback produced, live, on 2026-09-16. Never again. */
      /* {pattern}: what kind of OPENING this is, stamped on the case by the
         watcher from the AxisCare calendar (her ask 2026-09-16, corrected
         same day: a repeating schedule whose regular caregiver only needs
         one date off is NOT an ongoing opening). Only open_ongoing — the
         slot's future dates have nobody — earns "could become your
         regular"; a one-off need says "One time only."; a mixed or
         unstamped case says nothing rather than overclaiming. The
         withdrawn v1 'ongoing' stamp deliberately maps to silence. */
      const pat = (c.shift_pattern && typeof c.shift_pattern === 'object') ? c.shift_pattern : null
      const patLine = pat?.kind === 'open_ongoing'
        ? `This could become your regular ${pat.weekday ? pat.weekday + ' ' : ''}shift. `
        : (pat?.kind === 'one_time' || pat?.kind === 'one_time_cover') ? 'One time only. ' : ''
      const fill = (tmpl: string, x: any) => tmpl
        .replaceAll(' at {address}', addr ? ` at ${addr}` : '')
        .replaceAll('{first_name}', x.first || 'there')
        .replaceAll('{pattern}', patLine)
        .replaceAll('{client}', clientShort)
        .replaceAll('{where}', c.client_city ? ` in ${c.client_city}` : '')
        .replaceAll('{address}', addr || 'the office has the address')
        .replaceAll('{when}', when)
        .replaceAll('{care}', careLine ? careLine + ' ' : '')
        .replace(/\s{2,}/g, ' ').trim()
      /* Message priority: this CASE's edited wording (the coordinator can
         rewrite it in the confirm step before opening) → the agency-wide
         canned responses (Settings → Callout texts) → the built-in default.
         "Last-minute" wording is SAME-DAY ONLY (her rule: a Monday shift on
         Saturday night is an open shift, not a last-minute fill-in). */
      const isSameDay = c.shift_date === chiToday
      const tmpl1 = String(c.msg_tier1 || '') || String(settings.coverage_msg_tier1 || '') ||
        `Hi {first_name}, can you cover {client} {when}? {pattern}It's Caring Companions. Reply YES or NO.`
      const tmplP = String(settings.coverage_msg_prn || '') || PRN_DEFAULT_MSG
      const tmplO = String(c.msg_other || '') ||
        (isSameDay
          ? (String(settings.coverage_msg_other_sameday || '') || String(settings.coverage_msg_other || '') ||
             `Hi {first_name}, it's Caring Companions. Last-minute fill-in for {client} at {address}: {when}. {pattern}{care}Can you take it? Reply YES or NO. Questions welcome.`)
          : (String(settings.coverage_msg_other_advance || '') || String(settings.coverage_msg_other || '') ||
             `Hi {first_name}, it's Caring Companions. We have an open shift for {client} at {address}: {when}. {pattern}{care}Can you take it? Reply YES or NO. Questions welcome.`))
      for (const x of wave) {
        /* An uncovered shift is the textbook urgent_internal: staff, 24/7. */
        const contact = await contactForOutbound(sb, ghl,
          { phone: x.phone, firstName: x.first || x.name }, 'urgent_internal', { audience: 'caregiver', channel: 'sms', sender: 'coverage-run' })
        if (!contact) continue
        const message = fill(x.prn_ask ? tmplP : x.tier === 1 ? tmpl1 : tmplO, x)
        const ok = await ghlSendChecked(sb, { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
          'coverage-run', { channel: 'sms', contactId: contact.contactId, address: x.phone, who: x.name }, { message })
        if (ok) {
          const entry = { id: uid(), name: x.name, phone: x.phone, channel: 'sms',
            at: nowIso(), state: 'waiting', replied_at: null,
            tier: x.tier ?? 3, auto: true, ghl_contact_id: contact.contactId, ...(x.prn_ask ? { prn: true } : {}),
            /* Carried so assign-on-confirm knows WHO to put on the visit
               without a name lookup that could hit the wrong roster row. */
            axiscare_id: x.axiscare_id ?? null }
          /* Persist THIS ask immediately against the CURRENT row (a crash
             mid-wave must not forget delivered texts), and stop the wave the
             moment a YES has landed while we were sending. */
          const fresh = await appendAskFresh(c.id, entry)
          if (fresh) {
            c.asked = fresh.asked; c.pending_fill = fresh.pending_fill
            c.callout_started_at = fresh.callout_started_at
          } else { askedArr.push(entry) }
          sentThisRun++
          if (c.pending_fill) break   // a YES landed mid-wave; stop asking
          /* The tag is what lets the GHL reply-workflow fire ONLY for people
             we actually asked, instead of on every inbound text. */
          try {
            await fetch(`https://services.leadconnectorhq.com/contacts/${contact.contactId}/tags`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28',
                         'Content-Type': 'application/json' },
              body: JSON.stringify({ tags: ['coverage-asked'] }),
            })
          } catch { /* a missing tag only costs a stray workflow execution */ }
        }
      }
      if (sentThisRun) stats.sent += sentThisRun
      /* No bulk end-of-wave write: every ask was persisted fresh above. */
    }

    /* ── TIMEOUT ESCALATION: an exhausted callout must get LOUD. ─────────
       When the bench is empty (nobody left to ask), nobody said yes, and
       the last ask has had 20 minutes to be answered, a person takes over:
       an URGENT item lands on whoever owns scheduling coverage right now,
       and they get an SMS (held during 21:00-08:00 unless the shift starts
       within 3 hours — the same courtesy rule as the callouts themselves).
       Once per case; reopening a case clears the flag. */
    const autoAsked = askedArr.filter((a: any) => a.auto === true)
    const ESCALATE_AFTER_MIN = 20
    /* A wave emptied by a census outage is a HOLD, not an exhausted
       callout — escalating on it would tell staff a lie. */
    /* retired with the automatic waves: it only ever counted automatic asks */
    const escalateReady = !AUTO_WAVES_RETIRED && sendLive && censusUsable && !c.pending_fill
      && !askedArr.some((a: any) => a.state === 'yes')
      && !c.callout_escalated_at
      && autoAsked.length > 0 && wave.length === 0
      && newestAsk > 0 && (Date.now() - newestAsk) > ESCALATE_AFTER_MIN * 60000
    if (escalateReady) {
      const own2 = own.owner || 'samantha@mo-care.com'
      const declined = askedArr.filter((a: any) => a.state === 'no').length
      const noReply = askedArr.filter((a: any) => a.state === 'waiting').length
      const whenTxt = [c.shift_date, span12(c.shift_time)].filter(Boolean).join(' ') || 'time on the case'
      await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: {
        id: `ops_covesc_${c.id}`, kind: 'coverage', coverage_case_id: c.id,
        title: `CALLOUT EXHAUSTED: ${c.client || 'shift'} ${whenTxt} still uncovered`,
        about: c.client || '',
        detail: `${autoAsked.length} caregivers asked: ${declined} declined, ${noReply} never answered, nobody said yes. A person needs to work this now: call people, split the shift, or tell the client.`,
        domain: 'scheduling_coverage', status: 'open', urgency: 'high',
        owner: own2, owner_name: own2.split('@')[0],
        created_at: nowIso(), due: new Date(Date.now() + 3600000).toISOString(),
        created_by: 'coverage-run', opened_by: 'callout-escalation',
      } })
      /* The SMS to the duty holder. Phone comes from coordinator_staff. */
      let smsSent = false
      const chiHr = Number(new Date().toLocaleString('en-US',
        { timeZone: 'America/Chicago', hour: '2-digit', hour12: false }))
      /* office quiet hours (2026-10-03): never 8pm to 7am Central, even for a shift starting soon; the URGENT item above
         is where it waits */
      const smsAllowed = !officeQuiet(new Date(), settings) && (shiftSoon || (chiHr >= 8 && chiHr < 21))
      if (smsAllowed && ghl.token && ghl.locationId) {
        try {
          const { data: stRow } = await sb.from('app_data').select('data').eq('key', 'coordinator_staff').maybeSingle()
          const staff: any[] = Array.isArray(stRow?.data) ? stRow!.data : []
          const person = staff.find((s: any) => String(s.email || '').toLowerCase() === own2.toLowerCase())
          const phone = normalisePhone(person?.phone)
          if (phone) {
            const contact = await contactForOutbound(sb, ghl,
              { phone, firstName: person?.name || own2.split('@')[0] }, 'urgent_internal', { selfSupplied: true, audience: 'staff' })
            if (contact) {
              /* CI2: the owner's own call-in link when they are on the call-in list (the page only opens for that list);
                 otherwise the board's address, as before */
              const onListR = (await adminRecipients(sb, settings)).some((a) => a.email === own2.toLowerCase())
              const linkR = onListR ? await callinLink(String(c.id), own2.toLowerCase(), c.shift_date) : ''
              const msg = withLink(linkTemplate(String(settings.coverage_msg_escalation || '') ||
                `Coverage alert: the callout for {client} {when} ran out of caregivers to ask ({asked} asked, nobody said yes). It needs a person now: {link}`), linkR)
                .replaceAll('{client}', String(c.client || 'a client'))
                .replaceAll('{when}', whenTxt)
                .replaceAll('{asked}', String(autoAsked.length))
              smsSent = await ghlSendChecked(sb, { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
                'staff-alert', { channel: 'sms', contactId: contact.contactId, address: phone, who: person?.name || own2 }, { message: msg })
              if (smsSent && onListR) await rememberAlerted(sb, String(c.id), [own2.toLowerCase()])
            }
          }
        } catch (e) { /* the item is the guarantee; the SMS is the accelerant */
          await reportSendProblem(sb, { sender: 'staff-alert', channel: 'sms', address: '', who: own2,
            reasons: ['could not send: ' + String((e as Error)?.message ?? e).slice(0, 80)], failed: true })
        }
      }
      const fresh = await readCaseFresh(c.id)
      if (fresh) {
        fresh.callout_escalated_at = nowIso()
        fresh.callout_escalation_sms = smsSent
        await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: fresh })
        c.callout_escalated_at = fresh.callout_escalated_at
      }
      stats.escalated = (Number(stats.escalated) || 0) + 1
    }

    const itemId = `ops_cov_${c.id}`
    detail.push({
      case_id: c.id,
      client: c.client ?? '(not identified, AxisCare)',
      client_resolution: clientRes.status === 'resolved'
        ? clientRes.detail
        : `${clientRes.status}: ${clientRes.detail}; waves fall back to tier 2/3 ranking`,
      history_error: historyError,
      recent_activity_error: recent.error,
      axiscare_census: censusUsable
        ? `${axisActive.size} active caregivers; ${inactiveSkipped} roster candidate(s) skipped as not active in AxisCare`
        : `census unavailable (${censusError || 'empty'}). ALL WAVES HELD this run (${censusHeld} candidate(s) held), nothing sends on roster data alone`,
      /* Who has already been texted on this case but is NOT in the active
         census now — the exact question the 2026-09-16 incident asked. */
      asked_no_longer_active: censusUsable
        ? (c.asked ?? []).filter((a: any) => a?.axiscare_id && !axisActive.has(String(a.axiscare_id)))
            .map((a: any) => a.name)
        : 'unknown, census unavailable',
      /* And who was texted despite being nurse-classed or nurse-listed —
         the Natasha Early question, permanently answerable. */
      asked_nurse_flagged: (c.asked ?? []).filter((a: any) =>
          (a?.axiscare_id && nurseAxis.has(String(a.axiscare_id)))
          || nurseNamesGlobal.has(nameKeyOf(String(a?.name ?? ''))))
        .map((a: any) => a.name),
      busy_check: `${busyCheck}; ${busySkipped} skipped from this wave as already working`,
      dnr_check: `${dnrBarred.size} caregiver(s) barred from this client by the Do-Not-Return log; ${dnrSkipped} removed from this wave`,
      nurse_check: `${nurseAxis.size} nurse-classed in AxisCare; ${nurseSkipped} additionally skipped from this wave (nurse-roster names are excluded before candidacy)`,
      care_level: clientLv != null
        ? `client is Level ${clientLv} (class "${c.client_care_level_from || '?'}"); ${underLevelSkipped} caregiver(s) skipped as below level; ${caregiverLevel.size} caregivers carry a level class`
        : 'no care-level class found on this client, level filter off for this case',
      reason: c.reason,
      opened: c.opened_at,
      owner_now: c.owner ?? '(none)',
      owner_should_be: own.owner ?? '(none)',
      why_owner: own.why,
      already_asked: (c.asked ?? []).length,
      candidates_considered: cands.length,
      eligible_to_message: sendable.length,
      /* Ranked: worked-with-this-client first, then recently active, then the
         rest — each with the reason, so a human can argue with the order. */
      this_wave: wave.map((w: any) => ({ name: w.name, tier: w.tier, why: w.tier_why })),
      next_in_line: sendable.filter((x: any) => !wave.includes(x))
        .slice(0, WAVE_SIZE * 2).map((w: any) => ({ name: w.name, tier: w.tier, why: w.tier_why })),
      blocked: cands.filter(x => x.skipped).slice(0, 8)
        .map((x: any) => ({ name: x.name, skipped: x.skipped, phone_last4: x.phone_last4 })),
      prompt: haveItem.has(itemId) ? 'exists' : 'would create',
    })

    if (commit) {
      if (!c.owner && own.owner) { c.owner = own.owner; stats.owner_set++ }
      const item = {
        id: itemId, kind: 'coverage', coverage_case_id: c.id,
        title: `Uncovered shift: ${c.client || 'client not identified'}`,
        about: c.client || '', detail: c.note || '',
        domain: 'scheduling_coverage', owner: own.owner || '',
        status: 'open', urgency: 'high',
        already_asked: (c.asked ?? []).length,
        points_at: 'coverage_case', updated_at: nowIso(),
        created_at: c.opened_at || nowIso(),
      }
      /* Phase 3 (2026-10-05): this card is rewritten every run. Keep what PEOPLE (and routing) did to it: who owns it,
         who took it, its history, and any escalation. Before this, Take it on an Uncovered shift card was undone within
         3 minutes. */
      const prevItem = items.find((x: any) => String(x?.id) === itemId)
      if (prevItem) for (const k of ['owner', 'owner_name', 'owner_history', 'claimed_by', 'claimed_by_name', 'claimed_at', 'started_at',
        'history', 'routed', 'escalation', 'sub_state', 'waiting_on', 'check_back', 'help_from', 'help_asked_at', 'domain_set_by',
        'also_for', 'talk_also_for'])   /* 2026-10-18: a person tagged on the card keeps it in their My Work */
        if (prevItem[k] !== undefined && prevItem[k] !== null && prevItem[k] !== '') (item as any)[k] = prevItem[k]
      await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item })
      if (!haveItem.has(itemId)) stats.prompts_created++
    }
  }

  if (commit && stats.owner_set) {
    /* Per-item writes only: a whole-array write from this run's stale
       snapshot deleted concurrently-created cases (review finding 2). */
    for (const c of open) {
      if (!c.owner) continue
      const fresh = await readCaseFresh(c.id)
      if (fresh && !fresh.owner) { fresh.owner = c.owner
        await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: fresh }) }
    }
  }

  /* ── CLOSURE TEXTS: when a case closes, everyone still waiting hears so.
     "First YES wins" only feels fair if the others aren't left hanging.
     Daytime only (8-21 Chicago) — nobody needs "it's covered" at 3am. ── */
  if (sendLive && ghl.token && ghl.locationId) {
    const chiHour = Number(new Date().toLocaleString('en-US',
      { timeZone: 'America/Chicago', hour: '2-digit', hour12: false }))
    if (chiHour >= 8 && chiHour < 21) {
      for (const cStale of cases) {
        if (cStale?.status === 'open' || cStale?.closure_notified) continue
        /* Interest checks close by a coordinator talking to people, not by
           "the shift was covered" texts — closure messaging is for callouts. */
        if (String(cStale?.kind) === 'interest') continue
        const c = await readCaseFresh(cStale.id) ?? cStale
        if (c?.status === 'open' || c?.closure_notified) continue
        /* 2026-10-24: "Canceled Shift" is nobody. A case closed as covered by the placeholder was cancelled: no "you're
           confirmed", no "covered" courtesy texts and no family text (April Davidson's family was told "Canceled" was coming). */
        if (c.resolved_how === 'covered' && isPlaceholderCaregiver(String(c.covered_by || ''))) {
          c.closure_notified = nowIso(); c.closure_courtesy_count = 0; c.closure_skip_reason = 'Closed on the Canceled Shift placeholder: cancelled, no texts.'
          if (!c.family_notified) { c.family_notified = nowIso(); c.family_notified_count = 0; c.family_no_recipients = true; c.family_skip_reason = 'cancelled (Canceled Shift placeholder)' }
          await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: c })
          continue
        }
        const askedList = Array.isArray(c.asked) ? c.asked : []
        /* The winner hears they're confirmed (CareQB's "Assign to Shift"
           message). They said yes to a shift; silence after that reads as
           "did I get it or not?". Full client name is right here — they are
           assigned now and need to know who they're going to. */
        if (c.resolved_how === 'covered' && c.covered_by) {
          const winner = askedList.find((a: any) => (a.auto === true || a.picked_by_coordinator === true)
            && a.state === 'yes'
            && !a.confirm_sent && !a.confirm_optout && String(a.name).toLowerCase() === String(c.covered_by).toLowerCase()
            && a.ghl_contact_id)
          if (winner) {
            const whenTxt = [friendlyDay(c.shift_date), span12(c.shift_time)].filter(Boolean).join(' ')
            try {
              /* 0b-3: the saved contact goes through the universal opt-out door first. An opt-out is recorded on the
                 ask (confirm_optout) so the next run does not ask again; the office confirms by phone anyway. */
              const cid = await ghlStoredContactIfAllowed(sb, ghl, 'coverage-run (confirmed text)',
                { channel: 'sms', contactId: winner.ghl_contact_id, onOptOut: () => { winner.confirm_optout = true } })
              if (!cid) {
                if (winner.confirm_optout) await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: c })
                throw new Error('not sent')
              }
              const went = await ghlSendChecked(sb, { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
                'coverage-run (confirmed text)', { channel: 'sms', contactId: cid, address: winner.phone, who: winner.name }, {
                  message: (String(settings.coverage_msg_confirmed || '') ||
                    `You're confirmed for {client}, {when}. It's on your schedule. Thank you, {first_name}!`)
                    .replaceAll('{first_name}', String(winner.name).split(' ')[0])
                    .replaceAll('{client}', String(c.client || 'the client'))
                    .replaceAll('{when}', whenTxt || 'as scheduled')
                    .replace(/\s{2,}/g, ' ').trim() })
              if (went) { winner.confirm_sent = true
                /* Persist NOW: if the courtesy texts below all fail, the next
                   run must not re-send "You're confirmed" (review finding 9). */
                await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: c })
              }
            } catch { /* the office confirmed by phone anyway; never block closure */ }
          }
        }
        /* ── THE FAMILY HEARS IT FROM US ─────────────────────────────────
           A covered case means somebody new is walking into the client's
           home. The daughter should learn that from Caring Companions, not
           from a stranger at the door. Texts go ONLY to circle members who
           have explicit texting consent (sms_consent) and want caregiver-
           change updates (wants_changes) — the sync never sets consent, a
           person did. Same 8-21 window as every other closure text; sent
           once per case (family_notified). Wording editable in Settings
           (circle_msg_caregiver_change); {meet} becomes a meet-the-caregiver
           link when an intro card exists for the covering caregiver. */
        if (c.resolved_how === 'covered' && c.covered_by && !c.family_notified) {
          try {
            /* Change 6a (2026-09-27): the circle is the one tied to this case's
               AxisCare client id (never a first-name match), members who replied
               STOP or are no longer on the client's AxisCare contacts are left
               out, and the text goes through the shared gate as audience
               'family' under Samantha's recorded exception approval. */
            const fam = await notifyFamilyOfChange(sb, ghl, c, settings,
              { whenText: [friendlyDay(c.shift_date), span12(c.shift_time)].filter(Boolean).join(' ') })
            if (fam.outcome === 'none') {
              c.family_notified = nowIso()
              c.family_notified_count = 0
              c.family_no_recipients = true
              c.family_skip_reason = fam.reason
              await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: c })
            } else if (fam.outcome === 'sent') {
              c.family_notified = nowIso()
              c.family_notified_count = fam.count
              c.family_circle = fam.circle
              await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: c })
            }
          } catch { /* family notify must never block closure */ }
        }

        const eligibleAsk = (a: any) => (a.auto === true || a.picked_by_coordinator === true) && a.ghl_contact_id
        const waiting = askedList.filter((a: any) => eligibleAsk(a) && a.state === 'waiting')
        /* COLLECT-ALL-YESES (her rule, 2026-09-19: "we want to pick the best
           option out of all the yeses"): everyone who said yes was promised
           a text either way, so the ones not chosen hear it warmly — never
           via silence. On an uncovered close they get the neutral release
           text like everyone else. */
        let yesLosers = askedList.filter((a: any) => eligibleAsk(a) && a.state === 'yes'
          && !a.confirm_sent
          && String(a.name).toLowerCase() !== String(c.covered_by || '').toLowerCase())
        /* The coordinator chose SILENCE for the not-chosen yeses at pick
           time (covResolve dialog): mark them closed without a text so the
           case still reaches quiescence, and send them nothing. */
        if (c.not_chosen_silent === true && yesLosers.length) {
          for (const a of yesLosers) { a.was_yes = true; a.state = 'closed_silent' }
          await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: c })
          yesLosers = []
        }
        /* closure_notified is the STAGE-COMPLETION record for the whole
           closure pass — the scan gate at the top of this loop. It may only
           be stamped once the family stage is resolved for a covered case
           (sent, or complete-with-nobody-eligible above); stamping past a
           transiently failed family send would silence the retry forever.
           closure_courtesy_count carries how many courtesy texts actually
           went; 0 with closure_no_recipients means "complete because nobody
           was left waiting to tell" — true for a manually-confirmed case
           with no automated asks, which must become quiescent, not rescanned
           and shown as pending forever. */
        const familyResolved = c.resolved_how !== 'covered' || !!c.family_notified
        if (!waiting.length && !yesLosers.length) {
          if (familyResolved) {
            c.closure_notified = nowIso()
            c.closure_courtesy_count = Number(c.closure_courtesy_count || 0)
            if (!c.closure_courtesy_count) c.closure_no_recipients = true
            await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: c })
          }
          continue
        }
        /* Say what actually happened: "covered" only when it was. Telling
           an asked caregiver a shift is covered when the case closed
           UNCOVERED would be a fabrication — the release text for other
           closures stays neutral. */
        const courtesyMsg = c.resolved_how === 'covered'
          ? (String(settings.coverage_msg_covered || '') ||
             `Caring Companions: that shift is covered now. Thank you! No action needed.`)
          : (String(settings.coverage_msg_closed || '') ||
             `Caring Companions: no action needed on that earlier shift request any more. Thank you!`)
        /* A yes that wasn't chosen deserves warmth, not the generic notice.
           The coordinator's own wording from the pick dialog wins; then the
           agency template; then the built-in default. */
        const notChosenMsg = (String(c.not_chosen_msg || '')
          || String(settings.coverage_msg_not_chosen || '') ||
          `Caring Companions: that shift got covered this time. Thank you so much for offering, {first_name}! Next one is yours.`)
        let told = 0, optedOut = 0
        const closureSends = [
          ...waiting.map((a: any) => ({ a, msg: courtesyMsg })),
          ...yesLosers.map((a: any) => ({ a,
            msg: c.resolved_how === 'covered'
              ? notChosenMsg.replaceAll('{first_name}', String(a.name || '').split(' ')[0])
              : courtesyMsg })),
        ]
        for (const { a, msg } of closureSends) {
          try {
            /* 0b-3: through the universal opt-out door. Someone who opted out is closed SILENTLY (the state the
               coordinator's "say nothing" choice already uses, which Reopen restores), so the case still finishes
               instead of asking again every run. */
            let stop = false
            const cid = await ghlStoredContactIfAllowed(sb, ghl, 'coverage-run (closure text)',
              { channel: 'sms', contactId: a.ghl_contact_id, onOptOut: () => { stop = true } })
            if (!cid) {
              if (stop) { if (a.state === 'yes') a.was_yes = true; a.state = 'closed_silent'; a.optout_skipped = true; optedOut++ }
            } else {
              if (await ghlSendChecked(sb, { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
                'coverage-run (closure text)', { channel: 'sms', contactId: cid, address: a.phone, who: a.name }, { message: msg })) { if (a.state === 'yes') a.was_yes = true; a.state = 'closed_notified'; told++ }
            }
            /* Case over: drop the tag so future texts stop firing the
               reply workflow (and stop costing premium executions). */
            await fetch(`https://services.leadconnectorhq.com/contacts/${a.ghl_contact_id}/tags`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28',
                         'Content-Type': 'application/json' },
              body: JSON.stringify({ tags: ['coverage-asked'] }),
            }).catch(() => {})
          } catch { /* one failed courtesy text must not block the rest */ }
        }
        /* Delivered texts and their closed_notified states must persist even
           when the completion stamp is deferred (family stage still owed),
           or the next tick would text the same people again. */
        if (told || optedOut) {
          c.closure_courtesy_count = Number(c.closure_courtesy_count || 0) + told
          if (optedOut) c.closure_optout_skipped = Number(c.closure_optout_skipped || 0) + optedOut
          stats.closure_notified += told
          if (familyResolved || c.family_notified) c.closure_notified = nowIso()
          await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: c })
        }
      }
    }
  }

  /* ── CARA PHASE 2 PART A: every running or paused "Let Cara run it" moves forward, each under its own lease (a second run
     at the same moment, or an office tap, can't act on the same case twice). Runs on closed cases are finished here too. */
  if (caller === 'cron' || commit) {
    try {
      const { data: runs } = await sb.from('cara_run').select('case_id').in('status', LIVE_STATES)
      stats.cara_runs = {} as Record<string, number>
      for (const r of runs ?? []) {
        let did = 'error'
        try { did = await caraAdvance(String(r.case_id), settings) } catch (e) { console.error('[coverage-run] cara run failed', r.case_id, e) }
        stats.cara_runs[did] = (stats.cara_runs[did] || 0) + 1
      }
    } catch (e) { console.error('[coverage-run] cara runs read failed', e) }
  }

  await releaseRunLock()

  /* Heartbeat for the watchdog (automation-watchdog EXPECTED): one row,
     replaced on every completed run, written at the END so an exception
     anywhere above leaves the beat stale and the watchdog notices. The
     richer automation_log row is written only when the tick actually acted:
     at heartbeat cadence an every-tick log row would grow the shared
     app_data array without bound. */
  try {
    await sb.rpc('upsert_app_data_item', { target_key: 'automation_heartbeats', item: {
      id: 'hb_coverage-run', automation: 'coverage-run', at: nowIso(), ok: true,
      note: `open:${open.length} sent:${stats.sent} escalated:${stats.escalated} closure:${stats.closure_notified}`
        + (open.length ? (censusUsable ? ` census:${axisActive.size}` : ' census:DOWN-HELD') : ''),
    } })
    if (commit && (stats.sent || stats.escalated || stats.closure_notified || stats.prompts_created)) {
      await sb.rpc('upsert_app_data_item', { target_key: 'automation_log', item: {
        id: 'auto_srv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        at: nowIso(), automation: 'coverage-run', ran_by: 'server', ok: true, dry: false,
        rows_seen: open.length, candidates: stats.would_ask, created: stats.sent,
      } })
    }
  } catch { /* logging must never block the run */ }

  return new Response(JSON.stringify({
    mode: commit ? 'COMMIT' : 'DRY RUN (cases/items only; sending has its own switch)',
    sending_enabled: sendLive,
    manual_select: manualSelect,
    sending_note: manualSelect
      ? 'MANUAL SELECTION: Cara flags and ranks; nothing is texted until a coordinator picks recipients on the board and presses send.'
      : sendLive
      ? `LIVE: waves of ${WAVE_SIZE} by tier, ${fuseMin}-min fuse, quiet hours hold overnight sends unless the shift starts within 3h. Replies land via coverage-reply.`
      : 'Sending is off. Flip ops_settings.coverage_send_live to true to let waves text caregivers.',
    coverage_owner: own,
    wave_size: WAVE_SIZE,
    gate_evaluated_independently: gate,
    stats, detail,
    /* AxisCare access is BACK (2026-08-13), so this list shrank: worked-with-
       this-client ranking and recent-activity now come from real visit
       history above. What still needs AxisCare work (or a build): */
    blocked_or_unbuilt: [
      'caregiver availability and schedule conflicts (schedules readable, not wired in yet)',
      'overtime risk',
      'service area and client requirements',
      'writing the accepted assignment back to the schedule (API supports it, deliberately manual for now)',
      'family notification driven by the real schedule change',
      'ongoing/recurring open shifts offered as ONE package instead of shift-by-shift',
    ],
  }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } })
})
