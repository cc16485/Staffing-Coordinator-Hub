// =============================================================================
// missed-notes — MISSED SHIFT NOTES, M1–M3 (2026-09-29)
// =============================================================================
// Samantha approved ("go for the missed shift notes M0-M3", "yes to all"), with her corrections from M0:
//   · The obligation is the care note, not how they clocked out: an app OR web clock-out with no note is a missed
//     note (M0: web clock-outs are the office's, 0 of 22 carry GPS; the note is still owed). A missed clock-out is a
//     separate matter and is never merged with this. A phone (telephony) clock-out is not a miss by itself: only an
//     unresolved one counts.
//   · One obligation per caregiver + client + Central day (M0 proved AxisCare keeps one note per that group).
//   · 1 hour after the last clock-out of the group, one text asking them to REPLY WITH the note (her words: "Since the
//     shift has ended, the office will enter your note into AxisCare."). Texts only 8am to 9pm Central; one reminder
//     the next morning; no reply by 6pm the next day = unresolved.
//   · A reply goes to Needs Attention with the words, and a PERSON taps "Put it in AxisCare" (the note is written on
//     the visit, read back, logged). It is recorded "recovered by text" and STILL counts toward 3 in 30 days.
//   · 3 counted misses in 30 days → a DRAFT write-up in the Write-Ups list (level suggested from their history). A
//     person reviews it and sends it for approval; only Samantha or Zach can approve. Nothing is issued by the Hub.
//   · The count starts at go-live: nothing before the switch is counted.
// PRACTICE until ops_settings.missed_notes_live === true: misses are found and listed (status 'practice', never
// counted, cleared after 7 days); no text is sent, no reply is read, no write-up is drafted. ?dry=1 also reads nothing
// into the record. Caregivers only; never clients or families. Nothing here touches pay.
//
//   (schedule / owner key)            the every-15-minutes run
//   {action:'enter', id, note} (staff) "Put it in AxisCare": writes the visit's care note, reads it back, logs it
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { contactForOutbound } from '../_shared/outreach.ts'
import { jobCaller } from '../_shared/job-auth.ts'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const AC_VERSION = '2023-10-01'
export const WAIT_MIN = 60, LOOKBACK_H = 30, READ_BUDGET = 60, COUNT_DAYS = 30, DRAFT_AT = 3
export const DEFAULT_ASK = `Hi {first_name}, this is Caring Companions. We don't see a care note for your shift with {client} today. Please reply to this text with your note for that shift. Since the shift has ended, the office will enter your note into AxisCare.`
export const DEFAULT_REMIND = `Hi {first_name}, a reminder from Caring Companions: please reply with your care note for your shift with {client} on {day}. The office will enter it into AxisCare.`
export const LADDER = ['Verbal Warning', 'Written Warning', 'Final Written Warning', 'Termination Review']

// deno-lint-ignore no-explicit-any
const rowsOf = (x: any): any[] => Array.isArray(x) ? x : (x && typeof x === 'object' ? Object.values(x) : [])
export const chiDay = (d: Date | number | string) => new Date(d).toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
export const chiHour = (d: Date = new Date()) => Number(d.toLocaleString('en-US', { hour: '2-digit', hour12: false, timeZone: 'America/Chicago' }))
// deno-lint-ignore no-explicit-any
export const method = (c: any) => { const m = String(c?.method ?? '').trim().toLowerCase(); return !m ? 'none' : /tele|phone|ivr/.test(m) ? 'phone' : /mobile|app/.test(m) ? 'app' : /web/.test(m) ? 'web' : 'other' }
const digits10 = (p: unknown) => { const d = String(p ?? '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : '' }
const firstOf = (n: unknown) => String(n ?? '').trim().split(/\s+/)[0] || ''
/* "6pm the next day" in Central, as an instant (DST-safe: Central is -5 or -6; 6pm Central is 23:00 or 00:00 UTC). */
export function deadlineFor(shiftDate: string): number {
  const next = new Date(Date.parse(shiftDate + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10)
  for (const off of [5, 6]) {
    const t = Date.parse(next + 'T18:00:00Z') + off * 3600e3
    if (chiDay(t) === next && chiHour(new Date(t)) === 18) return t
  }
  return Date.parse(next + 'T23:00:00Z')
}
/* Texts only 8am to 9pm Central. */
export const textHours = (d: Date = new Date()) => { const h = chiHour(d); return h >= 8 && h < 21 }
const fill = (t: string, x: Record<string, string>) => Object.entries(x).reduce((s, [k, v]) => s.replaceAll('{' + k + '}', v), t).replace(/\s{2,}/g, ' ').trim()

function axis() {
  let token = ''
  for (const n of ['AXISCARE_API_KEY', 'AXISCARE_TOKEN', 'AXISCARE_VISITS_TOKEN']) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  return { ok: !!token && /^\d+$/.test(site), base: `https://${site}.axiscare.com`,
    head: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json', 'X-AxisCare-Api-Version': AC_VERSION } as Record<string, string> }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
/* One visit at a time, waiting when AxisCare says slow down (M0's lesson). */
// deno-lint-ignore no-explicit-any
async function readVisit(id: string): Promise<{ v: any; limited: boolean }> {
  const { base, head } = axis()
  for (let a = 0; a < 5; a++) {
    try {
      const r = await fetch(`${base}/api/visits/${id}`, { headers: head })
      if (r.status === 429) { if (a === 4) return { v: null, limited: true }; await sleep(Math.min(Math.max(Number(r.headers.get('retry-after')) || 3, 1), 20) * 1000); continue }
      if (!r.ok) return { v: null, limited: false }
      const j = await r.json().catch(() => null)
      return { v: j?.results && typeof j.results === 'object' ? (j.results.visit ?? j.results) : null, limited: false }
    } catch { return { v: null, limited: false } }
  }
  return { v: null, limited: true }
}
// deno-lint-ignore no-explicit-any
async function recordAxisChange(db: any, c: { caregiver: string; outcome: 'sent_confirmed' | 'sent' | 'refused'; summary: string; detail?: string | null; by: string }) {
  try {
    const { data, error } = await db.rpc('axiscare_change_record', { p_kind: 'care_note', p_subject: 'caregiver', p_client: null, p_caregiver: c.caregiver,
      p_outcome: c.outcome, p_summary: String(c.summary).slice(0, 200), p_detail: c.detail ? String(c.detail).slice(0, 300) : null, p_by: c.by || 'unknown', p_via: 'missed-notes' })
    return !error && data?.outcome === 'recorded'
  } catch { return false }
}

/* ── the write-up draft (M3) ── */
// deno-lint-ignore no-explicit-any
export function draftBody(name: string, level: string, misses: any[]): string {
  const d = (s: string) => new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  const how: Record<string, string> = { app: 'clocked out in the app', web: 'clocked out by the office (web)', phone: 'clocked out by phone', other: 'clocked out' }
  return ['Caring Companions In-Home Senior Care', 'CORRECTIVE ACTION (DRAFT: needs review and approval)', '',
    'Caregiver:       ' + name, 'Action level:    ' + level + ' (suggested from their history; change it if needed)',
    'Reason:          Missed care notes, ' + misses.length + ' in ' + COUNT_DAYS + ' days', '',
    'A care note is required for every shift before clock-out. These shifts ended without one:',
    ...misses.map((m) => '  - ' + d(m.shift_date) + (m.client_first ? ', ' + m.client_first : '') + ': ' + (how[m.clock_out_method] || 'clocked out') + ', no note. '
      + (m.status === 'unresolved' ? 'UNRESOLVED: no reply to the office\'s text by the deadline.' : 'Recovered by text: they replied with the note and the office entered it.')),
    '', 'Prepared by the Hub from AxisCare records. A person reviews and edits this, then sends it for approval. Only Samantha or Zach can approve; nothing is issued until they do.'].join('\n')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const body = await req.clone().json().catch(() => ({})) as Record<string, unknown>

  /* ── "Put it in AxisCare" (office staff; a person's tap) ── */
  if (body.action === 'enter') {
    const who = await requireStaff(db, req, OFFICE_ROLES)
    if (!who.ok) return json({ error: who.error }, who.status)
    const id = Number(body.id), note = String(body.note ?? '').trim().slice(0, 4000)
    if (!Number.isInteger(id) || !note) return json({ error: 'which missed note, and what should it say?' }, 400)
    const { data: row } = await db.from('missed_notes').select('*').eq('id', id).maybeSingle()
    if (!row || row.status === 'practice') return json({ error: 'no such missed note' }, 404)
    if (row.entered_at) return json({ outcome: 'already', entered_by: row.entered_by })
    const { ok, base, head } = axis(); if (!ok) return json({ error: 'AxisCare credentials not set' }, 500)
    const summary = `care note entered for ${row.shift_date} (${row.client_first || 'client'})`
    let p: Response
    try { p = await fetch(`${base}/api/visits/${row.visit_id}`, { method: 'PATCH', headers: head, body: JSON.stringify({ careNote: note }) }) }
    catch { return json({ outcome: 'refused', detail: 'could not reach AxisCare' }) }
    if (!p.ok) {
      const detail = (p.status === 403 ? 'AxisCare refused: this connection may not change visits' : 'AxisCare answered ' + p.status) + '. Enter it in AxisCare by hand.'
      await recordAxisChange(db, { caregiver: row.axiscare_caregiver_id, outcome: 'refused', summary, detail, by: who.name || who.email })
      return json({ outcome: 'refused', detail })
    }
    const back = await readVisit(row.visit_id)
    const got = typeof back.v?.careNote === 'string' ? back.v.careNote.trim() : ''
    const good = got === note
    await recordAxisChange(db, { caregiver: row.axiscare_caregiver_id, outcome: good ? 'sent_confirmed' : 'sent', summary, detail: good ? null : 'the read-back did not show it exactly', by: who.name || who.email })
    await db.from('missed_notes').update({ entered_at: new Date().toISOString(), entered_by: who.name || who.email, entered_text: note }).eq('id', id)
    return json({ outcome: good ? 'entered' : 'entered_check' })
  }

  /* ── the scheduled run ── */
  const caller = await jobCaller(req)
  if (!caller) return json({ error: 'not allowed' }, 401)
  const q = new URL(req.url).searchParams
  if (q.get('auth_check') === '1') return json({ ok: true, caller })
  const dry = q.get('dry') === '1'
  const { data: stRow } = await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const st: any = stRow?.data ?? {}
  const live = st.missed_notes_live === true && !dry
  const liveSince = typeof st.missed_notes_live_since === 'string' ? st.missed_notes_live_since : null
  const { ok: axOk, base, head } = axis()
  if (!axOk) return json({ error: 'AxisCare credentials not set' }, 500)
  const now = Date.now()
  const out = { live, dry, groups_checked: 0, with_note: 0, missed_found: 0, practice_found: 0, texted: 0, reminded: 0, replies: 0,
    unresolved: 0, drafts: 0, refused: 0, no_phone: 0, held_hours: 0, slowed_down: false }

  /* 1 · find finished groups (every visit clocked out, the last one 60+ min ago, within 30 hours) not yet looked at */
  // deno-lint-ignore no-explicit-any
  const list: any[] = []
  let url: string | null = `${base}/api/visits?startDate=${chiDay(now - 864e5)}&endDate=${chiDay(now)}`
  for (let page = 0; url && page < 20; page++) {
    const r: Response = await fetch(url, { headers: head })
    if (!r.ok) return json({ error: 'the visit list answered ' + r.status }, 502)
    // deno-lint-ignore no-explicit-any
    const j: any = await r.json().catch(() => ({}))
    for (const v of rowsOf(j?.results?.visits)) if (v && !v.removed) list.push(v)
    url = j?.results?.nextPage ?? j?.nextPage ?? null
  }
  // deno-lint-ignore no-explicit-any
  const groups = new Map<string, any[]>()
  for (const v of list) {
    const k = `${v?.caregiver?.id ?? ''}|${v?.client?.id ?? ''}|${chiDay(v?.startDate ?? v?.scheduledStartDate ?? 0)}`
    if (!v?.caregiver?.id || !v?.client?.id) continue
    if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(v)
  }
  const { data: stateRow } = await db.from('app_data').select('data').eq('key', 'missed_notes_state').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const state: any = (Array.isArray(stateRow?.data) ? stateRow!.data.find((x: any) => x?.id === 'state') : null) ?? { id: 'state', checked: {} }
  const checked: Record<string, number> = state.checked ?? {}
  for (const k of Object.keys(checked)) if (now - checked[k] > 3 * 864e5) delete checked[k]
  const { data: known } = await db.from('missed_notes').select('axiscare_caregiver_id, axiscare_client_id, shift_date, status').gte('shift_date', chiDay(now - 3 * 864e5))
  const knownKeys = new Map((known ?? []).map((r: { axiscare_caregiver_id: string; axiscare_client_id: string; shift_date: string; status: string }) =>
    [`${r.axiscare_caregiver_id}|${r.axiscare_client_id}|${r.shift_date}`, r.status]))
  let reads = 0
  const { data: rosterRow } = await db.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const roster: any[] = Array.isArray(rosterRow?.data) ? rosterRow!.data : []
  for (const [k, vs] of groups) {
    if (checked[k]) continue
    const prior = knownKeys.get(k)
    if (prior && !(prior === 'practice' && live)) continue
    const outs = vs.map((v) => v?.clockOut?.time ? Date.parse(String(v.clockOut.time)) : NaN)
    if (outs.some((t) => !Number.isFinite(t))) continue                     // someone still on the clock, or not started
    const last = Math.max(...outs)
    if (now - last < WAIT_MIN * 60e3 || now - last > LOOKBACK_H * 3600e3) continue
    if (reads + vs.length > READ_BUDGET) break
    // deno-lint-ignore no-explicit-any
    let full: any[] = []
    for (const v of vs) { const r = await readVisit(String(v.id)); reads++; if (r.limited) { out.slowed_down = true; break } if (r.v) full.push(r.v); await sleep(Number(Deno.env.get('MISSED_NOTES_PAUSE_MS') ?? '250')) }
    if (out.slowed_down) break
    if (full.length !== vs.length) continue                                   // couldn't read them all: try next run
    out.groups_checked++
    const hasNote = full.some((v) => typeof v?.careNote === 'string' && v.careNote.trim())
    if (hasNote) { out.with_note++; if (!dry) checked[k] = now; continue }
    const lastV = full.reduce((a, b) => (Date.parse(String(a?.clockOut?.time)) >= Date.parse(String(b?.clockOut?.time)) ? a : b))
    const [cgId, clId, day] = k.split('|')
    const g = roster.find((x) => String(x?.axiscare_id ?? '') === cgId)
    const cgName = g ? [g.first, g.last].filter(Boolean).join(' ').trim() : [lastV?.caregiver?.firstName, lastV?.caregiver?.lastName].filter(Boolean).join(' ').trim()
    const row = { axiscare_caregiver_id: cgId, axiscare_client_id: clId, shift_date: day, caregiver_name: cgName || null,
      client_first: firstOf(lastV?.client?.firstName) || null, visit_id: String(lastV?.id), visit_count: full.length,
      clock_out_at: new Date(last).toISOString(), clock_out_method: method(lastV?.clockOut),
      status: live && (!liveSince || day >= liveSince.slice(0, 10)) ? 'open' : 'practice', counts: false }
    if (dry) { row.status === 'open' ? out.missed_found++ : out.practice_found++; continue }
    if (prior === 'practice') await db.from('missed_notes').update(row).eq('axiscare_caregiver_id', cgId).eq('axiscare_client_id', clId).eq('shift_date', day)
    else await db.from('missed_notes').insert(row)
    row.status === 'open' ? out.missed_found++ : out.practice_found++
    checked[k] = now
  }
  if (!dry) {
    await db.rpc('upsert_app_data_item', { target_key: 'missed_notes_state', item: { id: 'state', checked, at: new Date().toISOString() } })
    await db.from('missed_notes').delete().eq('status', 'practice').lt('created_at', new Date(now - 7 * 864e5).toISOString())
  }
  if (!live) {
    if (!dry) await beat(db, true, JSON.stringify(out))
    return json({ ok: true, ...out })
  }

  /* 2 · texts (8am to 9pm Central): the first ask, and one reminder the next morning */
  const ghl = { token: Deno.env.get('GHL_TOKEN') ?? '', locationId: Deno.env.get('GHL_LOCATION_ID') ?? '' }
  const { data: open } = await db.from('missed_notes').select('*').eq('status', 'open')
  const send = async (contactId: string, message: string) => {
    try {
      const r = await fetch('https://services.leadconnectorhq.com/conversations/messages', { method: 'POST',
        headers: { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'SMS', contactId, message }) })
      return r.ok
    } catch { return false }
  }
  const tmplAsk = String(st.missed_notes_msg || '') || DEFAULT_ASK
  const tmplRemind = String(st.missed_notes_remind_msg || '') || DEFAULT_REMIND
  for (const r of open ?? []) {
    const dayWord = new Date(r.shift_date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
    const needFirst = !r.texted_at
    const needRemind = r.texted_at && !r.reminded_at && !r.replied_at && chiDay(now) > chiDay(r.texted_at)
    if (!needFirst && !needRemind) continue
    if (!textHours()) { out.held_hours++; continue }
    if (!ghl.token || !ghl.locationId) continue
    const g = roster.find((x) => String(x?.axiscare_id ?? '') === String(r.axiscare_caregiver_id) && x?.active !== false)
    const phone = digits10(g?.phone)
    if (!phone) { out.no_phone++; continue }
    const contact = await contactForOutbound(db, ghl, { phone, firstName: firstOf(r.caregiver_name) || 'there' }, 'routine_internal',
      { audience: 'caregiver', channel: 'sms', sender: 'missed-notes' })
    if (!contact) { out.refused++; continue }
    const msg = fill(needFirst ? tmplAsk : tmplRemind, { first_name: firstOf(r.caregiver_name) || 'there', client: r.client_first || 'your client', day: dayWord })
    if (!(await send(contact.contactId, msg))) continue
    if (needFirst) {
      await db.from('missed_notes').update({ texted_at: new Date().toISOString(), ghl_contact_id: contact.contactId }).eq('id', r.id)
      out.texted++
      try { await fetch(`https://services.leadconnectorhq.com/contacts/${contact.contactId}/tags`, { method: 'POST',
        headers: { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json' }, body: JSON.stringify({ tags: ['notes-asked'] }) }) } catch { /* only a label */ }
    } else { await db.from('missed_notes').update({ reminded_at: new Date().toISOString() }).eq('id', r.id); out.reminded++ }
  }

  /* 3 · replies: read their conversation (no workflow needed); an inbound text after we asked is their note */
  const { data: waiting } = await db.from('missed_notes').select('*').eq('status', 'open').not('texted_at', 'is', null).not('ghl_contact_id', 'is', null)
  const byContact = new Map<string, typeof waiting>()
  for (const r of waiting ?? []) { const a = byContact.get(r.ghl_contact_id) ?? []; a.push(r); byContact.set(r.ghl_contact_id, a) }
  const GHL = 'https://services.leadconnectorhq.com', gh = { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', Accept: 'application/json' }
  for (const [cid, rows] of byContact) {
    try {
      const since = Math.min(...rows!.map((r) => Date.parse(r.texted_at)))
      const c = await fetch(`${GHL}/conversations/search?locationId=${encodeURIComponent(ghl.locationId)}&contactId=${encodeURIComponent(cid)}&limit=5`, { headers: gh })
      const convos = c.ok ? ((await c.json())?.conversations ?? []) : []
      const words: string[] = []
      for (const cv of convos.slice(0, 3)) {
        const m = await fetch(`${GHL}/conversations/${cv.id}/messages?limit=20`, { headers: gh })
        if (!m.ok) continue
        const mb = await m.json().catch(() => ({}))
        for (const x of (mb?.messages?.messages ?? mb?.messages ?? [])) {
          if (x?.direction !== 'inbound' || Number(x?.type) !== 1) continue
          if (Date.parse(x?.dateAdded ?? '') > since && String(x?.body ?? '').trim()) words.push(String(x.body).trim())
        }
      }
      if (!words.length) continue
      const text = words.reverse().join('\n').slice(0, 2000)
      const nowIso = new Date().toISOString()
      for (const r of rows!) {
        const phoneOut = r.clock_out_method === 'phone'
        await db.from('missed_notes').update({ status: 'recovered', reply_text: text, replied_at: nowIso, resolved_at: nowIso, counts: !phoneOut }).eq('id', r.id).eq('status', 'open')
        await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { id: 'ops_mnote_' + r.id, kind: 'missed_note', domain: 'caregivers', status: 'open', urgency: 'today',
          title: `Care note by text: ${r.caregiver_name || 'a caregiver'} for ${r.client_first || 'a client'} (${r.shift_date})`,
          about: r.caregiver_name || '', caregiver: r.caregiver_name || '', missed_note_id: r.id, visit_id: r.visit_id,
          detail: (rows!.length > 1 ? 'They had more than one shift that day without a note; this reply may be for either. ' : '') + 'Their reply: ' + text,
          reply_text: text, owner: '', due: chiDay(now), created_at: nowIso, created_by: 'missed-notes', opened_by: 'missed-notes' } })
        out.replies++
      }
    } catch { /* one conversation must not stop the rest */ }
  }

  /* 4 · deadlines: no reply by 6pm the next day = unresolved (counts, more serious) */
  const { data: still } = await db.from('missed_notes').select('*').eq('status', 'open')
  for (const r of still ?? []) {
    if (now < deadlineFor(r.shift_date)) continue
    const nowIso = new Date().toISOString()
    await db.from('missed_notes').update({ status: 'unresolved', resolved_at: nowIso, counts: true }).eq('id', r.id).eq('status', 'open')
    await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { id: 'ops_mnote_' + r.id, kind: 'missed_note', domain: 'caregivers', status: 'open', urgency: 'today',
      title: `No care note and no reply: ${r.caregiver_name || 'a caregiver'} for ${r.client_first || 'a client'} (${r.shift_date})`,
      about: r.caregiver_name || '', caregiver: r.caregiver_name || '', missed_note_id: r.id, visit_id: r.visit_id,
      detail: 'They were texted and did not reply by 6pm the next day. Call them for the note; this counts as unresolved.', owner: '', due: chiDay(now),
      created_at: nowIso, created_by: 'missed-notes', opened_by: 'missed-notes' } })
    out.unresolved++
  }

  /* 5 · 3 counted misses in 30 days (from go-live) → one DRAFT write-up; each miss goes into one draft only */
  const since30 = chiDay(now - COUNT_DAYS * 864e5)
  const { data: counted } = await db.from('missed_notes').select('*').eq('counts', true).is('draft_id', null).gte('shift_date', since30)
  const perCg = new Map<string, NonNullable<typeof counted>>()
  for (const r of counted ?? []) {
    if (liveSince && r.shift_date < liveSince.slice(0, 10)) continue
    const a = perCg.get(r.axiscare_caregiver_id) ?? []; a.push(r); perCg.set(r.axiscare_caregiver_id, a)
  }
  if ([...perCg.values()].some((a) => a.length >= DRAFT_AT)) {
    const { data: daRow } = await db.from('app_data').select('data').eq('key', 'discipline_actions').maybeSingle()
    // deno-lint-ignore no-explicit-any
    const past: any[] = Array.isArray(daRow?.data) ? daRow!.data : []
    for (const [cgId, misses] of perCg) {
      if (misses.length < DRAFT_AT) continue
      misses.sort((a, b) => String(a.shift_date).localeCompare(String(b.shift_date)))
      const name = misses[misses.length - 1].caregiver_name || ('Caregiver ' + cgId)
      const year = new Date(now - 365 * 864e5).toISOString()
      const prior = past.filter((a) => String(a?.caregiver ?? '') === name && /^Missed care notes/.test(String(a?.reason ?? ''))
        && ['approved', 'issued'].includes(String(a?.status)) && String(a?.created_at ?? '') >= year).length
      const level = LADDER[Math.min(prior, LADDER.length - 1)]
      const id = 'dw_mn_' + cgId + '_' + now.toString(36)
      const item = { id, caregiver: name, axiscare_caregiver_id: cgId, level, reason: `Missed care notes: ${misses.length} in ${COUNT_DAYS} days`, category: 'documentation',
        event_ids: [], missed_note_ids: misses.map((m) => m.id), body: draftBody(name, level, misses), status: 'draft',
        created_at: new Date().toISOString(), created_by: 'the Hub (missed notes)', issued_at: null }
      const { error } = await db.rpc('upsert_app_data_item', { target_key: 'discipline_actions', item })
      if (error) continue
      await db.from('missed_notes').update({ draft_id: id }).in('id', misses.map((m) => m.id))
      out.drafts++
    }
  }
  await beat(db, true, JSON.stringify(out))
  return json({ ok: true, ...out })
})

// deno-lint-ignore no-explicit-any
async function beat(db: any, ok: boolean, note: string) {
  try {
    await db.rpc('upsert_app_data_item', { target_key: 'automation_heartbeats',
      item: { id: 'hb_missed-notes', automation: 'missed-notes', at: new Date().toISOString(), ok, note: String(note).slice(0, 300) } })
  } catch { /* never blocks */ }
}
