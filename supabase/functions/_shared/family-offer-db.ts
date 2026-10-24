// =============================================================================
// family-offer-db — the database + GoHighLevel side of Let me choose, shared by family-offer (the 10-minute run and the
// caregiver's page) and family-gateway (the family choosing in the app), so both doors place, check and text the same way.
// Caregiver texts: audience 'caregiver'. The ONE family text (caregivers are interested): audience 'family', only while
// ops_settings.family_choose_text_approved records her approval (2026-10-16, "Start both: Let me choose with your 5
// recommended answers"), only to the person who booked, only with Texts OK, never after STOP or once removed.
// =============================================================================
import { contactForOutbound, normalisePhone } from './outreach.ts'
import { ghlSendChecked } from './send-problems.ts'
import { shiftAskBlock } from './shift-ask-gate.ts'
import { opEvent } from './events.ts'
import type { ChooseDeps } from './family-offer.ts'
import type { Ax } from './family-app.ts'
import type { SyncDeps } from './family-sync.ts'
import type { WelcomeAlertDeps } from './family-welcome-alert.ts'
import type { MatchResult } from './family-offer.ts'
import { approvedRules } from './approved-rules.ts'
import { careLevelOf } from './care-level.ts'
import { approvedIntro, previewRecords } from './caregiver-preview.ts'
import { judge, homeNotes, type MatchClient, type MatchCaregiver } from './family-match.ts'

// deno-lint-ignore no-explicit-any
type Any = any
const arr = (x: unknown) => (Array.isArray(x) ? x : []) as Any[]
const SENDERS: Record<string, string> = { family_confirm_text_approved: 'family-offer (caregiver confirmed)', family_unfilled_text_approved: 'family-offer (request not filled)',
  family_cgchange_text_approved: 'family-offer (caregiver changed)', family_timechange_text_approved: 'family-offer (time changed)',
  family_declined_text_approved: 'family-offer (request declined)', family_couldnt_text_approved: "family-offer (help us fill: couldn't fill)" }
const PROFILE_COLS = 'axiscare_id, first_name, last_name, preferred_name, about, experience, why_this_work, years_experience, photo_path, photo_url, video_path, consent, published, status, photo_hidden, video_hidden'

export function chooseDepsFor(db: Any, ax: Ax, supabaseUrl: string): ChooseDeps & Required<Pick<import('./family-offer.ts').OfferDeps, 'textFamily' | 'confirmDue' | 'tellFamily' | 'clientAbout' | 'unfilledDue'>> &
  Pick<SyncDeps, 'placedAhead' | 'coverage' | 'changeDue'> & Pick<WelcomeAlertDeps, 'candidates' | 'stampReady' | 'openCards'> & { matchFor: (b: Any) => Promise<MatchResult>; heldDue: () => Promise<Any[]>; declinedDue: () => Promise<Any[]> } {
  const key = async (k: string): Promise<Any> => (await db.from('app_data').select('data').eq('key', k).maybeSingle()).data?.data
  const ghl = () => ({ token: Deno.env.get('GHL_TOKEN') ?? '', locationId: Deno.env.get('GHL_LOCATION_ID') ?? '' })
  const headers = (t: string) => ({ Authorization: `Bearer ${t}`, Version: '2021-07-28', 'Content-Type': 'application/json' })
  const caregiver = async (axId: string) => arr(await key('caregivers')).find((g) => String(g?.axiscare_id ?? '').trim() === String(axId))
  const sms = async (sender: string, audience: 'caregiver' | 'family', to: { phone: string; first: string; name: string }, message: string, family = false) => {
    const g = ghl()
    if (!g.token || !g.locationId) return { ok: false, why: 'GoHighLevel is not set up on the server' }
    const contact = await contactForOutbound(db, g, { phone: to.phone, firstName: to.first }, family ? 'reactive_external' : 'urgent_internal',
      family ? { audience, explicitlyEnabled: true, channel: 'sms', sender } : { audience, channel: 'sms', sender })
    if (!contact) return { ok: false, why: 'not sent (opted out, or the number is not trusted for texts)' }
    const ok = await ghlSendChecked(db, headers(g.token), 'family-offer', { channel: 'sms', contactId: contact.contactId, address: to.phone, who: to.name }, { message })
    return ok ? { ok: true } : { ok: false, why: 'GoHighLevel refused the text (Needs Attention card raised)' }
  }
  const items = async () => arr(await key('ops_items'))
  // Release 3 matching: the approved rulebook and the AxisCare caregiver list, read at most every 5 minutes per worker.
  let rulesAt = 0, M: Any = null, cgsAt = 0, axCgs: Map<string, Any> | null = null
  const rulebook = async (): Promise<{ ok: true } | { ok: false; why: string }> => {
    if (M && Date.now() - rulesAt < 300000) return { ok: true }
    const a = await approvedRules(db, 'match-rules.js')
    if (!a.ok) return { ok: false, why: a.error }
    try { (0, eval)(a.src); M = (globalThis as Any).CCMatch; rulesAt = Date.now() } catch (e) { return { ok: false, why: 'match-rules.js did not run: ' + String(e).slice(0, 80) } }
    return M ? { ok: true } : { ok: false, why: 'match-rules.js did not define CCMatch' }
  }
  const axCaregivers = async (): Promise<Map<string, Any> | null> => {
    if (axCgs && Date.now() - cgsAt < 300000) return axCgs
    const out = new Map<string, Any>(); let url: string | null = '/api/caregivers'
    for (let i = 0; url && i < 20; i++) {
      const r = await ax('GET', url)
      if (r.status !== 200) return null
      for (const g of arr(r.json?.results?.caregivers ?? r.json?.caregivers)) if (g?.id != null) out.set(String(g.id), g)
      const next = r.json?.results?.nextPage; url = typeof next === 'string' && next ? next.replace(/^https?:\/\/[^/]+/, '') : null
    }
    axCgs = out; cgsAt = Date.now(); return out
  }
  /** the client's care-plan answers (client_fact_current, plan/current layers), through their active Journey, as match-dark reads them */
  const clientFacts = async (axId: string): Promise<Any[] | null> => {
    const { data: ps } = await db.from('person_source_id').select('person_id').eq('system', 'axiscare').eq('entity_type', 'client').eq('source_id', axId).limit(1)
    const pid = ps?.[0]?.person_id; if (!pid) return null
    const { data: eps } = await db.from('journey_episode').select('episode_id, state, created_at').eq('person_id', pid)
    const ep = (eps ?? []).filter((e: Any) => ['provisional', 'open', 'converted', 'established'].includes(e.state)).sort((a: Any, z: Any) => String(z.created_at).localeCompare(String(a.created_at)))[0]
    if (!ep) return null
    const { data: fs } = await db.from('client_fact_current').select('kind, layer, value').eq('episode_id', ep.episode_id).in('layer', ['plan', 'current'])
    return fs ?? []
  }
  return {
    ax, supabaseUrl,
    now: () => new Date(),
    settings: async () => (await key('ops_settings')) ?? {},
    offers: async (bid) => (await db.from('family_offers').select('*').eq('booking_id', bid).order('created_at', { ascending: true })).data ?? [],
    updateOffer: async (id, vals) => !(await db.from('family_offers').update(vals).eq('id', id)).error,
    updateBooking: async (id, vals) => !(await db.from('family_bookings').update({ ...vals, updated_at: new Date().toISOString() }).eq('id', id)).error,
    claimBooking: async (id, vals) => {
      const { data, error } = await db.from('family_bookings').update({ ...vals, updated_at: new Date().toISOString() })
        .eq('id', id).eq('status', 'waiting_for_caregiver').is('caregiver_axiscare_id', null).select('id')
      return !error && Array.isArray(data) && data.length === 1
    },
    textCaregiver: async (axId, message) => {
      const g = await caregiver(axId), phone = normalisePhone(g?.phone)
      if (!g || !phone) return { ok: false, why: 'no phone on their Hub record' }
      return sms('family-offer', 'caregiver', { phone, first: String(g.first || '').trim(), name: [g.first, g.last].filter(Boolean).join(' ') }, message)
    },
    askBlockId: async (axId, name, client, needsTransport) => {
      const g = await caregiver(axId)
      if (!g) return `${name} isn't on the Hub's caregiver list`
      return shiftAskBlock(db, { cg: g, name, axId, client, needsTransport })
    },
    profiles: async (ids) => ids.length ? ((await db.from('caregiver_profiles').select(PROFILE_COLS).in('axiscare_id', ids)).data ?? []) : [],
    officeItem: async (item) => !(await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item })).error,
    closeItem: async (id, by, text) => {
      const it = (await items()).find((x) => x?.id === id)
      if (!it || it.status === 'done') return
      const at = new Date().toISOString()
      await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { ...it, status: 'done', last_at: at, last_activity_at: at, history: [...(it.history ?? []), { at, by, text }] } })
    },
    event: async (row) => { await opEvent(db, row) },
    confirmDue: async () => {
      const today = new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
      return (await db.from('family_bookings').select('*').eq('status', 'placed').eq('family_confirm_pending', true).is('family_confirmed_at', null).gte('visit_date', today).limit(100)).data ?? []
    },
    // Each family message is behind its own recorded approval: who's coming (2026-10-16), not filled (Release 1, 2026-10-17),
    // caregiver changed and time changed (Release 2, her decisions 5 and D, 2026-10-17).
    tellFamily: async (b, message, email, approvalKey = 'family_confirm_text_approved') => {
      const st = (await key('ops_settings')) ?? {}
      if (!Object.keys(SENDERS).includes(approvalKey) || !st[approvalKey]) return { ok: false, why: 'the family message is not approved in the Hub settings' }
      if (!b?.contact_id) return { ok: false, why: 'no family member on the booking' }
      const { data: c } = await db.from('circle_contacts').select('id, name, phone, email, sms_consent, stopped_at, axiscare_removed_at').eq('id', b.contact_id).maybeSingle()
      if (!c || c.stopped_at || c.axiscare_removed_at) return { ok: false, why: 'they are no longer in the Family Circle' }
      const phone = normalisePhone(c.phone), addr = String(c.email ?? '').trim()
      const first = String(c.name ?? '').split(' ')[0]
      if (c.sms_consent === true && phone) {
        const r = await sms(SENDERS[approvalKey], 'family', { phone, first, name: String(c.name ?? '') }, message, true)
        return r.ok ? { ok: true, how: 'sms' } : r
      }
      if (!addr) return { ok: false, why: 'no way to reach them (no Texts OK and no email)' }
      const g = ghl()
      if (!g.token || !g.locationId) return { ok: false, why: 'GoHighLevel is not set up on the server' }
      const contact = await contactForOutbound(db, g, { email: addr, firstName: first }, 'reactive_external', { audience: 'family', explicitlyEnabled: true, channel: 'email', sender: SENDERS[approvalKey] })
      if (!contact) return { ok: false, why: 'not sent (opted out, or the address is not trusted)' }
      const ok = await ghlSendChecked(db, headers(g.token), 'family-offer', { channel: 'email', contactId: contact.contactId, address: addr, who: String(c.name ?? '') }, email)
      return ok ? { ok: true, how: 'email' } : { ok: false, why: 'GoHighLevel refused the email (Needs Attention card raised)' }
    },
    matchFor: async (b) => {
      const rb = await rulebook(); if (!rb.ok) return { ok: false, why: rb.why }
      const cgs = await axCaregivers(); if (!cgs) return { ok: false, why: "AxisCare's caregiver list couldn't be read" }
      const cr = await ax('GET', `/api/clients/${encodeURIComponent(String(b.axiscare_client_id))}`)
      if (cr.status !== 200) return { ok: false, why: `AxisCare's client record couldn't be read (${cr.status})` }
      const cl = cr.json?.results?.client ?? cr.json?.results ?? {}
      const { data: plan } = await db.from('client_callin_current').select('only_ask').eq('axiscare_client_id', String(b.axiscare_client_id)).maybeSingle()
      const client: MatchClient = { name: String(b.client_name ?? ''), level: careLevelOf(cl?.classes).level || 1, facts: await clientFacts(String(b.axiscare_client_id)),
        onlyAsk: Array.isArray(plan?.only_ask) ? plan.only_ask : [] }
      const roster = new Map(arr(await key('caregivers')).map((g) => [String(g?.axiscare_id ?? '').replace(/\D/g, ''), g]))
      const overlay = new Map(arr(await key('caregiver_overlay')).map((o) => [String(o?.axiscare_id ?? ''), o]))
      const today = new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
      return { ok: true, home: homeNotes(M, client), judge: (c) => {
        const g = cgs.get(String(c.axiscare_id)) ?? {}, r = roster.get(String(c.axiscare_id)) ?? null
        const cg: MatchCaregiver = { axiscare_id: String(c.axiscare_id), name: c.name, level: careLevelOf(g.classes).level, gender: M.axisGender(g.gender), dementia_trained: !!r?.alz_date, overlay: overlay.get(String(c.axiscare_id)) ?? null }
        return judge(M, client, cg, today)
      } }
    },
    heldDue: async () => (await db.from('family_bookings').select('*').eq('status', 'held').lte('answer_by', new Date().toISOString()).limit(100)).data ?? [],
    declinedDue: async () => {
      const today = new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
      return (await db.from('family_bookings').select('*').eq('status', 'declined').eq('family_declined_pending', true).is('family_declined_at', null).gte('visit_date', today).limit(100)).data ?? []
    },
    // the welcome reminder (family-welcome-alert.ts): family members with an email on active circles, and whether the client is active
    candidates: async () => {
      const { data: cs } = await db.from('circle_contacts').select('id, name, email, relationship, source, hipaa_authorized, hipaa_office_ok_at, stopped_at, axiscare_removed_at, circle_id, welcome_sent_at, welcome_skip_at, welcome_ready_at').not('email', 'is', null)
      const ids = [...new Set((cs ?? []).map((c: Any) => String(c.circle_id)))]
      const { data: ks } = ids.length ? await db.from('care_circles').select('id, client_name, axiscare_client_id, active').in('id', ids) : { data: [] }
      const ax = [...new Set((ks ?? []).map((k: Any) => String(k.axiscare_client_id ?? '')).filter(Boolean))]
      const { data: ps } = ax.length ? await db.from('person_source_id').select('person_id, source_id').eq('system', 'axiscare').eq('entity_type', 'client').in('source_id', ax) : { data: [] }
      const persons = [...new Set((ps ?? []).map((p: Any) => p.person_id))]
      const { data: rs } = persons.length ? await db.from('person_role').select('person_id').eq('role', 'client').eq('status', 'active').in('person_id', persons) : { data: [] }
      const activePerson = new Set((rs ?? []).map((r: Any) => String(r.person_id)))
      const activeAx = new Set((ps ?? []).filter((p: Any) => activePerson.has(String(p.person_id))).map((p: Any) => String(p.source_id)))
      return (cs ?? []).map((c: Any) => { const k = (ks ?? []).find((x: Any) => String(x.id) === String(c.circle_id)) ?? {}
        return { ...c, client_name: k.client_name ?? null, axiscare_client_id: k.axiscare_client_id ?? null, circle_active: k.active !== false, client_active: activeAx.has(String(k.axiscare_client_id ?? '')) } })
    },
    stampReady: async (id, at) => { await db.from('circle_contacts').update({ welcome_ready_at: at }).eq('id', id).is('welcome_ready_at', null) },
    openCards: async () => arr(await key('ops_items')).filter((x) => String(x?.id ?? '').startsWith('fam_welcome_') && x?.status !== 'done').map((x) => String(x.id)),
    placedAhead: async (from, to) => (await db.from('family_bookings').select('*').eq('status', 'placed').not('axiscare_visit_id', 'is', null)
      .gte('visit_date', from).lte('visit_date', to).order('visit_date', { ascending: true }).limit(200)).data ?? [],
    coverage: async () => {
      const m = new Map<string, Any>()
      for (const k of ['coverage_cases_archive', 'coverage_cases']) for (const c of arr(await key(k))) { const v = String(c?.axiscare_visit_id ?? ''); if (v) m.set(v, c) }
      return m
    },
    changeDue: async () => {
      const today = new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
      return (await db.from('family_bookings').select('*').eq('status', 'placed').eq('family_change_pending', true).is('family_change_at', null).gte('visit_date', today).limit(100)).data ?? []
    },
    unfilledDue: async () => {
      const today = new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
      return (await db.from('family_bookings').select('*').eq('status', 'not_filled').eq('family_unfilled_pending', true).is('family_unfilled_at', null).gte('visit_date', today).limit(100)).data ?? []
    },
    clientAbout: async (axId) => {
      /* Caregiver Preview on (2026-10-24, her call: "use the same approved Caregiver Preview profile for both Cara and the
         Booking App"): the approved About only. Off: the Family Circle's About, as before. */
      if (((await key('ops_settings')) ?? {}).caregiver_preview_live === true) {
        const { row, circle } = await previewRecords(db, String(axId))
        return approvedIntro(row, circle).about
      }
      const { data } = await db.from('care_circles').select('caregiver_about').eq('axiscare_client_id', axId).eq('active', true).limit(1).maybeSingle()
      const t = String(data?.caregiver_about ?? '').trim()
      return t || null
    },
    textFamily: async (b, message) => {
      const st = (await key('ops_settings')) ?? {}
      if (!st.family_choose_text_approved) return { ok: false, why: 'the family text is not approved in the Hub settings' }
      if (!b?.contact_id) return { ok: false, why: 'no family member on the booking' }
      const { data: c } = await db.from('circle_contacts').select('id, name, phone, sms_consent, stopped_at, axiscare_removed_at').eq('id', b.contact_id).maybeSingle()
      const phone = normalisePhone(c?.phone)
      if (!c || c.sms_consent !== true || !phone || c.stopped_at || c.axiscare_removed_at) return { ok: false, why: 'no consent to text' }
      return sms('family-offer (Let me choose: caregivers are interested)', 'family', { phone, first: String(c.name ?? '').split(' ')[0], name: String(c.name ?? '') }, message, true)
    },
  }
}
