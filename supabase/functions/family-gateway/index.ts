// =============================================================================
// family-gateway — the ONE door the family booking app (family.mo-care.com) talks to. Step 1a, plan approved 2026-10-15.
//
// Who may call: a family member signed in to the separate cc-family-app project. Their sign-in token is checked by
// asking cc-family-app itself (GET /auth/v1/user), so no Hub login is involved and no Hub table is reachable by them.
// The token then maps to Family Circle rows (circle_contacts.app_user_id, app_status 'active') and only those
// clients' AxisCare visits, caregiver cards and bookings come back. Rules: _shared/family-app.ts.
// Deployed with verify_jwt OFF (the token comes from another project); this file does the checking.
// Never charges anything. Never texts or emails anyone. Booking writes to AxisCare only when the Hub switch
// family_app_live is on; otherwise it records a practice booking.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { familyAction, type Deps, type Who } from '../_shared/family-app.ts'
import { opEvent } from '../_shared/events.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const FAMILY_URL = (Deno.env.get('FAMILY_APP_URL') || '').replace(/\/+$/, '')
const FAMILY_ANON = Deno.env.get('FAMILY_APP_ANON_KEY') || ''
const AC_VERSION = '2023-10-01'
const ORIGINS = ['https://family.mo-care.com', 'https://cc16485.github.io', 'http://localhost:8787']

function cors(req: Request) {
  const o = req.headers.get('Origin') || ''
  return { 'Access-Control-Allow-Origin': ORIGINS.includes(o) ? o : ORIGINS[0], 'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
}

function axisCreds() {
  let token = ''
  for (const n of ['AXISCARE_API_KEY', 'AXISCARE_TOKEN']) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  return { token, site: /^\d+$/.test(site) ? site : '' }
}
// deno-lint-ignore no-explicit-any
async function ax(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const { token, site } = axisCreds()
  if (!token || !site) return { status: 0, json: { errors: ['AxisCare credentials not set'] } }
  try {
    const r = await fetch(`https://${site}.axiscare.com${path}`, { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json',
      'Content-Type': 'application/json', 'X-AxisCare-Api-Version': AC_VERSION, 'User-Agent': 'CaringCompanions-Hub/1.0 (+https://mo-care.com)' },
      body: body === undefined ? undefined : JSON.stringify(body) })
    const t = await r.text(); let json: unknown = {}
    try { json = t ? JSON.parse(t) : {} } catch { json = { message: t.slice(0, 200) } }
    return { status: r.status, json }
  } catch (e) { return { status: 0, json: { errors: [String((e as Error).message ?? e)] } } }
}

/** Ask cc-family-app who this token belongs to. Anything but a clean, unbanned user is refused. */
async function familyUser(req: Request): Promise<{ id: string; email: string | null } | null> {
  const m = /^Bearer\s+(.+)$/.exec(req.headers.get('Authorization') ?? '')
  if (!m || !FAMILY_URL || !FAMILY_ANON) return null
  try {
    const r = await fetch(`${FAMILY_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${m[1]}`, apikey: FAMILY_ANON } })
    if (r.status !== 200) return null
    const u = await r.json()
    if (!u?.id || (u.banned_until && Date.parse(u.banned_until) > Date.now())) return null
    return { id: String(u.id), email: u.email ? String(u.email).toLowerCase() : null }
  } catch { return null }
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
const PROFILE_COLS = 'axiscare_id, first_name, last_name, preferred_name, about, experience, why_this_work, years_experience, photo_path, photo_url, video_path, consent, published, status, photo_hidden, video_hidden'

const deps: Deps = {
  ax,
  now: () => new Date(),
  supabaseUrl: SUPABASE_URL,
  settings: async () => (await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()).data?.data ?? {},
  whoIs: async (uid) => {
    const { data: cs } = await db.from('circle_contacts').select('id, name, circle_id, app_can_book, app_status, stopped_at, axiscare_removed_at').eq('app_user_id', uid)
    // deno-lint-ignore no-explicit-any
    const live = (cs ?? []).filter((c: any) => c.app_status === 'active' && !c.stopped_at && !c.axiscare_removed_at)
    if (!live.length) return []
    // deno-lint-ignore no-explicit-any
    const { data: circles } = await db.from('care_circles').select('id, client_name, active, axiscare_client_id').in('id', live.map((c: any) => c.circle_id))
    const out: Who[] = []
    for (const c of live) {
      // deno-lint-ignore no-explicit-any
      const k = (circles ?? []).find((x: any) => String(x.id) === String(c.circle_id) && x.active !== false && x.axiscare_client_id)
      if (k) out.push({ contact_id: Number(c.id), name: String(c.name ?? ''), circle_id: String(k.id), axiscare_client_id: String(k.axiscare_client_id), client_name: String(k.client_name ?? ''), can_book: c.app_can_book === true })
    }
    return out
  },
  profiles: async (ids) => ids.length ? ((await db.from('caregiver_profiles').select(PROFILE_COLS).in('axiscare_id', ids)).data ?? []) : [],
  bookings: async (cid) => (await db.from('family_bookings').select('*').eq('axiscare_client_id', cid).order('visit_date', { ascending: true })).data ?? [],
  insertBooking: async (row) => { const { data, error } = await db.from('family_bookings').insert(row).select('id').single(); return error || !data ? null : { id: String(data.id) } },
  updateBooking: async (id, vals) => !(await db.from('family_bookings').update({ ...vals, updated_at: new Date().toISOString() }).eq('id', id)).error,
  officeItem: async (item) => !(await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item })).error,
  event: async (row) => { await opEvent(db, row) },
}

Deno.serve(async (req) => {
  const h = cors(req)
  const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...h, 'Content-Type': 'application/json' } })
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: h })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const user = await familyUser(req)
  if (!user) return json({ error: 'Please sign in again.' }, 401)
  const body = await req.json().catch(() => ({}))
  try {
    const out = await familyAction(deps, user, body)
    return json(out.body, out.status)
  } catch (e) {
    console.error('family-gateway', String((e as Error)?.message ?? e))
    return json({ error: 'Something went wrong on our side. Nothing was booked. Please try again or call the office.' }, 500)
  }
})
