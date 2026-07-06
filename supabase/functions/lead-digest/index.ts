// Supabase Edge Function: lead-digest (shared hub project)
// 7 AM daily email to the care coordinators: which lead follow-ups are due
// today and which are overdue. Reads the CC Hub's leads from app_data with
// the service role; emails via GoHighLevel (same GHL secrets the weekly
// backup email already uses). Fired by pg_cron 'daily-lead-digest'.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: row } = await supabase.from('app_data').select('data').eq('key', 'leads').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const leads: any[] = Array.isArray(row?.data) ? row!.data : []
  const { data: actRow } = await supabase.from('app_data').select('data').eq('key', 'activities').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const acts: any[] = (Array.isArray(actRow?.data) ? actRow!.data : []).filter((a) => !a.done_at && a.due)
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }) // YYYY-MM-DD Missouri time
  const open = leads.filter((l) => l.follow_up_due && l.status !== 'Converted' && l.status !== 'Lost')
  const overdue = open.filter((l) => l.follow_up_due < today)
  const dueToday = open.filter((l) => l.follow_up_due === today)
  const actsOverdue = acts.filter((a) => a.due < today)
  const actsToday = acts.filter((a) => a.due === today)
  if (!overdue.length && !dueToday.length && !actsOverdue.length && !actsToday.length)
    return json({ status: 'nothing due', date: today })

  const line = (l: { first_name?: string; last_name?: string; phone?: string; follow_up_due?: string; follow_up_branch?: string; interest_notes?: string }) =>
    `<li><b>${l.first_name ?? ''} ${l.last_name ?? ''}</b>${l.phone ? ` — ${l.phone}` : ''}` +
    `${l.follow_up_branch ? ` · ${l.follow_up_branch}` : ''} (due ${l.follow_up_due})` +
    `${l.interest_notes ? `<br><span style="color:#57606a">${String(l.interest_notes).slice(0, 120)}…</span>` : ''}</li>`

  const html =
    `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1f2a36;line-height:1.6;max-width:600px">` +
    `<h2 style="color:#0E3860;margin:0 0 10px">Lead follow-ups — ${today}</h2>` +
    (overdue.length ? `<p><b style="color:#DC2626">⚠️ Lead follow-ups overdue (${overdue.length}):</b></p><ul>${overdue.map(line).join('')}</ul>` : '') +
    (dueToday.length ? `<p><b style="color:#B45309">Lead follow-ups due today (${dueToday.length}):</b></p><ul>${dueToday.map(line).join('')}</ul>` : '') +
    (actsOverdue.length ? `<p><b style="color:#DC2626">⚠️ Activities overdue (${actsOverdue.length}):</b></p><ul>${actsOverdue.map((a) => `<li>${a.title} (due ${a.due})</li>`).join('')}</ul>` : '') +
    (actsToday.length ? `<p><b style="color:#B45309">Activities due today (${actsToday.length}):</b></p><ul>${actsToday.map((a) => `<li>${a.title}</li>`).join('')}</ul>` : '') +
    `<p>Open the <a href="https://cc.mo-care.com">Care Coordinator's Hub</a> → Leads to work the list (each lead's View Profile has the full conversation).</p></div>`

  const ghlToken = Deno.env.get('GHL_TOKEN')
  const ghlLocation = Deno.env.get('GHL_LOCATION_ID')
  if (!ghlToken || !ghlLocation) return json({ error: 'GHL not configured' }, 500)
  const headers = {
    Authorization: `Bearer ${ghlToken}`,
    Version: '2021-07-28',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  const recipients = (Deno.env.get('LEAD_DIGEST_EMAILS') || 'samantha@mo-care.com,krystal@mo-care.com')
    .split(',').map((s) => s.trim()).filter(Boolean)
  let sent = 0
  for (const to of recipients) {
    try {
      const up = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
        method: 'POST',
        headers,
        body: JSON.stringify({ locationId: ghlLocation, email: to, firstName: 'CC', lastName: 'Hub' }),
      })
      const upJson = await up.json().catch(() => ({}))
      const contactId = upJson?.contact?.id ?? upJson?.id
      if (!contactId) continue
      const em = await fetch('https://services.leadconnectorhq.com/conversations/messages', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: 'Email',
          contactId,
          subject: `Lead follow-ups: ${overdue.length ? overdue.length + ' overdue, ' : ''}${dueToday.length} due today`,
          html,
        }),
      })
      if (em.ok) sent++
    } catch { /* keep trying the rest */ }
  }
  return json({ status: 'sent', recipients: sent, overdue: overdue.length, due_today: dueToday.length })
})
