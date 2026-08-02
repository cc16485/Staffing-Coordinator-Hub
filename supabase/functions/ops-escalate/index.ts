// Supabase Edge Function: ops-escalate (shared hub project)
// -----------------------------------------------------------------------------
// The half of the Operations Inbox that runs when nobody is looking.
//
// The hub reconciles missed calls in the browser, which is fine during office
// hours and useless at 11pm. This does the same reconciliation server-side on a
// schedule, then chases whatever has been sitting too long:
//
//   1. pull recent calls from GoHighLevel
//   2. turn unanswered INBOUND calls into open ops_items (and auto-close any
//      we've since called back and connected with)
//   3. text the person who owns it once it passes each escalation threshold
//
// Writes use the same per-item RPC the hub uses (upsert_app_data_item), so the
// browser and this function can both write ops_items without clobbering.
//
// ⚠ THIS TEXTS REAL STAFF. It is DRY RUN by default and logs what it *would*
// send. Flip it on deliberately: set app_data key 'ops_settings' to
//   { "live": true, "levels": [{ "after_min": 15, "to": "owner" },
//                              { "after_min": 45, "to": "fallback" }],
//     "max_age_hours": 12, "fallback_phone": "+1417..." }
// max_age_hours exists so switching it on doesn't blast a backlog of old
// missed calls at everyone.
//
// Auth: ?token=OPS_ESCALATE_TOKEN (a scheduler calls this, not a browser).
// Secrets: OPS_ESCALATE_TOKEN, GHL_TOKEN (or GHL_API_KEY), GHL_LOCATION_ID.
// Deploy: supabase functions deploy ops-escalate --project-ref zngsgedlsxinbygwmxwn --no-verify-jwt
// -----------------------------------------------------------------------------

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const GHL_BASE = 'https://services.leadconnectorhq.com'
const CONVOS_SCANNED = 40
const FANOUT = 10

const DEFAULTS = {
  live: false,
  max_age_hours: 12,
  callback_window_min: 60,
  levels: [
    { after_min: 15, to: 'owner' },
    { after_min: 45, to: 'fallback' },
  ] as Array<{ after_min: number; to: string }>,
  fallback_phone: '',
}

const ghlHeaders = (tok: string) => ({
  Authorization: `Bearer ${tok}`, Version: '2021-04-15', Accept: 'application/json',
})
const digits = (p: string) => String(p || '').replace(/\D/g, '').replace(/^1/, '')
const e164 = (p: string) => { const d = digits(p); return d.length === 10 ? `+1${d}` : (p || '') }

function isMissed(status: string, duration: number): boolean {
  const s = (status || '').toLowerCase()
  if (s.includes('no-answer') || s.includes('busy') || s.includes('failed') || s.includes('canceled')) return true
  return duration <= 0
}

// deno-lint-ignore no-explicit-any
async function ghlCalls(tok: string, locationId: string): Promise<any[]> {
  const r = await fetch(`${GHL_BASE}/conversations/search?locationId=${encodeURIComponent(locationId)}&limit=${CONVOS_SCANNED}`,
    { headers: ghlHeaders(tok) })
  if (!r.ok) throw new Error(`conversations/search returned ${r.status}`)
  // deno-lint-ignore no-explicit-any
  const convos: any[] = (await r.json())?.conversations || []
  // deno-lint-ignore no-explicit-any
  const out: any[] = []
  for (let i = 0; i < convos.length; i += FANOUT) {
    await Promise.all(convos.slice(i, i + FANOUT).map(async (c) => {
      try {
        const m = await fetch(`${GHL_BASE}/conversations/${c.id}/messages?limit=50`, { headers: ghlHeaders(tok) })
        if (!m.ok) return
        const body = await m.json()
        // deno-lint-ignore no-explicit-any
        const msgs: any[] = body?.messages?.messages || body?.messages || []
        for (const x of msgs) {
          if (x.messageType !== 'TYPE_CALL') continue
          const duration = Number(x?.meta?.call?.duration || 0)
          const inbound = x.direction === 'inbound'
          out.push({
            id: String(x.id), contact_id: String(x.contactId || c.contactId || ''),
            name: c.fullName || c.contactName || 'Unknown caller',
            phone: String((inbound ? x.from : x.to) || ''),
            direction: inbound ? 'inbound' : 'outbound',
            status: String(x?.meta?.call?.status || x.status || ''),
            duration, at: x.dateAdded || x.dateUpdated || '',
          })
        }
      } catch (_e) { /* one bad conversation shouldn't stop the sweep */ }
    }))
  }
  return out
}

async function sendSms(tok: string, locationId: string, phone: string, message: string) {
  const up = await fetch(`${GHL_BASE}/contacts/upsert`, {
    method: 'POST',
    headers: { ...ghlHeaders(tok), 'Content-Type': 'application/json', Version: '2021-07-28' },
    body: JSON.stringify({ locationId, phone }),
  })
  const upBody = await up.json().catch(() => ({}))
  const contactId = upBody?.contact?.id
  if (!contactId) throw new Error('could not resolve a GHL contact for ' + phone)
  const send = await fetch(`${GHL_BASE}/conversations/messages`, {
    method: 'POST',
    headers: { ...ghlHeaders(tok), 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'SMS', contactId, message }),
  })
  if (!send.ok) throw new Error('send failed ' + send.status)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const url = new URL(req.url)
  const expected = Deno.env.get('OPS_ESCALATE_TOKEN')
  if (!expected || url.searchParams.get('token') !== expected) return json({ error: 'unauthorized' }, 401)

  const tok = Deno.env.get('GHL_TOKEN') || Deno.env.get('GHL_API_KEY')
  const locationId = Deno.env.get('GHL_LOCATION_ID')
  if (!tok || !locationId) return json({ error: 'GoHighLevel is not configured' }, 500)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const read = async (key: string) => (await admin.from('app_data').select('data').eq('key', key).maybeSingle()).data?.data
  // deno-lint-ignore no-explicit-any
  const save = async (item: any) => { await admin.rpc('upsert_app_data_item', { target_key: 'ops_items', item }) }

  // deno-lint-ignore no-explicit-any
  let reqBody: Record<string, any> = {}
  try { reqBody = await req.json() } catch { /* GET / empty body is a normal sweep */ }

  // ── Maintenance: prove the send path works ─────────────────────────────────
  // Escalation is only useful if a text actually arrives. This fires ONE
  // message down the exact same path a real escalation uses, so the first time
  // it runs for real isn't at 11pm on a live missed call. Touches no data.
  if (reqBody.test_notify) {
    const cfgNow = { ...DEFAULTS, ...((await read('ops_settings')) || {}) }
    // deno-lint-ignore no-explicit-any
    const staffNow: any[] = (await read('coordinator_staff')) || []
    const to = String(reqBody.test_notify) === 'true'
      ? (cfgNow.fallback_phone || (staffNow.find((s) => s.phone) || {}).phone || '')
      : String(reqBody.test_notify)
    if (!to) return json({ error: 'no number to test with — set a backstop phone on the Admin page' }, 400)
    try {
      await sendSms(tok, locationId, e164(to),
        'Caring Companions test: missed-call chasing is switched on and working. This is the only message this test sends.')
      return json({ test_sent_to: e164(to) })
    } catch (err) { return json({ error: 'send failed', detail: String(err) }, 502) }
  }

  // ── Maintenance: close the pre-rollout backlog ─────────────────────────────
  // A list that opens showing weeks of stale items is a list people stop
  // trusting. Closing them is explicit and recorded, never silent expiry.
  if (reqBody.close_backlog_hours) {
    const hours = Number(reqBody.close_backlog_hours)
    const reason = String(reqBody.reason || 'Closed at rollout, before callback tracking started')
    // deno-lint-ignore no-explicit-any
    const all: any[] = (await read('ops_items')) || []
    const cutoff = Date.now() - hours * 3600 * 1000
    const openBefore = all.filter((i) => i.status === 'open').length
    const stale = all.filter((i) => i.status === 'open' && Date.parse(i.created_at || '') < cutoff)
    for (const it of stale) {
      it.status = 'done'
      it.closed_at = new Date().toISOString()
      it.closed_by = 'system'
      it.close_note = reason
      await admin.rpc('upsert_app_data_item', { target_key: 'ops_items', item: it })
    }
    return json({ closed: stale.length, older_than_hours: hours, still_open: openBefore - stale.length })
  }

  const cfg = { ...DEFAULTS, ...((await read('ops_settings')) || {}) }
  // deno-lint-ignore no-explicit-any
  const items: any[] = (await read('ops_items')) || []
  // deno-lint-ignore no-explicit-any
  const staff: any[] = (await read('coordinator_staff')) || []
  // deno-lint-ignore no-explicit-any
  const onCall: any[] = (await read('on_call_schedule')) || []

  const now = Date.now()
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
  const onCallNow = onCall.filter((e) => e.start_date && e.end_date && e.start_date <= today && today <= e.end_date)
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0] || null

  // ── 1 + 2. reconcile ───────────────────────────────────────────────────────
  let calls: Awaited<ReturnType<typeof ghlCalls>> = []
  try { calls = await ghlCalls(tok, locationId) } catch (err) { return json({ error: String(err) }, 502) }

  const bySource = new Map(items.filter((i) => i.kind === 'missed_call').map((i) => [i.source_id, i]))
  const created: string[] = [], closed: string[] = []

  for (const c of calls) {
    if (c.direction !== 'inbound' || !isMissed(c.status, c.duration)) continue
    let it = bySource.get(c.id)
    if (!it) {
      it = {
        id: 'ops_' + c.id, kind: 'missed_call', source_id: c.id,
        title: 'Missed call from ' + (c.name || 'Unknown caller'),
        phone: c.phone || '', contact_id: c.contact_id || '',
        status: 'open', created_at: c.at || new Date().toISOString(),
        due: new Date(new Date(c.at || now).getTime() + cfg.callback_window_min * 60000).toISOString(),
        opened_by: 'system', owner: '', owner_name: '', escalations: [],
      }
      bySource.set(c.id, it); items.push(it)
      await save(it); created.push(it.id)
    }
    if (it.status === 'open') {
      const back = calls.find((x) => x.direction === 'outbound' && x.duration > 0 &&
        digits(x.phone) === digits(c.phone) && String(x.at) > String(c.at))
      if (back) {
        it.status = 'done'; it.closed_at = back.at; it.closed_by = 'system'
        it.auto_closed_reason = 'Called back ' + new Date(back.at).toLocaleString('en-US', { timeZone: 'America/Chicago' })
        await save(it); closed.push(it.id)
      }
    }
  }

  // ── 3. escalate ────────────────────────────────────────────────────────────
  const notified: Array<Record<string, string>> = []
  const open = items.filter((i) => i.kind === 'missed_call' && i.status === 'open')

  for (const it of open) {
    const ageMin = (now - Date.parse(it.created_at || '')) / 60000
    // Don't chase a backlog: switching this on shouldn't text anyone about
    // calls that were missed days ago.
    if (!isFinite(ageMin) || ageMin > cfg.max_age_hours * 60) continue

    it.escalations = it.escalations || []
    for (let lvl = 0; lvl < cfg.levels.length; lvl++) {
      const rule = cfg.levels[lvl]
      if (ageMin < rule.after_min) continue
      if (it.escalations.some((e: { level: number }) => e.level === lvl)) continue

      let phone = '', who = ''
      if (rule.to === 'owner') {
        const s = staff.find((x) => (x.email || x.name) === it.owner)
        if (s?.phone) { phone = s.phone; who = s.name || s.email }
        if (!phone && onCallNow) {
          const oc = staff.find((x) => (x.email || x.name) === (onCallNow.email || onCallNow.name || onCallNow.staff))
          if (oc?.phone) { phone = oc.phone; who = (oc.name || oc.email) + ' (on call)' }
        }
      }
      if (!phone && cfg.fallback_phone) { phone = cfg.fallback_phone; who = 'fallback' }
      if (!phone) continue   // nobody to tell; leave it for the next sweep

      const when = new Date(it.created_at).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' })
      const msg = `Caring Companions: ${it.title} at ${when} (${it.phone}) still has no callback after ${Math.round(ageMin)} min. Open the hub and check Needs Attention.`

      if (cfg.live) {
        try {
          await sendSms(tok, locationId, e164(phone), msg)
          it.escalations.push({ level: lvl, at: new Date().toISOString(), to: who, phone: e164(phone) })
          await save(it)
          notified.push({ item: it.id, level: String(lvl), to: who })
        } catch (err) { console.error('escalation send failed:', String(err)) }
      } else {
        notified.push({ item: it.id, level: String(lvl), to: who, dry_run: 'would text ' + e164(phone) })
      }
      break   // one notification per sweep per item
    }
  }

  // Diagnostics: escalation is only as good as the phone numbers behind it.
  // Surfacing this in every sweep means "it silently told nobody" can't hide.
  const reachable = staff.filter((s) => s.phone).length
  const result = {
    live: cfg.live, calls_seen: calls.length, created: created.length,
    auto_closed: closed.length, open: open.length, notified,
    can_notify: {
      staff_total: staff.length,
      staff_with_phone: reachable,
      on_call_today: onCallNow ? (onCallNow.name || onCallNow.email || 'set') : 'nobody scheduled',
      fallback_phone_set: !!cfg.fallback_phone,
      ready: reachable > 0 || !!cfg.fallback_phone,
    },
  }
  console.log('ops-escalate', JSON.stringify(result))
  return json(result)
})
