// Supabase Edge Function: coverage-reply  (shared hub project)
// -----------------------------------------------------------------------------
// The other half of the callout loop (replacing CareQB Callouts): a caregiver
// texts back and the answer lands on the coverage case.
//
// A GHL Workflow (trigger: Customer Replied, filtered to contacts tagged
// `coverage-asked`) POSTs here, gated by ?token=COVERAGE_REPLY_TOKEN:
//   { id: contactId, phone, name, message }   (message LAST — GHL substitution)
//
// What happens to a reply:
//   YES     first yes on the case wins: the case records pending_fill, an
//           URGENT ops item tells the office "confirm & assign in AxisCare",
//           and the caregiver gets an instant "got it — the office will
//           confirm with you shortly". A later yes after someone already won
//           gets an honest "someone beat you to it — thank you!".
//   NO      recorded. No reply text (a decline answered feels like pressure).
//   other   recorded as an INQUIRY and raised as an ops item with their exact
//           words, so a human answers the question — never a robot.
//
// NOTHING here assigns a shift. AI proposes, a person disposes: the office
// confirms the fill in the hub and updates AxisCare. asked[] is the one
// record; the hub board reads the same field the manual workflow writes.
// -----------------------------------------------------------------------------
import { ghlStoredContactIfAllowed } from '../_shared/optout.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { shadowRoute } from '../_shared/routing.ts'
import { opEvent } from '../_shared/events.ts'
import { ghlSendChecked, reportSendProblem } from '../_shared/send-problems.ts'
import { ghlStaffContact } from '../_shared/staff-contact.ts'
import { officeQuiet } from '../_shared/quiet-hours.ts'
import { adminRecipients } from '../_shared/clockin-admins.ts'
import { callinLink, withLink } from '../_shared/callin-notify.ts'
import { OPEN_HOURS_ACK_DEFAULT, offeredCells, readByWords, readOpenHoursReply } from '../_shared/open-hours.ts'
import { readShiftReply, settleReply } from '../_shared/cara-reply.ts'
import { readGoBack, waitingQuestion } from '../_shared/prn-familiar.ts'
import { withHistory, shiftKey } from '../_shared/shift-offer.ts'   // answer history and the hours an answer was for (2026-10-24)   // CARA PHASE 1: the AI reads the answer (cara_reply_ai_live)

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
const norm = (p: string) => String(p || '').replace(/\D/g, '').slice(-10)

/* NO SILENT FAILURES (2026-10-01): every text here is automatic (a webhook), so one GoHighLevel refuses (or that
   can't go because GHL_TOKEN is missing) raises a card on Needs Attention. `to` says who it was for. */
async function sms(contactId: string, message: string,
                   to: { sender: string; address?: unknown; who?: unknown } = { sender: 'coverage-reply' }): Promise<boolean> {
  const token = Deno.env.get('GHL_TOKEN')
  if (!token || !contactId) {
    await reportSendProblem(sb, { sender: to.sender, channel: 'sms', address: to.address, who: to.who,
      reasons: [!token ? 'GoHighLevel is not set up (no token)' : 'no contact to text'], failed: true })
    return false
  }
  return await ghlSendChecked(sb, { Authorization: `Bearer ${token}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
    to.sender, { channel: 'sms', contactId, address: to.address, who: to.who }, { message })
}

/** The PRN go-back answer, when this text is one: 'yes' | 'no' | 'unclear' recorded in prn_touches, or null (not one). */
async function goBackAnswer(text: string, digits: string): Promise<string | null> {
  try {
    const since = new Date(Date.now() - 3 * 86_400_000).toISOString()
    const { data: asked } = await sb.from('prn_touches').select('applicant_id').eq('kind', 'goback_asked').gte('at', since)
    const ids = [...new Set((asked ?? []).map((r) => String(r.applicant_id)))]
    if (!ids.length) return null
    const [{ data: apps }, { data: tr }, { data: cgRow }] = await Promise.all([
      sb.from('job_applicants').select('id, phone').in('id', ids),
      sb.from('pay_tracks').select('applicant_id, axiscare_caregiver_id').eq('track', 'prn_team').in('applicant_id', ids),
      sb.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()])
    // deno-lint-ignore no-explicit-any
    const roster: any[] = Array.isArray(cgRow?.data) ? cgRow!.data : []
    const who = ids.find((id) => {
      // deno-lint-ignore no-explicit-any
      const a: any = (apps ?? []).find((x) => String(x.id) === id) || {}
      const ax = String((tr ?? []).find((t) => String(t.applicant_id) === id)?.axiscare_caregiver_id ?? '')
      const cg = ax ? roster.find((c) => String(c?.axiscare_id ?? '') === ax) : null
      return (!!digits && [a.phone, cg?.phone].some((p) => norm(String(p || '')) === digits))
    })
    if (!who) return null
    const { data: mine } = await sb.from('prn_touches').select('*').eq('applicant_id', who)
    const q = waitingQuestion(mine ?? [], new Date())
    if (!q) return null
    const said = readGoBack(text)
    const kind = said === 'yes' ? 'goback_yes' : said === 'no' ? 'goback_no' : 'goback_unclear'
    const { error } = await sb.from('prn_touches').insert({ applicant_id: who, kind, ref: q.ref, note: text.slice(0, 600), by_email: 'coverage-reply', by_name: 'Their text' })
    if (error && !/duplicate|unique/i.test(error.message)) { console.error('[coverage-reply] go-back answer not recorded', error.message); return null }
    await opEvent(sb, { job: 'coverage-reply', verb: 'prn_' + kind, item_id: who, area: 'caregivers', summary: `PRN go-back answer (${said || 'unclear'}) for ${q.ref}` })
    return said || 'unclear'
  } catch (e) { console.error('[coverage-reply] go-back check failed', e); return null }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200 })
  const url = new URL(req.url)
  const expected = Deno.env.get('COVERAGE_REPLY_TOKEN')
  if (!expected || url.searchParams.get('token') !== expected) return json({ error: 'unauthorized' }, 401)

  // GHL merge-field substitution can break JSON when the message carries
  // quotes/newlines — same defensive parse as the other phone functions.
  const raw = await req.text()
  // deno-lint-ignore no-explicit-any
  let b: Record<string, any> = {}
  try { b = JSON.parse(raw) } catch {
    const grab = (k: string) => (raw.match(new RegExp('"' + k + '"\\s*:\\s*"([^"]*)"')) || [])[1] || ''
    b = { id: grab('id'), phone: grab('phone'), name: grab('name') }
    const m = raw.match(/"message"\s*:\s*([\s\S]*)\}\s*$/)
    if (m) b.message = m[1].trim().replace(/^"/, '').replace(/",?$/, '').trim()
  }
  const field = (k: string) => {
    const v = typeof b[k] === 'string' ? String(b[k]).trim() : ''
    return v.includes('{{') ? '' : v
  }
  const phone = field('phone')
  const contactId = field('id') || field('contactId') || field('contact_id')
  const text = field('message') || field('body') || field('text')
  const digits = norm(phone)
  if (!text) return json({ ok: true, routed: 'no message text, nothing to record' })

  // Which callout is this an answer to? The newest open case where this
  // phone (or contact) was texted and hasn't answered yet — else the
  // newest open case that texted them at all (people change their minds).
  const { data: row } = await sb.from('app_data').select('data').eq('key', 'coverage_cases').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const cases: any[] = Array.isArray(row?.data) ? row!.data : []
  // deno-lint-ignore no-explicit-any
  const matches: Array<{ c: any; a: any }> = []
  for (const c of cases) {
    if (c?.status !== 'open') continue
    for (const a of (Array.isArray(c.asked) ? c.asked : [])) {
      /* Only asks the system actually TEXTED can be what a text answers: Cara's
         automatic waves (auto) and the coordinator picker (picked_by_coordinator,
         since 2026-09-19). The auto-only filter predated the picker, so every
         picker reply found "nothing to attach to" (fixed 2026-09-28). Asks staff
         logged by hand after a call stay out. */
      if (a.auto !== true && a.picked_by_coordinator !== true) continue
      const hit = (digits && norm(String(a.phone || '')) === digits) ||
                  (contactId && String(a.ghl_contact_id || '') === contactId)
      if (hit) matches.push({ c, a })
    }
  }
  // Canned responses (Settings → Callout texts) with built-in fallbacks.
  const { data: setRow } = await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
  /* ── YES → STAFF HANDOFF ALERT (approved 2026-09-16) ─────────────────────
     When a caregiver becomes the current pending_fill, each phone in
     ops_settings.coverage_alert_phones gets ONE text saying a human
     confirmation is awaited. Empty or missing setting means NO staff SMS —
     no fallback to timekeeper phones, owners, or anything hard-coded.
     Recipients that succeeded are recorded per pending DECISION in
     pending_fill.staff_alerts (normalised phone -> sent-at): a replayed
     webhook re-sends only to recipients that never succeeded, while a NEW
     decision (a promotion, or a rescind-then-yes-again) starts a fresh
     record and alerts afresh. DELIVERY GUARANTEE, stated honestly:
     at-least-once per recipient per decision — the successful-recipient
     record is persisted immediately after sending, so a duplicate text to
     staff requires BOTH that immediate write to fail AND the provider to
     replay the webhook. A staff-alert failure of any kind never touches
     the caregiver acknowledgment, pending_fill, the Operations Inbox item,
     or the assignment path (coverage-assign remains the only writer). */
  // deno-lint-ignore no-explicit-any
  async function alertStaffOfPending(c: any, yesName?: string) {
    try {
      /* CI2 (2026-10-03, her decision 2 on the call-ins plan): the YES goes to the call-in list (the same people as the
         call-in text), each with their OWN link to the call-in page: Confirm, Call, Ask more, no sign-in. It used to go
         to a list of bare phone numbers (coverage_alert_phones) with a link that needed a sign-in. */
      const admins = (await adminRecipients(sb, settings)).filter((a) => a.phone)
      const who = yesName || c.pending_fill?.name
      if (!admins.length || !who) return
      /* OFFICE QUIET HOURS (Samantha, 2026-10-03): no office text 8pm to 7am Central. The YES is on the case and its
         Needs Attention item; nothing is recorded as sent and nothing is queued for the morning. */
      if (officeQuiet(new Date(), settings)) { console.log('[coverage-reply] staff alert held: office quiet hours'); return }
      const ghlToken = Deno.env.get('GHL_TOKEN')
      const ghlLocation = Deno.env.get('GHL_LOCATION_ID')
      if (!ghlToken || !ghlLocation) return
      /* Dedupe lives on the CASE (collect-all-yeses has no pending_fill), one text per admin per call-in as before;
         a legacy pending_fill's record is folded in so nobody is re-texted. */
      const sent: Record<string, string> =
        (c.yes_staff_alerts && typeof c.yes_staff_alerts === 'object') ? c.yes_staff_alerts
        : (c.pending_fill?.staff_alerts && typeof c.pending_fill.staff_alerts === 'object')
          ? { ...c.pending_fill.staff_alerts } : {}
      c.yes_staff_alerts = sent
      /* Same 12-hour rule as coverage-run (her call, 2026-09-16): staff read
         "2026-09-18 5pm-9pm", never "17:00-21:00". Non-HH:MM passes through. */
      const clock12 = (t: string): string => {
        const m = String(t || '').trim().match(/^(\d{1,2}):(\d\d)$/)
        if (!m) return String(t || '').trim()
        const h24 = Number(m[1]); const h = h24 % 12 || 12
        return `${h}${m[2] === '00' ? '' : ':' + m[2]}${h24 >= 12 ? 'pm' : 'am'}`
      }
      const span12 = (s: string) => String(s || '').trim().split('-').map(clock12).join('-')
      const whenTxt = [c.shift_date, span12(c.shift_time)].filter(Boolean).join(' ') || 'the time on the case'
      let tmpl = String((settings as any).coverage_msg_staff_yes || '') ||
        `Cara: {caregiver} said YES to cover {client}, {when}. More yeses may come. Confirm, call, or ask more from your link: {link}`
      /* a stored wording that ends with the old board link gets the admin's own link instead */
      if (!/\{link\}/.test(tmpl)) tmpl = tmpl.replace(/https?:\/\/cc\.mo-care\.com\/#cara\/case\/\{case\}/, '{link}')
      const base = tmpl.replaceAll('{caregiver}', String(who)).replaceAll('{client}', String(c.client || 'the client'))
        .replaceAll('{when}', whenTxt).replaceAll('{case}', encodeURIComponent(String(c.id)))
      let any = false
      const reached: string[] = []
      for (const a of admins) {
        const key = 'yes:' + a.email
        if (sent[key]) continue          // one text per admin per call-in (the first YES), as before per phone
        try {
          /* ONE CONTACT (2026-10-01): the office text goes to the contact found by the one-contact rule for sms. */
          const cid = await ghlStaffContact({ token: String(ghlToken), locationId: String(ghlLocation) }, { channel: 'sms', phone: a.phone, email: a.email, firstName: a.first || 'Scheduling' })
          if (!cid) {
            console.error('[coverage-reply] staff alert: no contact id for an admin')
            await reportSendProblem(sb, { sender: 'staff-alert', channel: 'sms', address: String(a.phone), who: a.name || 'the office (caregiver said YES)',
              reasons: ['GHL returned no contact id'], failed: true })
            continue
          }
          const msg = withLink(base, await callinLink(String(c.id), a.email, c.shift_date))
          if (await sms(cid, msg, { sender: 'staff-alert', address: String(a.phone), who: a.name || 'the office (caregiver said YES)' })) { sent[key] = new Date().toISOString(); any = true; reached.push(a.email) }
          else console.error('[coverage-reply] staff alert send failed for one recipient')
        } catch (e) {
          console.error('[coverage-reply] staff alert recipient error', e)
          await reportSendProblem(sb, { sender: 'staff-alert', channel: 'sms', address: String(a.phone), who: a.name || 'the office (caregiver said YES)',
            reasons: ['could not send: ' + String((e as Error)?.message ?? e).slice(0, 80)], failed: true })
        }
      }
      /* Persist the successful-recipient record NOW rather than only at the
         end of the handler: this closes the replay-duplication window to
         the instant between a successful send and this write. */
      if (any) {
        const had = Array.isArray(c.admin_links) ? c.admin_links.map((e: unknown) => String(e).toLowerCase()) : []
        c.admin_links = [...new Set([...had, ...reached])]
        await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: c })
      }
      /* Step 3 shadow: what the playbook would have said, next to what
         production did. Observer only. */
      await shadowRoute(sb, { area: 'sched_calloffs', channel: 'first-YES staff SMS',
        production: any ? admins.map((a) => String(a.phone)) : [], case_id: String(c.id),
        note: any ? '' : 'nothing newly sent (deduped or send failed)' })
    } catch (e) { console.error('[coverage-reply] staff alert block failed', e) }
  }
  // deno-lint-ignore no-explicit-any
  const settings: any = setRow?.data ?? {}

  matches.sort((x, y) => new Date(String(y.a.at || 0)).getTime() - new Date(String(x.a.at || 0)).getTime())
  const m = matches.find(x => x.a.state === 'waiting') ?? matches[0]
  /* PRN STEP 3 (2026-10-28): no open callout asked them, but a PRN member was asked "Would you be glad to go back?" in the
     last 3 days. A clear YES or NO is recorded; anything else waits on the PRN This Week list for the office. A shift ask
     always wins: a YES while a callout is open is about the shift. */
  if (!m) {
    const gb = await goBackAnswer(text, digits)
    if (gb) return json({ ok: true, routed: 'prn go-back answer: ' + gb })
  }
  if (!m) return json({ ok: true, routed: 'no open callout asked this number, nothing to attach to' })
  const { c, a } = m
  /* Asked on TWO open callouts at once? An SMS cannot say which one they
     mean — a human decides instead of the code guessing (review finding). */
  const caseIds = new Set(matches.map(x => x.c.id))
  const ambiguous = caseIds.size > 1

  /* CLASSIFICATION, negation first. "I can't I don't have a baby sitter
     sorry" was read as YES because /i can/ matched the front of "can't"
     (the apostrophe passes a word boundary) — Dixie Kuhn, first live
     callout. Rules now: any negation wording makes it a NO no matter how it
     starts; YES needs a clean affirmative with no negation anywhere; and
     anything unclear goes to a HUMAN as a question — a wrong "inquiry" costs
     a minute, a wrong YES freezes the callout and lies to the caregiver. */
  const t = text.toLowerCase()
  const hasNeg = /(can'?t|cannot|can\s+not|won'?t|unable|not able|no way|i'?m not|don'?t think)/.test(t)
  let isYes = !hasNeg && (
    /^\s*(y|yes|yeah|yep|yea|sure|absolutely|definitely|of course)\b/.test(t) ||
    /\b(i'?ll take|i can take|i can cover|i can do|i'?ll cover|i'?ll do it|count me in|i'?m available|works for me)\b/.test(t))
  let isNo = hasNeg ||
    /^\s*(n|no|nope|nah|sorry)\b/.test(t) ||
    /\b(pass|not this time|next time)\b/.test(t)
  const stamp = new Date().toISOString()
  const prevReply = String(a.reply || '')
  /* THE ANSWER HISTORY (2026-10-24): the answer standing now is kept before this text replaces it; and a text answer is
     for the hours on the case right now (the board compares it with the shift if the shift changes later) */
  a.answer_history = withHistory(a)
  a.answer_channel = 'text'; delete a.answer_kind; delete a.offer_from; delete a.offer_to; delete a.answer_note; delete a.condition
  a.answered_for = shiftKey(c)
  a.replied_at = stamp
  a.reply = text.slice(0, 500)

  let routed = ''
  if (ambiguous) {
    a.replied_at = stamp
    a.reply = text.slice(0, 500)
    a.state = 'inquiry'
    routed = 'reply matches two open callouts, raised for a human to place it'
    await opEvent(sb, { job: 'coverage-reply', verb: 'item_created', item_id: String(c.id), area: 'coverage',
      summary: `Cara raised: ${a.name} replied but is on ${caseIds.size} open callouts. A human places it` })
    await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: {
      id: `ops_covq_multi_${norm(String(a.phone || contactId))}_${Date.now().toString(36)}`,
      kind: 'coverage', coverage_case_id: c.id,
      title: `${a.name} replied but is on ${caseIds.size} open callouts. Which one?`,
      about: a.name, detail: `They wrote: "${text.slice(0, 300)}". Reply to them in GHL Conversations, place the answer on the right case, then update it there.`,
      domain: 'scheduling_coverage', status: 'open', urgency: 'high',
      created_at: stamp, due: new Date(Date.now() + 3600000).toISOString(),
      owner: '', owner_name: '', created_by: 'coverage-reply', opened_by: 'callout',
    } })
    await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: c })
    return json({ ok: true, routed, case_id: c.id, caregiver: a.name, state: a.state })
  }
  /* OPEN HOURS (2026-10-12, her ask: "have the ai help put the answers into three boxes: yellow is questions, red is
     no, green is yes but also organize which days"). The AI reads the answer against the squares the text offered
     (ops_settings.open_hours_ai_live); a second text from the same person is read together with the first. Without
     the AI, the plain word rules: a clear yes to all of it, a no, and everything else waits in yellow for a person.
     Nothing is assigned. The only text back is the thank-you to a YES (open_hours_ack_live, her decision 4). */
  if (c.open_hours === true) {
    const offered = Array.isArray(c.offered) && c.offered.length ? c.offered : offeredCells(c.interest_days || [], c.slots || [])
    const said = (prevReply && prevReply !== text ? prevReply + '\n' : '') + text
    let rd = settings.open_hours_ai_live === true ? await readOpenHoursReply(said, offered) : null
    a.read_by = rd && !rd.failed ? 'ai' : (rd ? 'words (the AI did not answer)' : 'words (the AI switch is off)')
    if (!rd || rd.failed) rd = readByWords(said, offered)
    a.reply = said.slice(-500)
    a.state = rd.answer === 'yes' ? 'yes' : rd.answer === 'no' ? 'no' : 'inquiry'
    a.yes_cells = rd.cells; a.any_time = rd.any; a.ai_quote = rd.quote; a.read_why = rd.why || null
    routed = `open hours: ${rd.answer}${rd.cells.length ? ' (' + rd.cells.length + ' squares)' : ''}, read by ${a.read_by}`
    const firstAnswer = !prevReply
    if (a.state === 'yes') {
      await opEvent(sb, { verb: 'yes_received', item_id: String(c.id), area: 'coverage', actor_name: String(a.name || 'a caregiver'),
        summary: `${a.name} wants some of the open hours in ${c.client_city || 'town'}` })
      if (firstAnswer && settings.open_hours_ack_live === true) {
        const ackTo = await ghlStoredContactIfAllowed(sb, { token: Deno.env.get('GHL_TOKEN') ?? '', locationId: Deno.env.get('GHL_LOCATION_ID') ?? '' },
          'coverage-reply', { channel: 'sms', contactId: contactId || a.ghl_contact_id })
        if (ackTo) { await sms(ackTo, (String(settings.open_hours_ack_msg || '') || OPEN_HOURS_ACK_DEFAULT).replaceAll('{first_name}', String(a.name).split(' ')[0]),
          { sender: 'coverage-reply', address: a.phone || phone, who: a.name }); a.ack_at = stamp }
      } else if (firstAnswer) a.ack_skipped = 'switch off'
    }
    if (a.state === 'inquiry') {
      /* ONE office item per open-hours ask, kept up to date: a whole-team text can bring many questions, and the
         Team Builder board is where they're answered. */
      const qs = (Array.isArray(c.asked) ? c.asked : []).filter((x: any) => x.state === 'inquiry')
      await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: {
        id: `ops_openq_${c.id}`, kind: 'coverage', coverage_case_id: c.id, plan_id: c.plan_id || null,
        title: `${qs.length} question${qs.length === 1 ? '' : 's'} about the open hours in ${c.client_city || 'town'}`,
        about: c.client || '', detail: qs.map((x: any) => `${x.name}: "${String(x.reply || '').slice(0, 120)}"`).join('; ').slice(0, 900)
          + '. Answer them from the office line, then mark each one on the Team Builder plan.',
        domain: 'scheduling_coverage', status: 'open', urgency: 'normal', created_at: stamp,
        due: new Date(Date.now() + 4 * 3600000).toISOString(), owner: '', owner_name: '', created_by: 'coverage-reply', opened_by: 'open-hours',
      } })
    }
    await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: c })
    return json({ ok: true, routed, case_id: c.id, caregiver: a.name, state: a.state, cells: a.yes_cells })
  }
  /* CARA PHASE 1 (2026-10-23): the AI reads the answer too (_shared/cara-reply.ts). Live (cara_reply_ai_live): the word
     rules and the AI together decide, a disagreement goes to a person, a "yes with a condition" is a yes that carries the
     condition. Practice (cara_reply_ai_practice): the AI's reading is kept beside the word rules' answer (ai_read_practice) and the word rules
     decide. Off (the default): no AI call at all, exactly as before. A yes
     is still only interest: nothing here assigns anyone or texts anyone back. Interest checks keep today's reading. */
  const aiMode = settings.cara_reply_ai_live === true ? 'live' : settings.cara_reply_ai_practice === true ? 'practice' : 'off'
  if (String(c.kind) !== 'interest' && aiMode !== 'off') {
    const ai = await readShiftReply(text, c)
    const settled = settleReply({ isYes, isNo }, ai)
    if (aiMode === 'live') {
      a.read_by = settled.by; a.read_why = settled.why; a.ai_quote = ai.quote ?? null
      if (settled.condition) a.condition = settled.condition; else delete a.condition
      isYes = settled.state === 'yes'; isNo = settled.state === 'no'
    } else if (!ai.failed) {
      a.ai_read_practice = { answer: ai.answer, condition: ai.condition, quote: ai.quote, would_be: settled.state, words_say: isYes ? 'yes' : isNo ? 'no' : 'question', why: settled.why, at: stamp }
    }
  }
  if (isYes) {
    /* THE WRONG-CLIENT YES (Lacey, first live callout: "I can cover wonda
       tomm" auto-attached to the WOLVERTON case — she was answering about
       Wanda). Before accepting, scan the reply for a KNOWN client's first
       name that is not this case's client. Matching is exact, or one letter
       off on names of 5+ letters ("wonda"→Wanda), so "many" can never smear
       into "Mary". A hit routes to a human as a question — a wrong inquiry
       costs a minute, a wrong YES confirms somebody onto the wrong shift. */
    try {
      const caseTokens = new Set(String(c.client || '').toLowerCase().split(/[^a-z]+/).filter((w: string) => w.length >= 3))
      const replyTokens = [...new Set(t.split(/[^a-z]+/).filter((w) => w.length >= 4))]
      if (replyTokens.length) {
        /* current clients only (2026-10-07): a past client's name can't make a caregiver's reply look like another client */
        const { data: roleRows } = await sb.from('person_role').select('person_id').eq('role', 'client').eq('status', 'active')
        // deno-lint-ignore no-explicit-any
        const ids = [...new Set((roleRows || []).map((r: any) => r.person_id))]
        const names = new Set<string>()
        if (ids.length) {
          const { data: pid } = await sb.from('person_identity').select('display_name, first_name').in('id', ids)
          for (const p of (pid || [])) {
            for (const src of [p.first_name, String(p.display_name || '').split(/\s+/)[0]]) {
              const w = String(src || '').toLowerCase().replace(/[^a-z]/g, '')
              if (w.length >= 3) names.add(w)
            }
          }
        }
        const off1 = (a: string, b: string): boolean => {
          if (a === b) return true
          if (a.length < 5 || b.length < 5) return false
          if (a.length === b.length) {
            let diff = 0
            for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++diff > 1) return false
            return diff === 1
          }
          return false
        }
        const strange = replyTokens.find((rt) =>
          !caseTokens.has(rt) &&
          [...names].some((nm) => off1(rt, nm) && !caseTokens.has(nm)))
        if (strange) {
          a.state = 'inquiry'
          routed = `yes, but the reply mentions "${strange}", which reads like a different client than ${c.client || 'this case'}. Routed to a human.`
          await opEvent(sb, { job: 'coverage-reply', verb: 'item_created', item_id: String(c.id), area: 'coverage',
            summary: `Cara raised: ${a.name} said yes but may mean a DIFFERENT client than ${c.client || '?'}. Confirm before accepting` })
          await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: {
            id: `ops_covq_${c.id}_${norm(String(a.phone || contactId))}`,
            kind: 'coverage', coverage_case_id: c.id,
            title: `${a.name} said yes, but may mean a DIFFERENT client than ${c.client || '?'}`,
            about: a.name,
            detail: `They wrote: "${text.slice(0, 300)}". The word "${strange}" looks like another client's name. Confirm which shift they mean before accepting. Reply to them in GHL Conversations, then set their answer on the right case.`,
            domain: 'scheduling_coverage', status: 'open', urgency: 'high',
            created_at: stamp, due: new Date(Date.now() + 3600000).toISOString(),
            owner: '', owner_name: '', created_by: 'coverage-reply', opened_by: 'callout',
          } })
          await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: c })
          return json({ ok: true, routed, case_id: c.id, caregiver: a.name, state: a.state })
        }
      }
    } catch (e) { console.error('[coverage-reply] wrong-client check failed open', e) /* an unreadable identity layer must not block a plain YES */ }
    /* INTEREST CHECK (2026-09-19, new-client broadcasts): a YES on a
       kind:'interest' case is collected, never promoted to pending_fill —
       the whole point is hearing from EVERYONE who wants the hours before
       the client meeting. Soft ack, no fill item, no staff blast. */
    if (String(c.kind) === 'interest') {
      a.state = 'yes'
      routed = 'interested, collected on the case'
      await opEvent(sb, { verb: 'yes_received', item_id: String(c.id), area: 'coverage',
        actor_name: String(a.name || 'a caregiver'),
        summary: `${a.name} is interested in the ${c.client || 'new client'} hours (interest check)` })
      /* AUTO-REPLY SWITCH (Samantha, 2026-10-10, on the "Dad" new-client ask: "turn off the responses that say we haven't
         met the client yet"): the soft acknowledgment goes only while ops_settings.coverage_ack_interest_live is true
         (Owners Hub Admin page, "Auto-reply to a new-client ask"). Off, and when the switch is missing: the YES is still
         collected and shown on the case; nothing is texted back, and the case says so (no silent skip). */
      if (settings.coverage_ack_interest_live === true) {
        /* 0b-3: the caregiver's contact goes through the universal opt-out door before the acknowledgment */
        const ackTo = await ghlStoredContactIfAllowed(sb, { token: Deno.env.get('GHL_TOKEN') ?? '', locationId: Deno.env.get('GHL_LOCATION_ID') ?? '' },
          'coverage-reply', { channel: 'sms', contactId: contactId || a.ghl_contact_id })
        if (ackTo) await sms(ackTo,
          (String(settings.coverage_msg_ack_interest || '') ||
           `Thank you {first_name}! Nothing is set yet. We're meeting the client first and we'll follow up with you about the hours.`)
          .replaceAll('{first_name}', a.name.split(' ')[0]), { sender: 'coverage-reply', address: a.phone || phone, who: a.name })
      } else {
        routed += ' (no auto-reply: the switch is off)'
        a.ack_skipped = 'switch off'
      }
      await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: c })
      return json({ ok: true, routed, case_id: c.id, caregiver: a.name, state: a.state })
    }
    /* COLLECT, DON'T CROWN (her rules, 2026-09-19): "we want to pick the
       best option out of all the yeses" and "you don't need to respond to
       them when they answer until we go in and manually choose." So: every
       YES is recorded, NOTHING is texted back, no pending_fill, no
       first-wins, no "someone grabbed it". The office picks on the board;
       on close, the chosen one gets the confirm text and everyone else the
       warm not-chosen text (coverage-run's closure pass sends both). */
    a.state = 'yes'
    const yeses = (Array.isArray(c.asked) ? c.asked : []).filter((x: any) => x.state === 'yes')
    routed = `YES ${yeses.length === 1 ? '' : '(' + yeses.length + ' so far) '}collected silently; the office picks from all the yeses`
    await opEvent(sb, { verb: 'yes_received', item_id: String(c.id), area: 'coverage',
      actor_name: String(a.name || 'a caregiver'),
      summary: `${a.name} said YES to ${c.client || 'the shift'}`
        + ` ${[c.shift_date, c.shift_time].filter(Boolean).join(' ')}`.trimEnd()
        + (yeses.length > 1 ? ` (${yeses.length} yeses now)` : ' (first yes)') })
    await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: {
      id: `ops_covfill_${c.id}`, kind: 'coverage', coverage_case_id: c.id,
      title: yeses.length === 1
        ? `${a.name} can cover ${c.client || 'the shift'}. Pick & assign when ready`
        : `${yeses.length} can cover ${c.client || 'the shift'}. Pick the best fit & assign`,
      about: c.client || '',
      detail: 'Said yes so far: ' + yeses.map((x: any) =>
          `${x.name}${x.reply ? ` ("${String(x.reply).slice(0, 60)}")` : ''}`).join('; ')
        + '. Nobody has been answered. Pick on the board and confirm; the "you\'re confirmed" and "covered this time" texts go out when the case closes.',
      domain: 'scheduling_coverage', status: 'open', urgency: 'high',
      created_at: stamp, due: new Date(Date.now() + 3600000).toISOString(),
      owner: '', owner_name: '', created_by: 'coverage-reply', opened_by: 'callout',
    } })
    /* One office SMS per case, on the FIRST yes — the item above keeps the
       running list; more texts per yes would be noise. */
    if (yeses.length === 1) await alertStaffOfPending(c, a.name)
  } else if (isNo) {
    a.state = 'no'
    routed = 'no, recorded'
    /* Legacy: clear a pending_fill left by the old first-yes-wins flow so
       an old case can't sit frozen on a decliner. No promotion — the
       office picks from the standing yeses on the board. */
    if (c.pending_fill && String(c.pending_fill.name).toLowerCase() === String(a.name).toLowerCase()) {
      delete c.pending_fill
      routed = 'no, legacy pending fill cleared'
    }
  } else {
    a.state = 'inquiry'
    routed = 'inquiry, raised for a human to answer'
    await opEvent(sb, { job: 'coverage-reply', verb: 'item_created', item_id: String(c.id), area: 'coverage',
      summary: `Cara raised: ${a.name} has a question about the ${c.client || ''} callout: "${text.slice(0, 120)}"` })
    await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: {
      id: `ops_covq_${c.id}_${norm(String(a.phone || contactId))}`, kind: 'coverage',
      coverage_case_id: c.id,
      title: `${a.name} has a question about the ${c.client || ''} callout`,
      about: a.name, detail: `They wrote: "${text.slice(0, 300)}". Open their conversation in GHL and reply there, then update the case.`
        + (function () {
          /* CARA DRAFTS THE EASY ANSWER (her pick #3, 2026-09-19): when the
             question is about the time or the place, the case already knows.
             The draft rides on the ops item for one-paste sending — a human
             still presses send, always. */
          try {
            const tq = text.toLowerCase()
            const bits: string[] = []
            if (/time|when|what day|how long|hours|start/.test(tq)) {
              const clock12q = (t: string) => { const m = String(t || '').trim().match(/^(\d{1,2}):(\d\d)$/)
                if (!m) return String(t || '').trim(); const h24 = Number(m[1]); const h = h24 % 12 || 12
                return `${h}${m[2] === '00' ? '' : ':' + m[2]}${h24 >= 12 ? 'pm' : 'am'}` }
              const span = String(c.shift_time || '').split('-').map(clock12q).join('-')
              if (c.shift_date || span) bits.push(`It's ${[c.shift_date, span].filter(Boolean).join(', ')}`)
            }
            if (/where|address|town|city|far|located|location/.test(tq)) {
              const street = String(c.client_street || '').trim().replace(/^\d+[A-Za-z]?(?:-\w+)?\s+/, '')
              const place = [street, String(c.client_city || '').trim()].filter(Boolean).join(', ')
              if (place) bits.push(`it's on ${place}`)
            }
            if (/who|which client|what client/.test(tq) && c.client) {
              const w = String(c.client).trim().split(/\s+/)
              bits.push(`the client is ${(w.length > 1 ? w.slice(0, -1).join(' ') : w.join(' '))}`)
            }
            if (!bits.length) return ''
            return `\n\n💬 Cara's draft (paste it if it fits): "${bits.join(', ')}. Can you take it? Reply YES or NO."`
          } catch { return '' }
        })(),
      domain: 'scheduling_coverage', status: 'open', urgency: 'high',
      created_at: stamp, due: new Date(Date.now() + 2 * 3600000).toISOString(),
      owner: '', owner_name: '', created_by: 'coverage-reply', opened_by: 'callout',
    } })
  }

  await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: c })
  return json({ ok: true, routed, case_id: c.id, caregiver: a.name, state: a.state })
})
