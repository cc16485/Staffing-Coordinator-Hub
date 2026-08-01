// Supabase Edge Function: call-disposition  (shared hub project)
// -----------------------------------------------------------------------------
// The post-call screen becomes the front door for every kind of call.
//
// A GHL Workflow fires on "Call Disposition" and POSTs here (gated by
// ?token=CALL_DISPOSITION_TOKEN). One tap on the coordinator's phone then
// lands the call on the right board instead of dying as a label:
//
//   Call-Off          → opens a Coverage Help case
//   Caregiver Issue   → Needs Attention (staffing)
//   Client Concern    → Needs Attention (client issue)
//   Client Call       → logged only, deliberately no alert
//   Referral Call     → credits the referring org + starts a lead
//   Job Applicant     → Needs Attention for whoever recruits
//   Spam or Sales     → suppression list, so it stops making missed-call noise
//   Booked Visit      → lead moves to Assessment Scheduled
//   Lead - Not Ready  → back in 5 days
//   Send to CDS       → Lost, reason "Referred to CDS"
//   No Answer /       → counts an attempt and sets the next try on a ladder
//   Voicemail            (1d → 2d → 4d → 7d → cools itself)
//   Follow Up         → back in 7 days
//   Requested Appointment → hot, due today
//   Not Interested    → Lost, cold nurture
//   Incorrect Number  → flags the number as bad
//
// Every disposition on a matched lead also stamps last_contacted_at, which is
// what closes the "new lead nobody answered" item and feeds the stand-up board.
//
// The disposition carries the WHO for non-lead calls, so a caregiver call-off
// works even when the number matches nothing. Phone matching is only needed to
// attach lead outcomes to the right lead.
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const norm = (p: string) => String(p || '').replace(/\D/g, '').slice(-10)
const todayISO = () => new Date().toISOString().slice(0, 10)
const addDays = (n: number) => {
  const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10)
}
const uid = () => 'd_' + crypto.randomUUID().slice(0, 12)

// How long before we try an unreached lead again, by attempt number.
const LADDER = [1, 2, 4, 7]
const ladderDays = (attempt: number) => LADDER[Math.min(attempt, LADDER.length) - 1] ?? 7

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const url = new URL(req.url)
  if (url.searchParams.get('token') !== Deno.env.get('CALL_DISPOSITION_TOKEN')) return json({ error: 'unauthorized' }, 401)

  const b = await req.json().catch(() => ({})) as Record<string, unknown>
  const field = (k: string) => (typeof b[k] === 'string' ? String(b[k]).trim() : '')
  const disposition = field('disposition') || field('call_disposition') || field('outcome')
  if (!disposition) return json({ error: 'no disposition' }, 400)

  const phone = field('phone') || field('phone_number')
  const email = field('email')
  const note = field('note') || field('notes')
  const direction = field('direction') || 'outbound'
  let first = field('first_name') || field('firstName')
  let last = field('last_name') || field('lastName')
  const full = field('name') || field('full_name')
  if (!first && full) { const p = full.split(/\s+/); first = p[0]; last = last || p.slice(1).join(' ') }
  const who = [first, last].filter(Boolean).join(' ').trim() || phone || 'unknown caller'

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const readKey = async (k: string) => {
    const { data } = await supabase.from('app_data').select('data').eq('key', k).maybeSingle()
    // deno-lint-ignore no-explicit-any
    return (Array.isArray(data?.data) ? data!.data : []) as any[]
  }
  const put = (k: string, item: unknown) => supabase.rpc('upsert_app_data_item', { target_key: k, item })

  // Debug trail so "webhook never arrived" is distinguishable from "arrived and
  // did nothing". Metadata only — the note is not logged here.
  const logDbg = async (row: Record<string, unknown>) => {
    try {
      const { data } = await supabase.from('app_data').select('data').eq('key', 'call_disposition_log').maybeSingle()
      const arr = Array.isArray(data?.data) ? data!.data : []
      arr.push({ at: new Date().toISOString(), ...row })
      await supabase.from('app_data').upsert({ key: 'call_disposition_log', data: arr.slice(-50), updated_at: new Date().toISOString() })
    } catch { /* logging must never break the routing */ }
  }

  const D = disposition.toLowerCase().replace(/[‐-―]/g, '-').trim()
  const is = (...names: string[]) => names.some((n) => n.toLowerCase() === D)
  const stamp = new Date().toISOString()
  const by = 'phone: ' + who
  const created: string[] = []

  // ---------- calls that are about a caregiver, a client, or nobody ----------
  if (is('call-off', 'call off', 'caregiver call-off')) {
    await put('coverage_cases', {
      id: uid(), client: '(from call — confirm the client)', shift_date: todayISO(), shift_time: '',
      reason: 'call_off', note: [`${who} called off.`, note].filter(Boolean).join(' '),
      status: 'open', asked: [], opened_at: stamp, opened_by: by,
      resolved_at: null, resolved_how: null, covered_by: null,
    })
    created.push('coverage case')
  }

  const opsItem = (kind: string, title: string, hours: number) => ({
    id: 'ops_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    kind, title, detail: note, about: who, urgency: 'normal', status: 'open',
    created_at: stamp, due: new Date(Date.now() + hours * 3600 * 1000).toISOString(),
    owner: '', owner_name: '', created_by: by, opened_by: 'phone',
  })
  if (is('caregiver issue')) { await put('ops_items', opsItem('staffing_issue', `Caregiver issue — ${who}`, 24)); created.push('needs-attention item') }
  if (is('client concern')) { await put('ops_items', opsItem('client_issue', `Client concern — ${who}`, 24)); created.push('needs-attention item') }
  if (is('job applicant')) { await put('ops_items', opsItem('request', `Job applicant called — ${who}`, 72)); created.push('needs-attention item') }
  if (is('schedule change', 'schedule')) {
    // Clients AND caregivers call about scheduling: change a day, add weekends,
    // give notice, drop a shift. The note carries which. The schedule itself
    // lives in AxisCare, so the hub's job is making sure somebody actually goes
    // and changes it — short fuse, because the shift is often tomorrow and a
    // forgotten change is a missed visit.
    await put('ops_items', opsItem('staffing_issue', `Schedule change — ${who} (update AxisCare)`, 4))
    created.push('needs-attention item (4h)')
    await logDbg({ disposition, routed: 'schedule change', matched: 'n/a' })
    return json({ ok: true, routed: 'schedule change raised for AxisCare', created })
  }

  if (is('spam or sales', 'spam', 'sales')) {
    const list = await readKey('phone_suppress')
    const d = norm(phone)
    if (d && !list.some((x) => norm(x.phone) === d)) {
      await put('phone_suppress', { id: uid(), phone, digits: d, why: disposition, at: stamp, by })
      created.push('suppressed number')
    }
    await logDbg({ disposition, routed: 'suppress', matched: 'n/a' })
    return json({ ok: true, routed: 'suppressed', created })
  }

  if (is('client call')) {
    // Deliberately quiet: a routine client question should not cry wolf on a
    // board people are meant to trust.
    await logDbg({ disposition, routed: 'logged only', matched: 'n/a' })
    return json({ ok: true, routed: 'logged only (no alert by design)', created })
  }

  // ---------- everything below wants a lead ----------
  const leads = await readKey('leads')
  const d = norm(phone)
  let lead = leads.find((l) =>
    (d && (norm(l.phone) === d || norm(l.client_phone) === d)) ||
    (email && l.email && String(l.email).toLowerCase() === email.toLowerCase()))

  if (is('referral call')) {
    // Credit the referring organisation if we know them, so field work shows up
    // on the scoreboard without anyone logging it twice.
    const orgs = await readKey('referral_orgs')
    const org = orgs.find((o) => d && norm(o.phone) === d)
    if (org) {
      await put('referral_activities', { id: uid(), org_id: org.id, kind: 'call', note: note || `Referral call from ${who}`, at: stamp, by })
      created.push(`credited ${org.name}`)
    }
    if (!lead) {
      lead = { id: crypto.randomUUID(), first_name: first || '(referral call)', last_name: last, phone, email,
        source: 'Referral', referral_source_name: org?.name || who, status: 'New', created_at: stamp }
      leads.push(lead)
      created.push('lead')
    }
  }

  if (!lead) {
    // Nothing to attach to. Rather than guess, leave a trace a human can act on.
    await put('ops_items', opsItem('request', `Call marked "${disposition}" — no matching record (${who})`, 24))
    await logDbg({ disposition, routed: 'unmatched', matched: 'none' })
    return json({ ok: true, routed: 'unmatched — raised in Needs Attention', created: ['needs-attention item'] })
  }

  // Any disposition on a lead means somebody actually worked it.
  lead.last_contacted_at = todayISO()
  lead.comm_log = Array.isArray(lead.comm_log) ? lead.comm_log : []
  lead.comm_log.push({ body: `☎ ${direction} call — ${disposition}${note ? ': ' + note : ''}`, at: stamp, by })

  let outcome = 'logged'
  if (is('no answer', 'voicemail')) {
    lead.contact_attempts = (Number(lead.contact_attempts) || 0) + 1
    lead.last_attempt_kind = is('voicemail') ? 'voicemail' : 'no answer'
    if (lead.contact_attempts >= 5) {
      lead.follow_up_branch = 'cold-lead'; lead.follow_up_due = addDays(30)
      outcome = 'cooled after 5 attempts'
    } else {
      lead.follow_up_due = addDays(ladderDays(lead.contact_attempts))
      outcome = `attempt ${lead.contact_attempts}, retry ${lead.follow_up_due}`
    }
  } else if (is('booked visit', 'booked assessment')) {
    lead.status = 'Assessment Scheduled'; lead.follow_up_branch = 'ready-to-start'
    lead.follow_up_due = todayISO(); lead.contact_attempts = 0
    outcome = 'assessment scheduled'
  } else if (is('requested appointment', 'ready to start')) {
    lead.follow_up_branch = 'ready-to-start'; lead.follow_up_due = todayISO()
    lead.status = lead.status === 'New' ? 'Contacted' : lead.status; lead.contact_attempts = 0
    outcome = 'hot — due today'
  } else if (is('lead - not ready', 'not ready', 'family deciding')) {
    lead.follow_up_branch = 'family-decision'; lead.follow_up_due = addDays(5)
    lead.status = lead.status === 'New' ? 'Contacted' : lead.status; lead.contact_attempts = 0
    outcome = 'back in 5 days'
  } else if (is('follow up', 'call back')) {
    lead.follow_up_branch = 'call-back-next-week'; lead.follow_up_due = addDays(7)
    lead.status = lead.status === 'New' ? 'Contacted' : lead.status; lead.contact_attempts = 0
    outcome = 'back in 7 days'
  } else if (is('researching')) {
    lead.follow_up_branch = 'soft-check-in'; lead.follow_up_due = addDays(3)
    lead.status = lead.status === 'New' ? 'Contacted' : lead.status; lead.contact_attempts = 0
    outcome = 'back in 3 days'
  } else if (is('not interested')) {
    lead.status = 'Lost'; lead.lost_reason = lead.lost_reason || 'Not interested'
    lead.lost_at = stamp; lead.follow_up_branch = 'cold-lead'; lead.follow_up_due = addDays(30)
    outcome = 'lost — cold nurture'
  } else if (is('send to cds', 'sent to cds')) {
    lead.status = 'Lost'; lead.lost_reason = 'Referred to CDS'; lead.lost_at = stamp
    lead.follow_up_due = ''; lead.follow_up_branch = ''
    outcome = 'referred to CDS'
  } else if (is('incorrect number', 'bad number')) {
    lead.bad_number = true
    lead.comm_log.push({ body: '⚠ Number reported incorrect on a call — needs a good number.', at: stamp, by })
    outcome = 'flagged bad number'
  } else if (is('referral call')) {
    lead.status = lead.status === 'New' ? 'New' : lead.status
    lead.follow_up_due = todayISO(); outcome = 'referral logged'
  }

  const { error } = await put('leads', lead)
  if (error) return json({ error: 'could not save the lead', detail: error.message }, 502)
  await logDbg({ disposition, routed: outcome, matched: 'lead', attempts: lead.contact_attempts ?? 0 })
  return json({ ok: true, routed: outcome, lead_id: lead.id, created })
})
