/**
 * 808 · Which number an applicant text goes out from (Samantha, 2026-10-16: "Approve the Oklahoma applicant messages plan
 * with all five decisions as you recommended". Plan: https://claude.ai/artifact/6o96izMj4RBMEFZmgQBNn2).
 *
 * Missouri: nothing changes. No fromNumber is passed, so GoHighLevel uses the account's default number (417), as always.
 * Oklahoma (job_applicants.office = 'OK'): the text names its sender, ops_settings.ok_from_number (set on the Owners Hub
 * Admin page; +1 405 500 1758, which lives in the same Caring Companions account). HighLevel's API: SendMessageBodyDto
 * fromNumber, "Phone number used as the sender number for outbound messages". If the Oklahoma number is missing or not a
 * phone number the send is REFUSED, never sent from 417 (no silent failures: the caller raises a Needs Attention card).
 */
export const OK_FROM_DEFAULT = '+14055001758'
export const OK_NAME = 'Caring Companions Oklahoma'
export const MO_PHONE = '(417) 234-8494'

/** +1XXXXXXXXXX from anything with ten digits (a leading 1 allowed); null otherwise */
export function e164(raw: unknown): string | null {
  const d = String(raw ?? '').replace(/\D/g, '')
  if (d.length === 10) return '+1' + d
  if (d.length === 11 && d.startsWith('1')) return '+' + d
  return null
}
/** (405) 500-1758 */
export function pretty(n: string | null): string {
  const d = String(n ?? '').replace(/\D/g, '').slice(-10)
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : ''
}
// deno-lint-ignore no-explicit-any
export type Ops = Record<string, any>
/** ops_settings, or {} (a failed read means "no Oklahoma number": Oklahoma texts are refused, Missouri ones are unaffected) */
// deno-lint-ignore no-explicit-any
export async function readOps(db: any): Promise<Ops> {
  try {
    const { data } = await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
    return data?.data && typeof data.data === 'object' && !Array.isArray(data.data) ? data.data : {}
  } catch { return {} }
}
export type From = { office: 'MO' | 'OK'; fromNumber?: string; refuse?: string; phone: string; name: string; video?: string; videoRefuse?: string }
/* Oklahoma interviews are VIDEO interviews (her words 2026-10-16: "I want Zoom interviews set up like an easy link - or could be
   google meet interview"): one standing link (ops_settings.ok_interview_link, Admin page), a Zoom or Google Meet address. */
export function videoLink(raw: unknown): string | null {
  const s = String(raw ?? '').trim()
  return /^https:\/\/([\w-]+\.)*(zoom\.us|meet\.google\.com)\/\S+$/i.test(s) && s.length <= 300 ? s : null
}
/** The sender for an applicant's office. Missouri: no fromNumber. Oklahoma: the Admin page's number, or a refusal. */
export function fromFor(office: unknown, ops: Ops): From {
  if (office !== 'OK') return { office: 'MO', phone: MO_PHONE, name: 'Caring Companions In-Home Senior Care' }
  const n = e164(ops.ok_from_number)
  if (!n) return { office: 'OK', refuse: 'no Oklahoma sending number is set (Owners Hub Admin page), so it was not sent from the Missouri number', phone: '', name: OK_NAME }
  const v = videoLink(ops.ok_interview_link)
  return { office: 'OK', fromNumber: n, phone: pretty(n), name: OK_NAME, ...(v ? { video: v } : { videoRefuse: 'no Oklahoma video interview link is set (Owners Hub Admin page), so the interview message was not sent' }) }
}
/** the SMS payload with the sender named when there is one */
export const smsBody = (from: From, payload: Record<string, unknown>) => (from.fromNumber ? { ...payload, fromNumber: from.fromNumber } : payload)
