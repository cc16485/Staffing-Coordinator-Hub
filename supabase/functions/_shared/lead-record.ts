// =============================================================================
// lead-record (pure part) · calls and texts with a lead are recorded on the lead by themselves (769)
// =============================================================================
// Samantha 2026-10-15: "we shouldnt have to manually log a call or text follow up since the ai should monitor and record
// all of our calls and texts to leads". Approved mockup: https://claude.ai/artifact/MhFEgbLXTzmPCbegzHVv49 (Part 2).
//
// Each GoHighLevel call or text with a lead becomes ONE contact event on that lead, written exactly as the Hub's own
// Log a call writes it (ldPush, a history line, last contacted, tries counted, New becomes Contacted on the first real
// conversation). Nothing here sends anything. The function (lead-record/index.ts) does the reading and the saving.
//
//   call in,  answered              → connected, actor human (whoever answered)
//   call in,  not answered          → missed, actor family (they reached out; the board shows they're waiting)
//   call out, no talk time          → no_answer (voicemail when GoHighLevel says so): a try, counted
//   call out, 90 seconds or more    → connected
//   call out, under 90 seconds      → the call reader (call-tasks) decides: its reading says voicemail or not; with no
//                                     reading after 3 hours, under 45 seconds counts as voicemail, longer as connected
//   text in                         → reply, actor family
//   text out by a GoHighLevel user  → sent, actor human
//   text out by a workflow / bulk / the API with no user → sent, actor automation (never counts as us reaching out)
//
// Never twice: an event already carrying this message (ref ghl:<id>) is skipped, and so is one the Hub already wrote
// (a text from the Hub's Text button within 10 minutes, a call someone logged by hand within 90 minutes after it).
// =============================================================================
// deno-lint-ignore-file no-explicit-any
import { ldPush, looksLikeOptOut } from './lead-truth.ts'

export type Msg = { id: string; kind: 'call' | 'sms'; at: string; dir: 'in' | 'out'; seconds: number; status: string;
  userId: string; source: string; body: string; contactId: string }
export type Person = { email: string; first: string }
export type Reading = { voicemail: boolean; summary: string } | null
export type Decided = { wait: true } | { wait?: false; ev: any; line: string; kind: string }

export const LONG_CALL_S = 90, SHORT_VOICEMAIL_S = 45, WAIT_READING_MS = 3 * 3600e3
const MISSED = /^(no-?answer|busy|failed|cancel+ed|missed|voicemail|unanswered)$/i
const AUTO_SRC = /workflow|campaign|bulk|drip|trigger|automation|sequence/i

/** One GoHighLevel message as the recorder sees it, or null when it is neither a call nor a text. */
export function fromGhl(m: any, contactId = ''): Msg | null {
  if (!m || !m.id) return null
  const t = String(m.messageType || '')
  const kind = t === 'TYPE_CALL' ? 'call' : t === 'TYPE_SMS' ? 'sms' : null
  if (!kind) return null
  const at = String(m.dateAdded || m.dateUpdated || '')
  if (!Number.isFinite(Date.parse(at))) return null
  return { id: String(m.id), kind, at: new Date(Date.parse(at)).toISOString(), dir: m.direction === 'inbound' ? 'in' : 'out',
    seconds: Math.max(0, Number(m?.meta?.call?.duration ?? 0) || 0), status: String(m?.meta?.call?.status || m.status || ''),
    userId: String(m.userId || ''), source: String(m.source || ''), body: String(m.body || ''), contactId: String(m.contactId || contactId || '') }
}

const mins = (s: number) => Math.max(1, Math.round(s / 60)) + ' min'
const quote = (s: string) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t ? '"' + (t.length > 160 ? t.slice(0, 157) + '...' : t) + '"' : '' }
const withSummary = (line: string, r: Reading) => r && r.summary ? line + '. ' + String(r.summary).replace(/\s+/g, ' ').trim().slice(0, 240) : line

/** What this message means for the lead. wait = the call reader has not read a short outbound call yet. */
export function decide(m: Msg, who: Person | null, reading: Reading, now = Date.now()): Decided {
  const by = who?.email || '', name = who?.first || 'Someone in the office'
  if (m.kind === 'sms') {
    if (m.dir === 'in') return { kind: 'text_in', ev: { channel: 'sms', direction: 'in', outcome: 'reply', actor: 'family', note: m.body.slice(0, 300) },
      line: '💬 They texted: ' + quote(m.body) + (looksLikeOptOut(m.body) ? ' (this may be asking us to stop texting)' : '') }
    const human = !!m.userId && !AUTO_SRC.test(m.source)
    return human
      ? { kind: 'text_out', ev: { channel: 'sms', direction: 'out', outcome: 'sent', actor: 'human', by, note: m.body.slice(0, 300) }, line: '💬 ' + name + ' texted: ' + quote(m.body) }
      : { kind: 'text_auto', ev: { channel: 'sms', direction: 'out', outcome: 'sent', actor: 'automation', note: m.body.slice(0, 300) }, line: '💬 Automatic text: ' + quote(m.body) }
  }
  const missed = MISSED.test(m.status) || m.seconds <= 0
  if (m.dir === 'in') {
    if (missed) return { kind: 'call_missed', ev: { channel: 'call', direction: 'in', outcome: 'missed', actor: 'family' }, line: '☎ They called, nobody answered' }
    return { kind: 'call_in', ev: { channel: 'call', direction: 'in', outcome: 'connected', actor: 'human', by, duration_s: m.seconds },
      line: withSummary('☎ They called, ' + (who ? who.first : 'the office') + ' answered, ' + mins(m.seconds), reading) }
  }
  let outcome: string
  if (missed) outcome = /voicemail/i.test(m.status) ? 'voicemail' : 'no_answer'
  else if (m.seconds >= LONG_CALL_S) outcome = 'connected'
  else if (reading) outcome = reading.voicemail ? 'voicemail' : 'connected'
  else if (now - Date.parse(m.at) < WAIT_READING_MS) return { wait: true }
  else outcome = m.seconds < SHORT_VOICEMAIL_S ? 'voicemail' : 'connected'
  const ev: any = { channel: 'call', direction: 'out', outcome, actor: 'human', by }
  if (m.seconds > 0) ev.duration_s = m.seconds
  const line = outcome === 'connected' ? withSummary('☎ ' + name + ' called them, ' + mins(m.seconds), reading)
    : outcome === 'voicemail' ? '☎ ' + name + ' called, reached voicemail' : '☎ ' + name + ' called, no answer'
  return { kind: 'call_out_' + outcome, ev, line }
}

const near = (a: string, b: string, beforeMs: number, afterMs: number) => {
  const d = Date.parse(a) - Date.parse(b)   // a = the existing event, b = the message
  return d >= -beforeMs && d <= afterMs
}
/** 'ghl' = this message is already on the lead; 'hub' = the Hub already wrote it (Text button, Log a call); '' = new. */
export function already(lead: any, m: Msg, ev: any): '' | 'ghl' | 'hub' {
  const evs: any[] = Array.isArray(lead?.contact_events) ? lead.contact_events : []
  if (evs.some((e) => e && e.ref === 'ghl:' + m.id)) return 'ghl'
  const fromHub = (e: any) => e && !String(e.ref || '').startsWith('ghl:')
  if (m.kind === 'sms') {
    if (evs.some((e) => fromHub(e) && e.channel === 'sms' && e.direction === ev.direction && near(e.at, m.at, 10 * 60e3, 10 * 60e3))) return 'hub'
    return ''
  }
  if (evs.some((e) => fromHub(e) && e.channel === 'call' && e.outcome !== 'inquiry' && near(e.at, m.at, 10 * 60e3, 90 * 60e3))) return 'hub'
  return ''
}

/** Chicago calendar day (last_contacted_at is a day, as the Hub's today() writes it). */
export function chicagoDay(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
}

/** Writes one decided message onto the lead, as the Hub's Log a call would. Returns true on the lead's first real
 *  conversation (the caller records the lead_connected event). LR = the shared LeadRules (setStatus). */
export function apply(lead: any, m: Msg, d: { ev: any; line: string }, LR: any): boolean {
  const ev = d.ev, at = m.at
  const firstTime = !lead.first_human_contact_at && ev.actor === 'human' && ev.outcome === 'connected'
  const before = { a: lead.first_human_attempt_at, c: lead.first_human_contact_at }
  ldPush(lead, { ...ev, ref: 'ghl:' + m.id, at })
  /* backfill can meet a later message first: the first-try and first-reached times are the EARLIEST */
  if (ev.actor === 'human' && (ev.direction === 'out' || ev.outcome === 'connected') && before.a && at < before.a) lead.first_human_attempt_at = at
  if (ev.actor === 'human' && ev.outcome === 'connected' && before.c && at < before.c) lead.first_human_contact_at = at
  lead.contact_events.sort((x: any, y: any) => String(x?.at || '').localeCompare(String(y?.at || '')))
  lead.comm_log = Array.isArray(lead.comm_log) ? lead.comm_log : []
  lead.comm_log.push({ body: d.line, at, by: ev.by || 'GoHighLevel', src: 'auto', ref: 'ghl:' + m.id })
  if (ev.actor === 'human') {
    const day = chicagoDay(at)
    if (!lead.last_contacted_at || String(lead.last_contacted_at).slice(0, 10) < day) lead.last_contacted_at = day
  }
  if (ev.actor === 'human' && ev.direction === 'out' && (ev.outcome === 'no_answer' || ev.outcome === 'voicemail')) {
    lead.contact_attempts = (Number(lead.contact_attempts) || 0) + 1
    lead.last_attempt_kind = ev.outcome === 'voicemail' ? 'voicemail' : 'no answer'
  }
  if (ev.actor === 'human' && ev.outcome === 'connected' && String(lead.status || 'New') === 'New')
    LR.setStatus(lead, 'Contacted', { by: ev.by || 'GoHighLevel', why: 'first real conversation (recorded from the office line)', at })
  return firstTime
}

/** The leads a phone number belongs to (phone or client phone, not archived). */
export function leadsFor(leads: any[], phone: string): any[] {
  const d = String(phone || '').replace(/\D/g, '').slice(-10)
  if (d.length !== 10) return []
  const n = (p: unknown) => String(p || '').replace(/\D/g, '').slice(-10)
  return (leads || []).filter((l) => l && typeof l === 'object' && l.id && l.archived !== true && (n(l.phone) === d || n(l.client_phone) === d))
}
