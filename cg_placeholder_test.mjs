// AxisCare's "Canceled Shift" placeholder is not a person (her ask 2026-10-18). node cg_placeholder_test.mjs
import path from 'path'
const FN = path.join(path.dirname(new URL(import.meta.url).pathname), 'supabase/functions')
const { isPlaceholderCaregiver: P } = await import(path.join(FN, '_shared/cg-placeholder.ts'))
const res = []; const ck = (n, c) => res.push([n, !!c])
ck('"Canceled Shift" (first + last) is the placeholder', P('Canceled', 'Shift'))
ck('one full name, any case, extra spaces, either spelling', P('canceled  shift') && P('CANCELLED SHIFT') && P(' Cancelled Shifts '))
ck('a visit that carries only the first name "Canceled"', P('Canceled'))
ck('real people are not', !P('Angiel', 'Falig') && !P('Shift', 'Canceled') && !P('Canceled Shift', 'Jones') && !P('') && !P(null))
let pass = 0; for (const [n, ok] of res) { console.log((ok ? 'PASS ' : 'FAIL ') + n); if (ok) pass++ }
console.log(`\n  placeholder: ${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
