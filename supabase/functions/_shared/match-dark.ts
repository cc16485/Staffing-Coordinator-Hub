// =============================================================================
// match-dark.ts · THE DARK REPORT, as a pure function (Samantha "go", 2026-10-12, Track 3d)
// =============================================================================
// Given everything the job read (AxisCare visits, caregivers and clients; the roster, skills record, Step 1 pictures,
// availability, Do Not Return, the client fact record, the readiness lock, the call-off history), it runs the shared rule
// (match-rules.js, CCMatch) and the eligibility rules (CCElig) and returns the report. It reads nothing and writes nothing:
// the job does both, and writes only the report. Her safe defaults, all built in:
//   • anything unknown never counts in someone's favour (no driver record yet = not for a visit that needs driving, Driver
//     Compliance 2026-10-13, the roster fields the mirror keeps; a Do Not Return name
//     that does not match the roster exactly is listed, never assumed clear; no Journey = incomplete)
//   • free-text restrictions are shown as said, never enforced (there are no structured ones yet)
//   • the replay judges the past with today's records, and says so
// deno-lint-ignore-file no-explicit-any
type Any = any
const S = (v: unknown, n = 120) => String(v ?? '').trim().slice(0, n)
const norm = (v: unknown) => S(v, 200).toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()
const rowsOf = (v: Any): Any[] => Array.isArray(v) ? v : (v && typeof v === 'object') ? Object.values(v) : []
const ORDER = ['not_for_visit', 'one_more_step', 'likely_fit', 'ready']
const STAND = ['self_reported', 'questioned', 'supported', 'corroborated', 'demonstrated']
const WIN: Record<string, [number, number]> = { morning: [5, 12], afternoon: [12, 17], evening: [17, 22], overnight: [22, 29] }
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

export type DarkIn = { now: string; M: Any; E: Any; levelOf: (classes: Any) => number | null; payerOf: (classes: Any) => string | null
  visits: Any[]; axCaregivers: Any[]; axClients: Any[]; roster: Any[]; overlay: Any[]; availability: Any[]; dnr: Any[]
  factsByClient: Record<string, Any[] | null>; step1ByAx: Record<string, Any>; lock: Any; cases: Any[]; previous?: Any; fingerprints?: Record<string, string>; driveGate?: boolean }

/** the best evidence wins between the skills record and Step 1 (never a downgrade, never an upgrade) */
function mergeSkills(a: Record<string, Any>, b: Record<string, Any>) {
  const out: Record<string, Any> = { ...a }
  for (const [k, v] of Object.entries(b || {})) { const w = out[k]; if (!w || STAND.indexOf(v.standing) > STAND.indexOf(w.standing)) out[k] = { ...v, refresher: !!(v.refresher || w?.refresher) }; else if (v.refresher) out[k] = { ...w, refresher: true } }
  return out
}
const centralDay = (iso: string) => new Date(iso).toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
function slotOf(t: string) { const h = Number(t.slice(0, 2)); if (!Number.isFinite(h)) return null; for (const [k, [a, z]] of Object.entries(WIN)) if ((h >= a && h < z) || (h + 24 >= a && h + 24 < z)) return k; return null }

/** The people and clients as the match rule sees them (cgOf, clientOf), shared by the dark report and Cara's call-off
    list (_shared/cara-skills.ts, 2026-10-23). Only the inputs those two need: M, E, levelOf, payerOf, axCaregivers, axClients,
    roster, overlay, availability, dnr, factsByClient, step1ByAx, lock. */
export type PeopleIn = Pick<DarkIn, 'M' | 'E' | 'levelOf' | 'payerOf' | 'axCaregivers' | 'axClients' | 'roster' | 'overlay' | 'availability' | 'dnr' | 'factsByClient' | 'step1ByAx' | 'lock'>
export function makePeople(x: PeopleIn) {
  const M = x.M, gaps = { dnr_unmatched: [] as string[], covered_by_unmatched: 0, no_journey_clients: [] as string[], no_availability: 0, drive_unknown: 0, restrictions_said: [] as string[], needs_verification: 0, lock_unreadable: !x.lock?.ok }
  /* the people, by AxisCare id */
  const axCg = new Map(x.axCaregivers.filter((g: Any) => g?.id != null).map((g: Any) => [String(g.id), g]))
  const roster = new Map(x.roster.filter((r: Any) => r?.axiscare_id).map((r: Any) => [String(r.axiscare_id).replace(/\D/g, ''), r]))
  const overlay = new Map(x.overlay.filter((o: Any) => o?.axiscare_id).map((o: Any) => [String(o.axiscare_id), o]))
  const avail = new Map(x.availability.filter((a: Any) => a?.axiscare_id).map((a: Any) => [String(a.axiscare_id), a]))
  const byName = new Map<string, string>(); for (const [id, g] of axCg) byName.set(norm(`${g.firstName ?? ''} ${g.lastName ?? ''}`), id)
  const idOfName = (n: unknown) => byName.get(norm(n)) || null
  const cgCache = new Map<string, Any>()
  const cgOf = (id: string): Any => {
    if (cgCache.has(id)) return cgCache.get(id)
    const g = axCg.get(id) || {}, r = roster.get(id) || null, o = overlay.get(id) || null, of = M.overlayFacts(o)
    const el = r ? x.E.eligibility(r) : null
    let cleared = !!(el && ['eligible', 'needs_verification'].includes(el.state)), why = el ? (el.summary || el.label) : 'no roster record in the Hub'
    const warnings: string[] = []
    if (el?.state === 'needs_verification') { gaps.needs_verification++; warnings.push('Eligibility: the training record needs historical verification') }
    if (!x.lock?.ok) { cleared = false; why = 'the readiness lock could not be read' }
    else if (x.lock.axis?.has?.(id)) { cleared = false; why = 'awaiting Approve to Work' }
    const said = S(o?.exclusions_said, 200); if (said && !gaps.restrictions_said.includes(id)) gaps.restrictions_said.push(id)
    const c = { name: `${S(g.firstName, 40)} ${S(g.lastName, 40)}`.trim() || (r ? `${S(r.first, 40)} ${S(r.last, 40)}`.trim() : id), axiscare_id: id, cleared, cleared_reason: why,
      level: x.levelOf(g.classes) || 1, training: { dementia: !!r?.alz_date }, gender: M.axisGender(g.gender),
      /* Driver Compliance (2026-10-13): the roster's driver fields, read by the rule's transportEligible (match-rules 1.2.0) */
      dl_status: r?.dl_status ?? null, cleared_to_drive: typeof r?.cleared_to_drive === 'boolean' ? r.cleared_to_drive : null, dl_expires: r?.dl_expires ?? null, auto_ins_expires: r?.auto_ins_expires ?? null,
      skills: mergeSkills(M.fromOverlay(o), M.fromStep1(x.step1ByAx[id])), willing: of.willing, spanish: of.spanish, restrictions: [], said, warnings }
    cgCache.set(id, c); return c
  }
  /* the clients */
  const axCl = new Map(x.axClients.filter((c: Any) => c?.id != null).map((c: Any) => [String(c.id), c]))
  const clCache = new Map<string, Any>()
  const clientOf = (id: string): Any => {
    if (clCache.has(id)) return clCache.get(id)
    const c = axCl.get(id) || {}, rows = x.factsByClient[id]
    if (rows == null && !gaps.no_journey_clients.includes(id)) gaps.no_journey_clients.push(id)
    const ff = M.fromFacts(rows || [])
    const name = `${S(c.firstName, 40)} ${S(c.lastName, 40)}`.trim() || id
    const dnrNames = x.dnr.filter((d: Any) => S(d?.axiscare_client_id) === id || (!d?.axiscare_client_id && norm(d?.client) === norm(name))).map((d: Any) => S(d.caregiver, 80))
    const dnrIds: string[] = []; for (const n of dnrNames) { const k = idOfName(n); if (k) dnrIds.push(k); else if (!gaps.dnr_unmatched.includes(n + ' (for ' + name + ')')) gaps.dnr_unmatched.push(n + ' (for ' + name + ')') }
    const out = { name, id, payer: x.payerOf(c.classes), level: x.levelOf(c.classes) || 1, plan_current: true, needs: ff.needs, facts: ff.facts, lift_type: ff.lift_type, advanced_tasks: ff.advanced_tasks, dnr_axiscare_ids: dnrIds, journey: rows != null }
    clCache.set(id, out); return out
  }
  return { M, gaps, cgOf, clientOf, idOfName, axCg, avail, clCache }
}

export function buildDarkReport(x: DarkIn): Any {
  const { M, gaps, cgOf, clientOf, idOfName, avail, clCache } = makePeople(x)
  /* each caregiver's visits, for "actually free" */
  const day = (v: Any) => S(v?.scheduledStartDate ?? v?.startDate, 30)
  const end = (v: Any) => S(v?.scheduledEndDate ?? v?.endDate, 30)
  const live = x.visits.filter((v: Any) => v && !v.removed && v.client?.id != null)
  const byCg = new Map<string, Any[]>(); for (const v of live) if (v.caregiver?.id != null) { const k = String(v.caregiver.id); if (!byCg.has(k)) byCg.set(k, []); byCg.get(k)!.push(v) }
  const freeFor = (cgId: string, v: Any) => {
    const s = day(v), e = end(v); const overlap = (byCg.get(cgId) || []).find((w: Any) => w !== v && day(w) < e && end(w) > s)
    if (overlap) return { free: false, reason: 'Overlaps another visit ' + day(overlap).slice(11, 16) + ' to ' + end(overlap).slice(11, 16) }
    /* Samantha 2026-10-12: "we need to assume 24 hour availability if they have not put it in" */
    const a = avail.get(cgId); if (!a?.windows) { gaps.no_availability++; return { free: true, reason: '', note: 'No availability on file: assumed available any time' } }
    const d = DAYS[new Date(s.slice(0, 10) + 'T12:00:00Z').getUTCDay()], slot = slotOf(s.slice(11, 16))
    if (slot && Array.isArray(a.windows[d]) && !a.windows[d].includes(slot)) return { free: false, reason: 'Outside the availability they gave us (' + d + ' ' + slot + ')' }
    return { free: true, reason: '' }
  }
  /* 1. the next 14 days, visit by visit */
  const rows: Any[] = []; let open = 0
  for (const v of live) {
    if (v.caregiver?.id == null) { open++; continue }
    const cgId = String(v.caregiver.id), cl = clientOf(String(v.client.id)), base = cgOf(cgId)
    const fr = freeFor(cgId, v), cg = { ...base, availability: { free: fr.free, reason: fr.reason } }
    const r = M.evaluate(cl, cg, { today: centralDay(x.now), driveGate: x.driveGate === true })
    if (cl.needs?.transportation?.value === 'required' && !S(base.dl_status)) gaps.drive_unknown++   // needs driving, caregiver has no driver record yet
    const warnings = [...r.warnings, ...base.warnings, ...(fr.note ? [fr.note] : [])]
    rows.push({ date: day(v).slice(0, 10), time: day(v).slice(11, 16) + (end(v) ? ' to ' + end(v).slice(11, 16) : ''), visit_id: v.id ?? null, client: cl.name, client_id: cl.id, caregiver: base.name, caregiver_id: cgId,
      group: r.group, reason: r.reason, steps: r.steps.map((s2: Any) => s2.why), warnings, said: base.said || null })
  }
  rows.sort((a, z) => ORDER.indexOf(a.group) - ORDER.indexOf(z.group) || a.date.localeCompare(z.date) || a.time.localeCompare(z.time))
  const counts: Record<string, number> = { visits: rows.length, open_visits: open }; for (const g of ORDER) counts[g] = rows.filter((r) => r.group === g).length
  const clientsSeen = [...clCache.values()], cstate = clientsSeen.map((c) => M.clientState(c).status)
  const clients = { total: clientsSeen.length, ok: cstate.filter((s2) => s2 === 'ok').length, incomplete: cstate.filter((s2) => s2 === 'incomplete').length, flagged: cstate.filter((s2) => s2 === 'flagged').length, not_matched: cstate.filter((s2) => s2 === 'not_matched').length, no_journey: gaps.no_journey_clients.length,
    flagged_list: clientsSeen.filter((c) => M.clientState(c).status === 'flagged').map((c) => ({ client: c.name, why: M.clientState(c).message })) }
  /* 2. the replay: the last 60 days of call-offs, judged with today's records */
  const since = new Date(Date.parse(x.now) - 60 * 86_400_000).toISOString()
  const replay: Any[] = []
  for (const k of x.cases || []) {
    if (!k || S(k.opened_at) < since || !k.client_axiscare_id) continue
    const cl = clientOf(String(k.client_axiscare_id))
    const coverId = S(k.axiscare_assignment?.caregiver_id) || (k.covered_by ? idOfName(k.covered_by) : null)
    if (k.covered_by && !coverId) gaps.covered_by_unmatched++
    const asked = rowsOf(k.asked).filter((a: Any) => a?.axiscare_id)
    const judge = (id: string) => M.evaluate(cl, { ...cgOf(id), availability: { free: true } }, { today: centralDay(x.now), driveGate: x.driveGate === true })
    const cov = coverId ? judge(coverId) : null
    const askedRows = asked.map((a: Any) => ({ name: S(a.name, 80), group: judge(String(a.axiscare_id)).group }))
    replay.push({ date: S(k.shift_date, 10), client: cl.name, covered_by: k.covered_by ? S(k.covered_by, 80) : null, covered_group: cov?.group || null, covered_reason: cov?.reason || '', status: S(k.status, 30),
      asked: askedRows.length, asked_ready: askedRows.filter((a: Any) => a.group === 'ready').length, asked_not_for_visit: askedRows.filter((a: Any) => a.group === 'not_for_visit').length })
  }
  replay.sort((a, z) => z.date.localeCompare(a.date))
  /* the history: one line per run, the last 30 */
  const hist = [...rowsOf(x.previous?.history), { at: x.now, ...counts, clients_incomplete: clients.incomplete, clients_flagged: clients.flagged }].slice(-30)
  return { version: 1, at: x.now, rule_version: M.VERSION, fingerprints: x.fingerprints || {}, window: { from: x.now.slice(0, 10), days: 14 }, counts, clients, rows, replay: { cases: replay.length, covered_ready: replay.filter((r) => r.covered_group === 'ready').length, rows: replay.slice(0, 200) },
    gaps: { ...gaps, restrictions_said: gaps.restrictions_said.length, no_journey_clients: gaps.no_journey_clients.length },
    notes: ['A report only: no visit, schedule, caregiver, client, card or text was touched.', 'The replay judges past call-offs with today\'s records.', 'Restrictions written in words are shown, never enforced. Driving a client counts only an Approved Driver with a current license and insurance (Driver Compliance)' + (x.driveGate === true ? '.' : ', shown as "Driver check (not enforced yet)" until its Admin switch is on.'), 'A caregiver with no availability on file is assumed available any time (24 hours).'],
    history: hist }
}
