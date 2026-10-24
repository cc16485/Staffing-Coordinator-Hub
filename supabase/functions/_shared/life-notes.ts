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
/* SIMILAR TOPICS ARE ONE (2026-10-24, after the first practice read-back: "TV", "television", "TV shows" and "watching TV"
   were four topics). The first group a topic matches names it; anything else keys on its own words. */
const GROUPS: [RegExp, string][] = [
  [/\b(word ?search\w*|cross ?words?|puzzles?|puzzle books?|sudoku)\b/i, 'puzzles'],
  [/\b(game shows?|family feud|wheel of fortune|price is right|jeopardy)\b/i, 'game shows'],
  [/\b(card games?|cards|rummikub|solitaire|bingo|board games?|dominoes|yahtzee)\b/i, 'cards and games'],
  [/\b(football|baseball|basketball|sports?|chiefs|cardinals|royals)\b/i, 'sports on TV'],
  [/\b(movies?|films?)\b/i, 'movies'],
  [/\b(news)\b/i, 'the news'],
  [/\b(tv|television|shows?)\b/i, 'TV'],
  [/\b(drives?|driving|car rides?|scenery)\b/i, 'drives'],
  [/\b(walks?|walking|strolls?)\b/i, 'walks'],
  [/\b(porch|patio|outdoors?|outside|fresh air|sunroom|yard)\b/i, 'time outside'],
  [/\b(birds?|squirrels?|bird ?watching)\b/i, 'birds'],
  [/\b(cats?|dogs?|kitty|puppy|pets?)\b/i, 'pets'],
  [/\b(outings?|park|parks|going out|get(ting)? out|out of the house|lunch out|restaurants?|drive-?thru|shopping)\b/i, 'getting out'],
  [/\b(chat\w*|conversations?|visit\w*|talk\w*|socializ\w*|company|stories)\b/i, 'a good chat'],
  [/\b(reading|books?|novels?)\b/i, 'reading'],
  [/\b(nails?|manicure|hair (done|styled|curled|styling)|getting (her|his) hair)\b/i, 'being pampered'],
  [/\b(music|songs?|singing|hymns?|radio)\b/i, 'music'],
  [/\b(church|mass|service|bible|prayer)\b/i, 'church and faith'],
  [/\b(garden\w*|plants?|flowers?)\b/i, 'plants and gardening'],
  [/\b(coffee)\b/i, 'coffee'],
  [/\b(ice cream)\b/i, 'ice cream'],
  [/\b(dr\.? ?pepper|coke|soda|pop)\b/i, 'soda'],
]
/** the group a topic belongs to, if any */
export const groupOf = (topic: string): string | null => { const g = GROUPS.find(([re]) => re.test(S(topic))); return g ? g[1] : null }
/** the topic's key: its group when it has one ("Word search" and "puzzle book" are "puzzles"); otherwise its plain words,
    singular, sorted ("Playing cards" = "cards") */
export function topicKey(topic: string): string {
  const g = groupOf(topic); if (g) return g.toLowerCase()
  const ws = (S(topic).toLowerCase().match(/[a-z]+/g) || []).map(sing)
  const keep = ws.filter((w) => !STOP.has(w))
  return (keep.length ? keep : ws).sort().join(' ').slice(0, 60)
}
const KNOWN_SKIP = new Set(['and', 'the', 'good', 'time', 'with', 'being', 'outside'])
/** Is this topic already in the Life Story? (a real word of it appears there) */
export function inLifeStory(topic: string, lifeText: string): boolean {
  const lt = ' ' + squash(lifeText).replace(/[^a-z ]/g, ' ').split(/\s+/).map(sing).join(' ') + ' '
  return topicKey(topic).split(' ').map(sing).filter((w) => w.length >= 3 && !KNOWN_SKIP.has(w)).some((w) => lt.includes(' ' + w + ' ') || lt.includes(' ' + w.slice(0, 5)))
}

const SYSTEM = `You read one home-care caregiver's shift note about a client. Find things the note shows the CLIENT ENJOYS or LIKES: activities and hobbies, TV shows, music or books, foods and drinks they enjoy, small routines or comforts, things they like to talk about, or their past work and life.

Rules:
- Only what the note itself shows about the CLIENT. Ordinary tasks the caregiver did (making coffee or meals, feeding pets, watering plants, sorting mail, cleaning, laundry, packing food) are not the client's interests, unless the note says the client asked for it or enjoyed it.
- Nothing about the caregiver's own life, family or plans (for example "talked about my wedding").
- Food and drink only when the note shows the client wanted, asked for, chose or loved it ("she wanted Huey Magoos", "asked for a Dr Pepper"). A meal they simply ate is not enough.
- Nothing about exercise, therapy, physical therapy or health programs.
- Never anything about health, medication, toileting, pain, mood, confusion, memory or sleep, never another person's name or family matters, never money or where they live.
- For each, give a short plain topic of one to three words that groups similar things (for example "word puzzles" for a word search, crossword or puzzle book; "cards" for any card game; "game shows" for Family Feud or Wheel of Fortune), the kind, and the note's own words you relied on, copied exactly, at most 12 words.
- At most 3. If the note shows nothing the client enjoys, return none.`
const SCHEMA = { type: 'object', additionalProperties: false, required: ['details'], properties: { details: { type: 'array', items: {
  type: 'object', additionalProperties: false, required: ['topic', 'kind', 'words'],
  properties: { topic: { type: 'string' }, kind: { type: 'string', enum: LIFE_KINDS }, words: { type: 'string' } } } } } }

export const LIFE_MODEL = 'claude-haiku-4-5'
/* the caregiver's own work ("made coffee", "fed the cats", "watered her plants", "helped her sort mail") */
const TASK = /^(i |we |then |and )?(made|make|fed|feed|watered|helped|help|sorted|cleaned|washed|cooked|prepared|fixed|gave|took|refilled|bagged|vacuum\w*|folded|got her|got him|brought)\b/i
const HELP = /\b(ask\w*|want\w*|need\w*)\s+(me|us)\s+to\b|\bhelp(ed|ing)?\s+(him|her|them|me)\b|\b(asked|needed) for help\b/i
const VISITOR = /\b(called|calls?|phone calls?|came (by|over)|stopped by|dropped by|came to visit)\b/i
const CARE_ITEM = /\b(mattress\w*|bed|beds|pillows?|recliner|lift chair|cushions?|wheelchair|walker|shower chair|commode|hearing|glasses)\b/i
/* the client wanted, chose or loved it */
const WANT = /\b(want\w*|ask\w*|request\w*|chose|choose|picked|love[sd]?|loving|enjoy\w*|favou?rite|craving|insist\w*|happy|smil\w*|laugh\w*|could ?n[o']t put)\b/i
/* the note-specific words a Life Story never carries (beyond the Caregiver Preview's own list); exercise and therapy too
   (2026-10-24: "keep therapy and exercise out") */
const NOTE_SENSITIVE = /\b(exercis\w*|therap\w*|physical|health\w*|rehab\w*|stretch\w*|trike|pedal\w*|peddl\w*|diarrh\w*|bm|bowel\w*|urin\w*|pee|poop\w*|accident\w*|pull-?ups?|depends|briefs?|commode|potty|nap\w*|slep\w*|sleep\w*|tired|cranky|grump\w*|upset|sad|cr(y|ied|ying)|tear\w*|dying|die|death|swell\w*|swollen|bleed\w*|blood|bruis\w*|rash|sore|vomit\w*|nause\w*|cough\w*|fever|temp(erature)?|blood pressure|sugar|insulin|oxygen|hearing aids?|glasses|compression|socks|cane|walker|wheelchair|shower\w*|bath\w*|lock\w*|door\w*)\b/i
const REL = /\b(son|daughter|husband|wife|grand\w*|brother|sister|niece|nephew|family|boyfriend|girlfriend|mother|father|mom|dad)\b/i
/** The few words kept as the source: other people's first names masked ("played cards with Lisa" -> "played cards with ..."),
    the client's own first name and well-known names (shows, teams, singers) are hard to tell apart, so any capitalised word
    after the first is masked unless it's the client's first name or in the topic itself. */
/* ordinary words that start a sentence (never a person's name) */
const STARTERS = new Set(['she', 'he', 'we', 'they', 'the', 'then', 'after', 'when', 'today', 'tonight', 'this', 'it', 'her', 'his', 'client', 'mrs', 'mr', 'ms', 'miss', 'once', 'later', 'while', 'had', 'did', 'played', 'watched', 'went', 'spent', 'enjoyed', 'loved', 'read', 'sat', 'a', 'an', 'our', 'good', 'great', 'very'])
export function maskNames(words: string, clientFirst: string, topic: string): string {
  const keep = new Set([S(clientFirst).toLowerCase(), ...S(topic).toLowerCase().split(/\s+/), 'i', 'tv'])
  return S(words).split(' ').map((w) => { const bare = w.replace(/[^A-Za-z]/g, ''); return /^[A-Z][a-z]+$/.test(bare) && !keep.has(bare.toLowerCase()) && !STARTERS.has(bare.toLowerCase()) ? w.replace(bare, '...') : w }).join(' ')
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
        /* "Lisa": a person, not a topic (a single capitalised word, in no group, written mid-sentence in the note or opening the
           words the AI relied on, like a name) */
        const nameOnly = /^[A-Z][a-z]+$/.test(x.topic) && !groupOf(x.topic) && (new RegExp('[a-z,] ' + x.topic + '\\b').test(text) || x.words.startsWith(x.topic + ' '))
        /* the caregiver's own task (unless the client wanted it), the caregiver's own life, a meal simply eaten */
        const task = TASK.test(x.words) && !WANT.test(x.words)
        const mine = /\bmy\b/i.test(x.words)
        const plainMeal = x.kind === 'food_drink' && !WANT.test(x.words)
        /* 2026-10-24 leftover misses: a request for help is a task, not an interest ("asked me to help him vacuum seal");
           someone calling or visiting is a family or friends matter; comfort and care items (a mattress, a lift chair)
           are not interests */
        const helpReq = HELP.test(x.words)
        const visitor = VISITOR.test(x.words) || VISITOR.test(x.topic)
        const careItem = CARE_ITEM.test(x.topic)
        const ok = x.topic && LIFE_KINDS.includes(x.kind) && inNote(x.words, text) && !sensitiveHit(x.topic) && !sensitiveHit(x.words)
          && !NOTE_SENSITIVE.test(x.topic) && !NOTE_SENSITIVE.test(x.words) && !REL.test(x.topic) && !nameOnly && !task && !mine && !plainMeal && !helpReq && !visitor && !careItem
        if (!ok) rejected++
        return ok
      })
      .map((x: Any) => { const g = groupOf(x.topic); return { ...x, topic: g ? g.charAt(0).toUpperCase() + g.slice(1) : x.topic, key: topicKey(x.topic) } }).filter((x: Any) => x.key)
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

/** WORTH SHOWING (for when suggestions appear on profiles; nothing is shown in practice). Generic topics (TV, a good chat,
    coffee, soda, time outside) and food only once seen often; anything else once a note shows it. Known never. */
const GENERIC = new Set(['tv', 'a good chat', 'coffee', 'soda', 'time outside', 'water', 'snack'])
export function worthShowing(r: Any): boolean {
  if (!r || r.status === 'known' || r.status === 'dismissed' || r.status === 'accepted') return false
  const often = howOften(r) === 'seen often'
  if (GENERIC.has(String(r.topic_key)) || r.kind === 'food_drink') return often
  return true
}
