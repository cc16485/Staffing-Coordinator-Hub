// Supabase Edge Function: caregiver-card  (shared hub project)
// -----------------------------------------------------------------------------
// The one thing a family is allowed to read.
//
// Anonymous visitors have no SELECT on caregiver_profiles, deliberately, so the
// public page cannot query the table. It asks this instead, and this is the
// privacy boundary: it returns a published profile and nothing else.
//
// Three rules it enforces that the page cannot be trusted to:
//
//   1. published must be true. Somebody holding the id of a profile the office
//      has not approved yet still gets nothing. Approval is the gate, not the
//      secrecy of the link.
//   2. withdrawn profiles return nothing, immediately, even before their files
//      are deleted. Somebody who takes their permission back should stop being
//      visible the moment the office presses the button.
//   3. only the fields a family needs come back. Never the roster id, the
//      AxisCare id, the consent trail, or anything else on the row.
//
// Deploy: supabase functions deploy caregiver-card --no-verify-jwt
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const BUCKET = 'caregiver-profiles'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const url = new URL(req.url)
    let id = url.searchParams.get('id') ?? ''
    if (!id && req.method === 'POST') id = (await req.json().catch(() => ({})))?.id ?? ''

    // Refuse anything that is not shaped like an id before touching the database.
    if (!UUID.test(id)) return json({ error: 'not_found' }, 404)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data, error } = await supabase
      .from('caregiver_profiles')
      .select('id, first_name, preferred_name, photo_path, video_path, years_experience, specialties, about, why_this_work, published, status')
      .eq('id', id)
      .maybeSingle()

    if (error) {
      console.error(error)
      return json({ error: 'unavailable' }, 500)
    }
    // One answer for "no such profile" and "not approved yet", so the response
    // cannot be used to work out which profiles exist.
    if (!data || !data.published || data.status === 'withdrawn') return json({ error: 'not_found' }, 404)

    const base = Deno.env.get('SUPABASE_URL') + '/storage/v1/object/public/' + BUCKET + '/'
    return json({
      name: data.preferred_name || data.first_name,
      photo: data.photo_path ? base + data.photo_path : null,
      video: data.video_path ? base + data.video_path : null,
      years: data.years_experience || null,
      specialties: Array.isArray(data.specialties) ? data.specialties : [],
      about: data.about || null,
      why: data.why_this_work || null,
    }, 200)
  } catch (e) {
    console.error(e)
    return json({ error: 'unavailable' }, 500)
  }
})
