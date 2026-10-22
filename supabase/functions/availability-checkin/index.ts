// =============================================================================
// availability-checkin — every caregiver's 30-day availability text (Samantha, 2026-10-14)
// =============================================================================
// Her ask: "could we have their availability text send every 30 days and if they already have their availability on file
// have it show what we have on file and they can choose to keep it the same or update it, and always offer for them to
// check that they want us to still have them on the list to reach out for shifts outside their availability".
//
// Who: active caregivers (active on the Hub roster AND in AxisCare, with a phone and an AxisCare number), never nurses,
// never the PRN CNA Team (they keep their own 60-day check-in, prn-reconfirm). Due when their availability was last
// saved or confirmed 30+ days ago, or never, and nobody texted them an availability link in the last 30 days (this job
// and the office's "Text the availability link" button share that log, availability_invites, so nobody gets both).
// The text carries their own sealed link (the same one the PRN check-in uses): the page opens on what we have on file,
// with "Keep it the same" or change and save, and the "also text me about shifts outside my availability" box every time.
// Nothing on file: a different text asks them to fill it in (until then they count as available any time, her rule).
//
// Weekdays 10am to 5pm Central, at most 25 a run, the universal do-not-text / STOP door on every text, every refused
// text raised as a card (no silent failures). PRACTICE until ops_settings.avail_checkin_live === true: it works out who
// would be texted and says so, and sends and records nothing. ?dry=1 is always practice. If AxisCare can't be read, the
// run holds (an ex-employee is never texted on roster data alone).
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { contactForOutbound } from '../_shared/outreach.ts'
import { jobCaller } from '../_shared/job-auth.ts'
import { makeAvailLink, availExpiry } from '../_shared/prn-links.ts'
import { ghlSendChecked } from '../_shared/send-problems.ts'
import { readCensus } from '../_shared/axis-census.ts'
import { isWorking, inTrainingLive } from '../_shared/in-training.ts'   // 2026-10-22 In Training is onboarding

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
export const DUE_DAYS = 30, CAP = 25
export const MSG_ON_FILE = `Hi {first_name}, it's Caring Companions! Are the days and times you can work still the same? Tap to keep them or update them, and to choose if you'd like texts about shifts outside those times: {link}`
export const MSG_NONE = `Hi {first_name}, it's Caring Companions! Tell us the days and times you can work so we can offer you shifts that fit: {link} You can also choose to get texts about shifts outside those times. It takes 30 seconds.`
const digits10 = (p: unknown) => { const d = String(p ?? '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : '' }
const nameKey = (n: string) => n.toLowerCase().replace(/[^a-z ]/g, '').split(/\s+/).filter(Boolean).join(' ')
/* Weekdays, 10:00 to 17:00 Central (same window as the PRN check-in and the office's invite button). */
export function inWindow(now = new Date()): boolean {
  const wd = now.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/Chicago' })
  const h = Number(now.toLocaleString('en-US', { hour: '2-digit', hour12: false, timeZone: 'America/Chicago' }))
  return !['Sat', 'Sun'].includes(wd) && h >= 10 && h < 17
}
const hasWindows = (a: { windows?: Record<string, unknown> } | undefined) => !!a?.windows && Object.values(a.windows).some((v) => Array.isArray(v) && v.length)

// deno-lint-ignore no-explicit-any
async function beat(db: any, ok: boolean, note: string) {
  try {
    await db.rpc('upsert_app_data_item', { target_key: 'automation_heartbeats',
      item: { id: 'hb_availability-checkin', automation: 'availability-checkin', at: new Date().toISOString(), ok, note: String(note).slice(0, 300) } })
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
  const key = async (k: string) => { const { data } = await db.from('app_data').select('data').eq('key', k).maybeSingle(); return data?.data }
  // deno-lint-ignore no-explicit-any
  const st: any = (await key('ops_settings')) ?? {}
  const live = st.avail_checkin_live === true && q.get('dry') !== '1'
  if (!inWindow()) return json({ ok: true, held: 'outside weekdays 10am to 5pm Central', live })

  const census = await readCensus()
  if (!census.ok) { if (q.get('dry') !== '1') await beat(db, false, 'held: ' + census.error); return json({ ok: false, held: 'AxisCare could not be read, so nobody was texted: ' + census.error, live }) }
  /* 2026-10-22: In Training (onboarding) gets no 30-day text once ops_settings.in_training_lock_live is on */
  const trainLive = await inTrainingLive(st)
  const axActive = new Set(census.rows.filter((r) => isWorking(r.active, r.status_label, trainLive)).map((r) => r.id))

  const now = Date.now()
  // deno-lint-ignore no-explicit-any
  const arr = (x: unknown) => (Array.isArray(x) ? x : []) as any[]
  const roster = arr(await key('caregivers')), av = arr(await key('caregiver_availability')), invites = arr(await key('availability_invites'))
  const nurses = new Set(arr(await key('nurse_staff')).map((s) => nameKey(String(s?.name || ''))))
  const { data: prn } = await db.from('pay_tracks').select('axiscare_caregiver_id').eq('track', 'prn_team').not('axiscare_caregiver_id', 'is', null)
  const prnTeam = new Set((prn ?? []).map((t: { axiscare_caregiver_id: string }) => String(t.axiscare_caregiver_id)))
  const lastInvite = new Map<string, number>()
  for (const i of invites) { const t = new Date(String(i?.at || 0)).getTime(); if (t > (lastInvite.get(String(i?.id)) ?? 0)) lastInvite.set(String(i?.id), t) }

  const due: Array<{ axid: string; name: string; first: string; phone: string; onFile: boolean; confirmed: number }> = []
  const skipped = { not_in_axiscare: 0, no_phone: 0, nurse: 0, prn_team: 0 }
  const seen = new Set<string>()
  for (const g of roster) {
    if (g?.active === false) continue
    const axid = String(g?.axiscare_id ?? '').trim()
    if (!/^\d{1,12}$/.test(axid) || seen.has(axid)) continue
    seen.add(axid)
    const name = [String(g.first || '').trim(), String(g.last || '').trim()].filter(Boolean).join(' ')
    if (!axActive.has(axid)) { skipped.not_in_axiscare++; continue }
    if (nurses.has(nameKey(name))) { skipped.nurse++; continue }
    if (prnTeam.has(axid)) { skipped.prn_team++; continue }
    const phone = digits10(g.phone)
    if (!phone) { skipped.no_phone++; continue }
    const item = av.find((x) => String(x?.axiscare_id ?? '') === axid) || av.find((x) => String(x?.id ?? '') === axid)
    const confirmed = item?.updated_at ? new Date(String(item.updated_at)).getTime() : 0
    if (confirmed && now - confirmed < DUE_DAYS * 864e5) continue
    if (now - (lastInvite.get(axid) ?? 0) < DUE_DAYS * 864e5) continue
    due.push({ axid, name, first: String(g.first || '').trim() || 'there', phone, onFile: hasWindows(item), confirmed })
  }
  due.sort((a, b) => a.confirmed - b.confirmed)   // the longest since they told us goes first (never told us = first)
  const batch = due.slice(0, CAP)
  const tOn = String(st.avail_checkin_msg_on_file || '') || MSG_ON_FILE, tNone = String(st.avail_checkin_msg_none || '') || MSG_NONE
  const out = { live, due: due.length, this_run: batch.length, on_file: batch.filter((d) => d.onFile).length, nothing_on_file: batch.filter((d) => !d.onFile).length,
    texted: 0, refused: 0, failed: 0, skipped, failed_to: [] as string[] }
  const ghl = { token: Deno.env.get('GHL_TOKEN') ?? '', locationId: Deno.env.get('GHL_LOCATION_ID') ?? '' }
  if (live) for (const d of batch) {
    if (!ghl.token || !ghl.locationId || secret.length < 32) { out.failed++; out.failed_to.push(d.name); continue }
    const contact = await contactForOutbound(db, ghl, { phone: d.phone, firstName: d.first }, 'routine_internal', { audience: 'caregiver', channel: 'sms', sender: 'availability-checkin' })
    if (!contact) { out.refused++; continue }
    const link = await makeAvailLink(secret, d.axid, availExpiry())
    const message = (d.onFile ? tOn : tNone).replaceAll('{first_name}', d.first).replaceAll('{link}', link)
    /* NO SILENT FAILURES: a text GoHighLevel refuses raises a card on Needs Attention; it is not logged as sent, so the next run tries again */
    const ok = await ghlSendChecked(db, { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
      'availability-checkin', { channel: 'sms', contactId: contact.contactId, address: d.phone, who: d.name }, { message })
    if (!ok) { out.failed++; out.failed_to.push(d.name); continue }
    await db.rpc('upsert_app_data_item', { target_key: 'availability_invites', item: { id: d.axid, name: d.name, at: new Date().toISOString(), via: 'availability-checkin', on_file: d.onFile } })
    out.texted++
  }
  if (!live) Object.assign(out, { would_text: batch.map((d) => ({ name: d.name, text: d.onFile ? 'on file: keep or update' : 'nothing on file: fill it in' })) })
  if (q.get('dry') !== '1') await beat(db, out.failed === 0, JSON.stringify({ ...out, would_text: undefined, failed_to: out.failed_to.slice(0, 5) }))
  return json({ ok: true, ...out })
})
