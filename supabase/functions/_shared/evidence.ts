// =============================================================================
// evidence.ts · SLICE 9 (Samantha "yes to all", 2026-10-11): reading the value history (public.evidence_history) for the
// audit exports. The history is written only by the database watchers (slice9-evidence.sql) and starts the day slice 9 is
// installed; nothing earlier was ever kept, so the exports say so.
//   evidenceRows(db, [{ source, ids }])   every line for those records, oldest first
//   rewind(rec, rows, source, id, cutoff) the record as it stood at the cutoff (each field's value before the first change
//                                         after the cutoff; a field with no later change keeps today's value)
//   evidenceLine(row)                     one readable line for the PDF
// deno-lint-ignore-file no-explicit-any
type Any = any
export const EVIDENCE_NOTE = 'Value history is kept from the day evidence history was switched on (Slice 9); changes before that day were not recorded.'
export async function evidenceRows(db: Any, wants: Array<{ source: string; ids: string[] }>, max = 2000): Promise<Any[]> {
  const out: Any[] = []
  for (const w of wants) {
    const ids = [...new Set(w.ids.filter(Boolean).map(String))]
    if (!ids.length) continue
    try {
      const { data, error } = await db.from('evidence_history').select('*').eq('source', w.source).in('record_id', ids).order('at', { ascending: true }).limit(max)
      if (!error) out.push(...(data ?? []))
    } catch { /* the export still builds; the section says nothing was found */ }
  }
  return out.filter((r) => r && r.change !== 'trigger_error').sort((a, b) => String(a.at).localeCompare(String(b.at)) || Number(a.id) - Number(b.id))
}
export function rewind(rec: Any, rows: Any[], source: string, id: string, cutoff: string): Any {
  if (!rec || !cutoff) return rec
  const mine = rows.filter((r) => r.source === source && String(r.record_id) === String(id) && String(r.at) > cutoff)
  if (mine.some((r) => r.change === 'added')) return null       /* it did not exist yet at the cutoff */
  const out = { ...rec }, done = new Set<string>()
  for (const r of mine) {                                          /* oldest first: the first change after the cutoff holds the value before it */
    if (r.change !== 'changed' || !r.field || done.has(r.field)) continue
    done.add(r.field)
    if (r.old_value && typeof r.old_value === 'object' && 'md5' in r.old_value && 'len' in r.old_value) continue   /* a fingerprint: keep today's value */
    if (r.old_value === null || r.old_value === undefined) delete out[r.field]; else out[r.field] = r.old_value
  }
  return out
}
const show = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return 'blank'
  if (typeof v === 'object' && v && 'md5' in (v as Any) && 'len' in (v as Any)) return 'a signature or signed answers (fingerprint ' + String((v as Any).md5).slice(0, 8) + ')'
  const t = typeof v === 'string' ? v : JSON.stringify(v)
  return t.length > 140 ? t.slice(0, 137) + '...' : t
}
export function evidenceLine(r: Any, label = ''): string {
  const who = String(r.actor || 'server').slice(0, 60)
  const what = r.change === 'changed' ? `${r.field}: from ${show(r.old_value)} to ${show(r.new_value)}`
    : r.change === 'added' ? 'record added' + (r.new_value && Object.keys(r.new_value).length ? ' with ' + show(r.new_value) : '')
    : r.change === 'removed' ? 'record removed; it held ' + show(r.old_value) : String(r.change)
  return [label, what, 'by ' + who].filter(Boolean).join(' · ')
}
