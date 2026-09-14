// Supabase Edge Function: lead-digest — THE MORNING BRIEF (shared hub project)
// -----------------------------------------------------------------------------
// Grown from the old 7am lead digest (same cron 'daily-lead-digest', same GHL
// email pipe) into a PERSONAL morning brief per coordinator (Samantha,
// 2026-09-13: "an email with priorities of the day... something they will
// actually use every day"). The rules that make it get read:
//   - only THEIR book, never the firehose
//   - pass-along notes from the quick form and new quick-form leads are
//     must-haves and always shown in full
//   - everything else is ranked and capped at five, with "plus N more"
//   - every line is one tap: tel: links dial, hub links open the right tab
//   - it always ends on one good line
// Recipients come from ops_settings.morning_brief_recipients (set in hub
// Settings); falls back to the old LEAD_DIGEST_EMAILS secret if unset.
// ?to=email&force=1 sends a single test brief regardless of time or marker.
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
const HUB = 'https://cc.mo-care.com'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const url = new URL(req.url)
  const testTo = (url.searchParams.get('to') || '').trim().toLowerCase()
  const force = url.searchParams.get('force') === '1' || !!testTo

  const chiNow = new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' })
  const today = chiNow.slice(0, 10)
  const chiHour = Number(chiNow.slice(11, 13))

  /* The cron fires at two UTC times so 6:45am survives daylight saving.
     Whichever run lands in the morning window sends; the marker stops the
     second one from sending twice. */
  if (!force) {
    if (chiHour < 6 || chiHour > 9) return json({ status: 'outside the morning window', chicago: chiNow })
    const { data: st } = await sb.from('app_data').select('data').eq('key', 'morning_brief_state').maybeSingle()
    const stArr: unknown[] = Array.isArray(st?.data) ? st!.data : []
    // deno-lint-ignore no-explicit-any
    if (stArr.some((m: any) => m?.id === 'sent_' + today)) return json({ status: 'already sent today', date: today })
  }

  // ── Load everything once ──
  const grab = async (key: string) => {
    const { data } = await sb.from('app_data').select('data').eq('key', key).maybeSingle()
    // deno-lint-ignore no-explicit-any
    return (Array.isArray(data?.data) ? data!.data : []) as any[]
  }
  const [leads, ops, checkins, svs, covCases, staff] = await Promise.all([
    grab('leads'), grab('ops_items'), grab('client_checkins'),
    grab('supervisory_visits'), grab('coverage_cases'), grab('coordinator_staff'),
  ])
  // deno-lint-ignore no-explicit-any
  let opsSettings: Record<string, any> = {}
  {
    const { data } = await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
    if (data?.data && !Array.isArray(data.data)) opsSettings = data.data
  }

  // ── Who gets a brief ──
  // deno-lint-ignore no-explicit-any
  let recips: { name: string; email: string }[] = (Array.isArray(opsSettings.morning_brief_recipients)
    ? opsSettings.morning_brief_recipients : [])
    .map((r: any) => ({ name: String(r?.name || ''), email: String(r?.email || '').toLowerCase() }))
    .filter((r: any) => r.email.includes('@'))
  if (!recips.length) {
    recips = (Deno.env.get('LEAD_DIGEST_EMAILS') || 'samantha@mo-care.com,krystal@mo-care.com')
      .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
      .map((email) => {
        // deno-lint-ignore no-explicit-any
        const p = staff.find((s: any) => String(s.email || '').toLowerCase() === email)
        return { name: String(p?.name || email.split('@')[0]), email }
      })
  }
  if (testTo) recips = recips.filter((r) => r.email === testTo)
    .concat(recips.some((r) => r.email === testTo) ? [] : [{ name: testTo.split('@')[0], email: testTo }])

  // ── Shared computations ──
  const first = (n: unknown) => String(n || '').trim().split(/\s+/)[0].toLowerCase()
  const nameMatch = (recipName: string, coordinator: unknown) => {
    const c = String(coordinator || '').trim().toLowerCase()
    if (!c) return false
    return c === recipName.toLowerCase() || first(c) === first(recipName)
  }
  const now = Date.now()
  const openOps = ops.filter((i) => i?.status === 'open')
  const parked = (i: { sub_state?: string; check_back?: string }) => {
    if (i.sub_state !== 'waiting' || !i.check_back) return i.sub_state === 'waiting'
    return String(i.check_back).slice(0, 10) > today
  }
  const isPassAlong = (i: { opened_by?: string }) => i.opened_by === 'quick-capture'
  const dueMs = (i: { due?: string }) => { const t = Date.parse(String(i.due || '')); return isNaN(t) ? Infinity : t }
  const endOfToday = new Date(today + 'T23:59:59').getTime() + 5 * 3600000 // rough Chicago guard is fine here
  const openLeads = leads.filter((l) => l?.status !== 'Converted' && l?.status !== 'Lost')
  const quickish = (l: { source?: string }) => /quick capture|assessment booking/i.test(String(l.source || ''))
  const covOpen = covCases.filter((c) => c?.status === 'open')

  // Client check-ins past due, per client (latest wins)
  const latestCi = new Map<string, { due: string; date: string; coordinator: string }>()
  for (const c of checkins) {
    if (!c?.client_name) continue
    const prev = latestCi.get(c.client_name)
    if (!prev || (c.checkin_date || '') > prev.date)
      latestCi.set(c.client_name, { due: c.next_checkin_due || '', date: c.checkin_date || '', coordinator: c.coordinator || '' })
  }
  const svOverdue = svs.filter((v) => v?.due_date && v.due_date < today && !v.completed_date)

  const btn = (href: string, label: string) =>
    `<a href="${href}" style="display:inline-block;background:#0E3860;color:#ffffff;text-decoration:none;font-weight:700;font-size:13px;padding:8px 16px;border-radius:8px;">${esc(label)}</a>`
  const sect = (title: string, color: string, body: string) =>
    `<div style="margin:18px 0 0;"><div style="font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:${color};border-bottom:2px solid ${color};padding-bottom:4px;margin-bottom:8px;">${title}</div>${body}</div>`
  const row = (main: string, sub: string, href: string, act: string) =>
    `<table role="presentation" width="100%" style="border-collapse:collapse;"><tr>` +
    `<td style="padding:7px 0;border-bottom:1px solid #E2E8F0;font-family:Arial,sans-serif;">` +
    `<div style="font-size:14.5px;color:#1f2a36;">${main}</div>` +
    (sub ? `<div style="font-size:12.5px;color:#6B7280;margin-top:1px;">${sub}</div>` : '') +
    `</td><td align="right" style="padding:7px 0 7px 10px;border-bottom:1px solid #E2E8F0;white-space:nowrap;">` +
    `<a href="${href}" style="color:#54BDB8;font-weight:700;font-size:12.5px;text-decoration:none;">${esc(act)} →</a></td></tr></table>`
  const telLink = (p: unknown) => {
    const d = String(p || '').replace(/\D/g, '')
    return d.length >= 10 ? `<a href="tel:1${d.slice(-10)}" style="color:#0E3860;font-weight:700;text-decoration:none;">${esc(p)}</a>` : esc(String(p || ''))
  }

  let sent = 0
  const summaries: Record<string, unknown>[] = []
  const ghlToken = Deno.env.get('GHL_TOKEN')
  const ghlLocation = Deno.env.get('GHL_LOCATION_ID')
  if (!ghlToken || !ghlLocation) return json({ error: 'GHL not configured' }, 500)
  const headers = { Authorization: `Bearer ${ghlToken}`, Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' }

  for (const r of recips) {
    const myFirst = r.name.split(/\s+/)[0] || 'there'
    const mailLc = r.email

    // 1. MUST-HAVE: pass-alongs owned by them, all of them, no cap.
    const myPass = openOps.filter((i) => isPassAlong(i) && String(i.owner || '').toLowerCase() === mailLc)
    // 2. MUST-HAVE: leads to call. Theirs or unassigned, due today or late.
    const myLeads = openLeads.filter((l) =>
      (nameMatch(r.name, l.assigned_coordinator) || !String(l.assigned_coordinator || '').trim()) &&
      l.follow_up_due && l.follow_up_due <= today)
      .sort((a, b) => String(a.follow_up_due).localeCompare(String(b.follow_up_due)))
    // 3. Ranked priorities: their other open ops work, escalated then latest first.
    const myOps = openOps.filter((i) => !isPassAlong(i) && String(i.owner || '').toLowerCase() === mailLc && !parked(i))
      .filter((i) => i.sub_state === 'escalated' || (i.escalation_level || 0) > 0 || dueMs(i) <= endOfToday)
      .sort((a, b) => {
        const ea = (a.sub_state === 'escalated' || (a.escalation_level || 0) > 0) ? 0 : 1
        const eb = (b.sub_state === 'escalated' || (b.escalation_level || 0) > 0) ? 0 : 1
        if (ea !== eb) return ea - eb
        const ua = a.urgency === 'high' ? 0 : 1, ub = b.urgency === 'high' ? 0 : 1
        if (ua !== ub) return ua - ub
        return dueMs(a) - dueMs(b)
      })
    // 4. Unowned work waiting for a hand, shown to everyone so nothing rots.
    const triage = openOps.filter((i) => !String(i.owner || '').trim() && dueMs(i) <= endOfToday)
      .sort((a, b) => dueMs(a) - dueMs(b))
    // Clocks in their book
    const myCi = [...latestCi.entries()].filter(([, v]) => v.due && v.due < today && (nameMatch(r.name, v.coordinator) || !v.coordinator))
    // The good line
    const clearedYesterday = ops.filter((i) => i?.status === 'done' && String(i.closed_by || '').toLowerCase() === mailLc &&
      String(i.closed_at || '').slice(0, 10) >= new Date(Date.parse(today) - 864e5).toISOString().slice(0, 10) &&
      String(i.closed_at || '').slice(0, 10) < today).length

    const top = myOps.slice(0, 5)
    const moreOps = myOps.length - top.length
    const leadTop = myLeads.slice(0, 8)
    const moreLeads = myLeads.length - leadTop.length
    const triTop = triage.slice(0, 5)

    let body = ''
    if (myPass.length) body += sect(`Passed along to you (${myPass.length})`, '#B45309',
      myPass.map((i) => row(`<b>${esc(i.about || i.title || '')}</b>`,
        esc(String(i.detail || '').slice(0, 140)) + (i.urgency === 'high' ? ' · <b style="color:#DC2626;">urgent</b>' : ''),
        `${HUB}/#mywork`, 'Open')).join(''))
    if (leadTop.length) body += sect(`Leads to call (${myLeads.length})`, '#0E3860',
      leadTop.map((l) => row(
        `<b>${esc([l.first_name, l.last_name].filter(Boolean).join(' '))}</b>${l.phone ? ' · ' + telLink(l.phone) : ''}` +
        (quickish(l) ? ' <span style="background:#FFF4DE;color:#B45309;font-size:11px;font-weight:700;padding:1px 7px;border-radius:99px;">quick form</span>' : ''),
        (l.follow_up_due < today ? `<b style="color:#DC2626;">was due ${esc(l.follow_up_due)}</b>` : 'due today') +
        (l.interest_notes ? ' · ' + esc(String(l.interest_notes).slice(0, 100)) : ''),
        `${HUB}/#leadboard`, 'Open')).join('') +
      (moreLeads > 0 ? `<div style="font-size:12.5px;color:#6B7280;padding-top:6px;">plus ${moreLeads} more on the Leads board</div>` : ''))
    if (top.length) body += sect(`Your top priorities (${myOps.length})`, '#DC2626',
      top.map((i) => row(`<b>${esc(i.about || i.title || '')}</b>`,
        ((i.sub_state === 'escalated' || (i.escalation_level || 0) > 0) ? '<b style="color:#DC2626;">escalated</b> · ' : '') +
        (dueMs(i) < now ? `<b style="color:#DC2626;">late</b>` : 'due today'),
        `${HUB}/#mywork`, 'Open')).join('') +
      (moreOps > 0 ? `<div style="font-size:12.5px;color:#6B7280;padding-top:6px;">plus ${moreOps} more in My Work</div>` : ''))
    if (triTop.length) body += sect(`Nobody owns these yet (${triage.length})`, '#6B7280',
      triTop.map((i) => row(esc(i.about || i.title || ''), esc(String(i.detail || '').slice(0, 90)),
        `${HUB}/#ops`, 'Claim')).join(''))
    const clocks: string[] = []
    if (myCi.length) clocks.push(`<a href="${HUB}/#checkins" style="color:#0E3860;">${myCi.length} client check-in${myCi.length > 1 ? 's' : ''} past due</a>`)
    if (svOverdue.length) clocks.push(`<a href="${HUB}/#supervisory" style="color:#0E3860;">${svOverdue.length} supervisory visit${svOverdue.length > 1 ? 's' : ''} past due</a>`)
    if (covOpen.length) clocks.push(`<a href="${HUB}/#coverage" style="color:#0E3860;">${covOpen.length} open coverage case${covOpen.length > 1 ? 's' : ''}</a>`)
    if (clocks.length) body += sect('Also ticking', '#54BDB8',
      `<div style="font-size:13.5px;color:#1f2a36;line-height:1.9;">${clocks.join('<br>')}</div>`)

    const nothing = !myPass.length && !leadTop.length && !top.length && !triTop.length && !clocks.length
    const good = nothing
      ? `Nothing overdue, nothing waiting. You are ahead. ☀️`
      : (clearedYesterday > 0 ? `You cleared ${clearedYesterday} item${clearedYesterday > 1 ? 's' : ''} yesterday. Keep going. 💪`
        : `One at a time, top to bottom, and this list is gone by lunch.`)

    const counts: string[] = []
    if (myPass.length) counts.push(`${myPass.length} pass-along${myPass.length > 1 ? 's' : ''}`)
    if (myLeads.length) counts.push(`${myLeads.length} lead${myLeads.length > 1 ? 's' : ''} to call`)
    if (myOps.length) counts.push(`${myOps.length} priorit${myOps.length > 1 ? 'ies' : 'y'}`)
    const subject = nothing ? `Your morning, ${myFirst}: all clear ☀️`
      : `Your morning, ${myFirst}: ${counts.join(', ')}`

    const html =
      `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1f2a36;">` +
      `<div style="background:#0E3860;border-radius:12px 12px 0 0;padding:18px 22px;">` +
      `<div style="color:#FFC671;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;">Caring Companions · Morning Brief</div>` +
      `<div style="color:#ffffff;font-size:21px;font-weight:800;margin-top:2px;">Good morning, ${esc(myFirst)}</div>` +
      `<div style="color:#9fb6cc;font-size:13px;">${new Date(today + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>` +
      `</div><div style="background:#ffffff;border:1px solid #E2E8F0;border-top:none;border-radius:0 0 12px 12px;padding:6px 22px 20px;">` +
      (nothing ? `<p style="font-size:15px;">${good}</p>` : body +
        `<p style="font-size:13.5px;color:#6B7280;margin-top:16px;">${good}</p>`) +
      `<div style="margin-top:14px;">${btn(`${HUB}/#mywork`, 'Start my day in the hub')}</div>` +
      `</div><div style="text-align:center;color:#9aa3ad;font-size:11.5px;padding:12px;">Sent at 6:45am by your hub. Reply-to goes nowhere; the hub is the conversation.</div></div>`

    try {
      const up = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
        method: 'POST', headers,
        body: JSON.stringify({ locationId: ghlLocation, email: r.email, firstName: myFirst, lastName: 'CC Staff' }),
      })
      // deno-lint-ignore no-explicit-any
      const uj: any = await up.json().catch(() => ({}))
      const contactId = uj?.contact?.id ?? uj?.id
      if (!contactId) { summaries.push({ to: r.email, error: 'no GHL contact' }); continue }
      const em = await fetch('https://services.leadconnectorhq.com/conversations/messages', {
        method: 'POST', headers,
        body: JSON.stringify({ type: 'Email', contactId, subject, html }),
      })
      if (em.ok) { sent++; summaries.push({ to: r.email, passAlongs: myPass.length, leads: myLeads.length, priorities: myOps.length }) }
      else summaries.push({ to: r.email, error: 'GHL email ' + em.status })
    } catch (e) { summaries.push({ to: r.email, error: String(e) }) }
  }

  if (!testTo && sent > 0) {
    await sb.rpc('upsert_app_data_item', { target_key: 'morning_brief_state',
      item: { id: 'sent_' + today, at: new Date().toISOString(), sent } })
  }
  return json({ status: 'sent', date: today, recipients: sent, briefs: summaries })
})
