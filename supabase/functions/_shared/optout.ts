// =============================================================================
// The universal opt-out check (Step 0 · 0b-1, 2026-09-27)
// =============================================================================
// Samantha's rule: "If any authoritative source tells us not to send on this channel, do not send."
// This reads every source at send time and refuses if ANY says no. It does not create a new authority
// and does not try to synchronise them; the invariant is only that no applicable sender proceeds when we
// hold authoritative evidence of an opt-out for that channel. Every refusal is logged with its reasons.
//
//   Sources (all read, none replaced):
//     ghl_dnd       GoHighLevel Do Not Disturb on the contact (all channels, or per channel)
//     hub           the Hub's own opt-out record (contact_optout_current), including STOP and staff entries
//     inquiry_dnc   an inquiry marked do-not-contact with this phone or email
//     circle_stop   a Family Circle contact marked stopped with this phone
//
// FAIL CLOSED: if a source cannot be read, the send is refused with "could not check <source>". A family
// message that cannot be proven permitted does not go.
// 0b-2 (2026-09-27) wires every family, client, inquiry and public-person sender to it through ghlContactIfAllowed
// (directly, or through contactForOutbound with a channel). 0b-3 (2026-09-27) wires caregiver, applicant and
// HomeTogether senders, and ghlStoredContactIfAllowed covers sends to a GHL contact id saved earlier.
// =============================================================================
import { reportSendProblem } from './send-problems.ts'
export type Channel = 'sms' | 'email'
export type OptOutVerdict = { allowed: boolean; reasons: string[] }

export const normPhone = (raw: unknown): string | null => {
  const d = String(raw ?? '').replace(/\D/g, '')
  if (d.length === 10) return '+1' + d
  if (d.length === 11 && d.startsWith('1')) return '+' + d
  return null
}
export const normEmail = (raw: unknown): string | null => {
  const e = String(raw ?? '').trim().toLowerCase()
  return e.includes('@') ? e : null
}
const last10 = (p: unknown) => String(p ?? '').replace(/\D/g, '').slice(-10)

/* PRACTICE ADDRESSES (Samantha "approve the two fixes", 2026-10-11, before the practice run): a phone number whose last seven
   digits are 555-0180 to 555-0189 (inside the 555-01xx range set aside for fiction, kept apart from the 555-01xx numbers the
   tests use for pretend real people) or an email ending @practice.invalid (.invalid can never be delivered) is a practice
   address for a made-up hire. It is never texted, emailed or added to GoHighLevel, by any sender, whatever any switch says.
   The refusal is logged (contact_send_refusal_log) without a Needs Attention card, because nothing failed. */
export const PRACTICE_WHY = 'a practice address (555-0180 to 555-0189, or @practice.invalid): never contacted'
export function practicePhone(raw: unknown): boolean {
  const d = String(raw ?? '').replace(/\D/g, '')
  return d.length >= 7 && /^555018\d$/.test(d.slice(-7))
}
export function practiceEmail(raw: unknown): boolean {
  const e = String(raw ?? '').trim().toLowerCase()
  return /@(?:[a-z0-9-]+\.)*practice\.invalid$/.test(e)
}
export const practiceAddress = (channel: Channel, phone: unknown, email: unknown): boolean =>
  channel === 'sms' ? practicePhone(phone) : practiceEmail(email)
/** a person reachable only at practice addresses (each address given is a practice one, and at least one is given) */
export function practicePerson(phone: unknown, email: unknown): boolean {
  const p = String(phone ?? '').trim(), e = String(email ?? '').trim()
  if (!p && !e) return false
  return (!p || practicePhone(p)) && (!e || practiceEmail(e))
}

/* OKLAHOMA APPLICANTS (806, Samantha 2026-10-16: "Approve the Oklahoma Companion pre-screener plan with all six decisions as
   you recommended"). Every text and email from the Hub goes out from the Missouri GoHighLevel number with Missouri wording,
   so nothing goes to somebody whose latest application is to Caring Companions Oklahoma until she switches on
   ops_settings.ok_applicant_msgs_live. The database answers (ok_applicant_hold) and marks their application "held", which
   the Hub shows on their profile. Like a practice address, the refusal is logged without a Needs Attention card: nothing
   failed. A hold that cannot be checked is refused (fail closed) and does raise a card. */
export const OK_HOLD_WHY = 'an Oklahoma applicant: Oklahoma applicant messages are off'
const OK_HOLD_UNKNOWN = 'could not check the Oklahoma applicant hold'
// deno-lint-ignore no-explicit-any
export async function okApplicantHold(db: any, phone: unknown, email: unknown, sender?: string, channel?: Channel): Promise<string | null> {
  try {
    const { data, error } = await db.rpc('ok_applicant_hold', { p_phone: phone == null ? null : String(phone), p_email: email == null ? null : String(email),
      p_sender: sender ?? null, p_channel: channel ?? null })
    if (error) return OK_HOLD_UNKNOWN
    return data === true ? OK_HOLD_WHY : null
  } catch { return OK_HOLD_UNKNOWN }
}

/* GHL's contact: `dnd: true` stops everything; `dndSettings.SMS/Email.status` of 'active' or 'permanent' stops one channel. */
// deno-lint-ignore no-explicit-any
export function ghlDnd(contact: any, channel: Channel): boolean {
  if (!contact || typeof contact !== 'object') return false
  if (contact.dnd === true) return true
  const key = channel === 'sms' ? 'SMS' : 'Email'
  const s = contact.dndSettings?.[key]?.status ?? contact.dndSettings?.[key.toLowerCase()]?.status
  return ['active', 'permanent'].includes(String(s ?? '').toLowerCase())
}

/* We only trust a GHL contact whose answer actually carries the Do Not Disturb flag. */
// deno-lint-ignore no-explicit-any
export const ghlDndKnown = (contact: any): boolean => !!contact && typeof contact === 'object' &&
  (typeof contact.dnd === 'boolean' || contact.__dnd_read === true)
/* 2026-10-01 (Desktop 382 proved it): GoHighLevel's contact answer has NO `dnd` key unless DND is on, so insisting on a
   true/false refused almost every send since 0b (interview reminders, reference emails, training invites...). A contact
   returned by a SUCCESSFUL GET of that exact contact is a complete answer: no `dnd` key there means DND is off.
   `__dnd_read` marks only that case; an upsert answer alone, or a failed GET, is still "could not check" (refused).
   dndSettings (per channel) are still honoured by ghlDnd. */
const readContact = (c: any) => (c && typeof c === 'object' ? { ...c, __dnd_read: true } : c)

/**
 * May this message go to this address on this channel?
 * `ghlContact` is the contact object GHL returned for the send (its upsert or get answer). When a sender
 * sends through GHL but cannot supply it, pass `ghlContact: 'unknown'` and the send is refused: DND
 * could not be checked.
 */
export async function optOutCheck(
  // deno-lint-ignore no-explicit-any
  db: any,
  target: { channel: Channel; phone?: unknown; email?: unknown; ghlContact?: unknown | 'unknown' | null; viaGhl?: boolean;
            /* 806: the door already asked the Oklahoma hold for this address (one question per send, not two) */ okChecked?: boolean },
): Promise<OptOutVerdict> {
  const reasons: string[] = []
  const address = target.channel === 'sms' ? normPhone(target.phone) : normEmail(target.email)
  if (!address) return { allowed: false, reasons: ['no usable ' + (target.channel === 'sms' ? 'phone number' : 'email address')] }
  if (practiceAddress(target.channel, target.phone, target.email)) return { allowed: false, reasons: [PRACTICE_WHY] }
  /* 806: an Oklahoma applicant (or the hold could not be checked): nothing else needs asking */
  if (!target.okChecked) {
    const okHold = await okApplicantHold(db, target.channel === 'sms' ? address : null, target.channel === 'email' ? address : null, undefined, target.channel)
    if (okHold) return { allowed: false, reasons: [okHold] }
  }

  // 1. GHL Do Not Disturb (a contact object without a true/false `dnd` can't prove DND is off: unknown, refused)
  if (target.viaGhl !== false) {
    if (!ghlDndKnown(target.ghlContact)) reasons.push('could not check GHL Do Not Disturb')
    else if (ghlDnd(target.ghlContact, target.channel)) reasons.push('GHL Do Not Disturb is on for ' + target.channel)
  }
  // 2. the Hub's own record (latest word per address, for this channel or 'all')
  try {
    const { data, error } = await db.from('contact_optout_current').select('channel, opted_out, source').eq('address', address)
    if (error) reasons.push('could not check the opt-out record')
    else for (const r of data ?? []) {
      if (r.opted_out === true && (r.channel === target.channel || r.channel === 'all')) reasons.push(`opted out (${r.source}, ${r.channel})`)
    }
  } catch { reasons.push('could not check the opt-out record') }
  // 3. inquiries marked do-not-contact
  try {
    const { data, error } = await db.from('app_data').select('data').eq('key', 'leads').maybeSingle()
    if (error) reasons.push('could not check inquiry do-not-contact')
    else {
      const leads = Array.isArray(data?.data) ? data.data : []
      const hit = leads.some((l: Record<string, unknown>) => l && l.do_not_contact === true && (
        target.channel === 'sms' ? (last10(l.phone) === last10(address) || last10(l.client_phone) === last10(address))
                                 : String(l.email ?? '').trim().toLowerCase() === address))
      if (hit) reasons.push('an inquiry with this ' + (target.channel === 'sms' ? 'number' : 'email') + ' is marked do-not-contact')
    }
  } catch { reasons.push('could not check inquiry do-not-contact') }
  // 4. Family Circle contacts marked stopped (phone only; circle contacts are texted)
  if (target.channel === 'sms') {
    try {
      const { data, error } = await db.from('circle_contacts').select('phone, stopped_at').not('stopped_at', 'is', null)
      if (error) reasons.push('could not check Family Circle stops')
      else if ((data ?? []).some((c: Record<string, unknown>) => last10(c.phone) === last10(address))) reasons.push('a Family Circle contact with this number is marked stopped')
    } catch { reasons.push('could not check Family Circle stops') }
  }
  return { allowed: reasons.length === 0, reasons }
}

/** Record a refusal (append-only). Never throws: a failed log must not turn a refusal into a send. */
// deno-lint-ignore no-explicit-any
export async function logRefusal(db: any, sender: string, channel: Channel, address: unknown, reasons: string[], who?: unknown): Promise<void> {
  try { await db.rpc('contact_send_refusal_log', { p_sender: sender, p_channel: channel, p_address: String(address ?? ''), p_reasons: reasons }) }
  catch { console.warn(`[${sender}] refusal not logged: ${reasons.join('; ')}`) }
  if (reasons.length && reasons.every((r) => r === PRACTICE_WHY || r === OK_HOLD_WHY)) return   /* a practice address or an Oklahoma hold (806): logged, no card (nothing failed) */
  /* NO SILENT FAILURES (2026-10-01): every refusal also becomes a Needs Attention card the office sees */
  await reportSendProblem(db, { sender, channel, address, who, reasons })
}
// deno-lint-ignore no-explicit-any
const nameOf = (x: any) => [x?.firstName, x?.lastName].map((v) => String(v ?? '').trim()).filter(Boolean).join(' ')

/**
 * The GHL senders' door (0b-2). Finds or creates the GHL contact for ONE channel (the phone alone for a text,
 * the email alone for an email, the rule lead-intake learned the hard way), makes sure its Do Not Disturb is
 * known (asks GHL for the contact itself when the upsert answer leaves it out), then runs the universal check.
 * Returns the contact id only when the message may go; null otherwise, with the refusal logged.
 */
export async function ghlContactIfAllowed(
  // deno-lint-ignore no-explicit-any
  db: any, ghl: { token: string; locationId: string }, sender: string,
  to: { channel: Channel; phone?: unknown; email?: unknown; firstName?: unknown; lastName?: unknown;
        /* extra GHL contact fields for the upsert, e.g. { tags: ['lead'] } */
        extra?: Record<string, unknown>;
        /* told when an authority said no (not when GHL simply failed): lets a sender stop retrying */
        onOptOut?: (reasons: string[], contact: Record<string, unknown>) => void | Promise<void> },
  send: typeof fetch = fetch,
): Promise<string | null> {
  const phone = to.channel === 'sms' ? normPhone(to.phone) : null
  const email = to.channel === 'email' ? normEmail(to.email) : null
  if (!phone && !email) {
    await logRefusal(db, sender, to.channel, to.channel === 'sms' ? to.phone : to.email, ['no usable ' + (to.channel === 'sms' ? 'phone number' : 'email address')], nameOf(to))
    return null
  }
  /* a practice address never reaches GoHighLevel: refused before any contact is looked up or made */
  if (practiceAddress(to.channel, phone, email)) { await logRefusal(db, sender, to.channel, phone ?? email, [PRACTICE_WHY], nameOf(to)); return null }
  /* 806: an Oklahoma applicant is held before any GoHighLevel contact is looked up or made */
  { const okHold = await okApplicantHold(db, phone, email, sender, to.channel)
    if (okHold) { await logRefusal(db, sender, to.channel, phone ?? email, [okHold], nameOf(to)); return null } }
  const h = { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' }
  // deno-lint-ignore no-explicit-any
  let contact: any = null
  /* ONE PERSON, ONE CONTACT (2026-10-01; Samantha: "yes, let the hub add the missing phone and email"). 391/392 found
     people split: texts on a phone-only contact, emails on an email-only one, because each channel is looked up alone.
     When nobody has THIS address yet but the same person's other address is on a contact whose field for this channel
     is EMPTY and whose first name doesn't contradict, the address is added to that contact instead of creating a
     second one. A contact already holding a different number/email is never overwritten. Do Not Disturb is still read
     from the contact that will receive this message. Any doubt or error: the one-channel path below, as before. */
  try {
    const joined = await joinExisting(send, h, ghl.locationId, to, phone, email)
    if (joined) {
      const g = await send(`https://services.leadconnectorhq.com/contacts/${encodeURIComponent(joined)}`, { method: 'GET', headers: h })
      const gj = await g.json().catch(() => ({}))
      if (g.ok && gj?.contact?.id === joined) contact = readContact(gj.contact)
    }
  } catch { contact = null }
  if (!contact) try {
    const r = await send('https://services.leadconnectorhq.com/contacts/upsert', {
      method: 'POST', headers: h,
      body: JSON.stringify({ locationId: ghl.locationId, ...(phone ? { phone } : {}), ...(email ? { email } : {}),
        ...(to.firstName ? { firstName: String(to.firstName) } : {}), ...(to.lastName ? { lastName: String(to.lastName) } : {}),
        ...(to.extra ?? {}) }),
    })
    const j = await r.json().catch(() => ({}))
    contact = j?.contact ?? null
    if (contact && typeof contact === 'object') delete contact.__dnd_read  // only the Hub's own read-back may set it
    if (contact?.id && !ghlDndKnown(contact)) {
      const g = await send(`https://services.leadconnectorhq.com/contacts/${encodeURIComponent(contact.id)}`, { method: 'GET', headers: h })
      const gj = await g.json().catch(() => ({}))
      if (gj?.contact?.id === contact.id) contact = readContact(gj.contact)
    }
  } catch { contact = null }
  if (!contact?.id) {
    await logRefusal(db, sender, to.channel, phone ?? email, ['GHL returned no contact, so Do Not Disturb could not be checked'], nameOf(to))
    return null
  }
  return await decide(db, sender, to.channel, phone ?? email, contact, to.onOptOut, nameOf(to) || nameOf(contact), true)
}

const GHL = 'https://services.leadconnectorhq.com'
const firstOf = (v: unknown) => String(v ?? '').trim().split(/\s+/)[0].toLowerCase()
/** The contact id to add this address to, or '' (then the caller finds/creates by this address alone, as before). */
export async function joinExisting(send: typeof fetch, h: Record<string, string>, locationId: string,
  // deno-lint-ignore no-explicit-any
  to: any, phone: string | null, email: string | null): Promise<string> {
  const other = phone ? normEmail(to.email) : normPhone(to.phone)
  if (!other) return ''
  const find = async (q: string) => {
    const r = await send(`${GHL}/contacts/search/duplicate?locationId=${encodeURIComponent(locationId)}&${q}`, { method: 'GET', headers: h })
    if (!r.ok) throw new Error('lookup ' + r.status)
    const j = await r.json().catch(() => ({}))
    return j?.contact?.id ? String(j.contact.id) : ''
  }
  if (await find(phone ? `number=${encodeURIComponent(phone)}` : `email=${encodeURIComponent(email!)}`)) return ''   // already has a contact
  const id = await find(phone ? `email=${encodeURIComponent(other)}` : `number=${encodeURIComponent(other)}`)
  if (!id) return ''
  const g = await send(`${GHL}/contacts/${encodeURIComponent(id)}`, { method: 'GET', headers: h })
  const c = (await g.json().catch(() => ({})))?.contact
  if (!g.ok || c?.id !== id) return ''
  const have = phone ? normPhone(c.phone) : normEmail(c.email)
  if (have) return have === (phone ?? email) ? id : ''          // a DIFFERENT number/email is there: never overwrite
  if (firstOf(to.firstName) && firstOf(c.firstName) && firstOf(to.firstName) !== firstOf(c.firstName)) return ''   // someone else's
  const u = await send(`${GHL}/contacts/${encodeURIComponent(id)}`, { method: 'PUT', headers: h, body: JSON.stringify(phone ? { phone } : { email }) })
  return u.ok ? id : ''
}

// deno-lint-ignore no-explicit-any
async function decide(db: any, sender: string, channel: Channel, address: string | null, contact: any,
                      onOptOut?: (reasons: string[], contact: Record<string, unknown>) => void | Promise<void>, who?: string, okChecked = false): Promise<string | null> {
  const v = await optOutCheck(db, { channel, phone: channel === 'sms' ? address : undefined, email: channel === 'email' ? address : undefined, ghlContact: contact, okChecked })
  if (v.allowed) return String(contact.id)
  await logRefusal(db, sender, channel, address, v.reasons, who || nameOf(contact))
  console.warn(`[${sender}] send refused: ${v.reasons.join('; ')}`)
  /* an authority said no (not merely "could not check"): tell the sender, so it can stop asking every run */
  if (onOptOut && v.reasons.some((r) => !r.startsWith('could not check') && !r.startsWith('no usable'))) {
    try { await onOptOut(v.reasons, contact) } catch { /* the refusal stands either way */ }
  }
  return null
}

/**
 * 0b-3: the door for a GHL contact id saved EARLIER (a coverage ask's caregiver, a webhook's contact). Nothing is
 * created: the contact is read from GHL (its Do Not Disturb and its phone or email), then the universal check runs
 * on that address. Returns the id only when the message may go.
 */
export async function ghlStoredContactIfAllowed(
  // deno-lint-ignore no-explicit-any
  db: any, ghl: { token: string; locationId: string }, sender: string,
  to: { channel: Channel; contactId: unknown; onOptOut?: (reasons: string[], contact: Record<string, unknown>) => void | Promise<void> },
  send: typeof fetch = fetch,
): Promise<string | null> {
  const id = String(to.contactId ?? '').trim()
  if (!id) { await logRefusal(db, sender, to.channel, '', ['no GHL contact to send to']); return null }
  // deno-lint-ignore no-explicit-any
  let contact: any = null
  try {
    const g = await send(`https://services.leadconnectorhq.com/contacts/${encodeURIComponent(id)}`,
      { method: 'GET', headers: { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', Accept: 'application/json' } })
    const gj = await g.json().catch(() => ({}))
    if (gj?.contact?.id === id) contact = readContact(gj.contact)
  } catch { contact = null }
  const address = to.channel === 'sms' ? normPhone(contact?.phone) : normEmail(contact?.email)
  if (!contact) {
    await logRefusal(db, sender, to.channel, '', ['GHL could not return this contact, so Do Not Disturb could not be checked'])
    return null
  }
  if (!address) {
    await logRefusal(db, sender, to.channel, '', ['the GHL contact has no usable ' + (to.channel === 'sms' ? 'phone number' : 'email address')], nameOf(contact))
    return null
  }
  if (practiceAddress(to.channel, address, address)) { await logRefusal(db, sender, to.channel, address, [PRACTICE_WHY], nameOf(contact)); return null }
  return await decide(db, sender, to.channel, address, contact, to.onOptOut, nameOf(contact))
}

/** The call a sender makes: check, log a refusal, return whether it may send. */
// deno-lint-ignore no-explicit-any
export async function mayContact(db: any, sender: string, target: Parameters<typeof optOutCheck>[1]): Promise<boolean> {
  const v = await optOutCheck(db, target)
  if (!v.allowed) {
    await logRefusal(db, sender, target.channel, target.channel === 'sms' ? target.phone : target.email, v.reasons)
    console.warn(`[${sender}] send refused: ${v.reasons.join('; ')}`)
  }
  return v.allowed
}
