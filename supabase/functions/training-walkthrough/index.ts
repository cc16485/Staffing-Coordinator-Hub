// =============================================================================
// training-walkthrough · TRY THE NEW-HIRE JOURNEY YOURSELF (Samantha 2026-10-11: "I would like for our staff to also put their
// info in to experience it, as a training, set up inside the applicant journey tab"; "yes to all": any office staff; through the
// welcome call; it ends by itself after 14 days; their records show "(TRAINING)").
//   { action: 'start', first, phone, email }   office staff, their OWN phone and email: the phone and email go on the Admin
//        page's test list (so the onboarding messages reach them even with the switches off), a new-path offer is made for
//        "<first> (TRAINING)" and its real offer link is sent to them. One open walkthrough per staff member.
//   { action: 'end', offer_id }                the person who started it or an owner: the offer withdrawn, the Hub records off
//        the working lists, the card closed, cards done, an open welcome call cancelled, their phone and email off the test
//        list (only what this walkthrough added). Every history stays.
//   { action: 'list' }                         the open walkthroughs (the Applicant journey tab shows them)
//   { action: 'sweep' }                        (the daily schedule) ends every walkthrough past its 14 days
// AxisCare is never written. Nobody but the staff member is ever contacted.
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { jobCaller } from '../_shared/job-auth.ts'
type Any = any
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const S = (v: unknown, n = 200) => String(v ?? '').trim().slice(0, n)
const d10 = (v: unknown) => String(v ?? '').replace(/\D/g, '').slice(-10)
export const LABEL = 'Training walkthrough', DAYS = 14, KEY = 'training_walkthroughs'
const TRN_FN = 'https://rdqujxiycycwhskyvrwa.supabase.co/functions/v1/job-offer'

function trn() {
  const url = Deno.env.get('OFFERS_PROJECT_URL') ?? '', key = Deno.env.get('OFFERS_SERVICE_ROLE_KEY') ?? ''
  const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
  return {
    ok: !!(url && key), key,
    async get(path: string) { const r = await fetch(`${url}/rest/v1/${path}`, { headers: H }); return r.ok ? await r.json() : [] },
    async insert(table: string, row: Any) { const r = await fetch(`${url}/rest/v1/${table}`, { method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(row) }); const j = await r.json().catch(() => null); return r.ok ? (Array.isArray(j) ? j[0] : j) : null },
    async patch(path: string, body: Any) { const r = await fetch(`${url}/rest/v1/${path}`, { method: 'PATCH', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(body) }); return r.ok ? await r.json() : [] },
  }
}
async function list(db: Any): Promise<Any[]> { const { data } = await db.from('app_data').select('data').eq('key', KEY).maybeSingle(); return Array.isArray(data?.data) ? data.data : [] }
async function put(db: Any, item: Any) { await db.rpc('upsert_app_data_item', { target_key: KEY, item }) }

/** end one walkthrough everywhere (never throws; says what it did) */
export async function endOne(db: Any, T: Any, w: Any, by: string, why: string) {
  const now = new Date().toISOString(), out: Any = { offer_id: w.id }
  try {
    const rows = await T.patch(`job_offers?id=eq.${w.id}&offered_by=eq.${encodeURIComponent(LABEL)}&offer_withdrawn_at=is.null`, { offer_status: 'withdrawn', offer_withdrawn_at: now, offer_withdrawn_by: by, offer_withdraw_reason: why })
    if (Array.isArray(rows) && rows.length) await T.insert('offer_events', { offer_id: w.id, kind: 'withdrawn', by_who: 'office', doc_version: 1, detail: { training: true, reason: why } })
    out.offer = Array.isArray(rows) && rows.length ? 'withdrawn' : 'already closed'
  } catch (e) { out.offer = 'not withdrawn: ' + String((e as Error).message || e).slice(0, 120) }
  try { const { data } = await db.rpc('training_walkthrough_close', { p_offer_id: String(w.id), p_reason: why }); out.hub = data } catch (e) { out.hub = { ok: false, error: String((e as Error).message || e).slice(0, 120) } }
  /* take their phone and email off the test list, only what THIS walkthrough added and no other open one still uses */
  const others = (await list(db)).filter((x) => x && x.status === 'open' && x.id !== w.id)
  const keepPhone = others.some((x) => d10(x.phone) === d10(w.phone)), keepEmail = others.some((x) => S(x.email).toLowerCase() === S(w.email).toLowerCase())
  try { await db.rpc('test_people_remove', { p_phone: w.added_phone && !keepPhone ? w.phone : '', p_email: w.added_email && !keepEmail ? w.email : '' }) } catch { /* the list can be changed on the Admin page */ }
  await put(db, { ...w, status: 'ended', ended_at: now, ended_by: by, end_reason: why, result: out })
  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false, autoRefreshToken: false } })
  const b: Any = await req.json().catch(() => ({}))
  const action = S(b.action, 20), T = trn()
  try {
    if (action === 'sweep') {
      if (!(await jobCaller(req))) return json({ error: 'not allowed' }, 401)
      const now = Date.now(), done: Any[] = []
      for (const w of (await list(db)).filter((x) => x && x.status === 'open' && Date.parse(x.ends_at) <= now)) done.push(await endOne(db, T, w, 'the Hub (14 days)', 'Training walkthrough ended after 14 days'))
      try { await db.rpc('upsert_app_data_item', { target_key: 'automation_log', item: { id: 'auto_srv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), at: new Date().toISOString(), automation: 'training_walkthrough', ran_by: 'server', ok: true, dry: false, summary: { ended: done.length } } }) } catch { /* the log is not the work */ }
      return json({ ok: true, ended: done })
    }
    const who = await requireStaff(db, req, OFFICE_ROLES)
    if (!who.ok) return json({ error: who.error }, who.status)
    const isOwner = (who.roles || []).includes('owner_admin')
    if (action === 'list') {
      const all = (await list(db)).filter((x) => x && x.status === 'open')
      return json({ ok: true, open: all.map((x) => ({ ...x, mine: x.by_email === who.email })), may_end_all: isOwner })
    }
    if (action === 'end') {
      const w = (await list(db)).find((x) => x && x.id === S(b.offer_id, 64) && x.status === 'open')
      if (!w) return json({ error: 'That walkthrough is not open.' }, 404)
      if (w.by_email !== who.email && !isOwner) return json({ error: 'Only the person who started it, or an owner, can end it.' }, 403)
      return json({ ok: true, ...(await endOne(db, T, w, who.email || 'office', 'Training walkthrough ended by ' + (who.name || who.email))) })
    }
    if (action !== 'start') return json({ error: 'Unknown action.' }, 400)
    if (!T.ok) return json({ error: 'The Training Platform connection is not set up on this project.' }, 500)
    const first = S(b.first, 40).replace(/[^A-Za-z' -]/g, '').trim(), phone = d10(b.phone), email = S(b.email, 160).toLowerCase()
    if (first.length < 2) return json({ error: 'Type your first name.' }, 400)
    if (phone.length !== 10) return json({ error: 'Type your own cell phone number (ten digits).' }, 400)
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Type your own email address.' }, 400)
    const open = (await list(db)).filter((x) => x && x.status === 'open')
    if (open.some((x) => x.by_email === who.email)) return json({ error: 'You already have a walkthrough open. End it first (below) to start a new one.' }, 409)
    if (open.some((x) => d10(x.phone) === phone || S(x.email).toLowerCase() === email)) return json({ error: 'That phone or email is already in another open walkthrough.' }, 409)
    /* never cross with a real person: a Hub record, a Training caregiver (AxisCare), or an open offer with this phone or email */
    const [{ data: cands }, { data: rost }] = await Promise.all([db.from('app_data').select('data').eq('key', 'candidates').maybeSingle(), db.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()])
    const hit = (r: Any) => r && (d10(r.phone) === phone || S(r.email).toLowerCase() === email)
    if ([...(cands?.data || []), ...(rost?.data || [])].some(hit)) return json({ error: 'That phone or email is on an applicant or caregiver record already, so a walkthrough could get mixed up with it. Use another number or email, or ask Claude.' }, 409)
    const tc = await T.get(`caregivers?select=id&or=(mobile_phone.ilike.*${phone.slice(-4)}*,email.eq.${encodeURIComponent(email)})`)
    const tcs = Array.isArray(tc) ? tc : []
    if (tcs.length) { const full = await T.get(`caregivers?select=id,mobile_phone,email&id=in.(${tcs.map((x: Any) => x.id).join(',')})`); if ((full || []).some((x: Any) => d10(x.mobile_phone) === phone || S(x.email).toLowerCase() === email)) return json({ error: 'That phone or email is on a Training Platform caregiver (AxisCare), so a walkthrough could get mixed up with it. Use another number or email.' }, 409) }
    const offs = await T.get(`job_offers?select=id,phone,email&offer_withdrawn_at=is.null&offer_declined_at=is.null&phone=ilike.*${phone.slice(-4)}*`)
    const offsE = await T.get(`job_offers?select=id&offer_withdrawn_at=is.null&offer_declined_at=is.null&email=ilike.${encodeURIComponent(email)}`)
    if ((offs || []).some((x: Any) => d10(x.phone) === phone) || (offsE || []).length) return json({ error: 'An open offer already uses that phone number or email.' }, 409)
    /* 1. on the test list (so the messages reach them with the switches off) */
    const { data: tp } = await db.rpc('test_people_add', { p_phone: phone, p_email: email })
    /* 2. the offer, on the new path, as a made-up hire "(TRAINING)" */
    /* no expiry here: the Resend below takes it (and the link's token) from the Hub's calendar, as a real offer does */
    const now = new Date()
    const offer = await T.insert('job_offers', { first_name: first, last_name: '(TRAINING)', phone, email, position: 'Caregiver', pay_rate: 17, hours_type: 'PART_TIME', interview_date: now.toISOString().slice(0, 10),
      offered_by: LABEL, onboarding_path: 'new', classification: 'part_time', offer_status: 'sent', offer_version: 1, pd_version: 1, offer_sent_at: now.toISOString(), offer_sent_by: who.email,
      created_at: now.toISOString(), notes: 'Training walkthrough for ' + (who.name || who.email) + ' (their own phone and email). Ends by itself after 14 days.' })
    if (!offer?.id) { try { await db.rpc('test_people_remove', { p_phone: tp?.added_phone ? phone : '', p_email: tp?.added_email ? email : '' }) } catch { /* */ } return json({ error: 'The practice offer could not be made; nothing else changed.' }, 500) }
    const w = { id: String(offer.id), first, phone, email, by_email: who.email, by_name: who.name, started_at: now.toISOString(), ends_at: new Date(now.getTime() + DAYS * 86400000).toISOString(),
      added_phone: !!tp?.added_phone, added_email: !!tp?.added_email, status: 'open' }
    await put(db, w)
    /* 3. their real offer link, sent the way the offer card's Resend sends it (with their own sign-in) */
    let sent: Any = null
    try {
      const r = await fetch(TRN_FN, { method: 'POST', headers: { apikey: T.key, Authorization: 'Bearer ' + T.key, 'x-hub-token': (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, ''), 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resend_offer', offer_id: w.id }) })
      sent = await r.json().catch(() => null)
    } catch (e) { sent = { error: String((e as Error).message || e).slice(0, 120) } }
    return json({ ok: true, walkthrough: w, offer_sent: sent?.offer_sent ?? null, not_sent: sent?.not_sent ?? (sent?.error ? [sent.error] : []) })
  } catch (e) {
    return json({ error: 'Something went wrong: ' + ((e as Error).message || 'error') + '. Nothing more was changed.' }, 500)
  }
})
