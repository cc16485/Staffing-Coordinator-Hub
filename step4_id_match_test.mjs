// Step 4 part 1 (2026-10-14): stop matching caregivers by typed name. The fragility forecast in coverage-shifts counts
// call-ins by the AxisCare caregiver id when the attendance event has one, and by name only for events without one;
// coverage-run writes the id onto the call-in it logs. The REAL coverage-shifts function against a fake AxisCare and a
// fake database. Made-up people only. node step4_id_match_test.mjs
// (coverage-watch is covered in loops_phase2_test.mjs, missed-notes in missed_notes_test.mjs.)
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)])
const V = (id, cgId, first, last) => ({ id, scheduledStartDate: '2026-10-14T09:00:00', scheduledEndDate: '2026-10-14T12:00:00',
  client: { id: 900 + id, firstName: 'Cl' + id, lastName: 'X' }, caregiver: { id: cgId, firstName: first, lastName: last } })
let VISITS = []
globalThis.fetch = async (url) => { url = String(url)
  if (url.includes('/api/visits')) return new Response(JSON.stringify({ results: { visits: VISITS, nextPage: null } }), { status: 200 })
  return new Response(JSON.stringify({ results: {} }), { status: 200 }) }
const ENV = { AXISCARE_API_KEY: 't', AXISCARE_SITE: '16485', SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_s4_'))
const jwt = (role) => 'x.' + Buffer.from(JSON.stringify({ role })).toString('base64url') + '.y'
const now = new Date().toISOString(), old = new Date(Date.now() - 40 * 864e5).toISOString()
const E = (cg, axId, at = now, type = 'callin') => ({ type, caregiver: cg, created_at: at, ...(axId ? { axiscare_caregiver_id: axId } : {}) })
try {
  fs.writeFileSync(path.join(tmp, 'fake-sb.mjs'), `export const createClient = () => ({ from: (t) => ({ select: () => ({ eq: (c, k) => ({ maybeSingle: async () => ({ data: { data: (globalThis.__APP || {})[k] || [] } }) }) }) }) })`)
  const src = fs.readFileSync(path.join(F, 'coverage-shifts/index.ts'), 'utf8')
    .replace(/from '\.\.\/_shared\/(\w[\w-]*)\.ts'/g, (_, m) => "from '" + path.join(process.cwd(), F, '_shared', m + '.ts') + "'")
    .replace(/import\('\.\.\/_shared\/(\w[\w-]*)\.ts'\)/g, (_, m) => "import('" + path.join(process.cwd(), F, '_shared', m + '.ts') + "')")
    .replaceAll("await import('https://esm.sh/@supabase/supabase-js@2')", "await import('" + path.join(tmp, 'fake-sb.mjs') + "')")
  fs.writeFileSync(path.join(tmp, 'cs.ts'), src); await import(path.join(tmp, 'cs.ts'))
  const call = async () => { const r = await handler(new Request('https://x/functions/v1/coverage-shifts', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + jwt('authenticated') }, body: JSON.stringify({ fragility: true }) })); return { status: r.status, j: await r.json() } }
  const callinRisk = (j, name) => (j.risks || []).filter((x) => x.kind === 'callin_history' && x.caregiver === name).map((x) => Number(x.detail.match(/^(\d+)/)[1]))

  /* id-less data only: exactly as before (counted by name, 2 or more flags) */
  VISITS = [V(1, 5, 'Kim', 'Aide'), V(2, 7, 'Lou', 'Old')]
  globalThis.__APP = { attendance_events: [E('Kim Aide'), E('Kim Aide'), E('Lou Old'), E('Lou Old', null, old), E('Kim Aide', null, now, 'tardy')] }
  let r = await call()
  ck('the call works', r.status === 200, r)
  ck('no ids anywhere: counted by name as before (Kim 2 flagged; Lou 1 in 30 days, not flagged; tardies and old ones ignored)',
    JSON.stringify(callinRisk(r.j, 'Kim Aide')) === '[2]' && !callinRisk(r.j, 'Lou Old').length, r.j.risks)

  /* id match: the visit caregiver's id finds the events that carry it */
  VISITS = [V(1, 5, 'Kim', 'Aide'), V(2, 6, 'Kim', 'Aide'), V(3, 7, 'Lou', 'Old'), V(4, 8, 'Pat', 'Mix')]
  globalThis.__APP = { attendance_events: [
    E('Kim Aide', '5'), E('Kim Aide', '5'), E('Lou Old', '5'),       // id 5, one of them mistyped as Lou Old
    E('Lou Old'), E('Lou Old'),                                        // Lou: name only
    E('Pat Mix', '8'), E('Pat Mix'),                                   // Pat: one with id, one old-style
  ] }
  r = await call()
  const kim = (r.j.risks || []).filter((x) => x.kind === 'callin_history' && x.caregiver === 'Kim Aide')
  ck('by id: id 5 has 3 call-ins (one typed under another name still counts for id 5)', kim.length === 1 && /^3 call-ins/.test(kim[0].detail), kim)
  ck('an id record never matches another person by name: the second Kim Aide (id 6) gets none of id 5\'s call-ins', kim.length === 1, r.j.risks)
  ck('...and Lou Old keeps only his 2 name-only call-ins, not the id-5 one typed as "Lou Old"', JSON.stringify(callinRisk(r.j, 'Lou Old')) === '[2]', r.j.risks)
  ck('during the change-over an id record and an old name-only record add up for the same person (Pat 2)', JSON.stringify(callinRisk(r.j, 'Pat Mix')) === '[2]', r.j.risks)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }

/* coverage-run: the auto-logged call-in carries the id of who called off, when the case has it */
const CR = fs.readFileSync(path.join(F, 'coverage-run/index.ts'), 'utf8')
const blk = CR.slice(CR.indexOf("id: 'att_cov_' + c.id"), CR.indexOf("id: 'att_cov_' + c.id") + 600)
ck('coverage-run · the call-in event keeps the typed name and adds axiscare_caregiver_id from calling_off_id when present',
  /caregiver: String\(c\.calling_off\)/.test(blk) && /\.\.\.\(c\.calling_off_id \? \{ axiscare_caregiver_id: String\(c\.calling_off_id\) \} : \{\}\)/.test(blk), blk)
{ const spread = (c) => ({ caregiver: String(c.calling_off), ...(c.calling_off_id ? { axiscare_caregiver_id: String(c.calling_off_id) } : {}) })
  ck('coverage-run · ...a case with no id writes the event exactly as before (no id field)', !('axiscare_caregiver_id' in spread({ calling_off: 'Ann' })) && spread({ calling_off: 'Ann', calling_off_id: 501 }).axiscare_caregiver_id === '501') }
const CW = fs.readFileSync(path.join(F, 'coverage-watch/index.ts'), 'utf8')
ck('coverage-watch · the attendance card id keeps its name-based form (open cards are found again)', /const attId = `ops_att_\$\{bucket\}_\$\{who\.toLowerCase\(\)\.replace\(\/\[\^a-z0-9\]\/g, ''\)\}/.test(CW))

let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
