// ONBOARDING RULE FIXES 1031 (Samantha approved the onboarding design 2026-10-21). PGLITE=<path> HUB_ROOT=<hub checkout> node onboarding_1031_test.mjs
//   no fingerprints · the server's reference rule = the Hub's refPolicy · dementia optional · Approve to Advance by itself
//   (switch) · the OIG search on arrival (switch, evidence only) · the welcome call waits for Step 2 CHECKED · Case.net reviews
import fs from 'fs'; import path from 'path'; import vm from 'vm'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 600)])
const J = await import(path.join(process.cwd(), 'supabase/functions/_shared/caregiver-journey.ts'))
const A = await import(path.join(process.cwd(), 'supabase/functions/_shared/onboarding-auto.ts'))
const BG = await import(path.join(process.cwd(), 'supabase/functions/_shared/bg-review.ts'))
const T = await import(path.join(process.cwd(), 'supabase/functions/_shared/team-onboarding.ts'))
const src = (p) => fs.readFileSync(p, 'utf8')

/* 1. the reference rule, the same as the Hub's, on the same records */
const FIX = [
  {}, { r1s: 'Positive' }, { r1s: 'Positive', r2s: 'Positive' },
  { r1s: 'Positive', r2s: 'Positive', r1_type: 'professional' }, { r1s: 'Positive', r2s: 'Positive', r2_type: 'Professional ' },
  { r1s: 'Positive', r2s: 'Positive', r1_manual: { type: 'professional' } }, { r1s: 'Positive', r2s: 'Positive', r1_type: 'personal', r1_manual: { type: 'professional' } },
  { r1s: 'Positive', r2s: 'Positive', r3s: 'Negative', r1_type: 'professional' }, { r1s: 'Positive', r2s: 'Positive', r3s: 'Conditional', r1_type: 'professional' },
  { r1s: 'Positive', r2s: 'Positive', r3s: 'Conditional', r1_type: 'professional', ref_decision: { outcome: 'proceed', refs: 'Positive|Positive|Conditional|' } },
  { r1s: 'Positive', r2s: 'Positive', r3s: 'Conditional', r4s: 'Positive', r1_type: 'professional', ref_decision: { outcome: 'proceed', refs: 'Positive|Positive|Conditional|' } },
  { r1s: 'Pending', r2s: 'Positive', r3s: 'Positive', r3_type: 'professional' }, { r1s: 'Positive', r2s: 'Positive', r3s: 'Positive', r3_type: 'professional', r3s_: 1 },
]
const hubRoot = process.env.HUB_ROOT
if (hubRoot && fs.existsSync(path.join(hubRoot, 'eligibility-rules.js'))) {
  const ctx = { console, Date, JSON, Math, String, Number, Array, Object }; ctx.globalThis = ctx; vm.createContext(ctx)
  vm.runInContext(src(path.join(hubRoot, 'eligibility-rules.js')), ctx)
  const E = ctx.CCElig
  const diff = FIX.map((c) => [c, E.refPolicy(c), J.refPolicyOf(c)]).filter(([, h, s]) => h.ok !== s.ok || h.blocked !== s.blocked || h.why !== s.why)
  ck('the server reference rule gives the Hub refPolicy answer, word for word, on ' + FIX.length + ' records', E && !diff.length, diff.slice(0, 2))
} else ck('HUB_ROOT is set to a Hub checkout (the parity check needs eligibility-rules.js)', false, hubRoot)

/* 2. verifyRows */
const base = { offer: null, step1: null, candidate: { oig: 'CLEAR', oig_date: '2026-10-20', oig_proof: 'x', oos: 'yes', fp: 'Clear', fp_date: '2026-10-20', fp_proof: 'y', r1n: 'A', r2n: 'B', r1s: 'Positive', r2s: 'Positive', r1_manual: { type: 'professional' } } }
let v = J.verifyRows(base)
ck('no fingerprint row is ever verified, even with a recorded Clear (retired 2026-10-21)', !v.some((x) => x.key === 'cg.check.fingerprints'))
ck('two Positive, one from work by the answers’ type: references cleared', v.some((x) => x.key === 'cg.refs.cleared' && x.state === 'complete'))
v = J.verifyRows({ ...base, candidate: { ...base.candidate, r3n: 'C', r3s: 'Negative' } })
ck('a Negative reference: references BLOCKED with the Hub’s words (it used to read cleared)', v.some((x) => x.key === 'cg.refs.cleared' && x.state === 'blocked' && /Negative/.test(x.reason)), v.filter((x) => x.key === 'cg.refs.cleared'))
v = J.verifyRows({ ...base, candidate: { ...base.candidate, r1_manual: null, r1_type: 'personal' } })
ck('two Positive but none from work: not cleared, not blocked', !v.some((x) => x.key === 'cg.refs.cleared'))

/* 3. Approve to Advance by itself */
const dfs = [{ key: 'cg.approve.advance', after: ['cg.check.oig', 'cg.check.edl', 'cg.check.fcsr', 'cg.check.casenet', 'cg.refs.cleared'] }]
const row = (key, state, status) => ({ key, st: state ? { state, completed_at: '2026-10-21T15:00:00Z' } : null, status: status || (state === 'complete' ? 'done' : 'ready') })
const all = ['cg.check.oig', 'cg.check.edl', 'cg.check.fcsr', 'cg.check.casenet', 'cg.refs.cleared'].map((k) => row(k, 'complete'))
let d = A.advanceDue({ rows: [...all, row('cg.approve.advance', null)] }, dfs)
ck('everything in front done, nothing blocked: due, with each row as evidence', d.due && d.evidence.length === 5)
d = A.advanceDue({ rows: [...all.slice(0, 4), row('cg.refs.cleared', null), row('cg.approve.advance', null)] }, dfs)
ck('references not cleared yet: not due, and it says which row', !d.due && d.waiting.join() === 'cg.refs.cleared')
d = A.advanceDue({ rows: [...all, row('cg.check.x', 'blocked', 'blocked'), row('cg.approve.advance', null)] }, dfs)
ck('anything blocked on the card (a flagged check, a Negative): left for the owners', !d.due && d.blocked.length === 1)
d = A.advanceDue({ rows: [...all, row('cg.approve.advance', 'complete')] }, dfs)
ck('already approved: nothing to do', !d.due)

/* 4. the OIG search on arrival */
const c0 = { id: 12, first: 'Ann', last: 'Lee', onboarding_path: 'new', oig: 'Pending' }
ck('new path, nothing recorded, no earlier search: run it', A.oigWanted(c0, null, true) && A.oigWanted(c0, null, false))
ck('a person already recorded OIG (CLEAR, FLAGGED or a date): never', !A.oigWanted({ ...c0, oig: 'CLEAR' }, null, true) && !A.oigWanted({ ...c0, oig_date: '2026-10-21' }, null, true))
ck('the old path and Not hired: never', !A.oigWanted({ ...c0, onboarding_path: 'old' }, null, true) && !A.oigWanted({ ...c0, not_hired: true }, null, true))
ck('already searched for real: never twice; practice recorded it: live runs it once', !A.oigWanted(c0, { practice: false }, true) && A.oigWanted(c0, { practice: true }, true) && !A.oigWanted(c0, { practice: true }, false))
const sw = src('supabase/functions/caregiver-journey/index.ts')
ck('the sweep: both switches default off (=== true), practice records one event / one would-search item', /approve_advance_auto_live === true/.test(sw) && /oig_auto_search_live === true/.test(sw) && /auto_advance_practice/.test(sw) && /practice: true, would_search/.test(sw))
ck('the OIG result is evidence only: the sweep never writes oig CLEAR on a Background & References row', !/oig: 'CLEAR'[^\n]*oig_auto_search/.test(sw) && /target_key: 'oig_auto_search'/.test(sw))
ck('a name match raises the review card, never a verdict', /oig_match_c' \+ c\.id/.test(sw) && /A name match is not a verdict/.test(sw))
ck('retired rows: the code drops fingerprints and makes dementia optional even before the SQL runs', /RETIRED = new Set\(\['cg\.check\.fingerprints'\]\)/.test(sw) && /cg\.training\.dementia'\) x\.required = false/.test(sw))

/* 5. dementia optional in Team Builder's words; Step 1 lands no fingerprint flag */
ck('Team Builder: orientation done = Ready, waiting on Approve to Work (no dementia course needed)', T.tbStage({ step1_done: true, orientation_done: true, dementia_done: false, approved: false }).key === 'ready')
ck('Step 1: living outside Missouri never sets fingerprints Required', !/p\.fp = 'Required'/.test(src('supabase/functions/step1-sign/index.ts')))
ck('the references report: checks clear means OIG, EDL, FCSR and Case.net, never fingerprints', /c\.casenet === 'Clear'/.test(src('supabase/functions/references-run/index.ts')) && !/c\.fp === 'Clear'/.test(src('supabase/functions/references-run/index.ts')))

/* 6. the welcome call waits for Step 2 CHECKED; Case.net reviews */
const wc = src('supabase/functions/welcome-call/index.ts')
ck('welcome call invite: on the new path it needs step2_verified_at, fails closed when the list cannot be read', /step2Verified\(cand\)/.test(wc) && /return !!hit\.step2_verified_at/.test(wc) && /could not confirm their Step 2/.test(wc))
ck('background review: Case.net is a check; Can\u2019t be employed sends our decision notice, which never names the court record; fingerprints refused for new reviews', BG.isCheck('casenet') && BG.CHECKS.casenet.flagged.includes('Issues Found') && BG.variantFor('casenet', 'cannot_employ') === 'decision' && !/court|Case\.net/i.test(BG.finalWords('Ann', 'casenet', 'decision', false).html + BG.finalWords('Ann', 'casenet', 'decision', false).text) && /Fingerprints are no longer one of our checks/.test(src('supabase/functions/bg-review/index.ts')))

/* 7. the SQL in a real Postgres */
const sq = src('supabase/onboarding-1031.sql'), rb = src('supabase/onboarding-1031-rollback.sql')
ck('no em dash in the SQL or any new message', ![sq, rb, src('supabase/functions/_shared/onboarding-auto.ts')].some((t) => /—/.test(t)))
if (process.env.PGLITE) {
  const { PGlite } = await import(process.env.PGLITE); const db = new PGlite()
  await db.exec(`create table public.client_journey_step_def (key text primary key, catalog_version int not null default 1, def jsonb not null, active boolean not null default true, updated_at timestamptz default now(), updated_by text);
    insert into public.client_journey_step_def (key, def, active) values
      ('cg.check.fingerprints', '{"active": true, "applies": {"lived_outside_mo": true}}', true),
      ('cg.training.dementia', '{"required": true, "after": ["cg.training.orientation"]}', true),
      ('cg.approve.advance', '{"after": ["cg.check.oig", "cg.check.edl", "cg.check.fcsr", "cg.refs.cleared", "cg.check.casenet"]}', true),
      ('cg.approve.work', '{"after": ["cg.step2.i9_s1", "cg.training.orientation", "cg.training.dementia", "cg.check.oig", "cg.check.casenet"]}', true);
    create table public.app_data_key_hub_map (data_key text, hub_slug text, primary key (data_key, hub_slug));
    create table public.bg_reviews (id serial primary key, candidate_id text, check_key text not null check (check_key in ('fcsr', 'edl', 'oig', 'fp')), status text);`)
  await db.exec(sq); await db.exec(sq)
  const q = async (k) => (await db.query(`select active, def from public.client_journey_step_def where key = $1`, [k])).rows[0]
  ck('fingerprints row off; dementia optional; Approve to Work no longer waits for dementia; both approvals still wait for Case.net (ran twice)', (await q('cg.check.fingerprints')).active === false && (await q('cg.training.dementia')).def.required === false
    && !(await q('cg.approve.work')).def.after.includes('cg.training.dementia') && (await q('cg.approve.work')).def.after.filter((x) => x === 'cg.check.casenet').length === 1 && (await q('cg.approve.advance')).def.after.includes('cg.check.casenet'))
  let ok = true; try { await db.exec(`insert into public.bg_reviews (candidate_id, check_key, status) values ('7', 'casenet', 'open')`) } catch { ok = false }
  ck('a Case.net review can be opened; the Hub may read oig_auto_search', ok && (await db.query(`select 1 from public.app_data_key_hub_map where data_key = 'oig_auto_search'`)).rows.length === 1)
  await db.exec(rb)
  ck('rollback: fingerprints back on, dementia required and back in front of Approve to Work', (await q('cg.check.fingerprints')).active === true && (await q('cg.training.dementia')).def.required === true && (await q('cg.approve.work')).def.after.includes('cg.training.dementia'))
} else ck('PGLITE is set (the SQL runs in a real Postgres)', false)

for (const [n, o, note] of res) console.log((o ? 'PASS  ' : 'FAIL  ') + n + (o ? '' : '  ' + note))
const bad = res.filter((x) => !x[1]).length; console.log(`${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0)
