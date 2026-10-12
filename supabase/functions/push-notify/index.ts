// =============================================================================
// push-notify · PHONE NOTIFICATIONS (Samantha 2026-10-12, "build 6-8", item 7). A phone that turned notifications on
// (CC Office → More) is told when something lands in Act Now for that person, so nobody has to keep the app open.
//
// What it says: only "Something needs you in CC Office". The push carries NO payload at all: no names, no client, no
// caregiver, no kind. Apple's and Google's push services never see anything about anybody (the BAAs do not cover them).
// What counts (the Hub's Act Now tier 0, opsPriorityKey): an open item that is urgent, escalated, or a missed clock-in.
// Who: the item's owner (and also_for); an item nobody owns goes to everyone with notifications on. Each person is told
// once per item (push_notified), and gets at most ONE notification per run however many items arrived.
// When: office quiet hours (quiet-hours.ts, 8pm to 7am by default) hold everything EXCEPT what may already text at
// night: missed clock-ins (missed_clockin_after_hours) and call-ins (callin_after_hours). Held items are told at 7am.
// Switch: ops_settings.phone_notify_live (Owners Hub Admin page). Off = nothing is sent; the run says what it would do.
// Actions: tick (its schedule, every 5 minutes) · test (office staff: one test notification to your own phones).
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jobCaller } from '../_shared/job-auth.ts'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { officeQuiet, afterHoursAllowed } from '../_shared/quiet-hours.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
// deno-lint-ignore no-explicit-any
type Any = any
const lc = (s: unknown) => String(s ?? '').trim().toLowerCase()

/* ── which items, for whom (pure, tested) ── */
export function isActNow(it: Any): boolean {
  if (!it || it.status !== 'open') return false
  if (it.kind === 'staffing_issue' && /timekeeper/.test(String(it.opened_by || ''))) return true
  if (it.urgency === 'urgent' || it.sub_state === 'escalated') return true
  if (it.escalation && !it.escalation.cleared_at && it.escalation.level === 'urgent') return true
  return false
}
export function nightKind(it: Any): 'missed_clockin' | 'callin' | null {
  if (it.kind === 'staffing_issue' && /timekeeper/.test(String(it.opened_by || ''))) return 'missed_clockin'
  if (/coverage|callin|call-in|call_off|calloff/i.test(String(it.kind || '') + ' ' + String(it.opened_by || ''))) return 'callin'
  return null
}
export function recipients(it: Any, subscribers: string[]): string[] {
  const subs = new Set(subscribers.map(lc))
  const named = [it.owner, ...(Array.isArray(it.also_for) ? it.also_for : [])].map(lc).filter(Boolean)
  if (named.length) return [...new Set(named)].filter((e) => subs.has(e))
  return [...subs]
}
/** Who gets one notification this run: email -> item ids to mark as told. */
export function plan(items: Any[], subscribers: string[], told: Set<string>, quiet: boolean, settings: Any): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const it of items) {
    if (!isActNow(it)) continue
    if (quiet) { const k = nightKind(it); if (!k || !afterHoursAllowed(settings, k)) continue }
    for (const e of recipients(it, subscribers)) {
      if (told.has(String(it.id) + '|' + e)) continue
      if (!out.has(e)) out.set(e, [])
      out.get(e)!.push(String(it.id))
    }
  }
  return out
}

/* ── Web Push with no payload: only a VAPID signature (RFC 8292), so nothing needs encrypting ── */
const b64u = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf as ArrayBuffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const enc = new TextEncoder()
let KEY: CryptoKey | null = null
async function vapidKey(): Promise<CryptoKey> {
  if (KEY) return KEY
  const jwk = JSON.parse(Deno.env.get('VAPID_PRIVATE_JWK') || '{}')
  KEY = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  return KEY
}
export async function vapidAuth(endpoint: string): Promise<string> {
  const aud = new URL(endpoint).origin
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const body = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'https://cc.mo-care.com' })))
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await vapidKey(), enc.encode(head + '.' + body))
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${Deno.env.get('VAPID_PUBLIC') || ''}`
}
async function pushOne(db: Any, sub: Any): Promise<boolean> {
  try {
    const r = await fetch(sub.endpoint, { method: 'POST', headers: { TTL: '3600', Urgency: 'high', Authorization: await vapidAuth(sub.endpoint), 'Content-Length': '0' } })
    if (r.status === 404 || r.status === 410) { await db.from('push_subscriptions').delete().eq('id', sub.id); return false }   // the phone turned it off
    if (!r.ok) { await db.from('push_subscriptions').update({ last_error: `HTTP ${r.status}`, failures: (sub.failures || 0) + 1 }).eq('id', sub.id); return false }
    await db.from('push_subscriptions').update({ last_ok_at: new Date().toISOString(), last_error: null, failures: 0 }).eq('id', sub.id)
    return true
  } catch (e) {
    await db.from('push_subscriptions').update({ last_error: String((e as Error)?.message || e).slice(0, 200), failures: (sub.failures || 0) + 1 }).eq('id', sub.id)
    return false
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  let b: Any = {}; try { b = await req.json() } catch { /* empty */ }
  const action = String(b.action || 'tick')
  if (action === 'test') {
    const who = await requireStaff(db, req, OFFICE_ROLES)
    if (!who.ok) return json({ error: who.error }, who.status)
    if (!Deno.env.get('VAPID_PRIVATE_JWK')) return json({ error: 'Phone notifications are not set up yet (Desktop step 623).' }, 503)
    const { data: subs } = await db.from('push_subscriptions').select('*').ilike('email', who.email)
    let sent = 0; for (const s of subs ?? []) if (await pushOne(db, s)) sent++
    return json({ ok: true, phones: (subs ?? []).length, sent })
  }
  const caller = await jobCaller(req)
  if (!caller) return json({ error: 'not allowed' }, 401)
  const { data: opsRow } = await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
  const settings = opsRow?.data && typeof opsRow.data === 'object' && !Array.isArray(opsRow.data) ? opsRow.data : {}
  const live = settings.phone_notify_live === true
  const { data: itemsRow } = await db.from('app_data').select('data').eq('key', 'ops_items').maybeSingle()
  const items: Any[] = Array.isArray(itemsRow?.data) ? itemsRow!.data : []
  const { data: subs } = await db.from('push_subscriptions').select('*')
  const emails = [...new Set((subs ?? []).map((s: Any) => lc(s.email)))] as string[]
  const actIds = items.filter(isActNow).map((i) => String(i.id))
  const { data: toldRows } = actIds.length ? await db.from('push_notified').select('item_id,email').in('item_id', actIds) : { data: [] }
  const told = new Set((toldRows ?? []).map((r: Any) => r.item_id + '|' + lc(r.email)))
  const quiet = officeQuiet(new Date(), settings)
  const p = plan(items, emails, told, quiet, settings)
  if (!live || !Deno.env.get('VAPID_PRIVATE_JWK')) return json({ ok: true, live: false, quiet, would_notify: p.size, phones: (subs ?? []).length })
  let people = 0, phones = 0
  for (const [email, ids] of p) {
    const mine = (subs ?? []).filter((s: Any) => lc(s.email) === email)
    let any = false; for (const s of mine) if (await pushOne(db, s)) { any = true; phones++ }
    if (any) { people++; await db.from('push_notified').upsert(ids.map((id) => ({ item_id: id, email })), { onConflict: 'item_id,email' }) }
  }
  return json({ ok: true, live: true, quiet, people, phones })
})
