// Care plan Stage 1 (2026-10-29, Samantha approved "From Visit to First Shift" Stage 1: https://claude.ai/artifact/V4SexZo9o1DTb7Ssr4iyUL).
// The draft written from the WHOLE home visit, kept apart from the function so the tests run it.
//   • Every caregiver task has six parts: when, how to help (steps in order), equipment and supplies, their preferences,
//     safety, and what to report to the office. Each part (each step of "how") must name its source: a visit answer by its
//     path, a phone-call draft field, the earlier care plan, or the family's exact words on the recording. A part with no
//     source that checks out comes back EMPTY and marked ask ("Ask before approving"). Nothing is made up.
//   • Tasks only from AxisCare's own task list; days only from the visit's schedule when it has one.
//   • No scope rule is assumed (her rule 7): the draft never says a task is allowed or not allowed.
//   • Nothing is saved here. The Hub keeps the draft as a version that a person reviews and approves.

export type Turn = { speaker?: string; name?: string; start?: number; text?: string }
export type Part = { rec: string; part: number; offset: number; turns: Turn[] }
export type Fact = { path: string; label: string; section?: string; value: string }
export type Src = { path?: string; call?: string; earlier?: boolean; quote?: string; at?: number; rec?: string }
export type Line = { text: string; src: Src[]; ask: boolean }
export type Task = { adl_id: number; name: string; key?: string; days: string[]; require: 1 | 2; when: number; parts: Record<string, Line> & { how: { steps: Line[]; ask: boolean } } }

export const PLAN_FIELDS = ['adl_needs', 'iadl_needs', 'medical_conditions', 'medications', 'safety_concerns', 'client_goals', 'services_recommended', 'recommended_frequency', 'recommended_hours_per_week', 'narrative'] as const
export const PARTS = ['when', 'how', 'equipment', 'preferences', 'safety', 'report_if'] as const
export const DAYS = ['N', 'M', 'T', 'W', 'R', 'F', 'S']   // AxisCare: N = Sunday, R = Thursday
const WEEK: Record<string, string> = { sun: 'N', mon: 'M', tue: 'T', wed: 'W', thu: 'R', fri: 'F', sat: 'S' }

export const norm = (s: string) => String(s || '').toLowerCase().replace(/[‘’]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim()
const clock = (s: number) => { s = Math.max(0, Math.round(s)); return Math.floor(s / 3600) + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0') }
const clip = (v: unknown, n: number) => String(v ?? '').replace(/\s*\u2014\s*/g, ', ').trim().slice(0, n)

export function transcriptText(parts: Part[]): string {
  return parts.map((p) => p.turns.map((t) => `[${clock(p.offset + (Number(t.start) || 0))}] ${parts.length > 1 ? 'P' + p.part + ' ' : ''}${t.name || t.speaker || 'Speaker'}: ${t.text || ''}`).join('\n')).join('\n')
}
export function findQuote(parts: Part[], quote: string): { rec: string; at: number } | null {
  const q = norm(quote); if (q.length < 6) return null
  for (const p of parts) for (const t of p.turns) if (norm(t.text || '').includes(q)) return { rec: p.rec, at: Math.round(p.offset + (Number(t.start) || 0)) }
  return null
}

// deno-lint-ignore no-explicit-any
export function cleanFacts(raw: any): Fact[] {
  const out: Fact[] = [], seen = new Set<string>()
  for (const f of (Array.isArray(raw) ? raw : []).slice(0, 400)) {
    const path = String(f?.path || ''), value = clip(f?.value, 1500)
    if (!/^[a-z_]+(\.[a-z0-9_:]+){0,5}$/i.test(path) || !value || seen.has(path)) continue
    seen.add(path); out.push({ path, label: clip(f?.label || path, 140), section: clip(f?.section, 60), value })
  }
  return out
}
/** the schedule's days in AxisCare letters, from visit.week {mon:{from,to}} */
// deno-lint-ignore no-explicit-any
export function scheduleDays(week: any): string[] {
  return Object.keys(WEEK).filter((d) => week && week[d] && week[d].from && week[d].to).map((d) => WEEK[d])
}

export function buildPrompt(o: { client: string; facts: Fact[]; call: Record<string, string>; earlier: string; transcript: string; adls: { id: number; name: string }[]; days: string[] }): string {
  return `You are drafting an in-home care plan for Caring Companions, a non-medical home care agency in Springfield, Missouri, from a care coordinator's home visit with ${o.client || 'the client'} and their family. A coordinator will review and edit every line before anything is approved or sent to caregivers.

Goal: a caregiver who has never met the client can read the plan and know exactly how to give safe, respectful, personal care from the first shift.

<visit_answers>
${o.facts.map((f) => `${f.path} | ${f.section ? f.section + ': ' : ''}${f.label} | ${f.value}`).join('\n') || '(none)'}
</visit_answers>

<phone_call_draft>
${Object.keys(o.call).map((k) => `call:${k} | ${o.call[k]}`).join('\n') || '(none)'}
</phone_call_draft>

<earlier_care_plan>
${o.earlier || '(none)'}
</earlier_care_plan>

<recording_transcript>
${o.transcript.slice(0, 200000) || '(no recording written out yet)'}
</recording_transcript>

<axiscare_task_list>
${o.adls.map((a) => `${a.id}: ${a.name}`).join('\n') || '(could not be read; return no tasks)'}
</axiscare_task_list>

The visit schedule's days, in AxisCare letters (N Sun, M, T, W, R Thu, F, S): ${o.days.join(', ') || '(no schedule yet)'}

Rules you must follow:
- Use only what the sources above say. Never invent a fact, a preference, a location, a step, a medicine, a diagnosis or a risk. If something a caregiver would need is not in the sources, leave that part empty and add it to "ask".
- Every line names its sources in "src": {"path": "<a path from visit_answers>"}, {"call": "<a key after call: in phone_call_draft>"}, {"earlier": true}, or {"quote": "<the family's exact words copied character for character from the transcript>"}. A line with no real source will be thrown away.
- Answers marked as reported by the family stay reported; do not turn a guess into a fact.
- Tasks: pick only from axiscare_task_list by its number, only for help the visit shows is needed. days only from the schedule's days (all of them if a task happens every visit). require 1 = always, 2 = as needed. when 0 any time, 1 morning, 2 afternoon, 3 evening, 4 night.
- Each task has six parts: when (time of day and how often, in words), how (the steps in order, short and practical, each its own line), equipment (equipment and supplies, and where they are kept), preferences (how the client likes it done, dignity and privacy, what they still do themselves), safety (precautions for this task), report_if (what changes the caregiver must report to the office).
- Do not decide whether a task is allowed for a payer or within a caregiver's training. The coordinator decides that.
- Write for a caregiver: plain words, short sentences, the client's first name. No em dashes. Do not mention software or a model.

Reply with JSON only:
{"fields":{"adl_needs":{"text":"","src":[]},"iadl_needs":{...},"medical_conditions":{...},"medications":{...},"safety_concerns":{...},"client_goals":{...},"services_recommended":{...},"recommended_frequency":{...},"recommended_hours_per_week":{...},"narrative":{...}},
 "tasks":[{"adl_id":0,"days":["M"],"require":1,"when":1,
   "when_text":{"text":"","src":[]},"how":[{"text":"step 1","src":[]}],"equipment":{"text":"","src":[]},"preferences":{"text":"","src":[]},"safety":{"text":"","src":[]},"report_if":{"text":"","src":[]}}],
 "ask":["a question the coordinator should answer before approving"]}
At most 20 tasks and 12 ask items.`
}

/* a source checks out when it names a real visit answer, a real call field, the earlier plan (when there is one), or words
   really said on the recording (the time and part come from the transcript, never from the model) */
// deno-lint-ignore no-explicit-any
export function checkSrc(raw: any, ctx: { paths: Set<string>; call: Set<string>; earlier: boolean; parts: Part[] }): Src[] {
  const out: Src[] = []
  for (const s of (Array.isArray(raw) ? raw : []).slice(0, 6)) {
    if (s && typeof s.path === 'string' && ctx.paths.has(s.path)) out.push({ path: s.path })
    else if (s && typeof s.call === 'string' && ctx.call.has(s.call)) out.push({ call: s.call })
    else if (s && s.earlier === true && ctx.earlier) out.push({ earlier: true })
    else if (s && typeof s.quote === 'string') { const w = findQuote(ctx.parts, s.quote); if (w) out.push({ quote: clip(s.quote, 300), ...w }) }
  }
  return out
}
// deno-lint-ignore no-explicit-any
function line(raw: any, ctx: Parameters<typeof checkSrc>[1], n = 1200): Line {
  const text = clip(raw?.text, n), src = text ? checkSrc(raw?.src, ctx) : []
  return text && src.length ? { text, src, ask: false } : { text: '', src: [], ask: true }
}

// deno-lint-ignore no-explicit-any
export function verify(parsed: any, ctx: { paths: Set<string>; call: Set<string>; earlier: boolean; parts: Part[]; adls: { id: number; name: string; adlKey?: string }[]; days: string[] }) {
  let dropped = 0
  const fields: Record<string, Line> = {}
  for (const k of PLAN_FIELDS) { const l = line(parsed?.fields?.[k], ctx, 4000); if (l.ask && String(parsed?.fields?.[k]?.text || '').trim()) dropped++; fields[k] = l }
  const tasks: Task[] = [], seen = new Set<number>()
  for (const t of (Array.isArray(parsed?.tasks) ? parsed.tasks : []).slice(0, 20)) {
    const a = ctx.adls.find((x) => x.id === Number(t?.adl_id))
    if (!a || seen.has(a.id)) { dropped++; continue }
    seen.add(a.id)
    let days = [...new Set((Array.isArray(t?.days) ? t.days : []).map(String))].filter((d) => DAYS.includes(d))
    if (ctx.days.length) days = days.filter((d) => ctx.days.includes(d))
    if (!days.length) days = ctx.days.slice()
    days.sort((x, y) => DAYS.indexOf(x) - DAYS.indexOf(y))
    const require: 1 | 2 = Number(t?.require) === 2 ? 2 : 1
    let when = Number(t?.when); if (!Number.isInteger(when) || when < 0 || when > 4 || require === 2) when = 0
    const steps: Line[] = []
    for (const s of (Array.isArray(t?.how) ? t.how : []).slice(0, 12)) { const l = line(s, ctx, 400); if (l.ask) dropped++; else steps.push(l) }
    const part = (k: string) => { const l = line(t?.[k], ctx); if (l.ask && String(t?.[k]?.text || '').trim()) dropped++; return l }
    tasks.push({ adl_id: a.id, name: a.name, ...(a.adlKey ? { key: a.adlKey } : {}), days, require, when,
      parts: { when: part('when_text'), how: { steps, ask: !steps.length }, equipment: part('equipment'), preferences: part('preferences'), safety: part('safety'), report_if: part('report_if') } as Task['parts'] })
  }
  const ask = (Array.isArray(parsed?.ask) ? parsed.ask : []).map((x: unknown) => clip(x, 300)).filter(Boolean).slice(0, 12)
  return { fields, tasks, ask, dropped }
}
