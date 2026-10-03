// =============================================================================
// late-watch — RUNNING LATE (L0 the look, 2026-09-29; L1 the job, 2026-09-29 "build L1 now")
// =============================================================================
// L1 · THE JOB (every 5 minutes, the jobs' schedule or the owner's key; ?dry=1 records and sends nothing):
//   1. Every caregiver with a shift starting within the look-back (default 2 hours) or started with no clock-in yet
//      (up to 90 minutes): their texts to the office in that window, and their calls' transcripts when GoHighLevel has
//      one. A message is read once. The AI reads everything they sent for that shift: running late / can't make it /
//      something else, and the time they expect to arrive. It never guesses a time.
//   2. A late notice per visit (late_notices). PRACTICE until ops_settings.late_watch_live: recorded, with what WOULD
//      have gone (caregiver, admins, family), and nothing else happens. Live: a "Running late" card in Needs Attention,
//      and the missed clock-in watcher holds off for them (_shared/late-notice.ts lateHold).
//   3. Live + late_cg_reply_live: the caregiver gets one thank-you with their time, or one "About what time...?" (and
//      a thank-you once they give one). "Can't make it" gets no automatic reply; a person calls.
//   4. Live + late_admin_live: every admin (the call-in alert list) is texted their own link now, and again every 5
//      minutes until someone taps Seen. When they clock in, one last text says so.
//   5. The family is NEVER texted from here (her decision 1: a person taps "Send to the family" on the page or card;
//      automatic only after a practice week and her word). Practice records what that text would have said.
//   Closes itself: clocked in, the visit changed, a coverage case has the shift, or the day ended.
// 432 (Samantha, 2026-10-03, her call to Mary: "she said she is running late and will be to Aprils in 8 minutes"; "yes
//   build it"): CALLS both ways. A call the office MADE to the caregiver (outbound, answered) is read too, not only calls
//   she made to us, and so is a caregiver whose missed clock-in alert is still open past the usual 90 minutes. The
//   caregiver is found by her phone number on the roster (the GoHighLevel contact with exactly that number), never by a
//   name. A call with no transcript yet is tried again on the next runs, for 30 minutes after the call; when calls never
//   get one, the run says call transcription may be off in GoHighLevel. The notice records the call: when, who in the
//   office was on it, and the caregiver's own words (a quote the AI copied, kept only if it is really in the transcript).
//   While the notices are in practice, a call's notice is live by itself (ops_settings.late_call_live, ON unless she
//   turns it off): a card in Needs Attention, the call noted on the missed clock-in card, and (late WITH a time only)
//   the missed clock-in admin texts pause until 5 minutes after that time. Nothing is texted because of a call. The
//   family only ever hears from a person's tap (her standing rule, confirmed again 2026-10-03: one tap, permanently).
// Samantha approved the Running late plan ("yes to all"): when a caregiver texts or calls to say they're running
// late, the Hub notices, works out when they expect to arrive, texts the admins until someone taps Seen, and (per her
// decision 1) the Family Circle hears the time, one tap first, automatic only after a practice week and her word.
//
// L0 is this file: a READ-ONLY look at the last 14 days before anything is built, to see how often it happens and
// whether the AI reads the messages right. The owner's server key only.
//   ?l0=1&days=14&offset=0&limit=6   caregivers with shifts, a few at a time (GoHighLevel reads are the slow part):
//        for each shift, their texts and calls to the office from 2 hours before the start until they clocked in
//        (or 90 minutes after the start); the AI reads the texts: running late / can't make it / something else, and
//        the time they expected to arrive; compared with when they actually clocked in.
//   ?circles=1                        clients with shifts in the window: how many have a linked Family Circle with
//        at least one member who could get the text (the same rule as the caregiver-change text).
// L0 · COUNTS ONLY: never a message's words, a name, a phone number or an id. Every AxisCare and GoHighLevel call is a
// GET; nothing is written anywhere; nothing is sent. The messages' words go only to the AI (Anthropic agreement
// signed) and are not kept. L1 builds the real job on this file.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jobCaller } from '../_shared/job-auth.ts'
import { visitMs } from '../_shared/held-shift.ts'
import { contactForOutbound } from '../_shared/outreach.ts'
import { adminRecipients, textAdmin } from '../_shared/clockin-admins.ts'
import { ghlSendChecked } from '../_shared/send-problems.ts'
import { makeLink, linkExpiry } from '../_shared/late-links.ts'
import { eligibleMembers } from '../_shared/family-change-text.ts'
import { DEFAULT_THANKS, DEFAULT_ASK, DEFAULT_FAMILY, FAMILY_MIN_DEFAULT, fill, clockAt, familyEligible, callLine, callLive, holdUntil, holdOptsOf } from '../_shared/late-notice.ts'
import { officeQuiet, quietWords } from '../_shared/quiet-hours.ts'

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
const AC_VERSION = '2023-10-01'
const GHL = 'https://services.leadconnectorhq.com'
export const BEFORE_MIN = 120, AFTER_MIN = 90, CALL_WAIT_MIN = 30
const MIN = 60e3
// deno-lint-ignore no-explicit-any
const rowsOf = (x: any): any[] => Array.isArray(x) ? x : (x && typeof x === 'object' ? Object.values(x) : [])
const chiDay = (t: number) => new Date(t).toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
export const chiClock = (t: number) => new Date(t).toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' })
const digits10 = (p: unknown) => { const d = String(p ?? '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : '' }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function axis() {
  let token = ''
  for (const n of ['AXISCARE_API_KEY', 'AXISCARE_TOKEN', 'AXISCARE_VISITS_TOKEN']) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  return { ok: !!token && /^\d+$/.test(site), base: `https://${site}.axiscare.com`,
    head: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-AxisCare-Api-Version': AC_VERSION } as Record<string, string> }
}

export type Shift = { cg: string; cl: string; start: number; clockIn: number | null }
/* Every assigned visit in the window that has started, as real instants. */
export async function listShifts(days: number, now = Date.now()): Promise<{ shifts: Shift[]; error?: string }> {
  const { ok, base, head } = axis(); if (!ok) return { shifts: [], error: 'AxisCare credentials not set on this project' }
  const shifts: Shift[] = []
  let url: string | null = `${base}/api/visits?startDate=${chiDay(now - days * 864e5)}&endDate=${chiDay(now)}`
  for (let page = 0; url && page < 40; page++) {
    const r: Response = await fetch(url, { headers: head })
    if (!r.ok) return { shifts: [], error: 'the visit list answered ' + r.status }
    // deno-lint-ignore no-explicit-any
    const j: any = await r.json().catch(() => ({}))
    for (const v of rowsOf(j?.results?.visits)) {
      if (!v || v.removed || v?.caregiver?.id == null || v?.client?.id == null) continue
      const start = visitMs(v?.scheduledStartDate ?? v?.startDate)
      if (!Number.isFinite(start) || start > now) continue
      const ci = v?.clockIn?.time ? visitMs(v.clockIn.time) : NaN
      shifts.push({ cg: String(v.caregiver.id), cl: String(v.client.id), start, clockIn: Number.isFinite(ci) ? ci : null })
    }
    url = j?.results?.nextPage ?? j?.nextPage ?? null
  }
  return { shifts }
}

/* The window a message can belong to: from 2 hours before the start until they clocked in (or 90 minutes after the
   start when they never did). A message inside two windows (back-to-back shifts) belongs to the nearer start. */
export function windowOf(s: Shift): [number, number] {
  return [s.start - BEFORE_MIN * MIN, s.clockIn != null ? Math.max(s.clockIn, s.start) : s.start + AFTER_MIN * MIN]
}
export function assign<T extends { at: number }>(shifts: Shift[], msgs: T[]): Map<Shift, T[]> {
  const out = new Map<Shift, T[]>()
  for (const m of msgs) {
    let best: Shift | null = null
    for (const s of shifts) {
      const [a, b] = windowOf(s)
      if (m.at < a || m.at > b) continue
      if (!best || Math.abs(s.start - m.at) < Math.abs(best.start - m.at)) best = s
    }
    if (best) { const arr = out.get(best) ?? []; arr.push(m); out.set(best, arr) }
  }
  return out
}

/* ── the AI reads their texts for one shift ── */
export type Reading = { kind: 'late' | 'cant_make_it' | 'other'; eta: number | null; sure: boolean; failed: boolean; quote?: string | null }
/* 432: a quote is kept only when it is really in what they said (the AI copies; it must never put words in a mouth). */
const squash = (x: unknown) => String(x ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
export const quoteIn = (quote: unknown, said: string): string | null => {
  const q = String(quote ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
  return q.length >= 4 && squash(said).includes(squash(q)) && squash(q).length >= 4 ? q : null
}
/* "HH:MM" (24-hour, Central) on the shift's Central day, as an instant. Nonsense times come back null. */
export function etaOn(hhmm: string, shiftStart: number): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? '').trim()); if (!m || +m[1] > 23 || +m[2] > 59) return null
  const t = visitMs(`${chiDay(shiftStart)}T${m[1].padStart(2, '0')}:${m[2]}:00`)
  if (!Number.isFinite(t) || t < shiftStart - BEFORE_MIN * MIN || t > shiftStart + 8 * 60 * MIN) return null
  return t
}
export async function readLate(shiftStart: number, texts: { at: number; body: string }[]): Promise<Reading> {
  const failed: Reading = { kind: 'other', eta: null, sure: false, failed: true, quote: null }
  const key = Deno.env.get('ANTHROPIC_API_KEY') || ''
  if (!key || !texts.length) return failed
  const lines = texts.map((t) => `[${chiClock(t.at)}] ${t.body.slice(0, t.body.startsWith('(phone call)') ? 2500 : 600)}`).join('\n')
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 260, temperature: 0,
        system: 'You read texts a home-care caregiver sent the office around one shift. The shift starts at the time given. '
          + 'Decide what the texts say about THIS shift: "late" (they will be there but late), "cant_make_it" (they are not '
          + 'coming: calling off, sick, emergency), or "other" (anything else: questions, confirmations, on the way on time, '
          + 'unrelated). If late, give the time they expect to arrive as 24-hour HH:MM: "15 min late" means the start plus '
          + '15; "10 min out" or "be there in 10" means the text\'s own time plus 10; a clock time they give is that time. '
          + 'No time given = "". sure is false when the texts are unclear. '
          + 'A line starting "(phone call)" is the transcript of a phone call between the office and the caregiver, both '
          + 'sides, maybe labelled Speaker 1 / Speaker 2: only what the CAREGIVER says about their own arrival counts (never '
          + 'the office person\'s guesses or questions), and "in 8 minutes" on a call means the call\'s own time plus 8. '
          + 'quote: the caregiver\'s own words that say they are late or not coming, copied EXACTLY from the text or transcript '
          + '(under 160 characters), or "" when there are none. Answer ONLY minified JSON: '
          + '{"kind":"late"|"cant_make_it"|"other","eta":"HH:MM" or "","sure":bool,"quote":"..."}',
        messages: [{ role: 'user', content: `Shift starts ${chiClock(shiftStart)}.\nTexts (with the time each was sent):\n${lines}`.slice(0, 8000) }] }) })
    if (!r.ok) return failed
    const j = await r.json().catch(() => null)
    const m = String(j?.content?.[0]?.text ?? '').match(/\{[\s\S]*\}/); if (!m) return failed
    const a = JSON.parse(m[0])
    const kind = a.kind === 'late' || a.kind === 'cant_make_it' ? a.kind : 'other'
    return { kind, eta: kind === 'late' ? etaOn(String(a.eta ?? ''), shiftStart) : null, sure: a.sure === true, failed: false,
      quote: kind === 'other' ? null : quoteIn(a.quote, texts.map((t) => t.body).join('\n')) }
  } catch { return failed }
}

/* ── GoHighLevel, read only: find the contact by phone, then their texts and calls since a time ── */
type Msg = { at: number; kind: 'text' | 'call'; body: string; id: string; dir?: 'in' | 'out'; userId?: string; tried?: boolean; secs?: number | null }
/* A call's words, when GoHighLevel transcribed it (its "transcription" read). Anything else: no words. */
// deno-lint-ignore no-explicit-any
export function transcriptText(j: any): string {
  // deno-lint-ignore no-explicit-any
  const arr: any[] = Array.isArray(j) ? j : Array.isArray(j?.transcription) ? j.transcription : Array.isArray(j?.sentences) ? j.sentences : []
  if (arr.length) return arr.map((x) => String(x?.transcript ?? x?.text ?? '').trim()).filter(Boolean).join(' ').slice(0, 3000)
  return String(j?.transcript ?? j?.text ?? '').trim().slice(0, 3000)
}
// deno-lint-ignore no-explicit-any
async function ghlGet(url: string, h: Record<string, string>): Promise<any> {
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(url, { headers: h })
      if (r.status === 429) { await sleep(2000); continue }
      if (!r.ok) return null
      return await r.json().catch(() => null)
    } catch { return null }
  }
  return null
}
export async function inboundSince(phone: string, since: number, opts: { transcripts?: boolean; skip?: Set<string>; outboundCalls?: boolean } = {}): Promise<{ found: boolean; msgs: Msg[]; contactId?: string }> {
  const token = Deno.env.get('GHL_TOKEN') ?? '', loc = Deno.env.get('GHL_LOCATION_ID') ?? ''
  const h = { Authorization: `Bearer ${token}`, Version: '2021-07-28', Accept: 'application/json' }
  let cid = ''
  for (const url of [`${GHL}/contacts/lookup?locationId=${encodeURIComponent(loc)}&phone=${encodeURIComponent('+1' + phone)}`,
                     `${GHL}/contacts/?locationId=${encodeURIComponent(loc)}&query=${encodeURIComponent(phone)}&limit=20`]) {
    const j = await ghlGet(url, h)
    // deno-lint-ignore no-explicit-any
    const list: any[] = j?.contacts ?? (j?.contact ? [j.contact] : [])
    const hit = list.find((c) => digits10(c?.phone) === phone)           /* an exact number, never the first result */
    if (hit?.id) { cid = String(hit.id); break }
  }
  if (!cid) return { found: false, msgs: [] }
  const msgs: Msg[] = []
  const cj = await ghlGet(`${GHL}/conversations/search?locationId=${encodeURIComponent(loc)}&contactId=${encodeURIComponent(cid)}&limit=10`, h)
  for (const cv of (cj?.conversations ?? []).slice(0, 5)) {
    let last = ''
    for (let page = 0; page < 6; page++) {
      const mj = await ghlGet(`${GHL}/conversations/${encodeURIComponent(cv.id)}/messages?limit=100${last ? '&lastMessageId=' + encodeURIComponent(last) : ''}`, h)
      // deno-lint-ignore no-explicit-any
      const arr: any[] = mj?.messages?.messages ?? mj?.messages ?? []
      if (!Array.isArray(arr) || !arr.length) break
      let older = false
      for (const x of arr) {
        const at = Date.parse(String(x?.dateAdded ?? ''))
        if (!Number.isFinite(at)) continue
        if (at < since) { older = true; continue }
        const t = String(x?.messageType ?? '')
        const id = String(x?.id ?? '')
        /* 432: a call the OFFICE made to them (answered) counts too; their texts are only ever the ones they sent */
        const outCall = opts.outboundCalls === true && x?.direction === 'outbound' && (t === 'TYPE_CALL' || (!t && Number(x?.type) === 3))
          && !(x?.meta?.call?.duration != null && Number(x.meta.call.duration) <= 0)
        if (x?.direction !== 'inbound' && !outCall) continue
        if (t === 'TYPE_SMS' || (!t && Number(x?.type) === 1)) { const body = String(x?.body ?? '').trim(); if (body) msgs.push({ at, kind: 'text', body, id }) }
        else if (t === 'TYPE_CALL' || t === 'TYPE_VOICEMAIL' || [3, 4, 5, 25].includes(Number(x?.type))) {
          let body = '', tried = false
          if (opts.transcripts && id && !opts.skip?.has(id)) {
            tried = true
            body = transcriptText(await ghlGet(`${GHL}/conversations/locations/${encodeURIComponent(loc)}/messages/${encodeURIComponent(id)}/transcription`, h))
          }
          const secs = x?.meta?.call?.duration != null && Number.isFinite(Number(x.meta.call.duration)) ? Number(x.meta.call.duration) : null
          msgs.push({ at, kind: 'call', body, id, dir: outCall ? 'out' : 'in', userId: x?.userId ? String(x.userId) : undefined, tried, secs })
        }
      }
      const nextId = String(arr[arr.length - 1]?.id ?? '')
      if (older || !mj?.messages?.nextPage || !nextId || nextId === last) break
      last = nextId
    }
  }
  return { found: true, msgs, contactId: cid }
}

const add = (o: Record<string, number>, k: string, n = 1) => { o[k] = (o[k] ?? 0) + n }
const lateBucket = (s: Shift) => s.clockIn == null ? 'no_clock_in' : (s.clockIn - s.start) / MIN <= 5 ? 'on_time' : (s.clockIn - s.start) / MIN < 10 ? 'late_6_9' : (s.clockIn - s.start) / MIN < 30 ? 'late_10_29' : 'late_30_plus'

// deno-lint-ignore no-explicit-any
export async function l0(db: any, days: number, offset: number, limit: number, now = Date.now()) {
  const { shifts, error } = await listShifts(days, now)
  if (error) return { error }
  const { data: rosterRow } = await db.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const roster: any[] = Array.isArray(rosterRow?.data) ? rosterRow!.data : []
  const phoneOf = new Map<string, string>()
  for (const g of roster) { const id = String(g?.axiscare_id ?? '').trim(), p = digits10(g?.phone); if (id && p && !phoneOf.has(id)) phoneOf.set(id, p) }
  const byCg = new Map<string, Shift[]>()
  for (const s of shifts) { const a = byCg.get(s.cg) ?? []; a.push(s); byCg.set(s.cg, a) }
  const cgs = [...byCg.keys()].sort()
  const slice = cgs.slice(offset, offset + limit)
  const c: Record<string, number> = {}
  const since = now - days * 864e5 - BEFORE_MIN * MIN
  for (const cg of slice) {
    const mine = byCg.get(cg)!.sort((a, b) => a.start - b.start)
    add(c, 'caregivers')
    for (const s of mine) { add(c, 'shifts'); add(c, 'shifts_' + lateBucket(s)) }
    const phone = phoneOf.get(cg)
    if (!phone) { add(c, 'caregivers_no_phone_on_roster'); add(c, 'shifts_caregiver_no_phone', mine.length); continue }
    const { found, msgs } = await inboundSince(phone, since)
    if (!found) { add(c, 'caregivers_not_in_ghl'); add(c, 'shifts_caregiver_not_in_ghl', mine.length); continue }
    add(c, 'caregivers_read'); add(c, 'texts_read', msgs.filter((m) => m.kind === 'text').length)
    const per = assign(mine, msgs)
    for (const s of mine) {
      const got = per.get(s) ?? []
      const texts = got.filter((m) => m.kind === 'text'), calls = got.filter((m) => m.kind === 'call')
      const bucket = lateBucket(s), late10 = bucket === 'late_10_29' || bucket === 'late_30_plus'
      if (texts.length) add(c, 'shifts_with_text')
      if (calls.length) add(c, 'shifts_with_call')
      if (late10) add(c, 'late10_total')
      if (late10 && got.length) add(c, 'late10_heads_up_text_or_call')
      if (bucket === 'no_clock_in' && got.length) add(c, 'no_clock_in_heads_up_text_or_call')
      if (!texts.length) continue
      const rd = await readLate(s.start, texts)
      if (rd.failed) { add(c, 'ai_failed'); continue }
      add(c, 'ai_' + rd.kind)
      if (!rd.sure) add(c, 'ai_unsure')
      if (rd.kind === 'late') {
        add(c, rd.eta != null ? 'ai_late_with_time' : 'ai_late_no_time')
        add(c, 'ai_late_then_' + bucket)
        if (late10) add(c, 'late10_ai_said_late')
        const before = texts.some((t) => t.at <= s.start)
        add(c, before ? 'ai_late_told_before_start' : 'ai_late_told_after_start')
        if (rd.eta != null && s.clockIn != null) {
          const d = (s.clockIn - rd.eta) / MIN
          add(c, d < -5 ? 'eta_arrived_earlier_than_said' : d <= 5 ? 'eta_within_5_min' : d <= 15 ? 'eta_6_15_min_after' : 'eta_16_plus_min_after')
        }
        if (rd.eta != null && (rd.eta - s.start) / MIN >= 10) add(c, 'ai_late_eta_10_plus')
      }
      if (rd.kind === 'cant_make_it') add(c, 'ai_cant_make_it_then_' + bucket)
      await sleep(Number(Deno.env.get('LATE_WATCH_PAUSE_MS') ?? '200'))
    }
  }
  return { window: `${chiDay(now - days * 864e5)} to ${chiDay(now)}`, caregivers_total: cgs.length, offset, slice_size: slice.length,
    next_offset: offset + slice.length < cgs.length ? offset + slice.length : null, counts: c }
}

/* The same members the caregiver-change text may reach (her decision 3): _shared/family-change-text.ts eligibleMembers. */
// deno-lint-ignore no-explicit-any
export const eligible = (m: any) => eligibleMembers([m]).length === 1
// deno-lint-ignore no-explicit-any
export async function circles(db: any, days: number, now = Date.now()) {
  const { shifts, error } = await listShifts(days, now)
  if (error) return { error }
  const clients = [...new Set(shifts.map((s) => s.cl))]
  const c: Record<string, number> = { clients_with_shifts: clients.length }
  const { data: circs } = await db.from('care_circles').select('id, axiscare_client_id').eq('active', true)
  const byAx = new Map<string, string[]>()
  for (const x of circs ?? []) { const k = String(x?.axiscare_client_id ?? '').trim(); if (!k) continue; const a = byAx.get(k) ?? []; a.push(String(x.id)); byAx.set(k, a) }
  const { data: mem } = await db.from('circle_contacts').select('circle_id, sms_consent, wants_changes, stopped_at, axiscare_removed_at, phone')
  const good = new Map<string, number>()
  for (const m of mem ?? []) if (eligible(m)) good.set(String(m.circle_id), (good.get(String(m.circle_id)) ?? 0) + 1)
  for (const cl of clients) {
    const ids = byAx.get(cl) ?? []
    if (!ids.length) { add(c, 'no_linked_circle'); continue }
    if (ids.length > 1) { add(c, 'two_linked_circles'); continue }
    add(c, 'one_linked_circle')
    const n = good.get(ids[0]) ?? 0
    if (n) { add(c, 'circle_has_member_who_can_get_it'); add(c, 'members_who_can_get_it', n) } else add(c, 'circle_but_nobody_agreed_to_texts')
  }
  return { window: `${chiDay(now - days * 864e5)} to ${chiDay(now)}`, counts: c }
}


/* ═════════════════════════════ L1 · the job ═════════════════════════════ */
const firstOf = (n: unknown) => String(n ?? '').trim().split(/\s+/)[0] || ''
// deno-lint-ignore no-explicit-any
type Visit = { id: string; cg: string; cl: string; start: number; end: number; clockIn: number | null; cgName: string; clientFirst: string; raw: any }
async function listVisits(fromDay: string, toDay: string): Promise<{ visits: Visit[]; error?: string }> {
  const { ok, base, head } = axis(); if (!ok) return { visits: [], error: 'AxisCare credentials not set on this project' }
  const visits: Visit[] = []
  let url: string | null = `${base}/api/visits?startDate=${fromDay}&endDate=${toDay}`
  for (let page = 0; url && page < 20; page++) {
    const r: Response = await fetch(url, { headers: head })
    if (!r.ok) return { visits: [], error: 'the visit list answered ' + r.status }
    // deno-lint-ignore no-explicit-any
    const j: any = await r.json().catch(() => ({}))
    for (const v of rowsOf(j?.results?.visits)) {
      if (!v || v.removed || v?.caregiver?.id == null || v?.client?.id == null) continue
      const start = visitMs(v?.scheduledStartDate ?? v?.startDate); if (!Number.isFinite(start)) continue
      const end = visitMs(v?.scheduledEndDate ?? v?.endDate)
      const ci = v?.clockIn?.time ? visitMs(v.clockIn.time) : NaN
      visits.push({ id: String(v.id), cg: String(v.caregiver.id), cl: String(v.client.id), start, end: Number.isFinite(end) ? end : start + 4 * 3600e3,
        clockIn: Number.isFinite(ci) ? ci : null, raw: v,
        cgName: [v.caregiver.firstName, v.caregiver.lastName].map((x: unknown) => String(x ?? '').trim()).filter(Boolean).join(' '),
        clientFirst: firstOf(v?.client?.firstName) })
    }
    url = j?.results?.nextPage ?? j?.nextPage ?? null
  }
  return { visits }
}
/* Which of their shifts a message is about; ambiguous when it falls inside two shifts' windows. */
/* 432: a shift whose missed clock-in alert is still open stays theirs until they clock in (openUntilClockIn). */
export function placeOf(shifts: Shift[], at: number, lookMin: number, openUntilClockIn?: (s: Shift) => boolean): { shift: Shift | null; ambiguous: boolean } {
  const hits = shifts.filter((s) => { const a = s.start - lookMin * MIN, b = s.clockIn != null ? Math.max(s.clockIn, s.start) : (openUntilClockIn?.(s) ? Infinity : s.start + AFTER_MIN * MIN); return at >= a && at <= b })
  if (!hits.length) return { shift: null, ambiguous: false }
  hits.sort((x, y) => Math.abs(x.start - at) - Math.abs(y.start - at))
  return { shift: hits[0], ambiguous: hits.length > 1 }
}

// deno-lint-ignore no-explicit-any
export async function run(db: any, opts: { dry?: boolean; now?: number } = {}) {
  const now = opts.now ?? Date.now(), nowIso = new Date(now).toISOString(), dry = !!opts.dry
  const { data: stRow } = await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const st: any = stRow?.data ?? {}
  const live = st.late_watch_live === true && !dry
  const cgLive = live && st.late_cg_reply_live === true
  const adminLive = live && st.late_admin_live === true
  const lookMin = Number(st.late_lookback_min) >= 30 && Number(st.late_lookback_min) <= 360 ? Number(st.late_lookback_min) : BEFORE_MIN
  const famMin = Number(st.late_family_min) >= 0 && Number(st.late_family_min) <= 120 ? Number(st.late_family_min) : FAMILY_MIN_DEFAULT
  const repeatMin = Number(st.late_admin_repeat_min) >= 2 ? Number(st.late_admin_repeat_min) : 5
  /* 432: a call's notice is live by itself while the notices are in practice (late_call_live, ON unless switched off) */
  const callsLive = callLive(st) && !dry
  const out = { live, dry, caregivers_watched: 0, messages_new: 0, read: 0, ai_failed: 0, notices_new: 0, notices_changed: 0,
    cg_texts: 0, admin_texts: 0, closed: 0, no_phone: 0, not_in_ghl: 0, would: 0,
    office_quiet: false as string | false, admin_held_quiet: 0,
    calls_live: callsLive, calls_read: 0, calls_waiting_transcript: 0, calls_no_transcript: 0, transcripts: '' as string, missed_clockin_notes: 0 }

  const { visits, error } = await listVisits(chiDay(now - 12 * 3600e3), chiDay(now + lookMin * MIN))
  if (error) return { error }
  const byId = new Map(visits.map((v) => [v.id, v]))
  const { data: rosterRow } = await db.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const roster: any[] = Array.isArray(rosterRow?.data) ? rosterRow!.data : []
  // deno-lint-ignore no-explicit-any
  const rosterOf = (ax: string) => roster.find((g: any) => String(g?.axiscare_id ?? '').trim() === ax && g?.active !== false)
  const { data: stateRow } = await db.from('app_data').select('data').eq('key', 'late_watch_state').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const state: any = (Array.isArray(stateRow?.data) ? stateRow!.data.find((x: any) => x?.id === 'state') : null) ?? { id: 'state', read: {} }
  const readIds: Record<string, number> = state.read ?? {}
  for (const k of Object.keys(readIds)) if (now - readIds[k] > 3 * 864e5) delete readIds[k]
  /* 432: calls still waiting for GoHighLevel's transcript (tried again for CALL_WAIT_MIN after the call, then left), and
     the office people's names behind GoHighLevel user ids */
  const gaveUp: Record<string, number> = state.no_transcript ?? {}
  for (const k of Object.keys(gaveUp)) if (now - gaveUp[k] > 3 * 864e5) delete gaveUp[k]
  const users: Record<string, { name: string; email: string; at: number }> = state.users ?? {}
  const day = chiDay(now)
  const tday: { day: string; got: number; none: number } = state.transcripts?.day === day ? state.transcripts : { day, got: 0, none: 0 }
  const ghlH = { Authorization: `Bearer ${Deno.env.get('GHL_TOKEN') ?? ''}`, Version: '2021-07-28', Accept: 'application/json' }
  const userOf = async (id?: string): Promise<{ name: string; email: string } | null> => {
    if (!id) return null
    const c = users[id]; if (c && now - c.at < 7 * 864e5) return c.name || c.email ? c : null
    const j = await ghlGet(`${GHL}/users/${encodeURIComponent(id)}`, ghlH)
    const name = String(j?.name || [j?.firstName, j?.lastName].filter(Boolean).join(' ') || '').trim(), email = String(j?.email || '').trim().toLowerCase()
    users[id] = { name, email, at: now }
    return name || email ? { name, email } : null
  }
  /* 432: open missed clock-in alerts (timekeeper-watch): their shift stays watched until they clock in */
  const { data: tkRow } = await db.from('app_data').select('data').eq('key', 'timekeeper_cases').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const openAlert = new Map<string, any>()
  // deno-lint-ignore no-explicit-any
  for (const l of (Array.isArray(tkRow?.data) ? tkRow!.data : []) as any[]) if (l && l.kind !== 'clock_out' && !l.resolved_at && l.visit_id != null) openAlert.set(String(l.visit_id), l)

  /* 1 · read: caregivers with a shift in the window and no clock-in */
  const watched = visits.filter((v) => v.clockIn == null && ((now >= v.start - lookMin * MIN && now <= v.start + AFTER_MIN * MIN) || openAlert.has(v.id)))
  const cgs = [...new Set(watched.map((v) => v.cg))].slice(0, 30)
  // deno-lint-ignore no-explicit-any
  const { data: existingRows } = await db.from('late_notices').select('*').gte('shift_date', chiDay(now - 864e5))
  // deno-lint-ignore no-explicit-any
  const noticeByVisit = new Map<string, any>((existingRows ?? []).map((r: any) => [String(r.visit_id), r]))
  for (const cg of cgs) {
    out.caregivers_watched++
    const g = rosterOf(cg), phone = digits10(g?.phone)
    if (!phone) { out.no_phone++; continue }
    const mine = visits.filter((v) => v.cg === cg).map((v) => ({ cg: v.cg, cl: v.cl, start: v.start, clockIn: v.clockIn, _v: v }))
    const since = Math.min(...watched.filter((v) => v.cg === cg).map((v) => v.start - lookMin * MIN))
    const { found, msgs, contactId } = await inboundSince(phone, since, { transcripts: true, outboundCalls: true, skip: new Set(Object.keys(gaveUp)) })
    if (!found) { out.not_in_ghl++; continue }
    const per = new Map<Shift, { m: Msg; amb: boolean }[]>()
    // deno-lint-ignore no-explicit-any
    const openShift = (s: Shift) => openAlert.has(String((s as any)._v?.id))
    for (const m of msgs) {
      if (m.kind === 'call' && !m.body) {
        /* no transcript (yet): GoHighLevel may still be writing it. Tried again next run, for CALL_WAIT_MIN */
        if (m.tried && !readIds[m.id]) {
          if (now - m.at > CALL_WAIT_MIN * MIN) { if (!dry) gaveUp[m.id] = now; if (m.secs !== 0) { out.calls_no_transcript++; tday.none++ } }
          else out.calls_waiting_transcript++
        }
        continue
      }
      if (m.kind === 'call' && !readIds[m.id]) { out.calls_read++; tday.got++ }
      const p = placeOf(mine, m.at, lookMin, openShift)
      if (!p.shift) continue
      const arr = per.get(p.shift) ?? []; arr.push({ m, amb: p.ambiguous }); per.set(p.shift, arr)
    }
    for (const [sh, got] of per) {
      // deno-lint-ignore no-explicit-any
      const v = (sh as any)._v as Visit
      if (v.clockIn != null) continue
      const fresh = got.filter((x) => !readIds[x.m.id])
      if (!fresh.length) continue
      out.messages_new += fresh.length
      got.sort((a, b) => a.m.at - b.m.at)
      const rd = await readLate(v.start, got.map((x) => ({ at: x.m.at, body: (x.m.kind === 'call' ? '(phone call) ' : '') + x.m.body })))
      if (rd.failed) { out.ai_failed++; continue }                 /* read again next run */
      out.read++
      if (!dry) for (const x of fresh) readIds[x.m.id] = now
      const prev = noticeByVisit.get(v.id)
      if (rd.kind === 'other' && !prev) continue
      const said = got.map((x) => ({ at: new Date(x.m.at).toISOString(), channel: x.m.kind, text: x.m.body.slice(0, 1000), ...(x.m.kind === 'call' ? { dir: x.m.dir || 'in' } : {}) }))
      const newest = new Date(Math.max(...fresh.map((x) => x.m.at))).toISOString()
      const sure = rd.sure && !got.some((x) => x.amb)
      /* 432: the newest call in what was read: when, which way, who in the office was on it, her own words */
      const lastCall = got.filter((x) => x.m.kind === 'call').map((x) => x.m).at(-1)
      // deno-lint-ignore no-explicit-any
      let callMeta: any = {}
      if (lastCall) {
        const u = await userOf(lastCall.userId)
        callMeta = { source: 'call', call_at: new Date(lastCall.at).toISOString(), call_message_id: lastCall.id, call_direction: lastCall.dir || 'in',
          call_by: u?.name || null, call_by_email: u?.email || null, call_quote: quoteIn(rd.quote, lastCall.body) ?? (prev?.call_message_id === lastCall.id ? prev?.call_quote ?? null : null) }
      }
      const callNow = !!lastCall && callsLive
      if (!prev) {
        if (rd.kind === 'other') continue
        const row = { visit_id: v.id, axiscare_caregiver_id: v.cg, axiscare_client_id: v.cl, caregiver_name: v.cgName || [g?.first, g?.last].filter(Boolean).join(' '),
          client_first: v.clientFirst || null, shift_date: chiDay(v.start), shift_start: new Date(v.start).toISOString(), kind: rd.kind,
          status: live || callNow ? 'open' : 'practice', said, said_at: newest, eta: rd.eta != null ? new Date(rd.eta).toISOString() : null,
          eta_by: rd.eta != null ? 'ai' : null, sure, ghl_contact_id: contactId ?? null, ...(lastCall ? callMeta : { source: 'text' }) }
        if (dry) { out.notices_new++; continue }
        const { data: ins } = await db.from('late_notices').insert(row).select('*').maybeSingle()
        if (ins) { noticeByVisit.set(v.id, ins); out.notices_new++ }
      } else {
        if (prev.status === 'closed') continue
        // deno-lint-ignore no-explicit-any
        const up: any = { said, said_at: newest, sure, updated_at: nowIso, ...callMeta }
        if (rd.kind !== 'other' && rd.kind !== prev.kind) up.kind = rd.kind
        /* 432: a call about a shift that was only in practice makes it live (late_call_live) */
        if (prev.status === 'practice' && callNow) up.status = 'open'
        /* a new time from the caregiver replaces the AI's last one; a time a PERSON set stays until the caregiver gives
           a newer one than that person saw */
        if (rd.eta != null && new Date(rd.eta).toISOString() !== prev.eta) {
          const personSet = prev.eta_by && prev.eta_by !== 'ai'
          if (!personSet || Date.parse(newest) > Date.parse(prev.updated_at ?? prev.said_at ?? 0)) { up.eta = new Date(rd.eta).toISOString(); up.eta_by = 'ai' }
        }
        if (dry) { out.notices_changed++; continue }
        await db.from('late_notices').update(up).eq('id', prev.id)
        Object.assign(prev, up); out.notices_changed++
      }
    }
  }
  /* 432: calls never getting a transcript: say so (GoHighLevel's call transcription may be off) */
  if (tday.none >= 2 && tday.got === 0)
    out.transcripts = `No transcript from GoHighLevel for ${tday.none} answered call(s) with caregivers today, ${CALL_WAIT_MIN} minutes or more after the call. Call transcription may be off in GoHighLevel (or not on this number), so calls can't be read for running late.`
  else if (out.calls_no_transcript) out.transcripts = `${out.calls_no_transcript} call(s) still had no transcript ${CALL_WAIT_MIN} minutes after the call; left unread.`
  if (!dry) await db.rpc('upsert_app_data_item', { target_key: 'late_watch_state', item: { id: 'state', read: readIds, no_transcript: gaveUp, users, transcripts: tday, at: nowIso } })

  /* 2 · every notice from today: what happens next */
  const ghl = { token: Deno.env.get('GHL_TOKEN') ?? '', locationId: Deno.env.get('GHL_LOCATION_ID') ?? '' }
  const admins = await adminRecipients(db, st)
  /* OFFICE QUIET HOURS (2026-10-03): no admin text 8pm to 7am Central. The Needs Attention card is still kept up to
     date; the admin rounds are skipped (nothing recorded, nothing queued), so from 7am one round goes if nobody has
     tapped Seen. The caregiver's own thank-you is not affected. */
  const quiet = officeQuiet(new Date(now), st)
  out.office_quiet = quiet ? quietWords(st) : false
  const SECRET = Deno.env.get('HUB_JOB_SECRET') || ''
  const { data: ccRow } = await db.from('app_data').select('data').eq('key', 'coverage_cases').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const openCases = (Array.isArray(ccRow?.data) ? ccRow!.data : []).filter((c: any) => c?.status === 'open' && c?.kind !== 'interest')
  /* NO SILENT FAILURES (2026-10-01): a caregiver text GoHighLevel refuses raises a card on Needs Attention (it is
     still not stamped, so the next run tries again, exactly as before). The admin texts go through textAdmin, which
     raises its own. */
  const sendSms = (contactId: string, message: string, to: { address?: unknown; who?: unknown } = {}) =>
    ghlSendChecked(db, { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
      'late-watch', { channel: 'sms', contactId, address: to.address, who: to.who }, { message })
  // deno-lint-ignore no-explicit-any
  const wouldPush = (n: any, w: { to: string; key: string; text: string; count?: number }) => {
    const list = Array.isArray(n.would) ? n.would : []
    if (list.some((x: { key: string }) => x.key === w.key)) return null
    out.would++
    return [...list, { at: nowIso, ...w }].slice(-20)
  }
  if (dry) return { ok: true, ...out }
  /* The Needs Attention card: written only when what it says changes, merged over what staff added to it. */
  const { data: opsRow } = await db.from('app_data').select('data').eq('key', 'ops_items').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const opsNow = new Map<string, any>((Array.isArray(opsRow?.data) ? opsRow!.data : []).map((x: any) => [String(x?.id), x]))
  // deno-lint-ignore no-explicit-any
  const putCard = async (item: any) => {
    const had = opsNow.get(item.id)
    if (had && had.title === item.title && had.detail === item.detail && had.status === item.status) return
    const merged = { ...(had ?? {}), ...item }
    if (had?.status === 'done' && item.status === 'open' && had.title === item.title) return   /* staff closed it and nothing new */
    await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item: merged }); opsNow.set(item.id, merged)
  }
  /* 432 · NO SILENT FAILURES: calls that never get a transcript can't be read; one card a day says so */
  if (tday.none >= 2 && tday.got === 0 && out.transcripts)
    await putCard({ id: 'ops_late_transcripts_' + day, kind: 'late_notice', domain: 'scheduling_coverage', status: 'open', urgency: 'today',
      title: 'Call transcripts are not coming from GoHighLevel', about: 'Running late',
      detail: out.transcripts + ' Texts are still read. Check GoHighLevel: Settings, Phone numbers, call recording and transcription on the office line.',
      created_at: nowIso, created_by: 'late-watch', opened_by: 'late-watch' })
  const hOpts = holdOptsOf(st)
  for (const n of noticeByVisit.values()) {
    if (!n || n.status === 'closed' || n.closed_at) continue
    const v = byId.get(String(n.visit_id))
    const startMs = Date.parse(n.shift_start)
    const cgFirst = firstOf(n.caregiver_name) || 'the caregiver', t12 = clockAt(startMs)
    const what = `${n.caregiver_name || 'A caregiver'} for ${n.client_first || 'a client'}'s ${t12} shift`
    // deno-lint-ignore no-explicit-any
    const close = async (how: string, final: string | null, extra: any = {}) => {
      await db.from('late_notices').update({ status: n.status === 'practice' ? 'practice' : 'closed', closed_at: nowIso, closed_how: how, updated_at: nowIso, ...extra }).eq('id', n.id)
      out.closed++
      if (n.status === 'practice') return
      if (final && adminLive && !quiet && Array.isArray(n.admin_rounds) && n.admin_rounds.length) for (const a of admins) if (await textAdmin(db, ghl, a, final)) out.admin_texts++
      const told = (Array.isArray(n.family) ? n.family : []).some((f: { what: string }) => f.what === 'late' || f.what === 'update')
      const arrivedSent = (Array.isArray(n.family) ? n.family : []).some((f: { what: string }) => f.what === 'arrived')
      const keep = how === 'clocked_in' && told && !arrivedSent
      await putCard({ id: 'ops_late_' + n.id, kind: 'late_notice', domain: 'scheduling_coverage',
        status: keep ? 'open' : 'resolved', urgency: keep ? 'today' : 'high', late_notice_id: n.id, caregiver: n.caregiver_name || '', about: n.caregiver_name || '',
        title: keep ? `Tell the family: ${cgFirst} arrived at ${n.client_first}'s` : `Closed: ${what} (${how === 'clocked_in' ? 'clocked in' : how.replace(/_/g, ' ')})`,
        detail: keep ? `${cgFirst} clocked in. ${n.client_first}'s family was told ${cgFirst} was running late; tap "Tell the family ${cgFirst} arrived" to close the loop, or mark it done.` : (final || 'Closed.'),
        created_at: n.created_at, ...(keep ? {} : { resolved_at: nowIso }), created_by: 'late-watch', opened_by: 'late-watch' })
    }
    if (!v || v.cg !== String(n.axiscare_caregiver_id)) { await close('visit_changed', `${n.client_first}'s ${t12} shift changed in AxisCare (${n.caregiver_name} is no longer on it). No more running-late texts.`); continue }
    if (v.clockIn != null) { await close('clocked_in', `${cgFirst} clocked in at ${n.client_first}'s at ${clockAt(v.clockIn)}.`, { clock_in_at: new Date(v.clockIn).toISOString() }); continue }
    // deno-lint-ignore no-explicit-any
    const cc = openCases.find((c: any) => String(c.axiscare_visit_id ?? '') === String(n.visit_id))
    if (cc) { await close('coverage_case', `A coverage case has ${n.client_first}'s ${t12} shift now (${n.caregiver_name}). No more running-late texts.`, { coverage_case_id: String(cc.id) }); continue }
    if (now > startMs + 12 * 3600e3) { await close('day_ended', null); continue }

    const g = rosterOf(String(n.axiscare_caregiver_id)), phone = digits10(g?.phone)
    const first = String(g?.first ?? '') || cgFirst
    const etaTxt = n.eta ? clockAt(Date.parse(n.eta)) : ''
    const lastSaid = (Array.isArray(n.said) ? n.said : []).at(-1)
    /* 432: a call reads "Mary said on Krystal's 4:31pm call: running late, about 8 minutes (around 4:39pm)" + her words */
    const cLine = lastSaid?.channel === 'call' && n.call_at ? callLine(n) : ''
    const saidTxt = cLine ? cLine.replace(/\.$/, '') + (n.call_quote ? `. Word for word: "${String(n.call_quote).replace(/\s+/g, ' ').slice(0, 160)}"` : '')
      : lastSaid ? `${cgFirst} ${lastSaid.channel === 'call' ? 'called' : 'texted'} at ${clockAt(Date.parse(lastSaid.at))}: "${String(lastSaid.text).replace(/\s+/g, ' ').slice(0, 140)}${String(lastSaid.text).length > 140 ? '...' : ''}"` : ''
    // deno-lint-ignore no-explicit-any
    const up: any = {}

    /* the caregiver: one thank-you with their time, or one question (late only) */
    if (n.kind === 'late' && !n.thanked_at && (n.eta || !n.asked_time_at)) {
      const text = fill(n.eta ? String(st.late_msg_thanks || DEFAULT_THANKS) : String(st.late_msg_ask || DEFAULT_ASK), { first_name: first, client: n.client_first || 'your client', eta: etaTxt })
      const key = n.eta ? 'cg_thanks' : 'cg_ask'
      if (n.status !== 'practice' && cgLive && phone) {
        const contact = await contactForOutbound(db, ghl, { phone, firstName: first }, 'urgent_internal', { audience: 'caregiver', channel: 'sms', sender: 'late-watch' })
        if (contact && await sendSms(contact.contactId, text, { address: phone, who: n.caregiver_name || cgFirst })) { up[n.eta ? 'thanked_at' : 'asked_time_at'] = nowIso; out.cg_texts++ }
      } else { const w = wouldPush(n, { to: 'caregiver', key, text }); if (w) { up.would = w; n.would = w } }
    }

    /* the admins: now, then every few minutes until someone taps Seen */
    if (!n.seen_at && quiet) out.admin_held_quiet++
    if (!n.seen_at && !quiet) {
      const rounds = Array.isArray(n.admin_rounds) ? n.admin_rounds : []
      const due = !n.admin_last_at || now - Date.parse(n.admin_last_at) >= repeatMin * MIN - 20e3
      const lead = n.kind === 'cant_make_it' ? `Can't make it: ${what}.` : `${rounds.length ? 'Still not seen. ' : ''}Running late: ${what}.`
      const tail = n.kind === 'cant_make_it' ? 'Tap to see it and open a coverage case:' : (etaTxt ? `Expected about ${etaTxt}.` : 'No arrival time given yet.') + ' Tap when you\'ve seen it:'
      const msg = (link: string) => `${lead} ${saidTxt}${saidTxt ? '. ' : ''}${tail} ${link}`.replace(/\s+/g, ' ').trim()
      if (n.status !== 'practice' && adminLive && due) {
        let sent = 0
        for (const a of admins) {
          const link = SECRET ? await makeLink(SECRET, 'ln_' + n.id, a.email, linkExpiry(String(n.shift_date))) : ''
          if (await textAdmin(db, ghl, a, msg(link))) sent++
        }
        up.admin_rounds = [...rounds, { at: nowIso, admins: sent }].slice(-40); up.admin_last_at = nowIso; out.admin_texts += sent
      } else if (n.status === 'practice' || !adminLive) {
        const w = wouldPush(n, { to: 'admins', key: 'admins_' + (n.kind) + '_' + (etaTxt || 'none'), text: msg('[their link]'), count: admins.length })
        if (w) { up.would = w; n.would = w }
      }
    }

    /* practice: what the family text would have said (a person would tap it; never automatic) */
    if (n.status === 'practice') {
      const fe = familyEligible(n, famMin)
      if (fe.ok) {
        const { data: circs } = await db.from('care_circles').select('id').eq('active', true).eq('axiscare_client_id', String(n.axiscare_client_id ?? ''))
        let count = 0
        if (circs && circs.length === 1) { const { data: mem } = await db.from('circle_contacts').select('*').eq('circle_id', circs[0].id); count = eligibleMembers(mem ?? []).length }
        const text = fill(String(st.late_msg_family || DEFAULT_FAMILY), { caregiver: cgFirst, client: n.client_first || 'your loved one', time: t12, eta: etaTxt })
        const w = wouldPush(n, { to: 'family', key: 'family_' + etaTxt, text: count ? text : `(nobody to tell: ${circs?.length === 1 ? 'no circle member has agreed to texts' : circs?.length ? 'two linked circles' : 'no linked Family Circle'})`, count })
        if (w) { up.would = w; n.would = w }
      }
    }

    /* 432 · the missed clock-in card says what the call said, and whether its admin texts are paused (and until when) */
    const tkAlert = openAlert.get(String(n.visit_id))
    if (n.status !== 'practice' && n.call_at && tkAlert) {
      const itemId = `ops_tk_${tkAlert.id}`, had = opsNow.get(itemId)
      const until = holdUntil(n, startMs, hOpts)
      const note = callLine(n) + (n.call_quote ? ` "${String(n.call_quote).replace(/\s+/g, ' ').slice(0, 160)}"` : '')
        + (until != null && now < until ? ` The missed clock-in texts to the admins are paused until ${clockAt(until)} and start again then if there's still no clock-in.`
          : until != null ? ` The missed clock-in texts were paused until ${clockAt(until)}; still no clock-in, so they started again.`
          : n.kind === 'cant_make_it' ? ' Open a coverage case from the alert link if the shift needs covering.' : '')
      if (had && had.status === 'open' && had.late_call_note !== note) {
        const merged = { ...had, late_call_note: note, late_notice_id: n.id }
        await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item: merged }); opsNow.set(itemId, merged); out.missed_clockin_notes++
      }
    }

    /* the Needs Attention card (live) */
    if (n.status !== 'practice') {
      const fe = familyEligible(n, famMin)
      await putCard({ id: 'ops_late_' + n.id, kind: 'late_notice', domain: 'scheduling_coverage',
        status: 'open', urgency: n.seen_at ? 'today' : 'high', late_notice_id: n.id, caregiver: n.caregiver_name || '', about: n.caregiver_name || '',
        title: n.kind === 'cant_make_it' ? `Can't make it: ${what}` : `Running late: ${what}${etaTxt ? ', about ' + etaTxt : ''}`,
        detail: `${saidTxt}${saidTxt ? '. ' : ''}${n.kind === 'late' ? (etaTxt ? `Expected about ${etaTxt}.` : 'No arrival time yet.') : 'Open a coverage case if the shift needs covering.'}`
          + (n.seen_at ? ` Seen by ${n.seen_by}.` : '') + (n.kind === 'late' && !fe.ok ? ` Family: ${fe.why}.` : ''),
        created_at: n.created_at, created_by: 'late-watch', opened_by: 'late-watch' })
    }
    if (Object.keys(up).length) { up.updated_at = nowIso; await db.from('late_notices').update(up).eq('id', n.id) }
  }
  await db.from('late_notices').delete().eq('status', 'practice').lt('created_at', new Date(now - 7 * 864e5).toISOString())
  try { await db.rpc('upsert_app_data_item', { target_key: 'automation_heartbeats', item: { id: 'hb_late-watch', automation: 'late-watch', at: nowIso, ok: true, note: JSON.stringify(out).slice(0, 300) } }) } catch { /* never blocks */ }
  return { ok: true, ...out }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok')
  const q = new URL(req.url).searchParams
  const caller = await jobCaller(req)
  if (!caller) return json({ error: 'not allowed' }, 401)
  if (q.get('auth_check') === '1') return json({ ok: true, caller })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const days = Math.min(Math.max(Number(q.get('days')) || 14, 1), 21)
  /* the L0 looks: the owner's key only */
  if (q.get('l0') === '1' || q.get('circles') === '1') {
    if (caller !== 'owner') return json({ error: 'not allowed' }, 401)
    if (q.get('l0') === '1') return json(await l0(db, days, Math.max(Number(q.get('offset')) || 0, 0), Math.min(Math.max(Number(q.get('limit')) || 6, 1), 20)))
    return json(await circles(db, days))
  }
  return json(await run(db, { dry: q.get('dry') === '1' }))
})
