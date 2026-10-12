// 671 · REFERENCE ANSWERS LAND BY THEMSELVES. The job (reference-land/index.ts + _shared/reference-land.ts) with the REAL
// Hub rules file (eligibility-rules.js with refAnswerPatch), a stand-in database and a stand-in door that keeps _rev the
// way the database does; then (with PGLITE) the door reference_land_apply itself in a real Postgres.
//   HUB=<Hub folder holding the new eligibility-rules.js> PGLITE=<path to @electric-sql/pglite/dist/index.js> node reference_land_671_test.mjs
import fs from 'fs'; import path from 'path'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions')
const HUB = process.env.HUB || path.join(ROOT, '../cc-hub-person-links')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 700)])
const RULES_NEW = fs.readFileSync(path.join(HUB, 'eligibility-rules.js'), 'utf8')
if (!/refAnswerPatch/.test(RULES_NEW)) { console.log('FAIL: ' + HUB + '/eligibility-rules.js has no refAnswerPatch; point HUB at the Hub branch ref-answers-land'); process.exit(1) }
const RULES_OLD = RULES_NEW.replace('refScore, refAnswerPatch, ', '')         /* what cc.mo-care.com serves until the Hub PR merges */
const SRC_FN = fs.readFileSync(path.join(FN, 'reference-land/index.ts'), 'utf8'), SRC_SH = fs.readFileSync(path.join(FN, '_shared/reference-land.ts'), 'utf8')
const SQL = fs.readFileSync(path.join(ROOT, 'supabase/reference-land-671.sql'), 'utf8')

/* ── 1. nothing can be sent from here ── */
ck('no em dash in the function, the shared file or the door SQL', !/—/.test(SRC_FN + SRC_SH + SQL))
ck('no fetch in the function or the shared file (the only download is the rules file, inside approved-rules.ts)', !/\bfetch\s*\(/.test(SRC_FN + SRC_SH))
const imports = (SRC_FN + SRC_SH).match(/^import .+$/gm) || []
ck('it imports only the database client, the caller check, the approved rules and its own file', imports.length === 4 && imports.every((l) => /esm\.sh\/@supabase\/supabase-js@2|job-auth\.ts|approved-rules\.ts|reference-land\.ts/.test(l)), imports)
const CODE = (SRC_FN + '\n' + SRC_SH).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '')
ck('no send path in the code: no texts, emails, GoHighLevel, Resend, push, PDF, AxisCare or screening-cleared', !/ghl|resend|twilio|send-problems|sendText|sendEmail|push-notify|webpush|pdf|axiscare|markScreeningCleared|obAfterRefRecorded|net\.http|functions\/v1/i.test(CODE), (CODE.match(/ghl|resend|twilio|send-problems|sendText|sendEmail|push-notify|webpush|pdf|axiscare|markScreeningCleared|obAfterRefRecorded|net\.http|functions\/v1/ig) || []))
ck('the age guard and the batch limit are named constants at the top', /export const NEGATIVE_ALERT_MAX_AGE_DAYS = 14\b/.test(SRC_SH) && /export const BATCH_LIMIT = 50\b/.test(SRC_SH))

/* ── 2. the card is the button's card, field for field ── */
const ENGINE = fs.readFileSync(path.join(HUB, 'caregivers-engine.js'), 'utf8')
const blk = ENGINE.slice(ENGINE.indexOf("id: 'ops_negref_' + r.id"), ENGINE.indexOf('}});', ENGINE.indexOf("id: 'ops_negref_' + r.id")))
const keysIn = (s) => [...new Set((s.match(/(?:^|[,{])\s*([a-z_]+):/gm) || []).map((x) => x.replace(/[\s,{:]/g, '')))].sort()
const SH = await import(path.join(FN, '_shared/reference-land.ts'))
const sampleItem = SH.negativeItem({ first: 'Pat', last: 'Doe' }, { id: 'q1', ref_name: 'Lee', ref_relationship: 'Supervisor', concerns: 'serious', notes: 'Late often' }, new Date('2026-10-12T15:00:00Z'))
ck('the Negative card has exactly the fields the Hub button gives it', JSON.stringify(Object.keys(sampleItem).sort()) === JSON.stringify(keysIn(blk)), [Object.keys(sampleItem).sort(), keysIn(blk)])
ck('...with the same words', sampleItem.title === 'Negative reference for Pat Doe' && sampleItem.detail === 'Lee (Supervisor) would not recommend them and raised a serious concern. They said: "Late often" Read the full record before this candidate goes any further.' && sampleItem.urgency === 'today' && sampleItem.kind === 'discipline' && sampleItem.source_id === 'negref_q1', sampleItem)

/* ── 3. the job, with a stand-in database ── */
const NOW = Date.now(), daysAgo = (d) => new Date(NOW - d * 86400000).toISOString()
const ans = (o) => ({ id: 'q' + o.n, candidate_id: 'c1', slot: 1, ref_name: 'Ref ' + o.n, responded_at: daysAgo(1), merged_at: null, recommend: 'yes', reliability: 'Excellent', interpersonal: 'Excellent', honesty: 'Excellent', concerns: 'none', ...o })
let DB, WRITES, DOOR_CALLS, APPROVED, RULES, FAIL_ITEM, CHANGE_ONCE
function reset(over = {}) {
  DB = {
    app_data: { ops_settings: { ref_land_live: false }, ops_items: [{ id: 'other', status: 'open' }],
      candidates: [{ id: 'c1', first: 'Ann', last: 'Able', _rev: 3, r1n: '', r1s: 'Pending', r2n: 'Old Boss', r2s: 'Positive' },
        { id: 'c2', first: 'Bo', last: 'Bright', _rev: 1 }, { id: 'c3', first: 'Cy', last: 'Gone', not_hired: true, _rev: 2 }, { id: 'c4', first: 'Di', last: 'Dee' }] },
    reference_requests: [
      ans({ n: 1, candidate_id: 'c1', slot: 1, ref_type: 'professional', ref_company: 'Acme Care' }),
      ans({ n: 2, candidate_id: 'c2', slot: 2, recommend: 'no', concerns: 'serious', notes: 'Stole from a client', ref_relationship: 'Supervisor' }),
      ans({ n: 3, candidate_id: 'c4', slot: 1, recommend: 'no', responded_at: daysAgo(20) }),
      ans({ n: 4, candidate_id: 'c3', slot: 1 }),
      ans({ n: 5, candidate_id: 'nobody', slot: 1 }),
      ans({ n: 6, candidate_id: 'c1', slot: 9 }),
      ans({ n: 7, candidate_id: 'c1', slot: 3, merged_at: daysAgo(2) }),
      { id: 'q8', candidate_id: 'c1', slot: 4, responded_at: null, merged_at: null } ], ...over }
  WRITES = []; DOOR_CALLS = []; APPROVED = true; RULES = RULES_NEW; FAIL_ITEM = false; CHANGE_ONCE = false
}
const clone = (x) => JSON.parse(JSON.stringify(x))
const rev = (x) => (/^[0-9]{1,15}$/.test(String(x?._rev ?? '')) ? Number(x._rev) : 0)
function table(t) {
  const f = []; let upd = null
  const run = () => {
    if (t === 'rules_approved') return { data: APPROVED ? [{ sha256: 'x' }] : [], error: null }
    if (t === 'reference_requests') {
      if (upd) { const row = DB.reference_requests.find((r) => f.every(([op, k, v]) => op === 'eq' ? String(r[k]) === String(v) : op === 'is' ? r[k] == null : true))
        if (row) { Object.assign(row, upd); WRITES.push({ t, id: row.id, upd }) } return { data: null, error: null } }
      return { data: clone(DB.reference_requests.filter((r) => r.responded_at != null && r.merged_at == null)), error: null }
    }
    return { data: null, error: null }
  }
  const q = { select: () => q, eq: (k, v) => (f.push(['eq', k, v]), q), not: () => q, is: (k, v) => (f.push(['is', k, v]), q), order: () => q, limit: () => q, in: () => q,
    maybeSingle: async () => ({ data: t === 'app_data' ? { data: clone(DB.app_data[f.find((x) => x[1] === 'key')?.[2]] ?? null) } : null, error: null }),
    update: (u) => { upd = u; return q }, upsert: async (row) => { WRITES.push({ t, row }); return { error: null } }, insert: async (row) => { WRITES.push({ t, row }); return { error: null } },
    then: (ok, no) => Promise.resolve(run()).then(ok, no) }
  return q
}
async function rpc(name, a) {
  if (name === 'reference_land_apply') {
    DOOR_CALLS.push(clone(a))
    const allowed = ['n', '_manual', '_type', '_company', 's'].map((s) => 'r' + a.p_slot + s)
    if (Object.keys(a.p_patch).some((k) => !allowed.includes(k))) return { data: null, error: { message: 'not a field a reference answer may land' } }
    const list = DB.app_data.candidates, hits = list.filter((x) => String(x.id) === a.p_candidate_id)
    if (!hits.length) return { data: { ok: false, reason: 'no_candidate' }, error: null }
    const c = hits[0]; if (c.not_hired) return { data: { ok: false, reason: 'not_hired' }, error: null }
    if (CHANGE_ONCE) { CHANGE_ONCE = false; c.phone = '4175550100'; c._rev = rev(c) + 1 }   /* an office save lands a moment before */
    if (rev(c) !== a.p_base_rev) return { data: { ok: false, reason: 'changed', current_record: clone(c) }, error: null }
    const fields = Object.keys(a.p_patch).filter((k) => JSON.stringify(c[k]) !== JSON.stringify(a.p_patch[k]))
    if (!fields.length) return { data: { ok: true, unchanged: true, fields: [] }, error: null }
    Object.assign(c, a.p_patch); c._rev = rev(c) + 1; WRITES.push({ t: 'door', id: c.id, fields })
    return { data: { ok: true, rev: c._rev, fields }, error: null }
  }
  if (name === 'upsert_app_data_item') {
    if (a.target_key === 'ops_items' && FAIL_ITEM) return { error: { message: 'busy' } }
    WRITES.push({ t: 'item', key: a.target_key, item: a.item })
    const list = DB.app_data[a.target_key] = DB.app_data[a.target_key] || []; const i = list.findIndex((x) => x.id === a.item.id); if (i >= 0) list[i] = a.item; else list.push(a.item)
    return { error: null }
  }
  return { error: { message: 'unexpected rpc ' + name } }
}
globalThis.__fake = { from: table, rpc }
const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 's'.repeat(40), HUB_JOB_SECRET: 'j'.repeat(40) }
let handler; globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h } }
const NET = []
globalThis.fetch = async (url) => { const u = String(url); NET.push(u)
  if (u.startsWith('https://cc.mo-care.com/eligibility-rules.js')) return new Response(RULES)
  throw new Error('unexpected network call ' + u) }
const TMP = fs.mkdtempSync(path.join(FN, '_rlt-')), rw = (t) => t.replace(/^import \{ createClient \} from 'https:\/\/esm\.sh\/[^']+'$/m, 'const createClient = (..._a: any[]) => (globalThis as any).__fake')
fs.mkdirSync(path.join(TMP, '_shared')); fs.mkdirSync(path.join(TMP, 'reference-land'))
for (const f of fs.readdirSync(path.join(FN, '_shared'))) if (/\.(ts|js)$/.test(f)) fs.writeFileSync(path.join(TMP, '_shared', f), rw(fs.readFileSync(path.join(FN, '_shared', f), 'utf8')))
fs.writeFileSync(path.join(TMP, 'reference-land/index.ts'), rw(SRC_FN))
try { await import(path.join(TMP, 'reference-land/index.ts')) } finally { fs.rmSync(TMP, { recursive: true, force: true }) }
const OWNER = { Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY }, CRON = { 'x-cron-secret': env.HUB_JOB_SECRET }
const call = async (body, headers = {}) => { const r = await handler(new Request('http://x/reference-land', { method: 'POST', headers, body: JSON.stringify(body) })); return { status: r.status, j: await r.json() } }
const recordWrites = () => WRITES.filter((w) => w.t === 'door' || w.t === 'reference_requests' || (w.t === 'item' && w.key === 'ops_items'))

reset(); let c = await call({ mode: 'apply' })
ck('a caller with neither the schedule\'s secret nor the server key is refused', c.status === 401 && !WRITES.length && !NET.length)
c = await call({ mode: 'apply' }, CRON)
ck('the switch off: apply answers { ok, off } and changes nothing (no door, no card, no landed mark, no log)', c.status === 200 && c.j.ok === true && c.j.off === true && !WRITES.length && !DOOR_CALLS.length, c.j)
c = await call({}, CRON); ck('no mode: refused, nothing done', c.status === 400 && !WRITES.length)

reset(); const before = clone(DB); c = await call({ mode: 'report' }, OWNER)
const sample = c.j
ck('report mode writes nothing at all (switch off or on)', c.status === 200 && c.j.wrote_nothing && !WRITES.length && !DOOR_CALLS.length && JSON.stringify(DB) === JSON.stringify(before), WRITES)
ck('report counts: 6 answered and not landed seen, 3 would land, 3 skipped', c.j.counts.seen === 6 && c.j.counts.would_land === 3 && c.j.counts.skipped === 3, c.j.counts)
const wl = (id) => c.j.would_land.find((x) => x.request_id === id), sk = (id) => c.j.skipped.find((x) => x.request_id === id)
ck('report lists each landing: name, slot, current status, the score it would set, when they answered, whether a card opens', wl('q1').name === 'Ann Able' && wl('q1').slot === 1 && wl('q1').current_status === 'Pending' && wl('q1').score === 'Positive' && wl('q1').alert === 'none' && !!wl('q1').responded_at
  && wl('q2').score === 'Negative' && wl('q2').alert === 'opens' && wl('q3').score === 'Negative' && wl('q3').alert === 'held_too_old', c.j.would_land)
ck('report lists skipped rows with the reason: not hired, no such person, bad slot', sk('q4').reason === 'not_hired' && sk('q5').reason === 'no_candidate' && sk('q6').reason === 'bad_slot' && !sk('q7') && !sk('q8'), c.j.skipped)
ck('report counts match the lists', c.j.counts.would_land === c.j.would_land.length && c.j.counts.skipped === c.j.skipped.length && c.j.counts.negatives === 2 && c.j.counts.alerts_would_open === 1 && c.j.counts.alerts_held_too_old === 1, c.j.counts)

reset(); APPROVED = false; c = await call({ mode: 'report' }, OWNER)
ck('the rules file not approved by fingerprint: refused, not run, nothing written', c.status === 502 && /not approved/.test(c.j.error) && !WRITES.length, c.j)
reset(); DB.app_data.ops_settings.ref_land_live = true; APPROVED = false; c = await call({ mode: 'apply' }, CRON)
ck('...and in apply with the switch on: refused, no record touched (only the heartbeat says it could not run)', c.status === 502 && !recordWrites().length && WRITES.every((w) => w.t === 'item' && ['automation_heartbeats', 'automation_log'].includes(w.key)), WRITES)

reset(); RULES = RULES_OLD; c = await call({ mode: 'report' }, OWNER)
ck('the Hub still serves the old rules file: report says so in her words and writes nothing', c.status === 200 && c.j.rules_missing_landing && c.j.message === "the Hub's rules file does not have the reference landing yet; merge the Hub pull request and run the report again" && !WRITES.length, c.j)
reset(); RULES = RULES_OLD; DB.app_data.ops_settings.ref_land_live = true; c = await call({ mode: 'apply' }, CRON)
ck('...and apply lands nothing', c.status === 502 && !recordWrites().length, c.j)

reset(); DB.app_data.ops_settings.ref_land_live = true; c = await call({ mode: 'apply' }, CRON)
const A = DB.app_data.candidates.find((x) => x.id === 'c1'), B = DB.app_data.candidates.find((x) => x.id === 'c2'), D = DB.app_data.candidates.find((x) => x.id === 'c4')
ck('apply lands through the door only: one call per landing, only the slot fields', DOOR_CALLS.length === 3 && DOOR_CALLS.every((d) => Object.keys(d.p_patch).every((k) => k.startsWith('r' + d.p_slot))) && DOOR_CALLS[0].p_base_rev === 3 && DOOR_CALLS[0].p_by === 'reference-land', DOOR_CALLS)
ck('...the answer is on the person: name, type, company, the answers record, the status', A.r1n === 'Ref 1' && A.r1_type === 'professional' && A.r1_company === 'Acme Care' && A.r1s === 'Positive' && A.r1_manual.via === 'Online form' && A.r1_manual.recommend === 'yes' && A.r2s === 'Positive' && A._rev === 4, A)
ck('...each landed row is marked landed (merged_at), skipped rows are not', ['q1', 'q2', 'q3'].every((id) => DB.reference_requests.find((r) => r.id === id).merged_at) && ['q4', 'q5', 'q6'].every((id) => !DB.reference_requests.find((r) => r.id === id).merged_at))
const negs = DB.app_data.ops_items.filter((x) => String(x.id).startsWith('ops_negref_'))
ck('a Negative answer opens exactly one card, id ops_negref_<request id>, for today', negs.length === 1 && negs[0].id === 'ops_negref_q2' && negs[0].urgency === 'today' && negs[0].about === 'Bo Bright' && B.r2s === 'Negative', negs)
ck('a Negative answer 20 days old lands on the record but opens no card (held for age)', D.r1s === 'Negative' && !negs.some((x) => x.id === 'ops_negref_q3') && c.j.too_old === 1, c.j)
ck('the run says what it did: seen 6, landed 3, skipped 3, cards 1, held for age 1', c.j.ok && c.j.seen === 6 && c.j.landed === 3 && c.j.skipped === 3 && c.j.alerts === 1 && c.j.too_old === 1, c.j)
const hb = WRITES.find((w) => w.t === 'item' && w.key === 'automation_heartbeats'), lg = WRITES.find((w) => w.t === 'item' && w.key === 'automation_log')
ck('the run is recorded: a heartbeat and one automation log line with seen, landed, skipped, cards, held for age', hb && hb.item.id === 'hb_reference-land' && lg && lg.item.automation === 'reference_land' && lg.item.summary.landed === 3 && lg.item.summary.alerts === 1 && lg.item.summary.too_old === 1 && lg.item.summary.skipped === 3, [hb, lg])
const n1 = WRITES.length; c = await call({ mode: 'apply' }, CRON)
ck('the next run: nothing lands twice, no second card (only the heartbeat)', c.j.landed === 0 && c.j.alerts === 0 && WRITES.slice(n1).every((w) => w.key === 'automation_heartbeats') && DB.app_data.ops_items.filter((x) => x.id === 'ops_negref_q2').length === 1, WRITES.slice(n1))
/* a landed row that could not be marked: the next run lands it again with no change and opens no second card */
DB.reference_requests.find((r) => r.id === 'q2').merged_at = null; DB.app_data.ops_items.find((x) => x.id === 'ops_negref_q2').status = 'done'
const n2 = WRITES.length; c = await call({ mode: 'apply' }, CRON)
ck('a row landed but not marked: landing again changes nothing, and a card the office closed is never reopened or doubled', c.j.landed === 1 && c.j.alerts === 0 && c.j.alerts_already_open === 1 && !WRITES.slice(n2).some((w) => w.t === 'door' || (w.t === 'item' && w.key === 'ops_items')) && DB.app_data.ops_items.find((x) => x.id === 'ops_negref_q2').status === 'done', [c.j, WRITES.slice(n2)])

reset(); DB.app_data.ops_settings.ref_land_live = true; CHANGE_ONCE = true; c = await call({ mode: 'apply' }, CRON)
const A2 = DB.app_data.candidates.find((x) => x.id === 'c1')
ck('somebody saved the person a moment before: the door says changed, the landing is worked out again on the fresh record, their change is kept', DOOR_CALLS[0].p_base_rev === 3 && DOOR_CALLS[1].p_base_rev === 4 && A2.phone === '4175550100' && A2.r1s === 'Positive' && A2._rev === 5, DOOR_CALLS.slice(0, 2))

reset(); DB.app_data.ops_settings.ref_land_live = true; FAIL_ITEM = true; c = await call({ mode: 'apply' }, CRON)
ck('the Negative card could not be saved: the answer is on the record, the row stays unlanded so the card is tried next run, and the run says so', DB.app_data.candidates.find((x) => x.id === 'c2').r2s === 'Negative' && !DB.reference_requests.find((r) => r.id === 'q2').merged_at && c.j.ok === false && /card could not be opened/.test(c.j.errors.join()), c.j)
FAIL_ITEM = false; c = await call({ mode: 'apply' }, CRON)
ck('...and the next run opens it once and marks the row', DB.app_data.ops_items.filter((x) => x.id === 'ops_negref_q2').length === 1 && !!DB.reference_requests.find((r) => r.id === 'q2').merged_at, c.j)

ck('the only network call the job ever made was the rules file on cc.mo-care.com', NET.every((u) => u.startsWith('https://cc.mo-care.com/eligibility-rules.js')), [...new Set(NET)])

/* a batch larger than the limit: only BATCH_LIMIT land, the rest wait for the next run */
reset({ reference_requests: Array.from({ length: SH.BATCH_LIMIT + 7 }, (_, i) => ans({ n: 100 + i, candidate_id: 'c' + (100 + i), slot: 1 })) })
DB.app_data.candidates = Array.from({ length: SH.BATCH_LIMIT + 7 }, (_, i) => ({ id: 'c' + (100 + i), first: 'P', last: String(i) })); DB.app_data.ops_settings.ref_land_live = true
c = await call({ mode: 'apply' }, CRON)
ck('first activation cannot flood: at most ' + SH.BATCH_LIMIT + ' land in one run, the rest wait', c.j.landed === SH.BATCH_LIMIT && c.j.waiting_for_next_run === 7, c.j)

/* the office already recorded a status on that slot: the landing replaces it (as the Hub button does) and the report marks it */
{ const vm = await import('vm'); const ctx = {}; vm.createContext(ctx); vm.runInContext(RULES_NEW, ctx); const E = ctx.CCElig
  const P = SH.plan([ans({ n: 50, candidate_id: 'k1', slot: 1, recommend: 'no' })], [{ id: 'k1', first: 'Kay', last: 'Kept', r1n: 'Office Name', r1s: 'Positive' }], E, new Date())
  ck('a slot the office already marked Positive: the report says the answer would replace it, and the office\'s reference name is kept', P.plans[0].p.replaces_status === true && P.plans[0].p.current_status === 'Positive' && E.refAnswerPatch({ id: 'k1', r1n: 'Office Name' }, { slot: 1, ref_name: 'Other' }).set.r1n === 'Office Name', P.plans[0].p) }

/* ── 4. the door in a real Postgres ── */
if (process.env.PGLITE) {
  const { PGlite } = await import(process.env.PGLITE); const pg = new PGlite()
  const SS = fs.readFileSync(path.join(ROOT, 'safe_saves_2.sql'), 'utf8')
  const revFns = SS.slice(SS.indexOf('create or replace function public.app_data_rev('), SS.indexOf('-- ── 2. numbers are never reused'))
  await pg.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create table public.app_data (key text primary key, data jsonb, updated_at timestamptz default now(), version bigint not null default 0);
    create table public.app_data_item_change (id bigserial primary key, at timestamptz default now(), key text, record_id text, change text, fields_changed text[], bulk_removed boolean, actor text, role text, origin text, names text, error text);
    ${revFns}
    insert into public.app_data (key, data) values ('candidates', '[{"id": "c1", "first": "Ann", "last": "Able", "r1s": "Pending", "r2n": "Old Boss", "r2s": "Positive"}, {"id": "c2", "first": "Bo", "not_hired": true}, {"id": "d", "first": "X"}, {"id": "d", "first": "Y"}]');`)
  await pg.exec(SQL); await pg.exec(SQL)
  const q1 = async (s, a) => (await pg.query(s, a)).rows[0]
  const door = async (id, slot, base, patch) => (await q1('select public.reference_land_apply($1, $2, $3, $4::jsonb) as r', [id, slot, base, JSON.stringify(patch)])).r
  const cand = async (id) => (await q1(`select x from public.app_data, jsonb_array_elements(data) x where key = 'candidates' and x->>'id' = $1 limit 1`, [id])).x
  const patch = { r1n: 'Ref One', r1_manual: { via: 'Online form', recommend: 'yes' }, r1_type: 'professional', r1_company: 'Acme', r1s: 'Positive' }
  let r = await door('c1', 1, 0, patch); let x = await cand('c1')
  ck('door: lands the five slot fields, keeps everything else, and the database sets _rev 1', r.ok && x.r1s === 'Positive' && x.r1n === 'Ref One' && x.r1_manual.via === 'Online form' && x.r2s === 'Positive' && x.first === 'Ann' && Number(x._rev) === 1 && r.rev === 1, [r, x])
  const h = await q1(`select count(*)::int as n, max(origin) as o, max(actor) as a, max(array_to_string(fields_changed, ',')) as f from public.app_data_item_change where record_id = 'c1'`)
  ck('door: one history line tagged reference-land, naming the fields', h.n === 1 && h.o === 'reference-land' && h.a === 'reference-land' && /r1s/.test(h.f), h)
  r = await door('c1', 1, 0, { r1s: 'Negative' }); x = await cand('c1')
  ck('door: a stale _rev saves nothing and hands back the current record', !r.ok && r.reason === 'changed' && r.current_record.r1s === 'Positive' && x.r1s === 'Positive', r)
  const v0 = (await q1(`select version from public.app_data where key = 'candidates'`)).version
  r = await door('c1', 1, 1, patch)
  ck('door: the same answer again changes nothing (no save, no history line)', r.ok && r.unchanged && (await q1(`select version from public.app_data where key = 'candidates'`)).version === v0 && (await q1(`select count(*)::int as n from public.app_data_item_change`)).n === 1, r)
  ck('door: a person not in the list, two people sharing a number, a not-hired person: refused', (await door('nobody', 1, 0, { r1s: 'Positive' })).reason === 'no_candidate' && (await door('d', 1, 0, { r1s: 'Positive' })).reason === 'duplicate_id' && (await door('c2', 1, 0, { r1s: 'Positive' })).reason === 'not_hired')
  const refuses = async (slot, p) => { try { await door('c1', slot, 1, p); return false } catch { return true } }
  ck('door: refuses any other field (the person\'s name, another slot, an SSN), a slot outside 1 to 4, a made-up status, answers that are not a record',
    await refuses(1, { first: 'Hacked' }) && await refuses(1, { r2s: 'Positive' }) && await refuses(1, { ssn: '1' }) && await refuses(5, { r5s: 'Positive' }) && await refuses(1, { r1s: 'Great' }) && await refuses(1, { r1_manual: 'x' }) && (await cand('c1')).first === 'Ann')
  const pv = await q1(`select has_function_privilege('anon', 'public.reference_land_apply(text, int, bigint, jsonb, text)', 'execute') as a, has_function_privilege('authenticated', 'public.reference_land_apply(text, int, bigint, jsonb, text)', 'execute') as b, has_function_privilege('service_role', 'public.reference_land_apply(text, int, bigint, jsonb, text)', 'execute') as c`)
  ck('door: only the server may call it (not anon, not a signed-in page)', pv.a === false && pv.b === false && pv.c === true, pv)
} else console.log('SKIP  the door in a real Postgres (set PGLITE)')

if (process.env.DUMP_REPORT) fs.writeFileSync(process.env.DUMP_REPORT, JSON.stringify(sample, null, 2))
const bad = res.filter((x) => !x[1]); for (const [n, ok, note] of res) console.log((ok ? 'ok    ' : 'FAIL  ') + n + (ok ? '' : '  ' + note))
console.log(`${res.length - bad.length}/${res.length} passed`); if (bad.length) process.exit(1)
