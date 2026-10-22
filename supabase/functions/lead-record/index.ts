// =============================================================================
// lead-record · calls and texts with a lead record themselves (Desktop 769, 2026-10-15)
// =============================================================================
// Samantha: "we shouldnt have to manually log a call or text follow up since the ai should monitor and record all of
// our calls and texts to leads". Approved mockup Part 2: https://claude.ai/artifact/MhFEgbLXTzmPCbegzHVv49
//
// Every 5 minutes: the office line's GoHighLevel conversations that changed since the last scan (plus, since 2026-10-22,
// the conversations of every lead nobody has reached yet, so a call from before they were typed in counts); for each one whose
// phone number belongs to exactly ONE lead (phone or client phone, not archived), every call and text since
// ops_settings.lead_record_since is written on that lead the way Log a call writes it (rules in _shared/lead-record.ts).
// A number on two or more leads is never guessed: it is listed for the office ("Couldn't tell whose" on Leads).
//
// PRACTICE until ops_settings.lead_record_live === true: nothing on any lead changes; each message gets a
// lead_record_seen row saying what WOULD be written, which the Hub lists for Samantha to check. Live runs start from
// lead_record_since again, so the practice days are caught up when it goes live.
// Leads are saved one at a time with lead_put_if_same: if the Hub saved that lead in between, it is read again and
// redone, never overwritten. Every GoHighLevel request here is a read. Nothing is ever sent to anyone.
// Runs on its schedule (the vault secret) or the owner's key.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jobCaller } from '../_shared/job-auth.ts'
import { opEvent } from '../_shared/events.ts'
import { fromGhl, decide, already, apply, leadsFor, matchedOn, type Msg, type Person, type Reading } from '../_shared/lead-record.ts'
import '../_shared/lead-rules.js'
// deno-lint-ignore no-explicit-any
type Any = any
const LR: Any = (globalThis as Any).LeadRules

const GHL = 'https://services.leadconnectorhq.com'
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
const H = (tok: string, v = '2021-04-15') => ({ Authorization: `Bearer ${tok}`, Version: v, Accept: 'application/json' })
export const PAGE = 100, MAX_PAGES = 10, OVERLAP_MS = 30 * 60e3, MSG_PAGES = 3, MAX_TRIES = 3, USERS_FRESH_MS = 12 * 3600e3, MAX_LOOKUPS = 60

async function beat(db: Any, ok: boolean, note: string) {
  try {
    await db.rpc('upsert_app_data_item', { target_key: 'automation_heartbeats',
      item: { id: 'hb_lead-record', automation: 'lead-record', at: new Date().toISOString(), ok, note: String(note).slice(0, 300) } })
  } catch { /* never block on the heartbeat */ }
}

/** GoHighLevel users as {userId: {email, first}} (cached 12 hours in app_data 'ghl_users', item 'people'). */
async function people(db: Any, tok: string, loc: string, st: Any): Promise<Record<string, Person>> {
  const out: Record<string, Person> = {}
  let cache: Any = null
  try { cache = ((await db.from('app_data').select('data').eq('key', 'ghl_users').maybeSingle()).data?.data ?? []).find((x: Any) => x?.id === 'people') ?? null } catch { cache = null }
  if (cache && Date.now() - Date.parse(String(cache.at || 0)) < USERS_FRESH_MS && cache.people) Object.assign(out, cache.people)
  else {
    try {
      const r = await fetch(`${GHL}/users/?` + new URLSearchParams({ locationId: loc }), { headers: H(tok, '2021-07-28') })
      if (r.ok) {
        for (const u of ((await r.json())?.users ?? []) as Any[]) {
          if (!u?.id || u.deleted === true) continue
          out[String(u.id)] = { email: String(u.email || '').toLowerCase(), first: String(u.firstName || u.name || '').trim().split(/\s+/)[0] || 'Someone in the office' }
        }
        await db.rpc('upsert_app_data_item', { target_key: 'ghl_users', item: { id: 'people', at: new Date().toISOString(), people: out } })
      }
    } catch { /* names fall back to "Someone in the office" */ }
  }
  /* her Settings map (email → user id) wins for the email */
  const map = st && typeof st.ghl_user_ids === 'object' && st.ghl_user_ids ? st.ghl_user_ids : {}
  for (const [em, id] of Object.entries(map)) {
    const k = String(id || ''); if (!k) continue
    out[k] = { email: String(em).toLowerCase(), first: out[k]?.first || String(em).split('@')[0].replace(/^./, (c) => c.toUpperCase()) }
  }
  return out
}

/** The call reader's reading of a call, if it has one (voicemail or not, and its short summary). */
async function readingOf(db: Any, id: string): Promise<Reading> {
  try {
    const { data } = await db.from('call_task_reading').select('tasks, detail, error').eq('message_id', id).order('version', { ascending: false }).limit(1)
    const r = (data ?? [])[0]
    if (!r || r.error) return null
    const summary = String(r.detail?.summary || '')
    const vm = (Array.isArray(r.tasks) && r.tasks.some((t: Any) => t?.voicemail === true)) || /\bvoice ?mail\b|left a message|no one answered|did not answer/i.test(summary)
    return { voicemail: vm, summary }
  } catch { return null }
}

Deno.serve(async (req) => {
  const caller = await jobCaller(req)
  if (!caller) return json({ error: 'not allowed' }, 401)
  const q = new URL(req.url).searchParams
  if (q.get('auth_check') === '1') return json({ ok: true, caller })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const tok = Deno.env.get('GHL_TOKEN') || Deno.env.get('GHL_API_KEY') || ''
  const loc = Deno.env.get('GHL_LOCATION_ID') || ''
  if (!tok || !loc) { await beat(db, false, 'missing GoHighLevel key/location'); return json({ error: 'not set up' }, 500) }
  const st: Any = (await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()).data?.data ?? {}
  const since = Date.parse(String(st.lead_record_since || ''))
  if (!Number.isFinite(since)) { await beat(db, false, 'no lead_record_since set'); return json({ error: 'no start time set' }, 500) }
  const live = st.lead_record_live === true && q.get('dry') !== '1'
  const mode = live ? 'live' : 'practice'
  const out: Record<string, Any> = { mode, conversations: 0, matched: 0, messages: 0, recorded: 0, would_record: 0, already: 0, waiting: 0, several: 0, leads_saved: 0, retries: 0, errors: 0, reached_back: true }

  /* 1 · the leads, and where the last scan reached */
  const leadsRow = (await db.from('app_data').select('data').eq('key', 'leads').maybeSingle()).data
  let leads: Any[] = Array.isArray(leadsRow?.data) ? leadsRow.data : []
  const stateRow = (await db.from('lead_record_state').select('scanned_to').eq('mode', mode).maybeSingle()).data
  const scanned = Date.parse(String(stateRow?.scanned_to || ''))
  const floor = Math.max(since, Number.isFinite(scanned) ? scanned - OVERLAP_MS : since)
  const users = await people(db, tok, loc, st)

  /* 2 · conversations changed since then, newest first, page by page */
  const convos: Any[] = []
  let after: string | null = null, newest = 0
  for (let p = 0; p < MAX_PAGES; p++) {
    const u = new URLSearchParams({ locationId: loc, limit: String(PAGE), sortBy: 'last_message_date', sort: 'desc' })
    if (after) u.set('startAfterDate', after)
    const r = await fetch(`${GHL}/conversations/search?${u}`, { headers: H(tok) })
    if (!r.ok) { await beat(db, false, `conversations/search ${r.status}`); return json({ error: `GoHighLevel answered ${r.status}` }, 502) }
    const page: Any[] = (await r.json())?.conversations || []
    let older = false
    for (const c of page) {
      const t = Number(c.lastMessageDate || 0)
      newest = Math.max(newest, t)
      if (t && t < floor) { older = true; break }
      convos.push(c)
    }
    if (older || page.length < PAGE) break
    const last = page[page.length - 1]
    after = String((Array.isArray(last?.sort) && last.sort[0]) || last?.lastMessageDate || '')
    if (!after) break
    if (p === MAX_PAGES - 1) out.reached_back = false
  }
  /* 2b · (Samantha 2026-10-22: "lead that call into the office are being treated as a lead that need followed up
     immediately like a website lead form ... he called in as a lead and already spoke to Krystal"). A family who calls
     BEFORE anyone types them in: when the scan saw that call it matched no lead, and the scan above only looks at
     conversations that changed since the last run, so the call never reached the lead and its first-call clock kept
     running. So every lead nobody has reached yet gets its own conversations looked up (by contact, and by number). */
  const have = new Set(convos.map((c) => String(c.id)))
  const unreached = leads.filter((l: Any) => l && l.id && l.archived !== true && !l.first_human_contact_at && String(l.status || 'New') !== 'Lost')
  const lookups: Record<string, string>[] = []
  for (const l of unreached) {
    if (l.ghl_contact_id) lookups.push({ contactId: String(l.ghl_contact_id) })
    for (const p of [l.phone, l.client_phone]) { const d = String(p || '').replace(/\D/g, '').slice(-10); if (d.length === 10) lookups.push({ query: d }) }
  }
  const asked = new Set<string>()
  out.unreached = unreached.length; out.looked_up = 0
  for (const f of lookups) {
    const k = JSON.stringify(f)
    if (asked.has(k)) continue
    if (asked.size >= MAX_LOOKUPS) { out.lookups_capped = true; break }
    asked.add(k)
    const r = await fetch(`${GHL}/conversations/search?` + new URLSearchParams({ locationId: loc, limit: '20', ...f }), { headers: H(tok) })
    if (!r.ok) { out.errors++; continue }
    for (const c of ((await r.json().catch(() => ({})))?.conversations || []) as Any[]) {
      if (!c?.id || have.has(String(c.id))) continue
      have.add(String(c.id)); convos.push(c); out.looked_up++
    }
  }
  out.conversations = convos.length

  /* 3 · messages that still need looking at: everything new in matched conversations, plus short calls left waiting */
  const seenRows = (await db.from('lead_record_seen').select('message_id, status, tries, lead_id, contact_name').eq('mode', mode).gte('msg_at', new Date(since).toISOString())).data ?? []
  const seen = new Map(seenRows.map((r: Any) => [r.message_id, r]))
  const final = (id: string) => { const s = seen.get(id); return !!s && !(s.status === 'waiting' || (s.status === 'error' && s.tries < MAX_TRIES)) }
  /* 772 (her safeguards): each row keeps GoHighLevel's name for the contact and which of the lead's numbers matched,
     so the office can check every row went to the right family before this is switched on */
  type Item = { m: Msg; cands: Any[]; who: string; phone: string }
  const items: Item[] = []
  for (const c of convos) {
    const cands = leadsFor(leads, String(c.phone || ''))
    if (!cands.length) continue
    out.matched++
    let lastId = ''
    for (let p = 0; p < MSG_PAGES; p++) {
      const r = await fetch(`${GHL}/conversations/${encodeURIComponent(c.id)}/messages?limit=100` + (lastId ? `&lastMessageId=${encodeURIComponent(lastId)}` : ''), { headers: H(tok) })
      if (!r.ok) { out.errors++; break }
      const b = await r.json().catch(() => ({}))
      const msgs: Any[] = b?.messages?.messages || b?.messages || []
      let reachedOld = false
      for (const raw of msgs) {
        const m = fromGhl(raw, String(c.contactId || ''))
        if (!m) continue
        if (Date.parse(m.at) < since) { reachedOld = true; continue }
        if (!final(m.id)) items.push({ m, cands, who: String(c.fullName || c.contactName || '').replace(/\s+/g, ' ').trim().slice(0, 80), phone: String(c.phone || '') })
      }
      if (reachedOld || !b?.messages?.nextPage || !msgs.length) break
      lastId = String(msgs[msgs.length - 1]?.id || ''); if (!lastId) break
    }
  }
  /* short outbound calls left waiting for the call reader are fetched again by their own id */
  const queued = new Set(items.map((x) => x.m.id))
  for (const w of seenRows.filter((r: Any) => r.status === 'waiting' && !queued.has(r.message_id))) {
    const lead = leads.find((l: Any) => String(l?.id) === String(w.lead_id || ''))
    if (!lead || lead.archived === true) continue
    const r = await fetch(`${GHL}/conversations/messages/${encodeURIComponent(w.message_id)}`, { headers: H(tok) })
    if (!r.ok) { out.errors++; continue }
    const j = await r.json().catch(() => ({}))
    const m = fromGhl(j?.message ?? j)
    if (m) items.push({ m, cands: [lead], who: String(w.contact_name || ''), phone: String(lead.phone || '') })
  }
  out.messages = items.length
  items.sort((a, b) => a.m.at.localeCompare(b.m.at))

  /* 4 · decide each one; group the writes by lead */
  const rows: Any[] = []
  const byLead = new Map<string, Array<{ m: Msg; d: Any }>>()
  const extra = new Map<string, Any>()
  for (const { m, cands, who, phone } of items) {
    const base: Any = { message_id: m.id, mode, msg_at: m.at, kind: m.kind, tries: (seen.get(m.id)?.tries ?? 0) + 1, seen_at: new Date().toISOString(), contact_name: who || null, matched_on: cands.length === 1 ? (matchedOn(cands[0], phone) || null) : null }
    extra.set(m.id, { contact_name: base.contact_name, matched_on: base.matched_on })
    if (cands.length > 1) {
      const d: Any = decide(m, users[m.userId] ?? null, null, Number.MAX_SAFE_INTEGER)   // never waits: a person picks the lead
      rows.push({ ...base, status: 'several', candidates: cands.map((l) => String(l.id)), line: d.line, ev: { ...d.ev, ref: 'ghl:' + m.id, at: m.at } })
      out.several++; continue
    }
    const reading = m.kind === 'call' && m.dir === 'out' ? await readingOf(db, m.id) : null
    const d = decide(m, users[m.userId] ?? null, reading)
    if (d.wait) { rows.push({ ...base, status: 'waiting', lead_id: String(cands[0].id), line: null, note: 'waiting for the call reader' }); out.waiting++; continue }
    const id = String(cands[0].id)
    if (!byLead.has(id)) byLead.set(id, [])
    byLead.get(id)!.push({ m, d })
  }

  /* 5 · each lead: read fresh, add what is new, save only if nobody changed it meanwhile (3 tries) */
  for (const [id, list] of byLead) {
    let done = false
    for (let t = 0; t < 3 && !done; t++) {
      if (t > 0) { out.retries++; leads = ((await db.from('app_data').select('data').eq('key', 'leads').maybeSingle()).data?.data) ?? [] }
      const before = leads.find((l: Any) => String(l?.id) === id)
      if (!before) break
      const lead = structuredClone(before)
      const res: Array<{ m: Msg; status: string; line: string; first: boolean; ev: Any }> = []
      for (const { m, d } of list) {
        const a = already(lead, m, d.ev)
        if (a) { res.push({ m, status: 'already', line: d.line, first: false, ev: null }); continue }
        const first = apply(lead, m, d, LR)
        res.push({ m, status: live ? 'recorded' : 'would_record', line: d.line, first, ev: { ...d.ev, ref: 'ghl:' + m.id, at: m.at } })
      }
      const changed = res.some((r) => r.status !== 'already')
      if (live && changed) {
        const { data: okSave, error } = await db.rpc('lead_put_if_same', { p_id: id, p_before: before, p_after: lead })
        if (error) { out.errors++; for (const r of res) rows.push({ message_id: r.m.id, mode, msg_at: r.m.at, kind: r.m.kind, status: 'error', lead_id: id, line: r.line, note: String(error.message).slice(0, 200), tries: (seen.get(r.m.id)?.tries ?? 0) + 1 }); done = true; break }
        if (okSave !== true) continue
        out.leads_saved++
        const who = [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim() || 'a lead'
        for (const r of res.filter((x) => x.first)) await opEvent(db, { verb: 'lead_connected', item_id: id, area: 'growth_leads', job: 'lead-record',
          summary: `First real conversation with ${who} (recorded from the office line)` })
      }
      for (const r of res) {
        rows.push({ ...extra.get(r.m.id), message_id: r.m.id, mode, msg_at: r.m.at, kind: r.m.kind, status: r.status, lead_id: id, line: r.line, ev: r.ev, tries: (seen.get(r.m.id)?.tries ?? 0) + 1, seen_at: new Date().toISOString() })
        if (r.status === 'already') out.already++; else if (live) out.recorded++; else out.would_record++
      }
      done = true
    }
    if (!done) { out.errors++; for (const { m, d } of list) rows.push({ message_id: m.id, mode, msg_at: m.at, kind: m.kind, status: 'error', lead_id: id, line: d.line, note: 'the lead kept changing; tried 3 times', tries: (seen.get(m.id)?.tries ?? 0) + 1 }) }
  }

  /* 6 · the record of what was done, and how far the scan reached */
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from('lead_record_seen').upsert(rows.slice(i, i + 200), { onConflict: 'message_id,mode' })
    if (error) { out.errors++; out.save_failed = true }
  }
  if (out.reached_back && newest) await db.from('lead_record_state').upsert({ mode, scanned_to: new Date(newest).toISOString(), updated_at: new Date().toISOString() })
  await beat(db, out.errors === 0, JSON.stringify(out))
  return json({ ok: true, ...out })
})
