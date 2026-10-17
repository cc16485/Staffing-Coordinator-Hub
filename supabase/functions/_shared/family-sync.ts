// =============================================================================
// family-sync: Release 2, "stays accurate" (Samantha 2026-10-17: "Start Release 2."; plan approved the same day:
// https://claude.ai/artifact/AS6GbybmUqC47WKPto44p8). AxisCare is the truth; the app follows it.
// Every 10 minutes (inside family-offer's run), each CONFIRMED app visit (status placed, an AxisCare visit, the next 14 days,
// not started) is read from AxisCare and compared with what the app shows:
//   * Caregiver taken off: the app says "<Sarah> can't come on <day>. Our office is arranging another caregiver and will
//     update you." No family message here: Coverage Help owns a call-off (its case, its "covered" text, or a person calls
//     the family). If no Coverage Help case is open for the visit, the office gets one card, because a confirmed visit
//     with nobody on it always needs a person (decision 7, existing coverage procedures).
//   * Another caregiver put on, or the time or day changed: the app updates. The family gets ONE message (caregiver changed
//     / time changed, her decisions 5 and D, 8 AM to 8 PM, the text with Texts OK, else the email), unless Coverage Help
//     has a case for the visit (it sends its own "covered" text: one message source, no duplicates), or the "who's coming"
//     confirmation hasn't gone yet (it will carry the new details).
//   * Removed in AxisCare (not by the family): the app shows "This visit was cancelled by <brand>. Questions? Call ..."; no
//     automatic message (the reason matters); the office gets a "Make sure the family knows why" card.
// AxisCare unreadable for a visit = nothing changes for it this run. Pure logic + injected dependencies (Node tests).
// Off with ops_settings.family_sync_live === false.
// =============================================================================
import { appLive, central, officeCard, when, visitOf, visitView, type Ax } from './family-app.ts'
import { inHours } from './answer-by.ts'
import { brand, brandFor } from './brands.ts'
import { fromTo } from './family-offer.ts'   // the same time words as the confirmation ("from 1 to 4")

// deno-lint-ignore no-explicit-any
type Any = any
export type ChangeKey = 'family_cgchange_text_approved' | 'family_timechange_text_approved'
export type SyncDeps = {
  ax: Ax
  now: () => Date
  settings: () => Promise<Any>
  /** placed app bookings with an AxisCare visit, visit_date from..to */
  placedAhead: (from: string, to: string) => Promise<Any[]>
  /** Coverage Help cases (open, covered or closed) by AxisCare visit id */
  coverage: () => Promise<Map<string, Any>>
  updateBooking: (id: string, vals: Any) => Promise<boolean>
  officeItem: (item: Any) => Promise<boolean>
  closeItem: (id: string, by: string, text: string) => Promise<void>
  event: (row: Any) => Promise<void>
  /** bookings whose change message is owed */
  changeDue: () => Promise<Any[]>
  tellFamily: (b: Any, sms: string, email: { subject: string; html: string }, approvalKey: ChangeKey) => Promise<{ ok: boolean; how?: 'sms' | 'email'; why?: string }>
}

export const SYNC_DAYS = 14, SYNC_MAX = 60
export const MSG_FAMILY_CG_CHANGED = "Hi {first_name}, it's {brand}. {caregiver} will be with {client} on {day}, {times}, instead of {old}. You can see the details anytime in the app: {app}"
export const MSG_FAMILY_TIME_CHANGED = "Hi {first_name}, it's {brand}. {client}'s visit is now on {day}, {times}, with {caregiver}. You can see the details anytime in the app: {app}"
const DAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MON_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const dayFull = (date: string) => { const d = new Date(date + 'T12:00:00Z'); return `${DAY_FULL[d.getUTCDay()]}, ${MON_FULL[d.getUTCMonth()]} ${d.getUTCDate()}` }
const fill = (t: string, x: Record<string, string>) => Object.entries(x).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, v), t).replace(/\s{2,}/g, ' ').trim()
const addDays = (date: string, n: number) => { const x = new Date(date + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const firstOf = (n: unknown) => String(n ?? '').trim().split(' ')[0]
/** "Maria L." the way the app names caregivers (goes-by or first name, last initial). */
export function cgName(c: Any): string {
  const f = String(c?.goesBy || c?.firstName || '').trim(), l = String(c?.lastName ?? '').trim()
  return [f, l ? l[0] + '.' : ''].filter(Boolean).join(' ') || (c?.id != null ? `#${c.id}` : '')
}
const started = (v: Any) => !!(v?.clockIn || v?.actualStartDate)

/** What AxisCare says now vs the booking. Pure. */
export function compare(b: Any, status: number, json: Any): { kind: 'unreadable' } | { kind: 'removed' } | { kind: 'started' } |
  { kind: 'same' } | { kind: 'no_caregiver' } | { kind: 'changed'; caregiver: boolean; time: boolean; vals: Record<string, unknown> } {
  if (status === 404) return { kind: 'removed' }
  if (status !== 200) return { kind: 'unreadable' }
  const raw = visitOf(json)
  if (!raw || typeof raw !== 'object') return { kind: 'unreadable' }
  if (raw.removed === true) return { kind: 'removed' }
  if (started(raw)) return { kind: 'started' }
  const v = visitView(raw)
  if (!v.date || !v.start || !v.end) return { kind: 'unreadable' }
  if (!v.caregiver || !v.caregiver.axiscare_id) return { kind: 'no_caregiver' }
  const cgNow = String(v.caregiver.axiscare_id), caregiver = cgNow !== String(b.caregiver_axiscare_id ?? '')
  const time = v.date !== b.visit_date || v.start !== String(b.start_time ?? '').slice(0, 5) || v.end !== String(b.end_time ?? '').slice(0, 5)
  if (!caregiver && !time) return { kind: 'same' }
  const vals: Record<string, unknown> = {}
  if (caregiver) { vals.caregiver_axiscare_id = cgNow; vals.caregiver_name = cgName(raw.caregiver) }
  if (time) { vals.visit_date = v.date; vals.start_time = v.start; vals.end_time = v.end }
  return { kind: 'changed', caregiver, time, vals }
}

export async function syncPlaced(d: SyncDeps, opts: { dry?: boolean } = {}) {
  const st = await d.settings(), now = d.now(), nowIso = now.toISOString(), today = central(now).date
  const out = { checked: 0, same: 0, changed: 0, no_caregiver: 0, removed: 0, unreadable: 0, cards: 0, family_texts: 0, would: [] as Any[] }
  if (st?.family_sync_live === false) return { ...out, held: 'family_sync_live is off' }
  const live = !opts.dry
  // 1. the messages owed from earlier runs (8 AM to 8 PM, her decision D)
  if (inHours(now, 8, 20)) {
    for (const b of await d.changeDue()) {
      if (!live) { out.would.push({ booking: b.id, tell_family_change: b.family_change_kind }); continue }
      const r = await tellChange(d, st, b, now)
      await d.updateBooking(b.id, { family_change_pending: false, family_change_at: nowIso, family_change_how: r.ok ? r.how : `not sent: ${r.why}` })
      if (r.ok) out.family_texts++
      else if (r.ask) { await d.officeItem({ ...officeCard('change_tell', b, `Tell the family about the change: ${b.client_name}`, `${when(b)} with ${b.caregiver_name ?? 'a caregiver'} changed in AxisCare, but the message to ${b.requested_by_name ?? 'the family'} didn't go (${r.why}). The app shows it; a call may help.`, nowIso), urgency: 'soon', next_action: 'Call the family.' }); out.cards++ }
    }
  }
  // 2. read AxisCare for each confirmed app visit ahead
  const list = (await d.placedAhead(today, addDays(today, SYNC_DAYS))).filter((b) => b.axiscare_visit_id && appLive(st, b.axiscare_client_id)).slice(0, SYNC_MAX)
  let cov: Map<string, Any> | null = null
  const caseFor = async (vid: string) => { cov = cov ?? await d.coverage(); return cov.get(String(vid)) ?? null }
  for (const b of list) {
    if (b.visit_date === today && String(b.start_time ?? '') && String(b.start_time).slice(0, 5) <= `${String(Math.floor(central(now).minutes / 60)).padStart(2, '0')}:${String(central(now).minutes % 60).padStart(2, '0')}`) continue
    out.checked++
    const r = await d.ax('GET', `/api/visits/${encodeURIComponent(String(b.axiscare_visit_id))}`)
    const c = compare(b, r.status, r.json)
    if (c.kind === 'unreadable' || c.kind === 'started') { if (c.kind === 'unreadable') out.unreadable++; continue }
    const base = { ax_checked_at: nowIso }
    if (c.kind === 'same') {
      out.same++
      if (b.sync_state && b.sync_state !== 'ok') {   // a caregiver was put back on: the app says so again
        if (live) { await d.updateBooking(b.id, { ...base, sync_state: 'ok', sync_note: null }); await d.closeItem(`fam_nocg_${b.id}`, 'family app', 'The caregiver is back on the visit in AxisCare.') }
      } else if (live) await d.updateBooking(b.id, base)
      continue
    }
    if (c.kind === 'removed') {
      out.removed++
      if (!live) { out.would.push({ booking: b.id, removed: true }); continue }
      await d.updateBooking(b.id, { ...base, status: 'cancelled', cancelled_at: nowIso, cancelled_by: 'Caring Companions (removed in AxisCare)', cancel_source: 'office', sync_state: 'removed', family_change_pending: false })
      await d.closeItem(`fam_nocg_${b.id}`, 'family app', 'The visit was removed in AxisCare.')
      await d.officeItem({ ...officeCard('removed', b, `Make sure the family knows why: ${b.client_name}, ${b.visit_date}`, `The app visit ${when(b)} with ${b.caregiver_name ?? 'a caregiver'} was removed in AxisCare. The app now shows "cancelled by us", but nobody has told ${b.requested_by_name ?? 'the family'} why. Please call them.`, nowIso), urgency: 'today', next_action: 'Call the family and tell them why.' })
      out.cards++
      await d.event({ actor_kind: 'system', actor_name: 'family app', via: 'cron', verb: 'family_visit_removed', area: 'family_app', summary: `${b.client_name} ${when(b)} was removed in AxisCare; the app shows it cancelled and the office is asked to tell the family why`, data: { booking_id: b.id, axiscare_visit_id: b.axiscare_visit_id } })
      continue
    }
    if (c.kind === 'no_caregiver') {
      out.no_caregiver++
      if (b.sync_state === 'no_caregiver') { if (live) await d.updateBooking(b.id, base); continue }
      if (!live) { out.would.push({ booking: b.id, no_caregiver: true }); continue }
      const k = await caseFor(b.axiscare_visit_id)
      await d.updateBooking(b.id, { ...base, sync_state: 'no_caregiver', sync_note: b.caregiver_name ?? null, family_change_pending: false })
      if (!k || k.status !== 'open') {
        await d.officeItem({ ...officeCard('nocg', b, `App visit has no caregiver: ${b.client_name}, ${b.visit_date}`, `${b.caregiver_name ?? 'The caregiver'} is no longer on ${when(b)} in AxisCare, and Coverage Help has no open case for it. The family's app says our office is arranging another caregiver. Please cover it (or tell the family).`, nowIso), urgency: 'today', next_action: 'Cover the visit, or call the family.' })
        out.cards++
      }
      await d.event({ actor_kind: 'system', actor_name: 'family app', via: 'cron', verb: 'family_visit_no_caregiver', area: 'family_app', summary: `${b.caregiver_name ?? 'The caregiver'} is off ${b.client_name} ${when(b)} in AxisCare${k?.status === 'open' ? ' (Coverage Help has it)' : '; the office is asked to cover it'}`, data: { booking_id: b.id, coverage_case: k?.id ?? null } })
      continue
    }
    // changed: caregiver and/or time
    out.changed++
    if (!live) { out.would.push({ booking: b.id, caregiver: c.caregiver, time: c.time }); continue }
    const k = await caseFor(b.axiscare_visit_id)
    const confirmOwed = b.family_confirm_pending === true && !b.family_confirmed_at   // the "who's coming" message will carry the new details
    const quiet = !!k || confirmOwed
    const was = { caregiver: b.caregiver_name ?? null, date: b.visit_date, start: b.start_time, end: b.end_time }
    const vals: Record<string, unknown> = { ...base, ...c.vals, sync_state: 'ok', sync_note: null }
    if (!quiet) {
      const from = b.family_change_pending ? (b.family_change_from ?? was) : was   // several changes before we tell them: one message, from the first
      const cgNow = String(c.vals.caregiver_name ?? b.caregiver_name ?? ''), dNow = String(c.vals.visit_date ?? b.visit_date), sNow = String(c.vals.start_time ?? b.start_time ?? '').slice(0, 5), eNow = String(c.vals.end_time ?? b.end_time ?? '').slice(0, 5)
      const cgDiff = cgNow !== String(from.caregiver ?? ''), timeDiff = dNow !== from.date || sNow !== String(from.start ?? '').slice(0, 5) || eNow !== String(from.end ?? '').slice(0, 5)
      Object.assign(vals, cgDiff || timeDiff
        ? { family_change_pending: true, family_change_at: null, family_change_from: from, family_change_kind: cgDiff && timeDiff ? 'both' : cgDiff ? 'caregiver' : 'time' }
        : { family_change_pending: false, family_change_from: null })   // changed back before we told them: nothing to say
    }
    await d.updateBooking(b.id, vals)
    await d.closeItem(`fam_nocg_${b.id}`, 'family app', `${String(c.vals.caregiver_name ?? b.caregiver_name ?? 'A caregiver')} is on the visit in AxisCare.`)
    await d.event({ actor_kind: 'system', actor_name: 'family app', via: 'cron', verb: 'family_visit_changed', area: 'family_app',
      summary: `${b.client_name} ${when(b)} changed in AxisCare (${[c.caregiver ? `caregiver now ${c.vals.caregiver_name}` : '', c.time ? `now ${c.vals.visit_date} ${c.vals.start_time} to ${c.vals.end_time}` : ''].filter(Boolean).join(', ')}); ${k ? 'Coverage Help tells the family' : confirmOwed ? 'the confirmation carries it' : 'the family is told'}`,
      data: { booking_id: b.id, was, coverage_case: k?.id ?? null } })
  }
  return out
}

/** The one change message, built from what the booking says NOW. */
async function tellChange(d: SyncDeps, st: Any, b: Any, now: Date): Promise<{ ok: boolean; how?: 'sms' | 'email'; why?: string; ask?: boolean }> {
  const t = central(now), nowHM = `${String(Math.floor(t.minutes / 60)).padStart(2, '0')}:${String(t.minutes % 60).padStart(2, '0')}`
  if (b.status !== 'placed' || b.visit_date < t.date || (b.visit_date === t.date && String(b.start_time ?? '').slice(0, 5) <= nowHM)) return { ok: false, why: 'the visit had already started or ended' }
  const kind = String(b.family_change_kind ?? 'time'), keys: ChangeKey[] = kind === 'caregiver' ? ['family_cgchange_text_approved'] : kind === 'time' ? ['family_timechange_text_approved'] : ['family_cgchange_text_approved', 'family_timechange_text_approved']
  if (!keys.every((k) => st?.[k])) return { ok: false, why: 'the family message is not approved in the Hub settings' }
  const fb = brand(brandFor(b.state), st)
  if (!fb?.app_host) return { ok: false, why: 'the visit has no Missouri/Oklahoma state, so no brand to send as', ask: true }
  const first = firstOf(b.requested_by_name) || 'there', client = firstOf(b.client_name) || 'your loved one', cg = firstOf(b.caregiver_name) || 'your caregiver'
  const old = firstOf(b.family_change_from?.caregiver) || 'the caregiver we told you'
  const day = dayFull(b.visit_date), times = b.start_time && b.end_time ? fromTo(String(b.start_time).slice(0, 5), String(b.end_time).slice(0, 5)) : ''
  const sms = fill(kind === 'caregiver' ? MSG_FAMILY_CG_CHANGED : MSG_FAMILY_TIME_CHANGED, { first_name: first, brand: fb.short, caregiver: cg, client, day, times, old, app: fb.app_host })
  const h = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const line = kind === 'caregiver' ? `<b>${h(cg)}</b> will be with ${h(client)} on <b>${h(day)}, ${h(times)}</b>, instead of ${h(old)}.` : `${h(client)}'s visit is now on <b>${h(day)}, ${h(times)}</b>, with <b>${h(cg)}</b>.`
  const html = `<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.6;color:#16283a;max-width:520px"><p>Hi ${h(first)},</p><p>${line}</p>` +
    `<p>You can see the details anytime in the app at <a href="${h(String(fb.app_url))}">${h(String(fb.app_host))}</a>.</p><p>Questions? Call us at ${h(fb.phone)}.</p><p style="color:#55677a">${h(fb.footer)}</p></div>`
  const r = await d.tellFamily(b, sms, { subject: kind === 'caregiver' ? `${cg} will be with ${client} on ${day}` : `${client}'s visit is now on ${day}`, html }, keys[0])
  return r.ok ? r : { ...r, ask: r.why !== 'no way to reach them (no Texts OK and no email)' }
}
