// M0 · notes-audit: owner key only; counts + AxisCare id numbers only; read only.
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)])
const FN = 'supabase/functions', SVC = 'svc_' + 'k'.repeat(60)
globalThis.__dbFor = (key) => ({ from: (t) => { const b = { select() { return b }, limit() { return Promise.resolve(t === 'identity_door_audit' && key !== SVC ? { data: null, error: { message: 'no' } } : { data: [], error: null }) } }; return b } })
{ const ja = fs.readFileSync(`${FN}/_shared/job-auth.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = (u, key) => globalThis.__dbFor(key)'); fs.writeFileSync(`${FN}/_shared/_job-auth_t.ts`, ja) }
// Central-time afternoons two days ago, so every visit falls on one local day
const base = new Date(); base.setUTCDate(base.getUTCDate() - 2); base.setUTCHours(15, 0, 0, 0)
const at = (h) => new Date(base.getTime() + h * 3600e3).toISOString()
const V = {}; const add = (id, cg, cl, h, note, outMethod, inMethod = 'Mobile') => { V[id] = { id, client: { id: cl, firstName: 'Ruth' }, caregiver: { id: cg, firstName: 'Cara' }, startDate: at(h), clockIn: { time: at(h), method: inMethod }, clockOut: outMethod ? { time: at(h + 2), method: outMethod } : null, careNote: note, adls: [] } }
add('s=1:d=a', 9, 501, 0, 'Ruth was well today.', 'Mobile'); add('s=2:d=a', 9, 501, 3, 'Ruth was well today.', 'Mobile')        // two visits, one note, same on both
add('s=3:d=a', 8, 502, 0, null, 'Telephony', 'Telephony')                                                                  // phone clock-out, no note
add('s=4:d=a', 8, 503, 3, null, 'Mobile')                                                                                   // app clock-out, no note
add('s=5:d=a', 7, 504, 0, null, 'Web'); add('s=6:d=a', 7, 505, 3, null, 'Mobile'); add('s=7:d=a', 7, 506, 5, null, 'Mobile') // one caregiver, three misses
add('s=8:d=a', 6, 507, 1, 'Fine', null)                                                                                    // not clocked out yet
let CALLS = [], LATER = false, SLOW = 1
globalThis.fetch = async (url, o) => { url = String(url); CALLS.push([url, (o && o.method) || 'GET'])
  if (url.includes('/api/visits?')) return new Response(JSON.stringify({ results: { visits: Object.values(V).map(({ careNote, adls, ...r }) => r) } }), { status: 200 })
  const m = url.match(/\/api\/visits\/([^?]+)$/); if (m && SLOW > 0) { SLOW--; return new Response('{}', { status: 429, headers: { 'retry-after': '1' } }) }
  if (m && V[m[1]]) { const v = { ...V[m[1]] }; if (LATER && m[1] === 's=4:d=a') v.careNote = 'late note'; return new Response(JSON.stringify({ results: v }), { status: 200 }) }
  return new Response('{}', { status: 404 }) }
const ENV = { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: SVC, AXISCARE_TOKEN: 'axc_x', AXISCARE_SITE: '16485', NOTES_AUDIT_PAUSE_MS: '0' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const src = fs.readFileSync(`${FN}/notes-audit/index.ts`, 'utf8').replace("'../_shared/job-auth.ts'", "'../_shared/_job-auth_t.ts'")
const tmp = path.join(process.cwd(), FN, 'notes-audit', '_t.ts'); fs.writeFileSync(tmp, src)
try { await import(tmp) } finally { fs.unlinkSync(tmp); fs.unlinkSync(`${FN}/_shared/_job-auth_t.ts`) }
const call = async (qs, auth, body) => { const r = await handler(new Request('https://x/functions/v1/notes-audit?' + qs, { method: 'POST', headers: auth ? { Authorization: 'Bearer ' + auth } : {}, body: body ? JSON.stringify(body) : '{}' })); return { s: r.status, j: await r.json() } }
let r = await call('m0=1', null); ck('no key: refused, AxisCare never asked', r.s === 401 && CALLS.length === 0)
r = await call('m0=1', 'eyJanon' + 'a'.repeat(60)); ck('the public key: refused', r.s === 401 && CALLS.length === 0)
r = await call('m0=1', SVC); const j = r.j
ck('finished shifts counted; one not clocked out yet is left out', j.visits_finished === 7 && j.visits_not_clocked_out === 1, j)
ck('the counting rule: two visits the same caregiver, client and day are ONE note, and the same note came back on both', j.groups === 6 && j.multi_visit_groups === 1 && j.multi_same_note_on_every_visit === 1, j)
ck('missing notes split by how they clocked out (app / phone / web)', j.groups_missing_note === 5 && j.missing_by_clock_out.app === 3 && j.missing_by_clock_out.phone === 1 && j.missing_by_clock_out.web === 1, j.missing_by_clock_out)
ck('per caregiver: 2 with a miss, 1 with three (also three without the phone clock-out)', j.caregivers_missing_3_plus_not_phone === 1 && j.caregivers_missing_1_plus === 2 && j.caregivers_missing_3_plus === 1 && j.most_missing_one_caregiver === 3, j)
ck('the snapshot holds AxisCare id numbers only, never a note or a name', j.snapshot.length === 5 && !JSON.stringify(j).includes('Ruth') && !JSON.stringify(j).includes('Cara') && !JSON.stringify(j).includes('well today'), j.snapshot)
LATER = true; r = await call('recheck=1', SVC, { snapshot: j.snapshot })
ck('a day later: the one that gained a note is counted, the rest still missing', r.j.checked === 5 && r.j.now_has_note === 1 && r.j.still_missing === 4, r.j)
r = await call('recheck=1', SVC, { snapshot: [{ v: '../../etc', k: 'x' }] }); ck('a snapshot entry that isn\'t a visit id is ignored', r.j.checked === 0, r.j)
ck('when AxisCare says slow down, it waits and carries on (nothing lost)', j.visits_read === 8 && j.stopped_early_slow_down === false, j)
r = await call('m0=1&offset=0&limit=3', SVC); const a1 = r.j; r = await call('m0=1&offset=3&limit=10', SVC); const a2 = r.j
ck('in slices: the same visits in the same order, with the next place to start', a1.slice_size === 3 && a1.next_offset === 3 && a2.next_offset === null && a1.rows.length + a2.rows.length === 7, [a1.next_offset, a2.next_offset, a1.rows.length, a2.rows.length])
ck('each row: id numbers, the day, clock-in/out method, note yes/no and a fingerprint; never the words', a1.rows.every((x) => 'f' in x && 'n' in x && !JSON.stringify(x).includes('well today')), a1.rows)
ck('only reads: every AxisCare call is a GET', CALLS.every(([u, m]) => m === 'GET'))
for (const [n, o, note] of res) console.log((o ? 'PASS' : 'FAIL') + ' · ' + n + (o ? '' : '\n   ' + note))
console.log(res.filter((x) => x[1]).length + '/' + res.length)
