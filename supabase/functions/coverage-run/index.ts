// =============================================================================
// coverage-run — the unblocked half of chain 1
// =============================================================================
// WHAT ALREADY EXISTS, and is not being rebuilt
//   `call-disposition` recognises a call-off and writes a `coverage_cases`
//   record. The Hub has a complete MANUAL workflow over it: covAsk() records
//   who was asked and how, covAskState() records their answer, and a caregiver
//   saying yes already asks a human before the shift is marked covered.
//
//   `asked[]` is real state with a real shape:
//       { id, name, channel, at, state: waiting|yes|no, replied_at }
//
//   So this does NOT invent a second coverage workflow. It fills the three
//   gaps the manual flow leaves:
//     1. the case has no owner — it routes to a queue, not a person
//     2. nothing prompts anybody, so the case is written and nobody is told
//     3. nothing automates candidate selection or outreach
//
// WHAT THIS WILL NOT DO
//   It will not message a caregiver whose phone is not trusted for autonomous
//   outbound. After the 13 August rollback the roster has no defensible phone
//   numbers at all, so the dry run is expected to refuse every candidate. That
//   is the gate working, not the gate failing.
//
// DRY RUN BY DEFAULT. ?commit=1 writes state. Sending is a THIRD switch that
// does not exist yet on purpose.
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { maySendTo, normalisePhone } from '../_shared/outreach.ts'

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const clean = (v: unknown) => String(v ?? '').trim()
const nowIso = () => new Date().toISOString()

/** How many caregivers a single wave asks. Controlled waves, not a blast: a
 *  broadcast to the whole roster costs goodwill every time it is used and
 *  stops working. */
const WAVE_SIZE = Number(Deno.env.get('COVERAGE_WAVE_SIZE') || '5')

/* The domain that owns coverage. Resolved through the canonical record, the
   same hop Chain 4 uses — never inferred from responsibility counts. */
async function coverageOwner(): Promise<{ owner: string | null; why: string }> {
  const { data: dom } = await sb.from('domains')
    .select('code, label, owner_person, escalation_person')
    .eq('code', 'scheduling_coverage').eq('entity', 'cc_ihs').maybeSingle()
  if (!dom?.owner_person) return { owner: null, why: 'scheduling_coverage has no owner_person' }
  const { data: p } = await sb.from('persons')
    .select('person_id, primary_email').eq('person_id', dom.owner_person).maybeSingle()
  if (!p?.primary_email) return { owner: null, why: 'owner_person has no email' }

  /* DUTY WINDOWS decide who is actively covering today. Accountability stays
     with the domain owner; the duty holder is who the work goes to now. That
     separation is what lets the Staffing Coordinator become accountable owner
     later without rewriting any of this. */
  const { data: dw } = await sb.from('app_data').select('data').eq('key', 'duty_windows').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const windows = (Array.isArray(dw?.data) ? dw!.data : []) as any[]
  const today = new Date().toISOString().slice(0, 10)
  const active = windows.find(w => w?.active !== false && w?.domain === 'scheduling_coverage'
    && (!w.starts_at || String(w.starts_at).slice(0, 10) <= today)
    && (!w.ends_at || String(w.ends_at).slice(0, 10) >= today))
  if (active?.person) {
    return { owner: String(active.person),
             why: `duty window: covering today (accountable owner remains ${p.primary_email})` }
  }
  return { owner: p.primary_email, why: 'scheduling_coverage owner' }
}

/* CANDIDATES.
   Only fields that genuinely exist today. Availability, schedule conflict,
   service area, client requirements, overtime risk and existing relationship
   all need AxisCare and are reported as blocked rather than faked. */
// deno-lint-ignore no-explicit-any
function nameKeyOf(n: string) {
  return n.toLowerCase().replace(/[^a-z ]/g, '').split(/\s+/).filter(Boolean).join(' ')
}

// deno-lint-ignore no-explicit-any
async function candidatesFor(_c: any) {
  /* FOUR ELIGIBILITY STATES, not two.
       ordinary               a field caregiver
       office_not_eligible    holds an office domain, no coverage capability
       office_but_capable     holds an office domain AND an explicit capability
                              row saying they cover shifts
       (backup/field-response is expressed the same way)

     A blanket "holds an office domain" exclusion is too broad and was about to
     remove Cierra and Angiel, who carry explicit capability rows reading
     "Provide direct-care coverage when needed for call-offs". They have said
     they cover shifts. The system should not overrule them.

     This uses the capability model that already exists rather than inventing
     another flag. Identity says who you are; capability says what work you may
     perform; they stay independent. */
  const officeDomain = new Set<string>()
  const coverageCapable = new Set<string>()
  {
    const { data: doms } = await sb.from('domains')
      .select('owner_person, escalation_person').eq('entity', 'cc_ihs')
    const ids = [...new Set((doms ?? []).flatMap(d =>
      [d.owner_person, d.escalation_person].filter(Boolean)))]
    if (ids.length) {
      const { data: ppl } = await sb.from('persons')
        .select('primary_email, full_name').in('person_id', ids)
      for (const p of (ppl ?? [])) {
        if (p.primary_email) officeDomain.add(String(p.primary_email).toLowerCase())
        if (p.full_name) officeDomain.add(nameKeyOf(String(p.full_name)))
      }
    }
    /* Who has explicitly said they cover shifts? */
    const { data: resp } = await sb.from('app_data').select('data')
      .eq('key', 'responsibilities').maybeSingle()
    // deno-lint-ignore no-explicit-any
    for (const r of (Array.isArray(resp?.data) ? resp!.data : []) as any[]) {
      if (r?.active === false) continue
      if (!['capability', 'backup'].includes(String(r?.kind))) continue
      const t = String(r?.text ?? '').toLowerCase()
      if (!/cover|coverage|call-off|call off|open shift|direct-care|direct care/.test(t)) continue
      if (r?.person) coverageCapable.add(String(r.person).toLowerCase())
    }
  }

  const { data } = await sb.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const roster = (Array.isArray(data?.data) ? data!.data : []) as any[]

  const out: Array<Record<string, unknown>> = []
  for (const cg of roster) {
    const name = [clean(cg.first), clean(cg.last)].filter(Boolean).join(' ').trim()
    if (!name) continue
    if (cg.active === false) { out.push({ name, skipped: 'no longer active' }); continue }
    /* THE ROSTER MIXES OFFICE STAFF WITH FIELD CAREGIVERS. The dry run named
       Samantha and Krystal in wave 1 — ringing the CEO and the supervisor to
       cover a shift. Nobody who holds an active office domain is a coverage
       candidate, whatever the roster says. Their own capability rows can put
       them back in deliberately; being on the roster is not consent. */
    const key = String(cg.email || '').toLowerCase()
    const isOffice = officeDomain.has(key) || officeDomain.has(nameKeyOf(name))
    const isCapable = coverageCapable.has(key)
    if (isOffice && !isCapable) {
      out.push({ name, eligibility: 'office_not_eligible',
                 skipped: 'holds an office domain and no coverage capability is recorded' })
      continue
    }
    const eligibility = isOffice ? 'office_but_capable' : 'ordinary'
    const phone = normalisePhone(cg.phone)
    if (!phone) { out.push({ name, skipped: 'no phone on file' }); continue }

    /* THE GATE. A probable identity may be shown to a human; it may never
       authorise an automatic message. */
    const verdict = await maySendTo(sb, phone)
    out.push({
      name,
      eligibility,
      phone_last4: phone.slice(-4),
      confidence: verdict.confidence,
      may_autosend: verdict.allowed,
      skipped: verdict.allowed ? null : verdict.reason,
    })
  }
  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200 })
  const q = new URL(req.url).searchParams
  const commit = q.get('commit') === '1'

  const { data: row } = await sb.from('app_data').select('data').eq('key', 'coverage_cases').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const cases = (Array.isArray(row?.data) ? row!.data : []) as any[]
  const open = cases.filter(c => c?.status === 'open')

  const own = await coverageOwner()
  const { data: itemRow } = await sb.from('app_data').select('data').eq('key', 'ops_items').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const items = (Array.isArray(itemRow?.data) ? itemRow!.data : []) as any[]
  const haveItem = new Set(items.map(i => String(i.id)))

  /* THE GATE MUST BE TESTED EVEN WITH NO OPEN CASE.
     The first version only evaluated candidates inside a case, so with zero
     cases it reported "nobody passed the gate" having asked nobody. A check
     that cannot fail is not a check. This evaluates the whole roster against
     maySendTo() independently, so the safety result is real either way. */
  const rosterCheck = await candidatesFor(null)
  const gate = {
    roster_size: rosterCheck.length,
    would_pass: rosterCheck.filter(x => x.may_autosend).length,
    no_phone: rosterCheck.filter(x => x.skipped === 'no phone on file').length,
    inactive: rosterCheck.filter(x => x.skipped === 'no longer active').length,
    /* Keyed off the structured `eligibility` field, never the message text.
       Three counters previously matched on the skip STRING; when the wording
       changed they all silently stopped matching, and the report said
       "office staff: 0" directly above "holds an office domain: 2". A label
       is for humans; a field is for code. */
    office_not_eligible: rosterCheck.filter(x => x.eligibility === 'office_not_eligible').length,
    office_but_capable: rosterCheck.filter(x => x.eligibility === 'office_but_capable').length,
    /* Untrusted means a phone EXISTS and failed the gate. Lumping the
       office-staff exclusion in here reported "2 phones present but
       untrusted" when those two never reached the phone check at all. */
    /* Untrusted means a phone EXISTS and failed the gate — not that the
       person was excluded before the phone was ever checked. */
    untrusted: rosterCheck.filter(x => x.skipped && x.phone_last4
                                        && x.eligibility !== 'office_not_eligible').length,
    /* Anyone who passes gets named, with where the number came from, because
       a caregiver becoming messageable is the thing to investigate. */
    passed: rosterCheck.filter(x => x.may_autosend)
                       .map(x => ({ name: x.name, confidence: x.confidence,
                                    phone_last4: x.phone_last4 })),
    reasons: Object.entries(rosterCheck.reduce((m: Record<string, number>, x) => {
      const k = String(x.skipped ?? 'eligible'); m[k] = (m[k] ?? 0) + 1; return m
    }, {})).sort((a, b) => b[1] - a[1]),
    /* Who WOULD be wave 1 if trusted numbers existed. Names the prize. */
    /* Only people who would ACTUALLY be asked. The previous version filtered
       out inactive staff and nothing else, so it went on naming Samantha and
       Krystal in wave 1 after the office-staff exclusion was added — the same
       misleading output the exclusion existed to prevent. */
    /* Only people who would ACTUALLY be asked. */
    wave_1: rosterCheck
      .filter(x => x.may_autosend && x.eligibility !== 'office_not_eligible')
      .slice(0, WAVE_SIZE).map(x => ({ name: x.name, eligibility: x.eligibility })),
    /* Every non-ordinary candidate, named, so the split is visible rather
       than inferred from a count. */
    eligibility_breakdown: rosterCheck
      .filter(x => x.eligibility && x.eligibility !== 'ordinary')
      .map(x => ({ name: x.name, eligibility: x.eligibility })),
  }

  const detail: Array<Record<string, unknown>> = []
  const stats = { open_cases: open.length, owner_set: 0, prompts_created: 0,
                  candidates_total: 0, may_autosend: 0, blocked_no_phone: 0,
                  blocked_untrusted: 0, would_ask: 0 }

  for (const c of open) {
    const cands = await candidatesFor(c)
    const sendable = cands.filter(x => x.may_autosend)
    stats.candidates_total += cands.length
    stats.may_autosend += sendable.length
    stats.blocked_no_phone += cands.filter(x => x.skipped === 'no phone on file').length
    stats.blocked_untrusted += cands.filter(x => x.skipped && x.skipped !== 'no phone on file'
                                                 && x.skipped !== 'no longer active').length

    /* Never ask the same person twice in the same case unless a retry is
       deliberate. asked[] is the memory. */
    const alreadyAsked = new Set((c.asked ?? []).map((a: { name: string }) =>
      String(a.name || '').toLowerCase()))
    const wave = sendable.filter(x => !alreadyAsked.has(String(x.name).toLowerCase()))
                         .slice(0, WAVE_SIZE)
    stats.would_ask += wave.length

    const itemId = `ops_cov_${c.id}`
    detail.push({
      case_id: c.id,
      client: c.client ?? '(not identified — AxisCare)',
      reason: c.reason,
      opened: c.opened_at,
      owner_now: c.owner ?? '(none)',
      owner_should_be: own.owner ?? '(none)',
      why_owner: own.why,
      already_asked: (c.asked ?? []).length,
      candidates_considered: cands.length,
      eligible_to_message: sendable.length,
      this_wave: wave.map(w => w.name),
      blocked: cands.filter(x => x.skipped).slice(0, 8),
      prompt: haveItem.has(itemId) ? 'exists' : 'would create',
    })

    if (commit) {
      if (!c.owner && own.owner) { c.owner = own.owner; stats.owner_set++ }
      const item = {
        id: itemId, kind: 'coverage', coverage_case_id: c.id,
        title: `Uncovered shift: ${c.client || 'client not identified'}`,
        about: c.client || '', detail: c.note || '',
        domain: 'scheduling_coverage', owner: own.owner || '',
        status: 'open', urgency: 'high',
        already_asked: (c.asked ?? []).length,
        points_at: 'coverage_case', updated_at: nowIso(),
        created_at: c.opened_at || nowIso(),
      }
      await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item })
      if (!haveItem.has(itemId)) stats.prompts_created++
    }
  }

  if (commit && stats.owner_set) {
    await sb.from('app_data').upsert({ key: 'coverage_cases', data: cases }, { onConflict: 'key' })
  }

  return new Response(JSON.stringify({
    mode: commit ? 'COMMIT (state only — no message was sent)' : 'DRY RUN',
    sending_enabled: false,
    why_no_sending: 'Autonomous caregiver messaging is a separate switch that does ' +
      'not exist yet. It will not be added until a dry run proves identity, ' +
      'dedupe, recipient selection and state tracking.',
    coverage_owner: own,
    wave_size: WAVE_SIZE,
    gate_evaluated_independently: gate,
    stats, detail,
    blocked_by_axiscare: [
      'which client and shift the call-off affects',
      'caregiver availability and schedule conflicts',
      'overtime risk',
      'service area and client requirements',
      'writing the assignment back to the schedule',
      'visit and EVV confirmation',
      'family notification driven by the real schedule change',
    ],
  }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } })
})
