// =============================================================================
// contract.ts · THE DOOR (Phase 1, Slice 3, approved 2026-10-11)
// =============================================================================
// A library each contract function imports; not a service in front of them. A function declares its actions (the
// inputs it accepts, what it records) and the wrapper does what every action must do, the same way every time:
//   1. the action must be in the registry (registry.js); anything else is refused
//   2. who may call it comes from action_authority (owner-controlled, every change logged), never from the code
//   3. the caller: a signed-in Caring Companions office member, resolved from the sign-in (requireStaff), never from
//      the request. An AI employee has no sign-in and no authority yet: anything claiming to be one is refused.
//   4. the inputs: a field the action did not declare is REFUSED by name; a declared field of the wrong type too
//   5. a read runs and answers; nothing is recorded (reads are not events)
//   6. a change takes the once-only lock FIRST: a 'started' row with the request id (one per id, enforced by the
//      database, 578). A repeat of the same id does nothing and answers with the first answer, plus already: true.
//      If the record cannot be written, nothing is done.
//   7. the function body runs (it decides and writes, exactly as before)
//   8. one outcome row: done, refused (with the reason) or failed, the real person, the action, pointers (ids) to
//      what was written. Never a value: the answer kept is ids and outcome words only.
//   9. the answer is the function's own answer, unchanged, plus the request id
// Nothing here contacts anyone.
// =============================================================================
import { requireStaff } from './staff-auth.ts'
import './registry.js'
import './verbs.js'

// deno-lint-ignore-file no-explicit-any
type SB = any
const REG: any = (globalThis as any).CC_REGISTRY
const VERBS: any = (globalThis as any).CC_VERBS

export type Field = { type: 'text' | 'uuid' | 'instant' | 'bool' | 'int_list' | 'text_list' | 'any' }
export type Actor = { kind: 'person'; email: string; name: string; first: string; person_id: string; roles: string[]; via: string }
export type Answer = { status?: number; body: Record<string, any> }
export type Ctx = { input: Record<string, any>; actor: Actor; requestId: string }
export type ActionDef = {
  inputs: Record<string, Field>
  run: (ctx: Ctx) => Promise<Answer>
  verb?: string                                                   // the outcome row's verb when done (mutating only)
  item?: (input: Record<string, any>, a: Answer) => string
  evidence?: (input: Record<string, any>, a: Answer) => Array<{ kind: string; id: string }>
  keep?: (a: Answer) => Record<string, unknown>                   // ids and outcome words only, never values
  data?: (input: Record<string, any>) => Record<string, unknown>  // field names and categories only, never values
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cc-via, x-cc-employee',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
export const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const RID = /^[A-Za-z0-9_.:-]{8,80}$/
const VIA = ['hub', 'phone', 'link']

/** Is v acceptable for this declared field? null and undefined always are (the body decides what is required). */
export function fieldOk(f: Field, v: unknown): boolean {
  if (v === null || v === undefined) return true
  switch (f.type) {
    case 'any': return true
    case 'text': return typeof v === 'string'
    case 'uuid': return v === '' || (typeof v === 'string' && UUID.test(v))
    case 'instant': return v === '' || (typeof v === 'string' && !isNaN(Date.parse(v)))
    case 'bool': return typeof v === 'boolean'
    case 'int_list': return Array.isArray(v) && v.every((x) => (typeof x === 'number' || (typeof x === 'string' && /^\d+$/.test(x))))
    case 'text_list': return Array.isArray(v) && v.every((x) => typeof x === 'string')
  }
  return false
}

/** The inputs against the declaration: the first undeclared or wrongly typed field, or null when all is well. */
export function checkInputs(inputs: Record<string, Field>, b: Record<string, unknown>): { reason: string; field: string } | null {
  for (const k of Object.keys(b)) {
    if (k === 'action' || k === 'request_id') continue
    if (!Object.prototype.hasOwnProperty.call(inputs, k)) return { reason: 'unknown_field', field: k }
    if (!fieldOk(inputs[k], b[k])) return { reason: 'bad_field', field: k }
  }
  return null
}

/** done / refused / failed, from the function's own answer. */
export function outcomeOf(a: Answer): 'done' | 'refused' | 'failed' {
  if ((a.status ?? 200) >= 500 || (a.body?.error && !a.body?.outcome)) return 'failed'
  if (a.body?.outcome === 'refused' || (a.status ?? 200) >= 400) return 'refused'
  return 'done'
}

/** Serve a contract: name like 'client_fact' (the registry prefix), its actions, the service client. */
export function serveContract(name: string, actions: Record<string, ActionDef>, sb: SB, opts: { defaultAction?: string } = {}) {
  const names = Object.keys(actions)
  for (const a of names) if (!REG?.get(name + '.' + a)) throw new Error(`contract ${name}: ${a} is not in the registry`)

  async function rec(row: Record<string, unknown>) {
    return await sb.from('op_events').insert(row)
  }

  Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
    const b = await req.json().catch(() => null) as Record<string, any> | null
    if (!b || typeof b !== 'object' || Array.isArray(b)) return json({ error: 'the request must be a JSON object' }, 400)
    const act = typeof b.action === 'string' && b.action ? b.action : (opts.defaultAction || '')
    const def = Object.prototype.hasOwnProperty.call(actions, act) ? actions[act] : null
    const key = name + '.' + act, reg = def ? REG.get(key) : null
    if (!def || !reg) return json({ error: 'action must be ' + names.map((x) => "'" + x + "'").join(', ') }, 400)

    // an AI employee has no sign-in and no authority yet (Slice 3: every employee level is never)
    if (req.headers.get('x-cc-employee')) return json({ outcome: 'refused', reason: 'no_authority', error: 'AI employees have no authority for this action.' }, 403)

    // no sign-in at all: say so first (the full check of the sign-in follows, against the roles the table allows)
    if (!/^Bearer\s+\S/i.test(req.headers.get('Authorization') || '')) return json({ error: 'Sign in first.' }, 401)

    // who may: the authority table, read every call; nothing in the code decides
    let roles: string[] = []
    try {
      const { data, error } = await sb.from('action_authority').select('level, roles')
        .eq('action', key).eq('actor_kind', 'person').eq('actor_id', '').maybeSingle()
      if (error) return json({ error: 'Could not check who may do this.' }, 500)
      if (!data || data.level !== 'allowed' || !Array.isArray(data.roles) || !data.roles.length)
        return json({ outcome: 'refused', reason: 'no_authority', error: 'This action is not open to anyone yet.' }, 403)
      roles = data.roles.map(String)
    } catch { return json({ error: 'Could not check who may do this.' }, 500) }

    const staff = await requireStaff(sb, req, roles)
    if (!staff.ok) return json({ error: staff.error }, staff.status)

    const bad = checkInputs(def.inputs, b)
    if (bad) return json({ outcome: 'refused', reason: bad.reason, field: bad.field,
      error: (bad.reason === 'unknown_field' ? 'unknown field: ' : 'wrong kind of value for: ') + bad.field }, 400)

    const viaH = String(req.headers.get('x-cc-via') || 'hub')
    const actor: Actor = { kind: 'person', email: staff.email, name: staff.name || staff.email.split('@')[0], first: (staff.name || staff.email).split(/[\s@]/)[0],
      person_id: staff.person_id, roles: staff.roles, via: VIA.includes(viaH) ? viaH : 'hub' }
    const input: Record<string, any> = {}
    for (const k of Object.keys(def.inputs)) if (k in b) input[k] = b[k]

    // a read: run, answer, record nothing
    if (!reg.mutating) {
      const a = await def.run({ input, actor, requestId: '' }).catch((e) => ({ status: 500, body: { error: String(e?.message || e) } }))
      return json(a.body, a.status ?? 200)
    }

    // a change: the once-only lock first
    let rid = typeof b.request_id === 'string' ? b.request_id : ''
    if (rid && !RID.test(rid)) return json({ outcome: 'refused', reason: 'bad_field', field: 'request_id', error: 'wrong kind of value for: request_id' }, 400)
    const madeHere = !rid
    if (!rid) rid = 'srv-' + crypto.randomUUID()   // an older open page sends none; it still works, without double-press protection
    const who = { actor_email: actor.email, actor_name: actor.name.slice(0, 120), actor_kind: 'person', actor_id: actor.person_id, via: actor.via }
    const st = await rec({ ...who, verb: 'record_started', item_id: '', area: reg.area, summary: (actor.first + ' started: ' + reg.label).slice(0, 400),
      data: madeHere ? { request_id_made_by_server: true } : {}, action: key, request_id: rid, outcome: 'started', approval: {}, evidence: [] })
      .catch((e: unknown) => ({ error: { code: '', message: String(e) } }))
    if (st?.error) {
      if (st.error.code === '23505') {
        const { data: rows } = await sb.from('op_events').select('outcome, data').eq('request_id', rid).order('id', { ascending: true }).limit(10)
        const first = (rows || []).find((r: any) => r.outcome && r.outcome !== 'started')
        if (first?.data?.answer) return json({ ...first.data.answer, already: true, request_id: rid }, Number(first.data.status) || 200)
        return json({ outcome: 'in_progress', already: true, request_id: rid, message: 'This is already being saved.' }, 200)
      }
      return json({ outcome: 'failed', error: 'The record could not be written, so nothing was done. Try again.' }, 503)
    }

    const a = await def.run({ input, actor, requestId: rid }).catch((e) => ({ status: 500, body: { error: 'not recorded: ' + String(e?.message || e) } }))
    const out = outcomeOf(a)
    const kept = { ...(def.keep ? def.keep(a) : {}), ...(a.body?.outcome ? { outcome: a.body.outcome } : {}), ...(a.body?.reason ? { reason: String(a.body.reason).slice(0, 80) } : {}) }
    const verb = out === 'done' ? (def.verb || 'record_started') : out === 'refused' ? 'action_refused' : 'action_failed'
    const label = VERBS?.label?.(verb) || verb
    await rec({ ...who, verb, item_id: String(def.item ? def.item(input, a) : '').slice(0, 200), area: reg.area,
      summary: (actor.first + ' ' + label + (out === 'done' ? '' : ': ' + reg.label)).slice(0, 400),
      data: { ...(def.data ? def.data(input) : {}), status: a.status ?? 200, answer: kept }, action: key, request_id: rid, outcome: out,
      approval: {}, evidence: out === 'done' && def.evidence ? def.evidence(input, a).slice(0, 20) : [] })
      .catch(() => null)   // the effect already happened; a lost outcome row costs history, and the started row still shows it began
    return json({ ...a.body, request_id: rid }, a.status ?? 200)
  })
}
