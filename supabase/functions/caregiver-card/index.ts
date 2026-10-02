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
//   3. only the fields a family needs come back: the public card id, "Sarah T."
//      (first name and last initial), photo, video and their words. Never the
//      roster id, the AxisCare id, the candidate id, the personal link token,
//      the consent trail, or anything else on the row.
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
const LEGACY = /^[A-Za-z0-9_-]{1,64}$/
const COLS = 'id, first_name, last_name, preferred_name, photo_path, photo_url, video_path, experience, years_experience, specialties, about, why_this_work, published, status'

/* 2b (2026-10-01). The card a family sees: "Sarah T.", never more of the last name than its initial, and never the
   roster id, AxisCare id, candidate id, personal link token, consent trail or anything else on the row. Exported for
   the tests. photo_url is an older intro's photo address (kept by caregiver_profile_2b.sql); it is only used while
   there is no uploaded photo, and only when it is an https address. */
// deno-lint-ignore no-explicit-any
export function cardPayload(data: any, storageBase: string) {
  const first = String(data.preferred_name || data.first_name || '').trim()
  const li = String(data.last_name || '').trim().replace(/^[^A-Za-z]+/, '').charAt(0).toUpperCase()
  const ext = String(data.photo_url || '').trim()
  return {
    id: data.id,
    name: first && li ? `${first} ${li}.` : first,
    first: first.split(/\s+/)[0] || first,
    photo: data.photo_path ? storageBase + data.photo_path : (/^https:\/\/[^\s"'<>]+$/i.test(ext) ? ext : null),
    video: data.video_path ? storageBase + data.video_path : null,
    experience: data.experience || null,
    years: data.years_experience || null,
    specialties: Array.isArray(data.specialties) ? data.specialties : [],
    about: data.about || null,
    why: data.why_this_work || null,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const url = new URL(req.url)
    let id = url.searchParams.get('id') ?? ''
    let legacy = url.searchParams.get('legacy') ?? ''
    if (!id && !legacy && req.method === 'POST') {
      const b = await req.json().catch(() => ({}))
      id = String(b?.id ?? ''); legacy = String(b?.legacy ?? '')
    }

    // Refuse anything that is not shaped like an id before touching the database.
    // ?legacy=<old meet.html id> finds a profile moved over from the older intro list (2b), so old texts still open.
    if (id ? !UUID.test(id) : !LEGACY.test(legacy)) return json({ error: 'not_found' }, 404)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const q = supabase.from('caregiver_profiles').select(COLS)
    const { data, error } = await (id ? q.eq('id', id) : q.eq('legacy_intro_id', legacy).eq('published', true).neq('status', 'withdrawn')).maybeSingle()

    if (error) {
      console.error(error)
      return json({ error: 'unavailable' }, 500)
    }
    // One answer for "no such profile" and "not approved yet", so the response
    // cannot be used to work out which profiles exist.
    if (!data || !data.published || data.status === 'withdrawn') return json({ error: 'not_found' }, 404)

    return json(cardPayload(data, Deno.env.get('SUPABASE_URL') + '/storage/v1/object/public/' + BUCKET + '/'), 200)
  } catch (e) {
    console.error(e)
    return json({ error: 'unavailable' }, 500)
  }
})
