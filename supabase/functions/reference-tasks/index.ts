// =============================================================================
// reference-tasks · what a reference can confirm, task by task (Samantha 2026-10-11, approving the Step 1 previews: "make the
// question more specific about what the reference can confirm from their own knowledge", answers that "distinguish actual
// confirmation from uncertainty", and a final question, "would feel comfortable having this caregiver provide similar care to
// someone they care about", with an optional explanation, treated as general reference feedback and not skill certification)
// =============================================================================
// PRACTICE HIRES ONLY: "No real caregiver records, reference requests, or live matching behavior should change yet." The
// reference form (reference.html) asks this first; for every request that is not a practice hire's it answers
// { practice: false } and the form is exactly today's. The request id in the link is the only key (as for reference_answer).
//   { action: 'view', r }                                   -> { practice, first, entries: [{ where, when, tasks: [{ key, label }] }] }
//   { action: 'save', r, task_confirm: { key: 'saw' | 'believe' | 'no' | 'unknown' }, comfort_why? }
//        -> kept on the request row while it is unanswered (the reference_answer database function then saves the rest and
//           closes it; until then they can change their answers); refused once answered
// Sends nothing. Changes no level, qualification, match or pay. Only these four columns of reference_requests are written:
// task_list (what they were asked), task_confirm, comfort_why, tasks_answered_at.
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { SKILLS } from '../_shared/step1-documents.ts'
import { entriesFor, TASK_ANSWERS } from '../_shared/step1-experience.ts'
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const S = (v: unknown, n = 200) => String(v ?? '').trim().slice(0, n)
const NOT_PRACTICE = { ok: true, practice: false }

/** The request, and (for a practice hire only) the Step 1 entries that name this reference. */
export async function lookup(db: any, r: string): Promise<{ row: any; practice: boolean; first: string; entries: any[] } | null> {
  const { data: row } = await db.from('reference_requests').select('id, candidate_id, slot, ref_name, ref_type, responded_at, task_confirm').eq('id', r).maybeSingle()
  if (!row) return null
  const { data: c } = await db.from('app_data').select('data').eq('key', 'candidates').maybeSingle()
  const cand = (Array.isArray(c?.data) ? c.data : []).find((x: any) => x && String(x.id) === String(row.candidate_id))
  const offer = S(cand?.offer_id, 64)
  if (!offer) return { row, practice: false, first: '', entries: [] }
  const { data: f } = await db.from('step1_forms').select('answers, practice').eq('offer_id', offer).maybeSingle()
  if (!f?.practice) return { row, practice: false, first: '', entries: [] }
  return { row, practice: true, first: S(cand?.first, 40), entries: entriesFor(f.answers || {}, row.ref_name) }
}
export const taskKeys = (entries: any[]) => [...new Set(entries.flatMap((e) => e.tasks))].filter((k) => k in SKILLS)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false, autoRefreshToken: false } })
  const b: any = await req.json().catch(() => ({}))
  const r = S(b.r, 64)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(r)) return json(NOT_PRACTICE)
  try {
    const L = await lookup(db, r)
    if (!L || !L.practice) return json(NOT_PRACTICE)
    const keys = taskKeys(L.entries)
    if (S(b.action, 10) === 'save') {
      if (L.row.responded_at) return json({ ok: false, error: 'already' }, 409)
      const tc = b.task_confirm && typeof b.task_confirm === 'object' && !Array.isArray(b.task_confirm) ? b.task_confirm : {}
      const clean: Record<string, string> = {}
      for (const [k, v] of Object.entries(tc)) { if (!keys.includes(k) || !(String(v) in TASK_ANSWERS)) return json({ ok: false, error: 'unknown answer' }, 400); clean[k] = String(v) }
      const left = keys.filter((k) => !clean[k])
      if (left.length) return json({ ok: false, error: 'Please answer every task.', missing: left }, 400)
      const { data, error } = await db.from('reference_requests').update({ task_list: keys, task_confirm: clean, comfort_why: S(b.comfort_why, 1000) || null, tasks_answered_at: new Date().toISOString() })
        .eq('id', r).is('responded_at', null).select('id')
      if (error) return json({ ok: false, error: 'Could not save.' }, 500)
      if (!data?.length) return json({ ok: false, error: 'already' }, 409)
      return json({ ok: true, practice: true, saved: keys.length })
    }
    return json({ ok: true, practice: true, first: L.first, answered: !!L.row.responded_at,
      entries: L.entries.map((e) => ({ kind: e.kind, where: e.where, when: e.when, tasks: e.tasks.map((k: string) => ({ key: k, label: SKILLS[k] })) })) })
  } catch {
    return json(NOT_PRACTICE)
  }
})
