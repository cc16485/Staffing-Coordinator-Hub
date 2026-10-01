// =============================================================================
// staff-contacts-check — READ ONLY, TEMPORARY (Desktop 396, 2026-10-01). Writes nothing, sends nothing, creates no
// contact. Owner key only. An office alert email failed with GoHighLevel's "Contact has no email": the Hub reached a
// staff member's GHL contact by phone and that contact has no email. For everyone who gets office alerts
// (applicant_alerts, coordinator_staff, ops_settings.coverage_alert_admins) this looks their phone and their email
// up in GoHighLevel separately and says which contact has what, with links, so the missing email can be added or
// the two contacts merged.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ownerCaller } from '../_shared/job-auth.ts'
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
const GHL = 'https://services.leadconnectorhq.com'
const e164 = (v: unknown) => { const d = String(v ?? '').replace(/\D/g, ''); return d.length >= 10 ? '+1' + d.slice(-10) : '' }
const low = (v: unknown) => String(v ?? '').trim().toLowerCase()

Deno.serve(async (req) => {
  if (!(await ownerCaller(req))) return json({ error: 'not allowed' }, 401)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const tok = Deno.env.get('GHL_TOKEN') || '', loc = Deno.env.get('GHL_LOCATION_ID') || ''
  if (!tok || !loc) return json({ error: 'GHL not set up' }, 500)
  const staff = new Map<string, { name: string; phone: string; email: string; lists: Set<string> }>()
  const add = (name: unknown, phone: unknown, email: unknown, list: string) => {
    const p = e164(phone), e = low(email); if (!p && !e) return
    const k = e || p; const o = staff.get(k) ?? { name: String(name ?? '').trim(), phone: '', email: '', lists: new Set<string>() }
    if (!o.name && name) o.name = String(name).trim(); if (!o.phone && p) o.phone = p; if (!o.email && e) o.email = e
    o.lists.add(list); staff.set(k, o)
  }
  const { data: aa } = await db.from('applicant_alerts').select('*').eq('active', true)
  for (const a of aa ?? []) add(a.name, a.phone, a.email, 'applicant / lead alerts')
  const { data: cs } = await db.from('app_data').select('data').eq('key', 'coordinator_staff').maybeSingle()
  for (const c of (Array.isArray(cs?.data) ? cs!.data : [])) add(c.name, c.phone, c.email, 'office staff list')
  const { data: os } = await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
  const admins = Array.isArray(os?.data?.coverage_alert_admins) ? os!.data.coverage_alert_admins : ['samantha@mo-care.com', 'krystal@mo-care.com']
  for (const e of admins) { const k = low(e); const o = staff.get(k); if (o) o.lists.add('call-in alerts'); else add('', '', e, 'call-in alerts') }
  const h = { Authorization: `Bearer ${tok}`, Version: '2021-07-28', Accept: 'application/json' }
  const get = async (path: string) => { const r = await fetch(GHL + path, { headers: h }); return { status: r.status, j: await r.json().catch(() => ({})) } }
  const find = async (q: string) => { const r = await get(`/contacts/search/duplicate?locationId=${loc}&${q}`); return r.j?.contact?.id ? String(r.j.contact.id) : '' }
  const link = (id: string) => id ? `https://app.hirecara.com/v2/location/${loc}/contacts/detail/${id}` : ''
  const out = []
  for (const s of staff.values()) {
    const row: Record<string, unknown> = { name: s.name || '(no name)', lists: [...s.lists], has_phone: !!s.phone, has_email: !!s.email }
    try {
      const pid = s.phone ? await find(`number=${encodeURIComponent(s.phone)}`) : ''
      const eid = s.email ? await find(`email=${encodeURIComponent(s.email)}`) : ''
      let phoneContactHasEmail: boolean | null = null
      if (pid) { const g = await get(`/contacts/${encodeURIComponent(pid)}`); phoneContactHasEmail = !!low(g.j?.contact?.email) }
      row.phone_contact = link(pid); row.email_contact = link(eid); row.phone_contact_has_email = phoneContactHasEmail
      row.problem = !s.email ? 'no email in the Hub for this person'
        : !s.phone ? ''
        : pid && eid && pid !== eid ? 'TWO contacts: phone on one, email on the other (merge them)'
        : pid && !eid && phoneContactHasEmail === false ? 'phone contact has NO email (add the email to it)'
        : pid && phoneContactHasEmail === false ? 'phone contact has no email' : ''
    } catch (e) { row.problem = 'could not check: ' + String((e as Error)?.message ?? e).slice(0, 60) }
    out.push(row)
  }
  out.sort((a, b) => String(b.problem ? 1 : 0).localeCompare(String(a.problem ? 1 : 0)) || String(a.name).localeCompare(String(b.name)))
  return json({ ok: true, people: out.length, with_problem: out.filter((x) => x.problem).length, results: out })
})
