// =============================================================================
// ff-card-request · "MAIL ME PRINTED CARDS" from a Refer a Friend page (Friends & Family Referral Program, step 4, 2026-10-27).
// Samantha 2026-10-27: "printed card requests emailed to me". The page (mo-care.com/refer-a-friend/?p=CODE) sends the person's
// code, how many cards, and where to mail them. This checks the code belongs to a Friends & Family participant who isn't
// paused, then emails Samantha the request. Nothing for Care Coordinators. The mailing address is in the email only; the
// server keeps just the code, the count and whether the email went (ff_card_requests).
// Public on purpose (the page has no sign-in): the gateway check is off, and the door limits itself: a hidden field bots
// fill, one request per code a day, 30 a day in all. If the email can't go, the person is told to call, and a Needs
// Attention card says so (no silent failures).
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { contactForOutbound } from '../_shared/outreach.ts'
import { ghlSendChecked, reportSendProblem } from '../_shared/send-problems.ts'
import * as X from '../_shared/ff-invite-send.ts'

// deno-lint-ignore no-explicit-any
type Any = any
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const S = (v: unknown, n = 200) => String(v ?? '').trim().slice(0, n)
const CALL = 'Please call us at (417) 234-8494 and we will mail them.'
export const COUNTS = [10, 25, 50]
export const DAY_LIMIT = 30

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })
  if (req.method !== 'POST') return json({ error: 'not allowed' }, 405)
  const b: Any = await req.json().catch(() => ({}))
  if (S(b.website)) return json({ ok: true })   // the hidden field: a bot, quietly ignored
  const code = X.normalCode(b.code), mailTo = S(b.mail_to, 120), address = S(b.address, 400), note = S(b.note, 300)
  const howMany = COUNTS.includes(Number(b.how_many)) ? Number(b.how_many) : 10
  if (!code) return json({ error: "This page's link is missing its code. " + CALL }, 400)
  if (!mailTo || address.length < 10) return json({ error: 'Please add the name and the full mailing address for the cards.' }, 400)
  const { data: row } = await sb.from('app_data').select('data').eq('key', 'referral_orgs').maybeSingle()
  const orgs: Any[] = Array.isArray(row?.data) ? row!.data : []
  const org = orgs.find((o) => o && !o.archived && o.program_track === 'friends' && X.normalCode(o.partner_code) === code)
  if (!org) return json({ error: "We couldn't find this Refer a Friend link. " + CALL }, 404)
  if (String(org.program_status || '').toLowerCase() === 'paused') return json({ error: 'This link is paused right now. ' + CALL }, 409)
  const since = new Date(Date.now() - 864e5).toISOString()
  const [{ count: mine }, { count: all }] = await Promise.all([
    sb.from('ff_card_requests').select('id', { count: 'exact', head: true }).eq('code', code).gte('created_at', since),
    sb.from('ff_card_requests').select('id', { count: 'exact', head: true }).gte('created_at', since)])
  if ((mine ?? 0) >= 1) return json({ ok: true, already: true, message: "We already have your request from today. Your cards are on the way." })
  if ((all ?? 0) >= DAY_LIMIT) return json({ error: 'We have a lot of requests today. ' + CALL }, 429)

  const mail = X.cardRequestEmail({ name: S(org.name), code, who: S(org.name) || code, kind: S(org.ff_kind), client: S(org.ff_client) || undefined, mail_to: mailTo, address, how_many: howMany, note })
  const ghl = { token: Deno.env.get('GHL_TOKEN') || Deno.env.get('GHL_API_KEY') || '', locationId: Deno.env.get('GHL_LOCATION_ID') || '' }
  let ok = false, why = ''
  if (!ghl.token || !ghl.locationId) why = 'GoHighLevel is not set up on the server'
  else {
    const c = await contactForOutbound(sb, ghl, { email: X.CARD_TO, firstName: 'Samantha' }, 'routine_internal', { audience: 'staff', channel: 'email', sender: 'ff-card-request' })
    if (!c) why = 'the owner email could not be reached'
    else ok = await ghlSendChecked(sb, { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' },
      'ff-card-request', { channel: 'email', contactId: c.contactId, address: X.CARD_TO, who: 'Samantha' }, mail)
    if (!ok && !why) why = 'GoHighLevel did not take it'
  }
  await sb.from('ff_card_requests').insert({ code, org_id: S(org.id), how_many: howMany, emailed: ok, why: ok ? null : why })
  if (!ok) {
    await reportSendProblem(sb, { sender: 'ff-card-request', channel: 'email', address: X.CARD_TO, who: S(org.name),
      reasons: [`a printed card request from ${S(org.name)} (${code}, ${howMany} cards) couldn't be emailed: ${why}. Call them for the address.`] })
    return json({ error: "Sorry, your request didn't go through. " + CALL }, 502)
  }
  return json({ ok: true, message: 'Thank you! Your cards are on the way.' })
})
