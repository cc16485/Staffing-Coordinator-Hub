// The home visit's After screen: reading the visit recording (2026-10-29, stage 3 of the iPad home visit; Samantha approved
// the 8-screen mockup https://claude.ai/artifact/QRg36KyoT7FTZJVDfjhTun, "looks good, start building", and "continue").
// Kept apart from the function so the tests run it.
//   • The recording only ever offers answers for boxes that are EMPTY on the form (her rule). The Hub sends the list of
//     empty boxes; an answer for any other box is dropped here, and the Hub checks again before it writes.
//   • Nothing is saved by the server. The office taps Keep on each answer.
//   • Every offered answer must come with the family's own words, found in the transcript; the time comes from the
//     transcript, never from the model. An answer whose quote is not found is dropped and counted.
//   • A choice box only takes one of its own choices.
//   • A visit is recorded in 10-minute parts (stage 2), each written out on its own, so the voice labels restart in each
//     part. The model is shown "P2 Speaker A" style labels and says who each one is; the sample line comes from here.

export type Turn = { speaker?: string; name?: string; start?: number; end?: number; text?: string }
export type Part = { rec: string; part: number; offset: number; turns: Turn[] }
export type Field = { path: string; label: string; section?: string; options?: [string, string][] }
export type Person = { name: string; rel?: string }
export type Where = { rec: string; part: number; at: number; local: number; who: string }

export const norm = (s: string) => String(s || '').toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim()
export const clock = (s: number) => { s = Math.max(0, Math.round(s)); return Math.floor(s / 3600) + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0') }
const who = (t: Turn) => t.name || t.speaker || 'Speaker'
export const label = (parts: Part[], p: Part, t: Turn) => (parts.length > 1 ? 'P' + p.part + ' ' : '') + who(t)

export function transcriptText(parts: Part[]): string {
  return parts.map((p) => (parts.length > 1 ? `--- Part ${p.part} ---\n` : '') +
    p.turns.map((t) => `[${clock(p.offset + (Number(t.start) || 0))}] ${label(parts, p, t)}: ${t.text || ''}`).join('\n')).join('\n\n')
}

/* Where a quote was said: exact (normalized) first, then for longer quotes 80% of its words in order. */
export function findQuote(parts: Part[], quote: string): Where | null {
  const q = norm(quote); if (q.length < 3) return null
  const at = (p: Part, t: Turn): Where => ({ rec: p.rec, part: p.part, at: Math.round(p.offset + (Number(t.start) || 0)), local: Math.round(Number(t.start) || 0), who: label(parts, p, t) })
  for (const p of parts) for (const t of p.turns) if (norm(t.text || '').includes(q)) return at(p, t)
  const words = q.split(' ')
  if (words.length >= 6) {
    for (const p of parts) for (const t of p.turns) {
      const hay = norm(t.text || ''); let i = 0, hit = 0
      for (const w of words) { const j = hay.indexOf(w, i); if (j > -1) { hit++; i = j + w.length } }
      if (hit / words.length >= 0.8) return at(p, t)
    }
  }
  return null
}

/* Cleans what the Hub sent: at most 200 boxes, paths of the visit record only. */
// deno-lint-ignore no-explicit-any
export function cleanFields(raw: any): Field[] {
  const out: Field[] = [], seen = new Set<string>()
  for (const f of (Array.isArray(raw) ? raw : []).slice(0, 200)) {
    const path = String(f?.path || '')
    if (!/^(visit\.)?[a-z_]+(\.[a-z0-9_]+){0,4}$/.test(path) || seen.has(path)) continue
    seen.add(path)
    const opts = Array.isArray(f?.options) ? f.options.filter((o: unknown) => Array.isArray(o) && o.length === 2).map((o: unknown[]) => [String(o[0]).slice(0, 40), String(o[1]).slice(0, 60)] as [string, string]).slice(0, 8) : undefined
    out.push({ path, label: String(f?.label || path).slice(0, 120), section: String(f?.section || '').slice(0, 60), ...(opts && opts.length ? { options: opts } : {}) })
  }
  return out
}

export function buildPrompt(client: string, people: Person[], fields: Field[], known: string, transcript: string): string {
  const box = (f: Field) => `${f.path} | ${f.section ? f.section + ': ' : ''}${f.label}` + (f.options ? ` | choose one: ${f.options.map((o) => `${o[0]} (${o[1]})`).join(', ')}` : '')
  return `You are helping a small home care agency in Springfield, Missouri finish the notes from an in-home assessment visit. A care coordinator from Caring Companions visited ${client || 'the client'} at home and recorded the conversation with everyone's consent. The visit was recorded in parts of about 10 minutes and each part was written out separately, so the speaker labels restart in every part ("P1 Speaker A" in part 1 and "P2 Speaker A" in part 2 may be different people). The labels are the transcriber's guess.

<people_in_the_room>
${people.map((p) => `${p.name}${p.rel ? ' (' + p.rel + ')' : ''}`).join('\n') || '(not written down)'}
The Caring Companions coordinator (call them "Caring Companions")
</people_in_the_room>

<transcript>
${transcript.slice(0, 220000)}
</transcript>

<already_on_the_form>
${known || '(nothing yet)'}
</already_on_the_form>

<empty_boxes_you_may_fill>
${fields.map(box).join('\n')}
</empty_boxes_you_may_fill>

Rules you must follow:
- Only use what was said in the transcript. If something was not said clearly, leave the box out. Never guess, never infer a diagnosis, never add advice.
- Fill only boxes from the list above, by their exact path. Each box at most once.
- For a box with "choose one", the value is exactly one of its choice keys (the word before the brackets), and only if the conversation makes it clear.
- For other boxes, write a short value in everyday words, the way the coordinator would jot it (a phrase or one or two sentences). Keep the family's own details: names, times, places, amounts.
- Every filled box needs "quote": the exact words from the transcript that support it, copied character for character (a short phrase or one sentence). Never paraphrase inside a quote.
- "voices": for every speaker label in the transcript, say which person it is, using a name from the people list exactly, or "Caring Companions", or "Unknown" if you cannot tell.
- "missed": things the coordinator should follow up on: answers that contradict each other or the form, questions the family asked that were not answered, and details the form needs that were only half said (for example an allergy with no name). Word the text as a neutral point to ask about. Give the quote where it was said if there is one.
- Do not use em dashes. Do not mention that software or a model wrote this.

Reply with JSON only:
{"voices":[{"label":"P1 Speaker A","person":"..."}],
 "summary":"4 to 6 plain sentences: who they are, what is going on, what the family wants, and what was agreed.",
 "fills":[{"path":"visit.story.morning","value":"...","quote":"..."}],
 "missed":[{"title":"a few words","text":"one or two sentences","quote":"..."}]}
At most 60 fills and 8 missed.`
}

export type Fill = { path: string; value: string; quote: string } & Where
export type Missed = { title: string; text: string; quote?: string } & Partial<Where>
export type Voice = { label: string; person: string; sample: string; part: number; at: number; rec: string; local: number }

// deno-lint-ignore no-explicit-any
export function verify(parsed: any, parts: Part[], fields: Field[], people: Person[]) {
  const byPath = new Map(fields.map((f) => [f.path, f]))
  const fills: Fill[] = []; let dropped = 0
  const used = new Set<string>()
  for (const x of (Array.isArray(parsed?.fills) ? parsed.fills : []).slice(0, 80)) {
    const f = byPath.get(String(x?.path || '')); if (!f || used.has(f.path)) { dropped++; continue }
    let value = String(x?.value ?? '').replace(/\s*\u2014\s*/g, ', ').trim().slice(0, 600)
    if (f.options) { const o = f.options.find((o) => o[0] === value || norm(o[1]) === norm(value)); if (!o) { dropped++; continue } value = o[0] }
    if (!value) { dropped++; continue }
    const quote = String(x?.quote || '').trim().slice(0, 400), where = quote ? findQuote(parts, quote) : null
    if (!where) { dropped++; continue }
    used.add(f.path); fills.push({ path: f.path, value, quote, ...where })
  }
  const missed: Missed[] = []
  for (const x of (Array.isArray(parsed?.missed) ? parsed.missed : []).slice(0, 8)) {
    const title = String(x?.title || '').replace(/\s*\u2014\s*/g, ', ').trim().slice(0, 120), text = String(x?.text || '').replace(/\s*\u2014\s*/g, ', ').trim().slice(0, 500)
    if (!title && !text) continue
    const quote = String(x?.quote || '').trim().slice(0, 400), where = quote ? findQuote(parts, quote) : null
    missed.push({ title: title || text.slice(0, 60), text, ...(where ? { quote, ...where } : {}) })
  }
  /* every label in the transcript, with a sample line picked here (its longest early turn), and the model's guess if it is a real name */
  const allowed = new Set(people.map((p) => p.name).concat(['Caring Companions', 'Unknown']))
  const guess = new Map<string, string>()
  for (const v of Array.isArray(parsed?.voices) ? parsed.voices : []) { const p = String(v?.person || ''); guess.set(String(v?.label || ''), allowed.has(p) ? p : 'Unknown') }
  const voices: Voice[] = []
  for (const p of parts) {
    const seen = new Map<string, Turn>()
    for (const t of p.turns) { const l = label(parts, p, t), cur = seen.get(l); if (!cur || ((t.text || '').length > (cur.text || '').length && (Number(t.start) || 0) < 300)) seen.set(l, t) }
    for (const [l, t] of seen) voices.push({ label: l, person: guess.get(l) || 'Unknown', sample: String(t.text || '').slice(0, 160), part: p.part, rec: p.rec, at: Math.round(p.offset + (Number(t.start) || 0)), local: Math.round(Number(t.start) || 0) })
  }
  const summary = String(parsed?.summary || '').replace(/\s*\u2014\s*/g, ', ').trim().slice(0, 2000)
  return { summary, fills, missed, voices, dropped }
}
