/* =============================================================================
   INTERNAL CLIENT EVENTS — the Hub's own vocabulary
   =============================================================================
   These are OUR concepts. They are not claims about what AxisCare calls things,
   and nothing here should be read as documenting their API.

   The point of the boundary: the obligation engine, the check-in cadence and
   every downstream rule consume THESE names. An adapter maps a vendor payload
   into them. When AxisCare changes a field, one adapter changes and nothing
   else does — and if we ever leave AxisCare, the obligations do not have to be
   rewritten in another vendor's vocabulary.

   AXISCARE SAYS WHAT HAPPENED. THE HUB SAYS WHAT NEEDS TO HAPPEN BECAUSE OF IT.
   ============================================================================= */

export type ClientEvent =
  | 'client_created'                // a client record now exists
  | 'care_started'                  // care has ACTUALLY been delivered at least once
  | 'caregiver_assignment_changed'  // who attends has changed
  | 'client_on_hold'                // hospitalised, travelling, paused
  | 'client_restarted'              // care resumes after a hold
  | 'payer_changed'                 // funding source changed
  | 'client_discharged'             // care has ended, permanently

/** Where a fact came from. Kept because two sources may disagree and the
 *  disagreement is itself worth seeing. */
export type EventSource =
  | 'axiscare'        // authoritative for what happened
  | 'soc_fallback'    // a human ticked the Start of Care step
  | 'manual'          // somebody entered it directly

export interface ClientEventRecord {
  /* Deterministic. Same event, same id, however many times it is delivered. */
  id: string
  event: ClientEvent
  /* The canonical identity. NEVER a name, never a queue row id. */
  axiscare_client_id: string
  occurred_at: string            // when the thing happened, not when we heard
  received_at: string            // when we heard
  source: EventSource
  /* Only fields we have actually verified against a real payload belong here.
     Anything unverified stays in `raw` and is explicitly unresolved. */
  facts: Record<string, unknown>
  /* Untouched vendor payload, so a field we did not know we needed on Monday
     is still recoverable on Tuesday. */
  raw?: unknown
  /* Set when a fact could not be determined SAFELY. A named unknown is worth
     more than a confident guess: wrong payer data is worse than missing payer
     data, because nobody goes looking for it. */
  unresolved?: string[]
}

/** Deterministic event id: the same delivery can never produce two records. */
export function eventId(event: ClientEvent, clientId: string, occurredAt: string): string {
  const day = String(occurredAt || '').slice(0, 19)   // to the second
  return `ce_${event}_${clientId}_${day}`.replace(/[^A-Za-z0-9_]/g, '_')
}

/* ── PAYER RESOLUTION ────────────────────────────────────────────────────────
   We proved AxisCare's classes[] mixes semantic types: care level and payer
   share one array. Reading classes[0] and calling it the payer is how
   client_queue ends up saying a client's funding source is "Advanced Care".

   So: match against payers we KNOW, by name, case-insensitively. Anything not
   on the list is UNRESOLVED and becomes a human verification obligation. It
   does not become a guess.

   This list is ours, not AxisCare's. Add to it when a real payload shows a
   class we recognise as a payer — never to make an unknown go away. */
export const KNOWN_PAYERS = [
  'medicaid', 'private pay', 'private', 'va', 'veterans affairs',
  'ltc', 'long term care', 'long-term care', 'medicare guide', 'guide', 'cds',
]

export interface PayerResult {
  payer: string | null
  unresolved: boolean
  reason: string
  /* Everything we looked at, so a human deciding this has the same view. */
  candidates: string[]
}

/**
 * Resolve a payer from whatever class-like labels a payload carried.
 *
 * Deliberately position-independent, and deliberately refuses rather than
 * guesses. Two matches is also a refusal — a client whose classes contain both
 * "Medicaid" and "Private Pay" needs a person, not a coin toss.
 */
export function resolvePayer(labels: unknown): PayerResult {
  const list = Array.isArray(labels)
    ? labels.map((x: any) => String(x?.label ?? x?.name ?? x ?? '').trim()).filter(Boolean)
    : []
  if (!list.length)
    return { payer: null, unresolved: true, reason: 'no class labels present', candidates: [] }

  const hits = list.filter(l => KNOWN_PAYERS.includes(l.toLowerCase()))
  if (hits.length === 1)
    return { payer: hits[0], unresolved: false, reason: 'matched a known payer', candidates: list }
  if (hits.length > 1)
    return {
      payer: null, unresolved: true,
      reason: `more than one known payer present (${hits.join(', ')}) — a person must decide`,
      candidates: list,
    }
  return {
    payer: null, unresolved: true,
    reason: 'no label matched a known payer — do not infer from position',
    candidates: list,
  }
}
