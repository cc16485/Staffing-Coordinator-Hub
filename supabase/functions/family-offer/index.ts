// =============================================================================
// family-offer: caregivers are offered the visits families book in the app, first yes wins (her yes 2026-10-16).
// Rules and wording: _shared/family-offer.ts.
//   cron (x-cron-secret) or the owner's server key, every 10 minutes: the run (?dry=1 = say what it would do, send nothing)
//   POST {o, e, t, action:'view'|'answer', yes?, start?} from cc.mo-care.com/visit-offer.html: the caregiver's own link.
//        o = the offer, e = expiry, t = HMAC of (o|e) keyed by HUB_JOB_SECRET with its own purpose label. Nothing else
//        about them travels in the link; a forged, changed or expired link gets nothing.
// Deployed with verify_jwt OFF (caregivers have no Hub login); this file does the checking.
// OFF until ops_settings.family_offer_live === true. Never texts or emails a family.
// =============================================================================
import { isPlaceholderCaregiver } from '../_shared/cg-placeholder.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { runOffers, offerPage, type OfferDeps, type Candidate } from '../_shared/family-offer.ts'
import { makeOfferLink, checkOfferLink } from '../_shared/offer-links.ts'
import { contactForOutbound, normalisePhone } from '../_shared/outreach.ts'
import { ghlSendChecked } from '../_shared/send-problems.ts'
import { shiftAskBlock } from '../_shared/shift-ask-gate.ts'
import { readCensus } from '../_shared/axis-census.ts'
import { isWorking, inTrainingLive } from '../_shared/in-training.ts'   // 2026-10-22 In Training is onboarding
import { jobCaller } from '../_shared/job-auth.ts'
import { opEvent } from '../_shared/events.ts'
import { chooseDepsFor } from '../_shared/family-offer-db.ts'
import { syncPlaced, type SyncDeps } from '../_shared/family-sync.ts'
import { welcomeAlerts, type WelcomeAlertDeps } from '../_shared/family-welcome-alert.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SECRET = Deno.env.get('HUB_JOB_SECRET') ?? ''
const AC_VERSION = '2023-10-01'
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
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

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
// deno-lint-ignore no-explicit-any
const key = async (k: string): Promise<any> => (await db.from('app_data').select('data').eq('key', k).maybeSingle()).data?.data
// deno-lint-ignore no-explicit-any
const arr = (x: unknown) => (Array.isArray(x) ? x : []) as any[]
const nameKey = (n: string) => n.toLowerCase().replace(/[^a-z ]/g, '').split(/\s+/).filter(Boolean).join(' ')
const ghl = { token: Deno.env.get('GHL_TOKEN') ?? '', locationId: Deno.env.get('GHL_LOCATION_ID') ?? '' }
const OPEN_COLS = '*'

const cd = chooseDepsFor(db, ax, SUPABASE_URL)
const deps: OfferDeps = {
  ax,
  // Let me choose (her yes 2026-10-16): same checks and texts as the family's door
  textCaregiver: cd.textCaregiver, askBlockId: cd.askBlockId, profiles: cd.profiles, supabaseUrl: SUPABASE_URL, textFamily: cd.textFamily,
  confirmDue: cd.confirmDue, tellFamily: cd.tellFamily, clientAbout: cd.clientAbout, clientProfile: cd.clientProfile, clientPhoto: cd.clientPhoto, unfilledDue: cd.unfilledDue, matchFor: cd.matchFor, heldDue: cd.heldDue, declinedDue: cd.declinedDue,
  now: () => new Date(),
  settings: async () => (await key('ops_settings')) ?? {},
  openBookings: async (from) => (await db.from('family_bookings').select(OPEN_COLS).eq('status', 'waiting_for_caregiver').is('caregiver_axiscare_id', null).gte('visit_date', from).order('visit_date', { ascending: true }).limit(200)).data ?? [],
  booking: async (id) => /^[0-9a-f-]{36}$/i.test(id) ? (await db.from('family_bookings').select('*').eq('id', id).maybeSingle()).data ?? null : null,
  offers: async (bid) => (await db.from('family_offers').select('*').eq('booking_id', bid).order('created_at', { ascending: true })).data ?? [],
  offer: async (id) => /^[0-9a-f-]{36}$/i.test(id) ? (await db.from('family_offers').select('*').eq('id', id).maybeSingle()).data ?? null : null,
  insertOffer: async (row) => { const { data, error } = await db.from('family_offers').insert(row).select('id').single(); return error || !data ? null : { id: String(data.id) } },
  updateOffer: async (id, vals) => !(await db.from('family_offers').update(vals).eq('id', id)).error,
  updateBooking: async (id, vals) => !(await db.from('family_bookings').update({ ...vals, updated_at: new Date().toISOString() }).eq('id', id)).error,
  claimBooking: async (id, vals) => {
    const { data, error } = await db.from('family_bookings').update({ ...vals, updated_at: new Date().toISOString() })
      .eq('id', id).eq('status', 'waiting_for_caregiver').is('caregiver_axiscare_id', null).select('id')
    return !error && Array.isArray(data) && data.length === 1
  },
  /** Active on the Hub roster AND in AxisCare (fail closed: AxisCare unreadable = nobody), a phone, an AxisCare number, not a nurse. */
  roster: async () => {
    const census = await readCensus()
    if (!census.ok) return []
    /* 2026-10-22: In Training (onboarding) is never offered a family's visit once ops_settings.in_training_lock_live is on */
    const trainLive = await inTrainingLive(db)
    const axActive = new Set(census.rows.filter((r) => isWorking(r.active, r.status_label, trainLive)).map((r) => r.id))
    const nurses = new Set(arr(await key('nurse_staff')).map((s) => nameKey(String(s?.name || ''))))
    const av = arr(await key('caregiver_availability'))
    const out: Candidate[] = [], seen = new Set<string>()
    for (const g of arr(await key('caregivers'))) {
      const id = String(g?.axiscare_id ?? '').trim()
      if (g?.active === false || !/^\d{1,12}$/.test(id) || seen.has(id) || !axActive.has(id)) continue
      const name = [String(g.first || '').trim(), String(g.last || '').trim()].filter(Boolean).join(' ')
      const phone = normalisePhone(g.phone)
      if (!phone || nurses.has(nameKey(name)) || isPlaceholderCaregiver(name)) continue   // AxisCare's "Canceled Shift" is nobody
      seen.add(id)
      out.push({ axiscare_id: id, name, first: String(g.first || '').trim(), phone,
        drive: { dl_status: g.dl_status ?? null, dl_expires: g.dl_expires ?? null, auto_ins_expires: g.auto_ins_expires ?? null, cleared_to_drive: g.cleared_to_drive ?? null }, avail: av.find((x) => String(x?.axiscare_id ?? '') === id) ?? null })
    }
    return out
  },
  askBlock: async (c, client, needsTransport) => shiftAskBlock(db, { cg: { axiscare_id: c.axiscare_id, phone: c.phone, first: c.first, ...(c.drive ?? {}) }, name: c.name, axId: c.axiscare_id, client, needsTransport }),
  sendText: async (c, message) => {
    if (!ghl.token || !ghl.locationId) return { ok: false, why: 'GoHighLevel is not set up on the server' }
    const contact = await contactForOutbound(db, ghl, { phone: c.phone, firstName: c.first }, 'urgent_internal', { audience: 'caregiver', channel: 'sms', sender: 'family-offer' })
    if (!contact) return { ok: false, why: 'not sent (opted out, or the number is not trusted for texts)' }
    const ok = await ghlSendChecked(db, { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
      'family-offer', { channel: 'sms', contactId: contact.contactId, address: c.phone, who: c.name }, { message })
    return ok ? { ok: true } : { ok: false, why: 'GoHighLevel refused the text (Needs Attention card raised)' }
  },
  makeLink: (offerId, exp) => makeOfferLink(SECRET, offerId, exp),
  officeItem: async (item) => !(await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item })).error,
  closeItem: async (id, by, text) => {
    const it = arr(await key('ops_items')).find((x) => x?.id === id)
    if (!it || it.status === 'done') return
    const at = new Date().toISOString()
    await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { ...it, status: 'done', last_at: at, last_activity_at: at, history: [...(it.history ?? []), { at, by, text }] } })
  },
  event: async (row) => { await opEvent(db, row) },
}

// Release 2: the same run keeps confirmed app visits in step with AxisCare (_shared/family-sync.ts).
const syncDeps: SyncDeps = { ax, now: () => new Date(), settings: deps.settings, placedAhead: cd.placedAhead, coverage: cd.coverage, changeDue: cd.changeDue,
  updateBooking: deps.updateBooking, officeItem: deps.officeItem, closeItem: deps.closeItem, event: deps.event, tellFamily: cd.tellFamily }

// The welcome reminder (2026-10-17): one card per client when a ready family hasn't had its welcome after a business day.
const welcomeDeps: WelcomeAlertDeps = { now: () => new Date(), settings: deps.settings, candidates: cd.candidates, stampReady: cd.stampReady, openCards: cd.openCards, officeItem: deps.officeItem, closeItem: deps.closeItem }

// deno-lint-ignore no-explicit-any
async function beat(ok: boolean, note: string) {
  try { await db.rpc('upsert_app_data_item', { target_key: 'automation_heartbeats', item: { id: 'hb_family-offer', automation: 'family-offer', at: new Date().toISOString(), ok, note: String(note).slice(0, 300) } }) } catch { /* never waits on this */ }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const body = await req.json().catch(() => ({}))
  try {
    if (body && typeof body === 'object' && 'o' in body) {
      if (!await checkOfferLink(SECRET, body)) return json({ error: 'This link has ended or is not valid. Please call the office.' }, 403)
      const out = await offerPage(deps, String(body.o), body)
      return json(out.body, out.status)
    }
    const caller = await jobCaller(req)
    if (!caller) return json({ error: 'not allowed' }, 401)
    const dry = new URL(req.url).searchParams.get('dry') === '1'
    const out = await runOffers(deps, { dry })
    let sync: Record<string, unknown>
    try { sync = await syncPlaced(syncDeps, { dry }) } catch (e) { sync = { error: String((e as Error)?.message ?? e).slice(0, 200) } }
    let welcome: Record<string, unknown>
    try { welcome = await welcomeAlerts(welcomeDeps, { dry }) } catch (e) { welcome = { error: String((e as Error)?.message ?? e).slice(0, 200) } }
    if (!dry) await beat(out.failed === 0 && !sync.error && !welcome.error, JSON.stringify({ ...out, would: undefined, skipped: out.skipped.slice(0, 5), sync: { ...sync, would: undefined }, welcome: { ...welcome, would: undefined } }))
    return json({ ok: true, ...out, sync, welcome })
  } catch (e) {
    console.error('family-offer', String((e as Error)?.message ?? e))
    return json({ error: 'Something went wrong on our side. Please try again in a minute.' }, 500)
  }
})
