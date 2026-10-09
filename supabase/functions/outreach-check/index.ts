// Supabase Edge Function: outreach-check (shared hub project) · 2026-09-27
// -----------------------------------------------------------------------------
// The Hub's "who is sending, and may this person be messaged?" door for senders that live in OTHER projects (the
// Training Platform's lead texts/emails, GoHighLevel replies and job offers). Those used to trust one shared staff key;
// now the caller's own Hub sign-in is forwarded here and checked like every Hub action, and each message goes through
// the same universal opt-out check the Hub's own senders use (GHL Do Not Disturb, the Hub's opt-out record, inquiry
// do-not-contact, Family Circle stops).
//
//   POST  Authorization: Bearer <the staff member's Hub session>
//     { auth_check: true }                                   -> { ok, authorized, email, name, roles }
//     { sender, channel: 'sms'|'email', phone? | email?, first_name?, last_name? }  -> { allowed, contact_id? }
//     { sender, channel, contact_id }                       -> { allowed, contact_id? }   (a GHL contact saved earlier)
// A refusal is logged in the Hub's refusal log with the sender and the verified staff member. Nothing is sent here.
//
// SERVER DOOR (2026-09-27, for senders with no staff behind them: a caregiver's own link, a scheduled job, a
// HomeTogether Hire customer): header x-outreach-secret = OUTREACH_SECRET (the same server-only value in the Hub,
// Training and HomeTogether Hire projects, never in code or pages), body { sender, channel, phone? | email?,
// via_ghl?: false } -> { allowed }. via_ghl:false (email sent by Resend) checks every authority except GoHighLevel.
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { ghlContactIfAllowed, ghlStoredContactIfAllowed, mayContact } from '../_shared/optout.ts'
import { serverSecretOk } from '../_shared/staff-auth.ts'
import { reportSendProblem } from '../_shared/send-problems.ts'
import { latestTextConsent } from '../_shared/text-consent.ts'
/* SLICE 1c (Samantha: "start slice 1c", 2026-10-09): the same onboarding_path answer also carries what the Training
   Platform's job-offer needs for an offer on the NEW path, so Training never computes a holiday or reads a Hub setting
   itself: the offer's expiry (seven business days after the offer date, 5pm Central, on the company calendar; her
   ruling of October 8), whether offer sending is live (ops_settings.offer_send_live; off = practice, nothing goes out)
   and whether the signed-in caller may re-offer over an open duplicate (the Approve to Advance list plus the owners,
   by identity). The server door gets the expiry and the switch but never may_reoffer. Nothing is written. */
import { dueNextBusinessDay } from '../_shared/business-days.ts'
import { PERM_KEY, normalizePerms, mayApprove } from '../_shared/onboarding-permissions.ts'
export const OFFER_LINK_BUSINESS_DAYS = 7

/* TRAINING PLATFORM TEXTS (2026-10-01, Samantha: "fix the training platform texts"). Two more answers for senders in
   other projects, on both doors (server secret, or a forwarded staff sign-in):
     { report: true, sender, channel, phone? | email?, who?, why }  -> raises a "Didn't go through" card on Needs
        Attention (NO SILENT FAILURES): the Training Platform cannot write the Hub's list itself.
     { text_ok: true, phone }  -> { text_ok }: false only when this phone's LATEST application said no to texts
        (job offers respect it; anyone with no application on file, e.g. an existing employee, is not affected). */
// deno-lint-ignore no-explicit-any
async function extraAnswer(db: any, b: Record<string, any>, sender: string, who: { person_id: string; roles: string[] } | null = null): Promise<Response | null> {
  if (b.report === true) {
    const ch = b.channel === 'email' ? 'email' : 'sms'
    /* ORIENTATION LINK (1b, 2026-10-01): held: true means the Training Platform held the message back itself (not in
       AxisCare as In Training yet, Do Not Disturb, no phone or email, an opt-out list it could not check), so the card
       explains that reason instead of saying GoHighLevel refused it. Without held it is a GoHighLevel refusal, as before. */
    await reportSendProblem(db, { sender, channel: ch, address: ch === 'sms' ? b.phone : b.email, who: b.who,
      reasons: [String(b.why || 'the message did not go').slice(0, 300)], failed: b.held !== true })
    return json({ ok: true, reported: true })
  }
  if (b.text_ok === true) {
    const c = await latestTextConsent(db, b.phone)
    return json(c.ok ? { text_ok: true } : { text_ok: false, why: c.why })
  }
  /* ONBOARDING PATH (Slice 0, Samantha approved 2026-10-08). The Training Platform's job-offer function asks, with the
     staff member's own sign-in, which onboarding path an offer made on `offer_date` belongs to. One source of truth:
     ops_settings.onboarding_switch_date on the Owners Hub Admin page. Blank (every day until she sets it in slice 9):
     'old'. Set: 'new' for offers dated on or after it, 'old' before. The date is the Chicago date; the answer is
     computed here so no browser copy of the settings can decide it. Nothing is written. */
  if (b.onboarding_path === true) {
    const { data: row, error } = await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
    if (error) return json({ error: 'could not read the onboarding switch date: ' + error.message }, 500)
    const sw = row?.data?.onboarding_switch_date
    const switch_date = typeof sw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sw) ? sw : null
    const asked = typeof b.offer_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.offer_date) ? b.offer_date : null
    const offer_date = asked || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
    const path = switch_date && offer_date >= switch_date ? 'new' : 'old'
    const offer_expires_at = dueNextBusinessDay(offer_date + 'T12:00:00Z', row?.data?.company_holidays, 17, OFFER_LINK_BUSINESS_DAYS)
    const offer_send_live = row?.data?.offer_send_live === true
    /* SLICE 1d (2026-10-09): whether the Step 1 link sends itself after the signature (Admin switch; off = practice) */
    const step1_auto_live = row?.data?.step1_auto_live === true
    let may_reoffer = false
    if (who?.person_id) {
      const { data: pr } = await db.from('app_data').select('data').eq('key', PERM_KEY).maybeSingle()
      may_reoffer = mayApprove(normalizePerms(pr?.data), 'advance', { person_id: who.person_id, roles: who.roles })
    }
    return json({ onboarding_path: path, switch_date, offer_date, offer_expires_at, offer_link_business_days: OFFER_LINK_BUSINESS_DAYS, offer_send_live, step1_auto_live, may_reoffer })
  }
  return null
}

/* PROFILE BEFORE "CLEARED" (2c-T, 2026-10-01). Samantha: "Wait for the profile": the Training Platform holds a NEW
   HIRE's "you are cleared" text and the AxisCare Active switch until their caregiver profile is published.
   SERVER DOOR ONLY (the same OUTREACH_SECRET the Training senders already use; no new key, nothing public):
     { profile_check: true, axiscare_id: '<digits>' }  -> { published: boolean, new_hire: boolean }
   published: the SAME test the Hub's own gate uses (caregiver-profile-panel.js gateFor): the profile found by AxisCare
     id first, then by the candidate id the Hub carried over at promotion; published and not withdrawn. A name match is
     never used.
   new_hire: the Hub's half of eligibility-rules.js profileNewHire (welcome call on file, or the Hub's hire_date /
     promoted_at on or after PROFILE_REQUIRED_FROM). Someone not on the Hub roster is false here; Training also applies
     its own hire date.
   Nothing else comes back: no ids, no names. A database error is a 500 (the caller treats it as "unknown" and holds). */
const PROFILE_REQUIRED_FROM = '2026-10-02'   // the same line as eligibility-rules.js
function centralYmd(iso: unknown): string {
  if (!iso) return ''
  const d = new Date(String(iso)); if (isNaN(d.getTime())) return ''
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d)
  const g = (t: string) => p.find((x) => x.type === t)?.value || ''
  return `${g('year')}-${g('month')}-${g('day')}`
}
// deno-lint-ignore no-explicit-any
async function profileAnswer(db: any, raw: unknown): Promise<Response> {
  const ax = String(raw ?? '').trim()
  if (!/^\d{1,12}$/.test(ax)) return json({ error: 'axiscare_id must be the AxisCare caregiver number' }, 400)
  const ro = await db.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()
  if (ro.error) return json({ error: 'could not read the roster' }, 500)
  // deno-lint-ignore no-explicit-any
  const g: any = (Array.isArray(ro.data?.data) ? ro.data.data : []).find((c: any) => String(c?.axiscare_id ?? '').trim() === ax) ?? null
  const cand = g && g.candidate_id != null && String(g.candidate_id).trim() !== '' ? String(g.candidate_id).trim() : null
  const find = async (col: string, val: string) => {
    const r = await db.from('caregiver_profiles').select('published,status').eq(col, val).neq('status', 'withdrawn')
      .order('updated_at', { ascending: false }).limit(1)
    return r.error ? { err: true, row: null } : { err: false, row: (r.data || [])[0] ?? null }
  }
  let hit = await find('axiscare_id', ax)
  if (hit.err) return json({ error: 'could not read the profiles' }, 500)
  if (!hit.row && cand) { hit = await find('candidate_id', cand); if (hit.err) return json({ error: 'could not read the profiles' }, 500) }
  const published = !!(hit.row && hit.row.published === true && hit.row.status !== 'withdrawn')
  let newHire = false
  if (g) {
    const hd = String(g.hire_date || '').slice(0, 10)
    const pr = centralYmd(g.promoted_at)
    newHire = (/^\d{4}-\d{2}-\d{2}$/.test(hd) && hd >= PROFILE_REQUIRED_FROM) || (!!pr && pr >= PROFILE_REQUIRED_FROM)
    if (!newHire && cand) {
      const w = await db.from('welcome_calls').select('status').eq('candidate_id', cand).neq('status', 'cancelled').limit(1)
      if (w.error) return json({ error: 'could not read the welcome calls' }, 500)
      newHire = (w.data || []).length > 0
    }
  }
  return json({ published, new_hire: newHire })
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  if (req.headers.get('x-outreach-secret') !== null) {
    if (!serverSecretOk(req, 'OUTREACH_SECRET', 'x-outreach-secret')) return json({ error: 'unauthorized' }, 401)
    // deno-lint-ignore no-explicit-any
    const s: Record<string, any> = await req.json().catch(() => ({}))
    if (s.profile_check === true) return await profileAnswer(db, s.axiscare_id)
    const extra = await extraAnswer(db, s, String(s.sender || 'other-project').slice(0, 80))
    if (extra) return extra
    const ch = s.channel === 'email' ? 'email' : s.channel === 'sms' ? 'sms' : null
    if (!ch) return json({ error: 'channel must be sms or email' }, 400)
    const sender = String(s.sender || 'other-project').slice(0, 80)
    if (s.via_ghl === false) return json({ allowed: await mayContact(db, sender, { channel: ch, phone: s.phone, email: s.email, viaGhl: false }) })
    const ghl = { token: Deno.env.get('GHL_TOKEN') ?? '', locationId: Deno.env.get('GHL_LOCATION_ID') ?? '' }
    const id = await ghlContactIfAllowed(db, ghl, sender, { channel: ch, phone: s.phone, email: s.email, firstName: s.first_name })
    return json({ allowed: !!id })
  }
  const who = await requireStaff(db, req, OFFICE_ROLES)
  if (!who.ok) return json({ error: who.error }, who.status)
  // deno-lint-ignore no-explicit-any
  const b: Record<string, any> = await req.json().catch(() => ({}))
  if (b.auth_check === true) return json({ ok: true, authorized: true, email: who.email, name: who.name, roles: who.roles })
  const extra = await extraAnswer(db, b, String(b.sender || 'other-project').slice(0, 60), { person_id: who.person_id, roles: who.roles })
  if (extra) return extra

  const channel = b.channel === 'email' ? 'email' : b.channel === 'sms' ? 'sms' : null
  if (!channel) return json({ error: 'channel must be sms or email' }, 400)
  const sender = `${String(b.sender || 'other-project').slice(0, 60)} (by ${who.email})`
  const ghl = { token: Deno.env.get('GHL_TOKEN') ?? '', locationId: Deno.env.get('GHL_LOCATION_ID') ?? '' }
  if (!ghl.token || !ghl.locationId) return json({ allowed: false, error: 'GHL not configured' }, 500)
  const id = b.contact_id
    ? await ghlStoredContactIfAllowed(db, ghl, sender, { channel, contactId: b.contact_id })
    : await ghlContactIfAllowed(db, ghl, sender, { channel, phone: b.phone, email: b.email, firstName: b.first_name, lastName: b.last_name })
  return json(id ? { allowed: true, contact_id: id } : { allowed: false })
})
