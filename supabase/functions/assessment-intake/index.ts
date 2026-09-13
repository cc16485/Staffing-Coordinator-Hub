// Supabase Edge Function: assessment-intake  (shared hub project)
// -----------------------------------------------------------------------------
// A booked New Client Assessment flows straight into the hub. A GHL Workflow
// (trigger: Customer Booked Appointment, filtered to the New Client
// Assessment calendar) POSTs here, gated by ?token=ASSESSMENT_INTAKE_TOKEN:
//   { first_name, last_name, phone, email, start_time, calendar }
//
// What happens: the caller becomes (or updates) a hub LEAD with status
// Assessment Scheduled and the appointment time on it, and an ops item
// lands for the office ("Assessment Tue 9:00 — Jane Smith") so prep is
// somebody's job. Dedupe by phone/email, same as the call pipeline: a
// person who already exists as a lead is updated, never duplicated.
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
const norm = (p: string) => String(p || '').replace(/\D/g, '').slice(-10)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200 })
  const url = new URL(req.url)
  const expected = Deno.env.get('ASSESSMENT_INTAKE_TOKEN')
  if (!expected || url.searchParams.get('token') !== expected) return json({ error: 'unauthorized' }, 401)

  // Defensive parse — GHL merge substitution can break JSON (known pattern).
  const raw = await req.text()
  // deno-lint-ignore no-explicit-any
  let b: Record<string, any> = {}
  try { b = JSON.parse(raw) } catch {
    const grab = (k: string) => (raw.match(new RegExp('"' + k + '"\\s*:\\s*"([^"]*)"')) || [])[1] || ''
    b = { first_name: grab('first_name'), last_name: grab('last_name'),
          phone: grab('phone'), email: grab('email'),
          start_time: grab('start_time'), calendar: grab('calendar') }
  }
  const field = (k: string) => {
    const v = typeof b[k] === 'string' ? String(b[k]).trim() : ''
    return v.includes('{{') ? '' : v
  }
  const first = field('first_name') || (field('name').split(/\s+/)[0] ?? '')
  const last = field('last_name') || field('name').split(/\s+/).slice(1).join(' ')
  const phone = field('phone')
  const email = field('email')
  const startTime = field('start_time') || field('appointment_start_time') || field('startTime')
  if (!first && !phone && !email) return json({ ok: true, routed: 'nothing usable in this request — check the workflow field mapping' })

  const { data: row } = await sb.from('app_data').select('data').eq('key', 'leads').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const leads: any[] = Array.isArray(row?.data) ? row!.data : []
  const existing = leads.find((l) =>
    (phone && l.phone && norm(l.phone) === norm(phone)) ||
    (email && l.email && String(l.email).toLowerCase() === email.toLowerCase()))
  const nowIso = new Date().toISOString()
  const lead = {
    ...(existing || {}),
    id: existing?.id || ('lead_asmt_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
    first_name: existing?.first_name || first || '(assessment booking)',
    last_name: existing?.last_name || last,
    phone: phone || existing?.phone || '',
    email: email || existing?.email || '',
    source: existing?.source || 'Assessment booking',
    status: 'Assessment Scheduled',
    assessment_at: startTime || existing?.assessment_at || '',
    follow_up_branch: 'ready-to-start',
    follow_up_due: (startTime || nowIso).slice(0, 10),
    interest_notes: [String(existing?.interest_notes || '').trim(),
      `Booked a New Client Assessment${startTime ? ' for ' + startTime : ''} (via the booking calendar).`]
      .filter(Boolean).join(' '),
    created_at: existing?.created_at || nowIso, updated_at: nowIso,
  }
  const { error } = await sb.rpc('upsert_app_data_item', { target_key: 'leads', item: lead })
  if (error) return json({ error: error.message }, 500)

  const who = [first, last].filter(Boolean).join(' ') || phone || email
  await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: {
    id: 'ops_asmt_' + lead.id, kind: 'request',
    title: `Assessment ${startTime || '(time on the calendar)'} — ${who}`,
    about: who,
    detail: `New Client Assessment booked${startTime ? ' for ' + startTime : ''}. Prep: caregiver match ready (Hours Watch matcher), start packet, confirm the address. Lead is on the board.`,
    domain: '', status: 'open', urgency: 'high',
    owner: '', owner_name: '',
    due: (startTime || nowIso).slice(0, 10) + 'T08:00:00',
    created_at: nowIso, created_by: 'assessment-intake', opened_by: 'booking-calendar',
  } })
  return json({ ok: true, routed: existing ? 'lead updated to Assessment Scheduled' : 'lead created', lead_id: lead.id })
})
