// =============================================================================
// offer-documents.ts · the approved offer letter and position description, version 1 (Samantha approved the exact
// wording on 2026-10-08, Implementation plan tab section 15, drug screening kept). SLICE 1b.
// =============================================================================
// The texts live here, versioned, so every rendered page and every PDF comes from the same approved words. A change to
// one word is a new version number and a new approval; the fingerprint (SHA-256 of the canonical text as rendered for
// one person) is stored with every signature, so the exact wording signed is permanently identifiable.
export const OFFER_DOC_VERSION = 1
export const PD_DOC_VERSION = 1
export type Block = { k: 'h' | 'p' | 'li' | 'small' | 'q'; t: string }
export type Fields = {
  first: string; last: string; position: string; pay_rate: number; classification: string
  date: string; expires: string; issued_by: string; issued_at: string
}
export const CLASSIFICATIONS: Record<string, string> = { prn: 'PRN (as-needed) field caregiver', part_time: 'Part-time hourly field caregiver', full_time: 'Full-time hourly field caregiver' }
/** The classification paragraph, chosen by the offer record. Unknown = null: the page refuses to issue the letter. */
export function classificationParagraph(c: string): string | null {
  if (c === 'prn') return 'This is a PRN, as-needed position. Assignments depend on client needs and your availability, and no minimum number of hours per week is guaranteed. The hours you told us you prefer guide our scheduling but are not a promise of hours.'
  if (c === 'part_time' || c === 'full_time') return `This is a ${c === 'part_time' ? 'part-time' : 'full-time'} hourly position. Assignments depend on client needs and your availability. The hours you told us you prefer and any anticipated schedule guide our scheduling but are not a guarantee of hours.`
  return null
}
export const DRUG_SCREENING_LINE = "Successful completion of any drug screening required by Caring Companions' screening policy."
const HEADER = 'Caring Companions In-Home Senior Care · 1331 N. Stewart Ave., Suite B, Springfield, MO 65802 · (417) 234-8494 · mo-care.com'
const rate = (n: number) => (Math.round(n * 100) / 100).toFixed(2)

export function offerLetter(f: Fields): Block[] {
  const cls = classificationParagraph(f.classification)
  if (!cls) throw new Error('no approved terms for this classification')
  return [
    { k: 'small', t: HEADER },
    { k: 'p', t: `Date: ${f.date}` },
    { k: 'p', t: `Dear ${f.first} ${f.last},` },
    { k: 'p', t: "Thank you for taking the time to meet with us. We enjoyed getting to know you, and we're excited to offer you a position with Caring Companions In-Home Senior Care!" },
    { k: 'p', t: "We believe you'll be a wonderful addition to our team, and we're looking forward to welcoming you." },
    { k: 'p', t: `Position: ${f.position}` },
    { k: 'p', t: `Employment classification: ${CLASSIFICATIONS[f.classification]}` },
    { k: 'p', t: `Starting Pay: $${rate(f.pay_rate)} per hour, paid weekly on Fridays` },
    { k: 'p', t: 'This is a non-exempt, hourly position and is eligible for overtime pay for all hours worked over 40 in a workweek.' },
    { k: 'p', t: cls },
    { k: 'h', t: 'YOUR EMPLOYMENT OFFER' },
    { k: 'p', t: 'Your employment with Caring Companions is contingent upon successfully completing our pre-employment process, which includes:' },
    { k: 'li', t: 'Successful completion of all required onboarding documents.' },
    { k: 'li', t: 'A satisfactory criminal background check.' },
    { k: 'li', t: 'Satisfactory reference checks (personal and professional).' },
    { k: 'li', t: 'A satisfactory Motor Vehicle Record (MVR) review, when your duties include driving.' },
    { k: 'li', t: DRUG_SCREENING_LINE },
    { k: 'li', t: 'Verification that you are legally authorized to work in the United States.' },
    { k: 'h', t: 'WHAT HAPPENS NEXT?' },
    { k: 'p', t: 'Your onboarding starts here!' },
    { k: 'p', t: 'This job offer is the first step of your onboarding. After you accept and sign, your Step 1 paperwork is sent to you automatically by text and email once your signed offer is saved, and you complete it on your phone.' },
    { k: 'p', t: "These initial documents are important because they give Caring Companions permission to begin your pre-employment process, including your background check, reference checks, motor vehicle record review (when your duties include driving), and any drug screening required by Caring Companions' screening policy." },
    { k: 'p', t: 'The sooner you complete this first step, the sooner we can begin these required checks.' },
    { k: 'p', t: 'Once your pre-employment screenings have been completed successfully, you will receive a text to book a short welcome video call, and your paid orientation and training link right after it.' },
    { k: 'p', t: "If you have any questions along the way, we're happy to help. Just give our office a call at (417) 234-8494." },
    { k: 'h', t: 'EMPLOYMENT RELATIONSHIP' },
    { k: 'q', t: 'Employment with Caring Companions is at will. This means that either you or the Company may end the employment relationship at any time, with or without notice, and with or without cause, as permitted by applicable law.' },
    { k: 'p', t: `This offer will remain open for seven (7) business days from the date of this letter, through ${f.expires}. Your signing link expires at the same time.` },
    { k: 'p', t: 'We are excited about the opportunity to have you join the Caring Companions family and look forward to working with you!' },
    { k: 'p', t: 'Warmly,' },
    { k: 'p', t: 'Samantha Troutman, Co-Founder & CEO, Caring Companions In-Home Senior Care' },
    { k: 'small', t: `Issued by ${f.issued_by}, ${f.issued_at}` },
    { k: 'h', t: 'ACCEPTANCE OF EMPLOYMENT OFFER' },
    { k: 'p', t: 'I accept the employment offer described above and understand that this offer is contingent upon successfully completing all required pre-employment requirements.' },
    { k: 'small', t: `Document version ${OFFER_DOC_VERSION}` },
  ]
}
export function positionDescription(f: Fields): Block[] {
  if (!CLASSIFICATIONS[f.classification]) throw new Error('no approved terms for this classification')
  return [
    { k: 'h', t: 'Caregiver · Position description · Version 1 (from the 2025–2027 Edition)' },
    { k: 'small', t: `Reports to: Care Coordinator / Lead Caregiver · FLSA status: Non-Exempt (Hourly) · Category: Field · Direct Care · Employment classification: ${CLASSIFICATIONS[f.classification]}` },
    { k: 'h', t: 'POSITION SUMMARY' },
    { k: 'p', t: "The Caregiver provides non-medical, in-home care that helps clients remain safe, independent, and comfortable in their own homes. Working from each client's individualized care plan, the Caregiver delivers personal care, homemaker, companionship, and transportation support with compassion, reliability, and professionalism." },
    { k: 'h', t: 'ESSENTIAL DUTIES & RESPONSIBILITIES' },
    { k: 'li', t: "Follow each client's individualized care plan and complete all assigned care tasks." },
    { k: 'li', t: 'Provide personal care such as bathing, dressing, grooming, oral hygiene, toileting and incontinence care, and feeding assistance when appropriate.' },
    { k: 'li', t: 'Assist with mobility, transfers, walking, and fall prevention using proper body mechanics.' },
    { k: 'li', t: 'Provide medication reminders (not medication administration).' },
    { k: 'li', t: 'Perform homemaker services including meal preparation, light housekeeping, laundry, and maintaining a clean, safe environment.' },
    { k: 'li', t: 'Provide companionship, conversation, and encouragement of social and physical activity.' },
    { k: 'li', t: 'Transport or accompany clients to appointments and approved errands when authorized by the care plan.' },
    { k: 'li', t: "Observe and promptly report changes in the client's physical condition, mental status, safety, or environment." },
    { k: 'li', t: 'Clock in and out using AxisCare Electronic Visit Verification (EVV) and complete accurate, timely documentation before the end of each shift.' },
    { k: 'li', t: 'Maintain professional boundaries and safeguard client property, privacy, and confidentiality.' },
    { k: 'h', t: 'QUALIFICATIONS & REQUIREMENTS' },
    { k: 'li', t: 'Be at least 18 years of age.' },
    { k: 'li', t: 'Successfully pass all required background screenings.' },
    { k: 'li', t: DRUG_SCREENING_LINE },
    { k: 'li', t: "Maintain a valid driver's license and current automobile insurance if transporting clients." },
    { k: 'li', t: 'Possess reliable transportation and a working telephone.' },
    { k: 'li', t: 'Meet applicable licensing, certification, and training requirements.' },
    { k: 'li', t: "Complete orientation, onboarding, dementia/Alzheimer's training, and annual in-service requirements." },
    { k: 'li', t: 'Demonstrate compassion, dependability, and professionalism, and communicate effectively.' },
    { k: 'h', t: 'PHYSICAL REQUIREMENTS & WORKING CONDITIONS' },
    { k: 'p', t: "Requires standing, walking, bending, and assisting with transfers; must be able to safely support client mobility and lift up to 50 pounds, where authorized, using proper body mechanics and equipment such as gait belts. Work is performed in clients' homes and may involve exposure to pets and varied household environments." },
    { k: 'h', t: 'ACKNOWLEDGMENT' },
    { k: 'p', t: 'I acknowledge that I have received, read, and understand this position description. I understand it summarizes the primary purpose, essential duties, and qualifications of this position; that it is a general overview and not exhaustive; and that it is not a contract of employment, expressed or implied. I understand that Caring Companions may add, remove, or modify job duties at its discretion based on business and client needs, and that this description does not alter my at-will employment status. I confirm that I am physically able to perform the essential duties of this position, including the physical requirements described above, with or without reasonable accommodation.' },
    { k: 'small', t: `Issued by ${f.issued_by}, ${f.issued_at}` },
    { k: 'small', t: 'This description summarizes the primary purpose, essential duties, and qualifications of this role. It is a general overview, is not exhaustive, and does not alter the at-will employment relationship. Duties may vary based on client needs, assignment, licensure, and company requirements.' },
    { k: 'small', t: 'Caring Companions In-Home Senior Care · 1331 N Stewart Ave, Ste B, Springfield, MO 65802 · (417) 234-8494 · mo-care.com' },
    { k: 'small', t: `Document version ${PD_DOC_VERSION}` },
  ]
}
/** One line per block with its kind, so the fingerprint covers wording AND structure. */
export const canonical = (blocks: Block[]) => blocks.map((b) => `${b.k}|${b.t}`).join('\n')
export async function fingerprint(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('')
}
/** "October 9, 2026" in Chicago. */
export function longDate(at: Date | string | number): string {
  return new Date(at).toLocaleDateString('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: 'long', day: 'numeric' })
}
export function longDateTime(at: Date | string | number): string {
  return new Date(at).toLocaleString('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' Central'
}
