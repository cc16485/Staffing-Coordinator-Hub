// Client history import (Desktop 501): the REAL client-history-import against a fake AxisCare and a fake Hub database.
// node history_import_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)])
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_hi_'))
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
const AX = [
  { id: 1, firstName: 'Alice', lastName: 'Active', mobilePhone: '4175550001', status: { active: true, label: 'Active' }, startDate: '2026-01-01' },
  { id: 2, firstName: 'Dora', lastName: 'Gone', mobilePhone: '4175550002', personalEmail: 'dora@x.com', status: { active: false, label: 'Deceased' }, startDate: '2024-03-01' },
  { id: 3, firstName: 'Ivan', lastName: 'Past', status: { active: false, label: 'Inactive' }, startDate: '2023-05-01', effectiveEndDate: '2024-02-10' },
  { id: 4, firstName: 'Nora', lastName: 'Nodate', status: { active: false, label: 'Inactive' } },                                  // never had a start date
  { id: 5, firstName: 'Edward', lastName: 'Anderson', status: { active: false, label: 'Inactive' }, startDate: '2025-01-01' },        // already in the Hub (linked)
  { id: 6, firstName: 'Ruth', lastName: 'SameName', status: { active: false, label: 'Discharged' }, startDate: '2022-01-01' },       // a Hub person has this name
  { id: 7, firstName: 'Lee', lastName: 'Lead', status: { active: false, label: 'Lead' } },                                           // not a client
  { id: 8, firstName: 'Hope', lastName: 'Hold', status: { active: false, label: 'On Hold' }, startDate: '2025-06-01' },              // on hold, not in the Hub
  { id: 9, firstName: 'Fay', lastName: 'Future', status: { active: false, label: 'Inactive' }, startDate: '2025-01-01', effectiveEndDate: '2099-01-01' },  // a future "end"
  { id: 10, firstName: 'Bo', lastName: 'Twin', status: { active: false, label: 'Inactive' }, startDate: '2021-01-01' },
  { id: 11, firstName: 'Bo', lastName: 'Twin', status: { active: false, label: 'Inactive' }, startDate: '2022-01-01' },
  { id: 12, firstName: 'Test', lastName: 'Client 9', status: { active: false, label: 'Inactive' }, startDate: '2025-01-01' },        // a test record WITH a start date
  { id: 13, firstName: 'Olga', lastName: 'Away', status: { active: false, label: 'Out of Service Area' }, startDate: '2024-01-01' },  // AxisCare's own reason
  { id: 14, firstName: 'Zed', lastName: 'Deep', status: { active: false, label: 'Inactive' }, startDate: '2024-01-01' },             // same name as Hub person #1500
]
let T, FAIL_ROLE = '', AX_DOWN = false
const MANY = Array.from({ length: 1600 }, (_, i) => ({ id: 'p-m' + i, display_name: i === 1500 ? 'Zed Deep' : 'Someone ' + i }))
const fresh = () => { T = {
  person_identity: [{ id: 'p-ed', display_name: 'Edward Anderson' }, { id: 'p-ruth', display_name: 'Ruth SameName' }, ...MANY],
  person_source_id: [{ person_id: 'p-ed', system: 'axiscare', entity_type: 'client', source_id: '5' }],
  person_role: [{ person_id: 'p-ed', role: 'client', status: 'active' }, { person_id: 'p-old', role: 'client', status: 'former', started_at: '2024-01-01', ended_at: '2024-01-01' }] }; FAIL_ROLE = ''; AX_DOWN = false }
let n = 0
const db = { from: (t) => { const q = { f: [], t }
  q.select = () => q; q.eq = (k, v) => { q.f.push([k, v]); return q }; q.single = () => q; q.maybeSingle = () => q
  q.order = () => q; q.range = (a, b) => { q.rg = [a, b]; return q }
  const rows = () => { const all = (T[t] || []).filter((r) => q.f.every(([k, v]) => String(r[k]) === String(v))); return q.rg ? all.slice(q.rg[0], q.rg[1] + 1) : all.slice(0, 1000) }
  q.then = (ok) => ok(q.ins ? q.ins : q.del ? { error: null } : { data: rows(), error: null })
  q.insert = (row) => { if (t === 'person_role' && FAIL_ROLE && row.person_id && T.person_identity.find((p) => p.id === row.person_id)?.display_name === FAIL_ROLE) { q.ins = { data: null, error: { message: 'role refused' } }; return q }
    const r = { ...row }; if (t === 'person_identity') r.id = 'new-' + (++n); T[t].push(r); q.ins = { data: r, error: null }; return q }
  q.delete = () => { q.del = true; const qq = { eq: (k, v) => { T[t] = T[t].filter((r) => String(r[k]) !== String(v)); return Promise.resolve({ error: null }) } }; return qq }
  return q } }
const stub = (n_, b) => { const p = path.join(tmp, n_ + '.ts'); fs.writeFileSync(p, b); return p }
let handler; globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'svc', AXISCARE_TOKEN: 'tok', AXISCARE_SITE: '16485' })[k] }, serve: (h) => { handler = h } }
globalThis.__db = db
globalThis.fetch = async (url) => AX_DOWN ? new Response('no', { status: 503 }) : new Response(JSON.stringify({ results: { clients: AX, nextPage: null } }), { status: 200 })
try {
  const ja = stub('job-auth', "export async function ownerCaller(req){ return req.headers.get('Authorization') === 'Bearer svc' }")
  let src = fs.readFileSync(path.join(F, 'client-history-import/index.ts'), 'utf8')
    .replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace("'../_shared/job-auth.ts'", JSON.stringify(ja)).replace("'../_shared/audience-guard.ts'", JSON.stringify(path.resolve(F, '_shared/audience-guard.ts')))
  const M = await import(stub('hi', src))
  const call = async (q = '', auth = 'Bearer svc') => { const r = await handler(new Request('http://x/client-history-import' + q, { headers: { Authorization: auth } })); return { s: r.status, j: await r.json() } }

  fresh(); let r = await call('', 'Bearer anon')
  ck('only the owner\'s Desktop script (server key) can call it', r.s === 401 && T.person_identity.length === 1602)
  fresh(); r = await call()
  ck('look: counts every AxisCare client and writes nothing', r.s === 200 && r.j.mode === 'look' && r.j.axiscare_total === 14 && T.person_identity.length === 1602 && T.person_role.length === 2, r.j)
  ck('...to import: Dora (deceased), Ivan, Fay, Olga and the two Bo Twins (past) = 6', r.j.to_import === 6 && r.j.to_import_deceased === 1 && r.j.to_import_past === 5, r.j)
  ck('...every Hub person is read, page by page (1,602), so a name at #1,500 is still caught (Zed Deep left out)', r.j.hub_people_read === 1602 && r.j.not_imported.same_name_as_someone_in_hub.some((x) => x.name === 'Zed Deep'), r.j.not_imported)
  ck('...a test record is never imported, even with a start date (listed)', r.j.not_imported.test_records.map((x) => x.name).join() === 'Test Client 9', r.j.not_imported.test_records)
  ck('...the report carries every name that would come in', r.j.import_list.length === 6 && r.j.import_list.some((x) => x.name === 'Ivan Past' && x.ended_at === '2024-02-10'), r.j.import_list)
  ck('...how many AxisCare clients the Hub already holds is counted (Edward)', r.j.axiscare_clients_linked_in_hub === 1, r.j)
  ck('...left out and listed: no start date (Nora), same name as a Hub person (Ruth), on hold in AxisCare (Hope)', r.j.not_imported.no_start_date.map((x) => x.name).join() === 'Nora Nodate'
     && r.j.not_imported.same_name_as_someone_in_hub[0].hub_name === 'Ruth SameName' && r.j.not_imported.on_hold_in_axiscare[0].name === 'Hope Hold', r.j.not_imported)
  ck('...already in the Hub (Edward) and the active client (Alice) are not touched; the lead is not a client', r.j.already_in_hub === 1 && r.j.active === 1 && r.j.not_clients === 1, r.j)
  ck('...AxisCare end dates: 1 exact (Ivan); a future "end" (Fay) and no date are on or before', r.j.with_axiscare_end_date === 1 && r.j.on_or_before === 5, r.j)
  ck('...two AxisCare clients with the same name are flagged (not merged)', r.j.twins_in_axiscare.length === 2, r.j.twins_in_axiscare)
  ck('...the older backfill\'s same-day end dates are counted, not changed', r.j.older_backfill_same_day_end === 1 && T.person_role.find((x) => x.person_id === 'p-old').ended_at === '2024-01-01')

  r = await call('?commit=1')
  const by = (ax) => { const s = T.person_source_id.find((x) => x.source_id === ax); if (!s) return null; return { s, p: T.person_identity.find((x) => x.id === s.person_id), r: T.person_role.find((x) => x.person_id === s.person_id) } }
  ck('import: 6 people added, each a person + their AxisCare number + an ended client role', r.j.imported === 6 && !r.j.errors.length && ['2', '3', '9', '10', '11', '13'].every((a) => by(a) && by(a).r.status === 'former'), r.j)
  ck('...Ivan: AxisCare\'s end date, exact', by('3').r.ended_at === '2024-02-10' && by('3').r.ended_date_basis === 'exact' && by('3').r.started_at === '2023-05-01', by('3'))
  ck('...Dora: deceased, ended on or before today, NO phone or email copied, no sympathy card', by('2').r.end_reason === 'deceased' && by('2').r.ended_at === TODAY && by('2').r.ended_date_basis === 'on_or_before'
     && !by('2').p.primary_phone && !by('2').p.primary_email && !T.ops_items, by('2'))
  ck('...Fay: a future "end date" is not trusted; on or before today', by('9').r.ended_at === TODAY && by('9').r.ended_date_basis === 'on_or_before', by('9'))
  ck('...no reason is invented for past clients; AxisCare\'s own "Out of Service Area" is kept', by('3').r.end_reason === null && by('10').r.end_reason === null && by('13').r.end_reason === 'Out of our service area (AxisCare status)', by('13'))
  ck('...Nora, Ruth, Hope, Alice, the lead and Edward: nothing added or changed', ['4', '6', '8', '1', '7', '12', '14'].every((a) => !by(a)) && T.person_role.find((x) => x.person_id === 'p-ed').status === 'active' && T.person_identity.length === 1608)
  ck('...the source says where it came from', /historical import \(Desktop 501/.test(by('3').s.evidence) && by('3').s.confidence === 'confirmed')
  r = await call('?commit=1')
  ck('run again: nothing doubled', r.j.imported === 0 && r.j.to_import === 0 && T.person_identity.length === 1608, r.j)

  fresh(); FAIL_ROLE = 'Ivan Past'; r = await call('?commit=1')
  ck('a person whose role is refused is taken back whole (no half-added person), and it says so', r.j.imported === 5 && !by('3') && !T.person_identity.some((p) => p.display_name === 'Ivan Past') && /Ivan Past: role refused/.test(r.j.errors.join()), r.j)
  fresh(); AX_DOWN = true; r = await call('?commit=1')
  ck('AxisCare can\'t be read: nothing is imported, and it says so', r.s === 502 && /nothing was imported/.test(r.j.error) && T.person_identity.length === 1602, r.j)
  const pl = M.plan([{ id: 20, firstName: 'Ann', lastName: 'Early', status: { active: false, label: 'Inactive' }, startDate: '2025-05-01', effectiveEndDate: '2025-04-01' }], [], [], TODAY)
  ck('an AxisCare end date before the start date is not trusted (on or before)', pl.import[0].ended_date_basis === 'on_or_before', pl.import)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
let pass = 0; for (const [n_, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n_ + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
