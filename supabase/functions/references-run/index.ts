// =============================================================================
// references-run — turn pending references into owned, chased work
// =============================================================================
// THE PRODUCER QUESTION, ANSWERED FROM THE EXISTING WORKFLOW
//
// `reference_requests` has held zero rows since it was created and nothing in
// the codebase inserts into it. The temptation was to write that INSERT. That
// would have been wrong: references are ALREADY tracked, on the candidate
// record, as r1n/r1s/r1_phone/r1_email/r1_proof for four referees. The office
// fills those in, and obDeriveStatus() gates hiring on them:
//
//     pos >= 2 && oigOk && edlOk && bgOk && fpOk  ->  'Ready for Orientation'
//
// Two Positive references is the real requirement. So the candidate record is
// authoritative and `reference_requests` is a duplicate store. This reads the
// authoritative one. Nothing is written to reference_requests, ever.
//
// WHAT COUNTS AS A PENDING REQUEST
//   a referee NAME is recorded, AND a way to reach them, AND status is Pending,
//   AND the candidate is still in play. That is a real outstanding request the
//   office made. No trigger is invented.
//
// WHAT THIS DOES NOT DO
//   It does not message a referee. Detection and routing go live before
//   automated outbound, always. It creates owned work with the referee's
//   details attached so a human sends it, and it chases the OFFICE, not the
//   referee.
//
//   When outbound is switched on it must be EMAIL ONLY. A reference is a
//   third party who never gave us permission to text them, which is precisely
//   what the TCPA exists about, and exposure is per message.
//
// DRY RUN BY DEFAULT. ?commit=1 to write.
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const sb = createClient(SUPABASE_URL, SERVICE_KEY)

/** Nothing older than this becomes NEW work on first activation. Existing
 *  items are never aged out — the guard applies only where no item exists. */
const MAX_AGE_DAYS = Number(Deno.env.get('REFERENCES_MAX_AGE_DAYS') || '60')
/** Per-run ceiling, so a first activation cannot flood the queue. */
const MAX_PER_RUN = Number(Deno.env.get('REFERENCES_MAX_PER_RUN') || '25')
/** The requirement obDeriveStatus() enforces. Kept here so the two agree. */
const POSITIVE_REQUIRED = 2

const clean = (v: unknown) => String(v ?? '').trim()

function todayCentral(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}
/** Local noon, never UTC midnight. */
function dateAt(iso: string): number { return Date.parse(`${iso}T12:00:00`) }
function daysSince(iso: string): number {
  const t = Date.parse(String(iso || ''))
  if (isNaN(t)) return 0
  return Math.floor((Date.now() - t) / 86400000)
}
function endOfDayIso(daysAhead = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + daysAhead)
  d.setHours(23, 59, 59, 999)
  return d.toISOString()
}

/* The chase ladder, in days since the request was recorded. Matches the
   existing hiring cadence rather than inventing a new one. */
const LADDER = [2, 5, 9]

interface RefSlot { n: number; name: string; email: string; phone: string; status: string }

function slotsOf(c: Record<string, unknown>): RefSlot[] {
  const out: RefSlot[] = []
  for (let n = 1; n <= 4; n++) {
    /* Both field spellings exist in the data: r1n/r1s from the original
       schema and r1_name/r1_status from later code. Read both. */
    const name   = clean(c[`r${n}n`]) || clean(c[`r${n}_name`])
    const status = clean(c[`r${n}s`]) || clean(c[`r${n}_status`]) || 'Pending'
    const email  = clean(c[`r${n}_email`])
    const phone  = clean(c[`r${n}_phone`])
    if (!name && !email && !phone) continue
    out.push({ n, name, email, phone, status })
  }
  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200 })
  const q = new URL(req.url).searchParams
  const commit = q.get('commit') === '1'

  const { data: rows, error } = await sb.from('app_data')
    .select('key, data').in('key', ['candidates', 'ops_items'])
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }
  // deno-lint-ignore no-explicit-any
  const candidates = (rows?.find(r => r.key === 'candidates')?.data ?? []) as any[]
  // deno-lint-ignore no-explicit-any
  const items = (rows?.find(r => r.key === 'ops_items')?.data ?? []) as any[]
  const existing = new Map(items.map(i => [String(i.id), i]))

  const stats = {
    candidates_seen: candidates.length,
    in_play: 0,
    reference_slots_recorded: 0,
    pending: 0,
    pending_with_no_way_to_reach: 0,
    already_satisfied: 0,
    candidates_blocked_only_by_references: 0,
    candidates_with_a_negative: 0,
    too_old: 0,
    candidates_needing_work: 0,
    created: 0, updated: 0, closed: 0, capped: 0,
  }

  const toWrite: Array<Record<string, unknown>> = []
  const detail: Array<Record<string, unknown>> = []
  const today = todayCentral()

  for (const c of candidates) {
    /* Still in play? A candidate who was not hired or already resolved is not
       waiting on a reference. */
    if (c.not_hired || clean(c.resolvedStatus)) continue
    stats.in_play++

    const slots = slotsOf(c)
    stats.reference_slots_recorded += slots.length
    if (!slots.length) continue

    const positive = slots.filter(s => s.status === 'Positive').length
    const negative = slots.filter(s => s.status === 'Negative' || s.status === 'Conditional')
    const pending  = slots.filter(s => s.status === 'Pending' || !s.status)
    stats.pending += pending.length

    const itemId = `ops_ref_${c.id}`
    const prior = existing.get(itemId)

    /* SATISFIED — the requirement obDeriveStatus enforces is met. Close the
       work rather than leaving it open forever. */
    if (positive >= POSITIVE_REQUIRED) {
      stats.already_satisfied++
      if (prior && String(prior.status || 'open') !== 'done') {
        toWrite.push({ ...prior, status: 'done', closed_at: new Date().toISOString(),
                       closed_reason: `${positive} positive references recorded` })
        stats.closed++
      }
      continue
    }

    /* A negative or conditional reference is a judgment call, not a chase.
       It belongs with a human immediately and must not be auto-chased. */
    if (negative.length) {
      stats.candidates_with_a_negative++
    }

    if (!pending.length) continue

    const reachable = pending.filter(s => s.email || s.phone)
    stats.pending_with_no_way_to_reach += pending.length - reachable.length

    /* AGE GUARD — applies only where no item exists. Never abandons live work. */
    const age = daysSince(c.addedAt)
    if (!prior && age > MAX_AGE_DAYS) { stats.too_old++; continue }

    /* Is this candidate blocked ONLY by references? That is the expensive
       case: everything else is clear and a hire is waiting on a phone call. */
    const checksClear = c.oig === 'CLEAR' && c.edl === 'Clear' && c.fcsr === 'Clear'
                     && (c.oos !== 'yes' || c.fp === 'Clear')
    if (checksClear) stats.candidates_blocked_only_by_references++

    stats.candidates_needing_work++
    if (stats.created + stats.updated >= MAX_PER_RUN) { stats.capped++; continue }

    const stage = LADDER.filter(d => age >= d).length      // 0..3
    const name = `${clean(c.first)} ${clean(c.last)}`.trim()
    const title = negative.length
      ? `Reference needs a decision: ${name}`
      : `${POSITIVE_REQUIRED - positive} more reference(s) needed: ${name}`

    const body = {
      id: itemId,
      kind: 'reference',
      title,
      candidate_id: c.id,
      owner: prior?.owner ?? '',            // routed by the office's own rules
      domain: 'hiring',
      status: 'open',
      priority: checksClear ? 'high' : 'normal',
      why: checksClear
        ? 'every other requirement is clear. This hire is waiting only on references.'
        : 'references outstanding while other checks are still in progress.',
      positive_so_far: positive,
      needed: POSITIVE_REQUIRED,
      has_negative: negative.length > 0,
      /* The referee details, so whoever picks this up does not have to go
         looking. Email first: a reference must never be texted. */
      referees: pending.map(s => ({
        slot: s.n, name: s.name,
        email: s.email || null,
        phone: s.phone || null,
        contact_by: s.email ? 'email' : (s.phone ? 'phone call' : 'NO CONTACT ON FILE'),
      })),
      chase_stage: stage,
      days_outstanding: age,
      due: endOfDayIso(stage >= LADDER.length ? 0 : 1),
      created_at: prior?.created_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
      source: 'references-run',
      source_of_truth: 'candidate record (r1..r4), not reference_requests',
    }

    if (prior) { stats.updated++ } else { stats.created++ }
    toWrite.push(body)
    detail.push({
      candidate: name, positive, needed: POSITIVE_REQUIRED,
      days_outstanding: age, chase_stage: stage,
      blocked_only_by_references: checksClear,
      referees_reachable: pending.filter(s => s.email || s.phone).length,
      referees_unreachable: pending.length - reachable.length,
    })
  }

  const out: Record<string, unknown> = {
    mode: commit ? 'COMMIT' : 'DRY RUN',
    today, stats, detail: detail.slice(0, 40),
    guards: { max_age_days: MAX_AGE_DAYS, max_per_run: MAX_PER_RUN,
              positive_required: POSITIVE_REQUIRED },
    outbound: 'NONE. This creates and chases WORK, not messages. A referee is ' +
              'a third party who never agreed to be contacted by us, so when ' +
              'outbound is enabled it must be email only.',
    producer_note: 'Read from the candidate record, which the office actually ' +
                   'fills in. reference_requests was not written to and is not ' +
                   'the source of truth.',
  }

  if (!commit) {
    out.note = 'DRY RUN. Nothing written. Pass ?commit=1 to apply.'
    return new Response(JSON.stringify(out, null, 2),
      { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  let ok = 0, failed = 0
  const errors: string[] = []
  for (const item of toWrite) {
    const { error: e } = await sb.rpc('upsert_app_data_item',
      { target_key: 'ops_items', item })
    if (e) { failed++; if (errors.length < 5) errors.push(e.message) } else ok++
  }

  /* READ BACK — never report a write we have not re-read. */
  const { data: after } = await sb.from('app_data')
    .select('data').eq('key', 'ops_items').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const all = (Array.isArray(after?.data) ? after!.data : []) as any[]
  const refItems = all.filter(i => String(i.id || '').startsWith('ops_ref_'))

  out.written = { ok, failed, errors }
  out.verified_by_reading_back = {
    reference_items_total: refItems.length,
    open: refItems.filter(i => String(i.status || 'open') !== 'done').length,
    done: refItems.filter(i => String(i.status) === 'done').length,
    unowned: refItems.filter(i => !clean(i.owner) && String(i.status || 'open') !== 'done').length,
  }

  return new Response(JSON.stringify(out, null, 2),
    { status: 200, headers: { 'Content-Type': 'application/json' } })
})
