// =============================================================================
// care-level — AxisCare's class is the care level once someone is in care (Change 6b, 2026-09-27)
// =============================================================================
// Signed-in staff only. Reads are read-only; "set" writes AxisCare only on a
// coordinator's click after a care plan review found a different level.
//
//   levels   every ACTIVE client's level from their AxisCare classes (one census read)
//   client   one client's level {axiscare_client_id | episode_id}
//   vocab    AxisCare's client classes, and how the shared rule reads each (level / payer / other)
//   set      {axiscare_client_id, level}: replaces ONLY the level class. Every other class
//            (payer and anything else) is kept exactly. The target class must be the ONE class
//            in AxisCare's own list that reads as that level; otherwise it refuses and says
//            to change it in AxisCare. Reads the client back and confirms.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

/* C2a (2026-09-28): every change in AxisCare adds one line to axiscare_change_log (who, when, which client or caregiver,
   the kind, how it went, a short summary; never note text). Best effort: recording never blocks the change itself. */
// deno-lint-ignore no-explicit-any
async function recordAxisChange(db: any, c: { kind: string; subject: 'client' | 'caregiver'; client?: string | null; caregiver?: string | null;
  outcome: 'sent_confirmed' | 'sent' | 'refused' | 'practice'; summary: string; detail?: string | null; by: string; via: string }): Promise<boolean> {
  try {
    const { data, error } = await db.rpc('axiscare_change_record', { p_kind: c.kind, p_subject: c.subject, p_client: c.client ?? null,
      p_caregiver: c.caregiver ?? null, p_outcome: c.outcome, p_summary: String(c.summary).slice(0, 200), p_detail: c.detail ? String(c.detail).slice(0, 300) : null,
      p_by: c.by || 'unknown', p_via: c.via })
    return !error && data?.outcome === 'recorded'
  } catch { return false }
}
import { careLevelOf, levelFromLabel, LEVEL_NAMES } from '../_shared/care-level.ts'
import { KNOWN_PAYERS } from '../_shared/client-events.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const AC_VERSION = '2023-10-01'

export function jwtClaims(authHeader: string | null): { role: string | null; email: string | null } {
  const m = /^Bearer\s+(.+)$/.exec(authHeader ?? '')
  if (!m) return { role: null, email: null }
  const parts = m[1].split('.')
  if (parts.length !== 3) return { role: null, email: null }
  try {
    const p = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    return { role: typeof p.role === 'string' ? p.role : null,
             email: typeof p.email === 'string' ? p.email.trim().toLowerCase() : null }
  } catch { return { role: null, email: null } }
}
// deno-lint-ignore no-explicit-any
const rows = (v: any): any[] => Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : [])
const lab = (c: { label?: unknown; code?: unknown }) => String(c?.label ?? c?.code ?? '').trim()
const PAYER_WORDS = /medicaid|medicare|private|\bpay\b|payor|payer|\bva\b|veteran|\bltc\b|long[\s-]*term|\bcds\b|guide|insurance/i
export const isPayer = (label: string) => KNOWN_PAYERS.includes(label.trim().toLowerCase()) || PAYER_WORDS.test(label)
/* 'mixed' = a class that names BOTH a payer and a level (the audited classes mix): never removed, never used */
export const readsAs = (label: string): 'level' | 'payer' | 'mixed' | 'other' => {
  const lv = levelFromLabel(label) != null, pay = isPayer(label)
  return lv && pay ? 'mixed' : pay ? 'payer' : lv ? 'level' : 'other'
}
/* the new class list: everything that is NOT a level class, plus the one target class */
// deno-lint-ignore no-explicit-any
export function newClasses(current: any[], target: { code?: string; label?: string }) {
  const keep = current.filter((c) => readsAs(lab(c)) !== 'level').map((c) => ({ ...(c?.code ? { code: c.code } : {}), ...(c?.label ? { label: c.label } : {}) }))
  return [...keep, { ...(target.code ? { code: target.code } : {}), ...(target.label ? { label: target.label } : {}) }]
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
// deno-lint-ignore no-explicit-any
const errText = (r: { status: number; json: any }) => {
  const e = r.json?.errors; const m = Array.isArray(e) ? e.filter(Boolean).join('; ') : (e && typeof e === 'object' ? Object.values(e).join('; ') : '')
  return (r.status === 403 ? 'AxisCare refused: this connection may not change clients' : 'AxisCare answered ' + r.status) + (m ? ' (' + String(m).slice(0, 240) + ')' : '')
}
const ok2 = (s: number) => s >= 200 && s < 300
// deno-lint-ignore no-explicit-any
const view = (cl: any) => { const lv = careLevelOf(cl?.classes); return { level: lv.level, level_name: lv.level ? LEVEL_NAMES[lv.level] : null, from: lv.from, classes: rows(cl?.classes).map(lab) } }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const { role, email } = jwtClaims(req.headers.get('Authorization'))
  const b = await req.json().catch(() => ({})) as Record<string, unknown>
  const action = String(b.action ?? '')
  /* the owner script (service role) may use the READ actions for its report; only a signed-in person can "set" */
  if (!((role === 'authenticated' && email) || (role === 'service_role' && action !== 'set'))) return json({ error: 'sign in to the hub first' }, 401)
  const { site } = axisCreds()

  if (action === 'levels') {
    const out: Record<string, unknown> = {}
    let url: string | null = '/api/clients'
    for (let i = 0; url && i < 15; i++) {
      const r = await ax('GET', url)
      if (!ok2(r.status)) return json({ error: 'could not read AxisCare clients: ' + errText(r) }, 502)
      for (const c of rows(r.json?.results?.clients ?? r.json?.results)) {
        if (c?.id == null || c?.status?.active !== true) continue
        out[String(c.id)] = view(c)
      }
      const next = r.json?.results?.nextPage ?? null
      url = typeof next === 'string' && next.startsWith(`https://${site}.axiscare.com/`) ? next.replace(`https://${site}.axiscare.com`, '') : null
    }
    return json({ levels: out, at: new Date().toISOString() })
  }
  if (action === 'vocab') {
    const r = await ax('GET', '/api/classes/client')
    if (!ok2(r.status)) return json({ error: 'could not read AxisCare\'s class list: ' + errText(r) }, 502)
    return json({ classes: rows(r.json?.results?.classes ?? r.json?.results).map((c) => ({ code: c?.code ?? null, label: c?.label ?? null, reads_as: readsAs(lab(c)), level: levelFromLabel(lab(c)) })) })
  }

  let clientAx = typeof b.axiscare_client_id === 'string' || typeof b.axiscare_client_id === 'number' ? String(b.axiscare_client_id).trim() : ''
  if (!clientAx && typeof b.episode_id === 'string') {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: ep } = await sb.from('journey_episode').select('person_id').eq('episode_id', b.episode_id).maybeSingle()
    if (ep?.person_id) {
      const { data: src } = await sb.from('person_source_id').select('source_id').eq('person_id', ep.person_id).eq('system', 'axiscare').eq('entity_type', 'client').maybeSingle()
      clientAx = src?.source_id ? String(src.source_id) : ''
    }
  }
  if (!/^\d+$/.test(clientAx)) return json({ outcome: 'no_axiscare_id' })
  const g = await ax('GET', `/api/clients/${clientAx}`)
  const cl = g.json?.results?.client ?? g.json?.results
  if (!ok2(g.status) || !cl) return json({ error: 'could not read the client in AxisCare: ' + errText(g) }, 502)
  if (action === 'client') return json({ outcome: 'ok', axiscare_client_id: clientAx, ...view(cl) })
  if (action !== 'set') return json({ error: "action must be 'levels', 'client', 'vocab' or 'set'" }, 400)

  const level = Number(b.level)
  if (![1, 2, 3].includes(level)) return json({ outcome: 'level_required' })
  const before = view(cl)
  if (before.level === level) return json({ outcome: 'already', ...before })
  const v = await ax('GET', '/api/classes/client')
  if (!ok2(v.status)) return json({ outcome: 'refused', detail: 'could not read AxisCare\'s class list: ' + errText(v) })
  const targets = rows(v.json?.results?.classes ?? v.json?.results).filter((c) => readsAs(lab(c)) === 'level' && levelFromLabel(lab(c)) === level)
  if (targets.length !== 1) return json({ outcome: 'no_single_class', detail: targets.length
    ? `AxisCare has ${targets.length} classes that read as Level ${level} (${targets.map(lab).join(', ')}); change it in AxisCare`
    : `AxisCare has no class that reads as Level ${level}; change it in AxisCare` })
  const current = rows(cl?.classes)
  const mixed = current.map(lab).filter((c) => readsAs(c) === 'mixed')
  if (mixed.length) return json({ outcome: 'mixed_class', detail: `this client has a class that names both a payer and a level (${mixed.join(', ')}); change the level in AxisCare so the payer isn't touched` })
  const next = newClasses(current, targets[0])
  const recDb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const what = 'care level ' + (before.level ?? '?') + ' → ' + level
  const p = await ax('PATCH', `/api/clients/${clientAx}`, { classes: next })
  if (!ok2(p.status)) {
    await recordAxisChange(recDb, { kind: 'care_level', subject: 'client', client: clientAx, outcome: 'refused', summary: what, detail: errText(p), by: email ?? '', via: 'care-level' })
    return json({ outcome: 'refused', detail: errText(p) })
  }
  const back = await ax('GET', `/api/clients/${clientAx}`)
  const after = view(back.json?.results?.client ?? back.json?.results)
  const kept = before.classes.filter((c) => readsAs(c) !== 'level')
  const keptOk = kept.every((c) => after.classes.includes(c))
  const recorded = await recordAxisChange(recDb, { kind: 'care_level', subject: 'client', client: clientAx, outcome: after.level === level && keptOk ? 'sent_confirmed' : 'sent',
    summary: what, detail: after.level === level && keptOk ? null : 'the read-back did not show it exactly', by: email ?? '', via: 'care-level' })
  return json({ outcome: after.level === level && keptOk ? 'updated' : 'updated_check', before, after, kept_classes: kept, kept_ok: keptOk, by: email, recorded })
})
