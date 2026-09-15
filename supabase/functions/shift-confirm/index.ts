// Supabase Edge Function: shift-confirm  (shared hub project)
// -----------------------------------------------------------------------------
// Cara's Confirmations role (phoebe.work parity, "matching their updates",
// 2026-09-15): every morning, each caregiver with visits today gets ONE text
// listing all of them — never one text per shift (their Aug 29 lesson). A
// caregiver who sees "9:00a-1:00p with Mary, 2:00p-6:00p with John" at 6:45am
// surfaces the forgotten dentist appointment BEFORE it becomes a 9:03am
// no-clock-in, which is the whole point: this function exists to starve
// timekeeper-watch and the Coverage Help board of work.
//
// What a reply does (phase 1): lands in the GHL inbox like any other text —
// contacts are tagged `confirm-asked` so a reply workflow can route "can't
// make it" onto the hub later, the same wiring pattern as coverage-asked.
// The office already staffs that inbox; a problem reply at 6:50am is exactly
// what the morning person should see first.
//
// SKIP LIST: shares ops_settings.cara_skip with timekeeper-watch — entries
// { caregiver, client, scope } where scope is 'confirm', 'clock' or 'all'.
// A skipped visit is left OFF the list text; a caregiver whose every visit
// is skipped gets no text at all.
//
// ONE SEND PER CAREGIVER PER DAY, enforced by state, not by the schedule:
// app_data 'confirm_log' holds a deterministic id per caregiver per day, so
// a cron retry or a second manual run can never double-text anybody.
//
// ⚠ DRY RUN BY DEFAULT. ops_settings.confirm_live === true turns sending on;
//   ?dry=1 forces a dry run at any time. The cron runs at 12:00 UTC (6-7am
//   Springfield depending on DST) — classified routine_internal: staff, about
//   their own workday, before the external outreach window on purpose.
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { normalisePhone, contactForOutbound } from '../_shared/outreach.ts'

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b, null, 2), { status: s, headers: { 'Content-Type': 'application/json' } })

const AC_VERSION = Deno.env.get('AXISCARE_API_VERSION') || '2023-10-01'
function axisCreds() {
  const order = ['AXISCARE_VISITS_TOKEN', 'AXISCARE_API_KEY', 'AXISCARE_TOKEN']
  let token = ''
  for (const n of order) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  return { token, site: /^\d+$/.test(site) ? site : '' }
}
function callerRole(req: Request): string {
  try {
    const tok = String(req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    const payload = JSON.parse(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return String(payload?.role || '')
  } catch { return '' }
}
const chiToday = () => new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
const nameKeyOf = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '')
// deno-lint-ignore no-explicit-any
const rowsOf = (v: any): any[] => Array.isArray(v) ? v
  : (v && typeof v === 'object') ? Object.values(v) : []

/* "14:00" -> "2:00p" — texts read like a person wrote them. */
function friendlyTime(hhmm: string): string {
  const m = hhmm.match(/^(\d{2}):(\d{2})$/)
  if (!m) return hhmm
  let h = Number(m[1])
  const suffix = h >= 12 ? 'p' : 'a'
  h = h % 12 || 12
  return `${h}:${m[2]}${suffix}`
}

// deno-lint-ignore no-explicit-any
function skipMatch(skips: any[], caregiverName: string, clientFirst: string): boolean {
  const cgk = nameKeyOf(caregiverName), clk = nameKeyOf(clientFirst)
  for (const s of skips) {
    const sc = String(s?.scope ?? 'all').toLowerCase()
    if (sc !== 'all' && sc !== 'confirm') continue
    const wantCg = nameKeyOf(String(s?.caregiver ?? ''))
    const wantCl = nameKeyOf(String(s?.client ?? ''))
    if (!wantCg && !wantCl) continue
    if (wantCg && wantCg !== cgk) continue
    if (wantCl && wantCl !== clk) continue
    return true
  }
  return false
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200 })
  const t0 = Date.now()
  const role = callerRole(req)

  const { data: setRow } = await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const settings: any = setRow?.data ?? {}
  const forceDry = new URL(req.url).searchParams.get('dry') === '1'
  const live = settings.confirm_live === true && !forceDry
  // deno-lint-ignore no-explicit-any
  const skips: any[] = Array.isArray(settings.cara_skip) ? settings.cara_skip : []

  const { token, site } = axisCreds()
  if (!token || !site) return json({ error: 'AxisCare credentials not set on this project' }, 502)
  const ghl = { token: Deno.env.get('GHL_TOKEN') || Deno.env.get('GHL_API_KEY') || '',
                locationId: Deno.env.get('GHL_LOCATION_ID') || '' }

  // ── Today's visits. ──
  const day = chiToday()
  // deno-lint-ignore no-explicit-any
  const visits: any[] = []
  let fetchError: string | null = null
  try {
    let url: string | null = `https://${site}.axiscare.com/api/visits?startDate=${day}&endDate=${day}`
    for (let page = 0; url && page < 12; page++) {
      const r: Response = await fetch(url, { headers: {
        Authorization: `Bearer ${token}`, Accept: 'application/json',
        'X-AxisCare-Api-Version': AC_VERSION } })
      if (!r.ok) { fetchError = `AxisCare responded ${r.status}`; break }
      // deno-lint-ignore no-explicit-any
      const j: any = await r.json().catch(() => ({}))
      for (const v of rowsOf(j?.results?.visits ?? j?.visits)) if (!v?.removed) visits.push(v)
      url = j?.results?.nextPage ?? j?.nextPage ?? j?.results?.nextPageUrl ?? j?.nextPageUrl ?? null
    }
  } catch (err) { fetchError = String(err) }
  if (fetchError && !visits.length) return json({ error: fetchError }, 502)

  // ── Group by caregiver, skip-list applied per visit. ──
  type Shift = { start: string; end: string; client: string }
  const byCg = new Map<string, { name: string; axiscare_id: string; shifts: Shift[] }>()
  let skippedVisits = 0
  for (const v of visits) {
    if (v?.caregiver?.id == null) continue
    const cgId = String(v.caregiver.id)
    const cgName = [String(v.caregiver.firstName ?? '').trim(), String(v.caregiver.lastName ?? '').trim()]
      .filter(Boolean).join(' ') || ('caregiver ' + cgId)
    const clientFirst = String(v?.client?.firstName ?? '').trim() || 'your client'
    if (skipMatch(skips, cgName, clientFirst)) { skippedVisits++; continue }
    const start = String(v?.scheduledStartDate ?? v?.startDate ?? '').slice(11, 16)
    const end = String(v?.scheduledEndDate ?? v?.endDate ?? '').slice(11, 16)
    if (!start) continue
    const g = byCg.get(cgId) ?? { name: cgName, axiscare_id: cgId, shifts: [] }
    g.shifts.push({ start, end, client: clientFirst })
    byCg.set(cgId, g)
  }
  for (const g of byCg.values()) g.shifts.sort((a, b) => a.start.localeCompare(b.start))

  // ── Roster phones + already-sent state. ──
  const { data: cgRow } = await sb.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const roster = (Array.isArray(cgRow?.data) ? cgRow!.data : []) as any[]
  // deno-lint-ignore no-explicit-any
  const byAxis = new Map<string, any>(), byName = new Map<string, any>()
  for (const cg of roster) {
    if (cg?.active === false) continue
    const nm = [String(cg.first ?? '').trim(), String(cg.last ?? '').trim()].filter(Boolean).join(' ')
    if (String(cg.axiscare_id ?? '').trim()) byAxis.set(String(cg.axiscare_id).trim(), cg)
    if (nm) byName.set(nameKeyOf(nm), cg)
  }
  const { data: logRow } = await sb.from('app_data').select('data').eq('key', 'confirm_log').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const sentLog: any[] = Array.isArray(logRow?.data) ? logRow!.data : []
  const dayKey = day.replaceAll('-', '')
  const alreadySent = new Set(sentLog.map(x => String(x?.id ?? '')))

  const tmpl = String(settings.confirm_msg_head || '')
    || `Good morning {first_name}! Here's your Caring Companions schedule for today:`
  const tail = String(settings.confirm_msg_tail || '')
    || `Reply C to confirm. If anything's wrong, reply here or call the office at (417) 234-8494.`

  const wouldSend: Record<string, unknown>[] = []
  let sent = 0, skippedAlreadySent = 0, skippedNoPhone = 0, refusedGate = 0
  for (const g of byCg.values()) {
    if (!g.shifts.length) continue
    const logId = `cf_${dayKey}_${g.axiscare_id.replace(/[^A-Za-z0-9]/g, '_')}`
    if (alreadySent.has(logId)) { skippedAlreadySent++; continue }
    const cg = byAxis.get(g.axiscare_id) ?? byName.get(nameKeyOf(g.name))
    const phone = normalisePhone(cg?.phone)
    if (!phone) { skippedNoPhone++; continue }
    const first = String(cg?.first ?? '') || g.name.split(' ')[0]
    const lines = g.shifts.map(s =>
      `• ${friendlyTime(s.start)}${s.end ? '-' + friendlyTime(s.end) : ''} with ${s.client}`)
    const message = [tmpl.replaceAll('{first_name}', first), ...lines, tail].join('\n')
    if (!live) {
      wouldSend.push({ caregiver: g.name, shifts: g.shifts.length, phone_last4: phone.slice(-4),
        preview: message })
      continue
    }
    /* Staff, about their own workday, deliberately before 8am: internal. */
    const contact = await contactForOutbound(sb, ghl, { phone, firstName: first }, 'routine_internal')
    if (!contact) { refusedGate++; continue }
    try {
      const r = await fetch('https://services.leadconnectorhq.com/conversations/messages', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28',
                   'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'SMS', contactId: contact.contactId, message }),
      })
      if (r.ok) {
        /* Persist the send BEFORE moving on — a crash mid-batch must not
           forget who was already texted (coverage-run's lesson). */
        await sb.rpc('upsert_app_data_item', { target_key: 'confirm_log', item: {
          id: logId, caregiver: g.name, day, shifts: g.shifts.length,
          at: new Date().toISOString(), ghl_contact_id: contact.contactId } })
        sent++
        try {
          await fetch(`https://services.leadconnectorhq.com/contacts/${contact.contactId}/tags`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28',
                       'Content-Type': 'application/json' },
            body: JSON.stringify({ tags: ['confirm-asked'] }),
          })
        } catch { /* a missing tag only costs reply routing */ }
      } else console.error('shift-confirm sms', r.status, await r.text().catch(() => ''))
    } catch (err) { console.error('shift-confirm sms failed', err) }
  }

  const summary = {
    mode: live ? 'LIVE' : 'DRY RUN — flip ops_settings.confirm_live to true to send',
    day, fetch_error: fetchError,
    visits_seen: visits.length,
    caregivers_with_shifts_today: byCg.size,
    sent, already_sent_today: skippedAlreadySent,
    skipped_no_phone: skippedNoPhone, refused_by_outbound_gate: refusedGate,
    visits_hidden_by_skip_list: skippedVisits,
    would_send: role === 'authenticated' || role === 'service_role' ? wouldSend : wouldSend.length,
  }

  try {
    await sb.rpc('upsert_app_data_item', { target_key: 'automation_log', item: {
      id: 'auto_srv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      at: new Date().toISOString(), automation: 'shift-confirm', ran_by: 'server',
      ok: !fetchError, dry: !live, duration_ms: Date.now() - t0,
      rows_seen: visits.length, candidates: byCg.size, created: sent,
    } })
  } catch { /* logging must never block the run */ }

  return json(summary)
})
