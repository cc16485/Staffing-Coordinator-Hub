// 443 · the start form check (_shared/intake-import.ts + intake-import/index.ts) against a fake database, with the REAL
// rules file from the Hub (CG_INTAKE, else ../cc-hub-live/intake-import-rules.js). The database writer is proven on a
// real Postgres in intake_import_sql_test.py. node intake_import_test.mjs
import fs from 'fs'; import path from 'path'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions')
const RULES = fs.readFileSync(process.env.CG_INTAKE || path.join(ROOT, '..', 'cc-hub-live', 'intake-import-rules.js'), 'utf8')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? '').slice(0, 700)])
globalThis.Deno = { env: { get: () => '' } }
const J = await import(path.join(FN, '_shared/intake-import.ts'))
const clone = (x) => JSON.parse(JSON.stringify(x))
function fakeDb(init) {
  const t = { app_data: clone(init.app_data), hire_intake: clone(init.forms || []), intake_import_log: [], intake_import_runs: clone(init.runs || []),
    domains: [{ code: 'caregivers', entity: 'cc_ihs', owner_person: 'p1' }], persons: [{ person_id: 'p1', primary_email: 'angiel@mo-care.com' }] }
  const calls = []
  function q(table) {
    const f = []; let upd = null, ord = null, lim = null, cols = null
    const rows = () => { let r = t[table].filter((x) => f.every((g) => g(x))); if (ord) r = r.slice().sort((a, b) => (ord.asc ? 1 : -1) * String(a[ord.k]).localeCompare(String(b[ord.k]))); if (lim != null) r = r.slice(0, lim); return r }
    const b = {
      select(c) { cols = c; return b }, eq(k, v) { f.push((x) => String(x[k]) === String(v)); return b }, in(k, vs) { f.push((x) => vs.includes(x[k])); return b },
      gte(k, v) { f.push((x) => String(x[k]) >= String(v)); return b }, is(k, v) { f.push((x) => (x[k] ?? null) === v); return b },
      order(k, o) { ord = { k, asc: !!o?.ascending }; return b }, limit(n) { lim = n; return b },
      update(u) { upd = u; return b },
      async maybeSingle() { return { data: rows()[0] ?? null, error: null } },
      async insert(row) { t[table].push({ at: new Date().toISOString(), ...row }); return { error: null } },
      then(ok, ko) {
        if (init.fail?.[table]) return Promise.resolve({ data: null, error: { message: 'down' } }).then(ok, ko)
        if (upd) { const r = rows(); r.forEach((x) => Object.assign(x, upd)); calls.push(['update', table, upd, r.length]); return Promise.resolve({ error: null }).then(ok, ko) }
        if (table === 'hire_intake' && cols) calls.push(['select', table, cols])
        return Promise.resolve({ data: rows(), error: null }).then(ok, ko) },
    }
    return b
  }
  return { t, calls, from: (x) => q(x),
    async rpc(name, a) { calls.push([name, clone(a)])
      if (name === 'upsert_app_data_item') { const row = t.app_data.find((r) => r.key === 'ops_items'); const i = row.data.findIndex((x) => x.id === a.item.id); if (i >= 0) row.data[i] = a.item; else row.data.push(a.item); return { error: null } }
      if (name === 'intake_import_practice') { t.intake_import_log = t.intake_import_log.filter((x) => x.result !== 'would'); a.p_rows.forEach((r) => t.intake_import_log.push({ ...r, result: 'would' })); return { data: a.p_rows.length, error: null } }
      if (name === 'candidate_import_apply') { const cd = t.app_data.find((r) => r.key === 'candidates'); const id = 100 + cd.data.length; cd.data.push({ ...a.p_record, id })
        const fm = t.hire_intake.find((x) => String(x.id) === a.p_intake_id); Object.assign(fm, { seen_at: 'now', auto_import_at: 'now', auto_import_result: 'imported' }); return { data: { ok: true, candidate_id: id }, error: null } }
      return { error: { message: 'unknown ' + name } } } }
}
const FROM = '2026-10-04T06:00:00.000Z'
const form = (id, x) => ({ id, first_name: 'F' + id, last_name: 'Last', phone: '', email: '', lived_outside_mo: false, refs: [], created_at: '2026-10-04T07:00:00Z', seen_at: null, auto_import_at: null, ssn: '123456789', ...x })
const world = (live, extra = {}) => ({
  app_data: [{ key: 'ops_settings', data: { intake_auto_import_from: FROM, ...(live ? { intake_auto_import_live: true } : {}) } },
    { key: 'candidates', data: [{ id: 1, first: 'Old', last: 'Cand', email: 'cand@x.com' }, { id: 2, first: 'Nope', last: 'P', phone: '4175550122', not_hired: true }] },
    { key: 'caregivers', data: [{ id: 20, first: 'Hired', last: 'A', phone: '4175550133' }] },
    { key: 'ops_items', data: [] }],
  forms: [form('a', { phone: '417-555-0199' }), form('b', { email: 'CAND@x.com' }), form('c', { phone: '4175550133' }), form('d', { phone: '4175550122' }),
    form('e', { phone: '4175550777' }), form('f'), form('old', { phone: '4175550199', created_at: '2026-10-01T00:00:00Z' }), form('seen', { phone: '4175550199', seen_at: 'x' })],
  ...extra })
const deps = (over = {}) => ({ rules: async () => ({ ok: true, I: J.rulesFrom(RULES) }), offers: async () => ({ ok: true, rows: [{ id: 'o1', phone: '+1 417 555 0199' }] }), ...over })
const NOW = new Date('2026-10-04T08:00:00Z')

ck('the Hub rules file runs in its own scope on the server', typeof J.rulesFrom(RULES).decide === 'function' && globalThis.CCIntake === undefined)
// practice
let db = fakeDb(world(false)), r = await J.runJob(db, deps(), { caller: 'cron', runId: 'r1', now: NOW })
const would = db.t.intake_import_log.filter((x) => x.result === 'would')
ck('practice: only new forms since it was installed, not seen yet (old and already-seen left alone)', r.ok && r.mode === 'practice' && r.seen === 6 && !would.some((w) => ['old', 'seen'].includes(w.intake_id)), r)
ck('practice: what it WOULD do for each of her cases', JSON.stringify(would.map((w) => [w.intake_id, w.action, w.reason])) === JSON.stringify([['a', 'import', 'new'], ['b', 'card', 'in_bgr'], ['c', 'card', 'roster'], ['d', 'card', 'not_hired'], ['e', 'card', 'no_offer'], ['f', 'card', 'no_contact']]), would)
ck('practice changes nothing: no candidate, no card, no form marked', !db.calls.some((c) => ['candidate_import_apply', 'upsert_app_data_item', 'update'].includes(c[0])), db.calls.map((c) => c[0]))
ck('the SSN is never asked for', db.calls.filter((c) => c[0] === 'select' && c[1] === 'hire_intake').every((c) => !/ssn/.test(c[2])) && !/ssn/.test(J.INTAKE_COLS))
ck('the practice list shows first name and last initial only', would.every((w) => /^F\w+ L$/.test(w.who)), would.map((w) => w.who))
// dry
db = fakeDb(world(false)); r = await J.runJob(db, deps(), { caller: 'owner', runId: 'r', dry: true, now: NOW })
ck('dry: counts only, records nothing', r.dry && r.imported === 1 && r.cards === 5 && !db.calls.some((c) => c[0] !== 'select') && !db.t.intake_import_runs.length, [r, db.calls])
// live
db = fakeDb(world(true)); r = await J.runJob(db, deps(), { caller: 'cron', runId: 'r2', now: NOW })
const ap = db.calls.filter((c) => c[0] === 'candidate_import_apply').map((c) => c[1])
ck('live: the new person with a job offer is imported through the one writer', r.ok && r.imported === 1 && ap.length === 1 && ap[0].p_intake_id === 'a' && ap[0].p_record.intake_id === 'a' && ap[0].p_record.phone === '417-555-0199', [r, ap])
ck('...as the Import button\'s candidate, noted as imported automatically', ap[0].p_record.oig === 'Pending' && /Imported automatically from their start form/.test(ap[0].p_record.notes) && ap[0].p_record.imported_by === 'start form check' && !('ssn' in ap[0].p_record), ap[0].p_record)
const cards = db.t.app_data.find((x) => x.key === 'ops_items').data
ck('live: one Needs Attention card for each of the other five, owned by the caregivers owner', r.cards === 5 && cards.length === 5 && cards.every((c) => c.kind === 'intake_card' && c.domain === 'caregivers' && c.owner === 'angiel@mo-care.com' && c.title && c.detail && c.next_action), cards.map((c) => c.id))
ck('...with her words (already in B&R: nothing changed; not hired: not added back; no offer: public page)', /already in Background & References/.test(cards.find((c) => c.intake_id === 'b').title) && /not added back/.test(cards.find((c) => c.intake_id === 'd').detail) && /public/.test(cards.find((c) => c.intake_id === 'e').detail), cards)
const fm = (id) => db.t.hire_intake.find((x) => x.id === id)
ck('...the existing people are not changed at all', JSON.stringify(db.t.app_data.find((x) => x.key === 'candidates').data.slice(0, 2)) === JSON.stringify(world(true).app_data[1].data) && JSON.stringify(db.t.app_data.find((x) => x.key === 'caregivers').data) === JSON.stringify(world(true).app_data[2].data))
ck('...each carded form is noted (so it is not carded again) but stays on the Import list (not seen)', fm('b').auto_import_result === 'card:in_bgr' && fm('b').seen_at === null && fm('e').auto_import_result === 'card:no_offer')
r = await J.runJob(db, deps(), { caller: 'cron', runId: 'r3', now: NOW })
ck('the next run: nothing new, nothing doubled', r.seen === 0 && db.t.app_data.find((x) => x.key === 'ops_items').data.length === 5 && db.calls.filter((c) => c[0] === 'candidate_import_apply').length === 1, r)
// a private start link (2026-10-04): a form that came through a valid link counts as "we sent them a start link"
{
  const W = world(false, { forms: [form('g', { phone: '4175550888', start_offer_id: 'o9', start_link_exp: 1999999999, start_link_sig: 'A'.repeat(43) }), form('h', { phone: '4175550889', start_offer_id: 'o9', start_link_exp: 1, start_link_sig: 'bad' })] })
  const d1 = fakeDb(W)
  await J.runJob(d1, deps({ linkOk: async (f) => f.id === 'g' }), { caller: 'cron', runId: 'L', now: NOW })
  const w = d1.t.intake_import_log.filter((x) => x.result === 'would')
  ck('a form from a valid private start link: imported even though its phone matches no job offer', w.find((x) => x.intake_id === 'g')?.action === 'import', w)
  ck('...a form whose link does not check out: still a "no job offer" card', w.find((x) => x.intake_id === 'h')?.reason === 'no_offer', w)
}
// failures
for (const [label, d2, want] of [['the job offers can\'t be read', deps({ offers: async () => ({ ok: false, error: 'the Training Platform answered 503' }) }), /job offers could not be read/],
  ['the rules aren\'t approved', deps({ rules: async () => ({ ok: false, error: 'rules file not approved: intake-import-rules.js' }) }), /not approved/]]) {
  db = fakeDb(world(true)); r = await J.runJob(db, d2, { caller: 'cron', runId: 'f', now: NOW })
  ck(label + ': nothing is imported, carded or marked, and the run says why', !r.ok && want.test(r.error) && !db.calls.some((c) => ['candidate_import_apply', 'upsert_app_data_item', 'update'].includes(c[0])) && db.t.intake_import_runs[0].ok === false, r)
}
db = fakeDb(world(true, { app_data: world(true).app_data.map((x) => x.key === 'ops_settings' ? { key: 'ops_settings', data: { intake_auto_import_live: true } } : x) }))
r = await J.runJob(db, deps(), { caller: 'cron', runId: 'f', now: NOW })
ck('no start date set: it looks at nothing (never the old forms)', !r.ok && /no start date/.test(r.error) && !db.calls.some((c) => c[0] === 'select'), r)
db = fakeDb(world(true, { runs: [{ caller: 'cron', ok: false, at: '1' }, { caller: 'cron', ok: false, at: '2' }] }))
await J.runJob(db, deps({ offers: async () => ({ ok: false, error: 'x' }) }), { caller: 'cron', runId: 'f3', now: NOW })
ck('3 scheduled runs in a row that could not run: one Needs Attention card', db.t.app_data.find((x) => x.key === 'ops_items').data.some((c) => c.id === J.FAILING_ID && /could not run 3 times in a row/.test(c.detail)))
const IX = fs.readFileSync(path.join(FN, 'intake-import/index.ts'), 'utf8'), SH = fs.readFileSync(path.join(FN, '_shared/intake-import.ts'), 'utf8')
ck('index: only its schedule or the owner; ?dry=1 the owner\'s only', /const caller = await jobCaller\(req\)\s*\n\s*if \(!caller\) return json/.test(IX) && /if \(dry && caller !== 'owner'\)/.test(IX))
ck('index: the rules are the approved Hub file only; offers through the existing server-only connection', /approvedRules\(db, RULES_FILE\)/.test(IX) && /OFFERS_PROJECT_URL/.test(IX) && /select=id,email,phone/.test(IX))
ck('sends nothing (no texting, email or reference request anywhere in it)', !/ghl|sendSms|reference-chase|createRefRequests|resend|leadconnector/i.test(IX + SH))
ck('no em dash', !/—/.test(IX + SH))
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '\n     ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
