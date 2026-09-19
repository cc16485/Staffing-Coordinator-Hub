/* lead-truth.ts — the contact-event vocabulary for leads (Samantha's rule,
   2026-09-19: attempted contact and actual human contact are different facts,
   and `contacted=true` may never blur them again).

   Every meaningful communication moment appends one event to the lead's
   contact_events[]:
     { at, channel, direction, outcome, actor, by?, note?, duration_s?, ref? }

   channel   'call' | 'sms' | 'email' | 'web' | 'in_person'
   direction 'out' | 'in'
   outcome   calls out: 'connected' | 'voicemail' | 'no_answer'
                        | 'requested_callback' | 'wrong_number'
             calls in:  'connected'
             sms/email: 'sent' | 'reply'
             web in:    'inquiry'
   actor     'human' (a Caring Companions person) | 'automation' | 'family'

   Two load-bearing timestamps are maintained here and ONLY here:
     first_human_attempt_at — first time a person tried to reach them
     first_human_contact_at — first real two-way conversation
   An automated ack, a voicemail, an unanswered call, or the family replying
   to a robot NEVER sets first_human_contact_at. last_* are derived from the
   events, never stored twice.

   The hub carries a deliberately duplicated JS copy (same reasoning as the
   opsLeadUntouched duplication): three stable rules beat a network hop in a
   send path. If this contract changes, change both. */

// deno-lint-ignore-file no-explicit-any
export function ldPush(l: any, ev: {
  channel: string; direction: 'in' | 'out'; outcome: string;
  actor: 'human' | 'automation' | 'family';
  by?: string; note?: string; duration_s?: number; ref?: string; at?: string;
}): any {
  const at = ev.at ?? new Date().toISOString()
  l.contact_events = Array.isArray(l.contact_events) ? l.contact_events : []
  l.contact_events.push({ at, ...ev })
  if (l.contact_events.length > 200) l.contact_events = l.contact_events.slice(-200)
  if (ev.actor === 'human' && ev.direction === 'out' && !l.first_human_attempt_at)
    l.first_human_attempt_at = at
  if (ev.actor === 'human' && ev.outcome === 'connected') {
    if (!l.first_human_attempt_at) l.first_human_attempt_at = at
    if (!l.first_human_contact_at) l.first_human_contact_at = at
  }
  if (ev.direction === 'in' && ev.actor === 'family') l.family_last_reply_at = at
  return l
}

/* TCPA opt-out keywords plus the plain-English asks. Used wherever an inbound
   family message is read. Recording the ask is the hub's half; GHL enforces
   its own STOP on its side. */
export function looksLikeOptOut(text: string): boolean {
  const t = String(text || '').trim().toLowerCase()
  if (/^(stop|stopall|unsubscribe|end|quit|cancel|revoke|optout|opt out)\b/.test(t)) return true
  return /(stop|quit|don'?t|do not|no more).{0,20}(text|message|contact|call)/i.test(t)
}
