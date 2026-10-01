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
import { outreachGate } from '../_shared/outreach.ts'
import { jobCaller } from '../_shared/job-auth.ts'
import { ghlSendChecked, reportSendProblem } from '../_shared/send-problems.ts'
import { ghlStaffContact } from '../_shared/staff-contact.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const esc = (t: string) =>
  String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/* HEARTBEAT: one replaced row under app_data 'automation_heartbeats' (fixed
   id, never grows). A quiet day still beats; a run that never happened has no
   beat — automation-watchdog reads these every morning. Inlined so a
   dashboard paste-deploy stays one file. */
// deno-lint-ignore no-explicit-any
async function beat(supabase: any, ok: boolean, note: string) {
  try {
    await supabase.rpc('upsert_app_data_item', {
      target_key: 'automation_heartbeats',
      item: { id: 'hb_ghe-reminders', automation: 'ghe-reminders',
              at: new Date().toISOString(), ok, note: String(note).slice(0, 300) },
    })
  } catch (e) { console.error('[ghe-reminders] heartbeat failed', e) }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  /* J1 (2026-09-29): only its daily schedule or the owner's server key. Everyone else, the public key included, is refused
     before anything is read or sent. */
  const caller = await jobCaller(req)
  if (!caller) return json({ error: 'not allowed' }, 401)
  if (new URL(req.url).searchParams.get('auth_check') === '1') return json({ ok: true, caller })
  /* proactive_external: we start this, so weekdays only, 8am-6pm.
     Policy lives in _shared/outreach.ts. Its practice run (dry=1) really sends nothing, so it may look at any hour. */
  const gate = outreachGate(req, 'proactive_external', json, { practiceRun: true })
  if (gate) return gate

  const url = new URL(req.url)
  const force = url.searchParams.get('force') === '1'   // for a manual check
  const dry = url.searchParams.get('dry') === '1'       // report, send nothing

  // Central time, because "the 1st" should mean the 1st in Springfield.
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }))
  const day = now.getDate()
  const dow = now.getDay()
  const month = now.toISOString().slice(0, 7)
  /* Client before the quiet-day exit, so a quiet day can still beat. */
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const speakToday = force || day === 1 || day === 20 || dow === 1
  if (!speakToday) {
    if (!dry) await beat(supabase, true, 'quiet day')
    return json({ ok: true, skipped: 'quiet day — GHE nudges go out Mondays, the 1st and the 20th' })
  }
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
  /* NO SILENT FAILURES (2026-10-01): a daily cron with nobody watching, and every recipient is staff (a nurse or the
     office), so a reminder that doesn't go out raises a Needs Attention card as 'staff-alert'. A dry run still
     returns before anything is sent or raised. */
  const mail = async (to: string, subject: string, html: string, who?: string) => {
    if (dry || !ghlToken || !ghlLocation || !to) return false
    const failed = (why: string) => reportSendProblem(supabase, { sender: 'staff-alert', channel: 'email', address: to, who, reasons: [why], failed: true })
    try {
      /* ONE CONTACT (2026-10-01): the reminder goes to the contact found by the one-contact rule for email. */
      const contactId = await ghlStaffContact({ token: ghlToken, locationId: ghlLocation }, { channel: 'email', email: to, firstName: 'CC', lastName: 'Hub' })
      if (!contactId) { await failed('no GoHighLevel contact'); return false }
      return await ghlSendChecked(supabase, headers, 'staff-alert', { channel: 'email', contactId, address: to, who }, { subject, html })
    } catch (e) { await failed('GoHighLevel could not be reached: ' + String((e as Error)?.message ?? e).slice(0, 80)); return false }
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
    if (await mail(email, late.length ? `GHE overdue: ${late.length} to catch up` : `GHE due this month: ${mine.length}`, html, String(n.name || ''))) sent++
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

  if (!dry) await beat(supabase, true,
    `due ${dueNow.length}, overdue ${overdue.length}, awaiting Fusion ${awaitingUpload.length}, emails ${sent}`)
  return json({
    ok: true, dry, day, month,
    due_this_month: dueNow.length, overdue: overdue.length,
    unassigned: unassigned.length, awaiting_fusion: awaitingUpload.length,
    emails_sent: sent,
  })
})
