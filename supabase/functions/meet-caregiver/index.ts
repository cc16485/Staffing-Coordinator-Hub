// Supabase Edge Function: meet-caregiver  (shared hub project)
// -----------------------------------------------------------------------------
// The public "meet your caregiver" card behind the link in family texts.
// Returns ONLY what belongs on a team page: the caregiver's name, the intro
// line, the longer about, and a photo URL when one is set. No phone, no
// schedule, no client anything. Deploy with --no-verify-jwt (families click
// this from a text with no login).
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type' }
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const id = new URL(req.url).searchParams.get('cg') || ''
  if (!id) return json({ error: 'which caregiver?' }, 400)
  const { data } = await sb.from('caregiver_intros')
    .select('name, intro, about, photo_url').eq('id', id).maybeSingle()
  if (!data) return json({ error: 'not found' }, 404)
  return json({ name: data.name, intro: data.intro || '', about: data.about || '', photo_url: data.photo_url || '' })
})
