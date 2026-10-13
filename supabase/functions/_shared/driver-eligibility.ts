// =============================================================================
// driver-eligibility.ts · WHO MAY DRIVE A CLIENT, AND DOES THIS SHIFT NEED IT (Driver Compliance in scheduling, 2026-10-13)
// =============================================================================
// HER RULE: "A caregiver who is Non-Driver, Pending Verification, or Suspended must not be treated as eligible for shifts
// that require transporting clients. Only Approved Drivers with current, verified documentation should qualify for
// transportation assignments." A caregiver with no driver record yet is not eligible either (no assumption). Shifts that
// do not need transportation are unaffected.
//
// ONE RULE, TWO IDENTICAL COPIES: this file (the server: team-ask through shift-ask-gate, coverage-run, profile-check) and
// the Hub's match-rules.js (CCMatch.transportEligible / CCMatch.transportNeed: the browser, the Staffing sheet, the Team
// Builder, the new-hire card, and match-dark on the server). driver_eligibility_test.mjs runs both on one table of cases
// and fails if they ever disagree. Change both together.
//
// Reads only the roster fields the driver-compliance mirror maintains (_shared/driver.ts rosterFields): dl_status
// ('Non-Driver' | 'Pending Verification' | 'Approved Driver' | 'Suspended'), cleared_to_drive (true only when approved and
// both expiries are in the future), dl_expires, auto_ins_expires. Pure: no clock except the date passed in.
// deno-lint-ignore-file no-explicit-any

/** May this caregiver be given a shift that needs transporting a client? ok, and why in words the office reads. */
export function transportEligible(cg: any, today?: string): { ok: boolean; why: string } {
  cg = cg || {}
  const st = String(cg.dl_status == null ? '' : cg.dl_status).trim(), k = st.toLowerCase()
  if (!k || k === 'not set up yet') return { ok: false, why: 'No driver record yet' }
  if (k === 'suspended') return { ok: false, why: 'Driving suspended' }
  if (k === 'non-driver') return { ok: false, why: 'Not an Approved Driver (Non-Driver)' }
  if (k === 'pending verification') return { ok: false, why: 'Not an Approved Driver (Pending Verification)' }
  if (k !== 'approved driver') return { ok: false, why: 'Not an Approved Driver (' + st.slice(0, 40) + ')' }
  const day = (v: any) => { const x = String(v == null ? '' : v).slice(0, 10); return /^\d{4}-\d\d-\d\d$/.test(x) ? x : '' }
  const le = day(cg.dl_expires), ie = day(cg.auto_ins_expires), t = day(today)
  if (t && ((le && le <= t) || (ie && ie <= t))) return { ok: false, why: 'License or insurance expired' }
  if (cg.cleared_to_drive !== true) return { ok: false, why: (!le || !ie) ? 'License or insurance expiration not on file' : 'License or insurance expired' }
  return { ok: true, why: 'Approved Driver' }
}

/** Does this shift need transportation? 'required' from any source wins, then 'preferred'; nothing known = null (not
 *  required). Sources: the Team Builder plan's needs (chip 'transportation' = required), the client's fact record
 *  (need_transportation, the latest layer wins: intake < assessment < plan < current), the lead's checklist
 *  (client_attributes.transportation 'yes' = required, 'preferred' = preferred). */
export function transportNeed(x: any): { level: 'required' | 'preferred' | null; from: string[] } {
  x = x || {}
  const req: string[] = [], pref: string[] = []
  if (Array.isArray(x.planNeeds) && x.planNeeds.map(String).includes('transportation')) req.push('the Team Builder plan')
  const rank = (l: any) => ['intake', 'assessment', 'plan', 'current'].indexOf(String(l))
  let f: any = null
  for (const r of (Array.isArray(x.facts) ? x.facts : [])) if (r && r.kind === 'need_transportation' && (!f || rank(r.layer) > rank(f.layer))) f = r
  const fv = f ? String(f.value == null ? '' : f.value).toLowerCase() : ''
  if (fv === 'required') req.push('the care needs (' + (f.layer || 'record') + ')')
  else if (fv === 'preferred') pref.push('the care needs (' + (f.layer || 'record') + ')')
  const a = x.attrs && typeof x.attrs === 'object' ? x.attrs.transportation : null
  const av = a === true ? 'yes' : String(a == null ? '' : a).toLowerCase()
  if (av === 'yes' || av === 'required') req.push('the lead checklist')
  else if (av === 'preferred') pref.push('the lead checklist')
  return req.length ? { level: 'required', from: req } : pref.length ? { level: 'preferred', from: pref } : { level: null, from: [] }
}

// =============================================================================
// Reading the sources for one shift (database). Never throws: what cannot be read is said in `unknown`, and an unknown
// need counts as not required (her rule), so the caller can show it.
// =============================================================================
/** The client's fact record and lead checklist, by AxisCare client id (person_source_id → the active Journey →
 *  client_fact_current; app_data leads by axiscare_client_id), plus a plan's needs when there is one. */
export async function readTransportNeed(sb: any, x: { clientAxId?: string | null; planNeeds?: unknown; leads?: any[] | null }): Promise<{ level: 'required' | 'preferred' | null; from: string[]; unknown: string | null }> {
  const ax = String(x.clientAxId ?? '').trim()
  let facts: any[] = [], attrs: any = null, unknown: string | null = null
  if (ax) {
    try {
      const { data: src } = await sb.from('person_source_id').select('person_id').eq('system', 'axiscare').eq('entity_type', 'client').eq('source_id', ax)
      const persons = [...new Set((Array.isArray(src) ? src : []).map((p: any) => p?.person_id).filter(Boolean))]
      if (persons.length) {
        const { data: eps } = await sb.from('journey_episode').select('episode_id, person_id, state, created_at').in('person_id', persons)
        const live = (Array.isArray(eps) ? eps : []).filter((e: any) => ['provisional', 'open', 'converted', 'established'].includes(String(e?.state)))
          .sort((a: any, z: any) => String(a.created_at).localeCompare(String(z.created_at)))
        const ep = live.length ? live[live.length - 1].episode_id : null
        if (ep) { const { data: fs } = await sb.from('client_fact_current').select('kind, layer, value').eq('episode_id', ep).eq('kind', 'need_transportation'); facts = Array.isArray(fs) ? fs : [] }
      }
    } catch { unknown = 'the care needs could not be read' }
    try {
      let leads = x.leads
      if (!Array.isArray(leads)) { const { data } = await sb.from('app_data').select('data').eq('key', 'leads').maybeSingle(); leads = Array.isArray(data?.data) ? data.data : [] }
      const l = (leads || []).find((y: any) => y && String(y.axiscare_client_id ?? '') === ax)
      attrs = l?.client_attributes ?? null
    } catch { unknown = (unknown ? unknown + '; ' : '') + 'the lead checklist could not be read' }
  }
  const n = transportNeed({ planNeeds: x.planNeeds, facts, attrs })
  return { ...n, unknown }
}
