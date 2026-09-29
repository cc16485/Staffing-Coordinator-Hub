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
  l.replies = [...(Array.isArray(l.replies) ? l.replies : []), { at: new Date().toISOString(), text: message.slice(0, 500) }].slice(-10)
  await sb.rpc('upsert_app_data_item', { target_key: 'timekeeper_cases', item: l })
  await log({ outcome: 'attached', alert: l.id })
  return json({ ok: true, outcome: 'attached' })
})
