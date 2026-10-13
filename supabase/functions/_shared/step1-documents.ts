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
export const STEP1_VERSION = 5   // 2026-10-13: the permission form (5a v2) replaces the FCRA draft; application v4, details v4. Before: 2026-10-11 (her approval of the Step 1 previews): the application and the reference consent at version 3 (tasks per job, family care, backup references); the vehicle form and the EDL/FCSR consent at version 3; two forms at version 2; the FCRA draft at version 1
export type FormKey = 'employee_application' | 'reference_consent' | 'fcra_disclosure' | 'edl_fcsr_consent' | 'availability' | 'experience' | 'vehicle' | (string & {})
export type FormStatus = 'proposed' | 'draft_for_counsel' | 'to_confirm'
/** One box inside a card (a job, a family-care entry, a reference). 'skills' are keys of SKILLS; 'lifts' shows only when a
    lift is ticked; 'refresher' offers only the tasks ticked on the same card, plus 'none'. */
export type Field = { k: string; label: string; kind: 'text' | 'tel' | 'email' | 'yesno' | 'choice' | 'multi' | 'skills' | 'lifts' | 'refresher'; options?: string[]; required?: boolean; note?: string }
export type Item = { id: string; label: string; kind: 'text' | 'yesno' | 'choice' | 'multi' | 'date' | 'statement' | 'table' | 'number' | 'initials' | 'photo' | 'cards'; options?: string[]; required?: boolean; note?: string; locked?: boolean; fields?: Field[]; max?: number; add?: string }
/** tone 'cheer': shown as an encouraging box; tip: one short line in a highlighted box (both are wording, in the fingerprint) */
export type Section = { h: string; p?: string[]; items?: Item[]; tone?: 'cheer'; tip?: string }
/** 2026-10-13 (Samantha: long documents such as the Employment Agreement and the Employee Manual are shown WHOLE in one
    scrollable reader on their Step 1 screen, with a copy to open or save, and the acknowledgment, any separate initials
    and the signature right below): layout 'document'. `short` is the screen's title in the screen list. */
export type Form = { key: FormKey; screen: string; title: string; short?: string; layout?: 'document'; when?: { id: string; equals: string }; version: number; status: FormStatus; intro?: string[]; sections: Section[]; certification: string[]; signature: 'typed' | 'typed+initials' }

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
    key: 'employee_application', screen: '2 and 3', title: 'Employee Application', version: 4, status: 'proposed', signature: 'typed',
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
    key: 'reference_consent', screen: '4', title: 'Reference Check and Authorization Consent Form Disclosure', version: 3, status: 'proposed', signature: 'typed',
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
    key: 'fcra_disclosure', screen: '5a', title: 'Permission for Background Checks and References', version: 2, status: 'proposed', signature: 'typed',
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
    key: 'edl_fcsr_consent', screen: '5b', title: 'Your Details for the Background Checks', version: 4, status: 'proposed', signature: 'typed',
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
    key: 'availability', screen: '6', title: 'Caregiver Availability & Scheduling Commitment', version: 2, status: 'proposed', signature: 'typed+initials',
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
    key: 'experience', screen: '7', title: 'Caregiver Experience & Client Matching Profile', version: 2, status: 'proposed', signature: 'typed',
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
    key: 'vehicle', screen: '8', title: 'Driver/Vehicle Insurance & Transportation Standards Agreement', short: 'Driver agreement', when: { id: 'transport_willing', equals: 'yes' }, version: 5, status: 'proposed', signature: 'typed',
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
  /* 2026-10-13 PROPOSED (a draft until Samantha sends or approves the company's Non-Driver Agreement): for an applicant who
     answers NO to transporting clients. They continue onboarding and work non-driving assignments. */
  non_driver: {
    key: 'non_driver', screen: '8', title: 'Non-Driver Agreement', short: 'Non-driver agreement', when: { id: 'transport_willing', equals: 'no' }, version: 1, status: 'proposed', signature: 'typed',
    sections: [
      { h: 'Your choice', p: ['You told us you are not willing or able to transport clients in your personal vehicle as part of your caregiving duties. That is fine: you can continue onboarding and work with clients whose care does not include driving.'] },
      { h: 'What this means', p: [
        'I will not transport any client in my vehicle or in the client\'s vehicle, and I will not drive a client anywhere as part of my work, unless the office later approves me as a driver in writing.',
        'If a client or a client\'s family asks me to drive, I will politely say no and call the office right away.',
        'I understand that client assignments that require transportation will not be offered to me while I am a Non-Driver.',
      ] },
      { h: 'If you want to drive later', p: ['You can ask the office at any time. You will sign the Driver/Vehicle Insurance & Transportation Standards Agreement, upload your license and insurance, and wait for the office\'s written approval before you drive a client.'] },
    ],
    certification: ['I have read this agreement and I agree to it.'],
  },
}
export const FORM_ORDER: FormKey[] = ['employee_application', 'reference_consent', 'fcra_disclosure', 'edl_fcsr_consent', 'availability', 'experience', 'vehicle', 'non_driver']
/** The wording of one form, canonical, for the fingerprint stored with every signature (answers are not part of it). */
export function formText(key: FormKey): string {
  const f = FORMS[key]; const out: string[] = [`title|${f.title}`, `version|${f.version}`]
  for (const p of f.intro || []) out.push(`p|${p}`)
  for (const s of f.sections) { out.push(`h|${s.h}`); for (const p of s.p || []) out.push(`p|${p}`); if (s.tip) out.push(`t|${s.tip}`); if (s.tone) out.push(`tone|${s.tone}`); for (const i of s.items || []) { out.push(`i|${i.id}|${i.label}|${(i.options || []).join(';')}`); for (const x of i.fields || []) out.push(`f|${i.id}|${x.k}|${x.label}|${x.kind}|${x.required ? 1 : 0}|${(x.options || []).join(';')}|${x.note || ''}`) } }
  if (f.sections.some((s) => (s.items || []).some((i) => i.kind === 'cards' && (i.fields || []).some((x) => x.kind === 'skills')))) out.push(`skills|${SKILL_GROUPS.map((g) => g.h + ':' + g.skills.map(([k, l]) => k + '=' + l).join(',')).join('|')}`)
  for (const c of f.certification) out.push(`c|${c}`)
  return out.join('\n')
}
export async function formFingerprint(key: FormKey): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(formText(key)))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
/** Which forms may be signed for real: only the ones Samantha has approved by version (none yet: all proposed). */
export const APPROVED_FOR_REAL: Partial<Record<FormKey, number>> = {}
/** 2026-10-13: a real (non-practice) applicant may sign a form only at a version Samantha approved for real. */
export const approvedForReal = (k: FormKey): boolean => APPROVED_FOR_REAL[k] === FORMS[k].version
export const allApprovedForReal = (): boolean => FORM_ORDER.every(approvedForReal)
/** 2026-10-13: the Step 1 screens follow the form list. The first ten are fixed; a form added later gets its own screen
    (its `screen` key) before "All done", in FORM_ORDER order. */
export const BASE_SCREENS = ['1', '2', '3', '4', '5a', '5b', '6', '7', '8', '9']
export function step1Screens(): string[] {
  const extra = FORM_ORDER.map((k) => FORMS[k].screen).filter((x) => !BASE_SCREENS.includes(x) && x !== '2 and 3')
  return [...BASE_SCREENS.slice(0, -1), ...extra.filter((x, i) => extra.indexOf(x) === i), '9']
}
/** 2026-10-13: a form with `when` applies only when that Step 1 answer matches (the Driver or the Non-Driver Agreement,
    chosen by "Are you willing and able to transport clients ...?"). Answers that decide a form, asked on the form's screen. */
export const DECIDING: Record<string, { label: string; options: [string, string][] }> = {
  transport_willing: { label: 'Are you willing and able to transport clients in your personal vehicle as part of your caregiving duties?', options: [['yes', 'Yes'], ['no', 'No']] },
}
export const formApplies = (k: FormKey, answers: Record<string, unknown>): boolean => { const w = FORMS[k]?.when; return !w || answers?.[w.id] === w.equals }
/** the forms this person signs, in order; a deciding answer not given yet leaves both of its forms out */
export const applicableForms = (answers: Record<string, unknown>): FormKey[] => FORM_ORDER.filter((k) => formApplies(k, answers || {}))
/** how many forms this person signs: the ones that apply, plus one for each deciding question not answered yet */
export const formCount = (a: Record<string, unknown>) => applicableForms(a || {}).length + Object.keys(DECIDING).filter((k) => !a?.[k]).length
/** the forms to list for this person: those that apply, and while a deciding question is open, the first form it decides as a stand-in */
export const formsToList = (a: Record<string, unknown>): FormKey[] => FORM_ORDER.filter((k) => { const w = FORMS[k].when; return !w || (a || {})[w.id] === w.equals || (!(a || {})[w.id] && FORM_ORDER.find((x) => FORMS[x].when?.id === w.id) === k) })
