// Supabase Edge Function: hire-intake-purge  (shared hub project)
// -----------------------------------------------------------------------------
// We tell every candidate, on the page where we ask for it, that their social
// security number is "deleted once your screening clears". This is the thing
// that makes that true.
//
// A number is cleared out when either is true:
//   • the office marked the screening done (screening_cleared_at is set), or
//   • 60 days have passed since they submitted it — long enough for any
//     screening to finish, short enough that a stale number is not sitting
//     there indefinitely because someone forgot to tick a box.
//
// It only ever nulls the ssn column. The rest of the record stays, because the
// signed authorization and the reference list are part of the hiring file.
//
// Runs daily by pg_cron. Supports ?dry=1 to report without changing anything.
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const MAX_AGE_DAYS = 60

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const dry = new URL(req.url).searchParams.get('dry') === '1'

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 86400_000).toISOString()

  // Only rows that still hold a number and are done with it one way or another.
  const { data: rows, error } = await supabase
    .from('hire_intake')
    .select('id, first_name, last_name, created_at, screening_cleared_at')
    .not('ssn', 'is', null)
    .or(`screening_cleared_at.not.is.null,created_at.lt.${cutoff}`)
  if (error) return json({ error: error.message }, 500)
  if (!rows?.length) return json({ ok: true, dry, purged: 0, note: 'nothing due to be cleared' })

  const reason = (r: { created_at: string; screening_cleared_at: string | null }) =>
    r.screening_cleared_at ? 'screening cleared' : `${MAX_AGE_DAYS} days old`

  if (dry) {
    return json({
      ok: true, dry: true, would_purge: rows.length,
      rows: rows.map((r) => ({ name: `${r.first_name} ${r.last_name}`, because: reason(r) })),
    })
  }

  let purged = 0
  for (const r of rows) {
    const { error: e } = await supabase
      .from('hire_intake')
      .update({ ssn: null, ssn_purged_at: new Date().toISOString() })
      .eq('id', r.id)
    if (!e) purged++
  }
  return json({ ok: true, purged, of: rows.length })
})
