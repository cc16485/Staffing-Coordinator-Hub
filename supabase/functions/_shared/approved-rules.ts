// G2 (2026-09-29) · APPROVED RULES ONLY.
// Five server jobs run a rules file from cc.mo-care.com (the same file the Hub page runs, so both decide alike). The
// file runs with the server's full access, so the server now runs only a version Samantha approved: the file's
// SHA-256 fingerprint must be in public.rules_approved, a table only the server role can read or write (changed only
// by a reviewed Desktop step). Anything else (an unapproved or changed file, an unreadable list, a failed download)
// is refused BEFORE a line of it runs. The Hub page is unaffected.
// deno-lint-ignore-file no-explicit-any
export const RULES_BASE = 'https://cc.mo-care.com/'

export type RulesOk = { ok: true; file: string; src: string; fingerprint: string }
export type RulesNo = { ok: false; file: string; error: string; fingerprint: string | null }

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')

/** Download `file` from the Hub site and return its text only if its fingerprint is approved. Never throws. */
export async function approvedRules(db: any, file: string, send: typeof fetch = fetch): Promise<RulesOk | RulesNo> {
  let buf: ArrayBuffer
  try {
    const r = await send(RULES_BASE + file + '?v=' + Math.floor(Date.now() / 300000), { headers: { Accept: 'application/javascript' } })
    if (!r.ok) return { ok: false, file, error: file + ' responded ' + r.status, fingerprint: null }
    buf = await r.arrayBuffer()
  } catch (e) { return { ok: false, file, error: 'could not download ' + file + ': ' + String(e), fingerprint: null } }
  const fingerprint = hex(await crypto.subtle.digest('SHA-256', buf))
  try {
    const { data, error } = await db.from('rules_approved').select('sha256').eq('file', file).eq('sha256', fingerprint).limit(1)
    if (error) return { ok: false, file, error: 'could not read the approved rules list, so ' + file + ' was not run', fingerprint }
    if (!Array.isArray(data) || !data.length)
      return { ok: false, file, error: `rules file not approved: ${file} (fingerprint ${fingerprint.slice(0, 12)}); it was not run`, fingerprint }
  } catch { return { ok: false, file, error: 'could not read the approved rules list, so ' + file + ' was not run', fingerprint } }
  return { ok: true, file, src: new TextDecoder().decode(buf), fingerprint }
}

/** ?rules_check=1 (after the caller check): which rules this job would run, approved or not. Nothing is run. */
export async function rulesCheck(db: any, files: string[], send: typeof fetch = fetch) {
  const out = []
  for (const f of files) {
    const g = await approvedRules(db, f, send)
    out.push({ file: f, fingerprint: g.fingerprint ? g.fingerprint.slice(0, 12) : null, approved: g.ok, ...(g.ok ? {} : { error: g.error }) })
  }
  return { ok: true, rules_check: out, all_approved: out.every((x) => x.approved) }
}
