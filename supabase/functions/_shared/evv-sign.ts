// 429 · THE CLIENT SIGNATURE AT THE NEXT VISIT (Samantha, 2026-10-03: "it really needs to be completed at the time of
// the shift that they are asking for a manual correction, or worst case scenario the next time they are with that
// client --- if client doesnt sign we can call the client and verify over the phone").
// -----------------------------------------------------------------------------
// A caregiver who could not get the client's signature at the shift sends her part of the EVV correction form with
// "<client> will sign at my next visit". The form waits (evv_submissions.client_sig_status = 'waiting') and a row in
// public.evv_sign holds a random token: the client-signature page https://sc.mo-care.com/evv-client-sign.html?t=<token>.
//
// timekeeper-watch then, every run:
//   * when that caregiver is AT her next AxisCare visit with that same client (clocked in, 10+ minutes in, not clocked
//     out, the visit not long over, and not 8pm to 7am), sends the CAREGIVER ONE text with the link. Never the client,
//     never the family (feedback-audience-autonomy). Only with ops_settings.evv_next_visit_live === true AND the
//     caregiver texts on (timekeeper_text_live); otherwise it records, once, that it WOULD have texted (practice).
//   * once a day (after 9am), looks 14 days ahead in AxisCare; no visit with that caregiver and client = a Needs
//     Attention item "No upcoming visit with <client>: call <client> to verify". Also an item when the link expires
//     unsigned or the caregiver could not be texted. A PERSON makes the call (Hub: "Verified by phone").
// PRIVACY: the link carries only the token. The page shows the caregiver's completed part read only, and can save
// only the client's signature (evv_sign_submit). This file only decides; the timekeeper sends.
// deno-lint-ignore-file no-explicit-any

export const SIGN_PAGE = 'https://sc.mo-care.com/evv-client-sign.html'
export const SIGN_DAYS = 14
export const SETTLE_MIN = 10         // minutes after her clock-in before the text (she is in and settled)
export const OVER_GRACE_MIN = 30     // a visit still clocked in this long past its scheduled end still counts
export const MAX_TRIES = 3
export const DEFAULT_NEXT_MSG = "Hi {first_name}, it's Caring Companions. While you're with {client} today, please have {client} sign the EVV correction form from {date}: {link}"

export const signUrl = (token: string) => `${SIGN_PAGE}?t=${encodeURIComponent(token)}`

/** "2026-09-30" -> "Wednesday, Sep 30" (no time zone games: it is a calendar date) */
export function dateWords(iso: unknown): string {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return String(iso ?? '')
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' })
}

/** The caregiver's text. A custom wording without {link} still gets the link at the end. */
export function nextVisitMessage(tmpl: string | null | undefined, p: { first: string; client: string; date: string; link: string }): string {
  const t = String(tmpl || '').trim() || DEFAULT_NEXT_MSG
  const out = t.replaceAll('{first_name}', p.first).replaceAll('{client}', p.client).replaceAll('{date}', p.date).replaceAll('{link}', p.link)
  return t.includes('{link}') ? out : `${out} ${p.link}`
}

const dayOf = (v: any) => String(v?.scheduledStartDate ?? v?.startDate ?? '').slice(0, 10)
const sameId = (a: unknown, b: unknown) => a != null && b != null && String(a) !== '' && String(a) === String(b)

/** Visits that count as "the next time she is with that client": same caregiver, same client, not the corrected visit,
    on or after the corrected visit's date (a form with no visit number: strictly after that date). */
export function candidateVisits(sign: any, visits: any[]): any[] {
  const vd = String(sign?.visit_date ?? '')
  return (visits || []).filter((v) => !v?.removed && sameId(v?.caregiver?.id, sign?.caregiver_axiscare_id) && sameId(v?.client?.id, sign?.client_axiscare_id)
      && !sameId(v?.id, sign?.visit_id)
      && (sign?.visit_id ? dayOf(v) >= vd : dayOf(v) > vd))
    .sort((a, b) => String(a?.scheduledStartDate ?? '').localeCompare(String(b?.scheduledStartDate ?? '')))
}

export type Decision = { action: 'send' | 'wait' | 'none'; visit?: any; why: string }
/** Today's visits -> send now, wait, or nothing today. minutesSince(stamp) is the timekeeper's zone-safe clock; night =
    8pm to 7am Central (asking a client to sign in the middle of the night is not "at the visit"; an overnight visit
    still going at 7am gets it then). */
export function decideNextVisit(sign: any, todayVisits: any[], minutesSince: (s: string) => number, night: boolean): Decision {
  let why = 'no visit with this caregiver and client today'
  for (const v of candidateVisits(sign, todayVisits)) {
    if (v?.clockOut?.time) { why = 'today\'s visit is already clocked out'; continue }
    const end = String(v?.scheduledEndDate ?? v?.endDate ?? '')
    const over = minutesSince(end)
    const cin = v?.clockIn?.time ? String(v.clockIn.time) : ''
    if (!cin) {
      if (Number.isFinite(over) && over > 0) { why = 'today\'s visit ended without a clock-in'; continue }
      return { action: 'wait', visit: v, why: 'waiting for her clock-in' }
    }
    if (Number.isFinite(over) && over > OVER_GRACE_MIN) { why = 'today\'s visit is long over'; continue }
    const inFor = minutesSince(cin)
    if (!Number.isFinite(inFor) || inFor < SETTLE_MIN) return { action: 'wait', visit: v, why: `clocked in, the text goes ${SETTLE_MIN} minutes in` }
    if (night) return { action: 'wait', visit: v, why: 'night (8pm to 7am): it goes at 7am if she is still there' }
    return { action: 'send', visit: v, why: 'she is at the visit' }
  }
  return { action: 'none', why }
}

/** The 14-day look ahead: the first upcoming visit with this caregiver and client (or null). todayIso = Chicago date. */
export function upcomingVisit(sign: any, visits: any[], todayIso: string): any | null {
  return candidateVisits(sign, visits).find((v) => dayOf(v) > todayIso || (dayOf(v) === todayIso && !v?.clockOut?.time)) ?? null
}

/** The Needs Attention item (one per form, updated in place). A person calls; nothing contacts the client. */
export function signItem(kind: 'no_visit' | 'expired' | 'not_reached', sign: any, sub: any, extra: { owner: string; now: string; why?: string }) {
  const client = String(sign?.client_display || sub?.client_linked_name || sub?.consumer || 'the client')
  const clientFirst = client.split(' ')[0]
  const cg = String(sub?.caregiver_linked_name || sign?.caregiver_name || sub?.attendant || 'the caregiver')
  const date = dateWords(sub?.visitdate ?? sign?.visit_date)
  const hm = (t: unknown) => { const m = String(t ?? '').match(/^(\d{1,2}):(\d{2})/); if (!m) return ''; const h = +m[1]; return `${(h % 12) || 12}:${m[2]} ${h >= 12 ? 'PM' : 'AM'}` }
  const times = [hm(sub?.new_in), hm(sub?.new_out)].filter(Boolean).join(' to ')
  const title = kind === 'no_visit' ? `No upcoming visit with ${clientFirst}: call ${clientFirst} to verify ${cg}'s EVV correction (${date})`
    : kind === 'expired' ? `EVV correction still not signed by ${clientFirst}: call ${clientFirst} to verify (${cg}, ${date})`
    : `${cg} could not be texted the signature link for ${clientFirst}: call ${clientFirst} to verify (${date})`
  const lead = kind === 'no_visit' ? `${cg} sent the EVV correction form for ${date} without ${clientFirst}'s signature ("${clientFirst} will sign at my next visit"), but AxisCare shows no visit with ${clientFirst} for ${cg} in the next ${SIGN_DAYS} days.`
    : kind === 'expired' ? `The ${SIGN_DAYS}-day signature link for ${cg}'s EVV correction (${date}) ran out and ${clientFirst} has not signed.`
    : `${cg} is at a visit with ${clientFirst} but could not be texted the signature link (${extra.why || 'not reached'}).`
  return {
    id: `ops_evvsig_${String(sub?.id ?? sign?.submission_id)}`, kind: 'staffing_issue', domain: 'scheduling_coverage', status: 'open', urgency: 'normal',
    title, about: cg,
    detail: `${lead} Corrected times on the form: ${times || 'see the form'}. `
      + `Call ${clientFirst} (or the family member who handles the care) and ask them to confirm ${cg} was there ${times || 'at those times'}. `
      + `Then open EVV Corrections in the Hub, find the form under "Forms received", and press "📞 Verified by phone" (or "Client declined to confirm"). `
      + `A person makes the call; nothing contacts the client automatically.`,
    submission_id: String(sub?.id ?? sign?.submission_id), sign_issue: kind,
    owner: extra.owner, owner_name: extra.owner.split('@')[0],
    due: new Date(Date.parse(extra.now) + 24 * 3600 * 1000).toISOString(),
    created_at: extra.now, created_by: 'timekeeper-watch', opened_by: 'timekeeper',
  }
}
