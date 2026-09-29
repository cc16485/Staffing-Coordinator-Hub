// =============================================================================
// late-watch — RUNNING LATE, L0: the look first (2026-09-29)
// =============================================================================
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
// COUNTS ONLY: never a message's words, a name, a phone number or an id. Every AxisCare and GoHighLevel call is a
// GET; nothing is written anywhere; nothing is sent. The messages' words go only to the AI (Anthropic agreement
// signed) and are not kept. L1 builds the real job on this file.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jobCaller } from '../_shared/job-auth.ts'
import { visitMs } from '../_shared/held-shift.ts'

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
const AC_VERSION = '2023-10-01'
const GHL = 'https://services.leadconnectorhq.com'
export const BEFORE_MIN = 120, AFTER_MIN = 90
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
export type Reading = { kind: 'late' | 'cant_make_it' | 'other'; eta: number | null; sure: boolean; failed: boolean }
/* "HH:MM" (24-hour, Central) on the shift's Central day, as an instant. Nonsense times come back null. */
export function etaOn(hhmm: string, shiftStart: number): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? '').trim()); if (!m || +m[1] > 23 || +m[2] > 59) return null
  const t = visitMs(`${chiDay(shiftStart)}T${m[1].padStart(2, '0')}:${m[2]}:00`)
  if (!Number.isFinite(t) || t < shiftStart - BEFORE_MIN * MIN || t > shiftStart + 8 * 60 * MIN) return null
  return t
}
export async function readLate(shiftStart: number, texts: { at: number; body: string }[]): Promise<Reading> {
  const failed: Reading = { kind: 'other', eta: null, sure: false, failed: true }
  const key = Deno.env.get('ANTHROPIC_API_KEY') || ''
  if (!key || !texts.length) return failed
  const lines = texts.map((t) => `[${chiClock(t.at)}] ${t.body.slice(0, 600)}`).join('\n')
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 150, temperature: 0,
        system: 'You read texts a home-care caregiver sent the office around one shift. The shift starts at the time given. '
          + 'Decide what the texts say about THIS shift: "late" (they will be there but late), "cant_make_it" (they are not '
          + 'coming: calling off, sick, emergency), or "other" (anything else: questions, confirmations, on the way on time, '
          + 'unrelated). If late, give the time they expect to arrive as 24-hour HH:MM: "15 min late" means the start plus '
          + '15; "10 min out" or "be there in 10" means the text\'s own time plus 10; a clock time they give is that time. '
          + 'No time given = "". sure is false when the texts are unclear. Answer ONLY minified JSON: '
          + '{"kind":"late"|"cant_make_it"|"other","eta":"HH:MM" or "","sure":bool}',
        messages: [{ role: 'user', content: `Shift starts ${chiClock(shiftStart)}.\nTexts (with the time each was sent):\n${lines}`.slice(0, 5000) }] }) })
    if (!r.ok) return failed
    const j = await r.json().catch(() => null)
    const m = String(j?.content?.[0]?.text ?? '').match(/\{[\s\S]*\}/); if (!m) return failed
    const a = JSON.parse(m[0])
    const kind = a.kind === 'late' || a.kind === 'cant_make_it' ? a.kind : 'other'
    return { kind, eta: kind === 'late' ? etaOn(String(a.eta ?? ''), shiftStart) : null, sure: a.sure === true, failed: false }
  } catch { return failed }
}

/* ── GoHighLevel, read only: find the contact by phone, then their texts and calls since a time ── */
type Msg = { at: number; kind: 'text' | 'call'; body: string }
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
export async function inboundSince(phone: string, since: number): Promise<{ found: boolean; msgs: Msg[] }> {
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
        if (x?.direction !== 'inbound') continue
        const t = String(x?.messageType ?? '')
        if (t === 'TYPE_SMS' || (!t && Number(x?.type) === 1)) { const body = String(x?.body ?? '').trim(); if (body) msgs.push({ at, kind: 'text', body }) }
        else if (t === 'TYPE_CALL' || t === 'TYPE_VOICEMAIL' || [3, 4, 5, 25].includes(Number(x?.type))) msgs.push({ at, kind: 'call', body: '' })
      }
      const nextId = String(arr[arr.length - 1]?.id ?? '')
      if (older || !mj?.messages?.nextPage || !nextId || nextId === last) break
      last = nextId
    }
  }
  return { found: true, msgs }
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

/* The same members the caregiver-change text may reach (_shared/family-change-text.ts eligibleMembers), copied here
   so this read-only look imports no sender. */
// deno-lint-ignore no-explicit-any
export const eligible = (m: any) => m && m.sms_consent === true && m.wants_changes !== false && !m.stopped_at && !m.axiscare_removed_at
  && String(m.phone || '').replace(/\D/g, '').length >= 10
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok')
  if ((await jobCaller(req, false)) !== 'owner') return json({ error: 'not allowed' }, 401)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const q = new URL(req.url).searchParams
  const days = Math.min(Math.max(Number(q.get('days')) || 14, 1), 21)
  if (q.get('l0') === '1') return json(await l0(db, days, Math.max(Number(q.get('offset')) || 0, 0), Math.min(Math.max(Number(q.get('limit')) || 6, 1), 20)))
  if (q.get('circles') === '1') return json(await circles(db, days))
  return json({ error: 'unknown request' }, 400)
})
