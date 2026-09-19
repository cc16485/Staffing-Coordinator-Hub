/* events.ts — server-side writes into op_events, the append-only record.

   Same contract as the hub's opEvent(): fire-and-forget, an observer that is
   never a dependency. A failed write costs history, never operations. The
   human-facing test for adding an emitter anywhere: would Krystal or
   Samantha need this line to understand what happened while they were gone?
   Diagnostics (shadow rows etc.) keep their own verbs and are filtered out
   of the human ledger by the hub. */

// deno-lint-ignore-file no-explicit-any
type SB = any

export async function opEvent(sb: SB, row: {
  verb: string
  summary: string
  actor_name?: string   // defaults to Cara — the automation did it
  actor_email?: string
  item_id?: string
  area?: string
  data?: Record<string, unknown>
}): Promise<void> {
  try {
    await sb.from('op_events').insert({
      actor_email: row.actor_email ?? '',
      actor_name: row.actor_name ?? 'Cara',
      verb: String(row.verb || ''),
      item_id: String(row.item_id ?? ''),
      area: String(row.area ?? ''),
      summary: String(row.summary || '').slice(0, 400),
      data: row.data ?? {},
    })
  } catch { /* the record is an observer, never a dependency */ }
}
