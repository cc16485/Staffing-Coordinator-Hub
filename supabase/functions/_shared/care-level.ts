// =============================================================================
// care-level — the ONE rule for reading a care level from AxisCare classes (Change 6b, 2026-09-27)
// =============================================================================
// Samantha's ladder: Level 1 Wellness, Level 2 Personal Care, Level 3 Complex / Advanced Care.
// Replaces five identical copies (coverage-run, coverage-shifts x2, profile-check, the hub's
// caregiver directory), which missed "Advanced Care". classes[] also holds payer classes
// (the audited mix), so only level wording counts, and the class read is reported.
// A person can hold SEVERAL level classes (a caregiver trained for 1 and 2): the level is
// the HIGHEST one held (Lacey Williams, first live Cara run).
// =============================================================================
export const LEVEL_NAMES: Record<number, string> = { 1: 'Wellness', 2: 'Personal Care', 3: 'Advanced Care' }

export function levelFromLabel(label: unknown): number | null {
  const t = String(label ?? '').toLowerCase()
  const m = t.match(/level\s*([123])/)
  if (m) return Number(m[1])
  if (/complex|advanced\s*care/.test(t)) return 3
  if (/personal\s*care/.test(t)) return 2
  if (/wellness/.test(t)) return 1
  return null
}
// deno-lint-ignore no-explicit-any
const rowsOf = (x: any): any[] => Array.isArray(x) ? x : (x && typeof x === 'object' ? Object.values(x) : [])
// deno-lint-ignore no-explicit-any
export function careLevelOf(classes: any): { level: number | null; from: string | null } {
  let best: { level: number | null; from: string | null } = { level: null, from: null }
  for (const c of rowsOf(classes)) {
    const label = String(c?.label ?? c?.code ?? (typeof c === 'string' ? c : ''))
    const lv = levelFromLabel(label)
    if (lv != null && (best.level == null || lv > best.level)) best = { level: lv, from: label }
  }
  return best
}
