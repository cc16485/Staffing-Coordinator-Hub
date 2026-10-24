// =============================================================================
// MISSED CLOCK-IN, VERSION 2 (Cara Phase 3; Samantha 2026-10-24: "Yes, build Phase 3 with every switch off. A 'can't come'
// read by AI opens the call-off case right away, but attendance waits for a person to confirm.")
// =============================================================================
// Her rules for all of it: a text reply never counts as arrival (only an AxisCare clock-in, or a person who called the
// client); late arrivals stay visible until verified; "can't come" opens a call-off case at once; a client who can't
// safely be left alone gets urgent office escalation; corrected AxisCare times never erase the alert's history; the
// office still verifies and approves. Each piece has its own switch (ops_settings), all OFF:
//   clockin_here_live       a reply like "I'm here, the app won't work" turns the alert into "Call <client> to confirm
//                           arrival" (it never marks anyone arrived)
//   cant_come_case_live     a SURE "can't come" (a reply, a text or a call read by the running-late watcher) opens a
//                           call-off case on that visit at once; attendance waits for a person (a card asks)
//   late_unsure_live        an UNSURE one ("I'm not sure I can make it") is "Needs clarification: call them", and the
//                           missed clock-in alarm keeps going (it used to stop for any "can't make it")
//   clockin_no_reply_live   at 15 minutes with no clock-in, no reply and no running-late word: one shorter second text
//                           to the caregiver, and the office text says "no clock-in, no reply"
//   clockin_at_risk_live    at 30 minutes the alert becomes "At risk: <client> may be without care: call the client or
//                           open coverage"; a client whose call-in plan says the shift must be covered is urgent from
//                           the first alert, at any hour
//   late_handoff_live       when the next caregiver is late and someone is still on shift before them, a one-tap "can
//                           you stay?" text to the caregiver on shift, sent only when a person taps
//   cft_autoclose_live      a "Call <client> to confirm the times" card closes itself when AxisCare shows the corrected
//                           times (read only); the card keeps what was missing and adds what AxisCare shows now, and
//                           carries a ready note for the AxisCare correction
// Off: everything works exactly as before, and the watcher's answer says what each piece WOULD have done.
// This file is the decisions and the words only.
// =============================================================================
// deno-lint-ignore no-explicit-any
type Any = any
const S = (v: unknown, n = 300) => String(v ?? '').trim().slice(0, n)

/** Her approved wording (plan HfjPEyR52KgAEtpcNFD99A). {late_first}: the caregiver who is late ("until she gets there"
    became the name, so no pronoun is guessed). */
export const SECOND_TEXT = `Hi {first_name}, it's Caring Companions again. We still don't see a clock-in for your {time} shift with {client}. Please clock in, or reply or call (417) 234-8494 if something's wrong.`
export const HANDOFF_TEXT = `Hi {first_name}, {late_first} is running about {minutes} minutes late for {client}. Can you stay until {late_first} gets there? Reply YES or NO.`
export const fillText = (t: string, x: Record<string, string>) => Object.entries(x).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, v), t)

export const live = (st: Any, k: string) => st?.[k] === true

/** 15 minutes, no clock-in, no reply and nothing from the running-late watcher: the second text is due (once). */
export function secondTextDue(l: Any, lateMin: number, hasNotice: boolean): boolean {
  if (!l || l.resolved_at || !l.texted_at || l.second_texted_at || l.no_phone) return false
  if (hasNotice) return false
  if ((Array.isArray(l.replies) ? l.replies : []).length) return false
  return lateMin >= 15
}
/** 30 minutes still unconfirmed: the client is at risk. */
export const atRisk = (lateMin: number) => lateMin >= 30

/** What a caregiver's reply to the missed clock-in text says. "here" = at the client but not clocked in (the app, the
    phone, forgot): never arrival, a person calls the client. */
export type ReplyRead = { kind: 'here' | 'late' | 'cant' | 'unsure' | 'other'; quote: string | null; failed: boolean }
const quoteIn = (q: unknown, said: string) => { const x = S(q, 200); return x && said.includes(x) ? x : null }
export async function readReply(text: string, ctx: { client?: string; time?: string } = {}, send: typeof fetch = fetch): Promise<ReplyRead> {
  const failed: ReplyRead = { kind: 'other', quote: null, failed: true }
  const key = Deno.env.get('ANTHROPIC_API_KEY') || ''
  if (!key || !S(text)) return failed
  try {
    const r = await send('https://api.anthropic.com/v1/messages', { method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 200, temperature: 0,
        system: 'A home-care caregiver was texted: "we don\'t see a clock-in yet for your shift". Read their reply. '
          + '"here": they say they are already at the client (or working) but could not clock in (the app, the phone, forgot, no signal). '
          + '"late": they are on the way or will be late. "cant": they are clearly not coming (calling off, sick, emergency). '
          + '"unsure": they might not come but are not sure ("I\'m not sure I can make it"). "other": anything else or unclear. quote: their own words that show it, copied EXACTLY (under 160 characters), or "". '
          + 'Answer ONLY minified JSON: {"kind":"here"|"late"|"cant"|"unsure"|"other","quote":"..."}',
        messages: [{ role: 'user', content: `Shift: ${S(ctx.time, 20)} with ${S(ctx.client, 40)}.\nReply: ${S(text, 600)}` }] }) })
    if (!r.ok) return failed
    const j = await r.json().catch(() => null)
    const m = String(j?.content?.[0]?.text ?? '').match(/\{[\s\S]*\}/); if (!m) return failed
    const a = JSON.parse(m[0])
    const kind = ['here', 'late', 'cant', 'unsure'].includes(a.kind) ? a.kind : 'other'
    return { kind, quote: kind === 'other' ? null : quoteIn(a.quote, text), failed: false }
  } catch { return failed }
}

/** The caregiver on shift right before a late one, with the same client: their visit ends within 20 minutes of the late
    visit's start, they clocked in, and haven't clocked out. null = nobody to ask. */
export function handoffFrom(visits: Any[], late: Any, msOf: (s: string) => number): Any | null {
  const start = msOf(S(late?.scheduledStartDate ?? late?.startDate, 40)); if (!Number.isFinite(start)) return null
  const cl = S(late?.client?.id, 20), lateCg = S(late?.caregiver?.id, 20)
  const hit = (visits || []).filter((v) => v && v.removed !== true && S(v?.client?.id, 20) === cl && v?.caregiver?.id != null && S(v.caregiver.id, 20) !== lateCg
    && v?.clockIn?.time && !v?.clockOut?.time && Math.abs(msOf(S(v?.scheduledEndDate ?? v?.endDate, 40)) - start) <= 20 * 60000)
  return hit.sort((a, b) => msOf(S(b?.scheduledEndDate ?? b?.endDate, 40)) - msOf(S(a?.scheduledEndDate ?? a?.endDate, 40)))[0] ?? null
}

/** After a fix: does AxisCare now show what the card was missing? */
export function fixedInAxis(card: Any, visit: Any): boolean {
  if (!visit || visit.removed === true) return false
  const m = S(card?.missing)
  const hasIn = !!visit?.clockIn?.time, hasOut = !!visit?.clockOut?.time
  return m === 'in' ? hasIn : m === 'out' ? hasOut : m === 'both' ? hasIn && hasOut : false
}
/** The note the office pastes into AxisCare with the correction (the times come from the client's call). */
export function noteDraft(card: Any): string {
  const cg = S(card?.caregiver, 80).split(/\s+/)[0] || 'the caregiver'
  const what = S(card?.missing) === 'in' ? 'clock-in' : S(card?.missing) === 'out' ? 'clock-out' : 'clock-in and clock-out'
  return `Missed ${what}. Times confirmed by phone with ${S(card?.client_first, 40) || 'the client'} on {date}: ${cg} arrived {time in}, left {time out}. Confirmed by {your name}.`
}

/** A coverage case opened from the caregiver's own words ("can't come"): attendance waits for a person to confirm. */
export function cantComeCase(x: { visit_id: string; client: string; client_axiscare_id: string | null; shift_date: string; shift_time: string;
  caregiver: string; caregiver_axiscare_id: string | null; quote: string | null; source: 'reply' | 'running_late'; now: string }) {
  return {
    id: 'cwc_' + x.visit_id.replace(/[^A-Za-z0-9]/g, '_').slice(-80), client: x.client, client_axiscare_id: x.client_axiscare_id,
    axiscare_visit_id: x.visit_id, shift_date: x.shift_date, shift_time: x.shift_time, reason: 'call_off',
    calling_off: x.caregiver, calling_off_id: x.caregiver_axiscare_id, status: 'open', asked: [],
    opened_at: x.now, opened_by: 'caregiver-words', attendance_confirm: true, said: x.quote,
    note: `Opened by Cara from ${x.caregiver}'s own words${x.source === 'reply' ? ' (their reply to the missed clock-in text)' : ' (read by the running-late watcher)'}`
      + (x.quote ? `: "${x.quote}"` : '') + '. Attendance waits for a person to confirm it was a call-off.',
    resolved_at: null, resolved_how: null, covered_by: null,
  }
}

/* ── LATE HAND-OFF (late_handoff_live): the caregiver on shift before a late one, and the one-tap "can you stay?" ── */
const AXV = '2023-10-01'
function axisCreds() {
  let token = ''
  for (const n of ['AXISCARE_VISITS_TOKEN', 'AXISCARE_API_KEY', 'AXISCARE_TOKEN']) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  return { token, site: /^\d+$/.test(site) ? site : '' }
}
/** Read today's visits for the client (AxisCare, GET) and find who is on shift right before the late visit. */
export async function findHandoff(x: { visit_id: string; client_axiscare_id: string | null; shift_date: string }, msOf: (s: string) => number,
  send: typeof fetch = fetch): Promise<{ visit: Any; caregiver_id: string; name: string; first: string } | null> {
  const { token, site } = axisCreds(); if (!token || !site || !x.client_axiscare_id) return null
  try {
    const r = await send(`https://${site}.axiscare.com/api/visits?clientIds=${encodeURIComponent(x.client_axiscare_id)}&startDate=${x.shift_date}&endDate=${x.shift_date}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-AxisCare-Api-Version': AXV } })
    if (!r.ok) return null
    const j = await r.json().catch(() => ({}))
    const list = Array.isArray(j?.results?.visits) ? j.results.visits : Object.values(j?.results?.visits ?? {})
    const late = (list as Any[]).find((v) => String(v?.id) === x.visit_id); if (!late) return null
    const h = handoffFrom(list as Any[], late, msOf); if (!h) return null
    const name = [h.caregiver.firstName, h.caregiver.lastName].map((y: unknown) => S(y, 40)).filter(Boolean).join(' ')
    return { visit: h, caregiver_id: S(h.caregiver.id, 20), name, first: S(h.caregiver.firstName, 40) || name.split(' ')[0] }
  } catch { return null }
}
/** The "can you stay?" text: about {minutes} only when a time was given (never a guess). */
export function handoffText(t: string, x: { first: string; late_first: string; client: string; minutes: number | null }): string {
  const base = x.minutes != null && x.minutes > 0 ? t : t.replace(' about {minutes} minutes', '')
  return fillText(base, { first_name: x.first, late_first: x.late_first, client: x.client, minutes: String(x.minutes ?? '') })
}
