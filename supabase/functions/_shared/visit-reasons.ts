// =============================================================================
// WHAT EACH AXISCARE REASON MEANS (Samantha, 2026-10-24: "Build Cara reading the reasons by AxisCare id (the 6-reason
// plan), switch off, so we can rename and turn off reasons safely afterward.")
// =============================================================================
// Cara used to guess from words in the reason ("call off", "caregiver change"), so an office swap opened a call-in case
// and a cancelled visit left empty looked like an open shift. Now each AxisCare reason id has ONE meaning, and Cara reads
// it together with what the visit actually shows (a real caregiver, the "Canceled Shift" placeholder, nobody, removed).
// Visits carry the reason by NAME only, so each run reads AxisCare's list (id, name) and matches the name to its id:
// renaming a reason in AxisCare keeps its id, so its meaning follows it.
// The meanings are her 6-reason plan (artifact 5qAAzf3UY2C9exGXoPGLRM), changeable per id in ops_settings
// visit_reason_meanings. Switch ops_settings.visit_reasons_live (off): the watcher works as before and only reports what
// it would do differently.
// =============================================================================
// deno-lint-ignore no-explicit-any
type Any = any
const S = (v: unknown, n = 200) => String(v ?? '').trim().slice(0, n)

export type Meaning = 'call_off' | 'no_show' | 'swap' | 'couldnt_staff' | 'client_cancelled' | 'moved' | 'office_fix' | 'records' | 'family_app' | 'unknown'
export const MEANINGS: Meaning[] = ['call_off', 'no_show', 'swap', 'couldnt_staff', 'client_cancelled', 'moved', 'office_fix', 'records', 'family_app']
/** Her plan, by AxisCare id (1107 read the ids on 2026-10-24). */
export const DEFAULT_MEANINGS: Record<string, Meaning> = {
  '1': 'records', '2': 'records', '3': 'records', '4': 'records',     // EVV corrections
  '5': 'swap',                 // Staffing Change - Caregiver Change          (our change, never a call-off)
  '6': 'call_off',             // Staffing Change - Caregiver Call Off
  '7': 'couldnt_staff',        // Staffing Change - Unable to Staff           (cancelled by us)
  '8': 'no_show',              // Staffing Change - No Show
  '9': 'client_cancelled',     // Schedule Change - Client Cancellation
  '10': 'moved',               // Schedule Change - Client Schedule Change    (to be switched off: a move takes no reason)
  '11': 'client_cancelled',    // Schedule Change - Hospitalization            (to be switched off)
  '12': 'client_cancelled',    // Schedule Change - Client Unavailable         (to be switched off)
  '13': 'office_fix',          // Administrative Correction - Office Error
  '14': 'records',             // Administrative Correction - Documentation Update
  '15': 'family_app',          // Booked by family in app
}
export const MEANING_WORDS: Record<Meaning, string> = {
  call_off: 'The caregiver called off', no_show: 'The caregiver didn\'t show', swap: 'We changed the caregiver',
  couldnt_staff: 'We couldn\'t staff it (cancelled by us)', client_cancelled: 'The client cancelled', moved: 'A new day or time',
  office_fix: 'Fixing an office mistake', records: 'Timekeeping or records only', family_app: 'Booked in the family app', unknown: 'A reason Cara doesn\'t know yet',
}
export const PLACEHOLDER_ID_DEFAULT = '618'

const nk = (s: unknown) => S(s).toLowerCase().replace(/\s+/g, ' ')
export type Reason = { id: string; name: string; disabled: boolean; meaning: Meaning }
export type Table = { byName: Map<string, Reason>; ok: boolean; placeholderId: string }

/** The table for this run: AxisCare's list (id, name) with each id's meaning (settings override the defaults). */
export function reasonTable(list: Any[] | null, st: Any = {}): Table {
  const over: Record<string, string> = (st && typeof st.visit_reason_meanings === 'object' && st.visit_reason_meanings) || {}
  const byName = new Map<string, Reason>()
  for (const x of (Array.isArray(list) ? list : [])) {
    const id = S(x?.id, 20); if (!id) continue
    const o = S(over[id], 30) as Meaning
    const meaning: Meaning = MEANINGS.includes(o) ? o : (DEFAULT_MEANINGS[id] ?? 'unknown')
    byName.set(nk(x?.name), { id, name: S(x?.name, 120), disabled: x?.disabled === true, meaning })
  }
  const ph = /^\d+$/.test(S(st?.placeholder_caregiver_id)) ? S(st.placeholder_caregiver_id) : PLACEHOLDER_ID_DEFAULT
  return { byName, ok: byName.size > 0, placeholderId: ph }
}

/** "Canceled Shift": by its AxisCare id, or by name (either spelling). Never a person. */
export function isPlaceholder(cg: Any, t?: Table | null): boolean {
  if (cg == null) return false
  if (t && S(cg?.id) && S(cg.id) === t.placeholderId) return true
  return /^cancel+ed( shifts?)?$/i.test([cg?.firstName, cg?.lastName].map((x: unknown) => S(x)).filter(Boolean).join(' ').replace(/\s+/g, ' '))
}

/** The reason on a visit: its id and meaning. No reason = null meaning; a name AxisCare's list doesn't have = unknown. */
export function reasonOf(v: Any, t: Table): { id: string | null; name: string; meaning: Meaning | null } {
  const name = S(v?.modificationReason?.name, 120)
  if (!name) return { id: null, name: '', meaning: null }
  const r = t.byName.get(nk(name))
  return r ? { id: r.id, name: r.name, meaning: r.meaning } : { id: null, name, meaning: 'unknown' }
}

export type Read = {
  state: 'removed' | 'placeholder' | 'empty' | 'caregiver'
  reason: { id: string | null; name: string; meaning: Meaning | null }
  /** the visit isn't happening: by the client, or by us (couldn't staff) */
  cancelled: 'client' | 'us' | null
  /** nobody is on it and it still needs care: an open shift */
  needs_care: boolean
  /** a call-off case should open (empty, and the reason is a call-off or a no-show) */
  opens_case: boolean
  /** the reason says cancelled but a real caregiver is on it: one card to ask which is right */
  mismatch: boolean
}
/** Reason + what the visit shows, read together (her rule 6). */
export function readVisit(v: Any, t: Table): Read {
  const reason = reasonOf(v, t)
  const m = reason.meaning
  const state: Read['state'] = v?.removed === true ? 'removed' : isPlaceholder(v?.caregiver, t) ? 'placeholder' : v?.caregiver?.id == null ? 'empty' : 'caregiver'
  const saysCancelled = m === 'client_cancelled' ? 'client' : m === 'couldnt_staff' ? 'us' : null
  let cancelled: Read['cancelled'] = null
  /* a DELETED visit is cancelled only when its reason says so (2026-10-24, her rule after the first live run): AxisCare also
     deletes and re-makes visits when the office edits a schedule (Edward's and April's, "Office Error" or no reason), so a
     deletion alone says nothing about whether care is still needed */
  if (state === 'removed') cancelled = saysCancelled
  else if (state === 'placeholder') cancelled = saysCancelled ?? 'client'
  else if (state === 'empty' && saysCancelled) cancelled = saysCancelled
  return { state, reason, cancelled,
    needs_care: state === 'empty' && !cancelled,
    opens_case: state === 'empty' && (m === 'call_off' || m === 'no_show'),
    mismatch: state === 'caregiver' && !!saysCancelled }
}

/** How a case closes when its visit turns out cancelled. */
export const closeHowFor = (c: 'client' | 'us') => c === 'us' ? 'couldnt_staff' : 'client_cancelled'
