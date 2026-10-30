// =============================================================================
// axis-health · B, NO SILENT FAILURES FROM AXISCARE (Samantha, 2026-10-29: "failures must show on a card, never be silent").
// Every 5 minutes it reads the shared reader's log (axis_connection, axis_health_B.sql) and, for each kind of AxisCare
// information on its own (visit lists, single visits, schedules, the caregiver list, client records, the reason list):
//   · down = in the last 15 minutes the Hub tried to read it and every try failed or was held back, and the last good read
//     is more than 15 minutes old. One card per kind (ops_axis_down_<kind>), so a good caregiver-list read never hides a
//     failing visit read (her rule 3). The card says since when, how many tries failed, how many were AxisCare's 429, and
//     what may be out of date. It updates itself while the problem lasts.
//   · back = the last try worked and a good read is less than 15 minutes old: the card closes itself, saying from when to when.
//   · The old "Cara is HOLDING all callouts" alarms (ops_cov_censusdown_<day>) close themselves once the caregiver list has
//     read again after they were made, saying so. coverage-run still makes them exactly as before (fail closed, loudly).
// Cards only while Settings > Tell me when AxisCare can't be read is on (ops_settings.axis_failure_cards_live); off, it only
// reports what it would do. Nothing here texts or emails anyone, and nothing here calls AxisCare.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jobCaller } from '../_shared/job-auth.ts'
import { fallbackList } from '../_shared/notice-to.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
// deno-lint-ignore no-explicit-any
type Any = any

export const WINDOW_MIN = 15
export const KINDS: Record<string, { label: string; impact: string }> = {
  visits: { label: 'visit lists', impact: 'Shift, clock-in and coverage cards may be out of date. If a shift is soon, check it in AxisCare and work it by hand.' },
  visit: { label: 'single visits', impact: 'Clock-in, clock-out and coverage checks on single visits may be out of date. If a shift is soon, check it in AxisCare.' },
  schedules: { label: 'schedules', impact: 'Ongoing open-shift checks may be out of date.' },
  caregivers: { label: 'the caregiver list', impact: 'Cara holds caregiver texts for callouts until the caregiver list reads again. Work urgent shifts by hand.' },
  clients: { label: 'client records', impact: 'Client details on cards may be out of date.' },
  reasons: { label: 'the cancel reason list', impact: 'Cancelled visits may be read late.' },
}
export const cardId = (kind: string) => `ops_axis_down_${kind}`

/** "2:14 PM" today, "Oct 29, 2:14 PM" another day (Central) */
export function when(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return ''
  const t = Date.parse(iso); if (!Number.isFinite(t)) return ''
  const o = { timeZone: 'America/Chicago' } as const
  const day = (ms: number) => new Date(ms).toLocaleDateString('en-US', { ...o, month: 'short', day: 'numeric' })
  const hm = new Date(t).toLocaleTimeString('en-US', { ...o, hour: 'numeric', minute: '2-digit' })
  return day(t) === day(nowMs) ? hm : `${day(t)}, ${hm}`
}

/** down / back / quiet for one kind, from axis_connection's line for it (window = WINDOW_MIN) */
export function stateOf(info: Any, nowMs: number): 'down' | 'back' | 'quiet' {
  if (!info) return 'quiet'
  const tried = Number(info.calls || 0) + Number(info.held || 0)
  const lastOk = info.last_ok_at ? Date.parse(info.last_ok_at) : NaN
  const okRecent = Number.isFinite(lastOk) && nowMs - lastOk <= WINDOW_MIN * 60_000
  if (tried > 0 && !okRecent && (Number(info.failed || 0) + Number(info.held || 0)) > 0) return 'down'
  if (okRecent && info.last_try_ok === true) return 'back'
  return 'quiet'
}

/** The whole decision, pure: which cards to open or refresh, which to close. */
export function plan(conn: Any, items: Any[], nowMs: number, owner = '') {
  const nowIso = new Date(nowMs).toISOString()
  const byId = new Map((items || []).map((i: Any) => [String(i?.id), i]))
  const upsert: Any[] = [], close: Any[] = [], report: Any[] = []
  for (const [kind, k] of Object.entries(KINDS)) {
    const info = conn?.sources?.[kind]
    const st = stateOf(info, nowMs)
    const id = cardId(kind), card = byId.get(id), open = card?.status === 'open'
    report.push({ kind, state: st, card: open ? 'open' : 'none' })
    if (st === 'down') {
      const since = info.last_ok_at ? when(info.last_ok_at, nowMs) : ''
      const r429 = Number(info.r429 || 0), failed = Number(info.failed || 0), held = Number(info.held || 0)
      const tries = `In the last ${WINDOW_MIN} minutes: ${failed} read${failed === 1 ? '' : 's'} failed`
        + (r429 ? ` (${r429} of them AxisCare saying "too many requests")` : '')
        + (held ? `, and ${held} ${held === 1 ? 'was' : 'were'} held back while AxisCare asked the Hub to wait` : '') + '.'
      const detail = [
        `The Hub could not read ${k.label} from AxisCare ${since ? `since ${since}` : 'for more than a day'}.`,
        tries,
        info.last_error ? `AxisCare's last answer: ${String(info.last_error).slice(0, 160)}.`.replace(/\.\.$/, '.') : '',
        k.impact,
        'This card updates itself and closes by itself when AxisCare reads again.',
      ].filter(Boolean).join('\n')
      const title = `AxisCare: ${k.label} could not be read${since ? ` since ${since}` : ''}`
      if (open && card.detail === detail && card.title === title) continue
      upsert.push({
        ...(open ? card : {}), id, kind: 'coverage', axis_source: kind, domain: 'scheduling_coverage', status: 'open', urgency: 'high',
        title, about: 'AxisCare connection', detail,
        down_since: open ? (card.down_since ?? info.last_ok_at ?? nowIso) : (info.last_ok_at ?? nowIso),
        owner: open ? (card.owner ?? owner) : owner, owner_name: open ? (card.owner_name ?? '') : '',
        created_at: open ? card.created_at : nowIso, created_by: 'axis-health', updated_at: nowIso,
      })
    } else if (st === 'back' && open) {
      const from = when(card.down_since, nowMs), to = when(info.last_ok_at, nowMs)
      close.push({ ...card, status: 'resolved', resolved_at: nowIso, resolved_how: 'axiscare_back',
        close_note: `AxisCare ${k.label} read again at ${to}.${from ? ` It could not be read from ${from} to ${to}.` : ''} Closed by itself.` })
    }
  }
  /* the old "holding all callouts" alarms: closed once the caregiver list has read since they were made */
  const cgOk = conn?.sources?.caregivers?.last_ok_at ? Date.parse(conn.sources.caregivers.last_ok_at) : NaN
  for (const it of items || []) {
    if (it?.status !== 'open' || !/^ops_cov_censusdown_/.test(String(it?.id))) continue
    const made = Date.parse(String(it.created_at ?? ''))
    if (!Number.isFinite(cgOk) || !Number.isFinite(made) || cgOk <= made) { report.push({ kind: 'census_alarm', card: it.id, state: 'still_held' }); continue }
    close.push({ ...it, status: 'resolved', resolved_at: nowIso, resolved_how: 'axiscare_back',
      close_note: `Cara read the AxisCare caregiver list again at ${when(conn.sources.caregivers.last_ok_at, nowMs)}, so callouts were no longer held. Closed by itself.` })
    report.push({ kind: 'census_alarm', card: it.id, state: 'back' })
  }
  return { upsert, close, report }
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
  const beat = async (ok: boolean, note: string) => {
    if (dry) return
    try { await db.rpc('upsert_app_data_item', { target_key: 'automation_heartbeats', item: { id: 'hb_axis-health', automation: 'axis-health', at, ok, note: note.slice(0, 300) } }) } catch { /* observer */ }
  }
  const { data: stRow } = await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
  const settings: Any = stRow?.data ?? {}
  const live = settings.axis_failure_cards_live === true && !dry
  const { data: conn, error } = await db.rpc('axis_connection', { p_minutes: WINDOW_MIN })
  if (error || !conn) { await beat(false, 'could not read the AxisCare log: ' + String(error?.message ?? 'no answer')); return json({ ok: false, error: 'could not read the AxisCare log' }, 500) }
  const { data: oi } = await db.from('app_data').select('data').eq('key', 'ops_items').maybeSingle()
  const items: Any[] = Array.isArray(oi?.data) ? oi!.data : []
  const admins = Array.isArray(settings.coverage_alert_admins) && settings.coverage_alert_admins.length ? settings.coverage_alert_admins : await fallbackList(db, 'scheduling_coverage')
  const p = plan(conn, items, Date.now(), String(admins?.[0] ?? ''))
  if (live) for (const item of [...p.upsert, ...p.close]) await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item })
  const note = `${live ? 'live' : 'practice'}: ${p.upsert.length} card(s) ${live ? 'opened or updated' : 'would open or update'}, ${p.close.length} ${live ? 'closed' : 'would close'}`
    + `; scheduling ${conn.scheduling_current ? 'current' : 'NOT current'}`
  await beat(true, note)
  return json({ ok: true, mode: live ? 'live' : 'practice', scheduling_current: conn.scheduling_current === true, report: p.report,
    opened_or_updated: p.upsert.map((i: Any) => i.id), closed: p.close.map((i: Any) => i.id), note })
})
