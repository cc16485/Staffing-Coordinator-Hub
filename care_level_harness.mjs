// Change 6b · the shared care-level rule + the care-level function under Node (fake AxisCare).
// node care_level_harness.mjs supabase/functions/_shared/care-level.ts supabase/functions/care-level/index.ts
import fs from 'fs'; import path from 'path';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note).slice(0, 900)]);
const R = await import(path.resolve(process.argv[2]));
ck('rule: "Level 2 - Personal Care" → 2; "Advanced Care" → 3 (the old copies missed it); "Complex" → 3; "Wellness" → 1; a payer → nothing',
  R.levelFromLabel('Level 2 - Personal Care') === 2 && R.levelFromLabel('Advanced Care') === 3 && R.levelFromLabel('Complex Care') === 3 && R.levelFromLabel('Wellness Care') === 1 && R.levelFromLabel('Medicaid') === null);
ck('rule: the HIGHEST level class held wins, and says which class it read', JSON.stringify(R.careLevelOf([{ label: 'Level 1 - Wellness Care' }, { label: 'Level 2 - Personal Care' }, { label: 'Medicaid' }])) === JSON.stringify({ level: 2, from: 'Level 2 - Personal Care' }));
// the hub's copy must read the same (parity)
const hub = fs.readFileSync(path.resolve('../cc-hub-live/index.html'), 'utf8');
const hubFn = new Function(hub.slice(hub.indexOf('function cgdLevelOf(classes){'), hub.indexOf('function cgdAvailFor(')) + '; return cgdLevelOf;')();
const corpus = [['Level 1 - Wellness Care'], ['Level 2 - Personal Care'], ['Level 3 - Complex Care'], ['Advanced Care'], ['Personal Care', 'Wellness'], ['Medicaid'], ['CDS'], [], ['level3'], ['Complex'], ['Private Pay', 'Level 2']];
ck('parity: the hub\'s caregiver directory reads every sample class set exactly like the shared rule', corpus.every(cs => hubFn(cs) === R.careLevelOf(cs.map(l => ({ label: l }))).level), corpus.map(cs => [cs, hubFn(cs), R.careLevelOf(cs.map(l => ({ label: l }))).level]));

const FN = process.argv[3];
let src = fs.readFileSync(FN, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace("from '../_shared/care-level.ts'", "from '" + path.resolve(process.argv[2]) + "'").replace("from '../_shared/client-events.ts'", "from '" + path.resolve('supabase/functions/_shared/client-events.ts') + "'");
const tmp = path.join(process.cwd(), '_cl_under_test.ts'); fs.writeFileSync(tmp, src);
let handler; const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k', AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485' };
globalThis.Deno = { env: { get: k => env[k] }, serve: h => { handler = h; } };
let AX, patches, cfg;
const reset = () => { patches = []; cfg = {}; AX = {
  vocab: [{ code: 'L1', label: 'Level 1 - Wellness Care' }, { code: 'L2', label: 'Level 2 - Personal Care' }, { code: 'L3', label: 'Level 3 - Complex Care' }, { code: 'MED', label: 'Medicaid' }, { code: 'PP', label: 'Private Pay' }, { code: 'DOG', label: 'Dogs' }],
  clients: { 501: { id: 501, status: { active: true }, classes: [{ code: 'L1', label: 'Level 1 - Wellness Care' }, { code: 'MED', label: 'Medicaid' }, { code: 'DOG', label: 'Dogs' }] },
             502: { id: 502, status: { active: true }, classes: [{ code: 'X', label: 'Medicaid Personal Care' }] },
             503: { id: 503, status: { active: false }, classes: [{ label: 'Level 2' }] } } }; };
reset();
const Rs = (s, b) => new Response(JSON.stringify(b), { status: s });
globalThis.fetch = async (u, o = {}) => { const url = new URL(String(u)), m = (o.method || 'GET').toUpperCase(); let x;
  if (url.pathname === '/api/classes/client') return Rs(200, { results: { classes: AX.vocab } });
  if (url.pathname === '/api/clients' && m === 'GET') return Rs(200, { results: { clients: Object.values(AX.clients) } });
  if ((x = /^\/api\/clients\/(\d+)$/.exec(url.pathname))) { const c = AX.clients[x[1]];
    if (m === 'GET') return Rs(200, { results: c });
    if (m === 'PATCH') { if (cfg.forbid) return Rs(403, { errors: ['forbidden'] }); const b = JSON.parse(o.body); patches.push(b); c.classes = b.classes.map(k => ({ code: k.code, label: k.label ?? AX.vocab.find(v => v.code === k.code)?.label })); return Rs(200, { results: {} }); } }
  throw new Error('unexpected ' + m + ' ' + url); };
globalThis.__db = { rpc: async (n, a) => { (globalThis.__REC ||= []).push({ n, a }); return { data: { outcome: 'recorded' }, error: null }; }, from: (t) => { const f = []; const p = { select() { return p; }, eq() { return p; }, maybeSingle() { return Promise.resolve({ data: t === 'journey_episode' ? { person_id: 'P1' } : { source_id: '501' }, error: null }); } }; return p; } };
await import(tmp); fs.unlinkSync(tmp);
const tok = (c) => 'Bearer x.' + Buffer.from(JSON.stringify(c)).toString('base64url') + '.y';
const KAT = tok({ role: 'authenticated', email: 'kat@cc.test' });
const call = async (b, auth = KAT) => { const r = await handler(new Request('http://x', { method: 'POST', headers: { Authorization: auth }, body: JSON.stringify(b) })); return [r.status, await r.json()]; };
let [st] = await call({ action: 'levels' }, tok({ role: 'anon' })); ck('a signed-in person is required', st === 401);
let [stS] = await call({ action: 'set', axiscare_client_id: '501', level: 3 }, tok({ role: 'service_role' })); let [stV] = await call({ action: 'vocab' }, tok({ role: 'service_role' }));
ck('the owner script may READ (vocab) but never "set"', stS === 401 && stV === 200 && patches.length === 0);
let [s0, b] = await call({ action: 'levels' });
ck('levels: every ACTIVE client\'s level from AxisCare (inactive left out)', b.levels['501'].level === 1 && b.levels['502'].level === 2 && !b.levels['503'], b);
[s0, b] = await call({ action: 'client', episode_id: 'E1' });
ck('client by Journey: resolves to the AxisCare client and reads its level', b.axiscare_client_id === '501' && b.level === 1 && b.level_name === 'Wellness', b);
[s0, b] = await call({ action: 'vocab' });
ck('vocab: how the rule reads each AxisCare class', b.classes.find(c => c.label === 'Medicaid').reads_as === 'payer' && b.classes.find(c => c.label === 'Level 3 - Complex Care').level === 3 && b.classes.find(c => c.label === 'Dogs').reads_as === 'other', b);
[s0, b] = await call({ action: 'set', axiscare_client_id: '501', level: 2 });
ck('set: ONLY the level class is replaced; Medicaid and Dogs are kept exactly; read back', b.outcome === 'updated' && b.after.level === 2 && b.kept_ok
  && JSON.stringify(patches[0].classes.map(c => c.code).sort()) === JSON.stringify(['DOG', 'L2', 'MED']), { b, p: patches[0] });
[s0, b] = await call({ action: 'set', axiscare_client_id: '501', level: 2 });
ck('set: already at that level → nothing written', b.outcome === 'already' && patches.length === 1, b);
[s0, b] = await call({ action: 'set', axiscare_client_id: '502', level: 3 });
ck('set: a class that names BOTH a payer and a level ("Medicaid Personal Care") → refused, nothing written', b.outcome === 'mixed_class' && patches.length === 1, b);
reset(); AX.vocab.push({ code: 'L2b', label: 'Personal Care' });
[s0, b] = await call({ action: 'set', axiscare_client_id: '501', level: 2 });
ck('set: two AxisCare classes read as the target level → refused (never guessed)', b.outcome === 'no_single_class' && patches.length === 0, b);
reset(); cfg.forbid = true;
[s0, b] = await call({ action: 'set', axiscare_client_id: '501', level: 3 });
ck('set: AxisCare refusing (403) is reported; nothing changed', b.outcome === 'refused' && /may not change clients/.test(b.detail), b);
const RECS = (globalThis.__REC || []).filter((x) => x.n === 'axiscare_change_record').map((x) => x.a);
const recOk = (x) => x.p_summary && x.p_summary.length <= 200 && !/\n/.test(x.p_summary) && x.p_by && x.p_via;
ck('C2a: a care-level change is recorded as "care level X → Y", confirmed by read-back', RECS.some((x) => x.p_kind === 'care_level' && /care level \S+ → [123]/.test(x.p_summary) && x.p_outcome === 'sent_confirmed' && recOk(x)), RECS);
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '\n     ' + note)); if (ok) pass++; }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1);
