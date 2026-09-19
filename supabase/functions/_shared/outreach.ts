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
  'reference-chase':    { class: 'proactive_external', scheduled: true,
    why: 'chasing an employer for a favour. They do not answer at weekends. '
      + 'Cron: daily-reference-chase, weekday mornings — created by cron-reference-chase.sql (care-coordinator-hub repo).' },

  // ── urgent internal ───────────────────────────────────────────────────────
  'timekeeper-watch':   { class: 'urgent_internal', scheduled: true,
    why: 'a caregiver with no clock-in minutes into a shift, and the office alert behind it. '
      + 'The 6am shift needs its 6:03 nudge; a client may be standing at the door. '
      + 'Cron: timekeeper-watch, every 2 minutes — created by cron-timekeeper.sql (~/Claude).' },
  'shift-confirm':      { class: 'routine_internal', scheduled: true,
    why: 'one morning text to each caregiver listing their own shifts today, deliberately '
      + 'before the external window — it exists to surface problems before they become no-shows. '
      + 'Cron: shift-confirm, 12:00 UTC daily — created by cron-shift-confirm.sql (~/Claude).' },
  'carematch-watch':    { class: 'routine_internal', scheduled: true,
    why: 'the morning after a caregiver\'s FIRST shift with a client: one text to the '
      + 'caregiver (staff, about their own shift) asking how it went, and one email to the '
      + 'office saying a client check-in call is due. The client is never messaged — their '
      + 'side of the check-in is deliberately a human phone call. '
      + 'Cron: carematch-watch, 15:00 UTC daily (9-10am Springfield) — created by cron-carematch-watch.sql (care-coordinator-hub repo).' },
  'automation-watchdog': { class: 'urgent_internal', scheduled: true,
    why: 'tells the office when a scheduled automation has gone quiet or is erroring. '
      + 'Cron: daily-automation-watchdog, mornings — created by cron-automation-watchdog.sql (care-coordinator-hub repo).' },
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

/* =============================================================================
   IDENTITY GATE — the narrowest common boundary for outbound
   =============================================================================
   Traced 2026-08-13: all 24 senders that can reach a person do the same two
   things — upsert a GHL contact with a raw phone string, then post a message to
   the contact id it returns. The destination decision is that raw string. No
   sender consults the identity layer; the only file that touches it is the
   backfill that populates it.

   So the fix belongs here rather than in 24 places. This module already owns the
   hours policy and already bundles, and adopting it is one import.

   THE INVARIANT:
     Identity resolution and outbound authorization are SEPARATE decisions.
     A 'probable' phone is fine for showing an employee "Possible caller: Jane
     Smith" — a human can ask. It is never sufficient for autonomous outbound,
     because there is nobody in the loop to catch a wrong guess.

   Why this is not merely tidy: GHL's contacts/upsert MATCHES on phone. Sending
   to a wrong number does not just reach the wrong person, it merges them into
   that contact and destroys the evidence that two people existed.
============================================================================= */

export type PhoneConfidence = 'confirmed' | 'probable' | 'suspect'

export interface DestinationVerdict {
  allowed: boolean
  phone: string | null
  confidence: PhoneConfidence | 'unknown'
  reason: string
  /** Safe to show a human, even when autonomous sending is refused. */
  displayable: boolean
}

/** E.164, or null. The same normalisation the identity layer uses on write. */
export function normalisePhone(raw: unknown): string | null {
  const d = String(raw ?? '').replace(/\D/g, '')
  if (d.length === 10) return '+1' + d
  if (d.length === 11 && d.startsWith('1')) return '+' + d
  return d.length > 11 ? '+' + d : null
}

/**
 * May we autonomously send to this number?
 *
 * Answers from `phone_index` provenance. A number the identity layer has never
 * seen is 'unknown', which is NOT the same as unsafe: plenty of legitimate
 * destinations are supplied by the person themselves in the same request (a
 * form submission, a Stripe checkout, an inbound reply). Those are governed by
 * `selfSupplied`, because the person handing us their own number is a stronger
 * signal than any database lookup.
 *
 * What this refuses is the dangerous case: a number we IMPORTED from somewhere
 * on weak evidence and then treated as authoritative.
 */
export async function maySendTo(
  // deno-lint-ignore no-explicit-any
  sb: any,
  rawPhone: unknown,
  opts: { selfSupplied?: boolean } = {},
): Promise<DestinationVerdict> {
  const phone = normalisePhone(rawPhone)
  if (!phone) {
    return { allowed: false, phone: null, confidence: 'unknown',
             reason: 'no usable phone number', displayable: false }
  }

  if (opts.selfSupplied) {
    return { allowed: true, phone, confidence: 'confirmed',
             reason: 'the person supplied this number themselves in this request',
             displayable: true }
  }

  const { data, error } = await sb
    .from('phone_index')
    .select('confidence, verification_status, source_system')
    .eq('phone', phone)

  if (error) {
    /* Fail CLOSED. If we cannot check provenance we do not send — an outage in
       the identity layer must not silently restore the old behaviour. */
    return { allowed: false, phone, confidence: 'unknown',
             reason: `could not verify provenance: ${error.message}`, displayable: true }
  }

  if (!data || !data.length) {
    return { allowed: true, phone, confidence: 'unknown',
             reason: 'not an imported identifier — no provenance concern',
             displayable: true }
  }

  const rejected = data.find((r: { verification_status: string }) => r.verification_status === 'rejected')
  if (rejected) {
    return { allowed: false, phone, confidence: 'suspect',
             reason: 'this number was reviewed and rejected', displayable: false }
  }

  const best = data.find((r: { confidence: string }) => r.confidence === 'confirmed')
  if (best) {
    return { allowed: true, phone, confidence: 'confirmed',
             reason: 'confirmed provenance', displayable: true }
  }

  const src = data[0]?.source_system ?? 'an import'
  return {
    allowed: false, phone, confidence: 'probable',
    reason: `this number came from ${src} on probable evidence only. Show it to ` +
            `a person, do not send to it automatically.`,
    displayable: true,
  }
}

/**
 * The single call a sender should make. Applies BOTH gates in the right order —
 * destination trust first, then the hours policy — and returns a Response to
 * hand straight back when either refuses.
 */
export async function outboundGate(
  // deno-lint-ignore no-explicit-any
  sb: any,
  rawPhone: unknown,
  kind: OutreachClass,
  opts: { selfSupplied?: boolean; now?: Date } = {},
): Promise<{ ok: true; phone: string } | { ok: false; response: Response }> {
  const dest = await maySendTo(sb, rawPhone, opts)
  if (!dest.allowed) {
    return { ok: false, response: new Response(JSON.stringify({
      ok: false, skipped: 'destination_not_authorised',
      confidence: dest.confidence, reason: dest.reason,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }) }
  }
  const when = maySend(kind, opts.now ?? new Date())
  if (!when.allowed) {
    return { ok: false, response: new Response(JSON.stringify({
      ok: false, skipped: 'outside_outreach_hours',
      reason: when.reason, detail: when.detail,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }) }
  }
  return { ok: true, phone: dest.phone! }
}

/* =============================================================================
   THE CLIENT LINE — audience autonomy (Samantha's law, 2026-09-19)

   WHO a message goes to matters more than the channel it rides. "Cara can
   send SMS" never means "Cara can send SMS to everyone": autonomy belongs to
   the specific capability AND the specific recipient type.

   The default: automation may NOT autonomously contact clients, family
   members, responsible parties, leads or any client contact — any channel
   (SMS, email, calls, AI voice). Elderly clients and their families get
   HUMANS. Automation may detect, create work, draft wording, remind the
   right admin, prepare the number and context, and track the promise — it
   just may not press send.

   HER FIVE CATEGORIES (refined 2026-09-19):
     1. EXISTING clients / family / responsible parties — human communication
        required. Automation detects, prepares, drafts, reminds, routes,
        tracks; it does not initiate. Only a capability she explicitly
        enabled may send.
     2. INBOUND PROSPECTIVE LEADS — the person just wrote to us. An immediate
        acknowledgment may be an explicitly permitted capability (their
        action initiated the interaction); LATER automated follow-up/nurture
        is a SEPARATE capability needing its own explicit decision. Never
        bundle the two under one switch.
     3. TRANSACTIONAL RESPONSES — the recipient directly caused this exact
        message in this same interaction (booked → confirmation; submitted →
        receipt; requested → the link). Declared, but not outreach.
        Transactional means RESPONSE-TO-THEIR-ACTION-NOW. It is never a
        loophole: nothing later, nothing unprompted, nothing promotional,
        no follow-up rides under this flag.
     4. HUMAN-INITIATED — an authorized employee pressed Send; the machine
        drafted or delivered. Not autonomous communication.
     5. UNKNOWN RECIPIENT — fail closed, always.

   And the permission shape is never "Cara can send SMS". It is:
   Cara may perform THIS capability, with THIS audience, at THIS autonomy.
   (Coverage outreach→caregiver: autonomous. Client callback→family: human.
   Inquiry acknowledgment→lead: only as an explicitly enabled capability.)

   The doors, in code:
     humanInitiated       → allowed (category 4)
     transactional        → allowed with declaration (category 3)
     approved audience    → allowed (caregivers/applicants/staff/references)
     explicitlyEnabled    → allowed (the sender carries HER switch for that
                            one capability — never a general flag)
   Everything else — including a MISSING or unknown audience — is refused.
   Fail closed.

   SENDERS THAT PREDATE THIS GATE and can reach families today (audited
   2026-09-19; they must migrate to contactForOutbound or carry their own
   explicit switch, and NO NEW family-facing sender may be built outside it):
     lead-followup   autonomous texts to new-lead families (cron) — awaiting
                     Samantha's explicit keep/stop decision
     lead-nurture    drip to families; each enrollment human-started per lead
     campaign-auto   calendar emails incl. client audience; per-audience
                     switches in campaign_settings, default OFF (her switches)
     campaign-send   batch email; hub-triggered by a human
     cc-booking / cc-417 / cc-corner / cc-memories / cc-story / cc-feedback /
     ht-local / ht-inbound / ht-support / stripe-webhook
                     transactional replies to a person's own submission
     circle-send / caregiver-intro
                     family texts, human-pressed today (now declared so)
   ============================================================================= */
export type Audience =
  | 'caregiver' | 'applicant' | 'staff' | 'reference'
  | 'client' | 'family' | 'lead' | 'referral' | 'unknown'

export const AUDIENCE_AUTONOMY: Record<Audience, boolean> = {
  caregiver: true,    // coverage asks, shift confirms, check-ins — approved workflows
  applicant: true,    // hiring ladder — approved
  staff: true,        // office alerts — approved
  reference: true,    // reference-chase, EMAIL ONLY by its own law (no SMS — TCPA)
  client: false,      // humans call clients
  family: false,      // humans call families
  lead: false,        // a lead IS a family that hasn't signed yet
  referral: false,    // relationship-timed, human territory
  unknown: false,     // unknown never gets autonomous outreach
}

export function audienceGate(
  audience: Audience | string | undefined,
  opts: { humanInitiated?: boolean; transactional?: boolean; explicitlyEnabled?: boolean } = {},
): { allowed: boolean; reason: string } {
  if (opts.humanInitiated)
    return { allowed: true, reason: 'a person chose to send this' }
  if (opts.transactional)
    return { allowed: true,
      reason: 'transactional — a direct response to this person\'s own action in this interaction' }
  const aud = String(audience ?? 'unknown')
  const known = Object.prototype.hasOwnProperty.call(AUDIENCE_AUTONOMY, aud)
  if (known && AUDIENCE_AUTONOMY[aud as Audience])
    return { allowed: true, reason: `autonomous ${aud} outreach is an approved workflow` }
  if (opts.explicitlyEnabled)
    return { allowed: true, reason: `this specific capability was explicitly enabled by Samantha` }
  return { allowed: false, reason: known
    ? `autonomous contact with a ${aud} is not permitted — a human makes this contact, unless Samantha explicitly enables this specific capability`
    : `recipient type not declared — unknown audiences never get autonomous outreach` }
}

/**
 * The shared contact-resolution boundary.
 *
 * `caregiver-intro` and `circle-send` each carried an identical, copy-pasted
 * upsert block reading a phone straight off a person record. That duplication
 * IS the drift problem: a rule implemented per-function does not stay uniform,
 * which is how the outreach-hours policy ended up covering 5 of 24 senders.
 *
 * So this is the one place a destination becomes a GHL contact id. It applies
 * the identity gate, then the hours policy, then upserts. A sender that uses it
 * cannot forget either check, because there is no path through it that skips
 * them.
 *
 * Returns null when the send must not happen. The reason is logged rather than
 * thrown, so one refused recipient never aborts a batch.
 */
export async function contactForOutbound(
  // deno-lint-ignore no-explicit-any
  sb: any,
  ghl: { token: string; locationId: string },
  person: { phone?: unknown; email?: unknown; firstName?: unknown; lastName?: unknown },
  kind: OutreachClass,
  opts: { selfSupplied?: boolean; now?: Date; audience?: Audience;
          humanInitiated?: boolean; explicitlyEnabled?: boolean } = {},
): Promise<{ contactId: string; phone: string | null } | null> {
  /* WHO comes before HOW. A missing audience is 'unknown', and unknown is
     refused — every sender through this boundary declares who it talks to. */
  const who = audienceGate(opts.audience, opts)
  if (!who.allowed) {
    console.warn(`outbound refused [${kind}]: ${who.reason}`)
    return null
  }
  const email = String(person.email ?? '').trim()
  const hasPhone = !!normalisePhone(person.phone)

  /* An email-only recipient carries no phone-identity risk, so the destination
     gate does not apply — but the hours policy still does. */
  if (hasPhone) {
    const dest = await maySendTo(sb, person.phone, opts)
    if (!dest.allowed) {
      console.warn(`outbound refused [${kind}]: ${dest.reason}`)
      return null
    }
  } else if (!email) {
    console.warn(`outbound refused [${kind}]: no phone and no email`)
    return null
  }

  const when = maySend(kind, opts.now ?? new Date())
  if (!when.allowed) {
    console.log(`outbound held [${kind}]: ${when.reason}`)
    return null
  }

  const phone = normalisePhone(person.phone)
  const res = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ghl.token}`,
      'Version': '2021-07-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      locationId: ghl.locationId,
      ...(phone ? { phone } : {}),
      ...(email ? { email } : {}),
      ...(person.firstName ? { firstName: String(person.firstName) } : {}),
      ...(person.lastName ? { lastName: String(person.lastName) } : {}),
    }),
  })
  // deno-lint-ignore no-explicit-any
  const j = await res.json().catch(() => ({})) as any
  const contactId = j?.contact?.id ?? j?.id
  if (!contactId) {
    console.warn(`outbound refused [${kind}]: GHL returned no contact id`)
    return null
  }
  return { contactId: String(contactId), phone }
}
