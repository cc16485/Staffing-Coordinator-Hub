// =============================================================================
// ff-invite-rules · WHO WOULD GET A FRIENDS & FAMILY INVITATION (Friends & Family Referral Program, step 3, 2026-10-27).
// Pure: no clock, no database, no network. ff-invite-check reads AxisCare and the Hub and asks this file.
//
// HER RULES (2026-10-26 and 2026-10-27):
//   · caregivers: 30 days after they became Active in AxisCare, at least one completed shift (clocked in and out), and
//     still active today. Text and email (no text when their application said no to texts).
//   · clients and their families: 30 days after the client's first completed visit, the client still active, and the
//     payer private pay or long-term care insurance (LTC is invited; its reward is reviewed separately). Medicaid, VA,
//     GUIDE and CDS clients are never invited. No payer on file = "Payer needed", nobody invited. Families get EMAIL only
//     until there is marketing text consent.
//   · no invitation while the client has an open complaint or service concern (her definition, approved 2026-10-27):
//       - an open client issue (anything but "General question, not an issue"), open = not Resolved and not
//         "Closed, no action needed"
//       - an open red or yellow shift-note flag
//       - an open "Client issue" card made by hand in the Hub (a check-in reminder is not one)
//       - one of the six serious kinds resolved in the last 30 days
//   · opt-outs and stops always win.
// The run only LISTS. Nothing here sends anything, and the switch (ops_settings.ff_invites_live) starts off.
// No em dashes in any words a person reads.
// =============================================================================
// deno-lint-ignore-file no-explicit-any
export const WAIT_DAYS = 30
/** AxisCare went live mid-August 2026: no completed visit can be older than this */
export const VISITS_FROM = '2026-08-01'
export const SERIOUS = ['suspected_abuse', 'safety_concern', 'fall_injury_hospital', 'medication_concern', 'family_complaint', 'missed_incomplete_care']
export const NOT_A_CONCERN = ['general_question']
export const CLOSED_STATES = ['resolved', 'closed_no_action']
export const INVITED_PAYERS = ['private', 'ltc']
export const PAYER_WORDS: Record<string, string> = { private: 'Private pay', ltc: 'Long-term care insurance', medicaid: 'Medicaid', va: 'VA', guide: 'GUIDE', cds: 'CDS' }
export const FLAG_LEVELS: Record<string, string> = { red: 'Red', yellow: 'Yellow' }

const S = (v: unknown) => String(v ?? '').trim()
const lc = (v: unknown) => S(v).toLowerCase()
export const nameKey = (v: unknown) => lc(v).replace(/[^a-z]/g, '')
const ymdOk = (v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(S(v).slice(0, 10)) && !Number.isNaN(Date.parse(S(v).slice(0, 10) + 'T12:00:00Z'))
/** a date or a timestamp -> YYYY-MM-DD in Central time ('' when not a date) */
export function dayOf(v: unknown): string {
  const s = S(v)
  if (!s) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return ymdOk(s) ? s : ''
  const t = Date.parse(s)
  if (Number.isNaN(t)) return ''
  return new Date(t).toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
}
export function addDays(ymd: string, n: number): string {
  const d = new Date(Date.parse(ymd + 'T12:00:00Z') + n * 864e5)
  return d.toISOString().slice(0, 10)
}
/** "Oct 5" */
export function words(ymd: string): string {
  if (!ymdOk(ymd)) return ''
  return new Date(Date.parse(ymd + 'T12:00:00Z')).toLocaleString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })
}
const clockAt = (c: any) => { const t = Date.parse(S(c?.time ?? c)); return Number.isNaN(t) ? null : t }
/** clocked in and out, the out after the in, not removed */
export function completed(v: any): boolean {
  if (!v || v.removed) return false
  const a = clockAt(v.clockIn), b = clockAt(v.clockOut)
  return a != null && b != null && b > a
}

/* ── payer ──────────────────────────────────────────────────────────────────────────────────────────────────────────
   AxisCare has no payer field. Its classes mix care level and payer ("Level 1 - Wellness Care" beside "Private Pay"),
   so a class counts only when its label MEANS a payer, and exactly one payer must come out (none or two = unknown). */
export function payerFromClasses(classes: any): string | null {
  const list = Array.isArray(classes) ? classes : classes && typeof classes === 'object' ? Object.values(classes) : []
  const found = new Set<string>()
  for (const c of list) {
    const t = lc(typeof c === 'string' ? c : `${c?.label ?? ''} ${c?.code ?? ''}`)
    if (/private\s*pay/.test(t)) found.add('private')
    else if (/long[\s-]*term\s*care|\bltc\b/.test(t)) found.add('ltc')
    else if (/medicaid|\bihs\b|\badw\b|consumer[\s-]*directed|\bcds\b/.test(t)) found.add('medicaid')
    else if (/\bva\b|veteran/.test(t)) found.add('va')
    else if (/\bguide\b/.test(t)) found.add('guide')
  }
  return found.size === 1 ? [...found][0] : null
}
/** the inquiry's answer (lead.funding_source) and AxisCare's class, which must agree when both are there */
export function payerOf(leadFunding: unknown, classes: any): { payer: string | null; why?: string } {
  const fromLead = PAYER_WORDS[lc(leadFunding)] ? lc(leadFunding) : null
  const fromAx = payerFromClasses(classes)
  if (fromLead && fromAx && fromLead !== fromAx) return { payer: null, why: `the inquiry says ${PAYER_WORDS[fromLead]} but AxisCare says ${PAYER_WORDS[fromAx]}` }
  const p = fromLead || fromAx
  return p ? { payer: p } : { payer: null, why: 'no payer on the inquiry or in AxisCare' }
}

/* ── open complaints and service concerns, per client ──────────────────────────────────────────────────────────────── */
export type Concerns = { byAx: Map<string, string[]>; byName: Map<string, string[]> }
export function concernsOf(issues: any[], items: any[], labels: Record<string, string>, today: string): Concerns {
  const byAx = new Map<string, string[]>(), byName = new Map<string, string[]>()
  const add = (ax: unknown, name: unknown, why: string) => {
    const a = S(ax), n = nameKey(name)
    if (a) byAx.set(a, [...(byAx.get(a) ?? []), why])
    else if (n) byName.set(n, [...(byName.get(n) ?? []), why])
  }
  const since = addDays(today, -WAIT_DAYS)
  for (const i of issues || []) {
    if (!i) continue
    const cat = S(i.category), label = labels[cat] || 'Client issue'
    if (NOT_A_CONCERN.includes(cat)) continue
    if (!CLOSED_STATES.includes(S(i.state))) {
      const on = dayOf(i.reported_at ?? i.created_at)
      add(i.axiscare_client_id, i.client_name_free_text, `Open client issue: ${label}${on ? ` (since ${words(on)})` : ''}`)
      continue
    }
    if (S(i.state) !== 'resolved' || !SERIOUS.includes(cat)) continue
    const done = dayOf(i.resolved_at)
    if (!done || done < since) continue
    add(i.axiscare_client_id, i.client_name_free_text, `${label}, resolved ${words(done)}: waits until ${words(addDays(done, WAIT_DAYS))}`)
  }
  for (const it of items || []) {
    if (!it || it.status === 'done' || it.status === 'closed') continue
    if (it.kind === 'care_note' && FLAG_LEVELS[S(it.level)]) {
      const on = dayOf(it.created_at)
      add(it.client_ax, it.about, `Open ${FLAG_LEVELS[S(it.level)].toLowerCase()} shift-note flag${on ? ` (${words(on)})` : ''}`)
    } else if (it.kind === 'client_issue' && !it.issue_id && S(it?.source?.type) !== 'client_checkin') {
      /* a "Client issue" card made by hand (the table's own issues come in above; their cards carry issue_id) */
      add(it.client_ax, it.about, `Open client issue card: ${S(it.title).slice(0, 80) || 'Client issue'}`)
    }
  }
  return { byAx, byName }
}
export function concernsFor(c: Concerns, ax: string, names: string[]): string[] {
  const out = [...(c.byAx.get(S(ax)) ?? [])]
  for (const n of names) for (const w of c.byName.get(nameKey(n)) ?? []) if (!out.includes(w)) out.push(w)
  return out
}

/* ── caregivers ─────────────────────────────────────────────────────────────────────────────────────────────────────── */
export type Row = { kind: 'caregiver' | 'family' | 'client'; key: string; name: string; client?: string; client_ax?: string; /** grouping only, never kept */ mail?: string;
  status: 'ready' | 'waiting' | 'held'; why: string[]; channels: string[]; ready_on?: string; payer?: string; note?: string }

/** the day they became Active: the latest of AxisCare's hire date and the last time we saw them come back to active;
 *  without either, the Hub's Approve to Work date */
export function activeSince(cg: { hire_date?: unknown }, reactivatedAt: unknown, approvedAt: unknown): string {
  const a = dayOf(cg?.hire_date), b = dayOf(reactivatedAt)
  const best = [a, b].filter(Boolean).sort().pop() || ''
  return best || dayOf(approvedAt)
}
/** one active caregiver */
export function caregiverRow(cg: any, f: { since: string; worked: boolean | null; textOk: boolean; textOut: boolean; emailOut: boolean; today: string }): Row {
  const name = [S(cg.goes_by) || S(cg.first), S(cg.last)].filter(Boolean).join(' ') || `AxisCare caregiver #${cg.id}`
  const why: string[] = []
  let status: Row['status'] = 'ready', ready_on = ''
  const channels: string[] = []
  if (S(cg.phone) && f.textOk && !f.textOut) channels.push('text')
  if (S(cg.email) && !f.emailOut) channels.push('email')
  if (!f.since) { status = 'held'; why.push('No Active date in AxisCare (no hire date)') }
  else {
    ready_on = addDays(f.since, WAIT_DAYS)
    if (f.today < ready_on) { status = 'waiting'; why.push(`Active since ${words(f.since)}: 30 days on ${words(ready_on)}`) }
  }
  if (f.worked === null) { status = 'held'; why.push("Couldn't read their shifts in AxisCare") }
  else if (!f.worked) { if (status === 'ready') status = 'waiting'; why.push('No completed shift yet') }
  if (!S(cg.phone) && !S(cg.email)) { status = 'held'; why.push('No phone or email in AxisCare') }
  else if (!channels.length) {
    status = 'held'
    why.push([S(cg.phone) ? (f.textOut ? 'opted out of texts' : !f.textOk ? 'said no to texts on their application' : '') : 'no phone',
      S(cg.email) ? (f.emailOut ? 'opted out of email' : '') : 'no email'].filter(Boolean).join(', ').replace(/^./, (x) => x.toUpperCase()))
  } else {
    if (S(cg.phone) && !channels.includes('text')) why.push(f.textOut ? 'Email only: opted out of texts' : 'Email only: said no to texts on their application')
    if (S(cg.email) && f.emailOut) why.push('Text only: opted out of email')
  }
  return { kind: 'caregiver', key: 'cg_' + S(cg.id), name, status, why, channels, ...(ready_on ? { ready_on } : {}) }
}

/* ── a client and their family ───────────────────────────────────────────────────────────────────────────────────────
   The client decides: payer, 30 days after the first completed visit, no open concern. Each family member then needs an
   email, permission (HIPAA on file, or they are the client), and no opt-out, stop or past/deceased tie. */
export function clientFacts(f: { firstVisit: string; payer: { payer: string | null; why?: string }; concerns: string[]; today: string }):
  { status: Row['status'] | 'not_invited'; why: string[]; ready_on?: string; note?: string } {
  if (f.payer.payer && !INVITED_PAYERS.includes(f.payer.payer)) return { status: 'not_invited', why: [PAYER_WORDS[f.payer.payer]] }
  const why: string[] = []
  let status: Row['status'] = 'ready', ready_on = ''
  if (!f.payer.payer) { status = 'held'; why.push('Payer needed: ' + (f.payer.why || 'no payer on file')) }
  if (!f.firstVisit) { if (status === 'ready') status = 'waiting'; why.push('No completed visit yet') }
  else {
    ready_on = addDays(f.firstVisit, WAIT_DAYS)
    if (f.today < ready_on) { if (status === 'ready') status = 'waiting'; why.push(`First visit ${words(f.firstVisit)}: 30 days on ${words(ready_on)}`) }
  }
  if (f.concerns.length) { status = 'held'; why.push(...f.concerns) }
  return { status, why, ...(ready_on ? { ready_on } : {}), ...(f.payer.payer === 'ltc' ? { note: 'Long-term care insurance: the reward is reviewed separately' } : {}) }
}
export function familyRow(p: any, client: { name: string; ax: string; status: Row['status']; why: string[]; ready_on?: string; payer?: string; note?: string },
  f: { emailOut: boolean; tie: string | null }): Row {
  const isClient = lc(p.relationship) === 'client'
  const why = [...client.why]
  let status = client.status
  const hold = (w: string) => { status = 'held'; why.push(w) }
  if (!(isClient || p.hipaa_authorized === true || (p.hipaa_authorized !== false && !!p.hipaa_office_ok_at))) hold('No HIPAA permission on file')
  if (f.emailOut) hold('Opted out of email')
  if (f.tie) hold('Email is ' + f.tie)
  return { kind: 'family', key: 'fam_' + S(p.id), mail: lc(p.email), name: S(p.name) || 'Family member', client: client.name, client_ax: client.ax, status, why,
    channels: status === 'held' ? [] : ['email'], ...(client.ready_on ? { ready_on: client.ready_on } : {}), ...(client.payer ? { payer: client.payer } : {}), ...(client.note ? { note: client.note } : {}) }
}
/** one invitation per email address: when the same address is on two clients (or two people share it), the strictest
 *  answer wins. The address itself is dropped: the kept list holds names and reasons, never an email or a phone number. */
export function mergeFamily(rows: Row[]): Row[] {
  const rank = { ready: 0, waiting: 1, held: 2 } as const
  const out = new Map<string, Row>()
  for (const r of rows) {
    const k = r.mail || r.key, have = out.get(k)
    if (!have) { out.set(k, r); continue }
    const worse = rank[r.status] > rank[have.status] ? r : have, other = worse === r ? have : r
    const clients = [...new Set([have.client, r.client].filter(Boolean))]
    out.set(k, { ...worse, client: clients.join(' and '), why: [...worse.why, ...other.why.filter((w) => !worse.why.includes(w))] })
  }
  return [...out.values()].map(({ mail: _m, ...r }) => r)
}
export function summary(rows: Row[], notInvited: Record<string, number>) {
  const by = (k: Row['kind']) => ({ ready: rows.filter((r) => r.kind === k && r.status === 'ready').length,
    waiting: rows.filter((r) => r.kind === k && r.status === 'waiting').length, held: rows.filter((r) => r.kind === k && r.status === 'held').length })
  return { caregivers: by('caregiver'), families: by('family'), clients_without_family_email: rows.filter((r) => r.kind === 'client').length, not_invited_by_payer: notInvited }
}
