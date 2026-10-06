// =============================================================================
// visit-change: click a visit on the Live Schedule calendar and change it in AxisCare (2026-10-06, Samantha: "even better
// if we can actually click and change shifts there" → after the 479 look, "yes build it": change the caregiver, take the
// caregiver off, change the time or day; no remove).
// =============================================================================
// Office staff only (owner / care coordinator / staffing coordinator), from their own Hub sign-in.
// Switch: ops_settings.visit_change_live must be true for any change (reading is always allowed).
//   reasons  AxisCare's active change reasons (the agency's own list).
//   get      one visit as AxisCare has it now: client, date, times, caregiver, started / verified, plus today's changes to it
//            that can still be undone.
//   change   {visit_id, expect:{caregiver_id,date,start,end}, set:{caregiver_id?|null, date?, start?, end?}, reason_id, change_id}
//            1. reads the visit; refuses one that has started, is verified or removed, or no longer matches what the person saw
//            2. refuses an unknown or switched-off reason, an overnight time, an end before the start
//            3. PATCHes ONLY that visit (never the repeating schedule) with the reason
//            4. reads it back and checks every changed field; records it (visit_changes + the AxisCare change history +
//               op_events) with the before and after, so it can be undone today
//   undo     {change_id}: the same day only, and only while the visit is still exactly as that change left it; puts the
//            before back with "Administrative Correction - Office Error", reads it back, records it.
// Nobody is texted or called by any of this.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { opEvent } from '../_shared/events.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const VER = '2023-10-01'
// deno-lint-ignore no-explicit-any
type Any = any
const rowsOf = (v: Any): Any[] => Array.isArray(v) ? v : (v && typeof v === 'object') ? Object.values(v) : []
const chiDay = (d = new Date()) => d.toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
const HM = /^\d{2}:\d{2}$/, YMD = /^\d{4}-\d{2}-\d{2}$/

function creds() {
  let token = ''
  for (const n of ['AXISCARE_API_KEY', 'AXISCARE_TOKEN']) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  return { token, site: /^\d+$/.test(site) ? site : '' }
}
async function ax(method: string, path: string, body?: unknown): Promise<{ status: number; json: Any }> {
  const { token, site } = creds()
  if (!token || !site) return { status: 0, json: { errors: ['AxisCare is not set up on this project'] } }
  try {
    const r = await fetch(`https://${site}.axiscare.com${path}`, { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json',
      'X-AxisCare-Api-Version': VER, 'User-Agent': 'CaringCompanions-Hub/1.0', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
    return { status: r.status, json: await r.json().catch(() => ({})) }
  } catch (e) { return { status: 0, json: { errors: [String(e)] } } }
}
const vpath = (id: string) => `/api/visits/${encodeURIComponent(id)}`

/** A visit as the Hub talks about it. Times are the visit's own wall-clock times (as AxisCare shows them). */
export function shape(v: Any) {
  const s = String(v?.scheduledStartDate ?? v?.startDate ?? ''), e = String(v?.scheduledEndDate ?? v?.endDate ?? '')
  return {
    visit_id: v?.id != null ? String(v.id) : '',
    client: [v?.client?.firstName, v?.client?.lastName].filter(Boolean).join(' ') || '',
    client_id: v?.client?.id != null ? String(v.client.id) : '',
    caregiver_id: v?.caregiver?.id != null ? String(v.caregiver.id) : null,
    caregiver: v?.caregiver?.id != null ? ([v?.caregiver?.firstName, v?.caregiver?.lastName].filter(Boolean).join(' ') || '#' + v.caregiver.id) : null,
    date: s.slice(0, 10), start: s.slice(11, 16), end: e.slice(11, 16),
    started: !!(v?.clockIn || v?.actualStartDate), verified: v?.verified === true, removed: v?.removed === true,
  }
}
const key4 = (x: Any) => JSON.stringify([x.caregiver_id ?? null, x.date, x.start, x.end])

/** What the change will do, checked before anything is sent. Returns the AxisCare body or the reason it can't. */
export function plan(cur: Any, set: Any): { body?: Any; after?: Any; why?: string } {
  const body: Any = {}, after = { caregiver_id: cur.caregiver_id, date: cur.date, start: cur.start, end: cur.end }
  if ('caregiver_id' in set) {
    const c = set.caregiver_id
    if (c !== null && !/^\d+$/.test(String(c))) return { why: 'That caregiver has no AxisCare number.' }
    if (String(c ?? '') !== String(cur.caregiver_id ?? '')) { body.caregiverId = c === null ? null : Number(c); after.caregiver_id = c === null ? null : String(c) }
  }
  const d = set.date ?? cur.date, s = set.start ?? cur.start, e = set.end ?? cur.end
  if (set.date != null && !YMD.test(String(set.date))) return { why: 'The date is not a date.' }
  if ((set.start != null && !HM.test(String(set.start))) || (set.end != null && !HM.test(String(set.end)))) return { why: 'A time is not a time.' }
  if (set.date != null || set.start != null || set.end != null) {
    if (!(s < e)) return { why: 'The end time must be after the start time on the same day. Overnight visits are changed in AxisCare.' }
    if (d !== cur.date) { body.visitDate = d; after.date = d }
    if (s !== cur.start) { body.startTime = s; after.start = s }
    if (e !== cur.end) { body.endTime = e; after.end = e }
  }
  if (!Object.keys(body).length) return { why: 'Nothing would change.' }
  return { body, after }
}

async function reasons(): Promise<Any[]> {
  const r = await ax('GET', '/api/visits/modification-reasons')
  return rowsOf(r.json?.results?.modificationReasons ?? r.json?.modificationReasons ?? r.json?.results)
    .map((x: Any) => ({ id: Number(x?.id), name: String(x?.name ?? ''), disabled: x?.disabled === true })).filter((x) => Number.isFinite(x.id))
}
async function readList(sb: Any): Promise<Any[]> {
  const { data } = await sb.from('app_data').select('data').eq('key', 'visit_changes').maybeSingle()
  return Array.isArray(data?.data) ? data.data : []
}
async function record(sb: Any, who: Any, row: Any, kind: 'visit_caregiver' | 'schedule', summary: string) {
  try { await sb.rpc('upsert_app_data_item', { target_key: 'visit_changes', item: row }) } catch { /* the log below still has it */ }
  try {
    await sb.rpc('axiscare_change_record', { p_kind: kind, p_subject: 'client', p_client: row.client_id || null, p_caregiver: row.after?.caregiver_id || row.before?.caregiver_id || null,
      p_outcome: 'sent_confirmed', p_summary: summary.slice(0, 200), p_detail: ('Reason: ' + row.reason_name).slice(0, 300), p_by: who.name || who.email, p_via: 'Live Schedule (visit-change)' })
  } catch { /* best effort */ }
  await opEvent(sb, { verb: 'visit_changed', actor_name: who.name, actor_email: who.email, item_id: row.visit_id, area: 'scheduling', summary, data: { change_id: row.id, before: row.before, after: row.after, reason: row.reason_name, undo_of: row.undo_of ?? null } })
}
export function words(before: Any, after: Any, names: Any = {}): string {
  const bits: string[] = []
  if (String(before.caregiver_id ?? '') !== String(after.caregiver_id ?? ''))
    bits.push(after.caregiver_id ? `caregiver ${names.before || 'nobody'} → ${names.after || '#' + after.caregiver_id}` : `caregiver ${names.before || '#' + before.caregiver_id} taken off`)
  if (before.date !== after.date) bits.push(`day ${before.date} → ${after.date}`)
  if (before.start !== after.start || before.end !== after.end) bits.push(`time ${before.start}–${before.end} → ${after.start}–${after.end}`)
  return bits.join('; ')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const who = await requireStaff(sb, req, OFFICE_ROLES)
  if (!who.ok) return json({ error: who.error }, who.status)
  let b: Any = {}
  try { b = await req.json() } catch { return json({ error: 'bad request' }, 400) }
  const { data: st } = await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
  const live = (st?.data ?? {}).visit_change_live === true

  if (b.action === 'reasons') {
    const list = await reasons()
    return json({ live, reasons: list.filter((r) => !r.disabled) })
  }

  if (b.action === 'get') {
    const id = String(b.visit_id ?? ''); if (!id) return json({ error: 'which visit?' }, 400)
    const r = await ax('GET', vpath(id))
    if (r.status !== 200) return json({ error: `AxisCare answered ${r.status}` }, 502)
    const v = shape(r.json?.results?.visit ?? r.json?.visit)
    const today = chiDay()
    const undo = (await readList(sb)).filter((c) => c.visit_id === id && !c.undone_at && !c.undo_of && chiDay(new Date(c.at)) === today && key4(c.after) === key4(v))
      .map((c) => ({ change_id: c.id, words: c.words, by: c.by, at: c.at }))
    return json({ live, visit: v, undo })
  }

  if (b.action === 'change' || b.action === 'undo') {
    if (!live) return json({ outcome: 'off', error: 'Changing visits from the Hub is switched off. Nothing was changed.' }, 409)
    let id = '', set: Any = {}, reasonId = 0, expect: Any = null, changeId = String(b.change_id ?? ''), undoOf: Any = null
    if (!/^[a-z0-9-]{8,64}$/i.test(changeId)) return json({ error: 'bad change id' }, 400)
    const list = await readList(sb)
    if (b.action === 'undo') {
      const c = list.find((x) => x.id === changeId)
      if (!c || c.undo_of) return json({ error: 'That change was not found.' }, 404)
      if (c.undone_at) return json({ outcome: 'already_undone' })
      if (chiDay(new Date(c.at)) !== chiDay()) return json({ outcome: 'too_late', error: 'Changes can be undone here on the same day only. Change it back in AxisCare.' }, 409)
      id = c.visit_id; expect = c.after; set = { caregiver_id: c.before.caregiver_id ?? null, date: c.before.date, start: c.before.start, end: c.before.end }
      undoOf = c; changeId = 'u-' + c.id
      const rs = await reasons(), off = rs.find((r) => !r.disabled && /office error/i.test(r.name)) || rs.find((r) => !r.disabled && /administrative/i.test(r.name))
      if (!off) return json({ error: 'AxisCare has no "Office Error" change reason to undo with. Change it back in AxisCare.' }, 409)
      reasonId = off.id
    } else {
      if (list.some((x) => x.id === changeId)) return json({ outcome: 'already_done' })
      id = String(b.visit_id ?? ''); set = b.set ?? {}; expect = b.expect ?? null; reasonId = Number(b.reason_id)
      if (!id || !expect) return json({ error: 'which visit, and what did you see?' }, 400)
    }
    const rs = await reasons(), reason = rs.find((r) => r.id === reasonId && !r.disabled)
    if (!reason) return json({ outcome: 'refused', error: 'Pick one of AxisCare’s change reasons. Nothing was changed.' }, 422)
    const g = await ax('GET', vpath(id))
    if (g.status !== 200) return json({ error: `AxisCare answered ${g.status}. Nothing was changed.` }, 502)
    const cur = shape(g.json?.results?.visit ?? g.json?.visit)
    if (cur.removed) return json({ outcome: 'refused', error: 'That visit has been removed in AxisCare. Nothing was changed.' }, 409)
    if (cur.started || cur.verified) return json({ outcome: 'refused', error: 'That visit has started or is verified. Change it in AxisCare (an EVV correction). Nothing was changed.' }, 409)
    if (key4(cur) !== key4({ caregiver_id: expect.caregiver_id ?? null, date: expect.date, start: expect.start, end: expect.end }))
      return json({ outcome: 'changed_meanwhile', error: 'Someone changed this visit since you opened it. Look again. Nothing was changed.', visit: cur }, 409)
    const p = plan(cur, set)
    if (!p.body) return json({ outcome: 'refused', error: p.why + ' Nothing was changed.' }, 422)
    const r = await ax('PATCH', vpath(id), { ...p.body, modificationReason: reason.id })
    if (r.status !== 200) {
      await opEvent(sb, { verb: 'visit_change_refused', actor_name: who.name, actor_email: who.email, item_id: id, area: 'scheduling',
        summary: `AxisCare refused a change to ${cur.client}'s ${cur.date} visit`, data: { status: r.status, errors: r.json?.errors ?? null, set: p.body } })
      return json({ outcome: 'axiscare_refused', error: `AxisCare refused it (${r.status}${rowsOf(r.json?.errors).length ? ': ' + rowsOf(r.json?.errors).join('; ') : ''}). Nothing was changed.` }, 422)
    }
    const g2 = await ax('GET', vpath(id))
    const after = g2.status === 200 ? shape(g2.json?.results?.visit ?? g2.json?.visit) : null
    const confirmed = !!after && key4(after) === key4(p.after)
    const row = { id: changeId, visit_id: id, client: cur.client, client_id: cur.client_id, at: new Date().toISOString(), by: who.name, by_email: who.email,
      reason_id: reason.id, reason_name: reason.name, before: { caregiver_id: cur.caregiver_id, caregiver: cur.caregiver, date: cur.date, start: cur.start, end: cur.end },
      after: after ? { caregiver_id: after.caregiver_id, caregiver: after.caregiver, date: after.date, start: after.start, end: after.end } : p.after,
      confirmed, undo_of: undoOf ? undoOf.id : null, words: '' }
    row.words = words(row.before, row.after, { before: cur.caregiver, after: after?.caregiver })
    await record(sb, who, row, 'caregiverId' in p.body ? 'visit_caregiver' : 'schedule',
      `${undoOf ? 'Undid a change to' : 'Changed'} ${cur.client}'s ${cur.date} visit: ${row.words}`)
    if (undoOf) { undoOf.undone_at = row.at; undoOf.undone_by = who.name; try { await sb.rpc('upsert_app_data_item', { target_key: 'visit_changes', item: undoOf }) } catch { /* */ } }
    return json({ outcome: 'changed', confirmed, change_id: row.id, before: row.before, after: row.after, words: row.words, reason: reason.name,
      ...(confirmed ? {} : { warning: 'AxisCare took the change, but reading it back did not match exactly. Check the visit in AxisCare.' }) })
  }
  return json({ error: 'unknown action' }, 400)
})
