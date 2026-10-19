// =============================================================================
// hr-alerts · ZACH'S ALERTS (HR Agent build step 7, Samantha 2026-10-18: "step 7")
// =============================================================================
// Every 30 minutes it looks for HR items waiting for Zach (_shared/hr-alert-rules.ts: agent cases that are recurring or
// serious, write-ups sent for his approval, coaching help requests, handbacks and overdue coaching talks). When there is
// at least one he has not been told about (step 9: also a write-up step due or overdue under the SOP), he gets ONE generic text and email: "You have an HR item to review", with a
// link to the Hub's HR page. No name, no reason, no count. The Hub asks him to sign in before anything shows.
// Alerts go Monday to Friday, 8am to 6pm Central; anything found outside that goes at the next 8am.
// Recipients: to_phone and to_emails on the server-only row hr_alert_state 'zach' (Desktop 965 sets them; not in this
// public repo, and not in ops_settings, which the office can read).
// PRACTICE until ops_settings.hr_alerts_live === true: nothing is sent; each alert it would have sent is written to the
// server-only table hr_alert_state (when, and how many texts and emails). Going live is build step 10.
// A text or email that can't go raises a card on Needs Attention (no silent failures).
//
//   (schedule / owner key)   the 30-minute check · ?dry=1 counts and changes nothing · ?auth_check=1
//   ?test=1 (owner key only)  sends ONE test text and email to the recipients now, practice or not (never at night)
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jobCaller } from '../_shared/job-auth.ts'
import { textAdmin } from '../_shared/clockin-admins.ts'
import { ghlSendChecked, reportSendProblem } from '../_shared/send-problems.ts'
import { ghlStaffContact } from '../_shared/staff-contact.ts'
import { officeQuiet } from '../_shared/quiet-hours.ts'
import { TEXT, TEST_TEXT, SUBJECT, TEST_SUBJECT, emailHtml, waitingItems, newItems, sendWindow, recipients, chicagoDate } from '../_shared/hr-alert-rules.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
// deno-lint-ignore no-explicit-any
const arr = (x: any): any[] => (Array.isArray(x) ? x : [])

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const caller = await jobCaller(req)
  if (!caller) return json({ error: 'not allowed' }, 401)
  const q = new URL(req.url).searchParams
  if (q.get('auth_check') === '1') return json({ ok: true, caller })
  const dry = q.get('dry') === '1', test = q.get('test') === '1'
  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } })
  const now = new Date()
  try {
    const key = async (k: string) => (await db.from('app_data').select('data').eq('key', k).maybeSingle()).data?.data
    const ops = (await key('ops_settings')) || {}
    const st = await db.from('hr_alert_state').select('*').eq('id', 'zach').maybeSingle()
    if (st.error) throw new Error('read failed: ' + st.error.message)
    const to = recipients(st.data)
    const live = ops.hr_alerts_live === true
    if (test) {
      if (caller !== 'owner') return json({ error: 'A test alert is sent from the owner\'s Desktop step only.' }, 403)
      if (officeQuiet(now, ops)) return json({ error: 'It is quiet hours. Run the test in the daytime.' }, 409)
      const sent = await sendAll(db, to, true)
      return json({ ok: true, test: true, ...sent })
    }
    const [writeups, cards, cs, co] = await Promise.all([
      key('discipline_actions'), key('ops_items'),
      db.from('hr_cases').select('id,kind,status').eq('status', 'open'),
      db.from('hr_coaching').select('id,status,due_on,help_at,help_reply_at,handoff_at').eq('status', 'open'),
    ])
    if (cs.error || co.error) throw new Error('read failed: ' + (cs.error || co.error)?.message)
    const keys = waitingItems({ cases: arr(cs.data), writeups: arr(writeups), coaching: arr(co.data), today: chicagoDate(now), cards: arr(cards) })
    const state = st.data || { id: 'zach', seen: [], practice_log: [] }
    const fresh = newItems(keys, state.seen)
    const open = sendWindow(now, ops)
    const out: Record<string, unknown> = { live, dry, waiting: keys.length, new: fresh.length, window_open: open, alerted: false }
    if (dry) return json({ ok: true, ...out, would_text: !!to.phone, would_email: to.emails.length })
    const had = new Set(arr(state.seen).map(String))
    let seen = keys.filter((k) => had.has(k))           // a closed item drops off; one not yet told stays new
    const row: Record<string, unknown> = { id: 'zach', updated_at: now.toISOString() }
    if (fresh.length && open) {
      seen = keys
      out.alerted = true
      if (live) {
        const sent = await sendAll(db, to, false)
        Object.assign(out, sent)
        row.last_sent_at = now.toISOString()
      } else {
        const entry = { at: now.toISOString(), new: fresh.length, would_text: to.phone ? 1 : 0, would_email: to.emails.length }
        row.practice_log = [entry, ...arr(state.practice_log)].slice(0, 50)
        out.practice = entry
      }
    }
    row.seen = seen
    const w = st.data ? await db.from('hr_alert_state').update(row).eq('id', 'zach') : await db.from('hr_alert_state').insert(row)
    if (w.error) throw new Error('save failed: ' + w.error.message)
    await beat(db, true, JSON.stringify(out))
    return json({ ok: true, ...out })
  } catch (e) {
    if (!dry) await beat(db, false, String((e as Error)?.message || e))
    return json({ error: String((e as Error)?.message || e).slice(0, 300) }, 500)
  }
})

/* One text to his phone and one email to each address. Each that can't go raises a Needs Attention card. */
// deno-lint-ignore no-explicit-any
async function sendAll(db: any, to: { phone: string; emails: string[] }, test: boolean) {
  const ghl = { token: Deno.env.get('GHL_TOKEN') ?? '', locationId: Deno.env.get('GHL_LOCATION_ID') ?? '' }
  let texts = 0, emails = 0
  if (!to.phone && !to.emails.length) {
    await reportSendProblem(db, { sender: 'hr-alert', channel: 'sms', who: 'Zach', reasons: ['no phone or email is set for Zach\'s HR alerts (Desktop 965)'] })
    return { texts, emails }
  }
  if (to.phone && await textAdmin(db, ghl, { email: to.emails[0] || '', name: 'Zach', first: 'Zach', phone: to.phone }, test ? TEST_TEXT : TEXT)) texts++
  for (const email of to.emails) {
    if (!ghl.token || !ghl.locationId) {
      await reportSendProblem(db, { sender: 'hr-alert', channel: 'email', address: email, who: 'Zach', reasons: ['GoHighLevel is not set up (no token or location)'] })
      continue
    }
    const contactId = await ghlStaffContact(ghl, { channel: 'email', email, firstName: 'Zach', lastName: 'CC Staff' })
    if (!contactId) {
      await reportSendProblem(db, { sender: 'hr-alert', channel: 'email', address: email, who: 'Zach', reasons: ['no GoHighLevel contact could be found or made'], failed: true })
      continue
    }
    if (await ghlSendChecked(db, { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json' }, 'hr-alert',
      { channel: 'email', contactId, address: email, who: 'Zach' }, { subject: test ? TEST_SUBJECT : SUBJECT, html: emailHtml(test) })) emails++
  }
  return { texts, emails }
}

// deno-lint-ignore no-explicit-any
async function beat(db: any, ok: boolean, note: string) {
  try {
    await db.rpc('upsert_app_data_item', { target_key: 'automation_heartbeats',
      item: { id: 'hb_hr-alerts', automation: 'hr-alerts', at: new Date().toISOString(), ok, note: String(note).slice(0, 300) } })
  } catch { /* never blocks */ }
}
