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
import { contactForOutbound, maySendTo, normalisePhone } from '../_shared/outreach.ts'
import { ghlSendChecked } from '../_shared/send-problems.ts'

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
const CONTACT_COLS = 'id, name, email, phone, sms_consent, circle_id, relationship, hipaa_authorized, hipaa_office_ok_at, hipaa_office_ok_by, phone_confirmed_at, phone_confirmed_by, phone_confirmed_number, stopped_at, axiscare_removed_at, app_user_id, app_status, app_can_book, app_invited_at, app_invited_by, welcome_sent_at, welcome_sent_by, welcome_version, welcome_how, welcome_skip_at, welcome_skip_reason'

// The App fee check (family-fee.ts): App plan clients are active Family Circles ticked app_plan with an AxisCare client.
const appClients = async () => ((await db.from('care_circles').select('id, client_name, axiscare_client_id, app_plan_since, active').eq('app_plan', true)).data ?? [])
  // deno-lint-ignore no-explicit-any
  .filter((k: any) => k.active !== false && k.axiscare_client_id).map((k: any) => ({ circle_id: String(k.id), axiscare_client_id: String(k.axiscare_client_id), client_name: String(k.client_name ?? ''), app_plan_since: k.app_plan_since ?? null }))
const deps: OfficeDeps = {
  ax,
  fee: {
    ax, now: () => new Date(),
    settings: async () => (await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()).data?.data ?? {},
    appClients,
    checks: async (month) => (await db.from('family_app_fees').select('*').eq('month', month).order('client_name', { ascending: true })).data ?? [],
    saveCheck: async (row) => !(await db.from('family_app_fees').upsert(row, { onConflict: 'month,axiscare_client_id' })).error,
    officeItem: async (item) => !(await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item })).error,
  },
  plans: async () => (await db.from('care_circles').select('id, client_name, axiscare_client_id, app_plan, app_plan_since, help_fill, app_tasks, care_scheduling_type').or('app_plan.not.is.null,care_scheduling_type.not.is.null')).data ?? [],
  setPlan: async (id, vals) => !(await db.from('care_circles').update(vals).eq('id', id)).error,
  setAbout: async (id, vals) => !(await db.from('care_circles').update(vals).eq('id', id)).error,
  markBilled: async (month, cid, vals) => !(await db.from('family_app_fees').update(vals).eq('month', month).eq('axiscare_client_id', cid)).error,
  now: () => new Date(),
  settings: async () => (await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()).data?.data ?? {},
  contact: async (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? (await db.from('circle_contacts').select(CONTACT_COLS).eq('id', id).maybeSingle()).data ?? null : null,
  circle: async (id) => (await db.from('care_circles').select('id, client_name, active, axiscare_client_id, app_plan, app_plan_since, help_fill, app_tasks, care_scheduling_type').eq('id', id).maybeSingle()).data ?? null,
  updateContact: async (id, vals) => !(await db.from('circle_contacts').update(vals).eq('id', id)).error,
  circleContacts: async (cid) => (await db.from('circle_contacts').select(CONTACT_COLS).eq('circle_id', cid)).data ?? [],
  members: async () => {
    const { data: cs } = await db.from('circle_contacts').select(CONTACT_COLS).not('app_status', 'is', null)
    // deno-lint-ignore no-explicit-any
    const ids = [...new Set((cs ?? []).map((c: any) => c.circle_id))]
    const { data: ks } = ids.length ? await db.from('care_circles').select('id, client_name, axiscare_client_id').in('id', ids) : { data: [] }
    // deno-lint-ignore no-explicit-any
    return (cs ?? []).map((c: any) => { const k = (ks ?? []).find((x: any) => String(x.id) === String(c.circle_id)); return { contact_id: c.id, name: c.name, email: c.email, client_name: k?.client_name ?? null, axiscare_client_id: k?.axiscare_client_id ?? null, status: c.app_status, can_book: c.app_can_book === true, invited_at: c.app_invited_at, invited_by: c.app_invited_by } })
  },
  // 2026-10-25: the Hub's Booking App page (read only)
  activity: async (from) => {
    const { data: cs } = await db.from('circle_contacts').select('id, circle_id, name, relationship, email, app_status, app_can_book, app_invited_at, app_user_id, app_invited_by, welcome_sent_at, welcome_sent_by, welcome_version, welcome_skip_at, welcome_skip_reason, stopped_at, axiscare_removed_at').not('app_status', 'is', null)
    // deno-lint-ignore no-explicit-any
    const ids = [...new Set((cs ?? []).map((c: any) => c.circle_id))]
    const { data: ks } = ids.length ? await db.from('care_circles').select('id, client_name, axiscare_client_id').in('id', ids) : { data: [] }
    const { data: opens } = await db.from('family_app_activity').select('contact_id, at').eq('kind', 'open').order('at', { ascending: true }).limit(5000)
    const { data: acts } = await db.from('family_app_activity').select('id, at, contact_id, axiscare_client_id, name, kind, summary, data').gte('at', from).order('at', { ascending: false }).limit(1000)
    const { data: evs } = await db.from('op_events').select('id, at, actor_name, verb, summary, data').eq('area', 'family_app').gte('at', from).order('at', { ascending: false }).limit(500)
    const { data: bks } = await db.from('family_bookings').select('id, axiscare_client_id, client_name, contact_id, requested_by_name, visit_date, start_time, end_time, window_start, window_end, hours, kind, tasks, note, note_hidden, status, caregiver_name, method, created_at, cancelled_at, cancelled_by, ended_why').gte('created_at', from).order('created_at', { ascending: false }).limit(500)
    const { data: profs } = await db.from('family_client_profile').select('*')
    /* the Booking App's own sign-in record (last real sign-in with the emailed code), read from the family app's login list */
    const signin: Record<string, { last: string | null; made: string | null }> = {}
    if (FAMILY_URL && FAMILY_SERVICE) {
      for (let page = 1; page <= 10; page++) {
        const j = await (await famAdmin(`/users?page=${page}&per_page=200`)).json().catch(() => ({}))
        // deno-lint-ignore no-explicit-any
        const users: any[] = j?.users ?? []
        for (const u of users) signin[String(u.id)] = { last: u.last_sign_in_at ?? null, made: u.created_at ?? null }
        if (users.length < 200) break
      }
    }
    // deno-lint-ignore no-explicit-any
    const people = (cs ?? []).map((c: any) => {
      // deno-lint-ignore no-explicit-any
      const k = (ks ?? []).find((x: any) => String(x.id) === String(c.circle_id)), mine = (opens ?? []).filter((o: any) => String(o.contact_id) === String(c.id))
      const si = c.app_user_id ? signin[String(c.app_user_id)] : undefined
      const { app_user_id: _u, ...rest } = c
      return { ...rest, client_name: k?.client_name ?? null, axiscare_client_id: k?.axiscare_client_id ?? null, first_open: mine[0]?.at ?? null, last_open: mine[mine.length - 1]?.at ?? null, opens: mine.length,
        last_sign_in: si?.last ?? null, login_made: si?.made ?? null, sign_in_readable: !!(FAMILY_URL && FAMILY_SERVICE) }
    })
    return { ok: true, from, people, activity: acts ?? [], events: evs ?? [], bookings: bks ?? [], profiles: profs ?? [], recording_since: (opens ?? [])[0]?.at ?? null }
  },
  recentBookings: async (from) => (await db.from('family_bookings').select('*, family_offers(caregiver_name, state, wave, sent_at, answered_at, picked_start)').gte('visit_date', from).order('visit_date', { ascending: true })).data ?? [],
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
  rpEmails: async (cid) => {
    const r = await ax('GET', `/api/clients/${encodeURIComponent(cid)}/responsibleParties`)
    if (r.status === 404) return []
    if (r.status !== 200) return null
    const raw = r.json?.results?.responsibleParties ?? r.json?.results ?? []
    // deno-lint-ignore no-explicit-any
    // AxisCare sometimes answers a list as an index-keyed object (the rowsOf lesson in circles-sync): read both shapes
    return (Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.values(raw) : []).map((p: any) => String(p?.email ?? p?.personalEmail ?? '').trim().toLowerCase()).filter(Boolean)
  },
  /* The welcome goes through the same family-safe door as every Family Circle message: audience 'family', allowed only
     because a person pressed Send; opt-outs, Texts OK and the hours policy all apply; a refusal raises a Needs Attention card. */
  send: async (c, channel, payload) => {
    const token = Deno.env.get('GHL_TOKEN') || '', locationId = Deno.env.get('GHL_LOCATION_ID') || ''
    if (!token || !locationId) return false
    const first = String(c.name || '').split(' ')[0] || 'there'
    const dest = await contactForOutbound(db, { token, locationId }, { phone: c.phone, email: c.email, firstName: first }, 'circle-send',
      { audience: 'family', humanInitiated: true, channel, sender: 'circle-send' })
    if (!dest) return false
    const h = { Authorization: `Bearer ${token}`, Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' }
    return await ghlSendChecked(db, h, 'circle-send', { channel, contactId: dest.contactId, address: channel === 'sms' ? c.phone : c.email, who: c.name }, payload)
  },
  phoneTrust: async (phone) => {
    const v = await maySendTo(db, phone, {})
    return v.allowed ? 'ok' : v.confidence === 'suspect' ? 'rejected' : v.confidence === 'probable' ? 'unconfirmed' : v.phone ? 'error' : 'none'
  },
  /* her rule 2026-10-23: a person confirms the number (who and when on phone_index); taking it back resets only a Hub confirmation */
  confirmPhone: async (phone, by) => {
    const p = normalisePhone(phone); if (!p) return 'none'
    const { data: rows, error } = await db.from('phone_index').select('id, verification_status, verified_by').eq('phone', p)
    if (error) return 'error'
    // deno-lint-ignore no-explicit-any
    if ((rows ?? []).some((r: any) => r.verification_status === 'rejected')) return 'rejected'
    if (!(rows ?? []).length) return 'none'   // not an imported number: it can already be texted
    const q = by
      ? db.from('phone_index').update({ confidence: 'confirmed', verification_status: 'verified', verified_by: by, verified_at: new Date().toISOString() }).eq('phone', p).neq('verification_status', 'verified')
      : db.from('phone_index').update({ confidence: 'probable', verification_status: 'unverified', verified_by: null, verified_at: null }).eq('phone', p).like('verified_by', '% (Hub)')
    return (await q).error ? 'error' : 'ok'
  },
  logMessage: async (row) => { await db.from('circle_messages').insert(row) },
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
    const out = await officeAction(deps, { name: who.name, email: who.email, roles: who.roles }, body)
    return json(out.body, out.status)
  } catch (e) {
    console.error('family-app-office', String((e as Error)?.message ?? e))
    return json({ error: 'Something went wrong. Nothing was changed after the last step shown.' }, 500)
  }
})
