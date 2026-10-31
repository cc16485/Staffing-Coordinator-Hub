// =============================================================================
// oncall-page — a Level 3 caregiver's own "My on-call" page (Samantha 2026-10-30, Krystal's idea; rules C1 to C7 in
// _shared/prn-oncall.ts, the same on-call rules as the PRN CNA Team's page)
// =============================================================================
// Public (no login; deploy with --no-verify-jwt): the caregiver opens it from their own sealed link (_shared/oncall-links.ts,
// 30 days). Anything forged or expired is refused. Office staff open it read-only with their Hub sign-in (preview {caregiver_ax}).
//   view      {c, e, t}: what on call is, the On-Call Expectations to sign, the calendar (today plus 4 weeks, daytime 7am to 5pm and
//             overnight 5pm to 7am) with Just this one / Every week, and their shifts. Never another person's name, never pay.
//   preview   {caregiver_ax} + a Hub sign-in: the same page, read-only.
//   sign      {c, e, t, agree: true, typed_name, version}: they read and signed the expectations (the exact words kept).
//   ask       {c, e, t, slots: [{date, slot, weekly?}]}: asks for open shifts; the office confirms each (an every-week one once).
//   withdraw  {c, e, t, id}: takes back their own ask the office hasn't answered.
// C1: only while AxisCare shows them active at Level 3 (read live each time; if AxisCare can't be read, nothing is saved). Someone
// on the PRN CNA Team uses their PRN Team page instead. C7: switch ops_settings.prn_oncall_invite_live, off: their page says it
// isn't open yet and nothing is saved; the office preview works. Nothing here texts anyone.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { checkOncallLink } from '../_shared/oncall-links.ts'
import { ax } from '../_shared/axiscare-caregiver.ts'
import { MO_FROM } from '../_shared/office-from.ts'
import { memberSlots, blockOf, readAsks, readSign, signedCurrent, termsText, termsVersion, seriesView, weekdayOf, withKeys, isLevel3,
  SLOT_WORD, DAYS_AHEAD, GIVE_BACK_HOURS } from '../_shared/prn-oncall.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
// deno-lint-ignore no-explicit-any
type Any = any
const S = (v: unknown, n = 200) => String(v ?? '').trim().slice(0, n)
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
const nowNaive = () => new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).replace(' ', 'T').slice(0, 16)
const digits10 = (p: unknown) => { const d = String(p ?? '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : '' }
// deno-lint-ignore no-explicit-any
async function readKey(sb: any, key: string): Promise<Any> { const { data } = await sb.from('app_data').select('data').eq('key', key).maybeSingle(); return data?.data ?? null }
const officePhone = () => { const d = digits10(MO_FROM); return d ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : '(417) 234-8494' }
const rowsOf = (x: Any): Any[] => Array.isArray(x) ? x : (x && typeof x === 'object' ? Object.values(x) : [])
export const ONCALL_ABOUT = 'On call means keeping your phone close during a daytime (7am to 5pm) or overnight (5pm to 7am) shift. If a caregiver can\'t make it, the office calls you first. You\'re paid for each on-call shift, plus your pay for any shift you cover. Sign up for the shifts that fit your life, one time or every week. Once you\'re on call, families are counting on you.'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  let b: Any = {}
  try { b = await req.json() } catch { b = {} }
  const action = S(b?.action, 20)
  const secret = Deno.env.get('HUB_JOB_SECRET') ?? ''
  const st = (await readKey(sb, 'ops_settings')) || {}
  const live = st.prn_oncall_invite_live === true

  /* who: the caregiver from their link, or the office previewing one caregiver */
  let cax = ''
  if (action === 'preview') {
    const who = await requireStaff(sb, req, OFFICE_ROLES)
    if (!who.ok) return json({ error: who.error }, who.status)
    cax = S(b.caregiver_ax, 12)
    if (!/^[0-9]{1,12}$/.test(cax)) return json({ error: 'Which caregiver?' }, 400)
  } else {
    if (!(await checkOncallLink(secret, b))) return json({ expired: true, message: 'This link has expired or is not valid. Text us and we will send you a fresh one.', office: officePhone() }, 401)
    cax = S(b.c, 12)
    if (!live) return json({ closed: true, message: "On-call sign-up isn't open yet. We'll text you when it is.", office: officePhone() })
  }
  const key = 'ax:' + cax, t = today()
  /* C1: someone on the PRN CNA Team signs up on their PRN Team page */
  const { data: prnT } = await sb.from('pay_tracks').select('team').eq('track', 'prn_team').eq('axiscare_caregiver_id', cax)
  if ((prnT ?? []).some((x: Any) => x.team !== 'caregiver')) return json({ prn: true, message: 'You sign up for on call on your PRN Team page. Text us if you need a fresh link to it.', office: officePhone() })
  /* C1: active at Level 3 in AxisCare, read live */
  const g = await ax('GET', `/api/caregivers/${encodeURIComponent(cax)}`)
  const cg = g.json?.results?.caregiver ?? g.json?.caregiver ?? (g.json && g.json.id != null ? g.json : null)
  if (g.status !== 200 || !cg) return json({ error: "We couldn't check your record just now. Please try again in a few minutes.", office: officePhone() }, 503)
  if (cg?.status?.active !== true || !isLevel3(rowsOf(cg?.classes))) return json({ notlevel: true, message: 'On call is for our caregivers at Level 3 (Advanced Care). Call the office with any questions.', office: officePhone() }, 403)
  const first = S(cg.goesBy, 40) || S(cg.firstName, 40).split(/\s+/)[0] || 'there'
  const text = termsText(st), ver = termsVersion(text)
  const [allQ, mkQ, tmQ, seQ] = await Promise.all([
    sb.from('prn_oncall').select('id, applicant_id, caregiver_ax, kind, start_date, end_date, shift, cancelled_at, at, series_id').in('kind', ['confirmed', 'asked']).gte('end_date', t),
    sb.from('prn_oncall_marks').select('applicant_id, caregiver_ax, kind, oncall_id, at, by_name').eq('caregiver_ax', cax),
    sb.from('prn_oncall_terms').select('caregiver_ax, version, agreed_at').eq('caregiver_ax', cax),
    sb.from('prn_oncall_series').select('*').eq('caregiver_ax', cax).in('status', ['asked', 'confirmed'])])
  if (allQ.error || mkQ.error || tmQ.error || seQ.error) return json({ error: 'On call is not set up on the server yet. Call the office if you would like to be on call.', office: officePhone() }, 503)
  const rows = withKeys(allQ.data ?? []), marks = withKeys(mkQ.data ?? []), terms = withKeys(tmQ.data ?? []), series = withKeys(seQ.data ?? [])
  const signed = signedCurrent(terms, key, ver), blocked = blockOf(marks, key).blocked

  if (action === 'view' || action === 'preview') {
    return json({ ok: true, preview: action === 'preview', waiting: !live, first, today: t, about: ONCALL_ABOUT, office: officePhone(),
      signup: { ready: true, terms: text, version: ver, signed, signed_before: terms.length > 0, blocked, slot_words: SLOT_WORD, days: DAYS_AHEAD, give_back_hours: GIVE_BACK_HOURS,
        slots: memberSlots({ rows, aid: key, today: t, nowNaive: nowNaive(), series }), weekly_ready: true, weekly: seriesView(series) } })
  }

  if (action === 'sign') {
    const r = readSign(b, ver, S(cg.firstName, 40), S(cg.lastName, 40)); if (!r.ok) return json({ error: r.error }, 400)
    const { error } = await sb.from('prn_oncall_terms').insert({ applicant_id: null, caregiver_ax: cax, version: ver, body: text, typed_name: r.typed, via: 'oncall-page' })
    if (error && !/duplicate|unique/i.test(error.message)) return json({ error: 'Could not save, please try again.' }, 500)
    return json({ ok: true, message: `Thank you, ${first}. You can sign up for on-call shifts now.` })
  }
  if (action === 'withdraw') {
    const id = Number(b.id); if (!Number.isInteger(id) || id <= 0) return json({ error: 'Which shift?' }, 400)
    const { data: row } = await sb.from('prn_oncall').select('*').eq('id', id).maybeSingle()
    if (!row || S(row.caregiver_ax, 12) !== cax || row.kind !== 'asked') return json({ error: 'That shift could not be found. Call the office.' }, 404)
    if (row.cancelled_at) return json({ ok: true, message: 'That one was already answered. Look again.' })
    const { error } = await sb.from('prn_oncall').update({ cancelled_at: new Date().toISOString(), cancelled_by: `${first} took it back on their page` }).eq('id', id).is('cancelled_at', null)
    if (error) return json({ error: 'Could not save, please try again.' }, 500)
    if (row.series_id != null) await sb.from('prn_oncall_series').update({ status: 'ended', ended_at: new Date().toISOString(), ended_by: first, end_why: 'They took the ask back on their page' }).eq('id', row.series_id).eq('status', 'asked')
    return json({ ok: true, message: 'Taken back.' })
  }
  if (action === 'ask') {
    if (blocked) return json({ error: "On call isn't open to you right now. Call the office with any questions." }, 409)
    if (!signed) return json({ error: 'Please read and sign the On-Call Expectations first.', sign: true }, 409)
    const r = readAsks(b, { rows, aid: key, today: t, nowNaive: nowNaive(), series }); if (!r.ok) return json({ error: r.error }, 409)
    let added = 0
    for (const sl of r.slots) {
      let seriesId: number | null = null
      if (sl.weekly) {
        const { data: sr, error: se } = await sb.from('prn_oncall_series').insert({ applicant_id: null, caregiver_ax: cax, slot: sl.slot, weekday: weekdayOf(sl.date), first_date: sl.date, status: 'asked',
          note: 'Their My on-call page', by_email: 'oncall-page', by_name: first }).select('id').maybeSingle()
        if (se || !sr) { if (/duplicate|unique/i.test(se?.message || '')) continue; return json({ error: added ? `${added} saved, then something went wrong. Look again and try the rest.` : 'Could not save, please try again.' }, 500) }
        seriesId = Number(sr.id)
      }
      const { error } = await sb.from('prn_oncall').insert({ applicant_id: null, caregiver_ax: cax, kind: 'asked', start_date: sl.date, end_date: sl.date, shift: sl.slot, note: 'Their My on-call page',
        by_email: 'oncall-page', by_name: first, ...(seriesId ? { series_id: seriesId } : {}) })
      if (!error) { added++; continue }
      if (seriesId) await sb.from('prn_oncall_series').update({ status: 'ended', ended_at: new Date().toISOString(), ended_by: 'oncall-page', end_why: 'Its first week could not be saved' }).eq('id', seriesId)
      if (!/duplicate|unique/i.test(error.message)) return json({ error: added ? `${added} saved, then something went wrong. Look again and try the rest.` : 'Could not save, please try again.' }, 500)
    }
    const wk = r.slots.some((x) => x.weekly)
    return json({ ok: true, message: `Thank you, ${first}! The office will confirm ${added === 1 ? 'it' : 'them'} with you. Nothing is set until they do.` + (wk ? ' Once they confirm an every-week shift, it repeats on its own. To stop one, call the office at least 24 hours before the next one starts.' : '') })
  }
  return json({ error: 'unknown action' }, 400)
})
