// Supabase Edge Function: ghe-reminders  (shared hub project)
// -----------------------------------------------------------------------------
// GHE months are assigned by the state months in advance, which means a missed
// one is never a surprise — it is only ever something nobody was reminded about.
//
// Runs daily (weekdays 8am-6pm Central; the cron knocks once a day).
//
// 1. THE DIGEST (unchanged): Mondays, the 1st and the 20th.
//      To each nurse   → the GHEs on her own caseload due this month
//      To the office   → anything overdue, plus GHEs signed but not yet uploaded into Fusion
//
// 2. THE AXISCARE WATCH (GHE fix slice 3, Samantha 2026-10-08): the nurse calls the client, agrees a time and BOOKS
//    THE GHE IN AXISCARE (service T1001). Every run reads each GHE month's T1001 visits for last month, this month
//    and next month (ghe-rules.js decides) and keeps what it saw under app_data 'ghe_watch' for the Hub to show.
//    With ops_settings.ghe_watch_live on, the oversight ladder (Medicaid coordinator = owner of Payer Programs):
//      · not booked by the 10th  → one email to the nurse and the coordinator
//      · not booked by the 20th  → a Needs Attention card for the coordinator (closes itself once it's booked)
//      · last week, not booked   → one email to Samantha
//      · the month over, no visit → a Missed GHE card that only a person clears, with a reason and a next step
//    Switched off, it reads and records only: no card, no email. Nobody outside the office is ever contacted.
//
// Reads the CC Hub's nursing data from app_data with the service role and mails
// through GoHighLevel, the same path the 7 AM lead digest already uses.
// Fired by pg_cron 'daily-ghe-reminders'.
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { outreachGate } from '../_shared/outreach.ts'
import { jobCaller } from '../_shared/job-auth.ts'
import { ghlSendChecked, reportSendProblem } from '../_shared/send-problems.ts'
import { ghlStaffContact } from '../_shared/staff-contact.ts'
import '../_shared/ghe-rules.js'
// deno-lint-ignore no-explicit-any
const G: any = (globalThis as any).GheRules
// deno-lint-ignore no-explicit-any
type Any = any

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const esc = (t: string) =>
  String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const OWNER = 'samantha@mo-care.com'

/* HEARTBEAT: one replaced row under app_data 'automation_heartbeats' (fixed
   id, never grows). A quiet day still beats; a run that never happened has no
   beat — automation-watchdog reads these every morning. Inlined so a
   dashboard paste-deploy stays one file. */
async function beat(supabase: Any, ok: boolean, note: string) {
  try {
    await supabase.rpc('upsert_app_data_item', {
      target_key: 'automation_heartbeats',
      item: { id: 'hb_ghe-reminders', automation: 'ghe-reminders',
              at: new Date().toISOString(), ok, note: String(note).slice(0, 300) },
    })
  } catch (e) { console.error('[ghe-reminders] heartbeat failed', e) }
}

/* AxisCare, read only: the visits of one client between two dates (paged, throttled, one retry on 429) */
export function axFetcher(fetchImpl: typeof fetch = fetch) {
  let token = ''
  for (const n of ['AXISCARE_API_KEY', 'AXISCARE_TOKEN']) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  const get = async (path: string) => {
    if (!token || !/^\d+$/.test(site)) return null
    for (let i = 0; i < 2; i++) {
      try {
        const r = await fetchImpl(`https://${site}.axiscare.com${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-AxisCare-Api-Version': '2023-10-01' } })
        if (r.status === 429 && i === 0) { await new Promise((ok) => setTimeout(ok, 1500)); continue }
        return { status: r.status, json: await r.json().catch(() => ({})) }
      } catch { return null }
    }
    return null
  }
  return async (ax: string, from: string, to: string): Promise<Any[] | null> => {
    const out: Any[] = []
    let path: string | null = `/api/visits?clientIds=${encodeURIComponent(ax)}&startDate=${from}&endDate=${to}`
    for (let page = 0; path && page < 6; page++) {
      const r = await get(path); if (!r || r.status !== 200) return null
      const vs = r.json?.results?.visits ?? r.json?.visits ?? []
      out.push(...(Array.isArray(vs) ? vs : Object.values(vs)))
      const nx = r.json?.results?.nextPage ?? r.json?.nextPage ?? null
      path = nx ? String(nx).replace(/^https?:\/\/[^/]+/, '') : null
    }
    return out
  }
}

/* the Medicaid coordinator: the person who owns Payer Programs (the Hub's Who owns what), else Samantha */
async function coordinatorOf(supabase: Any): Promise<{ email: string; why: string }> {
  try {
    const { data: dom } = await supabase.from('domains').select('code, owner_person, entity').eq('code', 'payer_programs').eq('entity', 'cc_ihs').maybeSingle()
    if (dom?.owner_person) {
      const { data: p } = await supabase.from('persons').select('person_id, primary_email').eq('person_id', dom.owner_person).maybeSingle()
      if (p?.primary_email) return { email: String(p.primary_email).toLowerCase(), why: 'owner of Payer Programs' }
    }
  } catch { /* fall through */ }
  return { email: OWNER, why: 'nobody owns Payer Programs yet, so Samantha' }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  /* J1 (2026-09-29): only its daily schedule or the owner's server key. Everyone else, the public key included, is refused
     before anything is read or sent. */
  const caller = await jobCaller(req)
  if (!caller) return json({ error: 'not allowed' }, 401)
  if (new URL(req.url).searchParams.get('auth_check') === '1') return json({ ok: true, caller })
  /* proactive_external: we start this, so weekdays only, 8am-6pm.
     Policy lives in _shared/outreach.ts. Its practice run (dry=1) really sends nothing, so it may look at any hour. */
  const gate = outreachGate(req, 'proactive_external', json, { practiceRun: true })
  if (gate) return gate

  const url = new URL(req.url)
  const force = url.searchParams.get('force') === '1'   // for a manual check
  const dry = url.searchParams.get('dry') === '1'       // report, send nothing, write nothing

  // Central time, because "the 1st" should mean the 1st in Springfield.
  const nowReal = new Date(), nowIso = nowReal.toISOString()
  const today = nowReal.toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
  const now = new Date(nowReal.toLocaleString('en-US', { timeZone: 'America/Chicago' }))
  const day = now.getDate()
  const dow = now.getDay()
  const month = today.slice(0, 7)
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const speakToday = force || day === 1 || day === 20 || dow === 1

  const read = async (k: string) => {
    const { data } = await supabase.from('app_data').select('data').eq('key', k).maybeSingle()
    return (Array.isArray(data?.data) ? data!.data : []) as Any[]
  }
  const [clients, forms, staff, visits, coordinators, watch] = await Promise.all(
    ['nurse_clients', 'ghe_forms', 'nurse_staff', 'nurse_visits', 'coordinator_staff', 'ghe_watch'].map(read),
  )
  /* ops_settings is one object, not a list: the switch is ghe_watch_live (off until Samantha turns it on) */
  const settings: Any = await (async () => { const { data } = await supabase.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle(); return data?.data && !Array.isArray(data.data) ? data.data : {} })()
  const live = settings.ghe_watch_live === true

  // A GHE window counts as handled if a form was written for that client in the
  // month, or the older visit log already recorded it completed.
  const handled = (clientId: string, clientName: string, m: string) =>
    forms.some((f) => String(f.client || '') === clientName && String(f.visit_date || '').slice(0, 7) === m) ||
    visits.some((v) => String(v.client_id) === String(clientId) && /^ghe/.test(String(v.type || '')) &&
      v.status === 'completed' && String(v.completed_on || '').slice(0, 7) === m)

  const ghlToken = Deno.env.get('GHL_TOKEN')
  const ghlLocation = Deno.env.get('GHL_LOCATION_ID')
  const headers = {
    Authorization: `Bearer ${ghlToken}`,
    Version: '2021-07-28',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  /* NO SILENT FAILURES (2026-10-01): a daily cron with nobody watching, and every recipient is staff (a nurse or the
     office), so a reminder that doesn't go out raises a Needs Attention card as 'staff-alert'. A dry run still
     returns before anything is sent or raised. */
  const mail = async (to: string, subject: string, html: string, who?: string) => {
    if (dry || !ghlToken || !ghlLocation || !to) return false
    const failed = (why: string) => reportSendProblem(supabase, { sender: 'staff-alert', channel: 'email', address: to, who, reasons: [why], failed: true })
    try {
      /* ONE CONTACT (2026-10-01): the reminder goes to the contact found by the one-contact rule for email. */
      const contactId = await ghlStaffContact({ token: ghlToken, locationId: ghlLocation }, { channel: 'email', email: to, firstName: 'CC', lastName: 'Hub' })
      if (!contactId) { await failed('no GoHighLevel contact'); return false }
      return await ghlSendChecked(supabase, headers, 'staff-alert', { channel: 'email', contactId, address: to, who }, { subject, html })
    } catch (e) { await failed('GoHighLevel could not be reached: ' + String((e as Error)?.message ?? e).slice(0, 80)); return false }
  }
  const nurseEmail = (name: string) => String((staff.find((n) => n.name === name) || {}).email || '').trim().toLowerCase()
  let sent = 0

  /* ── 2. THE AXISCARE WATCH ─────────────────────────────────────────────── */
  const axVisits = axFetcher()
  const coord = await coordinatorOf(supabase)
  const wins = G.windows(clients, today)
  const seen: Any[] = [], cards: Any[] = [], ladderMails: Any[] = []
  let axFailed = 0, notLinked = 0
  for (const w of wins) {
    const id = `gw_${w.client_id}_${w.month}`
    const prev = watch.find((x) => x.id === id) || {}
    let st: Any = null
    if (!w.ax) { notLinked++; st = { state: 'not_linked', visit: null } }
    else {
      const r = G.monthRange(w.month)
      const vs = await axVisits(w.ax, r.from, r.to)
      if (vs === null) { axFailed++; st = prev.state ? { state: prev.state, visit: prev.visit || null, stale: true } : { state: 'unknown', visit: null } }
      else st = G.monthState(vs, w.month, nowIso)
    }
    const formDone = handled(w.client_id, w.name, w.month)
    const sg = G.stage(w, st, today, formDone)
    const item: Any = { ...prev, id, client_id: w.client_id, name: w.name, ax: w.ax, nurse: w.nurse, month: w.month,
      state: st.state, visit: st.visit, form_done: formDone, stage: sg.stage, checked_at: st.stale ? (prev.checked_at || null) : nowIso,
      check_failed: !!st.stale || st.state === 'unknown' }
    seen.push({ name: w.name, month: w.month, state: st.state, stage: sg.stage, actions: sg.actions })
    if (!dry) await supabase.rpc('upsert_app_data_item', { target_key: 'ghe_watch', item })
    /* the ladder needs AxisCare's answer: a client not linked to AxisCare, or a check that failed, is never assumed missed */
    if (!live || dry || item.check_failed || st.state === 'not_linked') continue

    /* the ladder: each step once per window (stamped on the watch item) */
    const nurse = w.nurse || ''
    if (sg.actions.includes('warn_unbooked') && !item.warned_unbooked_at && w.ax) {
      ladderMails.push({ to: [nurseEmail(nurse), coord.email].filter(Boolean), subject: `GHE not booked yet: ${w.name}`,
        html: `<p><b>${esc(w.name)}</b> has a GHE due in ${esc(w.month)} and there is no GHE visit (T1001) in AxisCare yet.</p>` +
          `<p>${nurse ? esc(nurse) + ': please call the client, agree a time, and add the visit in AxisCare as T1001.' : 'No nurse has this client yet: assign one on Nurse Scheduling.'}</p>` +
          `<p style="color:#666;font-size:13px;">Caring Companions · Nurse Scheduling. The Medicaid coordinator (${esc(coord.email)}) gets a copy.</p>`, stamp: 'warned_unbooked_at', item })
    }
    if (sg.actions.includes('owner_alert') && !item.owner_alerted_at) {
      ladderMails.push({ to: [OWNER], subject: `GHE still not booked, ${w.month} ends soon: ${w.name}`,
        html: `<p><b>${esc(w.name)}</b>'s GHE is due this month and AxisCare still has no GHE visit (T1001)${st.state === 'not_visited' ? ' that was clocked' : ''}. Nurse: ${esc(nurse || 'none assigned')}.</p><p style="color:#666;font-size:13px;">Caring Companions · Nurse Scheduling</p>`, stamp: 'owner_alerted_at', item })
    }
    const unbookedId = `ops_ghe_unbooked_${w.client_id}_${w.month}`
    if (sg.actions.includes('unbooked_card')) {
      const passed = st.state === 'not_visited'
      cards.push({ id: unbookedId, kind: 'ghe_unbooked', status: 'open', title: (passed ? 'GHE visit passed without a clock-in: ' : 'GHE not booked: ') + `${w.name} (${w.month})`, about: w.name,
        detail: (passed ? `The GHE visit booked in AxisCare for ${String(st.visit?.at || '').slice(0, 10)} was not clocked in and out, and no GHE form came in.` : `No GHE visit (T1001) in AxisCare yet for ${w.month}.`) +
          ` Call ${nurse || 'a nurse'} today; the nurse books it in AxisCare. This card closes itself once AxisCare shows it booked.`,
        owner: coord.email, domain: 'payer_programs', urgency: 'normal', due: `${w.month}-${String(G.lastDay(w.month)).padStart(2, '0')}T23:00:00Z`,
        link: '#nursevisits', client_id: w.client_id, month: w.month, created_at: prev.unbooked_card_at || nowIso, updated_at: nowIso })
      item.unbooked_card_at = item.unbooked_card_at || nowIso
    } else if (prev.unbooked_card_at && !prev.unbooked_card_closed_at && (sg.stage === 'booked' || sg.stage === 'done' || sg.stage === 'missed')) {
      cards.push({ id: unbookedId, kind: 'ghe_unbooked', status: 'done', done_at: nowIso, done_by: 'The Hub (AxisCare shows it booked)', updated_at: nowIso, title: `GHE not booked: ${w.name} (${w.month})`, owner: coord.email, domain: 'payer_programs' })
      item.unbooked_card_closed_at = nowIso
    }
    if (sg.actions.includes('missed_card') && !item.missed_card_at && !item.resolved) {
      cards.push({ id: `ops_ghe_missed_${w.client_id}_${w.month}`, kind: 'ghe_missed', status: 'open', title: `Missed GHE: ${w.name} (${w.month})`, about: w.name,
        detail: `${w.month} ended with no GHE visit clocked in AxisCare and no GHE form. Open Nurse Scheduling, say what happened and the next step: done next month (not billed or paid), delay outside our control (contact the PCCP team), or a refusal (report it to DSDS).`,
        owner: coord.email, domain: 'payer_programs', urgency: 'urgent', due: nowIso, link: '#nursevisits', client_id: w.client_id, month: w.month, created_at: nowIso, updated_at: nowIso })
      item.missed_card_at = nowIso
    }
    if (item.unbooked_card_at !== prev.unbooked_card_at || item.missed_card_at !== prev.missed_card_at || item.unbooked_card_closed_at !== prev.unbooked_card_closed_at)
      await supabase.rpc('upsert_app_data_item', { target_key: 'ghe_watch', item })
  }
  for (const c of cards) {
    const { data } = await supabase.from('app_data').select('data').eq('key', 'ops_items').maybeSingle()
    const cur = (Array.isArray(data?.data) ? data.data : []).find((x: Any) => x && x.id === c.id)
    if (cur && c.status === 'open' && cur.status !== 'open') continue   /* a person closed it: respected */
    await supabase.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { ...(cur || {}), ...c } })
  }
  for (const m of ladderMails) {
    let any = false
    for (const to of m.to) if (await mail(to, m.subject, m.html)) { sent++; any = true }
    if (any) { m.item[m.stamp] = nowIso; await supabase.rpc('upsert_app_data_item', { target_key: 'ghe_watch', item: m.item }) }
  }

  /* ── 1. THE DIGEST (Mondays, the 1st, the 20th) ─────────────────────────── */
  const dueNow: { client: string; nurse: string; month: string; ax: string }[] = []
  const overdue: { client: string; nurse: string; month: string; ax: string }[] = []
  const wState = (cid: string, m: string) => (watch.find((x) => x.id === `gw_${cid}_${m}`) || {}) as Any
  for (const c of clients) {
    if (c.active === false) continue
    for (const w of ['ghe1', 'ghe2']) {
      const m = String(c[w] || '').slice(0, 7)
      if (!m) continue
      if (handled(c.id, c.name, m) || wState(c.id, m).state === 'visited') continue
      const row = { client: String(c.name || '(unnamed)'), nurse: String(c.assigned_nurse || ''), month: m, ax: String(c.axiscare_client_id || '') }
      if (m === month) dueNow.push(row)
      else if (m < month && !wState(c.id, m).resolved) overdue.push(row)
    }
  }
  const awaitingUpload = forms.filter((f) => f.status === 'ready')
  const unassigned = dueNow.filter((r) => !r.nurse)
  const booked = (r: { client: string; month: string }) => { const c = clients.find((x) => x.name === r.client); const s = c ? wState(c.id, r.month) : {}; return s.state === 'booked' && s.visit ? ' (booked in AxisCare ' + esc(String(s.visit.at).slice(0, 10)) + ')' : ' (not booked in AxisCare yet)' }
  const list = (rows: { client: string; month: string }[]) =>
    '<ul>' + rows.map((r) => `<li><b>${esc(r.client)}</b> — ${esc(r.month)}${booked(r)}</li>`).join('') + '</ul>'

  if (speakToday) {
    // Each nurse hears only about her own caseload.
    for (const n of staff) {
      const email = String(n.email || '').trim()
      if (!email) continue
      const mine = dueNow.filter((r) => r.nurse === n.name)
      const late = overdue.filter((r) => r.nurse === n.name)
      if (!mine.length && !late.length) continue
      const html =
        `<p>Hi ${esc(String(n.name || '').split(' ')[0])},</p>` +
        (late.length ? `<p><b style="color:#B00020;">Past their window and still not done:</b></p>${list(late)}` : '') +
        (mine.length ? `<p><b>Due this month:</b></p>${list(mine)}<p>Call the client and set a time that suits you both, add the visit in AxisCare as T1001, then fill in the GHE form in the hub when you visit.</p>` : '') +
        `<p style="color:#666;font-size:13px;">Caring Companions · Nurse Scheduling</p>`
      if (await mail(email, late.length ? `GHE overdue: ${late.length} to catch up` : `GHE due this month: ${mine.length}`, html, String(n.name || ''))) sent++
    }
    // The office hears about what is late or waiting on a Fusion upload.
    if (overdue.length || awaitingUpload.length || unassigned.length) {
      const html =
        (overdue.length ? `<p><b style="color:#B00020;">GHEs past their state window:</b></p>${list(overdue)}` : '') +
        (unassigned.length ? `<p><b>Due this month with no nurse assigned:</b></p>${list(unassigned)}</p>` : '') +
        (awaitingUpload.length
          ? `<p><b>Signed and waiting to go into Fusion:</b></p><ul>` +
            awaitingUpload.map((f) => `<li><b>${esc(String(f.client || ''))}</b> — visited ${esc(String(f.visit_date || ''))}, score ${esc(String(f.total ?? ''))}</li>`).join('') +
            `</ul><p>Open the GHE form in the hub, print the PDF, upload it into Fusion, then mark it Uploaded.</p>`
          : '') +
        `<p style="color:#666;font-size:13px;">Caring Companions · Nurse Scheduling</p>`
      const office = new Set<string>([OWNER, coord.email])
      coordinators.forEach((c) => { const e = String(c.email || '').trim(); if (e) office.add(e) })
      for (const to of office) {
        if (await mail(to, `GHE watch: ${overdue.length} overdue, ${awaitingUpload.length} waiting for Fusion`, html)) sent++
      }
    }
  }

  if (!dry) await beat(supabase, axFailed === 0,
    `due ${dueNow.length}, overdue ${overdue.length}, awaiting Fusion ${awaitingUpload.length}, watched ${wins.length}${axFailed ? ', AxisCare failed ' + axFailed : ''}, cards ${cards.length}, emails ${sent}${live ? '' : ' (watch switch off)'}`)
  return json({
    ok: true, dry, live, day, month, speak: speakToday,
    due_this_month: dueNow.length, overdue: overdue.length,
    unassigned: unassigned.length, awaiting_fusion: awaitingUpload.length,
    watched: wins.length, axiscare_failed: axFailed, not_linked: notLinked, coordinator: coord,
    cards: cards.map((c) => ({ id: c.id, kind: c.kind, status: c.status })), ladder_emails: ladderMails.length,
    seen, emails_sent: sent,
  })
})
