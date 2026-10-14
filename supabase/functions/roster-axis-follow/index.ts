// =============================================================================
// roster-axis-follow · the Hub's caregiver list follows AxisCare for active (Samantha, 2026-10-14)
// =============================================================================
// Her rule: "axiscare is the truth for if a caregiver is active or not". Her choice: the Hub marks a caregiver inactive
// (or active again) whenever AxisCare does, checked nightly, and the Caregivers page lists everyone it changed. Nobody is
// deleted, nothing is sent to anyone, AxisCare is only read.
//
// Each run: the whole AxisCare caregiver list (active and inactive) and the Hub's caregivers. A Hub caregiver with an
// AxisCare number whose active differs from AxisCare's gets AxisCare's, through caregiver_active_patch (only `active` and
// the note of why, only if nobody changed that caregiver since this run read it). Not changed, only listed for the office:
// an AxisCare number AxisCare doesn't know, and an active Hub caregiver with no AxisCare number.
// Holds (changes nothing, says why) when AxisCare can't be read, its list was cut short, or the run would change more than
// a third of the Hub's caregivers at once (something is wrong with the read, not 30 people leaving overnight).
// PRACTICE until ops_settings.roster_follow_axis_live === true: works it all out and writes the list (marked practice),
// changes no caregiver. ?dry=1 is always practice and writes nothing.
// The list: app_data 'roster_axis_follow' {at, mode, changes[], not_in_axiscare[], no_number[], held?}.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jobCaller } from '../_shared/job-auth.ts'
import { readCensus } from '../_shared/axis-census.ts'
import { opEvent } from '../_shared/events.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
// deno-lint-ignore no-explicit-any
type Any = any
export const MAX_SHARE = 1 / 3
const rev = (x: Any) => (/^[0-9]{1,15}$/.test(String(x?._rev ?? '')) ? Number(x._rev) : 0)
const full = (g: Any) => [String(g?.first || '').trim(), String(g?.last || '').trim()].filter(Boolean).join(' ')

/** The pure part: what should change, and what the office should look at. */
export function plan(roster: Any[], census: { id: string; active: boolean; status_label: string }[]) {
  const ax = new Map(census.map((r) => [r.id, r]))
  const changes: Any[] = [], notIn: Any[] = [], noNumber: Any[] = []
  for (const g of roster) {
    if (g?.id == null || g.id === '') continue
    const axid = String(g.axiscare_id ?? '').trim()
    const hubActive = g.active !== false
    if (!/^\d{1,12}$/.test(axid)) { if (hubActive) noNumber.push({ id: String(g.id), name: full(g) }); continue }
    const r = ax.get(axid)
    if (!r) { if (hubActive) notIn.push({ id: String(g.id), name: full(g), axiscare_id: axid }); continue }
    if (r.active !== hubActive) changes.push({ id: String(g.id), name: full(g), axiscare_id: axid, from: hubActive, to: r.active, axiscare_label: r.status_label || '' })
  }
  return { changes, not_in_axiscare: notIn, no_number: noNumber }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const caller = await jobCaller(req)
  if (!caller) return json({ error: 'not allowed' }, 401)
  const q = new URL(req.url).searchParams
  if (q.get('auth_check') === '1') return json({ ok: true, caller })
  const dry = q.get('dry') === '1'
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const at = new Date().toISOString()
  const { data: stRow } = await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
  const live = (stRow?.data ?? {}).roster_follow_axis_live === true && !dry
  const mode = live ? 'live' : 'practice'
  const save = async (report: Any) => { if (!dry) await db.from('app_data').upsert({ key: 'roster_axis_follow', data: report }, { onConflict: 'key' }) }
  const beat = async (ok: boolean, note: string) => { if (dry) return; try { await db.rpc('upsert_app_data_item', { target_key: 'automation_heartbeats', item: { id: 'hb_roster-axis-follow', automation: 'roster-axis-follow', at, ok, note: note.slice(0, 300) } }) } catch { /* observer */ } }

  const census = await readCensus()
  if (!census.ok || census.truncated) {
    const held = !census.ok ? 'AxisCare could not be read: ' + census.error : 'AxisCare listed more caregivers than one read takes'
    await beat(false, 'held: ' + held)
    return json({ ok: false, mode, held: held + '. Nothing was changed.' })
  }
  const { data: cgRow, error: cgErr } = await db.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()
  if (cgErr || !Array.isArray(cgRow?.data)) { await beat(false, 'held: the Hub caregivers could not be read'); return json({ ok: false, mode, held: 'The Hub caregivers could not be read. Nothing was changed.' }) }
  const roster: Any[] = cgRow!.data
  const p = plan(roster, census.rows)
  const report: Any = { at, mode, axiscare_total: census.total, hub_total: roster.length, ...p }
  if (p.changes.length > Math.max(5, Math.floor(roster.length * MAX_SHARE))) {
    report.held = `It would change ${p.changes.length} of ${roster.length} caregivers at once, more than a third, so nothing was changed. Check AxisCare, then tell Claude.`
    await save(report); await beat(false, report.held)
    return json({ ok: false, mode, held: report.held, would_change: p.changes.length })
  }
  if (live) {
    for (const c of p.changes) {
      let rec = roster.find((g) => String(g?.id) === c.id), out = 'error'
      for (let i = 0; i < 3 && rec; i++) {
        const { data, error } = await db.rpc('caregiver_active_patch', { p_id: c.id, p_base_rev: rev(rec), p_active: c.to,
          p_note: { at, to: c.to, axiscare_label: c.axiscare_label, by: 'roster-axis-follow' } })
        if (error) { out = 'error'; break }
        if (data?.ok) { out = 'changed'; break }
        if (data?.reason !== 'changed' || !data.current_record) { out = 'skipped'; break }
        rec = data.current_record
        if ((rec.active !== false) === c.to) { out = 'already'; break }   // someone set it meanwhile
      }
      c.result = out
      if (out === 'changed') await opEvent(db, { verb: 'caregiver_active_from_axiscare', item_id: 'cg_' + c.id, area: 'caregivers',
        summary: `${c.name} marked ${c.to ? 'active' : 'inactive'} in the Hub because AxisCare says ${c.axiscare_label || (c.to ? 'active' : 'not active')}`, data: { axiscare_id: c.axiscare_id, from: c.from, to: c.to } } as Any)
    }
  }
  /* keep earlier live changes on the list (newest first, last 200) so the office can always see who the Hub changed */
  if (!dry) {
    const { data: prev } = await db.from('app_data').select('data').eq('key', 'roster_axis_follow').maybeSingle()
    const hist = Array.isArray(prev?.data?.history) ? prev!.data.history : []
    report.history = [...p.changes.filter((c: Any) => c.result === 'changed').map((c: Any) => ({ ...c, at })), ...hist].slice(0, 200)
  }
  await save(report)
  const failed = p.changes.filter((c: Any) => c.result === 'error').length
  await beat(failed === 0, JSON.stringify({ mode, changes: p.changes.length, not_in_axiscare: p.not_in_axiscare.length, no_number: p.no_number.length, failed }))
  return json({ ok: failed === 0, mode, changes: p.changes.length, to_inactive: p.changes.filter((c: Any) => !c.to).length, to_active: p.changes.filter((c: Any) => c.to).length,
    changed: p.changes.filter((c: Any) => c.result === 'changed').length, failed, not_in_axiscare: p.not_in_axiscare.length, no_number: p.no_number.length })
})
