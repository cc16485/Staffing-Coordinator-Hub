// =============================================================================
// bg-review (446) · "Something came up" on a background check: the review record and its two messages.
// Samantha approved 2026-10-04 ("yes to all", https://claude.ai/artifact/92p3yq6QqJxHq2dFLiBbY4). See
// _shared/bg-review.ts for the rules and the words.
//
// Office staff (requireStaff), every action on one review:
//   preview  {candidate_id, check} or {id, step: 'step1'|'final'}: the exact words and how they would go
//   open     {candidate_id, check}: opens the review (Needs review). Only for a check recorded as flagged.
//   step1    {id}: sends "Something came up" (text with their yes to texts + email), sets the response due date
//   told     {id, note?}: "told them by phone or in person" instead of the message (sets the due date too)
//   spoke    {id}: "spoke with them"
//   result   {id, result, reason?}: the office's review result (reason: why we are not hiring, for No waiver needed)
//   waiver   {id, step: 'wait'|'approved'|'denied', proof?}: Good Cause Waiver steps (approved clears the review)
//   clear    {id, why}: "They're cleared"; nothing is sent
//   note     {id, note}: a short private office note (never sent)
//   final    {id}: sends the final notice, only when finalGate allows; the review closes as not hired
// Its schedule (the jobs' secret): action 'due_check', weekdays 8am to 6pm Central, one Needs Attention card per
// review whose response due date has passed with no contact recorded. Nothing is ever sent to an applicant without a
// person pressing OK on the words the Hub showed (preview). Texts 8am to 6pm only; outside that both messages wait.
// Everything goes through GoHighLevel (Conversations); a refused message raises a "Didn't go through" card.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { contactForOutbound, maySend } from '../_shared/outreach.ts'
import { requireStaff, OFFICE_ROLES, serverSecretOk } from '../_shared/staff-auth.ts'
import { ghlSendChecked } from '../_shared/send-problems.ts'
import { latestTextConsent } from '../_shared/text-consent.ts'
import { CHECKS, CLEAR_WHY, RESULT_LABEL, isCheck, responseDue, duePassed, centralHour, step1Words, finalWords, finalGate, fmtLong,
  type Check, type Words } from '../_shared/bg-review.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
/* "message to a candidate" on a Needs Attention card, owned by hiring; the bracket is never shown */
const SENDER = 'send-candidate-message (background review)'
const CLAIM_MS = 2 * 60 * 1000
// deno-lint-ignore no-explicit-any
type Any = any

const short = (c: Any) => [String(c?.first || '').trim(), String(c?.last || '').trim().slice(0, 1)].filter(Boolean).join(' ') || 'Someone'
async function candidate(db: Any, id: string): Promise<Any | null> {
  const { data } = await db.from('app_data').select('data').eq('key', 'candidates').maybeSingle()
  return (Array.isArray(data?.data) ? data.data : []).find((c: Any) => c && String(c.id) === String(id)) ?? null
}
const hist = (rv: Any, by: string, what: string) => (Array.isArray(rv?.history) ? rv.history : []).concat([{ at: new Date().toISOString(), by, what }])

/* Send one step's words: a text only with their yes to texts (and not opted out), the email when there is one. */
async function sendWords(db: Any, c: Any, w: Words): Promise<{ texted: boolean; emailed: boolean; not_sent: string[]; held?: string }> {
  if (!maySend('reactive_external').allowed) return { texted: false, emailed: false, not_sent: [], held: 'Messages to applicants go 8am to 6pm. Nothing went; press it again after 8am.' }
  const ghl = { token: Deno.env.get('GHL_TOKEN') ?? '', locationId: Deno.env.get('GHL_LOCATION_ID') ?? '' }
  if (!ghl.token || !ghl.locationId) return { texted: false, emailed: false, not_sent: ['texting and email are not set up on the server'] }
  const H = { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' }
  const who = [c.first, c.last].filter(Boolean).join(' ')
  const person = { phone: c.phone, email: c.email, firstName: c.first, lastName: c.last }
  const common = { humanInitiated: true, audience: 'applicant' as const, sender: SENDER }
  const notSent: string[] = []
  let texted = false, emailed = false
  if (!c.phone) notSent.push('text: no phone number')
  else {
    const ok = await latestTextConsent(db, c.phone)
    if (!ok.ok) notSent.push('text: ' + (ok.why || 'not allowed'))
    else {
      let why = ''
      const k = await contactForOutbound(db, ghl, person, 'reactive_external', { ...common, channel: 'sms', onOptOut: (r) => { why = 'they opted out of texts (' + r.join(', ') + ')' } })
      if (!k) notSent.push('text: ' + (why || 'the number could not be confirmed as safe to text'))
      else { texted = await ghlSendChecked(db, H, SENDER, { channel: 'sms', contactId: k.contactId, address: c.phone, who }, { message: w.text }); if (!texted) notSent.push('text: GoHighLevel did not accept it (a card is on Needs Attention)') }
    }
  }
  if (!c.email) notSent.push('email: no email address')
  else {
    let why = ''
    const k = await contactForOutbound(db, ghl, person, 'reactive_external', { ...common, channel: 'email', onOptOut: (r) => { why = 'they opted out of email (' + r.join(', ') + ')' } })
    if (!k) notSent.push('email: ' + (why || 'could not be sent'))
    else { emailed = await ghlSendChecked(db, H, SENDER, { channel: 'email', contactId: k.contactId, address: c.email, who }, { subject: w.subject, html: w.html }); if (!emailed) notSent.push('email: GoHighLevel did not accept it (a card is on Needs Attention)') }
  }
  return { texted, emailed, not_sent: notSent }
}
const how = (s: { texted: boolean; emailed: boolean }) => [s.texted ? 'text' : '', s.emailed ? 'email' : ''].filter(Boolean).join(' and ')

/* One "claim" at a time, so a double press can never send twice. */
async function claim(db: Any, id: string, col: 'step1_claim_at' | 'final_claim_at'): Promise<boolean> {
  const before = new Date(Date.now() - CLAIM_MS).toISOString()
  const { data } = await db.from('bg_reviews').update({ [col]: new Date().toISOString() }).eq('id', id).or(`${col}.is.null,${col}.lt."${before}"`).select('id')
  return Array.isArray(data) && data.length === 1
}

/* the hiring owner's Needs Attention card when a response due date passes */
async function ownerEmail(db: Any): Promise<string> {
  try {
    const { data: dom } = await db.from('domains').select('owner_person').eq('code', 'caregivers').eq('entity', 'cc_ihs').maybeSingle()
    if (dom?.owner_person) { const { data: p } = await db.from('persons').select('primary_email').eq('person_id', dom.owner_person).maybeSingle(); return String(p?.primary_email ?? '') }
  } catch { /* no owner: the card is still on the list */ }
  return ''
}
export const cardId = (id: string) => 'ops_bgreview_' + id
async function closeCard(db: Any, id: string, by: string) {
  try {
    const { data } = await db.from('app_data').select('data').eq('key', 'ops_items').maybeSingle()
    const it = (Array.isArray(data?.data) ? data.data : []).find((x: Any) => x && x.id === cardId(id))
    if (!it || /^(done|resolved|closed)$/i.test(String(it.status || ''))) return
    const at = new Date().toISOString()
    await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { ...it, status: 'done', last_activity_at: at, log: (it.log || []).concat([{ at, by, text: 'Closed: the background review was decided.' }]) } })
  } catch { /* the review is still decided */ }
}
export async function dueCheck(db: Any, now: Date) {
  const h = centralHour(now), wd = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short' }).format(now)
  if (h < 8 || h >= 18 || wd === 'Sat' || wd === 'Sun') return { ok: true, waiting: 'cards go weekdays 8am to 6pm' }
  const { data, error } = await db.from('bg_reviews').select('*').eq('status', 'open').is('spoke_at', null).is('due_card_at', null)
  if (error) return { ok: false, error: 'the reviews could not be read' }
  const due = (data ?? []).filter((rv: Any) => (rv.step1_at || rv.step1_told_at) && duePassed(rv.due_date, now))
  const owner = due.length ? await ownerEmail(db) : ''
  let cards = 0
  for (const rv of due) {
    const at = new Date().toISOString()
    const { error: e } = await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { id: cardId(rv.id), kind: 'bg_review_card', domain: 'caregivers', status: 'open', urgency: 'today',
      title: `Background review: response due passed for ${rv.who || 'a candidate'}`,
      detail: `They were told something came up on their ${CHECKS[rv.check_key as Check]?.label ?? 'background'} check. Their response due date (${fmtLong(String(rv.due_date))}) has passed and no call is recorded.`,
      next_action: 'Open them in Background & References: record that you spoke with them, mark them cleared, or send the final notice.',
      created_at: at, first_at: at, last_activity_at: at, opened_by: 'bg-review', created_by: 'bg-review', owner, owner_name: '',
      log: [{ at, by: 'automation', text: 'Opened when the response due date passed.' }] } })
    if (e) continue
    await db.from('bg_reviews').update({ due_card_at: at, history: hist(rv, 'automation', 'Response due date passed with no call recorded: Needs Attention card opened for the hiring owner. Nothing was sent and nothing was decided.') }).eq('id', rv.id)
    cards++
  }
  return { ok: true, due: due.length, cards }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  // deno-lint-ignore no-explicit-any
  const b: any = await req.json().catch(() => ({}))
  const action = String(b.action || 'preview')
  const now = new Date()

  /* its schedule: the response due cards (nothing is sent to anyone outside the office) */
  if (action === 'due_check') {
    if (!serverSecretOk(req, 'HUB_JOB_SECRET')) return json({ error: 'not allowed' }, 401)
    if (b.auth_check === true) return json({ ok: true, caller: 'cron' })
    return json(await dueCheck(db, now))
  }

  const who = await requireStaff(db, req, OFFICE_ROLES)
  if (!who.ok) return json({ error: who.error }, who.status)
  const by = who.name || who.email

  /* opening a review, or previewing Step 1 before one is open */
  if (action === 'open' || (action === 'preview' && !b.id)) {
    const check = b.check, cid = String(b.candidate_id ?? '').trim()
    if (!isCheck(check)) return json({ error: 'which check? (fcsr, edl, oig or fp)' }, 400)
    if (!/^\d{1,9}$/.test(cid)) return json({ error: 'which candidate?' }, 400)
    const c = await candidate(db, cid)
    if (!c) return json({ error: 'That candidate was not found. Reload the page.' }, 404)
    if (!CHECKS[check].flagged.includes(String(c[check] ?? ''))) return json({ error: `Their ${CHECKS[check].label} is not recorded as flagged (it says "${c[check] || 'Pending'}").` }, 409)
    if (c.not_hired) return json({ error: 'They are marked Not hired.' }, 409)
    if (action === 'preview') {
      const w = step1Words(String(c.first || '').trim(), check, responseDue(now))
      return json({ ok: true, preview: true, step: 'step1', words: w, phone: !!c.phone, email: !!c.email })
    }
    const { data: open } = await db.from('bg_reviews').select('id').eq('candidate_id', cid).eq('check_key', check).in('status', ['open', 'waiting_waiver'])
    if (Array.isArray(open) && open.length) return json({ ok: true, id: open[0].id, already_open: true })
    const row = { candidate_id: cid, check_key: check, who: short(c), status: 'open', result: 'review', opened_at: now.toISOString(), opened_by: by,
      history: [{ at: now.toISOString(), by, what: `Opened the review: ${CHECKS[check].label} recorded as ${c[check]}` }] }
    const { data, error } = await db.from('bg_reviews').insert(row).select('id')
    if (error || !data?.[0]) return json({ error: 'The review could not be saved: ' + String(error?.message ?? 'no answer').slice(0, 120) }, 500)
    return json({ ok: true, id: data[0].id })
  }

  const id = String(b.id || '').trim()
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'which review?' }, 400)
  const { data: rv, error: rErr } = await db.from('bg_reviews').select('*').eq('id', id).maybeSingle()
  if (rErr) return json({ error: rErr.message }, 500)
  if (!rv) return json({ error: 'That review was not found.' }, 404)
  const check = rv.check_key as Check
  const closed = rv.status === 'cleared' || rv.status === 'not_hired'
  const save = async (patch: Any, what: string) => {
    const { error } = await db.from('bg_reviews').update({ ...patch, history: hist(rv, by, what), updated_at: new Date().toISOString() }).eq('id', id)
    return error ? json({ error: 'Not saved: ' + String(error.message).slice(0, 120) }, 500) : null
  }

  if (action === 'preview') {
    const c = await candidate(db, rv.candidate_id)
    if (!c) return json({ error: 'That candidate was not found.' }, 404)
    const first = String(c.first || '').trim()
    if (b.step === 'final') {
      const g = finalGate(rv, now)
      if (!g.ok) return json({ ok: true, preview: true, step: 'final', blocked: g.why })
      return json({ ok: true, preview: true, step: 'final', variant: g.variant, words: finalWords(first, check, g.variant!, !!rv.spoke_at), phone: !!c.phone, email: !!c.email })
    }
    return json({ ok: true, preview: true, step: 'step1', words: step1Words(first, check, responseDue(now)), phone: !!c.phone, email: !!c.email })
  }
  if (closed) return json({ error: 'This review is already closed.' }, 409)

  if (action === 'step1') {
    if (rv.step1_at) return json({ ok: true, already_sent: true })
    const c = await candidate(db, rv.candidate_id)
    if (!c) return json({ error: 'That candidate was not found.' }, 404)
    if (!(await claim(db, id, 'step1_claim_at'))) return json({ error: 'It is already being sent. Wait a moment and reload.' }, 409)
    const due = responseDue(now)
    const s = await sendWords(db, c, step1Words(String(c.first || '').trim(), check, due))
    if (s.held) { await save({ step1_held_at: now.toISOString(), step1_claim_at: null }, 'Pressed "Something came up" outside texting hours: nothing went'); return json({ ok: true, held: s.held }) }
    if (!s.texted && !s.emailed) { await save({ step1_claim_at: null, step1_note: s.not_sent.join('; ') }, 'Pressed "Something came up": nothing could be sent (' + s.not_sent.join('; ') + ')'); return json({ ok: true, texted: false, emailed: false, not_sent: s.not_sent }) }
    const r = await save({ step1_at: now.toISOString(), step1_by: by, step1_how: how(s), step1_note: s.not_sent.join('; ') || null, step1_held_at: null, step1_claim_at: null, due_date: due },
      `"Something came up" sent by ${how(s)}${s.not_sent.length ? ' (not sent: ' + s.not_sent.join('; ') + ')' : ''}. Response due ${fmtLong(due)}.`)
    return r ?? json({ ok: true, texted: s.texted, emailed: s.emailed, not_sent: s.not_sent, due_date: due })
  }
  if (action === 'told') {
    if (rv.step1_at || rv.step1_told_at) return json({ ok: true, already: true })
    const due = responseDue(now), note = String(b.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)
    return (await save({ step1_told_at: now.toISOString(), step1_by: by, step1_how: 'told by phone or in person', due_date: due, step1_note: note || null },
      `Told them by phone or in person${note ? ': ' + note : ''}. Response due ${fmtLong(due)}.`)) ?? json({ ok: true, due_date: due })
  }
  if (action === 'spoke') {
    const r = await save({ spoke_at: now.toISOString(), spoke_by: by }, 'Spoke with them')
    if (!r && rv.due_card_at) await closeCard(db, id, by)
    return r ?? json({ ok: true })
  }
  if (action === 'result') {
    const res = String(b.result || '')
    if (!CHECKS[check].results.includes(res as Any)) return json({ error: `For ${CHECKS[check].label} the result can be: ${CHECKS[check].results.map((x) => RESULT_LABEL[x]).join(', ')}.` }, 400)
    const reason = String(b.reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 500)
    return (await save({ result: res, decision_reason: reason || null, result_at: now.toISOString(), result_by: by },
      `Review result: ${RESULT_LABEL[res as keyof typeof RESULT_LABEL]}${reason ? ' (why not hiring: ' + reason + ')' : ''}`)) ?? json({ ok: true })
  }
  if (action === 'waiver') {
    if (rv.result !== 'waiver_needed') return json({ error: 'Pick "Waiver needed" first.' }, 409)
    const step = String(b.step || '')
    if (step === 'wait') return (await save({ status: 'waiting_waiver', waiver_wait_at: now.toISOString() }, 'Waiting on their Good Cause Waiver')) ?? json({ ok: true })
    if (step === 'denied') return (await save({ status: 'open', waiver_outcome: 'denied', waiver_decided_at: now.toISOString() }, 'Good Cause Waiver denied')) ?? json({ ok: true })
    if (step === 'approved') {
      const proof = String(b.proof ?? '').trim()
      if (!/^bgcheck\/[\w.\-\/]+$/.test(proof)) return json({ error: 'Attach the approval letter first.' }, 400)
      const r = await save({ status: 'cleared', waiver_outcome: 'approved', waiver_decided_at: now.toISOString(), waiver_proof: proof, cleared_at: now.toISOString(), cleared_by: by, cleared_why: 'waiver_approved' },
        'Good Cause Waiver approved (letter attached). Cleared.')
      if (!r && rv.due_card_at) await closeCard(db, id, by)
      return r ?? json({ ok: true, cleared: true, check, set_to: CHECKS[check].clear })
    }
    return json({ error: 'wait, approved or denied?' }, 400)
  }
  if (action === 'clear') {
    const why = String(b.why || '')
    if (!CLEAR_WHY[why] || why === 'waiver_approved') return json({ error: 'Why are they cleared? (not them, an error that was corrected, or no waiver needed)' }, 400)
    if (why === 'no_waiver' && !(check === 'fcsr' || check === 'fp')) return json({ error: `No waiver applies to ${CHECKS[check].label}.` }, 400)
    const r = await save({ status: 'cleared', cleared_at: now.toISOString(), cleared_by: by, cleared_why: why }, `They're cleared: ${CLEAR_WHY[why]}. Nothing was sent.`)
    if (!r && rv.due_card_at) await closeCard(db, id, by)
    return r ?? json({ ok: true, cleared: true, check, set_to: CHECKS[check].clear })
  }
  if (action === 'note') {
    const note = String(b.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 500)
    if (!note) return json({ error: 'Write the note first.' }, 400)
    return (await save({ note }, 'Office note: ' + note)) ?? json({ ok: true })
  }
  if (action === 'final') {
    const g = finalGate(rv, now)
    if (!g.ok) return json({ error: g.why }, 409)
    const c = await candidate(db, rv.candidate_id)
    if (!c) return json({ error: 'That candidate was not found.' }, 404)
    if (!(await claim(db, id, 'final_claim_at'))) return json({ error: 'It is already being sent. Wait a moment and reload.' }, 409)
    const s = await sendWords(db, c, finalWords(String(c.first || '').trim(), check, g.variant!, !!rv.spoke_at))
    if (s.held) { await save({ final_held_at: now.toISOString(), final_claim_at: null }, 'Pressed "Send the final notice" outside texting hours: nothing went'); return json({ ok: true, held: s.held }) }
    if (!s.texted && !s.emailed) { await save({ final_claim_at: null }, 'Pressed "Send the final notice": nothing could be sent (' + s.not_sent.join('; ') + ')'); return json({ ok: true, texted: false, emailed: false, not_sent: s.not_sent }) }
    const r = await save({ status: 'not_hired', final_at: now.toISOString(), final_by: by, final_variant: g.variant, final_how: how(s), final_held_at: null, final_claim_at: null },
      `Final notice (${g.variant}) sent by ${how(s)}${s.not_sent.length ? ' (not sent: ' + s.not_sent.join('; ') + ')' : ''}. Not hired.`)
    if (!r && rv.due_card_at) await closeCard(db, id, by)
    return r ?? json({ ok: true, texted: s.texted, emailed: s.emailed, not_sent: s.not_sent, not_hired: true })
  }
  return json({ error: 'unknown action' }, 400)
})
