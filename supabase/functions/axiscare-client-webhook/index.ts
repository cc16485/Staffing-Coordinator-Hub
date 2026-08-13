// =============================================================================
// axiscare-client-webhook — the AxisCare client producer
// =============================================================================
// Receives an AxisCare client event, translates it into an INTERNAL client
// event (see _shared/client-events.ts), records it, and — only when live —
// creates the scheduling handoff row.
//
// ARCHITECTURE (locked 2026-08-13)
//   AxisCare is the source of truth for client identity and service delivery.
//   The Hub owns operational obligations and process state.
//   client_queue is a SCHEDULING HANDOFF, not a canonical client record.
//   Nothing downstream may key off a client_queue row id. Key off
//   axiscare_client_id, which is canonical and survives the queue row.
//
// SAFETY POSTURE ON FIRST ACTIVATION
//   Defaults to LOG ONLY. It records every event and writes nothing to
//   client_queue until AXISCARE_CLIENT_LIVE=1 is set. This exists because
//   registering a webhook can emit the entire existing client list as
//   "created", and hundreds of false new-client events would be worse than
//   a day of silence.
//
// UNVERIFIED FIELDS
//   The client payload shape has NOT been verified against a real AxisCare
//   response. Only /api/visits has. Every field read below is provisional,
//   is read defensively, and the untouched payload is retained so a field we
//   guessed wrong can be recovered from the first real delivery.
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  type ClientEvent, type ClientEventRecord,
  eventId, resolvePayer,
} from '../_shared/client-events.ts'

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const AXISCARE_KEY  = Deno.env.get('AXISCARE_API_KEY') || ''
const AXISCARE_SITE = Deno.env.get('AXISCARE_SITE') || ''
const WEBHOOK_SECRET = Deno.env.get('AXISCARE_WEBHOOK_SECRET') || ''

/* Stage A: record events. Stage B: actually create the handoff row.
   Two switches, because observing is a different risk level from acting. */
const LIVE = Deno.env.get('AXISCARE_CLIENT_LIVE') === '1'

/* Nothing older than this becomes a NEW handoff on first activation. If
   registration replays history, a client created in March is not new work.
   Existing rows are never touched by this guard. */
const MAX_AGE_DAYS = Number(Deno.env.get('AXISCARE_CLIENT_MAX_AGE_DAYS') || '14')

const sb = createClient(SUPABASE_URL, SERVICE_KEY)

/* ── EVENT MAPPING ───────────────────────────────────────────────────────────
   AxisCare's event names are NOT verified. Anything unrecognised is recorded
   as unmapped rather than assumed — an unmapped event is a question for
   Monday, not a reason to guess. */
function toInternalEvent(name: string): ClientEvent | null {
  const n = String(name || '').toLowerCase().trim()
  if (n === 'client.created') return 'client_created'
  if (n === 'client.discharged' || n === 'client.inactivated') return 'client_discharged'
  if (n === 'client.hold' || n === 'client.onhold') return 'client_on_hold'
  if (n === 'client.restarted' || n === 'client.reactivated') return 'client_restarted'
  return null
}

function nowIso() { return new Date().toISOString() }

/** Constant-time compare, so a wrong secret cannot be recovered by timing the
 *  responses one character at a time. */
function timingSafeEqual(a: string, b: string): boolean {
  if (!a || !b) return false
  const ab = new TextEncoder().encode(a), bb = new TextEncoder().encode(b)
  /* Compare lengths inside the accumulator rather than returning early. */
  let diff = ab.length ^ bb.length
  const n = Math.max(ab.length, bb.length)
  for (let i = 0; i < n; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0)
  return diff === 0
}

function daysBetween(a: string, b: string): number {
  const d1 = Date.parse(a), d2 = Date.parse(b)
  if (isNaN(d1) || isNaN(d2)) return 0
  return Math.abs(d2 - d1) / 86400000
}

/** Record the internal event. Deterministic id, so redelivery overwrites
 *  rather than accumulating. This is the PRODUCER health signal, and it is
 *  written even when the function refuses to act. */
async function recordEvent(rec: ClientEventRecord) {
  const { error } = await sb.rpc('upsert_app_data_item', {
    target_key: 'client_events',
    item: rec as unknown as Record<string, unknown>,
  })
  if (error) console.error('client_events write failed:', error.message, rec.id)
  return !error
}

/* ── PAYER FIXTURES ──────────────────────────────────────────────────────────
   There is no Deno toolchain on the workstation, so these run inside the real
   runtime against the real shared module rather than a local copy that could
   drift from what is deployed. GET ?selftest=1. Writes nothing. */
const PAYER_FIXTURES: Array<{ name: string; classes: unknown; want: string | null }> = [
  { name: 'payer in first position',      classes: [{ label: 'Medicaid' }, { label: 'Advanced Care' }], want: 'Medicaid' },
  { name: 'payer NOT in first position',  classes: [{ label: 'Advanced Care' }, { label: 'Medicaid' }], want: 'Medicaid' },
  { name: 'care level only, no payer',    classes: [{ label: 'Advanced Care' }],                        want: null },
  { name: 'two payers, must refuse',      classes: [{ label: 'Medicaid' }, { label: 'Private Pay' }],   want: null },
  { name: 'empty classes',                classes: [],                                                  want: null },
  { name: 'classes missing entirely',     classes: undefined,                                           want: null },
  { name: 'plain strings, not objects',   classes: ['Advanced Care', 'VA'],                             want: 'VA' },
  { name: 'case and padding tolerated',   classes: [{ label: '  medicaid ' }],                          want: '  medicaid ' },
]

function runSelfTest() {
  const results = PAYER_FIXTURES.map(f => {
    const got = resolvePayer(f.classes)
    return { fixture: f.name, expected: f.want, got: got.payer, reason: got.reason,
             pass: got.payer === f.want }
  })
  /* The old bug, stated as a test: classes[0] would have answered
     "Advanced Care" for fixture 2 and called it the funding source. */
  const idFixture = eventId('client_created', '290', '2026-08-17T09:00:00.000Z')
  results.push({
    fixture: 'event id is deterministic', expected: idFixture,
    got: eventId('client_created', '290', '2026-08-17T09:00:00.000Z'),
    reason: 'same event must always produce the same id',
    pass: eventId('client_created', '290', '2026-08-17T09:00:00.000Z') === idFixture,
  })
  return { ok: results.every(r => r.pass), passed: results.filter(r => r.pass).length,
           of: results.length, results }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200 })

  if (new URL(req.url).searchParams.get('selftest') === '1') {
    const out = runSelfTest()
    return new Response(JSON.stringify(out, null, 2),
      { status: out.ok ? 200 : 500, headers: { 'Content-Type': 'application/json' } })
  }

  let payload: any = null
  try { payload = await req.json() } catch { /* handled below */ }
  if (!payload) return new Response('bad payload', { status: 400 })

  /* ── AUTHENTICATION ───────────────────────────────────────────────────────
     This function runs with JWT verification OFF, because AxisCare calls it.
     That means anyone who learns the URL can call it. If AxisCare provides a
     shared secret or signature header, set AXISCARE_WEBHOOK_SECRET and it is
     enforced here. Until we know what they support, an unset secret logs the
     gap loudly rather than pretending the endpoint is protected. */
  if (!WEBHOOK_SECRET) {
    /* FAIL CLOSED. An unauthenticated public endpoint that accepts and stores
       arbitrary raw payloads is a standing liability even when it writes no
       business data: anyone who learns the URL can fill client_events with
       whatever they like. Ingestion stays off until the mechanism is known.
       Capturing the first payload is not a good enough reason to weaken this. */
    console.error('INGESTION DISABLED — AXISCARE_WEBHOOK_SECRET is not set')
    return new Response(JSON.stringify({
      ok: false, ingestion: 'disabled',
      reason: 'no authentication mechanism configured',
    }), { status: 503, headers: { 'Content-Type': 'application/json' } })
  }

  /* Header first, in preference order. A query parameter is accepted only
     because some vendors support nothing else — it is the weakest option, as
     secrets in URLs land in access logs and proxy history. */
  const supplied = req.headers.get('x-axiscare-signature')
                || req.headers.get('x-webhook-secret')
                || (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
                || new URL(req.url).searchParams.get('secret')
                || ''
  if (!timingSafeEqual(supplied, WEBHOOK_SECRET)) {
    console.warn('rejected: bad or missing webhook secret')
    return new Response('unauthorized', { status: 401 })
  }

  const received = nowIso()
  const rawEvent = String(payload.event || payload.type || '')
  const internal = toInternalEvent(rawEvent)
  const clientId = String(payload.data?.id ?? payload.clientId ?? payload.id ?? '').trim()

  if (!clientId) {
    console.error('no client id in payload:', JSON.stringify(payload).slice(0, 400))
    return new Response('missing client id', { status: 400 })
  }

  /* An event we do not recognise is still recorded. It is the cheapest way to
     learn AxisCare's real event vocabulary from live traffic. */
  if (!internal) {
    await recordEvent({
      id: `ce_unmapped_${clientId}_${received}`.replace(/[^A-Za-z0-9_]/g, '_'),
      event: 'client_created', axiscare_client_id: clientId,
      occurred_at: received, received_at: received, source: 'axiscare',
      facts: { unmapped: true, axiscare_event: rawEvent },
      raw: payload,
      unresolved: [`unrecognised AxisCare event "${rawEvent}" — needs mapping`],
    })
    console.log('recorded unmapped event:', rawEvent)
    return new Response(JSON.stringify({ ok: true, recorded: 'unmapped', event: rawEvent }),
      { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  /* ── FETCH THE FULL RECORD ────────────────────────────────────────────── */
  let client: any = null
  let fetchNote = ''
  if (AXISCARE_KEY && AXISCARE_SITE) {
    try {
      const res = await fetch(`https://${AXISCARE_SITE}.axiscare.com/api/clients/${clientId}`, {
        headers: {
          'Authorization': `Bearer ${AXISCARE_KEY}`,
          'X-AxisCare-Api-Version': '2023-10-01',
          'Accept': 'application/json',
        },
      })
      const text = await res.text()
      if (res.ok) {
        client = JSON.parse(text)?.results ?? null
      } else {
        fetchNote = `AxisCare API ${res.status}`
        console.error(fetchNote, text.slice(0, 300))
      }
    } catch (e) {
      fetchNote = `AxisCare fetch failed: ${e instanceof Error ? e.message : String(e)}`
      console.error(fetchNote)
    }
  } else {
    fetchNote = 'AXISCARE_API_KEY or AXISCARE_SITE not set'
  }

  /* ── MAP TO FACTS (all provisional) ───────────────────────────────────── */
  const unresolved: string[] = []
  if (fetchNote) unresolved.push(fetchNote)

  const name = [client?.firstName, client?.lastName].filter(Boolean).join(' ').trim()
  if (!name) unresolved.push('client name could not be read from the payload')

  const addr = client?.residentialAddress
  const address = addr
    ? [addr.streetAddress1, addr.city, addr.state, addr.postalCode].filter(Boolean).join(', ')
    : null

  /* PAYER — never classes[0]. classes[] mixes care level and payer, which is a
     confirmed defect. resolvePayer refuses rather than guessing, because a
     wrong payer is worse than a missing one: nobody goes looking for a field
     that already has a confident-looking value in it. */
  const payerResult = resolvePayer(client?.classes)
  if (payerResult.unresolved) {
    unresolved.push(`payer unresolved — ${payerResult.reason}` +
      (payerResult.candidates.length ? ` (saw: ${payerResult.candidates.join(', ')})` : ''))
  }

  const startDate = client?.startDate || null
  const occurred = payload.occurredAt || payload.timestamp || received

  const rec: ClientEventRecord = {
    id: eventId(internal, clientId, occurred),
    event: internal,
    axiscare_client_id: clientId,
    occurred_at: occurred,
    received_at: received,
    source: 'axiscare',
    facts: {
      client_name: name || null,
      client_address: address,
      start_date: startDate,
      payer: payerResult.payer,          // null when unresolved. Never a guess.
      payer_candidates: payerResult.candidates,
      schedule_notes: client?.priorityNote || null,
      axiscare_event: rawEvent,
    },
    raw: payload,
    ...(unresolved.length ? { unresolved } : {}),
  }
  await recordEvent(rec)

  /* ── STAGE B: THE SCHEDULING HANDOFF ──────────────────────────────────── */
  if (!LIVE) {
    console.log(`LOG ONLY — would handle ${internal} for client ${clientId}`)
    return new Response(JSON.stringify({
      ok: true, mode: 'log_only', event: internal,
      axiscare_client_id: clientId, unresolved,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  if (internal !== 'client_created') {
    // Lifecycle events beyond creation are recorded and consumed by the
    // obligation engine from client_events. They do not touch the queue.
    return new Response(JSON.stringify({ ok: true, event: internal, queue: 'not applicable' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  /* Age guard: applies ONLY where no row exists. Never abandons live work. */
  const age = daysBetween(occurred, received)
  if (age > MAX_AGE_DAYS) {
    console.log(`too old (${age.toFixed(1)}d > ${MAX_AGE_DAYS}d) — recorded, no queue row`)
    return new Response(JSON.stringify({
      ok: true, event: internal, queue: 'skipped_too_old', age_days: Math.round(age),
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  /* IDEMPOTENCY.
     The database guarantees this, not the application. A partial unique index
     on axiscare_client_id means two concurrent deliveries cannot both insert:
     one wins, the other conflicts and updates. A check-then-insert in
     application code would still race between the check and the insert, which
     is exactly the window a webhook retry storm lands in.

     onConflict does an UPDATE, so a redelivery refreshes AxisCare-owned fields
     and leaves every human checklist column untouched. */
  const { data, error } = await sb
    .from('client_queue')
    .upsert({
      client_name:        name || `Client ${clientId}`,
      client_address:     address,
      start_date:         startDate,
      payer:              payerResult.payer,   // null rather than wrong
      schedule_notes:     rec.facts.schedule_notes as string | null,
      axiscare_client_id: clientId,
    }, { onConflict: 'axiscare_client_id', ignoreDuplicates: false })
    .select('id')

  if (error) {
    console.error('client_queue upsert failed:', error.message)
    /* Dead letter: the event is already recorded, so nothing is lost. Mark the
       failure on it so the Control Centre can show it rather than silently
       returning 500 into AxisCare's retry queue. */
    await recordEvent({ ...rec, unresolved: [...unresolved, `queue write failed: ${error.message}`] })
    return new Response('queue write failed', { status: 500 })
  }

  console.log(`client ${clientId} handled — queue row ${data?.[0]?.id ?? '(existing)'}`)
  return new Response(JSON.stringify({
    ok: true, event: internal, axiscare_client_id: clientId,
    queue_row: data?.[0]?.id ?? null, unresolved,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
})
