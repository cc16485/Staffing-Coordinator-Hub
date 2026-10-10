// =============================================================================
// oig-leie.ts · SLICE 6 (Samantha "yes to all", 2026-10-10; decision 2: monthly OIG as agency policy with retained results).
// The one exclusion check the server runs: the HHS-OIG LEIE database (UPDATED.csv, the same file the Hub's oig-check uses),
// exact LASTNAME + FIRSTNAME match, the result kept as evidence (what was searched, when, how many matches, the matches).
// HHS-OIG Special Advisory Bulletin (May 2013): monthly screening, keep documentation of the searches. Missouri MMAC:
// providers search the HHS-OIG list monthly. A match is never a verdict: it is a review for the screening staff.
// deno-lint-ignore-file no-explicit-any
export const LEIE_URL = 'https://oig.hhs.gov/exclusions/downloadables/UPDATED.csv'
export const OIG_INTERVAL_DAYS = 30
export const OIG_SOURCE = 'HHS-OIG LEIE (UPDATED.csv)'
export type Match = { lastname: string; firstname: string; midname: string; dob: string; state: string; excltype: string; excldate: string }
export type Leie = { lines: string[]; fetched_at: string }

function parseRow(line: string): string[] {
  const out: string[] = []; let cur = '', q = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += ch }
    else { if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = '' } else if (ch === '\r') { /* skip */ } else cur += ch }
  }
  out.push(cur); return out
}
const fmtDate = (s: string) => { s = (s || '').trim(); return !/^\d{8}$/.test(s) || s === '00000000' ? '' : s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8) }

/** Download the LEIE once per run. Throws when it cannot be read (the caller then checks nobody and says so). */
export async function loadLeie(send: typeof fetch = fetch): Promise<Leie> {
  const r = await send(LEIE_URL, { headers: { 'User-Agent': 'caring-companions-hub/caregiver-audit' } })
  if (!r.ok) throw new Error(`OIG database download failed (${r.status})`)
  const text = await r.text()
  if (text.length < 200 || !/LASTNAME/i.test(text.slice(0, 400))) throw new Error('OIG database download was not the LEIE file')
  return { lines: text.split('\n'), fetched_at: new Date().toISOString() }
}
/** Exact last name + first name, upper-cased, as the Hub's check does. */
export function matchLeie(leie: Leie, first: unknown, last: unknown): { clear: boolean; matches: Match[]; query: { first: string; last: string } } {
  const f = String(first ?? '').trim().toUpperCase(), l = String(last ?? '').trim().toUpperCase()
  if (!f || !l) return { clear: false, matches: [], query: { first: f, last: l } }
  const prefix = '"' + l + '",'
  const matches = leie.lines.filter((ln) => ln.slice(0, prefix.length).toUpperCase() === prefix).map(parseRow).filter((x) => (x[1] || '').trim().toUpperCase() === f)
    .map((x) => ({ lastname: x[0] || '', firstname: x[1] || '', midname: x[2] || '', dob: fmtDate(x[8] || ''), state: x[11] || '', excltype: x[13] || '', excldate: fmtDate(x[14] || '') }))
  return { clear: matches.length === 0, matches, query: { first: f, last: l } }
}
/** The evidence record the roster keeps (the same shape the Background and References row writes). */
export function oigEvidence(r: ReturnType<typeof matchLeie>, checkedAt: string) {
  return { source: OIG_SOURCE, checked_at: checkedAt, query: r.query, match_count: r.matches.length, matches: r.matches.slice(0, 50), clear: r.clear, by: 'caregiver-audit (monthly)' }
}
/** Due again? No date, or the last check is OIG_INTERVAL_DAYS or more days old. */
export function oigDue(lastDate: unknown, today: string): boolean {
  const d = String(lastDate ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return true
  const ms = Date.parse(today + 'T00:00:00Z') - Date.parse(d + 'T00:00:00Z')
  return ms >= OIG_INTERVAL_DAYS * 86400000
}
