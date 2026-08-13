// Supabase Edge Function: ghe-reminders  (shared hub project)
// -----------------------------------------------------------------------------
// GHE months are assigned by the state months in advance, which means a missed
// one is never a surprise — it is only ever something nobody was reminded about.
// This closes that gap without adding a board anyone has to remember to read.
//
// Runs daily, but only speaks on Mondays, the 1st, and the 20th, so it stays
// worth reading. Silence means nothing is due.
//
//   To each nurse   → the GHEs on her own caseload due this month
//   To the office   → anything overdue, plus GHEs sitting completed and signed
//                     but not yet uploaded into Fusion (the coordinator's job)
//
// Reads the CC Hub's nursing data from app_data with the service role and mails
// through GoHighLevel, the same path the 7 AM lead digest already uses.
// Fired by pg_cron 'daily-ghe-reminders'.
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const esc = (t: string) =>
  String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/* OUTREACH HOURS — 8am to 6pm, America/Chicago.
   Samantha's rule: nothing we send automatically may land before 8 or after 6.
   Enforced at the entry point rather than at each send site, so a message type
   added later cannot forget it. Nothing is marked as sent, so anything skipped
   goes out on the next run inside the window. */
const OUTREACH_TZ = 'America/Chicago'
function withinOutreachHours() {
  const h = Number(new Date().toLocaleString('en-US', { timeZone: OUTREACH_TZ, hour: '2-digit', hour12: false }))
  return h >= 8 && h < 18
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const dryRun = new URL(req.url).searchParams.get('dry') === '1'
  if (!dryRun && !withinOutreachHours())
    return json({ ok: true, skipped: 'outside outreach hours (8am-6pm America/Chicago)' })

  const url = new URL(req.url)
  const force = url.searchParams.get('force') === '1'   // for a manual check
  const dry = url.searchParams.get('dry') === '1'       // report, send nothing

  // Central time, because "the 1st" should mean the 1st in Springfield.
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }))
  const day = now.getDate()
  const dow = now.getDay()
  const month = now.toISOString().slice(0, 7)
  const speakToday = force || day === 1 || day === 20 || dow === 1
  if (!speakToday) return json({ ok: true, skipped: 'quiet day — GHE nudges go out Mondays, the 1st and the 20th' })

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const read = async (k: string) => {
    const { data } = await supabase.from('app_data').select('data').eq('key', k).maybeSingle()
    // deno-lint-ignore no-explicit-any
    return (Array.isArray(data?.data) ? data!.data : []) as any[]
  }
  const [clients, forms, staff, visits, coordinators] = await Promise.all(
    ['nurse_clients', 'ghe_forms', 'nurse_staff', 'nurse_visits', 'coordinator_staff'].map(read),
  )

  // A GHE window counts as handled if a form was written for that client in the
  // month, or the older visit log already recorded it completed.
  const handled = (clientId: string, clientName: string, m: string) =>
    forms.some((f) => String(f.client || '') === clientName && String(f.visit_date || '').slice(0, 7) === m) ||
    visits.some((v) => String(v.client_id) === String(clientId) && /^ghe/.test(String(v.type || '')) &&
      v.status === 'completed' && String(v.completed_on || '').slice(0, 7) === m)

  const dueNow: { client: string; nurse: string; month: string }[] = []
  const overdue: { client: string; nurse: string; month: string }[] = []

  for (const c of clients) {
    if (c.active === false) continue
    for (const w of ['ghe1', 'ghe2']) {
      const m = String(c[w] || '').slice(0, 7)
      if (!m) continue
      if (handled(c.id, c.name, m)) continue
      const row = { client: String(c.name || '(unnamed)'), nurse: String(c.assigned_nurse || ''), month: m }
      if (m === month) dueNow.push(row)
      else if (m < month) overdue.push(row)
    }
  }

  // Completed, signed, and waiting on the coordinator to put it into Fusion.
  const awaitingUpload = forms.filter((f) => f.status === 'ready')

  const ghlToken = Deno.env.get('GHL_TOKEN')
  const ghlLocation = Deno.env.get('GHL_LOCATION_ID')
  const headers = {
    Authorization: `Bearer ${ghlToken}`,
    Version: '2021-07-28',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  const mail = async (to: string, subject: string, html: string) => {
    if (dry || !ghlToken || !ghlLocation || !to) return false
    try {
      const up = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
        method: 'POST', headers,
        body: JSON.stringify({ locationId: ghlLocation, email: to, firstName: 'CC', lastName: 'Hub' }),
      })
      const uj = await up.json().catch(() => ({}))
      const contactId = uj?.contact?.id ?? uj?.id
      if (!contactId) return false
      const em = await fetch('https://services.leadconnectorhq.com/conversations/messages', {
        method: 'POST', headers,
        body: JSON.stringify({ type: 'Email', contactId, subject, html }),
      })
      return em.ok
    } catch { return false }
  }

  const list = (rows: { client: string; month: string }[]) =>
    '<ul>' + rows.map((r) => `<li><b>${esc(r.client)}</b> — ${esc(r.month)}</li>`).join('') + '</ul>'

  let sent = 0

  // 1. Each nurse hears only about her own caseload.
  for (const n of staff) {
    const email = String(n.email || '').trim()
    if (!email) continue
    const mine = dueNow.filter((r) => r.nurse === n.name)
    const late = overdue.filter((r) => r.nurse === n.name)
    if (!mine.length && !late.length) continue
    const html =
      `<p>Hi ${esc(String(n.name || '').split(' ')[0])},</p>` +
      (late.length ? `<p><b style="color:#B00020;">Past their window and still not done:</b></p>${list(late)}` : '') +
      (mine.length ? `<p><b>Due this month:</b></p>${list(mine)}<p>Call the client and set a time that suits you both, then fill in the GHE form in the hub when you visit.</p>` : '') +
      `<p style="color:#666;font-size:13px;">Caring Companions · Nurse Visits</p>`
    if (await mail(email, late.length ? `GHE overdue: ${late.length} to catch up` : `GHE due this month: ${mine.length}`, html)) sent++
  }

  // 2. The office hears about what is late or waiting on a Fusion upload.
  const unassigned = dueNow.filter((r) => !r.nurse)
  if (overdue.length || awaitingUpload.length || unassigned.length) {
    const html =
      (overdue.length ? `<p><b style="color:#B00020;">GHEs past their state window:</b></p>${list(overdue)}` : '') +
      (unassigned.length ? `<p><b>Due this month with no nurse assigned:</b></p>${list(unassigned)}</p>` : '') +
      (awaitingUpload.length
        ? `<p><b>Signed and waiting to go into Fusion:</b></p><ul>` +
          awaitingUpload.map((f) => `<li><b>${esc(String(f.client || ''))}</b> — visited ${esc(String(f.visit_date || ''))}, score ${esc(String(f.total ?? ''))}</li>`).join('') +
          `</ul><p>Open the GHE form in the hub, print the PDF, upload it into Fusion, then mark it Uploaded.</p>`
        : '') +
      `<p style="color:#666;font-size:13px;">Caring Companions · Nurse Visits</p>`
    const office = new Set<string>(['samantha@mo-care.com'])
    coordinators.forEach((c) => { const e = String(c.email || '').trim(); if (e) office.add(e) })
    for (const to of office) {
      if (await mail(to, `GHE watch: ${overdue.length} overdue, ${awaitingUpload.length} waiting for Fusion`, html)) sent++
    }
  }

  return json({
    ok: true, dry, day, month,
    due_this_month: dueNow.length, overdue: overdue.length,
    unassigned: unassigned.length, awaiting_fusion: awaitingUpload.length,
    emails_sent: sent,
  })
})
