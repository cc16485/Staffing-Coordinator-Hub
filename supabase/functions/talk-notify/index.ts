// Supabase Edge Function: talk-notify  (shared hub project)
// -----------------------------------------------------------------------------
// TO TALK ABOUT: TAGS, A THREAD, AND AN EMAIL (Desktop 473, Samantha 2026-10-06: "can we tag who we want to talk to
// about it - and let us have a thread? ... maybe email a note that shows the full card that someone has tagged you in";
// she approved the plan and mockup: "yes build it").
//
//   POST {item_id}   signed-in office staff, right after they add a note, a reply or a tag in the Hub. Everyone on the
//                    item's thread (tagged, whoever wrote in it, the person it sits with) except the writer gets ONE email
//                    with the full card: what it is, the client, the details from My Work, the whole thread, and a button
//                    to open it in the Hub. Someone emailed about this item in the last 10 minutes is not emailed again
//                    now; they are marked to get the latest in one email when the 10 minutes are up (?flush=1).
//   POST ?flush=1    every 5 minutes (its schedule's vault secret, or the owner's key): sends those waiting emails.
//
// WHO CAN BE EMAILED: only active Caring Companions office staff (a cc_ihs office role), looked up here. Nothing in the
// request picks an address or writes the words: the item, the thread and the card are read from the database, so this
// can't be used to email anyone else or send anything else. Off until ops_settings.talk_email_live is true; while off it
// only answers who WOULD be emailed. Staff only, never clients or families. A refused send raises a card (no silent
// failures).
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES, ENTITY } from '../_shared/staff-auth.ts'
import { jobCaller } from '../_shared/job-auth.ts'
import { ghlStaffContact } from '../_shared/staff-contact.ts'
import { reportSendProblem } from '../_shared/send-problems.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const HUB = 'https://cc.mo-care.com'
export const WAIT_MS = 10 * 60e3
const NAVY = '#0E3860', HONEY = '#FFC671', GRAY = '#6B7280', BORDER = '#E7EDF4'
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const lc = (s: unknown) => String(s ?? '').trim().toLowerCase()
const first = (s: unknown) => String(s ?? '').trim().split(/\s+/)[0] || ''
// deno-lint-ignore no-explicit-any
type Any = any

// deno-lint-ignore no-explicit-any
async function readKey(db: any, key: string): Promise<Any[]> {
  const { data } = await db.from('app_data').select('data').eq('key', key).maybeSingle()
  return Array.isArray(data?.data) ? data.data : []
}
/** The office staff who may be emailed: email -> name. */
// deno-lint-ignore no-explicit-any
export async function officeStaff(db: any): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const { data: roles } = await db.from('staff_roles').select('person_id, role').eq('entity', ENTITY)
  const ids = [...new Set((roles || []).filter((r: Any) => OFFICE_ROLES.includes(String(r.role))).map((r: Any) => String(r.person_id)))]
  if (!ids.length) return out
  const { data: ps } = await db.from('persons').select('person_id, full_name, primary_email, active').in('person_id', ids)
  for (const p of ps || []) { const e = lc(p.primary_email); if (p.active !== false && /@mo-care\.com$/.test(e)) out.set(e, String(p.full_name || e)) }
  return out
}
/** Everyone on an item's thread: the person it sits with, the tagged, whoever wrote in it, and anyone tagged in a message. */
export function threadPeople(it: Any): string[] {
  const s = new Set<string>()
  const add = (e: unknown) => { const x = lc(e); if (x) s.add(x) }
  add(it?.assigned_to_email)
  for (const t of Array.isArray(it?.tagged) ? it.tagged : []) add(t)
  for (const u of Array.isArray(it?.updates) ? it.updates : []) { add(u?.by_email); add(u?.for); for (const t of Array.isArray(u?.tags) ? u.tags : []) add(t) }
  return [...s]
}
const when = (iso: unknown) => { try { return new Date(String(iso)).toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) } catch { return '' } }
/** The email: the card, the thread, a button. */
export function emailFor(it: Any, ops: Any | null, staff: Map<string, string>, to: string) {
  const ups = (Array.isArray(it?.updates) ? it.updates : []).slice(-10)
  const last = ups[ups.length - 1] || null
  const lastBy = first(last?.by) || 'Someone'
  const taggedMe = !!last && ((Array.isArray(last.tags) && last.tags.map(lc).includes(to)) || lc(last.for) === to)
  const summary = String(it?.summary || ops?.title || 'something to talk about').slice(0, 120)
  const subject = (taggedMe ? `${lastBy} tagged you: ` : `New on To talk about: `) + summary
  const name = (e: unknown) => first(staff.get(lc(e)) || String(e || '').split('@')[0])
  const card = ops ? `<div style="font-family:Arial,sans-serif;font-size:13px;color:${GRAY};margin-top:6px;">${esc([ops.about, ops.title && ops.title !== summary ? ops.title : '', ops.owner_name ? 'with ' + first(ops.owner_name) : ''].filter(Boolean).join(' · '))}</div>`
    + (ops.why ? `<div style="font-family:Arial,sans-serif;font-size:14px;color:${NAVY};font-weight:700;margin-top:6px;">Why it's here: ${esc(ops.why)}</div>` : '')
    + (ops.detail ? `<div style="font-family:Arial,sans-serif;font-size:13px;color:#3c4a58;margin-top:6px;white-space:pre-wrap;">${esc(String(ops.detail).slice(0, 700))}</div>` : '') : ''
  const thread = ups.map((u: Any) => `<div style="background:#F6F9FD;border-radius:8px;padding:8px 10px;margin-top:6px;font-family:Arial,sans-serif;font-size:14px;color:#1f2a36;">`
    + `<b>${esc(first(u.by) || 'Someone')}</b>${(Array.isArray(u.tags) && u.tags.length) ? ' <span style="color:#1F7A8C;">' + u.tags.map((t: unknown) => '@' + esc(name(t))).join(' ') + '</span>' : (u.for ? ' <span style="color:#1F7A8C;">@' + esc(name(u.for)) + '</span>' : '')}`
    + ` <span style="color:${GRAY};font-size:12px;">${esc(when(u.at))}</span><br>${esc(u.text)}</div>`).join('')
  const html = `<div style="background:#F1F5FA;padding:14px 8px;"><div style="max-width:620px;margin:0 auto;">`
    + `<div style="background:${NAVY};border-radius:14px 14px 0 0;padding:16px 22px;"><div style="font-family:Arial,sans-serif;color:${HONEY};font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;">Caring Companions · To talk about</div>`
    + `<div style="font-family:Arial,sans-serif;color:#ffffff;font-size:19px;font-weight:800;margin-top:3px;">${taggedMe ? esc(lastBy) + ' tagged you' : 'There\'s more on something you\'re part of'}</div></div>`
    + `<div style="background:#ffffff;border:1px solid ${BORDER};border-top:none;border-radius:0 0 14px 14px;padding:16px 22px 20px;">`
    + `<div style="font-family:Arial,sans-serif;font-size:17px;font-weight:800;color:${NAVY};">${esc(summary)}</div>${card}`
    + `<div style="font-family:Arial,sans-serif;font-size:11px;font-weight:800;letter-spacing:.06em;color:${GRAY};margin-top:14px;">THE THREAD</div>${thread || '<div style="font-family:Arial,sans-serif;font-size:13px;color:' + GRAY + ';">No notes yet.</div>'}`
    + `<div style="margin-top:16px;"><a href="${HUB}/#standup" style="display:inline-block;background:${NAVY};color:#ffffff;font-family:Arial,sans-serif;text-decoration:none;font-weight:700;font-size:13.5px;padding:10px 18px;border-radius:8px;">Open it in the Hub</a></div>`
    + `<div style="font-family:Arial,sans-serif;font-size:12px;color:${GRAY};margin-top:10px;">Reply in the Hub so the whole thread stays together.</div></div>`
    + `<div style="text-align:center;font-family:Arial,sans-serif;color:#9aa3ad;font-size:11px;padding:12px;">Sent by your hub · cc.mo-care.com</div></div></div>`
  return { subject, html }
}
// deno-lint-ignore no-explicit-any
async function sendOne(db: any, to: string, nameOf: string, subject: string, html: string): Promise<boolean> {
  const ghl = { token: Deno.env.get('GHL_TOKEN') || Deno.env.get('GHL_API_KEY') || '', locationId: Deno.env.get('GHL_LOCATION_ID') || '' }
  const fail = (why: string) => reportSendProblem(db, { sender: 'talk-notify', channel: 'email', address: to, who: nameOf, reasons: [why], failed: true })
  if (!ghl.token || !ghl.locationId) { await fail('GoHighLevel is not set up (no token or location)'); return false }
  try {
    const contactId = await ghlStaffContact(ghl, { channel: 'email', email: to, firstName: first(nameOf), lastName: 'CC Staff' })
    if (!contactId) { await fail('no GoHighLevel contact for this staff email'); return false }
    const r = await fetch('https://services.leadconnectorhq.com/conversations/messages', { method: 'POST',
      headers: { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'Email', contactId, subject, html }) })
    if (r.ok) return true
    const t = await r.text().catch(() => ''); await fail('error ' + r.status + (t ? ': ' + t.slice(0, 100) : '')); return false
  } catch (e) { await fail('GoHighLevel could not be reached: ' + String((e as Error)?.message ?? e).slice(0, 80)); return false }
}
// deno-lint-ignore no-explicit-any
async function stateOf(db: any, itemId: string): Promise<Any> {
  return (await readKey(db, 'talk_notify_state')).find((x) => x?.id === itemId) ?? { id: itemId, sent: {}, pending: {} }
}
/** One item: email everyone on its thread except the writer, or mark them to get the latest in 10 minutes. */
// deno-lint-ignore no-explicit-any
export async function notifyItem(db: any, itemId: string, sender: string, opts: { flush?: boolean } = {}) {
  const items = await readKey(db, 'standup_notes')
  const it = items.find((x) => x?.id === itemId)
  if (!it) return { ok: false, error: 'That item is not on the list.' }
  const { data: os } = await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
  const live = os?.data?.talk_email_live === true
  const staff = await officeStaff(db)
  const everyone = threadPeople(it).filter((e) => e !== lc(sender))
  const to = everyone.filter((e) => staff.has(e)), not_staff = everyone.filter((e) => !staff.has(e))
  const st = await stateOf(db, itemId); st.sent = st.sent || {}; st.pending = st.pending || {}
  const now = Date.now(), out = { ok: true, live, emailed: [] as string[], later: [] as string[], would_email: [] as string[], not_staff: not_staff.map((e) => e.split('@')[0]) }
  if (!it.updates?.length && !(it.tagged || []).length) return out
  if (!live) { out.would_email = to.map((e) => first(staff.get(e))); return out }
  const ops = it.source === 'work' && it.ops_id ? (await readKey(db, 'ops_items')).find((x) => x?.id === it.ops_id) || null : null
  for (const e of (opts.flush ? Object.keys(st.pending).filter((x) => to.includes(x)) : to)) {
    const lastAt = Date.parse(String(st.sent[e] || '')) || 0
    if (now - lastAt < WAIT_MS) { if (!st.pending[e]) st.pending[e] = new Date(now).toISOString(); out.later.push(first(staff.get(e))); continue }
    const { subject, html } = emailFor(it, ops, staff, e)
    if (await sendOne(db, e, staff.get(e) || e, subject, html)) { st.sent[e] = new Date(now).toISOString(); delete st.pending[e]; out.emailed.push(first(staff.get(e))) }
  }
  if (opts.flush) for (const e of Object.keys(st.pending)) if (!to.includes(e)) delete st.pending[e]
  await db.rpc('upsert_app_data_item', { target_key: 'talk_notify_state', item: st })
  return out
}
/** The 5-minute pass: send what has waited 10 minutes since that person's last email about the item. */
// deno-lint-ignore no-explicit-any
export async function flushAll(db: any) {
  const states = await readKey(db, 'talk_notify_state'), now = Date.now()
  const out = { ok: true, items: 0, emailed: 0 }
  for (const st of states) {
    const due = Object.keys(st?.pending || {}).filter((e) => now - (Date.parse(String(st.sent?.[e] || '')) || 0) >= WAIT_MS)
    if (!due.length) continue
    out.items++
    const r = await notifyItem(db, String(st.id), '', { flush: true })
    out.emailed += (r as Any).emailed?.length || 0
  }
  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const q = new URL(req.url).searchParams
  if (q.get('flush') === '1') {
    if (!(await jobCaller(req, true))) return json({ error: 'not allowed' }, 401)
    return json(await flushAll(db))
  }
  const who = await requireStaff(db, req, OFFICE_ROLES)
  if (!who.ok) return json({ error: who.error }, who.status)
  let b: Any = {}
  try { b = await req.json() } catch { b = {} }
  const id = String(b?.item_id ?? '').trim()
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(id)) return json({ error: 'No item.' }, 400)
  return json(await notifyItem(db, id, who.email))
})
