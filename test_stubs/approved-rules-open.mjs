// Test stand-in for _shared/approved-rules.ts in the older functional harnesses (G2, 2026-09-29): they serve their
// own engine file and test what a job DOES with it, so every file counts as approved here. The real approval check
// (fingerprint must be in rules_approved; a changed file never runs) is tested in g2_approved_rules_test.mjs.
export async function approvedRules(_db, file, send = fetch) {
  try { const r = await send('https://cc.mo-care.com/' + file + '?v=0', {})
    if (!r.ok) return { ok: false, file, error: file + ' responded ' + r.status, fingerprint: null }
    return { ok: true, file, src: await r.text(), fingerprint: 'test' }
  } catch (e) { return { ok: false, file, error: 'could not download ' + file + ': ' + String(e), fingerprint: null } }
}
export async function rulesCheck() { return { ok: true, rules_check: [], all_approved: true } }
