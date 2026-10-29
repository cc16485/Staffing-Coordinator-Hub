// =============================================================================
// livein-sign · LIVE-IN CAREGIVER AGREEMENT, SIGNED ON A PHONE (Samantha 2026-10-29: "have Sheryelle and Rhonda sign the
// live-in packet"; she approved the design the same day)
// =============================================================================
// An owner makes a private link for a caregiver on the list (_shared/livein.ts PEOPLE) and texts it from the office line
// with their own words, or copies it. The caregiver reads the 12 real pages, ticks, types their full name and signs with a
// finger. The signed PDF (the master with page 12 filled in, plus a signature record page) goes in the private bucket
// hr-docs, and the owner gets a My Work task to add the Caring Companions signature. Countersigning writes the finished PDF.
// A row made by the Desktop step's proof is PRACTICE: it runs end to end but texts nobody and makes no task.
//
// ── Owners (Samantha or Zach, their own Hub sign-in)
//   list        {}                         -> { people: [{ name, phone_last4, on_roster }], rows[] } (never the link code or signatures)
//   start       { name }                   -> { row, link, draft, phone_last4 }  an earlier waiting link for them stops working
//   send        { id, message }            -> { outcome: sent|practice|refused|failed }  the owner's own press, their words
//   countersign { id, signature }          -> { row }  the owner's finger signature; the finished PDF is written
//   open        { id, which?: final|employee } -> { url } five minutes; every open logged
//   cancel      { id }                     a waiting link stops working
// ── The caregiver (their private link https://cc.mo-care.com/livein.html?t=<code>; no sign-in)
//   view        { t }                      -> { first, pages, master_sha, statement, consent, status, practice, office_phone }
//   sign        { t, typed_name, consent: true, master_sha, signature } -> { copy_url }
// ── The owner's Desktop step (server key): sample {} -> { id, link, token }  a practice agreement for "Test Caregiver";
//    the key may also countersign and open that practice row, never a real one.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff } from '../_shared/staff-auth.ts'
import { ownerCaller } from '../_shared/job-auth.ts'
import { contactForOutbound, normalisePhone } from '../_shared/outreach.ts'
import { MO_FROM } from '../_shared/office-from.ts'
import { logOpen, ipOf } from '../_shared/doc-log.ts'
import { BUCKET, OFFICE_PHONE, MAX_TEXT, MASTER, PEOPLE, LINK_DAYS, LINK_RE, STATEMENT, CONSENT, sha256, newToken, tokenOk, firstName, shortName,
  nameMatches, linkFor, draftText, sigOf, signedPdf } from '../_shared/livein.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
// deno-lint-ignore no-explicit-any
type Any = any
const OWNER_TASK = 'samantha@mo-care.com'
const PUBLIC = ['view', 'sign']
const SHOW = 'id,practice,caregiver,status,started_by,started_at,expires_at,sent_at,sent_by,opened_at,signed_name,signed_at,rep_name,countersigned_at,pdf_path,final_pdf_path'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } })
  const b: Any = await req.json().catch(() => ({}))
  const action = String(b?.action ?? '')
  try {
    if (PUBLIC.includes(action)) return await caregiverSide(db, req, action, b)
    if (action === 'sample') {
      if (!(await ownerCaller(req))) return json({ error: 'not allowed' }, 401)
      return await sample(db)
    }
    /* the Desktop step's proof: the owner's server key may countersign and open the practice sample only, never a real one */
    if ((action === 'countersign' || action === 'open') && await ownerCaller(req)) {
      const s0 = await getRow(db, b?.id)
      if (!s0 || !s0.practice || s0.caregiver !== 'Test Caregiver') return json({ error: 'not allowed' }, 401)
      const me0 = { email: 'desktop-step', name: 'Desktop step' }
      if (action === 'countersign') return await countersign(db, me0, s0, b)
      const { data } = await db.storage.from(BUCKET).createSignedUrl(String(s0.final_pdf_path || s0.pdf_path || ''), 60)
      return json({ ok: !!data?.signedUrl, url: data?.signedUrl || null })
    }
    const who = await requireStaff(db, req, ['owner_admin'])
    if (!who.ok) return json({ error: who.status === 403 ? 'Only Samantha or Zach can do this.' : who.error }, who.status)
    const me = { email: who.email, name: who.name }
    if (action === 'list') {
      const { data, error } = await db.from('livein_sign').select(SHOW).order('started_at', { ascending: false }).limit(100)
      if (error) throw new Error(error.message)
      const roster = await caregivers(db)
      const people = PEOPLE.map((name) => { const cg = rosterFor(roster, name), ph = cg ? normalisePhone(cg.phone) : null; return { name, phone_last4: ph ? ph.slice(-4) : '', on_roster: !!cg } })
      return json({ ok: true, people, rows: data || [] })
    }
    if (action === 'start') return await start(db, me, b)
    const row = await getRow(db, b?.id)
    if (!row) return json({ error: 'That agreement is not on file. Reload and try again.' }, 404)
    if (action === 'send') return await send(db, me, row, b)
    if (action === 'countersign') return await countersign(db, me, row, b)
    if (action === 'open') {
      const path = b?.which === 'employee' ? row.pdf_path : (row.final_pdf_path || row.pdf_path)
      if (!path) return json({ error: 'There is no PDF yet.' }, 404)
      const logged = await logOpen(db, { subject: 'livein:' + row.id, doc: 'livein_agreement', path, who: { email: me.email, name: me.name, person_id: who.person_id }, ip: ipOf(req) })
      if (!logged) return json({ error: 'The open could not be logged, so the PDF was not opened. Try again.' }, 500)
      const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, 300)
      if (error || !data?.signedUrl) throw new Error('could not open the PDF')
      return json({ ok: true, url: data.signedUrl, expires_in: 300 })
    }
    if (action === 'cancel') {
      if (row.status !== 'waiting') return json({ error: 'Only an agreement still waiting for a signature can be cancelled.' }, 409)
      await db.from('livein_sign').update({ status: 'cancelled', token_hash: null }).eq('id', row.id).eq('status', 'waiting')
      await event(db, row.id, 'cancelled', me)
      return json({ ok: true })
    }
    return json({ error: 'unknown action' }, 400)
  } catch (e) {
    return json({ error: String((e as Error)?.message || e).slice(0, 300) }, 500)
  }
})

async function getRow(db: Any, id: unknown) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id ?? ''))) return null
  return (await db.from('livein_sign').select('*').eq('id', String(id)).maybeSingle()).data
}
async function event(db: Any, signId: string, kind: string, who: { email?: string; name?: string } = {}, detail: Record<string, unknown> = {}) {
  try { await db.from('livein_sign_event').insert({ sign_id: signId, kind, by_email: who.email || null, by_name: who.name || null, detail }) } catch { /* the outcome is on the row itself */ }
}
async function caregivers(db: Any): Promise<Any[]> { const { data } = await db.from('app_data').select('data').eq('key', 'caregivers').maybeSingle(); return Array.isArray(data?.data) ? data.data : [] }
const key = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z]/g, '')
function rosterFor(roster: Any[], name: string): Any | null { const h = roster.filter((c) => key([c?.first, c?.last].join(' ')) === key(name)); return h.length === 1 ? h[0] : null }

/* ── An owner makes the private link ── */
async function start(db: Any, me: Any, b: Any) {
  const name = PEOPLE.find((p) => key(p) === key(b?.name))
  if (!name) return json({ error: 'That person is not on the Live-In Agreement list.' }, 400)
  const cg = rosterFor(await caregivers(db), name)
  const token = newToken()
  await db.from('livein_sign').update({ status: 'cancelled', token_hash: null }).eq('caregiver', name).eq('status', 'waiting')
  const { data: row, error } = await db.from('livein_sign').insert({ practice: false, caregiver: name, axiscare_caregiver_id: cg?.axiscare_id ? String(cg.axiscare_id) : null,
    master_sha: MASTER.sha, token_hash: await sha256(token), expires_at: new Date(Date.now() + LINK_DAYS * 864e5).toISOString(), started_by: me.email }).select(SHOW).single()
  if (error) throw new Error('could not start: ' + error.message)
  await event(db, row.id, 'started', me)
  const link = linkFor(token), phone = cg ? normalisePhone(cg.phone) : null
  return json({ ok: true, row, link, draft: draftText(name, me.name, link), phone_last4: phone ? phone.slice(-4) : '' })
}

/* ── The owner's press: their words, which must carry this agreement's link ── */
async function send(db: Any, me: Any, row: Any, b: Any) {
  if (row.status !== 'waiting') return json({ error: 'This agreement is not waiting to be sent.' }, 409)
  const message = String(b?.message ?? '').replace(/\r\n/g, '\n').trim()
  if (!message) return json({ error: 'The message is empty.' }, 400)
  if (message.length > MAX_TEXT) return json({ error: `The message is ${message.length} characters; keep it under ${MAX_TEXT}.` }, 400)
  const m = message.match(LINK_RE)
  if (!m || (await sha256(m[1])) !== row.token_hash) return json({ error: 'The message must keep the private link to this agreement.' }, 400)
  if (/—/.test(message)) return json({ error: 'Please use a comma instead of the long dash.' }, 400)
  const now = new Date().toISOString()
  if (row.practice) {
    await db.from('livein_sign').update({ sent_at: now, sent_by: me.email }).eq('id', row.id)
    await event(db, row.id, 'practice_send', me, { length: message.length })
    return json({ ok: true, outcome: 'practice', note: 'Practice: nothing was texted.' })
  }
  const cg = rosterFor(await caregivers(db), row.caregiver)
  const phone = cg ? normalisePhone(cg.phone) : null
  if (!phone) return json({ outcome: 'no_phone', error: `${row.caregiver} has no usable phone number on the roster. Copy the link and send it another way.` }, 422)
  const ghl = { token: Deno.env.get('GHL_TOKEN') || Deno.env.get('GHL_API_KEY') || '', locationId: Deno.env.get('GHL_LOCATION_ID') ?? '' }
  if (!ghl.token || !ghl.locationId) return json({ error: 'GoHighLevel is not configured. Nothing was sent.' }, 502)
  let refusal: string[] = []
  const contact = await contactForOutbound(db, ghl, { phone, firstName: cg.first, lastName: cg.last }, 'urgent_internal',
    { audience: 'caregiver', channel: 'sms', sender: 'livein-sign', humanInitiated: true, onOptOut: (r: string[]) => { refusal = r } })
  if (!contact) {
    const why = refusal.length ? `${row.caregiver} has asked not to get texts (${refusal.join('; ')}). Copy the link and give it to them another way` : 'the opt-out check could not be completed. Try again in a minute'
    await event(db, row.id, 'send_refused', me, { why })
    return json({ outcome: 'refused', error: `Not sent: ${why}.` }, 422)
  }
  let ok = false, err = ''
  try {
    const r = await fetch('https://services.leadconnectorhq.com/conversations/messages', { method: 'POST',
      headers: { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'SMS', fromNumber: MO_FROM, contactId: contact.contactId, message }) })
    ok = r.ok; if (!r.ok) err = `GoHighLevel answered ${r.status}`
  } catch { err = 'could not reach GoHighLevel' }
  if (!ok) { await event(db, row.id, 'send_failed', me, { why: err }); return json({ outcome: 'failed', error: `Not sent: ${err}.` }, 502) }
  await db.from('livein_sign').update({ sent_at: now, sent_by: me.email }).eq('id', row.id)
  await event(db, row.id, 'sent', me, { phone_last4: phone.slice(-4), length: message.length })
  return json({ ok: true, outcome: 'sent' })
}

async function master(db: Any): Promise<Uint8Array> {
  const { data, error } = await db.storage.from(BUCKET).download(MASTER.path)
  if (error || !data) throw new Error('the agreement master is not on file')
  const bytes = new Uint8Array(await data.arrayBuffer())
  const h = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((x) => x.toString(16).padStart(2, '0')).join('')
  if (h !== MASTER.sha) throw new Error('the agreement master on file is not the approved one')
  return bytes
}
async function savePdf(db: Any, row: Any, part: string, bytes: Uint8Array): Promise<string> {
  const path = `${row.practice ? 'practice' : 'livein'}/${row.id}-${part}-${Date.now()}.pdf`
  const { error } = await db.storage.from(BUCKET).upload(path, bytes, { contentType: 'application/pdf', upsert: false })
  if (error) throw new Error('could not keep the PDF: ' + error.message)
  return path
}
async function card(db: Any, row: Any, open: boolean) {
  if (row.practice) return
  const now = new Date().toISOString()
  try {
    await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item: {
      id: 'ops_livein_' + row.id, kind: 'livein_countersign', source_id: row.id, sensitive: true,
      title: 'Add your signature: Live-In Agreement, ' + shortName(row.caregiver),
      detail: 'They signed the Live-In Caregiver Agreement on their phone. Open HR, Live-In Agreement and press Add my signature.',
      next_action: 'Add the Caring Companions signature on HR, Live-In Agreement.', about: shortName(row.caregiver), owner: OWNER_TASK,
      domain: 'caregiver_performance', urgency: 'normal', status: open ? 'open' : 'done', closed_at: open ? null : now, closed_by: open ? null : 'system',
      created_at: row.signed_at || now, last_activity_at: now, due: new Date(Date.now() + 2 * 864e5).toISOString(), opened_by: 'system', link: '#hr/livein' } })
  } catch { /* the HR page shows the button anyway */ }
}

/* ── An owner adds the Caring Companions signature: the finished PDF ── */
async function countersign(db: Any, me: Any, row: Any, b: Any) {
  if (row.status !== 'signed') return json({ error: row.status === 'countersigned' ? 'It is already countersigned.' : 'It is not signed by the caregiver yet.' }, 409)
  const sig = sigOf(b?.signature)
  if (!sig) return json({ error: 'Sign in the box first.' }, 400)
  const at = new Date(), repName = String(me.name || me.email).slice(0, 120)
  const bytes = await signedPdf({ master: await master(db), row,
    employee: { name: row.signed_name, sig: row.sig_png, at: new Date(row.signed_at), ip: row.sign_ip || '', agent: row.sign_agent || '' },
    rep: { name: repName, sig, at, email: me.email } })
  const final_pdf_path = await savePdf(db, row, 'final', bytes)
  const { data: done, error } = await db.from('livein_sign').update({ status: 'countersigned', rep_name: repName, rep_email: me.email, rep_sig_png: sig,
    countersigned_at: at.toISOString(), final_pdf_path }).eq('id', row.id).eq('status', 'signed').select(SHOW).maybeSingle()
  if (error || !done) return json({ error: 'Someone else countersigned it first. Reload.' }, 409)
  await event(db, row.id, 'countersigned', me)
  await card(db, done, false)
  return json({ ok: true, row: done })
}

/* ── The caregiver's link ── */
async function caregiverSide(db: Any, req: Request, action: string, b: Any) {
  if (!tokenOk(b?.t)) return json({ error: 'This link is not valid. Call the office at ' + OFFICE_PHONE + '.' }, 404)
  const { data: row } = await db.from('livein_sign').select('*').eq('token_hash', await sha256(String(b.t))).maybeSingle()
  if (!row || row.status === 'cancelled') return json({ error: 'This link is no longer active. Call the office at ' + OFFICE_PHONE + '.' }, 404)
  const expired = row.status === 'waiting' && row.expires_at && new Date(row.expires_at).getTime() < Date.now()
  if (action === 'view') {
    if (row.status === 'waiting' && !row.opened_at) { await db.from('livein_sign').update({ opened_at: new Date().toISOString() }).eq('id', row.id); await event(db, row.id, 'opened', {}, { ip: ipOf(req) }) }
    return json({ ok: true, first: firstName(row.caregiver), pages: MASTER.pages, master_sha: row.master_sha, statement: STATEMENT, consent: CONSENT,
      status: expired ? 'expired' : row.status, signed_at: row.signed_at, practice: row.practice, office_phone: OFFICE_PHONE })
  }
  // sign
  if (row.status !== 'waiting') return json({ error: 'This agreement is already signed. Thank you.' }, 409)
  if (expired) return json({ error: 'This link has expired. Call the office at ' + OFFICE_PHONE + ' for a new one.' }, 410)
  if (b?.consent !== true) return json({ error: 'Tick the box to confirm you read the agreement and agree to it.' }, 400)
  if (String(b?.master_sha || '') !== row.master_sha) return json({ error: 'The agreement changed. Reload the page and read it again.' }, 409)
  const typed = String(b?.typed_name || '').trim().replace(/\s+/g, ' ').slice(0, 120)
  if (!nameMatches(typed, row.caregiver)) return json({ error: 'Type your full first and last name, as on your employee record.' }, 400)
  const sig = sigOf(b?.signature)
  if (!sig) return json({ error: 'Sign in the box with your finger.' }, 400)
  const at = new Date(), ip = ipOf(req).split(',')[0].trim().slice(0, 64), agent = String(req.headers.get('user-agent') || '').slice(0, 300)
  const bytes = await signedPdf({ master: await master(db), row, employee: { name: typed, sig, at, ip, agent } })
  const pdf_path = await savePdf(db, row, 'employee', bytes)
  const { data: done, error } = await db.from('livein_sign').update({ status: 'signed', signed_name: typed, signed_at: at.toISOString(), sign_ip: ip, sign_agent: agent,
    sig_png: sig, pdf_path, token_hash: null }).eq('id', row.id).eq('status', 'waiting').select('*').maybeSingle()
  if (error || !done) return json({ error: 'This agreement was already signed or closed. Thank you.' }, 409)
  await event(db, row.id, 'signed', { name: typed })
  await card(db, done, true)
  const { data: u } = await db.storage.from(BUCKET).createSignedUrl(pdf_path, 600)
  return json({ ok: true, copy_url: u?.signedUrl || null, practice: done.practice })
}

/* ── A practice agreement for the Desktop step's proof (never texted, no task) ── */
async function sample(db: Any) {
  const token = newToken()
  const { data: row, error } = await db.from('livein_sign').insert({ practice: true, caregiver: 'Test Caregiver', master_sha: MASTER.sha, token_hash: await sha256(token),
    expires_at: new Date(Date.now() + 36e5).toISOString(), started_by: 'desktop-step', sent_at: new Date().toISOString() }).select('id').single()
  if (error) throw new Error('could not make the sample: ' + error.message)
  await event(db, row.id, 'started', { name: 'Desktop step' }, { practice: true })
  return json({ ok: true, id: row.id, link: linkFor(token), token })
}
