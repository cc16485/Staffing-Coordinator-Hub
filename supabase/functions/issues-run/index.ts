// =============================================================================
// issues-run — the client issue lifecycle
// =============================================================================
// ONE durable issue, MANY actions underneath it. ops_items stays the work layer:
// an item points AT an issue and is never the issue itself.
//
// THE DISTINCTION THIS ENFORCES
//   reported          somebody told us
//   action completed  an employee did a task
//   resolved          the underlying problem is actually addressed
//
//   "Krystal called the caregiver" is an action. A family reporting repeated
//   lateness is resolved when the lateness stops and somebody confirms it.
//
// MODES
//   ?intake=1     record a reported concern, with duplicate candidates
//   ?action=1     record what was done, optionally advancing the state
//   ?sweep=1      chase, escalate, schedule follow-ups (dry run by default)
//   ?scenarios=1  run all ten acceptance scenarios end to end, then clean up
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const clean = (v: unknown) => String(v ?? '').trim()
const nowIso = () => new Date().toISOString()

function endOfDay(daysAhead = 0): string {
  const d = new Date(); d.setDate(d.getDate() + daysAhead)
  d.setHours(23, 59, 59, 999); return d.toISOString()
}
function addDays(days: number): string {
  const d = new Date(); d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

/* The work item that PROMPTS somebody. It points at the issue; it is not the
   issue. Deterministic id, so an issue never accumulates duplicate prompts. */
// deno-lint-ignore no-explicit-any
async function syncPrompt(issue: any, cat: any) {
  const ctxRes = await sb.rpc('issue_context', { p_issue: issue.id })
  const ctx = ctxRes.data ?? {}
  const done = ['resolved', 'closed_no_action'].includes(issue.state)

  const item = {
    id: `ops_issue_${issue.id}`,
    kind: 'client_issue',
    issue_id: issue.id,
    title: `${cat.label}: ${issue.summary}`.slice(0, 120),
    /* Everything the coordinator needs without opening another screen. */
    who_it_concerns: ctx.who_it_concerns,
    reported_by: ctx.reported_by,
    urgency: issue.urgency,
    issue_state: issue.state,
    already_done: ctx.already_done ?? [],
    waiting_on: issue.waiting_on ?? null,
    what_would_resolve_this: cat.resolution_means,
    next_follow_up: issue.follow_up_due ?? null,
    owner: issue.owner ?? '',
    domain: issue.domain ?? cat.default_domain,
    status: done ? 'done' : 'open',
    due: done ? null : endOfDay(cat.target_hours >= 24 ? Math.floor(cat.target_hours / 24) : 0),
    points_at: 'client_issue',
    updated_at: nowIso(),
  }
  await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item })
  return item
}

// deno-lint-ignore no-explicit-any
async function categoryOf(code: string): Promise<any> {
  const { data } = await sb.from('issue_category').select('*').eq('code', code).maybeSingle()
  return data
}


/* ── WHO OWNS THIS? ──────────────────────────────────────────────────────────
   Scenario 9 found every issue landing UNOWNED. A category routes to a domain,
   but a domain is a queue, not a person, and work in a queue nobody holds is
   work nobody does.

   The Hub already resolves this: `responsibilities` carries kind='primary' per
   domain. Reuse it rather than inventing a second mapping — a duplicate owner
   table would drift from the real one the first time somebody changes roles.

   Returns null when no primary exists. An honestly unowned issue is better
   than one assigned to a guess, and the sweep reports it. */
async function ownerForDomain(domain: string): Promise<string | null> {
  const { data } = await sb.from('app_data').select('data')
    .eq('key', 'responsibilities').maybeSingle()
  const rows = Array.isArray(data?.data) ? data!.data : []
  // deno-lint-ignore no-explicit-any
  const primary = (rows as any[]).find(r =>
    r?.active !== false && r?.kind === 'primary' && r?.domain === domain)
  return primary?.owner ? String(primary.owner) : null
}

/* ── INTAKE ───────────────────────────────────────────────────────────────── */
// deno-lint-ignore no-explicit-any
async function intake(body: any) {
  const cat = await categoryOf(clean(body.category))
  if (!cat) return { error: `unknown category "${body.category}"` }

  /* Duplicate HELP, not auto-merge. A second call about the same problem should
     join the existing issue, but keyword similarity is not proof — silently
     merging would bury a second, different problem for the same client. */
  const { data: candidates } = await sb.rpc('issue_candidates', {
    p_client_text: clean(body.client_name) || null,
    p_client_person: body.client_person_id ?? null,
    p_category: cat.code,
  })

  if (!body.confirm_new && candidates?.length) {
    return {
      needs_human_confirmation: true,
      message: 'An open issue may already cover this. Add to it, or confirm a new one.',
      candidates,
    }
  }

  const linkStatus = body.client_person_id ? 'linked'
                   : clean(body.client_name) ? 'free_text' : 'unresolved'

  const { data: issue, error } = await sb.from('client_issue').insert({
    category: cat.code,
    client_person_id: body.client_person_id ?? null,
    client_name_free_text: clean(body.client_name) || null,
    client_link_status: linkStatus,
    reported_by_person_id: body.reported_by_person_id ?? null,
    reported_by_name: clean(body.reported_by_name) || null,
    reported_by_role: clean(body.reported_by_role) || null,
    about_caregiver_id: clean(body.about_caregiver_id) || null,
    state: 'reported',
    urgency: clean(body.urgency) || cat.default_urgency,
    summary: clean(body.summary) || cat.label,
    detail: clean(body.detail) || null,
    domain: cat.default_domain,
    /* Route to the domain's primary owner. Explicit owner wins; otherwise the
       registry decides; otherwise it stays honestly unowned. */
    owner: clean(body.owner) || await ownerForDomain(cat.default_domain),
    source: clean(body.source) || 'manual',
    source_ref: clean(body.source_ref) || null,
  }).select('*').single()
  if (error) return { error: error.message }

  await sb.from('issue_action').insert({
    issue_id: issue.id, action_type: 'reported', state_after: 'reported',
    note: `Reported by ${issue.reported_by_name ?? 'unknown'}` +
          (issue.reported_by_role ? ` (${issue.reported_by_role})` : ''),
    by_whom: clean(body.taken_by) || 'office',
  })

  const item = await syncPrompt(issue, cat)
  return {
    issue_id: issue.id, state: issue.state, urgency: issue.urgency,
    owner: issue.owner ?? 'UNASSIGNED', domain: issue.domain,
    client_link: issue.client_link_status,
    prompt_item: item.id,
    what_would_resolve_this: cat.resolution_means,
    required_info: cat.required_info,
    needs_policy_lookup: cat.requires_policy_lookup,
    notify_beyond_owner: cat.notify_beyond_owner,
    owner_authority_required: cat.owner_authority,
  }
}

/* ── ACTION ───────────────────────────────────────────────────────────────── */
// deno-lint-ignore no-explicit-any
async function recordAction(body: any) {
  const { data: issue } = await sb.from('client_issue')
    .select('*').eq('id', body.issue_id).maybeSingle()
  if (!issue) return { error: 'issue not found' }
  const cat = await categoryOf(issue.category)

  const next = clean(body.state) || issue.state
  // deno-lint-ignore no-explicit-any
  const patch: any = { state: next, updated_at: nowIso() }
  if (body.waiting_on !== undefined) patch.waiting_on = clean(body.waiting_on) || null
  if (body.owner) patch.owner = clean(body.owner)

  /* RESOLUTION IS NOT ACTION COMPLETION.
     If the category requires a follow-up, "resolved" is refused and the issue
     moves to follow_up with a date. The problem is not addressed until somebody
     confirms it stayed addressed. */
  let followUpScheduled: string | null = null
  if (next === 'resolved') {
    if (cat.follow_up_required && !issue.follow_up_done) {
      patch.state = 'follow_up'
      patch.follow_up_due = addDays(cat.follow_up_days ?? 14)
      followUpScheduled = patch.follow_up_due
    } else {
      patch.resolved_at = nowIso()
      patch.resolved_by = clean(body.by_whom) || null
      patch.resolution_note = clean(body.resolution_note) || clean(body.note)
    }
  }
  if (next === 'follow_up_done') {
    patch.state = 'resolved'
    patch.follow_up_done = true
    patch.resolved_at = nowIso()
    patch.resolved_by = clean(body.by_whom) || null
    patch.resolution_note = clean(body.resolution_note) || clean(body.note)
  }

  /* Samantha dependency, recorded as it happens. */
  if (body.reached_samantha) {
    patch.reached_samantha_at = nowIso()
    patch.samantha_reason = cat.owner_authority ? 'owner_work'
                          : (clean(body.samantha_reason) || 'administrative_leakage')
  }

  const { data: updated, error } = await sb.from('client_issue')
    .update(patch).eq('id', issue.id).select('*').single()
  if (error) return { error: error.message }

  await sb.from('issue_action').insert({
    issue_id: issue.id,
    action_type: clean(body.action_type) || 'note',
    note: clean(body.note) || '',
    by_whom: clean(body.by_whom) || null,
    state_after: updated.state,
    ops_item_id: clean(body.ops_item_id) || null,
  })

  const item = await syncPrompt(updated, cat)
  return {
    issue_id: issue.id, state: updated.state,
    follow_up_scheduled: followUpScheduled,
    resolved: updated.state === 'resolved',
    note: followUpScheduled
      ? `Action recorded. NOT resolved — ${cat.label} requires a follow-up check ` +
        `on ${followUpScheduled} confirming it actually worked.`
      : undefined,
    prompt_item: item.id,
  }
}

/* ── SWEEP ────────────────────────────────────────────────────────────────── */
// deno-lint-ignore no-explicit-any
async function sweep(commit: boolean) {
  const { data: open } = await sb.from('client_issue').select('*')
    .not('state', 'in', '("resolved","closed_no_action")')
  const { data: cats } = await sb.from('issue_category').select('*')
  const byCode = new Map((cats ?? []).map(c => [c.code, c]))

  const out = { seen: (open ?? []).length, overdue: 0, unowned: 0,
                follow_ups_due: 0, escalated: 0, actions: [] as string[] }

  for (const i of (open ?? [])) {
    const cat = byCode.get(i.category)
    if (!cat) continue
    const ageH = (Date.now() - Date.parse(i.reported_at)) / 3600000

    if (!i.owner) {
      /* Try to route it now — a domain may have gained a primary since the
         issue was raised. */
      const late = await ownerForDomain(i.domain ?? cat.default_domain)
      if (late && commit) {
        await sb.from('client_issue').update({ owner: late, updated_at: nowIso() }).eq('id', i.id)
        out.actions.push(`${i.id}: routed to ${late} (${cat.label})`)
      } else {
        out.unowned++
        out.actions.push(`${i.id}: UNOWNED — no primary for domain "${i.domain}" (${cat.label})`)
      }
    }

    if (i.state === 'follow_up' && i.follow_up_due && i.follow_up_due <= addDays(0)) {
      out.follow_ups_due++
      out.actions.push(`${i.id}: follow-up due — confirm it actually worked`)
    }

    if (ageH > cat.target_hours) {
      out.overdue++
      /* ATTENTION RISES WITHOUT ACCOUNTABILITY MOVING. The coordinator stays
         owner; Krystal and Samantha simply see it. Ownership transfers only
         by deliberate handoff. */
      const audience = [cat.notify_beyond_owner, ageH > cat.target_hours * 3 ? 'samantha' : null]
        .filter(Boolean).join(',')
      if (audience) {
        out.escalated++
        out.actions.push(`${i.id}: visible to ${audience} — owner UNCHANGED (${i.owner ?? 'none'})`)
      }
      if (commit) await syncPrompt(i, cat)
    }
  }
  return out
}

/* ── ACCEPTANCE SCENARIOS ─────────────────────────────────────────────────── */
async function scenarios() {
  const log: Array<Record<string, unknown>> = []
  const made: string[] = []
  const P = 'ZZ-SCENARIO'   // obviously fake, cleaned up at the end

  const step = async (name: string, fn: () => Promise<unknown>) => {
    try { const r = await fn(); log.push({ scenario: name, result: r }) }
    catch (e) { log.push({ scenario: name, error: e instanceof Error ? e.message : String(e) }) }
  }

  const mk = async (category: string, summary: string, extra: Record<string, unknown> = {}) => {
    const r = await intake({ category, summary, client_name: `${P} Client`,
      reported_by_name: `${P} Reporter`, confirm_new: true, ...extra }) as
      Record<string, unknown>
    if (r.issue_id) made.push(String(r.issue_id))
    return r
  }

  await step('1. family says caregiver was 20 minutes late', async () => {
    const i = await mk('caregiver_late_noshow', 'Caregiver 20 minutes late',
      { reported_by_role: 'family' })
    const a = await recordAction({ issue_id: i.issue_id, action_type: 'coached_caregiver',
      note: 'Krystal spoke to the caregiver', by_whom: 'Krystal', state: 'resolved' })
    return { intake: i, action_marked_resolved: a,
      proves: 'a coaching call did NOT resolve it — a follow-up was scheduled instead' }
  })

  await step('2. family wants a different caregiver', async () =>
    await mk('caregiver_change_request', 'Family requests a different caregiver',
      { reported_by_role: 'family' }))

  await step('3. caregiver reports a concerning client change', async () =>
    await mk('condition_change', 'Client more confused this week',
      { reported_by_role: 'caregiver' }))

  await step('4. caregiver reports difficult family behaviour', async () =>
    await mk('caregiver_concern_about_client', 'Family member hostile to caregiver',
      { reported_by_role: 'caregiver' }))

  await step('5. possible fall or hospitalisation', async () =>
    await mk('fall_injury_hospital', 'Client fell, ambulance called',
      { reported_by_role: 'caregiver' }))

  await step('6. billing or hours question', async () =>
    await mk('billing_hours_question', 'Family questions last invoice hours',
      { reported_by_role: 'family' }))

  await step('7. payer or authorisation question', async () =>
    await mk('payer_authorization', 'Medicaid hours may be running out',
      { reported_by_role: 'family' }))

  await step('8. a second call before resolution', async () => {
    const dupe = await intake({ category: 'caregiver_late_noshow',
      summary: 'Late again on Thursday', client_name: `${P} Client`,
      reported_by_name: `${P} Reporter` })
    return { response: dupe,
      proves: 'intake OFFERED the existing issue instead of silently creating a second one' }
  })

  await step('9. an unresolved issue goes stale', async () => await sweep(false))

  await step('10. a resolved issue needs a follow-up check', async () => {
    const i = await mk('family_complaint', 'Complaint about caregiver attitude',
      { reported_by_role: 'family' })
    const a1 = await recordAction({ issue_id: i.issue_id, action_type: 'called_family',
      note: 'Discussed with family', by_whom: 'Krystal', state: 'resolved' })
    const a2 = await recordAction({ issue_id: i.issue_id, action_type: 'follow_up_check',
      note: 'Family confirms improvement', by_whom: 'Krystal', state: 'follow_up_done' })
    return { first_close_attempt: a1, follow_up_completed: a2,
      proves: 'resolution required TWO steps — the fix, then confirmation it held' }
  })

  /* Clean up, and prove the cleanup. */
  for (const id of made) {
    await sb.from('client_issue').delete().eq('id', id)
    await sb.rpc('upsert_app_data_item', { target_key: 'ops_items',
      item: { id: `ops_issue_${id}`, status: 'done', deleted: true, note: 'scenario fixture' } })
  }
  const { count } = await sb.from('client_issue')
    .select('id', { count: 'exact', head: true }).ilike('client_name_free_text', `${P}%`)

  return { scenarios: log, fixtures_created: made.length,
           fixtures_remaining_after_cleanup: count ?? -1 }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200 })
  const q = new URL(req.url).searchParams
  const body = await req.json().catch(() => ({}))
  const J = (x: unknown, s = 200) => new Response(JSON.stringify(x, null, 2),
    { status: s, headers: { 'Content-Type': 'application/json' } })

  if (q.get('scenarios') === '1') return J(await scenarios())
  if (q.get('intake') === '1')    return J(await intake(body))
  if (q.get('action') === '1')    return J(await recordAction(body))
  if (q.get('sweep') === '1')     return J(await sweep(q.get('commit') === '1'))
  return J({ modes: ['intake', 'action', 'sweep', 'scenarios'] })
})
