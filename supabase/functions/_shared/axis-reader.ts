// =============================================================================
// axis-reader.ts · ONE SHARED AXISCARE READER (A, Samantha 2026-10-29: "the hub is not checking in with Axiscare enough").
// About 13 server jobs each called AxisCare on their own; AxisCare answered some with 429 ("too many requests") and the
// read was lost without anyone being told. Every job now calls AxisCare through this one reader, a drop-in for fetch().
//
// Always (switch on or off): every AxisCare call is written to axis_read_log (job, what was read, AxisCare's answer, time),
// so the Hub can show real counts and the before/after can be compared.
// Only with Settings > Shared AxisCare reader on (ops_settings.axis_shared_reader_live):
//   · one global request limit across all jobs (axis_gate_take), urgent scheduling reads first (they may use the reserve);
//   · AxisCare's retry instructions respected: after a 429 nobody calls until the Retry-After time (or 2, 4, 8 ... 60 s);
//   · identical requests combined: one call, the others share its answer (same run, and across jobs via axis_cache);
//   · short-term copies, by how fresh each job needs the answer (her rule 1, scheduling accuracy first):
//       fresh   (Cara: coverage-run, coverage-watch) never a copy for visits, schedules or caregivers. Client records and the
//               reason list may be up to 15 / 60 minutes old (they are not schedule information).
//       live    (timekeeper, late watch) at most 60 seconds old for visits and schedules.
//       display (cards and lists only) 2 minutes for today and later, 10 minutes for past days, 15 for the caregiver list.
//   · a 200 whose body is not readable JSON is a failed read, never an empty list (a partial answer is not a real answer).
// Off, the reader calls AxisCare exactly as before (one call, no retry, no copy), and only writes the log row.
// Writes (POST/PUT/PATCH/DELETE) are never copied and never retried; they still wait their turn under the limit.
// Never throws for a failed read: the job gets AxisCare's real answer (or a 429 the Hub made, marked x-axis-hub-held).
// =============================================================================
// deno-lint-ignore-file no-explicit-any

export type Tier = 'fresh' | 'live' | 'display'
export type Priority = 'urgent' | 'normal' | 'low'
export type ReaderOpts = { job: string; tier: Tier; priority?: Priority; budgetMs?: number }

const MIN = 60_000
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, Math.max(0, ms)))
const chiDay = (ms: number) => new Date(ms).toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)

/** what an AxisCare URL reads */
export function sourceOf(url: string): string {
  let p = ''
  try { p = new URL(url).pathname } catch { return 'other' }
  if (/^\/api\/visits\/modification-reasons/.test(p)) return 'reasons'
  if (/^\/api\/visits\/?$/.test(p)) return 'visits'
  if (/^\/api\/visits\/[^/]+/.test(p)) return 'visit'
  if (/^\/api\/schedules/.test(p)) return 'schedules'
  if (/^\/api\/caregivers/.test(p)) return 'caregivers'
  if (/^\/api\/clients/.test(p)) return 'clients'
  return 'other'
}
export const isAxis = (url: string) => /^https:\/\/[^/]+\.axiscare\.com\/api\//.test(url)

/** how old a copy may be (ms) for this job's tier; 0 = always ask AxisCare */
export function maxAgeMs(tier: Tier, url: string, nowMs: number = Date.now()): number {
  const src = sourceOf(url)
  if (src === 'clients') return 15 * MIN
  if (src === 'reasons') return 60 * MIN
  if (tier === 'fresh') return 0
  if (tier === 'live') return src === 'visits' || src === 'visit' || src === 'schedules' ? MIN : (src === 'caregivers' ? 5 * MIN : 0)
  if (src === 'caregivers') return 15 * MIN
  if (src === 'visits' || src === 'schedules') {
    let end = ''
    try { end = String(new URL(url).searchParams.get('endDate') ?? '').slice(0, 10) } catch { /* */ }
    return end && end < chiDay(nowMs) ? 10 * MIN : 2 * MIN
  }
  if (src === 'visit') return 2 * MIN
  return 0
}

/** Retry-After as seconds (a number of seconds, or an HTTP date); null when absent or unreadable */
export function retryAfterS(h: string | null | undefined, nowMs: number = Date.now()): number | null {
  const v = String(h ?? '').trim()
  if (!v) return null
  if (/^\d+(\.\d+)?$/.test(v)) return Number(v)
  const t = Date.parse(v)
  return Number.isFinite(t) ? Math.max(0, Math.ceil((t - nowMs) / 1000)) : null
}

const ATTEMPTS: Record<Priority, number> = { urgent: 3, normal: 2, low: 1 }
const BUDGET: Record<Priority, number> = { urgent: 30_000, normal: 20_000, low: 8_000 }
const MAX_COPY_BYTES = 512 * 1024
const COPY_WAIT_MS = 4_000

/* module state: an isolate may serve many runs */
let SWITCH: { at: number; on: boolean } | null = null
const MEMO = new Map<string, { at: number; status: number; body: string }>()
const FLIGHT = new Map<string, { at: number; p: Promise<Got> }>()
/** tests only */
export function __axisReset() { SWITCH = null; MEMO.clear(); FLIGHT.clear() }

type Got = { status: number; body: string; headers: Record<string, string>; ok: boolean; held?: boolean; error?: string }
const toResponse = (g: Got, extra: Record<string, string> = {}) =>
  new Response(g.body, { status: g.status || 502, headers: { 'content-type': 'application/json', ...g.headers, ...extra } })

async function switchOn(db: any): Promise<boolean> {
  if (SWITCH && Date.now() - SWITCH.at < MIN) return SWITCH.on
  let on = false
  try {
    const { data } = await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
    on = data?.data?.axis_shared_reader_live === true
  } catch { on = false }
  SWITCH = { at: Date.now(), on }
  return on
}

async function log(db: any, row: Record<string, unknown>) {
  try { await db.from('axis_read_log').insert(row) } catch { /* the log never stops a read */ }
}

const keyOf = (url: string) => url.replace(/^https:\/\/[^/]+/, '')

/** A fetch() that goes through the shared reader. db = the job's service-role client (or a function returning it). */
export function axisReader(dbIn: any, opts: ReaderOpts): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  const priority: Priority = opts.priority ?? (opts.tier === 'fresh' ? 'urgent' : opts.tier === 'live' ? 'normal' : 'low')
  /* the waiting budget is per run; a reader made once for a job's module starts a new budget every 3 minutes */
  let spentWait = 0, budgetFrom = 0
  const budget = opts.budgetMs ?? BUDGET[priority]
  const dbOf = () => (typeof dbIn === 'function' ? dbIn() : dbIn)

  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const send: typeof fetch = (globalThis as any).fetch
    if (!isAxis(url)) return send(input as any, init)
    if (Date.now() - budgetFrom > 3 * MIN) { budgetFrom = Date.now(); spentWait = 0 }
    const db = dbOf()
    const method = String(init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const source = sourceOf(url)
    const base = { job: opts.job, source, priority, method }
    const live = await switchOn(db)

    /* switch off: exactly the old call, plus the log row */
    if (!live) {
      const t0 = Date.now()
      try {
        const r = await send(input as any, init)
        await log(db, { ...base, status: r.status, ok: r.ok, ms: Date.now() - t0, live: false,
          retry_after_s: r.status === 429 ? retryAfterS(r.headers.get('retry-after')) : null })
        return r
      } catch (e) {
        await log(db, { ...base, status: null, ok: false, ms: Date.now() - t0, live: false, error: String((e as Error)?.message ?? e).slice(0, 200) })
        throw e
      }
    }

    /* one call to AxisCare under the limit, with AxisCare's retry rules */
    const call = async (): Promise<Got> => {
      const tries = method === 'GET' ? ATTEMPTS[priority] : 1
      let last: Got = { status: 0, body: JSON.stringify({ error: 'AxisCare could not be reached' }), headers: {}, ok: false, error: 'no answer' }
      for (let attempt = 1; attempt <= tries; attempt++) {
        /* wait for a slot (the Hub's limit, or AxisCare's "wait") */
        let waited = 0
        for (;;) {
          let gate: any = null
          try { const { data, error } = await db.rpc('axis_gate_take', { p_priority: priority }); gate = error ? null : data } catch { gate = null }
          if (!gate || gate.ok !== false) break           /* the gate could not be asked: go (a database hiccup never blocks AxisCare) */
          const w = Math.max(50, Number(gate.wait_ms) || 500)
          if (spentWait + w > budget) {
            const why = gate.why === 'axiscare_asked_to_wait' ? 'AxisCare asked the Hub to wait' : 'the Hub\'s AxisCare limit was full'
            await log(db, { ...base, status: 429, ok: false, held: true, live: true, attempt, waited_ms: waited, error: `held: ${why}` })
            return { status: 429, ok: false, held: true, headers: { 'x-axis-hub-held': '1' },
              body: JSON.stringify({ error: `${why}; this read was not made. It is tried again on the next run.` }), error: why }
          }
          await sleep(w); waited += w; spentWait += w
        }
        const t0 = Date.now()
        let status = 0, body = '', headers: Record<string, string> = {}, err = ''
        try {
          const r = await send(input as any, init)
          status = r.status; body = await r.text()
          r.headers.forEach((v, k) => { if (k === 'retry-after' || k === 'content-type') headers[k] = v })
        } catch (e) { err = String((e as Error)?.message ?? e).slice(0, 200) }
        const ra = status === 429 ? retryAfterS(headers['retry-after']) : null
        /* a 200 that is not readable JSON is a failed read (partial or broken answer) */
        if (status >= 200 && status < 300 && method === 'GET') {
          try { JSON.parse(body) } catch { err = 'AxisCare sent an answer the Hub could not read (cut off or broken)'; status = 502 }
        }
        const ok = status >= 200 && status < 400 && !err
        await log(db, { ...base, status: status || null, ok, ms: Date.now() - t0, attempt, waited_ms: waited, live: true, retry_after_s: ra, error: err || null })
        try { await db.rpc('axis_gate_report', { p_status: status, p_retry_after_s: ra }) } catch { /* */ }
        last = ok ? { status, body, headers, ok }
          : { status: status || 502, body: err ? JSON.stringify({ error: err }) : body, headers, ok: false, error: err || `AxisCare answered ${status}` }
        if (ok) return last
        const retryable = status === 429 || status === 0 || status >= 500
        if (!retryable || attempt >= tries) return last
        if (status !== 429) {                          /* 429s wait at the gate (AxisCare's own time); others a short pause */
          const pause = 1000 * attempt
          if (spentWait + pause > budget) return last
          await sleep(pause); spentWait += pause
        }
      }
      return last
    }

    if (method !== 'GET') return toResponse(await call())

    const age = maxAgeMs(opts.tier, url)
    const key = keyOf(url)
    const now = Date.now()
    /* 1 · a copy young enough for this job */
    if (age > 0) {
      const m = MEMO.get(key)
      if (m && now - m.at <= age) {
        await log(db, { ...base, status: m.status, ok: true, from_cache: true, live: true })
        return toResponse({ status: m.status, body: m.body, headers: {}, ok: true }, { 'x-axis-copy-age-s': String(Math.round((now - m.at) / 1000)) })
      }
    }
    /* 2 · the same read already under way in this run: share it (fresh reads too, if it started in the last 5 s) */
    const f = FLIGHT.get(key)
    if (f && (age > 0 || now - f.at <= 5000)) {
      const g = await f.p
      await log(db, { ...base, status: g.status, ok: g.ok, coalesced: true, live: true })
      return toResponse(g)
    }
    const p = (async (): Promise<Got> => {
      const owner = crypto.randomUUID()
      let leased = false
      if (age > 0) {
        /* 3 · another job's copy, or wait for the job reading it right now */
        const fromCopy = async (): Promise<Got | null> => {
          try {
            const { data } = await db.from('axis_cache').select('body,status,fetched_at').eq('key', key).maybeSingle()
            const at = data?.fetched_at ? Date.parse(data.fetched_at) : NaN
            if (data?.body != null && Number.isFinite(at) && Date.now() - at <= age) return { status: Number(data.status) || 200, body: String(data.body), headers: { 'x-axis-copy-age-s': String(Math.round((Date.now() - at) / 1000)) }, ok: true }
          } catch { /* */ }
          return null
        }
        const c = await fromCopy()
        if (c) { await log(db, { ...base, status: c.status, ok: true, from_cache: true, live: true }); return c }
        try { const { data } = await db.rpc('axis_cache_lease', { p_key: key, p_owner: owner, p_ttl_s: 15 }); leased = data === true } catch { leased = false }
        if (!leased) {
          for (let w = 0; w < COPY_WAIT_MS; w += 500) {
            await sleep(500)
            const c2 = await fromCopy()
            if (c2) { await log(db, { ...base, status: c2.status, ok: true, coalesced: true, live: true }); return c2 }
          }
        }
      }
      const g = await call()
      if (age > 0) {
        if (g.ok && g.body.length <= MAX_COPY_BYTES) {
          try { await db.rpc('axis_cache_put', { p_key: key, p_owner: owner, p_body: g.body, p_status: g.status }) } catch { /* */ }
        } else if (leased) { try { await db.rpc('axis_cache_release', { p_key: key, p_owner: owner }) } catch { /* */ } }
      }
      return g
    })()
    FLIGHT.set(key, { at: now, p })
    try {
      const g = await p
      if (g.ok && age > 0 && g.body.length <= MAX_COPY_BYTES) MEMO.set(key, { at: Date.now(), status: g.status, body: g.body })
      if (MEMO.size > 200) MEMO.delete(MEMO.keys().next().value as string)
      return toResponse(g)
    } finally { if (FLIGHT.get(key)?.p === p) FLIGHT.delete(key) }
  }
}
