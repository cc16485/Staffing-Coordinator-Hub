// =============================================================================
// shift-offer.ts · THE SHIFT OPPORTUNITY PAGE, pure rules (Samantha, 2026-10-24: "I want this to feel warm, polished, and
// very easy for caregivers to use on their phones"; "I would prefer a secure one-time verification code"; "Keep client
// information minimal, and don't show the street name or address before assignment"; "never promise or change client hours
// without office approval"). The page is one caregiver's view of one ask on one Cara case.
//   before the code: their first name, the day, the time, the hours and the town. Nothing about the client.
//   after the code:  the client's first name, the office's approved About and What they enjoy, what they'd help with,
//                    the care level and required skills, Good to know (pets, smoking), Exact time / Flexible start and
//                    whether a hand-off is allowed. Never: an address or street, a last name, medical details, photos, pay.
//   answers:         full shift · part of it (times inside the shift) · different hours that day · no · a question,
//                    each with an optional note. Saved onto the caregiver's own ask, exactly where a text reply goes, so
//                    the response board, Cara recommends and Confirm all see it. A yes is interest only.
// Pure: everything comes in as arguments (Node tests: shift_page_test.mjs).
// =============================================================================
// deno-lint-ignore-file no-explicit-any
type Any = any
const S = (v: unknown, n = 200) => String(v ?? '').trim().slice(0, n)
const hm = (t: string) => { const m = /^(\d\d):(\d\d)$/.exec(S(t, 5)); return m ? Number(m[1]) * 60 + Number(m[2]) : null }
export const clock12 = (t: string): string => { const m = S(t).match(/^(\d{1,2}):(\d\d)$/); if (!m) return S(t); const h24 = Number(m[1]); const h = h24 % 12 || 12; return `${h}${m[2] === '00' ? '' : ':' + m[2]}${h24 >= 12 ? 'pm' : 'am'}` }
const firstNames = (full: unknown) => { const w = S(full, 80).split(/\s+/).filter(Boolean); return (w.length > 1 ? w.slice(0, -1) : w).join(' ') }
export function span(kase: Any): { from: string; to: string } | null {
  const m = /^(\d\d:\d\d)-(\d\d:\d\d)$/.exec(S(kase?.shift_time, 20)); return m ? { from: m[1], to: m[2] } : null
}
export function hoursOf(kase: Any): number | null {
  const s = span(kase); if (!s) return null
  let d = hm(s.to)! - hm(s.from)!; if (d <= 0) d += 1440
  return Math.round(d / 6) / 10
}
const dayWords = (ymd: string) => { if (!/^\d{4}-\d\d-\d\d$/.test(ymd)) return ymd; return new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }) }

/** Where the page stands. closed = filled, cancelled or closed by the office; ended = the shift has started; gone = the ask
    isn't on the case any more (the office took it back). Only 'open' takes answers. */
export function pageState(kase: Any, ask: Any, chiNowNaive: string): 'open' | 'closed' | 'ended' | 'gone' {
  if (!kase) return 'gone'
  if (!ask || ask.link_revoked) return 'gone'
  if (kase.status !== 'open' || kase.covered_by) return 'closed'
  const s = span(kase)
  if (/^\d{4}-\d\d-\d\d$/.test(S(kase.shift_date, 10)) && s && `${kase.shift_date}T${s.from}` <= S(chiNowNaive, 16)) return 'ended'
  return 'open'
}

/** What anyone holding the link sees (before the code). */
export function preView(kase: Any, ask: Any, state: string): Any {
  const s = span(kase)
  return { state, caregiver_first: S(ask?.name, 80).split(/\s+/)[0] || 'there', prn: ask?.prn === true,
    day: dayWords(S(kase?.shift_date, 10)), time: s ? `${clock12(s.from)} to ${clock12(s.to)}` : '', hours: hoursOf(kase),
    town: S(kase?.client_city, 60) || null, answered: answerSummary(ask) }
}

/** The answer they gave (shown back to them, so they know it landed). */
export function answerSummary(ask: Any): Any {
  if (!ask || ask.answer_channel !== 'page' || !ask.answered_at) return null
  const k = ask.answer_kind
  const what = k === 'full' ? 'Yes, the whole shift' : k === 'part' ? `Yes, part of it: ${clock12(ask.offer_from)} to ${clock12(ask.offer_to)}`
    : k === 'diff' ? `Different hours: ${clock12(ask.offer_from)} to ${clock12(ask.offer_to)}` : k === 'no' ? "No, I can't work" : k === 'question' ? 'A question' : ''
  return { kind: k, what, at: ask.answered_at, note: S(ask.answer_note, 300) || null }
}

/** Pick an illustration from what the client enjoys (our own brand scenes; never a photo). */
export function sceneFor(enjoys: string[]): string {
  const t = (enjoys || []).join(' ').toLowerCase()
  return /garden|flower|plant|bird|outdoor|walk/.test(t) ? 'garden' : /coffee|tea|bak|cook/.test(t) ? 'coffee' : /read|book|puzzle|card|game/.test(t) ? 'porch' : /music|sing|church|hymn/.test(t) ? 'sunrise' : 'porch'
}

/** What the caregiver sees after the code. info = the office-approved client details (shift-offer reads them). */
export function detailsView(kase: Any, ask: Any, state: string, info: { about?: string | null; enjoys?: string[] | null; help?: string[]; needs?: string[]; home?: string[]; level?: number | null; care_line?: string | null }): Any {
  const enjoys = (info.enjoys || []).map((x) => S(x, 40)).filter(Boolean).slice(0, 6)
  return { ...preView(kase, ask, state), client_first: firstNames(kase?.client) || 'the client', about: S(info.about, 400) || null, enjoys,
    help: (info.help || []).slice(0, 10), needs: (info.needs || []).slice(0, 8), home: (info.home || []).slice(0, 5), level: info.level ?? null,
    care_line: S(info.care_line, 160) || null,
    time_flex: kase?.time_flex === 'flexible_start' ? 'flexible_start' : 'exact', flex_minutes: kase?.time_flex === 'flexible_start' ? Number(kase?.flex_minutes) || 60 : null,
    handoff_ok: kase?.handoff_ok === true, scene: sceneFor(enjoys), shift_from: span(kase)?.from ?? null, shift_to: span(kase)?.to ?? null }
}

/** Check an answer from the page. Times are HH:MM, quarter hours. part = inside the shift; diff = any times that day. */
export function checkAnswer(kase: Any, b: Any): { ok: true; ans: Any } | { ok: false; error: string } {
  const kind = S(b?.kind, 10)
  if (!['full', 'part', 'diff', 'no', 'question'].includes(kind)) return { ok: false, error: 'Please pick an answer.' }
  const note = S(b?.note, 300).replace(/\s+/g, ' ')
  if (kind === 'question') { const q = S(b?.question, 500).replace(/\s+/g, ' '); if (q.length < 3) return { ok: false, error: 'Please type your question.' }; return { ok: true, ans: { kind, question: q, note } } }
  if (kind === 'full' || kind === 'no') return { ok: true, ans: { kind, note } }
  const from = S(b?.from, 5), to = S(b?.to, 5), f = hm(from), t = hm(to)
  if (f == null || t == null || f % 15 || t % 15) return { ok: false, error: 'Please pick a start and an end time.' }
  if (t <= f) return { ok: false, error: 'The end time needs to be after the start time.' }
  if (t - f < 60) return { ok: false, error: 'Please offer at least an hour.' }
  if (kind === 'part') {
    const s = span(kase); const sf = s ? hm(s.from)! : null; let st = s ? hm(s.to)! : null
    if (sf != null && st != null && st <= sf) st += 1440
    if (sf == null || st == null) return { ok: false, error: 'This shift has no set times; please choose "different hours".' }
    if (f < sf || t > st) return { ok: false, error: `Part of the shift means times between ${clock12(s!.from)} and ${clock12(s!.to)}.` }
    if (f === sf && t === st) return { ok: true, ans: { kind: 'full', note } }   // all of it is the whole shift
  }
  return { ok: true, ans: { kind, from, to, note } }
}

/** The ask after an answer from the page: the same fields a text reply sets (state, reply, replied_at), plus what they
    chose. The last 10 answers are kept, so a changed answer never hides the earlier one. */
export function applyAnswer(ask: Any, ans: Any, nowIso: string): Any {
  const state = ans.kind === 'no' ? 'no' : ans.kind === 'question' ? 'inquiry' : 'yes'
  const words = ans.kind === 'full' ? 'Yes, I can work the whole shift' : ans.kind === 'part' ? `Yes, but only part of it: ${clock12(ans.from)} to ${clock12(ans.to)}`
    : ans.kind === 'diff' ? `I can work different hours that day: ${clock12(ans.from)} to ${clock12(ans.to)}` : ans.kind === 'no' ? "No, I can't work" : `Question: ${ans.question}`
  const hist = [...(Array.isArray(ask.answer_history) ? ask.answer_history : []), ...(ask.answer_channel === 'page' && ask.answered_at ? [{ kind: ask.answer_kind, from: ask.offer_from ?? null, to: ask.offer_to ?? null, note: ask.answer_note ?? null, at: ask.answered_at }] : [])].slice(-10)
  const out: Any = { ...ask, state, reply: (words + (ans.note ? ` (note: ${ans.note})` : '')).slice(0, 500), replied_at: nowIso, answered_at: nowIso,
    answer_channel: 'page', answer_kind: ans.kind, offer_from: ans.from ?? null, offer_to: ans.to ?? null, answer_note: ans.note || null, answer_history: hist, read_by: 'shift page' }
  delete out.condition   /* the page says exactly which hours; a text's condition no longer applies */
  return out
}
