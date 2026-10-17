// =============================================================================
// staffing-route: keeps what GoHighLevel's main-line call workflow needs to send staffing calls to the Staffing
// Coordinator (Samantha, 2026-10-14; rules in _shared/staffing-route.ts)
// =============================================================================
// Two parts, both on a schedule:
//   duty  (every 5 minutes) · the location custom value "Staffing Coordinator on duty" = yes while staffing@mo-care.com
//                             holds the Staffing seat on the Hub's duty schedule, otherwise no.
//   tags  (every hour)      · the tag "staffing-caller" on every applicant, new hire, caregiver and former employee in
//                             GoHighLevel: contacts already carrying an applicant/employee tag (the scan cache), plus the
//                             Hub's own applicants and caregivers by phone. Never a client, family member or lead.
// Until ops_settings.staffing_route_live is true it only LOOKS and reports what it would do (nothing written to
// GoHighLevel). Never creates a contact, never removes a tag, never sends anything, never touches a call.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jobCaller } from '../_shared/job-auth.ts'
import { STAFFING_TAG, ON_DUTY_NAME, tagsOf, decide, coordinatorOnDuty, ten } from '../_shared/staffing-route.ts'

const GHL = 'https://services.leadconnectorhq.com'
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
const H = (tok: string, v = '2021-07-28') => ({ Authorization: `Bearer ${tok}`, Version: v, Accept: 'application/json', 'Content-Type': 'application/json' })
export const TAG_PER_RUN = 150, LOOKUP_PER_RUN = 40
// deno-lint-ignore no-explicit-any
type Any = any

async function beat(db: Any, ok: boolean, note: string) {
  try { await db.rpc('upsert_app_data_item', { target_key: 'automation_heartbeats', item: { id: 'hb_staffing-route', automation: 'staffing-route', at: new Date().toISOString(), ok, note: String(note).slice(0, 300) } }) } catch { /* never block */ }
}

async function duty(db: Any, st: Any, tok: string, loc: string, live: boolean) {
  const { data: rows } = await db.from('app_data').select('key, data').in('key', ['duty_windows', 'positions'])
  const k: Record<string, Any> = Object.fromEntries((rows ?? []).map((r: Any) => [r.key, r.data]))
  const d = coordinatorOnDuty(Array.isArray(k.duty_windows) ? k.duty_windows : [], st, new Date(), Array.isArray(k.positions) ? k.positions : [])
  const want = d.on ? 'yes' : 'no'
  const out: Record<string, Any> = { on_duty: want, seat_holder: d.holder || '(nobody scheduled)', coordinator: d.email }
  const r = await fetch(`${GHL}/locations/${encodeURIComponent(loc)}/customValues`, { headers: H(tok) })
  if (!r.ok) { out.error = `GoHighLevel would not list custom values (${r.status}); the key may need the custom values permission`; return out }
  const cv = ((await r.json().catch(() => ({})))?.customValues || []).find((x: Any) => String(x?.name || '').trim().toLowerCase() === ON_DUTY_NAME.toLowerCase())
  if (!cv) { out.error = `No custom value named "${ON_DUTY_NAME}" yet: create it in GoHighLevel (Settings, Custom Values) with the value no`; return out }
  out.current = String(cv.value ?? '')
  if (String(cv.value ?? '').trim().toLowerCase() === want) { out.changed = false; return out }
  if (!live) { out.would_change = `${out.current || '(empty)'} -> ${want}`; return out }
  const p = await fetch(`${GHL}/locations/${encodeURIComponent(loc)}/customValues/${encodeURIComponent(cv.id)}`, { method: 'PUT', headers: H(tok), body: JSON.stringify({ name: cv.name, value: want }) })
  if (!p.ok) { out.error = `GoHighLevel refused the change (${p.status})`; return out }
  out.changed = true
  return out
}

async function tags(db: Any, st: Any, tok: string, loc: string, live: boolean) {
  const t = tagsOf(st)
  const out: Record<string, Any> = { contacts_seen: 0, already: 0, would_add: 0, added: 0, blocked: 0, hub_people: 0, hub_found: 0, hub_not_in_ghl: 0, errors: 0, by_tag: {} as Record<string, number>, sample_blocked: [] as string[] }
  /* what this job already tagged (the scan cache does not see our own changes) */
  const { data: doneRow } = await db.from('app_data').select('data').eq('key', 'staffing_route_tagged').maybeSingle()
  const done = new Set<string>((Array.isArray(doneRow?.data) ? doneRow.data : []).map((x: Any) => String(x?.id || '')))
  /* the Hub's own staff by phone: applicants, start forms, caregivers */
  const hub = new Map<string, string>()
  for (const r of (await db.from('job_applicants').select('phone, first_name, last_name')).data ?? []) { const p = ten(r.phone); if (p) hub.set(p, 'applicant') }
  for (const r of (await db.from('hire_intake').select('phone')).data ?? []) { const p = ten(r.phone); if (p) hub.set(p, 'new hire') }
  const { data: cgRow } = await db.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()
  for (const c of (Array.isArray(cgRow?.data) ? cgRow.data : [])) { const p = ten(c?.phone); if (p) hub.set(p, 'caregiver') }
  out.hub_people = hub.size
  const todo: Array<{ id: string; why: string }> = []
  const seenPhones = new Set<string>()
  /* 1 · every GoHighLevel contact in the scan cache */
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('identity_scan_cache').select('ghl_contact_id, first_name, last_name, phone, tags').range(from, from + 999)
    if (error) { out.errors++; break }
    for (const c of data ?? []) {
      out.contacts_seen++
      const p = ten(c.phone); if (p) seenPhones.add(p)
      const hubStaff = !!(p && hub.has(p))
      const tg = Array.isArray(c.tags) ? c.tags : []
      const v = done.has(String(c.ghl_contact_id)) ? 'has' : decide(tg, hubStaff, t)
      if (v === 'has') out.already++
      else if (v === 'blocked') { out.blocked++; if (out.sample_blocked.length < 8) out.sample_blocked.push([c.first_name, String(c.last_name || '').slice(0, 1)].filter(Boolean).join(' ')) }
      else if (v === 'add') {
        todo.push({ id: String(c.ghl_contact_id), why: hubStaff ? hub.get(p)! : 'tag' })
        const why = hubStaff ? 'hub: ' + hub.get(p) : String(tg.map((x: Any) => String(x).toLowerCase()).find((x: string) => t.staff.has(x)) || 'tag')
        out.by_tag[why] = (out.by_tag[why] || 0) + 1
      }
    }
    if (!data || data.length < 1000) break
  }
  /* 2 · Hub staff the cache never saw: look them up in GoHighLevel by phone (a few per run) */
  let looked = 0
  for (const [p, kind] of hub) {
    if (seenPhones.has(p)) { out.hub_found++; continue }
    if (looked >= LOOKUP_PER_RUN) continue
    looked++
    try {
      const r = await fetch(`${GHL}/contacts/search/duplicate?locationId=${encodeURIComponent(loc)}&number=${encodeURIComponent('+1' + p)}`, { headers: H(tok) })
      const c: Any = r.ok ? (await r.json().catch(() => ({})))?.contact : null
      if (!c?.id) { out.hub_not_in_ghl++; continue }
      out.hub_found++
      const v = done.has(String(c.id)) ? 'has' : decide(c.tags, true, t)
      if (v === 'add') { todo.push({ id: String(c.id), why: kind }); out.by_tag['hub: ' + kind] = (out.by_tag['hub: ' + kind] || 0) + 1 }
      else if (v === 'blocked') out.blocked++
      else if (v === 'has') out.already++
    } catch { out.errors++ }
  }
  out.would_add = todo.length
  if (!live) return out
  /* 3 · LIVE: add the tag (never remove one), a batch per run, and remember each */
  for (const x of todo.slice(0, TAG_PER_RUN)) {
    try {
      const r = await fetch(`${GHL}/contacts/${encodeURIComponent(x.id)}/tags`, { method: 'POST', headers: H(tok), body: JSON.stringify({ tags: [STAFFING_TAG] }) })
      if (r.status === 404 || r.status === 400) {   // deleted or merged in GoHighLevel since the scan: remembered, never retried
        out.gone = (out.gone || 0) + 1
        await db.rpc('upsert_app_data_item', { target_key: 'staffing_route_tagged', item: { id: x.id, gone: true, at: new Date().toISOString() } }); continue
      }
      if (!r.ok) { out.errors++; continue }
      const { error } = await db.rpc('upsert_app_data_item', { target_key: 'staffing_route_tagged', item: { id: x.id, why: x.why, at: new Date().toISOString() } })
      if (error) out.errors++
      out.added++
    } catch { out.errors++ }
  }
  return out
}

Deno.serve(async (req) => {
  const caller = await jobCaller(req)
  if (!caller) return json({ error: 'not allowed' }, 401)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const tok = Deno.env.get('GHL_TOKEN') || Deno.env.get('GHL_API_KEY') || ''
  const loc = Deno.env.get('GHL_LOCATION_ID') || ''
  if (!tok || !loc) { await beat(db, false, 'GoHighLevel key or location missing'); return json({ error: 'not set up' }, 500) }
  const st: Any = (await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()).data?.data ?? {}
  const live = st.staffing_route_live === true
  const part = String(new URL(req.url).searchParams.get('part') || 'all')
  const out: Record<string, Any> = { live }
  if (part === 'duty' || part === 'all') out.duty = await duty(db, st, tok, loc, live)
  if (part === 'tags' || part === 'all') out.tags = await tags(db, st, tok, loc, live)
  const broke = !!(out.duty?.error) || (out.tags?.errors || 0) > 0
  await beat(db, !broke, JSON.stringify(out))
  return json({ ok: true, ...out })
})
