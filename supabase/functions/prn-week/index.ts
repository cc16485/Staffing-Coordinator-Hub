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
//   oncall_confirm {applicant_id, start_date, end_date, shift?, note?}: a date the office confirmed with them (up to 7 days),
//                 and which shift: day (7am to 5pm), overnight (5pm to 7am) or whole (24 hours); needed once
//                 ops_settings.prn_oncall_shift_live is on (2026-10-29), so payroll knows what to pay. Shows on
//                 their PRN Team page later (step 5).
//   oncall_cancel {id}: takes a confirmed date back (kept, marked cancelled).
//   goback_mark   {applicant_id, ref, answer: yes | no}: the office read an answer to "Would you be glad to go back?" (step 3).
//   client_mark   {ref, kind: intro_planned | not_this_one}: a "no PRN backup who knows them" line, planned or set aside for
//                 the month. Planning only records it: a person gets the family's OK and schedules it in AxisCare.
//   welcome_call  {applicant_id, towns_times, short_notice: yes|no|not_asked, more_hours: yes|no|maybe, enjoys?, oncall?,
//                 office_interest?, note?} (step 4): what a new member said on their welcome call. Kept on their PRN answers
//                 (job_applicants.prn.welcome, every call in welcome_history), short notice as the PRN card's own record, on
//                 call as an offer (PRN CNA Team only), and the line is done (prn_touches welcome_call).
//   page_link     {applicant_id} (step 5a): their PRN Team page link (30 days), for a person to send by hand.
//   mark kind 'handled' (step 5a): a course assigned or an idea read, from their page.
//   monthly       {month?} (step 6): last month's PRN Team update: the facts the Hub drafted, what the office wrote, whether it
//                 went out and to how many. Reads only.
//   monthly_save  {month, paragraph, kind_word?, tip?}: the office's own words for it (kept until sent; then it stays as sent).
//   mentor_set    {applicant_id, on, skills[], evidence} (step 8a): name a PRN CNA a Gap Mentor for the skills the office verified
//                 (kept on their PRN answers with every change in gap_mentor_history), or take it off.
//   mentor_ask    {kind, client_ax, client_name, visit_date, visit_time, skill?, caregiver_ax?, caregiver_name?, family_ok, note?,
//                 guide?, va?}: "Ask a Gap Mentor" from a client's Care tab. Switch ops_settings.prn_mentor_live (and the page open).
//   mentor_list   {client_ax?}: the asks (for one client, or every open one), with each mentor's answer.
//   mentor_assign {id, applicant_id}: the coordinator put it in AxisCare for this mentor (recorded here; nothing is sent).
//   mentor_cancel {id}: an ask that is no longer needed (kept, marked cancelled).
//   monthly_send  {month}: one tap texts every PRN member a short line with their own page link (the full update is on their
//                 page). Switch ops_settings.prn_monthly_live, and the page must be open. Never 9pm to 8am. Through the same
//                 gates as every caregiver text; each member at most once a month; a refused or failed text is listed back and
//                 raises a "Didn't go through" card (no silent failures).
// STEP 3 (2026-10-28): week also returns each linked member's familiar clients (AxisCare visits in the last 6 months, minus
// Do Not Return, a concern either way, or a NO to the go-back question) and adds the go-back and no-backup lines.
// The list itself shows to everyone in the office once ops_settings.prn_week_live is on; before that the Hub shows it to
// owners only, as a practice view. No pay anywhere: the on-call stipend amount is not set (her call).
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { contactForOutbound, maySendTo, normalisePhone } from '../_shared/outreach.ts'
import { opEvent } from '../_shared/events.ts'
import { MO_FROM } from '../_shared/office-from.ts'   // every text goes out from (417) 234-8494
import { computeWeek, onCallWeekends, onCallMonth, THANKS_DEFAULT, PATTERNS, SHIFTS, SHIFT_SHORT, type Member } from '../_shared/prn-week.ts'
import { pageLines, lookingState } from '../_shared/prn-page.ts'
import { makePageLink, pageExpiry } from '../_shared/prn-page-links.ts'
import { welcomeLines, readCall, callSummary, WELCOME_DEFAULT } from '../_shared/prn-welcome.ts'
import { visitsOf } from '../_shared/axis-visits.ts'
import { familiarClients, noBackup, weekLines, GOBACK_DEFAULT, FAMILIAR_DAYS, type Familiar } from '../_shared/prn-familiar.ts'
import { monthFacts, readDraft, lastMonth, isMonth, monthWord, monthlyText, monthlyRef, monthlyLive, sendHour, MONTHLY_TEXT_DEFAULT, STEADY_LINE } from '../_shared/prn-monthly.ts'
import { keptMessage } from '../_shared/prn-page-texts.ts'
import { ghlSendChecked } from '../_shared/send-problems.ts'
import { readMentor, readAsk, mentorLive, SKILLS, KINDS } from '../_shared/prn-mentor.ts'

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
  const { data: tr } = await sb.from('pay_tracks').select('applicant_id, track, team, since, axiscare_caregiver_id, linked_at').eq('track', 'prn_team')
  if (!tr?.length) return []
  const { data: apps } = await sb.from('job_applicants').select('id, first_name, last_name').in('id', tr.map((t: Any) => t.applicant_id))
  return tr.map((t: Any) => { const a = (apps ?? []).find((x: Any) => x.id === t.applicant_id) || {}
    const name = [a.first_name, a.last_name].map((x: unknown) => S(x)).filter(Boolean).join(' ') || 'A PRN member'
    return { applicant_id: t.applicant_id, name, first: firstOf(a.first_name) || firstOf(name), team: t.team === 'caregiver' ? 'caregiver' : 'cna', since: S(t.since, 10),
      axiscare_id: t.axiscare_caregiver_id ? String(t.axiscare_caregiver_id) : null, linked_at: t.linked_at || null } })
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
    /* STEP 3 · familiar clients for each member linked to AxisCare */
    const [dnr, checkins, clientMarks] = [list(await readKey(sb, 'dnr_log')), list(await readKey(sb, 'client_checkins')), list(await readKey(sb, 'prn_client_marks'))]
    const from = new Date(Date.parse(t + 'T12:00:00Z') - FAMILIAR_DAYS * 86_400_000).toISOString().slice(0, 10)
    const familiar: Record<string, { clients: Familiar[]; why: string | null }> = {}
    await Promise.all(mem.map(async (m) => {
      if (!m.axiscare_id) { familiar[m.applicant_id] = { clients: [], why: 'not linked to AxisCare yet' }; return }
      const v = await visitsOf(m.axiscare_id, from, t)
      familiar[m.applicant_id] = { why: v.why, clients: familiarClients({ name: m.name, visits: v.rows, dnr, checkins,
        answers: (tc.data ?? []).filter((x: Any) => x.applicant_id === m.applicant_id), today: t }) }
    }))
    const allCases = list(await readKey(sb, 'coverage_cases'))
    const anyWhy = Object.values(familiar).find((f) => f.why && f.why !== 'not linked to AxisCare yet')?.why || null
    /* a client with no PRN backup is only claimed when every linked member's visits were read */
    const nb = anyWhy || !mem.some((m) => m.axiscare_id) ? [] : noBackup(allCases, Object.values(familiar).map((f) => f.clients), t)
    const extra = weekLines({ members: mem.map((m) => ({ ...m, team: m.team === 'caregiver' ? 'PRN Caregiver Team' : 'PRN CNA Team' })), touches: tc.data ?? [], nobackup: nb, clientMarks, today: t })
    extra.push(...welcomeLines({ members: mem, touches: tc.data ?? [], today: t }))   // step 4
    /* step 5a: what members did on their PRN Team page (missing table = the page isn't set up yet: no lines, nothing breaks) */
    const pl = ids.length ? await sb.from('prn_page_log').select('id, applicant_id, kind, note, at').in('applicant_id', ids).order('at') : { data: [], error: null }
    const plog: Any[] = pl.error ? [] : (pl.data ?? [])
    extra.push(...pageLines({ members: mem, log: plog, touches: tc.data ?? [], today: t }))
    const { data: apPrn } = ids.length ? await sb.from('job_applicants').select('id, prn').in('id', ids) : { data: [] }
    const page: Record<string, Any> = {}
    for (const m of mem) {
      const mine = plog.filter((r) => r.applicant_id === m.applicant_id), seen = mine.filter((r) => r.kind === 'viewed').pop()
      const bu = S((apPrn ?? []).find((x: Any) => x.id === m.applicant_id)?.prn?.break_until, 10)
      const gm = (apPrn ?? []).find((x: Any) => x.id === m.applicant_id)?.prn?.gap_mentor
      page[m.applicant_id] = { last_looked: seen?.at ?? null, looking: lookingState(mine, t), break_until: /^\d{4}-\d\d-\d\d$/.test(bu) && bu >= t ? bu : null,
        gap_mentor: gm?.on === true ? { skills: gm.skills || [], evidence: gm.evidence || '', by: gm.by || null, at: gm.at || null } : null }
    }
    const wk = computeWeek({ members: mem, shifts: sh.data ?? [], touches: tc.data ?? [], kindTo, wantsMore, cases, today: t, sender: who.name, thanksTmpl: st.prn_thanks_msg, extra })
    const oncall = onCallWeekends(oc.data ?? [], mem, t)
    return json({ ok: true, today: t, live: st.prn_week_live === true, thanks_live: st.prn_thanks_live === true, owner: S(st.prn_week_owner, 80) || 'Krystal',
      thanks_default: THANKS_DEFAULT, items: wk.items, more: wk.more,
      members: mem.map((m) => ({ applicant_id: m.applicant_id, name: m.name, team: m.team, axiscare_id: m.axiscare_id, familiar: familiar[m.applicant_id] || { clients: [], why: null }, page: page[m.applicant_id] || null })),
      page_live: st.prn_page_live === true,
      familiar_note: anyWhy ? `Familiar clients could not all be read (${anyWhy}), so no client is flagged as having no PRN backup today.` : null,
      mentor_live: mentorLive(st), mentor_skills: SKILLS,
      goback_live: st.prn_goback_live === true, goback_default: GOBACK_DEFAULT, welcome_live: st.prn_welcome_live === true, welcome_default: WELCOME_DEFAULT,
      oncall: { ...oncall, patterns: PATTERNS, stipend: null, shifts: SHIFTS, shift_live: st.prn_oncall_shift_live === true,
        /* for payroll: this month and last month, by shift (counts only) */
        payroll: [t.slice(0, 7), new Date(Date.parse(t.slice(0, 7) + '-01T12:00:00Z') - 86_400_000).toISOString().slice(0, 7)].map((mo) => ({ month: mo, members: onCallMonth(oc.data ?? [], mem, mo) })) } })
  }

  if (action === 'mark') {
    const m = memberOf(b.applicant_id); if (!m) return json({ error: 'That person is not on a PRN Team.' }, 404)
    const kind = ['card_mailed', 'called', 'thanks_sent', 'not_this_one', 'handled'].includes(S(b.kind, 20)) ? S(b.kind, 20) : ''
    const ref = S(b.ref, 120)
    if (!kind || !ref) return json({ error: 'What was done, and for which line?' }, 400)
    const { error } = await sb.from('prn_touches').insert({ applicant_id: m.applicant_id, kind, ref, note: S(b.note, 600) || null, by_email: who.email, by_name: who.name })
    if (error && !/duplicate|unique/i.test(error.message)) return json({ error: 'Could not record it: ' + error.message }, 500)
    await opEvent(sb, { verb: 'prn_week_' + kind, actor_name: who.name, actor_email: who.email, item_id: m.applicant_id, area: 'caregivers', summary: `${who.name}: ${kind.replace(/_/g, ' ')} for ${m.name} (${ref})` })
    return json({ outcome: error ? 'already' : 'recorded' })
  }

  if (action === 'welcome_call') {
    const m = memberOf(b.applicant_id); if (!m) return json({ error: 'That person is not on a PRN Team.' }, 404)
    const r = readCall(b, m.team); if (!r.ok) return json({ error: r.error }, 400)
    const a = r.answers, at = new Date().toISOString()
    const { data: app, error: ae } = await sb.from('job_applicants').select('prn').eq('id', m.applicant_id).maybeSingle()
    if (ae || !app) return json({ error: 'Could not read their PRN answers: ' + (ae?.message || 'not found') }, 500)
    const prn = (app.prn && typeof app.prn === 'object') ? app.prn : {}
    const rec = { ...a, by: who.name || who.email, at }
    const next: Any = { ...prn, welcome: rec, welcome_history: [...(Array.isArray(prn.welcome_history) ? prn.welcome_history : []), rec].slice(-20) }
    if (a.office_interest) next.office_interest = { yes: true, by: who.name || who.email, at }
    /* short notice: the same record the PRN card's Short notice answer keeps (prn-team short_notice), told on a call */
    if (a.short_notice === 'yes' || a.short_notice === 'no') {
      const sn = { ok: a.short_notice === 'yes', by: who.name || who.email, at, how: 'call', note: 'Welcome call', notice: prn.notice ?? null }
      Object.assign(next, { short_notice_ok: sn.ok, short_notice: sn, short_notice_history: [...(Array.isArray(prn.short_notice_history) ? prn.short_notice_history : []), sn].slice(-50) })
    }
    const { error: ue } = await sb.from('job_applicants').update({ prn: next }).eq('id', m.applicant_id)
    if (ue) return json({ error: 'Could not save their answers: ' + ue.message }, 500)
    let oncall = 'none'
    if (a.oncall) {
      const { error: oe } = await sb.from('prn_oncall').insert({ applicant_id: m.applicant_id, kind: 'offer', pattern: a.oncall, note: 'Welcome call', by_email: who.email, by_name: who.name })
      oncall = oe ? 'failed: ' + oe.message : 'recorded'
    }
    const { error } = await sb.from('prn_touches').insert({ applicant_id: m.applicant_id, kind: 'welcome_call', ref: 'welcome', note: callSummary(a), by_email: who.email, by_name: who.name })
    if (error && !/duplicate|unique/i.test(error.message)) return json({ error: 'Their answers were saved, but the call could not be marked done: ' + error.message }, 500)
    await opEvent(sb, { verb: 'prn_welcome_call', actor_name: who.name, actor_email: who.email, item_id: m.applicant_id, area: 'caregivers', summary: `${who.name}: welcome call with ${m.name}`, data: { answers: a } })
    return json({ outcome: error ? 'already' : 'recorded', oncall })
  }

  /* step 5a: their PRN Team page link, for a person to send them by hand (nothing is sent from here) */
  if (action === 'page_link') {
    const m = memberOf(b.applicant_id); if (!m) return json({ error: 'That person is not on a PRN Team.' }, 404)
    const secret = Deno.env.get('HUB_JOB_SECRET') ?? ''
    if (secret.length < 32) return json({ error: 'Page links are not set up on this project.' }, 500)
    const link = await makePageLink(secret, m.applicant_id, pageExpiry())
    await opEvent(sb, { verb: 'prn_page_link', actor_name: who.name, actor_email: who.email, item_id: m.applicant_id, area: 'caregivers', summary: `${who.name} copied ${m.name}'s PRN Team page link` })
    return json({ link, live: st.prn_page_live === true, days: 30 })
  }

  if (action === 'goback_mark') {
    const m = memberOf(b.applicant_id); if (!m) return json({ error: 'That person is not on a PRN Team.' }, 404)
    const ref = S(b.ref, 120), ans = S(b.answer, 5)
    if (!/^client:[a-z]+$/.test(ref) || !['yes', 'no'].includes(ans)) return json({ error: 'Which client, and was it a yes or a no?' }, 400)
    const { error } = await sb.from('prn_touches').insert({ applicant_id: m.applicant_id, kind: 'goback_' + ans, ref, note: S(b.note, 600) || null, by_email: who.email, by_name: who.name })
    if (error && !/duplicate|unique/i.test(error.message)) return json({ error: 'Could not record it: ' + error.message }, 500)
    await opEvent(sb, { verb: 'prn_goback_' + ans, actor_name: who.name, actor_email: who.email, item_id: m.applicant_id, area: 'caregivers', summary: `${who.name}: ${m.name} ${ans === 'yes' ? 'would be glad to go back' : 'would rather not go back'} (${ref})` })
    return json({ outcome: error ? 'already' : 'recorded' })
  }

  if (action === 'client_mark') {
    const ref = S(b.ref, 160), kind = S(b.kind, 20)
    if (!/^nobackup:[a-z]+:\d{4}-\d\d$/.test(ref) || !['intro_planned', 'not_this_one'].includes(kind)) return json({ error: 'Which client line, and what was done?' }, 400)
    const { error } = await sb.rpc('upsert_app_data_item', { target_key: 'prn_client_marks', item: { id: ref, kind, note: S(b.note, 300) || null, by_email: who.email, by_name: who.name, at: new Date().toISOString() } })
    if (error) return json({ error: 'Could not record it: ' + error.message }, 500)
    await opEvent(sb, { verb: 'prn_client_' + kind, actor_name: who.name, actor_email: who.email, item_id: ref, area: 'caregivers', summary: `${who.name}: ${kind === 'intro_planned' ? 'planning an intro visit' : 'not this one'} (${ref})` })
    return json({ outcome: 'recorded' })
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
    const shift = S(b.shift, 10)
    if (shift && !SHIFTS[shift]) return json({ error: 'Which shift: daytime, overnight or the whole day?' }, 400)
    if (!shift && st.prn_oncall_shift_live === true) return json({ error: 'Which shift: daytime (7am to 5pm), overnight (5pm to 7am) or the whole day?' }, 400)
    const { error } = await sb.from('prn_oncall').insert({ applicant_id: m.applicant_id, kind: 'confirmed', start_date: s, end_date: e, note, by_email: who.email, by_name: who.name, ...(shift ? { shift } : {}) })
    if (error) return json(/duplicate|unique/i.test(error.message) ? { outcome: 'already' } : { error: 'Could not record it: ' + error.message }, /duplicate|unique/i.test(error.message) ? 200 : 500)
    await opEvent(sb, { verb: 'prn_oncall_confirmed', actor_name: who.name, actor_email: who.email, item_id: m.applicant_id, area: 'caregivers', summary: `${m.name} confirmed on call ${s} to ${e}${shift ? ' (' + SHIFT_SHORT[shift] + ')' : ''}` })
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

  /* STEP 8a · GAP MENTORS */
  if (action === 'mentor_set') {
    const m = memberOf(b.applicant_id); if (!m) return json({ error: 'That person is not on a PRN Team.' }, 404)
    const r = readMentor(b, m.team); if (!r.ok) return json({ error: r.error }, 400)
    const { data: app, error: ae } = await sb.from('job_applicants').select('prn').eq('id', m.applicant_id).maybeSingle()
    if (ae || !app) return json({ error: 'Could not read their PRN answers.' }, 500)
    const prn = (app.prn && typeof app.prn === 'object') ? app.prn : {}
    const rec = { ...r.rec, by: who.name || who.email, at: new Date().toISOString() }
    const next = { ...prn, gap_mentor: rec, gap_mentor_history: [...(Array.isArray(prn.gap_mentor_history) ? prn.gap_mentor_history : []), rec].slice(-20) }
    const { error } = await sb.from('job_applicants').update({ prn: next }).eq('id', m.applicant_id)
    if (error) return json({ error: 'Could not save it: ' + error.message }, 500)
    await opEvent(sb, { verb: rec.on ? 'prn_mentor_named' : 'prn_mentor_removed', actor_name: who.name, actor_email: who.email, item_id: m.applicant_id, area: 'caregivers',
      summary: rec.on ? `${who.name} named ${m.name} a Gap Mentor (${rec.skills.map((k: string) => SKILLS[k]).join(', ')})` : `${who.name}: ${m.name} is no longer a Gap Mentor` })
    return json({ outcome: 'saved', gap_mentor: rec })
  }
  if (action === 'mentor_ask') {
    if (!mentorLive(st)) return json({ outcome: 'off', error: st.prn_page_live !== true ? "The PRN Team page isn't open yet, so Gap Mentors can't see the ask. Nothing was saved."
      : 'Gap Mentor asks are switched off (Settings, PRN Teams). Nothing was saved.' }, 409)
    const r = readAsk(b, today()); if (!r.ok) return json({ error: r.error }, 400)
    const { data, error } = await sb.from('prn_mentor_visits').insert({ ...r.ask, asked_by: who.name || who.email }).select('id').maybeSingle()
    if (error) return json({ error: 'Could not save it: ' + error.message }, 500)
    await opEvent(sb, { verb: 'prn_mentor_asked', actor_name: who.name, actor_email: who.email, item_id: String(data?.id ?? ''), area: 'caregivers',
      summary: `${who.name} asked for a Gap Mentor: ${KINDS[r.ask.kind].label} for ${r.ask.client_name}, ${r.ask.visit_date} ${r.ask.visit_time}` })
    return json({ outcome: 'asked', id: data?.id ?? null })
  }
  if (action === 'mentor_list') {
    const ax = S(b.client_ax, 20).replace(/\D/g, '')
    const base = sb.from('prn_mentor_visits').select('*')
    const { data: vs, error } = await (ax ? base.eq('client_ax', ax) : base.eq('status', 'open')).order('visit_date', { ascending: false }).limit(40)
    if (error) return json({ error: 'Gap Mentor visits are not set up yet (prn_mentor.sql).' }, 500)
    const ids = (vs ?? []).map((v: Any) => v.id)
    const { data: ans } = ids.length ? await sb.from('prn_mentor_answers').select('visit_id, applicant_id, answer, at').in('visit_id', ids) : { data: [] }
    const nameOf = (aid: string) => memberOf(aid)?.name || 'A PRN member'
    return json({ ok: true, live: mentorLive(st), switch_on: st.prn_mentor_live === true, page_live: st.prn_page_live === true, skills: SKILLS, kinds: Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, v.label])),
      visits: (vs ?? []).map((v: Any) => ({ ...v, assigned_name: v.assigned_to ? nameOf(v.assigned_to) : null,
        answers: (ans ?? []).filter((a: Any) => a.visit_id === v.id).map((a: Any) => ({ applicant_id: a.applicant_id, name: nameOf(a.applicant_id), answer: a.answer, at: a.at })) })) })
  }
  if (action === 'mentor_assign' || action === 'mentor_cancel') {
    const id = Number(b.id); if (!Number.isInteger(id) || id <= 0) return json({ error: 'Which visit?' }, 400)
    const { data: v } = await sb.from('prn_mentor_visits').select('*').eq('id', id).maybeSingle()
    if (!v) return json({ error: 'No such visit.' }, 404)
    if (action === 'mentor_cancel') {
      if (v.status === 'done') return json({ error: 'This visit already happened.' }, 409)
      const { error } = await sb.from('prn_mentor_visits').update({ status: 'cancelled', cancelled_by: who.name || who.email, cancelled_at: new Date().toISOString() }).eq('id', id)
      if (error) return json({ error: 'Could not cancel it: ' + error.message }, 500)
      await opEvent(sb, { verb: 'prn_mentor_cancelled', actor_name: who.name, actor_email: who.email, item_id: String(id), area: 'caregivers', summary: `${who.name} cancelled the Gap Mentor ask for ${v.client_name}` })
      return json({ outcome: 'cancelled' })
    }
    if (v.status !== 'open') return json({ error: v.status === 'assigned' ? 'It is already assigned.' : 'This ask is no longer open.' }, 409)
    const m = memberOf(b.applicant_id); if (!m) return json({ error: 'That person is not on a PRN Team.' }, 404)
    const { data: ap } = await sb.from('job_applicants').select('prn').eq('id', m.applicant_id).maybeSingle()
    if (ap?.prn?.gap_mentor?.on !== true) return json({ error: `${m.name} is not a Gap Mentor.` }, 409)
    const { error } = await sb.from('prn_mentor_visits').update({ status: 'assigned', assigned_to: m.applicant_id, assigned_by: who.name || who.email, assigned_at: new Date().toISOString() }).eq('id', id).eq('status', 'open')
    if (error) return json({ error: 'Could not record it: ' + error.message }, 500)
    await opEvent(sb, { verb: 'prn_mentor_assigned', actor_name: who.name, actor_email: who.email, item_id: String(id), area: 'caregivers',
      summary: `${who.name} assigned ${m.name} the Gap Mentor visit for ${v.client_name} (${v.visit_date} ${v.visit_time}); it goes in AxisCare as a non-billable visit` })
    return json({ outcome: 'assigned' })
  }

  /* STEP 6 · THE MONTHLY PRN TEAM UPDATE */
  if (action === 'monthly' || action === 'monthly_save' || action === 'monthly_send') {
    const month = isMonth(b.month) ? S(b.month, 7) : lastMonth(today())
    if (month !== lastMonth(today())) return json({ error: `The update is for last month (${monthWord(lastMonth(today()))}).` }, 400)
    const { data: row, error: re } = await sb.from('prn_monthly').select('*').eq('month', month).maybeSingle()
    if (re) return json({ error: 'The monthly update is not set up yet (prn_monthly.sql).' }, 500)
    const ids = mem.map((m) => m.applicant_id)
    const { data: done } = ids.length ? await sb.from('prn_touches').select('applicant_id').eq('kind', 'monthly_sent').eq('ref', monthlyRef(month)) : { data: [] }
    const doneIds = new Set((done ?? []).map((x: Any) => x.applicant_id))
    const draftFacts = async () => {
      const { data: sh } = ids.length ? await sb.from('prn_shift_log').select('case_id, kind, shift_date, axiscare_caregiver_id').in('applicant_id', ids) : { data: [] }
      return monthFacts({ month, shifts: sh ?? [], cases: list(await readKey(sb, 'coverage_cases')), members: mem }).lines
    }
    if (action === 'monthly') {
      const facts = row?.sent_at ? (row.body?.facts ?? []) : await draftFacts()
      return json({ ok: true, month, month_word: monthWord(month), live: monthlyLive(st), switch_on: st.prn_monthly_live === true, page_live: st.prn_page_live === true,
        facts, paragraph: row?.body?.paragraph ?? '', kind_word: row?.body?.kind_word ?? '', tip: row?.body?.tip ?? '', steady: STEADY_LINE,
        saved_by: row?.saved_by ?? null, saved_at: row?.saved_at ?? null, sent_by: row?.sent_by ?? null, sent_at: row?.sent_at ?? null,
        members: mem.length, sent_to: doneIds.size, text_default: MONTHLY_TEXT_DEFAULT, text_tmpl: S(st.prn_monthly_msg, 700) || null })
    }
    if (action === 'monthly_save') {
      if (row?.sent_at) return json({ error: `The ${monthWord(month)} update was already sent and stays as it went out.` }, 409)
      const d = readDraft(b); if (!d.ok) return json({ error: d.error }, 400)
      const body = { facts: await draftFacts(), paragraph: d.paragraph, kind_word: d.kind_word, tip: d.tip }
      const { error } = await sb.from('prn_monthly').upsert({ month, body, saved_by: who.name || who.email, saved_at: new Date().toISOString() }, { onConflict: 'month' })
      if (error) return json({ error: 'Could not save it: ' + error.message }, 500)
      await opEvent(sb, { verb: 'prn_monthly_saved', actor_name: who.name, actor_email: who.email, item_id: month, area: 'caregivers', summary: `${who.name} saved the ${monthWord(month)} PRN Team update` })
      return json({ outcome: 'saved', facts: body.facts })
    }
    /* monthly_send */
    if (!monthlyLive(st)) return json({ outcome: 'off', error: st.prn_page_live !== true ? "The PRN Team page isn't open yet, so the update can't link to it. Nothing was sent."
      : 'Sending the monthly update is switched off (Settings, PRN Teams). Nothing was sent.' }, 409)
    const hour = Number(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', hour: '2-digit', hour12: false })) % 24
    if (!sendHour(hour)) return json({ outcome: 'night', error: 'Caregivers are not texted between 9pm and 8am. Nothing was sent; send it in the morning.' }, 409)
    if (!S(row?.body?.paragraph, 10)) return json({ error: 'Write your paragraph and save it first. Nothing was sent.' }, 400)
    const secret = Deno.env.get('HUB_JOB_SECRET') ?? ''
    if (secret.length < 32) return json({ error: 'Page links are not set up on this project. Nothing was sent.' }, 500)
    const ghl = { token: Deno.env.get('GHL_TOKEN') || Deno.env.get('GHL_API_KEY') || '', locationId: Deno.env.get('GHL_LOCATION_ID') ?? '' }
    if (!ghl.token || !ghl.locationId) return json({ error: 'GoHighLevel is not configured. Nothing was sent.' }, 502)
    const roster = list(await readKey(sb, 'caregivers'))
    const out = { sent: [] as string[], already: doneIds.size, no_phone: [] as string[], refused: [] as string[], failed: [] as string[] }
    for (const m of mem) {
      if (doneIds.has(m.applicant_id)) continue
      const cg = m.axiscare_id ? roster.find((c: Any) => String(c?.axiscare_id ?? '') === m.axiscare_id) : null
      const { data: app } = await sb.from('job_applicants').select('phone, first_name, last_name').eq('id', m.applicant_id).maybeSingle()
      const phone = normalisePhone(cg?.phone) || normalisePhone(app?.phone)
      if (!phone) { out.no_phone.push(m.name); continue }
      let refusal: string[] = []
      const contact = await contactForOutbound(sb, ghl, { phone, firstName: cg?.first || app?.first_name, lastName: cg?.last || app?.last_name }, 'routine_internal',
        { audience: 'caregiver', channel: 'sms', sender: 'prn-monthly', humanInitiated: true, onOptOut: (r: string[]) => { refusal = r } })
      if (!contact) { out.refused.push(`${m.name}${refusal.length ? ' (asked not to get texts)' : ''}`); continue }
      const link = await makePageLink(secret, m.applicant_id, pageExpiry())
      const message = monthlyText(st.prn_monthly_msg, m.first, month, link)
      const ok = await ghlSendChecked(sb, { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json' }, 'prn-monthly',
        { channel: 'sms', contactId: contact.contactId, address: phone, who: m.name }, { message, fromNumber: MO_FROM })
      if (!ok) { out.failed.push(m.name); continue }
      out.sent.push(m.name)
      await sb.from('prn_touches').insert({ applicant_id: m.applicant_id, kind: 'monthly_sent', ref: monthlyRef(month), message: keptMessage(message, link), by_email: who.email, by_name: who.name })
    }
    if (out.sent.length) {
      const stamp = row?.sent_at ? {} : { sent_at: new Date().toISOString(), sent_by: who.name || who.email }
      await sb.from('prn_monthly').update({ ...stamp, sent_count: out.already + out.sent.length }).eq('month', month)
    }
    await opEvent(sb, { verb: 'prn_monthly_sent', actor_name: who.name, actor_email: who.email, item_id: month, area: 'caregivers',
      summary: `${who.name} sent the ${monthWord(month)} PRN Team update to ${out.sent.length}` + (out.refused.length + out.failed.length + out.no_phone.length ? ` (${out.refused.length + out.failed.length + out.no_phone.length} not reached)` : ''), data: out })
    return json({ outcome: 'sent', ...out })
  }

  return json({ error: 'unknown action' }, 400)
})
