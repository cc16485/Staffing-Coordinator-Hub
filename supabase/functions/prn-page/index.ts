// =============================================================================
// prn-page — PRN step 5a: a PRN member's own PRN Team page (Samantha 2026-10-29; rules in _shared/prn-page.ts)
// =============================================================================
// Public (no login; deploy with --no-verify-jwt): the member opens it from their own sealed link (_shared/prn-page-links.ts).
// Anything forged or expired is refused. Office staff open it read-only with their Hub sign-in ("See what Grace sees").
//   view        {p, e, t}: their page. Records that they looked (the PRN table's "Last looked at their page").
//   preview     {applicant_id} + a Hub sign-in: the same page, read-only. Recorded (who looked, when) BEFORE anything is shown;
//               if it can't be recorded, nothing is shown.
//   hours       {p, e, t, windows, target_hours, outside_ok}: My hours, saved where the My Hours page saves them
//               (app_data caregiver_availability), so every shift rule reads the same answer.
//   short_notice {p, e, t, ok}: kept on their PRN answers exactly like the office's record, "told us on their page".
//   break       {p, e, t, until}: "I'm taking a break until ___" (empty ends it). No shift text asks them until the date has
//               passed (_shared/prn-break.ts).
//   looking     {p, e, t, on, note}: "I'm looking for hours", on for 7 days; shows on This week.
//   course      {p, e, t, slug}: "I'd like to take this"; shows on This week. The office assigns it on the Training Platform.
//   idea        {p, e, t, text}: "Share an idea"; shows on This week.
//   open        {p, e, t} (or open_preview {applicant_id} + a Hub sign-in): PRN step 5b, the open shifts their page may show,
//               judged by each shift's own ask list (coverage-run prn_open; rules in _shared/prn-open.ts). Loaded after the
//               page so it opens fast.
//   feedback    {p, e, t, a1, a2} (step 7): their answers to the twice-yearly "What would make PRN better?" (May and November,
//               the first 30 days; switch ops_settings.prn_feedback_live). Once per round; shows on This week.
//   oncall      {p, e, t, pattern} (step 7, PRN CNA Team only): would they like to be on call, and how often. An offer never
//               puts anyone on call; the office confirms each date, and confirmed dates show on their page.
//   ON-CALL SIGN-UP (2026-10-29, her decisions 23, 24, 27; rules in _shared/prn-oncall.ts; PRN CNA Team only; switch
//   ops_settings.prn_oncall_signup_live, off: the page shows nothing new and these refuse; the office preview shows it):
//   oncall_sign {p, e, t, agree: true, typed_name, version}: they read and signed the On-Call Expectations (the exact words
//               kept with the version and time). Needed before their first sign-up, and again whenever the words change.
//   oncall_ask  {p, e, t, slots: [{date, slot: day|overnight}]}: one-time asks for open shifts in the next 4 weeks. Each lands
//               on the office calendar as "asked"; the office confirms. Never while blocked by a missed on-call shift.
//               EVERY WEEK (2026-10-30, W1 to W7): a slot with weekly: true is an every-week ask (prn_oncall_series, asked) plus
//               its first week as an ask; the office's one OK confirms the series and later weeks are added already confirmed.
//               view returns oncall.signup.weekly (their every-week shifts; My hours shows them too, for the 60-day check-in).
//   oncall_withdraw {p, e, t, id}: takes back their own ask the office hasn't answered (an every-week ask ends with it). A confirmed shift is given back by
//               calling the office at least 24 hours ahead (decision 27), never from the page.
//   mentor_answer {p, e, t, id, answer: yes|no} (step 8a, Gap Mentors only): "I can do it" / "Not this time" on a Gap Mentor
//               visit, checked again first (skill, break, Do Not Return, AxisCare at that time). Switch prn_mentor_live.
//   mentor_note {p, e, t, id, ...fields}: their note after a visit assigned to them (from the visit day on). A refresher goes
//               on the caregiver's record; a care update or supervisory note goes to the client's Care plan reviews, with a
//               card for the office. Once in, it stays as written.
//   more_hours  {p, e, t, answer: yes|no} (2026-10-29, plan section 3): "Would you like more hours?" under My hours, where the 60-day
//               check-in lands. Kept on their PRN answers; a yes shows on This week. Switch ops_settings.prn_more_hours_live.
//   interested  {p, e, t, case_id, shift_key}: "I'm Interested", a Yes on that shift (coverage-run prn_interest checks it all
//               again). Nobody is assigned until a coordinator confirms it in AxisCare.
// Switch ops_settings.prn_page_live (off): members get "This page isn't open yet" and nothing is saved; the office preview works.
// Open shifts also need ops_settings.prn_open_shifts_live (off: no open shifts and no I'm Interested; the office preview shows
// what they would see, marked as waiting).
// Never shown: pay, ratings, other people, addresses, last names. Nothing here texts anyone.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { checkPageLink } from '../_shared/prn-page-links.ts'
import { makeShiftLink, shiftDayEnd } from '../_shared/shift-links.ts'
import { visitsOf } from '../_shared/axis-visits.ts'
import { familiarClients, FAMILIAR_DAYS } from '../_shared/prn-familiar.ts'
import { lookingState, readHours, readBreak, offeredTo, thanksFor, COURSES, TEAM } from '../_shared/prn-page.ts'
import { MO_FROM } from '../_shared/office-from.ts'
import { openLive } from '../_shared/prn-open.ts'
import { pageUpdate } from '../_shared/prn-monthly.ts'
import { feedbackRound, feedbackLive, readFeedback, FEEDBACK_QUESTIONS, onCallFor, ONCALL_WORDS } from '../_shared/prn-recognition.ts'
import { PATTERNS } from '../_shared/prn-week.ts'
import { memberSlots, blockOf, readAsks, readSign, signedCurrent, termsText, termsVersion, seriesView, weekdayOf, SLOT_WORD, DAYS_AHEAD, GIVE_BACK_HOURS } from '../_shared/prn-oncall.ts'
import { mentorLive, mayOffer, offerView, readReport, landing, fieldsFor, KINDS, SKILLS, MENTOR_RULES } from '../_shared/prn-mentor.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
// deno-lint-ignore no-explicit-any
type Any = any
const S = (v: unknown, n = 200) => String(v ?? '').trim().slice(0, n)
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
const nowNaive = () => new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).replace(' ', 'T').slice(0, 16)
const list = (v: Any): Any[] => Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : [])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const digits10 = (p: unknown) => { const d = String(p ?? '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : '' }
// deno-lint-ignore no-explicit-any
async function readKey(sb: any, key: string): Promise<Any> { const { data } = await sb.from('app_data').select('data').eq('key', key).maybeSingle(); return data?.data ?? null }
const officePhone = () => { const d = digits10(MO_FROM); return d ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : '(417) 234-8494' }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  let b: Any = {}
  try { b = await req.json() } catch { b = {} }
  const action = S(b?.action, 20)
  const secret = Deno.env.get('HUB_JOB_SECRET') ?? ''
  const st = (await readKey(sb, 'ops_settings')) || {}
  const live = st.prn_page_live === true

  /* who: the member from their link, or the office previewing one member */
  let aid = '', who: Any = null
  if (action === 'preview' || action === 'open_preview') {
    who = await requireStaff(sb, req, OFFICE_ROLES)
    if (!who.ok) return json({ error: who.error }, who.status)
    aid = S(b.applicant_id, 40).toLowerCase()
    if (!UUID.test(aid)) return json({ error: 'Which PRN member?' }, 400)
  } else {
    if (!(await checkPageLink(secret, b))) return json({ expired: true, message: 'This link has expired or is not valid. Text us and we will send you a fresh one.', office: officePhone() }, 401)
    aid = S(b.p, 40).toLowerCase()
    if (!live) return json({ closed: true, message: "Your PRN Team page isn't open yet. We'll text you when it is.", office: officePhone() })
  }
  const { data: tr } = await sb.from('pay_tracks').select('applicant_id, track, team, since, axiscare_caregiver_id, linked_at').eq('applicant_id', aid).maybeSingle()
  if (!tr || tr.track !== 'prn_team') return json({ gone: true, message: "This page is for our PRN Teams. If you think that's a mistake, text us.", office: officePhone() }, 404)
  const { data: app } = await sb.from('job_applicants').select('id, first_name, last_name, prn').eq('id', aid).maybeSingle()
  if (!app) return json({ gone: true, message: 'We could not find you. Text us and we will sort it out.', office: officePhone() }, 404)
  const prn = (app.prn && typeof app.prn === 'object') ? app.prn : {}
  const team = tr.team === 'caregiver' ? 'caregiver' : 'cna', ax = tr.axiscare_caregiver_id ? String(tr.axiscare_caregiver_id) : null
  const first = S(app.first_name, 40).split(/\s+/)[0] || 'there', t = today()
  /* the board's own engine, server to server (its ask list, its safety checks; nothing copied here) */
  const engine = async (body: Record<string, unknown>) => {
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    try {
      const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/coverage-run`, { method: 'POST',
        headers: { Authorization: 'Bearer ' + key, apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      return { ok: r.ok, status: r.status, j: await r.json().catch(() => ({})) }
    } catch { return { ok: false, status: 0, j: {} } }
  }
  const log = async (kind: string, note: string | null = null) => {
    const { error } = await sb.from('prn_page_log').insert({ applicant_id: aid, kind, note: note ? S(note, 600) : null, by_name: who?.name ?? null, by_email: who?.email ?? null })
    return error
  }

  if (action === 'view' || action === 'preview') {
    if (action === 'preview') {
      const e = await log('office_preview')
      if (e) return json({ error: 'Opening their page could not be recorded, so nothing is shown: ' + e.message }, 500)
    } else await log('viewed')
    const [plog, touches, shifts] = await Promise.all([
      sb.from('prn_page_log').select('kind, note, at').eq('applicant_id', aid).order('at'),
      sb.from('prn_touches').select('kind, ref, message, by_name, at').eq('applicant_id', aid),
      ax ? sb.from('prn_shift_log').select('case_id, kind, shift_date').eq('axiscare_caregiver_id', ax) : Promise.resolve({ data: [] })])
    const sh: Any[] = shifts.data ?? []
    const covered = sh.filter((x) => x.kind === 'confirmed' && !sh.some((o) => o.kind === 'backed_out' && o.case_id === x.case_id)).length
    /* Offered to You: answering opens the shift page they already know, with its own link (none in the office preview) */
    const offered = offeredTo(list(await readKey(sb, 'coverage_cases')), ax, t)
    if (action === 'view' && secret.length >= 32) for (const o of offered) { try { o.link = await makeShiftLink(secret, o.case_id, o.ask_id, shiftDayEnd(o.shift_date)) } catch { o.link = null } }
    for (const o of offered) delete o.ask_id
    /* their familiar clients: first name and how recently (no last names, no addresses) */
    let clients: Any[] = [], clientsWhy: string | null = ax ? null : 'Once you are on the schedule, the clients you care for show here.'
    const clientNames: string[] = []   /* full names, only to put a Field Support Visit's familiar clients first (never shown) */
    if (ax) {
      const from = new Date(Date.parse(t + 'T12:00:00Z') - FAMILIAR_DAYS * 86_400_000).toISOString().slice(0, 10)
      const v = await visitsOf(ax, from, t)
      if (v.why) clientsWhy = "We couldn't load your clients just now. Check back soon."
      else clients = familiarClients({ name: [app.first_name, app.last_name].filter(Boolean).join(' '), visits: v.rows, dnr: list(await readKey(sb, 'dnr_log')),
        checkins: list(await readKey(sb, 'client_checkins')), answers: (touches.data ?? []).map((x: Any) => ({ ...x, applicant_id: aid })), today: t })
          .map((c) => { clientNames.push(S(c.client, 80)); return { first: S(c.client, 80).split(/\s+/)[0], last_visit: c.last, glad: c.glad, star: c.star } })
    }
    const av = list(await readKey(sb, 'caregiver_availability')).find((x: Any) => ax && (S(x?.axiscare_id, 20) === ax || S(x?.id, 20) === ax)) || null
    const requested = new Set((plog.data ?? []).filter((r: Any) => r.kind === 'course_request').map((r: Any) => S(r.note, 40)))
    /* step 6: the month's PRN Team update at the top (the last one sent, for 40 days; none set up yet = none) */
    const um = await sb.from('prn_monthly').select('month, body, sent_by, sent_at').not('sent_at', 'is', null).order('month', { ascending: false }).limit(1)
    const update = um.error ? null : pageUpdate((um.data ?? [])[0], t)
    /* step 7: the twice-yearly questions while a round is open, and on call for the PRN CNA Team */
    const round = feedbackRound(t)
    const feedback = round && (feedbackLive(st) || action === 'preview') ? { round: round.id, until: round.until, questions: FEEDBACK_QUESTIONS,
      answered: (plog.data ?? []).some((r: Any) => r.kind === 'feedback' && S(r.note, 600).startsWith('[' + round.id + ']')), waiting: !feedbackLive(st) } : null
    let oncall: Any = null
    if (team === 'cna') { const oc = await sb.from('prn_oncall').select('*').eq('applicant_id', aid)
      oncall = { ...onCallFor(oc.error ? [] : (oc.data ?? []), t, PATTERNS), patterns: PATTERNS, words: ONCALL_WORDS }
      /* the calendar sign-up (her decisions 23, 24, 27): only while it's switched on, or in the office preview */
      if (st.prn_oncall_signup_live === true || action === 'preview') {
        const all = await sb.from('prn_oncall').select('id, applicant_id, kind, start_date, end_date, shift, cancelled_at, at, series_id').in('kind', ['confirmed', 'asked']).gte('end_date', t)
        const [mk, tm] = await Promise.all([sb.from('prn_oncall_marks').select('applicant_id, kind, oncall_id, at, by_name').eq('applicant_id', aid), sb.from('prn_oncall_terms').select('version, agreed_at').eq('applicant_id', aid)])
        const text = termsText(st), ver = termsVersion(text)
        /* every week (2026-10-30): their series; a missing table (prn_oncall_weekly.sql not run) = none, and no every-week asks */
        const se = await sb.from('prn_oncall_series').select('*').eq('applicant_id', aid).in('status', ['asked', 'confirmed'])
        const ser: Any[] = se.error ? [] : (se.data ?? [])
        oncall.signup = all.error || mk.error || tm.error ? { ready: false } : { ready: true, waiting: st.prn_oncall_signup_live !== true, terms: text, version: ver,
          signed: signedCurrent((tm.data ?? []).map((x: Any) => ({ ...x, applicant_id: aid })), aid, ver), signed_before: (tm.data ?? []).length > 0,
          blocked: blockOf(mk.data ?? [], aid).blocked, slot_words: SLOT_WORD, days: DAYS_AHEAD, give_back_hours: GIVE_BACK_HOURS,
          slots: memberSlots({ rows: all.data ?? [], aid, today: t, nowNaive: nowNaive(), series: ser }), weekly_ready: !se.error, weekly: seriesView(ser) }
      } }
    /* step 8a: Gap Mentor visits offered to them, and their own assigned ones (with the note to fill in) */
    let mentor: Any = null
    if (team === 'cna' && prn.gap_mentor?.on === true && (mentorLive(st) || action === 'preview')) {
      const me = { name: [app.first_name, app.last_name].filter(Boolean).join(' '), team, prn, axiscare_id: ax }
      const famKeys = new Set(clientNames.map((n) => n.toLowerCase()))
      const [ov, mv, ma] = await Promise.all([
        sb.from('prn_mentor_visits').select('*').eq('status', 'open').gte('visit_date', t),
        sb.from('prn_mentor_visits').select('*').eq('assigned_to', aid).in('status', ['assigned', 'done']),
        sb.from('prn_mentor_answers').select('visit_id, answer').eq('applicant_id', aid)])
      const dnr = list(await readKey(sb, 'dnr_log')), byDay: Record<string, Any[] | null> = {}
      const offers: Any[] = []
      for (const v of (ov.error ? [] : ov.data ?? []).slice(0, 10)) {
        const d = S(v.visit_date, 10)
        if (!(d in byDay)) { const r = ax ? await visitsOf(ax, d, d) : { rows: [], why: 'not on the schedule' }; byDay[d] = r.why ? null : r.rows }
        if (!mayOffer({ mentor: me, visit: v, dnr, rows: byDay[d] }).ok) continue
        const a = (ma.data ?? []).find((x: Any) => Number(x.visit_id) === Number(v.id))
        offers.push(offerView(v, a ? a.answer : null, famKeys.has(S(v.client_name, 80).toLowerCase())))
      }
      offers.sort((a, b) => Number(b.familiar) - Number(a.familiar) || `${a.visit_date}${a.visit_time}`.localeCompare(`${b.visit_date}${b.visit_time}`))
      const mine = (mv.error ? [] : mv.data ?? []).sort((a: Any, b: Any) => S(b.visit_date, 10).localeCompare(S(a.visit_date, 10))).slice(0, 6).map((v: Any) => ({ ...offerView(v, 'yes', false),
        status: v.status, note_due: v.status === 'assigned' && S(v.visit_date, 10) <= t, fields: fieldsFor(v.kind), done: !!v.report }))
      mentor = { skills: (prn.gap_mentor.skills || []).map((k: string) => SKILLS[k] || k), offers, mine, waiting: !mentorLive(st), rules: MENTOR_RULES,
        first_done: (mv.data ?? []).some((v: Any) => v.status === 'done') }
    }
    const brk = /^\d{4}-\d\d-\d\d$/.test(S(prn.break_until, 10)) && S(prn.break_until, 10) >= t ? S(prn.break_until, 10) : null
    return json({ ok: true, preview: action === 'preview', live, open_live: openLive(st), today: t, first, team, team_label: TEAM[team], since: S(tr.since, 10), on_schedule: !!ax,
      looking: lookingState(plog.data ?? [], t), update, feedback, oncall, mentor, offered, clients, clients_why: clientsWhy,
      thanks: [...(mentor?.first_done ? [{ kind: 'milestone', at: '', text: 'Your first Field Support Visit. Thank you for helping our caregivers and families.' }] : []), ...thanksFor({ touches: touches.data ?? [], kindTells: list(await readKey(sb, 'kind_tells')), ax, covered, since: S(tr.since, 10), today: t, shifts: sh })],
      hours: { windows: av?.windows ?? null, target_hours: av?.target_hours ?? null, outside_ok: av?.outside_ok === true, updated_at: av?.updated_at ?? null,
        short_notice_ok: typeof prn.short_notice_ok === 'boolean' ? prn.short_notice_ok : null, break_until: brk,
        /* "Would you like more hours?" (switch prn_more_hours_live; the office preview shows it either way) */
        more_hours: st.prn_more_hours_live === true || action === 'preview' ? { answer: ['yes', 'no'].includes(S(prn.more_hours?.answer, 5)) ? S(prn.more_hours.answer, 5) : null, at: prn.more_hours?.at ?? null, waiting: st.prn_more_hours_live !== true } : null },
      courses: COURSES.map((c) => ({ ...c, requested: requested.has(c.slug) })), office: officePhone() })
  }

  /* OPEN SHIFTS (step 5b): read only. The office preview shows them whatever the switch, so the office sees what would show. */
  if (action === 'open' || action === 'open_preview') {
    if (action === 'open' && !openLive(st)) return json({ ok: true, shifts: [], open_live: false })
    if (!ax) return json({ ok: true, shifts: [], open_live: openLive(st), why: 'Once you are on the schedule, open shifts that fit you show here.' })
    const r = await engine({ action: 'prn_open', axiscare_id: ax })
    if (!r.ok) return json({ ok: true, shifts: [], open_live: openLive(st), why: "We couldn't load open shifts just now. Check back soon." })
    return json({ ok: true, shifts: Array.isArray(r.j?.shifts) ? r.j.shifts : [], open_live: openLive(st), why: r.j?.held || null })
  }
  if (action === 'interested') {
    if (!openLive(st)) return json({ error: "Open shifts aren't on your page yet. Text us if you'd like more hours." }, 409)
    if (!ax) return json({ error: 'Once you are on the schedule you can say you are interested. Text us in the meantime.' }, 409)
    const caseId = S(b.case_id, 100), key = S(b.shift_key, 40)
    if (!caseId || !key) return json({ error: 'Which shift?' }, 400)
    const { data: ap } = await sb.from('job_applicants').select('phone').eq('id', aid).maybeSingle()
    const r = await engine({ action: 'prn_interest', case_id: caseId, axiscare_id: ax, shift_key: key, phone: ap?.phone ?? null, name: [app.first_name, app.last_name].filter(Boolean).join(' ') })
    if (!r.ok) return json({ error: S(r.j?.error, 200) || 'Not saved. Please try again in a minute.', changed: r.j?.changed === true, already: r.j?.already === true }, r.status === 503 ? 503 : 409)
    await log('interested', caseId)
    return json({ ok: true, message: `Thank you, ${first}! The office will look at it and let you know. Nothing is set until they confirm it with you.` })
  }

  /* STEP 7: the twice-yearly questions, and on call (PRN CNA Team) */
  /* STEP 8a: a Gap Mentor's answer, and their note after the visit */
  if (action === 'mentor_answer' || action === 'mentor_note') {
    if (!mentorLive(st)) return json({ error: "Field Support Visits aren't on your page yet." }, 409)
    if (team !== 'cna' || prn.gap_mentor?.on !== true) return json({ error: 'This is for PRN CNAs approved for Field Support Visits.' }, 403)
    const id = Number(b.id); if (!Number.isInteger(id) || id <= 0) return json({ error: 'Which visit?' }, 400)
    const { data: v } = await sb.from('prn_mentor_visits').select('*').eq('id', id).maybeSingle()
    if (!v) return json({ error: 'That visit is no longer there. Thank you for looking!' }, 404)
    const me = { name: [app.first_name, app.last_name].filter(Boolean).join(' '), team, prn, axiscare_id: ax }
    if (action === 'mentor_answer') {
      if (v.status !== 'open') return json({ error: 'This visit is no longer open. Thank you for looking!' }, 409)
      const ans = S(b.answer, 5); if (!['yes', 'no'].includes(ans)) return json({ error: 'Yes or not this time?' }, 400)
      if (ans === 'yes') {
        const r = ax ? await visitsOf(ax, S(v.visit_date, 10), S(v.visit_date, 10)) : { rows: [], why: 'not on the schedule' }
        if (r.why) return json({ error: "We can't check the schedule right now, so this wasn't saved. Please try again in a few minutes." }, 503)
        const ok = mayOffer({ mentor: me, visit: v, dnr: list(await readKey(sb, 'dnr_log')), rows: r.rows })
        if (!ok.ok) return json({ error: 'This visit is no longer one we can offer you. Thank you for looking!' }, 409)
      }
      const { error } = await sb.from('prn_mentor_answers').upsert({ visit_id: id, applicant_id: aid, answer: ans, at: new Date().toISOString() }, { onConflict: 'visit_id,applicant_id' })
      if (error) return json({ error: 'Could not save, please try again.' }, 500)
      if (ans === 'yes') await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { id: `ops_gapmentor_${id}`, kind: 'gap_mentor', domain: 'scheduling_coverage', status: 'open', urgency: 'normal',
        title: `${first} can do the Field Support Visit for ${S(v.client_name, 80).split(/\s+/)[0]} (${v.visit_date} ${v.visit_time})`, about: S(v.client_name, 80), client_ax: S(v.client_ax, 20),
        detail: `${KINDS[v.kind]?.label || 'Field Support Visit'}. Open the client's Care tab, Care plan reviews, to pick who goes. Put the visit in AxisCare as a non-billable visit, then record who.`,
        created_at: new Date().toISOString(), due: new Date(Date.now() + 24 * 3600000).toISOString(), owner: '', owner_name: '', created_by: 'prn-page' } })
      return json({ ok: true, message: ans === 'yes' ? 'Thank you! The office will confirm with you before it is set.' : 'Got it. Saying not this time never counts against you.' })
    }
    /* mentor_note */
    if (v.assigned_to !== aid || v.status !== 'assigned') return json({ error: v.report ? 'Your note is already in. Thank you!' : 'This visit is not assigned to you.' }, 409)
    if (S(v.visit_date, 10) > t) return json({ error: 'The note opens on the day of the visit.' }, 409)
    const r = readReport(v.kind, b); if (!r.ok) return json({ error: r.error }, 400)
    const now = new Date().toISOString()
    const { error } = await sb.from('prn_mentor_visits').update({ report: r.report, report_at: now, status: 'done' }).eq('id', id).eq('status', 'assigned')
    if (error) return json({ error: 'Could not save, please try again.' }, 500)
    const item = landing(v, me.name, r.report, now)
    const { error: le } = await sb.rpc('upsert_app_data_item', { target_key: 'care_plan_reviews', item })
    await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { id: `ops_gapnote_${id}`, kind: 'gap_mentor', domain: 'care_coordination', status: 'open', urgency: v.kind === 'refresher' ? 'normal' : 'high',
      title: `Read ${first}'s note: ${item.title}`, about: S(v.client_name, 80), client_ax: S(v.client_ax, 20),
      detail: (v.kind === 'refresher' ? `It is on ${S(v.caregiver_name, 80)}'s record.` : "It is in the client's Care plan reviews. The Care Coordinator decides any care plan change and talks with the family.")
        + (item.reminder ? ' ' + item.reminder : '') + (le ? ' (It could not be added to the Care plan reviews automatically: ' + le.message + '. It is kept on the visit.)' : ''),
      created_at: now, due: new Date(Date.now() + 24 * 3600000).toISOString(), owner: '', owner_name: '', created_by: 'prn-page' } })
    return json({ ok: true, message: `Thank you, ${first}! The office has your note.` })
  }

  if (action === 'feedback') {
    const round = feedbackRound(t)
    if (!round || !feedbackLive(st)) return json({ error: "The questions aren't open right now. You can always share an idea under Talk to us." }, 409)
    const { data: prior } = await sb.from('prn_page_log').select('note').eq('applicant_id', aid).eq('kind', 'feedback')
    if ((prior ?? []).some((r: Any) => S(r.note, 600).startsWith('[' + round.id + ']'))) return json({ error: 'You already answered this time. Thank you!' }, 409)
    const f = readFeedback(b); if (!f.ok) return json({ error: f.error }, 400)
    const e = await log('feedback', `[${round.id}]\n${f.note}`)
    if (e) return json({ error: 'Could not save, please try again.' }, 500)
    return json({ ok: true, message: `Thank you, ${first}! The office reads every answer.` })
  }
  if (action === 'oncall') {
    if (team !== 'cna') return json({ error: 'On call is for the PRN CNA Team for now.' }, 409)
    const pattern = S(b.pattern, 30); if (!PATTERNS[pattern]) return json({ error: 'Which one works for you?' }, 400)
    const { error } = await sb.from('prn_oncall').insert({ applicant_id: aid, kind: 'offer', pattern, note: 'Their PRN Team page', by_email: 'prn-page', by_name: first })
    if (error) return json({ error: 'Could not save, please try again.' }, 500)
    await log('oncall_offer', PATTERNS[pattern])
    return json({ ok: true, message: pattern === 'not_now' ? 'Got it. Saying not right now never counts against you.' : 'Thank you! The office will confirm any dates with you first.' })
  }

  /* ON-CALL SIGN-UP: the member only (the preview never reaches here), PRN CNA Team, switch on */
  if (action === 'oncall_sign' || action === 'oncall_ask' || action === 'oncall_withdraw') {
    if (team !== 'cna') return json({ error: 'On call is for the PRN CNA Team for now.' }, 409)
    if (st.prn_oncall_signup_live !== true) return json({ error: "On-call sign-up isn't open yet. Call the office if you'd like to be on call." }, 409)
    const text = termsText(st), ver = termsVersion(text)
    if (action === 'oncall_sign') {
      const r = readSign(b, ver, S(app.first_name, 40), S(app.last_name, 40)); if (!r.ok) return json({ error: r.error }, 400)
      const { error } = await sb.from('prn_oncall_terms').insert({ applicant_id: aid, version: ver, body: text, typed_name: r.typed, via: 'prn-page' })
      if (error && !/duplicate|unique/i.test(error.message)) return json({ error: 'Could not save, please try again.' }, 500)
      await log('oncall_signed', `${r.typed} (${ver})`)
      return json({ ok: true, message: `Thank you, ${first}. You can sign up for on-call shifts now.` })
    }
    const [mk, tm] = await Promise.all([sb.from('prn_oncall_marks').select('applicant_id, kind, at').eq('applicant_id', aid), sb.from('prn_oncall_terms').select('version').eq('applicant_id', aid)])
    if (mk.error || tm.error) return json({ error: 'Could not check that just now. Please try again.' }, 500)
    if (action === 'oncall_withdraw') {
      const id = Number(b.id); if (!Number.isInteger(id) || id <= 0) return json({ error: 'Which shift?' }, 400)
      const { data: row } = await sb.from('prn_oncall').select('*').eq('id', id).maybeSingle()
      if (!row || row.applicant_id !== aid || row.kind !== 'asked') return json({ error: 'That shift could not be found. Call the office.' }, 404)
      if (row.cancelled_at) return json({ ok: true, message: 'That one was already answered. Look again.' })
      const { error } = await sb.from('prn_oncall').update({ cancelled_at: new Date().toISOString(), cancelled_by: `${first} took it back on their page` }).eq('id', id).is('cancelled_at', null)
      if (error) return json({ error: 'Could not save, please try again.' }, 500)
      if (row.series_id != null) await sb.from('prn_oncall_series').update({ status: 'ended', ended_at: new Date().toISOString(), ended_by: first, end_why: 'They took the ask back on their page' }).eq('id', row.series_id).eq('status', 'asked')
      return json({ ok: true, message: 'Taken back.' })
    }
    if (blockOf(mk.data ?? [], aid).blocked) return json({ error: "On call isn't open to you right now. Call the office with any questions." }, 409)
    if (!signedCurrent((tm.data ?? []).map((x: Any) => ({ ...x, applicant_id: aid })), aid, ver)) return json({ error: 'Please read and sign the On-Call Expectations first.', sign: true }, 409)
    const all = await sb.from('prn_oncall').select('id, applicant_id, kind, start_date, end_date, shift, cancelled_at, series_id').in('kind', ['confirmed', 'asked']).gte('end_date', t)
    if (all.error) return json({ error: 'Could not check that just now. Please try again.' }, 500)
    const se = await sb.from('prn_oncall_series').select('*').eq('applicant_id', aid).in('status', ['asked', 'confirmed'])
    const r = readAsks(b, { rows: all.data ?? [], aid, today: t, nowNaive: nowNaive(), series: se.error ? [] : (se.data ?? []) }); if (!r.ok) return json({ error: r.error }, 409)
    if (se.error && r.slots.some((x) => x.weekly)) return json({ error: "Every week isn't ready yet. Ask for these one time, or call the office." }, 409)
    let added = 0
    for (const sl of r.slots) {
      /* every week: the series first (waiting for the office), then its first week as an ask that points to it */
      let seriesId: number | null = null
      if (sl.weekly) {
        const { data: sr, error: se2 } = await sb.from('prn_oncall_series').insert({ applicant_id: aid, slot: sl.slot, weekday: weekdayOf(sl.date), first_date: sl.date, status: 'asked', note: 'Their PRN Team page', by_email: 'prn-page', by_name: first }).select('id').maybeSingle()
        if (se2 || !sr) { if (/duplicate|unique/i.test(se2?.message || '')) continue; return json({ error: added ? `${added} saved, then something went wrong. Look again and try the rest.` : 'Could not save, please try again.' }, 500) }
        seriesId = Number(sr.id)
      }
      const { error } = await sb.from('prn_oncall').insert({ applicant_id: aid, kind: 'asked', start_date: sl.date, end_date: sl.date, shift: sl.slot, note: 'Their PRN Team page', by_email: 'prn-page', by_name: first, ...(seriesId ? { series_id: seriesId } : {}) })
      if (!error) { added++; continue }
      if (seriesId) await sb.from('prn_oncall_series').update({ status: 'ended', ended_at: new Date().toISOString(), ended_by: 'prn-page', end_why: 'Its first week could not be saved' }).eq('id', seriesId)
      if (!/duplicate|unique/i.test(error.message)) return json({ error: added ? `${added} saved, then something went wrong. Look again and try the rest.` : 'Could not save, please try again.' }, 500)
    }
    await log('oncall_ask', r.slots.map((x) => `${x.date} ${x.slot}${x.weekly ? ' every week' : ''}`).join(', '))
    const wk = r.slots.some((x) => x.weekly)
    return json({ ok: true, message: `Thank you, ${first}! The office will confirm ${added === 1 ? 'it' : 'them'} with you. Nothing is set until they do.` + (wk ? ' Once they confirm an every-week shift, it repeats on its own. To stop one, call the office at least 24 hours before the next one starts.' : '') })
  }

  /* everything below changes something: the member only, never the office preview */
  if (!['hours', 'short_notice', 'break', 'looking', 'course', 'idea', 'more_hours'].includes(action)) return json({ error: 'unknown action' }, 400)

  if (action === 'hours') {
    if (!ax) return json({ error: 'Your hours can be saved once you are on the schedule. Text us in the meantime.' }, 409)
    const h = readHours(b); if (!h.ok) return json({ error: h.error }, 400)
    const all = list(await readKey(sb, 'caregiver_availability'))
    const existing = all.find((x: Any) => S(x?.axiscare_id, 20) === ax || S(x?.id, 20) === ax) || null
    const item = { ...(existing || {}), id: existing?.id ?? ax, name: [app.first_name, app.last_name].filter(Boolean).join(' '), axiscare_id: ax,
      target_hours: h.target_hours, windows: h.windows, outside_ok: h.outside_ok, updated_at: new Date().toISOString(), source: 'self' }
    const { error } = await sb.rpc('upsert_app_data_item', { target_key: 'caregiver_availability', item })
    if (error) return json({ error: 'Could not save, please try again.' }, 500)
    try { await sb.from('prn_checkins').update({ answered_at: new Date().toISOString(), how: 'prn_page' }).eq('axiscare_caregiver_id', ax).is('answered_at', null) } catch { /* the save stands */ }
    await log('hours_saved')
    return json({ ok: true, message: `Saved, ${first}! The office sees this right away.` })
  }

  if (action === 'more_hours') {
    if (st.prn_more_hours_live !== true) return json({ error: "That question isn't on your page yet." }, 409)
    const ans = S(b.answer, 5); if (!['yes', 'no'].includes(ans)) return json({ error: 'Yes or not right now?' }, 400)
    const rec = { answer: ans, at: new Date().toISOString(), how: 'page' }
    const next = { ...prn, more_hours: rec, more_hours_history: [...(Array.isArray(prn.more_hours_history) ? prn.more_hours_history : []), rec].slice(-50) }
    const { error } = await sb.from('job_applicants').update({ prn: next }).eq('id', aid)
    if (error) return json({ error: 'Could not save, please try again.' }, 500)
    await log('more_hours', ans)
    return json({ ok: true, message: ans === 'yes' ? `Thank you, ${first}! The office will be in touch about more hours.` : 'Got it. Thank you for letting us know.' })
  }

  if (action === 'short_notice' || action === 'break') {
    let next: Any = { ...prn }, note = ''
    if (action === 'short_notice') {
      if (typeof b.ok !== 'boolean') return json({ error: 'Yes or no?' }, 400)
      const rec = { ok: b.ok, by: 'Themselves', at: new Date().toISOString(), how: 'page', note: 'Told us on their PRN Team page', notice: prn.notice ?? null }
      next = { ...next, short_notice_ok: b.ok, short_notice: rec, short_notice_history: [...(Array.isArray(prn.short_notice_history) ? prn.short_notice_history : []), rec].slice(-50) }
      note = b.ok ? 'yes' : 'no'
    } else {
      const r = readBreak(b.until, t); if (!r.ok) return json({ error: r.error }, 400)
      const rec = { until: r.until, at: new Date().toISOString(), how: 'page' }
      next = { ...next, break_until: r.until, break_history: [...(Array.isArray(prn.break_history) ? prn.break_history : []), rec].slice(-50) }
      note = r.until || ''
    }
    const { error } = await sb.from('job_applicants').update({ prn: next }).eq('id', aid)
    if (error) return json({ error: 'Could not save, please try again.' }, 500)
    await log(action === 'break' ? 'break_set' : 'short_notice', note || null)
    return json({ ok: true, message: action === 'short_notice' ? 'Saved. Thank you for letting us know.'
      : note ? "Enjoy your break. We won't text you about shifts until it ends." : "Welcome back! You'll hear about shifts again." })
  }

  if (action === 'looking') {
    const on = b.on === true, note = S(b.note, 200)
    await log(on ? 'looking_on' : 'looking_off', on ? note || null : null)
    return json({ ok: true, message: on ? 'Thank you! The office will see this today.' : 'Got it.' })
  }
  if (action === 'course') {
    const c = COURSES.find((k) => k.slug === S(b.slug, 40)); if (!c) return json({ error: 'Which course?' }, 400)
    await log('course_request', c.slug)
    return json({ ok: true, message: 'Thank you! The office will set it up and send you the link.' })
  }
  /* idea */
  const text = S(b.text, 500)
  if (text.length < 3) return json({ error: 'What would you like to share?' }, 400)
  await log('idea', text)
  return json({ ok: true, message: 'Thank you for sharing. The office reads every idea.' })
})
