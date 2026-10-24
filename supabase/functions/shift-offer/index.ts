// =============================================================================
// shift-offer: Cara's shift opportunity page (Samantha, 2026-10-24). Rules and wording: _shared/shift-offer.ts.
// One caregiver, one ask on one Cara case, one link (_shared/shift-links.ts: HMAC of case|ask|expiry, ends with the shift
// day). The page is cc.mo-care.com/shift.html. No code and no password (her call, 2026-10-24: "no need for a code on the
// open shift"): the link itself opens the page, exactly like the family app's visit offer link.
//   POST {c,a,e,t, action:'view'}     the shift and the office-approved details (only while it is open)
//   POST {c,a,e,t, action:'answer', shift_key, kind, from?, to?, note?, question?}
//                                     saved onto their own ask, where a text reply goes; a yes is interest only. Refused if
//                                     the shift changed since they looked (shift_key) or AxisCare now shows other hours.
//   POST {action:'preview', case_id, ask_id}    office staff (Hub sign-in): exactly what that caregiver sees, nothing saved;
//                                               'preview_answer' checks an answer without saving it
//   POST {action:'link', case_id, ask_id}       office staff: the caregiver's link, only while the page is switched on
//   POST {action:'revoke'|'restore', case_id, ask_id}  office staff: take one person's link back (or give it back)
// The page shows nothing about the client when the shift is filled, closed, started, changed, or the link was taken back.
// Switch: ops_settings.shift_page_live (off: caregiver links answer "not open yet"; the office preview always works).
// Never: an address or street, a last name, pay, photos, AxisCare changes, a text to a client or family.
// Deployed with verify_jwt OFF (caregivers have no Hub login); this file does the checking.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { checkShiftLink, makeShiftLink, shiftDayEnd } from '../_shared/shift-links.ts'
import { pageState, detailsView, checkAnswer, applyAnswer, answerSummary, shiftKey, visitMatches } from '../_shared/shift-offer.ts'
import { clientInfoFor } from '../_shared/cara-skills.ts'
import { normalisePhone } from '../_shared/outreach.ts'
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
/* THE SHIFT AS AXISCARE HAS IT NOW (2026-10-24: "If a shift changes after an offer is created, the caregiver cannot
   unknowingly accept outdated hours"). The case's visit is read live: gone, or someone else now on it = closed; other day
   or hours than the case = changed. AxisCare unreadable = 'unchecked' (the page shows the shift, an answer waits). */
// deno-lint-ignore no-explicit-any
async function visitNow(k: any): Promise<'same' | 'changed' | 'closed' | 'unchecked' | 'no_visit'> {
  if (!k?.axiscare_visit_id) return 'no_visit'
  let token = ''; for (const n of ['AXISCARE_VISITS_TOKEN', 'AXISCARE_API_KEY', 'AXISCARE_TOKEN']) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  if (!token || !/^\d+$/.test(site)) return 'unchecked'
  try {
    const r = await fetch(`https://${site}.axiscare.com/api/visits/${encodeURIComponent(String(k.axiscare_visit_id))}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-AxisCare-Api-Version': Deno.env.get('AXISCARE_API_VERSION') || '2023-10-01' } })
    if (r.status === 404) return 'closed'
    if (!r.ok) return 'unchecked'
    // deno-lint-ignore no-explicit-any
    const j: any = await r.json().catch(() => ({})); return visitMatches(k, j?.results?.visit ?? j?.results ?? null)
  } catch { return 'unchecked' }
}

/* Save an answer onto the ask (fresh read, then the case written back, as coverage-reply does), and tell the office the
   same way a texted yes or question does: one card per case for yeses, one per person for a question, the office text on
   the first yes. */
// deno-lint-ignore no-explicit-any
async function saveAnswer(caseId: string, askId: string, ans: any): Promise<{ ok: boolean; error?: string; ask?: any }> {
  const k = await readCase(caseId); const a0 = askOf(k, askId)
  if (!k || !a0 || pageState(k, a0, chiNowNaive()) !== 'open') return { ok: false, error: 'This shift is no longer open. Thank you for looking!' }
  const hadYes = (k.asked || []).some((x: { state?: string }) => x.state === 'yes')
  const a = applyAnswer(a0, { ...ans, for: shiftKey(k) }, nowIso())
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
    if (action === 'preview' || action === 'preview_answer' || action === 'link' || action === 'revoke' || action === 'restore') {
      const who = await requireStaff(sb, req, OFFICE_ROLES)
      if (!who.ok) return json({ error: who.error }, who.status)
      const k = await readCase(String(b.case_id || '')); const a = askOf(k, String(b.ask_id || ''))
      if (!k || !a) return json({ error: 'That person is not on this case.' }, 404)
      /* TAKE A LINK BACK (2026-10-24): one person's link stops opening at once; their answers stay on the case */
      if (action === 'revoke' || action === 'restore') {
        const fresh = await readCase(String(k.id)); const on = action === 'revoke'
        fresh.asked = fresh.asked.map((x: { id?: string }) => String(x.id) === String(a.id) ? { ...x, link_revoked: on, link_revoked_by: on ? who.name : null, link_revoked_at: on ? nowIso() : null } : x)
        const { error } = await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: fresh })
        if (error) return json({ error: 'Not saved. Please try again.' }, 500)
        await opEvent(sb, { job: 'shift-offer', verb: on ? 'shift_link_revoked' : 'shift_link_restored', item_id: String(k.id), area: 'coverage', actor_name: who.name,
          summary: `${who.name} ${on ? 'took back' : 'gave back'} ${a.name}'s shift page link for ${k.client || 'a shift'}` })
        return json({ ok: true, link_revoked: on })
      }
      const st0 = pageState(k, a, chiNowNaive()), vn = st0 === 'open' ? await visitNow(k) : 'same'
      const state = vn === 'changed' ? 'changed' : vn === 'closed' ? 'closed' : st0
      if (action === 'preview') return json({ ok: true, preview: true, checked: vn, ...(await details(k, a, state)) })
      if (action === 'preview_answer') { const ch = checkAnswer(k, b); return json(ch.ok ? { ok: true, preview: true, would_save: applyAnswer(a, ch.ans, nowIso()).reply } : { error: ch.error }, ch.ok ? 200 : 400) }
      if ((await settings()).shift_page_live !== true) return json({ error: 'The shift page is in practice: no caregiver links yet. Use Preview to see it as they would.' }, 409)
      return json({ ok: true, link: await makeShiftLink(SECRET, String(k.id), String(a.id), shiftDayEnd(String(k.shift_date || ''))) })
    }

    /* ── the caregiver's own link ── */
    if (!await checkShiftLink(SECRET, b)) return json({ error: 'This link has ended or is not valid. Please call the office at (417) 234-8494.' }, 403)
    if ((await settings()).shift_page_live !== true) return json({ error: 'This page isn\'t open yet. Please call the office at (417) 234-8494.' }, 403)
    const c = String(b.c), aId = String(b.a)
    const k = await readCase(c); const a = askOf(k, aId)
    const st0 = pageState(k, a, chiNowNaive())
    if (st0 !== 'open') return json({ ok: true, state: st0 })   /* filled, closed, started or taken back: nothing about the client */
    const vn = await visitNow(k)
    if (vn === 'closed' || vn === 'changed') return json({ ok: true, state: vn })
    if (action === 'view') return json({ ok: true, checked: vn, ...(await details(k, a, 'open')) })
    if (action === 'answer') {
      if (vn === 'unchecked') return json({ error: 'We can\'t check the schedule right now, so your answer wasn\'t saved. Please try again in a few minutes, or call the office.' }, 503)
      if (String(b.shift_key || '') !== shiftKey(k)) return json({ error: 'This shift changed while you were looking. Please look at the new details before you answer.', changed: true }, 409)
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
