// Supabase Edge Function: lead-watch  (shared hub project)
// -----------------------------------------------------------------------------
// SPEED TO LEAD, THE 5 / 15 / 30 RUNGS AND OWNER-OUT (item 2 of her Leads design; Samantha "yes to all" 2026-10-07).
// Every 2 minutes, for every new inquiry nobody has tried to call (the lead-response-hours clock, lead-rules.js, the
// same file the Hub reads):
//    5 min   the OWNER gets one text with their link page (the board is already red)
//   15 min   the BACKUP (the Operations duty window's backup, else Owner Escalation) gets the lead on their My Work
//            with Take it, and one text with the same page
//   30 min   OWNER ESCALATION gets one notice; the card is marked escalated; a MISS is counted on the inquiry against
//            the owner (the Owners Hub team table)
// One text per rung per inquiry, never repeated (lead.rungs). The clock runs only inside lead response hours, and
// office quiet hours still gate every send. The 15 and 30 are Settings (ops_settings.lead_rungs); 5 is fixed.
// Also, every run: an inquiry nobody owns goes to whoever holds Operations now ("unowned" is not a state); an owner
// marked OUT on the Team page (coordinator_staff.out_until) hands their not-yet-yes inquiries to the Operations holder,
// and Owner Escalation gets one summary text.
// THE LINK PAGE (cc.mo-care.com/lead.html; POST {c, a, e, t, action}): view · called {outcome, note} (logs the attempt
// as that person, which stops the clock) · take (the inquiry becomes theirs) · bridge (Call rings their phone first).
// Only a live link from a person's own text. Nothing here ever contacts the family.
// Off until ops_settings.lead_rungs_live (Owners Hub Admin page; Hub Settings → Leads); while off, the answer lists
// what it WOULD do and nothing is written or sent. Auth: its schedule (x-cron-secret) or the owner's server key.
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jobCaller } from '../_shared/job-auth.ts'
import { opEvent } from '../_shared/events.ts'
import { seatHolder } from '../_shared/duty.ts'
import { officeQuiet } from '../_shared/quiet-hours.ts'
import { textAdmin, type Admin } from '../_shared/clockin-admins.ts'
import { normalisePhone } from '../_shared/outreach.ts'
import { checkLink, adminKey, makeLink, linkExpiry } from '../_shared/lead-links.ts'
import { ldPush } from '../_shared/lead-truth.ts'
import { ghlCallBridge } from '../_shared/ghl-call-bridge.ts'
import '../_shared/lead-rules.js'
// deno-lint-ignore no-explicit-any
const LR: any = (globalThis as any).LeadRules

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
               'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b, null, 2), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
// deno-lint-ignore no-explicit-any
type Any = any
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const read = async (key: string): Promise<Any[]> => {
  const { data } = await sb.from('app_data').select('data').eq('key', key).maybeSingle()
  return Array.isArray(data?.data) ? data!.data : []
}
const put = (key: string, item: unknown) => sb.rpc('upsert_app_data_item', { target_key: key, item })
const low = (s: unknown) => String(s || '').trim().toLowerCase()
const firstOf = (s: unknown) => String(s || '').trim().split(/\s+/)[0] || ''
const todayChi = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
const chi12 = (iso: unknown) => iso ? new Date(String(iso)).toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' }).toLowerCase() : null
const HUB = 'https://cc.mo-care.com/'

/* people: persons (name ↔ email) and coordinator_staff (phone, out_until) */
async function people() {
  const staff = await read('coordinator_staff')
  let persons: Any[] = []
  try { const { data } = await sb.from('persons').select('primary_email, full_name'); persons = (data ?? []) as Any[] } catch { /* names are a nicety */ }
  const nameOf = (e: string) => { const p = persons.find((x) => low(x?.primary_email) === low(e)); if (p?.full_name) return String(p.full_name)
    const s = staff.find((x) => low(x?.email) === low(e)); return s?.name ? String(s.name) : String(e || '').split('@')[0] }
  /* the inquiry stores a FIRST NAME ("Krystal"); the duty schedule and the cards use emails */
  const emailOf = (v: unknown) => { const s = String(v || '').trim(); if (!s) return ''; if (s.includes('@')) return low(s)
    const f = low(firstOf(s)); const p = persons.find((x) => low(firstOf(x?.full_name)) === f) || persons.find((x) => low(String(x?.primary_email).split('@')[0]) === f)
    if (p) return low(p.primary_email); const st = staff.find((x) => low(firstOf(x?.name)) === f || low(String(x?.email).split('@')[0]) === f); return st ? low(st.email) : '' }
  const admin = (e: string): Admin => { const s = staff.find((x) => low(x?.email) === low(e)); const name = nameOf(e); return { email: low(e), name, first: firstOf(name), phone: normalisePhone(s?.phone) || null } }
  const outUntil = (e: string) => { const s = staff.find((x) => low(x?.email) === low(e)); const d = String(s?.out_until || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= todayChi() ? d : '' }
  const emails = [...new Set([...persons.map((p) => low(p?.primary_email)), ...staff.map((s) => low(s?.email))].filter(Boolean))]
  return { nameOf, emailOf, admin, outUntil, emails }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'not allowed' }, 405)
  const url = new URL(req.url)
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const SECRET = Deno.env.get('HUB_JOB_SECRET') || ''
  const ghl = { token: Deno.env.get('GHL_TOKEN') || Deno.env.get('GHL_API_KEY') || '', locationId: Deno.env.get('GHL_LOCATION_ID') || '' }

  /* ── the link page ── */
  if (body.c !== undefined && body.t !== undefined) {
    if (!(await checkLink(SECRET, body))) return json({ error: 'This link is not valid or has expired.' }, 401)
    const P = await people()
    const meEmail = (await Promise.all(P.emails.map(async (e) => ({ e, k: await adminKey(e) })))).find((y) => y.k === String(body.a))?.e
    if (!meEmail) return json({ error: 'You are no longer on the team list.' }, 403)
    const me = P.admin(meEmail)
    const { data: setRow } = await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
    const settings: Any = setRow?.data ?? {}
    const leads = await read('leads'), id = String(body.c)
    const l = leads.find((x) => String(x?.id) === id)
    if (!l) return json({ error: 'This inquiry is no longer on file.' }, 404)
    const action = String(body.action || 'view'), nowIso = new Date().toISOString()
    const family = `${l.first_name ?? ''} ${l.last_name ?? ''}`.trim() || 'the family'
    const hours = LR.responseHours(settings), fa = LR.firstAttemptState(l, hours, nowIso)
    const ownerEmail = P.emailOf(l.assigned_coordinator)
    if (action === 'view') {
      const lastTry = (Array.isArray(l.contact_events) ? l.contact_events : []).filter((e: Any) => e?.actor === 'human' && e?.direction === 'out').at(-1) || null
      const inq = (Array.isArray(l.contact_events) ? l.contact_events : []).find((e: Any) => e?.channel === 'web' && e?.outcome === 'inquiry')
      return json({ ok: true, me: me.first, practice: settings.lead_rungs_live !== true,
        family, first: firstOf(l.first_name) || 'the family', client: !l.client_name_not_provided ? `${l.client_first_name ?? ''} ${l.client_last_name ?? ''}`.trim() : '',
        relationship: l.relationship || '', came_in: fa ? fa.came_in : '', ack: fa ? fa.ack : '', open_minutes: fa && fa.running ? fa.open_minutes : 0,
        what: String(LR.whyCalled(l) || inq?.note || inq?.ref || l.interest_notes || '').slice(0, 300),
        need: [LR.desiredStartWords(l), l.funding_source ? LR.PAYER_WORDS[l.funding_source] || l.funding_source : '', LR.scheduleWords(l), String(l.client_city || '').trim()].filter(Boolean).join(' · '),
        phone: l.phone || null, email: l.email || null, source: l.source || '', referral: l.referral_source_name || '',
        owner: l.assigned_coordinator ? firstOf(l.assigned_coordinator) : '', mine: !!ownerEmail && ownerEmail === me.email,
        attempted: !!l.first_human_attempt_at, talked: !!l.first_human_contact_at, status: String(l.status || 'New'),
        last_try: lastTry ? { by: firstOf(P.nameOf(lastTry.by)), outcome: String(lastTry.outcome || '').replace(/_/g, ' '), at: chi12(lastTry.at), note: lastTry.note || '' } : null,
        rungs: l.rungs || {}, hub_url: `${HUB}#p/L${encodeURIComponent(id)}/summary`, do_not_contact: !!l.do_not_contact })
    }
    if (action === 'bridge')
      return json(await ghlCallBridge(sb, ghl, settings, { email: me.email, name: me.name, via: 'hub' }, { phone: l.phone, email: l.email, label: firstOf(l.first_name) || 'the family' }))
    if (action === 'called') {
      const outcome = String(body.outcome || ''), note = String(body.note || '').slice(0, 300)
      if (!['connected', 'voicemail', 'no_answer', 'wrong_number'].includes(outcome)) return json({ error: 'What happened on the call?' }, 400)
      const already = !!l.first_human_attempt_at
      ldPush(l, { channel: 'call', direction: 'out', outcome, actor: 'human', by: me.email, note })
      const label: Record<string, string> = { connected: 'connected', voicemail: 'voicemail', no_answer: 'no answer', wrong_number: 'wrong number' }
      l.comm_log = Array.isArray(l.comm_log) ? l.comm_log : []
      l.comm_log.push({ body: `☎ call — ${label[outcome]}${note ? ': ' + note : ''} (from the text link)`, at: nowIso, by: me.email })
      l.last_contacted_at = todayChi()
      if (outcome === 'connected' && String(l.status || 'New') === 'New') LR.setStatus(l, 'Contacted', { by: me.email, why: 'first real conversation (logged from the text link)' })
      if (outcome === 'voicemail' || outcome === 'no_answer') { l.contact_attempts = (Number(l.contact_attempts) || 0) + 1; l.last_attempt_kind = label[outcome] }
      if (outcome === 'wrong_number') l.bad_number = true
      await put('leads', l)
      /* the My Work card: the clock is answered */
      const items = await read('ops_items'); const it = items.find((x) => String(x?.id) === 'ops_lead_' + id)
      if (it && it.status === 'open' && it.clock_urgent) { it.urgency = 'normal'; it.clock_urgent = false; it.last_activity_at = nowIso
        it.history = [...(Array.isArray(it.history) ? it.history : []), { at: nowIso, by: me.name, text: `${me.first} called (${label[outcome]}) from the text link` }]; await put('ops_items', it) }
      await opEvent(sb, { actor_name: me.name, actor_email: me.email, verb: outcome === 'connected' ? 'lead_connected' : 'lead_attempted', item_id: id, area: 'growth_leads',
        summary: `${me.name} called ${family} from the speed-to-lead text: ${label[outcome]}` })
      return json({ ok: true, first_attempt: !already })
    }
    if (action === 'take') {
      const was = l.assigned_coordinator || ''
      if (ownerEmail === me.email) return json({ ok: true, already_mine: true })
      l.assigned_coordinator = me.first
      l.comm_log = Array.isArray(l.comm_log) ? l.comm_log : []
      l.comm_log.push({ body: `${me.first} took this inquiry${was ? ' from ' + firstOf(was) : ''} (from the text link)`, at: nowIso, by: me.email, kind: 'owner' })
      await put('leads', l)
      const items = await read('ops_items'); const it = items.find((x) => String(x?.id) === 'ops_lead_' + id)
      if (it && it.status === 'open') {
        const from = low(it.owner)
        it.owner_history = [...(Array.isArray(it.owner_history) ? it.owner_history : []), { at: nowIso, by: me.email, by_name: me.name, from, from_name: from ? P.nameOf(from) : '', to: me.email, to_name: me.name, how: 'took', note: 'from the speed-to-lead text' }].slice(-30)
        it.owner = me.email; it.owner_name = me.name; it.claimed_by = me.email; it.claimed_by_name = me.name; it.claimed_at = nowIso
        if (it.escalation && !it.escalation.cleared_at) { it.escalation.cleared_at = nowIso; it.escalation.cleared_why = 'taken' }
        it.history = [...(Array.isArray(it.history) ? it.history : []), { at: nowIso, by: me.name, text: `${me.first} took it${from ? ' from ' + P.nameOf(from) : ''} (from the text link)` }]
        await put('ops_items', it)
      }
      await opEvent(sb, { actor_name: me.name, actor_email: me.email, verb: 'item_taken_over', item_id: id, area: 'growth_leads', summary: `${me.name} took the inquiry from ${family}${was ? ' from ' + firstOf(was) : ''}` })
      return json({ ok: true })
    }
    return json({ error: 'Unknown action' }, 400)
  }

  /* ── the 2-minute check ── */
  const caller = await jobCaller(req)
  if (!caller) return json({ error: 'not allowed' }, 401)
  if (url.searchParams.get('auth_check') === '1') return json({ ok: true, caller })
  const now = new Date(), nowIso = now.toISOString()
  const { data: setRow } = await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
  const settings: Any = setRow?.data ?? {}
  const live = settings.lead_rungs_live === true && url.searchParams.get('dry') !== '1'
  const [leads, windows, positions, items] = await Promise.all([read('leads'), read('duty_windows'), read('positions'), read('ops_items')])
  const P = await people()
  const firstAdmin = Array.isArray(settings.coverage_alert_admins) && settings.coverage_alert_admins.length ? String(settings.coverage_alert_admins[0]) : 'samantha@mo-care.com'
  const ops = seatHolder(windows, 'operations', now, settings, firstAdmin, positions)
  const esc = seatHolder(windows, 'owner_escalation', now, settings, firstAdmin, positions)
  const opsBackup = low(ops.window?.backup_person || '')
  const hours = LR.responseHours(settings), set = LR.rungSettings(settings), quiet = officeQuiet(now, settings)
  const plan: Any = { live, quiet, seats: { operations: ops.person ? firstOf(P.nameOf(ops.person)) : null, operations_from: ops.source, backup: opsBackup ? firstOf(P.nameOf(opsBackup)) : null, escalation: esc.person ? firstOf(P.nameOf(esc.person)) : null },
    minutes: { owner: LR.FIRST_ATTEMPT_MINUTES, backup: set.backup_min, manager: set.manager_min }, filled: 0, moved: 0, rungs: { owner: 0, backup: 0, manager: 0 }, texted: 0, not_texted: 0, waiting_quiet: 0, written: 0 }
  const itemOf = (id: string) => items.find((x) => String(x?.id) === 'ops_lead_' + id)
  const movedFrom: Record<string, number> = {}
  const link = async (l: Any, to: string) => makeLink(SECRET, String(l.id), to, linkExpiry(todayChi()))
  const text = async (to: string, msg: string): Promise<boolean> => {
    if (!to) return false
    plan.texted++
    if (!live) return true
    const ok = await textAdmin(sb, ghl, P.admin(to), msg)
    if (!ok) { plan.texted--; plan.not_texted++ }
    return ok
  }

  for (const l of leads) {
    if (!l || l.archived || (l.spam && l.spam.at) || l.said_yes_at || ['Lost', 'Converted'].includes(String(l.status || ''))) continue
    let dirty = false
    const family = `${l.first_name ?? ''} ${l.last_name ?? ''}`.trim() || 'a family'
    const fa = LR.firstAttemptState(l, hours, nowIso)
    const fresh = fa && fa.running && fa.open_minutes <= 24 * 60
    /* unowned: the Operations holder owns it from now (only while the inquiry is young; old records are history) */
    let owner = P.emailOf(l.assigned_coordinator)
    if (!owner && fresh && ops.person) {
      plan.filled++
      if (live) { l.assigned_coordinator = firstOf(P.nameOf(ops.person)); owner = ops.person
        l.comm_log = [...(Array.isArray(l.comm_log) ? l.comm_log : []), { body: `Cara: assigned to ${firstOf(P.nameOf(ops.person))} (on Operations now; nobody owned this inquiry)`, at: nowIso, by: 'cara', kind: 'owner' }]; dirty = true }
    }
    /* owner out: their inquiries move to the Operations holder, once */
    const out = owner ? P.outUntil(owner) : ''
    if (owner && out && ops.person && ops.person !== owner && !P.outUntil(ops.person) && !(l.moved_out_at && String(l.moved_out_from || '') === owner)) {
      plan.moved++; movedFrom[owner] = (movedFrom[owner] || 0) + 1
      if (live) { l.moved_out_at = nowIso; l.moved_out_from = owner; l.assigned_coordinator = firstOf(P.nameOf(ops.person))
        l.comm_log = [...(Array.isArray(l.comm_log) ? l.comm_log : []), { body: `Cara: moved from ${firstOf(P.nameOf(owner))} (out until ${out}) to ${firstOf(P.nameOf(ops.person))}, on Operations now`, at: nowIso, by: 'cara', kind: 'owner' }]
        owner = ops.person; dirty = true
        const it = itemOf(String(l.id)); if (it && it.status === 'open') { it.owner = owner; it.owner_name = P.nameOf(owner)
          it.history = [...(Array.isArray(it.history) ? it.history : []), { at: nowIso, by: 'Cara', text: `Moved to ${P.nameOf(owner)}: ${firstOf(P.nameOf(l.moved_out_from))} is out until ${out}` }]; await put('ops_items', it) } }
    }
    /* the rungs */
    const due: Any[] = LR.rungsDue(l, { now: nowIso, hours, settings })
    for (const r of due) {
      const who = r.level === 'owner' ? owner || ops.person
        : r.level === 'backup' ? (opsBackup && opsBackup !== owner ? opsBackup : (ops.person && ops.person !== owner ? ops.person : (esc.person !== owner ? esc.person : '')))
        : esc.person
      if (quiet) { plan.waiting_quiet++; continue }          /* the text waits for 7am; the stamp waits with it, so nothing is skipped */
      plan.rungs[r.level]++
      const whoFirst = who ? firstOf(P.nameOf(who)) : ''
      const mins = fa.open_minutes
      let msg = ''
      if (who) {
        const lk = await link(l, who)
        const what = `${family} asked about care ${fa.came_in.replace(/^came in /, '')}${l.phone ? ' (' + l.phone + ')' : ''}`
        msg = r.level === 'owner' ? `${whoFirst}, a new inquiry needs a call: ${what}. ${mins} min and nobody has called yet. ${lk}`
          : r.level === 'backup' ? `${whoFirst}, backup: ${what}. ${mins} min and ${owner ? firstOf(P.nameOf(owner)) : 'nobody'} hasn't called yet. It's on your My Work; take it here: ${lk}`
          : `${whoFirst}: ${what}. ${mins} min and nobody has called (${owner ? firstOf(P.nameOf(owner)) : 'no owner'}). Counted as a miss. ${lk}`
      }
      const sent = who ? await text(who, msg) : false
      if (!live) continue
      LR.stampRung(l, r.level, { to: who, sent, owner, minutes: r.minutes }, nowIso); dirty = true
      const it = itemOf(String(l.id))
      if (it && it.status === 'open') {
        if (r.level === 'backup' && who) { it.also_for = [...new Set([...(Array.isArray(it.also_for) ? it.also_for : []), who])]
          it.history = [...(Array.isArray(it.history) ? it.history : []), { at: nowIso, by: 'Cara', text: `On ${P.nameOf(who)}'s desk too (backup): ${mins} minutes, nobody has called` }]; await put('ops_items', it) }
        if (r.level === 'manager' && who) { it.escalation = { to: who, to_name: P.nameOf(who), seat: 'owner_escalation', level: 'urgent', why: `nobody has called this family in ${mins} minutes`, at: nowIso }; it.urgency = 'high'
          it.history = [...(Array.isArray(it.history) ? it.history : []), { at: nowIso, by: 'Cara', text: `Escalated to ${P.nameOf(who)}: nobody has called in ${mins} minutes (a miss)` }]; await put('ops_items', it) }
      }
      try { await opEvent(sb, { verb: 'lead_rung', item_id: String(l.id), area: 'growth_leads', summary: `${r.level === 'owner' ? 'Owner' : r.level === 'backup' ? 'Backup' : 'Owner Escalation'} told at ${mins} minutes: nobody has called ${family}${who ? ' (' + firstOf(P.nameOf(who)) + (sent ? '' : ', text failed') + ')' : ' (nobody to tell)'}` }) } catch { /* nicety */ }
    }
    if (dirty && live) { await put('leads', l); plan.written++ }
  }
  /* one summary to Owner Escalation about an owner who is out (per run, only when something moved) */
  if (live && plan.moved && esc.person) {
    const line = Object.entries(movedFrom).map(([e, n]) => `${n} ${n === 1 ? 'inquiry' : 'inquiries'} moved from ${firstOf(P.nameOf(e))} (out) to ${firstOf(P.nameOf(ops.person))}`).join('; ')
    if (!quiet) await text(esc.person, `Caring Companions Hub: ${line}. Nothing was sent to the families.`)
  }
  try { await sb.rpc('upsert_app_data_item', { target_key: 'automation_heartbeats', item: { id: 'hb_lead-watch', automation: 'lead-watch', at: nowIso, ok: true,
    note: `rungs ${plan.rungs.owner}/${plan.rungs.backup}/${plan.rungs.manager} filled:${plan.filled} moved:${plan.moved}${live ? '' : ' (practice)'}` } }) } catch { /* never blocks */ }
  return json(plan)
})
