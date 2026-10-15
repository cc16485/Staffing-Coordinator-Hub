// node journey_incare_look_test.mjs : the read-only list of clients receiving care whose journey still sits at intake
import { createRequire } from 'module'
import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
const require = createRequire(import.meta.url)
const { plan, careState } = require('./journey_incare_look.js')
let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ ' + m) } }

const defs = [
  { key: 'intake.payer', def: { title: 'Who pays', stage: 'intake', sort: 10 } },
  { key: 'assess.book', def: { title: 'Book the in-home assessment', stage: 'assessment', sort: 30 } },
  { key: 'team.match', def: { title: 'Match a caregiver', stage: 'team', sort: 80 } },
]
const J = (id, o) => ({ journey_id: id + '-0000-0000-0000-000000000000', subject: 'client', status: 'open', assigned_cc: 'krystal@mo-care.com', created_at: '2026-10-07T12:00:00Z', ...o })
const d = {
  defs,
  journeys: [
    J('aaaaaaaa', { client_name: 'Dan Probstfield', axiscare_client_id: '297', payer: 'private' }),          // active, intake: HIT
    J('bbbbbbbb', { client_name: 'Paused Pat', lead_id: 'L9' }),                                                // paused via the lead's number, intake: HIT
    J('cccccccc', { client_name: 'New Nell', axiscare_client_id: '400' }),                                       // starting (no active role): not listed
    J('dddddddd', { client_name: 'Team Tom', axiscare_client_id: '500' }),                                       // active, past assessment: section B
    J('eeeeeeee', { client_name: 'Test Tess', axiscare_client_id: '297', is_test: true }),                       // test: never
    J('ffffffff', { client_name: 'Gone Gus', axiscare_client_id: '600' }),                                       // care ended: not listed
    J('99999999', { client_name: 'No Number', lead_id: 'L8' }),                                                  // no AxisCare number: not listed
  ],
  steps: [
    { journey_id: 'aaaaaaaa-0000-0000-0000-000000000000', step_key: 'intake.payer', state: 'complete' },
    { journey_id: 'dddddddd-0000-0000-0000-000000000000', step_key: 'intake.payer', state: 'complete' },
    { journey_id: 'dddddddd-0000-0000-0000-000000000000', step_key: 'assess.book', state: 'not_needed' },
  ],
  leads: [{ id: 'L9', axiscare_client_id: '701' }, { id: 'L8' }],
  links: [{ person_id: 'p297', source_id: '297' }, { person_id: 'p400', source_id: '400' }, { person_id: 'p500', source_id: '500' }, { person_id: 'p600', source_id: '600' }],
  roles: [{ person_id: 'p297', role: 'client', status: 'active' }, { person_id: 'p500', role: 'client', status: 'active' }, { person_id: 'p600', role: 'client', status: 'former' }],
  pauses: [{ axiscare_client_id: '701' }],
  ops_items: [
    { id: 'ops_jr_aaaaaaaa0000_krystal@mo-care.com', journey_id: 'aaaaaaaa-0000-0000-0000-000000000000', status: 'open', owner: 'krystal@mo-care.com', title: 'Book the in-home assessment', due: '2026-10-10T22:00:00Z' },
    { id: 'ops_jr_aaaaaaaa0000_old', journey_id: 'aaaaaaaa-0000-0000-0000-000000000000', status: 'done', owner: 'x' },
  ],
  owners: ['samantha@mo-care.com'],
}
const p = plan(d, '2026-10-15')
ok(p.hits.map(h => h.name).join(',') === 'Dan Probstfield,Paused Pat', 'hits are Dan and Pat: ' + p.hits.map(h => h.name))
const dan = p.hits.find(h => h.name === 'Dan Probstfield')
ok(dan && dan.stage === 'assessment' && dan.next === 'Book the in-home assessment', 'Dan sits at the assessment, next step is the booking')
ok(dan && dan.care === 'active' && dan.how === 'journey', 'Dan is active by his own journey number')
ok(dan && dan.cards.length === 1 && dan.cards[0].late, 'Dan has one open card, and it is late')
const pat = p.hits.find(h => h.name === 'Paused Pat')
ok(pat && pat.care === 'paused' && pat.how === 'lead' && pat.ax === '701' && pat.stage === 'intake', 'Pat is paused, matched by the lead number, at intake')
ok(p.later.map(h => h.name).join(',') === 'Team Tom', 'Tom is past the assessment and listed only for comparison')
ok(careState([{ role: 'client', status: 'former', end_reason: 'deceased' }], null, []) === 'deceased', 'careState matches care.ts for deceased')
ok(careState([], null, [{ status: 'open' }]) === 'starting', 'careState: no role, open journey = starting')

// the whole report end to end, answered by stand-in data
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'incare-'))
const fake = { journeys: d.journeys.map(j => ({ j })), steps: d.steps.map(s => ({ s })), defs, leads: [{ data: d.leads }], links: d.links, roles: d.roles,
  pauses: d.pauses, ops_items: [{ data: d.ops_items }], owners: [{ email: 'samantha@mo-care.com', role: 'owner_admin' }], settings: [{ staffing: null }] }
fs.writeFileSync(path.join(tmp, 'fake.json'), JSON.stringify(fake))
const rep = path.join(tmp, 'report.txt')
execFileSync('node', [path.join(path.dirname(new URL(import.meta.url).pathname), 'journey_incare_look.js')], { env: { ...process.env, SB_FAKE: path.join(tmp, 'fake.json'), SB_REPORT: rep }, stdio: 'pipe' })
const txt = fs.readFileSync(rep, 'utf8')
ok(/INTAKE \/ PRE-CHECKS \/ ASSESSMENT: 2/.test(txt), 'report counts 2')
ok(/Dan Probstfield · AxisCare #297 \(active\)/.test(txt) && /LATE \(due 2026-10-10\)/.test(txt), 'report names Dan and his late card')
ok(/Nothing was changed\. Every part was read\./.test(txt), 'report says nothing changed')
ok(!/Test Tess|New Nell|Gone Gus|No Number/.test(txt), 'test, starting, ended and unnumbered journeys are not listed')
// a missing table stops the report instead of giving a short list
delete fake.roles; fs.writeFileSync(path.join(tmp, 'fake.json'), JSON.stringify(fake))
let code = 0; try { execFileSync('node', [path.join(path.dirname(new URL(import.meta.url).pathname), 'journey_incare_look.js')], { env: { ...process.env, SB_FAKE: path.join(tmp, 'fake.json'), SB_REPORT: rep }, stdio: 'pipe' }) } catch (e) { code = e.status }
ok(code === 3 && /Stopped/.test(fs.readFileSync(rep, 'utf8')), 'a table that cannot be read stops the report (exit 3)')
// the script only ever sends select statements
const src = fs.readFileSync(new URL('./journey_incare_look.js', import.meta.url), 'utf8')
const qs = [...src.matchAll(/rows\('[a-z_]+', "([^"]+)"\)|rows\('[a-z_]+', '([^']+)'\)/g)].map(m => m[1] || m[2])
ok(qs.length === 10 && qs.every(q => /^\s*select\b/i.test(q) && !/\b(insert|update|delete|drop|alter|grant|truncate)\b/i.test(q)), 'all 10 queries are plain selects')
fs.rmSync(tmp, { recursive: true, force: true })
console.log(`${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
