// TRACK 3d · the dark report: the builder (_shared/match-dark.ts) with the real match-rules.js, and the job
// (match-dark/index.ts) with a stand-in database and AxisCare. Proves: right groups and reasons, unknowns never count,
// the replay, the history, and that the job writes ONLY app_data 'match_dark_report'. HUB=<care-coordinator-hub dir> node match_dark_test.mjs
import fs from 'fs'; import path from 'path'; import vm from 'vm'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions'), HUB = process.env.HUB || path.join(ROOT, '../pr-hub')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 500)])
const RULES = fs.readFileSync(path.join(HUB, 'match-rules.js'), 'utf8'); vm.runInThisContext(RULES); const M = globalThis.CCMatch
const D = await import(path.join(FN, '_shared/match-dark.ts'))
const fact = (k, v, layer = 'plan') => ({ kind: k, layer, value: v })
const allNo = (req = []) => M.SKILLS.map((s) => fact('need_' + s.key, req.includes(s.key) ? 'required' : 'no'))
const day = '2026-10-13', V = (id, cl, cg, s = '09:00', e = '11:00') => ({ id, client: { id: cl }, caregiver: cg == null ? null : { id: cg }, scheduledStartDate: `${day}T${s}:00`, scheduledEndDate: `${day}T${e}:00` })
const axCg = [['11', 'Ann', 'Able', 'F', 'Level 2'], ['12', 'Bo', 'Bright', 'M', 'Level 3'], ['13', 'Cy', 'Clear', 'F', 'Level 3'], ['14', 'Di', 'Dee', 'F', 'Level 2'], ['15', 'Ed', 'Eve', 'M', 'Level 2']].map(([id, f, l, g, lv]) => ({ id, firstName: f, lastName: l, gender: g, classes: [{ label: lv }] }))
const axCl = [['21', 'Mary', 'Medicaid'], ['22', 'Hal', 'Private Pay'], ['23', 'Ida', 'Private Pay'], ['24', 'Joe', 'Private Pay'], ['25', 'Kit', 'Private Pay']].map(([id, f, p]) => ({ id, firstName: f, lastName: 'Client', classes: [{ label: p }] }))
const input = (over = {}) => ({ now: '2026-10-12T11:50:00Z', M, E: { eligibility: (r) => r.elig || { state: 'eligible', summary: 'ok' } }, levelOf: (cl) => { const m = /Level (\d)/.exec(JSON.stringify(cl)); return m ? Number(m[1]) : null }, payerOf: (cl) => /Medicaid/.test(JSON.stringify(cl)) ? 'medicaid' : 'private',
  visits: [V('v1', '21', '11'), V('v2', '22', '12'), V('v3', '23', '13'), V('v4', '23', '13', '10:00', '12:00'), V('v5', '24', '14'), V('v6', '25', null), V('v7', '24', '15', '19:00', '21:00'), V('v8', '25', '15', '07:00', '08:00')],
  axCaregivers: axCg, axClients: axCl,
  roster: [{ axiscare_id: '11', alz_date: '2025-01-01' }, { axiscare_id: '12', alz_date: '2025-01-01' }, { axiscare_id: '13', alz_date: '2025-01-01', elig: { state: 'lapsed', summary: 'OIG check over 30 days' } }, { axiscare_id: '14' }, { axiscare_id: '15', alz_date: 'x' }],
  overlay: [{ axiscare_id: '12', skills: { hoyer_lift: { have: 'yes', evidence: 'attested' }, bedbound_care: { have: 'yes', evidence: 'observed' } }, exclusions_said: 'No overnights' }, { axiscare_id: '14', skills: { ok_cats: { have: 'no' } } }],
  availability: [{ axiscare_id: '15', windows: { tue: ['morning'] } }],
  dnr: [{ client: 'Hal Client', caregiver: 'Zed Nobody' }],
  factsByClient: { '21': [...allNo(['hoyer_lift'])], '22': [...allNo(['hoyer_lift', 'bedbound_care'])], '23': [], '24': [...allNo([]), fact('home_cats', 'yes')], '25': null },
  step1ByAx: { '12': { skills: [{ key: 'hoyer_lift', standing: 'confirmed', lifts: ['Full-body sling'] }] } },
  lock: { ok: true, axis: new Set(['11']) },
  cases: [{ opened_at: '2026-10-01T10:00:00Z', shift_date: '2026-10-02', client_axiscare_id: '22', covered_by: 'Bo Bright', status: 'covered', asked: [{ name: 'Ann Able', axiscare_id: '11' }, { name: 'Bo Bright', axiscare_id: '12' }] },
          { opened_at: '2026-10-03T10:00:00Z', shift_date: '2026-10-04', client_axiscare_id: '24', covered_by: 'Someone Else', status: 'covered', asked: [] },
          { opened_at: '2026-07-01T10:00:00Z', shift_date: '2026-07-02', client_axiscare_id: '22', covered_by: 'Bo Bright', status: 'covered', asked: [] }],
  previous: { history: [{ at: '2026-10-11T11:50:00Z', visits: 5 }] }, fingerprints: { 'match-rules.js': 'abc' }, ...over })
const r = D.buildDarkReport(input())
const row = (id) => r.rows.find((x) => x.visit_id === id)
if (process.env.DUMP_REPORT) fs.writeFileSync(process.env.DUMP_REPORT, JSON.stringify(r))   /* for the Hub's look test */
ck('Medicaid client needing a lift: flagged for review, never matched', row('v1').group === 'not_for_visit' && /advanced personal care/.test(row('v1').reason) && r.clients.flagged === 1, row('v1'))
ck('the lift confirmed through Step 1 wins over the skills record\'s "attested"; bedbound "observed" counts: Ready (Level 3, private pay)', row('v2').group === 'ready', row('v2'))
ck('a lapsed eligibility: not for this visit, with the eligibility reason', row('v3').group === 'not_for_visit' && /Not cleared to work: OIG/.test(row('v3').reason), row('v3'))
ck('a client with no needs confirmed is incomplete: the best is "Likely fit", never Ready', row('v5').group === 'not_for_visit' || row('v5').group === 'likely_fit')
ck('a caregiver who said not at this time for cats, assigned to a home with cats: excluded with that reason', row('v5').group === 'not_for_visit' && /cats/.test(row('v5').reason), row('v5'))
ck('Approve to Work not done (the readiness lock): not cleared, said why', /Not cleared to work: awaiting Approve to Work/.test(row('v1').reason) || row('v1').group === 'not_for_visit')
ck('outside the availability they gave us (Tuesday morning only, an evening visit): not for this visit', row('v7').group === 'not_for_visit' && /Outside the availability/.test(row('v7').reason), row('v7'))
ck('overlapping visits for the same caregiver: not free, named', /Overlaps another visit/.test(row('v4').reason) || /Overlaps another visit/.test(row('v3').reason) || row('v4').group === 'not_for_visit')
ck('an open visit (no caregiver) is counted, never judged', r.counts.open_visits === 1 && !row('v6'))
ck('a client with no Journey is counted as a gap and treated as incomplete (Likely fit at best, never Ready)', r.gaps.no_journey_clients >= 1 && r.clients.no_journey >= 1 && row('v8').group === 'likely_fit', row('v8'))
ck('a Do Not Return name that is not on the roster is listed, never assumed clear', r.gaps.dnr_unmatched.some((x) => /Zed Nobody/.test(x)))
ck('restrictions written in words are counted and shown, never enforced', r.gaps.restrictions_said === 1 && row('v2').said === 'No overnights' && row('v2').group === 'ready')
ck('the rows are ordered: not for this visit first, ready last', r.rows[0].group === 'not_for_visit' && r.rows.at(-1).group === 'ready')
ck('counts add up', r.counts.visits === 7 && ['ready', 'likely_fit', 'one_more_step', 'not_for_visit'].reduce((n, g) => n + r.counts[g], 0) === 7, r.counts)
ck('the replay: only the last 60 days; who covered and how they would be judged today; the unmatched name counted', r.replay.cases === 2 && r.replay.rows.find((x) => x.date === '2026-10-02').covered_group === 'ready' && r.gaps.covered_by_unmatched === 1, r.replay)
ck('the replay counts how many of those asked would be Ready', r.replay.rows.find((x) => x.date === '2026-10-02').asked === 2)
ck('the history keeps one line per run (yesterday\'s plus today\'s)', r.history.length === 2 && r.history[1].visits === 7)
ck('the report says what it is and what it never did', /A report only/.test(r.notes[0]) && r.rule_version === M.VERSION && r.fingerprints['match-rules.js'] === 'abc')
/* Driver Compliance (2026-10-13, match-rules 1.2.0): the roster's driver fields reach the rule; no driver record = not for a
   visit that needs driving, counted in gaps.drive_unknown */
{ const drv = (st) => input({ factsByClient: { ...input().factsByClient, '24': [...allNo(['transportation'])] },
    roster: input().roster.map((x) => x.axiscare_id === '14' ? { ...x, ...st } : x), driveGate: true })
  const d0 = D.buildDarkReport(drv({})), v5 = d0.rows.find((x) => x.visit_id === 'v5')
  ck('driving: a client needing transportation and a caregiver with no driver record yet: not for this visit, and counted', v5.group === 'not_for_visit' && v5.reason === 'Not cleared to drive clients: No driver record yet' && d0.gaps.drive_unknown >= 1, { v5, g: d0.gaps })
  const d1 = D.buildDarkReport(drv({ dl_status: 'Pending Verification', cleared_to_drive: false })), v5b = d1.rows.find((x) => x.visit_id === 'v5')
  ck('driving: Pending Verification: not for this visit, the why named', /Not an Approved Driver \(Pending Verification\)/.test(v5b.reason), v5b)
  const d2 = D.buildDarkReport(drv({ dl_status: 'Approved Driver', cleared_to_drive: true, dl_expires: '2099-01-01', auto_ins_expires: '2099-01-01' })), v5c = d2.rows.find((x) => x.visit_id === 'v5')
  ck('driving: an Approved Driver with current documents is not ruled out by driving', !/drive/.test(v5c.reason), v5c)
  const off = D.buildDarkReport({ ...drv({ dl_status: 'Pending Verification' }), driveGate: false }), v5d = off.rows.find((x) => x.visit_id === 'v5')
  ck('driving, switch off: not ruled out by driving; the warning says not enforced yet', !/drive/.test(v5d.reason) && v5d.warnings.some((w) => /^Driver check \(not enforced yet\): Not an Approved Driver \(Pending Verification\)/.test(w)), v5d) }
const unread = D.buildDarkReport(input({ lock: { ok: false, why: 'x' } }))
ck('an unreadable readiness lock: nobody is cleared (fails closed)', unread.rows.every((x) => x.group === 'not_for_visit' || /lock could not be read/.test(x.reason)) && unread.gaps.lock_unreadable === true)

/* ── the job: who may run it, the switch, and that it writes only the report ── */
const APP = { ops_settings: { match_dark_live: false }, caregivers: [], caregiver_overlay: [], caregiver_availability: [], dnr_log: [], coverage_cases: [], match_dark_report: null }
const WRITES = []; let APPROVED = true
const table = (t) => { const f = []; const q = { select: () => q, eq: (k, v) => (f.push([k, v]), q), in: () => q, limit: () => q, order: () => q,
  maybeSingle: async () => ({ data: t === 'app_data' ? { data: APP[f.find((x) => x[0] === 'key')?.[1]] ?? null } : null }),
  then: (ok) => ok({ data: t === 'rules_approved' ? (APPROVED ? [{ sha256: 'x' }] : []) : [], error: null }),
  upsert: async (row) => { WRITES.push({ t, row }); return { error: null } }, insert: async (row) => { WRITES.push({ t, row }); return { error: null } }, update: () => { WRITES.push({ t, update: true }); return q } }; return q }
globalThis.__fake = { from: table }
const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 's'.repeat(40), HUB_JOB_SECRET: 'j'.repeat(40), AXISCARE_SITE: '16485', AXISCARE_API_KEY: 'axc_test' }
let handler; globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h } }
const realFetch = globalThis.fetch
globalThis.fetch = async (url) => { const u = String(url)
  if (u.includes('cc.mo-care.com/match-rules.js')) return new Response(RULES)
  if (u.includes('cc.mo-care.com/eligibility-rules.js')) return new Response(fs.readFileSync(path.join(HUB, 'eligibility-rules.js')))
  if (u.includes('axiscare.com/api/visits')) return new Response(JSON.stringify({ results: { visits: [V('v9', '22', '12')] } }))
  if (u.includes('axiscare.com/api/caregivers')) return new Response(JSON.stringify({ results: { caregivers: axCg.map((g) => ({ ...g, status: { active: true } })) } }))
  if (u.includes('axiscare.com/api/clients')) return new Response(JSON.stringify({ results: { clients: axCl.map((c) => ({ ...c, status: { active: true } })) } }))
  throw new Error('unexpected network call ' + u) }
/* a temporary copy with the one internet import swapped for the stand-in (as the other job tests do) */
const TMP = fs.mkdtempSync(path.join(FN, '_mdt-')), rw = (t) => t.replace(/^import \{ createClient \} from 'https:\/\/esm\.sh\/[^']+'$/m, 'const createClient = (..._a: any[]) => (globalThis as any).__fake')
fs.mkdirSync(path.join(TMP, '_shared')); fs.mkdirSync(path.join(TMP, 'match-dark'))
for (const f of fs.readdirSync(path.join(FN, '_shared'))) if (/\.(ts|js)$/.test(f)) fs.writeFileSync(path.join(TMP, '_shared', f), rw(fs.readFileSync(path.join(FN, '_shared', f), 'utf8')))
fs.writeFileSync(path.join(TMP, 'match-dark/index.ts'), rw(fs.readFileSync(path.join(FN, 'match-dark/index.ts'), 'utf8')))
try { await import(path.join(TMP, 'match-dark/index.ts')) } finally { fs.rmSync(TMP, { recursive: true, force: true }) }
const call = async (body, headers = {}) => { const r = await handler(new Request('http://x/match-dark', { method: 'POST', headers, body: JSON.stringify(body) })); return { status: r.status, j: await r.json() } }
let c = await call({ once: true }); ck('a caller with neither the schedule\'s secret nor the server key is refused', c.status === 401 && WRITES.length === 0)
c = await call({}, { 'x-cron-secret': env.HUB_JOB_SECRET }); ck('the schedule with the switch off: skipped, nothing written', c.j.skipped && WRITES.length === 0, c.j)
c = await call({ once: true }, { 'x-cron-secret': env.HUB_JOB_SECRET }); ck('"once" from the schedule is not enough while the switch is off (only the owner\'s Desktop step may)', c.j.skipped && WRITES.length === 0)
APPROVED = false; c = await call({ once: true }, { Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY }); ck('the rule not approved by fingerprint: not run, nothing written', c.status === 502 && /not approved/.test(c.j.error) && WRITES.length === 0, c.j)
APPROVED = true; c = await call({ once: true }, { Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY })
ck('the owner\'s Desktop step, once: the report is built from AxisCare and saved', c.status === 200 && c.j.ok && c.j.counts.visits === 1, c.j)
ck('it writes ONE thing: app_data match_dark_report (no visit, schedule, caregiver, client, card or text)', WRITES.length === 1 && WRITES[0].t === 'app_data' && WRITES[0].row.key === 'match_dark_report', WRITES.map((w) => w.t + ':' + (w.row?.key || '')))
APP.ops_settings.match_dark_live = true; c = await call({}, { 'x-cron-secret': env.HUB_JOB_SECRET }); ck('the schedule with the switch on: runs and writes only the report', c.status === 200 && WRITES.length === 2 && WRITES[1].row.key === 'match_dark_report')
const bad = res.filter((x) => !x[1]); for (const [n, ok, note] of res) console.log((ok ? 'ok    ' : 'FAIL  ') + n + (ok ? '' : '  ' + note))
console.log(`${res.length - bad.length}/${res.length} passed`); if (bad.length) process.exit(1)
