// =============================================================================
// applicant-status.ts · WHERE ONE PERSON IS, FROM APPLICATION TO APPROVED TO WORK (Samantha 2026-10-11: "When viewing a real
// applicant, I want our Care Coordinators and Recruiting & Orientation staff to be able to see: which steps have been
// completed; which step the applicant is currently on; what information they've submitted; which forms are signed or still
// outstanding; any missing information or required follow-up; what happens next and who is responsible").
// =============================================================================
// Read only: built from records the Hub already keeps (the application, the interview booking, the offer, Step 1, the
// references). From Background & References on, the stages, the blockers and the next step come from the readiness card
// itself (the page asks caregiver-journey, exactly as the Readiness button does), so the two can never disagree. Nothing is typed here and nothing is written. The twelve stages are the ones the
// Applicants Journey walkthrough shows. A stage is "done" only on a record that says so; a blank is never done.
// deno-lint-ignore-file no-explicit-any
type Any = any
const S = (v: unknown, n = 160) => String(v ?? '').trim().slice(0, n)
export const STAGES = ['Application', 'Prescreening', 'Interview booking', 'Interview', 'Offer', 'Offer signature', 'Step 1', 'Background & References', 'Step 2 in Viventium', 'Orientation', 'Training', 'Approved to Work'] as const
/* readiness-card stage → walkthrough stage (the page uses it on the readiness card's own rail) */
export const JOURNEY_STAGE: Record<string, number> = { screening: 7, approval: 7, step2: 8, orientation: 9, training: 10, ready: 11, active: 11 }
export const STEP1_FORMS: [string, string][] = [['employee_application', 'Employee Application'], ['reference_consent', 'Reference Check and Authorization Consent'], ['fcra_disclosure', 'Background Check Disclosure'],
  ['edl_fcsr_consent', 'EDL and FCSR Screening Consent'], ['availability', 'Availability and Scheduling Commitment'], ['experience', 'Experience and Client Matching Profile'], ['vehicle', 'Personal Vehicle Insurance Responsibility']]
const day = (iso: unknown) => { const t = Date.parse(String(iso || '')); return Number.isFinite(t) ? new Date(t).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '' }

export type StatusIn = { app?: Any; bookings?: Any[]; offer?: Any; step1?: Any; cand?: Any; rec?: Any; journey?: Any; refs?: Any[]; experience?: Any; owner?: { name?: string } | null }
export function applicantStatus(x: StatusIn): Any {
  const st = STAGES.map((label) => ({ label, state: 'todo' as string, at: null as string | null, note: '' }))
  const done = (i: number, at?: unknown, note = '') => { st[i].state = 'done'; st[i].at = at ? String(at) : null; if (note) st[i].note = note }
  const missing: string[] = []; let next: Any = null; let ended: string | null = null
  const app = x.app || null, o = x.offer || null, f = x.step1 || null, bookings = (x.bookings || []).slice().sort((a: Any, z: Any) => String(z.starts_at).localeCompare(String(a.starts_at)))
  const newPath = o ? o.onboarding_path === 'new' : true
  /* 1 to 4: before the offer */
  if (app) done(0, app.created_at)
  const b = bookings.find((k: Any) => k.status !== 'cancelled') || null
  if (app && (app.screen_grade || b || o)) done(1, null, app.screen_grade ? 'Screening: ' + S(app.screen_grade, 40) : '')
  if (b || o) done(2, b?.created_at || null, b ? (b.status === 'booked' ? 'Booked for ' + day(b.starts_at) : '') : '')
  if ((b && b.status === 'done') || app?.post_interview || o) done(3, b?.status === 'done' ? b.starts_at : null)
  if (b && b.status === 'noshow') { st[3].note = 'Did not come to the interview'; }
  if (app && ['pool', 'declined'].includes(String(app.status)) && !o) ended = app.status === 'pool' ? 'In the candidate pool (no offer now)' : 'Not moving forward'
  /* 5 and 6: the offer */
  if (o?.offer_sent_at || o?.created_at) done(4, o.offer_sent_at || o.created_at)
  if (o && (o.offer_withdrawn_at || o.offer_declined_at || ['withdrawn', 'declined', 'expired'].includes(String(o.offer_status)))) ended = o.offer_declined_at || o.offer_status === 'declined' ? 'They declined the offer' : o.offer_status === 'expired' ? 'The offer expired unsigned' : 'The offer was withdrawn'
  if (o?.offer_signed_at && o?.pd_signed_at) done(5, o.pd_signed_at)
  else if (o?.offer_signed_at) st[5].note = 'Offer letter signed; the position description is not yet'
  /* 7: Step 1, form by form */
  const sigs = (f?.signatures || {}) as Record<string, Any>
  const forms = STEP1_FORMS.map(([k, t]) => ({ key: k, title: t, signed_at: sigs[k]?.at || null }))
  const outstanding = forms.filter((k) => !k.signed_at)
  if (!newPath && !f) { st[6].state = 'na'; st[6].note = 'Old process: the start link and Viventium Group 1' }
  else if (f?.completed_at) done(6, f.completed_at)
  else if (o?.offer_signed_at && o?.pd_signed_at) st[6].note = forms.length - outstanding.length + ' of 7 forms signed' + (f?.started_at ? '' : '; not opened yet')
  /* 8 to 12: the readiness card answers these (the page fills them); here only what the records say outright */
  const readiness = !!x.journey
  if (!readiness && x.cand) st[7].note = 'In Background & References'
  if (x.rec?.approved_to_work_at) done(11, x.rec.approved_to_work_at)
  /* the current stage: the first one not done (or the end) */
  const cur = ended ? -1 : st.findIndex((s) => s.state === 'todo')
  if (cur >= 0) st[cur].state = 'current'
  /* what is missing, and what happens next (before the readiness card takes over) */
  if (outstanding.length && o?.offer_signed_at && o?.pd_signed_at && !f?.completed_at && newPath) missing.push('Step 1 forms not signed yet: ' + outstanding.map((k) => k.title).join(', '))
  const refs = x.refs || [], asked = refs.length, answered = refs.filter((r: Any) => r.responded_at).length
  if (x.cand) { const slots = [1, 2, 3, 4].filter((n) => S(x.cand[`r${n}n`])).length; if (slots < 4) missing.push(`Background & References has ${slots} of 4 references`); if (asked && answered < asked) missing.push(`${asked - answered} of ${asked} reference${asked === 1 ? '' : 's'} not answered yet`) }
  const ex = x.experience
  if (ex?.counts) { const n = (ex.counts.self_reported || 0) + (ex.counts.supported || 0) + (ex.counts.questioned || 0); if (n) missing.push(`${n} task${n === 1 ? '' : 's'} from their experience not verified yet (does not count until a reference who saw it confirms)`) }
  const R = (title: string, owner: string, why = '') => ({ title, owner, why })
  const ownerName = x.owner?.name ? x.owner.name + ' (Recruiting & Orientation)' : 'Recruiting & Orientation'
  if (ended) next = R(ended, 'nobody: closed', '')
  else if (cur === 0) next = R('They finish the application', 'the applicant', 'Friendly follow-ups go by themselves')
  else if (cur === 1) next = R('They answer the screening questions', 'the applicant', '')
  else if (cur === 2) next = R('They book an interview', 'the applicant', 'Follow-ups to book go by themselves')
  else if (cur === 3) next = b?.status === 'booked' ? R('The interview, ' + day(b.starts_at), 'the interviewer', 'Reminders go by themselves') : b?.status === 'noshow' ? R('Rebook or close: they missed the interview', 'the office') : R('Interview them', 'the office')
  else if (cur === 4) next = R('Decide: offer, candidate pool or not hiring', 'the office', 'After the interview')
  else if (cur === 5) next = R('They sign the offer letter and the position description', 'the applicant', o?.offer_expires_at ? 'Open until ' + day(o.offer_expires_at) + '; reminders on day 2 and day 5' : '')
  else if (cur === 6) next = R('They finish Step 1 (' + (7 - outstanding.length) + ' of 7 signed)', 'the applicant', 'Reminders on day 2 and day 4')
  else if (cur >= 7 && !readiness) next = R('Start the background checks and references', ownerName, 'Step 1 is complete: their signed permission is in')
  else if (cur >= 7) next = { from_readiness: true }   /* the readiness card's own next step (title, owner, why), filled by the page */
  else next = R('Nothing left: Approved to Work', 'nobody')
  return { readiness, journey_id: x.journey?.journey_id || null, stages: st, current: cur >= 0 ? STAGES[cur] : ended || 'Approved to Work', ended, path: o ? (newPath ? 'new' : 'old') : null, step1: f || (o && newPath) ? { forms, sent_at: o?.step1_sent_at || null, started_at: f?.started_at || null, completed_at: f?.completed_at || null } : null,
    submitted: { application_at: app?.created_at || null, position: app?.position || o?.position || null, screen_grade: app?.screen_grade || null, interview_answers: !!app?.post_interview, step1_answers: !!(f && Object.keys(f.answers || {}).length), references_listed: x.cand ? [1, 2, 3, 4].filter((n) => S(x.cand[`r${n}n`])).length : 0 },
    missing, next }
}
