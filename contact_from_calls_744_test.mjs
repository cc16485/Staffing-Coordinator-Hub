// 744: a lead made from a call has already been talked to. The REAL SQL against a throwaway Postgres (PGlite).
// PGLITE=<path> node contact_from_calls_744_test.mjs
import fs from 'fs'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 600)])
const { PGlite } = await import(process.env.PGLITE || '/Users/samantha/Claude/Projects/.pglite/node_modules/@electric-sql/pglite/dist/index.js')
const db = new PGlite()
const sql = fs.readFileSync(new URL('./contact_from_calls_744.sql', import.meta.url), 'utf8')
const leads = [
  { id: 'A', status: 'New', from_calls: [{ message_id: 'm2', at: '2026-10-15T01:00:00Z' }, { message_id: 'm1', at: '2026-10-14T20:00:00Z' }], comm_log: [{ body: 'x' }] },
  { id: 'B', status: 'New', first_name: '(phone lead)', last_call_at: '2026-10-15T00:50:00Z', ai_suggestions: [{ source: 'call-followup', at: '2026-10-15T00:51:00Z' }] },
  { id: 'C', status: 'Contacted', first_human_contact_at: '2026-10-10T00:00:00Z', from_calls: [{ message_id: 'm3', at: '2026-10-12T00:00:00Z' }] },
  { id: 'D', status: 'New' },
  { id: 'E', status: 'Lost', from_calls: [{ message_id: 'm4', at: '2026-10-12T00:00:00Z' }] },
  { id: 'F', status: 'Assessment Scheduled', from_calls: [{ message_id: 'm5', at: '2026-10-13T00:00:00Z' }] },
  { id: 'G', status: 'New', archived: true, from_calls: [{ message_id: 'm6', at: '2026-10-13T00:00:00Z' }] }]
await db.exec(`create table public.app_data(key text primary key, data jsonb, updated_at timestamptz);`)
await db.query(`insert into public.app_data values ('leads', $1), ('other', '{"x":1}')`, [JSON.stringify(leads)])
await db.exec(sql)
const canon = (v) => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((q) => [q, x[q]])) : x)
const got = async () => Object.fromEntries((await db.query(`select data from app_data where key = 'leads'`)).rows[0].data.map((l) => [l.id, l]))
let L = await got()
ck('a lead made from a call: talked to at the EARLIEST call, Contacted, one event, one log line, status history', L.A.first_human_contact_at === '2026-10-14T20:00:00Z' && L.A.first_human_attempt_at === '2026-10-14T20:00:00Z'
  && L.A.status === 'Contacted' && L.A.contact_events.length === 1 && L.A.contact_events[0].ref === 'ghl:m1' && L.A.contact_events[0].outcome === 'connected' && L.A.comm_log.length === 2
  && L.A.last_contacted_at === '2026-10-14' && L.A.status_history.at(-1).to === 'Contacted', L.A)
ck('an old-AI lead (like Laura Johnson): talked to at its call', L.B.first_human_contact_at === '2026-10-15T00:50:00Z' && L.B.status === 'Contacted' && L.B.contact_events.length === 1, L.B)
ck('a lead already talked to is left exactly as it was', canon(L.C) === canon(leads[2]), L.C)
ck('a lead with no call, a Lost lead and an archived lead are left exactly as they were', canon(L.D) === canon(leads[3]) && canon(L.E) === canon(leads[4]) && canon(L.G) === canon(leads[6]))
ck('a lead past New keeps its status, and gets the conversation', L.F.status === 'Assessment Scheduled' && L.F.first_human_contact_at === '2026-10-13T00:00:00Z' && !L.F.status_history, L.F)
ck('the order of the leads is unchanged, and nothing else is touched', (await db.query(`select data from app_data where key='leads'`)).rows[0].data.map((l) => l.id).join('') === 'ABCDEFG'
  && JSON.stringify((await db.query(`select data from app_data where key='other'`)).rows[0].data) === '{"x":1}')
const before = JSON.stringify(await got()); await db.exec(sql)
ck('running it again changes nothing', JSON.stringify(await got()) === before)
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
