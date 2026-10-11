// =============================================================================
// client-audit · SLICE 8 (Samantha "GO" / "YES TO ALL", 2026-10-11): continuous audit readiness for clients.
// =============================================================================
//   { action: 'nightly' }  (job)  the client pass, behind client_audit_live (off = practice: counts in the automation log, no card):
//        · the IHS / ADW 10-day start clock (the same ihs-rules.js the Payer tab runs, approved by fingerprint): due soon, due
//          today, overdue, or started late with no written justification recorded
//        · the plan ending within 60 days (DSDS reassessment), and an authorization past its end while AxisCare still has the
//          client Active (no newer plan uploaded)
//        · a care plan change request stalled at a step (recommended or approved two business days, submitted thirty days)
//        · a plan received a business day ago with nobody recording that it was checked against Fusion, or with no PDF kept
//        Every card belongs to the owner of Payer Programs (Admin, by domain), else the Staffing Coordinator; one card per
//        thing (stable id); closed when the state moves on. Nothing is sent and nothing changes in Fusion or AxisCare.
//   { action: 'upload_url', kind: 'careplan'|'late'|'grievance', ref, name }  (staff)  a private upload slot for the proof: the
//        care plan PDF (careplan/<plan id>/), the late-start justification copy (late/<plan id>/), the grievance written
//        answer (grievance/<issue id>/), in the client-journey-files bucket. The caller stores the returned path on its record.
//   { action: 'file_url', path, ax?, lead_id? }  (staff)  a five-minute link to one of those files; logged.
//   { action: 'lead_doc_url', lead_id, path }  (staff)  a five-minute link to an inquiry document (lead-docs); logged.
//   { action: 'export', axiscare_client_id | lead_id, as_of?, reason }  (owners + the Audit export list)  the read-only client
//        audit PDF: the client journey with evidence and history, the Medicaid plans with who confirmed them and who checked
//        them against Fusion, the start clock and the start checks, change requests, authorized against delivered by month
//        with the signed reviews, GHE months, grievances with their answers, care changes and pauses, the launch evidence.
//        With as_of (YYYY-MM-DD): what the records said at the end of that day (journey events up to then, plans received by
//        then, months up to then, grievance states as of then). Five-minute links to each proof; every export and proof link
//        is a row in document_access_log, and an export that cannot be logged is not released.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { jobCaller } from '../_shared/job-auth.ts'
import { PERM_KEY, normalizePerms, mayApprove } from '../_shared/onboarding-permissions.ts'
import { approvedRules } from '../_shared/approved-rules.ts'
import { ax } from '../_shared/axiscare-caregiver.ts'
import { dueNextBusinessDay, centralYmd } from '../_shared/business-days.ts'
import { logOpen, clientSubject, ipOf } from '../_shared/doc-log.ts'
import { BrandPdf, COMPANY_RIGHT, FOOTER, NAVY, MUTED, RULE } from '../_shared/brand-pdf.ts'
import { evidenceRows, evidenceLine, EVIDENCE_NOTE } from '../_shared/evidence.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
// deno-lint-ignore no-explicit-any
type Any = any
const S = (v: unknown, n = 160) => String(v ?? '').trim().slice(0, n)
const BUCKET = 'client-journey-files', LINK_SECONDS = 300
const ymd = (v: unknown) => String(v ?? '').slice(0, 10)
const isYmd = (v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(ymd(v))
const central = (iso: unknown) => iso ? new Date(String(iso)).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''
const usd = (d: unknown) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d ?? '')); return m ? `${m[2]}/${m[3]}/${m[1]}` : String(d ?? '') }
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5)

async function list(db: Any, key: string): Promise<Any[]> { const { data } = await db.from('app_data').select('data').eq('key', key).maybeSingle(); return Array.isArray(data?.data) ? data.data : [] }
async function settings(db: Any) { const { data } = await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle(); return (data?.data && typeof data.data === 'object') ? data.data : {} }
const clientKey = (p: Any) => p.axiscare_client_id ? 'A' + String(p.axiscare_client_id) : 'L' + String(p.lead_id || '')
/** the plan that counts for each client: the latest by end date, then by the Fusion generated date (the Payer tab's order) */
export function currentPlans(plans: Any[]): Map<string, { cur: Any; all: Any[] }> {
  const by = new Map<string, Any[]>()
  for (const p of plans) if (p && p.kind === 'plan' && (p.axiscare_client_id || p.lead_id)) { const k = clientKey(p); if (!by.has(k)) by.set(k, []); by.get(k)!.push(p) }
  const out = new Map<string, { cur: Any; all: Any[] }>()
  for (const [k, ps] of by) { ps.sort((a, b) => String(b.plan_end).localeCompare(String(a.plan_end)) || String(b.generated).localeCompare(String(a.generated))); out.set(k, { cur: ps[0], all: ps }) }
  return out
}
let IR: Any = null, IR_FP = ''
/** tests hand the rules in directly for findingsFor (the nightly pass always downloads and checks the approved file) */
export function useRules(r: Any) { IR = r }
/** every run checks the served file against the approved fingerprints (a warm instance never keeps an unapproved file) */
async function ihsRules(db: Any): Promise<{ ok: true } | { ok: false; why: string }> {
  const g = await approvedRules(db, 'ihs-rules.js')
  if (!g.ok) return { ok: false, why: g.error }
  if (g.fingerprint === IR_FP && IR) return { ok: true }
  if (!/IhsRules/.test(g.src)) return { ok: false, why: 'the rules file does not define IhsRules' }
  ;(0, eval)(g.src); IR = (globalThis as Any).IhsRules; IR_FP = g.fingerprint
  return IR ? { ok: true } : { ok: false, why: 'the rules file did not load' }
}
async function ownerOf(db: Any, st: Any): Promise<{ email: string; name: string }> {
  try {
    const { data: d } = await db.from('domains').select('code, owner_person, entity').eq('entity', 'cc_ihs').eq('code', 'payer_programs').maybeSingle()
    if (d?.owner_person) { const { data: p } = await db.from('persons').select('full_name, primary_email').eq('person_id', d.owner_person).maybeSingle(); if (p?.primary_email) return { email: String(p.primary_email).toLowerCase(), name: String(p.full_name || p.primary_email) } }
  } catch { /* fall through */ }
  const e = S(st?.staffing_email, 160).toLowerCase(); return { email: e, name: e }
}
async function raiseCard(db: Any, c: { id: string; kind: string; title: string; detail: string; who: string; ax: string; lead: string; urgency: 'urgent' | 'today' | 'normal'; owner: { email: string; name: string }; due?: string }) {
  try {
    const now = new Date().toISOString(), items = await list(db, 'ops_items'), prev = items.find((x) => x && x.id === c.id)
    const isOpen = (x: Any) => x && x.status !== 'done' && x.status !== 'resolved'
    if (prev && !isOpen(prev)) return false
    const item = { ...(prev && isOpen(prev) ? prev : { owner: c.owner.email, owner_name: c.owner.name, created_at: now, first_at: now }), id: c.id, kind: c.kind, domain: 'payer_programs', status: 'open', urgency: c.urgency,
      title: c.title, detail: c.detail, who: c.who, about: c.who, axiscare_client_id: c.ax || null, lead_id: c.lead || null, last_at: now, due: (prev && isOpen(prev) && prev.due) || (c.due ? c.due + 'T22:00:00Z' : new Date(Date.now() + 24 * 3_600_000).toISOString()),
      closed_at: null, closed_by: null, close_note: null, resolved_at: null, created_by: 'client-audit', opened_by: 'client-audit' }
    await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item }); return !prev
  } catch (e) { console.warn('[client-audit] could not raise a card: ' + String(e).slice(0, 160)); return false }
}
async function closeCard(db: Any, id: string, note: string): Promise<boolean> {
  try {
    const prev = (await list(db, 'ops_items')).find((x) => x && x.id === id)
    if (!prev || prev.status === 'done' || prev.status === 'resolved') return false
    const now = new Date().toISOString()
    await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { ...prev, status: 'done', closed_at: now, closed_by: 'client-audit', close_reason: note, last_activity_at: now } }); return true
  } catch { return false }
}
async function axActive(id: string): Promise<boolean | null> {
  if (!/^\d{1,12}$/.test(id)) return null
  const r = await ax('GET', `/api/clients/${id}`)
  if (r.status < 200 || r.status >= 300) return null
  const c = r.json?.results?.client ?? r.json?.client ?? r.json
  return c?.status?.active === true ? true : c?.status ? false : null
}

/** What the nightly pass finds for one client (pure apart from the AxisCare read): the cards it would raise. */
export function findingsFor(cur: Any, fs: string, today: string, holidays: unknown, nowIso: string): Array<{ key: string; kind: string; urgency: 'urgent' | 'today' | 'normal'; title: string; detail: string; due?: string; needs_ax?: boolean }> {
  const out: Any[] = [], name = cur.client_name || 'this client'
  const c = IR.startClock(cur, fs, today)
  const late = cur.start && cur.start.late
  if (c.applies && !late) {
    if (c.state === 'overdue' || c.state === 'started_late') out.push({ key: 'start_' + cur.id, kind: 'ihs_start_late', urgency: 'urgent', due: c.due, title: 'Late start, written justification owed: ' + name, detail: `Care was due to start by ${usd(c.due)} (${c.rule}). ${c.started ? 'It started ' + usd(c.started) + '.' : 'It has not started.'} Record the written justification sent to DSDS, with the copy, on the Payer tab (19 CSR 15-7.021(18)(J)).` })
    else if (c.state === 'due_today' || c.state === 'soon') out.push({ key: 'start_' + cur.id, kind: 'ihs_start_due', urgency: 'today', due: c.due, title: 'Start care for ' + name + ' by ' + usd(c.due), detail: `${c.left === 0 ? 'Today is' : c.left + ' day' + (c.left === 1 ? '' : 's') + ' to'} the start deadline (${c.rule}). Started means the first clock-in in AxisCare.` })
  }
  const w = IR.planWatch(cur, today)
  if (w.state === 'soon') out.push({ key: 'end_' + cur.id, kind: 'plan_end_soon', urgency: 'normal', due: w.end, title: 'Care plan ends ' + usd(w.end) + ': ' + name, detail: `${w.left} day${w.left === 1 ? '' : 's'} left. DSDS reassesses before then (MAN 4.15). Upload the new plan from Fusion on the Payer tab when it arrives.` })
  if (w.state === 'ended') out.push({ key: 'ended_' + cur.id, kind: 'auth_ended', urgency: 'urgent', title: 'Authorization ended, care continues: ' + name, detail: `The care plan ended ${usd(w.end)} and no newer plan is uploaded, while AxisCare still has the client Active. Check Fusion for the new authorization and upload it, or record what happened. The Hub never changes an authorization.`, needs_ax: true })
  for (const ch of Array.isArray(cur.changes) ? cur.changes : []) {
    if (!ch || ch.status === 'closed') continue
    const since = ch.status === 'recommended' ? ymd(ch.seen_at) : ch.status === 'approved' ? ymd(ch.approved_on) : ch.status === 'submitted' ? ymd(ch.submitted_on) : ''
    if (!isYmd(since)) continue
    const stalled = ch.status === 'submitted' ? daysBetween(since, today) >= 30 : dueNextBusinessDay(since + 'T12:00:00Z', holidays, 17, 2) < nowIso
    if (stalled) out.push({ key: 'change_' + (ch.id || since), kind: 'change_stalled', urgency: 'today', title: 'Care plan change request waiting: ' + name, detail: ch.status === 'recommended' ? `Recommended ${usd(since)} and not yet approved by a supervisor.` : ch.status === 'approved' ? `Approved ${usd(since)} and the PCCP Request Form is not recorded as submitted.` : `Submitted to DSDS ${usd(since)}; no decision recorded after 30 days. Check Fusion.` })
  }
  if (isYmd(cur.received_on) && (!cur.fusion_verified || !cur.pdf) && dueNextBusinessDay(ymd(cur.received_on) + 'T12:00:00Z', holidays, 17, 1) < nowIso)
    out.push({ key: 'verify_' + cur.id, kind: 'plan_unverified', urgency: 'today', title: (cur.fusion_verified ? 'Keep the care plan PDF: ' : 'Check the authorization in Fusion: ') + name, detail: [!cur.fusion_verified ? 'Nobody has recorded checking this plan against Fusion (dates, services, units).' : '', !cur.pdf ? 'The care plan PDF is not kept in the Hub as the source document.' : ''].filter(Boolean).join(' ') + ' Both are on the Payer tab.' })
  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false, autoRefreshToken: false } })
  const b: Any = await req.json().catch(() => ({}))
  const action = S(b.action, 20)
  try {
    /* ── the nightly client pass ── */
    if (action === 'nightly') {
      if (!(await jobCaller(req))) return json({ error: 'the nightly pass is for the schedule or an owner' }, 401)
      const st = await settings(db), live = st.client_audit_live === true, now = new Date().toISOString(), today = centralYmd(now), t0 = Date.now()
      const rr = await ihsRules(db)
      const out: Any = { ok: true, live, clients: 0, findings: {}, raised: 0, closed: 0, ax_unread: 0, errors: [] as string[] }
      if (!rr.ok) { out.ok = false; out.errors.push('rules: ' + rr.why) }
      else {
        const [plans, leads] = await Promise.all([list(db, 'medicaid_plans'), list(db, 'leads')])
        const owner = await ownerOf(db, st), byLead = new Map(leads.map((l) => [String(l?.id), l]))
        const cards = (await list(db, 'ops_items')).filter((x) => x && x.created_by === 'client-audit' && x.status !== 'done' && x.status !== 'resolved')
        const seen = new Set<string>()
        for (const [, { cur }] of currentPlans(plans)) {
          out.clients++
          const lead = cur.lead_id ? byLead.get(String(cur.lead_id)) : null
          const fs = ymd((lead && lead.first_shift_at) || (cur.start && cur.start.started_on_manual) || '')
          for (const f of findingsFor(cur, fs, today, st.company_holidays, now)) {
            if (f.needs_ax) { const a = await axActive(String(cur.axiscare_client_id || '')); if (a === null) { out.ax_unread++; continue } if (!a) continue }
            out.findings[f.kind] = (out.findings[f.kind] || 0) + 1
            const id = 'ca_' + f.key; seen.add(id)
            if (live && await raiseCard(db, { id, kind: f.kind, urgency: f.urgency, title: f.title, detail: f.detail, who: cur.client_name || '', ax: String(cur.axiscare_client_id || ''), lead: String(cur.lead_id || ''), owner, due: f.due })) out.raised++
          }
        }
        if (live) for (const c of cards) if (!seen.has(c.id) && await closeCard(db, c.id, 'No longer found by the nightly client audit.')) out.closed++
      }
      out.ms = Date.now() - t0
      try { await db.rpc('upsert_app_data_item', { target_key: 'automation_log', item: { id: 'auto_srv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), at: now, automation: 'client_audit', ran_by: 'server', ok: out.ok, dry: !live, duration_ms: out.ms, summary: { clients: out.clients, findings: out.findings, raised: out.raised, closed: out.closed, ax_unread: out.ax_unread }, errors: out.errors.length, error: out.errors.join(' | ') || null } }) } catch { /* the log must not take the pass down */ }
      return json(out)
    }
    /* ── staff ── */
    const who = await requireStaff(db, req, OFFICE_ROLES)
    if (!who.ok) return json({ error: who.error }, who.status)
    const opener = { person_id: who.person_id, email: who.email, name: who.name }, ip = ipOf(req)
    if (action === 'upload_url') {
      const kind = S(b.kind, 20), ref = S(b.ref, 120).replace(/[^A-Za-z0-9_.:-]/g, '_'), name = S(b.name, 120).replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80) || 'file'
      if (!['careplan', 'late', 'grievance'].includes(kind) || !ref) return json({ error: 'Which document?' }, 400)
      if (kind === 'careplan' && !/\.pdf$/i.test(name)) return json({ error: 'The care plan must be the PDF from Fusion.' }, 400)
      const path = `${kind}/${ref}/${Date.now()}-${name}`
      const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path)
      if (error) return json({ error: 'Could not prepare the upload.' }, 500)
      return json({ path, token: data.token, url: data.signedUrl })
    }
    if (action === 'file_url') {
      const path = S(b.path, 500)
      if (!/^(careplan|late|grievance)\/[^/]+\/[^/]+$/.test(path)) return json({ error: 'Not a client audit document.' }, 400)
      const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, LINK_SECONDS)
      if (error) return json({ error: 'Could not open the file.' }, 500)
      await logOpen(db, { subject: clientSubject(b.ax, b.lead_id, path.split('/')[1]), doc: path.split('/')[0], path, who: opener, reason: S(b.reason, 120) || 'opened on the client profile', ip })
      return json({ url: data.signedUrl, expires_in: LINK_SECONDS })
    }
    if (action === 'lead_doc_url') {
      const lead = S(b.lead_id, 40), path = S(b.path, 500)
      if (!lead || !path.startsWith(lead + '/')) return json({ error: 'That document is not this inquiry\'s.' }, 403)
      const { data, error } = await db.storage.from('lead-docs').createSignedUrl(path, LINK_SECONDS)
      if (error) return json({ error: 'Could not open the file.' }, 500)
      await logOpen(db, { subject: clientSubject(b.ax, lead), doc: 'lead-doc', path, who: opener, reason: S(b.reason, 120) || 'opened on the client profile', ip })
      return json({ url: data.signedUrl, expires_in: LINK_SECONDS })
    }
    if (action === 'export') return await exportClient(db, b, who, opener, ip)
    return json({ error: 'Unknown action.' }, 400)
  } catch (e) {
    return json({ error: 'Something went wrong: ' + ((e as Error).message || 'error') + '. Nothing was changed.' }, 500)
  }
})

/* ── the read-only client audit export ── */
async function exportClient(db: Any, b: Any, who: Any, opener: Any, ip: string): Promise<Response> {
  const { data: pr } = await db.from('app_data').select('data').eq('key', PERM_KEY).maybeSingle()
  if (!mayApprove(normalizePerms(pr?.data), 'audit_export', { person_id: who.person_id, roles: who.roles || [], email: who.email })) return json({ error: 'Only an owner or a person on the Audit export list (Admin page) may export a client file.' }, 403)
  const axId = /^\d{1,12}$/.test(S(b.axiscare_client_id, 12)) ? S(b.axiscare_client_id, 12) : '', leadId = S(b.lead_id, 40)
  if (!axId && !leadId) return json({ error: 'Which client?' }, 400)
  const asOf = isYmd(b.as_of) ? ymd(b.as_of) : '', cutoff = asOf ? asOf + 'T23:59:59.999-05:00' : '', upto = (iso: unknown) => !asOf || (iso && String(iso) <= cutoff) || (isYmd(iso) && ymd(iso) <= asOf)
  const reason = S(b.reason, 200) || 'audit export', now = new Date().toISOString()
  const [leads, plans, vw, gw] = await Promise.all([list(db, 'leads'), list(db, 'medicaid_plans'), list(db, 'visit_watch'), list(db, 'ghe_watch')])
  const lead = leadId ? leads.find((l) => String(l?.id) === leadId) || null : leads.find((l) => axId && String(l?.axiscare_client_id || '') === axId) || null
  const jq = db.from('client_journey').select('*').eq('subject', 'client')
  const { data: js } = axId ? await jq.eq('axiscare_client_id', axId) : await jq.eq('lead_id', leadId)
  const journeys: Any[] = (js ?? []).filter((j: Any) => upto(j.created_at)).sort((a: Any, z: Any) => String(a.created_at).localeCompare(String(z.created_at)))
  const myPlans = plans.filter((p) => p && p.kind === 'plan' && ((axId && String(p.axiscare_client_id || '') === axId) || (lead && String(p.lead_id || '') === String(lead.id)))).filter((p) => upto(p.received_on || p.confirmed_at))
  const name = (journeys[journeys.length - 1]?.client_name) || myPlans[0]?.client_name || (lead && (lead.client_name || lead.name)) || (axId ? 'AxisCare client ' + axId : 'Inquiry ' + leadId)
  const subject = clientSubject(axId, lead ? lead.id : leadId)
  const proofs: Array<{ label: string; bucket: string; path: string }> = []
  const pdf = new BrandPdf(`Client audit - ${name}`); pdf.footer(FOOTER)
  pdf.headerFn = (p, f) => p.letterhead(COMPANY_RIGHT, f); pdf.letterhead(COMPANY_RIGHT, true)
  pdf.para('Client audit file (read-only export)', { font: 'B', size: 18, color: NAVY, lh: 23, after: 2 })
  pdf.para(`${name} · ${asOf ? 'as of the end of ' + usd(asOf) + ' · ' : ''}exported ${central(now)} Central by ${who.name || who.email} · reason: ${reason}`, { size: 8.5, color: MUTED, after: 2 })
  pdf.para('Every line comes from the Hub records. AxisCare is the record of the client and of service delivery; Fusion is the official Medicaid record; the Hub holds the obligations and the evidence. Nothing here was typed for this export. Proof files are listed by reference; the links that came with this export open for five minutes and every open is logged.' + (asOf ? ' As of a past date: the journey shows the last event recorded by then; plans, months and grievances are those on file by then; a record changed later shows its later values where the Hub keeps no history of it (noted).' : ''), { size: 8.5, color: MUTED, after: 8 })
  pdf.heading('Client')
  pdf.labelled('AxisCare client:', axId || 'not linked', { after: 2 })
  pdf.labelled('Inquiry:', lead ? `${S(lead.id)} · payer ${S(lead.funding_source) || 'not set'}${lead.dcn ? ' · DCN ' + S(lead.dcn) : ''}` : 'none on file', { after: 2 })
  pdf.labelled('First visit (AxisCare clock-in):', lead && lead.first_shift_at && upto(lead.first_shift_at) ? central(lead.first_shift_at) : 'not seen', { after: 6 })
  /* the journey */
  for (const j of journeys) {
    const { data: steps } = await db.from('client_journey_step').select('*').eq('journey_id', j.journey_id)
    const { data: evs } = await db.from('client_journey_event').select('*').eq('journey_id', j.journey_id).order('at', { ascending: true }).limit(1000)
    const events = (evs ?? []).filter((e: Any) => upto(e.at))
    const { data: dfRows } = await db.from('client_journey_step_def').select('key, def').not('key', 'like', 'cg.%')
    const title = new Map((dfRows ?? []).map((d: Any) => [d.key, d.def?.title || d.key]))
    pdf.hr(RULE, 8); pdf.heading(`Client journey · ${S(j.payer) || 'payer not set'} · started ${usd(j.created_at)} · ${asOf ? 'as of ' + usd(asOf) : 'now ' + S(j.status)}`)
    const keys = [...new Set([...(steps ?? []).map((s: Any) => s.step_key), ...events.map((e: Any) => e.step_key).filter(Boolean)])]
    for (const k of keys) {
      const s = (steps ?? []).find((x: Any) => x.step_key === k), last = [...events].reverse().find((e: Any) => e.step_key === k)
      if (asOf && !last) continue
      pdf.para(String(title.get(k) || k), { font: 'B', size: 9.5, lh: 13, after: 1 })
      const line = asOf ? [`last recorded: ${last.kind}`, central(last.at), S(last.actor_name || last.actor_email, 60), last.reason ? '"' + S(last.reason, 160) + '"' : '']
        : [String(s?.state || 'open').toUpperCase(), s?.completed_at ? 'completed ' + central(s.completed_at) : '', s?.completed_by_name || s?.completed_by ? 'by ' + S(s?.completed_by_name || s?.completed_by, 60) : '', s?.blocked_reason ? 'blocked: ' + S(s.blocked_reason, 160) : '', s?.exception?.reason ? 'owner exception: ' + S(s.exception.reason, 160) : '', s?.evidence?.note ? 'note: ' + S(s.evidence.note, 160) : '']
      pdf.para(line.filter(Boolean).join(' · '), { size: 8.5, color: MUTED, lh: 12, after: 1 })
      for (const f of Array.isArray(s?.evidence?.files) ? s.evidence.files : []) { const p = typeof f === 'string' ? f : f?.path; if (p) { pdf.para('proof: ' + S(p, 300), { size: 8, color: MUTED, lh: 11, after: 1 }); proofs.push({ label: String(title.get(k) || k), bucket: BUCKET, path: p }) } }
      pdf.y -= 2
    }
    pdf.heading('Journey history (permanent, in order)')
    for (const e of events) pdf.para(`${central(e.at)} · ${e.kind}${e.step_key ? ' · ' + e.step_key : ''} · ${S(e.actor_name || e.actor_email, 60)}${e.reason ? ' · "' + S(e.reason, 160) + '"' : ''}`, { size: 8, color: MUTED, lh: 11, after: 1 })
  }
  /* the Medicaid plans */
  const rules = await ihsRules(db)
  for (const p of myPlans.sort((a, z) => String(z.plan_start).localeCompare(String(a.plan_start)))) {
    pdf.hr(RULE, 8); pdf.heading(`Medicaid care plan · ${usd(p.plan_start)} to ${usd(p.plan_end)}`)
    pdf.labelled('Received / confirmed:', `received ${usd(p.received_on)} · confirmed by ${S(p.confirmed_by)} ${central(p.confirmed_at)}${p.generated ? ' · Fusion generated ' + usd(p.generated) : ''}`, { after: 2 })
    const fv = p.fusion_verified && upto(p.fusion_verified.at) ? p.fusion_verified : null
    pdf.labelled('Checked against Fusion:', fv ? `${S(fv.by_name || fv.by)} on ${usd(fv.checked_on)} (recorded ${central(fv.at)})${fv.note ? ' · ' + S(fv.note, 160) : ''}` : 'NOT RECORDED', { after: 2 })
    pdf.labelled('Care plan PDF (source document):', p.pdf && upto(p.pdf.at) ? `${S(p.pdf.name)} · kept by ${S(p.pdf.by)} ${central(p.pdf.at)}` : 'not kept in the Hub', { after: 4 })
    if (p.pdf && upto(p.pdf.at) && p.pdf.path) proofs.push({ label: 'Care plan PDF ' + usd(p.plan_start), bucket: BUCKET, path: p.pdf.path })
    for (const sv of (p.services || []).filter((x: Any) => x.ours)) pdf.para(`${S(sv.label)}: ${usd(sv.start)} to ${usd(sv.end)}${sv.prior_auth ? ' · PA ' + S(sv.prior_auth) : ''} · ${(sv.units || []).map((u: Any) => `${S(u.start).slice(0, 7)} ${u.units} ${S(u.code)}`).join(', ')}`, { size: 8.5, color: MUTED, lh: 12, after: 1 })
    if (rules.ok) {
      const lf = lead && lead.first_shift_at && upto(lead.first_shift_at) ? lead.first_shift_at : (p.start && p.start.started_on_manual) || ''
      const c = IR.startClock(p, ymd(lf), asOf || centralYmd(now))
      if (c.applies) pdf.para(`Start clock: ${c.rule}; ${c.state.replace(/_/g, ' ')}${c.started ? ' (started ' + usd(c.started) + ')' : ''}${c.late_days ? ', ' + c.late_days + ' days late' : ''}.`, { size: 8.5, lh: 12, after: 1 })
    }
    const ck = (p.start && p.start.checks) || {}
    for (const k of Object.keys(ck)) if (ck[k] && upto(ck[k].on)) pdf.para(`Start check ${k}: done ${usd(ck[k].on)} by ${S(ck[k].by)}`, { size: 8.5, color: MUTED, lh: 12, after: 1 })
    const late = p.start && p.start.late
    if (late && upto(late.at || late.sent_on)) {
      pdf.para(`Late-start justification sent to DSDS ${usd(late.sent_on)} (${S(late.how)}) · recorded by ${S(late.by)} · reason: ${S(late.reason, 300)}`, { size: 8.5, lh: 12, after: 1 })
      if (late.copy && late.copy.path) { pdf.para('copy kept: ' + S(late.copy.name), { size: 8, color: MUTED, lh: 11, after: 1 }); proofs.push({ label: 'Late-start justification copy', bucket: BUCKET, path: late.copy.path }) }
    }
    for (const ch of (p.changes || []).filter((x: Any) => upto(x.seen_at))) pdf.para(`Change request (${S(ch.kind)}): recommended ${central(ch.seen_at)} by ${S(ch.seen_by)}${ch.approved_on && upto(ch.approved_on) ? ' · approved ' + usd(ch.approved_on) + ' by ' + S(ch.approved_by) : ''}${ch.submitted_on && upto(ch.submitted_on) ? ' · submitted ' + usd(ch.submitted_on) : ''}${ch.closed_on && upto(ch.closed_on) ? ' · closed ' + usd(ch.closed_on) + ' (' + S(ch.outcome) + ')' : ''} · ${S(ch.why, 200)}`, { size: 8.5, color: MUTED, lh: 12, after: 1 })
  }
  /* authorized against delivered, the monthly reviews, GHE months */
  const months = vw.filter((m) => axId && String(m?.ax) === axId && (!asOf || String(m.month) <= asOf.slice(0, 7))).sort((a, z) => String(a.month).localeCompare(String(z.month)))
  if (months.length) { pdf.hr(RULE, 8); pdf.heading('Authorized against delivered (from AxisCare visits)')
    for (const m of months) pdf.para(`${S(m.month)}: ${m.delivered_units ?? '?'} of ${m.authorized_units ?? '?'} authorized units delivered · ${m.visits_delivered ?? '?'} of ${m.visits_scheduled ?? '?'} visits · ${(m.missed || []).length} missed${m.review && m.review.signed_at && upto(m.review.signed_at) ? ' · review signed by ' + S(m.review.signed_name) + ' ' + usd(m.review.signed_at) + ': ' + S(m.review.explanation, 200) : (m.missed || []).length ? ' · review NOT signed' : ''}`, { size: 8.5, lh: 12, after: 1 }) }
  const ghes = gw.filter((g) => axId && String(g?.ax) === axId && (!asOf || String(g.month) <= asOf.slice(0, 7))).sort((a, z) => String(a.month).localeCompare(String(z.month)))
  if (ghes.length) { pdf.hr(RULE, 8); pdf.heading('Nurse visits (GHE) by month')
    for (const g of ghes) pdf.para(`${S(g.month)}: ${S(g.state?.state || g.state || 'unknown')}${g.resolved ? ' · missed, resolved by ' + S(g.resolved.by_name || g.resolved.by) + ': ' + S(g.resolved.label || g.resolved.reason, 160) : ''}`, { size: 8.5, color: MUTED, lh: 12, after: 1 }) }
  /* grievances */
  if (axId) {
    const { data: gs } = await db.from('client_issue').select('*').eq('axiscare_client_id', axId).eq('category', 'grievance')
    const list_ = (gs ?? []).filter((g: Any) => upto(g.reported_at))
    if (list_.length) { pdf.hr(RULE, 8); pdf.heading('Grievances')
      for (const g of list_) {
        const resolved = g.resolved_at && upto(g.resolved_at)
        pdf.para(`Reported ${central(g.reported_at)}: ${S(g.summary, 200)}`, { font: 'B', size: 9, lh: 12, after: 1 })
        pdf.para(resolved ? `Resolved ${central(g.resolved_at)} by ${S(g.resolved_by)}: ${S(g.resolution_note, 300)}${g.resolution_how === 'in_person' ? ' · answered in person: ' + S(g.resolution_in_person, 200) : g.resolution_doc ? ' · written answer kept' : ' · no written answer recorded (before this was required)'}` : `${asOf ? 'Open as of ' + usd(asOf) : 'Now ' + S(g.state)}`, { size: 8.5, color: MUTED, lh: 12, after: 1 })
        if (resolved && g.resolution_doc) proofs.push({ label: 'Grievance written answer ' + usd(g.reported_at), bucket: BUCKET, path: g.resolution_doc })
      } }
    /* care changes, pauses, the launch evidence */
    const [{ data: cc }, { data: pz }, { data: le }] = await Promise.all([db.from('client_care_change').select('*').eq('axiscare_client_id', axId), db.from('client_pause').select('*').eq('axiscare_client_id', axId), db.from('launch_evidence').select('*').eq('axiscare_client_id', axId)])
    const ccs = (cc ?? []).filter((x: Any) => upto(x.made_at)), pzs = (pz ?? []).filter((x: Any) => upto(x.paused_from)), les = (le ?? []).filter((x: Any) => upto(x.recorded_at))
    if (ccs.length || pzs.length) { pdf.hr(RULE, 8); pdf.heading('Care changes and pauses')
      for (const x of ccs) {
        pdf.para(`${S(x.kind)} · recorded ${central(x.made_at)} by ${S(x.made_by_name || x.made_by)}${x.effective_date ? ' · effective ' + usd(x.effective_date) : ''}${x.reason ? ' · ' + S(x.reason, 120) : ''}${x.explanation ? ': ' + S(x.explanation, 200) : ''}`, { size: 8.5, lh: 12, after: 1 })
        for (const it of Array.isArray(x.checklist) ? x.checklist : []) { pdf.para(`  ${S(it.label || it.key, 120)}: ${S(it.state || 'open')}${it.on ? ' ' + usd(it.on) : ''}${it.by ? ' by ' + S(it.by, 60) : ''}${it.note ? ' · ' + S(it.note, 120) : ''}`, { size: 8, color: MUTED, lh: 11, after: 1 }); for (const f of Array.isArray(it.files) ? it.files : []) { const p = typeof f === 'string' ? f : f?.path; if (p) proofs.push({ label: 'Care change: ' + S(it.label || it.key, 60), bucket: BUCKET, path: p }) } }
      }
      for (const x of pzs) pdf.para(`Pause from ${usd(x.paused_from)} · follow up ${usd(x.followup_date)} · ${S(x.reason, 160)}${x.explanation ? ': ' + S(x.explanation, 160) : ''} · ${x.status === 'closed' && upto(x.closed_at) ? S(x.closed_kind || 'closed') + ' ' + central(x.closed_at) : 'open'}`, { size: 8.5, color: MUTED, lh: 12, after: 1 }) }
    if (les.length) { pdf.hr(RULE, 8); pdf.heading('Start-of-care evidence (write-once)')
      for (const x of les) pdf.para(`${S(x.fact)} · ${S(x.source)} · ${central(x.recorded_at)} by ${S(x.recorded_by)}${x.reason ? ' · ' + S(x.reason, 160) : ''}`, { size: 8.5, color: MUTED, lh: 12, after: 1 }) }
  }
  /* inquiry documents */
  if (lead && Array.isArray(lead.docs)) for (const d of lead.docs.filter((x: Any) => upto(x?.at))) if (d?.path) proofs.push({ label: 'Inquiry document: ' + S(d.slot) + ' ' + S(d.name, 60), bucket: 'lead-docs', path: d.path })
  /* SLICE 9: the value history of this client's evidence: Medicaid plans, care changes and their checklists, signed EVV
     forms and GHE forms (signatures and answers as fingerprints only) */
  {
    const evWant: Array<{ source: string; ids: string[] }> = [{ source: 'app_data:medicaid_plans', ids: myPlans.map((p) => String(p.id)) }]
    if (axId) {
      const [{ data: ccIds }, { data: evvIds }] = await Promise.all([db.from('client_care_change').select('change_id').eq('axiscare_client_id', axId), db.from('evv_submissions').select('id').eq('client_axiscare_id', axId)])
      evWant.push({ source: 'client_care_change', ids: (ccIds ?? []).map((x: Any) => String(x.change_id)) }, { source: 'evv_submissions', ids: (evvIds ?? []).map((x: Any) => String(x.id)) })
      const [nc, gf] = await Promise.all([list(db, 'nurse_clients'), list(db, 'ghe_forms')])
      const ncIds = new Set(nc.filter((x) => String(x?.axiscare_client_id || '') === axId).map((x) => String(x.id)))
      evWant.push({ source: 'app_data:ghe_forms', ids: gf.filter((g) => g && ncIds.has(String(g.client_id || ''))).map((g) => String(g.id)) })
    }
    const LBL: Record<string, string> = { 'app_data:medicaid_plans': 'Medicaid plan', client_care_change: 'care change', evv_submissions: 'EVV form', 'app_data:ghe_forms': 'GHE form' }
    const shown = (await evidenceRows(db, evWant)).filter((r) => upto(r.at))
    pdf.hr(RULE, 8); pdf.heading('Evidence changes (before and after)' + (asOf ? ' up to ' + usd(asOf) : ''))
    pdf.para(EVIDENCE_NOTE, { size: 8, color: MUTED, lh: 11, after: 2 })
    if (!shown.length) pdf.para('No evidence value has changed since then.', { size: 8.5, color: MUTED, lh: 12, after: 1 })
    for (const r of shown.slice(-300)) pdf.para(`${central(r.at)} · ${evidenceLine(r, LBL[r.source] || r.source)}`, { size: 8, color: MUTED, lh: 11, after: 1 })
  }
  if (!journeys.length && !myPlans.length) pdf.para('No client journey and no Medicaid plan on file for this client' + (asOf ? ' as of ' + usd(asOf) : '') + '.', { size: 9, after: 4 })
  const bytes = pdf.build()
  const path = `exports/${subject.replace(/[^a-zA-Z0-9:_-]/g, '_')}/${now.replace(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 8)}.pdf`
  const up = await db.storage.from('onboarding-documents').upload(path, bytes, { contentType: 'application/pdf', upsert: false })
  if (up.error) return json({ error: 'The export could not be stored: ' + up.error.message }, 500)
  const { data: su } = await db.storage.from('onboarding-documents').createSignedUrl(path, LINK_SECONDS)
  const logs: Any[] = [{ at: now, offer_id: subject, doc: 'client-export', path, by_person: who.person_id, by_email: who.email, by_name: who.name, ip, reason: asOf ? reason + ' (as of ' + asOf + ')' : reason }]
  const links: Array<{ label: string; url: string | null }> = [], seen = new Set<string>()
  for (const p of proofs) {
    if (seen.has(p.bucket + p.path)) continue; seen.add(p.bucket + p.path)
    const { data } = await db.storage.from(p.bucket).createSignedUrl(p.path, LINK_SECONDS)
    links.push({ label: p.label, url: data?.signedUrl ?? null })
    if (data?.signedUrl) logs.push({ at: now, offer_id: subject, doc: 'client-export-proof', path: p.path, by_person: who.person_id, by_email: who.email, by_name: who.name, ip, reason })
  }
  const { error: le2 } = await db.from('document_access_log').insert(logs)
  if (le2) return json({ error: 'The export was built but could not be logged, so it was not released: ' + le2.message }, 500)
  void opener
  return json({ ok: true, name, as_of: asOf || null, url: su?.signedUrl ?? null, path, expires_in: LINK_SECONDS, proofs: links, logged: logs.length })
}
