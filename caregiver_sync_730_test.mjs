// 730 · caregiver-sync + call_who knows applicants (Samantha 2026-10-14, item 2). Under Node against the REAL
// caregiver-sync function with a stand-in database and AxisCare census; the SQL part runs call_who_applicants_730.sql
// in a real Postgres when PGLITE is set.
//   node caregiver_sync_730_test.mjs
//   PGLITE=<path to @electric-sql/pglite/dist/index.js> node caregiver_sync_730_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 500)])
const F = 'supabase/functions'
const SERVICE = 'service'.repeat(6)
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SERVICE, AXISCARE_API_KEY: 'ax', AXISCARE_SITE: '123', HUB_JOB_SECRET: 'j'.repeat(40) }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }

// ── a small stand-in for supabase-js over in-memory tables ──
let DB, seq
function q(table) {
  const f = []; let lim = null, mode = 'select', payload = null
  const rows = () => (DB[table] ||= []).filter(r => f.every(fn => fn(r)))
  const api = {
    select() { return api }, eq(k, v) { f.push(r => r[k] === v); return api }, neq(k, v) { f.push(r => r[k] !== v); return api },
    in(k, vs) { f.push(r => vs.includes(r[k])); return api }, limit(n) { lim = n; return api },
    insert(o) { mode = 'insert'; payload = o; return api },
    async maybeSingle() { const r = await api; return { data: r.data?.[0] ?? null, error: r.error } },
    async single() { const r = await api; return { data: r.data?.[0] ?? null, error: r.error ?? (r.data?.length ? null : { message: 'none' }) } },
    then(ok, bad) {
      let out
      if (mode === 'insert') {
        const row = { ...payload }; if (table === 'person_identity') row.id = 'p' + (++seq)
        if (DB.__fail === table) out = { data: null, error: { message: 'refused' } }
        else { (DB[table] ||= []).push(row); DB.__writes.push(table); out = { data: [row], error: null } }
      } else { let d = rows(); if (lim != null) d = d.slice(0, lim); out = { data: d, error: null } }
      return Promise.resolve(out).then(ok, bad)
    },
  }
  return api
}
globalThis.__fakeCreateClient = (u, key) => ({ from: (t) => (t === 'identity_door_audit' && key !== undefined && key !== SERVICE)
    ? { select() { return this }, limit() { return Promise.resolve({ data: null, error: { message: 'permission denied' } }) } } : q(t), rpc: async (n, a) => { DB.__rpc.push([n, a]); return { data: null, error: null } } })

const tmp = fs.mkdtempSync(path.join(process.cwd(), '_cs_'))
const rewrite = (src) => src.replace(/^import \{ createClient \} from ['"]https:\/\/esm\.sh\/@supabase\/supabase-js@2['"];?$/m, 'const createClient = globalThis.__fakeCreateClient;')
fs.mkdirSync(path.join(tmp, '_shared')); fs.mkdirSync(path.join(tmp, 'caregiver-sync'))
for (const f of fs.readdirSync(path.join(F, '_shared'))) fs.writeFileSync(path.join(tmp, '_shared', f), rewrite(fs.readFileSync(path.join(F, '_shared', f), 'utf8')))
const src = rewrite(fs.readFileSync(path.join(F, 'caregiver-sync', 'index.ts'), 'utf8'))
if (/from ['"](https:|npm:)/.test(src)) throw new Error('caregiver-sync still imports from the internet')
fs.writeFileSync(path.join(tmp, 'caregiver-sync', 'index.ts'), src)
try {
  const mod = await import(path.join(tmp, 'caregiver-sync', 'index.ts'))
  const { syncActiveCaregivers, e164 } = mod

  const census = [
    { id: 'ax1', first: 'Porcia', last: 'Lewis', active: true, mobile: '(417) 555-0101' },        // new, Hub record with a 2nd number
    { id: 'ax2', first: 'Linked', last: 'Already', active: true, mobile: '417-555-0102' },        // already a person
    { id: 'ax3', first: 'Twin', last: 'Name', active: true, mobile: '4175550103' },               // same name as someone else
    { id: 'ax4', first: 'Gone', last: 'Before', active: false, mobile: '4175550104' },            // inactive: ignored
    { id: 'ax5', first: 'Two', last: 'Records', active: true, mobile: '4175550105' },             // two Hub records hold ax5
    { id: 'ax6', first: 'Past', last: 'Worker', active: true, mobile: '' },                       // former caregiver role, no phone
    { id: 'ax7', first: '', last: '', active: true, mobile: '4175550107' },                       // no name
  ]
  const fresh = () => {
    seq = 0
    DB = { __writes: [], __rpc: [],
      person_identity: [{ id: 'pL', display_name: 'Linked Already' }, { id: 'pT', display_name: 'Twin Name' }, { id: 'pP', display_name: 'Past Worker' }],
      person_source_id: [{ person_id: 'pL', system: 'axiscare', entity_type: 'caregiver', source_id: 'ax2' },
        { person_id: 'pP', system: 'axiscare', entity_type: 'caregiver', source_id: 'ax6' }],
      person_role: [{ id: 1, person_id: 'pL', role: 'caregiver', status: 'active' }, { id: 2, person_id: 'pP', role: 'caregiver', status: 'former' }],
      phone_index: [{ id: 1, phone: '+14175550102', person_id: 'pL' }],
      app_data: [{ key: 'caregivers', data: [{ id: 'cg1', axiscare_id: 'ax1', phone: '417.555.0199' }, { id: 'cg2', axiscare_id: 'ax2', phone: '4175550102' },
        { id: 'cg5a', axiscare_id: 'ax5' }, { id: 'cg5b', axiscare_id: 'ax5' }] }],
    }
  }

  ck('e164: 10 digits', e164('(417) 555-0101') === '+14175550101')
  ck('e164: 11 digits with 1', e164('1-417-555-0101') === '+14175550101')
  ck('e164: junk is null', e164('555-0101') === null && e164(null) === null)

  fresh()
  const dry = await syncActiveCaregivers(globalThis.__fakeCreateClient(), census, false)
  ck('dry run writes nothing', DB.__writes.length === 0, DB.__writes)
  ck('dry run counts the new ones (Porcia, Two Records)', dry.created === 2, dry)

  fresh()
  const out = await syncActiveCaregivers(globalThis.__fakeCreateClient(), census, true)
  ck('no errors', out.errors.length === 0, out.errors)
  ck('active count leaves out the inactive caregiver', out.axiscare_active_caregivers === 6, out)
  const porcia = DB.person_identity.find(p => p.display_name === 'Porcia Lewis')
  ck('Porcia becomes a person', !!porcia)
  ck('Porcia linked to her AxisCare id', DB.person_source_id.some(s => s.person_id === porcia?.id && s.system === 'axiscare' && s.source_id === 'ax1' && s.confidence === 'confirmed'))
  ck('Porcia linked to her Hub record', DB.person_source_id.some(s => s.person_id === porcia?.id && s.system === 'hub' && s.source_id === 'cg1'))
  ck('Porcia has an active caregiver role', DB.person_role.some(r => r.person_id === porcia?.id && r.role === 'caregiver' && r.status === 'active'))
  const pp = DB.phone_index.filter(x => x.person_id === porcia?.id)
  ck('both of Porcia\'s numbers indexed, with where each came from', pp.length === 2 && pp.some(x => x.phone === '+14175550101' && x.source_system === 'axiscare')
    && pp.some(x => x.phone === '+14175550199' && x.source_system === 'hub' && x.source_record_id === 'cg1'), pp)
  ck('already-linked person reused, not duplicated', DB.person_identity.filter(p => p.display_name === 'Linked Already').length === 1 && out.already_linked >= 1)
  ck('already-linked person gets the Hub record link', DB.person_source_id.some(s => s.person_id === 'pL' && s.system === 'hub' && s.source_id === 'cg2'))
  ck('existing number not indexed twice', DB.phone_index.filter(x => x.phone === '+14175550102').length === 1)
  ck('same-name person is left for a person to connect', out.name_coincidences.length === 1 && DB.person_identity.filter(p => p.display_name === 'Twin Name').length === 1
    && !DB.person_source_id.some(s => s.source_id === 'ax3') && !DB.phone_index.some(x => x.phone === '+14175550103'))
  ck('inactive caregiver ignored', !DB.person_identity.some(p => p.display_name === 'Gone Before'))
  const two = DB.person_identity.find(p => p.display_name === 'Two Records')
  ck('two Hub records on one AxisCare id: person made, no Hub link guessed', !!two && out.hub_record_ambiguous === 1
    && !DB.person_source_id.some(s => s.person_id === two?.id && s.system === 'hub'))
  ck('former caregiver is never made current again', out.former_left_for_a_person === 1 && !DB.person_role.some(r => r.person_id === 'pP' && r.status === 'active'))
  ck('no name is skipped', out.skipped_no_name === 1)
  ck('nothing written outside the identity tables', DB.__writes.every(t => ['person_identity', 'person_source_id', 'person_role', 'phone_index'].includes(t)), [...new Set(DB.__writes)])

  const before = JSON.stringify(DB)
  const again = await syncActiveCaregivers(globalThis.__fakeCreateClient(), census, true)
  ck('second run adds nobody and nothing', again.created === 0 && again.phones_indexed === 0 && again.roles_added === 0 && again.hub_records_linked === 0
    && JSON.stringify(DB.person_identity) === JSON.stringify(JSON.parse(before).person_identity), again)

  fresh(); DB.__fail = 'person_source_id'
  const failed = await syncActiveCaregivers(globalThis.__fakeCreateClient(), census, true)
  ck('a refused write is reported, not hidden', failed.errors.length > 0, failed)

  // the web door
  const call = (h) => handler(new Request('https://x/functions/v1/caregiver-sync', { headers: h }))
  const r1 = await call({})
  ck('no key: refused', r1.status === 401)
  const r2 = await call({ Authorization: 'Bearer sb_publishable_' + 'x'.repeat(30) })
  ck('public key: refused', r2.status === 401)
  fresh()
  globalThis.fetch = async () => new Response(JSON.stringify({ results: { caregivers: census.map(c => ({ id: c.id, firstName: c.first, lastName: c.last, status: { active: c.active }, mobilePhone: c.mobile })) } }), { status: 200 })
  const r3 = await call({ Authorization: 'Bearer ' + SERVICE })
  const j3 = await r3.json()
  ck('owner key: runs and answers counts only', r3.status === 200 && j3.ok === true && j3.created === 2 && j3.name_coincidences === 1 && !JSON.stringify(j3).includes('Porcia'), j3)
  ck('heartbeat written', DB.__rpc.some(([n, a]) => n === 'upsert_app_data_item' && a.item.id === 'hb_caregiver-sync' && a.item.ok === true))
  fresh()
  globalThis.fetch = async () => new Response('no', { status: 403 })
  const j4 = await (await call({ Authorization: 'Bearer ' + SERVICE })).json()
  ck('AxisCare down: says so, writes nothing, heartbeat not ok', j4.ok === false && /403/.test(j4.error || '') && DB.__writes.length === 0
    && DB.__rpc.some(([n, a]) => a.item?.id === 'hb_caregiver-sync' && a.item.ok === false), j4)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }

// ── SQL: call_who in a real Postgres ──
if (process.env.PGLITE) {
  let p = process.env.PGLITE; if (!p.endsWith('.js')) p = path.join(p, 'dist', 'index.js')
  const { PGlite } = await import(p)
  const db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table person_identity (id uuid primary key default gen_random_uuid(), display_name text);
    create table person_source_id (id serial, person_id uuid, system text, entity_type text, source_id text, needs_review boolean default false);
    create table phone_index (id serial, phone text, person_id uuid);
    create table app_data (key text primary key, data jsonb);
    create table job_applicants (id uuid primary key default gen_random_uuid(), first_name text, last_name text, phone text);`)
  await db.exec(fs.readFileSync('call_who_applicants_730.sql', 'utf8'))
  const who = async (ph) => (await db.query('select public.call_who($1) w', [ph])).rows[0].w
  await db.exec(`insert into person_identity (id, display_name) values ('00000000-0000-0000-0000-000000000001', 'Porcia Lewis');
    insert into person_source_id (person_id, system, entity_type, source_id) values ('00000000-0000-0000-0000-000000000001', 'axiscare', 'caregiver', 'ax1');
    insert into phone_index (phone, person_id) values ('+14175550101', '00000000-0000-0000-0000-000000000001');
    insert into app_data values ('leads', '[{"id":"L1","first_name":"Lee","last_name":"Lead","phone":"417-555-0300"}]');
    insert into job_applicants (first_name, last_name, phone) values ('Ann', 'Applicant', '(417) 555-0400'), ('Dup', 'One', '4175550500'), ('Dup', 'Two', '417-555-0500'),
      ('Also', 'Caregiver', '4175550101'), ('Also', 'Lead', '4175550300');`)
  const a = await who('+1 417 555 0400')
  ck('SQL: applicant named when nobody else has the number', a.match === 'one' && a.name === 'Ann Applicant' && a.roles[0] === 'applicant' && a.applicant_id && a.person_id === null, a)
  ck('SQL: two applicants on one number = several', (await who('4175550500')).match === 'several')
  const c = await who('4175550101')
  ck('SQL: a caregiver person wins over an applicant row', c.match === 'one' && c.name === 'Porcia Lewis' && !c.applicant_id && c.roles.includes('caregiver'), c)
  const l = await who('4175550300')
  ck('SQL: a lead wins over an applicant row', l.match === 'one' && l.lead_id === 'L1' && !l.applicant_id, l)
  ck('SQL: unknown number = none', (await who('4175559999')).match === 'none')
  ck('SQL: short number = none', (await who('555')).match === 'none')
  const g = (await db.query(`select has_function_privilege('authenticated', 'public.call_who(text)', 'execute') a, has_function_privilege('service_role', 'public.call_who(text)', 'execute') s`)).rows[0]
  ck('SQL: still server only', g.a === false && g.s === true, g)
} else res.push(['SQL part (set PGLITE to run it)', true, 'skipped'])

let bad = 0
for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '  ' + note)); if (!ok) bad++ }
console.log(`${res.length - bad}/${res.length}`); process.exit(bad ? 1 : 0)
