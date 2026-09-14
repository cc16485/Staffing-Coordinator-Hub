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

/* GHL's {{appointment.start_time}} arrives as WORDS in the location's
   timezone ("Monday, September 14, 2026 10:00 AM"), proven by the first
   live test booking. Parse that (and plain ISO, in case GHL ever changes
   its mind) into a real Date, treating wordy times as America/Chicago. */
const MONTHS: Record<string, number> = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 }
function parseWhen(s: string): Date | null {
  const t = String(s || '').trim()
  if (!t) return null
  if (/^\d{4}-\d{2}-\d{2}T/.test(t)) { const d = new Date(t); return isNaN(d.getTime()) ? null : d }
  const m = t.match(/(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(\d{4})[,\s]+(\d{1,2}):(\d{2})\s*(am|pm)?/i)
  if (!m) { const d = new Date(t.replace(/^[A-Za-z]+,\s*/, '')); return isNaN(d.getTime()) ? null : d }
  let hh = parseInt(m[4], 10)
  const ap = (m[6] || '').toLowerCase()
  if (ap === 'pm' && hh < 12) hh += 12
  if (ap === 'am' && hh === 12) hh = 0
  // First guess the instant assuming CDT, then correct to the real Chicago
  // offset for that date (handles CST in winter).
  let d = new Date(Date.UTC(parseInt(m[3], 10), MONTHS[m[1].toLowerCase()], parseInt(m[2], 10), hh + 5, parseInt(m[5], 10)))
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', timeZoneName: 'longOffset' })
      .formatToParts(d).find((p) => p.type === 'timeZoneName')?.value || 'GMT-05:00'
    const off = part.match(/GMT([+-])(\d{2}):?(\d{2})?/)
    if (off) {
      const hours = (off[1] === '-' ? 1 : -1) * parseInt(off[2], 10)
      d = new Date(Date.UTC(parseInt(m[3], 10), MONTHS[m[1].toLowerCase()], parseInt(m[2], 10), hh + hours, parseInt(m[5], 10)))
    }
  } catch { /* keep the CDT guess */ }
  return isNaN(d.getTime()) ? null : d
}
const chiDay = (d: Date) => d.toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)

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
          start_time: grab('start_time'), calendar: grab('calendar'),
          appointment_id: grab('appointment_id') }
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
  const startsAt = parseWhen(startTime)
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
    follow_up_due: startsAt ? chiDay(startsAt) : nowIso.slice(0, 10),
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
    due: (startsAt ? chiDay(startsAt) : nowIso.slice(0, 10)) + 'T08:00:00',
    created_at: nowIso, created_by: 'assessment-intake', opened_by: 'booking-calendar',
  } })
  // The hub's Team Calendar reads coordinator_busy, so a booked assessment
  // shows up there without anyone retyping it. source+source_id dedupes GHL
  // retries; a reschedule with the same appointment id updates in place.
  if (startsAt) {
    const starts = startsAt
    {
      const which = /medicaid/i.test(field('calendar')) ? 'Medicaid assessment' : 'Assessment'
      await sb.from('coordinator_busy').upsert({
        coordinator_id: null,
        source: 'ghl_assessment',
        source_id: field('appointment_id') || 'asmt-' + lead.id + '-' + starts.toISOString().slice(0, 10),
        starts_at: starts.toISOString(),
        ends_at: new Date(starts.getTime() + 90 * 60000).toISOString(),
        label: which + ': ' + who + ' (booked in GHL)',
      }, { onConflict: 'source,source_id' })
    }
  }
  return json({ ok: true, routed: existing ? 'lead updated to Assessment Scheduled' : 'lead created', lead_id: lead.id })
})
