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
// Runs daily by pg_cron. ?dry=1 reports without deleting.
// Deploy: supabase functions deploy purge-recordings
//
// Needs recordings-retention.sql to have been run first.
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
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
  if (dry) {
    return json({
      ok: true, dry: true,
      would_delete: rows.length,
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
    ok: failed.length === 0,
    deleted,
    kept_because_no_transcript: stuck ?? 0,
    errors: failed.slice(0, 5),
  })
})
