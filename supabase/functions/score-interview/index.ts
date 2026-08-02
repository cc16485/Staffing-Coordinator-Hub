// Supabase Edge Function: score-interview  (shared hub project)
// -----------------------------------------------------------------------------
// Reads a recorded interview and fills in the answers, so nobody sits typing
// while somebody is talking to them.
//
// It takes the transcript, the questions that were meant to be asked, and the
// No go / Acceptable / Amazing guide written against each one, and returns for
// every question: what the applicant actually said, and which of the three it
// looks like.
//
// DRAFT-FIRST, like everything else here. Nothing it decides is saved as a
// decision. Every answer lands in the interview screen marked as a suggestion,
// and stays a suggestion until a person confirms it. The hiring call belongs to
// Krystal or Lydia or Samantha, and a machine that has never met somebody does
// not get to make it.
//
// Secrets: ANTHROPIC_API_KEY
// Deploy:  supabase functions deploy score-interview
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const AI_MODEL = 'claude-haiku-4-5-20251001'
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY is not set on this project' }, 500)

  const { recording_id } = await req.json().catch(() => ({}))
  if (!recording_id) return json({ error: 'no recording given' }, 400)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: rec } = await supabase
    .from('recordings').select('*').eq('id', recording_id).maybeSingle()
  if (!rec) return json({ error: 'no such recording' }, 404)
  if (rec.kind !== 'interview') return json({ error: 'that recording is not an interview' }, 400)
  if (!rec.transcript) return json({ error: 'that recording has not been transcribed yet' }, 400)

  const { data: applicant } = await supabase
    .from('job_applicants').select('id, first_name, last_name, position')
    .eq('id', rec.subject_id).maybeSingle()

  const position = applicant?.position || 'caregiver'
  let { data: questions } = await supabase
    .from('interview_questions').select('id, section, sort, question, guidance, rubric')
    .eq('position', position).eq('active', true).order('sort')
  if (!questions?.length) {
    const fallback = await supabase
      .from('interview_questions').select('id, section, sort, question, guidance, rubric')
      .eq('position', 'caregiver').eq('active', true).order('sort')
    questions = fallback.data ?? []
  }
  if (!questions.length) return json({ error: 'there are no interview questions set up' }, 400)

  const asked = questions.map((q) =>
    `ID: ${q.id}\nQuestion: ${q.question}` +
    (q.guidance ? `\nWhat it is for: ${q.guidance}` : '') +
    (q.rubric
      ? `\nNo go: ${q.rubric.no_go ?? '(not written)'}` +
        `\nAcceptable: ${q.rubric.acceptable ?? '(not written)'}` +
        `\nAmazing: ${q.rubric.amazing ?? '(not written)'}`
      : '\n(No guide written for this one, so do not suggest a score.)'),
  ).join('\n\n')

  const prompt =
`You are helping a small home care agency in Springfield, Missouri write up a caregiver interview they have just recorded. Two or more people are in the room: a care coordinator and the applicant${applicant?.first_name ? `, ${applicant.first_name}` : ''}.

Here is the transcript, with speaker labels and timestamps. The labels are a guess by the transcriber, so work out from context who is the interviewer and who is the applicant.

<transcript>
${String(rec.transcript).slice(0, 120000)}
</transcript>

These are the questions the coordinator meant to ask, and the guide the agency wrote for judging each answer:

<questions>
${asked}
</questions>

For every question, return:
- "note": what the applicant actually said, in two or three sentences, in their own terms. Quote a short phrase of theirs where it captures something. If the question was never asked or they never really answered it, say so plainly and leave the score null.
- "score": one of "no_go", "acceptable", "amazing", judged against the guide for that question, or null when there is no guide or no real answer.
- "evidence": the single most telling line they said about it, quoted, or null.

Rules that matter:
- Only report what is in the transcript. Never fill a gap with what a good applicant would probably have said.
- The questions may have been asked out of order, reworded, or rolled together. Match on meaning, not on wording.
- Anything the applicant raised that the questions did not cover, and that somebody hiring would want to know, goes in "other". Keep it short and factual.

Reply with JSON only:
{"answers":[{"id":"<the question ID>","note":"...","score":"acceptable"|"amazing"|"no_go"|null,"evidence":"..."|null}],"other":"..."|null}`

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    const body = await r.json().catch(() => ({}))
    if (!r.ok) return json({ error: body?.error?.message || `the model said ${r.status}` }, 502)

    const raw = (body.content ?? []).map((c: { text?: string }) => c.text ?? '').join('')
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) return json({ error: 'the model did not return anything readable' }, 502)
    const parsed = JSON.parse(match[0])

    const valid = new Set(questions.map((q) => String(q.id)))
    const answers = (parsed.answers ?? [])
      .filter((a: { id?: string }) => a?.id && valid.has(String(a.id)))
      .map((a: { id: string; note?: string; score?: string; evidence?: string }) => ({
        id: String(a.id),
        note: (a.note ?? '').slice(0, 1200),
        score: ['no_go', 'acceptable', 'amazing'].includes(String(a.score)) ? a.score : null,
        evidence: a.evidence ? String(a.evidence).slice(0, 500) : null,
      }))

    // Kept on the recording, not written onto the applicant. It becomes part of
    // the interview record only when a person presses the button in the hub.
    await supabase.from('recordings')
      .update({ turns: rec.turns, error: null }).eq('id', recording_id)

    return json({ ok: true, answers, other: parsed.other ?? null, questions: questions.length })
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500)
  }
})
