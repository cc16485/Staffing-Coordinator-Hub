// =============================================================================
// Inquiry messages · the two switches (Step 0 · 0a, 2026-09-27)
// =============================================================================
// Samantha paused every automatic family-facing inquiry message until the universal opt-out check
// (0b) is proven: "I do not want an automatic family-facing sender left running knowingly without
// that protection." Both switches live in ops_settings and are OFF unless explicitly true:
//   inquiry_ack_live        the immediate "we have your message" acknowledgment (web form + retry sweep)
//   inquiry_followups_live  the day-1 and day-3 "is there a good time to call?" follow-ups
// Anything unreadable counts as OFF (fail closed). The office's "lead waiting" alert is not governed here.
// =============================================================================
// deno-lint-ignore no-explicit-any
export async function inquirySwitches(db: any): Promise<{ ack: boolean; followups: boolean; read_ok: boolean }> {
  try {
    const { data, error } = await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
    if (error) return { ack: false, followups: false, read_ok: false }
    const s = data?.data
    const o = (Array.isArray(s) ? s[0] : s) ?? {}
    return { ack: o.inquiry_ack_live === true, followups: o.inquiry_followups_live === true, read_ok: true }
  } catch { return { ack: false, followups: false, read_ok: false } }
}
