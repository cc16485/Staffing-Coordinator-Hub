// Supabase Edge Function: orientation-booked (shared hub project)
// -----------------------------------------------------------------------------
// The candidate-facing orientation booking page (orientation-booking.html) calls
// this the moment someone picks a date. It relays the booking to the Caring
// Companions GoHighLevel inbound webhook, which upserts the contact and starts
// the "Orientation booked - remind" workflow (day-before reminder text).
//
// Why a function instead of a fetch straight from the page: the GHL webhook URL
// stays a secret rather than sitting in public page source, and we don't depend
// on GHL sending CORS headers. Same shape as lead-intake's GHL_HOOK_CCLEADS.
//
// The booking page already sends its own instant confirmation SMS through
// send-candidate-message, so GHL is responsible for the REMINDER only.
//
// Secrets: GHL_HOOK_ORIENTATION — the inbound webhook trigger URL.
// Deploy (CLI): supabase functions deploy orientation-booked
//   (JWT on — the page carries the anon key, same as send-candidate-message)
//
// LIVE FIX 2026-10-09 (Samantha: secure the unauthenticated functions; stop the double reminder). Before, any caller
// with the public key could relay anything here, and the GoHighLevel workflow fired even when the Hub's own hourly
// reminder (orientation-remind, switch ops_settings.orient_remind_live) was on. Now:
//   1. The relay happens only for a real booking: an orient_bookings row for that session and phone, saved in the last
//      15 minutes by the booking page (the same proof send-candidate-message demands), and only once per booking
//      (orient_bookings.ghl_relayed_at).
//   2. While orient_remind_live is on, nothing is relayed: one reminder system at a time. The page still gets ok.
//   3. Nothing from the caller reaches GoHighLevel except what the booking row and the session record say.
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const BOOKING_WINDOW_MIN = 15

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// GHL is strict about phone format — normalize to E.164 so the webhook matches
// the contact that already exists from the offer/application stage.
function e164(raw: string): string {
  const d = (raw || '').replace(/\D/g, '')
  if (d.length === 10) return `+1${d}`
  if (d.length === 11 && d.startsWith('1')) return `+${d}`
  return raw || ''
}

// The day before the orientation, as YYYY-MM-DD. Plain string math on the date
// portion — no Date object, so nothing can shift across a timezone.
function dayBefore(dateStr: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(dateStr || '')) return ''
  const d = new Date(dateStr.slice(0, 10) + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const hook = Deno.env.get('GHL_HOOK_ORIENTATION')
  if (!hook) return json({ error: 'GHL_HOOK_ORIENTATION is not set' }, 500)

  // deno-lint-ignore no-explicit-any
  let body: Record<string, any> = {}
  try { body = await req.json() } catch { return json({ error: 'could not read the booking' }, 400) }

  const str = (k: string) => (typeof body[k] === 'string' ? body[k].trim().slice(0, 500) : '')
  const phone = e164(str('phone'))
  const first = str('first_name') || str('first')
  const orientationDate = str('orientation_date').slice(0, 10)

  if (!phone) return json({ error: 'booking had no phone' }, 400)

  const sessionId = str('session_id')
  if (!sessionId) return json({ error: 'which session?' }, 400)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  /* one reminder system at a time */
  let settings: Record<string, unknown> = {}
  try { const { data } = await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle(); settings = (data?.data && typeof data.data === 'object') ? data.data : {} } catch { settings = {} }
  if (settings.orient_remind_live === true) return json({ success: true, relayed: false, reason: 'the Hub sends the reminder' })

  /* a real booking, saved moments ago by the page, not yet relayed */
  const last10 = phone.replace(/\D/g, '').slice(-10)
  const since = new Date(Date.now() - BOOKING_WINDOW_MIN * 60000).toISOString()
  const { data: rows, error: bErr } = await db.from('orient_bookings').select('id, phone, first, last, ghl_relayed_at').eq('session_id', sessionId).gte('booked_at', since)
  if (bErr) return json({ error: 'could not check the booking' }, 500)
  // deno-lint-ignore no-explicit-any
  const booking = (rows ?? []).find((r: any) => String(r.phone || '').replace(/\D/g, '').slice(-10) === last10)
  if (!booking) return json({ error: 'no matching booking' }, 404)
  if (booking.ghl_relayed_at) return json({ success: true, relayed: false, reason: 'already relayed' })

  const payload = {
    first_name:        String(booking.first || first || '').trim().slice(0, 100),
    last_name:         String(booking.last || str('last_name') || str('last') || '').trim().slice(0, 100),
    phone,
    email:             str('email'),
    office:            (str('office') || 'springfield').toLowerCase(),
    orientation_at:    str('orientation_at'),                       // full ISO timestamp
    orientation_date:  orientationDate,                             // YYYY-MM-DD
    reminder_date:     dayBefore(orientationDate),                  // YYYY-MM-DD, day before
    orientation_when:  str('orientation_when'),                     // "Tuesday, August 5, 2026 at 10:00 AM"
    orientation_where: str('orientation_where'),
    candidate_id:      str('candidate_id'),
    source:            'Staffing Hub orientation booking',
  }

  try {
    const res = await fetch(hook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      console.error('GHL orientation webhook failed:', res.status, detail.slice(0, 300))
      return json({ error: 'GoHighLevel webhook rejected the booking', status: res.status }, 502)
    }
  } catch (err) {
    console.error('orientation-booked error:', err)
    return json({ error: String(err) }, 502)
  }

  await db.from('orient_bookings').update({ ghl_relayed_at: new Date().toISOString() }).eq('id', booking.id)
  console.log(`✅ orientation booking relayed to GHL (${orientationDate})`)
  return json({ success: true, relayed: true, reminder_date: payload.reminder_date })
})
