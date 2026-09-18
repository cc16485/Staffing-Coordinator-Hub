// Supabase Edge Function: carematch-watch  (shared hub project)
// -----------------------------------------------------------------------------
// The Care Match tab's first-shift wake-up call (built 2026-09-18, the day
// Samantha reset the board to start fresh): when a caregiver works a shift
// with a client they have NEVER worked with before, two things should happen
// the next morning without anybody remembering to do them:
//
//   1. The caregiver gets one text: "how did your first shift with ___ go?"
//      Their answer lands in the GHL inbox like any other reply.
//   2. The coordinators/admins (the Morning Brief recipient list,
//      ops_settings.morning_brief_recipients) get one email listing every
//      new match, because the CLIENT side of the check-in is deliberately
//      a phone call from a human, never an automated message.
//
// WHAT COUNTS AS A FIRST SHIFT: a client×caregiver pair appearing in
// yesterday's (or today's, for late runs) AxisCare visits that this watch has
// never seen before. The memory is app_data 'carematch_watch_log' — one row
// per pair, written the first time the pair is seen. The first run SEEDS the
// log from the last 60 days of visits and alerts on nothing, which is exactly
// the "start from now" behaviour the board reset promised. Because the log is
// the memory, a pair from years ago that resurfaces after the 60-day seed
// window WILL alert once — a returning caregiver on a client they last saw
// in spring is worth a check-in call anyway.
//
// ONE ALERT PER PAIR EVER, enforced by state, not by the schedule: the log
// row is persisted per pair as sends happen, so a cron retry can never
// double-text a caregiver (shift-confirm's crash-mid-batch lesson).
//
// ⚠ DRY RUN BY DEFAULT. ops_settings.carematch_live === true turns sending
//   on; ?dry=1 forces a dry run at any time (dry runs write nothing except
//   the initial seed). ?seed=1 forces re-seeding. Classified routine_internal:
//   the text goes to staff about their own shift, the email to the office.
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { normalisePhone, contactForOutbound } from '../_shared/outreach.ts'

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b, null, 2), { status: s, headers: { 'Content-Type': 'application/json' } })

const HUB = 'https://cc.mo-care.com'
const AC_VERSION = Deno.env.get('AXISCARE_API_VERSION') || '2023-10-01'
function axisCreds() {
  const order = ['AXISCARE_VISITS_TOKEN', 'AXISCARE_API_KEY', 'AXISCARE_TOKEN']
  let token = ''
  for (const n of order) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  return { token, site: /^\d+$/.test(site) ? site : '' }
}
const chiDay = (offsetDays = 0) => {
  const d = new Date(Date.now() + offsetDays * 86400000)
  return d.toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
}
const nameKeyOf = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '')
// deno-lint-ignore no-explicit-any
const rowsOf = (v: any): any[] => Array.isArray(v) ? v
  : (v && typeof v === 'object') ? Object.values(v) : []
const esc = (s: string) => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

/* One pair, one identity. AxisCare ids when both exist (they do on real
   visits), name-keys as the fallback so a missing id cannot split a pair
   into two log rows. */
// deno-lint-ignore no-explicit-any
function pairIdOf(v: any): { id: string; client: string; caregiver: string } | null {
  const clName = [String(v?.client?.firstName ?? '').trim(), String(v?.client?.lastName ?? '').trim()]
    .filter(Boolean).join(' ')
  const cgName = [String(v?.caregiver?.firstName ?? '').trim(), String(v?.caregiver?.lastName ?? '').trim()]
    .filter(Boolean).join(' ')
  if (!clName || !cgName) return null
  const cl = v?.client?.id != null ? 'c' + String(v.client.id) : 'n' + nameKeyOf(clName)
  const cg = v?.caregiver?.id != null ? 'g' + String(v.caregiver.id) : 'n' + nameKeyOf(cgName)
  return { id: `cw_${cl}_${cg}`, client: clName, caregiver: cgName }
}

// deno-lint-ignore no-explicit-any
async function fetchVisits(site: string, token: string, from: string, to: string): Promise<{ visits: any[]; error: string | null }> {
  // deno-lint-ignore no-explicit-any
  const visits: any[] = []
  try {
    let url: string | null = `https://${site}.axiscare.com/api/visits?startDate=${from}&endDate=${to}`
    for (let page = 0; url && page < 40; page++) {
      const r: Response = await fetch(url, { headers: {
        Authorization: `Bearer ${token}`, Accept: 'application/json',
        'X-AxisCare-Api-Version': AC_VERSION } })
      if (!r.ok) return { visits, error: `AxisCare responded ${r.status}` }
      // deno-lint-ignore no-explicit-any
      const j: any = await r.json().catch(() => ({}))
      for (const v of rowsOf(j?.results?.visits ?? j?.visits)) if (!v?.removed) visits.push(v)
      url = j?.results?.nextPage ?? j?.nextPage ?? j?.results?.nextPageUrl ?? j?.nextPageUrl ?? null
    }
    return { visits, error: null }
  } catch (err) { return { visits, error: String(err) } }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200 })
  const t0 = Date.now()
  const url = new URL(req.url)

  const { data: setRow } = await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const settings: any = setRow?.data ?? {}
  const forceDry = url.searchParams.get('dry') === '1'
  const live = settings.carematch_live === true && !forceDry

  const { token, site } = axisCreds()
  if (!token || !site) return json({ error: 'AxisCare credentials not set on this project' }, 502)
  const ghl = { token: Deno.env.get('GHL_TOKEN') || Deno.env.get('GHL_API_KEY') || '',
                locationId: Deno.env.get('GHL_LOCATION_ID') || '' }

  // ── The watch's memory: every pair it has ever seen. ──
  const { data: logRow } = await sb.from('app_data').select('data').eq('key', 'carematch_watch_log').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const log: any[] = Array.isArray(logRow?.data) ? logRow!.data : []
  const known = new Set(log.map(x => String(x?.id ?? '')))

  // ── FIRST RUN: seed the memory, alert on nothing. "Start from now." ──
  if (!known.size || url.searchParams.get('seed') === '1') {
    const { visits, error } = await fetchVisits(site, token, chiDay(-60), chiDay(0))
    if (error && !visits.length) return json({ error: `seed failed: ${error}` }, 502)
    let seeded = 0
    const seen = new Set<string>()
    for (const v of visits) {
      const p = pairIdOf(v); if (!p || seen.has(p.id)) continue
      seen.add(p.id)
      if (known.has(p.id)) continue
      await sb.rpc('upsert_app_data_item', { target_key: 'carematch_watch_log', item: {
        id: p.id, client: p.client, caregiver: p.caregiver,
        first_seen: new Date().toISOString(), how: 'seeded', texted: false, emailed: false } })
      seeded++
    }
    return json({ mode: 'SEED', visits_seen: visits.length, pairs_now_known: seen.size,
      newly_seeded: seeded, note: 'Nothing was sent. From the next run on, a pair not in this memory means a first shift happened.' })
  }

  // ── Daily run: recent visits, new pairs only. The window reaches three
  //    days back so a failed cron catches up, and includes today ONLY for
  //    shifts that have already ENDED — "how did your first shift go?" must
  //    never arrive before the shift does. ──
  const from = chiDay(-3), to = chiDay(0)
  const { visits, error: fetchError } = await fetchVisits(site, token, from, to)
  if (fetchError && !visits.length) return json({ error: fetchError }, 502)
  const nowChi = new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).replace(' ', 'T')

  type NewMatch = { id: string; client: string; caregiver: string; day: string }
  const fresh: NewMatch[] = []
  const seenThisRun = new Set<string>()
  let skippedNotEnded = 0
  for (const v of visits) {
    const p = pairIdOf(v); if (!p || seenThisRun.has(p.id)) continue
    const end = String(v?.scheduledEndDate ?? v?.endDate ?? '')
    const day = String(v?.scheduledStartDate ?? v?.startDate ?? from).slice(0, 10)
    const ended = end ? end.slice(0, 16) < nowChi : day < chiDay(0)
    if (!ended) { skippedNotEnded++; continue }
    seenThisRun.add(p.id)
    if (known.has(p.id)) continue
    fresh.push({ ...p, day })
  }

  // A pair somebody already logged a check-in for needs no nudge.
  const { data: ciRow } = await sb.from('app_data').select('data').eq('key', 'client_checkins').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const checkins: any[] = Array.isArray(ciRow?.data) ? ciRow!.data : []
  const ciKeys = new Set(checkins.filter(e => e?.client && e?.caregiver)
    .map(e => nameKeyOf(String(e.client)) + '|' + nameKeyOf(String(e.caregiver))))
  const due = fresh.filter(m => !ciKeys.has(nameKeyOf(m.client) + '|' + nameKeyOf(m.caregiver)))

  // ── Caregiver roster for phones (same source the hub uses). ──
  const { data: cgRow } = await sb.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const roster = (Array.isArray(cgRow?.data) ? cgRow!.data : []) as any[]
  // deno-lint-ignore no-explicit-any
  const byName = new Map<string, any>()
  for (const cg of roster) {
    if (cg?.active === false) continue
    const nm = [String(cg.first ?? '').trim(), String(cg.last ?? '').trim()].filter(Boolean).join(' ')
    if (nm) byName.set(nameKeyOf(nm), cg)
  }

  const wouldSend: Record<string, unknown>[] = []
  let texted = 0, skippedNoPhone = 0, refusedGate = 0
  for (const m of due) {
    const cg = byName.get(nameKeyOf(m.caregiver))
    const phone = normalisePhone(cg?.phone)
    const first = String(cg?.first ?? '') || m.caregiver.split(' ')[0]
    const clientFirst = m.client.split(' ')[0]
    /* Reads like a coordinator texting, because that is what it is standing
       in for. Short on purpose — the reply is the point. */
    const message = `Good morning, ${first}! How did your first shift with ${clientFirst} go?`
    if (!live) {
      wouldSend.push({ caregiver: m.caregiver, client: m.client, first_shift: m.day,
        phone_on_file: !!phone, preview: message })
      continue
    }
    /* Persist the pair BEFORE sending: better to miss one text on a crash
       than to double-text a caregiver on the retry. */
    await sb.rpc('upsert_app_data_item', { target_key: 'carematch_watch_log', item: {
      id: m.id, client: m.client, caregiver: m.caregiver, first_shift: m.day,
      first_seen: new Date().toISOString(), how: 'alerted', texted: false, emailed: false } })
    known.add(m.id)
    if (!phone) { skippedNoPhone++; continue }
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
        texted++
        await sb.rpc('upsert_app_data_item', { target_key: 'carematch_watch_log', item: {
          id: m.id, client: m.client, caregiver: m.caregiver, first_shift: m.day,
          first_seen: new Date().toISOString(), how: 'alerted', texted: true, emailed: false } })
      } else console.error('carematch-watch sms', r.status, await r.text().catch(() => ''))
    } catch (err) { console.error('carematch-watch sms failed', err) }
  }

  // ── One email to the office listing every new match: the client call is
  //    a human's job, this is the nudge that makes sure it happens. ──
  // deno-lint-ignore no-explicit-any
  let recips: { name: string; email: string }[] = (Array.isArray(settings.morning_brief_recipients)
    ? settings.morning_brief_recipients : [])
    // deno-lint-ignore no-explicit-any
    .map((r: any) => ({ name: String(r?.name || ''), email: String(r?.email || '').toLowerCase() }))
    .filter((r) => r.email.includes('@'))
  /* Same fallback the Morning Brief uses: an empty recipients setting must
     mean "the owners", never "nobody hears about new matches". */
  if (!recips.length) {
    recips = (Deno.env.get('LEAD_DIGEST_EMAILS') || 'samantha@mo-care.com,krystal@mo-care.com')
      .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
      .map((email) => ({ name: email.split('@')[0], email }))
  }
  let emailed = 0
  const emailErrors: string[] = []
  if (due.length && recips.length && live) {
    const NAVY = '#1F3A5F', HONEY = '#E9A820', BORDER = '#E3E8EF'
    const rows = due.map(m =>
      `<tr><td style="font-family:Arial,sans-serif;font-size:14px;color:#1f2a36;padding:8px 10px;border-bottom:1px solid ${BORDER};"><b>${esc(m.client)}</b> × ${esc(m.caregiver)}</td>` +
      `<td style="font-family:Arial,sans-serif;font-size:13px;color:#5b6673;padding:8px 10px;border-bottom:1px solid ${BORDER};white-space:nowrap;">first shift ${esc(m.day)}</td></tr>`).join('')
    const subject = due.length === 1
      ? `New match: ${due[0].client} × ${due[0].caregiver} — check-in call due`
      : `${due.length} new matches — check-in calls due`
    const html =
      `<div style="background:#F1F5FA;padding:14px 8px;"><div style="max-width:620px;margin:0 auto;">` +
      `<div style="background:${NAVY};border-radius:14px 14px 0 0;padding:18px 24px;">` +
      `<div style="font-family:Arial,sans-serif;color:${HONEY};font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;">Caring Companions · Care Match</div>` +
      `<div style="font-family:Arial,sans-serif;color:#ffffff;font-size:20px;font-weight:800;margin-top:3px;">First shifts just happened 💛</div></div>` +
      `<div style="background:#F8FAFD;border:1px solid ${BORDER};border-top:none;border-radius:0 0 14px 14px;padding:14px 16px 18px;">` +
      `<p style="font-family:Arial,sans-serif;font-size:14px;color:#1f2a36;margin:2px 0 10px;">Each of these clients had a caregiver in their home for the first time. The caregiver has been texted for their side. <b>The client (or their family) gets a call from us</b> — a two-minute "how did it go?" while it is fresh.</p>` +
      `<table role="presentation" width="100%" style="border-collapse:collapse;background:#ffffff;border:1px solid ${BORDER};border-radius:8px;">${rows}</table>` +
      `<div style="margin-top:14px;"><a href="${HUB}/#carematch" style="display:inline-block;background:${NAVY};color:#ffffff;font-family:Arial,sans-serif;text-decoration:none;font-weight:700;font-size:13.5px;padding:10px 20px;border-radius:9px;">Open Care Match and log the calls →</a></div>` +
      `</div><div style="text-align:center;font-family:Arial,sans-serif;color:#9aa3ad;font-size:11px;padding:12px;">Sent by carematch-watch · cc.mo-care.com</div></div></div>`
    const headers = { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28',
                      'Content-Type': 'application/json' }
    for (const r of recips) {
      try {
        const up = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
          method: 'POST', headers,
          body: JSON.stringify({ locationId: ghl.locationId, email: r.email,
            firstName: r.name.split(' ')[0] || r.email.split('@')[0], lastName: 'CC Staff' }),
        })
        // deno-lint-ignore no-explicit-any
        const uj: any = await up.json().catch(() => ({}))
        const contactId = uj?.contact?.id ?? uj?.id
        if (!contactId) { emailErrors.push(`${r.email}: no GHL contact`); continue }
        const em = await fetch('https://services.leadconnectorhq.com/conversations/messages', {
          method: 'POST', headers,
          body: JSON.stringify({ type: 'Email', contactId, subject, html }),
        })
        if (em.ok) emailed++
        else emailErrors.push(`${r.email}: GHL email ${em.status}`)
      } catch (e) { emailErrors.push(`${r.email}: ${String(e)}`) }
    }
  }

  const summary = {
    mode: live ? 'LIVE' : 'DRY RUN — flip ops_settings.carematch_live to true to send',
    window: `${from} to ${to}`, fetch_error: fetchError,
    visits_seen: visits.length, pairs_in_window: seenThisRun.size,
    visits_not_ended_yet: skippedNotEnded,
    new_first_shifts: fresh.length, already_checked_in: fresh.length - due.length,
    alerts_due: due.length, caregivers_texted: texted,
    skipped_no_phone: skippedNoPhone, refused_by_outbound_gate: refusedGate,
    office_emails_sent: emailed, email_errors: emailErrors,
    would_send: wouldSend,
    recipients_configured: recips.length,
  }

  try {
    await sb.rpc('upsert_app_data_item', { target_key: 'automation_log', item: {
      id: 'auto_srv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      at: new Date().toISOString(), automation: 'carematch-watch', ran_by: 'server',
      ok: !fetchError, dry: !live, duration_ms: Date.now() - t0,
      rows_seen: visits.length, candidates: due.length, created: texted + emailed,
    } })
  } catch { /* logging must never block the run */ }

  return json(summary)
})
