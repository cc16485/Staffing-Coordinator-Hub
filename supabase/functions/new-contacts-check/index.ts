// =============================================================================
// new-contacts-check — READ ONLY, TEMPORARY (Desktop 397). Writes nothing, sends nothing, creates no contact.
// Owner key only. Samantha 2026-10-01: "yes check the first few". Since 393 (2026-10-01 19:03 UTC) the Hub adds a
// missing phone/email to a person's existing GoHighLevel contact instead of creating a second. For applicants who
// applied AFTER that (and have both a phone and an email), this looks the phone and the email up in GoHighLevel
// separately and says: ONE contact (working), TWO contacts (split), or not in GoHighLevel yet (not messaged yet).
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ownerCaller } from '../_shared/job-auth.ts'
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
const GHL = 'https://services.leadconnectorhq.com'
const e164 = (v: unknown) => { const d = String(v ?? '').replace(/\D/g, ''); return d.length >= 10 ? '+1' + d.slice(-10) : '' }
const low = (v: unknown) => String(v ?? '').trim().toLowerCase()

Deno.serve(async (req) => {
  if (!(await ownerCaller(req))) return json({ error: 'not allowed' }, 401)
  const u = new URL(req.url); const offset = Number(u.searchParams.get('offset') ?? 0), limit = Math.min(Number(u.searchParams.get('limit') ?? 15), 20)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const tok = Deno.env.get('GHL_TOKEN') || '', loc = Deno.env.get('GHL_LOCATION_ID') || ''
  if (!tok || !loc) return json({ error: 'GHL not set up' }, 500)
  const people = new Map<string, { name: string; phone: string; email: string }>()
  const add = (name: unknown, phone: unknown, email: unknown) => {
    const p = e164(phone), e = low(email); if (!p || !e) return
    const k = p + '|' + e; if (!people.has(k)) people.set(k, { name: String(name ?? '').trim() || '(no name in the Hub)', phone: p, email: e })
  }
  const { data: apps } = await db.from('job_applicants').select('first_name, last_name, phone, email, created_at').gte('created_at', '2026-10-01T19:03:00Z')
  for (const a of apps ?? []) add([a.first_name, a.last_name].filter(Boolean).join(' '), a.phone, a.email)
  const all = [...people.values()].sort((a, b) => a.name.localeCompare(b.name))
  const h = { Authorization: `Bearer ${tok}`, Version: '2021-07-28', Accept: 'application/json' }
  const find = async (q: string) => { const r = await fetch(`${GHL}/contacts/search/duplicate?locationId=${loc}&${q}`, { headers: h }); const j = await r.json().catch(() => ({})); return { status: r.status, id: j?.contact?.id ? String(j.contact.id) : '' } }
  const link = (id: string) => `https://app.hirecara.com/v2/location/${loc}/contacts/detail/${id}`
  const out: Array<Record<string, unknown>> = []; let checked = 0, errors = 0
  for (const p of all.slice(offset, offset + limit)) {
    try {
      const a = await find(`number=${encodeURIComponent(p.phone)}`), b = await find(`email=${encodeURIComponent(p.email)}`)
      if (a.status !== 200 || b.status !== 200) { errors++; continue }
      checked++
      out.push({ name: p.name, result: a.id && b.id ? (a.id === b.id ? 'one contact' : 'TWO contacts') : a.id || b.id ? 'one contact (only one detail in GHL so far)' : 'not in GoHighLevel yet',
        ...(a.id && b.id && a.id !== b.id ? { texts_contact: link(a.id), emails_contact: link(b.id) } : {}) })
    } catch { errors++ }
  }
  return json({ ok: true, total: all.length, offset, checked, errors, results: out })
})
