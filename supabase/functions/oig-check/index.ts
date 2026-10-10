// Supabase Edge Function: oig-check  (shared hub project)
// -----------------------------------------------------------------------------
// The Background & References "OIG check" button: one person's name against the HHS-OIG LEIE exclusion list.
// Returns the shape the Hub's result modal already expects:
//   { clear: boolean, date: 'YYYY-MM-DD', matches: [{ firstname, lastname, midname, dob, state, excltype, excldate }] }
//
// PHASE 0 (Samantha approved the eight P0 fixes, 2026-10-10). This used to live in the cc-hub-live repo with no caller
// check at all: anyone holding the public key could run name searches through the agency's function. It now lives
// beside every other Hub function, uses the same LEIE reader as the nightly caregiver audit (_shared/oig-leie.ts), and
// answers only a signed-in office member. A match is never a verdict: the screening staff review it.
// CORS + OPTIONS from day one (browser-called).
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { loadLeie, matchLeie, type Leie } from '../_shared/oig-leie.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// The list is ~15MB and refreshed monthly; keep it across warm invocations for a day.
let CACHE: { day: string; leie: Leie } | null = null
const today = () => new Date().toISOString().slice(0, 10)

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const who = await requireStaff(admin, req, OFFICE_ROLES)
  if (!who.ok) return json({ error: who.error }, who.status)

  try {
    let first = '', last = ''
    if (req.method === 'POST') {
      const b = await req.json().catch(() => ({}))
      first = String(b.first ?? b.firstname ?? '')
      last = String(b.last ?? b.lastname ?? '')
    } else {
      const u = new URL(req.url)
      first = u.searchParams.get('first') ?? ''
      last = u.searchParams.get('last') ?? ''
    }
    if (!first.trim() || !last.trim()) return json({ error: 'first and last name required' }, 400)

    const day = today()
    if (!CACHE || CACHE.day !== day) CACHE = { day, leie: await loadLeie() }
    const r = matchLeie(CACHE.leie, first, last)
    return json({ clear: r.clear, date: day, matches: r.matches })
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500)
  }
})
