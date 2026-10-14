// =============================================================================
// interview-review · the AI Interview Review, a second set of ears (2026-10-13)
// =============================================================================
// Samantha approved the Interview Notes and AI Review preview ("yes to all", https://claude.ai/artifact/Ki7QEvLaDWqTQ5UAxuHGXp)
// and said "build". Office staff only (requireStaff). Runs ONLY when a person taps it (Analyze Interview, or Check before
// they leave); there is no schedule and nothing calls it by itself.
//   • {applicant_id, kind:'full'|'check'}: reads that applicant's interview recordings that have consent and a finished
//     transcript (part 1, part 2...), the questions meant to be asked and a few facts from their application (nothing
//     private), and asks Claude for a review under the rules in _shared/interview-review.ts. Every quote is checked
//     against the transcript; the counts (talk share, talking over, longest answer) come from the timings.
//   • The review is saved as a new row in interview_reviews and never edited afterwards; the office's Confirm / Correct /
//     Dismiss and notes go in its own "marks" column. The interviewer's own notes are never touched.
//   • No hiring recommendation, score or verdict, by design.
// Secrets: ANTHROPIC_API_KEY. Model: INTERVIEW_REVIEW_MODEL (default below).
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { applicationFacts, buildPrompt, stats, transcriptText, verify, type Kind, type Part } from '../_shared/interview-review.ts'

const MODEL = Deno.env.get('INTERVIEW_REVIEW_MODEL') || 'claude-sonnet-5-5'
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const who = await requireStaff(db, req, OFFICE_ROLES)
  if (!who.ok) return json({ error: who.error }, who.status)
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ error: 'The AI is not set up on the server (ANTHROPIC_API_KEY).' }, 500)

  // deno-lint-ignore no-explicit-any
  const b: any = await req.json().catch(() => ({}))
  const id = String(b.applicant_id || '').trim()
  const kind: Kind = b.kind === 'check' ? 'check' : 'full'
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'which applicant?' }, 400)

  const { data: a, error: aErr } = await db.from('job_applicants').select('*').eq('id', id).maybeSingle()
  if (aErr) return json({ error: aErr.message }, 500)
  if (!a) return json({ error: 'That applicant was not found.' }, 404)

  const { data: recs, error: rErr } = await db.from('recordings')
    .select('id, created_at, status, consent_given, turns, transcript, seconds').eq('kind', 'interview').eq('subject_id', id).order('created_at')
  if (rErr) return json({ error: rErr.message }, 500)
  const usable = (recs || []).filter((r) => r.consent_given === true && r.status === 'done' && Array.isArray(r.turns) && r.turns.length)
  if (!usable.length) {
    const why = (recs || []).some((r) => r.consent_given !== true) ? 'a recording without consent is never read'
      : (recs || []).some((r) => r.status !== 'done') ? 'the transcript is not finished yet' : 'there is no interview recording for them'
    return json({ error: `Nothing to read yet: ${why}.` }, 409)
  }
  const parts: Part[] = usable.map((r, i) => ({ rec: String(r.id), part: i + 1, turns: r.turns }))

  const position = a.position || 'caregiver'
  let { data: qs } = await db.from('interview_questions').select('question, sort').eq('position', position).eq('active', true).order('sort')
  if (!qs?.length) qs = (await db.from('interview_questions').select('question, sort').eq('position', 'caregiver').eq('active', true).order('sort')).data ?? []
  const facts = applicationFacts(a)
  const prompt = buildPrompt(kind, String(a.first_name || '').trim(), transcriptText(parts), (qs || []).map((q, i) => `${i + 1}. ${q.question}`), facts)

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: kind === 'check' ? 2000 : 6000, messages: [{ role: 'user', content: prompt }] }),
  }).catch((e) => ({ ok: false, status: 0, json: async () => ({ error: { message: String(e) } }) }) as unknown as Response)
  // deno-lint-ignore no-explicit-any
  const body: any = await r.json().catch(() => ({}))
  if (!r.ok) return json({ error: 'The AI did not answer: ' + (body?.error?.message || r.status) }, 502)
  const raw = (body.content ?? []).map((c: { text?: string }) => c.text ?? '').join('')
  const m = raw.match(/\{[\s\S]*\}/)
  // deno-lint-ignore no-explicit-any
  let parsed: any = null
  try { parsed = m ? JSON.parse(m[0]) : null } catch { parsed = null }
  if (!parsed) return json({ error: 'The AI answer could not be read. Nothing was saved; try again.' }, 502)

  const v = verify(parsed, parts, facts)
  const waiting = (recs || []).filter((r) => r.consent_given === true && r.status !== 'done' && r.status !== 'failed').length
  const review = { kind, summary: v.summary, parts_still_transcribing: waiting, items: v.items, applicant_speaker: v.applicant, dropped_unverified: v.dropped,
    stats: kind === 'full' && v.applicant ? stats(parts, v.applicant) : null,
    parts: parts.map((p) => ({ rec: p.rec, part: p.part })) }
  const { data: row, error: wErr } = await db.from('interview_reviews').insert({
    applicant_id: id, kind, model: MODEL, created_by: who.name || who.email, review, recording_ids: parts.map((p) => p.rec),
  }).select('id, created_at').single()
  if (wErr) return json({ error: 'The review could not be saved: ' + wErr.message }, 500)
  return json({ ok: true, id: row.id, created_at: row.created_at, review })
})
