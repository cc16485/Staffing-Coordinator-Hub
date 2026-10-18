// G2 (2026-09-29) · APPROVED RULES ONLY. Since 2026-10-18: GITHUB MAIN IS THE APPROVAL.
// Server jobs run a rules file from cc.mo-care.com (the same file the Hub page runs, so both decide alike). The file
// runs with the server's full access, so the server runs it only when it is a version it can trust: its SHA-256
// fingerprint is already in public.rules_approved (server role only), or it is byte for byte the same file as on the
// Hub's GitHub main branch (cc16485/care-coordinator-hub) right now. A match is recorded in rules_approved, so it is
// asked once. Samantha, 2026-10-18: no more approve steps; a merged Hub change is trusted on its own. What is still
// refused BEFORE a line of it runs: a file GitHub main does not have (a tampered site or domain), an unreadable list,
// a failed download, and GitHub not answering for a new version (the next run tries again). The Hub page is unaffected.
// deno-lint-ignore-file no-explicit-any
export const RULES_BASE = 'https://cc.mo-care.com/'
export const GH_REPO = 'cc16485/care-coordinator-hub'

export type RulesOk = { ok: true; file: string; src: string; fingerprint: string }
export type RulesNo = { ok: false; file: string; error: string; fingerprint: string | null }

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')

/** The fingerprint of `file` on GitHub main right now: the commit main points at, then the file at that exact commit
    (a commit's files never change, so no stale copy). Returns {fp, commit} or {error}. Never throws. */
export async function mainFingerprint(file: string, send: typeof fetch = fetch): Promise<{ fp: string; commit: string } | { error: string }> {
  try {
    const c = await send(`https://api.github.com/repos/${GH_REPO}/commits/main`, { headers: { Accept: 'application/vnd.github.sha', 'User-Agent': 'cc-rules-check' } })
    const commit = (await c.text()).trim()
    if (!c.ok || !/^[0-9a-f]{40}$/.test(commit)) return { error: 'GitHub did not say what main is (' + c.status + ')' }
    const r = await send(`https://raw.githubusercontent.com/${GH_REPO}/${commit}/${file}`, { headers: { 'User-Agent': 'cc-rules-check' } })
    if (!r.ok) return { error: 'GitHub main has no ' + file + ' (' + r.status + ')' }
    return { fp: hex(await crypto.subtle.digest('SHA-256', await r.arrayBuffer())), commit }
  } catch (e) { return { error: 'could not reach GitHub: ' + String(e).slice(0, 120) } }
}

/** Download `file` from the Hub site and return its text only if it is approved or matches GitHub main. Never throws. */
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
    if (Array.isArray(data) && data.length) return { ok: true, file, src: new TextDecoder().decode(buf), fingerprint }
  } catch { return { ok: false, file, error: 'could not read the approved rules list, so ' + file + ' was not run', fingerprint } }
  // not seen before: trusted only if it is exactly GitHub main's copy
  const gh = await mainFingerprint(file, send)
  if ('error' in gh) return { ok: false, file, error: `${file} (fingerprint ${fingerprint.slice(0, 12)}) is new and could not be checked against GitHub main: ${gh.error}; it was not run, the next run tries again`, fingerprint }
  if (gh.fp !== fingerprint)
    return { ok: false, file, error: `rules file does not match GitHub main: ${file} (site ${fingerprint.slice(0, 12)}, main ${gh.fp.slice(0, 12)}); it was not run`, fingerprint }
  try { await db.from('rules_approved').upsert({ file, sha256: fingerprint, note: 'matches GitHub main ' + gh.commit.slice(0, 7) }, { onConflict: 'file,sha256', ignoreDuplicates: true }) }
  catch { /* recording is a convenience: the file already matched main */ }
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
