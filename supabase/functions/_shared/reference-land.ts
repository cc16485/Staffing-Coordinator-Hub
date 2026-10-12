// =============================================================================
// reference-land.ts · REFERENCE ANSWERS LAND BY THEMSELVES (Samantha 2026-10-12, step 3)
// =============================================================================
// When a reference answers the online form, the row in reference_requests holds their answers until somebody presses
// "Sync reference answers" in the Hub. This is the server half of that button, and ONLY the answer landing:
//   1. the answer becomes the slot's fields on the Background & References person (CCElig.refAnswerPatch, the ONE copy
//      in eligibility-rules.js that the button also runs), saved through the door reference_land_apply (only the five
//      slot fields, only if nobody changed that person since it was read);
//   2. a Negative answer opens one Needs Attention card for today (ops_items, id ops_negref_<request id>, the same card
//      the button opens), unless the answer is older than NEGATIVE_ALERT_MAX_AGE_DAYS (it still lands: it is a fact);
//   3. the row is marked landed (merged_at), so it is never landed twice.
// It never runs markScreeningCleared, never makes a PDF, never sends anything to anyone (owner ruling 2026-09-21: those
// stay with a person pressing the button).
// deno-lint-ignore-file no-explicit-any

/** A Negative answer older than this still lands on the record, but opens no card (a first run must not flood). */
export const NEGATIVE_ALERT_MAX_AGE_DAYS = 14
/** The most answers landed in one run; the rest land on the next run. */
export const BATCH_LIMIT = 50
/** Answered rows read per run. Larger than BATCH_LIMIT so rows that are skipped every time (the person is gone or not
 *  hired) can never crowd out a new answer. */
export const SCAN_LIMIT = 500
/** How many times a landing is worked out again on the fresh record when somebody saved that person meanwhile. */
export const DOOR_TRIES = 3
export const LANDED_BY = 'reference-land'
export const NO_LANDING_YET = "the Hub's rules file does not have the reference landing yet; merge the Hub pull request and run the report again"

export const rev = (x: any) => (/^[0-9]{1,15}$/.test(String(x?._rev ?? '')) ? Number(x._rev) : 0)
const nameOf = (c: any) => `${c?.first ?? ''} ${c?.last ?? ''}`.trim()
const notHired = (c: any) => !!c?.not_hired && c.not_hired !== 'false'
/** Her rule, no silent overwrites: the office already recorded this reference (an answers record that did not come from
 *  the online form, or a status set by hand with no answers record). Such a slot is never landed on; the online answer
 *  waits for someone to look (the Sync button). A blank or Pending slot, or one whose answers came from the online form
 *  (a re-answer), lands. */
export function officeRecorded(c: any, n: number): boolean {
  const m = c?.['r' + n + '_manual'], s = String(c?.['r' + n + 's'] ?? '')
  const hasManual = m != null && m !== ''
  if (hasManual) return typeof m !== 'object' || Array.isArray(m) || m.via !== 'Online form'
  return ['Positive', 'Conditional', 'Negative'].includes(s)
}
const ageDays = (iso: string, now: Date) => { const t = Date.parse(iso); return Number.isFinite(t) ? (now.getTime() - t) / 86_400_000 : Infinity }

const SKIP_WHY: Record<string, string> = {
  no_candidate: 'the person is not in Background & References',
  duplicate_id: 'two people in Background & References share this number',
  bad_slot: 'the reference has no slot 1 to 4',
  not_hired: 'the person is marked not hired',
  office_recorded: 'the office already recorded this reference; the online answer waits for someone to look (Sync button)',
  changed: 'the person kept changing while it tried; it tries again next run',
}

export type Plan = {
  request_id: string; candidate_id: string; name: string; slot: number; current_status: string; score: string
  responded_at: string; negative: boolean; alert: 'opens' | 'held_too_old' | 'none'
}
export type Skip = { request_id: string; candidate_id: string; slot: unknown; reason: string; why: string }

/** The same card the Hub's button opens for a Negative answer (caregivers-engine.js refReconcile), field for field. */
export function negativeItem(c: any, r: any, now: Date) {
  const who = nameOf(c)
  return {
    id: 'ops_negref_' + r.id, kind: 'discipline', source_id: 'negref_' + r.id,
    title: 'Negative reference for ' + who,
    detail: (r.responder_name || r.ref_name || 'A reference') +
      (r.ref_relationship ? ' (' + r.ref_relationship + ')' : '') +
      ' would not recommend them' +
      (r.concerns === 'serious' ? ' and raised a serious concern' : '') + '.' +
      (r.notes ? ' They said: "' + String(r.notes).slice(0, 300) + '"' : '') +
      ' Read the full record before this candidate goes any further.',
    about: who, urgency: 'today', status: 'open',
    created_at: now.toISOString(),
    due: new Date(now.getTime() + 4 * 3600 * 1000).toISOString(),
    owner: '', owner_name: '', created_by: 'reference check', opened_by: 'system',
  }
}

/** Pure: what would land, and what is skipped and why. No reads, no writes. */
export function plan(rows: any[], candidates: any[], E: any, now: Date): { plans: { p: Plan; r: any; c: any }[]; skipped: Skip[] } {
  const plans: { p: Plan; r: any; c: any }[] = [], skipped: Skip[] = []
  const skip = (r: any, reason: string) => skipped.push({ request_id: String(r?.id ?? ''), candidate_id: String(r?.candidate_id ?? ''), slot: r?.slot ?? null, reason, why: SKIP_WHY[reason] || reason })
  for (const r of rows) {
    const n = Number(r?.slot)
    if (!(Number.isInteger(n) && n >= 1 && n <= 4)) { skip(r, 'bad_slot'); continue }
    const hits = candidates.filter((x) => x && x.id != null && String(x.id) === String(r.candidate_id ?? ''))
    if (!hits.length) { skip(r, 'no_candidate'); continue }
    if (hits.length > 1) { skip(r, 'duplicate_id'); continue }
    const c = hits[0]
    if (notHired(c)) { skip(r, 'not_hired'); continue }
    if (officeRecorded(c, n)) { skip(r, 'office_recorded'); continue }
    const lp = E.refAnswerPatch(c, r)
    if (!lp) { skip(r, 'bad_slot'); continue }
    const cur = String(c['r' + n + 's'] ?? '')
    const negative = lp.score === 'Negative'
    const old = ageDays(String(r.responded_at ?? ''), now) > NEGATIVE_ALERT_MAX_AGE_DAYS
    plans.push({ r, c, p: {
      request_id: String(r.id), candidate_id: String(c.id), name: nameOf(c), slot: n, current_status: cur || '(blank)', score: lp.score,
      responded_at: String(r.responded_at ?? ''), negative, alert: negative ? (old ? 'held_too_old' : 'opens') : 'none',
    } })
  }
  return { plans, skipped }
}

/** Answered, not yet landed: oldest first. */
export async function readAnswered(db: any) {
  const { data, error } = await db.from('reference_requests').select('*')
    .not('responded_at', 'is', null).is('merged_at', null).order('responded_at', { ascending: true }).limit(SCAN_LIMIT)
  if (error) throw new Error('could not read the reference answers: ' + String(error.message || error).slice(0, 160))
  return Array.isArray(data) ? data : []
}
export async function readKey(db: any, k: string) {
  const { data, error } = await db.from('app_data').select('data').eq('key', k).maybeSingle()
  if (error) throw new Error('could not read ' + k + ': ' + String(error.message || error).slice(0, 160))
  return data?.data ?? null
}

/** READ ONLY. What would land if the switch were on. */
export async function report(db: any, E: any, now = new Date()) {
  const rows = await readAnswered(db)
  const cands = await readKey(db, 'candidates')
  const { plans, skipped } = plan(rows, Array.isArray(cands) ? cands : [], E, now)
  const would = plans.slice(0, BATCH_LIMIT).map((x) => x.p)
  return { ok: true, mode: 'report', wrote_nothing: true,
    counts: { seen: rows.length, would_land: would.length, waiting_for_next_run: Math.max(0, plans.length - BATCH_LIMIT), skipped: skipped.length,
      negatives: would.filter((p) => p.negative).length, alerts_would_open: would.filter((p) => p.alert === 'opens').length,
      alerts_held_too_old: would.filter((p) => p.alert === 'held_too_old').length, office_recorded_waiting: skipped.filter((x) => x.reason === 'office_recorded').length },
    would_land: would, skipped,
    limits: { batch: BATCH_LIMIT, negative_alert_max_age_days: NEGATIVE_ALERT_MAX_AGE_DAYS } }
}

/** One landing through the door; on "changed" it works the landing out again on the fresh record. */
async function landOne(db: any, E: any, r: any, c0: any): Promise<{ ok: true; c: any; fields: string[] } | { ok: false; reason: string; error?: string }> {
  let c = c0
  for (let i = 0; i < DOOR_TRIES; i++) {
    if (notHired(c)) return { ok: false, reason: 'not_hired' }
    const lp0 = Number(r?.slot); if (officeRecorded(c, lp0)) return { ok: false, reason: 'office_recorded' }
    const lp = E.refAnswerPatch(c, r); if (!lp) return { ok: false, reason: 'bad_slot' }
    const { data, error } = await db.rpc('reference_land_apply', { p_candidate_id: String(c.id), p_slot: lp.slot, p_base_rev: rev(c), p_patch: lp.set, p_by: LANDED_BY })
    if (error) return { ok: false, reason: 'error', error: String(error.message || error).slice(0, 200) }
    if (data?.ok) return { ok: true, c: { ...c, ...lp.set }, fields: Array.isArray(data.fields) ? data.fields : [] }
    if (data?.reason !== 'changed' || !data.current_record) return { ok: false, reason: String(data?.reason || 'refused') }
    c = data.current_record
  }
  return { ok: false, reason: 'changed' }
}

/** The switch is checked by the caller. Lands up to BATCH_LIMIT answers. Never sends anything. */
export async function apply(db: any, E: any, now = new Date()) {
  const rows = await readAnswered(db)
  const cands = await readKey(db, 'candidates')
  const { plans, skipped } = plan(rows, Array.isArray(cands) ? cands : [], E, now)
  const out = { ok: true, mode: 'apply', seen: rows.length, landed: 0, skipped: skipped.length, alerts: 0, alerts_already_open: 0, too_old: 0,
    waiting_for_next_run: Math.max(0, plans.length - BATCH_LIMIT), errors: [] as string[], landed_rows: [] as any[], skipped_rows: skipped as Skip[] }
  let ops: any[] | null = null
  for (const { r, c, p } of plans.slice(0, BATCH_LIMIT)) {
    const res = await landOne(db, E, r, c)
    if (!res.ok) {
      if (res.reason === 'error') out.errors.push(`request ${p.request_id}: the door refused (${res.error})`)
      else { out.skipped++; out.skipped_rows.push({ request_id: p.request_id, candidate_id: p.candidate_id, slot: p.slot, reason: res.reason, why: SKIP_WHY[res.reason] || res.reason }) }
      continue
    }
    if (p.negative) {
      if (p.alert === 'held_too_old') out.too_old++
      else {
        try {
          if (ops === null) { const v = await readKey(db, 'ops_items'); ops = Array.isArray(v) ? v : [] }
          const id = 'ops_negref_' + r.id
          if (ops.some((x) => x && String(x.id) === id)) out.alerts_already_open++
          else {
            const item = negativeItem(res.c, r, now)
            const { error } = await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item })
            if (error) throw new Error(String(error.message || error).slice(0, 160))
            ops.push(item); out.alerts++
          }
        } catch (e) {
          /* the answer is on the record; the row stays unlanded so the card is tried again next run */
          out.errors.push(`request ${p.request_id}: the negative card could not be opened (${String((e as Error).message || e).slice(0, 160)}); it tries again next run`)
          out.landed++; out.landed_rows.push({ ...p, merged: false })
          continue
        }
      }
    }
    const { error: mErr } = await db.from('reference_requests').update({ merged_at: now.toISOString() }).eq('id', r.id).is('merged_at', null)
    if (mErr) out.errors.push(`request ${p.request_id}: landed, but could not be marked landed (${String(mErr.message || mErr).slice(0, 120)}); next run lands it again with no change`)
    out.landed++; out.landed_rows.push({ ...p, merged: !mErr })
  }
  out.ok = out.errors.length === 0
  return out
}

/** Every live run that did something leaves one line in the automation log; every live run beats. Never throws. */
export async function recordRun(db: any, o: any, at: string, ms: number) {
  try {
    await db.rpc('upsert_app_data_item', { target_key: 'automation_heartbeats', item: { id: 'hb_reference-land', automation: 'reference-land', at, ok: o.ok !== false,
      note: `seen ${o.seen ?? 0}, landed ${o.landed ?? 0}, skipped ${o.skipped ?? 0}, cards ${o.alerts ?? 0}, held for age ${o.too_old ?? 0}` + (o.error ? `; ${o.error}` : '') } })
  } catch { /* the beat must not take the run down */ }
  if (!(o.landed || o.alerts || o.too_old || (o.errors && o.errors.length) || o.error)) return
  try {
    await db.rpc('upsert_app_data_item', { target_key: 'automation_log', item: {
      id: 'auto_srv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), at, automation: 'reference_land', ran_by: 'server',
      ok: o.ok !== false, dry: false, duration_ms: ms, rows_seen: o.seen ?? 0, created: o.alerts ?? 0, skipped: o.skipped ?? 0, too_old: o.too_old ?? 0,
      summary: { seen: o.seen ?? 0, landed: o.landed ?? 0, skipped: o.skipped ?? 0, alerts: o.alerts ?? 0, too_old: o.too_old ?? 0, waiting_for_next_run: o.waiting_for_next_run ?? 0 },
      errors: (o.errors || []).length + (o.error ? 1 : 0), error: o.error || (o.errors || []).join(' | ').slice(0, 500) || null } })
  } catch { /* the log must not take the run down */ }
}
