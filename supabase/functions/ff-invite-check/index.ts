// =============================================================================
// ff-invite-check · THE DAILY FRIENDS & FAMILY INVITE CHECK (Friends & Family Referral Program, step 3, 2026-10-27).
// Samantha 2026-10-27: "Yes, use this definition for the invitation check, including the 30-day wait after serious issues.
// Continue building step 3 with the switch off."
//
// Once a day it works out who WOULD get an invitation today (ff-invite-rules.ts has her rules) and keeps that list in
// ff_invite_runs, one row per day, kept 30 days. That is the two-week preview she asked for. It sends nothing: no text, no
// email, no card, no task. The sending part comes with step 4 (the wording and the Friends & Family tab), and even then
// only once she turns on ops_settings.ff_invites_live, which this step adds OFF.
//
// It reads AxisCare (caregivers, clients, visits since Aug 1; GETs only) and the Hub (the roster, inquiries, Family
// Circles, client issues, cards, opt-outs, applications). If AxisCare or the complaint records can't be read, nobody is
// listed as ready that day and the run row says why (no silent failures).
//
// Only its schedule (the vault secret) or the owner's server key may run it. ?dry=1 works it out without saving.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jobCaller } from '../_shared/job-auth.ts'
import { readCensus } from '../_shared/axis-census.ts'
import { loadGuard, verdict } from '../_shared/audience-guard.ts'
import { loadQuiet, quietSet, isNotClient, isPracticeName } from '../_shared/client-quiet.ts'
import { testPerson } from '../_shared/test-people.ts'
import { practicePerson, practiceEmail, normPhone, normEmail } from '../_shared/optout.ts'
import * as R from '../_shared/ff-invite-rules.ts'

// deno-lint-ignore no-explicit-any
type Any = any
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
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
  let url: string | null = `https://${site}.axiscare.com/api/visits?startDate=${R.VISITS_FROM}&endDate=${today}`
  try {
    for (let page = 0; url && page < 120; page++) {
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
      sb.from('client_issue').select('id, category, state, axiscare_client_id, client_name_free_text, reported_at, created_at, resolved_at')
        .or(`state.not.in.(${R.CLOSED_STATES.join(',')}),resolved_at.gte.${since}`),
      sb.from('issue_category').select('code, label')])
    if (iss.error || cats.error) throw new Error('read')
    const labels = Object.fromEntries((cats.data ?? []).map((c: Any) => [c.code, c.label]))
    concerns = R.concernsOf(iss.data ?? [], arr(items), labels, today)
  } catch { problems.push("the client issues couldn't be read, so no family is listed as ready") }

  const rows: R.Row[] = []
  const notInvited: Record<string, number> = {}

  /* ── caregivers ── */
  if (census.ok && visits.ok && !visits.truncated) {
    const reAt = new Map<string, string>()
    for (const o of arr(censusState)) if (o?.kind === 'reactivated' && o.axiscare_id) { const k = S(o.axiscare_id); if (!reAt.has(k) || S(o.observed_at) > reAt.get(k)!) reAt.set(k, S(o.observed_at)) }
    const rec = new Map<string, Any>(); for (const c of arr(roster)) if (c?.axiscare_id) rec.set(S(c.axiscare_id), c)
    const cgs = census.rows.filter((g) => g.active && !practicePerson(g.phone, g.email) && !testPerson(st, { phone: g.phone, email: g.email }))
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
      }
    }
    rows.push(...R.mergeFamily(fam))
  }
  return { live: st.ff_invites_live === true, problems, rows, summary: R.summary(rows, notInvited) }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok')
  const caller = await jobCaller(req)
  if (!caller) return json({ error: 'not allowed' }, 401)
  const url = new URL(req.url)
  if (url.searchParams.get('auth_check') === '1') return json({ ok: true, caller })
  const dry = url.searchParams.get('dry') === '1'
  const today = R.dayOf(new Date().toISOString()), at = new Date().toISOString()
  let out: Any
  try { out = await check(today) }
  catch (e) { out = { live: false, problems: ['the check stopped: ' + String((e as Error)?.message ?? e).slice(0, 160)], rows: [], summary: null } }
  const ok = out.problems.length === 0
  if (!dry) {
    const { error } = await sb.from('ff_invite_runs').upsert({ run_day: today, ran_at: at, ok, problems: out.problems, live: out.live, summary: out.summary, people: out.rows, sent: 0 }, { onConflict: 'run_day' })
    await sb.from('ff_invite_runs').delete().lt('run_day', R.addDays(today, -30))
    if (error) return json({ ok: false, saved: false, error: "the list couldn't be saved: " + error.message, ...out }, 500)
  }
  /* Step 3 sends nothing, switch or no switch: the sending part comes with step 4 */
  return json({ ok, saved: !dry, day: today, sent: 0, ...out })
})
