// =============================================================================
// axiscare-caregiver.ts · SLICE 5 (Samantha: "start slice 5", 2026-10-10): the ONE way the Hub sets a caregiver Active in
// AxisCare, with the read-back and the change-log record (her rule 7: Approved to Work shows only after AxisCare confirms).
//   setCaregiverActive(db, id, by, via, live)
//     live=false  nothing is sent; the change log records 'practice' and the answer says so
//     live=true   PATCH /api/caregivers/{id} { status: 'Active' } (the caregiver's own record, by id; the spec has no PATCH
//                 on the list), then GET it back: 'confirmed' only when the read-back says status.active and the label
//                 'Active'; 'sent' when AxisCare accepted but the read-back did not show it; 'refused' with AxisCare's words
//   readCaregiverStatus(id)  read only: { active, label, hire_date }
// Every outcome is one row in axiscare_change_log (kind caregiver_status). Never a name, never a health detail.
// deno-lint-ignore-file no-explicit-any
export const AC_VERSION = '2023-10-01'
export function axisCreds() {
  let token = ''
  for (const n of ['AXISCARE_API_KEY', 'AXISCARE_TOKEN']) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  return { token, site: /^\d+$/.test(site) ? site : '' }
}
export async function ax(method: string, path: string, body?: unknown, send: typeof fetch = fetch): Promise<{ status: number; json: any }> {
  const { token, site } = axisCreds()
  if (!token || !site) return { status: 0, json: { errors: ['AxisCare credentials not set'] } }
  try {
    const r = await send(`https://${site}.axiscare.com${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'X-AxisCare-Api-Version': AC_VERSION, Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined })
    const t = await r.text(); let j: any = null; try { j = t ? JSON.parse(t) : null } catch { j = { raw: t.slice(0, 200) } }
    return { status: r.status, json: j }
  } catch (e) { return { status: 0, json: { errors: ['could not reach AxisCare: ' + String((e as Error)?.message ?? e).slice(0, 120)] } } }
}
const ok2 = (s: number) => s >= 200 && s < 300
export const errText = (r: { status: number; json: any }) => {
  const e = r?.json?.errors ?? r?.json?.error ?? r?.json?.message ?? r?.json?.raw
  const s = Array.isArray(e) ? e.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join('; ') : (typeof e === 'string' ? e : (e ? JSON.stringify(e) : ''))
  return `AxisCare answered ${r?.status || 'nothing'}${s ? ': ' + s.slice(0, 200) : ''}`
}
const cgOf = (r: { json: any }) => r?.json?.results?.caregiver ?? r?.json?.caregiver ?? (r?.json && r.json.id != null ? r.json : null)

export type StatusRead = { ok: true; active: boolean; label: string; hire_date: string | null } | { ok: false; detail: string }
export async function readCaregiverStatus(id: string, send: typeof fetch = fetch): Promise<StatusRead> {
  if (!/^\d{1,12}$/.test(String(id))) return { ok: false, detail: 'not an AxisCare caregiver number' }
  const g = await ax('GET', `/api/caregivers/${id}`, undefined, send)
  const c = cgOf(g)
  if (!ok2(g.status) || !c) return { ok: false, detail: 'could not read the caregiver in AxisCare: ' + errText(g) }
  return { ok: true, active: c?.status?.active === true, label: String(c?.status?.label ?? ''), hire_date: c?.hireDate ? String(c.hireDate).slice(0, 10) : null }
}

export async function recordAxisChange(db: any, c: { kind: string; caregiver: string; outcome: 'sent_confirmed' | 'sent' | 'refused' | 'practice'; summary: string; detail?: string | null; by: string; via: string }): Promise<boolean> {
  try {
    const { data, error } = await db.rpc('axiscare_change_record', { p_kind: c.kind, p_subject: 'caregiver', p_client: null, p_caregiver: c.caregiver,
      p_outcome: c.outcome, p_summary: String(c.summary).slice(0, 200), p_detail: c.detail ? String(c.detail).slice(0, 300) : null, p_by: c.by || 'unknown', p_via: c.via })
    return !error && data?.outcome === 'recorded'
  } catch { return false }
}

export type Activate = { outcome: 'confirmed' | 'sent' | 'refused' | 'practice' | 'no_credentials'; label?: string; active?: boolean; hire_date?: string | null; detail?: string; recorded: boolean }
/** Set this caregiver Active in AxisCare (live) or record what would have been done (practice). One change-log row either way. */
export async function setCaregiverActive(db: any, id: string, by: string, via: string, live: boolean, send: typeof fetch = fetch): Promise<Activate> {
  const cg = String(id)
  if (!/^\d{1,12}$/.test(cg)) return { outcome: 'refused', detail: 'not an AxisCare caregiver number', recorded: false }
  if (!live) {
    const recorded = await recordAxisChange(db, { kind: 'caregiver_status', caregiver: cg, outcome: 'practice', summary: 'Approve to Work: would set the caregiver Active (practice, switch off)', by, via })
    return { outcome: 'practice', recorded }
  }
  const { token, site } = axisCreds()
  if (!token || !site) return { outcome: 'no_credentials', detail: 'AxisCare credentials are not set on this project', recorded: false }
  const p = await ax('PATCH', `/api/caregivers/${cg}`, { status: 'Active' }, send)
  if (!ok2(p.status)) {
    const recorded = await recordAxisChange(db, { kind: 'caregiver_status', caregiver: cg, outcome: 'refused', summary: 'Approve to Work: set the caregiver Active', detail: errText(p), by, via })
    return { outcome: 'refused', detail: errText(p), recorded }
  }
  const back = await readCaregiverStatus(cg, send)
  const good = back.ok && back.active === true && /^active$/i.test(back.label)
  const recorded = await recordAxisChange(db, { kind: 'caregiver_status', caregiver: cg, outcome: good ? 'sent_confirmed' : 'sent', summary: 'Approve to Work: set the caregiver Active',
    detail: good ? 'read back: Active' : (back.ok ? `read back: ${back.label || 'no label'} (active ${back.active})` : back.detail), by, via })
  return good ? { outcome: 'confirmed', label: back.label, active: true, hire_date: back.hire_date, recorded }
    : { outcome: 'sent', detail: back.ok ? `AxisCare accepted the change but reads back "${back.label || 'no label'}"` : back.detail, label: back.ok ? back.label : undefined, active: back.ok ? back.active : undefined, recorded }
}
