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

  // GHL substitutes merge fields into the raw JSON body, which breaks two ways:
  // an unresolved field arrives as the literal "{{...}}", and a note containing
  // a quote or newline can break the JSON outright. Handle both so a real call
  // is never lost to a formatting accident.
  const raw = await req.text()
  let b: Record<string, unknown> = {}
  try { b = JSON.parse(raw) } catch {
    // Salvage: pull the simple leading fields, then take everything after
    // "note": as free text. (This is why note must be the LAST field.)
    const grab = (k: string) => (raw.match(new RegExp('"' + k + '"\\s*:\\s*"([^"]*)"')) || [])[1] || ''
    b = { id: grab('id'), name: grab('name'), email: grab('email'), phone: grab('phone'),
          disposition: grab('disposition'), direction: grab('direction'),
          attach: raw.includes('"attach": true') || raw.includes('"attach":true') }
    // Whichever free-text field was put last is the one that broke the JSON, so
    // take everything after it as its value.
    const lastKey = ['note', 'transcript', 'summary']
      .map((k) => [k, raw.lastIndexOf('"' + k + '"')] as [string, number])
      .sort((a, b2) => b2[1] - a[1])[0][0]
    const nm = raw.match(new RegExp('"' + lastKey + '"\\s*:\\s*([\\s\\S]*)\\}\\s*$'))
    if (nm) b[lastKey] = nm[1].trim().replace(/^"/, '').replace(/",?$/, '').trim()
  }
  // An unresolved merge field is not a value.
  const field = (k: string) => {
    const v = typeof b[k] === 'string' ? String(b[k]).trim() : ''
    return v.includes('{{') || v.includes('}}') ? '' : v
  }
  // Field names in GHL are guesswork from the outside, so every reply says what
  // actually arrived. Read this in the workflow's Execution logs: "resolved"
  // means real text came through, "unresolved" means the merge field is wrong
  // for this kind of call, "empty" means it resolved to nothing.
  const state = (k: string) => {
    const v = b[k]
    if (typeof v !== 'string' || !v.trim()) return 'empty'
    return v.includes('{{') ? 'unresolved merge field' : 'resolved (' + v.trim().length + ' chars)'
  }
  const received: Record<string, string> = { disposition: state('disposition'), transcript: state('transcript'), note: state('note'), phone: state('phone'), name: state('name'), detail_from: 'nothing yet' }
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const readKey = async (k: string) => {
    const { data } = await supabase.from('app_data').select('data').eq('key', k).maybeSingle()
    // deno-lint-ignore no-explicit-any
    return (Array.isArray(data?.data) ? data!.data : []) as any[]
  }
  const put = (k: string, item: unknown) => supabase.rpc('upsert_app_data_item', { target_key: k, item })

  const callerPhone = field('phone') || field('phone_number')
  const callerId = field('id') || field('contactId') || field('contact_id')

  /* ---- Attach mode -------------------------------------------------------
     The transcript summary lands minutes after the call, long after the
     disposition already routed it. Delaying the routing is the wrong trade —
     a call-off cannot wait on a transcript — so the summary catches up
     instead: find what this caller's disposition created a few minutes ago
     and fill in the detail that was missing. */
  const summary = field('summary') || field('transcript_summary') || field('recap')
  if (b.attach === true || String(b.attach).toLowerCase() === 'true' || (summary && !field('disposition'))) {
    if (!summary) return json({ ok: true, routed: 'nothing to attach — no summary in this request' })
    const digits = norm(callerPhone)
    const since = Date.now() - 45 * 60 * 1000
    const mine = (r: Record<string, unknown>) => {
      const t = new Date(String(r.created_at || r.opened_at || 0)).getTime()
      if (!t || t < since) return false
      return (digits && norm(String(r.caller_phone || '')) === digits) ||
             (!!callerId && String(r.caller_contact_id || '') === callerId)
    }
    const newest = (rows: Record<string, unknown>[]) =>
      rows.filter(mine).sort((a, b2) =>
        new Date(String(b2.created_at || b2.opened_at || 0)).getTime() -
        new Date(String(a.created_at || a.opened_at || 0)).getTime())[0]

    const item = newest(await readKey('ops_items'))
    if (item) {
      item.detail = [String(item.detail || '').trim(), summary].filter(Boolean).join('\n\n')
      await put('ops_items', item)
      return json({ ok: true, routed: 'summary attached to the Needs Attention item', title: item.title })
    }
    const cov = newest(await readKey('coverage_cases'))
    if (cov) {
      cov.note = [String(cov.note || '').trim(), summary].filter(Boolean).join('\n\n')
      await put('coverage_cases', cov)
      return json({ ok: true, routed: 'summary attached to the coverage case' })
    }
    // No item from a disposition, but it may still belong to a lead.
    const leadRows = await readKey('leads')
    const lead = leadRows.find((l) => digits && (norm(String(l.phone || '')) === digits || norm(String(l.client_phone || '')) === digits))
    if (lead) {
      lead.comm_log = Array.isArray(lead.comm_log) ? lead.comm_log : []
      lead.comm_log.push({ body: '📝 ' + summary, at: new Date().toISOString(), by: 'call summary' })
      await put('leads', lead)
      return json({ ok: true, routed: 'summary added to the lead\'s conversation log' })
    }
    return json({ ok: true, routed: 'nothing recent to attach to — no disposition was tapped on this call' })
  }

  const disposition = field('disposition') || field('call_disposition') || field('outcome')
  if (!disposition) {
    // GHL's "send a test request" fires with no real call behind it, so
    // {{phoneCall.dispositions}} resolves to nothing — and GHL will not let the
    // action be saved unless it gets a 200 back. Answer politely, create
    // nothing, and leave a trace so a genuinely broken merge field is still
    // visible in the log rather than silently doing nothing forever.
    const supabaseT = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    try {
      const { data } = await supabaseT.from('app_data').select('data').eq('key', 'call_disposition_log').maybeSingle()
      const arr = Array.isArray(data?.data) ? data!.data : []
      arr.push({ at: new Date().toISOString(), disposition: '(none)', routed: 'no disposition — nothing created', phone_present: !!(field('phone') || field('phone_number')) })
      await supabaseT.from('app_data').upsert({ key: 'call_disposition_log', data: arr.slice(-50), updated_at: new Date().toISOString() })
    } catch { /* never block the response */ }
    return json({
      ok: true,
      routed: 'nothing — no disposition on this request',
      note: 'This is the expected reply to a test request. On a real call the disposition arrives and the call gets routed.',
      received,
    })
  }

  const phone = callerPhone
  const email = field('email')
  // A typed note wins when there is one, otherwise the call transcript carries
  // the detail: "she can no longer work Thursdays" beats the label "Schedule
  // Change". The transcript stays in our own database — nothing is sent
  // anywhere else — so this does not raise the question the AI recap does.
  const typedNote = field('note') || field('notes')
  const transcript = field('transcript') || field('call_transcript')

  const cap = (s: string, n: number) => (s.length > n ? s.slice(0, n).trim() + ` … [${s.length} characters, trimmed]` : s)

  // GHL exposes no merge field for a call transcript or for the note typed on
  // the post-call screen (only AI-product transcripts and contact custom
  // fields). So fetch the note ourselves: the coordinator taps Notes as usual,
  // and we pull the newest one for this contact. Only notes written in the last
  // 20 minutes count, otherwise an old note would get stapled to a new call.
  let pulledNote = ''
  const contactId = callerId
  if (!typedNote && !transcript && contactId) {
    try {
      const r = await fetch(`https://services.leadconnectorhq.com/contacts/${encodeURIComponent(contactId)}/notes`, {
        headers: { Authorization: `Bearer ${Deno.env.get('GHL_TOKEN')}`, Version: '2021-07-28', Accept: 'application/json' },
      })
      const j = await r.json().catch(() => ({}))
      // deno-lint-ignore no-explicit-any
      const notes: any[] = j?.notes ?? []
      const newest = notes
        .filter((n) => n?.body)
        .sort((a, b) => new Date(b.dateAdded || 0).getTime() - new Date(a.dateAdded || 0).getTime())[0]
      if (newest && Date.now() - new Date(newest.dateAdded || 0).getTime() < 20 * 60 * 1000) {
        pulledNote = String(newest.body).trim()
      }
    } catch { /* a missing note must never block the routing */ }
  }

  const detail = typedNote || pulledNote || transcript || ''
  received.detail_from = typedNote ? 'note field in the webhook body' : pulledNote ? 'note pulled from the GHL contact' : transcript ? 'transcript field' : 'no detail available'
  const note = detail ? cap(detail, 1500) : ''
  const noteShort = detail ? cap(detail, 400) : ''
  const direction = field('direction') || 'outbound'
  let first = field('first_name') || field('firstName')
  let last = field('last_name') || field('lastName')
  const full = field('name') || field('full_name')
  if (!first && full) { const p = full.split(/\s+/); first = p[0]; last = last || p.slice(1).join(' ') }
  const who = [first, last].filter(Boolean).join(' ').trim() || phone || 'unknown caller'

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

  // GHL's token is {{phoneCall.dispositions}} — plural, and it can arrive as a
  // comma-separated list if more than one was set on the call. Match against
  // every value rather than failing the whole call on an exact-string miss.
  const parts = disposition.split(',').map((s) => s.toLowerCase().replace(/[‐-―]/g, '-').trim()).filter(Boolean)
  const is = (...names: string[]) => names.some((n) => parts.includes(n.toLowerCase()))
  const stamp = new Date().toISOString()
  const by = 'phone: ' + who
  const created: string[] = []

  // ---------- calls that are about a caregiver, a client, or nobody ----------
  if (is('call-off', 'call off', 'caregiver call-off')) {
    await put('coverage_cases', {
      id: uid(), client: '(from call — confirm the client)', shift_date: todayISO(), shift_time: '',
      reason: 'call_off', note: [`${who} called off.`, note].filter(Boolean).join(' '),
      status: 'open', asked: [], opened_at: stamp, opened_by: by,
      caller_phone: phone, caller_contact_id: contactId,
      resolved_at: null, resolved_how: null, covered_by: null,
    })
    created.push('coverage case')
  }

  const opsItem = (kind: string, title: string, hours: number) => ({
    id: 'ops_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    kind, title, detail: note, about: who, urgency: 'normal', status: 'open',
    caller_phone: phone, caller_contact_id: contactId,
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
    return json({ ok: true, routed: 'schedule change raised for AxisCare', created, received })
  }

  if (is('spam or sales', 'spam', 'sales')) {
    const list = await readKey('phone_suppress')
    const d = norm(phone)
    if (d && !list.some((x) => norm(x.phone) === d)) {
      await put('phone_suppress', { id: uid(), phone, digits: d, why: disposition, at: stamp, by })
      created.push('suppressed number')
    }
    await logDbg({ disposition, routed: 'suppress', matched: 'n/a' })
    return json({ ok: true, routed: 'suppressed', created, received })
  }

  if (is('client call')) {
    // Deliberately quiet: a routine client question should not cry wolf on a
    // board people are meant to trust.
    await logDbg({ disposition, routed: 'logged only', matched: 'n/a' })
    return json({ ok: true, routed: 'logged only (no alert by design)', created, received })
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
    return json({ ok: true, routed: 'unmatched — raised in Needs Attention', created: ['needs-attention item'], received })
  }

  // Any disposition on a lead means somebody actually worked it.
  lead.last_contacted_at = todayISO()
  lead.comm_log = Array.isArray(lead.comm_log) ? lead.comm_log : []
  lead.comm_log.push({ body: `☎ ${direction} call — ${disposition}${noteShort ? ': ' + noteShort : ''}`, at: stamp, by })
  if (transcript && !typedNote) lead.last_call_transcript = { at: stamp, text: cap(transcript, 8000) }

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
  return json({ ok: true, routed: outcome, lead_id: lead.id, created, received })
})
