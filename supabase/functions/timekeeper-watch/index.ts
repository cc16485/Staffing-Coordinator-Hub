// Supabase Edge Function: timekeeper-watch  (shared hub project)
// -----------------------------------------------------------------------------
// Cara's Timekeeper (Samantha, 2026-09-15, benchmarked on phoebe.work): "text
// the caregiver if they haven't clocked in and it's 3 minutes past their
// clock-in time, then if we don't hear back call them, then alert the office."
//
// The ladder, per assigned visit whose start has passed with no clock-in:
//   T+grace (default 3 min)          Cara texts the caregiver: clock in now,
//                                    or reply/call if something's wrong.
//   T+grace+office_after (default 7) still no clock-in: URGENT ops item to the
//                                    Operations Inbox + SMS to the office
//                                    alert phones, with the caregiver's number
//                                    ready to tap. A person makes the call —
//                                    an unreachable caregiver at a client's
//                                    door is exactly the human moment.
//                                    (timekeeper_call_live is RESERVED for a
//                                    later Cara voice call between these two
//                                    steps; not implemented on purpose.)
//   clock-in appears at any step     the ladder resolves itself silently and
//                                    closes its ops item. Nobody gets chased
//                                    for a shift they are already working.
//   caregiver removed / visit gone   resolved as visit_changed, no text ever.
//
// CLOCK-OUT side (phoebe.work parity, "matching their updates" 2026-09-15):
// a visit whose end passed by timekeeper_clockout_grace_min (default 10) with
// a clock-IN but no clock-OUT gets ONE reminder text. No office ladder — the
// client was served; only payroll and EVV are at stake, and the nightly
// attendance sweep remains the bookkeeper of record.
//
// SKIP LIST (their Feb 27 update): ops_settings.cara_skip is an array of
// { caregiver, client, scope } entries, names matched case-insensitively
// (caregiver = full name, client = first name; leave one blank to match all).
// scope: 'clock' (this function), 'confirm' (shift-confirm), or 'all'
// (default). For the caregiver who always forgets and the office knows why,
// or the client whose visits are recorded another way.
//
// The GROUND TRUTH for escalation is the clock-in appearing in AxisCare, not
// the reply: "I'm here" without a clock-in still leaves EVV dirty, so the
// ladder keeps watching until the schedule itself says the shift is covered.
// Replies land in the GHL inbox (contacts are tagged `timekeeper-asked` so a
// reply workflow can route them onto the hub later, same as coverage-asked).
//
// WHY THE DRY RUN MATTERS DOUBLY HERE: First-Visit Confirmation is parked on
// "clockIn proven to populate". This function's dry run IS that proof: it
// reports, for visits started >15 minutes ago today, how many carry
// clockIn.time and how many do not. If clock-ins post to the API slowly, the
// grace minutes must grow before texting goes live, or Cara nags people who
// are already working — the fastest way to burn caregiver goodwill.
//
// NAIVE-TIMESTAMP TRAP: AxisCare visit times come back as zone-naive local
// strings ("2026-09-15T10:00:00"). Date.parse reads those in the SERVER's
// zone (UTC on Supabase), so comparing against Date.now() skews by 5-6 hours
// — survivable for coverage-watch's day-level checks, fatal for a 3-minute
// trigger. Minutes-late is therefore computed naive-to-naive: both the visit
// start and "now" are parsed in the same frame, so the skew cancels. A
// timestamp that DOES carry a zone is compared against real now instead.
//
// ⚠ STAGED SWITCHES, same discipline as coverage (ops_settings):
//   timekeeper_watch_live === true   open ladders, escalate to the office
//   timekeeper_text_live  === true   additionally text caregivers (needs
//                                    watch_live too; refused otherwise)
//   neither set / ?dry=1             DRY RUN: report what would happen,
//                                    write nothing, text nobody
// Other settings: timekeeper_grace_min (3), timekeeper_office_after_min (7),
// timekeeper_clockout_grace_min (10), timekeeper_msg / timekeeper_msg_out
// (templates: {first_name} {client} {time}), timekeeper_alert_phones (array
// of office phones for the escalation SMS), cara_skip (see above),
// coverage_alert_admins (reused for the ops item owner).
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

/* "17:00" → "5pm", minutes kept only when they matter — the same 12-hour
   rule every other Cara text follows. Non-HH:MM passes through untouched. */
const clock12 = (t: string): string => {
  const m = String(t || '').trim().match(/^(\d{1,2}):(\d\d)$/)
  if (!m) return String(t || '').trim()
  const h24 = Number(m[1]); const h = h24 % 12 || 12
  return `${h}${m[2] === '00' ? '' : ':' + m[2]}${h24 >= 12 ? 'pm' : 'am'}`
}
import { normalisePhone, contactForOutbound } from '../_shared/outreach.ts'
import { shadowRoute } from '../_shared/routing.ts'
import { opEvent } from '../_shared/events.ts'

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b, null, 2), { status: s, headers: { 'Content-Type': 'application/json' } })

const AC_VERSION = Deno.env.get('AXISCARE_API_VERSION') || '2023-10-01'
const STALE_MIN = 150   // never open a ladder for a start older than this — a
                        // watcher that was off all morning must not text at
                        // noon about a 7am shift; the nightly attendance sweep
                        // owns history.

function axisCreds() {
  const order = ['AXISCARE_VISITS_TOKEN', 'AXISCARE_API_KEY', 'AXISCARE_TOKEN']
  let token = ''
  for (const n of order) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  return { token, site: /^\d+$/.test(site) ? site : '' }
}

function callerRole(req: Request): string {
  try {
    const tok = String(req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    const payload = JSON.parse(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return String(payload?.role || '')
  } catch { return '' }
}

/* Chicago wall clock as a naive ISO-ish string, comparable with AxisCare's
   naive visit timestamps in the same frame. */
const chiWallIso = () =>
  new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).replace(' ', 'T')
const chiToday = () => chiWallIso().slice(0, 10)

const hasZone = (s: string) => /Z$|[+-]\d{2}:?\d{2}$/.test(s)
/** Minutes since `stamp`, zone-skew-safe (see header). NaN when unparseable. */
function minutesSince(stamp: string): number {
  const t = Date.parse(stamp)
  if (!Number.isFinite(t)) return NaN
  const now = hasZone(stamp) ? Date.now() : Date.parse(chiWallIso())
  return (now - t) / 60000
}

const nameKeyOf = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '')

/* The skip list. An entry with neither name is ignored rather than allowed to
   match everyone — a half-typed row must never silence the whole watcher. */
// deno-lint-ignore no-explicit-any
function skipMatch(skips: any[], scope: string, caregiverName: string, clientFirst: string): boolean {
  const cgk = nameKeyOf(caregiverName), clk = nameKeyOf(clientFirst)
  for (const s of skips) {
    const sc = String(s?.scope ?? 'all').toLowerCase()
    if (sc !== 'all' && sc !== scope) continue
    const wantCg = nameKeyOf(String(s?.caregiver ?? ''))
    const wantCl = nameKeyOf(String(s?.client ?? ''))
    if (!wantCg && !wantCl) continue
    if (wantCg && wantCg !== cgk) continue
    if (wantCl && wantCl !== clk) continue
    return true
  }
  return false
}
// deno-lint-ignore no-explicit-any
const rowsOf = (v: any): any[] => Array.isArray(v) ? v
  : (v && typeof v === 'object') ? Object.values(v) : []

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200 })
  const t0 = Date.now()
  const role = callerRole(req)

  const { data: setRow } = await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const settings: any = setRow?.data ?? {}
  const forceDry = new URL(req.url).searchParams.get('dry') === '1'
  const watchLive = settings.timekeeper_watch_live === true && !forceDry
  const textLive = watchLive && settings.timekeeper_text_live === true
  const graceMin = Number(settings.timekeeper_grace_min) > 0 ? Number(settings.timekeeper_grace_min) : 3
  const officeAfterMin = Number(settings.timekeeper_office_after_min) > 0
    ? Number(settings.timekeeper_office_after_min) : 7
  const outGraceMin = Number(settings.timekeeper_clockout_grace_min) > 0
    ? Number(settings.timekeeper_clockout_grace_min) : 10
  // deno-lint-ignore no-explicit-any
  const skips: any[] = Array.isArray(settings.cara_skip) ? settings.cara_skip : []

  const { token, site } = axisCreds()
  if (!token || !site) return json({ error: 'AxisCare credentials not set on this project' }, 502)
  const ghl = { token: Deno.env.get('GHL_TOKEN') || Deno.env.get('GHL_API_KEY') || '',
                locationId: Deno.env.get('GHL_LOCATION_ID') || '' }

  // ── Today's visits (one page walk, same shape defenses as coverage-watch). ──
  const day = chiToday()
  // deno-lint-ignore no-explicit-any
  const visits: any[] = []
  let fetchError: string | null = null
  try {
    let url: string | null = `https://${site}.axiscare.com/api/visits?startDate=${day}&endDate=${day}`
    for (let page = 0; url && page < 12; page++) {
      const r: Response = await fetch(url, { headers: {
        Authorization: `Bearer ${token}`, Accept: 'application/json',
        'X-AxisCare-Api-Version': AC_VERSION } })
      if (!r.ok) { fetchError = `AxisCare responded ${r.status}`; break }
      // deno-lint-ignore no-explicit-any
      const j: any = await r.json().catch(() => ({}))
      for (const v of rowsOf(j?.results?.visits ?? j?.visits)) if (!v?.removed) visits.push(v)
      url = j?.results?.nextPage ?? j?.nextPage ?? j?.results?.nextPageUrl ?? j?.nextPageUrl ?? null
    }
  } catch (err) { fetchError = String(err) }
  if (fetchError && !visits.length) return json({ error: fetchError }, 502)

  // ── CLOCK-IN POPULATION EVIDENCE (the First-Visit Confirmation blocker). ──
  let startedAWhile = 0, withClockIn = 0
  for (const v of visits) {
    if (v?.caregiver?.id == null) continue
    const start = String(v?.scheduledStartDate ?? v?.startDate ?? '')
    const m = minutesSince(start)
    if (!Number.isFinite(m) || m < 15) continue
    startedAWhile++
    if (v?.clockIn?.time) withClockIn++
  }

  // ── Roster, for the phone the text goes to. Match by axiscare_id, then name. ──
  const { data: cgRow } = await sb.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const roster = (Array.isArray(cgRow?.data) ? cgRow!.data : []) as any[]
  // deno-lint-ignore no-explicit-any
  const byAxis = new Map<string, any>(), byName = new Map<string, any>()
  for (const cg of roster) {
    if (cg?.active === false) continue
    const nm = [String(cg.first ?? '').trim(), String(cg.last ?? '').trim()].filter(Boolean).join(' ')
    if (String(cg.axiscare_id ?? '').trim()) byAxis.set(String(cg.axiscare_id).trim(), cg)
    if (nm) byName.set(nameKeyOf(nm), cg)
  }

  // ── Open ladders. One per visit, ever: deterministic id. ──
  const { data: tkRow } = await sb.from('app_data').select('data').eq('key', 'timekeeper_cases').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const ladders: any[] = Array.isArray(tkRow?.data) ? tkRow!.data : []
  const ladderByVisit = new Map(ladders.map(l => [String(l?.visit_id ?? ''), l]))
  const byVisitId = new Map(visits.map(v => [String(v?.id ?? ''), v]))
  const nowIso = new Date().toISOString()
  const admins = (Array.isArray(settings.coverage_alert_admins) && settings.coverage_alert_admins.length)
    ? settings.coverage_alert_admins : ['samantha@mo-care.com']
  const alertPhones: string[] = (Array.isArray(settings.timekeeper_alert_phones)
    ? settings.timekeeper_alert_phones : []).map((p: unknown) => normalisePhone(p)).filter(Boolean) as string[]

  // deno-lint-ignore no-explicit-any
  const save = (l: any) => sb.rpc('upsert_app_data_item', { target_key: 'timekeeper_cases', item: l })

  // ── PASS 1: resolve open ladders whose world changed. ──
  let resolved = 0
  for (const l of ladders) {
    if (!l || l.resolved_at) continue
    const v = byVisitId.get(String(l.visit_id))
    let how = ''
    if (l.kind === 'clock_out') {
      /* A clock-out reminder resolves on the clock-OUT appearing. */
      if (!v) how = 'visit_gone'
      else if (v?.clockOut?.time) how = 'clocked_out'
      if (!how) continue
      l.resolved_at = nowIso; l.resolved_how = how
      if (watchLive) await save(l)
      resolved++
      continue
    }
    if (!v) how = 'visit_gone'
    else if (v?.clockIn?.time) how = 'clocked_in'
    else if (v?.caregiver?.id == null || String(v?.caregiver?.id) !== String(l.caregiver_axiscare_id)) how = 'visit_changed'
    if (!how) continue
    l.resolved_at = nowIso
    l.resolved_how = how
    if (how === 'clocked_in') {
      const late = minutesSince(String(v?.scheduledStartDate ?? '')) - minutesSince(String(v.clockIn.time))
      l.minutes_late = Number.isFinite(late) ? Math.max(0, Math.round(late)) : null
    }
    if (watchLive) {
      await save(l)
      if (l.office_alerted_at) {
        /* Close the alert too — a resolved emergency must not sit urgent. */
        await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: {
          id: `ops_tk_${l.id}`, kind: 'staffing_issue', status: 'resolved',
          title: `Resolved — ${l.caregiver} ${how === 'clocked_in' ? 'clocked in' : 'no longer on this visit'} (${l.client_first} ${l.shift_time})`,
          about: l.caregiver, domain: 'scheduling_coverage', urgency: 'high',
          owner: String(admins[0]), owner_name: String(admins[0]).split('@')[0],
          detail: how === 'clocked_in'
            ? `${l.caregiver} clocked in${l.minutes_late != null ? ` ${l.minutes_late} minutes late` : ''}. Cara closed this alert; the nightly attendance sweep records the tardy.`
            : `The visit changed in AxisCare (reassigned, unassigned or removed), so this alert no longer applies.`,
          created_at: l.office_alerted_at, resolved_at: nowIso,
          created_by: 'timekeeper-watch', opened_by: 'timekeeper',
        } })
      }
    }
    resolved++
  }

  // ── PASS 2: walk today's assigned, unclocked, recently-started visits. ──
  const wouldText: Record<string, unknown>[] = []
  const wouldAlert: Record<string, unknown>[] = []
  let opened = 0, texted = 0, alerted = 0, skippedNoPhone = 0, refusedGate = 0, skippedByList = 0

  /* The EVV rule rides on every nudge (Samantha, 2026-09-15): the office
     cannot make manual time changes without the correction form, completed
     and signed by the client. The text says so and carries the form link,
     so "just fix it for me" conversations end before they start. */
  const msgTmpl = String(settings.timekeeper_msg || '')
    || `Hi {first_name}, it's Cara with Caring Companions. Your shift with {client} was set to start at {time} and we don't see a clock-in yet. If you're there, please clock in through the AxisCare app now. If the clock-in was missed, we cannot make any manual changes to your time without the EVV correction form, completed and signed by the client: sc.mo-care.com/evv-correction-form. If something's come up, reply here or call the office at (417) 234-8494.`

  for (const v of visits) {
    if (v?.caregiver?.id == null || v?.clockIn?.time) continue
    const start = String(v?.scheduledStartDate ?? v?.startDate ?? '')
    const late = minutesSince(start)
    if (!Number.isFinite(late) || late < graceMin || late > STALE_MIN) continue
    const vid = String(v?.id ?? ''); if (!vid) continue

    const cgName = [String(v.caregiver.firstName ?? '').trim(), String(v.caregiver.lastName ?? '').trim()]
      .filter(Boolean).join(' ') || ('caregiver ' + v.caregiver.id)
    const clientFirst = String(v?.client?.firstName ?? '').trim() || 'your client'
    const shiftTime = start.slice(11, 16)
    /* Texts read "5pm", never "17:00" — her standing 12-hour rule (the
       pre-enable to-do recorded 2026-09-16, fixed before first deploy). */
    const shiftTime12 = clock12(shiftTime)
    if (skipMatch(skips, 'clock', cgName, clientFirst)) { skippedByList++; continue }

    let l = ladderByVisit.get(vid)
    if (l?.resolved_at) continue          // once handled, never reopened by a robot
    if (!l) {
      l = { id: 'tk_' + vid.replace(/[^A-Za-z0-9]/g, '_'), visit_id: vid,
        caregiver: cgName, caregiver_axiscare_id: String(v.caregiver.id),
        client_first: clientFirst, client_axiscare_id: v?.client?.id != null ? String(v.client.id) : null,
        shift_date: day, shift_time: shiftTime,
        opened_at: nowIso, texted_at: null, ghl_contact_id: null,
        office_alerted_at: null, resolved_at: null, resolved_how: null, notes: [] }
      ladderByVisit.set(vid, l)
      if (watchLive) { await save(l); opened++ }
    }

    // Step 1: the text.
    if (!l.texted_at) {
      const cg = byAxis.get(String(v.caregiver.id)) ?? byName.get(nameKeyOf(cgName))
      const phone = normalisePhone(cg?.phone)
      if (!phone) {
        skippedNoPhone++
        if (!l.no_phone) { l.no_phone = true; l.notes.push('No phone on the roster — text skipped, office step will fire at its time.') }
        if (watchLive) await save(l)
      } else if (textLive) {
        /* Same classification as the callouts: an employee, about a shift
           happening right now. urgent_internal, 24/7 — a 6am shift needs its
           6:03 nudge. contactForOutbound applies the identity gate. */
        const contact = await contactForOutbound(sb, ghl,
          { phone, firstName: String(cg?.first ?? '') || cgName.split(' ')[0] }, 'urgent_internal')
        if (!contact) { refusedGate++; l.notes.push('Text refused by the outbound gate (untrusted number).'); await save(l) }
        else {
          const message = msgTmpl.replaceAll('{first_name}', String(cg?.first ?? '') || cgName.split(' ')[0])
            .replaceAll('{client}', clientFirst).replaceAll('{time}', shiftTime12)
          let ok = false
          try {
            const r = await fetch('https://services.leadconnectorhq.com/conversations/messages', {
              method: 'POST',
              headers: { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28',
                         'Content-Type': 'application/json' },
              body: JSON.stringify({ type: 'SMS', contactId: contact.contactId, message }),
            })
            ok = r.ok
            if (!r.ok) console.error('timekeeper sms', r.status, await r.text().catch(() => ''))
          } catch (err) { console.error('timekeeper sms failed', err) }
          if (ok) {
            l.texted_at = nowIso; l.ghl_contact_id = contact.contactId
            await save(l); texted++
            try {
              await fetch(`https://services.leadconnectorhq.com/contacts/${contact.contactId}/tags`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28',
                           'Content-Type': 'application/json' },
                body: JSON.stringify({ tags: ['timekeeper-asked'] }),
              })
            } catch { /* a missing tag only costs reply routing */ }
          }
        }
      } else {
        wouldText.push({ caregiver: cgName, client: clientFirst, time: shiftTime,
          minutes_late: Math.round(late), phone_last4: phone.slice(-4) })
      }
    }

    // Step 2: the office. Fires on the clock whether or not the text could be
    // sent — a caregiver with no phone on file still has a client waiting.
    if (!l.office_alerted_at && late >= graceMin + officeAfterMin) {
      const cg = byAxis.get(String(v.caregiver.id)) ?? byName.get(nameKeyOf(cgName))
      const cgPhone = normalisePhone(cg?.phone)
      if (watchLive) {
        await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: {
          id: `ops_tk_${l.id}`, kind: 'staffing_issue',
          title: `NO CLOCK-IN — ${cgName} for ${clientFirst}, ${shiftTime} shift`,
          about: cgName,
          detail: `${cgName} has not clocked in for ${clientFirst}'s ${shiftTime} visit `
            + `(${Math.round(late)} minutes past start). `
            + (l.texted_at ? `Cara texted at ${String(l.texted_at).slice(11, 16)} UTC with no clock-in since. ` : `No text went out (${l.no_phone ? 'no phone on the roster' : 'texting is not live'}). `)
            + `Call ${cgName} now${cgPhone ? `: ${cgPhone}` : ' (number missing from the roster — check AxisCare)'}. `
            + `If they cannot make it, open a coverage case on the Coverage Help board and the callout engine takes over. `
            + `This alert closes itself the moment a clock-in appears.`,
          domain: 'scheduling_coverage', status: 'open', urgency: 'high',
          owner: String(admins[0]), owner_name: String(admins[0]).split('@')[0],
          due: new Date(Date.now() + 3600 * 1000).toISOString(),
          created_at: nowIso, created_by: 'timekeeper-watch', opened_by: 'timekeeper',
        } })
        l.office_alerted_at = nowIso
        await save(l); alerted++
        await opEvent(sb, { verb: 'item_created', item_id: `ops_tk_${l.id}`, area: 'coverage',
          summary: `Cara raised: NO CLOCK-IN — ${cgName} for ${clientFirst}, ${clock12(shiftTime)} shift (${Math.round(late)} min past start)` })
        /* Step 3 shadow: record what the playbook WOULD have said, next to
           what production actually did. Observers only — nothing changes. */
        await shadowRoute(sb, { area: 'sched_clockins', channel: 'missed clock-in office SMS',
          production: alertPhones, case_id: String(l.id) })
        for (const p of alertPhones) {
          const contact = await contactForOutbound(sb, ghl, { phone: p, firstName: 'Office' }, 'urgent_internal')
          if (!contact) continue
          const alertMsg = `Cara here. ${cgName} has not clocked in for ${clientFirst}'s ${clock12(shiftTime)} shift `
            + `(${Math.round(late)} min past start)${l.texted_at ? ', no response to my text' : ''}. `
            + `Please call ${cgName}${cgPhone ? `: ${cgPhone}` : ''}. Details in the Operations Inbox.`
          try {
            await fetch('https://services.leadconnectorhq.com/conversations/messages', {
              method: 'POST',
              headers: { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28',
                         'Content-Type': 'application/json' },
              body: JSON.stringify({ type: 'SMS', contactId: contact.contactId, message: alertMsg }),
            })
          } catch (err) { console.error('timekeeper office sms failed', err) }
        }
      } else {
        wouldAlert.push({ caregiver: cgName, client: clientFirst, time: shiftTime,
          minutes_late: Math.round(late) })
      }
    }
  }

  // ── PASS 3: clock-OUT reminders. One text, no ladder, no office step. ──
  const wouldTextOut: Record<string, unknown>[] = []
  let textedOut = 0
  const msgOutTmpl = String(settings.timekeeper_msg_out || '')
    || `Hi {first_name}, it's Cara with Caring Companions. Your shift with {client} ended at {time} but there's no clock-out yet. Please clock out in the AxisCare app now. If you've already left, we cannot make any manual changes to your time without the EVV correction form, completed and signed by the client: sc.mo-care.com/evv-correction-form.`
  for (const v of visits) {
    if (v?.caregiver?.id == null || !v?.clockIn?.time || v?.clockOut?.time) continue
    const end = String(v?.scheduledEndDate ?? v?.endDate ?? '')
    const over = minutesSince(end)
    if (!Number.isFinite(over) || over < outGraceMin || over > STALE_MIN) continue
    const vid = String(v?.id ?? ''); if (!vid) continue
    const existing = ladders.find(x => x?.id === 'tko_' + vid.replace(/[^A-Za-z0-9]/g, '_'))
    if (existing) continue                       // reminded once, ever
    const cgName = [String(v.caregiver.firstName ?? '').trim(), String(v.caregiver.lastName ?? '').trim()]
      .filter(Boolean).join(' ') || ('caregiver ' + v.caregiver.id)
    const clientFirst = String(v?.client?.firstName ?? '').trim() || 'your client'
    if (skipMatch(skips, 'clock', cgName, clientFirst)) { skippedByList++; continue }
    const endTime = end.slice(11, 16)
    const cg = byAxis.get(String(v.caregiver.id)) ?? byName.get(nameKeyOf(cgName))
    const phone = normalisePhone(cg?.phone)
    if (!phone) { skippedNoPhone++; continue }
    if (!textLive) {
      wouldTextOut.push({ caregiver: cgName, client: clientFirst, ended: endTime,
        minutes_over: Math.round(over), phone_last4: phone.slice(-4) })
      continue
    }
    const contact = await contactForOutbound(sb, ghl,
      { phone, firstName: String(cg?.first ?? '') || cgName.split(' ')[0] }, 'urgent_internal')
    if (!contact) { refusedGate++; continue }
    const message = msgOutTmpl.replaceAll('{first_name}', String(cg?.first ?? '') || cgName.split(' ')[0])
      .replaceAll('{client}', clientFirst).replaceAll('{time}', clock12(endTime))
    try {
      const r = await fetch('https://services.leadconnectorhq.com/conversations/messages', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28',
                   'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'SMS', contactId: contact.contactId, message }),
      })
      if (r.ok) {
        await save({ id: 'tko_' + vid.replace(/[^A-Za-z0-9]/g, '_'), kind: 'clock_out',
          visit_id: vid, caregiver: cgName, caregiver_axiscare_id: String(v.caregiver.id),
          client_first: clientFirst, shift_date: day, shift_time: endTime,
          opened_at: nowIso, texted_at: nowIso, ghl_contact_id: contact.contactId,
          resolved_at: null, resolved_how: null })
        textedOut++
      } else console.error('timekeeper clockout sms', r.status, await r.text().catch(() => ''))
    } catch (err) { console.error('timekeeper clockout sms failed', err) }
  }

  /* ── THE EVV AUTO-CHASE (her pick #9, 2026-09-19): once per morning,
     yesterday's ended visits with no clock-in or clock-out get the signed-
     correction-form text automatically — matching the hub's manual chase
     exactly (same evv_followups records, so the board shows "chased" either
     way, and a form already submitted is never chased). Saturday ~3pm, the
     office gets one deadline nudge for still-unprocessed forms. Gated by
     ops_settings.evv_chase_live. */
  let evvChase: Record<string, unknown> = { ran: false }
  try {
    const chaseLive = settings.evv_chase_live === true
    const chiNowS = new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' })
    const chiHourE = Number(chiNowS.slice(11, 13))
    const todayE = chiNowS.slice(0, 10)
    const { data: stRowE } = await sb.from('app_data').select('data').eq('key', 'evv_chase_state').maybeSingle()
    // deno-lint-ignore no-explicit-any
    const chaseState: any[] = Array.isArray(stRowE?.data) ? stRowE!.data : []
    const doneToday = chaseState.some((x) => x?.id === 'chase_' + todayE)
    if (chaseLive && chiHourE >= 9 && !doneToday && !forceDry) {
      const yday = new Date(Date.now() - 864e5).toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
      // deno-lint-ignore no-explicit-any
      const yvisits: any[] = []
      let yu: string | null = `https://${site}.axiscare.com/api/visits?startDate=${yday}&endDate=${yday}`
      for (let page = 0; yu && page < 8; page++) {
        const r: Response = await fetch(yu, { headers: {
          Authorization: `Bearer ${token}`, Accept: 'application/json',
          'X-AxisCare-Api-Version': AC_VERSION } })
        if (!r.ok) break
        // deno-lint-ignore no-explicit-any
        const j: any = await r.json().catch(() => ({}))
        for (const v of rowsOf(j?.results?.visits ?? j?.visits)) if (!v?.removed) yvisits.push(v)
        yu = j?.results?.nextPage ?? j?.nextPage ?? j?.results?.nextPageUrl ?? j?.nextPageUrl ?? null
      }
      const { data: fuRow } = await sb.from('app_data').select('data').eq('key', 'evv_followups').maybeSingle()
      const chased = new Set((Array.isArray(fuRow?.data) ? fuRow!.data : [])
        .map((e: { id?: unknown }) => String(e?.id ?? '')))
      const { data: subs } = await sb.from('evv_submissions').select('attendant, visitdate')
      const subKeys = new Set((subs || []).map((s) =>
        nameKeyOf(String(s.attendant || '')) + '|' + String(s.visitdate || '')))
      let chasedNow = 0, skippedDone = 0
      for (const v of yvisits) {
        if (v?.caregiver?.id == null) continue
        const cin = String(v?.clockIn ?? v?.actualStartDate ?? '').slice(11, 16)
        const cout = String(v?.clockOut ?? v?.actualEndDate ?? '').slice(11, 16)
        if (cin && cout) continue
        const vid = String(v?.id ?? '')
        const key = 'evv_' + yday + '_' + vid.replace(/[^A-Za-z0-9]/g, '_')
        const cgName = [String(v.caregiver.firstName ?? '').trim(), String(v.caregiver.lastName ?? '').trim()]
          .filter(Boolean).join(' ')
        if (chased.has(key) || subKeys.has(nameKeyOf(cgName) + '|' + yday)) { skippedDone++; continue }
        const cg = byAxis.get(String(v.caregiver.id)) ?? byName.get(nameKeyOf(cgName))
        const phone = normalisePhone(cg?.phone)
        if (!phone) continue
        const contact = await contactForOutbound(sb, ghl,
          { phone, firstName: String(cg?.first ?? '') || cgName.split(' ')[0] }, 'routine_internal')
        if (!contact) continue
        const miss = !cin && !cout ? 'clock-in and clock-out' : !cin ? 'clock-in' : 'clock-out'
        const clientFirst = String(v?.client?.firstName ?? '').trim() || 'your client'
        const msg = `Hi ${String(cg?.first ?? '') || cgName.split(' ')[0]}, it's the Caring Companions office. Your visit with ${clientFirst} yesterday is missing its ${miss} in AxisCare. Please complete the EVV correction form and have the client sign it: sc.mo-care.com/evv-correction-form — thank you!`
        try {
          const r = await fetch('https://services.leadconnectorhq.com/conversations/messages', {
            method: 'POST',
            headers: { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28',
                       'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'SMS', contactId: contact.contactId, message: msg }),
          })
          if (r.ok) {
            chasedNow++
            await sb.rpc('upsert_app_data_item', { target_key: 'evv_followups', item: {
              id: key, status: 'texted', at: new Date().toISOString(), by: 'evv-chase',
              caregiver: cgName, client: [v?.client?.firstName, v?.client?.lastName].filter(Boolean).join(' '),
              miss: 'no ' + miss, date: yday } })
          }
        } catch { /* one failed chase never blocks the rest */ }
      }
      await sb.rpc('upsert_app_data_item', { target_key: 'evv_chase_state', item: {
        id: 'chase_' + todayE, at: new Date().toISOString(), chased: chasedNow, already_handled: skippedDone } })
      evvChase = { ran: true, day_checked: yday, chased: chasedNow, already_handled: skippedDone }
    } else evvChase = { ran: false, why: !chaseLive ? 'ops_settings.evv_chase_live is off' : doneToday ? 'already ran today' : 'before 9am Chicago' }
    /* Saturday deadline nudge: forms still unprocessed with Sunday-midnight looming. */
    const wkday = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'short' })
    if (chaseLive && wkday === 'Sat' && chiHourE >= 15 && !forceDry
        && !chaseState.some((x) => x?.id === 'satnudge_' + todayE)) {
      const { data: pend } = await sb.from('evv_submissions').select('id').eq('processed', false)
      const n = (pend || []).length
      if (n) {
        const phones: string[] = (Array.isArray(settings.coverage_alert_phones) ? settings.coverage_alert_phones : [])
          .map((p: unknown) => String(p ?? '').trim()).filter(Boolean)
        for (const p of phones) {
          try {
            const up = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
              method: 'POST',
              headers: { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
              body: JSON.stringify({ locationId: ghl.locationId, phone: p, firstName: 'Scheduling' }),
            })
            // deno-lint-ignore no-explicit-any
            const uj: any = await up.json().catch(() => ({}))
            const cid = uj?.contact?.id ?? uj?.id
            if (cid) await fetch('https://services.leadconnectorhq.com/conversations/messages', {
              method: 'POST',
              headers: { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
              body: JSON.stringify({ type: 'SMS', contactId: cid,
                message: `EVV deadline: ${n} correction form${n === 1 ? '' : 's'} still waiting to be processed, and the weekly deadline is Sunday midnight. The list is on the hub's EVV tab.` }),
            })
          } catch { /* nudge best-effort */ }
        }
      }
      await sb.rpc('upsert_app_data_item', { target_key: 'evv_chase_state', item: {
        id: 'satnudge_' + todayE, at: new Date().toISOString(), pending: n } })
    }
  } catch { /* the chase must never break the timekeeper */ }

  const summary = {
    mode: !watchLive ? 'DRY RUN' : textLive ? 'LIVE (watch + text)' : 'LIVE (watch only — texting off)',
    day, fetch_error: fetchError,
    visits_seen: visits.length,
    /* The clockIn proof First-Visit Confirmation has been waiting for. */
    clockin_evidence: {
      assigned_visits_started_over_15_min_ago: startedAWhile,
      of_those_with_a_clockin: withClockIn,
      read: startedAWhile === 0 ? 'no started visits yet today — run again mid-morning'
        : withClockIn === 0 ? 'ZERO clock-ins visible in the API — do NOT go live until this is understood'
        : `${withClockIn}/${startedAWhile} populate — if this is well under 100%, raise timekeeper_grace_min before texting goes live`,
    },
    evv_chase: evvChase,
    ladders_resolved: resolved, ladders_opened: opened,
    texts_sent: texted, clockout_texts_sent: textedOut, office_alerts: alerted,
    skipped_no_phone: skippedNoPhone, refused_by_outbound_gate: refusedGate,
    skipped_by_skip_list: skippedByList,
    would_text: role === 'authenticated' || role === 'service_role' ? wouldText : wouldText.length,
    would_text_clockout: role === 'authenticated' || role === 'service_role' ? wouldTextOut : wouldTextOut.length,
    would_alert_office: role === 'authenticated' || role === 'service_role' ? wouldAlert : wouldAlert.length,
    settings_in_effect: { grace_min: graceMin, office_after_min: officeAfterMin,
      clockout_grace_min: outGraceMin, skip_list_entries: skips.length,
      alert_phones_configured: alertPhones.length,
      switches: { timekeeper_watch_live: settings.timekeeper_watch_live === true,
                  timekeeper_text_live: settings.timekeeper_text_live === true } },
  }

  /* Log when something happened, plus once an hour so the watchdog can tell
     "quiet" from "dead" — 720 identical rows a day would drown the log. */
  const acted = resolved + opened + texted + textedOut + alerted
  const topOfHour = new Date().getMinutes() < 5
  if (acted || wouldText.length || wouldTextOut.length || wouldAlert.length || topOfHour) {
    try {
      await sb.rpc('upsert_app_data_item', { target_key: 'automation_log', item: {
        id: 'auto_srv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        at: nowIso, automation: 'timekeeper-watch', ran_by: 'server',
        ok: !fetchError, dry: !watchLive, duration_ms: Date.now() - t0,
        rows_seen: visits.length,
        candidates: wouldText.length + wouldTextOut.length + wouldAlert.length + opened,
        created: texted + textedOut + alerted,
      } })
    } catch { /* logging must never block the watch */ }
  }

  return json(summary)
})
