// =============================================================================
// LIFE STORY SUGGESTIONS FROM CAREGIVERS' SHIFT NOTES (Samantha, 2026-10-24, Life Story plan step 3,
// https://claude.ai/artifact/5DXNbwo9K4JzfuvuW3J1hc). The two-hourly note check (care-notes) also asks of each note: what
// does this say the client enjoys? Her rules:
//  - Only safe kinds of detail: activities and hobbies, TV, music and books, food and drink, small routines and comforts,
//    conversation topics, past work and life. Never anything medical (conditions, medication, toileting, pain, mood,
//    confusion, sleep), other people's names, family conflict, money or addresses.
//  - The caregiver's own words: the AI must copy the words it relied on, and they must really be in the note.
//  - Combined, not repeated: "word search", "puzzle book" and "word puzzles" become one topic with a running count, kept
//    apart by client. A topic already in the Life Story is marked known, never suggested again.
//  - Once vs often, never assumed true: each topic keeps how many notes and how many caregivers mentioned it. Repetition is
//    a label only; a person decides.
//  - Practice first: for two weeks the topics are only collected (status 'practice'), nothing is shown on profiles.
// Pure functions plus askLife (one AI call, given a fetch).
// =============================================================================
// deno-lint-ignore no-explicit-any
type Any = any
import { sensitiveHit } from './life-story-draft.ts'

export const LIFE_KINDS = ['activity', 'tv_music_books', 'food_drink', 'routine_comfort', 'conversation', 'work_life']
const S = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim()
const squash = (x: string) => S(x).toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
/** the caregiver's words, really in the note (at least 6 letters) */
export function inNote(quote: string, text: string) {
  const q = squash(quote).replace(/^["'\s]+|["'\s.]+$/g, '')
  return q.length >= 6 && squash(text).includes(q)
}
const STOP = new Set(['her', 'his', 'their', 'the', 'a', 'an', 'and', 'of', 'on', 'to', 'with', 'for', 'some', 'watching', 'playing', 'doing', 'having', 'eating', 'drinking', 'reading', 'tv', 'show', 'shows'])
const sing = (w: string) => w.length > 4 && w.endsWith('ies') ? w.slice(0, -3) + 'y' : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w
/** the topic's key: its plain words, singular, sorted ("Word puzzles" and "word puzzle" are one; "Playing cards" = "cards") */
export function topicKey(topic: string): string {
  const ws = (S(topic).toLowerCase().match(/[a-z]+/g) || []).map(sing)
  const keep = ws.filter((w) => !STOP.has(w))
  return (keep.length ? keep : ws).sort().join(' ').slice(0, 60)
}
/** Is this topic already in the Life Story? (a real word of it appears there) */
export function inLifeStory(topic: string, lifeText: string): boolean {
  const lt = ' ' + squash(lifeText).replace(/[^a-z ]/g, ' ').split(/\s+/).map(sing).join(' ') + ' '
  return topicKey(topic).split(' ').filter((w) => w.length >= 3).some((w) => lt.includes(' ' + w + ' ') || lt.includes(' ' + w.slice(0, 5)))
}

const SYSTEM = `You read one home-care caregiver's shift note about a client. Find things the note shows the CLIENT ENJOYS or LIKES: activities and hobbies, TV shows, music or books, foods and drinks they enjoy, small routines or comforts, things they like to talk about, or their past work and life.

Rules:
- Only what the note itself shows. Ordinary care tasks the caregiver did (cleaning, laundry, cooking because it was needed) are not enjoyment. A meal they simply ate is not enough unless the note shows they wanted or enjoyed it.
- Never anything about health, medication, toileting, pain, mood, confusion, memory or sleep, never another person's name or family matters, never money or where they live.
- For each, give a short plain topic of one to three words that groups similar things (for example "word puzzles" for a word search, crossword or puzzle book; "cards" for any card game; "game shows" for Family Feud or Wheel of Fortune), the kind, and the note's own words you relied on, copied exactly, at most 12 words.
- At most 3. If the note shows nothing the client enjoys, return none.`
const SCHEMA = { type: 'object', additionalProperties: false, required: ['details'], properties: { details: { type: 'array', items: {
  type: 'object', additionalProperties: false, required: ['topic', 'kind', 'words'],
  properties: { topic: { type: 'string' }, kind: { type: 'string', enum: LIFE_KINDS }, words: { type: 'string' } } } } } }

export const LIFE_MODEL = 'claude-haiku-4-5'
/* the note-specific words a Life Story never carries (beyond the Caregiver Preview's own list) */
const NOTE_SENSITIVE = /\b(diarrh\w*|bm|bowel\w*|urin\w*|pee|poop\w*|accident\w*|pull-?ups?|depends|briefs?|commode|potty|nap\w*|slep\w*|sleep\w*|tired|cranky|grump\w*|upset|sad|cr(y|ied|ying)|tear\w*|dying|die|death|swell\w*|swollen|bleed\w*|blood|bruis\w*|rash|sore|vomit\w*|nause\w*|cough\w*|fever|temp(erature)?|blood pressure|sugar|insulin|oxygen|hearing aids?|glasses|compression|socks|cane|walker|wheelchair|shower\w*|bath\w*|lock\w*|door\w*)\b/i
const REL = /\b(son|daughter|husband|wife|grand\w*|brother|sister|niece|nephew|family|boyfriend|girlfriend|mother|father|mom|dad)\b/i
/** The few words kept as the source: other people's first names masked ("played cards with Lisa" -> "played cards with ..."),
    the client's own first name and well-known names (shows, teams, singers) are hard to tell apart, so any capitalised word
    after the first is masked unless it's the client's first name or in the topic itself. */
export function maskNames(words: string, clientFirst: string, topic: string): string {
  const keep = new Set([S(clientFirst).toLowerCase(), ...S(topic).toLowerCase().split(/\s+/), 'i', 'tv'])
  return S(words).split(' ').map((w, i) => { const bare = w.replace(/[^A-Za-z]/g, ''); return i > 0 && /^[A-Z][a-z]+$/.test(bare) && !keep.has(bare.toLowerCase()) ? w.replace(bare, '...') : w }).join(' ')
}

/** What this note shows the client enjoys, checked. failed = the AI couldn't be read (nothing is kept). */
export async function askLife(text: string, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<{ failed: boolean; details: { topic: string; key: string; kind: string; words: string }[]; rejected: number }> {
  if (!apiKey) return { failed: true, details: [], rejected: 0 }
  try {
    const r = await fetchImpl('https://api.anthropic.com/v1/messages', { method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: LIFE_MODEL, max_tokens: 400, system: SYSTEM,
        output_config: { format: { type: 'json_schema', schema: SCHEMA } },
        messages: [{ role: 'user', content: text.slice(0, 6000) }] }) })
    if (!r.ok) return { failed: true, details: [], rejected: 0 }
    const j: Any = await r.json().catch(() => null)
    const t = (Array.isArray(j?.content) ? j.content : []).filter((b: Any) => b?.type === 'text').map((b: Any) => b.text).join('')
    const d = JSON.parse(t)
    let rejected = 0
    const details = (Array.isArray(d?.details) ? d.details : []).slice(0, 3).map((x: Any) => ({ topic: S(x?.topic).slice(0, 40), kind: S(x?.kind), words: S(x?.words).slice(0, 120) }))
      .filter((x: Any) => {
        const nameOnly = x.kind === 'conversation' && /^[A-Z][a-z]+$/.test(x.topic)   /* "Lisa": a person, not a topic */
        const ok = x.topic && LIFE_KINDS.includes(x.kind) && inNote(x.words, text) && !sensitiveHit(x.topic) && !sensitiveHit(x.words)
          && !NOTE_SENSITIVE.test(x.topic) && !NOTE_SENSITIVE.test(x.words) && !REL.test(x.topic) && !nameOnly
        if (!ok) rejected++
        return ok
      })
      .map((x: Any) => ({ ...x, key: topicKey(x.topic) })).filter((x: Any) => x.key)
    return { failed: false, details, rejected }
  } catch { return { failed: true, details: [], rejected: 0 } }
}

/** Add one note's mention to a topic (combined): a new note adds to the count; the same note twice is not counted again.
    Keeps at most 10 sources; no note text beyond the few words relied on. */
export function addMention(row: Any | null, m: { ax: string; client_first: string; topic: string; key: string; kind: string; ref: string; cg: string; day: string; visit_id: string; words: string; known: boolean }, now: string): Any | null {
  const r: Any = row ? { ...row } : { axiscare_client_id: m.ax, client_first: m.client_first, topic_key: m.key, label: m.topic, kind: m.kind, status: m.known ? 'known' : 'practice', mentions: 0, caregivers: [], sources: [], first_seen: now }
  const srcs: Any[] = Array.isArray(r.sources) ? r.sources : []
  if (srcs.some((s) => s?.ref === m.ref)) return null
  r.sources = [...srcs, { ref: m.ref, cg: m.cg, day: m.day, visit_id: m.visit_id, words: m.words }].slice(-10)
  r.mentions = (Number(r.mentions) || 0) + 1
  r.caregivers = [...new Set([...(Array.isArray(r.caregivers) ? r.caregivers : []), m.cg].filter(Boolean))]
  r.last_seen = now
  if (m.known && r.status === 'practice') r.status = 'known'
  return r
}
/** "seen often" = 2+ caregivers, or 3+ notes; otherwise "mentioned once" or "a few times". A label only. */
export const howOften = (r: Any) => (Array.isArray(r?.caregivers) && r.caregivers.length >= 2) || Number(r?.mentions) >= 3 ? 'seen often' : Number(r?.mentions) >= 2 ? 'a few times' : 'mentioned once'
