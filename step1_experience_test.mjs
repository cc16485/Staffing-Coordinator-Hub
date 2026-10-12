// 2026-10-11 · Step 1 experience and references (her approval of the previews, with refinements): the version 3 forms, the
// cards the page saves, what is still missing, what lands on Background & References, the skills picture for the profile,
// and the practice-only reference task questions. Nothing real is touched. node step1_experience_test.mjs
import fs from 'fs'; import path from 'path'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 700)])
const D = await import(path.join(FN, '_shared/step1-documents.ts'))
const E = await import(path.join(FN, '_shared/step1-experience.ts'))
const P = await import(path.join(FN, '_shared/step1-pdf.ts'))
let handler = null; globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'svc', HUB_JOB_SECRET: 's'.repeat(48) })[k] }, serve: (h) => { handler = h } }
globalThis.__fakeCreateClient = () => FAKE
const load = async (fn) => { const src = fs.readFileSync(path.join(FN, fn, 'index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__fakeCreateClient'); const tmp = path.join(FN, fn, '_tx.ts'); fs.writeFileSync(tmp, src); try { return await import(tmp) } finally { fs.unlinkSync(tmp) } }
let FAKE = null
const M = await load('step1-sign')

/* ═══ the forms: her words, version 3, nothing approved for real ═══ */
const app = D.formText('employee_application'), ref = D.formText('reference_consent')
ck('application and references at version 3; the experience form untouched at version 2; nothing approved for real', D.FORMS.employee_application.version === 3 && D.FORMS.reference_consent.version === 3 && D.FORMS.experience.version === 2 && Object.keys(D.APPROVED_FOR_REAL).length === 0)
ck('"Your experience matters!" first in Work History, her three paragraphs word for word, shown as the encouraging box', (() => { const secs = D.FORMS.employee_application.sections; const i = secs.findIndex((s) => s.h === 'Your experience matters!'); return i >= 0 && secs[i + 1].h === 'Your work history' && secs[i].tone === 'cheer' && secs[i].p[0] === 'The experience we can verify helps us determine your qualifications, starting pay rate, and which clients we can match you with.' && /Help us give you credit for your experience! Please list people who can confirm the care you've provided, including former supervisors, private clients, or professionals who have seen your work\./.test(secs[i].p[1]) && /The more experience we can confirm, the better we can recognize your skills and consider you for assignments that fit your abilities\./.test(secs[i].p[2]) })())
ck('the short reminder sits with the reference contact boxes, word for word', D.FORMS.reference_consent.sections.find((s) => s.h === 'Your references').tip === 'Please provide accurate contact information for someone who knows your work. We use verified experience when determining qualifications, pay, and client matches. A reference we cannot reach may mean we cannot yet give you credit for that experience.' && ref.includes('t|Please provide accurate contact information'))
ck('catheter bag emptying and ostomy bag care are two skills, each only emptying and cleaning around the site', D.SKILLS.catheter_bag === 'Emptying a catheter bag and cleaning around the site' && D.SKILLS.ostomy_bag === 'Emptying an ostomy bag and cleaning around the site')
ck('each job: tasks, lift type (full-body sling / sit-to-stand / other), the refresher question, phone AND email, may-we-contact', (() => { const f = D.FORMS.employee_application.sections.flatMap((s) => s.items || []).find((i) => i.id === 'jobs').fields.map((x) => x.k); return ['tasks', 'lifts', 'refresher', 'phone', 'email', 'may_contact', 'supervisor'].every((k) => f.includes(k)) && D.LIFT_TYPES.join() === 'Full-body sling,Sit-to-stand,Other' && /training or a refresher on before doing it again/.test(app) })())
ck('family care: her wording (no automatic qualification), several payment sources, optional confirmer, kept as self-reported', /We'll use this information, along with references and other qualifications, to better understand your experience\./.test(app) && !/count it once someone confirms/.test(app) && /Tick all that apply/.test(app) && /we still keep it on your record as experience you told us about/.test(app) && D.FORMS.employee_application.sections.flatMap((s) => s.items || []).find((i) => i.id === 'family_care').fields.find((x) => x.k === 'paid').kind === 'multi')
ck('references: may-we-contact on each, a backup of either kind, "never counts against you"', /f\|professional_refs\|may_contact/.test(ref) && /f\|personal_refs\|may_contact/.test(ref) && /f\|backup_refs\|type/.test(ref) && /A reference who does not answer never counts against you/.test(ref))
ck('the fingerprint covers the card boxes and the skills list (a changed task name is a new fingerprint)', /f\|jobs\|tasks\|/.test(app) && /skills\|Everyday help:companionship=/.test(app) && !/f\|/.test(D.formText('availability')))
ck('no em dash anywhere in the new wording', !/—/.test(app + ref))

/* ═══ the cards as the server keeps them ═══ */
const jobsIt = D.FORMS.employee_application.sections.flatMap((s) => s.items || []).find((i) => i.id === 'jobs')
const famIt = D.FORMS.employee_application.sections.flatMap((s) => s.items || []).find((i) => i.id === 'family_care')
const proIt = D.FORMS.reference_consent.sections.flatMap((s) => s.items || []).find((i) => i.id === 'professional_refs')
const job = { company: 'Home Helpers', city_state: 'Springfield, MO', role: "Caregiver's aide", from: '3/2019', to: '6/2023', supervisor: 'Jane Boss', phone: '417-555-0202', may_contact: 'yes', reason_leaving: 'Moved', did_care: 'yes', tasks: ['bathing', 'hoyer_lift', 'catheter_bag'], lifts: ['Full-body sling'], refresher: ['hoyer_lift'] }
ck('a job card is kept as typed, apostrophes and all', JSON.stringify(M.clean(jobsIt, [job])) === JSON.stringify([job]))
ck('an unknown box, an unknown task, a bad email or a bad phone is refused', M.clean(jobsIt, [{ ...job, salary: 5 }]) === undefined && M.clean(jobsIt, [{ ...job, tasks: ['surgery'] }]) === undefined && M.clean(jobsIt, [{ ...job, email: 'nope' }]) === undefined && M.clean(jobsIt, [{ ...job, phone: 'call me' }]) === undefined)
ck('a refresher is kept only for a task ticked on the same card; a lift type only when a lift is ticked; "none" stands alone', (() => { const c = M.clean(jobsIt, [{ ...job, tasks: ['bathing'], refresher: ['hoyer_lift', 'bathing'] }])[0]; return c.refresher.join() === 'bathing' && !('lifts' in c) && M.clean(jobsIt, [{ ...job, refresher: ['none', 'bathing'] }]) === undefined })())
ck('family care keeps several payment sources', M.clean(famIt, [{ who: 'A family member', from: '2020', to: '2022', paid: ['Not paid', 'A VA program'], tasks: ['bathing'], refresher: ['none'] }])[0].paid.length === 2)
ck('more cards than allowed are refused', M.clean(famIt, [{}, {}, {}, {}, {}]) === undefined)

/* ═══ what is still missing ═══ */
const miss = (a) => M.missing('employee_application', { preferred_name: 'x', lived_outside_mo: 'no', moving_violations: 'no', license_suspended: 'no', convicted: 'no', cna: 'no', hha: 'no', ...a }, { ssn: null, dob: false, license: null })
ck('a complete job: nothing missing', miss({ jobs: [job] }).length === 0, miss({ jobs: [job] }))
ck('no jobs and no "no previous employer" tick: the work history is asked for', miss({}).some((m) => /Your work history/.test(m)))
ck('a job with no phone and no email is named', miss({ jobs: [{ ...job, phone: undefined }] }).some((m) => /Job 1 \(Home Helpers\).*a phone or an email/.test(m)), miss({ jobs: [{ ...job, phone: undefined }] }))
ck('care given: at least one task, the lift type when a lift is ticked, and the refresher answer', (() => { const m1 = miss({ jobs: [{ ...job, tasks: [] }] }).join(); const m2 = miss({ jobs: [{ ...job, lifts: undefined }] }).join(); const m3 = miss({ jobs: [{ ...job, refresher: undefined }] }).join(); return /tick at least one/.test(m1) && /which kind of lift/.test(m2) && /the refresher question/.test(m3) })())
ck('no care in that job: no task questions', miss({ jobs: [{ ...job, did_care: 'no', tasks: undefined, lifts: undefined, refresher: undefined }] }).length === 0)
ck('family care with no confirmer is complete (self-reported is fine); a named confirmer needs a phone or email and permission', miss({ jobs: [job], family_care: [{ who: 'A family member', from: '2020', to: '2022', paid: ['Not paid'], tasks: ['bathing'], refresher: ['none'] }] }).length === 0 && /a phone or an email, may we contact them/.test(miss({ jobs: [job], family_care: [{ who: 'A family member', from: '2020', to: '2022', paid: ['Not paid'], tasks: ['bathing'], refresher: ['none'], confirmer: 'Nurse Kay' }] }).join()))
const rmiss = (a) => M.missing('reference_consent', a, { ssn: null, dob: false, license: null })
const R = (name, may = 'yes') => ({ name, company: 'Co', role: 'Boss', phone: '417-555-0000', may_contact: may }), PR = (name, may = 'yes') => ({ name, relationship: 'Friend', email: 'a@b.co', may_contact: may })
ck('references: two of each we may contact, complete', rmiss({ professional_refs: [R('A'), R('B')], personal_refs: [PR('C'), PR('D')] }).length === 0)
ck('a reference they asked us not to contact does not count; they are told to add another person', /2 professional references we may contact \(if you would rather we not contact someone, add another person instead\)/.test(rmiss({ professional_refs: [R('A'), R('B', 'no')], personal_refs: [PR('C'), PR('D')] }).join()))
ck('a reference with no phone or email is named', /Professional reference 1 \(A\): a phone or an email/.test(rmiss({ professional_refs: [{ ...R('A'), phone: undefined }, R('B')], personal_refs: [PR('C'), PR('D')] }).join()))

/* ═══ Background & References: only references they let us contact land; old rows still land ═══ */
ck('v3 cards land in the same four slots; one marked "do not contact" never lands (so it is never sent a request)', (() => { const p = M.landingPatch('reference_consent', { professional_refs: [R('Jane Boss'), R('No Call', 'no'), R('Tom Lead')], personal_refs: [PR('Sue'), PR('Bob')] }, 'x'); return p.r1n === 'Jane Boss' && p.r1_company === 'Co' && p.r2n === 'Tom Lead' && p.r3n === 'Sue' && p.r3_email === 'a@b.co' && p.r4n === 'Bob' && !JSON.stringify(p).includes('No Call') })())
ck('version 2 rows (arrays) still land as before', M.landingPatch('reference_consent', { professional_refs: [['A', 'Co', 'Boss', '1', '']], personal_refs: [] }, 'x').r1n === 'A')
ck('backups never land on the four slots', !JSON.stringify(M.landingPatch('reference_consent', { professional_refs: [R('A')], personal_refs: [], backup_refs: [{ type: 'Professional', name: 'Backup Bea', relationship: 'x', phone: '1', may_contact: 'yes' }] }, 'x')).includes('Backup Bea'))

/* ═══ the signed PDF shows the cards by name ═══ */
const txt = P.answerText(jobsIt, [job], { ssn: null, dob: false, license: null })
ck('the PDF lists each job with its tasks by name and the refresher', /^1\. Company: Home Helpers; .*What did you do yourself: Bathing or showering, A Hoyer or other mechanical lift, Emptying a catheter bag and cleaning around the site; Which kind of lift: Full-body sling; .*refresher.*: A Hoyer or other mechanical lift/.test(txt), txt)

/* ═══ the skills picture (the profile): her evidence rules ═══ */
const A = { jobs: [job], family_care: [{ who: 'A family member', relationship: 'my grandmother', from: '2020', to: '2022', paid: ['Not paid'], tasks: ['bathing', 'ostomy_bag'], refresher: ['none'], confirmer: 'Kay Nurse', confirmer_how: 'hospice nurse' }],
  matching_facts: { 'Homes with cats': 'Not at this time', 'Homes with dogs': 'Yes' }, specialties: { 'Hospice clients': 'Yes' }, exclusions: 'No overnights', experience: '2 to 5 years', languages: ['English'] }
const sum0 = E.experienceSummary(A, [])
ck('with no reference answers every task is self-reported, never "lacks"', sum0.skills.every((l) => l.standing === 'self_reported') && sum0.skills.length === 4 && /Self-reported/.test(sum0.skills[0].words))
const refs = [{ slot: 1, ref_name: 'jane boss', ref_type: 'professional', responded_at: '2026-10-12T15:00:00Z', task_confirm: { bathing: 'saw', hoyer_lift: 'believe', catheter_bag: 'unknown' }, trust_family: 'reservations', comfort_why: 'She was new then' },
  { slot: 3, ref_name: 'Kay Nurse', ref_type: 'personal', responded_at: null, task_confirm: null }]
const sum = E.experienceSummary(A, refs), line = (k) => sum.skills.find((l) => l.key === k)
ck('saw it themselves = confirmed; believed = support only; "don\'t know" and no answer change nothing', line('bathing').standing === 'confirmed' && line('hoyer_lift').standing === 'supported' && line('catheter_bag').standing === 'self_reported' && line('ostomy_bag').standing === 'self_reported')
ck('bathing done in two places; the lift type and the refresher carried', line('bathing').places.length === 2 && line('hoyer_lift').lifts.join() === 'Full-body sling' && line('hoyer_lift').refresher === true)
ck('restrictions: not at this time, would rather not, wants a refresher first', sum.restrictions.join('|') === 'Not at this time: Homes with cats|Would rather not accept: No overnights|Wants training or a refresher before doing again: A Hoyer or other mechanical lift')
ck('strengths: confirmed tasks, done in more than one place, experience, languages, client groups', /Confirmed by a reference: Bathing or showering/.test(sum.strengths.join()) && /Done in more than one place: Bathing/.test(sum.strengths.join()) && /Experience: 2 to 5 years/.test(sum.strengths.join()) && /Comfortable with: Hospice clients/.test(sum.strengths.join()))
ck('the "comfortable having them care for someone you care about" answer is kept as general feedback with the why', sum.references[0].comfortable === 'Yes, with some reservations' && sum.references[0].comfortable_why === 'She was new then' && !sum.skills.some((l) => /comfortable/i.test(l.words)))
ck('a reference matches the job or care they confirm, however the name was typed', E.entriesFor(A, 'JANE  BOSS').length === 1 && E.entriesFor(A, 'Kay Nurse')[0].kind === 'family' && E.entriesFor(A, 'Someone Else').length === 0)
ck('the picture says it sets nothing', /Nothing here sets a level, a qualification, a match or a pay rate/.test(sum.note))

/* ═══ reference-tasks: practice hires only; real reference requests unchanged ═══ */
const RID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', RID2 = 'aaaaaaaa-bbbb-4ccc-8ddd-ffffffffffff'
let DB = {}
const reset = (practice) => { DB = { reference_requests: [{ id: RID, candidate_id: 901, slot: 1, ref_name: 'Jane Boss', ref_type: 'professional', responded_at: null, task_confirm: null }, { id: RID2, candidate_id: 902, slot: 1, ref_name: 'Real Ref', responded_at: null }],
  app_data: [{ key: 'candidates', data: [{ id: 901, first: 'Pat', offer_id: 'off-1' }, { id: 902, first: 'Real', offer_id: 'off-2' }] }], step1_forms: [{ offer_id: 'off-1', practice, answers: A }, { offer_id: 'off-2', practice: false, answers: A }] } }
const UPD = []
FAKE = { from: (t) => { const f = []; const q = { select: () => q, eq: (k, v) => (f.push((r) => String(r[k]) === String(v)), q), is: (k, v) => (f.push((r) => r[k] == v), q), order: () => q,
  maybeSingle: async () => ({ data: (DB[t] || []).find((r) => f.every((x) => x(r))) ?? null }),
  update: (patch) => { q._u = patch; return q }, then: undefined }
  q.select = (..._) => { if (q._u) return { then: (ok) => { const rows = (DB[t] || []).filter((r) => f.every((x) => x(r))); rows.forEach((r) => Object.assign(r, q._u)); UPD.push({ t, patch: q._u, n: rows.length }); ok({ data: rows.map((r) => ({ id: r.id })), error: null }) } }; return q }
  return q } }
await load('reference-tasks')
const call = async (b) => { const r = await handler(new Request('http://x', { method: 'POST', body: JSON.stringify(b) })); return { status: r.status, j: await r.json() } }
reset(false)
let r = await call({ action: 'view', r: RID })
ck('not a practice hire: { practice: false } and the reference form stays exactly as today', r.status === 200 && r.j.practice === false && !r.j.entries)
r = await call({ action: 'save', r: RID, task_confirm: { bathing: 'saw' } })
ck('not a practice hire: nothing is saved', r.j.practice === false && UPD.length === 0)
reset(true)
r = await call({ action: 'view', r: RID2 }); ck('a real hire\'s request, even beside a practice one: unchanged', r.j.practice === false)
r = await call({ action: 'view', r: 'not-a-uuid' }); ck('a bad link: unchanged form, nothing told', r.j.practice === false)
r = await call({ action: 'view', r: RID })
ck('a practice hire: the tasks from the job this reference supervised, by name', r.j.practice === true && r.j.first === 'Pat' && r.j.entries.length === 1 && r.j.entries[0].tasks.map((t) => t.key).join() === 'bathing,hoyer_lift,catheter_bag' && /Home Helpers/.test(r.j.entries[0].where), r.j)
r = await call({ action: 'save', r: RID, task_confirm: { bathing: 'saw' } })
ck('every task must be answered', r.status === 400 && r.j.missing.join() === 'hoyer_lift,catheter_bag')
r = await call({ action: 'save', r: RID, task_confirm: { bathing: 'saw', hoyer_lift: 'maybe', catheter_bag: 'no' } }); ck('an answer not on the list is refused', r.status === 400)
r = await call({ action: 'save', r: RID, task_confirm: { bathing: 'saw', hoyer_lift: 'believe', catheter_bag: 'unknown', surgery: 'saw' } }); ck('a task they were not asked about is refused', r.status === 400)
r = await call({ action: 'save', r: RID, task_confirm: { bathing: 'saw', hoyer_lift: 'believe', catheter_bag: 'unknown' }, comfort_why: 'Kind and careful' })
ck('saved: what they were asked, their answers, the why, the time; only those four columns', r.status === 200 && r.j.saved === 3 && UPD.at(-1).t === 'reference_requests' && Object.keys(UPD.at(-1).patch).sort().join() === 'comfort_why,task_confirm,task_list,tasks_answered_at' && DB.reference_requests[0].task_confirm.bathing === 'saw' && DB.reference_requests[0].comfort_why === 'Kind and careful')
DB.reference_requests[0].responded_at = '2026-10-12T15:00:00Z'
r = await call({ action: 'save', r: RID, task_confirm: { bathing: 'no', hoyer_lift: 'no', catheter_bag: 'no' } }); ck('once the reference has sent their answers, nothing changes', r.status === 409 && DB.reference_requests[0].task_confirm.bathing === 'saw')

const bad = res.filter((x) => !x[1]); for (const [n, ok, note] of res) console.log((ok ? 'ok    ' : 'FAIL  ') + n + (ok ? '' : '  ' + note))
console.log(`${res.length - bad.length}/${res.length} passed`); if (bad.length) process.exit(1)
