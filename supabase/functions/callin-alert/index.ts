// Supabase Edge Function: callin-alert  (shared hub project) · CI2, 2026-10-03
// -----------------------------------------------------------------------------
// The page behind the link in a call-in text (cc.mo-care.com/callin.html). Samantha approved the call-ins plan
// ("yes to all"): one screen, from the text, no sign-in: who called off, who said yes, who's been asked; Confirm,
// I've got it, Call, Ask more, Close it. Built like the missed clock-in page she loves (clockin-alert).
//
// WHO: only a live link from an admin's text: one case, one admin (a one-way code of their email), an expiry, sealed
// with the server-only secret (_shared/callin-links.ts). The admin must still be on the call-in list
// (ops_settings.coverage_alert_admins). Anything else is refused before anything is read. POST only: opening the link
// (or a phone's link preview) changes nothing; the page's buttons do.
//
// ACTIONS (POST {c, a, e, t, action, ...}):
//   view        the case: client and shift, who called off and when, starts in, MUST BE COVERED, who has it, who said
//               yes, who was asked (state, when), the fill if any, AxisCare's answer, call buttons
//   claim       "I've got it" {take_over?}: the case shows their name; the other admins who got the call-in text hear it
//   confirm     {covered_by, not_chosen?}: _shared/coverage-fill.ts confirmFill (exactly one confirm wins; AxisCare only
//               where nobody else is on the visit); then "Filled by ..." to the other admins who got the call-in text
//   close       {how: uncovered | other_way | client_cancelled, note?}: one close wins; the others hear it
//   candidates  the ranked list (coverage-run's own, server to server): PRN who fit, worked with this client, good matches
//   ask         {recipients: [names]}: coverage-run's own send (its eligibility, wording, night rule, one ask per person)
//   bridge      {target: 'caller' | 'client' | <ask id>}: "Call" rings this admin's phone first (433's bridge)
// The family and the client are never texted from here. A confirmed fill's family text is the one she already
// approved, sent by coverage-run's next tick exactly as from the board.
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { checkLink, adminKey } from '../_shared/callin-links.ts'
import { adminRecipients } from '../_shared/clockin-admins.ts'
import { normalisePhone } from '../_shared/outreach.ts'
import { opEvent } from '../_shared/events.ts'
import { confirmFill, closeCase, readCase, patchCase, CLOSE_HOW } from '../_shared/coverage-fill.ts'
import { textCaseAdmins, filledLine, caseWhat } from '../_shared/callin-notify.ts'
import { ghlCallBridge } from '../_shared/ghl-call-bridge.ts'
import { readPlan, isMustCover } from '../_shared/callin-plan.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
               'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const AC_VERSION = Deno.env.get('AXISCARE_API_VERSION') || '2023-10-01'
const firstOf = (s: unknown) => String(s ?? '').trim().split(/\s+/)[0] || ''
const clock12 = (t: string): string => {
  const m = String(t || '').trim().match(/^(\d{1,2}):(\d\d)$/)
  if (!m) return String(t || '').trim()
  const h24 = Number(m[1]); const h = h24 % 12 || 12
  return `${h}${m[2] === '00' ? '' : ':' + m[2]}${h24 >= 12 ? 'pm' : 'am'}`
}
const chi12 = (iso: unknown) => iso ? new Date(String(iso)).toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }).replace(' ', '').toLowerCase() : null
const chiWall = () => new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).replace(' ', 'T')
const STATE_WORD: Record<string, string> = { waiting: 'waiting', yes: 'said yes', no: 'said no', inquiry: 'asked a question', noanswer: 'no answer',
  no_answer_final: 'no answer', closed_notified: 'told it is covered', closed_silent: 'not told' }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'not allowed' }, 405)
  const b = await req.json().catch(() => ({})) as Record<string, unknown>
  if (!(await checkLink(Deno.env.get('HUB_JOB_SECRET') || '', b))) return json({ error: 'This link is not valid or has expired.' }, 401)
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: setRow } = await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const settings: any = setRow?.data ?? {}
  const admins = await adminRecipients(sb, settings)
  const me = (await Promise.all(admins.map(async (x) => ({ x, k: await adminKey(x.email) })))).find((y) => y.k === String(b.a))?.x
  if (!me) return json({ error: 'You are no longer on the call-in list for these alerts.' }, 403)
  const caseId = String(b.c)
  const c = await readCase(sb, caseId)
  if (!c) return json({ error: 'This call-in is no longer on file.' }, 404)
  const ghl = { token: Deno.env.get('GHL_TOKEN') || Deno.env.get('GHL_API_KEY') || '', locationId: Deno.env.get('GHL_LOCATION_ID') || '' }
  const action = String(b.action || 'view')
  const open = c.status === 'open'
  // deno-lint-ignore no-explicit-any
  const asked: any[] = Array.isArray(c.asked) ? c.asked : []
  const tell = (line: string) => textCaseAdmins(sb, ghl, settings, c, () => line, { except: me.email, onlyAlerted: true, anyHour: true })
  // deno-lint-ignore no-explicit-any
  const roster = async (): Promise<any[]> => { const { data } = await sb.from('app_data').select('data').eq('key', 'caregivers').maybeSingle(); return Array.isArray(data?.data) ? data!.data : [] }
  const clientContact = async (): Promise<{ phone: string | null; email: string | null }> => {
    const ax = String(c.client_axiscare_id || ''); if (!/^\d+$/.test(ax)) return { phone: null, email: null }
    let token = ''; for (const n of ['AXISCARE_VISITS_TOKEN', 'AXISCARE_API_KEY', 'AXISCARE_TOKEN']) { const v = Deno.env.get(n); if (v) { token = v; break } }
    const site = Deno.env.get('AXISCARE_SITE') || ''; if (!token || !/^\d+$/.test(site)) return { phone: null, email: null }
    try {
      const r = await fetch(`https://${site}.axiscare.com/api/clients?clientIds=${ax}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-AxisCare-Api-Version': AC_VERSION } })
      const j = r.ok ? await r.json().catch(() => null) : null
      // deno-lint-ignore no-explicit-any
      const cl = (j?.results?.clients ?? []).find((x: any) => String(x?.id) === ax)
      return { phone: normalisePhone(cl?.homePhone) || normalisePhone(cl?.mobilePhone) || normalisePhone(cl?.otherPhone) || null, email: cl?.email || null }
    } catch { return { phone: null, email: null } }
  }
  /* the board's own engine, server to server (its rules, its wording, its night rule; nothing copied here) */
  const engine = async (body: Record<string, unknown>) => {
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/coverage-run`, { method: 'POST',
      headers: { Authorization: 'Bearer ' + key, apikey: key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    return { ok: r.ok, status: r.status, j }
  }

  if (action === 'view') {
    const plan = await readPlan(sb, c.client_axiscare_id, new Map()).catch(() => ({ plan: null }))
    const start = c.shift_date && /^\d\d:\d\d/.test(String(c.shift_time || '')) ? Date.parse(`${c.shift_date}T${String(c.shift_time).slice(0, 5)}:00`) : NaN
    const minsToStart = Number.isFinite(start) ? Math.round((start - Date.parse(chiWall())) / 60000) : null
    const cc = await clientContact()
    const g = (await roster()).find((x) => String(x?.axiscare_id ?? '') === String(c.calling_off_id ?? ''))
    return json({ ok: true, me: me.first, status: c.status, open, kind: c.kind || 'calloff',
      client: String(c.client || ''), what: caseWhat(c), shift_date: c.shift_date || null,
      shift_time: String(c.shift_time || '').split('-').filter(Boolean).map(clock12).join(' to '), mins_to_start: minsToStart,
      must_cover: isMustCover(plan?.plan), calling_off: c.calling_off || null, called_in_at: chi12(c.opened_at),
      claimed: c.claimed_by_name ? { by: c.claimed_by_name, at: chi12(c.claimed_at), me: String(c.claimed_by || '').toLowerCase() === me.email } : null,
      yes: asked.filter((a) => a.state === 'yes').map((a) => ({ id: String(a.id), name: String(a.name || ''), at: chi12(a.replied_at), reply: a.reply ? String(a.reply).slice(0, 200) : null })),
      asked: asked.map((a) => ({ id: String(a.id), name: String(a.name || ''), state: STATE_WORD[String(a.state)] || String(a.state || ''), at: chi12(a.at),
        replied_at: chi12(a.replied_at), can_call: !!normalisePhone(a.phone) })),
      filled: c.status !== 'open' ? { how: c.resolved_how || null, covered_by: c.covered_by || null, by: c.confirmed_by || null, at: chi12(c.resolved_at), note: c.close_note || null,
        axiscare: c.axiscare_assignment ? { status: c.axiscare_assignment.status, detail: c.axiscare_assignment.detail } : null } : null,
      can_call: { caller: !!normalisePhone(g?.phone), client: !!cc.phone },
      not_chosen_default: String(settings.coverage_msg_not_chosen || '') || 'Caring Companions: that shift got covered this time, thank you so much for offering, {first_name}! Next one is yours.',
      send_live: settings.coverage_send_live === true })
  }

  if (action === 'bridge') {
    const t = String(b.target || '')
    const caller = { email: me.email, name: me.name, via: 'hub' as const }
    if (t === 'client') { const cc = await clientContact(); return json(await ghlCallBridge(sb, ghl, settings, caller, { axiscareClientId: c.client_axiscare_id, phone: cc.phone, email: cc.email, label: firstOf(c.client) })) }
    if (t === 'caller') { const g = (await roster()).find((x) => String(x?.axiscare_id ?? '') === String(c.calling_off_id ?? ''))
      return json(await ghlCallBridge(sb, ghl, settings, caller, { phone: normalisePhone(g?.phone), email: g?.email, label: firstOf(c.calling_off) })) }
    const a = asked.find((x) => String(x.id) === t)
    if (!a) return json({ error: 'Call whom?' }, 400)
    return json(await ghlCallBridge(sb, ghl, settings, caller, { phone: normalisePhone(a.phone), label: firstOf(a.name) }))
  }

  if (!open) return json({ ok: true, already: { how: c.resolved_how, covered_by: c.covered_by || null, by: c.confirmed_by || null } })

  if (action === 'claim') {
    const had = c.claimed_by && String(c.claimed_by).toLowerCase() !== me.email
    if (had && b.take_over !== true) return json({ ok: true, claimed_by_other: { by: c.claimed_by_name, at: chi12(c.claimed_at) } })
    const r = await patchCase(sb, caseId, { claimed_by: me.email, claimed_by_name: me.first, claimed_at: new Date().toISOString() }, { status: 'open' })
    if (r.outcome !== 'ok') return json({ ok: true, already: true })
    await opEvent(sb, { actor_name: me.name, actor_email: me.email, verb: 'coverage_claimed', item_id: caseId, area: 'coverage', summary: `${me.name} has the call-in: ${caseWhat(c)}` })
    const told = await tell(`${me.first} has the call-in for ${caseWhat(c)}${had ? ` (taking it over from ${c.claimed_by_name})` : ''}.`)
    return json({ ok: true, others_told: told.length })
  }

  if (action === 'confirm') {
    const who = String(b.covered_by || '').trim()
    if (!asked.some((a) => String(a.name || '').trim().toLowerCase() === who.toLowerCase())) return json({ error: 'Pick someone from the list.' }, 400)
    // deno-lint-ignore no-explicit-any
    const nc: any = b.not_chosen && typeof b.not_chosen === 'object' ? b.not_chosen : null
    const out = await confirmFill(sb, { caseId, coveredBy: who, byName: me.name,
      notChosen: nc?.silent === true ? { silent: true } : (typeof nc?.msg === 'string' && nc.msg.trim() ? { msg: nc.msg.trim() } : undefined) })
    if (out.outcome === 'already') return json({ ok: true, already: { how: out.resolved_how, covered_by: out.covered_by, by: out.confirmed_by } })
    if (out.outcome !== 'filled') return json({ error: 'Not saved; nothing changed. Try again, or use the board.' }, 409)
    await opEvent(sb, { actor_name: me.name, actor_email: me.email, verb: 'coverage_closed', item_id: caseId, area: 'coverage', summary: `${me.name} confirmed ${who} for ${caseWhat(c)} (from the call-in link)` })
    const told = await tell(filledLine(c, me.name, { covered_by: who }))
    return json({ ok: true, filled: { covered_by: who, axiscare: out.axiscare }, others_told: told.length })
  }

  if (action === 'close') {
    const how = String(b.how || '')
    if (!(how in CLOSE_HOW)) return json({ error: 'Pick how it was closed.' }, 400)
    const out = await closeCase(sb, { caseId, how: how as keyof typeof CLOSE_HOW, note: typeof b.note === 'string' ? b.note : '', byName: me.name })
    if (out.outcome === 'already') return json({ ok: true, already: { how: out.resolved_how, covered_by: out.covered_by, by: out.confirmed_by } })
    if (out.outcome !== 'closed') return json({ error: 'Not saved; nothing changed.' }, 409)
    await opEvent(sb, { actor_name: me.name, actor_email: me.email, verb: 'coverage_closed', item_id: caseId, area: 'coverage', summary: `${me.name} closed the call-in for ${caseWhat(c)}: ${CLOSE_HOW[how as keyof typeof CLOSE_HOW]} (from the call-in link)` })
    const told = await tell(filledLine(c, me.name, { how: CLOSE_HOW[how as keyof typeof CLOSE_HOW] }))
    return json({ ok: true, closed: CLOSE_HOW[how as keyof typeof CLOSE_HOW], others_told: told.length })
  }

  if (action === 'candidates') {
    const r = await engine({ action: 'candidates', case_id: caseId })
    if (!r.ok) return json({ error: r.j?.error || 'Could not get the list just now.' }, r.status === 409 ? 409 : 502)
    // deno-lint-ignore no-explicit-any
    /* the board's own facts per person: why they're on the list, working then (shown, never pre-ticked), the town */
    const pick = (arr: any) => (Array.isArray(arr) ? arr : []).map((x: any) => ({ name: String(x.name || ''), why: x.why ? String(x.why).slice(0, 120) : null,
      working_then: x.working_then?.detail ? String(x.working_then.detail).slice(0, 160) : null, town: x.city ? String(x.city) : null,
      miles: Number.isFinite(Number(x.miles)) ? Math.round(Number(x.miles)) : null }))
    return json({ ok: true, groups: [
      { key: 'prn', label: 'PRN Team who fit', people: pick(r.j.group0) },
      { key: 'g1', label: 'Worked with ' + (firstOf(c.client) || 'this client'), people: pick(r.j.group1) },
      { key: 'g2', label: 'Good matches', people: pick(r.j.group2) },
      { key: 'prn_other', label: 'PRN Team, outside their usual times', people: pick(r.j.prn_other) },
    ].filter((g) => g.people.length), send_live: settings.coverage_send_live === true })
  }

  if (action === 'ask') {
    const names = (Array.isArray(b.recipients) ? b.recipients : []).map((x) => String(x).slice(0, 80)).filter(Boolean).slice(0, 25)
    if (!names.length) return json({ error: 'Tick who to ask.' }, 400)
    const r = await engine({ action: 'send_selected', case_id: caseId, recipients: names, asked_by: me.name })
    if (!r.ok) return json({ error: r.j?.error || 'Could not send just now. Nothing was sent.' }, r.status === 409 ? 409 : 502)
    await opEvent(sb, { actor_name: me.name, actor_email: me.email, verb: 'coverage_asked', item_id: caseId, area: 'coverage', summary: `${me.name} asked ${(r.j.sent || []).length} caregiver(s) for ${caseWhat(c)} (from the call-in link)` })
    return json({ ok: true, sent: r.j.sent || [], failed: r.j.failed || [], already_asked: r.j.already_asked || [], not_eligible: r.j.refused_not_eligible || [] })
  }

  return json({ error: 'unknown action' }, 400)
})
