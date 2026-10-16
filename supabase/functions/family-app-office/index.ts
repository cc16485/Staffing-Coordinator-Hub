// =============================================================================
// family-app-office — the office's side of the family booking app (Step 1a). Signed-in office staff only
// (requireStaff, OFFICE_ROLES). Actions and rules: _shared/family-app-office.ts.
// Talks to cc-family-app's sign-in admin (create / find / block a login) with FAMILY_APP_SERVICE_KEY, which lives
// only as a Hub secret. Never texts or emails a family.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { opEvent } from '../_shared/events.ts'
import { officeAction, type OfficeDeps } from '../_shared/family-app-office.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const FAMILY_URL = (Deno.env.get('FAMILY_APP_URL') || '').replace(/\/+$/, '')
const FAMILY_SERVICE = Deno.env.get('FAMILY_APP_SERVICE_KEY') || ''
const AC_VERSION = '2023-10-01'
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cc-via', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

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
    const t = await r.text(); let j: unknown = {}
    try { j = t ? JSON.parse(t) : {} } catch { j = { message: t.slice(0, 200) } }
    return { status: r.status, json: j }
  } catch (e) { return { status: 0, json: { errors: [String((e as Error).message ?? e)] } } }
}
const famAdmin = (path: string, init: RequestInit = {}) => fetch(`${FAMILY_URL}/auth/v1/admin${path}`, { ...init,
  headers: { apikey: FAMILY_SERVICE, Authorization: `Bearer ${FAMILY_SERVICE}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } })

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
const CONTACT_COLS = 'id, name, email, circle_id, stopped_at, axiscare_removed_at, app_user_id, app_status, app_can_book, app_invited_at, app_invited_by'

const deps: OfficeDeps = {
  ax,
  now: () => new Date(),
  settings: async () => (await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()).data?.data ?? {},
  contact: async (id) => Number.isFinite(id) ? (await db.from('circle_contacts').select(CONTACT_COLS).eq('id', id).maybeSingle()).data ?? null : null,
  circle: async (id) => (await db.from('care_circles').select('id, client_name, active, axiscare_client_id').eq('id', id).maybeSingle()).data ?? null,
  updateContact: async (id, vals) => !(await db.from('circle_contacts').update(vals).eq('id', id)).error,
  members: async () => {
    const { data: cs } = await db.from('circle_contacts').select(CONTACT_COLS).not('app_status', 'is', null)
    // deno-lint-ignore no-explicit-any
    const ids = [...new Set((cs ?? []).map((c: any) => c.circle_id))]
    const { data: ks } = ids.length ? await db.from('care_circles').select('id, client_name, axiscare_client_id').in('id', ids) : { data: [] }
    // deno-lint-ignore no-explicit-any
    return (cs ?? []).map((c: any) => { const k = (ks ?? []).find((x: any) => String(x.id) === String(c.circle_id)); return { contact_id: c.id, name: c.name, email: c.email, client_name: k?.client_name ?? null, axiscare_client_id: k?.axiscare_client_id ?? null, status: c.app_status, can_book: c.app_can_book === true, invited_at: c.app_invited_at, invited_by: c.app_invited_by } })
  },
  recentBookings: async (from) => (await db.from('family_bookings').select('*').gte('visit_date', from).order('visit_date', { ascending: true })).data ?? [],
  booking: async (id) => /^[0-9a-f-]{36}$/i.test(id) ? (await db.from('family_bookings').select('*').eq('id', id).maybeSingle()).data ?? null : null,
  updateBooking: async (id, vals) => !(await db.from('family_bookings').update({ ...vals, updated_at: new Date().toISOString() }).eq('id', id)).error,
  closeItem: async (id, by, text) => {
    const { data } = await db.from('app_data').select('data').eq('key', 'ops_items').maybeSingle()
    // deno-lint-ignore no-explicit-any
    const it = (Array.isArray(data?.data) ? data.data : []).find((x: any) => x?.id === id)
    if (!it || it.status === 'done') return
    const at = new Date().toISOString()
    await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { ...it, status: 'done', last_at: at, last_activity_at: at, history: [...(it.history ?? []), { at, by, text }] } })
  },
  event: async (row) => { await opEvent(db, row) },
  login: {
    create: async (email, name) => {
      if (!FAMILY_URL || !FAMILY_SERVICE) return { error: 'the family app is not connected yet' }
      const r = await famAdmin('/users', { method: 'POST', body: JSON.stringify({ email, email_confirm: true, user_metadata: { name } }) })
      const j = await r.json().catch(() => ({}))
      if (r.status === 200 || r.status === 201) return { id: String(j.id) }
      const msg = String(j?.msg ?? j?.message ?? j?.error_description ?? r.status)
      return { error: msg, exists: r.status === 422 || /already/i.test(msg) }
    },
    find: async (email) => {
      for (let page = 1; page <= 20; page++) {
        const r = await famAdmin(`/users?page=${page}&per_page=200`)
        const j = await r.json().catch(() => ({}))
        // deno-lint-ignore no-explicit-any
        const users: any[] = j?.users ?? []
        const hit = users.find((u) => String(u.email ?? '').toLowerCase() === email)
        if (hit) return String(hit.id)
        if (users.length < 200) return null
      }
      return null
    },
    block: async (uid, on) => {
      const r = await famAdmin(`/users/${uid}`, { method: 'PUT', body: JSON.stringify({ ban_duration: on ? '876000h' : 'none' }) })
      return r.status === 200
    },
  },
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const who = await requireStaff(db, req, OFFICE_ROLES)
  if (!who.ok) return json({ error: who.error }, who.status)
  const body = await req.json().catch(() => ({}))
  try {
    const out = await officeAction(deps, { name: who.name, email: who.email }, body)
    return json(out.body, out.status)
  } catch (e) {
    console.error('family-app-office', String((e as Error)?.message ?? e))
    return json({ error: 'Something went wrong. Nothing was changed after the last step shown.' }, 500)
  }
})
