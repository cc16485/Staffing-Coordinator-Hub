/**
 * NO SILENT FAILURES (Samantha, 2026-10-01). Every text or email that is held back (the opt-out check said no, or
 * could not check) or that GoHighLevel refused becomes a card on Needs Attention (app_data 'ops_items', kind
 * 'send_problem'): who it was for, which message, why, and what to do next. Until now these only reached a log
 * nobody read: 83 messages stopped in one week (Desktop 382) and nobody knew.
 *
 * One card per sender + channel + address, so a job that runs every 15 minutes bumps a count instead of piling up
 * cards. A card a person closed for an opt-out stays closed (they already know); a fresh failure reopens it.
 * If 40 send cards are already open, further problems go onto ONE "many messages are not going out" card instead,
 * so a GoHighLevel outage reads as one problem, not 300.
 *
 * Never throws: reporting a problem must never break, or turn into, a send.
 */
type Channel = 'sms' | 'email'
export type SendProblem = {
  sender: string; channel: Channel; address?: unknown; who?: unknown
  reasons: string[]; failed?: boolean          // failed: GoHighLevel was asked to send and said no
  count?: number; first_at?: string; last_at?: string; note?: string; cap?: number   // the one-time catch-up of older refusals only
}
const MAX_OPEN = 40

/* Which message, in the office's words. Unknown senders show their own name. */
export const SENDER_WORDS: Record<string, [string, string]> = {
  // sender: [what the message was, the domain whose owner gets the card]
  'interview-messages': ['interview confirmation / reminder', 'caregivers'],
  'reference-chase': ['reference request', 'caregivers'],
  'reference-send': ['reference form', 'caregivers'],
  'applicant-invite': ['application link', 'caregivers'],
  'applicant-noshow': ['interview no-show message', 'caregivers'],
  'applicant-reengage': ['note to a past applicant', 'caregivers'],
  'send-candidate-message': ['message to a candidate', 'caregivers'],
  'send-invite': ['orientation / training invite', 'caregivers'],
  'send-reminder': ['training reminder', 'caregivers'],
  'job-offer': ['job offer', 'caregivers'],
  'welcome': ['welcome message', 'caregivers'],
  'notify-cleared': ['"cleared to work" text', 'caregivers'],
  'send-certificate': ['training certificate email', 'caregivers'],
  'sync-axiscare': ['training welcome / reminder', 'caregivers'],
  'prn-reconfirm': ['PRN check-in', 'caregivers'],
  'caregiver-intro': ['caregiver introduction', 'scheduling_coverage'],
  'caregiver-availability': ['availability check', 'scheduling_coverage'],
  'coverage-run': ['open shift text', 'scheduling_coverage'],
  'coverage-reply': ['open shift reply', 'scheduling_coverage'],
  'shift-confirm': ['shift confirmation', 'scheduling_coverage'],
  'team-ask': ['Team Builder text', 'scheduling_coverage'],
  'carematch-watch': ['care match message', 'scheduling_coverage'],
  'late-watch': ['running-late message', 'scheduling_coverage'],
  'late-alert': ['running-late message', 'scheduling_coverage'],
  'timekeeper-watch': ['missed clock-in text', 'scheduling_coverage'],
  'clockin-alert': ['missed clock-in text', 'scheduling_coverage'],
  'missed-notes': ['missed shift note text', 'caregivers'],
  'circle-send': ['Family Circle message', 'client_care'],
  'cc-memories': ['Family Circle message', 'client_care'],
  'cc-corner': ['family message', 'client_care'],
  'ghe-reminders': ['reminder to the nurses / office', 'client_care'],
  'EVV chase': ['EVV correction reminder', 'scheduling_coverage'],
  'lead-intake': ['reply to a new family lead', 'family_enquiries'],
  'lead-followup': ['family lead follow-up', 'family_enquiries'],
  'lead-nurture': ['family lead follow-up', 'family_enquiries'],
  'cc-booking': ['assessment booking message', 'family_enquiries'],
  'campaign-send': ['campaign message', 'family_enquiries'],
  'campaign-auto': ['campaign message', 'family_enquiries'],
  'staff-alert': ['alert to the office', 'office_ops'],
  'family-change-text': ['caregiver-change text to the family', 'client_care'],
  'lead-digest': ['morning brief email', 'office_ops'],
  'shared-backup': ['weekly backup email', 'office_ops'],
  /* HomeTogether (sister business): its failures stay on the same Needs Attention list for now (Samantha, 2026-10-01) */
  'ht-local': ['HomeTogether Hire message', 'office_ops'],
  'ht-local-alert': ['HomeTogether Hire alert to the office', 'office_ops'],
  'ht-support': ['HomeTogether support email', 'office_ops'],
  'ht-inbound': ['HomeTogether support email forwarded to the office', 'office_ops'],
  'resend-relay': ['HomeTogether email sent through the relay', 'office_ops'],
  'stripe-webhook': ['HomeTogether payment email', 'office_ops'],
  'stripe-webhook-alert': ['HomeTogether payment alert to the office', 'office_ops'],
  'vapi-interview': ['HomeTogether AI interview alert to the office', 'office_ops'],
}
/* The Training Platform names some senders with a note in brackets: "job-offer (by <staff email>)", "sync-axiscare (welcome)".
   Use whichever part is a known sender, and never put the bracket (which can hold a staff email) on a card. */
export const senderKey = (sender: string): string => {
  const m = String(sender ?? '').match(/^([^()]+?)\s*\((.*)\)\s*$/)
  if (!m) return String(sender ?? '')
  return SENDER_WORDS[m[2].trim()] ? m[2].trim() : m[1].trim()
}
const words = (sender: string): [string, string] => SENDER_WORDS[senderKey(sender)] ?? [senderKey(sender).replace(/[-_]/g, ' ').replace(/[^\w ]/g, '') + ' message', 'office_ops']

/* Why, in the office's words, and what to do about it. */
export function explain(reasons: string[], failed: boolean, channel: Channel): { code: string; why: string; next: string } {
  const r = reasons.join(' · ')
  /* an authority's no (STOP, Do Not Disturb) wins over a "could not check" listed beside it */
  const said = reasons.filter((x) => !/^could not check/i.test(x)).join(' · ')
  const addr = channel === 'sms' ? 'phone number' : 'email address'
  if (failed) return { code: 'failed', why: (/resend/i.test(r) ? 'The email service (Resend)' : 'GoHighLevel') + ' did not accept the message (' + r.slice(0, 120) + ').',
    next: 'Reach them another way (call, or the other channel). If several of these appear at once, ' + (/resend/i.test(r) ? 'the email service' : 'GoHighLevel') + ' may be down: tell Samantha.' }
  if (/opted out|marked stopped/i.test(said)) return { code: 'opted_out', why: 'They asked us to stop (replied STOP, or the office marked it).',
    next: 'Don\'t message them. If they still need to hear from us, call them.' }
  if (/Do Not Disturb is on/i.test(said)) return { code: 'dnd', why: 'Do Not Disturb is on for them in GoHighLevel.',
    next: 'Call them instead. Only turn Do Not Disturb off if they ask you to.' }
  if (/no usable|no phone and no email|has no usable/i.test(r)) return { code: 'no_address', why: 'There is no usable ' + addr + ' on file.',
    next: 'Get a correct ' + addr + ', fix it in the Hub, then resend from where it started.' }
  if (/could not check|no contact|could not return|GHL returned/i.test(r)) return { code: 'unchecked', why: 'The Hub couldn\'t confirm they hadn\'t opted out, so it held the message back to be safe (' + r.slice(0, 120) + ').',
    next: 'Resend it from where it started, or call them.' }
  if (/audience|must name its channel/i.test(r)) return { code: 'blocked', why: 'This kind of automatic message isn\'t allowed to this person (' + r.slice(0, 120) + ').',
    next: 'If they need to hear from us, a person reaches out.' }
  return { code: 'other', why: 'It was held back: ' + r.slice(0, 160), next: 'Reach them another way, or tell Samantha.' }
}

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } return (h >>> 0).toString(36) }
const normAddr = (channel: Channel, a: unknown) => {
  const s = String(a ?? '').trim()
  if (channel === 'email') return s.toLowerCase()
  const d = s.replace(/\D/g, ''); return d.length >= 10 ? '+1' + d.slice(-10) : s
}

// deno-lint-ignore no-explicit-any
const ownerCache: Record<string, string> = {}
// deno-lint-ignore no-explicit-any
async function ownerFor(db: any, domain: string): Promise<string> {
  if (domain in ownerCache) return ownerCache[domain]
  let owner = ''
  try {  // the same canonical rule as issues-run: domains.owner_person, or honestly unowned
    const { data: dom } = await db.from('domains').select('owner_person').eq('code', domain).eq('entity', 'cc_ihs').maybeSingle()
    if (dom?.owner_person) {
      const { data: p } = await db.from('persons').select('primary_email').eq('person_id', dom.owner_person).maybeSingle()
      owner = String(p?.primary_email ?? '')
    }
  } catch { owner = '' }
  return (ownerCache[domain] = owner)
}

// deno-lint-ignore no-explicit-any
export async function reportSendProblem(db: any, p: SendProblem): Promise<void> {
  try {
    if (!db || typeof db.rpc !== 'function' || typeof db.from !== 'function') return
    const failed = !!p.failed
    const address = normAddr(p.channel, p.address)
    const [what, domain] = words(p.sender)
    const ex = explain(p.reasons ?? [], failed, p.channel)
    const id = 'ops_send_' + hash(p.sender + '|' + p.channel + '|' + (address || String(p.who ?? '?')))
    const now = new Date().toISOString()
    const { data: row } = await db.from('app_data').select('data').eq('key', 'ops_items').maybeSingle()
    // deno-lint-ignore no-explicit-any
    const items: any[] = Array.isArray(row?.data) ? row.data : []
    const prev = items.find((x) => x && x.id === id)
    const isOpen = (x: { status?: string }) => x && x.status !== 'done' && x.status !== 'resolved'
    if (prev && !isOpen(prev)) {
      // A person already saw this. An opt-out stays closed; a fresh failure within the hour is the same failure.
      if (['opted_out', 'dnd'].includes(ex.code) && prev.problem === ex.code) return
      const closedMs = Date.parse(prev.closed_at ?? prev.resolved_at ?? '') || 0
      if (prev.problem === ex.code && Date.now() - closedMs < 3_600_000) return
    }
    const chan = p.channel === 'sms' ? 'Text' : 'Email'
    const who = String(p.who ?? '').trim()
    const count = (prev && isOpen(prev) ? Number(prev.count) || 1 : 0) + (p.count ?? 1)
    if (!prev || !isOpen(prev)) {
      const open = items.filter((x) => x && x.kind === 'send_problem' && isOpen(x) && x.id !== 'ops_send_many').length
      if (open >= (p.cap ?? MAX_OPEN)) {
        const many = items.find((x) => x && x.id === 'ops_send_many')
        const n = (many && isOpen(many) ? Number(many.count) || 0 : 0) + (p.count ?? 1)
        /* 2026-10-01 (Samantha "yes do both"): the overflow card also says WHO each counted message was for (the last
           15), so nothing on it is anonymous. */
        const whoTxt = String(p.who ?? '').trim()
        const addrTxt = p.channel === 'sms' ? (address.length === 12 ? `(${address.slice(2, 5)}) ${address.slice(5, 8)}-${address.slice(8)}` : address) : address
        const recent = [{ at: now, channel: p.channel, what, who: whoTxt, address: addrTxt, why: ex.why },
          ...((many && isOpen(many) && Array.isArray(many.recent)) ? many.recent : [])].slice(0, 15)
        const tm = (t: string) => new Date(t).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
        const list = recent.map((r) => `• ${tm(r.at)} · ${r.channel === 'sms' ? 'text' : 'email'} · ${r.what} · ${[r.who, r.address].filter(Boolean).join(' ') || 'unknown'} · ${r.why}`).join('\n')
        await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item: {
          ...(many && isOpen(many) ? many : { created_at: now, first_at: now, owner: await ownerFor(db, 'office_ops'), owner_name: '' }),
          id: 'ops_send_many', kind: 'send_problem', domain: 'office_ops', status: 'open', urgency: 'urgent', problem: 'many',
          title: `Many messages are not going out (${n} more since ${new Date((many && isOpen(many) && many.first_at) || now).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })})`,
          detail: `More than ${MAX_OPEN} "didn't go through" cards are open, so new ones are counted here instead.\n` +
            `Next: something may be broken (often GoHighLevel). Tell Samantha, then work through the open cards. Once fewer than ${MAX_OPEN} are open, new problems get their own card again; close this one with Done.\n` +
            `Counted here${n > recent.length ? ` (latest ${recent.length} of ${n})` : ''}:\n${list}`,
          recent, count: n, last_at: now, due: (many && isOpen(many) && many.due) || new Date(Date.now() + 3_600_000).toISOString(),
          created_by: 'send-problems', opened_by: 'send-problems' } })
        return
      }
    }
    const due = prev && isOpen(prev) && prev.due ? prev.due
      : new Date(Date.now() + (['opted_out', 'dnd'].includes(ex.code) ? 24 : 8) * 3_600_000).toISOString()
    const shown = p.channel === 'email' ? address : ''
    const item = {
      ...(prev && isOpen(prev) ? prev : { owner: await ownerFor(db, domain), owner_name: '', created_at: now, first_at: p.first_at ?? now }),
      id, kind: 'send_problem', domain, status: 'open', urgency: ['opted_out', 'dnd'].includes(ex.code) ? 'normal' : 'today',
      title: `${chan} didn't go through: ${what}` + (who ? ` to ${who}` : ''),
      phone: p.channel === 'sms' ? address : (prev?.phone ?? ''),
      detail: [`Why: ${ex.why}`, `Next: ${ex.next}`, shown ? `Email: ${shown}` : '',
        count > 1 ? `Tried ${count} times, last ${new Date(p.last_at ?? now).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : '',
        p.note ?? ''].filter(Boolean).join('\n'),
      sender: p.sender, channel: p.channel, address, who, what, problem: ex.code, reasons: (p.reasons ?? []).slice(0, 5),
      count, last_at: p.last_at ?? now, due,
      closed_at: null, closed_by: null, close_note: null, resolved_at: null,
      created_by: 'send-problems', opened_by: 'send-problems',
    }
    await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item })
  } catch (e) { console.warn(`[send-problems] could not raise a card for ${p.sender}: ${String(e).slice(0, 160)}`) }
}

/**
 * Send one GHL message and say whether it really went. A refused send raises a card. Returns true only on a 2xx.
 */
export async function ghlSendChecked(
  // deno-lint-ignore no-explicit-any
  db: any, headers: Record<string, string>, sender: string,
  to: { channel: Channel; contactId: string; address?: unknown; who?: unknown },
  // deno-lint-ignore no-explicit-any
  body: Record<string, any>, send: typeof fetch = fetch,
): Promise<boolean> {
  let why = ''
  try {
    const r = await send('https://services.leadconnectorhq.com/conversations/messages', {
      method: 'POST', headers, body: JSON.stringify({ type: to.channel === 'sms' ? 'SMS' : 'Email', contactId: to.contactId, ...body }) })
    if (r.ok) return true
    const t = await r.text().catch(() => '')
    let m = ''; try { m = String(JSON.parse(t)?.message ?? '') } catch { m = t }
    why = `error ${r.status}${m ? ': ' + String(m).slice(0, 100) : ''}`
  } catch (e) { why = 'GoHighLevel could not be reached: ' + String((e as Error)?.message ?? e).slice(0, 80) }
  await reportSendProblem(db, { sender, channel: to.channel, address: to.address, who: to.who, reasons: [why], failed: true })
  return false
}
