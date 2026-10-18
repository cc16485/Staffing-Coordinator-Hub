// Rules guard (2026-10-18): the Hub's PR check (care-coordinator-hub tools/rules-guard.mjs) must know EVERY rules file
// a server job loads through approvedRules, or a change to the missing one could go live unapproved and stop that job.
// This reads the functions here and the guard's list in the Hub.  HUB_ROOT=<care-coordinator-hub checkout> node rules_guard_list_test.mjs
import fs from 'fs'; import path from 'path'
const ROOT = path.dirname(new URL(import.meta.url).pathname)
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 600)])
const FN = path.join(ROOT, 'supabase/functions')
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.ts') ? [path.join(d, e.name)] : [])
const loaded = new Set()
for (const f of walk(FN)) {
  if (f.endsWith('_shared/approved-rules.ts') || /\/_[^/]*_t\.ts$/.test(f)) continue
  const s = fs.readFileSync(f, 'utf8')
  for (const m of s.matchAll(/\b(?:RULES|RULES_FILE|ELIG_FILE|ENGINE_FILE)\s*=\s*'([a-z0-9-]+\.js)'/g)) loaded.add(m[1])
  if (/approvedRules\(|rulesCheck\(|approved-rules/.test(s)) for (const m of s.matchAll(/'([a-z0-9-]+\.js)'/g)) loaded.add(m[1])
}
ck('found the rules files the server loads (sanity: at least the nine known on 2026-10-18)', ['caregiver-connect-rules.js', 'client-start.js', 'eligibility-rules.js', 'ihs-rules.js',
  'intake-import-rules.js', 'launch-evidence.js', 'match-rules.js', 'obligations.js', 'promise-engine.js'].every((x) => loaded.has(x)), [...loaded])
const HUB = process.env.HUB_ROOT
if (!HUB) ck('HUB_ROOT is set (the Hub half needs it)', false)
else {
  const g = path.join(HUB, 'tools/rules-guard.mjs')
  if (!fs.existsSync(g)) ck('the Hub has tools/rules-guard.mjs (merge the Hub guard PR first, or point HUB_ROOT at its branch)', false, g)
  else {
    const src = fs.readFileSync(g, 'utf8')
    const list = new Set([...(src.match(/RULES_FILES = \[([\s\S]*?)\]/) || ['', ''])[1].matchAll(/'([a-z0-9-]+\.js)'/g)].map((m) => m[1]))
    const missing = [...loaded].filter((x) => !list.has(x))
    ck('every rules file the server loads is on the Hub guard\'s list', missing.length === 0, { missing })
  }
}
let p = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '  ' + note)); if (ok) p++ }
console.log(`${p}/${res.length} passed`); process.exit(p === res.length ? 0 : 1)
