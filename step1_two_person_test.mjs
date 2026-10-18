// node step1_two_person_test.mjs · no two-person transfers in Step 1 (Samantha, 2026-10-18, "2 approved with the added
// Level 3 sentence"): the words she approved, the versions, the approval record and that nothing else moved.
import fs from 'fs'; import path from 'path'
const ROOT = path.dirname(new URL(import.meta.url).pathname)
const D = await import(path.join(ROOT, 'supabase/functions/_shared/step1-documents.ts'))
const REC = JSON.parse(fs.readFileSync(path.join(ROOT, 'supabase/step1-approved-2026-10-18.json'), 'utf8'))
let pass = 0, fail = 0; const ck = (n, c, x) => { if (c) { pass++; console.log('ok    ' + n) } else { fail++; console.log('FAIL  ' + n + (x === undefined ? '' : '  ' + JSON.stringify(x).slice(0, 300))) } }
ck('the skill list has no two-person transfers (key or words)', !Object.keys(D.SKILLS).some((k) => /two.?person/i.test(k)) && !Object.values(D.SKILLS).some((l) => /two.?person/i.test(l)), D.SKILLS)
ck('Higher-need care is exactly the six she saw, in order', D.SKILL_GROUPS[2].skills.map(([, l]) => l).join(' · ') === "Bedbound care and repositioning · Hospice and end-of-life support · A Hoyer or other mechanical lift · Emptying a catheter bag and cleaning around the site · Emptying an ostomy bag and cleaning around the site · Dementia or Alzheimer's care")
ck('Level 3 duties are her approved words', D.LEVELS[3].duties === "Everything included in Levels 1 and 2, plus: Hoyer lift (if trained), bedbound clients, frequent repositioning, hospice support (non-medical), high fall-risk clients, Parkinson's disease, stroke recovery, complex mobility assistance. One caregiver per visit: a client who needs more than one person to transfer must have a lift.", D.LEVELS[3].duties)
ck('no form text anywhere mentions two-person transfers', D.FORM_ORDER.every((k) => !/two.?person/i.test(D.formText(k))))
ck('the application is version 5 and the experience form version 3, both approved for real', D.FORMS.employee_application.version === 5 && D.FORMS.experience.version === 3 && D.approvedForReal('employee_application') && D.approvedForReal('experience'))
ck('every form in force is still approved for real (no applicant is held)', Object.keys(D.APPROVED_FOR_REAL).every((k) => D.approvedForReal(k)))
ck('Step 1 version 7', D.STEP1_VERSION === 7 && REC.step1_version === 7)
let same = true, miss = []
for (const f of REC.forms) { const fp = await D.formFingerprint(f.key); if (fp !== f.sha256 || D.FORMS[f.key].version !== f.version) { same = false; miss.push(f.key) } }
ck('the record lists every approved form with its exact version and wording fingerprint', same && REC.forms.length === Object.keys(D.APPROVED_FOR_REAL).length, miss)
const prev = JSON.parse(fs.readFileSync(path.join(ROOT, 'supabase/step1-approved-2026-10-14.json'), 'utf8'))
const moved = REC.forms.filter((f) => { const p = prev.forms.find((x) => x.key === f.key); return !p || p.sha256 !== f.sha256 }).map((f) => f.key)
ck('only the application and the experience form changed since 2026-10-14', moved.join() === 'employee_application,experience', moved)
ck('the record carries her words, the time and the page', REC.her_words === '1 ask it (needs a lift before we staff), 2 approved with the added Level 3 sentence' && REC.approved_at === '2026-10-18T17:32:18Z' && /W9WetxzBTJz7s8utoMfSkZ/.test(REC.page))
ck('no em dash in the new words or the record', !/—/.test(D.LEVELS[3].duties + JSON.stringify(REC)))
console.log(`\n${pass}/${pass + fail} passed`); process.exit(fail ? 1 : 0)
