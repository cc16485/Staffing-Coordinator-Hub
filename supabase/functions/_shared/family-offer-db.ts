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

// deno-lint-ignore no-explicit-any
type Any = any
const arr = (x: unknown) => (Array.isArray(x) ? x : []) as Any[]
const PROFILE_COLS = 'axiscare_id, first_name, last_name, preferred_name, about, experience, why_this_work, years_experience, photo_path, photo_url, video_path, consent, published, status, photo_hidden, video_hidden'

export function chooseDepsFor(db: Any, ax: Ax, supabaseUrl: string): ChooseDeps & { textFamily: (b: Any, message: string) => Promise<{ ok: boolean; why?: string }> } {
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
