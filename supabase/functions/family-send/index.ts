// =============================================================================
// family-send · SEND TO FAMILY, the office's side (Samantha 2026-10-28: "Yes, build it with your picks: Billing owner enters
// payment forms, no 3-digit code unless AxisCare needs it, start with the four pieces"). Signed-in office staff only.
//   list    {client_ax}                                  who in the Family Circle can get a link (and why not), every send
//                                                       for this client, and the payment forms (last 4 only)
//   send    {client_ax, client_name, piece, contact_id, channels}
//                                                       a 7-day link to ONE circle person (a newer one replaces the old)
//   cancel  {id}                                         stops a live link
//   show    {payment_id}                                 the full card or bank numbers, once, to type into AxisCare: a care
//                                                       coordinator, the Billing owner or an owner (Samantha 2026-10-28: "Care
//                                                       Coordinators can input payment info into axiscare"); every show is logged
//   entered {payment_id}                                 "Entered in AxisCare": the numbers are erased for good, the card closes
// The hourly job (its own secret) erases any numbers still held 7 days after signing and marks the card.
// Until ops_settings.family_send_live is on, only owners can send (to try it). Nothing here changes AxisCare.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { jobCaller } from '../_shared/job-auth.ts'
import { ownerFor } from '../_shared/send-problems.ts'
import { open as unseal } from '../_shared/step1-crypto.ts'
import { LINK_DAYS, sha256, secret, sendFamily } from '../_shared/agreement-links.ts'
import { PIECES, PIECE_NAME, FORM_PAGE, ERASE_DAYS, reachOf, reachView, linkMessages, sendView, payView, payLabel, cardId, closeCard } from '../_shared/family-send.ts'

// deno-lint-ignore no-explicit-any
type Any = any
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cc-via, x-cron-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const AX = /^[0-9]{1,12}$/, UUID = /^[0-9a-f-]{36}$/i
const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric' })

async function settings(db: Any) { const { data } = await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle(); return data?.data || {} }
async function circleFor(db: Any, ax: string) {
  const { data: cs, error } = await db.from('care_circles').select('id, client_name').eq('axiscare_client_id', ax).limit(1)
  if (error) throw error
  if (!cs?.[0]) return { circle: null, people: [] as Any[] }
  const { data: ps, error: e2 } = await db.from('circle_contacts').select('*').eq('circle_id', cs[0].id)
  if (e2) throw e2
  return { circle: cs[0], people: ps || [] }
}

/** The hourly job: erase anything still held 7 days after signing. */
export async function sweep(db: Any, now = Date.now()) {
  const cut = new Date(now - ERASE_DAYS * 86400e3).toISOString()
  const { data: rows, error } = await db.from('family_payments').select('id, send_id, client_ax, client_name, signer_name, method, brand, bank_type, last4').not('sealed', 'is', null).lt('signed_at', cut)
  if (error) throw error
  let n = 0
  for (const r of rows || []) {
    const { data: did } = await db.from('family_payments').update({ sealed: null, erased_at: new Date(now).toISOString(), erased_why: 'seven_days' }).eq('id', r.id).not('sealed', 'is', null).select('id')
    if (!did?.length) continue
    n++
    try {
      const id = cardId('pay', r.send_id)
      const { data: row } = await db.from('app_data').select('data').eq('key', 'ops_items').maybeSingle()
      const prev = (Array.isArray(row?.data) ? row.data : []).find((x: Any) => x && x.id === id)
      if (prev && prev.status !== 'done') await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { ...prev, urgency: 'urgent', last_at: new Date(now).toISOString(),
        next_action: `The numbers were erased after ${ERASE_DAYS} days without "Entered in AxisCare". If they aren't in AxisCare, send ${r.signer_name} a new payment form.` } })
    } catch { /* the erase is what matters */ }
  }
  return n
}

if (typeof Deno !== 'undefined' && Deno.serve) Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only.' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  let b: Any = {}
  try { b = await req.json() } catch { b = {} }
  try {
    const job = req.headers.get('x-cron-secret') || b?.action === 'sweep' ? await jobCaller(req) : null
    if (job) return json({ ok: true, caller: job, erased: await sweep(db) })
    if (b?.action === 'sweep') return json({ error: 'not allowed' }, 401)
    const who = await requireStaff(db, req, OFFICE_ROLES)
    if (!who.ok) return json({ error: who.error }, who.status)
    const action = String(b?.action ?? '')
    const me = who.email, myName = who.name || who.email
    const owner = who.roles.includes('owner_admin')
    const billing = (await ownerFor(db, 'billing')).toLowerCase()
    const canShow = owner || who.roles.includes('care_coordinator') || (!!billing && billing === me.toLowerCase())
    const S = await settings(db), live = S.family_send_live === true

    if (action === 'list') {
      const ax = String(b.client_ax ?? ''); if (!AX.test(ax)) return json({ error: 'Pick a client first.' }, 400)
      const { circle, people } = await circleFor(db, ax)
      const { data: sends, error: se } = await db.from('family_sends').select('*').eq('client_ax', ax).order('created_at', { ascending: false }).limit(40)
      if (se) throw se
      const { data: pays, error: pe } = await db.from('family_payments').select('*').eq('client_ax', ax).order('signed_at', { ascending: false }).limit(20)
      if (pe) throw pe
      const reach = people.map(reachOf).filter(Boolean).map((r: Any) => reachView(r)).sort((x: Any, y: Any) => (y.main ? 1 : 0) - (x.main ? 1 : 0) || x.name.localeCompare(y.name))
      return json({ ok: true, live, can_send: live || owner, can_show: canShow, billing_owner: billing || null, linked: !!circle,
        people: reach, sends: (sends || []).map((s: Any) => ({ ...sendView(s), payment: s.piece === 'payment' ? payView((pays || []).find((p: Any) => p.send_id === s.id)) : null })) })
    }

    if (action === 'send') {
      if (!live && !owner) return json({ error: 'Send to family is not switched on yet. Only Samantha or Zach can send for now, to try it.', outcome: 'off' }, 403)
      const ax = String(b.client_ax ?? ''), piece = String(b.piece ?? ''), cid = String(b.contact_id ?? '')
      if (!AX.test(ax)) return json({ error: 'Pick a client first.' }, 400)
      if (!(PIECES as readonly string[]).includes(piece)) return json({ error: 'Pick what to send.' }, 400)
      const { circle, people } = await circleFor(db, ax)
      if (!circle) return json({ error: 'This client has no Family Circle linked yet. Link it on Family & Contacts first.', outcome: 'not_linked' }, 409)
      const p = people.find((x: Any) => String(x.id) === cid), r = p && reachOf(p)
      if (!r) return json({ error: 'Pick someone in this client\'s Family Circle.', outcome: 'not_in_circle' }, 409)
      if (r.why) return json({ error: r.name + ': ' + r.why, outcome: 'cannot_reach' }, 409)
      const want = (Array.isArray(b.channels) ? b.channels : []).filter((c: string) => (c === 'sms' && r.sms) || (c === 'email' && r.email))
      const channels: ('sms' | 'email')[] = [...new Set(want)] as Any
      if (!channels.length) return json({ error: 'Pick a text or an email that ' + r.name + ' can get.' }, 400)
      const clientName = String(b.client_name || circle.client_name || '').slice(0, 80)
      const now = new Date(), t = secret(), expires = new Date(now.getTime() + LINK_DAYS * 86400e3)
      await db.from('family_sends').update({ revoked_at: now.toISOString(), revoked_by: 'replaced by a newer link' }).eq('client_ax', ax).eq('piece', piece).is('revoked_at', null).is('done_at', null)
      const { data: ins, error: ie } = await db.from('family_sends').insert({ client_ax: ax, client_name: clientName, piece, contact_id: r.id, token_hash: await sha256(t),
        to_name: r.name, to_phone: r.sms ? r.phone : null, to_email: r.email ? r.mail : null, channels,
        sent_by: me, sent_by_name: myName, expires_at: expires.toISOString() }).select('*').single()
      if (ie) throw ie
      const url = FORM_PAGE + '#t=' + t
      const m = linkMessages({ piece: piece as Any, toName: r.name, clientName, url, expires: day(expires.toISOString()) })
      const ghl = { token: Deno.env.get('GHL_API_KEY') || Deno.env.get('GHL_TOKEN') || '', locationId: Deno.env.get('GHL_LOCATION_ID') || '' }
      const results = []
      for (const ch of channels) results.push(await sendFamily(db, ghl, { channel: ch, phone: r.phone, email: r.mail, toName: r.name, sender: 'family-send', kind: 'reactive_external', sms: m.sms, subject: m.subject, html: m.html }))
      const sent = Object.fromEntries(results.map((x) => [x.channel, { outcome: x.outcome, at: now.toISOString() }]))
      const any = results.some((x) => x.outcome === 'sent')
      const patch: Any = { sent }
      if (!any) Object.assign(patch, { revoked_at: new Date().toISOString(), revoked_by: results.some((x) => x.outcome === 'held') ? 'held: outside 8am to 6pm' : 'not delivered' })
      const { data: row, error: ue } = await db.from('family_sends').update(patch).eq('id', ins.id).select('*').single()
      if (ue) throw ue
      return json({ ok: any, outcome: any ? 'sent' : results[0]?.outcome || 'failed', send: sendView(row), results: results.map((x) => ({ channel: x.channel, outcome: x.outcome, detail: x.detail })),
        message: any ? `${PIECE_NAME[piece as keyof typeof PIECE_NAME]} sent to ${r.name}.` : results.map((x) => x.detail).join(' ') }, any ? 200 : 409)
    }

    if (action === 'cancel') {
      const id = String(b.id ?? ''); if (!UUID.test(id)) return json({ error: 'Pick a link.' }, 400)
      const { data: did, error } = await db.from('family_sends').update({ revoked_at: new Date().toISOString(), revoked_by: myName }).eq('id', id).is('revoked_at', null).is('done_at', null).select('*')
      if (error) throw error
      return did?.length ? json({ ok: true, send: sendView(did[0]) }) : json({ error: 'That link already finished or was cancelled.', outcome: 'stale' }, 409)
    }

    if (action === 'show' || action === 'entered') {
      if (!canShow) return json({ error: 'Only a care coordinator, the person who handles Billing' + (billing ? ` (${billing})` : '') + ' or an owner can do this.', outcome: 'not_billing' }, 403)
      const id = String(b.payment_id ?? ''); if (!UUID.test(id)) return json({ error: 'Pick a payment form.' }, 400)
      const { data: ps, error } = await db.from('family_payments').select('*').eq('id', id).limit(1)
      if (error) throw error
      const p = ps?.[0]; if (!p) return json({ error: 'That payment form is not on file.' }, 404)
      if (!p.sealed) return json({ error: 'The numbers were already erased (' + (p.erased_why === 'entered' ? 'entered in AxisCare' : 'after ' + ERASE_DAYS + ' days') + '). Send a new payment form if you need them.', outcome: 'erased' }, 410)
      if (action === 'show') {
        const kek = Deno.env.get('FAMILY_PAY_KEK') || ''
        if (!kek) return json({ error: 'The payment lock key is missing on the server. Tell Claude.' }, 500)
        const plain = JSON.parse(await unseal(kek, p.id, p.sealed))
        const { error: le } = await db.from('family_payment_reveals').insert({ payment_id: p.id, by_email: me, by_name: myName })
        if (le) throw le   // no log, no number
        await db.from('family_payments').update({ reveals: (p.reveals ?? 0) + 1 }).eq('id', p.id)
        return json({ ok: true, method: p.method, ...plain, label: payLabel(p), seconds: 300 })
      }
      const at = new Date().toISOString()
      const { data: did, error: ee } = await db.from('family_payments').update({ sealed: null, erased_at: at, erased_why: 'entered', entered_at: at, entered_by: myName }).eq('id', p.id).not('sealed', 'is', null).select('*')
      if (ee) throw ee
      if (!did?.length) return json({ error: 'Someone already marked it.', outcome: 'stale' }, 409)
      await closeCard(db, cardId('pay', p.send_id), me, `Entered in AxisCare by ${myName}; the numbers were erased.`)
      return json({ ok: true, payment: payView(did[0]) })
    }
    return json({ error: 'Unknown action.' }, 400)
  } catch (e) {
    console.error('family-send', String(e).slice(0, 300))
    return json({ error: 'Something went wrong on the server. Try again, or tell Claude.' }, 500)
  }
})
