// =============================================================================
// DRAFT THE CAREGIVER PREVIEW FROM THE LIFE STORY (Samantha, 2026-10-24, Life Story plan step 2,
// https://claude.ai/artifact/5DXNbwo9K4JzfuvuW3J1hc). The AI writes a warm two or three sentence About and up to six
// things the client enjoys, ONLY from the Life Story the office recorded (the three answers, and "Anything else about who
// they are"). Never from shift notes, the care plan, calls or anything else. Her rules:
//  - Never invent: nothing that isn't in the Life Story. Checked here: every "enjoys" item must share a real word with the
//    Life Story, and any name or place in the About must appear in it (else the draft is refused).
//  - Never sensitive: no health, medication, toileting, mood or memory, no family conflict, no money, no other people's
//    names, no address. Checked here with a word list; a draft that trips it is retried once, then refused.
//  - Only a draft: it is returned to the tab's boxes, not saved. A person reads it, changes anything, saves it as a draft and
//    approves it through the usual Caregiver Preview steps.
// Pure functions plus one call (draftFromLifeStory) given a fetch.
// =============================================================================
// deno-lint-ignore no-explicit-any
type Any = any
import { cleanAbout, cleanEnjoys } from './caregiver-preview.ts'

export const DRAFT_MODEL = 'claude-opus-5-5'
const LABEL: Record<string, string> = { work: 'Work and life', enjoys: 'Enjoys talking about or doing', little: 'Little things that make their day', more: 'Anything else about who they are' }
const S = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim()

/** The Life Story for one client: the profile's answers, else the inquiry's (carried), plus the free-text box. */
export function lifeSources(profile: Any | null, lead: Any | null): { key: string; label: string; text: string; via: string; by: string; at: string }[] {
  const out: Any[] = []
  for (const k of ['work', 'enjoys', 'little']) {
    const a = (profile?.life ?? {})[k] && S(profile.life[k].text) ? profile.life[k] : (lead?.life ?? {})[k] && S(lead.life[k].text) ? lead.life[k] : null
    if (a) out.push({ key: k, label: LABEL[k], text: S(a.text).slice(0, 600), via: S(a.via) || 'intake call', by: S(a.by), at: S(a.at) })
  }
  if (S(profile?.life_story)) out.push({ key: 'more', label: LABEL.more, text: S(profile.life_story).slice(0, 800), via: 'profile', by: S(profile.updated_by), at: S(profile.updated_at) })
  return out
}

/** Words that must never reach a caregiver-facing introduction (health, care, family conflict, money). */
const SENSITIVE = /\b(dementia|alzheim\w*|memory (loss|care)|confus\w*|diagnos\w*|disease|illness|sick|cancer|stroke|diabet\w*|parkinson\w*|copd|oxygen|hospice|dialysis|surgery|hospital\w*|medic\w*|meds|pills?|prescri\w*|incontinen\w*|toilet\w*|bathroom|diaper\w*|catheter|wound|pain|wheelchair|walker|bedbound|hoyer|depress\w*|anxi\w*|agitat\w*|aggress\w*|wander\w*|sundown\w*|blind|deaf|frail|divorc\w*|estranged|conflict|argu\w*|abuse\w*|neglect\w*|lawsuit|money|pay(s|ing)?|paid|debt|medicaid|medicare|insurance|address)\b|\$/i
export const sensitiveHit = (t: string): string | null => { const m = SENSITIVE.exec(t); return m ? m[0] : null }

const STOP = new Set(['about', 'their', 'there', 'they', 'them', 'with', 'from', 'that', 'this', 'have', 'loves', 'love', 'likes', 'like', 'enjoys', 'enjoy', 'enjoyed', 'good', 'great', 'favorite', 'very', 'really', 'always', 'time', 'every', 'still', 'what', 'when', 'some', 'things', 'thing', 'day', 'days'])
const words = (t: string) => (S(t).toLowerCase().match(/[a-z]{4,}/g) || []).filter((w) => !STOP.has(w))
const stem = (w: string) => w.slice(0, 5)
/** Does this short item come from the Life Story? (one real word in common, by its first five letters) */
export function grounded(item: string, sourceText: string): boolean {
  const have = new Set(words(sourceText).map(stem))
  const ws = words(item)
  return ws.length > 0 && ws.some((w) => have.has(stem(w)))
}
const REL = '(?:son|daughter|husband|wife|partner|boyfriend|girlfriend|grandson|granddaughter|grandchild|brother|sister|niece|nephew|cousin|friend|neighbou?r|caregiver|aide|mom|mother|dad|father|aunt|uncle)'
/** People's names in the Life Story ("her son Mark", "Mark, her son", "daughter Laura") plus the family names we know from
    the inquiry (the caller). A draft must never use them. */
export function peopleNames(sourceText: string, known: string[] = []): string[] {
  const t = S(sourceText), out = new Set<string>(known.map((x) => S(x)).filter((x) => /^[A-Z][a-z]{1,}$/.test(x)))
  for (const m of t.matchAll(new RegExp('\\b' + REL + 's?\\s+(?:named\\s+|is\\s+)?([A-Z][a-z]+)', 'gi'))) out.add(m[1])
  for (const m of t.matchAll(new RegExp('\\b([A-Z][a-z]+),?\\s+(?:her|his|their|the)\\s+' + REL + '\\b', 'g'))) out.add(m[1])
  return [...out]
}
const MONTHS = /^(January|February|March|April|May|June|July|August|September|October|November|December|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/
/** Names and places in the About (capitalised words not starting a sentence) that aren't in the Life Story. */
export function unknownNames(about: string, sourceText: string, firstName: string): string[] {
  const src = S(sourceText).toLowerCase(), out: string[] = []
  const toks = S(about).split(/\s+/)
  toks.forEach((tok, i) => {
    const w = tok.replace(/[^A-Za-z'’-]/g, ''), prev = i > 0 ? toks[i - 1] : ''
    if (!w || !/^[A-Z]/.test(w) || i === 0 || /[.!?]$/.test(prev)) return
    if (w.toLowerCase() === S(firstName).toLowerCase() || MONTHS.test(w) || /^I$/.test(w)) return
    if (!src.includes(w.toLowerCase().replace(/['’]s$/, ''))) out.push(w)
  })
  return [...new Set(out)]
}

const SYSTEM = `You write the short, warm introduction a home-care caregiver reads about a client before deciding whether to take a shift with them. You work only from the Life Story the office recorded, which is given to you as numbered sources.

Rules:
- Use only facts that are in the sources. Do not add, guess, embellish or generalise beyond them. If the sources say little, write little.
- First name only for the client. Never mention anyone else by name, and do not describe family relationships or family matters.
- Leave out anything about health, conditions, memory, mood, medication, personal care, toileting, mobility or equipment, money, legal matters, or where they live. If a source mixes these with interests, use only the interests.
- About: two or three short, friendly sentences in plain words, 400 characters at most, written about the client in the third person.
- Enjoys: up to six short items of one to three words each (activities, topics, foods, routines), each taken from the sources.
- If the sources hold nothing usable for an introduction, set enough to false and leave about empty.
- List the source numbers you used, and say in a few words what kinds of things you left out (for example "a health detail"), or nothing if you left nothing out.`

const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['enough', 'about', 'enjoys', 'used', 'left_out'],
  properties: {
    enough: { type: 'boolean' },
    about: { type: 'string' },
    enjoys: { type: 'array', items: { type: 'string' } },
    used: { type: 'array', items: { type: 'integer' } },
    left_out: { type: 'array', items: { type: 'string' } },
  },
}

export type DraftResult =
  | { ok: true; about: string; enjoys: string[]; sources: { label: string; via: string; by: string; at: string }[]; dropped: string[]; left_out: string[] }
  | { ok: false; why: string }

/** Ask the AI for a draft and check it. fetchImpl and apiKey are given (the function's secret). One retry if the first
    draft trips the sensitive-word or names check. Nothing is saved here. */
export async function draftFromLifeStory(srcs: ReturnType<typeof lifeSources>, firstName: string, apiKey: string, fetchImpl: typeof fetch = fetch, familyNames: string[] = []): Promise<DraftResult> {
  if (!srcs.length) return { ok: false, why: `Nothing in ${firstName || 'their'} Life Story yet. Add an answer on Home & Life (or ask at the next call), then try again.` }
  if (!apiKey) return { ok: false, why: 'The AI key is not set up on the server.' }
  const sourceText = srcs.map((s) => s.text).join(' \n ')
  const user = `Client first name: ${firstName || 'the client'}\n\n` + srcs.map((s, i) => `[${i + 1}] ${s.label}: ${s.text}`).join('\n')
  let note = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    let j: Any
    try {
      const r = await fetchImpl('https://api.anthropic.com/v1/messages', { method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'server-side-fallback-2026-07-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: DRAFT_MODEL, max_tokens: 4000, system: SYSTEM, fallbacks: 'default',
          output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
          messages: [{ role: 'user', content: user + (note ? `\n\nYour last draft was not usable: ${note}. Write it again following the rules.` : '') }] }) })
      j = await r.json().catch(() => ({}))
      if (!r.ok) return { ok: false, why: 'The AI could not be reached just now. Try again in a minute.' }
    } catch { return { ok: false, why: 'The AI could not be reached just now. Try again in a minute.' } }
    if (j?.stop_reason === 'refusal') return { ok: false, why: 'The AI declined to draft this one. Please write it yourself.' }
    const text = (Array.isArray(j?.content) ? j.content : []).filter((b: Any) => b?.type === 'text').map((b: Any) => b.text).join('')
    let d: Any; try { d = JSON.parse(text) } catch { return { ok: false, why: 'The AI answer could not be read. Try again.' } }
    if (d.enough === false || !S(d.about)) return { ok: false, why: `There isn't enough in ${firstName || 'their'} Life Story for an introduction yet. Add a little more about what they enjoy, then try again.` }
    const about = S(d.about)
    const hit = sensitiveHit(about) || (Array.isArray(d.enjoys) ? d.enjoys.map((x: unknown) => sensitiveHit(S(x))).find(Boolean) : null)
    const people = peopleNames(sourceText, familyNames).filter((n) => n.toLowerCase() !== S(firstName).toLowerCase())
    const named = people.filter((n) => new RegExp('\\b' + n + '\\b').test(about + ' ' + (Array.isArray(d.enjoys) ? d.enjoys.join(' ') : '')))
    const names = [...unknownNames(about, sourceText, firstName), ...named]
    if (hit || names.length) { note = hit ? `it mentioned "${hit}", which must be left out` : `it used names that are not in the sources or belong to other people (${names.join(', ')})`; continue }
    const a = cleanAbout(about); if (!a.ok) { note = a.error; continue }
    const dropped: string[] = []
    const items = (Array.isArray(d.enjoys) ? d.enjoys : []).map((x: unknown) => S(x).replace(/\.$/, '')).filter(Boolean)
      .filter((x: string) => { const keep = grounded(x, sourceText) && x.length <= 30; if (!keep) dropped.push(x); return keep }).slice(0, 6)
    const e = cleanEnjoys(items); if (!e.ok) { note = e.error; continue }
    const used = (Array.isArray(d.used) ? d.used : []).map((n: unknown) => Number(n)).filter((n: number) => n >= 1 && n <= srcs.length)
    const sources = (used.length ? [...new Set(used)].map((n) => srcs[n - 1]) : srcs).map((s) => ({ label: s.label, via: s.via, by: s.by, at: s.at }))
    return { ok: true, about: a.text, enjoys: e.items, sources, dropped, left_out: (Array.isArray(d.left_out) ? d.left_out : []).map(S).filter(Boolean).slice(0, 5) }
  }
  return { ok: false, why: 'The AI kept including something that must be left out (' + note + '). Please write this one yourself.' }
}
