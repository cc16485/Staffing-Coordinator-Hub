// =============================================================================
// OFFICE (IN-PERSON) ORIENTATION DAY-BEFORE REMINDER, the check (445). Samantha approved 2026-10-04 ("yes to all", decision 4 of
// https://claude.ai/artifact/MQgrEVdZ8Kr65LBLsha1Aq): the Hub sends it instead of the GoHighLevel workflow
// "Orientation booked - remind", at 10am the day before, within texting hours, with STOP, and it shows in the
// Applicant journey and in Conversations. Then she turns the GoHighLevel workflow off.
//
// Every hour from its schedule; between 10am and 6pm Central it looks at TOMORROW's orientation sessions (the Hub's
// app_data 'orient_sessions') and everyone still booked on them (attend_status empty), plus any page booking the office
// has not synced in yet (orient_bookings, merged = false). One text each, once (orient_reminders, unique per session,
// phone and mode). Skipped, and listed with why: no usable phone; booked today (the booking confirmation just went);
// their application said no to texts; opted out. Text only: the GoHighLevel reminder was a text.
// Switch OFF (ops_settings.orient_remind_live): practice, only lists who it WOULD remind. Nothing is sent.
// =============================================================================
// deno-lint-ignore-file no-explicit-any
export const TZ = 'America/Chicago'
export const SEND_FROM_HOUR = 10, SEND_UNTIL_HOUR = 18
export const ADDR = '1331 N Stewart Ave Ste B, Springfield MO 65802'
export const OFFICE = '(417) 234-8494'
export const FAILING_ID = 'ops_orient_remind_failing'

export function central(now: Date): { date: string; hour: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(now).map((x) => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 }
}
export const addDays = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
export const last10 = (p: unknown) => { const d = String(p ?? '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : '' }
export const fmtTime = (t: string) => {
  if (!/^\d{1,2}:\d{2}/.test(t || '')) return ''
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}
export const fmtDay = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: TZ })
const remoteOf = (s: any) => s?.is_remote === 'yes' || s?.is_remote === true

/* The wording (shown on the Applicant journey page). Same facts as the booking confirmation. */
export function reminderText(first: string, s: any): string {
  const link = String(s?.video_link || '').trim()
  const where = remoteOf(s) ? `This is a video call${link ? ': ' + link + '.' : '. We will send you the link.'}` : `Location: ${ADDR}.`
  /* Online new hires are reminded about their welcome call (interview-messages); these sessions are the in-person
     office orientation, the backup for someone who can't do it online (Samantha, 2026-10-04). */
  const what = remoteOf(s) ? 'your Caring Companions orientation video call' : 'your in-person Caring Companions orientation at our office'
  return `Hi ${first || 'there'}, a reminder that ${what} is tomorrow, ${fmtDay(String(s.date))} at ${fmtTime(String(s.time || ''))}. ${where} ` +
    `${remoteOf(s) ? 'Please have ready' : 'Please bring'} the original ID documents you uploaded in Viventium Step 2 (for example, your photo ID). ` +
    `Need to change it? Call or text us at ${OFFICE}. Reply STOP to opt out.`
}

export type Person = { session_id: string; date: string; phone10: string; phone: string; first: string; last: string; who: string; booked_at: string | null; text: string }
export type Skip = { session_id: string; date: string; phone10: string; who: string; why: string }
const short = (f: string, l: string) => [String(f || '').trim(), String(l || '').trim().slice(0, 1)].filter(Boolean).join(' ') || 'Someone'

/** Who is due a reminder today: everyone still booked on tomorrow's sessions. Pure, so it is tested as it runs. */
export function plan(sessions: any[], pending: any[], today: string): { due: Person[]; skipped: Skip[]; sessions: number } {
  const tomorrow = addDays(today, 1)
  const tom = (Array.isArray(sessions) ? sessions : []).filter((s) => s && String(s.date || '').slice(0, 10) === tomorrow)
  const due: Person[] = [], skipped: Skip[] = [], seen = new Set<string>()
  const consider = (s: any, b: any) => {
    const sid = String(s.id), p10 = last10(b.phone), who = short(b.first, b.last)
    const key = sid + '|' + (p10 || who)
    if (seen.has(key)) return
    seen.add(key)
    if (!p10) { skipped.push({ session_id: sid, date: tomorrow, phone10: '', who, why: 'no usable phone number' }); return }
    const bookedDay = b.booked_at && !isNaN(Date.parse(b.booked_at)) ? central(new Date(b.booked_at)).date : null
    if (bookedDay && bookedDay >= today) { skipped.push({ session_id: sid, date: tomorrow, phone10: p10, who, why: 'booked today, so their booking confirmation covers it' }); return }
    const first = String(b.first || '').trim()
    due.push({ session_id: sid, date: tomorrow, phone10: p10, phone: String(b.phone), first, last: String(b.last || '').trim(), who, booked_at: b.booked_at || null,
      text: reminderText(first && first !== 'Unknown' ? first : 'there', s) })
  }
  for (const s of tom) for (const b of (Array.isArray(s.bookings) ? s.bookings : [])) if (b && !b.attend_status) consider(s, b)
  for (const r of (Array.isArray(pending) ? pending : [])) {
    const s = tom.find((x) => String(x.id) === String(r.session_id))
    if (s && !r.merged) consider(s, r)
  }
  return { due, skipped, sessions: tom.length }
}

export type Deps = {
  consent: (phone: string) => Promise<{ ok: boolean; why?: string }>
  send: (p: Person) => Promise<{ sent: boolean; why?: string }>
}
export type JobOpts = { caller: string; runId: string; dry?: boolean; now?: Date }
const isOpen = (it: any) => it && !/^(done|closed|dismissed|resolved|cancelled|canceled)$/i.test(String(it.status || 'open'))
async function recordRun(db: any, row: any) { try { await db.from('orient_remind_runs').insert(row) } catch { /* the answer still says it */ } }
async function failureCard(db: any, error: string) {
  try {
    const { data } = await db.from('app_data').select('data').eq('key', 'ops_items').maybeSingle()
    const its = Array.isArray(data?.data) ? data.data : []
    if (isOpen(its.find((x: any) => x && x.id === FAILING_ID))) return
    const at = new Date().toISOString()
    await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { id: FAILING_ID, kind: 'orient_remind_card', domain: 'caregivers', status: 'open', urgency: 'today',
      title: 'Orientation reminders did not go',
      detail: 'The check that texts tomorrow\'s orientation people could not run (' + error.slice(0, 160) + '). Nobody has been reminded yet.',
      next_action: 'Text or call tomorrow\'s orientation people, and tell Claude.', created_at: at, first_at: at, last_activity_at: at,
      opened_by: 'orientation-remind', created_by: 'orientation-remind', log: [{ at, by: 'automation', text: 'Opened when the reminder check could not run.' }] } })
  } catch { /* never let reporting break the run */ }
}

export async function runJob(db: any, deps: Deps, o: JobOpts) {
  const now = o.now ?? new Date()
  const { date: today, hour } = central(now)
  let st: any = {}
  try { const { data } = await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle(); st = (data?.data && typeof data.data === 'object') ? data.data : {} } catch { st = {} }
  const live = st.orient_remind_live === true
  const mode = live ? 'live' : 'practice'
  if (!o.dry && (hour < SEND_FROM_HOUR || hour >= SEND_UNTIL_HOUR)) return { ok: true, mode, waiting: `reminders go between ${SEND_FROM_HOUR}am and 6pm Central` }
  const fail = async (error: string) => {
    if (!o.dry) { await recordRun(db, { run_id: o.runId, mode, caller: o.caller, ok: false, error: error.slice(0, 300) }); if (live) await failureCard(db, error) }
    return { ok: false, mode, error }
  }
  const { data: sd, error: se } = await db.from('app_data').select('data').eq('key', 'orient_sessions').maybeSingle()
  if (se) return fail('the orientation sessions could not be read (' + String(se.message ?? se).slice(0, 120) + ')')
  const { data: pend, error: pe } = await db.from('orient_bookings').select('id, session_id, first, last, phone, booked_at, merged').eq('merged', false)
  if (pe) return fail('the new page bookings could not be read (' + String(pe.message ?? pe).slice(0, 120) + ')')
  const P = plan(Array.isArray(sd?.data) ? sd.data : [], pend ?? [], today)
  const counts = { sessions: P.sessions, due: P.due.length, skipped: P.skipped.length }
  if (o.dry) return { ok: true, dry: true, mode, ...counts }

  const base = (x: { session_id: string; date: string; phone10: string; who: string }) =>
    ({ session_id: x.session_id, session_date: x.date, phone10: x.phone10 || ('none:' + x.who), who: x.who, mode, run_id: o.runId })
  const skipRows = P.skipped.map((x) => ({ ...base(x), result: 'skipped', detail: x.why }))
  if (skipRows.length) await db.from('orient_reminders').upsert(skipRows, { onConflict: 'session_id,session_date,phone10,mode', ignoreDuplicates: true })
  let sent = 0, would = 0, notSent = 0, failed = 0
  if (!live) {
    const rows = P.due.map((x) => ({ ...base(x), result: 'would', detail: x.text }))
    if (rows.length) {
      const { data: ins, error } = await db.from('orient_reminders').upsert(rows, { onConflict: 'session_id,session_date,phone10,mode', ignoreDuplicates: true }).select('id')
      if (error) return fail('the practice list could not be saved')
      would = Array.isArray(ins) ? ins.length : 0
    }
    await recordRun(db, { run_id: o.runId, mode, caller: o.caller, ok: true, ...counts, would })
    return { ok: true, mode, ...counts, would }
  }
  for (const p of P.due) {
    /* claim it first, so two runs can never both send to the same person for the same session */
    const { data: claim, error: ce } = await db.from('orient_reminders')
      .upsert([{ ...base(p), result: 'sending' }], { onConflict: 'session_id,session_date,phone10,mode', ignoreDuplicates: true }).select('id')
    if (ce || !Array.isArray(claim) || !claim.length) continue
    const rid = claim[0].id
    const c = await deps.consent(p.phone)
    if (!c.ok) { notSent++; await db.from('orient_reminders').update({ result: 'not_sent', detail: c.why || 'not allowed to text' }).eq('id', rid); continue }
    let r: { sent: boolean; why?: string }
    try { r = await deps.send(p) } catch (e) { r = { sent: false, why: String((e as Error)?.message ?? e).slice(0, 120) } }
    if (r.sent) { sent++; await db.from('orient_reminders').update({ result: 'sent', detail: p.text, sent_at: new Date().toISOString() }).eq('id', rid) }
    else if (r.why && /opted out|could not be confirmed/.test(r.why)) { notSent++; await db.from('orient_reminders').update({ result: 'not_sent', detail: r.why }).eq('id', rid) }
    else { failed++; await db.from('orient_reminders').update({ result: 'failed', detail: r.why || 'GoHighLevel did not accept it (a card is on Needs Attention)' }).eq('id', rid) }
  }
  await recordRun(db, { run_id: o.runId, mode, caller: o.caller, ok: true, ...counts, sent, not_sent: notSent, failed })
  return { ok: true, mode, ...counts, sent, not_sent: notSent, failed }
}
