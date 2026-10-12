// TRACK 3c · the 25 care-need kinds on the real fact record (client-fact.sql + Gate 3 + care-need-kinds.sql) in a local
// Postgres (PGlite), and a care plan need saved, updated, corrected and refused through the real door, client_fact_record().
// Small stand-ins only for the tables the fact record joins to. PGLITE=<path to pglite index.js> node care_need_kinds_test.mjs
import fs from 'fs'
const { PGlite } = await import(process.env.PGLITE)
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 400)])
const db = new PGlite()
await db.exec(`
create role anon; create role authenticated; create role service_role;
create table public.app_data (key text primary key, data jsonb);
create table public.journey_episode (episode_id uuid primary key default gen_random_uuid(), state text not null default 'open');
create table public.episode_source (episode_id uuid, system text, role text, source_ref text);
create table public.episode_range (episode_id uuid, starts_on date, ends_on date);
create table public.person_source_id (person_id uuid, system text, source_ref text);
create table public.client_queue (id text, episode_id uuid, status text);
create table public.launch_evidence (episode_id uuid, kind text, at timestamptz);
create function public.can_access_data_key(text) returns boolean language sql as 'select true';
`)
const run = async (f) => { try { await db.exec(fs.readFileSync(f, 'utf8')); return 'ok' } catch (e) { try { await db.exec('rollback') } catch {} return e.message } }
const r1 = await run('client-fact.sql'); ck('the real fact record installs (stand-ins for its neighbours)', r1 === 'ok', r1)
/* the care-began fix is not installed here: it reads tables these stand-ins do not model, and only intake saves use it */
ck('Gate 3 kinds install', (await run('fact-kinds-gate3.sql')) === 'ok')
const r2 = await run('care-need-kinds.sql'); ck('the 25 care-need kinds install', r2 === 'ok', r2)
const k = (await db.query("select kind, layers, choices, active from public.fact_kind where created_by = 'match_needs' order by kind")).rows
ck('25 kinds, every one on all four layers, active', k.length === 25 && k.every((x) => x.active && x.layers.join() === 'intake,assessment,plan,current'), k.length)
ck('one kind per skill on the approved list (18), plus lift type, advanced tasks, cats, dogs, smoking, gender, Spanish', ['need_hoyer_lift', 'need_catheter_bag', 'need_ostomy_bag', 'need_parkinsons_care', 'need_lift_type', 'need_advanced_tasks', 'home_cats', 'home_dogs', 'home_smoking', 'pref_caregiver_gender', 'need_spanish'].every((n) => k.some((x) => x.kind === n)) && k.filter((x) => /^need_/.test(x.kind) && JSON.stringify(x.choices) === '["required","preferred","no"]').length === 19)
ck('a second install is refused and changes nothing', /refused/.test(await run('care-need-kinds.sql')) && (await db.query("select count(*)::int n from public.fact_kind where created_by='match_needs'")).rows[0].n === 25)
/* the door */
const ep = (await db.query('insert into public.journey_episode default values returning episode_id')).rows[0].episode_id
const rec = async (o) => (await db.query(`select public.client_fact_record($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) as r`,
  [ep, o.kind, o.layer || 'plan', o.value === undefined ? null : JSON.stringify(o.value), o.certainty === undefined ? 'confirmed' : o.certainty, o.change || 'first', o.sup || null, o.reason || null, null, null, o.how || 'staff_observation', null, null, null, 'kay@mo-care.com'])).rows[0].r
let a = await rec({ kind: 'need_hoyer_lift', value: 'required' })
ck('a coordinator confirms "Hoyer lift: required" on the care plan: recorded', a.outcome === 'recorded' && a.fact_id, a)
const first = a.fact_id
ck('a value not on the list is refused', (await rec({ kind: 'need_bathing', value: 'maybe' })).outcome === 'refused')
ck('a second "first" for the same need is refused (one chain per need)', (await rec({ kind: 'need_hoyer_lift', value: 'no' })).outcome === 'refused')
a = await rec({ kind: 'need_hoyer_lift', value: 'no', change: 'correction', sup: first })
ck('a correction without a reason is refused', a.outcome === 'refused' && a.reason === 'reason_required', a)
a = await rec({ kind: 'need_hoyer_lift', value: 'preferred', change: 'update', sup: first })
ck('their needs changed: an update replaces the confirmed fact (the old one stays in the history)', a.outcome === 'recorded', a)
const upd = a.fact_id
a = await rec({ kind: 'need_hoyer_lift', value: 'no', change: 'update', sup: first })
ck('a save on top of a fact someone else already replaced is refused as stale', a.outcome === 'refused' && a.reason === 'stale', a)
a = await rec({ kind: 'need_hoyer_lift', value: 'no', change: 'correction', sup: upd, reason: 'The family said a lift; the assessment found she stands with help' })
ck('a correction with its reason is recorded', a.outcome === 'recorded', a)
ck('the full history stays: three facts on the chain, nothing edited or deleted', (await db.query("select count(*)::int n from public.client_fact where kind='need_hoyer_lift'")).rows[0].n === 3)
ck('the lift type and the advanced tasks take their own lists', (await rec({ kind: 'need_lift_type', value: 'sit_to_stand' })).outcome === 'recorded' && (await rec({ kind: 'need_advanced_tasks', value: ['catheter_change'] })).outcome === 'recorded' && (await rec({ kind: 'need_advanced_tasks', value: ['surgery'], change: 'first' })).outcome === 'refused')
/* rollback: inactive, nothing deleted */
await db.exec(fs.readFileSync('care-need-kinds-rollback.sql', 'utf8'))
ck('rollback: the 25 kinds become inactive; every recorded fact stays', (await db.query("select count(*)::int n from public.fact_kind where created_by='match_needs' and active")).rows[0].n === 0 && (await db.query("select count(*)::int n from public.client_fact")).rows[0].n >= 5)
const bad = res.filter((x) => !x[1]); for (const [n, ok, note] of res) console.log((ok ? 'ok    ' : 'FAIL  ') + n + (ok ? '' : '  ' + note))
console.log(`${res.length - bad.length}/${res.length} passed`); if (bad.length) process.exit(1)
