/* events.ts — server-side writes into op_events, the append-only record.

   Same contract as the hub's opEvent(): fire-and-forget, an observer that is
   never a dependency. A failed write costs history, never operations. The
   human-facing test for adding an emitter anywhere: would Krystal or
   Samantha need this line to understand what happened while they were gone?
   Diagnostics (shadow rows etc.) keep their own verbs and are filtered out
   of the human ledger by the hub.

   PHASE 1, SLICE 1 (2026-10-10): the actor is never invented. A row written
   on a person's behalf carries their email and name; a row written by a job
   carries the job's name as actor_id with actor_kind 'job'. The old default
   name 'Cara' is gone: nothing a schedule does is signed by a person who does
   not exist. The contract fields (action, request_id, outcome, evidence,
   approval, via) are optional here and required by the contract wrapper. */

import '../_shared/verbs.js'

// deno-lint-ignore-file no-explicit-any
type SB = any
const CC_VERBS: any = (globalThis as any).CC_VERBS

export type EventRow = {
  verb: string
  summary: string
  actor_name?: string   // a person's name (with actor_email), or omitted for a job
  actor_email?: string
  job?: string          // the function's name when no person is behind the row (becomes actor_id, kind 'job')
  actor_kind?: 'person' | 'employee' | 'job' | 'system'
  actor_id?: string
  via?: 'hub' | 'phone' | 'link' | 'server' | 'cron' | 'owner_key' | ''
  item_id?: string
  area?: string
  data?: Record<string, unknown>
  action?: string
  request_id?: string
  outcome?: '' | 'started' | 'done' | 'already' | 'refused' | 'off' | 'uncertain' | 'failed' | 'preview'
  approval?: { by_email: string; by_name?: string; at: string; seen: string }
  evidence?: Array<{ kind: string; id: string }>
}

/** The actor fields a row will carry, derived the same way every time. */
export function actorOf(row: EventRow) {
  const email = String(row.actor_email ?? '').toLowerCase()
  const kind = row.actor_kind ?? (email ? 'person' : row.job ? 'job' : row.actor_name === 'system' ? 'system' : 'job')
  const name = row.actor_name ?? (kind === 'job' ? (row.job || 'a job') : '')
  const id = row.actor_id ?? (kind === 'job' ? (row.job || '') : '')
  return { actor_email: email, actor_name: String(name).slice(0, 120), actor_kind: kind, actor_id: String(id).slice(0, 120) }
}

export async function opEvent(sb: SB, row: EventRow): Promise<void> {
  try {
    const a = actorOf(row)
    await sb.from('op_events').insert({
      ...a,
      via: row.via ?? (a.actor_kind === 'person' ? 'server' : 'cron'),
      verb: String(row.verb || '').slice(0, 80),
      item_id: String(row.item_id ?? '').slice(0, 200),
      area: String(row.area ?? (CC_VERBS?.area?.(row.verb) || '')).slice(0, 80),
      summary: String(row.summary || '').slice(0, 400),
      data: row.data ?? {},
      action: String(row.action ?? '').slice(0, 120),
      request_id: String(row.request_id ?? '').slice(0, 80),
      outcome: row.outcome ?? '',
      approval: row.approval ?? {},
      evidence: Array.isArray(row.evidence) ? row.evidence.slice(0, 20) : [],
    })
  } catch { /* the record is an observer, never a dependency */ }
}
