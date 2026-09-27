// =============================================================================
// careplan-tasks — an approved care plan's tasks go into AxisCare (Change 5, 2026-09-27)
// =============================================================================
// Signed-in staff only. Writes to AxisCare ONLY on "push", sent by the hub's
// "Save + push". Nothing runs in the background.
//
//   catalog  AxisCare's own active task (ADL) list, for the picker
//   preview  read only: the plan's ticked tasks side by side with what the client
//            already has in AxisCare
//   push     the care plan note (as before, now with the coordinator's own sign-in),
//            then each ticked task: ADDED when the client doesn't have it; CHANGED only
//            when the coordinator ticked "update" for it; REMOVED only when the
//            coordinator clicked remove for that task. Then reads AxisCare back.
//   permission_check (service role) sends a deliberately invalid task request; the kind
//            of refusal says whether this connection may add tasks. Nothing is created.
// Diagnoses, medications and allergies have no place in AxisCare's API; they stay in the note.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const AC_VERSION = '2023-10-01'
export const DAYS = ['N', 'M', 'T', 'W', 'R', 'F', 'S']   // AxisCare: N = Sunday, R = Thursday

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
export type Task = { adl_id: number; name: string; key?: string; days: string[]; require: 1 | 2; when: number; instructions?: string }
/* AxisCare's rules, checked before anything is sent: at least one day; "as needed"
   (require 2) must be "any time" (when 0); one event per day. */
// deno-lint-ignore no-explicit-any
export function cleanTask(t: any): { task: Task | null; error: string | null } {
  const id = Number(t?.adl_id)
  if (!Number.isInteger(id) || id <= 0) return { task: null, error: 'no AxisCare task picked' }
  const days = [...new Set((Array.isArray(t?.days) ? t.days : []).map(String))].filter((d) => DAYS.includes(d)).sort((a, b) => DAYS.indexOf(a) - DAYS.indexOf(b))
  if (!days.length) return { task: null, error: `${t?.name || 'a task'}: pick at least one day` }
  const require = Number(t?.require) === 2 ? 2 : 1
  let when = Number(t?.when); if (!Number.isInteger(when) || when < 0 || when > 4) when = 0
  if (require === 2) when = 0
  const instructions = typeof t?.instructions === 'string' && t.instructions.trim() ? t.instructions.trim().slice(0, 2000) : undefined
  return { task: { adl_id: id, name: String(t?.name ?? ''), key: t?.key ? String(t.key) : undefined, days, require, when, instructions }, error: null }
}
export const events = (t: Task) => t.days.map((d) => ({ require: t.require, recur: d, when: t.when }))
// deno-lint-ignore no-explicit-any
export function sameTask(a: any, cat: { id: number; name: string; adlKey?: string }) {
  return (a?.key && cat.adlKey && String(a.key) === String(cat.adlKey)) || String(a?.name ?? '').trim().toLowerCase() === String(cat.name ?? '').trim().toLowerCase()
}
// deno-lint-ignore no-explicit-any
export function sameSettings(a: any, t: Task) {
  const ev = Array.isArray(a?.events) ? a.events : []
  const mine = new Set(events(t).map((e) => `${e.recur}|${e.require}|${e.when}`))
  const theirs = new Set(ev.map((e: { recur: string; require: number; when: number }) => `${e.recur}|${Number(e.require)}|${Number(e.when)}`))
  return mine.size === theirs.size && [...mine].every((x) => theirs.has(x)) && String(a?.instructions ?? '') === String(t.instructions ?? '')
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
  return (r.status === 403 ? 'AxisCare refused: this connection may not change care tasks' : 'AxisCare answered ' + r.status) + (m ? ' (' + String(m).slice(0, 240) + ')' : '')
}
const ok2 = (s: number) => s >= 200 && s < 300
// deno-lint-ignore no-explicit-any
async function listAll(path: string): Promise<{ list: any[]; error: string | null }> {
  const { site } = axisCreds()
  // deno-lint-ignore no-explicit-any
  const list: any[] = []; let url: string | null = path
  for (let i = 0; url && i < 20; i++) {
    const r = await ax('GET', url)
    if (r.status === 404 && i === 0) return { list, error: null }
    if (!ok2(r.status)) return { list, error: errText(r) }
    const d = r.json?.results?.data ?? r.json?.results ?? []
    list.push(...(Array.isArray(d) ? d : []))
    const next = r.json?.results?.nextPage ?? null
    url = typeof next === 'string' && next.startsWith(`https://${site}.axiscare.com/`) ? next.replace(`https://${site}.axiscare.com`, '') : null
  }
  return { list, error: null }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const { role, email } = jwtClaims(req.headers.get('Authorization'))
  const b = await req.json().catch(() => ({})) as Record<string, unknown>
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  if (b.action === 'permission_check') {
    if (role !== 'service_role') return json({ error: 'owner script only' }, 403)
    // an Active client is needed (AxisCare hides inactive ones); the body is deliberately invalid (no task, no events)
    const { data: cur } = await sb.from('client_status_current').select('axiscare_client_id').eq('label', 'Active').limit(1)
    const target = cur?.[0]?.axiscare_client_id
    if (!target) return json({ ok: false, detail: 'no Active client found to test against' })
    const r = await ax('POST', `/api/clients/${encodeURIComponent(String(target))}/adls`, {})
    if (ok2(r.status)) return json({ ok: false, status: r.status, detail: 'AxisCare accepted an empty task request; report this, it should not happen' })
    if (r.status === 400 || r.status === 422) return json({ ok: true, status: r.status, detail: 'AxisCare checked the request and refused it as invalid, which it only does for a caller allowed to add tasks: ' + errText(r) })
    return json({ ok: false, status: r.status, detail: errText(r) })
  }
  if (role !== 'authenticated' || !email) return json({ error: 'sign in to the hub first' }, 401)
  const action = String(b.action ?? '')

  const cat = await listAll('/api/adls?active=true&limit=500')
  if (cat.error) return json({ error: 'could not read AxisCare\'s task list: ' + cat.error }, 502)
  const catalog = cat.list.filter((a) => a && a.id != null && a.active !== false)
    .map((a) => ({ id: Number(a.id), name: String(a.name ?? ''), adlKey: a.adlKey ? String(a.adlKey) : undefined, categoryId: a.categoryId ?? null }))
    .sort((x, y) => x.name.localeCompare(y.name))
  if (action === 'catalog') return json({ catalog })

  const planId = typeof b.plan_id === 'string' && b.plan_id.length <= 80 ? b.plan_id : ''
  if (!['preview', 'push'].includes(action) || !planId) return json({ error: "action (catalog, preview or push) and plan_id are required" }, 400)
  const blob = async (key: string) => { const { data } = await sb.from('app_data').select('data').eq('key', key).maybeSingle(); return Array.isArray(data?.data) ? data!.data : [] }
  // deno-lint-ignore no-explicit-any
  const plan = (await blob('care_plans')).find((p: any) => p && p.id === planId)
  if (!plan) return json({ error: 'no such care plan (save it first)' }, 404)
  // deno-lint-ignore no-explicit-any
  const assess = (await blob('care_assessments')).find((a: any) => a && a.id === plan.assessment_id)
  const clientAx = assess?.axiscare_client_id ? String(assess.axiscare_client_id).trim() : ''
  if (!/^\d+$/.test(clientAx)) return json({ outcome: 'no_axiscare_id', detail: 'the assessment has no AxisCare client id yet; add it, then push' })

  const tasks: Task[] = [], taskErrors: string[] = []
  for (const t of (Array.isArray(plan.axiscare_tasks) ? plan.axiscare_tasks : [])) { const c = cleanTask(t); if (c.task) tasks.push(c.task); else taskErrors.push(c.error!) }
  const have = await listAll(`/api/clients/${clientAx}/adls`)
  if (have.error) return json({ error: 'could not read the client\'s tasks in AxisCare: ' + have.error }, 502)
  const side = tasks.map((t) => {
    const c = catalog.find((x) => x.id === t.adl_id) ?? { id: t.adl_id, name: t.name, adlKey: t.key }
    const there = have.list.find((a) => sameTask(a, c))
    return { task: t, name: c.name || t.name, axiscare: there ? { assignment_id: there.id, instructions: there.instructions ?? null, events: there.events ?? [] } : null,
             state: !there ? 'new' : sameSettings(there, t) ? 'same' : 'different', in_catalog: catalog.some((x) => x.id === t.adl_id) }
  })
  const others = have.list.filter((a) => !side.some((s) => s.axiscare && s.axiscare.assignment_id === a.id))
    .map((a) => ({ assignment_id: a.id, name: a.name, instructions: a.instructions ?? null, events: a.events ?? [] }))
  if (action === 'preview') return json({ client_ax: clientAx, tasks: side, others, task_errors: taskErrors, catalog_size: catalog.length })

  // ── push ─────────────────────────────────────────────────────────────────
  if (taskErrors.length) return json({ outcome: 'fix_tasks', task_errors: taskErrors })
  const updateIds = new Set((Array.isArray(b.update) ? b.update : []).map(Number))
  const removeIds = new Set((Array.isArray(b.remove) ? b.remove : []).map(String))
  const steps: Record<string, unknown>[] = []
  if (b.note !== false) {
    const note = typeof b.note_text === 'string' && b.note_text.trim() ? b.note_text.slice(0, 6000) : ''
    if (note) { const r = await ax('POST', `/api/notes/client/${clientAx}`, { note, important: true }); steps.push({ step: 'note', ok: ok2(r.status), detail: ok2(r.status) ? null : errText(r) }) }
  }
  for (const s of side) {
    if (!s.in_catalog) { steps.push({ step: 'task', name: s.name, ok: false, detail: 'no longer an active task in AxisCare\'s list; pick another' }); continue }
    if (s.state === 'new') {
      const r = await ax('POST', `/api/clients/${clientAx}/adls`, { id: s.task.adl_id, ...(s.task.instructions ? { instructions: s.task.instructions } : {}), events: events(s.task) })
      steps.push({ step: 'task', name: s.name, action: 'added', ok: ok2(r.status), detail: ok2(r.status) ? null : errText(r) })
    } else if (s.state === 'different' && updateIds.has(s.task.adl_id)) {
      const r = await ax('PATCH', `/api/clients/${clientAx}/adls/${encodeURIComponent(String(s.axiscare!.assignment_id))}`,
        { instructions: s.task.instructions ?? null, events: events(s.task) })
      steps.push({ step: 'task', name: s.name, action: 'updated', ok: ok2(r.status), detail: ok2(r.status) ? null : errText(r) })
    } else steps.push({ step: 'task', name: s.name, action: s.state === 'same' ? 'already the same' : 'left as AxisCare has it', ok: true })
  }
  for (const o of others) {
    if (!removeIds.has(String(o.assignment_id))) continue
    const r = await ax('DELETE', `/api/clients/${clientAx}/adls/${encodeURIComponent(String(o.assignment_id))}`)
    steps.push({ step: 'task', name: o.name, action: 'removed', ok: ok2(r.status), detail: ok2(r.status) ? null : errText(r) })
  }
  const after = await listAll(`/api/clients/${clientAx}/adls`)
  const readback = side.map((s) => {
    const c = catalog.find((x) => x.id === s.task.adl_id) ?? { id: s.task.adl_id, name: s.name }
    const there = after.list.find((a) => sameTask(a, c))
    const wantMine = s.state === 'new' || updateIds.has(s.task.adl_id)
    return { name: s.name, in_axiscare: !!there, as_planned: !!there && (!wantMine || sameSettings(there, s.task)) }
  })
  const allOk = steps.every((x) => x.ok) && readback.every((x) => x.in_axiscare && x.as_planned) && !after.error
  return json({ outcome: allOk ? 'pushed' : 'partly_pushed', all_confirmed: allOk,
    record: { at: new Date().toISOString(), by: email, client_ax: clientAx, steps, readback, readback_error: after.error } })
})
