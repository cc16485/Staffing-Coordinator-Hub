// =============================================================================
// prn-welcome — PRN step 4: the welcome text to a new PRN member (Samantha 2026-10-29; rules in _shared/prn-welcome.ts)
// =============================================================================
// Her approved wording, once, to each PRN member linked in AxisCare in the last 7 days who hasn't had it. Weekdays 10am to
// 5pm Central, from the office number, through the same gates as every caregiver text (phone identity, the universal
// opt-out incl. GoHighLevel Do Not Disturb). A text GoHighLevel refuses raises a card on Needs Attention and is not
// recorded, so the next run tries again. Each one sent is kept in prn_touches (welcome_sent, the message as sent).
//
// PRACTICE until ops_settings.prn_welcome_live === true: it works out who would be welcomed and says so, and sends and
// records nothing. ?dry=1 is always practice. Runs on its weekday schedule (the vault secret) or the owner's key.
// STEP 5a (2026-10-29): with the PRN Team page open, the welcome can carry their page link (prn_welcome_link_live), and the
// same run sends "your PRN Team page is ready" once to members who joined before (prn_page_ready_live). Rules in
// _shared/prn-page-texts.ts. Each is practice until its switch is on, the same way.
// STEP 7 (2026-10-29): in May and November (the first 30 days), the same run sends one invite to the twice-yearly "What would
// make PRN better?" questions on their page (prn_feedback_live, and the page open), at most 20 a day, once per member per
// round, sender prn-feedback. Rules in _shared/prn-recognition.ts.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { contactForOutbound, normalisePhone } from '../_shared/outreach.ts'
import { jobCaller } from '../_shared/job-auth.ts'
import { ghlSendChecked } from '../_shared/send-problems.ts'
import { dueWelcomes, welcomeText } from '../_shared/prn-welcome.ts'
import { dueReady, keptMessage, linkSwitches, pageReadyText, welcomeWithLink } from '../_shared/prn-page-texts.ts'
import { makePageLink, pageExpiry } from '../_shared/prn-page-links.ts'
import { dueFeedback, feedbackLive, feedbackRef, feedbackRound, feedbackText } from '../_shared/prn-recognition.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const S = (v: unknown, n = 200) => String(v ?? '').trim().slice(0, n)
/* Weekdays, 10:00 to 17:00 Central (the same window as the 60-day check-in). */
export function inWindow(now = new Date()): boolean {
  const wd = now.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/Chicago' })
  const h = Number(now.toLocaleString('en-US', { hour: '2-digit', hour12: false, timeZone: 'America/Chicago' }))
  return !['Sat', 'Sun'].includes(wd) && h >= 10 && h < 17
}
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })

// deno-lint-ignore no-explicit-any
async function beat(db: any, ok: boolean, note: string) {
  try {
    await db.rpc('upsert_app_data_item', { target_key: 'automation_heartbeats',
      item: { id: 'hb_prn-welcome', automation: 'prn-welcome', at: new Date().toISOString(), ok, note: String(note).slice(0, 300) } })
  } catch { /* the welcome itself never waits on this */ }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const caller = await jobCaller(req)
  if (!caller) return json({ error: 'not allowed' }, 401)
  const q = new URL(req.url).searchParams
  if (q.get('auth_check') === '1') return json({ ok: true, caller })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: stRow } = await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const st: any = stRow?.data ?? {}
  const dry = q.get('dry') === '1', live = st.prn_welcome_live === true && !dry
  const sw = linkSwitches(st), secret = Deno.env.get('HUB_JOB_SECRET') ?? ''
  const pageLink = async (aid: string) => secret.length >= 32 ? await makePageLink(secret, aid, pageExpiry()).catch(() => '') : ''
  if (!dry && !inWindow()) return json({ ok: true, held: 'outside weekdays 10am to 5pm Central', live })

  const { data: tracks, error: te } = await db.from('pay_tracks').select('applicant_id, track, team, linked_at, axiscare_caregiver_id').eq('track', 'prn_team')
  if (te) return json({ error: 'could not read the PRN Teams: ' + te.message }, 500)
  const ids = (tracks ?? []).map((t: { applicant_id: string }) => t.applicant_id)
  const { data: touches, error: ce } = ids.length ? await db.from('prn_touches').select('applicant_id, kind, ref, message').in('applicant_id', ids) : { data: [], error: null }
  if (ce) return json({ error: 'The PRN records are not set up yet (prn_week.sql).' }, 500)
  const due = dueWelcomes(tracks ?? [], touches ?? [], today())
  const { data: rosterRow } = await db.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const roster: any[] = Array.isArray(rosterRow?.data) ? rosterRow!.data : []
  const out = { live, due: due.length, texted: 0, no_phone: 0, refused: 0, failed: 0, would_welcome: [] as string[], with_page_link: sw.welcome,
    ready_live: sw.ready && !dry, ready_due: 0, ready_texted: 0, ready_no_phone: 0, ready_refused: 0, ready_failed: 0, would_ready: [] as string[],
    feedback_round: null as string | null, feedback_live: feedbackLive(st) && !dry, feedback_due: 0, feedback_texted: 0, feedback_no_phone: 0, feedback_refused: 0, feedback_failed: 0, would_feedback: [] as string[] }
  const ghl = { token: Deno.env.get('GHL_TOKEN') || Deno.env.get('GHL_API_KEY') || '', locationId: Deno.env.get('GHL_LOCATION_ID') ?? '' }
  for (const d of due) {
    const g = roster.find((x) => x?.active !== false && String(x?.axiscare_id ?? '') === String(d.axiscare_caregiver_id))
    const { data: ap } = await db.from('job_applicants').select('first_name, last_name, phone').eq('id', d.applicant_id).maybeSingle()
    const first = S(g?.first, 40).split(/\s+/)[0] || S(ap?.first_name, 40).split(/\s+/)[0]
    const phone = normalisePhone(g?.phone) || normalisePhone(ap?.phone)
    if (!phone) { out.no_phone++; continue }
    let message = welcomeText(st.prn_welcome_msg, first, d.team === 'caregiver' ? 'caregiver' : 'cna'), link = ''
    if (sw.welcome && live) { link = await pageLink(d.applicant_id); if (!link) { out.failed++; continue } message = welcomeWithLink(message, link) }
    else message = message.replaceAll('{link}', '').replace(/\s{2,}/g, ' ').trim()
    if (!live) { out.would_welcome.push([first, S(ap?.last_name, 1)].filter(Boolean).join(' ') + (d.team === 'caregiver' ? ' (PRN Caregiver Team)' : ' (PRN CNA Team)')); continue }
    if (!ghl.token || !ghl.locationId) { out.failed++; continue }
    const contact = await contactForOutbound(db, ghl, { phone, firstName: first || 'there', lastName: S(ap?.last_name, 40) || undefined }, 'routine_internal',
      { audience: 'caregiver', channel: 'sms', sender: 'prn-welcome' })
    if (!contact) { out.refused++; continue }
    const ok = await ghlSendChecked(db, { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
      'prn-welcome', { channel: 'sms', contactId: contact.contactId, address: phone, who: first }, { message })
    if (!ok) { out.failed++; continue }
    await db.from('prn_touches').insert({ applicant_id: d.applicant_id, kind: 'welcome_sent', ref: 'welcome', message: keptMessage(message, link), by_email: 'automatic', by_name: 'Caring Companions (automatic)' })
    out.texted++
  }

  /* "your PRN Team page is ready": once, to members who joined before the welcome could carry the link */
  const ready = dueReady(tracks ?? [], touches ?? [], today())
  out.ready_due = ready.length
  for (const d of ready) {
    const g = roster.find((x) => x?.active !== false && String(x?.axiscare_id ?? '') === String(d.axiscare_caregiver_id))
    const { data: ap } = await db.from('job_applicants').select('first_name, last_name, phone').eq('id', d.applicant_id).maybeSingle()
    const first = S(g?.first, 40).split(/\s+/)[0] || S(ap?.first_name, 40).split(/\s+/)[0]
    const phone = normalisePhone(g?.phone) || normalisePhone(ap?.phone)
    if (!phone) { out.ready_no_phone++; continue }
    if (!out.ready_live) { out.would_ready.push([first, S(ap?.last_name, 1)].filter(Boolean).join(' ') + (d.team === 'caregiver' ? ' (PRN Caregiver Team)' : ' (PRN CNA Team)')); continue }
    const link = await pageLink(d.applicant_id)
    if (!ghl.token || !ghl.locationId || !link) { out.ready_failed++; continue }
    const contact = await contactForOutbound(db, ghl, { phone, firstName: first || 'there', lastName: S(ap?.last_name, 40) || undefined }, 'routine_internal',
      { audience: 'caregiver', channel: 'sms', sender: 'prn-welcome' })
    if (!contact) { out.ready_refused++; continue }
    const message = pageReadyText(st.prn_page_ready_msg, first, link)
    const ok = await ghlSendChecked(db, { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
      'prn-welcome', { channel: 'sms', contactId: contact.contactId, address: phone, who: first }, { message })
    if (!ok) { out.ready_failed++; continue }
    await db.from('prn_touches').insert({ applicant_id: d.applicant_id, kind: 'page_ready_sent', ref: 'page_ready', message: keptMessage(message, link),
      by_email: 'automatic', by_name: 'Caring Companions (automatic)' })
    out.ready_texted++
  }
  /* step 7: the twice-yearly questions, one invite per member per round */
  const round = feedbackRound(today())
  out.feedback_round = round?.id ?? null
  const fb = round ? dueFeedback(tracks ?? [], touches ?? [], round.id) : []
  out.feedback_due = fb.length
  for (const d of fb) {
    const g = roster.find((x) => x?.active !== false && String(x?.axiscare_id ?? '') === String(d.axiscare_caregiver_id))
    const { data: ap } = await db.from('job_applicants').select('first_name, last_name, phone').eq('id', d.applicant_id).maybeSingle()
    const first = S(g?.first, 40).split(/\s+/)[0] || S(ap?.first_name, 40).split(/\s+/)[0]
    const phone = normalisePhone(g?.phone) || normalisePhone(ap?.phone)
    if (!phone) { out.feedback_no_phone++; continue }
    if (!out.feedback_live) { out.would_feedback.push([first, S(ap?.last_name, 1)].filter(Boolean).join(' ')); continue }
    const link = await pageLink(d.applicant_id)
    if (!ghl.token || !ghl.locationId || !link) { out.feedback_failed++; continue }
    const contact = await contactForOutbound(db, ghl, { phone, firstName: first || 'there', lastName: S(ap?.last_name, 40) || undefined }, 'routine_internal',
      { audience: 'caregiver', channel: 'sms', sender: 'prn-feedback' })
    if (!contact) { out.feedback_refused++; continue }
    const message = feedbackText(st.prn_feedback_msg, first, link)
    const ok = await ghlSendChecked(db, { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
      'prn-feedback', { channel: 'sms', contactId: contact.contactId, address: phone, who: first }, { message })
    if (!ok) { out.feedback_failed++; continue }
    await db.from('prn_touches').insert({ applicant_id: d.applicant_id, kind: 'feedback_invite_sent', ref: feedbackRef(round!.id), message: keptMessage(message, link),
      by_email: 'automatic', by_name: 'Caring Companions (automatic)' })
    out.feedback_texted++
  }
  if (!dry) await beat(db, out.failed === 0 && out.ready_failed === 0 && out.feedback_failed === 0, JSON.stringify({ ...out, would_welcome: out.would_welcome.length, would_ready: out.would_ready.length, would_feedback: out.would_feedback.length }))
  return json({ ok: true, ...out })
})
