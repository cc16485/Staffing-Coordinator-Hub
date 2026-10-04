// =============================================================================
// CAREGIVER AUTO-CONNECT, the job (438). Samantha approved 2026-10-03 ("yes to all"; plan
// https://claude.ai/artifact/FJUZg3aU2neZBgGNDbCCLm). Her rules from 2026-10-01 live in the ONE copy the Hub page also
// runs, cc.mo-care.com/caregiver-connect-rules.js (run here only when its fingerprint is approved).
//
// Once an hour: read the AxisCare caregiver list and the Hub's caregivers and candidates, work out who is whose, then
//   switch OFF (practice, ops_settings.cg_connect_live): only record what it WOULD do (the list the Hub shows).
//   switch ON:  connect, move over and start records through caregiver_connect_apply (one person at a time, all or
//               nothing, never two Hub records for one AxisCare caregiver), and open one Needs Attention item for
//               each caregiver a person has to decide about.
// If AxisCare or the rules can't be read, nothing changes and the run says why; 3 scheduled runs in a row like that
// open a Needs Attention item (no silent failures). Staff actions (the Hub's Connect card and "Not this person") come
// through manualAction. Nothing here messages anyone or writes to AxisCare.
// =============================================================================
// deno-lint-ignore-file no-explicit-any
import type { Census, CensusRow } from './axis-census.ts'

export const RULES_FILE = 'caregiver-connect-rules.js'
export const FAILING_ID = 'ops_cgconnect_failing'
export const itemId = (ax: string) => 'ops_cgconnect_' + ax

export type Rules = { ok: true; C: any } | { ok: false; error: string }
export type Deps = { census: () => Promise<Census>; rules: () => Promise<Rules> }

/** The approved rules file's text, run in its own scope (nothing leaks onto the server's globals). */
export function rulesFrom(src: string): any {
  const scope: any = {}
  new Function('globalThis', String(src))(scope)
  const C = scope.CCConnect
  if (!C || typeof C.plan !== 'function' || typeof C.movedRecord !== 'function' || typeof C.newRecord !== 'function')
    throw new Error(RULES_FILE + ' did not define the connect rules')
  return C
}

/** A record's _rev, as the database reads it (app_data_rev): a missing or odd value is 0. */
export const rev = (x: any) => (/^[0-9]{1,15}$/.test(String(x?._rev ?? '')) ? Number(x._rev) : 0)

async function settings(db: any): Promise<any> {
  const { data } = await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
  return data?.data && typeof data.data === 'object' && !Array.isArray(data.data) ? data.data : {}
}
async function lists(db: any) {
  const { data, error } = await db.from('app_data').select('key, data').in('key', ['caregivers', 'candidates', 'ops_items'])
  if (error || !Array.isArray(data)) throw new Error('the Hub caregiver lists could not be read')
  const m: any = {}
  for (const r of data) m[r.key] = r.data
  if (!Array.isArray(m.caregivers) || !Array.isArray(m.candidates)) throw new Error('the Hub caregiver lists could not be read')
  return { cgs: m.caregivers, cands: m.candidates, items: Array.isArray(m.ops_items) ? m.ops_items : [] }
}
async function blockedPairs(db: any) {
  const { data, error } = await db.from('caregiver_connect_blocked').select('axiscare_id, kind, record_id')
  if (error) throw new Error('the undone connections could not be read')
  return (data ?? []).map((b: any) => ({ axiscare_id: String(b.axiscare_id), kind: b.kind, id: String(b.record_id ?? '') }))
}
let ownerCache: string | null = null
async function caregiversOwner(db: any): Promise<string> {
  if (ownerCache != null) return ownerCache
  let owner = ''
  try {   // the same rule as every Needs Attention item: domains.owner_person, or honestly unowned
    const { data: dom } = await db.from('domains').select('owner_person').eq('code', 'caregivers').eq('entity', 'cc_ihs').maybeSingle()
    if (dom?.owner_person) {
      const { data: p } = await db.from('persons').select('primary_email').eq('person_id', dom.owner_person).maybeSingle()
      owner = String(p?.primary_email ?? '')
    }
  } catch { owner = '' }
  return (ownerCache = owner)
}
const isOpen = (it: any) => it && !/^(done|closed|dismissed|resolved|cancelled|canceled)$/i.test(String(it.status || 'open'))
async function putItem(db: any, item: any) {
  const { error } = await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item })
  if (error) throw new Error('Needs Attention could not be updated: ' + String(error.message ?? error).slice(0, 120))
}
async function closeItem(db: any, items: any[], id: string, by: string, note: string): Promise<boolean> {
  const it = items.find((x) => x && x.id === id)
  if (!isOpen(it)) return false
  const at = new Date().toISOString()
  await putItem(db, { ...it, status: 'done', closed_at: at, closed_by: by, last_activity_at: at, resolution_code: 'connected', close_note: note,
    log: [...(Array.isArray(it.log) ? it.log : []), { at, by, text: note }] })
  return true
}
const optText = (C: any, o: any) => C.optionText(o)
function reviewItem(C: any, r: any, owner: string, at: string) {
  const name = C.name(r.ax) || ('AxisCare ' + r.ax.id)
  const opts = (r.options ?? []).map((o: any) => optText(C, o))
  return {
    id: itemId(String(r.ax.id)), kind: 'caregiver_connect', domain: 'caregivers', axiscare_id: String(r.ax.id), about: name,
    title: 'Connect caregiver: ' + name,
    detail: (opts.length ? 'Possible records: ' + opts.join('; ') + '.' : 'No Hub record or Background & References candidate matches.')
      + ' Not connected automatically because ' + r.why + '.',
    next_action: 'Open ' + name + ' in Caregivers and choose their record under "Connect this caregiver".',
    status: 'open', urgency: 'normal', created_at: at, first_at: at, last_activity_at: at,
    opened_by: 'caregiver-connect', created_by: 'caregiver-connect', owner, owner_name: '',
    log: [{ at, by: 'automation', text: 'Opened by the hourly caregiver connect check.' }],
  }
}
async function recordRun(db: any, row: any) {
  try { await db.from('caregiver_connect_runs').insert(row) } catch { /* the answer still says what happened */ }
}
/** 3 scheduled runs in a row that could not run: one Needs Attention item (once). */
async function failureWatch(db: any, items: any[] | null) {
  try {
    const { data } = await db.from('caregiver_connect_runs').select('ok').eq('caller', 'cron').order('at', { ascending: false }).limit(3)
    if (!Array.isArray(data) || data.length < 3 || data.some((r: any) => r.ok)) return
    const its = items ?? (await lists(db).catch(() => ({ items: [] as any[] }))).items
    if (isOpen(its.find((x: any) => x && x.id === FAILING_ID))) return
    const at = new Date().toISOString()
    await putItem(db, { id: FAILING_ID, kind: 'caregiver_connect', domain: 'caregivers', status: 'open', urgency: 'today',
      title: 'Caregiver connect check is not running',
      detail: 'The hourly check that connects AxisCare caregivers to their Hub records could not run 3 times in a row, so nobody new is being connected. '
        + 'Settings, Caregiver connect shows why. Tell Claude.',
      next_action: 'Tell Claude.', created_at: at, first_at: at, last_activity_at: at, opened_by: 'caregiver-connect', created_by: 'caregiver-connect',
      owner: await caregiversOwner(db), owner_name: '', log: [{ at, by: 'automation', text: 'Opened after 3 runs in a row could not run.' }] })
  } catch { /* never let reporting break the run */ }
}

export type JobOpts = { caller: string; runId: string; dry?: boolean; now?: Date }

export async function runJob(db: any, deps: Deps, o: JobOpts) {
  const at = (o.now ?? new Date()).toISOString()
  let st: any = {}
  try { st = await settings(db) } catch { st = {} }
  const live = st.cg_connect_live === true
  const mode = live ? 'live' : 'practice'
  const fail = async (error: string) => {
    if (!o.dry) {
      await recordRun(db, { run_id: o.runId, mode, caller: o.caller, ok: false, error: error.slice(0, 300) })
      await failureWatch(db, null)
    }
    return { ok: false, mode, error }
  }
  const cen = await deps.census()
  if (!cen.ok) return fail('AxisCare could not be read (' + cen.error + '), so nothing was changed')
  const R = await deps.rules()
  if (!R.ok) return fail(R.error + ', so nothing was changed')
  const C = R.C
  let L: any, blocked: any[]
  try { L = await lists(db); blocked = await blockedPairs(db) } catch (e) { return fail(String((e as Error).message ?? e) + ', so nothing was changed') }
  const plan = C.plan(cen.rows, L.cgs, L.cands, { blocked })
  const counts = { census_total: cen.total, census_active: cen.rows.filter((r: CensusRow) => r.active).length,
    linked: plan.link.length, moved: plan.move.length, created: plan.create.length, review: plan.review.length }
  if (o.dry) return { ok: true, dry: true, mode, ...counts, truncated: cen.truncated }

  const nm = (x: any) => C.name(x)
  const reviewRows = plan.review.map((r: any) => ({ action: 'review', axiscare_id: String(r.ax.id), ax_name: nm(r.ax), why: r.why,
    options: (r.options ?? []).map((x: any) => ({ where: x.where, id: x.id, name: x.name, why: x.why.join(', '), linked_to: x.linked_to, state: x.state, text: optText(C, x) })) }))
  const note = cen.truncated ? 'AxisCare listed more caregivers than one read takes; the rest wait for the next run' : null

  if (!live) {
    const rows = [
      ...plan.link.map((a: any) => ({ action: 'link', axiscare_id: String(a.ax.id), ax_name: nm(a.ax), how: a.how, record_kind: 'caregiver', record_id: String(a.row.id), record_name: nm(a.row) })),
      ...plan.move.map((m: any) => ({ action: 'move', axiscare_id: String(m.ax.id), ax_name: nm(m.ax), how: m.how, record_kind: 'candidate', record_id: String(m.cand.id), record_name: nm(m.cand) })),
      ...plan.create.map((c: any) => ({ action: 'create', axiscare_id: String(c.ax.id), ax_name: nm(c.ax), how: 'new' })),
      ...reviewRows,
    ]
    const { error } = await db.rpc('caregiver_connect_practice', { p_run: o.runId, p_rows: rows, p_mode: 'practice' })
    if (error) return fail('the practice list could not be saved: ' + String(error.message ?? error).slice(0, 120))
    await recordRun(db, { run_id: o.runId, mode, caller: o.caller, ok: true, ...counts, note })
    try { await closeItem(db, L.items, FAILING_ID, 'automation', 'Running again.') } catch { /* next run */ }
    return { ok: true, mode, ...counts, truncated: cen.truncated }
  }

  // ── live ──
  const done: { linked: string[]; moved: string[]; created: string[] } = { linked: [], moved: [], created: [] }
  let refused = 0
  const errors: string[] = []
  const apply = async (p: any) => {
    const { data, error } = await db.rpc('caregiver_connect_apply', { p: { ...p, run_id: o.runId, by: 'auto' } })
    if (error) { errors.push(String(error.message ?? error).slice(0, 120)); return null }
    if (!data?.ok) refused++
    return data
  }
  const today = at.slice(0, 10)   // the button's own fallback: today's date (only when AxisCare and B&R give none)
  for (const a of plan.link) {
    const r = await apply({ op: 'link', axiscare_id: String(a.ax.id), ax_name: nm(a.ax), how: a.how, caregiver_id: String(a.row.id), base_rev: rev(a.row),
      connected: { at, how: a.how, by: 'auto' } })
    if (r?.ok) done.linked.push(String(a.ax.id))
  }
  for (const m of plan.move) {
    const record = C.movedRecord(m.cand, m.ax, { promoted_at: at, hiring_snapshot: null, today,
      connected: { at, how: m.how, by: 'auto', from: 'background & references' } })
    const r = await apply({ op: 'move', axiscare_id: String(m.ax.id), ax_name: nm(m.ax), how: m.how, candidate_id: String(m.cand.id), cand_base_rev: rev(m.cand), record })
    if (r?.ok) done.moved.push(String(m.ax.id))
  }
  for (const c of plan.create) {
    const record = C.newRecord(c.ax, { connected: { at, by: 'auto', how: 'new' }, via: 'auto from AxisCare' })
    const r = await apply({ op: 'create', axiscare_id: String(c.ax.id), ax_name: nm(c.ax), how: 'new', record })
    if (r?.ok) done.created.push(String(c.ax.id))
  }
  const { error: le } = await db.rpc('caregiver_connect_practice', { p_run: o.runId, p_rows: reviewRows, p_mode: 'live' })
  if (le) errors.push('the needs-a-look list could not be saved')
  // Needs Attention: one item per caregiver a person must decide about (never doubled; one a person closed stays closed);
  // items for caregivers now connected are closed.
  let items = L.items
  try { items = (await lists(db)).items } catch { /* use the earlier copy */ }
  const owner = plan.review.length ? await caregiversOwner(db) : ''
  for (const r of plan.review) {
    if (items.some((x: any) => x && x.id === itemId(String(r.ax.id)))) continue
    try { await putItem(db, reviewItem(C, r, owner, at)) } catch (e) { errors.push(String((e as Error).message)) }
  }
  for (const ax of new Set([...plan.connected, ...done.linked, ...done.moved, ...done.created])) {
    try { await closeItem(db, items, itemId(ax), 'automation', 'Connected to their Hub record.') } catch (e) { errors.push(String((e as Error).message)) }
  }
  try { await closeItem(db, items, FAILING_ID, 'automation', 'Running again.') } catch { /* next run */ }
  const out = { linked: done.linked.length, moved: done.moved.length, created: done.created.length, review: plan.review.length, refused }
  await recordRun(db, { run_id: o.runId, mode, caller: o.caller, ok: errors.length === 0, census_total: counts.census_total, census_active: counts.census_active,
    ...out, error: errors.length ? errors.slice(0, 3).join(' · ').slice(0, 300) : null, note })
  return { ok: errors.length === 0, mode, census_total: counts.census_total, census_active: counts.census_active, ...out, truncated: cen.truncated, ...(errors.length ? { errors } : {}) }
}

// ── the Connect card and "Not this person" (a signed-in office person) ──
export type Staff = { name: string; email: string }
export async function manualAction(db: any, deps: Deps, staff: Staff, body: any) {
  const who = staff.email || staff.name || 'staff'
  const shown = staff.name || staff.email || 'staff'
  const at = new Date().toISOString()
  const action = String(body?.action ?? '')
  if (action === 'undo') {
    const id = Number(body?.log_id)
    if (!Number.isInteger(id) || id <= 0) return { ok: false, status: 400, message: 'Which connection? Nothing was changed.' }
    const { data: row } = await db.from('caregiver_connect_log').select('id, action, result').eq('id', id).maybeSingle()
    const op = row && row.result === 'done' ? ({ link: 'unlink', move: 'unmove', create: 'uncreate' } as any)[row.action] : null
    if (!op) return { ok: false, status: 404, message: 'That connection was not found. Nothing was changed.' }
    const { data, error } = await db.rpc('caregiver_connect_apply', { p: { op, log_id: id, by: who } })
    if (error) return { ok: false, status: 500, message: 'That did not go through: ' + String(error.message ?? error).slice(0, 120) }
    return data?.ok ? { ok: true, message: op === 'unmove' ? 'Undone. They are back in Background & References.' : 'Undone. That record is no longer connected to them.' }
      : { ok: false, status: 409, message: String(data?.message ?? 'Nothing was changed.') }
  }
  if (!['link', 'move', 'new'].includes(action)) return { ok: false, status: 400, message: 'Unknown action.' }
  const axId = String(body?.axiscare_id ?? '').trim()
  if (!axId) return { ok: false, status: 400, message: 'Which caregiver? Nothing was changed.' }
  const cen = await deps.census()
  if (!cen.ok) return { ok: false, status: 502, message: 'AxisCare could not be read just now, so nothing was changed. Try again in a minute.' }
  const ax = cen.rows.find((r) => r.id === axId)
  if (!ax) return { ok: false, status: 404, message: 'That caregiver was not found in AxisCare. Nothing was changed.' }
  const connected = { at, by: shown, how: 'manual' }
  let p: any
  let C: any = null
  if (action !== 'link') {
    const R = await deps.rules()
    if (!R.ok) return { ok: false, status: 503, message: 'The connect rules could not be loaded (' + R.error + '), so nothing was changed. Tell Claude.' }
    C = R.C
  }
  const name = `${ax.first} ${ax.last}`.trim()
  if (action === 'link') {
    const cid = String(body?.caregiver_id ?? '')
    if (!cid) return { ok: false, status: 400, message: 'Which Hub record? Nothing was changed.' }
    p = { op: 'link', axiscare_id: axId, ax_name: name, how: 'manual', caregiver_id: cid, connected }
  } else if (action === 'move') {
    const kid = String(body?.candidate_id ?? '')
    let L: any
    try { L = await lists(db) } catch { return { ok: false, status: 500, message: 'Background & References could not be read, so nothing was changed.' } }
    const cand = L.cands.find((k: any) => k && String(k.id) === kid)
    if (!cand) return { ok: false, status: 404, message: 'They are no longer in Background & References. Nothing was changed.' }
    p = { op: 'move', axiscare_id: axId, ax_name: name, how: 'manual', candidate_id: kid, cand_base_rev: rev(cand),
      record: C.movedRecord(cand, ax, { promoted_at: at, hiring_snapshot: null, today: at.slice(0, 10), connected: { ...connected, from: 'background & references' } }) }
  } else {
    p = { op: 'create', axiscare_id: axId, ax_name: name, how: 'manual', record: C.newRecord(ax, { connected, via: 'manual from AxisCare' }) }
  }
  const { data, error } = await db.rpc('caregiver_connect_apply', { p: { ...p, mode: 'manual', by: who } })
  if (error) return { ok: false, status: 500, message: 'That did not go through: ' + String(error.message ?? error).slice(0, 120) }
  if (!data?.ok) return { ok: false, status: 409, message: String(data?.message ?? 'Nothing was changed.') }
  try { const L = await lists(db); await closeItem(db, L.items, itemId(axId), shown, 'Connected on the Connect card.') } catch { /* the next hourly run closes it */ }
  return { ok: true, caregiver_id: data.caregiver_id, log_id: data.log_id,
    message: action === 'link' ? 'Connected.' : action === 'move' ? 'Moved over from Background & References and connected.' : 'A new Hub record was started and connected.' }
}
