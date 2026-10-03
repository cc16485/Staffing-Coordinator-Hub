// =============================================================================
// 433 · "Call rings your phone first" (GoHighLevel call bridge). Samantha 2026-10-03, option 1: each tap assigns the
// contact to the staff member who tapped, then GoHighLevel rings THEIR phone ("assignment changes with each call",
// accepted).
// =============================================================================
// Why: no GoHighLevel web link opens the LeadConnector app (431 opened the browser on her phone). GoHighLevel's
// workflow "Call" action rings the user ASSIGNED to the contact, plays a whisper, and on a key press connects them to
// the contact from the business number, and logs the call. So a tap here:
//   1. checks the caller (done by the function that calls this: a Hub staff sign-in, or an admin's sealed link)
//   2. one bridge per caller per 30 seconds (op_events is both the record and the limiter)
//   3. finds the caller's GoHighLevel user: Settings map ops_settings.ghl_user_ids {email: userId} first (her override),
//      else GoHighLevel's user list for the location (GET, cached in app_data 'ghl_users')
//   4. finds the contact exactly as 431 does (_shared/ghl-contact-link.ts: search only, exactly one, never created)
//   5. checks the workflow "Hub call bridge" is published, when the token may read workflows (else carries on)
//   6. records the bridge in op_events (who, contact, previous owner), THEN
//   7. PUT the contact's assignedTo = the caller (that field only), THEN
//   8. adds the tag hub-call-bridge (if it is already on, it is removed first, because GoHighLevel's "Contact Tag
//      added" trigger only fires when the tag is newly added). The workflow rings the caller and removes the tag.
// Never automatic: only the two link-page functions and ghl-call-link call this, each on a person's tap.
// It never creates a contact, never sends a text or email, and changes nothing but assignedTo and that one tag.
// =============================================================================
import { ghlFindContact } from './ghl-contact-link.ts'

const GHL = 'https://services.leadconnectorhq.com'
export const BRIDGE_TAG = 'hub-call-bridge'
export const BRIDGE_WORKFLOW = 'Hub call bridge'
export const BRIDGE_GAP_SEC = 30
const USERS_FRESH_MS = 12 * 3600e3, USERS_RETRY_MS = 5 * 60e3

const safeId = (s: unknown) => /^[A-Za-z0-9_-]{1,64}$/.test(String(s ?? '')) ? String(s) : ''
const low = (s: unknown) => String(s ?? '').trim().toLowerCase()
const hdr = (token: string, json = false) => ({ Authorization: `Bearer ${token}`, Version: '2021-07-28', Accept: 'application/json',
  ...(json ? { 'Content-Type': 'application/json' } : {}) })
type Ghl = { token: string; locationId: string }

export type UsersApi = 'ok' | 'no_scope' | 'error'
/** GoHighLevel's users for the location, as {email: userId} (GET only). */
export async function ghlListUsers(ghl: Ghl, send: typeof fetch = fetch): Promise<{ api: UsersApi; users: Record<string, string>; count: number }> {
  try {
    const r = await send(`${GHL}/users/?` + new URLSearchParams({ locationId: ghl.locationId }), { method: 'GET', headers: hdr(ghl.token) })
    if (r.status === 401 || r.status === 403) return { api: 'no_scope', users: {}, count: 0 }
    if (!r.ok) return { api: 'error', users: {}, count: 0 }
    const j = await r.json().catch(() => ({}))
    const users: Record<string, string> = {}
    let count = 0
    // deno-lint-ignore no-explicit-any
    for (const u of (j?.users ?? []) as any[]) {
      if (!u || u.deleted === true) continue
      const id = safeId(u.id), em = low(u.email)
      if (id) count++
      if (id && em) users[em] = id
    }
    return { api: 'ok', users, count }
  } catch { return { api: 'error', users: {}, count: 0 } }
}

export type UserFor = { id: string; via: 'settings' | 'gohighlevel' | null; api: UsersApi | 'not_asked' }
/** The caller's GoHighLevel user id: her Settings map first, else GoHighLevel's list (cached in app_data 'ghl_users'). */
export async function ghlUserFor(
  // deno-lint-ignore no-explicit-any
  db: any, ghl: Ghl, settings: any, email: string, send: typeof fetch = fetch, now = Date.now()): Promise<UserFor> {
  const em = low(email)
  const map = settings && typeof settings.ghl_user_ids === 'object' && settings.ghl_user_ids ? settings.ghl_user_ids : {}
  for (const [k, v] of Object.entries(map)) if (low(k) === em && safeId(v)) return { id: String(v), via: 'settings', api: 'not_asked' }
  if (!em) return { id: '', via: null, api: 'not_asked' }
  // deno-lint-ignore no-explicit-any
  let cache: any = null
  try {
    const { data } = await db.from('app_data').select('data').eq('key', 'ghl_users').maybeSingle()
    // deno-lint-ignore no-explicit-any
    cache = (Array.isArray(data?.data) ? data.data : []).find((x: any) => x?.id === 'map') ?? null
  } catch { cache = null }
  const age = cache ? now - Date.parse(String(cache.at || 0)) : Infinity
  const hit = cache && cache.users && safeId(cache.users[em]) ? String(cache.users[em]) : ''
  if (hit && age < USERS_FRESH_MS) return { id: hit, via: 'gohighlevel', api: cache.api || 'ok' }
  if (!hit && age < USERS_RETRY_MS) return { id: '', via: null, api: cache.api || 'ok' }
  const got = await ghlListUsers(ghl, send)
  if (got.api !== 'error') {
    try { await db.rpc('upsert_app_data_item', { target_key: 'ghl_users', item: { id: 'map', at: new Date(now).toISOString(), api: got.api, users: got.users, count: got.count } }) }
    catch { /* the cache is a convenience */ }
  }
  if (got.api === 'ok') return got.users[em] ? { id: got.users[em], via: 'gohighlevel', api: 'ok' } : { id: '', via: null, api: 'ok' }
  return hit ? { id: hit, via: 'gohighlevel', api: got.api } : { id: '', via: null, api: got.api }
}

export type WorkflowState = 'published' | 'draft' | 'missing' | 'unknown'
/** Is the GoHighLevel workflow "Hub call bridge" published? 'unknown' when the token may not read workflows. GET only. */
export async function bridgeWorkflow(ghl: Ghl, send: typeof fetch = fetch): Promise<WorkflowState> {
  try {
    const r = await send(`${GHL}/workflows/?` + new URLSearchParams({ locationId: ghl.locationId }), { method: 'GET', headers: hdr(ghl.token) })
    if (!r.ok) return 'unknown'
    const j = await r.json().catch(() => null)
    if (!j || !Array.isArray(j.workflows)) return 'unknown'
    // deno-lint-ignore no-explicit-any
    const mine = (j.workflows as any[]).filter((w) => low(w?.name) === low(BRIDGE_WORKFLOW))
    if (!mine.length) return 'missing'
    return mine.some((w) => low(w?.status) === 'published') ? 'published' : 'draft'
  } catch { return 'unknown' }
}

export type BridgeWhy = 'no_user' | 'too_soon' | 'no_workflow' | 'not_found' | 'several' | 'no_number' | 'error' | 'not_set_up'
  | 'assign_failed' | 'tag_failed'
export type BridgeOut =
  | { ok: true; ringing: 'you'; contact_id: string; name: string; app_url: string; web_url: string; tag_was_on: boolean; workflow: WorkflowState }
  | { ok: false; why: BridgeWhy; message?: string; wait_sec?: number; contact_id?: string; app_url?: string; web_url?: string; workflow?: WorkflowState }

/** The whole tap: see the header. `caller` is already checked by the function that calls this. */
export async function ghlCallBridge(
  // deno-lint-ignore no-explicit-any
  db: any, ghl: Ghl, settings: any,
  caller: { email: string; name: string; via: 'hub' | 'clockin-link' | 'late-link' },
  who: { axiscareClientId?: unknown; phone?: unknown; email?: unknown; label?: string },
  send: typeof fetch = fetch, now = Date.now()): Promise<BridgeOut> {
  const me = low(caller.email)
  if (!me) return { ok: false, why: 'no_user' }
  if (!ghl.token || !safeId(ghl.locationId)) return { ok: false, why: 'not_set_up' }

  /* 2 · one bridge per caller per 30 seconds (the record of the last one is the limiter) */
  try {
    const { data, error } = await db.from('op_events').select('at').eq('verb', 'call_bridge').eq('actor_email', me)
      .gte('at', new Date(now - BRIDGE_GAP_SEC * 1000).toISOString()).order('at', { ascending: false }).limit(1)
    if (error) return { ok: false, why: 'error', message: 'Could not check your last call. Try again.' }
    const last = Array.isArray(data) && data[0] ? Date.parse(String(data[0].at)) : NaN
    if (Number.isFinite(last) && now - last < BRIDGE_GAP_SEC * 1000)
      return { ok: false, why: 'too_soon', wait_sec: Math.max(1, Math.ceil((BRIDGE_GAP_SEC * 1000 - (now - last)) / 1000)) }
  } catch { return { ok: false, why: 'error', message: 'Could not check your last call. Try again.' } }

  /* 3 + 4 · the caller's GoHighLevel user, and the contact (search only, exactly one, never created) */
  const [user, found] = await Promise.all([
    ghlUserFor(db, ghl, settings, me, send, now),
    ghlFindContact(db, ghl, { axiscareClientId: who.axiscareClientId, phone: who.phone, email: who.email }, send)])
  const links = found.found ? { contact_id: found.contact_id, app_url: found.app_url, web_url: found.web_url } : {}
  if (!found.found) return { ok: false, why: found.why }
  if (!user.id) return { ok: false, why: 'no_user', ...links,
    message: user.api === 'no_scope' ? 'GoHighLevel will not list its users to the Hub, so link yours in Settings, Calls.' : undefined }

  /* 5 · the workflow that does the ringing (refuse only when GoHighLevel says it is missing or not published) */
  const workflow = await bridgeWorkflow(ghl, send)
  if (workflow === 'missing' || workflow === 'draft') return { ok: false, why: 'no_workflow', workflow, ...links }

  /* the contact as it is now: first name (for "connect to Ruth"), tags, and who owned it (kept in the record) */
  const cid = found.contact_id
  // deno-lint-ignore no-explicit-any
  let c: any = null
  try {
    const r = await send(`${GHL}/contacts/${encodeURIComponent(cid)}`, { method: 'GET', headers: hdr(ghl.token) })
    if (r.ok) c = (await r.json().catch(() => ({})))?.contact ?? null
  } catch { c = null }
  if (!c) return { ok: false, why: 'error', message: 'Could not read the contact in GoHighLevel. Try again.', ...links }
  const first = String(c.firstName || c.firstNameRaw || '').trim().split(/\s+/)[0] || String(who.label || '').trim() || 'them'
  const tags: string[] = Array.isArray(c.tags) ? c.tags.map((t: unknown) => low(t)) : []
  const tagOn = tags.includes(BRIDGE_TAG)
  const previous = safeId(c.assignedTo) || null

  /* 6 · the record (and the limiter's mark) goes in BEFORE anything changes in GoHighLevel */
  try {
    const { error } = await db.from('op_events').insert({ actor_email: me, actor_name: caller.name || me, verb: 'call_bridge',
      item_id: 'ghl:' + cid, area: 'calls',
      summary: `${caller.name || me} tapped Call for ${first}: GoHighLevel assigns ${first} to them and rings their phone`.slice(0, 400),
      data: { contact_id: cid, user_id: user.id, user_via: user.via, previous_assigned_to: previous, tag_was_on: tagOn, from: caller.via, workflow } })
    if (error) return { ok: false, why: 'error', message: 'Could not record the call, so nothing was changed. Try again.', ...links }
  } catch { return { ok: false, why: 'error', message: 'Could not record the call, so nothing was changed. Try again.', ...links } }
  const failed = async (why: 'assign_failed' | 'tag_failed', detail: string) => {
    try { await db.from('op_events').insert({ actor_email: me, actor_name: caller.name || me, verb: 'call_bridge_failed', item_id: 'ghl:' + cid,
      area: 'calls', summary: `The call to ${first} did not start: ${detail}`.slice(0, 400), data: { contact_id: cid, why } }) } catch { /* shown on the page */ }
    return { ok: false as const, why, message: detail, ...links }
  }

  /* 7 · assign the contact to the caller: that field only */
  if (previous !== user.id) {
    let st = 0
    try { st = (await send(`${GHL}/contacts/${encodeURIComponent(cid)}`, { method: 'PUT', headers: hdr(ghl.token, true), body: JSON.stringify({ assignedTo: user.id }) })).status }
    catch { st = 0 }
    if (st < 200 || st > 299) return await failed('assign_failed', `GoHighLevel would not assign ${first} to you (${st || 'no answer'}).`)
  }

  /* 8 · the tag that starts the workflow: newly added, so the trigger fires */
  const tagUrl = `${GHL}/contacts/${encodeURIComponent(cid)}/tags`
  if (tagOn) {
    let st = 0
    try { st = (await send(tagUrl, { method: 'DELETE', headers: hdr(ghl.token, true), body: JSON.stringify({ tags: [BRIDGE_TAG] }) })).status } catch { st = 0 }
    if (st < 200 || st > 299) return await failed('tag_failed', `GoHighLevel would not reset the call tag on ${first} (${st || 'no answer'}).`)
  }
  let st2 = 0
  try { st2 = (await send(tagUrl, { method: 'POST', headers: hdr(ghl.token, true), body: JSON.stringify({ tags: [BRIDGE_TAG] }) })).status } catch { st2 = 0 }
  if (st2 < 200 || st2 > 299) return await failed('tag_failed', `GoHighLevel would not start the call to ${first} (${st2 || 'no answer'}).`)
  return { ok: true, ringing: 'you', contact_id: cid, name: first, app_url: found.app_url, web_url: found.web_url, tag_was_on: tagOn, workflow }
}

/** Settings, Calls: what is set up (GET only). Staff see names; the installer (server key) sees counts only. */
export async function bridgeSetup(
  // deno-lint-ignore no-explicit-any
  db: any, ghl: Ghl, settings: any, people: { email: string; name: string }[], send: typeof fetch = fetch) {
  if (!ghl.token || !safeId(ghl.locationId)) return { ok: true, configured: false }
  const [users, workflow] = await Promise.all([ghlListUsers(ghl, send), bridgeWorkflow(ghl, send)])
  if (users.api !== 'error') {
    try { await db.rpc('upsert_app_data_item', { target_key: 'ghl_users', item: { id: 'map', at: new Date().toISOString(), api: users.api, users: users.users, count: users.count } }) }
    catch { /* the cache is a convenience */ }
  }
  const map = settings && typeof settings.ghl_user_ids === 'object' && settings.ghl_user_ids ? settings.ghl_user_ids : {}
  const viaSettings = (em: string) => Object.entries(map).some(([k, v]) => low(k) === em && safeId(v))
  const staff = people.filter((p) => low(p.email)).map((p) => {
    const em = low(p.email)
    return { email: em, name: p.name || em, linked: viaSettings(em) || !!users.users[em], via: viaSettings(em) ? 'settings' : users.users[em] ? 'gohighlevel' : null }
  })
  return { ok: true, configured: true, workflow, users_api: users.api, users_count: users.count, staff,
    staff_linked: staff.filter((s) => s.linked).length, staff_total: staff.length }
}
