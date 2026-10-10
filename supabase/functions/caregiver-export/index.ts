// =============================================================================
// caregiver-export · SLICE 6 (Samantha "yes to all", 2026-10-10; decision 10): the read-only personnel-file export.
// =============================================================================
// { action: 'export', offer_id | journey_id | caregiver_id }   (staff on the Audit export list, or an owner)
//   A PDF of the person's requirement record: for a readiness card, every requirement with status, who verified, when,
//   evidence and expiry, then the full permanent history; for a roster record without a card (everyone hired before the
//   switch), the same layout from the record's dates, proofs, status overrides and eligibility history. Plus five-minute
//   links to each proof file (Hub store, or the Training Platform's certificate). The PDF goes to the private
//   onboarding-documents bucket (exports/...), never overwritten, and comes back as a five-minute link.
//   EVERY export and every proof link is a row in document_access_log (doc 'export' / 'export-proof', with the reason).
//   Nothing is changed; no identity value is ever printed (the sealed Step 1 fields stay sealed).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { PERM_KEY, normalizePerms, mayApprove } from '../_shared/onboarding-permissions.ts'
import { R, facts } from '../_shared/caregiver-journey.ts'
import { BrandPdf, COMPANY_RIGHT, FOOTER, NAVY, MUTED, RULE } from '../_shared/brand-pdf.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
// deno-lint-ignore no-explicit-any
type Any = any
const S = (v: unknown, n = 160) => String(v ?? '').trim().slice(0, n)
const BUCKET = 'onboarding-documents', LINK_SECONDS = 300
const central = (iso: unknown) => iso ? new Date(String(iso)).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''
const dayOf = (v: unknown) => v ? String(v).slice(0, 10) : ''
/* a proof reference → where it lives */
function proofWhere(p: unknown): { kind: 'hub' | 'training' | 'link' | 'none'; path: string } {
  const s = S(p, 400); if (!s) return { kind: 'none', path: '' }
  if (/^training:/.test(s)) return { kind: 'training', path: s.slice('training:'.length) }
  if (/^https?:\/\//.test(s)) return { kind: 'link', path: s }
  return { kind: 'hub', path: s }
}
async function trainingSigned(path: string): Promise<string | null> {
  const url = (Deno.env.get('OFFERS_PROJECT_URL') ?? '').replace(/\/$/, ''), key = Deno.env.get('OFFERS_SERVICE_ROLE_KEY') ?? ''
  if (!url || !key) return null
  try {
    const r = await fetch(`${url}/storage/v1/object/sign/waiver-docs/${path}`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: LINK_SECONDS }) })
    const j = r.ok ? await r.json() : null
    return j?.signedURL ? `${url}/storage/v1${j.signedURL}` : null
  } catch { return null }
}
const ROSTER_ROWS: Array<[string, string, string, string | null, string | null]> = [
  /* title, date field, proof field, status override field, interval words */
  ['Agency orientation (employment start by policy)', 'orient_date', 'orient_proof', null, null],
  ["Alzheimer's and dementia training", 'alz_date', 'alz_proof', null, null],
  ['OJT in-home part (signed)', 'ojt_date', 'ojt_proof', null, null],
  ['OJT online part', 'ojt_online', 'ojt_online_proof', null, null],
  ['Annual in-service training', 'annual_date', 'annual_proof', null, 'yearly after year one; 5 hours'],
  ['Code of Ethics signed', 'ethics_date', 'ethics_proof', null, null],
  ['Participant Rights signed', 'rights_date', 'rights_proof', null, null],
  ['OIG exclusion check (LEIE)', 'oig_date', 'oig_proof', 'oig_status', 'monthly (agency policy)'],
  ['Employee Disqualification List check', 'edl_date', 'edl_proof', 'edl_status', 'monthly (agency policy)'],
  ['Family Care Safety Registry check', 'fcsr_date', 'fcsr_proof', 'fcsr_status', 'yearly'],
  ['FCSR registration', 'fcsr_reg_date', 'fcsr_reg_proof', null, null],
  ['Fingerprint background check', 'fp_date', 'fp_proof', 'fp', null],
  ['Supervisory visit', 'supv_date', 'supv_proof', null, 'yearly (management)'],
  ['Performance review', 'perf_date', 'perf_proof', null, 'yearly (management)'],
  ['CNA credential expiry', 'cna_expires', 'cna_proof', null, 'typed by the office with proof'],
  ["Driver's license expiry", 'dl_expires', 'dl_proof', null, 'typed by the office with proof'],
  ['Auto insurance expiry', 'auto_ins_expires', 'auto_ins_proof', null, 'typed by the office with proof'],
]

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false, autoRefreshToken: false } })
  const b: Any = await req.json().catch(() => ({}))
  try {
    const who = await requireStaff(db, req, OFFICE_ROLES)
    if (!who.ok) return json({ error: who.error }, who.status)
    const { data: pr } = await db.from('app_data').select('data').eq('key', PERM_KEY).maybeSingle()
    if (!mayApprove(normalizePerms(pr?.data), 'audit_export', { person_id: who.person_id, roles: who.roles || [], email: who.email })) return json({ error: 'Only an owner or a person on the Audit export list (Admin page) may export a personnel file.' }, 403)
    const action = S(b.action, 20) || 'export'
    if (action !== 'export') return json({ error: 'Unknown action.' }, 400)
    const reason = S(b.reason, 200) || 'audit export'
    const now = new Date().toISOString(), ip = req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || ''
    const { data: rosterRow } = await db.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()
    const roster: Any[] = Array.isArray(rosterRow?.data) ? rosterRow.data : []
    /* who: a readiness card (by offer or journey) or a roster record (by caregiver id) */
    let j: Any = null, steps: Any[] = [], rec: Any = null
    if (b.journey_id || b.offer_id) {
      let q = db.from('client_journey').select('*').eq('subject', 'caregiver'); q = b.journey_id ? q.eq('journey_id', S(b.journey_id, 64)) : q.eq('offer_id', S(b.offer_id, 64))
      const { data } = await q.maybeSingle(); j = data
      if (!j) return json({ error: 'That readiness card was not found.' }, 404)
      const { data: st } = await db.from('client_journey_step').select('*').eq('journey_id', j.journey_id); steps = st ?? []
      rec = roster.find((c) => String(c?.offer_id ?? '') === String(j.offer_id)) || null
    } else {
      rec = roster.find((c) => String(c?.id) === S(b.caregiver_id, 40)) || null
      if (!rec) return json({ error: 'That caregiver record was not found.' }, 404)
      if (rec.offer_id) { const { data } = await db.from('client_journey').select('*').eq('subject', 'caregiver').eq('offer_id', String(rec.offer_id)).maybeSingle(); if (data) { j = data; const { data: st } = await db.from('client_journey_step').select('*').eq('journey_id', j.journey_id); steps = st ?? [] } }
    }
    const name = j ? String(j.client_name) : `${rec.first || ''} ${rec.last || ''}`.trim()
    const subjectId = j ? String(j.offer_id) : 'caregiver:' + String(rec.id)
    const proofs: Array<{ label: string; ref: string }> = []
    /* ── the PDF ── */
    const pdf = new BrandPdf(`Personnel file - ${name}`); pdf.footer(FOOTER)
    pdf.headerFn = (p, f) => p.letterhead(COMPANY_RIGHT, f); pdf.letterhead(COMPANY_RIGHT, true)
    pdf.para('Caregiver personnel file (read-only export)', { font: 'B', size: 18, color: NAVY, lh: 23, after: 2 })
    pdf.para(`${name} · exported ${central(now)} Central by ${who.name || who.email} · reason: ${reason}`, { size: 8.5, color: MUTED, after: 2 })
    pdf.para('Every line comes from the Hub records as they stand now. Nothing here was typed for this export. Identity details (Social Security number, date of birth, license number) are sealed and never printed. Proof files are listed by reference; the links that came with this export open for five minutes and every open is logged.', { size: 8.5, color: MUTED, after: 8 })
    if (rec) {
      pdf.heading('Record')
      pdf.labelled('Hire date (AxisCare):', dayOf(rec.hire_date) || 'none', { after: 2 })
      pdf.labelled('AxisCare number:', S(rec.axiscare_id) || 'none', { after: 2 })
      pdf.labelled('Approved to Work:', rec.approved_to_work_at ? `${central(rec.approved_to_work_at)} by ${S(rec.approved_to_work_by)}` : (j ? 'see the readiness card below' : 'before the readiness card (hired on the earlier path)'), { after: 2 })
      pdf.labelled('AxisCare status (last read):', rec.axiscare_status_label ? `${S(rec.axiscare_status_label)} · ${central(rec.axiscare_status_at)}` : 'not read by the Hub', { after: 2 })
      pdf.labelled('Eligibility (last sweep):', rec.eligibility_state ? `${S(rec.eligibility_state)} · ${central(rec.eligibility_at)} · ${S(rec.eligibility_reason, 300)}` : 'not yet evaluated by the sweep', { after: 6 })
    }
    if (j) {
      const f = await facts(db, j, null)
      const { data: dfRows } = await db.from('client_journey_step_def').select('key, def, active').like('key', 'cg.%')
      const dfs = (dfRows ?? []).filter((d: Any) => d.active !== false).map((d: Any) => ({ key: d.key, ...(d.def || {}) }))
      const ctx = { today: now.slice(0, 10), facts: { lived_outside_mo: f.lived_outside_mo, claims_cna_or_hha: f.claims_cna_or_hha, drives_clients: f.drives_clients, after_first_year: f.after_first_year }, staffing_email: null, owner_emails: [] }
      const view = R.compute(dfs, j, steps, ctx)
      const aw = (view.rows || []).find((r: Any) => r.key === 'cg.approve.work'), ax = (view.rows || []).find((r: Any) => r.key === 'cg.axiscare.active')
      pdf.heading('Readiness card')
      pdf.labelled('Card started:', central(j.created_at) + ' (both offer documents signed)', { after: 2 })
      pdf.labelled('Approved to Work:', aw?.st?.state === 'complete' ? `${central(aw.st.completed_at)} by ${S(aw.st.completed_by_name || aw.st.completed_by)}` : 'not yet', { after: 2 })
      pdf.labelled('AxisCare Active read back:', ax?.st?.state === 'complete' ? central(ax.st.completed_at) : (ax?.st?.state === 'blocked' ? S(ax.st.blocked_reason, 200) : 'not yet'), { after: 6 })
      for (const stage of view.rail || []) {
        const rows = (view.rows || []).filter((r: Any) => r.def.stage === stage.key); if (!rows.length) continue
        pdf.heading(String(stage.label).toUpperCase())
        for (const r of rows) {
          const st = r.st || {}, ev = st.evidence || {}
          const status = r.expired ? `EXPIRED ${r.expired}` : String(r.status).toUpperCase()
          pdf.para(`${r.def.title}${r.def.required === false ? ' (optional)' : ''}`, { font: 'B', size: 9.5, lh: 13, after: 1 })
          const bits = [status, st.completed_at ? `completed ${central(st.completed_at)}` : '', st.completed_by_name || st.completed_by ? `by ${S(st.completed_by_name || st.completed_by)}` : '', ev.result ? `result: ${S(ev.result, 80)}` : '', ev.expires ? `expires ${S(ev.expires, 10)}` : '', ev.source ? S(ev.source, 80) : '', st.blocked_reason ? `blocked: ${S(st.blocked_reason, 200)}` : '', st.exception?.reason ? `owner exception: ${S(st.exception.reason, 200)}` : '', r.due ? `due ${r.due}` : ''].filter(Boolean)
          pdf.para(bits.join(' · '), { size: 8.5, color: MUTED, lh: 12, after: 1 })
          const doc = ev.document || ev.leie ? S(ev.document || '', 300) : ''
          if (doc) { pdf.para(`proof: ${doc}`, { size: 8, color: MUTED, lh: 11, after: 1 }); proofs.push({ label: r.def.title, ref: doc }) }
          pdf.y -= 3
        }
      }
      const { data: evs } = await db.from('client_journey_event').select('*').eq('journey_id', j.journey_id).order('at', { ascending: true }).limit(400)
      pdf.hr(RULE, 8); pdf.heading('History (permanent, in order)')
      for (const e of evs ?? []) pdf.para(`${central(e.at)} · ${e.kind}${e.step_key ? ' · ' + e.step_key : ''} · ${S(e.actor_name || e.actor_email, 60)}${e.reason ? ' · "' + S(e.reason, 160) + '"' : ''}`, { size: 8, color: MUTED, lh: 11, after: 1 })
    }
    if (rec) {
      pdf.hr(RULE, 8); pdf.heading(j ? 'Roster record (dates and proofs)' : 'Requirements on the record')
      for (const [title, dateF, proofF, statusF, interval] of ROSTER_ROWS) {
        const d = rec[dateF], p = rec[proofF], ov = statusF ? rec[statusF] : ''
        if (!d && !p && !ov) continue
        pdf.para(title, { font: 'B', size: 9.5, lh: 13, after: 1 })
        pdf.para([d ? `date ${dayOf(d)}` : 'no date', ov ? `status: ${S(ov)}` : '', interval || ''].filter(Boolean).join(' · '), { size: 8.5, color: MUTED, lh: 12, after: 1 })
        if (p) { pdf.para(`proof: ${S(p, 300)}`, { size: 8, color: MUTED, lh: 11, after: 1 }); proofs.push({ label: title, ref: S(p, 400) }) }
        if (dateF === 'oig_date' && rec.oig_evidence) pdf.para(`evidence: ${S(rec.oig_evidence.source, 60)} · checked ${central(rec.oig_evidence.checked_at)} · ${Number(rec.oig_evidence.match_count || 0)} match(es) · ${rec.oig_evidence.clear ? 'clear' : 'NOT clear'}`, { size: 8, color: MUTED, lh: 11, after: 1 })
        pdf.y -= 3
      }
      if (Array.isArray(rec.eligibility_history) && rec.eligibility_history.length) {
        pdf.hr(RULE, 8); pdf.heading('Eligibility history (the sweep)')
        for (const h of rec.eligibility_history.slice(-100)) pdf.para(`${central(h.at)} · ${S(h.event || h.state, 40)} · ${S(h.reason, 200)}`, { size: 8, color: MUTED, lh: 11, after: 1 })
      }
    }
    const bytes = pdf.build()
    const path = `exports/${subjectId.replace(/[^a-zA-Z0-9:_-]/g, '_')}/${now.replace(/[:.]/g, '-')}.pdf`
    const up = await db.storage.from(BUCKET).upload(path, bytes, { contentType: 'application/pdf', upsert: false })
    if (up.error) return json({ error: 'The export could not be stored: ' + up.error.message }, 500)
    const { data: su } = await db.storage.from(BUCKET).createSignedUrl(path, LINK_SECONDS)
    const logs: Any[] = [{ at: now, offer_id: subjectId, doc: 'export', path, by_person: who.person_id, by_email: who.email, by_name: who.name, ip, reason }]
    /* the proof links: five minutes each, every one logged */
    const links: Array<{ label: string; url: string | null; ref: string }> = []
    const seen = new Set<string>()
    for (const p of proofs) {
      if (seen.has(p.ref)) continue; seen.add(p.ref)
      const w = proofWhere(p.ref); let url: string | null = null
      if (w.kind === 'hub') { const { data } = await db.storage.from('lead-docs').createSignedUrl(w.path, LINK_SECONDS); url = data?.signedUrl ?? null }
      else if (w.kind === 'training') url = await trainingSigned(w.path)
      else if (w.kind === 'link') url = w.path
      links.push({ label: p.label, url, ref: p.ref })
      if (url && w.kind !== 'link') logs.push({ at: now, offer_id: subjectId, doc: 'export-proof', path: w.path, by_person: who.person_id, by_email: who.email, by_name: who.name, ip, reason })
    }
    const { error: le } = await db.from('document_access_log').insert(logs)
    if (le) return json({ error: 'The export was built but could not be logged, so it was not released: ' + le.message }, 500)
    return json({ ok: true, name, url: su?.signedUrl ?? null, path, expires_in: LINK_SECONDS, proofs: links, logged: logs.length })
  } catch (e) {
    return json({ error: 'Something went wrong: ' + ((e as Error).message || 'error') + '. Nothing was changed.' }, 500)
  }
})
