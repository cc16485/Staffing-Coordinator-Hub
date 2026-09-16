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
// This runs hourly and checks that every expected automation has beaten
// inside its window and that its last beat was healthy. Anything wrong goes to
// the office by text and email — the same applicant_alerts list that announces
// good applicants — with a 6-hour suppression per unchanged problem signature,
// so a day-long outage alerts a handful of times, not twenty-four. A run with
// nothing wrong sends nothing.
//
// Scheduled by pg_cron: originally daily ('daily-automation-watchdog',
// cron-automation-watchdog.sql in the care-coordinator-hub repo); hourly once
// Cara's heartbeat activates (cron-cara-heartbeat.sql STEP 5 replaces the
// daily job — an every-few-minutes coverage engine must not be able to die
// quietly for a whole day).
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
  /* Cara's heartbeat (crons in cron-cara-heartbeat.sql): both run every few
     minutes, so a beat older than an hour means the cron or the function is
     down — and with coverage_send_live on, a silent engine means waves,
     escalations and closure texts have quietly stopped. The beats are
     written at the END of a successful run, so cron firing into a failing
     function still goes stale here rather than reporting healthy. */
  { name: 'coverage-watch',     hours: 1,  what: 'AxisCare call-off detection (Cara case opening)' },
  { name: 'coverage-run',       hours: 1,  what: 'Cara callout waves, exhaustion escalation and closure texts' },
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
  const problemNames: string[] = []
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
      problemNames.push(e.name + ':never')
      continue
    }
    const ageH = (Date.now() - new Date(last.at).getTime()) / 3_600_000
    if (!(ageH <= e.hours)) {
      problems.push(`${e.name} last ran ${Math.round(ageH)}h ago (allowed ${e.hours}h) — ` +
        `${e.what} ${ageH > e.hours * 3 ? 'has' : 'may have'} stopped.`)
      problemNames.push(e.name + ':stale')
    } else if (last.ok === false) {
      problems.push(`${e.name} is running but failing: ${String(last.note || last.error || 'no detail')}`)
      problemNames.push(e.name + ':failing')
    }
  }

  /* The office hears on the channel that already announces applicants.
     HOURLY-SAFE ALERTING: the watchdog may now run every hour, and an
     outage that lasts a day must not text the office the same warning
     twenty-four times. The alert signature is the SET of problems (which
     automations, which kind), not the wording: an unchanged signature is
     suppressed for six hours, a changed one (new automation down, or a
     down one now failing differently) alerts immediately, and a persisting
     outage re-alerts at most every six hours until fixed. Problems are
     still computed and returned on every run — only the send is gated. */
  let alerted = 0
  let suppressed = false
  const sig = problemNames.slice().sort().join('|')
  if (problems.length && !dry) {
    try {
      const { data: wsRow } = await supabase.from('app_data').select('data').eq('key', 'watchdog_state').maybeSingle()
      // deno-lint-ignore no-explicit-any
      const ws = (Array.isArray(wsRow?.data) ? wsRow!.data : []).find((x: any) => x?.id === 'alert_state')
      const REALERT_H = 6
      if (ws && ws.sig === sig
          && (Date.now() - new Date(String(ws.at || 0)).getTime()) < REALERT_H * 3_600_000) {
        suppressed = true
      }
    } catch { /* a broken state store must not silence alerts */ }
  }
  if (problems.length && !dry && !suppressed) {
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
      if (alerted) {
        try {
          await supabase.rpc('upsert_app_data_item', { target_key: 'watchdog_state',
            item: { id: 'alert_state', sig, at: new Date().toISOString(), problems: problemNames } })
        } catch { /* losing the suppression state only risks an extra alert */ }
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

  return json({ ok: true, dry, checked: EXPECTED.length, problems, alerted, suppressed })
})
