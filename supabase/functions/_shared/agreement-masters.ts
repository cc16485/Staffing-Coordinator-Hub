// =============================================================================
// agreement-masters · every Client Care Agreement master the Hub has ever had someone sign (2026-10-17). An agreement is
// always rebuilt (countersign, the family's printed and emailed copies) on the master it was started on, found by the
// pdf_sha256 saved on its row, so a wording change never rewrites what a family already read. New agreements use the
// current master (client-agreement-map.ts). Add a line here, never remove one.
// =============================================================================
import * as current from './client-agreement-map.ts'
import * as third from './client-agreement-map-2026-10-18.ts'
import * as second from './client-agreement-map-2026-10-17.ts'
import * as first from './client-agreement-map-2026-10-16.ts'
import type { Field } from './client-agreement-map.ts'

export type Master = { sha: string; path: string; pages: number; version: string; fields: Record<string, Field> }
const of = (m: typeof current | typeof third | typeof second | typeof first): Master => ({ sha: m.PDF_SHA256, path: m.MASTER_PATH, pages: m.PAGES, version: m.VERSION, fields: m.FIELDS })
export const MASTERS: Record<string, Master> = Object.fromEntries([current, third, second, first].map((m) => [m.PDF_SHA256, of(m)]))
export const CURRENT: Master = of(current)

/** The master an agreement was started on. Unknown means the row is damaged: refuse rather than guess. */
export function masterFor(sha: unknown): Master {
  const m = MASTERS[String(sha ?? '')]
  if (!m) throw new Error('this agreement was started on a master the server does not know')
  return m
}
