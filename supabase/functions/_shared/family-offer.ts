// =============================================================================
// family-offer: caregivers are offered the visits families book in the app (her yes 2026-10-16: "caregiver yes goes
// straight on the schedule, picks get 4 hours first, office card if unfilled 24 hours before or everyone asked, families
// see who and when in the app only").
//
// For each app booking still waiting for a caregiver (family_bookings, status waiting_for_caregiver, nobody on it):
//   1. picks: the caregivers the family asked for are texted first, all at once, each with their own link. They have
//      family_offer_pick_wait_hours (4) to themselves, less when the visit is close (never more than half the time left).
//   2. team: then the wider team in waves of family_offer_wave_size (5), every family_offer_wave_gap_minutes (60) or as
//      soon as a whole wave has said no. Worked with this client first, then those whose availability fits. Only states
//      in family_offer_team_states (Missouri for now: caregivers carry no state yet, so an Oklahoma visit is never sent
//      to Missouri caregivers; it goes to the office after the picks).
//   3. FIRST YES WINS (one conditional database update). The caregiver goes straight on the AxisCare schedule, read back:
//      set time = onto the visit already there; flexible = the visit is made now at the start they picked. A later yes is
//      told someone else took it. AxisCare saying no = an office card (the caregiver is told the office will confirm).
//   4. office card (fam_book_<booking>, the same card the office's Place closes) when nobody has taken it
//      family_offer_unfilled_hours (24) before the visit, or once everyone who could be asked has been.
// Every caregiver text: the No shift texts list, Do Not Return, AxisCare active (live), the new-hire lock (shiftAskBlock),
// not already working then, the caregiver night rule (9pm to 8am unless the visit starts within 3 hours), the universal
// STOP door and checked sends (a refused text is a Needs Attention card). The text never has the client's name, address or
// pay; the link shows the client's first name, the tasks and the family's note.
// Never contacts a family: they see who is coming, and when, in the app.
// OFF until ops_settings.family_offer_live === true (then the office no longer gets a card for every booking).
// Pure logic + injected dependencies so it runs under Node tests.
// =============================================================================
import { central, hoursUntil, startOf, startChoices, toMin, fromMin, clock12, caregiverDay, overlaps, placeCaregiver, clientVisits, officeCard, when, type Ax } from './family-app.ts'

// deno-lint-ignore no-explicit-any
type Any = any
export type Candidate = { axiscare_id: string; name: string; first: string; phone: string; avail?: { windows?: Record<string, string[]> | null; outside_ok?: boolean | null } | null }
export type OfferDeps = {
  ax: Ax
  now: () => Date
  settings: () => Promise<Any>
  openBookings: (fromDate: string) => Promise<Any[]>
  booking: (id: string) => Promise<Any | null>
  offers: (bookingId: string) => Promise<Any[]>
  offer: (id: string) => Promise<Any | null>
  insertOffer: (row: Any) => Promise<{ id: string } | null>
  updateOffer: (id: string, vals: Any) => Promise<boolean>
  updateBooking: (id: string, vals: Any) => Promise<boolean>
  /** First yes wins: sets vals only while the booking is still waiting with nobody on it. True = this caller won. */
  claimBooking: (id: string, vals: Any) => Promise<boolean>
  roster: () => Promise<Candidate[]>
  askBlock: (c: Candidate, clientName: string) => Promise<string | null>
  sendText: (c: Candidate, message: string) => Promise<{ ok: true } | { ok: false; why: string }>
  makeLink: (offerId: string, exp: number) => Promise<string>
  officeItem: (item: Any) => Promise<boolean>
  closeItem: (id: string, by: string, text: string) => Promise<void>
  event: (row: Any) => Promise<void>
}

export const MSG_PICK = "Hi {first_name}, it's Caring Companions. A family you've visited asked for you for an extra visit in {town}: {when}. Can you take it? Tap to see it and answer: {link}"
export const MSG_TEAM = "Hi {first_name}, it's Caring Companions. We have an extra visit in {town}: {when}. Can you take it? The first yes gets it. Tap to see it and answer: {link}"
const num = (v: unknown, d: number) => Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d
export function offerSettings(st: Any) {
  return { live: st?.family_offer_live === true, pickWait: num(st?.family_offer_pick_wait_hours, 4), waveSize: Math.min(20, num(st?.family_offer_wave_size, 5)),
    gapMin: num(st?.family_offer_wave_gap_minutes, 60), unfilledHours: num(st?.family_offer_unfilled_hours, 24),
    teamStates: Array.isArray(st?.family_offer_team_states) ? st.family_offer_team_states.map(String) : ['MO'],
    quietFrom: Number.isFinite(Number(st?.coverage_quiet_from)) ? Number(st.coverage_quiet_from) : 21,
    quietUntil: Number.isFinite(Number(st?.coverage_quiet_until)) ? Number(st.coverage_quiet_until) : 8,
    msgPick: String(st?.family_offer_msg_pick || '') || MSG_PICK, msgTeam: String(st?.family_offer_msg_team || '') || MSG_TEAM }
}

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const dayWords = (date: string) => { const d = new Date(date + 'T12:00:00Z'); return `${DAY[d.getUTCDay()]}, ${MON[d.getUTCMonth()]} ${d.getUTCDate()}` }
const hrsWords = (h: number) => `${h % 1 ? h.toFixed(1) : h} hours`
/** The visit in a caregiver's words: "Thu, Oct 22, 10 AM to 1 PM" or "Thu, Oct 22, 3 hours, you pick the start between 9 AM and 3 PM". */
export function whenWords(b: Any) {
  if (b.kind === 'flex' && !b.start_time) return `${dayWords(b.visit_date)}, ${hrsWords(Number(b.hours))}, you pick the start between ${clock12(b.window_start)} and ${clock12(fromMin(toMin(b.window_end) - Number(b.hours) * 60))}`
  return `${dayWords(b.visit_date)}, ${clock12(b.start_time)} to ${clock12(b.end_time)}`
}

/** The caregiver night rule (coverage-run's): 9pm to 8am Central nothing goes, unless the visit starts within 3 hours. */
export function nightHold(now: Date, hoursLeft: number, o: { quietFrom: number; quietUntil: number }) {
  const h = Math.floor(central(now).minutes / 60)
  const quiet = o.quietFrom > o.quietUntil ? (h >= o.quietFrom || h < o.quietUntil) : (h >= o.quietFrom && h < o.quietUntil)
  return quiet && !(hoursLeft > 0 && hoursLeft < 3)
}

/** Availability (her 24-hour rule: nothing on file = any time). The day and time of day of the visit's earliest start,
 *  the same bands as the availability page. */
const bandOf = (hhmm: string) => { const h = Number(hhmm.slice(0, 2)); return h >= 6 && h < 12 ? 'morning' : h >= 12 && h < 17 ? 'afternoon' : h >= 17 && h < 22 ? 'evening' : 'overnight' }
export function availFits(a: Candidate['avail'], date: string, start: string): 'fits' | 'none_on_file' | 'outside_ok' | 'outside' {
  const w = a?.windows
  if (!w || !Object.values(w).some((v) => Array.isArray(v) && v.length)) return 'none_on_file'
  const d = DAY[new Date(date + 'T12:00:00Z').getUTCDay()].toLowerCase()
  if (Array.isArray(w[d]) && w[d].includes(bandOf(start))) return 'fits'
  return a?.outside_ok === true ? 'outside_ok' : 'outside'
}

/** The starts this caregiver could take (a set time: just its start), leaving out times they are already working. */
export async function freeStarts(ax: Ax, b: Any, cg: string): Promise<string[]> {
  const busy = await caregiverDay(ax, cg, b.visit_date)
  const hours = Number(b.hours)
  const all = b.kind === 'flex' && !b.start_time ? startChoices(b.window_start, b.window_end, hours) : [b.start_time]
  return all.filter((s: string) => !overlaps(s, fromMin(toMin(s) + hours * 60), busy))
}

async function townOf(ax: Ax, clientId: string): Promise<string> {
  try {
    const r = await ax('GET', `/api/clients/${encodeURIComponent(clientId)}`)
    const c = r.json?.results?.client ?? r.json?.results
    return String(c?.residentialAddress?.city ?? c?.mailingAddress?.city ?? '').trim()
  } catch { return '' }
}
const linkExpiry = (date: string) => Math.floor(Date.parse(date + 'T23:59:59Z') / 1000) + 6 * 3600   // end of the visit day, Central

// ── the run (cron, every 10 minutes) ──────────────────────────────────────────────────────────────────────────────────
export async function runOffers(d: OfferDeps, opts: { dry?: boolean } = {}) {
  const st = await d.settings(), o = offerSettings(st), now = d.now(), nowIso = now.toISOString(), today = central(now).date
  const live = o.live && !opts.dry
  const out = { live, bookings: 0, texted: 0, refused: 0, failed: 0, held_night: 0, cards: 0, would: [] as Any[], skipped: [] as Any[] }
  if (st?.family_app_live !== true) return { ...out, held: 'the family app is in practice mode, so nothing is offered' }
  let roster: Candidate[] | null = null
  for (const b0 of await d.openBookings(today)) {
    const b = { ...b0 }
    if (b.status !== 'waiting_for_caregiver' || b.caregiver_axiscare_id) continue
    out.bookings++
    const left = hoursUntil(b.visit_date, startOf(b), now)
    if (left <= 0) { if (b.offer_stage !== 'done' && live) await d.updateBooking(b.id, { offer_stage: 'done' }); continue }
    const card = async (title: string, detail: string) => {
      out.cards++
      if (!live) return
      await d.officeItem({ ...officeCard('book', b, title, detail, nowIso), urgency: left <= 24 ? 'today' : 'soon' })
      await d.updateBooking(b.id, { unfilled_card_at: nowIso })
      b.unfilled_card_at = nowIso
    }
    const offers = await d.offers(b.id)
    const asked = new Set(offers.map((x) => String(x.caregiver_axiscare_id)))
    const lines = () => offers.length ? ` Asked so far: ${offers.map((x) => `${x.caregiver_name ?? x.caregiver_axiscare_id} (${x.state === 'sent' ? 'no answer yet' : x.state})`).join(', ')}.` : ''
    if (left <= o.unfilledHours && !b.unfilled_card_at)
      await card(`Nobody has taken this yet: ${b.client_name}, ${b.visit_date}`, `${b.requested_by_name ?? 'The family'} booked ${when(b)} in the app and no caregiver has said yes, with ${Math.round(left)} hours to go.${lines()} Place someone (Scheduling, Family bookings), or call the family.`)
    if (!o.live) { out.would.push({ booking: b.id, stage: b.offer_stage ?? 'picks next' }); continue }
    if (nightHold(now, left, o)) { out.held_night++; continue }
    let town = '', history: Map<string, number> | null = null
    const send = async (c: Candidate, wave: 'picks' | 'team', waveNo: number): Promise<'sent' | 'skip'> => {
      const why = await d.askBlock(c, String(b.client_name ?? ''))
      if (why) { out.skipped.push({ booking: b.id, who: c.name, why }); return 'skip' }
      let free: string[] = []
      try { free = await freeStarts(d.ax, b, c.axiscare_id) } catch (e) { out.skipped.push({ booking: b.id, who: c.name, why: `their AxisCare schedule couldn't be read (${String(e).slice(0, 80)})` }); return 'skip' }
      if (!free.length) { out.skipped.push({ booking: b.id, who: c.name, why: 'already working then' }); return 'skip' }
      if (opts.dry) { out.would.push({ booking: b.id, who: c.name, wave }); return 'sent' }
      if (!town) town = (await townOf(d.ax, b.axiscare_client_id)) || 'your area'
      const ins = await d.insertOffer({ booking_id: b.id, caregiver_axiscare_id: c.axiscare_id, caregiver_name: c.name, wave, wave_no: waveNo, state: 'sent', sent_at: nowIso })
      if (!ins) return 'skip'   // already asked (unique per booking and caregiver)
      asked.add(c.axiscare_id)
      const link = await d.makeLink(ins.id, linkExpiry(b.visit_date))
      const msg = (wave === 'picks' ? o.msgPick : o.msgTeam).replaceAll('{first_name}', c.first || 'there').replaceAll('{town}', town).replaceAll('{when}', whenWords(b)).replaceAll('{link}', link)
      const r = await d.sendText(c, msg)
      if (!r.ok) { await d.updateOffer(ins.id, { state: 'failed', error: r.why }); out.failed++; return 'skip' }
      offers.push({ id: ins.id, caregiver_axiscare_id: c.axiscare_id, caregiver_name: c.name, wave, wave_no: waveNo, state: 'sent', sent_at: nowIso })
      out.texted++
      return 'sent'
    }
    // 1. picks
    if (!b.offer_stage) {
      const ids: string[] = Array.isArray(b.preferred_caregiver_ids) ? b.preferred_caregiver_ids.map(String) : []
      let sent = 0
      if (ids.length) {
        roster = roster ?? await d.roster()
        for (const id of ids) {
          const c = roster.find((x) => x.axiscare_id === id)
          if (!c) { out.skipped.push({ booking: b.id, who: id, why: 'not an active caregiver with a phone on the Hub roster' }); continue }
          if (!asked.has(id) && await send(c, 'picks', 1) === 'sent') sent++
        }
      }
      if (opts.dry) continue
      const waitH = sent ? Math.min(o.pickWait, Math.max(0.5, left / 2)) : 0
      b.offer_stage = sent ? 'picks' : 'team'; b.offer_next_at = new Date(now.getTime() + waitH * 3600000).toISOString()
      await d.updateBooking(b.id, { offer_stage: b.offer_stage, offer_next_at: b.offer_next_at })
      if (sent) continue
    }
    if (opts.dry) continue
    const pending = (wave: string) => offers.filter((x) => x.wave === wave && x.state === 'sent')
    const due = !b.offer_next_at || Date.parse(b.offer_next_at) <= now.getTime()
    // 2. picks had their time (or all said no): the wider team
    if (b.offer_stage === 'picks') {
      if (!due && pending('picks').length) continue
      b.offer_stage = 'team'; b.offer_next_at = nowIso
      await d.updateBooking(b.id, { offer_stage: 'team', offer_next_at: nowIso })
    }
    if (b.offer_stage === 'team') {
      const lastWave = Math.max(0, ...offers.filter((x) => x.wave === 'team').map((x) => Number(x.wave_no) || 1))
      if (!due && pending('team').length) continue
      const allAsked = async (why: string) => {
        await d.updateBooking(b.id, { offer_stage: 'done' }); b.offer_stage = 'done'
        if (!b.unfilled_card_at) await card(`Nobody has taken this yet: ${b.client_name}, ${b.visit_date}`, `${b.requested_by_name ?? 'The family'} booked ${when(b)} in the app. ${why}${lines()} Place someone (Scheduling, Family bookings), or call the family.`)
      }
      if (!o.teamStates.includes(String(b.state))) { await allAsked(`The wider team isn't texted for ${b.state} visits yet, so the office places this one.`); continue }
      roster = roster ?? await d.roster()
      if (!history) {
        history = new Map()
        try { for (const v of await clientVisits(d.ax, b.axiscare_client_id, addDays(today, -180), today)) { const id = v?.caregiver?.id; if (id != null) history.set(String(id), (history.get(String(id)) ?? 0) + 1) } } catch { /* ranking only */ }
      }
      const start = startOf(b)
      const fitRank = { fits: 0, none_on_file: 1, outside_ok: 2, outside: 9 }
      const ranked = roster.filter((c) => !asked.has(c.axiscare_id))
        .map((c) => ({ c, fit: availFits(c.avail, b.visit_date, start), seen: history!.get(c.axiscare_id) ?? 0 }))
        .filter((x) => x.fit !== 'outside')
        .sort((x, y) => (y.seen > 0 ? 1 : 0) - (x.seen > 0 ? 1 : 0) || fitRank[x.fit] - fitRank[y.fit] || y.seen - x.seen || x.c.name.localeCompare(y.c.name))
      let sent = 0
      for (const x of ranked) { if (sent >= o.waveSize) break; if (await send(x.c, 'team', lastWave + 1) === 'sent') sent++ }
      if (!sent) { if (!pending('team').length && !pending('picks').length) await allAsked('Everyone who could be asked has been asked.'); continue }
      b.offer_next_at = new Date(now.getTime() + o.gapMin * 60000).toISOString()
      await d.updateBooking(b.id, { offer_next_at: b.offer_next_at })
    }
  }
  return out
}
const addDays = (date: string, n: number) => { const x = new Date(date + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }

// ── the caregiver's page (their own link) ─────────────────────────────────────────────────────────────────────────────
type Out = { status: number; body: Record<string, unknown> }
const say = (status: number, body: Record<string, unknown>): Out => ({ status, body })
/** {action:'view'} or {action:'answer', yes, start?}, for the offer the link was signed for (the door checks the link). */
export async function offerPage(d: OfferDeps, offerId: string, body: Any): Promise<Out> {
  const off = await d.offer(offerId)
  if (!off) return say(404, { error: "We couldn't find this visit." })
  const b = await d.booking(String(off.booking_id))
  if (!b) return say(404, { error: "We couldn't find this visit." })
  const now = d.now(), nowIso = now.toISOString(), cg = String(off.caregiver_axiscare_id)
  const mine = String(b.caregiver_axiscare_id ?? '') === cg && ['placed', 'needs_office'].includes(b.status)
  const left = hoursUntil(b.visit_date, startOf(b), now)
  const state = mine ? 'yours' : b.status === 'cancelled' ? 'cancelled' : (b.caregiver_axiscare_id || b.status !== 'waiting_for_caregiver') ? 'taken' : left <= 0 ? 'ended' : 'open'
  const view = async () => {
    let choices: string[] = []
    if (state === 'open') { try { choices = await freeStarts(d.ax, b, cg) } catch { choices = [] } }
    return { state, answer: off.state, first_name: String(off.caregiver_name ?? '').split(' ')[0], client: String(b.client_name ?? '').split(' ')[0], town: await townOf(d.ax, b.axiscare_client_id),
      date: b.visit_date, day: dayWords(b.visit_date), kind: b.kind === 'flex' && !b.start_time ? 'flex' : 'set', start: b.start_time ?? null, end: b.end_time ?? null,
      window_start: b.window_start ?? b.start_time, window_end: b.window_end ?? b.end_time, hours: Number(b.hours), tasks: b.tasks ?? [], note: b.note ?? null, choices,
      picked: mine ? b.start_time : null }
  }
  const action = String(body?.action ?? 'view')
  if (action === 'view') return say(200, await view())
  if (action !== 'answer') return say(400, { error: 'unknown action' })
  if (body?.yes !== true) {
    if (state === 'open' && off.state === 'sent') await d.updateOffer(off.id, { state: 'no', answered_at: nowIso })
    return say(200, { ok: true, message: 'Thank you for letting us know.' })
  }
  if (state === 'yours') return say(200, { ok: true, message: "You're already on this visit. Thank you!" })
  if (state !== 'open') {
    if (off.state === 'sent') await d.updateOffer(off.id, { state: 'taken', answered_at: nowIso })
    return say(200, { ok: false, taken: true, message: state === 'cancelled' ? 'The family cancelled this visit. Thank you!' : state === 'ended' ? 'This visit has passed. Thank you!' : 'Someone else took this one. Thank you for saying yes!' })
  }
  let free: string[] = []
  try { free = await freeStarts(d.ax, b, cg) } catch { return say(502, { error: "We couldn't check your schedule just now. Please try again in a minute." }) }
  const flex = b.kind === 'flex' && !b.start_time
  const pick = flex ? String(body?.start ?? '') : b.start_time
  if (!free.includes(pick)) return say(409, { error: flex ? 'Please pick a start time from the list.' : "You're already working then, so we can't put you on this one." })
  const won = await d.claimBooking(b.id, { caregiver_axiscare_id: cg, caregiver_name: off.caregiver_name ?? null })
  if (!won) { await d.updateOffer(off.id, { state: 'taken', answered_at: nowIso }); return say(200, { ok: false, taken: true, message: 'Someone else took this one. Thank you for saying yes!' }) }
  await d.updateOffer(off.id, { state: 'yes', answered_at: nowIso, picked_start: pick })
  const st = await d.settings()
  const put = await placeCaregiver(d.ax, b, cg, flex ? pick : null, st)
  for (const x of await d.offers(b.id)) if (x.id !== off.id && x.state === 'sent') await d.updateOffer(x.id, { state: 'closed' })
  if (!put.ok) {
    await d.updateBooking(b.id, { status: 'needs_office', offer_stage: 'done', error: `${off.caregiver_name ?? 'A caregiver'} said yes${flex ? ` for ${pick}` : ''}, but: ${put.why}` })
    await d.officeItem({ ...officeCard('book', b, `${off.caregiver_name ?? 'A caregiver'} said yes: ${b.client_name}, ${b.visit_date}`, `${off.caregiver_name ?? 'A caregiver'} took ${when(b)} from the app offer${flex ? `, starting ${pick}` : ''}, but it isn't on AxisCare yet: ${put.why}. Please put them on by hand and let them know.`, nowIso), urgency: 'today' })
    await d.event({ actor_kind: 'person', actor_name: off.caregiver_name ?? cg, via: 'link', verb: 'family_offer_yes', area: 'family_app', summary: `${off.caregiver_name} said yes to ${b.client_name} ${b.visit_date} (AxisCare: ${put.why})`, data: { booking_id: b.id, offer_id: off.id, placed: false } })
    return say(200, { ok: true, message: 'Thank you! The office will confirm with you shortly.' })
  }
  await d.updateBooking(b.id, { ...put.vals, status: 'placed', placed_at: nowIso, placed_by: 'caregiver yes (family app offer)', offer_stage: 'done', error: null })
  await d.closeItem(`fam_book_${b.id}`, 'family app', `${put.name} said yes and is on the schedule`)
  await d.event({ actor_kind: 'person', actor_name: off.caregiver_name ?? cg, via: 'link', verb: 'family_offer_yes', area: 'family_app', summary: `${put.name} took ${b.client_name} ${b.visit_date}${flex ? ` at ${pick}` : ''}`, data: { booking_id: b.id, offer_id: off.id, placed: true } })
  const end = fromMin(toMin(pick) + Number(b.hours) * 60)
  return say(200, { ok: true, placed: true, message: `You're on it! ${dayWords(b.visit_date)}, ${clock12(pick)} to ${clock12(end)}. It's on your AxisCare schedule now. Thank you!` })
}
