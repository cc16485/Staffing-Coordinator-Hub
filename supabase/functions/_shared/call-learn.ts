// =============================================================================
// call-learn · which recorded calls to read, and what to keep from the reading (Learned on this call, step 1)
// =============================================================================
// Samantha 2026-10-22: "our previous builds has supposed to have been building every call into more information about
// the lead and their family... sometimes we speak to someone several times before they book an assessment, we want to
// compaile as much information as possible, dont lose any info." Approved mockup: https://claude.ai/artifact/BapTUgrqCvdYjjjvgFRDDR
// (her yes to all 5 decisions, "Build step 1 in practice").
// The pure part: picking the answered calls the recorder put on a lead that have not been read yet, and the shape kept
// for the Hub. The transcript itself is never kept; only what the call reader filled in. Nothing here writes anything.
// =============================================================================
// deno-lint-ignore no-explicit-any
type Any = any

export const PER_RUN = 3, MAX_TRIES = 4, MIN_SECONDS = 30
/** A call_learned status that will not be tried again. 'waiting' (no transcript yet) and 'error' are tried again. */
export const FINAL = new Set(['read', 'no_transcript', 'skipped'])

/** GoHighLevel's transcription: pieces with a speaker channel and the words (the same reading as call-to-lead). */
export function transcriptText(t: Any): string {
  if (typeof t === 'string') return t.trim()
  const arr: Any[] = Array.isArray(t) ? t : (t?.transcription || t?.data || t?.sentences || [])
  if (!Array.isArray(arr)) return ''
  return arr.slice().sort((a, b) => Number(a?.sentenceIndex ?? a?.startTime ?? 0) - Number(b?.sentenceIndex ?? b?.startTime ?? 0))
    .map((p) => {
      const words = String(p?.transcript ?? p?.sentence ?? p?.text ?? '').trim()
      if (!words) return ''
      const ch = p?.mediaChannel ?? p?.channel ?? p?.speaker
      return (ch != null && ch !== '' ? `Speaker ${ch}: ` : '') + words
    }).filter(Boolean).join('\n')
}

/** The recorder's rows worth reading, oldest first: answered calls on one lead (recorded as a conversation, or already
 *  logged by hand), that lead still on file and not archived, not yet read for good, and tried fewer than MAX_TRIES. */
export function pickTodo(seen: Any[], done: Any[], leads: Any[], max = PER_RUN): Any[] {
  const prev = new Map((done || []).map((d) => [String(d.message_id), d]))
  const live = new Set((leads || []).filter((l) => l && l.id && l.archived !== true).map((l) => String(l.id)))
  return (seen || [])
    .filter((s) => s && s.kind === 'call' && s.lead_id && live.has(String(s.lead_id)))
    .filter((s) => s.status === 'already' || (s.status === 'recorded' && s.ev && s.ev.outcome === 'connected'))
    .filter((s) => { const d = prev.get(String(s.message_id)); return !d || (!FINAL.has(d.status) && Number(d.tries || 0) < MAX_TRIES) })
    .sort((a, b) => String(a.msg_at).localeCompare(String(b.msg_at)))
    .slice(0, max)
}

/** What the Hub needs from one reading (call-lead.ts toPrefill): the boxes heard, the care plan draft, Home & Life and
 *  the people. The phone and email boxes are dropped: on an existing lead they always come from the lead itself. */
export function toStore(p: Any): Any {
  const prefill: Any = {}
  const heard = (Array.isArray(p?.heard) ? p.heard : []).filter((k: string) => !['phone', 'email', 'source'].includes(k) || (k === 'source' && p.prefill?.source && p.prefill.source !== 'Phone'))
  for (const k of heard) if (p?.prefill && k in p.prefill) prefill[k] = p.prefill[k]
  return { prefill, heard: heard.filter((k: string) => k in prefill), care_plan: p?.care_plan || null, profile: p?.profile || null,
    medicaid_mentioned: p?.medicaid_mentioned === true, is_new_family: p?.is_new_family !== false }
}
