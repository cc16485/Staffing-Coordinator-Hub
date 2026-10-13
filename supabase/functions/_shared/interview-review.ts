// The AI Interview Review's own rules (2026-10-13, Samantha: "yes to all" on the Interview Notes and AI Review preview,
// https://claude.ai/artifact/Ki7QEvLaDWqTQ5UAxuHGXp, then "build"). Kept apart from the function so the tests run it.
//   • A second set of ears, never a judge: no score, no verdict, no hiring recommendation, no personality, honesty,
//     mental-health or suitability judgment, nothing drawn from how someone speaks, their accent or tone.
//   • What the applicant SAID is kept apart from what the AI SUGGESTS we clarify.
//   • Every quote must really be in the transcript (or the application). A quote that is not found is dropped, and an
//     item left with no real quote is dropped; the timestamp comes from the transcript, never from the model.
//   • Talk share, talking over and the longest answer are counted from the transcript's timings, not by the model.

export type Turn = { speaker?: string; name?: string; start?: number; end?: number; text?: string }
export type Part = { rec: string; part: number; turns: Turn[] }
export type Said = { quote: string; part?: number; at?: number; rec?: string; source?: 'transcript' | 'application' }
export type Item = { id: string; section: string; said: Said[]; clarify?: string; text?: string }
export type Kind = 'full' | 'check'

export const SECTIONS_QUOTED = ['strengths', 'concerns', 'communication', 'safety'] as const
export const SECTIONS_PLAIN = ['missed', 'reference_questions'] as const

const clock = (s: number) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0')
export const norm = (s: string) => String(s || '').toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim()

export function transcriptText(parts: Part[]): string {
  return parts.map((p) => (parts.length > 1 ? `--- Part ${p.part} ---\n` : '') +
    p.turns.map((t) => `[${parts.length > 1 ? 'P' + p.part + ' ' : ''}${clock(Number(t.start) || 0)}] ${t.name || t.speaker || 'Speaker'}: ${t.text || ''}`).join('\n')).join('\n\n')
}

/* Facts from their application the review may compare against (nothing private: no birth date, SSN, address, phone
   or email). Only keys that exist and have a value. */
const APP_KEYS: [string, string][] = [
  ['position', 'Position'], ['job_type', 'Job type wanted'], ['hours_wanted', 'Hours a week wanted'], ['will_build_up', 'Will start on fewer hours'],
  ['experience_years', 'Years of experience'], ['experience', 'Experience'], ['experience_kinds', 'Kinds of experience'],
  ['availability', 'Availability'], ['shifts', 'Shifts'], ['overnights', 'Overnights'], ['weekends', 'Weekends'],
  ['city', 'Town'], ['travel_areas', 'Will travel to'], ['has_transport', 'Has transportation'], ['work_history', 'Work history'],
]
export function applicationFacts(a: Record<string, unknown>): string {
  return APP_KEYS.filter(([k]) => a[k] !== undefined && a[k] !== null && a[k] !== '' && !(Array.isArray(a[k]) && !(a[k] as unknown[]).length))
    .map(([k, l]) => `${l}: ${typeof a[k] === 'object' ? JSON.stringify(a[k]).slice(0, 1500) : String(a[k]).slice(0, 500)}`).join('\n')
}

export function buildPrompt(kind: Kind, first: string, transcript: string, questions: string[], facts: string): string {
  const rules = `Rules you must follow:
- You are a second set of ears for the interviewer, not a judge. Never give a hiring recommendation, a score, a rating, a verdict or a summary judgment such as "strong candidate" or "not a fit".
- Never infer personality, honesty, mental health, intelligence or suitability from how someone speaks, their accent, grammar, tone, nerves or pauses. Never mention age, health, disability, religion, pregnancy, family status, race or where someone is from.
- Keep what the applicant said apart from what you suggest. Every "said" entry is an exact quote of the applicant's own words, copied character for character from the transcript (a short phrase or one sentence), or an exact quote from the application with "source":"application". Never paraphrase inside a quote.
- Only report what is in the transcript or the application. If you are not sure, leave it out.
- "clarify" is a neutral question or point to follow up, worded so the interviewer can ask it. Not a conclusion.
- A life circumstance (children, a second job, the bus, a car in the shop) is never a concern by itself; only how they said they handle getting to work or calling in is.`
  const shape = kind === 'check'
    ? `Reply with JSON only:
{"applicant_speaker":"<the label the transcript uses for the applicant>",
 "concerns":[{"said":[{"quote":"..."}],"clarify":"..."}],
 "missed":[{"text":"a question from the list that was not asked or only half answered, and what to ask now"}]}
Keep it short: this is read in the room while the applicant is still there. At most 4 concerns and 5 missed.`
    : `Reply with JSON only:
{"applicant_speaker":"<the label the transcript uses for the applicant>",
 "summary":"3 to 5 plain sentences of what they told us. No judgment.",
 "strengths":[{"said":[{"quote":"..."}],"note":"what this shows, factually (experience, an example they gave)"}],
 "concerns":[{"said":[{"quote":"..."}],"clarify":"an inconsistency or gap to follow up, e.g. with the application or a later answer"}],
 "communication":[{"said":[{"quote":"..."}],"clarify":"an observable communication point with its example, e.g. did not answer the question asked"}],
 "safety":[{"said":[{"quote":"..."}],"clarify":"a confidentiality, client-safety or boundary point and what to ask"}],
 "missed":[{"text":"a question from the list that was not asked or only half answered"}],
 "reference_questions":[{"text":"a question to ask their references, tied to something in the interview"}]}
Each list may be empty. At most 6 items per list.`
  return `You are helping a small home care agency in Springfield, Missouri review a caregiver job interview they recorded with the applicant's consent. A care coordinator interviewed the applicant${first ? `, ${first}` : ''}. The speaker labels are the transcriber's guess; work out who the applicant is from context.

<transcript>
${transcript.slice(0, 150000)}
</transcript>

<questions_meant_to_be_asked>
${questions.join('\n')}
</questions_meant_to_be_asked>

<application>
${facts || '(nothing on file)'}
</application>

${rules}

${shape}`
}

/* Finds where a quote was said. Exact (normalized) substring first; then, for long quotes, 80% of its words in order. */
export function findQuote(parts: Part[], quote: string, applicant?: string): { part: number; at: number; rec: string } | null {
  const q = norm(quote); if (q.length < 3) return null
  for (const pass of [true, false]) {
    for (const p of parts) for (const t of p.turns) {
      if (pass && applicant && (t.name || t.speaker) !== applicant) continue
      if (norm(t.text || '').includes(q)) return { part: p.part, at: Math.round(Number(t.start) || 0), rec: p.rec }
    }
  }
  const words = q.split(' ')
  if (words.length >= 6) {
    for (const p of parts) for (const t of p.turns) {
      const hay = norm(t.text || ''); let i = 0, hit = 0
      for (const w of words) { const j = hay.indexOf(w, i); if (j > -1) { hit++; i = j + w.length } }
      if (hit / words.length >= 0.8) return { part: p.part, at: Math.round(Number(t.start) || 0), rec: p.rec }
    }
  }
  return null
}

// deno-lint-ignore no-explicit-any
export function verify(parsed: any, parts: Part[], appText: string): { items: Item[]; summary: string; applicant: string; dropped: number } {
  const applicant = String(parsed?.applicant_speaker || '')
  const appN = norm(appText)
  const items: Item[] = []; let dropped = 0, n = 0
  for (const sec of SECTIONS_QUOTED) {
    for (const x of (Array.isArray(parsed?.[sec]) ? parsed[sec] : []).slice(0, 6)) {
      const said: Said[] = []
      for (const s of (Array.isArray(x?.said) ? x.said : []).slice(0, 4)) {
        const quote = String(s?.quote || '').trim().slice(0, 400); if (!quote) continue
        if (s?.source === 'application') { if (appN.includes(norm(quote))) said.push({ quote, source: 'application' }); continue }
        const where = findQuote(parts, quote, applicant)
        if (where) said.push({ quote, source: 'transcript', ...where })
      }
      if (!said.some((s) => s.source === 'transcript')) { dropped++; continue }
      const words = String(x?.clarify || x?.note || '').trim().slice(0, 600)
      items.push({ id: sec[0] + (++n), section: sec, said, ...(sec === 'strengths' ? { text: words } : { clarify: words }) })
    }
  }
  for (const sec of SECTIONS_PLAIN) {
    for (const x of (Array.isArray(parsed?.[sec]) ? parsed[sec] : []).slice(0, 6)) {
      const text = String(x?.text || '').trim().slice(0, 400)
      if (text) items.push({ id: sec[0] + (++n), section: sec, said: [], text })
    }
  }
  return { items, summary: String(parsed?.summary || '').trim().slice(0, 1500), applicant, dropped }
}

/* Counted from the timings: the applicant's share of talking, times they started while the other person was still
   talking (more than half a second of overlap), and their longest single turn. */
export function stats(parts: Part[], applicant: string) {
  let mine = 0, all = 0, longest = { secs: 0, part: 1, at: 0 }
  const overlaps: { part: number; at: number }[] = []
  for (const p of parts) {
    let prev: Turn | null = null
    for (const t of p.turns) {
      const s = Number(t.start) || 0, e = Number(t.end) || s, d = Math.max(0, e - s), who = t.name || t.speaker
      all += d; if (who === applicant) { mine += d; if (d > longest.secs) longest = { secs: Math.round(d), part: p.part, at: Math.round(s) } }
      if (prev && who === applicant && (prev.name || prev.speaker) !== applicant && s < (Number(prev.end) || 0) - 0.5) overlaps.push({ part: p.part, at: Math.round(s) })
      prev = t
    }
  }
  return { applicant_share: all ? Math.round((mine / all) * 100) : null, overlaps: overlaps.slice(0, 20), overlap_count: overlaps.length, longest, minutes: Math.round(all / 60) }
}
