// Supabase Edge Function: clockin-alert  (shared hub project) · C1, 2026-09-29
// -----------------------------------------------------------------------------
// The page behind the link in a missed clock-in text (cc.mo-care.com/clockin.html). Samantha: "keep texting the office
// until we click a link and say if it is resolved". Every admin is texted every few minutes by timekeeper-watch; this is
// where one of them says what happened.
//
// WHO: only a live link from an admin's text. The link names one missed clock-in, one admin (a one-way code of their
// email) and an expiry, sealed with the server-only secret (_shared/clockin-links.ts). The admin must still be on
// the call-in alert list. Anything else is refused before anything is read. POST only: opening the link (or a phone's
// link preview) changes nothing; the page's buttons do.
//
// ACTIONS (POST {c, a, e, t, action, ...}):
//   view      what's happening: first names, the shift time, minutes past start, who resolved it, a number to call
//             the caregiver and the client's home (a person makes the call; nothing is sent to the client)
//   resolve   {reason, note}: stops the reminders for everyone, closes the Needs Attention item, records who/why;
//             the other admins get one "Resolved by ..." text (when the admin texts are live)
//   snooze    pauses the reminders for THIS admin for 10 minutes
//   evv       texts the caregiver the EVV correction form, once per alert, only on this tap
//             (427: the link opens the form pre-filled for this visit; only a random token is in the link)
//   coverage  she's calling off: opens a coverage case for the shift (the call-in process takes over) and resolves
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { checkLink, adminKey } from '../_shared/clockin-links.ts'
import { adminRecipients, textAdmin, clock12 } from '../_shared/clockin-admins.ts'
import { normalisePhone, contactForOutbound } from '../_shared/outreach.ts'
import { opEvent } from '../_shared/events.ts'
import { officeQuiet, afterHoursAllowed } from '../_shared/quiet-hours.ts'
import { makePrefill, withPrefillLink, axisHm } from '../_shared/evv-prefill.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
               'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const REASONS: Record<string, string> = {
  on_the_way: 'on her way', forgot_clock_in: 'she was there and forgot to clock in', calling_off: 'calling off',
  not_happening: "the visit wasn't happening", other: 'other',
}
const SNOOZE_MIN = 10
const AC_VERSION = Deno.env.get('AXISCARE_API_VERSION') || '2023-10-01'
function axisCreds() {
  let token = ''
  for (const n of ['AXISCARE_VISITS_TOKEN', 'AXISCARE_API_KEY', 'AXISCARE_TOKEN']) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  return { token, site: /^\d+$/.test(site) ? site : '' }
}
const chiWall = () => new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).replace(' ', 'T')
const minutesPast = (date: string, hm: string) => Math.round((Date.parse(chiWall()) - Date.parse(`${date}T${String(hm).slice(0, 5)}:00`)) / 60000)
const chi12 = (iso: string | null | undefined) => iso
  ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }).replace(' ', '').toLowerCase() : null

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'not allowed' }, 405)
  const b = await req.json().catch(() => ({})) as Record<string, unknown>
  const SECRET = Deno.env.get('HUB_JOB_SECRET') || ''
  if (!(await checkLink(SECRET, b))) return json({ error: 'This link is not valid or has expired.' }, 401)
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: setRow } = await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const settings: any = setRow?.data ?? {}
  const admins = await adminRecipients(sb, settings)
  const me = (await Promise.all(admins.map(async (x) => ({ x, k: await adminKey(x.email) })))).find((y) => y.k === String(b.a))?.x
  if (!me) return json({ error: 'You are no longer on the admin list for these alerts.' }, 403)

  const alertId = String(b.c)
  const readLadder = async () => {
    const { data } = await sb.from('app_data').select('data').eq('key', 'timekeeper_cases').maybeSingle()
    // deno-lint-ignore no-explicit-any
    return (Array.isArray(data?.data) ? data!.data : []).find((l: any) => l?.id === alertId && l?.kind !== 'clock_out') ?? null
  }
  // deno-lint-ignore no-explicit-any
  const save = (l: any) => sb.rpc('upsert_app_data_item', { target_key: 'timekeeper_cases', item: l })
  const l = await readLadder()
  if (!l) return json({ error: 'This alert is no longer on file.' }, 404)
  const loopLive = settings.timekeeper_admin_loop_live === true
  const ghl = { token: Deno.env.get('GHL_TOKEN') || Deno.env.get('GHL_API_KEY') || '', locationId: Deno.env.get('GHL_LOCATION_ID') || '' }
  const myKey = String(b.a)
  const action = String(b.action || 'view')
  const cgFirst = String(l.caregiver || '').split(' ')[0] || 'the caregiver'
  const what = `${cgFirst}, ${l.client_first}'s ${clock12(l.shift_time)} shift`

  // deno-lint-ignore no-explicit-any
  const roster = async (): Promise<any> => {
    const { data } = await sb.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()
    // deno-lint-ignore no-explicit-any
    return (Array.isArray(data?.data) ? data!.data : []).find((c: any) => String(c?.axiscare_id ?? '').trim() === String(l.caregiver_axiscare_id)) ?? null
  }
  // deno-lint-ignore no-explicit-any
  const axisGet = async (path: string): Promise<any> => {
    const { token, site } = axisCreds()
    if (!token || !site) return null
    try {
      const r = await fetch(`https://${site}.axiscare.com/api/${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-AxisCare-Api-Version': AC_VERSION } })
      return r.ok ? await r.json().catch(() => null) : null
    } catch { return null }
  }
  const closeItem = async (why: string) => {
    await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: {
      id: `ops_tk_${l.id}`, kind: 'staffing_issue', status: 'resolved',
      title: `Resolved: ${l.caregiver}, ${l.client_first} ${clock12(l.shift_time)} (missed clock-in)`, about: l.caregiver,
      domain: 'scheduling_coverage', urgency: 'high', owner: me.email, owner_name: me.first,
      detail: why, created_at: l.office_alerted_at || new Date().toISOString(), resolved_at: new Date().toISOString(),
      created_by: 'timekeeper-watch', opened_by: 'timekeeper' } })
  }
  const status = () => ({
    open: !l.resolved_at,
    resolved: l.resolved_at ? { at: chi12(l.resolved_at), how: l.resolved_how, by: l.resolved_by_name || null,
                                reason: l.resolved_reason ? REASONS[l.resolved_reason] ?? null : null, note: l.resolved_note || null } : null,
    snoozed_until: l.admin_loop?.snooze?.[myKey] && Date.parse(l.admin_loop.snooze[myKey]) > Date.now() ? chi12(l.admin_loop.snooze[myKey]) : null,
    evv_sent_at: chi12(l.evv_sent_at), evv_prefilled: l.evv_prefilled === true, coverage_case: l.coverage_case_id || null,
  })

  if (action === 'view') {
    const cg = await roster()
    // deno-lint-ignore no-explicit-any
    let clientPhone: string | null = null
    if (l.client_axiscare_id) {
      const j = await axisGet(`clients?clientIds=${encodeURIComponent(String(l.client_axiscare_id))}`)
      // deno-lint-ignore no-explicit-any
      const c = (j?.results?.clients ?? []).find((x: any) => String(x?.id) === String(l.client_axiscare_id))
      clientPhone = normalisePhone(c?.homePhone) || normalisePhone(c?.mobilePhone) || normalisePhone(c?.otherPhone) || null
    }
    return json({ ok: true, me: me.first, caregiver_first: cgFirst, client_first: l.client_first, shift_date: l.shift_date,
      shift_time: clock12(l.shift_time), minutes_past_start: minutesPast(String(l.shift_date), String(l.shift_time)),
      texted_at: chi12(l.texted_at), caregiver_phone: normalisePhone(cg?.phone) || null, client_phone: clientPhone,
      practice: !loopLive, reasons: REASONS,
      /* C3: what she texted back (her own words to the office) */
      replies: (Array.isArray(l.replies) ? l.replies : []).slice(-5).map((x: { at: string; text: string }) => ({ at: chi12(x.at), text: String(x.text).slice(0, 500) })),
      ...status() })
  }

  if (l.resolved_at && action !== 'evv')
    return json({ ok: true, already: true, ...status() })

  if (action === 'snooze') {
    l.admin_loop = l.admin_loop || { started_at: new Date().toISOString(), sends: [], snooze: {} }
    l.admin_loop.snooze = { ...(l.admin_loop.snooze || {}), [myKey]: new Date(Date.now() + SNOOZE_MIN * 60000).toISOString() }
    await save(l)
    return json({ ok: true, ...status() })
  }

  if (action === 'resolve' || action === 'coverage') {
    const reason = action === 'coverage' ? 'calling_off' : String(b.reason || '')
    if (!REASONS[reason]) return json({ error: 'Pick what happened.' }, 400)
    const note = typeof b.note === 'string' ? b.note.trim().slice(0, 300) : ''
    const fresh = await readLadder()   // first one wins
    if (!fresh || fresh.resolved_at) return json({ ok: true, already: true, ...status() })
    let caseId: string | null = null
    if (action === 'coverage') {
      const { data: ccRow } = await sb.from('app_data').select('data').eq('key', 'coverage_cases').maybeSingle()
      // deno-lint-ignore no-explicit-any
      const existing = (Array.isArray(ccRow?.data) ? ccRow!.data : []).find((c: any) => c?.status === 'open' && String(c?.axiscare_visit_id ?? '') === String(l.visit_id))
      if (existing) caseId = String(existing.id)
      else {
        const vj = await axisGet(`visits/${encodeURIComponent(String(l.visit_id))}`)
        const v = vj?.results?.visit ?? vj?.results ?? vj?.visit ?? null
        const end = String(v?.scheduledEndDate ?? v?.endDate ?? '').slice(11, 16)
        const clientName = [v?.client?.firstName, v?.client?.lastName].map((x: unknown) => String(x ?? '').trim()).filter(Boolean).join(' ') || l.client_first
        caseId = 'cov_tk_' + String(l.visit_id).replace(/[^A-Za-z0-9]/g, '_')
        await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: {
          id: caseId, client: clientName, client_axiscare_id: l.client_axiscare_id ?? null, axiscare_visit_id: String(l.visit_id),
          shift_date: l.shift_date, shift_time: [String(l.shift_time).slice(0, 5), end].filter(Boolean).join('-'),
          calling_off: l.caregiver, calling_off_id: String(l.caregiver_axiscare_id ?? ''), reason: 'call_off',
          note: `Opened from the missed clock-in alert by ${me.name}${note ? ': ' + note : ''}.`,
          status: 'open', asked: [], opened_at: new Date().toISOString(), opened_by: me.name,
          resolved_at: null, resolved_how: null, covered_by: null } })
        await opEvent(sb, { verb: 'coverage_opened', item_id: caseId, area: 'coverage',
          summary: `${me.name} opened a call-off case from the missed clock-in alert: ${clientName} ${l.shift_date} ${clock12(l.shift_time)}, ${l.caregiver} calling off` })
      }
    }
    Object.assign(fresh, { resolved_at: new Date().toISOString(), resolved_how: action === 'coverage' ? 'coverage_case' : 'admin',
      resolved_by: me.email, resolved_by_name: me.first, resolved_reason: reason, resolved_note: note || null,
      ...(caseId ? { coverage_case_id: caseId } : {}) })
    await save(fresh); Object.assign(l, fresh)
    await closeItem(`${me.name} marked it resolved from the text link: ${REASONS[reason]}${note ? '. Note: ' + note : ''}${caseId ? '. A coverage case is open for the shift.' : ''}`)
    await opEvent(sb, { verb: 'item_resolved', item_id: `ops_tk_${l.id}`, area: 'coverage',
      summary: `${me.name} resolved the missed clock-in (${l.caregiver}, ${l.client_first} ${clock12(l.shift_time)}): ${REASONS[reason]}` })
    let told = 0
    /* office quiet hours (2026-10-03): resolving it at night tells nobody by text (8pm to 7am); they see it resolved
       in Needs Attention. Only admins who were texted about it hear it was resolved.
       AFTER HOURS (Desktop 426): missed clock-ins text at night unless she switched missed_clockin_after_hours off,
       so the "Resolved by" closer goes at night too (still only to admins who were texted about this alert). */
    const afterHours = afterHoursAllowed(settings, 'missed_clockin')
    const quiet = officeQuiet(new Date(), settings) && !afterHours
    const textedKeys = fresh.admin_loop?.texts_to
    if (loopLive && !quiet && (fresh.admin_loop?.sends || []).some((x: { admins?: number }) => Number(x?.admins) > 0)) {
      const msg = `Resolved by ${me.first} (${what}): ${REASONS[reason]}${note ? '. ' + note : ''}${caseId ? '. Coverage case opened.' : ''}. No more reminders.`
      for (const a of admins) {
        if (a.email === me.email) continue
        if (textedKeys && !(Number(textedKeys[await adminKey(a.email)]) > 0)) continue
        if (await textAdmin(sb, ghl, a, msg, fetch, { emergency: afterHours })) told++
      }
    }
    return json({ ok: true, others_told: told, ...(quiet ? { others_not_texted: 'office quiet hours' } : {}), ...status() })
  }

  if (action === 'evv') {
    const fresh = await readLadder()
    if (fresh?.evv_sent_at) return json({ ok: true, already_sent: true, ...status() })
    const cg = await roster()
    const phone = normalisePhone(cg?.phone)
    if (!phone) return json({ error: `There's no phone for ${cgFirst} on the caregiver roster.` }, 409)
    const contact = await contactForOutbound(sb, ghl, { phone, firstName: String(cg?.first ?? '') || cgFirst }, 'urgent_internal',
      { audience: 'caregiver', channel: 'sms', sender: 'clockin-alert (EVV form, sent by ' + me.first + ')' })
    if (!contact) return json({ error: `The text to ${cgFirst} was refused (an untrusted number, or they opted out of texts).` }, 409)
    /* 427: the link opens the form already filled in for this visit (caregiver, client first name + last initial,
       date, scheduled times; only a random token in the link). Read from AxisCare (GET); same wording; if the pre-fill
       can't be made, the plain form link goes as before. */
    const vj = await axisGet(`visits/${encodeURIComponent(String(l.visit_id))}`)
    const v = vj?.results?.visit ?? vj?.results ?? vj?.visit ?? null
    const endStamp = String(v?.scheduledEndDate ?? v?.endDate ?? '')
    const ended = !!endStamp && Date.parse(endStamp.slice(0, 19)) <= Date.parse(chiWall())
    const pre = await makePrefill(sb, { visit_id: String(l.visit_id), caregiver_axiscare_id: String(l.caregiver_axiscare_id ?? ''),
      client_axiscare_id: l.client_axiscare_id ?? (v?.client?.id != null ? String(v.client.id) : null),
      caregiver_name: String(l.caregiver || ''), client_first: String(l.client_first || ''), client_last: String(v?.client?.lastName ?? ''),
      visit_date: String(l.shift_date), scheduled_in: String(l.shift_time || ''), scheduled_out: endStamp.slice(11, 16) || null,
      actual_in: axisHm(v?.clockIn), actual_out: axisHm(v?.clockOut),
      which_missing: !v?.clockIn?.time && !v?.clockOut?.time && ended ? 'both' : 'in' }, 'clockin-alert (EVV form, sent by ' + me.first + ')')
    const message = withPrefillLink(`Hi ${String(cg?.first ?? '') || cgFirst}, to change your clock-in time we need the EVV correction form, filled out and signed by ${l.client_first}: sc.mo-care.com/evv-correction-form. We can't make any manual changes without it.`, pre?.url ?? null)
    let ok = false
    try {
      const r = await fetch('https://services.leadconnectorhq.com/conversations/messages', { method: 'POST',
        headers: { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'SMS', contactId: contact.contactId, message }) })
      ok = r.ok
    } catch { ok = false }
    if (!ok) return json({ error: 'The text could not be sent. Try again, or send the form link by hand.' }, 502)
    const f2 = (await readLadder()) || l
    f2.evv_sent_at = new Date().toISOString(); f2.evv_sent_by = me.email; f2.evv_prefilled = !!pre
    await save(f2); Object.assign(l, f2)
    await opEvent(sb, { verb: 'message_sent', item_id: `ops_tk_${l.id}`, area: 'coverage',
      summary: `${me.name} texted ${l.caregiver} the EVV correction form (${l.client_first} ${clock12(l.shift_time)})` })
    return json({ ok: true, ...status() })
  }

  return json({ error: 'unknown action' }, 400)
})
