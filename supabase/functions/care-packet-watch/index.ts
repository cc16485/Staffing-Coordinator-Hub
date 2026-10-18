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
// By itself it never texts anyone. ONE exception, chosen per client by the office (Samantha 2026-10-12: "have us mark if we want
// it sent to anyone who is scheduled with him or only send manually ... that option for each client"): a client whose packet
// is set to "Send automatically" gets the packet texted to each caregiver coming up who has not had THIS version yet (a first
// or updated text, never a reminder), 8am to 8pm Central, through care-packet's own send ('auto_send': the same texts, the
// same opt-out gate, the same records). Every client starts set to by hand. It never changes AxisCare.
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
import { noticeTo } from '../_shared/notice-to.ts'
// deno-lint-ignore no-explicit-any
type Any = any
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
export const WINDOW_HOURS = 72
/** Who a client set to automatic gets texted now: coming up, and never had THIS version (no text, a link only, or they
    confirmed an older one). Someone already texted and not confirmed is left to the office's Remind. Pure. */
export const autoTargets = (missing: Array<{ standing: string }>) => missing.filter((m) => m.standing === 'none' || m.standing === 'link_only' || m.standing === 'older')
export function inTextHours(now = new Date()): boolean {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hourCycle: 'h23' }).format(now))
  return h >= 8 && h < 20
}
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

/* SOP ruling 8 (2026-10-17): the Client care owner, else the Springfield lead, else Samantha (_shared/notice-to.ts). */
async function ownerOf(db: Any): Promise<string> {
  return (await noticeTo(db, 'client_care')).email
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
  const sendLive = st?.data?.care_packet_send_live === true
  const out: Any = { live, dry, packets: 0, read: 0, unreadable: 0, caregivers_upcoming: 0, missing: 0, opened: 0, updated: 0, closed: 0, left_closed: 0, would: [],
    auto_clients: 0, auto_sent: 0, auto_not_sent: 0, auto_would: [] }
  const hoursOk = inTextHours(new Date(now))
  /* one automatic send, through care-packet's own send path (never a second way to text) */
  const autoSend = async (packetId: string, axId: string): Promise<Any> => {
    try {
      const r = await fetch(Deno.env.get('SUPABASE_URL') + '/functions/v1/care-packet', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-cron-secret': Deno.env.get('HUB_JOB_SECRET') ?? '' },
        body: JSON.stringify({ action: 'auto_send', packet_id: packetId, caregiver_axiscare_id: axId }) })
      return await r.json().catch(() => ({ outcome: 'failed', error: 'care-packet answered ' + r.status }))
    } catch (e) { return { outcome: 'failed', error: String(e).slice(0, 120) } }
  }

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
    if (p.auto_send === true) {   // this client is set to send automatically
      out.auto_clients++
      for (const m of autoTargets(missing)) {
        if (!live || dry || !sendLive || !hoursOk) {
          out.auto_would.push({ client: p.client_first, caregiver: m.caregiver_name, why_not_now: dry ? 'dry run' : !live ? 'check switched off' : !sendLive ? 'packet texts switched off' : 'outside 8am to 8pm' })
          continue
        }
        const res = await autoSend(String(p.id), m.caregiver_axiscare_id)
        if (res?.outcome === 'sent' || res?.outcome === 'already_sent') { m.standing = 'texted'; out.auto_sent++ }
        else { out.auto_not_sent++; out.auto_would.push({ client: p.client_first, caregiver: m.caregiver_name, not_sent: res?.error || res?.outcome || 'no answer' }) }
      }
    }
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
    const note = `packets ${out.packets}, read ${out.read}${out.unreadable ? ', AxisCare failed ' + out.unreadable : ''}, coming up ${out.caregivers_upcoming}, not confirmed ${out.missing}, cards opened ${out.opened}, updated ${out.updated}, closed ${out.closed}${out.left_closed ? ', left closed ' + out.left_closed : ''}${out.auto_clients ? `, automatic clients ${out.auto_clients}, texted ${out.auto_sent}${out.auto_not_sent ? ', not sent ' + out.auto_not_sent : ''}` : ''}${live ? '' : ' (switch off: nothing raised)'}`
    try { await db.rpc('upsert_app_data_item', { target_key: 'automation_heartbeats', item: { id: 'hb_care-packet-watch', automation: 'care-packet-watch', at: nowIso, ok: out.unreadable === 0, note } }) } catch { /* no beat */ }
    await opEvent(db, { verb: 'care_packet_watch_run', job: 'care-packet-watch', via: 'cron', summary: 'caregiver packet check: ' + note, data: { ...out, would: out.would.slice(0, 20), auto_would: out.auto_would.slice(0, 20) }, outcome: live ? 'done' : 'off' })
  }
  return json(out)
})
