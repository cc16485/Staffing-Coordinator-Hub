// SLICE 9 · lead-docs-retention paused behind lead_docs_purge_live (list only while off), and the evidence reader.
// Fake database and storage. node slice9_server_test.mjs
import fs from 'fs'; import path from 'path'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 700)])
const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'svc', HUB_JOB_SECRET: 'j'.repeat(48) }
let handler = null; globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h } }
const old = Date.now() - 120 * 864e5, fresh = Date.now() - 5 * 864e5
const ST = { files: { L1: [`LTC_POLICY-${old}-policy.pdf`, `LTC_POLICY-${fresh}-new.pdf`, `EMOMED-${old}-x.pdf`], L2: [`LTC_POLICY-${old}-b.pdf`] }, removed: [] }
let SETTINGS = { routing_live: true }, LOG = []
globalThis.__fakeCreateClient = () => ({
  from: (t) => ({ select: () => ({ eq: (k, v) => ({ maybeSingle: async () => ({ data: t === 'app_data' && v === 'ops_settings' ? { data: SETTINGS } : null, error: null }) }) }) }),
  rpc: async (n, a) => { if (n === 'upsert_app_data_item') LOG.push(a); return { data: null, error: null } },
  storage: { from: () => ({ list: async (p) => ({ data: p === '' ? Object.keys(ST.files).map((name) => ({ name })) : (ST.files[p] || []).map((name) => ({ name })), error: null }),
    remove: async (paths) => { ST.removed.push(...paths); return { data: null, error: null } } }) },
})
const TMP = path.join(ROOT, '.s9_under_test'); fs.rmSync(TMP, { recursive: true, force: true }); fs.cpSync(FN, TMP, { recursive: true })
for (const p of fs.readdirSync(TMP, { recursive: true })) { const f = path.join(TMP, String(p)); if (!f.endsWith('.ts')) continue; fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__fakeCreateClient').replace(/^import .* from ['"]https:[^'"]*['"];?$/mg, '')) }
let RET, EV; try { await import(path.join(TMP, 'lead-docs-retention', 'index.ts')); RET = handler; EV = await import(path.join(TMP, '_shared', 'evidence.ts')) } finally { fs.rmSync(TMP, { recursive: true, force: true }) }
const run = async (h = { 'x-cron-secret': env.HUB_JOB_SECRET }) => { const r = await RET(new Request('http://x/lead-docs-retention', { method: 'POST', headers: h })); return { status: r.status, j: await r.json() } }

let r = await run({})
ck('no schedule secret: refused, nothing listed', r.status === 401 && !LOG.length)
r = await run()
ck('switch off (not set): nothing deleted; it lists the two old policies it would delete', r.status === 200 && r.j.live === false && r.j.deleted === 0 && ST.removed.length === 0 && r.j.would_delete === 2 && r.j.would_delete_paths.every((p) => /LTC_POLICY-/.test(p)), r.j)
ck('...and the automation log says so (practice, with the paths)', LOG.length === 1 && LOG[0].target_key === 'automation_log' && LOG[0].item.dry === true && LOG[0].item.summary.would_delete === 2, LOG)
SETTINGS = { lead_docs_purge_live: 'true' }
r = await run()
ck('a switch that is not exactly true is still practice', r.j.live === false && ST.removed.length === 0, r.j)
SETTINGS = { lead_docs_purge_live: true }
r = await run()
ck('switch on: only the old LTC policies are deleted (the new one and other documents stay)', r.j.live === true && ST.removed.length === 2 && ST.removed.every((p) => /LTC_POLICY-/.test(p)) && !ST.removed.some((p) => /new\.pdf|EMOMED/.test(p)), [r.j, ST.removed])

// the evidence reader
const rows = [
  { id: 1, at: '2026-10-05T10:00:00Z', source: 'app_data:caregivers', record_id: 'c1', change: 'changed', field: 'oig_date', old_value: '2026-09-01', new_value: '2026-10-05' },
  { id: 2, at: '2026-10-08T10:00:00Z', source: 'app_data:caregivers', record_id: 'c1', change: 'changed', field: 'oig_date', old_value: '2026-10-05', new_value: '2026-10-08' },
  { id: 3, at: '2026-10-08T10:00:00Z', source: 'app_data:caregivers', record_id: 'c1', change: 'changed', field: 'dl_proof', old_value: null, new_value: 'p.pdf' },
  { id: 4, at: '2026-10-08T10:00:00Z', source: 'app_data:caregivers', record_id: 'c1', change: 'changed', field: 'sig_x', old_value: { md5: 'abc', len: 9 }, new_value: { md5: 'def', len: 9 } },
]
const now = { id: 'c1', oig_date: '2026-10-08', dl_proof: 'p.pdf', sig_x: 'IMG' }
let w = EV.rewind(now, rows, 'app_data:caregivers', 'c1', '2026-10-06T23:59:59.999-05:00')
ck('rewind: the value before the first later change; a field added later is blank; a fingerprint keeps today', w.oig_date === '2026-10-05' && !('dl_proof' in w) && w.sig_x === 'IMG', w)
w = EV.rewind(now, rows, 'app_data:caregivers', 'c1', '2026-10-01T23:59:59.999-05:00')
ck('rewind further back: the oldest known value', w.oig_date === '2026-09-01', w)
ck('rewind: a record added after the date did not exist then', EV.rewind(now, [{ at: '2026-10-09T00:00:00Z', source: 'app_data:caregivers', record_id: 'c1', change: 'added' }], 'app_data:caregivers', 'c1', '2026-10-01T23:59:59Z') === null)
ck('evidence line: before, after and who; a fingerprint is described, never shown', /oig_date: from 2026-09-01 to 2026-10-05 · by server/.test(EV.evidenceLine(rows[0])) && /signature or signed answers \(fingerprint abc/.test(EV.evidenceLine(rows[3])), [EV.evidenceLine(rows[0]), EV.evidenceLine(rows[3])])

for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + note))
const bad = res.filter((x) => !x[1]).length; console.log(`${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0)
