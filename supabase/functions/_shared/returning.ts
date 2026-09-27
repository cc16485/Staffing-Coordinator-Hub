// =============================================================================
// Returning families at the automatic front doors (One client profile, step 5b C, 2026-09-27)
// =============================================================================
// The web form, the booking calendars, the AI phone call and call dispositions used to find an OLD
// inquiry by phone and rewrite it: notes overwritten, a Converted inquiry pushed back to "Assessment
// Scheduled". Now:
//   - only an OPEN inquiry is ever reused (not Converted, not Lost, not archived)
//   - a closed inquiry is never rewritten; the family gets a NEW inquiry
//   - a new inquiry is checked against old inquiries, AxisCare (current and former clients) and the
//     Family Circles; any match flags it "possibly returning" and puts one "is this the same family?"
//     item on My Work. A person decides on the inquiry. Software never merges or links.
// Nothing here contacts anyone.
// =============================================================================
import { find } from './client-lookup.ts'

// deno-lint-ignore no-explicit-any
type Lead = Record<string, any>
export const isClosedLead = (l: Lead | null | undefined): boolean =>
  !!l && (l.archived === true || l.status === 'Converted' || l.status === 'Lost')
const d10 = (p: unknown) => { const d = String(p ?? '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : '' }

/* every inquiry matching a phone (theirs or the care recipient's) or the email, split open / closed */
export function leadHits(leads: Lead[], phones: unknown[], email?: unknown): { open: Lead[]; closed: Lead[] } {
  const ps = [...new Set(phones.map(d10).filter(Boolean))]
  const em = String(email ?? '').trim().toLowerCase()
  const hits = (leads || []).filter((l) => l && (
    (ps.length && (ps.includes(d10(l.phone)) || ps.includes(d10(l.client_phone)))) ||
    (em && String(l.email ?? '').trim().toLowerCase() === em)))
  return { open: hits.filter((l) => !isClosedLead(l)), closed: hits.filter(isClosedLead) }
}

const leadName = (l: Lead) => [l.client_first_name, l.client_last_name].filter(Boolean).join(' ').trim()
  || [l.first_name, l.last_name].filter(Boolean).join(' ').trim() || '(no name)'

export type Flag = { at: string; by: string; matches: Array<Record<string, unknown>>; axiscare_checked: boolean }

/* The check for a NEW inquiry. inquiries = the other inquiries that matched (any status). Returns a flag,
   or null when nothing matched. AxisCare being down never blocks the inquiry; the flag says so. */
// deno-lint-ignore no-explicit-any
export async function returningCheck(db: any, by: string, q: { phones: unknown[]; email?: unknown; first?: unknown; last?: unknown; dob?: unknown },
                                     inquiries: Lead[], fetcher: typeof fetch = fetch): Promise<Flag | null> {
  const em = String(q.email ?? '').trim().toLowerCase()
  const matches: Array<Record<string, unknown>> = inquiries.map((l) => ({ kind: 'inquiry', lead_id: String(l.id), name: leadName(l),
    status: l.archived === true ? 'archived' : String(l.status || 'New'),
    why: [...(q.phones.map(d10).filter(Boolean).some((p) => p === d10(l.phone) || p === d10(l.client_phone)) ? ['phone'] : []),
          ...(em && String(l.email ?? '').trim().toLowerCase() === em ? ['email'] : [])] }))
  let checked = false
  try {
    const r = await find({ phones: q.phones.map((p) => String(p ?? '')), first: q.first, last: q.last, dob: q.dob }, db, fetcher)
    checked = r.axiscare_ok !== false
    /* a name alone (often the caller's, not the client's) is too weak to raise work on its own */
    for (const m of (r.matches ?? []).filter((x) => !(x.why.length === 1 && x.why[0] === 'name_only'))) matches.push({ kind: 'axiscare', axiscare_client_id: m.axiscare_client_id, name: m.name,
      active: m.active, status: m.status, why: m.why, family: m.family ?? [] })
  } catch { checked = false }
  if (!matches.length) return null
  return { at: new Date().toISOString(), by, matches: matches.slice(0, 10), axiscare_checked: checked }
}

/* the one My Work item; its source opens the new inquiry, and answering on the inquiry closes it */
export function returningItem(lead: Lead, flag: Flag, by: string) {
  const who = [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim() || leadName(lead)
  const lines = flag.matches.map((m) => m.kind === 'inquiry'
    ? `an earlier inquiry for ${m.name} (${m.status})`
    : `${m.active === true ? 'current' : m.active === false ? 'former' : 'Family Circle'} client ${m.name}${m.axiscare_client_id ? ' (AxisCare #' + m.axiscare_client_id + ')' : ''}`)
  return {
    id: 'ops_returning_' + lead.id, kind: 'request', source_id: String(lead.id),
    source: { type: 'returning', lead_id: String(lead.id) },
    title: `Is this the same family? ${who}`, about: who,
    detail: `A new inquiry came in (${by}) that may be a family we already know: ${lines.join('; ')}.`
      + (flag.axiscare_checked ? '' : ' AxisCare couldn\'t be checked at the time.'),
    next_action: 'Open the inquiry and choose: the same family, or a different family.',
    phone: lead.phone || '', domain: 'family_enquiries', status: 'open', urgency: 'normal',
    owner: '', owner_name: '', created_at: flag.at, due: new Date(Date.parse(flag.at) + 24 * 3600e3).toISOString(),
    created_by: by, opened_by: 'system',
  }
}
