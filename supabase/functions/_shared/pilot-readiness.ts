// =============================================================================
// pilot-readiness: is each ACTIVE client ready for the family app? Samantha 2026-10-16: "Yes, build the pilot check".
// Pure rules (Node-testable). The one-time reader (functions/pilot-readiness) gathers the facts read-only; this decides.
// Ready = what a family needs to sign in and book, and what caregivers need to be offered it:
//   * Missouri residential address in AxisCare (the app's services and rate come from the state)
//   * someone who can sign in: an email on the Hub Family Circle (AxisCare's responsible parties arrive there overnight)
//     or the client's own email in AxisCare
//   * an hourly rate for the estimate (the client's own from recent visits, else the Missouri rate in the Hub)
//   * the office's "About" box for caregivers
//   * caregivers who know them and can get the offer text (a mobile on the Hub roster)
// =============================================================================
export type Facts = {
  ax: string; name: string; state: string | null; clientEmail: string | null
  rpEmails: string[]            // AxisCare responsible parties with an email
  circleEmails: string[]        // Hub Family Circle people with an email (not stopped / removed / revoked)
  appOn: number                 // Family Circle people whose app is on
  rate: number | null; rateFrom: 'client' | 'state' | null
  about: boolean
  recentCaregivers: number      // different caregivers on their visits in the last 60 days
  reachable: number             // of those, with a mobile on the Hub roster (can get the offer text)
}
export type Verdict = { ready: boolean; missing: string[]; notes: string[] }
const uniq = (a: string[]) => [...new Set(a.map((x) => x.trim().toLowerCase()).filter(Boolean))]
export function verdict(f: Facts): Verdict {
  const missing: string[] = [], notes: string[] = []
  if (f.state !== 'MO') missing.push(f.state ? `address is in ${f.state}, not Missouri` : 'no state on the AxisCare residential address')
  const canSign = uniq([...f.circleEmails, ...(f.clientEmail ? [f.clientEmail] : [])])
  const rpOnly = uniq(f.rpEmails).filter((e) => !canSign.includes(e))
  if (!canSign.length) missing.push(rpOnly.length ? 'family email is on AxisCare but not in the Hub yet (arrives overnight, or add them to the Family Circle)' : 'no family email (add one to a responsible party in AxisCare or to the Family Circle)')
  else if (rpOnly.length) notes.push(`${rpOnly.length} more family email${rpOnly.length > 1 ? 's' : ''} arrive from AxisCare overnight`)
  if (f.rate == null) missing.push('no hourly rate (none on recent visits and no Missouri rate in the Hub)')
  else notes.push(`estimate $${f.rate}/hr`)
  if (!f.about) missing.push('no About box for caregivers (Family Circle in the Hub)')
  if (!f.recentCaregivers) notes.push('no caregiver visits in the last 60 days, so offers go to the wider team')
  else if (f.reachable < f.recentCaregivers) notes.push(`${f.recentCaregivers - f.reachable} of their ${f.recentCaregivers} recent caregivers have no mobile in the Hub (they won't get offers)`)
  if (f.appOn) notes.push(`app already on for ${f.appOn} family member${f.appOn > 1 ? 's' : ''}`)
  return { ready: !missing.length, missing, notes }
}
export function report(rows: Facts[]): string {
  const v = rows.map((f) => ({ f, v: verdict(f) }))
  const ready = v.filter((x) => x.v.ready).sort((a, b) => a.f.name.localeCompare(b.f.name))
  const not = v.filter((x) => !x.v.ready).sort((a, b) => a.v.missing.length - b.v.missing.length || a.f.name.localeCompare(b.f.name))
  const line = (x: { f: Facts; v: Verdict }) => [`  ${x.v.ready ? '✓' : '·'} ${x.f.name} (AxisCare #${x.f.ax})`,
    ...x.v.missing.map((m) => `      ✗ ${m}`), ...x.v.notes.map((n) => `      · ${n}`)].join('\n')
  return [`READY FOR THE APP: ${ready.length} of ${rows.length} active clients`, ...ready.map(line), '',
    `NOT READY YET (fewest gaps first): ${not.length}`, ...not.map(line)].join('\n')
}
