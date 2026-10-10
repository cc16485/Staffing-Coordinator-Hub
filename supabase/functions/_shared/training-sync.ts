// =============================================================================
// training-sync.ts · SLICE 6 (Samantha "yes to all", 2026-10-10): Training Platform to Hub, nightly, on the server.
// The same mapping the Caregivers tab's "Sync from Training Hub" button applies (caregivers-engine.js syncFromTrainingHub),
// ported: orientation and dementia dates, the OJT online part, the annual in-service date and trailing-12-month hours,
// hire date and first contact only when blank. Matched by AxisCare number only (a name match is the button's business, by
// a person). The proof is the Training Platform's certificate reference (training:certificates/<id>/<slug>.pdf) when one
// exists, else the generic link as before; an existing generic link is upgraded to the certificate when one appears. A date
// the office typed by hand is never overwritten with an older fact: a Training completion replaces the roster date only
// when it differs, exactly as the button does. Reads Training through its own project's REST with the server key the Hub
// already holds for job offers (OFFERS_PROJECT_URL / OFFERS_SERVICE_ROLE_KEY). Writes nothing itself: the caller saves
// through caregiver_audit_patch.
// deno-lint-ignore-file no-explicit-any
export const GENERIC_PROOF = 'https://training.mo-care.com'
export type Training = { axiscare_id?: unknown; emp_id?: unknown; name?: unknown; status_label?: unknown; hire_date?: unknown; first_contact_date?: unknown; inservice_last_date?: unknown; inservice_hours_12mo?: unknown; inservice_has_doc?: unknown; trainings?: Array<{ slug?: string; title?: string; status?: string; completed_at?: string }> }
export type TrainingRead = { ok: true; rows: Training[]; ids: Map<string, string> } | { ok: false; why: string }
const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '')
const day = (iso: unknown) => iso ? String(iso).slice(0, 10) : ''

function creds() { const url = Deno.env.get('OFFERS_PROJECT_URL') ?? '', key = Deno.env.get('OFFERS_SERVICE_ROLE_KEY') ?? ''; return url && key ? { url: url.replace(/\/$/, ''), key } : null }
/** Every active Training caregiver's status (the Training Platform's own hub_training_status), plus AxisCare number → Training id. */
export async function readTraining(send: typeof fetch = fetch): Promise<TrainingRead> {
  const c = creds(); if (!c) return { ok: false, why: 'the Training Platform connection is not set on this project' }
  const H = { apikey: c.key, Authorization: `Bearer ${c.key}`, 'Content-Type': 'application/json' }
  try {
    const ks = await send(`${c.url}/rest/v1/app_settings?key=eq.hub_read_key&select=value`, { headers: H })
    const kj = ks.ok ? await ks.json() : null
    const pkey = Array.isArray(kj) && kj[0]?.value?.key ? String(kj[0].value.key) : ''
    if (!pkey) return { ok: false, why: 'the Training Platform read key could not be read' }
    const r = await send(`${c.url}/rest/v1/rpc/hub_training_status`, { method: 'POST', headers: H, body: JSON.stringify({ p_key: pkey }) })
    const rows = r.ok ? await r.json() : null
    if (!Array.isArray(rows)) return { ok: false, why: `the Training Platform did not answer (${r.status}${rows?.error ? ': ' + rows.error : ''})` }
    const ir = await send(`${c.url}/rest/v1/caregivers?select=id,axiscare_id&active=eq.true`, { headers: H })
    const idRows = ir.ok ? await ir.json() : []
    const ids = new Map<string, string>()
    for (const x of Array.isArray(idRows) ? idRows : []) if (digits(x?.axiscare_id) && x?.id) ids.set(digits(x.axiscare_id), String(x.id))
    return { ok: true, rows, ids }
  } catch (e) { return { ok: false, why: 'could not reach the Training Platform: ' + String((e as Error)?.message ?? e).slice(0, 120) } }
}
/** The certificate reference for a course, when the Training Platform holds the PDF (certificates/<training id>/<slug>.pdf in waiver-docs). */
export async function certificateRef(trainingId: string, slug: string, send: typeof fetch = fetch): Promise<string | null> {
  const c = creds(); if (!c || !trainingId || !slug) return null
  try {
    const r = await send(`${c.url}/storage/v1/object/list/waiver-docs`, { method: 'POST', headers: { apikey: c.key, Authorization: `Bearer ${c.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefix: `certificates/${trainingId}`, limit: 100 }) })
    const j = r.ok ? await r.json() : null
    return Array.isArray(j) && j.some((o: any) => String(o?.name ?? '') === `${slug}.pdf`) ? `training:certificates/${trainingId}/${slug}.pdf` : null
  } catch { return null }
}
/** The roster patch the Training facts call for, or null when nothing changes. `cert(slug)` answers the certificate reference. */
export function syncPatch(c: any, h: Training, nowIso: string, cert: (slug: string) => string | null): Record<string, unknown> | null {
  const p: Record<string, unknown> = {}
  const course = (slug: string) => (h.trainings || []).find((t) => t?.slug === slug)
  const proofFor = (slug: string, cur: unknown) => { const ref = cert(slug); if (ref && (!cur || cur === GENERIC_PROOF)) return ref; if (!cur) return GENERIC_PROOF; return undefined }
  const setProof = (field: string, slug: string) => { const v = proofFor(slug, c[field]); if (v !== undefined) p[field] = v }
  const or = course('agency-orientation'), alz = course('dementia-care'), ojt = course('on-the-job-training')
  if (or && or.status === 'complete' && or.completed_at) { if (c.orient_date !== day(or.completed_at)) p.orient_date = day(or.completed_at); setProof('orient_proof', 'agency-orientation') }
  if (alz && alz.status === 'complete' && alz.completed_at) {
    if (c.alz_date !== day(alz.completed_at)) p.alz_date = day(alz.completed_at)
    if (!(parseInt(String(c.alz_hrs ?? '')) >= 4)) p.alz_hrs = '4'
    setProof('alz_proof', 'dementia-care')
  }
  if (h.hire_date && !c.hire_date) p.hire_date = day(h.hire_date)
  if (h.first_contact_date && !c.first_contact) p.first_contact = day(h.first_contact_date)
  if (ojt && ojt.status === 'complete' && ojt.completed_at) { if (c.ojt_online !== day(ojt.completed_at)) p.ojt_online = day(ojt.completed_at); setProof('ojt_online_proof', 'on-the-job-training') }
  if (h.inservice_last_date) {
    if (c.annual_date !== day(h.inservice_last_date)) p.annual_date = day(h.inservice_last_date)
    const hrs = String(h.inservice_hours_12mo != null ? h.inservice_hours_12mo : '')
    if (hrs && String(c.annual_hrs ?? '') !== hrs) p.annual_hrs = hrs
    if (h.inservice_has_doc && !c.annual_proof) p.annual_proof = GENERIC_PROOF
  }
  if (!Object.keys(p).length) return null
  p.th_synced = nowIso
  return p
}
