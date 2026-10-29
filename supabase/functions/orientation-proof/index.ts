// =============================================================================
// orientation-proof — "no caregiver is approved to work without verified orientation, while recognizing legitimate
// historical training records" (Samantha 2026-10-28). Rules: _shared/orientation-proof.ts; certificate:
// _shared/orientation-certificate.ts; the Training Platform door: _shared/training-orientation.ts.
// =============================================================================
// Office staff (owner_admin, care_coordinator, staffing_coordinator), from their own Hub sign-in:
//   list            everyone AxisCare says is Active (read straight from AxisCare), each with their orientation status,
//                   minus the left-out list: the cleanup list and the profile line. Reads only.
//   status          {axiscare_id}: one caregiver's orientation status (the profile's Orientation & Training section).
//   make_certificate {axiscare_id}: a person pressed "Make certificate": made ONLY from a finished Training Platform
//                   completion, with its ORIGINAL date, stored where the Training Platform keeps its own, put on the
//                   caregiver's record. Never for anything not finished; never overwrites a certificate already there.
//   verify_record   {axiscare_id, date, document, attest}: a person looked at a historical completion document they
//                   uploaded (the Hub's lead-docs storage, training/<id>/orient-...) and confirms it shows orientation was
//                   completed on that date. Saved on the caregiver's record with who and when. No retraining needed.
//   send_link       {axiscare_id}: a person pressed "Send orientation link": orientation assigned on the Training Platform if
//                   they have none (never resets one started), then the Training Platform texts and emails their personal link.
//   open            {ref}: a short-lived link to a Training Platform certificate or completion document.
// The schedule (the jobs' secret) or the owner's key:
//   audit           every morning: the same list, then (orientation_audit_live) one Needs Attention card per flagged caregiver
//                   for the Training & Compliance owner, closed once they are verified, and (orientation_cert_autogen_live)
//                   the missing certificates made from real completions. Off = practice: counted in the automation log.
//                   ?dry=1 is always practice. Nobody is ever deactivated: the office decides.
// The checklist gate itself lives in the onboarding readiness (caregiver-journey, switch orientation_gate_live).
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { jobCaller } from '../_shared/job-auth.ts'
import { opEvent } from '../_shared/events.ts'
import { readCensus } from '../_shared/axis-census.ts'
import { saveAuditFields } from '../_shared/sweep-patch.ts'
import { orientationStatus, auditList, checkVerify, DEFAULT_EXCLUDE, PRE_AXISCARE_BEFORE, PRE_AXISCARE_BY } from '../_shared/orientation-proof.ts'
import { mayGenerate, certificatePdf } from '../_shared/orientation-certificate.ts'
import { readOrientation, storeCertificate, signedLink, certPath, sendOrientationLink } from '../_shared/training-orientation.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
// deno-lint-ignore no-explicit-any
type Any = any
const S = (v: unknown, n = 200) => String(v ?? '').trim().slice(0, n)
const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '')
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
// deno-lint-ignore no-explicit-any
async function readKey(db: any, key: string): Promise<Any> { const { data } = await db.from('app_data').select('data').eq('key', key).maybeSingle(); return data?.data ?? null }
const list = (v: Any): Any[] => Array.isArray(v) ? v : []

// deno-lint-ignore no-explicit-any
async function gather(db: any) {
  const st = (await readKey(db, 'ops_settings')) || {}
  const exclude: string[] = Array.isArray(st.orientation_audit_exclude) ? st.orientation_audit_exclude.map((x: unknown) => digits(x)).filter(Boolean) : DEFAULT_EXCLUDE
  const c = await readCensus()
  if (!c.ok) return { ok: false as const, why: 'AxisCare could not be read: ' + c.error }
  const roster = list(await readKey(db, 'caregivers'))
  const rosterByAx = new Map<string, Any>(); for (const r of roster) if (digits(r?.axiscare_id)) rosterByAx.set(digits(r.axiscare_id), r)
  /* a certificate listing only for those finished on the platform without a document (the rest don't need it) */
  const t = await readOrientation(fetch, (x) => x.status === 'complete' && !!x.completed_at && !x.completion_doc_path)
  if (!t.ok) return { ok: false as const, why: t.why }
  const pre = { before: S(st.orientation_pre_axiscare_before, 10) || PRE_AXISCARE_BEFORE, by: S(st.orientation_pre_axiscare_by, 120) || PRE_AXISCARE_BY }
  const a = auditList(c.rows, rosterByAx, t.byAx, exclude, pre)
  return { ok: true as const, st, exclude, pre, census: c.rows, rosterByAx, tByAx: t.byAx, ...a }
}
// deno-lint-ignore no-explicit-any
async function makeCertificate(db: any, ax: string, t: Any, roster: Any, by: string): Promise<{ ok: boolean; why: string | null; ref?: string }> {
  const may = mayGenerate(t); if (!may.ok) return { ok: false, why: may.why }
  if (t.certificate) return { ok: true, why: null, ref: 'training:' + certPath(t.training_id) }
  const name = S(t.name, 80) || [roster?.first, roster?.last].filter(Boolean).join(' ') || 'Caregiver'
  const bytes = await certificatePdf(name, S(t.completed_at, 10), today())
  const s = await storeCertificate(t.training_id, bytes); if (!s.ok) return { ok: false, why: s.why }
  const ref = 'training:' + certPath(t.training_id)
  if (roster) await saveAuditFields(db, { ...roster, orient_date: roster.orient_date || S(t.completed_at, 10), orient_proof: ref }, (fresh: Any) => { fresh.orient_proof = ref; if (!fresh.orient_date) fresh.orient_date = S(t.completed_at, 10) })
  await opEvent(db, { verb: 'orientation_certificate_made', actor_name: by, actor_email: '', item_id: ax, area: 'caregivers',
    summary: `Orientation certificate made for ${name} from the Training Platform completion of ${S(t.completed_at, 10)}`, data: { training_id: t.training_id, completed_on: S(t.completed_at, 10), made_by: by } })
  return { ok: true, why: null, ref }
}
// deno-lint-ignore no-explicit-any
async function opsList(db: any): Promise<Any[]> { return list(await readKey(db, 'ops_items')) }
// deno-lint-ignore no-explicit-any
async function raiseCard(db: any, c: { id: string; title: string; detail: string; who: string; ax: string; owner: string; owner_name: string }): Promise<'raised' | 'open' | 'closed' | 'failed'> {
  try {
    const prev = (await opsList(db)).find((x) => x && x.id === c.id)
    if (prev && prev.status !== 'done' && prev.status !== 'resolved') return 'open'
    if (prev && prev.close_reason !== 'Orientation verified') return 'closed'   /* a person closed it: stays closed */
    const now = new Date().toISOString()
    const { error } = await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { id: c.id, kind: 'orientation_proof', domain: 'training_compliance', status: 'open', urgency: 'today',
      title: c.title, detail: c.detail, who: c.who, caregiver_ax: c.ax, owner: c.owner, owner_name: c.owner_name, created_at: now, first_at: now, last_at: now,
      due: new Date(Date.now() + 3 * 86_400_000).toISOString(), closed_at: null, closed_by: null, close_note: null, resolved_at: null, created_by: 'orientation-proof', opened_by: 'orientation-proof' } })
    return error ? 'failed' : 'raised'
  } catch { return 'failed' }
}
// deno-lint-ignore no-explicit-any
async function closeCard(db: any, id: string): Promise<boolean> {
  try {
    const prev = (await opsList(db)).find((x) => x && x.id === id)
    if (!prev || prev.status === 'done' || prev.status === 'resolved') return false
    const now = new Date().toISOString()
    const { error } = await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { ...prev, status: 'done', closed_at: now, closed_by: 'orientation-proof', close_reason: 'Orientation verified', last_activity_at: now } })
    return !error
  } catch { return false }
}
// deno-lint-ignore no-explicit-any
async function trainingOwner(db: any): Promise<{ email: string; name: string }> {
  try {
    const { data: dom } = await db.from('domains').select('owner_person').eq('entity', 'cc_ihs').eq('code', 'training_compliance').maybeSingle()
    if (!dom?.owner_person) return { email: '', name: '' }
    const { data: p } = await db.from('persons').select('full_name, primary_email').eq('person_id', dom.owner_person).maybeSingle()
    return { email: S(p?.primary_email, 160).toLowerCase(), name: S(p?.full_name, 120) }
  } catch { return { email: '', name: '' } }
}
const CARD_NEXT: Record<string, string> = {
  missing: 'Send them the orientation link, or verify a past record if they did orientation another way.',
  in_progress: 'They have started orientation; a nudge to finish it. The card closes when they do.',
  needs_certificate: 'Make the certificate from their Training Platform completion (the original date is kept).',
  needs_document: 'Verify a past record: upload the completion document and confirm it.',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const q = new URL(req.url).searchParams

  if (q.get('audit') === '1') {
    const caller = await jobCaller(req)
    if (!caller) return json({ error: 'not allowed' }, 401)
    if (q.get('auth_check') === '1') return json({ ok: true, caller })
    const g = await gather(db)
    if (!g.ok) return json({ ok: false, error: g.why })
    const dry = q.get('dry') === '1', cardsLive = g.st.orientation_audit_live === true && !dry, makeLive = g.st.orientation_cert_autogen_live === true && !dry
    const out = { ok: true, checked: g.checked, verified: g.verified, excluded: g.excluded, flagged: g.flagged.length, cards_live: cardsLive, autogen_live: makeLive,
      would_card: g.flagged.length, carded: 0, closed: 0, could_make: g.flagged.filter((x: Any) => x.can_make_certificate).length, made: 0, problems: [] as string[],
      list: g.flagged.map((x: Any) => ({ axiscare_id: x.axiscare_id, name: x.name, state: x.state, why: x.why, date: x.date })) }
    if (makeLive) for (const x of g.flagged.filter((x: Any) => x.can_make_certificate)) {
      const r = await makeCertificate(db, x.axiscare_id, g.tByAx.get(x.axiscare_id), g.rosterByAx.get(x.axiscare_id), 'The Hub (made from the completion record)')
      if (r.ok) out.made++; else out.problems.push(`${x.name}: ${r.why}`)
    }
    if (cardsLive) {
      const owner = await trainingOwner(db)
      const flaggedIds = new Set(g.flagged.map((x: Any) => x.axiscare_id))
      for (const x of g.flagged) {
        if (out.made && x.can_make_certificate && !out.problems.some((p) => p.startsWith(x.name + ':'))) continue
        const r = await raiseCard(db, { id: 'orient_' + x.axiscare_id, ax: x.axiscare_id, who: x.name, owner: owner.email, owner_name: owner.name,
          title: `${x.name} is Active in AxisCare without verified orientation`, detail: `${x.why}. ${CARD_NEXT[x.state] || ''} Nobody is deactivated automatically; if they shouldn't be working yet, set them back to In Training in AxisCare.` })
        if (r === 'raised') out.carded++
      }
      for (const it of (await opsList(db)).filter((x) => x?.kind === 'orientation_proof' && x.status !== 'done' && x.status !== 'resolved'))
        if (!flaggedIds.has(S(it.caregiver_ax, 20)) && await closeCard(db, it.id)) out.closed++
    }
    try { await db.rpc('upsert_app_data_item', { target_key: 'automation_log', item: { id: 'auto_srv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), at: new Date().toISOString(),
      automation: 'orientation-proof:audit', ran_by: caller === 'cron' ? 'schedule' : 'owner', ok: !out.problems.length, dry: !cardsLive, rows_seen: out.checked, candidates: out.flagged, created: out.carded } }) } catch { /* never blocks */ }
    return json(out)
  }

  const who = await requireStaff(db, req, OFFICE_ROLES)
  if (!who.ok) return json({ error: who.error }, who.status)
  let b: Any = {}
  try { b = await req.json() } catch { b = {} }
  const action = S(b?.action, 40)

  if (action === 'open') {
    const ref = S(b?.ref, 400)
    if (!ref.startsWith('training:')) return json({ error: 'Not a Training Platform document.' }, 400)
    const url = await signedLink(ref); if (!url) return json({ error: 'That document could not be opened.' }, 404)
    return json({ url })
  }

  if (action === 'list' || action === 'status') {
    const g = await gather(db)
    if (!g.ok) return json({ error: g.why }, 502)
    const settings = { gate: g.st.orientation_gate_live === true, audit: g.st.orientation_audit_live === true, autogen: g.st.orientation_cert_autogen_live === true }
    if (action === 'list') return json({ ok: true, checked: g.checked, verified: g.verified, excluded: g.excluded, exclude: g.exclude, pre: g.pre, flagged: g.flagged, settings })
    const ax = digits(b?.axiscare_id); if (!ax) return json({ error: 'Which caregiver?' }, 400)
    const axRow = g.census.find((x: Any) => S(x.id, 20) === ax)
    const ros = g.rosterByAx.get(ax) || null
    const st = orientationStatus(ros, g.tByAx.get(ax) || null, { ...g.pre, hire_date: S(axRow?.hire_date, 10) || S(ros?.hire_date, 10) })
    return json({ ok: true, axiscare_id: ax, ...st, axiscare: axRow ? { active: axRow.active, status_label: axRow.status_label } : null, excluded: g.exclude.includes(ax), settings })
  }

  if (action === 'make_certificate') {
    const ax = digits(b?.axiscare_id); if (!ax) return json({ error: 'Which caregiver?' }, 400)
    const t = await readOrientation(fetch, () => true)
    if (!t.ok) return json({ error: t.why }, 502)
    const row = t.byAx.get(ax); if (!row) return json({ error: 'This caregiver is not on the Training Platform.' }, 404)
    const roster = list(await readKey(db, 'caregivers')).find((r: Any) => digits(r?.axiscare_id) === ax) || null
    const r = await makeCertificate(db, ax, row, roster, who.name || who.email)
    if (!r.ok) return json({ outcome: 'not_made', error: 'No certificate was made: ' + r.why + '.' }, 422)
    return json({ outcome: 'made', ref: r.ref })
  }

  if (action === 'send_link') {
    const ax = digits(b?.axiscare_id); if (!ax) return json({ error: 'Which caregiver?' }, 400)
    const t = await readOrientation(fetch, () => false)
    if (!t.ok) return json({ error: t.why }, 502)
    const row = t.byAx.get(ax); if (!row) return json({ error: 'This caregiver is not on the Training Platform yet (it picks up AxisCare caregivers each night).' }, 404)
    const r = await sendOrientationLink(row.training_id)
    if (!r.ok) return json({ outcome: 'not_sent', error: 'Not sent: ' + r.why + '.' }, 422)
    await opEvent(db, { verb: 'orientation_link_sent', actor_name: who.name, actor_email: who.email, item_id: ax, area: 'caregivers',
      summary: `${who.name} sent ${row.name || 'a caregiver'} their orientation link` + (r.assigned ? ' (orientation assigned)' : ''), data: r.result })
    return json({ outcome: 'sent', assigned: r.assigned, ...r.result })
  }

  if (action === 'verify_record') {
    const ax = digits(b?.axiscare_id); if (!ax) return json({ error: 'Which caregiver?' }, 400)
    const v = checkVerify(b, today()); if (!v.ok) return json({ error: v.why }, 400)
    const doc = S(b.document, 400)
    if (!/^training\/[\w-]+\/orient-[\w.-]+$/.test(doc)) return json({ error: 'Upload the document through the Hub first.' }, 400)
    const roster = list(await readKey(db, 'caregivers')).find((r: Any) => digits(r?.axiscare_id) === ax)
    if (!roster) return json({ error: 'No Hub caregiver record has that AxisCare number.' }, 404)
    const ver = { date: S(b.date, 10), document: doc, by: who.name || who.email, by_email: who.email, at: new Date().toISOString(), kind: 'historical', note: S(b.note, 300) || null }
    const saved = await saveAuditFields(db, { ...roster, orient_date: roster.orient_date || ver.date, orient_proof: doc, orient_verified: ver },
      (fresh: Any) => { fresh.orient_verified = ver; fresh.orient_proof = doc; if (!fresh.orient_date) fresh.orient_date = ver.date })
    if (saved !== 'saved') return json({ error: 'The record could not be saved (' + saved + '). Try again.' }, 409)
    await opEvent(db, { verb: 'orientation_record_verified', actor_name: who.name, actor_email: who.email, item_id: ax, area: 'caregivers',
      summary: `${who.name} verified ${[roster.first, roster.last].filter(Boolean).join(' ')}'s historical orientation record (${ver.date})`, data: ver })
    await closeCard(db, 'orient_' + ax)
    return json({ outcome: 'verified', verified: ver })
  }

  return json({ error: 'unknown action' }, 400)
})
