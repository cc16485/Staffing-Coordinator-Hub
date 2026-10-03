// Supabase Edge Function: late-alert  (shared hub project) · Running late L1, 2026-09-29
// -----------------------------------------------------------------------------
// What a PERSON does with a running-late notice: from the link in an admin's text (cc.mo-care.com/late.html) or from
// the "Running late" card in Needs Attention (signed-in office staff).
//
// WHO: a live link from an admin's text (one notice, one admin, an expiry, sealed with the server-only secret:
// _shared/late-links.ts; the admin must still be on the call-in alert list), OR a signed-in office staff member
// sending {id}. Anything else is refused before anything is read. POST only: opening the link (or a phone's link
// preview) changes nothing; the buttons do.
//
// ACTIONS (POST {c,a,e,t | id, action, ...}):
//   view      what they said (their words), the time they expect to arrive, who has seen it, what the family was told,
//             whether the family can be told (and the draft), numbers to call the caregiver and the client's home
//   seen      stops the admin reminders for everyone; the other admins get "Seen by ..." (when admin texts are live)
//   eta       {hhmm}: a person sets the arrival time (and it counts as seen)
//   family    {text}: HER DECISION 1, a person's tap: the Family Circle members who agreed to texts (the caregiver-
//             change rule) hear the arrival time, "Hi {their first name}, " + the text. Only when a time is set, it is
//             10+ minutes past the start (Settings), the Hub is sure which visit, and 6am to 9pm (the texting door).
//             A second tap after a new time sends the update wording.
//   skip      "Don't tell the family": recorded
//   arrived   after they clock in, and only if the family was told: "... has arrived", same members, a person's tap
//   coverage  they can't make it: opens a coverage case for the shift (the call-in process takes over) and closes this
// Never automatic, never the client (her decision 2). Samantha again, 2026-10-03: the family text stays ONE TAP BY A
// PERSON, permanently (she likes that it keeps the office in control). There is no automatic family send.
// 432: a notice that came from a CALL (in or out, the office line) shows "Mary said on your 4:31pm call: running late,
//   about 8 minutes (around 4:39pm)" and her words; its time reads "from your call". Same buttons, same rules.
// 433 (2026-10-03, her option 1) · bridge {target: 'client' | 'caregiver'}: "Call" rings the person's own phone first
//   (the admin named in the link, or the signed-in staff member). The contact (found exactly as view finds it, never
//   created) is assigned to them and tagged hub-call-bridge; her GoHighLevel workflow "Hub call bridge" rings them and
//   connects the call from the business number (_shared/ghl-call-bridge.ts). Only on that tap. Nothing is texted.
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { checkLink, adminKey } from '../_shared/late-links.ts'
import { adminRecipients, textAdmin } from '../_shared/clockin-admins.ts'
import { normalisePhone, contactForOutbound, maySend } from '../_shared/outreach.ts'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { eligibleMembers } from '../_shared/family-change-text.ts'
import { opEvent } from '../_shared/events.ts'
import { DEFAULT_FAMILY, DEFAULT_FAMILY_UPDATE, DEFAULT_ARRIVED, FAMILY_MIN_DEFAULT, fill, clockAt, familyEligible, callLine, holdUntil, holdOptsOf } from '../_shared/late-notice.ts'
import { visitMs } from '../_shared/held-shift.ts'
import { ghlSendChecked } from '../_shared/send-problems.ts'
import { officeQuiet } from '../_shared/quiet-hours.ts'
import { ghlClientLink } from '../_shared/ghl-contact-link.ts'
import { ghlCallBridge } from '../_shared/ghl-call-bridge.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
               'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const AC_VERSION = Deno.env.get('AXISCARE_API_VERSION') || '2023-10-01'
const firstOf = (n: unknown) => String(n ?? '').trim().split(/\s+/)[0] || ''
function axisCreds() {
  let token = ''
  for (const n of ['AXISCARE_VISITS_TOKEN', 'AXISCARE_API_KEY', 'AXISCARE_TOKEN']) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  return { token, site: /^\d+$/.test(site) ? site : '' }
}
const chiDay = (t: number) => new Date(t).toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'not allowed' }, 405)
  const b = await req.clone().json().catch(() => ({})) as Record<string, unknown>
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: setRow } = await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const st: any = setRow?.data ?? {}
  const admins = await adminRecipients(sb, st)

  /* who is asking */
  let me: { email: string; name: string; first: string } | null = null
  let noticeId = 0, viaLink = false
  if (b.c != null) {
    if (!(await checkLink(Deno.env.get('HUB_JOB_SECRET') || '', b))) return json({ error: 'This link is not valid or has expired.' }, 401)
    const a = (await Promise.all(admins.map(async (x) => ({ x, k: await adminKey(x.email) })))).find((y) => y.k === String(b.a))?.x
    if (!a) return json({ error: 'You are no longer on the admin list for these alerts.' }, 403)
    me = { email: a.email, name: a.name, first: a.first }; noticeId = Number(String(b.c).slice(3)); viaLink = true
  } else {
    const who = await requireStaff(sb, req, OFFICE_ROLES)
    if (!who.ok) return json({ error: who.error }, who.status)
    me = { email: String(who.email || ''), name: String(who.name || who.email || 'Staff'), first: firstOf(who.name || who.email) }
    noticeId = Number(b.id)
  }
  if (!Number.isInteger(noticeId) || noticeId <= 0) return json({ error: 'which running-late notice?' }, 400)
  const read = async () => (await sb.from('late_notices').select('*').eq('id', noticeId).maybeSingle()).data
  const n = await read()
  if (!n) return json({ error: 'This notice is no longer on file.' }, 404)
  const practice = n.status === 'practice'
  const adminLive = st.late_watch_live === true && st.late_admin_live === true
  const famMin = Number(st.late_family_min) >= 0 && Number(st.late_family_min) <= 120 ? Number(st.late_family_min) : FAMILY_MIN_DEFAULT
  const ghl = { token: Deno.env.get('GHL_TOKEN') || Deno.env.get('GHL_API_KEY') || '', locationId: Deno.env.get('GHL_LOCATION_ID') || '' }
  const action = String(b.action || 'view')
  const cgFirst = firstOf(n.caregiver_name) || 'the caregiver'
  const startMs = Date.parse(n.shift_start), t12 = clockAt(startMs)
  const what = `${cgFirst}, ${n.client_first}'s ${t12} shift`
  const nowIso = new Date().toISOString()
  // deno-lint-ignore no-explicit-any
  const update = async (up: any) => { up.updated_at = nowIso; await sb.from('late_notices').update(up).eq('id', n.id); Object.assign(n, up) }
  const family = (): { at: string; by: string; what: string; count: number; text: string }[] => Array.isArray(n.family) ? n.family : []
  // deno-lint-ignore no-explicit-any
  const circleMembers = async (): Promise<{ members: any[]; why: string }> => {
    const ax = String(n.axiscare_client_id ?? '').trim()
    if (!ax) return { members: [], why: 'no AxisCare client on file' }
    const { data: circs } = await sb.from('care_circles').select('id').eq('active', true).eq('axiscare_client_id', ax)
    if (!circs || circs.length !== 1) return { members: [], why: circs && circs.length > 1 ? 'two Family Circles are linked to this client' : 'no Family Circle is linked to this client' }
    const { data: mem } = await sb.from('circle_contacts').select('*').eq('circle_id', circs[0].id)
    const members = eligibleMembers(mem ?? [])
    return { members, why: members.length ? '' : 'nobody in the Family Circle has agreed to texts' }
  }
  const told = () => family().some((f) => f.what === 'late' || f.what === 'update')
  const draft = () => {
    const eta = n.eta ? clockAt(Date.parse(n.eta)) : ''
    const tmpl = told() ? String(st.late_msg_family_update || DEFAULT_FAMILY_UPDATE) : String(st.late_msg_family || DEFAULT_FAMILY)
    return fill(tmpl, { caregiver: cgFirst, client: n.client_first || 'your loved one', time: t12, eta })
  }
  const sendFamily = async (whatKind: 'late' | 'update' | 'arrived', text: string) => {
    const { members, why } = await circleMembers()
    if (!members.length) return { error: why, status: 409 }
    let count = 0, refused = 0
    for (const m of members) {
      const mf = firstOf(m.name) || 'there'
      const dest = await contactForOutbound(sb, ghl, { phone: m.phone, firstName: mf, lastName: String(m.name || '').split(' ').slice(1).join(' ') },
        'timely_external', { audience: 'family', humanInitiated: true, channel: 'sms', sender: 'late-alert' })
      if (!dest) { refused++; continue }
      /* NO SILENT FAILURES (2026-10-01): when one family member's text is refused but another's goes, the reply
         still says ok, so the refused one raises a card on Needs Attention (all refused still answers an error) */
      if (await ghlSendChecked(sb, { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
        'late-alert', { channel: 'sms', contactId: dest.contactId, address: m.phone, who: m.name }, { message: `Hi ${mf}, ${text}` })) count++
    }
    if (!count) return { error: refused ? 'The texts were held or refused (outside 6am to 9pm, or they opted out of texts).' : 'The texts could not be sent. Try again, or call the family.', status: 409 }
    const fam = [...family(), { at: nowIso, by: me!.name, what: whatKind, count, text }]
    await update({ family: fam, ...(n.seen_at ? {} : { seen_at: nowIso, seen_by: me!.first }) })
    await opEvent(sb, { actor_name: me!.name, actor_email: me!.email, verb: 'message_sent', item_id: 'ops_late_' + n.id, area: 'coverage',
      summary: `${me!.name} texted ${n.client_first}'s Family Circle (${count}) that ${cgFirst} ${whatKind === 'arrived' ? 'arrived' : 'is running late'}` })
    return { ok: true, count }
  }
  const tellOthers = async (msg: string) => {
    let told2 = 0
    if (!adminLive || !(Array.isArray(n.admin_rounds) && n.admin_rounds.length)) return 0
    /* office quiet hours (2026-10-03): no admin text 8pm to 7am; they see it on the card */
    if (officeQuiet(new Date(), st)) return 0
    for (const a of admins) if (a.email !== me!.email && await textAdmin(sb, ghl, a, msg)) told2++
    return told2
  }

  // deno-lint-ignore no-explicit-any
  const rosterRow = async (): Promise<any> => {
    // deno-lint-ignore no-explicit-any
    const roster: any[] = (await sb.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()).data?.data ?? []
    // deno-lint-ignore no-explicit-any
    return (Array.isArray(roster) ? roster : []).find((x: any) => String(x?.axiscare_id ?? '').trim() === String(n.axiscare_caregiver_id))
  }
  /* the client's home number and email (AxisCare, GET): for the call buttons */
  const clientContact = async (): Promise<{ phone: string | null; email: string | null }> => {
    const { token, site } = axisCreds()
    if (!(token && site && n.axiscare_client_id)) return { phone: null, email: null }
    try {
      const r = await fetch(`https://${site}.axiscare.com/api/clients?clientIds=${encodeURIComponent(String(n.axiscare_client_id))}`,
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-AxisCare-Api-Version': AC_VERSION } })
      const j = r.ok ? await r.json().catch(() => null) : null
      // deno-lint-ignore no-explicit-any
      const c = (j?.results?.clients ?? []).find((x: any) => String(x?.id) === String(n.axiscare_client_id))
      return { phone: normalisePhone(c?.homePhone) || normalisePhone(c?.mobilePhone) || normalisePhone(c?.otherPhone) || null, email: c?.email || null }
    } catch { return { phone: null, email: null } /* the number is a convenience */ }
  }

  /* 433: "Call" rings this person's phone first (a tap on the page or the card) */
  if (action === 'bridge') {
    const target = String(b.target || '')
    if (target !== 'client' && target !== 'caregiver') return json({ error: 'Call whom?' }, 400)
    const caller = { email: me.email, name: me.name, via: viaLink ? 'late-link' as const : 'hub' as const }
    if (target === 'client') {
      const cc = await clientContact()
      return json(await ghlCallBridge(sb, ghl, st, caller, { axiscareClientId: n.axiscare_client_id, phone: cc.phone, email: cc.email, label: n.client_first }))
    }
    const g = await rosterRow()
    return json(await ghlCallBridge(sb, ghl, st, caller, { phone: normalisePhone(g?.phone), email: g?.email, label: cgFirst }))
  }

  if (action === 'view') {
    const g = await rosterRow()
    const cc = await clientContact()
    const clientPhone = cc.phone, clientEmail = cc.email
    /* 431: the EXISTING GHL contacts (read only, never created) so the office calls from LeadConnector (office line) */
    const [clientGhl, caregiverGhl] = await Promise.all([
      ghlClientLink(sb, ghl, { axiscareClientId: n.axiscare_client_id, phone: clientPhone, email: clientEmail }),
      ghlClientLink(null, ghl, { phone: normalisePhone(g?.phone), email: g?.email })])
    const fe = familyEligible(n, famMin)
    const { members, why } = n.kind === 'late' ? await circleMembers() : { members: [], why: '' }
    const arrivedSent = family().some((f) => f.what === 'arrived')
    /* 432: the call, in the words every page uses; "your" when the person reading was on it */
    const whose = n.call_by_email && String(n.call_by_email).toLowerCase() === String(me.email).toLowerCase() ? 'your call'
      : n.call_by ? `${firstOf(n.call_by)}'s call` : 'the call'
    const until = n.call_at ? holdUntil(n, startMs, holdOptsOf(st)) : null
    const call = n.call_at ? { line: callLine(n, me.email), quote: n.call_quote || null, at: clockAt(Date.parse(n.call_at)), by: n.call_by ? firstOf(n.call_by) : null,
      direction: n.call_direction || null,
      missed_clockin_paused_until: !n.closed_at && until != null && Date.now() < until ? clockAt(until) : null } : null
    const etaBy = n.eta_by === 'ai' ? (n.call_at && (Array.isArray(n.said) ? n.said : []).at(-1)?.channel === 'call' ? 'from ' + whose : 'from their message') : n.eta_by || null
    const hoursOk = maySend('timely_external').allowed
    return json({ ok: true, me: me.first, via_link: viaLink, practice, admin_texts_live: adminLive, call, source: n.call_at ? 'call' : 'text',
      kind: n.kind, status: n.status, caregiver_first: cgFirst, client_first: n.client_first, shift_date: n.shift_date, shift_time: t12,
      said: (Array.isArray(n.said) ? n.said : []).slice(-6).map((x: { at: string; channel: string; text: string }) => ({ at: clockAt(Date.parse(x.at)), channel: x.channel, text: String(x.text).slice(0, 1000) })),
      eta: n.eta ? clockAt(Date.parse(n.eta)) : null, eta_hhmm: n.eta ? new Date(n.eta).toLocaleString('en-GB', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hour12: false }) : '',
      eta_by: etaBy, sure: n.sure,
      seen: n.seen_at ? { by: n.seen_by, at: clockAt(Date.parse(n.seen_at)) } : null,
      closed: n.closed_at ? { how: n.closed_how, clock_in: n.clock_in_at ? clockAt(Date.parse(n.clock_in_at)) : null } : null,
      caregiver_phone: normalisePhone(g?.phone) || null, client_phone: clientPhone,
      client_ghl: clientGhl, caregiver_ghl: caregiverGhl,
      family: { can: !practice && fe.ok && members.length > 0 && !n.closed_at, why: practice ? 'practice run: family texts are not sent yet' : (!fe.ok ? fe.why : why),
        members: members.length, first_names: members.map((m) => firstOf(m.name) || 'there').slice(0, 6), draft: draft(), is_update: told(),
        hours_ok: hoursOk, hours: '6am to 9pm',
        sent: family().map((f) => ({ at: clockAt(Date.parse(f.at)), by: f.by, what: f.what, count: f.count })),
        skipped: n.family_skipped_at ? { by: n.family_skipped_by, at: clockAt(Date.parse(n.family_skipped_at)) } : null,
        arrived_can: !practice && n.closed_how === 'clocked_in' && told() && !arrivedSent,
        arrived_draft: fill(String(st.late_msg_arrived || DEFAULT_ARRIVED), { caregiver: cgFirst, client: n.client_first || 'your loved one' }) },
      coverage_case: n.coverage_case_id || null })
  }

  if (action === 'seen') {
    if (n.seen_at) return json({ ok: true, already: { by: n.seen_by } })
    await update({ seen_at: nowIso, seen_by: me.first, status: n.status === 'open' ? 'seen' : n.status })
    const others = await tellOthers(`Seen by ${me.first}: ${what} (running late). No more reminders.`)
    await opEvent(sb, { actor_name: me!.name, actor_email: me!.email, verb: 'item_seen', item_id: 'ops_late_' + n.id, area: 'coverage', summary: `${me.name} saw the running-late notice (${n.caregiver_name}, ${n.client_first} ${t12})` })
    return json({ ok: true, others_told: others })
  }

  if (action === 'eta') {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(b.hhmm ?? '').trim())
    if (!m || +m[1] > 23 || +m[2] > 59) return json({ error: 'Enter the time like 9:20.' }, 400)
    const t = visitMs(`${chiDay(startMs)}T${m[1].padStart(2, '0')}:${m[2]}:00`)
    if (!Number.isFinite(t) || t < startMs - 3 * 3600e3 || t > startMs + 8 * 3600e3) return json({ error: 'That time is too far from the shift.' }, 400)
    const first = !n.seen_at
    await update({ eta: new Date(t).toISOString(), eta_by: me.first, sure: true, ...(first ? { seen_at: nowIso, seen_by: me.first, status: n.status === 'open' ? 'seen' : n.status } : {}) })
    if (first) await tellOthers(`Seen by ${me.first}: ${what}, now expected about ${clockAt(t)}. No more reminders.`)
    return json({ ok: true, eta: clockAt(t) })
  }

  if (action === 'skip') {
    await update({ family_skipped_at: nowIso, family_skipped_by: me.first })
    return json({ ok: true })
  }

  if (action === 'family') {
    if (practice) return json({ error: 'Practice run: family texts are not sent yet.' }, 409)
    if (n.closed_at) return json({ error: `${cgFirst} has clocked in or the notice is closed.` }, 409)
    const fe = familyEligible(n, famMin)
    if (!fe.ok) return json({ error: 'The family can\'t be told: ' + fe.why + '.' }, 409)
    const text = String(b.text ?? '').trim().slice(0, 600)
    if (!text) return json({ error: 'The text is empty.' }, 400)
    const r = await sendFamily(told() ? 'update' : 'late', text)
    return 'error' in r ? json({ error: r.error }, r.status) : json(r)
  }

  if (action === 'arrived') {
    if (practice) return json({ error: 'Practice run: family texts are not sent yet.' }, 409)
    if (n.closed_how !== 'clocked_in' || !told()) return json({ error: 'Only after they clock in, and only when the family was told they were running late.' }, 409)
    if (family().some((f) => f.what === 'arrived')) return json({ ok: true, already: true })
    const text = String(b.text ?? '').trim().slice(0, 600) || fill(String(st.late_msg_arrived || DEFAULT_ARRIVED), { caregiver: cgFirst, client: n.client_first || 'your loved one' })
    const r = await sendFamily('arrived', text)
    if ('error' in r) return json({ error: r.error }, r.status)
    await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { id: 'ops_late_' + n.id, kind: 'late_notice', domain: 'scheduling_coverage', status: 'resolved',
      late_notice_id: n.id, caregiver: n.caregiver_name || '', about: n.caregiver_name || '', urgency: 'today',
      title: `Closed: ${cgFirst} arrived at ${n.client_first}'s (the family was told)`, detail: `${me.name} told the family ${cgFirst} arrived.`,
      created_at: n.created_at, resolved_at: nowIso, created_by: 'late-watch', opened_by: 'late-watch' } })
    return json(r)
  }

  if (action === 'coverage') {
    if (practice) return json({ error: 'Practice run: open a coverage case from Scheduling if the shift really needs one.' }, 409)
    if (n.closed_at) return json({ error: 'This notice is closed.' }, 409)
    const { data: ccRow } = await sb.from('app_data').select('data').eq('key', 'coverage_cases').maybeSingle()
    // deno-lint-ignore no-explicit-any
    const existing = (Array.isArray(ccRow?.data) ? ccRow!.data : []).find((c: any) => c?.status === 'open' && String(c?.axiscare_visit_id ?? '') === String(n.visit_id))
    let caseId = existing ? String(existing.id) : ''
    if (!caseId) {
      let end = '', clientName = n.client_first
      const { token, site } = axisCreds()
      if (token && site) {
        try {
          const r = await fetch(`https://${site}.axiscare.com/api/visits/${encodeURIComponent(String(n.visit_id))}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-AxisCare-Api-Version': AC_VERSION } })
          const vj = r.ok ? await r.json().catch(() => null) : null
          const v = vj?.results?.visit ?? vj?.results ?? null
          end = String(v?.scheduledEndDate ?? v?.endDate ?? '').slice(11, 16)
          clientName = [v?.client?.firstName, v?.client?.lastName].map((x: unknown) => String(x ?? '').trim()).filter(Boolean).join(' ') || clientName
        } catch { /* the case still opens */ }
      }
      const hm = new Date(startMs).toLocaleString('en-GB', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hour12: false })
      caseId = 'cov_ln_' + n.id
      await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: {
        id: caseId, client: clientName, client_axiscare_id: n.axiscare_client_id ?? null, axiscare_visit_id: String(n.visit_id),
        shift_date: n.shift_date, shift_time: [hm, end].filter(Boolean).join('-'),
        calling_off: n.caregiver_name, calling_off_id: String(n.axiscare_caregiver_id ?? ''), reason: 'call_off',
        note: `Opened from the running-late alert by ${me.name}.`, status: 'open', asked: [], opened_at: nowIso, opened_by: me.name,
        resolved_at: null, resolved_how: null, covered_by: null } })
      await opEvent(sb, { actor_name: me!.name, actor_email: me!.email, verb: 'coverage_opened', item_id: caseId, area: 'coverage',
        summary: `${me.name} opened a call-off case from the running-late alert: ${clientName} ${n.shift_date} ${t12}, ${n.caregiver_name} can't make it` })
    }
    await update({ coverage_case_id: caseId, ...(n.seen_at ? {} : { seen_at: nowIso, seen_by: me.first }), status: 'closed', closed_at: nowIso, closed_how: 'coverage_case' })
    const others = await tellOthers(`${me.first} opened a coverage case for ${n.client_first}'s ${t12} shift (${n.caregiver_name} can't make it). No more running-late texts.`)
    return json({ ok: true, coverage_case: caseId, others_told: others })
  }

  return json({ error: 'unknown action' }, 400)
})
