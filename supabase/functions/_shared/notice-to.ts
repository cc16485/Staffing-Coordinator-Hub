// WHO GETS A ROUTINE NOTICE (SOP ruling 8, Samantha 2026-10-17: routine work goes to Krystal, the Springfield lead;
// Samantha only for Money, Incidents and Program administration. Plan: claude.ai/artifact/YG7kXm9XaG5h2qo4U9VJH3, her
// ruling on it: "owners see all work and who has it, don't keep any cards from me").
//
// One order for every routine notice, read from the database, never a name in the code:
//   1. the owner of the work area (domains.owner_person, set on the Owners Hub Admin page, Work areas)
//   2. else whoever holds the Springfield lead role (staff_roles 'springfield_lead')
//   3. else Samantha, so a notice is never sent to nobody
// Only active people with an email count. Never throws.
//
// noticeCard opens the Needs Attention card the notice is about, owned by the same person, so owners see the work and
// who has it under Everyone. One card per id; a card someone closed stays closed.
// deno-lint-ignore-file no-explicit-any

export const ENTITY = 'cc_ihs'
export const LAST_RESORT = { email: 'samantha@mo-care.com', name: 'Samantha' }
export type NoticeTo = { email: string; name: string; why: 'area_owner' | 'springfield_lead' | 'last_resort'; area: string }

const S = (v: unknown, n = 160) => String(v ?? '').trim().slice(0, n)

async function person(db: any, id: unknown): Promise<{ email: string; name: string } | null> {
  if (!id) return null
  try {
    const { data: p } = await db.from('persons').select('primary_email, full_name, active').eq('person_id', id).maybeSingle()
    const email = S(p?.primary_email).toLowerCase()
    if (!email || p?.active === false) return null
    return { email, name: S(p?.full_name) || email.split('@')[0] }
  } catch { return null }
}

/** The work area's owner, or null. */
export async function areaOwner(db: any, area: string): Promise<{ email: string; name: string } | null> {
  if (!area) return null
  try {
    const { data: d } = await db.from('domains').select('owner_person, active').eq('entity', ENTITY).eq('code', area).maybeSingle()
    if (!d || d.active === false) return null
    return await person(db, d.owner_person)
  } catch { return null }
}

/** The Springfield lead (the first active holder, by email, so it is stable), or null. */
export async function springfieldLead(db: any): Promise<{ email: string; name: string } | null> {
  try {
    const { data: r } = await db.from('staff_roles').select('person_id').eq('entity', ENTITY).eq('role', 'springfield_lead')
    const found: { email: string; name: string }[] = []
    for (const x of r ?? []) { const p = await person(db, x.person_id); if (p) found.push(p) }
    found.sort((a, b) => a.email.localeCompare(b.email))
    return found[0] || null
  } catch { return null }
}

/** Who gets a routine notice for this work area. */
export async function noticeTo(db: any, area = ''): Promise<NoticeTo> {
  const o = await areaOwner(db, area)
  if (o) return { ...o, why: 'area_owner', area }
  const l = await springfieldLead(db)
  if (l) return { ...l, why: 'springfield_lead', area }
  return { ...LAST_RESORT, why: 'last_resort', area }
}

/** The list used when an alert-list setting is empty: the area owner and the Springfield lead (no repeats), else
    Samantha. Replaces the old literal ['samantha@…'] / ['samantha@…', 'krystal@…'] defaults. */
export async function fallbackPeople(db: any, area: string): Promise<{ name: string; email: string }[]> {
  const out: { name: string; email: string }[] = []
  for (const p of [await areaOwner(db, area), await springfieldLead(db)]) if (p && !out.some((x) => x.email === p.email)) out.push(p)
  return out.length ? out : [{ ...LAST_RESORT }]
}
export async function fallbackList(db: any, area: string): Promise<string[]> {
  return (await fallbackPeople(db, area)).map((p) => p.email)
}

export const firstName = (n: string) => S(n).split(/\s+/)[0] || 'there'

/** Open (once) the Needs Attention card for a notice, owned by its recipient. Returns what happened. */
export async function noticeCard(db: any, to: NoticeTo, c: { id: string; kind: string; domain: string; title: string; detail: string;
  about?: string; next_action?: string; urgency?: 'urgent' | 'high' | 'today' | 'normal'; due_hours?: number; link?: string;
  created_by: string; extra?: Record<string, unknown> }): Promise<'raised' | 'open' | 'closed' | 'failed'> {
  try {
    const { data } = await db.from('app_data').select('data').eq('key', 'ops_items').maybeSingle()
    const items: any[] = Array.isArray(data?.data) ? data.data : []
    const prev = items.find((x) => x && x.id === c.id)
    if (prev) return (prev.status === 'done' || prev.status === 'resolved') ? 'closed' : 'open'
    const now = new Date().toISOString()
    const { error } = await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item: {
      id: c.id, kind: c.kind, domain: c.domain, status: 'open', urgency: c.urgency || 'normal',
      title: S(c.title, 200), about: S(c.about, 120), detail: S(c.detail, 1200), next_action: S(c.next_action, 300),
      link: c.link || '', owner: to.email, owner_name: to.name, owner_why: to.why,
      created_at: now, due: new Date(Date.now() + (c.due_hours ?? 24) * 3_600_000).toISOString(),
      created_by: c.created_by, opened_by: 'system', ...(c.extra || {}) } })
    return error ? 'failed' : 'raised'
  } catch { return 'failed' }
}
