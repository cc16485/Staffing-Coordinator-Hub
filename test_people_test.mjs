// TEST PEOPLE (Samantha 2026-10-11): a person reachable only at the Admin page's test phones/emails gets the onboarding messages
// even with a switch off; nobody else does.  node test_people_test.mjs
import fs from 'fs'; import path from 'path'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 400)])
globalThis.Deno = { env: { get: () => '' } }
const TMP = path.join(ROOT, '.tp_under_test.ts'); fs.copyFileSync(path.join(FN, '_shared/test-people.ts'), TMP)
const T = await import(TMP); fs.rmSync(TMP)
const st = { test_people: { phones: ['(417) 593-2789'], emails: ['STroutman2011@gmail.com'] } }
ck('the list is read cleanly (ten digits, lower case)', JSON.stringify(T.testLists(st)) === JSON.stringify({ phones: ['4175932789'], emails: ['stroutman2011@gmail.com'] }))
ck('her phone and email: a test person', T.testPerson(st, { phone: '417-593-2789', email: 'stroutman2011@gmail.com' }))
ck('her phone alone, or her email alone: a test person', T.testPerson(st, { phone: '4175932789' }) && T.testPerson(st, { email: 'stroutman2011@gmail.com' }))
ck('her phone with someone else\'s email: NOT a test person (a real person could be reached)', !T.testPerson(st, { phone: '4175932789', email: 'someone@gmail.com' }))
ck('anyone else: not a test person', !T.testPerson(st, { phone: '4175551234', email: 'a@b.com' }) && !T.testPerson(st, {}))
ck('an empty list: nobody is a test person', !T.testPerson({}, { phone: '4175932789' }) && !T.testPerson({ test_people: { phones: [], emails: [] } }, { phone: '4175932789' }))
const s2 = fs.readFileSync(path.join(FN, 'step2-handoff/index.ts'), 'utf8'), cj = fs.readFileSync(path.join(FN, 'caregiver-journey/index.ts'), 'utf8'), oc = fs.readFileSync(path.join(FN, 'outreach-check/index.ts'), 'utf8')
ck('Step 2: the message, its receipt, its reminders and the automatic Orientation Video Call invitation each let a test person through', (s2.match(/testPerson\(st, (c|p\.rec)\)/g) || []).length === 5)
ck('the cleared text (and the held one in the sweep) lets a test person through', (cj.match(/testPerson\(st, \{/g) || []).length === 2)
ck('Training is told the list with the switches', /test_phones: tl\.phones, test_emails: tl\.emails/.test(oc))
ck('never AxisCare: no AxisCare gate looks at the list', !/approve_work_axiscare_live[^\n]*testPerson|axiscare_hire_date_live[^\n]*testPerson|axiscare_level_live[^\n]*testPerson/.test(cj))
for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + note))
const bad = res.filter((x) => !x[1]).length; console.log(`${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0)
