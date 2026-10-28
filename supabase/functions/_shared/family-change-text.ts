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
//   none  -> complete, nobody to tell (reason says why; 'every_member_opted_out' when the universal opt-out
//            check refused them all, 0b-2)
//   sent  -> complete, count texts went
//   retry -> real recipients existed but every send failed; leave unstamped
// =============================================================================
import { contactForOutbound } from './outreach.ts'
import { coversThemselves } from './covered-outside.ts'
import { ghlSendChecked } from './send-problems.ts'
import { findCardForCase, meetLine, cardName, isLinkable } from './caregiver-card-link.ts'
import { isPlaceholderCaregiver } from './cg-placeholder.ts'

/* 872 (Samantha 2026-10-16, "Separately"): running-late texts follow their own switch, wants_late, so a person who
   ticked only "Caregiver change" on the Client Care Agreement never gets running-late texts (and the other way round).
   kind 'change' (the default, every existing caller) is unchanged. */
export type FamilyResult = { outcome: 'none' | 'sent' | 'retry'; count: number; reason: string | null; circle: string | null }
// deno-lint-ignore no-explicit-any
export function eligibleMembers(members: any[], kind: 'change' | 'late' = 'change'): any[] {
  return (members ?? []).filter((m) => m && m.sms_consent === true && (kind === 'late' ? m.wants_late !== false : m.wants_changes !== false)
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
  /* stage A (2026-10-17): filling an open shift nobody held (coverage-watch's open-schedule cases, reason 'open': a new client's first caregiver) is
     not a change: the family hears about their caregiver from the Care Coordinator (Start of Care step 7), never this text */
  if (c?.reason === 'open' && !String(c?.calling_off ?? '').trim()) return { outcome: 'none', count: 0, reason: 'open_shift_not_a_change', circle: null }
  /* never "Ashley can't make it, so Ashley is coming instead" (Elizabeth Kurtz, 2026-09-27) */
  /* 2026-10-28: "Canceled Shift" is AxisCare's placeholder, nobody. A case it "covered" is a cancelled visit, never news to a family
     (1162 found a 10-23 case counted as texted with covered_by "Canceled Shift"). */
  if (isPlaceholderCaregiver(c?.covered_by)) return { outcome: 'none', count: 0, reason: 'covered_by_is_the_canceled_shift_placeholder', circle: null }
  if (coversThemselves(c)) return { outcome: 'none', count: 0, reason: 'covering_caregiver_is_the_one_who_called_off', circle: null }
  const ax = String(c?.client_axiscare_id ?? '').trim()
  if (!ax) return { outcome: 'none', count: 0, reason: 'case_has_no_axiscare_id', circle: null }
  const { data: circs } = await sb.from('care_circles').select('id, client_name').eq('active', true).eq('axiscare_client_id', ax)
  if (!circs || circs.length !== 1) return { outcome: 'none', count: 0, reason: circs && circs.length > 1 ? 'two_linked_circles' : 'no_linked_circle', circle: null }
  const circle = circs[0]
  const { data: mem } = await sb.from('circle_contacts').select('*').eq('circle_id', circle.id)
  const members = eligibleMembers(mem ?? [])
  if (!members.length) return { outcome: 'none', count: 0, reason: 'no_consenting_member', circle: circle.client_name }

  /* 2b (2026-10-01): the link is the covering caregiver's ONE profile card (caregiver.html), found by AxisCare id
     first, else a unique full-name match, published profiles only (caregiver-card-link.ts). No card: no link, and
     the text still goes exactly as before. meet.html is no longer linked from anywhere. */
  const card = (await findCardForCase(sb, c)).profile
  const meet = meetLine(card)
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

  let sent = 0, optedOut = 0
  const reached: string[] = []
  for (const m of members) {
    /* some circle members ARE the client: speak to them as "you" */
    const selfIsClient = !!clientFirst && nameKey(String(m.name || '').split(/\s+/)[0]) === nameKey(clientFirst)
      && nameKey(m.name) === nameKey(circle.client_name)
    try {
      const dest = await gate(sb, ghl,
        { phone: m.phone, firstName: String(m.name || 'Family').split(' ')[0], lastName: String(m.name || '').split(' ').slice(1).join(' ') },
        'reactive_external', { audience: 'family', explicitlyEnabled: true, channel: 'sms',
          sender: 'coverage-run (caregiver change text)', onOptOut: () => { optedOut++ } })
      if (!dest?.contactId) continue
      /* NO SILENT FAILURES (2026-10-01): sent by the coverage job with nobody watching, so a text GoHighLevel refused
         raises a Needs Attention card naming the family member (the retry/stamp outcomes below are unchanged) */
      const went = await ghlSendChecked(sb, { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
        'family-change-text', { channel: 'sms', contactId: dest.contactId, address: m.phone, who: m.name },
        { message: msgFor(selfIsClient) }, send)
      if (went) { sent++; reached.push(String(m.name || '')) }
    } catch { /* one family text failing must not block the rest */ }
  }
  if (sent) {
    /* 2026-10-28 (profile-intro): a change text that carried the covering caregiver's profile counts as their introduction
       to this family, so the profile check never sends the same caregiver to them again. Never blocks the result. */
    if (isLinkable(card)) {
      try {
        await sb.from('caregiver_intro_log').insert({ profile_id: card.id, caregiver_name: cardName(card), client_name: circle.client_name,
          circle_id: circle.id, sent_to: reached.join(', '), channel: 'sms', reason: 'change', sent_by: 'automatic (call-in change text)',
          client_axiscare_id: ax, caregiver_axiscare_id: String(card.axiscare_id ?? '').trim() || null, visit_id: String(c.axiscare_visit_id ?? '').trim() || null, auto: true })
      } catch { /* the text went; the log line is a convenience */ }
    }
    return { outcome: 'sent', count: sent, reason: null, circle: circle.client_name }
  }
  /* Nobody may be texted: an opt-out is an answer, not a failure, so the case is complete (no retry loop). */
  if (optedOut === members.length) return { outcome: 'none', count: 0, reason: 'every_member_opted_out', circle: circle.client_name }
  return { outcome: 'retry', count: 0, reason: 'every send failed', circle: circle.client_name }
}
