// =============================================================================
// convo-check — READ ONLY, TEMPORARY (Desktop 391, 2026-10-01). Writes nothing, sends nothing, creates no contact.
// Owner key only. Samantha: "can the messages sent through the hub show in the conversations in GHL? I wish we could
// see what was sent" / "yes do the check".
// From the Hub's own "this went out" stamps (last 7 days: interview confirmations + reminders, applicant nudges,
// reference requests + reminders + applicant nudges), for each person + channel: is there a GHL contact for that
// address (looked up, never created), and does that contact's GHL conversation show an outgoing message of that kind
// at about that time? Also: are this person's text and email on two DIFFERENT GHL contacts?
// Returns counts only: never names, numbers, emails or ids. ?offset=&limit= for batches.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ownerCaller } from '../_shared/job-auth.ts'
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
const GHL = 'https://services.leadconnectorhq.com'
const FIX = Date.parse('2026-10-01T17:41:00Z')   // 384: the Do Not Disturb fix went live
const e164 = (v: unknown) => { const d = String(v ?? '').replace(/\D/g, ''); return d.length >= 10 ? '+1' + d.slice(-10) : '' }
const low = (v: unknown) => String(v ?? '').trim().toLowerCase()
type Want = { key: string; source: string; channel: 'sms' | 'email'; address: string; at: string }

Deno.serve(async (req) => {
  if (!(await ownerCaller(req))) return json({ error: 'not allowed' }, 401)
  const u = new URL(req.url); const offset = Number(u.searchParams.get('offset') ?? 0), limit = Math.min(Number(u.searchParams.get('limit') ?? 10), 15)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const tok = Deno.env.get('GHL_TOKEN') || '', loc = Deno.env.get('GHL_LOCATION_ID') || ''
  if (!tok || !loc) return json({ error: 'GHL not set up' }, 500)
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const want: Want[] = []
  const add = (key: string, source: string, channel: 'sms' | 'email', raw: unknown, at: unknown) => {
    const address = channel === 'sms' ? e164(raw) : low(raw)
    if (address && at && String(at) >= since) want.push({ key, source, channel, address, at: String(at) })
  }
  // deno-lint-ignore no-explicit-any
  const { data: books } = await db.from('interview_bookings').select('id, confirmed_at, reminded_day_at, reminded_hour_at, job_applicants(phone, email, sms_consent)') as any
  for (const b of books ?? []) { const a = b.job_applicants; if (!a) continue
    for (const col of ['confirmed_at', 'reminded_day_at', 'reminded_hour_at']) {
      if (a.sms_consent === true) add('i' + b.id, 'interview messages', 'sms', a.phone, b[col])
      if (col !== 'reminded_hour_at') add('i' + b.id, 'interview messages', 'email', a.email, b[col]) } }
  const { data: apps } = await db.from('job_applicants').select('id, phone, email, sms_consent, nudge_1_at, nudge_2_at, nudge_3_at').gte('created_at', new Date(Date.now() - 21 * 86_400_000).toISOString())
  for (const p of apps ?? []) for (const col of ['nudge_1_at', 'nudge_2_at', 'nudge_3_at']) {
    if (p.sms_consent === true) add('a' + p.id, 'applicant nudges', 'sms', p.phone, (p as Record<string, unknown>)[col])
    add('a' + p.id, 'applicant nudges', 'email', p.email, (p as Record<string, unknown>)[col]) }
  const { data: refs } = await db.from('reference_requests').select('id, ref_email, sent_at, reminded_at, candidate_email, candidate_phone, applicant_nudged_at')
  for (const r of refs ?? []) {
    add('r' + r.id, 'reference requests', 'email', r.ref_email, r.sent_at); add('r' + r.id, 'reference requests', 'email', r.ref_email, r.reminded_at)
    add('c' + r.id, 'reference: nudge to the applicant', 'email', r.candidate_email, r.applicant_nudged_at) }
  // one row per person + channel + address (the latest stamp)
  const byKey = new Map<string, Want>()
  for (const w of want) { const k = w.channel + '|' + w.address; const o = byKey.get(k); if (!o || w.at > o.at) byKey.set(k, w) }
  const all = [...byKey.values()].sort((a, b) => a.channel.localeCompare(b.channel) || a.address.localeCompare(b.address))
  const batch = all.slice(offset, offset + limit)
  const h = { Authorization: `Bearer ${tok}`, Version: '2021-07-28', Accept: 'application/json' }
  const get = async (path: string) => { const r = await fetch(GHL + path, { headers: h }); return { status: r.status, j: await r.json().catch(() => ({})) } }
  const findId = async (channel: 'sms' | 'email', address: string) => {
    const q = channel === 'sms' ? `number=${encodeURIComponent(address)}` : `email=${encodeURIComponent(address)}`
    const r = await get(`/contacts/search/duplicate?locationId=${loc}&${q}`)
    return { status: r.status, id: r.j?.contact?.id ? String(r.j.contact.id) : '' }
  }
  const out = []
  for (const w of batch) {
    const res: Record<string, unknown> = { source: w.source, channel: w.channel, after_fix: Date.parse(w.at) >= FIX }
    try {
      const f = await findId(w.channel, w.address); res.lookup_status = f.status
      if (!f.id) { res.result = 'no GHL contact'; out.push(res); continue }
      // the same person's OTHER channel, from the same Hub record: same GHL contact or a second one?
      const other = all.find((x) => x.channel !== w.channel && x.key === w.key)
      if (other) { const o = await findId(other.channel, other.address); res.split = !!o.id && o.id !== f.id; res.other_found = !!o.id }
      const c = await get(`/conversations/search?locationId=${loc}&contactId=${encodeURIComponent(f.id)}`)
      const convs = Array.isArray(c.j?.conversations) ? c.j.conversations : []
      const want_t = w.channel === 'sms' ? /SMS/i : /EMAIL/i
      const from = Date.parse(w.at) - 15 * 60_000, to = Date.parse(w.at) + 15 * 60_000
      let near = false, anyOut = false
      for (const cv of convs.slice(0, 5)) {
        const m = await get(`/conversations/${encodeURIComponent(cv.id)}/messages?limit=100`)
        const msgs = Array.isArray(m.j?.messages?.messages) ? m.j.messages.messages : Array.isArray(m.j?.messages) ? m.j.messages : []
        for (const x of msgs) {
          if (x?.direction !== 'outbound' || !want_t.test(String(x?.messageType ?? x?.type ?? ''))) continue
          const t = Date.parse(x.dateAdded ?? x.createdAt ?? ''); if (t >= Date.now() - 7 * 86_400_000) anyOut = true
          if (t >= from && t <= to) near = true
        }
      }
      res.result = near ? 'shown' : anyOut ? 'other messages shown, not this one' : 'contact found, nothing sent shows'
    } catch (e) { res.result = 'could not check'; res.err = String((e as Error)?.message ?? e).slice(0, 60) }
    out.push(res)
  }
  return json({ ok: true, total: all.length, offset, results: out })
})
