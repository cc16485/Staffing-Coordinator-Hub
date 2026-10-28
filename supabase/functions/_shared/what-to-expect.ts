// =============================================================================
// what-to-expect: ONE text with mo-care.com/what-to-expect to a family a coordinator just made into a lead from a call.
// Samantha 2026-10-28: "Approved as an exception to my rule: send the what-to-expect text automatically when a coordinator
// makes a call into a lead, using the safer wording, holding it during quiet hours, once per lead."
//
// Who gets it: a lead MADE from a call we talked on (lead-rules.js madeFromCall: Make this a lead, or Yes on "New family?";
// never a call added to an older lead), made since the switch went on (what_to_expect_text_live_since), within 3 days,
// with a phone, not opted out / do-not-contact / stopped, not yet a yes, not Lost or Saved, and not already sent (by this
// run, or by a coordinator's "Text ... what to expect" button: lead.what_to_expect_sent_at).
// When: 7 AM to 8 PM Central, every day. A lead made at night waits for the first run after 7 AM (a hold, no card).
// Once: the ledger app_data 'what_to_expect_sends' (one item per lead) is the truth, so a Hub page saving an older copy of
// the lead can never make it go twice.
// Words: lead-rules.js after_call_auto (her safer wording), or her Settings wording (ops_settings.lead_scripts.after_call_auto).
// No silent failures: a refused or failed send raises the Needs Attention card (the outbound door does that); it tries 3 times,
// 15 minutes apart, then a card says to text them by hand. An opt-out is an answer: it stops, no card.
// Off: no approval record (ops_settings.what_to_expect_text_approved). Practice: approval but what_to_expect_text_live not true.
// =============================================================================

// deno-lint-ignore no-explicit-any
type Any = any
export type WteDeps = {
  now: () => Date
  settings: () => Promise<Any>
  leads: () => Promise<Any[]>
  sends: () => Promise<Any[]>                  // the ledger: { id (lead id), status, tries, last_try, sent_at }
  saveSend: (item: Any) => Promise<void>
  /** the server copy of the lead gets the stamp (and the timeline line when it went) */
  markLead: (leadId: string, vals: Any, sent?: { at: string; text: string }) => Promise<void>
  /** through the family-safe door: ok = GoHighLevel took it; optedOut = an authority said no (no card) */
  send: (lead: Any, text: string) => Promise<{ ok: boolean; optedOut?: boolean; why?: string }>
  officeItem: (item: Any) => Promise<void>
  rules: Any                                   // LeadRules (lead-rules.js), the same file the Hub runs
}
export const START_HOUR = 7, END_HOUR = 20, MAX_TRIES = 3, RETRY_MIN = 15, MAX_AGE_DAYS = 3

export function chicagoHour(now: Date): number {
  return Number(now.toLocaleString('en-US', { timeZone: 'America/Chicago', hour: '2-digit', hour12: false })) % 24
}
const done = (r: Any) => r && (r.status === 'sent' || r.status === 'opted_out' || r.status === 'gave_up')
const nameOf = (l: Any) => [l.first_name, l.last_name].filter(Boolean).join(' ').trim() || 'A new family'

export function eligible(l: Any, since: string, now: Date, R: Any): boolean {
  if (!l || !R.madeFromCall(l)) return false
  if (!since || String(l.created_at || '') < since) return false
  if (now.getTime() - Date.parse(l.created_at) > MAX_AGE_DAYS * 86400000) return false
  if (!String(l.phone || '').replace(/\D/g, '')) return false
  if (l.do_not_contact || l.auto_msgs_stopped_at || l.said_yes_at || l.what_to_expect_sent_at) return false
  return !['Lost', 'Saved', 'Converted'].includes(String(l.status || ''))
}

export async function whatToExpect(d: WteDeps, opts: { dry?: boolean } = {}) {
  const st = (await d.settings()) || {}, now = d.now(), nowIso = now.toISOString()
  const out = { eligible: 0, sent: 0, held: 0, waiting_retry: 0, failed: 0, opted_out: 0, gave_up: 0, would: [] as Any[] }
  const approval = st.what_to_expect_text_approved
  if (!approval || typeof approval !== 'object') return { ...out, off: 'no approval on record' }
  const live = st.what_to_expect_text_live === true
  const since = String(st.what_to_expect_text_live_since || '')
  if (!since) return { ...out, off: 'never switched on (no what_to_expect_text_live_since)' }
  const ledger = new Map((await d.sends()).map((r) => [String(r.id), r]))
  const quiet = (h => h < START_HOUR || h >= END_HOUR)(chicagoHour(now))
  for (const l of await d.leads()) {
    if (!eligible(l, since, now, d.rules)) continue
    const rec = ledger.get(String(l.id))
    if (done(rec)) continue
    out.eligible++
    if (quiet) { out.held++; continue }
    if (rec && rec.last_try && now.getTime() - Date.parse(rec.last_try) < RETRY_MIN * 60000) { out.waiting_retry++; continue }
    const text = d.rules.afterCallAuto(l, { me: l.filled_from_calls_by, scripts: st.lead_scripts || {} })
    if (!live || opts.dry) { out.would.push({ lead: l.id, name: nameOf(l), text }); continue }
    let r: { ok: boolean; optedOut?: boolean; why?: string }
    try { r = await d.send(l, text) } catch (e) { r = { ok: false, why: String((e as Error)?.message ?? e).slice(0, 160) } }
    const tries = (Number(rec?.tries) || 0) + 1
    if (r.ok) {
      await d.saveSend({ id: String(l.id), status: 'sent', tries, last_try: nowIso, sent_at: nowIso })
      await d.markLead(String(l.id), { what_to_expect_sent_at: nowIso, what_to_expect_sent_by: 'automatic' }, { at: nowIso, text })
      out.sent++; continue
    }
    if (r.optedOut) {
      await d.saveSend({ id: String(l.id), status: 'opted_out', tries, last_try: nowIso })
      await d.markLead(String(l.id), { auto_msgs_stopped_at: nowIso, auto_msgs_stop_reason: 'opt-out: ' + (r.why || 'an opt-out is on file') })
      out.opted_out++; continue
    }
    if (tries < MAX_TRIES) { await d.saveSend({ id: String(l.id), status: 'retry', tries, last_try: nowIso, why: r.why || '' }); out.failed++; continue }
    await d.saveSend({ id: String(l.id), status: 'gave_up', tries, last_try: nowIso, why: r.why || '' })
    const who = nameOf(l)
    const detail = `The automatic what to expect text to ${who} (${l.phone}) did not go through after ${MAX_TRIES} tries` +
      (r.why ? ` (${r.why})` : '') + `. Open ${who}'s lead and press "Text ${String(l.first_name || 'them').split(' ')[0]} what to expect", or call them.`
    await d.officeItem({ id: `ops_wte_${l.id}`, kind: 'send_problem', domain: 'family_enquiries', status: 'open', urgency: 'today',
      title: `What to expect text not sent: ${who}`, about: who, who, detail, next_action: 'Text or call them from their lead.',
      source: { kind: 'what_to_expect', lead_id: String(l.id) }, created_at: nowIso, first_at: nowIso, last_at: nowIso, last_activity_at: nowIso,
      created_by: 'what to expect text', opened_by: 'what to expect text', history: [{ at: nowIso, by: 'what to expect text', text: detail }] })
    out.gave_up++
  }
  return { ...out, live, quiet_hours: quiet }
}
