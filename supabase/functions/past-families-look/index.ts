// =====================================================================================================================
// PAST FAMILIES · LOOK ONLY (Desktop 504a, Samantha 2026-10-08). A TEMPORARY function: Desktop 504a deploys it, runs it once
// and deletes it again. It READS ONLY and writes nothing.
//
// Her plan for past families as a referral source: text and/or email, each one approved and sent by a person; she or Krystal
// picks who is on the list; at most once a year per family; never a deceased client's family. Past clients came into the Hub
// without phone numbers or emails (on purpose), so before anything is built this answers: how many past families could be
// reached at all, and through whom. Contacts are looked up ONLY by AxisCare client number (AxisCare's responsible parties and
// the client's own record), never matched by name or phone. The answer carries yes/no flags and counts, never a number or an
// address. Only the owner's Desktop script (the server key) can call it.
// =====================================================================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ownerCaller } from '../_shared/job-auth.ts'

// deno-lint-ignore no-explicit-any
type Any = any
const ymd = (v: unknown) => { const s = String(v ?? '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null }
const addDays = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const rowsOf = (x: Any): Any[] => Array.isArray(x) ? x : (x && typeof x === 'object' ? Object.values(x) : [])
const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '').slice(-10)
export function phonesOf(p: Any): { mobile: boolean; any: boolean } {
  const ph = rowsOf(p?.phones).filter((x: Any) => digits(x?.number ?? x?.phone).length === 10)
  const direct = [p?.mobilePhone, p?.homePhone, p?.phone].filter((x) => digits(x).length === 10)
  return { mobile: ph.some((x: Any) => /mobile|cell/i.test(String(x?.type ?? ''))) || digits(p?.mobilePhone).length === 10, any: ph.length > 0 || direct.length > 0 }
}
const emailOf = (p: Any) => [p?.email, p?.personalEmail].map((x) => String(x ?? '').trim()).find((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)) || ''

/** pure: which past clients are eligible (ended 1 month to 3 years ago, never deceased) */
export function eligible(rows: Any[], today: string) {
  const lo = addDays(today, -1096), hi = addDays(today, -30)
  const out = { eligible: [] as Any[], deceased: 0, too_recent: 0, too_old: 0, no_date: 0 }
  for (const r of rows) {
    if (/deceas/i.test(String(r.end_reason || ''))) { out.deceased++; continue }
    const e = ymd(r.ended_at); if (!e) { out.no_date++; continue }
    if (e > hi) { out.too_recent++; continue }
    if (e < lo) { out.too_old++; continue }
    out.eligible.push(r)
  }
  return out
}

Deno.serve(async (req) => {
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
  if (!(await ownerCaller(req))) return json({ error: 'owner only' }, 401)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const token = Deno.env.get('AXISCARE_API_KEY') ?? Deno.env.get('AXISCARE_TOKEN') ?? ''
  const site = Deno.env.get('AXISCARE_SITE') ?? Deno.env.get('AXISCARE_SITE_NUMBER') ?? ''
  if (!token || !/^\d+$/.test(site)) return json({ error: 'AxisCare is not set up on the server' }, 500)
  const HEAD = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-AxisCare-Api-Version': '2023-10-01' }
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())

  /* past client roles (a person with no active client role), their AxisCare number and name */
  const { data: roles, error: e1 } = await db.from('person_role').select('person_id, status, ended_at, ended_date_basis, end_reason').eq('role', 'client')
  const { data: links, error: e2 } = await db.from('person_source_id').select('person_id, source_id').eq('system', 'axiscare').eq('entity_type', 'client')
  if (e1 || e2) return json({ error: 'the Hub people could not be read' }, 500)
  const byPerson = new Map<string, Any[]>(); for (const r of roles ?? []) byPerson.set(String(r.person_id), [...(byPerson.get(String(r.person_id)) || []), r])
  const axOf = new Map<string, string>(); for (const l of links ?? []) axOf.set(String(l.person_id), String(l.source_id))
  const past: Any[] = []
  for (const [pid, rs] of byPerson) {
    if (rs.some((r: Any) => r.status === 'active')) continue
    const last = rs.slice().sort((a: Any, b: Any) => String(b.ended_at || '').localeCompare(String(a.ended_at || '')))[0]
    const ax = axOf.get(pid); if (!ax) continue
    past.push({ person_id: pid, ax, ended_at: last.ended_at, basis: last.ended_date_basis, end_reason: rs.some((r: Any) => /deceas/i.test(String(r.end_reason || ''))) ? 'deceased' : last.end_reason })
  }
  const { data: names } = await db.from('person_identity').select('id, display_name').in('id', past.map((p) => p.person_id))
  const nameOf = new Map((names ?? []).map((n: Any) => [String(n.id), String(n.display_name)]))
  const e = eligible(past, today)

  /* the clients' own records, in a few pages (read only) */
  const self = new Map<string, Any>()
  try {
    let url: string | null = `https://${site}.axiscare.com/api/clients`
    for (let page = 0; url && page < 40; page++) {
      const r: Response = await fetch(url, { headers: HEAD }); if (!r.ok) break
      const j: Any = await r.json().catch(() => ({})); for (const c of rowsOf(j?.results?.clients ?? j?.clients ?? [])) self.set(String(c?.id ?? ''), c)
      url = j?.results?.nextPage ?? j?.nextPage ?? null
    }
  } catch { /* the families below still count */ }
  /* each eligible past client's responsible parties (read only), five at a time */
  const list: Any[] = []; let axErrors = 0
  const one = async (p: Any) => {
    let parties: Any[] = []
    try {
      const r = await fetch(`https://${site}.axiscare.com/api/clients/${p.ax}/responsibleParties`, { headers: HEAD })
      if (r.ok) { const j: Any = await r.json().catch(() => ({})); parties = rowsOf(j?.results?.responsibleParties ?? j?.responsibleParties ?? j?.results ?? j).filter((x: Any) => String(x?.name ?? '').trim()) }
      else if (r.status !== 404) axErrors++
    } catch { axErrors++ }
    const fam = parties.map((x: Any) => ({ phone: phonesOf(x), email: !!emailOf(x) }))
    const s = self.get(p.ax) || {}, own = { phone: phonesOf(s), email: !!emailOf(s) }
    list.push({ name: nameOf.get(p.person_id) || 'AxisCare #' + p.ax, ended_at: p.ended_at, basis: p.basis || 'exact', end_reason: p.end_reason || null,
      family: fam.length, family_mobile: fam.filter((f) => f.phone.mobile).length, family_email: fam.filter((f) => f.email).length,
      own_mobile: own.phone.mobile, own_email: own.email, reachable: fam.some((f) => f.phone.mobile || f.email) || own.phone.mobile || own.email })
  }
  for (let i = 0; i < e.eligible.length; i += 5) await Promise.all(e.eligible.slice(i, i + 5).map(one))
  list.sort((a, b) => String(b.ended_at).localeCompare(String(a.ended_at)))
  return json({ mode: 'look', today, past_total: past.length, deceased: e.deceased, ended_last_30_days: e.too_recent, ended_over_3_years: e.too_old, no_end_date: e.no_date,
    eligible: list.length, reachable: list.filter((x) => x.reachable).length,
    by_text: list.filter((x) => x.family_mobile || x.own_mobile).length, by_email: list.filter((x) => x.family_email || x.own_email).length,
    family_contact_only_self: list.filter((x) => !x.family && (x.own_mobile || x.own_email)).length, unreachable: list.filter((x) => !x.reachable).length,
    axiscare_errors: axErrors, list })
})
