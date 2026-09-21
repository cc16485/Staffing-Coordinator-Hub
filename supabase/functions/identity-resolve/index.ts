// Supabase Edge Function: identity-resolve  (shared hub project)
// -----------------------------------------------------------------------------
// The service wrapper around the identity door (identity-door.sql):
// person_resolve_or_create / person_attach_source. DARK deployment (PG-2.i2):
// no production caller exists yet; the future interview-session function is
// its first intended client.
//
// AUTHORIZATION, fail closed at every layer:
//   * platform verify_jwt: a valid project JWT is required to reach us at all;
//   * this handler then requires role === 'service_role'. authenticated and
//     anon callers are refused (403) whatever they send. Browsers never call
//     this function, directly or indirectly;
//   * the request must name a registered workflow from WORKFLOWS below and an
//     acting_staff identity for the audit. Unknown workflow -> refused. This
//     is the wrapper-level capability: holding the service key alone is not
//     enough to use the door anonymously or for an unregistered purpose;
//   * the SQL functions repeat authorization independently (EXECUTE is
//     service_role-only) and own the authoritative-source allowlist, so a
//     bug here cannot widen the door.
//
// The wrapper never chooses person ids, never writes tables directly, and
// holds no identity logic: it validates shape, calls the SQL door, returns
// the outcome. Identity truth lives in one place.
//
// CORS headers are included from day one per standing rule, even though no
// browser is ever authorized: an OPTIONS or cross-origin probe gets clean
// refusals rather than opaque failures.
//
// GET ?selftest=1 runs the pure-core fixtures (no database access).
// Deploy: supabase functions deploy identity-resolve   (verify_jwt ON)
// -----------------------------------------------------------------------------

export const DOOR_VERSION = '1.0.0'

// Registered workflows: the wrapper-level capability allowlist. Additions are
// deliberate code changes, reviewed like any other authorization change.
export const WORKFLOWS = ['interview_session', 'identity_remediation', 'deploy_probe'] as const

// Mirrors of the SQL-side authoritative allowlists, used only to refuse early
// with a clear message. The SQL functions enforce independently.
export const RESOLVE_SOURCES = [['hub', 'job_applicant']] as const
export const ATTACH_SOURCES = [['axiscare', 'caregiver']] as const

export type Validated =
  | { ok: true; op: 'resolve_or_create' | 'attach_source' | 'resolve_historical'; args: Record<string, unknown> }
  | { ok: false; status: number; error: string }

// resolve_historical accepts NOTHING identity-bearing from the caller. The
// approved stored ruling and live AxisCare are the only identity sources.
export const HISTORICAL_FORBIDDEN = [
  'person_id', 'axiscare_id', 'caregiver_id', 'system', 'entity_type', 'source_id',
  'name', 'first_name', 'last_name', 'display_name', 'phone', 'email',
  'ghl_contact_id', 'hire_intake_id', 'approved_by', 'approved_at', 'basis',
  'method', 'evidence', 'attestation', 'ax_verified_epoch', 'verified',
] as const

export function validate(body: Record<string, unknown>): Validated {
  const op = String(body.op ?? '')
  if (op !== 'resolve_or_create' && op !== 'attach_source' && op !== 'resolve_historical')
    return { ok: false, status: 400, error: 'op must be resolve_or_create, attach_source or resolve_historical' }

  const workflow = String(body.workflow ?? '')
  if (!(WORKFLOWS as readonly string[]).includes(workflow))
    return { ok: false, status: 403, error: 'workflow is not registered; the door is not a general-purpose endpoint' }

  const acting = String(body.acting_staff ?? '').trim()
  if (!acting) return { ok: false, status: 400, error: 'acting_staff is required for the audit record' }

  if (op === 'resolve_historical') {
    const supplied = HISTORICAL_FORBIDDEN.filter((k) => k in body)
    if (supplied.length)
      return { ok: false, status: 400,
               error: 'callers may not supply identity for a historical resolution: ' + supplied.join(', ') }
    const rid = String(body.resolution_id ?? '').trim()
    if (!rid) return { ok: false, status: 400, error: 'resolution_id is required' }
    return { ok: true, op, args: { resolution_id: rid, workflow, acting_staff: acting } }
  }

  const system = String(body.system ?? '')
  const entity = String(body.entity_type ?? '')
  const source = String(body.source_id ?? '').trim()
  if (!system || !entity || !source)
    return { ok: false, status: 400, error: 'system, entity_type and source_id are required' }
  if (system === 'ghl')
    return { ok: false, status: 400, error: 'GHL is never an identity authority' }

  if (op === 'resolve_or_create') {
    if (!RESOLVE_SOURCES.some(([s, e]) => s === system && e === entity))
      return { ok: false, status: 400, error: 'source type is not on the authoritative allowlist' }
    // person_id may NEVER be chosen by the caller.
    if ('person_id' in body)
      return { ok: false, status: 400, error: 'callers may not choose a person_id; the server owns identity' }
    return { ok: true, op, args: {
      p_system: system, p_entity_type: entity, p_source_id: source,
      p_display_name: body.display_name ?? null,
      p_first: body.first_name ?? null, p_last: body.last_name ?? null,
      p_phone: body.phone ?? null, p_email: body.email ?? null,
      p_workflow: workflow, p_acting_staff: acting,
      p_evidence: body.evidence ?? null,
    } }
  }

  // attach_source
  if (!ATTACH_SOURCES.some(([s, e]) => s === system && e === entity))
    return { ok: false, status: 400, error: 'source type is not on the attach allowlist' }
  const person = String(body.person_id ?? '').trim()
  if (!person) return { ok: false, status: 400, error: 'person_id (the existing canonical person) is required for attach' }
  const evidence = String(body.evidence ?? '').trim()
  if (!evidence) return { ok: false, status: 400, error: 'evidence text is required to attach a source identity' }
  return { ok: true, op, args: {
    p_person_id: person, p_system: system, p_entity_type: entity, p_source_id: source,
    p_evidence: evidence, p_workflow: workflow, p_acting_staff: acting,
  } }
}

export function jwtRole(authHeader: string | null): string | null {
  const m = /^Bearer\s+(.+)$/.exec(authHeader ?? '')
  if (!m) return null
  const parts = m[1].split('.')
  if (parts.length !== 3) return null
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    return typeof payload.role === 'string' ? payload.role : null
  } catch { return null }
}

export function runSelftest(): { pass: number; fail: number; failures: string[] } {
  let pass = 0; const failures: string[] = []
  const t = (name: string, cond: boolean) => { if (cond) pass++; else failures.push(name) }
  const base = { workflow: 'interview_session', acting_staff: 'krystal@mo-care.com',
                 system: 'hub', entity_type: 'job_applicant', source_id: 'abc' }

  t('resolve op accepted', validate({ ...base, op: 'resolve_or_create' }).ok)
  t('unknown op refused', !validate({ ...base, op: 'mint_person' }).ok)
  t('unregistered workflow refused',
    !validate({ ...base, op: 'resolve_or_create', workflow: 'anything_i_want' }).ok)
  t('missing acting_staff refused',
    !validate({ ...base, op: 'resolve_or_create', acting_staff: '' }).ok)
  t('GHL refused as authority',
    !validate({ ...base, op: 'resolve_or_create', system: 'ghl', entity_type: 'contact' }).ok)
  t('hub/applicant (candidates namespace) refused for resolve',
    !validate({ ...base, op: 'resolve_or_create', entity_type: 'applicant' }).ok)
  t('axiscare/caregiver refused for resolve (attach-only)',
    !validate({ ...base, op: 'resolve_or_create', system: 'axiscare', entity_type: 'caregiver' }).ok)
  t('caller-supplied person_id refused on resolve',
    !validate({ ...base, op: 'resolve_or_create', person_id: 'x' }).ok)
  t('attach requires person_id',
    !validate({ ...base, op: 'attach_source', system: 'axiscare', entity_type: 'caregiver' }).ok)
  t('attach requires evidence',
    !validate({ ...base, op: 'attach_source', system: 'axiscare', entity_type: 'caregiver', person_id: 'p' }).ok)
  t('attach accepted with person + evidence',
    validate({ ...base, op: 'attach_source', system: 'axiscare', entity_type: 'caregiver',
               person_id: 'p', evidence: 'approved ruling hires_599' }).ok)
  t('attach of hub/job_applicant refused (resolve-only namespace)',
    !validate({ ...base, op: 'attach_source', person_id: 'p', evidence: 'e' }).ok)
  t('resolve_historical accepted with resolution_id only',
    validate({ op: 'resolve_historical', workflow: 'identity_remediation',
               acting_staff: 'samantha@mo-care.com', resolution_id: 'hires_598' }).ok)
  t('resolve_historical without resolution_id refused',
    !validate({ op: 'resolve_historical', workflow: 'identity_remediation', acting_staff: 's' }).ok)
  t('resolve_historical refuses caller-supplied person_id',
    !validate({ op: 'resolve_historical', workflow: 'identity_remediation',
                acting_staff: 's', resolution_id: 'hires_598', person_id: 'x' }).ok)
  t('resolve_historical refuses caller-supplied name/display identity',
    !validate({ op: 'resolve_historical', workflow: 'identity_remediation',
                acting_staff: 's', resolution_id: 'hires_598', first_name: 'A', display_name: 'B' }).ok)
  t('resolve_historical refuses caller-supplied caregiver id',
    !validate({ op: 'resolve_historical', workflow: 'identity_remediation',
                acting_staff: 's', resolution_id: 'hires_598', caregiver_id: '598' }).ok)
  t('resolve_historical refuses caller-supplied attestation/verification',
    !validate({ op: 'resolve_historical', workflow: 'identity_remediation',
                acting_staff: 's', resolution_id: 'hires_598', attestation: 'aa', verified: true }).ok)
  t('resolve_historical refuses phone/email/approval fields',
    !validate({ op: 'resolve_historical', workflow: 'identity_remediation',
                acting_staff: 's', resolution_id: 'hires_598', phone: '1', email: 'e', approved_by: 'me' }).ok)
  t('resolve_historical refuses unregistered workflow',
    !validate({ op: 'resolve_historical', workflow: 'whatever',
                acting_staff: 's', resolution_id: 'hires_598' }).ok)
  t('jwtRole parses service_role', jwtRole('Bearer x.' + btoa(JSON.stringify({ role: 'service_role' })) + '.y') === 'service_role')
  t('jwtRole parses authenticated', jwtRole('Bearer x.' + btoa(JSON.stringify({ role: 'authenticated' })) + '.y') === 'authenticated')
  t('jwtRole handles garbage', jwtRole('Bearer nonsense') === null)
  t('jwtRole handles missing header', jwtRole(null) === null)
  return { pass, fail: failures.length, failures }
}

// ── Deno handler (guarded so the pure core stays node-testable) ──────────────
declare const Deno: { serve: (h: (req: Request) => Promise<Response> | Response) => void; env: { get: (k: string) => string | undefined } } | undefined

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

if (typeof Deno !== 'undefined' && Deno?.serve) {
  Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })

    if (req.method === 'GET' && new URL(req.url).searchParams.get('selftest') === '1') {
      const r = runSelftest()
      return json({ door_version: DOOR_VERSION, ...r }, r.fail === 0 ? 200 : 500)
    }

    // Layer 1: only service_role may use the door. Fail closed.
    const role = jwtRole(req.headers.get('authorization'))
    if (role !== 'service_role')
      return json({ error: 'identity door: service_role required; this endpoint is never for browsers' }, 403)

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return json({ error: 'a JSON body is required' }, 400)

    const v = validate(body as Record<string, unknown>)
    if (!v.ok) return json({ error: v.error }, v.status)

    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2')
    const sb = createClient(Deno!.env.get('SUPABASE_URL')!, Deno!.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    if (v.op === 'resolve_historical') {
      // The wrapper owns the live-AxisCare half of the trust boundary.
      const rid = String(v.args.resolution_id)
      const audit = (outcome: string, source_id: string, detail: string) =>
        sb.from('identity_door_audit').insert({
          op: 'resolve_historical', workflow: v.args.workflow, acting_staff: v.args.acting_staff,
          system: 'axiscare', entity_type: 'caregiver', source_id, outcome, detail })

      const { data: row } = await sb.from('app_data').select('data')
        .eq('key', 'hiring_identity_resolutions').maybeSingle()
      const recs: unknown[] = Array.isArray(row?.data) ? row!.data as unknown[] : []
      const rec = recs.find((r) => (r as Record<string, unknown>)?.id === rid) as Record<string, unknown> | undefined
      if (!rec) {
        await audit('invalid_resolution', '', 'no such approved resolution: ' + rid)
        return json({ outcome: 'invalid_resolution', detail: 'no such approved resolution' }, 404)
      }
      const axid = String(rec.axiscare_id ?? '')
      if (!/^\d+$/.test(axid)) {
        await audit('invalid_resolution', axid, 'resolution carries no numeric axiscare_id')
        return json({ outcome: 'invalid_resolution', detail: 'resolution carries no numeric axiscare_id' }, 422)
      }

      // Live authoritative existence check, the proven census contract
      // (paginated GET; ANY failure fails closed; the stale hub cache is
      // deliberately never consulted).
      const token = ['AXISCARE_API_KEY', 'AXISCARE_TOKEN', 'AXISCARE_VISITS_TOKEN']
        .map((n) => Deno!.env.get(n)).find(Boolean)
      const site = Deno!.env.get('AXISCARE_SITE') || Deno!.env.get('AXISCARE_SITE_NUMBER') || ''
      if (!token || !/^\d+$/.test(site)) {
        await audit('invalid_resolution', axid, 'axiscare credentials unavailable; failing closed')
        return json({ outcome: 'invalid_resolution', detail: 'axiscare unreachable; failing closed' }, 502)
      }
      let found: Record<string, unknown> | null = null
      let url: string | null = `https://${site}.axiscare.com/api/caregivers`
      let pages = 0
      while (url && pages < 20 && !found) {
        pages++
        const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json',
          'X-AxisCare-Api-Version': Deno!.env.get('AXISCARE_API_VERSION') || '2023-10-01' } }).catch(() => null)
        if (!r || !r.ok) {
          await audit('invalid_resolution', axid, `axiscare responded ${r ? r.status : 'network error'}; failing closed`)
          return json({ outcome: 'invalid_resolution', detail: 'axiscare unreachable; failing closed' }, 502)
        }
        // deno-lint-ignore no-explicit-any
        const j: any = await r.json().catch(() => ({}))
        const rows = j?.results?.caregivers ?? j?.caregivers ?? []
        for (const g of Array.isArray(rows) ? rows : []) {
          if (String(g?.id ?? '') === axid) { found = g; break }
        }
        url = j?.results?.nextPage ?? j?.nextPage ?? j?.results?.nextPageUrl ?? j?.nextPageUrl ?? null
      }
      if (!found) {
        await audit('invalid_resolution', axid, 'caregiver not found in live AxisCare; failing closed')
        return json({ outcome: 'invalid_resolution', detail: 'caregiver not found in live AxisCare' }, 404)
      }
      const first = String(found.firstName ?? found.first_name ?? found.first ?? '').trim()
      const last = String(found.lastName ?? found.last_name ?? found.last ?? '').trim()

      // The attestation binds ruling id, caregiver id, the authoritative
      // name, and the moment of verification under AXIS_ATTEST_KEY.
      const attKey = Deno!.env.get('AXIS_ATTEST_KEY') ?? ''
      if (!attKey) {
        await audit('invalid_resolution', axid, 'attestation key unavailable; failing closed')
        return json({ outcome: 'invalid_resolution', detail: 'door not configured' }, 502)
      }
      const epoch = Math.floor(Date.now() / 1000)
      const enc = new TextEncoder()
      const cryptoKey = await crypto.subtle.importKey('raw', enc.encode(attKey),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      const sig = await crypto.subtle.sign('HMAC', cryptoKey,
        enc.encode(`${rid}|${axid}|${first}|${last}|${epoch}`))
      const attestation = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('')

      const { data, error } = await sb.rpc('person_resolve_historical', {
        p_resolution_id: rid, p_ax_caregiver_id: axid,
        p_ax_first: first || null, p_ax_last: last || null,
        p_ax_verified_epoch: epoch, p_attestation: attestation,
        p_workflow: v.args.workflow, p_acting_staff: v.args.acting_staff,
      })
      if (error) return json({ error: error.message }, 500)
      return json({ door_version: DOOR_VERSION, ...(data as Record<string, unknown>) })
    }

    const fn = v.op === 'resolve_or_create' ? 'person_resolve_or_create' : 'person_attach_source'
    const { data, error } = await sb.rpc(fn, v.args)
    if (error) return json({ error: error.message }, 500)
    return json({ door_version: DOOR_VERSION, ...(data as Record<string, unknown>) })
  })
}
