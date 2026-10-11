// Supabase Edge Function: interview-reply  (shared hub project) · 587, 2026-10-11
// -----------------------------------------------------------------------------
// Samantha: "if they reply no they aren't coming to the interview the next day, make sure that opens up the interview
// spot for someone else."
//
// The day-before reminder (and a next-day confirmation) asks "Reply YES so we know you're coming, or NO if you can't
// make it". Sending it tags their GoHighLevel contact `interview-asked`. A GoHighLevel workflow (trigger: Customer
// Replied, contact has tag interview-asked) POSTs the reply here, gated by ?token=INTERVIEW_REPLY_TOKEN (constant time):
//   { id: contactId, phone, name, message }   (message LAST: GoHighLevel substitutes it raw)
//
// What happens:
//   a clear NO   that interview is cancelled at once (any hour) and its time goes back on the calendar
//                (interview_cancel_by_reply). interview-messages then sends the usual cancellation text with their link
//                to a new time (8am to 6pm) and gives the office its "they cancelled" heads-up.
//   a clear YES  kept on the booking. Nothing else changes yet (YES confirming the interview comes after it is tested).
//   anything else ("no problem, see you then", "running late", "can I move it?") or a reply we can't match to exactly
//                one upcoming interview: NOTHING is changed; a Needs Attention item shows the office their exact words.
// Strict matching: the phone on the application, exactly one booked interview starting in the next 36 hours, and that
// interview was sent the question (reminded_day_at). Nothing is ever sent from here.
// Only while ops_settings.applicant_msgs_v2_live is on (before that, no message asks YES / NO).
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { classify } from '../_shared/reply-classify.ts'

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '').slice(-10)
function sameSecret(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'not allowed' }, 405)
  const url = new URL(req.url)
  if (!sameSecret(Deno.env.get('INTERVIEW_REPLY_TOKEN') || '', url.searchParams.get('token') || '')) return json({ error: 'unauthorized' }, 401)
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
  const log = async (entry: Record<string, unknown>) => {   // metadata only: no words, no number
    try { await sb.rpc('upsert_app_data_item', { target_key: 'interview_reply_log', item: { id: 'ir_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: new Date().toISOString(), ...entry } }) } catch { /* never blocks */ }
  }
  const officeItem = async (id: string, title: string, detail: string, urgency: 'high' | 'normal') => {
    try {
      await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: {
        id, kind: 'interview_reply', title, about: '', detail, domain: 'hiring', status: 'open', urgency,
        created_at: new Date().toISOString(), due: new Date(Date.now() + 2 * 3600e3).toISOString(),
        owner: '', owner_name: '', created_by: 'interview-reply', opened_by: 'interview reminder reply' } })
    } catch { /* the log still has it */ }
  }
  if (!message || phone.length !== 10) { await log({ outcome: 'missing phone or message' }); return json({ ok: true, outcome: 'ignored' }) }

  const { data: opsRow } = await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const ops: any = opsRow?.data && typeof opsRow.data === 'object' ? opsRow.data : {}
  if (ops.applicant_msgs_v2_live !== true) { await log({ outcome: 'switch off, recorded only' }); return json({ ok: true, outcome: 'switch off' }) }

  const kind = classify(message)
  const words = message.slice(0, 300)
  // their applications (by the phone on the application), then their booked interview in the next 36 hours that was asked
  const { data: apps } = await sb.from('job_applicants').select('id, first_name, last_name, phone').ilike('phone', '%' + phone.slice(-4))
  // deno-lint-ignore no-explicit-any
  const mine = (apps ?? []).filter((a: any) => digits(a.phone) === phone)
  const name = mine[0] ? [mine[0].first_name, mine[0].last_name].filter(Boolean).join(' ') : 'Someone'
  let bookings: Array<Record<string, unknown>> = []
  if (mine.length) {
    const { data } = await sb.from('interview_bookings').select('id, applicant_id, starts_at, reminded_day_at, status')
      // deno-lint-ignore no-explicit-any
      .in('applicant_id', mine.map((a: any) => a.id)).eq('status', 'booked')
      .gte('starts_at', new Date(Date.now() - 30 * 60e3).toISOString()).lte('starts_at', new Date(Date.now() + 36 * 3600e3).toISOString())
    bookings = (data ?? []).filter((x) => !!x.reminded_day_at)
  }
  if (bookings.length !== 1) {
    await log({ outcome: bookings.length ? 'more than one interview, sent to the office' : 'no upcoming interview found, sent to the office', kind })
    await officeItem('ops_ivreply_' + Date.now().toString(36), `${name} replied to an interview reminder: please read`,
      `They replied "${words}". We couldn't match it to exactly one upcoming interview, so nothing was changed. Please check their page and answer them.`,
      kind === 'no' ? 'high' : 'normal')
    return json({ ok: true, outcome: 'to the office' })
  }
  const bk = bookings[0]
  const when = new Date(String(bk.starts_at)).toLocaleString('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' })
  if (kind === 'no') {
    const { data: r, error } = await sb.rpc('interview_cancel_by_reply', { p_booking: bk.id, p_words: words })
    if (error || !r?.cancelled) {
      await log({ outcome: 'NO, but the cancel did not go through', kind })
      await officeItem('ops_ivreply_' + String(bk.id), `${name} said NO to their interview (${when}), but it could not be cancelled automatically`,
        `They replied "${words}". Please cancel it in the Hub so the time opens up.`, 'high')
      return json({ ok: true, outcome: 'to the office' })
    }
    await log({ outcome: 'NO: cancelled, time freed', kind })
    return json({ ok: true, outcome: 'cancelled' })
  }
  await sb.rpc('interview_record_reply', { p_booking: bk.id, p_kind: kind, p_words: words })
  if (kind === 'other') {
    await officeItem('ops_ivreply_' + String(bk.id), `${name} replied about their interview (${when}): please answer`,
      `They replied "${words}". Nothing was changed. Please answer them (their texts are on their Hub page and in GoHighLevel).`, 'normal')
  }
  await log({ outcome: kind === 'yes' ? 'YES recorded' : 'other: sent to the office', kind })
  return json({ ok: true, outcome: kind })
})
