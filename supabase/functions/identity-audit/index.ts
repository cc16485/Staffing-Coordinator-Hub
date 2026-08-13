// =============================================================================
// identity-audit — READ ONLY. Inventories GHL and finds identity collisions.
// =============================================================================
// Writes nothing, to GHL or to Supabase. It exists to answer two questions
// before any identity sync is designed:
//
//   1. What does GHL already have?  Custom fields, tags, pipelines, and what
//      contact metadata is actually populated. The canonical vocabulary is
//      chosen from this inventory, not invented alongside it.
//
//   2. What identity damage already exists?  GHL's contacts/upsert deduplicates
//      on phone and email. Across 26 upsert call sites in this project, a
//      shared household line means the last writer renames the contact. This
//      finds where a client and a family member have already collapsed into one
//      record — and deliberately does NOT split or merge anything.
//
// Every finding is graded confident / ambiguous / needs_human. Nothing is acted
// on. Splitting a merged contact is a judgment call about real people.
//
// Auth: normal JWT. Call it signed in.
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const GHL_KEY      = Deno.env.get('GHL_API_KEY') || ''
const GHL_LOCATION = Deno.env.get('GHL_LOCATION_ID') || ''

const H = {
  'Authorization': `Bearer ${GHL_KEY}`,
  'Version': '2021-07-28',
  'Accept': 'application/json',
}

/* Paginate to completion. The ceiling is a runaway guard, not a sample size —
   at 100 per page this allows 200,000 contacts. If it is ever reached the
   report says so loudly, because a silent truncation reads as "we checked
   everything" when we did not. The first run of this audit stopped at 2,000
   and reported 92 collisions as though that were the whole picture. */
const MAX_CONTACT_PAGES = 2000
const PAGE_SIZE = 100

/** What a shared phone actually means. Four outcomes, because "duplicate" and
 *  "household" need opposite handling and guessing between them is how a
 *  client and her daughter get merged into one contact. */
type Verdict =
  | 'likely_duplicate_person'   // one human, several contact records
  | 'likely_shared_household'   // several humans, one line. CORRECT as-is.
  | 'possible_ghl_collapse'     // one record carrying signals of two humans
  | 'ambiguous'                 // genuinely cannot tell from the data we hold

/** E.164-ish normalisation. Digits only, then a US country code if it looks
 *  like a US number. Two numbers that normalise the same are the SAME line;
 *  that is a clue about the line, never a conclusion about the person. */
function normPhone(raw: unknown): string | null {
  const d = String(raw ?? '').replace(/\D/g, '')
  if (!d) return null
  if (d.length === 10) return '+1' + d
  if (d.length === 11 && d.startsWith('1')) return '+' + d
  if (d.length > 11) return '+' + d
  return null                       // too short to be a real line
}

function normEmail(raw: unknown): string | null {
  const e = String(raw ?? '').trim().toLowerCase()
  return e.includes('@') ? e : null
}

/** Same human, or two humans sharing a line? Surnames are the cheap signal:
 *  different surnames on one number is almost always two people. */
function sameNameish(a: string, b: string): boolean {
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, '').trim()
  const A = clean(a), B = clean(b)
  if (!A || !B) return false
  if (A === B) return true
  const la = A.split(/\s+/).pop() || '', lb = B.split(/\s+/).pop() || ''
  const fa = A.split(/\s+/)[0] || '',    fb = B.split(/\s+/)[0] || ''
  return la === lb && (fa.startsWith(fb) || fb.startsWith(fa))
}

async function ghl(path: string) {
  try {
    const r = await fetch(`https://services.leadconnectorhq.com${path}`, { headers: H })
    const t = await r.text()
    if (!r.ok) return { ok: false, status: r.status, error: t.slice(0, 250) }
    return { ok: true, status: r.status, data: JSON.parse(t || '{}') }
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200 })
  if (!GHL_KEY || !GHL_LOCATION) {
    return new Response(JSON.stringify({
      ok: false, error: 'GHL_API_KEY or GHL_LOCATION_ID is not set',
    }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }

  const report: Record<string, unknown> = { read_only_to_ghl: true }
  const url  = new URL(req.url)
  const mode = url.searchParams.get('mode') || 'classify'
  const sbEarly = createClient(SUPABASE_URL, SERVICE_KEY)

  /* ── MODE: INVENTORY ────────────────────────────────────────────────────── */
  if (mode === 'inventory') {
    const fields = await ghl(`/locations/${GHL_LOCATION}/customFields`)
    const tags   = await ghl(`/locations/${GHL_LOCATION}/tags`)
    const pipes  = await ghl(`/opportunities/pipelines?locationId=${GHL_LOCATION}`)
    return new Response(JSON.stringify({
      inventory: {
        custom_fields: fields.ok
          // deno-lint-ignore no-explicit-any
          ? ((fields.data as any)?.customFields ?? []).map((f: any) => ({
              id: f.id, name: f.name, key: f.fieldKey, type: f.dataType,
            }))
          : { unavailable: fields.error, status: fields.status },
        // deno-lint-ignore no-explicit-any
        tags: tags.ok ? ((tags.data as any)?.tags ?? []).map((t: any) => t.name ?? t)
                      : { unavailable: tags.error, status: tags.status },
        pipelines: pipes.ok
          // deno-lint-ignore no-explicit-any
          ? ((pipes.data as any)?.pipelines ?? []).map((p: any) => ({
              name: p.name, stages: (p.stages ?? []).map((s: any) => s.name),
            }))
          : { unavailable: pipes.error, status: pipes.status },
      },
    }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  /* ── MODE: SCAN ─────────────────────────────────────────────────────────────
     A full contact scan cannot finish inside one edge-function invocation. The
     previous version tried, and the runtime killed it partway with no result at
     all. So this pages under a wall-clock budget, parks what it has in
     identity_scan_cache, and hands back a cursor. The caller loops until done.

     A scan is therefore resumable rather than all-or-nothing, which matters
     once there are thousands of contacts and one timeout would otherwise throw
     away every page already fetched. */
  if (mode === 'scan') {
    const started = Date.now()
    /* One page only, for the preflight. A single fast round-trip tells us
       whether contacts/search works at all, which beats discovering it inside
       a seventy-second loop that returns nothing when it fails. */
    const once = url.searchParams.get('once') === '1'
    /* Deliberately short. Each round is a progress line the user can see, and a
       long silent gap is indistinguishable from a hang — which is exactly how
       the previous two runs were read. Twenty seconds is roughly twenty pages,
       so a large location still finishes in a handful of visible rounds. */
    const BUDGET_MS = 20_000
    const pageCap = once ? 1 : MAX_CONTACT_PAGES
    let cursor = url.searchParams.get('after') || ''

    if (url.searchParams.get('reset') === '1') {
      await sbEarly.from('identity_scan_cache').delete().neq('ghl_contact_id', '')
    }

    /* GHL v2 pagination.
       The GET /contacts/ endpoint ignores startAfterId on its own, which is how
       an earlier version of this scan "read 2,000 contacts" that were really the
       same 100 returned twenty times. POST /contacts/search paginates properly
       via the searchAfter array it hands back, so that is the primary path.

       Crucially, a cursor that does not advance is now an ERROR, not
       completion. Silently treating a stuck pager as "done" is what produced a
       confident, wrong collision count. */
    let searchAfter: unknown[] | null =
      cursor ? JSON.parse(decodeURIComponent(cursor)) : null

    let fetched = 0, pages = 0, done = false, err: unknown = null
    let stalled = false, dupePages = 0
    const seenThisCall = new Set<string>()

    while (Date.now() - started < BUDGET_MS && pages < pageCap) {
      const body: Record<string, unknown> = {
        locationId: GHL_LOCATION,
        pageLimit: PAGE_SIZE,
        ...(searchAfter ? { searchAfter } : {}),
      }
      let batch: Array<Record<string, unknown>> = []
      let nextAfter: unknown[] | null = null

      try {
        const r = await fetch('https://services.leadconnectorhq.com/contacts/search', {
          method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const text = await r.text()
        if (!r.ok) { err = { status: r.status, error: text.slice(0, 250), endpoint: 'contacts/search' }; break }
        // deno-lint-ignore no-explicit-any
        const j = JSON.parse(text || '{}') as any
        batch = (j?.contacts ?? []) as Array<Record<string, unknown>>
        /* The cursor for the next page is the last row's own searchAfter. */
        const last = batch[batch.length - 1] as Record<string, unknown> | undefined
        nextAfter = (last?.searchAfter as unknown[]) ?? null
      } catch (e) {
        err = { fetch: e instanceof Error ? e.message : String(e) }; break
      }

      if (!batch.length) { done = true; break }

      const rows = batch.map(c => ({
        ghl_contact_id: String(c?.id ?? ''),
        first_name: (c?.firstName as string) ?? null,
        last_name:  (c?.lastName as string) ?? null,
        phone:      normPhone(c?.phone),
        email:      normEmail(c?.email),
        tags:       c?.tags ?? [],
      })).filter(r => r.ghl_contact_id)

      /* Did this page actually contain anything new? If not, the pager is
         stuck and every further round would inflate the counts. */
      const fresh = rows.filter(r => !seenThisCall.has(r.ghl_contact_id))
      rows.forEach(r => seenThisCall.add(r.ghl_contact_id))
      if (!fresh.length) {
        dupePages++
        if (dupePages >= 2) { stalled = true; break }
      } else dupePages = 0

      const { error } = await sbEarly.from('identity_scan_cache')
        .upsert(rows, { onConflict: 'ghl_contact_id' })
      if (error) { err = { cache_write: error.message }; break }

      fetched += batch.length
      pages++
      if (batch.length < PAGE_SIZE) { done = true; break }
      if (!nextAfter || !nextAfter.length) {
        /* No cursor handed back and a full page returned: we cannot advance,
           and we must not pretend the scan finished. */
        stalled = true; break
      }
      cursor = encodeURIComponent(JSON.stringify(nextAfter))
      searchAfter = nextAfter
    }

    if (stalled) {
      err = {
        pagination: 'STALLED — the cursor stopped advancing while full pages ' +
          'were still being returned. The scan is INCOMPLETE and its counts ' +
          'must not be treated as a total.',
      }
      done = false
    }

    const { count } = await sbEarly.from('identity_scan_cache')
      .select('ghl_contact_id', { count: 'exact', head: true })

    return new Response(JSON.stringify({
      mode: once ? 'scan-preflight' : 'scan',
      done, error: err,
      endpoint_used: 'POST /contacts/search',
      fetched_this_call: fetched, pages_this_call: pages,
      distinct_this_call: seenThisCall.size,
      /* The preflight's whole job: did the cursor come back? Without it the
         pager cannot advance and the scan can never be complete. */
      cursor_returned: !!cursor,
      elapsed_ms: Date.now() - started,
      cached_total: count ?? null,
      next_cursor: done ? null : cursor,
      note: 'Contacts are cached in identity_scan_cache. Nothing was written to GHL.',
    }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  /* ── MODE: CLASSIFY ─────────────────────────────────────────────────────── */
  // deno-lint-ignore no-explicit-any
  const contacts: any[] = []
  {
    /* Read the cache in pages — Supabase caps a single select at 1000 rows, and
       silently returning the first 1000 would understate every count below. */
    let from = 0
    for (;;) {
      const { data, error } = await sbEarly.from('identity_scan_cache')
        .select('ghl_contact_id, first_name, last_name, phone, email, tags')
        .range(from, from + 999)
      if (error) { report.cache_error = error.message; break }
      if (!data || !data.length) break
      for (const r of data) {
        contacts.push({
          id: r.ghl_contact_id, firstName: r.first_name, lastName: r.last_name,
          phone: r.phone, email: r.email, tags: r.tags ?? [],
        })
      }
      if (data.length < 1000) break
      from += 1000
    }
  }
  const truncated = false
  report.contacts_scanned = contacts.length
  if (!contacts.length) {
    report.fatal = 'The scan cache is empty. Run mode=scan first.'
    return new Response(JSON.stringify(report, null, 2),
      { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  /* What is actually populated? Tells us which fields staff really use. */
  const populated: Record<string, number> = {}
  for (const c of contacts) {
    for (const k of ['firstName','lastName','phone','email','companyName','source','type','tags']) {
      const v = c?.[k]
      if (Array.isArray(v) ? v.length : (v !== null && v !== undefined && v !== '')) {
        populated[k] = (populated[k] || 0) + 1
      }
    }
  }
  report.field_usage = populated

  const tagCounts: Record<string, number> = {}
  for (const c of contacts) for (const t of (c?.tags ?? [])) {
    const k = String(t).toLowerCase()
    tagCounts[k] = (tagCounts[k] || 0) + 1
  }
  report.tags_in_use = Object.entries(tagCounts).sort((a, b) => b[1] - a[1])

  /* ── 3. WHAT THE HUB ALREADY KNOWS ──────────────────────────────────────── */
  /* Loaded BEFORE classification, because Hub records are the strongest signal
     available for telling a duplicate apart from a household. If the Hub knows
     two differently-named people on one line, that is a household. */
  const sb = createClient(SUPABASE_URL, SERVICE_KEY)
  const { data: appRows } = await sb.from('app_data')
    .select('key, data').in('key', ['caregivers', 'candidates', 'leads'])

  const hubPhones = new Map<string, Array<{ name: string; kind: string }>>()
  for (const row of (appRows ?? [])) {
    const kind = row.key === 'caregivers' ? 'caregiver'
               : row.key === 'candidates' ? 'applicant' : 'lead'
    for (const p of (Array.isArray(row.data) ? row.data : [])) {
      const ph = normPhone(p?.phone); if (!ph) continue
      const nm = [p?.first ?? p?.first_name, p?.last ?? p?.last_name]
        .filter(Boolean).join(' ').trim() || '(no name)'
      ;(hubPhones.get(ph) ?? hubPhones.set(ph, []).get(ph)!).push({ name: nm, kind })
    }
  }
  report.hub_phone_records = hubPhones.size

  /* ── 4. COLLISIONS, CLASSIFIED ──────────────────────────────────────────── */
  const byPhone = new Map<string, typeof contacts>()
  const byEmail = new Map<string, typeof contacts>()
  for (const c of contacts) {
    const p = normPhone(c?.phone); if (p) { (byPhone.get(p) ?? byPhone.set(p, []).get(p)!).push(c) }
    const e = normEmail(c?.email); if (e) { (byEmail.get(e) ?? byEmail.set(e, []).get(e)!).push(c) }
  }

  const findings: Array<Record<string, unknown>> = []
  const nameOf = (c: Record<string, unknown>) =>
    [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || '(no name)'
  const surnameOf = (n: string) =>
    n.toLowerCase().replace(/[^a-z ]/g, '').trim().split(/\s+/).pop() || ''

  /* Several contacts on one line. Nobody was overwritten — these are separate
     records — but they are either one person duplicated or a real household,
     and those need opposite handling. Every available signal is weighed. */
  for (const [phone, list] of byPhone) {
    if (list.length < 2) continue

    const names    = list.map(nameOf)
    const surnames = new Set(names.map(surnameOf).filter(Boolean))
    const emails   = new Set(list.map(c => normEmail(c.email)).filter(Boolean) as string[])
    const tags     = new Set(list.flatMap(c => (c.tags ?? []).map((t: unknown) => String(t).toLowerCase())))
    const hubHere  = hubPhones.get(phone) ?? []
    const hubNames = new Set(hubHere.map(h => surnameOf(h.name)).filter(Boolean))
    const allSameName = names.every(n => sameNameish(n, names[0]))

    /* Signals FOR "one person duplicated" and FOR "real household", collected
       explicitly so the reasoning is visible in the report rather than hidden
       inside a boolean. */
    const forDuplicate: string[] = []
    const forHousehold: string[] = []

    if (allSameName) forDuplicate.push('every contact carries the same name')
    if (emails.size === 1 && list.length > 1) forDuplicate.push('all share one email address')
    if (surnames.size === 1 && names.length > 1 && !allSameName) {
      forHousehold.push('same surname, different given names — relatives on one line')
    }
    if (surnames.size > 1) forHousehold.push(`different surnames (${[...surnames].join(', ')})`)
    if (emails.size > 1) forHousehold.push('different email addresses')
    if (hubNames.size > 1) forHousehold.push('the Hub knows more than one person on this line')
    if (hubHere.length && new Set(hubHere.map(h => h.kind)).size > 1) {
      forHousehold.push(`Hub roles differ here: ${[...new Set(hubHere.map(h => h.kind))].join(', ')}`)
    }

    let verdict: Verdict
    if (forDuplicate.length && !forHousehold.length)      verdict = 'likely_duplicate_person'
    else if (forHousehold.length && !forDuplicate.length) verdict = 'likely_shared_household'
    else                                                  verdict = 'ambiguous'

    findings.push({
      kind: 'multiple_contacts_one_phone',
      verdict,
      phone_last4: phone.slice(-4),          // never the whole number in a report
      contacts: list.length,
      names,
      distinct_surnames: [...surnames],
      distinct_emails: emails.size,
      tags: [...tags].slice(0, 8),
      hub_knows: hubHere.map(h => `${h.name} (${h.kind})`),
      evidence_duplicate: forDuplicate,
      evidence_household: forHousehold,
      reading:
        verdict === 'likely_duplicate_person'
          ? 'one person across several records — link them to a single identity'
        : verdict === 'likely_shared_household'
          ? 'several people sharing a line. This is CORRECT as it stands and ' +
            'must never be merged. It is exactly the client-and-daughter case.'
          : 'signals point both ways — a person has to decide',
    })
  }

  /* ONE record carrying signals of more than one human.
     An earlier version of this check flagged any contact whose email local-part
     did not contain their own name. That is not evidence of anything: plenty of
     real people use sunshine1952@ or bigdog44@, and on this contact base it
     fired on 28% of everyone with an email. A heuristic that flags a quarter of
     the database is measuring naming habits, not damage.

     So it now requires a POSITIVE signal: the email must look like it belongs
     to a DIFFERENT named person we can actually see in the data. Absence of
     evidence is no longer treated as evidence. */
  const surnameIndex = new Map<string, string[]>()
  for (const c of contacts) {
    const sn = String(c?.lastName ?? '').toLowerCase().replace(/[^a-z]/g, '')
    if (sn.length >= 4) (surnameIndex.get(sn) ?? surnameIndex.set(sn, []).get(sn)!).push(nameOf(c))
  }

  for (const c of contacts) {
    const first = String(c?.firstName ?? '').trim()
    const last  = String(c?.lastName ?? '').trim()
    const email = normEmail(c?.email)
    if (!email || !last || !first) continue
    const local   = email.split('@')[0].replace(/[^a-z]/g, '')
    const surname = last.toLowerCase().replace(/[^a-z]/g, '')
    const given   = first.toLowerCase().replace(/[^a-z]/g, '')
    if (local.length < 6 || surname.length < 4 || !given) continue
    if (local.includes(surname) || local.includes(given) || given.includes(local)) continue

    /* Does this address carry SOMEONE ELSE'S surname, and is that a real person
       in this database? That is a specific, checkable claim. */
    let impliedOther: string | null = null
    for (const [sn, names] of surnameIndex) {
      if (sn !== surname && local.includes(sn)) { impliedOther = names[0]; break }
    }
    if (!impliedOther) continue

    const hubHere = hubPhones.get(normPhone(c?.phone) ?? '') ?? []
    findings.push({
      kind: 'contact_email_belongs_to_another_person',
      verdict: 'possible_ghl_collapse' as Verdict,
      ghl_contact_id: c.id,
      name: `${first} ${last}`,
      email_implies: impliedOther,
      hub_knows: hubHere.map(h => `${h.name} (${h.kind})`),
      reading: `this contact is named ${first} ${last}, but the email carries a ` +
               `surname belonging to ${impliedOther}. An upsert may have ` +
               `overwritten one of them.`,
    })
  }

  /* ── THE COLLAPSE THAT LEAVES NO DUPLICATE ──────────────────────────────────
     The important asymmetry: GHL's contacts/upsert MERGES on phone. So a
     collapse does not leave two records to find — it leaves one, and destroys
     the evidence. Counting duplicate phones therefore UNDERSTATES the damage by
     design, and a low count is not reassurance.

     The only way to see it is to compare against a source GHL never merged.
     The Hub is one such source: if the Hub knows a person at a number and GHL's
     single contact on that number is somebody else, one of them has been
     overwritten. */
  let hubLinesMatched = 0, hubLinesAbsentFromGhl = 0
  for (const [ph, hubPeople] of hubPhones) {
    const ghlHere = byPhone.get(ph) ?? []
    if (!ghlHere.length) { hubLinesAbsentFromGhl++; continue }
    if (ghlHere.length > 1) continue            // already reported above
    const ghlName = nameOf(ghlHere[0])

    /* Only the clean one-for-one case is a collapse signal. If the Hub knows
       several people here, that is a household and was reported already. */
    if (hubPeople.length !== 1) continue
    if (sameNameish(hubPeople[0].name, ghlName)) { hubLinesMatched++; continue }

    findings.push({
      kind: 'hub_and_ghl_disagree_on_who_owns_this_line',
      verdict: 'possible_ghl_collapse' as Verdict,
      phone_last4: ph.slice(-4),
      ghl_says: ghlName,
      hub_says: `${hubPeople[0].name} (${hubPeople[0].kind})`,
      reading: 'the Hub and GHL name different people on one line, and GHL ' +
               'holds only a single contact for it. Because GHL merges on ' +
               'phone, one of these two people may have no contact record ' +
               'at all. This is the collapse that leaves no duplicate behind.',
    })
  }
  report.hub_vs_ghl = {
    hub_lines_total: hubPhones.size,
    hub_lines_matching_a_ghl_contact_by_name: hubLinesMatched,
    hub_lines_with_no_ghl_contact_at_all: hubLinesAbsentFromGhl,
    note: 'A Hub person with no GHL contact is not damage on its own — they may ' +
          'simply never have been synced. It is listed because it is the same ' +
          'question the reconciliation report will have to answer for AxisCare.',
  }

  /* One email on several contacts — the other collapse route, and the one that
     matters most because GHL matches email before phone. */
  for (const [em, list] of byEmail) {
    if (list.length < 2) continue
    const names = list.map(nameOf)
    if (names.every(n => sameNameish(n, names[0]))) continue   // plain duplicate
    findings.push({
      kind: 'one_email_several_people',
      verdict: 'possible_ghl_collapse' as Verdict,
      email_domain: em.split('@')[1] ?? '',
      contacts: list.length,
      names,
      reading: 'differently-named contacts share one email. GHL matches on email ' +
               'before phone, so the next upsert against this address will ' +
               'overwrite whichever person it lands on.',
    })
  }

  /* Someone who applied and then became a caregiver. One person, two roles —
     exactly the history the identity layer must preserve rather than clone. */
  for (const [ph, people] of hubPhones) {
    const kinds = new Set(people.map(p => p.kind))
    if (kinds.size > 1) {
      const oneHuman = people.every(p => sameNameish(p.name, people[0].name))
      findings.push({
        kind: 'same_phone_multiple_hub_roles',
        verdict: (oneHuman ? 'likely_duplicate_person' : 'likely_shared_household') as Verdict,
        phone_last4: ph.slice(-4),
        roles: [...kinds],
        names: people.map(p => p.name),
        reading: oneHuman
          ? 'one person who changed role over time, most often applicant then ' +
            'caregiver. Link the roles to a single identity — do not clone them.'
          : 'different names sharing a line across roles — separate people, ' +
            'and the identity layer must keep them separate',
      })
    }
  }

  const byVerdict: Record<Verdict, number> = {
    likely_duplicate_person: 0, likely_shared_household: 0,
    possible_ghl_collapse: 0, ambiguous: 0,
  }
  for (const f of findings) byVerdict[f.verdict as Verdict]++

  report.collisions = {
    total: findings.length,
    by_verdict: byVerdict,
    what_each_means: {
      likely_duplicate_person: 'one human, several records. Link to one identity.',
      likely_shared_household: 'several humans, one line. CORRECT as-is — never merge.',
      possible_ghl_collapse:   'one record carrying signals of two humans. Someone may ' +
                               'already have been overwritten and be missing from GHL.',
      ambiguous:               'signals point both ways. A person decides.',
    },
    findings,
  }
  report.next = truncated
    ? 'INCOMPLETE — the page ceiling was reached. Do not draw conclusions from this run.'
    : 'Complete scan. Nothing was split or merged. Every finding needs a human decision.'

  return new Response(JSON.stringify(report, null, 2),
    { status: 200, headers: { 'Content-Type': 'application/json' } })
})
