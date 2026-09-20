// =============================================================================
// evidence-write — THE one door of the caregiver evidence foundation
// =============================================================================
// Her build authorization (2026-09-20), on the approved boundary + Decision 2
// with both corrections. Three app_data namespaces, service-role-only behind
// the restrictive RLS policy created by deploy script 188:
//   caregiver_evidence_events  (append-only)
//   caregiver_claim_links      (append-only)
//   caregiver_claims           (DERIVED projection — rebuildable, never truth)
//
// The API accepts EVENTS AND LINKS ONLY. There is no input that sets a claim:
// current state is derived by the pure resolver, and a human resolving a
// dispute does it by submitting a staff_resolution EVENT. Forbidden semantic
// promotion (e.g. reference_response → *.competency) fails closed at
// validation. work_demonstrated does not exist. attested does not exist.
// No freshness windows are invented. The frozen evaluator never calls this.
//
// GET ?selftest=1 runs the 27-fixture matrix against these exact functions,
// entirely in memory — nothing is persisted by fixtures.
// =============================================================================

// ─── PURE CORE (no Deno; locally testable) ───────────────────────────────────

export const REGISTRY_VERSION = '1.0.0'

export const EVENT_TYPES = ['caregiver_update', 'interview_answer', 'reference_response',
  'supervisory_observation', 'competency_check', 'training_completion',
  'staff_resolution', 'legacy_unspecified'] as const
const SELF = ['caregiver_update', 'interview_answer']
const OBSERVED = ['supervisory_observation', 'competency_check']

type Def = { family: 'experience' | 'competency' | 'tolerance' | 'proficiency'
  vocabulary: string[]; allowed: string[]; assertsOptionalFor?: string[] }

const EXP_ALLOWED = [...SELF, 'reference_response', ...OBSERVED, 'staff_resolution', 'legacy_unspecified']
const SKILLS = ['dementia_care', 'parkinsons_care', 'hospice_support', 'personal_care',
  'transfers_gait_belt', 'hoyer_lift', 'bedbound_care', 'complex_care', 'transportation']
const COMPETENCY_SKILLS = ['hoyer_lift', 'transfers_gait_belt', 'personal_care']

export const REGISTRY: Record<string, Def> = {}
for (const s of SKILLS)
  REGISTRY[s + '.experience'] = { family: 'experience',
    vocabulary: ['yes', 'some', 'lots', 'no'], allowed: EXP_ALLOWED }
for (const s of COMPETENCY_SKILLS)
  REGISTRY[s + '.competency'] = { family: 'competency',
    vocabulary: ['demonstrated', 'failed'],
    allowed: [...OBSERVED, 'staff_resolution'] }   // NEVER self, reference, legacy
for (const t of ['cats', 'dogs', 'smoking'])
  REGISTRY[t + '.willingness'] = { family: 'tolerance', vocabulary: ['yes', 'no'],
    allowed: [...SELF, 'supervisory_observation', 'staff_resolution', 'legacy_unspecified'],
    assertsOptionalFor: ['supervisory_observation'] }  // an observation may flag, never set
REGISTRY['spanish.ability'] = { family: 'proficiency',
  vocabulary: ['none', 'basic', 'conversational', 'fluent'],
  allowed: [...SELF, ...OBSERVED, 'staff_resolution', 'legacy_unspecified'] }

// deno-lint-ignore no-explicit-any
export function validate(input: any): { ok: boolean; errors: string[]; event?: any; links?: any[] } {
  const errors: string[] = []
  const ev = input?.event ?? {}
  const links = Array.isArray(input?.links) ? input.links : []
  const axid = String(ev.axiscare_id ?? '')
  if (!/^\d+$/.test(axid)) errors.push('axiscare_id must be the numeric AxisCare caregiver id')
  const type = String(ev.type ?? '')
  if (!(EVENT_TYPES as readonly string[]).includes(type)) errors.push(`unknown event type '${type}'`)
  if (type === 'work_demonstrated') errors.push('work_demonstrated does not exist')
  if (!String(ev.client_token ?? '')) errors.push('client_token required (idempotency)')
  const src = String(ev.source_person ?? '').trim()
  if (!src && type !== 'legacy_unspecified') errors.push('source_person required')
  const occ = ev.occurred_at ? String(ev.occurred_at).slice(0, 10) : null
  const prec = String(ev.occurred_precision ?? (occ ? '' : 'unknown'))
  if (occ && !['date', 'approximate'].includes(prec))
    errors.push('occurred_precision must be date|approximate when occurred_at is given')
  if (!occ && prec !== 'unknown') errors.push('occurred_precision must be unknown when occurred_at is absent')
  if (!links.length) errors.push('at least one claim link required — evidence must say what it is evidence OF')
  for (const l of links) {
    const claim = String(l?.claim ?? '')
    const def = REGISTRY[claim]
    if (!def) { errors.push(`unknown claim '${claim}'`); continue }
    if (!def.allowed.includes(type))
      errors.push(`event type '${type}' may not support '${claim}' — refused (fail closed)`)
    const a = l?.asserts == null ? null : String(l.asserts)
    const optional = type === 'staff_resolution' || (def.assertsOptionalFor ?? []).includes(type)
    if (a == null && !optional) errors.push(`'${claim}': asserts required for '${type}'`)
    if (a != null && !def.vocabulary.includes(a))
      errors.push(`'${claim}': asserts '${a}' outside vocabulary [${def.vocabulary.join(', ')}]`)
  }
  if (errors.length) return { ok: false, errors }
  return { ok: true, errors: [],
    event: { axiscare_id: axid, type, source_person: src || 'unknown',
      source_record: ev.source_record ? String(ev.source_record) : null,
      occurred_at: occ, occurred_precision: occ ? prec : 'unknown',
      note: String(ev.note ?? ''), client_token: String(ev.client_token) },
    links: links.map((l: { claim: string; asserts?: string | null; note?: string }) => ({
      claim: String(l.claim), asserts: l.asserts == null ? null : String(l.asserts),
      note: String(l.note ?? '') })) }
}

// deno-lint-ignore no-explicit-any
type Entry = { event: any; asserts: string | null; note: string }
const byRec = (a: Entry, b: Entry) => String(a.event.recorded_at).localeCompare(String(b.event.recorded_at))
const isSelf = (e: Entry) => SELF.includes(e.event.type)
const isObs = (e: Entry) => OBSERVED.includes(e.event.type)
const isRes = (e: Entry) => e.event.type === 'staff_resolution'
const DEPTH: Record<string, number> = { yes: 1, some: 2, lots: 3 }

export function resolve(claim: string, entries: Entry[]) {
  const def = REGISTRY[claim]
  const es = [...entries].sort(byRec)
  const last = <T extends Entry>(arr: T[]) => arr.length ? arr[arr.length - 1] : null
  const out = { value: null as string | null, state: 'current',
    derived_from: es.map(e => String(e.event.id)),
    last_evidence_occurred: null as string | null, last_evidence_precision: 'unknown' }
  const occs = es.filter(e => e.event.occurred_at)
  const lastOcc = last(occs)
  if (lastOcc) { out.last_evidence_occurred = lastOcc.event.occurred_at
    out.last_evidence_precision = lastOcc.event.occurred_precision }

  if (def.family === 'experience') {
    const pos = es.filter(e => e.asserts != null && DEPTH[e.asserts])
    const noes = es.filter(e => e.asserts === 'no')
    const res = last(es.filter(isRes))
    if (pos.length) {
      out.value = pos.reduce((v, e) => DEPTH[e.asserts!] > DEPTH[v] ? e.asserts! : v, 'yes')
      const contested = noes.some(n => !res || byRec(n, res) > 0)
      out.state = contested ? 'disputed' : 'current'
      if (res && res.asserts != null && !contested) out.value = res.asserts
      const posOcc = last(pos.filter(e => e.event.occurred_at))
      if (posOcc) { out.last_evidence_occurred = posOcc.event.occurred_at
        out.last_evidence_precision = posOcc.event.occurred_precision }
    } else if (noes.length) { out.value = 'no' }
  } else if (def.family === 'competency') {
    const checks = es.filter(e => isObs(e) && e.asserts != null)
    const res = last(es.filter(isRes))
    const anyPass = checks.some(e => e.asserts === 'demonstrated')
    const lastCheck = last(checks)
    out.value = anyPass ? 'demonstrated' : (lastCheck ? lastCheck.asserts : null)
    if (lastCheck && lastCheck.asserts === 'failed' && (!res || byRec(lastCheck, res) > 0))
      out.state = 'needs_redemonstration'
  } else if (def.family === 'tolerance') {
    const setters = es.filter(e => (isSelf(e) || isRes(e)) && e.asserts != null)
    const s = last(setters)
    out.value = s ? s.asserts : null
    const flags = es.filter(e => isObs(e))
    const f = last(flags)
    if (f && (!s || byRec(f, s) > 0)) out.state = 'disputed'
  } else if (def.family === 'proficiency') {
    const res = last(es.filter(e => isRes(e) && e.asserts != null))
    const assess = es.filter(e => isObs(e) && e.asserts != null)
    const selfs = es.filter(e => isSelf(e) && e.asserts != null)
    const lastAssess = last(assess), lastSelf = last(selfs)
    const newestOf = [res, lastAssess, lastSelf].filter(Boolean).sort((a, b) => byRec(a!, b!))
    const newest = newestOf.length ? newestOf[newestOf.length - 1] : null
    if (res && newest === res) { out.value = res.asserts }
    else if (lastAssess) {
      out.value = lastAssess.asserts
      if (lastSelf && byRec(lastSelf, lastAssess) > 0 && lastSelf.asserts !== lastAssess.asserts
          && (!res || byRec(lastSelf, res) > 0)) out.state = 'needs_review'
    } else if (lastSelf) { out.value = lastSelf.asserts }
  }
  return out
}

// ─── THE 27 FIXTURES (in memory; persist nothing) ────────────────────────────
export function runSelftest() {
  const fails: string[] = []
  let n = 0
  const t = (name: string, cond: boolean) => { n++; if (!cond) fails.push(`#${n} ${name}`) }
  const ev = (id: string, type: string, rec: string, occ: string | null = null,
    prec = occ ? 'date' : 'unknown') =>
    ({ id, type, recorded_at: rec, occurred_at: occ, occurred_precision: prec })
  const E = (event: ReturnType<typeof ev>, asserts: string | null, note = ''): Entry => ({ event, asserts, note })
  const V = (type: string, links: { claim: string; asserts?: string | null }[]) =>
    validate({ event: { axiscare_id: '7', type, source_person: 'x', client_token: 'tk' }, links })

  // — validation refusals (write nothing, refuse loudly) —
  t('unknown event type refused', !V('psychic_reading', [{ claim: 'hoyer_lift.experience', asserts: 'yes' }]).ok)
  t('unknown claim refused', !V('caregiver_update', [{ claim: 'juggling.experience', asserts: 'yes' }]).ok)
  t('CANONICAL: reference_response → hoyer_lift.competency refused',
    !V('reference_response', [{ claim: 'hoyer_lift.competency', asserts: 'demonstrated' }]).ok)
  t('caregiver_update → competency refused',
    !V('caregiver_update', [{ claim: 'personal_care.competency', asserts: 'demonstrated' }]).ok)
  t('legacy_unspecified → competency refused',
    !V('legacy_unspecified', [{ claim: 'hoyer_lift.competency', asserts: 'demonstrated' }]).ok)
  t('asserts outside vocabulary refused',
    !V('caregiver_update', [{ claim: 'spanish.ability', asserts: 'shakespearean' }]).ok)
  t('non-digit axiscare_id refused',
    !validate({ event: { axiscare_id: 'abc', type: 'caregiver_update', source_person: 'x', client_token: 'tk' },
      links: [{ claim: 'cats.willingness', asserts: 'yes' }] }).ok)
  t('work_demonstrated does not exist as a type',
    !(EVENT_TYPES as readonly string[]).includes('work_demonstrated')
    && !V('work_demonstrated', [{ claim: 'hoyer_lift.experience', asserts: 'yes' }]).ok)

  // — resolver, per family —
  const cy = ev('e1', 'caregiver_update', '2026-01-01T10:00Z'), cn = ev('e2', 'caregiver_update', '2026-07-01T10:00Z')
  let r = resolve('cats.willingness', [E(cy, 'yes'), E(cn, 'no')])
  t('willingness: yes then later no → current no', r.value === 'no' && r.state === 'current')
  t('willingness: reference cannot set it (validation)',
    !V('reference_response', [{ claim: 'cats.willingness', asserts: 'no' }]).ok)
  r = resolve('cats.willingness', [E(cy, 'yes'), E(ev('e3', 'supervisory_observation', '2026-08-01T10:00Z'), null, 'allergic reaction observed')])
  t('tolerance: adverse observation → disputed, value still yes', r.value === 'yes' && r.state === 'disputed')
  const iv = ev('e4', 'interview_answer', '2026-02-01T10:00Z', '2026-02-01'), rf = ev('e5', 'reference_response', '2026-03-01T10:00Z')
  r = resolve('hoyer_lift.experience', [E(iv, 'lots'), E(rf, 'yes')])
  t('experience: interview lots + reference yes → additive, value lots', r.value === 'lots' && r.state === 'current' && r.derived_from.length === 2)
  r = resolve('hoyer_lift.experience', [E(iv, 'lots'), E(ev('e6', 'reference_response', '2026-04-01T10:00Z'), 'no', 'says she never used one there')])
  t('experience: explicit contradiction → disputed, value unflipped', r.value === 'lots' && r.state === 'disputed')
  r = resolve('hoyer_lift.experience', [E(iv, 'lots')])
  t('experience: reference silent on the skill changes nothing (no link, no entry)', r.value === 'lots' && r.state === 'current')
  r = resolve('hoyer_lift.experience', [E(ev('e7', 'reference_response', '2026-05-01T10:00Z', '2014-06-01', 'approximate'), 'lots')])
  t('experience: 2014 recency preserved with approximate precision, still yes-strength',
    r.value === 'lots' && r.last_evidence_occurred === '2014-06-01' && r.last_evidence_precision === 'approximate')
  t('competency: only qualifying events can create it (validation)',
    V('competency_check', [{ claim: 'hoyer_lift.competency', asserts: 'demonstrated' }]).ok
    && !V('interview_answer', [{ claim: 'hoyer_lift.competency', asserts: 'demonstrated' }]).ok)
  const pass = ev('e8', 'competency_check', '2026-03-01T10:00Z', '2026-03-01'), fail = ev('e9', 'competency_check', '2026-06-01T10:00Z', '2026-06-01')
  r = resolve('hoyer_lift.competency', [E(pass, 'demonstrated'), E(fail, 'failed')])
  t('competency: failed after pass → needs_redemonstration, history retained',
    r.value === 'demonstrated' && r.state === 'needs_redemonstration' && r.derived_from.includes('e8'))
  const s1 = ev('e10', 'caregiver_update', '2026-01-01T10:00Z'), s2 = ev('e11', 'caregiver_update', '2026-05-01T10:00Z')
  r = resolve('spanish.ability', [E(s1, 'basic'), E(s2, 'conversational')])
  t('spanish: self-reports move value freely without assessment', r.value === 'conversational' && r.state === 'current')
  const asse = ev('e12', 'competency_check', '2026-02-01T10:00Z', '2026-02-01')
  r = resolve('spanish.ability', [E(asse, 'conversational'), E(ev('e13', 'caregiver_update', '2026-06-01T10:00Z'), 'fluent')])
  t('spanish: newer self fluent over older assessed conversational → needs_review, assessed value retained',
    r.value === 'conversational' && r.state === 'needs_review')
  r = resolve('spanish.ability', [E(ev('e14', 'competency_check', '2026-02-01T10:00Z'), 'fluent'), E(ev('e15', 'caregiver_update', '2026-06-01T10:00Z'), 'basic')])
  t('spanish: self-reported decline under assessed fluent → needs_review (opposite direction)',
    r.value === 'fluent' && r.state === 'needs_review')
  r = resolve('hoyer_lift.experience', [E(iv, 'lots'), E(ev('e16', 'reference_response', '2026-04-01T10:00Z'), 'no'),
    E(ev('e17', 'staff_resolution', '2026-05-01T10:00Z'), 'yes', 'spoke to both; experience stands, depth uncertain')])
  t('staff_resolution closes the dispute and sets the resolved value', r.state === 'current' && r.value === 'yes')

  // — structure —
  const oneRef = ev('e18', 'reference_response', '2026-03-02T10:00Z')
  const multi = validate({ event: { axiscare_id: '7', type: 'reference_response', source_person: 'former supervisor', client_token: 'tk2' },
    links: [{ claim: 'dementia_care.experience', asserts: 'yes' }, { claim: 'hoyer_lift.experience', asserts: 'yes' },
            { claim: 'personal_care.experience', asserts: 'yes' }] })
  t('one reference event → three experience links accepted', multi.ok && multi.links!.length === 3)
  t('…and the same event may NOT also link to competency', !validate({
    event: { axiscare_id: '7', type: 'reference_response', source_person: 's', client_token: 'tk3' },
    links: [{ claim: 'dementia_care.experience', asserts: 'yes' }, { claim: 'hoyer_lift.competency', asserts: 'demonstrated' }] }).ok)
  t('Hoyer experience never implies Hoyer competency (distinct claims, distinct results)',
    resolve('hoyer_lift.experience', [E(oneRef, 'yes')]).value === 'yes'
    && resolve('hoyer_lift.competency', []).value === null)
  t('idempotency: same client_token derives the same event id',
    eventIdFor('7', 'tk-same') === eventIdFor('7', 'tk-same') && eventIdFor('7', 'a') !== eventIdFor('7', 'b'))
  t('recorder ≠ source: validated event keeps source_person verbatim, recorder supplied at write',
    validate({ event: { axiscare_id: '7', type: 'reference_response', source_person: 'Former supervisor Jane', client_token: 'tk4' },
      links: [{ claim: 'hoyer_lift.experience', asserts: 'yes' }] }).event!.source_person === 'Former supervisor Jane')
  t('registry version present', /^\d+\.\d+\.\d+$/.test(REGISTRY_VERSION))
  const entries = [E(iv, 'lots'), E(rf, 'yes')]
  const a1 = resolve('hoyer_lift.experience', entries), a2 = resolve('hoyer_lift.experience', entries)
  t('recompute is deterministic — identical output from identical evidence', JSON.stringify(a1) === JSON.stringify(a2))
  t('unknown occurred date carried honestly',
    resolve('hoyer_lift.experience', [E(ev('e19', 'legacy_unspecified', '2026-09-01T10:00Z'), 'yes')]).last_evidence_precision === 'unknown')
  t('legacy_unspecified may support experience but flags nothing public (registry holds no public templates at all)',
    V('legacy_unspecified', [{ claim: 'dementia_care.experience', asserts: 'yes' }]).ok
    && !Object.values(REGISTRY).some((d) => (d as unknown as { public_templates?: unknown[] }).public_templates?.length))
  t('empty foundation: resolving with zero evidence yields no value and no invented state',
    resolve('dementia_care.experience', []).value === null && resolve('dementia_care.experience', []).state === 'current')
  return { registry_version: REGISTRY_VERSION, total: n, passed: n - fails.length, failures: fails }
}

export function eventIdFor(axid: string, clientToken: string): string {
  let h = 5381
  const s = axid + '|' + clientToken
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return 'cev_' + axid + '_' + h.toString(36)
}

// ─── SERVE (Deno only) ───────────────────────────────────────────────────────
// deno-lint-ignore no-explicit-any
declare const Deno: any
if (typeof Deno !== 'undefined' && Deno?.serve) {
  const { createClient } = await import('npm:@supabase/supabase-js@2')
  const K_EV = 'caregiver_evidence_events', K_LN = 'caregiver_claim_links', K_CL = 'caregiver_claims'
  const sb = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const role = (req: Request) => {
    try { return String(JSON.parse(atob((req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').split('.')[1] ?? ''))?.role ?? '') }
    catch { return '' } }
  const email = (req: Request) => {
    try { return String(JSON.parse(atob((req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').split('.')[1] ?? ''))?.email ?? 'service') }
    catch { return 'service' } }
  // deno-lint-ignore no-explicit-any
  const items = async (key: string): Promise<any[]> => {
    const { data } = await sb().from('app_data').select('data').eq('key', key).maybeSingle()
    return Array.isArray(data?.data) ? data!.data : []
  }
  const put = (key: string, item: Record<string, unknown>) =>
    sb().rpc('upsert_app_data_item', { target_key: key, item })

  async function recompute(axid: string) {
    const evs = (await items(K_EV)).filter(e => String(e.axiscare_id) === axid)
    const lns = (await items(K_LN)).filter(l => String(l.axiscare_id) === axid)
    const byClaim: Record<string, Entry[]> = {}
    for (const l of lns) {
      const e = evs.find(x => x.id === l.event_id); if (!e) continue
      ;(byClaim[l.claim] ??= []).push({ event: e, asserts: l.asserts ?? null, note: l.note ?? '' })
    }
    const claims = []
    for (const [claim, entries] of Object.entries(byClaim)) {
      const r = resolve(claim, entries)
      const item = { id: `clm_${axid}_${claim}`, axiscare_id: axid, claim, ...r,
        registry_version: REGISTRY_VERSION, updated_at: new Date().toISOString() }
      await put(K_CL, item); claims.push(item)
    }
    return claims
  }

  Deno.serve(async (req: Request) => {
    const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
    const url = new URL(req.url)
    if (req.method === 'GET' && url.searchParams.get('selftest') === '1') return json(runSelftest())
    if (req.method === 'GET' && url.searchParams.get('definitions') === '1')
      return json({ registry_version: REGISTRY_VERSION, event_types: EVENT_TYPES, registry: REGISTRY })
    const r = role(req)
    if (r !== 'service_role' && r !== 'authenticated') return json({ error: 'sign in required' }, 403)
    // deno-lint-ignore no-explicit-any
    let body: any = {}
    try { body = await req.json() } catch { return json({ error: 'JSON body required' }, 400) }

    if (body?.rebuild_check?.axiscare_id) {
      const axid = String(body.rebuild_check.axiscare_id)
      const stored = (await items(K_CL)).filter(c => String(c.axiscare_id) === axid)
      const rebuilt = await recompute(axid)
      const diff = rebuilt.filter(rb => {
        const st = stored.find(s => s.id === rb.id)
        return !st || st.value !== rb.value || st.state !== rb.state
          || JSON.stringify(st.derived_from) !== JSON.stringify(rb.derived_from)
      })
      return json({ ok: diff.length === 0, axiscare_id: axid, stored: stored.length, rebuilt: rebuilt.length, drift: diff })
    }

    if (body?.probe_roundtrip === true) {
      if (r !== 'service_role') return json({ error: 'service role required for the probe' }, 403)
      /* DEPLOYMENT PROBE ONLY: exercises the full real write path for reserved
         id 0, verifies readback, then removes its three items so the
         foundation stays provably EMPTY. Not caregiver knowledge; never used
         outside deploy proof. */
      const v = validate({ event: { axiscare_id: '0', type: 'legacy_unspecified', source_person: '',
        client_token: 'foundation-probe', note: 'deploy probe — removed in the same call' },
        links: [{ claim: 'dementia_care.experience', asserts: 'yes' }] })
      if (!v.ok) return json({ probe: 'validate failed', errors: v.errors }, 500)
      const id = eventIdFor('0', 'foundation-probe')
      await put(K_EV, { id, ...v.event!, recorded_at: new Date().toISOString(), recorded_by: 'deploy-probe', registry_version: REGISTRY_VERSION })
      await put(K_LN, { id: `cle_${id}_dementia_care.experience`, axiscare_id: '0', event_id: id,
        claim: 'dementia_care.experience', asserts: 'yes', note: '', recorded_at: new Date().toISOString() })
      const claims = await recompute('0')
      const derivedOk = claims.length === 1 && claims[0].value === 'yes'
      for (const key of [K_EV, K_LN, K_CL]) {
        const all = (await items(key)).filter(x => String(x.axiscare_id) !== '0')
        await sb().from('app_data').update({ data: all, updated_at: new Date().toISOString() }).eq('key', key)
      }
      const counts = { events: (await items(K_EV)).length, links: (await items(K_LN)).length, claims: (await items(K_CL)).length }
      return json({ probe: 'ok', wrote_and_derived: derivedOk, removed: true, final_counts: counts })
    }

    // ── the one real write path: event + links only ──
    const v = validate(body)
    if (!v.ok) return json({ ok: false, refused: true, errors: v.errors }, 422)
    const axid = v.event!.axiscare_id
    const id = eventIdFor(axid, v.event!.client_token)
    const existing = (await items(K_EV)).find(e => e.id === id)
    if (existing) return json({ ok: true, duplicate: true, event_id: id, note: 'idempotent replay — nothing new was written' })
    const stamp = new Date().toISOString()
    /* recorded_by = the human creating THIS Evidence Foundation event (her
       rule: never conflated with the source, never with whoever documented
       the underlying record). An authenticated caller is always themselves;
       a service-role caller (her deliberately-run scripts) must state the
       human recorder explicitly — the service is never the recorder. */
    const recorder = (r === 'service_role' && typeof body.recorded_by === 'string' && body.recorded_by.trim())
      ? body.recorded_by.trim() : email(req)
    await put(K_EV, { id, ...v.event!, recorded_at: stamp, recorded_by: recorder, registry_version: REGISTRY_VERSION })
    for (const l of v.links!)
      await put(K_LN, { id: `cle_${id}_${l.claim}`, axiscare_id: axid, event_id: id,
        claim: l.claim, asserts: l.asserts, note: l.note, recorded_at: stamp })
    const claims = await recompute(axid)
    return json({ ok: true, event_id: id, links: v.links!.length,
      claims: claims.map(c => ({ claim: c.claim, value: c.value, state: c.state })) })
  })
}
