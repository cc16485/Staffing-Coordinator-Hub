// =============================================================================
// open-hours — one message to the whole team about a set of recurring hours, and the AI that sorts the answers
// =============================================================================
// Her ask (2026-10-12): "we just need a way to send message to all caregivers about a set of recurring shifts, would
// love to put out there Monday-Saturday 8am-5pm but could be split 8am-noon and noon-5pm and then have the ai help put
// the answers into three boxes: yellow is questions, red is no, green is yes but also organize which days".
// Her decisions ("yes to all", same day): town only (no client name, no address), no pay, a short thank-you to a YES
// only, texts 9am to 6pm Central, everyone eligible gets it (busy people too; the grid shows they're busy).
//
// The hours come from a Team Builder plan (staffing_plans): days ['mon'..'sun'] and slots [{k, label, start, end}].
// A grid square is "day|slotKey", the same key the plan's cells use, so a YES lands on the plan's own squares.
// =============================================================================

// deno-lint-ignore no-explicit-any
type Any = any

export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const DAY_NAMES: Record<string, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' }

/* 08:00 -> 8am, 12:00 -> noon, 17:30 -> 5:30pm */
export function clock(t: string): string {
  const m = /^(\d{1,2}):(\d\d)$/.exec(String(t || '').trim()); if (!m) return String(t || '')
  const h = Number(m[1]); if (h === 12 && m[2] === '00') return 'noon'
  if (h === 0 && m[2] === '00') return 'midnight'
  return `${h % 12 || 12}${m[2] === '00' ? '' : ':' + m[2]}${h >= 12 ? 'pm' : 'am'}`
}

/* ['mon'..'sat'] -> "Monday to Saturday"; ['mon','wed','fri'] -> "Monday, Wednesday and Friday" */
export function daysWords(days: string[]): string {
  const ds = DAY_KEYS.filter((d) => (days || []).map((x) => String(x).toLowerCase().slice(0, 3)).includes(d))
  if (!ds.length) return ''
  const idx = ds.map((d) => DAY_KEYS.indexOf(d))
  const run = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1)
  if (run && ds.length >= 3) return `${DAY_NAMES[ds[0]]} to ${DAY_NAMES[ds[ds.length - 1]]}`
  const names = ds.map((d) => DAY_NAMES[d])
  return names.length === 1 ? names[0] : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]
}

export type Slot = { k: string; label?: string; start: string; end: string }
export const slotWords = (s: Slot) => `${clock(s.start)} to ${clock(s.end)}`
/* "8am to noon and noon to 5pm" */
export function timesWords(slots: Slot[]): string {
  const w = (slots || []).filter((s) => s && s.start && s.end).map(slotWords)
  return w.length <= 1 ? (w[0] || '') : w.slice(0, -1).join(', ') + ' and ' + w[w.length - 1]
}

/* Every grid square the message offers, with words the AI and the office both read. */
export function offeredCells(days: string[], slots: Slot[]): { key: string; words: string }[] {
  const ds = DAY_KEYS.filter((d) => (days || []).map((x) => String(x).toLowerCase().slice(0, 3)).includes(d))
  const out: { key: string; words: string }[] = []
  for (const d of ds) for (const s of (slots || [])) if (s && s.k && s.start && s.end) out.push({ key: `${d}|${s.k}`, words: `${DAY_NAMES[d]} ${slotWords(s)}` })
  return out
}

/* The office's default wording (Settings can replace it: open_hours_msg). {first_name} stays for each person;
   {town} {days} {times} are filled from the plan. No client name, no address, no pay (her decisions). */
export const OPEN_HOURS_DEFAULT =
  'Hi {first_name}, it\'s Caring Companions. We have regular hours open in {town}: {days}, {times}. {choice}'
  + 'Interested? Reply with the days and times that work for you, or NO if not. Questions welcome.'
export function openHoursText(tmpl: string, x: { town: string; days: string[]; slots: Slot[] }): string {
  const choice = (x.slots || []).length > 1 ? 'You can take some of the days, or just some of the hours. ' : 'You can take some of the days. '
  return String(tmpl || OPEN_HOURS_DEFAULT)
    .replaceAll('{town}', String(x.town || '').trim() || 'our area')
    .replaceAll('{days}', daysWords(x.days))
    .replaceAll('{times}', timesWords(x.slots))
    .replaceAll('{choice}', choice)
    .replace(/[ \t]{2,}/g, ' ').trim()
}
/* What the office may send: their own words, {first_name} the only blank left, no em dash, one long text at most. */
export function checkWording(t: string): string | null {
  const s = String(t || '').trim()
  if (!s) return 'the text is empty'
  if (s.length > 600) return 'the text is too long (600 characters is already a 4-part text)'
  if (s.includes('—')) return 'caregiver texts never carry an em dash (use a comma or a period)'
  const left = (s.match(/\{[^}]*\}/g) || []).filter((b) => b !== '{first_name}')
  if (left.length) return `a blank was left in the text: ${left.join(' ')}`
  return null
}
export const OPEN_HOURS_ACK_DEFAULT = 'Thanks, {first_name}! We got your answer and we\'ll be in touch once the schedule is set.'

/* Texts go 9am to 6pm Central (her decision). */
export function inSendWindow(now: Date = new Date()): boolean {
  const h = Number(now.toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false })) % 24
  return h >= 9 && h < 18
}

/* ── the AI reads one caregiver's answer ──────────────────────────────────────────────────────────────────────────
   green: yes, with the squares they named (any = "any of it" / a plain yes that named none)
   red:   no
   yellow: a question, or anything the AI isn't sure about. A question mark is always yellow, even next to a yes:
           a person answers, and the days they did name are kept.
   The AI only picks from the squares offered; a quote is kept only when it is really in what they wrote. */
export type Reading = { answer: 'yes' | 'no' | 'question'; cells: string[]; any: boolean; quote: string | null; failed: boolean; why?: string }
const squash = (x: unknown) => String(x ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
export const quoteIn = (quote: unknown, said: string): string | null => {
  const q = String(quote ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
  return q.length >= 2 && squash(said).includes(squash(q)) && squash(q).length >= 2 ? q : null
}
export function settle(raw: Any, said: string, offered: { key: string }[]): Reading {
  const keys = new Set(offered.map((c) => c.key))
  let answer: Reading['answer'] = raw?.answer === 'yes' || raw?.answer === 'no' ? raw.answer : 'question'
  const any = answer === 'yes' && raw?.any === true
  let cells = Array.isArray(raw?.cells) ? [...new Set(raw.cells.map((c: unknown) => String(c)).filter((c: string) => keys.has(c)))] as string[] : []
  if (any) cells = [...keys]
  if (answer === 'no') cells = []
  const sure = raw?.sure !== false
  let why = ''
  if (/\?/.test(said) && answer !== 'no') { answer = 'question'; why = 'they asked something' }
  else if (!sure && answer !== 'question') { answer = 'question'; why = 'the AI was not sure' }
  return { answer, cells, any: answer === 'yes' ? any : false, quote: quoteIn(raw?.quote, said), failed: false, ...(why ? { why } : {}) }
}
export async function readOpenHoursReply(said: string, offered: { key: string; words: string }[], fetchImpl: typeof fetch = fetch): Promise<Reading> {
  const failed: Reading = { answer: 'question', cells: [], any: false, quote: null, failed: true }
  const key = (globalThis as Any).Deno?.env?.get?.('ANTHROPIC_API_KEY') || ''
  if (!key || !String(said || '').trim()) return failed
  try {
    const r = await fetchImpl('https://api.anthropic.com/v1/messages', { method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 300, temperature: 0,
        system: 'A home-care agency texted its caregivers about regular open hours and listed them. You read ONE caregiver\'s '
          + 'reply (it may be several texts joined). Decide: "yes" (they want some or all of the hours), "no" (they do not '
          + 'want them), or "question" (they ask something, or it is unclear). For a yes, list the squares they said they can '
          + 'do, using ONLY the keys given. "Mondays and Wednesdays" means every hour offered on those days; "mornings" means '
          + 'every morning square offered; "all of it", "any" or "whatever you need" means any=true. A plain "yes" that names '
          + 'no days means any=true. If they say yes but leave days out (e.g. "yes but not Fridays"), list the squares that '
          + 'remain. sure is false when you are guessing. quote: their own words that say it, copied EXACTLY (under 160 '
          + 'characters). Answer ONLY minified JSON: {"answer":"yes"|"no"|"question","cells":["mon|am"],"any":bool,"sure":bool,"quote":"..."}',
        messages: [{ role: 'user', content: (`Squares offered (key = words):\n${offered.map((c) => `${c.key} = ${c.words}`).join('\n')}\n\nTheir reply:\n${String(said).slice(0, 1500)}`).slice(0, 6000) }] }) })
    if (!r.ok) return failed
    const j = await r.json().catch(() => null)
    const m = String(j?.content?.[0]?.text ?? '').match(/\{[\s\S]*\}/); if (!m) return failed
    return settle(JSON.parse(m[0]), String(said), offered)
  } catch { return failed }
}

/* Without the AI (its switch off, or it failed): the plain word rules every shift reply already uses. Nothing is
   guessed about days, so a yes is "any" only when the words say so; otherwise it waits in yellow for a person. */
export function readByWords(said: string, offered: { key: string }[]): Reading {
  const t = String(said || '').toLowerCase()
  const hasNeg = /(can'?t|cannot|can\s+not|won'?t|unable|not able|no way|i'?m not|don'?t think)/.test(t)
  const isNo = hasNeg || /^\s*(n|no|nope|nah|sorry)\b/.test(t) || /\b(pass|not this time|next time)\b/.test(t)
  const plainYes = !hasNeg && /^\s*(y|yes|yeah|yep|yea|sure|absolutely|definitely|of course)[\s.!]*$/.test(t)
  const allOfIt = !hasNeg && /\b(all of (it|them)|any (of it|day|time)|whatever you need)\b/.test(t)
  if (/\?/.test(t)) return { answer: 'question', cells: [], any: false, quote: null, failed: false, why: 'they asked something' }
  if (isNo) return { answer: 'no', cells: [], any: false, quote: null, failed: false }
  if (plainYes || allOfIt) return { answer: 'yes', cells: offered.map((c) => c.key), any: true, quote: null, failed: false }
  return { answer: 'question', cells: [], any: false, quote: null, failed: false, why: 'the days need a person to read' }
}
