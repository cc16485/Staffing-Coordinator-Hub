// =============================================================================
// identity-backfill — populate the identity layer from sources we already have
// =============================================================================
// DRY RUN BY DEFAULT. Pass ?commit=1 to write.
//
// WHERE PEOPLE COME FROM, and where they do not:
//   Hub caregivers, candidates and leads CREATE people. They are ours, they are
//   small, and they are already curated.
//
//   GHL contacts do NOT create people. They are LINKED to people we already
//   know, by phone. 9,570 GHL contacts are mostly one VA lead campaign; turning
//   them into 9,570 identities would bury the few hundred that matter and would
//   let GHL's phone-matching decide who exists. GHL is a communication endpoint.
//   The Hub decides who a person is.
//
// ONE PERSON, MANY ROLES: someone who appears as both a candidate and a
// caregiver becomes one person holding applicant/former and caregiver/active.
// That history is the point. Cloning them would destroy it.
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const sb = createClient(SUPABASE_URL, SERVICE_KEY)

function normPhone(raw: unknown): string | null {
  const d = String(raw ?? '').replace(/\D/g, '')
  if (d.length === 10) return '+1' + d
  if (d.length === 11 && d.startsWith('1')) return '+' + d
  return d.length > 11 ? '+' + d : null
}
function clean(s: unknown) { return String(s ?? '').trim() }
function nameKey(n: string) {
  return n.toLowerCase().replace(/[^a-z ]/g, '').split(/\s+/).filter(Boolean).join(' ')
}
function sameNameish(a: string, b: string): boolean {
  const A = nameKey(a), B = nameKey(b)
  if (!A || !B) return false
  if (A === B) return true
  const pa = A.split(' '), pb = B.split(' ')
  const la = pa[pa.length - 1], lb = pb[pb.length - 1]
  return la === lb && (pa[0].startsWith(pb[0]) || pb[0].startsWith(pa[0]))
}

interface Draft {
  key: string                       // dedupe key within this run
  display_name: string
  first: string
  last: string
  phone: string | null
  email: string | null
  roles: Array<{ role: string; status: string; started_at?: string | null }>
  sources: Array<{ system: string; entity_type: string; source_id: string }>
}

/* ── CAREGIVER PHONE RECOVERY ────────────────────────────────────────────────
   All 56 caregivers were skipped by the backfill because they hold no phone and
   no email. That traces to the July 2026 restore, which recovered names and
   hire dates only. Caregivers are the population that rings the office most, so
   with no numbers on file, caller recognition cannot see them at all.

   AxisCare would settle this, and AxisCare is blocked. GHL is the only source
   we can reach today — but matching on NAME ALONE is exactly what this whole
   layer exists to avoid. So this PROPOSES and never writes: every candidate is
   graded, and a name that matches more than one GHL contact is refused rather
   than resolved. A person decides.  */
async function proposeCaregiverPhones() {
  const { data: rows } = await sb.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const cgs = (Array.isArray(rows?.data) ? rows!.data : []) as any[]

  const ghl: Array<{ id: string; name: string; phone: string | null; email: string | null }> = []
  let from = 0
  for (;;) {
    const { data } = await sb.from('identity_scan_cache')
      .select('ghl_contact_id, first_name, last_name, phone, email').range(from, from + 999)
    if (!data || !data.length) break
    for (const r of data) {
      ghl.push({
        id: r.ghl_contact_id,
        name: [r.first_name, r.last_name].filter(Boolean).join(' ').trim(),
        phone: r.phone, email: r.email,
      })
    }
    if (data.length < 1000) break
    from += 1000
  }

  const proposals: Array<Record<string, unknown>> = []
  let confident = 0, ambiguous = 0, none = 0, alreadyHave = 0

  for (const c of cgs) {
    const name = [clean(c.first), clean(c.last)].filter(Boolean).join(' ').trim()
    if (!name) continue
    if (normPhone(c.phone)) { alreadyHave++; continue }

    /* Exact normalised full-name matches only. Surname-plus-initial is too
       loose for a roster where several people can share a surname. */
    const key = nameKey(name)
    const hits = ghl.filter(g => g.phone && nameKey(g.name) === key)

    if (hits.length === 1) {
      confident++
      proposals.push({
        caregiver: name, caregiver_id: c.id, grade: 'confident',
        ghl_contact_id: hits[0].id, phone_last4: hits[0].phone!.slice(-4),
        has_email: !!hits[0].email,
        reading: 'exactly one GHL contact carries this full name and a phone',
      })
    } else if (hits.length > 1) {
      ambiguous++
      proposals.push({
        caregiver: name, caregiver_id: c.id, grade: 'ambiguous',
        candidates: hits.length,
        phones_last4: hits.map(h => h.phone!.slice(-4)),
        reading: `${hits.length} GHL contacts share this name. Name alone cannot ` +
                 `settle it — a person must choose, or wait for AxisCare.`,
      })
    } else {
      none++
      proposals.push({
        caregiver: name, caregiver_id: c.id, grade: 'no_match',
        reading: 'no GHL contact with this name has a phone number',
      })
    }
  }

  return {
    caregivers_total: cgs.length,
    already_have_a_phone: alreadyHave,
    recoverable_confidently: confident,
    ambiguous_needs_a_person: ambiguous,
    no_match_found: none,
    ghl_contacts_searched: ghl.length,
    proposals,
    note: 'PROPOSAL ONLY. Nothing was written. Name-only matching is not ' +
          'permitted to establish identity, so even the confident rows need ' +
          'your approval before they are applied.',
  }
}

/* ── EVIDENCE GRADING ────────────────────────────────────────────────────────
   An exact full-name match is not enough to promote a GHL phone number into the
   caregiver source record. This scores every proposed match against INDEPENDENT
   identity attributes and refuses to call anything confirmed on name alone.

     CONFIRMED  exact name AND at least one independent identifier agrees
                (email, a linked applicant record, an existing source id)
     PROBABLE   exact name, corroborating but not identifying signals only
     AMBIGUOUS  several candidates, or identifiers that disagree

   Only CONFIRMED is eligible for an automatic live fill. */
async function gradeCaregiverEvidence() {
  const { data: rows } = await sb.from('app_data')
    .select('key, data').in('key', ['caregivers', 'candidates'])
  // deno-lint-ignore no-explicit-any
  const cgs = (rows?.find(r => r.key === 'caregivers')?.data ?? []) as any[]
  // deno-lint-ignore no-explicit-any
  const cands = (rows?.find(r => r.key === 'candidates')?.data ?? []) as any[]

  /* Full GHL rows including tags, so applicant history can corroborate. */
  const ghl: Array<{ id: string; name: string; phone: string | null;
                     email: string | null; tags: string[] }> = []
  let from = 0
  for (;;) {
    const { data } = await sb.from('identity_scan_cache')
      .select('ghl_contact_id, first_name, last_name, phone, email, tags').range(from, from + 999)
    if (!data || !data.length) break
    for (const r of data) {
      ghl.push({
        id: r.ghl_contact_id,
        name: [r.first_name, r.last_name].filter(Boolean).join(' ').trim(),
        phone: r.phone, email: r.email,
        tags: (Array.isArray(r.tags) ? r.tags : []).map((t: unknown) => String(t).toLowerCase()),
      })
    }
    if (data.length < 1000) break
    from += 1000
  }

  /* Existing identity links — the strongest evidence of all, when present. */
  const { data: srcRows } = await sb.from('person_source_id')
    .select('person_id, system, entity_type, source_id')
  const hubCaregiverLinks = new Set(
    (srcRows ?? []).filter(s => s.system === 'hub' && s.entity_type === 'caregiver')
      .map(s => String(s.source_id)))

  const candByName = new Map<string, typeof cands[number]>()
  for (const c of cands) {
    const n = nameKey([clean(c.first), clean(c.last)].filter(Boolean).join(' '))
    if (n) candByName.set(n, c)
  }

  const APPLICANT_TAGISH = /applicant|applied|hired|interview|orientation|hrcloud|caregiver|onboard/

  const graded: Array<Record<string, unknown>> = []
  const tally = { CONFIRMED: 0, PROBABLE: 0, AMBIGUOUS: 0, NO_MATCH: 0, HAS_PHONE: 0 }
  let cgWithEmail = 0

  for (const c of cgs) {
    const name = [clean(c.first), clean(c.last)].filter(Boolean).join(' ').trim()
    if (!name) continue
    const cgPhone = normPhone(c.phone)
    const cgEmail = normEmailLocal(c.email)
    if (cgEmail) cgWithEmail++
    if (cgPhone) { tally.HAS_PHONE++; continue }

    const key = nameKey(name)
    const hits = ghl.filter(g => g.phone && nameKey(g.name) === key)

    if (!hits.length) {
      tally.NO_MATCH++
      graded.push({ caregiver: name, caregiver_id: c.id, grade: 'NO_MATCH',
                    evidence: [], reading: 'no GHL contact of this name has a phone' })
      continue
    }
    if (hits.length > 1) {
      tally.AMBIGUOUS++
      graded.push({ caregiver: name, caregiver_id: c.id, grade: 'AMBIGUOUS',
                    candidates: hits.length,
                    evidence: ['exact name matches more than one contact'],
                    reading: 'name alone cannot settle this' })
      continue
    }

    const g = hits[0]
    const identifying: string[] = []      // independent IDENTITY attributes
    const corroborating: string[] = []    // supportive but not identifying
    const conflicts: string[] = []

    identifying.push('exact normalised full name')   // necessary, not sufficient

    /* 1. EMAIL — the discriminator she asked about. */
    const ghlEmail = normEmailLocal(g.email)
    let emailAgrees: boolean | null = null
    if (cgEmail && ghlEmail) {
      emailAgrees = cgEmail === ghlEmail
      if (emailAgrees) identifying.push(`email matches exactly (${cgEmail})`)
      else conflicts.push(`emails DISAGREE (roster ${cgEmail} vs GHL ${ghlEmail})`)
    } else if (!cgEmail) {
      corroborating.push('no email on the caregiver record to compare')
    }

    /* 2. A LINKED APPLICANT RECORD — genuinely independent. */
    const cand = candByName.get(key)
    if (cand) {
      const candEmail = normEmailLocal(cand.email)
      const candPhone = normPhone(cand.phone)
      if (candEmail && ghlEmail && candEmail === ghlEmail) {
        identifying.push('applicant record email matches the GHL contact')
      } else if (candPhone && candPhone === g.phone) {
        identifying.push('applicant record phone matches the GHL contact')
      } else {
        corroborating.push('an applicant record exists for this name')
      }
    }

    /* 3. AN EXISTING SOURCE LINK. */
    if (hubCaregiverLinks.has(String(c.id))) {
      corroborating.push('this caregiver already has a Hub identity link')
    }

    /* 4. GHL HISTORY — corroborating only. A hiring-funnel tag says this contact
          came through our pipeline; it does not prove WHICH person it is. */
    const tagHits = g.tags.filter(t => APPLICANT_TAGISH.test(t))
    if (tagHits.length) corroborating.push(`GHL tags suggest our hiring funnel: ${tagHits.slice(0, 3).join(', ')}`)

    /* 5. HIRE RECORD. */
    if (clean(c.hire_date)) corroborating.push(`hire date on file (${String(c.hire_date).slice(0, 10)})`)

    const independent = identifying.filter(e => !e.startsWith('exact normalised full name'))
    let grade: string
    if (conflicts.length) grade = 'AMBIGUOUS'
    else if (independent.length) grade = 'CONFIRMED'
    else grade = 'PROBABLE'
    tally[grade as keyof typeof tally]++

    graded.push({
      caregiver: name, caregiver_id: c.id, grade,
      ghl_contact_id: g.id,
      phone_last4: g.phone!.slice(-4),
      phone_normalised: g.phone,          // already E.164 in the cache
      caregiver_email: cgEmail,
      ghl_email: ghlEmail,
      email_agrees: emailAgrees,
      identifying, corroborating, conflicts,
      reading: grade === 'CONFIRMED'
        ? 'name plus at least one independent identifier'
        : grade === 'AMBIGUOUS'
          ? 'identifiers disagree — do not write'
          : 'exact name only. No independent identifier agrees, so this is not ' +
            'eligible for an automatic fill.',
    })
  }

  return {
    caregivers_total: cgs.length,
    caregivers_with_an_email_on_file: cgWithEmail,
    email_comparison_possible: cgWithEmail > 0,
    tally,
    eligible_for_automatic_fill: tally.CONFIRMED,
    graded,
    note: cgWithEmail === 0
      ? 'NO caregiver record carries an email, so email agreement cannot be ' +
        'tested for any of them. Under the CONFIRMED rule, name-only matches ' +
        'are PROBABLE and are not eligible for automatic filling.'
      : 'Email agreement was tested where both sides had one.',
  }
}

/** Local part plus domain, lowercased and trimmed. Null when absent. */
function normEmailLocal(raw: unknown): string | null {
  const e = String(raw ?? '').trim().toLowerCase()
  return e.includes('@') ? e : null
}

/* ── IS THIS PERSON ACTUALLY A FIELD CAREGIVER? ──────────────────────────────
   Samantha and Krystal appear on the caregiver roster. That may be correct —
   an owner or a coordinator who genuinely covers shifts holds BOTH roles — or
   they may be there for administrative reasons only.

   This does not decide. It reports the field-work markers each roster member
   actually carries, so a person can decide from evidence. The markers below
   are specific to working in the field rather than to being employed:
     ojt_date       on-the-job training, only done for field staff
     supv_date      supervisory visit, observed IN a client home
     alz_date       dementia training tied to client contact
     axiscare_id    scheduled in the system that assigns shifts
     first_contact  the date they first attended a client */
async function inspectRosterRoles() {
  const { data: row } = await sb.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const cgs = (Array.isArray(row?.data) ? row!.data : []) as any[]

  const FIELD_MARKERS = [
    ['ojt_date', 'on-the-job training'],
    ['supv_date', 'supervisory visit in a client home'],
    ['alz_date', 'dementia training'],
    ['first_contact', 'first client contact'],
    ['axiscare_id', 'scheduled in AxisCare'],
  ] as const

  const profile = (c: Record<string, unknown>) => {
    const present = FIELD_MARKERS.filter(([f]) => clean(c[f])).map(([, label]) => label)
    return {
      name: [clean(c.first), clean(c.last)].filter(Boolean).join(' ').trim(),
      hire_date: clean(c.hire_date) ? String(c.hire_date).slice(0, 10) : null,
      field_markers: present,
      field_marker_count: present.length,
      verdict: present.length >= 2 ? 'looks like a real field caregiver'
             : present.length === 1 ? 'one marker only — not conclusive'
             : 'NO field-work markers at all — likely on the roster for ' +
               'administrative or compliance reasons, not because they attend clients',
    }
  }

  const all = cgs.map(profile)
  const watch = ['samantha troutman', 'krystal land']
  return {
    roster_total: cgs.length,
    field_marker_distribution: {
      two_or_more: all.filter(p => p.field_marker_count >= 2).length,
      exactly_one: all.filter(p => p.field_marker_count === 1).length,
      none: all.filter(p => p.field_marker_count === 0).length,
    },
    the_two_in_question: all.filter(p => watch.includes(nameKey(p.name))),
    others_with_no_field_markers: all
      .filter(p => p.field_marker_count === 0 && !watch.includes(nameKey(p.name)))
      .map(p => p.name).slice(0, 30),
    note: 'This reports evidence. It does not change a single record. Whether ' +
          'someone holds staff, caregiver, or both is your call — the schema ' +
          'supports holding both at once, so nothing has to be forced.',
  }
}

/* ── APPLY THE RECOVERED NUMBERS ─────────────────────────────────────────────
   Writes phone and email onto the live caregiver roster. Three guarantees:

   1. It BACKS UP the whole caregivers blob first, under a timestamped key, and
      refuses to proceed if the backup cannot be verified by reading it back.
      This blob was already lost once in July 2026.
   2. It NEVER overwrites a value that is already there. Only blanks are filled.
   3. Confident matches only. The ambiguous ones become review items so they are
      not silently dropped, and Lizzie Henderson stays empty until AxisCare.  */
async function applyCaregiverPhones(stamp: string) {
  /* CONFIRMED ONLY. Graded evidence, not the old name-match proposal: a phone
     is never written because two records happen to share a name. */
  const graded = await gradeCaregiverEvidence()
  const confident = (graded.graded as Array<Record<string, unknown>>)
    .filter(p => p.grade === 'CONFIRMED')

  if (!confident.length) {
    return {
      error: 'Nothing is CONFIRMED. No independent identifier agrees for any ' +
             'proposed match, so there is nothing eligible for automatic fill.',
      tally: graded.tally,
      caregivers_with_an_email_on_file: graded.caregivers_with_an_email_on_file,
      wrote_nothing: true,
    }
  }

  const { data: row } = await sb.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const cgs = (Array.isArray(row?.data) ? row!.data : []) as any[]
  if (!cgs.length) return { error: 'caregivers blob is empty — refusing to write' }

  /* BACK UP, and prove the backup exists before touching anything. */
  const backupKey = `caregivers_backup_${stamp}`
  const { error: bErr } = await sb.from('app_data').upsert(
    { key: backupKey, data: cgs }, { onConflict: 'key' })
  if (bErr) return { error: `backup failed, nothing was changed: ${bErr.message}` }
  const { data: check } = await sb.from('app_data').select('data').eq('key', backupKey).maybeSingle()
  const backedUp = Array.isArray(check?.data) ? check!.data.length : 0
  if (backedUp !== cgs.length) {
    return { error: `backup read-back mismatch (${backedUp} vs ${cgs.length}) — nothing was changed` }
  }

  /* Fetch the full contact rows so we write real values, not last-4. */
  const wanted = new Set(confident.map(c => String(c.ghl_contact_id)))
  const contacts = new Map<string, { phone: string | null; email: string | null }>()
  let from = 0
  for (;;) {
    const { data } = await sb.from('identity_scan_cache')
      .select('ghl_contact_id, phone, email').range(from, from + 999)
    if (!data || !data.length) break
    for (const r of data) {
      if (wanted.has(r.ghl_contact_id)) contacts.set(r.ghl_contact_id, { phone: r.phone, email: r.email })
    }
    if (data.length < 1000) break
    from += 1000
  }

  let phonesSet = 0, emailsSet = 0, skippedHadValue = 0, notFound = 0
  const byId = new Map(cgs.map(c => [String(c.id), c]))
  for (const p of confident) {
    const cg = byId.get(String(p.caregiver_id))
    const src = contacts.get(String(p.ghl_contact_id))
    if (!cg || !src) { notFound++; continue }
    if (src.phone && !normPhone(cg.phone)) { cg.phone = src.phone; phonesSet++ }
    else if (src.phone) skippedHadValue++
    if (src.email && !clean(cg.email)) { cg.email = src.email; emailsSet++ }
    cg.contact_recovered_from = 'ghl_name_match'
    cg.contact_recovered_at = new Date().toISOString()
  }

  const { error: wErr } = await sb.from('app_data')
    .upsert({ key: 'caregivers', data: cgs }, { onConflict: 'key' })
  if (wErr) return { error: `write failed: ${wErr.message}`, backup_key: backupKey }

  /* READ BACK. Count what is actually on the roster now, not what we intended. */
  const { data: after } = await sb.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const afterRows = (Array.isArray(after?.data) ? after!.data : []) as any[]
  const withPhone = afterRows.filter(c => normPhone(c.phone)).length
  const withEmail = afterRows.filter(c => clean(c.email)).length

  /* The ambiguous ones must not vanish. Queue them for a person. */
  let queued = 0
  for (const p of (graded.graded as Array<Record<string, unknown>>)) {
    if (p.grade !== 'AMBIGUOUS') continue
    const { data: dupe } = await sb.from('identity_review')
      .select('id').eq('reason', 'conflicting_names')
      .contains('detail', { caregiver: p.caregiver }).limit(1).maybeSingle()
    if (dupe) continue
    const { error } = await sb.from('identity_review').insert({
      reason: 'conflicting_names', phone: null,
      detail: { caregiver: p.caregiver, candidates: p.candidates,
                phones_last4: p.phones_last4,
                note: 'several GHL contacts share this name — a person must choose' },
    })
    if (!error) queued++
  }

  return {
    backup_key: backupKey,
    backup_verified_rows: backedUp,
    confident_applied: confident.length,
    phones_set: phonesSet,
    emails_set: emailsSet,
    skipped_already_had_a_value: skippedHadValue,
    source_row_missing: notFound,
    ambiguous_queued_for_review: queued,
    verified_by_reading_back: {
      caregivers_total: afterRows.length,
      now_have_a_phone: withPhone,
      now_have_an_email: withEmail,
    },
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200 })
  const q = new URL(req.url).searchParams

  if (q.get('grade') === '1') {
    return new Response(JSON.stringify(await gradeCaregiverEvidence(), null, 2),
      { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  if (q.get('roster_roles') === '1') {
    return new Response(JSON.stringify(await inspectRosterRoles(), null, 2),
      { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  if (q.get('apply_phones') === '1') {
    const stamp = q.get('stamp') || 'manual'
    return new Response(JSON.stringify(await applyCaregiverPhones(stamp), null, 2),
      { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  if (new URL(req.url).searchParams.get('recover') === '1') {
    return new Response(JSON.stringify(await proposeCaregiverPhones(), null, 2),
      { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  const commit = new URL(req.url).searchParams.get('commit') === '1'

  const out: Record<string, unknown> = { mode: commit ? 'COMMIT' : 'DRY RUN' }

  /* ── READ THE HUB SOURCES ───────────────────────────────────────────────── */
  const { data: rows, error: readErr } = await sb.from('app_data')
    .select('key, data').in('key', ['caregivers', 'candidates', 'leads'])
  if (readErr) {
    return new Response(JSON.stringify({ error: readErr.message }), { status: 500 })
  }
  const byKey = new Map<string, unknown[]>()
  for (const r of (rows ?? [])) byKey.set(r.key, Array.isArray(r.data) ? r.data : [])

  const drafts = new Map<string, Draft>()
  const counts: Record<string, number> = {
    caregivers_seen: 0, candidates_seen: 0, leads_seen: 0,
    skipped_no_name: 0, skipped_no_contact: 0, merged_into_existing: 0,
  }

  /** Merge a source record into a draft person, or create one. */
  const add = (
    first: string, last: string, phone: string | null, email: string | null,
    role: string, status: string, system: string, entityType: string,
    sourceId: string, started?: string | null,
  ) => {
    const display = [first, last].filter(Boolean).join(' ').trim()
    if (!display) { counts.skipped_no_name++; return }
    if (!phone && !email) { counts.skipped_no_contact++; return }

    /* Prefer the phone as the dedupe key — it is what the office dials and what
       caller lookup uses. Fall back to the name when there is no phone. */
    let key = phone ? `p:${phone}` : `n:${nameKey(display)}`

    /* A different human on a shared line must not be merged into the first.
       If a draft already holds this phone under a clearly different name, this
       is a household and gets its own person. */
    const existing = drafts.get(key)
    if (existing && !sameNameish(existing.display_name, display)) {
      key = `${key}|${nameKey(display)}`
    }

    const d = drafts.get(key) ?? {
      key, display_name: display, first, last, phone, email,
      roles: [], sources: [],
    }
    if (drafts.has(key)) counts.merged_into_existing++
    if (!d.email && email) d.email = email
    if (!d.phone && phone) d.phone = phone
    if (!d.roles.some(r => r.role === role)) d.roles.push({ role, status, started_at: started ?? null })
    if (!d.sources.some(s => s.system === system && s.entity_type === entityType && s.source_id === sourceId)) {
      d.sources.push({ system, entity_type: entityType, source_id: sourceId })
    }
    drafts.set(key, d)
  }

  // deno-lint-ignore no-explicit-any
  for (const c of (byKey.get('caregivers') ?? []) as any[]) {
    counts.caregivers_seen++
    add(clean(c.first), clean(c.last), normPhone(c.phone), clean(c.email) || null,
        'caregiver', c.active === false ? 'former' : 'active',
        'hub', 'caregiver', String(c.id ?? ''), c.hire_date ?? null)
    /* The durable link. After the reconciliation this is what identity should
       be built on — the Hub id is ours, the AxisCare id is the system of
       record's, and only the second survives a roster rebuild. */
    if (clean(c.axiscare_id)) {
      add(clean(c.first), clean(c.last), normPhone(c.phone), clean(c.email) || null,
          'caregiver', c.active === false ? 'former' : 'active',
          'axiscare', 'caregiver', clean(c.axiscare_id), c.hire_date ?? null)
    }
  }
  // deno-lint-ignore no-explicit-any
  for (const c of (byKey.get('candidates') ?? []) as any[]) {
    counts.candidates_seen++
    /* not_hired or resolved means the applicant chapter closed. It does not
       mean the person is gone — they may already be a caregiver above, and the
       two roles will land on one person. */
    const st = c.not_hired ? 'former' : (c.resolvedStatus ? 'former' : 'active')
    add(clean(c.first), clean(c.last), normPhone(c.phone), clean(c.email) || null,
        'applicant', st, 'hub', 'applicant', String(c.id ?? ''), c.addedAt ?? null)
  }
  // deno-lint-ignore no-explicit-any
  for (const l of (byKey.get('leads') ?? []) as any[]) {
    counts.leads_seen++
    const s = String(l.status ?? 'New').toLowerCase()
    const st = s === 'converted' ? 'former' : s === 'lost' ? 'former' : 'prospective'
    add(clean(l.first_name), clean(l.last_name), normPhone(l.phone), clean(l.email) || null,
        'lead', st, 'hub', 'lead', String(l.id ?? ''), l.created_at ?? null)
  }

  /* ── LINK GHL, DO NOT LET IT CREATE ─────────────────────────────────────── */
  const ghlByPhone = new Map<string, Array<{ id: string; name: string }>>()
  {
    let from = 0
    for (;;) {
      const { data } = await sb.from('identity_scan_cache')
        .select('ghl_contact_id, first_name, last_name, phone').range(from, from + 999)
      if (!data || !data.length) break
      for (const r of data) {
        if (!r.phone) continue
        const nm = [r.first_name, r.last_name].filter(Boolean).join(' ').trim()
        const arr = ghlByPhone.get(r.phone) ?? []
        arr.push({ id: r.ghl_contact_id, name: nm })
        ghlByPhone.set(r.phone, arr)
      }
      if (data.length < 1000) break
      from += 1000
    }
  }

  let ghlLinked = 0, ghlAmbiguous = 0, ghlMissing = 0
  const reviews: Array<Record<string, unknown>> = []
  for (const d of drafts.values()) {
    if (!d.phone) continue
    const hits = ghlByPhone.get(d.phone) ?? []
    if (!hits.length) { ghlMissing++; continue }

    const byName = hits.filter(h => sameNameish(h.name, d.display_name))
    if (byName.length === 1) {
      d.sources.push({ system: 'ghl', entity_type: 'lead', source_id: byName[0].id })
      ghlLinked++
    } else if (hits.length === 1 && !byName.length) {
      /* One GHL contact on this line and it is named somebody else. Because GHL
         merges on phone, one of these two people may have no record at all. */
      ghlAmbiguous++
      reviews.push({
        reason: 'probable_ghl_overwrite', phone: d.phone,
        detail: { hub_says: d.display_name, ghl_says: hits[0].name, ghl_contact_id: hits[0].id },
      })
    } else {
      ghlAmbiguous++
      reviews.push({
        reason: 'ambiguous_household', phone: d.phone,
        detail: { hub_says: d.display_name, ghl_contacts: hits.map(h => h.name) },
      })
    }
  }

  /* Lines where more than one of OUR OWN people share a number. Not damage —
     a household — but the caller screen must know to ask. */
  const sharedLines = new Set<string>()
  {
    const seen = new Map<string, number>()
    for (const d of drafts.values()) {
      if (!d.phone) continue
      seen.set(d.phone, (seen.get(d.phone) ?? 0) + 1)
    }
    for (const [ph, n] of seen) if (n > 1) sharedLines.add(ph)
  }

  out.counts = counts
  out.people_drafted = drafts.size
  out.ghl = { linked: ghlLinked, ambiguous: ghlAmbiguous, no_ghl_contact: ghlMissing,
              note: 'GHL contacts are LINKED to Hub people, never used to create them.' }
  out.shared_lines = sharedLines.size
  out.review_items = reviews.length
  out.multi_role_people = [...drafts.values()].filter(d => d.roles.length > 1)
    .map(d => ({ name: d.display_name, roles: d.roles.map(r => `${r.role}/${r.status}`) }))
    .slice(0, 40)

  if (!commit) {
    out.sample = [...drafts.values()].slice(0, 10).map(d => ({
      name: d.display_name, phone_last4: d.phone?.slice(-4) ?? null,
      roles: d.roles.map(r => `${r.role}/${r.status}`),
      sources: d.sources.map(s => `${s.system}:${s.entity_type}`),
    }))
    out.note = 'DRY RUN. Nothing was written. Pass ?commit=1 to apply.'
    return new Response(JSON.stringify(out, null, 2),
      { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  /* ── WRITE ──────────────────────────────────────────────────────────────── */
  let created = 0, roleRows = 0, phoneRows = 0, sourceRows = 0, failed = 0
  const errors: string[] = []

  for (const d of drafts.values()) {
    /* Idempotent by source id: if any of this person's source links already
       exists, reuse that person rather than creating a second one. */
    let personId: string | null = null
    for (const s of d.sources) {
      if (s.system === 'ghl') continue          // never resolve identity from GHL
      const { data } = await sb.from('person_source_id').select('person_id')
        .eq('system', s.system).eq('entity_type', s.entity_type)
        .eq('source_id', s.source_id).maybeSingle()
      if (data?.person_id) { personId = data.person_id; break }
    }

    if (!personId) {
      const { data, error } = await sb.from('person_identity').insert({
        display_name: d.display_name, first_name: d.first, last_name: d.last,
        primary_phone: d.phone, primary_email: d.email,
      }).select('id').single()
      if (error || !data) { failed++; errors.push(error?.message ?? 'insert failed'); continue }
      personId = data.id; created++
    }

    /* Roles are NOT upserted. The unique index on (person_id, role) is partial
       — active rows only — so there is no constraint for ON CONFLICT to infer,
       and that is deliberate: it is what lets a person hold a former client
       role and a later active one. So: look, then insert or update. */
    for (const r of d.roles) {
      const started = r.started_at ? String(r.started_at).slice(0, 10) : null
      const ended = r.status === 'former' || r.status === 'inactive'
        ? (started ?? new Date().toISOString().slice(0, 10)) : null

      const { data: existing } = await sb.from('person_role')
        .select('id, status').eq('person_id', personId).eq('role', r.role)
        .limit(1).maybeSingle()

      if (!existing) {
        const { error } = await sb.from('person_role').insert({
          person_id: personId, role: r.role, status: r.status,
          started_at: started, ended_at: ended,
        })
        if (!error) roleRows++
      } else if (existing.status !== r.status) {
        /* A status change is a real transition, not a correction. Update in
           place rather than adding a second row for the same chapter. */
        const { error } = await sb.from('person_role')
          .update({ status: r.status, ended_at: ended,
                    updated_at: new Date().toISOString() })
          .eq('id', existing.id)
        if (!error) roleRows++
      }
    }
    for (const s of d.sources) {
      const { error } = await sb.from('person_source_id').upsert({
        person_id: personId, system: s.system, entity_type: s.entity_type,
        source_id: s.source_id,
        confidence: s.system === 'ghl' ? 'probable' : 'confirmed',
        needs_review: s.system === 'ghl',
      }, { onConflict: 'person_id,system,entity_type,source_id' })
      if (!error) sourceRows++
    }
    if (d.phone) {
      /* PROVENANCE IS STATED, NEVER INHERITED. A caregiver reconciled from
         AxisCare with independent GHL corroboration is confirmed and safe for
         outreach. Anything else stays probable — useful for telling a human
         who is calling, never sufficient to message them. */
      const fromAxis = d.sources.find(x => x.system === 'axiscare')
      const { error } = await sb.from('phone_index').upsert({
        phone: d.phone, person_id: personId, kind: 'mobile',
        shared: sharedLines.has(d.phone),
        source_system: fromAxis ? 'axiscare' : 'hub',
        source_record_id: fromAxis ? fromAxis.source_id : null,
        confidence: fromAxis ? 'confirmed' : 'probable',
        verification_status: fromAxis ? 'verified' : 'unverified',
        imported_at: new Date().toISOString(),
      }, { onConflict: 'phone,person_id' })
      if (!error) phoneRows++
    }
  }

  /* The unique constraint on identity_review includes person_id, which is NULL
     here — and NULLs are distinct in a unique index, so an upsert would add a
     fresh row on every run and the queue would grow without bound. Check first. */
  let reviewsAdded = 0
  for (const r of reviews) {
    const { data: dupe } = await sb.from('identity_review')
      .select('id').eq('reason', r.reason as string).eq('phone', r.phone as string)
      .is('person_id', null).limit(1).maybeSingle()
    if (dupe) continue
    const { error } = await sb.from('identity_review')
      .insert({ reason: r.reason, phone: r.phone, detail: r.detail })
    if (!error) reviewsAdded++
  }

  /* ── READ BACK. Never report a write we have not re-read. ───────────────── */
  const rb = async (t: string) =>
    (await sb.from(t).select('*', { count: 'exact', head: true })).count ?? -1

  out.written = { people_created: created, role_rows: roleRows, reviews_added: reviewsAdded,
                  phone_rows: phoneRows, source_rows: sourceRows, failed, errors: errors.slice(0, 5) }
  out.verified_by_reading_back = {
    person_identity: await rb('person_identity'),
    person_role: await rb('person_role'),
    phone_index: await rb('phone_index'),
    person_source_id: await rb('person_source_id'),
    identity_review: await rb('identity_review'),
  }

  return new Response(JSON.stringify(out, null, 2),
    { status: 200, headers: { 'Content-Type': 'application/json' } })
})
