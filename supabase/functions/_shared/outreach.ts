/* =============================================================================
   OUTREACH POLICY — THE ONE AUTHORITATIVE COPY
   =============================================================================
   Every automated sender imports this. The policy lives here so it cannot exist
   in twenty-seven slightly different versions, each drifting on its own.

   CLASSIFY BY WHY THE MESSAGE IS BEING SENT, NEVER BY HOW IT IS SENT.
   "It uses SMS" tells you nothing about whether it should go out on a Sunday.
   "Somebody just submitted a form and is waiting for an answer" tells you
   everything.

     reactive_external   Answering something the person JUST did — a form, a
                         booking, an application, a confirmation they are
                         waiting on. 7 days a week, 8am-6pm.
                         A Saturday enquiry answered on Monday is a lost client.

     proactive_external  WE started it. Nurture drips, campaigns, re-engagement,
                         reference chasing, admin follow-up with no deadline.
                         Weekdays only, 8am-6pm.
                         A marketing text on Sunday is an intrusion.

     urgent_internal     Staff, about something that needs acting on now — an
                         uncovered shift, an unresolved escalation. 24/7.
                         The 6am uncovered shift is exactly the thing somebody
                         needs at 6am.

     routine_internal    Staff, not urgent. Any hour that is operationally
                         useful.

     digest              Reports to staff. Any hour; the schedule decides.

   THE ONE RULE THAT MUST NOT BE BROKEN: urgent_internal exists so operational
   alerts reach staff at 3am. It must never become a way to send an EXTERNAL
   message outside the window. If a message reaches a client, a family, a lead,
   an applicant or a reference, it is external — whatever else is true about it.
   ============================================================================= */

export type OutreachClass =
  | 'reactive_external'
  | 'proactive_external'
  | 'urgent_internal'
  | 'routine_internal'
  | 'digest'

export const OUTREACH_TZ = 'America/Chicago'
/* The window is [WINDOW_START, WINDOW_END) — start inclusive, end EXCLUSIVE.
   Proven by fixture at every edge:
     07:59:59  hold      one second early is still early
     08:00:00  send      the first allowed instant
     17:59:59  send      the last allowed instant
     18:00:00  HOLD      six o'clock is the end of the window, not part of it
   Stated here because "8am to 6pm" is ambiguous in English and unambiguous in
   code, and the code is what runs. */
export const WINDOW_START = 8   // 08:00 inclusive
export const WINDOW_END = 18    // 18:00 exclusive — nothing sends at or after 6pm

/** Local hour and weekday in the operating timezone, never the server's. */
function localParts(now: Date = new Date()) {
  const hour = Number(
    now.toLocaleString('en-US', { timeZone: OUTREACH_TZ, hour: '2-digit', hour12: false }),
  )
  const weekday = now.toLocaleString('en-US', { timeZone: OUTREACH_TZ, weekday: 'short' })
  const isWeekend = weekday === 'Sat' || weekday === 'Sun'
  return { hour, weekday, isWeekend }
}

export interface Verdict {
  allowed: boolean
  reason: string
  /** Class and local time, so a run log can explain itself without guessing. */
  detail: { class: OutreachClass; hour: number; weekday: string }
}

/**
 * May this class of message go out right now?
 *
 * Deliberately returns a reason on both paths. A skipped send that cannot say
 * why is indistinguishable from a broken one, and the whole point of this
 * exercise is that silence must never be ambiguous.
 */
export function maySend(kind: OutreachClass, now: Date = new Date()): Verdict {
  const { hour, weekday, isWeekend } = localParts(now)
  const detail = { class: kind, hour, weekday }

  if (kind === 'urgent_internal')
    return { allowed: true, reason: 'urgent operational alert to staff, no window', detail }
  if (kind === 'routine_internal' || kind === 'digest')
    return { allowed: true, reason: 'internal, the schedule decides', detail }

  const inHours = hour >= WINDOW_START && hour < WINDOW_END
  if (!inHours)
    return {
      allowed: false,
      reason: `outside outreach hours (${WINDOW_START}:00-${WINDOW_END}:00 ${OUTREACH_TZ}, now ${hour}:00)`,
      detail,
    }

  if (kind === 'proactive_external' && isWeekend)
    return {
      allowed: false,
      reason: `proactive outreach is weekdays only (today is ${weekday})`,
      detail,
    }

  return { allowed: true, reason: 'within the window', detail }
}

/**
 * The guard most senders want at the top of Deno.serve.
 * Returns null when it may proceed, or a ready-made JSON Response when it must
 * not. Nothing is marked as sent, so anything skipped becomes eligible again on
 * the next run inside the window.
 */
export function outreachGate(
  req: Request,
  kind: OutreachClass,
  json: (b: unknown, s?: number) => Response,
): Response | null {
  // A dry run must be inspectable at any hour, and must never mark anything.
  const dry = new URL(req.url).searchParams.get('dry') === '1'
  if (dry) return null
  const v = maySend(kind)
  if (v.allowed) return null
  return json({ ok: true, skipped: v.reason, outreach: v.detail })
}

/* =============================================================================
   THE REGISTER — every automated sender and why it is classified that way.
   =============================================================================
   This is the authoritative record. If a function sends and is not listed here,
   it has not been classified, and that is itself a finding.

   Reactive means the person just did something and is waiting on us. Proactive
   means we started it. That distinction, not the channel, decides the weekend. */
export const SENDER_REGISTER: Record<string, { class: OutreachClass; why: string; scheduled: boolean }> = {
  // ── scheduled, autonomous, nobody watching ────────────────────────────────
  'interview-messages': { class: 'reactive_external', scheduled: true,
    why: 'confirmations and reminders for an interview the applicant booked. A Monday 9am interview needs its Sunday reminder.' },
  'lead-followup':      { class: 'reactive_external', scheduled: true,
    why: 'acknowledges a lead who just enquired. A Saturday enquiry answered Monday is a lost client.' },
  'lead-nurture':       { class: 'proactive_external', scheduled: true,
    why: 'a thirteen-month drip we initiate. Nobody is waiting on it.' },
  'campaign-auto':      { class: 'proactive_external', scheduled: true,
    why: 'marketing. A campaign text on Sunday is an intrusion.' },
  'ghe-reminders':      { class: 'proactive_external', scheduled: true,
    why: 'we chase the GHE; the coordinator is not waiting on us at the weekend.' },
  'lead-digest':        { class: 'digest', scheduled: true,
    why: 'internal report to staff at 7am, deliberately before the outreach window.' },
  'shared-backup':      { class: 'routine_internal', scheduled: true,
    why: 'internal backup alert, no external recipient.' },

  // ── proactive, currently triggered by hand or by a schedule that is missing ─
  'applicant-reengage': { class: 'proactive_external', scheduled: false,
    why: 'we restart a conversation the applicant let go quiet.' },
  'reference-chase':    { class: 'proactive_external', scheduled: false,
    why: 'chasing an employer for a favour. They do not answer at weekends. NOTE: its header claims a daily cron that does not exist.' },

  // ── urgent internal ───────────────────────────────────────────────────────
  'ops-escalate':       { class: 'urgent_internal', scheduled: false,
    why: 'uncovered shifts and unresolved escalations. The 6am gap is exactly what somebody needs at 6am.' },

  // ── reactive: fired by a webhook or a form the person just submitted ───────
  'lead-intake':        { class: 'reactive_external', scheduled: false, why: 'they just submitted the form.' },
  'cc-booking':         { class: 'reactive_external', scheduled: false, why: 'they just booked.' },
  'cc-feedback':        { class: 'reactive_external', scheduled: false, why: 'they just left feedback.' },
  'cc-417':             { class: 'reactive_external', scheduled: false, why: 'reply to an inbound message.' },
  'cc-corner':          { class: 'reactive_external', scheduled: false, why: 'reply to an inbound action.' },
  'cc-story':           { class: 'reactive_external', scheduled: false, why: 'reply to a submission.' },
  'cc-memories':        { class: 'reactive_external', scheduled: false, why: 'reply to a submission.' },
  'ht-inbound':         { class: 'reactive_external', scheduled: false, why: 'inbound message handler.' },
  'ht-support':         { class: 'reactive_external', scheduled: false, why: 'support reply.' },
  'ht-local':           { class: 'reactive_external', scheduled: false, why: 'reply to a local enquiry.' },
  'stripe-webhook':     { class: 'reactive_external', scheduled: false, why: 'they just paid.' },
  'vapi-interview':     { class: 'reactive_external', scheduled: false, why: 'follows a call that just happened.' },
  'caregiver-intro':    { class: 'reactive_external', scheduled: false, why: 'sent when a match is made, and the family is waiting.' },
  'circle-send':        { class: 'reactive_external', scheduled: false, why: 'sent on an explicit human action.' },
  'campaign-send':      { class: 'proactive_external', scheduled: false, why: 'a campaign somebody presses send on.' },
  'calls-feed':         { class: 'routine_internal', scheduled: false, why: 'internal call reconciliation.' },
  'resend-relay':       { class: 'reactive_external', scheduled: false, why: 'relays a message somebody composed.' },
}
