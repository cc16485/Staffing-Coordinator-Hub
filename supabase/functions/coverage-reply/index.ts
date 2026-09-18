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
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
const norm = (p: string) => String(p || '').replace(/\D/g, '').slice(-10)

async function sms(contactId: string, message: string): Promise<boolean> {
  const token = Deno.env.get('GHL_TOKEN')
  if (!token || !contactId) return false
  try {
    const r = await fetch('https://services.leadconnectorhq.com/conversations/messages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'SMS', contactId, message }),
    })
    return r.ok
  } catch { return false }
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
  if (!text) return json({ ok: true, routed: 'no message text — nothing to record' })

  // Which callout is this an answer to? The newest open case where this
  // phone (or contact) was auto-asked and hasn't answered yet — else the
  // newest open case that asked them at all (people change their minds).
  const { data: row } = await sb.from('app_data').select('data').eq('key', 'coverage_cases').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const cases: any[] = Array.isArray(row?.data) ? row!.data : []
  // deno-lint-ignore no-explicit-any
  const matches: Array<{ c: any; a: any }> = []
  for (const c of cases) {
    if (c?.status !== 'open') continue
    for (const a of (Array.isArray(c.asked) ? c.asked : [])) {
      if (a.auto !== true) continue
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
      // deno-lint-ignore no-explicit-any
      const phones: string[] = (Array.isArray((settings as any).coverage_alert_phones)
        ? (settings as any).coverage_alert_phones : [])
        .map((p: unknown) => String(p ?? '').trim()).filter(Boolean)
      const who = yesName || c.pending_fill?.name
      if (!phones.length || !who) return
      const ghlToken = Deno.env.get('GHL_TOKEN')
      const ghlLocation = Deno.env.get('GHL_LOCATION_ID')
      if (!ghlToken || !ghlLocation) return
      /* Dedupe lives on the CASE now (collect-all-yeses has no pending_fill);
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
      const msg = (String((settings as any).coverage_msg_staff_yes || '') ||
        `Cara: {caregiver} said YES to cover {client}, {when}. More yeses may come - pick the best fit on the board and confirm. Nothing is assigned and nobody has been answered. https://cc.mo-care.com/#cara/case/{case}`)
        .replaceAll('{caregiver}', String(who))
        .replaceAll('{client}', String(c.client || 'the client'))
        .replaceAll('{when}', whenTxt)
        .replaceAll('{case}', encodeURIComponent(String(c.id)))
      let any = false
      for (const p of phones) {
        const key = norm(p) || p
        if (sent[key]) continue          // already succeeded for THIS decision
        try {
          const up = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
            method: 'POST',
            headers: { Authorization: `Bearer ${ghlToken}`, Version: '2021-07-28',
                       'Content-Type': 'application/json' },
            body: JSON.stringify({ locationId: ghlLocation, phone: p, firstName: 'Scheduling' }),
          })
          // deno-lint-ignore no-explicit-any
          const uj: any = await up.json().catch(() => ({}))
          const cid = uj?.contact?.id ?? uj?.id
          if (!cid) { console.error('[coverage-reply] staff alert: no contact id for a configured phone'); continue }
          if (await sms(cid, msg)) { sent[key] = new Date().toISOString(); any = true }
          else console.error('[coverage-reply] staff alert send failed for one recipient')
        } catch (e) { console.error('[coverage-reply] staff alert recipient error', e) }
      }
      /* Persist the successful-recipient record NOW rather than only at the
         end of the handler: this closes the replay-duplication window to
         the instant between a successful send and this write. */
      if (any) await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: c })
    } catch (e) { console.error('[coverage-reply] staff alert block failed', e) }
  }
  // deno-lint-ignore no-explicit-any
  const settings: any = setRow?.data ?? {}

  matches.sort((x, y) => new Date(String(y.a.at || 0)).getTime() - new Date(String(x.a.at || 0)).getTime())
  const m = matches.find(x => x.a.state === 'waiting') ?? matches[0]
  if (!m) return json({ ok: true, routed: 'no open callout asked this number — nothing to attach to' })
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
  const isYes = !hasNeg && (
    /^\s*(y|yes|yeah|yep|yea|sure|absolutely|definitely|of course)\b/.test(t) ||
    /\b(i'?ll take|i can take|i can cover|i can do|i'?ll cover|i'?ll do it|count me in|i'?m available|works for me)\b/.test(t))
  const isNo = hasNeg ||
    /^\s*(n|no|nope|nah|sorry)\b/.test(t) ||
    /\b(pass|not this time|next time)\b/.test(t)
  const stamp = new Date().toISOString()
  a.replied_at = stamp
  a.reply = text.slice(0, 500)

  let routed = ''
  if (ambiguous) {
    a.replied_at = stamp
    a.reply = text.slice(0, 500)
    a.state = 'inquiry'
    routed = 'reply matches two open callouts — raised for a human to place it'
    await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: {
      id: `ops_covq_multi_${norm(String(a.phone || contactId))}_${Date.now().toString(36)}`,
      kind: 'coverage', coverage_case_id: c.id,
      title: `${a.name} replied but is on ${caseIds.size} open callouts — which one?`,
      about: a.name, detail: `They wrote: "${text.slice(0, 300)}". Reply to them in GHL Conversations, place the answer on the right case, then update it there.`,
      domain: 'scheduling_coverage', status: 'open', urgency: 'high',
      created_at: stamp, due: new Date(Date.now() + 3600000).toISOString(),
      owner: '', owner_name: '', created_by: 'coverage-reply', opened_by: 'callout',
    } })
    await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: c })
    return json({ ok: true, routed, case_id: c.id, caregiver: a.name, state: a.state })
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
        const { data: roleRows } = await sb.from('person_role').select('person_id').eq('role', 'client')
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
          routed = `yes — but the reply mentions "${strange}", which reads like a different client than ${c.client || 'this case'}. Routed to a human.`
          await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: {
            id: `ops_covq_${c.id}_${norm(String(a.phone || contactId))}`,
            kind: 'coverage', coverage_case_id: c.id,
            title: `${a.name} said yes — but may mean a DIFFERENT client than ${c.client || '?'}`,
            about: a.name,
            detail: `They wrote: "${text.slice(0, 300)}". The word "${strange}" looks like another client's name. Confirm which shift they mean before accepting — reply to them in GHL Conversations, then set their answer on the right case.`,
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
      routed = 'interested — collected on the case'
      await sms(contactId || a.ghl_contact_id,
        (String(settings.coverage_msg_ack_interest || '') ||
         `Thank you {first_name}! Nothing is set yet — we're meeting the client first and we'll follow up with you about the hours.`)
        .replaceAll('{first_name}', a.name.split(' ')[0]))
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
    routed = `YES ${yeses.length === 1 ? '' : '(' + yeses.length + ' so far) '}— collected silently; the office picks from all the yeses`
    await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: {
      id: `ops_covfill_${c.id}`, kind: 'coverage', coverage_case_id: c.id,
      title: yeses.length === 1
        ? `${a.name} can cover ${c.client || 'the shift'} — pick & assign when ready`
        : `${yeses.length} can cover ${c.client || 'the shift'} — pick the best fit & assign`,
      about: c.client || '',
      detail: 'Said yes so far: ' + yeses.map((x: any) =>
          `${x.name}${x.reply ? ` ("${String(x.reply).slice(0, 60)}")` : ''}`).join('; ')
        + '. Nobody has been answered — pick on the board and confirm; the "you\'re confirmed" and "covered this time" texts go out when the case closes.',
      domain: 'scheduling_coverage', status: 'open', urgency: 'high',
      created_at: stamp, due: new Date(Date.now() + 3600000).toISOString(),
      owner: '', owner_name: '', created_by: 'coverage-reply', opened_by: 'callout',
    } })
    /* One office SMS per case, on the FIRST yes — the item above keeps the
       running list; more texts per yes would be noise. */
    if (yeses.length === 1) await alertStaffOfPending(c, a.name)
  } else if (isNo) {
    a.state = 'no'
    routed = 'no — recorded'
    /* Legacy: clear a pending_fill left by the old first-yes-wins flow so
       an old case can't sit frozen on a decliner. No promotion — the
       office picks from the standing yeses on the board. */
    if (c.pending_fill && String(c.pending_fill.name).toLowerCase() === String(a.name).toLowerCase()) {
      delete c.pending_fill
      routed = 'no — legacy pending fill cleared'
    }
  } else {
    a.state = 'inquiry'
    routed = 'inquiry — raised for a human to answer'
    await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: {
      id: `ops_covq_${c.id}_${norm(String(a.phone || contactId))}`, kind: 'coverage',
      coverage_case_id: c.id,
      title: `${a.name} has a question about the ${c.client || ''} callout`,
      about: a.name, detail: `They wrote: "${text.slice(0, 300)}" — open their conversation in GHL and reply there, then update the case.`,
      domain: 'scheduling_coverage', status: 'open', urgency: 'high',
      created_at: stamp, due: new Date(Date.now() + 2 * 3600000).toISOString(),
      owner: '', owner_name: '', created_by: 'coverage-reply', opened_by: 'callout',
    } })
  }

  await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: c })
  return json({ ok: true, routed, case_id: c.id, caregiver: a.name, state: a.state })
})
