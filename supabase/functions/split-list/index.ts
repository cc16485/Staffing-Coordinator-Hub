// =============================================================================
// split-list — READ ONLY, TEMPORARY (Desktop 392, 2026-10-01). Writes nothing, sends nothing, creates no contact.
// Owner key only. 391 found 20 of 28 people with their texts on one GoHighLevel contact and their emails on another.
// For the people the Hub knows (applicants from the last 90 days, and reference-request applicants), this looks each
// person's phone and email up in GoHighLevel separately and, where they land on two DIFFERENT contacts, returns the
// person's name and a link to each contact, so the office can merge the pair in GoHighLevel (Contacts → merge).
// ?offset=&limit= for batches.
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
  const { data: apps } = await db.from('job_applicants').select('first_name, last_name, phone, email').gte('created_at', new Date(Date.now() - 90 * 86_400_000).toISOString())
  for (const a of apps ?? []) add([a.first_name, a.last_name].filter(Boolean).join(' '), a.phone, a.email)
  const { data: refs } = await db.from('reference_requests').select('candidate_name, candidate_phone, candidate_email')
  for (const r of refs ?? []) add(r.candidate_name, r.candidate_phone, r.candidate_email)
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
      if (a.id && b.id && a.id !== b.id) out.push({ name: p.name, texts_contact: link(a.id), emails_contact: link(b.id) })
    } catch { errors++ }
  }
  return json({ ok: true, total: all.length, offset, checked, errors, split: out })
})
