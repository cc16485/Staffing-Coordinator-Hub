// =============================================================================
// prn-week — PRN step 2: the "This week" list on the PRN Teams page and the PRN CNA Team's on-call calendar
// (Samantha 2026-10-28, the office-side sample she approved the same day; rules in _shared/prn-week.ts)
// =============================================================================
// Signed-in office staff only (owner_admin, care_coordinator, staffing_coordinator). Nothing here runs on its own and
// nothing goes out unless a person presses Send.
//   week          the list (capped), the on-call weekends and offers, who owns the list, and the switches. Reads only.
//   send_thanks   {applicant_id, case_id, message, send_id}: the thank-you the person read and edited, texted from the office
//                 number through the same gates as every caregiver text (phone identity, the universal opt-out incl.
//                 GoHighLevel Do Not Disturb), then recorded in prn_touches. Switch ops_settings.prn_thanks_live (off: refused,
//                 nothing sent). A refused or failed text records nothing and says why.
//   mark          {applicant_id, kind: card_mailed | called | thanks_sent | not_this_one, ref, note?}: what the office did
//                 (thanks_sent here = thanked another way, in person or by phone). Kept, never edited.
//   oncall_offer  {applicant_id, pattern, note?}: what a PRN CNA offered (every weekend, every other weekend, one weekend a
//                 month, a weekday, not right now), usually from the welcome call. An offer never puts anyone on call.
//   oncall_confirm {applicant_id, start_date, end_date, note?}: a date the office confirmed with them (up to 7 days). Shows on
//                 their PRN Team page later (step 5).
//   oncall_cancel {id}: takes a confirmed date back (kept, marked cancelled).
// The list itself shows to everyone in the office once ops_settings.prn_week_live is on; before that the Hub shows it to
// owners only, as a practice view. No pay anywhere: the on-call stipend amount is not set (her call).
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { contactForOutbound, maySendTo, normalisePhone } from '../_shared/outreach.ts'
import { opEvent } from '../_shared/events.ts'
import { MO_FROM } from '../_shared/office-from.ts'   // every text goes out from (417) 234-8494
import { computeWeek, onCallWeekends, THANKS_DEFAULT, PATTERNS, type Member } from '../_shared/prn-week.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const MAX_TEXT = 640
// deno-lint-ignore no-explicit-any
type Any = any
const S = (v: unknown, n = 200) => String(v ?? '').trim().slice(0, n)
const firstOf = (s: unknown) => S(s).split(/\s+/)[0] || ''
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
const ymd = (v: unknown) => /^\d{4}-\d\d-\d\d$/.test(S(v, 10)) ? S(v, 10) : ''
const UUID = /^[0-9a-f-]{36}$/i
// deno-lint-ignore no-explicit-any
async function readKey(sb: any, key: string): Promise<Any> { const { data } = await sb.from('app_data').select('data').eq('key', key).maybeSingle(); return data?.data ?? null }
const list = (v: Any): Any[] => Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : [])

// deno-lint-ignore no-explicit-any
async function members(sb: any): Promise<Member[]> {
  const { data: tr } = await sb.from('pay_tracks').select('applicant_id, track, team, since, axiscare_caregiver_id').eq('track', 'prn_team')
  if (!tr?.length) return []
  const { data: apps } = await sb.from('job_applicants').select('id, first_name, last_name').in('id', tr.map((t: Any) => t.applicant_id))
  return tr.map((t: Any) => { const a = (apps ?? []).find((x: Any) => x.id === t.applicant_id) || {}
    const name = [a.first_name, a.last_name].map((x: unknown) => S(x)).filter(Boolean).join(' ') || 'A PRN member'
    return { applicant_id: t.applicant_id, name, first: firstOf(a.first_name) || firstOf(name), team: t.team === 'caregiver' ? 'caregiver' : 'cna', since: S(t.since, 10),
      axiscare_id: t.axiscare_caregiver_id ? String(t.axiscare_caregiver_id) : null } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const who = await requireStaff(sb, req, OFFICE_ROLES)
  if (!who.ok) return json({ error: who.error }, who.status)
  let b: Any = {}
  try { b = await req.json() } catch { b = {} }
  const action = S(b?.action, 40)
  const st = (await readKey(sb, 'ops_settings')) || {}
  const mem = await members(sb)
  const memberOf = (aid: unknown) => mem.find((m) => m.applicant_id === S(aid, 40)) || null

  if (action === 'week') {
    const ids = mem.map((m) => m.applicant_id)
    const [sh, tc, oc] = ids.length ? await Promise.all([
      sb.from('prn_shift_log').select('*').in('applicant_id', ids),
      sb.from('prn_touches').select('*').in('applicant_id', ids),
      sb.from('prn_oncall').select('*').in('applicant_id', ids).order('at')]) : [{ data: [] }, { data: [] }, { data: [] }]
    if (tc.error || oc.error) return json({ error: 'The PRN week records are not set up yet (prn_week.sql).' }, 500)
    const kindTo: Record<string, string> = {}
    for (const k of list(await readKey(sb, 'kind_tells'))) for (const t of list(k?.tells)) { const ax = S(t?.caregiver_ax, 20); if (ax && S(t?.at) > (kindTo[ax] || '')) kindTo[ax] = S(t.at) }
    const wantsMore: Record<string, number> = {}
    for (const a of list(await readKey(sb, 'caregiver_availability'))) { const ax = S(a?.axiscare_id ?? a?.id, 20), h = Number(a?.target_hours); if (ax && h > 0) wantsMore[ax] = Math.round(h) }
    const cases: Record<string, { client: string; shift_date: string | null }> = {}
    for (const c of list(await readKey(sb, 'coverage_cases'))) if (c?.id) cases[String(c.id)] = { client: firstOf(c.client), shift_date: ymd(c.shift_date) || null }
    const t = today()
    const wk = computeWeek({ members: mem, shifts: sh.data ?? [], touches: tc.data ?? [], kindTo, wantsMore, cases, today: t, sender: who.name, thanksTmpl: st.prn_thanks_msg })
    const oncall = onCallWeekends(oc.data ?? [], mem, t)
    return json({ ok: true, today: t, live: st.prn_week_live === true, thanks_live: st.prn_thanks_live === true, owner: S(st.prn_week_owner, 80) || 'Krystal',
      thanks_default: THANKS_DEFAULT, items: wk.items, more: wk.more, members: mem.map((m) => ({ applicant_id: m.applicant_id, name: m.name, team: m.team, axiscare_id: m.axiscare_id })),
      oncall: { ...oncall, patterns: PATTERNS, stipend: null } })
  }

  if (action === 'mark') {
    const m = memberOf(b.applicant_id); if (!m) return json({ error: 'That person is not on a PRN Team.' }, 404)
    const kind = ['card_mailed', 'called', 'thanks_sent', 'not_this_one'].includes(S(b.kind, 20)) ? S(b.kind, 20) : ''
    const ref = S(b.ref, 120)
    if (!kind || !ref) return json({ error: 'What was done, and for which line?' }, 400)
    const { error } = await sb.from('prn_touches').insert({ applicant_id: m.applicant_id, kind, ref, note: S(b.note, 600) || null, by_email: who.email, by_name: who.name })
    if (error && !/duplicate|unique/i.test(error.message)) return json({ error: 'Could not record it: ' + error.message }, 500)
    await opEvent(sb, { verb: 'prn_week_' + kind, actor_name: who.name, actor_email: who.email, item_id: m.applicant_id, area: 'caregivers', summary: `${who.name}: ${kind.replace(/_/g, ' ')} for ${m.name} (${ref})` })
    return json({ outcome: error ? 'already' : 'recorded' })
  }

  if (action === 'send_thanks') {
    if (st.prn_thanks_live !== true) return json({ outcome: 'off', error: 'Texting thank-yous is switched off (Settings, PRN Teams). Nothing was sent.' }, 409)
    const m = memberOf(b.applicant_id); if (!m) return json({ error: 'That person is not on a PRN Team.' }, 404)
    const caseId = S(b.case_id, 80), sendId = S(b.send_id, 64)
    if (!caseId) return json({ error: 'Which shift is this thank-you for?' }, 400)
    if (!/^[a-z0-9-]{8,64}$/i.test(sendId)) return json({ error: 'bad send id' }, 400)
    const message = S(b.message, 2000).replace(/\r\n/g, '\n')
    if (!message) return json({ error: 'The message is empty.' }, 400)
    if (message.length > MAX_TEXT) return json({ error: `The message is ${message.length} characters; keep it under ${MAX_TEXT}.` }, 400)
    if (/—/.test(message)) return json({ error: 'Please use a comma or a period instead of an em dash.' }, 400)
    const ref = 'shift:' + caseId
    const { data: done } = await sb.from('prn_touches').select('id').eq('applicant_id', m.applicant_id).eq('kind', 'thanks_sent').eq('ref', ref).maybeSingle()
    if (done) return json({ outcome: 'already_sent' })
    const roster = list(await readKey(sb, 'caregivers'))
    const cg = m.axiscare_id ? roster.find((c: Any) => String(c?.axiscare_id ?? '') === m.axiscare_id) : null
    const { data: app } = await sb.from('job_applicants').select('phone, first_name, last_name').eq('id', m.applicant_id).maybeSingle()
    const phone = normalisePhone(cg?.phone) || normalisePhone(app?.phone)
    if (!phone) return json({ outcome: 'no_phone', error: `${m.name} has no usable phone number on file. Nothing was sent.` }, 422)
    const ghl = { token: Deno.env.get('GHL_TOKEN') || Deno.env.get('GHL_API_KEY') || '', locationId: Deno.env.get('GHL_LOCATION_ID') ?? '' }
    if (!ghl.token || !ghl.locationId) return json({ error: 'GoHighLevel is not configured. Nothing was sent.' }, 502)
    const dest = await maySendTo(sb, phone)
    let refusal: string[] = []
    const contact = await contactForOutbound(sb, ghl, { phone, firstName: cg?.first || app?.first_name, lastName: cg?.last || app?.last_name }, 'urgent_internal',
      { audience: 'caregiver', channel: 'sms', sender: 'prn-week', humanInitiated: true, onOptOut: (r: string[]) => { refusal = r } })
    if (!contact) {
      const why = refusal.length ? `${m.name} has asked not to get texts (${refusal.join('; ')})`
        : !dest.allowed ? `${m.name}'s phone number isn't cleared for texting (${dest.reason})`
        : 'the opt-out check could not be completed (GoHighLevel did not answer). Try again in a minute'
      await opEvent(sb, { verb: 'prn_thanks_refused', actor_name: who.name, actor_email: who.email, item_id: m.applicant_id, area: 'caregivers', summary: `Thank-you to ${m.name} not sent`, data: { why } })
      return json({ outcome: 'refused', error: `Not sent: ${why}.` }, 422)
    }
    let ok = false, err = ''
    try {
      const r = await fetch('https://services.leadconnectorhq.com/conversations/messages', { method: 'POST',
        headers: { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'SMS', fromNumber: MO_FROM, contactId: contact.contactId, message }) })
      ok = r.ok; if (!r.ok) err = `GoHighLevel answered ${r.status}`
    } catch { err = 'could not reach GoHighLevel' }
    if (!ok) return json({ outcome: 'failed', error: `Not sent: ${err}.` }, 502)
    const { error } = await sb.from('prn_touches').insert({ applicant_id: m.applicant_id, kind: 'thanks_sent', ref, message, by_email: who.email, by_name: who.name })
    await opEvent(sb, { verb: 'prn_thanks_sent', actor_name: who.name, actor_email: who.email, item_id: m.applicant_id, area: 'caregivers',
      summary: `${who.name} thanked ${m.name} for covering a shift`, data: { case_id: caseId, message } })
    return json({ outcome: 'sent', warning: error ? 'The text was sent, but it could not be marked as sent: ' + error.message : null })
  }

  if (action === 'oncall_offer' || action === 'oncall_confirm') {
    const m = memberOf(b.applicant_id); if (!m) return json({ error: 'That person is not on a PRN Team.' }, 404)
    if (m.team !== 'cna') return json({ error: 'On call is for the PRN CNA Team only.' }, 422)
    const note = S(b.note, 300) || null
    if (action === 'oncall_offer') {
      const pattern = S(b.pattern, 30); if (!PATTERNS[pattern]) return json({ error: 'What did they offer?' }, 400)
      const { error } = await sb.from('prn_oncall').insert({ applicant_id: m.applicant_id, kind: 'offer', pattern, note, by_email: who.email, by_name: who.name })
      if (error) return json({ error: 'Could not record it: ' + error.message }, 500)
      await opEvent(sb, { verb: 'prn_oncall_offer', actor_name: who.name, actor_email: who.email, item_id: m.applicant_id, area: 'caregivers', summary: `${m.name} offered on call: ${PATTERNS[pattern]}` })
      return json({ outcome: 'recorded' })
    }
    const s = ymd(b.start_date), e = ymd(b.end_date) || s
    if (!s || e < s) return json({ error: 'Which dates?' }, 400)
    if ((Date.parse(e) - Date.parse(s)) / 86_400_000 > 6) return json({ error: 'One on-call stretch is at most 7 days.' }, 400)
    if (s < today()) return json({ error: 'That date has passed.' }, 400)
    const { error } = await sb.from('prn_oncall').insert({ applicant_id: m.applicant_id, kind: 'confirmed', start_date: s, end_date: e, note, by_email: who.email, by_name: who.name })
    if (error) return json(/duplicate|unique/i.test(error.message) ? { outcome: 'already' } : { error: 'Could not record it: ' + error.message }, /duplicate|unique/i.test(error.message) ? 200 : 500)
    await opEvent(sb, { verb: 'prn_oncall_confirmed', actor_name: who.name, actor_email: who.email, item_id: m.applicant_id, area: 'caregivers', summary: `${m.name} confirmed on call ${s} to ${e}` })
    return json({ outcome: 'recorded' })
  }

  if (action === 'oncall_cancel') {
    const id = Number(b.id); if (!Number.isInteger(id) || id <= 0) return json({ error: 'Which date?' }, 400)
    const { data: row } = await sb.from('prn_oncall').select('*').eq('id', id).maybeSingle()
    if (!row || row.kind !== 'confirmed') return json({ error: 'No such confirmed date.' }, 404)
    if (row.cancelled_at) return json({ outcome: 'already' })
    const { error } = await sb.from('prn_oncall').update({ cancelled_at: new Date().toISOString(), cancelled_by: who.name || who.email }).eq('id', id).is('cancelled_at', null)
    if (error) return json({ error: 'Could not take it back: ' + error.message }, 500)
    const m = memberOf(row.applicant_id)
    await opEvent(sb, { verb: 'prn_oncall_cancelled', actor_name: who.name, actor_email: who.email, item_id: row.applicant_id, area: 'caregivers', summary: `On call ${row.start_date} to ${row.end_date} taken back for ${m?.name || 'a PRN member'}` })
    return json({ outcome: 'cancelled' })
  }

  return json({ error: 'unknown action' }, 400)
})
