// =============================================================================
// shift-ask-gate — may the office text this caregiver about shifts? (step 3 of the scheduling review, 2026-10-12)
// =============================================================================
// Cara's picker (coverage-run) has always refused these people; Team Builder's "Text" (team-ask) did not. Same rules,
// same matching, now in one place for any sender that texts ONE named caregiver about shifts:
//   - not active (the roster says inactive, or AxisCare says not active). 2026-10-14, HER RULE: "axiscare is the truth for
//     if a caregiver is active or not, we should never have the option to send an open shift to someone who is not active
//     in axiscare": AxisCare is asked LIVE for this caregiver every time; no AxisCare number, or AxisCare can't be read =
//     nobody is texted (fail closed), and the reason says so.
//   - on the No shift texts list (coverage_do_not_offer; AxisCare id, phone, then name; an `until` date ends it)
//   - Do Not Return for this client (dnr_log, by name, like Cara)
//   - a new hire whose readiness card isn't complete (work-lock: Approved to Work + AxisCare active). FAIL CLOSED:
//     if the cards can't be read, nobody is texted and the reason says so.
//   - the shift needs transportation (needsTransport) and they are not an Approved Driver with a current license and
//     insurance (Driver Compliance, 2026-10-13; transportEligible in _shared/driver-eligibility.ts, the one shared rule).
//     Non-Driver, Pending Verification, Suspended and no driver record yet are all refused. Other shifts are unaffected.
//   - In Training in AxisCare (2026-10-22, her rule: In Training is onboarding, never offered shifts), once
//     ops_settings.in_training_lock_live is on (_shared/in-training.ts, the one rule).
// Returns null (may text) or the reason, in words the office reads.
// =============================================================================
import { normalisePhone } from './outreach.ts'
import { workLock, LOCK_WHY } from './work-lock.ts'
import { transportEligible } from './driver-eligibility.ts'
import { readCaregiverStatus } from './axiscare-caregiver.ts'
import { isInTraining, inTrainingLive, IN_TRAINING_WHY } from './in-training.ts'

// deno-lint-ignore no-explicit-any
type Any = any
export const nameKeyOf = (n: unknown) => String(n ?? '').toLowerCase().replace(/[^a-z ]/g, '').split(/\s+/).filter(Boolean).join(' ')
const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '')
const chiToday = () => new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)

/** The pure part, for tests: the lists already read. */
export function blockReason(x: { cg: Any; name: string; axId: string; client: string; dno: Any[]; dnr: Any[]; locked: Set<string> | null; lockWhy?: string; needsTransport?: boolean; today?: string }): string | null {
  const name = x.name || [x.cg?.first, x.cg?.last].filter(Boolean).join(' ')
  const ax = digits(x.axId || x.cg?.axiscare_id)
  if (x.cg && (x.cg.active === false || x.cg.axiscare_status_active === false)) return `${name} is not an active caregiver in AxisCare`
  const today = chiToday(), ph = normalisePhone(x.cg?.phone), nk = nameKeyOf(name)
  for (const d of x.dno || []) {
    const until = String(d?.until || '').trim()
    if (/^\d{4}-\d\d-\d\d$/.test(until) && until < today) continue
    if ((ax && digits(d?.axiscare_id) === ax) || (ph && normalisePhone(d?.phone) === ph) || (d?.name && nameKeyOf(d.name) === nk))
      return `${name} is on the No shift texts list${until ? ' until ' + until : ''}${d?.reason ? ' (' + String(d.reason).slice(0, 80) + ')' : ''}`
  }
  const ck = nameKeyOf(x.client)
  if (ck && (x.dnr || []).some((e) => e?.caregiver && e?.client && nameKeyOf(e.client) === ck && nameKeyOf(e.caregiver) === nk))
    return `${name} is on ${String(x.client).trim().split(/\s+/)[0]}'s Do Not Return list`
  if (x.needsTransport) { const t = transportEligible(x.cg, x.today || today); if (!t.ok) return `${name} is not cleared to drive clients, and this shift needs transportation (${t.why})` }
  if (x.locked === null) return `the new-hire readiness check couldn't be read (${x.lockWhy || 'unknown'}), so nobody is texted until it can`
  if (ax && x.locked.has(ax)) return `${name} is ${LOCK_WHY}`
  return null
}

/** Reads the lists and answers for one caregiver. */
export async function shiftAskBlock(sb: Any, x: { cg: Any; name: string; axId: string; client: string; roster?: Any[]; needsTransport?: boolean; readStatus?: (id: string) => Promise<{ ok: true; active: boolean; label: string } | { ok: false; detail: string }> }): Promise<string | null> {
  const read = async (k: string) => { const { data } = await sb.from('app_data').select('data').eq('key', k).maybeSingle(); return Array.isArray(data?.data) ? data.data : [] }
  const name = x.name || [x.cg?.first, x.cg?.last].filter(Boolean).join(' ') || 'This caregiver'
  const ax = digits(x.axId || x.cg?.axiscare_id)
  if (!ax) return `${name} has no AxisCare number, so we can't confirm they are active in AxisCare`
  const live = await (x.readStatus ?? readCaregiverStatus)(ax)
  if (!live.ok) return `AxisCare couldn't be checked for ${name} (${live.detail}), so nobody is texted until it can`
  if (!live.active) return `${name} is not active in AxisCare${live.label ? ' (' + live.label + ')' : ''}`
  if (isInTraining(live.label) && await inTrainingLive(sb)) return `${name} is ${IN_TRAINING_WHY}`
  const [dno, dnr] = await Promise.all([read('coverage_do_not_offer'), read('dnr_log')])
  const lock = await workLock(sb, x.roster ?? null)
  return blockReason({ ...x, dno, dnr, locked: lock.ok ? lock.axis : null, lockWhy: lock.ok ? undefined : lock.why })
}
