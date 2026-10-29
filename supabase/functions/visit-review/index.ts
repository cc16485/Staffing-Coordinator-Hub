// =============================================================================
// visit-review · the home visit's After screen: what the recording heard (2026-10-29)
// =============================================================================
// Stage 3 of the iPad home visit (Samantha approved the mockup https://claude.ai/artifact/QRg36KyoT7FTZJVDfjhTun:
// "looks good, start building"; her rule: the recording fills EMPTY boxes in yellow for review, never overwrites).
// Office staff only (requireStaff). Runs ONLY when a person taps "Read the recording" on the After screen.
//   • {assessment_id, fields, people, known, client}: reads that visit's recordings (kind 'assessment', subject the
//     assessment) that have consent and a finished transcript, every 10-minute part in order, and asks Claude for a
//     summary, who each voice is, answers for the EMPTY boxes the Hub listed, and what was missed or unclear, under the
//     rules in _shared/visit-review.ts. Every answer's quote is checked against the transcript.
//   • Saves nothing. The Hub keeps the reading on the visit record and writes an answer into the form only when the
//     office taps Keep.
// Secrets: ANTHROPIC_API_KEY. Model: VISIT_REVIEW_MODEL (default below).
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { buildPrompt, cleanFields, transcriptText, verify, type Part, type Person } from '../_shared/visit-review.ts'

const MODEL = Deno.env.get('VISIT_REVIEW_MODEL') || 'claude-opus-5-5'
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
  if (!apiKey) return json({ error: 'The reader is not set up on the server (ANTHROPIC_API_KEY).' }, 500)

  // deno-lint-ignore no-explicit-any
  const b: any = await req.json().catch(() => ({}))
  const id = String(b.assessment_id || '').trim()
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(id)) return json({ error: 'which visit?' }, 400)
  const fields = cleanFields(b.fields)
  const people: Person[] = (Array.isArray(b.people) ? b.people : []).slice(0, 12)
    .map((p: { name?: unknown; rel?: unknown }) => ({ name: String(p?.name || '').trim().slice(0, 80), rel: String(p?.rel || '').trim().slice(0, 60) })).filter((p: Person) => p.name)
  const known = String(b.known || '').slice(0, 20000)

  const { data: recs, error: rErr } = await db.from('recordings')
    .select('id, created_at, status, consent_given, turns, session_id, part, offset_seconds').eq('kind', 'assessment').eq('subject_id', id)
    .order('created_at')
  if (rErr) return json({ error: rErr.message }, 500)
  const all = (recs || []).slice().sort((x, y) => (String(x.session_id || x.id) === String(y.session_id || y.id) ? (x.part || 0) - (y.part || 0) : String(x.created_at).localeCompare(String(y.created_at))))
  const usable = all.filter((r) => r.consent_given === true && r.status === 'done' && Array.isArray(r.turns) && r.turns.length)
  if (!usable.length) {
    const why = !all.length ? 'this visit has no recording' : all.some((r) => r.consent_given !== true) && !all.some((r) => r.consent_given === true) ? 'a recording without consent is never read'
      : 'the recording is still being written out. Try again in a few minutes'
    return json({ error: `Nothing to read yet: ${why}.` }, 409)
  }
  const parts: Part[] = usable.map((r, i) => ({ rec: String(r.id), part: i + 1, offset: Number(r.offset_seconds) || 0, turns: r.turns }))
  const prompt = buildPrompt(String(b.client || '').trim().slice(0, 80), people, fields, known, transcriptText(parts))

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 8000, messages: [{ role: 'user', content: prompt }] }),
  }).catch((e) => ({ ok: false, status: 0, json: async () => ({ error: { message: String(e) } }) }) as unknown as Response)
  // deno-lint-ignore no-explicit-any
  const body: any = await r.json().catch(() => ({}))
  if (!r.ok) return json({ error: 'The reader did not answer: ' + (body?.error?.message || r.status) + '. Nothing changed; try again.' }, 502)
  const raw = (body.content ?? []).map((c: { text?: string }) => c.text ?? '').join('')
  const m = raw.match(/\{[\s\S]*\}/)
  // deno-lint-ignore no-explicit-any
  let parsed: any = null
  try { parsed = m ? JSON.parse(m[0]) : null } catch { parsed = null }
  if (!parsed) return json({ error: 'The answer could not be read. Nothing changed; try again.' }, 502)

  const v = verify(parsed, parts, fields, people)
  const waiting = all.filter((r) => r.consent_given === true && r.status !== 'done' && r.status !== 'failed').length
  const failed = all.filter((r) => r.consent_given === true && r.status === 'failed').length
  return json({ ok: true, at: new Date().toISOString(), by: who.name || who.email, model: MODEL, ...v,
    parts: parts.map((p) => ({ rec: p.rec, part: p.part, offset: p.offset })), parts_waiting: waiting, parts_failed: failed })
})
