// =============================================================================
// prn-reconfirm — the PRN CNA Team's 60-day availability check-in (PRN4, 2026-09-29)
// =============================================================================
// Samantha approved ("yes to all"): every active PRN CNA whose availability was last confirmed 60+ days ago (or never)
// gets one short text with a sealed personal link: "Still right" or "Update", one tap. Weekdays 10am to 5pm Central,
// at most 20 a day, nobody texted twice within 14 days, the universal do-not-text / STOP door on every text. No reply
// after 14 days is shown on the PRN dashboard as "call them"; there is no second text. Caregivers only.
//
// PRACTICE until ops_settings.prn_reconfirm_live === true: it works out who would be texted and says so, and sends
// and records nothing. ?dry=1 is always practice. Runs on its weekday schedule (the vault secret) or the owner's key.
// Nothing here touches pay.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { contactForOutbound } from '../_shared/outreach.ts'
import { jobCaller } from '../_shared/job-auth.ts'
import { makeAvailLink, availExpiry } from '../_shared/prn-links.ts'
import { ghlSendChecked } from '../_shared/send-problems.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
export const DUE_DAYS = 60, QUIET_DAYS = 14, CAP = 20
export const DEFAULT_MSG = `Hi {first_name}! We're updating our Caring Companions PRN Team availability. Are you still available for the times you gave us? Tap to confirm or update: {link}`
const digits10 = (p: unknown) => { const d = String(p ?? '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : '' }
/* Weekdays, 10:00 to 17:00 Central. */
export function inWindow(now = new Date()): boolean {
  const wd = now.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/Chicago' })
  const h = Number(now.toLocaleString('en-US', { hour: '2-digit', hour12: false, timeZone: 'America/Chicago' }))
  return !['Sat', 'Sun'].includes(wd) && h >= 10 && h < 17
}

// deno-lint-ignore no-explicit-any
async function beat(db: any, ok: boolean, note: string) {
  try {
    await db.rpc('upsert_app_data_item', { target_key: 'automation_heartbeats',
      item: { id: 'hb_prn-reconfirm', automation: 'prn-reconfirm', at: new Date().toISOString(), ok, note: String(note).slice(0, 300) } })
  } catch { /* the check-in itself never waits on this */ }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const caller = await jobCaller(req)
  if (!caller) return json({ error: 'not allowed' }, 401)
  const q = new URL(req.url).searchParams
  if (q.get('auth_check') === '1') return json({ ok: true, caller })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const secret = Deno.env.get('HUB_JOB_SECRET') ?? ''
  const { data: stRow } = await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const st: any = stRow?.data ?? {}
  const live = st.prn_reconfirm_live === true && q.get('dry') !== '1'
  if (!inWindow()) return json({ ok: true, held: 'outside weekdays 10am to 5pm Central', live })

  const now = Date.now()
  const { data: tracks } = await db.from('pay_tracks').select('applicant_id, axiscare_caregiver_id').eq('track', 'prn_team').not('axiscare_caregiver_id', 'is', null)
  const key = async (k: string) => { const { data } = await db.from('app_data').select('data').eq('key', k).maybeSingle(); return Array.isArray(data?.data) ? data!.data : [] }
  // deno-lint-ignore no-explicit-any
  const av: any[] = await key('caregiver_availability'), roster: any[] = await key('caregivers')
  const { data: recent } = await db.from('prn_checkins').select('axiscare_caregiver_id, sent_at').gte('sent_at', new Date(now - QUIET_DAYS * 864e5).toISOString())
  const quiet = new Set((recent ?? []).map((r: { axiscare_caregiver_id: string }) => String(r.axiscare_caregiver_id)))
  const due: Array<{ axid: string; applicant_id: string; confirmed: number }> = []
  for (const t of tracks ?? []) {
    const axid = String(t.axiscare_caregiver_id)
    const item = av.find((x) => String(x?.axiscare_id ?? '') === axid || String(x?.id ?? '') === axid)
    const confirmed = item?.updated_at ? new Date(String(item.updated_at)).getTime() : 0
    if (confirmed && now - confirmed < DUE_DAYS * 864e5) continue
    if (quiet.has(axid)) continue
    due.push({ axid, applicant_id: t.applicant_id, confirmed })
  }
  due.sort((a, b) => a.confirmed - b.confirmed)   // the longest since they confirmed goes first
  const batch = due.slice(0, CAP)
  const tmpl = String(st.prn_reconfirm_msg || '') || DEFAULT_MSG
  const out = { live, due: due.length, this_run: batch.length, texted: 0, no_phone: 0, refused: 0, failed: 0 }
  const ghl = { token: Deno.env.get('GHL_TOKEN') ?? '', locationId: Deno.env.get('GHL_LOCATION_ID') ?? '' }
  for (const d of batch) {
    const g = roster.find((x) => x?.active !== false && String(x?.axiscare_id ?? '') === d.axid)
    let first = g ? String(g.first || '').trim() : '', phone = g ? digits10(g.phone) : ''
    if (!phone) {
      const { data: ap } = await db.from('job_applicants').select('first_name, phone').eq('id', d.applicant_id).maybeSingle()
      first = first || String(ap?.first_name || '').trim(); phone = digits10(ap?.phone)
    }
    if (!phone) { out.no_phone++; continue }
    if (!live) continue
    if (!ghl.token || !ghl.locationId || secret.length < 32) { out.failed++; continue }
    const contact = await contactForOutbound(db, ghl, { phone, firstName: first || 'there' }, 'routine_internal', { audience: 'caregiver', channel: 'sms', sender: 'prn-reconfirm' })
    if (!contact) { out.refused++; continue }
    const link = await makeAvailLink(secret, d.axid, availExpiry())
    const message = tmpl.replaceAll('{first_name}', first || 'there').replaceAll('{link}', link)
    /* NO SILENT FAILURES (2026-10-01): a text GoHighLevel refuses raises a card on Needs Attention (it is still not
       recorded as sent, so the next run tries again) */
    const ok = await ghlSendChecked(db, { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
      'prn-reconfirm', { channel: 'sms', contactId: contact.contactId, address: phone, who: first }, { message })
    if (!ok) { out.failed++; continue }
    await db.from('prn_checkins').insert({ axiscare_caregiver_id: d.axid, applicant_id: d.applicant_id, sent_at: new Date().toISOString() })
    out.texted++
  }
  if (!live) Object.assign(out, { would_text: batch.length - out.no_phone })
  if (q.get('dry') !== '1') await beat(db, out.failed === 0, JSON.stringify(out))
  return json({ ok: true, ...out })
})
