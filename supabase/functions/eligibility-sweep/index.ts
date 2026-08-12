// Supabase Edge Function: eligibility-sweep
// ---------------------------------------------------------------------------
// Steps 4, 5 and 6 of Eligible to Work — the half that runs when nobody is
// looking. Same pattern as ops-escalate: reads app_data, writes ops_items
// through upsert_app_data_item so the browser and this can both write safely.
//
// THE ONE RULE SET
// It imports https://cc.mo-care.com/eligibility-rules.js — the exact file the
// hub loads. A file with no import/export statements is still a valid ES
// module, so Deno executes it and reads globalThis.CCElig. There is no second
// formula here to drift from the first. If that import fails this function
// STOPS rather than guessing.
//
// ⚠ DRY RUN BY DEFAULT. It writes nothing and posts nothing unless app_data
// key 'ops_settings' has eligibility_sweep_live === true. Flip it deliberately.
// ---------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b, null, 2), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const RULES_URL = 'https://cc.mo-care.com/eligibility-rules.js'
const AC_VERSION = '2023-10-01'

// Which domain owns which kind of failure. Never a person's name: the domain
// resolves the current owner, so this survives the Staffing Coordinator hire.
const DOMAIN_FOR = (codes: string[]) => {
  if (codes.some(c => ['ojt_overdue','oig_expired','edl_expired','fcsr_expired','annual_training'].includes(c)))
    return 'training_compliance'
  return 'recruiting_orientation'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const SB = Deno.env.get('SUPABASE_URL')!
  const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const site = Deno.env.get('AXISCARE_SITE_NUMBER')
  /* The shared project holds app_data; the AxisCare secret may be set there
     under any of the three names this estate has accumulated. Take whichever
     exists rather than failing on a naming accident. */
  const acTok = Deno.env.get('AXISCARE_VISITS_TOKEN')
             || Deno.env.get('AXISCARE_TOKEN')
             || Deno.env.get('AXISCARE_API_KEY')
  const acSite = site || Deno.env.get('AXISCARE_SITE')
  const supabase = createClient(SB, KEY)

  // ── the shared rules, or nothing ────────────────────────────────────────
  let E: any = null
  try {
    await import(RULES_URL + '?v=' + Math.floor(Date.now() / 3600000))
    E = (globalThis as any).CCElig
  } catch (err) {
    return json({ error: 'Could not load the shared eligibility rules', detail: String(err),
                  note: 'Refusing to evaluate with a second copy of the formula.' }, 502)
  }
  if (!E?.eligibility)
    return json({ error: 'eligibility-rules.js loaded but exported nothing usable' }, 502)

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const key = async (k: string) => {
    const { data } = await supabase.from('app_data').select('data').eq('key', k).maybeSingle()
    return data?.data ?? null
  }
  const settings = (await key('ops_settings')) || {}
  const LIVE = body.live === true || (settings as any).eligibility_sweep_live === true
  const DRY = !LIVE

  const caregivers: any[] = (await key('caregivers')) || []
  const opsItems: any[] = (await key('ops_items')) || []
  const active = caregivers.filter(c => c && c.active !== false && !c.not_hired && c.hire_date)

  // ── upcoming visits, once, for everybody ────────────────────────────────
  const today = new Date().toISOString().slice(0, 10)
  const horizon = new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 10)
  const visitsByCaregiver = new Map<string, any[]>()
  let visitsError: string | null = null
  if (acSite && acTok) {
    try {
      let url: string | null =
        `https://${acSite}.axiscare.com/api/visits?startDate=${today}&endDate=${horizon}`
      for (let page = 0; url && page < 12; page++) {
        const r: Response = await fetch(url, { headers: {
          Authorization: `Bearer ${acTok}`, Accept: 'application/json',
          'X-AxisCare-Api-Version': AC_VERSION } })
        if (!r.ok) { visitsError = `AxisCare responded ${r.status}`; break }
        const j: any = await r.json().catch(() => ({}))
        for (const v of (j?.results?.visits ?? j?.visits ?? [])) {
          if (v?.removed) continue                    // superseded or cancelled
          const cg = v?.caregiver?.id
          if (cg == null) continue
          const k = String(cg)
          if (!visitsByCaregiver.has(k)) visitsByCaregiver.set(k, [])
          visitsByCaregiver.get(k)!.push(v)
        }
        url = j?.results?.nextPageUrl ?? j?.nextPageUrl ?? null
      }
    } catch (err) { visitsError = String(err) }
  } else { visitsError = 'AxisCare not configured on this project (need AXISCARE_SITE_NUMBER and a token)' }

  // ── evaluate ────────────────────────────────────────────────────────────
  const now = new Date().toISOString()
  const counts = { evaluated: 0, eligible: 0, not_eligible: 0, lapsed: 0,
                   ojt_overdue: 0, fcsr_registration_overdue: 0, with_upcoming_visits: 0 }
  const plan = { items_create: [] as any[], items_update: [] as any[], items_close: [] as any[],
                 axiscare_notes: [] as any[], caregivers_written: [] as string[] }
  const byId = (id: string) => opsItems.find(i => i.id === id)

  for (const c of active) {
    counts.evaluated++
    const e = E.eligibility(c)
    counts[e.state as 'eligible' | 'not_eligible' | 'lapsed']++
    if (e.lapses?.some((l: any) => l.code === 'ojt_overdue')) counts.ojt_overdue++
    if (e.tasks?.some((t: any) => t.code === 'fcsr_registration' && t.high)) counts.fcsr_registration_overdue++

    const cgKey = String(c.axiscare_id || '')
    const upcoming = cgKey ? (visitsByCaregiver.get(cgKey) || []) : []
    const ineligible = e.state !== 'eligible'
    if (ineligible && upcoming.length) counts.with_upcoming_visits++

    // history + cached state, only when something actually changed
    const changed = E.eligRecord(c, e)
    if (changed) plan.caregivers_written.push(c.id || `${c.first} ${c.last}`)

    const who = `${c.first || ''} ${c.last || ''}`.trim() || (c.id || 'caregiver')
    const codes = (e.reasons || []).map((r: any) => r.code)

    // ── STEP 4: the eligibility exception ─────────────────────────────────
    const eid = 'elig_' + (c.id || cgKey || who.replace(/\s+/g, '_'))
    const existing = byId(eid)
    if (ineligible) {
      const item = {
        id: eid, kind: 'eligibility', source_id: c.id || null, about: who,
        title: e.label + ' — ' + who,
        detail: e.summary,
        next_action: e.needs_supervisor
          ? 'A supervisor has to decide on the references before this moves on.'
          : 'Clear the outstanding requirement, then eligibility restores itself.',
        status: 'open', domain: DOMAIN_FOR(codes),
        priority: e.restricted ? 'high' : 'normal',
        created_at: existing?.created_at || now, last_activity_at: now,
        due: existing?.due || now.slice(0, 10),
        opened_by: 'eligibility-sweep',
        eligibility: { state: e.state, codes, restricted: !!e.restricted }
      }
      ;(existing ? plan.items_update : plan.items_create).push(item)
    } else if (existing && existing.status === 'open') {
      plan.items_close.push({ ...existing, status: 'done', closed_at: now,
        closed_by: 'eligibility-sweep',
        close_reason: 'Eligibility restored — ' + e.summary, last_activity_at: now })
    }

    // ── STEP 5: on the schedule while not eligible ────────────────────────
    const sid = 'eligsched_' + (c.id || cgKey || who.replace(/\s+/g, '_'))
    const sExisting = byId(sid)
    if (ineligible && upcoming.length) {
      const shifts = upcoming
        .sort((a, b) => String(a.scheduledStartDate).localeCompare(String(b.scheduledStartDate)))
        .map(v => ({ visit_id: v.id,
          when: String(v.scheduledStartDate || v.startDate || '').slice(0, 16).replace('T', ' '),
          client: [v?.client?.firstName, v?.client?.lastName].filter(Boolean).join(' ') ||
                  ('Client #' + (v?.client?.id ?? '?')) }))
      const item = {
        id: sid, kind: 'eligibility_schedule', source_id: c.id || null, about: who,
        title: who + ' is on the schedule but ' + (e.state === 'lapsed' ? 'eligibility has lapsed' : 'is not eligible'),
        detail: e.summary + ' ' + shifts.length + ' upcoming shift' + (shifts.length === 1 ? '' : 's') + ' affected.',
        next_action: 'Remove or replace ' + who + ' on the shifts below. Do not leave the client uncovered.',
        status: 'open', domain: 'scheduling_coverage', priority: 'high',
        created_at: sExisting?.created_at || now, last_activity_at: now,
        due: now.slice(0, 10), opened_by: 'eligibility-sweep',
        affected_shifts: shifts,
        eligibility: { state: e.state, codes }
      }
      ;(sExisting ? plan.items_update : plan.items_create).push(item)
    } else if (sExisting && sExisting.status === 'open') {
      // the shifts are gone, even if the eligibility problem is not
      plan.items_close.push({ ...sExisting, status: 'done', closed_at: now,
        closed_by: 'eligibility-sweep', last_activity_at: now,
        close_reason: upcoming.length ? 'Eligibility restored.' : 'No upcoming shifts remain for this caregiver.' })
    }

    // ── STEP 6: the AxisCare restriction note, once per lapse event ───────
    if (e.restricted && cgKey) {
      const ojt = (e.lapses || []).find((l: any) => l.code === 'ojt_overdue') || {}
      const eventKey = 'ojt_overdue@' + (ojt.due || 'unknown')
      if (c.axiscare_note_for !== eventKey) {
        plan.axiscare_notes.push({ caregiver: who, axiscare_id: cgKey, event: eventKey,
          note: 'DO NOT SCHEDULE — Not eligible to work. Required OJT is overdue. ' +
                'Caregiver may resume client shifts after OJT is completed and eligibility is restored.',
          important: true })
      }
    } else if (!ineligible && c.axiscare_note_for && cgKey) {
      plan.axiscare_notes.push({ caregiver: who, axiscare_id: cgKey, event: 'cleared',
        note: 'Eligibility restored. The earlier DO NOT SCHEDULE restriction is cleared; ' +
              'this caregiver may be scheduled normally again.',
        important: false, clears: true })
    }
  }

  // ── write, or describe ──────────────────────────────────────────────────
  const wrote = { items: 0, caregivers: 0, notes: 0 }
  if (LIVE) {
    for (const it of [...plan.items_create, ...plan.items_update, ...plan.items_close]) {
      const { error } = await supabase.rpc('upsert_app_data_item', { target_key: 'ops_items', item: it })
      if (!error) wrote.items++
    }
    for (const n of plan.axiscare_notes) {
      if (!acSite || !acTok) break
      const r = await fetch(`https://${acSite}.axiscare.com/api/notes/caregiver/${n.axiscare_id}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${acTok}`, Accept: 'application/json',
                   'Content-Type': 'application/json', 'X-AxisCare-Api-Version': AC_VERSION },
        body: JSON.stringify({ note: n.note, dateTime: now, important: !!n.important })
      })
      if (r.ok) {
        wrote.notes++
        const c = active.find(x => String(x.axiscare_id || '') === n.axiscare_id)
        if (c) c.axiscare_note_for = n.clears ? null : n.event
      }
    }
    // caregiver records last, so a failed note does not mark itself sent
    for (const c of active) {
      if (!plan.caregivers_written.includes(c.id || `${c.first} ${c.last}`) &&
          !plan.axiscare_notes.some(n => n.axiscare_id === String(c.axiscare_id || ''))) continue
      const { error } = await supabase.rpc('upsert_app_data_item', { target_key: 'caregivers', item: c })
      if (!error) wrote.caregivers++
    }
  }

  return json({
    mode: DRY ? 'DRY RUN — nothing was written or sent' : 'LIVE',
    axiscare: visitsError ? { ok: false, problem: visitsError } : { ok: true, caregivers_with_visits: visitsByCaregiver.size },
    counts,
    would: {
      items_create: plan.items_create.length,
      items_update: plan.items_update.length,
      items_close: plan.items_close.length,
      axiscare_notes: plan.axiscare_notes.length,
      caregiver_records_written: plan.caregivers_written.length
    },
    wrote: LIVE ? wrote : undefined,
    // enough to inspect without exposing a caregiver file
    sample: {
      items: [...plan.items_create, ...plan.items_update].slice(0, 8)
        .map(i => ({ id: i.id, kind: i.kind, priority: i.priority, domain: i.domain,
                     title: i.title, shifts: i.affected_shifts?.length ?? 0 })),
      notes: plan.axiscare_notes.slice(0, 8).map(n => ({ event: n.event, important: n.important }))
    }
  })
})
