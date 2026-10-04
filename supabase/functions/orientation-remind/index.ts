// =============================================================================
// orientation-remind (445) · the orientation day-before reminder, sent by the Hub instead of the GoHighLevel workflow
// "Orientation booked - remind". Samantha approved 2026-10-04 ("yes to all"). Every hour from its schedule (the jobs'
// secret), or the owner's Desktop step (the server key; ?dry=1 counts only). See _shared/orient-remind.ts.
// Text only, 10am to 6pm Central, never to someone whose application said no to texts or who opted out, through
// GoHighLevel (so it shows in Conversations); a refused text raises a "Didn't go through" card. Switch OFF
// (ops_settings.orient_remind_live): practice, it only lists who it would remind.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jobCaller } from '../_shared/job-auth.ts'
import { contactForOutbound } from '../_shared/outreach.ts'
import { ghlSendChecked } from '../_shared/send-problems.ts'
import { latestTextConsent } from '../_shared/text-consent.ts'
import { runJob, type Deps } from '../_shared/orient-remind.ts'

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
/* "message to a candidate" on a Needs Attention card, owned by hiring; the bracket is never shown */
const SENDER = 'send-candidate-message (orientation reminder)'

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const caller = await jobCaller(req)
  if (!caller) return json({ error: 'not allowed' }, 401)
  const url = new URL(req.url)
  if (url.searchParams.get('auth_check') === '1') return json({ ok: true, caller })
  const dry = url.searchParams.get('dry') === '1'
  if (dry && caller !== 'owner') return json({ error: 'not allowed' }, 401)
  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false, autoRefreshToken: false } })
  const ghl = { token: Deno.env.get('GHL_TOKEN') ?? '', locationId: Deno.env.get('GHL_LOCATION_ID') ?? '' }
  const H = { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' }
  const deps: Deps = {
    consent: (phone) => latestTextConsent(db, phone),
    send: async (p) => {
      if (!ghl.token || !ghl.locationId) return { sent: false, why: 'texting is not set up on the server' }
      let why = ''
      const c = await contactForOutbound(db, ghl, { phone: p.phone, firstName: p.first, lastName: p.last }, 'reactive_external',
        { audience: 'applicant', channel: 'sms', sender: SENDER, onOptOut: (r) => { why = 'they opted out of texts (' + r.join(', ') + ')' } })
      if (!c) return { sent: false, why: why || 'the number could not be confirmed as safe to text' }
      const ok = await ghlSendChecked(db, H, SENDER, { channel: 'sms', contactId: c.contactId, address: p.phone, who: [p.first, p.last].filter(Boolean).join(' ') }, { message: p.text })
      return ok ? { sent: true } : { sent: false, why: 'GoHighLevel did not accept it (a card is on Needs Attention)' }
    },
  }
  const runId = 'orr_' + new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14) + '_' + crypto.randomUUID().slice(0, 6)
  try { return json(await runJob(db, deps, { caller, runId, dry })) }
  catch (e) { return json({ ok: false, error: 'the run stopped: ' + String(e).slice(0, 200) }, 500) }
})
