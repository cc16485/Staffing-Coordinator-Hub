// Supabase Edge Function: automation-watchdog  (shared hub project)
// -----------------------------------------------------------------------------
// The watcher of the watchers.
//
// Every scheduled automation now leaves a heartbeat: one row per automation
// under app_data 'automation_heartbeats', replaced on every real run. A run
// that found nothing to do still beats. A run that never happened leaves no
// beat — and until this function existed, those two were indistinguishable:
// if the messaging token expired, every confirmation, reminder, nudge and
// alert stopped, and every day looked like a quiet day.
//
// This runs each morning and checks that every expected automation has beaten
// inside its window and that its last beat was healthy. Anything wrong goes to
// the office by text and email — the same applicant_alerts list that announces
// good applicants. A morning with nothing wrong sends nothing.
//
// Runs daily by pg_cron (job 'daily-automation-watchdog' — created by
// cron-automation-watchdog.sql in the care-coordinator-hub repo).
// Supports ?dry=1 to report without sending.
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

/* What should be beating, and how stale is too stale. Windows are generous on
   purpose: reference-chase and ghe-reminders sit out weekends, so their
   Monday-morning silence is three days old and healthy. obligations writes
   its own richer log (app_data 'automation_log') rather than a heartbeat,
   so it is checked there. */
const EXPECTED = [
  { name: 'interview-messages', hours: 2,  what: 'interview confirmations, reminders and nudges' },
  { name: 'reference-chase',    hours: 80, what: 'reference asks and chasing' },
  { name: 'hire-intake-purge',  hours: 30, what: 'the SSN purge the apply page promises' },
  { name: 'ghe-reminders',      hours: 80, what: 'GHE nurse reminders' },
  { name: 'obligations',        hours: 30, what: 'compliance obligations', from: 'automation_log' },
]

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const dry = new URL(req.url).searchParams.get('dry') === '1'

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const readKey = async (k: string) => {
    const { data } = await supabase.from('app_data').select('data').eq('key', k).maybeSingle()
    // deno-lint-ignore no-explicit-any
    return (Array.isArray(data?.data) ? data!.data : []) as any[]
  }
  const [beats, log] = await Promise.all([readKey('automation_heartbeats'), readKey('automation_log')])

  const problems: string[] = []
  for (const e of EXPECTED) {
    // deno-lint-ignore no-explicit-any
    let last: any = null
    if (e.from === 'automation_log') {
      for (const row of log) if (row?.automation === e.name && (!last || String(row.at) > String(last.at))) last = row
    } else {
      last = beats.find((b) => b?.automation === e.name) ?? null
    }
    if (!last) {
      problems.push(`${e.name} has never reported a run — ${e.what} may not be running at all ` +
        `(expected shortly after its next scheduled run; if this persists, its cron or deploy is missing).`)
      continue
    }
    const ageH = (Date.now() - new Date(last.at).getTime()) / 3_600_000
    if (!(ageH <= e.hours)) {
      problems.push(`${e.name} last ran ${Math.round(ageH)}h ago (allowed ${e.hours}h) — ` +
        `${e.what} ${ageH > e.hours * 3 ? 'has' : 'may have'} stopped.`)
    } else if (last.ok === false) {
      problems.push(`${e.name} is running but failing: ${String(last.note || last.error || 'no detail')}`)
    }
  }

  /* The office hears on the channel that already announces applicants. */
  let alerted = 0
  if (problems.length && !dry) {
    const ghlToken = Deno.env.get('GHL_TOKEN')
    const ghlLocation = Deno.env.get('GHL_LOCATION_ID')
    const { data: alertTo } = await supabase.from('applicant_alerts').select('*').eq('active', true)
    if (ghlToken && ghlLocation && (alertTo ?? []).length) {
      const h = { Authorization: `Bearer ${ghlToken}`, Version: '2021-07-28',
                  'Content-Type': 'application/json', Accept: 'application/json' }
      const line = `Hub watchdog: ${problems.length} automation problem${problems.length > 1 ? 's' : ''}. ` +
        problems.map((p) => p.split(' — ')[0]).join('; ') + '. Ask Claude to investigate.'
      const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#1f2a36">` +
        `<p><b>The hub's automation watchdog found ${problems.length} problem${problems.length > 1 ? 's' : ''} this morning:</b></p>` +
        `<ul>` + problems.map((p) => `<li>${p}</li>`).join('') + `</ul>` +
        `<p>Nothing here reaches applicants or clients by itself — these are background jobs that have gone quiet ` +
        `or are erroring. Tell Claude what this email says and it can dig in.</p>` +
        `<p style="color:#57606a">Caring Companions · automation watchdog</p></div>`
      for (const t of alertTo!) {
        try {
          const r = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
            method: 'POST', headers: h,
            body: JSON.stringify({ locationId: ghlLocation, ...(t.phone ? { phone: t.phone } : {}),
              ...(t.email ? { email: t.email } : {}), firstName: t.name ?? 'Team' }),
          })
          const j = await r.json().catch(() => ({}))
          const cid = j?.contact?.id ?? j?.id ?? null
          if (!cid) continue
          if (t.phone) await fetch('https://services.leadconnectorhq.com/conversations/messages', {
            method: 'POST', headers: h, body: JSON.stringify({ type: 'SMS', contactId: cid, message: line }) })
          if (t.email) await fetch('https://services.leadconnectorhq.com/conversations/messages', {
            method: 'POST', headers: h, body: JSON.stringify({ type: 'Email', contactId: cid,
              subject: `Hub watchdog: ${problems.length} automation problem${problems.length > 1 ? 's' : ''}`, html }) })
          alerted++
        } catch (e) { console.error('[automation-watchdog] alert send failed', e) }
      }
    } else {
      console.error('[automation-watchdog] problems found but nobody to tell:', problems)
    }
  }

  /* The watchdog beats too, so a second one could someday watch it — and so
     the Control Centre can show it alive. */
  if (!dry) {
    try {
      await supabase.rpc('upsert_app_data_item', {
        target_key: 'automation_heartbeats',
        item: { id: 'hb_automation-watchdog', automation: 'automation-watchdog',
                at: new Date().toISOString(), ok: true,
                note: problems.length ? `alerted on ${problems.length}` : 'all healthy' },
      })
    } catch (e) { console.error('[automation-watchdog] heartbeat failed', e) }
  }

  return json({ ok: true, dry, checked: EXPECTED.length, problems, alerted })
})
