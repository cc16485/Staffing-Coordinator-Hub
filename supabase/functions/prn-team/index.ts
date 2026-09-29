// =============================================================================
// prn-team — the PRN CNA Team's pay track, its link to AxisCare, and Move to ongoing (PRN2, 2026-09-29)
// =============================================================================
// Signed-in office staff only (owner_admin, care_coordinator, staffing_coordinator). Nothing here runs on its own.
//
// ONE PAY TRACK AT A TIME (Samantha, 2026-09-29): a CNA is EITHER on the PRN CNA Team ($20/hr) OR an ongoing
// caregiver ($18/hr), never both. Changing tracks is a deliberate step with a date, a reason and who did it, kept
// forever in pay_track_history. Nothing here switches rates per shift, overrides payroll, or asks AxisCare to tell
// PRN hours from ongoing hours.
//
//   vocab     (the owner's server key only, read-only) whether PRN Team and CNA exist in AxisCare
//   list      every current track and the whole history (for the Hub)
//   start     {applicant_id}: after a PRN offer is sent. Joins the PRN CNA Team at the approved PRN rate. Once only.
//   link      {applicant_id, axiscare_caregiver_id}: AxisCare gives applicants and caregivers different numbers, so
//             staff link them. Refused unless the caregiver's phone or email in AxisCare matches this hire exactly,
//             and no other PRN hire matches too. Their application's days and times become their starting
//             availability, only when they have none.
//   classes   {applicant_id}: read-only. Their AxisCare classes, and whether PRN Team and CNA exist in AxisCare.
//   mark      {applicant_id}: adds PRN Team and CNA in AxisCare, keeps every other class, reads it back, logs it.
//   shift     {axiscare_caregiver_id, case_id, kind: 'confirmed'|'backed_out', shift_date} (PRN3): a PRN member was
//             confirmed on a shift, or backed out after confirming. Kept per person and shift, never edited.
//   move      {applicant_id, to: 'ongoing'|'prn_team', effective_date, reason, from}: the track change, then the
//             PRN Team class off (to ongoing; CNA stays) or back on (to prn_team) in AxisCare, read back and logged.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { ownerCaller } from '../_shared/job-auth.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const AC_VERSION = '2023-10-01'
const RATE_FALLBACK = { prn_team: 20, ongoing: 18 }   // her figures; the approved Pay rates win when set

// deno-lint-ignore no-explicit-any
async function recordAxisChange(db: any, c: { kind: string; caregiver: string; outcome: 'sent_confirmed' | 'sent' | 'refused'; summary: string; detail?: string | null; by: string }): Promise<boolean> {
  try {
    const { data, error } = await db.rpc('axiscare_change_record', { p_kind: c.kind, p_subject: 'caregiver', p_client: null, p_caregiver: c.caregiver,
      p_outcome: c.outcome, p_summary: String(c.summary).slice(0, 200), p_detail: c.detail ? String(c.detail).slice(0, 300) : null, p_by: c.by || 'unknown', p_via: 'prn-team' })
    return !error && data?.outcome === 'recorded'
  } catch { return false }
}
// deno-lint-ignore no-explicit-any
const rows = (v: any): any[] => Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : [])
const lab = (c: { label?: unknown; code?: unknown }) => String(c?.label ?? c?.code ?? '').trim()
const slim = (c: { label?: unknown; code?: unknown }) => ({ ...(c?.code ? { code: String(c.code) } : {}), ...(c?.label ? { label: String(c.label) } : {}) })
/* Which AxisCare classes these are. Exactly one of each must exist, or the step refuses and says so. */
export const isPrnClass = (c: { label?: unknown; code?: unknown }) => /\bprn\b/i.test(String(c?.label ?? '')) || /\bprn\b/i.test(String(c?.code ?? ''))
export const isCnaClass = (c: { label?: unknown; code?: unknown }) =>
  String(c?.code ?? '').trim().toUpperCase() === 'CNA' || /\bcna\b|certified nurs\w* (aide|assistant)/i.test(String(c?.label ?? ''))
const digits10 = (s: unknown) => { const d = String(s ?? '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : '' }
const lowerEmail = (s: unknown) => String(s ?? '').trim().toLowerCase()
/* the application's days and times, as the availability record keeps them ('daytime' is stored as 'afternoon') */
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
export function windowsFrom(prn: { days?: unknown; times?: unknown } | null) {
  const days = Array.isArray(prn?.days) ? prn!.days.map(String).filter((d) => DAYS.includes(d)) : []
  const times = (Array.isArray(prn?.times) ? prn!.times.map(String) : []).map((t) => t === 'daytime' ? 'afternoon' : t)
    .filter((t) => ['morning', 'afternoon', 'evening', 'overnight'].includes(t))
  const w: Record<string, string[]> = {}
  for (const d of DAYS) w[d] = days.includes(d) ? [...times] : []
  return w
}

function axisCreds() {
  let token = ''
  for (const n of ['AXISCARE_API_KEY', 'AXISCARE_TOKEN']) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  return { token, site: /^\d+$/.test(site) ? site : '' }
}
// deno-lint-ignore no-explicit-any
async function ax(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const { token, site } = axisCreds()
  if (!token || !site) return { status: 0, json: { errors: ['AxisCare credentials not set'] } }
  try {
    const r = await fetch(`https://${site}.axiscare.com${path}`, { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json',
      'Content-Type': 'application/json', 'X-AxisCare-Api-Version': AC_VERSION }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: r.status, json: await r.json().catch(() => ({})) }
  } catch (e) { return { status: 0, json: { errors: [String((e as Error).message ?? e)] } } }
}
const ok2 = (s: number) => s >= 200 && s < 300
// deno-lint-ignore no-explicit-any
const errText = (r: { status: number; json: any }) => {
  const e = r.json?.errors; const m = Array.isArray(e) ? e.filter(Boolean).join('; ') : (e && typeof e === 'object' ? Object.values(e).join('; ') : '')
  return (r.status === 403 ? 'AxisCare refused: this connection may not change caregivers' : 'AxisCare answered ' + r.status) + (m ? ' (' + String(m).slice(0, 240) + ')' : '')
}
// deno-lint-ignore no-explicit-any
const cgOf = (r: { json: any }) => r.json?.results?.caregiver ?? r.json?.results
async function vocab() {
  const v = await ax('GET', '/api/classes/caregiver')
  if (!ok2(v.status)) return { error: 'could not read AxisCare\'s caregiver class list: ' + errText(v) }
  const all = rows(v.json?.results?.classes ?? v.json?.results)
  const prn = all.filter(isPrnClass), cna = all.filter(isCnaClass)
  const why = [prn.length !== 1 ? (prn.length ? `AxisCare has ${prn.length} classes that read as PRN Team (${prn.map(lab).join(', ')})` : 'AxisCare has no PRN Team caregiver class yet') : '',
               cna.length !== 1 ? (cna.length ? `AxisCare has ${cna.length} classes that read as CNA (${cna.map(lab).join(', ')})` : 'AxisCare has no CNA caregiver class yet') : ''].filter(Boolean)
  return { prn: prn.length === 1 ? prn[0] : null, cna: cna.length === 1 ? cna[0] : null, why }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  /* The owner's server key may ask one read-only question, for the install proof: do PRN Team and CNA exist in AxisCare?
     Recognised the way the scheduled jobs recognise it (job-auth's ownerCaller): the key the Management API hands out
     is not always character-for-character the one this function holds, so a plain comparison refused it (Desktop 356). */
  if (await ownerCaller(req)) {
    const q = await req.clone().json().catch(() => ({})) as Record<string, unknown>
    if (q.action !== 'vocab') return json({ error: 'the server key may only ask vocab' }, 403)
    const v = await vocab()
    return json('error' in v ? { error: v.error } : { prn: v.prn ? lab(v.prn) : null, cna: v.cna ? lab(v.cna) : null, why: v.why })
  }
  const who = await requireStaff(db, req, OFFICE_ROLES)
  if (!who.ok) return json({ error: who.error }, who.status)
  const by = who.name || who.email
  const b = await req.json().catch(() => ({})) as Record<string, unknown>
  const action = String(b.action ?? '')

  if (action === 'list') {
    const [t, h, sh] = await Promise.all([db.from('pay_tracks').select('*'), db.from('pay_track_history').select('*').order('recorded_at'),
      db.from('prn_shift_log').select('*').order('recorded_at')])
    if (t.error || h.error) return json({ error: 'could not read the pay tracks' }, 500)
    return json({ tracks: t.data ?? [], history: h.data ?? [], shifts: sh.error ? [] : (sh.data ?? []) })
  }

  /* PRN3: confirmed on a shift, or backed out after confirming. Only for someone on the PRN Team now. */
  if (action === 'shift') {
    const cg = typeof b.axiscare_caregiver_id === 'string' || typeof b.axiscare_caregiver_id === 'number' ? String(b.axiscare_caregiver_id).trim() : ''
    const caseId = typeof b.case_id === 'string' ? b.case_id.trim().slice(0, 80) : ''
    const kind = b.kind === 'confirmed' || b.kind === 'backed_out' ? b.kind : ''
    const sd = typeof b.shift_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.shift_date) ? b.shift_date : null
    if (!/^\d+$/.test(cg) || !caseId || !kind) return json({ error: 'which caregiver, which shift, and what happened?' }, 400)
    const { data: t } = await db.from('pay_tracks').select('applicant_id, track').eq('axiscare_caregiver_id', cg).maybeSingle()
    if (!t || t.track !== 'prn_team') return json({ outcome: 'not_prn' })
    const { error } = await db.from('prn_shift_log').insert({ axiscare_caregiver_id: cg, applicant_id: t.applicant_id, case_id: caseId, kind, shift_date: sd, recorded_by: by })
    if (error) return json(/duplicate|unique/i.test(error.message) ? { outcome: 'already' } : { error: 'could not record it: ' + error.message }, /duplicate|unique/i.test(error.message) ? 200 : 500)
    return json({ outcome: 'recorded' })
  }

  const id = typeof b.applicant_id === 'string' && /^[0-9a-f-]{36}$/i.test(b.applicant_id) ? b.applicant_id : ''
  if (!id) return json({ error: 'which applicant?' }, 400)
  const { data: a } = await db.from('job_applicants').select('id, first_name, last_name, phone, email, position, prn').eq('id', id).maybeSingle()
  if (!a) return json({ error: 'no such applicant' }, 404)
  const { data: tr } = await db.from('pay_tracks').select('*').eq('applicant_id', id).maybeSingle()
  const rates = async () => {
    const { data } = await db.from('app_data').select('data').eq('key', 'pay_rates').maybeSingle()
    // deno-lint-ignore no-explicit-any
    const rec = (Array.isArray(data?.data) ? data!.data : []).find((x: any) => x?.id === 'rates')?.rates ?? {}
    const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 && n < 200 ? n : null }
    const { data: role } = await db.from('job_positions').select('pay_min').eq('key', 'prn_cna').maybeSingle()
    return { prn_team: num(rec?.prn_cna?.min) ?? num(role?.pay_min) ?? RATE_FALLBACK.prn_team, ongoing: num(rec?.cna?.min) ?? RATE_FALLBACK.ongoing }
  }
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })

  if (action === 'start') {
    const { data: role } = await db.from('job_positions').select('track').eq('key', a.position ?? '').maybeSingle()
    if (role?.track !== 'prn') return json({ outcome: 'not_prn', detail: 'this applicant did not apply for the PRN CNA Team' })
    if (tr) return json({ outcome: 'already', track: tr })
    const rate = (await rates()).prn_team
    const { data, error } = await db.rpc('pay_track_change', { p_applicant: id, p_from_expected: null, p_to: 'prn_team', p_rate: rate,
      p_effective: today(), p_by: by, p_reason: 'Joined the PRN CNA Team (offer sent)' })
    if (error) return json({ error: 'could not start their pay track: ' + error.message }, 500)
    return json({ outcome: data?.outcome === 'already' ? 'already' : 'started', rate })
  }
  if (!tr) return json({ outcome: 'no_track', detail: 'they are not on a pay track yet (the PRN offer starts it)' })

  if (action === 'link') {
    const cg = typeof b.axiscare_caregiver_id === 'string' || typeof b.axiscare_caregiver_id === 'number' ? String(b.axiscare_caregiver_id).trim() : ''
    if (!/^\d+$/.test(cg)) return json({ error: 'which caregiver?' }, 400)
    if (tr.axiscare_caregiver_id) return json({ outcome: tr.axiscare_caregiver_id === cg ? 'already' : 'linked_elsewhere' })
    const { data: taken } = await db.from('pay_tracks').select('applicant_id').eq('axiscare_caregiver_id', cg).maybeSingle()
    if (taken) return json({ outcome: 'caregiver_taken', detail: 'that caregiver is already linked to another hire' })
    const g = await ax('GET', `/api/caregivers/${cg}`)
    const c = cgOf(g)
    if (!ok2(g.status) || !c) return json({ error: 'could not read the caregiver in AxisCare: ' + errText(g) }, 502)
    const cPhone = digits10(c.mobilePhone ?? c.homePhone), cEmail = lowerEmail(c.personalEmail ?? c.email)
    const matches = (x: { phone?: unknown; email?: unknown }) =>
      (!!cPhone && digits10(x.phone) === cPhone) || (!!cEmail && lowerEmail(x.email) === cEmail)
    if (!matches(a)) return json({ outcome: 'no_match', detail: 'their phone and email in AxisCare do not match this hire, so they are not linked' })
    const { data: others } = await db.from('pay_tracks').select('applicant_id').is('axiscare_caregiver_id', null).neq('applicant_id', id)
    if ((others ?? []).length) {
      const { data: oa } = await db.from('job_applicants').select('phone, email').in('id', (others ?? []).map((o: { applicant_id: string }) => o.applicant_id))
      if ((oa ?? []).some(matches)) return json({ outcome: 'two_match', detail: 'more than one PRN hire matches this caregiver, so nothing is linked; check in AxisCare which one it is' })
    }
    const { error } = await db.from('pay_tracks').update({ axiscare_caregiver_id: cg, linked_at: new Date().toISOString(), linked_by: by, updated_at: new Date().toISOString() })
      .eq('applicant_id', id).is('axiscare_caregiver_id', null)
    if (error) return json({ error: 'could not link: ' + error.message }, 500)
    /* their starting availability, only when they have none */
    let availability = 'kept'
    const { data: avRow } = await db.from('app_data').select('data').eq('key', 'caregiver_availability').maybeSingle()
    // deno-lint-ignore no-explicit-any
    const have = (Array.isArray(avRow?.data) ? avRow!.data : []).some((x: any) => String(x?.id) === cg || String(x?.axiscare_id ?? '') === cg)
    if (!have && a.prn && Array.isArray(a.prn.days) && a.prn.days.length) {
      const item = { id: cg, name: [a.first_name, a.last_name].filter(Boolean).join(' '), axiscare_id: cg, phone_digits: digits10(a.phone) || null,
        target_hours: null, windows: windowsFrom(a.prn), updated_at: new Date().toISOString(), source: 'application' }
      const up = await db.rpc('upsert_app_data_item', { target_key: 'caregiver_availability', item })
      availability = up.error ? 'failed' : 'from_application'
    }
    return json({ outcome: 'linked', availability })
  }

  const cgId = tr.axiscare_caregiver_id ? String(tr.axiscare_caregiver_id) : ''
  const readClasses = async () => {
    const g = await ax('GET', `/api/caregivers/${cgId}`)
    const c = cgOf(g)
    return ok2(g.status) && c ? { ok: true as const, classes: rows(c.classes) } : { ok: false as const, detail: 'could not read the caregiver in AxisCare: ' + errText(g) }
  }
  // deno-lint-ignore no-explicit-any
  const setClasses = async (kind: string, what: string, next: any[], check: (after: any[]) => boolean, before: any[]) => {
    const p = await ax('PATCH', `/api/caregivers/${cgId}`, { classes: next.map(slim) })
    if (!ok2(p.status)) {
      await recordAxisChange(db, { kind, caregiver: cgId, outcome: 'refused', summary: what, detail: errText(p), by })
      return { outcome: 'refused', detail: errText(p) }
    }
    const back = await readClasses()
    const after = back.ok ? back.classes : []
    const keptOk = before.filter((c) => !isPrnClass(c)).every((c) => after.some((x) => lab(x) === lab(c)))   // everything but PRN Team stays, CNA included
    const good = back.ok && check(after) && keptOk
    const recorded = await recordAxisChange(db, { kind, caregiver: cgId, outcome: good ? 'sent_confirmed' : 'sent', summary: what,
      detail: good ? null : 'the read-back did not show it exactly', by })
    return { outcome: good ? 'updated' : 'updated_check', classes: after.map(lab), kept_ok: keptOk, recorded }
  }

  if (action === 'classes') {
    if (!cgId) return json({ outcome: 'not_linked' })
    const [cur, v] = await Promise.all([readClasses(), vocab()])
    if (!cur.ok) return json({ error: cur.detail }, 502)
    return json({ outcome: 'ok', classes: cur.classes.map(lab), has_prn: cur.classes.some(isPrnClass), has_cna: cur.classes.some(isCnaClass),
      ready: 'error' in v ? false : !!(v.prn && v.cna), why: 'error' in v ? [v.error] : v.why })
  }

  if (action === 'mark') {
    if (!cgId) return json({ outcome: 'not_linked', detail: 'link them to their caregiver record first' })
    if (tr.track !== 'prn_team') return json({ outcome: 'not_prn', detail: 'they are an ongoing caregiver now, not on the PRN Team' })
    const v = await vocab()
    if ('error' in v) return json({ outcome: 'refused', detail: v.error })
    if (!v.prn || !v.cna) return json({ outcome: 'classes_missing', detail: v.why.join('; ') + '. Create them in AxisCare (Settings, Classes) and try again.' })
    const cur = await readClasses()
    if (!cur.ok) return json({ outcome: 'refused', detail: cur.detail })
    const add = [v.prn, v.cna].filter((t) => !cur.classes.some((c) => lab(c) === lab(t)))
    if (!add.length) {
      await db.from('pay_tracks').update({ axiscare_marked_at: new Date().toISOString(), axiscare_marked_by: by }).eq('applicant_id', id)
      return json({ outcome: 'already', classes: cur.classes.map(lab) })
    }
    const r = await setClasses('prn_team_classes', 'PRN Team + CNA added', [...cur.classes, ...add],
      (after) => after.some(isPrnClass) && after.some(isCnaClass), cur.classes)
    if (r.outcome === 'updated') await db.from('pay_tracks').update({ axiscare_marked_at: new Date().toISOString(), axiscare_marked_by: by }).eq('applicant_id', id)
    return json(r)
  }

  if (action === 'move') {
    const to = b.to === 'ongoing' || b.to === 'prn_team' ? b.to : ''
    const eff = typeof b.effective_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.effective_date) ? b.effective_date : ''
    const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 300) : ''
    if (!to || !eff || !reason) return json({ outcome: 'incomplete', detail: 'the new track, the effective date and the reason are all needed' })
    const days = Math.round((new Date(eff + 'T12:00:00Z').getTime() - new Date(today() + 'T12:00:00Z').getTime()) / 864e5)
    if (Math.abs(days) > 60) return json({ outcome: 'incomplete', detail: 'the effective date should be within 60 days of today' })
    if (b.from !== tr.track) return json({ outcome: 'changed_meanwhile', detail: 'their track changed since the page was opened; reload and look again' })
    if (tr.track === to) return json({ outcome: 'already', track: tr.track })
    const rate = (await rates())[to as 'prn_team' | 'ongoing']
    const { data, error } = await db.rpc('pay_track_change', { p_applicant: id, p_from_expected: tr.track, p_to: to, p_rate: rate,
      p_effective: eff, p_by: by, p_reason: reason })
    if (error) return json({ outcome: 'refused', detail: /TRACK_CHANGED/.test(error.message) ? 'their track changed since the page was opened; reload and look again' : error.message })
    /* AxisCare follows the track: PRN Team off going to ongoing (CNA stays), back on returning. */
    let axis: Record<string, unknown> = { outcome: 'not_linked' }
    if (cgId) {
      const cur = await readClasses()
      if (!cur.ok) axis = { outcome: 'refused', detail: cur.detail }
      else if (to === 'ongoing') {
        axis = cur.classes.some(isPrnClass)
          ? await setClasses('prn_team_classes', 'PRN Team removed (moved to ongoing)', cur.classes.filter((c) => !isPrnClass(c)), (after) => !after.some(isPrnClass), cur.classes)
          : { outcome: 'already' }
      } else {
        const v = await vocab()
        axis = 'error' in v || !v.prn ? { outcome: 'classes_missing', detail: 'error' in v ? v.error : v.why.join('; ') }
          : cur.classes.some(isPrnClass) ? { outcome: 'already' }
          : await setClasses('prn_team_classes', 'PRN Team added (back on the PRN Team)', [...cur.classes, v.prn], (after) => after.some(isPrnClass), cur.classes)
      }
    }
    return json({ outcome: 'moved', track: data, axiscare: axis })
  }

  return json({ error: "action must be 'list', 'start', 'link', 'classes', 'mark' or 'move'" }, 400)
})
