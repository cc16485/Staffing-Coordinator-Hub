// =============================================================================
// PRN STEP 3 · FAMILIAR CLIENTS (Samantha 2026-10-28, plan section 4: "each PRN member gradually builds two to four clients
// they know, so last-minute coverage is usually a familiar face")
// =============================================================================
// A client is familiar for a PRN member when, worked out by the Hub and never typed in:
//   1. they cared for that client in the last 6 months (AxisCare visits), and
//   2. nobody raised a concern either way: not on the client's Do Not Return list, no concern on a Care Match check-in,
//      and the member didn't answer NO to "Would you be glad to go back?"
// It becomes "glad to go back" when they answered YES, and gets a star when the client favorited them.
//
// THE GO-BACK TEXT (her wording, approved 2026-10-28): after a PRN member's first shift with a client, carematch-watch sends
// this instead of the usual first-shift text (switch ops_settings.prn_goback_live). A clear YES or NO is read by
// coverage-reply; anything else goes on the This Week list for the office to mark.
//
// NO PRN BACKUP (her pick 2026-10-28: 3+ call-offs in 30 days): a client with 3 or more call-off cases in 30 days and no
// PRN member who knows them shows on the This Week list. "Plan an intro visit" opens their profile; a person decides,
// gets the family's OK and schedules it in AxisCare as normal paid time. The Hub never schedules or texts anyone for it.
// Only decisions here (no reads or writes), so every rule is tested.
// =============================================================================
// deno-lint-ignore no-explicit-any
type Any = any
const S = (v: unknown, n = 200) => String(v ?? '').trim().slice(0, n)
const DAY = 86_400_000
export const nameKey = (s: unknown) => S(s, 120).toLowerCase().replace(/[^a-z]/g, '')
export const FAMILIAR_DAYS = 180, CALLOFF_DAYS = 30, CALLOFF_MIN = 3, ANSWER_DAYS = 3

export const GOBACK_DEFAULT = 'Good morning, {first_name}! Thank you for being with {client} {when}. Would you be glad to go back to {client} another time? Just reply YES or NO. Either answer is perfectly fine.'
const dayWord = (day: string, today: string) => {
  const n = Math.round((Date.parse(today + 'T12:00:00Z') - Date.parse(S(day, 10) + 'T12:00:00Z')) / DAY)
  if (n === 0) return 'today'
  if (n === 1) return 'yesterday'
  return 'on ' + new Date(S(day, 10) + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
}
export function goBackText(tmpl: string | null | undefined, first: string, client: string, day: string, today: string): string {
  return (S(tmpl, 700) || GOBACK_DEFAULT).replaceAll('{first_name}', S(first, 40) || 'there').replaceAll('{client}', S(client, 40) || 'your client')
    .replaceAll('{when}', /^\d{4}-\d\d-\d\d$/.test(S(day, 10)) ? dayWord(day, today) : 'recently').replace(/\s{2,}/g, ' ').trim()
}

/** A clear answer to the go-back question, or null (the office reads it). Short replies only: a sentence with "yes" in it
    could be about anything. */
export function readGoBack(text: unknown): 'yes' | 'no' | null {
  const t = S(text, 200).toLowerCase().replace(/[!.,]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!t || t.length > 40) return null
  if (/^(yes|yes ma'?am|yeah|yep|yup|y|sure|absolutely|definitely|of course|i would|i'd love to|gladly|yes please|yes i would)( [^\s]+)?$/.test(t) && !/\b(no|not|but)\b/.test(t)) return 'yes'
  if (/^(no|nope|n|no thank you|no thanks|not really|i'd rather not|rather not)( [^\s]+)?$/.test(t)) return 'no'
  return null
}

export type Familiar = { client: string; client_ax: string | null; town: string; visits: number; last: string; glad: boolean; star: boolean }
/** visits: this member's AxisCare visits (any window; only the last 6 months count). dnr: dnr_log rows. checkins:
    client_checkins rows. answers: this member's prn_touches go-back rows (goback_yes / goback_no, ref 'client:<key>'). */
export function familiarClients(x: { name: string; visits: Any[]; dnr: Any[]; checkins: Any[]; answers: Any[]; towns?: Record<string, string>; today: string }): Familiar[] {
  const me = nameKey(x.name), since = new Date(Date.parse(x.today + 'T12:00:00Z') - FAMILIAR_DAYS * DAY).toISOString().slice(0, 10)
  const by = new Map<string, Familiar>()
  for (const v of x.visits || []) {
    const day = S(v?.date ?? v?.scheduledStartDate ?? v?.startDate, 10)
    if (!/^\d{4}-\d\d-\d\d$/.test(day) || day < since || day > x.today) continue
    const client = [S(v?.client?.firstName, 40), S(v?.client?.lastName, 40)].filter(Boolean).join(' ')
    const k = nameKey(client); if (!k) continue
    const cur = by.get(k) || { client, client_ax: v?.client?.id != null ? String(v.client.id) : null, town: '', visits: 0, last: '', glad: false, star: false }
    cur.visits++; if (day > cur.last) cur.last = day
    by.set(k, cur)
  }
  const out: Familiar[] = []
  for (const [k, f] of by) {
    if ((x.dnr || []).some((e) => nameKey(e?.client) === k && nameKey(e?.caregiver) === me)) continue
    const mine = (x.checkins || []).filter((e) => e && e.skip !== true && nameKey(e.client) === k && nameKey(e.caregiver) === me)
    if (mine.some((e) => e.rating === 'concern' || e.cg_rating === 'concern')) continue
    const said = (x.answers || []).filter((a) => a?.ref === 'client:' + k && (a.kind === 'goback_yes' || a.kind === 'goback_no')).sort((a, b) => S(a.at).localeCompare(S(b.at))).pop()
    if (said?.kind === 'goback_no') continue
    f.glad = said?.kind === 'goback_yes'
    f.star = mine.some((e) => e.want_favorite === true)
    f.town = S(x.towns?.[k], 40)
    out.push(f)
  }
  return out.sort((a, b) => Number(b.star) - Number(a.star) || Number(b.glad) - Number(a.glad) || b.last.localeCompare(a.last))
}

/** Clients with CALLOFF_MIN+ call-off cases in the last CALLOFF_DAYS whom no PRN member knows. cases: coverage_cases. */
export function noBackup(cases: Any[], familiarByMember: Familiar[][], today: string): { client: string; key: string; client_ax: string | null; calloffs: number }[] {
  const since = new Date(Date.parse(today + 'T12:00:00Z') - CALLOFF_DAYS * DAY).toISOString().slice(0, 10)
  const known = new Set(familiarByMember.flat().map((f) => nameKey(f.client)))
  const count = new Map<string, { client: string; client_ax: string | null; calloffs: number }>()
  for (const c of cases || []) {
    const day = S(c?.shift_date, 10) || S(c?.opened_at ?? c?.created_at, 10)
    if (!/^\d{4}-\d\d-\d\d$/.test(day) || day < since || day > today) continue
    if (c?.status === 'cancelled' || c?.not_a_callin === true) continue
    const k = nameKey(c?.client); if (!k) continue
    const cur = count.get(k) || { client: S(c.client, 80), client_ax: S(c?.axiscare_client_id ?? c?.client_ax, 20) || null, calloffs: 0 }
    cur.calloffs++; count.set(k, cur)
  }
  return [...count].filter(([k, v]) => v.calloffs >= CALLOFF_MIN && !known.has(k)).map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.calloffs - a.calloffs || a.client.localeCompare(b.client))
}

/** Go-back questions waiting on the office: an answer the Hub couldn't read. asked/unclear/settled are prn_touches rows. */
export function unclearAnswers(touches: Any[]): Any[] {
  const settled = new Set(touches.filter((t) => ['goback_yes', 'goback_no', 'not_this_one'].includes(t?.kind)).map((t) => t.applicant_id + '|' + t.ref))
  return touches.filter((t) => t?.kind === 'goback_unclear' && !settled.has(t.applicant_id + '|' + t.ref))
}
/** The newest go-back question to this member still waiting on an answer, asked in the last ANSWER_DAYS. */
export function waitingQuestion(touches: Any[], now: Date): Any | null {
  const done = new Set(touches.filter((t) => ['goback_yes', 'goback_no', 'goback_unclear'].includes(t?.kind)).map((t) => t.ref))
  const since = new Date(now.getTime() - ANSWER_DAYS * DAY).toISOString()
  return touches.filter((t) => t?.kind === 'goback_asked' && !done.has(t.ref) && S(t.at, 40) >= since).sort((a, b) => S(b.at).localeCompare(S(a.at)))[0] || null
}

/** The This Week lines step 3 adds. members: { applicant_id, name, first, team } (team label already worded). */
/** clientMarks: app_data prn_client_marks rows { id: 'nobackup:<key>:<month>', kind: 'intro_planned' | 'not_this_one' } (a
    client line belongs to no PRN member, so it isn't kept in prn_touches). A mark lasts for the month it was made in. */
export function weekLines(x: { members: Any[]; touches: Any[]; nobackup: ReturnType<typeof noBackup>; clientMarks: Any[]; today: string }): Any[] {
  const out: Any[] = []
  for (const t of unclearAnswers(x.touches)) {
    const m = x.members.find((mm) => mm.applicant_id === t.applicant_id); if (!m) continue
    const asked = x.touches.find((a) => a.kind === 'goback_asked' && a.applicant_id === t.applicant_id && a.ref === t.ref)
    const client = S(asked?.message, 700).match(/glad to go back to (.+?) another time/)?.[1] || 'their client'
    out.push({ id: `goback:${m.applicant_id}:${t.ref}`, kind: 'goback', applicant_id: m.applicant_id, name: m.name, team: m.team, ref: t.ref, client,
      title: `Would ${m.first || m.name} be glad to go back to ${client}?`, detail: `They answered: "${S(t.note, 300)}"`, answer: S(t.note, 300) })
  }
  const done = new Set((x.clientMarks || []).map((t) => S(t?.id, 160)))
  for (const c of x.nobackup) {
    const ref = `nobackup:${c.key}:${x.today.slice(0, 7)}`; if (done.has(ref)) continue
    out.push({ id: ref, kind: 'nobackup', applicant_id: '', name: c.client, team: '', ref, client: c.client, client_ax: c.client_ax,
      title: `${c.client} has no PRN backup who knows them yet`, detail: `${c.calloffs} call-offs in 30 days. An intro visit could help, only with the family's OK.` })
  }
  return out
}
