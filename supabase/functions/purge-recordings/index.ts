// Supabase Edge Function: purge-recordings  (shared hub project)
// -----------------------------------------------------------------------------
// Deletes interview and assessment audio once it has done its job, and keeps
// the transcript.
//
// Recording the room was worth building. Keeping the recording forever is not:
// it is somebody's voice, their work history and whatever they said about a
// previous employer, held indefinitely for no reason anybody could give if
// asked. The transcript is what the notes are written from and what an audit
// would want. The audio matters for about as long as it takes to check a quote.
//
// Deliberately careful about one thing: a recording with no transcript is NOT
// touched, whatever its age. If transcription failed, the audio is the only
// copy of that conversation, and deleting it would be throwing the interview
// away rather than tidying up. Those are counted and left alone.
//
// The file is removed through the storage API rather than by deleting the row
// underneath it, so the object itself actually goes.
//
// 649 (2026-10-14, Samantha: "2 years"): the interview record has an end too. Two years after an interview
// (recordings_settings.keep_interview_days, 730) its transcript is cleared, its AI reviews are deleted and the
// interviewer's observations are removed from the applicant. Anyone on a legal hold (job_applicants.records_hold_at)
// is never touched. The application and the interview answers on it are kept (a hire's personnel file).
//
// Runs daily by pg_cron. ?dry=1 reports without deleting.
// Deploy: supabase functions deploy purge-recordings
//
// Needs recordings-retention.sql to have been run first.
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jobCaller } from '../_shared/job-auth.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  /* J1 (2026-09-29): only its daily schedule or the owner's server key. Everyone else, the public key included, is
     refused before anything is read or deleted. */
  const caller = await jobCaller(req)
  if (!caller) return json({ error: 'not allowed' }, 401)
  if (new URL(req.url).searchParams.get('auth_check') === '1') return json({ ok: true, caller })
  const dry = new URL(req.url).searchParams.get('dry') === '1'

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: due, error } = await supabase.rpc('recordings_due_for_purge')
  if (error) return json({ error: error.message }, 500)

  // Kept deliberately, and worth somebody knowing about.
  const { count: stuck } = await supabase
    .from('recordings')
    .select('id', { count: 'exact', head: true })
    .not('storage_path', 'is', null)
    .or('transcript.is.null,status.neq.done')

  const rows = (due ?? []) as { id: string; storage_path: string; created_at: string }[]
  const two = await interviewRecords(supabase, dry)
  if (dry) {
    return json({
      ok: true, dry: true,
      would_delete: rows.length, interview_records: two,
      kept_because_no_transcript: stuck ?? 0,
      oldest: rows.length ? rows.map((r) => r.created_at).sort()[0] : null,
    })
  }

  let deleted = 0
  const failed: string[] = []

  // In batches, so one bad path cannot stop the rest.
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50)
    const { error: rmErr } = await supabase.storage
      .from('recordings').remove(batch.map((r) => r.storage_path))
    if (rmErr) {
      failed.push(rmErr.message)
      continue
    }
    const { error: upErr } = await supabase.from('recordings')
      .update({ storage_path: null, audio_purged_at: new Date().toISOString() })
      .in('id', batch.map((r) => r.id))
    if (upErr) { failed.push(upErr.message); continue }
    deleted += batch.length
  }

  return json({
    ok: failed.length === 0 && !two.error,
    deleted, interview_records: two,
    kept_because_no_transcript: stuck ?? 0,
    errors: failed.slice(0, 5),
  })
})

/* 649: transcripts, AI reviews and observations older than keep_interview_days, never for someone on hold. */
// deno-lint-ignore no-explicit-any
export async function interviewRecords(db: any, dry: boolean) {
  const { data: set } = await db.from('recordings_settings').select('keep_interview_days').eq('id', 1).maybeSingle()
  const days = Number(set?.keep_interview_days ?? 0)
  if (!days) return { off: true }
  const cutoff = new Date(Date.now() - days * 864e5).toISOString()
  const { data: held } = await db.from('job_applicants').select('id').not('records_hold_at', 'is', null)
  const hold = new Set((held ?? []).map((h: { id: string }) => String(h.id)))
  const out = { cutoff, transcripts: 0, reviews: 0, observations: 0, held: hold.size, error: '' as string }
  const { data: recs, error: e1 } = await db.from('recordings').select('id, subject_id, storage_path, created_at')
    .eq('kind', 'interview').is('transcript_purged_at', null).lt('created_at', cutoff).limit(500)
  if (e1) { out.error = e1.message; return out }
  const recDue = (recs ?? []).filter((r: { subject_id: string }) => !hold.has(String(r.subject_id)))
  const { data: rvs, error: e2 } = await db.from('interview_reviews').select('id, applicant_id').lt('created_at', cutoff).limit(500)
  if (e2) { out.error = e2.message; return out }
  const rvDue = (rvs ?? []).filter((r: { applicant_id: string }) => !hold.has(String(r.applicant_id)))
  const { data: apps, error: e3 } = await db.from('job_applicants').select('id, post_interview').not('post_interview->observations', 'is', null).limit(2000)
  if (e3) { out.error = e3.message; return out }
  // deno-lint-ignore no-explicit-any
  const obDue = (apps ?? []).filter((a: any) => !hold.has(String(a.id)) && a.post_interview?.observations?.at && String(a.post_interview.observations.at) < cutoff)
  out.transcripts = recDue.length; out.reviews = rvDue.length; out.observations = obDue.length
  if (dry) return out
  for (const r of recDue) {
    if (r.storage_path) await db.storage.from('recordings').remove([r.storage_path])
    const now = new Date().toISOString()
    const { error } = await db.from('recordings').update({ transcript: null, turns: null, transcript_purged_at: now,
      ...(r.storage_path ? { storage_path: null, audio_purged_at: now } : {}) }).eq('id', r.id)
    if (error) { out.error = error.message; return out }
  }
  if (rvDue.length) { const { error } = await db.from('interview_reviews').delete().in('id', rvDue.map((r: { id: string }) => r.id)); if (error) { out.error = error.message; return out } }
  for (const a of obDue) {
    const pi = { ...a.post_interview }; delete pi.observations; pi.observations_purged_at = new Date().toISOString()
    const { error } = await db.from('job_applicants').update({ post_interview: pi }).eq('id', a.id)
    if (error) { out.error = error.message; return out }
  }
  return out
}
