// TEMPORARY (Desktop 384, removed by the same run). NO SILENT FAILURES catch-up: every text or email the opt-out
// check held back since 2026-09-24 (83 found by 382, most from the Do Not Disturb mix-up fixed 2026-10-01) becomes a
// Needs Attention card, exactly as a new one would. Nothing is sent. Owner's server key only. ?dry=1 counts only.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ownerCaller } from '../_shared/job-auth.ts'
import { reportSendProblem } from '../_shared/send-problems.ts'

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
const last10 = (v: unknown) => String(v ?? '').replace(/\D/g, '').slice(-10)
const low = (v: unknown) => String(v ?? '').trim().toLowerCase()
const SINCE = '2026-09-24T00:00:00Z'

Deno.serve(async (req) => {
  if (!(await ownerCaller(req))) return json({ error: 'not allowed' }, 401)
  const dry = new URL(req.url).searchParams.get('dry') === '1'
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: rows, error } = await db.from('contact_send_refusal').select('sender, channel, address, reasons, at').gte('at', SINCE).order('at')
  if (error) return json({ error: 'could not read the refusal log' }, 500)
  // names, so a card says who (applicants and references; anyone else shows their number or email)
  const names = new Map<string, string>()
  const { data: apps } = await db.from('job_applicants').select('first_name, last_name, phone, email').gte('created_at', '2026-07-01T00:00:00Z')
  for (const a of apps ?? []) { const n = [a.first_name, a.last_name].filter(Boolean).join(' '); if (!n) continue
    if (last10(a.phone)) names.set('p' + last10(a.phone), n); if (low(a.email)) names.set('e' + low(a.email), n) }
  const { data: refs } = await db.from('reference_requests').select('ref_name, ref_email, ref_phone, candidate_name, candidate_phone, candidate_email')
  for (const r of refs ?? []) {
    if (r.ref_name && low(r.ref_email)) names.set('e' + low(r.ref_email), r.ref_name + ' (reference for ' + (r.candidate_name ?? '?') + ')')
    if (r.ref_name && last10(r.ref_phone)) names.set('p' + last10(r.ref_phone), r.ref_name + ' (reference for ' + (r.candidate_name ?? '?') + ')')
    if (r.candidate_name && last10(r.candidate_phone) && !names.has('p' + last10(r.candidate_phone))) names.set('p' + last10(r.candidate_phone), r.candidate_name)
    if (r.candidate_name && low(r.candidate_email) && !names.has('e' + low(r.candidate_email))) names.set('e' + low(r.candidate_email), r.candidate_name)
  }
  // one card per sender + channel + address, the same card a new problem would land on
  const groups = new Map<string, { sender: string; channel: 'sms' | 'email'; address: string; reasons: string[]; count: number; first_at: string; last_at: string }>()
  for (const r of rows ?? []) {
    const k = r.sender + '|' + r.channel + '|' + r.address
    const g = groups.get(k)
    if (g) { g.count++; g.last_at = r.at; g.reasons = r.reasons }
    else groups.set(k, { sender: r.sender, channel: r.channel, address: r.address, reasons: r.reasons, count: 1, first_at: r.at, last_at: r.at })
  }
  const bySender: Record<string, number> = {}
  for (const g of groups.values()) bySender[g.sender] = (bySender[g.sender] ?? 0) + 1
  if (!dry) for (const g of groups.values()) {
    const who = names.get((g.channel === 'sms' ? 'p' + last10(g.address) : 'e' + low(g.address))) ?? ''
    const mixup = (g.reasons ?? []).some((x: string) => /could not check GHL Do Not Disturb|GHL returned no contact|could not return this contact/.test(x))
    await reportSendProblem(db, { sender: g.sender, channel: g.channel, address: g.address, who, reasons: g.reasons, count: g.count,
      first_at: g.first_at, last_at: g.last_at, cap: 500,
      note: mixup ? 'Held back between Sep 24 and Oct 1 by a Hub mix-up (fixed Oct 1). Check whether they still need this; an interview reminder for a date that has passed needs nothing.' : '' })
  }
  return json({ ok: true, dry, refusals: (rows ?? []).length, cards: groups.size, named: [...groups.values()].filter((g) => names.has(g.channel === 'sms' ? 'p' + last10(g.address) : 'e' + low(g.address))).length, by_sender: bySender })
})
