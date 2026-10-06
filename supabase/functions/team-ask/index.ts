// =============================================================================
// team-ask — "Send Text Asking" from the Care Team Builder (part 1, 2026-09-27)
// =============================================================================
// A coordinator asks ONE caregiver about the shifts they're penciled into on a
// plan. The hub drafts the text from the plan; the person reads it, edits it,
// and presses Send. Nothing here runs on its own.
//
//   draft  what the composer needs: the caregiver's first name, whether a phone
//          is on the roster (last 4 only) and whether the Hub's opt-out record
//          already says no texts; the client's first name, town, the Start
//          Contract target date, the saved care line; the message template.
//          Reads only. GoHighLevel is not touched.
//   send   re-checks the board (every chosen cell still names this caregiver),
//          looks the phone up on the roster by AxisCare id (never from the
//          browser), runs the outbound gate (phone identity + the universal
//          opt-out check, which includes GoHighLevel Do Not Disturb), sends the
//          exact text the person approved, then records it: the plan's cells
//          become "asked" and plan.asks keeps the exact text, who, when; an
//          op_events line keeps the same record append-only.
//
// Office roles only (owner / care coordinator / staffing coordinator), from the
// person's own Hub sign-in. Switch: ops_settings.team_ask_live must be true.
// Replies are NOT attached here (part 2): they land in GoHighLevel as today.
// Stage 2 (2026-10-06, Samantha: "build texting several people at once"): a shift can list several people (the main one in
// plan.cells, the others in plan.options). Anyone listed on a shift can be asked about it, and the board's "Text several"
// sends one text per person through this same function, so every text gets every check on its own.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { contactForOutbound, maySendTo, normalisePhone } from '../_shared/outreach.ts'
import { optOutCheck } from '../_shared/optout.ts'
import { opEvent } from '../_shared/events.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const MAX_TEXT = 640
export const DEFAULT_TEMPLATE =
  "Hi {first_name}, it's Caring Companions. We're building a care team for {client}, a new client{where}: {when}{start}. {care}Would you be interested in these hours? Nothing is set yet - reply YES if you'd like to be considered, or NO. Questions welcome."

export const nameKey = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z]/g, '')
const first = (s: unknown) => String(s ?? '').trim().split(/\s+/)[0] || ''
const chicagoDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(d)

// deno-lint-ignore no-explicit-any
type Any = any

/** The roster entry for a caregiver: AxisCare id first, otherwise one exact, unique name. */
export function rosterFind(roster: Any[], axId: string, name: string): Any | null {
  const full = (cg: Any) => [cg?.first, cg?.last].map((x) => String(x ?? '').trim()).filter(Boolean).join(' ')
  if (axId) { const hit = roster.filter((cg) => String(cg?.axiscare_id ?? '') === axId); if (hit.length === 1) return hit[0] }
  if (!name) return null
  const byName = roster.filter((cg) => nameKey(full(cg)) === nameKey(name))
  return byName.length === 1 ? byName[0] : null
}

/** This caregiver's place on a shift: the main person, or one of the others listed (Stage 2). */
export function entryFor(plan: Any, k: string, axId: string, name: string): Any | null {
  const c = (plan?.cells ?? {})[k]
  if (cellIsTheirs(c, axId, name)) return c
  const opts = Array.isArray(plan?.options?.[k]) ? plan.options[k] : []
  return opts.find((o: Any) => !o?.applicant_id && cellIsTheirs(o, axId, name)) ?? null
}
export const ASKABLE = ['penciled', 'asked', 'no', 'maybe', 'no_reply']

/** Does this cell (still) name this caregiver? An AxisCare id on both sides must agree; otherwise the name must. */
export function cellIsTheirs(cell: Any, axId: string, name: string): boolean {
  if (!cell || !cell.name) return false
  if (axId && cell.cg_ax_id) return String(cell.cg_ax_id) === axId
  return nameKey(cell.name) === nameKey(name)
}

async function readPlans(sb: Any): Promise<Any[]> {
  const { data, error } = await sb.from('app_data').select('data').eq('key', 'staffing_plans').maybeSingle()
  if (error) throw new Error('could not read the plans')
  return Array.isArray(data?.data) ? data.data : []
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  const who = await requireStaff(sb, req, OFFICE_ROLES)
  if (!who.ok) return json({ error: who.error }, who.status)

  let b: Any = {}
  try { b = await req.json() } catch { return json({ error: 'bad request' }, 400) }
  const planId = String(b?.plan_id ?? '')
  const axId = String(b?.caregiver_axiscare_id ?? '').trim()
  const cgName = String(b?.caregiver_name ?? '').trim()
  if (!planId || (!axId && !cgName)) return json({ error: 'plan and caregiver are required' }, 400)

  let plans: Any[]
  try { plans = await readPlans(sb) } catch (e) { return json({ error: String((e as Error).message) }, 500) }
  const plan = plans.find((p) => p && p.id === planId)
  if (!plan) return json({ error: 'This plan was not found. Refresh and try again.' }, 404)

  const { data: rosterRow } = await sb.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()
  const roster: Any[] = Array.isArray(rosterRow?.data) ? rosterRow.data : []
  const cg = rosterFind(roster, axId, cgName)
  const phone = cg ? normalisePhone(cg.phone) : null
  const { data: setRow } = await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
  const st: Any = setRow?.data ?? {}
  const live = st.team_ask_live === true

  if (b.action === 'draft') {
    // the client: the plan's Journey (if linked) gives the person, the Start Contract target and the AxisCare id
    const today = chicagoDay()
    let clientFirst = first(plan.client), target: string | null = null, clientAx: string | null = null
    const { data: link } = await sb.from('team_build_link_current').select('episode_id').eq('plan_id', planId).maybeSingle()
    if (link?.episode_id) {
      const { data: ep } = await sb.from('journey_episode').select('person_id').eq('episode_id', link.episode_id).maybeSingle()
      if (ep?.person_id) {
        const { data: pi } = await sb.from('person_identity').select('display_name').eq('id', ep.person_id).maybeSingle()
        if (pi?.display_name) clientFirst = first(pi.display_name) || clientFirst
        const { data: src } = await sb.from('person_source_id').select('source_id').eq('person_id', ep.person_id)
          .eq('system', 'axiscare').eq('entity_type', 'client').maybeSingle()
        clientAx = src?.source_id ? String(src.source_id) : null
      }
      const { data: sc } = await sb.from('start_contract_current').select('target_date').eq('episode_id', link.episode_id).maybeSingle()
      target = sc?.target_date && String(sc.target_date) >= today ? String(sc.target_date) : null
    }
    let care = ''
    if (clientAx) {
      const { data: bl } = await sb.from('app_data').select('data').eq('key', 'client_care_blurbs').maybeSingle()
      const hit = (Array.isArray(bl?.data) ? bl.data : []).find((x: Any) => String(x?.id) === clientAx)
      care = String(hit?.blurb ?? '').trim()
    }
    let optedOut: string[] = []
    if (phone) {
      const v = await optOutCheck(sb, { channel: 'sms', phone, viaGhl: false })
      optedOut = v.allowed ? [] : v.reasons
    }
    return json({
      live,
      caregiver: { first: first(cg ? cg.first || cgName : cgName), on_roster: !!cg, phone_last4: phone ? phone.slice(-4) : null, opt_out: optedOut },
      client: { first: clientFirst, town: plan.city || null, start_target: target, care_line: care, linked: !!link?.episode_id },
      template: String(st.team_ask_msg || '') || DEFAULT_TEMPLATE,
      asked_before: (Array.isArray(plan.asks) ? plan.asks : [])
        .filter((a: Any) => (axId && a.caregiver_axiscare_id === axId) || nameKey(a.caregiver) === nameKey(cgName))
        .map((a: Any) => ({ id: a.id, cells: a.cells, sent_at: a.sent_at, by: a.by })),
    })
  }

  if (b.action !== 'send') return json({ error: 'unknown action' }, 400)
  if (!live) return json({ outcome: 'off', error: 'Sending from the Team Builder is switched off (ops_settings.team_ask_live). Nothing was sent.' }, 409)
  const askId = String(b?.ask_id ?? '')
  if (!/^[a-z0-9-]{8,64}$/i.test(askId)) return json({ error: 'bad ask id' }, 400)
  const message = String(b?.message ?? '').replace(/\r\n/g, '\n').trim()
  if (!message) return json({ error: 'The message is empty.' }, 400)
  if (message.length > MAX_TEXT) return json({ error: `The message is ${message.length} characters; keep it under ${MAX_TEXT}.` }, 400)
  const cells: string[] = Array.isArray(b?.cells) ? [...new Set(b.cells.map((x: unknown) => String(x)))] as string[] : []
  if (!cells.length) return json({ error: 'Pick at least one shift to ask about.' }, 400)

  if ((plan.asks ?? []).some((a: Any) => a?.id === askId)) return json({ outcome: 'already_sent', plan })
  const slots = new Set((plan.slots ?? []).map((s: Any) => String(s.k)))
  for (const k of cells) {
    const [d, s] = k.split('|')
    if (!DAYS.includes(d) || !(plan.days ?? []).includes(d) || !slots.has(s))
      return json({ outcome: 'board_changed', error: 'A shift you picked is no longer on this board. Refresh and try again.' }, 409)
    const c = entryFor(plan, k, axId, cgName)
    if (!c || !ASKABLE.includes(String(c.status)))
      return json({ outcome: 'board_changed', error: `The ${k.split('|')[0]} shift no longer has ${cgName || 'this caregiver'} on it to ask. Refresh and try again.` }, 409)
  }
  if (!cg) return json({ outcome: 'no_phone', error: `${cgName || 'This caregiver'} is not on the roster by AxisCare id or a unique name, so there is no number to text.` }, 422)
  if (!phone) return json({ outcome: 'no_phone', error: `${cgName} has no usable phone number on the roster.` }, 422)

  const ghl = { token: Deno.env.get('GHL_TOKEN') || Deno.env.get('GHL_API_KEY') || '', locationId: Deno.env.get('GHL_LOCATION_ID') ?? '' }
  if (!ghl.token || !ghl.locationId) return json({ error: 'GoHighLevel is not configured. Nothing was sent.' }, 502)
  // the number's provenance, read first only so a refusal can say which check said no
  const dest = await maySendTo(sb, phone)
  let refusal: string[] = []
  const contact = await contactForOutbound(sb, ghl, { phone, firstName: cg.first || first(cgName), lastName: cg.last },
    'urgent_internal', { audience: 'caregiver', channel: 'sms', sender: 'team-ask', humanInitiated: true,
      onOptOut: (r) => { refusal = r } })
  if (!contact) {
    const why = refusal.length ? `${cgName} has asked not to get texts (${refusal.join('; ')})`
      : !dest.allowed ? `${cgName}'s phone number isn't cleared for texting (${dest.reason}). Check the number on their profile`
      : 'the opt-out check could not be completed (GoHighLevel did not answer). Try again in a minute'
    await opEvent(sb, { verb: 'team_ask_refused', actor_name: who.name, actor_email: who.email, item_id: planId, area: 'scheduling',
      summary: `Text to ${cgName} not sent`, data: { plan_id: planId, caregiver_axiscare_id: axId || null, cells, why } })
    return json({ outcome: 'refused', error: `Not sent: ${why}. Nothing was marked as asked.` }, 422)
  }
  let sentOk = false, sendErr = ''
  try {
    const r = await fetch('https://services.leadconnectorhq.com/conversations/messages', {
      method: 'POST', headers: { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'SMS', contactId: contact.contactId, message }) })
    sentOk = r.ok; if (!r.ok) sendErr = `GoHighLevel answered ${r.status}`
  } catch { sendErr = 'could not reach GoHighLevel' }
  if (!sentOk) return json({ outcome: 'failed', error: `Not sent: ${sendErr}. Nothing was marked as asked.` }, 502)

  // record it on the CURRENT plan (fresh read, merge, write), so nobody's edits since the draft are lost
  const at = new Date().toISOString()
  const ask = { id: askId, caregiver: cgName || [cg.first, cg.last].filter(Boolean).join(' '), caregiver_axiscare_id: axId || (cg.axiscare_id ? String(cg.axiscare_id) : null),
    cells, channel: 'sms', text: message, sent_at: at, by: who.name, by_email: who.email, ghl_contact_id: contact.contactId }
  let saved: Any = null
  try {
    const fresh = (await readPlans(sb)).find((p) => p && p.id === planId)
    if (fresh) {
      fresh.asks = Array.isArray(fresh.asks) ? fresh.asks : []
      if (!fresh.asks.some((a: Any) => a?.id === askId)) fresh.asks.push(ask)
      fresh.cells = fresh.cells ?? {}
      for (const k of cells) {
        const c = entryFor(fresh, k, axId, cgName)
        if (c && c.status !== 'yes') {
          c.status = 'asked'; c.at = at; c.by = who.name; c.ask_id = askId; c.ask_channel = 'sms'
        }
      }
      const { error } = await sb.rpc('upsert_app_data_item', { target_key: 'staffing_plans', item: fresh })
      if (!error) saved = fresh
    }
  } catch { /* reported below */ }
  await opEvent(sb, { verb: 'team_ask_sent', actor_name: who.name, actor_email: who.email, item_id: planId, area: 'scheduling',
    summary: `${who.name || 'Staff'} texted ${ask.caregiver} about ${cells.length} shift${cells.length === 1 ? '' : 's'} for ${first(plan.client) || 'a client'}`,
    data: { ask_id: askId, plan_id: planId, caregiver_axiscare_id: ask.caregiver_axiscare_id, cells, message } })
  return json({ outcome: 'sent', ask, plan: saved,
    warning: saved ? null : 'The text was sent, but the board could not be updated. Mark the shifts as asked by hand.' })
})
