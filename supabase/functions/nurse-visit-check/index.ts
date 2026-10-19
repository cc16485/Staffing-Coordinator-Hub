// =============================================================================
// nurse-visit-check · NURSE VISIT CHECKS AND LICENSE REMINDERS (LPN nurse visit plan steps 3, 4 and 8; Samantha approved
// 2026-10-14; spec launch/review/lpn/build-spec.md; Desktop 707)
// =============================================================================
// Every 30 minutes (pg_cron 'nurse-visit-check-pass', x-cron-secret) and when the office presses "Check now" on Nurse
// Scheduling:
//
// 1. THE READY-TO-BILL CHECK (switch ops_settings.nurse_visit_check_live, OFF = practice). Reads AxisCare's visits for every
//    client with nurse needs (Nurse Scheduling's clients and every client on a state care plan of ours) from 120 days
//    back (further back when the six-month period started earlier) to 30 days ahead. Each completed nurse visit (matched
//    by service name and code, _shared/nurse-services.ts) is checked by _shared/nurse-bill.ts: authorized on the state care
//    plan (and within its units), one a day, 26 in the six-month period, documented, and a GHE's form finished and (LPN)
//    RN-signed. Every result is kept under app_data 'nurse_bill_check' (nb_<visit id>, plus nb_summary) for the panel.
//    Live: one Needs Attention card per not-ready visit (nurse_bill_<visit id>) for the owner of Payer Programs, closing
//    itself once the visit is ready. Off: computed and shown, no card. A client whose AxisCare read failed is left exactly
//    as it was (never marked a problem, the ghe-reminders rule). The GHE due and missed ladder stays in ghe-reminders.
//
// 2. THE BILLING HOLD (switch nurse_bill_hold_live, OFF; it acts only while the check is live too). Caring Companions'
//    claims are made by AxisCare's managed Medicaid Billing team, so the hold only works once that team confirms they skip
//    visits marked do-not-bill. On: PATCH /api/visits/{id} { doNotBill: true } on a not-ready nurse visit, recorded on its
//    nb_ item (hold.state 'held'); once the visit is ready, { doNotBill: false } releases ONLY a hold the Hub set. A visit
//    AxisCare already shows as do-not-bill without a Hub hold is the office's own mark and is never touched; a Hub hold the
//    office released by hand is never set again. Every AxisCare write that fails becomes a card.
//
// 3. NURSE LICENSE REMINDERS (switch nurse_license_reminders_live, OFF = practice; scheduled pass only). From app_data
//    nurse_staff: 30, 14 and 7 days before a license expires, one text and one email to the nurse (8am to 6pm Central, held
//    never dropped; their yes to texts, the opt-out door, practice addresses never, test people even while off) and a card
//    for the office; on expiry a card. Each stage is stamped (app_data nurse_license_reminders) so it never repeats.
//
// API (POST JSON)
//   { action: 'pass' }   the schedule or the owner's server key: both parts.            ?dry=1 or { dry: true }: nothing written
//   { action: 'run' }    office staff (their Hub sign-in): the ready-to-bill check only, now.
//   { action: 'report' } office staff: { live, hold_live, not_ready[], holds[], clients[], services_from, checked_at }
//   { action: 'services' } office staff: { defaults, current, in_use, from } for the Admin page's editor
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jobCaller } from '../_shared/job-auth.ts'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { ghlContactIfAllowed, practicePerson } from '../_shared/optout.ts'
import { ghlSendChecked } from '../_shared/send-problems.ts'
import { latestTextConsent, inTextHours, withStop } from '../_shared/text-consent.ts'
import { refusedForGood, REMINDER_TRIES } from '../_shared/step2.ts'
import { testPerson } from '../_shared/test-people.ts'
import { centralYmd, addDaysYmd } from '../_shared/business-days.ts'
import { DEFAULT_NURSE_SERVICES, nurseServices } from '../_shared/nurse-services.ts'
import { checkClient, readFrom, medicaidOf, notReadyCard, longDate } from '../_shared/nurse-bill.ts'
import { licenseDue, licenseMessage, licenseCard, nurseKey } from '../_shared/nurse-license.ts'
import { routingBySettings, noticeTo } from '../_shared/notice-to.ts'

type Any = any
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const S = (v: unknown, n = 160) => String(v ?? '').trim().slice(0, n)
export const SENDER = 'nurse-visit-check'
const OWNER = 'samantha@mo-care.com'
export const BACK_DAYS = 120, AHEAD_DAYS = 30, BATCH = 10, MAX_PAGES = 60, SEND_CAP = 20

/* ── AxisCare: read visits (paged, one retry on 429) and set do-not-bill ── */
export function axisCare(fetchImpl: typeof fetch = fetch) {
  let token = ''
  for (const n of ['AXISCARE_API_KEY', 'AXISCARE_TOKEN']) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  const ok = !!token && /^\d+$/.test(site)
  const head = { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json', 'X-AxisCare-Api-Version': '2023-10-01' }
  const call = async (method: string, path: string, body?: unknown) => {
    if (!ok) return null
    for (let i = 0; i < 2; i++) {
      try {
        const r = await fetchImpl(`https://${site}.axiscare.com${path}`, { method, headers: head, ...(body ? { body: JSON.stringify(body) } : {}) })
        if (r.status === 429 && i === 0) { await new Promise((y) => setTimeout(y, 1500)); continue }
        return { status: r.status, json: await r.json().catch(() => ({})) }
      } catch { return null }
    }
    return null
  }
  return {
    ok,
    /** every visit of these clients between two dates, or null when any page failed */
    async visits(ids: string[], from: string, to: string): Promise<Any[] | null> {
      const out: Any[] = []
      let path: string | null = `/api/visits?clientIds=${encodeURIComponent(ids.join(','))}&startDate=${from}&endDate=${to}`
      for (let page = 0; path; page++) {
        if (page >= MAX_PAGES) return null
        const r = await call('GET', path); if (!r || r.status !== 200) return null
        const vs = r.json?.results?.visits ?? r.json?.visits ?? []
        out.push(...(Array.isArray(vs) ? vs : Object.values(vs)))
        const nx = r.json?.results?.nextPage ?? r.json?.nextPage ?? null
        path = nx ? String(nx).replace(/^https?:\/\/[^/]+/, '') : null
      }
      return out
    },
    /** PATCH doNotBill; { ok, status, why } */
    async doNotBill(id: string, value: boolean, reasonId?: number): Promise<{ ok: boolean; status: number | null; why: string }> {
      const r = await call('PATCH', `/api/visits/${encodeURIComponent(id)}`, { doNotBill: value, ...(Number.isInteger(reasonId) ? { modificationReason: reasonId } : {}) })
      if (!r) return { ok: false, status: null, why: 'AxisCare could not be reached' }
      if (r.status >= 200 && r.status < 300) return { ok: true, status: r.status, why: '' }
      const msg = S((r.json?.errors || []).join?.('; ') || r.json?.message || '', 160)
      return { ok: false, status: r.status, why: `AxisCare answered ${r.status}${msg ? ': ' + msg : ''}` }
    },
  }
}

/* ── the database ── */
async function settings(db: Any) { const { data } = await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle(); return data?.data && typeof data.data === 'object' && !Array.isArray(data.data) ? data.data : {} }
async function list(db: Any, key: string): Promise<Any[]> { const { data } = await db.from('app_data').select('data').eq('key', key).maybeSingle(); return Array.isArray(data?.data) ? data.data : [] }
const put = async (db: Any, key: string, item: Any) => { const { error } = await db.rpc('upsert_app_data_item', { target_key: key, item }); return !error }
/** the Medicaid coordinator: the owner of Payer Programs, else Samantha (the ghe-reminders rule) */
async function coordinatorOf(db: Any): Promise<string> {
  try {
    const { data: dom } = await db.from('domains').select('code, owner_person, entity').eq('code', 'payer_programs').eq('entity', 'cc_ihs').maybeSingle()
    if (dom?.owner_person) { const { data: p } = await db.from('persons').select('person_id, primary_email').eq('person_id', dom.owner_person).maybeSingle(); if (p?.primary_email) return String(p.primary_email).toLowerCase() }
  } catch { /* fall through */ }
  if (await routingBySettings(db)) return (await noticeTo(db, 'payer_programs')).email   /* batch 2 (off by default) */
  return OWNER
}
/** one card per id: raised or updated while open; a card a person closed stays closed. 'raised' | 'open' | 'closed' | 'failed' */
async function card(db: Any, c: Any): Promise<string> {
  try {
    const cur = (await list(db, 'ops_items')).find((x) => x && x.id === c.id)
    const isOpen = (x: Any) => x && x.status !== 'done' && x.status !== 'resolved'
    if (cur && !isOpen(cur)) return 'closed'
    const now = new Date().toISOString()
    const item = { ...(cur || {}), domain: 'payer_programs', status: 'open', link: '#nursevisits', created_by: SENDER, opened_by: SENDER, ...c, created_at: cur?.created_at || now, updated_at: now }
    if (cur && cur.title === item.title && cur.detail === item.detail && cur.owner === item.owner) return 'open'
    return (await put(db, 'ops_items', item)) ? (cur ? 'open' : 'raised') : 'failed'
  } catch { return 'failed' }
}
async function closeCard(db: Any, id: string, by: string): Promise<boolean> {
  try {
    const cur = (await list(db, 'ops_items')).find((x) => x && x.id === id)
    if (!cur || cur.status === 'done' || cur.status === 'resolved') return false
    const now = new Date().toISOString()
    return await put(db, 'ops_items', { ...cur, status: 'done', done_at: now, done_by: by, closed_at: now, closed_by: SENDER, updated_at: now })
  } catch { return false }
}
const same = (a: Any, b: Any) => { const k = (x: Any) => JSON.stringify({ ...(x || {}), checked_at: null }); return k(a) === k(b) }

/* ═══ 1 + 2 · the ready-to-bill check and the billing hold ═══ */
export async function visitPass(db: Any, st: Any, opts: { dry?: boolean; now?: Date; by?: string } = {}): Promise<Any> {
  const now = opts.now || new Date(), nowIso = now.toISOString(), today = centralYmd(now), dry = !!opts.dry
  const live = st.nurse_visit_check_live === true, holdOn = st.nurse_bill_hold_live === true, holdLive = live && holdOn
  const checkFrom = addDaysYmd(today, -BACK_DAYS), to = addDaysYmd(today, AHEAD_DAYS)
  const svc = nurseServices(st)
  const [clients, plans, forms, staff, watch, prevItems] = await Promise.all(['nurse_clients', 'medicaid_plans', 'ghe_forms', 'nurse_staff', 'ghe_watch', 'nurse_bill_check'].map((k) => list(db, k)))
  const out: Any = { ok: true, live, hold_live: holdLive, hold_switch: holdOn, dry, today, services_from: svc.from, clients: 0, read_failed: 0, visits_checked: 0, ready: 0, not_ready: 0,
    cards_raised: 0, cards_closed: 0, holds_set: 0, holds_released: 0, would_hold: 0, office_marked: 0, write_failed: 0, card_failed: 0 }
  const ax = axisCare()
  if (!ax.ok) { out.ok = false; out.error = 'AxisCare is not set up on the server'; return out }
  const coord = await coordinatorOf(db)
  const holdReason = Number.isInteger(st.nurse_bill_hold_reason_id) ? st.nurse_bill_hold_reason_id : undefined

  /* who to read: Nurse Scheduling's clients and every client on a state care plan of ours (not CDS) */
  const who = new Map<string, { ax: string; name: string; rec: Any }>()
  for (const c of clients) { const a = S(c?.axiscare_client_id, 30); if (c && c.active !== false && /^\d+$/.test(a)) who.set(a, { ax: a, name: S(c.name, 120), rec: c }) }
  for (const p of plans) {
    const a = S(p?.axiscare_client_id, 30)
    if (!p || p.kind !== 'plan' || !/^\d+$/.test(a) || who.has(a) || S(p.plan_end) < addDaysYmd(today, -400)) continue
    /* every client on a state care plan of ours: a T1001 visit for a client whose plan has no nurse line is exactly the
       unauthorized visit this check is for */
    if ((p.services || []).some((s: Any) => s && s.ours !== false && s.program !== 'cds')) who.set(a, { ax: a, name: S(p.client_name, 120), rec: null })
  }
  const prev = new Map<string, Any>(prevItems.filter((x) => x && /^nb_/.test(String(x.id)) && x.visit_id).map((x) => [String(x.visit_id), x]))
  const heldDays = (a: string) => [...prev.values()].filter((x) => x.ax === a && x.hold?.state === 'held').map((x) => x.date)
  const summaries: Any[] = [], failedAx: string[] = []
  const all = [...who.values()]
  for (let i = 0; i < all.length; i += BATCH) {
    const batch = all.slice(i, i + BATCH)
    const from = batch.map((c) => readFrom(plans, c.ax, checkFrom, heldDays(c.ax))).sort()[0]
    const vs = await ax.visits(batch.map((c) => c.ax), from, to)
    if (vs === null) { out.read_failed += batch.length; failedAx.push(...batch.map((c) => c.ax)); continue }
    for (const c of batch) {
      out.clients++
      const mine = vs.filter((v: Any) => String(v?.client?.id ?? '') === c.ax)
      const raw = new Map<string, Any>(mine.map((v: Any) => [String(v.id), v]))
      const { results, summary } = checkClient({ ax: c.ax, client: c.name, clientRec: c.rec, visits: mine, plans, forms, staff, watch, services: svc.list, today, checkFrom, medicaid: medicaidOf(plans, c.ax) })
      summaries.push(summary)
      const seen = new Set<string>()
      for (const r of results) {
        seen.add(r.visit_id); out.visits_checked++; r.ready ? out.ready++ : out.not_ready++
        const p = prev.get(r.visit_id) || {}
        const item: Any = { ...p, id: 'nb_' + r.visit_id, ...r, gone: false, practice: !live, checked_at: nowIso, first_not_ready_at: r.ready ? (p.first_not_ready_at || null) : (p.first_not_ready_at || nowIso) }
        const v = raw.get(r.visit_id) || {}
        const cardId = 'nurse_bill_' + r.visit_id
        /* the card (live only) */
        if (live && !dry) {
          if (!r.ready) {
            const k = notReadyCard(r)
            const res = await card(db, { id: cardId, kind: 'nurse_not_ready', title: k.title, detail: k.detail, about: r.client, owner: coord, urgency: 'normal', visit_id: r.visit_id, client_ax: r.ax, due: new Date(now.getTime() + 2 * 864e5).toISOString() })
            if (res === 'raised') { out.cards_raised++; item.card_at = item.card_at || nowIso; item.card_closed_at = null }
            if (res === 'failed') out.card_failed++
          } else if (p.card_at && !p.card_closed_at) { if (await closeCard(db, cardId, 'The Hub (the visit is ready to bill now)')) out.cards_closed++; item.card_closed_at = nowIso }
        }
        /* the billing hold */
        const h = p.hold || null, axSays = v.doNotBill === true ? true : v.doNotBill === false ? false : null
        if (!r.ready) {
          if (h?.state === 'held' || h?.state === 'office_released') { /* already held by us, or the office took our hold off: left alone */ }
          else if (axSays === true) { item.office_marked = true; out.office_marked++ }
          else if (!holdLive || dry) { item.would_hold = true; out.would_hold++ }
          else {
            const w = await ax.doNotBill(r.visit_id, true, holdReason)
            if (w.ok) { item.hold = { state: 'held', set_at: nowIso, set_by: 'The Hub (nurse-visit-check)', before: axSays === false ? 'billable' : 'not readable', reasons: r.reasons }; item.would_hold = false; out.holds_set++; await closeCard(db, 'nurse_hold_failed_' + r.visit_id, 'The Hub (the hold went through)') }
            else { out.write_failed++; item.hold_failed_at = nowIso
              if ((await card(db, { id: 'nurse_hold_failed_' + r.visit_id, kind: 'axiscare_write_failed', urgency: 'today', owner: coord, about: r.client,
                title: `AxisCare did not take the do-not-bill hold: ${r.client}, ${r.date}`, detail: `The Hub tried to mark the ${r.service} visit on ${longDate(r.date)} do-not-bill in AxisCare and ${w.why}. It is not ready to bill (${r.reasons.join(' ')}). Mark it do-not-bill in AxisCare by hand, or tell the AxisCare billing team not to bill it. The Hub tries again on its next check.` })) === 'raised') out.cards_raised++ }
          }
        } else {
          item.would_hold = false
          if (h?.state === 'held') {
            if (axSays === false) { item.hold = { ...h, state: 'office_released', office_released_seen_at: nowIso } }
            else if (holdLive && !dry) {
              const w = await ax.doNotBill(r.visit_id, false, holdReason)
              if (w.ok) { item.hold = { ...h, state: 'released', released_at: nowIso }; out.holds_released++; await closeCard(db, 'nurse_release_failed_' + r.visit_id, 'The Hub (the release went through)') }
              else { out.write_failed++
                if ((await card(db, { id: 'nurse_release_failed_' + r.visit_id, kind: 'axiscare_write_failed', urgency: 'today', owner: coord, about: r.client,
                  title: `AxisCare did not take the release of the hold: ${r.client}, ${r.date}`, detail: `The ${r.service} visit on ${longDate(r.date)} is ready to bill now, but AxisCare did not let the Hub take its do-not-bill hold off (${w.why}). Take do-not-bill off in AxisCare by hand so it can be billed. The Hub tries again on its next check.` })) === 'raised') out.cards_raised++ }
            }
          }
        }
        if (!dry && !same(item, p)) await put(db, 'nurse_bill_check', item)
      }
      /* a visit seen before and now gone from AxisCare (removed, or no longer a completed nurse visit): its card closes */
      for (const p of prev.values()) {
        if (p.ax !== c.ax || seen.has(String(p.visit_id)) || p.gone || S(p.date) < checkFrom) continue
        const item = { ...p, gone: true, gone_at: nowIso, ...(p.hold?.state === 'held' ? { hold: { ...p.hold, state: 'visit_gone' } } : {}) }
        if (live && !dry && p.card_at && !p.card_closed_at) { if (await closeCard(db, 'nurse_bill_' + p.visit_id, 'The Hub (the visit is no longer in AxisCare as a completed nurse visit)')) out.cards_closed++; item.card_closed_at = nowIso }
        if (!dry) await put(db, 'nurse_bill_check', item)
      }
    }
  }
  if (!dry) {
    const prevSum = prevItems.find((x) => x && x.id === 'nb_summary') || {}
    const keep = (prevSum.clients || []).filter((s: Any) => failedAx.includes(String(s.ax))).map((s: Any) => ({ ...s, stale: true }))
    await put(db, 'nurse_bill_check', { id: 'nb_summary', at: nowIso, by: opts.by || 'schedule', live, hold_live: holdLive, services_from: svc.from, check_from: checkFrom,
      clients: [...summaries, ...keep].sort((a, b) => S(a.client).localeCompare(S(b.client))), read_failed: out.read_failed, counts: { ready: out.ready, not_ready: out.not_ready } })
  }
  return out
}

/* ═══ 3 · nurse license reminders ═══ */
async function deliver(db: Any, p: { first: string; last: string; phone: string; email: string }, m: { text: string; subject: string; html: string }) {
  const ghl = { token: Deno.env.get('GHL_TOKEN') ?? '', locationId: Deno.env.get('GHL_LOCATION_ID') ?? '' }
  const H = { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' }
  const notSent: string[] = []; let texted = false, emailed = false
  const name = `${p.first} ${p.last}`.trim()
  if (!ghl.token || !ghl.locationId) return { texted, emailed, not_sent: ['texting is not set up on the server'] }
  if (p.phone) {
    const c = await latestTextConsent(db, p.phone)
    if (!c.ok) notSent.push('text: ' + c.why)
    else {
      const id = await ghlContactIfAllowed(db, ghl, SENDER, { channel: 'sms', phone: p.phone, email: p.email, firstName: p.first, lastName: p.last })
      if (!id) notSent.push('text: they opted out, or the number could not be confirmed')
      else if (!(texted = await ghlSendChecked(db, H, SENDER, { channel: 'sms', contactId: id, address: p.phone, who: name }, { message: withStop(m.text) }))) notSent.push('text: GoHighLevel did not accept it (a card is on Needs Attention)')
    }
  }
  if (p.email) {
    const id = await ghlContactIfAllowed(db, ghl, SENDER, { channel: 'email', email: p.email, phone: p.phone, firstName: p.first, lastName: p.last })
    if (!id) notSent.push('email: they opted out, or the address could not be confirmed')
    else if (!(emailed = await ghlSendChecked(db, H, SENDER, { channel: 'email', contactId: id, address: p.email, who: name }, { subject: m.subject, html: m.html }))) notSent.push('email: GoHighLevel did not accept it (a card is on Needs Attention)')
  }
  if (!p.phone && !p.email) notSent.push('no phone number or email on file')
  return { texted, emailed, not_sent: notSent }
}

export async function licensePass(db: Any, st: Any, opts: { dry?: boolean; now?: Date } = {}): Promise<Any> {
  const now = opts.now || new Date(), nowIso = now.toISOString(), today = centralYmd(now), dry = !!opts.dry, live = st.nurse_license_reminders_live === true
  const out: Any = { live, dry, today, due: 0, sent: 0, practice: 0, held: 0, retry: 0, refused: 0, cards: 0, expired: 0, capped: 0, errors: 0 }
  const [staff, stampsList, roster] = await Promise.all(['nurse_staff', 'nurse_license_reminders', 'caregivers'].map((k) => list(db, k)))
  const coord = await coordinatorOf(db)
  let sends = 0
  for (const n of staff) {
    try {
      const k = nurseKey(n); if (!k) continue
      const rowId = 'nlr_' + k, row: Any = stampsList.find((x) => x && x.id === rowId) || { id: rowId, nurse: S(n.name, 120), stamps: {} }
      const stamps: Any = { ...(row.stamps || {}) }
      const d = licenseDue(today, n, stamps); if (!d) continue
      out.due++
      const name = S(n.name, 120) || 'A nurse', [first, ...rest] = name.split(/\s+/)
      const email = S(n.email, 160).toLowerCase()
      const match = email ? roster.filter((g: Any) => g && S(g.email, 160).toLowerCase() === email) : []
      const phone = S(n.phone || n.mobile, 30) || (match.length === 1 ? S(match[0].phone, 30) : '')
      const p = { first, last: rest.join(' '), phone, email }
      const practice = practicePerson(phone, email) || /\(TRAINING\)/.test(name)
      const save = async () => { if (!dry) await put(db, 'nurse_license_reminders', { ...row, nurse: name, stamps, updated_at: nowIso }) }
      if (d.stage === 'expired') {
        if (!live || practice) { stamps[d.key] = { at: nowIso, practice: true }; out.practice++; await save(); continue }
        const c = licenseCard(name, n, d, '')
        const res = dry ? 'dry' : await card(db, { id: `nurse_license_expired_${k}_${d.expires}`, kind: 'nurse_license_expired', urgency: c.urgency, owner: coord, about: name, title: c.title, detail: c.detail, due: nowIso })
        if (res === 'raised') out.cards++
        if (res !== 'failed') { stamps[d.key] = { at: nowIso, card: res }; out.expired++ } else out.errors++
        await save(); continue
      }
      /* 8am to 6pm Central: held (stamped once as held), never dropped */
      if (!inTextHours(now)) { out.held++; if (!stamps[d.key + ':held']) { stamps[d.key + ':held'] = { at: nowIso }; await save() } continue }
      const test = testPerson(st, p)
      if (practice || (!live && !test)) { stamps[d.key] = { at: nowIso, practice: true, ...(practice ? { why: 'a practice person' } : {}) }; out.practice++; await save(); continue }
      if (sends >= SEND_CAP) { out.capped++; continue }
      if (dry) { out.sent++; continue }
      sends++
      const r = await deliver(db, p, licenseMessage(first, n, d))
      const tries = (Number(stamps[d.key + ':tries']?.n) || 0) + 1
      if (r.texted || r.emailed) {
        stamps[d.key] = { at: nowIso, texted: r.texted, emailed: r.emailed, not_sent: r.not_sent, test_person: test && !live }; out.sent++
        if (live) {
          const c = licenseCard(name, n, d, `They were sent a reminder today by ${[r.texted ? 'text' : '', r.emailed ? 'email' : ''].filter(Boolean).join(' and ')}.`)
          if (await card(db, { id: `nurse_license_${k}_${d.expires}_${d.stage}`, kind: 'nurse_license_expiring', urgency: c.urgency, owner: coord, about: name, title: c.title, detail: c.detail, due: new Date(now.getTime() + 864e5).toISOString() }) === 'raised') out.cards++
        }
      } else if (refusedForGood(r.not_sent) || tries >= REMINDER_TRIES) {
        stamps[d.key] = { at: nowIso, texted: false, emailed: false, not_sent: r.not_sent, ...(refusedForGood(r.not_sent) ? { refused: true } : { failed: true, tries }) }; out.refused++
        const c = licenseCard(name, n, d, `The Hub could not reach them: ${r.not_sent.join('; ') || 'no reason given'}. Please call them.`)
        if (await card(db, { id: `nurse_license_${k}_${d.expires}_${d.stage}`, kind: 'nurse_license_expiring', urgency: 'today', owner: coord, about: name, title: c.title, detail: c.detail, due: nowIso }) === 'raised') out.cards++
      } else { stamps[d.key + ':tries'] = { n: tries, last_at: nowIso, not_sent: r.not_sent }; out.retry++ }
      await save()
    } catch (e) {
      out.errors++
      if (!dry) await card(db, { id: 'nurse_license_pass_' + nurseKey(n), kind: 'nurse_license_pass_failed', urgency: 'today', owner: coord, about: S(n?.name, 120),
        title: 'The license reminder check could not work ' + (S(n?.name, 120) || 'a nurse'), detail: `The 30-minute nurse license check stopped on this nurse (${S((e as Error)?.message ?? e, 160)}). A reminder may be waiting. Tell Claude.` })
    }
  }
  return out
}

/* ── the report for the Nurse Scheduling panel ── */
async function report(db: Any, st: Any) {
  const items = await list(db, 'nurse_bill_check'), today = centralYmd(new Date()), from = addDaysYmd(today, -BACK_DAYS)
  const sum = items.find((x) => x && x.id === 'nb_summary') || null
  const visits = items.filter((x) => x && /^nb_/.test(String(x.id)) && x.visit_id && !x.gone)
  const pick = (x: Any) => ({ visit_id: x.visit_id, client: x.client, ax: x.ax, date: x.date, service: x.service, service_key: x.service_key, nurse: x.nurse, cred: x.cred,
    reasons: x.reasons || [], hold: x.hold || null, would_hold: !!x.would_hold, office_marked: !!x.office_marked, checked_at: x.checked_at })
  return { ok: true, live: st.nurse_visit_check_live === true, hold_live: st.nurse_visit_check_live === true && st.nurse_bill_hold_live === true, hold_switch: st.nurse_bill_hold_live === true,
    checked_at: sum?.at || null, services_from: sum?.services_from || nurseServices(st).from, read_failed: sum?.read_failed || 0,
    not_ready: visits.filter((x) => !x.ready && S(x.date) >= from).sort((a, b) => S(b.date).localeCompare(S(a.date))).map(pick),
    holds: visits.filter((x) => x.hold && x.hold.state === 'held').map(pick),
    ready_count: visits.filter((x) => x.ready && S(x.date) >= from).length,
    clients: sum?.clients || [] }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false, autoRefreshToken: false } })
  const b: Any = await req.json().catch(() => ({}))
  const action = S(b.action, 20), dry = new URL(req.url).searchParams.get('dry') === '1' || b.dry === true
  try {
    const st = await settings(db)
    if (action === 'pass') {
      if (!(await jobCaller(req))) return json({ ok: false, error: 'the pass is for the schedule or an owner' }, 401)
      const visits = await visitPass(db, st, { dry })
      const license = await licensePass(db, st, { dry })
      const ok = visits.ok !== false && !license.errors
      if (!dry) {
        const at = new Date().toISOString()
        try { await put(db, 'automation_heartbeats', { id: 'hb_nurse-visit-check', automation: 'nurse-visit-check', at, ok, note: JSON.stringify({ v: visits, l: license }).slice(0, 300) }) } catch { /* the beat must not take the pass down */ }
        try { await put(db, 'automation_log', { id: 'auto_srv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), at, automation: 'nurse_visit_check', ran_by: 'server', ok, dry: !visits.live, summary: { visits, license } }) } catch { /* same */ }
      }
      return json({ ok, visits, license })
    }
    if (['run', 'report', 'services'].includes(action)) {
      const who = await requireStaff(db, req, OFFICE_ROLES)
      if (!who.ok) return json({ ok: false, error: who.error }, who.status)
      if (action === 'report') return json(await report(db, st))
      if (action === 'services') { const u = nurseServices(st); return json({ ok: true, defaults: DEFAULT_NURSE_SERVICES, current: Array.isArray(st.nurse_services) ? st.nurse_services : null, in_use: u.list, from: u.from, dropped: u.dropped }) }
      const v = await visitPass(db, st, { dry, by: who.name || who.email })
      return json({ ...v, report: dry ? null : await report(db, st) })
    }
    return json({ ok: false, error: 'Unknown action.' }, 400)
  } catch (e) {
    return json({ ok: false, error: 'The nurse visit check stopped: ' + S((e as Error)?.message ?? e, 200) }, 500)
  }
})

