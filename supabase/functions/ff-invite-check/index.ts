// =============================================================================
// ff-invite-check · THE DAILY FRIENDS & FAMILY INVITE CHECK (Friends & Family Referral Program, step 3, 2026-10-27).
// Samantha 2026-10-27: "Yes, use this definition for the invitation check, including the 30-day wait after serious issues.
// Continue building step 3 with the switch off."
//
// Once a day it works out who WOULD get an invitation today (ff-invite-rules.ts has her rules) and keeps that list in
// ff_invite_runs, one row per day, kept 30 days. That is the two-week preview she asked for.
// STEP 4 (Samantha 2026-10-27: "I approve step 4 as recommended ... Leave office staff out of caregiver invitations. Build it."):
// once she turns on ops_settings.ff_invites_live (and the program isn't paused, ff_program_paused), the morning run also
// INVITES each ready person once, ever, in her approved words (ff-invite-send.ts): caregivers by text and email, families by
// email. Each gets their own link, made the first time (a Referral Partner record with program_track 'friends'). Weekdays
// 8 AM to 6 PM only, at most 60 a morning. A send that can't go raises a Needs Attention card and is not retried by itself.
// Owners (signed in to the Hub) can list, Skip, undo a Skip, Resend, and flip the two switches.
// STEP 5 (Samantha 2026-10-27: "Yes, start step 5: the $100 credit and bonus tracking, live as I decided."): every morning it also
// keeps the $100 lines (ff_rewards, ff-reward-rules.ts): each inquiry that came through a Friends & Family link and has had its
// first visit, its completed hours from AxisCare, the owner's "payment received" tick, and Ready / Under review. Owners approve,
// mark Not earned (with a reason), then Credit applied (family) or Paid (caregiver, the payroll date). Nothing pays by itself,
// and nothing here contacts anyone. Tracking runs whatever the Invitations switch says.
//
// It reads AxisCare (caregivers, clients, visits since Aug 1; GETs only) and the Hub (the roster, inquiries, Family
// Circles, client issues, cards, opt-outs, applications). If AxisCare or the complaint records can't be read, nobody is
// listed as ready that day and the run row says why (no silent failures).
//
// The daily run: only its schedule (the vault secret) or the owner's server key. ?dry=1 works it out without saving or sending.
// The owner actions: a signed-in Hub owner (owner_admin).
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jobCaller } from '../_shared/job-auth.ts'
import { readCensus } from '../_shared/axis-census.ts'
import { loadGuard, verdict } from '../_shared/audience-guard.ts'
import { loadQuiet, quietSet, isNotClient, isPracticeName } from '../_shared/client-quiet.ts'
import { testPerson } from '../_shared/test-people.ts'
import { isPlaceholderCaregiver } from '../_shared/cg-placeholder.ts'
import { practicePerson, practiceEmail, normPhone, normEmail } from '../_shared/optout.ts'
import * as R from '../_shared/ff-invite-rules.ts'
import * as X from '../_shared/ff-invite-send.ts'
import * as W from '../_shared/ff-reward-rules.ts'
import { axVisitsReader } from '../_shared/packet-visits.ts'
import { requireStaff } from '../_shared/staff-auth.ts'
import { contactForOutbound, maySend } from '../_shared/outreach.ts'
import { ghlSendChecked } from '../_shared/send-problems.ts'

// deno-lint-ignore no-explicit-any
type Any = any
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
/* the Hub's Friends & Family tab calls this from the browser (CORS from day one) */
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const S = (v: unknown) => String(v ?? '').trim()
const lc = (v: unknown) => S(v).toLowerCase()
const d10 = (v: unknown) => S(v).replace(/\D/g, '').slice(-10)
// deno-lint-ignore no-explicit-any
const rowsOf = (x: any): any[] => Array.isArray(x) ? x : (x && typeof x === 'object' ? Object.values(x) : [])
const key = async (k: string): Promise<Any> => { const { data, error } = await sb.from('app_data').select('data').eq('key', k).maybeSingle(); if (error) throw new Error(`couldn't read ${k}`); return data?.data ?? null }
const arr = (x: Any) => Array.isArray(x) ? x : []

/** every AxisCare visit from Aug 1 to today: per client the first completed visit, per caregiver whether they finished one */
async function visitFacts(today: string): Promise<{ ok: boolean; truncated: boolean; firstByClient: Map<string, string>; workedCg: Set<string>; error?: string }> {
  let token = ''
  for (const n of ['AXISCARE_VISITS_TOKEN', 'AXISCARE_API_KEY', 'AXISCARE_TOKEN']) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  const firstByClient = new Map<string, string>(), workedCg = new Set<string>()
  if (!token || !/^\d+$/.test(site)) return { ok: false, truncated: false, firstByClient, workedCg, error: 'AxisCare credentials are not set' }
  /* four weeks at a time, so no one request asks AxisCare for months of visits */
  const windows: Array<[string, string]> = []
  for (let from = R.VISITS_FROM; from <= today; from = R.addDays(from, 28)) { const to = R.addDays(from, 27); windows.push([from, to < today ? to : today]) }
  let url: string | null = null
  try {
    for (const [from, to] of windows) {
      url = `https://${site}.axiscare.com/api/visits?startDate=${from}&endDate=${to}`
      for (let page = 0; url && page < 60; page++) {
        let r: Response | null = null
        for (let i = 0; i < 3; i++) {
          r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-AxisCare-Api-Version': '2023-10-01' } })
          if (r.status === 429) { await new Promise((ok) => setTimeout(ok, 2000 * (i + 1))); continue }
          break
        }
        if (!r || !r.ok) return { ok: false, truncated: false, firstByClient, workedCg, error: `AxisCare's visit list answered ${r?.status ?? 'nothing'}` }
        const j: Any = await r.json().catch(() => ({}))
        for (const v of rowsOf(j?.results?.visits ?? j?.visits)) {
          if (!R.completed(v)) continue
          const day = R.dayOf(v?.clockIn?.time ?? v?.clockIn), cl = S(v?.client?.id), cg = S(v?.caregiver?.id)
          if (cl && day && (!firstByClient.has(cl) || day < firstByClient.get(cl)!)) firstByClient.set(cl, day)
          if (cg) workedCg.add(cg)
        }
        url = j?.results?.nextPage ?? j?.nextPage ?? null
      }
      if (url) break   // a window longer than this reads: said below as truncated
    }
  } catch (e) { return { ok: false, truncated: false, firstByClient, workedCg, error: 'AxisCare could not be reached: ' + String(e).slice(0, 120) } }
  return { ok: true, truncated: !!url, firstByClient, workedCg }
}

/** opt-outs for many addresses at once: the Hub's record and inquiries marked do-not-contact (GHL Do Not Disturb is checked
 *  when an invitation is actually sent, in step 4) */
async function optOuts(addresses: string[]): Promise<{ ok: boolean; out: Set<string> }> {
  const out = new Set<string>()
  const list = [...new Set(addresses.filter(Boolean))]
  try {
    for (let i = 0; i < list.length; i += 200) {
      const { data, error } = await sb.from('contact_optout_current').select('address, channel, opted_out').in('address', list.slice(i, i + 200))
      if (error) return { ok: false, out }
      for (const r of data ?? []) if (r.opted_out === true) out.add(`${r.channel}|${r.address}`)
    }
  } catch { return { ok: false, out } }
  return { ok: true, out }
}
const blocked = (o: Set<string>, ch: 'sms' | 'email', addr: string | null) => !!addr && (o.has(`${ch}|${addr}`) || o.has(`all|${addr}`))

async function check(today: string) {
  const st = (await key('ops_settings')) ?? {}
  const problems: string[] = []
  const [census, guard, visits] = await Promise.all([readCensus(), loadGuard(sb), visitFacts(today)])
  await loadQuiet(sb)   // paused and ended clients, and not-client records (Office Staff)
  if (!census.ok) problems.push('AxisCare caregivers: ' + census.error)
  if (!guard.axOk) problems.push("AxisCare clients couldn't be read")
  if (!visits.ok) problems.push(String(visits.error))
  if (visits.truncated) problems.push('the AxisCare visit list was longer than this check reads')
  const [roster, censusState, leads, items] = await Promise.all([key('caregivers'), key('caregiver_census_state'), key('leads'), key('ops_items')])
  const { data: journeys } = await sb.from('client_journey').select('lead_id, axiscare_client_id, status').eq('subject', 'client').not('lead_id', 'is', null)

  /* complaints and service concerns (fail closed: unreadable = every family held today) */
  const since = R.addDays(today, -R.WAIT_DAYS)
  let concerns: R.Concerns | null = null
  try {
    const [iss, cats] = await Promise.all([
      sb.from('client_issue').select('id, category, state, axiscare_client_id, client_name_free_text, reported_at, resolved_at')   /* the issue table has reported_at, no created_at (1141 found it) */
        .or(`state.not.in.(${R.CLOSED_STATES.join(',')}),resolved_at.gte.${since}`),
      sb.from('issue_category').select('code, label')])
    if (iss.error || cats.error) throw new Error('read')
    const labels = Object.fromEntries((cats.data ?? []).map((c: Any) => [c.code, c.label]))
    concerns = R.concernsOf(iss.data ?? [], arr(items), labels, today)
  } catch { problems.push("the client issues couldn't be read, so no family is listed as ready") }

  const rows: R.Row[] = []
  const notInvited: Record<string, number> = {}
  /* where each ready person is reached: kept in memory for this run's sends, never saved */
  const addr = new Map<string, { phone?: string; email?: string; first: string; isClient?: boolean; client?: string }>()

  /* ── caregivers ── */
  if (census.ok && visits.ok && !visits.truncated) {
    const reAt = new Map<string, string>()
    for (const o of arr(censusState)) if (o?.kind === 'reactivated' && o.axiscare_id) { const k = S(o.axiscare_id); if (!reAt.has(k) || S(o.observed_at) > reAt.get(k)!) reAt.set(k, S(o.observed_at)) }
    const rec = new Map<string, Any>(); for (const c of arr(roster)) if (c?.axiscare_id) rec.set(S(c.axiscare_id), c)
    /* office staff who are also AxisCare caregivers are not invited (her rule 2026-10-27); unreadable = nobody ready */
    let isStaff: (g: Any) => boolean = () => false
    try {
      const { data: sr, error: e1 } = await sb.from('staff_roles').select('person_id').eq('entity', 'cc_ihs')
      if (e1) throw e1
      const ids = [...new Set((sr ?? []).map((r: Any) => r.person_id))]
      const { data: ps, error: e2 } = ids.length ? await sb.from('persons').select('person_id, full_name, primary_email, active').in('person_id', ids) : { data: [], error: null }
      if (e2) throw e2
      isStaff = X.staffMatcher((ps ?? []).filter((x: Any) => x.active !== false))
    } catch { problems.push("the office staff list couldn't be read, so no caregiver is listed as ready"); isStaff = () => true }
    const cgs = census.rows.filter((g) => g.active && !isPlaceholderCaregiver(g.first, g.last) && !practicePerson(g.phone, g.email) && !testPerson(st, { phone: g.phone, email: g.email }) && !isStaff(g))   /* "Canceled Shift" is nobody (1141 listed it) */
    const opt = await optOuts(cgs.flatMap((g) => [normPhone(g.phone), normEmail(g.email)].filter(Boolean) as string[]))
    if (!opt.ok) problems.push("the opt-out record couldn't be read, so no caregiver is listed as ready")
    /* their latest application's yes or no to texts (no application on file is not a no) */
    const { data: apps, error: appErr } = await sb.from('job_applicants').select('phone, sms_consent, created_at').order('created_at', { ascending: false }).limit(5000)
    const noText = new Set<string>(), seenPh = new Set<string>()
    for (const a of apps ?? []) { const p = d10(a.phone); if (p.length !== 10 || seenPh.has(p)) continue; seenPh.add(p); if (a.sms_consent === false) noText.add(p) }
    for (const g of cgs) {
      const since_ = R.activeSince(g, reAt.get(g.id), rec.get(g.id)?.approved_to_work_at)
      const row = R.caregiverRow(g, { since: since_, worked: visits.workedCg.has(g.id), textOk: !appErr && !noText.has(d10(g.phone)),
        textOut: blocked(opt.out, 'sms', normPhone(g.phone)), emailOut: blocked(opt.out, 'email', normEmail(g.email)), today })
      if (!opt.ok && row.status === 'ready') { row.status = 'held'; row.why.push("Couldn't check opt-outs") }
      rows.push(row)
      addr.set(row.key, { phone: row.channels.includes('text') ? g.phone : '', email: row.channels.includes('email') ? g.email : '', first: S(g.goes_by) || S(g.first) || 'there' })
    }
  }

  /* ── clients and families ── */
  if (guard.axOk && visits.ok && !visits.truncated) {
    const active = guard.axClients.filter((c: Any) => c?.id != null && !isNotClient(S(c.id)) && !isPracticeName(c) && c?.status?.active === true)
    const quiet = quietSet()   // an open pause, or care ended in the Hub
    const leadOf = new Map<string, Any>()
    const jl = new Map<string, string>(); for (const j of journeys ?? []) if (j.axiscare_client_id) jl.set(S(j.lead_id), S(j.axiscare_client_id))
    for (const l of arr(leads)) {
      if (!l || l.archived || (l.spam && l.spam.at)) continue
      const ax = S(l.axiscare_client_id) || jl.get(S(l.id)) || ''
      if (!ax) continue
      const have = leadOf.get(ax)
      if (!have || S(l.first_shift_at || l.said_yes_at || l.created_at) > S(have.first_shift_at || have.said_yes_at || have.created_at)) leadOf.set(ax, l)   /* the newest inquiry speaks for a returning client */
    }
    const { data: circles, error: cErr } = await sb.from('care_circles').select('id, client_name, axiscare_client_id, active')
    const { data: contacts, error: kErr } = await sb.from('circle_contacts').select('id, circle_id, name, email, relationship, hipaa_authorized, hipaa_office_ok_at, stopped_at, axiscare_removed_at').not('email', 'is', null)
    if (cErr || kErr) problems.push("the Family Circles couldn't be read, so no family is listed")
    const people = (contacts ?? []).filter((p: Any) => normEmail(p.email) && !p.stopped_at && !p.axiscare_removed_at && !practiceEmail(p.email) && !testPerson(st, { email: p.email }))
    const opt = await optOuts(people.map((p: Any) => normEmail(p.email)!))
    if (!opt.ok) problems.push("the opt-out record couldn't be read, so no family is listed as ready")
    const dnc = new Set(arr(leads).filter((l: Any) => l?.do_not_contact === true).map((l: Any) => normEmail(l.email)).filter(Boolean))
    const fam: R.Row[] = []
    for (const c of active) {
      const ax = S(c.id)
      if (quiet.has(ax)) continue
      const name = [S(c.goesBy) || S(c.firstName), S(c.lastName)].filter(Boolean).join(' ') || `AxisCare client #${ax}`
      const l = leadOf.get(ax)
      const firstVisit = R.dayOf(l?.first_shift_at) || visits.firstByClient.get(ax) || ''
      const pay = R.payerOf(l?.funding_source, c.classes)
      const cons = concerns ? R.concernsFor(concerns, ax, [name, [S(c.firstName), S(c.lastName)].join(' ')]) : ["Couldn't check for open complaints"]
      const f = R.clientFacts({ firstVisit, payer: pay, concerns: cons, today })
      if (f.status === 'not_invited') { const w = f.why[0]; notInvited[w] = (notInvited[w] || 0) + 1; continue }
      const circleIds = new Set((circles ?? []).filter((k: Any) => S(k.axiscare_client_id) === ax && k.active !== false).map((k: Any) => S(k.id)))
      const mine = people.filter((p: Any) => circleIds.has(S(p.circle_id)))
      const client = { name, ax, status: f.status, why: f.why, ready_on: f.ready_on, payer: pay.payer ? R.PAYER_WORDS[pay.payer] : undefined, note: f.note }
      if (!mine.length) {
        rows.push({ kind: 'client', key: 'cl_' + ax, name, client: name, client_ax: ax, status: 'held', why: ['No family email on file', ...f.why], channels: [],
          ...(f.ready_on ? { ready_on: f.ready_on } : {}), ...(client.payer ? { payer: client.payer } : {}) })
        continue
      }
      for (const p of mine) {
        const e = normEmail(p.email)!
        const v = verdict(guard.stateOf(e), 'client-contact')
        const r = R.familyRow(p, client, { emailOut: blocked(opt.out, 'email', e) || dnc.has(e), tie: v.ok ? null : String(v.why) })
        if (!opt.ok && r.status === 'ready') { r.status = 'held'; r.why.push("Couldn't check opt-outs"); r.channels = [] }
        fam.push(r)
        addr.set(r.key, { email: e, first: X.firstOf(p.name), isClient: lc(p.relationship) === 'client', client: name })
      }
    }
    rows.push(...R.mergeFamily(fam))
  }
  /* what was already sent or skipped (one invitation per person, ever) */
  const { data: inv, error: invErr } = await sb.from('ff_invites').select('person_key, status, first_sent_at, last_sent_at, skipped_by, skip_why')
  if (invErr) problems.push("the invitation record couldn't be read, so nobody is invited today")
  const invOf = new Map<string, Any>((inv ?? []).map((x: Any) => [S(x.person_key), x]))
  for (const r of rows) {
    const x = invOf.get(r.key)
    if (!x) continue
    if (x.status === 'skipped') { r.status = 'held'; r.why = [`Skipped${x.skip_why ? ': ' + S(x.skip_why) : ''}${x.skipped_by ? ` (${S(x.skipped_by)})` : ''}`, ...r.why]; r.channels = [] }
    else (r as Any).invited = { status: x.status, at: x.last_sent_at || x.first_sent_at }
  }
  return { live: st.ff_invites_live === true, paused: st.ff_program_paused === true, problems, rows, summary: R.summary(rows, notInvited), addr, invOk: !invErr, invOf }
}

/* ── sending one invitation (her approved words) ── */
async function sendOne(row: R.Row, a: { phone?: string; email?: string; first: string; isClient?: boolean; client?: string }, orgs: Any[], by: string) {
  const at = new Date().toISOString()
  /* their own link, made once */
  let org = orgs.find((o) => o && S(o.ff_key) === row.key && !o.archived)
  if (!org) {
    const code = X.newCode(row.name, orgs)
    if (!code) return { ok: false, why: "couldn't make a personal code" }
    org = X.participantOrg(row, code, at)
    const { error } = await sb.rpc('upsert_app_data_item', { target_key: 'referral_orgs', item: org })
    if (error) return { ok: false, why: "couldn't save their personal link" }
    orgs.push(org)
  }
  const code = X.normalCode(org.partner_code)
  const ghl = { token: Deno.env.get('GHL_TOKEN') || Deno.env.get('GHL_API_KEY') || '', locationId: Deno.env.get('GHL_LOCATION_ID') || '' }
  const H = { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' }
  const audience = row.kind === 'caregiver' ? 'caregiver' as const : 'family' as const
  const results: Array<{ channel: string; ok: boolean; why?: string }> = []
  for (const ch of row.channels) {
    let why = ''
    const sms = ch === 'text'
    const c = ghl.token && ghl.locationId ? await contactForOutbound(sb, ghl, sms ? { phone: a.phone, firstName: a.first } : { email: a.email, firstName: a.first }, 'proactive_external',
      { audience, explicitlyEnabled: true, channel: sms ? 'sms' : 'email', sender: 'ff-invite-check', onOptOut: (r) => { why = (sms ? 'opted out of texts' : 'opted out of email') + ' (' + r.join(', ') + ')' } }) : null
    if (!c) { results.push({ channel: ch, ok: false, why: why || (ghl.token ? 'not allowed to go to this address right now' : 'GoHighLevel is not set up on the server') }); continue }
    const body = sms ? { message: X.caregiverText(a.first, code) }
      : row.kind === 'caregiver' ? X.caregiverEmail(a.first, code) : X.familyEmail(a.first, code, X.invoiceWords(!!a.isClient, a.client || ''))
    const okSend = await ghlSendChecked(sb, H, 'ff-invite-check', { channel: sms ? 'sms' : 'email', contactId: c.contactId, address: sms ? a.phone : a.email, who: row.name }, body)
    results.push({ channel: ch, ok: okSend, ...(okSend ? {} : { why: 'GoHighLevel did not take it' }) })
  }
  const good = results.filter((x) => x.ok).length
  const status = !results.length ? 'failed' : good === results.length ? 'sent' : good ? 'partial' : 'failed'
  const { data: prev } = await sb.from('ff_invites').select('first_sent_at, sends').eq('person_key', row.key).maybeSingle()
  await sb.from('ff_invites').upsert({ person_key: row.key, kind: row.kind, name: row.name, client_name: row.client ?? null, client_ax: row.client_ax ?? null,
    org_id: org.id, code, status, channels: results, first_sent_at: good ? (prev?.first_sent_at ?? at) : (prev?.first_sent_at ?? null), last_sent_at: at,
    sends: Number(prev?.sends ?? 0) + 1, sent_by: by, updated_at: at, skipped_at: null, skipped_by: null, skip_why: null }, { onConflict: 'person_key' })
  return { ok: good > 0, status, results, code }
}

/* ── the owner's two switches, kept in ops_settings with who and when ── */
async function setSwitch(name: string, on: boolean, who: string) {
  const { data: row, error } = await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
  if (error || !row?.data || typeof row.data !== 'object') return "couldn't read the settings"
  const cur = row.data
  cur[name] = on
  cur.ff_switch_log = [...arr(cur.ff_switch_log), { at: new Date().toISOString(), by: who, name, on }].slice(-30)
  const { error: e2 } = await sb.from('app_data').update({ data: cur }).eq('key', 'ops_settings')
  return e2 ? "couldn't save the settings" : ''
}
const strip = (out: Any) => { const { addr: _a, invOf: _i, invOk: _o, ...rest } = out; return rest }

/* ── the $100 lines (step 5) ── */
async function rewardSweep(today: string, ax = axVisitsReader()): Promise<{ lines: number; created: number; ready: number; problems: string[] }> {
  const res = { lines: 0, created: 0, ready: 0, problems: [] as string[] }
  const at = new Date().toISOString()
  const [leads, orgs] = await Promise.all([key('leads'), key('referral_orgs')])
  const { data: js } = await sb.from('client_journey').select('lead_id, axiscare_client_id').eq('subject', 'client').not('lead_id', 'is', null)
  const axOfLead = new Map<string, string>((js ?? []).filter((j: Any) => j.axiscare_client_id).map((j: Any) => [S(j.lead_id), S(j.axiscare_client_id)]))
  const { data: rows, error } = await sb.from('ff_rewards').select('lead_id, line, created_at')
  if (error) { res.problems.push("the reward record couldn't be read, so no reward line was checked"); return res }
  const have = new Map<string, Any>((rows ?? []).map((r: Any) => [S(r.lead_id), r.line]))
  const pairs = W.referred(arr(leads), arr(orgs))
  for (const { lead, org } of pairs) {
    const axId = S(lead.axiscare_client_id) || axOfLead.get(S(lead.id)) || ''
    let line = have.get(S(lead.id))
    if (!line) { line = W.newLine(lead, org, axId, at); res.created++ }
    else if (axId && !line.client_ax) line = { ...line, client_ax: axId }
    if (['not_earned', 'applied', 'paid'].includes(line.status)) { have.set(S(lead.id), line); continue }
    let hours: number | null = null, prior: boolean | null = null
    const vs = /^\d+$/.test(axId) ? await ax(axId, R.VISITS_FROM, today) : null
    if (vs == null) res.problems.push(`${line.client_name}: AxisCare visits couldn't be read`)
    else { hours = W.hoursFrom(vs, line.first_visit); prior = W.completedFrom(vs, R.VISITS_FROM, line.first_visit).length > 0 }
    const other = [...have.values()].some((x: Any) => x && S(x.lead_id) !== S(lead.id) && x.client_ax && S(x.client_ax) === S(axId) && S(x.created_at) <= S(line.created_at) && x.status !== 'not_earned')
    const next = W.evaluate(line, { today, hours, reasons: W.reviewReasons(line, { lead, org, prior, otherLineForClient: other }) })
    if (next.status !== line.status) next.history = [...arr(line.history), { at, by: 'automatic', action: 'checked', from: line.status, to: next.status, why: (next.reasons || []).join('; ') || (next.status === 'ready' ? '20 hours and payment received' : '') }].slice(-40)
    have.set(S(lead.id), next)
    if (JSON.stringify(next) !== JSON.stringify(line) || !rows?.some((r: Any) => S(r.lead_id) === S(lead.id))) {
      const { error: e2 } = await sb.from('ff_rewards').upsert({ lead_id: S(lead.id), status: next.status, line: next, updated_at: at }, { onConflict: 'lead_id' })
      if (e2) res.problems.push(`${line.client_name}: the reward line couldn't be saved`)
    }
  }
  res.lines = have.size; res.ready = [...have.values()].filter((x: Any) => x.status === 'ready').length
  return res
}

async function saveRun(today: string, at: string, out: Any, sent: number) {
  const { error } = await sb.from('ff_invite_runs').upsert({ run_day: today, ran_at: at, ok: out.problems.length === 0, problems: out.problems, live: out.live, summary: out.summary, people: out.rows, sent }, { onConflict: 'run_day' })
  await sb.from('ff_invite_runs').delete().lt('run_day', R.addDays(today, -30))
  return error
}

/* the owner actions from the Hub's Friends & Family tab */
async function ownerAction(req: Request, me: { email: string; name: string }) {
  const b: Any = await req.json().catch(() => ({}))
  const action = S(b.action), today = R.dayOf(new Date().toISOString())
  if (action === 'list') {
    const st = (await key('ops_settings')) ?? {}
    const { data: runs } = await sb.from('ff_invite_runs').select('run_day, ran_at, ok, problems, live, summary, people, sent').order('run_day', { ascending: false }).limit(1)
    const { data: inv } = await sb.from('ff_invites').select('person_key, kind, name, client_name, code, status, channels, first_sent_at, last_sent_at, sends, sent_by, skipped_at, skipped_by, skip_why').order('updated_at', { ascending: false }).limit(1000)
    const { data: rw } = await sb.from('ff_rewards').select('lead_id, status, line, updated_at').order('updated_at', { ascending: false }).limit(500)
    const rewards = (rw ?? []).map((r: Any) => ({ ...r.line, words: W.progressWords(r.line) }))
    return json({ ok: true, run: runs?.[0] ?? null, invites: inv ?? [], rewards, amount: W.AMOUNT, min_hours: W.MIN_HOURS, switches: { live: st.ff_invites_live === true, paused: st.ff_program_paused === true, log: arr(st.ff_switch_log).slice(-5) }, cap: X.DAILY_CAP })
  }
  if (action === 'switch') {
    const name = S(b.name)
    if (!['ff_invites_live', 'ff_program_paused'].includes(name) || typeof b.on !== 'boolean') return json({ error: 'Unknown switch.' }, 400)
    const err = await setSwitch(name, b.on, me.name || me.email)
    return err ? json({ error: 'The switch was not changed: ' + err + '.' }, 500) : json({ ok: true, name, on: b.on })
  }
  if (action === 'reward') {
    const lid = S(b.lead_id)
    const { data: row } = await sb.from('ff_rewards').select('lead_id, line').eq('lead_id', lid).maybeSingle()
    if (!row) return json({ error: 'That reward line was not found.' }, 404)
    const r = W.act(row.line, S(b.op), me, b, new Date().toISOString())
    if (r.error) return json({ error: r.error }, 409)
    let next = r.line
    if (S(b.op) === 'payment' || S(b.op) === 'reopen') next = W.evaluate(next, { today, hours: null, reasons: next.reasons || [] })
    const { error } = await sb.from('ff_rewards').update({ status: next.status, line: next, updated_at: new Date().toISOString() }).eq('lead_id', lid)
    return error ? json({ error: "The change wasn't saved." }, 500) : json({ ok: true, line: { ...next, words: W.progressWords(next) } })
  }
  const pk = S(b.key)
  if (!/^(cg|fam)_[\w.@-]+$/.test(pk)) return json({ error: 'Which person?' }, 400)
  if (action === 'skip') {
    const why = S(b.why).slice(0, 200)
    if (!why) return json({ error: 'Say why, so the next person knows.' }, 400)
    const { error } = await sb.from('ff_invites').upsert({ person_key: pk, kind: pk.startsWith('cg_') ? 'caregiver' : 'family', name: S(b.name).slice(0, 120) || pk, status: 'skipped',
      skipped_at: new Date().toISOString(), skipped_by: me.name || me.email, skip_why: why, updated_at: new Date().toISOString() }, { onConflict: 'person_key' })
    return error ? json({ error: "The skip wasn't saved." }, 500) : json({ ok: true })
  }
  if (action === 'unskip') {
    const { data: x } = await sb.from('ff_invites').select('person_key, first_sent_at').eq('person_key', pk).maybeSingle()
    if (!x) return json({ ok: true })
    const { error } = x.first_sent_at
      ? await sb.from('ff_invites').update({ status: 'sent', skipped_at: null, skipped_by: null, skip_why: null, updated_at: new Date().toISOString() }).eq('person_key', pk)
      : await sb.from('ff_invites').delete().eq('person_key', pk)
    return error ? json({ error: "The skip wasn't undone." }, 500) : json({ ok: true })
  }
  if (action === 'resend') {
    const st = (await key('ops_settings')) ?? {}
    if (st.ff_invites_live !== true) return json({ error: 'Invitations are off. Turn them on first.' }, 409)
    if (st.ff_program_paused === true) return json({ error: 'The program is paused.' }, 409)
    const when = maySend('proactive_external')
    if (!when.allowed) return json({ error: 'Invitations go out on weekdays, 8 AM to 6 PM. Try again then.' }, 409)
    const out = await check(today)
    const row = out.rows.find((r: R.Row) => r.key === pk)
    if (!row || row.status !== 'ready') return json({ error: row ? `Not sent: ${row.why.join('; ') || 'not ready'}.` : 'They are not on today\'s list.' }, 409)
    const orgs = arr(await key('referral_orgs'))
    const r = await sendOne(row, out.addr.get(pk)!, orgs, me.name || me.email)
    return json({ ok: r.ok, ...r }, r.ok ? 200 : 502)
  }
  return json({ error: 'Unknown action.' }, 400)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })
  const caller = await jobCaller(req)
  if (!caller) {
    const who = await requireStaff(sb, req, ['owner_admin'])
    if (!who.ok) return json({ error: who.error === 'Sign in first.' ? 'not allowed' : who.error }, who.status === 403 ? 403 : 401)
    return await ownerAction(req, who)
  }
  const url = new URL(req.url)
  if (url.searchParams.get('auth_check') === '1') return json({ ok: true, caller })
  const dry = url.searchParams.get('dry') === '1'
  const today = R.dayOf(new Date().toISOString()), at = new Date().toISOString()
  let out: Any
  try { out = await check(today) }
  catch (e) { out = { live: false, paused: false, problems: ['the check stopped: ' + String((e as Error)?.message ?? e).slice(0, 160)], rows: [], summary: null, addr: new Map(), invOk: false } }
  /* the invitations: her switch on, not paused, the record readable, weekdays 8 to 6, each ready person once, 60 at most */
  let sent = 0
  const sentTo: Any[] = [], held: string[] = []
  if (!dry && out.live && !out.paused && out.invOk) {
    if (!maySend('proactive_external').allowed) held.push('outside the sending hours (weekdays 8 AM to 6 PM): invitations wait for the next weekday morning')
    else {
      const orgs = arr(await key('referral_orgs').catch(() => null))
      const due = out.rows.filter((r: R.Row) => r.status === 'ready' && r.kind !== 'client' && !(r as Any).invited && out.addr.has(r.key))
      for (const r of due.slice(0, X.DAILY_CAP)) {
        const res = await sendOne(r, out.addr.get(r.key), orgs, 'automatic')
        if (res.ok) sent++
        sentTo.push({ name: r.name, kind: r.kind, status: res.status ?? 'failed', ...(res.ok ? {} : { why: (res as Any).why ?? (res.results ?? []).map((x: Any) => x.why).filter(Boolean).join('; ') }) })
        ;(r as Any).invited = { status: res.status ?? 'failed', at: new Date().toISOString() }
      }
      if (due.length > X.DAILY_CAP) held.push(`${due.length - X.DAILY_CAP} more are ready; they go tomorrow morning (60 a morning at most)`)
    }
  }
  /* the $100 lines: tracked every morning, whatever the Invitations switch says (her decision: live) */
  let rewards: Any = null
  if (!dry) { try { rewards = await rewardSweep(today) } catch (e) { rewards = { problems: ['the reward check stopped: ' + String((e as Error)?.message ?? e).slice(0, 120)] } } }
  if (rewards?.problems?.length) out.problems.push(...rewards.problems)
  const rest = strip(out)
  if (!dry) {
    const error = await saveRun(today, at, out, sent)
    if (error) return json({ ok: false, saved: false, error: "the list couldn't be saved: " + error.message, sent, sent_to: sentTo, ...rest }, 500)
  }
  return json({ ok: out.problems.length === 0, saved: !dry, day: today, sent, sent_to: sentTo, held, rewards, ...rest })
})
