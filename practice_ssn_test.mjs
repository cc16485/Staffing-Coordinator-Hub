// Practice and training hires may use the SSA's never-issued advertising numbers (987-65-4320 to 987-65-4329); real hires
// never. Samantha 2026-10-11, station 2: "it wont let me save my social security number".  node practice_ssn_test.mjs
import * as C from './supabase/functions/_shared/step1-crypto.ts'
let pass = 0, fail = 0; const ck = (n, ok, x) => { ok ? pass++ : fail++; console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok || x === undefined ? '' : '  ' + JSON.stringify(x))) }
const real = { offered_by: 'Krystal Land', last_name: 'Hill' }, pat = { offered_by: 'Slice 10 practice run', last_name: 'Practice' }
const walk = { offered_by: 'Training walkthrough', last_name: '(TRAINING)' }, named = { offered_by: 'Krystal', last_name: '(TRAINING)' }
ck('the practice run and staff walkthroughs are practice offers; a real offer is not', C.practiceOffer(pat) && C.practiceOffer(walk) && C.practiceOffer(named) && !C.practiceOffer(real) && !C.practiceOffer(null))
ck('a real hire: 987-65-4321 refused, a normal-looking number allowed', !C.ssnAllowed('987-65-4321', false) && C.ssnAllowed('529-12-3456', false))
ck('a practice hire: 987-65-4320 to 987-65-4329 allowed', ['4320', '4321', '4329'].every((x) => C.ssnAllowed('987-65-' + x, true)))
ck('a practice hire: 123-45-6789 and 987-65-4330 still refused (only the reserved ten; dashes optional)', !C.ssnAllowed('123-45-6789', true) && !C.ssnAllowed('987-65-4330', true) && C.ssnAllowed('987654321', true))
ck('the ordinary rule is unchanged', !C.ssnLooksValid('123456789') && !C.ssnLooksValid('987654321') && C.ssnLooksValid('529123456'))
console.log(`practice-ssn: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
