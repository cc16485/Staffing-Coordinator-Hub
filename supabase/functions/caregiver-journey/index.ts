// =============================================================================
// caregiver-journey · SLICE 3b (Samantha approved Migrations A and B, 2026-10-10): the one new-hire readiness view's server
// =============================================================================
// The offer-to-Approved-to-Work journey on the same tables and rules file as the client journey (plan section 29).
//   { action: 'get', offer_id | journey_id }   (staff)   the journey, its computed view, every step, the history, the facts the
//                                                          rows were verified from, and `may`: which rows THIS person may confirm
//   { action: 'list' }                         (staff)   every open caregiver journey with its next move and owner
//   { action: 'confirm', journey_id, step_key } (staff)  a 'confirmed' row, by the Admin list its catalog row names (advance,
//                                                          work = owners only, screening, office); permanent history
//   { action: 'record', journey_id, step_key, result, document, expires? } (staff by list)  a 'proof' row the office records
//                                                          (credentials): result + document required
//   { action: 'not_needed', journey_id, step_key, reason } (owners only)
//   { action: 'sweep' }                        (job)     every open caregiver journey: verify the rows the records satisfy
//                                                          (offer, Step 1, checks with their documents, references, welcome
//                                                          call, roster training dates, profile), write states and events
// Fictional offers only: a caregiver journey exists only for new-path offers (none real until the switch date). No sends.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { jobCaller } from '../_shared/job-auth.ts'
import { PERM_KEY, normalizePerms, mayApprove } from '../_shared/onboarding-permissions.ts'
import { R, facts, verifyRows, type Facts } from '../_shared/caregiver-journey.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
// deno-lint-ignore no-explicit-any
type Any = any
const S = (v: unknown, n = 160) => String(v ?? '').trim().slice(0, n)
const DONE = ['complete', 'not_needed', 'exception']

function trn() {
  const url = Deno.env.get('OFFERS_PROJECT_URL') ?? '', key = Deno.env.get('OFFERS_SERVICE_ROLE_KEY') ?? ''
  if (!url || !key) return null
  const H = { apikey: key, Authorization: `Bearer ${key}` }
  return { async get(id: string) { const r = await fetch(`${url}/rest/v1/job_offers?id=eq.${encodeURIComponent(id)}&select=id,first_name,last_name,offer_signed_at,pd_signed_at,offer_version,pd_version,offer_status,onboarding_path,step1_done_at`, { headers: H }); if (!r.ok) return null; const rows = await r.json(); return Array.isArray(rows) && rows.length === 1 ? rows[0] : null } }
}
async function defs(db: Any): Promise<Any[]> {
  const { data, error } = await db.from('client_journey_step_def').select('key, def, active, catalog_version').like('key', 'cg.%')
  if (error) throw new Error('could not read the caregiver catalog')
  return (data ?? []).filter((d: Any) => d.active !== false).map((d: Any) => ({ key: d.key, active: d.active, ...(d.def || {}) }))
}
async function load(db: Any, by: { journey_id?: unknown; offer_id?: unknown }) {
  let q = db.from('client_journey').select('*').eq('subject', 'caregiver')
  q = by.journey_id ? q.eq('journey_id', S(by.journey_id, 64)) : q.eq('offer_id', S(by.offer_id, 64))
  const { data: j } = await q.maybeSingle(); if (!j) return null
  const { data: steps } = await db.from('client_journey_step').select('*').eq('journey_id', j.journey_id)
  return { j, steps: steps ?? [] }
}
async function putStep(db: Any, journeyId: string, key: string, patch: Any) {
  const { data: cur } = await db.from('client_journey_step').select('version').eq('journey_id', journeyId).eq('step_key', key).maybeSingle()
  const row = { journey_id: journeyId, step_key: key, ...patch, version: (cur?.version ?? 0) + 1, updated_at: new Date().toISOString() }
  const { error } = await db.from('client_journey_step').upsert(row, { onConflict: 'journey_id,step_key' })
  if (error) throw new Error('could not save the step: ' + error.message)
}
async function event(db: Any, journeyId: string, step: string | null, who: { email?: string; name?: string }, kind: string, detail: Any = {}, reason: string | null = null) {
  await db.from('client_journey_event').insert({ journey_id: journeyId, step_key: step, actor_email: who.email || 'hub', actor_name: who.name || 'The Hub', kind, detail, reason })
}
async function perms(db: Any) { const { data } = await db.from('app_data').select('data').eq('key', PERM_KEY).maybeSingle(); return normalizePerms(data?.data) }
async function settings(db: Any) { const { data } = await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle(); return (data?.data && typeof data.data === 'object') ? data.data : {} }
/** May this signed-in person complete this row? By the Admin list the catalog row names. */
function mayDo(def: Any, who: Any, P: Any): boolean {
  const p = def?.permission || 'office'
  if (p === 'hub') return false
  if (p === 'office') return true
  if (p === 'advance' || p === 'work' || p === 'screening') return mayApprove(P, p, { person_id: who.person_id, roles: who.roles || [], email: who.email })
  return false
}
const ctxFor = (f: Facts, st: Any) => ({ today: new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10), facts: { lived_outside_mo: f.lived_outside_mo, claims_cna_or_hha: f.claims_cna_or_hha, drives_clients: f.drives_clients, after_first_year: f.after_first_year }, staffing_email: S(st?.staffing_email, 160).toLowerCase() || null, owner_emails: [] })
const dates = (f: Facts) => { const o = f.roster?.orient_date ? String(f.roster.orient_date).slice(0, 10) : null, h = f.roster?.hire_date ? String(f.roster.hire_date).slice(0, 10) : null; return { orientation: o, axiscare_hire: h, differ: !!(o && h && o !== h) } }

/** Apply the verdicts the facts give: complete or blocked rows, with evidence and events; never un-complete a confirmed row. */
async function applyVerdicts(db: Any, j: Any, steps: Any[], f: Facts, now: string): Promise<number> {
  const by = Object.fromEntries(steps.map((s) => [s.step_key, s])); let changed = 0
  for (const v of verifyRows(f, now)) {
    const st = by[v.key]
    if (v.state === 'complete') {
      const newer = st?.state === 'complete' && st.completed_at && v.at && Date.parse(v.at) > Date.parse(st.completed_at) + 60000
      if (st && DONE.includes(st.state) && !newer) continue
      await putStep(db, j.journey_id, v.key, { state: 'complete', evidence: { verified: { at: now, by: 'hub' }, ...v.evidence }, completed_by: 'hub', completed_by_name: 'The Hub (verified)', completed_at: v.at, blocked_reason: null })
      await event(db, j.journey_id, v.key, {}, newer ? 'reverified' : 'verified', v.evidence); changed++
    } else if (v.state === 'blocked') {
      if (st && (st.state === 'blocked' || DONE.includes(st.state))) continue
      await putStep(db, j.journey_id, v.key, { state: 'blocked', blocked_reason: v.reason, evidence: { ...(st?.evidence || {}), flagged: v.evidence } })
      await event(db, j.journey_id, v.key, {}, 'blocked', v.evidence, v.reason || null); changed++
    }
  }
  return changed
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false, autoRefreshToken: false } })
  const b: Any = await req.json().catch(() => ({}))
  const action = S(b.action, 20)
  try {
    const dfs = await defs(db)
    if (action === 'sweep') {
      const caller = await jobCaller(req)
      if (!caller) return json({ error: 'the sweep is for the schedule or an owner' }, 401)
      const T = trn(), st = await settings(db), now = new Date().toISOString()
      const { data: js } = await db.from('client_journey').select('*').eq('subject', 'caregiver').eq('status', 'open').limit(500)
      const out: Record<string, unknown> = { looked_at: (js ?? []).length, changed: 0, completed: 0 }
      for (const j of js ?? []) {
        const { data: steps } = await db.from('client_journey_step').select('*').eq('journey_id', j.journey_id)
        const f = await facts(db, j, T)
        const n = await applyVerdicts(db, j, steps ?? [], f, now); (out.changed as number) += n
        const { data: fresh } = await db.from('client_journey_step').select('*').eq('journey_id', j.journey_id)
        const view = R.compute(dfs, j, fresh ?? [], ctxFor(f, st))
        if (view.complete && j.status === 'open') { await db.from('client_journey').update({ status: 'active', updated_at: now }).eq('journey_id', j.journey_id); await event(db, j.journey_id, null, {}, 'complete', { all: true }); (out.completed as number)++ }
      }
      return json({ ok: true, ...out })
    }
    const who = await requireStaff(db, req, OFFICE_ROLES)
    if (!who.ok) return json({ error: who.error }, who.status)
    const P = await perms(db), st = await settings(db), isOwner = (who.roles || []).includes('owner_admin')
    if (action === 'list') {
      const T = trn()
      const { data: js } = await db.from('client_journey').select('*').eq('subject', 'caregiver').in('status', ['open', 'active']).order('created_at', { ascending: false }).limit(200)
      const rows = []
      for (const j of js ?? []) {
        const { data: steps } = await db.from('client_journey_step').select('*').eq('journey_id', j.journey_id)
        const f = await facts(db, j, null); const v = R.compute(dfs, j, steps ?? [], ctxFor(f, st))
        const aw = (v.rows || []).find((r: Any) => r.key === 'cg.approve.work')
        rows.push({ journey_id: j.journey_id, offer_id: j.offer_id, name: j.client_name, status: j.status, stage: v.stageLabel, next: v.next ? { key: v.next.key, title: v.next.def.title, owner: v.next.owner, attention: v.next.attention || null } : null, complete: v.complete, approved_to_work: aw?.status === 'complete', blocked: (v.rows || []).filter((r: Any) => r.status === 'blocked').map((r: Any) => r.def.title) })
      }
      void T; return json({ ok: true, rows })
    }
    if (action === 'get') {
      const got = await load(db, b); if (!got) return json({ ok: true, journey: null })
      const f = await facts(db, got.j, trn())
      const view = R.compute(dfs, got.j, got.steps, ctxFor(f, st))
      const { data: ev } = await db.from('client_journey_event').select('*').eq('journey_id', got.j.journey_id).order('at', { ascending: false }).limit(200)
      const may: Record<string, boolean> = {}; for (const r of view.rows) may[r.key] = mayDo(r.def, who, P)
      return json({ ok: true, journey: got.j, steps: got.steps, view, events: ev ?? [], may, is_owner: isOwner, facts: { lived_outside_mo: f.lived_outside_mo ?? null, claims_cna_or_hha: f.claims_cna_or_hha ?? null, drives_clients: f.drives_clients ?? null, dates: dates(f) } })
    }
    const got = await load(db, b); if (!got) return json({ error: 'That readiness card was not found.' }, 404)
    const key = S(b.step_key, 60); const def = dfs.find((d) => d.key === key)
    if (!def) return json({ error: 'Which requirement?' }, 400)
    const f = await facts(db, got.j, trn()); const view = R.compute(dfs, got.j, got.steps, ctxFor(f, st)); const row = view.rows.find((r: Any) => r.key === key)
    const answer = async () => { const fresh = await load(db, { journey_id: got.j.journey_id }); const v = R.compute(dfs, fresh!.j, fresh!.steps, ctxFor(f, st)); const { data: ev } = await db.from('client_journey_event').select('*').eq('journey_id', got.j.journey_id).order('at', { ascending: false }).limit(200); const may: Record<string, boolean> = {}; for (const r of v.rows) may[r.key] = mayDo(r.def, who, P); return json({ ok: true, journey: fresh!.j, steps: fresh!.steps, view: v, events: ev ?? [], may, is_owner: isOwner, facts: { dates: dates(f) } }) }
    const now = new Date().toISOString(), actor = { email: who.email, name: who.name }
    if (action === 'not_needed') {
      if (!isOwner) return json({ error: 'Only an owner may mark a requirement not needed.' }, 403)
      const reason = S(b.reason, 300); if (reason.length < 5) return json({ error: 'Please give the reason (at least five characters).' }, 400)
      if (row && DONE.includes(row.status)) return json({ error: 'That requirement is already settled.' }, 409)
      await putStep(db, got.j.journey_id, key, { state: 'not_needed', completed_by: who.email, completed_by_name: who.name, completed_at: now, exception: { kind: 'not_needed', reason, by: who.email, at: now } })
      await event(db, got.j.journey_id, key, actor, 'not_needed', { by: who.email }, reason)
      return await answer()
    }
    if (!row) return json({ error: 'That requirement does not apply to this person.' }, 400)
    if (!mayDo(def, who, P)) return json({ error: def.permission === 'work' ? 'Only a person on the Approve to Work list (owners) may approve to work.' : def.permission === 'advance' ? 'Only a person on the Approve to Advance list may approve this.' : def.permission === 'screening' ? 'Only a person on the Screening staff list may record this.' : 'The Hub verifies this one on its own; nobody confirms it by hand.' }, 403)
    if (action === 'confirm') {
      if (def.proof !== 'confirmed') return json({ error: 'That requirement is verified from the records or needs a document, not a confirmation.' }, 400)
      if (!['ready', 'attention'].includes(row.status)) return json({ error: row.status === 'later' ? 'Not yet: ' + (row.why || 'earlier requirements first') + '.' : DONE.includes(row.status) ? 'Already settled.' : 'This requirement is ' + row.status + '.' }, 409)
      await putStep(db, got.j.journey_id, key, { state: 'complete', evidence: { confirmed: { by: who.email, name: who.name, at: now, list: def.permission } }, completed_by: who.email, completed_by_name: who.name, completed_at: now })
      await event(db, got.j.journey_id, key, actor, 'confirmed', { list: def.permission })
      return await answer()
    }
    if (action === 'record') {
      if (def.proof !== 'proof') return json({ error: 'That requirement is not recorded with a document.' }, 400)
      const result = S(b.result, 80), doc = S(b.document, 400), expires = /^\d{4}-\d{2}-\d{2}$/.test(S(b.expires, 10)) ? S(b.expires, 10) : null
      if (!result || !doc) return json({ error: 'A result and its document are both required. Nothing was saved.' }, 400)
      await putStep(db, got.j.journey_id, key, { state: 'complete', evidence: { ...(row.st?.evidence || {}), result, document: doc, expires: expires, recorded: { by: who.email, name: who.name, at: now } }, completed_by: who.email, completed_by_name: who.name, completed_at: now })
      await event(db, got.j.journey_id, key, actor, 'evidence_added', { result, document: doc, expires })
      return await answer()
    }
    return json({ error: 'Unknown action.' }, 400)
  } catch (e) {
    return json({ error: 'Something went wrong: ' + ((e as Error).message || 'error') + '. Nothing was changed.' }, 500)
  }
})
