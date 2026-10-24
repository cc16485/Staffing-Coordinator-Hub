// Supabase Edge Function: clockin-reply  (shared hub project) · C3, 2026-09-29
// -----------------------------------------------------------------------------
// A caregiver answers the missed clock-in text ("stuck in traffic, 10 min"). A GoHighLevel workflow (trigger:
// Customer Replied, contact tagged `timekeeper-asked`, which timekeeper-watch adds when it texts) POSTs the reply
// here, gated by ?token=CLOCKIN_REPLY_TOKEN (compared in constant time):
//   { id: contactId, phone, name, message }   (message LAST: GoHighLevel substitutes it raw)
// The reply is attached to that caregiver's OPEN missed clock-in from the last day (matched by her phone on the
// caregiver roster). The admins then see it on the link page and in their next reminder ("Maria replied: ..."). A
// reply with no open missed clock-in is ignored (the tag stays on her contact, so later unrelated texts arrive too).
// Nothing is sent from here, and nothing resolves the alert: a person still does that.
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { readReply, live, cantComeCase } from '../_shared/clockin-v2.ts'   // Cara Phase 3
import { opEvent } from '../_shared/events.ts'

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
const digits = (p: unknown) => String(p ?? '').replace(/\D/g, '').slice(-10)
function sameSecret(want: string, got: string): boolean {
  if (!want || want.length < 32 || got.length !== want.length) return false
  let d = 0
  for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ got.charCodeAt(i)
  return d === 0
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'not allowed' }, 405)
  const url = new URL(req.url)
  if (!sameSecret(Deno.env.get('CLOCKIN_REPLY_TOKEN') || '', url.searchParams.get('token') || '')) return json({ error: 'unauthorized' }, 401)
  const raw = await req.text()
  // deno-lint-ignore no-explicit-any
  let b: Record<string, any> = {}
  try { b = JSON.parse(raw) } catch { b = {} }
  const field = (name: string): string => {
    if (typeof b[name] === 'string') return b[name].trim()
    const m = raw.match(new RegExp('"' + name + '"\\s*:\\s*"([\\s\\S]*?)"\\s*[},]'))
    return m ? m[1].trim() : ''
  }
  let message = typeof b.message === 'string' ? b.message.trim() : ''
  if (!message) { const tm = raw.match(/"message"\s*:\s*([\s\S]*)\}\s*$/); if (tm) message = tm[1].trim().replace(/^"/, '').replace(/"$/, '').trim() }
  const phone = digits(field('phone'))
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const log = async (entry: Record<string, unknown>) => {   // metadata only, no words, no number
    try { await sb.rpc('upsert_app_data_item', { target_key: 'clockin_reply_log', item: { id: 'cr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: new Date().toISOString(), ...entry } }) } catch { /* never blocks */ }
  }
  if (!message || phone.length !== 10) { await log({ outcome: 'missing phone or message' }); return json({ ok: true, outcome: 'ignored' }) }

  const { data: cgRow } = await sb.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const cg = (Array.isArray(cgRow?.data) ? cgRow!.data : []).find((c: any) => c?.active !== false && digits(c?.phone) === phone)
  if (!cg?.axiscare_id) { await log({ outcome: 'not a caregiver on the roster' }); return json({ ok: true, outcome: 'ignored' }) }

  const { data: tkRow } = await sb.from('app_data').select('data').eq('key', 'timekeeper_cases').maybeSingle()
  const dayAgo = Date.now() - 24 * 3600e3
  // deno-lint-ignore no-explicit-any
  const open = (Array.isArray(tkRow?.data) ? tkRow!.data : []).filter((l: any) => l && l.kind !== 'clock_out' && !l.resolved_at
    && String(l.caregiver_axiscare_id) === String(cg.axiscare_id) && Date.parse(String(l.texted_at || l.opened_at || '')) > dayAgo)
    // deno-lint-ignore no-explicit-any
    .sort((a: any, c: any) => String(c.opened_at).localeCompare(String(a.opened_at)))
  if (!open.length) { await log({ outcome: 'no open missed clock-in' }); return json({ ok: true, outcome: 'no open missed clock-in' }) }
  const l = open[0]
  const nowIso = new Date().toISOString()
  l.replies = [...(Array.isArray(l.replies) ? l.replies : []), { at: nowIso, text: message.slice(0, 500) }].slice(-10)
  /* CARA PHASE 3 (2026-10-24): the reply is READ. Her rules: a reply never counts as arrival; "can't come" opens a
     call-off case at once and attendance waits for a person. Switches clockin_here_live and cant_come_case_live (off):
     the reading is still kept on the alert as practice (what Cara WOULD do), and nothing else changes. */
  const { data: stRow } = await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
  const st = stRow?.data ?? {}
  const rd = await readReply(message, { client: l.client_first, time: l.shift_time })
  const hereLive = live(st, 'clockin_here_live'), cantLive = live(st, 'cant_come_case_live')
  if (!rd.failed) {
    const would = rd.kind === 'here' ? 'the alert becomes "Call ' + l.client_first + ' to confirm arrival" (never marked arrived)'
      : rd.kind === 'cant' ? 'a call-off case opens now; attendance waits for a person'
      : rd.kind === 'unsure' ? '"Needs clarification: call them"; the missed clock-in alert keeps going'
      : rd.kind === 'late' ? 'the running-late watcher holds the office texts until the time they gave plus 5 minutes'
      : 'shown to the office as they wrote it'
    l.reply_reads = [...(Array.isArray(l.reply_reads) ? l.reply_reads : []), { at: nowIso, kind: rd.kind, quote: rd.quote,
      acted: (rd.kind === 'here' && hereLive) || (rd.kind === 'cant' && cantLive), would }].slice(-10)
    if (rd.kind === 'here' && hereLive && !l.here_claim) {
      l.here_claim = { at: nowIso, quote: rd.quote }
      const { data: oi } = await sb.from('app_data').select('data').eq('key', 'ops_items').maybeSingle()
      // deno-lint-ignore no-explicit-any
      const it = (Array.isArray(oi?.data) ? oi!.data : []).find((x: any) => String(x?.id) === `ops_tk_${l.id}`)
      if (it && it.status === 'open') await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { ...it,
        title: `Call ${l.client_first} to confirm ${String(l.caregiver).split(' ')[0]} arrived (${l.client_first} ${l.shift_time}): no clock-in yet`,
        detail: `${l.caregiver} replied${rd.quote ? `: "${rd.quote}"` : ''}. That says they're there, but a text is never arrival. `
          + `Call ${l.client_first} (or the family) to confirm they arrived and when. Then help them clock in, or confirm the times on the visit. `
          + String(it.detail || ''),
        last_activity_at: nowIso } })
    }
    if (rd.kind === 'cant' && cantLive) {
      const { data: cc } = await sb.from('app_data').select('data').eq('key', 'coverage_cases').maybeSingle()
      // deno-lint-ignore no-explicit-any
      const has = (Array.isArray(cc?.data) ? cc!.data : []).some((c: any) => c?.status === 'open' && String(c?.axiscare_visit_id ?? '') === String(l.visit_id))
      if (!has) {
        const c = cantComeCase({ visit_id: String(l.visit_id), client: String(l.client_first || ''), client_axiscare_id: l.client_axiscare_id ?? null,
          shift_date: String(l.shift_date), shift_time: String(l.shift_time || ''), caregiver: String(l.caregiver || ''), caregiver_axiscare_id: l.caregiver_axiscare_id ?? null,
          quote: rd.quote, source: 'reply', now: nowIso })
        await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: c })
        l.cant_case = c.id
        await opEvent(sb, { job: 'clockin-reply', verb: 'coverage_opened', item_id: c.id, area: 'coverage',
          summary: `Cara opened a call-off case from ${l.caregiver}'s reply ("can't come") for ${l.client_first} ${l.shift_time}; attendance waits for a person` })
      }
    }
  }
  await sb.rpc('upsert_app_data_item', { target_key: 'timekeeper_cases', item: l })
  await log({ outcome: 'attached', alert: l.id, read: rd.failed ? 'failed' : rd.kind })
  return json({ ok: true, outcome: 'attached', read: rd.failed ? null : rd.kind })
})
