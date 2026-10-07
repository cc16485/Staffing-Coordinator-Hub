// =============================================================================
// Lead response hours (Leads intake desk, Stage 1; Samantha 2026-10-06)
// =============================================================================
// The hours a new inquiry's 5-minute first-call clock runs, from ops_settings.lead_response_hours
// (the Hub Settings card "Lead response hours", linked from the Owners Hub Admin page). The rules
// live in _shared/lead-rules.js, the SAME file the Hub page runs, so the card on My Work, the Leads
// board and the after-hours acknowledgment can never disagree about whether we are open.
// Anything unreadable falls back to lead-rules.js's default (Mon–Fri 8 to 6 Central). Never hard-code hours here.
// =============================================================================
import './lead-rules.js'
// deno-lint-ignore no-explicit-any
export const LeadRules: any = (globalThis as any).LeadRules

export type ResponseHours = { days: number[]; start: string; end: string; source: 'setting' | 'default' }

// deno-lint-ignore no-explicit-any
export async function leadResponseHours(db: any): Promise<ResponseHours> {
  try {
    const { data, error } = await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
    if (error) return LeadRules.responseHours({})
    const s = data?.data
    return LeadRules.responseHours((Array.isArray(s) ? s[0] : s) ?? {})
  } catch { return LeadRules.responseHours({}) }
}

/** Are lead response hours open at this moment, and if not, when do they open ("we open tomorrow at 8 am")? */
export function leadHoursNow(hours: ResponseHours, now: Date = new Date()): { open: boolean; opens: string; call_back: string; opening_at: string } {
  const iso = now.toISOString()
  return { open: !!LeadRules.inResponseHours(iso, hours), opens: String(LeadRules.openingWords(iso, hours)),
    call_back: String(LeadRules.callBackWords(iso, hours)), opening_at: String(LeadRules.nextOpening(iso, hours)) }
}
