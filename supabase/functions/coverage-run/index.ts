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
import { maySendTo, normalisePhone, contactForOutbound } from '../_shared/outreach.ts'

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const clean = (v: unknown) => String(v ?? '').trim()
const nowIso = () => new Date().toISOString()
/* Used when recording an ask. Its ABSENCE was a production 500: the engine
   sent wave-1's first text, then crashed on the undefined call before
   persisting asked[] — so every tick re-sent the same first text. */
const uid = () => 'ask_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)

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

  /* NURSES ARE NEVER COVERAGE CANDIDATES (Natasha Early got the first live
     callout text, 2026-09-12). The nursing roster is authoritative; a nurse
     appearing on the caregiver roster changes nothing. */
  const nurseNames = new Set<string>()
  {
    const { data: ns } = await sb.from('app_data').select('data').eq('key', 'nurse_staff').maybeSingle()
    // deno-lint-ignore no-explicit-any
    for (const s of (Array.isArray(ns?.data) ? ns!.data : []) as any[])
      if (s?.name) nurseNames.add(nameKeyOf(String(s.name)))
  }

  const { data } = await sb.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const roster = (Array.isArray(data?.data) ? data!.data : []) as any[]

  const out: Array<Record<string, unknown>> = []
  for (const cg of roster) {
    const name = [clean(cg.first), clean(cg.last)].filter(Boolean).join(' ').trim()
    if (!name) continue
    if (cg.active === false) { out.push({ name, skipped: 'no longer active' }); continue }
    if (nurseNames.has(nameKeyOf(name))) {
      out.push({ name, skipped: 'nurse — nursing staff are never coverage candidates' }); continue }
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
      first: clean(cg.first),
      eligibility,
      axiscare_id: clean(cg.axiscare_id) || null,
      phone,                        // full number, for the send stage only —
      phone_last4: phone.slice(-4), // responses expose only the last 4
      confidence: verdict.confidence,
      may_autosend: verdict.allowed,
      skipped: verdict.allowed ? null : verdict.reason,
    })
  }
  return out
}

/* ── WAVE RANKING: worked-with-this-client first, then recently active, then
      everyone else. This is the ordering Samantha described for a call-off
      blast, computed from AxisCare's own visit history now that API access is
      back. (When this engine was first written AxisCare was blocked and waves
      were unranked roster order.)

        tier 1  has visits with THIS client (most recent/most visits first)
        tier 2  worked any shift in the last 14 days (a live field caregiver)
        tier 3  everyone else who passes the gate

      All of it read-only. If the client cannot be resolved to one AxisCare
      id, or AxisCare cannot be reached, the run says so and falls back to
      unranked — degraded and honest beats clever and silent. ─────────────── */

const AC_VERSION = Deno.env.get('AXISCARE_API_VERSION') || '2023-10-01'
function axisCreds() {
  const order = ['AXISCARE_VISITS_TOKEN', 'AXISCARE_API_KEY', 'AXISCARE_TOKEN']
  let token = '', tokenName = ''
  for (const n of order) { const v = Deno.env.get(n); if (v) { token = v; tokenName = n; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  return { token, tokenName, site: /^\d+$/.test(site) ? site : '' }
}

/** Paginated visit fetch; returns rows or an error string, never throws. */
async function fetchVisits(params: string): Promise<{ rows: any[]; error: string | null }> {
  const { token, site } = axisCreds()
  if (!token || !site) return { rows: [], error: 'AxisCare credentials not set on this project' }
  const rows: any[] = []
  try {
    let url: string | null = `https://${site}.axiscare.com/api/visits?${params}`
    for (let page = 0; url && page < 12; page++) {
      const r: Response = await fetch(url, { headers: {
        Authorization: `Bearer ${token}`, Accept: 'application/json',
        'X-AxisCare-Api-Version': AC_VERSION } })
      if (!r.ok) return { rows, error: `AxisCare responded ${r.status}` }
      const j: any = await r.json().catch(() => ({}))
      for (const v of (j?.results?.visits ?? j?.visits ?? [])) {
        if (v?.removed) continue
        rows.push(v)
      }
      url = j?.results?.nextPage ?? j?.nextPage ?? j?.results?.nextPageUrl ?? j?.nextPageUrl ?? null
    }
    return { rows, error: null }
  } catch (err) { return { rows, error: String(err) } }
}

const dISO = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10)

/* Samantha's care-level ladder, read from AxisCare classes[] on BOTH sides:
   Level 1 wellness, Level 2 personal care, Level 3 complex care. A caregiver
   covers clients at or below their own level. classes[] famously mixes payers
   in (the audited defect), so this matches known level wording only and
   reports WHICH class it read — never assumes the array means one thing. */
// deno-lint-ignore no-explicit-any
function careLevelOf(classes: any): { level: number | null; from: string | null } {
  /* A caregiver can hold SEVERAL level classes ("Level 1 - Wellness Care"
     AND "Level 2 - Personal Care" = can do both — Lacey Williams, caught by
     Samantha on the first live run when first-match-wins misread her as
     Level 1 and skipped her). The level is the HIGHEST class held. */
  const arr = Array.isArray(classes) ? classes
    : (classes && typeof classes === 'object') ? Object.values(classes) : []
  let best: { level: number | null; from: string | null } = { level: null, from: null }
  for (const c of arr) {
    const label = String((c as any)?.label ?? (c as any)?.code ?? '')
    const t = label.toLowerCase()
    const m = t.match(/level\s*([123])/)
    const lv = m ? Number(m[1])
      : /complex/.test(t) ? 3
      : /personal\s*care/.test(t) ? 2
      : /wellness/.test(t) ? 1
      : null
    if (lv != null && (best.level == null || lv > best.level)) best = { level: lv, from: label }
  }
  return best
}

/** The case's client is free text off a phone call. Resolve it to ONE
 *  confirmed AxisCare client id through the identity layer, or say why not. */
async function resolveClientAxisId(clientText: string):
  Promise<{ status: string; id: string | null; detail: string }> {
  const name = clean(clientText)
  if (!name || /not identified|from call|confirm the client|unknown/i.test(name))
    return { status: 'placeholder', id: null,
             detail: 'the case does not name a real client yet — confirm the client on the case first' }
  const { data: people } = await sb.from('person_identity')
    .select('id, display_name').ilike('display_name', name)
  const ids = [...new Set((people ?? []).map((p: any) => String(p.id)))]
  if (ids.length === 0) return { status: 'not_found', id: null,
    detail: `no person named "${name}" in the identity layer` }
  if (ids.length > 1) return { status: 'ambiguous', id: null,
    detail: `${ids.length} people named "${name}" — a human must pick` }
  const { data: src } = await sb.from('person_source_id')
    .select('source_id').eq('person_id', ids[0]).eq('system', 'axiscare')
    .eq('entity_type', 'client').eq('confidence', 'confirmed').eq('needs_review', false)
    .maybeSingle()
  if (!src?.source_id) return { status: 'no_axiscare_id', id: null,
    detail: `"${name}" is known but holds no confirmed AxisCare client id` }
  return { status: 'resolved', id: String(src.source_id), detail: `AxisCare client ${src.source_id}` }
}

/* ── CONCURRENCY GUARDS (review findings 1-3, 2026-09-12 night review) ──────
   The engine can be invoked by cron AND by hand at once, and a run spends
   many seconds on AxisCare/GHL I/O. Guards:
     - a soft lock key so overlapping runs exit instead of double-texting
     - every case write re-reads the CURRENT row and merges, so a caregiver's
       YES landing mid-run (via coverage-reply) is never clobbered by our
       stale snapshot. upsert_app_data_item replaces the whole item; the only
       safe write is fresh-read → merge → write. */
async function readCaseFresh(caseId: string): Promise<any | null> {
  const { data } = await sb.from('app_data').select('data').eq('key', 'coverage_cases').maybeSingle()
  const arr: any[] = Array.isArray(data?.data) ? data!.data : []
  return arr.find(x => x?.id === caseId) ?? null
}
async function appendAskFresh(caseId: string, entry: any): Promise<any | null> {
  const fresh = await readCaseFresh(caseId)
  if (!fresh) return null
  fresh.asked = Array.isArray(fresh.asked) ? fresh.asked : []
  if (!fresh.asked.some((a: any) => a.id === entry.id)) fresh.asked.push(entry)
  fresh.callout_started_at = fresh.callout_started_at || nowIso()
  await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: fresh })
  return fresh
}
async function acquireRunLock(): Promise<boolean> {
  try {
    const { data } = await sb.from('app_data').select('data, updated_at').eq('key', 'coverage_run_lock').maybeSingle()
    const at = data?.data?.at ? new Date(String(data.data.at)).getTime() : 0
    if (at && Date.now() - at < 4 * 60000) return false
    await sb.from('app_data').upsert({ key: 'coverage_run_lock',
      data: { at: nowIso() }, updated_at: nowIso() }, { onConflict: 'key' })
    return true
  } catch { return true }   // a broken lock store must not stop callouts
}
async function releaseRunLock() {
  try { await sb.from('app_data').upsert({ key: 'coverage_run_lock',
    data: { at: null }, updated_at: nowIso() }, { onConflict: 'key' }) } catch { /* noop */ }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200 })
  const q = new URL(req.url).searchParams
  const commit = q.get('commit') === '1'

  const { data: row } = await sb.from('app_data').select('data').eq('key', 'coverage_cases').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const cases = (Array.isArray(row?.data) ? row!.data : []) as any[]
  const open = cases.filter(c => c?.status === 'open')

  if (open.length && !(await acquireRunLock())) {
    return new Response(JSON.stringify({
      mode: 'SKIPPED', reason: 'another coverage-run is in progress (soft lock under 4 minutes old)' },
      null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  /* The callout switch. Everything else in this function stays read-only
     reporting regardless; only this flag lets a text leave the building. */
  const { data: setRow } = await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const settings: any = setRow?.data ?? {}
  const sendLive = settings.coverage_send_live === true
  const fuseMin = Number(settings.coverage_wave_fuse_min) > 0 ? Number(settings.coverage_wave_fuse_min) : 10
  const ghl = { token: Deno.env.get('GHL_TOKEN') ?? '', locationId: Deno.env.get('GHL_LOCATION_ID') ?? '' }

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
  // deno-lint-ignore no-explicit-any
  const stats: any = { open_cases: open.length, owner_set: 0, prompts_created: 0,
                  candidates_total: 0, may_autosend: 0, blocked_no_phone: 0,
                  blocked_untrusted: 0, would_ask: 0, sent: 0, held_quiet_hours: 0,
                  closure_notified: 0, escalated: 0, admin_alerts: 0 }

  /* Recently-active caregivers (tier 2), fetched ONCE for the whole run. */
  const recent = open.length ? await fetchVisits(`startDate=${dISO(14)}&endDate=${dISO(0)}`)
                             : { rows: [], error: null }
  const recentlyActive = new Set(recent.rows.map(v => String(v?.caregiver?.id ?? '')).filter(Boolean))

  /* AxisCare's ACTIVE caregiver census, once per run. The hub roster's own
     active flag drifts (Samantha caught inactive caregivers in the picker),
     and a coverage text to somebody who no longer works here is worse than
     noise. Filtered on the per-row status.active boolean. If the census
     cannot be read the waves fall back to roster-only filtering — degraded
     and reported, never silently blocked. */
  const axisActive = new Set<string>()
  const caregiverLevel = new Map<string, number>()   // axiscare id → care level 1-3
  const nurseAxis = new Set<string>()                // nurse-classed in AxisCare
  let censusError: string | null = null
  if (open.length) {
    const { token, site } = axisCreds()
    if (!token || !site) censusError = 'AxisCare credentials not set'
    else try {
      let url: string | null = `https://${site}.axiscare.com/api/caregivers`
      for (let page = 0; url && page < 12; page++) {
        const r: Response = await fetch(url, { headers: {
          Authorization: `Bearer ${token}`, Accept: 'application/json',
          'X-AxisCare-Api-Version': AC_VERSION } })
        if (!r.ok) { censusError = `AxisCare responded ${r.status}`; break }
        const j: any = await r.json().catch(() => ({}))
        /* Lists can come back keyed by id instead of as arrays — normalise
           (the caregivers census threw "not iterable" in production). */
        const gRows: any[] = Array.isArray(j?.results?.caregivers ?? j?.caregivers)
          ? (j?.results?.caregivers ?? j?.caregivers)
          : Object.values(j?.results?.caregivers ?? j?.caregivers ?? {})
        for (const g of gRows)
          if (g?.status?.active === true && g?.id != null) {
            axisActive.add(String(g.id))
            const lv = careLevelOf(g?.classes)
            if (lv.level != null) caregiverLevel.set(String(g.id), lv.level)
            /* Second lock on the nurse exclusion: class wording. */
            const clsArr = Array.isArray(g?.classes) ? g.classes
              : (g?.classes && typeof g.classes === 'object') ? Object.values(g.classes) : []
            if (clsArr.some((k: any) => /nurse|\bRN\b|\bLPN\b/i.test(String(k?.label ?? k?.code ?? ''))))
              nurseAxis.add(String(g.id))
          }
        url = j?.results?.nextPage ?? j?.nextPage ?? j?.results?.nextPageUrl ?? j?.nextPageUrl ?? null
      }
    } catch (err) { censusError = String(err) }
  }
  const censusUsable = !censusError && axisActive.size > 0

  /* SUPPLY SIGNAL: what each caregiver says they want (self-maintained via
     the availability page) versus what they are scheduled for in the next 7
     days. Within a tier, hungrier caregivers are asked first — the person
     wanting 15 more hours hears about the shift before the person already
     at target. Missing data means no boost, never a penalty. */
  const wantGap = new Map<string, number>()   // axiscare id → wanted-minus-scheduled
  if (open.length) {
    try {
      const { data: avRow } = await sb.from('app_data').select('data').eq('key', 'caregiver_availability').maybeSingle()
      const av: any[] = Array.isArray(avRow?.data) ? avRow!.data : []
      if (av.length) {
        const fwd = await fetchVisits(`startDate=${dISO(0)}&endDate=${dISO(-7)}`)
        const sched = new Map<string, number>()
        for (const v of fwd.rows) {
          const id = v?.caregiver?.id; if (id == null) continue
          const s = new Date(String(v?.scheduledStartDate ?? v?.startDate ?? '')).getTime()
          const e = new Date(String(v?.scheduledEndDate ?? v?.endDate ?? '')).getTime()
          if (Number.isFinite(s) && Number.isFinite(e) && e > s)
            sched.set(String(id), (sched.get(String(id)) ?? 0) + (e - s) / 3600000)
        }
        for (const a of av) {
          const id = String(a?.axiscare_id ?? ''); if (!id) continue
          const target = Number(a?.target_hours)
          if (Number.isFinite(target)) wantGap.set(id, target - (sched.get(id) ?? 0))
        }
      }
    } catch { /* no boost is a fine fallback */ }
  }

  for (const c of open) {
    const cands = await candidatesFor(c)

    /* ── ADMIN ALERT ON DETECTION (her ask: are all admin alerted by text
       and email when a call-in is detected? They are now.) Every NEW case,
       from any entry point, pushes to every admin: SMS (held 21:00-08:00
       unless the shift starts within 3 hours) and email (always — email is
       silent). Once per case. Admin list: ops_settings.coverage_alert_admins
       (array of emails), default Samantha + Krystal. */
    if (!c.admin_alerted && ghl.token && ghl.locationId) {
      const admins: string[] = (Array.isArray(settings.coverage_alert_admins)
        && settings.coverage_alert_admins.length)
        ? settings.coverage_alert_admins.map((e: unknown) => String(e).toLowerCase())
        : ['samantha@mo-care.com', 'krystal@mo-care.com']
      const whenTxt = [c.shift_date, c.shift_time].filter(Boolean).join(' ') || 'time on the case'
      const chiHrA = Number(new Date().toLocaleString('en-US',
        { timeZone: 'America/Chicago', hour: '2-digit', hour12: false }))
      let soonA = false
      if (c.shift_date && /^\d\d:\d\d/.test(String(c.shift_time || ''))) {
        const chiNowA = new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).replace(' ', 'T')
        const dMs = new Date(`${c.shift_date}T${String(c.shift_time).slice(0, 5)}:00`).getTime() - new Date(chiNowA).getTime()
        soonA = dMs > 0 && dMs < 3 * 3600000
      }
      const smsOk = soonA || (chiHrA >= 8 && chiHrA < 21)
      const calledAt = new Date(String(c.opened_at || Date.now()))
        .toLocaleString('en-US', { timeZone: 'America/Chicago',
          month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      const smsMsg = (String(settings.coverage_msg_admin_alert || '') ||
        `New call-in: {client} {when}.{who} Called in at {called_at}. The callout engine is texting caregivers. Board: cc.mo-care.com`)
        .replaceAll('{client}', String(c.client || 'client on the case'))
        .replaceAll('{when}', whenTxt)
        .replaceAll('{who}', c.calling_off ? ` ${c.calling_off} called off.` : '')
        .replaceAll('{called_at}', calledAt)
        .replace(/\s{2,}/g, ' ').trim()
      const { data: stRowA } = await sb.from('app_data').select('data').eq('key', 'coordinator_staff').maybeSingle()
      const staffA: any[] = Array.isArray(stRowA?.data) ? stRowA!.data : []
      let alerted = 0
      for (const adm of admins) {
        const person = staffA.find((s: any) => String(s.email || '').toLowerCase() === adm)
        // Email always (silent), through the same GHL pipe as the 7am digest.
        try {
          const up = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
            method: 'POST',
            headers: { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
            body: JSON.stringify({ locationId: ghl.locationId, email: adm, firstName: person?.name || 'CC', lastName: 'Admin' }),
          })
          const uj: any = await up.json().catch(() => ({}))
          const cid = uj?.contact?.id ?? uj?.id
          if (cid) {
            await fetch('https://services.leadconnectorhq.com/conversations/messages', {
              method: 'POST',
              headers: { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
              body: JSON.stringify({ type: 'Email', contactId: cid,
                subject: `Call-in: ${c.client || 'coverage case'} ${whenTxt}`,
                html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#1f2a36;">`
                  + `<p><b>New call-in detected.</b></p>`
                  + `<p>Client: <b>${String(c.client || '?')}</b><br>Shift: <b>${whenTxt}</b>`
                  + (c.calling_off ? `<br>Called off: <b>${String(c.calling_off)}</b>` : '<br>Called off: (unknown — opened from an AxisCare unassignment, which does not say who)')
                  + `<br>Called in at: <b>${calledAt}</b> (Chicago)`
                  + (c.modification_reason ? `<br>Reason: ${String(c.modification_reason)}` : '')
                  + `</p><p>The callout engine is texting qualified caregivers in waves. `
                  + `Watch replies and confirm the fill on the board: <a href="https://cc.mo-care.com">cc.mo-care.com</a> (Scheduling, Coverage Help).</p></div>` }),
            })
            alerted++
            // SMS too, when the hour allows and we have a number.
            if (smsOk) {
              const ph = normalisePhone(person?.phone)
              if (ph) {
                const contact = await contactForOutbound(sb, ghl,
                  { phone: ph, email: adm, firstName: person?.name || adm.split('@')[0] },
                  'urgent_internal', { selfSupplied: true })
                if (contact) await fetch('https://services.leadconnectorhq.com/conversations/messages', {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
                  body: JSON.stringify({ type: 'SMS', contactId: contact.contactId, message: smsMsg }),
                })
              }
            }
          }
        } catch { /* an unreachable admin must not block the callout */ }
      }
      const freshA = await readCaseFresh(c.id)
      if (freshA) {
        freshA.admin_alerted = nowIso()
        await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: freshA })
        c.admin_alerted = freshA.admin_alerted
      }
      stats.admin_alerts = (Number(stats.admin_alerts) || 0) + alerted

      /* AUTO ATTENDANCE (her ask): the call-in lands on the Performance →
         Attendance record automatically, same shape the manual "Log it"
         button writes — reported_at + notice_hours feed the existing
         write-up triggers (short notice, too many in the window). Only when
         we KNOW who called off; deterministic id = once per case. */
      if (c.calling_off) {
        let noticeHours: number | null = null
        if (c.shift_date && /^\d\d:\d\d/.test(String(c.shift_time || '')) && c.opened_at) {
          const chiOpened = new Date(String(c.opened_at))
          const startNaive = new Date(`${c.shift_date}T${String(c.shift_time).slice(0, 5)}:00-05:00`)
          const h = (startNaive.getTime() - chiOpened.getTime()) / 3600000
          if (Number.isFinite(h)) noticeHours = Math.round(h * 10) / 10
        }
        await sb.rpc('upsert_app_data_item', { target_key: 'attendance_events', item: {
          id: 'att_cov_' + c.id, caregiver: String(c.calling_off), type: 'callin',
          shift_date: c.shift_date || nowIso().slice(0, 10), shift_time: String(c.shift_time || ''),
          note: `Auto-logged from the coverage case for ${c.client || 'a client'}.`,
          logged_by: 'coverage-engine', created_at: nowIso(), action_id: null,
          reported_at: c.opened_at || nowIso(), notice_hours: noticeHours,
        } })
      }
    }

    /* Tier 1: visit history with THIS client, if the client resolves. A case
       opened by coverage-watch carries the client's AxisCare id straight off
       the visit — exact, no name matching needed. Phone-opened cases still
       resolve their free-text name through the identity layer. */
    const clientRes = c.client_axiscare_id
      ? { status: 'resolved', id: String(c.client_axiscare_id),
          detail: `AxisCare client ${c.client_axiscare_id} (from the AxisCare visit)` }
      : await resolveClientAxisId(String(c.client ?? ''))
    /* The client's city (for anonymous wording) and CARE LEVEL (for the
       qualification filter) — one cached fetch, done here because the level
       must be known BEFORE the wave is built. */
    if ((!c.client_city || c.client_care_level === undefined) && clientRes.id) {
      try {
        const { token: acTok, site: acSite } = axisCreds()
        if (acTok && acSite) {
          const r = await fetch(`https://${acSite}.axiscare.com/api/clients/${encodeURIComponent(String(clientRes.id))}`, {
            headers: { Authorization: `Bearer ${acTok}`, Accept: 'application/json',
                       'X-AxisCare-Api-Version': AC_VERSION } })
          const j: any = await r.json().catch(() => ({}))
          const cl = j?.results?.client ?? j?.results ?? {}
          c.client_city = c.client_city || (String(cl?.residentialAddress?.city ?? '') || null)
          c.client_street = String(cl?.residentialAddress?.streetAddress1 ?? '') || null
          const lv = careLevelOf(cl?.classes)
          c.client_care_level = lv.level          // null = no level class on the client
          c.client_care_level_from = lv.from
        }
      } catch { /* no city/level = plainer wording, no level filter */ }
    }
    /* WHO'S ALREADY WORKING during this shift: texting a caregiver who is on
       another visit at that exact time wastes the wave's best minutes. One
       same-day visits fetch; overlap on the naive HH:MM window. Overnight
       windows (end before start) skip the check rather than guess. */
    const busyThen = new Set<string>()
    let busyCheck = 'no shift date/time on the case — busy check off'
    if (c.shift_date && /^\d\d:\d\d-\d\d:\d\d$/.test(String(c.shift_time || ''))) {
      const [shStart, shEnd] = String(c.shift_time).split('-')
      if (shEnd <= shStart) busyCheck = 'overnight window — busy check off (cannot compare across midnight safely)'
      else {
        const day = await fetchVisits(`startDate=${c.shift_date}&endDate=${c.shift_date}`)
        if (day.error) busyCheck = `could not read the day's schedule (${day.error}) — busy check off`
        else {
          for (const v of day.rows) {
            const cg = v?.caregiver?.id
            if (cg == null) continue
            const vs = String(v?.scheduledStartDate ?? v?.startDate ?? '').slice(11, 16)
            const ve = String(v?.scheduledEndDate ?? v?.endDate ?? '').slice(11, 16)
            if (!vs || !ve || ve <= vs) continue
            if (vs < shEnd && ve > shStart) busyThen.add(String(cg))
          }
          busyCheck = `${busyThen.size} caregiver(s) already on a visit during this window`
        }
      }
    }
    const history = new Map<string, { visits: number; last: string }>()
    let historyError: string | null = null
    if (clientRes.id) {
      const h = await fetchVisits(
        `startDate=${dISO(180)}&endDate=${dISO(0)}&clientIds=${encodeURIComponent(clientRes.id)}`)
      historyError = h.error
      for (const v of h.rows) {
        const cg = v?.caregiver?.id
        if (cg == null) continue
        const k = String(cg)
        const day = String(v?.date ?? v?.startDate ?? v?.start ?? '')
        const cur = history.get(k) ?? { visits: 0, last: '' }
        history.set(k, { visits: cur.visits + 1, last: day > cur.last ? day : cur.last })
      }
    }
    const tierOf = (x: any): { tier: number; why: string } => {
      const id = x.axiscare_id ? String(x.axiscare_id) : ''
      const h = id ? history.get(id) : undefined
      if (h) return { tier: 1, why: `${h.visits} visit${h.visits === 1 ? '' : 's'} with this client, last ${h.last || 'date unknown'}` }
      if (id && recentlyActive.has(id)) return { tier: 2, why: 'worked a shift in the last 14 days' }
      return { tier: 3, why: x.axiscare_id ? 'no recent or client history found' : 'no AxisCare id on the roster record' }
    }
    for (const x of cands) {
      if (!x.may_autosend) continue
      const t = tierOf(x); x.tier = t.tier; x.tier_why = t.why
    }
    const sendable = cands.filter(x => x.may_autosend).sort((a: any, b: any) =>
      (a.tier - b.tier) ||
      ((history.get(String(b.axiscare_id ?? ''))?.visits ?? 0) -
       (history.get(String(a.axiscare_id ?? ''))?.visits ?? 0)) ||
      ((wantGap.get(String(b.axiscare_id ?? '')) ?? -999) -
       (wantGap.get(String(a.axiscare_id ?? '')) ?? -999)))
    stats.candidates_total += cands.length
    stats.may_autosend += sendable.length
    stats.blocked_no_phone += cands.filter(x => x.skipped === 'no phone on file').length
    stats.blocked_untrusted += cands.filter(x => x.skipped && x.skipped !== 'no phone on file'
                                                 && x.skipped !== 'no longer active').length

    /* Never ask the same person twice in the same case unless a retry is
       deliberate. asked[] is the memory. */
    const alreadyAsked = new Set((c.asked ?? []).map((a: { name: string }) =>
      String(a.name || '').toLowerCase()))
    /* Never ask the person who called off to cover their own shift — they
       are usually tier 1 for exactly the wrong reason. And only caregivers
       AxisCare says are ACTIVE get asked at all (when the census is up). */
    const callerOff = String(c.calling_off || '').toLowerCase()
    const callerOffId = String(c.calling_off_id || '')
    let inactiveSkipped = 0
    let underLevelSkipped = 0
    let busySkipped = 0
    let nurseSkipped = 0
    /* THE CARE-LEVEL LADDER (her rule): Level 1 wellness, 2 personal care,
       3 complex. A caregiver covers clients at or below their own level. A
       caregiver with NO level class is allowed through (a human still
       confirms every fill) but a KNOWN lower level is a hard skip. */
    const clientLv: number | null = typeof c.client_care_level === 'number' ? c.client_care_level : null
    const wave = sendable.filter(x => !alreadyAsked.has(String(x.name).toLowerCase()))
                         .filter(x => !(callerOff && String(x.name).toLowerCase() === callerOff)
                                   && !(callerOffId && String(x.axiscare_id || '') === callerOffId))
                         .filter((x: any) => {
                           if (!censusUsable) return true
                           const okAx = x.axiscare_id && axisActive.has(String(x.axiscare_id))
                           if (!okAx) inactiveSkipped++
                           return okAx
                         })
                         .filter((x: any) => {
                           if (clientLv == null || !x.axiscare_id) return true
                           const cgLv = caregiverLevel.get(String(x.axiscare_id))
                           if (cgLv != null && cgLv < clientLv) { underLevelSkipped++; return false }
                           return true
                         })
                         .filter((x: any) => {
                           if (!x.axiscare_id || !busyThen.has(String(x.axiscare_id))) return true
                           busySkipped++; return false
                         })
                         .filter((x: any) => {
                           if (!x.axiscare_id || !nurseAxis.has(String(x.axiscare_id))) return true
                           nurseSkipped++; return false
                         })
                         .slice(0, WAVE_SIZE)
    stats.would_ask += wave.length

    /* ── SEND STAGE — the callout engine (replacing CareQB Callouts).
       One wave per run per case. The first wave goes as soon as the case is
       seen; the next only after the fuse has burned with no YES. Every ask
       lands in asked[] — the same record the manual workflow and the hub
       read — as {name, phone, channel:'sms', at, state:'waiting', tier, auto}.
       A YES anywhere on the case stops all further waves. */
    let sentThisRun = 0
    const askedArr: any[] = Array.isArray(c.asked) ? c.asked : (c.asked = [])
    /* Waves stop only while an ACCEPTED offer is pending. A yes-state entry
       whose pending_fill was cleared (they changed their mind) must not
       freeze the callout — review finding: yes-then-no deadlock. */
    const hasYes = !!c.pending_fill
    const newestAsk = askedArr.map((a: any) => new Date(String(a.at || 0)).getTime())
      .filter((t: number) => Number.isFinite(t))
      .sort((a: number, b: number) => b - a)[0] ?? 0
    const fuseBurned = !newestAsk || (Date.now() - newestAsk) > fuseMin * 60000
    /* QUIET HOURS (idea adopted from CareQB): the case opens and is
       acknowledged at any hour, but fill-in texts hold overnight — unless the
       shift itself starts within 3 hours, when waking people IS the job.
       Defaults 21:00-06:00 Chicago; ops_settings.coverage_quiet_from/until. */
    const chiHour = Number(new Date().toLocaleString('en-US',
      { timeZone: 'America/Chicago', hour: '2-digit', hour12: false }))
    const qFrom = Number.isFinite(Number(settings.coverage_quiet_from)) ? Number(settings.coverage_quiet_from) : 21
    /* Her rule (final form, 2026-09-12): quiet is 9pm to 8am for EVERYONE.
       The only texts allowed before 8am are for a shift starting within 3
       hours — the shiftSoon override below. No 6am texts for later shifts,
       same-day or not. */
    const qUntil = Number.isFinite(Number(settings.coverage_quiet_until)) ? Number(settings.coverage_quiet_until) : 8
    const inQuiet = qFrom > qUntil ? (chiHour >= qFrom || chiHour < qUntil) : (chiHour >= qFrom && chiHour < qUntil)
    let shiftSoon = false
    if (c.shift_date) {
      const startHH = String(c.shift_time || '').split('-')[0] || ''
      const chiNow = new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).replace(' ', 'T')
      const startNaive = `${c.shift_date}T${/^\d\d:\d\d$/.test(startHH) ? startHH : '23:59'}:00`
      const diffMs = new Date(startNaive).getTime() - new Date(chiNow).getTime()
      shiftSoon = diffMs > 0 && diffMs < 3 * 3600000
    }
    const quietHold = inQuiet && !shiftSoon
    if (quietHold && sendLive && !hasYes && wave.length) {
      stats.held_quiet_hours = (Number(stats.held_quiet_hours) || 0) + wave.length
    }
    if (sendLive && !hasYes && fuseBurned && !quietHold && wave.length && ghl.token && ghl.locationId) {
      /* MESSAGE DESIGN (adopted from CareQB's template split): only tier 1 —
         caregivers who already work with this client — get the client's name.
         Everyone else gets "a last-minute fill-in in {city}". A text fanned
         out to dozens of phones should not name a care recipient to people
         who have never met them. Wording is editable without a deploy:
         ops_settings.coverage_msg_tier1 / coverage_msg_other, placeholders
         {first_name} {client} {when}. */
      const who = String(c.client || 'a client').split(/\s+/)
      const clientShort = who[0]   // first name only (her call — no last initial)
      /* City and care level were fetched before the wave was built. The
         client's AxisCare NOTE text is deliberately never pulled at send
         time: note boxes can hold DOOR CODES, and {care} only ever carries
         what a person left in the form's care box. */
      /* "today 2:00-6:00 PM" reads better than a bare date. */
      const chiToday = new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
      const relDay = !c.shift_date ? '' : c.shift_date === chiToday ? 'today'
        : (new Date(c.shift_date + 'T12:00:00').getTime() - new Date(chiToday + 'T12:00:00').getTime() === 86400000) ? 'tomorrow'
        : new Date(c.shift_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
      const when = [relDay, c.shift_time].filter(Boolean).join(' ')
        || 'as soon as possible — the office has details'
      /* {care}: a one-line client synopsis for caregivers who DON'T know the
         client (CareQB's pattern, requested by Samantha) — carried on the
         case (care_note, set/edited in the hub confirm step). Tier 1 knows
         the client, so their default stays short and synopsis-free. */
      /* {care} comes ONLY from the case's care_note — text a person put (or
         approved after a prefill) in the form's care box. Never straight
         from an AxisCare note field: those can carry door codes. */
      const careLine = String(c.care_note || '').trim()
      /* {address}: street + city (her call, 2026-09-12 — distance decides
         whether a caregiver takes a shift, and CareQB showed the street too;
         the name-withholding for strangers stays, an address without a name
         is what makes that trade acceptable). */
      const addr = [String(c.client_street || '').trim(), String(c.client_city || '').trim()]
        .filter(Boolean).join(', ') || 'the address is with the office'
      const fill = (tmpl: string, x: any) => tmpl
        .replaceAll('{first_name}', x.first || 'there')
        .replaceAll('{client}', clientShort)
        .replaceAll('{where}', c.client_city ? ` in ${c.client_city}` : '')
        .replaceAll('{address}', addr)
        .replaceAll('{when}', when)
        .replaceAll('{care}', careLine ? careLine + ' ' : '')
        .replace(/\s{2,}/g, ' ').trim()
      /* Message priority: this CASE's edited wording (the coordinator can
         rewrite it in the confirm step before opening) → the agency-wide
         canned responses (Settings → Callout texts) → the built-in default.
         "Last-minute" wording is SAME-DAY ONLY (her rule: a Monday shift on
         Saturday night is an open shift, not a last-minute fill-in). */
      const isSameDay = c.shift_date === chiToday
      const tmpl1 = String(c.msg_tier1 || '') || String(settings.coverage_msg_tier1 || '') ||
        `Hi {first_name}, can you cover {client} {when}? It's Caring Companions. Reply YES or NO.`
      const tmplO = String(c.msg_other || '') ||
        (isSameDay
          ? (String(settings.coverage_msg_other_sameday || '') || String(settings.coverage_msg_other || '') ||
             `Hi {first_name}, it's Caring Companions. Last-minute fill-in at {address}: {when}. {care}Can you take it? Reply YES or NO. Questions welcome.`)
          : (String(settings.coverage_msg_other_advance || '') || String(settings.coverage_msg_other || '') ||
             `Hi {first_name}, it's Caring Companions. We have an open shift at {address}: {when}. {care}Can you take it? Reply YES or NO. Questions welcome.`))
      for (const x of wave) {
        /* An uncovered shift is the textbook urgent_internal: staff, 24/7. */
        const contact = await contactForOutbound(sb, ghl,
          { phone: x.phone, firstName: x.first || x.name }, 'urgent_internal')
        if (!contact) continue
        const message = fill(x.tier === 1 ? tmpl1 : tmplO, x)
        let ok = false
        try {
          const r = await fetch('https://services.leadconnectorhq.com/conversations/messages', {
            method: 'POST',
            headers: { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28',
                       'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'SMS', contactId: contact.contactId, message }),
          })
          ok = r.ok
          if (!r.ok) console.error('callout sms', r.status, await r.text().catch(() => ''))
        } catch (err) { console.error('callout sms failed', err) }
        if (ok) {
          const entry = { id: uid(), name: x.name, phone: x.phone, channel: 'sms',
            at: nowIso(), state: 'waiting', replied_at: null,
            tier: x.tier ?? 3, auto: true, ghl_contact_id: contact.contactId,
            /* Carried so assign-on-confirm knows WHO to put on the visit
               without a name lookup that could hit the wrong roster row. */
            axiscare_id: x.axiscare_id ?? null }
          /* Persist THIS ask immediately against the CURRENT row (a crash
             mid-wave must not forget delivered texts), and stop the wave the
             moment a YES has landed while we were sending. */
          const fresh = await appendAskFresh(c.id, entry)
          if (fresh) {
            c.asked = fresh.asked; c.pending_fill = fresh.pending_fill
            c.callout_started_at = fresh.callout_started_at
          } else { askedArr.push(entry) }
          sentThisRun++
          if (c.pending_fill) break   // a YES landed mid-wave; stop asking
          /* The tag is what lets the GHL reply-workflow fire ONLY for people
             we actually asked, instead of on every inbound text. */
          try {
            await fetch(`https://services.leadconnectorhq.com/contacts/${contact.contactId}/tags`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28',
                         'Content-Type': 'application/json' },
              body: JSON.stringify({ tags: ['coverage-asked'] }),
            })
          } catch { /* a missing tag only costs a stray workflow execution */ }
        }
      }
      if (sentThisRun) stats.sent += sentThisRun
      /* No bulk end-of-wave write: every ask was persisted fresh above. */
    }

    /* ── TIMEOUT ESCALATION: an exhausted callout must get LOUD. ─────────
       When the bench is empty (nobody left to ask), nobody said yes, and
       the last ask has had 20 minutes to be answered, a person takes over:
       an URGENT item lands on whoever owns scheduling coverage right now,
       and they get an SMS (held during 21:00-08:00 unless the shift starts
       within 3 hours — the same courtesy rule as the callouts themselves).
       Once per case; reopening a case clears the flag. */
    const autoAsked = askedArr.filter((a: any) => a.auto === true)
    const ESCALATE_AFTER_MIN = 20
    const escalateReady = sendLive && !c.pending_fill && !c.callout_escalated_at
      && autoAsked.length > 0 && wave.length === 0
      && newestAsk > 0 && (Date.now() - newestAsk) > ESCALATE_AFTER_MIN * 60000
    if (escalateReady) {
      const own2 = own.owner || 'samantha@mo-care.com'
      const declined = askedArr.filter((a: any) => a.state === 'no').length
      const noReply = askedArr.filter((a: any) => a.state === 'waiting').length
      const whenTxt = [c.shift_date, c.shift_time].filter(Boolean).join(' ') || 'time on the case'
      await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: {
        id: `ops_covesc_${c.id}`, kind: 'coverage', coverage_case_id: c.id,
        title: `CALLOUT EXHAUSTED — ${c.client || 'shift'} ${whenTxt} still uncovered`,
        about: c.client || '',
        detail: `${autoAsked.length} caregivers asked: ${declined} declined, ${noReply} never answered, nobody said yes. A person needs to work this now — call people, split the shift, or tell the client.`,
        domain: 'scheduling_coverage', status: 'open', urgency: 'high',
        owner: own2, owner_name: own2.split('@')[0],
        created_at: nowIso(), due: new Date(Date.now() + 3600000).toISOString(),
        created_by: 'coverage-run', opened_by: 'callout-escalation',
      } })
      /* The SMS to the duty holder. Phone comes from coordinator_staff. */
      let smsSent = false
      const chiHr = Number(new Date().toLocaleString('en-US',
        { timeZone: 'America/Chicago', hour: '2-digit', hour12: false }))
      const smsAllowed = shiftSoon || (chiHr >= 8 && chiHr < 21)
      if (smsAllowed && ghl.token && ghl.locationId) {
        try {
          const { data: stRow } = await sb.from('app_data').select('data').eq('key', 'coordinator_staff').maybeSingle()
          const staff: any[] = Array.isArray(stRow?.data) ? stRow!.data : []
          const person = staff.find((s: any) => String(s.email || '').toLowerCase() === own2.toLowerCase())
          const phone = normalisePhone(person?.phone)
          if (phone) {
            const contact = await contactForOutbound(sb, ghl,
              { phone, firstName: person?.name || own2.split('@')[0] }, 'urgent_internal', { selfSupplied: true })
            if (contact) {
              const msg = (String(settings.coverage_msg_escalation || '') ||
                `Coverage alert: the callout for {client} {when} ran out of caregivers to ask ({asked} asked, nobody said yes). It needs a person now. Board: cc.mo-care.com`)
                .replaceAll('{client}', String(c.client || 'a client'))
                .replaceAll('{when}', whenTxt)
                .replaceAll('{asked}', String(autoAsked.length))
              const r = await fetch('https://services.leadconnectorhq.com/conversations/messages', {
                method: 'POST',
                headers: { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28',
                           'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'SMS', contactId: contact.contactId, message: msg }),
              })
              smsSent = r.ok
            }
          }
        } catch { /* the item is the guarantee; the SMS is the accelerant */ }
      }
      const fresh = await readCaseFresh(c.id)
      if (fresh) {
        fresh.callout_escalated_at = nowIso()
        fresh.callout_escalation_sms = smsSent
        await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: fresh })
        c.callout_escalated_at = fresh.callout_escalated_at
      }
      stats.escalated = (Number(stats.escalated) || 0) + 1
    }

    const itemId = `ops_cov_${c.id}`
    detail.push({
      case_id: c.id,
      client: c.client ?? '(not identified — AxisCare)',
      client_resolution: clientRes.status === 'resolved'
        ? clientRes.detail
        : `${clientRes.status}: ${clientRes.detail} — waves fall back to tier 2/3 ranking`,
      history_error: historyError,
      recent_activity_error: recent.error,
      axiscare_census: censusUsable
        ? `${axisActive.size} active caregivers; ${inactiveSkipped} roster candidate(s) skipped as not active in AxisCare`
        : `census unavailable (${censusError || 'empty'}) — roster-only filtering this run`,
      busy_check: `${busyCheck}; ${busySkipped} skipped from this wave as already working`,
      nurse_check: `${nurseAxis.size} nurse-classed in AxisCare; ${nurseSkipped} additionally skipped from this wave (nurse-roster names are excluded before candidacy)`,
      care_level: clientLv != null
        ? `client is Level ${clientLv} (class "${c.client_care_level_from || '?'}"); ${underLevelSkipped} caregiver(s) skipped as below level; ${caregiverLevel.size} caregivers carry a level class`
        : 'no care-level class found on this client — level filter off for this case',
      reason: c.reason,
      opened: c.opened_at,
      owner_now: c.owner ?? '(none)',
      owner_should_be: own.owner ?? '(none)',
      why_owner: own.why,
      already_asked: (c.asked ?? []).length,
      candidates_considered: cands.length,
      eligible_to_message: sendable.length,
      /* Ranked: worked-with-this-client first, then recently active, then the
         rest — each with the reason, so a human can argue with the order. */
      this_wave: wave.map((w: any) => ({ name: w.name, tier: w.tier, why: w.tier_why })),
      next_in_line: sendable.filter((x: any) => !wave.includes(x))
        .slice(0, WAVE_SIZE * 2).map((w: any) => ({ name: w.name, tier: w.tier, why: w.tier_why })),
      blocked: cands.filter(x => x.skipped).slice(0, 8)
        .map((x: any) => ({ name: x.name, skipped: x.skipped, phone_last4: x.phone_last4 })),
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
    /* Per-item writes only: a whole-array write from this run's stale
       snapshot deleted concurrently-created cases (review finding 2). */
    for (const c of open) {
      if (!c.owner) continue
      const fresh = await readCaseFresh(c.id)
      if (fresh && !fresh.owner) { fresh.owner = c.owner
        await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: fresh }) }
    }
  }

  /* ── CLOSURE TEXTS: when a case closes, everyone still waiting hears so.
     "First YES wins" only feels fair if the others aren't left hanging.
     Daytime only (8-21 Chicago) — nobody needs "it's covered" at 3am. ── */
  if (sendLive && ghl.token && ghl.locationId) {
    const chiHour = Number(new Date().toLocaleString('en-US',
      { timeZone: 'America/Chicago', hour: '2-digit', hour12: false }))
    if (chiHour >= 8 && chiHour < 21) {
      for (const cStale of cases) {
        if (cStale?.status === 'open' || cStale?.closure_notified) continue
        const c = await readCaseFresh(cStale.id) ?? cStale
        if (c?.status === 'open' || c?.closure_notified) continue
        const askedList = Array.isArray(c.asked) ? c.asked : []
        /* The winner hears they're confirmed (CareQB's "Assign to Shift"
           message). They said yes to a shift; silence after that reads as
           "did I get it or not?". Full client name is right here — they are
           assigned now and need to know who they're going to. */
        if (c.resolved_how === 'covered' && c.covered_by) {
          const winner = askedList.find((a: any) => a.auto === true && a.state === 'yes'
            && !a.confirm_sent && String(a.name).toLowerCase() === String(c.covered_by).toLowerCase()
            && a.ghl_contact_id)
          if (winner) {
            const whenTxt = [c.shift_date, c.shift_time].filter(Boolean).join(' ')
            try {
              const r = await fetch('https://services.leadconnectorhq.com/conversations/messages', {
                method: 'POST',
                headers: { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28',
                           'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'SMS', contactId: winner.ghl_contact_id,
                  message: (String(settings.coverage_msg_confirmed || '') ||
                    `You're confirmed for {client}, {when}. It's on your schedule. Thank you, {first_name}!`)
                    .replaceAll('{first_name}', String(winner.name).split(' ')[0])
                    .replaceAll('{client}', String(c.client || 'the client'))
                    .replaceAll('{when}', whenTxt || 'as scheduled')
                    .replace(/\s{2,}/g, ' ').trim() }),
              })
              if (r.ok) { winner.confirm_sent = true
                /* Persist NOW: if the courtesy texts below all fail, the next
                   run must not re-send "You're confirmed" (review finding 9). */
                await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: c })
              }
            } catch { /* the office confirmed by phone anyway; never block closure */ }
          }
        }
        const waiting = askedList
          .filter((a: any) => a.auto === true && a.state === 'waiting' && a.ghl_contact_id)
        if (!waiting.length) {
          /* Nothing left to notify — but a just-confirmed winner must be
             persisted or the next run would text them "confirmed" again. */
          if (askedList.some((a: any) => a.confirm_sent)) {
            c.closure_notified = nowIso()
            await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: c })
          }
          continue
        }
        let told = 0
        for (const a of waiting) {
          try {
            const r = await fetch('https://services.leadconnectorhq.com/conversations/messages', {
              method: 'POST',
              headers: { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28',
                         'Content-Type': 'application/json' },
              body: JSON.stringify({ type: 'SMS', contactId: a.ghl_contact_id,
                message: String(settings.coverage_msg_covered || '') ||
                  `Caring Companions: that shift is covered now. Thank you! No action needed.` }),
            })
            if (r.ok) { a.state = 'closed_notified'; told++ }
            /* Case over: drop the tag so future texts stop firing the
               reply workflow (and stop costing premium executions). */
            await fetch(`https://services.leadconnectorhq.com/contacts/${a.ghl_contact_id}/tags`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28',
                         'Content-Type': 'application/json' },
              body: JSON.stringify({ tags: ['coverage-asked'] }),
            }).catch(() => {})
          } catch { /* one failed courtesy text must not block the rest */ }
        }
        if (told) {
          c.closure_notified = nowIso()
          stats.closure_notified += told
          await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: c })
        }
      }
    }
  }

  await releaseRunLock()
  return new Response(JSON.stringify({
    mode: commit ? 'COMMIT' : 'DRY RUN (cases/items only — sending has its own switch)',
    sending_enabled: sendLive,
    sending_note: sendLive
      ? `LIVE: waves of ${WAVE_SIZE} by tier, ${fuseMin}-min fuse, quiet hours hold overnight sends unless the shift starts within 3h. Replies land via coverage-reply.`
      : 'Sending is off. Flip ops_settings.coverage_send_live to true to let waves text caregivers.',
    coverage_owner: own,
    wave_size: WAVE_SIZE,
    gate_evaluated_independently: gate,
    stats, detail,
    /* AxisCare access is BACK (2026-08-13), so this list shrank: worked-with-
       this-client ranking and recent-activity now come from real visit
       history above. What still needs AxisCare work (or a build): */
    blocked_or_unbuilt: [
      'caregiver availability and schedule conflicts (schedules readable — not wired in yet)',
      'overtime risk',
      'service area and client requirements',
      'writing the accepted assignment back to the schedule (API supports it — deliberately manual for now)',
      'family notification driven by the real schedule change',
      'ongoing/recurring open shifts offered as ONE package instead of shift-by-shift',
    ],
  }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } })
})
