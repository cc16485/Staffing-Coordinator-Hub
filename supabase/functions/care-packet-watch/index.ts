// Supabase Edge Function: care-packet-watch  (shared hub project)
// -----------------------------------------------------------------------------------------------------------------------
// CAREGIVER PACKETS, STEP 3 (Samantha "build step 3", 2026-10-12; her ruling at the start: "anyone scheduled, before their
// first shift, plus anyone added later; the Hub reminds you about anyone who hasn't tapped").
//
// Twice a day (its own schedule, x-cron-secret), for every client whose caregiver packet is READY and who is in AxisCare,
// read only: that client's visits for the next 3 days. Every caregiver with a visit that has not started yet who has not
// confirmed the CURRENT version of the packet ("I watched it and understand") is listed on ONE Needs Attention card per
// client, for the owner of Client Care: who, their next visit, and where they stand (texted and not confirmed / confirmed
// an older version / link made, not texted / nothing sent yet). The card links to the client's Care tab, where Text the
// packet / Remind is one press. It closes itself once everyone coming up has confirmed (or their visits have passed).
//
// It NEVER texts anyone (632: Cara never texts on her own). It never changes AxisCare.
// A card a person closed stays closed, unless someone NEW appears on it (a caregiver added to the schedule later).
// AxisCare not answering for a client: that client's card is left exactly as it was (never closed on a failed read).
// Switch ops_settings.care_packet_watch_live (Owners Hub Admin page), OFF to start: off, it records what it WOULD raise
// (op_events care_packet_watch_run + the automation heartbeat) and raises nothing. {dry:true} from the owner key: the
// same, at any time, writing nothing at all.
// Producer checklist: looks only forward (now to 3 days), so nothing old can flood in; one card per client by packet id
// (duplicates impossible); a dry run exists; the run line says packets seen, read, unreadable, caregivers coming up,
// missing, cards opened, updated, closed and left closed.
// -----------------------------------------------------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jobCaller } from '../_shared/job-auth.ts'
import { opEvent } from '../_shared/events.ts'
import { axVisitsReader, chiDay, standing, upcomingByCaregiver, whenWords } from '../_shared/packet-visits.ts'
// deno-lint-ignore no-explicit-any
type Any = any
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
export const WINDOW_HOURS = 72
const FALLBACK_OWNER = 'samantha@mo-care.com'
export const cardId = (packetId: string) => 'ops_cpk_' + String(packetId).replace(/[^0-9a-f]/gi, '').slice(0, 32)

const STAND_WORDS: Record<string, string> = {
  texted: 'texted, not confirmed yet',
  older: 'confirmed an older version, not the current one',
  link_only: 'link made but not texted from the Hub',
  none: 'no packet sent yet',
}
/** The card for one client, from the caregivers coming up who have not confirmed. Pure, so the test reads it directly. */
export function buildCard(p: Any, missing: Array<{ caregiver_axiscare_id: string; caregiver_name: string; next_start: string; standing: string }>, owner: string, nowIso: string) {
  const soonest = missing.map((m) => Date.parse(m.next_start)).sort((a, b) => a - b)[0]
  const within24 = soonest - Date.parse(nowIso) <= 24 * 3_600_000
  const who = p.client_first || 'a client'
  return {
    id: cardId(p.id), kind: 'care_packet_unconfirmed', domain: 'client_care', status: 'open', urgency: within24 ? 'urgent' : 'today', owner,
    title: `Care packet not confirmed before the shift: ${who} (${missing.length} caregiver${missing.length === 1 ? '' : 's'})`,
    about: p.client_first || '', axiscare_client_id: String(p.axiscare_client_id), client_ax: String(p.axiscare_client_id), link: '#p/A' + p.axiscare_client_id + '/care',
    detail: missing.map((m) => `• ${m.caregiver_name}, next visit ${whenWords(m.next_start)}: ${STAND_WORDS[m.standing] || m.standing}`).join('\n') +
      `\nNext: open ${who}'s Care tab, Caregiver packet, and press Text the packet or Remind (or call them). This card closes itself once everyone coming up has confirmed.`,
    missing_ids: missing.map((m) => m.caregiver_axiscare_id).sort(), packet_id: p.id, packet_version: p.version,
    due: new Date(Math.max(soonest - 2 * 3_600_000, Date.parse(nowIso))).toISOString(), updated_at: nowIso, created_by: 'care-packet-watch', opened_by: 'care-packet-watch',
  }
}

/** What to do with a client's card. Pure. */
export function decide(was: Any, card: Any | null): 'open' | 'update' | 'close' | 'leave_closed' | 'none' {
  const open = was && was.status !== 'done' && was.status !== 'resolved'
  if (!card) return open ? 'close' : 'none'
  if (!was) return 'open'
  if (open) return 'update'
  const before = new Set(Array.isArray(was.missing_ids) ? was.missing_ids : [])
  return card.missing_ids.some((id: string) => !before.has(id)) ? 'open' : 'leave_closed'   // someone NEW: back it comes
}

async function ownerOf(db: Any): Promise<string> {
  try {
    const { data: dom } = await db.from('domains').select('owner_person').eq('code', 'client_care').eq('entity', 'cc_ihs').maybeSingle()
    if (dom?.owner_person) { const { data: p } = await db.from('persons').select('primary_email').eq('person_id', dom.owner_person).maybeSingle(); if (p?.primary_email) return String(p.primary_email).toLowerCase() }
  } catch { /* fall back */ }
  return FALLBACK_OWNER
}

if (typeof Deno !== 'undefined' && Deno.serve) Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const caller = await jobCaller(req)
  if (!caller) return json({ error: 'not allowed' }, 401)
  let body: Any = {}
  try { body = await req.json() } catch { body = {} }
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const now = Date.now(), nowIso = new Date(now).toISOString()
  const { data: st } = await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
  const live = st?.data?.care_packet_watch_live === true
  const dry = caller === 'owner' && body?.dry === true
  const out: Any = { live, dry, packets: 0, read: 0, unreadable: 0, caregivers_upcoming: 0, missing: 0, opened: 0, updated: 0, closed: 0, left_closed: 0, would: [] }

  const { data: packets, error } = await db.from('care_packets').select('*').eq('ready', true)
  if (error) return json({ error: 'could not read the packets' }, 500)
  const list = (packets ?? []).filter((p: Any) => /^\d+$/.test(String(p.axiscare_client_id ?? '')))
  out.packets = list.length
  const read = axVisitsReader()
  const { data: itemsRow } = await db.from('app_data').select('data').eq('key', 'ops_items').maybeSingle()
  const items: Any[] = Array.isArray(itemsRow?.data) ? itemsRow.data : []
  const owner = await ownerOf(db)
  for (const p of list) {
    const visits = await read(String(p.axiscare_client_id), chiDay(0, now), chiDay(Math.ceil(WINDOW_HOURS / 24), now))
    if (!visits) { out.unreadable++; continue }   // never close or change a card on a failed read
    out.read++
    const ups = upcomingByCaregiver(visits, String(p.axiscare_client_id), now).filter((u) => Date.parse(u.next_start) - now <= WINDOW_HOURS * 3_600_000)
    out.caregivers_upcoming += ups.length
    const { data: recs, error: e2 } = await db.from('care_packet_recipients').select('caregiver_axiscare_id, ack_version, last_sent_at').eq('packet_id', p.id)
    if (e2) { out.unreadable++; continue }
    const byAx = new Map((recs ?? []).map((r: Any) => [String(r.caregiver_axiscare_id), r]))
    const missing = ups.map((u) => ({ ...u, standing: standing(byAx.get(u.caregiver_axiscare_id), p.version) })).filter((u) => u.standing !== 'confirmed')
    out.missing += missing.length
    const card = missing.length ? buildCard(p, missing, owner, nowIso) : null
    const was = items.find((x) => x && x.id === cardId(p.id))
    const what = decide(was, card)
    if (what === 'none') continue
    if (what === 'leave_closed') { out.left_closed++; continue }
    out.would.push({ client: p.client_first, what, missing: missing.map((m) => m.caregiver_name) })
    if (!live || dry) continue
    if (what === 'close') {
      await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { ...was, status: 'done', done_at: nowIso, closed_at: nowIso, closed_by: 'care-packet-watch',
        close_note: 'Everyone coming up has confirmed the packet (or their visits have passed).', updated_at: nowIso } })
      out.closed++
    } else {
      const keep = what === 'update' ? { created_at: was.created_at, owner: was.owner || card!.owner, claimed_by: was.claimed_by } : { created_at: nowIso }
      await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { ...(what === 'update' ? was : {}), ...card, ...keep,
        ...(what === 'open' ? { closed_at: null, closed_by: null, close_note: null, done_at: null } : {}) } })
      what === 'open' ? out.opened++ : out.updated++
    }
  }
  if (!dry) {
    const note = `packets ${out.packets}, read ${out.read}${out.unreadable ? ', AxisCare failed ' + out.unreadable : ''}, coming up ${out.caregivers_upcoming}, not confirmed ${out.missing}, cards opened ${out.opened}, updated ${out.updated}, closed ${out.closed}${out.left_closed ? ', left closed ' + out.left_closed : ''}${live ? '' : ' (switch off: nothing raised)'}`
    try { await db.rpc('upsert_app_data_item', { target_key: 'automation_heartbeats', item: { id: 'hb_care-packet-watch', automation: 'care-packet-watch', at: nowIso, ok: out.unreadable === 0, note } }) } catch { /* no beat */ }
    await opEvent(db, { verb: 'care_packet_watch_run', job: 'care-packet-watch', via: 'cron', summary: 'caregiver packet check: ' + note, data: { ...out, would: out.would.slice(0, 20) }, outcome: live ? 'done' : 'off' })
  }
  return json(out)
})
