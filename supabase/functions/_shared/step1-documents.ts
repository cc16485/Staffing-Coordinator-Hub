// =============================================================================
// step1-documents.ts · the Step 1 forms, version 1 as PROPOSED (Samantha, 2026-10-09: "treat the current language as
// proposed Version 1, not final approval ... bring back the complete revised wording for one final review before
// activating Phase 2a for real applicants"). SLICE 2a.
// =============================================================================
// Transcribed from today's Viventium Group 1 forms (Implementation plan tab, section 18) with her rulings of October 9
// applied (sections 19, 20, 21 and her seven decisions). The wording lives here, versioned, so every screen and every
// PDF comes from the same words; a change to one word is a new version and a new approval. The fingerprint of a form's
// wording is stored with every signature. Nothing here holds an answer: answers are merged at render time (2b/2c).
// Two forms carry a status other than 'proposed': the FCRA disclosure is a DRAFT FOR COUNSEL (her decision 7) and the
// screening package list is TO CONFIRM (her decision 4). Fictional practice only until each is approved.
// 2026-10-13 APPROVED: Samantha, 2026-10-13, 'approve step 1 forms', wording page version 5. All thirteen forms (a person
// signs twelve: the Driver or the Non-Driver Agreement) are status 'approved' at the versions in APPROVED_FOR_REAL below.
export const STEP1_VERSION = 5   // 2026-10-13: the permission form (5a v2) replaces the FCRA draft; application v4, details v4. Before: 2026-10-11 (her approval of the Step 1 previews): the application and the reference consent at version 3 (tasks per job, family care, backup references); the vehicle form and the EDL/FCSR consent at version 3; two forms at version 2; the FCRA draft at version 1
export type FormKey = 'employee_application' | 'reference_consent' | 'fcra_disclosure' | 'edl_fcsr_consent' | 'availability' | 'experience' | 'vehicle' | (string & {})
/** 'approved': Samantha approved this form's wording for real applicants (2026-10-13, see APPROVED_FOR_REAL); a new wording starts
    again as 'proposed' at a new version until she approves that version */
export type FormStatus = 'proposed' | 'approved' | 'draft_for_counsel' | 'to_confirm'
/** One box inside a card (a job, a family-care entry, a reference). 'skills' are keys of SKILLS; 'lifts' shows only when a
    lift is ticked; 'refresher' offers only the tasks ticked on the same card, plus 'none'. */
export type Field = { k: string; label: string; kind: 'text' | 'tel' | 'email' | 'yesno' | 'choice' | 'multi' | 'skills' | 'lifts' | 'refresher'; options?: string[]; required?: boolean; note?: string }
export type Item = { id: string; label: string; kind: 'text' | 'yesno' | 'choice' | 'multi' | 'date' | 'statement' | 'table' | 'number' | 'initials' | 'photo' | 'cards'; options?: string[]; required?: boolean; note?: string; locked?: boolean; fields?: Field[]; max?: number; add?: string }
/** tone 'cheer': shown as an encouraging box; tip: one short line in a highlighted box (both are wording, in the fingerprint) */
export type Section = { h: string; p?: string[]; items?: Item[]; tone?: 'cheer'; tip?: string }
/** 2026-10-13 (Samantha: long documents such as the Employment Agreement and the Employee Manual are shown WHOLE in one
    scrollable reader on their Step 1 screen, with a copy to open or save, and the acknowledgment, any separate initials
    and the signature right below): layout 'document'. `short` is the screen's title in the screen list. */
/** countersign: after the applicant signs, a person on the Approve to Work list signs for Caring Companions (step1-countersign.sql) */
/** 2026-10-13 (Hepatitis B in Step 1): `step1Gate` names a form that is in a person's Step 1 only when their Step 1 record
    says so (decided once, when the Step 1 starts: see step1Ctx); `confidential` keeps the answer and the signed PDF out of
    the Step 1 answers and the onboarding store (a medical record, owners only); `choices` is ONE deciding choice whose
    answer is never stored with the Step 1 answers; `decline` is a statement shown and signed only for that choice. */
export type Choice = { id: string; label: string; note?: string }
export type Form = { key: FormKey; screen: string; title: string; short?: string; layout?: 'document'; when?: { id: string; equals: string }; step1Gate?: 'hepb'; confidential?: boolean; choices?: { label: string; options: Choice[] }; decline?: { choice: string; title: string; intro: string; statement: string; consent: string }; countersign?: boolean; version: number; status: FormStatus; intro?: string[]; sections: Section[]; certification: string[]; signature: 'typed' | 'typed+initials' }

import { APPENDIX_A } from './hepb-appendix-a.ts'
export const OFFICE_PHONE = '(417) 234-8494'
export const COMPANY = 'Troutman Enterprises, LLC DBA Caring Companions In-Home Senior Care'
/** Her decision 1: a previous supervisor may be a professional reference; two professional and two personal, kept apart. */
export const REFERENCES_REQUIRED = { professional: 2, personal: 2 }
/** The clearing rule stays today's Caring Companions policy: two positive references, at least one of them professional. */
export const REFERENCE_CLEARANCE = { positive: 2, professional: 1 }
/** Withheld from the application until she confirms the Company's E-Verify participation. */
export const E_VERIFY_CONFIRMED = false
/** Her decision 4: the screening package is NOT assumed. Filled after she confirms the vendor's package and the Missouri
    requirements; until then the consent names the categories the law and the form already name, and no vendor. */
export const SCREENING_PACKAGE: string[] = []
/** The client-matching facts the caregiver answers on screen 7 (section 21): the AxisCare attributes the interviewer ticks
    today, minus the payer items (not a caregiver fact) and live-in (gone since 2026-09-17). Each is "yes" or "not at this time". */
export const MATCHING_FACTS: { id: string; label: string }[] = [
  { id: 'cats', label: 'Homes with cats' }, { id: 'dogs', label: 'Homes with dogs' }, { id: 'smoking', label: 'Homes where someone smokes' },
  { id: 'female_caregiver', label: 'Clients who ask for a female caregiver' }, { id: 'male_caregiver', label: 'Clients who ask for a male caregiver' },
  { id: 'gait_belt', label: 'Clients who use a gait belt' }, { id: 'hoyer_lift', label: 'Clients who use a Hoyer lift (if trained)' },
  { id: 'bed_bound', label: 'Clients who are bedbound' }, { id: 'transportation', label: 'Driving clients to appointments and errands' },
]
export const LANGUAGES = ['English', 'Spanish', 'Vietnamese', 'Chinese (Mandarin or Cantonese)', 'Arabic', 'French', 'German', 'Russian', 'Tagalog', 'Korean', 'American Sign Language', 'Another language']
export const SPECIALTIES = ["Alzheimer's disease", 'Other dementias', "Parkinson's disease", 'Stroke recovery', 'Hospice clients', 'Clients requiring transfers', 'Clients who use wheelchairs', 'Bedbound clients', 'Clients requiring Hoyer lift assistance (if trained)', 'Behavioral symptoms associated with dementia']
export const LEVELS = {
  1: { title: 'Level 1, Wellness & Companionship Care', duties: 'Friendly companionship and conversation, meal preparation, light housekeeping, laundry, medication reminders, transportation and errands, grocery shopping, safety supervision, social engagement, wellness visits.' },
  2: { title: 'Level 2, Personal Care', duties: 'Everything included in Level 1, plus: Bathing assistance, shower assistance, dressing assistance, grooming, toileting assistance, continence care, mobility assistance, transfers with gait belt, walking assistance, wheelchair assistance.' },
  3: { title: 'Level 3, Advanced Non-Medical Care', duties: "Everything included in Levels 1 and 2, plus: Hoyer lift (if trained), bedbound clients, frequent repositioning, hospice support (non-medical), two-person transfers (when scheduled), high fall-risk clients, Parkinson's disease, stroke recovery, complex mobility assistance." },
}
/* ───── 2026-10-11 (Samantha approved the Step 1 previews, with refinements): the tasks a caregiver ticks per job and per
   family-care entry, the same list everywhere (the reference confirms from it, the profile shows it). Catheter bag emptying
   and ostomy bag care are separate skills, and both are only emptying the bag and cleaning around the site (her rule: "we do
   not do catheters or ostomy, the only thing we will do is empty it or clean around it"). Keys match the skills record where
   one exists (transfers_gait_belt, hoyer_lift, bedbound_care, hospice_support, dementia_care). Nothing here changes a level,
   a qualification or a match: these are their own words, marked self-reported until someone confirms them. ───── */
export const SKILL_GROUPS: { h: string; skills: [string, string][] }[] = [
  { h: 'Everyday help', skills: [['companionship', 'Companionship and conversation'], ['meals_housekeeping', 'Meals and light housekeeping'], ['med_reminders', 'Medication reminders']] },
  { h: 'Personal care', skills: [['bathing', 'Bathing or showering'], ['dressing_grooming', 'Dressing and grooming'], ['toileting', 'Toileting and incontinence care'], ['feeding', 'Feeding'], ['walking_wheelchair', 'Walking or wheelchair help'], ['transfers_gait_belt', 'Transfers with a gait belt']] },
  { h: 'Higher-need care', skills: [['bedbound_care', 'Bedbound care and repositioning'], ['hospice_support', 'Hospice and end-of-life support'], ['two_person_transfers', 'Two-person transfers'], ['hoyer_lift', 'A Hoyer or other mechanical lift'],
    ['catheter_bag', 'Emptying a catheter bag and cleaning around the site'], ['ostomy_bag', 'Emptying an ostomy bag and cleaning around the site'], ['dementia_care', "Dementia or Alzheimer's care"]] },
]
export const SKILLS: Record<string, string> = Object.fromEntries(SKILL_GROUPS.flatMap((g) => g.skills))
export const LIFT_TYPES = ['Full-body sling', 'Sit-to-stand', 'Other']
export const PAY_SOURCES = ['Consumer Directed Services (CDS) or another Medicaid program', 'A VA program', 'The client or family paid me directly', 'Not paid', 'Other']
/** Her words (2026-10-11), at the top of Work History and next to every reference's contact boxes. No pay wording here (her
    ruling the same day: "let's just not say anything about pay rate when we're getting the experience and determining care level"). */
/* her final wording, 2026-10-11 ("Please change the Step 1 introduction to:") */
export const EXPERIENCE_MATTERS = [
  'Everyone starts at Level 1 while we verify their experience. The more experience we can confirm, the more opportunities you may qualify for, including Level 2 and Level 3 assignments.',
  'Please give us accurate contact information for people who know your work. This helps us recognize your experience and match you with clients who need your skills.',
]
export const REFERENCE_REMINDER = 'Please provide accurate contact information for someone who knows your work. We use verified experience when determining qualifications and client matches. A reference we cannot reach may mean we cannot yet give you credit for that experience.'
const TASK_FIELDS: Field[] = [
  { k: 'tasks', label: 'What did you do yourself?', kind: 'skills', note: 'Tick only what you did yourself. We may ask the person who saw your work to confirm it.' },
  { k: 'lifts', label: 'Which kind of lift?', kind: 'lifts', options: LIFT_TYPES },
  { k: 'refresher', label: 'Is there anything you ticked that you would want training or a refresher on before doing it again?', kind: 'refresher', note: 'There is no wrong answer. It helps us set you up to do well.' },
]
const CONTACT_FIELDS = (who: string): Field[] => [
  { k: 'phone', label: `${who} phone`, kind: 'tel' }, { k: 'email', label: `${who} email`, kind: 'email' },
  { k: 'may_contact', label: 'May we contact them?', kind: 'yesno', required: true },
]

export const STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC']

const yesno = (id: string, label: string, extra: Partial<Item> = {}): Item => ({ id, label, kind: 'yesno', required: true, ...extra })
const text = (id: string, label: string, extra: Partial<Item> = {}): Item => ({ id, label, kind: 'text', ...extra })

export const FORMS: Record<FormKey, Form> = {
  employee_application: {
    key: 'employee_application', screen: '2 and 3', title: 'Employee Application', version: 4, status: 'approved', signature: 'typed',
    sections: [
      { h: 'About you', p: ['Your name, phone and email are shown from your offer. Tap any of them to correct it.'], items: [
        text('preferred_name', 'What should families and the office call you?', { note: 'Your preferred first name, if it is different from your legal name.' }),
        text('other_names', 'Any other names you have used (maiden name, previous names, nicknames)'),
        yesno('lived_outside_mo', 'Have you lived outside Missouri in the last five years?'),
        { id: 'states_lived', label: 'Which states?', kind: 'multi', options: STATES },
      ] },
      { h: 'High School', items: [text('hs_name', 'School Name'), text('hs_years', 'Years Attended'), yesno('hs_grad', 'Did you Graduate?', { required: false })] },
      { h: 'Vocational / Technical', items: [text('vo_name', 'School Name'), text('vo_years', 'Years Attended'), yesno('vo_grad', 'Did you Graduate?', { required: false }), text('vo_program', 'Program')] },
      { h: 'College / University', items: [text('co_name', 'School Name'), text('co_years', 'Years Attended'), yesno('co_grad', 'Did you Graduate?', { required: false }), text('co_major', 'Major')] },
      /* 2b: these ids are cert_number / cert_expires, not license_number / license_expires: the driver's license on the vehicle form is a different fact and the two must never share an answer */
      { h: 'Other Licenses / Certification', items: [yesno('cna', 'CNA License?'), yesno('hha', 'HHA Certification?'), text('cert_number', 'If yes, License Number'), { id: 'cert_expires', label: 'Expiration Date', kind: 'date' }] },
      /* v4 (2026-10-13): the criminal-history questions moved to "Permission for Background Checks and References" (screen 5a),
         where Missouri's required disclosures are asked together (RSMo 192.2495.5); the driving questions stay here */
      { h: 'Driving Record', items: [
        yesno('moving_violations', 'Have you had any moving traffic violations?'), text('moving_violations_detail', 'If yes, please describe.'),
        yesno('license_suspended', "Have you had your driver's license suspended or revoked in the last 3 years?"),
      ] },
      /* v3 (2026-10-11, her approval of the previews): her "Your experience matters!" words first; a card per job with the
         tasks done there, the lift type, and what they would want a refresher on; family or private-client care as its own
         optional card, kept on the record as self-reported, counting toward a level only once confirmed (her rule: "if we can't verify it, it doesn't count"). */
      { h: 'Your experience matters!', p: EXPERIENCE_MATTERS, tone: 'cheer' },
      { h: 'Your work history', p: ['Please list your jobs, most recent first (up to three is plenty). If you have never been employed, tick the box below. Please check every detail; we use these to verify you.'], items: [
        { id: 'jobs', label: 'Your jobs', kind: 'cards', max: 6, add: 'Add another job', fields: [
          { k: 'company', label: 'Company', kind: 'text', required: true }, { k: 'city_state', label: 'City, State', kind: 'text', required: true },
          { k: 'role', label: 'Your role / job title', kind: 'text', required: true },
          { k: 'from', label: 'From (month and year)', kind: 'text', required: true }, { k: 'to', label: 'To (month and year, or "still working here")', kind: 'text', required: true },
          { k: 'supervisor', label: 'Your supervisor, or someone there who saw your work', kind: 'text', required: true, note: 'Phone or email, whichever reaches them best. Both is even better.' },
          ...CONTACT_FIELDS('Their'),
          { k: 'reason_leaving', label: 'Reason for leaving', kind: 'text', required: true },
          { k: 'did_care', label: 'Did you care for clients or patients in this job?', kind: 'yesno', required: true },
          ...TASK_FIELDS,
          { k: 'other_tasks', label: 'Anything else you did with clients? (optional)', kind: 'text' },
        ] },
        yesno('no_employer_history', 'I have no previous employer to list.', { required: false }),
      ] },
      { h: 'Family or private-client care (optional)', p: ["Your caregiving experience matters, whether it was paid or unpaid. If we cannot confirm it yet, we'll keep it on your record and you can provide additional information later."], items: [
        { id: 'family_care', label: 'Care you gave a family member or private client', kind: 'cards', max: 4, add: 'Add family or private-client care', fields: [
          { k: 'who', label: 'Who did you care for?', kind: 'choice', options: ['A family member', 'A private client'], required: true },
          { k: 'relationship', label: 'Your relationship to them, or how you found this client (optional)', kind: 'text' },
          { k: 'from', label: 'From (month and year)', kind: 'text', required: true }, { k: 'to', label: 'To (month and year, or "still caring for them")', kind: 'text', required: true },
          { k: 'paid', label: 'How was this care paid for? Tick all that apply.', kind: 'multi', options: PAY_SOURCES, required: true },
          ...TASK_FIELDS,
          { k: 'confirmer', label: 'Someone who saw your care and can confirm it (optional)', kind: 'text', note: 'Someone outside your own family works best: a hospice or home health nurse, a therapist, a case manager, or the client\'s family.' },
          { k: 'confirmer_how', label: 'How do they know your care?', kind: 'text' },
          { k: 'phone', label: 'Their phone', kind: 'tel' }, { k: 'email', label: 'Their email', kind: 'email' },
          { k: 'may_contact', label: 'May we contact them?', kind: 'yesno' },
        ] },
      ] },
    ],
    /* v2: the E-Verify sentence is withheld until Samantha confirms the Company's participation (E_VERIFY_CONFIRMED); the I-9 line stands on its own */
    certification: [
      'I certify that my answers are accurate and complete to the best of my knowledge. I understand that false or misleading information in my interview or application may result in my dismissal. I understand that this employer is required to run the background checks Missouri requires before I may work with participants, and that my potential employment is contingent on the results. I also understand that I may be required to successfully complete any drug screening required by Caring Companions\' screening policy, before or during employment. I understand that if I am hired, federal immigration law requires me to complete a Form I-9 and to provide proof of my identity and my legal authority to work in the United States.',
      'I am not a participant in the Missouri in-home services program.',
    ],
  },
  reference_consent: {
    key: 'reference_consent', screen: '4', title: 'Reference Check and Authorization Consent Form Disclosure', version: 3, status: 'approved', signature: 'typed',
    intro: ['Please read the information on this form carefully and completely.'],
    sections: [
      { h: 'Authorization', p: [
        `I have applied for employment with ${COMPANY} and have provided information about my previous employment. I authorize ${COMPANY} to conduct a reference check with my present and/or previous employer(s). I understand that reference information may include, but not be limited to, verbal and written inquiries or information about my employment performance, professional demeanor, rehire potential, dates of employment, salary, and employment history.`,
        /* v2 (her decision): the broad liability release is removed pending counsel review */
        `My signature below authorizes my former or current employers and references to release information regarding my employment record with their organizations and to provide any additional information that may be necessary for my application for employment with Caring Companions In-Home Senior Care, whether the information is positive or negative.`,
        /* her decision 2: the awkward sentence reworded; the final wording goes to her before publishing */
        `I further authorize ${COMPANY} to contact the references I provide and to verify relevant employment information, and to obtain feedback and references from my supervisors over the course of my employment with the Company. I understand that this feedback may be used in decisions about my employment. This form may be photocopied or reproduced as a facsimile, and these copies will be as effective as a release or consent as the original which I sign. This release and/or a copy of this release shall be valid for one year from the date it was signed.`,
      ] },
      /* v3 (2026-10-11): her reminder beside the contact boxes; a phone or email and "may we contact them?" for each; one
         optional backup of each kind for when someone cannot be reached. Only references they let us contact count. */
      { h: 'Your references', p: [`Please give ${REFERENCES_REQUIRED.professional} professional references (a supervisor or manager from your work history; the people you listed are offered here with one tap) and ${REFERENCES_REQUIRED.personal} personal references (a friend, co-worker, past client, pastor or similar, not a relative). Nothing is sent to any of them until the office asks for the reference.`], tip: REFERENCE_REMINDER, items: [
        { id: 'professional_refs', label: 'Professional references', kind: 'cards', max: 4, add: 'Add a professional reference', required: true, fields: [
          { k: 'name', label: 'Full name', kind: 'text', required: true }, { k: 'company', label: 'Company', kind: 'text', required: true }, { k: 'role', label: 'Their role', kind: 'text', required: true }, ...CONTACT_FIELDS('Their')] },
        { id: 'personal_refs', label: 'Personal references', kind: 'cards', max: 4, add: 'Add a personal reference', required: true, fields: [
          { k: 'name', label: 'Full name', kind: 'text', required: true }, { k: 'relationship', label: 'How you know them', kind: 'text', required: true }, ...CONTACT_FIELDS('Their')] },
      ] },
      { h: 'A backup reference (optional)', p: ['If we cannot reach someone above, we will try your backup instead. A reference who does not answer never counts against you.'], items: [
        { id: 'backup_refs', label: 'Backup references', kind: 'cards', max: 2, add: 'Add a backup reference', fields: [
          { k: 'type', label: 'Professional or personal?', kind: 'choice', options: ['Professional', 'Personal'], required: true },
          { k: 'name', label: 'Full name', kind: 'text', required: true }, { k: 'relationship', label: 'Company and role, or how you know them', kind: 'text', required: true }, ...CONTACT_FIELDS('Their')] },
      ] },
    ],
    certification: ['I have read this authorization and I agree to it.'],
  },
  /* v2 (2026-10-13, Samantha: "rewrite the background-check authorization as a plain, understandable permission form; verify
     the actual legal requirements"). No screening company is used, so the federal consumer-report rules (FCRA standalone
     disclosure, two-step adverse action) do not apply to the office's own searches of government records (FTC staff report
     "40 Years of Experience with the FCRA", 2011, pp. 20, 32, 58). Missouri's rules do: the applicant signs a consent for a
     criminal records review (RSMo 43.540) and discloses criminal history, EDL status and FCSR status (RSMo 192.2495.5);
     knowingly hiding criminal history is a class A misdemeanor (192.2495.6). Because Missouri requires us to exclude people
     with certain convictions, expunged offenses must be disclosed too, and we must say so (RSMo 610.140.10(6) and .11).
     If a screening company is ever used again, the FCRA disclosure returns for that check. Key kept as fcra_disclosure. */
  fcra_disclosure: {
    key: 'fcra_disclosure', screen: '5a', title: 'Permission for Background Checks and References', version: 2, status: 'approved', signature: 'typed',
    sections: [
      { h: 'Why we ask', p: ['Missouri law says we must check every person who will care for our clients before they start. We run these checks ourselves, using government records. We do not use a background screening company.'] },
      { h: 'What we check', p: [
        '1. The Missouri Employee Disqualification List (EDL). Missouri law requires this.',
        '2. The Family Care Safety Registry (FCSR). Missouri law requires this. You register yourself within 15 days of starting work, and we cannot employ someone who will not register. FCSR results cover Missouri only.',
        '3. The federal OIG exclusion list (people who may not be paid by Medicare or Medicaid).',
        '4. Missouri court records on Case.net.',
        '5. A fingerprint check through the Missouri State Highway Patrol, only if one is required (for example, if you have not lived in Missouri for the last five years). You will sign the Highway Patrol\'s own forms for it. You have the right to a copy of the results and to challenge them before we make a final decision.',
        '6. Your driving record, only if you will drive clients.',
        '7. Your references and past employers, the people you listed earlier in Step 1. We may call, text or email them about your work and character.',
      ] },
      { h: 'While you work here', p: ['Missouri requires us to keep checking the EDL. Our own policy is to recheck the EDL and the OIG list every month and to rescreen you through the FCSR every year.'] },
      { h: 'Questions Missouri law requires you to answer', p: [
        'Please answer these completely and honestly. Knowingly failing to tell us about your criminal history is a class A misdemeanor under Missouri law (RSMo 192.2495).',
        'Because Missouri requires us to exclude people with certain convictions from this work, you must also tell us about any offense that was expunged (RSMo 610.140).',
        'A record is not an automatic bar to employment: we consider the nature of the offense, how long ago it happened, and whether it relates to the work.',
      ], items: [
        yesno('convicted', 'Have you ever been convicted of, or pled guilty or no contest to, a misdemeanor or felony? Include any suspended imposition of sentence, probation or parole.'),
        { id: 'convictions', label: 'If yes, please list each one.', kind: 'table', options: ['Offense', 'Date of Conviction', 'Misdemeanor or Felony', 'Location'] },
        yesno('edl_listed', 'Are you on the Missouri Employee Disqualification List?'),
        { id: 'fcsr_listed', label: 'Are you listed on any of the background check lists in the Family Care Safety Registry?', kind: 'choice', options: ['No', 'Yes', 'I am not sure'], required: true, note: 'These lists include Missouri criminal records, the sex offender registry, child abuse and neglect findings, and the EDL. If you are not sure, choose "I am not sure" and the office will talk it through with you.' },
      ] },
    ],
    certification: [
      'I consent to a criminal records review under RSMo 43.540 and to the checks listed above, using my name, date of birth and other identifying details.',
      'I give Caring Companions permission to contact my references and past employers.',
      'I understand the results are used only for hiring and employment decisions, and that this permission lasts while I apply and while I work here.',
      'My answers to the questions above are true and complete.',
    ],
  },
  /* v4 (2026-10-13): the permission and the EDL/FCSR explanations moved to screen 5a; this form keeps only the details the
     checks need. Key kept as edl_fcsr_consent. */
  edl_fcsr_consent: {
    key: 'edl_fcsr_consent', screen: '5b', title: 'Your Details for the Background Checks', version: 4, status: 'approved', signature: 'typed',
    sections: [
      { h: 'For your background checks', p: ['We need these to run the checks you gave permission for on the previous screen and to request your Family Care Safety Registry screening. They are kept encrypted on our server, seen only by the office person who orders your checks, and every look is logged.'], items: [
        { id: 'ssn', label: 'Social Security number', kind: 'text', required: true, locked: true, note: 'Typed twice, digits only. Never shown again; your record says "on file, ending" with the last four digits.' },
        { id: 'dob', label: 'Date of birth', kind: 'date', required: true, locked: true },
        text('address1', 'Street address', { required: true }), text('address2', 'Apartment / unit'), text('city', 'City', { required: true }), { id: 'state', label: 'State', kind: 'choice', options: STATES, required: true }, text('zip', 'Zip code', { required: true }),
      ] },
    ],
    certification: ['The information I gave for my background checks is correct, and it may be used only for the checks I gave permission for.'],
  },
  availability: {
    /* v3 (Samantha, 2026-10-14): one more yes/no, texts about open shifts OUTSIDE their availability (outside_shift_texts) */
    key: 'availability', screen: '6', title: 'Caregiver Availability & Scheduling Commitment', version: 3, status: 'approved', signature: 'typed+initials',
    sections: [
      { h: 'Why this form is important', p: [
        'At Caring Companions, one of our highest priorities is providing clients with dependable, consistent caregivers. To do that, we hire and schedule caregivers based in part on the committed availability they provide during the hiring process.',
        'Before we offer client assignments, we carefully consider each caregiver\'s availability, experience, skills, preferences, and travel area to create the best possible match for both the client and the caregiver.',
        'The availability you provide on this form is considered your committed availability during your first ninety (90) days of employment. We rely on this information when making hiring decisions and assigning clients.',
        'We understand that unexpected life events can happen. However, significant reductions or changes to your committed availability during your first 90 days may reduce the client assignments available to you and may affect your continued employment.',
      ] },
      { h: 'About your hours', p: [
        'Home care is different from many other industries. Because we provide care based on our clients\' schedules and needs, Caring Companions cannot promise or guarantee a specific number of work hours.',
        'Our goal is to build a schedule that meets both your needs and our clients\' needs. We work hard to help caregivers reach the number of hours they are seeking whenever possible. The number of hours you receive depends on many factors, including: your committed availability; the geographic area you\'re willing to serve; the types of clients you\'re willing and qualified to care for; your experience and completed training; client requests and compatibility; current client needs; existing clients ending services; new client referrals.',
        'Many caregivers begin with fewer hours and gradually build a consistent schedule as new clients begin services and additional opportunities become available.',
        'The more flexible your availability, travel distance, and assignment preferences are, the greater the opportunity to build the number of hours you are seeking.',
      ] },
      { h: 'Weekly committed availability', p: ['For each day, tap the times you are available to work (morning, afternoon, evening, overnight), or "Not available". You can add exact hours beside each day. Example: 7:00 AM to 3:00 PM. If a day includes overnight hours, note that in the hours (e.g., "10:00 PM to 6:00 AM").'], items: [
        { id: 'windows', label: 'Monday to Sunday', kind: 'table', options: ['Morning', 'Afternoon', 'Evening', 'Overnight', 'Not available', 'Hours (optional)'], required: true },
        { id: 'hours_ideal', label: 'Requested hours per week: Ideal', kind: 'number', required: true }, { id: 'hours_min', label: 'Minimum I can accept', kind: 'number', required: true }, { id: 'hours_max', label: 'Maximum available', kind: 'number', required: true },
      ] },
      { h: 'Scheduling preferences', p: ['I am willing to work:'], items: [
        { id: 'shift_prefs', label: 'Shifts', kind: 'multi', options: ['Morning shifts', 'Afternoon shifts', 'Evening shifts', 'Overnight shifts', 'Weekends', 'Holidays', 'Short notice / same-day assignments'], required: true },
        text('overnight_nights', 'Overnight shifts: which nights?'),
      ] },
      { h: 'Travel', items: [{ id: 'max_miles', label: 'Maximum distance I\'m willing to travel', kind: 'choice', options: ['10 miles', '20 miles', '30 miles', '40+ miles'], required: true }] },
      { h: 'Open shift notifications and texts', items: [
        yesno('open_shift_texts', 'I would like to receive notifications for available Open Shifts that match my availability.'),
        yesno('outside_shift_texts', 'I would also like texts about open shifts outside my availability, in case I am able to take them. I understand I can always say no to those shifts.'),
        /* section 21: the text consent line, refreshed at hire */
        yesno('text_consent', 'You may text me about shifts and schedules at this number.'),
      ] },
    ],
    certification: [
      'By signing below, I certify that the availability listed on this form is accurate and represents my committed availability during my first ninety (90) days of employment.',
      'I understand that: Caring Companions has relied on this committed availability in making its hiring decision. If I substantially reduce my committed availability during my first ninety (90) days of employment, Caring Companions may no longer have client assignments that match my new availability. This may reduce the hours available to me and may affect my continued employment. Caring Companions does not guarantee any minimum or maximum number of work hours. Caring Companions will make reasonable efforts to build the schedule and hours I have requested based on my availability, qualifications, and client needs. Nothing in this form creates a contract of employment or changes the at-will nature of my employment.',
      'By signing below, I acknowledge that I have carefully reviewed my availability and understand that Caring Companions will rely on this information when hiring me, matching me with clients, and building my work schedule.',
      /* v2: the AxisCare instructions made plain */
      'AxisCare scheduling. I understand that: The office keeps my availability on file from this form. If I need to change it, I tell the office first, as soon as possible. Once the office approves the change, I update my availability in the AxisCare app so that AxisCare and the office always match. (Initials)',
    ],
  },
  experience: {
    key: 'experience', screen: '7', title: 'Caregiver Experience & Client Matching Profile', version: 2, status: 'approved', signature: 'typed',
    sections: [
      { h: 'Tell us about your experience', p: [
        'Our goal is to match you with clients where you can be successful and confident. Everyone has different backgrounds, strengths, and preferences. Some caregivers enjoy companionship visits, while others have years of experience providing personal care or assisting clients with more complex needs.',
        'This form helps us understand the types of clients you\'re comfortable serving today. Your selections help us make better matches and may change over time as you gain experience or complete additional training.',
        'Please tell us about the types of clients you feel comfortable caring for today. There are no right or wrong answers. We want to match you with clients where you\'ll feel confident and provide excellent care. Your selections will be considered along with your previous work experience, training, certifications, and professional references.',
      ] },
      { h: LEVELS[1].title, p: ['Typical duties: ' + LEVELS[1].duties], items: [{ id: 'level1', label: 'Based on my experience and comfort level, I am willing to accept Level 1 clients.', kind: 'choice', options: ['Yes', 'Not at this time'], required: true }] },
      { h: LEVELS[2].title, p: ['Typical duties: ' + LEVELS[2].duties], items: [{ id: 'level2', label: 'Based on my experience and comfort level, I am willing to accept Level 2 clients.', kind: 'choice', options: ['Yes', 'Not at this time'], required: true }] },
      { h: LEVELS[3].title, p: ['Typical duties: ' + LEVELS[3].duties], items: [{ id: 'level3', label: 'Based on my experience and comfort level, I am willing to accept Level 3 clients.', kind: 'choice', options: ['Yes', 'Not at this time'], required: true }] },
      { h: 'Specialty client experience', p: ['Please indicate the client populations you feel comfortable serving.'], items: [{ id: 'specialties', label: 'Client population', kind: 'table', options: SPECIALTIES, required: true }] },
      { h: 'Homes and clients you are comfortable with', p: ['Yes or not at this time for each. These are your own answers; the office used to guess them.'], items: [{ id: 'matching_facts', label: 'Comfortable with', kind: 'table', options: MATCHING_FACTS.map((m) => m.label), required: true }, /* v2: the caregiver chooses their languages; nothing is assumed */
        { id: 'languages', label: 'Languages you speak well enough to care for a client', kind: 'multi', options: LANGUAGES, required: true }, text('languages_other', 'Another language not listed')] },
      { h: 'Experience', items: [{ id: 'experience', label: 'Approximately how much experience do you have providing in-home care?', kind: 'choice', options: ['None, I\'m new to caregiving.', 'Less than 6 months', '6 months to 2 years', '2 to 5 years', 'More than 5 years'], required: true }] },
      { h: 'Your preferences', p: ['We understand that some caregivers have extensive experience but prefer certain types of assignments.'], items: [
        { id: 'preferred_levels', label: 'Which level of clients would you prefer to work with?', kind: 'choice', options: ['Level 1 only', 'Levels 1 & 2', 'Levels 1, 2 & 3', 'Any level I\'m qualified for'], required: true },
        text('exclusions', 'Is there any type of client assignment you would prefer not to accept?'),
      ] },
    ],
    certification: [
      'I understand that this form is used to help Caring Companions match me with clients based on my experience, training, comfort level, and preferences.',
      'I understand that my selections may be reviewed as my experience grows, additional training is completed, and information is verified through my references and employment history.',
      'Everyone starts at Level 1. Level 2 and Level 3 assignments follow once the office verifies your previous experience through your references and employment history and an authorized person approves the level. Your answers here are your own words and never raise your level by themselves.',
    ],
  },
  /* v5 (2026-10-13, Samantha's driver and non-driver rules): only for an applicant who answers YES to "Are you willing and
     able to transport clients in your personal vehicle as part of your caregiving duties?". Photos of the license front
     and back and proof of insurance are required; uploading never authorizes driving; the office verifies and approves;
     an expired license or insurance suspends driving until new documents are verified. Someone who answers NO signs the
     Non-Driver Agreement instead (FORMS.non_driver). */
  vehicle: {
    key: 'vehicle', screen: '8', title: 'Driver/Vehicle Insurance & Transportation Standards Agreement', short: 'Driver agreement', when: { id: 'transport_willing', equals: 'yes' }, version: 5, status: 'approved', signature: 'typed',
    sections: [
      { h: 'Your license and insurance', p: ['Take a clear picture of each with your phone, or choose a file you already have. If you do not have a current license and insurance right now, go back and answer No; you can become a driver later.'], items: [
        { id: 'license_front', label: 'Your driver\'s license, front', kind: 'photo', required: true },
        { id: 'license_back', label: 'Your driver\'s license, back', kind: 'photo', required: true },
        { id: 'license_number', label: 'Driver\'s license number', kind: 'text', locked: true, note: 'Needed so the office can verify your license and driving record before you are approved to transport clients. Kept encrypted; your record says "on file, ending" with the last four characters.' },
        { id: 'license_state', label: 'License state', kind: 'choice', options: STATES, required: true }, { id: 'license_expires', label: 'License expiration date', kind: 'date', required: true },
        { id: 'insurance_doc', label: 'Proof of current auto insurance (your insurance card or declarations page)', kind: 'photo', required: true },
        text('insurer', 'Insurance company', { required: true }), { id: 'insurance_expires', label: 'Insurance expiration date', kind: 'date', required: true },
      ] },
      { h: 'Insurance responsibility', p: [
        'I agree to notify Caring Companions immediately if my driver\'s license is suspended or revoked, or if my insurance is canceled or lapses, and to upload my updated license or proof of insurance whenever either is renewed, replaced or changed.',
        'I understand and acknowledge that Caring Companions does not provide automobile insurance coverage for employees operating personal vehicles. I further understand that I am solely responsible for all liability, claims, damages, injuries, fines, or losses arising from my operation of a personal vehicle, including while transporting clients. Any mileage reimbursement or stipend provided does not constitute insurance coverage.',
        /* v2 (her decision 7): the indemnification clause is removed pending counsel review */
      ] },
      /* v2: the coverage requirement and the payer list are kept as today's form states them and marked for her confirmation */
      /* v4 (2026-10-13): no bracketed note to the applicant; any higher limit is told to them in writing before they drive a client */
      /* v3 (her decisions 4 and 5): the insurance requirement, the transportation conditions, and no authorization from Step 1 answers */
      { h: 'Required Standards for Transporting Clients', p: ['Employees who transport clients must meet all of the following requirements: Maintain a current, valid driver\'s license. Maintain current automobile liability insurance that meets at least Missouri\'s legal minimums and that permits transporting clients as part of paid caregiving. If the Company requires higher limits or other coverage, the office will tell you in writing before you transport a client. Have an acceptable driving record, verified by a Motor Vehicle Record check ordered by the office. Complete any transportation training the Company requires. Use only a personally owned or legally authorized private vehicle approved by the agency.', 'A caregiver may transport a client only when the client\'s Care Plan authorizes it, the payer permits it (Private Pay, Missouri Medicaid HCBS, or VA Community Care Network (VA CCN)), and the office has approved both the caregiver and the vehicle. No caregiver is authorized to drive clients based on their answers in Step 1 alone.'] },
      { h: 'Vehicle Safety & Condition Requirements', p: ['Any vehicle used to transport clients must be safe, operational, and well-maintained, including properly functioning: headlights, taillights, and turn signals; windshield and windshield wipers; brakes and seat belts; heater and air conditioning; tires properly inflated with a minimum of 1/8 inch tread depth at the point of greatest wear. The vehicle must also be clean and free of trash or clutter, and free of leaking oil, gasoline, or other fluids.'] },
      { h: 'Driver Conduct & Safety Expectations', p: ['While transporting clients, I agree to: Not smoke, vape, text, email, or use a mobile device while driving. Not drive while fatigued, ill, impaired, or under the influence of alcohol, drugs, or medications that affect driving ability. Obey all traffic laws and operate the vehicle in a safe, defensive manner. Transport only the authorized client (no unauthorized passengers). Avoid driving in unsafe weather or road conditions. Never operate a client\'s vehicle unless expressly authorized in writing by the agency.'] },
      { h: 'Accident & Incident Reporting', p: ['I agree to immediately notify Caring Companions of any accident, traffic citation, or incident that occurs while transporting a client. I will comply with all legal reporting requirements and understand that I may not transport clients again until cleared by the agency.'] },
      { h: 'Agency Rights & Acknowledgment', p: ['I understand that Caring Companions reserves the right to approve, suspend, or revoke driving privileges at any time based on safety concerns, compliance issues, insurance status, or policy violations. Failure to comply with this policy may result in disciplinary action, up to and including termination. Driving duties are assigned only after the office has verified my license, my insurance and my driving record, and has approved me and my vehicle.'] },
      { h: 'Keeping your license and insurance current', p: ['Caring Companions keeps a current copy of your driver\'s license and proof of insurance on file for as long as you are approved to transport clients. We will send you a secure link to upload new copies 30 days before either expires, and again at 14 and 7 days if they are not updated. If your license or insurance expires before the office has your updated copy, your approval to transport clients is suspended until the office receives and verifies it.'] },
      { h: 'Driver Acknowledgment', p: ['I meet all of the requirements above and request approval to transport clients. I understand that I may not transport any client until the office has verified my license, my insurance and my driving record and has approved me and my vehicle.'] },
    ],
    certification: ['I have read this agreement, the information and documents I gave are current and true, and I agree to it.'],
  },
  /* v2 (2026-10-13): Samantha's own Non-Driver Agreement & Acknowledgment, word for word (it replaces the draft v1). For an
     applicant who answers NO to transporting clients; also signed later on the driver link when someone stops driving.
     The employee's name, position and date print on the signed PDF. */
  non_driver: {
    key: 'non_driver', screen: '8', title: 'Non-Driver Agreement & Acknowledgment', short: 'Non-driver agreement', when: { id: 'transport_willing', equals: 'no' }, version: 2, status: 'approved', signature: 'typed',
    sections: [
      { h: '1. Non-Driver Designation', p: [
        'I understand and acknowledge that I am designated as a Non-Driver with Caring Companions In-Home Senior Care.',
        'I understand that this designation means I am not authorized to transport clients in any vehicle while performing my employment duties unless I have received prior written approval from Caring Companions.',
      ] },
      { h: '2. Transportation Restrictions', p: [
        'While designated as a Non-Driver, I agree that I will not:',
        '• Transport a client in my personal vehicle.',
        '• Drive a client\'s vehicle or a family member\'s vehicle to transport a client.',
        '• Transport clients in another employee\'s vehicle while acting as the driver.',
        '• Accept a client\'s or family member\'s request to drive them, even if they offer payment or reimbursement.',
        '• Drive a client to appointments, shopping, errands, social activities, or any other destination as part of my employment duties without written authorization from Caring Companions.',
        'These restrictions apply regardless of whether transportation is requested by the client, a family member, or another individual.',
      ] },
      { h: '3. Reporting Transportation Requests', p: [
        'If a client or family member asks me to provide transportation, I agree to politely explain that I am not authorized to transport clients and notify the Caring Companions office.',
        'I understand that a client\'s or family member\'s permission does not replace authorization from Caring Companions.',
      ] },
      { h: '4. Employment and Scheduling', p: [
        'I understand that my Non-Driver designation does not automatically disqualify me from employment with Caring Companions.',
        'I may be assigned to clients and shifts that do not require me to transport clients.',
        'I understand that certain assignments may require an Approved Driver, and I will not accept or perform transportation duties unless I have been approved.',
        'I remain responsible for having reliable transportation to and from my assigned work locations, consistent with my employment requirements.',
      ] },
      { h: '5. Changing to Approved Driver Status', p: [
        'If I wish to transport clients in the future, I understand that I must first:',
        '1. Notify Caring Companions that I am requesting a change in my transportation status.',
        '2. Complete and sign the Driver/Vehicle Insurance & Transportation Standards Agreement.',
        '3. Provide a copy of the front and back of my current driver\'s license.',
        '4. Provide current proof of automobile insurance.',
        '5. Meet all driving, insurance, background verification, and other applicable agency requirements.',
        '6. Receive written approval from Caring Companions before transporting any client.',
        'I understand that submitting documents or signing the Driver Agreement does not automatically authorize me to transport clients.',
      ] },
      { h: '6. Compliance and Accountability', p: [
        'I understand that transporting a client without authorization is a violation of Caring Companions policy and may result in disciplinary action, up to and including termination of employment, consistent with applicable law.',
        'I agree to follow my assigned care plans, scheduling instructions, and agency transportation policies.',
      ] },
    ],
    certification: [
      '7. Employee Acknowledgment. By signing below, I acknowledge that:',
      '• I have read and understand this Non-Driver Agreement.',
      '• I understand that I am not authorized to transport Caring Companions clients while designated as a Non-Driver.',
      '• I agree to notify the office if a client or family member requests transportation.',
      '• I understand that I must receive written agency approval before performing any client transportation duties.',
      '• I understand that this designation will remain in effect until Caring Companions formally changes my transportation status.',
    ],
  },
  /* 2026-10-13: the forms moved from Viventium into Step 1 (Samantha: "the Hub is our central location for all signed
     employment agreements, policies, acknowledgments"). Each is HER Viventium form with only the changes the legal review
     found necessary (launch/review/viventium-forms/*-legal-review.md); every change is shown to her side by side before
     approval. All PROPOSED until she approves the set. */
  employment_agreement: {
    key: 'employment_agreement', screen: '10', title: 'Employment Agreement', short: 'Your employment agreement', layout: 'document', countersign: true, version: 1, status: 'approved', signature: 'typed',
    intro: ['This agreement is between Troutman Enterprises, LLC DBA Caring Companions In-Home Senior Care ("Employer") and the employee named on this agreement ("Employee"). It is signed electronically by both.'],
    sections: [
      { h: 'Recitals', p: ['A. Employer is engaged in the business of providing non-medical home care and/or home healthcare services (the "Business").', 'B. Employer wishes to obtain the services of Employee in furtherance of Employer\'s Business, and Employee wishes to provide services in such capacity.', 'C. This agreement is expressly intended to govern the respective rights and duties of Employer and Employee, both during the term of this agreement and after its termination.', 'THEREFORE, in consideration of the mutual promises and covenants hereinafter set forth, Employer and Employee agree as follows:'] },
      { h: '1. Duties', p: ['Employer shall employ Employee for the position and duties set forth in the Position Description Employee signed with the job offer, together with such other duties and responsibilities as may be assigned by Employer from time to time.'] },
      { h: '2. Term', p: ['Employee\'s employment begins on the date Employer gives Employee written confirmation of final approval to work (the "Hire Date"). This agreement is signed before the Hire Date and takes effect on the Hire Date. If final approval is not given, no employment begins. Employment continues until ended under section 4.'] },
      { h: '3. Compensation', p: ['Employee shall be compensated in accordance with the signed job offer, the terms of which are incorporated herein.'] },
      { h: '4. Termination', p: ['Employer and Employee each acknowledge and agree that the relationship between them shall be employment-at-will. Either party may end the employment at any time, with or without cause and with or without advance notice. Employer will confirm a separation in writing.'] },
      { h: '5. Definitions', p: ['(a) "Client" means a client or patient of Employer.', '(b) "Personally Identifiable Information" means names, physical and email addresses, telephone numbers, Social Security Numbers, and other identifiers that permit the physical or online contacting of a specific individual concerning Clients or other employees of Employer ("Co-workers").', '(c) "Protected Health Information" means protected health information or individually identifiable health information concerning Clients.', '(d) The words "includes" and "including" are to be construed to include the phrase "but not limited to" throughout this agreement.'] },
      { h: '6. Confidential Information and Nondisclosure Covenant', p: [
        '(a) In the performance of his/her duties under this agreement, Employee will have access to certain confidential procedures, methods, products, systems, techniques, and information used in Employer\'s Business, including, but not limited to: (a) Client information, (b) marketing methods, (c) pricing methods and techniques, (d) proprietary software, (e) demographic information, (f) financial information, (g) information contained in Employer\'s operations manual, and (h) other information about the Business that is not known to the public and gives the Employer an advantage over competitors who do not know or use it ("Confidential Information"). Confidential Information may be written, oral, recorded, or stored on tapes, disks, or other electronic media or digital storage devices. Confidential Information does not include information that is in the public domain (but information will not be deemed to be in the public domain merely because it is embraced by more general information that is in the public domain) other than as the result of a breach of this agreement. Confidential Information does NOT include employee wages, hours, or terms and conditions of employment. Employee acknowledges that Employer has invested substantial amounts of time and money in the development of such Confidential Information. The parties acknowledge and agree that the Confidential Information (i) derives independent economic value, actual or potential, from not being generally known to the public or to other persons who can obtain economic value from its disclosure or use; and (ii) is the subject of reasonable efforts by Employer to maintain its secrecy.',
        '(b) Except in the ordinary course of business and as necessary to perform his/her duties under this agreement or as otherwise specifically authorized in writing by Employer, Employee shall never, at any time during or after the termination of his/her employment with Employer, directly or indirectly use, communicate, disclose or disseminate any Confidential Information. All Confidential Information is and will remain the sole property of Employer. This Nondisclosure Covenant has no geographic, territorial, or temporal restriction, and applies wherever Employee resides in the future.',
        '(c) Employee shall not, other than in the ordinary course of business and in connection with the performance of his/her duties under this agreement, copy, take or remove from Employer\'s premises or a Client\'s home any books of account, files, records, client lists, documents or other materials relating to Employer\'s Business or Clients. Employee hereby acknowledges that all such materials are and shall at all times remain the exclusive property of Employer, and Employee hereby waives and disclaims any interest therein or rights thereto.',
        '(d) Upon the termination of Employee\'s employment for any reason by either Employer or Employee, or at any time upon Employer\'s request, Employee immediately shall return and surrender to Employer all originals and copies of any files, records, documents, Confidential Information, equipment and other property belonging to Employer, and shall delete Employer and Client information from any personal device.',
        '(e) National Labor Relations Act and Government Agencies. Nothing in this agreement prohibits Employee from discussing or disclosing wages, hours, or other terms and conditions of employment, from engaging in activity protected by Section 7 of the National Labor Relations Act, or from communicating with, filing a charge with, or taking part in an investigation by any government agency, including the National Labor Relations Board, the Equal Employment Opportunity Commission, the U.S. Department of Labor, OSHA, the HHS Office of Inspector General, and the Missouri Department of Health and Senior Services.',
        '(f) Defend Trade Secrets Act Notice. Employee is hereby notified in accordance with the Defend Trade Secrets Act of 2016 (18 USC § 1833(b)) that Employee will not be held criminally or civilly liable under any federal or state trade secret law for the disclosure of a trade secret that is made in confidence to a federal, state, or local government official, either directly or indirectly, or to an attorney solely for the purpose of reporting or investigating a suspected violation of law, or is made in a complaint or other document that is filed under seal in a lawsuit or other proceeding. If Employee files a lawsuit for retaliation against Employer for reporting a suspected violation of law, Employee may disclose Employer\'s trade secrets to Employee\'s attorney and use the trade secret information in the court proceeding if Employee files any document containing the trade secret under seal, and does not disclose the trade secret, except pursuant to court order.',
        '(g) Employee represents and warrants that his or her employment with Employer will not violate the terms and conditions of any other agreements entered into by Employee before Employee\'s employment with Employer. Employee represents and warrants that to the extent he/she signed any non-compete, non-solicitation or other agreement with any company or former employer regarding proprietary or confidential information, he/she will provide a copy of such agreement to Employer at or before the start of his/her employment. Employee further represents and warrants that he/she is not bringing with him/her to Employer any files, documents, data, equipment, or other information that may be deemed confidential or proprietary to anyone else, including Employer\'s former employers. Employee agrees to indemnify Employer for losses caused by Employee\'s knowing breach of any such agreement, to the extent permitted by law.',
      ] },
      { h: '7. HIPAA Requirements', p: [
        '(a) The parties agree that the term "Confidential Information" as used in this agreement includes Protected Health Information and Personally Identifiable Information of Clients, and Personally Identifiable Information of Co-workers.',
        '(b) To the extent that Employer qualifies as a "covered entity" as defined by the Health Insurance Portability and Accountability Act of 1996 ("HIPAA"), and privacy regulations published by the U.S. Department of Health and Human Services contained at 45 C.F.R. §§ 160 and 164 ("HIPAA Regulations"), which may be periodically revised or amended, and other applicable laws, Employee agrees to protect and provide for the privacy and security of Clients\' Protected Health Information.',
        '(c) Employee shall use appropriate safeguards to prevent the use and/or disclosure of all Protected Health Information and Personally Identifiable Information relating to Clients, Clients\' family members, or Co-workers, whether made available by or obtained from Clients, Co-workers, or Employer.',
        '(d) Employee\'s disclosure of Protected Health Information and Personally Identifiable Information will be limited to only those purposes that are necessary to perform his/her duties under this agreement and specifically detailed in Employee\'s job responsibilities, unless otherwise permitted in writing by Employer.',
        '(e) Employee shall never: (a) use or further disclose any Protected Health Information or Personally Identifiable Information except as provided with the prior written approval of Employer and the Client, as the case may be; or (b) use or further disclose any Protected Health Information in a manner that would violate any provision of HIPAA Regulations. Employee shall immediately report to Employer, in a timely manner, any unauthorized use or disclosure of Protected Health Information of which Employee becomes aware.',
        '(f) Upon termination of Employment, Employee shall return all Protected Health Information and Personally Identifiable Information that Employee maintains in any form and shall retain no copies thereof. If Employee is unwilling or unable to return any Protected Health Information or Personally Identifiable Information, Employee shall destroy such information, regardless of whether its form is paper or electronic.',
        '(g) Employee shall indemnify Employer for losses caused by Employee\'s willful misconduct or knowing violation of law or of this agreement in connection with any unauthorized use or disclosure of Protected Health Information or Personally Identifiable Information, to the extent permitted by law.',
        '(h) The provisions of this agreement are not intended to restrict or otherwise limit the application of HIPAA to the parties. This provision is intended only to outline the parties\' general duties as required by HIPAA. Employee and Employer recognize that they are fully subject to all provisions of HIPAA, regardless of whether the provisions are included in this agreement.',
        '(i) The terms of this section will survive the termination of Employee\'s employment (whether voluntary or involuntary) for any reason.',
      ] },
      { h: '8. Non-Solicitation Covenant', p: [
        '(a) Employee agrees that during his or her employment and for a period of twelve (12) months following the cessation of Employee\'s employment for any reason, Employee shall not directly or indirectly use any Confidential Information in order to:',
        '(1) Solicit or induce any individual, corporation or other entity which is a Client to whom Employee provided services, or about whom Employee received Confidential Information, during the last twelve (12) months of employment, in an attempt to: (i) enter into any business relationship with that Client if the business relationship is competitive with any aspect of the Business; or (ii) reduce or eliminate the business such Client conducts with Employer; or',
        '(2) Solicit or induce any employee, contractor or vendor of Employer: (i) to provide services to any individual, corporation or entity whose business is competitive with the Business; or (ii) to leave Employer\'s employ to accept employment with an individual, corporation or entity whose business is competitive with Employer\'s.',
        '(b) As used in section 8 and its subparts, "solicit or induce" means that in any communication(s) with any individual, corporation or entity, Employee affirmatively requests or expressly suggests that the individual, corporation or entity do any of the activities enumerated in section 8 and its subparts.',
        '(c) The prohibitions contained in section 8 and its subparts extend to: (i) activities undertaken by Employee directly on Employee\'s own behalf, and (ii) activities undertaken by Employee indirectly through any individual, corporation or entity that undertakes such prohibited activities with Employee\'s assistance.',
        '(d) During employment and for twelve (12) months after it ends, Employee will not accept private employment directly from a Client Employee served, or from that Client\'s family, to provide the same kind of services, unless Employer agrees in writing. Employee will not disclose Employer\'s Client billing rates. Employee may discuss Employee\'s own wages and working conditions with anyone.',
      ] },
      { h: '9. Breach of Nondisclosure or Non-solicitation Covenants', p: ['Employee acknowledges and agrees that each and any breach of or failure to perform his/her obligations under section 6, 7 or 8 above will cause immediate and irreparable harm to Employer in a manner that cannot be measured nor adequately compensated in damages. Employee agrees that in the event of any such breach or failure to perform his/her obligations, Employer shall be entitled to temporary, preliminary, and permanent injunctive relief to restrain such breach or compel performance by Employee, and to recover from Employee all costs and expenses of any proceedings filed to obtain such injunctive relief, including reasonable attorneys\' fees. Employee further agrees that in the event Employee breaches or fails to comply with the provisions of section 6 or 8 above, Employee shall pay over to Employer the compensation or profits Employee received from the solicited Client or business as a result of such breach. Nothing in this agreement authorizes any deduction from wages owed by Employer. Such relief shall be in addition to any other remedies that Employer may have at law or in equity. Waiver by either party of the performance or breach of any term or condition of this agreement shall not constitute a continuing waiver of the same or any other term, condition, or breach.'] },
      { h: '10. Client Recording Devices: Notice and Acknowledgment', p: ['Clients or their families may use video or audio monitoring devices in their homes and yards, and some may be concealed. Employer does not control Client devices. Some Clients and families take comfort from these devices and may insist that they remain in place as a condition of service. Employee acknowledges this notice and consents to being recorded while performing services in areas a Client lawfully monitors. Employer will ask Clients not to record in bathrooms or private changing areas and not to record conversations they are not part of. Employee should report any recording concern to the office.'] },
      { h: '11. Employer Equipment', p: ['All Employer Equipment provided or made available to Employee will at all times remain the property of Employer. Employee shall use reasonable care in handling, using and maintaining the security of all Employer Equipment in Employee\'s possession or control. Employee shall use Employer Equipment only for its intended purposes (e.g., to manage and/or access information, document processing, communications, recordkeeping, etc.) and in accordance with the functions of Employee\'s job requirements and policies adopted by Employer from time-to-time. Employee shall NOT use Employer Equipment in or for any illegal, unsafe, or unauthorized purpose. Employee shall not permit other persons (except for other employees of Employer) to use or possess Employer Equipment without Employer\'s prior authorization. Employee shall promptly report any malfunction, irregularity, damage, or loss of Employer Equipment to Employer. All Employer Equipment is subject to inspection by Employer at any time without prior notice. Employee shall return all Employer Equipment to Employer upon demand or within three days after any change in Employee\'s job responsibilities or the termination of Employee\'s employment (whether voluntary or involuntary) for any reason. Employer may seek reimbursement for Employer Equipment lost or damaged through Employee\'s negligence or misconduct, or not returned within three days after the termination of employment. Employer will not deduct any amount from wages except as permitted by federal and Missouri law and with Employee\'s separate written authorization for that specific deduction, and never below minimum wage or from final wages. "Employer Equipment" means a computer, tablet, printer, monitor, docking station, mobile, Internet or "smart" telephone, or other equipment or property, including all components thereof and software, documents and other files installed or stored thereon, that Employer may provide Employee at any time for use in connection with Employee\'s duties under this agreement.'] },
      { h: '12. Drug and Alcohol Use', p: ['Employee shall not: (i) while on the job (whether or not on Employer\'s premises), use, consume, or be under the influence of alcohol or other substance that impairs his/her judgment, reflexes, or the performance of his/her duties under this agreement; or (ii) engage in the illegal possession, distribution, dispensation, or use of drugs while on the job (whether or not on Employer\'s premises). Following any offer of employment, and prior to or shortly after beginning employment, Employee agrees to take and submit to a chemical test of Employee\'s blood, breath, hair, or urine, to determine the alcohol, drug, or alcohol and drug content thereof ("drug test"), if Employer requires one under its screening policy. As a continuing condition of employment, Employee agrees to take and submit to a drug test at any time requested by Employer upon reasonable suspicion that Employee has engaged in drug use or in the consumption of alcohol or other substances in violation of this provision, and after a workplace accident or incident resulting in employee or Client injury when drug or alcohol use could have contributed to it. Employee authorizes the lawful release of drug test results to Employer. Testing will comply with applicable law, including Article XIV of the Missouri Constitution. Employer shall pay the cost of all drug tests.'] },
      { h: '13. Driver\'s License and Automobile Insurance', p: ['Employee may transport Clients only after Employer has approved Employee as a driver under the Driver/Vehicle Insurance & Transportation Standards Agreement, which sets out the license, insurance and verification requirements. An Employee designated as a Non-Driver under the Non-Driver Agreement & Acknowledgment may not transport Clients. Employee is responsible for Employee\'s own vehicle and for keeping the insurance the law and that agreement require.'] },
      { h: '14. Background Screening', p: ['Employee has completed Employer\'s separate Permission for Background Checks and References, which governs the background checks Missouri requires and Employer\'s rechecks during employment.'] },
      { h: '15. Severability', p: ['If any provision of this agreement shall be held to be illegal, invalid or unenforceable in any respect, Employer and Employee agree that such term or provision shall be deemed to be modified to the extent necessary to permit its enforcement to the maximum extent permitted by applicable law, and the remainder of this agreement and all other provisions hereof shall not be affected thereby.'] },
      { h: '16. Assignment', p: ['This agreement shall be binding upon and inure to the benefit of Employer, its successors and assigns, and to the benefit of Employee, his/her heirs and legal representatives, except that Employee\'s duties to perform future services and the right to receive payment therefore are hereby expressly agreed to be non-assignable and nontransferable.'] },
      { h: '17. Arbitration Agreement and Class Action Waiver', p: [
        '(a) Agreement to Arbitrate all Disputes. It is agreed that any controversy, claim or dispute between Employer and Employee that is in any way related to the terms of this agreement, employment and/or cessation of employment, and which is otherwise actionable at law, will be resolved exclusively by final and binding arbitration before a neutral arbitrator under the Federal Arbitration Act and the laws of the State of Missouri. This is a mutually-binding agreement and mutual waiver of a trial before the state and federal courts of the United States and is equally applicable to both the employee and the employer such that each grants this consideration to the other. Any claim by either party against the other must be submitted to arbitration, except that either party may ask a court for temporary injunctive relief to keep things as they are until the arbitrator decides. These claims include, but are not limited to, claims under federal, state, and local statutory or common law, wage, overtime, or any other claims under the laws of the State of Missouri, the Federal Fair Labor Standards Act, the Age Discrimination in Employment Act, Title VII of the Civil Rights Act of 1964, as amended, the Americans with Disabilities Act, the law of contract and the law of tort. The right to file a worker\'s compensation or unemployment compensation claim, or a charge with a government agency, cannot be and is not waived by this agreement. As federal law provides (9 U.S.C. §§ 401 and 402), Employee may choose to bring a dispute involving sexual harassment or sexual assault in court instead of arbitration. Any arbitration that must be initiated pursuant to this agreement is to be conducted according to the employment rules of the American Arbitration Association ("AAA"). Employer shall bear 100% of the cost of the arbitrator, which shall be mutually agreed to under the rules of the AAA. This agreement shall not restrict the right to conduct meaningful discovery or any remedy, including punitive damages, attorney\'s fees, or injunctive relief, as provided under Missouri or federal law that would have otherwise been available at law or equity so long as the remedy or discovery device does not conflict with the rules of the AAA. Judgment upon the award rendered by the arbitrator must be in writing and may be entered in any court of competent jurisdiction. Any such arbitration shall be conducted in Greene County, Missouri, or such other place as may be mutually agreed upon by the parties under the rules of the AAA. Employer may change this arbitration agreement only for the future, on thirty (30) days\' written notice to Employee, and never for a claim already known or filed.',
        '(b) Class Action Waiver. There shall be no right or authority for any dispute to be heard or arbitrated on a class action basis, as a private attorney general, or on a basis involving disputes brought in a purported representative capacity on behalf of the general public, any other current, prospective or former employees, or any other persons similarly situated to either party. The arbitrator may not consolidate more than one person\'s claims, and may not otherwise preside over any form of a representative or class proceeding. Notwithstanding the waiver of either party\'s right to bring or participate in a class, collective or other representative proceeding, employees may have a statutory right (e.g., under the National Labor Relations Act) to act concertedly on behalf of themselves and others to challenge this policy in any forum. If an employee chooses to pursue such a challenge to this agreement, Employer will not retaliate against Employee for doing so. Employer is entitled, however, to enforce this policy, including enforcing Employee\'s agreement to arbitrate all claims and to forego pursuing any dispute brought on a class, collective or representative basis, and is entitled to seek dismissal of any such class, collective or representative action and otherwise assert this policy as a defense in any proceeding. In accordance with section 15 herein, if any portion, sentence, or provision of this Arbitration Agreement and Class Action Waiver is deemed unlawful or unenforceable by any tribunal with authority to do so, that portion is to be severed from the remainder of the agreement, which will remain in full force and effect. If a class action is found permissible in any event, the courts of the State of Missouri or United States of America shall be the only forum for the parties specifically agreeing not to arbitrate any class action.',
      ], items: [
        { id: 'ea_arbitration_initials', label: 'Your initials: 17(a) Agreement to Arbitrate', kind: 'initials', required: true },
        { id: 'ea_class_waiver_initials', label: 'Your initials: 17(b) Class Action Waiver', kind: 'initials', required: true },
      ] },
      { h: '18. Governing Law, Forum Selection, and Consent to Personal Jurisdiction', p: ['This agreement shall be governed by the laws of the State of Missouri. Pursuant to section 17 above, all disputes between Employer and Employee are to be submitted to binding arbitration. However, if a dispute is deemed validly filed before a court of civil jurisdiction, Employer and Employee hereby agree that any such action shall be brought only in a state or federal court located in or for Greene County, Missouri, and do hereby consent to the exercise of personal jurisdiction by any such court and waive any defense of lack of personal jurisdiction or improper venue for the purpose of carrying out this provision.'] },
      { h: '19. Entire Agreement and Amendments', p: ['This agreement, the signed job offer and Position Description, and the other agreements it names constitute the entire agreement between the parties with respect to the subject matter hereof and any and all prior discussions, negotiations, commitments, or understandings relating thereto are hereby superseded and merged herein. The terms and provisions of this agreement shall not be changed, amended, waived, modified or terminated in any respect whatsoever except by a written instrument executed by both Employer and Employee, except as section 17(a) provides.'] },
      { h: '20. No Waiver of Rights', p: ['Neither any failure nor any delay on the part of Employer in exercising any right, power or privilege hereunder shall operate as a waiver thereof, nor shall a single or partial exercise thereof preclude any other or further exercise or the exercise of any other right, power or privilege by Employer.'] },
      { h: '21. No Conflict with NLRA', p: ['The National Labor Relations Act guarantees employees the right to engage in concerted activities for mutual aid and protection. No provision of this agreement, and no policy adopted by Employer, is to be construed to restrain or infringe on that right. Thus, notwithstanding any provision of this agreement or any policy adopted by Employer in its employee handbook or otherwise, Employee and all other employees of Employer have the right to communicate with each other, and to act in concert, with respect to wages, hours, and terms and conditions of employment.'] },
      { h: 'Your duties with Clients', p: ['Employee will also provide any additional activities as may be requested from time to time, to help ensure that the Client\'s household runs smoothly within reason.', 'It is mutually understood and agreed that if at any time Employee is asked by a Client or a Client\'s agent to perform an activity that Employee questions or is uncomfortable with, or that is not part of the Client\'s current Care Plan, or that Employee is not willing and/or able to provide, Employee is to immediately contact his/her immediate manager or supervisor before engaging in the activity and/or accepting/declining the Client\'s or agent\'s request.', 'Owner: Samantha Troutman, (417) 234-8494.'] },
    ],
    certification: ['THIS CONTRACT CONTAINS A BINDING ARBITRATION PROVISION WHICH MAY BE ENFORCED BY THE PARTIES.', 'I have read this whole agreement, I understand it, and I agree to it. Caring Companions signs it after I do.'],
  },
  code_of_ethics: {
    key: 'code_of_ethics', screen: '12', title: 'Code of Ethics', short: 'Code of Ethics', version: 1, status: 'approved', signature: 'typed',
    sections: [
      { h: 'The following are strictly prohibited', p: [
        '• Consuming the client\'s food or drink (water is allowed).',
        '• Using the client\'s telephone for personal calls.',
        '• Accepting gifts or financial gratuities (tips) from the client/representative.',
        '• Using the client\'s car.',
        '• Lending money or items to the client/representative; borrowing money or items from the client/representative.',
        '• Consumption of alcoholic beverages, or use of medicine or drugs for any purpose, other than medical, in the client\'s home or prior to service delivery.',
        '• Discussing your own or anyone else\'s personal problems, or religious or political beliefs, with the client.',
        '• Solicitation or acceptance of money or goods for personal gain from the client.',
        '• Purchasing any item for the client not directed in the care plan.',
        '• Bringing personal visitors (children, friends, relatives, pets, etc.) to the client\'s home.',
        '• Smoking in the client\'s home.',
        '• Breach of the client\'s privacy and confidentiality of information and records.',
        '• Purchase of any item from the client even at fair market value.',
        '• Assuming control of the financial or personal affairs, or both, of the client or of his/her estate including power of attorney, conservatorship, or guardianship.',
        '• Taking anything from the client or from the client\'s home.',
        '• Committing any act of abuse, neglect, or exploitation.',
        '• Sleeping in the client\'s home, unless you are on an approved overnight shift, the client is asleep, and you stay close enough to hear and help the client.',
        '• Remaining in the client\'s home after services have been completed.',
      ] },
      { h: 'What you may do', p: ['You may use the client\'s bathroom. With the client\'s consent, you may eat a lunch you bring. You may drink the client\'s water.'] },
      { h: 'Reporting abuse, neglect, or exploitation', p: ['Missouri law makes me a mandated reporter. If I have reasonable cause to suspect abuse, neglect, or exploitation of a client, I must report it immediately to the Missouri Adult Abuse and Neglect Hotline, 1-800-392-0210. I may make the call myself or make sure a report is made. I will also tell the office the same day. If I am not sure a report was made, I will call the hotline myself. Knowingly failing to report is a class A misdemeanor (RSMo 565.188). The Company will not retaliate against me for a good-faith report (RSMo 192.2475).'] },
    ],
    certification: ['I have read, understand, and agree to be governed by this Code of Ethics.'],
  },
  medication_policy: {
    key: 'medication_policy', screen: '13', title: 'Medication Policy', short: 'Medication Policy', version: 1, status: 'approved', signature: 'typed',
    sections: [
      { h: 'Medication Policy', p: [
        'This policy is to be read by all employees of Caring Companions In-Home Senior Care. Caring Companions In-Home Senior Care is an independently owned and operated, non-medical, in-home care company.',
        'Dispensing medication(s), or pre-filling a client\'s medication box, by any employee of Caring Companions, is strictly forbidden. If a client asks you to fill their medication box, you must instead have a family member or other responsible party do it.',
      ] },
      { h: 'A Caregiver may', p: ['• Communicate appropriate information regarding self-administration.', '• Remind the client to take medication as prescribed.', '• Read the medication label to the client.', '• Hand the medication container to the client.', '• Open the medication container.', '• Apply ordinary non-prescription lotion to intact skin as part of personal care, when the client\'s care plan and payer allow it.'] },
      { h: 'A Caregiver may not', p: ['• Administer over-the-counter or prescription medications by mouth, or put drops in a client\'s eyes, ears, or nose.', '• Apply topical prescription medications.', '• Perform tasks that require sterile techniques.', '• Administer irrigation fluids to intravenous lines, Foley catheters or ostomies.', '• Administer food and fluids via feeding tubes.', '• Administer enemas or suppositories.', 'Medication administration and treatment are outside the duties of a non-medical caregiver unless the office has specifically authorized it in writing.'] },
      { h: 'Catheter and ostomy collection bags', p: [
        'Routinely emptying a urinary drainage bag or an ostomy pouch is separate from placing, inserting, changing or connecting a catheter or appliance, and separate from catheter or ostomy site care.',
        'When the client\'s care plan allows, you may empty a collection bag. You may not place, insert, change, connect, disconnect or irrigate any catheter, bag or appliance, or do catheter or ostomy site care, unless the office has authorized you in writing for that client after the required training.',
        'Medicaid clients: Missouri lists some catheter and ostomy care as Advanced Personal Care. Never do an advanced task for a Medicaid client without the authorization and training Missouri requires. If you are not sure, call the office first.',
        'Private-pay clients: an external catheter such as PureWick is placed only by a caregiver the office has trained and authorized for that client, only where the law allows it, and only when the client\'s care plan includes it.',
      ] },
      { h: 'If something is not right', p: ['If a client refuses a medication, cannot take it without hands-on help, or has a reaction, call the office. Never decide a dose. Report redness, odor, blood, or leaks around a catheter or ostomy site to the office right away.'] },
    ],
    certification: ['I have read, understand, and agree to be governed by the above terms for the Medication Policy. Failure to follow this policy may result in disciplinary action, up to and including termination.'],
  },
  hipaa_privacy: {
    key: 'hipaa_privacy', screen: '14', title: 'HIPAA & the Privacy Rule', short: 'HIPAA', version: 1, status: 'approved', signature: 'typed',
    sections: [
      { h: 'What HIPAA is', p: ['Health Insurance Portability and Accountability Act of 1996 (HIPAA): Public law passed by Congress to protect the privacy of Americans\' personal health records by safeguarding the security and confidentiality of health care information.', 'Privacy Rule: Establishes regulations for using and disclosing Protected Health Information (PHI). PHI is any information about health status, provision of health care, or payment for health care that can be linked to an individual.'] },
      { h: 'Privacy Policy', p: ['I will use and share client information only as my job requires: to care for the client, to bill for care, and to run the Company. I will share only the minimum needed. I will not look at, discuss, copy, or post client information for any other reason, during or after my employment.'] },
      { h: 'When I may share client information myself', p: ['I may share client information myself only (1) with 911, EMS, or a hospital treating the client, and (2) in an abuse, neglect, or exploitation report to the state hotline. All other requests go to the office. The Company decides the other disclosures the Privacy Rule permits, such as to family involved in care, health oversight like DHSS or MO HealthNet audits, law enforcement, coroners and funeral directors, organ donation, a serious threat to safety, and the U.S. Department of Health and Human Services.'] },
      { h: 'Most common HIPAA violations', p: ['1. Employees disclosing information: revealing information about clients to friends or coworkers who do not need it for their work.', '2. Social media: posting any client photo or information, even without a name.', '3. Lost or stolen devices: the theft of PHI through lost or stolen laptops, desktops, smartphones, and other devices that contain client information. Mobile devices are the most vulnerable to theft due to their size, which requires password-protected authorization and encryption to access client-specific information.'] },
      { h: 'Written authorization and reporting', p: ['Written authorization is required to use or disclose any individual\'s personal health information not used for treatment, payment, healthcare operations, or permitted by the HIPAA Privacy Rule. If an employee is unsure, obtaining prior authorization from the office before releasing any information is best practice.', 'I will tell the office the same day if I lose a phone or paper with client information, send information to the wrong person, or see anyone misuse it.'] },
      { h: 'Consequences', p: ['If I misuse or wrongly share client information, the Company will discipline me, up to and including termination. Knowingly obtaining or disclosing health information without authorization can be a federal crime with fines and prison. If I hold a license or certification, the Company may report my conduct to the agency that issued it when the law requires or allows.'] },
    ],
    certification: ['I have completed the Company\'s HIPAA training. I have read, understood, and agree to comply with the above terms regarding HIPAA and PHI policy and procedures.'],
  },
  /* 2026-10-13 (Samantha: "we can add client rights here too"): the six rights every client must receive in writing
     (19 CSR 15-7.021(18)(O)), the same words the client gets, and the one signed statement every employee needs before
     serving anyone: received and reviewed the rights, the Code of Ethics and the confidentiality policy, all explained
     ((24)(B)5). Shown after the Code of Ethics and HIPAA so all three are in front of them when they sign. */
  client_rights: {
    key: 'client_rights', screen: '15', title: 'Client Rights', short: 'Client Rights', version: 1, status: 'approved', signature: 'typed',
    sections: [
      { h: 'Client Rights', p: [
        'Caring Companions gives every client, and their main family caregiver when appropriate, a written copy of these rights when services begin, and we go over it with them. You get the same copy so you know what every client can expect from you.',
        'Every client has the right to:',
        '1. Be treated with respect and dignity.',
        '2. Have all of their personal and medical information kept confidential.',
        '3. Have a say in how their services are provided, as much as possible, within the care plan that was authorized.',
        '4. Know how to make a complaint about their services, get our help working it out, and never be punished or treated differently for complaining. To make a complaint, a client or family member calls the Caring Companions office at (417) 234-8494 or writes to Caring Companions In-Home Senior Care, 1331 N Stewart Ave, Springfield, MO 65802. If a complaint is not resolved, the client may call the Missouri Department of Health and Senior Services HCBS Call Center at 1-866-835-3505.',
        '5. Receive services no matter their race, creed, color, age, sex, or national origin.',
        '6. Receive a copy of the Caring Companions Code of Ethics that we follow when we provide services.',
        '7. Call the Missouri Department of Health and Senior Services for any reason, including being unhappy with us or their services. The HCBS Call Center is 1-866-835-3505.',
        '8. Be free from retaliation. No client or family member will be treated worse because they reported a concern, and neither will you.',
      ] },
      { h: 'Reporting abuse, neglect, or exploitation', p: ['If you ever think a client is being abused, neglected, or exploited, you must report it right away to the Missouri Adult Abuse and Neglect Hotline at 1-800-392-0210, and tell the office.'] },
      { h: 'Questions before your first shift', p: ['If anything in the Client Rights, the Code of Ethics or the HIPAA policy is unclear, call the office at (417) 234-8494 before your first shift. The office goes over all three with you at your Orientation Video Call, before you serve any client.'] },
    ],
    /* her ruling 2026-10-13: the signature confirms receipt and review only; the explanation happens at the Orientation Video
       Call and is recorded there (who, when, their confirmation); the requirement is complete only then, before the first shift */
    certification: ['By signing, I confirm that I received and reviewed a copy of the Client Rights, the Caring Companions Code of Ethics, and the Caring Companions policy on keeping client information confidential. I understand the office will explain each of them to me at my Orientation Video Call, before I serve any client.'],
  },
  /* ───── 2026-10-13 HEPATITIS B IN STEP 1 (Samantha: "let's keep it [bloodborne pathogens training] in their on-the-job
     training... they are fine to complete the [Hepatitis B] form in step one"; and "lets keep it easy and offer to everyone").
     LEGAL BASIS (launch/review/hepb-osha-research.md):
     - OSHA 29 CFR 1910.1030(f)(2)(i): the vaccine is made available "after the employee has received the training required in
       paragraph (g)(2)(vii)(I)" and within 10 working days of initial assignment.
     - Training element (g)(2)(vii)(I) is ONLY the vaccine information: its efficacy, safety, method of administration, the
       benefits of being vaccinated, and that it is offered free of charge. This form PRESENTS that information first, then
       asks for the choice, so the offer made here is properly sequenced.
     - This form does NOT complete the bloodborne pathogens training. The rest of (g)(2) stays in the online on-the-job courses
       (her ruling); this form only gives element (I) before the offer.
     - Offered to EVERY applicant, whatever the position (her ruling "offer to everyone"). That is a superset of OSHA's duty,
       which covers only positions with reasonably anticipated occupational exposure ((c)(2), (f)(1)(i)): offering more
       people than the rule requires never falls short of it. The exposure table in hepb.ts still decides the 30-minute
       pass for anyone whose Step 1 did not include this form.
     - The vaccine is never mandatory ((f)(1)(i), CPL 02-02-069 XIII.F.1). Declining = the Appendix A statement word for word
       ((f)(2)(iv)); a later yes is honored at no cost ((f)(2)(iii)). Exceptions: the series already completed, an antibody
       test shows immunity, medically contraindicated ((f)(2)(i)). No medical question sits on the declination (CPL XIII.F.11).
     - Confidential medical record ((h)(1)(iii)): the choice and the signed PDFs go only to the hepatitis B record and the
       private hepb-docs store (owners only); the Step 1 answers and the office see only status words.
     Vaccine facts: CDC Hepatitis B Vaccine Information Statement, edition January 31, 2025
     (https://www.cdc.gov/vaccines/hcp/current-vis/hepatitis-b.html): "usually given as 2, 3, or 4 shots"; "Most people who
     are vaccinated with hepatitis B vaccine are immune for life"; soreness, fever, headache and tiredness can happen;
     people sometimes faint after a shot; "a very remote chance" of a severe allergic reaction. APPROVED 2026-10-13
     (version 1; see APPROVED_FOR_REAL). ───── */
  hepb_vaccination: {
    key: 'hepb_vaccination', screen: '16', title: 'Hepatitis B Vaccination', short: 'Hepatitis B vaccine', layout: 'document', step1Gate: 'hepb', confidential: true, version: 1, status: 'approved', signature: 'typed',
    intro: ['Please read this before you choose. It tells you about the hepatitis B vaccine, which Caring Companions offers you at no cost.'],
    sections: [
      { h: 'Why we offer it', p: ['Caregiving can bring contact with blood, or with body fluids that have blood in them, for example when helping with shaving, nail care or toileting, or with a cut or a skin tear. Federal workplace safety rules (OSHA 29 CFR 1910.1030) protect workers from infections spread this way. Caring Companions offers the hepatitis B vaccine to everyone we hire.'] },
      { h: 'What hepatitis B is', p: ['Hepatitis B is a liver disease caused by a virus that spreads through blood and some other body fluids. It can be a mild illness that lasts a few weeks, or a serious, lifelong illness that can damage the liver and lead to liver cancer.'] },
      { h: 'How well the vaccine works', p: ['Hepatitis B vaccine can prevent hepatitis B. Most people who are vaccinated are protected for life.'] },
      { h: 'How the vaccine is given', p: ['The vaccine is a shot given by a licensed healthcare professional. It is usually 2, 3 or 4 shots spread over several months, depending on the brand. You need every shot in the series to be fully protected.'] },
      { h: 'Is it safe?', p: ['Hepatitis B vaccine is safe for most people. Soreness where the shot is given, fever, headache and feeling tired can happen afterward. Some people faint after a shot. A severe allergic reaction is very rare. If you have ever had a serious allergic reaction to a vaccine, or are not sure the vaccine is right for you, ask your doctor.'] },
      { h: 'The benefits', p: ['Once you are protected, you are protected from hepatitis B at work and everywhere else, for as long as the protection lasts. For most people that is for life.'] },
      { h: 'Free, and your choice', p: [
        'The vaccine is free for you. Caring Companions pays for every shot. It is given at a reasonable time and place, by a licensed healthcare professional.',
        'Getting the vaccine is your choice. It is not required to work here.',
        'If you choose the vaccine, the office arranges it with you within 10 working days of your first client assignment.',
        'If you decline now, you can change your mind at any time while you work here and still get the vaccine at no cost to you. Just tell the office: ' + OFFICE_PHONE + '.',
      ] },
      { h: 'Your bloodborne pathogens training', p: ['You also take our bloodborne pathogens training in your online on-the-job courses, within your first 30 days. It covers how to protect yourself from blood and body fluids, what to do if you are exposed, and more about this vaccine.'] },
      { h: 'Your answer is private', p: ['Your answer is part of your confidential employee medical record. Only the owners of Caring Companions see it. The rest of the office sees only that you answered.'] },
    ],
    choices: { label: 'Your choice about the hepatitis B vaccine', options: [
      { id: 'vaccine', label: 'Yes, I want the hepatitis B vaccine, at no cost to me.' },
      { id: 'declined', label: 'No, I decline the hepatitis B vaccine at this time.', note: 'You sign the declination statement below. You can still choose the vaccine later at no cost.' },
      { id: 'prior_series', label: 'I already completed the hepatitis B vaccine series.', note: 'After you sign, you can add a copy of your vaccine record. If you do not have one, the office will follow up with you.' },
      { id: 'immune', label: 'I had a blood test (an antibody test) that shows I am immune to hepatitis B.', note: 'After you sign, you can add a copy of the result. If you do not have one, the office will follow up with you.' },
      { id: 'contraindicated', label: 'My doctor says I should not have this vaccine.', note: 'You do not need to tell us why. The office will follow up with you.' },
    ] },
    decline: { choice: 'declined', title: 'Hepatitis B Vaccine Declination (Mandatory)', intro: 'Federal workplace safety rules (OSHA 29 CFR 1910.1030, Appendix A) say that if you choose not to get the hepatitis B vaccine, you sign this exact statement. The words come from the regulation and cannot be changed.', statement: APPENDIX_A, consent: 'I have read the declination statement above and I agree to sign it electronically.' },
    certification: ['I read the information above about the hepatitis B vaccine, and the answer I chose is my own choice.'],
  },
}
export const FORM_ORDER: FormKey[] = ['employee_application', 'reference_consent', 'fcra_disclosure', 'edl_fcsr_consent', 'availability', 'experience', 'vehicle', 'non_driver', 'employment_agreement', 'medication_policy', 'code_of_ethics', 'hipaa_privacy', 'client_rights', 'hepb_vaccination']
/** The wording of one form, canonical, for the fingerprint stored with every signature (answers are not part of it). */
export function formText(key: FormKey): string {
  const f = FORMS[key]; const out: string[] = [`title|${f.title}`, `version|${f.version}`]
  for (const p of f.intro || []) out.push(`p|${p}`)
  for (const s of f.sections) { out.push(`h|${s.h}`); for (const p of s.p || []) out.push(`p|${p}`); if (s.tip) out.push(`t|${s.tip}`); if (s.tone) out.push(`tone|${s.tone}`); for (const i of s.items || []) { out.push(`i|${i.id}|${i.label}|${(i.options || []).join(';')}`); for (const x of i.fields || []) out.push(`f|${i.id}|${x.k}|${x.label}|${x.kind}|${x.required ? 1 : 0}|${(x.options || []).join(';')}|${x.note || ''}`) } }
  if (f.sections.some((s) => (s.items || []).some((i) => i.kind === 'cards' && (i.fields || []).some((x) => x.kind === 'skills')))) out.push(`skills|${SKILL_GROUPS.map((g) => g.h + ':' + g.skills.map(([k, l]) => k + '=' + l).join(',')).join('|')}`)
  if (f.choices) { out.push(`choices|${f.choices.label}`); for (const o of f.choices.options) out.push(`choice|${o.id}|${o.label}|${o.note || ''}`) }
  if (f.decline) out.push(`decline|${f.decline.choice}|${f.decline.title}|${f.decline.intro}|${f.decline.consent}`, `statement|${f.decline.statement}`)
  for (const c of f.certification) out.push(`c|${c}`)
  return out.join('\n')
}
export async function formFingerprint(key: FormKey): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(formText(key)))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
/** Which forms may be signed for real: only the ones Samantha has approved, by version.
    APPROVED: Samantha, 2026-10-13, 'approve step 1 forms', wording page version 5 (https://claude.ai/artifact/KuoJ2LomuVaBtoHr5RZ8Tj,
    built from this file by launch/review/tools/build_wording_page.py; rebuilt from main before this change and byte-identical to the page she
    read). Her message: 2026-10-13 20:09:53 UTC (3:09 pm Central). Every version and wording fingerprint is in
    supabase/step1-approved-2026-10-13.json. A changed word is a new version, and a new version is NOT approved until she
    approves it and it is added here: until then a real applicant cannot sign it (practice and training hires still can). */
export const APPROVED_FOR_REAL: Partial<Record<FormKey, number>> = {
  employee_application: 4, reference_consent: 3, fcra_disclosure: 2, edl_fcsr_consent: 4, availability: 2, experience: 2,
  vehicle: 5, non_driver: 2, employment_agreement: 1, medication_policy: 1, code_of_ethics: 1, hipaa_privacy: 1, client_rights: 1,
  /* APPROVED: Samantha, 2026-10-13 about 22:30 UTC, "ok approve your way", on the Hepatitis B approval page v1
     (https://claude.ai/artifact/3BZSmkpvjXBRJPRtzCSmk3); record: supabase/step1-approved-hepb-2026-10-13.json */
  hepb_vaccination: 1,
}
/** true only when Samantha approved form k at exactly version v (the version the server stamps is FORMS[k].version) */
export const approvedAt = (k: FormKey, v: unknown): boolean => typeof v === 'number' && APPROVED_FOR_REAL[k] === v
/** 2026-10-13: a real (non-practice) applicant may sign a form only at a version Samantha approved for real. */
export const approvedForReal = (k: FormKey): boolean => approvedAt(k, FORMS[k].version)
/* ───── 2026-10-13 WHICH FORMS ARE IN THIS PERSON'S STEP 1 (the Hepatitis B form, step1Gate 'hepb') ─────
   Decided ONCE, when their Step 1 record is made (step1_forms.hepb_form), and kept for that Step 1: the form is in a Step 1
   started after it was approved for real (APPROVED_FOR_REAL at its exact version), and in every practice Step 1. A Step 1
   that started before that never gains a new required form part way through (it would block their completion); the
   30-minute hepatitis B pass offers those people the vaccine at Approve to Work exactly as before. Offered to every
   applicant whatever the position (her ruling "offer to everyone"; a superset of OSHA's exposure-based duty). */
export type Step1Ctx = { hepb?: boolean }
// deno-lint-ignore no-explicit-any
export const step1Ctx = (row: any): Step1Ctx => ({ hepb: row?.hepb_form === true })
/** at the start of a Step 1: is the Hepatitis B form in it? */
export const hepbFormAtStart = (practice: boolean): boolean => practice || approvedForReal('hepb_vaccination')
/** the forms in this person's Step 1 (before the deciding answers): every form, less a gated form their Step 1 does not have */
export const formsInPlay = (ctx: Step1Ctx = {}): FormKey[] => FORM_ORDER.filter((k) => FORMS[k].step1Gate !== 'hepb' || ctx.hepb === true)
/** every form in this person's Step 1 is approved for real (decides the "practice only" note) */
export const allApprovedForReal = (ctx: Step1Ctx = {}): boolean => formsInPlay(ctx).every(approvedForReal)
/** 2026-10-13: the Step 1 screens follow the form list. The first ten are fixed; a form added later gets its own screen
    (its `screen` key) before "All done", in FORM_ORDER order. */
export const BASE_SCREENS = ['1', '2', '3', '4', '5a', '5b', '6', '7', '8', '9']
export function step1Screens(ctx: Step1Ctx = {}): string[] {
  const extra = formsInPlay(ctx).map((k) => FORMS[k].screen).filter((x) => !BASE_SCREENS.includes(x) && x !== '2 and 3')
  return [...BASE_SCREENS.slice(0, -1), ...extra.filter((x, i) => extra.indexOf(x) === i), '9']
}
/** 2026-10-13: a form with `when` applies only when that Step 1 answer matches (the Driver or the Non-Driver Agreement,
    chosen by "Are you willing and able to transport clients ...?"). Answers that decide a form, asked on the form's screen. */
export const DECIDING: Record<string, { label: string; options: [string, string][] }> = {
  transport_willing: { label: 'Are you willing and able to transport clients in your personal vehicle as part of your caregiving duties?', options: [['yes', 'Yes'], ['no', 'No']] },
}
export const formApplies = (k: FormKey, answers: Record<string, unknown>, ctx: Step1Ctx = {}): boolean => { if (FORMS[k]?.step1Gate === 'hepb' && ctx.hepb !== true) return false; const w = FORMS[k]?.when; return !w || answers?.[w.id] === w.equals }
/** the forms this person signs, in order; a deciding answer not given yet leaves both of its forms out */
export const applicableForms = (answers: Record<string, unknown>, ctx: Step1Ctx = {}): FormKey[] => FORM_ORDER.filter((k) => formApplies(k, answers || {}, ctx))
/** how many forms this person signs: the ones that apply, plus one for each deciding question not answered yet
    (12 for a Step 1 without the Hepatitis B form, 13 with it) */
export const formCount = (a: Record<string, unknown>, ctx: Step1Ctx = {}) => applicableForms(a || {}, ctx).length + Object.keys(DECIDING).filter((k) => !a?.[k]).length
/** the forms to list for this person: those that apply, and while a deciding question is open, the first form it decides as a stand-in */
export const formsToList = (a: Record<string, unknown>, ctx: Step1Ctx = {}): FormKey[] => formsInPlay(ctx).filter((k) => { const w = FORMS[k].when; return !w || (a || {})[w.id] === w.equals || (!(a || {})[w.id] && FORM_ORDER.find((x) => FORMS[x].when?.id === w.id) === k) })
/** the signed forms that still need the company's signature */
export const needsCountersign = (signatures: Record<string, unknown>, countersignatures: Record<string, unknown>): FormKey[] => FORM_ORDER.filter((k) => FORMS[k].countersign && signatures?.[k] && !countersignatures?.[k])
/** 2026-10-13: the Hepatitis B choices, by id (the answer is never stored in the Step 1 answers) */
export const HEPB_CHOICE_IDS = (FORMS.hepb_vaccination.choices?.options || []).map((o) => o.id)
