// 439 · the GoHighLevel document import, rerun after caregiver connect: a caregiver moved over from Background &
// References is not copied twice; a new caregiver record gets their documents; practice copies nothing.
// node ghl_docs_rerun_test.mjs
import fs from 'fs'; import path from 'path'; import os from 'os'
const ROOT = path.dirname(new URL(import.meta.url).pathname)
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? '').slice(0, 700)])
let handler = null
globalThis.Deno = { env: { get: (k) => ({ GHL_TOKEN: 'ghl-tok', GHL_LOCATION_ID: 'loc1', SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'y' })[k] ?? '' }, serve: (h) => { handler = h } }
const src = fs.readFileSync(path.join(ROOT, 'supabase/functions/ghl-docs-import/index.ts'), 'utf8')
  .replace(/^import \{ createClient \}.*$/m, 'const createClient = (...a: any[]) => (globalThis as any).__db;')
  .replace(/^import \{ ownerCaller \}.*$/m, 'const ownerCaller = async (_r: Request) => true;')
const tmp = path.join(os.tmpdir(), 'ghl_docs_import_test_' + process.pid + '.ts'); fs.writeFileSync(tmp, src)
await import(tmp)

function world(prehire) {
  const t = { app_data: { caregivers: [
      { id: 66, first: 'Casey', last: 'Moreno', phone: '417.555.0103', candidate_id: 50, axiscare_id: '103' },     // moved over by caregiver connect
      { id: 67, first: 'Quinn', last: 'Ashby', phone: '1-417-555-0104', axiscare_id: '104' },                         // a new record
      { id: 20, first: 'Jo', last: 'Pike', phone: '4175550101' }],                                                     // imported on Oct 1 already
    candidates: [] }, prehire_docs: prehire, uploads: [] }
  return {
    t,
    from: (tb) => {
      const b = { select() { return b }, eq(k, v) { b.k = v; return b },
        async maybeSingle() { return { data: { data: t.app_data[b.k] ?? [] }, error: null } },
        then(ok, ko) { return Promise.resolve({ data: t[tb], error: null }).then(ok, ko) },
        async insert(row) { t.prehire_docs.push(row); return { error: null } } }
      return b
    },
    storage: { from: () => ({ upload: async (p) => { t.uploads.push(p); return { error: null } }, remove: async () => ({}) }) },
  }
}
const contacts = { '+14175550103': 'cCasey', '+14175550104': 'cQuinn', '+14175550101': 'cJo' }
const fileOf = { cCasey: 'K-casey-edl', cQuinn: 'K-quinn-edl', cJo: 'K-jo-edl' }
globalThis.fetch = async (u) => {
  u = String(u)
  const J = (o) => ({ ok: true, status: 200, json: async () => o, headers: new Map([['content-type', 'application/pdf']]), arrayBuffer: async () => new ArrayBuffer(10), body: null })
  if (u.includes('/customFields')) return J({ customFields: [{ id: 'f1', name: 'Upload EDL' }, { id: 'r1', name: 'EDL RESULTS' }] })
  const m = u.match(/number=([^&]+)/)
  if (u.includes('/contacts/search/duplicate')) return J({ contact: m ? { id: contacts[decodeURIComponent(m[1])] } : null })
  const c = u.match(/\/contacts\/(c\w+)$/)
  if (c) return J({ contact: { customFields: [{ id: 'f1', value: { [fileOf[c[1]]]: { url: 'https://files/' + c[1], meta: { originalname: 'edl.pdf' } } } }, { id: 'r1', value: '✅ Clear' }] } })
  if (u.startsWith('https://files/')) return { ok: true, status: 200, headers: { get: () => 'application/pdf' }, arrayBuffer: async () => new ArrayBuffer(10), body: null }
  return { ok: false, status: 404, json: async () => ({}) }
}
const call = async (db, mode) => { globalThis.__db = db; const r = await handler(new Request('http://x', { method: 'POST', body: JSON.stringify({ mode, offset: 0, limit: 12 }) })); return r.json() }
const done = () => [
  { person_kind: 'candidate', person_id: '50', check_key: 'edl', ghl_file_key: 'K-casey-edl' },    // Casey's, imported on Oct 1 while she was a candidate
  { person_kind: 'caregiver', person_id: '20', check_key: 'edl', ghl_file_key: 'K-jo-edl' }]
const state = (j, who) => (j.people.find((p) => p.who.startsWith(who))?.checks ?? [])[0]?.state

let db = world(done()), j = await call(db, 'practice')
ck('practice: the moved caregiver\'s document is already in (under her Background & References record)', state(j, 'Casey') === 'already imported (under their Background & References record)', j.people)
ck('practice: the new record\'s document would be copied', state(j, 'Quinn') === 'would import')
ck('practice: one copied on Oct 1 stays already imported', state(j, 'Jo') === 'already imported')
ck('practice copies nothing', db.t.uploads.length === 0 && db.t.prehire_docs.length === 2)
db = world(done()); j = await call(db, 'live')
ck('live: only the new record\'s document is copied, filed under their caregiver record', db.t.uploads.length === 1 && db.t.prehire_docs.length === 3
   && db.t.prehire_docs[2].person_kind === 'caregiver' && db.t.prehire_docs[2].person_id === '67' && db.t.prehire_docs[2].axiscare_id === '104' && db.t.prehire_docs[2].result_text === '✅ Clear', db.t.prehire_docs)
ck('live: the moved caregiver is not copied twice', !db.t.prehire_docs.some((x) => x.person_id === '66'))
db = world([{ person_kind: 'candidate', person_id: '99', check_key: 'edl', ghl_file_key: 'K-casey-edl' }]); j = await call(db, 'practice')
ck("a different candidate's copy of the same file doesn't count (only the record they came from)", state(j, 'Casey') === 'would import')
fs.unlinkSync(tmp)
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '\n     ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
