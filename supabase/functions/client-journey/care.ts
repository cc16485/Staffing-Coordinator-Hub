// =====================================================================================================================
// PAUSE CARE and END CARE (Samantha approved 2026-10-07). The actions on the client-journey service that change whether a
// client is being cared for. Care Coordinators and owners only. Every change is a row in client_care_change (permanent):
// who made it and when, the effective date, the reason, the explanation when required, who told us, and the Medicaid
// checklist (a HUMAN checklist with proof: the Hub never sends a notice or ends services by itself).
//   care_state     where a client stands (active / starting / paused / past / deceased), the open pause, every change,
//                  and every episode (journey), oldest first
//   care_pause     Paused: a real state. The client stays visible with a follow-up date; their journey cards, shift alerts,
//                  staffing texts and routine outreach stop; ONE card asks "Is care restarting?" for their Care Coordinator
//   care_extend    pause longer (a new follow-up date)
//   care_resume    back to normal: the pause closes, the restart card closes, the same journey's cards come back
//   care_end       care ends on the effective date with the reason: the client role becomes past, the journey and its open
//                  work close (nothing is deleted), a death adds ONE human sympathy-card task. From an AxisCare status
//                  review too (review_id): an AxisCare change never ends care by itself.
//   care_return    a past client comes back, ONLY when a person confirms it (an owner, as before): a NEW episode and a new
//                  journey on the same person; the old ones stay as they were
//   care_end_date  correct a past or deceased client's end date (Samantha 2026-10-08), with how we know; the date becomes
//                  exact and the old one stays in the permanent care history
//   care_checklist / care_upload_url / care_file_url   the Medicaid checklist: tick, not needed (why), proof files
// =====================================================================================================================
// deno-lint-ignore no-explicit-any
type Any = any

export const END_REASONS: Record<string, string> = {
  other_provider: 'Chose another provider', moved_out: 'Moved out of our service area', facility: 'Admitted to a facility',
  beyond_scope: 'Needs exceed our scope', unable_to_staff: 'Unable to staff', requested_discharge: 'Client or family requested discharge',
  auth_ended: 'Medicaid or authorization ended', deceased: 'Deceased',
  /* Medicaid intake slice B (2026-10-08): the two other ways WE end services (19 CSR 15-7.021(16)(C),(D)) */
  noncompliance: 'Does not follow the care plan (we are ending services)', safety: 'Threats or abuse toward our staff (we are ending services)', other: 'Other' }
/* Medicaid intake slice B (Samantha 2026-10-08, her approved matrix): the discharge rules by reason.
   notice21: we end services while they still need care → written notice to the participant or family AND to DSDS at least
     21 days before the last day; care continues for the 21 days or until DSDS arranges other care (19 CSR 15-7.021(16)(D)).
     Her rule: an owner approves, and the Hub won't record an end sooner unless DSDS arranged other care first.
   immediate: death, a facility, no longer needs our services, threats or abuse → written notice to DSDS right away
     ((16)(B),(C)). Never blocks recording what happened; the checklist step stays open until a person ticks it.
   dsds: DSDS closed the case → stop right away ((16)(A)). choice: the participant chose another provider or to stop. */
export const DISCHARGE_RULE: Record<string, string> = { beyond_scope: 'notice21', unable_to_staff: 'notice21', noncompliance: 'notice21',
  deceased: 'immediate', facility: 'immediate', moved_out: 'immediate', safety: 'immediate', auth_ended: 'dsds', other_provider: 'choice', requested_discharge: 'choice', other: 'choice' }
const addDaysYmd = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
/** pure: may this Medicaid end be recorded? (only the 21-day reasons are ever refused) */
export function dischargeCheck(reason: string, b: Any, isOwner: boolean, today_: string): { ok: boolean; why?: string; earliest?: string; done?: Record<string, string> } {
  const rule = DISCHARGE_RULE[reason] || 'choice', ymd = (d: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(d ?? '')) ? String(d) : ''
  const eff = ymd(b.effective_date), np = ymd(b.notice_participant_on), nd = ymd(b.notice_dsds_on), dn = ymd(b.dsds_notice_on), arr = ymd(b.dsds_arranged_on)
  if (rule === 'notice21') {
    if (!isOwner) return { ok: false, why: 'Ending Medicaid services while the client still needs care needs an owner: ask Samantha to record it.' }
    if (!np || !nd) return { ok: false, why: 'Enter the dates the 21-day written notice went to the participant or family, and to DSDS.' }
    if (np > today_ || nd > today_) return { ok: false, why: 'A notice date can\'t be in the future.' }
    const earliest = addDaysYmd([np, nd].sort()[1], 21)
    if (eff < earliest) {
      if (!arr) return { ok: false, earliest, why: 'The last day can\'t be before ' + earliest + ' (21 days after both notices), unless DSDS arranged other care sooner: enter that date.' }
      if (arr > eff) return { ok: false, earliest, why: 'The last day can\'t be before DSDS\'s other arrangement (' + arr + ').' }
    }
    return { ok: true, earliest, done: { notice_21: np, dsds_written: nd } }
  }
  if (rule === 'immediate' && dn) return { ok: true, done: { dsds_written: dn } }
  return { ok: true, done: {} }
}
export const PAUSE_REASONS: Record<string, string> = { hospital: 'Hospital stay', rehab: 'Rehab or skilled nursing stay', family_away: 'Family away', other: 'Other' }
/* the older AxisCare-review answer words, for client_status_decide (the exact reason is kept on the change and the role) */
const LEGACY: Record<string, string> = { other_provider: 'discharged', moved_out: 'moved', facility: 'facility', beyond_scope: 'discharged', unable_to_staff: 'discharged',
  requested_discharge: 'discharged', auth_ended: 'discharged', deceased: 'deceased', other: 'other' }

/* ── the Medicaid checklist: what the regulation says, as a person's checklist. Never automatic. ──
   source 'regulation' cites the rule; anything DSDS hasn't answered says so instead of assuming (her 8 questions). */
const WAITING = 'How it is delivered and to whom is waiting on DSDS (your questions).'
export function checklistFor(kind: string, reason: string, payer: string | null): Any[] {
  const med = payer === 'medicaid' || payer === null
  const item = (key: string, label: string, rule: string, when: string, extra?: string) => ({ key, label, source: 'regulation', rule, when, note_needed: extra || '', state: 'open' })
  const out: Any[] = []
  if (!med) return out
  if (kind === 'end') {
    const rule = DISCHARGE_RULE[reason] || 'choice'
    if (rule === 'notice21') {
      out.push(item('notice_21', '21-day written notice to the participant or family', '19 CSR 15-7.021(16)(D)', 'At least 21 days before the last day: we are ending services while they still need care. Keep a copy.'))
      out.push(item('dsds_written', '21-day written notice to DSDS', '19 CSR 15-7.021(16)(D)', 'At least 21 days before the last day, at the same time as the participant\'s notice. Keep a copy.'))
      out.push(item('continue_21', 'Keep providing care for the 21 days, or until DSDS arranges another provider', '19 CSR 15-7.021(16)(D)', 'Care does not stop early unless DSDS has arranged other care.'))
    } else if (rule === 'immediate') {
      out.push(item('dsds_written', 'Tell DSDS in writing, right away', reason === 'safety' ? '19 CSR 15-7.021(16)(C)' : '19 CSR 15-7.021(16)(B)',
        reason === 'safety' ? 'Right away: threats or abuse toward staff. DSDS and we decide together whether services continue.'
          : 'Right away: the participant ' + (reason === 'deceased' ? 'died' : reason === 'facility' ? 'entered a facility' : 'no longer needs our services') + '. Ask that services be discontinued.'))
    } else if (rule === 'dsds') {
      out.push(item('dsds_closed', 'Stop services from the date DSDS closed the case, and note that date from Fusion', '19 CSR 15-7.021(16)(A); MAN 4.40', 'DSDS closed the case: services stop right away.'))
    } else {
      out.push(item('dsds_written', 'Make sure DSDS knows', '19 CSR 15-7.021(16)(B); MAN 4.20', 'The participant chose another provider or to stop: DSDS moves or closes the case (the participant calls 866-835-3505). If they no longer need services, tell DSDS in writing.'))
    }
    out.push(item('records', 'Keep this record (5 years)', '19 CSR 15-7.021(24)', 'The Hub keeps this change and its proof permanently.'))
  }
  if (kind === 'pause' && ['hospital', 'rehab'].includes(reason)) {
    out.push(item('missed_visits', 'Record the missed visits with the reason', '19 CSR 15-7.021(18)(L)', 'Services can\'t be provided or billed while they are in a hospital or nursing facility (HCBS Manual 3.00).'))
    out.push(item('rn_report', 'RN: report the non-delivery of authorized services to DSDS', '19 CSR 15-7.021(20)(D)', 'Any hold period and how to report it is waiting on DSDS (your questions).', WAITING))
  }
  if (payer === null) out.forEach((x) => { x.when = 'If the client is on Medicaid. ' + x.when })
  return out
}

const lc = (s: unknown) => String(s ?? '').trim().toLowerCase()
const isYmd = (d: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(d ?? ''))

/** pure: a client's care state from their roles, open pause and journeys */
export function careState(roles: Any[], pause: Any | null, journeys: Any[]): string {
  const rs = (roles || []).filter((r: Any) => r && r.role === 'client')
  if (rs.some((r: Any) => /deceas/i.test(String(r.end_reason || ''))) && !rs.some((r: Any) => r.status === 'active')) return 'deceased'
  if (pause) return 'paused'
  if (rs.some((r: Any) => r.status === 'active')) return 'active'
  if ((journeys || []).some((j: Any) => j.status === 'open')) return 'starting'
  if (rs.length) return 'past'
  return 'unknown'
}

export async function careAction(c: Any): Promise<{ body: Any; status?: number }> {
  const { db, b, who, isOwner, pp, st, dfs, R, load, event, refreshCards, ctxFor, today, routeCc, openOne } = c
  const can = isOwner || (who.roles || []).includes('care_coordinator')
  const ax = String(b.axiscare_client_id ?? '').trim()
  const err = (m: string, s = 422, outcome = 'refused') => ({ body: { outcome, error: m }, status: s })
  const now = new Date().toISOString(), actor = { email: who.email, name: who.name }
  const isTest = b.is_test === true

  /* the checklist and its proof files work from the change itself */
  if (b.action === 'care_checklist' || b.action === 'care_upload_url' || b.action === 'care_file_url') {
    if (!can) return err('Only a Care Coordinator or an owner can do this.', 403)
    const { data: ch } = await db.from('client_care_change').select('*').eq('change_id', String(b.change_id || '')).maybeSingle()
    if (!ch) return err('That change was not found.', 404, 'not_found')
    if (b.action === 'care_upload_url') {
      const key = String(b.item || ''); if (!(ch.checklist || []).some((x: Any) => x.key === key)) return err('unknown checklist item', 400)
      const path = `care/${ch.change_id}/${key}/${Date.now()}-${String(b.name || 'file').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80)}`
      const { data, error } = await db.storage.from('client-journey-files').createSignedUploadUrl(path)
      if (error) return err('Could not prepare the upload.', 500)
      return { body: { path, token: data.token, url: data.signedUrl } }
    }
    if (b.action === 'care_file_url') {
      const path = String(b.path || ''); if (!path.startsWith(`care/${ch.change_id}/`)) return err('not this change\'s file', 403)
      const { data, error } = await db.storage.from('client-journey-files').createSignedUrl(path, 600)
      if (error) return err('Could not open the file.', 500)
      return { body: { url: data.signedUrl } }
    }
    const list = (ch.checklist || []).map((x: Any) => ({ ...x }))
    const it = list.find((x: Any) => x.key === String(b.item || '')); if (!it) return err('unknown checklist item', 400)
    const state = String(b.state || '')
    if (!['done', 'not_needed', 'open'].includes(state)) return err('done, not_needed or open', 400)
    if (state === 'not_needed' && !String(b.note || '').trim()) return err('Say why this step is not needed.')
    if (state === 'done' && !String(b.note || '').trim() && !(Array.isArray(b.files) && b.files.length) && !String(b.how || '').trim()) return err('Say how it was done, or attach the proof.')
    Object.assign(it, { state, note: String(b.note || '').slice(0, 1000), how: String(b.how || '').slice(0, 300), on: isYmd(b.on) ? b.on : null,
      files: [...(it.files || []), ...((Array.isArray(b.files) ? b.files : []).map(String).filter((p: string) => p.startsWith(`care/${ch.change_id}/${it.key}/`)))],
      by: who.email, by_name: who.name, at: now })
    const { error } = await db.from('client_care_change').update({ checklist: list, updated_at: now }).eq('change_id', ch.change_id)
    if (error) return err('Could not save: ' + error.message, 500)
    return { body: { outcome: 'saved', checklist: list } }
  }

  if (!/^\d+$/.test(ax)) return err('Which client? (their AxisCare number)', 400)
  /* who this client is: their person, client roles, open pause, journeys (episodes) and every change */
  const { data: link } = await db.from('person_source_id').select('person_id').eq('system', 'axiscare').eq('entity_type', 'client').eq('source_id', ax).maybeSingle()
  const personId = link?.person_id ?? null
  const { data: roles } = personId ? await db.from('person_role').select('*').eq('person_id', personId).eq('role', 'client') : { data: [] }
  const { data: pauseRow } = await db.from('client_pause').select('*').eq('axiscare_client_id', ax).eq('status', 'open').maybeSingle()
  const { data: journeys } = await db.from('client_journey').select('*').eq('axiscare_client_id', ax).order('created_at', { ascending: true })
  const { data: changes } = await db.from('client_care_change').select('*').eq('axiscare_client_id', ax).order('made_at', { ascending: true })
  const { data: person } = personId ? await db.from('person_identity').select('display_name').eq('id', personId).maybeSingle() : { data: null }
  const js: Any[] = journeys ?? []
  const current = [...js].reverse().find((j: Any) => j.status !== 'closed') ?? null
  const latest = js.length ? js[js.length - 1] : null
  const name = String(b.client_name || person?.display_name || latest?.client_name || ('AxisCare client #' + ax)).trim()
  const state = careState(roles ?? [], pauseRow, js)
  let payer = (current || latest)?.payer ?? null
  /* Medicaid intake slice B: a Medicaid care plan uploaded in the Hub (app_data medicaid_plans) with our IHS/ADW services
     also makes this a Medicaid client, so existing clients with no journey get the right discharge rules */
  if (payer !== 'medicaid') {
    try {
      const { data: mp } = await db.from('app_data').select('data').eq('key', 'medicaid_plans').maybeSingle()
      const has = (Array.isArray(mp?.data) ? mp.data : []).some((p: Any) => p && p.kind === 'plan' && String(p.axiscare_client_id || '') === ax
        && (p.services || []).some((x: Any) => x && x.ours && ['ihs', 'adw'].includes(String(x.program || ''))))
      if (has) payer = 'medicaid'
    } catch { /* keep the journey's payer */ }
  }
  const ccOf = () => lc(current?.assigned_cc || latest?.assigned_cc || '') || who.email

  if (b.action === 'care_state') {
    return { body: { axiscare_client_id: ax, person_id: personId, client_name: name, state, pause: pauseRow ?? null, payer,
      episodes: js.map((j: Any) => ({ journey_id: j.journey_id, episode_n: j.episode_n ?? 1, status: j.status, closed_reason: j.closed_reason ?? null, created_at: j.created_at, assigned_cc: j.assigned_cc })),
      roles: (roles ?? []).map((r: Any) => ({ status: r.status, started_at: r.started_at ?? null, ended_at: r.ended_at ?? null, ended_date_basis: r.ended_date_basis ?? null, end_reason: r.end_reason ?? null })),
      changes: changes ?? [], can: { pause: can && ['active', 'starting'].includes(state), resume: can && state === 'paused', end: can && ['active', 'starting', 'paused'].includes(state),
        return: isOwner && state === 'past', end_date: can && ['past', 'deceased'].includes(state) }, reasons: { end: END_REASONS, pause: PAUSE_REASONS }, discharge: DISCHARGE_RULE } }
  }
  if (!can) return err('Only a Care Coordinator or an owner can pause or end care.', 403)

  const record = async (row: Any) => {
    const { data, error } = await db.from('client_care_change').insert({ person_id: personId, axiscare_client_id: ax, client_name: name, made_by: who.email, made_by_name: who.name,
      source: b.review_id ? 'axiscare_review' : 'hub', review_id: b.review_id || null, payer, is_test: isTest, ...row }).select('*').single()
    if (error) throw new Error('Could not record the change: ' + error.message)
    return data
  }
  const refreshJourney = async (j: Any | null) => { if (!j) return; const full = await load(db, { journey_id: j.journey_id }); if (full) await refreshCards(db, full.j, R.compute(dfs, full.j, full.steps, ctxFor(pp, st)), pp, st) }
  const items = async () => { const { data } = await db.from('app_data').select('data').eq('key', 'ops_items').maybeSingle(); return Array.isArray(data?.data) ? data.data : [] }
  /* this client's check-in reminders (obligations: ids ops_ci_<check-in record id>_<date>) */
  const checkinIds = async () => {
    const { data } = await db.from('app_data').select('data').eq('key', 'client_checkins').maybeSingle()
    const nm = (n: unknown) => lc(n).replace(/[^a-z]/g, '')
    return new Set((Array.isArray(data?.data) ? data.data : []).filter((c: Any) => c && c.client_name && (String(c.axiscare_client_id ?? '') === ax || (!c.axiscare_client_id && nm(c.client_name) === nm(name)))).map((c: Any) => String(c.id)))
  }
  const isCheckin = (it: Any, ids: Set<string>) => String(it?.id || '').startsWith('ops_ci_') && ids.has(String(it?.source?.id ?? ''))
  const putItem = (item: Any) => db.rpc('upsert_app_data_item', { target_key: 'ops_items', item })
  const restartCardId = (p: Any) => 'ops_pause_' + String(p.pause_id).replace(/-/g, '').slice(0, 12)
  const closeCard = async (id: string, note: string) => { const it = (await items()).find((x: Any) => x?.id === id); if (it && it.status === 'open') await putItem({ ...it, status: 'done', closed_at: now, closed_by: 'client care', close_note: note }) }
  const restartCard = (p: Any) => ({ id: restartCardId(p), kind: 'pause_followup', status: 'open', source_type: 'client_care', axiscare_client_id: ax, about: name,
    title: 'Is care restarting for ' + name + '?', owner: p.owner_email, owner_name: pp.names[p.owner_email] || p.owner_email,
    detail: 'Paused since ' + p.paused_from + ' (' + (PAUSE_REASONS[p.reason] || p.reason) + (p.explanation ? ': ' + p.explanation : '') + '). Check with the family, then Resume care, pause longer, or End care.',
    link: '#p/A' + ax + '/summary', urgency: 'normal', due: new Date(p.followup_date + 'T17:00:00-05:00').toISOString(),
    sub_state: p.followup_date > today() ? 'waiting' : null, waiting_on: p.followup_date > today() ? 'the follow-up date' : null, check_back: p.followup_date > today() ? p.followup_date : null,
    pause_id: p.pause_id, is_test: isTest, created_by: 'client care', opened_by: 'client care', created_at: now })

  try {
    if (b.action === 'care_pause') {
      if (!['active', 'starting'].includes(state)) return err(state === 'paused' ? 'Care is already paused. Pause longer instead.' : 'Only a current client\'s care can be paused.')
      const reason = String(b.reason || ''), explanation = String(b.explanation || '').trim()
      if (!PAUSE_REASONS[reason]) return err('Pick why care is paused.')
      if (reason === 'other' && !explanation) return err('Explain the pause.')
      if (!isYmd(b.effective_date) || !isYmd(b.followup_date)) return err('The pause date and a follow-up date are required.')
      if (b.followup_date < b.effective_date) return err('The follow-up date can\'t be before the pause starts.')
      const ch = await record({ kind: 'pause', reason, explanation: explanation || null, effective_date: b.effective_date, followup_date: b.followup_date,
        notified_by: String(b.notified_by || '').slice(0, 200) || null, journey_id: current?.journey_id ?? null, checklist: checklistFor('pause', reason, payer) })
      const { data: p, error } = await db.from('client_pause').insert({ person_id: personId, axiscare_client_id: ax, client_name: name, journey_id: current?.journey_id ?? null, opened_change: ch.change_id,
        paused_from: b.effective_date, followup_date: b.followup_date, reason, explanation: explanation || null, owner_email: ccOf(), is_test: isTest }).select('*').single()
      if (error) throw new Error('Could not pause: ' + error.message)
      await putItem(restartCard(p))
      /* from an AxisCare status review ("on hold"): the review is answered by this pause */
      if (b.review_id) await db.rpc('client_status_decide', { p_review_id: b.review_id, p_decision: 'on_hold', p_date: null, p_reason: null,
        p_note: 'Paused: ' + PAUSE_REASONS[reason] + (explanation ? ': ' + explanation : '') + ', follow up ' + b.followup_date, p_staff: who.email, p_seat: isOwner ? 'owner_decision' : 'client_intake' })
      /* normal check-in work steps aside while paused (it comes back on Resume) */
      const ci = await checkinIds(); let setAside = 0
      for (const it of await items()) if (it && it.status === 'open' && isCheckin(it, ci)) { await putItem({ ...it, status: 'done', closed_at: now, closed_by: 'care paused', close_note: 'Care is paused; this comes back when care resumes', paused_for: p.pause_id }); setAside++ }
      if (current) { await event(db, current.journey_id, null, actor, 'care_paused', { reason, followup_date: b.followup_date }, explanation || null); await refreshJourney(current) }
      return { body: { outcome: 'paused', change_id: ch.change_id, pause_id: p.pause_id, card: restartCardId(p), checkins_set_aside: setAside } }
    }
    if (b.action === 'care_extend') {
      if (!pauseRow) return err('Care is not paused.')
      if (!isYmd(b.followup_date) || b.followup_date < today()) return err('Pick the new follow-up date (today or later).')
      const ch = await record({ kind: 'extend', reason: pauseRow.reason, explanation: String(b.explanation || '').trim() || null, effective_date: today(), followup_date: b.followup_date,
        notified_by: String(b.notified_by || '').slice(0, 200) || null, journey_id: current?.journey_id ?? null })
      await db.from('client_pause').update({ followup_date: b.followup_date }).eq('pause_id', pauseRow.pause_id)
      const it = (await items()).find((x: Any) => x?.id === restartCardId(pauseRow))
      await putItem({ ...(it || {}), ...restartCard({ ...pauseRow, followup_date: b.followup_date }), created_at: it?.created_at || now, updated_at: now, status: 'open' })
      return { body: { outcome: 'extended', change_id: ch.change_id } }
    }
    if (b.action === 'care_resume') {
      if (!pauseRow) return err('Care is not paused.')
      const eff = isYmd(b.effective_date) ? b.effective_date : today()
      const ch = await record({ kind: 'resume', explanation: String(b.explanation || '').trim() || null, effective_date: eff, notified_by: String(b.notified_by || '').slice(0, 200) || null, journey_id: current?.journey_id ?? null })
      await db.from('client_pause').update({ status: 'closed', closed_change: ch.change_id, closed_kind: 'resumed', closed_at: now }).eq('pause_id', pauseRow.pause_id)
      await closeCard(restartCardId(pauseRow), 'Care resumed ' + eff)
      /* the check-in work set aside at the pause comes back exactly as it was */
      let back = 0
      for (const it of await items()) if (it && it.paused_for === pauseRow.pause_id && it.status === 'done') { const o = { ...it, status: 'open', reopened_at: now }; delete o.closed_at; delete o.closed_by; delete o.close_note; delete o.paused_for; await putItem(o); back++ }
      if (current) { await event(db, current.journey_id, null, actor, 'care_resumed', { on: eff }); await refreshJourney(current) }
      return { body: { outcome: 'resumed', change_id: ch.change_id, checkins_back: back } }
    }
    if (b.action === 'care_end') {
      if (!['active', 'starting', 'paused'].includes(state)) return err(state === 'past' || state === 'deceased' ? 'Care has already ended.' : 'This person is not a current client.')
      const reason = String(b.reason || ''), explanation = String(b.explanation || '').trim()
      if (!END_REASONS[reason]) return err('Pick why care ended.')
      if (reason === 'other' && !explanation) return err('Explain why care ended.')
      if (!isYmd(b.effective_date) || b.effective_date > today()) return err('The effective date (the last day of service, not in the future) is required.')
      const dc = payer === 'medicaid' ? dischargeCheck(reason, b, isOwner, today()) : { ok: true, done: {} as Record<string, string> }
      if (!dc.ok) return err(dc.why || 'Not allowed.')
      const label = END_REASONS[reason], seat = isOwner ? 'owner_decision' : 'client_intake'
      const evid = 'Care ended (' + label + ') on ' + b.effective_date + ', recorded by ' + who.name + (explanation ? ': ' + explanation : '') + (b.notified_by ? ' · told by ' + b.notified_by : '')
      let roleRes: Any = null
      if (b.review_id) {
        const { data, error } = await db.rpc('client_status_decide', { p_review_id: b.review_id, p_decision: 'care_ended', p_date: b.effective_date, p_reason: LEGACY[reason],
          p_note: label + (explanation ? ': ' + explanation : ''), p_staff: who.email, p_seat: seat })
        if (error || !['decided'].includes(data?.outcome)) return err('The AxisCare review could not be answered: ' + (error?.message || JSON.stringify(data)))
        roleRes = data
        if (personId) await db.from('person_role').update({ end_reason: reason === 'deceased' ? 'deceased' : label, updated_at: now }).eq('person_id', personId).eq('role', 'client').eq('status', 'former').eq('ended_at', b.effective_date)
      } else if (personId) {
        const { data, error } = await db.rpc('client_care_end_role', { p_person: personId, p_date: b.effective_date, p_reason: reason === 'deceased' ? 'deceased' : label, p_evidence: evid, p_staff: who.email, p_seat: seat })
        if (error || data?.outcome !== 'ended') return err('Care could not be ended: ' + (error?.message || JSON.stringify(data)))
        roleRes = data
      }
      /* the notice dates entered at End care tick their steps (who, when, how); nothing else is ticked for a person */
      const cl = checklistFor('end', reason, payer).map((x: Any) => dc.done && dc.done[x.key] ? { ...x, state: 'done', on: dc.done[x.key], how: 'Date entered when care was ended', by: who.email, by_name: who.name, at: now } : x)
      if (payer === 'medicaid' && DISCHARGE_RULE[reason] === 'notice21' && isYmd(b.dsds_arranged_on)) cl.forEach((x: Any) => { if (x.key === 'continue_21') Object.assign(x, { state: 'done', on: b.dsds_arranged_on, how: 'DSDS arranged other care', by: who.email, by_name: who.name, at: now }) })
      const ch = await record({ kind: 'end', reason, explanation: explanation || null, effective_date: b.effective_date, notified_by: String(b.notified_by || '').slice(0, 200) || null,
        journey_id: (current || latest)?.journey_id ?? null, checklist: cl })
      if (pauseRow) { await db.from('client_pause').update({ status: 'closed', closed_change: ch.change_id, closed_kind: 'ended', closed_at: now }).eq('pause_id', pauseRow.pause_id); await closeCard(restartCardId(pauseRow), 'Care ended ' + b.effective_date) }
      /* the journey and its First shift launch close with the reason; nothing is deleted */
      const why = 'Care ended (' + (reason === 'deceased' ? 'deceased' : label) + ') on ' + b.effective_date
      for (const j of js.filter((x: Any) => x.status !== 'closed')) {
        await db.from('client_journey').update({ status: 'closed', closed_reason: why, updated_at: now }).eq('journey_id', j.journey_id)
        await event(db, j.journey_id, null, actor, 'closed', { care_ended: true, change_id: ch.change_id }, why)
        if (j.launch_id) { const { data: q } = await db.from('client_queue').select('id, status').eq('id', j.launch_id).maybeSingle()
          if (q && q.status !== 'complete') await db.from('client_queue').update({ status: 'complete', completed_at: now, launch_completed_at: now, exception_reason: why + ': closed by the client journey' }).eq('id', j.launch_id) }
        await refreshJourney(j)
      }
      /* the client's open work closes with a note (it stays in the history) */
      const ids = new Set(js.map((j: Any) => j.journey_id)), ci = await checkinIds(); let closedWork = 0
      for (const it of await items()) {
        if (!it || it.status !== 'open' || String(it.id).startsWith('ops_sym_')) continue
        const mine = String(it.axiscare_client_id ?? it.client_axiscare_id ?? '') === ax || (it.journey_id && ids.has(it.journey_id)) || isCheckin(it, ci)
        if (!mine) continue
        await putItem({ ...it, status: 'done', closed_at: now, closed_by: 'client care', close_note: why }); closedWork++
      }
      /* a death: ONE human sympathy-card task, never sent by the Hub; after it, nothing else */
      let sympathy: string | null = null
      if (reason === 'deceased') {
        const id = 'ops_sym_' + ax
        if (!(await items()).some((x: Any) => x?.id === id)) {
          await putItem({ id, kind: 'sympathy', status: 'open', source_type: 'client_care', axiscare_client_id: ax, about: name, owner: ccOf(), owner_name: pp.names[ccOf()] || ccOf(),
            title: 'Send a sympathy card to ' + name + '\'s family', detail: 'One time. Care ended because ' + name + ' died (' + b.effective_date + '). A person writes and sends it; the Hub sends nothing. Once this is done or dismissed, nothing else ever goes to this family about ' + name + '.',
            urgency: 'normal', due: new Date(R.addDays(today(), 2) + 'T17:00:00-05:00').toISOString(), is_test: isTest, created_by: 'client care', opened_by: 'client care', created_at: now })
          sympathy = id
        }
      }
      return { body: { outcome: 'ended', change_id: ch.change_id, role: roleRes, closed_work: closedWork, sympathy } }
    }
    if (b.action === 'care_end_date') {
      if (!['past', 'deceased'].includes(state)) return err('Only a past client\'s end date can be corrected.')
      if (!isYmd(b.effective_date) || b.effective_date > today()) return err('The end date (the last day of service, not in the future) is required.')
      const how = String(b.explanation || '').trim(); if (!how) return err('Say how you know the date (e.g. AxisCare notes, the family, the discharge letter).')
      const role = (roles ?? []).filter((r: Any) => r.role === 'client' && r.status !== 'active').sort((a: Any, c: Any) => String(c.ended_at || '').localeCompare(String(a.ended_at || '')))[0]
      if (!role) return err('No ended client record was found for this person.')
      if (role.started_at && b.effective_date < String(role.started_at).slice(0, 10)) return err('The end date can\'t be before care started (' + String(role.started_at).slice(0, 10) + ').')
      const was = role.ended_at ? (role.ended_date_basis === 'on_or_before' ? 'on or before ' : '') + String(role.ended_at).slice(0, 10) : 'not recorded'
      const { error } = await db.from('person_role').update({ ended_at: b.effective_date, ended_date_basis: 'exact', updated_at: now }).eq('id', role.id)
      if (error) return err('Could not correct the date: ' + error.message, 500)
      const ch = await record({ kind: 'end_date', explanation: 'Was ' + was + '. How we know: ' + how, effective_date: b.effective_date,
        notified_by: String(b.notified_by || '').slice(0, 200) || null, journey_id: latest?.journey_id ?? null })
      return { body: { outcome: 'corrected', change_id: ch.change_id, was } }
    }
    if (b.action === 'care_return') {
      if (state === 'deceased') return err('This client died. Care can\'t be resumed.')
      if (state !== 'past') return err('Only a past client\'s care can be resumed this way.')
      if (!isOwner) return err('Resuming care for a returning client is an owner\'s decision.', 403)
      const eff = isYmd(b.effective_date) && b.effective_date <= today() ? b.effective_date : today()
      if (b.review_id) {
        const { data, error } = await db.rpc('client_status_decide', { p_review_id: b.review_id, p_decision: 'returning', p_date: eff, p_reason: null,
          p_note: String(b.explanation || '').trim() || 'Returning client confirmed', p_staff: who.email, p_seat: 'owner_decision' })
        if (error || data?.outcome !== 'decided') return err('The AxisCare review could not be answered: ' + (error?.message || JSON.stringify(data)))
      } else if (personId) {
        const { data, error } = await db.rpc('client_care_return_role', { p_person: personId, p_date: eff, p_evidence: 'Returning client confirmed by ' + who.name + (b.explanation ? ': ' + b.explanation : ''), p_staff: who.email, p_seat: 'owner_decision' })
        if (error || data?.outcome !== 'returned') return err('The return could not be recorded: ' + (error?.message || JSON.stringify(data)))
      }
      const o = await openOne(db, dfs, pp, st, actor, { lead: null, leadId: null, axId: ax, payer: latest?.payer ?? null, name, asked: lc(latest?.assigned_cc || ''), how: 'a returning client, confirmed by ' + who.name })
      if (o.outcome !== 'created') return err('Care could not be resumed: ' + (o.error || o.outcome))
      await db.from('client_journey').update({ episode_n: (latest?.episode_n ?? 1) + 1, previous_journey_id: latest?.journey_id ?? null }).eq('journey_id', o.journey_id)
      const ch = await record({ kind: 'return', explanation: String(b.explanation || '').trim() || null, effective_date: eff, journey_id: o.journey_id, notified_by: String(b.notified_by || '').slice(0, 200) || null })
      return { body: { outcome: 'returned', change_id: ch.change_id, journey_id: o.journey_id, episode_n: (latest?.episode_n ?? 1) + 1 } }
    }
  } catch (e) { return err(String((e as Error).message || e), 500, 'error') }
  return err('unknown care action', 400)
}

/** every AxisCare client whose care is paused right now (for the sweep, the cards and the shift jobs) */
export async function pausedAx(db: Any): Promise<Set<string>> {
  const { data } = await db.from('client_pause').select('axiscare_client_id').eq('status', 'open')
  return new Set((data ?? []).map((x: Any) => String(x.axiscare_client_id)))
}
