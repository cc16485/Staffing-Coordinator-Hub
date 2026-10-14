// 708 LPN HIRING (Samantha approved the LPN nurse visit plan, 2026-10-14): the shared pieces. (1) every caregiver Step 1 form,
// screen list and count is byte-identical to the reviewed base (LPN_BASE); (2) the position key helper and the one "offer signed"
// rule, the same on the Hub page; (3) the nurse checks (license, orientation, Section 2), the nurse list record and the training
// waiver words; (4) the Hub project database change on a real Postgres (PGlite), and its rollback. No network.
// PGLITE=<pglite dist/index.js> [HUB_ROOT=<care-coordinator-hub checkout>] node lpn_hiring_708_test.mjs
import fs from 'fs'; import path from 'path'; import vm from 'vm'; import { execFileSync } from 'child_process'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 600)])
const LPN_BASE = process.env.LPN_BASE || '7fcf815c2d26aa84c7c34841ecb290713a11cad0'
const D = await import(path.join(FN, '_shared/step1-documents.ts'))
const P = await import(path.join(FN, '_shared/positions.ts'))
const N = await import(path.join(FN, '_shared/nurse-hire.ts'))
/* ═══ 1. the caregiver Step 1, byte for byte ═══ */
const bdir = fs.mkdtempSync(path.join(ROOT, '.lpn708-base-'))
let B; try { for (const f of ['step1-documents.ts', 'hepb-appendix-a.ts']) fs.writeFileSync(path.join(bdir, f), execFileSync('git', ['-C', ROOT, 'show', LPN_BASE + ':supabase/functions/_shared/' + f])); B = await import(path.join(bdir, 'step1-documents.ts')) } finally { fs.rmSync(bdir, { recursive: true, force: true }) }
let same = true, diff = []
for (const k of B.FORM_ORDER) { if (D.formText(k) !== B.formText(k) || await D.formFingerprint(k) !== await B.formFingerprint(k) || JSON.stringify(D.FORMS[k]) !== JSON.stringify(B.FORMS[k])) { same = false; diff.push(k) } }
ck(`every one of the ${B.FORM_ORDER.length} caregiver Step 1 forms is byte-identical to the base (wording, fingerprint, definition)`, same && B.FORM_ORDER.length === 14, diff)
ck('the form order is the base order with ONE form added at the end (the nursing license, gated to nurses)', JSON.stringify(D.FORM_ORDER.slice(0, -1)) === JSON.stringify(B.FORM_ORDER) && D.FORM_ORDER.at(-1) === 'nurse_license' && D.FORMS.nurse_license.step1Gate === 'nurse')
ck('APPROVED_FOR_REAL is exactly the base (the new form is not in it)', JSON.stringify(D.APPROVED_FOR_REAL) === JSON.stringify(B.APPROVED_FOR_REAL) && !D.approvedForReal('nurse_license'))
const CTX = [{}, { hepb: true }, { hepb: false }]
const ANS = [{}, { transport_willing: 'yes' }, { transport_willing: 'no' }]
let same2 = true; const d2 = []
for (const c of CTX) {
  for (const [n, a, b] of [['formsInPlay', D.formsInPlay(c), B.formsInPlay(c)], ['step1Screens', D.step1Screens(c), B.step1Screens(c)], ['allApprovedForReal', D.allApprovedForReal(c), B.allApprovedForReal(c)]]) if (JSON.stringify(a) !== JSON.stringify(b)) { same2 = false; d2.push(n + JSON.stringify(c)) }
  for (const a of ANS) for (const [n, x, y] of [['applicableForms', D.applicableForms(a, c), B.applicableForms(a, c)], ['formCount', D.formCount(a, c), B.formCount(a, c)], ['formsToList', D.formsToList(a, c), B.formsToList(a, c)]]) if (JSON.stringify(x) !== JSON.stringify(y)) { same2 = false; d2.push(n + JSON.stringify([a, c])) }
  for (const k of B.FORM_ORDER) for (const a of ANS) if (D.formApplies(k, a, c) !== B.formApplies(k, a, c)) { same2 = false; d2.push('formApplies ' + k) }
}
ck('for a caregiver Step 1 (with or without the Hepatitis B form), the forms in play, the screens, the counts, which forms apply and the practice note are identical to the base', same2, d2)
ck('step1Ctx: a row without nurse_form (or false) reads exactly as before', JSON.stringify(D.step1Ctx({ hepb_form: true })) === JSON.stringify(B.step1Ctx({ hepb_form: true })) && JSON.stringify(D.step1Ctx({ hepb_form: false, nurse_form: false })) === JSON.stringify(B.step1Ctx({ hepb_form: false })) && JSON.stringify(D.step1Ctx(null)) === JSON.stringify(B.step1Ctx(null)))
ck('a nurse Step 1: 15 forms in play, screens end 16, 17, 9; 14 to sign; never fully approved for real until she approves', D.formsInPlay({ hepb: true, nurse: true }).length === 15 && D.step1Screens({ hepb: true, nurse: true }).slice(-3).join() === '16,17,9' && D.formCount({ transport_willing: 'no' }, { hepb: true, nurse: true }) === 14 && !D.allApprovedForReal({ hepb: true, nurse: true }))
ck('nurseFormAtStart: only for an LPN or RN key (never a caregiver, CNA, coordinator, office or an offer from before)', D.nurseFormAtStart('lpn') && D.nurseFormAtStart('rn') && !D.nurseFormAtStart('caregiver') && !D.nurseFormAtStart('cna') && !D.nurseFormAtStart('care_coordinator') && !D.nurseFormAtStart(null) && !D.nurseFormAtStart('LPN text'))
const nf = D.formText('nurse_license')
ck('the nursing license form: proposed version 1, no em dash, never "plain language", "skin assessment" never appears', D.FORMS.nurse_license.version === 1 && D.FORMS.nurse_license.status === 'proposed' && !/—/.test(nf) && !/plain (language|english)/i.test(nf) && !/skin assessment/i.test(nf))
/* ═══ 2. the position key and the one signed rule ═══ */
const SAMPLES = { 'Caregiver': 'caregiver', 'CNA': 'cna', 'Certified Nursing Assistant': 'cna', 'LPN': 'lpn', 'L.P.N.': 'lpn', 'Licensed Practical Nurse': 'lpn', 'RN': 'rn', 'Registered Nurse': 'rn', 'Care Coordinator': 'care_coordinator', 'Office': null, '': null, 'PRN CNA Team': 'cna', 'Turner': null }
ck('positionKeyOf maps the Hub\'s position words', Object.entries(SAMPLES).every(([t, k]) => P.positionKeyOf(t) === k), Object.entries(SAMPLES).map(([t]) => [t, P.positionKeyOf(t)]))
ck('the one signed rule: identical to the old rule for every offer without an LPN or RN key', [{}, { offer_signed_at: 'a' }, { pd_signed_at: 'b' }, { offer_signed_at: 'a', pd_signed_at: 'b' }].every((o) => ['caregiver', 'cna', 'care_coordinator', null, undefined, 'junk'].every((k) => P.offerSigned({ ...o, position_key: k }) === !!(o.offer_signed_at && o.pd_signed_at))))
ck('an LPN or RN offer is signed with the letter alone', P.offerSigned({ offer_signed_at: 'a', position_key: 'lpn' }) && P.offerSigned({ offer_signed_at: 'a', position_key: 'rn' }) && !P.offerSigned({ position_key: 'rn' }))
if (process.env.HUB_ROOT && fs.existsSync(path.join(process.env.HUB_ROOT, 'nurse-hire.js'))) {
  const ctx = { window: {}, console }; vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(process.env.HUB_ROOT, 'nurse-hire.js'), 'utf8'), ctx)
  const H = ctx.window.CCPositions, words = [...Object.keys(SAMPLES), 'Licensed Vocational Nurse', 'C.N.A.', 'care_coordinator', 'Home Care Aide', 'Nurse', 'Learning']
  ck('the Hub page (nurse-hire.js) reads every position word exactly like the server', words.every((w) => H.keyOf(w) === P.positionKeyOf(w)), words.map((w) => [w, H.keyOf(w), P.positionKeyOf(w)]))
  ck('the Hub page\'s signed rule is the server\'s', [{ offer_signed_at: 'a' }, { offer_signed_at: 'a', pd_signed_at: 'b' }, { offer_signed_at: 'a', position_key: 'lpn' }, { offer_signed_at: 'a', position_key: 'cna' }, {}].every((o) => H.offerSigned(o) === P.offerSigned(o)))
}
/* ═══ 3. the nurse checks ═══ */
const OID = '22222222-2222-4333-8444-000000000708', doc = 'nurse/' + OID + '/nursys-1760000000000.pdf', by = { email: 'k@x', name: 'Krystal' }
const ok = { license_type: 'LPN', result: 'active', discipline: false, state: 'MO', multistate: false, expires: '2028-05-31', checked_on: '2026-10-14', document: doc }
const lv = (b, pk = 'lpn') => N.licenseVerdict({ ...ok, ...b }, { offerId: OID, positionKey: pk, today: '2026-10-14', last4: '6813', by })
ck('license: a clean active LPN license completes, with every field of the record', lv({}).state === 'complete' && lv({}).evidence.license_last4 === '6813' && lv({}).evidence.source.includes('Nursys'))
ck('license: not active, not found, discipline, expired, or the wrong type BLOCKS (recorded, never waved through)', ['not_active', 'not_found'].every((x) => lv({ result: x }).state === 'blocked') && lv({ discipline: true }).state === 'blocked' && lv({ expires: '2026-10-13' }).state === 'blocked' && lv({ license_type: 'RN' }).state === 'blocked' && lv({ license_type: 'LPN' }, 'rn').state === 'blocked')
ck('license: missing pieces are refused (nothing saved)', !lv({ checked_on: '' }).ok && !lv({ checked_on: '2026-10-15' }).ok && !lv({ document: 'nurse/other/nursys-1.pdf' }).ok && !lv({ document: doc.replace('.pdf', '.exe') }).ok && !lv({ multistate: null }).ok && !lv({ state: 'Missouri' }).ok)
const all7 = N.ORIENTATION_TOPICS.map((t) => t.id)
ck('orientation: the 7 topics of manual 2.6, quoted; all 7 required', N.ORIENTATION_TOPICS.length === 7 && N.ORIENTATION_TOPICS[0].text === 'Code of ethics' && /as defined by the CDC/.test(N.ORIENTATION_TOPICS[3].text) && N.orientationVerdict({ date: '2026-10-14', given_by: 'Krystal', topics: all7 }, { offerId: OID, today: '2026-10-14', by }).state === 'complete' && !N.orientationVerdict({ date: '2026-10-14', given_by: 'Krystal', topics: all7.slice(1) }, { offerId: OID, today: '2026-10-14', by }).ok)
ck('Section 2: the signed copy and the date', N.section2Verdict({ signed_on: '2026-10-14', document: 'nurse/' + OID + '/section2-1760000000000.jpg' }, { offerId: OID, today: '2026-10-14', by }).state === 'complete' && !N.section2Verdict({ signed_on: '2026-10-14' }, { offerId: OID, today: '2026-10-14', by }).ok)
const staff = [{ id: 'ns-n', name: 'Natasha Early', cred: 'RN', employee: true, supervising_rn: true }, { id: 'ns-x', name: 'Other RN', cred: 'RN', supervising_rn: false }]
const rec = N.nurseStaffRecord(staff, { offerId: OID, name: 'Lee Nurse', email: 'LEE@X.TEST', positionKey: 'lpn', licenseEvidence: { license_last4: '6813', expires: '2028-05-31', checked_on: '2026-10-14', by_name: 'Krystal', state: 'MO', multistate: false }, at: '2026-10-14T15:00:00Z', by: 'sam@x' })
ck('nurse list record: LPN, employee, "on file, ending 6813" only, the verified expiry, Natasha Early (from the list) as supervising RN, never itself supervising', rec.record.cred === 'LPN' && rec.record.employee === true && rec.record.license === 'on file, ending 6813' && rec.record.expires === '2028-05-31' && rec.record.supervisor === 'Natasha Early' && rec.record.supervisor_id === 'ns-n' && rec.record.supervising_rn === false && rec.record.email === 'lee@x.test' && !rec.problems.length)
ck('nurse list record: an RN hire has no supervisor; an LPN without Natasha on the list is a named problem', N.nurseStaffRecord(staff, { offerId: OID, name: 'R N', email: '', positionKey: 'rn', licenseEvidence: { expires: '2027-04-30' }, at: '2026-10-14T15:00:00Z', by: 'x' }).record.supervisor === null && N.nurseStaffRecord([], { offerId: OID, name: 'L', email: '', positionKey: 'lpn', licenseEvidence: { expires: '2028-05-31' }, at: '2026-10-14T15:00:00Z', by: 'x' }).problems.some((p) => /Natasha Early is not on the nurse list/.test(p)))
ck('nurse list record: an existing record (same name) is updated, keeping its id, email and GoHighLevel id', (() => { const r = N.nurseStaffRecord([{ id: 'old', name: 'Lee Nurse', email: 'keep@x', ghl_user_id: 'g1', cred: '' }, ...staff], { offerId: OID, name: 'Lee Nurse', email: 'new@x', positionKey: 'lpn', licenseEvidence: { license_last4: '1', expires: '2028-05-31' }, at: '2026-10-14T15:00:00Z', by: 'x' }); return r.existing && r.record.id === 'old' && r.record.email === 'keep@x' && r.record.ghl_user_id === 'g1' && r.record.cred === 'LPN' })())
ck('AxisCare class: LPN and RN read only as themselves (never CNA, never a level)', N.nurseClassMatch('LPN', 'LPN') && N.nurseClassMatch('Licensed Practical Nurse', 'LPN') && !N.nurseClassMatch('CNA', 'LPN') && !N.nurseClassMatch('Level 2 Personal Care', 'LPN') && N.nurseClassMatch('RN', 'RN') && N.nurseClassMatch('Registered Nurse', 'RN') && !N.nurseClassMatch('LPN', 'RN') && !N.nurseClassMatch('CNA', 'RN') && !N.nurseClassMatch('PRN Team', 'RN'))
ck('the training waiver: only the On-the-Job Skills Training; the agency orientation and dementia training are kept; the reason cites the rule and the license', N.WAIVED_COURSES.join() === 'on-the-job-training' && N.KEPT_COURSES.join() === 'agency-orientation,dementia-care' && /15-7\.021\(22\)\(A\)4/.test(N.waiverReason('LPN', '6813', '2026-10-14', 'Krystal')) && /ending 6813/.test(N.waiverReason('LPN', '6813', '2026-10-14', 'Krystal')))
const s2 = N.section2Statement('Lee Nurse', 'Licensed Practical Nurse (LPN), license ending 6813').map((b) => b.t).join('\n'), oc = N.orientationChecklist('Lee Nurse').map((b) => b.t).join('\n')
ck('the Section 2 statement and the checklist: her name, the license, no em dash, never "plain language"', /Lee Nurse/.test(s2) && /ending 6813/.test(s2) && /have read it/.test(s2) && /section 2\.3/.test(s2) && (oc.match(/Covered: ____/g) || []).length === 7 && !/—/.test(s2 + oc) && !/plain (language|english)/i.test(s2 + oc))
ck('the Step 2 packet lines: LPN names all three; RN has no RN supervision acknowledgment', /job description, RN supervision acknowledgment and the nursing documentation expectations/.test(P.packetLine('lpn')) && !/supervision/.test(P.packetLine('rn')))
/* ═══ 4. the Hub project database change (PGlite) ═══ */
const PG = process.env.PGLITE || '/Users/samantha/Claude/Projects/.pglite/node_modules/@electric-sql/pglite/dist/index.js'
const { PGlite } = await import(PG.endsWith('.js') ? PG : path.join(PG, 'dist/index.js'))
const db = new PGlite()
await db.exec(`create role anon; create role authenticated;
create table public.step1_forms (id uuid primary key default gen_random_uuid(), offer_id uuid unique, practice boolean, hepb_form boolean not null default false, answers jsonb default '{}', created_at timestamptz default now());
create table public.step1_identity (offer_id uuid primary key, ssn_sealed text, license_sealed text, license_last4 text);
alter table public.step1_identity enable row level security; grant select on public.step1_identity to authenticated;
create table public.client_journey_step_def (key text primary key, catalog_version int, def jsonb, active boolean, updated_by text);
grant select on public.client_journey_step_def to authenticated;
create table public.axiscare_change_log (id bigserial primary key, kind text not null, outcome text);
alter table public.axiscare_change_log add constraint axiscare_change_log_kind_check check (kind in ('client_created','client_linked','client_updated','responsible_party','care_level','care_tasks','care_plan_note','client_note','caregiver_note','schedule','visit_caregiver','call_summary','scheduling_note','caregiver_status','prn_team_classes','caregiver_hire_date','caregiver_level','some_later_kind'));
insert into public.step1_forms (offer_id, hepb_form) values ('11111111-1111-1111-1111-111111111111', true), ('22222222-2222-2222-2222-222222222222', false);
insert into public.axiscare_change_log (kind, outcome) values ('caregiver_level', 'practice'), ('some_later_kind', 'sent');`)
const SQL = fs.readFileSync(path.join(ROOT, 'supabase/lpn-hiring-708.sql'), 'utf8')
let e1 = ''; try { await db.exec(SQL) } catch (e) { e1 = e.message }
ck('the 708 change runs (guards, columns, trigger, the kind list, the four rows, its own self-check)', !e1, e1)
let e2 = ''; try { await db.exec(SQL) } catch (e) { e2 = e.message }
ck('safe to run twice', !e2, e2)
ck('every Step 1 already on file reads nurse_form false', (await db.query(`select count(*)::int n from public.step1_forms where nurse_form`)).rows[0].n === 0)
let t = ''; try { await db.exec(`update public.step1_forms set nurse_form = true where offer_id = '11111111-1111-1111-1111-111111111111'`) } catch (e) { t = e.message }
ck('nurse_form is decided once: a change is refused', /never changed/.test(t), t)
await db.exec(`update public.step1_forms set answers = '{"a":1}' where offer_id = '11111111-1111-1111-1111-111111111111'`)
ck('every other Step 1 update still works', (await db.query(`select answers->>'a' a from public.step1_forms where offer_id = '11111111-1111-1111-1111-111111111111'`)).rows[0].a === '1')
ck('step1_identity: no browser role can read it (the grant a test gave is removed)', !(await db.query(`select has_table_privilege('authenticated', 'public.step1_identity', 'select') p`)).rows[0].p)
let k1 = ''; try { await db.exec(`insert into public.axiscare_change_log (kind, outcome) values ('caregiver_class', 'practice'), ('some_later_kind', 'sent'), ('caregiver_level', 'sent')`) } catch (e) { k1 = e.message }
let k2 = ''; try { await db.exec(`insert into public.axiscare_change_log (kind, outcome) values ('made_up', 'sent')`) } catch (e) { k2 = e.message }
ck('the change log learns caregiver_class and keeps every kind allowed before (including one added later by someone else); others still refused', !k1 && /check/.test(k2), [k1, k2])
const rows = (await db.query(`select key, def, active from public.client_journey_step_def order by key`)).rows
ck('the four nurse rows: active, required, applies only to licensed nurses', rows.length === 4 && rows.every((r) => r.active && r.def.required === true && r.def.applies.licensed_nurse === true && r.def.subject === 'caregiver'), rows.map((r) => r.key))
ck('the rows\' words: Nursys QuickConfirm, manual 2.6, manual 2.3, the LPN packet; no em dash', /Nursys QuickConfirm/.test(JSON.stringify(rows)) && /2\.6/.test(JSON.stringify(rows)) && /2\.3/.test(JSON.stringify(rows)) && /LPN packet/.test(JSON.stringify(rows)) && !/—/.test(JSON.stringify(rows)))
await db.exec(fs.readFileSync(path.join(ROOT, 'supabase/lpn-hiring-708-rollback.sql'), 'utf8'))
ck('the rollback: the four rows go inactive; the columns and their values stay (nothing deleted)', (await db.query(`select count(*)::int n from public.client_journey_step_def where active`)).rows[0].n === 0 && (await db.query(`select count(*)::int n from public.step1_forms`)).rows[0].n === 2)
for (const [n, okk, note] of res) console.log((okk ? 'PASS  ' : 'FAIL  ') + n + (okk ? '' : '  ' + note))
const bad = res.filter((x) => !x[1]).length; console.log(`${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0)
