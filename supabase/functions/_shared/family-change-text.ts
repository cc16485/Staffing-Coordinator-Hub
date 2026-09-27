// =============================================================================
// family-change-text — "your caregiver has changed", after a CONFIRMED fill (Change 6a, 2026-09-27)
// =============================================================================
// The ONE automatic family text Samantha has approved as an exception to her
// audience rule (2026-09-27: "Approve it as an exception to your rule"). It goes
// through the shared outbound gate as audience 'family', and only while
// ops_settings.family_caregiver_change_text_approved records that approval.
//
// Who hears it:
//   * the Family Circle tied to the case's AxisCare client id (never a name match;
//     a circle nobody has linked is never texted);
//   * members with texting consent, who want caregiver-change updates, with a real
//     phone number, who have not replied STOP (stopped_at), and who are still on
//     the client's AxisCare contacts (axiscare_removed_at is empty).
// Returns what happened; coverage-run stamps the case from it:
//   none  -> complete, nobody to tell (reason says why)
//   sent  -> complete, count texts went
//   retry -> real recipients existed but every send failed; leave unstamped
// =============================================================================
import { contactForOutbound } from './outreach.ts'
import { coversThemselves } from './covered-outside.ts'

export type FamilyResult = { outcome: 'none' | 'sent' | 'retry'; count: number; reason: string | null; circle: string | null }
// deno-lint-ignore no-explicit-any
export function eligibleMembers(members: any[]): any[] {
  return (members ?? []).filter((m) => m && m.sms_consent === true && m.wants_changes !== false
    && !m.stopped_at && !m.axiscare_removed_at
    && String(m.phone || '').replace(/\D/g, '').length >= 10)
}
const nameKey = (x: unknown) => String(x ?? '').toLowerCase().replace(/[^a-z]/g, '')

export async function notifyFamilyOfChange(
  // deno-lint-ignore no-explicit-any
  sb: any, ghl: { token: string; locationId: string },
  // deno-lint-ignore no-explicit-any
  c: any, settings: Record<string, unknown>,
  parts: { whenText: string; clock?: (s: string) => string },
  // deno-lint-ignore no-explicit-any
  gate: (...a: any[]) => Promise<{ contactId: string } | null> = contactForOutbound as any,
  send: typeof fetch = fetch,
): Promise<FamilyResult> {
  const approval = settings?.family_caregiver_change_text_approved
  if (!approval || typeof approval !== 'object') return { outcome: 'none', count: 0, reason: 'not_enabled', circle: null }
  /* never "Ashley can't make it, so Ashley is coming instead" (Elizabeth Kurtz, 2026-09-27) */
  if (coversThemselves(c)) return { outcome: 'none', count: 0, reason: 'covering_caregiver_is_the_one_who_called_off', circle: null }
  const ax = String(c?.client_axiscare_id ?? '').trim()
  if (!ax) return { outcome: 'none', count: 0, reason: 'case_has_no_axiscare_id', circle: null }
  const { data: circs } = await sb.from('care_circles').select('id, client_name').eq('active', true).eq('axiscare_client_id', ax)
  if (!circs || circs.length !== 1) return { outcome: 'none', count: 0, reason: circs && circs.length > 1 ? 'two_linked_circles' : 'no_linked_circle', circle: null }
  const circle = circs[0]
  const { data: mem } = await sb.from('circle_contacts').select('*').eq('circle_id', circle.id)
  const members = eligibleMembers(mem ?? [])
  if (!members.length) return { outcome: 'none', count: 0, reason: 'no_consenting_member', circle: circle.client_name }

  let meet = ''
  try {
    const { data: intros } = await sb.from('caregiver_intros').select('id, name, intro')
    // deno-lint-ignore no-explicit-any
    const g = (intros ?? []).find((x: any) => String(x.name || '').trim().toLowerCase() === String(c.covered_by).trim().toLowerCase())
    if (g) meet = ' Meet them here: https://cc.mo-care.com/meet.html?cg=' + g.id
  } catch { /* no intro, no link */ }
  const offFirst = String(c.calling_off || '').trim().split(/\s+/)[0]
  const clientFirst = String(c.client || '').trim().split(/\s+/)[0]
  const template = String(settings.circle_msg_caregiver_change || '') ||
    `Hello, this is Caring Companions. {off} is unable to make {client}'s visit {when}, so {caregiver} from our team will be coming instead. Everything else about the visit stays the same.{meet} Any questions at all, call us at (417) 234-8494.`
  const msgFor = (selfIsClient: boolean) => template
    .replaceAll('{off}', offFirst || 'The caregiver scheduled')
    .replaceAll("{client}'s", selfIsClient ? 'your' : (String(c.client || 'your loved one') + "'s"))
    .replaceAll('{client}', selfIsClient ? 'you' : String(c.client || 'your loved one'))
    .replaceAll('{when}', parts.whenText || 'as scheduled')
    .replaceAll('{caregiver}', String(c.covered_by).split(' ')[0])
    .replaceAll('{meet}', meet)
    .replace(/\s{2,}/g, ' ').trim()

  let sent = 0
  for (const m of members) {
    /* some circle members ARE the client: speak to them as "you" */
    const selfIsClient = !!clientFirst && nameKey(String(m.name || '').split(/\s+/)[0]) === nameKey(clientFirst)
      && nameKey(m.name) === nameKey(circle.client_name)
    try {
      const dest = await gate(sb, ghl,
        { phone: m.phone, firstName: String(m.name || 'Family').split(' ')[0], lastName: String(m.name || '').split(' ').slice(1).join(' ') },
        'reactive_external', { audience: 'family', explicitlyEnabled: true })
      if (!dest?.contactId) continue
      const r = await send('https://services.leadconnectorhq.com/conversations/messages', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'SMS', contactId: dest.contactId, message: msgFor(selfIsClient) }),
      })
      if (r.ok) sent++
    } catch { /* one family text failing must not block the rest */ }
  }
  return sent ? { outcome: 'sent', count: sent, reason: null, circle: circle.client_name }
              : { outcome: 'retry', count: 0, reason: 'every send failed', circle: circle.client_name }
}
