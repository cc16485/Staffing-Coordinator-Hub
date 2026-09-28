// =============================================================================
// call-record · one line per call the Hub hears about (K1, approved 2026-09-28)
// =============================================================================
// Writes through call_record_add() (service_role only). Who the call was with is decided by the door, not here: it
// looks the number up itself (exactly one person or one lead, else 'several' / 'none'). Never throws: recording must
// never break the phone pipeline it sits in.
// =============================================================================
export type CallLine = {
  kind: 'outcome' | 'summary' | 'ai_reading'
  via: 'call-disposition' | 'call-followup'
  direction?: string | null; phone?: string | null; ghlContactId?: string | null
  outcome?: string | null; summary?: string | null; source?: 'ghl' | 'our_ai' | null
  axiscare?: string | null; axiscareDetail?: string | null; writtenTo?: string | null
}
const AX: Record<string, string> = { posted: 'posted', dry_run: 'practice', skipped: 'skipped', error: 'error' }
export const axiscareState = (outcome: unknown) => AX[String(outcome || '')] || null

// deno-lint-ignore no-explicit-any
export async function recordCall(db: any, c: CallLine): Promise<{ recorded: boolean; match?: string; id?: number }> {
  try {
    const d = String(c.direction || '').toLowerCase()
    const { data, error } = await db.rpc('call_record_add', {
      p_kind: c.kind, p_direction: d === 'outbound' ? 'outbound' : d === 'inbound' ? 'inbound' : 'unknown',
      p_phone: c.phone || null, p_ghl_contact: c.ghlContactId || null, p_outcome: c.outcome || null,
      p_summary: c.summary || null, p_source: c.source || null, p_axiscare: c.axiscare || null,
      p_axiscare_detail: c.axiscareDetail ? String(c.axiscareDetail).slice(0, 300) : null,
      p_written_to: c.writtenTo || null, p_via: c.via,
    })
    if (error || data?.outcome !== 'recorded') return { recorded: false }
    return { recorded: true, match: data.match, id: data.id }
  } catch { return { recorded: false } }
}
