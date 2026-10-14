// roster-axis-follow (Samantha, 2026-10-14: AxisCare is the truth for active; the Hub follows it nightly, the Caregivers page
// lists who changed, nobody deleted). Real function, fake database (with the safe-save patch), fake AxisCare. node roster_axis_follow_test.mjs
import fs from 'fs'; import path from 'path';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)]);
const FN = 'supabase/functions'
let APP, AX, AXDOWN, PATCHES, EVENTS, BUMP
const reset = () => { AXDOWN = false; PATCHES = []; EVENTS = []; BUMP = null
  APP = { ops_settings: {}, caregivers: [
    { id: 1, first: 'Ann', last: 'Gone', axiscare_id: '101', active: true, _rev: 3, phone: 'x' },      // AxisCare: terminated
    { id: 2, first: 'Bea', last: 'Back', axiscare_id: '102', active: false, _rev: 1 },                 // AxisCare: active again
    { id: 3, first: 'Cal', last: 'Same', axiscare_id: '103', active: true, _rev: 1 },                  // matches
    { id: 4, first: 'Dot', last: 'Unknown', axiscare_id: '999', active: true, _rev: 1 },               // number AxisCare doesn't know
    { id: 5, first: 'Eve', last: 'Nonum', active: true, _rev: 1 },                                     // no number
    { id: 6, first: 'Fay', last: 'Old', axiscare_id: '106', active: false, _rev: 1 }] }                // both inactive
  AX = [{ id: 101, status: { active: false, label: 'Terminated' } }, { id: 102, status: { active: true, label: 'Active' } }, { id: 103, status: { active: true, label: 'Active' } },
        { id: 106, status: { active: false, label: 'Inactive' } }]
  for (let i = 0; i < 30; i++) { APP.caregivers.push({ id: 100 + i, first: 'X' + i, last: 'Y', axiscare_id: String(2000 + i), active: true, _rev: 1 }); AX.push({ id: 2000 + i, status: { active: true, label: 'Active' } }) } }
const q = (t) => { const st = { f: [] }; const b = { select() { return b }, eq(c, v) { st.f.push([c, v]); return b },
  upsert(row) { if (t === 'app_data') APP[row.key] = JSON.parse(JSON.stringify(row.data)); return Promise.resolve({ error: null }) },
  insert(row) { if (t === 'op_events') EVENTS.push(row); return Promise.resolve({ error: null }) },
  maybeSingle() { const k = (st.f.find(([c]) => c === 'key') || [])[1]; return Promise.resolve({ data: k in APP ? { data: JSON.parse(JSON.stringify(APP[k])) } : null, error: null }) } }; return b }
globalThis.__db = { from: q, rpc: async (fn, a) => {
  if (fn === 'caregiver_active_patch') { PATCHES.push(a); if (BUMP && String(a.p_id) === BUMP.id && !BUMP.done) { BUMP.done = true; const r = APP.caregivers.find((g) => String(g.id) === a.p_id); r._rev++; Object.assign(r, BUMP.set || {}) }
    const r = APP.caregivers.find((g) => String(g.id) === a.p_id); if (!r) return { data: { ok: false, reason: 'gone' } }
    if ((r._rev || 0) !== a.p_base_rev) return { data: { ok: false, reason: 'changed', current_record: JSON.parse(JSON.stringify(r)) } }
    r.active = a.p_active; r.active_from_axiscare = a.p_note; r._rev++; return { data: { ok: true, rev: r._rev } } }
  return { data: null, error: null } } }
globalThis.fetch = async (url) => { url = String(url)
  if (url.includes('axiscare.com/api/caregivers')) return AXDOWN ? new Response('{}', { status: 503 }) : new Response(JSON.stringify({ results: { caregivers: AX, nextPage: null } }), { status: 200 })
  return new Response('{}', { status: 404 }) }
const ENV = { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k', AXISCARE_API_KEY: 'a', AXISCARE_SITE: '16485' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
fs.writeFileSync(`${FN}/_shared/_job-auth_raf.ts`, "export const jobCaller = async (req) => req.headers.get('x-test') === 'cron' ? 'cron' : null\n")
process.on('exit', () => { try { fs.unlinkSync(`${FN}/_shared/_job-auth_raf.ts`) } catch { /* */ } })
const src = fs.readFileSync(`${FN}/roster-axis-follow/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace(/(['"])\.\.\/_shared\/job-auth\.ts\1/, "'../_shared/_job-auth_raf.ts'")
const tmp = path.join(process.cwd(), FN, 'roster-axis-follow', '_t.ts'); fs.writeFileSync(tmp, src)
let M; try { M = await import(tmp + '?' + Math.random()) } finally { fs.unlinkSync(tmp) }
const run = async (qs = '', hdr = { 'x-test': 'cron' }) => { const r = await handler(new Request('https://x/functions/v1/roster-axis-follow' + qs, { method: 'POST', headers: hdr, body: '{}' })); return { s: r.status, j: await r.json() } }
const cg = (id) => APP.caregivers.find((g) => g.id === id)
reset(); let r = await run('', {})
ck('no schedule secret and no owner key: refused', r.s === 401, r)
reset(); r = await run()
const rep = APP.roster_axis_follow
ck('practice (switch off): works out 2 changes (Ann to inactive, Bea to active), changes no caregiver, writes the list marked practice', r.j.mode === 'practice' && r.j.changes === 2 && r.j.to_inactive === 1 && r.j.to_active === 1 && !PATCHES.length
   && cg(1).active === true && cg(2).active === false && rep.mode === 'practice' && rep.changes.map((c) => c.name).join() === 'Ann Gone,Bea Back', r.j)
ck('the list for the office: AxisCare number AxisCare does not know (Dot), active with no number (Eve); never changed', rep.not_in_axiscare.map((x) => x.name).join() === 'Dot Unknown' && rep.no_number.map((x) => x.name).join() === 'Eve Nonum' && cg(4).active === true && cg(5).active === true, rep)
ck('each change says what AxisCare says', rep.changes[0].axiscare_label === 'Terminated' && rep.changes[0].from === true && rep.changes[0].to === false, rep.changes)
reset(); r = await run('?dry=1')
ck('?dry=1: writes nothing at all', r.j.changes === 2 && !('roster_axis_follow' in APP) && !PATCHES.length, r.j)
reset(); APP.ops_settings.roster_follow_axis_live = true; r = await run()
ck('live: Ann marked inactive, Bea active again, through the safe patch with the note of why; nobody else touched; nobody deleted', r.j.mode === 'live' && r.j.changed === 2 && cg(1).active === false && cg(2).active === true
   && cg(1).active_from_axiscare.axiscare_label === 'Terminated' && PATCHES.length === 2 && APP.caregivers.length === 36 && cg(3)._rev === 1 && cg(4).active === true, r.j)
ck('live: each change is on the record (op_events) and kept in the Caregivers page history', EVENTS.length === 2 && /Ann Gone marked inactive in the Hub because AxisCare says Terminated/.test(EVENTS[0].summary) && APP.roster_axis_follow.history.length === 2, EVENTS)
r = await run()
ck('run again: nothing left to change; the history is kept', r.j.changes === 0 && APP.roster_axis_follow.history.length === 2, r.j)
reset(); APP.ops_settings.roster_follow_axis_live = true; BUMP = { id: '1' }; r = await run()
ck('someone edits Ann while the run works: it re-reads her and still changes only active (no edit undone)', cg(1).active === false && PATCHES.filter((p) => p.p_id === '1').length === 2, PATCHES)
reset(); APP.ops_settings.roster_follow_axis_live = true; BUMP = { id: '1', set: { active: false } }; r = await run()
ck('...and if the office already set it the same way meanwhile, it leaves it', cg(1).active === false && PATCHES.filter((p) => p.p_id === '1').length === 1, PATCHES)
reset(); APP.ops_settings.roster_follow_axis_live = true; AXDOWN = true; r = await run()
ck('AxisCare unreadable: holds, nothing changed', r.j.ok === false && /AxisCare could not be read/.test(r.j.held) && !PATCHES.length && cg(1).active === true, r.j)
reset(); APP.ops_settings.roster_follow_axis_live = true; AX = AX.map((a) => ({ ...a, status: { active: false, label: 'Inactive' } })); r = await run()
ck('would change more than a third at once: holds, nothing changed, says why on the list', r.j.ok === false && /more than a third/.test(r.j.held) && !PATCHES.length && /more than a third/.test(APP.roster_axis_follow.held), r.j)
const code = fs.readFileSync(`${FN}/roster-axis-follow/index.ts`, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
ck('never sends anything, never deletes, never writes AxisCare', !/conversations\/messages|ghl|delete\(|method: 'P(OST|ATCH|UT)'/i.test(code))
for (const [n, o, d] of res) console.log((o ? 'PASS' : 'FAIL') + ' · ' + n + (o ? '' : '\n     ' + d))
console.log(`${res.filter((x) => x[1]).length}/${res.length}`); process.exit(res.every((x) => x[1]) ? 0 : 1)
