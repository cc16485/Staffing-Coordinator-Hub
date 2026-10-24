// =============================================================================
// shift-offer: Cara's shift opportunity page (Samantha, 2026-10-24). Rules and wording: _shared/shift-offer.ts.
// One caregiver, one ask on one Cara case, one link (_shared/shift-links.ts: HMAC of case|ask|expiry, ends with the shift
// day). The page is cc.mo-care.com/shift.html.
//   POST {c,a,e,t, action:'view'}                 anyone holding the link: their first name, day, time, hours, town. Nothing
//                                                  about the client.
//   POST {c,a,e,t, action:'send_code'}             a one-time 6-digit code texted from (417) 234-8494 to the phone that got the
//                                                  offer (once a minute, 5 a day; works 10 minutes)
//   POST {c,a,e,t, action:'verify', code}          5 wrong codes lock the link; a right one opens a 2-hour session
//   POST {c,a,e,t, action:'details', session}      the office-approved client details and the shift's time rules
//   POST {c,a,e,t, action:'answer', session, kind, from?, to?, note?, question?}
//                                                  saved onto their own ask, where a text reply goes; a yes is interest only
//   POST {action:'preview', case_id, ask_id}       office staff (Hub sign-in): exactly what that caregiver would see, no code,
//                                                  nothing saved; 'preview_answer' checks an answer without saving it
//   POST {action:'link', case_id, ask_id}          office staff: the caregiver's link, only while the page is switched on
// Switch: ops_settings.shift_page_live (off: caregiver links answer "not open yet"; the office preview always works).
// Never: an address or street, a last name, pay, photos, AxisCare changes, a text to a client or family.
// Deployed with verify_jwt OFF (caregivers have no Hub login); this file does the checking.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { checkShiftLink, makeShiftLink, shiftDayEnd } from '../_shared/shift-links.ts'
import { pageState, preView, detailsView, checkAnswer, applyAnswer, answerSummary } from '../_shared/shift-offer.ts'
import { clientInfoFor } from '../_shared/cara-skills.ts'
import { contactForOutbound, normalisePhone } from '../_shared/outreach.ts'
import { ghlSendChecked } from '../_shared/send-problems.ts'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { opEvent } from '../_shared/events.ts'
import { chiNowNaive } from '../_shared/loops.ts'
import { textCaseAdmins, withLink } from '../_shared/callin-notify.ts'

const SECRET = Deno.env.get('HUB_JOB_SECRET') ?? ''
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const ghl = { token: Deno.env.get('GHL_TOKEN') ?? '', locationId: Deno.env.get('GHL_LOCATION_ID') ?? '' }
const nowIso = () => new Date().toISOString()
const enc = new TextEncoder()
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
const hash = async (s: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode('cc-cara-shift-code-v1:' + SECRET + ':' + s)))
const same = (a: string, b: string) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0 }
const CODE_MIN = 10, SESSION_H = 2, MAX_TRIES = 5, MAX_SENDS_DAY = 5

// deno-lint-ignore no-explicit-any
async function settings(): Promise<any> { const { data } = await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle(); return data?.data ?? {} }
// deno-lint-ignore no-explicit-any
async function readCase(id: string): Promise<any | null> {
  const { data } = await sb.from('app_data').select('data').eq('key', 'coverage_cases').maybeSingle()
  // deno-lint-ignore no-explicit-any
  return (Array.isArray(data?.data) ? data!.data : []).find((x: any) => x?.id === id) ?? null
}
// deno-lint-ignore no-explicit-any
const askOf = (k: any, askId: string) => (Array.isArray(k?.asked) ? k.asked : []).find((a: any) => String(a?.id) === askId) ?? null
const rowId = (c: string, a: string) => `${c}|${a}`
// deno-lint-ignore no-explicit-any
async function codeRow(c: string, a: string): Promise<any | null> { const { data } = await sb.from('shift_offer_codes').select('*').eq('id', rowId(c, a)).maybeSingle(); return data ?? null }
// deno-lint-ignore no-explicit-any
async function saveRow(c: string, a: string, vals: any) { await sb.from('shift_offer_codes').upsert({ id: rowId(c, a), case_id: c, ask_id: a, ...vals, updated_at: nowIso() }, { onConflict: 'id' }) }

/* the AxisCare client (care level, and the town when the case doesn't carry one) */
// deno-lint-ignore no-explicit-any
async function axClient(id: string | null): Promise<any | null> {
  if (!id) return null
  let token = ''; for (const n of ['AXISCARE_VISITS_TOKEN', 'AXISCARE_API_KEY', 'AXISCARE_TOKEN']) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  if (!token || !/^\d+$/.test(site)) return null
  try {
    const r = await fetch(`https://${site}.axiscare.com/api/clients/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-AxisCare-Api-Version': Deno.env.get('AXISCARE_API_VERSION') || '2023-10-01' } })
    if (!r.ok) return null
    // deno-lint-ignore no-explicit-any
    const j: any = await r.json().catch(() => ({})); return j?.results?.client ?? j?.results ?? null
  } catch { return null }
}
// deno-lint-ignore no-explicit-any
async function details(k: any, ask: any, state: string) {
  const cl = await axClient(k.client_axiscare_id ? String(k.client_axiscare_id) : null)
  const kk = { ...k, client_city: k.client_city || String(cl?.residentialAddress?.city ?? '').trim() || null }
  const info = await clientInfoFor(sb, k.client_axiscare_id ? String(k.client_axiscare_id) : null, cl)
  return detailsView(kk, ask, state, { ...info, care_line: k.care_note || null })
}
// deno-lint-ignore no-explicit-any
async function sessionOk(c: string, a: string, session: unknown): Promise<boolean> {
  const s = String(session ?? ''); if (!/^[A-Za-z0-9_-]{43}$/.test(s)) return false
  const r = await codeRow(c, a); if (!r?.session_hash || !r.session_exp || Date.parse(r.session_exp) < Date.now()) return false
  return same(await hash('s:' + s), String(r.session_hash))
}

/* Save an answer onto the ask (fresh read, then the case written back, as coverage-reply does), and tell the office the
   same way a texted yes or question does: one card per case for yeses, one per person for a question, the office text on
   the first yes. */
// deno-lint-ignore no-explicit-any
async function saveAnswer(caseId: string, askId: string, ans: any): Promise<{ ok: boolean; error?: string; ask?: any }> {
  const k = await readCase(caseId); const a0 = askOf(k, askId)
  if (!k || !a0 || pageState(k, a0, chiNowNaive()) !== 'open') return { ok: false, error: 'This shift is no longer open. Thank you for looking!' }
  const hadYes = (k.asked || []).some((x: { state?: string }) => x.state === 'yes')
  const a = applyAnswer(a0, ans, nowIso())
  k.asked = k.asked.map((x: { id?: string }) => String(x.id) === askId ? a : x)
  const { error } = await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: k })
  if (error) return { ok: false, error: 'Not saved. Please try again in a minute.' }
  const first = String(a.name || '').split(' ')[0] || 'A caregiver'
  await opEvent(sb, { job: 'shift-offer', verb: a.state === 'yes' ? 'yes_received' : 'reply_received', item_id: caseId, area: 'coverage', actor_name: String(a.name || 'a caregiver'),
    summary: `${a.name} answered on the shift page for ${k.client || 'a shift'}: ${String(a.reply).slice(0, 120)}` })
  const stamp = nowIso()
  if (a.state === 'yes') {
    const yeses = (k.asked || []).filter((x: { state?: string }) => x.state === 'yes')
    await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { id: `ops_covfill_${caseId}`, kind: 'coverage', coverage_case_id: caseId,
      title: `${yeses.length} answered yes for ${k.client || 'the shift'}. Pick on the board`, about: k.client || '',
      // deno-lint-ignore no-explicit-any
      detail: 'Said yes so far: ' + yeses.map((x: any) => `${x.name}${x.reply ? ` ("${String(x.reply).slice(0, 70)}")` : ''}`).join('; ') + '. A yes is interest only; nobody is assigned until the office confirms.',
      domain: 'scheduling_coverage', status: 'open', urgency: 'high', created_at: stamp, due: new Date(Date.now() + 3600000).toISOString(), owner: '', owner_name: '', created_by: 'shift-offer', opened_by: 'callout' } })
    if (!hadYes && ghl.token && ghl.locationId) {
      try { await textCaseAdmins(sb, ghl, await settings(), k, (link) => withLink(`${first} said yes on the shift page for ${String(k.client || 'a shift').split(' ')[0]} (${k.shift_date || ''} ${k.shift_time || ''}). Nothing is assigned yet. Pick on the board: {link}`, link), { onlyAlerted: true, allIfNoneRecorded: true }) } catch { /* the card is there */ }
    }
  }
  if (a.state === 'inquiry') {
    await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { id: `ops_covq_${caseId}_${String(normalisePhone(a.phone) || askId).replace(/\D/g, '') || askId}`, kind: 'coverage', coverage_case_id: caseId,
      title: `${a.name} has a question about the ${k.client || ''} shift`, about: a.name, detail: `They asked on the shift page: "${String(ans.question).slice(0, 300)}". Text them back from the office line, then mark their answer on the case.`,
      domain: 'scheduling_coverage', status: 'open', urgency: 'high', created_at: stamp, due: new Date(Date.now() + 2 * 3600000).toISOString(), owner: '', owner_name: '', created_by: 'shift-offer', opened_by: 'callout' } })
  }
  return { ok: true, ask: a }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  // deno-lint-ignore no-explicit-any
  const b: any = await req.json().catch(() => ({}))
  const action = String(b?.action || 'view')
  try {
    /* ── the office: preview and links ── */
    if (action === 'preview' || action === 'preview_answer' || action === 'link') {
      const who = await requireStaff(sb, req, OFFICE_ROLES)
      if (!who.ok) return json({ error: who.error }, who.status)
      const k = await readCase(String(b.case_id || '')); const a = askOf(k, String(b.ask_id || ''))
      if (!k || !a) return json({ error: 'That person is not on this case.' }, 404)
      const state = pageState(k, a, chiNowNaive())
      if (action === 'preview') return json({ ok: true, preview: true, ...(await details(k, a, state)) })
      if (action === 'preview_answer') { const ch = checkAnswer(k, b); return json(ch.ok ? { ok: true, preview: true, would_save: applyAnswer(a, ch.ans, nowIso()).reply } : { error: ch.error }, ch.ok ? 200 : 400) }
      if ((await settings()).shift_page_live !== true) return json({ error: 'The shift page is in practice: no caregiver links yet. Use Preview to see it as they would.' }, 409)
      return json({ ok: true, link: await makeShiftLink(SECRET, String(k.id), String(a.id), shiftDayEnd(String(k.shift_date || ''))) })
    }

    /* ── the caregiver's own link ── */
    if (!await checkShiftLink(SECRET, b)) return json({ error: 'This link has ended or is not valid. Please call the office at (417) 234-8494.' }, 403)
    if ((await settings()).shift_page_live !== true) return json({ error: 'This page isn\'t open yet. Please call the office at (417) 234-8494.' }, 403)
    const c = String(b.c), aId = String(b.a)
    const k = await readCase(c); const a = askOf(k, aId)
    const state = pageState(k, a, chiNowNaive())
    if (action === 'view') return json({ ok: true, ...(state !== 'open' ? { state } : preView(k, a, state)) })   /* filled, closed, started or taken back: just that */
    if (state !== 'open') return json({ ok: true, state })   /* filled, closed, started or taken back: nothing about the client */

    if (action === 'send_code') {
      const phone = normalisePhone(a.phone)
      if (!phone) return json({ error: 'We don\'t have a phone for you on this offer. Please call the office.' }, 409)
      const r = await codeRow(c, aId)
      if (r?.locked_at) return json({ error: 'This link is locked after too many tries. Please call the office.' }, 423)
      const day = Date.now() - 86400000
      const sends = (Array.isArray(r?.sends) ? r.sends : []).filter((t: string) => Date.parse(t) > day)
      if (sends.length && Date.now() - Date.parse(sends[sends.length - 1]) < 60000) return json({ error: 'A code was just sent. Please wait a minute before asking for another.' }, 429)
      if (sends.length >= MAX_SENDS_DAY) return json({ error: 'Too many codes today. Please call the office.' }, 429)
      const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0')
      const contact = await contactForOutbound(sb, ghl, { phone, firstName: String(a.name || '').split(' ')[0] }, 'urgent_internal', { audience: 'caregiver', channel: 'sms', sender: 'shift-offer' })
      if (!contact) return json({ error: 'We couldn\'t text a code to your phone. Please call the office.' }, 409)
      await saveRow(c, aId, { code_hash: await hash('c:' + code), code_sent_at: nowIso(), code_tries: 0, sends: [...sends, nowIso()] })
      const okSend = await ghlSendChecked(sb, { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json' }, 'shift-offer',
        { channel: 'sms', contactId: contact.contactId, address: phone, who: a.name }, { message: `Your Caring Companions code is ${code}. It works for ${CODE_MIN} minutes. Please don't share it.` })
      if (!okSend) return json({ error: 'The code didn\'t go out. Please try again, or call the office.' }, 502)
      return json({ ok: true, sent: true, to_last4: phone.slice(-4) })
    }
    if (action === 'verify') {
      const r = await codeRow(c, aId)
      if (r?.locked_at) return json({ error: 'This link is locked after too many tries. Please call the office.' }, 423)
      if (!r?.code_hash || !r.code_sent_at || Date.now() - Date.parse(r.code_sent_at) > CODE_MIN * 60000) return json({ error: 'That code has expired. Please ask for a new one.' }, 410)
      const good = same(await hash('c:' + String(b.code ?? '').replace(/\D/g, '').slice(0, 6)), String(r.code_hash))
      if (!good) {
        const tries = (Number(r.code_tries) || 0) + 1
        await saveRow(c, aId, { code_tries: tries, ...(tries >= MAX_TRIES ? { locked_at: nowIso(), code_hash: null } : {}) })
        return json({ error: tries >= MAX_TRIES ? 'Too many tries. This link is locked; please call the office.' : `That code didn't match. ${MAX_TRIES - tries} tr${MAX_TRIES - tries === 1 ? 'y' : 'ies'} left.` }, 401)
      }
      const session = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      await saveRow(c, aId, { code_hash: null, code_tries: 0, session_hash: await hash('s:' + session), session_exp: new Date(Date.now() + SESSION_H * 3600000).toISOString() })
      return json({ ok: true, session })
    }
    if (!await sessionOk(c, aId, b.session)) return json({ error: 'Please confirm it\'s you first (a code to your phone).', need_code: true }, 401)
    if (action === 'details') return json({ ok: true, ...(await details(k, a, state)) })
    if (action === 'answer') {
      const ch = checkAnswer(k, b); if (!ch.ok) return json({ error: ch.error }, 400)
      const out = await saveAnswer(c, aId, ch.ans); if (!out.ok) return json({ error: out.error }, 409)
      return json({ ok: true, answered: answerSummary(out.ask) })
    }
    return json({ error: 'unknown action' }, 400)
  } catch (e) {
    console.error('shift-offer', String((e as Error)?.message ?? e))
    return json({ error: 'Something went wrong on our side. Please try again in a minute.' }, 500)
  }
})
