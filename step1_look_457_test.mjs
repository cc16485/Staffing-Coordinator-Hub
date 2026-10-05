// 457 · step1-look's safety helpers: labels kept, anything that looks like an answer dropped. node step1_look_457_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 500)])
globalThis.Deno = { env: { get: () => '' }, serve: () => {} }
const src = fs.readFileSync('supabase/functions/step1-look/index.ts', 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => ({})').replace(/^import \{ ownerCaller \} from .*$/m, 'const ownerCaller = async () => false')
const tmp = path.join(process.cwd(), 'supabase/functions/step1-look/_t.ts'); fs.writeFileSync(tmp, src)
let M; try { M = await import(tmp) } finally { fs.unlinkSync(tmp) }
ck('a plain label is kept', M.safeLabel('Years of caregiving experience') === 'Years of caregiving experience')
ck('anything that looks like an answer is dropped: email, long number, date, link', [M.safeLabel('jane@x.com'), M.safeLabel('SSN 123-45-6789'), M.safeLabel('Signed 10/02/2026'), M.safeLabel('https://x')].every((x) => x === null))
const c = M.cleanLook('Sure: {"pages": 9, "sections": [{"title": "Personal", "labels": ["Date of Birth", "Phone 417-555-0101", "Languages spoken"]}, {"labels": ["Why caregiving?"]}]}')
ck('the reply: pages, sections in order, answer-like labels dropped, untitled named', c.pages === 9 && c.sections[0].labels.join('|') === 'Date of Birth|Languages spoken' && c.sections[1].title === '(untitled section)', c)
ck('an unreadable reply is empty, never an error', M.cleanLook('nope').sections.length === 0)
ck('the newest file of a GoHighLevel file field', M.newestFile({ a: { url: 'u1' }, b: { url: 'u2' } }).url === 'u2' && M.newestFile({ url: 'u3' }).url === 'u3' && M.newestFile(null) === null)
ck('looks at no more than 2 PDFs; the field name is exact', M.LOOK_MAX === 2 && M.FIELD === 'upload step 1 application packet')
ck('the AI is told labels only, never answers', /report ONLY the form's structure, never what anyone wrote/.test(M.LOOK_SYSTEM) && /Never include anything filled in/.test(M.LOOK_SYSTEM))
const f = fs.readFileSync('supabase/functions/step1-look/index.ts', 'utf8')
ck('it writes nothing: no insert, update, upsert, storage upload or delete', !/\.(insert|update|upsert|upload|remove|delete)\(/.test(f) && !/method: '(POST|PUT|DELETE)'[^}]*leadconnectorhq/.test(f))
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + note)); if (ok) pass++ }
console.log(pass === res.length ? `ALL ${res.length} CHECKS PASS` : `${res.length - pass} OF ${res.length} FAILED`); process.exit(pass === res.length ? 0 : 1)
