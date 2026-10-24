// =============================================================================
// cara-reply.ts · CARA PHASE 1: UNDERSTANDING A CAREGIVER'S ANSWER TO A SHIFT ASK (Samantha, 2026-10-23: "Understand and
// record their responses"). Until now a reply was read by keywords only; anything else became a question for a person.
// The AI (the same model and key the other reply readers use) sorts one reply into:
//   yes             they will take it
//   yes_condition   yes, with a limit ("yes but only until 3", "yes if I can bring my daughter")
//   no              they won't
//   question        they ask something
//   other_shift     they are answering about a different client or day
//   unclear         anything else
// Safety, in this order: the AI never makes anyone assigned (a yes is interest; the office confirms); when the plain word
// rules and the AI disagree (a "can't" the AI read as yes, a clean yes the AI read as no), a person decides; the AI not
// answering = the word rules, as today. Nothing is texted back here (her rule 2026-09-19: collect every yes, answer
// nobody until the office chooses). Switch ops_settings.cara_reply_ai_live: true = live; 'practice' = the AI's reading is
// kept beside the word rules' answer (ai_read_practice) and the word rules decide; off (default) = no AI call at all.
// =============================================================================
// deno-lint-ignore-file no-explicit-any
type Any = any
const S = (v: unknown, n = 300) => String(v ?? '').trim().slice(0, n)

export type ReplyRead = { answer: 'yes' | 'yes_condition' | 'no' | 'question' | 'other_shift' | 'unclear'; condition: string | null; quote: string | null; failed: boolean }
const ANSWERS = ['yes', 'yes_condition', 'no', 'question', 'other_shift', 'unclear']

export async function readShiftReply(text: string, kase: Any, fetchImpl: typeof fetch = fetch): Promise<ReplyRead> {
  const failed: ReplyRead = { answer: 'unclear', condition: null, quote: null, failed: true }
  const key = (globalThis as Any).Deno?.env?.get?.('ANTHROPIC_API_KEY') || ''
  if (!key || !S(text)) return failed
  const first = (n: unknown) => { const w = S(n, 80).split(/\s+/).filter(Boolean); return (w.length > 1 ? w.slice(0, -1) : w).join(' ') }
  try {
    const r = await fetchImpl('https://api.anthropic.com/v1/messages', { method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 200, temperature: 0,
        system: 'A home-care office texted a caregiver asking if they can cover ONE shift (client first name, day, time). You read the '
          + 'caregiver\'s reply. answer: "yes" (they will take it, no limits), "yes_condition" (yes, but with a limit or a condition: a '
          + 'shorter time, a later start, needing something), "no", "question" (they ask something before answering), "other_shift" '
          + '(the reply is about a different client, day or time than the one asked), or "unclear". condition: for yes_condition, the '
          + 'limit in a few words, else null. quote: their own words that decide it, copied exactly (under 120 characters). Never guess: '
          + 'unclear is fine. Answer ONLY minified JSON: {"answer":"...","condition":null,"quote":"..."}',
        messages: [{ role: 'user', content: `The shift asked about: ${first(kase?.client) || 'a client'}, ${S(kase?.shift_date, 20)} ${S(kase?.shift_time, 20)}\n\nTheir reply:\n${S(text, 800)}` }] }) })
    if (!r.ok) return failed
    const j = await r.json().catch(() => null)
    const m = String(j?.content?.[0]?.text ?? '').match(/\{[\s\S]*\}/); if (!m) return failed
    const o = JSON.parse(m[0])
    if (!ANSWERS.includes(o?.answer)) return failed
    return { answer: o.answer, condition: o.answer === 'yes_condition' ? S(o.condition, 160) || 'a condition (see their words)' : null, quote: S(o.quote, 160) || null, failed: false }
  } catch { return failed }
}

/** The case's answer from the word rules and the AI together. state is what the ask becomes; why is shown on the case. */
export function settleReply(words: { isYes: boolean; isNo: boolean }, ai: ReplyRead | null): { state: 'yes' | 'no' | 'inquiry'; condition: string | null; why: string; by: string } {
  const w = words.isYes ? 'yes' : words.isNo ? 'no' : 'unclear'
  if (!ai || ai.failed) return { state: w === 'unclear' ? 'inquiry' : w, condition: null, why: 'read by the word rules', by: 'words' }
  const aiYes = ai.answer === 'yes' || ai.answer === 'yes_condition'
  if (w === 'yes' && !aiYes) return { state: 'inquiry', condition: null, why: `the words read yes, the AI read "${ai.answer}": a person decides`, by: 'both, disagreed' }
  if (w === 'no' && ai.answer !== 'no') return { state: 'inquiry', condition: null, why: `the words read no, the AI read "${ai.answer}": a person decides`, by: 'both, disagreed' }
  if (aiYes) return { state: 'yes', condition: ai.condition, why: ai.answer === 'yes_condition' ? 'yes, with a condition' : 'yes', by: w === 'yes' ? 'words and AI' : 'AI' }
  if (ai.answer === 'no') return { state: 'no', condition: null, why: 'no', by: w === 'no' ? 'words and AI' : 'AI' }
  return { state: 'inquiry', condition: null, why: ai.answer === 'other_shift' ? 'about a different shift: a person places it' : ai.answer === 'question' ? 'a question' : 'unclear', by: 'AI' }
}
