// =============================================================================
// START FORMS IMPORT THEMSELVES, the check (443; safe saves step 6). Samantha approved 2026-10-04 ("yes to all";
// "go with 1"). Every 5 minutes: each start form that arrived after this was installed (ops_settings
// .intake_auto_import_from), is not imported or seen yet, and was not handled before, is decided by the Hub's own
// intake-import-rules.js (run only when its fingerprint is approved):
//   import  a new person with a job offer (their email or phone matches one) becomes a candidate through
//           candidate_import_apply (the candidate and "imported" in one step, all or nothing)
//   card    already on the roster / marked not hired / already in Background & References / no job offer / no contact:
//           one Needs Attention card, nothing about them changed; the form stays on the Import list for a person
//   done    already imported by someone: just noted
// Switch OFF (ops_settings.intake_auto_import_live): practice, only lists what it WOULD do. If the start forms, the job
// offers or the rules can't be read, nothing is changed and the run says why; 3 scheduled runs in a row like that open
// a Needs Attention card. Never reads the SSN. Sends nothing (reference requests stay behind their own button).
// =============================================================================
// deno-lint-ignore-file no-explicit-any
export const RULES_FILE = 'intake-import-rules.js'
export const FAILING_ID = 'ops_intake_import_failing'
export const cardId = (intakeId: string) => 'ops_intake_' + intakeId
export const INTAKE_COLS = 'id, first_name, last_name, phone, email, lived_outside_mo, refs, no_employer_history, created_at, seen_at, auto_import_at, start_offer_id, start_link_exp, start_link_sig'
/* linkOk (2026-10-04, private applicant links): did this start form come through a private start link the server made
   (checked here, never trusted from the page)? Such a form counts as "we sent them a start link" even if they typed a
   different email or phone. */
export type Deps = { rules: () => Promise<{ ok: true; I: any } | { ok: false; error: string }>; offers: () => Promise<{ ok: true; rows: any[] } | { ok: false; error: string }>
  linkOk?: (f: any) => Promise<boolean> }

export function rulesFrom(src: string): any {
  const scope: any = {}
  new Function('globalThis', String(src))(scope)
  const I = scope.CCIntake
  if (!I || typeof I.decide !== 'function' || typeof I.candidateFromIntake !== 'function' || typeof I.cardText !== 'function')
    throw new Error(RULES_FILE + ' did not define the start form rules')
  return I
}
const short = (r: any) => [String(r?.first_name || '').trim(), String(r?.last_name || '').trim().slice(0, 1)].filter(Boolean).join(' ')
const isOpen = (it: any) => it && !/^(done|closed|dismissed|resolved|cancelled|canceled)$/i.test(String(it.status || 'open'))
let ownerCache: string | null = null
async function owner(db: any): Promise<string> {
  if (ownerCache != null) return ownerCache
  let o = ''
  try {
    const { data: dom } = await db.from('domains').select('owner_person').eq('code', 'caregivers').eq('entity', 'cc_ihs').maybeSingle()
    if (dom?.owner_person) { const { data: p } = await db.from('persons').select('primary_email').eq('person_id', dom.owner_person).maybeSingle(); o = String(p?.primary_email ?? '') }
  } catch { o = '' }
  return (ownerCache = o)
}
async function items(db: any): Promise<any[]> {
  const { data } = await db.from('app_data').select('data').eq('key', 'ops_items').maybeSingle()
  return Array.isArray(data?.data) ? data.data : []
}
async function putItem(db: any, item: any) {
  const { error } = await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item })
  if (error) throw new Error('Needs Attention could not be updated: ' + String(error.message ?? error).slice(0, 120))
}
async function recordRun(db: any, row: any) { try { await db.from('intake_import_runs').insert(row) } catch { /* the answer still says it */ } }
async function failureWatch(db: any) {
  try {
    const { data } = await db.from('intake_import_runs').select('ok').eq('caller', 'cron').order('at', { ascending: false }).limit(3)
    if (!Array.isArray(data) || data.length < 3 || data.some((r: any) => r.ok)) return
    const its = await items(db)
    if (isOpen(its.find((x: any) => x && x.id === FAILING_ID))) return
    const at = new Date().toISOString()
    await putItem(db, { id: FAILING_ID, kind: 'intake_card', domain: 'caregivers', status: 'open', urgency: 'today',
      title: 'Start form check is not running',
      detail: 'The check that imports new start forms could not run 3 times in a row, so new start forms are waiting. They still show on the Import list in Background & References. Tell Claude.',
      next_action: 'Import new start forms by hand for now, and tell Claude.', created_at: at, first_at: at, last_activity_at: at,
      opened_by: 'intake-import', created_by: 'intake-import', owner: await owner(db), owner_name: '', log: [{ at, by: 'automation', text: 'Opened after 3 runs in a row could not run.' }] })
  } catch { /* never let reporting break the run */ }
}

export type JobOpts = { caller: string; runId: string; dry?: boolean; now?: Date }
export async function runJob(db: any, deps: Deps, o: JobOpts) {
  const at = (o.now ?? new Date()).toISOString()
  let st: any = {}
  try { const { data } = await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle(); st = (data?.data && typeof data.data === 'object') ? data.data : {} } catch { st = {} }
  const live = st.intake_auto_import_live === true
  const mode = live ? 'live' : 'practice'
  const from = typeof st.intake_auto_import_from === 'string' && !isNaN(Date.parse(st.intake_auto_import_from)) ? st.intake_auto_import_from : null
  const fail = async (error: string) => {
    if (!o.dry) { await recordRun(db, { run_id: o.runId, mode, caller: o.caller, ok: false, error: error.slice(0, 300) }); await failureWatch(db) }
    return { ok: false, mode, error }
  }
  if (!from) return fail('no start date is set for the check (intake_auto_import_from), so nothing was looked at')
  const { data: forms, error: fe } = await db.from('hire_intake').select(INTAKE_COLS).gte('created_at', from).is('seen_at', null).is('auto_import_at', null).order('created_at', { ascending: true }).limit(50)
  if (fe || !Array.isArray(forms)) return fail('the start forms could not be read (' + String(fe?.message ?? 'no answer').slice(0, 120) + '), so nothing was changed')
  if (!forms.length) {
    if (!o.dry) { if (!live) await db.rpc('intake_import_practice', { p_run: o.runId, p_rows: [] }); await recordRun(db, { run_id: o.runId, mode, caller: o.caller, ok: true, seen: 0 }) }
    return { ok: true, mode, seen: 0, imported: 0, cards: 0, done: 0 }
  }
  const R = await deps.rules(); if (!R.ok) return fail(R.error + ', so nothing was changed')
  const OF = await deps.offers(); if (!OF.ok) return fail('the job offers could not be read (' + OF.error + '), so nothing was changed')
  const { data: lists, error: le } = await db.from('app_data').select('key, data').in('key', ['candidates', 'caregivers'])
  if (le || !Array.isArray(lists)) return fail('the Hub lists could not be read, so nothing was changed')
  const L: any = {}; for (const r of lists) L[r.key] = Array.isArray(r.data) ? r.data : []
  const I = R.I
  const plan: any[] = []
  for (const f of forms) {
    let link_offer_ok = false
    try { link_offer_ok = f.start_offer_id ? !!(await deps.linkOk?.(f)) : false } catch { link_offer_ok = false }
    /* a form from a valid private start link counts as matching its job offer (whatever email or phone they typed) */
    const offers = link_offer_ok ? OF.rows.concat([{ id: String(f.start_offer_id), phone: f.phone, email: f.email }]) : OF.rows
    plan.push({ f, d: I.decide(f, { cands: L.candidates || [], cgs: L.caregivers || [], offers }), link_offer_ok })
  }
  const counts = { seen: forms.length, imported: plan.filter((p: any) => p.d.action === 'import').length, cards: plan.filter((p: any) => p.d.action === 'card').length, done: plan.filter((p: any) => p.d.action === 'done').length }
  if (o.dry) return { ok: true, dry: true, mode, ...counts }
  if (!live) {
    const rows = plan.map((p: any) => ({ intake_id: String(p.f.id), who: short(p.f), action: p.d.action, reason: p.d.reason, detail: p.d.action === 'card' ? I.cardText(p.f, p.d).title : '' }))
    const { error } = await db.rpc('intake_import_practice', { p_run: o.runId, p_rows: rows })
    if (error) return fail('the practice list could not be saved')
    await recordRun(db, { run_id: o.runId, mode, caller: o.caller, ok: true, ...counts })
    return { ok: true, mode, ...counts }
  }
  const out = { imported: 0, cards: 0, done: 0 }; const errors: string[] = []
  let its: any[] | null = null
  for (const p of plan) {
    const id = String(p.f.id)
    try {
      if (p.d.action === 'import') {
        const record = I.candidateFromIntake(p.f, { who: 'start form check', at, note: 'Imported automatically from their start form (a job offer matched their email or phone).' })
        const { data, error } = await db.rpc('candidate_import_apply', { p_intake_id: id, p_record: record, p_by: 'auto', p_run: o.runId })
        if (error) throw new Error(String(error.message ?? error).slice(0, 120))
        if (data?.ok) out.imported++
        else if (data?.reason === 'already') out.done++
        continue
      }
      if (p.d.action === 'done') {
        await db.from('hire_intake').update({ auto_import_at: at, auto_import_result: 'done' }).eq('id', p.f.id).is('auto_import_at', null)
        out.done++; continue
      }
      its = its ?? await items(db)
      const cid = cardId(id)
      if (!its.some((x: any) => x && x.id === cid)) {
        const t = I.cardText(p.f, p.d)
        await putItem(db, { id: cid, kind: 'intake_card', domain: 'caregivers', intake_id: id, reason: p.d.reason, about: short(p.f), status: 'open', urgency: 'normal',
          title: t.title, detail: t.detail, next_action: t.next, created_at: at, first_at: at, last_activity_at: at, opened_by: 'intake-import', created_by: 'intake-import',
          owner: await owner(db), owner_name: '', log: [{ at, by: 'automation', text: 'Opened by the start form check.' }] })
      }
      await db.from('hire_intake').update({ auto_import_at: at, auto_import_result: 'card:' + p.d.reason }).eq('id', p.f.id).is('auto_import_at', null)
      await db.from('intake_import_log').insert({ run_id: o.runId, mode: 'live', intake_id: id, who: short(p.f), action: 'card', reason: p.d.reason, result: 'done' })
      out.cards++
    } catch (e) {
      errors.push(short(p.f) + ': ' + String((e as Error).message ?? e).slice(0, 120))
      try { await db.from('intake_import_log').insert({ run_id: o.runId, mode: 'live', intake_id: id, who: short(p.f), action: p.d.action, reason: p.d.reason, result: 'failed', detail: String((e as Error).message ?? e).slice(0, 200) }) } catch { /* */ }
    }
  }
  await recordRun(db, { run_id: o.runId, mode, caller: o.caller, ok: errors.length === 0, seen: forms.length, ...out, error: errors.length ? errors.slice(0, 3).join(' · ').slice(0, 300) : null })
  return { ok: errors.length === 0, mode, seen: forms.length, ...out, ...(errors.length ? { errors } : {}) }
}
