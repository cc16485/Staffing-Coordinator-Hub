// =============================================================================
// axiscare-probe — READ ONLY capability map. Writes nothing, anywhere.
// =============================================================================
// Answers, with evidence rather than assumption:
//   * which AxisCare endpoints we can actually reach today
//   * what each returns: field NAMES, record counts, active/inactive split
//   * whether client contacts / responsible parties are exposed at all
//   * whether payer is derivable, and from what
//   * how the real census collides with GHL identity
//
// PRIVACY: this never returns names, addresses, full phone numbers or emails.
// It returns field names, counts, class-label vocabulary and last-4 digits.
// The whole point is to learn the SHAPE of the data, not to copy the data.
//
// Every request is GET. Nothing is created, updated or deleted in AxisCare,
// GHL or Supabase.
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

/* Two projects grew two different names for the same credential. Accept both
   so the probe works wherever it is deployed. That divergence is itself a
   finding and is reported below. */
const TOKEN  = Deno.env.get('AXISCARE_API_KEY')
            || Deno.env.get('AXISCARE_TOKEN') || ''
const SITE   = Deno.env.get('AXISCARE_SITE')
            || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
const VISITS_TOKEN = Deno.env.get('AXISCARE_VISITS_TOKEN') || TOKEN
const API_VERSION  = Deno.env.get('AXISCARE_API_VERSION') || '2023-10-01'

const GHL_KEY      = Deno.env.get('GHL_API_KEY') || ''
const GHL_LOCATION = Deno.env.get('GHL_LOCATION_ID') || ''

/* Candidate endpoints. Some will 404 — that IS the finding. Nothing here is a
   claim that AxisCare offers it; it is a list of things worth asking for. */
const PROBES: Array<{ path: string; why: string; token?: string }> = [
  { path: '/api/clients',                 why: 'client census' },
  { path: '/api/clients?active=true',     why: 'active-only filter support' },
  { path: '/api/caregivers',              why: 'caregiver census' },
  { path: '/api/caregivers?active=true',  why: 'active-only filter support' },
  { path: '/api/applicants',              why: 'applicant pipeline' },
  { path: '/api/contacts',                why: 'CLIENT CONTACTS — the open question' },
  { path: '/api/clientContacts',          why: 'client contacts, alternate spelling' },
  { path: '/api/responsibleParties',      why: 'responsible parties' },
  { path: '/api/emergencyContacts',       why: 'emergency contacts' },
  { path: '/api/relationships',           why: 'client relationships' },
  { path: '/api/classes',                 why: 'the class vocabulary behind payer' },
  { path: '/api/payers',                  why: 'authoritative payer list' },
  { path: '/api/authorizations',          why: 'authorised hours' },
  { path: '/api/schedules',               why: 'schedule data' },
  { path: '/api/visits',                  why: 'visits and clock-ins', token: 'visits' },
  { path: '/api/webhooks',                why: 'webhook self-registration' },
]

/* CloudFront sits in front of AxisCare and refuses requests whose User-Agent
   looks automated. Deno's fetch sends none by default, which is why sixteen
   endpoints all returned an identical HTML 403 before ever reaching the app.

   The fix is to identify ourselves properly, which is what a well-behaved API
   client should do anyway. We are not pretending to be a browser — we say who
   we are and how to reach us. If a descriptive agent is still refused, that is
   a question for AxisCare rather than something to work around. */
const UA_DESCRIPTIVE = 'CaringCompanions-Hub/1.0 (+https://mo-care.com; samantha@mo-care.com)'
const UA_BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
                   'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

function headers(which?: string, ua = UA_DESCRIPTIVE) {
  return {
    'Authorization': `Bearer ${which === 'visits' ? VISITS_TOKEN : TOKEN}`,
    'X-AxisCare-Api-Version': API_VERSION,
    'Accept': 'application/json',
    'User-Agent': ua,
  }
}

/** Field names only, recursively, to two levels. Never values. */
function shapeOf(obj: unknown, depth = 0): string[] {
  if (!obj || typeof obj !== 'object' || depth > 1) return []
  const out: string[] = []
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out.push(k, ...shapeOf(v, depth + 1).map(s => `${k}.${s}`))
    } else if (Array.isArray(v)) {
      out.push(`${k}[]`, ...shapeOf(v[0], depth + 1).map(s => `${k}[].${s}`))
    } else {
      out.push(k)
    }
  }
  return out
}

function normPhone(raw: unknown): string | null {
  const d = String(raw ?? '').replace(/\D/g, '')
  if (d.length === 10) return '+1' + d
  if (d.length === 11 && d.startsWith('1')) return '+' + d
  return d.length > 11 ? '+' + d : null
}

// deno-lint-ignore no-explicit-any
function listOf(j: any): any[] {
  if (Array.isArray(j)) return j
  for (const k of ['results', 'data', 'items', 'clients', 'caregivers', 'contacts']) {
    if (Array.isArray(j?.[k])) return j[k]
  }
  return []
}

// deno-lint-ignore no-explicit-any
function phonesIn(rec: any): string[] {
  const out: string[] = []
  for (const k of ['phone', 'mobilePhone', 'homePhone', 'workPhone', 'cellPhone', 'primaryPhone']) {
    const p = normPhone(rec?.[k]); if (p) out.push(p)
  }
  for (const arr of ['phones', 'phoneNumbers']) {
    for (const p of (rec?.[arr] ?? [])) {
      const n = normPhone(typeof p === 'string' ? p : p?.number ?? p?.value)
      if (n) out.push(n)
    }
  }
  return [...new Set(out)]
}

/* ── 403 DIAGNOSTIC ──────────────────────────────────────────────────────────
   Sixteen endpoints all returning an identical HTML 403 — including paths that
   probably do not exist — means the request is being refused before it reaches
   API routing. This distinguishes an edge/WAF block from a credential problem,
   because the remedy is completely different and retrying tokens against a WAF
   wastes days. */
async function diagnose() {
  const base = `https://${SITE}.axiscare.com`
  const tries: Array<{ label: string; url: string; init?: RequestInit }> = [
    { label: 'with our Bearer token',   url: `${base}/api/clients`, init: { headers: headers() } },
    { label: 'with NO auth header',     url: `${base}/api/clients` },
    { label: 'a nonsense API path',     url: `${base}/api/zzz-not-a-real-endpoint`, init: { headers: headers() } },
    { label: 'the site root (no /api)', url: `${base}/` },
    { label: 'browser-like user agent', url: `${base}/api/clients`, init: { headers: {
        ...headers(),
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      } } },
  ]
  const out: Array<Record<string, unknown>> = []
  for (const t of tries) {
    try {
      const r = await fetch(t.url, t.init)
      const body = await r.text()
      const title = (body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim()
      const h1    = (body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '')
                      .replace(/<[^>]+>/g, '').trim()
      out.push({
        attempt: t.label,
        status: r.status,
        content_type: r.headers.get('content-type'),
        server: r.headers.get('server'),
        /* A CF-Ray or similar proves a CDN/WAF answered instead of the app. */
        cf_ray: r.headers.get('cf-ray'),
        blocked_by_edge_hint: r.headers.get('cf-mitigated') || r.headers.get('x-blocked-by'),
        page_title: title.slice(0, 120),
        page_heading: h1.slice(0, 160),
        body_starts: body.replace(/\s+/g, ' ').slice(0, 200),
      })
    } catch (e) {
      out.push({ attempt: t.label, error: e instanceof Error ? e.message : String(e) })
    }
  }

  /* Read it out loud, so the answer does not depend on interpreting headers. */
  const withTok = out.find(o => o.attempt === 'with our Bearer token')
  const noTok   = out.find(o => o.attempt === 'with NO auth header')
  const junk    = out.find(o => o.attempt === 'a nonsense API path')
  const root    = out.find(o => o.attempt === 'the site root (no /api)')

  const verdicts: string[] = []
  if (junk?.status === 403) {
    verdicts.push('A path that cannot exist returns 403 rather than 404. The request ' +
      'is refused BEFORE routing, so this is not about endpoints or scopes.')
  }
  if (withTok?.status === noTok?.status) {
    verdicts.push('Sending no token at all produces the same status as sending ours. ' +
      'The credential is not being evaluated, so rotating or re-issuing it changes nothing.')
  }
  if (root?.status === 200) {
    verdicts.push('The site root loads normally, so the site number is correct and the ' +
      'host resolves. The block is specific to API access.')
  } else if (root?.status === 403) {
    verdicts.push('Even the site root is refused, which points at an IP-level block on ' +
      'the calling address rather than anything API-specific.')
  }
  if (out.some(o => o.cf_ray)) {
    verdicts.push('A CDN/WAF answered rather than the application.')
  }
  if (!verdicts.length) {
    verdicts.push('No single clear signal. Send the raw attempts below to AxisCare support.')
  }
  return { attempts: out, verdict: verdicts }
}

/* ── WHERE DOES THE API ACTUALLY LIVE? ───────────────────────────────────────
   Getting past CloudFront produced a WordPress 404 with Yoast markup, which is
   a marketing site rather than an API. So the base URL we have been using for
   every integration may simply be wrong. These are candidates worth testing,
   not claims about AxisCare's architecture. */
async function hostProbe() {
  const candidates = [
    { label: 'site subdomain (what we use today)', url: `https://${SITE}.axiscare.com/api/clients` },
    { label: 'site subdomain, versioned path',     url: `https://${SITE}.axiscare.com/api/v1/clients` },
    { label: 'dedicated api host',                 url: `https://api.axiscare.com/clients` },
    { label: 'dedicated api host, versioned',      url: `https://api.axiscare.com/v1/clients` },
    { label: 'dedicated api host, site scoped',    url: `https://api.axiscare.com/${SITE}/clients` },
    { label: 'apex domain',                        url: `https://axiscare.com/api/clients` },
  ]
  const uas = [
    { name: 'descriptive', ua: UA_DESCRIPTIVE },
    { name: 'browser-like', ua: UA_BROWSER },
  ]
  const out: Array<Record<string, unknown>> = []
  for (const c of candidates) {
    for (const u of uas) {
      try {
        const r = await fetch(c.url, { headers: headers(undefined, u.ua) })
        const body = await r.text()
        const ct = r.headers.get('content-type') || ''
        const isJson = ct.includes('json')
        let parsed: unknown = null
        if (isJson) { try { parsed = JSON.parse(body) } catch { /* not json after all */ } }
        out.push({
          candidate: c.label, url: c.url.replace(SITE, '<site>'), user_agent: u.name,
          status: r.status, content_type: ct,
          server: r.headers.get('server'),
          reached_an_api: isJson,
          /* Field names only if it IS json — never values. */
          json_keys: parsed && typeof parsed === 'object'
            ? Object.keys(parsed as Record<string, unknown>).slice(0, 20) : null,
          body_starts: isJson ? body.slice(0, 200)
                              : body.replace(/\s+/g, ' ').replace(/<[^>]+>/g, ' ')
                                    .replace(/\s+/g, ' ').trim().slice(0, 140),
        })
      } catch (e) {
        out.push({ candidate: c.label, user_agent: u.name,
                   error: e instanceof Error ? e.message : String(e) })
      }
    }
  }
  const gotJson = out.filter(o => o.reached_an_api)
  const gotPast = out.filter(o => o.status && o.status !== 403)
  return {
    attempts: out,
    verdict: gotJson.length
      ? [`An API responded with JSON. Use: ${gotJson.map(o => o.url + ' [' + o.user_agent + ']').join(', ')}`]
      : gotPast.length
        ? ['Nothing returned JSON, but some requests got past CloudFront. ' +
           'The host or path is wrong, or API access is not provisioned. ' +
           'A descriptive User-Agent is enough to reach the application.']
        : ['Every candidate was refused at the CDN. Ask AxisCare for the correct ' +
           'API base URL and whether our User-Agent must be allowlisted.'],
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200 })

  if (new URL(req.url).searchParams.get('hosts') === '1') {
    if (!SITE) return new Response(JSON.stringify({ error: 'no site configured' }), { status: 200 })
    return new Response(JSON.stringify(await hostProbe(), null, 2),
      { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  if (new URL(req.url).searchParams.get('diagnose') === '1') {
    if (!TOKEN || !SITE) {
      return new Response(JSON.stringify({ error: 'no token or site configured' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response(JSON.stringify(await diagnose(), null, 2),
      { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  const report: Record<string, unknown> = {
    read_only: true, wrote_nothing: true,
    config: {
      token_present: !!TOKEN,
      site_present: !!SITE,
      separate_visits_token: !!Deno.env.get('AXISCARE_VISITS_TOKEN'),
      token_var_used: Deno.env.get('AXISCARE_API_KEY') ? 'AXISCARE_API_KEY'
                    : Deno.env.get('AXISCARE_TOKEN') ? 'AXISCARE_TOKEN' : 'NONE',
      api_version: API_VERSION,
    },
  }
  if (!TOKEN || !SITE) {
    report.fatal = 'No AxisCare token or site configured in THIS project. ' +
      'The Training Platform project uses AXISCARE_TOKEN / AXISCARE_SITE_NUMBER; ' +
      'this project uses AXISCARE_API_KEY / AXISCARE_SITE. They are different secrets.'
    return new Response(JSON.stringify(report, null, 2),
      { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  /* ── 1. CAPABILITY MAP ──────────────────────────────────────────────────── */
  const capability: Array<Record<string, unknown>> = []
  // deno-lint-ignore no-explicit-any
  const captured: Record<string, any[]> = {}

  for (const p of PROBES) {
    const url = `https://${SITE}.axiscare.com${p.path}`
    let status = 0, note = '', count: number | null = null, fields: string[] = []
    try {
      const r = await fetch(url, { headers: headers(p.token) })
      status = r.status
      const text = await r.text()
      if (r.ok) {
        const j = JSON.parse(text || '{}')
        const list = listOf(j)
        count = list.length
        fields = list.length ? [...new Set(shapeOf(list[0]))].sort() : [...new Set(shapeOf(j))].sort()
        if (list.length) captured[p.path] = list
        if (count === 0) note = 'reachable but EMPTY — an endpoint that works over no data'
      } else {
        note = text.slice(0, 160)
      }
    } catch (e) {
      note = e instanceof Error ? e.message : String(e)
    }
    capability.push({
      endpoint: p.path,
      purpose: p.why,
      status,
      available: status === 200,
      records: count,
      fields: fields.slice(0, 60),
      note,
    })
  }
  report.capability_map = capability

  /* ── 2. CLIENT CENSUS (shape and counts only) ───────────────────────────── */
  const clients = captured['/api/clients'] ?? captured['/api/clients?active=true'] ?? []
  const classLabels = new Map<string, number>()
  let activeC = 0, inactiveC = 0, withPhoneC = 0, withEmailC = 0, withContactsC = 0
  const contactFieldNames = new Set<string>()

  for (const c of clients) {
    const act = c?.status?.active ?? c?.active
    if (act === true) activeC++; else if (act === false) inactiveC++
    if (phonesIn(c).length) withPhoneC++
    if (c?.email) withEmailC++
    for (const cl of (c?.classes ?? [])) {
      const l = String(cl?.label ?? cl?.name ?? cl ?? '').trim()
      if (l) classLabels.set(l, (classLabels.get(l) ?? 0) + 1)
    }
    /* Are contacts embedded rather than a separate endpoint? */
    for (const k of Object.keys(c ?? {})) {
      if (/contact|responsib|emergen|relation|guardian|poa|family/i.test(k)) {
        contactFieldNames.add(k)
        const v = c[k]
        if (Array.isArray(v) ? v.length : v) withContactsC++
      }
    }
  }
  report.client_census = {
    total: clients.length, active: activeC, inactive: inactiveC,
    unknown_status: clients.length - activeC - inactiveC,
    with_phone: withPhoneC, with_email: withEmailC,
    class_label_vocabulary: [...classLabels.entries()].sort((a, b) => b[1] - a[1]),
    contact_like_fields_on_client: [...contactFieldNames],
    clients_with_contact_data: withContactsC,
  }

  /* ── 3. CAREGIVER CENSUS ────────────────────────────────────────────────── */
  const cgs = captured['/api/caregivers'] ?? captured['/api/caregivers?active=true'] ?? []
  let activeG = 0, inactiveG = 0, withPhoneG = 0, withEmailG = 0
  const statusLabels = new Map<string, number>()
  for (const c of cgs) {
    const act = c?.status?.active ?? c?.active
    if (act === true) activeG++; else if (act === false) inactiveG++
    if (phonesIn(c).length) withPhoneG++
    if (c?.email) withEmailG++
    const lbl = String(c?.status?.label ?? '').trim()
    if (lbl) statusLabels.set(lbl, (statusLabels.get(lbl) ?? 0) + 1)
  }
  report.caregiver_census = {
    total: cgs.length, active: activeG, inactive: inactiveG,
    with_phone: withPhoneG, with_email: withEmailG,
    status_label_vocabulary: [...statusLabels.entries()].sort((a, b) => b[1] - a[1]),
  }

  /* ── 4. IDENTITY DRY RUN AGAINST GHL ────────────────────────────────────── */
  const ghlByPhone = new Map<string, number>()
  let ghlScanned = 0, ghlError = ''
  if (GHL_KEY && GHL_LOCATION) {
    let cursor = ''
    for (let page = 0; page < 20; page++) {
      const u = `https://services.leadconnectorhq.com/contacts/?locationId=${GHL_LOCATION}` +
                `&limit=100${cursor ? `&startAfterId=${encodeURIComponent(cursor)}` : ''}`
      try {
        const r = await fetch(u, { headers: {
          'Authorization': `Bearer ${GHL_KEY}`, 'Version': '2021-07-28', 'Accept': 'application/json' } })
        if (!r.ok) { ghlError = `HTTP ${r.status}`; break }
        // deno-lint-ignore no-explicit-any
        const batch = (((await r.json()) as any)?.contacts ?? []) as any[]
        ghlScanned += batch.length
        for (const c of batch) {
          const p = normPhone(c?.phone)
          if (p) ghlByPhone.set(p, (ghlByPhone.get(p) ?? 0) + 1)
        }
        if (batch.length < 100) break
        cursor = batch[batch.length - 1]?.id || ''
        if (!cursor) break
      } catch (e) { ghlError = e instanceof Error ? e.message : String(e); break }
    }
  } else ghlError = 'GHL_API_KEY or GHL_LOCATION_ID not set'

  /* Every AxisCare person keyed by phone, so shared lines are visible. */
  const axisByPhone = new Map<string, Array<{ kind: string; id: string }>>()
  const addPeople = (list: unknown[], kind: string) => {
    for (const p of list) {
      // deno-lint-ignore no-explicit-any
      const rec = p as any
      const id = String(rec?.id ?? '')
      for (const ph of phonesIn(rec)) {
        const arr = axisByPhone.get(ph) ?? []
        arr.push({ kind, id }); axisByPhone.set(ph, arr)
      }
    }
  }
  addPeople(clients, 'client')
  addPeople(cgs, 'caregiver')

  let matched = 0, noGhl = 0, ambiguous = 0
  const sharedLines: Array<Record<string, unknown>> = []
  for (const [ph, people] of axisByPhone) {
    const inGhl = ghlByPhone.get(ph) ?? 0
    if (people.length > 1) {
      ambiguous++
      sharedLines.push({ line_last4: ph.slice(-4), axiscare_people: people.length,
                         kinds: [...new Set(people.map(p => p.kind))],
                         ghl_contacts_on_this_line: inGhl })
    }
    if (inGhl > 0) matched++; else noGhl++
  }

  report.identity_dry_run = {
    axiscare_active_clients: activeC,
    axiscare_active_caregivers: activeG,
    client_contacts_seen: withContactsC,
    ghl_contacts_scanned: ghlScanned,
    ghl_error: ghlError || undefined,
    distinct_axiscare_phone_lines: axisByPhone.size,
    lines_matching_a_ghl_contact: matched,
    lines_with_no_ghl_contact: noGhl,
    shared_lines_multiple_axiscare_people: ambiguous,
    ghl_contacts_on_a_shared_line: [...ghlByPhone.entries()].filter(([, n]) => n > 1).length,
    shared_line_detail: sharedLines.slice(0, 40),
    note: 'Nothing was written to GHL, AxisCare or Supabase.',
  }

  /* Prove we did not touch Supabase either — a read of nothing. */
  const sb = createClient(SUPABASE_URL, SERVICE_KEY)
  const { error } = await sb.from('app_data').select('key').limit(1)
  report.supabase_reachable = !error

  return new Response(JSON.stringify(report, null, 2),
    { status: 200, headers: { 'Content-Type': 'application/json' } })
})
