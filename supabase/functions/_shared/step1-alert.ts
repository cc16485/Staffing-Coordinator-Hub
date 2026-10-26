// STEP 1 ALERT (Samantha 2026-10-26: "When Step 1 is complete, text and email every active admin right away so we start
// background checks and references"; wording approved the same day).
//   · Who: every admin on the Hub's "all admin" list, the same list that gets call-in alerts (ops_settings
//     coverage_alert_admins; adminRecipients in clockin-admins.ts). No second list to keep.
//   · When: the email at once, any hour. The text at once, except in office quiet hours (8pm to 7am Central,
//     quiet-hours.ts): then the every-10-minutes job (step1-alert) sends it at 7am. ONE text and ONE email per admin per
//     person, ever; a claim on the step1_alerts row makes sure two runs can't both send.
//   · Never: a practice hire, a staff training walkthrough "(TRAINING)", anyone who finished Step 1 before her switch was
//     turned on, or more than 3 days ago.
//   · No silent failures: a text or email that can't go (no phone on the staff list, GoHighLevel refused) becomes a card on
//     Needs Attention (textAdmin / ghlSendChecked / reportSendProblem); no admin list at all becomes a card too.
//   · Her switch: ops_settings.step1_alert_live (OFF until she turns it on in Hub Settings, Step 1 alert).
// Never throws.
// deno-lint-ignore-file no-explicit-any
import { adminRecipients, textAdmin, clock12, type Admin } from './clockin-admins.ts'
import { ghlSendChecked, reportSendProblem } from './send-problems.ts'
import { ghlStaffContact } from './staff-contact.ts'
import { officeQuietNow } from './quiet-hours.ts'
import { practiceOffer } from './step1-crypto.ts'
import { practicePerson } from './optout.ts'

export const HUB = 'https://cc.mo-care.com'
export const MAX_AGE_MS = 3 * 24 * 3_600_000
const S = (v: unknown, n = 120) => String(v ?? '').trim().slice(0, n)

/** The references that land on their Background & References record (step1-sign landingPatch: a reference they asked us
    not to contact never lands, at most 4): how many, how many with a phone, how many with an email only. */
export function step1RefCounts(answers: any): { n: number; phone: number; email: number } {
  const out = { n: 0, phone: 0, email: 0 }
  for (const k of ['professional_refs', 'personal_refs']) {
    for (const r of (Array.isArray(answers?.[k]) ? answers[k] : [])) {
      if (out.n >= 4) break
      const x = Array.isArray(r) ? { name: r[0], phone: k === 'professional_refs' ? r[3] : r[2], email: k === 'professional_refs' ? r[4] : r[3] } : (r && typeof r === 'object' ? r : {})
      if (!S(x.name) || x.may_contact === 'no') continue
      out.n++
      if (String(x.phone ?? '').replace(/\D/g, '').length >= 10) out.phone++
      else if (S(x.email)) out.email++
    }
  }
  return out
}

/** "today at 3:12pm" / "Monday at 9am" on the Chicago clock */
export function finishedWhen(at: string, now: Date = new Date()): string {
  const d = new Date(at); if (isNaN(d.getTime())) return 'today'
  const day = (x: Date) => x.toLocaleDateString('en-US', { timeZone: 'America/Chicago' })
  const hm = d.toLocaleTimeString('en-GB', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hour12: false })
  const yest = new Date(now.getTime() - 24 * 3_600_000)
  const when = day(d) === day(now) ? 'today' : day(d) === day(yest) ? 'yesterday' : d.toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'long' })
  return when + ' at ' + clock12(hm)
}

const refWords = (r: { n: number; phone: number; email: number }) => {
  if (!r.n) return 'They gave no references we may contact. Call them to get references.'
  const parts = [r.phone ? r.phone + ' with a phone' : '', r.email ? r.email + ' with an email' : ''].filter(Boolean)
  return 'Contact their references. They gave ' + r.n + (parts.length ? ' (' + parts.join(', ') + ')' : '') + '.'
}
const phoneWords = (p: unknown) => { const d = String(p ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); return d.length === 10 ? d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6) : S(p, 30) }

export type Step1Person = { name: string; phone?: string; position?: string; offered_by?: string; done_at: string; refs: { n: number; phone: number; email: number } }

/** Her approved wording (2026-10-26). */
export function step1AlertWords(p: Step1Person, admin: { first: string }, now: Date = new Date()): { sms: string; subject: string; html: string } {
  const esc = (t: unknown) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const sms = `Step 1 done: ${p.name} signed every form, including permission for background checks and references. Please start them now. Tap Claim in the Hub so nobody does it twice: ${HUB}/#ops`
  const facts = [p.phone ? 'Phone: ' + esc(phoneWords(p.phone)) : '', 'Position: ' + esc(p.position || 'Caregiver'), p.offered_by ? 'Offer by: ' + esc(p.offered_by) : ''].filter(Boolean).join(' &middot; ')
  const html = '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#16283a;">'
    + '<p>Hi ' + esc(admin.first || 'there') + ',</p>'
    + '<p><b>' + esc(p.name) + '</b> finished Step 1 ' + esc(finishedWhen(p.done_at, now)) + '. Their signed forms include permission for background checks and the okay to contact their references.</p>'
    + '<p><b>Please start now:</b></p><ol style="margin-top:0;">'
    + '<li>Tap <b>Claim</b> on their Needs Attention card so only one person works it.</li>'
    + '<li>Run the background checks: OIG, EDL, and FCSR.</li>'
    + '<li>' + esc(refWords(p.refs)) + '</li></ol>'
    + '<p>' + facts + '</p>'
    + '<p><a href="' + HUB + '/#onboarding" style="display:inline-block;background:#1F7A8C;color:#fff;font-weight:bold;padding:11px 22px;border-radius:9px;text-decoration:none;">Open in Background &amp; References &rarr;</a></p></div>'
  return { sms, subject: 'Step 1 done: start background checks and references for ' + p.name, html }
}

/** practice hire, practice phone/email, or a staff training walkthrough: never alerted */
export function notReal(o: any, who: { first?: string; last?: string; phone?: string; email?: string }): boolean {
  return practiceOffer(o) || practicePerson(who.phone, who.email) || /\(TRAINING\)/.test(`${who.first ?? ''} ${who.last ?? ''}`)
}

async function settings(db: any): Promise<any> {
  try { return (await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()).data?.data ?? {} } catch { return {} }
}
/** may this person be alerted now: switch on, finished after it was turned on, within 3 days */
export function inWindow(st: any, doneAt: string, now: Date = new Date()): { ok: boolean; why?: string } {
  if (st?.step1_alert_live !== true) return { ok: false, why: 'off' }
  const t = Date.parse(doneAt); if (!Number.isFinite(t)) return { ok: false, why: 'no finish time' }
  const since = Date.parse(String(st.step1_alert_live_since || ''))
  if (Number.isFinite(since) && t < since) return { ok: false, why: 'finished before the switch was on' }
  if (now.getTime() - t > MAX_AGE_MS) return { ok: false, why: 'finished over 3 days ago' }
  return { ok: true }
}

async function claim(db: any, offerId: string, col: 'email_claimed_at' | 'text_claimed_at', now: Date): Promise<boolean> {
  try {
    const { data, error } = await db.from('step1_alerts').update({ [col]: now.toISOString() }).eq('offer_id', offerId).is(col, null).select('offer_id')
    return !error && Array.isArray(data) && data.length === 1
  } catch { return false }
}

/** Send what is owed for one row of step1_alerts. */
export async function sendOwed(db: any, row: any, opts: { now?: Date; send?: typeof fetch; st?: any } = {}): Promise<Record<string, unknown>> {
  const now = opts.now ?? new Date(), send = opts.send ?? fetch
  const st = opts.st ?? await settings(db)
  const win = inWindow(st, row.done_at, now)
  if (!win.ok) return { skipped: win.why }
  const token = Deno.env.get('GHL_TOKEN') || Deno.env.get('GHL_API_KEY') || '', locationId = Deno.env.get('GHL_LOCATION_ID') || ''
  const ghl = { token, locationId }
  const p: Step1Person = { name: S(row.name, 80) || 'A new hire', phone: row.phone || '', position: row.position || '', offered_by: row.offered_by || '', done_at: row.done_at, refs: row.refs || { n: 0, phone: 0, email: 0 } }
  let admins: Admin[] = []
  try { admins = await adminRecipients(db, st) } catch { admins = [] }
  const out: Record<string, unknown> = { offer_id: row.offer_id }
  if (!admins.length) {
    await reportSendProblem(db, { sender: 'step1-alert', channel: 'email', address: '', who: 'the admin list',
      reasons: ['Step 1 alert for ' + p.name + ': nobody is on the admin list (Settings, Missed clock-ins, Admins who get these texts)'], failed: true })
    return { ...out, error: 'no admins' }
  }
  if (!row.email_claimed_at && await claim(db, row.offer_id, 'email_claimed_at', now)) {
    const h = { Authorization: `Bearer ${token}`, Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' }
    const sent: string[] = [], failed: string[] = []
    for (const a of admins) {
      const w = step1AlertWords(p, a, now)
      try {
        const cid = token && locationId ? await ghlStaffContact(ghl, { channel: 'email', email: a.email, firstName: a.first }, send) : ''
        if (!cid) { await reportSendProblem(db, { sender: 'step1-alert', channel: 'email', address: a.email, who: a.name, reasons: [token && locationId ? 'GoHighLevel returned no contact for this admin' : 'GoHighLevel is not set up (no token or location)'], failed: true }); failed.push(a.email); continue }
        if (await ghlSendChecked(db, h, 'step1-alert', { channel: 'email', contactId: cid, address: a.email, who: a.name }, { subject: w.subject, html: w.html }, send)) sent.push(a.email); else failed.push(a.email)
      } catch { failed.push(a.email) }
    }
    out.email = { sent: sent.length, failed: failed.length }
    try { await db.from('step1_alerts').update({ email_result: { at: now.toISOString(), sent, failed } }).eq('offer_id', row.offer_id) } catch { /* the cards say what failed */ }
  }
  if (!row.text_claimed_at) {
    if (await officeQuietNow(db, now)) out.text = 'waits for 7am (office quiet hours)'
    else if (await claim(db, row.offer_id, 'text_claimed_at', now)) {
      const sent: string[] = [], failed: string[] = []
      for (const a of admins) {
        try { if (await textAdmin(db, ghl, a, step1AlertWords(p, a, now).sms, send)) sent.push(a.email); else failed.push(a.email) } catch { failed.push(a.email) }
      }
      out.text = { sent: sent.length, failed: failed.length }
      try { await db.from('step1_alerts').update({ text_result: { at: now.toISOString(), sent, failed } }).eq('offer_id', row.offer_id) } catch { /* the cards say what failed */ }
    }
  }
  return out
}

/** step1-sign, the moment Step 1 completes: record the person (a snapshot, so the 7am job needs no other database) and
    send what may go now. The record is written before anything is sent, so a send the moment loses is still made by the
    every-10-minutes job. Practice and training hires are never recorded. `later` runs the sending after the caregiver's
    page has its answer (EdgeRuntime.waitUntil in step1-sign); without it the sending is awaited. */
export async function step1Alert(db: any, x: { offerId: string; o: any; who: Record<string, string>; answers: any; at: string },
                                 opts: { now?: Date; send?: typeof fetch; later?: (p: Promise<unknown>) => void } = {}): Promise<Record<string, unknown>> {
  try {
    if (notReal(x.o, x.who)) return { skipped: 'practice' }
    const row = { offer_id: x.offerId, name: S(`${x.who.first ?? ''} ${x.who.last ?? ''}`, 80), phone: S(x.who.phone, 30), position: S(x.who.position || x.o?.position, 60),
      offered_by: S(x.o?.offered_by, 60), refs: step1RefCounts(x.answers), done_at: x.at }
    const { error } = await db.from('step1_alerts').upsert(row, { onConflict: 'offer_id', ignoreDuplicates: true })
    if (error) {
      await reportSendProblem(db, { sender: 'step1-alert', channel: 'email', address: '', who: row.name, reasons: ['the Step 1 alert could not be recorded: ' + S(error.message || error, 100)], failed: true })
      return { ok: false, error: S(error.message || error, 160) }
    }
    const { data: saved } = await db.from('step1_alerts').select('*').eq('offer_id', x.offerId).maybeSingle()
    const go = sendOwed(db, saved ?? row, opts).catch((e) => ({ ok: false, error: S((e as Error)?.message ?? e, 160) }))
    if (opts.later) { opts.later(go); return { ok: true, recorded: true, sending: 'after the page answers' } }
    return { ok: true, recorded: true, ...(await go) }
  } catch (e) { return { ok: false, error: S((e as Error)?.message ?? e, 160) } }
}

/** The every-10-minutes job: the 7am texts for overnight finishes, and anything the moment itself missed. */
export async function step1AlertSweep(db: any, opts: { now?: Date; send?: typeof fetch } = {}): Promise<Record<string, unknown>> {
  const now = opts.now ?? new Date(), st = await settings(db)
  if (st.step1_alert_live !== true) return { live: false, owed: 0 }
  const from = new Date(Math.max(now.getTime() - MAX_AGE_MS, Date.parse(String(st.step1_alert_live_since || '')) || 0)).toISOString()
  const { data, error } = await db.from('step1_alerts').select('*').gte('done_at', from).or('email_claimed_at.is.null,text_claimed_at.is.null').order('done_at').limit(25)
  if (error) return { live: true, error: S(error.message || error, 160) }
  const results = []
  for (const row of data ?? []) results.push(await sendOwed(db, row, { ...opts, now, st }))
  return { live: true, owed: (data ?? []).length, results }
}
