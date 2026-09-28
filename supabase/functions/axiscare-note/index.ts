// =============================================================================
// axiscare-note — notes into AxisCare with the person's own sign-in, every one recorded (C2b, approved 2026-09-28)
// =============================================================================
// Replaces the older Training-project route (axiscare-convert-lead), which took a key every Hub user loads and found
// caregivers by name. Office staff only (requireStaff). Each note, sent or refused, adds one line to axiscare_change_log
// (who, when, which client or caregiver, the kind, how it went, the note's length; never its text).
//
//   client_note     {axiscare_client_id, note, kind: 'care_plan_note' | 'client_note'}
//   caregiver_note  {axiscare_caregiver_id, note}   by AxisCare number only, never a name. The caregiver is read from
//                   AxisCare first (so a wrong number is refused, and the answer says who it went to).
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const AC_VERSION = '2023-10-01'
const t = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '')
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

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
  const e = r.json?.errors; const m = Array.isArray(e) ? e.join('; ') : (e && typeof e === 'object' ? Object.values(e).join('; ') : '')
  return (r.status === 403 ? 'AxisCare refused: this connection may not write notes there' : r.status === 0 ? 'AxisCare could not be reached' : 'AxisCare answered ' + r.status)
    + (m ? ' (' + String(m).slice(0, 160) + ')' : '')
}
async function record(kind: string, subject: 'client' | 'caregiver', id: string, outcome: string, summary: string, detail: string | null, by: string) {
  const { data, error } = await sb.rpc('axiscare_change_record', { p_kind: kind, p_subject: subject,
    p_client: subject === 'client' ? id : null, p_caregiver: subject === 'caregiver' ? id : null,
    p_outcome: outcome, p_summary: summary, p_detail: detail, p_by: by, p_via: 'axiscare-note' })
  return !error && data?.outcome === 'recorded'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const staff = await requireStaff(sb, req, OFFICE_ROLES)
  if (!staff.ok) return json({ error: staff.error }, staff.status)
  const b = await req.json().catch(() => ({})) as Record<string, unknown>
  if (b.action !== 'client_note' && b.action !== 'caregiver_note') return json({ error: "action must be 'client_note' or 'caregiver_note'" }, 400)
  const note = t(b.note)
  if (!note) return json({ error: 'the note is empty' }, 400)
  if (note.length > 6000) return json({ error: 'the note is over 6,000 characters' }, 400)

  if (b.action === 'client_note') {
    const id = t(b.axiscare_client_id), kind = b.kind === 'care_plan_note' ? 'care_plan_note' : 'client_note'
    if (!/^\d+$/.test(id)) return json({ error: 'axiscare_client_id must be the client\'s AxisCare number' }, 400)
    const r = await ax('POST', `/api/notes/client/${id}`, { note, important: true })
    const sent = ok2(r.status)
    const recorded = await record(kind, 'client', id, sent ? 'sent' : 'refused', (kind === 'care_plan_note' ? 'care plan review note' : 'note') + ', ' + note.length + ' characters',
      sent ? null : errText(r), staff.email)
    return json(sent ? { outcome: 'sent', recorded } : { outcome: 'refused', detail: errText(r), recorded })
  }

  if (b.action === 'caregiver_note') {
    const id = t(b.axiscare_caregiver_id)
    if (!/^\d+$/.test(id)) return json({ error: 'axiscare_caregiver_id must be the caregiver\'s AxisCare number (never a name)' }, 400)
    const g = await ax('GET', `/api/caregivers/${id}`)
    const cg = g.json?.results?.caregiver ?? g.json?.results ?? null
    const name = cg ? [t(cg.firstName), t(cg.lastName)].filter(Boolean).join(' ') : ''
    if (g.status === 404 || (ok2(g.status) && !cg)) {
      await record('caregiver_note', 'caregiver', id, 'refused', 'note, ' + note.length + ' characters', 'no AxisCare caregiver with this number', staff.email)
      return json({ outcome: 'no_such_caregiver', detail: 'AxisCare has no caregiver #' + id })
    }
    if (!ok2(g.status)) {
      await record('caregiver_note', 'caregiver', id, 'refused', 'note, ' + note.length + ' characters', errText(g), staff.email)
      return json({ outcome: 'refused', detail: errText(g) })
    }
    const r = await ax('POST', `/api/notes/caregiver/${id}`, { note, important: true })
    const sent = ok2(r.status)
    const recorded = await record('caregiver_note', 'caregiver', id, sent ? 'sent' : 'refused', 'note, ' + note.length + ' characters', sent ? null : errText(r), staff.email)
    return json(sent ? { outcome: 'sent', caregiver: { axiscare_id: id, name }, recorded } : { outcome: 'refused', detail: errText(r), recorded })
  }

  return json({ error: "action must be 'client_note' or 'caregiver_note'" }, 400)
})
