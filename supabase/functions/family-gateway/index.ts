// =============================================================================
// family-gateway — the ONE door the family booking app (family.mo-care.com) talks to. Step 1a, plan approved 2026-10-15.
//
// Who may call: a family member signed in to the separate cc-family-app project. Their sign-in token is checked by
// asking cc-family-app itself (GET /auth/v1/user), so no Hub login is involved and no Hub table is reachable by them.
// The token then maps to Family Circle rows (circle_contacts.app_user_id, app_status 'active') and only those
// clients' AxisCare visits, caregiver cards and bookings come back. Rules: _shared/family-app.ts.
// Deployed with verify_jwt OFF (the token comes from another project); this file does the checking.
// Before sign-in, one public action: {action:'start', email} checks the email is on file for an ACTIVE client (her rule
// 2026-10-16, rules in _shared/family-signin.ts) and turns their app on; only then does the app ask for the emailed code.
// Never charges anything. Never texts or emails anyone. Booking writes to AxisCare only when the Hub switch
// family_app_live is on; otherwise it records a practice booking.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { familyAction, type Deps, type Who } from '../_shared/family-app.ts'
import { interestedCards, placeChosen, chooseCancelled } from '../_shared/family-offer.ts'
import { chooseDepsFor } from '../_shared/family-offer-db.ts'
import { opEvent } from '../_shared/events.ts'
import { signinStart, type SigninDeps } from '../_shared/family-signin.ts'
import { axClients } from '../_shared/client-lookup.ts'
import { contactForOutbound, normalisePhone } from '../_shared/outreach.ts'
import { ghlSendChecked } from '../_shared/send-problems.ts'
import { reviewNote } from '../_shared/family-review.ts'
import { clientInfoFor } from '../_shared/cara-skills.ts'
import { sceneFor } from '../_shared/shift-offer.ts'
import { appProfile } from '../_shared/app-profile.ts'
import { aiProfileCheck } from '../_shared/family-profile.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const FAMILY_URL = (Deno.env.get('FAMILY_APP_URL') || '').replace(/\/+$/, '')
const FAMILY_ANON = Deno.env.get('FAMILY_APP_ANON_KEY') || ''
const FAMILY_SERVICE = Deno.env.get('FAMILY_APP_SERVICE_KEY') || ''
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

const cd = chooseDepsFor(db, ax, SUPABASE_URL)
const deps: Deps = {
  ax,
  // Let me choose (her yes 2026-10-16): the family sees who's interested and picks; the offer engine does the placing
  choose: {
    counts: async (ids) => {
      const { data } = await db.from('family_offers').select('booking_id, state').in('booking_id', ids).eq('state', 'interested')
      const out: Record<string, number> = {}; for (const r of data ?? []) out[String(r.booking_id)] = (out[String(r.booking_id)] ?? 0) + 1; return out
    },
    list: (b) => interestedCards(cd, b),
    place: async (b, offerId, by) => {
      if (by === 'switch') {
        const r = await placeChosen(cd, b, null, 'switch')
        if (r.ok) return r
        await db.from('family_bookings').update({ method: 'auto', updated_at: new Date().toISOString() }).eq('id', b.id)
        return { ok: true, placed: false, message: "Got it. We'll find someone for you, and you'll see who's coming here in the app." }
      }
      return placeChosen(cd, b, offerId, 'family')
    },
    cancelled: async (b) => { await chooseCancelled(cd, b) },
  },
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
  // Release 3: the Family Circle's app tasks (null = all companion tasks) and its Help us fill flag
  reviewNote: (note, tasks) => reviewNote(note, tasks, Deno.env.get('ANTHROPIC_API_KEY') ?? ''),
  circleFlags: async (circleId) => { const { data } = await db.from('care_circles').select('app_tasks, help_fill').eq('id', circleId).maybeSingle(); return data ? { app_tasks: data.app_tasks ?? null, help_fill: data.help_fill ?? null } : null },
  // 2026-10-25 (app-profile.ts): the same approved Caregiver Preview the shift page reads; and the family's suggestions
  caregiverView: async (axId, client, fam) => { const info = await clientInfoFor(db, axId, client); return appProfile(info, sceneFor(fam ? [...(fam.enjoys ?? []), fam.talk ?? '', fam.little ?? ''] : info.enjoys), fam ?? null) },
  // 2026-10-25 (family-profile.ts): the family's own profile, and what families do in the app (the Hub's Booking App page)
  familyProfile: {
    get: async (axId) => { const r = await db.from('family_client_profile').select('*').eq('axiscare_client_id', axId).maybeSingle(); return r.error ? undefined : r.data ?? null },
    save: async (row) => !(await db.from('family_client_profile').upsert(row, { onConflict: 'axiscare_client_id' })).error,
    aiCheck: (text) => aiProfileCheck(text, Deno.env.get('ANTHROPIC_API_KEY') ?? ''),
  },
  activity: async (row) => { await db.from('family_app_activity').insert(row) },
  opened: async (who) => {
    const since = new Date(Date.now() - 30 * 60000).toISOString()
    for (const w of who) {
      const { count } = await db.from('family_app_activity').select('id', { count: 'exact', head: true }).eq('contact_id', String(w.contact_id)).eq('kind', 'open').gte('at', since)
      if (!count) await db.from('family_app_activity').insert({ contact_id: String(w.contact_id), axiscare_client_id: w.axiscare_client_id, name: w.name, kind: 'open', summary: `${w.name} opened the Booking App` })
    }
  },
  suggest: {
    openCount: async (axId, contactId) => { const r = await db.from('client_profile_suggestions').select('id', { count: 'exact', head: true }).eq('axiscare_client_id', axId).eq('contact_id', contactId).eq('status', 'open'); return r.error ? null : r.count ?? 0 },
    add: async (row) => !(await db.from('client_profile_suggestions').insert(row)).error,
  },
  insertBooking: async (row) => { const { data, error } = await db.from('family_bookings').insert(row).select('id').single(); return error || !data ? null : { id: String(data.id) } },
  updateBooking: async (id, vals) => !(await db.from('family_bookings').update({ ...vals, updated_at: new Date().toISOString() }).eq('id', id)).error,
  officeItem: async (item) => !(await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item })).error,
  event: async (row) => { await opEvent(db, row) },
  closeItem: async (id, by, text) => {
    const list = (await db.from('app_data').select('data').eq('key', 'ops_items').maybeSingle()).data?.data
    const it = (Array.isArray(list) ? list : []).find((x: any) => x?.id === id)
    if (!it || it.status === 'done') return
    const at = new Date().toISOString()
    await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { ...it, status: 'done', last_at: at, last_activity_at: at, history: [...(it.history ?? []), { at, by, text }] } })
  },
  // A family cancelled: tell the caregiver (her rule 2026-10-16). Caregiver audience only; never a family.
  textCaregiver: async (axId, message) => {
    const ghl = { token: Deno.env.get('GHL_TOKEN') ?? '', locationId: Deno.env.get('GHL_LOCATION_ID') ?? '' }
    if (!ghl.token || !ghl.locationId) return { ok: false, why: 'GoHighLevel is not set up on the server' }
    const list = (await db.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()).data?.data
    const g = (Array.isArray(list) ? list : []).find((x: any) => String(x?.axiscare_id ?? '').trim() === String(axId))
    const phone = normalisePhone(g?.phone)
    if (!g || !phone) return { ok: false, why: 'no phone on their Hub record' }
    const name = [String(g.first || '').trim(), String(g.last || '').trim()].filter(Boolean).join(' ')
    const contact = await contactForOutbound(db, ghl, { phone, firstName: String(g.first || '').trim() }, 'urgent_internal', { audience: 'caregiver', channel: 'sms', sender: 'family-cancel' })
    if (!contact) return { ok: false, why: 'not sent (opted out, or the number is not trusted for texts)' }
    const ok = await ghlSendChecked(db, { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
      'family-cancel', { channel: 'sms', contactId: contact.contactId, address: phone, who: name }, { message })
    return ok ? { ok: true } : { ok: false, why: 'GoHighLevel refused the text' }
  },
}

const famAdmin = (path: string, init: RequestInit = {}) => fetch(`${FAMILY_URL}/auth/v1/admin${path}`, { ...init,
  headers: { apikey: FAMILY_SERVICE, Authorization: `Bearer ${FAMILY_SERVICE}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } })
const CC = 'id, name, circle_id, source, app_status, app_user_id, app_can_book, app_book_choice, stopped_at, axiscare_removed_at'
const signinDeps: SigninDeps = {
  now: () => new Date(),
  settings: deps.settings,
  ax: (m, p) => ax(m, p),
  axClients: async () => { const r = await axClients(); return r.error ? null : r.clients },
  contactsByEmail: async (email) => (await db.from('circle_contacts').select(CC).ilike('email', email.replace(/[\\%_]/g, '\\$&'))).data ?? [],
  circles: async (ids) => ids.length ? (await db.from('care_circles').select('id, client_name, active, axiscare_client_id').in('id', ids)).data ?? [] : [],
  circleForClient: async (axId, name) => {
    const { data: k } = await db.from('care_circles').select('id, client_name, active, axiscare_client_id').eq('axiscare_client_id', axId).or('active.is.null,active.eq.true').order('id').limit(1).maybeSingle()
    if (k) return k
    const { data } = await db.from('care_circles').insert({ client_name: name, axiscare_client_id: axId, linked_by: 'family app: email on file', linked_at: new Date().toISOString(), link_how: 'app_self' })
      .select('id, client_name, active, axiscare_client_id').single()
    return data ?? null
  },
  contactInCircle: async (circleId, email, name) => {
    const { data: hit } = await db.from('circle_contacts').select(CC).eq('circle_id', circleId).ilike('email', email.replace(/[\\%_]/g, '\\$&')).order('id').limit(1).maybeSingle()
    if (hit) return hit
    const { data } = await db.from('circle_contacts').insert({ circle_id: circleId, name, email, relationship: 'Client', source: 'app_self' }).select(CC).single()
    return data ?? null
  },
  updateContact: async (id, vals) => !(await db.from('circle_contacts').update(vals).eq('id', id)).error,
  login: {
    find: async (email) => {
      if (!FAMILY_URL || !FAMILY_SERVICE) return null
      for (let page = 1; page <= 20; page++) {
        const j = await (await famAdmin(`/users?page=${page}&per_page=200`)).json().catch(() => ({}))
        // deno-lint-ignore no-explicit-any
        const users: any[] = j?.users ?? []
        const hit = users.find((u) => String(u.email ?? '').toLowerCase() === email)
        if (hit) return String(hit.id)
        if (users.length < 200) return null
      }
      return null
    },
    create: async (email, name) => {
      if (!FAMILY_URL || !FAMILY_SERVICE) return null
      const r = await famAdmin('/users', { method: 'POST', body: JSON.stringify({ email, email_confirm: true, user_metadata: { name } }) })
      const j = await r.json().catch(() => ({}))
      return (r.status === 200 || r.status === 201) && j?.id ? String(j.id) : await signinDeps.login.find(email)
    },
    unblock: async (id) => { await famAdmin(`/users/${id}`, { method: 'PUT', body: JSON.stringify({ ban_duration: 'none' }) }).catch(() => null) },
  },
  attempts: async (email, ip, sinceEmail, sinceIp) => {
    const a = await db.from('family_signin_attempts').select('id', { count: 'exact', head: true }).eq('email', email).gte('at', sinceEmail)
    const b = await db.from('family_signin_attempts').select('id', { count: 'exact', head: true }).eq('ip', ip).gte('at', sinceIp)
    return { email: a.count ?? 0, ip: b.count ?? 0 }
  },
  recordAttempt: async (email, ip, outcome) => { await db.from('family_signin_attempts').insert({ email, ip, outcome }) },
  event: deps.event,
}

Deno.serve(async (req) => {
  const h = cors(req)
  const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...h, 'Content-Type': 'application/json' } })
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: h })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const body = await req.json().catch(() => ({}))
  if (body?.action === 'start') {
    try {
      const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
      const out = await signinStart(signinDeps, body?.email, ip, req.headers.get('Origin'))
      return json(out.body, out.status)
    } catch (e) {
      console.error('family-gateway start', String((e as Error)?.message ?? e))
      return json({ ok: false, error: 'Something went wrong on our side. Please try again or call the office.' }, 500)
    }
  }
  const user = await familyUser(req)
  if (!user) return json({ error: 'Please sign in again.' }, 401)
  try {
    const out = await familyAction(deps, user, body)
    return json(out.body, out.status)
  } catch (e) {
    console.error('family-gateway', String((e as Error)?.message ?? e))
    return json({ error: 'Something went wrong on our side. Nothing was booked. Please try again or call the office.' }, 500)
  }
})
