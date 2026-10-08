// Supabase Edge Function: medicaid-visits  (shared hub project)
// -----------------------------------------------------------------------------------------------------------------------
// MEDICAID SLICE D (Samantha 2026-10-08: "missed visits, can those be pulled from AxisCare, not manual?" · "clocked times
// is fine, Medicaid coordinator (Angiel)").
//
// Every weekday (its own schedule, x-cron-secret), for each client with a current Medicaid care plan uploaded in the Hub
// (app_data medicaid_plans: our personal care / APC / ADW lines) and an AxisCare number, read only:
//   · this month's care visits from AxisCare (and last month's in the first 5 days, to finish its review)
//   · units delivered = clocked time in 15-minute units vs the units the plan authorizes (visit-rules.js)
//   · visits not delivered (time passed, no clock-in), with the reason an admin gave on the missed clock-in alert
//   · the risk line, warned before it: 2 in a row not delivered, or 5 days with no delivered visit
// Kept under app_data 'visit_watch' (vw_<ax>_<month>) for the client's Payer tab.
// With ops_settings.visit_watch_live on (the Admin switch, OFF until she turns it on):
//   · at risk → a card for Staffing (owner of Staffing & Scheduling) and one for the Medicaid coordinator (owner of Payer
//     Programs); they close themselves once a visit is delivered again
//   · from the 1st → a "monthly visit review" card for the Medicaid coordinator for last month, cleared in the Hub when
//     she signs it
//   · ADW RESPITE (2026-10-08, "we only do basic, no advanced yet"): for clients with our respite line, the schedule from
//     this week's Monday to two weeks ahead is checked too: a week over 49 respite hours or the month over 868 units, respite
//     overlapping another visit, or advanced respite booked (we don't provide it) → a card for Staffing and one for the
//     Medicaid coordinator, closing themselves once the schedule is fixed (HCBS Manual 3.50; Provider Bulletin 49-03)
// Nobody outside the office is contacted. Nothing in AxisCare or Fusion is changed.
// -----------------------------------------------------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jobCaller } from '../_shared/job-auth.ts'
import '../_shared/visit-rules.js'
// deno-lint-ignore no-explicit-any
const VR: any = (globalThis as any).VisitRules
// deno-lint-ignore no-explicit-any
type Any = any
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const OWNER = 'samantha@mo-care.com'
const CARE = ['pc', 'apc', 'adw_respite', 'adw_homemaker', 'adw_chore']

export function axFetcher(fetchImpl: typeof fetch = fetch) {
  let token = ''
  for (const n of ['AXISCARE_API_KEY', 'AXISCARE_TOKEN']) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  const get = async (path: string) => {
    if (!token || !/^\d+$/.test(site)) return null
    for (let i = 0; i < 2; i++) {
      try {
        const r = await fetchImpl(`https://${site}.axiscare.com${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-AxisCare-Api-Version': '2023-10-01' } })
        if (r.status === 429 && i === 0) { await new Promise((ok) => setTimeout(ok, 1500)); continue }
        return { status: r.status, json: await r.json().catch(() => ({})) }
      } catch { return null }
    }
    return null
  }
  return async (ax: string, from: string, to: string): Promise<Any[] | null> => {
    const out: Any[] = []
    let path: string | null = `/api/visits?clientIds=${encodeURIComponent(ax)}&startDate=${from}&endDate=${to}`
    for (let page = 0; path && page < 8; page++) {
      const r = await get(path); if (!r || r.status !== 200) return null
      const vs = r.json?.results?.visits ?? r.json?.visits ?? []
      out.push(...(Array.isArray(vs) ? vs : Object.values(vs)))
      const nx = r.json?.results?.nextPage ?? r.json?.nextPage ?? null
      path = nx ? String(nx).replace(/^https?:\/\/[^/]+/, '') : null
    }
    return out
  }
}
async function ownerOf(db: Any, code: string): Promise<string> {
  try {
    const { data: dom } = await db.from('domains').select('code, owner_person, entity').eq('code', code).eq('entity', 'cc_ihs').maybeSingle()
    if (dom?.owner_person) { const { data: p } = await db.from('persons').select('person_id, primary_email').eq('person_id', dom.owner_person).maybeSingle(); if (p?.primary_email) return String(p.primary_email).toLowerCase() }
  } catch { /* fall back */ }
  return OWNER
}
const lastDay = (m: string) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate()
const addDaysYmd = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const prevMonth = (m: string) => { let y = +m.slice(0, 4), mo = +m.slice(5, 7) - 1; if (mo < 1) { mo = 12; y-- } return y + '-' + String(mo).padStart(2, '0') }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const caller = await jobCaller(req)
  if (!caller) return json({ error: 'not allowed' }, 401)
  const url = new URL(req.url)
  if (url.searchParams.get('auth_check') === '1') return json({ ok: true, caller })
  const dry = url.searchParams.get('dry') === '1'
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const nowIso = new Date().toISOString(), today = new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
  const month = today.slice(0, 7), day = +today.slice(8, 10)
  const read = async (k: string) => { const { data } = await db.from('app_data').select('data').eq('key', k).maybeSingle(); return data?.data ?? null }
  const plansAll: Any[] = (await read('medicaid_plans')) || [], tk: Any[] = (await read('timekeeper_cases')) || [], watch: Any[] = (await read('visit_watch')) || []
  const st = await read('ops_settings'), live = !!(st && !Array.isArray(st) && st.visit_watch_live === true)
  /* one current plan per client: the latest that covers today and has our care lines */
  const cur = new Map<string, Any>()
  for (const p of plansAll) {
    if (!p || p.kind !== 'plan' || !/^\d+$/.test(String(p.axiscare_client_id || '')) || String(p.plan_end || '') < today || String(p.plan_start || '9999') > today) continue
    if (!(p.services || []).some((s: Any) => s && s.ours && CARE.includes(s.kind))) continue
    const ax = String(p.axiscare_client_id), had = cur.get(ax)
    if (!had || String(p.generated || '') > String(had.generated || '')) cur.set(ax, p)
  }
  const ax = axFetcher(), staffing = await ownerOf(db, 'scheduling_coverage'), medicaid = await ownerOf(db, 'payer_programs')
  const months = day <= 5 ? [prevMonth(month), month] : [month]
  const out: Any = { ok: true, dry, live, clients: cur.size, months, checked: 0, axiscare_failed: 0, at_risk: [], reviews: [], respite: [], cards: [], staffing, medicaid }
  const cards: Any[] = []
  const items = async () => ((await read('ops_items')) || []) as Any[]
  for (const [axId, plan] of cur) {
    for (const m of months) {
      const vs = await ax(axId, m + '-01', m === month ? today : m + '-' + String(lastDay(m)).padStart(2, '0'))
      if (vs === null) { out.axiscare_failed++; continue }
      out.checked++
      const sum = VR.monthSummary(vs, plan, m, nowIso, tk)
      const id = `vw_${axId}_${m}`, prev = watch.find((w) => w && w.id === id) || {}
      const item: Any = { ...prev, id, ax: axId, name: plan.client_name || '', plan_id: plan.id, ...sum, checked_at: nowIso }
      if (m === month) {
        const r = VR.risk(vs, plan, nowIso); item.risk = r
        if (r.at_risk) out.at_risk.push({ name: item.name, in_a_row: r.in_a_row, days_without: r.days_without })
        const words = r.in_a_row + ' scheduled visit' + (r.in_a_row === 1 ? '' : 's') + ' in a row not delivered (' + r.since_missed.join(', ') + ')' + (r.last_delivered ? '; last delivered ' + r.last_delivered : '')
        for (const [who, suffix, what] of [[staffing, 'staff', 'Arrange a make-up visit or a substitute today.'], [medicaid, 'med', 'Make sure a make-up visit is set, and record the reasons.']] as const) {
          const cid = `ops_vrisk_${axId}_${suffix}`
          if (r.at_risk) cards.push({ id: cid, kind: 'visit_risk', status: 'open', urgency: 'urgent', owner: who, domain: suffix === 'staff' ? 'scheduling_coverage' : 'payer_programs',
            title: `Visits not delivered: ${item.name}`, about: item.name, axiscare_client_id: axId,
            detail: words + '. The state treats 1 week or 3 scheduled visits in a row without service, without the client\'s consent, as a risk (19 CSR 15-7.021(4)(A)5). ' + what + ' This card closes itself once a visit is delivered.',
            due: nowIso, link: '#p/A' + axId + '/payer', created_at: nowIso, updated_at: nowIso })
          else cards.push({ id: cid, close_if_open: true, kind: 'visit_risk', status: 'done', done_at: nowIso, done_by: 'The Hub (a visit was delivered)', updated_at: nowIso })
        }
        /* ADW respite: this week's Monday to two weeks ahead (the schedule), for clients with our respite line */
        if ((plan.services || []).some((x: Any) => x && x.ours && x.kind === 'adw_respite')) {
          const from = VR.weekStart(today), to = addDaysYmd(today, 14)
          const rvs = await ax(axId, from < m + '-01' ? from : m + '-01', to)
          if (rvs === null) out.axiscare_failed++
          else {
            const rc = VR.respiteCheck(rvs, nowIso, month); item.respite = { ...rc, from: from < m + '-01' ? from : m + '-01', to }
            const probs: string[] = []
            if (rc.over_weeks.length) probs.push('respite booked over the 49-hour weekly limit: ' + rc.over_weeks.map((w: Any) => 'week of ' + w.week + ' has ' + w.hours + ' hours').join('; '))
            if (rc.month_over) probs.push('respite this month comes to ' + rc.month_units + ' units, over the 868-unit monthly limit')
            if (rc.overlaps.length) probs.push('respite overlaps another visit on ' + Array.from(new Set(rc.overlaps.map((x: Any) => x.day))).join(', ') + ' (respite can\'t be at the same time as another service)')
            if (rc.advanced.length) probs.push('ADVANCED respite is booked on ' + rc.advanced.map((x: Any) => x.day + (x.caregiver ? ' with ' + x.caregiver : '')).join(', ') + ', and we only provide basic respite')
            if (probs.length) out.respite.push({ name: item.name, problems: probs })
            for (const [who, suffix] of [[staffing, 'staff'], [medicaid, 'med']] as const) {
              const cid = `ops_resp_${axId}_${suffix}`
              if (probs.length) cards.push({ id: cid, kind: 'respite_limit', status: 'open', urgency: 'high', owner: who, domain: suffix === 'staff' ? 'scheduling_coverage' : 'payer_programs',
                title: `Respite schedule: ${item.name}`, about: item.name, axiscare_client_id: axId,
                detail: probs.join('. ') + '. Fix the schedule in AxisCare (HCBS Manual 3.50; Provider Bulletin 49-03). This card closes itself once the schedule is within the limits.',
                due: nowIso, link: '#p/A' + axId + '/payer', created_at: nowIso, updated_at: nowIso })
              else cards.push({ id: cid, close_if_open: true, kind: 'respite_limit', status: 'done', done_at: nowIso, done_by: 'The Hub (the respite schedule is within the limits)', updated_at: nowIso })
            }
          }
        }
      } else if (!prev.review || !prev.review.signed_at) {
        out.reviews.push({ name: item.name, month: m })
        cards.push({ id: `ops_vreview_${axId}_${m}`, kind: 'visit_review', status: 'open', urgency: 'normal', owner: medicaid, domain: 'payer_programs',
          title: `Monthly visit review, ${m}: ${item.name}`, about: item.name, axiscare_client_id: axId,
          detail: `${item.delivered_units} of ${item.authorized_units} authorized units delivered (clocked time), ${item.missed.length} visit${item.missed.length === 1 ? '' : 's'} not delivered. Open their Payer tab, explain any difference, and sign (19 CSR 15-7.021(18)(L), (21)(A)).`,
          due: `${month}-10T22:00:00Z`, link: '#p/A' + axId + '/payer', created_at: nowIso, updated_at: nowIso, keep_open: true })
      }
      if (!dry) await db.rpc('upsert_app_data_item', { target_key: 'visit_watch', item })
    }
  }
  if (live && !dry) {
    const have = await items()
    for (const c of cards) {
      const was = have.find((x) => x && x.id === c.id)
      if (c.close_if_open) { if (was && was.status === 'open') { const { close_if_open: _, ...rest } = c; await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { ...was, ...rest } }); out.cards.push({ id: c.id, status: 'done' }) } continue }
      if (was && was.status !== 'open') continue   /* a person closed it: respected */
      if (was && c.keep_open) continue           /* the review card stays as it was until she signs */
      const { keep_open: _k, ...rest } = c
      await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { ...(was || {}), ...rest, created_at: (was && was.created_at) || rest.created_at } })
      out.cards.push({ id: c.id, status: 'open' })
    }
  }
  if (!dry) {
    try { await db.rpc('upsert_app_data_item', { target_key: 'automation_heartbeats', item: { id: 'hb_medicaid-visits', automation: 'medicaid-visits', at: nowIso, ok: out.axiscare_failed === 0,
      note: `clients ${cur.size}, checked ${out.checked}, at risk ${out.at_risk.length}, reviews ${out.reviews.length}${out.axiscare_failed ? ', AxisCare failed ' + out.axiscare_failed : ''}${live ? '' : ' (switch off)'}` } }) } catch { /* no beat */ }
  }
  return json(out)
})
