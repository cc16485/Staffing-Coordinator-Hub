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
// Families: TWO named messages only, each her decision (2026-10-16), each behind its own recorded approval, sent through
// family-offer-db.ts: "caregivers are interested" (Let me choose) and "<caregiver> will be there" when a caregiver is confirmed
// (8 AM to 8 PM Central, the text with Texts OK, else the email).
// OFF until ops_settings.family_offer_live === true (then the office no longer gets a card for every booking).
// Pure logic + injected dependencies so it runs under Node tests.
// =============================================================================
import { appLive, central, hoursUntil, startOf, startChoices, toMin, fromMin, clock12, caregiverDay, overlaps, placeCaregiver, clientVisits, officeCard, when, chooseSettings, cardOf, shareable, type Ax } from './family-app.ts'
import { brand, brandFor } from './brands.ts'

// deno-lint-ignore no-explicit-any
type Any = any
export type Candidate = { axiscare_id: string; name: string; first: string; phone: string; drive?: Any; avail?: { windows?: Record<string, string[]> | null; outside_ok?: boolean | null } | null }
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
  /** needsTransport: the visit has rides or an outing, so only an Approved Driver (cleared, current license + insurance) may be asked. */
  askBlock: (c: Candidate, clientName: string, needsTransport: boolean) => Promise<string | null>
  sendText: (c: Candidate, message: string) => Promise<{ ok: true } | { ok: false; why: string }>
  makeLink: (offerId: string, exp: number) => Promise<string>
  officeItem: (item: Any) => Promise<boolean>
  closeItem: (id: string, by: string, text: string) => Promise<void>
  event: (row: Any) => Promise<void>
  // ── Let me choose ──
  /** Text one caregiver by AxisCare id (chosen / not chosen / cancelled). */
  textCaregiver: (axiscareId: string, message: string) => Promise<{ ok: boolean; why?: string }>
  /** The shift-ask gate for one caregiver by AxisCare id (re-checked when the family chooses). */
  askBlockId: (axiscareId: string, name: string, clientName: string, needsTransport: boolean) => Promise<string | null>
  /** Published + consented caregiver profiles (her answer 3: only they are asked in Let me choose and shown to the family). */
  profiles: (axiscareIds: string[]) => Promise<Any[]>
  supabaseUrl: string
  /** THE one automatic family text (her named exception, 2026-10-16): to the person who booked, when caregivers are interested. */
  textFamily?: (b: Any, message: string) => Promise<{ ok: boolean; why?: string }>
  // ── the family hears who's coming (her yes 2026-10-16: "including the automatic text to the family when a caregiver is
  //    confirmed (8 AM to 8 PM, Texts OK only, email if no consent)") ──
  /** Placed bookings whose family hasn't been told yet. */
  confirmDue?: () => Promise<Any[]>
  /** To the person who booked: the text if they have Texts OK, else the email; neither = not sent (says why). */
  tellFamily?: (b: Any, sms: string, email: { subject: string; html: string }) => Promise<{ ok: boolean; how?: 'sms' | 'email'; why?: string }>
  /** The office's short "About <client>" for caregivers (care_circles.caregiver_about), or null. */
  clientAbout?: (axiscareClientId: string) => Promise<string | null>
}
export type ChooseDeps = Pick<OfferDeps, 'ax' | 'now' | 'settings' | 'offers' | 'updateOffer' | 'updateBooking' | 'claimBooking' | 'textCaregiver' | 'askBlockId' | 'profiles' | 'supabaseUrl' | 'officeItem' | 'closeItem' | 'event'>

export const MSG_PICK = "Hi {first_name}, it's Caring Companions. A family you've visited asked for you for an extra visit in {town}: {when}. Can you take it? Tap to see it and answer: {link}"
export const MSG_TEAM = "Hi {first_name}, it's Caring Companions. We have an extra visit in {town}: {when}. Can you take it? The first yes gets it. Tap to see it and answer: {link}"
export const MSG_CHOOSE = "Hi {first_name}, it's {brand}. A family is choosing a caregiver for an extra visit in {town}: {when}. Interested? Tap to see it and let them know: {link} The family picks, and we'll text you if it's you."
export const MSG_CHOSEN = "Hi {first_name}, good news: the family chose you for {when} in {town}. It's on your AxisCare schedule now. Thank you! {brand}"
export const MSG_NOT_CHOSEN = "Hi {first_name}, the family chose another caregiver for {when} this time. Thank you for saying you could help. {brand}"
export const MSG_CHOOSE_CANCELLED = "Hi {first_name}, the family cancelled the visit on {when} that you were interested in, so it's no longer needed. Thank you! {brand}"
export const MSG_FAMILY_CONFIRMED = "Hi {first_name}, it's {brand}. {caregiver} will be there for {client}'s visit on {when}. You can see it in the app: {app}"
export const MSG_FAMILY_INTERESTED = "Hi {first_name}, it's {brand}. A caregiver is interested in {client}'s visit on {when}. Open the app to see who and choose: {app} If you'd rather we pick, tap Find someone for me."
const num = (v: unknown, d: number) => Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d
export function offerSettings(st: Any) {
  return { live: st?.family_offer_live === true, pickWait: num(st?.family_offer_pick_wait_hours, 4), waveSize: Math.min(20, num(st?.family_offer_wave_size, 5)),
    gapMin: num(st?.family_offer_wave_gap_minutes, 60), unfilledHours: num(st?.family_offer_unfilled_hours, 24),
    teamStates: Array.isArray(st?.family_offer_team_states) ? st.family_offer_team_states.map(String) : ['MO'],
    quietFrom: Number.isFinite(Number(st?.coverage_quiet_from)) ? Number(st.coverage_quiet_from) : 21,
    quietUntil: Number.isFinite(Number(st?.coverage_quiet_until)) ? Number(st.coverage_quiet_until) : 8,
    msgPick: String(st?.family_offer_msg_pick || '') || MSG_PICK, msgTeam: String(st?.family_offer_msg_team || '') || MSG_TEAM }
}

/** Tasks that mean the caregiver drives the client (her Driver Compliance rule 2026-10-13: only Approved Drivers). Unlike the
 *  office's tools (driver_schedule_gate_live), app offers always enforce it: nobody reviews an app offer before it goes. The Hub
 *  setting family_offer_driver_check === false is the only way off. */
export const DRIVE_TASKS = ['Rides to appointments', 'An outing together']
export const needsDrive = (b: Any, st: Any) => st?.family_offer_driver_check !== false && (Array.isArray(b?.tasks) ? b.tasks : []).some((t: unknown) => DRIVE_TASKS.includes(String(t)))
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

// ── Let me choose: the engine (her yes 2026-10-16) ─────────────────────────────────────────────────────────────────────
const fill = (t: string, x: Record<string, string>) => Object.entries(x).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, v), t).replace(/\s{2,}/g, ' ').trim()
const brandShort = (b: Any, st: Any) => brand(brandFor(b?.state), st)?.short ?? null
/** Interest is good until the family's deadline; a caregiver can take it back. */
export const interestedOf = (offers: Any[]) => offers.filter((x) => x.state === 'interested').sort((a, b) => String(a.answered_at ?? '').localeCompare(String(b.answered_at ?? '')))

/** What the family sees: each interested caregiver's profile (published + consented only), and the start they picked (flex). */
export async function interestedCards(d: ChooseDeps, b: Any) {
  const ins = interestedOf(await d.offers(String(b.id)))
  if (!ins.length) return []
  const profs = (await d.profiles(ins.map((x) => String(x.caregiver_axiscare_id)))).filter(shareable)
  return ins.map((x) => { const p = profs.find((q) => String(q.axiscare_id) === String(x.caregiver_axiscare_id)); return p ? { offer_id: x.id, start: x.picked_start ?? b.start_time ?? null, ...cardOf(p, d.supabaseUrl) } : null }).filter(Boolean)
}

/** Put ONE interested caregiver on the visit: the family's pick (offerId), or the first still-free one (the deadline, or the
 *  family's "Find someone for me"). Re-checks everything first: still free, active in AxisCare, not Do Not Return, a driver
 *  if the visit needs one. The same one-winner update as first-yes stops double bookings. */
export async function placeChosen(d: ChooseDeps, b: Any, offerId: string | null, by: 'family' | 'switch' | 'deadline'): Promise<{ ok: boolean; placed?: boolean; name?: string; message: string; unavailable?: string[] }> {
  const st = await d.settings(), now = d.now(), nowIso = now.toISOString()
  const all = await d.offers(String(b.id)), ins = interestedOf(all)
  const pool = offerId ? ins.filter((x) => x.id === offerId) : ins
  if (offerId && !pool.length) return { ok: false, message: "That caregiver isn't available for this visit any more. Please pick someone else, or tap Find someone for me." }
  const sign = brandShort(b, st) ?? '', unavailable: string[] = []
  const town = (await townOf(d.ax, b.axiscare_client_id)) || 'your area'
  for (const off of pool) {
    const cg = String(off.caregiver_axiscare_id), name = String(off.caregiver_name ?? cg)
    const flex = b.kind === 'flex' && !b.start_time, pick = flex ? String(off.picked_start ?? '') : b.start_time
    let free: string[] = []
    try { free = await freeStarts(d.ax, b, cg) } catch { free = [] }
    const why = free.includes(pick) ? await d.askBlockId(cg, name, String(b.client_name ?? ''), needsDrive(b, st)) : 'already working then'
    if (why) { await d.updateOffer(off.id, { state: 'withdrawn', error: `no longer available: ${why}`, answered_at: nowIso }); unavailable.push(name.split(' ')[0]); continue }
    const won = await d.claimBooking(String(b.id), { caregiver_axiscare_id: cg, caregiver_name: off.caregiver_name ?? null })
    if (!won) return { ok: false, message: 'This visit already has a caregiver.' }
    await d.updateOffer(off.id, { state: 'chosen', answered_at: off.answered_at ?? nowIso })
    const put = await placeCaregiver(d.ax, b, cg, flex ? pick : null, st)
    const others = all.filter((x) => x.id !== off.id && (x.state === 'interested' || x.state === 'sent'))
    const wasInterested = others.filter((x) => x.state === 'interested').map((x) => ({ ...x }))
    for (const x of others) await d.updateOffer(x.id, { state: x.state === 'interested' ? 'not_chosen' : 'closed' })
    const placedB = { ...b, start_time: flex ? pick : b.start_time, end_time: flex ? fromMin(toMin(pick) + Number(b.hours) * 60) : b.end_time }
    if (!put.ok) {
      await d.updateBooking(String(b.id), { status: 'needs_office', offer_stage: 'done', error: `${name} was ${by === 'family' ? 'chosen by the family' : 'picked'}, but: ${put.why}` })
      await d.officeItem({ ...officeCard('book', b, `${by === 'family' ? 'The family chose' : 'Picked'} ${name}: ${b.client_name}, ${b.visit_date}`, `${name} was ${by === 'family' ? 'chosen by the family in the app' : 'picked (first interested)'} for ${when(b)}${flex ? `, starting ${pick}` : ''}, but it isn't on AxisCare yet: ${put.why}. Please put them on by hand and let them know.`, nowIso), urgency: 'today' })
      return { ok: true, placed: false, name: name.split(' ')[0], message: `Thank you! Our office will confirm ${name.split(' ')[0]} with you shortly.` }
    }
    await d.updateBooking(String(b.id), { ...put.vals, status: 'placed', placed_at: nowIso, placed_by: by === 'family' ? 'family chose (Let me choose)' : by === 'switch' ? 'family asked us to pick (first interested)' : 'choosing deadline (first interested)', offer_stage: 'done', error: null, family_confirm_pending: true })
    await d.closeItem(`fam_book_${b.id}`, 'family app', `${put.name} is on the schedule (${by === 'family' ? 'the family chose' : 'first interested'})`)
    const parts = (x: Any) => ({ first_name: String(x.caregiver_name ?? '').split(' ')[0] || 'there', when: whenWords(placedB), town, brand: sign })
    const t = await d.textCaregiver(cg, fill(MSG_CHOSEN, parts(off)))
    if (!t.ok) await d.officeItem({ ...officeCard('chosen', b, `Tell ${name}: chosen for ${b.client_name}, ${b.visit_date}`, `${name} is on ${when(placedB)} (${by === 'family' ? 'the family chose them' : 'first interested'}), but the text to them didn't go (${t.why ?? 'unknown'}). Please call them.`, nowIso), urgency: 'today' })
    for (const x of wasInterested) await d.textCaregiver(String(x.caregiver_axiscare_id), fill(MSG_NOT_CHOSEN, parts(x)))
    await d.event({ actor_kind: by === 'family' ? 'person' : 'system', actor_name: by === 'family' ? (b.requested_by_name ?? 'family') : 'family-offer', via: 'link', verb: 'family_choose_placed', area: 'family_app',
      summary: `${put.name} placed on ${b.client_name} ${b.visit_date} (${by})`, data: { booking_id: b.id, offer_id: off.id, by, others: others.length } })
    return { ok: true, placed: true, name: put.name, message: `${String(put.name).split(' ')[0]} is confirmed for ${whenWords(placedB)}. We've let them know.` }
  }
  return { ok: false, message: unavailable.length ? `${unavailable.join(' and ')} ${unavailable.length > 1 ? 'are' : 'is'} no longer available, so we're still asking. You'll see more here as they say yes.` : "Nobody is interested yet, so we're still asking.", unavailable }
}

/** The family cancelled a Let me choose visit: everyone who said they were interested hears it's no longer needed. */
export async function chooseCancelled(d: ChooseDeps, b: Any) {
  const st = await d.settings(), sign = brandShort(b, st) ?? ''
  for (const x0 of (await d.offers(String(b.id))).filter((y) => y.state === 'interested' || y.state === 'sent')) {
    const x = { ...x0 }
    await d.updateOffer(x.id, { state: 'closed' })
    if (x.state === 'interested') await d.textCaregiver(String(x.caregiver_axiscare_id), fill(MSG_CHOOSE_CANCELLED, { first_name: String(x.caregiver_name ?? '').split(' ')[0] || 'there', when: whenWords(b), brand: sign }))
  }
}
/** The family's quiet hours for the one choose text: 8 AM to 8 PM Central only. */
export const familyWindow = (now: Date) => { const h = Math.floor(central(now).minutes / 60); return h >= 8 && h < 20 }

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
  const out = { live, bookings: 0, texted: 0, refused: 0, failed: 0, held_night: 0, cards: 0, chosen: 0, family_texts: 0, would: [] as Any[], skipped: [] as Any[] }
  let profiled: Set<string> | null = null
  if (!appLive(st)) return { ...out, held: 'the family app is in practice mode, so nothing is offered' }
  if (d.confirmDue && d.tellFamily && st?.family_confirm_text_approved && familyWindow(now)) {
    for (const b of await d.confirmDue()) {
      if (opts.dry) { out.would.push({ booking: b.id, tell_family: true }); continue }
      const fb = brand(brandFor(b.state), st)
      const cg = String(b.caregiver_name ?? 'Your caregiver').split(' ')[0], client = String(b.client_name ?? 'your loved one').split(' ')[0]
      const w = whenWords({ ...b, kind: b.start_time ? 'set' : b.kind })
      let r: { ok: boolean; how?: string; why?: string } = { ok: false, why: 'the visit has no Missouri/Oklahoma state, so no brand to send as' }
      if (fb?.app_host) {
        const sms = fill(MSG_FAMILY_CONFIRMED, { first_name: String(b.requested_by_name ?? '').split(' ')[0] || 'there', brand: fb.short, caregiver: cg, client, when: w, app: fb.app_host })
        const h = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        const html = `<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.6;color:#16283a;max-width:520px"><p>Hi ${h(String(b.requested_by_name ?? '').split(' ')[0] || 'there')},</p>` +
          `<p><b>${h(cg)}</b> will be there for ${h(client)}'s visit on <b>${h(w)}</b>.</p><p>You can see it, and the rest of the visits you booked, in the app at <a href="${h(String(fb.app_url))}">${h(String(fb.app_host))}</a>.</p>` +
          `<p>Questions? Call us at ${h(fb.phone)}.</p><p style="color:#55677a">${h(fb.footer)}</p></div>`
        r = await d.tellFamily(b, sms, { subject: `${cg} is confirmed for ${client}'s visit`, html })
      }
      await d.updateBooking(b.id, { family_confirm_pending: false, family_confirmed_at: nowIso, family_confirm_how: r.ok ? r.how : `not sent: ${r.why}` })
      if (r.ok) out.family_texts++
      else if (r.why !== 'no way to reach them (no Texts OK and no email)') await d.officeItem({ ...officeCard('confirm_tell', b, `Tell the family who's coming: ${b.client_name}`, `${b.caregiver_name ?? 'A caregiver'} is on ${when(b)}, but the message to ${b.requested_by_name ?? 'the family'} didn't go (${r.why}). They can see it in the app; a call may help.`, nowIso), urgency: 'soon' })
    }
  }
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
    // Let me choose: the deadline passed without a choice = the first interested caregiver who is still free gets it;
    // nobody (still) interested = it carries on as Find someone for me (first yes wins), and the 24-hour card works as usual.
    const cs = chooseSettings(st)
    if (b.method === 'choose' && o.live && !opts.dry && b.choose_by && Date.parse(b.choose_by) <= now.getTime()) {
      const r = await placeChosen(d, b, null, 'deadline')
      if (r.ok) { out.chosen++; continue }
      await d.updateBooking(b.id, { method: 'auto' }); b.method = 'auto'
    }
    // THE one automatic family text (her named exception 2026-10-16): once, when caregivers are interested, 8 AM to 8 PM.
    if (b.method === 'choose' && o.live && !opts.dry && !b.family_told_at && cs.familyText && d.textFamily && familyWindow(now) && interestedOf(offers).length) {
      const fb = brand(brandFor(b.state), st)
      const msg = fb?.app_host ? fill(MSG_FAMILY_INTERESTED, { first_name: String(b.requested_by_name ?? '').split(' ')[0] || 'there', brand: fb.short, client: String(b.client_name ?? 'your loved one').split(' ')[0], when: whenWords(b), app: fb.app_host }) : ''
      const t = msg ? await d.textFamily(b, msg) : { ok: false, why: 'no family app for this brand' }
      await d.updateBooking(b.id, { family_told_at: nowIso, ...(t.ok ? {} : { error: `family text: ${t.why}` }) }); b.family_told_at = nowIso
      if (t.ok) out.family_texts++
      else if (t.why !== 'no consent to text') await d.officeItem({ ...officeCard('choose_tell', b, `Tell the family: caregivers are interested (${b.client_name})`, `Caregivers are interested in ${when(b)}, but the text to ${b.requested_by_name ?? 'the family'} didn't go (${t.why}). They can see it in the app; a call may help.`, nowIso), urgency: 'soon' })
    }
    const lines = () => offers.length ? ` Asked so far: ${offers.map((x) => `${x.caregiver_name ?? x.caregiver_axiscare_id} (${x.state === 'sent' ? 'no answer yet' : x.state})`).join(', ')}.` : ''
    if (left <= o.unfilledHours && !b.unfilled_card_at)
      await card(`Nobody has taken this yet: ${b.client_name}, ${b.visit_date}`, `${b.requested_by_name ?? 'The family'} booked ${when(b)} in the app and no caregiver has said yes, with ${Math.round(left)} hours to go.${lines()} Place someone (Scheduling, Family bookings), or call the family.`)
    if (!o.live) { out.would.push({ booking: b.id, stage: b.offer_stage ?? 'picks next' }); continue }
    if (nightHold(now, left, o)) { out.held_night++; continue }
    let town = '', history: Map<string, number> | null = null
    const send = async (c: Candidate, wave: 'picks' | 'team', waveNo: number): Promise<'sent' | 'skip'> => {
      if (b.method === 'choose' && !brandShort(b, st)) { out.skipped.push({ booking: b.id, who: c.name, why: 'the visit has no Missouri/Oklahoma state, so no brand to text as' }); return 'skip' }
      if (b.method === 'choose') {   // her answer 3: only caregivers with a published, consented profile are asked in Let me choose
        profiled = profiled ?? new Set((await d.profiles((roster ?? await d.roster()).map((x) => x.axiscare_id))).filter(shareable).map((p) => String(p.axiscare_id)))
        if (!profiled.has(c.axiscare_id)) { out.skipped.push({ booking: b.id, who: c.name, why: 'no published profile (Let me choose shows profiles)' }); return 'skip' }
      }
      const why = await d.askBlock(c, String(b.client_name ?? ''), needsDrive(b, st))
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
      const tpl = b.method === 'choose' ? String(st?.family_choose_msg || '') || MSG_CHOOSE : wave === 'picks' ? o.msgPick : o.msgTeam
      const msg = tpl.replaceAll('{first_name}', c.first || 'there').replaceAll('{town}', town).replaceAll('{when}', whenWords(b)).replaceAll('{link}', link).replaceAll('{brand}', brandShort(b, st) ?? '')
      const r = await d.sendText(c, msg)
      if (!r.ok) { await d.updateOffer(ins.id, { state: 'failed', error: r.why }); out.failed++; return 'skip' }
      offers.push({ id: ins.id, caregiver_axiscare_id: c.axiscare_id, caregiver_name: c.name, wave, wave_no: waveNo, state: 'sent', sent_at: nowIso })
      out.texted++
      return 'sent'
    }
    if (b.method === 'choose' && interestedOf(offers).length >= cs.max) continue   // enough interested: stop asking
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
      picked: mine ? b.start_time : (off.state === 'interested' ? off.picked_start ?? null : null), mode: b.method === 'choose' ? 'choose' : 'first',
      // her rule 2026-10-16: "if the family has specifically asked for them - nothing there if they weren't specifically asked"
      asked_for_you: Array.isArray(b.preferred_caregiver_ids) && b.preferred_caregiver_ids.map(String).includes(cg),
      // the office's short About for caregivers (first name only; no address or medical detail); empty = no row
      about: d.clientAbout ? await d.clientAbout(String(b.axiscare_client_id)) : null }
  }
  const action = String(body?.action ?? 'view')
  if (action === 'view') return say(200, await view())
  if (action === 'withdraw') {   // Let me choose: "I can't do it after all"
    if (off.state === 'interested' && state === 'open') await d.updateOffer(off.id, { state: 'withdrawn', answered_at: nowIso })
    return say(200, { ok: true, message: 'Got it, the family won\'t see you for this one. Thank you for letting us know.' })
  }
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
  // Let me choose: a yes is INTEREST, not a booking. The family picks; we text them if it's them.
  if (b.method === 'choose') {
    if (off.state === 'interested') return say(200, { ok: true, interested: true, message: "You've already said you're interested. The family is choosing; we'll text you if they pick you." })
    await d.updateOffer(off.id, { state: 'interested', answered_at: nowIso, picked_start: pick })
    await d.event({ actor_kind: 'person', actor_name: off.caregiver_name ?? cg, via: 'link', verb: 'family_offer_interested', area: 'family_app', summary: `${off.caregiver_name} is interested in ${b.client_name} ${b.visit_date}`, data: { booking_id: b.id, offer_id: off.id } })
    return say(200, { ok: true, interested: true, message: "Thank you! The family is choosing. We'll text you if they pick you. You're not on the schedule unless they do." })
  }
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
  await d.updateBooking(b.id, { ...put.vals, status: 'placed', placed_at: nowIso, placed_by: 'caregiver yes (family app offer)', offer_stage: 'done', error: null, family_confirm_pending: true })
  await d.closeItem(`fam_book_${b.id}`, 'family app', `${put.name} said yes and is on the schedule`)
  await d.event({ actor_kind: 'person', actor_name: off.caregiver_name ?? cg, via: 'link', verb: 'family_offer_yes', area: 'family_app', summary: `${put.name} took ${b.client_name} ${b.visit_date}${flex ? ` at ${pick}` : ''}`, data: { booking_id: b.id, offer_id: off.id, placed: true } })
  const end = fromMin(toMin(pick) + Number(b.hours) * 60)
  return say(200, { ok: true, placed: true, message: `You're on it! ${dayWords(b.visit_date)}, ${clock12(pick)} to ${clock12(end)}. It's on your AxisCare schedule now. Thank you!` })
}
