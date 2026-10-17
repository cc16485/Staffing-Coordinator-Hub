// person-match (her rule 2026-10-17: "match Family Circle people by email first, then name"). node person_match_test.mjs
import path from 'path'; import { pathToFileURL } from 'url'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 300)])
const { findPerson } = await import(pathToFileURL(path.resolve('supabase/functions/_shared/person-match.ts')).href)
const L = [{ id: 1, name: 'Robert Smith', email: 'bob@x.test' }, { id: 2, name: 'Ann Lee', email: 'home@x.test' }, { id: 3, name: 'Tom Lee', email: 'HOME@x.test' }, { id: 4, name: 'Sue Day', email: null }]
ck('the same email finds them even under another name (Bob vs Robert), any capitals and spaces', findPerson(L, { name: 'Bob Smith', email: ' BOB@X.test ' })?.id === 1)
ck('a shared email (a couple): the one whose name also matches', findPerson(L, { name: 'Tom Lee', email: 'home@x.test' })?.id === 3)
ck('a shared email and no name match: nobody by email, then by name (none here)', findPerson(L, { name: 'Pat Lee', email: 'home@x.test' }) === null)
ck('no email: by name as before (letters only, any capitals)', findPerson(L, { name: 'sue  DAY', email: '' })?.id === 4)
ck('a different email but the same name: still the same person by name', findPerson(L, { name: 'Ann Lee', email: 'new@x.test' })?.id === 2)
ck('nothing to go on: nobody', findPerson(L, { name: '', email: '' }) === null)
const AC = await import(pathToFileURL(path.resolve('supabase/functions/_shared/agreement-contacts.ts')).href)
const plan = AC.planContacts([{ n: 1, name: 'Bob Smith', email: 'bob@x.test' }], [{ list_number: 2, name: 'Robert Smith', email: 'BOB@x.test' }], [{ id: 'm9', name: 'Robert Smith', email: 'bob@x.test' }], 'agr1')
ck('the agreement: a signed contact under a shorter name updates the same AxisCare slot and Family Circle member (by email)', plan[1].axiscare.action === 'update' && plan[1].axiscare.slot === 2 && plan[1].hub.member_id === 'm9', plan)
for (const [n, ok, note] of res) console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note))
console.log(`\n  person match: ${res.filter((r) => r[1]).length}/${res.length} passed`); process.exit(res.every((r) => r[1]) ? 0 : 1)
