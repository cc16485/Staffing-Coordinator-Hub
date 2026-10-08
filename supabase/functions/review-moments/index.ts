// =====================================================================================================================
// REVIEW MOMENTS (Samantha 2026-10-07/08). "I do want review opportunities built into the journey, but not as a generic
// automatic blast… The Care Coordinator should see a suggested review task/card. I do not want the system automatically
// sending a Google review request just because a milestone was reached." Her direct Google review link: verified signed
// in on 2026-10-08 (ops_settings.google_review_url can replace it later, with no code change).
//
// THE SWEEP (its schedule, or the owner's Desktop script) finds HER FIVE happy moments, newest first, last 14 days:
//   kind_words  a family or client said something kind (kind words a person confirmed: shift notes, calls, texts, email)
//   care_match  a Care Match call where the family "loves them"
//   checkin     a 4 or 5 star check-in (a successful 30-day check-in included)
//   solved      any of those within 30 days of us resolving a problem for that client ("we solved it and they are grateful")
//   long_term   a client with us 6 months or more whose last two check-ins were 4 or 5 stars (asked at most twice a year)
// …and only when it's a good time: an active client (not starting, paused, past or deceased), with us 14 days or more, no
// open concern, latest check-in not escalated or sliding, not asked in the last 90 days, not "Not now" in the last 30.
// Each becomes ONE card for the client's Care Coordinator, quoting the moment. The Hub never sends the ask: a person
// copies or edits the text (with the review link), sends it from the office line, calls, or asks in person, and one tap
// records it. A week later one card asks "Did they leave a review?" (Left / Said they would / Didn't).
// Switched off (ops_settings.review_asks_live not true) the sweep only lists what it WOULD suggest; no card is written.
//
// STAFF (signed in, office roles): review_state, review_suggest (a person chooses to ask), review_asked, review_not_now,
// review_outcome, review_counts (owners).
// =====================================================================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jobCaller } from '../_shared/job-auth.ts'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'

// deno-lint-ignore no-explicit-any
type Any = any
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const lc = (s: unknown) => String(s ?? '').trim().toLowerCase()
const ymd = (v: unknown) => { const s = String(v ?? '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null }
export const REVIEW_URL = 'https://search.google.com/local/writereview?placeid=ChIJaUETSOx7z4cRdYKcTMoZ6Go'
const addDays = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const chi = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
const RANK: Record<string, number> = { solved: 6, kind_words: 5, care_match: 4, checkin: 3, long_term: 2 }

/** pure: every active client's best happy moment, or why not now. */
export function findMoments(inp: { today: string; links: Any[]; roles: Any[]; pauses: Any[]; journeys: Any[]; checkins: Any[]; kind: Any[];
  issues: Any[]; asks: Any[] }) {
  const T = inp.today, since = addDays(T, -14)
  const personOf = new Map<string, string>(); for (const l of inp.links || []) personOf.set(String(l.source_id), String(l.person_id))
  const rolesOf = new Map<string, Any[]>(); for (const r of inp.roles || []) if (r.role === 'client') rolesOf.set(String(r.person_id), [...(rolesOf.get(String(r.person_id)) || []), r])
  const paused = new Set((inp.pauses || []).map((p: Any) => String(p.axiscare_client_id)))
  const out: Any[] = [], skipped: Record<string, number> = {}
  const skip = (why: string) => { skipped[why] = (skipped[why] || 0) + 1 }
  for (const [ax, pid] of personOf) {
    const rs = rolesOf.get(pid) || []; const act = rs.find((r: Any) => r.status === 'active')
    if (!act) continue                                                      // past, deceased, never a client: never
    if (paused.has(ax)) { skip('paused'); continue }
    const js = (inp.journeys || []).filter((j: Any) => String(j.axiscare_client_id) === ax && !j.is_test).sort((a: Any, b: Any) => String(b.created_at).localeCompare(String(a.created_at)))
    if (js[0] && js[0].status === 'open') { skip('starting care'); continue }
    const began = ymd(act.started_at) || (js[0] ? ymd(js[0].created_at) : null)
    if (began && began > addDays(T, -14)) { skip('first two weeks'); continue }
    const issues = (inp.issues || []).filter((i: Any) => String(i.axiscare_client_id || '') === ax || (pid && String(i.client_person_id || '') === pid))
    if (issues.some((i: Any) => !['resolved', 'closed_no_action'].includes(i.state))) { skip('open concern'); continue }
    const cis = (inp.checkins || []).filter((c: Any) => c && c.client_name && String(c.axiscare_client_id || '') === ax && c.checkin_date).sort((a: Any, b: Any) => String(b.checkin_date).localeCompare(String(a.checkin_date)))
    const rated = cis.filter((c: Any) => +c.satisfaction_rating > 0)
    if (cis[0] && cis[0].escalated) { skip('escalated check-in'); continue }
    if (rated[0] && rated[1] && +rated[0].satisfaction_rating < +rated[1].satisfaction_rating) { skip('check-ins sliding'); continue }
    const mine = (inp.asks || []).filter((a: Any) => String(a.axiscare_client_id) === ax)
    if (mine.some((a: Any) => a.status === 'suggested')) { skip('already suggested'); continue }
    if (mine.some((a: Any) => a.status === 'asked' && ymd(a.asked_at) && ymd(a.asked_at)! > addDays(T, -90))) { skip('asked in the last 90 days'); continue }
    if (mine.some((a: Any) => a.status === 'not_now' && ymd(a.updated_at) && ymd(a.updated_at)! > addDays(T, -30))) { skip('not now, recently'); continue }
    const used = new Set(mine.map((a: Any) => a.moment + '|' + a.moment_ref))
    const cands: Any[] = []
    for (const k of inp.kind || []) {
      if (k.status !== 'kind' || String(k?.link?.ax || '') !== ax) continue
      const on = ymd(k.said_on) || ymd(k.created_at); if (!on || on < since) continue
      cands.push({ moment: 'kind_words', moment_ref: 'kw:' + k.id, moment_on: on, who: k.who || null, quote: String(k.quote || '').slice(0, 600), about: k.about_role === 'caregiver' ? k.about : null })
    }
    for (const c of inp.checkins || []) {
      if (!(c && c.client && c.caregiver && String(c.axiscare_client_id || '') === ax && c.rating === 'love')) continue
      const on = ymd(c.at); if (!on || on < since) continue
      cands.push({ moment: 'care_match', moment_ref: 'cm:' + (c.id ?? on + c.caregiver), moment_on: on, who: c.spoke_with || null, quote: c.notes ? String(c.notes).slice(0, 300) : null, about: c.caregiver })
    }
    if (rated[0] && +rated[0].satisfaction_rating >= 4 && ymd(rated[0].checkin_date)! >= since && !rated[0].escalated)
      cands.push({ moment: 'checkin', moment_ref: 'ci:' + rated[0].id, moment_on: ymd(rated[0].checkin_date), who: rated[0].spoke_with || null, stars: +rated[0].satisfaction_rating, quote: null, about: null })
    const fixed = issues.filter((i: Any) => i.state === 'resolved' && ymd(i.resolved_at)).sort((a: Any, b: Any) => String(b.resolved_at).localeCompare(String(a.resolved_at)))[0]
    for (const c of cands) if (fixed && ymd(fixed.resolved_at)! >= addDays(c.moment_on, -30) && ymd(fixed.resolved_at)! <= c.moment_on) { c.after_problem = String(fixed.summary || '').slice(0, 200); c.solved = true }
    if (!cands.length && began && began <= addDays(T, -182) && rated[0] && rated[1] && +rated[0].satisfaction_rating >= 4 && +rated[1].satisfaction_rating >= 4 && ymd(rated[0].checkin_date)! >= addDays(T, -90)
        && !mine.some((a: Any) => a.moment === 'long_term' && ymd(a.created_at)! > addDays(T, -182)))
      cands.push({ moment: 'long_term', moment_ref: 'lt:' + ax + ':' + T.slice(0, 7), moment_on: ymd(rated[0].checkin_date), who: rated[0].spoke_with || null, stars: +rated[0].satisfaction_rating, quote: null, about: null, since: began })
    const fresh = cands.filter((c) => !used.has(c.moment + '|' + c.moment_ref))
    if (!fresh.length) continue
    fresh.sort((a, b) => ((b.solved ? RANK.solved : RANK[b.moment]) - (a.solved ? RANK.solved : RANK[a.moment])) || String(b.moment_on).localeCompare(String(a.moment_on)))
    const best = fresh[0]
    out.push({ ax, person_id: pid, ...best, moment: best.solved ? 'solved' : best.moment })
  }
  return { suggest: out, skipped }
}

/** the card's words: what happened, and who might be asked */
export function cardFor(m: Any, name: string) {
  const first = name.split(/\s+/)[0] || name
  const what = m.moment === 'kind_words' ? (m.who || 'The family') + ' said: "' + m.quote + '"'
    : m.moment === 'care_match' ? (m.who || 'The family') + ' told us they love ' + (m.about || 'their caregiver') + (m.quote ? ': "' + m.quote + '"' : '')
    : m.moment === 'checkin' ? (m.who ? m.who + ' gave ' : 'A ') + m.stars + ' star check-in on ' + m.moment_on
    : m.moment === 'long_term' ? first + ' has been with us since ' + m.since + ' and the last two check-ins were ' + m.stars + ' stars'
    : m.moment === 'manual' ? (m.note ? m.note : 'Someone on the team thinks this is a good time')
    : (m.who || 'The family') + (m.quote ? ' said: "' + m.quote + '"' : ' is happy')
  const solved = m.after_problem ? ' This came after we sorted out: ' + m.after_problem + '.' : ''
  return { title: 'Ask ' + (m.who || first + '\'s family') + ' for a Google review?', detail: what + '.' + solved + ' A good moment to ask. Open ' + first + '\'s profile to copy the message, then record that you asked (or Not now). Nothing is sent by the Hub.' }
}
/** the message a person copies, edits and sends (no em dashes; her voice: warm, not salesy) */
export function messageFor(m: Any, name: string, me: string, url: string) {
  const first = name.split(/\s+/)[0] || ''
  /* greet by name only when "who" is a plain first name ("Stella"), never "Hilda's daughter" or "the family" */
  const w = String(m.asked_who || m.who || '').trim(), hi = w && !/'s\b|\bfamily\b|\bsomeone\b|\bthe\b/i.test(w) ? w.split(/\s+/)[0] : ''
  return 'Hi' + (hi ? ' ' + hi : '') + ', this is ' + (me.split(/\s+/)[0] || 'the team') + ' at Caring Companions. Thank you for the kind words'
    + (m.about ? ' about ' + String(m.about).split(/\s+/)[0] : (first ? ' about ' + first + '\'s care' : '')) + '. If you have a minute, a Google review would mean a lot to our team and helps other families in Springfield find care they can trust: ' + url
}

async function people(db: Any) {
  const { data: roles } = await db.from('staff_roles').select('person_id, role').eq('entity', 'cc_ihs')
  const ids = [...new Set((roles ?? []).map((r: Any) => r.person_id))]
  const { data: ps } = ids.length ? await db.from('persons').select('person_id, full_name, primary_email, active').in('person_id', ids) : { data: [] }
  const by: Record<string, Any> = {}; (ps ?? []).forEach((p: Any) => { if (p.active !== false && p.primary_email) by[p.person_id] = p })
  const of = (role: string) => [...new Set((roles ?? []).filter((r: Any) => r.role === role && by[r.person_id]).map((r: Any) => lc(by[r.person_id].primary_email)))].sort() as string[]
  const names: Record<string, string> = {}; Object.values(by).forEach((p: Any) => { names[lc(p.primary_email)] = p.full_name || p.primary_email })
  return { owners: of('owner_admin'), cc: of('care_coordinator'), names, office: new Set<string>([...of('owner_admin'), ...of('care_coordinator'), ...of('staffing_coordinator')]) }
}
const appData = async (db: Any, key: string) => { const { data } = await db.from('app_data').select('data').eq('key', key).maybeSingle(); return data?.data ?? null }
const putItem = (db: Any, item: Any) => db.rpc('upsert_app_data_item', { target_key: 'ops_items', item })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  let b: Any = {}; try { b = await req.json() } catch { return json({ error: 'bad request' }, 400) }
  const st = (await appData(db, 'ops_settings')) || {}
  const url = /^https:\/\//.test(String(st.google_review_url || '')) ? String(st.google_review_url) : REVIEW_URL
  const T = chi(), now = new Date().toISOString()
  const ccOf = (ax: string, js: Any[], pp: Any) => {
    const j = js.filter((x: Any) => String(x.axiscare_client_id) === ax && x.assigned_cc).sort((a: Any, c: Any) => String(c.created_at).localeCompare(String(a.created_at)))[0]
    const ok = (e: unknown) => { const x = lc(e); return x && pp.office.has(x) ? x : '' }
    return ok(j?.assigned_cc) || ok(st.client_journey_default_cc) || pp.cc[0] || pp.owners[0] || ''
  }

  if (b.action === 'sweep') {
    if (!(await jobCaller(req))) return json({ error: 'not allowed' }, 403)
    const live = st.review_asks_live === true && b.practice !== true
    const sel = async (t: string, cols: string, f?: (q: Any) => Any) => { let q = db.from(t).select(cols); if (f) q = f(q); const { data, error } = await q; if (error) throw new Error(t + ': ' + error.message); return data ?? [] }
    let inp: Any
    try {
      const [links, roles, pauses, journeys, kind, issues, asks, ci] = await Promise.all([
        sel('person_source_id', 'person_id, source_id', (q) => q.eq('system', 'axiscare').eq('entity_type', 'client')),
        sel('person_role', 'person_id, role, status, started_at', (q) => q.eq('role', 'client')),
        sel('client_pause', 'axiscare_client_id', (q) => q.eq('status', 'open')),
        sel('client_journey', 'axiscare_client_id, status, created_at, assigned_cc, is_test'),
        sel('kind_words', 'id, quote, who, about, about_role, said_on, created_at, link, status', (q) => q.eq('status', 'kind')),
        sel('client_issue', 'axiscare_client_id, client_person_id, state, summary, resolved_at'),
        sel('review_ask', 'axiscare_client_id, moment, moment_ref, status, asked_at, updated_at, created_at'),
        appData(db, 'client_checkins')])
      inp = { today: T, links, roles, pauses, journeys, kind, issues, asks, checkins: Array.isArray(ci) ? ci : [] }
    } catch (e) { return json({ error: 'could not read: ' + String((e as Error).message).slice(0, 200) }, 500) }
    const f = findMoments(inp), pp = await people(db)
    const { data: who } = await db.from('person_identity').select('id, display_name').in('id', f.suggest.map((s: Any) => s.person_id))
    const nameOf = (pid: string) => String((who ?? []).find((p: Any) => p.id === pid)?.display_name || 'this client')
    const plan = f.suggest.map((s: Any) => ({ ...s, name: nameOf(s.person_id), owner: ccOf(s.ax, inp.journeys, pp) }))
    let made = 0
    if (live) for (const s of plan) {
      const { data: row, error } = await db.from('review_ask').insert({ axiscare_client_id: s.ax, person_id: s.person_id, client_name: s.name, moment: s.moment, moment_ref: s.moment_ref,
        moment_on: s.moment_on, who: s.who, about: s.about || null, quote: s.quote, after_problem: s.after_problem || null, owner_email: s.owner || null, created_by: 'review-moments' }).select('ask_id').single()
      if (error || !row) continue
      const c = cardFor(s, s.name), id = 'ops_rv_' + String(row.ask_id).replace(/-/g, '').slice(0, 12)
      await putItem(db, { id, kind: 'review_ask', status: 'open', source_type: 'review', axiscare_client_id: s.ax, about: s.name, title: c.title, detail: c.detail,
        owner: s.owner, owner_name: pp.names[s.owner] || s.owner, link: '#p/A' + s.ax + '/summary', urgency: 'normal', due: new Date(addDays(T, 3) + 'T17:00:00-05:00').toISOString(),
        ask_id: row.ask_id, created_by: 'review-moments', opened_by: 'review-moments', created_at: now })
      await db.from('review_ask').update({ card_id: id }).eq('ask_id', row.ask_id); made++
    }
    /* a week after asking: one card, "Did they leave a review?" */
    let followups = 0
    if (live) {
      const { data: due } = await db.from('review_ask').select('*').eq('status', 'asked').is('outcome', null).is('followup_card_id', null).lte('asked_at', addDays(T, -7) + 'T23:59:59Z')
      for (const a of due ?? []) {
        const id = 'ops_rvf_' + String(a.ask_id).replace(/-/g, '').slice(0, 12)
        await putItem(db, { id, kind: 'review_followup', status: 'open', source_type: 'review', axiscare_client_id: a.axiscare_client_id, about: a.client_name,
          title: 'Did ' + (a.asked_who || a.who || (a.client_name ? a.client_name + '\'s family' : 'they')) + ' leave a Google review?', detail: 'You asked on ' + String(a.asked_at).slice(0, 10) + ' (' + String(a.asked_how).replace('_', ' ') + '). Open the profile and record: Left a review, Said they would, or Didn\'t.',
          owner: a.asked_by || a.owner_email, owner_name: pp.names[lc(a.asked_by || a.owner_email)] || a.asked_by_name || '', link: '#p/A' + a.axiscare_client_id + '/summary', urgency: 'low',
          due: new Date(T + 'T17:00:00-05:00').toISOString(), ask_id: a.ask_id, created_by: 'review-moments', opened_by: 'review-moments', created_at: now })
        await db.from('review_ask').update({ followup_card_id: id, updated_at: now }).eq('ask_id', a.ask_id); followups++
      }
    }
    return json({ ok: true, live, today: T, would_suggest: plan.length, suggested: made, followups, skipped: f.skipped,
      list: plan.map((s: Any) => ({ name: s.name, moment: s.moment, on: s.moment_on, who: s.who, owner: s.owner })) })
  }

  /* ── staff ── */
  const who = await requireStaff(db, req, OFFICE_ROLES as unknown as string[]); if (!who.ok) return json({ error: who.error }, who.status)
  const isOwner = who.roles.includes('owner_admin')
  const ax = String(b.axiscare_client_id ?? '').trim()
  const closeCard = async (id: string | null, note: string) => {
    if (!id) return; const items = await appData(db, 'ops_items'); const it = (Array.isArray(items) ? items : []).find((x: Any) => x?.id === id)
    if (it && it.status === 'open') await putItem(db, { ...it, status: 'done', closed_at: now, closed_by: who.email, close_note: note })
  }
  const askRow = async () => { const { data } = await db.from('review_ask').select('*').eq('ask_id', String(b.ask_id || '')).maybeSingle(); return data }

  if (b.action === 'review_counts') {
    if (!isOwner) return json({ error: 'owners only' }, 403)
    const since = addDays(T, -90)
    const { data } = await db.from('review_ask').select('status, outcome, asked_at, created_at, is_test').gte('created_at', since + 'T00:00:00Z')
    const rows = (data ?? []).filter((r: Any) => !r.is_test)
    return json({ since, suggested: rows.length, asked: rows.filter((r: Any) => r.status === 'asked').length, left: rows.filter((r: Any) => r.outcome === 'left').length,
      said_would: rows.filter((r: Any) => r.outcome === 'said_would').length, not_now: rows.filter((r: Any) => r.status === 'not_now').length, live: st.review_asks_live === true })
  }
  if (b.action === 'review_state') {
    if (!/^\d+$/.test(ax)) return json({ error: 'Which client?' }, 400)
    const { data: asks } = await db.from('review_ask').select('*').eq('axiscare_client_id', ax).order('created_at', { ascending: false })
    const open = (asks ?? []).find((a: Any) => a.status === 'suggested') || null
    const followup = (asks ?? []).find((a: Any) => a.status === 'asked' && !a.outcome) || null
    const { data: link } = await db.from('person_source_id').select('person_id').eq('system', 'axiscare').eq('entity_type', 'client').eq('source_id', ax).maybeSingle()
    const { data: roles } = link ? await db.from('person_role').select('status').eq('person_id', link.person_id).eq('role', 'client') : { data: [] }
    const { data: pz } = await db.from('client_pause').select('pause_id').eq('axiscare_client_id', ax).eq('status', 'open').maybeSingle()
    const current = (roles ?? []).some((r: Any) => r.status === 'active') && !pz
    const recent = (asks ?? []).find((a: Any) => a.status === 'asked' && ymd(a.asked_at)! > addDays(T, -90))
    return json({ live: st.review_asks_live === true, current, url, open, followup, history: asks ?? [],
      can_suggest: current && !open && !recent, why_not: !current ? 'Only current clients are asked.' : open ? 'A suggestion is already open.' : recent ? 'Asked in the last 90 days.' : null,
      message: open ? messageFor(open, open.client_name, who.name, url) : null })
  }
  if (b.action === 'review_suggest') {
    if (!/^\d+$/.test(ax)) return json({ error: 'Which client?' }, 400)
    const { data: link } = await db.from('person_source_id').select('person_id').eq('system', 'axiscare').eq('entity_type', 'client').eq('source_id', ax).maybeSingle()
    const { data: roles } = link ? await db.from('person_role').select('status').eq('person_id', link.person_id).eq('role', 'client') : { data: [] }
    const { data: pz } = await db.from('client_pause').select('pause_id').eq('axiscare_client_id', ax).eq('status', 'open').maybeSingle()
    if (!(roles ?? []).some((r: Any) => r.status === 'active') || pz) return json({ outcome: 'refused', error: 'Only current clients are asked (not starting, paused, past or deceased).' }, 422)
    const { data: recent } = await db.from('review_ask').select('ask_id').eq('axiscare_client_id', ax).eq('status', 'asked').gte('asked_at', addDays(T, -90) + 'T00:00:00Z').limit(1)
    if ((recent ?? []).length) return json({ outcome: 'refused', error: 'They were asked in the last 90 days.' }, 422)
    const { data: pi } = link ? await db.from('person_identity').select('display_name').eq('id', link.person_id).maybeSingle() : { data: null }
    const { data: row, error } = await db.from('review_ask').insert({ axiscare_client_id: ax, person_id: link?.person_id ?? null, client_name: String(pi?.display_name || b.client_name || 'this client'),
      moment: 'manual', moment_on: T, who: String(b.who || '').trim().slice(0, 120) || null, note: String(b.note || '').trim().slice(0, 500) || null, owner_email: who.email, created_by: who.email }).select('*').single()
    if (error) return json({ outcome: 'refused', error: /review_ask_one_open/.test(error.message) ? 'A suggestion is already open for them.' : error.message }, 422)
    return json({ outcome: 'suggested', ask: row, message: messageFor(row, row.client_name, who.name, url) })
  }
  if (b.action === 'review_asked') {
    const a = await askRow(); if (!a) return json({ error: 'not found' }, 404)
    if (a.status !== 'suggested') return json({ outcome: 'refused', error: 'This one was already recorded.' }, 422)
    if (!['text', 'call', 'in_person', 'email'].includes(String(b.how))) return json({ outcome: 'refused', error: 'How did you ask?' }, 422)
    const { error } = await db.from('review_ask').update({ status: 'asked', asked_how: b.how, asked_who: String(b.who || a.who || '').trim().slice(0, 120) || null, asked_by: who.email, asked_by_name: who.name,
      asked_at: now, note: String(b.note || a.note || '').trim().slice(0, 500) || null, updated_at: now }).eq('ask_id', a.ask_id)
    if (error) return json({ error: error.message }, 500)
    await closeCard(a.card_id, 'Asked for a Google review (' + String(b.how).replace('_', ' ') + ')')
    return json({ outcome: 'asked' })
  }
  if (b.action === 'review_not_now') {
    const a = await askRow(); if (!a) return json({ error: 'not found' }, 404)
    if (a.status !== 'suggested') return json({ outcome: 'refused', error: 'This one was already recorded.' }, 422)
    await db.from('review_ask').update({ status: 'not_now', note: String(b.note || '').trim().slice(0, 500) || null, outcome_by: who.email, updated_at: now }).eq('ask_id', a.ask_id)
    await closeCard(a.card_id, 'Not now' + (b.note ? ': ' + String(b.note).slice(0, 120) : ''))
    return json({ outcome: 'not_now' })
  }
  if (b.action === 'review_outcome') {
    const a = await askRow(); if (!a) return json({ error: 'not found' }, 404)
    if (a.status !== 'asked') return json({ outcome: 'refused', error: 'Record the ask first.' }, 422)
    if (!['left', 'said_would', 'didnt'].includes(String(b.outcome))) return json({ outcome: 'refused', error: 'Left, said they would, or didn\'t?' }, 422)
    await db.from('review_ask').update({ outcome: b.outcome, outcome_by: who.email, outcome_at: now, updated_at: now }).eq('ask_id', a.ask_id)
    await closeCard(a.followup_card_id, { left: 'Left a Google review', said_would: 'Said they would', didnt: 'Didn\'t leave one' }[String(b.outcome)]!)
    return json({ outcome: 'recorded' })
  }
  return json({ error: 'unknown action' }, 400)
})
