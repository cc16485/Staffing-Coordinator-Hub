// =============================================================================
// family-review: Release 3, safe requests (Samantha 2026-10-17: "Start Release 3."; decisions 3 and 6 and her office rule
// "office help Monday to Friday only", https://claude.ai/artifact/AS6GbybmUqC47WKPto44p8).
//
// FAMILY NOTES, three layers (decision 6):
//   1. approved choices: families pick only the companion tasks allowed for this client (care_circles.app_tasks; none set =
//      every companion task for their state). Checked where the request is made (family-app.ts).
//   2. fixed rules on the note (checkNote): personal care, medical care, lifting or transfers, overnight stays, or driving the
//      client's own car HOLD the request for the office. Emergency words also show the family the emergency message at once.
//   3. AI as a second opinion (reviewNote): fine / outside companion services / health or safety concern / needs a person /
//      unsure. It can only ADD a hold, never release one. Unsure = held. Unavailable or slower than 20 seconds = the rules
//      decide and the note goes on the office's "notes AI didn't read" list.
//   A held request: the office approves it, approves it without the note, or declines it (the family gets the approved
//   decline wording). Not reviewed by the answer-by time = it ends with that wording.
//
// HELP US FILL EXTRA VISITS (decision 3): a client flag only Samantha or Krystal set, with a reason, for 90 days. When no
// caregiver has said yes one office day before the answer-by time (or sooner, once everyone was asked), the office gets one
// task (Monday to Friday, 8 AM to 6 PM) and closes it Placed / Another time agreed / Couldn't fill. Not closed by the
// answer-by time = it ends with the couldn't-fill wording. Never a guarantee.
// Pure (Central wall clock), so it runs the same in the family door, the offer run and Node tests.
// =============================================================================
import { wall, at, addDays } from './answer-by.ts'

// deno-lint-ignore no-explicit-any
type Any = any
export const NOTE_MAX = 300

// ── layer 2: the fixed rules ─────────────────────────────────────────────────────────
const PRON = '(?:her|him|his|them|their|mom|dad|mother|father|my mom|my dad|grandma|grandpa)'
export const NOTE_RULES: { why: string; re: RegExp }[] = [
  { why: 'personal care (bathing, toileting, dressing)', re: new RegExp(`\\b(bathe|bathing|give ${PRON} a bath|shower(ing)?|toilet(ing)?|incontinen\\w*|diapers?|depends|change ${PRON} (brief|pad)s?|brief changes?|(get|help) ${PRON} (get )?dressed|dress ${PRON}|wipe ${PRON})\\b`, 'i') },
  { why: 'medical care (injections, wounds, catheters, giving medication)', re: new RegExp(`\\b(insulin|injections?|shots?|wounds?|dressing change|bandage change|catheter|ostomy|colostomy|feeding tube|oxygen tank|give ${PRON} (her |his |their )?(meds|medications?|medicine|pills)|administer|blood sugars?|glucose|blood pressure readings?)\\b`, 'i') },
  { why: 'lifting or transfers', re: new RegExp(`\\b(lift(ing)? ${PRON}|hoyer|transfers?|transferring|(get|help) ${PRON} (in|out) of (bed|the bed|the chair|the tub|the car)|pick ${PRON} up off)\\b`, 'i') },
  { why: 'an overnight stay', re: /\b(overnight|over night|spend the night|stay the night|stays? all night|sleep ?over|through the night)\b/i },
  { why: "driving the client's own car", re: /\b((drive|use|take) (her|his|their|my|our|mom'?s|dad'?s) (car|van|truck)|in (her|his|their|mom'?s|dad'?s) (car|van|truck))\b/i },
]
export const EMERGENCY = /\b(fell|has fallen|she fell|he fell|chest pains?|can'?t breathe|cannot breathe|not breathing|trouble breathing|unresponsive|passed out|stroke|seizure|choking|bleeding (badly|a lot)|suicid\w*|overdose)\b/i

/** Layer 2. hold: the first rule the note trips (or null); emergency: the family sees the emergency message now. */
export function checkNote(note: unknown): { hold: string | null; emergency: boolean } {
  const t = String(note ?? '').trim()
  if (!t) return { hold: null, emergency: false }
  const emergency = EMERGENCY.test(t)
  const hit = NOTE_RULES.find((r) => r.re.test(t))
  return { hold: hit ? `the note mentions ${hit.why}` : emergency ? 'the note mentions a possible emergency' : null, emergency }
}

// ── layer 3: AI as a second opinion ──────────────────────────────────────────────────
export type AiVerdict = { verdict: 'fine' | 'outside' | 'concern' | 'person' | 'unsure'; why: string } | null   // null = unavailable
export const AI_TIMEOUT_MS = 20000
export const AI_MODEL = 'claude-haiku-5-5'
const SYSTEM = 'You check a note a family typed when requesting an extra companion visit from a home-care agency. Companion visits ' +
  'cover only: companionship, conversation, games, light housekeeping, meal preparation, errands and shopping, outings, rides ' +
  'with an approved driver in the caregiver\'s own car, reminders (not giving medication), and light help that needs no ' +
  'hands-on personal care. They do NOT cover personal care (bathing, toileting, dressing), medical tasks, lifting or ' +
  'transfers, overnight stays, or driving the client\'s own car. Sort the note: "fine" (only companion help, nothing worrying), ' +
  '"outside" (asks for something companion visits don\'t cover), "concern" (suggests a health or safety risk the office ' +
  'should know about first, e.g. wandering, falls, confusion at night, aggression, a medical change), "person" (needs a person ' +
  'to read it for any other reason), or "unsure". why: one short plain sentence for the office. Answer ONLY minified JSON: ' +
  '{"verdict":"fine"|"outside"|"concern"|"person"|"unsure","why":"..."}'

/** Layer 3. Never throws; null = unavailable (no key, error, or slower than 20 seconds). */
export async function reviewNote(note: string, tasks: string[], key: string, send: typeof fetch = fetch, timeoutMs = AI_TIMEOUT_MS): Promise<AiVerdict> {
  if (!key || !String(note ?? '').trim()) return null
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const r = await send('https://api.anthropic.com/v1/messages', { method: 'POST', signal: ctl.signal,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: AI_MODEL, max_tokens: 160, temperature: 0, system: SYSTEM,
        messages: [{ role: 'user', content: `Tasks picked: ${tasks.join(', ') || 'none'}\nNote: ${String(note).slice(0, NOTE_MAX)}` }] }) })
    if (!r.ok) return null
    const j = await r.json().catch(() => null)
    const m = String(j?.content?.[0]?.text ?? '').match(/\{[\s\S]*\}/); if (!m) return null
    const a = JSON.parse(m[0])
    const v = ['fine', 'outside', 'concern', 'person', 'unsure'].includes(a.verdict) ? a.verdict : 'unsure'
    return { verdict: v, why: String(a.why ?? '').slice(0, 200) }
  } catch { return null } finally { clearTimeout(timer) }
}
export const AI_WHY: Record<string, string> = { outside: 'outside companion services', concern: 'a health or safety concern', person: 'needs a person to read it', unsure: 'AI was unsure' }

// ── office hours (her rule: Monday to Friday only) ───────────────────────────────────
export const OFFICE = { from: 8, until: 18 }
const isOfficeDay = (date: string) => { const d = new Date(date + 'T12:00:00Z').getUTCDay(); return d >= 1 && d <= 5 }
export function inOffice(now: Date): boolean { const w = wall(now); return isOfficeDay(w.date) && w.min >= OFFICE.from * 60 && w.min < OFFICE.until * 60 }
/** Office hours between two instants. */
export function officeHours(a: Date, b: Date): number {
  if (b <= a) return 0
  let h = 0, day = wall(a).date; const last = wall(b).date
  for (let i = 0; i < 400 && day <= last; i++, day = addDays(day, 1)) {
    if (!isOfficeDay(day)) continue
    const s = Math.max(a.getTime(), at(day, OFFICE.from * 60).getTime()), e = Math.min(b.getTime(), at(day, OFFICE.until * 60).getTime())
    if (e > s) h += (e - s) / 3600000
  }
  return h
}
/** One office day before the answer-by time (same clock time on the office day before). */
export function handoffAt(answerBy: Date): Date {
  const w = wall(answerBy); let d = addDays(w.date, -1)
  for (let i = 0; i < 7 && !isOfficeDay(d); i++) d = addDays(d, -1)
  return at(d, w.min)
}
export const HELP_MIN_OFFICE_HOURS = 4
/** Can the office still help with this request in time? (at least 4 office hours between the handoff, or now, and the answer-by) */
export function officeCanHelp(now: Date, answerBy: Date): boolean {
  const h = handoffAt(answerBy), from = h > now ? h : now
  return officeHours(from, answerBy) >= HELP_MIN_OFFICE_HOURS
}

// ── Help us fill: the client flag ────────────────────────────────────────────────────
export const HELP_DAYS = 90
/** The flag counts only while on and before its review date. */
export function helpFillOn(flag: Any, today: string): boolean { return !!flag && flag.on === true && String(flag.review_by ?? '') >= today }

// ── the family's words (approved with decisions 3 and 6) ────────────────────────────
export const HELD_WORDS = (by: string) => `Request sent. Our office needs to check this request before we ask caregivers. You'll hear from us by ${by}.`
export const EMERGENCY_WORDS = (phone: string) => `If this is an emergency, call 911 now. For anything urgent, call us at ${phone}.`
export const HELP_ADD = "If no caregiver accepts, our office will also try to arrange this visit. We can't guarantee a caregiver."
export const HELP_LATE = "Our office isn't able to help with this one in time, so it depends on caregivers accepting."
export const MSG_FAMILY_DECLINED = "Hi {first_name}, it's {brand}. We can't arrange {client}'s request for {day}{times} in the app because it includes care our extra visits don't cover. Please call us at {phone} so we can help."
export const MSG_FAMILY_COULDNT = "Hi {first_name}, it's {brand}. We asked our caregivers and our office also tried, but no one is available for {client}'s visit on {day}{times}. Nothing was scheduled and there's no charge. Please call us at {phone} if this visit is essential, or try another time in the app: {app}"
