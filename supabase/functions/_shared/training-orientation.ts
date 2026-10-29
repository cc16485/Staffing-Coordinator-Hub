// =============================================================================
// training-orientation.ts · the Training Platform's orientation facts, read and (only for the certificate) written by the
// Hub's server, through the Training project's own REST with the key the Hub already holds for job offers
// (OFFERS_PROJECT_URL / OFFERS_SERVICE_ROLE_KEY, the same door training-sync.ts uses). Never throws; a failure says why.
// =============================================================================
// deno-lint-ignore no-explicit-any
type Any = any
const S = (v: unknown, n = 200) => String(v ?? '').trim().slice(0, n)
const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '')
export const BUCKET = 'waiver-docs'
export const certPath = (tid: string) => `certificates/${tid}/agency-orientation.pdf`

function creds() { const url = Deno.env.get('OFFERS_PROJECT_URL') ?? '', key = Deno.env.get('OFFERS_SERVICE_ROLE_KEY') ?? ''; return url && key ? { url: url.replace(/\/$/, ''), key } : null }
const H = (key: string, extra: Record<string, string> = {}) => ({ apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra })

export type TOrient = { training_id: string; name: string; status: string | null; completed_at: string | null; completion_doc_path: string | null; completed_by: string | null; certificate: boolean }
/** AxisCare number -> that caregiver's Training orientation (only caregivers on the Training Platform). certFor: which
    Training ids to check for a stored certificate (the storage listing is one call per person, so only those that matter). */
export type Earlier = { training_id: string; name: string; completed_at: string; doc: string | null }
export async function readOrientation(send: typeof fetch = fetch, certFor?: (row: TOrient) => boolean): Promise<{ ok: true; byAx: Map<string, TOrient>; earlier: Earlier[] } | { ok: false; why: string }> {
  const c = creds(); if (!c) return { ok: false, why: 'the Training Platform connection is not set on this project' }
  try {
    const get = async (q: string) => { const r = await send(`${c.url}/rest/v1/${q}`, { headers: H(c.key) }); if (!r.ok) throw new Error(`Training answered ${r.status} for ${q.split('?')[0]}`); return await r.json() }
    const cgs: Any[] = await get('caregivers?select=id,axiscare_id,name&active=eq.true')
    const course: Any[] = await get('courses?slug=eq.agency-orientation&select=id')
    if (!course?.[0]?.id) return { ok: false, why: 'the Training Platform has no Agency Orientation course' }
    let ens: Any[] = []
    try { ens = await get(`enrollments?course_id=eq.${encodeURIComponent(course[0].id)}&select=caregiver_id,status,completed_at,completion_doc_path,completed_by`) }
    catch { ens = await get(`enrollments?course_id=eq.${encodeURIComponent(course[0].id)}&select=caregiver_id,status,completed_at,completion_doc_path`) }
    const byAx = new Map<string, TOrient>()
    for (const g of cgs || []) {
      const ax = digits(g?.axiscare_id); if (!ax || !g?.id) continue
      const e = (ens || []).find((x) => x?.caregiver_id === g.id)
      byAx.set(ax, { training_id: String(g.id), name: S(g.name, 80), status: e ? S(e.status, 20) : null, completed_at: e?.completed_at ?? null,
        completion_doc_path: S(e?.completion_doc_path, 300) || null, completed_by: S(e?.completed_by, 80) || null, certificate: false })
    }
    for (const t of byAx.values()) if (!certFor || certFor(t)) t.certificate = await hasCertificate(t.training_id, send)
    /* REHIRES (Samantha 2026-10-28, Rachel Simmons): an earlier, no-longer-active Training record with a finished orientation.
       Only ever offered to the office as a suggestion by name; never linked on its own. */
    const earlier: Earlier[] = []
    try {
      const old: Any[] = await get('caregivers?select=id,name&active=eq.false')
      for (const g of old || []) {
        const e = (ens || []).find((x) => x?.caregiver_id === g.id)
        if (e && S(e.status, 20) === 'complete' && /^\d{4}-\d\d-\d\d/.test(S(e.completed_at, 30)))
          earlier.push({ training_id: String(g.id), name: S(g.name, 80), completed_at: S(e.completed_at, 10), doc: S(e.completion_doc_path, 300) || null })
      }
    } catch { /* no suggestions rather than wrong ones */ }
    return { ok: true, byAx, earlier }
  } catch (e) { return { ok: false, why: 'could not read the Training Platform: ' + String((e as Error)?.message ?? e).slice(0, 160) } }
}
export async function hasCertificate(tid: string, send: typeof fetch = fetch): Promise<boolean> {
  const c = creds(); if (!c || !tid) return false
  try {
    const r = await send(`${c.url}/storage/v1/object/list/${BUCKET}`, { method: 'POST', headers: H(c.key), body: JSON.stringify({ prefix: `certificates/${tid}/`, limit: 100 }) })
    const j = r.ok ? await r.json() : null
    return Array.isArray(j) && j.some((o: Any) => S(o?.name, 120) === 'agency-orientation.pdf')
  } catch { return false }
}
/** Store a made certificate where the Training Platform keeps its own. Never overwrites one already there. */
export async function storeCertificate(tid: string, bytes: Uint8Array, send: typeof fetch = fetch): Promise<{ ok: boolean; why: string | null; already?: boolean }> {
  const c = creds(); if (!c) return { ok: false, why: 'the Training Platform connection is not set' }
  try {
    const r = await send(`${c.url}/storage/v1/object/${BUCKET}/${certPath(tid)}`, { method: 'POST', headers: { apikey: c.key, Authorization: `Bearer ${c.key}`, 'Content-Type': 'application/pdf', 'x-upsert': 'false' }, body: bytes })
    if (r.ok) return { ok: true, why: null }
    const t = await r.text().catch(() => '')
    if (r.status === 409 || /exists|Duplicate/i.test(t)) return { ok: true, why: null, already: true }
    return { ok: false, why: `the Training Platform storage answered ${r.status}` }
  } catch (e) { return { ok: false, why: 'could not reach the Training Platform storage: ' + String((e as Error)?.message ?? e).slice(0, 120) } }
}
/** A short-lived link to open a Training Platform document (a certificate, or an after-the-fact completion document). */
export async function signedLink(path: string, send: typeof fetch = fetch): Promise<string | null> {
  const c = creds(); const p = S(path, 400).replace(/^training:/, '')
  if (!c || !p || p.includes('..') || !/^(certificates|prior)\//.test(p)) return null
  try {
    const r = await send(`${c.url}/storage/v1/object/sign/${BUCKET}/${p}`, { method: 'POST', headers: H(c.key), body: JSON.stringify({ expiresIn: 300 }) })
    const j = r.ok ? await r.json() : null
    const u = S(j?.signedURL ?? j?.signedUrl, 2000)
    return u ? (u.startsWith('http') ? u : `${c.url}/storage/v1${u.startsWith('/') ? '' : '/'}${u}`) : null
  } catch { return null }
}

/** "Send orientation link" (a person in the office pressed it): assign orientation on the Training Platform when they have no
    orientation yet (never resets one already started), then ask the Training Platform's own send-invite to text and email their
    personal link, with its own wording, opt-out and text-hours rules. Never for someone who already finished. */
export async function sendOrientationLink(trainingId: string, send: typeof fetch = fetch): Promise<{ ok: boolean; why: string | null; assigned: boolean; result?: Any }> {
  const c = creds(); if (!c) return { ok: false, why: 'the Training Platform connection is not set', assigned: false }
  try {
    const course = await (await send(`${c.url}/rest/v1/courses?slug=eq.agency-orientation&select=id`, { headers: H(c.key) })).json()
    const cid = course?.[0]?.id; if (!cid) return { ok: false, why: 'the Training Platform has no Agency Orientation course', assigned: false }
    const er = await send(`${c.url}/rest/v1/enrollments?caregiver_id=eq.${encodeURIComponent(trainingId)}&course_id=eq.${encodeURIComponent(cid)}&select=status`, { headers: H(c.key) })
    const ex = er.ok ? await er.json() : null
    if (!Array.isArray(ex)) return { ok: false, why: 'the Training Platform did not answer', assigned: false }
    if (ex[0]?.status === 'complete') return { ok: false, why: 'they already finished orientation', assigned: false }
    let assigned = false
    if (!ex.length) {
      const ins = await send(`${c.url}/rest/v1/enrollments`, { method: 'POST', headers: H(c.key, { Prefer: 'return=minimal' }),
        body: JSON.stringify({ caregiver_id: trainingId, course_id: cid, status: 'not_started', progress: 0, requirement: 'pre_service' }) })
      if (!ins.ok) return { ok: false, why: `orientation could not be assigned (the Training Platform answered ${ins.status})`, assigned: false }
      assigned = true
    }
    const r = await send(`${c.url}/functions/v1/send-invite`, { method: 'POST', headers: H(c.key), body: JSON.stringify({ caregiver_id: trainingId, course_slug: 'agency-orientation' }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || j?.error) return { ok: false, why: 'the link was not sent: ' + S(j?.error || `the Training Platform answered ${r.status}`, 160), assigned }
    return { ok: true, why: null, assigned, result: { channels: j.channels || [], not_sent: j.not_sent || [] } }
  } catch (e) { return { ok: false, why: 'could not reach the Training Platform: ' + String((e as Error)?.message ?? e).slice(0, 120), assigned: false } }
}
