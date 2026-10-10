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
export const STEP1_VERSION = 3   // her operational decisions of October 9 (late): the vehicle form and the EDL/FCSR consent at version 3; four forms at version 2; the FCRA draft at version 1
export type FormKey = 'employee_application' | 'reference_consent' | 'fcra_disclosure' | 'edl_fcsr_consent' | 'availability' | 'experience' | 'vehicle'
export type FormStatus = 'proposed' | 'draft_for_counsel' | 'to_confirm'
export type Item = { id: string; label: string; kind: 'text' | 'yesno' | 'choice' | 'multi' | 'date' | 'statement' | 'table' | 'number' | 'initials' | 'photo'; options?: string[]; required?: boolean; note?: string; locked?: boolean }
export type Section = { h: string; p?: string[]; items?: Item[] }
export type Form = { key: FormKey; screen: string; title: string; version: number; status: FormStatus; intro?: string[]; sections: Section[]; certification: string[]; signature: 'typed' | 'typed+initials' }

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
export const STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC']

const yesno = (id: string, label: string, extra: Partial<Item> = {}): Item => ({ id, label, kind: 'yesno', required: true, ...extra })
const text = (id: string, label: string, extra: Partial<Item> = {}): Item => ({ id, label, kind: 'text', ...extra })

export const FORMS: Record<FormKey, Form> = {
  employee_application: {
    key: 'employee_application', screen: '2 and 3', title: 'Employee Application', version: 2, status: 'proposed', signature: 'typed',
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
      { h: 'Other Licenses / Certification', items: [yesno('cna', 'CNA License?'), yesno('hha', 'HHA Certification?'), text('license_number', 'If yes, License Number'), { id: 'license_expires', label: 'Expiration Date', kind: 'date' }] },
      /* v2 (her decision): no "violation of the law" line; neutral, lawful criminal-history wording */
      { h: 'Criminal Record / Driving Record', p: ['Please answer these completely and honestly. A conviction is not an automatic bar to employment: we consider the nature of the offense, how long ago it happened, and whether it relates to the work. Your answers are considered together with the background checks described later in Step 1. You do not need to list any record that has been expunged or sealed.'], items: [
        yesno('moving_violations', 'Have you had any moving traffic violations?'), text('moving_violations_detail', 'If yes, please describe.'),
        yesno('license_suspended', "Have you had your driver's license suspended or revoked in the last 3 years?"),
        yesno('convicted', 'Have you been convicted of a crime or pled guilty or no contest to a crime (misdemeanor or felony)?'),
        { id: 'convictions', label: 'If yes, please complete the information section below.', kind: 'table', options: ['Offense', 'Date of Conviction', 'Misdemeanor or Felony', 'Location'] },
      ] },
      /* v2: fewer than two employers is allowed */
      { h: 'Your work history', p: ['Please list up to three employers, most recent first. If you have fewer than two, list what you have; if you have never been employed, tick the box below. Please check every detail; we use these to verify you.', 'These are the people who can confirm your experience. The more exact they are, the faster we can verify you for Level 2 or Level 3 clients.'], items: [
        { id: 'employers', label: 'Previous Employment', kind: 'table', options: ['Company', 'City, State', 'Your role / job title', 'Supervisor', 'Phone', 'Email', 'Dates Worked for this Employer: From', 'To', 'What you did (Responsibilities)', 'Reason for Leaving', 'May we contact them? Yes / No'] },
        yesno('no_employer_history', 'I have no previous employer to list.', { required: false }),
      ] },
    ],
    /* v2: the E-Verify sentence is withheld until Samantha confirms the Company's participation (E_VERIFY_CONFIRMED); the I-9 line stands on its own */
    certification: [
      'I certify that my answers are accurate and complete to the best of my knowledge. I understand that false or misleading information in my interview or application may result in my dismissal. I understand that this employer is required to run the background checks Missouri requires before I may work with participants, and that my potential employment is contingent on the results. I also understand that I may be required to successfully complete any drug screening required by Caring Companions\' screening policy, before or during employment. I understand that if I am hired, federal immigration law requires me to complete a Form I-9 and to provide proof of my identity and my legal authority to work in the United States.',
      'I am not a participant in the Missouri in-home services program.',
    ],
  },
  reference_consent: {
    key: 'reference_consent', screen: '4', title: 'Reference Check and Authorization Consent Form Disclosure', version: 2, status: 'proposed', signature: 'typed',
    intro: ['Please read the information on this form carefully and completely.'],
    sections: [
      { h: 'Authorization', p: [
        `I have applied for employment with ${COMPANY} and have provided information about my previous employment. I authorize ${COMPANY} to conduct a reference check with my present and/or previous employer(s). I understand that reference information may include, but not be limited to, verbal and written inquiries or information about my employment performance, professional demeanor, rehire potential, dates of employment, salary, and employment history.`,
        /* v2 (her decision): the broad liability release is removed pending counsel review */
        `My signature below authorizes my former or current employers and references to release information regarding my employment record with their organizations and to provide any additional information that may be necessary for my application for employment with Caring Companions In-Home Senior Care, whether the information is positive or negative.`,
        /* her decision 2: the awkward sentence reworded; the final wording goes to her before publishing */
        `I further authorize ${COMPANY} to contact the references I provide and to verify relevant employment information, and to obtain feedback and references from my supervisors over the course of my employment with the Company. I understand that this feedback may be used in decisions about my employment. This form may be photocopied or reproduced as a facsimile, and these copies will be as effective as a release or consent as the original which I sign. This release and/or a copy of this release shall be valid for one year from the date it was signed.`,
      ] },
      { h: 'Your references', p: [`Please give ${REFERENCES_REQUIRED.professional} professional references (a supervisor or manager from your work history; the supervisors you listed are offered here with one tap) and ${REFERENCES_REQUIRED.personal} personal references (a friend, co-worker, past client, pastor or similar, not a relative). Nothing is sent to any of them until the office asks for the reference.`], items: [
        { id: 'professional_refs', label: 'Professional references', kind: 'table', options: ['Full Name', 'Company', 'Their role', 'Phone Number', 'Email'], required: true },
        { id: 'personal_refs', label: 'Personal references', kind: 'table', options: ['Full Name', 'Relationship', 'Phone Number', 'Email'], required: true },
      ] },
    ],
    certification: ['I have read this authorization and I agree to it.'],
  },
  fcra_disclosure: {
    key: 'fcra_disclosure', screen: '5a', title: 'Disclosure Regarding Background Investigation', version: 1, status: 'draft_for_counsel', signature: 'typed',
    /* 15 U.S.C. 1681b(b)(2)(A): a document that consists solely of the disclosure; the authorization may be on it. Nothing else. */
    sections: [
      { h: 'Disclosure', p: [`${COMPANY} ("the Company") may obtain information about you from a consumer reporting agency for employment purposes. This information may be in the form of a consumer report, which may include information about your character, general reputation, personal characteristics and mode of living, to the extent permitted by law, as well as your criminal history, motor vehicle records and other public record information.`, 'You have the right to request a copy of the report and a summary of your rights under the Fair Credit Reporting Act. The Summary of Your Rights Under the Fair Credit Reporting Act is linked on this screen.'] },
      { h: 'Authorization', p: ['I have read this disclosure and I authorize the Company to obtain consumer reports about me for employment purposes, now and, if I am hired, at any time during my employment.'] },
    ],
    certification: ['I have read the disclosure above and I authorize the Company to obtain consumer reports about me.'],
  },
  edl_fcsr_consent: {
    key: 'edl_fcsr_consent', screen: '5b', title: 'Missouri Employee Disqualification List and Family Care Safety Registry Consent', version: 3, status: 'proposed', signature: 'typed',
    sections: [
      /* v2 (her decision 4): the EDL search and the FCSR registration and screening are separate paragraphs; what Missouri
         requires is labelled as such, and what is Caring Companions' own policy is labelled as such (frequency to confirm) */
      { h: 'Employee Disqualification List (a Missouri requirement)', p: [
        `Missouri requires ${COMPANY} to check the Employee Disqualification List (EDL) before I am hired and to keep monitoring it while I am employed (19 CSR 15-7.021(18)(B)). The EDL names people found to have committed an act of abuse, neglect, exploitation, misappropriation, or misconduct against a resident or consumer; a person on the list cannot be employed to deliver care.`,
      ] },
      { h: 'Family Care Safety Registry (a Missouri requirement)', p: [
        'Missouri requires every in-home services worker to be registered with the Family Care Safety Registry (FCSR) and requires the Company to request a background screening through it before I have contact with any participant (19 CSR 15-7.021(19)(F); RSMo 192.2495). I register with the FCSR myself, with my Social Security number; the Company may pay the registration fee and then requests my screening.',
      ] },
      /* v3 (her decision 3): monthly EDL, annual FCSR, as agency policy, beside anything the law or a payer requires */
      { h: 'Rechecks (Caring Companions policy, not a Missouri interval)', p: [
        'As its own policy, Caring Companions rechecks the Employee Disqualification List every month and requests a new Family Care Safety Registry screening every year during employment, in addition to the initial checks and any other checks required by applicable law or by a payer agreement. These frequencies are the agency\'s policy; Missouri sets the initial checks and the ongoing EDL monitoring, not these intervals.',
      ] },
      { h: 'Consent', p: [
        /* her decision 3: one consent sentence; the standalone FCRA disclosure stays on its own screen and is never folded in here */
        'I consent to the EDL check, the FCSR screening and the rechecks described above, and to the disclosure of their results to the Company for the purpose of my employment. This consent covers the checks before I begin work and the rechecks during my employment.',
      ] },
      { h: 'For your background checks', p: ['We need these three things to order your background checks and your Family Care Safety Registry screening. They are kept encrypted on our server, seen only by the office person who orders your checks, and every look is logged.'], items: [
        { id: 'ssn', label: 'Social Security number', kind: 'text', required: true, locked: true, note: 'Typed twice, digits only. Never shown again; your record says "on file, ending" with the last four digits.' },
        { id: 'dob', label: 'Date of birth', kind: 'date', required: true, locked: true },
        text('address1', 'Street address', { required: true }), text('address2', 'Apartment / unit'), text('city', 'City', { required: true }), { id: 'state', label: 'State', kind: 'choice', options: STATES, required: true }, text('zip', 'Zip code', { required: true }),
      ] },
    ],
    certification: ['I have read this consent and I agree to it. The information I gave for my background checks is correct.'],
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
        { id: 'shift_prefs', label: 'Shifts', kind: 'multi', options: ['Morning shifts', 'Afternoon shifts', 'Evening shifts', 'Overnight shifts', 'Weekends', 'Holidays', 'Short notice / same-day assignments'] },
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
  vehicle: {
    key: 'vehicle', screen: '8', title: 'Responsibility for Personal Vehicle Insurance & Transportation Standards', version: 3, status: 'to_confirm', signature: 'typed',
    sections: [
      { h: 'Your driving details', p: ['From your application: whether you have a valid license, insurance and your own transportation. Correct anything that has changed.'], items: [
        yesno('has_license', 'I have a current, valid driver\'s license'), yesno('has_insurance', 'I have active automobile liability insurance'), yesno('has_transport', 'I have reliable transportation of my own'),
        /* v3 (her decision 1): the MVR is not described as an existing check */
        { id: 'license_number', label: 'Driver\'s license number', kind: 'text', locked: true, note: 'Needed so the office can verify your license and driving record before you are approved to transport clients. Kept encrypted; your record says "on file, ending" with the last four characters.' },
        { id: 'license_state', label: 'License state', kind: 'choice', options: STATES }, { id: 'license_expires', label: 'License expiration date', kind: 'date' },
        /* her decision 5 and section 21: proof is an option, the photo is truly optional */
        { id: 'insurance_proof', label: 'Proof of insurance', kind: 'choice', options: ['I have provided proof of current personal automobile insurance coverage to Caring Companions', 'I will provide proof of current personal automobile insurance coverage to Caring Companions before orientation'], required: true },
        { id: 'insurance_photo', label: 'Add a photo of your insurance card if you have it handy (optional)', kind: 'photo', required: false },
        text('insurer', 'Insurance company (optional)'), { id: 'insurance_expires', label: 'Policy expiration date (optional)', kind: 'date' },
      ] },
      { h: 'Insurance responsibility', p: [
        'I agree to notify Caring Companions and provide updated proof of insurance within three (3) calendar days of any policy renewal, change, lapse, or cancellation.',
        'I understand and acknowledge that Caring Companions does not provide automobile insurance coverage for employees operating personal vehicles. I further understand that I am solely responsible for all liability, claims, damages, injuries, fines, or losses arising from my operation of a personal vehicle, including while transporting clients. Any mileage reimbursement or stipend provided does not constitute insurance coverage.',
        /* v2 (her decision 7): the indemnification clause is removed pending counsel review */
      ] },
      /* v2: the coverage requirement and the payer list are kept as today's form states them and marked for her confirmation */
      /* v3 (her decisions 4 and 5): the insurance requirement, the transportation conditions, and no authorization from Step 1 answers */
      { h: 'Required Standards for Transporting Clients', p: ['Employees who transport clients must meet all of the following requirements: Maintain a current, valid driver\'s license. Maintain current automobile liability insurance that meets at least Missouri\'s legal minimums and that permits transporting clients as part of paid caregiving. [Whether additional limits or coverage are required is being confirmed with the Company\'s insurance agent.] Have an acceptable driving record, verified by a Motor Vehicle Record check ordered by the office. Complete any transportation training the Company requires. Use only a personally owned or legally authorized private vehicle approved by the agency.', 'A caregiver may transport a client only when the client\'s Care Plan authorizes it, the payer permits it (Private Pay, Missouri Medicaid HCBS, or VA Community Care Network (VA CCN)), and the office has approved both the caregiver and the vehicle. No caregiver is authorized to drive clients based on their answers in Step 1 alone.'] },
      { h: 'Vehicle Safety & Condition Requirements', p: ['Any vehicle used to transport clients must be safe, operational, and well-maintained, including properly functioning: headlights, taillights, and turn signals; windshield and windshield wipers; brakes and seat belts; heater and air conditioning; tires properly inflated with a minimum of 1/8 inch tread depth at the point of greatest wear. The vehicle must also be clean and free of trash or clutter, and free of leaking oil, gasoline, or other fluids.'] },
      { h: 'Driver Conduct & Safety Expectations', p: ['While transporting clients, I agree to: Not smoke, vape, text, email, or use a mobile device while driving. Not drive while fatigued, ill, impaired, or under the influence of alcohol, drugs, or medications that affect driving ability. Obey all traffic laws and operate the vehicle in a safe, defensive manner. Transport only the authorized client (no unauthorized passengers). Avoid driving in unsafe weather or road conditions. Never operate a client\'s vehicle unless expressly authorized in writing by the agency.'] },
      { h: 'Accident & Incident Reporting', p: ['I agree to immediately notify Caring Companions of any accident, traffic citation, or incident that occurs while transporting a client. I will comply with all legal reporting requirements and understand that I may not transport clients again until cleared by the agency.'] },
      { h: 'Agency Rights & Acknowledgment', p: ['I understand that Caring Companions reserves the right to approve, suspend, or revoke driving privileges at any time based on safety concerns, compliance issues, insurance status, or policy violations. Failure to comply with this policy may result in disciplinary action, up to and including termination. Driving duties are assigned only after the office has verified my license, my insurance and my driving record, and has approved me and my vehicle.'] },
      { h: 'Driver Acknowledgment', p: ['If you choose the second option, you will not be asked to transport clients, and the office will send you the Non-Driver Agreement to sign with your Step 2 paperwork.'], items: [{ id: 'driver_ack', label: 'Choose one', kind: 'choice', options: ['I meet all requirements and request approval to transport clients.', 'I do not meet the requirements and will inform my supervisor and sign a Non-Driver Agreement.'], required: true }] },
    ],
    certification: ['I have read this policy and the acknowledgment I chose above is true.'],
  },
}
export const FORM_ORDER: FormKey[] = ['employee_application', 'reference_consent', 'fcra_disclosure', 'edl_fcsr_consent', 'availability', 'experience', 'vehicle']
/** The wording of one form, canonical, for the fingerprint stored with every signature (answers are not part of it). */
export function formText(key: FormKey): string {
  const f = FORMS[key]; const out: string[] = [`title|${f.title}`, `version|${f.version}`]
  for (const p of f.intro || []) out.push(`p|${p}`)
  for (const s of f.sections) { out.push(`h|${s.h}`); for (const p of s.p || []) out.push(`p|${p}`); for (const i of s.items || []) out.push(`i|${i.id}|${i.label}|${(i.options || []).join(';')}`) }
  for (const c of f.certification) out.push(`c|${c}`)
  return out.join('\n')
}
export async function formFingerprint(key: FormKey): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(formText(key)))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
/** Which forms may be signed for real: only the ones Samantha has approved by version (none yet: all proposed). */
export const APPROVED_FOR_REAL: Partial<Record<FormKey, number>> = {}
