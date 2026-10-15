// Supabase Edge Function: call-followup  (shared hub project) · RETIRED 2026-10-14
// -----------------------------------------------------------------------------
// This used to read a call transcript with AI and make a lead, a drafted recap and a GoHighLevel "lead" tag by itself.
// Samantha 2026-10-14: the AI no longer makes leads. A likely new family is only TAGGED on the call (the call reader,
// call-tasks: "new client inquiry"), and a person presses "Make this a lead", which opens the lead form filled from the
// call for them to check and save (call-to-lead). call-pull stopped asking this function the same day.
//
// Kept (token-gated, as before) so an old GoHighLevel webhook gets a harmless answer: it reads nothing, asks no AI and
// writes nothing. The full earlier version is in git history (before this commit).
// Deploy: supabase functions deploy call-followup --project-ref zngsgedlsxinbygwmxwn --no-verify-jwt
// -----------------------------------------------------------------------------
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve((req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const url = new URL(req.url)
  if (url.searchParams.get('token') !== Deno.env.get('CALL_FOLLOWUP_TOKEN')) return json({ error: 'unauthorized' }, 401)
  return json({ status: 'retired', created: false, detail: 'Calls become leads only when a person presses Make this a lead on the Hub.' })
})
