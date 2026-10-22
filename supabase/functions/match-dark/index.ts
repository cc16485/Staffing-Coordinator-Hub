// =============================================================================
// match-dark · THE MATCH RULE, RUN IN THE DARK (Samantha "go", 2026-10-12, Track 3d)
// =============================================================================
// Each night (when the Admin switch "Matching dark report (nightly)", ops_settings.match_dark_live, is on), or once from a
// Desktop step: every visit in the next 14 days checked with the shared match rule (match-rules.js, run only when its
// fingerprint is approved) against the assigned caregiver, and the last 60 days of call-offs replayed. Reads AxisCare
// (visits, caregivers, clients) and the Hub's records; WRITES ONE THING: app_data 'match_dark_report'. No visit, schedule,
// caregiver, client, card or text is touched. Callers: its own schedule (the vault secret) or the owner's Desktop step.
//   POST {}            the schedule: runs only while the switch is on
//   POST { once: true } the owner's Desktop step: runs once, switch or not
//   GET ?rules_check=1  which rules it would run and whether each is approved (nothing is run)
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jobCaller } from '../_shared/job-auth.ts'
import { approvedRules, rulesCheck } from '../_shared/approved-rules.ts'
import { careLevelOf } from '../_shared/care-level.ts'
import { resolvePayer } from '../_shared/client-events.ts'
import { workLock } from '../_shared/work-lock.ts'
import { loadNotClients, isNotClient } from '../_shared/client-quiet.ts'   // 2026-10-22: never the Practice client or Office Staff
import { rowWorking, inTrainingLive } from '../_shared/in-training.ts'   // 2026-10-22 In Training is onboarding
import { experienceSummary } from '../_shared/step1-experience.ts'
import { buildDarkReport } from '../_shared/match-dark.ts'
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
const AC_VERSION = Deno.env.get('AXISCARE_API_VERSION') || '2023-10-01'
const rowsOf = (v: any): any[] => Array.isArray(v) ? v : (v && typeof v === 'object') ? Object.values(v) : []
function axisCreds() {
  let token = ''; for (const n of ['AXISCARE_VISITS_TOKEN', 'AXISCARE_API_KEY', 'AXISCARE_TOKEN']) { const v = Deno.env.get(n); if (v?.startsWith('axc_')) { token = v; break } if (v && !token) token = v }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  return { token, site: /^\d+$/.test(site) ? site : '' }
}
const PAYER: Record<string, string> = { 'medicaid': 'medicaid', 'private pay': 'private', 'private': 'private', 'va': 'va', 'veterans affairs': 'va', 'ltc': 'ltc', 'long term care': 'ltc', 'long-term care': 'ltc', 'medicare guide': 'guide', 'guide': 'guide', 'cds': 'cds' }
const payerOf = (classes: any) => { const p = resolvePayer(rowsOf(classes)).payer; return p ? (PAYER[p.toLowerCase()] || p.toLowerCase()) : null }
const chiDay = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)

async function axisAll(site: string, token: string, path: string, key: string, max = 15): Promise<any[]> {
  const out: any[] = []; let url: string | null = `https://${site}.axiscare.com${path}`
  for (let i = 0; url && i < max; i++) {
    const r: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-AxisCare-Api-Version': AC_VERSION } })
    if (!r.ok) throw new Error(`AxisCare ${path.split('?')[0]} answered ${r.status}`)
    const j: any = await r.json().catch(() => ({}))
    out.push(...rowsOf(j?.results?.[key] ?? j?.[key]))
    const next = j?.results?.nextPage ?? j?.nextPage ?? j?.results?.nextPageUrl ?? j?.nextPageUrl ?? null
    url = typeof next === 'string' && next.startsWith(`https://${site}.axiscare.com/`) ? next : null
  }
  return out
}

Deno.serve(async (req) => {
  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false, autoRefreshToken: false } })
  const who = await jobCaller(req); if (!who) return json({ error: 'not allowed' }, 401)
  if (new URL(req.url).searchParams.get('rules_check') === '1') return json(await rulesCheck(db, ['match-rules.js', 'eligibility-rules.js']))
  const b: any = await req.json().catch(() => ({}))
  const key = async (k: string) => { const { data } = await db.from('app_data').select('data').eq('key', k).maybeSingle(); return data?.data ?? null }
  const st = (await key('ops_settings')) || {}
  if (!(st.match_dark_live === true || (who === 'owner' && b.once === true))) return json({ ok: true, skipped: 'the switch "Matching dark report (nightly)" is off' })
  /* the two rules, approved by fingerprint, or nothing */
  const rules: Record<string, any> = {}, fps: Record<string, string> = {}
  for (const [f, g] of [['match-rules.js', 'CCMatch'], ['eligibility-rules.js', 'CCElig']]) {
    const a = await approvedRules(db, f); if (!a.ok) return json({ error: 'not run: ' + a.error }, 502)
    ;(0, eval)(a.src); rules[g] = (globalThis as any)[g]; fps[f] = a.fingerprint.slice(0, 12)
    if (!rules[g]) return json({ error: f + ' did not define ' + g }, 502)
  }
  const { token, site } = axisCreds(); if (!token || !site) return json({ error: 'AxisCare credentials are not set on this project' }, 502)
  const trainLive = await inTrainingLive(db)   // 2026-10-22: In Training (onboarding) is not a match once the switch is on
  await loadNotClients(db)   /* 2026-10-22: the not-client list first (Office Staff, the Practice client) */
  try {
    const [visits, axCaregivers, axClients] = await Promise.all([
      axisAll(site, token, `/api/visits?startDate=${chiDay(0)}&endDate=${chiDay(13)}`, 'visits').then((xs) => xs.filter((v) => !isNotClient(v))),
      axisAll(site, token, '/api/caregivers', 'caregivers').then((xs) => xs.filter((g) => rowWorking(g, trainLive))),
      axisAll(site, token, '/api/clients', 'clients').then((xs) => xs.filter((c) => c?.status?.active === true && !isNotClient(c))) ])
    const [roster, overlay, availability, dnr, cases, previous] = await Promise.all(['caregivers', 'caregiver_overlay', 'caregiver_availability', 'dnr_log', 'coverage_cases', 'match_dark_report'].map(key))
    /* each visited client's care needs: AxisCare client → person → their active Journey → the fact record (null = no Journey) */
    const clientIds = [...new Set(visits.filter((v) => v?.client?.id != null).map((v) => String(v.client.id)).concat(rowsOf(cases).map((k: any) => String(k?.client_axiscare_id || '')).filter(Boolean)))]
    const factsByClient: Record<string, any[] | null> = {}
    if (clientIds.length) {
      const { data: ps } = await db.from('person_source_id').select('person_id, source_id').eq('system', 'axiscare').eq('entity_type', 'client').in('source_id', clientIds)
      const personOf = new Map((ps ?? []).map((p: any) => [String(p.source_id), p.person_id]))
      const persons = [...new Set((ps ?? []).map((p: any) => p.person_id))]
      const { data: eps } = persons.length ? await db.from('journey_episode').select('episode_id, person_id, state, created_at').in('person_id', persons) : { data: [] }
      /* the person's active Journey (journey_state_is_active: provisional, open, converted, established); the newest wins */
      const epOf = new Map<string, string>(); for (const e of (eps ?? []).filter((e: any) => ['provisional', 'open', 'converted', 'established'].includes(e.state)).sort((a: any, z: any) => String(a.created_at).localeCompare(String(z.created_at)))) epOf.set(String(e.person_id), e.episode_id)
      const epIds = [...new Set([...epOf.values()])]
      const { data: fs } = epIds.length ? await db.from('client_fact_current').select('episode_id, kind, layer, value').in('episode_id', epIds).in('layer', ['plan', 'current']) : { data: [] }
      for (const id of clientIds) { const p = personOf.get(id), e = p ? epOf.get(String(p)) : null; factsByClient[id] = e ? (fs ?? []).filter((f: any) => f.episode_id === e) : null }
    }
    /* Step 1 skills pictures for roster caregivers who came through the new Step 1 */
    const step1ByAx: Record<string, any> = {}
    const withOffer = rowsOf(roster).filter((r: any) => r?.offer_id && r?.axiscare_id)
    if (withOffer.length) {
      const { data: f1 } = await db.from('step1_forms').select('offer_id, answers').in('offer_id', withOffer.map((r: any) => r.offer_id))
      const { data: rr } = await db.from('reference_requests').select('*').in('candidate_id', withOffer.map((r: any) => String(r.candidate_id ?? '')).filter(Boolean))
      for (const r of withOffer) { const f = (f1 ?? []).find((x: any) => x.offer_id === r.offer_id); if (f?.answers) step1ByAx[String(r.axiscare_id).replace(/\D/g, '')] = experienceSummary(f.answers, (rr ?? []).filter((q: any) => String(q.candidate_id) === String(r.candidate_id))) }
    }
    const lock = await workLock(db, rowsOf(roster))
    const report = buildDarkReport({ now: new Date().toISOString(), M: rules.CCMatch, E: rules.CCElig, levelOf: (c) => careLevelOf(c).level, payerOf,
      visits, axCaregivers, axClients, roster: rowsOf(roster), overlay: rowsOf(overlay), availability: rowsOf(availability), dnr: rowsOf(dnr), factsByClient, step1ByAx, lock, cases: rowsOf(cases), previous, fingerprints: fps, driveGate: st.driver_schedule_gate_live === true /* Driver Compliance rollout switch */ })
    report.run_by = who
    const { error } = await db.from('app_data').upsert({ key: 'match_dark_report', data: report, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    if (error) return json({ error: 'the report could not be saved: ' + error.message }, 500)
    return json({ ok: true, at: report.at, counts: report.counts, clients: { total: report.clients.total, incomplete: report.clients.incomplete, flagged: report.clients.flagged, no_journey: report.clients.no_journey }, replay: report.replay.cases, gaps: report.gaps })
  } catch (e) { return json({ error: String((e as Error).message || e).slice(0, 300), note: 'nothing was written' }, 502) }
})
