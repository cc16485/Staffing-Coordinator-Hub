// =============================================================================
// lead-readiness (pure part) · "how serious they sound" for the ranked Leads list (770)
// =============================================================================
// Samantha 2026-10-15: "be able to know order of importance....how serious they sound, how many hours they want, put a
// dollar amount on them when we can". Approved mockup Part 1: https://claude.ai/artifact/MhFEgbLXTzmPCbegzHVv49
// One read per family whenever what we know about them changes: Ready now / Deciding / Just looking, the reason in their
// own words, and the hours a week if they said a number. Only a reading; nothing on the lead changes, nobody is contacted.
// =============================================================================
// deno-lint-ignore-file no-explicit-any
export const MODEL = 'claude-sonnet-5-5'
export const LEVELS = ['ready', 'deciding', 'looking'] as const

export const TOOL = {
  name: 'rate_readiness', strict: true,
  description: 'Say how ready this family is to start in-home care, why, and the hours a week they asked for.',
  input_schema: { type: 'object', additionalProperties: false, required: ['level', 'why', 'hours_per_week'],
    properties: {
      level: { type: 'string', enum: [...LEVELS], description: 'ready: they need help now or by a near date, have decided to get help, or are arranging a start. deciding: a real need, but comparing, waiting on money, benefits or a family decision, or no timeline. looking: getting prices or information for later, no current need.' },
      why: { type: 'string', description: 'One short sentence (under 25 words) saying why. Quote the family\'s own words in double quotes when you can. Never name office staff. No dashes used as punctuation.' },
      hours_per_week: { type: ['number', 'null'], description: 'Hours of care a week they asked for, only if they said a number or a schedule you can add up (for example 3 mornings of 4 hours = 12). Otherwise null.' } } },
}
const SYSTEM = `You help a small in-home senior care agency in Springfield, Missouri decide which new families to call first.
You get what the office knows about ONE family: the inquiry form, short summaries of their phone calls, and the history of texts and calls.
Judge how ready they are to start care, from what THEY said and did, not from what the office hoped. A family that asked for a start date, said they need someone this week, has a hospital discharge coming, or is booking the home visit is ready. A family comparing agencies, waiting on long-term care insurance, the VA, or a sibling's say, or with no timeline is deciding. A family getting prices "for down the road" is looking.
When there is too little to tell, answer deciding with the reason "Not enough to tell yet".
Answer only with the rate_readiness tool.`

export type Input = { text: string; source: 'call' | 'form' }

const clip = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
/** What the reader sees about one lead (no phone numbers, emails or addresses). */
export function inputFor(l: any, summaries: string[]): Input {
  const lines: string[] = []
  const add = (k: string, v: unknown) => { const t = clip(typeof v === 'object' && v ? JSON.stringify(v) : v, 600); if (t && t !== '[]' && t !== '{}') lines.push(`${k}: ${t}`) }
  add('Source', l.source); add('Came in', String(l.created_at || '').slice(0, 10)); add('Status', l.status)
  add('Relationship of the caller', l.relationship); add('Why they called', l.why_called); add('Why now', l.call_profile?.facts?.why_now)
  add('Wanted start', l.desired_start || l.desired_start_kind); add('Schedule asked', l.schedule || [l.days_needed, l.times_needed].filter(Boolean).join(' '))
  add('Hours a week on the form', l.number_of_hours); add('Pays with', l.funding_source); add('Needs', l.needs); add('Health', l.medical_conditions)
  add('Notes', l.notes); add('Waiting on', l.waiting_on); add('Follow-up note', l.follow_up_note)
  const hist = (Array.isArray(l.comm_log) ? l.comm_log : []).filter((c: any) => c && c.body && !/^💬 Automatic text/.test(String(c.body)))
    .slice(-20).map((c: any) => `${String(c.at || '').slice(0, 16)} ${clip(c.body, 300)}`)
  const sums = summaries.filter(Boolean).slice(0, 6).map((s) => clip(s, 700))
  const text = [lines.join('\n'), sums.length ? 'Phone call summaries (newest first):\n' + sums.map((s) => '- ' + s).join('\n') : '', hist.length ? 'History (oldest first):\n' + hist.join('\n') : '']
    .filter(Boolean).join('\n\n').replace(/\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}/g, '(phone)').replace(/[\w.%+-]+@[\w.-]+\.[a-z]{2,}/gi, '(email)')
  return { text, source: sums.length || hist.some((h) => /☎/.test(h)) ? 'call' : 'form' }
}

export function request(inp: Input, today: string) {
  return {
    model: MODEL, max_tokens: 600,
    betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    system: SYSTEM, tools: [TOOL], tool_choice: { type: 'auto' },
    messages: [{ role: 'user', content: `Today is ${today} (Central time).\n\n<family>\n${inp.text.slice(0, 20000)}\n</family>` }],
  }
}

/** The reading from a Messages API response, held to its shape, or null. */
export function answer(resp: any): { level: string; why: string; hours_per_week: number | null } | null {
  if (!resp || resp.stop_reason === 'refusal') return null
  const tu = (resp.content || []).find((b: any) => b && b.type === 'tool_use' && b.name === TOOL.name)
  const a = tu?.input
  if (!a || !LEVELS.includes(a.level)) return null
  const h = Number(a.hours_per_week)
  return { level: a.level, why: clip(a.why, 220).replace(/\s[—–]\s/g, ', ').replace(/[—–]/g, ', '),
    hours_per_week: Number.isFinite(h) && h > 0 && h <= 168 ? Math.round(h * 2) / 2 : null }
}

/** Families worth reading: open inquiries (not Lost, Converted, archived, spam or test). */
export function openLead(l: any): boolean {
  if (!l || typeof l !== 'object' || !l.id) return false
  if (l.archived === true || l.is_test === true || l.spam) return false
  return !['Lost', 'Converted'].includes(String(l.status || 'New'))
}

export async function fingerprint(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
}
